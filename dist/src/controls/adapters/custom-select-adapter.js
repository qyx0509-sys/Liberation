/* 解放：框架与 ARIA 自定义下拉 Adapter。 SPDX-License-Identifier: MIT */
(function initCustomSelectAdapter(root, factory) {
  let events = root?.JFEventDispatcher;
  let options = root?.JFOptionAliases;
  let verification = root?.JFVerificationEngine;
  let safety = root?.JFSafety;
  if (typeof module === 'object' && module.exports) {
    events = require('../../core/event-dispatcher.js');
    options = require('../../mappings/option-aliases.js');
    verification = require('../../core/verification-engine.js');
    safety = require('../../core/safety.js');
  }
  const api = factory(events, options, verification, safety);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.JFCustomSelectAdapter = api;
  root?.JFControlAdapterRegistry?.register?.(api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function customSelectAdapterFactory(E, O, V, S) {
  'use strict';

  const OPTION_SELECTOR = '[role="option"],[data-select-option],[class*="select-item-option"],[class*="dropdown__item"],[class*="react-select__option"],[class*="jqx-listitem"],[class*="arco-select-option"],[class*="ivu-select-item"]';
  const OVERLAY_SELECTOR = '[role="listbox"],[class*="select-dropdown"],[class*="dropdown-menu"],[class*="react-select__menu"],[class*="jqx-listbox"],[class*="arco-select-popup"],[class*="ivu-select-dropdown"]';
  const JQX_TRIGGER_SELECTOR = '.jqx-combobox-arrow,.jqx-dropdownlist-content,.jqx-combobox-input';
  const JQX_ROOT_SELECTOR = '.jqx-widget,[class*="jqx-dropdownlist"],[class*="jqx-combobox"]';

  function text(value) { return value === null || value === undefined ? '' : String(value).trim(); }
  function events(context) { return context?.dependencies?.EventDispatcher || E; }
  function options(context) { return context?.dependencies?.OptionAliases || O; }
  function verifier(context) { return context?.dependencies?.VerificationEngine || V; }
  function list(rootNode, selector) {
    try { return Array.from(rootNode?.querySelectorAll?.(selector) || []); }
    catch (_) { return []; }
  }
  function visible(element) {
    if (!element || element.isConnected === false || element.hidden || element.getAttribute?.('aria-hidden') === 'true') return false;
    const view = element.ownerDocument?.defaultView;
    const visited = new Set();
    let current = element;
    while (current && !visited.has(current)) {
      visited.add(current);
      if (current.hidden || current.getAttribute?.('aria-hidden') === 'true') return false;
      try {
        const style = view?.getComputedStyle?.(current);
        if (style && (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0')) return false;
      } catch (_) { /* cross-realm style lookup can fail */ }
      current = current.parentElement;
    }
    const rect = element.getBoundingClientRect?.();
    return !rect || rect.width > 0 || rect.height > 0;
  }
  function optionSafe(element) {
    const tag = text(element?.tagName).toLowerCase();
    const type = text(element?.type || element?.getAttribute?.('type')).toLowerCase();
    if (!visible(element) || element?.disabled || element?.getAttribute?.('aria-disabled') === 'true') return false;
    if (['submit', 'reset', 'file', 'image'].includes(type)) return false;
    if (tag === 'button' && type !== 'button') return false;
    if (tag === 'a' && element?.getAttribute?.('href')) return false;
    if (typeof S?.isDangerousAction !== 'function' || S.isDangerousAction(element)) return false;
    if (element?.closest?.('#__jf_panel__,#__jf_modal__,[data-jiefang-ui]')) return false;
    return true;
  }
  async function nextRender(element) {
    await Promise.resolve();
    const view = element?.ownerDocument?.defaultView;
    await new Promise(resolve => {
      if (typeof view?.requestAnimationFrame === 'function') view.requestAnimationFrame(resolve);
      else setTimeout(resolve, 0);
    });
  }
  function scopeElements(context, trigger = null) {
    return [...new Set([
      trigger,
      context?.descriptor?.interactionElement,
      context?.descriptor?.element,
    ].filter(Boolean))];
  }
  function controlledIds(context, trigger = null) {
    const collect = elements => elements
      .flatMap(element => [element.getAttribute?.('aria-controls'), element.getAttribute?.('aria-owns')])
      .flatMap(value => text(value).split(/\s+/))
      .filter(Boolean);
    const triggerIds = trigger ? collect([trigger]) : [];
    return triggerIds.length ? triggerIds : collect(scopeElements(context));
  }
  function controlledRoots(context, trigger = null) {
    const owner = context?.descriptor?.element?.ownerDocument;
    return controlledIds(context, trigger).map(id => owner?.getElementById?.(id)).filter(visible);
  }
  function optionRoots(context, trigger = null) {
    const controlled = controlledRoots(context, trigger);
    if (controlled.length || controlledIds(context, trigger).length) return controlled;
    const owner = context?.descriptor?.element?.ownerDocument;
    const overlays = list(owner, OVERLAY_SELECTOR).filter(visible);
    return overlays.length ? overlays : [owner].filter(Boolean);
  }
  function optionRecords(context, trigger = null) {
    const seen = new Set();
    const signatures = new Set();
    const records = [];
    for (const rootNode of optionRoots(context, trigger)) {
      for (const element of list(rootNode, OPTION_SELECTOR)) {
        const interactionElement = element.closest?.('.jqx-listitem-element,.jqx-menu-item') || element;
        if (seen.has(interactionElement) || !optionSafe(interactionElement)) continue;
        const label = text(interactionElement.textContent || interactionElement.innerText
          || element.textContent || element.innerText
          || element.getAttribute?.('aria-label') || element.getAttribute?.('data-value'));
        const value = text(interactionElement.getAttribute?.('data-value') || element.getAttribute?.('data-value') || label);
        const signature = `${label}\u0001${value}`;
        if (!label || signatures.has(signature)) continue;
        seen.add(interactionElement);
        signatures.add(signature);
        records.push({ element: interactionElement, label, value });
      }
    }
    return records;
  }

  function triggerCandidates(context) {
    const primary = scopeElements(context);
    const jqxRoots = [...new Set(primary.flatMap(element => {
      let closestRoot = null;
      try { closestRoot = element.closest?.(JQX_ROOT_SELECTOR) || null; }
      catch (_) { closestRoot = null; }
      return [element, closestRoot].filter(Boolean);
    }))];
    return [...new Set([
      ...primary,
      ...jqxRoots.flatMap(rootNode => list(rootNode, JQX_TRIGGER_SELECTOR)),
    ].filter(visible))];
  }

  function waitForOptions(context, trigger, previousElements, timeoutMs) {
    const owner = context?.descriptor?.element?.ownerDocument;
    const rootNode = owner?.body || owner?.documentElement;
    const explicitlyControlled = controlledIds(context, trigger).length > 0;
    const choose = () => {
      const current = optionRecords(context, trigger);
      if (explicitlyControlled) return current;
      const fresh = current.filter(option => !previousElements.has(option.element));
      if (fresh.length) return fresh;
      return previousElements.size === 0 ? current : [];
    };
    const immediate = choose();
    if (immediate.length) return Promise.resolve(immediate);

    const Observer = owner?.defaultView?.MutationObserver || globalThis.MutationObserver;
    if (!rootNode || typeof Observer !== 'function') return Promise.resolve([]);
    return new Promise(resolve => {
      let finished = false;
      let timer;
      let observer;
      const finish = result => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        observer?.disconnect?.();
        resolve(result);
      };
      observer = new Observer(() => {
        const result = choose();
        if (result.length) finish(result);
      });
      observer.observe(rootNode, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class', 'style', 'aria-hidden', 'aria-expanded'],
      });
      timer = setTimeout(() => finish(choose()), Math.max(100, Math.min(5000, timeoutMs || 1200)));
    });
  }

  const adapter = {
    id: 'custom-select',
    priority: 450,
    capabilities: Object.freeze(['open', 'enumerate-options', 'select-option', 'verify']),
    supports(context) {
      return text(context?.descriptor?.controlKind || context?.descriptor?.type).toLowerCase() === 'custom-select';
    },
    read(context) {
      const runtime = events(context);
      return runtime?.readControlValue ? runtime.readControlValue(context.descriptor) : '';
    },
    async write(context) {
      const runtime = events(context);
      const aliases = options(context);
      const triggers = triggerCandidates(context);
      if (!runtime?.clickLikeUser || !aliases?.findBestOption || !triggers.length) {
        return { handled: true, ok: false, status: 'FAILED', reason: '自定义下拉依赖或触发器不可用', strategy: 'custom-select' };
      }
      let opened = false;
      let activeTrigger = null;
      let records = [];
      for (const trigger of triggers) {
        const previousElements = new Set(optionRecords(context, trigger).map(option => option.element));
        if (!runtime.clickLikeUser(trigger, { purpose: 'custom-select-trigger' })) continue;
        opened = true;
        activeTrigger = trigger;
        await nextRender(trigger);
        records = await waitForOptions(context, trigger, previousElements, context.settings?.customSelectTimeoutMs);
        if (records.length) break;
      }
      if (!opened) return { handled: true, ok: false, status: 'NEEDS_CONFIRMATION', reason: '自定义下拉无法安全打开', strategy: 'custom-select-open' };
      const match = aliases.findBestOption(context.value, records, {
        fieldPath: context.fieldPath,
        optionAliases: context.settings?.optionAliases,
        minScore: Number.isFinite(context.settings?.customOptionMinScore)
          ? context.settings.customOptionMinScore
          : (Number.isFinite(context.settings?.optionMinScore) ? context.settings.optionMinScore : 0.9),
        ambiguityMargin: Number.isFinite(context.settings?.optionAmbiguityMargin) ? context.settings.optionAmbiguityMargin : 0.06,
      });
      const ownedIds = [...new Set(controlledIds(context, activeTrigger))];
      const ownedRoots = [...new Set(controlledRoots(context, activeTrigger))];
      const owner = context?.descriptor?.element?.ownerDocument;
      const visibleOverlays = ownedIds.length ? [] : list(owner, OVERLAY_SELECTOR).filter(visible);
      const scopeUncertain = (ownedIds.length > 0 && ownedRoots.length !== ownedIds.length)
        || (ownedIds.length === 0 && visibleOverlays.length > 1);
      const optionMatchingDebug = scopeUncertain && match.optionMatchingDebug
        ? Object.freeze({ ...match.optionMatchingDebug, reasonCode: 'OPTION_SCOPE_UNCERTAIN' })
        : (match.optionMatchingDebug || null);
      if (scopeUncertain) {
        return {
          handled: true,
          ok: false,
          status: 'NEEDS_CONFIRMATION',
          reason: '无法确定自定义下拉的 owned option scope',
          strategy: `${context.framework || 'generic'}-custom-select-scope`,
          optionCandidates: match.candidates || [],
          optionMatchingDebug,
        };
      }
      if (!match.matched || !match.option?.element) {
        return {
          handled: true,
          ok: false,
          status: 'NEEDS_CONFIRMATION',
          reason: match.ambiguous ? '自定义下拉选项存在歧义' : '没有可靠匹配项：自定义下拉选项与计划值不一致',
          strategy: `${context.framework || 'generic'}-custom-select-match`,
          optionCandidates: match.candidates || [],
          optionMatchingDebug,
        };
      }
      if (!optionSafe(match.option.element)) {
        return {
          handled: true,
          ok: false,
          status: 'NEEDS_CONFIRMATION',
          reason: '匹配项属于危险动作控件',
          strategy: 'custom-select-safety',
          optionMatchingDebug,
        };
      }
      const selected = runtime.clickLikeUser(match.option.element, { purpose: 'custom-select-option' });
      if (!selected) {
        return {
          handled: true,
          ok: false,
          status: 'NEEDS_CONFIRMATION',
          reason: '选项无法安全点击',
          strategy: 'custom-select-safety',
          optionMatchingDebug,
        };
      }
      await nextRender(activeTrigger);
      await nextRender(activeTrigger);
      return {
        handled: true,
        ok: true,
        status: 'SUCCESS',
        reason: '',
        actualValue: adapter.read(context),
        selectedOption: match.label,
        optionCandidates: match.candidates || [],
        optionMatchingDebug,
        strategy: `${context.framework || 'generic'}-custom-select-option`,
      };
    },
    verify(context) {
      const runtime = verifier(context);
      if (!runtime?.verify) return { ok: false, status: 'FAILED', reason: 'VerificationEngine 不可用' };
      return runtime.verify(context.descriptor, context.value, {
        ...context.settings,
        fieldPath: context.fieldPath,
        expectedType: context.expectedType,
      });
    },
  };

  return Object.freeze(adapter);
});
