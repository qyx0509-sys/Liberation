/*
 * 解放：声明式 Site Profile 的验证与归一化。
 * Profile 是不可信纯数据；本模块不读取 DOM、不执行选择器，也不选择站点配置。
 * SPDX-License-Identifier: MIT
 */
(function initSiteProfile(root, factory) {
  let fieldAliases = root?.JFFieldAliases;
  let sectionAliases = root?.JFSectionAliases;
  if (typeof module === 'object' && module.exports) {
    fieldAliases = require('../mappings/field-aliases.js');
    sectionAliases = require('../mappings/section-aliases.js');
  }
  const api = factory(fieldAliases, sectionAliases);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.JFSiteProfile = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function siteProfileFactory(F, Sections) {
  'use strict';

  const SCHEMA_VERSION = 2;
  const DEFAULT_NAVIGATION_CONFIDENCE = 0.78;
  const LIMITS = Object.freeze({
    maxProfiles: 100,
    maxDepth: 12,
    maxNodes: 8_000,
    maxObjectKeys: 300,
    maxArrayItems: 300,
    maxStringLength: 2_000,
    maxSelectors: 30,
    maxSelectorLength: 300,
    maxMatchRules: 30,
    maxAliasesPerField: 30,
    maxAliasLength: 160,
    maxFieldAliasPaths: 160,
    maxOptionFields: 160,
    maxOptionCanonicals: 80,
  });

  const DANGEROUS_KEYS = Object.freeze(new Set([
    '__proto__', 'prototype', 'constructor',
  ]));
  const FORBIDDEN_CAPABILITIES = Object.freeze(new Set([
    'allowsubmit', 'disablesafety', 'allowdangerousaction', 'forceclick',
    'ignoreverification', 'forcecontroladapter', 'onclick', 'callback',
    'handler', 'script', 'javascript', 'eval', 'regexp', 'regex',
    'customoptionminscore', 'optionminscore', 'optionambiguitymargin',
  ]));

  const PROFILE_KEYS = Object.freeze(new Set([
    // V2
    'schemaVersion', 'id', 'revision', 'profileId', 'profileRevision', 'enabled', 'priority', 'match',
    'navigation', 'contentRoot', 'sections', 'fieldAliases', 'optionAliases', 'save',
    // Profile envelope used by the runtime contract.
    'config',
    // V1 compatibility
    'adapterId', 'origin', 'urlPrefix', 'urlPattern', 'navigationSelectors',
    'minimumNavigationConfidence', 'sectionAliases', 'sectionOverrides',
    'safeSaveSelector', 'safeSaveSelectors',
  ]));
  const MATCH_KEYS = Object.freeze(new Set(['origins', 'urlPrefixes', 'urlPatterns']));
  const NAVIGATION_KEYS = Object.freeze(new Set([
    'selectors', 'navigationSelectors', 'minimumConfidence', 'minimumNavigationConfidence', 'sectionAliases',
  ]));
  const SECTION_CONFIG_KEYS = Object.freeze(new Set(['root', 'region', 'groupSelector', 'addButtonSelector']));
  const SAVE_KEYS = Object.freeze(new Set(['selectors']));
  const CONFIG_KEYS = Object.freeze(new Set([
    'navigation', 'navigationSelectors', 'minimumNavigationConfidence', 'sectionAliases',
    'contentRoot', 'sections', 'sectionOverrides', 'fieldAliases', 'optionAliases',
    'save', 'safeSaveSelector', 'safeSaveSelectors',
  ]));
  const WRAPPER_KEYS = Object.freeze(new Set(['schemaVersion', 'description', 'adapters']));

  const EXTRA_SECTIONS = Object.freeze([
    'application', 'recommenders', 'upload_photo', 'upload_materials', 'other',
    // Navigation uses internship while Resume uses internships.
    'internship', 'internships',
  ]);
  const KNOWN_SECTIONS = Object.freeze(new Set([
    ...Object.keys(Sections?.SECTION_ALIASES || {}),
    ...EXTRA_SECTIONS,
  ]));
  const KNOWN_FIELD_PATHS = Object.freeze(new Set(
    (F?.FIELD_DEFINITIONS || []).map(definition => normalizeFieldPath(definition?.path)).filter(Boolean),
  ));

  class ProfileValidationError extends Error {
    constructor(code, path) {
      super(`${code} at ${path}`);
      this.name = 'ProfileValidationError';
      this.code = code;
      this.path = path;
    }
  }

  function safeString(value, maxLength = LIMITS.maxStringLength) {
    return typeof value === 'string'
      ? value.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, maxLength)
      : '';
  }

  function normalizeFieldPath(value) {
    return safeString(value, 180).replace(/\[\d+\]/g, '[]');
  }

  function isPlainObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    try {
      const prototype = Object.getPrototypeOf(value);
      return prototype === Object.prototype || prototype === null;
    } catch (_) {
      return false;
    }
  }

  function fail(code, path) {
    throw new ProfileValidationError(code, path);
  }

  function inspectSerializable(value, path = '$', state = { nodes: 0, ancestors: new Set() }, depth = 0) {
    state.nodes += 1;
    if (state.nodes > LIMITS.maxNodes) fail('PROFILE_NODE_LIMIT', path);
    if (depth > LIMITS.maxDepth) fail('PROFILE_DEPTH_LIMIT', path);
    if (value === null || typeof value === 'boolean') return;
    if (typeof value === 'string') {
      if (value.length > LIMITS.maxStringLength) fail('STRING_TOO_LONG', path);
      return;
    }
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) fail('NON_FINITE_NUMBER', path);
      return;
    }
    if (typeof value !== 'object') fail('NON_DATA_VALUE', path);
    if (value instanceof RegExp) fail('REGEXP_FORBIDDEN', path);
    if (state.ancestors.has(value)) fail('CYCLIC_PROFILE', path);

    if (Array.isArray(value)) {
      if (value.length > LIMITS.maxArrayItems) fail('ARRAY_LIMIT', path);
      state.ancestors.add(value);
      value.forEach((item, index) => inspectSerializable(item, `${path}[${index}]`, state, depth + 1));
      state.ancestors.delete(value);
      return;
    }
    if (!isPlainObject(value)) fail('NON_PLAIN_OBJECT', path);

    let keys;
    let descriptors;
    try {
      keys = Object.keys(value);
      descriptors = Object.getOwnPropertyDescriptors(value);
      if (Object.getOwnPropertySymbols(value).length) fail('SYMBOL_KEY_FORBIDDEN', path);
    } catch (_) {
      fail('UNREADABLE_OBJECT', path);
    }
    if (keys.length > LIMITS.maxObjectKeys) fail('OBJECT_KEY_LIMIT', path);
    state.ancestors.add(value);
    for (const key of keys) {
      const childPath = `${path}.${key}`;
      const lower = String(key).toLowerCase();
      if (DANGEROUS_KEYS.has(key)) fail('PROTOTYPE_KEY_FORBIDDEN', childPath);
      if (FORBIDDEN_CAPABILITIES.has(lower)) fail('FORBIDDEN_CAPABILITY', childPath);
      const descriptor = descriptors[key];
      if (!descriptor || typeof descriptor.get === 'function' || typeof descriptor.set === 'function') {
        fail('ACCESSOR_FORBIDDEN', childPath);
      }
      inspectSerializable(descriptor.value, childPath, state, depth + 1);
    }
    state.ancestors.delete(value);
  }

  function assertObject(value, path) {
    if (!isPlainObject(value)) fail('OBJECT_REQUIRED', path);
    return value;
  }

  function assertAllowedKeys(value, allowed, path) {
    for (const key of Object.keys(value)) {
      if (!allowed.has(key)) fail('UNKNOWN_KEY', `${path}.${key}`);
    }
  }

  function normalizeIdentifier(value, path, fallback = '') {
    if (value === undefined || value === null) return fallback;
    if (typeof value !== 'string') fail('INVALID_PROFILE_ID', path);
    const raw = value.trim();
    if (!raw || raw.length > 80) fail('INVALID_PROFILE_ID', path);
    const id = safeString(raw, 80);
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/.test(id)) fail('INVALID_PROFILE_ID', path);
    return id;
  }

  function normalizeRevision(value, path = '$.revision', required = false) {
    if (value === undefined || value === null) {
      if (required) fail('INVALID_REVISION', path);
      return '';
    }
    if (typeof value !== 'string' || !value.trim() || value.trim().length > 128) fail('INVALID_REVISION', path);
    const revision = safeString(value, 128);
    return revision;
  }

  function normalizePriority(value) {
    if (value === undefined || value === null || value === '') return 0;
    if (!Number.isInteger(value) || value < -1_000 || value > 1_000) fail('INVALID_PRIORITY', '$.priority');
    return value;
  }

  function normalizeBoolean(value, fallback = true) {
    if (value === undefined) return fallback;
    if (typeof value !== 'boolean') fail('BOOLEAN_REQUIRED', '$.enabled');
    return value;
  }

  function unique(values) {
    return [...new Set(values)];
  }

  function normalizeStringArray(value, path, options = {}) {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) fail('ARRAY_REQUIRED', path);
    const maximum = options.maximum || LIMITS.maxArrayItems;
    if (value.length > maximum) fail('ARRAY_LIMIT', path);
    return unique(value.map((item, index) => {
      if (typeof item !== 'string') fail('STRING_REQUIRED', `${path}[${index}]`);
      const normalized = (options.normalizer || safeString)(item);
      if (!normalized) fail('EMPTY_STRING', `${path}[${index}]`);
      return normalized;
    }));
  }

  function normalizeHttpUrl(value, path, kind) {
    if (typeof value !== 'string') fail('STRING_REQUIRED', path);
    const source = safeString(value, 1_000);
    if (!source || source.length !== value.trim().length) fail('INVALID_URL', path);
    let parsed;
    try { parsed = new URL(source); } catch (_) { fail('INVALID_URL', path); }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) fail('UNSAFE_URL', path);
    if (kind === 'origin') {
      if (parsed.pathname !== '/' || parsed.search || parsed.hash || parsed.origin === 'null') fail('INVALID_ORIGIN', path);
      return parsed.origin;
    }
    if (source.includes('*')) fail('WILDCARD_NOT_ALLOWED', path);
    return parsed.href;
  }

  function normalizeUrlPattern(value, path) {
    if (typeof value !== 'string') fail('STRING_REQUIRED', path);
    const source = safeString(value, 1_000);
    if (!source || source.length !== value.trim().length) fail('INVALID_URL_PATTERN', path);
    if (!/^https?:\/\//i.test(source) || /[{}()[\]\\+?^$|]/.test(source)) fail('UNSAFE_URL_PATTERN', path);
    if ((source.match(/\*/g) || []).length > 12) fail('WILDCARD_LIMIT', path);
    const authority = source.match(/^https?:\/\/([^/?#]+)/i)?.[1] || '';
    // A wildcard in the authority can cross an origin boundary (for example,
    // example.invalid* also matches example.invalid.evil). Site Profiles must
    // enumerate origins explicitly; wildcards are limited to the URL tail.
    if (!authority || authority.includes('*')) fail('UNSAFE_HOST_WILDCARD', path);
    let parsed;
    try { parsed = new URL(source.replace(/\*/g, 'x')); } catch (_) { fail('INVALID_URL_PATTERN', path); }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) fail('UNSAFE_URL_PATTERN', path);
    return source;
  }

  function normalizeSelector(value, path) {
    if (typeof value !== 'string') fail('STRING_REQUIRED', path);
    const selector = safeString(value, LIMITS.maxSelectorLength);
    if (!selector || selector.length !== value.trim().length) fail('INVALID_SELECTOR', path);
    // CSS selectors are data, not code. Reject constructs that can embed payload-like
    // text or cause disproportionately expensive document-wide evaluation.
    if (/[\u0000-\u001f\u007f<>`{}]/.test(selector)
      || /(?:expression|javascript|url)\s*\(/i.test(selector)
      || /:has\s*\(/i.test(selector)) fail('UNSAFE_SELECTOR', path);
    return selector;
  }

  function normalizeOptionalSelector(value, path) {
    return value === undefined || value === null || value === ''
      ? ''
      : normalizeSelector(value, path);
  }

  function normalizeSelectorArray(value, path) {
    return normalizeStringArray(value, path, {
      maximum: LIMITS.maxSelectors,
      normalizer: item => normalizeSelector(item, path),
    });
  }

  function mergeStringLists(...lists) {
    return unique(lists.flat().filter(Boolean));
  }

  function normalizeAliasMap(value, path) {
    if (value === undefined || value === null) return {};
    const source = assertObject(value, path);
    if (Object.keys(source).length > LIMITS.maxFieldAliasPaths) fail('ALIAS_PATH_LIMIT', path);
    const output = {};
    for (const [rawSection, aliases] of Object.entries(source)) {
      const section = safeString(rawSection, 80);
      if (!KNOWN_SECTIONS.has(section)) fail('UNKNOWN_SECTION', `${path}.${rawSection}`);
      Object.defineProperty(output, section, {
        enumerable: true,
        configurable: false,
        writable: true,
        value: normalizeStringArray(aliases, `${path}.${rawSection}`, {
          maximum: LIMITS.maxAliasesPerField,
          normalizer: item => {
            const alias = safeString(item, LIMITS.maxAliasLength);
            if (!alias || alias.length !== item.trim().length) fail('INVALID_ALIAS', `${path}.${rawSection}`);
            return alias;
          },
        }),
      });
    }
    return output;
  }

  function mergeAliasMaps(legacy, modern) {
    const output = {};
    for (const key of unique([...Object.keys(legacy), ...Object.keys(modern)])) {
      Object.defineProperty(output, key, {
        enumerable: true,
        configurable: false,
        writable: true,
        value: mergeStringLists(legacy[key] || [], modern[key] || []),
      });
    }
    return output;
  }

  function mergeOptionAliasMaps(...maps) {
    const output = {};
    for (const map of maps) {
      for (const [fieldPath, table] of Object.entries(map || {})) {
        if (!output[fieldPath]) output[fieldPath] = {};
        for (const [canonical, aliases] of Object.entries(table || {})) {
          output[fieldPath][canonical] = mergeStringLists(
            output[fieldPath][canonical] || [],
            aliases || [],
          );
        }
      }
    }
    return output;
  }

  function normalizeFieldAliases(value, path = '$.fieldAliases') {
    if (value === undefined || value === null) return {};
    const source = assertObject(value, path);
    if (Object.keys(source).length > LIMITS.maxFieldAliasPaths) fail('FIELD_ALIAS_PATH_LIMIT', path);
    const output = {};
    for (const [rawPath, aliases] of Object.entries(source)) {
      const fieldPath = normalizeFieldPath(rawPath);
      if (!KNOWN_FIELD_PATHS.has(fieldPath)) fail('UNKNOWN_FIELD_PATH', `${path}.${rawPath}`);
      const normalizedAliases = normalizeStringArray(aliases, `${path}.${rawPath}`, {
        maximum: LIMITS.maxAliasesPerField,
        normalizer: item => {
          const alias = safeString(item, LIMITS.maxAliasLength);
          if (!alias || alias.length !== item.trim().length) fail('INVALID_ALIAS', `${path}.${rawPath}`);
          return alias;
        },
      });
      output[fieldPath] = mergeStringLists(output[fieldPath] || [], normalizedAliases);
    }
    return output;
  }

  function normalizeOptionAliases(value, path = '$.optionAliases') {
    if (value === undefined || value === null) return {};
    const source = assertObject(value, path);
    if (Object.keys(source).length > LIMITS.maxOptionFields) fail('OPTION_FIELD_LIMIT', path);
    const output = {};
    for (const [rawPath, rawTable] of Object.entries(source)) {
      const fieldPath = normalizeFieldPath(rawPath);
      if (!KNOWN_FIELD_PATHS.has(fieldPath)) fail('UNKNOWN_FIELD_PATH', `${path}.${rawPath}`);
      const table = assertObject(rawTable, `${path}.${rawPath}`);
      if (Object.keys(table).length > LIMITS.maxOptionCanonicals) fail('OPTION_CANONICAL_LIMIT', `${path}.${rawPath}`);
      const normalizedTable = {};
      for (const [rawCanonical, aliases] of Object.entries(table)) {
        const canonical = safeString(rawCanonical, LIMITS.maxAliasLength);
        if (!canonical || canonical.length !== rawCanonical.trim().length) fail('INVALID_OPTION_CANONICAL', `${path}.${rawPath}`);
        normalizedTable[canonical] = normalizeStringArray(aliases, `${path}.${rawPath}.${rawCanonical}`, {
          maximum: LIMITS.maxAliasesPerField,
          normalizer: item => {
            const alias = safeString(item, LIMITS.maxAliasLength);
            if (!alias || alias.length !== item.trim().length) fail('INVALID_ALIAS', `${path}.${rawPath}.${rawCanonical}`);
            return alias;
          },
        });
      }
      output[fieldPath] = normalizedTable;
    }
    return output;
  }

  function normalizeSectionConfig(value, path) {
    const source = assertObject(value, path);
    assertAllowedKeys(source, SECTION_CONFIG_KEYS, path);
    const root = source.root === undefined && source.region !== undefined
      ? normalizeOptionalSelector(source.region, `${path}.region`)
      : normalizeOptionalSelector(source.root, `${path}.root`);
    return {
      root,
      groupSelector: normalizeOptionalSelector(source.groupSelector, `${path}.groupSelector`),
      addButtonSelector: normalizeOptionalSelector(source.addButtonSelector, `${path}.addButtonSelector`),
    };
  }

  function normalizeSections(value, path) {
    if (value === undefined || value === null) return {};
    const source = assertObject(value, path);
    if (Object.keys(source).length > KNOWN_SECTIONS.size) fail('SECTION_LIMIT', path);
    const output = {};
    for (const [section, config] of Object.entries(source)) {
      if (!KNOWN_SECTIONS.has(section)) fail('UNKNOWN_SECTION', `${path}.${section}`);
      output[section] = normalizeSectionConfig(config, `${path}.${section}`);
    }
    return output;
  }

  function mergeSections(legacy, modern) {
    const output = {};
    for (const section of unique([...Object.keys(legacy), ...Object.keys(modern)])) {
      const oldConfig = legacy[section] || {};
      const newConfig = modern[section] || {};
      output[section] = {
        root: newConfig.root || oldConfig.root || '',
        groupSelector: newConfig.groupSelector || oldConfig.groupSelector || '',
        addButtonSelector: newConfig.addButtonSelector || oldConfig.addButtonSelector || '',
      };
    }
    return output;
  }

  function normalizedConfidence(value, path) {
    if (value === undefined || value === null || value === '') return DEFAULT_NAVIGATION_CONFIDENCE;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0.55 || value > 1) {
      fail('INVALID_NAVIGATION_CONFIDENCE', path);
    }
    return value;
  }

  function deepFreeze(value, seen = new Set()) {
    if (!value || typeof value !== 'object' || seen.has(value)) return value;
    seen.add(value);
    Object.values(value).forEach(item => deepFreeze(item, seen));
    return Object.freeze(value);
  }

  function normalizeProfileOrThrow(raw) {
    inspectSerializable(raw);
    const source = assertObject(raw, '$');
    assertAllowedKeys(source, PROFILE_KEYS, '$');
    if (source.schemaVersion !== undefined
      && (!Number.isInteger(source.schemaVersion) || ![1, 2].includes(source.schemaVersion))) {
      fail('UNSUPPORTED_SCHEMA_VERSION', '$.schemaVersion');
    }
    const declaredV2 = source.schemaVersion === 2;
    const config = source.config === undefined ? {} : assertObject(source.config, '$.config');
    assertAllowedKeys(config, CONFIG_KEYS, '$.config');

    const match = source.match === undefined ? {} : assertObject(source.match, '$.match');
    assertAllowedKeys(match, MATCH_KEYS, '$.match');
    const origins = mergeStringLists(
      normalizeStringArray(match.origins, '$.match.origins', {
        maximum: LIMITS.maxMatchRules,
        normalizer: item => normalizeHttpUrl(item, '$.match.origins', 'origin'),
      }),
      source.origin === undefined ? [] : [normalizeHttpUrl(source.origin, '$.origin', 'origin')],
    );
    const urlPrefixes = mergeStringLists(
      normalizeStringArray(match.urlPrefixes, '$.match.urlPrefixes', {
        maximum: LIMITS.maxMatchRules,
        normalizer: item => normalizeHttpUrl(item, '$.match.urlPrefixes', 'prefix'),
      }),
      source.urlPrefix === undefined ? [] : [normalizeHttpUrl(source.urlPrefix, '$.urlPrefix', 'prefix')],
    );
    const urlPatterns = mergeStringLists(
      normalizeStringArray(match.urlPatterns, '$.match.urlPatterns', {
        maximum: LIMITS.maxMatchRules,
        normalizer: item => normalizeUrlPattern(item, '$.match.urlPatterns'),
      }),
      source.urlPattern === undefined ? [] : [normalizeUrlPattern(source.urlPattern, '$.urlPattern')],
    );
    if (!origins.length && !urlPrefixes.length && !urlPatterns.length) fail('MATCH_RULE_REQUIRED', '$.match');

    const configuredNavigation = config.navigation === undefined ? {} : assertObject(config.navigation, '$.config.navigation');
    assertAllowedKeys(configuredNavigation, NAVIGATION_KEYS, '$.config.navigation');
    const navigation = source.navigation === undefined ? {} : assertObject(source.navigation, '$.navigation');
    assertAllowedKeys(navigation, NAVIGATION_KEYS, '$.navigation');
    const navigationSelectors = mergeStringLists(
      normalizeSelectorArray(navigation.selectors, '$.navigation.selectors'),
      normalizeSelectorArray(navigation.navigationSelectors, '$.navigation.navigationSelectors'),
      normalizeSelectorArray(configuredNavigation.selectors, '$.config.navigation.selectors'),
      normalizeSelectorArray(configuredNavigation.navigationSelectors, '$.config.navigation.navigationSelectors'),
      normalizeSelectorArray(config.navigationSelectors, '$.config.navigationSelectors'),
      normalizeSelectorArray(source.navigationSelectors, '$.navigationSelectors'),
    );
    const modernSectionAliases = normalizeAliasMap(navigation.sectionAliases, '$.navigation.sectionAliases');
    const configuredNavigationAliases = normalizeAliasMap(configuredNavigation.sectionAliases, '$.config.navigation.sectionAliases');
    const configuredSectionAliases = normalizeAliasMap(config.sectionAliases, '$.config.sectionAliases');
    const legacySectionAliases = normalizeAliasMap(source.sectionAliases, '$.sectionAliases');
    const sectionAliases = mergeAliasMaps(
      mergeAliasMaps(configuredSectionAliases, configuredNavigationAliases),
      mergeAliasMaps(legacySectionAliases, modernSectionAliases),
    );
    const confidenceValue = navigation.minimumConfidence !== undefined
      ? navigation.minimumConfidence
      : navigation.minimumNavigationConfidence !== undefined
        ? navigation.minimumNavigationConfidence
        : configuredNavigation.minimumConfidence !== undefined
          ? configuredNavigation.minimumConfidence
          : configuredNavigation.minimumNavigationConfidence !== undefined
            ? configuredNavigation.minimumNavigationConfidence
            : source.minimumNavigationConfidence !== undefined
              ? source.minimumNavigationConfidence
              : config.minimumNavigationConfidence;
    const minimumConfidence = normalizedConfidence(
      confidenceValue,
      '$.navigation.minimumConfidence',
    );

    const configuredLegacySections = normalizeSections(config.sectionOverrides, '$.config.sectionOverrides');
    const configuredSections = normalizeSections(config.sections, '$.config.sections');
    const legacySections = normalizeSections(source.sectionOverrides, '$.sectionOverrides');
    const modernSections = normalizeSections(source.sections, '$.sections');
    const sections = mergeSections(
      mergeSections(configuredLegacySections, configuredSections),
      mergeSections(legacySections, modernSections),
    );

    const configuredSave = config.save === undefined ? {} : assertObject(config.save, '$.config.save');
    assertAllowedKeys(configuredSave, SAVE_KEYS, '$.config.save');
    const save = source.save === undefined ? {} : assertObject(source.save, '$.save');
    assertAllowedKeys(save, SAVE_KEYS, '$.save');
    const saveSelectors = mergeStringLists(
      normalizeSelectorArray(save.selectors, '$.save.selectors'),
      normalizeSelectorArray(configuredSave.selectors, '$.config.save.selectors'),
      normalizeSelectorArray(config.safeSaveSelectors, '$.config.safeSaveSelectors'),
      config.safeSaveSelector === undefined ? [] : [normalizeOptionalSelector(config.safeSaveSelector, '$.config.safeSaveSelector')],
      normalizeSelectorArray(source.safeSaveSelectors, '$.safeSaveSelectors'),
      source.safeSaveSelector === undefined ? [] : [normalizeOptionalSelector(source.safeSaveSelector, '$.safeSaveSelector')],
    );

    const rawProfileId = source.id !== undefined
      ? source.id
      : source.profileId !== undefined
        ? source.profileId
        : source.adapterId;
    const profileId = normalizeIdentifier(rawProfileId, '$.profileId', declaredV2 ? '' : 'site-specific');
    if (!profileId) fail('INVALID_PROFILE_ID', '$.profileId');
    const rawRevision = source.revision !== undefined ? source.revision : source.profileRevision;
    const profileRevision = normalizeRevision(rawRevision, '$.profileRevision', declaredV2);
    const adapterId = normalizeIdentifier(
      source.adapterId,
      '$.adapterId',
      source.profileId !== undefined ? 'generic' : profileId,
    );
    const contentRoot = normalizeOptionalSelector(
      source.contentRoot !== undefined ? source.contentRoot : config.contentRoot,
      '$.contentRoot',
    );
    const fieldAliases = mergeAliasMaps(
      normalizeFieldAliases(config.fieldAliases, '$.config.fieldAliases'),
      normalizeFieldAliases(source.fieldAliases),
    );
    const optionAliases = mergeOptionAliasMaps(
      normalizeOptionAliases(config.optionAliases, '$.config.optionAliases'),
      normalizeOptionAliases(source.optionAliases),
    );
    const runtimeConfig = {
      navigation: { selectors: navigationSelectors, minimumConfidence, sectionAliases },
      navigationSelectors,
      minimumNavigationConfidence: minimumConfidence,
      sectionAliases,
      contentRoot,
      sections,
      fieldAliases,
      optionAliases,
      save: { selectors: saveSelectors },
      safeSaveSelectors: saveSelectors,
      safeSaveSelector: saveSelectors[0] || '',
    };
    return deepFreeze({
      schemaVersion: SCHEMA_VERSION,
      id: profileId,
      revision: profileRevision,
      profileId,
      profileRevision,
      adapterId,
      enabled: normalizeBoolean(source.enabled, true),
      priority: normalizePriority(source.priority),
      match: { origins, urlPrefixes, urlPatterns },
      navigation: { selectors: navigationSelectors, minimumConfidence, sectionAliases },
      contentRoot,
      sections,
      fieldAliases,
      optionAliases,
      save: { selectors: saveSelectors },
      config: runtimeConfig,
    });
  }

  function validationFailure(error) {
    const known = error instanceof ProfileValidationError;
    return Object.freeze({
      valid: false,
      ok: false,
      profile: null,
      errors: Object.freeze([Object.freeze({
        code: known ? error.code : 'PROFILE_VALIDATION_FAILED',
        path: known ? error.path : '$',
      })]),
      warnings: Object.freeze([]),
    });
  }

  function validateProfile(raw) {
    try {
      const profile = normalizeProfileOrThrow(raw);
      return Object.freeze({
        valid: true,
        ok: true,
        profile,
        errors: Object.freeze([]),
        warnings: Object.freeze(Number(raw?.schemaVersion || (raw?.match || raw?.navigation || raw?.save ? 2 : 1)) === 1
          ? [Object.freeze({ code: 'V1_PROFILE_NORMALIZED', path: '$' })]
          : []),
      });
    } catch (error) {
      return validationFailure(error);
    }
  }

  function normalizeProfile(raw) {
    return validateProfile(raw).profile;
  }

  function isValidProfile(raw) {
    return validateProfile(raw).valid;
  }

  function normalizeProfiles(input) {
    let rawProfiles = input;
    let wrapperSchemaVersion = null;
    try {
      if (isPlainObject(input) && Object.hasOwn(input, 'adapters')) {
        inspectSerializable(input);
        assertAllowedKeys(input, WRAPPER_KEYS, '$');
        if (input.schemaVersion !== undefined
          && (!Number.isInteger(input.schemaVersion) || ![1, 2].includes(input.schemaVersion))) {
          fail('UNSUPPORTED_SCHEMA_VERSION', '$.schemaVersion');
        }
        wrapperSchemaVersion = input.schemaVersion ?? null;
        if (input.description !== undefined && typeof input.description !== 'string') fail('STRING_REQUIRED', '$.description');
        rawProfiles = input.adapters;
      }
      if (rawProfiles === undefined || rawProfiles === null) rawProfiles = [];
      if (!Array.isArray(rawProfiles)) fail('PROFILE_ARRAY_REQUIRED', '$');
      if (rawProfiles.length > LIMITS.maxProfiles) fail('PROFILE_LIMIT', '$');
    } catch (error) {
      const failure = validationFailure(error);
      return deepFreeze({ profiles: [], rejected: [{ index: -1, errors: failure.errors }], warnings: [] });
    }

    const profiles = [];
    const rejected = [];
    const warnings = [];
    rawProfiles.forEach((raw, index) => {
      if (wrapperSchemaVersion === 2 && (!isPlainObject(raw) || raw.schemaVersion !== 2)) {
        rejected.push({
          index,
          errors: Object.freeze([Object.freeze({
            code: 'V2_PROFILE_REQUIRED',
            path: `$.adapters[${index}].schemaVersion`,
          })]),
        });
        return;
      }
      const result = validateProfile(raw);
      if (result.valid) {
        profiles.push(result.profile);
        result.warnings.forEach(warning => warnings.push({ index, ...warning }));
      } else {
        rejected.push({ index, errors: result.errors });
      }
    });
    return deepFreeze({ profiles, rejected, warnings });
  }

  function profileIdentity(profileLike) {
    const profile = normalizeProfile(profileLike);
    if (!profile) return Object.freeze({ id: '', revision: '' });
    return Object.freeze({ id: profile.id, revision: profile.revision });
  }

  function createLocalOverlay(profileLike) {
    const profile = normalizeProfile(profileLike);
    const fieldAliases = profile?.fieldAliases || {};
    const optionAliases = profile?.optionAliases || {};
    const sectionAliases = profile?.navigation?.sectionAliases || {};
    const aliasResult = values => Object.freeze([...(values || [])]);
    return Object.freeze({
      id: profile?.id || '',
      revision: profile?.revision || '',
      fieldAliases,
      optionAliases,
      sectionAliases,
      getFieldAliases(fieldPath) {
        return aliasResult(fieldAliases[normalizeFieldPath(fieldPath)]);
      },
      getOptionAliases(fieldPath, canonical) {
        const path = normalizeFieldPath(fieldPath);
        const key = typeof canonical === 'string' ? canonical.trim() : String(canonical ?? '').trim();
        return aliasResult(optionAliases[path]?.[key]);
      },
      getSectionAliases(section) {
        return aliasResult(sectionAliases[safeString(section, 80)]);
      },
    });
  }

  function toRuntimeConfig(profileLike) {
    // Never trust a caller-provided object merely because it resembles V2.
    const profile = normalizeProfile(profileLike);
    if (!profile) return Object.freeze({});
    return deepFreeze({
      schemaVersion: SCHEMA_VERSION,
      id: profile.id,
      profileId: profile.id,
      profileRevision: profile.revision,
      adapterId: profile.adapterId || profile.id,
      revision: profile.revision,
      enabled: profile.enabled,
      priority: profile.priority,
      match: profile.match,
      navigation: profile.navigation,
      contentRoot: profile.contentRoot,
      sections: profile.sections,
      fieldAliases: profile.fieldAliases,
      optionAliases: profile.optionAliases,
      save: profile.save,
      // Flattened compatibility view consumed by the current GenericAdapter.
      origin: profile.match.origins[0] || '',
      urlPrefix: profile.match.urlPrefixes[0] || '',
      urlPattern: profile.match.urlPatterns[0] || '',
      navigationSelectors: profile.navigation.selectors,
      minimumNavigationConfidence: profile.navigation.minimumConfidence,
      sectionAliases: profile.navigation.sectionAliases,
      safeSaveSelectors: profile.save.selectors,
      safeSaveSelector: profile.save.selectors[0] || '',
    });
  }

  function wildcardMatches(pattern, value) {
    let source;
    try { source = normalizeUrlPattern(pattern, '$.urlPattern'); }
    catch (_) { return false; }
    const target = typeof value === 'string' ? value : '';
    const escaped = source.replace(/[.*]/g, token => token === '*' ? '.*' : '\\.')
      .replace(/\//g, '\\/');
    try { return new RegExp(`^${escaped}$`, 'i').test(target); }
    catch (_) { return false; }
  }

  return Object.freeze({
    DEFAULT_NAVIGATION_CONFIDENCE,
    KNOWN_FIELD_PATHS,
    KNOWN_SECTIONS,
    LIMITS,
    ProfileValidationError,
    SCHEMA_VERSION,
    isPlainObject,
    isValidProfile,
    createLocalOverlay,
    normalizeFieldAliases,
    normalizeFieldPath,
    normalizeOptionAliases,
    normalizeProfile,
    normalizeProfileOrThrow,
    normalizeProfiles,
    profileIdentity,
    sanitizeProfile: normalizeProfile,
    toRuntimeConfig,
    validateProfile,
    wildcardMatches,
  });
});
