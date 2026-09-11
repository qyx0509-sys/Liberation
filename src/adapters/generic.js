/*
 * 解放（基于 JobFill）通用 DOM 工具
 * Copyright (c) 2026 zlh and contributors
 * SPDX-License-Identifier: MIT
 */
(function initGenericAdapter(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.JFGeneric = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function genericFactory() {
  'use strict';

  const FIELD_LABELS = Object.freeze({
    time: ['时间', '日期', '获奖时间', '奖励时间'],
    location: ['地点', '获奖地点', '奖励地点'],
    content: ['内容', '奖励名称', '奖项名称', '获奖内容', '荣誉名称'],
  });

  function safeString(value) {
    if (value === null || value === undefined) return '';
    return String(value).trim();
  }

  function normalizeText(value) {
    return safeString(value).replace(/[\s\u00a0:：*（）()【】\[\]]+/g, '').toLowerCase();
  }

  function escapeHtml(value) {
    return safeString(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function isHidden(element) {
    if (!element || !element.isConnected) return true;
    if (element.hidden || element.getAttribute?.('aria-hidden') === 'true') return true;
    if (element.matches?.('input[type="hidden"]')) return true;
    const view = element.ownerDocument?.defaultView;
    const style = view?.getComputedStyle ? view.getComputedStyle(element) : null;
    if (style && (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0')) return true;
    const rect = element.getBoundingClientRect?.();
    if (rect && rect.width === 0 && rect.height === 0 && style?.position !== 'fixed') return true;
    return false;
  }

  function isEditableControl(element) {
    if (!element || isHidden(element) || element.disabled || element.readOnly) return false;
    if (element.matches?.('input[type="password"],input[type="file"],input[type="submit"],input[type="button"],input[type="reset"],button')) return false;
    return element.matches?.('input:not([type="hidden"]),textarea,select,[contenteditable="true"]') || false;
  }

  function readValue(element) {
    if (!element) return '';
    if (element.isContentEditable) return safeString(element.textContent);
    return safeString(element.value);
  }

  function dispatch(element, event) {
    try { element.dispatchEvent(event); } catch (_) { /* incompatible synthetic event */ }
  }

  function eventFor(element, type, init) {
    const view = element.ownerDocument?.defaultView || globalThis;
    const base = { bubbles: true, cancelable: true, ...init };
    if (type === 'pointerdown' && typeof view.PointerEvent === 'function') return new view.PointerEvent(type, base);
    if (type === 'mousedown' && typeof view.MouseEvent === 'function') return new view.MouseEvent(type, base);
    if (type === 'input' && typeof view.InputEvent === 'function') {
      return new view.InputEvent(type, { ...base, inputType: 'insertText', data: safeString(init?.data) });
    }
    if ((type === 'focus' || type === 'blur') && typeof view.FocusEvent === 'function') return new view.FocusEvent(type, base);
    return new view.Event(type, base);
  }

  function setThroughNativeSetter(element, value) {
    if (element.isContentEditable) {
      element.textContent = value;
      return;
    }
    const ownPrototype = element.constructor?.prototype;
    const descriptor = ownPrototype && Object.getOwnPropertyDescriptor(ownPrototype, 'value');
    const parentPrototype = Object.getPrototypeOf(element);
    const parentDescriptor = parentPrototype && Object.getOwnPropertyDescriptor(parentPrototype, 'value');
    const setter = descriptor?.set || parentDescriptor?.set;
    if (setter) setter.call(element, value);
    else element.value = value;
  }

  async function setNativeValue(element, rawValue) {
    const value = safeString(rawValue);
    const beforeValue = readValue(element);
    if (!element || isHidden(element)) return { ok: false, beforeValue, afterValue: beforeValue, reason: '字段不可见' };
    if (element.disabled) return { ok: false, beforeValue, afterValue: beforeValue, reason: '字段已禁用' };
    if (element.readOnly) return { ok: false, beforeValue, afterValue: beforeValue, reason: '字段为只读' };
    if (element.matches?.('input[type="password"],input[type="file"]')) {
      return { ok: false, beforeValue, afterValue: beforeValue, reason: '敏感或文件字段不允许自动填写' };
    }

    try {
      element.focus?.({ preventScroll: true });
      dispatch(element, eventFor(element, 'focus'));
      dispatch(element, eventFor(element, 'pointerdown', { button: 0, buttons: 1 }));
      dispatch(element, eventFor(element, 'mousedown', { button: 0, buttons: 1 }));
      setThroughNativeSetter(element, value);
      dispatch(element, eventFor(element, 'input', { data: value }));
      dispatch(element, eventFor(element, 'change'));
      element.blur?.();
      dispatch(element, eventFor(element, 'blur'));
      await Promise.resolve();
      await new Promise(resolve => setTimeout(resolve, 0));
      const afterValue = readValue(element);
      return afterValue === value
        ? { ok: true, beforeValue, afterValue, reason: '' }
        : { ok: false, beforeValue, afterValue, reason: '页面实际值与计划值不一致' };
    } catch (error) {
      return { ok: false, beforeValue, afterValue: readValue(element), reason: error?.message || '触发输入事件失败' };
    }
  }

  function directText(element) {
    if (!element) return '';
    return safeString([...element.childNodes || []]
      .filter(node => node.nodeType === 3)
      .map(node => node.textContent)
      .join(' '));
  }

  function associatedLabel(element) {
    if (!element) return '';
    const document = element.ownerDocument;
    if (element.id && document) {
      try {
        const label = document.querySelector(`label[for="${CSS.escape(element.id)}"]`);
        if (label) return safeString(label.textContent);
      } catch (_) { /* invalid id */ }
    }
    const wrappingLabel = element.closest?.('label');
    if (wrappingLabel) {
      const clone = wrappingLabel.cloneNode(true);
      clone.querySelectorAll?.('input,textarea,select,button').forEach(child => child.remove());
      const text = safeString(clone.textContent);
      if (text) return text;
    }
    const formItem = element.closest?.('[role="group"],.form-item,.form-group,[class*="form-item"],[class*="formItem"],[class*="field"]');
    const nearby = formItem?.querySelector?.('label,[class*="label"],[class*="title"]');
    if (nearby && !nearby.contains(element)) return safeString(nearby.textContent);
    return safeString(element.getAttribute?.('aria-label') || element.getAttribute?.('placeholder') || element.name || element.id);
  }

  function inferField(text) {
    const normalized = normalizeText(text);
    if (!normalized) return { field: null, confidence: 0 };
    let best = { field: null, confidence: 0 };
    Object.entries(FIELD_LABELS).forEach(([field, labels]) => {
      labels.forEach(label => {
        const candidate = normalizeText(label);
        const confidence = normalized === candidate ? 1 : normalized.includes(candidate) ? 0.86 : candidate.includes(normalized) ? 0.72 : 0;
        if (confidence > best.confidence) best = { field, confidence };
      });
    });
    return best;
  }

  function tableHeaderFor(element) {
    const cell = element?.closest?.('td,th');
    const row = cell?.parentElement;
    const table = cell?.closest?.('table');
    if (!cell || !row || !table) return '';
    const cells = [...row.children].filter(child => child.matches('td,th'));
    const index = cells.indexOf(cell);
    if (index < 0) return '';
    const headerRows = [...table.querySelectorAll('thead tr, tr')];
    for (const headerRow of headerRows) {
      const headers = [...headerRow.children].filter(child => child.matches('th'));
      if (headers.length > index) return safeString(headers[index].textContent);
    }
    return '';
  }

  function describeParent(element) {
    const parent = element?.closest?.('tr,[role="row"],[role="group"],.form-item,.form-group,[class*="row"],[class*="item"]') || element?.parentElement;
    if (!parent) return null;
    return {
      tag: parent.tagName?.toLowerCase() || '',
      id: safeString(parent.id).slice(0, 80),
      classes: safeString(typeof parent.className === 'string' ? parent.className : '').split(/\s+/).filter(Boolean).slice(0, 5),
      role: safeString(parent.getAttribute?.('role')),
      dataKeys: Object.keys(parent.dataset || {}).slice(0, 8),
    };
  }

  function sanitizeUrl(rawUrl) {
    try {
      const url = new URL(rawUrl);
      const keys = [...url.searchParams.keys()];
      url.search = '';
      const sensitiveKey = /cookie|session|token|auth|authorization|credential|password|secret|ticket|code|api.?key/i;
      keys.forEach(key => {
        if (!sensitiveKey.test(key)) url.searchParams.append(key, '<redacted>');
      });
      url.hash = '';
      return url.toString();
    } catch (_) {
      return safeString(rawUrl).split('#')[0].split('?')[0];
    }
  }

  function waitForMutation(rootNode, predicate, timeoutMs = 2500) {
    return new Promise(resolve => {
      if (predicate()) { resolve({ changed: false, matched: true }); return; }
      const view = rootNode?.ownerDocument?.defaultView || globalThis;
      const Observer = view.MutationObserver || globalThis.MutationObserver;
      if (typeof Observer !== 'function') { resolve({ changed: false, matched: false, reason: 'MutationObserver 不可用' }); return; }
      let changed = false;
      let finished = false;
      let timer;
      const finish = matched => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        observer.disconnect();
        resolve({ changed, matched });
      };
      const observer = new Observer(() => {
        changed = true;
        if (predicate()) finish(true);
      });
      observer.observe(rootNode, { childList: true, subtree: true });
      timer = setTimeout(() => finish(Boolean(predicate())), timeoutMs);
    });
  }

  function highlight(element, tone = 'manual') {
    if (!element) return;
    const colors = { success: '#16a34a', manual: '#d97706', failed: '#dc2626', skipped: '#64748b' };
    const color = colors[tone] || colors.manual;
    element.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
    element.style.outline = `3px solid ${color}`;
    element.style.outlineOffset = '2px';
    setTimeout(() => {
      element.style.outline = '';
      element.style.outlineOffset = '';
    }, 2400);
  }

  return {
    FIELD_LABELS,
    associatedLabel,
    describeParent,
    directText,
    escapeHtml,
    highlight,
    inferField,
    isEditableControl,
    isHidden,
    normalizeText,
    readValue,
    safeString,
    sanitizeUrl,
    setNativeValue,
    tableHeaderFor,
    waitForMutation,
  };
});
