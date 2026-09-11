/*
 * 解放：真实 DOM 字段检测器
 * Copyright (c) 2026 zlh and contributors
 * SPDX-License-Identifier: MIT
 */
(function initFieldDetector(root, factory) {
  let semantics = root?.JFFieldSemanticNormalizer;
  let structures = root?.JFSectionStructures;
  if (typeof module === 'object' && module.exports) {
    semantics = require('../semantics/field-semantic-normalizer.js');
    structures = require('../mappings/section-structures.js');
  }
  const api = factory(
    semantics,
    structures,
    () => root?.JFDateLikeAdapter || null,
    () => root?.JFCascaderAdapter || null,
  );
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.JFFieldDetector = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function fieldDetectorFactory(S, Structures, getDateLikeAdapter, getCascaderAdapter) {
  'use strict';

  const STANDARD_SELECTOR = [
    'input:not([type="hidden"])',
    'textarea',
    'select',
    '[contenteditable="true"]',
    '[role="textbox"]',
    '[role="combobox"]',
    '[role="radio"]',
    '[role="checkbox"]',
    '[role="spinbutton"]',
  ].join(',');
  const CUSTOM_SELECT_SELECTOR = [
    '[role="combobox"]',
    '.ant-select-selector',
    '.el-select',
    '.el-select__wrapper',
    '.vue-select',
    '.v-select',
    '[class*="react-select__control"]',
    '[data-select-root]',
  ].join(',');
  const CASCADER_SELECTOR = [
    '.ant-cascader-picker',
    '.ant-cascader',
    '.el-cascader',
    '[data-cascader-root]',
    '[data-hierarchical-picker]',
  ].join(',');
  const CASCADER_TRIGGER_SELECTOR = [
    'input:not([type="hidden"])',
    '[role="combobox"]',
    'button[type="button"]',
    '[role="button"]',
  ].join(',');
  const CASCADER_SEMANTIC_PATTERN = /(?:省\s*[\/／、-]?\s*市|市\s*[\/／、-]?\s*(?:区|县)|省市区|省市县|地区|区域|籍贯|出生地|户籍所在地|户口所在地|生源地|现居地|所在地)/i;
  const CUSTOM_UPLOAD_SELECTOR = [
    '.ant-upload',
    '.ant-upload-wrapper',
    '.el-upload',
    '.el-upload-dragger',
    '[class*="dropzone"]',
    '[data-upload-root]',
  ].join(',');
  const FORM_GROUP_SELECTOR = [
    'fieldset',
    '[role="group"]',
    '.ant-form-item',
    '.el-form-item',
    '.form-item',
    '.form-group',
    '[class*="form-item"]',
    '[class*="formItem"]',
    '[class*="field-item"]',
    '[class*="form__item"]',
    'tr',
  ].join(',');
  const LABEL_SELECTOR = [
    'label',
    'legend',
    '.ant-form-item-label',
    '.el-form-item__label',
    '[class*="form-item__label"]',
    '[class*="formItem__label"]',
    '[class*="field-label"]',
    '[class*="form__label"]',
  ].join(',');
  const LOCAL_FORM_ROW_SELECTOR = [
    '.ant-form-item', '.ant-row', '.el-form-item', '.form-item', '.form-row', '.form-group',
    '[class*="form-item"]', '[class*="formItem"]', '[class*="form-row"]', '[class*="formRow"]',
    '[class*="field-item"]', '[class*="field-row"]', '[role="group"]',
  ].join(',');
  const SIBLING_LABEL_SELECTOR = [
    'label', '.ant-form-item-label', '.el-form-item__label',
    '[class*="field-label"]', '[class*="fieldLabel"]', '[class*="label-column"]',
    '[class*="labelColumn"]', '[class*="caption"]', '[data-field-label]', '[data-caption]',
  ].join(',');
  const EXACT_FORM_ITEM_CLASSES = Object.freeze(new Set([
    'ant-form-item', 'el-form-item', 'form-item', 'form-group', 'field-item',
  ]));
  const SEMANTIC_ROW_CLASSES = Object.freeze(new Set([
    'ant-row', 'el-row', 'form-row', 'field-row', 'semantic-field-row',
  ]));
  const SEMANTIC_OWNER_MAX_DEPTH = 6;
  const METADATA_LABEL_ATTRIBUTES = Object.freeze([
    'data-caption', 'data-label', 'data-field-label', 'data-title',
  ]);
  const DATE_SEMANTIC_PATTERN = /(?:出生(?:日期|年月|时间)|入学(?:日期|年月|时间)|毕业(?:日期|年月|时间)|预计毕业|起始年月|结束年月|开始时间|结束时间|日期|年月)/i;
  const DATE_TRIGGER_SELECTOR = 'button,[role="button"],[aria-haspopup],[aria-controls],input[type="date"],input[type="month"],[class*="calendar"],[class*="date-picker"],[class*="datepicker"],[class*="month-picker"],[class*="monthpicker"],[class*="ant-picker"],[class*="arco-picker"],[class*="el-date"]';
  const DATE_TRIGGER_HINT = /(?:^|[^a-z])(?:date(?:picker)?|calendar|month(?:picker)?|year(?:picker)?)(?:$|[^a-z])|(?:ant|arco)-picker|ivu-date-picker|el-date-editor|日期|日历|年月|月份|年份/i;
  const COMPOUND_PICKER_TRIGGER_PATTERN = /^(?:请选择|选择|选取|点击选择)(?:学校|院校|学院|院系|专业|单位|机构|地区|地址|地点)?$/;

  function safeString(value) {
    return value === null || value === undefined ? '' : String(value).trim();
  }

  function queryAll(rootNode, selector) {
    if (!rootNode?.querySelectorAll) return [];
    try { return [...rootNode.querySelectorAll(selector)]; }
    catch (_) { return []; }
  }

  function queryOne(rootNode, selector) {
    if (!rootNode?.querySelector) return null;
    try { return rootNode.querySelector(selector); }
    catch (_) { return null; }
  }

  function matches(element, selector) {
    try { return Boolean(element?.matches?.(selector)); }
    catch (_) { return false; }
  }

  function closest(element, selector) {
    try { return element?.closest?.(selector) || null; }
    catch (_) { return null; }
  }

  function cssEscape(value, document) {
    const viewCss = document?.defaultView?.CSS || globalThis.CSS;
    if (viewCss?.escape) return viewCss.escape(String(value));
    return String(value).replace(/["\\]/g, '\\$&');
  }

  function uniqueElements(elements) {
    const seen = new Set();
    return elements.filter(element => {
      if (!element || seen.has(element)) return false;
      seen.add(element);
      return true;
    });
  }

  function isHidden(element) {
    if (!element) return true;
    if (element.hidden || element.getAttribute?.('aria-hidden') === 'true') return true;
    if (matches(element, 'input[type="hidden"]')) return true;
    const view = element.ownerDocument?.defaultView || globalThis;
    let style = null;
    try { style = view.getComputedStyle?.(element) || null; } catch (_) { /* ignored */ }
    if (style && (style.display === 'none' || style.visibility === 'hidden')) return true;
    const rect = element.getBoundingClientRect?.();
    if (rect && rect.width === 0 && rect.height === 0 && style?.position !== 'fixed') return true;
    return false;
  }

  function cleanStaticText(value, maxLength = 180) {
    return safeString(value).replace(/\s+/g, ' ').slice(0, maxLength);
  }

  function textWithoutControls(element, maxLength = 180) {
    if (!element) return '';
    try {
      const clone = element.cloneNode(true);
      queryAll(clone, [
        'input', 'textarea', 'select', 'option', 'button', '[contenteditable="true"]',
        '[class*="selection-item"]', '[class*="selected-value"]', '[data-value]',
      ].join(',')).forEach(node => node.remove?.());
      return cleanStaticText(clone.textContent, maxLength);
    } catch (_) {
      return cleanStaticText(element.textContent, maxLength);
    }
  }

  function isInternalSelectedValueReference(reference, semanticRoot) {
    if (!reference) return false;
    for (
      let current = reference, depth = 0;
      current && depth < SEMANTIC_OWNER_MAX_DEPTH;
      current = current.parentElement, depth += 1
    ) {
      const classes = safeString(typeof current.className === 'string' ? current.className : current.className?.baseVal);
      if (
        /(?:^|\s|[-_])(?:selection-item|selected-value|cascader-picker-label|cascader__label|cascader__tags-text|option-selected|option-active|menu-item-selected|menu-item-active|selected-option|current-option|is-selected|is-current|selected|current)(?:$|\s|[-_])/i.test(classes)
        || safeString(current.getAttribute?.('role')).toLowerCase() === 'option'
        || current.getAttribute?.('aria-selected') === 'true'
        || !['', 'false'].includes(safeString(current.getAttribute?.('aria-current')).toLowerCase())
        || current.getAttribute?.('data-cascader-selected-item') !== null
        || current.getAttribute?.('data-cascader-value') !== null
        || current.getAttribute?.('data-selected') !== null
        || current.getAttribute?.('data-current') !== null
      ) {
        return true;
      }
      if (safeString(current.tagName).toLowerCase() === 'label') break;
      if (current === semanticRoot) break;
    }
    return false;
  }

  function ariaLabelledText(element, semanticRoot = null) {
    const document = element?.ownerDocument;
    const ids = safeString(element?.getAttribute?.('aria-labelledby')).split(/\s+/).filter(Boolean);
    return cleanStaticText(ids
      .map(id => document?.getElementById?.(id) || null)
      .filter(reference => reference && !isInternalSelectedValueReference(reference, semanticRoot))
      .map(reference => reference.textContent || '')
      .filter(Boolean)
      .join(' '));
  }

  function plainSemanticText(value, maxLength = 160) {
    const output = cleanStaticText(value, maxLength);
    if (!output || output.length > maxLength || /[<>\r\n{}]/.test(output)) return '';
    return output;
  }

  function semanticPlaceholderFor(element) {
    const placeholder = safeString(element?.placeholder || element?.getAttribute?.('placeholder'));
    return plainSemanticText(S?.stripPromptPrefix?.(placeholder) || '', 120);
  }

  function localFormRoots(element) {
    const roots = [];
    let current = element?.parentElement || null;
    for (let depth = 0; current && depth < 4; depth += 1, current = current.parentElement) {
      if (matches(current, LOCAL_FORM_ROW_SELECTOR) || matches(current, FORM_GROUP_SELECTOR)) roots.push(current);
    }
    const nearest = closest(element, LOCAL_FORM_ROW_SELECTOR) || closest(element, FORM_GROUP_SELECTOR);
    if (nearest) roots.unshift(nearest);
    return uniqueElements(roots);
  }

  function actionableControls(rootNode) {
    return uniqueElements(queryAll(rootNode, STANDARD_SELECTOR))
      .filter(control => !matches(control, 'input[type="hidden"]'));
  }

  function containsElement(rootNode, element) {
    try { return Boolean(rootNode?.contains?.(element)); }
    catch (_) { return false; }
  }

  function outermostCascaderRoot(element) {
    let canonical = matches(element, CASCADER_SELECTOR)
      ? element
      : closest(element, CASCADER_SELECTOR);
    if (!canonical) return null;
    let ancestor = closest(canonical.parentElement, CASCADER_SELECTOR);
    while (ancestor) {
      canonical = ancestor;
      ancestor = closest(canonical.parentElement, CASCADER_SELECTOR);
    }
    return canonical;
  }

  function cascaderTriggerFor(rootNode) {
    if (!rootNode) return null;
    const candidates = uniqueElements([
      ...(matches(rootNode, CASCADER_TRIGGER_SELECTOR) ? [rootNode] : []),
      ...queryAll(rootNode, CASCADER_TRIGGER_SELECTOR),
    ]).filter(candidate => {
      const type = safeString(candidate.type || candidate.getAttribute?.('type')).toLowerCase();
      return !['date', 'month', 'file', 'password', 'submit', 'reset', 'image', 'hidden'].includes(type)
        && !candidate.disabled
        && candidate.getAttribute?.('aria-disabled') !== 'true';
    });
    if (candidates.length === 1) return candidates[0];
    const primaryInputs = candidates.filter(candidate => {
      const tag = safeString(candidate.tagName).toLowerCase();
      if (tag !== 'input' || candidate.getAttribute?.('aria-hidden') === 'true') return false;
      const metadata = cleanStaticText([
        candidate.className,
        candidate.getAttribute?.('role'),
        candidate.getAttribute?.('aria-haspopup'),
      ].filter(Boolean).join(' '), 160);
      return /cascader/i.test(metadata)
        || safeString(candidate.getAttribute?.('role')).toLowerCase() === 'combobox';
    });
    return primaryInputs.length === 1 ? primaryInputs[0] : null;
  }

  function cascaderDetailsFor(element) {
    const rootNode = outermostCascaderRoot(element);
    const trigger = cascaderTriggerFor(rootNode);
    if (!rootNode || !trigger) return null;
    const label = resolveSemanticLabel(rootNode);
    const semantics = cleanStaticText([
      label.text,
      label.semanticPlaceholder,
      semanticPlaceholderFor(trigger),
      trigger.placeholder,
      trigger.getAttribute?.('aria-label'),
      trigger.getAttribute?.('title'),
      rootNode.getAttribute?.('aria-label'),
      rootNode.getAttribute?.('title'),
    ].filter(Boolean).join(' '), 280);
    if (!CASCADER_SEMANTIC_PATTERN.test(semantics)) return null;
    return { root: rootNode, trigger, semantics };
  }

  function outermostCustomSelectRoot(element) {
    let canonical = matches(element, CUSTOM_SELECT_SELECTOR)
      ? element
      : closest(element, CUSTOM_SELECT_SELECTOR);
    if (!canonical) return null;
    let ancestor = closest(canonical.parentElement, CUSTOM_SELECT_SELECTOR);
    while (ancestor) {
      canonical = ancestor;
      ancestor = closest(canonical.parentElement, CUSTOM_SELECT_SELECTOR);
    }
    return canonical;
  }

  function logicalFieldRoot(element) {
    return outermostCascaderRoot(element) || outermostCustomSelectRoot(element) || element || null;
  }

  function logicalFieldRoots(rootNode) {
    const candidates = uniqueElements([
      ...(matches(rootNode, CUSTOM_SELECT_SELECTOR) ? [rootNode] : []),
      ...(matches(rootNode, CASCADER_SELECTOR) ? [rootNode] : []),
      ...queryAll(rootNode, CASCADER_SELECTOR),
      ...queryAll(rootNode, CUSTOM_SELECT_SELECTOR),
      ...actionableControls(rootNode),
    ]);
    return uniqueElements(candidates.map(logicalFieldRoot).filter(Boolean));
  }

  function uniqueOwnedControl(element) {
    const controls = actionableControls(element);
    const owner = logicalFieldRoot(element);
    const owned = controls.filter(control => logicalFieldRoot(control) === owner);
    if (owned.length === 1) return containsElement(element, owned[0]) ? owned[0] : null;
    const primary = owned.filter(control =>
      safeString(control.getAttribute?.('role')).toLowerCase() === 'combobox'
      && control.getAttribute?.('aria-hidden') !== 'true'
    );
    return primary.length === 1 && containsElement(element, primary[0]) ? primary[0] : null;
  }

  function rootOwnsSingleField(rootNode, element) {
    const logicalRoots = logicalFieldRoots(rootNode);
    const elementRoot = logicalFieldRoot(element);
    if (logicalRoots.length <= 1) {
      return logicalRoots.length === 0
        || logicalRoots[0] === elementRoot
        || containsElement(elementRoot, logicalRoots[0])
        || containsElement(logicalRoots[0], elementRoot);
    }
    const controls = actionableControls(rootNode);
    const type = safeString(element?.type || element?.getAttribute?.('type')).toLowerCase();
    const name = safeString(element?.name || element?.getAttribute?.('name'));
    return ['radio', 'checkbox'].includes(type)
      && Boolean(name)
      && controls.every(control => safeString(control?.name || control?.getAttribute?.('name')) === name);
  }

  function classTokens(element) {
    return safeString(typeof element?.className === 'string' ? element.className : element?.className?.baseVal)
      .split(/\s+/)
      .filter(Boolean);
  }

  function isExactFormItem(element) {
    const tokens = classTokens(element);
    return tokens.some(token => EXACT_FORM_ITEM_CLASSES.has(token))
      || safeString(element?.getAttribute?.('role')).toLowerCase() === 'group'
      || element?.getAttribute?.('data-form-item') !== null;
  }

  function isSemanticRow(element) {
    const tokens = classTokens(element);
    return tokens.some(token => SEMANTIC_ROW_CLASSES.has(token)
      || /^(?:formRow|fieldRow)(?:[-_]|$)/.test(token))
      || safeString(element?.getAttribute?.('role')).toLowerCase() === 'row'
      || element?.getAttribute?.('data-field-row') !== null;
  }

  function semanticOwnerAncestors(element) {
    const semanticRoot = logicalFieldRoot(element) || element;
    const ancestors = [];
    let tableBoundary = false;
    let current = semanticRoot?.parentElement || null;
    for (let depth = 1; current && depth <= SEMANTIC_OWNER_MAX_DEPTH; depth += 1, current = current.parentElement) {
      const tag = safeString(current.tagName).toLowerCase();
      if (['td', 'th', 'table'].includes(tag)) {
        tableBoundary = true;
        break;
      }
      if (['body', 'form', 'fieldset', 'section'].includes(tag)) break;
      ancestors.push(current);
    }
    return { semanticRoot, ancestors, tableBoundary };
  }

  function canonicalLabelCandidates(scope, element, semanticRoot, selector) {
    const records = uniqueElements(queryAll(scope, selector))
      .filter(candidate => candidate && !candidate.contains?.(element) && !containsElement(semanticRoot, candidate))
      .filter(candidate => !isHidden(candidate))
      .filter(candidate => !queryOne(candidate, 'input,textarea,select,button,[contenteditable="true"],[role="combobox"]'))
      .filter(candidate => !isInternalSelectedValueReference(candidate, semanticRoot))
      .map(candidate => ({
        element: candidate,
        text: plainSemanticText(textWithoutControls(candidate, 160), 160),
      }))
      .filter(record => Boolean(record.text));

    const canonical = [];
    for (const record of records) {
      const nestedIndex = canonical.findIndex(existing =>
        existing.text === record.text
        && (containsElement(existing.element, record.element) || containsElement(record.element, existing.element))
      );
      if (nestedIndex < 0) {
        canonical.push(record);
        continue;
      }
      const existing = canonical[nestedIndex];
      const recordIsLabel = safeString(record.element?.tagName).toLowerCase() === 'label';
      const existingIsLabel = safeString(existing.element?.tagName).toLowerCase() === 'label';
      if (recordIsLabel && !existingIsLabel) canonical[nestedIndex] = record;
      else if (recordIsLabel === existingIsLabel && containsElement(existing.element, record.element)) {
        canonical[nestedIndex] = record;
      }
    }
    return canonical;
  }

  function logicalRootOwnedBy(scope, semanticRoot) {
    const roots = logicalFieldRoots(scope);
    if (roots.length !== 1) return { owned: false, count: roots.length };
    const candidate = roots[0];
    const owned = candidate === semanticRoot
      || containsElement(candidate, semanticRoot)
      || containsElement(semanticRoot, candidate);
    return { owned, count: roots.length };
  }

  function resolveInteractiveControlSemanticOwner(element) {
    const { semanticRoot, ancestors, tableBoundary } = semanticOwnerAncestors(element);
    const debug = {
      logicalControlCount: 0,
      formItemFound: false,
      formItemLabelFound: false,
      ownershipReason: 'form-item-not-found',
    };

    for (const ancestor of ancestors) {
      if (isExactFormItem(ancestor)) {
        debug.formItemFound = true;
        debug.ownershipReason = 'form-item-label-missing';
        const formOwnership = logicalRootOwnedBy(ancestor, semanticRoot);
        const formLabels = canonicalLabelCandidates(ancestor, element, semanticRoot, LABEL_SELECTOR);
        debug.logicalControlCount = formOwnership.count;
        debug.formItemLabelFound = debug.formItemLabelFound || formLabels.length > 0;
        if (formOwnership.count > 1) {
          return {
            text: '', source: '', semanticRoot,
            debug: Object.freeze({ ...debug, ownershipReason: 'multiple-logical-fields' }),
          };
        }
        if (formLabels.length > 1) {
          return {
            text: '', source: '', semanticRoot,
            debug: Object.freeze({ ...debug, ownershipReason: 'multiple-local-labels' }),
          };
        }
        if (formOwnership.owned && formLabels.length === 1) {
          return {
            text: formLabels[0].text,
            source: 'form-item-label',
            semanticRoot,
            debug: Object.freeze({
              ...debug,
              formItemLabelFound: true,
              ownershipReason: 'single-logical-field',
            }),
          };
        }
      }

      if (!tableBoundary && isSemanticRow(ancestor)) {
        const rowOwnership = logicalRootOwnedBy(ancestor, semanticRoot);
        const rowLabels = canonicalLabelCandidates(ancestor, element, semanticRoot, SIBLING_LABEL_SELECTOR);
        debug.logicalControlCount = rowOwnership.count;
        debug.formItemLabelFound = debug.formItemLabelFound || rowLabels.length > 0;
        if (rowOwnership.count > 1) {
          return {
            text: '', source: '', semanticRoot,
            debug: Object.freeze({ ...debug, ownershipReason: 'multiple-logical-fields' }),
          };
        }
        if (rowLabels.length > 1) {
          return {
            text: '', source: '', semanticRoot,
            debug: Object.freeze({ ...debug, ownershipReason: 'multiple-local-labels' }),
          };
        }
        if (rowOwnership.owned && rowLabels.length === 1) {
          return {
            text: rowLabels[0].text,
            source: 'form-row-sibling',
            semanticRoot,
            debug: Object.freeze({
              ...debug,
              formItemLabelFound: true,
              ownershipReason: 'local-sibling-label',
            }),
          };
        }
      }
    }

    return { text: '', source: '', semanticRoot, debug: Object.freeze(debug) };
  }

  function semanticOwnershipDebugFor(element) {
    return resolveInteractiveControlSemanticOwner(element).debug;
  }

  function canonicalCustomSelectRoot(element) {
    return outermostCustomSelectRoot(element) || element;
  }

  function metadataLabelFor(element) {
    let current = element;
    for (let depth = 0; current && depth < 4; depth += 1, current = current.parentElement) {
      if (current !== element && !rootOwnsSingleField(current, element)) continue;
      for (const attribute of METADATA_LABEL_ATTRIBUTES) {
        const value = plainSemanticText(current.getAttribute?.(attribute), 160);
        if (value) return { text: value, source: `ancestor-${attribute}` };
      }
    }
    return null;
  }

  function resolveSemanticLabel(element) {
    if (!element) return { text: '', source: '', semanticPlaceholder: '' };
    const document = element.ownerDocument;
    const semanticOwners = uniqueElements([element, uniqueOwnedControl(element)].filter(Boolean));
    for (const owner of semanticOwners) {
      const ariaText = ariaLabelledText(owner, element);
      if (ariaText) return { text: ariaText, source: 'aria-labelledby', semanticPlaceholder: '' };
    }

    for (const owner of semanticOwners) {
      const labels = owner.labels ? [...owner.labels] : [];
      if (labels.length) {
        const text = plainSemanticText(labels.map(label => textWithoutControls(label, 100)).join(' '), 160);
        if (text) return { text, source: 'element-labels', semanticPlaceholder: '' };
      }
    }
    for (const owner of semanticOwners) {
      const id = safeString(owner.id);
      if (id && document) {
        const label = queryOne(document, `label[for="${cssEscape(id, document)}"]`);
        const text = plainSemanticText(textWithoutControls(label, 160), 160);
        if (text) return { text, source: 'label-for', semanticPlaceholder: '' };
      }
    }

    for (const owner of semanticOwners) {
      const wrapper = closest(owner, 'label');
      if (wrapper) {
        const text = plainSemanticText(textWithoutControls(wrapper, 160), 160);
        if (text) return { text, source: 'wrapping-label', semanticPlaceholder: '' };
      }
    }

    const rowLabel = tableRowLabelFor(element);
    if (rowLabel) return { text: rowLabel, source: 'table-row-label', semanticPlaceholder: '' };

    const semanticOwner = resolveInteractiveControlSemanticOwner(element);
    if (semanticOwner.text) {
      return { text: semanticOwner.text, source: semanticOwner.source, semanticPlaceholder: '' };
    }

    const metadata = metadataLabelFor(element);
    if (metadata) return { ...metadata, semanticPlaceholder: '' };

    for (const owner of semanticOwners) {
      const accessible = plainSemanticText(owner.getAttribute?.('aria-label'), 160)
        || plainSemanticText(owner.getAttribute?.('title'), 160);
      if (accessible) {
        return {
          text: accessible,
          source: owner.getAttribute?.('aria-label') ? 'aria-label' : 'title',
          semanticPlaceholder: '',
        };
      }
    }

    const semanticPlaceholder = semanticPlaceholderFor(element);
    return semanticPlaceholder
      ? { text: '', source: 'semantic-placeholder', semanticPlaceholder }
      : { text: '', source: '', semanticPlaceholder: '' };
  }

  function tableRowLabelFor(element) {
    const cell = closest(element, 'td,th');
    const row = cell?.parentElement;
    if (!cell || !row || !matches(row, 'tr')) return '';
    const cells = [...(row.children || [])].filter(child => matches(child, 'td,th'));
    const cellIndex = cells.indexOf(cell);
    if (cellIndex < 0) return '';

    // Common server-rendered forms use: <tr><td>label</td><td><input></td></tr>.
    // Treat the nearest preceding static cell as a real label. Stop at another
    // form control so a missing label cannot borrow semantics from a previous field.
    for (let index = cellIndex - 1; index >= 0; index -= 1) {
      const candidate = cells[index];
      if (queryOne(candidate, 'input:not([type="hidden"]),textarea,select,button,[contenteditable="true"],[role="combobox"]')) break;
      const text = textWithoutControls(candidate, 160);
      if (text && text.length <= 160) return text;
    }

    // Some table forms render the label and control in the same cell.
    const inlineText = textWithoutControls(cell, 120);
    if (inlineText && !/(?:不能为空|请选择|格式错误|校验失败|invalid|required)/i.test(inlineText)) return inlineText;
    return '';
  }

  function associatedLabel(element) {
    return resolveSemanticLabel(element).text;
  }

  function triggerMetadata(element) {
    return cleanStaticText([
      element?.textContent,
      element?.innerText,
      element?.id,
      typeof element?.className === 'string' ? element.className : element?.className?.baseVal,
      element?.getAttribute?.('aria-label'),
      element?.getAttribute?.('title'),
      element?.getAttribute?.('data-role'),
      element?.getAttribute?.('data-type'),
    ].filter(Boolean).join(' '), 240);
  }

  function normalizedTriggerAction(candidate) {
    return closest(candidate, 'button,[role="button"],input[type="button"],[aria-haspopup],[aria-controls]') || candidate;
  }

  function dateTriggerPriority(candidate) {
    const tag = safeString(candidate?.tagName).toLowerCase();
    const type = safeString(candidate?.type || candidate?.getAttribute?.('type')).toLowerCase();
    let priority = 0;
    if (safeString(candidate?.getAttribute?.('aria-controls') || candidate?.getAttribute?.('aria-owns'))) priority += 4;
    if (tag === 'button' || candidate?.getAttribute?.('role') === 'button' || (tag === 'input' && type === 'button')) priority += 2;
    if (candidate?.getAttribute?.('aria-haspopup')) priority += 1;
    return priority;
  }

  function reliableDateTrigger(candidate, localRoot = null) {
    if (!candidate || candidate.disabled || candidate.hidden || candidate.getAttribute?.('aria-disabled') === 'true') return false;
    const tag = safeString(candidate.tagName).toLowerCase();
    const type = safeString(candidate.type || candidate.getAttribute?.('type')).toLowerCase();
    if (tag === 'a' || candidate.getAttribute?.('href') !== null || ['submit', 'reset', 'file', 'image'].includes(type)) return false;
    const metadata = `${triggerMetadata(candidate)} ${triggerMetadata(localRoot)}`;
    return ['date', 'month'].includes(type)
      || DATE_TRIGGER_HINT.test(metadata)
      || (safeString(candidate.getAttribute?.('aria-controls')) && DATE_TRIGGER_HINT.test(triggerMetadata(localRoot)));
  }

  function detectReadonlyInteraction(element, details = {}) {
    const readOnly = Boolean(element?.readOnly || element?.getAttribute?.('aria-readonly') === 'true');
    if (!readOnly) return { interactive: false, kind: '', trigger: null, ambiguous: false };
    const baseKind = safeString(details.baseKind || controlKind(element)).toLowerCase();
    if (details.compoundPicker) {
      return { interactive: true, kind: 'compound-picker', trigger: details.compoundPicker.trigger || null, ambiguous: false };
    }
    const label = details.label || resolveSemanticLabel(element);
    const semantics = cleanStaticText([
      label?.text,
      label?.semanticPlaceholder,
      element?.placeholder,
      element?.getAttribute?.('aria-label'),
      element?.getAttribute?.('title'),
    ].filter(Boolean).join(' '), 240);
    const nativeDateKind = ['date', 'month'].includes(baseKind);
    if (!nativeDateKind && !DATE_SEMANTIC_PATTERN.test(semantics)) {
      return { interactive: false, kind: '', trigger: null, ambiguous: false };
    }
    const scopes = uniqueElements([
      element.parentElement,
      ...localFormRoots(element),
    ]).filter(Boolean);
    for (const scope of scopes) {
      const scopedActions = [];
      queryAll(scope, DATE_TRIGGER_SELECTOR).forEach(candidate => {
        const action = normalizedTriggerAction(candidate);
        if (action !== element && reliableDateTrigger(action, scope)) scopedActions.push(action);
      });
      const unique = uniqueElements(scopedActions);
      if (!unique.length) continue;
      const maxPriority = Math.max(...unique.map(dateTriggerPriority));
      const strongest = unique.filter(candidate => dateTriggerPriority(candidate) === maxPriority);
      return {
        interactive: true,
        kind: 'date-like',
        trigger: strongest.length === 1 ? strongest[0] : null,
        ambiguous: strongest.length > 1,
      };
    }
    return { interactive: false, kind: '', trigger: null, ambiguous: false };
  }

  function tableRowCells(row) {
    return [...(row?.children || [])].filter(child =>
      matches(child, 'td,th')
      || ['cell', 'columnheader'].includes(safeString(child?.getAttribute?.('role')).toLowerCase())
    );
  }

  function tableHeaderElements(table, options = {}) {
    const selector = options.allowUnmarkedFirstRow === true
      ? 'th,thead td,tr:first-child td,[role="columnheader"]'
      : 'th,thead td,[role="columnheader"]';
    return uniqueElements(queryAll(
      table,
      selector,
    ));
  }

  function tableHeaderFor(element) {
    const cell = closest(element, 'td,th');
    const row = cell?.parentElement;
    const table = closest(cell, 'table');
    if (!cell || !row || !table) return '';
    const rowCells = tableRowCells(row);
    const column = rowCells.indexOf(cell);
    if (column < 0) return '';
    const headerElements = new Set(tableHeaderElements(table));
    const rows = queryAll(table, 'thead tr, tr,[role="row"]');
    for (const headerRow of rows) {
      const headers = tableRowCells(headerRow).filter(child => headerElements.has(child));
      if (headers[column]) return textWithoutControls(headers[column], 120);
    }
    return '';
  }

  function isPairedRangeControl(element) {
    if (!element || element.disabled || element.getAttribute?.('aria-disabled') === 'true') return false;
    if (isHidden(element)) return false;
    const tagName = safeString(element.tagName).toLowerCase();
    const role = safeString(element.getAttribute?.('role')).toLowerCase();
    const type = safeString(element.type || element.getAttribute?.('type')).toLowerCase();
    if (tagName === 'input') {
      return !type || ['text', 'date', 'month'].includes(type);
    }
    return role === 'textbox' || element.getAttribute?.('contenteditable') === 'true';
  }

  function pairedRangeRoleFor(element, settings = {}, semanticText = '') {
    if (!Structures?.selectBestDefinitionForHeaders || !Structures?.resolvePairedRangeRole) return null;
    const cell = closest(element, 'td,th');
    const table = closest(cell, 'table');
    if (!cell || !table) return null;

    const headers = tableHeaderElements(table, { allowUnmarkedFirstRow: true })
      .map(node => textWithoutControls(node, 120))
      .filter(Boolean);
    const structuralMatch = Structures.selectBestDefinitionForHeaders(headers);
    if (structuralMatch?.definition?.sectionId !== 'internships') return null;

    const header = tableHeaderFor(element);
    if (!Structures.pairedRangeForHeader('internships', header)) return null;
    const controls = actionableControls(cell).filter(isPairedRangeControl);
    const controlIndex = controls.indexOf(element);
    if (controls.length !== 2 || controlIndex < 0) return null;

    return Structures.resolvePairedRangeRole({
      sectionId: 'internships',
      header,
      controlIndex,
      controlCount: controls.length,
      semanticText,
    });
  }

  function previousStaticText(element) {
    let sibling = element?.previousElementSibling;
    for (let index = 0; index < 3 && sibling; index += 1) {
      if (!queryOne(sibling, 'input,textarea,select,[contenteditable="true"]')) {
        const text = textWithoutControls(sibling, 140);
        if (text && text.length <= 140) return text;
      }
      sibling = sibling.previousElementSibling;
    }
    const parent = element?.parentElement;
    sibling = parent?.previousElementSibling;
    if (sibling && !queryOne(sibling, 'input,textarea,select,[contenteditable="true"]')) {
      const text = textWithoutControls(sibling, 140);
      if (text.length <= 140) return text;
    }
    return '';
  }

  function directText(element) {
    if (!element?.childNodes) return '';
    return cleanStaticText([...element.childNodes]
      .filter(node => node.nodeType === 3)
      .map(node => node.textContent)
      .join(' '), 140);
  }

  function groupContext(element) {
    const group = closest(element, FORM_GROUP_SELECTOR);
    if (!group) return { element: null, text: '', parentText: '' };
    const heading = queryOne(group, 'legend,h1,h2,h3,h4,h5,h6,[role="heading"],.group-title,[class*="group-title"]');
    const label = queryOne(group, LABEL_SELECTOR);
    const ariaText = ariaLabelledText(group) || cleanStaticText(group.getAttribute?.('aria-label'));
    return {
      element: group,
      text: textWithoutControls(heading || label, 160) || ariaText,
      parentText: directText(group),
    };
  }

  function actionText(element) {
    return cleanStaticText(
      element?.innerText
      || element?.textContent
      || element?.value
      || element?.title
      || element?.getAttribute?.('aria-label'),
      80,
    );
  }

  /**
   * 一些旧报名系统把“只读/受控文本框 + 选择按钮”组合成学校、专业等
   * 复合选择器。未注册站点适配器前不能把它当普通 input 直接写值。
   */
  function detectCompoundPicker(element, baseKind = controlKind(element), settings = {}) {
    if (!element || !['text', 'number'].includes(baseKind)) return null;
    if (safeString(element.type).toLowerCase() === 'password') return null;
    const scopes = uniqueElements([
      element.parentElement,
      closest(element, 'td,th'),
      closest(element, FORM_GROUP_SELECTOR),
    ]).filter(scope => scope && scope !== element);
    for (const scope of scopes) {
      const triggers = queryAll(scope, 'button,input[type="button"],[role="button"],a');
      for (const trigger of triggers) {
        if (trigger === element || trigger.disabled || trigger.getAttribute?.('aria-disabled') === 'true') continue;
        const tag = safeString(trigger.tagName).toLowerCase();
        const type = safeString(trigger.type || trigger.getAttribute?.('type')).toLowerCase();
        if ((tag === 'button' || tag === 'input') && type === 'submit') continue;
        const triggerText = actionText(trigger).replace(/[：:]/g, '').replace(/\s+/g, '');
        if (!COMPOUND_PICKER_TRIGGER_PATTERN.test(triggerText)) continue;
        const supported = typeof settings.isCompoundPickerSupported === 'function'
          ? settings.isCompoundPickerSupported({ element, trigger, triggerText }) === true
          : settings.compoundPickerSupported === true;
        return { trigger, triggerText, supported };
      }
    }
    return null;
  }

  function controlKind(element) {
    const role = safeString(element?.getAttribute?.('role')).toLowerCase();
    const tag = safeString(element?.tagName).toLowerCase();
    const inputType = safeString(element?.type || element?.getAttribute?.('type')).toLowerCase();
    if (inputType === 'file') return 'file';
    if (tag === 'select') return 'native-select';
    if (inputType === 'radio' || role === 'radio') return 'radio';
    if (inputType === 'checkbox' || role === 'checkbox') return 'checkbox';
    if (inputType === 'date') return 'date';
    if (inputType === 'month') return 'month';
    if (tag === 'textarea') return 'textarea';
    if (element?.isContentEditable || element?.getAttribute?.('contenteditable') === 'true') return 'contenteditable';
    if (cascaderDetailsFor(element)) return 'cascader';
    if (role === 'combobox' || matches(element, CUSTOM_SELECT_SELECTOR)) return 'custom-select';
    if (role === 'spinbutton' || inputType === 'number') return 'number';
    return 'text';
  }

  function readCurrentValue(element, kind) {
    if (!element) return '';
    if (kind === 'radio' || kind === 'checkbox') return Boolean(element.checked || element.getAttribute?.('aria-checked') === 'true');
    if (kind === 'contenteditable') return safeString(element.textContent);
    if (kind === 'cascader') {
      const rootNode = outermostCascaderRoot(element) || element;
      const trigger = cascaderTriggerFor(rootNode);
      const selected = queryOne(rootNode, '[class*="cascader-picker-label"],[class*="cascader__label"],[data-cascader-value]');
      return safeString(trigger?.value || selected?.textContent || rootNode.getAttribute?.('data-value') || '');
    }
    if (kind === 'custom-select') {
      const selected = queryOne(element, '[class*="selection-item"],[class*="selected-value"],[aria-selected="true"]');
      return safeString(selected?.textContent || element.getAttribute?.('data-value') || '');
    }
    return element.value ?? '';
  }

  function isSensitiveControl(element, metadata = '') {
    const inputType = safeString(element?.type || element?.getAttribute?.('type')).toLowerCase();
    if (inputType === 'password') return true;
    return /密码|验证码|短信验证|人脸|captcha|otp|one.?time|token|session|authorization|credential|secret/i.test(metadata);
  }

  function isMaskedIdentityDisplay(metadata, currentValue) {
    const value = safeString(currentValue);
    if (!/(?:\*|＊|•|●|·){2,}/.test(value)) return false;
    return /身份证|身份证件|证件号码|居民身份证|id\s*card|id\s*number|idcard|idnumber|sfzh|zjhm/i.test(safeString(metadata));
  }

  function nativeOptions(element) {
    if (!element) return [];
    if (safeString(element.tagName).toLowerCase() === 'select') {
      return [...(element.options || [])].map(option => ({
        label: cleanStaticText(option.textContent || option.label, 100),
        value: safeString(option.value),
        disabled: Boolean(option.disabled),
        element: option,
      }));
    }
    return [];
  }

  function describeParent(groupElement, element) {
    const parent = groupElement || element?.parentElement;
    if (!parent) return null;
    return {
      tag: safeString(parent.tagName).toLowerCase(),
      id: safeString(parent.id).slice(0, 100),
      classes: safeString(typeof parent.className === 'string' ? parent.className : '')
        .split(/\s+/).filter(Boolean).slice(0, 8),
      role: safeString(parent.getAttribute?.('role')),
      dataKeys: Object.keys(parent.dataset || {}).slice(0, 10),
    };
  }

  function parseFileConstraints(text, element) {
    const source = safeString(text);
    const sizeMatch = source.match(/(?:最大|不超过|小于|≤|限)[^\d]{0,8}(\d+(?:\.\d+)?)\s*(kb|mb|gb)/i)
      || source.match(/(\d+(?:\.\d+)?)\s*(kb|mb|gb)\s*(?:以内|以下|上限)/i);
    let maxBytes = null;
    if (sizeMatch) {
      const unit = sizeMatch[2].toLowerCase();
      const multiplier = unit === 'gb' ? 1024 ** 3 : unit === 'mb' ? 1024 ** 2 : 1024;
      maxBytes = Math.floor(Number(sizeMatch[1]) * multiplier);
    }
    const countMatch = source.match(/(?:最多|不超过|限传|只能上传)\s*(\d+)\s*(?:个|份|张|项|文件)/);
    return {
      accept: safeString(element?.accept || element?.getAttribute?.('accept')),
      multiple: Boolean(element?.multiple),
      maxBytes,
      maxCount: countMatch ? Number(countMatch[1]) : (element?.multiple ? null : 1),
    };
  }

  function buildDescriptor(element, index, settings = {}) {
    const baseKind = controlKind(element);
    const cascader = baseKind === 'cascader' ? cascaderDetailsFor(element) : null;
    const compoundPicker = detectCompoundPicker(element, baseKind, settings);
    const kind = compoundPicker ? 'compound-picker' : baseKind;
    const group = groupContext(element);
    const semanticLabel = resolveSemanticLabel(element);
    const labelText = semanticLabel.text;
    const headerText = tableHeaderFor(element);
    const rawNearbyText = previousStaticText(element);
    const pairedRangeRole = pairedRangeRoleFor(
      element,
      settings,
      [semanticLabel.text, semanticLabel.semanticPlaceholder, rawNearbyText]
        .filter(Boolean)
        .join(' '),
    );
    // A table row label is often discovered by both associatedLabel() and the
    // preceding-sibling fallback. Keep it as one piece of evidence, not two votes.
    const nearbyText = cleanStaticText(rawNearbyText) === cleanStaticText(labelText) ? '' : rawNearbyText;
    const interactionElement = baseKind === 'file'
      ? closest(element, CUSTOM_UPLOAD_SELECTOR) || element
      : cascader?.trigger || element;
    const visible = baseKind === 'file'
      ? !isHidden(interactionElement)
      : !isHidden(element);
    const fileContext = [labelText, headerText, nearbyText, group.text, group.parentText].filter(Boolean).join(' ');
    const sensitiveMetadata = [
      labelText, headerText, nearbyText, group.text, element.type, element.id, element.name,
      element.getAttribute?.('aria-label'), element.getAttribute?.('placeholder'), element.autocomplete,
    ].filter(Boolean).join(' ');
    const currentValue = readCurrentValue(element, baseKind);
    const readonlyInteraction = detectReadonlyInteraction(element, {
      baseKind,
      compoundPicker,
      label: semanticLabel,
    });
    return {
      detectorId: `field_${index}`,
      element,
      interactionElement,
      elements: [element],
      groupElement: group.element,
      section: settings.section || null,
      tagName: safeString(element.tagName).toLowerCase(),
      type: kind,
      controlKind: kind,
      baseControlKind: baseKind,
      compoundPicker: Boolean(compoundPicker),
      compoundPickerAdapted: Boolean(compoundPicker?.supported),
      compoundPickerTrigger: compoundPicker?.trigger || null,
      compoundPickerTriggerText: compoundPicker?.triggerText || '',
      cascader: Boolean(cascader),
      cascaderRoot: cascader?.root || null,
      cascaderTrigger: cascader?.trigger || null,
      inputType: safeString(element.type || element.getAttribute?.('type')).toLowerCase(),
      id: safeString(element.id),
      name: safeString(element.name || element.getAttribute?.('name')),
      placeholder: safeString(interactionElement.placeholder || interactionElement.getAttribute?.('placeholder')),
      ariaLabel: safeString(interactionElement.getAttribute?.('aria-label') || element.getAttribute?.('aria-label')),
      title: safeString(interactionElement.getAttribute?.('title') || element.getAttribute?.('title')),
      autocomplete: safeString(interactionElement.autocomplete || interactionElement.getAttribute?.('autocomplete')),
      labelText,
      labelSource: semanticLabel.source,
      semanticOwnershipDebug: baseKind === 'custom-select'
        || baseKind === 'cascader'
        || Boolean(compoundPicker)
        || readonlyInteraction.interactive
        ? semanticOwnershipDebugFor(element)
        : null,
      semanticPlaceholder: semanticLabel.semanticPlaceholder
        || (!labelText ? pairedRangeRole?.semanticLabel || '' : ''),
      pairedRangeRole,
      tableHeader: headerText,
      parentText: group.parentText,
      nearbyText,
      groupText: group.text,
      currentValue,
      options: nativeOptions(element),
      visible,
      hidden: !visible,
      disabled: Boolean(element.disabled || element.getAttribute?.('aria-disabled') === 'true'),
      readOnly: Boolean(element.readOnly || element.getAttribute?.('aria-readonly') === 'true'),
      interactiveReadonly: readonlyInteraction.interactive,
      readonlyInteractionKind: readonlyInteraction.kind,
      datePickerTrigger: readonlyInteraction.kind === 'date-like' ? readonlyInteraction.trigger : null,
      datePickerAmbiguous: readonlyInteraction.kind === 'date-like' && readonlyInteraction.ambiguous,
      required: Boolean(element.required || element.getAttribute?.('aria-required') === 'true'),
      multiple: Boolean(element.multiple),
      accept: safeString(element.accept || element.getAttribute?.('accept')),
      fileConstraints: baseKind === 'file' ? parseFileConstraints(fileContext, element) : null,
      sensitive: isSensitiveControl(element, sensitiveMetadata),
      maskedDisplay: isMaskedIdentityDisplay(sensitiveMetadata, currentValue),
      parent: describeParent(group.element, element),
    };
  }

  function groupChoiceDescriptors(descriptors) {
    const result = [];
    const consumed = new Set();
    descriptors.forEach(descriptor => {
      if (consumed.has(descriptor)) return;
      if (!['radio', 'checkbox'].includes(descriptor.controlKind)
        || (!descriptor.name && !descriptor.groupElement)) {
        result.push(descriptor);
        return;
      }
      const group = descriptors.filter(candidate =>
        !consumed.has(candidate)
        && candidate.controlKind === descriptor.controlKind
        && (descriptor.name ? candidate.name === descriptor.name : !candidate.name)
        && candidate.groupElement === descriptor.groupElement
      );
      group.forEach(item => consumed.add(item));
      if (group.length === 1) {
        result.push(descriptor);
        return;
      }
      const options = group.map(item => ({
        label: item.labelText || safeString(item.element?.value),
        value: safeString(item.element?.value),
        checked: Boolean(item.element?.checked),
        element: item.element,
      }));
      result.push({
        ...descriptor,
        elements: group.map(item => item.element),
        options,
        labelText: descriptor.groupText || descriptor.labelText,
        currentValue: options.find(option => option.checked)?.value || '',
      });
    });
    return result;
  }

  function scan(rootNode, settings = {}) {
    const document = rootNode?.nodeType === 9 ? rootNode : rootNode?.ownerDocument;
    const searchRoot = rootNode || document;
    if (!searchRoot?.querySelectorAll) return [];

    const standard = queryAll(searchRoot, STANDARD_SELECTOR);
    // input[type=file] 可能被隐藏，不能由 STANDARD_SELECTOR 的可见输入规则漏掉。
    const files = queryAll(searchRoot, 'input[type="file"]');
    const customSelects = queryAll(searchRoot, CUSTOM_SELECT_SELECTOR);
    const cascaders = queryAll(searchRoot, CASCADER_SELECTOR);
    const uploadRoots = queryAll(searchRoot, CUSTOM_UPLOAD_SELECTOR);
    const candidates = [];

    [...standard, ...files].forEach(element => {
      const kind = controlKind(element);
      const cascader = kind !== 'file' ? cascaderDetailsFor(element) : null;
      const customRoot = kind !== 'file' ? closest(element, CUSTOM_SELECT_SELECTOR) : null;
      if (cascader) candidates.push(cascader.root);
      else if (customRoot && customRoot !== element && kind !== 'radio' && kind !== 'checkbox') candidates.push(customRoot);
      else candidates.push(element);
    });
    cascaders.forEach(element => {
      const details = cascaderDetailsFor(element);
      if (details) candidates.push(details.root);
    });
    customSelects.forEach(element => candidates.push(element));
    uploadRoots.forEach(rootElement => {
      const fileInput = queryOne(rootElement, 'input[type="file"]');
      if (fileInput) candidates.push(fileInput);
    });

    const panelSelector = '#__jf_panel__,#__rf_panel__,[data-jf-floating-panel]';
    const canonicalCandidates = candidates.map(element =>
      controlKind(element) === 'cascader'
        ? outermostCascaderRoot(element) || element
        : controlKind(element) === 'custom-select'
          ? canonicalCustomSelectRoot(element)
          : element
    );
    const unique = uniqueElements(canonicalCandidates).filter(element => {
      if (closest(element, panelSelector)) return false;
      const parentCustom = closest(element?.parentElement, CUSTOM_SELECT_SELECTOR);
      // Ant/Element/React Select 常把 role=combobox input 嵌在可点击外壳中，只保留外层描述符。
      if (parentCustom && parentCustom !== element && matches(element, '[role="combobox"],input')) return false;
      return true;
    });
    const descriptors = unique.map((element, index) => buildDescriptor(element, index, settings));
    const grouped = groupChoiceDescriptors(descriptors);
    const fieldContext = globalThis.JFFieldContext;
    const regions =
      settings.regionCandidates
      || settings.embeddedRegions
      || settings.regions
      || [];

    return grouped.map((descriptor, index) => {
      const normalized = {
        ...descriptor,
        detectorId: `field_${index}`,
      };

      if (fieldContext?.resolve) {
        normalized.context = fieldContext.resolve(
          normalized,
          regions,
          settings.sectionContext || null,
        );
      }

      return normalized;
    });
  }

  function redactMetadata(value) {
    return safeString(value)
      .replace(/\b1\d{10}\b/g, '<redacted-phone>')
      .replace(/\b\d{17}[\dXx]\b/g, '<redacted-id>')
      .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '<redacted-email>')
      .replace(/\b\d{7,}\b/g, '<redacted-number>')
      .slice(0, 240);
  }

  function datePickerDebugFor(descriptorOrElement) {
    let raw = null;
    try {
      raw = getDateLikeAdapter?.()?.getDebugTrace?.(descriptorOrElement) || null;
    } catch (_) {
      raw = null;
    }
    if (!raw || typeof raw !== 'object') return null;
    const count = value => Math.max(0, Math.trunc(Number(value) || 0));
    const mode = value => ['DAY', 'MONTH', 'YEAR'].includes(safeString(value).toUpperCase())
      ? safeString(value).toUpperCase()
      : 'UNKNOWN';
    const switchKinds = new Set([
      'MONTH_BUTTON', 'MONTH_ANCHOR', 'MONTH_SPAN', 'MONTH_DIV', 'MONTH_OTHER',
      'YEAR_BUTTON', 'YEAR_ANCHOR', 'YEAR_SPAN', 'YEAR_DIV', 'YEAR_OTHER',
    ]);
    const switchRejections = new Set([
      'NO_HEADER_CANDIDATE', 'DISABLED_CANDIDATE',
      'MONTH_SEMANTIC_LABEL_MISMATCH', 'YEAR_SEMANTIC_LABEL_MISMATCH',
      'MULTIPLE_MONTH_SWITCH_CANDIDATES', 'MULTIPLE_YEAR_SWITCH_CANDIDATES',
      'NO_MATCHING_MODE_SWITCH', 'SAFETY_REJECTED',
    ]);
    const switchSources = new Set([
      'EXPLICIT_ATTRIBUTE', 'LEGACY_ANT_CLASS', 'MODERN_ANT_CLASS', 'GENERIC_CLASS',
    ]);
    const switchSafetyReasons = new Set([
      'LINK_ROLE_MISSING', 'HREF_PRESENT', 'FORM_ACTION_PRESENT',
      'INLINE_HANDLER_PRESENT', 'OWNER_MISMATCH', 'MODE_MISMATCH',
      'LIVE_GUARD_FAILED', 'DANGEROUS_ACTION', 'DETACHED', 'DISABLED',
    ]);
    const switchEnums = (values, allowed) => [...new Set(
      (Array.isArray(values) ? values : [])
        .map(value => safeString(value).toUpperCase())
        .filter(value => allowed.has(value)),
    )].slice(0, 20);
    const rawSwitch = raw.modeSwitchDebug && typeof raw.modeSwitchDebug === 'object'
      ? raw.modeSwitchDebug
      : {};
    const selectedSwitchSource = safeString(rawSwitch.selectedSwitchSource).toUpperCase();
    const safetyReason = safeString(rawSwitch.safetyReason).toUpperCase();
    return {
      triggerCandidateCount: count(raw.triggerCandidateCount),
      selectedTriggerSource: redactMetadata(raw.selectedTriggerSource).slice(0, 80),
      rawPanelCandidateCount: count(raw.rawPanelCandidateCount),
      visiblePanelCandidateCount: count(raw.visiblePanelCandidateCount),
      canonicalClusterCount: count(raw.canonicalClusterCount),
      selectedClusterEvidence: redactMetadata(raw.selectedClusterEvidence).slice(0, 80),
      selectedPanelMode: redactMetadata(raw.selectedPanelMode).slice(0, 20),
      transitionCount: count(raw.transitionCount),
      modeBeforeTransition: mode(raw.modeBeforeTransition),
      modeAfterTransition: mode(raw.modeAfterTransition),
      rawAfterTransition: count(raw.rawAfterTransition),
      canonicalAfterTransition: count(raw.canonicalAfterTransition),
      selectedAfterTransitionEvidence: redactMetadata(raw.selectedAfterTransitionEvidence).slice(0, 80),
      modeSwitchDebug: {
        panelMode: mode(rawSwitch.panelMode),
        headerCandidateCount: count(rawSwitch.headerCandidateCount),
        monthSwitchCandidateCount: count(rawSwitch.monthSwitchCandidateCount),
        yearSwitchCandidateCount: count(rawSwitch.yearSwitchCandidateCount),
        candidateKinds: switchEnums(rawSwitch.candidateKinds, switchKinds),
        rejectionReasons: switchEnums(rawSwitch.rejectionReasons, switchRejections),
        selectedSwitchSource: switchSources.has(selectedSwitchSource) ? selectedSwitchSource : '',
        safetyReason: switchSafetyReasons.has(safetyReason) ? safetyReason : '',
      },
      finalReasonCode: redactMetadata(raw.finalReasonCode).slice(0, 80),
    };
  }

  function cascaderDebugFor(descriptorOrElement) {
    let raw = descriptorOrElement?.cascaderDebug || null;
    try {
      raw = getCascaderAdapter?.()?.getDebugTrace?.(descriptorOrElement) || raw;
    } catch (_) { /* metadata hook must never break diagnosis */ }
    if (!raw || typeof raw !== 'object') return null;
    const count = value => Math.max(0, Math.trunc(Number(value) || 0));
    const strategies = new Set([
      '', 'same-overlay', 'controlled-replacement', 'fresh-overlay-replacement', 'rebind-failed',
    ]);
    const failureReasons = new Set([
      '', 'NO_UNIQUE_CONTROLLED_REPLACEMENT', 'NO_UNIQUE_FRESH_REPLACEMENT',
      'STALE_OR_MISSING_NEXT_MENU',
    ]);
    const strategy = safeString(raw.rebindStrategy);
    const failureReason = safeString(raw.rebindFailureReason).toUpperCase();
    const newMenuIndexes = [...new Set((Array.isArray(raw.newMenuIndexes)
      ? raw.newMenuIndexes
      : [])
      .map(value => Math.trunc(Number(value)))
      .filter(value => Number.isInteger(value) && value >= 0 && value <= 100))]
      .slice(0, 20);
    return {
      levelCount: count(raw.levelCount),
      selectedLevelCount: count(raw.selectedLevelCount),
      panelOwnership: redactMetadata(raw.panelOwnership).slice(0, 80),
      ambiguityReason: redactMetadata(raw.ambiguityReason).slice(0, 80),
      overlayIdentityStable: Boolean(raw.overlayIdentityStable),
      menuCountBefore: count(raw.menuCountBefore),
      menuCountAfter: count(raw.menuCountAfter),
      visibleMenuCountBefore: count(raw.visibleMenuCountBefore),
      visibleMenuCountAfter: count(raw.visibleMenuCountAfter),
      newMenuIndexes,
      newMenuCount: newMenuIndexes.length,
      optionSetChanged: Boolean(raw.optionSetChanged),
      rebindStrategy: strategies.has(strategy) ? strategy : '',
      rebindFailureReason: failureReasons.has(failureReason) ? failureReason : '',
    };
  }

  function safeOption(option) {
    return {
      label: redactMetadata(option?.label ?? option?.text ?? option?.textContent),
      disabled: Boolean(option?.disabled),
    };
  }

  /**
   * 转为可导出的元数据。严禁包含 currentValue、DOM、File 或 FileList。
   */
  function toDiagnostic(descriptorOrList) {
    if (Array.isArray(descriptorOrList)) return descriptorOrList.filter(item => !item?.sensitive).map(toDiagnostic);
    const descriptor = descriptorOrList || {};
    if (descriptor.sensitive) return null;
    const rawContext = descriptor.context && typeof descriptor.context === 'object'
      ? descriptor.context
      : null;
    const contextSection = redactMetadata(rawContext?.sectionId || rawContext?.section);
    const contextCollection = redactMetadata(rawContext?.collection || contextSection);
    const contextIndex = Number.isInteger(rawContext?.indexContext?.index)
      ? Math.max(0, rawContext.indexContext.index)
      : Number.isInteger(rawContext?.index)
        ? Math.max(0, rawContext.index)
        : null;
    const diagnosticContext = rawContext ? {
      section: contextSection,
      sectionId: contextSection,
      collection: contextCollection,
      collectionMode: redactMetadata(rawContext.collectionMode),
      source: redactMetadata(rawContext.source),
      confidence: Math.max(0, Math.min(1, Number(rawContext.confidence) || 0)),
      regionId: redactMetadata(rawContext.regionId),
      index: contextIndex,
      indexContext: contextIndex === null ? null : {
        section: redactMetadata(rawContext.indexContext?.section || contextCollection),
        collection: redactMetadata(rawContext.indexContext?.collection || contextCollection),
        index: contextIndex,
      },
    } : null;
    return {
      detectorId: redactMetadata(descriptor.detectorId),
      // 兼容旧 diagnosis schema；真实事实来源始终是 descriptor.context。
      section: contextSection || redactMetadata(descriptor.section),
      context: diagnosticContext,
      tagName: redactMetadata(descriptor.tagName),
      type: redactMetadata(descriptor.controlKind || descriptor.type),
      baseControlKind: redactMetadata(descriptor.baseControlKind),
      compoundPicker: Boolean(descriptor.compoundPicker),
      compoundPickerAdapted: Boolean(descriptor.compoundPickerAdapted),
      compoundPickerTriggerText: redactMetadata(descriptor.compoundPickerTriggerText),
      cascader: Boolean(descriptor.cascader || descriptor.controlKind === 'cascader'),
      cascaderDebug: cascaderDebugFor(descriptor) || cascaderDebugFor(descriptor.element),
      inputType: redactMetadata(descriptor.inputType),
      id: redactMetadata(descriptor.id),
      name: redactMetadata(descriptor.name),
      placeholder: redactMetadata(descriptor.placeholder),
      ariaLabel: redactMetadata(descriptor.ariaLabel),
      title: redactMetadata(descriptor.title),
      autocomplete: redactMetadata(descriptor.autocomplete),
      labelText: redactMetadata(descriptor.labelText),
      labelSource: redactMetadata(descriptor.labelSource),
      semanticOwnershipDebug: descriptor.semanticOwnershipDebug ? {
        logicalControlCount: Math.max(0, Math.trunc(Number(descriptor.semanticOwnershipDebug.logicalControlCount) || 0)),
        formItemFound: Boolean(descriptor.semanticOwnershipDebug.formItemFound),
        formItemLabelFound: Boolean(descriptor.semanticOwnershipDebug.formItemLabelFound),
        ownershipReason: redactMetadata(descriptor.semanticOwnershipDebug.ownershipReason).slice(0, 80),
      } : null,
      semanticPlaceholder: redactMetadata(descriptor.semanticPlaceholder),
      tableHeader: redactMetadata(descriptor.tableHeader),
      parentText: redactMetadata(descriptor.parentText),
      nearbyText: redactMetadata(descriptor.nearbyText),
      groupText: redactMetadata(descriptor.groupText),
      visible: Boolean(descriptor.visible),
      disabled: Boolean(descriptor.disabled),
      readOnly: Boolean(descriptor.readOnly),
      interactiveReadonly: Boolean(descriptor.interactiveReadonly),
      readonlyInteractionKind: redactMetadata(descriptor.readonlyInteractionKind),
      datePickerAmbiguous: Boolean(descriptor.datePickerAmbiguous),
      datePickerDebug: datePickerDebugFor(descriptor) || datePickerDebugFor(descriptor.element),
      maskedDisplay: Boolean(descriptor.maskedDisplay),
      required: Boolean(descriptor.required),
      multiple: Boolean(descriptor.multiple),
      accept: redactMetadata(descriptor.accept),
      fileConstraints: descriptor.fileConstraints ? {
        accept: redactMetadata(descriptor.fileConstraints.accept),
        multiple: Boolean(descriptor.fileConstraints.multiple),
        maxBytes: descriptor.fileConstraints.maxBytes ?? null,
        maxCount: descriptor.fileConstraints.maxCount ?? null,
      } : null,
      options: (descriptor.options || []).slice(0, 100).map(safeOption),
      parent: descriptor.parent ? {
        tag: redactMetadata(descriptor.parent.tag),
        id: redactMetadata(descriptor.parent.id),
        classes: (descriptor.parent.classes || []).map(redactMetadata).slice(0, 8),
        role: redactMetadata(descriptor.parent.role),
        dataKeys: (descriptor.parent.dataKeys || []).map(redactMetadata).slice(0, 10),
      } : null,
    };
  }

  return {
    CASCADER_SELECTOR,
    CUSTOM_SELECT_SELECTOR,
    CUSTOM_UPLOAD_SELECTOR,
    COMPOUND_PICKER_TRIGGER_PATTERN,
    FORM_GROUP_SELECTOR,
    STANDARD_SELECTOR,
    associatedLabel,
    buildDescriptor,
    controlKind,
    cascaderDetailsFor,
    detectCompoundPicker,
    detectReadonlyInteraction,
    isHidden,
    isMaskedIdentityDisplay,
    logicalFieldRoot,
    logicalFieldRoots,
    parseFileConstraints,
    pairedRangeRoleFor,
    resolveInteractiveControlSemanticOwner,
    resolveSemanticLabel,
    semanticPlaceholderFor,
    isSensitiveControl,
    scan,
    tableHeaderFor,
    tableRowLabelFor,
    toDiagnostic,
  };
});
