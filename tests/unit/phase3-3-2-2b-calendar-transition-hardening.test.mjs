import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const DateLike = require('../../src/controls/adapters/date-like-adapter.js');
const Events = require('../../src/core/event-dispatcher.js');
const FieldDetector = require('../../src/core/field-detector.js');

const parts = selector => String(selector || '').split(',').map(value => value.trim()).filter(Boolean);

function matches(node, selector) {
  const source = String(selector || '').trim();
  if (!source) return false;
  const tag = source.match(/^[a-z][a-z0-9-]*/i)?.[0];
  if (tag && node.tagName !== tag.toUpperCase()) return false;
  if (source.startsWith('.')) {
    const wanted = source.slice(1).split(/[\[:]/)[0];
    if (!String(node.className).split(/\s+/).includes(wanted)) return false;
  }
  for (const match of source.matchAll(/\[([^\]=*]+)(?:([*]?=)"([^"]*)")?\]/g)) {
    const [, name, operator, expected] = match;
    const actual = name === 'class' ? node.className : node.getAttribute(name);
    if (!operator && (actual === null || actual === undefined)) return false;
    if (operator === '=' && String(actual) !== expected) return false;
    if (operator === '*=' && !String(actual || '').includes(expected)) return false;
  }
  return Boolean(tag || source.startsWith('.') || source.startsWith('['));
}

function hiddenByTree(node) {
  for (let current = node; current; current = current.parentElement) {
    if (current.hidden || current.getAttribute?.('aria-hidden') === 'true') return true;
  }
  return false;
}

class Node {
  constructor(tagName = 'DIV', options = {}) {
    this.tagName = String(tagName).toUpperCase();
    this.type = options.type || '';
    this.id = options.id || '';
    this.className = options.className || '';
    this._text = options.text || '';
    this.hidden = Boolean(options.hidden);
    this.disabled = Boolean(options.disabled);
    this.readOnly = Boolean(options.readOnly);
    this.value = options.value || '';
    this.isConnected = true;
    this.parentElement = null;
    this.ownerDocument = null;
    this.children = [];
    this.attributes = new Map(Object.entries(options.attributes || {}));
    this.onClick = options.onClick || null;
    this.clickCount = 0;
  }
  get textContent() { return [this._text, ...this.children.map(child => child.textContent)].filter(Boolean).join(' '); }
  set textContent(value) { this._text = String(value || ''); }
  get innerText() { return this.textContent; }
  set innerText(value) { this._text = String(value || ''); }
  getAttribute(name) {
    if (name === 'id') return this.id || null;
    if (name === 'class') return this.className || null;
    if (name === 'type') return this.type || null;
    return this.attributes.get(name) ?? null;
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); this.ownerDocument?.notify?.(); }
  append(...children) {
    children.flat().filter(Boolean).forEach(child => {
      child.parentElement = this;
      child.isConnected = true;
      this.children.push(child);
      bind(this.ownerDocument, child);
    });
    this.ownerDocument?.notify?.();
    return this;
  }
  replaceChildren(...children) {
    this.children.forEach(child => { child.parentElement = null; child.isConnected = false; });
    this.children = [];
    return this.append(...children);
  }
  contains(other) { return other === this || this.children.some(child => child.contains?.(other)); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  querySelectorAll(selector) {
    const found = [];
    const visit = current => current.children.forEach(child => { found.push(child); visit(child); });
    visit(this);
    const selectors = parts(selector);
    return found.filter(node => selectors.some(item => matches(node, item)));
  }
  matches(selector) { return parts(selector).some(item => matches(this, item)); }
  closest(selector) {
    for (let current = this; current; current = current.parentElement) if (current.matches(selector)) return current;
    return null;
  }
  getRootNode() { return this.ownerDocument; }
  getBoundingClientRect() {
    const shown = !hiddenByTree(this);
    return { width: shown ? 180 : 0, height: shown ? 32 : 0, left: 0, top: 0, right: shown ? 180 : 0, bottom: shown ? 32 : 0 };
  }
  focus() {}
  blur() {}
  dispatchEvent() { return true; }
  click() { this.clickCount += 1; this.onClick?.(this); }
}

function bind(document, node) {
  if (!document || !node) return node;
  node.ownerDocument = document;
  node.children.forEach(child => bind(document, child));
  return node;
}

function documentFixture() {
  const observers = new Set();
  class MutationObserver {
    constructor(callback) { this.callback = callback; }
    observe() { observers.add(this); }
    disconnect() { observers.delete(this); }
  }
  class Event { constructor(type, init = {}) { this.type = type; Object.assign(this, init); } }
  const document = {
    nodeType: 9,
    body: null,
    documentElement: null,
    notify() { queueMicrotask(() => [...observers].forEach(observer => observer.callback([]))); },
    defaultView: {
      Event, MouseEvent: Event, PointerEvent: Event, FocusEvent: Event, MutationObserver,
      requestAnimationFrame(callback) { callback(); },
      getComputedStyle(node) {
        return hiddenByTree(node)
          ? { display: 'none', visibility: 'hidden', opacity: '0' }
          : { display: 'block', visibility: 'visible', opacity: '1' };
      },
    },
    querySelectorAll(selector) { return this.body.querySelectorAll(selector); },
    getElementById(id) { return this.querySelectorAll('[id]').find(node => node.id === id) || null; },
  };
  document.body = bind(document, new Node('BODY'));
  document.documentElement = bind(document, new Node('HTML'));
  return document;
}

function action(label, options = {}) {
  return new Node(options.tagName || 'BUTTON', {
    type: options.tagName === 'A' ? '' : 'button',
    text: label,
    className: options.className || '',
    attributes: options.attributes || {},
    onClick: options.onClick,
  });
}

function descriptor(input, trigger, label = '入学时间') {
  return {
    detectorId: `field-${label}`,
    element: input,
    interactionElement: input,
    elements: [input],
    controlKind: 'text', baseControlKind: 'text', inputType: 'text',
    visible: true, hidden: false, disabled: false, readOnly: true,
    interactiveReadonly: true, readonlyInteractionKind: 'date-like',
    datePickerTrigger: trigger, datePickerAmbiguous: false,
    labelText: label, labelSource: 'form-item-label',
    placeholder: `请选择${label}`, semanticPlaceholder: label,
  };
}

function dayPanel(year, month, onSwitch, onDay) {
  const panel = new Node('DIV', { className: 'ant-calendar-date-panel' });
  const header = new Node('DIV', { className: 'ant-calendar-header' });
  header.append(new Node('STRONG', { text: `${year}年${month}月` }));
  header.append(action(`${month}月`, {
    className: 'ant-calendar-month-select',
    attributes: { 'aria-label': '选择月份' },
    onClick: onSwitch,
  }));
  const body = new Node('TABLE', { className: 'ant-calendar-table' });
  for (const weekday of ['日', '一', '二', '三', '四', '五', '六']) {
    body.append(new Node('TH', { text: weekday, className: 'ant-calendar-column-header', attributes: { role: 'columnheader' } }));
  }
  for (let day = 1; day <= 31; day += 1) {
    body.append(action(String(day), {
      className: 'date-cell',
      attributes: { role: 'gridcell', 'data-calendar-day-option': String(day), 'data-current-month': 'true' },
      onClick: typeof onDay === 'function' ? () => onDay(day) : undefined,
    }));
  }
  panel.append(header, body);
  return panel;
}

function monthPanel(fixture, options = {}) {
  const panel = options.reuse || new Node('DIV', { className: options.legacy === false ? 'ant-picker-panel date-picker-panel' : 'ant-calendar-month-panel' });
  if (options.legacy === false) panel.setAttribute('data-calendar-mode', 'MONTH');
  panel.setAttribute('data-calendar-year', String(fixture.year));
  const header = new Node('DIV', { className: options.legacy === false ? 'ant-picker-header' : 'ant-calendar-month-panel-header' });
  header.append(action('上一年', {
    className: options.legacy === false ? 'ant-picker-header-super-prev-btn' : 'ant-calendar-month-panel-prev-year-btn',
    attributes: { 'aria-label': '上一年', 'data-calendar-nav': 'previous-year' },
  }), new Node('STRONG', { text: `${fixture.year}年` }));
  const table = new Node('TABLE', { className: options.legacy === false ? 'month-grid' : 'ant-calendar-month-panel-table' });
  for (let value = 1; value <= 12; value += 1) {
    table.append(action(`${value}月`, {
      tagName: options.legacy === false ? 'BUTTON' : 'TD',
      className: options.legacy === false ? 'month-cell' : 'ant-calendar-month-panel-cell',
      attributes: options.legacy === false
        ? { role: 'option', 'data-calendar-month-option': String(value) }
        : {},
      onClick: () => {
        fixture.counters.month += 1;
        if (fixture.dayPrecision) {
          fixture.month = value;
          const nextDay = dayPanel(fixture.year, fixture.month, () => {}, day => {
            fixture.counters.day += 1;
            fixture.input.value = `${fixture.year}-${String(fixture.month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            fixture.outer.hidden = true;
            fixture.document.notify();
          });
          fixture.dayPanels.push(nextDay);
          fixture.outer.append(nextDay);
          fixture.document.notify();
          return;
        }
        fixture.input.value = `${fixture.year}-${String(value).padStart(2, '0')}`;
        fixture.outer.hidden = true;
        fixture.document.notify();
      },
    }));
  }
  panel.replaceChildren(header, table);
  fixture.monthPanels.push(panel);
  return panel;
}

function bareMonthPanel(fixture) {
  const panel = new Node('DIV', { className: 'ant-calendar-month-panel' });
  panel.setAttribute('data-calendar-year', String(fixture.year));
  const table = new Node('TABLE', { className: 'ant-calendar-month-panel-table' });
  for (let value = 1; value <= 12; value += 1) {
    table.append(action(`${value}月`, {
      tagName: 'TD', className: 'ant-calendar-month-panel-cell',
      onClick: () => {
        fixture.counters.month += 1;
        fixture.input.value = `${fixture.year}-${String(value).padStart(2, '0')}`;
      },
    }));
  }
  panel.append(table);
  return panel;
}

function yearPanel(fixture) {
  const panel = new Node('DIV', { className: 'ant-calendar-year-panel' });
  const header = new Node('DIV', { className: 'ant-calendar-year-panel-header' });
  header.append(action('上一组年份', {
    className: 'ant-calendar-year-panel-prev-decade-btn',
    attributes: { 'aria-label': '上一组年份', 'data-calendar-nav': 'previous-decade' },
  }));
  const table = new Node('TABLE', { className: 'ant-calendar-year-panel-table' });
  for (let value = 2020; value <= 2029; value += 1) {
    table.append(action(`${value}年`, {
      tagName: 'TD', className: 'ant-calendar-year-panel-cell',
      onClick: () => {
        fixture.counters.year += 1;
        fixture.year = value;
        panel.hidden = true;
        fixture.outer.append(monthPanel(fixture));
        fixture.document.notify();
      },
    }));
  }
  panel.append(header, table);
  return panel;
}

function calendar(document, options = {}) {
  const fixture = {
    document,
    year: options.year || 2024,
    month: options.month || 8,
    dayPrecision: options.precision === 'day',
    counters: { trigger: 0, switch: 0, month: 0, day: 0, year: 0 },
    monthPanels: [],
    dayPanels: [],
  };
  fixture.input = new Node('INPUT', { type: 'text', readOnly: true });
  fixture.outer = new Node('DIV', {
    id: options.panelId || `panel-${Math.random()}`,
    className: 'ant-calendar-picker-container', hidden: true,
  });

  const transition = () => {
    fixture.counters.switch += 1;
    const old = fixture.day;
    if (options.transition === 'modern') {
      monthPanel(fixture, { reuse: old, legacy: false });
      return;
    }
    const next = monthPanel(fixture, { legacy: options.legacy !== false });
    if (options.transition === 'nested') {
      old.append(next);
    } else if (options.transition === 'separate') {
      document.body.append(next);
    } else if (options.transition === 'delayed') {
      next.hidden = true;
      fixture.outer.append(next);
      setTimeout(() => { old.hidden = true; next.hidden = false; document.notify(); }, 8);
    } else {
      fixture.outer.append(next);
      if (options.transition !== 'overlap') old.hidden = true;
    }
    document.notify();
  };

  if (options.initialMode === 'MONTH') fixture.outer.append(monthPanel(fixture));
  else if (options.initialMode === 'YEAR') fixture.outer.append(yearPanel(fixture));
  else if (options.initialMode === 'DECADE') {
    const decade = new Node('DIV', { className: 'ant-calendar-decade-panel' });
    decade.append(action('上一年代', { className: 'ant-calendar-decade-panel-prev-century-btn', attributes: { 'aria-label': '上一年代' } }));
    for (let value = 1990; value <= 2080; value += 10) decade.append(action(`${value}-${value + 9}`, { tagName: 'TD', className: 'ant-calendar-decade-panel-cell' }));
    fixture.outer.append(decade);
  } else {
    fixture.day = dayPanel(fixture.year, fixture.month, transition, fixture.dayPrecision ? day => {
      fixture.counters.day += 1;
      fixture.input.value = `${fixture.year}-${String(fixture.month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      fixture.outer.hidden = true;
      fixture.document.notify();
    } : undefined);
    fixture.dayPanels.push(fixture.day);
    fixture.outer.append(fixture.day);
  }

  const triggerAttributes = { 'aria-label': '选择日期' };
  if (options.controlled !== false) triggerAttributes['aria-controls'] = fixture.outer.id;
  fixture.trigger = action('日历', {
    className: 'ant-calendar-picker-icon calendar-trigger', attributes: triggerAttributes,
    onClick: () => { fixture.counters.trigger += 1; fixture.outer.hidden = false; document.notify(); },
  });
  fixture.control = new Node('DIV', { className: 'ant-form-item-control ant-calendar-picker' });
  fixture.control.append(fixture.input, fixture.trigger);
  fixture.descriptor = descriptor(fixture.input, fixture.trigger, options.label || '入学时间');
  document.body.append(fixture.control, fixture.outer);
  return fixture;
}

function viewer(document) {
  const previous = action('Previous', { attributes: { 'aria-label': 'Previous' } });
  const next = action('Next', { attributes: { 'aria-label': 'Next' } });
  const dialog = new Node('DIV', { id: 'image-viewer', className: 'image-viewer-dialog', attributes: { role: 'dialog', 'aria-label': '图片预览' } });
  dialog.append(previous, next, ...Array.from({ length: 12 }, (_, index) => action(String(index + 1), { attributes: { role: 'gridcell' } })));
  document.body.append(dialog);
  return { dialog, previous, next };
}

function recordingEvents(records) {
  return {
    ...Events,
    clickLikeUser(element, settings) {
      records.push({ element, ...settings });
      records.beforeClick?.(element, settings);
      return Events.clickLikeUser(element, settings);
    },
  };
}

function write(fixture, value = '2024-09', fieldPath = 'education[].enrollmentDate', records = []) {
  return DateLike.write({
    descriptor: fixture.descriptor,
    value,
    fieldPath,
    expectedType: 'date',
    settings: { datePickerTimeoutMs: 50, maxYearNavigationSteps: 5, maxCalendarModeTransitions: 4 },
    dependencies: { EventDispatcher: recordingEvents(records) },
  });
}

function assertTransitionDebug(trace, before = 'DAY', after = 'MONTH') {
  assert.equal(trace.modeBeforeTransition, before);
  assert.equal(trace.modeAfterTransition, after);
  assert.ok(Number(trace.rawAfterTransition) >= 1);
  assert.ok(Number(trace.canonicalAfterTransition) >= 1);
  assert.ok(String(trace.selectedAfterTransitionEvidence || '').length > 0);
}

test('1 legacy DAY→MONTH: hidden old day chooses visible legacy month panel', async () => {
  const fixture = calendar(documentFixture(), { transition: 'hidden' });
  const result = await write(fixture);
  assert.equal(result.status, 'SUCCESS', result.reason);
  assert.equal(fixture.input.value, '2024-09');
  assertTransitionDebug(result.datePickerDebug);
});

test('2 animation overlap: visible old DAY cannot beat the target MONTH panel', async () => {
  const fixture = calendar(documentFixture(), { transition: 'overlap' });
  const result = await write(fixture);
  assert.equal(result.status, 'SUCCESS', result.reason);
  assert.equal(fixture.counters.month, 1);
  assertTransitionDebug(result.datePickerDebug);
});

test('3 stabilization: waits for delayed hidden→visible target mode', async () => {
  const fixture = calendar(documentFixture(), { transition: 'delayed' });
  const result = await write(fixture);
  assert.equal(result.status, 'SUCCESS', result.reason);
  assert.equal(fixture.counters.month, 1);
  assertTransitionDebug(result.datePickerDebug);
});

test('4 nested child: canonical owner after transition is the nested MONTH root', async () => {
  const records = [];
  const fixture = calendar(documentFixture(), { transition: 'nested' });
  const result = await write(fixture, '2024-09', 'education[].enrollmentDate', records);
  assert.equal(result.status, 'SUCCESS', result.reason);
  const option = records.find(record => record.purpose === 'date-picker-option' && record.calendarMode === 'MONTH');
  assert.equal(option?.ownerPanel, fixture.monthPanels[0]);
  assertTransitionDebug(result.datePickerDebug);
});

test('5 replacement cluster: uncontrolled transition rebinds a fresh separate MONTH cluster', async () => {
  const fixture = calendar(documentFixture(), { transition: 'separate', controlled: false });
  const result = await write(fixture);
  assert.equal(result.status, 'SUCCESS', result.reason);
  assert.equal(fixture.counters.month, 1);
  assertTransitionDebug(result.datePickerDebug);
});

test('6 modern Ant same-root child replacement remains supported', async () => {
  const fixture = calendar(documentFixture(), { transition: 'modern', legacy: false });
  const sameRoot = fixture.day;
  const result = await write(fixture);
  assert.equal(result.status, 'SUCCESS', result.reason);
  assert.equal(fixture.day, sameRoot);
  assertTransitionDebug(result.datePickerDebug);
});

test('7 legacy month table/cells classify MONTH without role or data-option attributes', async () => {
  const fixture = calendar(documentFixture(), { initialMode: 'MONTH' });
  const result = await write(fixture);
  assert.equal(result.status, 'SUCCESS', result.reason);
  assert.equal(fixture.counters.month, 1);
});

test('8 legacy year table/cells classify YEAR then rebind MONTH', async () => {
  const fixture = calendar(documentFixture(), { initialMode: 'YEAR' });
  const result = await write(fixture, '2024-09');
  assert.equal(result.status, 'SUCCESS', result.reason);
  assert.equal(fixture.counters.year, 1);
  assert.equal(fixture.counters.month, 1);
  assertTransitionDebug(result.datePickerDebug, 'YEAR', 'MONTH');
});

test('9 two date fields stay isolated through legacy transition', async () => {
  const document = documentFixture();
  const target = calendar(document, { panelId: 'target-panel', transition: 'hidden' });
  const sibling = calendar(document, { panelId: 'sibling-panel', transition: 'hidden', year: 2027 });
  const result = await write(target);
  assert.equal(result.status, 'SUCCESS', result.reason);
  assert.equal(sibling.counters.trigger + sibling.counters.switch + sibling.counters.month, 0);
  assertTransitionDebug(result.datePickerDebug);
});

test('10 image viewer on the same page receives zero clicks during transition', async () => {
  const document = documentFixture();
  const fixture = calendar(document, { transition: 'hidden' });
  const imageViewer = viewer(document);
  const result = await write(fixture);
  assert.equal(result.status, 'SUCCESS', result.reason);
  assert.equal(imageViewer.previous.clickCount + imageViewer.next.clickCount, 0);
  assertTransitionDebug(result.datePickerDebug);
});

test('11 unsupported legacy decade fails explicitly and performs zero inner clicks', async () => {
  const records = [];
  const fixture = calendar(documentFixture(), { initialMode: 'DECADE' });
  const result = await write(fixture, '2024-09', 'education[].enrollmentDate', records);
  assert.equal(result.status, 'NEEDS_CONFIRMATION');
  assert.equal(result.reasonCode, 'UNSUPPORTED_DECADE_MODE');
  assert.equal(records.filter(record => record.purpose === 'date-picker-option' || record.purpose === 'date-picker-navigation').length, 0);
});

test('12 two equally-owned visible target MONTH panels fail closed without option click', async () => {
  const document = documentFixture();
  const fixture = calendar(document, { transition: 'overlap' });
  const original = fixture.day.querySelector('.ant-calendar-month-select');
  original.onClick = () => {
    fixture.counters.switch += 1;
    fixture.day.hidden = true;
    fixture.outer.append(monthPanel(fixture), monthPanel(fixture));
    document.notify();
  };
  const records = [];
  const result = await write(fixture, '2024-09', 'education[].enrollmentDate', records);
  assert.equal(result.status, 'NEEDS_CONFIRMATION');
  assert.equal(result.reasonCode, 'PANEL_CLUSTER_AMBIGUOUS');
  assert.equal(fixture.counters.month, 0);
  assert.equal(records.filter(record => record.purpose === 'date-picker-option').length, 0);
});

test('13 transition debug fields are metadata-only and propagate into fresh Diagnosis', async () => {
  const fixture = calendar(documentFixture(), { transition: 'hidden' });
  const result = await write(fixture);
  assert.equal(result.status, 'SUCCESS', result.reason);
  assertTransitionDebug(result.datePickerDebug);
  assert.deepEqual(result.datePickerDebug.modeSwitchDebug, {
    panelMode: 'DAY',
    headerCandidateCount: 1,
    monthSwitchCandidateCount: 1,
    yearSwitchCandidateCount: 0,
    candidateKinds: ['MONTH_BUTTON'],
    rejectionReasons: [],
    selectedSwitchSource: 'LEGACY_ANT_CLASS',
    safetyReason: '',
  });
  const fresh = FieldDetector.buildDescriptor(fixture.input, 0, { section: 'education' });
  const diagnosis = FieldDetector.toDiagnostic(fresh);
  for (const key of ['modeBeforeTransition', 'modeAfterTransition', 'rawAfterTransition', 'canonicalAfterTransition', 'selectedAfterTransitionEvidence']) {
    assert.deepEqual(diagnosis.datePickerDebug[key], result.datePickerDebug[key]);
  }
  assert.deepEqual(diagnosis.datePickerDebug.modeSwitchDebug, result.datePickerDebug.modeSwitchDebug);
  assert.equal(JSON.stringify(diagnosis.datePickerDebug).includes('2024-09'), false);
});

test('phase 3.5 runtime debug: duplicate legacy month switches fail closed and explain the candidate ambiguity', async () => {
  const fixture = calendar(documentFixture(), { transition: 'hidden' });
  const header = fixture.day.querySelector('.ant-calendar-header');
  header.append(action(`${fixture.month}月`, {
    className: 'ant-calendar-month-select',
    attributes: { 'aria-label': '选择月份' },
    onClick: () => { fixture.counters.switch += 100; },
  }));

  const result = await write(fixture);

  assert.equal(result.status, 'NEEDS_CONFIRMATION');
  assert.equal(result.reasonCode, 'NO_MONTH_MODE_SWITCH');
  assert.equal(fixture.counters.switch, 0);
  assert.deepEqual(result.datePickerDebug.modeSwitchDebug, {
    panelMode: 'DAY',
    headerCandidateCount: 2,
    monthSwitchCandidateCount: 2,
    yearSwitchCandidateCount: 0,
    candidateKinds: ['MONTH_BUTTON'],
    rejectionReasons: ['MULTIPLE_MONTH_SWITCH_CANDIDATES'],
    selectedSwitchSource: '',
    safetyReason: '',
  });
  assert.doesNotMatch(
    JSON.stringify(result.datePickerDebug.modeSwitchDebug),
    /2024|\u6708|ant-calendar|innerHTML|outerHTML/i,
  );
});

test('phase 3.5 legacy runtime: owned a/span/div header switches stay distinct from month options', async () => {
  for (const [tagName, expectedKind] of [
    ['A', 'MONTH_ANCHOR'],
    ['SPAN', 'MONTH_SPAN'],
    ['DIV', 'MONTH_DIV'],
  ]) {
    const fixture = calendar(documentFixture(), { transition: 'hidden' });
    const switcher = fixture.day.querySelector('.ant-calendar-month-select');
    switcher.tagName = tagName;
    switcher.type = '';
    const result = await write(fixture);

    assert.equal(result.status, 'SUCCESS', `${tagName}: ${result.reason}`);
    assert.equal(fixture.counters.switch, 1, tagName);
    assert.deepEqual(result.datePickerDebug.modeSwitchDebug.candidateKinds, [expectedKind]);
    assert.equal(result.datePickerDebug.modeSwitchDebug.selectedSwitchSource, 'LEGACY_ANT_CLASS');
    assert.equal(result.datePickerDebug.modeSwitchDebug.monthSwitchCandidateCount, 1);
    assert.equal(result.datePickerDebug.modeSwitchDebug.safetyReason, '');
  }
});

test('phase 3.5 legacy safety debug exposes only an allowlisted reason, never the rejected href', async () => {
  const fixture = calendar(documentFixture(), { transition: 'hidden' });
  const switcher = fixture.day.querySelector('.ant-calendar-month-select');
  switcher.tagName = 'A';
  switcher.type = '';
  switcher.setAttribute('href', '/application/next?private=calendar-secret');

  const result = await write(fixture);

  assert.equal(result.status, 'NEEDS_CONFIRMATION');
  assert.equal(result.reasonCode, 'NO_MONTH_MODE_SWITCH');
  assert.equal(fixture.counters.switch, 0);
  assert.equal(result.datePickerDebug.modeSwitchDebug.safetyReason, 'HREF_PRESENT');
  assert.equal(result.datePickerDebug.modeSwitchDebug.rejectionReasons.includes('SAFETY_REJECTED'), true);
  assert.doesNotMatch(JSON.stringify(result.datePickerDebug), /private|calendar-secret|application\/next/i);
});

test('14 shared header cannot collapse two sibling target grids into one canonical panel', async () => {
  const document = documentFixture();
  const fixture = calendar(document, { transition: 'overlap' });
  const original = fixture.day.querySelector('.ant-calendar-month-select');
  original.onClick = () => {
    fixture.counters.switch += 1;
    fixture.day.hidden = true;
    fixture.outer.append(action('上一年', {
      className: 'ant-calendar-month-panel-prev-year-btn',
      attributes: { 'aria-label': '上一年', 'data-calendar-nav': 'previous-year' },
    }), bareMonthPanel(fixture), bareMonthPanel(fixture));
    document.notify();
  };
  const records = [];
  const result = await write(fixture, '2024-09', 'education[].enrollmentDate', records);
  assert.equal(result.status, 'NEEDS_CONFIRMATION');
  assert.equal(result.reasonCode, 'PANEL_CLUSTER_AMBIGUOUS');
  assert.equal(fixture.counters.month, 0);
  assert.equal(records.filter(record => record.purpose === 'date-picker-option').length, 0);
});

test('15 live ownership rejects a second controlled MONTH panel inserted before option safety', async () => {
  const document = documentFixture();
  const fixture = calendar(document, { transition: 'hidden' });
  const records = [];
  let injected = false;
  records.beforeClick = (_element, settings) => {
    if (injected || settings.purpose !== 'date-picker-option' || settings.calendarMode !== 'MONTH') return;
    injected = true;
    fixture.outer.append(monthPanel(fixture));
    document.notify();
  };
  const result = await write(fixture, '2024-09', 'education[].enrollmentDate', records);
  assert.equal(result.status, 'NEEDS_CONFIRMATION');
  assert.equal(result.reasonCode, 'PANEL_CLUSTER_AMBIGUOUS');
  assert.equal(fixture.counters.month, 0);
  assert.ok(result.datePickerDebug.canonicalAfterTransition >= 2);
});

test('16 pointerdown TOCTOU revalidates canonical MONTH panel identity before real click', async () => {
  const document = documentFixture();
  const fixture = calendar(document, { transition: 'hidden' });
  const records = [];
  let armed = false;
  let injected = false;
  records.beforeClick = (element, settings) => {
    if (armed || settings.purpose !== 'date-picker-option' || settings.calendarMode !== 'MONTH') return;
    armed = true;
    const originalDispatch = element.dispatchEvent.bind(element);
    element.dispatchEvent = event => {
      if (!injected && event?.type === 'pointerdown') {
        injected = true;
        fixture.outer.append(monthPanel(fixture));
        document.notify();
      }
      return originalDispatch(event);
    };
  };
  const result = await write(fixture, '2024-09', 'education[].enrollmentDate', records);
  assert.equal(result.status, 'NEEDS_CONFIRMATION');
  assert.equal(result.reasonCode, 'PANEL_CLUSTER_AMBIGUOUS');
  assert.equal(fixture.counters.month, 0);
  assert.ok(result.datePickerDebug.canonicalAfterTransition >= 2);
});

test('17 birthday overlap selects only the fresh DAY on the second transition', async () => {
  const document = documentFixture();
  const fixture = calendar(document, {
    panelId: 'birthday-panel',
    transition: 'overlap',
    precision: 'day',
    year: 2000,
    month: 1,
    label: '出生日期',
  });
  const records = [];

  const result = await write(fixture, '2000-02-03', 'basic.birthday', records);

  assert.equal(result.status, 'SUCCESS', JSON.stringify({
    reasonCode: result.reasonCode,
    datePickerDebug: result.datePickerDebug,
  }));
  assert.equal(fixture.input.value, '2000-02-03');
  assert.equal(fixture.counters.switch, 1);
  assert.equal(fixture.counters.month, 1);
  assert.equal(fixture.counters.day, 1);
  assert.equal(result.datePickerDebug.transitionCount, 2);
  assert.equal(result.datePickerDebug.finalReasonCode, 'SUCCESS');
  assert.equal(records.filter(record => record.purpose === 'date-picker-option' && record.calendarMode === 'DAY').length, 1);
});

test('18 birthday fresh-DAY scope still rejects a pointerdown-injected DAY competitor', async () => {
  const document = documentFixture();
  const fixture = calendar(document, {
    panelId: 'birthday-panel-live-guard',
    transition: 'overlap',
    precision: 'day',
    year: 2000,
    month: 1,
    label: '出生日期',
  });
  const records = [];
  let armed = false;
  let injected = false;
  records.beforeClick = (element, settings) => {
    if (armed || settings.purpose !== 'date-picker-option' || settings.calendarMode !== 'DAY') return;
    armed = true;
    const originalDispatch = element.dispatchEvent.bind(element);
    element.dispatchEvent = event => {
      if (!injected && event?.type === 'pointerdown') {
        injected = true;
        fixture.outer.append(dayPanel(fixture.year, fixture.month, () => {}));
        document.notify();
      }
      return originalDispatch(event);
    };
  };

  const result = await write(fixture, '2000-02-03', 'basic.birthday', records);

  assert.equal(result.status, 'NEEDS_CONFIRMATION');
  assert.equal(result.reasonCode, 'PANEL_CLUSTER_AMBIGUOUS');
  assert.equal(fixture.input.value, '');
  assert.equal(fixture.counters.day, 0);
  assert.ok(result.datePickerDebug.canonicalAfterTransition >= 3);
});

test('phase 3.5 completion: legacy same-popup DAY→YEAR→MONTH keeps overlapping layers but selects one fresh target mode', async () => {
  const document = documentFixture();
  const fixture = calendar(document, { panelId: 'legacy-three-mode-overlap', transition: 'overlap' });
  const switcher = fixture.day.querySelector('.ant-calendar-month-select');
  switcher.className = 'ant-calendar-year-select';
  switcher.setAttribute('data-calendar-mode-switch', 'YEAR');
  switcher.setAttribute('aria-label', '选择年份');
  switcher.textContent = `${fixture.year}年`;
  let yearLayer = null;
  let monthLayer = null;
  switcher.onClick = () => {
    fixture.counters.switch += 1;
    yearLayer = yearPanel(fixture);
    for (const cell of yearLayer.querySelectorAll('.ant-calendar-year-panel-cell')) {
      const selectedYear = Number(cell.textContent.match(/\d{4}/)?.[0]);
      cell.onClick = () => {
        fixture.counters.year += 1;
        fixture.year = selectedYear;
        monthLayer = monthPanel(fixture);
        fixture.outer.append(monthLayer);
        document.notify();
      };
    }
    fixture.outer.append(yearLayer);
    document.notify();
  };
  const records = [];

  const result = await write(fixture, '2024-09', 'education[].enrollmentDate', records);

  assert.equal(result.status, 'SUCCESS', result.reason);
  assert.equal(fixture.input.value, '2024-09');
  assert.ok(yearLayer && monthLayer);
  assert.equal(fixture.day.hidden, false, 'old DAY layer may remain during animation overlap');
  assert.equal(yearLayer.hidden, false, 'old YEAR layer may remain beside the fresh MONTH layer');
  assert.equal(fixture.counters.year, 1);
  assert.equal(fixture.counters.month, 1);
  assert.equal(records.filter(record => record.purpose === 'date-picker-option' && record.calendarMode === 'YEAR').length, 1);
  assert.equal(records.filter(record => record.purpose === 'date-picker-option' && record.calendarMode === 'MONTH').length, 1);
});

test('phase 3.5 completion safety: two initial owned DAY layers fail closed before any inner calendar click', async () => {
  const document = documentFixture();
  const fixture = calendar(document, { panelId: 'duplicate-initial-day-layer', transition: 'overlap' });
  let competingSwitchClicks = 0;
  const competingDay = dayPanel(fixture.year, fixture.month, () => { competingSwitchClicks += 1; });
  fixture.outer.append(competingDay);
  document.notify();
  const records = [];

  const result = await write(fixture, '2024-09', 'education[].enrollmentDate', records);

  assert.equal(result.status, 'NEEDS_CONFIRMATION');
  assert.equal(result.reasonCode, 'PANEL_CLUSTER_AMBIGUOUS');
  assert.equal(fixture.input.value, '');
  assert.equal(fixture.counters.switch, 0);
  assert.equal(competingSwitchClicks, 0);
  assert.equal(records.filter(record => [
    'date-picker-mode-switch', 'date-picker-navigation', 'date-picker-option',
  ].includes(record.purpose)).length, 0);
});
