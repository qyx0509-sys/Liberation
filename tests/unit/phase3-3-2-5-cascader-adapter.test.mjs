import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Detector = require('../../src/core/field-detector.js');
const Registry = require('../../src/controls/control-adapter-registry.js');
const EventDispatcher = require('../../src/core/event-dispatcher.js');
const CascaderAdapter = require('../../src/controls/adapters/cascader-adapter.js');
const FormFiller = require('../../src/core/form-filler.js');

class FakeElement {
  constructor(tagName, options = {}) {
    this.tagName = String(tagName || 'div').toUpperCase();
    this.className = options.className || '';
    this.textContent = options.textContent || '';
    this.innerText = this.textContent;
    this.type = options.type || '';
    this.id = options.id || '';
    this.value = options.value || '';
    this.placeholder = options.placeholder || '';
    this.hidden = Boolean(options.hidden);
    this.disabled = false;
    this.readOnly = Boolean(options.readOnly);
    this.required = false;
    this.multiple = false;
    this.isConnected = true;
    this.isContentEditable = false;
    this.dataset = {};
    this.labels = [];
    this.attributes = new Map(Object.entries(options.attributes || {}));
    this.parentElement = null;
    this.previousElementSibling = null;
    this.children = [];
    this.childNodes = this.textContent ? [{ nodeType: 3, textContent: this.textContent }] : [];
    this.ownerDocument = null;
    this.clickCount = 0;
    this._dispatchHook = null;
    this._clickHook = null;
  }

  append(...children) {
    for (const child of children) {
      if (!child) continue;
      child.parentElement = this;
      child.previousElementSibling = this.children.at(-1) || null;
      child.ownerDocument = this.ownerDocument;
      this.children.push(child);
    }
    return this;
  }

  descendants() {
    return this.children.flatMap(child => [child, ...child.descendants()]);
  }

  getAttribute(name) {
    if (name === 'class') return this.className || null;
    if (name === 'id') return this.id || null;
    if (name === 'type') return this.type || null;
    if (name === 'placeholder') return this.placeholder || null;
    return this.attributes.get(name) ?? null;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  contains(candidate) {
    for (let current = candidate; current; current = current.parentElement) {
      if (current === this) return true;
    }
    return false;
  }

  matches(selector) {
    return String(selector || '').split(',').some(part => this.matchesOne(part.trim()));
  }

  matchesOne(selector) {
    if (!selector) return false;
    let terminal = selector.includes(' ') ? selector.split(/\s+/).at(-1) : selector;
    const classes = this.className.split(/\s+/).filter(Boolean);
    if (terminal === '*') return true;
    if (/^input/.test(terminal) && this.tagName !== 'INPUT') return false;
    if (/^button/.test(terminal) && this.tagName !== 'BUTTON') return false;
    if (/^label/.test(terminal) && this.tagName !== 'LABEL') return false;
    if (/^textarea/.test(terminal) && this.tagName !== 'TEXTAREA') return false;
    if (/^select/.test(terminal) && this.tagName !== 'SELECT') return false;
    if (terminal === 'tr' && this.tagName !== 'TR') return false;
    if (terminal === 'td' && this.tagName !== 'TD') return false;
    if (terminal === 'th' && this.tagName !== 'TH') return false;
    if (terminal.includes(':not([type="hidden"])')) {
      if (this.type === 'hidden') return false;
      terminal = terminal.replace(':not([type="hidden"])', '');
    }
    for (const id of terminal.matchAll(/#([A-Za-z0-9_-]+)/g)) {
      if (this.id !== id[1]) return false;
    }
    for (const className of terminal.matchAll(/\.([A-Za-z0-9_-]+)/g)) {
      if (!classes.includes(className[1])) return false;
    }
    for (const role of terminal.matchAll(/\[role="([^"]+)"\]/g)) {
      if (this.getAttribute('role') !== role[1]) return false;
    }
    for (const attribute of terminal.matchAll(/\[([\w-]+)="([^"]+)"\]/g)) {
      if (this.getAttribute(attribute[1]) !== attribute[2]) return false;
    }
    for (const attribute of terminal.matchAll(/\[([\w-]+)\]/g)) {
      if (this.getAttribute(attribute[1]) === null) return false;
    }
    for (const contains of terminal.matchAll(/\[class\*="([^"]+)"\]/g)) {
      if (!this.className.includes(contains[1])) return false;
    }
    if (/^[.#\[]/.test(terminal)) return true;
    return /^(input|button|label|textarea|select|tr|td|th)/.test(terminal);
  }

  closest(selector) {
    for (let current = this; current; current = current.parentElement) {
      if (current.matches?.(selector)) return current;
    }
    return null;
  }

  querySelectorAll(selector) {
    return this.descendants().filter(node => node.matches(selector));
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  cloneNode() {
    const clone = new FakeElement(this.tagName, {
      className: this.className,
      textContent: this.textContent,
    });
    clone.querySelectorAll = () => [];
    return clone;
  }

  dispatchEvent(event) {
    this._dispatchHook?.(event);
    return true;
  }

  click() {
    this.clickCount += 1;
    this._clickHook?.();
  }

  focus() {}

  blur() {}

  getBoundingClientRect() {
    return this.hidden
      ? { width: 0, height: 0, top: 0, left: 0 }
      : { width: 240, height: 32, top: 0, left: 0 };
  }
}

function makeDocument(roots) {
  const ids = new Map();
  const document = {
    nodeType: 9,
    body: null,
    documentElement: null,
    defaultView: {
      getComputedStyle(element) {
        return element?.hidden
          ? { display: 'none', visibility: 'hidden', opacity: '0', position: 'static' }
          : { display: 'block', visibility: 'visible', opacity: '1', position: 'static' };
      },
      requestAnimationFrame(callback) { callback(); },
      CSS: { escape(value) { return String(value); } },
      MutationObserver: class FakeMutationObserver {
        constructor(callback) { this.callback = callback; this.timer = null; }
        observe() { this.timer = setInterval(() => this.callback([]), 1); }
        disconnect() { clearInterval(this.timer); }
      },
    },
    getElementById(id) { return ids.get(id) || null; },
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
    querySelectorAll(selector) {
      const nodes = roots.flatMap(root => [root, ...root.descendants()]);
      return nodes.filter(node => node.matches(selector));
    },
  };
  document.body = document;
  document.documentElement = document;
  for (const root of roots) {
    for (const node of [root, ...root.descendants()]) {
      node.ownerDocument = document;
      if (node.id) ids.set(node.id, node);
    }
  }
  return document;
}

const LOCATIONS = Object.freeze({
  provinces: ['山东省', '浙江省'],
  cities: ['青岛市', '济南市'],
  districts: ['市北区', '市南区'],
});

function option(text, level, fixtureId) {
  return new FakeElement('li', {
    className: 'ant-cascader-menu-item',
    textContent: text,
    attributes: {
      role: 'menuitem',
      'data-value': text,
      'data-cascader-level': String(level),
      'data-fixture-id': fixtureId,
    },
  });
}

function makeCascader(id, options = {}) {
  const label = new FakeElement('label', {
    className: 'ant-form-item-label',
    textContent: options.label || '籍贯',
  });
  const root = new FakeElement('span', {
    className: options.rootClass || 'ant-cascader-picker',
    attributes: {
      'data-required-levels': String(options.requiredLevels ?? 3),
      'data-fixture-id': id,
    },
  });
  const trigger = new FakeElement('input', {
    className: options.inputClass || 'ant-input ant-cascader-input',
    type: options.inputType || 'text',
    placeholder: options.placeholder ?? '请选择省/市/区',
    readOnly: options.readOnly !== false,
    attributes: {
      'aria-haspopup': options.hasPopup || 'menu',
      ...(options.controlled === false ? {} : { 'aria-controls': `${id}_menus` }),
    },
  });
  root.append(trigger);
  const formItem = new FakeElement('div', { className: 'ant-form-item' }).append(label, root);

  const overlay = new FakeElement('div', {
    id: `${id}_menus`,
    className: 'ant-cascader-menus',
    hidden: options.initiallyVisible !== true,
    attributes: { 'data-fixture-id': id },
  });
  const provinceMenu = new FakeElement('ul', {
    className: 'ant-cascader-menu',
    hidden: options.initiallyVisible !== true,
    attributes: { 'data-cascader-level': '0' },
  }).append(...LOCATIONS.provinces.map(value => option(value, 0, id)));
  const cities = options.ambiguousCity
    ? ['青岛市', '青岛市', '济南市']
    : LOCATIONS.cities;
  const cityMenu = new FakeElement('ul', {
    className: 'ant-cascader-menu',
    hidden: true,
    attributes: { 'data-cascader-level': '1' },
  }).append(...cities.map(value => option(value, 1, id)));
  const districtMenu = new FakeElement('ul', {
    className: 'ant-cascader-menu',
    hidden: true,
    attributes: { 'data-cascader-level': '2' },
  }).append(...LOCATIONS.districts.map(value => option(value, 2, id)));
  overlay.append(provinceMenu, cityMenu, districtMenu);
  return { id, label, root, trigger, formItem, overlay, provinceMenu, cityMenu, districtMenu };
}

function attach(fixtures, extraRoots = []) {
  const roots = [...fixtures.flatMap(fixture => [fixture.formItem, fixture.overlay]), ...extraRoots];
  return makeDocument(roots);
}

function descriptorFor(fixture, document) {
  const descriptors = Detector.scan(document, { section: 'basic' });
  return descriptors.find(descriptor => descriptor.element === fixture.root
    || descriptor.interactionElement === fixture.trigger
    || descriptor.element === fixture.trigger) || null;
}

function dispatcherFor(fixtures, expectedValues = {}) {
  const calls = [];
  const byId = new Map(fixtures.map(fixture => [fixture.id, fixture]));
  return {
    calls,
    clickLikeUser(element, details = {}) {
      calls.push({ element, purpose: details.purpose, level: details.level, ownerMenu: details.ownerMenu });
      const id = element.getAttribute?.('data-fixture-id')
        || element.closest?.('[data-fixture-id]')?.getAttribute?.('data-fixture-id');
      const fixture = byId.get(id);
      if (!fixture) return false;
      if (details.purpose === 'cascader-trigger') {
        fixture.overlay.hidden = false;
        fixture.provinceMenu.hidden = false;
        return true;
      }
      if (details.purpose !== 'cascader-option') return false;
      const level = Number(element.getAttribute?.('data-cascader-level'));
      if (level === 0) fixture.cityMenu.hidden = false;
      if (level === 1) fixture.districtMenu.hidden = false;
      if (level === 2) fixture.trigger.value = expectedValues[id] || '山东省青岛市市北区';
      return true;
    },
    readControlValue(descriptor) {
      return descriptor?.interactionElement?.value ?? descriptor?.element?.value ?? '';
    },
  };
}

function verifierFor() {
  return {
    verify(descriptor, expected) {
      const actualValue = descriptor?.interactionElement?.value ?? descriptor?.element?.value ?? '';
      return {
        ok: actualValue === expected,
        status: actualValue === expected ? 'SUCCESS' : 'NEEDS_CONFIRMATION',
        actualValue,
        reason: actualValue === expected ? '' : '层级选择回读不一致',
      };
    },
  };
}

async function executeCascader(fixture, document, expected, dispatcher) {
  const descriptor = descriptorFor(fixture, document);
  assert.ok(descriptor, 'FieldDetector 必须返回层级控件 descriptor');
  assert.equal(descriptor.controlKind, 'cascader');
  assert.equal(descriptor.element, fixture.root);
  assert.equal(descriptor.interactionElement, fixture.trigger);
  const resolution = Registry.resolve(descriptor, { fieldPath: 'basic.hometown' });
  assert.equal(resolution.adapterId, 'cascader');
  assert.ok(resolution.adapter, 'Cascader Adapter 必须通过真实 Registry 注册');
  return Registry.execute(descriptor, expected, {
    fieldPath: 'basic.hometown',
    cascaderTimeoutMs: 100,
    dependencies: {
      EventDispatcher: dispatcher,
      VerificationEngine: verifierFor(),
    },
  });
}

function wireRealClicks(fixture, expectedValue = '山东省青岛市市北区', hooks = {}) {
  fixture.trigger._clickHook = () => {
    fixture.overlay.hidden = false;
    fixture.provinceMenu.hidden = false;
    hooks.trigger?.();
  };
  for (const item of fixture.provinceMenu.children) {
    item._clickHook = () => {
      fixture.cityMenu.hidden = false;
      hooks.province?.(item);
    };
  }
  for (const item of fixture.cityMenu.children) {
    item._clickHook = () => {
      fixture.districtMenu.hidden = false;
      hooks.city?.(item);
    };
  }
  for (const item of fixture.districtMenu.children) {
    item._clickHook = () => {
      fixture.trigger.value = expectedValue;
      hooks.district?.(item);
    };
  }
}

test('Cascader detection requires structural capability plus geographic semantics', () => {
  const valid = makeCascader('valid');
  const genericPrompt = makeCascader('generic', { label: '选项', placeholder: '请选择' });
  const ordinary = new FakeElement('input', { type: 'text', placeholder: '请选择' });
  const ordinaryItem = new FakeElement('div', { className: 'ant-form-item' })
    .append(new FakeElement('label', { className: 'ant-form-item-label', textContent: '备注' }), ordinary);
  const document = attach([valid, genericPrompt], [ordinaryItem]);
  const descriptors = Detector.scan(document, { section: 'basic' });

  const validDescriptor = descriptorFor(valid, document);
  assert.equal(validDescriptor?.controlKind, 'cascader');
  assert.equal(validDescriptor?.labelText, '籍贯');
  assert.notEqual(descriptors.find(item => item.element === genericPrompt.trigger)?.controlKind, 'cascader');
  assert.notEqual(descriptors.find(item => item.element === ordinary)?.controlKind, 'cascader');
});

test('Cascader selects province → city → district through the registered adapter', async () => {
  const fixture = makeCascader('success');
  const document = attach([fixture]);
  const dispatcher = dispatcherFor([fixture], { success: '山东省青岛市市北区' });
  const result = await executeCascader(fixture, document, '山东省青岛市市北区', dispatcher);

  assert.equal(result.status, 'SUCCESS', result.reason);
  assert.equal(fixture.trigger.value, '山东省青岛市市北区');
  assert.deepEqual(dispatcher.calls.map(call => [call.purpose, call.level]), [
    ['cascader-trigger', undefined],
    ['cascader-option', 0],
    ['cascader-option', 1],
    ['cascader-option', 2],
  ]);
  const diagnostic = Detector.toDiagnostic(descriptorFor(fixture, document));
  assert.deepEqual(diagnostic.cascaderDebug, {
    levelCount: 3,
    selectedLevelCount: 3,
    panelOwnership: 'aria-controls',
    ambiguityReason: '',
    overlayIdentityStable: true,
    menuCountBefore: 3,
    menuCountAfter: 3,
    visibleMenuCountBefore: 2,
    visibleMenuCountAfter: 3,
    newMenuIndexes: [],
    newMenuCount: 0,
    optionSetChanged: true,
    rebindStrategy: 'same-overlay',
    rebindFailureReason: '',
  });
  assert.doesNotMatch(JSON.stringify(diagnostic.cascaderDebug), /山东|青岛|市北/);
});

test('Two Cascaders on one page never cross panel ownership', async () => {
  const birthplace = makeCascader('birthplace', { label: '出生地' });
  const hometown = makeCascader('hometown', { label: '籍贯所在地' });
  const document = attach([birthplace, hometown]);
  const dispatcher = dispatcherFor([birthplace, hometown], { birthplace: '山东省青岛市市北区' });
  const result = await executeCascader(birthplace, document, '山东省青岛市市北区', dispatcher);

  assert.equal(result.status, 'SUCCESS', result.reason);
  assert.ok(dispatcher.calls.every(call => !hometown.overlay.contains(call.element)));
  assert.equal(hometown.trigger.value, '');
  assert.equal(hometown.overlay.hidden, true);
});

test('Ambiguous city fails closed before any city/district option click', async () => {
  const fixture = makeCascader('ambiguous', { ambiguousCity: true });
  const document = attach([fixture]);
  const dispatcher = dispatcherFor([fixture]);
  const result = await executeCascader(fixture, document, '山东省青岛市市北区', dispatcher);

  assert.equal(result.status, 'NEEDS_CONFIRMATION');
  const optionLevels = dispatcher.calls
    .filter(call => call.purpose === 'cascader-option')
    .map(call => call.level);
  assert.deepEqual(optionLevels, [0], '省可唯一选择；歧义 city 与之后 district 必须 0 click');
  assert.equal(fixture.trigger.value, '');
  assert.deepEqual(Detector.toDiagnostic(descriptorFor(fixture, document)).cascaderDebug, {
    levelCount: 2,
    selectedLevelCount: 1,
    panelOwnership: 'aria-controls',
    ambiguityReason: 'AMBIGUOUS_LEVEL_1',
    overlayIdentityStable: true,
    menuCountBefore: 3,
    menuCountAfter: 3,
    visibleMenuCountBefore: 1,
    visibleMenuCountAfter: 2,
    newMenuIndexes: [],
    newMenuCount: 0,
    optionSetChanged: true,
    rebindStrategy: 'same-overlay',
    rebindFailureReason: '',
  });
});

test('Province+city JSON against a required three-level page needs confirmation and never guesses district', async () => {
  const fixture = makeCascader('missing_district', { requiredLevels: 3 });
  const document = attach([fixture]);
  const dispatcher = dispatcherFor([fixture]);
  const result = await executeCascader(fixture, document, '山东省青岛市', dispatcher);

  assert.equal(result.status, 'NEEDS_CONFIRMATION');
  assert.deepEqual(dispatcher.calls
    .filter(call => call.purpose === 'cascader-option')
    .map(call => call.level), [0, 1]);
  assert.equal(fixture.trigger.value, '');
});

test('Ordinary custom select is never routed to Cascader', () => {
  const wrapper = new FakeElement('div', { className: 'ant-select-selector', attributes: { role: 'combobox' } });
  wrapper.append(new FakeElement('input', { type: 'search', attributes: { role: 'combobox' } }));
  const item = new FakeElement('div', { className: 'ant-form-item' })
    .append(new FakeElement('label', { className: 'ant-form-item-label', textContent: '政治面貌' }), wrapper);
  const document = makeDocument([item]);
  const descriptor = Detector.scan(document, { section: 'basic' })[0];

  assert.equal(descriptor.controlKind, 'custom-select');
  assert.equal(Registry.resolve(descriptor, { fieldPath: 'basic.political' }).adapterId, 'custom-select');
});

test('DatePicker is never routed to Cascader', () => {
  const picker = new FakeElement('input', {
    type: 'date',
    className: 'ant-picker-input',
    placeholder: '请选择日期',
  });
  const item = new FakeElement('div', { className: 'ant-form-item' })
    .append(new FakeElement('label', { className: 'ant-form-item-label', textContent: '出生日期' }), picker);
  const document = makeDocument([item]);
  const descriptor = Detector.scan(document, { section: 'basic' })[0];

  assert.notEqual(descriptor.controlKind, 'cascader');
  assert.equal(Registry.resolve(descriptor, { fieldPath: 'basic.birthday', expectedType: 'date' }).adapterId, 'date-like');
});

test('Uncontrolled Cascader uses hidden→visible fresh overlay ownership, never a stale visible panel', async () => {
  const target = makeCascader('fresh', { controlled: false });
  const stale = makeCascader('stale', { initiallyVisible: true });
  stale.formItem.hidden = true;
  const document = attach([target, stale]);
  const dispatcher = dispatcherFor([target, stale], { fresh: '山东省青岛市市北区' });
  const result = await executeCascader(target, document, '山东省青岛市市北区', dispatcher);

  assert.equal(result.status, 'SUCCESS', result.reason);
  assert.ok(dispatcher.calls.every(call => !stale.overlay.contains(call.element)), '旧 visible overlay 不得被当前字段借用');
  assert.equal(stale.trigger.value, '');
});

test('Every hierarchy level is mediated by EventDispatcher purpose with its exact owner menu', async () => {
  const fixture = makeCascader('purposes');
  const document = attach([fixture]);
  const dispatcher = dispatcherFor([fixture], { purposes: '山东省青岛市市北区' });
  const result = await executeCascader(fixture, document, '山东省青岛市市北区', dispatcher);

  assert.equal(result.status, 'SUCCESS', result.reason);
  const options = dispatcher.calls.filter(call => call.purpose === 'cascader-option');
  assert.equal(options.length, 3);
  for (const [level, call] of options.entries()) {
    assert.equal(call.level, level);
    assert.ok(call.ownerMenu, `level ${level} 必须传入 ownerMenu`);
    assert.ok(call.ownerMenu.contains(call.element), `level ${level} option 必须属于 ownerMenu`);
  }
  assert.equal(EventDispatcher.canClickLikeUser(fixture.trigger, {
    purpose: 'cascader-trigger', ownerField: fixture.root, trigger: fixture.trigger,
  }), true);
  assert.equal(EventDispatcher.canClickLikeUser(fixture.trigger, {
    purpose: 'cascader-trigger', trigger: fixture.trigger,
  }), false, 'trigger 缺 ownerField 必须 fail closed');
  const district = fixture.districtMenu.children[0];
  assert.equal(EventDispatcher.canClickLikeUser(district, {
    purpose: 'cascader-option',
    ownerPanel: fixture.overlay,
    ownerMenu: fixture.districtMenu,
    level: 2,
    expectedOptionLabel: district.textContent,
  }), true);
  assert.equal(EventDispatcher.canClickLikeUser(district, {
    purpose: 'cascader-option',
    ownerPanel: fixture.overlay,
    ownerMenu: fixture.districtMenu,
    level: 1,
    expectedOptionLabel: district.textContent,
  }), false, '错误 level 必须 fail closed');
});

test('Cascader path parser preserves hierarchy slots and rejects an empty middle level', () => {
  assert.equal(CascaderAdapter.parsePath(['山东省', '', '市北区']), null);
  assert.equal(CascaderAdapter.parsePath('山东省//市北区'), null);
  assert.equal(CascaderAdapter.parsePath('山东省 /  / 市北区'), null);
  assert.deepEqual(CascaderAdapter.parsePath(['山东省', '青岛市', '市北区']), ['山东省', '青岛市', '市北区']);
});

test('real Registry → Cascader Adapter → EventDispatcher executes every click without a fake safety bypass', async () => {
  const fixture = makeCascader('real_dispatcher');
  const document = attach([fixture]);
  wireRealClicks(fixture);

  const result = await executeCascader(fixture, document, '山东省青岛市市北区', EventDispatcher);
  assert.equal(result.status, 'SUCCESS', result.reason);
  assert.equal(fixture.trigger.clickCount, 1);
  assert.equal(fixture.provinceMenu.children[0].clickCount, 1);
  assert.equal(fixture.cityMenu.children[0].clickCount, 1);
  assert.equal(fixture.districtMenu.children[0].clickCount, 1);
  assert.equal(result.selectedOption ?? null, null, 'Registry result 不得暴露完整地址路径');

  const duplicateSources = fixture.provinceMenu.children[1];
  assert.equal(EventDispatcher.canClickLikeUser(duplicateSources, {
    purpose: 'cascader-option', ownerPanel: fixture.overlay, ownerMenu: fixture.provinceMenu,
    level: 0, expectedOptionLabel: duplicateSources.textContent,
  }), true, '相同 textContent/innerText source 去重后仍是一个 exact label');
  const concatenated = option('山东省浙江省', 0, fixture.id);
  concatenated.attributes.delete('data-value');
  fixture.provinceMenu.append(concatenated);
  assert.equal(EventDispatcher.canClickLikeUser(concatenated, {
    purpose: 'cascader-option', ownerPanel: fixture.overlay, ownerMenu: fixture.provinceMenu,
    level: 0, expectedOptionLabel: '山东省',
  }), false, '不得用跨 source/拼接包含关系冒充 exact option label');
});

test('a stale lower menu visible before its parent selection is never reused', async () => {
  const fixture = makeCascader('stale_lower');
  fixture.cityMenu.hidden = false;
  fixture.districtMenu.hidden = false;
  const document = attach([fixture]);
  wireRealClicks(fixture, '山东省青岛市市北区', {
    province() { fixture.cityMenu.hidden = false; },
  });
  // The parent click deliberately leaves the exact same lower menu and options in place.
  for (const item of fixture.provinceMenu.children) item._clickHook = () => {};

  const result = await executeCascader(fixture, document, '山东省青岛市市北区', EventDispatcher);
  assert.equal(result.status, 'NEEDS_CONFIRMATION');
  assert.equal(fixture.cityMenu.children.reduce((sum, item) => sum + item.clickCount, 0), 0);
  assert.match(Detector.toDiagnostic(descriptorFor(fixture, document)).cascaderDebug.ambiguityReason, /STALE|MISSING/);
});

test('multiple aria-owned panels wait for the fresh target instead of borrowing an old visible panel', async () => {
  const target = makeCascader('multi_target');
  const stale = makeCascader('multi_stale', { initiallyVisible: true });
  stale.formItem.hidden = true;
  target.trigger.setAttribute('aria-controls', `${stale.overlay.id} ${target.overlay.id}`);
  const document = attach([target, stale]);
  wireRealClicks(target);
  wireRealClicks(stale, 'STALE_PANEL_SELECTED');
  target.trigger._clickHook = () => {
    setTimeout(() => {
      target.overlay.hidden = false;
      target.provinceMenu.hidden = false;
    }, 0);
  };

  const result = await executeCascader(target, document, '山东省青岛市市北区', EventDispatcher);
  assert.equal(result.status, 'SUCCESS', result.reason);
  assert.equal(stale.provinceMenu.children.reduce((sum, item) => sum + item.clickCount, 0), 0);
  assert.equal(target.trigger.value, '山东省青岛市市北区');
});

test('EventDispatcher verifies canonical visible menu order on every TOCTOU check', () => {
  const fixture = makeCascader('menu_order', { initiallyVisible: true });
  attach([fixture]);
  fixture.cityMenu.hidden = false;
  fixture.districtMenu.hidden = false;
  const city = fixture.cityMenu.children[0];
  city._dispatchHook = event => {
    if (event.type === 'pointerdown') fixture.overlay.children = [fixture.provinceMenu, fixture.districtMenu, fixture.cityMenu];
  };

  const clicked = EventDispatcher.clickLikeUser(city, {
    purpose: 'cascader-option', ownerPanel: fixture.overlay, ownerMenu: fixture.cityMenu,
    level: 1, expectedOptionLabel: city.textContent,
  });
  assert.equal(clicked, false);
  assert.equal(city.clickCount, 0, 'menu 在 pointerdown 后重排必须在真实 click 前被拒绝');
});

test('phase 3.5 RED safety: pointerdown cannot append a competing menu for the same logical level', () => {
  const fixture = makeCascader('menu_level_competitor', { initiallyVisible: true });
  attach([fixture]);
  fixture.cityMenu.hidden = false;
  const city = fixture.cityMenu.children[0];
  city._dispatchHook = event => {
    if (event.type !== 'pointerdown') return;
    const competitor = new FakeElement('ul', {
      className: 'ant-cascader-menu',
      attributes: { 'data-cascader-level': '1' },
    }).append(option('济南市', 1, fixture.id));
    fixture.overlay.append(competitor);
  };

  const clicked = EventDispatcher.clickLikeUser(city, {
    purpose: 'cascader-option', ownerPanel: fixture.overlay, ownerMenu: fixture.cityMenu,
    level: 1, expectedOptionLabel: city.textContent,
  });
  assert.equal(clicked, false);
  assert.equal(city.clickCount, 0);
});

test('disabled classes/ancestors and pointer/mouseup disable mutations fail closed', () => {
  const fixture = makeCascader('disabled_safety', { initiallyVisible: true });
  attach([fixture]);
  const province = fixture.provinceMenu.children[0];
  province.className += ' ant-cascader-menu-item-disabled';
  assert.equal(EventDispatcher.canClickLikeUser(province, {
    purpose: 'cascader-option', ownerPanel: fixture.overlay, ownerMenu: fixture.provinceMenu,
    level: 0, expectedOptionLabel: province.textContent,
  }), false);

  province.className = 'ant-cascader-menu-item';
  fixture.provinceMenu.className += ' is-disabled';
  assert.equal(EventDispatcher.canClickLikeUser(province, {
    purpose: 'cascader-option', ownerPanel: fixture.overlay, ownerMenu: fixture.provinceMenu,
    level: 0, expectedOptionLabel: province.textContent,
  }), false);
  fixture.provinceMenu.className = 'ant-cascader-menu';

  for (const eventType of ['pointerdown', 'mouseup']) {
    province._dispatchHook = event => {
      if (event.type === eventType) fixture.provinceMenu.setAttribute('aria-disabled', 'true');
    };
    assert.equal(EventDispatcher.clickLikeUser(province, {
      purpose: 'cascader-option', ownerPanel: fixture.overlay, ownerMenu: fixture.provinceMenu,
      level: 0, expectedOptionLabel: province.textContent,
    }), false, `${eventType} 后 ancestor disabled 必须拒绝`);
    assert.equal(province.clickCount, 0);
    fixture.provinceMenu.attributes.delete('aria-disabled');
  }
});

test('an asynchronously appearing required next level prevents premature SUCCESS', async () => {
  const fixture = makeCascader('async_required');
  fixture.root.attributes.delete('data-required-levels');
  const document = attach([fixture]);
  wireRealClicks(fixture, '山东省青岛市');
  for (const item of fixture.cityMenu.children) {
    item._clickHook = () => {
      fixture.trigger.value = '山东省青岛市';
      setTimeout(() => { fixture.districtMenu.hidden = false; }, 0);
    };
  }

  const result = await executeCascader(fixture, document, '山东省/青岛市', EventDispatcher);
  assert.equal(result.status, 'NEEDS_CONFIRMATION');
  assert.match(result.reason, /更多|层级/);
});

test('a controlled popup root replaced after a parent click is boundedly rebound', async () => {
  const fixture = makeCascader('replace_panel');
  const replacement = makeCascader('replacement_shell');
  replacement.overlay.id = fixture.overlay.id;
  replacement.overlay.hidden = false;
  replacement.provinceMenu.hidden = false;
  replacement.cityMenu.hidden = false;
  replacement.districtMenu.hidden = true;
  const document = attach([fixture], [replacement.overlay]);
  let currentPanel = fixture.overlay;
  document.getElementById = id => id === fixture.overlay.id ? currentPanel : null;
  wireRealClicks(fixture);
  fixture.trigger._clickHook = () => {
    fixture.overlay.hidden = false;
    fixture.provinceMenu.hidden = false;
  };
  for (const item of fixture.provinceMenu.children) {
    item._clickHook = () => {
      fixture.overlay.hidden = true;
      fixture.overlay.isConnected = false;
      currentPanel = replacement.overlay;
    };
  }
  for (const item of replacement.cityMenu.children) item._clickHook = () => { replacement.districtMenu.hidden = false; };
  for (const item of replacement.districtMenu.children) item._clickHook = () => { fixture.trigger.value = '山东省青岛市市北区'; };

  const result = await executeCascader(fixture, document, '山东省青岛市市北区', EventDispatcher);
  assert.equal(result.status, 'SUCCESS', result.reason);
  assert.equal(replacement.cityMenu.children[0].clickCount, 1);
  assert.equal(replacement.districtMenu.children[0].clickCount, 1);
});

test('phase 3.5 runtime debug: a two-level controlled replacement records replacement topology without labels', async () => {
  const fixture = makeCascader('replace_panel_debug', { requiredLevels: 2 });
  const replacement = makeCascader('replacement_debug_shell', { requiredLevels: 2 });
  replacement.overlay.id = fixture.overlay.id;
  replacement.overlay.hidden = false;
  replacement.provinceMenu.hidden = false;
  replacement.cityMenu.hidden = false;
  replacement.districtMenu.hidden = true;
  const document = attach([fixture], [replacement.overlay]);
  let currentPanel = fixture.overlay;
  document.getElementById = id => id === fixture.overlay.id ? currentPanel : null;
  fixture.trigger._clickHook = () => {
    fixture.overlay.hidden = false;
    fixture.provinceMenu.hidden = false;
  };
  for (const item of fixture.provinceMenu.children) {
    item._clickHook = () => {
      fixture.overlay.hidden = true;
      fixture.overlay.isConnected = false;
      currentPanel = replacement.overlay;
    };
  }
  for (const item of replacement.cityMenu.children) {
    item._clickHook = () => {
      fixture.trigger.value = '山东省青岛市';
      replacement.overlay.hidden = true;
    };
  }

  const result = await executeCascader(fixture, document, '山东省/青岛市', EventDispatcher);
  const debug = Detector.toDiagnostic(descriptorFor(fixture, document)).cascaderDebug;

  assert.equal(result.status, 'SUCCESS', result.reason);
  assert.deepEqual(debug, {
    levelCount: 2,
    selectedLevelCount: 2,
    panelOwnership: 'aria-controls',
    ambiguityReason: '',
    overlayIdentityStable: false,
    menuCountBefore: 3,
    menuCountAfter: 3,
    visibleMenuCountBefore: 1,
    visibleMenuCountAfter: 2,
    newMenuIndexes: [0, 1, 2],
    newMenuCount: 3,
    optionSetChanged: true,
    rebindStrategy: 'controlled-replacement',
    rebindFailureReason: '',
  });
  assert.doesNotMatch(JSON.stringify(debug), /山东|青岛|replacement_debug_shell/);
});

test('modern Ant selected items are read semantically per segment and concatenation boundaries never collide', async () => {
  const fixture = makeCascader('modern_readback');
  const document = attach([fixture]);
  fixture.root.append(
    new FakeElement('span', { className: 'ant-select-selection-item', textContent: '山东' }),
    new FakeElement('span', { className: 'ant-select-selection-item', textContent: '青岛' }),
    new FakeElement('span', { className: 'ant-select-selection-item', textContent: '市北' }),
  );
  const descriptor = descriptorFor(fixture, document);
  assert.equal(EventDispatcher.readControlValue(descriptor), '山东 / 青岛 / 市北');
  assert.equal(CascaderAdapter.verify({
    descriptor, value: ['山东省', '青岛市', '市北区'], settings: {}, dependencies: {},
  }).ok, true, '行政区后缀差异应逐 segment canonical 等价');

  fixture.root.children = [fixture.trigger];
  fixture.root.append(
    new FakeElement('span', { className: 'ant-select-selection-item', textContent: '山东' }),
    new FakeElement('span', { className: 'ant-select-selection-item', textContent: '省青岛市' }),
  );
  assert.equal(CascaderAdapter.verify({
    descriptor, value: ['山东省', '青岛市'], settings: {}, dependencies: {},
  }).ok, false, 'join 后相同但 segment 边界不同必须拒绝');
});

test('semantic Cascader readback makes a rerun SKIPPED_EXISTING with zero trigger clicks', async () => {
  const fixture = makeCascader('rerun_existing');
  const document = attach([fixture]);
  fixture.root.append(
    new FakeElement('span', { className: 'ant-select-selection-item', textContent: '山东省' }),
    new FakeElement('span', { className: 'ant-select-selection-item', textContent: '青岛市' }),
    new FakeElement('span', { className: 'ant-select-selection-item', textContent: '市北区' }),
  );
  const result = await FormFiller.fill(descriptorFor(fixture, document), '山东省 / 青岛市 / 市北区', {
    fieldPath: 'basic.hometown', allowOverwrite: false,
  });
  assert.equal(result.status, 'SKIPPED_EXISTING', result.reason);
  assert.equal(fixture.trigger.clickCount, 0);
});

test('Cascader debug counts discovered DOM only and never infers levels from expected private data', async () => {
  const fixture = makeCascader('debug_discovered');
  const document = attach([fixture]);
  const runtime = { clickLikeUser() { return true; }, readControlValue() { return ''; } };
  const result = await executeCascader(fixture, document, '山东省青岛市市北区', runtime);
  assert.equal(result.status, 'NEEDS_CONFIRMATION');
  assert.deepEqual(Detector.toDiagnostic(descriptorFor(fixture, document)).cascaderDebug, {
    levelCount: 0,
    selectedLevelCount: 0,
    panelOwnership: '',
    ambiguityReason: 'CONTROLLED_PANEL_UNAVAILABLE',
    overlayIdentityStable: false,
    menuCountBefore: 0,
    menuCountAfter: 0,
    visibleMenuCountBefore: 0,
    visibleMenuCountAfter: 0,
    newMenuIndexes: [],
    newMenuCount: 0,
    optionSetChanged: false,
    rebindStrategy: '',
    rebindFailureReason: '',
  });
});

test('hidden owner ancestors and owner TOCTOU mutations reject the option before click', () => {
  const fixture = makeCascader('hidden_owner', { initiallyVisible: true });
  const hiddenAncestor = new FakeElement('div', { hidden: true }).append(fixture.overlay);
  attach([fixture], [hiddenAncestor]);
  const province = fixture.provinceMenu.children[0];
  assert.equal(EventDispatcher.canClickLikeUser(province, {
    purpose: 'cascader-option', ownerPanel: fixture.overlay, ownerMenu: fixture.provinceMenu,
    level: 0, expectedOptionLabel: province.textContent,
  }), false);

  hiddenAncestor.hidden = false;
  province._dispatchHook = event => { if (event.type === 'pointerdown') hiddenAncestor.hidden = true; };
  assert.equal(EventDispatcher.clickLikeUser(province, {
    purpose: 'cascader-option', ownerPanel: fixture.overlay, ownerMenu: fixture.provinceMenu,
    level: 0, expectedOptionLabel: province.textContent,
  }), false);
  assert.equal(province.clickCount, 0);
});

test('nested tree options match only their own label, never descendant option text', async () => {
  const fixture = makeCascader('nested_label');
  fixture.cityMenu.children = [];
  const city = new FakeElement('li', {
    className: 'ant-cascader-menu-item', textContent: '青岛市市北区市南区',
    attributes: { role: 'treeitem', 'data-cascader-level': '1', 'data-fixture-id': fixture.id },
  });
  city.append(
    new FakeElement('span', { className: 'ant-cascader-menu-item-content', textContent: '青岛市' }),
    new FakeElement('ul').append(
      new FakeElement('li', { textContent: '市北区', attributes: { role: 'treeitem' } }),
      new FakeElement('li', { textContent: '市南区', attributes: { role: 'treeitem' } }),
    ),
  );
  fixture.cityMenu.append(city);
  const document = attach([fixture]);
  wireRealClicks(fixture);
  city._clickHook = () => { fixture.districtMenu.hidden = false; };

  const result = await executeCascader(fixture, document, '山东省青岛市市北区', EventDispatcher);
  assert.equal(result.status, 'SUCCESS', result.reason);
  assert.equal(city.clickCount, 1);
});

test('semantic button Cascader root gets only the precise Registry safety exception', async () => {
  const root = new FakeElement('button', {
    className: 'ant-cascader', type: 'button', placeholder: '请选择省市区',
    attributes: { role: 'combobox', 'aria-haspopup': 'menu' },
  });
  const formItem = new FakeElement('div', { className: 'ant-form-item' }).append(
    new FakeElement('label', { className: 'ant-form-item-label', textContent: '籍贯' }), root,
  );
  const document = makeDocument([formItem]);
  const descriptor = Detector.scan(document, { section: 'basic' })[0];
  assert.equal(descriptor.controlKind, 'cascader');
  const result = await Registry.execute(descriptor, ['山东省', '青岛市'], {
    fieldPath: 'basic.hometown', cascaderTimeoutMs: 10,
    dependencies: { EventDispatcher: { clickLikeUser() { return false; } } },
  });
  assert.notEqual(result.strategy, 'safety-preflight');
  assert.equal(result.status, 'NEEDS_CONFIRMATION');
});

test('Registry forwards only Adapter-created metadata-only optionMatchingDebug on unresolved and final results', async () => {
  const privateSentinel = 'PRIVATE_EXPECTED_OR_DOM_98731';
  const optionMatchingDebug = {
    fieldPath: 'papers[].status',
    optionCount: 2,
    normalizedOptionLabels: ['已发表', '审稿中'],
    expectedShape: 'text',
    canonicalCandidates: ['published'],
    expectedCanonical: 'published',
    bestScore: 0.98,
    secondBestScore: 0,
    threshold: 0.9,
    margin: 0.06,
    bestOptionLabel: '已发表',
    matchedCanonical: 'published',
    reasonCode: 'OPTION_MATCHED',
    rawExpected: privateSentinel,
    element: new FakeElement('div', { textContent: privateSentinel }),
  };
  Registry.register({
    id: 'registry-debug-contract-probe', priority: 9999, capabilities: ['verify'],
    supports(context) { return context.descriptor?.controlKind === 'registry-debug-contract-probe'; },
    read() { return ''; },
    write(context) {
      return context.settings.unresolved
        ? { handled: false, status: 'NEEDS_CONFIRMATION', reason: 'probe', optionMatchingDebug }
        : { handled: true, ok: true, status: 'SUCCESS', optionMatchingDebug };
    },
    verify() { return { ok: true, status: 'SUCCESS', actualValue: '' }; },
  });
  const descriptor = {
    element: new FakeElement('div'), controlKind: 'registry-debug-contract-probe', type: 'registry-debug-contract-probe',
  };
  const expectedSafe = {
    fieldPath: 'papers[].status', optionCount: 2, normalizedOptionLabels: ['已发表', '审稿中'],
    expectedShape: 'text', canonicalCandidates: ['published'], expectedCanonical: 'published',
    bestScore: 0.98, secondBestScore: 0, threshold: 0.9, margin: 0.06,
    bestOptionLabel: '已发表', matchedCanonical: 'published', reasonCode: 'OPTION_MATCHED',
  };
  for (const unresolved of [true, false]) {
    const result = await Registry.execute(descriptor, privateSentinel, { unresolved });
    assert.deepEqual(result.optionMatchingDebug, expectedSafe);
    assert.doesNotMatch(JSON.stringify(result), new RegExp(privateSentinel));
  }
});

test('a freshly visible empty/loading lower menu cannot yield SUCCESS before its async options arrive', async () => {
  const fixture = makeCascader('async_loading_lower');
  fixture.root.attributes.delete('data-required-levels');
  fixture.districtMenu.children = [];
  const document = attach([fixture]);
  wireRealClicks(fixture, '山东省青岛市');
  for (const item of fixture.cityMenu.children) {
    item._clickHook = () => {
      fixture.trigger.value = '山东省青岛市';
      fixture.districtMenu.hidden = false;
      setTimeout(() => fixture.districtMenu.append(option('市北区', 2, fixture.id)), 5);
    };
  }

  const result = await executeCascader(fixture, document, '山东省/青岛市', EventDispatcher);
  assert.equal(result.status, 'NEEDS_CONFIRMATION');
  assert.match(result.reason, /更多|层级|加载/);
  assert.equal(fixture.districtMenu.children[0].clickCount, 0);
});

test('an unchanged pre-existing nonempty lower menu still proves another required level', async () => {
  const fixture = makeCascader('preexisting_required_lower');
  fixture.root.attributes.delete('data-required-levels');
  fixture.districtMenu.hidden = false;
  const document = attach([fixture]);
  wireRealClicks(fixture, '山东省青岛市');
  for (const item of fixture.cityMenu.children) {
    item._clickHook = () => { fixture.trigger.value = '山东省青岛市'; };
  }

  const result = await executeCascader(fixture, document, '山东省/青岛市', EventDispatcher);
  assert.equal(result.status, 'NEEDS_CONFIRMATION');
  assert.match(result.reason, /更多|层级/);
  assert.equal(fixture.districtMenu.children.reduce((sum, item) => sum + item.clickCount, 0), 0);
});

test('phase 3.5 RED: same-overlay appended columns wait for async options before selecting the next level', async () => {
  const fixture = makeCascader('same_overlay_async_append');
  fixture.overlay.children = [fixture.provinceMenu];
  fixture.provinceMenu.parentElement = fixture.overlay;
  const document = attach([fixture]);
  fixture.trigger._clickHook = () => {
    fixture.overlay.hidden = false;
    fixture.provinceMenu.hidden = false;
  };

  const cityMenu = new FakeElement('ul', {
    className: 'ant-cascader-menu',
    attributes: { 'data-cascader-level': '1' },
  });
  const city = option('青岛市', 1, fixture.id);
  const districtMenu = new FakeElement('ul', {
    className: 'ant-cascader-menu',
    attributes: { 'data-cascader-level': '2' },
  });
  const district = option('市北区', 2, fixture.id);
  for (const province of fixture.provinceMenu.children) {
    province._clickHook = () => {
      fixture.overlay.append(cityMenu);
      setTimeout(() => cityMenu.append(city), 5);
    };
  }
  city._clickHook = () => {
    fixture.overlay.append(districtMenu);
    setTimeout(() => districtMenu.append(district), 5);
  };
  district._clickHook = () => {
    fixture.trigger.value = '山东省青岛市市北区';
    fixture.overlay.hidden = true;
  };

  const result = await executeCascader(
    fixture, document, '山东省青岛市市北区', EventDispatcher,
  );
  assert.equal(result.status, 'SUCCESS', result.reason);
  assert.equal(city.clickCount, 1);
  assert.equal(district.clickCount, 1);
  assert.equal(fixture.trigger.value, '山东省青岛市市北区');
  assert.deepEqual(Detector.toDiagnostic(descriptorFor(fixture, document)).cascaderDebug, {
    levelCount: 3,
    selectedLevelCount: 3,
    panelOwnership: 'aria-controls',
    ambiguityReason: '',
    overlayIdentityStable: true,
    menuCountBefore: 2,
    menuCountAfter: 3,
    visibleMenuCountBefore: 2,
    visibleMenuCountAfter: 3,
    newMenuIndexes: [2],
    newMenuCount: 1,
    optionSetChanged: true,
    rebindStrategy: 'same-overlay',
    rebindFailureReason: '',
  });
});

test('phase 3.5 runtime closure: an uncontrolled overlay may transiently hide and reappear as the same owned node', async () => {
  const fixture = makeCascader('same_overlay_reappears', { controlled: false, requiredLevels: 2 });
  fixture.root.setAttribute('data-required-levels', '2');
  fixture.overlay.children = [fixture.provinceMenu];
  fixture.provinceMenu.parentElement = fixture.overlay;
  const document = attach([fixture]);
  fixture.trigger._clickHook = () => {
    fixture.overlay.hidden = false;
    fixture.provinceMenu.hidden = false;
  };
  const cityMenu = new FakeElement('ul', {
    className: 'ant-cascader-menu',
    attributes: { 'data-cascader-level': '1' },
  });
  const city = option('青岛市', 1, fixture.id);
  cityMenu.append(city);
  for (const province of fixture.provinceMenu.children) {
    province._clickHook = () => {
      fixture.overlay.hidden = true;
      setTimeout(() => {
        fixture.overlay.append(cityMenu);
        fixture.overlay.hidden = false;
      }, 5);
    };
  }
  city._clickHook = () => {
    fixture.trigger.value = '山东省青岛市';
    fixture.overlay.hidden = true;
  };

  const result = await executeCascader(fixture, document, '山东省/青岛市', EventDispatcher);
  const debug = Detector.toDiagnostic(descriptorFor(fixture, document)).cascaderDebug;

  assert.equal(result.status, 'SUCCESS', result.reason);
  assert.equal(debug.overlayIdentityStable, true);
  assert.equal(debug.rebindStrategy, 'same-overlay');
  assert.equal(debug.rebindFailureReason, '');
  assert.deepEqual(debug.newMenuIndexes, [1]);
});

test('phase 3.5 RED safety: two competing appended next-level columns fail closed before either option click', async () => {
  const fixture = makeCascader('same_overlay_competing_append');
  fixture.overlay.children = [fixture.provinceMenu];
  fixture.provinceMenu.parentElement = fixture.overlay;
  const document = attach([fixture]);
  fixture.trigger._clickHook = () => {
    fixture.overlay.hidden = false;
    fixture.provinceMenu.hidden = false;
  };
  const competingMenus = ['青岛市', '济南市'].map(cityName => {
    const menu = new FakeElement('ul', {
      className: 'ant-cascader-menu',
      attributes: { 'data-cascader-level': '1' },
    });
    menu.append(option(cityName, 1, fixture.id));
    return menu;
  });
  for (const province of fixture.provinceMenu.children) {
    province._clickHook = () => fixture.overlay.append(...competingMenus);
  }

  const result = await executeCascader(
    fixture, document, '山东省青岛市市北区', EventDispatcher,
  );
  assert.equal(result.status, 'NEEDS_CONFIRMATION');
  assert.equal(
    competingMenus.flatMap(menu => menu.children).reduce((sum, item) => sum + item.clickCount, 0),
    0,
  );
  assert.match(
    Detector.toDiagnostic(descriptorFor(fixture, document)).cascaderDebug.ambiguityReason,
    /STALE|MISSING|AMBIGUOUS/,
  );
  const debug = Detector.toDiagnostic(descriptorFor(fixture, document)).cascaderDebug;
  assert.equal(debug.menuCountBefore, 1);
  assert.equal(debug.menuCountAfter, 3);
  assert.equal(debug.rebindStrategy, 'same-overlay');
  assert.equal(debug.rebindFailureReason, 'STALE_OR_MISSING_NEXT_MENU');
  assert.deepEqual(debug.newMenuIndexes, [1, 2]);
});

test('option-to-ownerMenu intermediate wrappers hidden on pointerdown/mouseup block the real click', () => {
  for (const eventType of ['pointerdown', 'mouseup']) {
    const fixture = makeCascader(`hidden_intermediate_${eventType}`, { initiallyVisible: true });
    fixture.provinceMenu.children = [];
    const wrapper = new FakeElement('div', { className: 'cascader-option-wrapper' });
    const province = option('山东省', 0, fixture.id);
    wrapper.append(province);
    fixture.provinceMenu.append(wrapper);
    attach([fixture]);
    province._dispatchHook = event => { if (event.type === eventType) wrapper.hidden = true; };

    assert.equal(EventDispatcher.clickLikeUser(province, {
      purpose: 'cascader-option', ownerPanel: fixture.overlay, ownerMenu: fixture.provinceMenu,
      level: 0, expectedOptionLabel: province.textContent,
    }), false, `${eventType} 后中间 wrapper 隐藏必须 fail closed`);
    assert.equal(province.clickCount, 0);
  }
});

test('phase 3.5 completion: same-overlay empty level-2/3 shells refresh in place before each EventDispatcher click', async () => {
  const fixture = makeCascader('completion_refresh_in_place');
  fixture.cityMenu.children = [];
  fixture.districtMenu.children = [];
  const document = attach([fixture]);
  const city = option('青岛市', 1, fixture.id);
  const district = option('市北区', 2, fixture.id);
  fixture.trigger._clickHook = () => {
    fixture.overlay.hidden = false;
    fixture.provinceMenu.hidden = false;
  };
  for (const province of fixture.provinceMenu.children) {
    province._clickHook = () => {
      fixture.cityMenu.hidden = false;
      setTimeout(() => fixture.cityMenu.append(city), 5);
    };
  }
  city._clickHook = () => {
    fixture.districtMenu.hidden = false;
    setTimeout(() => fixture.districtMenu.append(district), 5);
  };
  district._clickHook = () => {
    fixture.trigger.value = '山东省青岛市市北区';
    fixture.overlay.hidden = true;
  };
  const calls = [];
  const dispatcher = {
    ...EventDispatcher,
    clickLikeUser(element, details) {
      calls.push({ element, ...details });
      return EventDispatcher.clickLikeUser(element, details);
    },
  };

  const result = await executeCascader(
    fixture, document, '山东省青岛市市北区', dispatcher,
  );

  assert.equal(result.status, 'SUCCESS', result.reason);
  const optionCalls = calls.filter(call => call.purpose === 'cascader-option');
  assert.deepEqual(optionCalls.map(call => call.level), [0, 1, 2]);
  assert.deepEqual(optionCalls.map(call => call.ownerMenu), [
    fixture.provinceMenu, fixture.cityMenu, fixture.districtMenu,
  ]);
  assert.equal(city.clickCount, 1);
  assert.equal(district.clickCount, 1);
});

test('phase 3.5 completion: stale visible level-2/3 columns may be replaced and rebound, never reused', async () => {
  const fixture = makeCascader('completion_column_replacement');
  fixture.cityMenu.hidden = false;
  fixture.districtMenu.hidden = false;
  const staleCityOptions = [...fixture.cityMenu.children];
  const staleDistrictOptions = [...fixture.districtMenu.children];
  const document = attach([fixture]);
  const replacementCity = new FakeElement('ul', {
    className: 'ant-cascader-menu',
    attributes: { 'data-cascader-level': '1' },
  });
  const city = option('青岛市', 1, fixture.id);
  replacementCity.append(city);
  const replacementDistrict = new FakeElement('ul', {
    className: 'ant-cascader-menu',
    attributes: { 'data-cascader-level': '2' },
  });
  const district = option('市北区', 2, fixture.id);
  replacementDistrict.append(district);
  const replaceColumn = (oldMenu, nextMenu) => {
    const index = fixture.overlay.children.indexOf(oldMenu);
    assert.ok(index >= 0);
    oldMenu.parentElement = null;
    oldMenu.isConnected = false;
    nextMenu.parentElement = fixture.overlay;
    nextMenu.ownerDocument = fixture.overlay.ownerDocument;
    fixture.overlay.children.splice(index, 1, nextMenu);
  };
  fixture.trigger._clickHook = () => {
    fixture.overlay.hidden = false;
    fixture.provinceMenu.hidden = false;
  };
  for (const province of fixture.provinceMenu.children) {
    province._clickHook = () => replaceColumn(fixture.cityMenu, replacementCity);
  }
  city._clickHook = () => replaceColumn(fixture.districtMenu, replacementDistrict);
  district._clickHook = () => {
    fixture.trigger.value = '山东省青岛市市北区';
    fixture.overlay.hidden = true;
  };
  const calls = [];
  const dispatcher = {
    ...EventDispatcher,
    clickLikeUser(element, details) {
      calls.push({ element, ...details });
      return EventDispatcher.clickLikeUser(element, details);
    },
  };

  const result = await executeCascader(
    fixture, document, '山东省青岛市市北区', dispatcher,
  );

  assert.equal(result.status, 'SUCCESS', result.reason);
  assert.equal(staleCityOptions.reduce((sum, item) => sum + item.clickCount, 0), 0);
  assert.equal(staleDistrictOptions.reduce((sum, item) => sum + item.clickCount, 0), 0);
  assert.equal(city.clickCount, 1);
  assert.equal(district.clickCount, 1);
  const optionCalls = calls.filter(call => call.purpose === 'cascader-option');
  assert.deepEqual(optionCalls.map(call => call.ownerMenu), [
    fixture.provinceMenu, replacementCity, replacementDistrict,
  ]);
});

test('phase 3.5 completion safety: competing appended level-3 columns fail closed with zero district click', async () => {
  const fixture = makeCascader('completion_level_three_ambiguity');
  fixture.overlay.children = [fixture.provinceMenu, fixture.cityMenu];
  fixture.provinceMenu.parentElement = fixture.overlay;
  fixture.cityMenu.parentElement = fixture.overlay;
  const document = attach([fixture]);
  fixture.trigger._clickHook = () => {
    fixture.overlay.hidden = false;
    fixture.provinceMenu.hidden = false;
  };
  for (const province of fixture.provinceMenu.children) {
    province._clickHook = () => { fixture.cityMenu.hidden = false; };
  }
  const competingDistrictMenus = ['市北区', '市南区'].map(label => new FakeElement('ul', {
    className: 'ant-cascader-menu',
    attributes: { 'data-cascader-level': '2' },
  }).append(option(label, 2, fixture.id)));
  for (const city of fixture.cityMenu.children) {
    city._clickHook = () => fixture.overlay.append(...competingDistrictMenus);
  }

  const result = await executeCascader(
    fixture, document, '山东省青岛市市北区', EventDispatcher,
  );

  assert.equal(result.status, 'NEEDS_CONFIRMATION');
  assert.equal(
    competingDistrictMenus.flatMap(menu => menu.children)
      .reduce((sum, item) => sum + item.clickCount, 0),
    0,
  );
  assert.match(
    Detector.toDiagnostic(descriptorFor(fixture, document)).cascaderDebug.ambiguityReason,
    /STALE|MISSING|AMBIGUOUS/,
  );
});
