/* 解放：上传字段检测。SPDX-License-Identifier: MIT */
(function initFileFieldDetector(root, factory) {
  let aliases = root?.JFFileFieldAliases;
  if (!aliases && typeof require === 'function') {
    try { aliases = require('../mappings/file-field-aliases.js'); } catch (_) { /* browser */ }
  }
  const api = factory(aliases);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.JFFileFieldDetector = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function fileFieldDetectorFactory(FileAliases) {
  'use strict';

  function text(value) { return String(value ?? '').replace(/\s+/g, ' ').trim(); }
  function sanitizeDiagnosticText(value, maxLength = 240) {
    const limit = Math.max(0, Math.min(1_000, Number(maxLength) || 240));
    const source = text(value);
    // 路径和真实文件名可能包含空格。逐词替换会残留姓名/目录片段，因此一旦
    // 检出本地路径或非纯扩展名列表，就将整段诊断文本降为固定占位符。
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
  function visible(element) {
    if (!element?.isConnected) return false;
    const style = element.ownerDocument?.defaultView?.getComputedStyle?.(element);
    return !(element.hidden || element.getAttribute?.('aria-hidden') === 'true' || style?.display === 'none' || style?.visibility === 'hidden');
  }
  function labelFor(input) {
    const doc = input.ownerDocument;
    if (input.id) {
      try { const label = doc.querySelector(`label[for="${CSS.escape(input.id)}"]`); if (label) return text(label.textContent); } catch (_) { /* invalid id */ }
    }
    return text(input.closest('label')?.textContent || input.getAttribute('aria-label') || input.title);
  }
  function contextFor(input, wrapper) {
    const parts = [labelFor(input), input.getAttribute('aria-label'), input.title, input.name, input.id];
    let current = wrapper || input.parentElement;
    for (let depth = 0; current && depth < 3; depth += 1, current = current.parentElement) {
      const clone = current.cloneNode(true);
      clone.querySelectorAll?.('input,textarea,select,button,script,style').forEach(node => node.remove());
      const value = text(clone.textContent);
      if (value && value.length <= 500) parts.push(value);
    }
    return [...new Set(parts.map(text).filter(Boolean))].join(' · ').slice(0, 1200);
  }
  function parseSizeLimit(source) {
    const matches = [...source.matchAll(/(?:最大|不超过|小于|≤|限)[^\d]{0,8}(\d+(?:\.\d+)?)\s*(KB|MB|GB)/ig)];
    if (!matches.length) return 0;
    const units = { KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3 };
    return Math.min(...matches.map(match => Number(match[1]) * units[match[2].toUpperCase()]));
  }
  function parseCountLimit(source, input) {
    if (!input.multiple) return 1;
    const match = source.match(/(?:最多|不超过|限)[^\d]{0,6}(\d+)\s*(?:个|份|件|张)/);
    return match ? Number(match[1]) : 0;
  }
  function parseExtensions(input, source) {
    const values = [];
    text(input.accept).split(',').forEach(value => {
      const normalized = value.trim().toLowerCase();
      if (normalized.startsWith('.')) values.push(normalized.slice(1));
      else if (normalized === 'application/pdf') values.push('pdf');
      else if (normalized.includes('jpeg')) values.push('jpg', 'jpeg');
      else if (normalized.includes('png')) values.push('png');
      else if (normalized.includes('wordprocessingml')) values.push('docx');
    });
    for (const match of source.matchAll(/\b(PDF|JPG|JPEG|PNG|DOCX)\b/ig)) values.push(match[1].toLowerCase());
    return [...new Set(values)];
  }
  function descriptor(input, index) {
    const wrapper = input.closest('[class*="upload"],[class*="Upload"],[class*="drop"],[class*="Drop"],[role="button"],label,.form-item,.form-group,[class*="form-item"]') || input.parentElement;
    const contextText = contextFor(input, wrapper);
    const ranking = FileAliases?.rankFileFields?.(contextText) || [];
    return {
      index, element: input, wrapper, tagName: 'input', type: 'file', contextText,
      labelText: labelFor(input), name: text(input.name), id: text(input.id),
      accept: text(input.accept), multiple: Boolean(input.multiple), disabled: Boolean(input.disabled),
      hiddenInput: !visible(input), visibleWrapper: visible(wrapper),
      restrictions: {
        extensions: parseExtensions(input, contextText),
        maxBytes: parseSizeLimit(contextText),
        maxCount: parseCountLimit(contextText, input),
      },
      recommendations: ranking.slice(0, 3),
    };
  }
  function scan(rootNode = document) {
    const inputs = [...rootNode.querySelectorAll('input[type="file"]')]
      .filter(input => !input.disabled && !input.closest('#__jf_panel__,#__jf_modal__'));
    return inputs.map(descriptor);
  }
  function toDiagnostic(field) {
    return {
      index: Number(field.index) || 0,
      type: 'file',
      label: sanitizeDiagnosticText(field.labelText),
      name: sanitizeDiagnosticText(field.name),
      id: sanitizeDiagnosticText(field.id),
      accept: sanitizeDiagnosticText(field.accept),
      multiple: Boolean(field.multiple),
      disabled: Boolean(field.disabled),
      hiddenInput: Boolean(field.hiddenInput),
      visibleWrapper: Boolean(field.visibleWrapper),
      restrictions: {
        extensions: (field.restrictions?.extensions || []).map(value => sanitizeDiagnosticText(value, 20)).slice(0, 20),
        maxBytes: Math.max(0, Number(field.restrictions?.maxBytes) || 0),
        maxCount: Math.max(0, Number(field.restrictions?.maxCount) || 0),
      },
      recommendedField: sanitizeDiagnosticText(field.recommendations?.[0]?.path || '', 120),
      score: Math.max(0, Math.min(100, Number(field.recommendations?.[0]?.score) || 0)),
    };
  }
  return { contextFor, parseCountLimit, parseExtensions, parseSizeLimit, sanitizeDiagnosticText, scan, toDiagnostic };
});
