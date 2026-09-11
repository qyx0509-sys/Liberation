/*
 * 解放：通用报名系统适配层。网站适配器只覆盖选择器/映射，不复制引擎。
 * SPDX-License-Identifier: MIT
 */
(function initGenericSiteAdapter(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.JFGenericAdapter = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function genericSiteAdapterFactory(root) {
  'use strict';
  function query(rootNode, selector, all = false) {
    if (!selector) return all ? [] : null;
    try { return all ? [...rootNode.querySelectorAll(selector)] : rootNode.querySelector(selector); } catch (_) { return all ? [] : null; }
  }
  function visible(element) {
    if (!element?.isConnected || element.hidden || element.getAttribute?.('aria-hidden') === 'true') return false;
    const style = element.ownerDocument?.defaultView?.getComputedStyle?.(element);
    return style?.display !== 'none' && style?.visibility !== 'hidden';
  }
  function isExtensionUi(element) {
    try { return Boolean(element?.closest?.('#__jf_panel__,#__jf_modal__,#__rf_panel__,[data-jiefang-ui]')); }
    catch (_) { return true; }
  }
  function text(value) { return String(value ?? '').replace(/\s+/g, ' ').trim(); }
  const FORBIDDEN_DIAGNOSTIC_KEYS = new Set([
    'value', 'currentvalue', 'beforevalue', 'aftervalue', 'plannedvalue', 'pagevalue',
    'filename', 'filepath', 'fullpath', 'localpath', 'blob', 'base64', 'file', 'files',
    'cookie', 'cookies', 'session', 'token', 'authorization', 'password', 'secret',
  ]);
  const SINGLETON_SLOT_SOURCE_KINDS = new Set([
    'explicit-slot-root',
    'explicit-slot-id',
    'dom-row',
    'dom-item-marker',
    'inline-section',
    'inline-region',
    'inline-group-parent',
    'semantic-region-singleton',
  ]);
  function sanitizeDiagnosticText(value, maxLength = 240) {
    const external = root.JFFileFieldDetector?.sanitizeDiagnosticText;
    if (typeof external === 'function') return external(value, maxLength);
    const limit = Math.max(0, Math.min(1_000, Number(maxLength) || 240));
    const source = text(value);
    if (/(?:^|[\s"'([{=：])(?:[A-Za-z]:[\\/]|\\\\|\/(?:Users|home|tmp|var|private|storage|sdcard)\/)/i.test(source)) {
      return '<redacted-path>'.slice(0, limit);
    }
    const extensionListOnly = /^(?:\s*(?:\*?\.)?(?:pdf|docx?|jpe?g|png)\s*(?:[,，;；/]\s*)?)+$/i.test(source);
    if (!extensionListOnly && /(?:^|[\s"'([{：:,，;；])[^\\/\r\n<>|]{1,180}\.(?:pdf|docx?|jpe?g|png)(?=$|[\s"',，。;；)）\]}】（(])/i.test(source)) {
      return '<redacted-filename>'.slice(0, limit);
    }
    return source
      .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '<redacted-email>')
      .replace(/(?<!\d)1[3-9]\d{9}(?!\d)/g, '<redacted-phone>')
      .replace(/(?<!\d)\d{17}[\dXx](?![\dXx])/g, '<redacted-id>')
      .replace(/(?<!\d)\d{15}(?!\d)/g, '<redacted-id>')
      .replace(/(?<!\d)\d{7,}(?!\d)/g, '<redacted-number>')
      .slice(0, limit);
  }
  function sanitizeDiagnosticValue(value, depth = 0) {
    if (depth > 7 || value === null || value === undefined) return null;
    if (typeof value === 'string') return sanitizeDiagnosticText(value);
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    if (Array.isArray(value)) return value.slice(0, 500).map(item => sanitizeDiagnosticValue(item, depth + 1));
    if (typeof value !== 'object') return null;
    const output = {};
    Object.entries(value).slice(0, 200).forEach(([key, item]) => {
      if (FORBIDDEN_DIAGNOSTIC_KEYS.has(String(key).toLocaleLowerCase())) return;
      output[key] = sanitizeDiagnosticValue(item, depth + 1);
    });
    return output;
  }
  function singletonBindingDiagnostic(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const hasAggregateMetadata = [
      'structuralCollections',
      'semanticDescriptorCount',
      'descriptorPaths',
      'inlineCandidateClusterCount',
      'slotSources',
    ].some(key => Object.prototype.hasOwnProperty.call(value, key));
    const structuralCollections = [...new Set((Array.isArray(value.structuralCollections)
      ? value.structuralCollections : [])
      .map(item => sanitizeDiagnosticText(item, 80))
      .filter(item => /^[A-Za-z][A-Za-z0-9_-]{0,79}$/.test(item)))]
      .sort()
      .slice(0, 20);
    const descriptorPaths = [...new Set((Array.isArray(value.descriptorPaths)
      ? value.descriptorPaths : [])
      .map(item => sanitizeDiagnosticText(item, 160).replace(/\[\d+\]/g, '[]'))
      .filter(item => /^[A-Za-z][A-Za-z0-9_-]{0,79}(?:\[\])?(?:\.[A-Za-z][A-Za-z0-9_-]{0,79})+$/.test(item)))]
      .sort()
      .slice(0, 100);
    const slotSources = (Array.isArray(value.slotSources) ? value.slotSources : [])
      .slice(0, 100)
      .filter(item => item && typeof item === 'object' && !Array.isArray(item))
      .map(item => ({
        kind: sanitizeDiagnosticText(item.kind || '', 40),
        descriptorCount: Math.max(0, Math.min(999, Number(item.descriptorCount) || 0)),
        pathCount: Math.max(0, Math.min(999, Number(item.pathCount) || 0)),
      }))
      .filter(item => SINGLETON_SLOT_SOURCE_KINDS.has(item.kind));
    const discriminator = value.discriminator && typeof value.discriminator === 'object'
      ? {
          fieldPath: sanitizeDiagnosticText(value.discriminator.fieldPath || '', 160),
          source: sanitizeDiagnosticText(value.discriminator.source || '', 80),
        }
      : null;
    const candidateIndexes = [...new Set((Array.isArray(value.candidateIndexes)
      ? value.candidateIndexes : [])
      .filter(Number.isInteger)
      .map(index => Math.max(0, Math.min(999, index))))]
      .slice(0, 20);
    return {
      collection: sanitizeDiagnosticText(value.collection || '', 80),
      pageSlotCount: Math.max(0, Math.min(999, Number(value.pageSlotCount) || 0)),
      jsonItemCount: Math.max(0, Math.min(999, Number(value.jsonItemCount) || 0)),
      discriminator: discriminator?.fieldPath ? discriminator : null,
      candidateIndexes,
      selectedIndex: Number.isInteger(value.selectedIndex)
        ? Math.max(0, Math.min(999, value.selectedIndex)) : null,
      reasonCode: sanitizeDiagnosticText(value.reasonCode || '', 80),
      ...(hasAggregateMetadata ? {
        structuralCollections,
        semanticDescriptorCount: Math.max(
          0,
          Math.min(999, Number(value.semanticDescriptorCount) || 0),
        ),
        descriptorPaths,
        inlineCandidateClusterCount: Math.max(
          0,
          Math.min(100, Number(value.inlineCandidateClusterCount) || 0),
        ),
        slotSources,
      } : {}),
    };
  }
  function attachFieldMatchDiagnostics(fields, matches) {
    return (Array.isArray(fields) ? fields : []).map((field, index) => {
      const byId = field?.detectorId && Array.isArray(matches)
        ? matches.find(item => item?.descriptor?.detectorId === field.detectorId)
        : null;
      const match = byId || (Array.isArray(matches) ? matches[index] : null);
      const singletonBindingDebug = singletonBindingDiagnostic(match?.singletonBindingDebug);
      return {
        ...(field || {}),
        matchedJsonPath: sanitizeDiagnosticText(match?.matchedPath || '', 160),
        score: Math.max(0, Math.min(100, Number(match?.score) || 0)),
        status: sanitizeDiagnosticText(match?.status || 'NOT_EVALUATED', 60),
        reason: sanitizeDiagnosticText(match?.reason || '', 240),
        ...(singletonBindingDebug ? { singletonBindingDebug } : {}),
      };
    });
  }
  function configForSection(config, section) {
    return config?.sections?.[section] || config?.sectionOverrides?.[section] || {};
  }

  function canonicalSectionId(section) {
    const value = text(section);
    return root.JFSectionStructures?.canonicalSectionId?.(value) || value;
  }

  function collectionForSection(section) {
    const canonical = canonicalSectionId(section);
    return root.JFSectionAliases?.collectionForSection?.(canonical) || canonical;
  }

  function diagnosticIndexContext(collection, index, raw = null) {
    const resolvedIndex = Number.isInteger(raw?.index)
      ? Math.max(0, raw.index)
      : Number.isInteger(index)
        ? Math.max(0, index)
        : null;
    if (resolvedIndex === null) return null;
    return {
      section: text(raw?.section || raw?.collection || collection) || collection,
      collection: text(raw?.collection || collection) || collection,
      index: resolvedIndex,
      ...(collection ? { [collection]: resolvedIndex } : {}),
    };
  }

  function diagnosticContext(raw = {}, fallback = {}) {
    const sectionId = canonicalSectionId(
      raw.sectionId || raw.section || raw.collection
      || fallback.sectionId || fallback.section || fallback.collection,
    );
    const collection = text(raw.collection || fallback.collection || collectionForSection(sectionId));
    const rawConfidence = Number(raw.confidence ?? fallback.confidence);
    const index = Number.isInteger(raw.index)
      ? raw.index
      : Number.isInteger(raw.indexContext?.index)
        ? raw.indexContext.index
        : null;
    return {
      section: sectionId,
      sectionId,
      collection,
      collectionMode: text(raw.collectionMode || fallback.collectionMode || 'unknown'),
      source: text(raw.source || fallback.source || 'field-context'),
      confidence: Number.isFinite(rawConfidence) ? Math.max(0, Math.min(1, rawConfidence)) : 0,
      regionId: text(raw.regionId || fallback.regionId || ''),
      index: Number.isInteger(index) ? Math.max(0, index) : null,
      indexContext: diagnosticIndexContext(collection, index, raw.indexContext || fallback.indexContext),
    };
  }

  /*
   * Diagnosis 使用与 Autofill Runtime 相同的只读分组能力：
   * EmbeddedSectionDetector 提供真实区域，ArrayHandler.detectGroups/mapGroups
   * 提供 JSON index ↔ DOM group 对应。这里绝不调用 prepare()，因此不会新增行。
   */
  function buildDiagnosticRegions(document, rootNode, pageSectionContext, config = {}, providedEmbedded = null) {
    const regions = [];
    const detector = root.JFEmbeddedSectionDetector;
    const arrayHandler = root.JFArrayHandler;
    const embedded = Array.isArray(providedEmbedded)
      ? providedEmbedded
      : (detector?.scan?.(document) || detector?.detect?.(document) || []);

    embedded.forEach((candidate, candidateIndex) => {
      const runtimeRoot = candidate?.runtimeRoot || candidate?.root || null;
      if (!runtimeRoot) return;
      try {
        if (rootNode !== document && rootNode?.contains && !rootNode.contains(runtimeRoot) && runtimeRoot !== rootNode) return;
      } catch (_) { return; }

      const sectionId = canonicalSectionId(candidate.sectionId || candidate.collection);
      const collection = text(candidate.collection || collectionForSection(sectionId));
      const regionId = text(candidate.regionId || `${sectionId || 'region'}:${candidateIndex}`);
      const regionContext = diagnosticContext({
        ...candidate,
        sectionId,
        collection,
        regionId,
        collectionMode: candidate.collectionMode || 'repeatable',
        source: candidate.source || 'embedded-structure',
      });
      const sectionConfig = configForSection(config, sectionId);
      const groups = arrayHandler?.detectGroups?.(runtimeRoot, sectionConfig) || [];
      const mapped = arrayHandler?.mapGroups?.(regionContext, groups) || [];

      mapped.forEach((group, index) => {
        const resolvedIndex = Number.isInteger(group.index) ? group.index : index;
        regions.push({
          ...regionContext,
          root: group.element || group.root || group,
          regionId: `${regionId}:group:${resolvedIndex}`,
          index: resolvedIndex,
          indexContext: diagnosticIndexContext(collection, resolvedIndex, group.indexContext),
          priority: 300,
          embedded: true,
        });
      });

      // 兜底区域只提供 collection，不虚构未能确定的行索引。
      regions.push({
        ...regionContext,
        root: runtimeRoot,
        priority: 200,
        embedded: true,
      });
    });

    if (pageSectionContext?.sectionId || pageSectionContext?.collection) {
      const mainContext = diagnosticContext(pageSectionContext);
      let mainIndexContext = mainContext.indexContext;
      let mainIndex = mainContext.index;

      if (mainContext.collectionMode === 'singleton-view') {
        // 与 AutofillEngine 的 singleton 分支一致：唯一 root 通过 mapGroups 固定绑定 index 0。
        const singleton = root.JFArrayHandler?.mapGroups?.(mainContext, [rootNode])?.[0] || null;
        mainIndex = Number.isInteger(singleton?.index) ? singleton.index : 0;
        mainIndexContext = diagnosticIndexContext(mainContext.collection, mainIndex, singleton?.indexContext);
      }

      regions.push({
        ...mainContext,
        root: rootNode,
        regionId: mainContext.regionId || `page:${mainContext.sectionId || 'unknown'}`,
        index: mainIndex,
        indexContext: mainIndexContext,
        priority: 100,
        embedded: false,
      });
    }

    return { embedded, regions };
  }
  function createAdapter(document, options = {}) {
    const config = options.config || {};
    const runtimeWarnings = [];
    const rawProfileIdentity = options.siteProfile || config.siteProfile || options.profile || {};
    const profileId = text(rawProfileIdentity.id || rawProfileIdentity.siteProfileId || rawProfileIdentity.profileId || config.profileId || config.id);
    const profileRevision = text(rawProfileIdentity.revision || rawProfileIdentity.siteProfileRevision || rawProfileIdentity.profileRevision || config.profileRevision || config.revision);
    const siteProfile = Object.freeze({
      matched: rawProfileIdentity.matched === undefined ? Boolean(profileId) : Boolean(rawProfileIdentity.matched),
      id: profileId,
      revision: profileRevision,
      source: text(rawProfileIdentity.source || (profileId ? 'runtime-profile' : 'generic')) || 'generic',
      resolution: text(rawProfileIdentity.resolution || (profileId ? 'MATCHED_PROFILE' : 'GENERIC')) || 'GENERIC',
    });
    const navigation = options.navigationEngine || root.JFNavigationEngine?.createNavigationEngine?.({
      document,
      configuredSelectors: config.navigationSelectors,
      sectionAliases: config.sectionAliases,
      minimumConfidence: config.minimumNavigationConfidence,
    });
    function findContentRoot(section = '') {
      const sectionConfig = configForSection(config, section);
      const configuredSelector = sectionConfig.root || sectionConfig.region || config.contentRoot;
      if (configuredSelector) {
        const configured = query(document, configuredSelector, true)
          .filter(element => visible(element) && !isExtensionUi(element));
        if (configured.length === 1) return configured[0];
        const warning = configured.length > 1
          ? 'PROFILE_CONTENT_ROOT_AMBIGUOUS'
          : 'PROFILE_CONTENT_ROOT_NOT_FOUND';
        if (!runtimeWarnings.includes(warning)) runtimeWarnings.push(warning);
      }
      const candidates = query(document, 'main,[role="main"],form,article,[class*="content"],[class*="form"]', true)
        .filter(element => visible(element) && !element.closest('#__jf_panel__,#__jf_modal__'))
        .map(element => ({ element, controls: query(element, 'input,textarea,select,[contenteditable="true"],[role="combobox"]', true).filter(visible).length }))
        .filter(item => item.controls > 0)
        .sort((a, b) => b.controls - a.controls);
      return candidates[0]?.element || document;
    }
    function detectCurrentSection() {
      const nav = navigation?.scan?.() || [];
      const active = nav.filter(item => item.active).sort((a, b) => b.confidence - a.confidence)[0];
      if (active) return { section: active.sectionId, label: active.label, score: active.confidence, source: 'active-navigation', candidates: [active] };
      const headingElements = query(document, 'h1,h2,h3,h4,h5,h6,legend,[role="heading"],.page-title,[class*="title"]', true).filter(visible).slice(0, 120);
      const ranked = headingElements.map(element => ({ element, result: root.JFSectionAliases?.classifySection?.(text(element.textContent), { minScore: 0.68 }) }))
        .filter(item => item.result?.section)
        .sort((a, b) => b.result.score - a.result.score);
      if (ranked[0]) return { section: ranked[0].result.section, label: text(ranked[0].element.textContent), score: ranked[0].result.score, source: 'heading', candidates: ranked.slice(0, 3).map(item => item.result) };
      return { section: null, label: text(document.title), score: 0, source: 'unknown', candidates: [] };
    }
    function scanFields(section, rootNode, settings = {}) {
      const target = rootNode || findContentRoot(section);
      return root.JFFieldDetector?.scan?.(target, { section, ...settings }) || [];
    }
    function scanFileFields(section, rootNode) {
      const target = rootNode || findContentRoot(section);
      return root.JFFileFieldDetector?.scan?.(target, { section }) || [];
    }
    function diagnose(context = {}) {
      const detected = detectCurrentSection();
      const sectionContext = context.sectionContext && typeof context.sectionContext === 'object'
        ? context.sectionContext : null;
      const sectionArbitrationAmbiguous =
        sectionContext?.arbitration?.reasonCode === 'AMBIGUOUS_SECTION';
      const effectiveSection = sectionArbitrationAmbiguous
        ? null
        : sectionContext?.sectionId || detected.section;
      const rootNode = findContentRoot(effectiveSection);
      const detailedNavigation = navigation?.scanDetailed?.() || { items: navigation?.scan?.() || [], candidates: [] };
      const nav = detailedNavigation.items || [];
      const diagnosticRegions = buildDiagnosticRegions(
        document,
        rootNode,
        sectionContext,
        config,
        context.embeddedSections,
      );
      const fields = scanFields(effectiveSection, rootNode, {
        sectionContext,
        regions: diagnosticRegions.regions,
      });
      const fileFields = scanFileFields(effectiveSection, rootNode);
      let matches = [];
      if (context.resume && root.JFFieldMatcher?.matchFields) {
        try {
          matches = root.JFFieldMatcher.matchFields(fields, context.resume, {
            section: effectiveSection,
            // 每个 descriptor.context 才是字段事实来源；不能用主栏目覆盖 embedded context。
            resumeView: context.resumeView || context.resume,
            fieldAliases: config.fieldAliases,
          });
        } catch (_) { matches = []; }
      }
      const diagnosticFields = attachFieldMatchDiagnostics(root.JFFieldDetector?.toDiagnostic?.(fields) || [], matches);
      const saveHandler = root.JFSaveHandler?.createSaveHandler?.({
        document,
        root: rootNode,
        configuredSelectors: config.safeSaveSelectors || config.save?.selectors || [],
      });
      // Return the complete metadata DTO. The single runtime serialization
      // boundary (JFDiagnosticSanitizer in ContentController) owns privacy,
      // trusted raw counts and explicit structural truncation.
      return {
        schemaVersion: 2,
        generatedAt: new Date().toISOString(),
        siteProfile,
        section: {
          detected: effectiveSection,
          title: sectionContext?.label || detected.label,
          score: sectionArbitrationAmbiguous
            ? 0
            : Number(sectionContext?.confidence || detected.score || 0),
          source: sectionArbitrationAmbiguous
            ? 'unknown'
            : sectionContext?.source || detected.source,
        },
        navigation: {
          itemCount: nav.length,
          items: nav.map(item => ({ section: item.sectionId, label: item.label, text: item.text, confidence: item.confidence, active: item.active, safe: item.safe, reasonCode: item.reasonCode })),
          candidates: (detailedNavigation.candidates || []).map(item => ({
            text: sanitizeDiagnosticText(item.text || '', 120),
            tagName: sanitizeDiagnosticText(item.tagName || item.tag || '', 24),
            hasOnClick: Boolean(item.hasOnClick),
            semanticSection: item.semanticSection,
            accepted: Boolean(item.accepted),
            rejectReason: item.rejectReason || '',
            insideForm: Boolean(item.insideForm),
            hrefType: item.hrefType || 'none',
            acceptReason: item.acceptReason || '',
          })),
        },
        fields: diagnosticFields,
        fileFields: fileFields.map(field => root.JFFileFieldDetector.toDiagnostic(field)),
        groups: root.JFArrayHandler?.detectGroups?.(rootNode, configForSection(config, effectiveSection)).map((group, index) => ({ index, controlCount: query(group, 'input,textarea,select,[contenteditable="true"],[role="combobox"],input[type="file"]', true).length })) || [],
        buttons: query(rootNode, 'button,[role="button"],input[type="button"],input[type="submit"],a', true).slice(0, 120).map(element => ({ text: text(element.innerText || element.textContent || element.value || element.title || element.getAttribute('aria-label')), tag: element.tagName?.toLowerCase(), type: element.type || '', dangerous: root.JFSafety?.isDangerousAction?.(element, { baseUrl: document.location?.href }) || false })),
        saveCandidates: saveHandler?.inspect?.().map(item => ({ text: item.text, safe: item.safe, reasonCode: item.reasonCode })) || [],
        warnings: [
          ...(Array.isArray(config.profileWarnings) ? config.profileWarnings : []),
          ...runtimeWarnings,
          ...(effectiveSection ? [] : ['未能从导航、标题、面包屑或字段签名确定栏目；字段仍可独立匹配，不会因此禁用。']),
        ],
        privacy: {
          mode: 'metadata-only',
          excluded: ['field-values', 'contact-values', 'identity-numbers', 'real-file-names', 'local-paths', 'file-content', 'resume-data', 'page-html', 'cookies', 'tokens'],
        },
      };
    }
    return { config, detectCurrentSection, diagnose, findContentRoot, navigation, scanFields, scanFileFields };
  }
  return {
    attachFieldMatchDiagnostics,
    buildDiagnosticRegions,
    createAdapter,
    sanitizeDiagnosticText,
    sanitizeDiagnosticValue,
  };
});
