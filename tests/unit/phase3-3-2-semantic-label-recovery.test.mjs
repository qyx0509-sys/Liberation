import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Detector = require('../../src/core/field-detector.js');
const Matcher = require('../../src/core/field-matcher.js');

function staticTextNode(text, className = '') {
  return {
    tagName: 'DIV',
    className,
    textContent: text,
    innerText: text,
    childNodes: [{ nodeType: 3, textContent: text }],
    contains() { return false; },
    getAttribute() { return null; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    cloneNode() {
      return {
        textContent: text,
        querySelectorAll() { return []; },
      };
    },
  };
}

function semanticInput({
  formLabel = '',
  siblingLabel = '',
  placeholder = '',
  metadata = null,
  ariaLabel = '',
  multipleControls = false,
} = {}) {
  const labelNode = formLabel ? staticTextNode(formLabel, 'ant-form-item-label') : null;
  const siblingNode = siblingLabel ? staticTextNode(siblingLabel, 'semantic-label-column') : null;
  const group = {
    tagName: 'DIV',
    className: formLabel ? 'ant-form-item' : 'ant-row local-form-row',
    dataset: {},
    parentElement: null,
    childNodes: [],
    contains(node) { return node === input || node === labelNode || node === siblingNode; },
    getAttribute() { return null; },
    querySelector(selector) {
      if (formLabel && /label|form-item-label/.test(selector)) return labelNode;
      return null;
    },
    querySelectorAll(selector) {
      if (selector === Detector.STANDARD_SELECTOR) {
        return multipleControls ? [input, { tagName: 'INPUT', type: 'text' }] : [input];
      }
      if (/label|caption/.test(selector)) {
        if (formLabel) return [labelNode];
        if (siblingLabel) return [siblingNode];
      }
      return [];
    },
  };
  const control = {
    tagName: 'DIV', className: 'ant-form-item-control', dataset: {}, parentElement: group,
    getAttribute() { return null; }, querySelector() { return null; }, querySelectorAll() { return []; },
  };
  const metadataNode = metadata ? {
    tagName: 'DIV', className: 'field-shell', dataset: {}, parentElement: group,
    getAttribute(name) { return name === metadata.name ? metadata.value : null; },
    querySelector() { return null; }, querySelectorAll() { return []; },
  } : null;
  const attributes = new Map();
  if (ariaLabel) attributes.set('aria-label', ariaLabel);
  const input = {
    tagName: 'INPUT', type: 'text', id: '', name: '', placeholder,
    value: '', disabled: false, readOnly: false, required: false, multiple: false,
    hidden: false, isContentEditable: false, labels: [], dataset: {},
    parentElement: metadataNode || control,
    ownerDocument: {
      defaultView: {
        getComputedStyle() { return { display: 'block', visibility: 'visible', position: 'static' }; },
        CSS: { escape(value) { return String(value); } },
      },
      getElementById() { return null; }, querySelector() { return null; }, querySelectorAll() { return []; },
    },
    getAttribute(name) { return attributes.get(name) ?? null; },
    matches(selector) {
      if (selector.includes('input[type="hidden"]')) return false;
      if (selector.includes('input')) return true;
      return false;
    },
    closest(selector) {
      if (selector === 'label' || /td,th/.test(selector)) return null;
      if (/ant-form-item|form-row|form-item|role="group"|fieldset|\btr\b/.test(selector)) return group;
      return null;
    },
    querySelector() { return null; }, querySelectorAll() { return []; },
    getBoundingClientRect() { return { width: 240, height: 32 }; },
  };
  if (metadataNode) metadataNode.contains = node => node === input;
  return Detector.buildDescriptor(input, 0, { section: 'basic' });
}

function basicContext() {
  return {
    section: 'basic', sectionId: 'basic', collection: 'basic',
    collectionMode: 'record', confidence: 0.96, source: 'page-heading',
  };
}

const resume = {
  basic: {
    name: '示例同学',
    idNumber: '310000200001010000',
    birthday: '2000-01-01',
  },
  contact: { phone: '13800000000' },
  education: [{ enrollmentDate: '2021-09', graduationDate: '2025-06' }],
};

test('Semantic Label: Ant form-item label 提取姓名并记录来源', () => {
  const descriptor = semanticInput({ formLabel: '姓名', placeholder: '请输入姓名' });
  assert.equal(descriptor.labelText, '姓名');
  assert.equal(descriptor.labelSource, 'form-item-label');
  const match = Matcher.matchField(descriptor, resume, { sectionContext: basicContext() });
  assert.equal(match.status, 'MATCHED', match.reason);
  assert.equal(match.matchedPath, 'basic.name');
});

test('Semantic Label: 同一局部 form row 的 sibling label 可识别证件号码', () => {
  const descriptor = semanticInput({ siblingLabel: '证件号码' });
  assert.equal(descriptor.labelText, '证件号码');
  assert.equal(descriptor.labelSource, 'form-row-sibling');
  const match = Matcher.matchField(descriptor, resume, { sectionContext: basicContext() });
  assert.equal(match.status, 'MATCHED', match.reason);
  assert.equal(match.matchedPath, 'basic.idNumber');
});

test('Semantic Label: prompt stripping 仅作 semantic-placeholder fallback', () => {
  const phone = semanticInput({ placeholder: '请输入移动电话' });
  assert.equal(phone.labelText, '');
  assert.equal(phone.semanticPlaceholder, '移动电话');
  assert.equal(phone.labelSource, 'semantic-placeholder');
  const phoneMatch = Matcher.matchField(phone, resume, { sectionContext: basicContext() });
  assert.equal(phoneMatch.status, 'MATCHED', phoneMatch.reason);
  assert.equal(phoneMatch.matchedPath, 'contact.phone');

  const birthday = semanticInput({ placeholder: '请选择出生日期' });
  const birthdayMatch = Matcher.matchField(birthday, resume, { sectionContext: basicContext() });
  assert.equal(birthdayMatch.status, 'MATCHED', birthdayMatch.reason);
  assert.equal(birthdayMatch.matchedPath, 'basic.birthday');
});

test('Semantic Label: 白名单 metadata 向上有界读取入学/毕业年月', () => {
  for (const [caption, expected] of [
    ['入学年月', 'education[].enrollmentDate'],
    ['预计毕业年月', 'education[].graduationDate'],
  ]) {
    const descriptor = semanticInput({ metadata: { name: 'data-caption', value: caption } });
    assert.equal(descriptor.labelText, caption);
    assert.equal(descriptor.labelSource, 'ancestor-data-caption');
    const match = Matcher.matchField(descriptor, resume, { sectionContext: basicContext() });
    assert.equal(match.status, 'MATCHED', `${caption}: ${match.reason}`);
    assert.equal(match.matchedPath, expected);
  }
});

test('Semantic Label: 真实 label 始终覆盖相冲突 placeholder', () => {
  const descriptor = semanticInput({ formLabel: '姓名', placeholder: '请输入移动电话' });
  assert.equal(descriptor.labelText, '姓名');
  assert.equal(descriptor.semanticPlaceholder, '');
  const match = Matcher.matchField(descriptor, resume, { sectionContext: basicContext() });
  assert.equal(match.status, 'MATCHED', match.reason);
  assert.equal(match.matchedPath, 'basic.name');
});

test('Semantic Label: 多控件外层 row 不得向相邻字段借 sibling label', () => {
  const descriptor = semanticInput({ siblingLabel: '证件号码', multipleControls: true });
  assert.equal(descriptor.labelText, '');
  assert.equal(descriptor.labelSource, '');
});
