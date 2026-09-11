import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Matcher = require('../../src/core/field-matcher.js');

function context(collection, collectionMode = 'record', index = null) {
  return {
    section: collection,
    sectionId: collection,
    collection,
    collectionMode,
    confidence: 0.96,
    source: collection === 'basic' ? 'page-heading' : 'embedded-structure',
    index,
    indexContext: Number.isInteger(index) ? { section: collection, collection, index, [collection]: index } : null,
  };
}

function field(labelText, fieldContext, options = {}) {
  return {
    detectorId: `${fieldContext.collection}-${labelText}`,
    element: {}, elements: [{}], visible: true, hidden: false, disabled: false, readOnly: false,
    controlKind: options.controlKind || 'text', baseControlKind: options.controlKind || 'text', inputType: 'text',
    labelText: options.labelSource === 'semantic-placeholder' ? '' : labelText,
    labelSource: options.labelSource || 'form-item-label',
    semanticPlaceholder: options.labelSource === 'semantic-placeholder' ? labelText : '',
    placeholder: options.placeholder || '',
    tableHeader: options.tableHeader || '', ariaLabel: '', title: '', name: '', id: '',
    groupText: '', nearbyText: '', parentText: '', options: [], context: fieldContext,
  };
}

const resume = {
  basic: { name: '示例同学' },
  contact: { phone: '13800000000' },
  education: [{ college: '计算机学院', enrollmentDate: '2021-09', graduationDate: '2025-06' }],
  family: [{ name: '示例家长' }],
};

test('Compound Page: main basic 仍稳定匹配 basic.name 和 contact.phone', () => {
  const name = Matcher.matchField(field('姓名', context('basic')), resume);
  assert.equal(name.status, 'MATCHED', name.reason);
  assert.equal(name.matchedPath, 'basic.name');

  const phone = Matcher.matchField(field('移动电话', context('basic'), {
    labelSource: 'semantic-placeholder', placeholder: '请输入移动电话',
  }), resume);
  assert.equal(phone.status, 'MATCHED', phone.reason);
  assert.equal(phone.matchedPath, 'contact.phone');
});

test('Compound Page: 强明确 education 语义跨越 main basic 并复用 singleton index 0', () => {
  for (const [label, path] of [
    ['本科院系', 'education[].college'],
    ['入学时间', 'education[].enrollmentDate'],
    ['毕业时间', 'education[].graduationDate'],
  ]) {
    const match = Matcher.matchField(field(label, context('basic')), resume);
    assert.equal(match.status, 'MATCHED', `${label}: ${match.reason}`);
    assert.equal(match.matchedPath, path);
    assert.equal(match.scope?.collection, 'education');
    assert.equal(match.scope?.collectionMode, 'singleton-view');
    assert.equal(match.scope?.index, 0);
  }
});

test('Compound Page: repeatable family 姓名只在真实 group context/index 内匹配', () => {
  const family = Matcher.matchField(field('姓名', context('family', 'repeatable', 0), { tableHeader: '姓名' }), resume);
  assert.equal(family.status, 'MATCHED', family.reason);
  assert.equal(family.matchedPath, 'family[].name');

  const basic = Matcher.matchField(field('姓名', context('basic')), resume);
  assert.equal(basic.matchedPath, 'basic.name');
  assert.notEqual(basic.matchedPath, 'family[].name');
});

test('Compound Page: 无 repeatable context 的通用姓名不得跨到 family[]', () => {
  const ambiguous = field('姓名', context('basic'));
  const result = Matcher.matchField(ambiguous, { family: [{ name: '家长' }] });
  assert.notEqual(result.matchedPath, 'family[].name');
  assert.notEqual(result.status, 'MATCHED');
});

