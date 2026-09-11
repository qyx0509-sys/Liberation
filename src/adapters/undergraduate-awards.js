/*
 * 解放（基于 JobFill）— 本科期间奖励页面适配器
 * Copyright (c) 2026 zlh and contributors
 * SPDX-License-Identifier: MIT
 */
(function initAwardsAdapter(root, factory) {
  let generic = root?.JFGeneric;
  let safety = root?.JFSafety;
  let arrays = root?.JFArrayHandler;
  if (!generic && typeof require === 'function') {
    try { generic = require('./generic.js'); } catch (_) { /* browser path */ }
  }
  if (!safety && typeof require === 'function') {
    try { safety = require('../core/safety.js'); } catch (_) { /* browser path */ }
  }
  if (!arrays && typeof require === 'function') {
    try { arrays = require('../core/array-handler.js'); } catch (_) { /* browser path */ }
  }
  const api = factory(generic, safety, arrays, root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.JFAwardsAdapter = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function awardsFactory(G, Safety, Arrays, runtimeRoot) {
  'use strict';

  if (!G) throw new Error('JFAwardsAdapter requires JFGeneric');

  const ADD_BUTTON_RE = /新增一行|添加一行|新增奖励|添加奖励|新增奖项|添加奖项|新增获奖|添加获奖|新增|添加|^\+$/;
  const DANGEROUS_BUTTON_RE = /删除|移除|上一步|下一步|保存|提交|确认|登录|上传/;
  const PAGE_KEYWORD_RE = /奖励|奖项|获奖|荣誉/;
  const URL_KEYWORD_RE = /award|reward|honou?r|prize|jiangli|huojiang/i;
  const FIELD_KEYS = Object.freeze(['time', 'location', 'content']);
  const FIELD_NAMES = Object.freeze({ time: '时间', location: '地点', content: '内容' });
  const STATUS = Object.freeze({
    PLANNED: 'planned',
    SUCCESS: 'success',
    SKIPPED_EMPTY: 'skipped_empty',
    SKIPPED_EXISTING: 'skipped_existing',
    CONFLICT: 'conflict',
    NOT_FOUND: 'not_found',
    MANUAL: 'manual_review',
    FAILED: 'failed',
  });

  function querySafe(rootNode, selector, all = false) {
    if (!rootNode || !selector || typeof selector !== 'string') return all ? [] : null;
    try {
      return all ? [...rootNode.querySelectorAll(selector)] : rootNode.querySelector(selector);
    } catch (_) {
      return all ? [] : null;
    }
  }

  function controlCandidates(container) {
    return querySafe(
      container,
      'input:not([type="hidden"]):not([type="password"]):not([type="file"]):not([type="submit"]):not([type="button"]),textarea,select,[contenteditable="true"]',
      true,
    ).filter(element => !G.isHidden(element));
  }

  function buttonText(element) {
    return G.safeString(element?.value || element?.getAttribute?.('aria-label') || element?.textContent);
  }

  function headerMapFromCells(cells) {
    const map = {};
    cells.forEach((cell, index) => {
      const inferred = G.inferField(cell.textContent);
      if (inferred.field && inferred.confidence >= 0.72 && map[inferred.field] === undefined) {
        map[inferred.field] = { index, confidence: inferred.confidence, text: G.safeString(cell.textContent) };
      }
    });
    return map;
  }

  function findHeaderDescriptor(table) {
    const rows = [...table.querySelectorAll('tr')].filter(row => row.closest('table') === table);
    let best = null;
    rows.slice(0, 6).forEach((row, rowIndex) => {
      const cells = [...row.children].filter(cell => cell.matches('th,td'));
      const map = headerMapFromCells(cells);
      const matched = FIELD_KEYS.filter(key => map[key] !== undefined);
      const score = matched.length + (map.time ? 0.5 : 0) + (map.content ? 0.5 : 0) + (row.querySelector('th') ? 0.3 : 0);
      if (matched.includes('time') && matched.includes('content') && (!best || score > best.score)) {
        best = { row, rowIndex, cells, map, score };
      }
    });
    return best;
  }

  function fieldDescriptor(element, confidence, source, headerText = '') {
    if (!element) return null;
    return { element, confidence, source, headerText };
  }

  function mapTableRows(table) {
    const header = findHeaderDescriptor(table);
    if (!header) return [];
    const rows = [...table.querySelectorAll('tr')].filter(row => row.closest('table') === table);
    return rows.slice(header.rowIndex + 1).map(row => {
      const cells = [...row.children].filter(cell => cell.matches('td,th'));
      const fields = {};
      FIELD_KEYS.forEach(key => {
        const column = header.map[key];
        if (!column || !cells[column.index]) return;
        const controls = controlCandidates(cells[column.index]);
        if (controls.length === 1) {
          fields[key] = fieldDescriptor(controls[0], Math.min(1, column.confidence + 0.02), 'table-header', column.text);
        } else if (controls.length > 1) {
          const byLabel = controls
            .map(element => ({ element, inferred: G.inferField(G.associatedLabel(element)) }))
            .sort((a, b) => b.inferred.confidence - a.inferred.confidence);
          const match = byLabel.find(item => item.inferred.field === key && item.inferred.confidence >= 0.72);
          if (match) fields[key] = fieldDescriptor(match.element, match.inferred.confidence, 'table-header+label', column.text);
        }
      });
      const mappedCount = FIELD_KEYS.filter(key => fields[key]).length;
      if (mappedCount < 2 || !fields.time || !fields.content) return null;
      return {
        container: row,
        fields,
        confidence: Math.min(...FIELD_KEYS.filter(key => fields[key]).map(key => fields[key].confidence)),
        source: 'table',
      };
    }).filter(Boolean);
  }

  function mapLabeledContainer(container) {
    const controls = controlCandidates(container);
    if (controls.length < 2 || controls.length > 12) return null;
    const fields = {};
    controls.forEach(element => {
      const label = [G.associatedLabel(element), G.tableHeaderFor(element)].filter(Boolean).join(' ');
      const inferred = G.inferField(label);
      if (!inferred.field || inferred.confidence < 0.72) return;
      if (!fields[inferred.field] || inferred.confidence > fields[inferred.field].confidence) {
        fields[inferred.field] = fieldDescriptor(element, inferred.confidence, 'row-label', G.tableHeaderFor(element));
      }
    });
    if (!fields.time || !fields.content) return null;
    return {
      container,
      fields,
      confidence: Math.min(...Object.values(fields).map(field => field.confidence)),
      source: 'labeled-container',
    };
  }

  function mapConfiguredRows(searchRoot, config) {
    const selectors = config?.selectors || {};
    const rowSelector = config?.groupSelector || selectors.row;
    if (!rowSelector) return [];
    return querySafe(searchRoot, rowSelector, true).map(container => {
      if (!selectors.fields || typeof selectors.fields !== 'object') {
        const mapped = mapLabeledContainer(container);
        if (mapped) {
          mapped.confidence = 1;
          mapped.source = 'configured-group-selector';
          return mapped;
        }
        // groupSelector 本身足以建立稳定的数组行身份；字段推断失败时仍保留行，
        // 后续字段计划会安全地标记为 not_found，而不会误算行数后重复新增。
        return { container, fields: {}, confidence: 0, source: 'configured-group-selector' };
      }
      const fields = {};
      FIELD_KEYS.forEach(key => {
        const element = querySafe(container, selectors.fields?.[key]);
        if (element) fields[key] = fieldDescriptor(element, 1, 'configured-selector', '');
      });
      return fields.time && fields.content
        ? { container, fields, confidence: 1, source: 'configured-selector' }
        : null;
    }).filter(Boolean);
  }

  function uniqueRows(rows) {
    const seen = new Set();
    return rows.filter(row => {
      const identity = row.container;
      if (!identity || seen.has(identity)) return false;
      seen.add(identity);
      return true;
    });
  }

  function lowestCommonAncestor(elements) {
    let ancestor = elements[0] || null;
    while (ancestor && !elements.every(element => ancestor.contains(element))) {
      ancestor = ancestor.parentElement;
    }
    return ancestor;
  }

  function mapGeometricRows(searchRoot) {
    const controls = controlCandidates(searchRoot).filter(element => !element.closest('#__jf_panel__,#__jf_modal__'));
    const clusters = [];
    controls.forEach(element => {
      const rect = element.getBoundingClientRect();
      if (!rect || (rect.width === 0 && rect.height === 0)) return;
      let cluster = clusters.find(item => Math.abs(item.top - rect.top) <= 12);
      if (!cluster) {
        cluster = { top: rect.top, controls: [] };
        clusters.push(cluster);
      }
      cluster.controls.push({ element, rect });
    });

    return clusters.map(cluster => {
      if (cluster.controls.length < 2 || cluster.controls.length > 6) return null;
      const commonParent = lowestCommonAncestor(cluster.controls.map(item => item.element));
      const mapped = mapLabeledContainer(commonParent);
      if (!mapped) return null;
      mapped.source = 'geometry+label';
      mapped.confidence = Math.min(mapped.confidence, 0.8);
      return mapped;
    }).filter(Boolean);
  }

  function redactText(value) {
    return G.safeString(value)
      .replace(/\b1\d{10}\b/g, '<redacted-phone>')
      .replace(/\b\d{17}[\dXx]\b/g, '<redacted-id>')
      .replace(/\b\d{15}\b/g, '<redacted-id>')
      .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '<redacted-email>')
      .replace(/(?:[A-Za-z]:\\|\\\\)[^\s"'<>]{1,260}/g, '<redacted-path>')
      .replace(/\/(?:Users|home|tmp|var|private|storage|sdcard)\/[^\s"'<>]{1,260}/gi, '<redacted-path>')
      .replace(/[^\s\\/<>":'：]{1,180}\.(?:pdf|docx?|jpe?g|png)(?=$|[\s,，。;；)）\]}])/gi, '<redacted-filename>')
      .replace(/\b\d{7,}\b/g, '<redacted-number>')
      .slice(0, 160);
  }

  function redactParent(parent) {
    if (!parent || typeof parent !== 'object') return null;
    return {
      tag: redactText(parent.tag),
      id: redactText(parent.id),
      classes: (parent.classes || []).map(redactText).slice(0, 5),
      role: redactText(parent.role),
      dataKeys: (parent.dataKeys || []).map(redactText).slice(0, 8),
    };
  }

  function redactUrl(rawUrl) {
    try {
      const parsed = new URL(rawUrl);
      const segments = parsed.pathname.split('/').map(segment => {
        let decoded = segment;
        try { decoded = decodeURIComponent(segment); } catch (_) { /* keep raw segment */ }
        if (decoded.length > 64
          || /^[a-f0-9]{16,}$/i.test(decoded)
          || /^[a-z0-9._~-]{24,}$/i.test(decoded) && /[a-z]/i.test(decoded) && /\d/.test(decoded)) {
          return '<redacted-segment>';
        }
        return redactText(decoded);
      });
      return `${parsed.origin}${segments.join('/')}`.slice(0, 500);
    } catch (_) {
      return redactText(String(rawUrl || '').split(/[?#]/)[0]);
    }
  }

  function createAdapter(document, config = {}, runtimeOptions = {}) {
    if (!document?.querySelectorAll) throw new Error('需要有效的 document');

    function isTrustedRoot(candidate) {
      if (!candidate || typeof candidate.querySelectorAll !== 'function') return false;
      if (candidate === document) return true;
      if (candidate.ownerDocument !== document) return false;
      return candidate.isConnected !== false;
    }

    function resolveScopeRoot() {
      if (runtimeOptions && Object.prototype.hasOwnProperty.call(runtimeOptions, 'root')) {
        return isTrustedRoot(runtimeOptions.root) ? runtimeOptions.root : null;
      }
      const selectors = config?.selectors || {};
      const rootSelector = config?.root || config?.region || selectors.region;
      if (!rootSelector) return document;
      if (typeof rootSelector !== 'string') return null;
      const matches = querySafe(document, rootSelector, true).filter(isTrustedRoot);
      return matches.length === 1 ? matches[0] : null;
    }

    const scopeRoot = resolveScopeRoot();

    function getTables() {
      return querySafe(scopeRoot, 'table', true)
        .map(table => ({ table, header: findHeaderDescriptor(table) }))
        .filter(item => item.header)
        .sort((a, b) => b.header.score - a.header.score);
    }

    function getRows() {
      if (!scopeRoot) return [];
      const configured = mapConfiguredRows(scopeRoot, config);
      if (configured.length) return uniqueRows(configured);

      const tableRows = getTables().flatMap(item => mapTableRows(item.table));
      if (tableRows.length) return uniqueRows(tableRows);

      const selectors = [
        '[role="row"]', '[role="group"]', 'fieldset', '.form-row', '.form-group',
        '[class*="award"][class*="row"]', '[class*="award"][class*="item"]',
        '[class*="reward"][class*="row"]', '[class*="honor"][class*="row"]',
        '[data-row]', '[data-index]',
      ].join(',');
      const labeled = querySafe(scopeRoot, selectors, true)
        .filter(container => !container.closest('#__jf_panel__,#__jf_modal__'))
        .map(mapLabeledContainer)
        .filter(Boolean);
      if (labeled.length) return uniqueRows(labeled).filter(row =>
        !labeled.some(other => other !== row && row.container.contains(other.container))
      );
      return uniqueRows(mapGeometricRows(scopeRoot));
    }

    function detectPage() {
      const title = G.safeString(document.title);
      const exactTitle = /奖励情况\s*[（(]?本科期间[）)]?/.test(title);
      const headingElements = querySafe(scopeRoot, 'h1,h2,h3,h4,h5,h6,legend,[role="heading"],nav,[aria-label*="面包屑"],.breadcrumb,[class*="breadcrumb"]', true)
        .filter(element => !G.isHidden(element))
        .slice(0, 80);
      const headingTexts = headingElements.map(element => G.safeString(element.textContent)).filter(Boolean);
      const exactHeading = headingTexts.some(text => /奖励情况\s*[（(]?本科期间[）)]?/.test(text));
      const keywordHeading = headingTexts.find(text => PAGE_KEYWORD_RE.test(text));
      const tables = getTables();
      const url = document.location?.href || '';

      let score = 0;
      const evidence = [];
      if (exactTitle) { score += 0.48; evidence.push('页面标题精确匹配'); }
      else if (PAGE_KEYWORD_RE.test(title)) { score += 0.22; evidence.push('页面标题包含奖励关键词'); }
      if (exactHeading) { score += 0.42; evidence.push('页面标题区域精确匹配'); }
      else if (keywordHeading) { score += 0.2; evidence.push(`附近标题包含“${redactText(keywordHeading)}”`); }
      if (tables.length) { score += 0.48; evidence.push('表头匹配“时间/内容”列'); }
      if (URL_KEYWORD_RE.test(url)) { score += 0.08; evidence.push('URL 包含奖励语义特征'); }
      score = Math.min(1, Number(score.toFixed(2)));

      return {
        matched: score >= 0.55 && Boolean(tables.length || exactTitle || exactHeading),
        adapter: 'undergraduate-awards',
        confidence: score,
        evidence,
        rowCount: getRows().length,
      };
    }

    function getRegion() {
      if (!scopeRoot) return null;
      const scopeTag = String(scopeRoot.tagName || '').toUpperCase();
      const scopeRole = String(scopeRoot.getAttribute?.('role') || '').toLowerCase();
      const broadScope = scopeRoot === document
        || scopeRoot === document.body
        || scopeRoot === document.documentElement
        || scopeTag === 'MAIN'
        || scopeTag === 'FORM'
        || scopeRole === 'main';
      if (!broadScope) return scopeRoot;

      const structuralRegion = element => {
        if (!element) return null;
        const region = element.closest?.(
          'section,fieldset,[role="region"],[class*="card"],[class*="panel"],[class*="section"]',
        ) || element.parentElement;
        const regionTag = String(region?.tagName || '').toUpperCase();
        const regionRole = String(region?.getAttribute?.('role') || '').toLowerCase();
        if (
          !region
          || region === document
          || region === document.body
          || region === document.documentElement
          || regionTag === 'MAIN'
          || regionTag === 'FORM'
          || regionRole === 'main'
        ) {
          return element?.matches?.('table,[role="table"]') ? element : null;
        }
        return region;
      };
      const table = getTables()[0]?.table;
      if (table) return structuralRegion(table);
      const firstRow = getRows()[0]?.container;
      if (firstRow) return structuralRegion(firstRow);

      const headingRegions = querySafe(
        scopeRoot,
        'h1,h2,h3,h4,h5,h6,legend,[role="heading"],.page-title,[class*="title"]',
        true,
      )
        .filter(element => !G.isHidden(element) && PAGE_KEYWORD_RE.test(G.safeString(element.textContent)))
        .map(structuralRegion)
        .filter(Boolean);
      return [...new Set(headingRegions)].length === 1 ? headingRegions[0] : null;
    }

    function sharedArrayHandler() {
      return runtimeOptions.arrayHandler || Arrays || runtimeRoot?.JFArrayHandler || null;
    }

    function actionBinding(options = {}) {
      const arrays = sharedArrayHandler();
      if (runtimeOptions.topologyReason) {
        return { arrays, groupRoot: null, addRoot: null, actionSearchBoundary: null };
      }
      const groupRoot = options.groupRoot || runtimeOptions.groupRoot || getRegion();
      const configuredAddRoot = options.addRoot || runtimeOptions.addRoot || scopeRoot;
      const addRoot = configuredAddRoot?.contains?.(groupRoot)
        || configuredAddRoot === groupRoot
        ? configuredAddRoot
        : groupRoot;
      const configuredBoundary = options.actionSearchBoundary
        || runtimeOptions.actionSearchBoundary
        || addRoot;
      const actionSearchBoundary = configuredBoundary?.contains?.(groupRoot)
        || configuredBoundary === groupRoot
        ? configuredBoundary
        : addRoot;
      return { arrays, groupRoot, addRoot, actionSearchBoundary };
    }

    function actionOptions(options = {}) {
      const configuredSelector = config?.addButtonSelector || config?.selectors?.addButton;
      return {
        ...config,
        ...options,
        section: 'awards',
        addPattern: ADD_BUTTON_RE,
        ...(configuredSelector ? { addButtonSelector: configuredSelector } : {}),
        embeddedRegions: options.embeddedRegions || runtimeOptions.embeddedRegions || [],
        getGroups: () => getRows().map(row => row.container).filter(Boolean),
      };
    }

    function findAddButton(options = {}) {
      const { arrays, groupRoot, addRoot, actionSearchBoundary } = actionBinding(options);
      if (!arrays?.findAddButton || !groupRoot || !addRoot) return null;
      return arrays.findAddButton(addRoot, 'awards', {
        ...actionOptions(options),
        groupRoot,
        actionSearchBoundary,
      });
    }

    async function ensureRows(rawTargetCount, options = {}) {
      const targetCount = Math.max(0, Math.min(100, Number(rawTargetCount) || 0));
      const initialCount = getRows().length;
      const { arrays, groupRoot, addRoot, actionSearchBoundary } = actionBinding(options);
      if (!arrays?.ensureGroupCount || !groupRoot || !addRoot) {
        const topologyReason = runtimeOptions.topologyReason || '';
        return {
          ok: false,
          code: topologyReason || 'ACTION_OWNERSHIP_RUNTIME_UNAVAILABLE',
          initialCount,
          rowCount: initialCount,
          count: initialCount,
          added: 0,
          clicks: 0,
          error: topologyReason
            ? '奖励区域拓扑不唯一，已安全停止'
            : '奖励行新增缺少共享 Action Ownership Runtime，已安全停止',
        };
      }

      const result = await arrays.ensureGroupCount(groupRoot, targetCount, {
        ...actionOptions(options),
        addRoot,
        actionSearchBoundary,
        timeoutMs: Math.max(100, Math.min(15_000, Number(options.timeoutMs) || 3_000)),
        maxAdds: Math.max(0, Math.min(50, Number(options.maxAdds) || Math.max(10, targetCount))),
      });
      return {
        ...result,
        code: result.ok ? 'ROWS_READY' : (result.code || 'ACTION_OWNERSHIP_REJECTED'),
        rowCount: Number.isInteger(result.count) ? result.count : getRows().length,
      };
    }

    function buildPlan(rawAwards, options = {}) {
      const awards = Array.isArray(rawAwards) ? rawAwards : [];
      const rows = getRows();
      const allowOverwrite = Boolean(options.allowOverwrite);
      const skipEmpty = options.skipEmpty !== false;
      const fields = [];

      awards.forEach((rawAward, awardIndex) => {
        const award = rawAward && typeof rawAward === 'object' ? rawAward : {};
        const row = rows[awardIndex];
        const awardContent = G.safeString(award.content);
        const duplicateRowIndex = awardContent
          ? rows.findIndex(existingRow => G.readValue(existingRow.fields?.content?.element) === awardContent)
          : -1;
        const duplicateElsewhere = duplicateRowIndex >= 0 && duplicateRowIndex !== awardIndex;
        FIELD_KEYS.forEach(field => {
          const plannedValue = G.safeString(award[field]);
          const descriptor = row?.fields?.[field];
          const element = descriptor?.element || null;
          const beforeValue = G.readValue(element);
          const record = {
            awardIndex,
            field,
            fieldName: FIELD_NAMES[field],
            plannedValue,
            beforeValue,
            afterValue: beforeValue,
            status: STATUS.PLANNED,
            reason: '',
            confidence: descriptor?.confidence || 0,
            source: descriptor?.source || '',
            element,
          };

          if (!plannedValue) {
            record.status = STATUS.SKIPPED_EMPTY;
            record.reason = skipEmpty ? '已按“跳过空值”设置跳过' : '奖励空值不会写入网页';
          } else if (duplicateElsewhere) {
            record.status = STATUS.SKIPPED_EXISTING;
            record.reason = `页面第 ${duplicateRowIndex + 1} 行已有相同奖励内容，为避免重复已跳过本条`;
          } else if (!row || !descriptor) {
            record.status = STATUS.NOT_FOUND;
            record.reason = !row ? '未找到对应的页面行' : `未找到本行的${FIELD_NAMES[field]}字段`;
          } else if (descriptor.confidence < 0.8) {
            record.status = STATUS.MANUAL;
            record.reason = `字段匹配置信度不足（${Math.round(descriptor.confidence * 100)}%）`;
          } else if (beforeValue === plannedValue) {
            record.status = STATUS.SKIPPED_EXISTING;
            record.reason = '页面已有相同内容，无需重复填写';
          } else if (beforeValue && !allowOverwrite) {
            record.status = STATUS.CONFLICT;
            record.reason = '页面已有不同内容，默认不覆盖';
          }
          fields.push(record);
        });
      });

      return { adapter: 'undergraduate-awards', awards, rows, options: { allowOverwrite, skipEmpty }, fields };
    }

    function summarize(fields) {
      const count = status => fields.filter(field => field.status === status).length;
      return {
        planned: fields.length,
        success: count(STATUS.SUCCESS),
        skippedEmpty: count(STATUS.SKIPPED_EMPTY),
        skippedExisting: count(STATUS.SKIPPED_EXISTING),
        conflicts: count(STATUS.CONFLICT),
        notFound: count(STATUS.NOT_FOUND),
        manualReview: count(STATUS.MANUAL),
        failed: count(STATUS.FAILED),
      };
    }

    async function executePlan(plan, options = {}) {
      const allowOverwrite = options.allowOverwrite ?? plan?.options?.allowOverwrite ?? false;
      const fields = [];
      for (const sourceRecord of plan?.fields || []) {
        const record = { ...sourceRecord };
        if (record.status !== STATUS.PLANNED) {
          fields.push(record);
          continue;
        }
        const currentValue = G.readValue(record.element);
        record.beforeValue = currentValue;
        if (currentValue === record.plannedValue) {
          record.status = STATUS.SKIPPED_EXISTING;
          record.afterValue = currentValue;
          record.reason = '执行前检查发现页面已有相同内容';
          fields.push(record);
          continue;
        }
        if (currentValue && !allowOverwrite) {
          record.status = STATUS.CONFLICT;
          record.afterValue = currentValue;
          record.reason = '执行前检查发现页面已有不同内容，未覆盖';
          fields.push(record);
          continue;
        }
        const result = await G.setNativeValue(record.element, record.plannedValue);
        record.afterValue = result.afterValue;
        record.status = result.ok ? STATUS.SUCCESS : STATUS.FAILED;
        record.reason = result.reason;
        if (result.ok) G.highlight(record.element, 'success');
        else G.highlight(record.element, 'failed');
        fields.push(record);
      }
      return { adapter: 'undergraduate-awards', fields, summary: summarize(fields) };
    }

    function diagnosePage() {
      const sensitiveMetadata = /密码|验证码|短信验证|人脸|cookie|session|token|secret|authorization|credential|password|captcha|otp/i;
      const allControls = querySafe(scopeRoot, 'input,textarea,select,[contenteditable="true"]', true)
        .filter(element => !element.closest('#__jf_panel__,#__jf_modal__'));
      const controls = allControls.filter(element => {
        if (element.matches?.('input[type="password"]')) return false;
        const metadata = [
          element.type, element.id, element.name, element.autocomplete,
          element.getAttribute?.('aria-label'), element.getAttribute?.('placeholder'),
        ].filter(Boolean).join(' ');
        return !sensitiveMetadata.test(metadata);
      });
      const fields = controls.map(element => {
        const labelText = redactText(G.associatedLabel(element));
        const headerText = redactText(G.tableHeaderFor(element));
        const recommendation = G.inferField(`${labelText} ${headerText} ${element.name || ''} ${element.id || ''}`);
        return {
          type: redactText(element.type || element.tagName?.toLowerCase()),
          id: redactText(element.id),
          name: redactText(element.name),
          placeholder: redactText(element.getAttribute?.('placeholder')),
          ariaLabel: redactText(element.getAttribute?.('aria-label')),
          labelText,
          headerText,
          parent: redactParent(G.describeParent(element)),
          readOnly: Boolean(element.readOnly),
          required: Boolean(element.required || element.getAttribute?.('aria-required') === 'true'),
          hidden: G.isHidden(element),
          recommendedField: recommendation.field,
          confidence: Number(recommendation.confidence.toFixed(2)),
        };
      });
      const addButtons = querySafe(scopeRoot, 'button,[role="button"],a,input[type="button"]', true)
        .map(buttonText)
        .filter(text => ADD_BUTTON_RE.test(text) && !DANGEROUS_BUTTON_RE.test(text))
        .map(redactText);
      const detected = detectPage();
      return {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        url: redactUrl(document.location?.href || ''),
        title: redactText(document.title),
        adapter: detected.adapter,
        pageMatched: detected.matched,
        pageConfidence: detected.confidence,
        evidence: detected.evidence.map(redactText),
        visibleFormFieldCount: fields.filter(field => !field.hidden).length,
        excludedSensitiveFieldCount: allControls.length - controls.length,
        fields,
        addButtonTexts: [...new Set(addButtons)],
        privacy: {
          mode: 'metadata-only',
          excludedData: ['field-values', 'browser-auth', 'page-html', 'passwords'],
        },
      };
    }

    function inspect() {
      const detected = detectPage();
      const rows = getRows();
      return {
        ...detected,
        rows: rows.map((row, index) => ({
          index,
          source: row.source,
          confidence: row.confidence,
          fields: Object.fromEntries(FIELD_KEYS.map(field => [field, Boolean(row.fields[field])])),
        })),
        hasAddButton: Boolean(findAddButton()),
      };
    }

    return {
      buildPlan,
      detectPage,
      diagnosePage,
      ensureRows,
      executePlan,
      findAddButton,
      getRegion,
      getRows,
      inspect,
    };
  }

  return {
    ADD_BUTTON_RE,
    FIELD_KEYS,
    FIELD_NAMES,
    STATUS,
    createAdapter,
  };
});
