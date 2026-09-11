import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Structures = require('../../src/mappings/section-structures.js');
const Resolver = require('../../src/core/current-section-resolver.js');
const ArrayHandler = require('../../src/core/array-handler.js');

function textNode(text) {
  return {
    innerText: text,
    textContent: text,
    getAttribute() { return null; },
  };
}

function makeTable(headers) {
  const table = {
    hidden: false,
    nodeType: 1,
    parentElement: null,
    ownerDocument: null,
    matches(selector) { return /table|role="table"/.test(selector); },
    getAttribute() { return null; },
    getBoundingClientRect() { return { width: 640, height: 160 }; },
    querySelectorAll(selector) {
      if (/th|columnheader|first-child/.test(selector)) return headers.map(textNode);
      if (/button|input\[type="button"\]|(^|,)a(,|$)/.test(selector)) return [];
      return [];
    },
    get innerText() { return headers.join(' '); },
    get textContent() { return headers.join(' '); },
  };
  return table;
}

function makeDocument(tables) {
  const doc = {
    nodeType: 9,
    body: {},
    defaultView: {
      getComputedStyle() {
        return { display: 'block', visibility: 'visible', opacity: '1' };
      },
    },
    querySelectorAll(selector) {
      if (/table|fieldset|repeat-list|array-list|role="table"/.test(selector)) return tables;
      return [];
    },
  };
  for (const table of tables) {
    table.ownerDocument = doc;
  }
  return doc;
}

function descriptor(label) {
  return {
    detectorId: label,
    visible: true,
    hidden: false,
    labelText: '',
    tableHeader: label,
    ariaLabel: '',
    placeholder: '',
    groupText: '',
    nearbyText: '',
    parentText: '',
  };
}

test('internship / internships 必须归一到同一 canonical section', () => {
  assert.equal(Structures.canonicalSectionId('internship'), 'internships');
  assert.equal(Structures.canonicalSectionId('internships'), 'internships');
});

test('Resolver 不得同时输出 internship 和 internships 两个 embedded 执行上下文', () => {
  const internshipTable = makeTable(['起始年月', '结束年月', '学习工作单位', '担任职务']);
  const document = makeDocument([internshipTable]);

  const resolved = Resolver.resolve({
    document,
    fields: [
      descriptor('所在学校'),
      descriptor('所在院系'),
      descriptor('所在专业'),
      descriptor('在校生注册学号'),
      descriptor('担任职务'),
      descriptor('开始时间'),
      descriptor('结束时间'),
    ],
    adapterContext: { section: 'basic', score: 1 },
  });

  const internshipRegions = resolved.regionCandidates.filter(item => item.collection === 'internships');
  assert.equal(internshipRegions.length, 1);
  assert.equal(internshipRegions[0].sectionId, 'internships');
});

test('ArrayHandler 用 singular internship 也必须定位到 internships 表格，而不是退化到整页 root', () => {
  const internshipTable = makeTable(['起始年月', '结束年月', '学习工作单位', '担任职务']);
  const document = makeDocument([internshipTable]);

  assert.equal(ArrayHandler.detectSectionTable(document, 'internship'), internshipTable);
  assert.equal(ArrayHandler.detectSectionTable(document, 'internships'), internshipTable);
});

test('awards 区域允许旧系统只有“添加”两个字的新增按钮文案', () => {
  assert.equal(Structures.definitionForSection('awards').addPattern.test('添加'), true);
  assert.equal(ArrayHandler.ADD_PATTERNS.awards.test('添加'), true);
  assert.equal(ArrayHandler.ADD_PATTERNS.awards.test('删除'), false);
});
