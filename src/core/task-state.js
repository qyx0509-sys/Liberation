/*
 * 解放 — 任务状态与安全持久化
 * Copyright (c) 2026 zlh and contributors
 * SPDX-License-Identifier: MIT
 */
(function initTaskState(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.JFTaskState = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function taskStateFactory(root) {
  'use strict';

  const SCHEMA_VERSION = 1;
  const TASK_STORAGE_KEY = 'jiefang.taskState.v1';
  const TASK_STATES = Object.freeze({
    IDLE: 'idle',
    QUEUED: 'queued',
    RUNNING: 'running',
    PAUSED: 'paused',
    NEEDS_USER_REVIEW: 'needs_user_review',
    WAITING_PAGE: 'waiting_page',
    COMPLETED: 'completed',
    FAILED: 'failed',
    CANCELLED: 'cancelled',
  });
  const VALID_STATES = new Set(Object.values(TASK_STATES));
  const FINAL_STATES = new Set([TASK_STATES.COMPLETED, TASK_STATES.FAILED, TASK_STATES.CANCELLED]);
  const RESULT_STATUSES = Object.freeze({
    SUCCESS: 'finished_success',
    PARTIAL: 'finished_partial',
    NO_CHANGES: 'finished_no_changes',
    FAILED: 'failed',
  });
  const VALID_RESULT_STATUSES = new Set(['', ...Object.values(RESULT_STATUSES)]);
  const TOP_LEVEL_KEYS = new Set([
    'schemaVersion', 'taskId', 'queue', 'currentIndex', 'state', 'results', 'paused',
    'startedAt', 'updatedAt', 'completedAt', 'adapterId', 'profileRevision', 'origin',
    'siteProfileId', 'siteProfileRevision', 'scanId', 'resultStatus',
  ]);
  const QUEUE_KEYS = new Set([
  'id', 'sectionId', 'label', 'index', 'state', 'confidence', 'passiveOnly',
  'reasonCode', 'requiresUserAction', 'attempts', 'adapterId', 'scanId',
  'sectionSource', 'collection', 'collectionMode', 'indexContext',
  'regionCandidates',
  ]);

  const REGION_CANDIDATE_KEYS = new Set([
    'sectionId',
    'source',
    'confidence',
    'collection',
    'collectionMode',
  ]);

  const MAX_REGION_CANDIDATES = 20;

  const RESULT_KEYS = new Set([
    'sectionId', 'status', 'reasonCode', 'summary', 'finishedAt', 'attempts', 'scanId',
    'siteProfileId', 'siteProfileRevision',
  ]);
  const SUMMARY_KEYS = new Set([
    'total', 'planned', 'success', 'skipped', 'skippedEmpty', 'skippedExisting',
    'conflicts', 'notFound', 'manualReview', 'failed',
    'needsConfirmation', 'unmatched', 'missingJson',
  ]);
  const FORBIDDEN_KEYS = new Set([
    '__proto__', 'prototype', 'constructor',
    'cookie', 'cookies', 'session', 'token', 'auth', 'authorization', 'credential',
    'password', 'secret', 'apiKey', 'apikey',
    'url', 'href', 'fullUrl', 'query', 'hash', 'pageHtml', 'html', 'selector',
    'resumeData', 'profileName', 'plannedValue', 'beforeValue', 'afterValue', 'fieldValue', 'pageValue',
    'file', 'files', 'fileName', 'filePath', 'path', 'blob', 'base64', 'dataUrl', 'arrayBuffer',
    'element', 'node', 'document', 'window', 'error', 'stack',
    'allowOverwrite', 'previewBeforeFill', 'allowSafeSave', 'userConfirmed',
    'nonce', 'tabId', 'materialId', 'materialIds', 'filePolicy', 'expiresAt',
  ]);
  const MAX_SERIALIZED_BYTES = 256 * 1024;
  const MAX_QUEUE_ITEMS = 100;
  const MAX_RESULTS = 500;

  function isPlainRecord(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }

  function safeString(value, maxLength = 160) {
    return String(value ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength);
  }

  function validateOrigin(value) {
    const text = safeString(value, 500);
    if (!text) return '';
    try {
      const parsed = new URL(text);
      if (!/^https?:$/.test(parsed.protocol) || parsed.origin !== text.replace(/\/$/, '')) throw new Error();
      return parsed.origin;
    } catch (_) {
      throw new Error('taskState.origin 必须是 http(s) 精确 origin，且不得包含路径、查询或 fragment');
    }
  }

  function cloneSerializable(value, path = 'root', state = { nodes: 0 }, depth = 0) {
    state.nodes += 1;
    if (state.nodes > 5_000) throw new Error('任务状态节点数超过上限');
    if (depth > 8) throw new Error('任务状态嵌套过深');
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw new Error(`${path} 必须是有限数字`);
      return value;
    }
    if (typeof value === 'string') {
      if (value.length > 20_000) throw new Error(`${path} 字符串过长`);
      return value;
    }
    if (Array.isArray(value)) {
      if (value.length > MAX_RESULTS) throw new Error(`${path} 数组过长`);
      return value.map((item, index) => cloneSerializable(item, `${path}[${index}]`, state, depth + 1));
    }
    if (!isPlainRecord(value)) throw new Error(`${path} 只允许普通可序列化 JSON 数据`);
    const output = Object.create(null);
    const keys = Object.keys(value);
    if (keys.length > 100) throw new Error(`${path} 字段过多`);
    for (const key of keys) {
      const forbidden = [...FORBIDDEN_KEYS].some(item => item.toLocaleLowerCase() === key.toLocaleLowerCase());
      if (forbidden) throw new Error(`${path} 包含禁止持久化字段 ${key}`);
      if (key.length > 80) throw new Error(`${path} 包含过长字段名`);
      output[key] = cloneSerializable(value[key], `${path}.${key}`, state, depth + 1);
    }
    return output;
  }

  function onlyAllowedKeys(record, allowed, path) {
    for (const key of Object.keys(record)) {
      if (FORBIDDEN_KEYS.has(key) || !allowed.has(key)) throw new Error(`${path} 不允许字段 ${key}`);
    }
  }

  function normalizeScanId(value, fallback = '') {
    const scanId = safeString(value || fallback, 160);
    if (!scanId || !/^scan:[a-zA-Z0-9._:-]{4,154}$/.test(scanId)) throw new Error('taskState.scanId 非法');
    return scanId;
  }

  function normalizeRegionCandidate(rawCandidate, index) {
    if (!isPlainRecord(rawCandidate)) {
      throw new Error(
        `taskState.regionCandidates[${index}] 必须是普通对象`
      );
    }

    /*
    * regionCandidates 只持久化恢复执行所需的最小语义信息。
    * 不允许保存 DOM、selector、字段 evidence 等运行时数据。
    */
    const sanitized = {
      sectionId: rawCandidate.sectionId,
      source: rawCandidate.source,
      confidence: rawCandidate.confidence,
      collection: rawCandidate.collection,
      collectionMode: rawCandidate.collectionMode,
    };

    const sectionId = safeString(
      sanitized.sectionId,
      80,
    );

    if (
      !sectionId
      || !/^[a-z0-9][a-z0-9_-]{0,79}$/i.test(sectionId)
    ) {
      throw new Error(
        `taskState.regionCandidates[${index}] sectionId 非法`
      );
    }

    const collection = safeString(
      sanitized.collection || sectionId,
      80,
    );

    if (
      !collection
      || !/^[a-z0-9][a-z0-9_-]{0,79}$/i.test(collection)
    ) {
      throw new Error(
        `taskState.regionCandidates[${index}] collection 非法`
      );
    }

    const collectionMode = safeString(
      sanitized.collectionMode || 'unknown',
      40,
    );

    const allowedModes = new Set([
      'array',
      'repeatable',
      'singleton-view',
      'record',
      'unknown',
    ]);

    if (!allowedModes.has(collectionMode)) {
      throw new Error(
        `taskState.regionCandidates[${index}] collectionMode 非法`
      );
    }

    return {
      sectionId,

      source: safeString(
        sanitized.source || 'embedded-region',
        60,
      ),

      confidence: Math.max(
        0,
        Math.min(
          1,
          Number(sanitized.confidence) || 0,
        ),
      ),

      collection,

      collectionMode,
    };
  }

  function normalizeRegionCandidates(rawCandidates) {
    if (
      rawCandidates === undefined
      || rawCandidates === null
    ) {
      return [];
    }

    if (!Array.isArray(rawCandidates)) {
      throw new Error(
        'taskState.queue[].regionCandidates 必须是数组'
      );
    }

    if (rawCandidates.length > MAX_REGION_CANDIDATES) {
      throw new Error(
        `每个栏目最多允许 ${MAX_REGION_CANDIDATES} 个区域候选`
      );
    }

    return rawCandidates.map(
      (candidate, index) =>
        normalizeRegionCandidate(candidate, index)
    );
  }
  
  function normalizeQueueItem(rawItem, index, scanId) {
    if (!isPlainRecord(rawItem)) throw new Error(`taskState.queue[${index}] 必须是普通对象`);
    onlyAllowedKeys(rawItem, QUEUE_KEYS, `taskState.queue[${index}]`);
    const sectionId = safeString(rawItem.sectionId || rawItem.id, 80);
    if (!sectionId || !/^[a-z0-9][a-z0-9_-]{0,79}$/i.test(sectionId)) throw new Error(`taskState.queue[${index}] 缺少合法 sectionId`);
    return {
      id: safeString(rawItem.id || sectionId, 80),
      sectionId,
      label: safeString(rawItem.label, 120),
      index,
      state: safeString(rawItem.state || 'pending', 40),
      confidence: Math.max(0, Math.min(1, Number(rawItem.confidence) || 0)),
      passiveOnly: Boolean(rawItem.passiveOnly),
      reasonCode: safeString(rawItem.reasonCode, 80),
      requiresUserAction: rawItem.requiresUserAction !== false,
      attempts: Math.max(0, Math.min(100, Number(rawItem.attempts) || 0)),
      adapterId: safeString(rawItem.adapterId, 80),
      scanId: normalizeScanId(rawItem.scanId, scanId),
      sectionSource: safeString(rawItem.sectionSource, 60),
      collection: safeString(rawItem.collection, 80),
      collectionMode: safeString(rawItem.collectionMode, 40),
      indexContext: Boolean(rawItem.indexContext),
      regionCandidates:
        normalizeRegionCandidates(
          rawItem.regionCandidates
        ),
    };
  }

  function normalizeSummary(rawSummary) {
    if (rawSummary === undefined || rawSummary === null) return {};
    if (!isPlainRecord(rawSummary)) throw new Error('taskState.results[].summary 必须是普通对象');
    onlyAllowedKeys(rawSummary, SUMMARY_KEYS, 'taskState.results[].summary');
    const summary = {};
    for (const [key, value] of Object.entries(rawSummary)) {
      const count = Number(value);
      if (!Number.isInteger(count) || count < 0 || count > 100_000) throw new Error(`任务结果计数 ${key} 非法`);
      summary[key] = count;
    }
    return summary;
  }

  function normalizeResult(rawResult, index, scanId, siteProfileId = '', siteProfileRevision = '') {
    if (!isPlainRecord(rawResult)) throw new Error(`taskState.results[${index}] 必须是普通对象`);
    onlyAllowedKeys(rawResult, RESULT_KEYS, `taskState.results[${index}]`);
    return {
      sectionId: safeString(rawResult.sectionId, 80),
      status: safeString(rawResult.status, 40),
      reasonCode: safeString(rawResult.reasonCode, 80),
      summary: normalizeSummary(rawResult.summary),
      finishedAt: rawResult.finishedAt ? normalizeTimestamp(rawResult.finishedAt, '') : '',
      attempts: Math.max(0, Math.min(100, Number(rawResult.attempts) || 0)),
      scanId: normalizeScanId(rawResult.scanId, scanId),
      siteProfileId: safeString(rawResult.siteProfileId || siteProfileId, 80),
      siteProfileRevision: safeString(rawResult.siteProfileRevision || siteProfileRevision, 128),
    };
  }

  function normalizeTimestamp(value, fallback = new Date().toISOString()) {
    if (value === '' && fallback === '') return '';
    const parsed = new Date(value || fallback);
    if (Number.isNaN(parsed.getTime())) throw new Error('任务时间戳无效');
    return parsed.toISOString();
  }

  function normalizeTaskState(rawTask, { forRestore = false } = {}) {
    if (!isPlainRecord(rawTask)) throw new Error('任务状态必须是普通对象');
    onlyAllowedKeys(rawTask, TOP_LEVEL_KEYS, 'taskState');
    if (rawTask.schemaVersion !== undefined && Number(rawTask.schemaVersion) !== SCHEMA_VERSION) {
      throw new Error(`不支持的任务状态版本：${rawTask.schemaVersion}`);
    }
    const taskId = safeString(rawTask.taskId, 128);
    if (!taskId || !/^[a-zA-Z0-9._:-]{6,128}$/.test(taskId)) throw new Error('taskState.taskId 非法');
    const scanId = normalizeScanId(rawTask.scanId, `scan:legacy:${taskId.replace(/[^a-zA-Z0-9._:-]/g, '_')}`);
    const queueInput = Array.isArray(rawTask.queue) ? rawTask.queue : [];
    const resultsInput = Array.isArray(rawTask.results) ? rawTask.results : [];
    if (queueInput.length > MAX_QUEUE_ITEMS) throw new Error(`任务队列最多 ${MAX_QUEUE_ITEMS} 项`);
    if (resultsInput.length > MAX_RESULTS) throw new Error(`任务结果最多 ${MAX_RESULTS} 项`);
    const siteProfileId = safeString(rawTask.siteProfileId, 80);
    const siteProfileRevision = safeString(rawTask.siteProfileRevision, 128);
    const queue = queueInput.map((item, index) => normalizeQueueItem(item, index, scanId));
    const results = resultsInput.map((item, index) => normalizeResult(
      item,
      index,
      scanId,
      siteProfileId,
      siteProfileRevision,
    ));
    let state = safeString(rawTask.state || (queue.length ? TASK_STATES.QUEUED : TASK_STATES.IDLE), 40);
    if (!VALID_STATES.has(state)) throw new Error(`未知任务状态：${state}`);
    let paused = Boolean(rawTask.paused || state === TASK_STATES.PAUSED);
    // 浏览器/Service Worker 恢复后，任何尚未结束且可能继续写页面的任务都必须
    // 丢弃执行授权并回到人工确认；paused 也不能成为绕过恢复确认的入口。
    if (forRestore && state !== TASK_STATES.IDLE && !FINAL_STATES.has(state)) {
      state = TASK_STATES.NEEDS_USER_REVIEW;
      paused = true;
    }
    const currentIndex = Math.max(0, Math.min(queue.length ? queue.length - 1 : 0, Number(rawTask.currentIndex) || 0));
    const resultStatus = safeString(rawTask.resultStatus, 40).toLowerCase();
    if (!VALID_RESULT_STATUSES.has(resultStatus)) throw new Error(`未知任务结果状态：${resultStatus}`);
    const normalized = {
      schemaVersion: SCHEMA_VERSION,
      taskId,
      scanId,
      queue,
      currentIndex,
      state,
      results,
      paused,
      startedAt: normalizeTimestamp(rawTask.startedAt),
      updatedAt: normalizeTimestamp(rawTask.updatedAt || rawTask.startedAt),
      completedAt: rawTask.completedAt ? normalizeTimestamp(rawTask.completedAt, '') : '',
      adapterId: safeString(rawTask.adapterId, 80),
      profileRevision: safeString(rawTask.profileRevision, 128),
      siteProfileId,
      siteProfileRevision,
      origin: rawTask.origin ? validateOrigin(rawTask.origin) : '',
      resultStatus,
    };
    const cloned = cloneSerializable(normalized);
    const serialized = JSON.stringify(cloned);
    if (new TextEncoder().encode(serialized).length > MAX_SERIALIZED_BYTES) throw new Error('任务状态超过持久化大小上限');
    return JSON.parse(serialized);
  }

  function randomTaskId() {
    try {
      if (root?.crypto?.randomUUID) return `task:${root.crypto.randomUUID()}`;
    } catch (_) { /* fallback below */ }
    return `task:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 14)}`;
  }

  function createScanId() {
    try {
      if (root?.crypto?.randomUUID) return `scan:${root.crypto.randomUUID()}`;
    } catch (_) { /* fallback below */ }
    return `scan:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 14)}`;
  }

  function createTask(options = {}) {
    const now = new Date().toISOString();
    return normalizeTaskState({
      schemaVersion: SCHEMA_VERSION,
      taskId: options.taskId || randomTaskId(),
      scanId: options.scanId || createScanId(),
      queue: Array.isArray(options.queue) ? options.queue : [],
      currentIndex: Number(options.currentIndex) || 0,
      state: options.state || (options.queue?.length ? TASK_STATES.QUEUED : TASK_STATES.IDLE),
      results: Array.isArray(options.results) ? options.results : [],
      paused: Boolean(options.paused),
      startedAt: options.startedAt || now,
      updatedAt: now,
      completedAt: '',
      adapterId: options.adapterId || '',
      profileRevision: options.profileRevision || '',
      siteProfileId: options.siteProfileId || '',
      siteProfileRevision: options.siteProfileRevision || '',
      origin: options.origin || '',
      resultStatus: options.resultStatus || '',
    });
  }

  function storageCall(area, method, argument, chromeApi) {
    return new Promise((resolve, reject) => {
      if (!area || typeof area[method] !== 'function') { reject(new Error(`storage.${method} 不可用`)); return; }
      let settled = false;
      const callback = value => {
        if (settled) return;
        settled = true;
        const lastError = chromeApi?.runtime?.lastError;
        if (lastError) reject(new Error(lastError.message || `storage.${method} 失败`));
        else resolve(value);
      };
      try {
        const returned = method === 'clear' ? area[method](callback) : area[method](argument, callback);
        if (returned && typeof returned.then === 'function') {
          returned.then(value => { if (!settled) { settled = true; resolve(value); } }, error => { if (!settled) { settled = true; reject(error); } });
        }
      } catch (error) { reject(error); }
    });
  }

  class TaskStateStore {
    constructor(options = {}) {
      this.chrome = options.chromeApi || root?.chrome;
      this.key = safeString(options.key || TASK_STORAGE_KEY, 160);
      this.session = options.sessionArea || this.chrome?.storage?.session || null;
      this.local = options.localArea || this.chrome?.storage?.local || null;
      this.tail = Promise.resolve();
      if (!this.session && !this.local) throw new Error('chrome.storage.session/local 均不可用');
    }

    enqueue(operation) {
      const next = this.tail.then(operation, operation);
      this.tail = next.catch(() => undefined);
      return next;
    }

    async readArea(area) {
      const value = await storageCall(area, 'get', this.key, this.chrome);
      return value?.[this.key] ?? null;
    }

    async writeArea(area, task) {
      await storageCall(area, 'set', { [this.key]: task }, this.chrome);
      return task;
    }

    async load() {
      return this.enqueue(async () => {
        let raw = null;
        if (this.session) {
          try { raw = await this.readArea(this.session); } catch (_) { raw = null; }
        }
        if (!raw && this.local) raw = await this.readArea(this.local);
        if (!raw) return null;
        try { return normalizeTaskState(raw, { forRestore: true }); }
        catch (_) {
          await this.clearUnlocked();
          return null;
        }
      });
    }

    async save(rawTask) {
      return this.enqueue(async () => {
        const task = normalizeTaskState({ ...rawTask, updatedAt: new Date().toISOString() });
        if (this.session) {
          try {
            const saved = await this.writeArea(this.session, task);
            // 避免 session 已成功时遗留的旧 local fallback 在未来被错误恢复。
            if (this.local) {
              try { await storageCall(this.local, 'remove', this.key, this.chrome); } catch (_) { /* best effort */ }
            }
            return saved;
          } catch (_) { /* local fallback */ }
        }
        if (!this.local) throw new Error('任务状态保存失败且无 local fallback');
        return this.writeArea(this.local, task);
      });
    }

    async updateTask(rawTask, updater) {
      if (typeof updater !== 'function') throw new Error('任务更新器必须是函数');
      const current = normalizeTaskState(rawTask);
      const draft = JSON.parse(JSON.stringify(current));
      const returned = updater(draft);
      const next = returned === undefined ? draft : returned;
      if (!isPlainRecord(next)) throw new Error('任务更新结果必须是普通对象');
      return this.save(next);
    }

    async updateSection(rawTask, index, patch) {
      if (!isPlainRecord(patch)) throw new Error('栏目状态补丁必须是普通对象');
      return this.updateTask(rawTask, draft => {
        const targetIndex = Number(index);
        if (!Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex >= draft.queue.length) {
          throw new Error('栏目状态索引越界');
        }
        draft.queue[targetIndex] = { ...draft.queue[targetIndex], ...patch, index: targetIndex, scanId: draft.scanId };
        return draft;
      });
    }

    async clearUnlocked() {
      const errors = [];
      for (const area of [this.session, this.local]) {
        if (!area) continue;
        try { await storageCall(area, 'remove', this.key, this.chrome); }
        catch (error) { errors.push(error); }
      }
      if (errors.length === [this.session, this.local].filter(Boolean).length) throw errors[0];
      return true;
    }

    async clear() {
      return this.enqueue(() => this.clearUnlocked());
    }

    async patch(patch) {
      if (!isPlainRecord(patch)) throw new Error('任务补丁必须是普通对象');
      return this.enqueue(async () => {
        let current = null;
        if (this.session) {
          try { current = await this.readArea(this.session); } catch (_) { current = null; }
        }
        if (!current && this.local) current = await this.readArea(this.local);
        if (!current) throw new Error('没有可更新的任务状态');
        const task = normalizeTaskState({ ...current, ...patch, updatedAt: new Date().toISOString() });
        if (this.session) {
          try {
            const saved = await this.writeArea(this.session, task);
            if (this.local) {
              try { await storageCall(this.local, 'remove', this.key, this.chrome); } catch (_) { /* best effort */ }
            }
            return saved;
          } catch (_) { /* local fallback */ }
        }
        if (!this.local) throw new Error('任务状态更新失败且无 local fallback');
        return this.writeArea(this.local, task);
      });
    }
  }

  return Object.freeze({
    FINAL_STATES,
    MAX_QUEUE_ITEMS,
    MAX_RESULTS,
    SCHEMA_VERSION,
    RESULT_STATUSES,
    TASK_STATES,
    TASK_STORAGE_KEY,
    TaskStateStore,
    cloneSerializable,
    createScanId,
    createTask,
    isPlainRecord,
    normalizeTaskState,
  });
});
