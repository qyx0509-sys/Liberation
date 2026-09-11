/*
 * 解放：Generic Adapter + 声明式 Site Profile 注册与确定性选择。
 * Profile 只提供局部证据；不能替代 Core、执行代码或绕过 Safety。
 * SPDX-License-Identifier: MIT
 */
(function initAdapterRegistry(root, factory) {
  let siteProfile = root?.JFSiteProfile;
  if (typeof module === 'object' && module.exports) {
    siteProfile = require('./site-profile.js');
  }
  const api = factory(siteProfile);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.JFAdapterRegistry = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function adapterRegistryFactory(P) {
  'use strict';

  const RESOLUTION = Object.freeze({
    MATCHED: 'MATCHED',
    GENERIC: 'GENERIC',
    AMBIGUOUS: 'AMBIGUOUS_PROFILE',
  });

  const registry = Object.freeze({
    implemented: Object.freeze([
      Object.freeze({ id: 'generic', label: '通用报名系统', module: 'generic-adapter.js' }),
      Object.freeze({ id: 'undergraduate-awards', label: '奖励情况（本科期间）回退适配器', module: 'undergraduate-awards.js' }),
    ]),
    extensionPoints: Object.freeze([
      'navigation.selectors', 'navigation.sectionAliases', 'contentRoot', 'sections',
      'sections.*.root', 'sections.*.groupSelector', 'sections.*.addButtonSelector',
      'fieldAliases', 'optionAliases', 'save.selectors',
    ]),
  });

  function safeString(value, max = 300) {
    return typeof value === 'string'
      ? value.replace(/[\u0000-\u001f\u007f]+/g, '').trim().slice(0, max)
      : '';
  }

  function deepFreeze(value, seen = new Set()) {
    if (!value || typeof value !== 'object' || seen.has(value)) return value;
    seen.add(value);
    Object.values(value).forEach(item => deepFreeze(item, seen));
    return Object.freeze(value);
  }

  function wildcardMatches(pattern, value) {
    if (P?.wildcardMatches) return P.wildcardMatches(pattern, value);
    const source = safeString(pattern, 1_000);
    const target = safeString(value, 4_000);
    if (!/^https?:\/\//i.test(source) || /[{}()[\]\\+?^$|]/.test(source)) return false;
    const authority = source.match(/^https?:\/\/([^/?#]+)/i)?.[1] || '';
    if (!authority || authority.includes('*')) return false;
    try {
      const parsedTarget = new URL(target);
      if (!['http:', 'https:'].includes(parsedTarget.protocol)
        || parsedTarget.username || parsedTarget.password) return false;
    } catch (_) {
      return false;
    }
    const escaped = source.replace(/[.*]/g, token => token === '*' ? '.*' : '\\.');
    try { return new RegExp(`^${escaped}$`, 'i').test(target); }
    catch (_) { return false; }
  }

  function normalizeLocation(locationLike) {
    let href = '';
    let origin = '';
    try {
      href = safeString(locationLike?.href, 4_000);
      origin = safeString(locationLike?.origin, 1_000);
    } catch (_) {
      return Object.freeze({ href: '', origin: '' });
    }
    let parsed = null;
    try { parsed = href ? new URL(href) : origin ? new URL(origin) : null; }
    catch (_) { parsed = null; }
    if (!parsed || !['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
      return Object.freeze({ href: '', origin: '' });
    }
    href = href || parsed.href;
    origin = origin || parsed.origin;
    if (origin !== parsed.origin) return Object.freeze({ href: '', origin: '' });
    return Object.freeze({ href, origin });
  }

  function matchingPrefix(prefixes, href) {
    return (prefixes || [])
      .filter(prefix => href.startsWith(prefix))
      .sort((left, right) => right.length - left.length || left.localeCompare(right))[0] || '';
  }

  function matchingPattern(patterns, href) {
    return (patterns || [])
      .filter(pattern => wildcardMatches(pattern, href))
      .sort((left, right) => {
        const leftLiteral = left.replace(/\*/g, '').length;
        const rightLiteral = right.replace(/\*/g, '').length;
        return rightLiteral - leftLiteral || left.localeCompare(right);
      })[0] || '';
  }

  function matchEvidence(profile, locationLike) {
    const location = normalizeLocation(locationLike);
    if (!profile?.match || !location.href || !location.origin || profile.enabled === false) {
      return Object.freeze({ matched: false, specificity: -1, tier: 0 });
    }
    const origins = Array.isArray(profile.match.origins) ? profile.match.origins : [];
    const prefixes = Array.isArray(profile.match.urlPrefixes) ? profile.match.urlPrefixes : [];
    const patterns = Array.isArray(profile.match.urlPatterns) ? profile.match.urlPatterns : [];
    const originMatched = !origins.length || origins.includes(location.origin);
    const prefix = matchingPrefix(prefixes, location.href);
    const pattern = matchingPattern(patterns, location.href);
    if (!originMatched || (prefixes.length && !prefix) || (patterns.length && !pattern)) {
      return Object.freeze({ matched: false, specificity: -1, tier: 0 });
    }

    const exactPrefix = Boolean(prefix && prefix === location.href);
    const exactPattern = Boolean(pattern && !pattern.includes('*') && pattern === location.href);
    let tier = 0;
    if (exactPrefix || exactPattern) tier = 5;
    else if (prefix) tier = 4;
    else if (origins.length && pattern) tier = 3;
    else if (origins.length) tier = 2;
    else if (pattern) tier = 1;
    if (!tier) return Object.freeze({ matched: false, specificity: -1, tier: 0 });

    const literalLength = Math.min(100_000,
      (prefix?.length || 0) + (pattern ? pattern.replace(/\*/g, '').length : 0));
    const constraintCount = Number(Boolean(origins.length)) + Number(Boolean(prefixes.length)) + Number(Boolean(patterns.length));
    const specificity = tier * 1_000_000 + constraintCount * 100_000 + literalLength;
    return Object.freeze({
      matched: true,
      specificity,
      tier,
      // Metadata only: never return the current URL or a complete selector/profile body.
      matchedOrigin: Boolean(origins.length),
      matchedPrefix: Boolean(prefix),
      matchedPattern: Boolean(pattern),
    });
  }

  function normalizeOne(config) {
    return P?.normalizeProfile ? P.normalizeProfile(config) : null;
  }

  function matchesConfig(config, locationLike) {
    const profile = normalizeOne(config);
    return Boolean(profile && matchEvidence(profile, locationLike).matched);
  }

  function profileSpecificity(config, locationLike) {
    const profile = normalizeOne(config);
    return profile ? matchEvidence(profile, locationLike).specificity : -1;
  }

  function genericResolution(values = {}) {
    const ambiguous = values.resolution === RESOLUTION.AMBIGUOUS;
    const candidates = values.candidates || [];
    return deepFreeze({
      matched: false,
      resolution: values.resolution || RESOLUTION.GENERIC,
      reasonCode: values.reasonCode || values.resolution || RESOLUTION.GENERIC,
      ambiguous,
      profile: null,
      config: {},
      adapterId: 'generic',
      profileId: '',
      profileRevision: '',
      siteProfileId: '',
      siteProfileRevision: '',
      source: safeString(values.source || 'storage', 40) || 'storage',
      candidates,
      candidateProfileIds: candidates.map(candidate => candidate.id),
      warnings: values.warnings || [],
      rejectedCount: Math.max(0, Number(values.rejectedCount) || 0),
    });
  }

  function normalizeProfileCollection(configs) {
    if (!P?.normalizeProfiles) {
      return deepFreeze({
        profiles: [],
        rejected: [{ index: -1, errors: [{ code: 'SITE_PROFILE_HELPER_UNAVAILABLE', path: '$' }] }],
        warnings: [],
      });
    }
    return P.normalizeProfiles(configs);
  }

  function safeWarnings(normalized) {
    const warnings = [];
    (normalized?.warnings || []).slice(0, 100).forEach(item => {
      warnings.push(Object.freeze({
        code: safeString(item?.code, 80) || 'PROFILE_WARNING',
        index: Number.isInteger(item?.index) ? item.index : -1,
        path: safeString(item?.path, 160) || '$',
      }));
    });
    (normalized?.rejected || []).slice(0, 100).forEach(item => {
      const first = item?.errors?.[0] || {};
      warnings.push(Object.freeze({
        code: safeString(first.code, 80) || 'INVALID_PROFILE',
        index: Number.isInteger(item?.index) ? item.index : -1,
        path: safeString(first.path, 160) || '$',
      }));
    });
    return warnings;
  }

  function candidateMetadata(entry) {
    return Object.freeze({
      id: safeString(entry.profile.id, 80),
      revision: safeString(entry.profile.revision, 128),
      priority: entry.profile.priority,
      specificity: entry.evidence.specificity,
    });
  }

  function resolveProfile(configs, locationLike, options = {}) {
    const source = safeString(options.source || 'storage', 40) || 'storage';
    const normalized = normalizeProfileCollection(configs);
    const warnings = safeWarnings(normalized);
    const matches = (normalized.profiles || [])
      .map(profile => ({ profile, evidence: matchEvidence(profile, locationLike) }))
      .filter(entry => entry.evidence.matched)
      .sort((left, right) => (
        right.profile.priority - left.profile.priority
        || right.evidence.specificity - left.evidence.specificity
        || left.profile.id.localeCompare(right.profile.id)
        || left.profile.revision.localeCompare(right.profile.revision)
      ));

    if (!matches.length) {
      return genericResolution({
        source,
        warnings,
        rejectedCount: normalized.rejected?.length || 0,
      });
    }

    const best = matches[0];
    const tied = matches.filter(entry => entry.profile.priority === best.profile.priority
      && entry.evidence.specificity === best.evidence.specificity);
    if (tied.length > 1) {
      return genericResolution({
        source,
        resolution: RESOLUTION.AMBIGUOUS,
        reasonCode: RESOLUTION.AMBIGUOUS,
        candidates: tied.slice(0, 20).map(candidateMetadata),
        warnings: [...warnings, Object.freeze({ code: RESOLUTION.AMBIGUOUS, index: -1, path: '$' })],
        rejectedCount: normalized.rejected?.length || 0,
      });
    }

    const runtimeConfig = P?.toRuntimeConfig ? P.toRuntimeConfig(best.profile) : {};
    return deepFreeze({
      matched: true,
      resolution: RESOLUTION.MATCHED,
      reasonCode: RESOLUTION.MATCHED,
      ambiguous: false,
      profile: best.profile,
      config: runtimeConfig,
      adapterId: best.profile.adapterId || best.profile.id,
      profileId: best.profile.id,
      profileRevision: best.profile.revision,
      siteProfileId: best.profile.id,
      siteProfileRevision: best.profile.revision,
      source,
      specificity: best.evidence.specificity,
      priority: best.profile.priority,
      candidates: [candidateMetadata(best)],
      candidateProfileIds: [best.profile.id],
      warnings,
      rejectedCount: normalized.rejected?.length || 0,
    });
  }

  function resolveSiteConfig(configs, locationLike, options = {}) {
    const resolution = resolveProfile(configs, locationLike, options);
    return resolution.matched ? resolution.config : Object.freeze({});
  }

  return Object.freeze({
    ...registry,
    RESOLUTION,
    matchEvidence,
    matchesConfig,
    profileSpecificity,
    resolve: resolveProfile,
    resolveProfile,
    resolveSiteConfig,
    wildcardMatches,
  });
});
