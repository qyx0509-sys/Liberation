/*
 * 解放：上传材料语义别名。
 * Copyright (c) 2026 zlh and contributors
 * SPDX-License-Identifier: MIT
 */
(function initFileFieldAliases(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.JFFileFieldAliases = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function fileFieldAliasesFactory() {
  'use strict';

  const FILE_FIELD_ALIASES = Object.freeze({
    'files.photo': Object.freeze(['证件照', '个人照片', '本人照片', '报名照片', '头像', '照片']),
    'files.resume': Object.freeze(['个人简历', '简历附件', '上传简历', '个人履历', '简历材料']),
    'files.transcript': Object.freeze(['本科成绩单', '学习成绩单', '成绩证明', '成绩单']),
    'files.id_front': Object.freeze(['身份证正面', '身份证人像面', '证件人像面']),
    'files.id_back': Object.freeze(['身份证反面', '身份证国徽面', '证件国徽面']),
    'files.language_certificate': Object.freeze(['英语等级证书', '四六级证书', '外语证明', '英语成绩证明', '语言证书']),
    'files.award_certificate': Object.freeze(['获奖证明', '获奖证书', '奖励证明', '荣誉证书', '奖项附件']),
    'files.paper': Object.freeze(['论文附件', '论文全文', '论文证明', '论文首页']),
    'files.patent': Object.freeze(['专利证明', '专利附件', '专利证书']),
    'files.research': Object.freeze(['科研证明', '项目证明', '科研附件', '科研材料']),
    'files.practice': Object.freeze(['社会实践证明', '实践证明', '实践附件']),
    'files.internship': Object.freeze(['实习证明', '实习材料', '工作证明']),
    'files.recommendation': Object.freeze(['推荐信', '专家推荐信', '推荐材料']),
    'files.other': Object.freeze(['其他附件', '其他证明', '补充材料']),
  });

  const CATEGORY_BY_PATH = Object.freeze(Object.fromEntries(
    Object.keys(FILE_FIELD_ALIASES).map(path => [path, path.slice('files.'.length)]),
  ));

  function normalize(value) {
    return String(value ?? '').toLowerCase().replace(/[\s\u00a0:：*（）()【】\[\]_.\-/\\]+/g, '');
  }

  function scoreText(text, alias) {
    const source = normalize(text);
    const candidate = normalize(alias);
    if (!source || !candidate) return 0;
    if (source === candidate) return 100;
    if (source.includes(candidate)) return candidate.length >= 4 ? 90 : 72;
    if (candidate.includes(source)) return source.length >= 4 ? 78 : 55;
    const chars = new Set(candidate);
    const overlap = [...new Set(source)].filter(char => chars.has(char)).length;
    return Math.round((overlap / Math.max(chars.size, 1)) * 55);
  }

  function rankFileFields(text) {
    return Object.entries(FILE_FIELD_ALIASES)
      .map(([path, aliases]) => ({
        path,
        category: CATEGORY_BY_PATH[path],
        score: Math.max(...aliases.map(alias => scoreText(text, alias))),
      }))
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score);
  }

  function inferCategoryFromName(fileName) {
    const ranked = rankFileFields(fileName);
    const best = ranked[0] || null;
    const second = ranked[1] || null;
    if (!best || best.score < 78 || (second && best.score - second.score < 12)) {
      return { category: '', path: '', score: best?.score || 0, status: 'NEEDS_CONFIRMATION' };
    }
    return { ...best, status: 'MATCH' };
  }

  return { CATEGORY_BY_PATH, FILE_FIELD_ALIASES, inferCategoryFromName, normalize, rankFileFields, scoreText };
});
