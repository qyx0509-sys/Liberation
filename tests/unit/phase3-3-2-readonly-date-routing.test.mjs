import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Detector = require('../../src/core/field-detector.js');
const Matcher = require('../../src/core/field-matcher.js');
const Registry = require('../../src/controls/control-adapter-registry.js');

function trigger(name = '日历') {
  return {
    tagName: 'BUTTON', type: 'button', className: 'calendar-trigger', textContent: name,
    disabled: false, hidden: false, isConnected: true, clickCount: 0,
    getAttribute(attribute) {
      if (attribute === 'type') return 'button';
      if (attribute === 'aria-label') return name;
      return null;
    },
    getBoundingClientRect() { return { width: 24, height: 24 }; },
    click() { this.clickCount += 1; }, focus() {}, dispatchEvent() { return true; },
  };
}

function readonlyDescriptor(placeholder, options = {}) {
  const dateTrigger = options.datePickerTrigger || null;
  const element = {
    tagName: 'INPUT', type: 'text', value: '', readOnly: true, disabled: false,
    hidden: false, isConnected: true,
    parentElement: options.parentElement || null,
    ownerDocument: options.ownerDocument || {
      defaultView: { requestAnimationFrame(callback) { callback(); } },
      querySelectorAll() { return []; }, getElementById() { return null; }, body: null, documentElement: null,
    },
    getAttribute(name) {
      if (name === 'placeholder') return placeholder;
      if (name === 'readonly') return '';
      return null;
    },
    getBoundingClientRect() { return { width: 220, height: 32 }; },
  };
  return {
    detectorId: placeholder,
    element,
    interactionElement: element,
    elements: [element],
    visible: true,
    hidden: false,
    disabled: false,
    readOnly: true,
    controlKind: options.controlKind || 'text',
    baseControlKind: options.controlKind || 'text',
    inputType: options.inputType || 'text',
    labelText: '',
    labelSource: 'semantic-placeholder',
    semanticPlaceholder: placeholder.replace(/^(?:请输入|请填写|请选择|选择|请选取|请录入)/, ''),
    placeholder,
    ariaLabel: '', tableHeader: '', title: '', name: '', id: '', groupText: '', nearbyText: '', parentText: '',
    options: [],
    datePickerTrigger: dateTrigger,
    datePickerAmbiguous: Boolean(options.datePickerAmbiguous),
    interactiveReadonly: options.interactiveReadonly ?? Boolean(dateTrigger || options.datePickerAmbiguous),
    readonlyInteractionKind: options.readonlyInteractionKind || (dateTrigger || options.datePickerAmbiguous ? 'date-like' : ''),
    context: options.context,
  };
}

const resume = {
  basic: { birthday: '2000-01-01' },
  education: [{ enrollmentDate: '2021-09', graduationDate: '2025-06', schoolCode: '10001' }],
};
const basicContext = {
  section: 'basic', sectionId: 'basic', collection: 'basic', collectionMode: 'record',
  confidence: 0.96, source: 'page-heading',
};

test('ReadOnly Date: FieldDetector 仅在局部日期语义 + 可靠 trigger 同时存在时标记可交互', () => {
  const calendar = trigger('选择出生日期');
  const parent = {
    tagName: 'DIV', className: 'ant-picker local-date-control', dataset: {}, parentElement: null,
    getAttribute() { return null; },
    querySelector() { return null; },
    querySelectorAll(selector) { return /button|calendar|picker/.test(selector) ? [calendar] : []; },
  };
  calendar.parentElement = parent;
  const attributes = new Map([['placeholder', '请选择出生日期'], ['readonly', '']]);
  const input = {
    tagName: 'INPUT', type: 'text', value: '', id: '', name: '', placeholder: '请选择出生日期',
    readOnly: true, disabled: false, required: false, multiple: false, hidden: false,
    isContentEditable: false, labels: [], dataset: {}, parentElement: parent,
    ownerDocument: {
      defaultView: {
        getComputedStyle() { return { display: 'block', visibility: 'visible', position: 'static' }; },
        CSS: { escape(value) { return String(value); } },
      },
      getElementById() { return null; }, querySelector() { return null; }, querySelectorAll() { return []; },
    },
    getAttribute(name) { return attributes.get(name) ?? null; },
    matches(selector) { return selector.includes('input') && !selector.includes('hidden'); },
    closest() { return null; }, querySelector() { return null; }, querySelectorAll() { return []; },
    getBoundingClientRect() { return { width: 220, height: 32 }; },
  };
  const descriptor = Detector.buildDescriptor(input, 0, { section: 'basic' });
  assert.equal(descriptor.readOnly, true);
  assert.equal(descriptor.interactiveReadonly, true);
  assert.equal(descriptor.readonlyInteractionKind, 'date-like');
  assert.equal(descriptor.datePickerTrigger, calendar);
});

test('ReadOnly Date: Ant picker 容器与显式日历按钮同时命中时优先绑定真实按钮', () => {
  const calendar = trigger('选择出生日期');
  calendar.getAttribute = function getAttribute(attribute) {
    if (attribute === 'type') return 'button';
    if (attribute === 'aria-label') return '选择出生日期';
    if (attribute === 'aria-controls') return 'birthday-panel';
    return null;
  };
  const parent = {
    tagName: 'DIV', className: 'ant-form-item-control ant-picker', dataset: {}, parentElement: null,
    hidden: false, disabled: false,
    getAttribute() { return null; },
    closest() { return null; },
    querySelector() { return null; },
    matches() { return false; },
    querySelectorAll(selector) { return /button|calendar|picker|aria-controls/.test(selector) ? [calendar] : []; },
  };
  const otherCalendar = trigger('选择入学时间');
  const fieldset = {
    tagName: 'FIELDSET', className: '', parentElement: null,
    matches(selector) { return selector.includes('fieldset'); },
    querySelectorAll(selector) { return /button|calendar|picker|aria-controls/.test(selector) ? [parent, calendar, otherCalendar] : []; },
  };
  const formItem = {
    tagName: 'DIV', className: 'ant-form-item', parentElement: fieldset,
    matches(selector) { return selector.includes('.ant-form-item') || selector.includes('[class*="form-item"]'); },
    querySelectorAll(selector) { return /button|calendar|picker|aria-controls/.test(selector) ? [parent, calendar] : []; },
  };
  parent.parentElement = formItem;
  calendar.parentElement = parent;
  otherCalendar.parentElement = fieldset;
  const input = {
    tagName: 'INPUT', type: 'text', value: '', id: 'birthday', name: '', placeholder: '请选择出生日期',
    readOnly: true, disabled: false, required: false, multiple: false, hidden: false,
    isContentEditable: false, labels: [], dataset: {}, parentElement: parent,
    ownerDocument: {
      defaultView: {
        getComputedStyle() { return { display: 'block', visibility: 'visible', position: 'static' }; },
        CSS: { escape(value) { return String(value); } },
      },
      getElementById() { return null; }, querySelector() { return null; }, querySelectorAll() { return []; },
    },
    getAttribute(name) {
      if (name === 'placeholder') return '请选择出生日期';
      if (name === 'readonly') return '';
      return null;
    },
    matches(selector) { return selector.includes('input') && !selector.includes('hidden'); },
    closest(selector) {
      if (selector.includes('.ant-form-item')) return formItem;
      if (selector.includes('fieldset')) return fieldset;
      return null;
    },
    querySelector() { return null; }, querySelectorAll() { return []; },
    getBoundingClientRect() { return { width: 220, height: 32 }; },
  };
  const descriptor = Detector.buildDescriptor(input, 0, { section: 'basic' });
  assert.equal(descriptor.interactiveReadonly, true);
  assert.equal(descriptor.datePickerAmbiguous, false);
  assert.equal(descriptor.datePickerTrigger, calendar);
});

test('ReadOnly Date: 出生日期可进入匹配并路由 DateLikeAdapter', () => {
  const field = readonlyDescriptor('请选择出生日期', { datePickerTrigger: trigger(), context: basicContext });
  const match = Matcher.matchField(field, resume);
  assert.equal(match.status, 'MATCHED', match.reason);
  assert.equal(match.matchedPath, 'basic.birthday');
  assert.equal(Registry.resolve(field, { fieldPath: match.matchedPath, expectedType: 'date' }).adapterId, 'date-like');
});

test('ReadOnly Date: compound basic page 的入学/毕业时间路由 education singleton index 0', () => {
  for (const [placeholder, path] of [
    ['请选择入学时间', 'education[].enrollmentDate'],
    ['请选择毕业时间', 'education[].graduationDate'],
  ]) {
    const field = readonlyDescriptor(placeholder, { datePickerTrigger: trigger(), context: basicContext });
    const match = Matcher.matchField(field, resume);
    assert.equal(match.status, 'MATCHED', `${placeholder}: ${match.reason}`);
    assert.equal(match.matchedPath, path);
    assert.equal(match.scope?.collectionMode, 'singleton-view');
    assert.equal(match.scope?.index, 0);
  }
});

test('ReadOnly Date: 普通只读学校代码无 picker 仍 SKIPPED', () => {
  const field = readonlyDescriptor('学校代码', { context: basicContext, interactiveReadonly: false });
  field.semanticPlaceholder = '';
  field.labelText = '学校代码';
  field.labelSource = 'form-item-label';
  const match = Matcher.matchField(field, resume);
  assert.equal(match.status, 'SKIPPED');
  assert.match(match.reason, /只读/);
});

test('ReadOnly Date: 三个字段同页时只点击当前 descriptor 绑定的 trigger', async () => {
  const birthdayTrigger = trigger('出生日期日历');
  const enrollmentTrigger = trigger('入学时间日历');
  const graduationTrigger = trigger('毕业时间日历');
  const field = readonlyDescriptor('请选择入学时间', { datePickerTrigger: enrollmentTrigger, context: basicContext });
  const runtime = {
    canClickLikeUser(node) { return node === enrollmentTrigger; },
    clickLikeUser(node) { node.click(); return node === enrollmentTrigger; },
    readControlValue() { return ''; },
  };
  const result = await Registry.execute(field, '2021-09', {
    fieldPath: 'education[].enrollmentDate', expectedType: 'date', datePickerTimeoutMs: 1,
    dependencies: { EventDispatcher: runtime },
  });
  assert.equal(result.status, 'NEEDS_CONFIRMATION');
  assert.equal(birthdayTrigger.clickCount, 0);
  assert.equal(enrollmentTrigger.clickCount, 1);
  assert.equal(graduationTrigger.clickCount, 0);
});

test('ReadOnly Date: ambiguous local picker fail-closed 且不点击任何候选', async () => {
  const first = trigger('日历 A');
  const second = trigger('日历 B');
  const field = readonlyDescriptor('请选择出生日期', {
    datePickerAmbiguous: true, context: basicContext, parentElement: { querySelectorAll() { return [first, second]; } },
  });
  const runtime = {
    canClickLikeUser() { return true; }, clickLikeUser(node) { node.click(); return true; }, readControlValue() { return ''; },
  };
  const result = await Registry.execute(field, '2000-01-01', {
    fieldPath: 'basic.birthday', expectedType: 'date',
    dependencies: { EventDispatcher: runtime },
  });
  assert.equal(result.status, 'NEEDS_CONFIRMATION');
  assert.equal(first.clickCount + second.clickCount, 0);
});

test('ReadOnly Date: 日期控件外的图片查看器 Previous/Next 永不参与年份导航', async () => {
  const dateTrigger = trigger('入学时间日历');
  const viewerPrevious = trigger('Previous');
  viewerPrevious.className = 'image-viewer-previous';
  const viewer = {
    tagName: 'DIV', className: 'image-viewer-dialog', textContent: 'Previous Next', innerText: 'Previous Next',
    hidden: false, isConnected: true,
    getAttribute(name) { return name === 'role' ? 'dialog' : null; },
    getBoundingClientRect() { return { width: 400, height: 300 }; },
    querySelectorAll() { return [viewerPrevious]; },
  };
  viewerPrevious.parentElement = viewer;
  const document = {
    defaultView: {
      getComputedStyle() { return { display: 'block', visibility: 'visible', opacity: '1' }; },
      requestAnimationFrame(callback) { callback(); },
    },
    body: null, documentElement: null,
    querySelectorAll(selector) { return selector.includes('[role="dialog"]') ? [viewer] : []; },
    getElementById() { return null; },
  };
  const field = readonlyDescriptor('请选择入学时间', {
    datePickerTrigger: dateTrigger, context: basicContext, ownerDocument: document,
  });
  const runtime = {
    canClickLikeUser(node, settings) {
      return node === dateTrigger && settings?.purpose === 'date-picker-trigger';
    },
    clickLikeUser(node, settings) {
      if (!this.canClickLikeUser(node, settings)) return false;
      node.click();
      return true;
    },
    readControlValue() { return ''; },
  };
  const result = await Registry.execute(field, '2021-09', {
    fieldPath: 'education[].enrollmentDate', expectedType: 'date', datePickerTimeoutMs: 1,
    dependencies: { EventDispatcher: runtime },
  });
  assert.equal(result.status, 'NEEDS_CONFIRMATION');
  assert.equal(dateTrigger.clickCount, 1);
  assert.equal(viewerPrevious.clickCount, 0);
});
