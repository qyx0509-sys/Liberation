/*
 * 解放 — 网页“保存草稿”安全识别与用户触发处理器
 * Copyright (c) 2026 zlh and contributors
 * SPDX-License-Identifier: MIT
 */
(function initSaveHandler(root, factory) {
  let safety = root?.JFSafety;
  let pageReady = root?.JFPageReady;
  if (typeof require === 'function') {
    try { safety = safety || require('./safety.js'); } catch (_) { /* browser path */ }
    try { pageReady = pageReady || require('./page-ready.js'); } catch (_) { /* browser path */ }
  }
  const api = factory(safety, pageReady);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.JFSaveHandler = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function saveHandlerFactory(Safety, PageReady) {
  'use strict';

  const SAVE_CONTROL_SELECTOR = 'button,input[type="button"],input[type="submit"],[role="button"]';
  const MAX_CANDIDATES = 100;

  function safeString(value, maxLength = 160) {
    return String(value ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength);
  }

  function queryAll(rootNode, selector) {
    try { return [...(rootNode?.querySelectorAll?.(selector) || [])]; } catch (_) { return []; }
  }

  function isExtensionUi(element) {
    try { return Boolean(element?.closest?.('#__jf_panel__,#__jf_modal__,#__rf_panel__,[data-jiefang-ui]')); }
    catch (_) { return true; }
  }

  function classifySaveControl(element, options = {}) {
    if (!Safety?.isDangerousAction || !Safety?.isSafeSaveCandidate) throw new Error('JFSaveHandler requires JFSafety');
    const text = Safety.actionText(element);
    const normalized = Safety.normalizeActionText(text);
    const metadata = Safety.collectActionMetadata(element);
    if (Safety.isHiddenOrDisabled(element)) {
      return { kind: 'unavailable', mode: 'forbidden', safe: false, text, reasonCode: 'HIDDEN_OR_DISABLED' };
    }
    if (['button', 'input'].includes(metadata.tag) && ['submit', 'image'].includes(metadata.type)) {
      return {
        kind: 'submit-control', mode: 'forbidden', safe: false, text,
        reasonCode: 'SUBMIT_CAPABLE_SAVE_CONTROL_FORBIDDEN',
      };
    }
    if (/保存.*(?:下一步|提交|确认|完成|发送)|save.*(?:next|submit|confirm|finish|send)/i.test(normalized)) {
      return { kind: /下一步|next/i.test(normalized) ? 'save-next' : 'save-submit', mode: 'forbidden', safe: false, text, reasonCode: 'COMBINED_SAVE_ACTION_FORBIDDEN' };
    }
    if (Safety.isDangerousAction(element, { baseUrl: options.baseUrl })) {
      return { kind: 'dangerous', mode: 'forbidden', safe: false, text, reasonCode: 'DANGEROUS_ACTION_KEYWORD' };
    }
    if (!Safety.isSafeSaveCandidate(element, { baseUrl: options.baseUrl })) {
      return { kind: 'unknown', mode: 'passive-only', safe: false, text, reasonCode: 'NOT_EXACT_SAFE_SAVE' };
    }
    return {
      kind: normalized === '暂存' || normalized === 'save draft' ? 'save-draft' : 'save-current',
      mode: 'user-trigger-only',
      safe: true,
      text,
      reasonCode: metadata.type === 'submit' ? 'SAFE_LABEL_SUBMIT_TYPE_REQUIRES_REVIEW' : 'EXACT_SAFE_SAVE',
    };
  }

  class SaveHandler {
    constructor(options = {}) {
      if (!Safety?.validateConfiguredCandidate) throw new Error('JFSaveHandler requires JFSafety');
      this.document = options.document || (typeof document !== 'undefined' ? document : null);
      if (!this.document?.querySelectorAll) throw new Error('需要有效的 document');
      this.root = options.root || this.document;
      this.configuredSelectors = Array.isArray(options.configuredSelectors)
        ? options.configuredSelectors.filter(selector => typeof selector === 'string' && selector.length <= 300).slice(0, 20)
        : [];
      this.handles = new Map();
      this.lastInspection = [];
      this.sequence = 0;
      this.inspectionUrl = '';
    }

    inspect(rootNode = this.root) {
      this.handles.clear();
      this.inspectionUrl = safeString(this.document.location?.href, 2_000);
      const elements = [];
      const seen = new Set();
      const add = (element, configured = false) => {
        if (!element || isExtensionUi(element) || seen.has(element) || elements.length >= MAX_CANDIDATES) return;
        seen.add(element);
        elements.push({ element, configured });
      };
      queryAll(rootNode, SAVE_CONTROL_SELECTOR).forEach(element => add(element, false));
      this.configuredSelectors.forEach(selector => queryAll(rootNode, selector).forEach(element => add(element, true)));

      this.lastInspection = elements.map(({ element, configured }) => {
        const classification = classifySaveControl(element, { baseUrl: this.document.location?.href });
        // 配置选择器命中后仍执行同一文本、类型、form action 最终复核。
        const finalSafe = classification.safe
          && Safety.validateConfiguredCandidate(element, 'save', { baseUrl: this.document.location?.href });
        const handleId = `save-${++this.sequence}`;
        this.handles.set(handleId, element);
        return Object.freeze({
          handleId,
          text: classification.text.slice(0, 120),
          kind: classification.kind,
          mode: finalSafe ? classification.mode : 'forbidden',
          safe: finalSafe,
          configured,
          reasonCode: finalSafe ? classification.reasonCode : classification.safe ? 'CONFIGURED_TARGET_FAILED_FINAL_CHECK' : classification.reasonCode,
        });
      });
      return this.lastInspection.slice();
    }

    selectCandidate(options = {}) {
      const inspection = this.lastInspection.length ? this.lastInspection : this.inspect(options.root || this.root);
      if (options.handleId) {
        const selected = inspection.find(item => item.handleId === options.handleId);
        return selected?.safe ? { candidate: selected, code: 'SELECTED' } : { candidate: null, code: selected?.reasonCode || 'NOT_FOUND' };
      }
      const safeCandidates = inspection.filter(item => item.safe);
      if (safeCandidates.length === 0) return { candidate: null, code: 'NO_SAFE_SAVE_CONTROL' };
      if (safeCandidates.length > 1) return { candidate: null, code: 'AMBIGUOUS_SAVE_CONTROLS', candidates: safeCandidates };
      return { candidate: safeCandidates[0], code: 'SELECTED' };
    }

    highlight(handleId) {
      const element = this.handles.get(handleId);
      if (!element?.isConnected) return { ok: false, code: 'STALE_SAVE_CONTROL' };
      try {
        element.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
        const before = element.style?.outline || '';
        if (element.style) {
          element.style.outline = '3px solid #f59e0b';
          const timer = setTimeout(() => { if (element.isConnected && element.style) element.style.outline = before; }, 2_500);
          timer?.unref?.();
        }
        return { ok: true, code: 'HIGHLIGHTED' };
      } catch (_) {
        return { ok: false, code: 'HIGHLIGHT_FAILED' };
      }
    }

    async save(options = {}) {
      // 用户可在“一键填写全部”的预览中一次性授权本次任务自动暂存；授权短时有效且不能用于提交类按钮。
      const runAuthorization = options.runAuthorization;
      const authorizedRun = Boolean(
        runAuthorization
        && runAuthorization.userConfirmed === true
        && runAuthorization.allowSafeSave === true
        && Number(runAuthorization.expiresAt) > Date.now()
        && /^[a-z0-9._:-]{6,160}$/i.test(String(runAuthorization.taskId || ''))
        && /^[a-z0-9_-]{16,200}$/i.test(String(runAuthorization.nonce || ''))
      );
      if (options.userInitiated !== true && !authorizedRun) return { ok: false, clicked: false, code: 'FRESH_USER_CONFIRMATION_REQUIRED' };
      if (safeString(this.document.location?.href, 2_000) !== this.inspectionUrl && this.lastInspection.length) {
        this.invalidate();
        return { ok: false, clicked: false, code: 'STALE_INSPECTION_AFTER_NAVIGATION' };
      }
      const selected = this.selectCandidate(options);
      if (!selected.candidate) return { ok: false, clicked: false, code: selected.code, candidates: selected.candidates || [] };
      const candidate = selected.candidate;
      const element = this.handles.get(candidate.handleId);
      const confirmation = Safety.normalizeActionText(options.confirmText);
      if (!confirmation || confirmation !== Safety.normalizeActionText(candidate.text)) {
        return { ok: false, clicked: false, code: 'SAVE_LABEL_CONFIRMATION_MISMATCH' };
      }
      if (!element?.isConnected || element.ownerDocument !== this.document || isExtensionUi(element)) return { ok: false, clicked: false, code: 'STALE_SAVE_CONTROL' };
      const finalClassification = classifySaveControl(element, { baseUrl: this.document.location?.href });
      if (!finalClassification.safe || !Safety.validateConfiguredCandidate(element, 'save', { baseUrl: this.document.location?.href })) {
        return { ok: false, clicked: false, code: finalClassification.reasonCode || 'FINAL_SAFETY_CHECK_FAILED' };
      }

      try { element.click(); }
      catch (_) { return { ok: false, clicked: false, code: 'SAFE_SAVE_CLICK_FAILED' }; }
      const settled = PageReady?.waitForDOMStable
        ? await PageReady.waitForDOMStable({ document: this.document, timeoutMs: options.timeoutMs, signal: options.signal })
        : { ok: true, stable: true, reason: 'NO_PAGE_READY_MODULE' };
      // DOM 稳定不等于保存成功；最终结果必须由用户或站点可验证状态确认。
      this.invalidate();
      return {
        ok: true,
        clicked: true,
        code: 'SAFE_SAVE_TRIGGERED_MANUAL_VERIFICATION_REQUIRED',
        verificationRequired: true,
        settled,
      };
    }

    manualInstruction() {
      return '仅可由你主动触发“保存 / 暂存 / 保存本页 / 保存当前信息”。“保存并下一步”及任何提交按钮必须人工操作。';
    }

    invalidate() {
      this.handles.clear();
      this.lastInspection = [];
      this.inspectionUrl = '';
    }
  }

  function createSaveHandler(options) {
    return new SaveHandler(options);
  }

  return Object.freeze({
    SAVE_CONTROL_SELECTOR,
    SaveHandler,
    classifySaveControl,
    createSaveHandler,
  });
});
