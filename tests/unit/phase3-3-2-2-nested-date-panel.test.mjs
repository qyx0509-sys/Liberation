import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const DateLike = require('../../src/controls/adapters/date-like-adapter.js');
const Events = require('../../src/core/event-dispatcher.js');
const Form = require('../../src/core/form-filler.js');
const FieldDetector = require('../../src/core/field-detector.js');

function selectorParts(selector) {
  return String(selector || '').split(',').map(part => part.trim()).filter(Boolean);
}

function matchesSelector(node, selector) {
  const source = String(selector || '').trim();
  if (!source) return false;
  const tagMatch = source.match(/^[a-z][a-z0-9-]*/i);
  if (tagMatch && node.tagName !== tagMatch[0].toUpperCase()) return false;
  for (const match of source.matchAll(/\[([^\]=*]+)(?:([*]?=)"([^"]*)")?\]/g)) {
    const [, name, operator, expected] = match;
    const actual = name === 'class' ? node.className : node.getAttribute(name);
    if (!operator && (actual === null || actual === undefined)) return false;
    if (operator === '=' && String(actual) !== expected) return false;
    if (operator === '*=' && !String(actual || '').includes(expected)) return false;
  }
  if (source.startsWith('.') && !String(node.className).split(/\s+/).includes(source.slice(1))) return false;
  return Boolean(tagMatch || source.startsWith('[') || source.startsWith('.'));
}

function hasHiddenAncestor(node) {
  let current = node;
  while (current) {
    if (current.hidden || current.getAttribute?.('aria-hidden') === 'true') return true;
    current = current.parentElement;
  }
  return false;
}

class TestNode {
  constructor(tagName = 'DIV', options = {}) {
    this.tagName = String(tagName).toUpperCase();
    this.type = options.type || '';
    this.id = options.id || '';
    this.className = options.className || '';
    this._text = options.text || '';
    this.hidden = Boolean(options.hidden);
    this.disabled = Boolean(options.disabled);
    this.readOnly = Boolean(options.readOnly);
    this.isConnected = true;
    this.parentElement = null;
    this.ownerDocument = null;
    this.children = [];
    this.clickCount = 0;
    this.value = options.value || '';
    this.attributes = new Map(Object.entries(options.attributes || {}));
    this.onClick = options.onClick || null;
  }

  get textContent() {
    return [this._text, ...this.children.map(child => child.textContent)].filter(Boolean).join(' ');
  }
  set textContent(value) { this._text = String(value || ''); }
  get innerText() { return this.textContent; }
  set innerText(value) { this._text = String(value || ''); }
  getAttribute(name) {
    if (name === 'id') return this.id || null;
    if (name === 'class') return this.className || null;
    if (name === 'type') return this.type || null;
    return this.attributes.get(name) ?? null;
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  removeAttribute(name) { this.attributes.delete(name); }
  append(...children) {
    children.flat().filter(Boolean).forEach(child => {
      child.parentElement = this;
      child.ownerDocument = this.ownerDocument;
      this.children.push(child);
      bind(this.ownerDocument, child);
    });
  }
  replaceChildren(...children) {
    this.children.forEach(child => { child.parentElement = null; child.isConnected = false; });
    this.children = [];
    this.append(...children);
  }
  contains(other) { return other === this || this.children.some(child => child.contains?.(other)); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  querySelectorAll(selector) {
    const descendants = [];
    const walk = node => node.children.forEach(child => { descendants.push(child); walk(child); });
    walk(this);
    const parts = selectorParts(selector);
    return descendants.filter(node => parts.some(part => matchesSelector(node, part)));
  }
  closest(selector) {
    const parts = selectorParts(selector);
    let current = this;
    while (current) {
      if (parts.some(part => matchesSelector(current, part))) return current;
      current = current.parentElement;
    }
    return null;
  }
  getRootNode() { return this.ownerDocument; }
  getBoundingClientRect() {
    const visible = !hasHiddenAncestor(this);
    return { width: visible ? 180 : 0, height: visible ? 34 : 0, left: 0, top: 0, right: visible ? 180 : 0, bottom: visible ? 34 : 0 };
  }
  focus() {}
  blur() {}
  dispatchEvent() { return true; }
  click() { this.clickCount += 1; this.onClick?.(this); }
}

function bind(document, node) {
  if (!node || !document) return node;
  node.ownerDocument = document;
  node.children.forEach(child => bind(document, child));
  return node;
}

function makeDocument() {
  class TestEvent { constructor(type, init = {}) { this.type = type; Object.assign(this, init); } }
  const document = {
    nodeType: 9,
    defaultView: {
      Event: TestEvent,
      MouseEvent: TestEvent,
      PointerEvent: TestEvent,
      FocusEvent: TestEvent,
      requestAnimationFrame(callback) { callback(); },
      getComputedStyle(node) {
        return hasHiddenAncestor(node)
          ? { display: 'none', visibility: 'hidden', opacity: '0' }
          : { display: 'block', visibility: 'visible', opacity: '1' };
      },
    },
    body: null,
    documentElement: null,
    querySelectorAll(selector) { return this.body.querySelectorAll(selector); },
    getElementById(id) {
      return this.querySelectorAll('[id]').find(node => node.id === id) || null;
    },
  };
  document.body = bind(document, new TestNode('BODY'));
  document.documentElement = bind(document, new TestNode('HTML'));
  return document;
}

function action(text, attributes = {}, onClick = null, options = {}) {
  return new TestNode(options.tagName || 'BUTTON', {
    type: options.tagName === 'A' ? '' : 'button',
    text,
    attributes,
    onClick,
    className: options.className || '',
    disabled: Boolean(options.disabled),
  });
}

function descriptor(input, trigger, options = {}) {
  return {
    detectorId: options.id || 'nested-date-field',
    element: input,
    interactionElement: input,
    elements: [input],
    controlKind: 'text',
    baseControlKind: 'text',
    inputType: 'text',
    visible: true,
    hidden: false,
    disabled: false,
    readOnly: true,
    interactiveReadonly: true,
    readonlyInteractionKind: 'date-like',
    datePickerTrigger: trigger,
    datePickerAmbiguous: false,
    labelText: options.label || '入学时间',
    labelSource: 'form-item-label',
    placeholder: options.placeholder || '请选择入学时间',
    semanticPlaceholder: options.label || '入学时间',
  };
}

function nestedCalendar(options = {}) {
  const expectedPrecision = options.expectedPrecision || 'month';
  const input = new TestNode('INPUT', { type: 'text', readOnly: true, value: options.initialValue || '' });
  let year = options.year || 2026;
  let month = options.month || 8;
  let mode = options.mode || 'DAY';
  const counters = { trigger: 0, modeSwitch: 0, previousYear: 0, nextYear: 0, month: 0, day: 0 };

  const outer = new TestNode('DIV', {
    id: options.panelId || 'calendar-owned',
    className: 'ant-calendar-picker-container',
    hidden: options.hidden !== false,
    attributes: options.transitionStrategy === 'modern-overlap' ? {
      'data-calendar-mode': mode,
      'data-calendar-year': year,
      'data-calendar-month': month,
    } : {},
  });
  const calendar = new TestNode('DIV', { className: 'ant-calendar' });
  const panel = new TestNode('DIV', { className: 'ant-calendar-panel' });
  let datePanel = new TestNode('DIV', {
    className: 'ant-calendar-date-panel',
    attributes: { 'data-calendar-input': options.inputId || 'calendar-field' },
  });
  outer.append(calendar);
  calendar.append(panel);
  panel.append(datePanel);

  function writeMonth() {
    input.value = `${year}-${String(month).padStart(2, '0')}`;
    outer.hidden = true;
  }
  function writeDay(day) {
    input.value = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    outer.hidden = true;
  }
  function transition(nextMode) {
    if (options.transitionStrategy !== 'modern-overlap') {
      render(nextMode);
      return;
    }
    const stalePanel = datePanel;
    stalePanel.setAttribute('data-calendar-stale', 'true');
    stalePanel.className = `${stalePanel.className} calendar-panel-stale`;
    datePanel = new TestNode('DIV', {
      className: 'ant-calendar-date-panel',
      attributes: {
        'data-calendar-input': options.inputId || 'calendar-field',
        'data-calendar-stale': 'false',
      },
    });
    panel.append(datePanel);
    outer.setAttribute('data-calendar-mode', nextMode);
    render(nextMode);
  }
  function render(nextMode = mode) {
    mode = nextMode;
    datePanel.setAttribute('data-calendar-mode', mode);
    datePanel.setAttribute('data-calendar-year', year);
    datePanel.setAttribute('data-calendar-month', month);
    const header = new TestNode('DIV', { className: 'ant-calendar-header' });
    const body = new TestNode('DIV', { className: 'ant-calendar-body' });
    const previousYear = action('上一年', {
      'aria-label': '上一年', 'data-calendar-nav': 'previous-year',
    }, () => { counters.previousYear += 1; year -= 1; render(); }, {
      className: options.transitionStrategy === 'modern-overlap' ? '' : 'ant-calendar-prev-year-btn',
    });
    const nextYear = action('下一年', {
      'aria-label': '下一年', 'data-calendar-nav': 'next-year',
    }, () => { counters.nextYear += 1; year += 1; render(); }, {
      className: options.transitionStrategy === 'modern-overlap' ? '' : 'ant-calendar-next-year-btn',
    });
    header.append(previousYear, new TestNode('STRONG', { text: `${year}年` }));
    if (mode === 'DAY') {
      header.append(action(`${month}月`, {
        'aria-label': '选择月份', 'data-calendar-mode-switch': 'MONTH',
      }, () => { counters.modeSwitch += 1; transition('MONTH'); }, { className: 'ant-calendar-month-select' }), nextYear);
      for (const weekday of ['日', '一', '二', '三', '四', '五', '六']) {
        body.append(new TestNode('SPAN', {
          text: weekday,
          className: options.transitionStrategy === 'modern-overlap'
            ? ''
            : 'ant-calendar-column-header calendar-weekday',
          attributes: { role: 'columnheader', 'data-calendar-weekday': weekday },
        }));
      }
      for (let day = 1; day <= 31; day += 1) {
        body.append(action(String(day), {
          role: 'gridcell', 'data-calendar-day-option': day,
          'data-current-month': 'true', 'aria-label': `${year}年${month}月${day}日`,
        }, () => { counters.day += 1; writeDay(day); }, {
          className: options.transitionStrategy === 'modern-overlap' ? '' : 'ant-calendar-date date-cell',
        }));
      }
    } else if (mode === 'MONTH') {
      if (options.transitionStrategy === 'modern-overlap') {
        header.append(action('月份', {
          'aria-label': '选择月份', 'data-calendar-mode-switch': 'MONTH',
        }, null, { className: 'ant-calendar-month-select ant-picker-month-btn' }), nextYear);
      } else {
        header.append(nextYear);
      }
      for (let value = 1; value <= 12; value += 1) {
        body.append(action(`${value}月`, {
          role: 'option', 'data-calendar-month-option': value, 'aria-label': `${value}月`,
        }, () => {
          counters.month += 1;
          month = value;
          if (expectedPrecision === 'day') render('DAY');
          else writeMonth();
        }, {
          className: options.transitionStrategy === 'modern-overlap'
            ? ''
            : 'ant-calendar-month-panel-cell month-cell',
        }));
      }
    }
    datePanel.replaceChildren(header, body);
  }
  render();

  const triggerAttributes = { 'aria-label': options.triggerLabel || '选择日期' };
  if (options.controlled !== false) triggerAttributes[options.ownershipAttribute || 'aria-controls'] = outer.id;
  const trigger = action('日历', triggerAttributes, () => {
    counters.trigger += 1;
    if (options.onOpen) options.onOpen({ outer, calendar, panel, datePanel });
    else outer.hidden = false;
  }, { className: 'ant-calendar-picker-icon calendar-trigger' });
  const control = new TestNode('DIV', { className: 'ant-form-item-control ant-calendar-picker' });
  control.append(input, trigger);
  const fieldDescriptor = descriptor(input, trigger, {
    id: options.id,
    label: options.label || (expectedPrecision === 'day' ? '出生日期' : '入学时间'),
    placeholder: options.placeholder || (expectedPrecision === 'day' ? '请选择出生日期' : '请选择入学时间'),
  });
  return { input, trigger, control, outer, calendar, panel, datePanel, descriptor: fieldDescriptor, counters };
}

function viewerDialog() {
  const previous = action('Previous', { 'aria-label': 'Previous' });
  const next = action('Next', { 'aria-label': 'Next' });
  const dialog = new TestNode('DIV', {
    id: 'image-viewer', className: 'image-viewer-dialog', attributes: { role: 'dialog', 'aria-label': '图片预览' },
  });
  dialog.append(previous, next, ...Array.from({ length: 12 }, (_, index) => action(String(index + 1), { role: 'gridcell' })));
  return { dialog, previous, next };
}

function attach(document, ...nodes) {
  document.body.append(...nodes);
  nodes.forEach(node => bind(document, node));
}

function dateContext(fixture, value, fieldPath, settings = {}) {
  return {
    descriptor: fixture.descriptor,
    value,
    fieldPath,
    expectedType: 'date',
    settings: {
      datePickerTimeoutMs: 1,
      maxYearNavigationSteps: 30,
      maxCalendarModeTransitions: 4,
      ...settings,
    },
    dependencies: { EventDispatcher: Events },
  };
}

async function write(fixture, value, fieldPath, settings = {}) {
  return DateLike.write(dateContext(fixture, value, fieldPath, settings));
}

test('case 1: nested Ant wrappers canonicalize to one DAY cluster and commit enrollment month', async () => {
  const document = makeDocument();
  const fixture = nestedCalendar({ panelId: 'calendar-enrollment', year: 2023, month: 8 });
  attach(document, fixture.control, fixture.outer);

  const result = await write(fixture, '2023-09', 'education[].enrollmentDate');

  assert.equal(result.status, 'SUCCESS', result.reason);
  assert.equal(fixture.input.value, '2023-09');
  assert.ok(result.datePickerDebug.rawPanelCandidateCount >= 3);
  assert.equal(result.datePickerDebug.canonicalClusterCount, 1);
  assert.equal(result.datePickerDebug.selectedPanelMode, 'DAY');
  assert.equal(result.datePickerDebug.finalReasonCode, 'SUCCESS');
});

test('case 2: graduation aria-controls selects only its sibling cluster', async () => {
  const document = makeDocument();
  const enrollment = nestedCalendar({ panelId: 'calendar-enrollment', year: 2023, hidden: false });
  const graduation = nestedCalendar({ panelId: 'calendar-graduation', year: 2027, label: '毕业时间' });
  attach(document, enrollment.control, enrollment.outer, graduation.control, graduation.outer);

  const result = await write(graduation, '2027-06', 'education[].graduationDate');

  assert.equal(result.status, 'SUCCESS', result.reason);
  assert.equal(graduation.input.value, '2027-06');
  assert.equal(enrollment.counters.modeSwitch + enrollment.counters.month + enrollment.counters.day, 0);
  assert.match(result.datePickerDebug.selectedClusterEvidence, /aria-controls/);
});

test('case 3: viewer dialog is excluded from date clusters and never clicked', async () => {
  const document = makeDocument();
  const viewer = viewerDialog();
  const fixture = nestedCalendar({ panelId: 'calendar-enrollment', year: 2023 });
  attach(document, fixture.control, fixture.outer, viewer.dialog);

  const result = await write(fixture, '2023-09', 'education[].enrollmentDate');

  assert.equal(result.status, 'SUCCESS', result.reason);
  assert.equal(result.datePickerDebug.canonicalClusterCount, 1);
  assert.equal(viewer.previous.clickCount + viewer.next.clickCount, 0);
});

test('case 4: a pre-existing nested popup is selected by same-element hidden-to-visible transition', async () => {
  const document = makeDocument();
  const fixture = nestedCalendar({ panelId: 'calendar-hidden', year: 2023, controlled: false });
  const sameOuter = fixture.outer;
  attach(document, fixture.control, fixture.outer);

  const result = await write(fixture, '2023-09', 'education[].enrollmentDate');

  assert.equal(result.status, 'SUCCESS', result.reason);
  assert.equal(fixture.outer, sameOuter);
  assert.match(result.datePickerDebug.selectedClusterEvidence, /hidden-to-visible/);
});

test('case 5: two already-visible unrelated date clusters without ownership fail closed', async () => {
  const document = makeDocument();
  const first = nestedCalendar({ panelId: 'calendar-one', year: 2023, hidden: false, controlled: false });
  const second = nestedCalendar({ panelId: 'calendar-two', year: 2027, hidden: false, controlled: false });
  first.trigger.onClick = () => { first.counters.trigger += 1; };
  attach(document, first.control, first.outer, second.control, second.outer);

  const result = await write(first, '2023-09', 'education[].enrollmentDate');

  assert.equal(result.status, 'NEEDS_CONFIRMATION');
  assert.equal(result.reasonCode, 'MULTIPLE_UNRELATED_PANELS');
  assert.equal(result.datePickerDebug.canonicalClusterCount, 2);
  assert.equal(first.counters.modeSwitch + first.counters.month + second.counters.modeSwitch + second.counters.month, 0);
});

test('case 6: canonical DAY root transitions to MONTH and records one bounded transition', async () => {
  const document = makeDocument();
  const fixture = nestedCalendar({ panelId: 'calendar-transition', year: 2024, month: 8 });
  attach(document, fixture.control, fixture.outer);

  const result = await write(fixture, '2024-09', 'education[].enrollmentDate');

  assert.equal(result.status, 'SUCCESS', result.reason);
  assert.equal(fixture.counters.modeSwitch, 1);
  assert.equal(result.datePickerDebug.transitionCount, 1);
  assert.equal(result.datePickerDebug.finalReasonCode, 'SUCCESS');
});

test('case 7: semantic rerun remains SKIPPED_EXISTING and performs zero picker clicks', async () => {
  const document = makeDocument();
  const fixture = nestedCalendar({ panelId: 'calendar-existing', year: 2024, initialValue: '2024年9月' });
  attach(document, fixture.control, fixture.outer);

  const result = await Form.fill(fixture.descriptor, '2024-09', {
    fieldPath: 'education[].enrollmentDate', expectedType: 'date', allowOverwrite: false,
  });

  assert.equal(result.status, 'SKIPPED_EXISTING');
  assert.equal(fixture.trigger.clickCount, 0);
  assert.equal(fixture.counters.modeSwitch + fixture.counters.month + fixture.counters.day, 0);
});

test('case 8: birthday uses the same canonical cluster for year, month, and unique day', async () => {
  const document = makeDocument();
  const fixture = nestedCalendar({
    id: 'birthday', panelId: 'calendar-birthday', year: 2004, month: 8,
    expectedPrecision: 'day', label: '出生日期', placeholder: '请选择出生日期',
  });
  attach(document, fixture.control, fixture.outer);

  const result = await write(fixture, '2003-05-17', 'basic.birthday', { maxYearNavigationSteps: 2 });

  assert.equal(result.status, 'SUCCESS', result.reason);
  assert.equal(fixture.input.value, '2003-05-17');
  assert.equal(fixture.counters.day, 1);
  assert.notEqual(result.reasonCode, 'NO_PANEL_CANDIDATE');
});

test('case 9: authoritative controlled generic dialog stays UNKNOWN and never falls back to date cluster', async () => {
  const document = makeDocument();
  const reliable = nestedCalendar({ panelId: 'calendar-reliable', year: 2023 });
  const generic = viewerDialog();
  generic.dialog.id = 'controlled-generic';
  generic.dialog.hidden = true;
  const input = new TestNode('INPUT', { type: 'text', readOnly: true });
  const trigger = action('日历', { 'aria-label': '选择日期', 'aria-controls': generic.dialog.id }, () => {
    generic.dialog.hidden = false;
    reliable.outer.hidden = false;
  }, { className: 'calendar-trigger' });
  const control = new TestNode('DIV', { className: 'ant-form-item-control' });
  control.append(input, trigger);
  const fixture = { input, trigger, control, descriptor: descriptor(input, trigger) };
  attach(document, control, generic.dialog, reliable.outer);

  const result = await write(fixture, '2023-09', 'education[].enrollmentDate');

  assert.equal(result.status, 'NEEDS_CONFIRMATION');
  assert.equal(result.reasonCode, 'UNKNOWN_PANEL_MODE');
  assert.equal(reliable.counters.modeSwitch + reliable.counters.month + reliable.counters.day, 0);
  assert.equal(generic.previous.clickCount + generic.next.clickCount, 0);
});

test('case 10: no panel candidate emits explicit debug reason without leaking date values', async () => {
  const document = makeDocument();
  const input = new TestNode('INPUT', { type: 'text', readOnly: true });
  const trigger = action('日历', { 'aria-label': '选择日期' }, null, { className: 'calendar-trigger' });
  const control = new TestNode('DIV', { className: 'ant-form-item-control' });
  control.append(input, trigger);
  const fixture = { input, trigger, control, descriptor: descriptor(input, trigger) };
  attach(document, control);

  const result = await write(fixture, '2023-09', 'education[].enrollmentDate');

  assert.equal(result.status, 'NEEDS_CONFIRMATION');
  assert.equal(result.reasonCode, 'NO_PANEL_CANDIDATE');
  assert.equal(result.datePickerDebug.rawPanelCandidateCount, 0);
  assert.equal(result.datePickerDebug.finalReasonCode, 'NO_PANEL_CANDIDATE');
  assert.equal(JSON.stringify(result.datePickerDebug).includes('2023-09'), false);
});

test('case 11: aria-owns is preserved as authoritative ownership evidence', async () => {
  const document = makeDocument();
  const fixture = nestedCalendar({ panelId: 'calendar-owned-by-aria', year: 2023, ownershipAttribute: 'aria-owns' });
  attach(document, fixture.control, fixture.outer);

  const result = await write(fixture, '2023-09', 'education[].enrollmentDate');

  assert.equal(result.status, 'SUCCESS', result.reason);
  assert.match(result.datePickerDebug.selectedClusterEvidence, /aria-owns/);
});

test('case 12: metadata-only debug trace is retrievable by descriptor or element', async () => {
  const document = makeDocument();
  const fixture = nestedCalendar({ panelId: 'calendar-debug', year: 2023 });
  attach(document, fixture.control, fixture.outer);

  const result = await write(fixture, '2023-09', 'education[].enrollmentDate');
  const byDescriptor = DateLike.getDebugTrace(fixture.descriptor);
  const byElement = DateLike.getDebugTrace(fixture.input);

  assert.deepEqual(byDescriptor, result.datePickerDebug);
  assert.deepEqual(byElement, result.datePickerDebug);
  assert.deepEqual(Object.keys(byDescriptor).sort(), [
    'canonicalAfterTransition', 'canonicalClusterCount', 'finalReasonCode',
    'modeAfterTransition', 'modeBeforeTransition', 'rawAfterTransition',
    'modeSwitchDebug',
    'rawPanelCandidateCount', 'selectedAfterTransitionEvidence',
    'selectedClusterEvidence', 'selectedPanelMode', 'selectedTriggerSource',
    'transitionCount', 'triggerCandidateCount', 'visiblePanelCandidateCount',
  ].sort());
});

test('case 13: fresh Diagnosis descriptor serializes the last metadata-only date picker trace', async () => {
  const document = makeDocument();
  const fixture = nestedCalendar({ panelId: 'calendar-diagnosis', year: 2023 });
  attach(document, fixture.control, fixture.outer);
  const result = await write(fixture, '2023-09', 'education[].enrollmentDate');
  assert.equal(result.status, 'SUCCESS');

  const freshDescriptor = FieldDetector.buildDescriptor(fixture.input, 0, { section: 'education' });
  const diagnosis = FieldDetector.toDiagnostic(freshDescriptor);
  assert.deepEqual(diagnosis.datePickerDebug, result.datePickerDebug);
  assert.equal(JSON.stringify(diagnosis.datePickerDebug).includes('2023-09'), false);
  assert.equal(Object.hasOwn(diagnosis.datePickerDebug, 'value'), false);
});

test('case 14: graduation modern-overlap keeps MONTH ownership through year navigation', async () => {
  const document = makeDocument();
  const fixture = nestedCalendar({
    id: 'graduation',
    inputId: 'graduation',
    panelId: 'graduation-panel',
    year: 2025,
    month: 8,
    label: '毕业时间',
    transitionStrategy: 'modern-overlap',
  });
  attach(document, fixture.control, fixture.outer);

  const result = await write(fixture, '2027-06', 'education[].graduationDate', {
    maxYearNavigationSteps: 4,
  });

  assert.equal(result.status, 'SUCCESS', JSON.stringify({
    reasonCode: result.reasonCode,
    datePickerDebug: result.datePickerDebug,
  }));
  assert.equal(fixture.input.value, '2027-06');
  assert.equal(fixture.counters.modeSwitch, 1);
  assert.equal(fixture.counters.nextYear, 2);
  assert.equal(result.datePickerDebug.modeBeforeTransition, 'DAY');
  assert.equal(result.datePickerDebug.modeAfterTransition, 'MONTH');
  assert.equal(result.datePickerDebug.transitionCount, 1);
  assert.equal(result.datePickerDebug.finalReasonCode, 'SUCCESS');
});
