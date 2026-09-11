import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const DateLike = require('../../src/controls/adapters/date-like-adapter.js');
const Events = require('../../src/core/event-dispatcher.js');
const Form = require('../../src/core/form-filler.js');

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
    this.attributes = new Map(Object.entries(options.attributes || {}));
    this.onClick = options.onClick || null;
  }

  get textContent() {
    return [this._text, ...this.children.map(child => child.textContent)].filter(Boolean).join(' ');
  }
  set textContent(value) { this._text = String(value || ''); }
  get innerText() { return this.textContent; }
  set innerText(value) { this._text = String(value || ''); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  removeAttribute(name) { this.attributes.delete(name); }
  append(...children) {
    children.flat().filter(Boolean).forEach(child => {
      child.parentElement = this;
      child.ownerDocument = this.ownerDocument;
      this.children.push(child);
    });
  }
  replaceChildren(...children) {
    this.children.forEach(child => { child.parentElement = null; });
    this.children = [];
    this.append(...children);
  }
  contains(other) {
    return other === this || this.children.some(child => child.contains?.(other));
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  querySelectorAll(selector) {
    const descendants = [];
    const walk = node => node.children.forEach(child => {
      descendants.push(child);
      walk(child);
    });
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
  getBoundingClientRect() { return { width: 180, height: 34, left: 0, top: 0, right: 180, bottom: 34 }; }
  focus() {}
  blur() {}
  dispatchEvent() { return true; }
  click() { this.clickCount += 1; this.onClick?.(this); }
}

function bind(document, node) {
  node.ownerDocument = document;
  node.children.forEach(child => bind(document, child));
  return node;
}

function makeDocument(overlays = []) {
  class TestEvent {
    constructor(type, init = {}) {
      this.type = type;
      this.defaultPrevented = false;
      Object.assign(this, init);
    }
    preventDefault() { if (this.cancelable) this.defaultPrevented = true; }
  }
  const document = {
    nodeType: 9,
    overlays,
    defaultView: {
      Event: TestEvent,
      MouseEvent: TestEvent,
      PointerEvent: TestEvent,
      FocusEvent: TestEvent,
      requestAnimationFrame(callback) { callback(); },
      getComputedStyle(node) {
        return node.hidden
          ? { display: 'none', visibility: 'hidden', opacity: '0' }
          : { display: 'block', visibility: 'visible', opacity: '1' };
      },
    },
    body: null,
    documentElement: null,
    querySelectorAll(selector) {
      const parts = selectorParts(selector);
      return this.overlays.filter(node => parts.some(part => matchesSelector(node, part)));
    },
    getElementById(id) { return this.overlays.find(panel => panel.id === id) || null; },
  };
  document.body = bind(document, new TestNode('BODY'));
  document.documentElement = bind(document, new TestNode('HTML'));
  overlays.forEach(panel => bind(document, panel));
  return document;
}

function action(text, attributes = {}, onClick = null, options = {}) {
  return new TestNode(options.tagName || 'BUTTON', {
    type: options.tagName === 'A' ? '' : 'button', text, attributes, onClick,
    className: options.className || '', disabled: Boolean(options.disabled),
  });
}

function dateDescriptor(input, trigger, options = {}) {
  return {
    detectorId: options.id || 'calendar-field',
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

function pickerFixture(options = {}) {
  const expectedPrecision = options.expectedPrecision || 'month';
  const input = new TestNode('INPUT', { type: 'text', readOnly: true });
  input.value = options.initialValue || '';
  let year = options.year || 2026;
  let month = options.month || 8;
  let mode = options.mode || 'DAY';
  let document;
  let panel;
  const counters = {
    modeSwitch: 0, previousYear: 0, nextYear: 0, year: 0, month: 0,
    yearModeSwitch: 0,
    previousDecade: 0, nextDecade: 0,
    day: 0, outsideDay: 0, disabledDay: 0,
  };

  const writeMonth = () => {
    input.value = `${year}-${String(month).padStart(2, '0')}`;
    panel.hidden = true;
  };
  const writeDay = day => {
    input.value = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    panel.hidden = true;
  };

  function replaceOwnedPanel(nextMode) {
    const old = panel;
    old.isConnected = false;
    panel = new TestNode('DIV', {
      id: options.panelId || 'calendar-owned',
      className: 'ant-picker-dropdown date-picker-panel',
      attributes: { role: 'dialog', 'aria-label': options.panelLabel || '日期选择面板' },
    });
    mode = nextMode;
    const index = document.overlays.indexOf(old);
    document.overlays.splice(index, 1, panel);
    bind(document, panel);
    render();
  }

  function transition(nextMode) {
    if (options.replacePanelOnSwitch) replaceOwnedPanel(nextMode);
    else { mode = nextMode; render(); }
  }

  function render() {
    panel.setAttribute('data-calendar-mode', mode);
    panel.setAttribute('data-calendar-year', year);
    panel.setAttribute('data-calendar-month', month);
    const previousYear = action('上一年', {
      'aria-label': '上一年', 'data-calendar-nav': 'previous-year',
    }, () => { counters.previousYear += 1; year -= 1; render(); }, { className: 'ant-picker-header-super-prev-btn' });
    const nextYear = action('下一年', {
      'aria-label': '下一年', 'data-calendar-nav': 'next-year',
    }, () => { counters.nextYear += 1; year += 1; render(); }, { className: 'ant-picker-header-super-next-btn' });
    const yearLabel = new TestNode('STRONG', { text: mode === 'YEAR' ? `${Math.floor(year / 10) * 10}-${Math.floor(year / 10) * 10 + 9}` : `${year}年` });
    const children = [previousYear, yearLabel];

    if (mode === 'DAY') {
      if (options.hasYearSwitch) {
        const legacy = options.yearSwitchVariant !== 'modern';
        children.push(action(`${year}年`, {
          'aria-label': '选择年份', 'data-calendar-mode-switch': 'YEAR',
        }, () => {
          counters.yearModeSwitch += 1;
          transition('YEAR');
        }, {
          tagName: legacy ? 'A' : 'BUTTON',
          className: legacy ? 'ant-calendar-year-select' : 'ant-picker-year-btn',
        }));
      }
      if (options.hasMonthSwitch !== false) {
        children.push(action(`${month}月`, {
          'aria-label': '选择月份', 'data-calendar-mode-switch': 'MONTH',
        }, () => {
          counters.modeSwitch += 1;
          transition('MONTH');
        }, { className: 'ant-picker-month-btn' }));
      } else {
        children.push(action(`${month}月`, { 'aria-label': '当前月份' }, () => { counters.modeSwitch += 100; }, { className: 'calendar-caption' }));
      }
      children.push(nextYear);
      for (const weekday of ['日', '一', '二', '三', '四', '五', '六']) {
        children.push(new TestNode('SPAN', {
          text: weekday,
          attributes: { role: 'columnheader', 'data-calendar-weekday': weekday },
          className: 'calendar-weekday',
        }));
      }
      const targetDay = Number(options.duplicateDay || 17);
      if (options.includeDuplicateDays) {
        children.push(action(String(targetDay), {
          role: 'gridcell', 'data-calendar-day-option': targetDay,
          'data-outside-month': 'true', 'aria-label': `上月${targetDay}日`,
        }, () => { counters.outsideDay += 1; }, { className: 'date-cell outside-month' }));
        children.push(action(String(targetDay), {
          role: 'gridcell', 'data-calendar-day-option': targetDay,
          'data-current-month': 'true', 'aria-label': `${year}年${month}月${targetDay}日`,
        }, () => { counters.disabledDay += 1; }, { className: 'date-cell disabled', disabled: true }));
      }
      if (options.includeAncestorDuplicateDays) {
        const outside = new TestNode('TD', { className: 'ant-picker-cell outside-month' });
        outside.append(action(String(targetDay), {
          role: 'gridcell', 'data-calendar-day-option': targetDay, 'aria-label': `${targetDay}日`,
        }, () => { counters.outsideDay += 1; }, { className: 'date-cell' }));
        const disabled = new TestNode('TD', { className: 'ant-picker-cell ant-picker-cell-disabled', attributes: { 'aria-disabled': 'true' } });
        disabled.append(action(String(targetDay), {
          role: 'gridcell', 'data-calendar-day-option': targetDay, 'aria-label': `${targetDay}日`,
        }, () => { counters.disabledDay += 1; }, { className: 'date-cell' }));
        children.push(outside, disabled);
      }
      for (let day = 1; day <= 31; day += 1) {
        children.push(action(String(day), {
          role: 'gridcell', 'data-calendar-day-option': day,
          'data-current-month': 'true', 'aria-label': `${year}年${month}月${day}日`,
        }, () => { counters.day += 1; writeDay(day); }, { className: 'date-cell' }));
      }
    } else if (mode === 'MONTH') {
      children.push(nextYear);
      for (let value = 1; value <= 12; value += 1) {
        children.push(action(`${value}月`, {
          role: 'option', 'data-calendar-month-option': value, 'aria-label': `${value}月`,
        }, () => {
          counters.month += 1;
          if (!options.monthSelectionStaysWrong) month = value;
          if (expectedPrecision === 'day') transition('DAY');
          else writeMonth();
        }, { className: 'month-cell' }));
      }
    } else if (mode === 'YEAR') {
      children.push(nextYear);
      if (options.yearGridDecadeNavigation) {
        const previousLabel = options.antV4DecadeControls ? '上一年代' : '上一组年份';
        const nextLabel = options.antV4DecadeControls ? '下一年代' : '下一组年份';
        children.push(
          action(previousLabel, {
            'aria-label': previousLabel,
            ...(options.antV4DecadeControls ? {} : { 'data-calendar-nav': 'previous-decade' }),
          }, () => { counters.previousDecade += 1; year -= 10; render(); }, {
            className: options.antV4DecadeControls ? 'ant-picker-header-super-prev-btn' : 'calendar-prev-decade',
          }),
          action(nextLabel, {
            'aria-label': nextLabel,
            ...(options.antV4DecadeControls ? {} : { 'data-calendar-nav': 'next-decade' }),
          }, () => { counters.nextDecade += 1; year += 10; render(); }, {
            className: options.antV4DecadeControls ? 'ant-picker-header-super-next-btn' : 'calendar-next-decade',
          }),
        );
      }
      const decade = Math.floor(year / 10) * 10;
      for (let value = decade; value < decade + 10; value += 1) {
        children.push(action(`${value}年`, {
          role: 'option', 'data-calendar-year-option': value, 'aria-label': `${value}年`,
        }, () => { counters.year += 1; year = value; transition('MONTH'); }, { className: 'year-cell' }));
      }
    }
    panel.replaceChildren(...children);
    if (document) bind(document, panel);
  }

  panel = new TestNode('DIV', {
    id: options.panelId || 'calendar-owned',
    className: 'ant-picker-dropdown date-picker-panel',
    hidden: true,
    attributes: { role: 'dialog', 'aria-label': options.panelLabel || '日期选择面板' },
  });
  render();
  const trigger = action('日历', {
    'aria-label': options.triggerLabel || '选择日期',
    ...(options.controlled === false ? {} : { 'aria-controls': panel.id }),
  }, () => {
    panel.hidden = false;
    options.onOpen?.({ document, panel });
  }, { className: 'ant-picker-suffix calendar-trigger' });
  const container = new TestNode('DIV', { className: 'ant-form-item-control ant-picker' });
  container.append(input, trigger);
  document = makeDocument([...(options.otherPanels || []), panel]);
  bind(document, container);
  bind(document, panel);
  const descriptor = dateDescriptor(input, trigger, {
    id: options.id,
    label: options.label || (expectedPrecision === 'day' ? '出生日期' : '入学时间'),
    placeholder: options.placeholder || (expectedPrecision === 'day' ? '请选择出生日期' : '请选择入学时间'),
  });
  return {
    document, input, trigger, descriptor, counters,
    get panel() { return panel; },
    get mode() { return mode; },
    get year() { return year; },
    get month() { return month; },
  };
}

function plainDialog({ id = 'generic-dialog', hidden = true, viewer = false } = {}) {
  const previous = action('Previous', { 'aria-label': 'Previous' });
  const next = action('Next', { 'aria-label': 'Next' });
  const numbers = Array.from({ length: 12 }, (_, index) => action(String(index + 1), { role: 'gridcell' }));
  const panel = new TestNode('DIV', {
    id,
    className: viewer ? 'image-viewer-dialog' : 'generic-dialog',
    hidden,
    attributes: { role: 'dialog', 'aria-label': viewer ? '图片预览' : '普通弹窗' },
  });
  panel.append(new TestNode('SPAN', { text: '2026 年 8 月 普通数字' }), previous, next, ...numbers);
  return { panel, previous, next, numbers };
}

function context(fixture, value, fieldPath, settings = {}) {
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
  return DateLike.write(context(fixture, value, fieldPath, settings));
}

test('case 1: Ant DAY_GRID switches within its owned panel, rebinds replacement DOM, then writes enrollment year-month', async () => {
  const fixture = pickerFixture({
    id: 'enrollment', panelId: 'calendar-enroll', year: 2026, month: 8,
    expectedPrecision: 'month', replacePanelOnSwitch: true,
  });
  const originalPanel = fixture.panel;
  const result = await write(fixture, '2023-09', 'education[].enrollmentDate', { maxYearNavigationSteps: 4 });

  assert.equal(result.status, 'SUCCESS', result.reason);
  assert.equal(fixture.input.value, '2023-09');
  assert.equal(fixture.counters.modeSwitch, 1);
  assert.equal(fixture.counters.previousYear, 3);
  assert.equal(fixture.counters.month, 1);
  assert.equal(originalPanel.isConnected, false);
  assert.notEqual(fixture.panel, originalPanel);
  assert.equal(fixture.panel.id, 'calendar-enroll');
});

test('case 2: graduation operates only its own DAY panel and writes 2027-06', async () => {
  const enrollment = pickerFixture({ panelId: 'calendar-enroll', year: 2023, expectedPrecision: 'month' });
  const fixture = pickerFixture({
    id: 'graduation', panelId: 'calendar-graduate', year: 2027, month: 8,
    expectedPrecision: 'month', label: '毕业时间', placeholder: '请选择毕业时间',
    otherPanels: [enrollment.panel],
  });
  const result = await write(fixture, '2027-06', 'education[].graduationDate');

  assert.equal(result.status, 'SUCCESS', result.reason);
  assert.equal(fixture.input.value, '2027-06');
  assert.equal(enrollment.input.value, '');
  assert.equal(enrollment.counters.modeSwitch + enrollment.counters.month + enrollment.counters.day, 0);
});

test('case 3: aria-controls owns calendar-enroll among graduate and image viewer overlays', async () => {
  const graduate = pickerFixture({ panelId: 'calendar-graduate', expectedPrecision: 'month' });
  const viewer = plainDialog({ id: 'image-viewer-dialog', hidden: false, viewer: true });
  const fixture = pickerFixture({
    panelId: 'calendar-enroll', year: 2023, expectedPrecision: 'month',
    otherPanels: [graduate.panel, viewer.panel],
  });
  const result = await write(fixture, '2023-09', 'education[].enrollmentDate');

  assert.equal(result.status, 'SUCCESS', result.reason);
  assert.equal(fixture.input.value, '2023-09');
  assert.equal(graduate.counters.modeSwitch + graduate.counters.month, 0);
  assert.equal(viewer.previous.clickCount + viewer.next.clickCount, 0);
});

test('case 4: a pre-existing hidden controlled panel is recognized after same-element visibility transition', async () => {
  const fixture = pickerFixture({ panelId: 'calendar-hidden', year: 2023, expectedPrecision: 'month' });
  const samePanel = fixture.panel;
  assert.equal(samePanel.hidden, true);
  const result = await write(fixture, '2023-09', 'education[].enrollmentDate');

  assert.equal(result.status, 'SUCCESS', result.reason);
  assert.equal(fixture.panel, samePanel);
  assert.equal(fixture.trigger.clickCount, 1);
});

test('case 5: an unknown generic dialog with numbers and Previous/Next is not a date panel and receives zero inner clicks', async () => {
  const generic = plainDialog({ id: 'generic-dialog' });
  const input = new TestNode('INPUT', { type: 'text', readOnly: true });
  input.value = '';
  const trigger = action('日历', { 'aria-label': '选择入学时间', 'aria-controls': generic.panel.id }, () => { generic.panel.hidden = false; }, { className: 'calendar-trigger' });
  const document = makeDocument([generic.panel]);
  bind(document, input);
  bind(document, trigger);
  const fixture = { input, trigger, document, descriptor: dateDescriptor(input, trigger) };
  const result = await write(fixture, '2023-09', 'education[].enrollmentDate');

  assert.equal(result.status, 'NEEDS_CONFIRMATION');
  assert.equal(generic.previous.clickCount + generic.next.clickCount, 0);
  assert.equal(generic.numbers.reduce((sum, node) => sum + node.clickCount, 0), 0);
});

test('case 6: an image viewer stays at zero clicks while an owned date panel succeeds', async () => {
  const viewer = plainDialog({ id: 'image-viewer-dialog', hidden: false, viewer: true });
  const fixture = pickerFixture({ panelId: 'calendar-enroll', year: 2023, expectedPrecision: 'month', otherPanels: [viewer.panel] });
  const result = await write(fixture, '2023-09', 'education[].enrollmentDate');

  assert.equal(result.status, 'SUCCESS', result.reason);
  assert.equal(viewer.previous.clickCount, 0);
  assert.equal(viewer.next.clickCount, 0);
});

test('case 7: a reliable DAY_GRID without a reliable panel-scoped month switch fails closed', async () => {
  const fixture = pickerFixture({ panelId: 'calendar-no-switch', year: 2023, expectedPrecision: 'month', hasMonthSwitch: false });
  const result = await write(fixture, '2023-09', 'education[].enrollmentDate');

  assert.equal(result.status, 'NEEDS_CONFIRMATION');
  assert.equal(fixture.counters.modeSwitch, 0);
  assert.equal(fixture.counters.day + fixture.counters.month + fixture.counters.previousYear + fixture.counters.nextYear, 0);
  assert.equal(fixture.input.value, '');
  assert.deepEqual(result.datePickerDebug.modeSwitchDebug, {
    panelMode: 'DAY',
    headerCandidateCount: 0,
    monthSwitchCandidateCount: 0,
    yearSwitchCandidateCount: 0,
    candidateKinds: [],
    rejectionReasons: ['NO_HEADER_CANDIDATE'],
    selectedSwitchSource: '',
    safetyReason: '',
  });
});

test('phase 3.5 RED: legacy Ant DAY uses its unique owned year selector when no month selector exists', async () => {
  const fixture = pickerFixture({
    panelId: 'calendar-legacy-year-fallback', year: 2026, month: 8,
    expectedPrecision: 'month', hasMonthSwitch: false, hasYearSwitch: true,
    yearSwitchVariant: 'legacy',
  });
  const samePanel = fixture.panel;
  const result = await write(fixture, '2023-09', 'education[].enrollmentDate');

  assert.equal(result.status, 'SUCCESS', result.reason);
  assert.equal(fixture.panel, samePanel, 'legacy DAY→YEAR→MONTH may mutate the same owned panel node');
  assert.equal(fixture.input.value, '2023-09');
  assert.equal(fixture.counters.yearModeSwitch, 1);
  assert.equal(fixture.counters.year, 1);
  assert.equal(fixture.counters.month, 1);
  assert.equal(fixture.counters.previousYear + fixture.counters.nextYear, 0);
  assert.equal(result.datePickerDebug.transitionCount, 2);
  assert.equal(result.datePickerDebug.finalReasonCode, 'SUCCESS');
});

test('phase 3.5 RED: modern Ant replacement rebinds DAY→YEAR→MONTH without a month selector', async () => {
  const fixture = pickerFixture({
    panelId: 'calendar-modern-year-fallback', year: 2027, month: 8,
    expectedPrecision: 'month', hasMonthSwitch: false, hasYearSwitch: true,
    yearSwitchVariant: 'modern', replacePanelOnSwitch: true,
  });
  const originalPanel = fixture.panel;
  const result = await write(fixture, '2027-06', 'education[].graduationDate');

  assert.equal(result.status, 'SUCCESS', result.reason);
  assert.equal(fixture.input.value, '2027-06');
  assert.equal(fixture.counters.yearModeSwitch, 1);
  assert.equal(fixture.counters.year, 1);
  assert.equal(fixture.counters.month, 1);
  assert.notEqual(fixture.panel, originalPanel);
});

test('phase 3.5 completion: legacy popup-root replacement rebinds DAY→YEAR→MONTH by the controlled id', async () => {
  const fixture = pickerFixture({
    panelId: 'calendar-legacy-root-replacement', year: 2026, month: 8,
    expectedPrecision: 'month', hasMonthSwitch: false, hasYearSwitch: true,
    yearSwitchVariant: 'legacy', replacePanelOnSwitch: true,
  });
  const originalPanel = fixture.panel;
  const result = await write(fixture, '2023-09', 'education[].enrollmentDate');

  assert.equal(result.status, 'SUCCESS', result.reason);
  assert.equal(fixture.input.value, '2023-09');
  assert.notEqual(fixture.panel, originalPanel);
  assert.equal(originalPanel.isConnected, false);
  assert.equal(fixture.panel.id, 'calendar-legacy-root-replacement');
  assert.equal(fixture.counters.yearModeSwitch, 1);
  assert.equal(fixture.counters.year, 1);
  assert.equal(fixture.counters.month, 1);
});

test('phase 3.5 RED safety: a competing year selector injected on pointerdown prevents the real click', async () => {
  const fixture = pickerFixture({
    panelId: 'calendar-year-switch-race', year: 2026, month: 8,
    expectedPrecision: 'month', hasMonthSwitch: false, hasYearSwitch: true,
    yearSwitchVariant: 'legacy',
  });
  const yearSwitch = fixture.panel.querySelector('.ant-calendar-year-select');
  let injected = false;
  yearSwitch.dispatchEvent = event => {
    if (event.type === 'pointerdown' && !injected) {
      injected = true;
      fixture.panel.append(action('2026年', {
        role: 'button', 'aria-label': '选择年份', 'data-calendar-mode-switch': 'YEAR',
      }, null, { tagName: 'A', className: 'ant-calendar-year-select' }));
      bind(fixture.document, fixture.panel);
    }
    return true;
  };

  const result = await write(fixture, '2023-09', 'education[].enrollmentDate');
  assert.equal(injected, true, 'mode-switch safety must reach the pointerdown recheck');
  assert.equal(result.status, 'NEEDS_CONFIRMATION');
  assert.equal(yearSwitch.clickCount, 0);
  assert.equal(fixture.counters.yearModeSwitch, 0);
  assert.equal(fixture.input.value, '');
});

test('case 8: full birthday navigates year/month and selects the unique enabled current-month day', async () => {
  const fixture = pickerFixture({
    id: 'birthday', panelId: 'calendar-birthday', year: 2004, month: 8,
    expectedPrecision: 'day', label: '出生日期', placeholder: '请选择出生日期',
    includeDuplicateDays: true, duplicateDay: 17,
  });
  const result = await write(fixture, '2003-05-17', 'basic.birthday', { maxYearNavigationSteps: 2 });

  assert.equal(result.status, 'SUCCESS', result.reason);
  assert.equal(fixture.input.value, '2003-05-17');
  assert.equal(fixture.counters.modeSwitch, 1);
  assert.equal(fixture.counters.previousYear, 1);
  assert.equal(fixture.counters.month, 1);
  assert.equal(fixture.counters.day, 1);
  assert.equal(fixture.counters.outsideDay, 0);
  assert.equal(fixture.counters.disabledDay, 0);
});

test('case 9: a full-date field with only month data stays NEEDS_CONFIRMATION and never opens', async () => {
  const fixture = pickerFixture({
    id: 'birthday', panelId: 'calendar-birthday', expectedPrecision: 'day',
    label: '出生日期', placeholder: 'YYYY-MM-DD',
  });
  const result = await write(fixture, '2020-09', 'basic.birthday');

  assert.equal(result.status, 'NEEDS_CONFIRMATION');
  assert.match(result.reason, /具体日期|年月/);
  assert.equal(fixture.trigger.clickCount, 0);
  assert.equal(fixture.input.value, '');
});

test('case 10: an existing semantic year-month value is SKIPPED_EXISTING without opening the picker', async () => {
  const fixture = pickerFixture({ initialValue: '2023年9月', panelId: 'calendar-existing', year: 2023, expectedPrecision: 'month' });
  const result = await Form.fill(fixture.descriptor, '2023-09', {
    fieldPath: 'education[].enrollmentDate', expectedType: 'date', allowOverwrite: false,
  });

  assert.equal(result.status, 'SKIPPED_EXISTING');
  assert.equal(fixture.trigger.clickCount, 0);
  assert.equal(fixture.counters.modeSwitch + fixture.counters.month + fixture.counters.day, 0);
});

test('case 11: an owned YEAR_GRID selects the target year, reinspects MONTH, then commits', async () => {
  const fixture = pickerFixture({ mode: 'YEAR', panelId: 'calendar-year-grid', year: 2025, expectedPrecision: 'month' });
  const result = await write(fixture, '2027-06', 'education[].graduationDate');

  assert.equal(result.status, 'SUCCESS', result.reason);
  assert.equal(fixture.input.value, '2027-06');
  assert.equal(fixture.counters.year, 1);
  assert.equal(fixture.counters.month, 1);
});

test('case 12: a resolved controlled UNKNOWN target never falls back to another fresh reliable calendar', async () => {
  const reliable = pickerFixture({ panelId: 'fresh-reliable', year: 2023, expectedPrecision: 'month' });
  const unknown = plainDialog({ id: 'controlled-unknown' });
  const input = new TestNode('INPUT', { type: 'text', readOnly: true });
  input.value = '';
  const trigger = action('日历', {
    'aria-label': '选择入学时间', 'aria-controls': unknown.panel.id,
  }, () => { unknown.panel.hidden = false; reliable.panel.hidden = false; }, { className: 'calendar-trigger' });
  const document = makeDocument([unknown.panel, reliable.panel]);
  bind(document, input);
  bind(document, trigger);
  const fixture = { input, trigger, descriptor: dateDescriptor(input, trigger) };
  const result = await write(fixture, '2023-09', 'education[].enrollmentDate');

  assert.equal(result.status, 'NEEDS_CONFIRMATION');
  assert.equal(reliable.counters.modeSwitch + reliable.counters.month + reliable.counters.day, 0);
  assert.equal(input.value, '');
});

test('case 13: YEAR_GRID decade navigation is bounded and reclassified after every panel update', async () => {
  const fixture = pickerFixture({
    mode: 'YEAR', panelId: 'calendar-distant-year', year: 2025,
    expectedPrecision: 'month', yearGridDecadeNavigation: true,
  });
  const result = await write(fixture, '2047-06', 'education[].graduationDate', {
    maxYearGridNavigationSteps: 3,
  });

  assert.equal(result.status, 'SUCCESS', result.reason);
  assert.equal(fixture.input.value, '2047-06');
  assert.equal(fixture.counters.nextDecade, 2);
  assert.equal(fixture.counters.previousDecade, 0);
  assert.equal(fixture.counters.year, 1);
});

test('case 14: Ant v4 YEAR_GRID decade controls work without data-calendar-nav', async () => {
  const fixture = pickerFixture({
    mode: 'YEAR', panelId: 'calendar-ant-v4-decade', year: 2025,
    expectedPrecision: 'month', yearGridDecadeNavigation: true, antV4DecadeControls: true,
  });
  const result = await write(fixture, '2047-06', 'education[].graduationDate', {
    maxYearGridNavigationSteps: 3,
  });

  assert.equal(result.status, 'SUCCESS', result.reason);
  assert.equal(fixture.input.value, '2047-06');
  assert.equal(fixture.counters.nextDecade, 2);
  assert.equal(fixture.counters.previousDecade, 0);
});

test('EventDispatcher binds mode switches/options/navigation to ownerPanel and declared calendar semantics', () => {
  const first = pickerFixture({ panelId: 'first-panel', year: 2023, expectedPrecision: 'month' });
  const second = pickerFixture({ panelId: 'second-panel', year: 2023, expectedPrecision: 'month' });
  first.panel.hidden = false;
  second.panel.hidden = false;
  const switcher = first.panel.querySelector('[data-calendar-mode-switch="MONTH"]');
  assert.ok(switcher);
  assert.equal(Events.canClickLikeUser(switcher, {
    purpose: 'date-picker-mode-switch', ownerPanel: first.panel, calendarMode: 'DAY', targetMode: 'MONTH',
  }), true);
  assert.equal(Events.canClickLikeUser(switcher, {
    purpose: 'date-picker-mode-switch', ownerPanel: second.panel, calendarMode: 'DAY', targetMode: 'MONTH',
  }), false);
});

test('ancestor cell state: outside-month/disabled parent td cannot make duplicate day ambiguous or clickable', async () => {
  const fixture = pickerFixture({
    id: 'birthday', panelId: 'calendar-ancestor-cells', year: 2003, month: 5,
    expectedPrecision: 'day', label: '出生日期', placeholder: '请选择出生日期',
    includeAncestorDuplicateDays: true, duplicateDay: 17,
  });
  const result = await write(fixture, '2003-05-17', 'basic.birthday');

  assert.equal(result.status, 'SUCCESS', result.reason);
  assert.equal(fixture.counters.day, 1);
  assert.equal(fixture.counters.outsideDay, 0);
  assert.equal(fixture.counters.disabledDay, 0);
});

test('EventDispatcher rechecks ancestor day-cell state after pointerdown before the real click', () => {
  const panel = new TestNode('DIV', {
    className: 'ant-picker-dropdown date-picker-panel',
    attributes: { role: 'dialog', 'data-calendar-mode': 'DAY' },
  });
  const cell = new TestNode('TD', { className: 'ant-picker-cell' });
  const day = action('17', {
    role: 'gridcell', 'data-calendar-day-option': '17', 'data-current-month': 'true',
  }, null, { className: 'date-cell' });
  cell.append(day);
  panel.append(cell);
  const document = makeDocument([panel]);
  bind(document, panel);
  day.dispatchEvent = event => {
    if (event.type === 'pointerdown') cell.className = 'ant-picker-cell outside-month';
    return true;
  };

  assert.equal(Events.clickLikeUser(day, {
    purpose: 'date-picker-option', ownerPanel: panel, calendarMode: 'DAY', expectedPart: 17,
  }), false);
  assert.equal(day.clickCount, 0);
});

test('EventDispatcher rechecks ancestor day-cell state after mouseup before the real click', () => {
  const panel = new TestNode('DIV', {
    className: 'ant-picker-dropdown date-picker-panel',
    attributes: { role: 'dialog', 'data-calendar-mode': 'DAY' },
  });
  const cell = new TestNode('TD', { className: 'ant-picker-cell' });
  const day = action('17', {
    role: 'gridcell', 'data-calendar-day-option': '17', 'data-current-month': 'true',
  }, null, { className: 'date-cell' });
  cell.append(day);
  panel.append(cell);
  const document = makeDocument([panel]);
  bind(document, panel);
  day.dispatchEvent = event => {
    if (event.type === 'mouseup') cell.className = 'ant-picker-cell outside-month';
    return true;
  };

  assert.equal(Events.clickLikeUser(day, {
    purpose: 'date-picker-option', ownerPanel: panel, calendarMode: 'DAY', expectedPart: 17,
  }), false);
  assert.equal(day.clickCount, 0);
});

test('EventDispatcher rechecks a legacy Ant anchor after mouseup before the real click', () => {
  const panel = new TestNode('DIV', {
    className: 'ant-picker-dropdown date-picker-panel',
    attributes: { role: 'dialog', 'data-calendar-mode': 'MONTH' },
  });
  const previous = action('', { role: 'button', 'aria-label': '上一年' }, null, {
    tagName: 'A', className: 'ant-calendar-prev-year-btn',
  });
  panel.append(previous);
  const document = makeDocument([panel]);
  bind(document, panel);
  previous.dispatchEvent = event => {
    if (event.type === 'mouseup') previous.setAttribute('href', '#');
    return true;
  };

  assert.equal(Events.clickLikeUser(previous, {
    purpose: 'date-picker-navigation', ownerPanel: panel, calendarMode: 'MONTH',
    navigationUnit: 'year', direction: -1,
  }), false);
  assert.equal(previous.clickCount, 0);
});

test('calendar mode transitions retain a hard upper bound of four', async () => {
  const fixture = pickerFixture({
    id: 'birthday', panelId: 'calendar-mode-loop', expectedPrecision: 'day',
    label: '出生日期', monthSelectionStaysWrong: true,
  });
  const result = await write(fixture, '2026-09-17', 'basic.birthday', {
    maxCalendarModeTransitions: 99,
  });

  assert.equal(result.status, 'NEEDS_CONFIRMATION');
  assert.equal(fixture.counters.modeSwitch, 2);
  assert.equal(fixture.counters.month, 2);
  assert.equal(fixture.counters.day, 0);
});

test('Ant v3 exact owned mode-switch anchor needs no role and an inert href uses a canceled synthetic click', () => {
  const fixture = pickerFixture({ panelId: 'ant-v3-panel', year: 2023, month: 8, expectedPrecision: 'month' });
  fixture.panel.hidden = false;
  const monthAnchor = action('8月', { 'aria-label': '选择月份' }, null, {
    tagName: 'A', className: 'ant-calendar-month-select',
  });
  const previousAnchor = action('', { role: 'button', 'aria-label': '上一年' }, null, {
    tagName: 'A', className: 'ant-calendar-prev-year-btn',
  });
  const genericPreviousAnchor = action('', { role: 'button', 'aria-label': '上一年' }, null, {
    tagName: 'A', className: 'generic-previous-control',
  });
  fixture.panel.append(monthAnchor, previousAnchor, genericPreviousAnchor);
  bind(fixture.document, fixture.panel);
  const ownedMonth = {
    purpose: 'date-picker-mode-switch', ownerPanel: fixture.panel,
    calendarMode: 'DAY', targetMode: 'MONTH', liveOwnerGuard: () => true,
  };

  assert.equal(Events.canClickLikeUser(monthAnchor, ownedMonth), true);
  assert.equal(Events.clickSafetyReason(monthAnchor, ownedMonth), '');

  monthAnchor.setAttribute('href', '#');
  let frameworkClickCount = 0;
  let nativeClickCount = 0;
  let clickDefaultPrevented = false;
  monthAnchor.click = () => { nativeClickCount += 1; };
  monthAnchor.dispatchEvent = event => {
    if (event.type === 'click') {
      frameworkClickCount += 1;
      clickDefaultPrevented = Boolean(event.defaultPrevented);
    }
    return !event.defaultPrevented;
  };
  assert.equal(Events.clickLikeUser(monthAnchor, ownedMonth), true);
  assert.equal(frameworkClickCount, 1);
  assert.equal(nativeClickCount, 0);
  assert.equal(clickDefaultPrevented, true);

  monthAnchor.setAttribute('href', '/application/next');
  assert.equal(Events.canClickLikeUser(monthAnchor, ownedMonth), false);
  assert.equal(Events.clickSafetyReason(monthAnchor, ownedMonth), 'HREF_PRESENT');

  fixture.panel.setAttribute('data-calendar-mode', 'MONTH');
  assert.equal(Events.canClickLikeUser(previousAnchor, {
    purpose: 'date-picker-navigation', ownerPanel: fixture.panel, calendarMode: 'MONTH',
    navigationUnit: 'year', direction: -1,
  }), true);
  assert.equal(Events.canClickLikeUser(genericPreviousAnchor, {
    purpose: 'date-picker-navigation', ownerPanel: fixture.panel, calendarMode: 'MONTH',
    navigationUnit: 'year', direction: -1,
  }), false);
  assert.equal(Events.canClickLikeUser(previousAnchor, {
    purpose: 'date-picker-navigation', ownerPanel: fixture.panel, calendarMode: 'MONTH',
    navigationUnit: 'year', direction: 1,
  }), false);
  previousAnchor.onclick = () => {};
  assert.equal(Events.canClickLikeUser(previousAnchor, {
    purpose: 'date-picker-navigation', ownerPanel: fixture.panel, calendarMode: 'MONTH',
    navigationUnit: 'year', direction: -1,
  }), false);
  previousAnchor.onclick = null;
});

test('Legacy mode-switch scoped override stays fail-closed outside exact live ownership', () => {
  const fixture = pickerFixture({ panelId: 'ant-v3-safety-panel', expectedPrecision: 'month' });
  fixture.panel.hidden = false;
  const monthAnchor = action('8月', { 'aria-label': '选择月份' }, null, {
    tagName: 'A', className: 'ant-calendar-month-select',
  });
  fixture.panel.append(monthAnchor);
  bind(fixture.document, fixture.panel);
  const base = {
    purpose: 'date-picker-mode-switch', ownerPanel: fixture.panel,
    calendarMode: 'DAY', targetMode: 'MONTH', liveOwnerGuard: () => true,
  };

  assert.equal(Events.clickSafetyReason(monthAnchor, { ...base, liveOwnerGuard: () => false }), 'LIVE_GUARD_FAILED');
  assert.equal(Events.clickSafetyReason(monthAnchor, { ...base, targetMode: 'YEAR' }), 'MODE_MISMATCH');
  const otherPanel = new TestNode('DIV', {
    className: 'ant-picker-dropdown date-picker-panel',
    attributes: { role: 'dialog', 'data-calendar-mode': 'DAY' },
  });
  bind(fixture.document, otherPanel);
  assert.equal(Events.clickSafetyReason(monthAnchor, { ...base, ownerPanel: otherPanel }), 'OWNER_MISMATCH');
  monthAnchor.setAttribute('formaction', '/submit');
  assert.equal(Events.clickSafetyReason(monthAnchor, base), 'FORM_ACTION_PRESENT');
  monthAnchor.removeAttribute('formaction');
  monthAnchor.setAttribute('onclick', 'submitApplication()');
  assert.equal(Events.clickSafetyReason(monthAnchor, base), 'INLINE_HANDLER_PRESENT');
  monthAnchor.removeAttribute('onclick');
  monthAnchor.disabled = true;
  assert.equal(Events.clickSafetyReason(monthAnchor, base), 'DISABLED');
  monthAnchor.disabled = false;
  const genericAnchor = action('8月', { 'aria-label': '选择月份' }, null, {
    tagName: 'A', className: 'calendar-month-switch',
  });
  fixture.panel.append(genericAnchor);
  bind(fixture.document, genericAnchor);
  assert.equal(Events.clickSafetyReason(genericAnchor, base), 'LINK_ROLE_MISSING');
  monthAnchor.isConnected = false;
  assert.equal(Events.clickSafetyReason(monthAnchor, base), 'DETACHED');
});
