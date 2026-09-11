/*
 * 解放：表单填写流程编排器
 * Copyright (c) 2026 zlh and contributors
 * SPDX-License-Identifier: MIT
 */
(function initFormFiller(root, factory) {
  let events = root?.JFEventDispatcher;
  let optionAliases = root?.JFOptionAliases;
  let verification = root?.JFVerificationEngine;
  let controls = root?.JFControlAdapterRegistry;

  if (typeof module === 'object' && module.exports) {
    events = require('./event-dispatcher.js');
    optionAliases = require('../mappings/option-aliases.js');
    verification = require('./verification-engine.js');
    controls = require('../controls/control-adapter-registry.js');
  }

  const api = factory(events, optionAliases, verification, controls);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.JFFormFiller = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function formFillerFactory(E, O, V, C) {
  'use strict';

  const FILL_STATUS = Object.freeze({
    SUCCESS: 'SUCCESS',
    FAILED: 'FAILED',
    UNMATCHED: 'UNMATCHED',
    MISSING_JSON: 'MISSING_JSON',
    NEEDS_CONFIRMATION: 'NEEDS_CONFIRMATION',
    SKIPPED: 'SKIPPED',
    SKIPPED_EMPTY: 'SKIPPED_EMPTY',
    SKIPPED_EXISTING: 'SKIPPED_EXISTING',
    CONFLICT: 'CONFLICT',
  });

  const KNOWN_STATUSES = new Set(Object.values(FILL_STATUS));

  function ensureDependencies() {
    if (!E?.readControlValue || !O?.isPlaceholderOption || !V?.verify || !C?.resolve || !C?.execute) {
      throw new Error('FormFiller 依赖未完整加载');
    }
  }

  function safeString(value) {
    return value === null || value === undefined ? '' : String(value).trim();
  }

  function resolveSingletonPath(path, settings = {}) {
    if (!path || typeof path !== 'string') return path;
    const mode = settings.collectionMode || settings.sectionContext?.collectionMode;
    if (mode !== 'singleton-view') return path;
    const section = settings.sectionId
      || settings.sectionContext?.sectionId
      || settings.sectionContext?.collection;
    if (!section) return path;
    return path.startsWith(`${section}[].`)
      ? path.replace(`${section}[]`, `${section}[0]`)
      : path;
  }

  function hasExistingValue(value) {
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === 'boolean') return value;
    return safeString(value).length > 0;
  }

  function hasMeaningfulExistingValue(descriptor, value) {
    const kind = descriptor?.controlKind || descriptor?.type || '';
    if (['native-select', 'custom-select'].includes(kind)
      && O.isPlaceholderOption({ label: value, value })) {
      return false;
    }
    return hasExistingValue(value);
  }

  function resultBase(descriptor, plannedValue, beforeValue, settings) {
    return {
      descriptor,
      fieldPath: settings.fieldPath || settings.matchedPath || null,
      plannedValue,
      beforeValue,
      afterValue: beforeValue,
      status: FILL_STATUS.FAILED,
      reason: '',
    };
  }

  function currentAlreadyMatches(descriptor, value, settings) {
    return V.verify(descriptor, value, {
      expectedType: settings.expectedType,
      fieldPath: settings.fieldPath || settings.matchedPath || '',
      optionAliases: settings.optionAliases,
    }).ok;
  }

  function normalizeExecutionStatus(execution) {
    const status = safeString(execution?.status).toUpperCase();
    if (KNOWN_STATUSES.has(status)) return status;
    return execution?.ok ? FILL_STATUS.SUCCESS : FILL_STATUS.FAILED;
  }

  function applyExecution(record, execution, descriptor) {
    record.afterValue = execution?.actualValue === undefined
      ? E.readControlValue(descriptor)
      : execution.actualValue;
    record.status = normalizeExecutionStatus(execution);
    record.reason = record.status === FILL_STATUS.SUCCESS
      ? ''
      : safeString(execution?.reason || '控件写入或验证失败');
    record.selectedOption = execution?.selectedOption || null;
    record.optionCandidates = Array.isArray(execution?.optionCandidates)
      ? execution.optionCandidates
      : [];
    if (execution?.optionMatchingDebug) {
      record.optionMatchingDebug = execution.optionMatchingDebug;
    }
    record.controlAdapter = {
      adapterId: safeString(execution?.adapterId),
      framework: safeString(execution?.framework || 'generic'),
      strategy: safeString(execution?.strategy),
    };
    record.handled = execution?.handled !== false;
    return record;
  }

  async function fill(descriptor, rawValue, settings = {}) {
    ensureDependencies();

    const value = rawValue === null || rawValue === undefined ? '' : rawValue;
    const beforeValue = E.readControlValue(descriptor);
    const record = resultBase(descriptor, value, beforeValue, settings);

    if (!descriptor?.element) {
      record.reason = '字段元素不存在';
      return record;
    }

    if (descriptor.sensitive) {
      record.status = FILL_STATUS.SKIPPED;
      record.reason = '敏感认证字段禁止自动填写';
      return record;
    }

    if (descriptor.controlKind === 'file' || descriptor.type === 'file') {
      record.status = FILL_STATUS.NEEDS_CONFIRMATION;
      record.reason = '文件字段交由 FileUploadEngine 处理';
      return record;
    }

    if (descriptor.hidden || descriptor.visible === false) {
      record.status = FILL_STATUS.SKIPPED;
      record.reason = '字段不可见';
      return record;
    }

    const executionSettings = {
      ...settings,
      fieldPath: settings.fieldPath || settings.matchedPath || '',
    };
    const resolution = C.resolve(descriptor, executionSettings);
    const dateLike = resolution?.adapterId === 'date-like';

    if (descriptor.disabled || (descriptor.readOnly && !dateLike)) {
      record.status = FILL_STATUS.SKIPPED;
      record.reason = descriptor.disabled ? '字段已禁用' : '字段为只读';
      return record;
    }

    if (safeString(value) === '' && settings.skipEmpty !== false) {
      record.status = FILL_STATUS.SKIPPED_EMPTY;
      record.reason = '计划值为空';
      return record;
    }

    if (hasMeaningfulExistingValue(descriptor, beforeValue)) {
      if (currentAlreadyMatches(descriptor, value, settings)) {
        record.status = FILL_STATUS.SKIPPED_EXISTING;
        record.reason = '页面已有相同内容';
        return record;
      }
      if (!settings.allowOverwrite) {
        record.status = FILL_STATUS.CONFLICT;
        record.reason = '页面已有不同内容，默认不覆盖';
        return record;
      }
    }

    try {
      const execution = await C.execute(descriptor, value, executionSettings);
      return applyExecution(record, execution, descriptor);
    } catch (error) {
      record.status = FILL_STATUS.FAILED;
      record.reason = error?.message || '控件 Adapter 执行失败';
      record.afterValue = E.readControlValue(descriptor);
      return record;
    }
  }

  async function fillMatch(match, settings = {}) {
    const status = safeString(match?.status).toUpperCase();
    if (status !== 'MATCHED') {
      const mappedStatus = KNOWN_STATUSES.has(status) ? status : FILL_STATUS.UNMATCHED;
      const descriptor = match?.descriptor;
      const currentValue = descriptor ? E.readControlValue(descriptor) : '';
      return {
        descriptor,
        fieldPath: match?.matchedPath || null,
        plannedValue: match?.value,
        beforeValue: currentValue,
        afterValue: currentValue,
        status: mappedStatus,
        reason: match?.reason || '字段未进入可执行状态',
      };
    }

    const resolvedPath = resolveSingletonPath(match.matchedPath, settings);
    return fill(match.descriptor, match.value, {
      ...settings,
      fieldPath: resolvedPath,
      matchedPath: resolvedPath,
      expectedType: settings.expectedType
        || match.evidence?.find(item => item.source === 'type')?.alias,
    });
  }

  async function fillMany(matches, settings = {}) {
    const results = [];
    for (const match of matches || []) results.push(await fillMatch(match, settings));
    return results;
  }

  class FormFiller {
    constructor(defaults = {}) {
      this.defaults = { allowOverwrite: false, skipEmpty: true, ...defaults };
    }

    fill(descriptor, value, settings = {}) {
      return fill(descriptor, value, { ...this.defaults, ...settings });
    }

    fillMatch(match, settings = {}) {
      return fillMatch(match, { ...this.defaults, ...settings });
    }

    fillMany(matches, settings = {}) {
      return fillMany(matches, { ...this.defaults, ...settings });
    }
  }

  return Object.freeze({
    FILL_STATUS,
    FormFiller,
    fill,
    fillMany,
    fillMatch,
    hasExistingValue,
    hasMeaningfulExistingValue,
    resolveSingletonPath,
  });
});
