/*
 * 解放：字段上下文唯一事实来源。
 * 只描述字段所属栏目/集合/区域/索引，不读取字段值，也不操作 DOM。
 * SPDX-License-Identifier: MIT
 */
(function initFieldContext(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.JFFieldContext = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function fieldContextFactory() {
  'use strict';

  function safeString(value, max = 160) {
    return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
  }

  function confidence(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : fallback;
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

  function singletonDiscriminator(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const fieldPath = safeString(ownValue(raw, 'fieldPath') || ownValue(raw, 'path'), 160)
      .replace(/\[\d+\]/g, '[]');
    const rawValue = ownValue(raw, 'value');
    if (!fieldPath || !['string', 'number', 'boolean'].includes(typeof rawValue)) return null;
    const value = safeString(rawValue, 160);
    if (!value) return null;
    return {
      fieldPath,
      value,
      source: safeString(ownValue(raw, 'source') || 'page-static-discriminator', 60),
    };
  }

  function regionRoot(region) {
    return region?.root
      || region?.runtimeRoot
      || region?.rootElement
      || region?.element
      || null;
  }

  function contains(region, element) {
    const root = regionRoot(region);
    if (!root || !element) return false;
    if (root === element) return true;
    try { return Boolean(root.contains?.(element)); }
    catch (_) { return false; }
  }

  function normalizedIndexContext(raw, collection, fallbackIndex = null) {
    const source = raw && typeof raw === 'object' ? raw : null;
    const index = Number.isInteger(source?.index)
      ? Math.max(0, source.index)
      : Number.isInteger(fallbackIndex)
        ? Math.max(0, fallbackIndex)
        : null;
    if (index === null) return null;
    const section = safeString(source?.section || source?.collection || collection, 80) || collection;
    return {
      section,
      collection: safeString(source?.collection || collection, 80) || collection,
      index,
      ...(collection ? { [collection]: index } : {}),
    };
  }

  function contextFrom(field, region, fallbackContext = null) {
    const fallback = fallbackContext && typeof fallbackContext === 'object' ? fallbackContext : {};
    const source = region && typeof region === 'object' ? region : fallback;
    const section = safeString(
      source.sectionId
      || source.section
      || source.collection
      || fallback.sectionId
      || fallback.section
      || fallback.collection
      || field?.section,
      80,
    );
    const collection = safeString(
      source.collection
      || fallback.collection
      || section,
      80,
    );
    const rawIndex = Number.isInteger(source.index)
      ? source.index
      : Number.isInteger(fallback.index)
        ? fallback.index
        : null;
    const indexContext = normalizedIndexContext(
      source.indexContext || fallback.indexContext,
      collection,
      rawIndex,
    );
    const index = Number.isInteger(indexContext?.index) ? indexContext.index : null;
    const discriminator = singletonDiscriminator(
      source.singletonDiscriminator || fallback.singletonDiscriminator,
    );
    const rawPageSlotCount = Number(
      source.pageSlotCount ?? source.singletonPageSlotCount
      ?? fallback.pageSlotCount ?? fallback.singletonPageSlotCount,
    );
    const pageSlotCount = Number.isInteger(rawPageSlotCount) && rawPageSlotCount >= 0
      ? Math.min(rawPageSlotCount, 100)
      : null;

    return {
      section,
      sectionId: section,
      collection,
      collectionMode: safeString(
        source.collectionMode
        || fallback.collectionMode
        || (collection ? 'record' : 'unknown'),
        40,
      ),
      source: safeString(source.source || fallback.source || 'field-context', 60),
      confidence: confidence(source.confidence, confidence(fallback.confidence, section ? 0.6 : 0)),
      regionId: safeString(
        source.regionId
        || source.id
        || fallback.regionId
        || '',
        120,
      ),
      index,
      indexContext,
      ...(discriminator ? { singletonDiscriminator: discriminator } : {}),
      ...(pageSlotCount !== null ? { pageSlotCount } : {}),
    };
  }

  function create(field, region, index, fallbackContext = null) {
    const enrichedRegion = Number.isInteger(index)
      ? { ...(region || {}), index }
      : region;
    const context = contextFrom(field, enrichedRegion, fallbackContext);
    return {
      fieldId: safeString(field?.detectorId || field?.id, 120),
      raw: {
        label: safeString(field?.labelText || field?.label, 240),
        tableHeader: safeString(field?.tableHeader, 240),
        element: field?.element || field?.interactionElement || null,
      },
      context,
      semantic: {
        canonicalField: safeString(field?.matchedPath, 160),
        expectedType: safeString(field?.controlKind || field?.type, 40),
      },
    };
  }

  function hasIndexBinding(region) {
    return Boolean(region?.indexContext) || Number.isInteger(region?.index);
  }

  function isExplicitProfileRegion(region) {
    if (region?.profilePriority === true || region?.configuredRegion === true) return true;
    return /(?:^|[-_])(site-)?profile(?:$|[-_])|configured/i.test(safeString(region?.source, 80));
  }

  function numericPriority(region) {
    const explicit = Number(region?.priority);
    if (Number.isFinite(explicit)) return explicit;
    if (region?.source === 'embedded-structure' || region?.embedded === true) return 200;
    return 100;
  }

  function compareRegions(left, right) {
    const leftBound = hasIndexBinding(left.region) ? 1 : 0;
    const rightBound = hasIndexBinding(right.region) ? 1 : 0;
    if (leftBound !== rightBound) return rightBound - leftBound;

    const leftProfile = isExplicitProfileRegion(left.region) ? 1 : 0;
    const rightProfile = isExplicitProfileRegion(right.region) ? 1 : 0;
    if (leftProfile !== rightProfile) return rightProfile - leftProfile;
    if (leftProfile && rightProfile) {
      const profilePriorityDifference = numericPriority(right.region) - numericPriority(left.region);
      if (profilePriorityDifference) return profilePriorityDifference;
    }

    const leftRoot = regionRoot(left.region);
    const rightRoot = regionRoot(right.region);
    if (leftRoot && rightRoot && leftRoot !== rightRoot) {
      try {
        if (leftRoot.contains?.(rightRoot)) return 1;
        if (rightRoot.contains?.(leftRoot)) return -1;
      } catch (_) { /* compare remaining stable metadata */ }
    }

    const priorityDifference = numericPriority(right.region) - numericPriority(left.region);
    if (priorityDifference) return priorityDifference;

    const confidenceDifference = confidence(right.region?.confidence) - confidence(left.region?.confidence);
    if (confidenceDifference) return confidenceDifference;

    return left.position - right.position;
  }

  function selectRegion(field, regions = []) {
    const element = field?.element || field?.interactionElement;
    return (Array.isArray(regions) ? regions : [])
      .map((region, position) => ({ region, position }))
      .filter(item => contains(item.region, element))
      .sort(compareRegions)[0]?.region || null;
  }

  /*
   * FieldDetector 直接把此返回值写入 descriptor.context。
   * create() 仍保留完整 FieldContext envelope，兼容独立调试/测试用途。
   */
  function resolve(field, regions = [], fallbackContext = null) {
    return create(field, selectRegion(field, regions), null, fallbackContext).context;
  }

  return Object.freeze({
    contains,
    contextFrom,
    create,
    regionRoot,
    resolve,
    selectRegion,
    singletonDiscriminator,
  });
});
