/*
 * 解放：报名系统栏目语义映射
 * Copyright (c) 2026 zlh and contributors
 * SPDX-License-Identifier: MIT
 */
(function initSectionAliases(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.JFSectionAliases = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function sectionAliasesFactory() {
  'use strict';

  const SECTION_ALIASES = Object.freeze({
    basic: Object.freeze([
      '基本信息', '个人信息', '基本资料', '个人资料', '个人基本信息', '申请人信息', '学生基本信息',
    ]),
    contact: Object.freeze([
      '联系方式', '联系信息', '通讯信息', '通讯方式', '联系资料',
    ]),
    family: Object.freeze([
      '家庭信息', '家庭成员', '家庭情况', '家庭主要成员', '主要家庭成员',
      '家庭主要成员及主要社会关系', '家庭成员及主要社会关系', '主要社会关系',
    ]),
    education: Object.freeze([
      '教育经历', '教育背景', '学习经历', '学历信息', '学习信息', '本科信息', '院校经历',
      '在校学习信息', '本科阶段学习信息',
    ]),
    awards: Object.freeze([
      '奖励或处分', '奖励与处分', '获奖情况', '奖励情况', '荣誉奖励', '奖惩情况', '荣誉称号',
      '奖励与荣誉', '获奖经历', '获奖荣誉',
    ]),
    research: Object.freeze([
      '科研经历', '科研情况', '科研项目', '科研成果', '学术成果', '学术科研', '科研工作',
    ]),
    projects: Object.freeze([
      '项目经历', '项目经验', '创新项目', '创新创业项目', '竞赛项目',
    ]),
    papers: Object.freeze([
      '论文成果', '论文情况', '发表论文', '学术论文', '论文著作', '代表性论文',
    ]),
    patents: Object.freeze([
      '专利', '专利成果', '知识产权', '发明专利', '授权专利',
    ]),
    practice: Object.freeze([
      '社会实践', '实践经历', '社会活动', '志愿服务', '志愿经历',
    ]),
    internship: Object.freeze([
      '实习经历', '工作实习', '实践实习', '实习情况', '工作经历', '工作和实习经历', '学习和工作经历',
    ]),
    student_work: Object.freeze([
      '学生工作', '学生干部', '任职经历', '校园经历', '校内任职', '社团经历',
    ]),
    certificates: Object.freeze([
      '资格证书', '技能证书', '证书情况', '资质证书', '证书与资格',
    ]),
    language: Object.freeze([
      '语言能力', '外语能力', '英语水平', '外语水平', '语言水平', '英语能力',
    ]),
    skills: Object.freeze([
      '专业技能', '个人技能', '技能特长', '计算机水平', '计算机能力', '其他技能',
    ]),
  });

  // 这些词单独出现时信息量不足，不能据此强制确定栏目。
  const WEAK_SECTION_TERMS = Object.freeze(new Set([
    '信息', '资料', '情况', '经历', '成果', '能力', '水平', '其他', '维护', '填写', '修改', '申请信息',
  ]));

  const SECTION_COLLECTIONS = Object.freeze({
    basic: 'basic',
    contact: 'contact',
    family: 'family',
    education: 'education',
    awards: 'awards',
    research: 'research',
    projects: 'projects',
    papers: 'papers',
    patents: 'patents',
    practice: 'practice',
    internship: 'internships',
    internships: 'internships',
    student_work: 'student_work',
    certificates: 'certificates',
    language: 'language',
    skills: 'skills',
  });

  const ARRAY_COLLECTIONS = Object.freeze(new Set([
    'family', 'education', 'awards', 'research', 'projects', 'papers', 'patents',
    'practice', 'internships', 'student_work', 'certificates', 'language',
  ]));

  function safeString(value) {
    return value === null || value === undefined ? '' : String(value).trim();
  }

  function normalizeSectionText(value) {
    return safeString(value)
      .replace(/[✓✔√×✕✖○●◉→>»]+/g, '')
      .replace(/(?:已完成|未完成|待填写|已填写|必填|选填)\s*\d*\s*(?:步|项|条)?/g, '')
      .replace(/[（(]\s*(?:共)?\s*\d+\s*(?:步|项|条)?\s*[）)]/g, '')
      .replace(/^\s*\d+[.、．]\s*/, '')
      .replace(/[\s\u00a0:：*【】\[\]（）(){}<>《》,，.。;；、!！?？“”‘’·…—–/_-]+/g, '')
      .toLowerCase();
  }

  function collectionForSection(section) {
    const normalized = safeString(section);
    return SECTION_COLLECTIONS[normalized] || normalized || null;
  }

  function collectionModeForSection(section) {
    const collection = collectionForSection(section);
    if (!collection) return 'unknown';
    return ARRAY_COLLECTIONS.has(collection) ? 'array' : 'record';
  }

  function bigramSimilarity(left, right) {
    if (!left || !right) return 0;
    if (left === right) return 1;
    if (left.includes(right) || right.includes(left)) {
      const shorter = Math.min(left.length, right.length);
      const longer = Math.max(left.length, right.length);
      return 0.78 + 0.18 * (shorter / longer);
    }
    if (left.length < 2 || right.length < 2) return 0;
    const make = value => {
      const result = new Set();
      for (let index = 0; index < value.length - 1; index += 1) result.add(value.slice(index, index + 2));
      return result;
    };
    const a = make(left);
    const b = make(right);
    let intersection = 0;
    a.forEach(token => { if (b.has(token)) intersection += 1; });
    return intersection / Math.max(1, a.size + b.size - intersection);
  }

  function scoreAlias(text, alias) {
    const normalizedText = normalizeSectionText(text);
    const normalizedAlias = normalizeSectionText(alias);
    if (!normalizedText || !normalizedAlias) return 0;
    if (normalizedText === normalizedAlias) return 1;
    if (WEAK_SECTION_TERMS.has(normalizedText)) return 0;
    if (normalizedText.includes(normalizedAlias)) {
      const noise = Math.max(0, normalizedText.length - normalizedAlias.length);
      return Math.max(0.78, 0.94 - noise * 0.012);
    }
    if (normalizedAlias.includes(normalizedText)) {
      // “项目”“论文”等短片段只可作为弱证据，不能独立强判。
      if (normalizedText.length < 4) return 0.42;
      return 0.7;
    }
    const similarity = bigramSimilarity(normalizedText, normalizedAlias);
    return similarity >= 0.55 ? Math.min(0.76, similarity) : 0;
  }

  function contextTexts(context) {
    if (!context) return [];
    if (typeof context === 'string') return [context];
    if (Array.isArray(context)) return context;
    return [
      context.ariaLabel,
      context.title,
      context.parentText,
      context.groupText,
      context.breadcrumb,
      context.hrefText,
    ].filter(Boolean);
  }

  /**
   * 将导航文字分类为统一栏目。
   * 返回对象而不是仅返回字符串，以便调用方对低分和歧义结果保持保守。
   */
  function classifySection(text, context = {}) {
    const primary = safeString(text);
    const extras = contextTexts(context).map(safeString).filter(Boolean);
    const scores = [];

    Object.entries(SECTION_ALIASES).forEach(([section, aliases]) => {
      let best = { score: 0, alias: '', source: '' };
      aliases.forEach(alias => {
        const primaryScore = scoreAlias(primary, alias);
        if (primaryScore > best.score) best = { score: primaryScore, alias, source: 'text' };
        extras.forEach(extra => {
          // 上下文只补强，永远不能单独产生高置信分类。
          const contextScore = scoreAlias(extra, alias) * 0.58;
          if (contextScore > best.score) best = { score: contextScore, alias, source: 'context' };
        });
      });
      scores.push({ section, ...best });
    });

    scores.sort((a, b) => b.score - a.score || a.section.localeCompare(b.section));
    const best = scores[0] || { section: null, score: 0, alias: '', source: '' };
    const second = scores[1] || { score: 0 };
    const ambiguityMargin = Number.isFinite(context?.ambiguityMargin)
      ? Math.max(0, Number(context.ambiguityMargin))
      : 0.09;
    const minScore = Number.isFinite(context?.minScore)
      ? Math.max(0, Math.min(1, Number(context.minScore)))
      : 0.68;
    const ambiguous = best.score >= minScore && best.score - second.score < ambiguityMargin;
    const accepted = best.score >= minScore && !ambiguous;

    return {
      section: accepted ? best.section : null,
      score: Number(best.score.toFixed(3)),
      confidence: Number(best.score.toFixed(3)),
      matchedAlias: best.alias || null,
      source: best.source || null,
      ambiguous,
      candidates: scores.slice(0, 3).map(item => ({
        section: item.section,
        score: Number(item.score.toFixed(3)),
        matchedAlias: item.alias || null,
      })),
    };
  }

  return {
    ARRAY_COLLECTIONS,
    SECTION_COLLECTIONS,
    SECTION_ALIASES,
    WEAK_SECTION_TERMS,
    bigramSimilarity,
    classifySection,
    collectionForSection,
    collectionModeForSection,
    normalizeSectionText,
    scoreAlias,
  };
});
