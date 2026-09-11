/*
 * 解放：选项语义归一化
 * SPDX-License-Identifier: MIT
 */
(function initOptionAliases(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.JFOptionAliases = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function optionAliasesFactory() {
  'use strict';

  const OPTION_ALIASES = Object.freeze({
    男: Object.freeze(['男', '男性', 'male', 'm']),
    女: Object.freeze(['女', '女性', 'female', 'f']),
    是: Object.freeze(['是', '有', '已', 'yes', 'true', 'y']),
    否: Object.freeze(['否', '无', '未', 'no', 'false', 'n']),
    中共党员: Object.freeze(['中共党员', '中国共产党党员', '共产党员', '正式党员', '党员']),
    中共预备党员: Object.freeze(['中共预备党员', '中国共产党预备党员', '预备党员']),
    共青团员: Object.freeze(['共青团员', '中国共产主义青年团团员', '团员']),
    群众: Object.freeze(['群众', '普通群众']),
    本科: Object.freeze(['本科', '大学本科', '本科生', '学士', 'bachelor', 'undergraduate']),
    硕士: Object.freeze(['硕士', '硕士研究生', '研究生硕士', 'master']),
    博士: Object.freeze(['博士', '博士研究生', '研究生博士', 'phd', 'doctor']),
    专科: Object.freeze(['专科', '大专', '大学专科', 'college']),
    国家级: Object.freeze(['国家级', '国家', '全国级', '全国']),
    省部级: Object.freeze(['省部级', '省级', '部级', '省部']),
    市级: Object.freeze(['市级', '地市级', '市']),
    校级: Object.freeze(['校级', '学校级', '院校级']),
    院级: Object.freeze(['院级', '学院级']),
    一等奖: Object.freeze(['一等奖', '一等', '第一等奖', '1等奖']),
    二等奖: Object.freeze(['二等奖', '二等', '第二等奖', '2等奖']),
    三等奖: Object.freeze(['三等奖', '三等', '第三等奖', '3等奖']),
    特等奖: Object.freeze(['特等奖', '特等']),
    已发表: Object.freeze(['已发表', '正式发表', '已刊出', 'published']),
    已录用: Object.freeze(['已录用', '录用待刊', 'accepted']),
    审稿中: Object.freeze(['审稿中', '在审', 'underreview']),
    汉族: Object.freeze(['汉族', '汉']),
  });

  const FIELD_OPTION_ALIASES = Object.freeze({
    'education[].studyDuration': Object.freeze({
      '2': Object.freeze(['2', '2.0', '2年', '2.0年', '二', '二年', '两年', '二年制', '两年制', '本科二年制']),
      '3': Object.freeze(['3', '3.0', '3年', '3.0年', '三', '三年', '三年制', '本科三年制']),
      '4': Object.freeze(['4', '4.0', '4年', '4.0年', '四', '四年', '四年制', '本科四年制']),
      '5': Object.freeze(['5', '5.0', '5年', '5.0年', '五', '五年', '五年制', '本科五年制']),
      '6': Object.freeze(['6', '6.0', '6年', '6.0年', '六', '六年', '六年制', '本科六年制']),
      '7': Object.freeze(['7', '7.0', '7年', '7.0年', '七', '七年', '七年制']),
      '8': Object.freeze(['8', '8.0', '8年', '8.0年', '八', '八年', '八年制']),
    }),
    'education[].eliteTrainingBase': Object.freeze({
      '是': Object.freeze(['是', '有', '1', 'true', 'yes', 'y', '来自', '属于']),
      '否': Object.freeze(['否', '无', '0', 'false', 'no', 'n', '不来自', '不属于']),
    }),
    'papers[].status': Object.freeze({
      published: Object.freeze(['published', '已发表', '正式发表', '已刊出']),
      accepted: Object.freeze(['accepted', '已录用', '录用待刊']),
      underReview: Object.freeze(['underReview', 'under review', 'underreview', '审稿中', '在审']),
      submitted: Object.freeze(['submitted', '投稿中']),
      inPress: Object.freeze(['inPress', 'in press']),
    }),
    'papers[].authorRank': Object.freeze({
      '1': Object.freeze(['1', '第一作者', '一作']),
      '2': Object.freeze(['2', '第二作者', '二作']),
      '3': Object.freeze(['3', '第三作者', '三作']),
    }),
  });

  // These canonical fields describe bounded, page-authored taxonomies rather
  // than person-specific option scopes. They may expose normalized visible UI
  // labels for diagnosis, while expected text, opaque values and best/matched
  // labels remain protected unless a controlled field vocabulary exists.
  const STATIC_OPTION_TRACE_FIELDS = Object.freeze(new Set([
    'education[].major',
  ]));


  function safeString(value) {
    return value === null || value === undefined ? '' : String(value).trim();
  }

  function normalizeOptionText(value) {
    return safeString(value)
      .replace(/^[\s\-—–请选择]+|[\s\-—–]+$/g, '')
      .replace(/[\s\u00a0:：*（）()【】\[\]_.\-/\\]+/g, '')
      .toLowerCase();
  }

  function normalizeFieldPath(fieldPath) {
    return safeString(fieldPath).replace(/\[\d+\]/g, '[]');
  }

  function localFieldAliasTable(fieldPath, settings = {}) {
    const tables = settings?.optionAliases;
    if (!tables || typeof tables !== 'object' || Array.isArray(tables)) return null;
    const normalizedPath = normalizeFieldPath(fieldPath);
    let tableDescriptor = null;
    try {
      tableDescriptor = Object.getOwnPropertyDescriptor(tables, normalizedPath);
      if (!tableDescriptor) {
        for (const key of Object.keys(tables).slice(0, 160)) {
          if (normalizeFieldPath(key) === normalizedPath) {
            tableDescriptor = Object.getOwnPropertyDescriptor(tables, key);
            break;
          }
        }
      }
    } catch (_) { return null; }
    if (!tableDescriptor || typeof tableDescriptor.get === 'function' || typeof tableDescriptor.set === 'function') return null;
    const table = tableDescriptor.value;
    if (!table || typeof table !== 'object' || Array.isArray(table)) return null;

    const output = Object.create(null);
    let descriptors;
    try { descriptors = Object.getOwnPropertyDescriptors(table); }
    catch (_) { return null; }
    Object.entries(descriptors).slice(0, 80).forEach(([canonical, descriptor]) => {
      if (['__proto__', 'prototype', 'constructor'].includes(canonical)) return;
      if (typeof descriptor.get === 'function' || typeof descriptor.set === 'function' || !Array.isArray(descriptor.value)) return;
      const safeCanonical = safeString(canonical).slice(0, 160);
      if (!safeCanonical) return;
      const aliases = descriptor.value.slice(0, 30)
        .filter(alias => typeof alias === 'string')
        .map(alias => safeString(alias).slice(0, 160))
        .filter(Boolean);
      Object.defineProperty(output, safeCanonical, {
        enumerable: true,
        configurable: false,
        writable: false,
        value: aliases,
      });
    });
    return output;
  }

  function fieldAliasTable(fieldPath, settings = {}) {
    const globalTable = FIELD_OPTION_ALIASES[normalizeFieldPath(fieldPath)] || null;
    const localTable = localFieldAliasTable(fieldPath, settings);
    if (!localTable) return globalTable;
    const merged = Object.create(null);
    const canonicals = new Set([
      ...Object.keys(globalTable || {}),
      ...Object.keys(localTable),
    ]);
    canonicals.forEach(canonical => {
      Object.defineProperty(merged, canonical, {
        enumerable: true,
        configurable: false,
        writable: false,
        value: [...new Set([
          ...(globalTable?.[canonical] || []),
          ...(localTable[canonical] || []),
        ].map(safeString).filter(Boolean))],
      });
    });
    return merged;
  }

  function knownFieldOptionCanonical(fieldPath, value, settings = {}) {
    const table = fieldAliasTable(fieldPath, settings);
    if (!table) return '';
    const normalized = normalizeOptionText(value);
    if (!normalized) return '';
    const matches = Object.entries(table)
      .filter(([canonical, aliases]) => [canonical, ...aliases]
        .some(alias => normalizeOptionText(alias) === normalized))
      .map(([canonical]) => canonical);
    return matches.length === 1 ? matches[0] : '';
  }

  function hasFieldOptionVocabulary(fieldPath, settings = {}) {
    return Boolean(fieldAliasTable(fieldPath, settings));
  }

  function canonicalFieldOption(fieldPath, value, settings = {}) {
    const table = fieldAliasTable(fieldPath, settings);
    if (!table) return safeString(value);
    const expected = normalizeOptionText(value);
    if (!expected) return '';
    const matches = [];
    for (const [canonical, aliases] of Object.entries(table)) {
      if ([canonical, ...aliases].some(alias => normalizeOptionText(alias) === expected)) matches.push(canonical);
    }
    return matches.length === 1 ? matches[0] : safeString(value);
  }

  function expandFieldOptionAliases(fieldPath, value, settings = {}) {
    const table = fieldAliasTable(fieldPath, settings);
    if (!table) return [];
    const canonical = canonicalFieldOption(fieldPath, value, settings);
    const aliases = table[canonical] || [];
    return [...new Set([canonical, value, ...aliases].map(safeString).filter(Boolean))];
  }


  const REVERSE_ALIASES = (() => {
    const reverse = new Map();
    Object.entries(OPTION_ALIASES).forEach(([canonical, aliases]) => {
      [canonical, ...aliases].forEach(alias => {
        const normalized = normalizeOptionText(alias);
        if (normalized && !reverse.has(normalized)) reverse.set(normalized, canonical);
      });
    });
    return reverse;
  })();

  function canonicalOption(value, settings = {}) {
    const fieldCanonical = canonicalFieldOption(settings.fieldPath, value, settings);
    const table = fieldAliasTable(settings.fieldPath, settings);
    // A canonical token may already be byte-for-byte equal to the input. It is
    // still field-owned and must win over a legacy global alias with a different
    // canonical (for example papers[].status: published vs global 已发表).
    if (table && Object.prototype.hasOwnProperty.call(table, fieldCanonical)) return fieldCanonical;
    const normalized = normalizeOptionText(value);
    return REVERSE_ALIASES.get(normalized) || safeString(value);
  }

  function expandOptionAliases(value, settings = {}) {
    const fieldAliases = expandFieldOptionAliases(settings.fieldPath, value, settings);
    const canonical = canonicalOption(value, settings);
    const aliases = OPTION_ALIASES[canonical] || [];
    return [...new Set([canonical, value, ...fieldAliases, ...aliases].map(safeString).filter(Boolean))];
  }

  function optionLabel(option) {
    if (typeof option === 'string' || typeof option === 'number') return safeString(option);
    return safeString(option?.label ?? option?.text ?? option?.textContent ?? option?.value);
  }

  // Runtime traces may expose visible option labels, but must never fall back to
  // opaque option values. Matching keeps using optionLabel() so this diagnostic
  // boundary does not alter established selection behaviour.
  function debugOptionLabel(option) {
    if (typeof option === 'string' || typeof option === 'number') return safeString(option);
    return safeString(option?.label ?? option?.text ?? option?.textContent);
  }

  function expectedValueShape(value) {
    if (value === null || value === undefined || (typeof value === 'string' && !value.trim())) return 'empty';
    if (Array.isArray(value)) return 'array';
    if (typeof value === 'string') return /^\s*\d+\s*\/\s*\d+\s*$/.test(value) ? 'ratio' : 'text';
    if (typeof value === 'number') return 'number';
    if (typeof value === 'boolean') return 'boolean';
    if (typeof value === 'object') return 'object';
    return 'other';
  }

  function normalizePlaceholderText(value) {
    return safeString(value)
      .replace(/[\s\u00a0]+/g, '')
      .replace(/^[\-—–_=~·•*.:：,，;；、|/\\()（）\[\]【】<>《》]+|[\-—–_=~·•*.:：,，;；、|/\\()（）\[\]【】<>《》]+$/g, '')
      .replace(/(?:\.{2,}|…+)$/g, '')
      .toLowerCase();
  }

  function isPlaceholderOption(option) {
    const text = optionLabel(option);
    const value = safeString(option?.value);
    const normalized = normalizePlaceholderText(text);
    if (!normalized) return true;
    if (/^(?:请选择(?:一项|一个|内容|选项)?|请选择.+|选择|请选|未选择|未选|暂无|无数据|none|null|select|selectone)$/i.test(normalized)) return true;
    if (!value && /^(?:请选择|选择|请选)/.test(normalized)) return true;
    return false;
  }

  function bigramScore(left, right) {
    if (left.length < 2 || right.length < 2) return 0;
    const tokens = value => {
      const set = new Set();
      for (let index = 0; index < value.length - 1; index += 1) set.add(value.slice(index, index + 2));
      return set;
    };
    const a = tokens(left);
    const b = tokens(right);
    let intersection = 0;
    a.forEach(token => { if (b.has(token)) intersection += 1; });
    return intersection / Math.max(1, a.size + b.size - intersection);
  }

  function partyMembershipStageConflicts(left, right) {
    const leftText = normalizeOptionText(left);
    const rightText = normalizeOptionText(right);
    if (!leftText.includes('党员') || !rightText.includes('党员')) return false;
    return leftText.includes('预备') !== rightText.includes('预备');
  }

  function scoreOption(expected, option, settings = {}) {
    if (isPlaceholderOption(option)) return 0;
    const expectedText = normalizeOptionText(expected);
    const optionText = normalizeOptionText(optionLabel(option));
    const optionValue = normalizeOptionText(option?.value);
    if (!expectedText || (!optionText && !optionValue)) return 0;

    if (hasFieldOptionVocabulary(settings.fieldPath, settings)) {
      const expectedFieldCanonical = knownFieldOptionCanonical(settings.fieldPath, expected, settings);
      if (!expectedFieldCanonical) return 0;
      const labelFieldCanonical = knownFieldOptionCanonical(settings.fieldPath, optionLabel(option), settings);
      if (labelFieldCanonical) {
        if (labelFieldCanonical !== expectedFieldCanonical) return 0;
        return expectedText === optionText ? 1 : 0.98;
      }
      const valueFieldCanonical = knownFieldOptionCanonical(settings.fieldPath, option?.value, settings);
      if (!valueFieldCanonical || valueFieldCanonical !== expectedFieldCanonical) return 0;
      return expectedText === optionValue ? 1 : 0.98;
    }

    if (expectedText === optionText || expectedText === optionValue) return 1;
    // “预备党员”与“正式党员”是不同政治面貌。即使调用方降低模糊
    // 匹配阈值，也不能因为二者都包含“党员”而相互命中。
    if (partyMembershipStageConflicts(expectedText, optionText || optionValue)) return 0;

    const expectedCanonical = normalizeOptionText(canonicalOption(expected, settings));
    const optionCanonical = normalizeOptionText(canonicalOption(optionLabel(option), settings));
    const valueCanonical = normalizeOptionText(canonicalOption(option?.value, settings));
    if (expectedCanonical && (expectedCanonical === optionCanonical || expectedCanonical === valueCanonical)) return 0.98;

    const aliases = expandOptionAliases(expected, settings).map(normalizeOptionText);
    if (aliases.includes(optionText) || aliases.includes(optionValue)) return 0.96;
    if (expectedText.length >= 2 && optionText.length >= 2 && (expectedText.includes(optionText) || optionText.includes(expectedText))) {
      const ratio = Math.min(expectedText.length, optionText.length) / Math.max(expectedText.length, optionText.length);
      return 0.72 + ratio * 0.16;
    }
    const fuzzy = bigramScore(expectedText, optionText);
    return fuzzy >= 0.62 ? Math.min(0.79, fuzzy) : 0;
  }

  function debugCanonicalCandidates(fieldPath, value, settings = {}) {
    const table = fieldAliasTable(fieldPath, settings);
    const normalized = normalizeOptionText(value);
    if (!normalized) return [];
    if (table) {
      return Object.entries(table)
        .filter(([canonical, aliases]) => [canonical, ...aliases]
          .some(alias => normalizeOptionText(alias) === normalized))
        .map(([canonical]) => safeString(canonical).slice(0, 120))
        .filter(Boolean)
        .slice(0, 20);
    }
    const canonical = REVERSE_ALIASES.get(normalized);
    return canonical ? [safeString(canonical).slice(0, 120)] : [];
  }

  function boundedScore(value, fallback) {
    const number = Number.isFinite(value) ? Number(value) : fallback;
    return Math.min(1, Math.max(0, number));
  }

  function findBestOption(expected, options, settings = {}) {
    const minScore = boundedScore(settings.minScore, 0.88);
    const ambiguityMargin = boundedScore(settings.ambiguityMargin, 0.06);
    const sourceOptions = [...(options || [])];
    const ranked = sourceOptions
      .map((option, index) => ({ option, index, label: optionLabel(option), score: scoreOption(expected, option, settings) }))
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score || a.index - b.index);
    const best = ranked[0] || null;
    const second = ranked[1] || null;
    const normalizedPath = normalizeFieldPath(settings.fieldPath);
    const hasFieldVocabulary = hasFieldOptionVocabulary(normalizedPath, settings);
    const exposesStaticOptionLabels = STATIC_OPTION_TRACE_FIELDS.has(normalizedPath);
    const canonicalCandidates = hasFieldVocabulary
      ? debugCanonicalCandidates(normalizedPath, expected, settings)
      : [];
    const expectedCanonical = canonicalCandidates.length === 1 ? canonicalCandidates[0] : '';
    const scoreGap = best && second ? best.score - second.score : 1;
    const tied = Boolean(best && second && Math.abs(scoreGap) <= Number.EPSILON);
    const insufficientMargin = Boolean(best && second && scoreGap > Number.EPSILON && scoreGap < ambiguityMargin);
    const ambiguous = tied || insufficientMargin;
    let reasonCode = 'OPTION_MATCHED';
    if (sourceOptions.length === 0) reasonCode = 'NO_OPTIONS';
    else if (hasFieldVocabulary && canonicalCandidates.length !== 1) reasonCode = 'NO_CANONICAL_ALIAS';
    else if (!best || best.score < minScore) reasonCode = 'LOW_SCORE';
    else if (tied) reasonCode = 'AMBIGUOUS_OPTIONS';
    else if (insufficientMargin) reasonCode = 'INSUFFICIENT_MARGIN';
    const matched = reasonCode === 'OPTION_MATCHED';
    const debugCanonical = value => {
      if (!hasFieldVocabulary) return '';
      const candidates = debugCanonicalCandidates(normalizedPath, value, settings);
      return candidates.length === 1 ? candidates[0] : '';
    };
    const matchedCanonical = matched && best
      ? (debugCanonical(best.label) || debugCanonical(best.option?.value))
      : '';
    const optionMatchingDebug = Object.freeze({
      fieldPath: normalizedPath,
      optionCount: sourceOptions.length,
      normalizedOptionLabels: Object.freeze(hasFieldVocabulary || exposesStaticOptionLabels
        ? sourceOptions
          .slice(0, 40)
          .map(option => normalizeOptionText(debugOptionLabel(option)).slice(0, 80))
          .filter(Boolean)
        : []),
      expectedShape: expectedValueShape(expected),
      canonicalCandidates: Object.freeze([...canonicalCandidates]),
      expectedCanonical,
      bestScore: Number((best?.score || 0).toFixed(3)),
      secondBestScore: Number((second?.score || 0).toFixed(3)),
      threshold: Number(minScore.toFixed(3)),
      margin: Number(ambiguityMargin.toFixed(3)),
      bestOptionLabel: hasFieldVocabulary && best
        ? normalizeOptionText(debugOptionLabel(best.option)).slice(0, 80)
        : '',
      matchedCanonical,
      reasonCode,
    });
    return {
      matched,
      ambiguous,
      option: matched ? best.option : null,
      index: matched ? best.index : -1,
      label: best?.label || '',
      score: Number((best?.score || 0).toFixed(3)),
      candidates: ranked.slice(0, 3).map(item => ({ label: item.label, score: Number(item.score.toFixed(3)), index: item.index })),
      optionMatchingDebug,
    };
  }

  return {
    OPTION_ALIASES,
    FIELD_OPTION_ALIASES,
    canonicalFieldOption,
    canonicalOption,
    expandFieldOptionAliases,
    expandOptionAliases,
    findBestOption,
    hasFieldOptionVocabulary,
    isPlaceholderOption,
    knownFieldOptionCanonical,
    normalizePlaceholderText,
    normalizeFieldPath,
    normalizeOptionText,
    partyMembershipStageConflicts,
    scoreOption,
  };
});
