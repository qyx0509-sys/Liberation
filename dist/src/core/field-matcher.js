/*
 * 解放：字段语义评分与 Resume JSON 匹配
 * Copyright (c) 2026 zlh and contributors
 * SPDX-License-Identifier: MIT
 */
(function initFieldMatcher(root, factory) {
  let aliases = root?.JFFieldAliases;
  let semantics = root?.JFFieldSemanticNormalizer;
  if (typeof module === 'object' && module.exports) {
    aliases = require('../mappings/field-aliases.js');
    semantics = require('../semantics/field-semantic-normalizer.js');
  }
  const api = factory(aliases, semantics);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.JFFieldMatcher = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function fieldMatcherFactory(F, S) {
  'use strict';

  const MATCH_STATUS = Object.freeze({
    MATCHED: 'MATCHED',
    UNMATCHED: 'UNMATCHED',
    MISSING_JSON: 'MISSING_JSON',
    NEEDS_CONFIRMATION: 'NEEDS_CONFIRMATION',
    SKIPPED: 'SKIPPED',
  });

  const SOURCE_WEIGHTS = Object.freeze({
    labelText: 50,
    tableHeader: 46,
    ariaLabel: 32,
    // 去掉明确“请输入/请选择”后的语义仍只是 fallback；
    // 分值严格低于真实 label/table header。
    semanticPlaceholder: 38,
    placeholder: 27,
    name: 21,
    id: 18,
    title: 16,
    groupText: 16,
    nearbyText: 11,
    parentText: 8,
  });

  const STRONG_NEARBY_WEIGHT = 46;
  const STRONG_NEARBY_MAX_LENGTH = 18;

  const RELATED_SECTIONS = Object.freeze({
    basic: new Set(['basic', 'contact', 'application', 'language']),
    contact: new Set(['contact', 'basic']),
    internship: new Set(['internships', 'practice']),
    internships: new Set(['internships', 'practice']),
    research: new Set(['research', 'projects']),
    projects: new Set(['projects', 'research']),
    language: new Set(['language', 'certificates']),
    certificates: new Set(['certificates', 'language']),
  });
  const SECTION_CONTEXT_MIN_CONFIDENCE = 0.68;
  const GLOBAL_FALLBACK_SCORE_BONUS = 8;
  const COMPOUND_SINGLETON_COLLECTIONS = Object.freeze(new Set(['education', 'language']));
  const SINGLETON_SLOT_ROOT_SELECTOR = [
    '[data-singleton-slot]',
    '[data-singleton-slot-id]',
    '[data-repeat-item]',
    '[data-repeat-row]',
    '[data-array-item]',
    '[data-array-row]',
    'tr',
    '[role="row"]',
  ].join(',');
  const SINGLETON_SLOT_ATTRIBUTES = Object.freeze([
    'data-singleton-slot',
    'data-singleton-slot-id',
    'data-repeat-item',
    'data-repeat-row',
    'data-array-item',
    'data-array-row',
  ]);
  const SINGLETON_BINDING_REASON_CODES = Object.freeze({
    SINGLETON_SINGLE_JSON_ITEM: 'SINGLETON_SINGLE_JSON_ITEM',
    // Keep the property alias for callers compiled against the earlier constant name.
    SINGLE_JSON_ITEM: 'SINGLETON_SINGLE_JSON_ITEM',
    UNIQUE_DISCRIMINATOR_MATCH: 'UNIQUE_DISCRIMINATOR_MATCH',
    NO_JSON_ITEMS: 'NO_JSON_ITEMS',
    NO_DISCRIMINATOR: 'NO_DISCRIMINATOR',
    NO_DISCRIMINATOR_MATCH: 'NO_DISCRIMINATOR_MATCH',
    AMBIGUOUS_DISCRIMINATOR: 'AMBIGUOUS_DISCRIMINATOR',
    PAGE_SLOT_COUNT_NOT_SINGLETON: 'PAGE_SLOT_COUNT_NOT_SINGLETON',
    JSON_ITEM_LIMIT_EXCEEDED: 'JSON_ITEM_LIMIT_EXCEEDED',
  });
  const MAX_SINGLETON_BINDING_ITEMS = 500;
  const SINGLETON_DISCRIMINATOR_PATHS = Object.freeze({
    language: new Set(['language[].language', 'language[].certificate']),
  });

  function ensureDependencies() {
    if (!F?.FIELD_DEFINITIONS || !F?.resolveValue) throw new Error('JFFieldAliases 未加载');
    if (!S?.normalizeFieldPhrase) throw new Error('JFFieldSemanticNormalizer 未加载');
  }

  function safeString(value) {
    return value === null || value === undefined ? '' : String(value).trim();
  }

  function normalizedFieldPath(value) {
    return safeString(value).replace(/\[\d+\]/g, '[]');
  }

  /*
   * Site Profile aliases are invocation-local evidence. Never merge them into
   * FIELD_DEFINITIONS/FIELD_ALIASES: two tabs may resolve different profiles in
   * the same extension process, and a global merge would leak one site's rules
   * into every later match.
   */
  function localAliasesFor(definition, options = {}) {
    const table = options?.fieldAliases;
    if (!table || typeof table !== 'object' || Array.isArray(table)) return [];
    const path = normalizedFieldPath(definition?.path);
    let descriptor;
    try { descriptor = Object.getOwnPropertyDescriptor(table, path); }
    catch (_) { return []; }
    if (!descriptor || typeof descriptor.get === 'function' || typeof descriptor.set === 'function') return [];
    const aliases = descriptor.value;
    if (!Array.isArray(aliases)) return [];
    return aliases.slice(0, 30)
      .filter(alias => typeof alias === 'string')
      .map(alias => safeString(alias).slice(0, 160))
      .filter(Boolean);
  }

  function aliasContextSection(descriptor, options = {}) {
    return normalizeSection(
      options?.sectionContextNormalized?.collection
      || currentSection(descriptor, options),
    );
  }

  function aliasesForDefinition(definition, descriptor, options = {}) {
    const sectionAliases = Array.isArray(definition?.sectionAliases)
      ? definition.sectionAliases
      : [];
    const sectionAliasesAllowed = sectionAliases.length > 0
      && aliasContextSection(descriptor, options) === pathSection(definition?.path);
    return [...new Set([
      ...(Array.isArray(definition?.aliases) ? definition.aliases : []),
      ...(sectionAliasesAllowed ? sectionAliases : []),
      ...localAliasesFor(definition, options),
    ])];
  }

  function blockedSectionAlias(descriptor, options = {}) {
    const primaryTexts = [
      descriptor?.labelText,
      descriptor?.tableHeader,
      descriptor?.ariaLabel,
      descriptor?.semanticPlaceholder,
    ].map(normalized).filter(Boolean);
    if (!primaryTexts.length) return null;

    const activeSection = aliasContextSection(descriptor, options);
    const owners = F.FIELD_DEFINITIONS.filter(definition => {
      const aliases = Array.isArray(definition?.sectionAliases) ? definition.sectionAliases : [];
      return aliases.some(alias => primaryTexts.includes(normalized(alias)));
    });
    if (!owners.length || owners.some(definition => pathSection(definition.path) === activeSection)) {
      return null;
    }
    return {
      aliases: [...new Set(owners.flatMap(definition => definition.sectionAliases || []))],
      sections: [...new Set(owners.map(definition => pathSection(definition.path)))],
      paths: [...new Set(owners.map(definition => normalizedFieldPath(definition.path)))],
      activeSection,
    };
  }

  function definitionBlockedBySectionAlias(definition, descriptor, options = {}) {
    const block = options?.sectionAliasBlock || blockedSectionAlias(descriptor, options);
    if (!block) return false;
    return block.paths.includes(normalizedFieldPath(definition?.path));
  }

  function normalized(value) {
    return S.normalizeFieldPhrase(value, {
      baseNormalizer: F?.normalizeFieldText,
    });
  }

  function bigramSimilarity(left, right) {
    if (left.length < 2 || right.length < 2) return 0;
    const tokenize = value => {
      const set = new Set();
      for (let index = 0; index < value.length - 1; index += 1) set.add(value.slice(index, index + 2));
      return set;
    };
    const a = tokenize(left);
    const b = tokenize(right);
    let intersection = 0;
    a.forEach(token => { if (b.has(token)) intersection += 1; });
    return intersection / Math.max(1, a.size + b.size - intersection);
  }

  function textSimilarity(sourceText, aliasText) {
    const source = normalized(sourceText);
    const alias = normalized(aliasText);
    if (!source || !alias) return 0;
    if (source === alias) return 1;
    if (source.includes(alias)) {
      if (alias.length === 1 && source.length > 1) return 0.3;
      const ratio = alias.length / source.length;
      return Math.min(0.94, 0.74 + ratio * 0.2);
    }
    if (alias.includes(source)) {
      if (source.length < 2) return 0.2;
      const ratio = source.length / alias.length;
      return Math.min(0.82, 0.6 + ratio * 0.22);
    }
    const fuzzy = bigramSimilarity(source, alias);
    return fuzzy >= 0.55 ? Math.min(0.78, fuzzy) : 0;
  }

  function bestAliasScore(sourceText, aliases, weight) {
    let best = { score: 0, alias: '', similarity: 0 };
    (aliases || []).forEach(alias => {
      const similarity = textSimilarity(sourceText, alias);
      const score = similarity * weight;
      if (score > best.score) best = { score, alias, similarity };
    });
    return best;
  }

  function exactAnnotatedBaseAlias(sourceText, aliases) {
    const source = safeString(sourceText);
    const delimiterIndex = source.search(/[（(\[【]/u);
    if (delimiterIndex <= 0 || !safeString(source.slice(delimiterIndex + 1))) return null;
    const baseLabel = safeString(source.slice(0, delimiterIndex));
    const normalizedBase = normalized(baseLabel);
    if (!normalizedBase) return null;
    const alias = (aliases || []).find(candidate => normalized(candidate) === normalizedBase);
    return alias ? { alias, baseLabel } : null;
  }

  function bestSourceAliasScore(descriptor, source, aliases, weight) {
    const sourceText = descriptor?.[source];

    // A trailing parenthesized/bracketed annotation must not dilute an exact
    // base label (for example “本科GPA（…示例…）”). Only the literal prefix
    // before an explicit annotation delimiter may supply this evidence; free
    // suffixes such as “本科GPA排名” remain ordinary fuzzy text.
    if (source === 'labelText') {
      const direct = bestAliasScore(sourceText, aliases, weight);
      if (direct.similarity === 1) return direct;
      const annotated = exactAnnotatedBaseAlias(sourceText, aliases);
      if (annotated) {
        return {
          score: weight,
          alias: annotated.alias,
          similarity: 1,
          annotationBase: true,
        };
      }
      return direct;
    }

    // semanticPlaceholder 已经是同一 placeholder 的去提示词表达，不双重计分。
    if (source === 'placeholder' && safeString(descriptor?.semanticPlaceholder)) {
      return { score: 0, alias: '', similarity: 0 };
    }

    // 其他证据来源保持原有评分逻辑
    if (source !== 'nearbyText') {
      return bestAliasScore(sourceText, aliases, weight);
    }

    // nearbyText 默认仍然只按原来的 11 分计算
    const normalResult = bestAliasScore(sourceText, aliases, weight);
    const nearby = normalized(sourceText);

    if (!nearby || nearby.length > STRONG_NEARBY_MAX_LENGTH) {
      return normalResult;
    }

    // 只有“短文本 + 与 alias 完全一致”时，
    // 才把 nearbyText 视为真正的字段标签。
    for (const alias of aliases || []) {
      const normalizedAlias = normalized(alias);

      if (normalizedAlias && nearby === normalizedAlias) {
        return {
          score: STRONG_NEARBY_WEIGHT,
          alias,
          similarity: 1,
          strongNearby: true,
        };
      }
    }

    return normalResult;
  }


  function normalizeSection(section) {
    const value = safeString(section);
    return F?.SECTION_KEY_MAP?.[value] || value;
  }

  function pathSection(path) {
    return normalizeSection(safeString(path).split(/[.\[]/)[0]);
  }

  function semanticCollectionFromPath(path) {
    const normalizedPath = normalizedFieldPath(path);
    const match = normalizedPath.match(
      /^([A-Za-z][A-Za-z0-9_-]{0,79})(?:\[\])?(?=\.|$)/,
    );
    return match ? normalizeSection(match[1]) : '';
  }

  function ownValue(source, key) {
    if (!source || typeof source !== 'object' || Array.isArray(source)) return undefined;
    try {
      const descriptor = Object.getOwnPropertyDescriptor(source, key);
      return descriptor && !descriptor.get && !descriptor.set ? descriptor.value : undefined;
    } catch (_) {
      return undefined;
    }
  }

  function singletonDiscriminator(raw, collection) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const rawFieldPath = safeString(ownValue(raw, 'fieldPath') || ownValue(raw, 'path'));
    const fieldPath = normalizedFieldPath(
      rawFieldPath.includes('.') || rawFieldPath.includes('[]')
        ? rawFieldPath
        : `${collection}[].${rawFieldPath}`,
    );
    const rawValue = ownValue(raw, 'value');
    if (!fieldPath || !['string', 'number', 'boolean'].includes(typeof rawValue)) return null;
    const value = safeString(rawValue).slice(0, 160);
    if (!value || pathSection(fieldPath) !== collection) return null;
    const definitionExists = F.FIELD_DEFINITIONS.some(definition =>
      normalizedFieldPath(definition.path) === fieldPath
    );
    if (!definitionExists) return null;
    return {
      fieldPath,
      value,
      source: safeString(ownValue(raw, 'source') || 'page-static-discriminator').slice(0, 60),
    };
  }

  function singletonDiscriminatorFor(descriptor, options, sectionContext, collection) {
    const binding = ownValue(options, 'singletonBinding');
    const sources = [
      ownValue(options, 'singletonDiscriminator'),
      ownValue(binding, 'discriminator'),
      ownValue(sectionContext, 'singletonDiscriminator'),
      ownValue(descriptor, 'singletonDiscriminator'),
      ownValue(descriptor?.context, 'singletonDiscriminator'),
    ];
    for (const source of sources) {
      const normalizedDiscriminator = singletonDiscriminator(source, collection);
      if (normalizedDiscriminator) return normalizedDiscriminator;
    }
    return null;
  }

  function pageSlotCountFor(descriptor, options, sectionContext, collection) {
    const binding = ownValue(options, 'singletonBinding');
    const perCollection = ownValue(options, 'singletonPageSlotCounts');
    const candidates = [
      ownValue(perCollection, collection),
      ownValue(options, 'singletonPageSlotCount'),
      ownValue(options, 'pageSlotCount'),
      ownValue(binding, 'pageSlotCount'),
      ownValue(sectionContext, 'pageSlotCount'),
      ownValue(descriptor, 'pageSlotCount'),
      ownValue(descriptor?.context, 'pageSlotCount'),
    ];
    for (const candidate of candidates) {
      const number = Number(candidate);
      if (Number.isInteger(number) && number >= 0) return Math.min(number, 100);
    }
    // This policy is entered only for a non-repeatable singleton view or the
    // bounded compound-field fallback, both of which represent one page slot.
    return 1;
  }

  function normalizedDiscriminatorValue(value) {
    let text = safeString(value).slice(0, 160);
    try { text = text.normalize('NFKC'); } catch (_) { /* keep bounded text */ }
    return text.replace(/[\s\u00a0]+/g, '').toLocaleLowerCase();
  }

  function itemValueAtPath(item, fieldPath, collection) {
    const prefix = `${collection}[].`;
    if (!fieldPath.startsWith(prefix)) return undefined;
    let value = item;
    for (const token of fieldPath.slice(prefix.length).split('.').filter(Boolean)) {
      value = value?.[token];
      if (value === undefined || value === null) return value;
    }
    return value;
  }

  function singletonBindingDecision(collection, resumeView, descriptor, options = {}, sectionContext = null) {
    const items = Array.isArray(resumeView?.[collection]) ? resumeView[collection] : [];
    const pageSlotCount = pageSlotCountFor(descriptor, options, sectionContext, collection);
    const debugBase = {
      collection,
      pageSlotCount,
      jsonItemCount: items.length,
      discriminator: null,
      candidateIndexes: [],
      selectedIndex: null,
      reasonCode: SINGLETON_BINDING_REASON_CODES.NO_JSON_ITEMS,
    };
    if (pageSlotCount !== 1) {
      return {
        selectedIndex: null,
        debug: { ...debugBase, reasonCode: SINGLETON_BINDING_REASON_CODES.PAGE_SLOT_COUNT_NOT_SINGLETON },
      };
    }
    if (items.length === 0) return { selectedIndex: null, debug: debugBase };
    if (items.length === 1) {
      return {
        selectedIndex: 0,
        debug: {
          ...debugBase,
          candidateIndexes: [0],
          selectedIndex: 0,
          reasonCode: SINGLETON_BINDING_REASON_CODES.SINGLE_JSON_ITEM,
        },
      };
    }
    if (items.length > MAX_SINGLETON_BINDING_ITEMS) {
      return {
        selectedIndex: null,
        debug: { ...debugBase, reasonCode: SINGLETON_BINDING_REASON_CODES.JSON_ITEM_LIMIT_EXCEEDED },
      };
    }

    const discriminator = singletonDiscriminatorFor(descriptor, options, sectionContext, collection);
    if (!discriminator) {
      return {
        selectedIndex: null,
        debug: { ...debugBase, reasonCode: SINGLETON_BINDING_REASON_CODES.NO_DISCRIMINATOR },
      };
    }
    const expected = normalizedDiscriminatorValue(discriminator.value);
    const candidateIndexes = items
      .map((item, index) => ({
        index,
        value: normalizedDiscriminatorValue(itemValueAtPath(item, discriminator.fieldPath, collection)),
      }))
      .filter(candidate => expected && candidate.value === expected)
      .map(candidate => candidate.index);
    const metadataDiscriminator = {
      fieldPath: discriminator.fieldPath,
      source: discriminator.source,
    };
    if (candidateIndexes.length === 1) {
      return {
        selectedIndex: candidateIndexes[0],
        debug: {
          ...debugBase,
          discriminator: metadataDiscriminator,
          candidateIndexes,
          selectedIndex: candidateIndexes[0],
          reasonCode: SINGLETON_BINDING_REASON_CODES.UNIQUE_DISCRIMINATOR_MATCH,
        },
      };
    }
    return {
      selectedIndex: null,
      debug: {
        ...debugBase,
        discriminator: metadataDiscriminator,
        candidateIndexes,
        reasonCode: candidateIndexes.length
          ? SINGLETON_BINDING_REASON_CODES.AMBIGUOUS_DISCRIMINATOR
          : SINGLETON_BINDING_REASON_CODES.NO_DISCRIMINATOR_MATCH,
      },
    };
  }

  function sectionContextFor(descriptor, options = {}) {
    /*
     * Phase 3.1-C:
     * Context 优先级：
     * 1. 调用方显式传入 sectionContext
     * 2. FieldDetector 生成的 descriptor.context
     * 3. 旧逻辑 fallback
     *
     * 让 Matcher 真正消费 FieldContext，
     * 避免同一个字段被不同模块重复猜测 section。
     */
    const raw =
      (options.sectionContext && typeof options.sectionContext === 'object')
        ? options.sectionContext
        : (
            descriptor?.context
            && typeof descriptor.context === 'object'
              ? descriptor.context
              : null
          );

    if (!raw || typeof raw !== 'object') return null;
    const sectionId = normalizeSection(raw.sectionId || '');
    const collection = normalizeSection(raw.collection || sectionId);
    const confidence = Math.max(0, Math.min(1, Number(raw.confidence) || 0));
    if (['other', 'unknown'].includes(String(sectionId || collection).toLowerCase())) return null;
    if (!collection || confidence < SECTION_CONTEXT_MIN_CONFIDENCE) return null;
    const discriminator = singletonDiscriminator(raw.singletonDiscriminator, collection);
    const rawPageSlotCount = Number(raw.pageSlotCount ?? raw.singletonPageSlotCount);
    const pageSlotCount = Number.isInteger(rawPageSlotCount) && rawPageSlotCount >= 0
      ? Math.min(rawPageSlotCount, 100)
      : null;
    return {
      sectionId: sectionId || collection,
      collection,
      confidence,
      source: safeString(raw.source || 'section-context'),
      collectionMode: safeString(raw.collectionMode || (F?.ARRAY_SECTIONS?.has?.(collection) ? 'array' : 'record')),
      indexContext: raw.indexContext && typeof raw.indexContext === 'object' ? raw.indexContext : null,
      ...(discriminator ? { singletonDiscriminator: discriminator } : {}),
      ...(pageSlotCount !== null ? { pageSlotCount } : {}),
    };
  }

  function effectiveArrayContext(options = {}, sectionContext = null) {
    if (options.arrayContext !== undefined && options.arrayContext !== null) return options.arrayContext;
    return sectionContext?.indexContext || undefined;
  }

  function hasEstablishedArrayIndex(options = {}, sectionContext = null, collection = '') {
    if (Number.isInteger(options.arrayIndex)) return true;
    const context = effectiveArrayContext(options, sectionContext);
    if (Number.isInteger(context)) return true;
    if (!context || typeof context !== 'object') return false;
    if (Number.isInteger(context.index)) {
      const contextSection = normalizeSection(context.section || collection);
      return !collection || !contextSection || contextSection === collection;
    }
    return Number.isInteger(context[collection]);
  }

  function currentSection(descriptor, options) {
    const sectionContext = sectionContextFor(descriptor, options);
    const section = normalizeSection(
      sectionContext?.sectionId
      || options?.section
      || descriptor?.section
      || options?.arrayContext?.section
      || '',
    );
    // “other/unknown” means that page classification had no reliable answer. It is
    // not a real semantic section and therefore must not penalize field-level matches.
    return ['other', 'unknown', 'unclassified', 'null'].includes(section.toLowerCase()) ? '' : section;
  }

  function sectionScore(candidateSection, activeSection) {
    if (!activeSection) return { score: 0, reason: '' };
    if (candidateSection === activeSection) return { score: 20, reason: '当前栏目一致' };
    if (RELATED_SECTIONS[activeSection]?.has(candidateSection)) return { score: 10, reason: '当前栏目语义相关' };
    return { score: -12, reason: '与当前栏目不一致' };
  }

  function typeCompatibility(expectedType, controlKind) {
    const expected = safeString(expectedType || 'text');
    const actual = safeString(controlKind || 'text');
    const exact = {
      text: new Set(['text', 'textarea', 'contenteditable', 'number', 'cascader']),
      textarea: new Set(['textarea', 'contenteditable', 'text']),
      number: new Set(['number', 'text']),
      date: new Set(['date', 'month', 'text', 'custom-select']),
      month: new Set(['month', 'date', 'text', 'custom-select']),
      choice: new Set(['native-select', 'custom-select', 'radio', 'checkbox', 'text']),
      boolean: new Set(['checkbox', 'radio', 'native-select', 'custom-select']),
      file: new Set(['file']),
    };
    if (expected === 'choice' && actual === 'text') return 5;
    if (expected === 'date' && actual === 'text') return 8;
    if (exact[expected]?.has(actual)) return 15;
    if (expected === 'text' && ['native-select', 'custom-select'].includes(actual)) return 2;
    return -18;
  }

  function conflictingContextPenalty(descriptor, candidateSection) {
    const context = normalized([
      descriptor?.labelText,
      descriptor?.tableHeader,
      descriptor?.groupText,
      descriptor?.nearbyText,
    ].filter(Boolean).join(' '));
    if (!context) return 0;
    const conflicts = {
      basic: /父亲|母亲|家庭成员|推荐人|导师|负责人/,
      contact: /单位电话|推荐人电话|家庭成员|父亲|母亲/,
      awards: /项目|论文|专利|教育|学校/,
      projects: /奖励|获奖|论文|专利/,
      research: /奖励|获奖|家庭/,
      education: /实习|工作单位|奖励|获奖/,
    };
    return conflicts[candidateSection]?.test(context) ? -30 : 0;
  }

  function scoreCandidate(descriptor, definition, options = {}) {
    const evidence = [];
    let score = 0;
    if (definitionBlockedBySectionAlias(definition, descriptor, options)) {
      return {
        path: definition.path,
        expectedType: definition.type,
        section: pathSection(definition.path),
        score: 0,
        rawScore: 0,
        value: undefined,
        evidence: [],
      };
    }
    const candidateAliases = aliasesForDefinition(definition, descriptor, options);
    Object.entries(SOURCE_WEIGHTS).forEach(([source, weight]) => {
      const result = bestSourceAliasScore(
        descriptor,
        source,
        candidateAliases,
        weight,
      );

      if (result.score <= 0) return;

      score += result.score;

      evidence.push({
        source,
        alias: result.alias,
        score: Number(result.score.toFixed(2)),
        strongNearby: result.strongNearby === true,
        ...(result.annotationBase === true ? { annotationBase: true } : {}),
      });
    });

    // 多个弱来源不应无限叠加；标签、表头以外的上下文总分封顶。
    const isStrongEvidenceItem = item =>
      ['labelText', 'tableHeader'].includes(item.source)
      || item.strongNearby === true;

    const strongScore = evidence
      .filter(isStrongEvidenceItem)
      .reduce((sum, item) => sum + item.score, 0);

    const auxiliaryScore = evidence
      .filter(item => !isStrongEvidenceItem(item))
      .reduce((sum, item) => sum + item.score, 0);
    score = strongScore + Math.min(48, auxiliaryScore);

    // 栏目和控件类型只能补强字段语义，不能在没有任何字段文字证据时凭空建立映射。
    if (score <= 0) {
      return {
        path: definition.path,
        expectedType: definition.type,
        section: pathSection(definition.path),
        score: 0,
        rawScore: 0,
        value: F.resolveValue(options.resume, definition.path, {
          arrayContext: effectiveArrayContext(options, options.sectionContextNormalized),
          arrayIndex: options.arrayIndex,
          resumeView: options.resumeView,
        }),
        evidence: [],
      };
    }

    const candidateSection = pathSection(definition.path);
    const activeSection = currentSection(descriptor, options);
    const section = sectionScore(candidateSection, activeSection);
    score += section.score;
    if (section.score) evidence.push({ source: 'section', alias: candidateSection, score: section.score });

    const typeScore = typeCompatibility(
      definition.type,
      descriptor?.baseControlKind || descriptor?.controlKind || descriptor?.type,
    );
    score += typeScore;
    evidence.push({ source: 'type', alias: definition.type, score: typeScore });

    const conflictPenalty = conflictingContextPenalty(descriptor, candidateSection);
    if (conflictPenalty) {
      score += conflictPenalty;
      evidence.push({ source: 'conflict', alias: candidateSection, score: conflictPenalty });
    }

    // 数组上下文只用于加强正确组，不是页面级开关。
    const arrayContext = effectiveArrayContext(options, options.sectionContextNormalized);
    const arrayContextSection = normalizeSection(arrayContext?.section || '');
    if (definition.path.includes('[]')) {
      // Repeating Resume paths require an established group/array context. Without
      // one, do not let generic aliases such as “姓名/政治面貌” steal scalar fields.
      const arrayScore = arrayContextSection
        ? (candidateSection === arrayContextSection ? 12 : -16)
        : -14;
      score += arrayScore;
      evidence.push({ source: 'arrayContext', alias: arrayContextSection || 'missing', score: arrayScore });
    }

    const value = F.resolveValue(options.resume, definition.path, {
      arrayContext,
      arrayIndex: options.arrayIndex,
      resumeView: options.resumeView,
    });
    return {
      path: definition.path,
      expectedType: definition.type,
      section: candidateSection,
      score: Math.max(0, Math.min(100, Number(score.toFixed(2)))),
      rawScore: Number(score.toFixed(2)),
      value,
      evidence,
    };
  }

  function exactStrongEvidence(candidate) {
    return candidate?.evidence?.some(item => {
      if (
        ['labelText', 'tableHeader'].includes(item.source)
        && item.score >= SOURCE_WEIGHTS[item.source] - 0.01
      ) {
        return true;
      }

      if (
        item.source === 'nearbyText'
        && item.strongNearby === true
        && item.score >= STRONG_NEARBY_WEIGHT - 0.01
      ) {
        return true;
      }

      if (
        item.source === 'semanticPlaceholder'
        && item.score >= SOURCE_WEIGHTS.semanticPlaceholder - 0.01
      ) {
        return true;
      }

      return false;
    });
  }

  function exactPrimaryLabelEvidence(candidate) {
    return candidate?.evidence?.some(item =>
      item.source === 'labelText'
      && item.score >= SOURCE_WEIGHTS.labelText - 0.01
    ) === true;
  }

  function rankCandidates(descriptor, definitions, resume, resumeView, options, sectionContext) {
    return definitions
      .map(definition => scoreCandidate(descriptor, definition, {
        ...options,
        resume,
        resumeView,
        sectionContextNormalized: sectionContext,
      }))
      .filter(candidate => candidate.rawScore > 0)
      // A literal/annotation-base exact field label is stronger than several
      // repeated fuzzy echoes from placeholder/id/ancestor text. This does not
      // lower the acceptance threshold; it only prevents a short legacy alias
      // (for example “籍贯”) from outvoting an exact canonical label.
      .sort((a, b) => Number(exactPrimaryLabelEvidence(b)) - Number(exactPrimaryLabelEvidence(a))
        || b.rawScore - a.rawScore
        || a.path.localeCompare(b.path));
  }

  function cautiousGlobalFallback(candidate, sectionContext, minScore) {
    if (!candidate || !sectionContext || candidate.section === sectionContext.collection) return false;
    if (!RELATED_SECTIONS[sectionContext.collection]?.has(candidate.section)) return false;
    const semanticPlaceholderExact = candidate.evidence?.some(item =>
      item.source === 'semanticPlaceholder'
      && item.score >= SOURCE_WEIGHTS.semanticPlaceholder - 0.01
    );
    const requiredScore = semanticPlaceholderExact
      ? minScore
      : minScore + GLOBAL_FALLBACK_SCORE_BONUS;
    return exactStrongEvidence(candidate) && candidate.rawScore >= requiredScore;
  }

  function isInteractiveReadonlyDescriptor(descriptor) {
    if (!descriptor?.readOnly) return false;
    if (descriptor.interactiveReadonly === true
      && ['date-like', 'compound-picker'].includes(safeString(descriptor.readonlyInteractionKind))) return true;
    if (descriptor.compoundPicker) return true;
    const kind = safeString(descriptor.controlKind || descriptor.type || descriptor.baseControlKind).toLowerCase();
    const inputType = safeString(descriptor.inputType || descriptor.element?.type).toLowerCase();
    if (['date', 'month'].includes(kind) || ['date', 'month'].includes(inputType)) return true;
    const semanticText = safeString([
      descriptor.labelText,
      descriptor.semanticPlaceholder,
      descriptor.placeholder,
      descriptor.ariaLabel,
      descriptor.title,
    ].filter(Boolean).join(' '));
    const dateSemantic = /(?:出生(?:日期|年月|时间)|入学(?:日期|年月|时间)|毕业(?:日期|年月|时间)|预计毕业|日期|年月)/i.test(semanticText);
    return dateSemantic && Boolean(descriptor.datePickerTrigger || descriptor.datePickerAmbiguous);
  }

  function compoundSingletonContext(collection, index = 0) {
    const selectedIndex = Math.max(0, Number.isInteger(index) ? index : 0);
    return {
      section: collection,
      sectionId: collection,
      collection,
      collectionMode: 'singleton-view',
      confidence: 1,
      source: 'compound-singleton-array-binding',
      index: selectedIndex,
      indexContext: {
        section: collection,
        collection,
        index: selectedIndex,
        [collection]: selectedIndex,
      },
    };
  }

  function ambiguousSingletonContext(collection) {
    return {
      section: collection,
      sectionId: collection,
      collection,
      collectionMode: 'singleton-view',
      confidence: 1,
      source: 'compound-ambiguous-singleton-semantics',
      index: null,
      indexContext: null,
    };
  }

  function cautiousCompoundFallback(descriptor, resume, resumeView, options, sectionContext, minScore, ambiguityMargin) {
    if (!sectionContext) return null;
    const candidates = [];
    for (const collection of COMPOUND_SINGLETON_COLLECTIONS) {
      if (collection === sectionContext.collection) continue;
      if (!Array.isArray(resumeView?.[collection]) || resumeView[collection].length === 0) continue;
      const binding = singletonBindingDecision(
        collection,
        resumeView,
        descriptor,
        options,
        sectionContext,
      );
      const compoundContext = Number.isInteger(binding.selectedIndex)
        ? compoundSingletonContext(collection, binding.selectedIndex)
        : ambiguousSingletonContext(collection);
      const ranked = rankCandidates(
        descriptor,
        F.FIELD_DEFINITIONS.filter(definition => pathSection(definition.path) === collection),
        resume,
        resumeView,
        {
          ...options,
          section: collection,
          sectionContext: compoundContext,
          arrayContext: compoundContext.indexContext,
          arrayIndex: Number.isInteger(binding.selectedIndex) ? binding.selectedIndex : undefined,
        },
        compoundContext,
      );
      if (!Number.isInteger(binding.selectedIndex)) {
        ranked.forEach(candidate => { candidate.value = undefined; });
      }
      ranked.slice(0, 2).forEach(candidate => candidates.push({
        candidate,
        context: compoundContext,
        singletonBindingDebug: binding.debug,
      }));
    }
    candidates.sort((left, right) => right.candidate.rawScore - left.candidate.rawScore
      || left.candidate.path.localeCompare(right.candidate.path));
    const best = candidates[0] || null;
    const second = candidates[1] || null;
    if (!best || !exactStrongEvidence(best.candidate) || best.candidate.rawScore < minScore) return null;
    const exactStrongWinner = exactStrongEvidence(best.candidate)
      && !exactStrongEvidence(second?.candidate);
    if (
      second
      && best.candidate.rawScore - second.candidate.rawScore < ambiguityMargin
      && !exactStrongWinner
    ) return null;
    return best;
  }

  function matchField(descriptor, resume, options = {}) {
    ensureDependencies();
    const minScore = Number.isFinite(options.minScore) ? Number(options.minScore) : 62;
    const ambiguityMargin = Number.isFinite(options.ambiguityMargin) ? Number(options.ambiguityMargin) : 10;
    if (!descriptor?.element && !descriptor?.detectorId) {
      return { descriptor, status: MATCH_STATUS.UNMATCHED, matchedPath: null, score: 0, value: undefined, reason: '字段描述符无效', alternatives: [] };
    }
    if (descriptor.hidden || descriptor.visible === false) {
      return { descriptor, status: MATCH_STATUS.SKIPPED, matchedPath: null, score: 0, value: undefined, reason: '字段不可见', alternatives: [] };
    }
    if (descriptor.maskedDisplay) {
      return { descriptor, status: MATCH_STATUS.SKIPPED, matchedPath: null, score: 0, value: undefined, reason: '字段为脱敏只读展示，不自动填写', alternatives: [] };
    }
    if (descriptor.sensitive) {
      return { descriptor, status: MATCH_STATUS.SKIPPED, matchedPath: null, score: 0, value: undefined, reason: '敏感认证字段禁止自动匹配', alternatives: [] };
    }
    if (descriptor.disabled || (descriptor.readOnly && !isInteractiveReadonlyDescriptor(descriptor))) {
      return { descriptor, status: MATCH_STATUS.SKIPPED, matchedPath: null, score: 0, value: undefined, reason: descriptor.disabled ? '字段已禁用' : '字段为只读且无可靠交互路径', alternatives: [] };
    }

    const sectionAliasBlock = blockedSectionAlias(descriptor, options);
    // Scope the short alias at candidate level. Other strong descriptor text
    // (for example a “专利类型” placeholder next to a generic “类别” label)
    // must remain eligible even when no reliable section context is available.
    const scopedOptions = sectionAliasBlock ? { ...options, sectionAliasBlock } : options;
    const resumeView = options.resumeView || F.buildResumeView(resume);
    let sectionContext = sectionContextFor(descriptor, options);
    let singletonBindingDebug = null;
    if (
      sectionContext?.collectionMode === 'singleton-view'
      && Array.isArray(resumeView?.[sectionContext.collection])
      && !hasEstablishedArrayIndex(options, sectionContext, sectionContext.collection)
    ) {
      const binding = singletonBindingDecision(
        sectionContext.collection,
        resumeView,
        descriptor,
        options,
        sectionContext,
      );
      singletonBindingDebug = binding.debug;
      if (Number.isInteger(binding.selectedIndex)) {
        sectionContext = {
          ...sectionContext,
          index: binding.selectedIndex,
          indexContext: {
            section: sectionContext.collection,
            collection: sectionContext.collection,
            index: binding.selectedIndex,
            [sectionContext.collection]: binding.selectedIndex,
          },
        };
      }
    }
    const scopedDefinitions = sectionContext
      ? F.FIELD_DEFINITIONS.filter(definition => pathSection(definition.path) === sectionContext.collection)
      : F.FIELD_DEFINITIONS;
    let ranked = rankCandidates(descriptor, scopedDefinitions, resume, resumeView, scopedOptions, sectionContext);
    let usedGlobalFallback = false;
    let resolvedSectionContext = sectionContext;
    const scopedBest = ranked[0] || null;
    const initialEvidenceThreshold = Math.min(30, minScore * 0.5);
    // Compound 页中 main section 只是 fallback；当前 collection 候选未达到正常
    // minScore 即不算“可靠候选”，才允许进入下方的强证据、唯一性回退。
    if (sectionContext && (!scopedBest || scopedBest.rawScore < minScore)) {
      const globalRanked = rankCandidates(
        descriptor,
        F.FIELD_DEFINITIONS.filter(definition => pathSection(definition.path) !== sectionContext.collection),
        resume,
        resumeView,
        scopedOptions,
        sectionContext,
      );
      const fallback = globalRanked.find(candidate => cautiousGlobalFallback(candidate, sectionContext, minScore));
      if (fallback) {
        ranked = [fallback, ...globalRanked.filter(candidate => candidate !== fallback)];
        usedGlobalFallback = true;
      } else {
        const compound = cautiousCompoundFallback(
          descriptor,
          resume,
          resumeView,
          scopedOptions,
          sectionContext,
          minScore,
          ambiguityMargin,
        );
        if (compound) {
          ranked = [compound.candidate];
          usedGlobalFallback = true;
          resolvedSectionContext = compound.context;
          singletonBindingDebug = compound.singletonBindingDebug;
        }
      }
    }
    const best = ranked[0] || null;
    const second = ranked[1] || null;
    const alternatives = ranked.slice(0, 5).map(candidate => ({ path: candidate.path, score: candidate.score }));
    const scope = resolvedSectionContext ? {
      sectionId: resolvedSectionContext.sectionId,
      collection: resolvedSectionContext.collection,
      collectionMode: resolvedSectionContext.collectionMode,
      source: resolvedSectionContext.source,
      confidence: resolvedSectionContext.confidence,
      index: Number.isInteger(resolvedSectionContext.indexContext?.index)
        ? resolvedSectionContext.indexContext.index
        : null,
      usedGlobalFallback,
    } : null;
    const bindingDiagnostic = singletonBindingDebug ? { singletonBindingDebug } : {};
    if (!best || best.rawScore < initialEvidenceThreshold) {
      return { descriptor, status: MATCH_STATUS.UNMATCHED, matchedPath: null, score: best?.score || 0, value: undefined, reason: '没有足够语义证据', alternatives, scope, ...bindingDiagnostic };
    }
    if (singletonBindingDebug && !Number.isInteger(singletonBindingDebug.selectedIndex)) best.value = undefined;
    const missingArrayIndex = ['array', 'repeatable', 'singleton-view'].includes(resolvedSectionContext?.collectionMode)
      && best.path.includes('[]')
      && !hasEstablishedArrayIndex(
        resolvedSectionContext === sectionContext
          ? options
          : {
              ...options,
              arrayContext: resolvedSectionContext?.indexContext,
              arrayIndex: Number.isInteger(resolvedSectionContext?.indexContext?.index)
                ? resolvedSectionContext.indexContext.index
                : undefined,
            },
        resolvedSectionContext,
        best.section,
      );
    if (missingArrayIndex) {
      return {
        descriptor,
        status: MATCH_STATUS.NEEDS_CONFIRMATION,
        matchedPath: best.path,
        score: best.score,
        value: best.value,
        reason: `已识别 ${resolvedSectionContext.collection} 集合，但尚未建立 JSON 条目与页面表单组索引`,
        alternatives,
        evidence: best.evidence,
        scope,
        ...bindingDiagnostic,
      };
    }
    if (best.rawScore < minScore) {
      return { descriptor, status: MATCH_STATUS.NEEDS_CONFIRMATION, matchedPath: best.path, score: best.score, value: best.value, reason: `匹配分数不足（${best.score} < ${minScore}）`, alternatives, evidence: best.evidence, scope, ...bindingDiagnostic };
    }
    // A complete row/label match should beat a shorter alias merely contained in it
    // (e.g. “姓名拼音” vs “姓名”). Two exact strong candidates remain ambiguous.
    const exactStrongWinner = exactStrongEvidence(best) && !exactStrongEvidence(second);
    if (second && best.rawScore - second.rawScore < ambiguityMargin && !exactStrongWinner) {
      return { descriptor, status: MATCH_STATUS.NEEDS_CONFIRMATION, matchedPath: best.path, score: best.score, value: best.value, reason: `候选字段过于接近（${best.path} / ${second.path}）`, alternatives, evidence: best.evidence, scope, ...bindingDiagnostic };
    }
    if (!F.hasUsableValue(best.value)) {
      return { descriptor, status: MATCH_STATUS.MISSING_JSON, matchedPath: best.path, score: best.score, value: best.value, reason: 'Resume JSON 中对应字段为空', alternatives, evidence: best.evidence, scope, ...bindingDiagnostic };
    }
    if (descriptor.compoundPicker && !descriptor.compoundPickerAdapted && options.allowCompoundPicker !== true) {
      return {
        descriptor,
        status: MATCH_STATUS.NEEDS_CONFIRMATION,
        matchedPath: best.path,
        score: best.score,
        value: best.value,
        reason: '字段由“输入框 + 选择按钮”组成，尚无站点复合选择器适配，不直接写入',
        alternatives,
        evidence: best.evidence,
        scope,
        ...bindingDiagnostic,
      };
    }
    return { descriptor, status: MATCH_STATUS.MATCHED, matchedPath: best.path, score: best.score, value: best.value, reason: '', alternatives, evidence: best.evidence, scope, ...bindingDiagnostic };
  }

  function assignmentKey(match, options = {}) {
    const path = safeString(match?.matchedPath);
    if (!path.includes('[]')) return path;
    const section = pathSection(path);
    const sectionContext = sectionContextFor(match?.descriptor, options);
    const context = effectiveArrayContext(options, sectionContext);
    let index = Number.isInteger(options.arrayIndex) ? options.arrayIndex : 0;
    if (match?.scope?.collection === section && Number.isInteger(match.scope.index)) index = match.scope.index;
    if (context && typeof context === 'object') {
      const contextSection = normalizeSection(context.section);
      if (contextSection === section && Number.isInteger(context.index)) index = context.index;
      else if (Number.isInteger(context[section])) index = context[section];
    }
    return path.replace('[]', `[${Math.max(0, index)}]`);
  }

  function pageDiscriminatorValue(descriptor) {
    const raw = ownValue(descriptor, 'currentValue');
    if (!['string', 'number'].includes(typeof raw)) return '';
    let value = safeString(raw).slice(0, 160);
    if (!value || /^(?:请选择(?:一项|一个|内容|选项)?|选择|请选|未选择|未选|暂无|none|null|select)$/i.test(value)) return '';

    const kind = safeString(descriptor?.controlKind || descriptor?.baseControlKind).toLowerCase();
    if (kind === 'native-select' && Array.isArray(descriptor?.options)) {
      const matchingOptions = descriptor.options.filter(option =>
        safeString(option?.value) === value || safeString(option?.label) === value
      );
      if (matchingOptions.length !== 1) return '';
      value = safeString(matchingOptions[0]?.label).slice(0, 160);
    }
    return value;
  }

  function trustedSingletonSlotRoot(node) {
    if (!node || typeof node !== 'object' || node.nodeType !== 1) return null;
    const tagName = safeString(node.tagName).toUpperCase();
    if (tagName === 'TR') return node;
    let role = '';
    try { role = safeString(node.getAttribute?.('role') || node.role).toLowerCase(); }
    catch (_) { return null; }
    if (role === 'row') return node;
    try {
      return SINGLETON_SLOT_ATTRIBUTES.some(name => {
        const value = node.getAttribute?.(name);
        return value !== null && value !== undefined;
      })
        ? node
        : null;
    } catch (_) {
      return null;
    }
  }

  function closestSingletonSlotRoot(element) {
    const direct = trustedSingletonSlotRoot(element);
    if (direct) return direct;
    if (!element || typeof element !== 'object') return null;
    try {
      return trustedSingletonSlotRoot(element.closest?.(SINGLETON_SLOT_ROOT_SELECTOR));
    } catch (_) {
      return null;
    }
  }

  function structuralSingletonSlotEvidence(descriptor) {
    const context = ownValue(descriptor, 'context');
    const roots = [
      { value: ownValue(descriptor, 'singletonSlotRoot'), source: 'explicit-slot-root' },
      { value: ownValue(context, 'singletonSlotRoot'), source: 'explicit-slot-root' },
    ];
    for (const candidate of roots) {
      if (
        candidate.value
        && (typeof candidate.value === 'object' || typeof candidate.value === 'function')
      ) {
        return { identity: candidate.value, source: candidate.source };
      }
    }
    const candidates = [
      ownValue(descriptor, 'singletonSlotId'),
      ownValue(context, 'singletonSlotId'),
      ownValue(descriptor, 'structuralSlotId'),
      ownValue(context, 'structuralSlotId'),
      ownValue(descriptor, 'groupId'),
      ownValue(context, 'groupId'),
    ];
    for (const candidate of candidates) {
      if (!['string', 'number'].includes(typeof candidate)) continue;
      const value = safeString(candidate).slice(0, 160);
      if (value) return { identity: value, source: 'explicit-slot-id' };
    }
    const derivedRoots = [
      closestSingletonSlotRoot(ownValue(descriptor, 'element')),
      closestSingletonSlotRoot(ownValue(descriptor, 'interactionElement')),
    ].filter(Boolean);
    const uniqueRoots = [...new Set(derivedRoots)];
    if (uniqueRoots.length === 1) {
      const rootNode = uniqueRoots[0];
      const tagName = safeString(rootNode?.tagName).toUpperCase();
      let role = '';
      try { role = safeString(rootNode?.getAttribute?.('role') || rootNode?.role).toLowerCase(); }
      catch (_) { /* use the conservative marker source */ }
      return {
        identity: rootNode,
        source: tagName === 'TR' || role === 'row' ? 'dom-row' : 'dom-item-marker',
      };
    }
    return null;
  }

  function domParent(node) {
    if (!node || typeof node !== 'object') return null;
    try { return node.parentElement || null; }
    catch (_) { return null; }
  }

  function domTagName(node) {
    try { return safeString(node?.tagName).toUpperCase(); }
    catch (_) { return ''; }
  }

  function domRole(node) {
    try { return safeString(node?.getAttribute?.('role') || node?.role).toLowerCase(); }
    catch (_) { return ''; }
  }

  function broadInlineOwner(node) {
    if (!node || typeof node !== 'object' || node.nodeType !== 1) return true;
    return new Set(['HTML', 'BODY', 'MAIN', 'FORM']).has(domTagName(node))
      || new Set(['main', 'form', 'document']).has(domRole(node));
  }

  function inlineBoundaryKind(node) {
    if (broadInlineOwner(node)) return '';
    const tagName = domTagName(node);
    if (tagName === 'SECTION' || tagName === 'FIELDSET') return 'inline-section';
    const role = domRole(node);
    return role === 'group' || role === 'region' ? 'inline-region' : '';
  }

  function descriptorHasExplicitArrayIndex(descriptor, collection) {
    const context = ownValue(descriptor, 'context');
    if (!context || typeof context !== 'object') return false;
    const mode = safeString(ownValue(context, 'collectionMode')).toLowerCase();
    if (mode === 'array' || mode === 'repeatable') return true;
    const indexContext = ownValue(context, 'indexContext');
    if (indexContext && typeof indexContext === 'object') {
      if (Number.isInteger(ownValue(indexContext, collection))) return true;
      const index = ownValue(indexContext, 'index');
      if (Number.isInteger(index)) {
        const indexedCollection = normalizeSection(
          ownValue(indexContext, 'collection') || ownValue(indexContext, 'section') || '',
        );
        if (!indexedCollection || indexedCollection === collection) return true;
      }
    }
    const contextCollection = normalizeSection(
      ownValue(context, 'collection') || ownValue(context, 'sectionId') || ownValue(context, 'section') || '',
    );
    return contextCollection === collection && Number.isInteger(ownValue(context, 'index'));
  }

  function inlineBoundaryCandidates(descriptor) {
    const starts = [
      ownValue(descriptor, 'groupElement'),
      domParent(ownValue(descriptor, 'element')),
      domParent(ownValue(descriptor, 'interactionElement')),
    ].filter(Boolean);
    const candidates = new Map();
    starts.forEach(start => {
      let current = start;
      for (let distance = 0; current && distance < 12; distance += 1) {
        if (broadInlineOwner(current)) break;
        const kind = inlineBoundaryKind(current);
        if (kind) {
          const strength = kind === 'inline-section' ? 2 : 1;
          const previous = candidates.get(current);
          if (
            !previous
            || strength > previous.strength
            || (strength === previous.strength && distance < previous.distance)
          ) {
            candidates.set(current, { identity: current, kind, strength, distance });
          }
        }
        current = domParent(current);
      }
    });
    return [...candidates.values()];
  }

  function inlineGroupParent(descriptor) {
    const owner = domParent(ownValue(descriptor, 'groupElement'));
    return broadInlineOwner(owner) ? null : owner;
  }

  function hasFieldLocalStructure(descriptor) {
    const group = ownValue(descriptor, 'groupElement');
    const owner = domParent(group);
    return Boolean(
      group
      && !broadInlineOwner(group)
      && owner
      && !broadInlineOwner(owner)
    );
  }

  function semanticRegionSingletonEvidence(state, collection, slots, unresolved) {
    if (
      slots.size !== 0
      || state.inlineItems.length < 2
      || state.inlineItems.length !== state.items.length
      || unresolved.length !== state.inlineItems.length
    ) return null;

    const paths = new Set(state.inlineItems.map(item => item.fieldPath));
    if (paths.size !== state.inlineItems.length) return null;

    const regionIds = new Set();
    const structuralCollections = new Set();
    for (const item of state.inlineItems) {
      const rawContext = ownValue(item.descriptor, 'context');
      const mode = safeString(ownValue(rawContext, 'collectionMode')).toLowerCase();
      const regionId = safeString(ownValue(rawContext, 'regionId')).slice(0, 120);
      const structuralCollection = normalizeSection(
        ownValue(rawContext, 'collection')
        || ownValue(rawContext, 'sectionId')
        || ownValue(rawContext, 'section')
        || '',
      );
      const confidence = Number(ownValue(rawContext, 'confidence'));
      if (
        !['record', 'page'].includes(mode)
        || !regionId
        || !structuralCollection
        || !Number.isFinite(confidence)
        || confidence < SECTION_CONTEXT_MIN_CONFIDENCE
        || !hasFieldLocalStructure(item.descriptor)
        || (item.boundaries || []).length > 0
      ) return null;
      regionIds.add(regionId);
      structuralCollections.add(structuralCollection);
    }
    if (regionIds.size !== 1 || structuralCollections.size !== 1) return null;

    return {
      identity: Object.freeze({ collection }),
      source: 'semantic-region-singleton',
    };
  }

  function inferredSingletonPageSlots(matches) {
    const states = new Map();
    (matches || []).forEach((match, position) => {
      const fieldPath = normalizedFieldPath(match?.matchedPath);
      const collection = semanticCollectionFromPath(fieldPath);
      if (
        !COMPOUND_SINGLETON_COLLECTIONS.has(collection)
        || !fieldPath
        || !fieldPath.includes('[]')
        || pathSection(fieldPath) !== collection
        || !exactStrongEvidence(match)
      ) {
        return;
      }
      const state = states.get(collection) || {
        items: [],
        inlineItems: [],
        structuralCollections: new Set(),
      };
      const descriptor = match?.descriptor;
      const rawContext = ownValue(descriptor, 'context');
      const structuralCollection = normalizeSection(
        ownValue(rawContext, 'collection')
        || ownValue(rawContext, 'sectionId')
        || ownValue(rawContext, 'section')
        || '',
      );
      if (structuralCollection) state.structuralCollections.add(structuralCollection);
      const item = { descriptor, fieldPath, match, position };
      state.items.push(item);
      if (!descriptorHasExplicitArrayIndex(descriptor, collection)) state.inlineItems.push(item);
      states.set(collection, state);
    });

    const counts = {};
    const diagnostics = {};
    states.forEach((state, collection) => {
      if (!state.inlineItems.length) return;
      const slots = new Map();
      const unresolved = [];
      const pending = [];
      const addSlot = (identity, source, item) => {
        const slot = slots.get(identity) || {
          source,
          items: new Set(),
          paths: new Set(),
          firstPosition: item.position,
        };
        slot.items.add(item);
        slot.paths.add(item.fieldPath);
        slot.firstPosition = Math.min(slot.firstPosition, item.position);
        slots.set(identity, slot);
      };

      state.inlineItems.forEach(item => {
        const evidence = structuralSingletonSlotEvidence(item.descriptor);
        if (evidence) addSlot(evidence.identity, evidence.source, item);
        else pending.push(item);
      });

      const boundaryStats = new Map();
      pending.forEach(item => {
        item.boundaries = inlineBoundaryCandidates(item.descriptor);
        item.boundaries.forEach(candidate => {
          const stat = boundaryStats.get(candidate.identity) || {
            ...candidate,
            items: new Set(),
            paths: new Set(),
          };
          stat.items.add(item);
          stat.paths.add(item.fieldPath);
          boundaryStats.set(candidate.identity, stat);
        });
      });
      const qualifiedBoundaries = new Set();
      boundaryStats.forEach((stat, identity) => {
        if (stat.items.size >= 2 && stat.paths.size === stat.items.size) {
          qualifiedBoundaries.add(identity);
        }
      });

      const groupParentPending = [];
      pending.forEach(item => {
        const choices = (item.boundaries || [])
          .filter(candidate => qualifiedBoundaries.has(candidate.identity))
          .sort((left, right) => right.strength - left.strength || left.distance - right.distance);
        const selected = choices[0];
        if (selected) addSlot(selected.identity, selected.kind, item);
        else groupParentPending.push(item);
      });

      const groupParentStats = new Map();
      groupParentPending.forEach(item => {
        const owner = inlineGroupParent(item.descriptor);
        if (!owner) return;
        const stat = groupParentStats.get(owner) || { items: new Set(), paths: new Set() };
        stat.items.add(item);
        stat.paths.add(item.fieldPath);
        groupParentStats.set(owner, stat);
      });
      groupParentPending.forEach(item => {
        const owner = inlineGroupParent(item.descriptor);
        const stat = owner ? groupParentStats.get(owner) : null;
        if (stat && stat.items.size >= 2 && stat.paths.size === stat.items.size) {
          addSlot(owner, 'inline-group-parent', item);
        } else {
          unresolved.push(item);
        }
      });

      const semanticRegion = semanticRegionSingletonEvidence(
        state,
        collection,
        slots,
        unresolved,
      );
      if (semanticRegion) {
        state.inlineItems.forEach(item => {
          addSlot(semanticRegion.identity, semanticRegion.source, item);
        });
        unresolved.length = 0;
      }

      // A trusted root proves a structural owner, not that duplicate semantic
      // leaves inside that owner are interchangeable. Keep duplicate paths
      // fail-closed even when the page supplies an explicit row/slot marker.
      slots.forEach((slot, identity) => {
        if (slot.paths.size === slot.items.size) return;
        slot.items.forEach(item => unresolved.push(item));
        slots.delete(identity);
      });

      const pageSlotCount = unresolved.length ? 0 : Math.min(slots.size, 100);
      counts[collection] = pageSlotCount;
      diagnostics[collection] = Object.freeze({
        structuralCollections: [...state.structuralCollections].sort().slice(0, 20),
        semanticDescriptorCount: Math.min(state.items.length, 999),
        descriptorPaths: [...new Set(state.items.map(item => item.fieldPath))].sort().slice(0, 100),
        inlineCandidateClusterCount: Math.min(slots.size, 100),
        pageSlotCount,
        slotSources: [...slots.values()]
          .sort((left, right) => left.firstPosition - right.firstPosition)
          .slice(0, 100)
          .map(slot => ({
            kind: slot.source,
            descriptorCount: Math.min(slot.items.size, 999),
            pathCount: Math.min(slot.paths.size, 999),
          })),
      });
    });
    return {
      counts: Object.freeze(counts),
      diagnostics: Object.freeze(diagnostics),
    };
  }

  function inferredSingletonDiscriminators(matches, resumeView, options = {}) {
    const inferred = new Map();
    (matches || []).forEach(match => {
      const collection = match?.singletonBindingDebug?.collection || pathSection(match?.matchedPath);
      const fieldPath = normalizedFieldPath(match?.matchedPath);
      if (!SINGLETON_DISCRIMINATOR_PATHS[collection]?.has(fieldPath)) return;
      if (!exactStrongEvidence(match)) return;
      const value = pageDiscriminatorValue(match.descriptor);
      if (!value) return;
      const discriminator = {
        fieldPath,
        value,
        source: 'page-field-current-value',
      };
      const decision = singletonBindingDecision(
        collection,
        resumeView,
        match.descriptor,
        { ...options, singletonDiscriminator: discriminator },
        sectionContextFor(match.descriptor, options),
      );
      if (decision.debug.reasonCode !== SINGLETON_BINDING_REASON_CODES.UNIQUE_DISCRIMINATOR_MATCH) return;
      const entries = inferred.get(collection) || [];
      entries.push({ discriminator, selectedIndex: decision.selectedIndex });
      inferred.set(collection, entries);
    });

    const resolved = new Map();
    inferred.forEach((entries, collection) => {
      const indexes = new Set(entries.map(entry => entry.selectedIndex));
      if (indexes.size !== 1) return;
      resolved.set(collection, entries[0].discriminator);
    });
    return resolved;
  }

  function matchFields(descriptors, resume, options = {}) {
    const sourceDescriptors = [...(descriptors || [])];
    const resumeView = options.resumeView || F.buildResumeView(resume);
    let matches = sourceDescriptors.map(descriptor => matchField(descriptor, resume, {
      ...options,
      resumeView,
    }));
    const singletonSlotInference = inferredSingletonPageSlots(matches);
    const singletonPageSlotCounts = singletonSlotInference.counts;
    if (Object.keys(singletonPageSlotCounts).length) {
      matches = sourceDescriptors.map((descriptor, index) => {
        const previous = matches[index];
        const collection = previous?.singletonBindingDebug?.collection;
        if (
          !collection
          || !Object.prototype.hasOwnProperty.call(singletonPageSlotCounts, collection)
        ) return previous;
        const rematched = matchField(descriptor, resume, {
              ...options,
              resumeView,
              singletonPageSlotCounts,
            });
        if (
          singletonPageSlotCounts[collection] !== 1
          && previous?.singletonBindingDebug
          && rematched.status === MATCH_STATUS.UNMATCHED
        ) {
          return {
            ...previous,
            status: MATCH_STATUS.NEEDS_CONFIRMATION,
            value: undefined,
            reason: '页面存在多个同类槽位，不能按 DOM 顺序隐式绑定数组索引',
            singletonBindingDebug: {
              ...previous.singletonBindingDebug,
              pageSlotCount: singletonPageSlotCounts[collection],
              candidateIndexes: [],
              selectedIndex: null,
              reasonCode: SINGLETON_BINDING_REASON_CODES.PAGE_SLOT_COUNT_NOT_SINGLETON,
            },
          };
        }
        return rematched;
      });
    }
    const inferred = inferredSingletonDiscriminators(matches, resumeView, {
      ...options,
      singletonPageSlotCounts,
    });
    if (inferred.size) {
      matches = sourceDescriptors.map((descriptor, index) => {
        const previous = matches[index];
        const collection = previous?.singletonBindingDebug?.collection || pathSection(previous?.matchedPath);
        const discriminator = inferred.get(collection);
        return discriminator
          ? matchField(descriptor, resume, {
              ...options,
              resumeView,
              singletonPageSlotCounts,
              singletonDiscriminator: discriminator,
            })
          : previous;
      });
    }
    matches = matches.map(match => {
      if (!match?.singletonBindingDebug) return match;
      const collection = semanticCollectionFromPath(match.matchedPath)
        || safeString(match.singletonBindingDebug.collection);
      const aggregate = singletonSlotInference.diagnostics[collection];
      if (!aggregate) return match;
      return {
        ...match,
        singletonBindingDebug: {
          ...match.singletonBindingDebug,
          ...aggregate,
        },
      };
    });
    const assignments = new Map();
    matches.forEach((match, index) => {
      if (match.status !== MATCH_STATUS.MATCHED) return;
      const key = assignmentKey(match, options);
      const previousIndex = assignments.get(key);
      if (previousIndex === undefined) {
        assignments.set(key, index);
        return;
      }
      const previous = matches[previousIndex];
      const keepCurrent = match.score > previous.score;
      const loser = keepCurrent ? previous : match;
      loser.status = MATCH_STATUS.NEEDS_CONFIRMATION;
      loser.reason = `与另一页面字段重复映射到 ${key}`;
      if (keepCurrent) assignments.set(key, index);
    });
    return matches;
  }

  return {
    MATCH_STATUS,
    SOURCE_WEIGHTS,
    GLOBAL_FALLBACK_SCORE_BONUS,
    COMPOUND_SINGLETON_COLLECTIONS,
    SINGLETON_BINDING_REASON_CODES,
    SECTION_CONTEXT_MIN_CONFIDENCE,
    assignmentKey,
    bestAliasScore,
    cautiousCompoundFallback,
    isInteractiveReadonlyDescriptor,
    matchField,
    matchFields,
    semanticCollectionFromPath,
    scoreCandidate,
    singletonBindingDecision,
    textSimilarity,
    typeCompatibility,
  };
});
