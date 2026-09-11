import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Detector = require('../../src/core/field-detector.js');
const Matcher = require('../../src/core/field-matcher.js');
const Fields = require('../../src/mappings/field-aliases.js');

function staticCell(text = '') {
  return {
    tagName: 'TD',
    textContent: text,
    parentElement: null,
    querySelector() { return null; },
    querySelectorAll() { return []; },
    matches(selector) { return selector.split(',').some(part => part.trim().toLowerCase() === 'td'); },
    cloneNode() {
      return { textContent: text, querySelectorAll() { return []; } };
    },
  };
}

function tableRowField(label) {
  const labelCell = staticCell(label);
  const controlCell = staticCell('');
  const row = {
    tagName: 'TR',
    children: [labelCell, controlCell],
    matches(selector) { return selector.split(',').some(part => part.trim().toLowerCase() === 'tr'); },
  };
  labelCell.parentElement = row;
  controlCell.parentElement = row;
  controlCell.previousElementSibling = labelCell;
  return {
    parentElement: controlCell,
    closest(selector) { return selector === 'td,th' ? controlCell : null; },
  };
}

function diagnosedField(labelText, id, controlKind = 'text', overrides = {}) {
  return {
    detectorId: `tongji-${id}`,
    element: null,
    section: 'other',
    tagName: controlKind === 'native-select' ? 'select' : 'input',
    type: controlKind,
    controlKind,
    inputType: controlKind === 'native-select' ? 'select-one' : 'text',
    id,
    name: id,
    placeholder: '',
    ariaLabel: '',
    title: '',
    labelText,
    tableHeader: '',
    parentText: '',
    nearbyText: '',
    groupText: '',
    visible: true,
    hidden: false,
    disabled: false,
    readOnly: false,
    options: [],
    ...overrides,
  };
}

test('同济表格行的前置静态 td 被提升为字段 label，而不是低权重附近文字', () => {
  const field = tableRowField('姓名拼音*');
  assert.equal(Detector.tableRowLabelFor(field), '姓名拼音*');
  assert.equal(Detector.associatedLabel(field), '姓名拼音*');
});

test('同济基本信息诊断结构在 unknown/other 栏目下仍按真实行标签可靠映射', () => {
  const resume = {
    personal: {
      name: '示例同学',
      name_pinyin: 'SHI LI TONG XUE',
      ethnicity: '汉族',
      marital: '未婚',
      political: '群众',
      military_status: '非军人',
      household_address: '示例户籍地址',
      archive_unit: '示例档案单位',
      archive_address: '示例档案地址',
      archive_postcode: '200000',
      address: '示例通讯地址',
      postcode: '200001',
      fixed_phone: '021-00000000',
      phone: '13000000000',
      email: 'example@example.test',
    },
  };
  const cases = [
    ['姓名*', 'xm', 'text', 'basic.name'],
    ['姓名拼音*', 'xmpy', 'text', 'basic.namePinyin'],
    ['民族*', 'mz', 'native-select', 'basic.ethnicity'],
    ['婚否*', 'hfm', 'native-select', 'basic.marital'],
    ['政治面貌*', 'zzmmm', 'native-select', 'basic.political'],
    ['现役军人码*', 'xyjrm', 'native-select', 'basic.militaryStatus'],
    ['户口所在地详细地址*', 'hkszdxxdz', 'text', 'basic.householdAddress'],
    ['档案所在单位*', 'daszdw', 'text', 'contact.archiveOrganization'],
    ['档案所在单位地址*', 'daszdwdz', 'text', 'contact.archiveAddress'],
    ['档案所在单位邮政编码*', 'daszdwyzbm', 'text', 'contact.archivePostcode'],
    ['通讯地址*', 'txdz', 'text', 'contact.address'],
    ['通信地址邮政编码*', 'yzbm', 'text', 'contact.postcode'],
    ['固定电话', 'lxdh', 'text', 'contact.landline'],
    ['移动电话*', 'yddh', 'text', 'contact.phone'],
    ['考生电子邮箱*', 'dzxx', 'text', 'contact.email'],
  ];
  const descriptors = cases.map(([label, id, kind]) => diagnosedField(label, id, kind));
  const matches = Matcher.matchFields(descriptors, resume, { section: 'other' });
  matches.forEach((match, index) => {
    assert.equal(match.status, 'MATCHED', `${cases[index][0]}: ${match.reason}`);
    assert.equal(match.matchedPath, cases[index][3]);
    assert.ok(match.score >= 62, `${cases[index][0]} score=${match.score}`);
  });

  const backup = Matcher.matchField(diagnosedField('备用信息', 'byxx1'), resume, { section: 'unknown' });
  assert.equal(backup.status, 'UNMATCHED');
  assert.equal(backup.matchedPath, null);
});

test('Resume 解析兼容同济基本信息所需 snake_case 字段', () => {
  const view = Fields.buildResumeView({
    personal: {
      name_pinyin: 'ZHANG SAN',
      military_status: '非军人',
      hukou_address: '示例户籍地址',
      fixed_phone: '021-00000000',
      archive_organization: '示例档案单位',
      archive_address: '示例档案地址',
      archive_postcode: '200000',
    },
  });
  assert.equal(view.basic.namePinyin, 'ZHANG SAN');
  assert.equal(view.basic.militaryStatus, '非军人');
  assert.equal(view.basic.householdAddress, '示例户籍地址');
  assert.equal(view.contact.landline, '021-00000000');
  assert.equal(view.contact.archiveOrganization, '示例档案单位');
  assert.equal(view.contact.archiveAddress, '示例档案地址');
  assert.equal(view.contact.archivePostcode, '200000');
});

test('身份证掩码、disabled/readOnly 展示与歧义字段保持零填写', () => {
  assert.equal(Detector.isMaskedIdentityDisplay('身份证号码 idNumber', '************3913'), true);
  assert.equal(Detector.isMaskedIdentityDisplay('姓名', '张*'), false);
  const resume = { basic: { idNumber: '110000000000000000' } };
  const masked = Matcher.matchField(diagnosedField('身份证号码', 'sfzh', 'text', {
    maskedDisplay: true,
  }), resume, { section: 'other' });
  const readOnly = Matcher.matchField(diagnosedField('身份证号码', 'sfzh-view', 'text', {
    readOnly: true,
  }), resume, { section: 'other' });
  const disabled = Matcher.matchField(diagnosedField('身份证号码', 'sfzh-disabled', 'text', {
    disabled: true,
  }), resume, { section: 'other' });
  [masked, readOnly, disabled].forEach(match => {
    assert.equal(match.status, 'SKIPPED');
    assert.equal(match.matchedPath, null);
  });
});
