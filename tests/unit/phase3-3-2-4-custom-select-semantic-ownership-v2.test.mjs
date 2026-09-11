import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Detector = require('../../src/core/field-detector.js');
const CustomSelectAdapter = require('../../src/controls/adapters/custom-select-adapter.js');

class FakeElement {
  constructor(tagName, options = {}) {
    this.tagName = String(tagName || 'DIV').toUpperCase();
    this.className = options.className || '';
    this.textContent = options.textContent || '';
    this.innerText = this.textContent;
    this.type = options.type || '';
    this.id = options.id || '';
    this.name = options.name || '';
    this.placeholder = options.placeholder || '';
    this.value = options.value || '';
    this.hidden = Boolean(options.hidden);
    this.disabled = false;
    this.readOnly = false;
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

  getAttribute(name) {
    if (name === 'class') return this.className || null;
    if (name === 'id') return this.id || null;
    if (name === 'name') return this.name || null;
    if (name === 'type') return this.type || null;
    return this.attributes.get(name) ?? null;
  }

  contains(candidate) {
    for (let current = candidate; current; current = current.parentElement) {
      if (current === this) return true;
    }
    return false;
  }

  matches(selector) {
    const source = String(selector || '');
    const classes = this.className.split(/\s+/).filter(Boolean);
    if (source.includes('input[type="hidden"]')) return this.tagName === 'INPUT' && this.type === 'hidden';
    if (source === 'label') return this.tagName === 'LABEL';
    if (source === 'td,th') return ['TD', 'TH'].includes(this.tagName);
    if (source === 'tr') return this.tagName === 'TR';
    if (source.includes('[role="combobox"]') && this.getAttribute('role') === 'combobox') return true;
    if (source.includes('[role="textbox"]') && this.getAttribute('role') === 'textbox') return true;
    if (source.includes('.ant-select-selector') && classes.includes('ant-select-selector')) return true;
    if (source.includes('.el-select__wrapper') && classes.includes('el-select__wrapper')) return true;
    if (source.includes('.el-select') && classes.includes('el-select')) return true;
    if (source.includes('.ant-form-item') && classes.includes('ant-form-item')) return true;
    if (source.includes('.ant-form-item-label') && classes.includes('ant-form-item-label')) return true;
    if (source.includes('.jqx-widget') && classes.includes('jqx-widget')) return true;
    if (source.includes('input') && this.tagName === 'INPUT') return true;
    if (source.includes('textarea') && this.tagName === 'TEXTAREA') return true;
    if (source.includes('select') && this.tagName === 'SELECT') return true;
    if (source.includes('label') && this.tagName === 'LABEL') return true;
    return false;
  }

  closest(selector) {
    for (let current = this; current; current = current.parentElement) {
      if (current.matches?.(selector)) return current;
    }
    return null;
  }

  descendants() {
    return this.children.flatMap(child => [child, ...child.descendants()]);
  }

  querySelectorAll(selector) {
    const descendants = this.descendants();
    if (selector === Detector.STANDARD_SELECTOR) {
      return descendants.filter(node => node.tagName === 'INPUT'
        || node.tagName === 'TEXTAREA'
        || node.tagName === 'SELECT'
        || node.getAttribute?.('role') === 'combobox');
    }
    if (selector === Detector.CUSTOM_SELECT_SELECTOR) {
      return descendants.filter(node => node.matches(Detector.CUSTOM_SELECT_SELECTOR));
    }
    if (/role="option"|data-select-option|select-item-option|jqx-listitem/.test(selector)) {
      return descendants.filter(node => node.getAttribute?.('role') === 'option');
    }
    if (/form-item-label|field-label|label-column|data-field-label|data-caption|(?:^|,)label(?:,|$)/.test(selector)) {
      return descendants.filter(node => node.tagName === 'LABEL'
        || node.className.split(/\s+/).includes('ant-form-item-label'));
    }
    if (/selection-item|selected-value|aria-selected/.test(selector)) {
      return descendants.filter(node => /(?:^|\s)ant-select-selection-item(?:\s|$)/.test(node.className));
    }
    return [];
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

  getBoundingClientRect() {
    return { width: 240, height: 32, top: 0, left: 0 };
  }
}

function makeDocument(roots = []) {
  const ids = new Map();
  const view = {
    getComputedStyle(element) {
      return element?.hidden
        ? { display: 'none', visibility: 'hidden', opacity: '0', position: 'static' }
        : { display: 'block', visibility: 'visible', opacity: '1', position: 'static' };
    },
    requestAnimationFrame(callback) { callback(); },
    CSS: { escape(value) { return String(value); } },
  };
  const document = {
    nodeType: 9,
    defaultView: view,
    body: null,
    documentElement: null,
    getElementById(id) { return ids.get(id) || null; },
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
    querySelectorAll(selector) {
      const nodes = roots.flatMap(root => [root, ...root.descendants()]);
      if (selector === Detector.STANDARD_SELECTOR) {
        return nodes.filter(node => node.tagName === 'INPUT'
          || node.tagName === 'TEXTAREA'
          || node.tagName === 'SELECT'
          || node.getAttribute?.('role') === 'combobox');
      }
      if (selector === Detector.CUSTOM_SELECT_SELECTOR) {
        return nodes.filter(node => node.matches(Detector.CUSTOM_SELECT_SELECTOR));
      }
      if (selector === 'input[type="file"]' || selector === Detector.CUSTOM_UPLOAD_SELECTOR) return [];
      if (/role="listbox"|select-dropdown|jqx-listbox/.test(selector)) {
        return nodes.filter(node => node.getAttribute?.('role') === 'listbox');
      }
      if (/role="option"|data-select-option|select-item-option|jqx-listitem/.test(selector)) {
        return nodes.filter(node => node.getAttribute?.('role') === 'option');
      }
      return [];
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

function labelNode(labelText) {
  return new FakeElement('label', {
    className: 'ant-form-item-label',
    textContent: labelText,
  });
}

function antLogicalSelect(labelText, options = {}) {
  const label = labelNode(labelText);
  const wrapper = new FakeElement('div', {
    className: 'ant-select-selector',
    attributes: { role: 'combobox', ...(options.wrapperAttributes || {}) },
  });
  const hiddenMirror = new FakeElement('input', { type: 'hidden', value: options.value || '' });
  const searchInput = new FakeElement('input', {
    type: 'search',
    attributes: { role: 'combobox', ...(options.searchAttributes || {}) },
  });
  const accessibilityInput = new FakeElement('input', {
    type: 'text',
    attributes: { 'aria-hidden': 'true', tabindex: '-1' },
  });
  wrapper.append(hiddenMirror, searchInput, accessibilityInput);
  const formItem = new FakeElement('div', { className: 'ant-form-item' });
  formItem.append(label, wrapper);
  const document = makeDocument([formItem]);
  return { document, formItem, label, wrapper, hiddenMirror, searchInput, accessibilityInput };
}

test('V2 Ant: wrapper + search + a11y + hidden mirrors are one logical field and recover label', () => {
  const fixture = antLogicalSelect('性别');
  const descriptor = Detector.buildDescriptor(fixture.wrapper, 0, { section: 'basic' });
  const scanned = Detector.scan(fixture.document, { section: 'basic' });

  assert.equal(descriptor.labelText, '性别');
  assert.equal(descriptor.labelSource, 'form-item-label');
  assert.equal(scanned.length, 1, '一个逻辑 Select 只能产生一个 executable descriptor');
  assert.equal(scanned[0].element, fixture.wrapper);
});

test('V2 Element: nested custom roots with several internal mirrors canonicalize to one outer descriptor', () => {
  const label = labelNode('民族');
  const outer = new FakeElement('div', { className: 'el-select' });
  const inner = new FakeElement('div', { className: 'el-select__wrapper', attributes: { role: 'combobox' } });
  inner.append(
    new FakeElement('input', { type: 'search', attributes: { role: 'combobox' } }),
    new FakeElement('input', { type: 'text', attributes: { 'aria-hidden': 'true' } }),
  );
  outer.append(inner);
  const formItem = new FakeElement('div', { className: 'ant-form-item' }).append(label, outer);
  const document = makeDocument([formItem]);

  const descriptors = Detector.scan(document, { section: 'basic' });
  assert.equal(descriptors.length, 1);
  assert.equal(descriptors[0].element, outer);
  assert.equal(descriptors[0].labelText, '民族');
});

test('V2 isolation: multiple Ant logical selects retain their own local labels', () => {
  const fixtures = ['证件类型', '性别', '政治面貌', '民族', '婚姻状况']
    .map(label => antLogicalSelect(label));
  const document = makeDocument(fixtures.map(fixture => fixture.formItem));

  const descriptors = Detector.scan(document, { section: 'basic' });
  assert.equal(descriptors.length, fixtures.length);
  assert.deepEqual(descriptors.map(descriptor => descriptor.labelText),
    ['证件类型', '性别', '政治面貌', '民族', '婚姻状况']);
});

test('V2 fail-close: two independent custom selects in one form-item do not share one label', () => {
  const first = new FakeElement('div', { className: 'ant-select-selector', attributes: { role: 'combobox' } })
    .append(new FakeElement('input', { type: 'search', attributes: { role: 'combobox' } }));
  const second = new FakeElement('div', { className: 'ant-select-selector', attributes: { role: 'combobox' } })
    .append(new FakeElement('input', { type: 'search', attributes: { role: 'combobox' } }));
  const formItem = new FakeElement('div', { className: 'ant-form-item' })
    .append(labelNode('不可共享'), first, second);
  makeDocument([formItem]);

  assert.equal(Detector.buildDescriptor(first, 0, { section: 'basic' }).labelText, '');
  assert.equal(Detector.buildDescriptor(second, 1, { section: 'basic' }).labelText, '');
});

test('V2 fail-close: a custom select plus an independent ordinary input do not share one label', () => {
  const fixture = antLogicalSelect('不可共享');
  const ordinary = new FakeElement('input', { type: 'text' });
  fixture.formItem.append(ordinary);
  fixture.document = makeDocument([fixture.formItem]);

  assert.equal(Detector.buildDescriptor(fixture.wrapper, 0, { section: 'basic' }).labelText, '');
});

test('V2 semantic purity: selected-value aria reference is never promoted to the field label', () => {
  const fixture = antLogicalSelect('', {
    searchAttributes: { 'aria-labelledby': 'selected_value' },
  });
  const selected = new FakeElement('span', {
    className: 'ant-select-selection-item',
    textContent: '中国共产党党员',
  });
  selected.id = 'selected_value';
  fixture.wrapper.append(selected);
  fixture.document = makeDocument([fixture.formItem]);

  const descriptor = Detector.buildDescriptor(fixture.wrapper, 0, { section: 'basic' });
  assert.equal(descriptor.labelText, '');
  assert.equal(descriptor.labelSource, '');
  assert.equal(descriptor.currentValue, '中国共产党党员');
});

test('V2 execution: one logical Select produces exactly one adapter write and one option click', async () => {
  const fixture = antLogicalSelect('性别', {
    wrapperAttributes: { 'aria-controls': 'gender_options' },
  });
  const overlay = new FakeElement('div', { id: 'gender_options', attributes: { role: 'listbox' } });
  overlay.append(
    new FakeElement('div', { textContent: '男', attributes: { role: 'option', 'data-value': '男' } }),
    new FakeElement('div', { textContent: '女', attributes: { role: 'option', 'data-value': '女' } }),
  );
  fixture.document = makeDocument([fixture.formItem, overlay]);
  const descriptors = Detector.scan(fixture.document, { section: 'basic' });
  let selected = '';
  let writes = 0;
  let optionClicks = 0;
  const EventDispatcher = {
    clickLikeUser(element, details) {
      if (details?.purpose === 'custom-select-option') {
        selected = element.textContent;
        optionClicks += 1;
      }
      return true;
    },
    readControlValue() { return selected; },
  };

  for (const descriptor of descriptors) {
    writes += 1;
    const result = await CustomSelectAdapter.write({
      descriptor,
      value: '男',
      fieldPath: 'basic.gender',
      framework: 'ant-design',
      settings: { customSelectTimeoutMs: 100 },
      dependencies: { EventDispatcher },
    });
    assert.equal(result.status, 'SUCCESS', result.reason);
  }

  assert.equal(descriptors.length, 1);
  assert.equal(writes, 1);
  assert.equal(optionClicks, 1);
  assert.equal(selected, '男');
});

test('V2 regression: JQX logical select and ordinary input label recovery remain intact', () => {
  const jqxLabel = labelNode('本科学制');
  const jqx = new FakeElement('div', {
    className: 'jqx-widget jqx-dropdownlist-state-normal',
    attributes: { role: 'combobox' },
  }).append(new FakeElement('input', { type: 'text' }));
  const jqxItem = new FakeElement('div', { className: 'ant-form-item' }).append(jqxLabel, jqx);
  const textLabel = labelNode('姓名');
  const input = new FakeElement('input', { type: 'text' });
  const textItem = new FakeElement('div', { className: 'ant-form-item' }).append(textLabel, input);
  makeDocument([jqxItem, textItem]);

  const jqxDescriptor = Detector.buildDescriptor(jqx, 0, { section: 'education' });
  const textDescriptor = Detector.buildDescriptor(input, 1, { section: 'basic' });
  assert.equal(jqxDescriptor.labelText, '本科学制');
  assert.equal(jqxDescriptor.controlKind, 'custom-select');
  assert.equal(textDescriptor.labelText, '姓名');
  assert.equal(textDescriptor.controlKind, 'text');
});

test('V2 diagnosis: descriptor and metadata-only diagnostic expose semantic ownership evidence', () => {
  const owned = antLogicalSelect('政治面貌');
  const descriptor = Detector.buildDescriptor(owned.wrapper, 0, { section: 'basic' });
  assert.deepEqual(descriptor.semanticOwnershipDebug, {
    logicalControlCount: 1,
    formItemFound: true,
    formItemLabelFound: true,
    ownershipReason: 'single-logical-field',
  });

  const diagnostic = Detector.toDiagnostic(descriptor);
  assert.deepEqual(diagnostic.semanticOwnershipDebug, descriptor.semanticOwnershipDebug);
  assert.doesNotMatch(JSON.stringify(diagnostic.semanticOwnershipDebug), /element|ownerDocument|children|政治面貌/);

  const independent = new FakeElement('input', { type: 'text' });
  owned.formItem.append(independent);
  owned.document = makeDocument([owned.formItem]);
  const ambiguous = Detector.buildDescriptor(owned.wrapper, 1, { section: 'basic' });
  assert.deepEqual(ambiguous.semanticOwnershipDebug, {
    logicalControlCount: 2,
    formItemFound: true,
    formItemLabelFound: true,
    ownershipReason: 'multiple-logical-fields',
  });
});
