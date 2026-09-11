/*
 * 解放：通用嵌入式栏目区域检测器。
 * 一个真实 DOM 区域只允许产生一个 embedded 执行上下文。
 * 栏目表头结构统一来自 mappings/section-structures.js。
 */
(function initEmbeddedSectionDetector(root, factory) {
  let structures = root?.JFSectionStructures;
  if (typeof module === 'object' && module.exports) {
    try { structures ||= require('../mappings/section-structures.js'); } catch (_) { /* browser */ }
  }
  const api = factory(structures, () => root?.JFArrayHandler || null);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.JFEmbeddedSectionDetector = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function embeddedSectionDetectorFactory(Structures, getArrayHandler) {
  'use strict';

  const REGION_SIGNATURES = Structures?.SECTION_TABLE_SIGNATURES || Object.freeze({});
  const REGION_SELECTOR = 'table,[role="table"],fieldset,[data-repeat-list],[data-array-list]';

  function safeText(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
  }

  function normalize(value) {
    return Structures?.normalizeStructureText?.(value)
      || safeText(value)
        .replace(/[\s:：,，.。;；、（）()\[\]【】/_-]+/g, '')
        .toLowerCase();
  }

  function isVisible(element) {
    if (!element || element.hidden || element.getAttribute?.('aria-hidden') === 'true') return false;
    const view = element.ownerDocument?.defaultView || globalThis;
    try {
      const style = view.getComputedStyle?.(element);
      if (style && (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0')) return false;
    } catch (_) { /* geometry fallback */ }
    const rect = element.getBoundingClientRect?.();
    return !rect || rect.width > 0 || rect.height > 0;
  }

  function ownedTextFor(region) {
    const parts = [];

    function visit(parent) {
      const children = parent?.childNodes || parent?.children || [];
      for (const child of children) {
        if (child?.nodeType === 3) {
          const value = safeText(child.nodeValue || child.textContent || '');
          if (value) parts.push(value);
          continue;
        }
        if (!child || child.nodeType !== 1) continue;
        try {
          if (child.matches?.(REGION_SELECTOR)) continue;
        } catch (_) { /* non-browser test doubles */ }

        const descendants = child.childNodes || child.children || [];
        if (descendants.length) visit(child);
        else {
          const value = safeText(child.innerText || child.textContent || '');
          if (value) parts.push(value);
        }
      }
    }

    visit(region);
    return normalize(parts.join(' '));
  }

  function headersFor(region) {
    let headerNodes = [];
    try {
      headerNodes = [
        ...region.querySelectorAll('th,thead td,tr:first-child td,[role="columnheader"]'),
      ];
    } catch (_) { /* fallback */ }

    const ownedNodes = [];
    const nestedNodes = [];
    for (const node of headerNodes) {
      let owner = null;
      try { owner = node.closest?.(REGION_SELECTOR) || null; }
      catch (_) { owner = null; }

      // Real DOM headers always expose closest(). Test doubles from older suites
      // may not; treating only that compatibility case as local preserves the
      // previous fixture contract without allowing a real nested table to leak.
      if (!owner || owner === region) ownedNodes.push(node);
      else nestedNodes.push(node);
    }

    const headers = ownedNodes
      .map(node => normalize(node.innerText || node.textContent || node.getAttribute?.('aria-label') || ''))
      .filter(Boolean);

    return {
      headers: [...new Set(headers)],
      ownedHeaderCount: ownedNodes.length,
      nestedHeaderCount: nestedNodes.length,
      ownedEvidenceCount: [...new Set(headers)].length,
      evidenceScope: 'owned',
    };
  }

  function strongTitlesFor(region) {
    const values = [];
    const append = (value, source) => {
      const text = safeText(value);
      if (text) values.push({ text, source });
    };

    [
      'aria-label',
      'data-caption',
      'data-label',
      'data-field-label',
      'data-title',
    ].forEach(attribute => append(region.getAttribute?.(attribute), attribute));

    let titleNodes = [
      ...(region.children || []),
    ].filter(node => {
      const tagName = safeText(node?.tagName).toLowerCase();
      return tagName === 'legend'
        || /^h[1-6]$/.test(tagName)
        || node?.getAttribute?.('role') === 'heading';
    });
    try {
      titleNodes.push(
        ...region.querySelectorAll('legend,h1,h2,h3,h4,h5,h6,[role="heading"]'),
      );
    } catch (_) { /* non-browser test doubles */ }

    [...new Set(titleNodes)].forEach(node => {
      const tagName = safeText(node.tagName).toLowerCase();
      const directLegend = tagName === 'legend' && node.parentElement === region;
      const directHeading = /^h[1-6]$/.test(tagName) && node.parentElement === region;
      const directRoleHeading = node.getAttribute?.('role') === 'heading'
        && node.parentElement === region;
      if (!directLegend && !directHeading && !directRoleHeading) return;
      append(
        node.innerText || node.textContent || node.getAttribute?.('aria-label') || '',
        directLegend ? 'legend' : 'heading',
      );
    });

    const seen = new Set();
    return values.filter(item => {
      const key = `${normalize(item.text)}\u0000${item.source}`;
      if (!normalize(item.text) || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function definitionForStrongTitles(titleEvidence) {
    const definitions = Structures?.EMBEDDED_COLLECTION_STRUCTURES || [];
    const matched = definitions.filter(definition =>
      (definition.titleTerms || []).some(term =>
        titleEvidence.some(item =>
          Structures?.headerMatchesTerm
            ? Structures.headerMatchesTerm(item.text, term)
            : normalize(item.text).includes(normalize(term)),
        ),
      ),
    );
    return matched.length === 1 ? matched[0] : null;
  }

  function repeatabilityFor(region, definition, groups) {
    let explicitMarker = false;
    try { explicitMarker = Boolean(region.matches?.('[data-repeat-list],[data-array-list]')); }
    catch (_) { explicitMarker = false; }

    const handler = getArrayHandler?.();
    const scopedAddControl = handler?.findAddButton?.(
      region,
      definition.sectionId,
    ) || null;

    return {
      directGroupCount: groups.length,
      hasExplicitRepeatMarker: explicitMarker,
      hasScopedAddControl: Boolean(scopedAddControl),
      qualifies: groups.length > 0 || explicitMarker || Boolean(scopedAddControl),
    };
  }

  function matchRegion(region, regionIndex) {
    const headerEvidence = headersFor(region);
    const groups = getArrayHandler?.()?.detectGroups?.(region, { ownedOnly: true }) || [];
    const best = Structures?.selectBestDefinitionForHeaders?.(headerEvidence.headers);
    const titleEvidence = best ? [] : strongTitlesFor(region);
    const titleDefinition = best ? null : definitionForStrongTitles(titleEvidence);
    const repeatability = titleDefinition
      ? repeatabilityFor(region, titleDefinition, groups)
      : null;

    if (!best && (!titleDefinition || !repeatability?.qualifies)) return null;

    const definition = best?.definition || titleDefinition;
    const score = best?.score || {
      confidence: 0.9,
      matchedGroups: [],
    };
    const evidenceKind = best ? 'structural-headers' : 'strong-title-repeatable';
    const titleEvidenceCount = titleEvidence.length;
    const repeatableEvidenceCount = repeatability
      ? Number(repeatability.directGroupCount > 0)
        + Number(repeatability.hasExplicitRepeatMarker)
        + Number(repeatability.hasScopedAddControl)
      : 0;
    return {
      sectionId: definition.sectionId,
      source: 'embedded-structure',
      confidence: score.confidence,
      collection: definition.collection || definition.sectionId,
      collectionMode: definition.collectionMode || 'repeatable',
      regionId: `${safeText(region.tagName || 'region').toLowerCase() || 'region'}:${regionIndex}`,
      runtimeRoot: region,
      groupCount: groups.length,
      zeroRow: groups.length === 0,
      evidenceScope: headerEvidence.evidenceScope,
      ownedHeaderCount: headerEvidence.ownedHeaderCount,
      nestedHeaderCount: headerEvidence.nestedHeaderCount,
      ownedEvidenceCount:
        headerEvidence.ownedEvidenceCount
        + titleEvidenceCount
        + repeatableEvidenceCount,
      evidenceKind,
      qualificationReason: evidenceKind === 'structural-headers'
        ? 'OWNED_STRUCTURAL_HEADERS'
        : 'STRONG_TITLE_WITH_REPEATABILITY',
      evidence: best
        ? score.matchedGroups.map(group => group[0]).slice(0, 8)
        : (definition.titleTerms || []).slice(0, 1),
    };
  }

  function suppressAncestorDuplicates(candidates) {
    return candidates.filter(candidate => !candidates.some(other => {
      if (!other || other === candidate || other.collection !== candidate.collection) return false;
      const ownedEvidenceCount = Math.max(0, Number(
        candidate.ownedEvidenceCount ?? candidate.ownedHeaderCount ?? 0,
      ));
      const nestedHeaderCount = Math.max(0, Number(candidate.nestedHeaderCount || 0));
      const evidenceDerivedFromNested = candidate.evidenceScope === 'nested'
        || (ownedEvidenceCount === 0 && nestedHeaderCount > 0);
      const tableBackedWrapper = Math.max(0, Number(candidate.groupCount || 0)) === 0
        && other.evidenceKind === 'structural-headers'
        && Math.max(0, Number(other.ownedHeaderCount || 0)) > 0;

      // Containment alone is not evidence that the ancestor is false. A
      // fieldset may legitimately own its legend/direct repeat rows/add action
      // while also containing a same-collection auxiliary table. Suppress the
      // ancestor when nested structure is its only evidence, or when its zero
      // direct rows are represented by the descendant's owned structural table.
      // A fieldset with real direct rows keeps groupCount > 0 and remains a
      // separate legitimate candidate.
      if (!evidenceDerivedFromNested && !tableBackedWrapper) return false;
      const ancestor = candidate.runtimeRoot;
      const descendant = other.runtimeRoot;
      if (!ancestor || !descendant || ancestor === descendant) return false;
      try { return Boolean(ancestor.contains?.(descendant)); }
      catch (_) { return false; }
    }));
  }

  function detect(document = globalThis.document) {
    if (!document?.querySelectorAll || !Structures?.selectBestDefinitionForHeaders) return [];

    const regions = [
      ...document.querySelectorAll(REGION_SELECTOR),
    ].filter(isVisible);

    const candidates = [];
    regions.forEach((region, index) => {
      const candidate = matchRegion(region, index);
      if (candidate) candidates.push(candidate);
    });

    return suppressAncestorDuplicates(candidates);
  }

  return Object.freeze({
    REGION_SELECTOR,
    REGION_SIGNATURES,
    detect,
    scan: detect,
  });
});
