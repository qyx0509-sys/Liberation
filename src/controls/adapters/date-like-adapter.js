/* 解放：原生日期与安全年月面板 Adapter。 SPDX-License-Identifier: MIT */
(function initDateLikeAdapter(root, factory) {
  let events = root?.JFEventDispatcher;
  let dates = root?.JFDateRules;
  let verification = root?.JFVerificationEngine;
  if (typeof module === 'object' && module.exports) {
    events = require('../../core/event-dispatcher.js');
    dates = require('../../mappings/date-rules.js');
    verification = require('../../core/verification-engine.js');
  }
  const api = factory(events, dates, verification);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.JFDateLikeAdapter = api;
  root?.JFControlAdapterRegistry?.register?.(api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function dateLikeAdapterFactory(E, D, V) {
  'use strict';

  const PANEL_SELECTOR = '[role="dialog"],[class*="date-picker"],[class*="datepicker"],[class*="month-picker"],[class*="monthpicker"],[class*="calendar"],[class*="picker-panel"]';
  const TRIGGER_SELECTOR = 'button,[role="button"],[aria-haspopup],[aria-controls],[class*="calendar"],[class*="datepicker"],[class*="date-picker"],[class*="monthpicker"],[class*="month-picker"],[class*="ant-picker"],[class*="arco-picker"],[class*="ivu-date-picker"],[class*="el-date-editor"],i,svg';
  const NAV_SELECTOR = 'button,[role="button"],[class*="prev"],[class*="next"],[class*="left"],[class*="right"]';
  const OPTION_SELECTOR = '[role="option"],[role="gridcell"],button,[class*="year"],[class*="month"],[class*="date"],[class*="day"],td,li,span,div';
  const WEEKDAY_SELECTOR = '[role="columnheader"],[data-calendar-weekday],th,[class*="weekday"],[class*="week-day"]';
  const MODE_SWITCH_SELECTOR = 'button,[role="button"],[data-calendar-mode-switch],[class*="month-select"],[class*="month-btn"],[class*="month-switch"],[class*="year-select"],[class*="year-btn"],[class*="year-switch"]';
  const LEGACY_DECADE_SELECTOR = '.ant-calendar-decade-panel,.ant-calendar-decade-panel-table,.ant-calendar-decade-panel-cell';
  const CALENDAR_MODES = Object.freeze(new Set(['DAY', 'MONTH', 'YEAR']));
  const MODE_SWITCH_KINDS = Object.freeze(new Set([
    'MONTH_BUTTON', 'MONTH_ANCHOR', 'MONTH_SPAN', 'MONTH_DIV', 'MONTH_OTHER',
    'YEAR_BUTTON', 'YEAR_ANCHOR', 'YEAR_SPAN', 'YEAR_DIV', 'YEAR_OTHER',
  ]));
  const MODE_SWITCH_SOURCES = Object.freeze(new Set([
    'EXPLICIT_ATTRIBUTE', 'LEGACY_ANT_CLASS', 'MODERN_ANT_CLASS', 'GENERIC_CLASS',
  ]));
  const MODE_SWITCH_REJECTIONS = Object.freeze(new Set([
    'NO_HEADER_CANDIDATE', 'DISABLED_CANDIDATE',
    'MONTH_SEMANTIC_LABEL_MISMATCH', 'YEAR_SEMANTIC_LABEL_MISMATCH',
    'MULTIPLE_MONTH_SWITCH_CANDIDATES', 'MULTIPLE_YEAR_SWITCH_CANDIDATES',
    'NO_MATCHING_MODE_SWITCH', 'SAFETY_REJECTED',
  ]));
  const MODE_SWITCH_SAFETY_REASONS = Object.freeze(new Set([
    'LINK_ROLE_MISSING', 'HREF_PRESENT', 'FORM_ACTION_PRESENT',
    'INLINE_HANDLER_PRESENT', 'OWNER_MISMATCH', 'MODE_MISMATCH',
    'LIVE_GUARD_FAILED', 'DANGEROUS_ACTION', 'DETACHED', 'DISABLED',
  ]));
  const DATE_PANEL_METADATA_HINT = /(?:^|[^a-z])(?:date(?:picker)?|calendar|month(?:picker)?|year(?:picker)?)(?:$|[^a-z])|(?:ant|arco)-picker|ivu-date-picker|el-date|(?:日期|日历|年月|月份|年份)(?:选择器|面板|弹窗)/i;
  const DATE_PANEL_NAVIGATION_HINT = /上一年|下一年|前一年|后一年|上一组年份|下一组年份|previous\s*(?:year|decade)|prev\s*(?:year|decade)|next\s*(?:year|decade)/i;
  const WEEKDAY_TEXT = /^(?:日|一|二|三|四|五|六|周[日一二三四五六]|星期[日一二三四五六]|sun(?:day)?|mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?)$/i;
  const OUTSIDE_MONTH_HINT = /(?:^|[-_\s])(?:outside|other|old|new|last|prev|next)(?:[-_\s]?month)?(?:$|[-_\s])/i;
  const DISABLED_HINT = /(?:^|[-_\s])disabled(?:$|[-_\s])/i;
  const datePickerDebugByNode = new WeakMap();

  function createModeSwitchDebug() {
    return {
      panelMode: 'UNKNOWN',
      headerCandidateCount: 0,
      monthSwitchCandidateCount: 0,
      yearSwitchCandidateCount: 0,
      candidateKinds: [],
      rejectionReasons: [],
      selectedSwitchSource: '',
      safetyReason: '',
    };
  }

  function diagnosticModeSwitchDebug(raw) {
    const panelMode = text(raw?.panelMode).toUpperCase();
    const uniqueEnums = (values, allowed) => Object.freeze([
      ...new Set((Array.isArray(values) ? values : [])
        .map(value => text(value).toUpperCase())
        .filter(value => allowed.has(value))),
    ].slice(0, 20));
    const source = text(raw?.selectedSwitchSource).toUpperCase();
    const safetyReason = text(raw?.safetyReason).toUpperCase();
    return Object.freeze({
      panelMode: CALENDAR_MODES.has(panelMode) ? panelMode : 'UNKNOWN',
      headerCandidateCount: Math.max(0, Number(raw?.headerCandidateCount) || 0),
      monthSwitchCandidateCount: Math.max(0, Number(raw?.monthSwitchCandidateCount) || 0),
      yearSwitchCandidateCount: Math.max(0, Number(raw?.yearSwitchCandidateCount) || 0),
      candidateKinds: uniqueEnums(raw?.candidateKinds, MODE_SWITCH_KINDS),
      rejectionReasons: uniqueEnums(raw?.rejectionReasons, MODE_SWITCH_REJECTIONS),
      selectedSwitchSource: MODE_SWITCH_SOURCES.has(source) ? source : '',
      safetyReason: MODE_SWITCH_SAFETY_REASONS.has(safetyReason) ? safetyReason : '',
    });
  }

  function createDebugTrace() {
    return {
      triggerCandidateCount: 0,
      selectedTriggerSource: '',
      rawPanelCandidateCount: 0,
      visiblePanelCandidateCount: 0,
      canonicalClusterCount: 0,
      selectedClusterEvidence: '',
      selectedPanelMode: 'UNKNOWN',
      transitionCount: 0,
      modeBeforeTransition: 'UNKNOWN',
      modeAfterTransition: 'UNKNOWN',
      rawAfterTransition: 0,
      canonicalAfterTransition: 0,
      selectedAfterTransitionEvidence: '',
      modeSwitchDebug: createModeSwitchDebug(),
      finalReasonCode: '',
    };
  }

  function diagnosticTrace(trace) {
    return Object.freeze({
      triggerCandidateCount: Math.max(0, Number(trace?.triggerCandidateCount) || 0),
      selectedTriggerSource: text(trace?.selectedTriggerSource),
      rawPanelCandidateCount: Math.max(0, Number(trace?.rawPanelCandidateCount) || 0),
      visiblePanelCandidateCount: Math.max(0, Number(trace?.visiblePanelCandidateCount) || 0),
      canonicalClusterCount: Math.max(0, Number(trace?.canonicalClusterCount) || 0),
      selectedClusterEvidence: text(trace?.selectedClusterEvidence),
      selectedPanelMode: CALENDAR_MODES.has(text(trace?.selectedPanelMode).toUpperCase())
        ? text(trace.selectedPanelMode).toUpperCase()
        : 'UNKNOWN',
      transitionCount: Math.max(0, Number(trace?.transitionCount) || 0),
      modeBeforeTransition: CALENDAR_MODES.has(text(trace?.modeBeforeTransition).toUpperCase())
        ? text(trace.modeBeforeTransition).toUpperCase()
        : 'UNKNOWN',
      modeAfterTransition: CALENDAR_MODES.has(text(trace?.modeAfterTransition).toUpperCase())
        ? text(trace.modeAfterTransition).toUpperCase()
        : 'UNKNOWN',
      rawAfterTransition: Math.max(0, Number(trace?.rawAfterTransition) || 0),
      canonicalAfterTransition: Math.max(0, Number(trace?.canonicalAfterTransition) || 0),
      selectedAfterTransitionEvidence: text(trace?.selectedAfterTransitionEvidence),
      modeSwitchDebug: diagnosticModeSwitchDebug(trace?.modeSwitchDebug),
      finalReasonCode: text(trace?.finalReasonCode).toUpperCase(),
    });
  }

  function rememberDebugTrace(context, trigger, trace) {
    const snapshot = diagnosticTrace(trace);
    const descriptor = context?.descriptor;
    [descriptor, descriptor?.element, descriptor?.interactionElement, trigger]
      .filter(candidate => candidate && (typeof candidate === 'object' || typeof candidate === 'function'))
      .forEach(candidate => datePickerDebugByNode.set(candidate, snapshot));
    return snapshot;
  }

  function getDebugTrace(descriptorOrElement) {
    if (!descriptorOrElement || (typeof descriptorOrElement !== 'object' && typeof descriptorOrElement !== 'function')) return null;
    return datePickerDebugByNode.get(descriptorOrElement)
      || datePickerDebugByNode.get(descriptorOrElement.element)
      || datePickerDebugByNode.get(descriptorOrElement.interactionElement)
      || datePickerDebugByNode.get(descriptorOrElement.datePickerTrigger)
      || null;
  }

  function text(value) { return value === null || value === undefined ? '' : String(value).trim(); }
  function events(context) { return context?.dependencies?.EventDispatcher || E; }
  function dates(context) { return context?.dependencies?.DateRules || D; }
  function verifier(context) { return context?.dependencies?.VerificationEngine || V; }
  function list(rootNode, selector) {
    try { return Array.from(rootNode?.querySelectorAll?.(selector) || []); }
    catch (_) { return []; }
  }
  function visible(element) {
    if (!element || element.isConnected === false || element.hidden || element.getAttribute?.('aria-hidden') === 'true') return false;
    try {
      const style = element.ownerDocument?.defaultView?.getComputedStyle?.(element);
      if (style && (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0')) return false;
    } catch (_) { /* ignored */ }
    const rect = element.getBoundingClientRect?.();
    return !rect || rect.width > 0 || rect.height > 0;
  }
  async function nextRender(element) {
    await Promise.resolve();
    const view = element?.ownerDocument?.defaultView;
    await new Promise(resolve => {
      if (typeof view?.requestAnimationFrame === 'function') view.requestAnimationFrame(resolve);
      else setTimeout(resolve, 0);
    });
  }
  function yearFrom(panel) {
    const explicit = Number(panel?.getAttribute?.('data-calendar-year'));
    if (Number.isInteger(explicit) && explicit >= 1900 && explicit <= 2199) return explicit;
    const match = text(panel?.innerText || panel?.textContent).match(/(?:19|20|21)\d{2}/);
    return match ? Number(match[0]) : null;
  }
  function label(element) {
    return text(element?.getAttribute?.('aria-label') || element?.getAttribute?.('title') || element?.innerText || element?.textContent);
  }
  function panelMetadata(panel) {
    const className = panel?.className?.baseVal ?? panel?.className;
    return [
      panel?.id,
      className,
      panel?.getAttribute?.('aria-label'),
      panel?.getAttribute?.('title'),
      panel?.getAttribute?.('data-role'),
      panel?.getAttribute?.('data-type'),
    ].map(text).filter(Boolean).join(' ');
  }
  function optionLabels(element) {
    return [
      element?.getAttribute?.('data-value'),
      element?.getAttribute?.('aria-label'),
      element?.getAttribute?.('title'),
      element?.innerText,
      element?.textContent,
    ].map(value => text(value).replace(/\s+/g, '')).filter(Boolean);
  }
  function optionMetadata(element) {
    const role = text(element?.getAttribute?.('role')).toLowerCase();
    const className = element?.className?.baseVal ?? element?.className;
    return {
      role,
      metadata: [
      element?.id,
      className,
      element?.getAttribute?.('data-role'),
      element?.getAttribute?.('data-type'),
      ].map(text).filter(Boolean).join(' '),
    };
  }
  function partNumber(element, mode) {
    const attributeName = mode === 'YEAR'
      ? 'data-calendar-year-option'
      : mode === 'MONTH' ? 'data-calendar-month-option' : 'data-calendar-day-option';
    const explicit = Number(element?.getAttribute?.(attributeName));
    if (mode === 'YEAR' && Number.isInteger(explicit) && explicit >= 1900 && explicit <= 2199) return explicit;
    if (mode !== 'YEAR' && Number.isInteger(explicit) && explicit >= 1 && explicit <= (mode === 'MONTH' ? 12 : 31)) return explicit;
    for (const value of optionLabels(element)) {
      const match = mode === 'YEAR'
        ? value.match(/^((?:19|20|21)\d{2})年?$/)
        : mode === 'MONTH'
          ? value.replace(/^0/, '').match(/^(1[0-2]|[1-9])月$/)
          : value.replace(/^0/, '').match(/^([12]\d|3[01]|[1-9])日?$/);
      if (match) return Number(match[1]);
    }
    return null;
  }
  function structuredOption(element, mode) {
    const { role, metadata } = optionMetadata(element);
    const explicit = mode === 'YEAR'
      ? element?.getAttribute?.('data-calendar-year-option')
      : mode === 'MONTH'
        ? element?.getAttribute?.('data-calendar-month-option')
        : element?.getAttribute?.('data-calendar-day-option');
    if (explicit !== null && explicit !== undefined) return true;
    const semanticClass = mode === 'YEAR'
      ? /(?:^|[^a-z])year(?:[-_ ]?(?:cell|option|item))?(?:$|[^a-z])|年份(?:选项|单元格)/i
      : mode === 'MONTH'
        ? /(?:^|[^a-z])month(?:[-_ ]?(?:cell|option|item))?(?:$|[^a-z])|月份(?:选项|单元格)/i
        : /(?:^|[^a-z])(?:date|day)(?:[-_ ]?(?:cell|option|item))?(?:$|[^a-z])|日期?(?:选项|单元格)/i;
    return ['option', 'gridcell'].includes(role) || semanticClass.test(metadata);
  }
  function partOptions(panel, mode) {
    return list(panel, OPTION_SELECTOR).filter(candidate => visible(candidate)
      && structuredOption(candidate, mode)
      && Number.isInteger(partNumber(candidate, mode)));
  }
  function weekdayCount(panel) {
    return new Set(list(panel, WEEKDAY_SELECTOR)
      .filter(visible)
      .flatMap(optionLabels)
      .map(value => value.replace(/^周|^星期/, ''))
      .filter(value => WEEKDAY_TEXT.test(value))).size;
  }
  function explicitCalendarMode(panel) {
    const value = text(
      panel?.getAttribute?.('data-calendar-mode')
      || panel?.getAttribute?.('data-picker-mode')
      || panel?.getAttribute?.('data-panel-mode'),
    ).toUpperCase();
    return CALENDAR_MODES.has(value) ? value : '';
  }
  function panelYearMonth(panel) {
    const year = yearFrom(panel);
    const explicitMonth = Number(panel?.getAttribute?.('data-calendar-month'));
    if (Number.isInteger(explicitMonth) && explicitMonth >= 1 && explicitMonth <= 12) {
      return { year, month: explicitMonth };
    }
    const source = text(panel?.innerText || panel?.textContent).replace(/\s+/g, ' ');
    const match = source.match(/((?:19|20|21)\d{2})\s*年\s*(1[0-2]|0?[1-9])\s*月/);
    return { year, month: match ? Number(match[2]) : null };
  }
  function calendarMode(panel) {
    if (!visible(panel)) return 'UNKNOWN';
    const explicit = explicitCalendarMode(panel);
    const years = new Set(partOptions(panel, 'YEAR').map(item => partNumber(item, 'YEAR')));
    const months = new Set(partOptions(panel, 'MONTH').map(item => partNumber(item, 'MONTH')));
    const days = new Set(partOptions(panel, 'DAY').map(item => partNumber(item, 'DAY')));
    const hasDayHeader = Number.isInteger(panelYearMonth(panel).year)
      && Number.isInteger(panelYearMonth(panel).month);
    const dateMetadata = DATE_PANEL_METADATA_HINT.test(panelMetadata(panel));
    const valid = {
      YEAR: years.size >= 3,
      MONTH: months.size >= 3,
      DAY: dateMetadata && days.size >= 7 && hasDayHeader && weekdayCount(panel) >= 5,
    };
    if (explicit) return valid[explicit] ? explicit : 'UNKNOWN';
    if (years.size >= 3 && months.size < 3) return 'YEAR';
    if (months.size >= 3) return 'MONTH';
    if (dateMetadata && days.size >= 7 && hasDayHeader && weekdayCount(panel) >= 5) return 'DAY';
    return 'UNKNOWN';
  }
  function reliableDatePanel(panel) {
    if (!visible(panel)) return false;
    const mode = calendarMode(panel);
    if (mode === 'UNKNOWN') return false;
    const metadata = DATE_PANEL_METADATA_HINT.test(panelMetadata(panel));
    const hasYearNavigation = list(panel, NAV_SELECTOR)
      .some(candidate => visible(candidate) && DATE_PANEL_NAVIGATION_HINT.test(label(candidate)));
    return metadata || hasYearNavigation;
  }
  function findTrigger(context, runtime) {
    const element = context.descriptor?.element;
    const interaction = context.descriptor?.interactionElement;
    const raw = [
      { element: context.descriptor?.datePickerTrigger, source: 'descriptor.datePickerTrigger' },
      { element: interaction && interaction !== element ? interaction : null, source: 'descriptor.interactionElement' },
      ...list(element?.parentElement, TRIGGER_SELECTOR).map(candidate => ({ element: candidate, source: 'local-trigger' })),
    ];
    const seen = new Set();
    const candidates = raw.filter(candidate => candidate.element
      && candidate.element !== element
      && visible(candidate.element)
      && !seen.has(candidate.element)
      && seen.add(candidate.element));
    const selected = candidates.find(candidate => typeof runtime?.canClickLikeUser !== 'function'
      || runtime.canClickLikeUser(candidate.element, { purpose: 'date-picker-trigger' })) || null;
    return { candidates, selected };
  }

  function rawPanelCandidates(context) {
    const owner = context.descriptor?.element?.ownerDocument;
    const seen = new Set();
    return list(owner, PANEL_SELECTOR).filter(candidate => {
      const tag = text(candidate?.tagName).toLowerCase();
      return candidate
        && !['a', 'button', 'input', 'select', 'textarea', 'i', 'svg'].includes(tag)
        && !seen.has(candidate)
        && seen.add(candidate);
    });
  }

  function contains(left, right) {
    if (!left || !right) return false;
    try { return Boolean(left.contains?.(right)); }
    catch (_) { return false; }
  }

  function relatedByContainment(left, right) {
    return left === right || contains(left, right) || contains(right, left);
  }

  function hasCompleteInteractiveStructure(panel) {
    const mode = calendarMode(panel);
    if (mode === 'UNKNOWN') return false;
    const hasHeaderControl = list(panel, NAV_SELECTOR).some(candidate => visible(candidate)
      && (DATE_PANEL_NAVIGATION_HINT.test(label(candidate))
        || /(?:calendar|picker).*(?:prev|next|header)|(?:prev|next).*(?:year|month|decade)/i.test(panelMetadata(candidate))))
      || Boolean(findModeSwitch(panel, 'MONTH') || findModeSwitch(panel, 'YEAR'));
    const optionCount = partOptions(panel, mode).length;
    const requiredOptions = mode === 'DAY' ? 7 : 3;
    return hasHeaderControl && optionCount >= requiredOptions;
  }

  function canonicalPanel(cluster) {
    const complete = cluster.members.filter(candidate => reliableDatePanel(candidate)
      && hasCompleteInteractiveStructure(candidate));
    const pool = complete.length
      ? complete
      : cluster.members.filter(reliableDatePanel);
    if (!pool.length) return { panel: null, ambiguous: false };
    const innermost = pool.filter(candidate => !pool.some(other => other !== candidate && contains(candidate, other)));
    const candidates = innermost.length ? innermost : pool;
    return {
      panel: [...candidates]
        .sort((left, right) => list(left, PANEL_SELECTOR).length - list(right, PANEL_SELECTOR).length)[0] || null,
      // Nested wrapper + one inner grid is one structural owner. Two sibling
      // innermost grids are two equally-owned panels and must never be reduced
      // to DOM order during the initial popup selection.
      ambiguous: candidates.length > 1,
    };
  }

  function clusterPanels(rawCandidates) {
    const structural = rawCandidates.filter(reliableDatePanel);
    const clusters = [];
    structural.forEach(candidate => {
      const related = clusters.filter(cluster => cluster.members.some(member => relatedByContainment(member, candidate)));
      if (!related.length) {
        clusters.push({ members: [candidate], panel: null });
        return;
      }
      const target = related[0];
      target.members.push(candidate);
      related.slice(1).forEach(cluster => {
        target.members.push(...cluster.members);
        clusters.splice(clusters.indexOf(cluster), 1);
      });
    });
    return clusters.map(cluster => {
      const members = cluster.members.filter((member, index, source) => source.indexOf(member) === index);
      const canonical = canonicalPanel({ members });
      return {
        members,
        panel: canonical.panel,
        canonicalAmbiguous: canonical.ambiguous,
      };
    }).filter(cluster => cluster.panel);
  }

  function panelTopology(context) {
    const raw = rawPanelCandidates(context);
    const visibleRaw = raw.filter(visible);
    return { raw, visibleRaw, clusters: clusterPanels(visibleRaw) };
  }

  function panelSnapshot(context) {
    const raw = rawPanelCandidates(context);
    return {
      visibility: new Map(raw.map(candidate => [candidate, visible(candidate)])),
      modes: new Map(raw.map(candidate => [candidate, calendarMode(candidate)])),
    };
  }

  function controlledReference(context, trigger) {
    const owner = context.descriptor?.element?.ownerDocument;
    const controls = [trigger, context.descriptor?.interactionElement, context.descriptor?.element].filter(Boolean);
    for (const attributeName of ['aria-controls', 'aria-owns']) {
      const references = controls.flatMap(control => text(control.getAttribute?.(attributeName)).split(/\s+/).filter(Boolean));
      if (!references.length) continue;
      const targets = references.map(id => owner?.getElementById?.(id)).filter(Boolean)
        .filter((target, index, source) => source.indexOf(target) === index);
      return {
        authoritative: true,
        panel: targets.length === 1 ? targets[0] : null,
        evidence: attributeName,
        ambiguous: targets.length !== 1,
      };
    }
    return { authoritative: false, panel: null, evidence: '', ambiguous: false };
  }

  function updateTopologyDebug(debug, topology) {
    debug.rawPanelCandidateCount = topology.raw.length;
    debug.visiblePanelCandidateCount = topology.visibleRaw.length;
    debug.canonicalClusterCount = topology.clusters.length;
  }

  function canonicalPanelsForMode(cluster, targetMode) {
    const matching = cluster.members.filter(candidate => reliableDatePanel(candidate)
      && calendarMode(candidate) === targetMode);
    const modeToken = targetMode === 'DAY' ? 'date' : targetMode.toLowerCase();
    const preferred = matching.filter(candidate => {
      if (explicitCalendarMode(candidate) === targetMode || hasCompleteInteractiveStructure(candidate)) return true;
      const classes = text(candidate?.className?.baseVal ?? candidate?.className).split(/\s+/);
      return classes.includes(`ant-calendar-${modeToken}-panel`)
        || classes.includes(`ant-picker-${modeToken}-panel`);
    });
    const containers = (preferred.length ? preferred : matching).filter(candidate => ![
      'table', 'thead', 'tbody', 'tr', 'td', 'th', 'li',
    ].includes(text(candidate?.tagName).toLowerCase()));
    const pool = containers.length ? containers : (preferred.length ? preferred : matching);
    if (!pool.length) return [];
    const innermost = pool.filter(candidate => !pool.some(other => other !== candidate && contains(candidate, other)));
    return (innermost.length ? innermost : pool)
      .filter((candidate, index, source) => source.indexOf(candidate) === index);
  }

  function directPanelTransitionEvidence(panel, previousPanel, previousSnapshot, targetMode) {
    const visibility = previousSnapshot?.visibility || new Map();
    const modes = previousSnapshot?.modes || new Map();
    if (panel === previousPanel && modes.get(previousPanel) !== targetMode) return 'same-root-target-mode';
    if (visibility.get(panel) === false) return 'hidden-to-visible-target-mode';
    if (!visibility.has(panel)) return 'fresh-target-mode';
    if (modes.has(panel) && modes.get(panel) !== targetMode) return 'same-root-target-mode';
    return '';
  }

  function transitionEvidence(cluster, panel, previousPanel, previousSnapshot, targetMode) {
    const direct = directPanelTransitionEvidence(
      panel, previousPanel, previousSnapshot, targetMode,
    );
    if (direct) return direct;
    const visibility = previousSnapshot?.visibility || new Map();
    const modes = previousSnapshot?.modes || new Map();
    if (cluster.members.some(member => visibility.get(member) === false)) return 'hidden-to-visible-target-mode';
    if (cluster.members.some(member => !visibility.has(member))) return 'fresh-target-mode';
    if (modes.get(previousPanel) !== targetMode
      && cluster.members.some(member => relatedByContainment(member, previousPanel))) {
      return 'same-cluster-target-mode';
    }
    return '';
  }

  function selectTransitionPanel(context, trigger, previousPanel, previousSnapshot, targetMode, debug, historicalPanels) {
    const topology = panelTopology(context);
    updateTopologyDebug(debug, topology);
    const controlled = controlledReference(context, trigger);
    let eligible = [];
    let ignoredPanels = [];
    let canonicalTargetCount = 0;

    if (controlled.authoritative) {
      if (controlled.ambiguous || !controlled.panel || !visible(controlled.panel)) {
        return { panel: null, reasonCode: controlled.ambiguous ? 'PANEL_CLUSTER_AMBIGUOUS' : '', topology };
      }
      const owned = topology.clusters.filter(cluster => cluster.members
        .some(member => relatedByContainment(controlled.panel, member)));
      if (owned.length > 1) return { panel: null, reasonCode: 'PANEL_CLUSTER_AMBIGUOUS', topology };
      const candidates = owned.flatMap(cluster => canonicalPanelsForMode(cluster, targetMode)
        .map(panel => ({
          panel,
          cluster,
          evidence: directPanelTransitionEvidence(
            panel, previousPanel, previousSnapshot, targetMode,
          ),
        })))
        .filter((candidate, index, source) => source
          .findIndex(other => other.panel === candidate.panel) === index);
      canonicalTargetCount = candidates.length;
      const transitioned = candidates.filter(candidate => Boolean(candidate.evidence));
      const canIgnoreHistory = transitioned.length === 1 && candidates
        .filter(candidate => candidate !== transitioned[0])
        .every(candidate => historicalPanels?.has?.(candidate.panel));
      if (candidates.length > 1 && canIgnoreHistory) {
        eligible = transitioned;
        ignoredPanels = candidates
          .filter(candidate => candidate !== transitioned[0])
          .map(candidate => candidate.panel);
      } else {
        eligible = candidates.map(candidate => ({
          ...candidate,
          evidence: candidate.evidence || 'controlled-target-mode',
        }));
      }
    } else {
      eligible = topology.clusters.flatMap(cluster => canonicalPanelsForMode(cluster, targetMode)
        .map(panel => ({
          panel,
          cluster,
          evidence: transitionEvidence(cluster, panel, previousPanel, previousSnapshot, targetMode),
        })))
        .filter(candidate => Boolean(candidate.evidence));
      canonicalTargetCount = new Set(eligible.map(candidate => candidate.panel)).size;
    }

    const rawTargetCount = new Set(topology.clusters.flatMap(cluster => cluster.members)
      .filter(candidate => calendarMode(candidate) === targetMode)).size;
    const unique = eligible.filter((candidate, index, source) => source
      .findIndex(other => other.panel === candidate.panel) === index);
    debug.rawAfterTransition = rawTargetCount;
    debug.canonicalAfterTransition = canonicalTargetCount;
    if (unique.length > 1) return { panel: null, reasonCode: 'PANEL_CLUSTER_AMBIGUOUS', topology };
    if (unique.length !== 1) return { panel: null, reasonCode: '', topology };
    debug.modeAfterTransition = targetMode;
    debug.selectedAfterTransitionEvidence = unique[0].evidence;
    return {
      panel: unique[0].panel,
      reasonCode: '',
      topology,
      identityScope: {
        panel: unique[0].panel,
        targetMode,
        ignoredPanels,
      },
    };
  }

  function waitForTransitionPanel(context, trigger, previousPanel, previousSnapshot, targetMode, debug, historicalPanels) {
    if (debug.modeBeforeTransition === 'UNKNOWN') {
      const beforeMode = previousSnapshot?.modes?.get(previousPanel);
      debug.modeBeforeTransition = CALENDAR_MODES.has(beforeMode) ? beforeMode : calendarMode(previousPanel);
    }
    const choose = () => selectTransitionPanel(
      context, trigger, previousPanel, previousSnapshot, targetMode, debug, historicalPanels,
    );
    const immediate = choose();
    if (immediate.panel || immediate.reasonCode === 'PANEL_CLUSTER_AMBIGUOUS') return Promise.resolve(immediate);
    const owner = context.descriptor?.element?.ownerDocument;
    const rootNode = owner?.body || owner?.documentElement;
    const Observer = owner?.defaultView?.MutationObserver || globalThis.MutationObserver;
    if (!rootNode || typeof Observer !== 'function') return Promise.resolve(immediate);
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
        if (result.panel || result.reasonCode === 'PANEL_CLUSTER_AMBIGUOUS') finish(result);
      });
      observer.observe(rootNode, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class', 'style', 'hidden', 'aria-hidden', 'data-calendar-mode'],
      });
      timer = setTimeout(
        () => finish(choose()),
        Math.max(100, Math.min(5000, context.settings?.datePickerTimeoutMs || 1200)),
      );
    });
  }

  function isUnsupportedLegacyDecade(panel) {
    if (!panel || !visible(panel)) return false;
    if (panel.matches?.(LEGACY_DECADE_SELECTOR)) return true;
    return list(panel, LEGACY_DECADE_SELECTOR).some(visible);
  }

  function liveCanonicalPanelIdentity(context, trigger, expectedPanel, targetMode, debug, identityScope) {
    const topology = panelTopology(context);
    updateTopologyDebug(debug, topology);
    const controlled = controlledReference(context, trigger);
    let clusters = topology.clusters;
    let ownershipAmbiguous = false;
    if (controlled.authoritative) {
      if (controlled.ambiguous || !controlled.panel || !visible(controlled.panel)) {
        ownershipAmbiguous = true;
        clusters = [];
      } else {
        clusters = topology.clusters.filter(cluster => cluster.members
          .some(member => relatedByContainment(controlled.panel, member)));
        ownershipAmbiguous = clusters.length !== 1;
      }
    }
    const raw = new Set(clusters.flatMap(cluster => cluster.members)
      .filter(candidate => calendarMode(candidate) === targetMode));
    const canonical = clusters.flatMap(cluster => canonicalPanelsForMode(cluster, targetMode))
      .filter((candidate, index, source) => source.indexOf(candidate) === index);
    const ignored = identityScope?.panel === expectedPanel && identityScope?.targetMode === targetMode
      ? new Set(identityScope.ignoredPanels || [])
      : new Set();
    const activeCanonical = canonical.filter(candidate => !ignored.has(candidate));
    debug.rawAfterTransition = raw.size;
    debug.canonicalAfterTransition = canonical.length;
    const ok = !ownershipAmbiguous
      && canonical.includes(expectedPanel)
      && activeCanonical.length === 1
      && activeCanonical[0] === expectedPanel;
    debug.selectedAfterTransitionEvidence = ok
      ? 'live-canonical-unique'
      : 'live-canonical-ambiguous';
    return { ok, reasonCode: ok ? '' : 'PANEL_CLUSTER_AMBIGUOUS' };
  }

  function clickOwnedDateOption(context, runtime, trigger, panel, option, mode, expectedPart, debug, identityScope) {
    let lastCheck = liveCanonicalPanelIdentity(
      context, trigger, panel, mode, debug, identityScope,
    );
    if (!lastCheck.ok) return { clicked: false, reasonCode: lastCheck.reasonCode };
    const liveOwnerGuard = () => {
      lastCheck = liveCanonicalPanelIdentity(
        context, trigger, panel, mode, debug, identityScope,
      );
      return lastCheck.ok;
    };
    const clicked = runtime.clickLikeUser(option, {
      purpose: 'date-picker-option',
      ownerPanel: panel,
      calendarMode: mode,
      expectedPart,
      liveOwnerGuard,
    });
    if (clicked) return { clicked: true, reasonCode: '' };
    const finalCheck = liveCanonicalPanelIdentity(
      context, trigger, panel, mode, debug, identityScope,
    );
    return {
      clicked: false,
      reasonCode: finalCheck.ok ? lastCheck.reasonCode : finalCheck.reasonCode,
    };
  }

  function selectPanel(context, trigger, previousSnapshot, debug) {
    const topology = panelTopology(context);
    updateTopologyDebug(debug, topology);
    const controlled = controlledReference(context, trigger);
    if (controlled.authoritative) {
      if (controlled.ambiguous || !controlled.panel) {
        return { panel: null, reasonCode: 'PANEL_CLUSTER_AMBIGUOUS', topology };
      }
      if (!visible(controlled.panel)) return { panel: null, reasonCode: 'NO_PANEL_CANDIDATE', topology };
      const owned = topology.clusters.filter(cluster => cluster.members.some(member => relatedByContainment(controlled.panel, member)));
      if (owned.length > 1) return { panel: null, reasonCode: 'PANEL_CLUSTER_AMBIGUOUS', topology };
      if (owned[0]?.canonicalAmbiguous) return { panel: null, reasonCode: 'PANEL_CLUSTER_AMBIGUOUS', topology };
      debug.selectedClusterEvidence = controlled.evidence;
      // A controlled target is authoritative even when its semantics remain
      // UNKNOWN. Never fall back to a different fresh overlay in that case.
      return { panel: owned[0]?.panel || controlled.panel, reasonCode: '', topology };
    }

    const visibility = previousSnapshot?.visibility || new Map();
    const transitioned = topology.clusters.filter(cluster => cluster.members.some(member => visibility.get(member) === false));
    if (transitioned.length === 1) {
      if (transitioned[0].canonicalAmbiguous) return { panel: null, reasonCode: 'PANEL_CLUSTER_AMBIGUOUS', topology };
      debug.selectedClusterEvidence = 'hidden-to-visible';
      return { panel: transitioned[0].panel, reasonCode: '', topology };
    }
    if (transitioned.length > 1) return { panel: null, reasonCode: 'PANEL_CLUSTER_AMBIGUOUS', topology };

    const fresh = topology.clusters.filter(cluster => cluster.members.some(member => !visibility.has(member)));
    if (fresh.length === 1) {
      if (fresh[0].canonicalAmbiguous) return { panel: null, reasonCode: 'PANEL_CLUSTER_AMBIGUOUS', topology };
      debug.selectedClusterEvidence = 'fresh-cluster';
      return { panel: fresh[0].panel, reasonCode: '', topology };
    }
    if (fresh.length > 1) return { panel: null, reasonCode: 'MULTIPLE_UNRELATED_PANELS', topology };
    if (topology.clusters.length === 1) {
      if (topology.clusters[0].canonicalAmbiguous) return { panel: null, reasonCode: 'PANEL_CLUSTER_AMBIGUOUS', topology };
      debug.selectedClusterEvidence = 'unique-visible-cluster';
      return { panel: topology.clusters[0].panel, reasonCode: '', topology };
    }
    return {
      panel: null,
      reasonCode: topology.clusters.length > 1 ? 'MULTIPLE_UNRELATED_PANELS' : 'NO_PANEL_CANDIDATE',
      topology,
    };
  }

  function waitForPanel(context, trigger, previousSnapshot, timeoutMs, debug) {
    const immediate = selectPanel(context, trigger, previousSnapshot, debug);
    if (immediate.panel || immediate.reasonCode === 'MULTIPLE_UNRELATED_PANELS'
      || immediate.reasonCode === 'PANEL_CLUSTER_AMBIGUOUS') return Promise.resolve(immediate);
    const owner = context.descriptor?.element?.ownerDocument;
    const rootNode = owner?.body || owner?.documentElement;
    const Observer = owner?.defaultView?.MutationObserver || globalThis.MutationObserver;
    if (!rootNode || typeof Observer !== 'function') return Promise.resolve(immediate);
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
        const result = selectPanel(context, trigger, previousSnapshot, debug);
        if (result.panel || result.reasonCode === 'MULTIPLE_UNRELATED_PANELS'
          || result.reasonCode === 'PANEL_CLUSTER_AMBIGUOUS') finish(result);
      });
      observer.observe(rootNode, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class', 'style', 'aria-hidden'],
      });
      timer = setTimeout(
        () => finish(selectPanel(context, trigger, previousSnapshot, debug)),
        Math.max(100, Math.min(5000, timeoutMs || 1200)),
      );
    });
  }

  function rebindPanel(context, trigger, previousPanel, expectedMode, debug) {
    const topology = panelTopology(context);
    updateTopologyDebug(debug, topology);
    const controlled = controlledReference(context, trigger);
    if (controlled.authoritative) {
      if (controlled.ambiguous || !controlled.panel || !visible(controlled.panel)) return null;
      const owned = topology.clusters.filter(cluster => cluster.members.some(member => relatedByContainment(controlled.panel, member)));
      if (owned.length !== 1) return null;
      const modePanels = canonicalPanelsForMode(owned[0], expectedMode);
      return modePanels.length === 1 ? modePanels[0] : null;
    }
    if (reliableDatePanel(previousPanel) && calendarMode(previousPanel) === expectedMode) return previousPanel;
    const replacements = topology.clusters.flatMap(cluster => canonicalPanelsForMode(cluster, expectedMode))
      .filter(candidate => candidate !== previousPanel)
      .filter((candidate, index, source) => source.indexOf(candidate) === index);
    return replacements.length === 1 ? replacements[0] : null;
  }

  async function waitForReboundPanel(context, trigger, previousPanel, expectedMode, debug) {
    const immediate = rebindPanel(context, trigger, previousPanel, expectedMode, debug);
    if (immediate) return immediate;
    const owner = context.descriptor?.element?.ownerDocument;
    const rootNode = owner?.body || owner?.documentElement;
    const Observer = owner?.defaultView?.MutationObserver || globalThis.MutationObserver;
    if (!rootNode || typeof Observer !== 'function') return null;
    return new Promise(resolve => {
      let finished = false;
      let observer;
      let timer;
      const finish = panel => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        observer?.disconnect?.();
        resolve(panel);
      };
      observer = new Observer(() => {
        const panel = rebindPanel(context, trigger, previousPanel, expectedMode, debug);
        if (panel) finish(panel);
      });
      observer.observe(rootNode, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'aria-hidden', 'data-calendar-mode'] });
      timer = setTimeout(
        () => finish(rebindPanel(context, trigger, previousPanel, expectedMode, debug)),
        Math.max(100, Math.min(5000, context.settings?.datePickerTimeoutMs || 1200)),
      );
    });
  }
  function navigationMetadata(element) {
    const className = element?.className?.baseVal ?? element?.className;
    return [
      label(element),
      element?.id,
      className,
      element?.getAttribute?.('data-calendar-nav'),
      element?.getAttribute?.('data-role'),
    ].map(text).filter(Boolean).join(' ');
  }
  function findNavigation(panel, direction, unit = 'year') {
    const candidates = list(panel, NAV_SELECTOR).filter(visible);
    const expectedAttribute = `${direction < 0 ? 'previous' : 'next'}-${unit}`;
    const labelPattern = unit === 'decade'
      ? (direction < 0 ? /上一组年份|上一年代|前十年|previous\s*decade|prev\s*decade/i : /下一组年份|下一年代|后十年|next\s*decade/i)
      : (direction < 0 ? /上一年|前一年|previous\s*year|prev\s*year/i : /下一年|后一年|next\s*year/i);
    const classPattern = unit === 'decade'
      ? (direction < 0 ? /(?:super[-_ ]?prev|(?:prev|previous)[-_ ]?(?:decade|years))/i : /(?:super[-_ ]?next|next[-_ ]?(?:decade|years))/i)
      : (direction < 0 ? /(?:super[-_ ]?prev|prev[-_ ]?year|previous[-_ ]?year)/i : /(?:super[-_ ]?next|next[-_ ]?year)/i);
    return candidates.find(candidate => {
      const attribute = text(candidate.getAttribute?.('data-calendar-nav')).toLowerCase();
      const metadata = navigationMetadata(candidate);
      if (attribute) return attribute === expectedAttribute;
      return labelPattern.test(label(candidate)) || classPattern.test(metadata);
    }) || null;
  }
  function modeSwitchEvidence(candidate, targetMode) {
    const target = text(targetMode).toUpperCase();
    if (!['MONTH', 'YEAR'].includes(target)) return null;
    const explicit = text(candidate?.getAttribute?.('data-calendar-mode-switch')).toUpperCase();
    if (['MONTH', 'YEAR'].includes(explicit)) {
      return explicit === target
        ? { target, source: 'EXPLICIT_ATTRIBUTE', semantic: true }
        : null;
    }
    const className = text(candidate?.className?.baseVal ?? candidate?.className);
    const metadata = [className, candidate?.id, candidate?.getAttribute?.('data-role')]
      .map(text).filter(Boolean).join(' ');
    const structural = target === 'MONTH'
      ? /(?:ant-picker-month-btn|ant-calendar-month-select|month[-_ ]?(?:select|btn|switch))/i
      : /(?:ant-picker-year-btn|ant-calendar-year-select|year[-_ ]?(?:select|btn|switch))/i;
    if (!structural.test(metadata)) return null;
    const semantic = target === 'MONTH'
      ? /^(?:0?[1-9]|1[0-2])月$|月份|选择月份|month/i
      : /^(?:(?:19|20|21)\d{2}年?|年份|选择年份|year)/i;
    const source = /ant-calendar-(?:month|year)-select/i.test(metadata)
      ? 'LEGACY_ANT_CLASS'
      : /ant-picker-(?:month|year)-btn/i.test(metadata)
        ? 'MODERN_ANT_CLASS'
        : 'GENERIC_CLASS';
    return { target, source, semantic: semantic.test(label(candidate)) };
  }

  function modeSwitchKind(candidate, targetMode) {
    const tag = text(candidate?.tagName).toUpperCase();
    const kind = ['BUTTON', 'A', 'SPAN', 'DIV'].includes(tag)
      ? (tag === 'A' ? 'ANCHOR' : tag)
      : 'OTHER';
    return `${targetMode}_${kind}`;
  }

  function inspectModeSwitches(panel) {
    const visibleCandidates = list(panel, MODE_SWITCH_SELECTOR).filter(visible);
    const month = [];
    const year = [];
    const headerCandidates = new Set();
    const candidateKinds = new Set();
    const rejectionReasons = new Set();

    for (const candidate of visibleCandidates) {
      const evidences = ['MONTH', 'YEAR']
        .map(target => modeSwitchEvidence(candidate, target))
        .filter(Boolean);
      if (!evidences.length) continue;
      headerCandidates.add(candidate);
      for (const evidence of evidences) candidateKinds.add(modeSwitchKind(candidate, evidence.target));
      if (candidate.disabled || candidate.getAttribute?.('aria-disabled') === 'true') {
        rejectionReasons.add('DISABLED_CANDIDATE');
        continue;
      }
      for (const evidence of evidences) {
        if (!evidence.semantic) {
          rejectionReasons.add(`${evidence.target}_SEMANTIC_LABEL_MISMATCH`);
          continue;
        }
        (evidence.target === 'MONTH' ? month : year).push({
          element: candidate,
          source: evidence.source,
        });
      }
    }

    if (!headerCandidates.size) rejectionReasons.add('NO_HEADER_CANDIDATE');
    if (month.length > 1) rejectionReasons.add('MULTIPLE_MONTH_SWITCH_CANDIDATES');
    if (year.length > 1) rejectionReasons.add('MULTIPLE_YEAR_SWITCH_CANDIDATES');
    if (!month.length && !year.length && !rejectionReasons.size) {
      rejectionReasons.add('NO_MATCHING_MODE_SWITCH');
    }

    return {
      month,
      year,
      debug: {
        panelMode: calendarMode(panel),
        headerCandidateCount: headerCandidates.size,
        monthSwitchCandidateCount: month.length,
        yearSwitchCandidateCount: year.length,
        candidateKinds: [...candidateKinds],
        rejectionReasons: [...rejectionReasons],
        selectedSwitchSource: '',
        safetyReason: '',
      },
    };
  }

  function findModeSwitch(panel, targetMode) {
    const target = text(targetMode).toUpperCase();
    const inspection = inspectModeSwitches(panel);
    const candidates = target === 'MONTH' ? inspection.month : target === 'YEAR' ? inspection.year : [];
    return candidates.length === 1 ? candidates[0].element : null;
  }
  function dayOptionAncestorsAreCurrent(element, ownerPanel) {
    let node = element;
    while (node) {
      const className = text(node?.className?.baseVal ?? node?.className);
      if (node.disabled || node.getAttribute?.('aria-disabled') === 'true'
        || DISABLED_HINT.test(className) || OUTSIDE_MONTH_HINT.test(className)
        || node.getAttribute?.('data-outside-month') === 'true'
        || node.getAttribute?.('data-current-month') === 'false') return false;
      if (node === ownerPanel) return true;
      node = node.parentElement;
    }
    // Some framework/test facades expose containment without a traversable
    // parentElement chain. Ownership is still independently required by the
    // caller; in that case retain the element-level checks above.
    try { return Boolean(ownerPanel?.contains?.(element)); }
    catch (_) { return false; }
  }
  function dayOptionIsCurrent(element, parsed, ownerPanel) {
    if (!visible(element) || !dayOptionAncestorsAreCurrent(element, ownerPanel)) return false;
    const className = text(element?.className?.baseVal ?? element?.className);
    const fullDateLabels = optionLabels(element)
      .map(value => value.match(/((?:19|20|21)\d{2})年(1[0-2]|0?[1-9])月([12]\d|3[01]|0?[1-9])日?/))
      .filter(Boolean);
    if (fullDateLabels.length && !fullDateLabels.some(match => Number(match[1]) === parsed.year
      && Number(match[2]) === parsed.month
      && Number(match[3]) === parsed.day)) return false;
    return element.getAttribute?.('data-current-month') === 'true' || fullDateLabels.length > 0
      || (!OUTSIDE_MONTH_HINT.test(className) && !DISABLED_HINT.test(className));
  }
  function exactActual(context, parsed) {
    const dateRules = dates(context);
    const runtime = events(context);
    const actual = runtime?.readControlValue
      ? runtime.readControlValue(context.descriptor)
      : context.descriptor?.element?.value;
    const resolved = dateRules?.parseDateValue?.(actual);
    if (!resolved || resolved.precision !== parsed.precision) return null;
    if (resolved.year !== parsed.year || resolved.month !== parsed.month) return null;
    if (parsed.precision === 'day' && resolved.day !== parsed.day) return null;
    return actual;
  }

  function finishDate(context, trigger, debug, result, reasonCode) {
    debug.finalReasonCode = reasonCode;
    const datePickerDebug = rememberDebugTrace(context, trigger, debug);
    return { ...result, reasonCode, datePickerDebug };
  }

  function failDate(context, trigger, debug, reasonCode, reason, strategy = 'date-picker') {
    return finishDate(context, trigger, debug, {
      ok: false, status: 'NEEDS_CONFIRMATION', reason, strategy,
    }, reasonCode);
  }

  function panelFailureReason(reasonCode) {
    if (reasonCode === 'MULTIPLE_UNRELATED_PANELS') return '存在多个互不相关的可见日期面板，无法确认字段所有权';
    if (reasonCode === 'PANEL_CLUSTER_AMBIGUOUS') return '日期面板候选簇无法唯一归属当前字段';
    return '未发现可见日期面板';
  }

  async function chooseDate(context, parsed) {
    const runtime = events(context);
    const debug = createDebugTrace();
    let trigger = null;
    if (context.descriptor?.datePickerAmbiguous) {
      return failDate(context, trigger, debug, 'PANEL_TRIGGER_AMBIGUOUS', '当前字段存在多个无法区分的局部日期触发器', 'date-picker-ambiguous');
    }
    if (!runtime?.clickLikeUser || !['month', 'day'].includes(parsed?.precision)) {
      return failDate(context, trigger, debug, 'UNSUPPORTED_DATE_PRECISION', '目标日期精度无法可靠解释');
    }
    const triggerResolution = findTrigger(context, runtime);
    debug.triggerCandidateCount = triggerResolution.candidates.length;
    trigger = triggerResolution.selected?.element || null;
    debug.selectedTriggerSource = triggerResolution.selected?.source || '';
    if (!trigger) return failDate(context, trigger, debug, 'NO_TRIGGER_CANDIDATE', '未找到可靠日期触发器');
    const previousSnapshot = panelSnapshot(context);
    if (!runtime.clickLikeUser(trigger, { purpose: 'date-picker-trigger' })) {
      return failDate(context, trigger, debug, 'TRIGGER_REJECTED', '日期面板无法安全打开');
    }
    await nextRender(trigger);
    const selection = await waitForPanel(context, trigger, previousSnapshot, context.settings?.datePickerTimeoutMs, debug);
    let panel = selection.panel;
    if (!panel) {
      const reasonCode = selection.reasonCode || 'NO_PANEL_CANDIDATE';
      return failDate(context, trigger, debug, reasonCode, panelFailureReason(reasonCode));
    }

    const maxTransitions = Number.isFinite(context.settings?.maxCalendarModeTransitions)
      ? Math.max(0, Math.min(4, Math.floor(context.settings.maxCalendarModeTransitions)))
      : 3;
    const maxYearSteps = Number.isFinite(context.settings?.maxYearNavigationSteps)
      ? Math.max(0, Math.floor(context.settings.maxYearNavigationSteps))
      : 30;
    let transitions = 0;
    const historicalPanels = new Set();
    let identityScope = null;

    while (transitions <= maxTransitions) {
      if (isUnsupportedLegacyDecade(panel)) {
        return failDate(context, trigger, debug, 'UNSUPPORTED_DECADE_MODE', '不支持自动操作年代选择面板', 'date-picker-mode');
      }
      const mode = calendarMode(panel);
      // 诊断字段记录首次选中的 canonical panel 模式；后续状态转移由
      // transitionCount 描述，避免最终模式覆盖初始面板证据。
      if (debug.selectedPanelMode === 'UNKNOWN') debug.selectedPanelMode = mode;
      debug.transitionCount = transitions;
      if (mode === 'UNKNOWN') {
        return failDate(context, trigger, debug, 'UNKNOWN_PANEL_MODE', '日期面板模式无法可靠确认', 'date-picker-mode');
      }

      if (mode === 'DAY') {
        const header = panelYearMonth(panel);
        const needsMonthMode = parsed.precision === 'month'
          || header.year !== parsed.year
          || header.month !== parsed.month;
        if (needsMonthMode) {
          if (transitions >= maxTransitions) {
            return failDate(context, trigger, debug, 'PANEL_TRANSITION_LIMIT', '日期面板模式切换超出安全上限', 'date-picker-mode-limit');
          }
          const switchInspection = inspectModeSwitches(panel);
          const monthRecord = switchInspection.month.length === 1
            ? switchInspection.month[0]
            : null;
          const yearRecord = switchInspection.year.length === 1
            ? switchInspection.year[0]
            : null;
          const monthSwitch = monthRecord?.element || null;
          const yearSwitch = yearRecord?.element || null;
          const modeSwitch = monthSwitch || yearSwitch;
          const targetMode = monthSwitch ? 'MONTH' : 'YEAR';
          const selectedRecord = monthRecord || yearRecord;
          debug.modeSwitchDebug = {
            ...switchInspection.debug,
            selectedSwitchSource: selectedRecord?.source || '',
          };
          const previousPanel = panel;
          const transitionSnapshot = panelSnapshot(context);
          const modeSwitchSettings = {
            purpose: 'date-picker-mode-switch', ownerPanel: panel, calendarMode: 'DAY', targetMode,
            liveOwnerGuard: () => findModeSwitch(panel, targetMode) === modeSwitch,
          };
          const clicked = modeSwitch && runtime.clickLikeUser(modeSwitch, modeSwitchSettings);
          if (!clicked) {
            if (modeSwitch) {
              const refreshed = inspectModeSwitches(panel);
              debug.modeSwitchDebug = {
                ...refreshed.debug,
                selectedSwitchSource: selectedRecord?.source || '',
                rejectionReasons: [
                  ...refreshed.debug.rejectionReasons,
                  'SAFETY_REJECTED',
                ],
                safetyReason: runtime.clickSafetyReason?.(modeSwitch, modeSwitchSettings) || '',
              };
            }
            return failDate(context, trigger, debug, 'NO_MONTH_MODE_SWITCH', '当前日期面板没有可靠的月份模式开关', 'date-picker-mode-switch');
          }
          historicalPanels.add(previousPanel);
          await nextRender(modeSwitch);
          const rebound = await waitForTransitionPanel(
            context, trigger, previousPanel, transitionSnapshot, targetMode, debug, historicalPanels,
          );
          panel = rebound.panel;
          identityScope = rebound.identityScope || null;
          transitions += 1;
          debug.transitionCount = transitions;
          if (rebound.reasonCode) {
            return failDate(context, trigger, debug, rebound.reasonCode,
              panelFailureReason(rebound.reasonCode), 'date-picker-transition');
          }
          if (!panel || calendarMode(panel) !== targetMode) {
            return failDate(context, trigger, debug, 'UNKNOWN_PANEL_MODE', '切换后未进入可靠日期模式面板', 'date-picker-transition');
          }
          continue;
        }

        const dayCandidates = partOptions(panel, 'DAY')
          .filter(option => partNumber(option, 'DAY') === parsed.day)
          .filter(option => dayOptionIsCurrent(option, parsed, panel));
        const dayClick = dayCandidates.length === 1
          ? clickOwnedDateOption(
            context, runtime, trigger, panel, dayCandidates[0], 'DAY', parsed.day, debug, identityScope,
          )
          : { clicked: false, reasonCode: '' };
        if (!dayClick.clicked) {
          if (dayClick.reasonCode) {
            return failDate(context, trigger, debug, dayClick.reasonCode,
              panelFailureReason(dayClick.reasonCode), 'date-picker-day');
          }
          return failDate(context, trigger, debug, 'TARGET_DAY_NOT_FOUND', '目标日期单元格不唯一或无法安全选择', 'date-picker-day');
        }
        await nextRender(dayCandidates[0]);
        const committed = exactActual(context, parsed);
        return committed !== null
          ? finishDate(context, trigger, debug, { ok: true, status: 'SUCCESS', reason: '', actualValue: committed, strategy: 'date-picker-day' }, 'SUCCESS')
          : failDate(context, trigger, debug, 'READBACK_FAILED', '选择日期后页面未写入精确日期', 'date-picker-day');
      }

      if (mode === 'YEAR') {
        if (transitions >= maxTransitions) {
          return failDate(context, trigger, debug, 'PANEL_TRANSITION_LIMIT', '日期面板模式切换超出安全上限', 'date-picker-mode-limit');
        }
        let yearOptions = partOptions(panel, 'YEAR');
        const maxDecadeSteps = Number.isFinite(context.settings?.maxYearGridNavigationSteps)
          ? Math.max(0, Math.min(20, Math.floor(context.settings.maxYearGridNavigationSteps)))
          : 12;
        let decadeSteps = 0;
        while (!yearOptions.some(option => partNumber(option, 'YEAR') === parsed.year) && decadeSteps < maxDecadeSteps) {
          const values = yearOptions.map(option => partNumber(option, 'YEAR')).filter(Number.isInteger);
          if (!values.length) break;
          const direction = parsed.year < Math.min(...values) ? -1 : parsed.year > Math.max(...values) ? 1 : 0;
          if (!direction) break;
          const nav = findNavigation(panel, direction, 'decade');
          if (!nav || !runtime.clickLikeUser(nav, {
            purpose: 'date-picker-navigation', ownerPanel: panel, calendarMode: 'YEAR',
            navigationUnit: 'decade', direction,
          })) {
            return failDate(context, trigger, debug, 'NO_YEAR_NAVIGATION', '无法安全导航目标年份', 'date-picker-year');
          }
          const previousPanel = panel;
          await nextRender(nav);
          panel = await waitForReboundPanel(context, trigger, previousPanel, 'YEAR', debug);
          decadeSteps += 1;
          if (!panel || calendarMode(panel) !== 'YEAR') break;
          yearOptions = partOptions(panel, 'YEAR');
        }
        const yearOption = yearOptions.find(option => partNumber(option, 'YEAR') === parsed.year);
        const previousPanel = panel;
        const transitionSnapshot = panelSnapshot(context);
        const yearClick = yearOption
          ? clickOwnedDateOption(
            context, runtime, trigger, panel, yearOption, 'YEAR', parsed.year, debug, identityScope,
          )
          : { clicked: false, reasonCode: '' };
        if (!yearClick.clicked) {
          if (yearClick.reasonCode) {
            return failDate(context, trigger, debug, yearClick.reasonCode,
              panelFailureReason(yearClick.reasonCode), 'date-picker-year');
          }
          return failDate(context, trigger, debug, 'TARGET_YEAR_NOT_FOUND', '未找到可安全选择的目标年份', 'date-picker-year');
        }
        historicalPanels.add(previousPanel);
        await nextRender(yearOption);
        const committed = exactActual(context, parsed);
        if (committed !== null) {
          return finishDate(context, trigger, debug, { ok: true, status: 'SUCCESS', reason: '', actualValue: committed, strategy: 'date-picker-year' }, 'SUCCESS');
        }
        const rebound = await waitForTransitionPanel(
          context, trigger, previousPanel, transitionSnapshot, 'MONTH', debug, historicalPanels,
        );
        panel = rebound.panel;
        identityScope = rebound.identityScope || null;
        transitions += 1;
        debug.transitionCount = transitions;
        if (rebound.reasonCode) {
          return failDate(context, trigger, debug, rebound.reasonCode,
            panelFailureReason(rebound.reasonCode), 'date-picker-transition');
        }
        if (!panel || calendarMode(panel) !== 'MONTH') {
          return failDate(context, trigger, debug, 'UNKNOWN_PANEL_MODE', '选择年份后未进入可靠月份面板', 'date-picker-transition');
        }
        continue;
      }

      if (mode === 'MONTH') {
        let currentYear = yearFrom(panel);
        if (!Number.isInteger(currentYear)) {
          return failDate(context, trigger, debug, 'UNKNOWN_PANEL_MODE', '无法确认日期面板年份', 'date-picker-month');
        }
        if (Math.abs(parsed.year - currentYear) > maxYearSteps) {
          return failDate(context, trigger, debug, 'NO_YEAR_NAVIGATION', '目标年份超出安全导航步数', 'date-picker-year-limit');
        }
        let steps = 0;
        while (currentYear !== parsed.year && steps < maxYearSteps) {
          const direction = parsed.year < currentYear ? -1 : 1;
          const nav = findNavigation(panel, direction);
          if (!nav || !runtime.clickLikeUser(nav, {
            purpose: 'date-picker-navigation', ownerPanel: panel, calendarMode: 'MONTH',
            navigationUnit: 'year', direction,
          })) {
            return failDate(context, trigger, debug, 'NO_YEAR_NAVIGATION', '无法安全导航日期年份', 'date-picker-year');
          }
          steps += 1;
          const previousPanel = panel;
          await nextRender(nav);
          panel = await waitForReboundPanel(context, trigger, previousPanel, 'MONTH', debug);
          if (!panel) {
            return failDate(context, trigger, debug, 'NO_YEAR_NAVIGATION', '年份导航后无法重新绑定日期面板', 'date-picker-year');
          }
          const nextYear = yearFrom(panel);
          if (calendarMode(panel) !== 'MONTH' || !Number.isInteger(nextYear) || nextYear === currentYear) {
            return failDate(context, trigger, debug, 'NO_YEAR_NAVIGATION', '日期年份点击后没有可靠变化', 'date-picker-year');
          }
          currentYear = nextYear;
        }
        if (currentYear !== parsed.year) {
          return failDate(context, trigger, debug, 'TARGET_YEAR_NOT_FOUND', '日期年份未到达目标值', 'date-picker-year-limit');
        }

        const monthOption = partOptions(panel, 'MONTH').find(option => partNumber(option, 'MONTH') === parsed.month);
        const previousPanel = panel;
        const transitionSnapshot = panelSnapshot(context);
        const monthClick = monthOption
          ? clickOwnedDateOption(
            context, runtime, trigger, panel, monthOption, 'MONTH', parsed.month, debug, identityScope,
          )
          : { clicked: false, reasonCode: '' };
        if (!monthClick.clicked) {
          if (monthClick.reasonCode) {
            return failDate(context, trigger, debug, monthClick.reasonCode,
              panelFailureReason(monthClick.reasonCode), 'date-picker-month');
          }
          return failDate(context, trigger, debug, 'TARGET_MONTH_NOT_FOUND', '未找到可安全选择的目标月份', 'date-picker-month');
        }
        historicalPanels.add(previousPanel);
        await nextRender(monthOption);
        const committed = exactActual(context, parsed);
        if (committed !== null) {
          return finishDate(context, trigger, debug, { ok: true, status: 'SUCCESS', reason: '', actualValue: committed, strategy: 'date-picker-month' }, 'SUCCESS');
        }
        if (parsed.precision === 'month') {
          return failDate(context, trigger, debug, 'READBACK_FAILED', '选择月份后页面未写入精确年月', 'date-picker-month');
        }
        const rebound = await waitForTransitionPanel(
          context, trigger, previousPanel, transitionSnapshot, 'DAY', debug, historicalPanels,
        );
        panel = rebound.panel;
        identityScope = rebound.identityScope || null;
        if (rebound.reasonCode) {
          return failDate(context, trigger, debug, rebound.reasonCode,
            panelFailureReason(rebound.reasonCode), 'date-picker-transition');
        }
        if (transitions >= maxTransitions || !panel || calendarMode(panel) !== 'DAY') {
          return failDate(context, trigger, debug, 'UNKNOWN_PANEL_MODE', '选择月份后未进入可靠日期面板', 'date-picker-transition');
        }
        transitions += 1;
        debug.transitionCount = transitions;
        continue;
      }
    }

    return failDate(context, trigger, debug, 'PANEL_TRANSITION_LIMIT', '日期面板模式切换超出安全上限', 'date-picker-mode-limit');
  }

  const adapter = {
    id: 'date-like',
    priority: 600,
    capabilities: Object.freeze(['write-value', 'open', 'navigate-year', 'select-year', 'select-month', 'select-day', 'verify']),
    getDebugTrace,
    supports(context) {
      const descriptor = context?.descriptor || {};
      const kind = text(descriptor.controlKind || descriptor.type || descriptor.baseControlKind).toLowerCase();
      const inputType = text(descriptor.inputType || descriptor.element?.type).toLowerCase();
      return ['date', 'month'].includes(kind) || ['date', 'month'].includes(inputType) || text(context?.expectedType).toLowerCase() === 'date';
    },
    read(context) {
      const runtime = events(context);
      return runtime?.readControlValue ? runtime.readControlValue(context.descriptor) : context?.descriptor?.element?.value;
    },
    async write(context) {
      const dateRules = dates(context);
      const runtime = events(context);
      if (!dateRules?.formatDateForField || !dateRules?.parseDateValue) {
        return { handled: true, ok: false, status: 'FAILED', reason: 'DateRules 不可用', strategy: 'date-like' };
      }
      const formatted = dateRules.formatDateForField(context.value, context.descriptor);
      if (!formatted.ok) {
        return { handled: true, ok: false, status: 'NEEDS_CONFIRMATION', reason: formatted.reason, strategy: 'date-format' };
      }
      const element = context.descriptor?.element;
      const readOnly = Boolean(context.descriptor?.readOnly || element?.readOnly || element?.getAttribute?.('aria-readonly') === 'true');
      if (!readOnly && runtime?.setNativeValue) {
        const direct = await runtime.setNativeValue(context.descriptor, formatted.value, {
          kind: text(context.descriptor?.controlKind || context.descriptor?.type),
        });
        if (direct?.ok) {
          return { handled: true, ok: true, status: 'SUCCESS', reason: '', actualValue: direct.afterValue, strategy: 'date-native-value' };
        }
      }
      const picker = await chooseDate(context, formatted.parsed);
      return { handled: true, ...picker };
    },
    verify(context) {
      const runtime = verifier(context);
      if (!runtime?.verify) return { ok: false, status: 'FAILED', reason: 'VerificationEngine 不可用' };
      return runtime.verify(context.descriptor, context.value, {
        ...context.settings,
        fieldPath: context.fieldPath,
        expectedType: 'date',
      });
    },
  };

  return Object.freeze(adapter);
});
