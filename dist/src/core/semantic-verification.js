/*
 * 解放：字段感知的值语义验证。
 * 只比较 expected / actual，不读取或操作 DOM。
 * SPDX-License-Identifier: MIT
 */
(function initSemanticVerification(root, factory) {
  let options = root?.JFOptionAliases;
  let dates = root?.JFDateRules;
  let booleans = root?.JFBooleanSemanticAdapter;
  if (typeof module === 'object' && module.exports) {
    options = require('../mappings/option-aliases.js');
    dates = require('../mappings/date-rules.js');
    booleans = require('../semantics/boolean-semantic-adapter.js');
  }
  const api = factory(options, dates, booleans);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.JFSemanticVerification = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function semanticVerificationFactory(O, D, B) {
  'use strict';

  const STRATEGY = Object.freeze({
    EXACT: 'exact',
    ENUM: 'enum',
    BOOLEAN: 'boolean',
    DATE: 'date',
    OPTION: 'option',
    UNKNOWN: 'unknown',
  });

  const BOOLEAN_FIELD_PATHS = new Set([
    'education[].eliteTrainingBase',
  ]);

  function safeString(value) {
    return value === null || value === undefined ? '' : String(value).trim();
  }

  function normalizeFieldPath(fieldPath) {
    if (O?.normalizeFieldPath) return O.normalizeFieldPath(fieldPath);
    return safeString(fieldPath).replace(/\[\d+\]/g, '[]');
  }

  function normalizeToken(value) {
    if (O?.normalizeOptionText) return O.normalizeOptionText(value);
    return safeString(value).replace(/[\s\u00a0:：*（）()【】\[\]_.\-/\\]+/g, '').toLowerCase();
  }

  function result(equivalent, strategy, expectedCanonical, actualCanonical, confidence = 1, reason = '') {
    return {
      equivalent,
      strategy,
      expectedCanonical,
      actualCanonical,
      confidence,
      reason,
    };
  }

  function exactEquivalent(expected, actual) {
    if (Object.is(expected, actual)) return true;
    if (expected === null || expected === undefined || actual === null || actual === undefined) return false;
    if (typeof expected === 'object' || typeof actual === 'object') return false;
    return safeString(expected) === safeString(actual);
  }

  function descriptorSemanticType(descriptor = {}, expectedType = '') {
    return safeString(
      expectedType
      || descriptor.semanticType
      || descriptor.valueType
      || descriptor.dataType
      || descriptor.expectedType,
    ).toLowerCase();
  }

  function isBooleanContext(fieldPath, descriptor = {}, controlKind = '', expectedType = '') {
    const normalizedPath = normalizeFieldPath(fieldPath);
    const semanticType = descriptorSemanticType(descriptor, expectedType);
    if (BOOLEAN_FIELD_PATHS.has(normalizedPath) || semanticType === 'boolean' || semanticType === 'bool') return true;
    const kind = safeString(controlKind || descriptor.controlKind || descriptor.type).toLowerCase();
    const groupSize = Array.isArray(descriptor.elements) ? descriptor.elements.length : 0;
    return kind === 'checkbox' && groupSize <= 1;
  }

  function canonicalBoolean(value) {
    return B?.normalize ? B.normalize(value) : null;
  }

  function dateContext(fieldPath, descriptor = {}, controlKind = '', expectedType = '') {
    const kind = safeString(controlKind || descriptor.controlKind || descriptor.inputType || descriptor.nativeType || descriptor.type).toLowerCase();
    const semanticType = descriptorSemanticType(descriptor, expectedType);
    const path = normalizeFieldPath(fieldPath).toLowerCase();
    return kind === 'date'
      || kind === 'month'
      || semanticType === 'date'
      || semanticType === 'month'
      || /(?:birthday|date|time|month|year)$/.test(path);
  }

  function datePrecision(descriptor = {}, controlKind = '', expectedType = '') {
    const declared = safeString(
      descriptor.datePrecision
      || descriptor.precision
      || expectedType
      || descriptor.semanticType
      || descriptor.valueType,
    ).toLowerCase();
    const kind = safeString(controlKind || descriptor.controlKind || descriptor.inputType || descriptor.nativeType || descriptor.type).toLowerCase();
    if (declared === 'month' || declared === 'year-month' || kind === 'month') return 'month';
    if (declared === 'day' || declared === 'full-date' || kind === 'date') return 'day';

    const hint = [
      descriptor.placeholder,
      descriptor.pattern,
      descriptor.format,
      descriptor.labelText,
      descriptor.ariaLabel,
      descriptor.nearbyText,
    ].map(safeString).filter(Boolean).join(' ');
    if (/年月日|yyyy\s*[-/.年]\s*mm\s*[-/.月]\s*dd|\bdd\b|具体日期/i.test(hint)) return 'day';
    if (/年月(?!日)|yyyy\s*[-/.年]\s*mm(?!\s*[-/.月]\s*dd)|年\s*月/i.test(hint)) return 'month';
    return null;
  }

  function canonicalDate(parsed, precision) {
    if (!parsed) return null;
    const year = String(parsed.year);
    const month = String(parsed.month).padStart(2, '0');
    if (precision === 'month') return `${year}-${month}`;
    if (parsed.day === null || parsed.day === undefined) return null;
    return `${year}-${month}-${String(parsed.day).padStart(2, '0')}`;
  }

  function compareDate({ fieldPath, expected, actual, descriptor, controlKind, expectedType }) {
    if (!dateContext(fieldPath, descriptor, controlKind, expectedType) || !D?.parseDateValue) return null;
    const left = D.parseDateValue(expected);
    const right = D.parseDateValue(actual);
    if (!left || !right) return null;

    const targetPrecision = datePrecision(descriptor, controlKind, expectedType);
    if (targetPrecision === 'month') {
      const expectedCanonical = canonicalDate(left, 'month');
      const actualCanonical = canonicalDate(right, 'month');
      return result(expectedCanonical === actualCanonical, STRATEGY.DATE, expectedCanonical, actualCanonical);
    }
    if (targetPrecision === 'day') {
      const expectedCanonical = canonicalDate(left, 'day');
      const actualCanonical = canonicalDate(right, 'day');
      return result(Boolean(expectedCanonical && actualCanonical && expectedCanonical === actualCanonical), STRATEGY.DATE, expectedCanonical, actualCanonical,
        1, expectedCanonical && actualCanonical ? '' : 'DATE_PRECISION_MISMATCH');
    }

    if (left.precision !== right.precision) {
      return result(false, STRATEGY.DATE, canonicalDate(left, left.precision), canonicalDate(right, right.precision), 1, 'DATE_PRECISION_MISMATCH');
    }
    const precision = left.precision === 'day' ? 'day' : 'month';
    const expectedCanonical = canonicalDate(left, precision);
    const actualCanonical = canonicalDate(right, precision);
    return result(expectedCanonical === actualCanonical, STRATEGY.DATE, expectedCanonical, actualCanonical);
  }

  function fieldEnumTable(fieldPath) {
    return O?.FIELD_OPTION_ALIASES?.[normalizeFieldPath(fieldPath)] || null;
  }

  function knownEnumCanonical(table, canonical) {
    return Boolean(table && Object.prototype.hasOwnProperty.call(table, safeString(canonical)));
  }

  function compareEnum(fieldPath, expected, actual) {
    const table = fieldEnumTable(fieldPath);
    if (!table || !O?.canonicalFieldOption) return null;
    const expectedCanonical = O.canonicalFieldOption(fieldPath, expected);
    const actualCanonical = O.canonicalFieldOption(fieldPath, actual);
    if (!knownEnumCanonical(table, expectedCanonical)) return null;
    return result(
      knownEnumCanonical(table, actualCanonical)
        && normalizeToken(expectedCanonical) === normalizeToken(actualCanonical),
      STRATEGY.ENUM,
      expectedCanonical,
      actualCanonical,
    );
  }

  function knownGlobalOption(value, canonical) {
    if (!O?.OPTION_ALIASES) return false;
    if (Object.prototype.hasOwnProperty.call(O.OPTION_ALIASES, safeString(canonical))) return true;
    return normalizeToken(value) !== normalizeToken(canonical);
  }

  function compareGenericOption(fieldPath, expected, actual) {
    if (!O?.canonicalOption) return null;
    const settings = { fieldPath: normalizeFieldPath(fieldPath) };
    const expectedCanonical = O.canonicalOption(expected, settings);
    const actualCanonical = O.canonicalOption(actual, settings);
    if (!knownGlobalOption(expected, expectedCanonical)) return null;
    return result(
      knownGlobalOption(actual, actualCanonical)
        && normalizeToken(expectedCanonical) === normalizeToken(actualCanonical),
      STRATEGY.OPTION,
      expectedCanonical,
      actualCanonical,
      0.98,
    );
  }

  function compare(input = {}) {
    const {
      fieldPath = '', expected, actual, descriptor = {}, controlKind = '', expectedType = '',
    } = input;

    if (exactEquivalent(expected, actual)) {
      return result(true, STRATEGY.EXACT, expected, actual);
    }

    if (isBooleanContext(fieldPath, descriptor, controlKind, expectedType)) {
      const expectedCanonical = canonicalBoolean(expected);
      const actualCanonical = canonicalBoolean(actual);
      if (expectedCanonical !== null && actualCanonical !== null) {
        return result(
          expectedCanonical === actualCanonical,
          STRATEGY.BOOLEAN,
          expectedCanonical,
          actualCanonical,
          1,
        );
      }
      // Boolean Adapter 未识别时继续 FIELD_OPTION_ALIASES；例如现有
      // eliteTrainingBase 还支持“不属于 / 不来自”，不在这里重复词表。
    }

    const dateResult = compareDate({ fieldPath, expected, actual, descriptor, controlKind, expectedType });
    if (dateResult) return dateResult;

    const enumResult = compareEnum(fieldPath, expected, actual);
    if (enumResult) return enumResult;

    const optionResult = compareGenericOption(fieldPath, expected, actual);
    if (optionResult) return optionResult;

    return result(null, STRATEGY.UNKNOWN, null, null, 0, 'NO_SEMANTIC_RULE');
  }

  return Object.freeze({
    BOOLEAN_FIELD_PATHS,
    STRATEGY,
    canonicalBoolean,
    compare,
    datePrecision,
    exactEquivalent,
    isBooleanContext,
    normalizeFieldPath,
  });
});
