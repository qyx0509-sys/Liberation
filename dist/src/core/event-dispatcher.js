/*
 * 解放：普通 HTML / React / Vue 兼容事件系统
 * SPDX-License-Identifier: MIT
 */
(function initEventDispatcher(root, factory) {
  let safety = root?.JFSafety;
  if (typeof module === 'object' && module.exports) safety = require('./safety.js');
  const api = factory(safety);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.JFEventDispatcher = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function eventDispatcherFactory(Safety) {
  'use strict';

  function safeString(value) {
    return value === null || value === undefined ? '' : String(value);
  }

  function elementAndKind(target, kindOverride) {
    if (target?.element) return { element: target.element, descriptor: target, kind: kindOverride || target.controlKind || target.type };
    return { element: target, descriptor: null, kind: kindOverride || '' };
  }

  function createEvent(element, type, detail = {}) {
    const view = element?.ownerDocument?.defaultView || globalThis;
    const base = { bubbles: true, cancelable: true, composed: true, ...detail };
    try {
      if (type.startsWith('pointer') && typeof view.PointerEvent === 'function') return new view.PointerEvent(type, base);
      if (['mousedown', 'mouseup', 'click'].includes(type) && typeof view.MouseEvent === 'function') return new view.MouseEvent(type, base);
      if (['keydown', 'keyup'].includes(type) && typeof view.KeyboardEvent === 'function') return new view.KeyboardEvent(type, base);
      if (type === 'input' && typeof view.InputEvent === 'function') {
        return new view.InputEvent(type, {
          ...base,
          inputType: detail.inputType || 'insertText',
          data: detail.data === undefined ? null : safeString(detail.data),
        });
      }
      if (['focus', 'blur'].includes(type) && typeof view.FocusEvent === 'function') return new view.FocusEvent(type, base);
      if (typeof view.Event === 'function') return new view.Event(type, base);
    } catch (_) { /* 部分页面的跨 realm 构造器可能拒绝参数。 */ }
    return { type, ...base };
  }

  function dispatch(element, type, detail) {
    if (!element?.dispatchEvent) return false;
    try { return element.dispatchEvent(createEvent(element, type, detail)); }
    catch (_) { return false; }
  }

  function findNativeSetter(element, property) {
    if (!element) return null;
    let prototype = element.constructor?.prototype || Object.getPrototypeOf(element);
    const visited = new Set();
    while (prototype && !visited.has(prototype)) {
      visited.add(prototype);
      const descriptor = Object.getOwnPropertyDescriptor(prototype, property);
      if (typeof descriptor?.set === 'function') return descriptor.set;
      prototype = Object.getPrototypeOf(prototype);
    }
    return null;
  }

  function setNativeProperty(element, property, value) {
    const setter = findNativeSetter(element, property);
    if (setter) setter.call(element, value);
    else element[property] = value;
  }

  function controlKind(target, fallback = '') {
    const { element, kind } = elementAndKind(target, fallback);
    if (kind) return kind;
    const tag = safeString(element?.tagName).toLowerCase();
    const type = safeString(element?.type).toLowerCase();
    if (tag === 'select') return 'native-select';
    if (type === 'radio') return 'radio';
    if (type === 'checkbox') return 'checkbox';
    if (type === 'date') return 'date';
    if (type === 'month') return 'month';
    if (tag === 'textarea') return 'textarea';
    if (element?.isContentEditable) return 'contenteditable';
    return 'text';
  }

  function prohibitedControlReason(element, expectedKind = '') {
    const tag = safeString(element?.tagName).toLowerCase();
    const type = safeString(element?.type || element?.getAttribute?.('type')).toLowerCase();
    if (type === 'password') return '密码字段禁止自动填写';
    if (type === 'file' || expectedKind === 'file') return '文件字段必须交给 FileUploadEngine';
    if (tag === 'button' || ['submit', 'button', 'reset', 'image', 'hidden'].includes(type)) return '按钮或提交控件禁止作为文本字段填写';
    return '';
  }

  const CASCADER_SELECTED_SELECTOR = [
    '[class*="cascader-picker-label"]',
    '[class*="cascader__label"]',
    '.ant-select-selection-item',
    '.el-cascader__tags-text',
    '[data-cascader-selected-item]',
    '[data-cascader-value]',
  ].join(',');
  const CASCADER_MENU_SELECTOR = '.ant-cascader-menu,.el-cascader-menu,[data-cascader-menu],[data-hierarchical-menu]';
  const CASCADER_OPTION_SELECTOR = '.ant-cascader-menu-item,.el-cascader-node,[data-cascader-option],[data-hierarchical-option],[role="menuitem"],[role="treeitem"]';
  const CASCADER_OPTION_LABEL_SELECTOR = '.ant-cascader-menu-item-content,.el-cascader-node__label,[data-cascader-option-label],[data-hierarchical-option-label]';
  const CASCADER_DISABLED_CLASS = /(?:^|\s)(?:disabled|is-disabled|ant-cascader-menu-item-disabled|el-cascader-node--disabled)(?:\s|$)/i;

  function queryAll(root, selector) {
    try { return Array.from(root?.querySelectorAll?.(selector) || []); }
    catch (_) { return []; }
  }

  function readControlValue(target) {
    const { element, descriptor } = elementAndKind(target);
    const kind = controlKind(target);
    if (!element) return '';
    if (kind === 'radio') {
      const elements = descriptor?.elements || [element];
      const selected = elements.find(item => Boolean(item.checked || item.getAttribute?.('aria-checked') === 'true'));
      return selected ? safeString(selected.value || selected.getAttribute?.('data-value') || selected.getAttribute?.('aria-label')) : '';
    }
    if (kind === 'checkbox') {
      const elements = descriptor?.elements || [element];
      if (elements.length === 1) return Boolean(elements[0].checked || elements[0].getAttribute?.('aria-checked') === 'true');
      return elements.filter(item => Boolean(item.checked || item.getAttribute?.('aria-checked') === 'true'))
        .map(item => safeString(item.value || item.getAttribute?.('data-value') || item.getAttribute?.('aria-label')))
        .filter(Boolean);
    }
    if (kind === 'contenteditable') return safeString(element.textContent).trim();
    if (kind === 'cascader') {
      const selected = queryAll(element, CASCADER_SELECTED_SELECTOR)
        .map(item => safeString(item.textContent || item.getAttribute?.('data-value') || item.getAttribute?.('aria-label')).trim())
        .filter(Boolean);
      if (selected.length) return selected.join(' / ');
      const trigger = descriptor?.cascaderTrigger || descriptor?.interactionElement;
      return safeString(trigger?.value || element.getAttribute?.('data-value') || '').trim();
    }
    if (kind === 'custom-select') {
      const selected = element.querySelector?.('[class*="selection-item"],[class*="selected-value"],[aria-selected="true"],.jqx-dropdownlist-content,[class*="jqx-dropdownlist-content"],.jqx-combobox-input,input[class*="jqx-combobox-input"]');
      return safeString(selected?.textContent || element.getAttribute?.('data-value') || '').trim();
    }
    return safeString(element.value).trim();
  }

  function activate(element) {
    try { element.focus?.({ preventScroll: true }); } catch (_) { try { element.focus?.(); } catch (_) { /* ignored */ } }
    dispatch(element, 'focus');
    dispatch(element, 'pointerdown', { pointerType: 'mouse', button: 0, buttons: 1, isPrimary: true });
    dispatch(element, 'mousedown', { button: 0, buttons: 1 });
  }

  function finish(element, value) {
    dispatch(element, 'input', { data: value });
    dispatch(element, 'change');
    try { element.blur?.(); } catch (_) { /* ignored */ }
    dispatch(element, 'blur');
  }

  async function nextRender(element) {
    await Promise.resolve();
    const view = element?.ownerDocument?.defaultView || globalThis;
    await new Promise(resolve => {
      if (typeof view.requestAnimationFrame === 'function') view.requestAnimationFrame(() => resolve());
      else setTimeout(resolve, 0);
    });
  }

  async function setNativeValue(target, rawValue, settings = {}) {
    const { element } = elementAndKind(target, settings.kind);
    const kind = controlKind(target, settings.kind);
    const beforeValue = readControlValue(target);
    if (!element) return { ok: false, beforeValue, afterValue: beforeValue, reason: '字段元素不存在' };
    const prohibited = prohibitedControlReason(element, kind);
    if (prohibited) return { ok: false, beforeValue, afterValue: beforeValue, reason: prohibited };
    if (element.disabled || element.getAttribute?.('aria-disabled') === 'true') {
      return { ok: false, beforeValue, afterValue: beforeValue, reason: '字段已禁用' };
    }
    if (element.readOnly || element.getAttribute?.('aria-readonly') === 'true') {
      return { ok: false, beforeValue, afterValue: beforeValue, reason: '字段为只读' };
    }
    const value = rawValue === null || rawValue === undefined ? '' : String(rawValue);
    try {
      activate(element);
      if (kind === 'contenteditable') element.textContent = value;
      else setNativeProperty(element, 'value', value);
      finish(element, value);
      await nextRender(element);
      const afterValue = readControlValue(target);
      return safeString(afterValue).trim() === value.trim()
        ? { ok: true, beforeValue, afterValue, reason: '' }
        : { ok: false, beforeValue, afterValue, reason: '页面实际值与计划值不一致' };
    } catch (error) {
      return { ok: false, beforeValue, afterValue: readControlValue(target), reason: error?.message || '触发输入事件失败' };
    }
  }

  async function setNativeSelect(target, optionOrValue) {
    const { element } = elementAndKind(target, 'native-select');
    const beforeValue = readControlValue(target);
    if (!element) return { ok: false, beforeValue, afterValue: beforeValue, reason: '下拉字段不存在' };
    if (safeString(element.tagName).toLowerCase() !== 'select') {
      return { ok: false, beforeValue, afterValue: beforeValue, reason: '目标不是原生 select 控件' };
    }
    if (element.disabled || element.getAttribute?.('aria-disabled') === 'true') {
      return { ok: false, beforeValue, afterValue: beforeValue, reason: '下拉字段已禁用' };
    }
    const optionElement = typeof optionOrValue === 'object' && optionOrValue !== null
      ? optionOrValue.element
      : null;
    if (optionElement?.disabled || optionElement?.getAttribute?.('aria-disabled') === 'true') {
      return { ok: false, beforeValue, afterValue: beforeValue, reason: '目标下拉选项已禁用' };
    }
    const value = typeof optionOrValue === 'object' && optionOrValue !== null
      ? safeString(optionOrValue.value ?? optionOrValue.element?.value)
      : safeString(optionOrValue);
    try {
      activate(element);
      // Focus handlers can synchronously disable or replace a controlled select.
      // Revalidate the live element immediately before mutating its value.
      if (element.isConnected === false || element.disabled || element.getAttribute?.('aria-disabled') === 'true') {
        return { ok: false, beforeValue, afterValue: readControlValue(target), reason: '下拉字段已禁用或已离开页面' };
      }
      setNativeProperty(element, 'value', value);
      dispatch(element, 'input', { data: value });
      dispatch(element, 'change');
      try { element.blur?.(); } catch (_) { /* ignored */ }
      dispatch(element, 'blur');
      await nextRender(element);
      const afterValue = readControlValue(target);
      return safeString(afterValue) === value
        ? { ok: true, beforeValue, afterValue, reason: '' }
        : { ok: false, beforeValue, afterValue, reason: '页面未接受所选选项' };
    } catch (error) {
      return { ok: false, beforeValue, afterValue: readControlValue(target), reason: error?.message || '选择下拉选项失败' };
    }
  }

  const CHECKABLE_ARIA_TAGS = Object.freeze(new Set(['div', 'span', 'li']));
  function isDangerousAction(element) {
    // Click safety has one authoritative rule set. If it is unavailable, custom
    // clicks fail closed instead of falling back to a drifting local keyword list.
    return typeof Safety?.isDangerousAction !== 'function' || Safety.isDangerousAction(element);
  }

  function hasDangerousCheckableAncestor(element) {
    let current = element?.parentElement || null;
    let depth = 0;
    while (current && depth < 12) {
      const tag = safeString(current.tagName).toLowerCase();
      const role = safeString(current.getAttribute?.('role')).toLowerCase();
      const href = current.getAttribute?.('href');
      const formAction = current.getAttribute?.('formaction');
      const onclick = current.getAttribute?.('onclick');
      if (['a', 'button'].includes(tag)
        || ['link', 'button'].includes(role)
        || href !== null && href !== undefined
        || formAction !== null && formAction !== undefined) return true;
      if ((onclick !== null && onclick !== undefined) || tag === 'label') {
        if (isDangerousAction(current)) return true;
      }
      current = current.parentElement || null;
      depth += 1;
    }
    return false;
  }

  const LEGAL_ACKNOWLEDGEMENT_RE = /(?:本人|我)[^。；;\n]{0,24}(?:保证|承诺|声明|确认|同意)|(?:诚信|真实性|法律责任)[^。；;\n]{0,24}(?:保证|承诺|声明|确认|同意)|(?:保证|承诺|声明)[^。；;\n]{0,24}(?:真实|完整|法律责任)/i;

  function hasLegalAcknowledgementContext(element) {
    const texts = [];
    const append = value => {
      const text = safeString(value);
      if (text && texts.join(' ').length < 1_000) texts.push(text.slice(0, 500));
    };
    append(element?.getAttribute?.('aria-label'));
    append(element?.getAttribute?.('title'));
    try {
      [...(element?.labels || [])].slice(0, 4).forEach(label => append(label?.innerText || label?.textContent));
    } catch (_) { /* synthetic and cross-realm label collections may be unavailable */ }
    const labelledBy = safeString(element?.getAttribute?.('aria-labelledby')).split(/\s+/).filter(Boolean).slice(0, 4);
    labelledBy.forEach(id => {
      try {
        const label = element?.ownerDocument?.getElementById?.(id);
        append(label?.innerText || label?.textContent);
      } catch (_) { /* fail closed below only when reliable text is available */ }
    });
    let current = element?.parentElement || null;
    let depth = 0;
    while (current && depth < 6) {
      const tag = safeString(current.tagName).toLowerCase();
      const role = safeString(current.getAttribute?.('role')).toLowerCase();
      if (tag === 'label' || role === 'group' || role === 'checkbox' || role === 'radio') {
        append(current?.innerText || current?.textContent);
      }
      current = current.parentElement || null;
      depth += 1;
    }
    return LEGAL_ACKNOWLEDGEMENT_RE.test(texts.join(' '));
  }

  function checkableSafety(element) {
    const tag = safeString(element?.tagName).toLowerCase();
    const type = safeString(element?.type || element?.getAttribute?.('type')).toLowerCase();
    const role = safeString(element?.getAttribute?.('role')).toLowerCase();
    const treeRoot = element?.getRootNode?.();
    const extensionHostId = safeString(treeRoot?.host?.id);
    const extensionSelector = '#__jf_panel__,#__jf_modal__,#__rf_panel__,#__rf_trigger__,[data-jiefang-ui]';
    if (['__jf_panel__', '__jf_modal__', '__rf_panel__', '__rf_trigger__'].includes(extensionHostId)
      || treeRoot?.host?.matches?.('[data-jiefang-ui]')
      || element?.closest?.(extensionSelector)) {
      return { ok: false, reason: '扩展自身界面不能作为网页字段操作' };
    }
    if (element?.isConnected === false || element?.hidden || element?.getAttribute?.('aria-hidden') === 'true') {
      return { ok: false, reason: '选择控件不可用或已离开页面' };
    }
    if (hasLegalAcknowledgementContext(element)) {
      return { ok: false, reason: '法律声明、真实性承诺或同意确认必须由用户本人操作' };
    }
    const native = tag === 'input' && ['checkbox', 'radio'].includes(type);
    if (native) {
      const ownHref = element?.getAttribute?.('href');
      const ownFormAction = element?.getAttribute?.('formaction');
      if (ownHref !== null && ownHref !== undefined
        || ownFormAction !== null && ownFormAction !== undefined
        || isDangerousAction(element)
        || hasDangerousCheckableAncestor(element)) {
        return { ok: false, reason: '原生选择控件关联了导航、表单提交或危险父级动作' };
      }
      return { ok: true, native, role: type };
    }

    if (!['checkbox', 'radio'].includes(role) || !CHECKABLE_ARIA_TAGS.has(tag)) {
      return { ok: false, reason: '目标不是受支持的 checkbox/radio 控件' };
    }
    if (element?.isContentEditable || element?.getAttribute?.('contenteditable') === 'true') {
      return { ok: false, reason: '可编辑容器不能作为自定义选择控件点击' };
    }
    if (element?.getAttribute?.('href') || element?.getAttribute?.('formaction') || element?.form) {
      return { ok: false, reason: '链接或表单动作控件禁止作为自定义选择控件点击' };
    }
    const unsafeAncestor = element?.closest?.('a[href],button,input,select,textarea,[role="link"],[role="button"]');
    if (unsafeAncestor && unsafeAncestor !== element) {
      return { ok: false, reason: '自定义选择控件位于可导航或表单动作控件内' };
    }
    if (isDangerousAction(element)) return { ok: false, reason: '控件文字包含禁止自动执行的动作' };
    return { ok: true, native: false, role };
  }

  async function setChecked(target, checked = true) {
    const { element } = elementAndKind(target);
    const beforeValue = readControlValue(target);
    if (!element) return { ok: false, beforeValue, afterValue: beforeValue, reason: '选择字段不存在' };
    let safety = checkableSafety(element);
    if (!safety.ok) return { ok: false, beforeValue, afterValue: beforeValue, reason: safety.reason };
    if (element.disabled || element.getAttribute?.('aria-disabled') === 'true') {
      return { ok: false, beforeValue, afterValue: beforeValue, reason: '选择字段已禁用' };
    }
    try {
      const desired = Boolean(checked);
      const current = Boolean(element.checked || element.getAttribute?.('aria-checked') === 'true');
      activate(element);
      // React 对 checkbox/radio 的 onChange 通常由真实 click 插件触发；仅在状态需要变化时点击，
      // 随后仍用原生 checked setter 固定目标状态，避免受控组件的默认动作造成反向切换。
      // Pointer/focus handlers may synchronously mutate or replace a target. Revalidate
      // the exact live element immediately before invoking its real click handler.
      safety = checkableSafety(element);
      if (!safety.ok) return { ok: false, beforeValue, afterValue: readControlValue(target), reason: safety.reason };
      if (current !== desired && typeof element.click === 'function') {
        dispatch(element, 'mouseup', { button: 0, buttons: 0 });
        element.click();
      }
      if (safety.native) setNativeProperty(element, 'checked', desired);
      if (element.setAttribute) element.setAttribute('aria-checked', String(desired));
      dispatch(element, 'input');
      dispatch(element, 'change');
      try { element.blur?.(); } catch (_) { /* ignored */ }
      dispatch(element, 'blur');
      await nextRender(element);
      const actual = Boolean(element.checked || element.getAttribute?.('aria-checked') === 'true');
      return actual === desired
        ? { ok: true, beforeValue, afterValue: readControlValue(target), reason: '' }
        : { ok: false, beforeValue, afterValue: readControlValue(target), reason: '页面未接受选中状态' };
    } catch (error) {
      return { ok: false, beforeValue, afterValue: readControlValue(target), reason: error?.message || '触发选择事件失败' };
    }
  }

  const CLICK_PURPOSES = Object.freeze(new Set([
    'cascader-trigger',
    'cascader-option',
    'custom-select-trigger',
    'custom-select-option',
    'date-picker-trigger',
    'date-picker-mode-switch',
    'date-picker-navigation',
    'date-picker-option',
  ]));
  const CUSTOM_TRIGGER_HINT = /(?:select|dropdown|combobox|combo-box|jqx|选择|下拉)/i;
  const CUSTOM_OPTION_HINT = /(?:option|listitem|menu-item|select-item|dropdown-item|jqx-listitem|选项)/i;
  const CASCADER_TRIGGER_HINT = /(?:ant|el)[-_]?cascader|hierarchical[-_ ]?picker|级联|省市区|省\/市\/区/i;
  const CASCADER_OPTION_HINT = /(?:ant-cascader-menu-item|el-cascader-node|cascader[-_ ]?(?:option|item|node))/i;
  // Token boundaries deliberately prevent words such as "update-profile" from
  // being mistaken for a date trigger merely because they contain "date".
  const DATE_CONTROL_HINT = /(?:^|[^a-z])(?:date(?:picker)?|calendar|month(?:picker)?|year(?:picker)?)(?:$|[^a-z])|(?:ant|arco)-picker|ivu-date-picker|el-date-editor|日期|日历|年月|月份|年份|选择日期|选择月份/i;
  const DATE_NAVIGATION_EXPLICIT = /(?:上一年|下一年|前一年|后一年|上个月|下个月|前一月|后一月|prev(?:ious)?\s+(?:year|month)|next\s+(?:year|month))/i;
  const DIRECTION_HINT = /(?:上一页|下一页|向左|向右|prev|previous|next|left|right|back|forward|chevron|arrow|‹|›|«|»)/i;
  const DATE_OPTION_TEXT = /^(?:(?:19|20)\d{2}年?|(?:0?[1-9]|1[0-2])月|(?:0?[1-9]|[12]\d|3[01])日?)$/;

  function attribute(element, name) {
    try { return element?.getAttribute?.(name); }
    catch (_) { return null; }
  }

  function clickText(element) {
    return [
      element?.textContent,
      element?.innerText,
      element?.value,
      attribute(element, 'aria-label'),
      attribute(element, 'title'),
    ].map(safeString).filter(Boolean).join(' ').trim();
  }

  function clickMetadata(element) {
    const className = element?.className?.baseVal ?? element?.className;
    return [
      clickText(element),
      element?.id,
      className,
      attribute(element, 'name'),
      attribute(element, 'data-role'),
      attribute(element, 'data-type'),
      attribute(element, 'aria-haspopup'),
      attribute(element, 'aria-controls'),
    ].map(safeString).filter(Boolean).join(' ').trim();
  }

  const CALENDAR_MODES = Object.freeze(new Set(['DAY', 'MONTH', 'YEAR']));
  const CALENDAR_OUTSIDE_MONTH_HINT = /(?:^|[-_\s])(?:outside|other|old|new|last|prev|next)(?:[-_\s]?month)?(?:$|[-_\s])/i;
  const CALENDAR_DISABLED_HINT = /(?:^|[-_\s])disabled(?:$|[-_\s])/i;

  function visibleClickOwner(ownerPanel) {
    if (!ownerPanel || ownerPanel.isConnected === false) return false;
    const visited = new Set();
    for (let current = ownerPanel; current && !visited.has(current); current = current.parentElement) {
      visited.add(current);
      if (current.isConnected === false || current.hidden || attribute(current, 'aria-hidden') === 'true') return false;
      try {
        const style = current.ownerDocument?.defaultView?.getComputedStyle?.(current);
        if (style && (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0')) return false;
      } catch (_) { return false; }
    }
    const rect = ownerPanel.getBoundingClientRect?.();
    return !rect || rect.width > 0 || rect.height > 0;
  }

  function cascaderDisabledWithin(element, ownerPanel) {
    const visited = new Set();
    for (let current = element; current && !visited.has(current); current = current.parentElement) {
      visited.add(current);
      const className = safeString(current?.className?.baseVal ?? current?.className);
      if (current.disabled || attribute(current, 'aria-disabled') === 'true'
        || CASCADER_DISABLED_CLASS.test(className)) return true;
      if (current === ownerPanel) break;
    }
    return false;
  }

  function canonicalCascaderMenus(ownerPanel) {
    return queryAll(ownerPanel, CASCADER_MENU_SELECTOR).filter(menu => {
      if (!visibleClickOwner(menu)) return false;
      for (let current = menu.parentElement; current && current !== ownerPanel; current = current.parentElement) {
        if (current.matches?.(CASCADER_MENU_SELECTOR)) return false;
      }
      return true;
    });
  }

  function directText(element) {
    return safeString(Array.from(element?.childNodes || [])
      .filter(node => node?.nodeType === 3)
      .map(node => node.textContent)
      .join(' ')).trim();
  }

  function cascaderOptionLabelSources(element) {
    const explicitLabel = element?.querySelector?.(CASCADER_OPTION_LABEL_SELECTOR);
    const hasNestedOption = queryAll(element, CASCADER_OPTION_SELECTOR).length > 0;
    return [...new Set([
      explicitLabel?.textContent,
      attribute(element, 'aria-label'),
      attribute(element, 'data-label'),
      attribute(element, 'data-value'),
      directText(element),
      ...(!explicitLabel && !hasNestedOption ? [element?.textContent, element?.innerText, element?.value, attribute(element, 'title')] : []),
    ].map(value => safeString(value).replace(/\s+/g, '')).filter(Boolean))];
  }

  function cascaderTriggerPurposeMatches(element, settings = {}) {
    const ownerField = settings.ownerField;
    const trigger = settings.trigger || element;
    if (!visibleClickOwner(ownerField) || trigger !== element) return false;
    try {
      if (ownerField !== element && !ownerField.contains?.(element)) return false;
    } catch (_) { return false; }
    const tag = safeString(element?.tagName).toLowerCase();
    const type = safeString(element?.type || attribute(element, 'type')).toLowerCase();
    const role = safeString(attribute(element, 'role')).toLowerCase();
    const popup = safeString(attribute(element, 'aria-haspopup')).toLowerCase();
    if (['submit', 'reset', 'file', 'image', 'hidden', 'date', 'month'].includes(type)) return false;
    return ['input', 'div', 'span'].includes(tag)
      || (tag === 'button' && type === 'button')
      || role === 'combobox'
      || ['tree', 'menu'].includes(popup)
      || CASCADER_TRIGGER_HINT.test(`${clickMetadata(element)} ${clickMetadata(ownerField)}`);
  }

  function cascaderOptionPurposeMatches(element, settings = {}) {
    const ownerPanel = settings.ownerPanel;
    const ownerMenu = settings.ownerMenu;
    const level = Number(settings.level);
    if (!visibleClickOwner(ownerPanel) || !visibleClickOwner(ownerMenu) || !visibleClickOwner(element)
      || !Number.isInteger(level) || level < 0 || level > 9) return false;
    try {
      if (!ownerPanel.contains?.(ownerMenu) || !ownerMenu.contains?.(element)) return false;
    } catch (_) { return false; }
    if (cascaderDisabledWithin(element, ownerPanel)) return false;
    const canonicalMenus = canonicalCascaderMenus(ownerPanel);
    if (canonicalMenus[level] !== ownerMenu) return false;
    const declaredOwners = canonicalMenus.filter(menu => {
      const declared = safeString(attribute(menu, 'data-cascader-level'));
      return declared && Number(declared) === level;
    });
    if (declaredOwners.length > 1
      || (declaredOwners.length === 1 && declaredOwners[0] !== ownerMenu)) return false;
    const rawLevel = attribute(ownerMenu, 'data-cascader-level')
      ?? attribute(element, 'data-cascader-level');
    if (rawLevel !== null && rawLevel !== '') {
      const explicitLevel = Number(rawLevel);
      if (!Number.isInteger(explicitLevel) || explicitLevel !== level) return false;
    }
    const expected = safeString(settings.expectedOptionLabel).replace(/\s+/g, '');
    if (expected) {
      const actualCandidates = cascaderOptionLabelSources(element);
      if (!actualCandidates.includes(expected)) return false;
    }
    const role = safeString(attribute(element, 'role')).toLowerCase();
    return ['option', 'menuitem', 'treeitem'].includes(role)
      || attribute(element, 'data-value') !== null
      || CASCADER_OPTION_HINT.test(clickMetadata(element));
  }

  function ownedCalendarAction(element, settings = {}) {
    const ownerPanel = settings.ownerPanel;
    if (!visibleClickOwner(ownerPanel)) return false;
    try {
      if (!ownerPanel.contains?.(element)) return false;
    } catch (_) { return false; }
    return true;
  }

  function calendarModeMatches(settings = {}) {
    const ownerPanel = settings.ownerPanel;
    const calendarMode = safeString(settings.calendarMode).toUpperCase();
    if (!CALENDAR_MODES.has(calendarMode)) return false;
    const explicitMode = safeString(
      attribute(ownerPanel, 'data-calendar-mode')
      || attribute(ownerPanel, 'data-picker-mode')
      || attribute(ownerPanel, 'data-panel-mode'),
    ).toUpperCase();
    return !explicitMode || explicitMode === calendarMode;
  }

  function calendarOptionAncestorsAreSafe(element, settings = {}) {
    const ownerPanel = settings.ownerPanel;
    const mode = safeString(settings.calendarMode).toUpperCase();
    let node = element;
    while (node) {
      const className = safeString(node?.className?.baseVal ?? node?.className);
      if (node.disabled || attribute(node, 'aria-disabled') === 'true'
        || CALENDAR_DISABLED_HINT.test(className)) return false;
      if (mode === 'DAY' && (CALENDAR_OUTSIDE_MONTH_HINT.test(className)
        || attribute(node, 'data-outside-month') === 'true'
        || attribute(node, 'data-current-month') === 'false')) return false;
      if (node === ownerPanel) return true;
      node = node.parentElement;
    }
    try { return Boolean(ownerPanel?.contains?.(element)); }
    catch (_) { return false; }
  }

  function exactCalendarPart(element, mode) {
    const attributeName = mode === 'YEAR'
      ? 'data-calendar-year-option'
      : mode === 'MONTH' ? 'data-calendar-month-option' : 'data-calendar-day-option';
    const explicit = Number(attribute(element, attributeName));
    if (mode === 'YEAR' && Number.isInteger(explicit) && explicit >= 1900 && explicit <= 2199) return explicit;
    if (mode !== 'YEAR' && Number.isInteger(explicit) && explicit >= 1 && explicit <= (mode === 'MONTH' ? 12 : 31)) return explicit;
    const values = [
      element?.textContent,
      element?.innerText,
      element?.value,
      attribute(element, 'aria-label'),
      attribute(element, 'title'),
    ].map(value => safeString(value).replace(/\s+/g, '')).filter(Boolean);
    for (const value of values) {
      const match = mode === 'YEAR'
        ? value.match(/^((?:19|20|21)\d{2})年?$/)
        : mode === 'MONTH'
          ? value.replace(/^0/, '').match(/^(1[0-2]|[1-9])月$/)
          : value.replace(/^0/, '').match(/^([12]\d|3[01]|[1-9])日?$/);
      if (match) return Number(match[1]);
    }
    return null;
  }

  function dateOptionPurposeMatches(element, settings = {}) {
    if (!ownedCalendarAction(element, settings) || !calendarModeMatches(settings)
      || !calendarOptionAncestorsAreSafe(element, settings)) return false;
    const mode = safeString(settings.calendarMode).toUpperCase();
    const expectedPart = Number(settings.expectedPart);
    if (!Number.isInteger(expectedPart) || exactCalendarPart(element, mode) !== expectedPart) return false;
    if (typeof settings.liveOwnerGuard === 'function') {
      try {
        if (settings.liveOwnerGuard() !== true) return false;
      } catch (_) {
        return false;
      }
    }
    const role = safeString(attribute(element, 'role')).toLowerCase();
    const metadata = clickMetadata(element);
    const className = safeString(element?.className?.baseVal ?? element?.className);
    const legacyAntCell = mode === 'YEAR'
      ? /(?:^|\s)ant-calendar-year-panel-cell(?:\s|$)/i.test(className)
      : mode === 'MONTH' && /(?:^|\s)ant-calendar-month-panel-cell(?:\s|$)/i.test(className);
    return ['gridcell', 'option'].includes(role)
      || /(?:date|day|month|year|calendar|picker)[-_ ]?(?:cell|option|item)/i.test(metadata)
      || legacyAntCell
      || attribute(element, mode === 'YEAR'
        ? 'data-calendar-year-option'
        : mode === 'MONTH' ? 'data-calendar-month-option' : 'data-calendar-day-option') !== null;
  }

  function dateModeSwitchPurposeMatches(element, settings = {}) {
    if (!ownedCalendarAction(element, settings) || !calendarModeMatches(settings)) return false;
    const targetMode = safeString(settings.targetMode).toUpperCase();
    if (safeString(settings.calendarMode).toUpperCase() !== 'DAY'
      || !['MONTH', 'YEAR'].includes(targetMode)) return false;
    const explicit = safeString(attribute(element, 'data-calendar-mode-switch')).toUpperCase();
    if (explicit && explicit !== targetMode) return false;
    const metadata = clickMetadata(element);
    const labels = [
      element?.textContent,
      element?.innerText,
      attribute(element, 'aria-label'),
      attribute(element, 'title'),
    ].map(value => safeString(value).trim()).filter(Boolean);
    const structural = targetMode === 'MONTH'
      ? /(?:ant-picker-month-btn|ant-calendar-month-select|month[-_ ]?(?:select|btn|switch))/i
      : /(?:ant-picker-year-btn|ant-calendar-year-select|year[-_ ]?(?:select|btn|switch))/i;
    const semantic = targetMode === 'MONTH'
      ? /^(?:(?:0?[1-9]|1[0-2])月|月份|选择月份|month)/i
      : /^(?:(?:19|20|21)\d{2}年?|年份|选择年份|year)/i;
    if (!explicit && (!structural.test(metadata) || !labels.some(value => semantic.test(value)))) return false;
    if (typeof settings.liveOwnerGuard === 'function') {
      try {
        if (settings.liveOwnerGuard() !== true) return false;
      } catch (_) {
        return false;
      }
    }
    return true;
  }

  const INERT_CALENDAR_ANCHOR_HREF = /^(?:#|javascript:\s*(?:void\s*\(\s*0\s*\)|;)\s*;?)$/i;

  function exactDateModeSwitchClass(element, targetMode) {
    const className = safeString(element?.className?.baseVal ?? element?.className);
    const expected = targetMode === 'MONTH'
      ? /(?:^|\s)(?:ant-calendar-month-select|ant-picker-month-btn)(?:\s|$)/i
      : targetMode === 'YEAR'
        ? /(?:^|\s)(?:ant-calendar-year-select|ant-picker-year-btn)(?:\s|$)/i
        : null;
    return Boolean(expected?.test(className));
  }

  function dateModeSwitchSemanticMatches(element, targetMode) {
    const labels = [
      element?.textContent,
      element?.innerText,
      attribute(element, 'aria-label'),
      attribute(element, 'title'),
    ].map(value => safeString(value).trim()).filter(Boolean);
    const semantic = targetMode === 'MONTH'
      ? /^(?:(?:0?[1-9]|1[0-2])月|月份|选择月份|month)/i
      : targetMode === 'YEAR'
        ? /^(?:(?:19|20|21)\d{2}年?|年份|选择年份|year)/i
        : null;
    return Boolean(semantic && labels.some(value => semantic.test(value)));
  }

  function trustedCalendarModeSwitchAssessment(element, settings = {}) {
    const tag = safeString(element?.tagName).toLowerCase();
    const type = safeString(element?.type || attribute(element, 'type')).toLowerCase();
    const role = safeString(attribute(element, 'role')).toLowerCase();
    const ownerPanel = settings.ownerPanel;
    const targetMode = safeString(settings.targetMode).toUpperCase();
    const extensionSelector = '#__jf_panel__,#__jf_modal__,#__rf_panel__,#__rf_trigger__,[data-jiefang-ui]';
    const treeRoot = element?.getRootNode?.();
    const extensionHostId = safeString(treeRoot?.host?.id);

    if (!element || element.isConnected === false) return { ok: false, reason: 'DETACHED', inertHref: false };
    if (element.hidden || attribute(element, 'aria-hidden') === 'true' || !visibleClickOwner(element)) {
      return { ok: false, reason: 'DETACHED', inertHref: false };
    }
    if (element.disabled || attribute(element, 'aria-disabled') === 'true') {
      return { ok: false, reason: 'DISABLED', inertHref: false };
    }
    if (['__jf_panel__', '__jf_modal__', '__rf_panel__', '__rf_trigger__'].includes(extensionHostId)
      || treeRoot?.host?.matches?.('[data-jiefang-ui]')
      || element.closest?.(extensionSelector)) {
      return { ok: false, reason: 'DANGEROUS_ACTION', inertHref: false };
    }
    if (!visibleClickOwner(ownerPanel)) return { ok: false, reason: 'OWNER_MISMATCH', inertHref: false };
    try {
      if (!ownerPanel.contains?.(element)) return { ok: false, reason: 'OWNER_MISMATCH', inertHref: false };
    } catch (_) {
      return { ok: false, reason: 'OWNER_MISMATCH', inertHref: false };
    }
    const explicit = safeString(attribute(element, 'data-calendar-mode-switch')).toUpperCase();
    if (safeString(settings.calendarMode).toUpperCase() !== 'DAY'
      || !['MONTH', 'YEAR'].includes(targetMode)
      || !calendarModeMatches(settings)
      || (explicit && explicit !== targetMode)
      || !dateModeSwitchSemanticMatches(element, targetMode)) {
      return { ok: false, reason: 'MODE_MISMATCH', inertHref: false };
    }
    if (!exactDateModeSwitchClass(element, targetMode)) {
      return {
        ok: false,
        reason: tag === 'a' && role !== 'button' ? 'LINK_ROLE_MISSING' : 'MODE_MISMATCH',
        inertHref: false,
      };
    }
    if (typeof settings.liveOwnerGuard !== 'function') {
      return { ok: false, reason: 'LIVE_GUARD_FAILED', inertHref: false };
    }
    try {
      if (settings.liveOwnerGuard() !== true) {
        return { ok: false, reason: 'LIVE_GUARD_FAILED', inertHref: false };
      }
    } catch (_) {
      return { ok: false, reason: 'LIVE_GUARD_FAILED', inertHref: false };
    }
    if (attribute(element, 'formaction') !== null) {
      return { ok: false, reason: 'FORM_ACTION_PRESENT', inertHref: false };
    }
    if (attribute(element, 'onclick') !== null || typeof element?.onclick === 'function') {
      return { ok: false, reason: 'INLINE_HANDLER_PRESENT', inertHref: false };
    }
    if (['submit', 'reset', 'file', 'image', 'hidden'].includes(type)
      || (tag === 'button' && type !== 'button')) {
      return { ok: false, reason: 'DANGEROUS_ACTION', inertHref: false };
    }
    if (role === 'link' || (tag === 'a' && role && role !== 'button')) {
      return { ok: false, reason: 'LINK_ROLE_MISSING', inertHref: false };
    }
    const rawHref = attribute(element, 'href');
    const inertHref = tag === 'a'
      && rawHref !== null
      && INERT_CALENDAR_ANCHOR_HREF.test(safeString(rawHref).trim());
    if (rawHref !== null && !inertHref) {
      return { ok: false, reason: 'HREF_PRESENT', inertHref: false };
    }
    if (isDangerousAction(element) && !inertHref) {
      return { ok: false, reason: 'DANGEROUS_ACTION', inertHref: false };
    }
    return { ok: true, reason: '', inertHref };
  }

  function dateNavigationPurposeMatches(element, settings = {}) {
    if (!ownedCalendarAction(element, settings) || !calendarModeMatches(settings)) return false;
    const unit = safeString(settings.navigationUnit).toLowerCase();
    const direction = Number(settings.direction);
    if (!['year', 'month', 'decade'].includes(unit) || ![-1, 1].includes(direction)) return false;
    const metadata = clickMetadata(element);
    const explicit = safeString(attribute(element, 'data-calendar-nav')).toLowerCase();
    const expected = `${direction < 0 ? 'previous' : 'next'}-${unit}`;
    if (explicit) return explicit === expected;
    const mode = safeString(settings.calendarMode).toUpperCase();
    const patterns = unit === 'year'
      ? (direction < 0
        ? /上一年|前一年|prev(?:ious)?\s*year|(?:ant-calendar-prev-year-btn|prev[-_ ]?year|previous[-_ ]?year)/i
        : /下一年|后一年|next\s*year|(?:ant-calendar-next-year-btn|next[-_ ]?year)/i)
      : unit === 'month'
        ? (direction < 0
          ? /上个月|前一月|prev(?:ious)?\s*month|ant-calendar-prev-month-btn|ant-picker-header-prev-btn/i
          : /下个月|后一月|next\s*month|ant-calendar-next-month-btn|ant-picker-header-next-btn/i)
        : (direction < 0
          ? /上一组年份|前十年|prev(?:ious)?\s*decade|prev[-_ ]?(?:decade|years)/i
          : /下一组年份|后十年|next\s*decade|next[-_ ]?(?:decade|years)/i);
    if (patterns.test(metadata)) return true;
    // Ant's super-prev/super-next denotes decade movement in a YEAR panel,
    // but year movement in a MONTH panel. Keep that interpretation mode-bound.
    if (unit === 'year' && mode === 'MONTH') {
      return (direction < 0 ? /ant-picker-header-super-prev-btn/i : /ant-picker-header-super-next-btn/i).test(metadata);
    }
    return unit === 'decade' && mode === 'YEAR'
      && (direction < 0 ? /ant-picker-header-super-prev-btn/i : /ant-picker-header-super-next-btn/i).test(metadata);
  }

  function purposeMatches(element, purpose, settings = {}) {
    const tag = safeString(element?.tagName).toLowerCase();
    const type = safeString(element?.type || attribute(element, 'type')).toLowerCase();
    const role = safeString(attribute(element, 'role')).toLowerCase();
    const popup = safeString(attribute(element, 'aria-haspopup')).toLowerCase();
    const metadata = clickMetadata(element);
    const parentMetadata = clickMetadata(element?.parentElement);
    const optionTexts = [
      element?.textContent,
      element?.innerText,
      element?.value,
      attribute(element, 'aria-label'),
      attribute(element, 'title'),
    ].map(value => safeString(value).replace(/\s+/g, '')).filter(Boolean);

    if (purpose === 'cascader-trigger') {
      return cascaderTriggerPurposeMatches(element, settings);
    }
    if (purpose === 'cascader-option') {
      return cascaderOptionPurposeMatches(element, settings);
    }
    if (purpose === 'custom-select-trigger') {
      return role === 'combobox'
        || ['listbox', 'menu'].includes(popup)
        || CUSTOM_TRIGGER_HINT.test(metadata);
    }
    if (purpose === 'custom-select-option') {
      return tag === 'option'
        || ['option', 'menuitem'].includes(role)
        || attribute(element, 'data-value') !== null
        || CUSTOM_OPTION_HINT.test(metadata);
    }
    if (purpose === 'date-picker-trigger') {
      return ['date', 'month'].includes(type)
        || DATE_CONTROL_HINT.test(metadata);
    }
    if (purpose === 'date-picker-mode-switch') {
      return dateModeSwitchPurposeMatches(element, settings);
    }
    if (purpose === 'date-picker-navigation') {
      return dateNavigationPurposeMatches(element, settings);
    }
    if (purpose === 'date-picker-option') {
      return dateOptionPurposeMatches(element, settings);
    }
    return false;
  }

  function scopedDateControlOverride(element, purpose, settings = {}) {
    if (purpose === 'date-picker-mode-switch') {
      return trustedCalendarModeSwitchAssessment(element, settings).ok;
    }
    const exactPurpose = purpose === 'date-picker-navigation'
      ? dateNavigationPurposeMatches(element, settings)
      : false;
    if (!exactPurpose) return false;
    const tag = safeString(element?.tagName).toLowerCase();
    const type = safeString(element?.type || attribute(element, 'type')).toLowerCase();
    const role = safeString(attribute(element, 'role')).toLowerCase();
    const hasSafeAttributes = attribute(element, 'href') === null
      && attribute(element, 'formaction') === null
      && attribute(element, 'onclick') === null
      && typeof element?.onclick !== 'function';
    if (!hasSafeAttributes) return false;
    if (tag === 'button') return type === 'button';
    if (tag !== 'a' || role !== 'button') return false;
    const className = safeString(element?.className?.baseVal ?? element?.className);
    return /(?:^|\s)(?:ant-calendar-(?:prev|next)-(?:month|year)-btn|ant-picker-header-(?:super-)?(?:prev|next)-btn)(?:\s|$)/i.test(className)
      || attribute(element, 'data-calendar-nav') !== null;
  }

  function clickSafety(element, purpose, settings = {}) {
    if (!element || !CLICK_PURPOSES.has(purpose)) return false;
    const extensionSelector = '#__jf_panel__,#__jf_modal__,#__rf_panel__,#__rf_trigger__,[data-jiefang-ui]';
    const treeRoot = element.getRootNode?.();
    const extensionHostId = safeString(treeRoot?.host?.id);
    if (['__jf_panel__', '__jf_modal__', '__rf_panel__', '__rf_trigger__'].includes(extensionHostId)
      || treeRoot?.host?.matches?.('[data-jiefang-ui]')
      || element.closest?.(extensionSelector)) return false;
    if (element.isConnected === false || element.hidden || attribute(element, 'aria-hidden') === 'true') return false;
    if (element.disabled || attribute(element, 'aria-disabled') === 'true') return false;

    const action = element.closest?.('a,[role="link"],button,[role="button"],input,[formaction]') || element;
    const purposeAllowed = purposeMatches(element, purpose, settings)
      || (action !== element && purposeMatches(action, purpose, settings));
    if (!purposeAllowed) return false;
    const nodes = action === element ? [element] : [element, action];
    for (const node of nodes) {
      const tag = safeString(node?.tagName).toLowerCase();
      const type = safeString(node?.type || attribute(node, 'type')).toLowerCase();
      const role = safeString(attribute(node, 'role')).toLowerCase();
      const scopedDateControl = scopedDateControlOverride(node, purpose, settings);
      if ((tag === 'a' || role === 'link') && !scopedDateControl) return false;
      const href = attribute(node, 'href');
      const trustedInertCalendarHref = purpose === 'date-picker-mode-switch'
        && scopedDateControl
        && href !== null
        && INERT_CALENDAR_ANCHOR_HREF.test(safeString(href).trim());
      if ((href !== null && !trustedInertCalendarHref) || attribute(node, 'formaction') !== null) return false;
      if (node?.disabled || node?.hidden || attribute(node, 'aria-disabled') === 'true' || attribute(node, 'aria-hidden') === 'true') return false;
      if (['submit', 'reset', 'file', 'image', 'hidden'].includes(type)) return false;
      if (tag === 'button' && type !== 'button') return false;
      if (isDangerousAction(node) && !scopedDateControl) return false;
    }
    return true;
  }

  function clickSafetyReason(element, settings = {}) {
    const purpose = safeString(settings.purpose);
    if (clickSafety(element, purpose, settings)) return '';
    if (purpose !== 'date-picker-mode-switch') return 'DANGEROUS_ACTION';
    const action = element?.closest?.('a,[role="link"],button,[role="button"],input,[formaction]') || element;
    const candidates = action === element ? [element] : [element, action];
    for (const candidate of candidates) {
      const assessment = trustedCalendarModeSwitchAssessment(candidate, settings);
      if (assessment.reason && assessment.reason !== 'MODE_MISMATCH') return assessment.reason;
    }
    return trustedCalendarModeSwitchAssessment(element, settings).reason || 'DANGEROUS_ACTION';
  }

  function dispatchCanceledSyntheticClick(element) {
    if (!element?.dispatchEvent) return false;
    try {
      const event = createEvent(element, 'click', { button: 0, buttons: 0 });
      if (typeof event?.preventDefault !== 'function') return false;
      event.preventDefault();
      if (!event.defaultPrevented) return false;
      element.dispatchEvent(event);
      return true;
    } catch (_) {
      return false;
    }
  }

  function clickLikeUser(element, settings = {}) {
    if (!element) return false;
    const purpose = safeString(settings.purpose);
    if (!clickSafety(element, purpose, settings)) return false;
    try {
      try { element.focus?.({ preventScroll: true }); } catch (_) { /* ignored */ }
      dispatch(element, 'pointerdown', { pointerType: 'mouse', button: 0, buttons: 1, isPrimary: true });
      dispatch(element, 'mousedown', { button: 0, buttons: 1 });
      // Pointer handlers can synchronously replace or repurpose a node. Re-check the
      // exact live target immediately before invoking its real click handler.
      if (!clickSafety(element, purpose, settings)) return false;
      dispatch(element, 'mouseup', { button: 0, buttons: 0 });
      // Mouseup handlers can also synchronously disable, detach, navigate, or
      // move a calendar target outside its owned/current panel. Close that final
      // TOCTOU window before invoking the element's real click handler.
      if (!clickSafety(element, purpose, settings)) return false;
      const clickAction = element.closest?.('a,[role="link"],button,[role="button"],input,[formaction]') || element;
      const trustedModeSwitches = purpose === 'date-picker-mode-switch'
        ? [...new Set([element, clickAction])].map(candidate => trustedCalendarModeSwitchAssessment(candidate, settings))
        : [];
      if (trustedModeSwitches.some(assessment => assessment.ok && assessment.inertHref)) {
        if (!dispatchCanceledSyntheticClick(element)) return false;
      } else if (typeof element.click === 'function') element.click();
      else dispatch(element, 'click', { button: 0, buttons: 0 });
      return true;
    } catch (_) {
      return false;
    }
  }

  function canClickLikeUser(element, settings = {}) {
    return clickSafety(element, safeString(settings.purpose), settings);
  }

  return {
    activate,
    canClickLikeUser,
    clickSafetyReason,
    clickLikeUser,
    controlKind,
    createEvent,
    dispatch,
    findNativeSetter,
    readControlValue,
    setChecked,
    setNativeProperty,
    setNativeSelect,
    setNativeValue,
    prohibitedControlReason,
  };
});
