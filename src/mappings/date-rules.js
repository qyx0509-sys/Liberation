/*
 * 解放：日期解析、格式推断与比较规则
 * SPDX-License-Identifier: MIT
 */
(function initDateRules(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.JFDateRules = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function dateRulesFactory() {
  'use strict';

  const DATE_STYLES = Object.freeze({
    ISO_DATE: 'YYYY-MM-DD',
    ISO_MONTH: 'YYYY-MM',
    SLASH_DATE: 'YYYY/MM/DD',
    SLASH_MONTH: 'YYYY/MM',
    DOT_DATE: 'YYYY.MM.DD',
    DOT_MONTH: 'YYYY.MM',
    CN_DATE: 'YYYY年MM月DD日',
    CN_MONTH: 'YYYY年MM月',
    COMPACT_DATE: 'YYYYMMDD',
    COMPACT_MONTH: 'YYYYMM',
  });

  function safeString(value) {
    return value === null || value === undefined ? '' : String(value).trim();
  }

  function pad2(value) {
    return String(value).padStart(2, '0');
  }

  function validDateParts(year, month, day) {
    if (!Number.isInteger(year) || year < 1900 || year > 2200) return false;
    if (!Number.isInteger(month) || month < 1 || month > 12) return false;
    if (day === null || day === undefined) return true;
    if (!Number.isInteger(day) || day < 1 || day > 31) return false;
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  }

  function parseDateValue(rawValue) {
    const value = safeString(rawValue);
    if (!value) return null;
    let match;
    if ((match = value.match(/^(\d{4})\s*年\s*(\d{1,2})\s*月(?:\s*(\d{1,2})\s*日?)?$/))) {
      const result = { year: Number(match[1]), month: Number(match[2]), day: match[3] ? Number(match[3]) : null };
      return validDateParts(result.year, result.month, result.day) ? { ...result, precision: result.day ? 'day' : 'month', source: value } : null;
    }
    if ((match = value.match(/^(\d{4})[-/.](\d{1,2})(?:[-/.](\d{1,2}))?$/))) {
      const result = { year: Number(match[1]), month: Number(match[2]), day: match[3] ? Number(match[3]) : null };
      return validDateParts(result.year, result.month, result.day) ? { ...result, precision: result.day ? 'day' : 'month', source: value } : null;
    }
    if ((match = value.match(/^(\d{4})(\d{2})(\d{2})$/))) {
      const result = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
      return validDateParts(result.year, result.month, result.day) ? { ...result, precision: 'day', source: value } : null;
    }
    if ((match = value.match(/^(\d{4})(\d{2})$/))) {
      const result = { year: Number(match[1]), month: Number(match[2]), day: null };
      return validDateParts(result.year, result.month, null) ? { ...result, precision: 'month', source: value } : null;
    }
    return null;
  }

  function formatParsedDate(parsed, style) {
    if (!parsed) return '';
    const year = String(parsed.year);
    const month = pad2(parsed.month);
    const day = parsed.day === null || parsed.day === undefined ? '' : pad2(parsed.day);
    switch (style) {
      case DATE_STYLES.ISO_DATE: return day ? `${year}-${month}-${day}` : '';
      case DATE_STYLES.ISO_MONTH: return `${year}-${month}`;
      case DATE_STYLES.SLASH_DATE: return day ? `${year}/${month}/${day}` : '';
      case DATE_STYLES.SLASH_MONTH: return `${year}/${month}`;
      case DATE_STYLES.DOT_DATE: return day ? `${year}.${month}.${day}` : '';
      case DATE_STYLES.DOT_MONTH: return `${year}.${month}`;
      case DATE_STYLES.CN_DATE: return day ? `${year}年${month}月${day}日` : '';
      case DATE_STYLES.CN_MONTH: return `${year}年${month}月`;
      case DATE_STYLES.COMPACT_DATE: return day ? `${year}${month}${day}` : '';
      case DATE_STYLES.COMPACT_MONTH: return `${year}${month}`;
      default: return day ? `${year}-${month}-${day}` : `${year}-${month}`;
    }
  }

  function inferDateStyle(descriptor = {}, parsed = null) {
    const inputType = safeString(descriptor.inputType || descriptor.nativeType || descriptor.type).toLowerCase();
    if (inputType === 'date') return DATE_STYLES.ISO_DATE;
    if (inputType === 'month') return DATE_STYLES.ISO_MONTH;
    const hint = [descriptor.placeholder, descriptor.pattern, descriptor.format, descriptor.labelText, descriptor.nearbyText]
      .map(safeString).join(' ');
    const explicitlyRequestsDay = /dd|日|日期|年月日/i.test(hint);
    const explicitlyRequestsMonth = /yyyy\s*[-/.]\s*mm(?!\s*[-/.]\s*dd)/i.test(hint)
      || (/年.*月/.test(hint) && !/日/.test(hint));
    const wantsDay = explicitlyRequestsDay || (!explicitlyRequestsMonth && parsed?.precision === 'day');
    if (/yyyy\s*年\s*mm\s*月/i.test(hint) || /年.*月/.test(hint)) return wantsDay ? DATE_STYLES.CN_DATE : DATE_STYLES.CN_MONTH;
    if (/yyyy\s*\/\s*mm/i.test(hint) || /\d{4}\/\d{1,2}/.test(hint)) return wantsDay ? DATE_STYLES.SLASH_DATE : DATE_STYLES.SLASH_MONTH;
    if (/yyyy\s*\.\s*mm/i.test(hint) || /\d{4}\.\d{1,2}/.test(hint)) return wantsDay ? DATE_STYLES.DOT_DATE : DATE_STYLES.DOT_MONTH;
    if (/yyyymmdd/i.test(hint)) return DATE_STYLES.COMPACT_DATE;
    if (/yyyymm/i.test(hint)) return DATE_STYLES.COMPACT_MONTH;
    return wantsDay ? DATE_STYLES.ISO_DATE : DATE_STYLES.ISO_MONTH;
  }

  function formatDateForField(rawValue, descriptor = {}) {
    const parsed = parseDateValue(rawValue);
    if (!parsed) return { ok: false, value: '', reason: '日期格式无法识别', parsed: null, style: null };
    const style = inferDateStyle(descriptor, parsed);
    const needsDay = [DATE_STYLES.ISO_DATE, DATE_STYLES.SLASH_DATE, DATE_STYLES.DOT_DATE, DATE_STYLES.CN_DATE, DATE_STYLES.COMPACT_DATE].includes(style);
    if (needsDay && parsed.precision !== 'day') {
      return { ok: false, value: '', reason: '页面字段要求具体日期，但 JSON 只提供了年月', parsed, style };
    }
    const value = formatParsedDate(parsed, style);
    return value
      ? { ok: true, value, reason: '', parsed, style }
      : { ok: false, value: '', reason: '日期精度与页面格式不匹配', parsed, style };
  }

  function datesEquivalent(expected, actual) {
    const left = parseDateValue(expected);
    const right = parseDateValue(actual);
    if (!left || !right) return safeString(expected) === safeString(actual);
    if (left.year !== right.year || left.month !== right.month) return false;
    if (left.precision === 'month') return true;
    return right.precision === 'day' && left.day === right.day;
  }

  return {
    DATE_STYLES,
    datesEquivalent,
    formatDateForField,
    formatParsedDate,
    inferDateStyle,
    parseDateValue,
  };
});
