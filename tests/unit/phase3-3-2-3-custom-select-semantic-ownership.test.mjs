import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Detector = require('../../src/core/field-detector.js');
const Matcher = require('../../src/core/field-matcher.js');
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
    this.hidden = false;
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
      const previous = this.children.at(-1) || null;
      child.parentElement = this;
      child.previousElementSibling = previous;
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
    const source = String(selector || '');
    if (source.includes('input[type="hidden"]')) return this.tagName === 'INPUT' && this.type === 'hidden';
    if (source === 'td,th') return ['TD', 'TH'].includes(this.tagName);
    if (source === 'tr') return this.tagName === 'TR';
    if (source === 'label') return this.tagName === 'LABEL';
    if (source.includes('[role="combobox"]') && this.getAttribute('role') === 'combobox') return true;
    if (source.includes('[role="textbox"]') && this.getAttribute('role') === 'textbox') return true;
    if (source.includes('.ant-select-selector') && this.className.split(/\s+/).includes('ant-select-selector')) return true;
    if (source.includes('.el-select__wrapper') && this.className.split(/\s+/).includes('el-select__wrapper')) return true;
    if (source.includes('.el-select') && this.className.split(/\s+/).includes('el-select')) return true;
    if (source.includes('.ant-form-item') && this.className.split(/\s+/).includes('ant-form-item')) return true;
    if (source.includes('.ant-form-item-label') && this.className.split(/\s+/).includes('ant-form-item-label')) return true;
    if (source.includes('.jqx-widget') && this.className.split(/\s+/).includes('jqx-widget')) return true;
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
    if (selector === Detector.STANDARD_SELECTOR) {
      return this.descendants().filter(node => node.tagName === 'INPUT'
        || node.tagName === 'TEXTAREA'
        || node.tagName === 'SELECT'
        || node.getAttribute?.('role') === 'combobox');
    }
    if (selector === Detector.CUSTOM_SELECT_SELECTOR) {
      return this.descendants().filter(node => node.matches(Detector.CUSTOM_SELECT_SELECTOR));
    }
    if (/role="option"|data-select-option|select-item-option|jqx-listitem/.test(selector)) {
      return this.descendants().filter(node => node.getAttribute?.('role') === 'option');
    }
    if (/form-item-label|field-label|label-column|data-field-label|data-caption|(?:^|,)label(?:,|$)/.test(selector)) {
      return this.descendants().filter(node => node.tagName === 'LABEL'
        || node.className.split(/\s+/).includes('ant-form-item-label'));
    }
    if (/selection-item|selected-value|aria-selected/.test(selector)) {
      return this.descendants().filter(node => /(?:^|\s)ant-select-selection-item(?:\s|$)/.test(node.className));
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
    getComputedStyle() { return { display: 'block', visibility: 'visible', opacity: '1', position: 'static' }; },
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
      if (selector === 'input[type="file"]') return [];
      if (selector === Detector.CUSTOM_UPLOAD_SELECTOR) return [];
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

function antSelectForm(labelText, options = {}) {
  const label = new FakeElement('label', {
    className: 'ant-form-item-label',
    textContent: labelText,
  });
  const wrapper = new FakeElement('div', {
    className: options.className || 'ant-select-selector',
    attributes: options.wrapperAttributes || {},
  });
  const input = new FakeElement('input', {
    type: 'search',
    attributes: { role: 'combobox', ...(options.inputAttributes || {}) },
  });
  wrapper.append(input);
  const formItem = new FakeElement('div', { className: 'ant-form-item' });
  formItem.append(label, wrapper);
  const extraControls = [];
  for (let index = 0; index < (options.extraControls || 0); index += 1) {
    const extra = new FakeElement('input', { type: 'text' });
    formItem.append(extra);
    extraControls.push(extra);
  }
  const document = makeDocument([formItem]);
  return { document, formItem, label, wrapper, input, extraControls };
}

function basicContext() {
  return {
    section: 'basic',
    sectionId: 'basic',
    collection: 'basic',
    collectionMode: 'record',
    confidence: 1,
    source: 'fixture',
  };
}

test('Custom Select ownership: wrapper 唯一包含内部 combobox 时继承 form-item label', () => {
  const fixture = antSelectForm('性别');
  const descriptor = Detector.buildDescriptor(fixture.wrapper, 0, { section: 'basic' });

  assert.equal(descriptor.controlKind, 'custom-select');
  assert.equal(descriptor.labelText, '性别');
  assert.equal(descriptor.labelSource, 'form-item-label');

  const match = Matcher.matchField(descriptor, { basic: { gender: '男' } }, {
    sectionContext: basicContext(),
  });
  assert.equal(match.status, 'MATCHED', match.reason);
  assert.equal(match.matchedPath, 'basic.gender');
});

test('Custom Select ownership: wrapper 读取唯一内部 combobox 的 aria-labelledby', () => {
  const fixture = antSelectForm('不可借用的外层标签', {
    inputAttributes: { 'aria-labelledby': 'owned_label' },
  });
  fixture.label.id = 'owned_label';
  fixture.document = makeDocument([fixture.formItem]);

  const descriptor = Detector.buildDescriptor(fixture.wrapper, 0, { section: 'basic' });
  assert.equal(descriptor.labelText, '不可借用的外层标签');
  assert.equal(descriptor.labelSource, 'aria-labelledby');
});

test('Custom Select ownership: 五个 Ant Select 各自绑定自己的 label，缺失 JSON 是 MISSING_JSON', () => {
  const definitions = [
    ['证件类型', 'basic.idType'],
    ['性别', 'basic.gender'],
    ['政治面貌', 'basic.political'],
    ['民族', 'basic.ethnicity'],
    ['婚姻状况', 'basic.marital'],
  ];
  const fixtures = definitions.map(([label]) => antSelectForm(label));
  const document = makeDocument(fixtures.map(fixture => fixture.formItem));
  const descriptors = Detector.scan(document, { section: 'basic' });

  assert.equal(descriptors.length, 5, '每个 wrapper 只能生成一个 descriptor，内部 input 必须去重');
  assert.deepEqual(descriptors.map(item => item.labelText), definitions.map(([label]) => label));

  const resume = { basic: { idType: '居民身份证', gender: '男' } };
  const results = descriptors.map(descriptor => Matcher.matchField(descriptor, resume, {
    sectionContext: basicContext(),
  }));
  assert.deepEqual(results.map(result => result.matchedPath), definitions.map(([, path]) => path));
  assert.deepEqual(results.map(result => result.status), [
    'MATCHED', 'MATCHED', 'MISSING_JSON', 'MISSING_JSON', 'MISSING_JSON',
  ]);
});

test('Custom Select ownership: 同一 form-item 有两个独立 controls 时保持 fail-closed', () => {
  const fixture = antSelectForm('性别', { extraControls: 1 });
  const descriptor = Detector.buildDescriptor(fixture.wrapper, 0, { section: 'basic' });

  assert.equal(descriptor.labelText, '');
  assert.equal(descriptor.labelSource, '');
});

test('Custom Select ownership: semantic label 不得来自当前 option text', () => {
  const fixture = antSelectForm('', {});
  const selected = new FakeElement('span', { className: 'ant-select-selection-item', textContent: '男' });
  fixture.wrapper.append(selected);
  fixture.document = makeDocument([fixture.formItem]);

  const descriptor = Detector.buildDescriptor(fixture.wrapper, 0, { section: 'basic' });
  assert.equal(descriptor.labelText, '');
  assert.equal(descriptor.currentValue, '男');
});

test('Custom Select ownership: internal aria-labelledby 指向 selected item 时不得泄漏 option text', () => {
  const fixture = antSelectForm('', {
    inputAttributes: { 'aria-labelledby': 'current_selected_value' },
  });
  const selected = new FakeElement('span', {
    className: 'ant-select-selection-item',
    textContent: '男',
  });
  selected.id = 'current_selected_value';
  fixture.wrapper.append(selected);
  fixture.document = makeDocument([fixture.formItem]);

  const descriptor = Detector.buildDescriptor(fixture.wrapper, 0, { section: 'basic' });
  assert.equal(descriptor.labelText, '');
  assert.equal(descriptor.labelSource, '');
  assert.equal(descriptor.currentValue, '男');
});

test('Custom Select ownership: Element 嵌套 wrapper chain 只生成一个 descriptor', () => {
  const label = new FakeElement('label', {
    className: 'ant-form-item-label',
    textContent: '性别',
  });
  const outer = new FakeElement('div', { className: 'el-select' });
  const inner = new FakeElement('div', { className: 'el-select__wrapper' });
  const input = new FakeElement('input', {
    type: 'search',
    attributes: { role: 'combobox' },
  });
  inner.append(input);
  outer.append(inner);
  const formItem = new FakeElement('div', { className: 'ant-form-item' });
  formItem.append(label, outer);
  const document = makeDocument([formItem]);

  const descriptors = Detector.scan(document, { section: 'basic' });
  assert.equal(descriptors.length, 1, '同一 unique actionable control 的嵌套根必须 canonicalize');
  assert.equal(descriptors[0].element, outer);
  assert.equal(descriptors[0].labelText, '性别');
});

test('Custom Select ownership: 恢复性别 label 后真实 adapter 仍按语义选择唯一 option', async () => {
  const fixture = antSelectForm('性别', {
    wrapperAttributes: { 'aria-controls': 'gender_options' },
  });
  const overlay = new FakeElement('div', {
    id: 'gender_options',
    attributes: { role: 'listbox' },
  });
  const male = new FakeElement('div', { textContent: '男', attributes: { role: 'option', 'data-value': '男' } });
  const female = new FakeElement('div', { textContent: '女', attributes: { role: 'option', 'data-value': '女' } });
  overlay.append(male, female);
  fixture.document = makeDocument([fixture.formItem, overlay]);
  const descriptor = Detector.scan(fixture.document, { section: 'basic' })[0];
  let selected = '';
  const clicks = [];
  const EventDispatcher = {
    clickLikeUser(element, details) {
      clicks.push([element, details?.purpose]);
      if (element.getAttribute?.('role') === 'option') selected = element.textContent;
      return true;
    },
    readControlValue() { return selected; },
  };

  const result = await CustomSelectAdapter.write({
    descriptor,
    value: '男',
    fieldPath: 'basic.gender',
    framework: 'ant',
    settings: { customSelectTimeoutMs: 100 },
    dependencies: { EventDispatcher },
  });

  assert.equal(result.status, 'SUCCESS', result.reason);
  assert.equal(selected, '男');
  assert.equal(clicks.filter(([, purpose]) => purpose === 'custom-select-trigger').length, 1);
  assert.equal(clicks.filter(([, purpose]) => purpose === 'custom-select-option').length, 1);
  assert.equal(female.textContent, '女');
});

test('Custom Select ownership: JQX role=combobox wrapper 仍保持单 descriptor 与独立 label', () => {
  const fixture = antSelectForm('本科学制', {
    className: 'jqx-widget jqx-dropdownlist-state-normal',
    wrapperAttributes: { role: 'combobox' },
    inputAttributes: {},
  });
  fixture.input.attributes.delete('role');
  fixture.document = makeDocument([fixture.formItem]);

  const descriptors = Detector.scan(fixture.document, { section: 'education' });
  assert.equal(descriptors.length, 1);
  assert.equal(descriptors[0].element, fixture.wrapper);
  assert.equal(descriptors[0].labelText, '本科学制');
});
