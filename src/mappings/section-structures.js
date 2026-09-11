/*
 * 解放：重复栏目结构的唯一权威定义。
 * Resolver / EmbeddedSectionDetector / ArrayHandler 只从这里读取表头结构，
 * 避免同一栏目在多个模块中各维护一份规则。
 * Copyright (c) 2026 zlh and contributors
 * SPDX-License-Identifier: MIT
 */
(function initSectionStructures(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.JFSectionStructures = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function sectionStructuresFactory() {
  'use strict';

  function freezeGroups(groups) {
    return Object.freeze(groups.map(group => Object.freeze(group.slice())));
  }

  function freezePairedRangeGroups(groups) {
    return Object.freeze(groups.map(group => Object.freeze({
      terms: Object.freeze((group.terms || []).slice()),
      covers: Object.freeze((group.covers || []).filter(Number.isInteger)),
      roles: Object.freeze((group.roles || []).map(role => Object.freeze({
        field: String(role.field || '').trim(),
        semanticLabel: String(role.semanticLabel || '').trim(),
        terms: Object.freeze((role.terms || []).slice()),
      }))),
    })));
  }

  function freezeHeaderVariant(variant, fallbackId) {
    const headerGroups = freezeGroups(variant.headerGroups || []);
    return Object.freeze({
      id: String(variant.id || fallbackId || 'variant').trim(),
      headerGroups,
      pairedRangeGroups: freezePairedRangeGroups(variant.pairedRangeGroups || []),
      minHeaderGroups: Number.isInteger(variant.minHeaderGroups)
        ? Math.max(1, variant.minHeaderGroups)
        : Math.max(2, Math.min(3, headerGroups.length)),
    });
  }

  function definition(sectionId, options) {
    const headerGroups = freezeGroups(options.headerGroups || []);
    const pairedRangeGroups = freezePairedRangeGroups(options.pairedRangeGroups || []);
    const minHeaderGroups = Number.isInteger(options.minHeaderGroups)
      ? Math.max(1, options.minHeaderGroups)
      : Math.max(2, Math.min(3, (options.headerGroups || []).length));
    const headerVariants = Object.freeze([
      Object.freeze({
        id: 'legacy',
        headerGroups,
        pairedRangeGroups,
        minHeaderGroups,
      }),
      ...(options.headerVariants || []).map((variant, index) =>
        freezeHeaderVariant(variant, `variant-${index + 1}`)),
    ]);
    return Object.freeze({
      sectionId,
      collection: options.collection || sectionId,
      collectionMode: options.collectionMode || 'repeatable',
      titleTerms: Object.freeze((options.titleTerms || []).slice()),
      headerGroups,
      pairedRangeGroups,
      minHeaderGroups,
      headerVariants,
      addPattern: options.addPattern || /^(?:新增|添加|新增一行|添加一行|新增一条|添加一条|\+)$/,
    });
  }

  const EMBEDDED_COLLECTION_STRUCTURES = Object.freeze([
    definition('family', {
      titleTerms: ['家庭成员', '家庭主要成员', '家庭信息', '家庭成员信息'],
      headerGroups: [
        ['姓名', '成员姓名'],
        ['关系', '与本人关系', '称谓'],
        ['在何单位任何职', '在何单位工作任何职务', '工作单位及职务', '单位及职务'],
        ['联系电话', '成员电话'],
      ],
      minHeaderGroups: 3,
    }),
    definition('language', {
      titleTerms: ['外语成绩', '外语能力', '语言能力', '外语水平'],
      headerGroups: [
        ['考试名称', '外语考试', '语种', '语言'],
        ['成绩', '外语成绩', '英语成绩', '考试分数'],
      ],
      minHeaderGroups: 2,
    }),
    definition('internships', {
      collection: 'internships',
      titleTerms: ['学习和工作经历', '学习工作经历', '工作经历', '实习经历'],
      headerGroups: [
        ['起始年月', '起始时间', '开始时间'],
        ['结束年月', '结束时间'],
        ['学习工作单位', '学习或工作单位', '学校或工作单位', '实习单位'],
        ['担任职务', '任何职务', '岗位', '职位'],
      ],
      pairedRangeGroups: [{
        terms: ['起止年月', '起止时间', '起止日期', '时间范围'],
        // 一个组合表头只提供两个字段的结构证据；它不会把单个控件匹配到两个字段。
        covers: [0, 1],
        roles: [
          {
            field: 'startDate',
            semanticLabel: '起始时间',
            terms: ['开始', '起始', '开始时间', '开始日期', '起始年月', '入职时间'],
          },
          {
            field: 'endDate',
            semanticLabel: '结束时间',
            terms: ['结束', '截止', '结束时间', '结束日期', '结束年月', '离职时间'],
          },
        ],
      }],
      minHeaderGroups: 3,
    }),
    definition('research', {
      titleTerms: ['科研工作', '科研经历', '科研项目', '研究经历'],
      headerGroups: [
        ['名称', '科研名称', '科研项目名称', '课题名称', '项目名称'],
        ['指导教师', '指导老师', '导师'],
        ['级别', '科研级别', '项目级别'],
        ['主要贡献', '本人主要贡献', '承担工作', '科研内容'],
      ],
      minHeaderGroups: 3,
    }),
    definition('papers', {
      titleTerms: ['论文成果', '论文情况', '发表论文', '学术论文', '代表性论文'],
      headerGroups: [
        ['时间', '发表时间', '发表日期'],
        ['发表刊物或出版社', '发表刊物', '期刊', '出版社'],
        ['成果名称', '论文名称', '论文题目', '论文标题'],
        ['作者排名', '作者位次', '署名顺序'],
      ],
      minHeaderGroups: 3,
    }),
    definition('awards', {
      titleTerms: ['奖励情况', '获奖情况', '奖励与荣誉', '获奖荣誉', '奖惩情况'],
      addPattern: /^(?:新增|添加)(?:一行|一条|奖励|奖项|获奖)?$|^\+$/,
      headerGroups: [
        ['时间', '获奖时间', '奖励时间'],
        ['内容', '获奖内容', '奖励内容', '奖项名称'],
        ['级别', '奖项级别', '奖励级别'],
        ['排名', '团队人数', '获奖等级', '等次'],
      ],
      minHeaderGroups: 3,
      headerVariants: [{
        id: 'competition-award',
        headerGroups: [
          ['竞赛级别', '比赛级别'],
          ['获奖等级', '奖项等级', '奖励等级', '等次'],
          ['获奖名称', '奖项名称', '奖励名称'],
          ['个人/团队', '个人团队', '参赛形式', '参赛方式'],
          ['个人排名', '个人名次'],
        ],
        minHeaderGroups: 4,
      }],
    }),
    definition('practice', {
      titleTerms: ['社会实践', '实践经历', '社会活动', '志愿服务'],
      headerGroups: [
        ['开始时间', '起始时间'],
        ['结束时间'],
        ['地点', '实践地点', '活动地点'],
        ['主要内容', '实践内容', '活动内容'],
      ],
      minHeaderGroups: 3,
    }),
  ]);

  const SECTION_ALIASES = Object.freeze({
    internship: 'internships',
    internships: 'internships',
  });

  const STRUCTURE_BY_SECTION = Object.freeze(
    Object.fromEntries(
      EMBEDDED_COLLECTION_STRUCTURES.map(item => [item.sectionId, item]),
    ),
  );

  const SECTION_TABLE_SIGNATURES = Object.freeze(
    Object.fromEntries(
      EMBEDDED_COLLECTION_STRUCTURES.map(item => [item.sectionId, item.headerGroups]),
    ),
  );

  function safeText(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
  }

  function normalizeStructureText(value) {
    return safeText(value)
      .replace(/[\s:：,，.。;；、（）()\[\]【】/_-]+/g, '')
      .toLowerCase();
  }

  function canonicalSectionId(sectionId) {
    const value = safeText(sectionId);
    return SECTION_ALIASES[value] || value;
  }

  function definitionForSection(sectionId) {
    return STRUCTURE_BY_SECTION[canonicalSectionId(sectionId)] || null;
  }

  function headerGroupsFor(sectionId) {
    return definitionForSection(sectionId)?.headerGroups || Object.freeze([]);
  }

  function pairedRangeForHeader(sectionId, header) {
    const definitionValue = definitionForSection(sectionId);
    const matches = (definitionValue?.pairedRangeGroups || []).filter(group =>
      group.terms.some(term => headerMatchesTerm(header, term)),
    );
    return matches.length === 1 ? matches[0] : null;
  }

  function resolvePairedRangeRole(options = {}) {
    const rule = pairedRangeForHeader(
      options.sectionId || options.section || options.collection,
      options.header,
    );
    if (!rule) return null;

    const semanticText = safeText(options.semanticText);
    if (semanticText) {
      const roles = rule.roles.filter(role =>
        role.terms.some(term => headerMatchesTerm(semanticText, term)),
      );
      if (roles.length === 1) {
        return Object.freeze({
          field: roles[0].field,
          semanticLabel: roles[0].semanticLabel,
          source: 'explicit-semantic',
        });
      }

      // 组件可能把组合表头本身重复为两个 input 的 label。它仍然没有区分
      // start/end，因此等价于“无字段级语义”，可以继续进入严格双控件顺序。
      const normalizedSemantic = normalizeStructureText(semanticText);
      const isGenericRangeCaption = rule.terms.some(term =>
        normalizedSemantic === normalizeStructureText(term),
      );
      if (!isGenericRangeCaption) return null;
    }

    const controlCount = Number(options.controlCount);
    const controlIndex = Number(options.controlIndex);
    if (
      !Number.isInteger(controlCount)
      || controlCount !== rule.roles.length
      || !Number.isInteger(controlIndex)
      || controlIndex < 0
      || controlIndex >= controlCount
    ) {
      return null;
    }

    return Object.freeze({
      field: rule.roles[controlIndex].field,
      semanticLabel: rule.roles[controlIndex].semanticLabel,
      source: 'cell-order',
    });
  }

  function headerMatchesTerm(header, term) {
    const normalizedHeader = normalizeStructureText(header);
    const normalizedTerm = normalizeStructureText(term);
    if (!normalizedHeader || !normalizedTerm) return false;
    if (normalizedHeader === normalizedTerm) return true;
    if (normalizedHeader.includes(normalizedTerm)) return true;

    // 只允许较长文本做反向包含，避免“名称/内容”等弱词跨栏目误判。
    return normalizedHeader.length >= 4
      && normalizedTerm.length >= 4
      && normalizedTerm.includes(normalizedHeader);
  }

  function scoreHeaderVariant(normalizedHeaders, definitionValue, variant) {
    const variants = definitionValue.headerVariants || [variant];
    const headerOwners = normalizedHeaders.map(header => {
      const matches = [];
      variants.forEach(candidate => candidate.headerGroups.forEach(group => group.forEach(term => {
        if (!headerMatchesTerm(header, term)) return;
        matches.push({
          variantId: candidate.id,
          specificity: normalizeStructureText(term).length,
        });
      })));
      const strongest = Math.max(0, ...matches.map(match => match.specificity));
      return new Set(matches
        .filter(match => match.specificity === strongest)
        .map(match => match.variantId));
    });
    const matchedIndexes = new Set();
    const matchedPhysicalHeaderIndexes = new Set();
    variant.headerGroups.forEach((group, index) => {
      normalizedHeaders.forEach((header, headerIndex) => {
        if (headerOwners[headerIndex].size && !headerOwners[headerIndex].has(variant.id)) return;
        if (!group.some(term => headerMatchesTerm(header, term))) return;
        matchedIndexes.add(index);
        matchedPhysicalHeaderIndexes.add(headerIndex);
      });
    });
    const matchedPairedRanges = (variant.pairedRangeGroups || []).filter(group => {
      let matched = false;
      normalizedHeaders.forEach((header, headerIndex) => {
        if (headerOwners[headerIndex].size && !headerOwners[headerIndex].has(variant.id)) return;
        if (!group.terms.some(term => headerMatchesTerm(header, term))) return;
        matched = true;
        matchedPhysicalHeaderIndexes.add(headerIndex);
      });
      return matched;
    });
    matchedPairedRanges.forEach(group => group.covers.forEach(index => {
      if (index >= 0 && index < variant.headerGroups.length) matchedIndexes.add(index);
    }));
    const matchedGroups = [...matchedIndexes]
      .sort((left, right) => left - right)
      .map(index => variant.headerGroups[index]);
    const matchedCount = matchedGroups.length;
    const required = variant.minHeaderGroups;
    const physicalHeaderCount = matchedPhysicalHeaderIndexes.size;
    // A compound range caption may cover start/end logically, but it must not let
    // two generic physical columns bypass a section's existing structural threshold.
    const physicalThresholdMet = !matchedPairedRanges.length || physicalHeaderCount >= required;
    const coverage = variant.headerGroups.length
      ? matchedCount / variant.headerGroups.length
      : 0;
    const qualifies = matchedCount >= required && physicalThresholdMet;
    const confidence = qualifies
      ? Math.min(0.98, 0.72 + matchedCount * 0.055 + coverage * 0.04)
      : 0;

    return Object.freeze({
      qualifies,
      variantId: variant.id,
      matchedCount,
      required,
      physicalHeaderCount,
      coverage: Number(coverage.toFixed(3)),
      confidence: Number(confidence.toFixed(3)),
      matchedGroups: Object.freeze(matchedGroups.slice()),
      matchedPairedRanges: Object.freeze(matchedPairedRanges.slice()),
    });
  }

  function scoreHeaderGroups(headers, sectionOrDefinition) {
    const definitionValue = typeof sectionOrDefinition === 'string'
      ? definitionForSection(sectionOrDefinition)
      : sectionOrDefinition;
    if (!definitionValue) {
      return Object.freeze({
        qualifies: false,
        variantId: '',
        matchedCount: 0,
        required: 0,
        coverage: 0,
        confidence: 0,
        physicalHeaderCount: 0,
        matchedGroups: Object.freeze([]),
        matchedPairedRanges: Object.freeze([]),
      });
    }

    const normalizedHeaders = (headers || [])
      .map(normalizeStructureText)
      .filter(Boolean);
    const variants = definitionValue.headerVariants || [Object.freeze({
      id: 'legacy',
      headerGroups: definitionValue.headerGroups,
      pairedRangeGroups: definitionValue.pairedRangeGroups || Object.freeze([]),
      minHeaderGroups: definitionValue.minHeaderGroups,
    })];
    return variants
      .map(variant => scoreHeaderVariant(normalizedHeaders, definitionValue, variant))
      .sort((left, right) =>
        Number(right.qualifies) - Number(left.qualifies)
        || right.matchedCount - left.matchedCount
        || right.coverage - left.coverage
        || right.confidence - left.confidence
        || left.variantId.localeCompare(right.variantId),
      )[0];
  }

  function rankDefinitionsForHeaders(headers) {
    return EMBEDDED_COLLECTION_STRUCTURES
      .map(item => ({ definition: item, score: scoreHeaderGroups(headers, item) }))
      .filter(item => item.score.qualifies)
      .sort((left, right) =>
        right.score.matchedCount - left.score.matchedCount
        || right.score.coverage - left.score.coverage
        || right.score.confidence - left.score.confidence
        || left.definition.sectionId.localeCompare(right.definition.sectionId),
      );
  }

  function selectBestDefinitionForHeaders(headers) {
    const ranked = rankDefinitionsForHeaders(headers);
    const best = ranked[0] || null;
    const second = ranked[1] || null;
    if (!best) return null;

    // 相同命中数和覆盖率时保持保守，不把一个 DOM 区域同时解释为两个栏目。
    if (
      second
      && best.score.matchedCount === second.score.matchedCount
      && best.score.coverage === second.score.coverage
    ) {
      return null;
    }

    return best;
  }

  return Object.freeze({
    EMBEDDED_COLLECTION_STRUCTURES,
    SECTION_TABLE_SIGNATURES,
    STRUCTURE_BY_SECTION,
    canonicalSectionId,
    definitionForSection,
    headerGroupsFor,
    headerMatchesTerm,
    normalizeStructureText,
    pairedRangeForHeader,
    rankDefinitionsForHeaders,
    resolvePairedRangeRole,
    scoreHeaderGroups,
    selectBestDefinitionForHeaders,
  });
});
