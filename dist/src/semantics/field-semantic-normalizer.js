/*
 * 解放：跨平台字段语义归一化。
 * 只统一“同一业务含义”的常见表述，不把独立业务字段强行合并。
 * SPDX-License-Identifier: MIT
 */
(function initFieldSemanticNormalizer(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.JFFieldSemanticNormalizer = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function fieldSemanticNormalizerFactory() {
  'use strict';

  function safeString(value) {
    return value === null || value === undefined ? '' : String(value).trim();
  }

  function baseNormalize(value) {
    return safeString(value)
      .replace(/[\s\u00a0:：*（）()【】\[\]_.\-/\\,，。;；、]+/g, '')
      .toLowerCase();
  }

  const PROMPT_PREFIX_PATTERN = /^(?:请输入|请填写|请选择|请选取|请录入|选择)/;

  /*
   * 只剥离明确的控件操作提示词，不截断普通句子。返回值仅作
   * semantic-placeholder 证据，不改变真实 label/table header 的优先级。
   */
  function stripPromptPrefix(value) {
    const source = safeString(value);
    if (!PROMPT_PREFIX_PATTERN.test(source)) return '';
    return source.replace(PROMPT_PREFIX_PATTERN, '').replace(/^[空格\s：:]+/, '').trim();
  }

  const PHRASE_RULES = Object.freeze([
    // 时间起点：只改写明确的“开始/起始/入职”词，不碰“入学/毕业”等独立语义。
    Object.freeze({ pattern: /起始年月/g, replacement: '开始时间' }),
    Object.freeze({ pattern: /开始年月/g, replacement: '开始时间' }),
    Object.freeze({ pattern: /起始日期/g, replacement: '开始时间' }),
    Object.freeze({ pattern: /开始日期/g, replacement: '开始时间' }),
    Object.freeze({ pattern: /起始时间/g, replacement: '开始时间' }),
    Object.freeze({ pattern: /入职年月/g, replacement: '入职时间' }),

    // 时间终点。
    Object.freeze({ pattern: /结束年月/g, replacement: '结束时间' }),
    Object.freeze({ pattern: /截止年月/g, replacement: '结束时间' }),
    Object.freeze({ pattern: /终止年月/g, replacement: '结束时间' }),
    Object.freeze({ pattern: /结束日期/g, replacement: '结束时间' }),
    Object.freeze({ pattern: /截止日期/g, replacement: '结束时间' }),
    Object.freeze({ pattern: /终止日期/g, replacement: '结束时间' }),
    Object.freeze({ pattern: /截止时间/g, replacement: '结束时间' }),
    Object.freeze({ pattern: /终止时间/g, replacement: '结束时间' }),
    Object.freeze({ pattern: /离职年月/g, replacement: '离职时间' }),

    // 学制/培养年限属于同一 choice 语义。
    Object.freeze({ pattern: /本科培养年限/g, replacement: '学制' }),
    Object.freeze({ pattern: /本科就读年限/g, replacement: '学制' }),
    Object.freeze({ pattern: /培养年限/g, replacement: '学制' }),
    Object.freeze({ pattern: /修业年限/g, replacement: '学制' }),
    Object.freeze({ pattern: /学习年限/g, replacement: '学制' }),
    Object.freeze({ pattern: /本科年限/g, replacement: '学制' }),
    Object.freeze({ pattern: /学制年限/g, replacement: '学制' }),

    // Compound 页常用“本科院系”作为“院系”的局部明确标签。
    Object.freeze({ pattern: /本科院系/g, replacement: '院系' }),
  ]);

  function rewriteFieldPhrase(value) {
    let output = safeString(value);
    for (const rule of PHRASE_RULES) output = output.replace(rule.pattern, rule.replacement);
    return output;
  }

  function normalizeFieldPhrase(value, settings = {}) {
    const rewritten = rewriteFieldPhrase(value);
    const normalizer = typeof settings.baseNormalizer === 'function'
      ? settings.baseNormalizer
      : baseNormalize;
    return normalizer(rewritten);
  }

  return Object.freeze({
    PHRASE_RULES,
    PROMPT_PREFIX_PATTERN,
    baseNormalize,
    normalizeFieldPhrase,
    rewriteFieldPhrase,
    stripPromptPrefix,
  });
});
