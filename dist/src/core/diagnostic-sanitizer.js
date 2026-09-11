/*
 * 解放：诊断序列化边界。
 * 只处理元数据脱敏、类型安全裁剪、可信统计与 JSON 安全，不读取 DOM 或 Resume。
 * SPDX-License-Identifier: MIT
 */
(function initDiagnosticSanitizer(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.JFDiagnosticSanitizer = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function diagnosticSanitizerFactory(root) {
  'use strict';

  const DEFAULT_LIMITS = Object.freeze({
    maxArrayItems: 500,
    maxObjectKeys: 500,
    maxDepth: 10,
    // 这是每个顶层分支、每个数组条目的独立预算，不是整个 diagnosis 的共享预算。
    maxNodes: 5_000,
    // Independent branch budgets protect schema priority. This global ceiling is
    // only an emergency brake for malformed or hostile adapter output.
    maxTotalNodes: 100_000,
    maxTextLength: 1_000,
    maxTruncationEntries: 200,
  });

  const CORE_ARRAY_KEYS = Object.freeze([
    'embeddedSections', 'warnings', 'fileFields', 'groups', 'buttons',
    'saveCandidates', 'progressionBlockers', 'optionMatchingTraces', 'fields',
  ]);
  const CORE_OBJECT_KEYS = Object.freeze([
    'page', 'siteProfile', 'section', 'sectionDetection', 'navigation', 'privacy',
  ]);
  const TOP_LEVEL_PRIORITY = Object.freeze([
    'schemaVersion', 'generatedAt', 'scanId', 'page', 'siteProfile', 'section',
    'embeddedSections', 'sectionDetection', 'progressionBlocked', 'progressionBlockers',
    'optionMatchingTraces', 'privacy', 'warnings', 'navigation',
    'fileFields', 'groups', 'buttons', 'saveCandidates', 'fields',
  ]);
  const PRIVACY_EXCLUDED = Object.freeze([
    'field-values', 'resume-data', 'file-content', 'page-html', 'cookies',
    'tokens', 'sessions', 'query-string',
  ]);
  const BLOCKED_KEYS = Object.freeze(new Set([
    'value', 'values', 'rawvalue', 'rawvalues', 'currentvalue', 'currentvalues',
    'plannedvalue', 'plannedvalues', 'beforevalue', 'beforevalues', 'aftervalue',
    'aftervalues', 'fieldvalue', 'fieldvalues', 'pagevalue', 'pagevalues',
    'resumedata', 'resumeview', 'resume',
    'authorization', 'nonce', 'base64', 'blob', 'file', 'files', 'filedata',
    'filecontent', 'filename',
    'filepath', 'fullpath', 'localpath', 'path', 'html', 'outerhtml', 'innerhtml',
    'cookie', 'cookies', 'token', 'session', 'password', 'secret', 'apikey',
    'credential', 'credentials', 'passcode', 'authheader', 'authorizationheader',
    'jwt', 'bearer', 'accesstoken', 'refreshtoken', 'accesskey', 'secretkey',
    'privatekey', 'clientsecret',
    'url', 'href', 'search', 'hash', 'query', 'querystring',
    'element', 'elements', 'interactionelement', 'ownerdocument', 'document',
    '__proto__', 'prototype', 'constructor',
  ]));

  function finiteLimit(value, fallback, minimum, maximum) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.max(minimum, Math.min(maximum, Math.floor(number)));
  }

  function normalizeLimits(options = {}) {
    const limits = options?.limits && typeof options.limits === 'object'
      ? options.limits
      : options;
    return Object.freeze({
      maxArrayItems: finiteLimit(limits?.maxArrayItems, DEFAULT_LIMITS.maxArrayItems, 0, 5_000),
      maxObjectKeys: finiteLimit(limits?.maxObjectKeys, DEFAULT_LIMITS.maxObjectKeys, 0, 2_000),
      maxDepth: finiteLimit(limits?.maxDepth, DEFAULT_LIMITS.maxDepth, 0, 30),
      maxNodes: finiteLimit(limits?.maxNodes, DEFAULT_LIMITS.maxNodes, 1, 50_000),
      maxTotalNodes: finiteLimit(
        limits?.maxTotalNodes,
        DEFAULT_LIMITS.maxTotalNodes,
        1,
        500_000,
      ),
      maxTextLength: finiteLimit(limits?.maxTextLength, DEFAULT_LIMITS.maxTextLength, 32, 10_000),
      maxTruncationEntries: finiteLimit(
        limits?.maxTruncationEntries,
        DEFAULT_LIMITS.maxTruncationEntries,
        1,
        2_000,
      ),
    });
  }

  function count(value) {
    return Array.isArray(value) ? value.length : 0;
  }

  function summarize(raw = {}) {
    const source = raw && typeof raw === 'object' ? raw : {};
    return Object.freeze({
      fieldCount: count(source.fields),
      fileFieldCount: count(source.fileFields),
      embeddedSectionCount: count(source.embeddedSections),
      navigationItemCount: count(source.navigation?.items),
      groupCount: count(source.groups),
      buttonCount: count(source.buttons),
      saveCandidateCount: count(source.saveCandidates),
      warningCount: count(source.warnings),
    });
  }

  function safeCount(value) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : 0;
  }

  function formatSummary(summary = {}) {
    return `诊断完成：${safeCount(summary.fieldCount)} 个普通字段、`
      + `${safeCount(summary.fileFieldCount)} 个文件字段；识别 `
      + `${safeCount(summary.embeddedSectionCount)} 个页面内栏目；不含字段值。`;
  }

  function compactText(value) {
    return String(value ?? '')
      .replace(/[\u0000-\u001f\u007f]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  const FILE_EXTENSIONS = 'pdf|docx?|xlsx?|csv|pptx?|jpe?g|png|gif|bmp|webp|tiff?|zip|rar|7z|odt|ods';

  function sanitizeText(value, maxLength = DEFAULT_LIMITS.maxTextLength) {
    const limit = finiteLimit(maxLength, DEFAULT_LIMITS.maxTextLength, 0, 10_000);
    const source = compactText(value);
    const extensionListOnly = new RegExp(
      `^(?:\\s*(?:\\*?\\.)?(?:${FILE_EXTENSIONS})\\s*(?:[,;\\uff0c\\uff1b]\\s*)?)+$`,
      'i',
    ).test(source);

    // A path can contain a person's name. Redact the complete diagnostic string
    // so partial replacement can never leave a sensitive suffix behind.
    if (/(?:file:\/{2,3}|(?:^|[\s"'([{=:\uff1a])[A-Za-z]:[\\/]|\\\\|(?:^|[\s"'([{=:\uff1a])\/(?:[^/\s]+\/)+[^\s]*)/i.test(source)) {
      return '<redacted-path>'.slice(0, limit);
    }
    const filenamePattern = new RegExp(
      `(?:^|[\\s"'([{,:;\\uff1a\\uff1b\\uff0c])[^\\\\/\\r\\n<>|]{1,180}\\.(?:${FILE_EXTENSIONS})(?=$|[\\s"',.;:!?\\uff0c\\u3002\\uff01\\uff1f\\uff1a\\uff1b)\\]}])`,
      'i',
    );
    if (!extensionListOnly && filenamePattern.test(source)) {
      return '<redacted-filename>'.slice(0, limit);
    }

    return source
      .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, '<redacted-auth>')
      .replace(/\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9._-]{4,}\b/g, '<redacted-auth>')
      .replace(/\b(?:authorization|auth(?:orization)?header|access[_-]?token|refresh[_-]?token|api[_-]?key|secret)\s*[:=]\s*[^\s,;|]+/gi, '<redacted-auth>')
      .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '<redacted-email>')
      .replace(/(?<!\d)1[3-9](?:[\s.\u00b7-]*\d){9}(?!\d)/g, '<redacted-phone>')
      .replace(/(?<!\d)\d(?:[\s-]*\d){16}[\s-]*[\dXx](?![\dXx])/g, '<redacted-id>')
      .replace(/(?<!\d)\d(?:[\s-]*\d){14}(?!\d)/g, '<redacted-id>')
      .replace(/((?:\u672c\u4eba|\u5b66\u751f|\u7533\u8bf7\u4eba|\u8003\u751f|\u8054\u7cfb\u4eba)?(?:\u59d3\u540d|\u540d\u5b57))(?!\u62fc\u97f3|\u5b57\u6bb5|\u82f1\u6587|\u4e2d\u6587|\u5168\u62fc|\u6807\u7b7e|\u7c7b\u578b)[\uff1a:\s=]*[^\s,\uff0c;\uff1b|\uff5c]{2,30}/g, '$1\uff1a<redacted-name>')
      .replace(/((?:\u5bb6\u5ead\u4f4f\u5740|\u8054\u7cfb\u5730\u5740|\u901a\u8baf\u5730\u5740|\u901a\u4fe1\u5730\u5740|\u73b0\u4f4f\u5740|\u73b0\u5c45\u4f4f\u5730\u5740|\u6237\u53e3\u6240\u5728\u5730(?:\u8be6\u7ec6)?\u5730\u5740|\u6237\u7c4d\u6240\u5728\u5730(?:\u8be6\u7ec6)?\u5730\u5740|\u6863\u6848\u6240\u5728\u5355\u4f4d\u5730\u5740|\u6863\u6848\u6240\u5728\u5730\u5730\u5740|\u6863\u6848\u5730\u5740))[\uff1a:\s=]+[^|\uff5c;\uff1b\n]{2,160}/g, '$1\uff1a<redacted-address>')
      .replace(/(?<!\d)\d{7,}(?!\d)/g, '<redacted-number>')
      .slice(0, limit);
  }

  function sanitizePageTitle(value, maxLength = DEFAULT_LIMITS.maxTextLength) {
    const source = compactText(value);
    return source ? '<redacted-title>'.slice(0, finiteLimit(maxLength, DEFAULT_LIMITS.maxTextLength, 0, 10_000)) : '';
  }

  function isBlockedKey(key) {
    const rawKey = String(key ?? '');
    if (rawKey === '__proto__' || rawKey === 'prototype' || rawKey === 'constructor') return true;
    const normalized = rawKey.normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, '').toLowerCase();
    if (sanitizeText(rawKey, 256).includes('<redacted-')) return true;
    return BLOCKED_KEYS.has(normalized)
      || /(?:password|passcode|credential|token|cookie|session|authorization|authheader|bearer|jwt|base64|filecontent|resumedata|resumeview|privatekey|secretkey|accesskey|clientsecret)/i.test(normalized)
      || /^(?:applicant|candidate|student|contact|real|full)(?:name|phone|address)$/i.test(normalized)
      || /^(?:mobilephone|phonenumber|telephone|contactphone|idcardno|identitynumber|idnumber|citizenid)$/i.test(normalized)
      || /^(?:household|archiveunit|archiveorganization|communication|mailing|residential|home)(?:detailed)?(?:address|organization)$/i.test(normalized)
      || /(?:\u59d3\u540d|\u624b\u673a|\u7535\u8bdd|\u8eab\u4efd\u8bc1|\u6237\u53e3.*\u5730\u5740|\u6863\u6848.*\u5730\u5740|\u901a\u8baf\u5730\u5740|\u901a\u4fe1\u5730\u5740)/.test(rawKey);
  }

  function pathFor(parent, key, index = false) {
    if (index) return `${parent}[${key}]`;
    const safeKey = /^[A-Za-z_$][\w$-]*$/.test(String(key)) ? String(key) : '<key>';
    return `${parent}.${safeKey}`;
  }

  function truncation(meta, limits, detail) {
    meta.truncated = true;
    if (meta.truncations.length < limits.maxTruncationEntries) {
      meta.truncations.push(Object.freeze({ ...detail }));
    } else {
      meta.truncationRecordsOmitted += 1;
    }
  }

  function isDomLike(value) {
    if (!value || typeof value !== 'object') return false;
    try {
      if (typeof root?.Node === 'function' && value instanceof root.Node) return true;
    } catch (_) { /* cross-realm Node */ }
    return Number.isInteger(value.nodeType)
      && Boolean(value.tagName || value.nodeName || value.ownerDocument);
  }

  function isPlainRecord(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || isDomLike(value)) return false;
    try {
      const prototype = Object.getPrototypeOf(value);
      return prototype === Object.prototype || prototype === null;
    } catch (_) {
      return false;
    }
  }

  function emptyFor(value) {
    return Array.isArray(value) ? [] : {};
  }

  function sanitizeValue(value, path, limits, meta, depth, state, ancestors, globalState) {
    if (value === undefined) return undefined;

    globalState.nodes += 1;
    if (globalState.nodes > limits.maxTotalNodes) {
      if (!globalState.exhausted) {
        truncation(meta, limits, {
          path,
          kind: 'global-budget',
          reason: 'global-emergency-node-budget',
          keptCount: limits.maxTotalNodes,
          omittedCount: 1,
        });
        globalState.exhausted = true;
      }
      if (value !== null && typeof value === 'object') return emptyFor(value);
      return undefined;
    }

    if (value === null) return null;

    const type = typeof value;
    if (type === 'string') {
      const source = compactText(value);
      if (source.length > limits.maxTextLength) {
        truncation(meta, limits, {
          path,
          kind: 'string',
          reason: 'max-text-length',
          originalCount: source.length,
          keptCount: limits.maxTextLength,
          omittedCount: Math.max(0, source.length - limits.maxTextLength),
        });
      }
      return sanitizeText(source, limits.maxTextLength);
    }
    if (type === 'boolean') return value;
    if (type === 'number') return Number.isFinite(value) ? value : null;
    if (type === 'function' || type === 'symbol' || type === 'bigint') {
      truncation(meta, limits, { path, kind: type, reason: 'unsupported-type' });
      return undefined;
    }
    if (type !== 'object') return undefined;

    if (isDomLike(value)) {
      truncation(meta, limits, { path, kind: 'object', reason: 'dom-node' });
      return undefined;
    }
    if (ancestors.has(value)) {
      const kind = Array.isArray(value) ? 'array' : 'object';
      truncation(meta, limits, { path, kind, reason: 'circular-reference' });
      return emptyFor(value);
    }
    if (depth > limits.maxDepth) {
      const kind = Array.isArray(value) ? 'array' : 'object';
      truncation(meta, limits, { path, kind, reason: 'max-depth' });
      return emptyFor(value);
    }
    state.nodes += 1;
    if (state.nodes > limits.maxNodes) {
      const kind = Array.isArray(value) ? 'array' : 'object';
      truncation(meta, limits, { path, kind, reason: 'branch-node-budget' });
      return emptyFor(value);
    }

    if (value instanceof Date) {
      return Number.isFinite(value.getTime()) ? value.toISOString() : null;
    }

    const nextAncestors = new Set(ancestors);
    nextAncestors.add(value);

    if (Array.isArray(value)) {
      const keptCount = Math.min(value.length, limits.maxArrayItems);
      if (keptCount < value.length) {
        truncation(meta, limits, {
          path,
          kind: 'array',
          reason: 'max-array-items',
          originalCount: value.length,
          keptCount,
          omittedCount: value.length - keptCount,
        });
      }
      const result = [];
      for (let index = 0; index < keptCount; index += 1) {
        if (globalState.exhausted) break;
        // 数组条目（尤其 fields）各自拥有节点预算，前一条永远不能挤掉后一条或其他顶层结构。
        const child = sanitizeValue(
          value[index],
          pathFor(path, index, true),
          limits,
          meta,
          depth + 1,
          { nodes: 0 },
          nextAncestors,
          globalState,
        );
        if (child !== undefined) result.push(child);
      }
      return result;
    }

    let keys = [];
    try { keys = Object.keys(value).filter(key => !isBlockedKey(key)); }
    catch (_) {
      truncation(meta, limits, { path, kind: 'object', reason: 'unreadable-object' });
      return {};
    }
    const keptKeys = keys.slice(0, limits.maxObjectKeys);
    if (keptKeys.length < keys.length) {
      truncation(meta, limits, {
        path,
        kind: 'object',
        reason: 'max-object-keys',
        originalCount: keys.length,
        keptCount: keptKeys.length,
        omittedCount: keys.length - keptKeys.length,
      });
    }

    const result = {};
    for (const key of keptKeys) {
      if (globalState.exhausted) break;
      let childValue;
      try { childValue = value[key]; }
      catch (_) {
        truncation(meta, limits, { path: pathFor(path, key), kind: 'property', reason: 'unreadable-property' });
        continue;
      }
      const child = sanitizeValue(
        childValue,
        pathFor(path, key),
        limits,
        meta,
        depth + 1,
        state,
        nextAncestors,
        globalState,
      );
      if (child !== undefined) result[key] = child;
    }
    return result;
  }

  function safeOrigin(value) {
    const source = compactText(value);
    if (!source) return '';
    try {
      const parsed = new URL(source);
      return /^https?:$/.test(parsed.protocol) ? parsed.origin.slice(0, 200) : '';
    } catch (_) {
      return '';
    }
  }

  function sanitizePage(rawPage, optionPage, limits, meta, rootAncestors, globalState) {
    const source = isPlainRecord(optionPage)
      ? optionPage
      : isPlainRecord(rawPage)
        ? rawPage
        : {};
    return {
      origin: safeOrigin(source.origin),
      title: sanitizePageTitle(source.title || '', limits.maxTextLength),
    };
  }

  function sanitizePrivacy(rawPrivacy, limits, meta, rootAncestors, globalState) {
    const rawExcluded = Array.isArray(rawPrivacy?.excluded)
      ? rawPrivacy.excluded.filter(item => typeof item === 'string')
      : [];
    const safeExcluded = sanitizeValue(
      [...new Set([...rawExcluded, ...PRIVACY_EXCLUDED])],
      '$.privacy.excluded',
      limits,
      meta,
      0,
      { nodes: 0 },
      rootAncestors,
      globalState,
    );
    return {
      mode: 'metadata-only',
      excluded: Array.isArray(safeExcluded) && safeExcluded.length
        ? safeExcluded
        : [...PRIVACY_EXCLUDED],
    };
  }

  function sanitize(rawDiagnosis, options = {}) {
    const raw = rawDiagnosis && typeof rawDiagnosis === 'object' && !Array.isArray(rawDiagnosis)
      ? rawDiagnosis
      : {};
    const limits = normalizeLimits(options);
    const summary = summarize(raw);
    const diagnosticMeta = {
      truncated: false,
      truncations: [],
      truncationRecordsOmitted: 0,
      limits: { ...limits },
    };
    const diagnosis = {};
    const handled = new Set(['summary', 'diagnosticMeta']);
    const rootAncestors = new Set([raw]);
    const globalState = { nodes: 0, exhausted: false };

    for (const key of TOP_LEVEL_PRIORITY) {
      handled.add(key);
      if (key === 'page') {
        diagnosis.page = sanitizePage(raw.page, options.page, limits, diagnosticMeta, rootAncestors, globalState);
        continue;
      }
      if (key === 'privacy') {
        diagnosis.privacy = sanitizePrivacy(raw.privacy, limits, diagnosticMeta, rootAncestors, globalState);
        continue;
      }
      if (CORE_ARRAY_KEYS.includes(key)) {
        diagnosis[key] = sanitizeValue(
          Array.isArray(raw[key]) ? raw[key] : [],
          `$.${key}`,
          limits,
          diagnosticMeta,
          0,
          { nodes: 0 },
          rootAncestors,
          globalState,
        );
        continue;
      }
      if (CORE_OBJECT_KEYS.includes(key)) {
        const safeObject = sanitizeValue(
          isPlainRecord(raw[key]) ? raw[key] : {},
          `$.${key}`,
          limits,
          diagnosticMeta,
          0,
          { nodes: 0 },
          rootAncestors,
          globalState,
        );
        diagnosis[key] = isPlainRecord(safeObject) ? safeObject : {};
        continue;
      }

      const fallback = key === 'schemaVersion'
        ? 2
        : key === 'generatedAt'
          ? (options.generatedAt || new Date().toISOString())
          : '';
      const value = Object.hasOwn(raw, key) ? raw[key] : fallback;
      const safe = sanitizeValue(
        value,
        `$.${key}`,
        limits,
        diagnosticMeta,
        0,
        { nodes: 0 },
        rootAncestors,
        globalState,
      );
      diagnosis[key] = safe === undefined ? fallback : safe;
    }

    // 未知但安全的未来 schema 字段按各自独立预算保留，确保向前兼容。
    let topLevelKeys = [];
    try { topLevelKeys = Object.keys(raw); } catch (_) { topLevelKeys = []; }
    const futureKeys = topLevelKeys.filter(key => !handled.has(key) && !isBlockedKey(key));
    const keptFutureKeys = futureKeys.slice(0, limits.maxObjectKeys);
    if (keptFutureKeys.length < futureKeys.length) {
      truncation(diagnosticMeta, limits, {
        path: '$',
        kind: 'object',
        reason: 'max-object-keys',
        originalCount: futureKeys.length,
        keptCount: keptFutureKeys.length,
        omittedCount: futureKeys.length - keptFutureKeys.length,
      });
    }
    for (const key of keptFutureKeys) {
      if (globalState.exhausted) break;
      const safe = sanitizeValue(
        raw[key],
        pathFor('$', key),
        limits,
        diagnosticMeta,
        0,
        { nodes: 0 },
        rootAncestors,
        globalState,
      );
      if (safe !== undefined) diagnosis[key] = safe;
    }

    diagnosis.summary = { ...summary };
    diagnosis.diagnosticMeta = diagnosticMeta;
    return Object.freeze({ diagnosis, summary, diagnosticMeta });
  }

  return Object.freeze({
    BLOCKED_KEYS,
    DEFAULT_LIMITS,
    formatSummary,
    isBlockedKey,
    sanitize,
    sanitizeText,
    summarize,
  });
});
