/*
 * 解放 — DOM/SPA 就绪等待工具
 * Copyright (c) 2026 zlh and contributors
 * SPDX-License-Identifier: MIT
 */
(function initPageReady(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.JFPageReady = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function pageReadyFactory() {
  'use strict';

  function finiteNumber(value, fallback, minimum, maximum) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(minimum, Math.min(maximum, parsed));
  }

  function ownerDocument(rootNode, explicitDocument) {
    return explicitDocument
      || (rootNode?.nodeType === 9 ? rootNode : rootNode?.ownerDocument)
      || (typeof document !== 'undefined' ? document : null);
  }

  function observerRoot(rootNode, doc) {
    if (rootNode?.nodeType) return rootNode;
    return doc?.documentElement || doc?.body || null;
  }

  function animationFrame(view, callback) {
    if (typeof view?.requestAnimationFrame === 'function') return { kind: 'raf', id: view.requestAnimationFrame(callback) };
    return { kind: 'timer', id: setTimeout(() => callback(Date.now()), 16) };
  }

  function cancelAnimationFrameHandle(view, handle) {
    if (!handle) return;
    if (handle.kind === 'raf' && typeof view?.cancelAnimationFrame === 'function') view.cancelAnimationFrame(handle.id);
    else clearTimeout(handle.id);
  }

  function mutationObserverFor(doc) {
    return doc?.defaultView?.MutationObserver
      || (typeof MutationObserver === 'function' ? MutationObserver : null);
  }

  function safeText(value, maxLength = 240) {
    return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
  }

  function captureNavigationSnapshot(doc) {
    if (!doc) return { url: '', title: '', heading: '', active: '', childCount: 0 };
    let heading = '';
    let active = '';
    try {
      heading = safeText(doc.querySelector?.('main h1,main h2,h1,h2,[role="heading"]')?.textContent);
      active = safeText(doc.querySelector?.('[aria-current="page"],[aria-selected="true"],.is-active,.active,.current')?.textContent);
    } catch (_) { /* selector support varies in fixtures */ }
    return {
      url: safeText(doc.location?.href, 2_000),
      title: safeText(doc.title),
      heading,
      active,
      childCount: Number(doc.body?.getElementsByTagName?.('*')?.length || doc.documentElement?.childElementCount || 0),
    };
  }

  function snapshotSignature(snapshot) {
    const value = snapshot || {};
    return JSON.stringify([
      safeText(value.title), safeText(value.heading), safeText(value.active), Number(value.childCount || 0),
    ]);
  }

  function aborted(signal) {
    return Boolean(signal?.aborted);
  }

  function waitForDOMStable(options = {}) {
    const rootNode = options.root;
    const doc = ownerDocument(rootNode, options.document);
    const target = observerRoot(rootNode, doc);
    const view = doc?.defaultView || globalThis;
    const timeoutMs = finiteNumber(options.timeoutMs, 5_000, 50, 60_000);
    const quietMs = finiteNumber(options.quietMs, 160, 32, 5_000);
    const minFrames = finiteNumber(options.minFrames, 2, 1, 20);
    const start = Date.now();

    return new Promise(resolve => {
      if (!target) {
        resolve({ ok: false, stable: false, reason: 'NO_DOM_ROOT', elapsedMs: 0, mutationCount: 0 });
        return;
      }
      let finished = false;
      let mutationCount = 0;
      let lastMutationAt = Date.now();
      let stableFrames = 0;
      let frameHandle;
      let observer;
      let timeout;

      const cleanup = () => {
        observer?.disconnect?.();
        cancelAnimationFrameHandle(view, frameHandle);
        clearTimeout(timeout);
        options.signal?.removeEventListener?.('abort', onAbort);
      };
      const finish = result => {
        if (finished) return;
        finished = true;
        cleanup();
        resolve({ elapsedMs: Date.now() - start, mutationCount, ...result });
      };
      const onAbort = () => finish({ ok: false, stable: false, reason: 'ABORTED' });
      const check = () => {
        if (finished) return;
        if (aborted(options.signal)) { onAbort(); return; }
        if (Date.now() - lastMutationAt >= quietMs) stableFrames += 1;
        else stableFrames = 0;
        if (stableFrames >= minFrames) {
          finish({ ok: true, stable: true, reason: mutationCount ? 'DOM_QUIET' : 'ALREADY_STABLE' });
          return;
        }
        frameHandle = animationFrame(view, check);
      };

      const Observer = mutationObserverFor(doc);
      if (Observer) {
        observer = new Observer(() => {
          mutationCount += 1;
          lastMutationAt = Date.now();
          stableFrames = 0;
        });
        try {
          observer.observe(target, { childList: true, subtree: true, attributes: true, characterData: true });
        } catch (_) { observer = null; }
      }
      options.signal?.addEventListener?.('abort', onAbort, { once: true });
      timeout = setTimeout(() => finish({ ok: false, stable: false, reason: 'TIMEOUT' }), timeoutMs);
      frameHandle = animationFrame(view, check);
    });
  }

  function waitForElement(selectorOrPredicate, options = {}) {
    const rootNode = options.root || options.document;
    const doc = ownerDocument(rootNode, options.document);
    const searchRoot = rootNode?.querySelector ? rootNode : doc;
    const target = observerRoot(rootNode, doc);
    const timeoutMs = finiteNumber(options.timeoutMs, 5_000, 25, 60_000);
    const pollIntervalMs = finiteNumber(options.pollIntervalMs, 80, 16, 1_000);
    const start = Date.now();

    const find = () => {
      try {
        const result = typeof selectorOrPredicate === 'function'
          ? selectorOrPredicate(searchRoot, doc)
          : searchRoot?.querySelector?.(String(selectorOrPredicate || ''));
        if (!result) return null;
        if (options.visible && (result.hidden || result.getAttribute?.('aria-hidden') === 'true')) return null;
        return result;
      } catch (_) {
        return null;
      }
    };

    return new Promise(resolve => {
      const immediate = find();
      if (immediate) { resolve(immediate); return; }
      if (!target || aborted(options.signal)) { resolve(null); return; }
      let finished = false;
      let observer;
      let poll;
      let timeout;

      const cleanup = () => {
        observer?.disconnect?.();
        clearInterval(poll);
        clearTimeout(timeout);
        options.signal?.removeEventListener?.('abort', onAbort);
      };
      const finish = value => {
        if (finished) return;
        finished = true;
        cleanup();
        resolve(value || null);
      };
      const check = () => {
        const value = find();
        if (value) finish(value);
        else if (Date.now() - start >= timeoutMs) finish(null);
      };
      const onAbort = () => finish(null);

      const Observer = mutationObserverFor(doc);
      if (Observer) {
        observer = new Observer(check);
        try { observer.observe(target, { childList: true, subtree: true, attributes: true }); }
        catch (_) { observer = null; }
      }
      poll = setInterval(check, pollIntervalMs);
      timeout = setTimeout(() => finish(null), timeoutMs);
      options.signal?.addEventListener?.('abort', onAbort, { once: true });
    });
  }

  const FORM_READY_SELECTOR = [
    'input:not([type="hidden"]):not([type="button"]):not([type="submit"]):not([type="reset"])',
    'textarea', 'select', '[contenteditable="true"]', '[role="combobox"]',
    'input[type="file"]', '[class*="upload"] input[type="file"]',
  ].join(',');

  function isVisibleControl(element) {
    if (!element || element.hidden || element.getAttribute?.('aria-hidden') === 'true') return false;
    // A hidden native file input is still a valid readiness signal when its custom
    // upload surface is rendered. FileUploadEngine performs the stricter permission
    // and visibility checks before any upload.
    if (String(element.type || '').toLowerCase() === 'file') return Boolean(element.isConnected !== false);
    const view = element.ownerDocument?.defaultView || globalThis;
    try {
      const style = view.getComputedStyle?.(element);
      if (style && (style.display === 'none' || style.visibility === 'hidden')) return false;
    } catch (_) { /* synthetic DOM */ }
    const rect = element.getBoundingClientRect?.();
    if (rect && rect.width === 0 && rect.height === 0) return false;
    return true;
  }

  /**
   * Wait for a real form surface, then wait until its structure is quiet. This is
   * used after both full navigations and legacy onclick/Ajax section switches.
   */
  async function waitForFormReady(options = {}) {
    const rootNode = options.root || options.document;
    const doc = ownerDocument(rootNode, options.document);
    const timeoutMs = finiteNumber(options.timeoutMs, 7_500, 100, 60_000);
    const startedAt = Date.now();
    const control = await waitForElement(searchRoot => {
      try {
        return [...(searchRoot?.querySelectorAll?.(FORM_READY_SELECTOR) || [])]
          .find(element => !element.closest?.('#__jf_panel__,#__jf_modal__,#__rf_panel__,[data-jiefang-ui]')
            && isVisibleControl(element)) || null;
      } catch (_) { return null; }
    }, {
      root: rootNode,
      document: doc,
      timeoutMs,
      pollIntervalMs: options.pollIntervalMs || 80,
      signal: options.signal,
    });
    if (!control) {
      return { ok: false, ready: false, reason: options.signal?.aborted ? 'ABORTED' : 'NO_VISIBLE_FORM_CONTROL', elapsedMs: Date.now() - startedAt, controlCount: 0 };
    }
    const remaining = Math.max(100, timeoutMs - (Date.now() - startedAt));
    const stability = await waitForDOMStable({
      root: rootNode,
      document: doc,
      timeoutMs: remaining,
      quietMs: finiteNumber(options.stableForMs, 350, 100, 2_000),
      minFrames: options.minFrames || 2,
      signal: options.signal,
    });
    let controlCount = 0;
    try {
      controlCount = [...(rootNode?.querySelectorAll?.(FORM_READY_SELECTOR) || [])].filter(isVisibleControl).length;
    } catch (_) { controlCount = 1; }
    return {
      ok: Boolean(stability.ok),
      ready: true,
      reason: stability.ok ? 'FORM_READY_AND_STABLE' : stability.reason,
      elapsedMs: Date.now() - startedAt,
      controlCount,
      stability,
    };
  }

  function waitForNavigationChange(options = {}) {
    const doc = ownerDocument(options.root, options.document);
    const target = observerRoot(options.root, doc);
    const view = doc?.defaultView || globalThis;
    const timeoutMs = finiteNumber(options.timeoutMs, 7_500, 100, 60_000);
    const quietMs = finiteNumber(options.quietMs, 140, 32, 5_000);
    const pollIntervalMs = finiteNumber(options.pollIntervalMs, 80, 16, 1_000);
    const before = options.beforeSnapshot || {
      ...captureNavigationSnapshot(doc),
      ...(options.beforeUrl !== undefined ? { url: safeText(options.beforeUrl, 2_000) } : {}),
    };
    const beforeSignature = options.beforeSignature || snapshotSignature(before);
    const start = Date.now();

    return new Promise(resolve => {
      if (!doc || !target) {
        resolve({ changed: false, reason: 'NO_DOM_ROOT', elapsedMs: 0, snapshot: captureNavigationSnapshot(doc) });
        return;
      }
      let finished = false;
      let detectedReason = '';
      let detectedAt = 0;
      let mutationCount = 0;
      let observer;
      let poll;
      let frameHandle;
      let timeout;

      const cleanup = () => {
        observer?.disconnect?.();
        clearInterval(poll);
        clearTimeout(timeout);
        cancelAnimationFrameHandle(view, frameHandle);
        options.signal?.removeEventListener?.('abort', onAbort);
      };
      const finish = (changed, reason) => {
        if (finished) return;
        finished = true;
        cleanup();
        resolve({
          changed,
          reason,
          elapsedMs: Date.now() - start,
          mutationCount,
          snapshot: captureNavigationSnapshot(doc),
        });
      };
      const onAbort = () => finish(false, 'ABORTED');
      const detect = () => {
        if (finished || aborted(options.signal)) { if (aborted(options.signal)) onAbort(); return; }
        const snapshot = captureNavigationSnapshot(doc);
        let reason = '';
        if (typeof options.predicate === 'function') {
          try { if (options.predicate(snapshot, before)) reason = 'PREDICATE'; } catch (_) { /* keep waiting */ }
        }
        if (!reason && safeText(snapshot.url, 2_000) !== safeText(before.url, 2_000)) reason = 'URL';
        if (!reason && snapshotSignature(snapshot) !== beforeSignature) reason = 'DOM';
        if (reason && !detectedReason) {
          detectedReason = reason;
          detectedAt = Date.now();
        }
      };
      const settle = () => {
        if (finished) return;
        detect();
        if (detectedReason && Date.now() - detectedAt >= quietMs) {
          finish(true, detectedReason);
          return;
        }
        frameHandle = animationFrame(view, settle);
      };

      const Observer = mutationObserverFor(doc);
      if (Observer) {
        observer = new Observer(() => {
          mutationCount += 1;
          // 只有连续 quietMs 没有后续变化，才把一次 SPA/DOM 变化视为已稳定。
          if (detectedReason) detectedAt = Date.now();
          detect();
        });
        try { observer.observe(target, { childList: true, subtree: true, attributes: true, characterData: true }); }
        catch (_) { observer = null; }
      }
      options.signal?.addEventListener?.('abort', onAbort, { once: true });
      poll = setInterval(detect, pollIntervalMs);
      timeout = setTimeout(() => finish(false, 'TIMEOUT'), timeoutMs);
      frameHandle = animationFrame(view, settle);
    });
  }

  return Object.freeze({
    captureNavigationSnapshot,
    snapshotSignature,
    waitForDOMStable,
    waitForElement,
    waitForFormReady,
    waitForNavigationChange,
  });
});
