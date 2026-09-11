/*
 * 解放：当前栏目与 Resume collection 上下文解析器。
 * 仅使用导航/静态标题/字段元数据，不读取字段当前值。
 * Copyright (c) 2026 zlh and contributors
 * SPDX-License-Identifier: MIT
 */
(function initCurrentSectionResolver(root, factory) {
  let aliases = root?.JFSectionAliases;
  let structures = root?.JFSectionStructures;
  if (typeof module === 'object' && module.exports) {
    try { aliases ||= require('../mappings/section-aliases.js'); } catch (_) { /* browser */ }
    try { structures ||= require('../mappings/section-structures.js'); } catch (_) { /* browser */ }
  }
  const api = factory(root, aliases, structures);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.JFCurrentSectionResolver = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function currentSectionResolverFactory(root, Sections, Structures) {
  'use strict';

  const SOURCE_PRIORITY = Object.freeze([
    'navigation',
    'heading',
    'breadcrumb/form-title',
    'field-signature',
    'adapter',
  ]);
  const MIN_SOURCE_CONFIDENCE = Object.freeze({
    navigation: 0.72,
    heading: 0.68,
    'breadcrumb/form-title': 0.72,
    'field-signature': 0.74,
    adapter: 0.72,
  });
  const AMBIGUITY_MARGIN = 0.08;
  const SOURCE_AUTHORITY = Object.freeze({
    navigation: 400,
    heading: 300,
    'breadcrumb/form-title': 300,
    'field-signature': 200,
    adapter: 100,
  });

  function signature(sectionId, minGroups, minAnchors, groups) {
    return Object.freeze({
      sectionId,
      minGroups,
      minAnchors,
      groups: Object.freeze(groups.map(group => Object.freeze({
        anchor: Boolean(group.anchor),
        terms: Object.freeze(group.terms.slice()),
      }))),
    });
  }

  const FIELD_SIGNATURES = Object.freeze([
    signature('family', 3, 1, [
      { terms: ['姓名', '成员姓名'] },
      { anchor: true, terms: ['关系', '与本人关系', '称谓'] },
      { anchor: true, terms: ['在何单位工作任何职务', '工作单位及职务', '单位及职务', '家庭成员单位'] },
      { terms: ['联系电话', '成员电话'] },
    ]),
    signature('education', 3, 1, [
      { anchor: true, terms: ['所在学校', '学校名称', '毕业院校', '就读院校'] },
      { anchor: true, terms: ['所在院系', '所在学院', '院系名称'] },
      { anchor: true, terms: ['所在专业', '专业名称', '所学专业'] },
      { anchor: true, terms: ['入学年月', '预计毕业年月', '在校生注册学号'] },
      { anchor: true, terms: ['成绩绩点', '总绩点', '百分制成绩', '专业成绩排名'] },
    ]),
    signature('awards', 2, 1, [
      { anchor: true, terms: ['获奖名称', '奖励名称', '奖项名称', '荣誉名称'] },
      { anchor: true, terms: ['获奖时间', '奖励时间', '获奖日期'] },
      { anchor: true, terms: ['奖项级别', '获奖等级', '主办单位'] },
      { terms: ['地点', '内容', '备注'] },
    ]),
    signature('research', 2, 1, [
      { anchor: true, terms: ['科研项目名称', '科研名称', '课题名称'] },
      { anchor: true, terms: ['科研单位', '项目负责人', '科研职责'] },
      { terms: ['开始时间', '结束时间', '项目介绍'] },
    ]),
    signature('projects', 2, 1, [
      { anchor: true, terms: ['项目名称', '创新项目名称'] },
      { anchor: true, terms: ['项目角色', '项目职责', '项目类型'] },
      { terms: ['开始时间', '结束时间', '项目描述'] },
    ]),
    signature('papers', 2, 1, [
      { anchor: true, terms: ['论文题目', '论文名称', '论文标题'] },
      { anchor: true, terms: ['发表期刊', '作者顺序', '收录情况'] },
      { terms: ['发表时间', '论文状态'] },
    ]),
    signature('internship', 3, 1, [
      { anchor: true, terms: ['学校或工作单位', '学习或工作单位', '实习单位'] },
      { anchor: true, terms: ['担任职务', '工作岗位', '实习岗位'] },
      { terms: ['起始时间', '开始时间'] },
      { terms: ['结束时间'] },
    ]),
    signature('language', 2, 1, [
      { anchor: true, terms: ['外语语种', '考试名称', '外语考试'] },
      { anchor: true, terms: ['外语成绩', '英语成绩', '听说能力'] },
      { terms: ['考试时间', '等级'] },
    ]),
  ]);

  const EMBEDDED_COLLECTION_STRUCTURES =
    Structures?.EMBEDDED_COLLECTION_STRUCTURES
    || Object.freeze([]);


  function safeString(value, max = 180) {
    return String(value ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
  }

  function normalizeText(value) {
    if (Sections?.normalizeSectionText) return Sections.normalizeSectionText(value);
    return safeString(value).replace(/[\s:：,，.。;；、（）()\[\]【】/_-]+/g, '').toLowerCase();
  }

  function normalizeConfidence(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : fallback;
  }

  function collectionForSection(sectionId) {
    return Sections?.collectionForSection?.(sectionId)
      || Sections?.SECTION_COLLECTIONS?.[sectionId]
      || sectionId
      || null;
  }

  function collectionMode(sectionId) {
    return Sections?.collectionModeForSection?.(sectionId) || 'unknown';
  }

  function isKnownSection(sectionId) {
    const value = safeString(sectionId, 80);
    return Boolean(value && (
      Sections?.SECTION_ALIASES?.[value]
      || Sections?.SECTION_COLLECTIONS?.[value]
      || ['internships'].includes(value)
    ));
  }

  function classifyText(text, source, confidenceFloor) {
    const label = safeString(text, 160);
    if (!label) return null;
    const result = Sections?.classifySection?.(label, { minScore: confidenceFloor });
    if (!result?.section) return null;
    return {
      sectionId: result.section,
      confidence: normalizeConfidence(result.confidence ?? result.score),
      source,
      label,
      evidence: result.matchedAlias ? [safeString(result.matchedAlias, 80)] : [],
    };
  }

  function candidateFromKnownSection(item, source, confidenceFloor) {
    const sectionId = safeString(item?.sectionId || item?.section || item?.id, 80);
    if (!isKnownSection(sectionId)) return classifyText(item?.label || item?.text || item?.title, source, confidenceFloor);
    return {
      sectionId,
      confidence: normalizeConfidence(item?.confidence ?? item?.score, 0.9),
      source,
      label: safeString(item?.label || item?.text || item?.title || sectionId, 160),
      evidence: [sectionId],
      indexContext: item?.indexContext || null,
      scope: safeString(item?.scope, 40),
      authority: Number.isFinite(Number(item?.authority)) && item?.authority !== null && item?.authority !== ''
        ? Number(item.authority)
        : undefined,
      originSource: safeString(item?.source, 60),
    };
  }

  function chooseCandidate(source, candidates, trace, minimum = MIN_SOURCE_CONFIDENCE[source] || 0.72) {
    const ranked = (candidates || [])
      .filter(candidate => candidate?.sectionId)
      .sort((left, right) => right.confidence - left.confidence || left.sectionId.localeCompare(right.sectionId));
    const best = ranked[0] || null;
    const second = ranked.find(candidate => candidate.sectionId !== best?.sectionId) || null;
    const ambiguous = Boolean(best && second && best.confidence - second.confidence < AMBIGUITY_MARGIN);
    const accepted = Boolean(best && best.confidence >= minimum && !ambiguous);
    trace.push({
      source,
      accepted,
      reason: !best ? 'NO_CANDIDATE' : best.confidence < minimum ? 'LOW_CONFIDENCE' : ambiguous ? 'AMBIGUOUS' : 'ACCEPTED',
      candidates: ranked.slice(0, 3).map(candidate => ({
        sectionId: candidate.sectionId,
        confidence: Number(candidate.confidence.toFixed(3)),
        evidence: (candidate.evidence || []).slice(0, 8),
      })),
    });
    return accepted ? best : null;
  }

  function defaultScopeForCandidate(candidate) {
    const explicit = safeString(candidate?.scope, 40);
    if (explicit) return explicit;
    if (candidate?.source === 'field-signature') return 'page-owned';
    if (candidate?.source === 'adapter') {
      return /^(?:active-navigation|heading|current-page|site-adapter)$/i.test(
        safeString(candidate?.originSource, 60),
      ) ? 'current-page' : 'fallback';
    }
    return 'current-page';
  }

  function authorityForCandidate(candidate) {
    const explicit = Number(candidate?.authority);
    if (candidate?.authority !== null && candidate?.authority !== undefined && candidate?.authority !== ''
      && Number.isFinite(explicit)) return Math.max(0, Math.min(1_000, explicit));
    if (candidate?.source === 'adapter') {
      const originSource = safeString(candidate?.originSource, 60).toLowerCase();
      if (originSource === 'active-navigation') return SOURCE_AUTHORITY.navigation;
      if (originSource === 'heading') return SOURCE_AUTHORITY.heading;
      if (defaultScopeForCandidate(candidate) === 'current-page') return SOURCE_AUTHORITY.navigation;
    }
    return SOURCE_AUTHORITY[candidate?.source] || 0;
  }

  function diagnosticCandidate(candidate) {
    const sectionId = safeString(candidate?.sectionId, 80);
    if (!sectionId) return null;
    return {
      sectionId,
      source: safeString(candidate?.source || 'unknown', 60) || 'unknown',
      confidence: Number(normalizeConfidence(candidate?.confidence).toFixed(3)),
      scope: defaultScopeForCandidate(candidate),
      evidence: (Array.isArray(candidate?.evidence) ? candidate.evidence : [])
        .map(item => safeString(item, 80))
        .filter(Boolean)
        .slice(0, 8),
      authority: authorityForCandidate(candidate),
      accepted: candidate?.accepted !== false,
    };
  }

  function candidatePriority(candidate) {
    const index = SOURCE_PRIORITY.indexOf(candidate.source);
    return index < 0 ? SOURCE_PRIORITY.length : index;
  }

  function resolveFinalSection(candidates = []) {
    const normalized = (Array.isArray(candidates) ? candidates : [])
      .map(diagnosticCandidate)
      .filter(Boolean)
      .sort((left, right) =>
        right.authority - left.authority
        || right.confidence - left.confidence
        || candidatePriority(left) - candidatePriority(right)
        || left.sectionId.localeCompare(right.sectionId)
        || left.source.localeCompare(right.source)
      );
    const validScopes = new Set(['current-page', 'page-owned', 'fallback']);
    const eligible = normalized.filter(candidate =>
      candidate.accepted
      && validScopes.has(candidate.scope)
    );
    const best = eligible[0] || null;

    if (!best) {
      return {
        selected: null,
        reasonCode: 'NO_ACCEPTED_SECTION',
        candidates: normalized,
        rejected: normalized.map(candidate => ({
          ...candidate,
          reason: candidate.accepted ? 'INVALID_SCOPE' : 'NOT_ACCEPTED',
        })),
      };
    }

    const competing = eligible.find(candidate =>
      candidate.sectionId !== best.sectionId
      && candidate.authority === best.authority
    ) || null;
    const ambiguous = Boolean(
      competing
      && Math.abs(best.confidence - competing.confidence) < AMBIGUITY_MARGIN
    );

    if (ambiguous) {
      return {
        selected: null,
        reasonCode: 'AMBIGUOUS_SECTION',
        candidates: normalized,
        rejected: normalized.map(candidate => ({
          ...candidate,
          reason: candidate === best || candidate === competing
            ? 'AMBIGUOUS_WITH_PEER'
            : candidate.authority < best.authority
              ? 'LOWER_AUTHORITY'
              : 'NOT_SELECTED',
        })),
      };
    }

    return {
      selected: best,
      reasonCode: 'SECTION_SELECTED',
      candidates: normalized,
      rejected: normalized
        .filter(candidate => candidate !== best)
        .map(candidate => ({
          ...candidate,
          reason: !candidate.accepted
            ? 'NOT_ACCEPTED'
            : !validScopes.has(candidate.scope)
              ? 'INVALID_SCOPE'
              : candidate.authority < best.authority
                ? 'LOWER_AUTHORITY'
                : candidate.confidence < best.confidence
                  ? 'LOWER_CONFIDENCE'
                  : 'NOT_SELECTED',
        })),
    };
  }

  function nodeText(node) {
    if (typeof node === 'string') return safeString(node, 200);
    return safeString(node?.innerText || node?.textContent || node?.title || node?.getAttribute?.('aria-label'), 200);
  }

  function isExtensionUi(node) {
    try { return Boolean(node?.closest?.('#__jf_panel__,#__jf_modal__,#__rf_panel__,[data-jiefang-ui]')); }
    catch (_) { return true; }
  }

  function queryTexts(document, selector, limit = 80) {
    if (!document?.querySelectorAll) return [];
    try {
      return [...document.querySelectorAll(selector)]
        .filter(node => !isExtensionUi(node) && node.getAttribute?.('aria-hidden') !== 'true' && !node.hidden)
        .map(nodeText)
        .filter(Boolean)
        .slice(0, limit);
    } catch (_) { return []; }
  }

  function collectTextInputs(explicit, document, selector) {
    const supplied = Array.isArray(explicit) ? explicit : explicit ? [explicit] : [];
    const values = supplied.map(nodeText).filter(Boolean);
    return values.length ? values : queryTexts(document, selector);
  }

  function descriptorTexts(descriptor) {
    return [
      descriptor?.labelText,
      descriptor?.tableHeader,
      descriptor?.ariaLabel,
      descriptor?.placeholder,
      descriptor?.groupText,
      descriptor?.nearbyText,
      descriptor?.parentText,
    ].map(normalizeText).filter(Boolean);
  }

  function embeddedRegionRoot(region) {
    return region?.runtimeRoot
      || region?.root
      || region?.rootElement
      || region?.element
      || null;
  }

  function fieldInsideEmbeddedRegion(field, regions = []) {
    const element = field?.element || field?.interactionElement || null;
    if (!element) return false;
    return (Array.isArray(regions) ? regions : []).some(region => {
      const regionRoot = embeddedRegionRoot(region);
      if (!regionRoot) return false;
      if (regionRoot === element) return true;
      try { return Boolean(regionRoot.contains?.(element)); }
      catch (_) { return false; }
    });
  }

  function termMatches(texts, term) {
    const normalizedTerm = normalizeText(term);
    if (!normalizedTerm) return false;
    return texts.some(text => text === normalizedTerm
      || (normalizedTerm.length >= 2 && text.includes(normalizedTerm))
      || (text.length >= 3 && normalizedTerm.includes(text)));
  }

  function scoreFieldSignatures(fields = []) {
    const fieldTexts = (fields || [])
      .filter(field => field
        && field.sensitive !== true
        && field.hidden !== true
        && field.visible !== false)
      .map(descriptorTexts)
      .filter(texts => texts.length);
    return FIELD_SIGNATURES.map(definition => {
      const matchedGroups = definition.groups.map(group => ({
        group,
        fieldIndexes: fieldTexts
          .map((texts, index) => group.terms.some(term => termMatches(texts, term)) ? index : -1)
          .filter(index => index >= 0),
      })).filter(match => match.fieldIndexes.length);
      const distinctFieldIndexes = new Set(matchedGroups.flatMap(match => match.fieldIndexes));
      const anchors = matchedGroups.filter(match => match.group.anchor).length;
      const accepted = matchedGroups.length >= definition.minGroups
        && distinctFieldIndexes.size >= definition.minGroups
        && anchors >= definition.minAnchors;
      const coverage = matchedGroups.length / Math.max(1, definition.groups.length);
      const confidence = accepted ? Math.min(0.94, 0.64 + coverage * 0.22 + Math.min(0.08, anchors * 0.025)) : 0;
      return {
        sectionId: definition.sectionId,
        confidence: Number(confidence.toFixed(3)),
        source: 'field-signature',
        evidence: matchedGroups.flatMap(({ group }) => group.terms.filter(term =>
          fieldTexts.some(texts => termMatches(texts, term))
        ).slice(0, 1)).slice(0, 8),
        matchedGroupCount: matchedGroups.length,
        anchorCount: anchors,
      };
    }).filter(candidate => candidate.confidence > 0);
  }


  function isActuallyVisible(
    element
  ) {
    if (!element) {
      return false;
    }

    if (
      element.hidden
      || element.getAttribute?.(
        'aria-hidden'
      ) === 'true'
    ) {
      return false;
    }

    const view =
      element.ownerDocument
        ?.defaultView
      || globalThis;

    try {
      const style =
        view.getComputedStyle?.(
          element
        );

      if (
        style
        && (
          style.display === 'none'
          || style.visibility
            === 'hidden'
          || style.opacity === '0'
        )
      ) {
        return false;
      }
    } catch (_) {
      // fail-open to geometry check
    }

    const rect =
      element.getBoundingClientRect?.();

    if (
      rect
      && rect.width <= 0
      && rect.height <= 0
    ) {
      return false;
    }

    return true;
  }

  function scoreEmbeddedCollectionStructures(document) {
    if (
      !document?.querySelectorAll
      || !Structures?.selectBestDefinitionForHeaders
    ) {
      return [];
    }

    let tables = [];

    try {
      tables = [
        ...document.querySelectorAll(
          'table,[role="table"]'
        ),
      ].filter(
        table =>
          !isExtensionUi(table)
          && isActuallyVisible(table)
      );
    } catch (_) {
      return [];
    }

    const candidates = [];

    tables.forEach((table, tableIndex) => {
      let headerTexts = [];
      let ownedHeaderNodes = [];
      let nestedHeaderNodes = [];
      let actionTexts = [];

      try {
        const headerNodes = [
          ...table.querySelectorAll(
            'th,'
            + 'thead td,'
            + 'tr:first-child td,'
            + '[role="columnheader"]'
          ),
        ]
          .filter(
            node =>
              !isExtensionUi(node)
          );
        headerNodes.forEach(node => {
          let owner = null;
          try { owner = node.closest?.('table,[role="table"]') || null; }
          catch (_) { owner = null; }
          if (!owner || owner === table) ownedHeaderNodes.push(node);
          else nestedHeaderNodes.push(node);
        });
        headerTexts = ownedHeaderNodes.map(nodeText).filter(Boolean);

        actionTexts = [
          ...table.querySelectorAll(
            'button,'
            + '[role="button"],'
            + 'a,'
            + 'input[type="button"]'
          ),
        ]
          .filter(
            node =>
              !isExtensionUi(node)
              && !node.disabled
          )
          .map(nodeText)
          .filter(Boolean);
      } catch (_) {
        return;
      }

      const best =
        Structures.selectBestDefinitionForHeaders(
          headerTexts
        );

      if (!best) {
        return;
      }

      const definition =
        best.definition;

      const hasAddAction =
        actionTexts.some(
          text =>
            definition.addPattern.test(
              text
            )
        );

      candidates.push({
        sectionId:
          definition.sectionId,

        confidence:
          Math.min(
            0.99,
            best.score.confidence
            + (hasAddAction ? 0.01 : 0)
          ),

        source:
          'embedded-structure',

        collection:
          definition.collection
          || collectionForSection(
            definition.sectionId
          ),

        collectionMode:
          definition.collectionMode
          || collectionMode(
            definition.sectionId
          ),

        regionId:
          `table:${tableIndex}`,

        runtimeRoot:
          table,

        evidenceScope:
          'owned',

        ownedHeaderCount:
          ownedHeaderNodes.length,

        nestedHeaderCount:
          nestedHeaderNodes.length,

        ownedEvidenceCount:
          best.score.matchedGroups.length,

        evidenceKind:
          'structural-headers',

        qualificationReason:
          'OWNED_STRUCTURAL_HEADERS',

        evidence: [
          ...best.score.matchedGroups.map(
            group => group[0]
          ),
          ...(hasAddAction ? ['添加'] : []),
        ].slice(0, 8),
      });
    });

    return candidates;
  }

  
  function normalizeIndexContext(raw, collection) {
    if (Number.isInteger(raw)) return { section: collection, index: Math.max(0, raw) };
    if (!raw || typeof raw !== 'object') return null;
    const index = Number.isInteger(raw.index) ? raw.index : Number.isInteger(raw[collection]) ? raw[collection] : null;
    if (!Number.isInteger(index)) return null;
    const contextCollection = collectionForSection(raw.section || collection);
    if (contextCollection && collection && contextCollection !== collection) return null;
    return { section: collection, index: Math.max(0, index) };
  }

  function adapterCandidate(options, confidenceFloor) {
    let result = options.adapterContext || options.adapterResult || null;
    if (!result && typeof options.adapter?.detectCurrentSection === 'function') {
      try { result = options.adapter.detectCurrentSection(); } catch (_) { result = null; }
    }
    return result ? candidateFromKnownSection(result, 'adapter', confidenceFloor) : null;
  }

  function resolveSectionContext(options = {}) {
    const document = options.document || root.document || null;
    const trace = [];
    const acceptedBySource = new Map();

    let rawNavigation = options.navigationItems || options.navigation || null;
    if (!rawNavigation && typeof options.navigationEngine?.scan === 'function') {
      try { rawNavigation = options.navigationEngine.scan(); } catch (_) { rawNavigation = []; }
    } else if (rawNavigation && typeof rawNavigation.scan === 'function') {
      try { rawNavigation = rawNavigation.scan(); } catch (_) { rawNavigation = []; }
    }
    const navigationItems = Array.isArray(rawNavigation)
      ? rawNavigation
      : rawNavigation ? [rawNavigation] : [];
    const activeNavigation = navigationItems.filter(item => item?.active === true || item?.current === true || item?.selected === true)
      .filter(item => item?.safe !== false && item?.passiveOnly !== true);
    acceptedBySource.set('navigation', chooseCandidate(
      'navigation',
      activeNavigation.map(item => candidateFromKnownSection(item, 'navigation', MIN_SOURCE_CONFIDENCE.navigation)).filter(Boolean),
      trace,
    ));

    const headings = collectTextInputs(
      options.headings || options.heading,
      document,
      'h1,h2,h3,h4,h5,h6,[role="heading"],.page-title,[class*="page-title"]',
    );
    acceptedBySource.set('heading', chooseCandidate(
      'heading',
      headings.map(text => classifyText(text, 'heading', MIN_SOURCE_CONFIDENCE.heading)).filter(Boolean),
      trace,
    ));

    const breadcrumbTexts = collectTextInputs(
      options.breadcrumbs || options.breadcrumb,
      document,
      '.breadcrumb,[class*="breadcrumb"],[aria-label*="面包屑"]',
    );
    const formTitles = collectTextInputs(
      options.formTitles || options.formTitle,
      document,
      'form legend,.form-title,[class*="form-title"],[data-section-title]',
    );
    acceptedBySource.set('breadcrumb/form-title', chooseCandidate(
      'breadcrumb/form-title',
      [...breadcrumbTexts, ...formTitles]
        .map(text => classifyText(text, 'breadcrumb/form-title', MIN_SOURCE_CONFIDENCE['breadcrumb/form-title']))
        .filter(Boolean),
      trace,
    ));

    let fields =
      Array.isArray(options.fields)
        ? options.fields
        : null;

    if (
      !fields
      && root.JFFieldDetector?.scan
      && (
        options.rootNode
        || document
      )
    ) {
      try {
        fields =
          root.JFFieldDetector.scan(
            options.rootNode
            || document,
            {}
          );
      } catch (_) {
        fields = [];
      }
    }


    /*
    * Page section evidence may only consume page-owned descriptors.  Prefer
    * the runtime EmbeddedSectionDetector snapshot supplied by the caller;
    * the legacy structural scan remains a compatibility fallback for direct
    * resolver consumers.
    */
    const hasEmbeddedRegionSnapshot = Array.isArray(options.embeddedRegions);
    const structuralRegions = hasEmbeddedRegionSnapshot
      ? options.embeddedRegions.filter(Boolean)
      : scoreEmbeddedCollectionStructures(document);
    const pageOwnedFields = (fields || []).filter(
      field => !fieldInsideEmbeddedRegion(field, structuralRegions)
    );
    const allFieldSignatureCandidates = scoreFieldSignatures(fields || []);
    const fieldSignatureCandidates = scoreFieldSignatures(pageOwnedFields);

    /*
    * Descriptors without an element cannot be tested by containment. Runtime
    * callers provide embeddedRegions and real elements, so keep their strict
    * collection-level isolation. For the pre-snapshot direct-call contract,
    * preserve the old field-signature result only when every descriptor lacks
    * an ownership element and structural filtering removed every candidate.
    */
    const structurallyIsolatedFieldCandidates = fieldSignatureCandidates.filter(
      candidate => !structuralRegions.some(
        region => collectionForSection(region.sectionId || region.collection)
          === collectionForSection(candidate.sectionId)
      )
    );
    const legacyFieldsWithoutElements = !hasEmbeddedRegionSnapshot
      && (fields || []).length > 0
      && (fields || []).every(field => !(field?.element || field?.interactionElement));
    const workspaceOwnershipFields = (fields || []).filter(field =>
      field
      && field.visible !== false
      && !field.hidden
      && !field.disabled
      && !field.readOnly
    );
    const soleStructuralRegion = structuralRegions.length === 1
      ? structuralRegions[0]
      : null;
    const soleRegionRoot = embeddedRegionRoot(soleStructuralRegion);
    let workspaceRootOwnsRegion = false;
    try {
      workspaceRootOwnsRegion = Boolean(
        options.rootNode
        && soleRegionRoot
        && (
          options.rootNode === soleRegionRoot
          || options.rootNode.contains?.(soleRegionRoot)
        )
      );
    } catch (_) {
      workspaceRootOwnsRegion = false;
    }
    const soleRegionLiveAndVisible = Boolean(
      soleRegionRoot
      && soleRegionRoot.isConnected !== false
      && isActuallyVisible(soleRegionRoot)
    );
    const ownedEvidenceCount = Math.max(0, Number(
      soleStructuralRegion?.ownedEvidenceCount
      ?? soleStructuralRegion?.ownedHeaderCount
      ?? 0
    ));
    const soleRegionEvidenceStrong = Boolean(
      soleStructuralRegion
      && normalizeConfidence(soleStructuralRegion.confidence)
        >= MIN_SOURCE_CONFIDENCE['field-signature']
      && soleStructuralRegion.evidenceScope === 'owned'
      && ownedEvidenceCount > 0
      && [
        'OWNED_STRUCTURAL_HEADERS',
        'STRONG_TITLE_WITH_REPEATABILITY',
      ].includes(soleStructuralRegion.qualificationReason)
    );
    const soleWorkspaceSignature = allFieldSignatureCandidates.length === 1
      ? allFieldSignatureCandidates[0]
      : null;
    const soleRegionCollection = collectionForSection(
      soleStructuralRegion?.sectionId || soleStructuralRegion?.collection
    );
    const workspacePromotionCandidate = Boolean(
      workspaceRootOwnsRegion
      && soleRegionLiveAndVisible
      && soleRegionEvidenceStrong
      && workspaceOwnershipFields.length
      && workspaceOwnershipFields.every(
        field => fieldInsideEmbeddedRegion(field, [soleStructuralRegion])
      )
      && soleWorkspaceSignature
      && collectionForSection(soleWorkspaceSignature.sectionId) === soleRegionCollection
    )
      ? soleWorkspaceSignature
      : null;
    const mainFieldSignatureCandidates = workspacePromotionCandidate
      ? [workspacePromotionCandidate]
      : legacyFieldsWithoutElements && !structurallyIsolatedFieldCandidates.length
        ? fieldSignatureCandidates
        : structurallyIsolatedFieldCandidates;

    acceptedBySource.set(
      'field-signature',

      chooseCandidate(
        'field-signature',
        mainFieldSignatureCandidates,
        trace
      )
    );

    acceptedBySource.set('adapter', chooseCandidate(
      'adapter',
      [adapterCandidate(options, MIN_SOURCE_CONFIDENCE.adapter)].filter(Boolean),
      trace,
    ));

    const acceptedCandidates = SOURCE_PRIORITY
      .map(source => acceptedBySource.get(source))
      .filter(Boolean);
    const arbitration = resolveFinalSection(acceptedCandidates);
    const selected = arbitration.selected
      ? acceptedCandidates.find(candidate =>
          candidate.sectionId === arbitration.selected.sectionId
          && candidate.source === arbitration.selected.source
          && Number(normalizeConfidence(candidate.confidence).toFixed(3))
            === arbitration.selected.confidence
        ) || arbitration.selected
      : null;

   const regionMap =
    new Map();


  [
    /*
    * Field Signature 只有同时得到
    * 当前可见页面结构证明时，
    * 才允许作为 embedded collection。
    *
    * 例如 basic 页面里的 family。
    */
    ...fieldSignatureCandidates.filter(
      candidate =>
        structuralRegions.some(
          structural =>
            collectionForSection(
              structural.sectionId
            )
            === collectionForSection(
              candidate.sectionId
            )
        )
    ),

    /*
    * 0 行数组也可以仅根据：
    *
    * 标题 + 表头 + 添加按钮
    *
    * 识别出 embedded collection。
    */
    ...structuralRegions,

  ].forEach(candidate => {
    if (!candidate?.sectionId) {
      return;
    }

    /*
    * 同一语义 collection 必须只有一个 canonical section id。
    *
    * 例如：
    * field-signature 可能给出 internship，
    * table-structure 给出 internships。
    * 如果把两者当成两个 embedded region，
    * 前者会因为找不到 singular 结构而退化到整页 root，
    * 进而把 education 主表单全部排除。
    */
    const canonicalSectionId =
      Structures?.canonicalSectionId?.(
        candidate.sectionId
      )
      || candidate.sectionId;

    const canonicalCollection =
      collectionForSection(
        canonicalSectionId
      )
      || canonicalSectionId;

    const normalizedCandidate = {
      ...candidate,
      sectionId: canonicalSectionId,
      collection:
        candidate.collection
        || canonicalCollection,
    };

    /*
    * 当前主页面不能同时再成为
    * embedded collection。
    */
    if (
      selected
      && collectionForSection(
        normalizedCandidate.sectionId
      ) === collectionForSection(
        selected.sectionId
      )
    ) {
      return;
    }

    const key = canonicalCollection;
    const existing = regionMap.get(key);

    if (
      !existing
      || Number(
        normalizedCandidate.confidence || 0
      ) > Number(
        existing.confidence || 0
      )
    ) {
      regionMap.set(
        key,
        normalizedCandidate
      );
    }
  });


const regionCandidates =
  [...regionMap.values()];
    if (!selected) {
      return {
        sectionId: null,
        source: 'unknown',
        confidence: 0,
        collection: null,
        collectionMode: 'unknown',
        indexContext: null,
        regionCandidates,
        arbitration,
        trace,
      };
    }
    const collection =
      collectionForSection(
        selected.sectionId
      );

    const mode =
      selected.sectionId === 'education'
        ? 'singleton-view'
        : collectionMode(
            selected.sectionId
          );

    const rawIndexContext =
      selected.indexContext
      || options.indexContext
      || null;
    return {
      sectionId: selected.sectionId,
      source: selected.source,
      confidence: Number(selected.confidence.toFixed(3)),
      collection,
      collectionMode: mode,
      indexContext: mode === 'array' ? normalizeIndexContext(rawIndexContext, collection) : null,
      regionCandidates,
      arbitration,
      trace,
    };
  }

  function normalizeFieldContext(field, regions = []) {
    const element = field?.element || field?.interactionElement;
    const region = regions.find(item => item?.root?.contains?.(element));

    if (!region) {
      return {
        section: resolveSectionContext({}).sectionId || '',
        collection: '',
        regionId: '',
      };
    }

    return {
      section: region.sectionId || region.collection || '',
      collection: region.collection || region.sectionId || '',
      regionId: region.id || '',
    };
  }

  return {
    AMBIGUITY_MARGIN,
    FIELD_SIGNATURES,
    EMBEDDED_COLLECTION_STRUCTURES,
    MIN_SOURCE_CONFIDENCE,
    SOURCE_AUTHORITY,
    SOURCE_PRIORITY,
    collectTextInputs,
    resolve: resolveSectionContext,
    resolveFinalSection,
    resolveSectionContext,
    scoreFieldSignatures,
    normalizeFieldContext,
  };
});
