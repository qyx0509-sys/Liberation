/* 解放：通用 Cascader / Hierarchical Picker Adapter。 SPDX-License-Identifier: MIT */
(function initCascaderAdapter(root, factory) {
  let events = root?.JFEventDispatcher;
  let verification = root?.JFVerificationEngine;
  let safety = root?.JFSafety;
  if (typeof module === 'object' && module.exports) {
    events = require('../../core/event-dispatcher.js');
    verification = require('../../core/verification-engine.js');
    safety = require('../../core/safety.js');
  }
  const api = factory(events, verification, safety);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.JFCascaderAdapter = api;
  root?.JFControlAdapterRegistry?.register?.(api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function cascaderAdapterFactory(E, V, S) {
  'use strict';

  const OVERLAY_SELECTOR = [
    '.ant-cascader-menus',
    '.el-cascader__dropdown',
    '.el-cascader-panel',
    '[data-cascader-panel]',
    '[data-hierarchical-panel]',
  ].join(',');
  const MENU_SELECTOR = [
    '.ant-cascader-menu',
    '.el-cascader-menu',
    '[data-cascader-menu]',
    '[data-hierarchical-menu]',
  ].join(',');
  const OPTION_SELECTOR = [
    '.ant-cascader-menu-item',
    '.el-cascader-node',
    '[data-cascader-option]',
    '[data-hierarchical-option]',
    '[role="menuitem"]',
    '[role="treeitem"]',
  ].join(',');
  const SELECTED_LABEL_SELECTOR = [
    '[class*="cascader-picker-label"]',
    '[class*="cascader__label"]',
    '.ant-select-selection-item',
    '.el-cascader__tags-text',
    '[data-cascader-selected-item]',
    '[data-cascader-value]',
  ].join(',');
  const OPTION_LABEL_SELECTOR = [
    '.ant-cascader-menu-item-content',
    '.el-cascader-node__label',
    '[data-cascader-option-label]',
    '[data-hierarchical-option-label]',
  ].join(',');
  const ADMIN_SUFFIX = /(?:特别行政区|自治区|自治州|地区|盟|省|市|区|县|旗)$/;
  const DISABLED_CLASS = /(?:^|\s)(?:disabled|is-disabled|ant-cascader-menu-item-disabled|el-cascader-node--disabled)(?:\s|$)/i;
  const REBIND_STRATEGIES = Object.freeze(new Set([
    '', 'same-overlay', 'controlled-replacement', 'fresh-overlay-replacement', 'rebind-failed',
  ]));
  const REBIND_FAILURE_REASONS = Object.freeze(new Set([
    '', 'NO_UNIQUE_CONTROLLED_REPLACEMENT', 'NO_UNIQUE_FRESH_REPLACEMENT',
    'STALE_OR_MISSING_NEXT_MENU',
  ]));
  const traces = new WeakMap();

  function text(value) { return value === null || value === undefined ? '' : String(value).trim(); }
  function compact(value) { return text(value).replace(/[\s/／、,，>＞-]+/g, ''); }
  function events(context) { return context?.dependencies?.EventDispatcher || E; }
  function verifier(context) { return context?.dependencies?.VerificationEngine || V; }
  function list(rootNode, selector) {
    try { return Array.from(rootNode?.querySelectorAll?.(selector) || []); }
    catch (_) { return []; }
  }
  function unique(items) { return [...new Set((items || []).filter(Boolean))]; }
  function visible(element) {
    if (!element || element.isConnected === false) return false;
    const view = element.ownerDocument?.defaultView;
    const visited = new Set();
    for (let current = element; current && !visited.has(current); current = current.parentElement) {
      visited.add(current);
      if (current.hidden || current.getAttribute?.('aria-hidden') === 'true') return false;
      try {
        const style = view?.getComputedStyle?.(current);
        if (style && (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0')) return false;
      } catch (_) { /* cross-realm style lookup can fail */ }
    }
    const rect = element.getBoundingClientRect?.();
    return !rect || rect.width > 0 || rect.height > 0;
  }
  function contains(rootNode, element) {
    try { return Boolean(rootNode?.contains?.(element)); }
    catch (_) { return false; }
  }
  function nextRender(element) {
    return new Promise(resolve => {
      Promise.resolve().then(() => {
        const view = element?.ownerDocument?.defaultView;
        if (typeof view?.requestAnimationFrame === 'function') view.requestAnimationFrame(resolve);
        else setTimeout(resolve, 0);
      });
    });
  }

  function parsePath(value) {
    if (Array.isArray(value)) {
      const segments = value.map(text);
      return segments.length >= 2 && segments.length <= 3 && segments.every(Boolean) ? segments : null;
    }
    if (value && typeof value === 'object') {
      const province = text(value.province || value.state || value.regionProvince);
      const city = text(value.city || value.prefecture || value.regionCity);
      const district = text(value.district || value.county || value.regionDistrict);
      if (!province || !city) return null;
      return district ? [province, city, district] : [province, city];
    }
    const source = text(value);
    if (!source) return null;
    const separator = /\s*(?:\/|／|、|,|，|>|＞|\|)\s*/;
    if (separator.test(source)) {
      const separated = source.split(separator).map(text);
      return separated.length >= 2 && separated.length <= 3 && separated.every(Boolean) ? separated : null;
    }
    let match = source.match(/^(.+?(?:特别行政区|自治区|省))(.+?(?:自治州|地区|盟|市))(.+?(?:区|县|市|旗))$/);
    if (match) return match.slice(1, 4).map(text);
    match = source.match(/^(.+?(?:特别行政区|自治区|省))(.+?(?:自治州|地区|盟|市))$/);
    return match ? match.slice(1, 3).map(text) : null;
  }

  function canonicalSegment(value) {
    return compact(value).replace(ADMIN_SUFFIX, '');
  }

  function className(element) {
    return text(element?.className?.baseVal ?? element?.className);
  }

  function disabledWithin(element) {
    const visited = new Set();
    for (let current = element; current && !visited.has(current); current = current.parentElement) {
      visited.add(current);
      if (current.disabled || current.getAttribute?.('aria-disabled') === 'true'
        || DISABLED_CLASS.test(className(current))) return true;
    }
    return false;
  }

  function directText(element) {
    return text(Array.from(element?.childNodes || [])
      .filter(node => node?.nodeType === 3)
      .map(node => node.textContent)
      .join(' '));
  }

  function optionLabelSources(element) {
    const explicitLabel = element?.querySelector?.(OPTION_LABEL_SELECTOR);
    const ownText = directText(element);
    const hasNestedOption = list(element, OPTION_SELECTOR).length > 0;
    return unique([
      explicitLabel?.textContent,
      element?.getAttribute?.('aria-label'),
      element?.getAttribute?.('data-label'),
      element?.getAttribute?.('data-value'),
      ownText,
      ...(!explicitLabel && !hasNestedOption ? [element?.textContent, element?.innerText] : []),
    ].map(text).filter(Boolean));
  }

  function optionSafe(element) {
    const tag = text(element?.tagName).toLowerCase();
    const type = text(element?.type || element?.getAttribute?.('type')).toLowerCase();
    if (!visible(element) || disabledWithin(element)) return false;
    if (['submit', 'reset', 'file', 'image', 'hidden'].includes(type)) return false;
    if (tag === 'button' && type !== 'button') return false;
    if ((tag === 'a' || element.getAttribute?.('role') === 'link') && element.getAttribute?.('href')) return false;
    if (element.getAttribute?.('formaction') !== null) return false;
    if (typeof S?.isDangerousAction === 'function' && S.isDangerousAction(element)) return false;
    if (element.closest?.('#__jf_panel__,#__jf_modal__,#__rf_panel__,[data-jiefang-ui]')) return false;
    return true;
  }

  function optionRecords(menu) {
    return list(menu, OPTION_SELECTOR).filter(element => {
      for (let current = element?.parentElement; current && current !== menu; current = current.parentElement) {
        if (current.matches?.(OPTION_SELECTOR)) return false;
      }
      return optionSafe(element);
    }).map(element => {
      const label = optionLabelSources(element)[0] || '';
      const value = text(element.getAttribute?.('data-value') || label);
      return { element, label, value };
    }).filter(record => Boolean(record.label));
  }

  function matchOption(expected, records) {
    const exact = compact(expected);
    const canonical = canonicalSegment(expected);
    const scored = records.map(record => {
      const values = [record.label, record.value];
      const score = values.some(value => compact(value) === exact)
        ? 1
        : values.some(value => canonicalSegment(value) === canonical) ? 0.97 : 0;
      return { ...record, score };
    }).filter(record => record.score >= 0.97);
    if (!scored.length) return { matched: false, ambiguous: false, reason: 'NO_MATCH', candidates: [] };
    const bestScore = Math.max(...scored.map(record => record.score));
    const best = scored.filter(record => record.score === bestScore);
    return best.length === 1
      ? { matched: true, ambiguous: false, option: best[0], candidates: scored }
      : { matched: false, ambiguous: true, reason: 'AMBIGUOUS', candidates: best };
  }

  function rootFor(context) {
    return context?.descriptor?.cascaderRoot || context?.descriptor?.element || null;
  }
  function triggerFor(context) {
    return context?.descriptor?.cascaderTrigger || context?.descriptor?.interactionElement || null;
  }
  function controlledIds(context) {
    return unique([triggerFor(context), rootFor(context)].flatMap(element => [
      element?.getAttribute?.('aria-controls'),
      element?.getAttribute?.('aria-owns'),
    ]).flatMap(value => text(value).split(/\s+/)).filter(Boolean));
  }
  function allOverlays(context) {
    const document = rootFor(context)?.ownerDocument || triggerFor(context)?.ownerDocument;
    return unique(list(document, OVERLAY_SELECTOR));
  }
  function controlledOverlays(context) {
    const document = rootFor(context)?.ownerDocument || triggerFor(context)?.ownerDocument;
    return controlledIds(context).map(id => document?.getElementById?.(id)).filter(Boolean)
      .filter(element => element.matches?.(OVERLAY_SELECTOR) || list(element, MENU_SELECTOR).length > 0);
  }
  function panelMenus(panel, visibleOnly = false) {
    return unique(list(panel, MENU_SELECTOR).filter(menu => {
      if (visibleOnly && !visible(menu)) return false;
      for (let current = menu.parentElement; current && current !== panel; current = current.parentElement) {
        if (current.matches?.(MENU_SELECTOR)) return false;
      }
      return true;
    }));
  }
  function allMenus(panel) { return panelMenus(panel, false); }
  function visibleMenus(panel) { return panelMenus(panel, true); }

  function menuSnapshot(menu) {
    if (!menu) return null;
    return {
      menu,
      options: optionRecords(menu).map(record => ({ element: record.element, label: record.label, value: record.value })),
    };
  }

  function menuChanged(menu, snapshot) {
    if (!menu) return false;
    if (!snapshot) return true;
    if (menu !== snapshot.menu) return true;
    const current = optionRecords(menu);
    if (current.length !== snapshot.options.length) return true;
    return current.some((record, index) => record.element !== snapshot.options[index].element
      || record.label !== snapshot.options[index].label
      || record.value !== snapshot.options[index].value);
  }

  function waitFor(context, choose, timeoutMs) {
    const immediate = choose();
    if (immediate) return Promise.resolve(immediate);
    const document = rootFor(context)?.ownerDocument || triggerFor(context)?.ownerDocument;
    const observeRoot = document?.body || document?.documentElement;
    const Observer = document?.defaultView?.MutationObserver || globalThis.MutationObserver;
    if (!observeRoot || typeof Observer !== 'function') return Promise.resolve(null);
    return new Promise(resolve => {
      let finished = false;
      let observer;
      let timer;
      const finish = result => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        observer?.disconnect?.();
        resolve(result);
      };
      observer = new Observer(() => {
        const result = choose();
        if (result) finish(result);
      });
      observer.observe(observeRoot, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class', 'style', 'hidden', 'aria-hidden', 'aria-expanded'],
      });
      timer = setTimeout(() => finish(choose()), Math.max(100, Math.min(5000, timeoutMs || 1200)));
    });
  }

  async function ownedPanelAfterOpen(context, visibleBefore, timeoutMs) {
    const ids = controlledIds(context);
    const choose = () => {
      if (ids.length) {
        const owned = controlledOverlays(context).filter(visible);
        if (ids.length === 1) return owned.length === 1 ? { panel: owned[0], ownership: 'aria-controls' } : null;
        const fresh = owned.filter(panel => !visibleBefore.has(panel));
        return fresh.length === 1 ? { panel: fresh[0], ownership: 'aria-controls' } : null;
      }
      const fresh = allOverlays(context).filter(visible).filter(panel => !visibleBefore.has(panel));
      return fresh.length === 1 ? { panel: fresh[0], ownership: 'fresh-overlay' } : null;
    };
    return waitFor(context, choose, timeoutMs);
  }

  function waitForMenu(context, panel, level, timeoutMs) {
    return waitFor(context, () => visibleMenus(panel)[level] || null, timeoutMs);
  }

  function waitForChangedMenu(context, panel, level, snapshot, timeoutMs) {
    return waitFor(context, () => {
      const menus = visibleMenus(panel);
      const declaredAtLevel = menus.filter(menu => {
        const raw = text(menu.getAttribute?.('data-cascader-level'));
        return raw && Number(raw) === level;
      });
      if (declaredAtLevel.length > 1) return null;
      const candidate = declaredAtLevel[0] || menus[level] || null;
      if (!candidate || !menuChanged(candidate, snapshot)) return null;
      if (menus.indexOf(candidate) !== level) return null;
      const explicitLevel = text(candidate.getAttribute?.('data-cascader-level'));
      if (explicitLevel && Number(explicitLevel) !== level) return null;
      // Extra already-visible columns are acceptable only when they explicitly
      // declare deeper, unique logical levels. An undeclared or duplicate
      // sibling cannot be attributed to this parent selection.
      const trailingLevels = menus.slice(level + 1).map(menu => {
        const raw = text(menu.getAttribute?.('data-cascader-level'));
        return raw ? Number(raw) : NaN;
      });
      if (trailingLevels.some(value => !Number.isInteger(value) || value <= level)
        || new Set(trailingLevels).size !== trailingLevels.length) return null;
      // A freshly appended loading shell is transition evidence, but it is not
      // yet an option scope. Wait until its static options actually arrive.
      return optionRecords(candidate).length > 0 ? candidate : null;
    }, timeoutMs);
  }

  async function waitForLowerMenuEvidence(context, panel, level, snapshot, timeoutMs) {
    const resolved = await waitFor(context, () => {
      const candidate = visibleMenus(panel)[level] || null;
      if (!candidate) return null;
      // An already-visible lower menu gets a bounded opportunity to disappear or
      // refresh after the parent selection. A fresh/changed menu must also finish
      // loading options before it is classified as required hierarchy evidence.
      if (snapshot && !menuChanged(candidate, snapshot)) return null;
      return optionRecords(candidate).length > 0
        ? { menu: candidate, state: 'options' }
        : null;
    }, timeoutMs);
    if (resolved) return resolved;

    const candidate = visibleMenus(panel)[level] || null;
    if (!candidate) return null;
    return {
      menu: candidate,
      state: optionRecords(candidate).length > 0 ? 'options' : 'loading',
    };
  }

  async function rebindPanel(context, current, ownership, timeoutMs, visibleBefore = new Set()) {
    const currentId = text(current?.id || current?.getAttribute?.('id'));
    const choose = () => {
      // Some uncontrolled Cascaders hide the current overlay for one render and
      // then reuse that exact node. Re-check it on every observation before any
      // replacement fallback so a stable owner is never mistaken for a fresh one.
      if (visible(current)) {
        return { panel: current, ownership, rebindStrategy: 'same-overlay', rebindFailureReason: '' };
      }
      if (controlledIds(context).length) {
        const candidates = controlledOverlays(context).filter(visible);
        const sameId = currentId
          ? candidates.filter(panel => text(panel.id || panel.getAttribute?.('id')) === currentId)
          : [];
        const owned = sameId.length ? sameId : candidates;
        return owned.length === 1 ? {
          panel: owned[0],
          ownership: 'aria-controls',
          rebindStrategy: owned[0] === current ? 'same-overlay' : 'controlled-replacement',
          rebindFailureReason: '',
        } : null;
      }
      const candidates = allOverlays(context)
        .filter(visible)
        .filter(panel => panel !== current && !visibleBefore.has(panel));
      return candidates.length === 1 ? {
        panel: candidates[0],
        ownership: 'fresh-overlay',
        rebindStrategy: 'fresh-overlay-replacement',
        rebindFailureReason: '',
      } : null;
    };
    const rebound = await waitFor(context, choose, timeoutMs);
    if (rebound) return rebound;
    return {
      panel: null,
      ownership,
      rebindStrategy: 'rebind-failed',
      rebindFailureReason: controlledIds(context).length
        ? 'NO_UNIQUE_CONTROLLED_REPLACEMENT'
        : 'NO_UNIQUE_FRESH_REPLACEMENT',
    };
  }

  function transitionTopologySnapshot(context, panel) {
    const menus = allMenus(panel);
    return {
      panel,
      menus,
      menuSnapshots: menus.map(menuSnapshot),
      visibleMenus: visibleMenus(panel),
      visibleOverlays: new Set(allOverlays(context).filter(visible)),
    };
  }

  function transitionTopologyDebug(snapshot, panel, rebindStrategy, rebindFailureReason = '') {
    const beforeMenus = snapshot?.menus || [];
    const afterMenus = allMenus(panel);
    const newMenuIndexes = afterMenus
      .map((menu, index) => beforeMenus.includes(menu) ? null : index)
      .filter(index => Number.isInteger(index));
    const optionSetChanged = afterMenus.some((menu, index) =>
      menuChanged(menu, snapshot?.menuSnapshots?.[index] || null));
    const stable = Boolean(snapshot?.panel && panel && snapshot.panel === panel);
    return {
      overlayIdentityStable: stable,
      menuCountBefore: beforeMenus.length,
      menuCountAfter: afterMenus.length,
      visibleMenuCountBefore: snapshot?.visibleMenus?.length || 0,
      visibleMenuCountAfter: visibleMenus(panel).length,
      newMenuIndexes,
      newMenuCount: newMenuIndexes.length,
      optionSetChanged,
      rebindStrategy,
      rebindFailureReason,
    };
  }

  function baseTrace(overrides = {}) {
    const indexes = [...new Set((Array.isArray(overrides.newMenuIndexes)
      ? overrides.newMenuIndexes
      : [])
      .map(value => Math.trunc(Number(value)))
      .filter(value => Number.isInteger(value) && value >= 0 && value <= 100))]
      .slice(0, 20);
    const rebindStrategy = text(overrides.rebindStrategy);
    const rebindFailureReason = text(overrides.rebindFailureReason).toUpperCase();
    return {
      levelCount: Math.max(0, Math.trunc(Number(overrides.levelCount) || 0)),
      selectedLevelCount: Math.max(0, Math.trunc(Number(overrides.selectedLevelCount) || 0)),
      panelOwnership: text(overrides.panelOwnership),
      ambiguityReason: text(overrides.ambiguityReason),
      overlayIdentityStable: Boolean(overrides.overlayIdentityStable),
      menuCountBefore: Math.max(0, Math.trunc(Number(overrides.menuCountBefore) || 0)),
      menuCountAfter: Math.max(0, Math.trunc(Number(overrides.menuCountAfter) || 0)),
      visibleMenuCountBefore: Math.max(0, Math.trunc(Number(overrides.visibleMenuCountBefore) || 0)),
      visibleMenuCountAfter: Math.max(0, Math.trunc(Number(overrides.visibleMenuCountAfter) || 0)),
      newMenuIndexes: indexes,
      newMenuCount: indexes.length,
      optionSetChanged: Boolean(overrides.optionSetChanged),
      rebindStrategy: REBIND_STRATEGIES.has(rebindStrategy) ? rebindStrategy : '',
      rebindFailureReason: REBIND_FAILURE_REASONS.has(rebindFailureReason) ? rebindFailureReason : '',
    };
  }
  function storeTrace(context, trace) {
    const normalized = baseTrace(trace);
    normalized.newMenuIndexes = Object.freeze([...normalized.newMenuIndexes]);
    const frozen = Object.freeze(normalized);
    [context?.descriptor, context?.descriptor?.element, context?.descriptor?.interactionElement]
      .filter(item => item && (typeof item === 'object' || typeof item === 'function'))
      .forEach(item => traces.set(item, frozen));
    return frozen;
  }
  function getDebugTrace(target) {
    if (!target) return null;
    return traces.get(target)
      || traces.get(target.descriptor)
      || traces.get(target.element)
      || traces.get(target.interactionElement)
      || null;
  }
  function failure(context, trace, reason, ambiguityReason) {
    storeTrace(context, { ...trace, ambiguityReason });
    return {
      handled: true,
      ok: false,
      status: 'NEEDS_CONFIRMATION',
      reason,
      strategy: 'cascader-fail-closed',
    };
  }

  function selectedSegments(rootNode) {
    return list(rootNode, SELECTED_LABEL_SELECTOR)
      .map(element => text(element.textContent || element.getAttribute?.('data-value') || element.getAttribute?.('aria-label')))
      .filter(Boolean);
  }

  function readPath(context) {
    const rootNode = rootFor(context);
    const trigger = triggerFor(context);
    const selected = selectedSegments(rootNode);
    if (selected.length) return selected.join(' / ');
    return text(trigger?.value || rootNode?.getAttribute?.('data-value') || '');
  }

  function pathsEquivalent(expectedSegments, actualSegments) {
    return Array.isArray(expectedSegments) && Array.isArray(actualSegments)
      && expectedSegments.length === actualSegments.length
      && expectedSegments.every((segment, index) => {
        const expected = canonicalSegment(segment);
        const actual = canonicalSegment(actualSegments[index]);
        return Boolean(expected) && expected === actual;
      });
  }

  const adapter = {
    id: 'cascader',
    priority: 750,
    capabilities: Object.freeze(['open', 'enumerate-level-options', 'select-path', 'verify']),
    supports(context) {
      return text(context?.descriptor?.controlKind || context?.descriptor?.type).toLowerCase() === 'cascader';
    },
    read(context) {
      return readPath(context);
    },
    async write(context) {
      const runtime = events(context);
      const rootNode = rootFor(context);
      const trigger = triggerFor(context);
      const segments = parsePath(context.value);
      let trace = baseTrace();
      storeTrace(context, trace);
      if (!runtime?.clickLikeUser || !rootNode || !trigger) {
        return failure(context, trace, 'Cascader 依赖或触发器不可用', 'TRIGGER_UNAVAILABLE');
      }
      if (!segments) return failure(context, trace, '地址层级值无法保守解析', 'INVALID_EXPECTED_PATH');

      const visibleBefore = new Set(allOverlays(context).filter(visible));
      if (!runtime.clickLikeUser(trigger, {
        purpose: 'cascader-trigger',
        ownerField: rootNode,
        trigger,
      })) return failure(context, trace, 'Cascader 无法安全打开', 'TRIGGER_REJECTED');
      await nextRender(trigger);

      let owned = await ownedPanelAfterOpen(context, visibleBefore, context.settings?.cascaderTimeoutMs);
      if (!owned?.panel) {
        const controlled = controlledIds(context).length > 0;
        return failure(
          context,
          trace,
          controlled ? 'aria 绑定的 Cascader panel 不唯一或不可见' : '无法唯一确定当前 Cascader panel',
          controlled ? 'CONTROLLED_PANEL_UNAVAILABLE' : 'FRESH_PANEL_AMBIGUOUS',
        );
      }
      trace = { ...trace, panelOwnership: owned.ownership };
      storeTrace(context, trace);

      let panel = owned.panel;
      let menu = await waitForMenu(context, panel, 0, context.settings?.cascaderTimeoutMs);
      for (let level = 0; level < segments.length; level += 1) {
        const menus = visibleMenus(panel);
        trace = { ...trace, levelCount: Math.max(trace.levelCount, menus.length) };
        if (!menu) return failure(context, trace, `Cascader 第 ${level + 1} 层未出现`, `MISSING_LEVEL_${level}`);
        const lastExpectedLevel = level === segments.length - 1;
        const transitionTopology = lastExpectedLevel
          ? null
          : transitionTopologySnapshot(context, panel);
        const nextSnapshot = menuSnapshot(menus[level + 1] || null);
        const match = matchOption(segments[level], optionRecords(menu));
        if (!match.matched || !match.option?.element) {
          return failure(
            context,
            trace,
            match.ambiguous ? `Cascader 第 ${level + 1} 层选项存在歧义` : `Cascader 第 ${level + 1} 层没有可靠匹配项`,
            `${match.ambiguous ? 'AMBIGUOUS' : 'NO_MATCH'}_LEVEL_${level}`,
          );
        }
        const clicked = runtime.clickLikeUser(match.option.element, {
          purpose: 'cascader-option',
          ownerPanel: panel,
          ownerMenu: menu,
          level,
          expectedOptionLabel: match.option.label,
        });
        if (!clicked) return failure(context, trace, `Cascader 第 ${level + 1} 层选项无法安全点击`, `OPTION_REJECTED_LEVEL_${level}`);
        trace = { ...trace, selectedLevelCount: level + 1 };
        storeTrace(context, trace);
        await nextRender(match.option.element);

        const requiredLevels = Number(rootNode.getAttribute?.('data-required-levels'));
        if (lastExpectedLevel && Number.isInteger(requiredLevels) && requiredLevels > segments.length) {
          return failure(context, trace, '页面要求更多地址层级，当前 JSON 不完整', 'MISSING_REQUIRED_LEVEL');
        }

        if (!lastExpectedLevel) {
          const previousPanel = panel;
          owned = await rebindPanel(
            context,
            previousPanel,
            owned.ownership,
            context.settings?.cascaderTimeoutMs,
            transitionTopology?.visibleOverlays,
          );
          if (!owned?.panel) {
            trace = {
              ...trace,
              ...transitionTopologyDebug(
                transitionTopology,
                previousPanel,
                owned?.rebindStrategy || 'rebind-failed',
                owned?.rebindFailureReason || 'NO_UNIQUE_FRESH_REPLACEMENT',
              ),
            };
            return failure(context, trace, 'Cascader panel 在层级切换后无法可靠重绑定', `PANEL_REBIND_FAILED_LEVEL_${level}`);
          }
          panel = owned.panel;
          trace = { ...trace, panelOwnership: owned.ownership };
          menu = await waitForChangedMenu(
            context,
            panel,
            level + 1,
            nextSnapshot,
            context.settings?.cascaderTimeoutMs,
          );
          if (!menu) {
            trace = {
              ...trace,
              ...transitionTopologyDebug(
                transitionTopology,
                panel,
                owned.rebindStrategy,
                'STALE_OR_MISSING_NEXT_MENU',
              ),
            };
            return failure(context, trace, `Cascader 第 ${level + 2} 层未可靠刷新`, `STALE_OR_MISSING_LEVEL_${level + 1}`);
          }
          trace = {
            ...trace,
            levelCount: Math.max(trace.levelCount, visibleMenus(panel).length),
            ...transitionTopologyDebug(
              transitionTopology,
              panel,
              owned.rebindStrategy,
              '',
            ),
          };
          storeTrace(context, trace);
          continue;
        }

        // The final selection may close the popup. If it remains open, wait boundedly
        // for a newly-created/changed lower menu before declaring success.
        if (visible(panel)) {
          const lowerEvidence = await waitForLowerMenuEvidence(
            context,
            panel,
            level + 1,
            nextSnapshot,
            context.settings?.cascaderTimeoutMs,
          );
          trace = { ...trace, levelCount: Math.max(trace.levelCount, visibleMenus(panel).length) };
          if (lowerEvidence) {
            return failure(
              context,
              trace,
              lowerEvidence.state === 'loading'
                ? '下一级地址菜单仍在加载，无法确认当前路径完整'
                : '页面要求更多地址层级，当前 JSON 不完整',
              lowerEvidence.state === 'loading' ? 'LOWER_LEVEL_LOADING' : 'MISSING_REQUIRED_LEVEL',
            );
          }
        }
      }

      storeTrace(context, trace);
      return {
        handled: true,
        ok: true,
        status: 'SUCCESS',
        reason: '',
        actualValue: adapter.read(context),
        strategy: `${context.framework || 'generic'}-cascader-path`,
      };
    },
    verify(context) {
      const segments = parsePath(context.value);
      const actualValue = adapter.read(context);
      const selected = selectedSegments(rootFor(context));
      const actualSegments = selected.length >= 2 && selected.length <= 3
        ? selected
        : parsePath(actualValue);
      const equivalent = pathsEquivalent(segments, actualSegments);
      if (equivalent) return { ok: true, status: 'SUCCESS', actualValue, reason: '' };
      const runtime = verifier(context);
      if (typeof context.value === 'string' && runtime?.verify) {
        const result = runtime.verify(context.descriptor, context.value, {
          ...context.settings,
          fieldPath: context.fieldPath,
          expectedType: context.expectedType,
        });
        if (result?.ok) return result;
      }
      return {
        ok: false,
        status: 'NEEDS_CONFIRMATION',
        actualValue,
        reason: 'Cascader 层级路径回读与计划值不一致',
      };
    },
    getDebugTrace,
    parsePath,
  };

  return Object.freeze(adapter);
});
