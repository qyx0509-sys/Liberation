/*
 * 解放 — 本次运行结果管理（完整值仅保留在内存）
 * Copyright (c) 2026 zlh and contributors
 * SPDX-License-Identifier: MIT
 */
(function initReportManager(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.JFReportManager = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function reportFactory() {
  'use strict';

  const REPORT_STATUSES = Object.freeze({
    PLANNED: 'planned',
    SUCCESS: 'success',
    SKIPPED_EMPTY: 'skipped_empty',
    SKIPPED_EXISTING: 'skipped_existing',
    CONFLICT: 'conflict',
    NOT_FOUND: 'not_found',
    MANUAL_REVIEW: 'manual_review',
    NEEDS_CONFIRMATION: 'needs_confirmation',
    UNMATCHED: 'unmatched',
    MISSING_JSON: 'missing_json',
    SKIPPED: 'skipped',
    FAILED: 'failed',
  });
  const VALID_STATUSES = new Set(Object.values(REPORT_STATUSES));
  const MAX_RUNS = 20;
  const MAX_ITEMS = 1_000;

  function safeString(value, maxLength = 240) {
    return String(value ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength);
  }

  function safeId(value, fallback) {
    const text = safeString(value, 128).replace(/[^a-zA-Z0-9._:-]/g, '_');
    return text || fallback;
  }

  function reasonCode(value) {
    const code = safeString(value, 80).toUpperCase().replace(/[^A-Z0-9_:-]/g, '_');
    return code || 'UNSPECIFIED';
  }

  const OPTION_MATCH_REASON_CODES = new Set([
    'OPTION_MATCHED',
    'NO_OPTIONS',
    'NO_CANONICAL_ALIAS',
    'LOW_SCORE',
    'AMBIGUOUS_OPTIONS',
    'INSUFFICIENT_MARGIN',
    'OPTION_SCOPE_UNCERTAIN',
    'READBACK_MISMATCH',
  ]);
  const OPTION_EXPECTED_SHAPES = new Set(['empty', 'array', 'text', 'ratio', 'number', 'boolean', 'object', 'other']);

  function sanitizeOptionMatchingDebug(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const own = key => {
      try {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        return descriptor && !descriptor.get && !descriptor.set ? descriptor.value : undefined;
      } catch (_) { return undefined; }
    };
    const traceString = (input, maxLength) => {
      try { return safeString(input, maxLength); }
      catch (_) { return ''; }
    };
    const traceArray = (key, maxItems, maxLength) => {
      const items = own(key);
      if (!Array.isArray(items)) return Object.freeze([]);
      return Object.freeze(items.slice(0, maxItems)
        .filter(item => typeof item === 'string')
        .map(item => traceString(item, maxLength))
        .filter(Boolean));
    };
    const traceScore = key => {
      let number;
      try { number = Number(own(key)); }
      catch (_) { number = 0; }
      return Number(Math.min(1, Math.max(0, Number.isFinite(number) ? number : 0)).toFixed(3));
    };
    let optionCount;
    try { optionCount = Number(own('optionCount')); }
    catch (_) { optionCount = 0; }
    const suppliedReason = traceString(own('reasonCode'), 80).toUpperCase();
    const suppliedShape = traceString(own('expectedShape'), 40).toLowerCase();
    return Object.freeze({
      fieldPath: traceString(own('fieldPath'), 160),
      optionCount: Number.isInteger(optionCount) && optionCount >= 0 ? Math.min(optionCount, 10000) : 0,
      normalizedOptionLabels: traceArray('normalizedOptionLabels', 40, 80),
      expectedShape: OPTION_EXPECTED_SHAPES.has(suppliedShape) ? suppliedShape : 'other',
      canonicalCandidates: traceArray('canonicalCandidates', 20, 120),
      expectedCanonical: traceString(own('expectedCanonical'), 120),
      bestScore: traceScore('bestScore'),
      secondBestScore: traceScore('secondBestScore'),
      threshold: traceScore('threshold'),
      margin: traceScore('margin'),
      bestOptionLabel: traceString(own('bestOptionLabel'), 80),
      matchedCanonical: traceString(own('matchedCanonical'), 120),
      reasonCode: OPTION_MATCH_REASON_CODES.has(suppliedReason) ? suppliedReason : 'LOW_SCORE',
    });
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function emptySummary() {
    return {
      total: 0,
      planned: 0,
      success: 0,
      skipped: 0,
      skippedEmpty: 0,
      skippedExisting: 0,
      conflicts: 0,
      notFound: 0,
      manualReview: 0,
      needsConfirmation: 0,
      unmatched: 0,
      missingJson: 0,
      failed: 0,
    };
  }

  function summarize(items) {
    const summary = emptySummary();
    summary.total = items.length;
    for (const item of items) {
      if (item.status === REPORT_STATUSES.PLANNED) summary.planned += 1;
      else if (item.status === REPORT_STATUSES.SUCCESS) summary.success += 1;
      else if (item.status === REPORT_STATUSES.SKIPPED_EMPTY) { summary.skipped += 1; summary.skippedEmpty += 1; }
      else if (item.status === REPORT_STATUSES.SKIPPED_EXISTING) { summary.skipped += 1; summary.skippedExisting += 1; }
      else if (item.status === REPORT_STATUSES.CONFLICT) summary.conflicts += 1;
      else if (item.status === REPORT_STATUSES.NOT_FOUND) summary.notFound += 1;
      else if (item.status === REPORT_STATUSES.MANUAL_REVIEW) summary.manualReview += 1;
      else if (item.status === REPORT_STATUSES.NEEDS_CONFIRMATION) { summary.manualReview += 1; summary.needsConfirmation += 1; }
      else if (item.status === REPORT_STATUSES.UNMATCHED) { summary.notFound += 1; summary.unmatched += 1; }
      else if (item.status === REPORT_STATUSES.MISSING_JSON) summary.missingJson += 1;
      else if (item.status === REPORT_STATUSES.SKIPPED) summary.skipped += 1;
      else if (item.status === REPORT_STATUSES.FAILED) summary.failed += 1;
    }
    return summary;
  }

  class ReportManager {
    constructor(options = {}) {
      this.maxRuns = Math.max(1, Math.min(MAX_RUNS, Number(options.maxRuns) || MAX_RUNS));
      this.maxItems = Math.max(1, Math.min(MAX_ITEMS, Number(options.maxItems) || MAX_ITEMS));
      this.runs = new Map();
      this.sequence = 0;
    }

    beginRun(meta = {}) {
      if (this.runs.size >= this.maxRuns) {
        const oldest = this.runs.keys().next().value;
        this.dispose(oldest);
      }
      const runId = safeId(meta.runId, `run:${Date.now().toString(36)}:${++this.sequence}`);
      if (this.runs.has(runId)) throw new Error(`运行 ${runId} 已存在`);
      this.runs.set(runId, {
        runId,
        scanId: safeId(meta.scanId, 'scan:unknown'),
        taskId: safeId(meta.taskId, ''),
        sectionId: safeId(meta.sectionId, ''),
        adapterId: safeId(meta.adapterId, ''),
        siteProfileId: safeId(meta.siteProfileId, ''),
        siteProfileRevision: safeString(meta.siteProfileRevision, 128),
        startedAt: nowIso(),
        finishedAt: '',
        items: [],
        elements: new Map(),
      });
      return runId;
    }

    requireRun(runId) {
      const run = this.runs.get(runId);
      if (!run) throw new Error(`未找到运行 ${safeString(runId, 128)}`);
      return run;
    }

    recordField(runId, rawItem = {}) {
      const run = this.requireRun(runId);
      if (run.items.length >= this.maxItems) throw new Error(`单次运行最多记录 ${this.maxItems} 个字段`);
      const status = VALID_STATUSES.has(rawItem.status) ? rawItem.status : REPORT_STATUSES.FAILED;
      const itemId = safeId(rawItem.itemId, `item:${run.items.length + 1}`);
      if (run.items.some(item => item.itemId === itemId)) throw new Error(`字段结果 ${itemId} 重复`);
      const optionMatchingDebug = sanitizeOptionMatchingDebug(rawItem.optionMatchingDebug);
      const item = {
        itemId,
        itemIndex: Math.max(0, Number(rawItem.itemIndex ?? rawItem.awardIndex) || 0),
        field: safeId(rawItem.field, 'unknown'),
        fieldName: safeString(rawItem.fieldName, 120),
        status,
        reasonCode: reasonCode(rawItem.reasonCode),
        reason: safeString(rawItem.reason, 300),
        confidence: Math.max(0, Math.min(1, Number(rawItem.confidence) || 0)),
        // 这些值只存在于本对象的内存生命周期；持久摘要永远不会包含它们。
        plannedValue: rawItem.plannedValue ?? '',
        beforeValue: rawItem.beforeValue ?? '',
        afterValue: rawItem.afterValue ?? '',
        ...(optionMatchingDebug ? { optionMatchingDebug } : {}),
      };
      run.items.push(item);
      if (rawItem.element && typeof rawItem.element === 'object') run.elements.set(itemId, rawItem.element);
      return { ...item };
    }

    finalize(runId) {
      const run = this.requireRun(runId);
      run.finishedAt = nowIso();
      return this.toPersistentSummary(runId);
    }

    getViewModel(runId, options = {}) {
      const run = this.requireRun(runId);
      const includeValues = options.includeValues !== false;
      return {
        runId: run.runId,
        scanId: run.scanId,
        taskId: run.taskId,
        sectionId: run.sectionId,
        adapterId: run.adapterId,
        siteProfileId: run.siteProfileId,
        siteProfileRevision: run.siteProfileRevision,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt,
        summary: summarize(run.items),
        items: run.items.map(item => {
          const base = {
            itemId: item.itemId,
            itemIndex: item.itemIndex,
            field: item.field,
            fieldName: item.fieldName,
            status: item.status,
            reasonCode: item.reasonCode,
            reason: item.reason,
            confidence: item.confidence,
            canLocate: Boolean(run.elements.get(item.itemId)?.isConnected),
            ...(item.optionMatchingDebug ? { optionMatchingDebug: item.optionMatchingDebug } : {}),
          };
          return includeValues ? {
            ...base,
            plannedValue: item.plannedValue,
            beforeValue: item.beforeValue,
            afterValue: item.afterValue,
          } : base;
        }),
      };
    }

    toPersistentSummary(runId) {
      const run = this.requireRun(runId);
      const summary = summarize(run.items);
      const failed = summary.failed;
      const review = summary.manualReview + summary.conflicts + summary.notFound;
      return Object.freeze({
        schemaVersion: 1,
        runId: run.runId,
        scanId: run.scanId,
        taskId: run.taskId,
        sectionId: run.sectionId,
        adapterId: run.adapterId,
        siteProfileId: run.siteProfileId,
        siteProfileRevision: run.siteProfileRevision,
        status: failed ? 'failed' : review ? 'manual_review' : 'completed',
        reasonCode: failed ? 'FIELD_FAILURES_PRESENT' : review ? 'MANUAL_REVIEW_REQUIRED' : 'OK',
        summary,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt || nowIso(),
      });
    }

    toTaskResult(runId) {
      const report = this.toPersistentSummary(runId);
      return Object.freeze({
        sectionId: report.sectionId,
        scanId: report.scanId,
        siteProfileId: report.siteProfileId,
        siteProfileRevision: report.siteProfileRevision,
        status: report.status,
        reasonCode: report.reasonCode,
        summary: report.summary,
        finishedAt: report.finishedAt,
        attempts: 1,
      });
    }

    locate(runId, itemId) {
      const run = this.requireRun(runId);
      const element = run.elements.get(itemId);
      if (!element?.isConnected) return { ok: false, code: 'ELEMENT_DETACHED' };
      try {
        element.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
        const previousOutline = element.style?.outline || '';
        const previousOffset = element.style?.outlineOffset || '';
        if (element.style) {
          element.style.outline = '3px solid #f59e0b';
          element.style.outlineOffset = '2px';
          const timer = setTimeout(() => {
            if (!element.isConnected || !element.style) return;
            element.style.outline = previousOutline;
            element.style.outlineOffset = previousOffset;
          }, 2_500);
          timer?.unref?.();
        }
        return { ok: true, code: 'LOCATED' };
      } catch (_) {
        return { ok: false, code: 'LOCATE_FAILED' };
      }
    }

    dispose(runId) {
      const run = this.runs.get(runId);
      if (!run) return false;
      run.elements.clear();
      run.items.length = 0;
      this.runs.delete(runId);
      return true;
    }

    clear() {
      [...this.runs.keys()].forEach(runId => this.dispose(runId));
    }
  }

  return Object.freeze({
    MAX_ITEMS,
    MAX_RUNS,
    REPORT_STATUSES,
    ReportManager,
    summarize,
  });
});
