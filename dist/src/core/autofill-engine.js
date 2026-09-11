/*
 * 解放：全栏目自动填写状态机。
 * Copyright (c) 2026 zlh and contributors
 * SPDX-License-Identifier: MIT
 */
(function initAutofillEngine(root, factory) {
  const deps = {
    SectionAliases: root?.JFSectionAliases,
    FieldAliases: root?.JFFieldAliases,
    FieldDetector: root?.JFFieldDetector,
    FieldMatcher: root?.JFFieldMatcher,
    FormFiller: root?.JFFormFiller,
    ArrayHandler: root?.JFArrayHandler,
    FileFieldDetector: root?.JFFileFieldDetector,
    FileMatcher: root?.JFFileMatcher,
    FileUploadEngine: root?.JFFileUploadEngine,
    NavigationEngine: root?.JFNavigationEngine,
    PageReady: root?.JFPageReady,
    TaskState: root?.JFTaskState,
    ReportManager: root?.JFReportManager,
    SaveHandler: root?.JFSaveHandler,
    GenericAdapter: root?.JFGenericAdapter,
    AwardsAdapter: root?.JFAwardsAdapter,
    CurrentSectionResolver: root?.JFCurrentSectionResolver,
    EmbeddedSectionDetector: root?.JFEmbeddedSectionDetector,
  };
  if (typeof require === 'function') {
    const attempt = (key, path) => { try { deps[key] ||= require(path); } catch (_) { /* browser */ } };
    attempt('SectionAliases', '../mappings/section-aliases.js'); attempt('FieldAliases', '../mappings/field-aliases.js');
    attempt('FieldDetector', './field-detector.js'); attempt('FieldMatcher', './field-matcher.js'); attempt('FormFiller', './form-filler.js');
    attempt('ArrayHandler', './array-handler.js'); attempt('FileFieldDetector', './file-field-detector.js'); attempt('FileMatcher', './file-matcher.js');
    attempt('FileUploadEngine', './file-upload-engine.js'); attempt('NavigationEngine', './navigation-engine.js'); attempt('PageReady', './page-ready.js');
    attempt('TaskState', './task-state.js'); attempt('ReportManager', './report-manager.js'); attempt('SaveHandler', './save-handler.js');
    attempt('GenericAdapter', '../adapters/generic-adapter.js'); attempt('AwardsAdapter', '../adapters/undergraduate-awards.js');
    attempt('CurrentSectionResolver', './current-section-resolver.js'); attempt('EmbeddedSectionDetector', './embedded-section-detector.js');
  }
  const api = factory(root, deps);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.JFAutofillEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function autofillEngineFactory(root, D) {
  'use strict';

  const ENGINE_STATES = Object.freeze({
    IDLE: 'IDLE', SCANNING_NAVIGATION: 'SCANNING_NAVIGATION', BUILDING_QUEUE: 'BUILDING_QUEUE',
    NAVIGATING: 'NAVIGATING', WAITING_PAGE: 'WAITING_PAGE', SCANNING_FIELDS: 'SCANNING_FIELDS',
    MATCHING: 'MATCHING', PREPARING_ARRAYS: 'PREPARING_ARRAYS', FILLING: 'FILLING', VERIFYING: 'VERIFYING',
    SCANNING_FILES: 'SCANNING_FILES', MATCHING_FILES: 'MATCHING_FILES', WAITING_FILE_CONFIRMATION: 'WAITING_FILE_CONFIRMATION',
    UPLOADING: 'UPLOADING', VERIFYING_UPLOAD: 'VERIFYING_UPLOAD', SAVING: 'SAVING', NEXT_SECTION: 'NEXT_SECTION',
    PAUSED: 'PAUSED', FINISHED: 'FINISHED', ERROR: 'ERROR', STOPPED: 'STOPPED', WAITING_USER: 'WAITING_USER',
  });
  const ARRAY_SECTION_KEYS = Object.freeze({ internship: 'internships' });
  const AWARD_FALLBACK_PATHS = Object.freeze({
    time: 'awards[].date',
    location: 'awards[].location',
    content: 'awards[].name',
  });
  const REPORT_STATUS_MAP = Object.freeze({
    SUCCESS: 'success', success: 'success', SKIPPED_EMPTY: 'skipped_empty', skipped_empty: 'skipped_empty',
    SKIPPED_EXISTING: 'skipped_existing', skipped_existing: 'skipped_existing', CONFLICT: 'conflict', conflict: 'conflict',
    NEEDS_CONFIRMATION: 'needs_confirmation', manual_review: 'needs_confirmation', UNMATCHED: 'unmatched', not_found: 'unmatched',
    MISSING_JSON: 'missing_json', SKIPPED: 'skipped', skipped: 'skipped', FAILED: 'failed', failed: 'failed',
    UPLOAD_SUCCESS: 'success', UPLOAD_FAILED: 'failed', FORMAT_ERROR: 'needs_confirmation', SIZE_ERROR: 'needs_confirmation', COUNT_ERROR: 'needs_confirmation',
  });

  function randomToken(prefix) {
    try { if (root.crypto?.randomUUID) return `${prefix}_${root.crypto.randomUUID().replace(/-/g, '')}`; } catch (_) { /* fallback */ }
    return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 18)}`;
  }
  function safeString(value, max = 240) { return String(value ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max); }
  function storageGet(keys) {
    return new Promise(resolve => {
      if (!root.chrome?.storage?.local) { resolve({}); return; }
      root.chrome.storage.local.get(keys, value => resolve(value || {}));
    });
  }
  function runtimeMessage(message) {
    return new Promise((resolve, reject) => {
      if (!root.chrome?.runtime?.sendMessage) { resolve(null); return; }
      root.chrome.runtime.sendMessage(message, response => {
        const error = root.chrome.runtime.lastError;
        if (error || response?.error || response?.ok === false) reject(new Error(response?.error || error?.message || '扩展消息失败'));
        else resolve(response || null);
      });
    });
  }
  function sectionArray(view, section) {
    const key = ARRAY_SECTION_KEYS[section] || section;
    return Array.isArray(view?.[key]) ? view[key] : [];
  }
  function canonicalSectionId(section) {
    const value = safeString(section, 80);
    return ARRAY_SECTION_KEYS[value] || value;
  }
  function isArraySection(section) { return Boolean(D.FieldAliases?.ARRAY_SECTIONS?.has?.(canonicalSectionId(section))); }
  function persistentState(engineState) {
    const S = D.TaskState?.TASK_STATES || {};
    if (engineState === ENGINE_STATES.PAUSED || engineState === ENGINE_STATES.WAITING_USER) return S.PAUSED || 'paused';
    if (engineState === ENGINE_STATES.FINISHED) return S.COMPLETED || 'completed';
    if (engineState === ENGINE_STATES.ERROR) return S.FAILED || 'failed';
    if (engineState === ENGINE_STATES.STOPPED) return S.CANCELLED || 'cancelled';
    if (engineState === ENGINE_STATES.WAITING_PAGE) return S.WAITING_PAGE || 'waiting_page';
    if (engineState === ENGINE_STATES.IDLE) return S.IDLE || 'idle';
    return S.RUNNING || 'running';
  }
  function reportStatus(status) { return REPORT_STATUS_MAP[status] || REPORT_STATUS_MAP[String(status || '').toUpperCase()] || 'failed'; }

  function regionExclusionRoots(embeddedCollections = []) {
    const roots = [];
    const seen = new Set();

    const add = element => {
      if (!element || seen.has(element)) return;
      seen.add(element);
      roots.push(element);
    };

    for (const embedded of embeddedCollections || []) {
      if (embedded?.rootElement) {
        add(embedded.rootElement);
        continue;
      }
      for (const group of embedded?.groupElements || []) add(group);
    }

    return roots;
  }

  function elementInsideAnyRoot(element, roots = []) {
    if (!element) return false;
    return (roots || []).some(rootElement => {
      if (!rootElement) return false;
      try {
        return rootElement === element
          || Boolean(rootElement.contains?.(element));
      } catch (_) {
        return false;
      }
    });
  }
  function fieldLabel(descriptor, fallback) {
    return safeString(descriptor?.labelText || descriptor?.tableHeader || descriptor?.ariaLabel || descriptor?.placeholder || fallback || '未命名字段', 120);
  }
  function contextSection(context, fallback = '') {
    const value = safeString(context?.sectionId || context?.section || fallback, 80);
    return ['other', 'unknown'].includes(value.toLowerCase()) ? '' : value;
  }
  function contextCollection(context) {
    const sectionId = canonicalSectionId(contextSection(context));
    return D.SectionAliases?.collectionForSection?.(sectionId)
      || contextSection({ sectionId: context?.collection })
      || sectionId;
  }
  function queueStateForResult(result = {}) {
    const summary = result.summary || {};
    if (Number(summary.failed || 0) > 0 && Number(summary.success || 0) === 0) return 'failed';
    if (Number(summary.success || 0) > 0 && (Number(summary.manualReview || 0) + Number(summary.notFound || 0) + Number(summary.conflicts || 0) + Number(summary.failed || 0)) > 0) return 'partial';
    if (Number(summary.success || 0) > 0) return 'filled';
    return 'no_changes';
  }
  function resultStatusForReport(report = {}) {
    const statuses = D.TaskState?.RESULT_STATUSES || {};
    if (Number(report.failed || 0) > 0 && Number(report.success || 0) === 0) return statuses.FAILED || 'failed';
    if (Number(report.success || 0) > 0 && (Number(report.failed || 0) + Number(report.needsConfirmation || 0) + Number(report.missingJson || 0)) > 0) return statuses.PARTIAL || 'finished_partial';
    if (Number(report.success || 0) > 0) return statuses.SUCCESS || 'finished_success';
    return statuses.NO_CHANGES || 'finished_no_changes';
  }
  function aggregateTaskResults(results = []) {
    return (results || []).reduce((total, result) => {
      const summary = result?.summary || {};
      total.total += Number(summary.total || 0);
      total.success += Number(summary.success || 0);
      total.failed += Number(summary.failed || 0);
      total.needsConfirmation += Number(summary.manualReview || 0)
        + Number(summary.notFound || 0)
        + Number(summary.conflicts || 0);
      total.missingJson += Number(summary.missingJson || 0);
      return total;
    }, { total: 0, success: 0, failed: 0, needsConfirmation: 0, missingJson: 0 });
  }

  const PROGRESSION_BLOCKING_STATUSES = Object.freeze(new Set([
    'FAILED',
    'NEEDS_CONFIRMATION',
    'CONFLICT',
    'UNMATCHED',
    'MISSING_JSON',
  ]));

  function normalizedProgressionStatus(value) {
    const status = safeString(value, 60).toUpperCase().replace(/[\s-]+/g, '_');
    if (status === 'MANUAL_REVIEW') return 'NEEDS_CONFIRMATION';
    if (status === 'NOT_FOUND') return 'UNMATCHED';
    return status;
  }

  /**
   * Workflow-level safety gate. It consumes metadata-only field results and never
   * inspects or returns expected/current values. Action-level Safety remains the
   * final click guard; this gate decides whether leaving the current scope is
   * permitted at all.
   */
  function evaluateProgression(input = {}) {
    const navigationIntent = safeString(input.navigationIntent || 'SECTION_NAVIGATION', 40).toUpperCase();
    if (navigationIntent === 'FORM_PROGRESSION') {
      return Object.freeze({
        allowed: false,
        blockers: Object.freeze([Object.freeze({
          status: 'USER_ONLY',
          reasonCode: 'FORM_PROGRESSION_USER_ONLY',
          field: '',
          fieldName: '',
        })]),
        reasonCode: 'FORM_PROGRESSION_USER_ONLY',
      });
    }
    if (input.explicitUserSkip === true) {
      return Object.freeze({
        allowed: true,
        blockers: Object.freeze([]),
        reasonCode: 'EXPLICIT_USER_SKIP',
      });
    }

    const items = Array.isArray(input.items) ? input.items : [];
    const blockers = [];
    const addBlocker = (status, item = {}) => {
      if (blockers.length >= 100) return;
      blockers.push(Object.freeze({
        status,
        reasonCode: 'UNRESOLVED_FIELDS',
        field: safeString(item.field || item.matchedPath || '', 120),
        fieldName: safeString(item.fieldName || item.labelText || '', 120),
      }));
    };

    for (const item of items) {
      const status = normalizedProgressionStatus(item?.status);
      if (!PROGRESSION_BLOCKING_STATUSES.has(status)) continue;
      if (status === 'UNMATCHED' || status === 'MISSING_JSON') {
        const actionable = item?.actionable !== false
          && item?.visible !== false
          && item?.hidden !== true
          && item?.disabled !== true;
        if (!actionable) continue;
      }
      addBlocker(status, item);
    }

    // Persisted section summaries do not contain field values or DOM metadata.
    // They are a conservative fallback when the in-memory per-field view is gone.
    if (!items.length && input.summary && typeof input.summary === 'object') {
      const summary = input.summary;
      const counts = [
        ['FAILED', Number(summary.failed || 0)],
        ['NEEDS_CONFIRMATION', Number(summary.manualReview || 0) + Number(summary.needsConfirmation || 0)],
        ['CONFLICT', Number(summary.conflicts || 0)],
        ['UNMATCHED', Number(summary.unmatched || 0) + Number(summary.notFound || 0)],
        ['MISSING_JSON', Number(summary.missingJson || 0)],
      ];
      for (const [status, rawCount] of counts) {
        const count = Math.max(0, Math.min(100, Math.floor(rawCount || 0)));
        for (let index = 0; index < count; index += 1) addBlocker(status);
      }
    }

    return Object.freeze({
      allowed: blockers.length === 0,
      blockers: Object.freeze(blockers),
      reasonCode: blockers.length ? 'AUTO_PROGRESSION_BLOCKED' : 'SECTION_NAVIGATION_ALLOWED',
    });
  }
  function finishMessage(resultStatus, scope = 'all') {
    if (resultStatus === 'finished_success') return scope === 'current'
      ? '当前栏目已填写，请人工核对。'
      : '所有可安全处理的栏目已填写，请人工检查后自行提交。';
    if (resultStatus === 'finished_partial') return '流程执行结束：部分字段已填写，仍有字段需要人工确认。';
    if (resultStatus === 'failed') return '流程执行结束：没有成功填写字段，且存在填写失败。请查看报告与诊断。';
    return '流程执行结束，但没有填写任何字段。请查看 JSON 缺失、已有内容和人工确认项。';
  }

  function activeSiteProfile(engine) {
    const configured = engine?.siteProfile || {};
    const id = safeString(engine?.task?.siteProfileId || configured.id, 80);
    const revision = safeString(engine?.task?.siteProfileRevision || configured.revision, 128);
    return {
      matched: configured.matched === undefined ? Boolean(id) : Boolean(configured.matched && id),
      id,
      revision,
      source: safeString(configured.source || (id ? 'runtime-profile' : 'generic'), 40) || 'generic',
      resolution: safeString(configured.resolution || (id ? 'MATCHED_PROFILE' : 'GENERIC'), 80) || 'GENERIC',
    };
  }

  class AutofillEngine {
    constructor(options = {}) {
      const required = [
        'CurrentSectionResolver', 'FieldDetector', 'FieldMatcher', 'FormFiller', 'ArrayHandler',
        'NavigationEngine', 'PageReady', 'TaskState', 'ReportManager', 'GenericAdapter',
      ];
      const missing = required.filter(key => !D[key]);
      if (missing.length) throw new Error(`AutofillEngine 缺少模块：${missing.join(', ')}`);
      this.document = options.document || (typeof document !== 'undefined' ? document : null);
      if (!this.document) throw new Error('AutofillEngine 需要 document');
      this.config = options.config || {};
      const profile = this.config.siteProfile || {};
      const profileId = safeString(profile.id || this.config.profileId || this.config.id, 80);
      this.siteProfile = Object.freeze({
        matched: profile.matched === undefined ? Boolean(profileId) : Boolean(profile.matched),
        id: profileId,
        revision: safeString(profile.revision || this.config.profileRevision || this.config.revision, 128),
        source: safeString(profile.source || (profileId ? 'runtime-profile' : 'generic'), 40) || 'generic',
        resolution: safeString(profile.resolution || (profileId ? 'MATCHED_PROFILE' : 'GENERIC'), 80) || 'GENERIC',
      });
      this.adapterId = safeString(this.config.adapterId || 'generic', 80) || 'generic';
      this.adapter = options.adapter || D.GenericAdapter.createAdapter(this.document, {
        config: this.config,
        siteProfile: this.siteProfile,
      });
      this.navigation = options.navigationEngine || this.adapter.navigation;
      this.filler = options.formFiller || new D.FormFiller.FormFiller({ allowOverwrite: false, skipEmpty: true });
      this.reportManager = options.reportManager || new D.ReportManager.ReportManager();
      this.taskStore = options.taskStore || new D.TaskState.TaskStateStore({ chromeApi: root.chrome });
      this.saveHandler = options.saveHandler || D.SaveHandler?.createSaveHandler?.({
        document: this.document,
        configuredSelectors: this.config.safeSaveSelectors || this.config.save?.selectors || [],
      });
      this.callbacks = options.callbacks || {};
      this.preferences = {
        allowOverwrite: false, skipEmpty: true, autoSave: false, filePolicy: 'auto-high-confidence',
        navigationPolicy: 'automatic', ...options.preferences,
      };
      this.resume = options.resume || {};
      this.resumeView = D.FieldAliases?.buildResumeView?.(this.resume) || this.resume;
      this.materials = Array.isArray(options.materials) ? options.materials.slice(0, 500) : [];
      this.task = null;
      this.prepared = null;
      this.authorization = null;
      this.engineState = ENGINE_STATES.IDLE;
      this.currentAction = '';
      this.currentSectionRunIds = new Map();
      this.paused = false;
      this.stopped = false;
      this.skipRequested = false;
      this.pauseWaiters = [];
      this.progressionWaiters = [];
      this.progressionDecision = '';
      this.abortController = null;
      this.scanId = '';
      this.lastInspection = null;
      this.progressionState = Object.freeze({ blocked: false, reasonCode: '', blockers: Object.freeze([]) });
    }

    async refreshData() {
      const stored = await storageGet(['resumeData', 'materialLibraryIndex', 'fillPreferences', 'autofillPreferences']);
      this.resume = stored.resumeData || this.resume || {};
      this.resumeView = D.FieldAliases?.buildResumeView?.(this.resume) || this.resume;
      this.materials = Array.isArray(stored.materialLibraryIndex) ? stored.materialLibraryIndex.slice(0, 500) : this.materials;
      this.preferences = { ...this.preferences, ...(stored.fillPreferences || {}), ...(stored.autofillPreferences || {}) };
      return { resume: this.resume, resumeView: this.resumeView, materials: this.materials, preferences: this.preferences };
    }

    snapshot() {
      const activeScanId = this.task?.scanId || this.prepared?.scanId || this.scanId || '';
      const siteProfile = activeSiteProfile(this);
      const queue = (this.task?.queue || this.prepared?.queue || []).map((item, index) => ({
        ...item,
        status: item.state === 'filled' ? 'FILLED'
          : item.state === 'partial' ? 'PARTIAL'
            : item.state === 'no_changes' ? 'NO_CHANGES'
              : item.state === 'running' ? 'RUNNING'
                : item.state === 'failed' || item.state === 'error' ? 'FAILED'
                  : item.state === 'skipped' ? 'SKIPPED'
                    : item.state === 'review' ? 'NEEDS_CONFIRMATION' : 'PENDING',
        summary: this.task?.results?.find(result => result.sectionId === item.sectionId && result.scanId === activeScanId)?.summary
          ? `${this.task.results.find(result => result.sectionId === item.sectionId && result.scanId === activeScanId).summary.success || 0}/${this.task.results.find(result => result.sectionId === item.sectionId && result.scanId === activeScanId).summary.total || 0}` : '',
      }));
      return {
        taskId: this.task?.taskId || this.prepared?.taskId || '', state: this.engineState,
        scanId: activeScanId,
        resultStatus: this.task?.resultStatus || '',
        siteProfileId: siteProfile.id,
        siteProfileRevision: siteProfile.revision,
        siteProfile,
        currentIndex: this.task?.currentIndex ?? 0, currentSectionLabel: queue[this.task?.currentIndex ?? 0]?.label || '',
        currentAction: this.currentAction, systemName: safeString(this.document.title, 100) || '当前报名系统',
        progressionBlocked: Boolean(this.progressionState?.blocked),
        progressionReasonCode: safeString(this.progressionState?.reasonCode, 80),
        progressionBlockers: Array.isArray(this.progressionState?.blockers)
          ? this.progressionState.blockers.map(item => ({ ...item }))
          : [],
        sectionQueue: queue, results: this.task?.results || [],
      };
    }

    async setState(state, action = '', persist = true) {
      this.engineState = state;
      this.currentAction = safeString(action, 300);
      // Read-only scans use persist=false and must not mutate or resurrect an older
      // persisted task. Every persisted transition replaces this.task atomically.
      if (this.task && persist) {
        try {
          this.task = await this.commitTask(draft => {
            draft.state = persistentState(state);
            draft.paused = state === ENGINE_STATES.PAUSED || state === ENGINE_STATES.WAITING_USER;
            return draft;
          });
        } catch (error) { this.callbacks.onLog?.(`任务状态保存失败：${error.message}`); }
      }
      this.callbacks.onState?.(this.snapshot());
    }

    async commitTask(updater) {
      if (!this.task) return null;
      if (typeof this.taskStore.updateTask === 'function') return this.taskStore.updateTask(this.task, updater);
      const draft = JSON.parse(JSON.stringify(this.task));
      const next = updater(draft) || draft;
      return this.taskStore.save(next);
    }

    async updateQueueItem(index, patch, persist = true) {
      if (!this.task?.queue?.[index]) return null;
      const apply = draft => {
        draft.queue[index] = { ...draft.queue[index], ...patch, index, scanId: draft.scanId };
        return draft;
      };
      if (!persist) {
        const next = apply(JSON.parse(JSON.stringify(this.task)));
        this.task = D.TaskState.normalizeTaskState(next);
        return this.task.queue[index];
      }
      this.task = typeof this.taskStore.updateSection === 'function'
        ? await this.taskStore.updateSection(this.task, index, patch)
        : await this.commitTask(apply);
      return this.task.queue[index];
    }

    async settleActiveQueueOnError(error, fallbackIndex = 0) {
      const index = Math.max(0, Math.min(this.task?.queue?.length ? this.task.queue.length - 1 : 0, Number(this.task?.currentIndex ?? fallbackIndex) || 0));
      const current = this.task?.queue?.[index];
      if (!current) return;
      const stopped = this.stopped || error?.name === 'AbortError';
      this.task = await this.commitTask(draft => {
        const sectionId = draft.queue[index].sectionId;
        draft.queue[index].state = stopped ? 'skipped' : 'failed';
        if (!stopped) draft.resultStatus = D.TaskState.RESULT_STATUSES?.FAILED || 'failed';
        if (!draft.results.some(result => result.sectionId === sectionId && result.scanId === draft.scanId)) {
          draft.results.push({
            sectionId,
            scanId: draft.scanId,
            status: stopped ? 'manual_review' : 'failed',
            reasonCode: stopped ? 'TASK_STOPPED' : 'SECTION_EXECUTION_FAILED',
            summary: stopped ? { total: 1, manualReview: 1 } : { total: 1, failed: 1 },
            finishedAt: new Date().toISOString(),
            attempts: draft.queue[index].attempts,
          });
        }
        return draft;
      });
    }

    async inspectSystem(options = {}) {
      try {
        await this.refreshData();
        const scanId = options.scanId || D.TaskState.createScanId();
        this.scanId = scanId;
        await this.setState(ENGINE_STATES.SCANNING_NAVIGATION, '正在扫描报名系统栏目…', false);
        const rawScan = this.navigation.scan();
        const scan = rawScan.map(item => ({ ...item, scanId }));
        await this.setState(ENGINE_STATES.BUILDING_QUEUE, `识别到 ${scan.length} 个候选栏目…`, false);
        const preliminaryQueue = this.navigation.buildQueue(rawScan);
        const adapterResult = this.adapter.detectCurrentSection();
        let rootNode = this.adapter.findContentRoot(adapterResult.section);
        await D.PageReady?.waitForFormReady?.({
          document: this.document,
          root: rootNode,
          timeoutMs: options.timeoutMs || 5_000,
          stableForMs: 300,
          signal: options.signal,
        });
        const unscopedFields = this.adapter.scanFields(adapterResult.section, rootNode)
          .map(field => ({ ...field, scanId }));
      // Page-level section evidence must be evaluated against the same embedded
      // topology snapshot that is later used to build runtime region contexts.
      // This is a read-only ownership boundary: fields contained by these roots
      // may describe their embedded collection, but cannot vote for the page.
      const embeddedDetected = (
        D.EmbeddedSectionDetector?.scan?.(this.document)
        || D.EmbeddedSectionDetector?.detect?.(this.document)
        || []
      );
      const resolved = D.CurrentSectionResolver?.resolve?.({
        document: this.document,
        navigationItems: scan,
        navigationEngine: this.navigation,
        fields: unscopedFields,
        embeddedRegions: embeddedDetected,
        rootNode,
        adapterResult,
      }) || {
        sectionId: adapterResult.section || null,
        source: adapterResult.source || 'adapter',
        confidence: Number(adapterResult.score || 0),
        collection: adapterResult.section || null,
        collectionMode: isArraySection(adapterResult.section) ? 'array' : 'record',
        indexContext: null,
        trace: [],
      };
      const resolvedCollection = contextCollection(resolved);
      // 通用嵌入式栏目检测：支持同页包含外语、科研、论文、奖励等多个区域。
      if (embeddedDetected.length) {
        const bySection = new Map();

        [
          ...(resolved.regionCandidates || []),
          ...embeddedDetected.filter(item =>
            !resolvedCollection || contextCollection(item) !== resolvedCollection
          ),
        ].forEach(candidate => {
          if (!candidate?.sectionId) return;

          const sectionId =
            canonicalSectionId(
              candidate.sectionId
            );

          const collection =
            D.SectionAliases
              ?.collectionForSection?.(sectionId)
            || candidate.collection
            || sectionId;
          if (resolvedCollection && collection === resolvedCollection) return;

          /*
           * internship / internships 等同义 section
           * 按 collection 去重，避免同一 DOM 被执行两次。
           */
          const key = collection;
          const previous = bySection.get(key);

          if (!previous || Number(candidate.confidence || 0) > Number(previous.confidence || 0)) {
            bySection.set(key, {
              sectionId,
              source: candidate.source || 'embedded-structure',
              confidence: Number(candidate.confidence || 0.8),
              collection,
              collectionMode: candidate.collectionMode || 'repeatable',
            });
          }
        });

        resolved.regionCandidates = [...bySection.values()];
      }

      const sectionId = contextSection(resolved);
      const activeItem = scan.find(item => item.sectionId === sectionId && item.active)
        || scan.find(item => item.sectionId === sectionId);
      const label = safeString(activeItem?.text || activeItem?.label
        || (adapterResult.section === sectionId ? adapterResult.label : '')
        || D.SectionAliases?.SECTION_ALIASES?.[sectionId]?.[0]
        || this.document.title, 160);
      if (sectionId && adapterResult.section !== sectionId) rootNode = this.adapter.findContentRoot(sectionId);
      const hasAddButton = sectionId && D.ArrayHandler?.findAddButton?.(rootNode, sectionId, this.config?.sections?.[sectionId] || {});
      const sectionContext = {
        ...resolved,
        sectionId: sectionId || null,
        label,
        scanId,
        collectionMode: resolved.collectionMode === 'array'
          ? (hasAddButton ? 'repeatable' : sectionId === 'education' ? 'singleton-view' : 'array')
          : resolved.collectionMode,
      };
      const embeddedRuntimeRoots =
        regionExclusionRoots(
          embeddedDetected
            .filter(candidate =>
              !resolvedCollection || contextCollection(candidate) !== resolvedCollection
            )
            .map(candidate => ({ rootElement: candidate.runtimeRoot }))
        );

      const fields = this.adapter
        .scanFields(sectionId, rootNode)
        .filter(field => !elementInsideAnyRoot(field?.element, embeddedRuntimeRoots))
        .map(field => ({ ...field, scanId }));
      const matches = D.FieldMatcher.matchFields(fields, this.resume, {
        section: sectionId,
        sectionContext,
        resumeView: this.resumeView,
        fieldAliases: this.config.fieldAliases,
      }).map(match => ({ ...match, scanId }));
      const queue = preliminaryQueue.map(item => ({
        ...item,
        scanId,

        sectionSource:
          item.active && item.sectionId === sectionId
            ? 'navigation'
            : 'navigation',

        collection:
          D.SectionAliases?.collectionForSection?.(item.sectionId)
          || item.sectionId,

        collectionMode:
          D.SectionAliases?.collectionModeForSection?.(item.sectionId)
          || 'unknown',

        indexContext: false,

        regionCandidates:
          item.sectionId === sectionId
            ? (sectionContext.regionCandidates || [])
            : [],
      }));
      const reliableFieldCount = matches.filter(match => match.status === 'MATCHED').length;
      await this.setState(ENGINE_STATES.IDLE, `已识别 ${queue.length} 个栏目，当前页面有 ${reliableFieldCount} 个可可靠匹配字段。`, false);
      const current = {
        section: sectionContext.sectionId,
        sectionId: sectionContext.sectionId,
        label,
        score: sectionContext.confidence,
        source: sectionContext.source,
        candidates: [],
      };
      const inspection = { scanId, scan, queue, current, sectionContext, fields, matches, reliableFieldCount };
        this.lastInspection = inspection;
        return inspection;
      } catch (error) {
        const action = '扫描失败，已停止本次识别；可以重新扫描。';
        try {
          await this.setState(ENGINE_STATES.ERROR, action, false);
        } catch (_) {
          // State callbacks are host integration code. They must not mask the
          // original scan failure or leave the engine in a non-resettable state.
          this.engineState = ENGINE_STATES.ERROR;
          this.currentAction = action;
        }
        throw error;
      }
    }

    async prepareRun(scope = 'all') {
      const inspection = await this.inspectSystem();
      let queue = inspection.queue;
      if (scope === 'current') {
        const section = inspection.sectionContext?.sectionId || inspection.current.section || 'other';
        const existing = queue.find(item => item.sectionId === section);
        const currentItem = existing || {
          id: section, sectionId: section, label: inspection.current.label || '当前栏目', index: 0,
          state: 'current', confidence: inspection.current.score || 0, passiveOnly: false, reasonCode: inspection.sectionContext?.source === 'field-signature' ? 'FIELD_SIGNATURE_FALLBACK' : 'CURRENT_DOM_FIELDS', requiresUserAction: false,
        };
        queue = [{
          ...currentItem,

          scanId: inspection.scanId,

          sectionSource:
            inspection.sectionContext?.source
            || currentItem.sectionSource
            || 'unknown',

          collection:
            inspection.sectionContext?.collection
            || currentItem.collection
            || section,

          collectionMode:
            inspection.sectionContext?.collectionMode
            || currentItem.collectionMode
            || (isArraySection(section) ? 'array' : 'record'),

          indexContext:
            Boolean(inspection.sectionContext?.indexContext),

          regionCandidates:
            inspection.sectionContext?.regionCandidates || [],
        }];
      }

      /*
      * 部分高校页面没有侧边导航，
      * NavigationEngine 无法生成栏目队列。
      *
      * 但 CurrentSectionResolver 已经可靠识别当前页面：
      * basic / education / family 等。
      *
      * 此时允许当前页面作为执行栏目。
      */
      if (!queue.length) {
        const currentSection =
          inspection.sectionContext
          || inspection.section
          || null;

        const sectionId =
          currentSection?.sectionId
          || currentSection?.detected
          || '';

        const confidence =
          Number(
            currentSection?.confidence
            || 0
          );

        if (
          sectionId
          &&
          !['unknown', 'other']
            .includes(
              String(sectionId)
                .toLowerCase()
            )
          &&
          confidence >= 0.8
        ) {
          queue.push({
            id: sectionId,

            sectionId,

            label:
              currentSection.title
              || (
                sectionId === 'basic'
                  ? '个人信息'
                  : sectionId
              ),

            index: 0,

            confidence,

            sectionSource:
              currentSection.source
              || 'current-section-fallback',

            collection:
              currentSection.collection
              || sectionId,

            collectionMode:
              currentSection.collectionMode
              || 'record',

            indexContext:
              Boolean(
                currentSection.indexContext
              ),

            regionCandidates:
              currentSection.regionCandidates
              || [],
          });
        }
      }

      if (!queue.length) throw new Error('没有识别到可执行栏目；请在报名表页面运行诊断');
      queue = queue.map((item, index) => ({ ...item, index, scanId: inspection.scanId }));
      const task = D.TaskState.createTask({
        scanId: inspection.scanId,
        queue,
        state: D.TaskState.TASK_STATES.QUEUED,
        origin: this.document.location?.origin || '',
        adapterId: this.adapterId,
        profileRevision: this.siteProfile.revision,
        siteProfileId: this.siteProfile.id,
        siteProfileRevision: this.siteProfile.revision,
      });
      const resumeStats = {};
      queue.forEach(item => {
        const value = sectionArray(this.resumeView, item.sectionId);
        resumeStats[item.sectionId] = Array.isArray(value) ? value.length : item.sectionId === 'basic' || item.sectionId === 'contact' ? 1 : 0;
      });
      const previewMaterials = (Array.isArray(this.materials) ? this.materials : []).slice(0, 100);
      const materialIds = previewMaterials.map(item => item.id).filter(id => /^file_[\w-]+$/i.test(String(id))).slice(0, 100);
      const materialConfirmations = previewMaterials
        .filter(item => materialIds.includes(item.id))
        .map(item => ({ id: item.id, hash: item.hash || '', size: Number(item.size) || 0 }))
        .slice(0, 100);
      this.prepared = {
        scope, taskId: task.taskId, scanId: inspection.scanId, queue, task, materialIds, materialConfirmations, resumeStats,
        sectionContext: inspection.sectionContext,
        preview: {
          sectionCount: queue.length,
          sections: queue.map(item => ({ sectionId: item.sectionId, label: item.label, itemCount: resumeStats[item.sectionId] || 0, passiveOnly: item.passiveOnly })),
          materials: previewMaterials.map(item => ({ id: item.id, name: item.name, category: item.category, size: item.size })),
          safeSaveEnabled: Boolean(this.preferences.autoSave),
          finalSubmitBlocked: true,
        },
      };
      return this.prepared;
    }

    async authorizeRun(prepared = this.prepared) {
      if (!prepared?.taskId || !prepared.queue?.length) throw new Error('没有可授权的预览任务');
      const nonce = randomToken('run');
      const authorization = {
        taskId: prepared.taskId, scanId: prepared.scanId, nonce, userConfirmed: true,
        allowedSectionIds: prepared.queue.filter(item => !item.passiveOnly).map(item => item.sectionId),
        allowSafeSave: Boolean(this.preferences.autoSave),
        filePolicy: this.preferences.filePolicy === 'ask-every-time' ? 'ask-every-time' : 'auto-high-confidence',
        expiresAt: Date.now() + 30 * 60_000,
      };
      if (prepared.materialIds.length && this.preferences.filePolicy === 'auto-high-confidence') {
        await runtimeMessage({
          type: 'AUTHORIZE_FILE_UPLOADS',
          taskId: authorization.taskId,
          nonce,
          userConfirmed: true,
          confirmationMode: 'preview-batch',
          materialIds: prepared.materialIds,
          previewedMaterialIds: prepared.materialIds,
          materials: prepared.materialConfirmations || [],
          expiresAt: authorization.expiresAt,
        });
      }
      this.authorization = authorization;
      return authorization;
    }

    validAuthorization(prepared, authorization) {
      const allowed = prepared?.queue?.filter(item => !item.passiveOnly).map(item => item.sectionId) || [];
      return Boolean(
        prepared?.taskId
        && authorization?.taskId === prepared.taskId
        && authorization?.scanId === prepared.scanId
        && authorization.userConfirmed === true
        && Number(authorization.expiresAt) > Date.now()
        && /^[a-z0-9_-]{16,200}$/i.test(String(authorization.nonce || ''))
        && ['auto-high-confidence', 'ask-every-time'].includes(authorization.filePolicy)
        && Array.isArray(authorization.allowedSectionIds)
        && authorization.allowedSectionIds.length === allowed.length
        && allowed.every(sectionId => authorization.allowedSectionIds.includes(sectionId))
      );
    }

    async runAll(options = {}) {
      const prepared = options.prepared || this.prepared || await this.prepareRun('all');
      const authorization = options.authorization || this.authorization;
      if (!this.validAuthorization(prepared, authorization)) throw new Error('必须先核对预览并确认本次填写任务');
      this.prepared = prepared; this.authorization = authorization; this.task = prepared.task;
      this.abortController = new AbortController(); this.paused = false; this.stopped = false; this.skipRequested = false;
      this.progressionDecision = '';
      this.progressionState = Object.freeze({ blocked: false, reasonCode: '', blockers: Object.freeze([]) });
      try {
        this.task = await this.commitTask(draft => {
          draft.state = D.TaskState.TASK_STATES.RUNNING;
          draft.resultStatus = '';
          draft.results = [];
          draft.queue = draft.queue.map(item => ({ ...item, state: 'pending' }));
          return draft;
        });
        await this.setState(ENGINE_STATES.SCANNING_NAVIGATION, '任务已确认，正在建立栏目队列…');
        for (let index = 0; index < this.task.queue.length; index += 1) {
          await this.waitIfPaused();
          if (this.stopped) break;
          this.task = await this.commitTask(draft => { draft.currentIndex = index; return draft; });
          const sectionId = this.task.queue[index].sectionId;
          const label = this.task.queue[index].label;
          const passiveOnly = this.task.queue[index].passiveOnly;
          if (passiveOnly || !authorization.allowedSectionIds.includes(sectionId)) {
            const skippedResult = {
              sectionId,
              scanId: this.task.scanId,
              status: 'manual_review',
              reasonCode: this.task.queue[index].reasonCode || 'UNSAFE_NAVIGATION',
              summary: { total: 0, manualReview: 1 },
              finishedAt: new Date().toISOString(), attempts: 0,
            };
            this.task = await this.commitTask(draft => {
              draft.queue[index].state = 'skipped';
              draft.results = [...draft.results.filter(result => result.sectionId !== sectionId), skippedResult];
              return draft;
            });
            continue;
          }
          await this.updateQueueItem(index, { state: 'running', attempts: Number(this.task.queue[index].attempts || 0) + 1 });
          await this.setState(ENGINE_STATES.NAVIGATING, `正在进入“${label}” (${index + 1}/${this.task.queue.length})…`);
          const liveNavigation =
            this.navigation.scan();

          const active =
            liveNavigation.find(
              nav =>
                nav.sectionId === sectionId
                && nav.active
            );


          /*
          * 某些高校 SPA 不提供可识别的栏目导航。
          *
          * navigation = []
          * 但 CurrentSectionResolver 已经通过
          * 当前真实可见字段确认：
          *
          * education / field-signature / 0.896
          *
          * 如果当前任务就是刚刚诊断出的当前页面，
          * 不应该再尝试 navigation.navigate()。
          */
          const inspectedContext =
            this.lastInspection
              ?.sectionContext
            || null;

          const alreadyOnCurrentSection =
            Boolean(
              !active

              && liveNavigation.length === 0

              && inspectedContext

              && this.lastInspection?.scanId
                === this.task.scanId

              && inspectedContext.sectionId
                === sectionId

              && Number(
                inspectedContext.confidence
                || 0
              ) >= 0.8

              && this.task.queue.length === 1

              && this.task.queue[index]
                .sectionSource !== 'navigation'
            );


          if (alreadyOnCurrentSection) {
            this.callbacks.onLog?.(
              `[栏目] 当前 DOM 已确认是 ${sectionId}`
              + `（${inspectedContext.source}, `
              + `${Number(
                inspectedContext.confidence
                || 0
              ).toFixed(3)}），跳过导航`
            );
          }


          if (
            !active
            && !alreadyOnCurrentSection
          ) {
            if (
              this.preferences.navigationPolicy
                === 'confirm-each'
            ) {
              const confirmedSection =
                await this.callbacks
                  .requestSectionConfirmation?.({
                    sectionId,
                    label,
                    index,
                    total:
                      this.task.queue.length,
                  });

              if (
                confirmedSection !== true
                && confirmedSection
                  !== sectionId
              ) {
                const skippedResult = {
                  sectionId,
                  scanId:
                    this.task.scanId,
                  status:
                    'manual_review',
                  reasonCode:
                    'SECTION_NAVIGATION_NOT_CONFIRMED',

                  summary: {
                    total: 0,
                    manualReview: 1,
                  },

                  finishedAt:
                    new Date().toISOString(),

                  attempts:
                    this.task.queue[index]
                      .attempts,
                };

                this.task =
                  await this.commitTask(
                    draft => {
                      draft.queue[index]
                        .state = 'skipped';

                      draft.results = [
                        ...draft.results.filter(
                          result =>
                            result.sectionId
                            !== sectionId
                        ),

                        skippedResult,
                      ];

                      return draft;
                    }
                  );

                continue;
              }
            }


            const navigation =
              await this.navigation.navigate(
                sectionId,
                {
                  runAuthorization:
                    authorization,

                  timeoutMs: 10_000,

                  signal:
                    this.abortController
                      .signal,
                }
              );


            if (!navigation.ok) {
              throw new Error(
                `进入“${label}”失败：`
                + navigation.code
              );
            }
          }
          await this.setState(ENGINE_STATES.WAITING_PAGE, `等待“${label}”表单稳定…`);
          await D.PageReady?.waitForFormReady?.({
            document: this.document,
            root: this.adapter.findContentRoot(sectionId),
            timeoutMs: 10_000,
            stableForMs: 350,
            signal: this.abortController.signal,
          });
          if (this.skipRequested) {
            this.skipRequested = false;
            await this.updateQueueItem(index, { state: 'skipped' });
            continue;
          }
          const sectionContext = {
            sectionId,
            source: this.task.queue[index].sectionSource || 'navigation',
            confidence: this.task.queue[index].confidence,
            collection: this.task.queue[index].collection || sectionId,
            collectionMode: this.task.queue[index].collectionMode,
            indexContext: null,
            regionCandidates:
             this.task.queue[index].regionCandidates || [],
            scanId: this.task.scanId,
          };
          const result = await this.runSection(sectionId, { label, authorization, sectionContext });
          if (this.skipRequested) {
            this.skipRequested = false;
            this.task = await this.commitTask(draft => {
              draft.queue[index].state = 'skipped';
              draft.results = [...draft.results.filter(existing => existing.sectionId !== sectionId), { ...result.persistent, scanId: draft.scanId }];
              return draft;
            });
            await this.setState(ENGINE_STATES.NEXT_SECTION, `已按要求跳过“${label}”剩余字段，准备下一栏目…`);
            continue;
          }
          const progression = evaluateProgression({
            items: result.view?.items,
            summary: result.persistent?.summary,
            navigationIntent: 'SECTION_NAVIGATION',
          });
          const hasNextSection = index + 1 < this.task.queue.length;
          if (!progression.allowed && hasNextSection) {
            const blockedPersistent = {
              ...result.persistent,
              status: 'manual_review',
              reasonCode: 'AUTO_PROGRESSION_BLOCKED',
            };
            this.progressionState = Object.freeze({
              blocked: true,
              reasonCode: progression.reasonCode,
              blockers: progression.blockers,
            });
            this.task = await this.commitTask(draft => {
              draft.queue[index].state = 'review';
              draft.results = [
                ...draft.results.filter(existing => existing.sectionId !== sectionId),
                { ...blockedPersistent, scanId: draft.scanId },
              ];
              return draft;
            });
            this.callbacks.onLog?.(
              `[流程] AUTO_PROGRESSION_BLOCKED：当前栏目仍有 ${progression.blockers.length} 项未解决；`
              + '未切换栏目。你可人工处理，或明确点击“跳过栏目”后重新执行。'
            );
            await this.setState(
              ENGINE_STATES.WAITING_USER,
              `当前栏目仍有 ${progression.blockers.length} 项未解决，已阻止自动离页。`,
            );
            // stop/skip may arrive while the blocked result or WAITING_USER state is
            // being persisted. Keep the decision in a one-shot slot so that a user
            // action cannot be lost before the Promise waiter is registered.
            const decision = this.progressionDecision
              || await new Promise(resolve => this.progressionWaiters.push(resolve));
            this.progressionDecision = '';
            if (this.stopped || decision === 'stop') {
              throw new DOMException('任务已停止', 'AbortError');
            }
            if (decision !== 'skip') break;
            this.skipRequested = false;
            this.progressionState = Object.freeze({
              blocked: false,
              reasonCode: 'EXPLICIT_USER_SKIP',
              blockers: Object.freeze([]),
            });
            this.task = await this.commitTask(draft => {
              draft.queue[index].state = 'skipped';
              draft.results = [
                ...draft.results.filter(existing => existing.sectionId !== sectionId),
                {
                  ...blockedPersistent,
                  scanId: draft.scanId,
                  reasonCode: 'EXPLICIT_USER_SKIP',
                },
              ];
              return draft;
            });
            this.callbacks.onLog?.(`[流程] 用户已明确跳过“${label}”，允许继续到下一安全栏目。`);
            await this.setState(ENGINE_STATES.NEXT_SECTION, `已明确跳过“${label}”，准备下一栏目…`);
            continue;
          }
          this.task = await this.commitTask(draft => {
            draft.queue[index].state = queueStateForResult(result.persistent);
            draft.results = [...draft.results.filter(existing => existing.sectionId !== sectionId), { ...result.persistent, scanId: draft.scanId }];
            return draft;
          });
          await this.setState(ENGINE_STATES.NEXT_SECTION, `“${label}”处理完成，准备下一栏目…`);
        }
        if (this.stopped) {
          await this.setState(ENGINE_STATES.STOPPED, '任务已停止；未执行最终提交。');
        } else if (!this.progressionState?.blocked) {
          const aggregate = aggregateTaskResults(this.task.results.filter(result => result.scanId === this.task.scanId));
          const finalStatus = resultStatusForReport(aggregate);
          this.task = await this.commitTask(draft => {
            draft.completedAt = new Date().toISOString();
            draft.resultStatus = finalStatus;
            return draft;
          });
          await this.setState(ENGINE_STATES.FINISHED, finishMessage(finalStatus, 'all'));
        }
        this.callbacks.onReport?.(this.getReport());
        return this.getReport();
      } catch (error) {
        await this.settleActiveQueueOnError(error);
        if (this.stopped || error?.name === 'AbortError') await this.setState(ENGINE_STATES.STOPPED, '任务已停止；未执行最终提交。');
        else await this.setState(ENGINE_STATES.ERROR, `任务暂停：${safeString(error?.message || error)}。请诊断当前栏目。`);
        this.callbacks.onError?.(error, this.snapshot());
        return this.getReport();
      } finally {
        this.saveHandler?.invalidate?.();
        const endingAuthorization = this.authorization;
        this.authorization = null;
        if (endingAuthorization?.nonce) {
          await runtimeMessage({ type: 'REVOKE_FILE_UPLOAD_AUTH', taskId: endingAuthorization.taskId, nonce: endingAuthorization.nonce }).catch(() => undefined);
        }
      }
    }

    async runCurrent(options = {}) {
      const prepared = options.prepared || await this.prepareRun('current');
      const authorization = options.authorization || this.authorization;
      if (!this.validAuthorization(prepared, authorization)) throw new Error('必须先核对预览并确认填写当前栏目');
      this.prepared = prepared; this.authorization = authorization; this.task = prepared.task;
      this.abortController = new AbortController(); this.stopped = false; this.paused = false;
      this.progressionState = Object.freeze({ blocked: false, reasonCode: '', blockers: Object.freeze([]) });
      try {
        this.task = await this.commitTask(draft => {
          draft.state = D.TaskState.TASK_STATES.RUNNING;
          draft.results = [];
          draft.queue[0].state = 'running';
          draft.queue[0].attempts = Number(draft.queue[0].attempts || 0) + 1;
          return draft;
        });
        const sectionId = this.task.queue[0].sectionId;
        const label = this.task.queue[0].label;
        const sectionContext = {
          sectionId,
          source: this.task.queue[0].sectionSource,
          confidence: this.task.queue[0].confidence,
          collection: this.task.queue[0].collection || sectionId,
          collectionMode: this.task.queue[0].collectionMode,
          indexContext: null,
          regionCandidates:
            this.task.queue[0].regionCandidates
            || this.prepared?.sectionContext?.regionCandidates
            || [],
          scanId: this.task.scanId,
        };
        const result = await this.runSection(sectionId, { label, authorization, sectionContext });
        const queueState = this.skipRequested ? 'skipped' : queueStateForResult(result.persistent);
        this.skipRequested = false;
        const aggregate = aggregateTaskResults([result.persistent]);
        const finalStatus = resultStatusForReport(aggregate);
        this.task = await this.commitTask(draft => {
          draft.results = [{ ...result.persistent, scanId: draft.scanId }];
          draft.queue[0].state = queueState;
          draft.completedAt = new Date().toISOString();
          draft.resultStatus = finalStatus;
          return draft;
        });
        await this.setState(ENGINE_STATES.FINISHED, finishMessage(finalStatus, 'current'));
        this.callbacks.onReport?.(this.getReport());
        return this.getReport();
      } catch (error) {
        await this.settleActiveQueueOnError(error, 0);
        if (this.stopped || error?.name === 'AbortError') await this.setState(ENGINE_STATES.STOPPED, '任务已停止；未执行最终提交。');
        else await this.setState(ENGINE_STATES.ERROR, `当前栏目暂停：${safeString(error?.message || error)}。请运行诊断。`);
        this.callbacks.onError?.(error, this.snapshot());
        return this.getReport();
      } finally {
        this.saveHandler?.invalidate?.();
        this.authorization = null;
        if (authorization?.nonce) {
          await runtimeMessage({ type: 'REVOKE_FILE_UPLOAD_AUTH', taskId: authorization.taskId, nonce: authorization.nonce }).catch(() => undefined);
        }
      }
    }

    scanLiveEmbeddedCandidates() {
      return (
        D.EmbeddedSectionDetector?.scan?.(this.document)
        || D.EmbeddedSectionDetector?.detect?.(this.document)
        || []
      );
    }

    liveEmbeddedCandidatesFor(sectionId, collection, detected = null) {
      const live = Array.isArray(detected)
        ? detected
        : AutofillEngine.prototype.scanLiveEmbeddedCandidates.call(this);
      return live.filter(candidate => {
        const candidateSection = canonicalSectionId(contextSection(candidate));
        const candidateCollection =
          D.SectionAliases?.collectionForSection?.(candidateSection)
          || contextSection({ sectionId: candidate.collection })
          || candidateSection;
        return candidateCollection === collection || candidateSection === sectionId;
      });
    }

    resolveEmbeddedCollectionBinding(rootNode, sectionId, collection, detected = null) {
      const live = Array.isArray(detected)
        ? detected
        : AutofillEngine.prototype.scanLiveEmbeddedCandidates.call(this);
      const matches = AutofillEngine.prototype.liveEmbeddedCandidatesFor.call(
        this,
        sectionId,
        collection,
        live,
      );
      if (matches.length !== 1) {
        return {
          ok: false,
          reasonCode: matches.length
            ? 'EMBEDDED_SECTION_TOPOLOGY_AMBIGUOUS'
            : 'EMBEDDED_SECTION_TOPOLOGY_MISSING',
          error: matches.length
            ? `当前页面存在 ${matches.length} 个“${sectionId}”结构区域，无法安全确定新增目标`
            : `当前页面已找不到“${sectionId}”的实时结构区域`,
          matches,
          embeddedRegions: live,
        };
      }

      const candidate = matches[0];
      const anchor = candidate.runtimeRoot || candidate.root || null;
      if (!anchor || anchor.isConnected === false) {
        return {
          ok: false,
          reasonCode: 'EMBEDDED_SECTION_TOPOLOGY_STALE',
          error: `“${sectionId}”结构区域已失效，请重新识别页面`,
          matches,
          embeddedRegions: live,
        };
      }

      const searchRoot = rootNode?.contains?.(anchor) || rootNode === anchor
        ? rootNode
        : this.document;
      const actionConfig = this.config?.sections?.[sectionId]
        || this.config?.sections?.[collection]
        || {};
      const detectedRoot = D.ArrayHandler.detectSectionRoot?.(
        searchRoot,
        sectionId,
        { ...actionConfig, embeddedRegions: live },
      ) || null;
      const addRoot = detectedRoot
        && (
          detectedRoot === anchor
          || detectedRoot.contains?.(anchor)
          || anchor.contains?.(detectedRoot)
        )
        ? detectedRoot
        : anchor;
      const resolvedActionOwner = addRoot !== anchor ? addRoot : null;
      // The embedded table/region and the maximum ancestor search boundary
      // are separate facts. In particular, an unresolved table fallback must
      // not trap later diagnosis/execution at depth 0.
      const actionSearchBoundary = searchRoot === anchor
        ? this.document
        : searchRoot;

      return {
        ok: true,
        candidate,
        anchor,
        collectionRoot: anchor,
        addRoot,
        resolvedActionOwner,
        actionSearchBoundary,
        searchRoot,
        embeddedRegions: live,
      };
    }

    async prepareEmbeddedCollections(
      rootNode,
      pageSectionContext,
      authorization,
      runId,
    ) {
      const candidates = Array.isArray(
        pageSectionContext?.regionCandidates
      )
        ? pageSectionContext.regionCandidates
        : [];

      const results = [];

      const seenCollections = new Set();

      const bindLiveRegion = (sectionId, collection) =>
        AutofillEngine.prototype.resolveEmbeddedCollectionBinding.call(
          this,
          rootNode,
          sectionId,
          collection,
        );

      for (const candidate of candidates) {
        const sectionId =
          canonicalSectionId(
            contextSection(candidate)
          );

        if (!sectionId || !isArraySection(sectionId)) {
          continue;
        }

        const collection =
          D.SectionAliases?.collectionForSection?.(sectionId)
          || contextSection({
            sectionId: candidate.collection,
          })
          || sectionId;

        if (seenCollections.has(collection)) {
          continue;
        }
        seenCollections.add(collection);

        const items = sectionArray(
          this.resumeView,
          collection,
        );

        /*
        * JSON 没有这一数组的数据时，不自动新增。
        * 页面已有内容继续交给用户人工处理。
        */
        if (!items.length) {
          continue;
        }

        const initialBinding = bindLiveRegion(sectionId, collection);
        if (!initialBinding.ok) {
          this.record(runId, {
            field: `${collection}[]`,
            fieldName: sectionId,
            status: 'NEEDS_CONFIRMATION',
            reason: initialBinding.error,
            reasonCode: initialBinding.reasonCode,
          });
          continue;
        }

        const sectionConfig =
          this.config?.sections?.[sectionId]
          || this.config?.sections?.[collection]
          || {};

        const sectionTable = initialBinding.anchor?.matches?.('table,[role="table"]')
          ? initialBinding.anchor
          : (D.ArrayHandler.detectSectionTable?.(initialBinding.anchor, sectionId) || null);

        const collectionRoot = initialBinding.collectionRoot;
        const ownedSectionConfig = {
          ...sectionConfig,
          ownedOnly: true,
          addRoot: initialBinding.addRoot,
          actionSearchBoundary: initialBinding.actionSearchBoundary,
          embeddedRegions: initialBinding.embeddedRegions,
        };

        const regionContext = {
          sectionId,
          source:
            candidate.source
            || 'embedded-region',

          confidence:
            Math.max(
              0,
              Math.min(
                1,
                Number(candidate.confidence) || 0.8,
              ),
            ),

          collection,

          collectionMode:
            candidate.collectionMode
            || 'array',

          regionId:
            initialBinding.candidate.regionId
            || candidate.regionId
            || '',

          groupCount:
            Number.isInteger(initialBinding.candidate.groupCount)
              ? initialBinding.candidate.groupCount
              : 0,

          zeroRow:
            Number.isInteger(initialBinding.candidate.groupCount)
              ? initialBinding.candidate.groupCount === 0
              : Boolean(initialBinding.candidate.zeroRow),

          indexContext: null,

          regionCandidates: [],

          scanId:
            pageSectionContext?.scanId
            || this.task?.scanId
            || this.scanId,
        };

        await this.setState(
          ENGINE_STATES.PREPARING_ARRAYS,
          `正在处理页面内的“${sectionId}”重复区域…`,
          false,
        );

        const existingCount =
          D.ArrayHandler.detectGroups(
            collectionRoot,
            ownedSectionConfig
          ).length;

        this.callbacks.onLog?.(
          `[数组] ${sectionId}：`
          + `页面 ${existingCount} 组，`
          + `JSON ${items.length} 条`
        );

        const prepared =
          await D.ArrayHandler.prepare(
            regionContext,
            items,
            collectionRoot,
            {
              ...ownedSectionConfig,
              collectionMode:
                candidate.collectionMode
                || 'repeatable',

              timeoutMs: 4_000,

              maxAdds:
                Math.max(10, items.length),
            },
          );

        const refreshedBinding = bindLiveRegion(sectionId, collection);
        if (!refreshedBinding.ok) {
          this.record(runId, {
            field: `${collection}[]`,
            fieldName: sectionId,
            status: 'NEEDS_CONFIRMATION',
            reason: refreshedBinding.error,
            reasonCode: refreshedBinding.reasonCode,
          });
          continue;
        }

        const refreshedGroups = D.ArrayHandler.detectGroups(
          refreshedBinding.collectionRoot,
          {
            ...sectionConfig,
            ownedOnly: true,
          },
        );
        regionContext.regionId = refreshedBinding.candidate.regionId || regionContext.regionId;
        regionContext.groupCount = refreshedGroups.length;
        regionContext.zeroRow = refreshedGroups.length === 0;

        if (existingCount === 0 && prepared.added > 0) {
          this.callbacks.onLog?.(`[数组] ${sectionId}：检测到空 repeatable section，新增 ${prepared.added} 组`);
          this.callbacks.onLog?.(`[数组] ${sectionId}：重新扫描，页面 ${refreshedGroups.length} 组`);
          if (refreshedGroups.length) this.callbacks.onLog?.(`[上下文] ${sectionId}：绑定 group 0 → index 0`);
        }

        if (prepared.limitedCount > 0) {
          this.record(runId, {
            field: `${collection}[]`,
            fieldName: sectionId,
            status: 'NEEDS_CONFIRMATION',
            reason:
              `页面声明该栏目最多填写 ${prepared.itemLimit} 条；`
              + `JSON 有 ${items.length} 条，本次只处理前 ${prepared.targetCount} 条，`
              + `其余 ${prepared.limitedCount} 条未自动写入`,
            reasonCode: 'PAGE_COLLECTION_LIMIT',
          });

          this.callbacks.onLog?.(
            `[数组] ${sectionId}：页面限制最多 ${prepared.itemLimit} 条，`
            + `仅处理 JSON 前 ${prepared.targetCount}/${items.length} 条`
          );
        }

        let availableGroups = refreshedGroups.length
          ? refreshedGroups
          : (prepared.groups || []);

        /*
         * 扩行失败不能让整个数组放弃填写。
         *
         * 例如页面已有 1 行 awards、JSON 有 3 条：
         * 若旧站点“添加”脚本暂时无法安全执行，
         * 仍然先可靠填写第 1 行，并把剩余条目标记人工确认。
         */
        if (!prepared.ok) {
          this.record(runId, {
            field: `${collection}[]`,
            fieldName: sectionId,
            status: 'NEEDS_CONFIRMATION',
            reason:
              `${prepared.error || '重复行准备失败'}；`
              + `将继续填写当前已存在的 ${availableGroups.length} 行`,
            reasonCode:
              'EMBEDDED_ARRAY_PREPARATION_PARTIAL',
          });

          if (!availableGroups.length) {
            continue;
          }
        }

        const groupContexts =
          prepared.groupContexts?.length
            ? prepared.groupContexts
            : D.ArrayHandler.mapGroups(
                regionContext,
                availableGroups,
              );

        results.push({
          sectionId,
          collection,
          items,
          regionContext,
          rootElement:
            sectionTable
            || collectionRoot,
          groupContexts:
            groupContexts.slice(
              0,
              Math.min(items.length, groupContexts.length)
            ),
          groupElements:
            groupContexts
              .map(group => group.element)
              .filter(Boolean),
        });
      }

      return results;
    }

    async runSection(section, options = {}) {
      await this.waitIfPaused();
      this.saveHandler?.invalidate?.();
      const effectiveSection = contextSection(options.sectionContext, section);
      const rawConfidence = Number(options.sectionContext?.confidence);
      const sectionContext = {
        sectionId: effectiveSection || null,
        source: effectiveSection ? (options.sectionContext?.source || 'navigation') : 'unknown',
        confidence: effectiveSection
          ? Math.max(0, Math.min(1, Number.isFinite(rawConfidence) ? rawConfidence : 0.9))
          : 0,
        collection: effectiveSection
          ? (contextSection({ sectionId: options.sectionContext?.collection }) || D.SectionAliases?.collectionForSection?.(effectiveSection) || effectiveSection)
          : null,
        collectionMode: effectiveSection
          ? (options.sectionContext?.collectionMode || (isArraySection(effectiveSection) ? 'array' : 'record'))
          : 'unknown',
        indexContext: null,
        regionCandidates:
          Array.isArray(options.sectionContext?.regionCandidates)
            ? options.sectionContext.regionCandidates
            : [],
        scanId: this.task?.scanId || this.scanId,
      };
      let rootNode = this.adapter.findContentRoot(section);
      const runId = this.reportManager.beginRun({
        taskId: this.task?.taskId,
        scanId: sectionContext.scanId,
        sectionId: section,
        adapterId: this.adapterId,
        siteProfileId: this.siteProfile.id,
        siteProfileRevision: this.siteProfile.revision,
      });
      this.currentSectionRunIds.set(`${sectionContext.scanId}:${section}`, runId);
      const items = sectionArray(this.resumeView, section);
      let groupContexts = [];
      let awardsAdapter = null;
      let awardsFallbackHandled = false;
      let awardsPreparationAttempted = false;
      let collectionMode = sectionContext.collectionMode;
      let embeddedCollections = [];
      let embeddedRegionElements = [];

      await this.setState(ENGINE_STATES.WAITING_PAGE, `等待“${options.label || section}”表单出现并稳定…`);
      await D.PageReady?.waitForFormReady?.({
        document: this.document,
        root: rootNode,
        timeoutMs: 7_500,
        stableForMs: 350,
        signal: this.abortController?.signal,
      });
      rootNode = this.adapter.findContentRoot(section);

      if (
        Array.isArray(
          sectionContext.regionCandidates
        )
        && sectionContext.regionCandidates.length
      ) {
        embeddedCollections =
          await this.prepareEmbeddedCollections(
            rootNode,
            sectionContext,
            options.authorization,
            runId,
          );

        embeddedRegionElements =
          regionExclusionRoots(
            embeddedCollections
          );
      }

      await this.setState(ENGINE_STATES.PREPARING_ARRAYS, `正在检查“${options.label || section}”的重复表单组…`);
      if (section === 'awards' && D.AwardsAdapter?.createAdapter) {
        const sectionConfig = this.config?.sections?.awards || {};
        const liveAwardRegions = this.scanLiveEmbeddedCandidates();
        const awardBinding = this.resolveEmbeddedCollectionBinding(
          rootNode,
          'awards',
          'awards',
          liveAwardRegions,
        );
        awardsAdapter = D.AwardsAdapter.createAdapter(this.document, sectionConfig, {
          root: rootNode,
          arrayHandler: D.ArrayHandler,
          embeddedRegions: liveAwardRegions,
          ...(awardBinding.ok ? {
            groupRoot: awardBinding.collectionRoot,
            addRoot: awardBinding.addRoot,
            actionSearchBoundary: awardBinding.actionSearchBoundary,
          } : {}),
          ...(!awardBinding.ok && awardBinding.reasonCode !== 'EMBEDDED_SECTION_TOPOLOGY_MISSING'
            ? { topologyReason: awardBinding.reasonCode }
            : {}),
        });
        const awardRows = awardsAdapter.getRows?.() || [];
        const awardTopologyBlocked = !awardBinding.ok
          && awardBinding.reasonCode !== 'EMBEDDED_SECTION_TOPOLOGY_MISSING';
        const awardAddButton = awardTopologyBlocked
          ? null
          : awardsAdapter.findAddButton?.();
        if ((awardTopologyBlocked || awardRows.length || awardAddButton) && items.length) {
          // This is the sole Awards preparation attempt for the current run.
          // A failed/no-growth attempt or a non-unique live topology must never
          // fall through into a second generic expansion with weaker context.
          awardsPreparationAttempted = true;
          const normalizedAwards = items.map(item => ({ ...item, time: item.time || item.date || '', content: item.content || item.name || '' }));
          const detectedAwardLimit = D.ArrayHandler?.detectItemLimit?.(rootNode, 'awards');
          const awardTargetCount = detectedAwardLimit
            ? Math.min(normalizedAwards.length, detectedAwardLimit)
            : normalizedAwards.length;
          const limitedAwards = normalizedAwards.slice(0, awardTargetCount);

          if (detectedAwardLimit && normalizedAwards.length > awardTargetCount) {
            this.record(runId, {
              field: 'awards[]',
              fieldName: options.label || section,
              status: 'NEEDS_CONFIRMATION',
              reason:
                `页面声明该栏目最多填写 ${detectedAwardLimit} 条；`
                + `JSON 有 ${normalizedAwards.length} 条，本次只处理前 ${awardTargetCount} 条`,
              reasonCode: 'PAGE_COLLECTION_LIMIT',
            });
          }

          const expansion = await awardsAdapter.ensureRows(awardTargetCount, { timeoutMs: 4_000, maxAdds: Math.max(10, awardTargetCount) });
          if (expansion.ok) {
            const legacyResult = await awardsAdapter.executePlan(awardsAdapter.buildPlan(limitedAwards, this.preferences), this.preferences);
            legacyResult.fields.forEach((field, index) => this.record(runId, {
              itemIndex: field.awardIndex, field: AWARD_FALLBACK_PATHS[field.field] || `awards[].${field.field}`, fieldName: field.fieldName,
              status: field.status, reason: field.reason, confidence: field.confidence,
              plannedValue: field.plannedValue, beforeValue: field.beforeValue, afterValue: field.afterValue, element: field.element,
            }, index));
            groupContexts = D.ArrayHandler?.mapGroups?.(sectionContext, awardsAdapter.getRows().slice(0, awardTargetCount).map(row => row.container))
              || awardsAdapter.getRows().slice(0, awardTargetCount).map((row, index) => ({ element: row.container, index, section, collection: section }));
            awardsFallbackHandled = true;
          } else {
            this.record(runId, {
              field: 'awards[]',
              fieldName: options.label || section,
              status: 'NEEDS_CONFIRMATION',
              reason: expansion.error || '奖励区域未能安全建立所需表单组',
              reasonCode: expansion.code || 'ARRAY_PREPARATION_FAILED',
            });
          }
        }
      }

      if (isArraySection(section) && items.length) {
        if (!groupContexts.length && !awardsPreparationAttempted) {
          const sectionConfig = this.config?.sections?.[section] || {};
          const prepared = await D.ArrayHandler.prepare(sectionContext, items, rootNode, { ...sectionConfig, collectionMode: sectionContext.collectionMode, awardsAdapter, timeoutMs: 4_000, maxAdds: Math.max(10, items.length) });
          collectionMode = prepared.mode || collectionMode;
          if (!prepared.ok) {
            this.record(runId, { field: `${section}[]`, fieldName: options.label || section, status: 'NEEDS_CONFIRMATION', reason: prepared.error, reasonCode: 'ARRAY_PREPARATION_FAILED' });
          } else {
            groupContexts = prepared.groupContexts?.length
              ? prepared.groupContexts
              : D.ArrayHandler.mapGroups(sectionContext, (prepared.groups?.length ? prepared.groups : D.ArrayHandler.detectGroups(rootNode, sectionConfig))).slice(0, items.length);
            if (prepared.unhandledCount > 0) {
              const pageLimited = prepared.limitedCount > 0;
              this.record(runId, {
                field: `${section}[]`,
                fieldName: options.label || section,
                status: 'NEEDS_CONFIRMATION',
                reason: pageLimited
                  ? `页面声明该栏目最多填写 ${prepared.itemLimit} 条；另有 ${prepared.limitedCount} 条 JSON 记录未自动处理`
                  : `当前页面是固定单条视图，只能处理第 1 条；另有 ${prepared.unhandledCount} 条 JSON 记录需要人工处理`,
                reasonCode: pageLimited ? 'PAGE_COLLECTION_LIMIT' : 'SINGLETON_COLLECTION_LIMIT',
              });
            }
          }
        }
      }

      if (isArraySection(section) && !items.length) {
        const sectionConfig = this.config?.sections?.[section] || {};
        const existing = D.ArrayHandler.detectGroups(rootNode, sectionConfig);
        const fallbackGroups = existing.length ? existing.slice(0, 1) : [rootNode];
        groupContexts = D.ArrayHandler.mapGroups(sectionContext, fallbackGroups);
      }

      await D.PageReady?.waitForDOMStable?.({
        document: this.document,
        root: rootNode,
        timeoutMs: 5_000,
        quietMs: 300,
        signal: this.abortController?.signal,
      });
      rootNode = this.adapter.findContentRoot(section);
      if (isArraySection(section)) {
        const sectionConfig = this.config?.sections?.[section] || {};
        let refreshedGroups = [];
        if (awardsFallbackHandled) {
          refreshedGroups = (awardsAdapter?.getRows?.() || []).map(row => row.container).filter(Boolean);
        } else if (collectionMode === 'singleton-view') {
          refreshedGroups = [rootNode];
        } else {
          refreshedGroups = D.ArrayHandler.detectGroups(rootNode, sectionConfig);
        }
        if (refreshedGroups.length) groupContexts = D.ArrayHandler.mapGroups(sectionContext, refreshedGroups);
      }

      await this.setState(ENGINE_STATES.SCANNING_FIELDS, `正在扫描“${options.label || section}”真实字段…`);
      if (isArraySection(section)) {
        if (!groupContexts.length) this.record(runId, { field: `${section}[]`, fieldName: options.label || section, status: 'UNMATCHED', reason: '未能建立 JSON 条目与页面表单组的可靠对应关系' });
        const processCount = items.length ? Math.min(items.length, groupContexts.length) : Math.min(1, groupContexts.length);
        for (let index = 0; index < processCount; index += 1) {
          const groupContext = groupContexts[index];
          await this.processFieldGroup(runId, groupContext.element || groupContext, section, index, options.authorization, {
            skipMatchedPaths: awardsFallbackHandled ? Object.values(AWARD_FALLBACK_PATHS) : [],
            sectionContext: {
              ...sectionContext,
              indexContext: {
                section: sectionContext.collection,
                collection: sectionContext.collection,
                index,
                groupId: groupContext.groupId || `${sectionContext.collection}:${index}`,
                [sectionContext.collection]: index,
              },
            },
            groupId: groupContext.groupId,
            excludeRoots: embeddedRegionElements,
          });
          if (this.stopped || this.skipRequested) break;
        }
      } else {
        await this.processFieldGroup(
          runId,
          rootNode,
          section,
          null,
          options.authorization,
          {
            sectionContext,
            excludeRoots: embeddedRegionElements,
          },
        );
      }

      for (const embedded of embeddedCollections) {
        const processCount = Math.min(
          embedded.items.length,
          embedded.groupContexts.length,
        );

        for (
          let index = 0;
          index < processCount;
          index += 1
        ) {
          const groupContext =
            embedded.groupContexts[index];

          await this.processFieldGroup(
            runId,
            groupContext.element || groupContext,
            embedded.sectionId,
            index,
            options.authorization,
            {
              sectionContext: {
                ...embedded.regionContext,

                indexContext: {
                  section:
                    embedded.collection,

                  collection:
                    embedded.collection,

                  index,

                  groupId:
                    groupContext.groupId
                    || `${embedded.collection}:${index}`,

                  [embedded.collection]:
                    index,
                },
              },

              groupId:
                groupContext.groupId,
            },
          );

          if (
            this.stopped
            || this.skipRequested
          ) {
            break;
          }
        }

        if (
          this.stopped
          || this.skipRequested
        ) {
          break;
        }
      }

      if (this.preferences.autoSave && !this.stopped && !this.skipRequested && this.saveHandler) {
        await this.setState(ENGINE_STATES.SAVING, `正在寻找“${options.label || section}”的安全暂存按钮…`);
        const selection = this.saveHandler.selectCandidate({ root: rootNode });
        if (selection.candidate) {
          const saved = await this.saveHandler.save({ runAuthorization: options.authorization, confirmText: selection.candidate.text, handleId: selection.candidate.handleId, timeoutMs: 8_000, signal: this.abortController?.signal });
          this.callbacks.onLog?.(saved.ok ? `已触发安全暂存“${selection.candidate.text}”，仍需人工确认站点保存结果` : `未自动暂存：${saved.code}`);
        } else this.callbacks.onLog?.(`未自动暂存：${selection.code}`);
      }
      const persistent = this.reportManager.finalize(runId);
      const taskResult = this.reportManager.toTaskResult(runId);
      this.saveHandler?.invalidate?.();
      return { runId, persistent: taskResult, view: this.reportManager.getViewModel(runId, { includeValues: false }), report: persistent };
    }

    async processFieldGroup(runId, rootNode, section, arrayIndex, authorization, executionOptions = {}) {
      await this.waitIfPaused();
      const effectiveSection = contextSection(executionOptions.sectionContext, section);
      const collection = contextSection({ sectionId: executionOptions.sectionContext?.collection }) || effectiveSection;
      const sectionContext = {
        sectionId: effectiveSection || null,
        source: effectiveSection ? (executionOptions.sectionContext?.source || 'navigation') : 'unknown',
        confidence: Math.max(0, Math.min(1, Number(executionOptions.sectionContext?.confidence) || 0)),
        collection: collection || null,
        collectionMode: effectiveSection
          ? (executionOptions.sectionContext?.collectionMode || (isArraySection(effectiveSection) ? 'array' : 'record'))
          : 'unknown',
        indexContext: executionOptions.sectionContext?.indexContext || (arrayIndex === null ? null : {
          section: collection,
          collection,
          index: arrayIndex,
          groupId: executionOptions.groupId || `${collection}:${arrayIndex}`,
          [collection]: arrayIndex,
        }),
        scanId: executionOptions.sectionContext?.scanId || this.task?.scanId || this.scanId,
      };
      const arrayContext = sectionContext.indexContext || undefined;
      let scanRoot = rootNode?.isConnected === false ? this.adapter.findContentRoot(section) : rootNode;

      const excludeRoots = Array.isArray(
        executionOptions.excludeRoots
      )
        ? executionOptions.excludeRoots.filter(Boolean)
        : [];

      const descriptorExcluded = descriptor =>
        elementInsideAnyRoot(
          descriptor?.element,
          excludeRoots
        );

      let descriptors = D.FieldDetector.scan(scanRoot, { section: effectiveSection || undefined, sectionContext, scanId: sectionContext.scanId })
        .filter(
          descriptor =>
            descriptor.controlKind !== 'file'
            && descriptor.type !== 'file'
            && !descriptorExcluded(descriptor)
        )
        .map(descriptor => ({ ...descriptor, scanId: sectionContext.scanId }));
      if (!descriptors.length) {
        await D.PageReady?.waitForFormReady?.({
          document: this.document,
          root: scanRoot,
          timeoutMs: 5_000,
          stableForMs: 300,
          signal: this.abortController?.signal,
        });
        scanRoot = rootNode?.isConnected === false ? this.adapter.findContentRoot(section) : rootNode;
        descriptors = D.FieldDetector.scan(scanRoot, { section: effectiveSection || undefined, sectionContext, scanId: sectionContext.scanId })
          .filter(
            descriptor =>
              descriptor.controlKind !== 'file'
              && descriptor.type !== 'file'
              && !descriptorExcluded(descriptor)
          )
          .map(descriptor => ({ ...descriptor, scanId: sectionContext.scanId }));
      }
      await this.setState(ENGINE_STATES.MATCHING, `正在匹配${arrayIndex === null ? '' : `第 ${arrayIndex + 1} 组`}字段…`);
      const skippedPaths = new Set(Array.isArray(executionOptions.skipMatchedPaths) ? executionOptions.skipMatchedPaths : []);
      const matches = D.FieldMatcher.matchFields(descriptors, this.resume, {
        section: effectiveSection || undefined,
        sectionContext,
        arrayContext,
        arrayIndex,
        resumeView: this.resumeView,
        fieldAliases: this.config.fieldAliases,
        minScore: 62,
        ambiguityMargin: 10,
      })
        .map(match => ({ ...match, scanId: sectionContext.scanId }))
        .filter(match => !skippedPaths.has(match.matchedPath));
      if (!descriptors.length) {
        this.record(runId, {
          itemIndex: arrayIndex ?? 0,
          field: arrayIndex === null ? section : `${collection}[]`,
          fieldName: arrayIndex === null ? section : `${collection}[${arrayIndex}]`,
          status: 'UNMATCHED',
          reason: '等待表单稳定并重新扫描后，仍未检测到当前处理范围内的可见表单字段',
          reasonCode: 'NO_VISIBLE_FIELDS_AFTER_STABLE_SCAN',
        });
      }
      for (let index = 0; index < matches.length; index += 1) {
        await this.waitIfPaused();
        if (this.stopped || this.skipRequested) break;
        const match = matches[index];
        if (match.status === 'MATCHED') {
          await this.setState(ENGINE_STATES.FILLING, `正在填写 ${fieldLabel(match.descriptor, match.matchedPath)}…`, false);
          const result = await this.filler.fillMatch(match, {
            ...this.preferences,
            optionAliases: this.config.optionAliases,
          });
          this.record(runId, {
            itemIndex: arrayIndex ?? 0, field: match.matchedPath, fieldName: fieldLabel(match.descriptor, match.matchedPath),
            status: result.status, reason: result.reason, confidence: match.score / 100,
            plannedValue: result.plannedValue, beforeValue: result.beforeValue, afterValue: result.afterValue, element: match.descriptor.element,
            optionMatchingDebug: result.optionMatchingDebug,
          }, index);
        } else {
          this.record(runId, {
            itemIndex: arrayIndex ?? 0, field: match.matchedPath || match.descriptor?.detectorId || 'unknown', fieldName: fieldLabel(match.descriptor),
            status: match.status, reason: match.reason, confidence: match.score / 100, element: match.descriptor?.element,
          }, index);
        }
      }
      await this.processFileFields(runId, scanRoot, section, arrayIndex, authorization, sectionContext);
    }

    async processFileFields(runId, rootNode, section, arrayIndex, authorization, sectionContext = null) {
      if (!D.FileFieldDetector || !D.FileMatcher || !D.FileUploadEngine) return;
      await this.setState(ENGINE_STATES.SCANNING_FILES, '正在扫描上传材料字段…', false);
      const fields = D.FileFieldDetector.scan(rootNode);
      if (!fields.length) return;
      const arrayItem = arrayIndex === null ? null : sectionArray(this.resumeView, section)[arrayIndex];
      await this.setState(ENGINE_STATES.MATCHING_FILES, `正在匹配 ${fields.length} 个材料字段…`, false);
      const matches = D.FileMatcher.matchFields(fields, this.resumeView, this.materials, { section, sectionContext, arrayItem, arrayIndex });
      for (let index = 0; index < matches.length; index += 1) {
        let match = matches[index];
        let perFileConfirmed = false;
        const askEveryTime = this.preferences.filePolicy === 'ask-every-time';
        if (match.status !== 'MATCH' || askEveryTime) {
          await this.setState(ENGINE_STATES.WAITING_FILE_CONFIRMATION, `材料字段“${match.field?.labelText || match.path || '附件'}”需要人工选择。`);
          const confirmationMatch = match.material && !(match.candidates || []).some(candidate => candidate?.material?.id === match.material.id)
            ? { ...match, candidates: [{ material: match.material, score: match.score || 100 }, ...(match.candidates || [])] }
            : match;
          const selectedId = await this.callbacks.requestFileConfirmation?.(confirmationMatch);
          const material = this.materials.find(item => item.id === selectedId);
          if (!material) {
            this.record(runId, { itemIndex: arrayIndex ?? 0, field: match.path || 'files.unknown', fieldName: match.field?.labelText || '上传材料', status: 'NEEDS_CONFIRMATION', reason: match.reason || '未选择材料', confidence: (match.score || 0) / 100 });
            continue;
          }
          match = { ...match, status: 'MATCH', material, score: 100, reason: '用户在本次任务中明确选择' };
          perFileConfirmed = true;
        }
        await this.waitIfPaused();
        if (this.stopped || this.skipRequested) break;
        await this.setState(ENGINE_STATES.UPLOADING, `正在上传已确认材料：${safeString(match.material.name, 120)}…`);
        const result = await D.FileUploadEngine.upload(match, {
          authorization,
          perFileConfirmed,
          timeoutMs: 30_000,
          signal: this.abortController?.signal,
        });
        await this.setState(ENGINE_STATES.VERIFYING_UPLOAD, `正在验证材料字段：${match.field?.labelText || match.path}…`, false);
        this.record(runId, {
          itemIndex: arrayIndex ?? 0, field: match.path, fieldName: match.field?.labelText || '上传材料',
          status: result.status, reason: result.reason, confidence: match.score / 100,
          element: match.field?.element,
        }, index);
      }
    }

    record(runId, raw, fallbackIndex = 0) {
      const status = reportStatus(raw.status);

      const fieldName =
        safeString(
          raw.fieldName
          || raw.field
          || '未命名字段',
          120
        );

      const reason =
        safeString(
          raw.reason
          || '',
          240
        );

      /*
      * 调试日志只记录：
      * - 字段名称
      * - 状态
      * - 原因
      *
      * 不记录 plannedValue / beforeValue / afterValue，
      * 避免把姓名、手机号等个人信息写入日志。
      */
      this.callbacks.onLog?.(
        `[字段] ${fieldName} → ${status}`
        + (
          reason
            ? `｜${reason}`
            : ''
        )
      );

      return this.reportManager.recordField(
        runId,
        {
          itemId:
            `${
              safeString(
                raw.field || 'field',
                80
              ).replace(
                /[^a-z0-9._:-]/gi,
                '_'
              )
            }:${
              raw.itemIndex
              ?? fallbackIndex
            }:${
              randomToken('f').slice(-8)
            }`,

          itemIndex:
            raw.itemIndex
            ?? fallbackIndex,

          field:
            safeString(
              raw.field
              || 'unknown',
              120
            ),

          fieldName,

          status,

          reasonCode:
            raw.reasonCode
            || String(
              raw.status
              || status
            ).toUpperCase(),

          reason:
            raw.reason,

          confidence:
            Math.max(
              0,
              Math.min(
                1,
                Number(
                  raw.confidence
                ) || 0
              )
            ),

          plannedValue:
            raw.plannedValue,

          beforeValue:
            raw.beforeValue,

          afterValue:
            raw.afterValue,

          // Enumeration diagnostics are metadata-only and stay in ReportManager's
          // ephemeral view; persistent task summaries deliberately omit them.
          optionMatchingDebug:
            raw.optionMatchingDebug,

          element:
            raw.element,
        }
      );
    }

    pause() {
      if ([ENGINE_STATES.FINISHED, ENGINE_STATES.ERROR, ENGINE_STATES.STOPPED, ENGINE_STATES.IDLE].includes(this.engineState)) return false;
      this.paused = true; this.setState(ENGINE_STATES.PAUSED, '任务已暂停。').catch(() => undefined); return true;
    }
    resume() {
      if (!this.paused) return false;
      this.paused = false; const waiters = this.pauseWaiters.splice(0); waiters.forEach(resolve => resolve());
      this.setState(ENGINE_STATES.SCANNING_FIELDS, '任务继续，正在重新核对当前 DOM…').catch(() => undefined); return true;
    }
    stop() {
      this.stopped = true; this.paused = false; this.abortController?.abort?.();
      this.progressionDecision = 'stop';
      this.pauseWaiters.splice(0).forEach(resolve => resolve());
      this.progressionWaiters.splice(0).forEach(resolve => resolve('stop'));
      const endingAuthorization = this.authorization;
      this.authorization = null;
      if (endingAuthorization?.nonce) runtimeMessage({ type: 'REVOKE_FILE_UPLOAD_AUTH', taskId: endingAuthorization.taskId, nonce: endingAuthorization.nonce }).catch(() => undefined);
      return true;
    }
    skipCurrent() {
      this.skipRequested = true;
      if (this.progressionState?.blocked) {
        this.progressionDecision = 'skip';
        this.progressionWaiters.splice(0).forEach(resolve => resolve('skip'));
      }
      return true;
    }
    async waitIfPaused() {
      if (this.stopped) throw new DOMException('任务已停止', 'AbortError');
      if (!this.paused) return;
      await new Promise(resolve => this.pauseWaiters.push(resolve));
      if (this.stopped) throw new DOMException('任务已停止', 'AbortError');
    }
    async recover() {
      const previousAuthorization = this.authorization;
      if (previousAuthorization?.nonce) {
        runtimeMessage({ type: 'REVOKE_FILE_UPLOAD_AUTH', taskId: previousAuthorization.taskId, nonce: previousAuthorization.nonce }).catch(() => undefined);
      }
      this.authorization = null;
      this.prepared = null;
      const restored = await this.taskStore.load();
      if (!restored) return null;
      this.task = restored; this.paused = true;
      await this.setState(ENGINE_STATES.WAITING_USER, '检测到未完成任务。页面刷新后必须重新预览确认才能继续。', false);
      return restored;
    }

    async resetRecognition() {
      if (![ENGINE_STATES.IDLE, ENGINE_STATES.FINISHED, ENGINE_STATES.ERROR, ENGINE_STATES.STOPPED, ENGINE_STATES.PAUSED, ENGINE_STATES.WAITING_USER].includes(this.engineState)) {
        throw new Error('填写任务运行期间不能重新识别；请先暂停并停止当前任务');
      }
      const previousAuthorization = this.authorization;
      if (previousAuthorization?.nonce) {
        await runtimeMessage({ type: 'REVOKE_FILE_UPLOAD_AUTH', taskId: previousAuthorization.taskId, nonce: previousAuthorization.nonce }).catch(() => undefined);
      }
      this.authorization = null;
      this.prepared = null;
      this.task = null;
      this.lastInspection = null;
      this.currentSectionRunIds.clear();
      this.reportManager.clear();
      this.navigation.invalidate?.();
      this.saveHandler?.invalidate?.();
      await this.taskStore.clear();
      this.scanId = D.TaskState.createScanId();
      this.engineState = ENGINE_STATES.IDLE;
      this.currentAction = '旧扫描、任务队列和运行报告已失效，正在建立新扫描。';
      this.callbacks.onState?.(this.snapshot());
      return this.scanId;
    }

    getReport() {
      const activeScanId = this.task?.scanId || this.scanId || '';
      const siteProfile = activeSiteProfile(this);
      const sections = [...this.currentSectionRunIds.entries()].flatMap(([, runId]) => {
        try {
          const view = this.reportManager.getViewModel(runId, { includeValues: false });
          if (view.scanId !== activeScanId) return [];
          const queueItem = this.task?.queue?.find(item => item.sectionId === view.sectionId && item.scanId === activeScanId);
          return [{
            ...view,
            siteProfileId: view.siteProfileId || siteProfile.id,
            siteProfileRevision: view.siteProfileRevision || siteProfile.revision,
            sectionLabel: queueItem?.label || view.sectionId,
          }];
        } catch (_) {
          return [];
        }
      });
      for (const result of this.task?.results || []) {
        if (result.scanId !== activeScanId || sections.some(section => section.sectionId === result.sectionId)) continue;
        const queueItem = this.task?.queue?.find(item => item.sectionId === result.sectionId && item.scanId === activeScanId);
        sections.push({
          scanId: activeScanId,
          sectionId: result.sectionId,
          sectionLabel: queueItem?.label || result.sectionId,
          siteProfileId: result.siteProfileId || siteProfile.id,
          siteProfileRevision: result.siteProfileRevision || siteProfile.revision,
          summary: result.summary || {},
          items: [],
        });
      }
      const total = sections.reduce((sum, section) => sum + Number(section.summary?.total || 0), 0);
      const success = sections.reduce((sum, section) => sum + Number(section.summary?.success || 0), 0);
      const failed = sections.reduce((sum, section) => sum + Number(section.summary?.failed || 0), 0);
      const needsConfirmation = sections.reduce((sum, section) => sum
        + Number(section.summary?.manualReview || 0)
        + Number(section.summary?.conflicts || 0), 0);
      const missingJson = sections.reduce((sum, section) => sum + Number(section.summary?.missingJson || 0), 0);
      const skippedExisting = sections.reduce((sum, section) => sum + Number(section.summary?.skippedExisting || 0), 0);
      const unmatched = sections.reduce((sum, section) => sum + Number(section.summary?.unmatched || 0), 0);
      const conflicts = sections.reduce((sum, section) => sum + Number(section.summary?.conflicts || 0), 0);
      const aggregate = { total, success, failed, needsConfirmation: needsConfirmation + unmatched, missingJson };
      const resultStatus = this.task?.resultStatus || resultStatusForReport(aggregate);
      return {
        taskId: this.task?.taskId || '',
        scanId: activeScanId,
        state: this.engineState,
        resultStatus,
        siteProfileId: siteProfile.id,
        siteProfileRevision: siteProfile.revision,
        siteProfile,
        progressionBlocked: Boolean(this.progressionState?.blocked),
        progressionReasonCode: safeString(this.progressionState?.reasonCode, 80),
        progressionBlockers: Array.isArray(this.progressionState?.blockers)
          ? this.progressionState.blockers.map(item => ({ ...item }))
          : [],
        message: this.progressionState?.blocked
          ? '当前栏目仍有未解决字段，已阻止自动离页。请人工处理或明确跳过栏目。'
          : finishMessage(resultStatus, this.task?.queue?.length === 1 ? 'current' : 'all'),
        total,
        success,
        failed,
        needsConfirmation,
        missingJson,
        skippedExisting,
        unmatched,
        conflicts,
        sections,
        finalSubmitBlocked: true,
      };
    }
    diagnoseCurrent() {
      // 匹配仅用于诊断关联；适配器只导出路径/分数/状态/原因，绝不导出 match.value。
      const context = this.lastInspection?.sectionContext || null;
      const sectionArbitrationAmbiguous =
        context?.arbitration?.reasonCode === 'AMBIGUOUS_SECTION';
      // 诊断必须在调用时读取一次最新页面拓扑；同一份快照同时用于字段 Context
      // 和 embeddedSections 摘要，避免动态新增行后出现新旧结构混用。
      const freshEmbedded = (
        D.EmbeddedSectionDetector?.scan?.(this.document)
        || D.EmbeddedSectionDetector?.detect?.(this.document)
        || []
      );
      const diagnosisSectionId = canonicalSectionId(contextSection(context));
      let diagnosisRoot = this.document;
      try {
        diagnosisRoot = this.adapter.findContentRoot?.(diagnosisSectionId) || this.document;
      } catch (_) {
        diagnosisRoot = this.document;
      }
      const diagnosis = this.adapter.diagnose({
        resume: this.resume || {},
        resumeView: this.resumeView || {},
        sectionContext: context,
        embeddedSections: freshEmbedded,
      });
      const activeScanId = this.lastInspection?.scanId || this.task?.scanId || this.scanId || '';
      const optionMatchingTraces = [];
      if (this.reportManager?.getViewModel && this.currentSectionRunIds?.entries) {
        for (const [, runId] of this.currentSectionRunIds.entries()) {
          try {
            const view = this.reportManager.getViewModel(runId, { includeValues: false });
            if (view.scanId !== activeScanId) continue;
            for (const item of view.items || []) {
              const debug = item?.optionMatchingDebug;
              if (!debug || typeof debug !== 'object') continue;
              const fieldPath = safeString(debug.fieldPath, 120);
              if (!fieldPath) continue;
              optionMatchingTraces.push({
                itemIndex: Math.max(0, Number(item.itemIndex) || 0),
                fieldPath,
                optionMatchingDebug: debug,
              });
            }
          } catch (_) {
            // A disposed/stale run cannot contribute evidence to this diagnosis.
          }
        }
      }
      const embeddedSections =
        freshEmbedded
          .map(candidate => {
            const sectionId = canonicalSectionId(candidate.sectionId || candidate.collection || '');
            const collection = D.SectionAliases?.collectionForSection?.(sectionId)
              || candidate.collection
              || sectionId;
            const groupCount = Number.isInteger(candidate.groupCount)
              ? Math.max(0, candidate.groupCount)
              : 0;
            const zeroRow = Number.isInteger(candidate.groupCount)
              ? candidate.groupCount === 0
              : Boolean(candidate.zeroRow);
            const sectionConfig = this.config?.sections?.[candidate.sectionId]
              || this.config?.sections?.[collection]
              || {};
            const binding = AutofillEngine.prototype.resolveEmbeddedCollectionBinding.call(
              this,
              diagnosisRoot,
              sectionId,
              collection,
              freshEmbedded,
            );
            const actionOwnershipDebug = binding.ok
              ? D.ArrayHandler?.inspectActionOwnership?.(
                  binding.collectionRoot,
                  collection,
                  {
                    ...sectionConfig,
                    addRoot: binding.addRoot,
                    actionSearchBoundary: binding.actionSearchBoundary,
                    regionId: candidate.regionId || '',
                    zeroRow,
                    embeddedRegions: binding.embeddedRegions,
                  },
                ) || null
              : {
                  collection,
                  regionId: safeString(candidate.regionId || '', 120),
                  zeroRow,
                  regionRootFound: Boolean(
                    (candidate.runtimeRoot || candidate.root)
                    && (candidate.runtimeRoot || candidate.root).isConnected !== false
                  ),
                  ownerCandidateCount: 0,
                  ownerCandidates: [],
                  selectedOwnerDepth: null,
                  localAddCandidateCount: 0,
                  acceptedAddCandidateCount: 0,
                  rejectionReasons: [binding.reasonCode],
                  finalReasonCode: binding.reasonCode,
                };
            return {
              sectionId: candidate.sectionId || '',
              confidence: Number(candidate.confidence || 0),
              source: candidate.source || 'embedded-structure',
              collection,
              collectionMode: candidate.collectionMode || 'repeatable',
              regionId: candidate.regionId || '',
              evidenceScope: candidate.evidenceScope || '',
              evidenceKind: safeString(candidate.evidenceKind, 60),
              qualificationReason: safeString(candidate.qualificationReason, 80),
              ownedHeaderCount: Math.max(0, Number(candidate.ownedHeaderCount || 0)),
              nestedHeaderCount: Math.max(0, Number(candidate.nestedHeaderCount || 0)),
              ownedEvidenceCount: Math.max(0, Number(candidate.ownedEvidenceCount || 0)),
              groupCount,
              zeroRow,
              ...(actionOwnershipDebug ? { actionOwnershipDebug } : {}),
            };
          })
          .filter(candidate => candidate.sectionId);
      const actionOwnershipDebug = embeddedSections
        .map(candidate => candidate.actionOwnershipDebug)
        .filter(Boolean);

      return {
        ...diagnosis,
        scanId: activeScanId,
        progressionBlocked: Boolean(this.progressionState?.blocked),
        progressionBlockers: Array.isArray(this.progressionState?.blockers)
          ? this.progressionState.blockers.map(item => ({ ...item }))
          : [],
        optionMatchingTraces,
        embeddedSections,
        actionOwnershipDebug,
        section: {
          ...(diagnosis.section || {}),
          detected: sectionArbitrationAmbiguous
            ? null
            : context?.sectionId || diagnosis.section?.detected || null,
          source: sectionArbitrationAmbiguous
            ? 'unknown'
            : context?.source || diagnosis.section?.source || 'unknown',
          confidence: sectionArbitrationAmbiguous
            ? 0
            : Number(context?.confidence || diagnosis.section?.confidence || 0),
          collection: sectionArbitrationAmbiguous ? null : context?.collection || null,
          collectionMode: sectionArbitrationAmbiguous
            ? 'unknown'
            : context?.collectionMode || 'unknown',
        },
        sectionDetection: {
          final: sectionArbitrationAmbiguous ? null : context?.sectionId || null,
          source: sectionArbitrationAmbiguous ? 'unknown' : context?.source || 'unknown',
          confidence: sectionArbitrationAmbiguous ? 0 : Number(context?.confidence || 0),
          attempts: Array.isArray(context?.trace) ? context.trace : [],
          arbitration: context?.arbitration || null,
        },
      };
    }
  }

  return {
    ARRAY_SECTION_KEYS,
    ENGINE_STATES,
    AutofillEngine,
    evaluateProgression,
    elementInsideAnyRoot,
    isArraySection,
    regionExclusionRoots,
    reportStatus,
  };
});
