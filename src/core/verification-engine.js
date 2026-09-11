/*
 * 解放：填写后验证
 * SPDX-License-Identifier: MIT
 */
(function initVerificationEngine(root, factory) {
  let events = root?.JFEventDispatcher;
  let options = root?.JFOptionAliases;
  let dates = root?.JFDateRules;
  let semantic = root?.JFSemanticVerification;
  if (typeof module === 'object' && module.exports) {
    events = require('./event-dispatcher.js');
    options = require('../mappings/option-aliases.js');
    dates = require('../mappings/date-rules.js');
    semantic = require('./semantic-verification.js');
  }
  const api = factory(events, options, dates, semantic);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.JFVerificationEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function verificationFactory(E, O, D, S) {
  'use strict';

  const VERIFICATION_STATUS = Object.freeze({
    SUCCESS: 'SUCCESS',
    FAILED: 'FAILED',
    NEEDS_CONFIRMATION: 'NEEDS_CONFIRMATION',
  });

  function safeString(value) {
    return value === null || value === undefined ? '' : String(value).trim();
  }

  function normalizeText(value) {
    return safeString(value).replace(/\s+/g, ' ');
  }

  function toBoolean(value) {
    if (typeof value === 'boolean') return value;
    const normalized = safeString(value).replace(/\s+/g, '').toLowerCase();
    if (['true', '1', 'yes', 'y', '是', '有', '已选', '同意'].includes(normalized)) return true;
    if (['false', '0', 'no', 'n', '否', '无', '未选', '不同意'].includes(normalized)) return false;
    return null;
  }

  function selectedLabel(descriptor) {
    const element = descriptor?.element;
    const selected = element?.selectedOptions?.[0]
      || [...(element?.options || [])].find(option => option.selected || safeString(option.value) === safeString(element?.value));
    return safeString(selected?.textContent || selected?.label || selected?.value || element?.value);
  }

  function semanticOptionEquivalent(expected, actual, settings = {}) {
    const fieldPath = settings.fieldPath || settings.matchedPath || '';
    const hasFieldVocabulary = Boolean(O?.hasFieldOptionVocabulary?.(fieldPath, settings));
    if (!hasFieldVocabulary && safeString(expected) === safeString(actual)) return true;
    if (!O?.scoreOption) return false;
    return O.scoreOption(expected, { label: actual, value: actual }, {
      fieldPath,
      optionAliases: settings.optionAliases,
    }) >= 0.94;
  }

  function semanticCompare(descriptor, expected, actual, kind, settings = {}) {
    if (!S?.compare) return null;
    return S.compare({
      fieldPath: settings.fieldPath || settings.matchedPath || '',
      expected,
      actual,
      descriptor,
      controlKind: kind,
      expectedType: settings.expectedType || '',
    });
  }

  function verify(descriptor, expected, settings = {}) {
    if (!descriptor?.element) {
      return { ok: false, status: VERIFICATION_STATUS.FAILED, actualValue: '', reason: '字段元素不存在' };
    }
    const kind = descriptor.controlKind || descriptor.type || E?.controlKind?.(descriptor);
    const actualValue = E?.readControlValue ? E.readControlValue(descriptor) : descriptor.element.value;

    if (kind === 'file') {
      return {
        ok: false,
        status: VERIFICATION_STATUS.NEEDS_CONFIRMATION,
        actualValue: '',
        reason: '文件字段需由 FileUploadEngine 验证上传状态',
      };
    }

    const comparisonActual = kind === 'native-select'
      ? (selectedLabel(descriptor) || actualValue)
      : actualValue;
    const semanticResult = semanticCompare(descriptor, expected, comparisonActual, kind, settings);
    if (semanticResult?.equivalent === true) {
      return {
        ok: true,
        status: VERIFICATION_STATUS.SUCCESS,
        actualValue: comparisonActual,
        reason: '',
      };
    }

    if (kind === 'date' || kind === 'month' || settings.expectedType === 'date') {
      // Semantic Verification 的日期精度结论具有优先级，避免旧的宽松
      // datesEquivalent 把 year-month 与 full-date 在未知语境下误判为相同。
      const ok = semanticResult?.strategy === 'date' && semanticResult.equivalent === false
        ? false
        : (D?.datesEquivalent ? D.datesEquivalent(expected, actualValue) : safeString(expected) === safeString(actualValue));
      return {
        ok,
        status: ok ? VERIFICATION_STATUS.SUCCESS : VERIFICATION_STATUS.FAILED,
        actualValue,
        reason: ok ? '' : '页面日期与计划值不一致',
      };
    }

    if (kind === 'native-select') {
      const actualLabel = selectedLabel(descriptor);
      const fieldPath = settings.fieldPath || settings.matchedPath || '';
      const labelCanonical = O?.knownFieldOptionCanonical?.(fieldPath, actualLabel, settings) || '';
      const ok = semanticOptionEquivalent(expected, actualLabel, settings)
        || (!labelCanonical && semanticOptionEquivalent(expected, actualValue, settings));
      return {
        ok,
        status: ok ? VERIFICATION_STATUS.SUCCESS : VERIFICATION_STATUS.FAILED,
        actualValue: actualLabel || actualValue,
        reason: ok ? '' : '页面所选选项与计划值不一致',
      };
    }

    if (kind === 'radio') {
      const ok = semanticOptionEquivalent(expected, actualValue, settings);
      return {
        ok,
        status: ok ? VERIFICATION_STATUS.SUCCESS : VERIFICATION_STATUS.FAILED,
        actualValue,
        reason: ok ? '' : '页面单选状态与计划值不一致',
      };
    }

    if (kind === 'checkbox') {
      const expectedBoolean = toBoolean(expected);
      if (expectedBoolean !== null && typeof actualValue === 'boolean') {
        const ok = expectedBoolean === actualValue;
        return { ok, status: ok ? VERIFICATION_STATUS.SUCCESS : VERIFICATION_STATUS.FAILED, actualValue, reason: ok ? '' : '页面勾选状态与计划值不一致' };
      }
      const actualList = Array.isArray(actualValue) ? actualValue : [actualValue];
      const ok = actualList.some(value => semanticOptionEquivalent(expected, value, settings));
      return { ok, status: ok ? VERIFICATION_STATUS.SUCCESS : VERIFICATION_STATUS.FAILED, actualValue, reason: ok ? '' : '页面多选状态与计划值不一致' };
    }

    if (kind === 'custom-select') {
      const ok = semanticOptionEquivalent(expected, actualValue, settings);
      return {
        ok,
        status: ok ? VERIFICATION_STATUS.SUCCESS : VERIFICATION_STATUS.NEEDS_CONFIRMATION,
        actualValue,
        reason: ok ? '' : '自定义下拉显示值无法可靠确认',
      };
    }

    const ok = normalizeText(actualValue) === normalizeText(expected);
    return {
      ok,
      status: ok ? VERIFICATION_STATUS.SUCCESS : VERIFICATION_STATUS.FAILED,
      actualValue,
      reason: ok ? '' : '页面实际值与计划值不一致',
    };
  }

  return {
    VERIFICATION_STATUS,
    normalizeText,
    semanticOptionEquivalent,
    semanticCompare,
    selectedLabel,
    toBoolean,
    verify,
  };
});
