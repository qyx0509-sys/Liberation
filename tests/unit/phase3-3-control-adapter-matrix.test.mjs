import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Events = require('../../src/core/event-dispatcher.js');
const Options = require('../../src/mappings/option-aliases.js');
const Dates = require('../../src/mappings/date-rules.js');
const SemanticVerification = require('../../src/core/semantic-verification.js');
const Verification = require('../../src/core/verification-engine.js');
const Controls = require('../../src/controls/control-adapter-registry.js');

Object.assign(globalThis, {
  JFEventDispatcher: Events,
  JFOptionAliases: Options,
  JFDateRules: Dates,
  JFSemanticVerification: SemanticVerification,
  JFVerificationEngine: Verification,
  JFControlAdapterRegistry: Controls,
});

const EXPECTED_ADAPTER_MODULES = Object.freeze([
  '../../src/controls/adapters/native-value-adapter.js',
  '../../src/controls/adapters/native-select-adapter.js',
  '../../src/controls/adapters/choice-adapter.js',
  '../../src/controls/adapters/custom-select-adapter.js',
  '../../src/controls/adapters/date-like-adapter.js',
  '../../src/controls/adapters/compound-picker-adapter.js',
]);
const adapterLoadErrors = new Map();
for (const modulePath of EXPECTED_ADAPTER_MODULES) {
  try { require(modulePath); }
  catch (error) { adapterLoadErrors.set(modulePath, error); }
}

const Form = require('../../src/core/form-filler.js');

class FakeEvent {
  constructor(type, init = {}) { this.type = type; Object.assign(this, init); }
}

const fakeView = {
  Event: FakeEvent,
  InputEvent: FakeEvent,
  FocusEvent: FakeEvent,
  MouseEvent: FakeEvent,
  PointerEvent: FakeEvent,
  KeyboardEvent: FakeEvent,
  requestAnimationFrame(callback) { callback(); },
  getComputedStyle(element) {
    return element?.hidden
      ? { display: 'none', visibility: 'hidden', opacity: '0', position: 'static' }
      : { display: 'block', visibility: 'visible', opacity: '1', position: 'static' };
  },
  CSS: { escape(value) { return String(value); } },
};

function selectorText(selector) { return String(selector || ''); }

class FakeNode {
  constructor(tagName = 'DIV', options = {}) {
    this.tagName = tagName.toUpperCase();
    this.type = options.type || '';
    this.id = options.id || '';
    this.className = options.className || '';
    this.textContent = options.textContent || '';
    this.innerText = options.innerText ?? this.textContent;
    this.hidden = Boolean(options.hidden);
    this.disabled = Boolean(options.disabled);
    this.readOnly = Boolean(options.readOnly);
    this.isConnected = true;
    this.isContentEditable = false;
    this.parentElement = options.parentElement || null;
    this.ownerDocument = null;
    this.events = [];
    this.clickCount = 0;
    this.attributes = new Map(Object.entries(options.attributes || {}));
    this.children = [];
    this.onClick = options.onClick || null;
    this.classList = { contains: token => String(this.className).split(/\s+/).includes(token) };
  }

  getAttribute(name) { return this.attributes.get(name) ?? null; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  removeAttribute(name) { this.attributes.delete(name); }
  focus() {}
  blur() {}
  dispatchEvent(event) { this.events.push(event.type); return true; }
  click() { this.clickCount += 1; this.onClick?.(this); }
  getBoundingClientRect() { return { width: 220, height: 34, left: 20, top: 20, right: 240, bottom: 54 }; }
  getRootNode() { return this.ownerDocument || null; }
  contains(node) { return node === this || this.children.some(child => child === node || child.contains?.(node)); }
  closest(selector) {
    const source = selectorText(selector);
    if (source.includes('#__jf_panel__') || source === 'form' || source.includes('a[href]')) return null;
    return null;
  }
  matches(selector) {
    const source = selectorText(selector);
    if (source.includes(':disabled') && this.disabled) return true;
    if (source.includes('[hidden]') && this.hidden) return true;
    if (source.includes('[role="option"]') && this.getAttribute('role') === 'option') return true;
    if (source.includes('[role="combobox"]') && this.getAttribute('role') === 'combobox') return true;
    if (source.includes('button') && this.tagName === 'BUTTON') return true;
    if (source.includes('input') && this.tagName === 'INPUT') return true;
    return false;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  querySelectorAll(selector) {
    const source = selectorText(selector);
    return this.children.filter(child => {
      if (/role="option"|select-item-option|dropdown__item|react-select__option|jqx-listitem|arco-select-option|ivu-select-item|data-select-option/.test(source)) {
        return child.getAttribute?.('role') === 'option'
          || /option|listitem|select-item/.test(child.className || '');
      }
      if (/button|role="button"|prev|next|left|right|month|span|div|td|li/.test(source)) return true;
      return false;
    });
  }
}

class FakeInput extends FakeNode {
  constructor(type = 'text', options = {}) {
    super(options.tagName || 'INPUT', { ...options, type });
    this._value = options.value || '';
    this._checked = Boolean(options.checked);
    this.frameworkValue = this._value;
    this.frameworkChecked = this._checked;
    this.ignoreNativeWrites = Boolean(options.ignoreNativeWrites);
    this.nativeWriteAttempts = 0;
  }
  get value() { return this._value; }
  set value(next) {
    this.nativeWriteAttempts += 1;
    if (!this.ignoreNativeWrites) this._value = String(next ?? '');
  }
  get checked() { return this._checked; }
  set checked(next) { this._checked = Boolean(next); }
  click() {
    super.click();
    if (this.type === 'checkbox') this._checked = !this._checked;
    if (this.type === 'radio') this._checked = true;
  }
  dispatchEvent(event) {
    super.dispatchEvent(event);
    if (event.type === 'input') this.frameworkValue = this.value;
    if (event.type === 'change') this.frameworkChecked = this.checked;
    return true;
  }
}

class FakeSelect extends FakeInput {
  constructor(labels, options = {}) {
    super('select-one', { ...options, tagName: 'SELECT' });
    this.options = labels.map((label, index) => ({
      textContent: label,
      label,
      value: index === 0 && /选择|请选择|未选择/.test(label) ? '' : label,
      disabled: false,
      selected: false,
    }));
    this._value = options.value || '';
  }
  get value() { return this._value; }
  set value(next) {
    this.nativeWriteAttempts += 1;
    if (this.ignoreNativeWrites) return;
    this._value = String(next ?? '');
    this.options.forEach(option => { option.selected = option.value === this._value; });
  }
  get selectedOptions() { return this.options.filter(option => option.selected || option.value === this._value); }
}

function makeDocument() {
  const document = {
    nodeType: 9,
    title: '控件矩阵测试',
    location: { href: 'https://example.test/form', origin: 'https://example.test' },
    defaultView: fakeView,
    body: null,
    documentElement: null,
    overlays: [],
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
    querySelectorAll(selector) {
      const source = selectorText(selector);
      if (/role="dialog"|role="listbox"|jqx-calendar|date-picker|datepicker|month-picker|monthpicker|calendar|picker-panel/.test(source)) {
        return this.overlays.filter(item => !item.hidden);
      }
      if (/role="option"|select-item-option|dropdown__item|react-select__option|jqx-listitem|arco-select-option|ivu-select-item|data-select-option/.test(source)) {
        return this.overlays.filter(item => !item.hidden).flatMap(item => item.querySelectorAll(selector));
      }
      return [];
    },
    getElementById(id) { return this.overlays.find(item => item.id === id) || null; },
  };
  document.body = new FakeNode('BODY');
  document.documentElement = new FakeNode('HTML');
  document.body.ownerDocument = document;
  document.documentElement.ownerDocument = document;
  return document;
}

function attach(document, ...nodes) {
  for (const node of nodes.flat(Infinity).filter(Boolean)) node.ownerDocument = document;
  return nodes[0];
}

function descriptor(controlKind, node, overrides = {}) {
  return {
    detectorId: `matrix_${controlKind}_${Math.random().toString(16).slice(2)}`,
    element: node,
    interactionElement: node,
    controlKind,
    type: controlKind,
    baseControlKind: controlKind,
    inputType: node?.type || '',
    tagName: String(node?.tagName || '').toLowerCase(),
    visible: true,
    hidden: false,
    disabled: Boolean(node?.disabled),
    readOnly: Boolean(node?.readOnly),
    sensitive: false,
    parent: { classes: [] },
    options: [],
    elements: [node],
    ...overrides,
  };
}

function selectDescriptor(select, overrides = {}) {
  return descriptor('native-select', select, {
    options: select.options.map(option => ({
      element: option, label: option.label, value: option.value, disabled: option.disabled,
    })),
    ...overrides,
  });
}

async function execute(field, value, settings = {}) {
  assert.equal(typeof Controls.execute, 'function', '所有控件执行必须进入 ControlAdapterRegistry.execute()');
  const result = await Controls.execute(field, value, {
    allowOverwrite: true,
    skipEmpty: true,
    optionMinScore: 0.88,
    optionAmbiguityMargin: 0.06,
    customSelectTimeoutMs: 80,
    datePickerTimeoutMs: 80,
    ...settings,
  });
  assert.ok(result && typeof result === 'object');
  assert.equal(typeof result.status, 'string');
  return result;
}

function assertEventOrder(node, expected = ['focus', 'pointerdown', 'mousedown', 'input', 'change', 'blur']) {
  let cursor = -1;
  for (const event of expected) {
    const next = node.events.indexOf(event, cursor + 1);
    assert.ok(next > cursor, `${event} 事件顺序错误：${node.events.join(',')}`);
    cursor = next;
  }
}

function choiceDescriptor(kind, labels, options = {}) {
  const document = makeDocument();
  const elements = labels.map(label => attach(document, new FakeInput(kind, { value: label })));
  elements.forEach(element => { element._value = labels[elements.indexOf(element)]; });
  const field = descriptor(kind, elements[0], {
    elements,
    options: elements.map((element, index) => ({
      element, label: labels[index], value: labels[index], disabled: false,
    })),
    ...options,
  });
  return { document, elements, field };
}

const FRAMEWORK_FIXTURES = Object.freeze({
  aria: { triggerClass: 'application-combobox', triggerRole: 'combobox', overlayClass: 'application-listbox', optionClass: '', optionRole: 'option' },
  jqx: { triggerClass: 'jqx-widget jqx-dropdownlist-state-normal', triggerRole: 'combobox', overlayClass: 'jqx-listbox', optionClass: 'jqx-listitem-element', optionRole: 'option' },
  'ant-design': { triggerClass: 'ant-select ant-select-single', triggerRole: 'combobox', overlayClass: 'ant-select-dropdown', optionClass: 'ant-select-item-option', optionRole: 'option' },
  'element-plus': { triggerClass: 'el-select el-select--default', triggerRole: 'combobox', overlayClass: 'el-select-dropdown', optionClass: 'el-select-dropdown__item', optionRole: 'option' },
  'react-select': { triggerClass: 'react-select__control', triggerRole: 'combobox', overlayClass: 'react-select__menu', optionClass: 'react-select__option', optionRole: 'option' },
});

function customSelectFixture(framework, labels, options = {}) {
  const config = FRAMEWORK_FIXTURES[framework];
  const document = options.document || makeDocument();
  const overlayId = options.overlayId || `overlay_${framework}`;
  let opened = false;
  let selected = options.initialValue || '';
  const trigger = new FakeNode('DIV', {
    className: config.triggerClass,
    attributes: { role: config.triggerRole, 'aria-controls': overlayId },
  });
  trigger.getAttribute = function getAttribute(name) {
    if (name === 'data-value') return selected;
    return this.attributes.get(name) ?? null;
  };
  trigger.querySelector = function querySelector(selector) {
    if (/selection-item|selected-value|aria-selected|jqx-dropdownlist-content|jqx-combobox-input/.test(selector) && selected) {
      return { textContent: selected };
    }
    if (/jqx-/.test(selector) && framework === 'jqx') return { textContent: selected };
    return null;
  };
  const overlay = new FakeNode('DIV', {
    id: overlayId,
    className: config.overlayClass,
    hidden: true,
    attributes: { role: 'listbox' },
  });
  const optionNodes = labels.map(label => new FakeNode(options.optionTag || 'DIV', {
    className: config.optionClass,
    textContent: label,
    type: options.optionType || '',
    attributes: { role: config.optionRole, 'data-value': label },
    onClick(node) {
      if (options.preventSelection) return;
      selected = label;
      trigger.setAttribute('data-value', label);
      node.setAttribute('aria-selected', 'true');
    },
  }));
  overlay.children = optionNodes;
  optionNodes.forEach(node => { node.parentElement = overlay; });
  trigger.onClick = () => { opened = true; overlay.hidden = false; };
  document.overlays.push(overlay);
  attach(document, trigger, overlay, optionNodes);

  const field = descriptor('custom-select', trigger, {
    interactionElement: trigger,
    options: [],
    parent: { classes: config.triggerClass.split(/\s+/) },
  });
  return {
    document, field, trigger, overlay, optionNodes,
    get opened() { return opened; },
    get selected() { return selected; },
  };
}

function monthPickerFixture(options = {}) {
  const document = makeDocument();
  const input = new FakeInput(options.inputType || 'text', {
    value: options.initialValue || '',
    readOnly: Boolean(options.readOnly),
    ignoreNativeWrites: Boolean(options.rejectDirectWrite),
  });
  let year = options.displayYear || 2024;
  let opened = false;
  const trigger = new FakeNode('BUTTON', {
    type: 'button',
    className: 'calendar-trigger',
    textContent: '选择日期',
    attributes: { role: 'button', 'aria-haspopup': 'dialog' },
  });
  const panel = new FakeNode('DIV', {
    className: 'generic-month-picker-panel',
    hidden: true,
    attributes: { role: 'dialog' },
  });
  const previous = new FakeNode('BUTTON', {
    type: 'button', textContent: '上一年', attributes: { role: 'button', 'aria-label': '上一年' },
    onClick() { year -= 1; refresh(); },
  });
  const next = new FakeNode('BUTTON', {
    type: 'button', textContent: '下一年', attributes: { role: 'button', 'aria-label': '下一年' },
    onClick() { year += 1; refresh(); },
  });
  const months = Array.from({ length: 12 }, (_, index) => new FakeNode('DIV', {
    className: 'month-cell', textContent: `${index + 1}月`, attributes: { role: 'option' },
    onClick() { input._value = `${year}-${String(index + 1).padStart(2, '0')}`; },
  }));
  function refresh() {
    panel.innerText = `${year}年 ${months.map(node => node.textContent).join(' ')}`;
    panel.textContent = panel.innerText;
  }
  refresh();
  panel.children = [previous, next, ...months];
  trigger.onClick = () => { opened = true; panel.hidden = false; };
  const container = new FakeNode('DIV', { className: 'date-input-group' });
  container.children = [input, trigger];
  container.querySelectorAll = selector => /button|role="button"|calendar|date|time|i|svg/.test(selectorText(selector)) ? [trigger] : [];
  input.parentElement = container;
  trigger.parentElement = container;
  document.overlays.push(panel);
  attach(document, input, trigger, panel, previous, next, months, container);
  const field = descriptor(options.controlKind || 'month', input, {
    interactionElement: options.noTrigger ? input : trigger,
    inputType: options.inputType || 'month',
    readOnly: Boolean(options.readOnly),
    type: options.controlKind || 'month',
  });
  if (options.noTrigger) {
    input.parentElement = null;
    document.overlays = [];
  }
  return { document, input, trigger, panel, previous, next, months, field, get year() { return year; }, get opened() { return opened; } };
}

test('Adapter Runtime 模块均可加载，不能只在 Registry 中保留分类 metadata', () => {
  assert.deepEqual([...adapterLoadErrors.keys()], [], [...adapterLoadErrors.entries()].map(([path, error]) => `${path}: ${error.message}`).join('\n'));
});

test('Native Value：text/textarea/number 均经原生 setter 与完整事件链写入 SUCCESS', async () => {
  for (const [tagName, type, value] of [['INPUT', 'text', '示例姓名'], ['TEXTAREA', 'textarea', '多行内容'], ['INPUT', 'number', 425]]) {
    const document = makeDocument();
    const input = attach(document, new FakeInput(type, { tagName }));
    const result = await execute(descriptor(type === 'textarea' ? 'textarea' : type, input), value, { fieldPath: 'basic.name' });
    assert.equal(result.status, 'SUCCESS', `${tagName}/${type}: ${result.reason}`);
    assert.equal(input.value, String(value));
    assertEventOrder(input);
  }
});

test('Native Value：页面已有相同值由薄 FormFiller 返回 SKIPPED_EXISTING', async () => {
  const document = makeDocument();
  const input = attach(document, new FakeInput('text', { value: '已有内容' }));
  const result = await Form.fill(descriptor('text', input), '已有内容', { allowOverwrite: false, fieldPath: 'basic.name' });
  assert.equal(result.status, 'SKIPPED_EXISTING');
  assert.equal(input.events.length, 0);
});

test('Native Value：已有不同值且 allowOverwrite=false 返回 CONFLICT 且不写', async () => {
  const document = makeDocument();
  const input = attach(document, new FakeInput('text', { value: '网页原值' }));
  const result = await Form.fill(descriptor('text', input), '计划新值', { allowOverwrite: false, fieldPath: 'basic.name' });
  assert.equal(result.status, 'CONFLICT');
  assert.equal(input.value, '网页原值');
  assert.equal(input.events.length, 0);
});

test('Native Value Safety：password/submit/file/reset/image 永不写入', async () => {
  for (const type of ['password', 'submit', 'file', 'reset', 'image']) {
    const document = makeDocument();
    const input = attach(document, new FakeInput(type, { value: '原值' }));
    const field = descriptor(type === 'file' ? 'file' : 'text', input, { sensitive: type === 'password' });
    const result = await Form.fill(field, '禁止写入', { allowOverwrite: true, fieldPath: 'basic.name' });
    assert.notEqual(result.status, 'SUCCESS', type);
    assert.equal(input.value, '原值', type);
    assert.equal(input.events.length, 0, type);
  }
});

test('Native Select：男/男性选择真实“男”而非 placeholder', async () => {
  const document = makeDocument();
  const select = attach(document, new FakeSelect(['--请选择--', '男', '女']));
  const result = await execute(selectDescriptor(select), '男性', { fieldPath: 'basic.gender', expectedType: 'choice' });
  assert.equal(result.status, 'SUCCESS', result.reason);
  assert.equal(select.value, '男');
  assert.notEqual(select.value, '');
});

test('Native Select：政治面貌 option aliases 选择“中国共产党党员”', async () => {
  const document = makeDocument();
  const select = attach(document, new FakeSelect(['请选择', '群众', '中国共产党党员']));
  const result = await execute(selectDescriptor(select), '中共党员', { fieldPath: 'basic.political', expectedType: 'choice' });
  assert.equal(result.status, 'SUCCESS', result.reason);
  assert.equal(select.value, '中国共产党党员');
});

test('Native Select：4年选择“四年制”并通过字段感知语义验证', async () => {
  const document = makeDocument();
  const select = attach(document, new FakeSelect(['请选择', '三年制', '四年制', '五年制']));
  const result = await execute(selectDescriptor(select), '4年', { fieldPath: 'education[].studyDuration', expectedType: 'choice' });
  assert.equal(result.status, 'SUCCESS', result.reason);
  assert.equal(select.value, '四年制');
});

test('Phase 3.4 Option Overlay：局部别名贯穿选择与写后验证，下一次无 Profile 调用不受污染', async () => {
  const profileDocument = makeDocument();
  const profileSelect = attach(profileDocument, new FakeSelect(['请选择', '本科四学年']));
  const optionAliases = {
    'education[].studyDuration': { '4': ['本科四学年'] },
  };
  const profileResult = await execute(selectDescriptor(profileSelect), 4, {
    fieldPath: 'education[].studyDuration',
    expectedType: 'choice',
    optionAliases,
  });
  assert.equal(profileResult.status, 'SUCCESS', profileResult.reason);
  assert.equal(profileSelect.value, '本科四学年');

  const genericDocument = makeDocument();
  const genericSelect = attach(genericDocument, new FakeSelect(['请选择', '本科四学年']));
  const genericResult = await execute(selectDescriptor(genericSelect), 4, {
    fieldPath: 'education[].studyDuration',
    expectedType: 'choice',
  });
  assert.equal(genericResult.status, 'NEEDS_CONFIRMATION');
  assert.equal(genericSelect.value, '');
});

test('Phase 3.4 Option Overlay：页面已有局部语义等价值时跳过，不误报 CONFLICT', async () => {
  const document = makeDocument();
  const select = attach(document, new FakeSelect(['请选择', '本科四学年'], { value: '本科四学年' }));
  const field = selectDescriptor(select);
  const result = await Form.fill(field, 4, {
    allowOverwrite: false,
    fieldPath: 'education[].studyDuration',
    expectedType: 'choice',
    optionAliases: {
      'education[].studyDuration': { '4': ['本科四学年'] },
    },
  });

  assert.equal(result.status, 'SKIPPED_EXISTING', result.reason);
  assert.equal(select.value, '本科四学年');
  assert.deepEqual(select.events, []);
});

test('Native Select fail-closed：无可靠匹配不选第一项并返回 NEEDS_CONFIRMATION', async () => {
  const document = makeDocument();
  const select = attach(document, new FakeSelect(['请选择', '甲类', '乙类']));
  const result = await execute(selectDescriptor(select), '完全无关', { fieldPath: 'projects[].type', expectedType: 'choice' });
  assert.equal(result.status, 'NEEDS_CONFIRMATION');
  assert.equal(select.value, '');
});

test('Native Select live-disabled：检测后被页面禁用的 select 不得写入或触发事件', async () => {
  const document = makeDocument();
  const select = attach(document, new FakeSelect(['请选择', '男', '女']));
  const field = selectDescriptor(select);

  // 模拟 FieldDetector 扫描完成后，页面框架在真正执行前禁用控件。
  assert.equal(field.disabled, false, '前置描述符应保留扫描时的可用状态');
  select.disabled = true;

  const result = await execute(field, '男性', { fieldPath: 'basic.gender', expectedType: 'choice' });
  assert.notEqual(result.status, 'SUCCESS');
  assert.equal(select.value, '', '运行时已禁用的 select 不能被改写');
  assert.deepEqual(select.events, [], '运行时已禁用的 select 不能触发框架事件');
});

test('Radio：男/女性只选择正确“女”radio', async () => {
  const { elements, field } = choiceDescriptor('radio', ['男', '女']);
  const result = await execute(field, '女性', { fieldPath: 'basic.gender', expectedType: 'choice' });
  assert.equal(result.status, 'SUCCESS', result.reason);
  assert.equal(elements[0].checked, false);
  assert.equal(elements[1].checked, true);
});

test('Radio fail-closed：多个相似项置信不足时 0 click', async () => {
  const { elements, field } = choiceDescriptor('radio', ['研究方向A', '研究方向B']);
  const result = await execute(field, '研究方向', { fieldPath: 'projects[].type', expectedType: 'choice' });
  assert.equal(result.status, 'NEEDS_CONFIRMATION');
  assert.equal(elements.every(item => item.clickCount === 0), true);
});

test('Radio Safety：submit role=radio 绝不点击', async () => {
  const document = makeDocument();
  const submit = attach(document, new FakeNode('BUTTON', { type: 'submit', textContent: '男', attributes: { role: 'radio' } }));
  submit.value = '男';
  const field = descriptor('radio', submit, { elements: [submit], options: [{ element: submit, label: '男', value: '男' }] });
  const result = await execute(field, '男', { fieldPath: 'basic.gender', expectedType: 'choice' });
  assert.notEqual(result.status, 'SUCCESS');
  assert.equal(submit.clickCount, 0);
});

test('Checkbox Boolean：true/是/有均选中明确 boolean 字段', async () => {
  for (const value of [true, '是', '有']) {
    const document = makeDocument();
    const checkbox = attach(document, new FakeInput('checkbox'));
    const field = descriptor('checkbox', checkbox, { elements: [checkbox] });
    const result = await execute(field, value, { fieldPath: 'education[].eliteTrainingBase', expectedType: 'boolean' });
    assert.equal(result.status, 'SUCCESS', `${value}: ${result.reason}`);
    assert.equal(checkbox.checked, true, String(value));
  }
});

test('Checkbox Boolean：false/否/无均取消明确 boolean 字段', async () => {
  for (const value of [false, '否', '无']) {
    const document = makeDocument();
    const checkbox = attach(document, new FakeInput('checkbox', { checked: true }));
    const field = descriptor('checkbox', checkbox, { elements: [checkbox] });
    const result = await execute(field, value, { fieldPath: 'education[].eliteTrainingBase', expectedType: 'boolean' });
    assert.equal(result.status, 'SUCCESS', `${value}: ${result.reason}`);
    assert.equal(checkbox.checked, false, String(value));
  }
});

test('Checkbox Boolean field-aware：普通数字字段 1 不能自动当 true', async () => {
  const document = makeDocument();
  const checkbox = attach(document, new FakeInput('checkbox'));
  const field = descriptor('checkbox', checkbox, { elements: [checkbox] });
  const result = await execute(field, 1, { fieldPath: 'education[].gpa', expectedType: 'number' });
  assert.equal(result.status, 'NEEDS_CONFIRMATION');
  assert.equal(checkbox.checked, false);
  assert.equal(checkbox.clickCount, 0);
});

test('Checkbox 多选：只点击高可靠目标 option', async () => {
  const { elements, field } = choiceDescriptor('checkbox', ['数学', '物理', '化学']);
  const result = await execute(field, '物理', { fieldPath: 'skills[]', expectedType: 'choice' });
  assert.equal(result.status, 'SUCCESS', result.reason);
  assert.deepEqual(elements.map(item => item.checked), [false, true, false]);
  assert.deepEqual(elements.map(item => item.clickCount), [0, 1, 0]);
});

test('Custom Select JQX：open/enumerate/semantic select/verify 完整执行', async () => {
  const fixture = customSelectFixture('jqx', ['三年制', '四年制', '五年制']);
  const result = await execute(fixture.field, '4年', { fieldPath: 'education[].studyDuration', expectedType: 'choice' });
  assert.equal(result.status, 'SUCCESS', result.reason);
  assert.equal(result.framework, 'jqx');
  assert.equal(fixture.opened, true);
  assert.equal(fixture.selected, '四年制');
  assert.deepEqual(fixture.optionNodes.map(node => node.clickCount), [0, 1, 0]);
});

test('Phase 3.3.1 JQX Boolean：空白 eliteTrainingBase 接收 JSON true 并选择“是”', async () => {
  const fixture = customSelectFixture('jqx', ['是', '否']);
  assert.equal(fixture.selected, '', '前置条件：JQX 当前值必须为空白');

  const result = await execute(fixture.field, true, {
    fieldPath: 'education[].eliteTrainingBase', expectedType: 'boolean',
  });

  assert.equal(result.status, 'SUCCESS', result.reason);
  assert.equal(fixture.selected, '是');
  assert.deepEqual(fixture.optionNodes.map(node => node.clickCount), [1, 0]);
});

test('Phase 3.3.1 Generic Mode：无 Site Profile/空 config 时学制与布尔 JQX 均可语义填写', async () => {
  const genericSettings = {
    siteProfile: null,
    siteAdapter: null,
    siteConfig: {},
    adapterConfig: {},
    mode: 'generic',
  };
  const duration = customSelectFixture('jqx', ['三年制', '四年制', '五年制']);
  const eliteBase = customSelectFixture('jqx', ['是', '否']);
  assert.equal(duration.selected, '');
  assert.equal(eliteBase.selected, '');

  const durationResult = await execute(duration.field, 4, {
    ...genericSettings,
    fieldPath: 'education[].studyDuration', expectedType: 'choice',
  });
  const booleanResult = await execute(eliteBase.field, false, {
    ...genericSettings,
    fieldPath: 'education[].eliteTrainingBase', expectedType: 'boolean',
  });

  assert.equal(durationResult.status, 'SUCCESS', durationResult.reason);
  assert.equal(booleanResult.status, 'SUCCESS', booleanResult.reason);
  assert.equal(duration.selected, '四年制');
  assert.equal(eliteBase.selected, '否');
  assert.equal(durationResult.framework, 'jqx');
  assert.equal(booleanResult.framework, 'jqx');
});

test('Phase 3.3.1 Multiple JQX Widgets：同页学制与布尔下拉按 aria-controls 隔离', async () => {
  const document = makeDocument();
  const duration = customSelectFixture('jqx', ['三年制', '四年制', '五年制'], {
    document,
    overlayId: 'jqx_duration_options',
  });
  const eliteBase = customSelectFixture('jqx', ['是', '否'], {
    document,
    overlayId: 'jqx_elite_options',
  });

  const durationResult = await execute(duration.field, 4, {
    fieldPath: 'education[].studyDuration', expectedType: 'choice',
  });
  assert.equal(durationResult.status, 'SUCCESS', durationResult.reason);
  assert.equal(duration.selected, '四年制');
  assert.equal(eliteBase.selected, '');
  assert.deepEqual(duration.optionNodes.map(node => node.clickCount), [0, 1, 0]);
  assert.deepEqual(eliteBase.optionNodes.map(node => node.clickCount), [0, 0]);

  const booleanResult = await execute(eliteBase.field, true, {
    fieldPath: 'education[].eliteTrainingBase', expectedType: 'boolean',
  });
  assert.equal(booleanResult.status, 'SUCCESS', booleanResult.reason);
  assert.equal(duration.selected, '四年制');
  assert.equal(eliteBase.selected, '是');
  assert.deepEqual(duration.optionNodes.map(node => node.clickCount), [0, 1, 0]);
  assert.deepEqual(eliteBase.optionNodes.map(node => node.clickCount), [1, 0]);
});

test('Phase 3.3.1 JQX multi-trigger：root 无效时继续尝试同控件 arrow trigger', async () => {
  const document = makeDocument();
  let selected = '';
  const root = new FakeNode('DIV', {
    className: 'jqx-widget jqx-dropdownlist-state-normal',
    attributes: { role: 'combobox' },
  });
  root.getAttribute = function getAttribute(name) {
    if (name === 'data-value') return selected;
    return this.attributes.get(name) ?? null;
  };
  root.querySelector = selector => /selection-item|selected-value|jqx-dropdownlist-content/.test(selector) && selected
    ? { textContent: selected }
    : null;
  const arrow = new FakeNode('DIV', { className: 'jqx-combobox-arrow', textContent: '▼' });
  const overlay = new FakeNode('DIV', {
    id: 'jqx_multi_trigger_list', className: 'jqx-listbox', hidden: true, attributes: { role: 'listbox' },
  });
  const optionNodes = ['三年制', '四年制', '五年制'].map(label => new FakeNode('DIV', {
    className: 'jqx-listitem-element', textContent: label, attributes: { role: 'option', 'data-value': label },
    onClick() { selected = label; root.setAttribute('data-value', label); },
  }));
  overlay.children = optionNodes;
  optionNodes.forEach(node => { node.parentElement = overlay; });
  arrow.onClick = () => { overlay.hidden = false; };
  root.children = [arrow];
  root.querySelectorAll = selector => /jqx-combobox-arrow|jqx-dropdownlist-content|jqx-combobox-input/.test(selector)
    ? [arrow]
    : [];
  arrow.parentElement = root;
  document.overlays.push(overlay);
  attach(document, root, arrow, overlay, optionNodes);
  const field = descriptor('custom-select', root, {
    interactionElement: root,
    parent: { classes: ['jqx-widget', 'jqx-dropdownlist-state-normal'] },
  });

  const result = await execute(field, '4年', {
    fieldPath: 'education[].studyDuration', expectedType: 'choice', customSelectTimeoutMs: 30,
  });

  assert.equal(result.status, 'SUCCESS', result.reason);
  assert.equal(root.clickCount, 1, '允许先尝试 detector 给出的 root trigger');
  assert.equal(arrow.clickCount, 1, 'root 未产生选项时必须继续尝试 JQX arrow');
  assert.equal(selected, '四年制');
  assert.deepEqual(optionNodes.map(node => node.clickCount), [0, 1, 0]);
});

test('Phase 3.3.1 JQX visibility transition：复用同一 option 节点从隐藏变可见也属于 fresh options', async () => {
  const document = makeDocument();
  let selected = '';
  const root = new FakeNode('DIV', {
    className: 'jqx-widget jqx-dropdownlist-state-normal', attributes: { role: 'combobox' },
  });
  root.getAttribute = function getAttribute(name) {
    if (name === 'data-value') return selected;
    return this.attributes.get(name) ?? null;
  };
  root.querySelector = selector => /selection-item|selected-value|jqx-dropdownlist-content/.test(selector) && selected
    ? { textContent: selected }
    : null;
  const overlay = new FakeNode('DIV', {
    id: 'jqx_visibility_list', className: 'jqx-listbox', hidden: true, attributes: { role: 'listbox' },
  });
  const optionNodes = ['男', '女'].map(label => new FakeNode('DIV', {
    className: 'jqx-listitem-element', textContent: label, attributes: { role: 'option', 'data-value': label },
    onClick() { selected = label; root.setAttribute('data-value', label); },
  }));
  overlay.children = optionNodes;
  optionNodes.forEach(node => { node.parentElement = overlay; });
  root.onClick = () => { overlay.hidden = false; };
  document.overlays.push(overlay);
  attach(document, root, overlay, optionNodes);

  // 模拟 JQX 预先创建并复用 option DOM；document 查询在关闭时仍可看到这些节点。
  const defaultQuery = document.querySelectorAll.bind(document);
  document.querySelectorAll = selector => {
    const source = selectorText(selector);
    if (/role="option"|select-item-option|dropdown__item|react-select__option|jqx-listitem|arco-select-option|ivu-select-item|data-select-option/.test(source)) {
      return optionNodes;
    }
    if (/role="listbox"|jqx-listbox|select-dropdown|dropdown-menu|react-select__menu|arco-select-popup|ivu-select-dropdown/.test(source)) {
      return [overlay];
    }
    return defaultQuery(selector);
  };
  const field = descriptor('custom-select', root, {
    interactionElement: root,
    parent: { classes: ['jqx-widget', 'jqx-dropdownlist-state-normal'] },
  });

  const result = await execute(field, '女性', {
    fieldPath: 'basic.gender', expectedType: 'choice', customSelectTimeoutMs: 30,
  });

  assert.equal(result.status, 'SUCCESS', result.reason);
  assert.equal(selected, '女');
  assert.deepEqual(optionNodes.map(node => node.clickCount), [0, 1]);
});

test('Phase 3.3.1 JQX overlay ownership：使用实际 arrow 的 aria-controls 隔离并发 listbox', async () => {
  const document = makeDocument();
  let selected = '';
  let unrelatedSelected = '';
  const root = new FakeNode('DIV', {
    className: 'jqx-widget jqx-dropdownlist-state-normal', attributes: { role: 'combobox' },
  });
  root.getAttribute = function getAttribute(name) {
    if (name === 'data-value') return selected;
    return this.attributes.get(name) ?? null;
  };
  root.querySelector = selector => /selection-item|selected-value|jqx-dropdownlist-content/.test(selector) && selected
    ? { textContent: selected }
    : null;
  const arrow = new FakeNode('DIV', {
    className: 'jqx-combobox-arrow', textContent: '▼', attributes: { 'aria-controls': 'jqx_owned_list' },
  });
  const targetOverlay = new FakeNode('DIV', {
    id: 'jqx_owned_list', className: 'jqx-listbox', hidden: true, attributes: { role: 'listbox' },
  });
  const unrelatedOverlay = new FakeNode('DIV', {
    id: 'jqx_unrelated_list', className: 'jqx-listbox', hidden: true, attributes: { role: 'listbox' },
  });
  const targetOption = new FakeNode('DIV', {
    className: 'jqx-listitem-element', textContent: '女', attributes: { role: 'option', 'data-value': '女' },
    onClick() { selected = '女'; root.setAttribute('data-value', '女'); },
  });
  const unrelatedOption = new FakeNode('DIV', {
    className: 'jqx-listitem-element', textContent: '女', attributes: { role: 'option', 'data-value': '女' },
    onClick() { unrelatedSelected = '女'; },
  });
  targetOverlay.children = [targetOption];
  unrelatedOverlay.children = [unrelatedOption];
  targetOption.parentElement = targetOverlay;
  unrelatedOption.parentElement = unrelatedOverlay;
  arrow.onClick = () => {
    targetOverlay.hidden = false;
    unrelatedOverlay.hidden = false;
  };
  root.children = [arrow];
  root.querySelectorAll = selector => /jqx-combobox-arrow|jqx-dropdownlist-content|jqx-combobox-input/.test(selector)
    ? [arrow]
    : [];
  arrow.parentElement = root;
  // 故意把无关 overlay 放在前面，防止依靠 document 顺序“碰巧”通过。
  document.overlays.push(unrelatedOverlay, targetOverlay);
  attach(document, root, arrow, targetOverlay, targetOption, unrelatedOverlay, unrelatedOption);
  const field = descriptor('custom-select', root, {
    interactionElement: root,
    parent: { classes: ['jqx-widget', 'jqx-dropdownlist-state-normal'] },
  });

  const result = await execute(field, '女性', {
    fieldPath: 'basic.gender', expectedType: 'choice', customSelectTimeoutMs: 30,
  });

  assert.equal(result.status, 'SUCCESS', result.reason);
  assert.equal(selected, '女');
  assert.equal(targetOption.clickCount, 1);
  assert.equal(unrelatedOption.clickCount, 0, '实际 trigger 的 aria-controls 必须隔离无关 listbox');
  assert.equal(unrelatedSelected, '');
});

test('Custom Select ARIA：aria-controls 将 option 限定到受控 listbox', async () => {
  const fixture = customSelectFixture('aria', ['群众', '中国共产党党员']);
  const noise = customSelectFixture('aria', ['错误选项', '中共党员']);
  fixture.document.overlays.push(noise.overlay);
  noise.overlay.ownerDocument = fixture.document;
  noise.optionNodes.forEach(node => { node.ownerDocument = fixture.document; });
  const result = await execute(fixture.field, '中共党员', { fieldPath: 'basic.political', expectedType: 'choice' });
  assert.equal(result.status, 'SUCCESS', result.reason);
  assert.equal(result.framework, 'aria');
  assert.equal(fixture.selected, '中国共产党党员');
  assert.equal(noise.optionNodes.every(node => node.clickCount === 0), true);
});

for (const framework of ['ant-design', 'element-plus', 'react-select']) {
  test(`Custom Select ${framework}：framework strategy 可 open/enumerate/select/verify`, async () => {
    const fixture = customSelectFixture(framework, ['男', '女']);
    const result = await execute(fixture.field, '女性', { fieldPath: 'basic.gender', expectedType: 'choice' });
    assert.equal(result.status, 'SUCCESS', result.reason);
    assert.equal(result.framework, framework);
    assert.equal(fixture.selected, '女');
    assert.equal(fixture.optionNodes[1].clickCount, 1);
  });
}

test('Custom Select 异步 overlay：通过有界 MutationObserver 等待后再匹配，不能抢用旧选项', async () => {
  const fixture = customSelectFixture('aria', ['群众', '中国共产党党员']);
  const observers = [];
  fixture.document.defaultView = {
    ...fakeView,
    MutationObserver: class FakeMutationObserver {
      constructor(callback) { this.callback = callback; this.active = true; }
      observe() { observers.push(this); }
      disconnect() { this.active = false; }
    },
  };
  for (const node of [fixture.trigger, fixture.overlay, ...fixture.optionNodes]) {
    node.ownerDocument = fixture.document;
  }
  fixture.trigger.onClick = () => {
    setTimeout(() => {
      fixture.overlay.hidden = false;
      for (const observer of observers) if (observer.active) observer.callback([]);
    }, 10);
  };

  const result = await execute(fixture.field, '中共党员', {
    fieldPath: 'basic.political', expectedType: 'choice', customSelectTimeoutMs: 100,
  });
  assert.equal(result.status, 'SUCCESS', result.reason);
  assert.equal(fixture.selected, '中国共产党党员');
  assert.deepEqual(fixture.optionNodes.map(node => node.clickCount), [0, 1]);
});

test('Custom Select 保持 Arco / View UI framework 识别能力', () => {
  for (const [className, framework] of [['arco-select-view', 'arco'], ['ivu-select-selection', 'view-ui']]) {
    const node = new FakeNode('DIV', { className, attributes: { role: 'combobox' } });
    const resolved = Controls.resolve(descriptor('custom-select', node));
    assert.equal(resolved.framework, framework);
    assert.equal(resolved.adapterId, 'custom-select');
  }
});

test('Custom Select：type=button + role=combobox 是合法触发器，不被 Registry 当普通动作按钮拒绝', async () => {
  const fixture = customSelectFixture('aria', ['男', '女']);
  fixture.trigger.tagName = 'BUTTON';
  fixture.trigger.type = 'button';
  fixture.trigger.setAttribute('type', 'button');
  const result = await execute(fixture.field, '女', {
    fieldPath: 'basic.gender', expectedType: 'choice',
  });
  assert.equal(result.status, 'SUCCESS', result.reason);
  assert.equal(fixture.selected, '女');
});

test('Custom Select fail-closed：无可靠匹配时所有 option 0 click', async () => {
  const fixture = customSelectFixture('aria', ['甲类', '乙类', '丙类']);
  const result = await execute(fixture.field, '完全无关', { fieldPath: 'projects[].type', expectedType: 'choice' });
  assert.equal(result.status, 'NEEDS_CONFIRMATION');
  assert.equal(fixture.optionNodes.every(node => node.clickCount === 0), true);
});

test('Custom Select Safety：下一步/删除/提交/链接 option-like 节点 0 dangerous click', async () => {
  const fixture = customSelectFixture('aria', ['下一步', '删除', '提交申请', '外部链接'], {
    optionTag: 'BUTTON', optionType: 'submit',
  });
  fixture.optionNodes[3].tagName = 'A';
  fixture.optionNodes[3].setAttribute('href', 'https://example.test/next');
  const result = await execute(fixture.field, '提交申请', { fieldPath: 'projects[].type', expectedType: 'choice' });
  assert.notEqual(result.status, 'SUCCESS');
  assert.equal(fixture.trigger.clickCount <= 1, true);
  assert.equal(fixture.optionNodes.every(node => node.clickCount === 0), true);
});

test('Custom Select Safety：type=button 的“保存并提交”option 也绝不能点击', async () => {
  const fixture = customSelectFixture('aria', ['普通选项', '保存并提交'], {
    optionTag: 'BUTTON', optionType: 'button',
  });
  const dangerousOption = fixture.optionNodes[1];

  const result = await execute(fixture.field, '保存并提交', {
    fieldPath: 'projects[].type', expectedType: 'choice',
  });

  assert.notEqual(result.status, 'SUCCESS');
  assert.equal(dangerousOption.clickCount, 0, '最终提交语义不能因 role=option/type=button 绕过安全规则');
  assert.equal(fixture.selected, '', '危险选项不得改变自定义下拉当前值');
});

test('Date Native：full-date 使用 DateRules 格式化并写入 SUCCESS', async () => {
  const document = makeDocument();
  const input = attach(document, new FakeInput('date'));
  const field = descriptor('date', input, { inputType: 'date' });
  const result = await execute(field, '2025/09/15', { fieldPath: 'basic.birthday', expectedType: 'date' });
  assert.equal(result.status, 'SUCCESS', result.reason);
  assert.equal(input.value, '2025-09-15');
});

test('Date Native：year-month 将 2025年9月写为 2025-09 并语义验证', async () => {
  const document = makeDocument();
  const input = attach(document, new FakeInput('month'));
  const field = descriptor('month', input, { inputType: 'month' });
  const result = await execute(field, '2025年9月', { fieldPath: 'education[].enrollmentDate', expectedType: 'date' });
  assert.equal(result.status, 'SUCCESS', result.reason);
  assert.equal(input.value, '2025-09');
});

test('Date Text：可写普通文本日期按 placeholder 策略直接填写', async () => {
  const document = makeDocument();
  const input = attach(document, new FakeInput('text'));
  input.setAttribute('placeholder', 'YYYY/MM/DD');
  const field = descriptor('text', input, { inputType: 'text', placeholder: 'YYYY/MM/DD' });
  const result = await execute(field, '2025-09-15', { fieldPath: 'projects[].startDate', expectedType: 'date' });
  assert.equal(result.status, 'SUCCESS', result.reason);
  assert.equal(input.value, '2025/09/15');
});

test('Date precision：full-date 不能把 2025-09 与 2025-09-15 错误判为 SUCCESS', async () => {
  const document = makeDocument();
  const input = attach(document, new FakeInput('date', { value: '2025-09-15' }));
  const field = descriptor('date', input, { inputType: 'date' });
  const result = await execute(field, '2025-09', { fieldPath: 'basic.birthday', expectedType: 'date' });
  assert.notEqual(result.status, 'SUCCESS');
});

test('Date Picker：direct write 不被接受时继续 picker strategy，而非直接 FAILED', async () => {
  const fixture = monthPickerFixture({ rejectDirectWrite: true, displayYear: 2025, controlKind: 'month', inputType: 'text' });
  const result = await execute(fixture.field, '2025-09', { fieldPath: 'education[].enrollmentDate', expectedType: 'date' });
  assert.equal(result.status, 'SUCCESS', result.reason);
  assert.equal(fixture.opened, true);
  assert.equal(fixture.input.value, '2025-09');
  assert.equal(fixture.months[8].clickCount, 1);
  assert.match(result.strategy || '', /picker|month/i);
});

test('Date Picker：年份导航到目标年后选择月份，且步数有界', async () => {
  const fixture = monthPickerFixture({ rejectDirectWrite: true, displayYear: 2023, controlKind: 'month', inputType: 'text' });
  const result = await execute(fixture.field, '2025-09', { fieldPath: 'education[].enrollmentDate', expectedType: 'date' });
  assert.equal(result.status, 'SUCCESS', result.reason);
  assert.equal(fixture.year, 2025);
  assert.equal(fixture.next.clickCount, 2);
  assert.equal(fixture.previous.clickCount, 0);
  assert.equal(fixture.months[8].clickCount, 1);
});

test('Date Picker readonly：只通过可靠 picker 操作，禁止绕过 readonly 直接 setter', async () => {
  const fixture = monthPickerFixture({ readOnly: true, displayYear: 2025, controlKind: 'month', inputType: 'text' });
  const attemptsBefore = fixture.input.nativeWriteAttempts;
  const result = await execute(fixture.field, '2025-09', { fieldPath: 'education[].enrollmentDate', expectedType: 'date' });
  assert.equal(result.status, 'SUCCESS', result.reason);
  assert.equal(fixture.input.nativeWriteAttempts, attemptsBefore);
  assert.equal(fixture.input.value, '2025-09');
  assert.equal(fixture.months[8].clickCount, 1);
});

test('Date Picker Safety：update-profile 不能因 class 包含 date 子串被当作日期触发器', async () => {
  const document = makeDocument();
  const input = new FakeInput('text', { readOnly: true });
  const updateProfile = new FakeNode('BUTTON', {
    type: 'button',
    className: 'update-profile',
    textContent: '更新资料',
    attributes: { role: 'button' },
  });
  const container = new FakeNode('DIV', { className: 'profile-field' });
  container.children = [input, updateProfile];
  container.querySelectorAll = selector => selectorText(selector).includes('[class*="date"]')
    ? [updateProfile]
    : [];
  input.parentElement = container;
  updateProfile.parentElement = container;
  attach(document, input, updateProfile, container);
  const field = descriptor('month', input, {
    interactionElement: input,
    inputType: 'text',
    readOnly: true,
    type: 'month',
  });

  const result = await execute(field, '2025-09', {
    fieldPath: 'education[].enrollmentDate', expectedType: 'date',
  });

  assert.notEqual(result.status, 'SUCCESS');
  assert.equal(updateProfile.clickCount, 0, '更新资料按钮绝不能被日期 Adapter 误点');
  assert.equal(input.value, '');
});

test('Date Picker Safety：school-picker 等通用业务选择器不能被当作日期触发器', async () => {
  const document = makeDocument();
  const input = new FakeInput('text', { readOnly: true });
  const schoolPicker = new FakeNode('BUTTON', {
    type: 'button',
    className: 'school-picker',
    textContent: '选择学校',
    attributes: { role: 'button' },
  });
  const container = new FakeNode('DIV', { className: 'school-field' });
  container.children = [input, schoolPicker];
  container.querySelectorAll = selector => selectorText(selector).includes('button') ? [schoolPicker] : [];
  input.parentElement = container;
  schoolPicker.parentElement = container;
  attach(document, input, schoolPicker, container);
  const field = descriptor('month', input, { inputType: 'text', readOnly: true });

  const result = await execute(field, '2025-09', {
    fieldPath: 'education[].enrollmentDate', expectedType: 'date',
  });

  assert.notEqual(result.status, 'SUCCESS');
  assert.equal(schoolPicker.clickCount, 0, '学校选择器绝不能被日期 Adapter 误点');
  assert.equal(input.value, '');
});

test('Date Picker Safety：存在两个日期面板时只允许操作本次触发后出现的目标面板', async () => {
  const fixture = monthPickerFixture({ readOnly: true, displayYear: 2025, controlKind: 'month', inputType: 'text' });
  let unrelatedValue = '';
  const unrelatedMonth = new FakeNode('DIV', {
    className: 'month-cell',
    textContent: '9月',
    attributes: { role: 'option' },
    onClick() { unrelatedValue = '2025-09'; },
  });
  const unrelatedPanel = new FakeNode('DIV', {
    className: 'unrelated-month-picker-panel',
    textContent: '2025年 9月',
    attributes: { role: 'dialog' },
  });
  unrelatedPanel.innerText = unrelatedPanel.textContent;
  unrelatedPanel.children = [unrelatedMonth];
  unrelatedMonth.parentElement = unrelatedPanel;
  attach(fixture.document, unrelatedPanel, unrelatedMonth);
  fixture.document.overlays.unshift(unrelatedPanel);

  const result = await execute(fixture.field, '2025-09', {
    fieldPath: 'education[].enrollmentDate', expectedType: 'date',
  });

  assert.equal(result.status, 'SUCCESS', result.reason);
  assert.equal(fixture.input.value, '2025-09');
  assert.equal(fixture.months[8].clickCount, 1, '应点击目标面板的 9 月');
  assert.equal(unrelatedMonth.clickCount, 0, '不得操作执行前已经存在的无关日期面板');
  assert.equal(unrelatedValue, '');
});

test('Date Picker fail-closed：readonly 且无可靠 picker 时不写并 NEEDS_CONFIRMATION', async () => {
  const fixture = monthPickerFixture({ readOnly: true, noTrigger: true, controlKind: 'month', inputType: 'text' });
  const result = await execute(fixture.field, '2025-09', { fieldPath: 'education[].enrollmentDate', expectedType: 'date' });
  assert.equal(result.status, 'NEEDS_CONFIRMATION');
  assert.equal(fixture.input.value, '');
  assert.equal(fixture.input.nativeWriteAttempts, 0);
});

test('Date Picker 年份超出最大可靠导航步数时停止，不得无限点击', async () => {
  const fixture = monthPickerFixture({ rejectDirectWrite: true, displayYear: 2025, controlKind: 'month', inputType: 'text' });
  const result = await execute(fixture.field, '2090-09', {
    fieldPath: 'education[].enrollmentDate', expectedType: 'date', maxYearNavigationSteps: 30,
  });
  assert.notEqual(result.status, 'SUCCESS');
  assert.ok(fixture.next.clickCount <= 30, `年份导航点击 ${fixture.next.clickCount} 次`);
});

test('Compound Picker：统一 Adapter 返回 NEEDS_CONFIRMATION 且 display input 保持原值', async () => {
  const document = makeDocument();
  const input = attach(document, new FakeInput('text', { value: '页面原值' }));
  const field = descriptor('compound-picker', input, { type: 'compound-picker' });
  const result = await execute(field, '目标学校', { fieldPath: 'education[].school' });
  assert.equal(result.status, 'NEEDS_CONFIRMATION');
  assert.equal(input.value, '页面原值');
  assert.equal(input.events.length, 0);
});

test('重复执行保护：已存在语义等价的学制/boolean JQX 值均 SKIPPED_EXISTING', async () => {
  for (const [initial, expected, fieldPath] of [
    ['四年制', 4, 'education[].studyDuration'],
    ['否', false, 'education[].eliteTrainingBase'],
  ]) {
    const fixture = customSelectFixture('jqx', ['是', '否', '三年制', '四年制'], { initialValue: initial });
    const result = await Form.fill(fixture.field, expected, { allowOverwrite: false, fieldPath, expectedType: 'choice' });
    assert.equal(result.status, 'SKIPPED_EXISTING', `${fieldPath}: ${result.reason}`);
    assert.equal(fixture.trigger.clickCount, 0);
    assert.equal(fixture.optionNodes.every(node => node.clickCount === 0), true);
  }
});
