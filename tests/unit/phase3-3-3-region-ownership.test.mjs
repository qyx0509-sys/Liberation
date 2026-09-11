import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const ArrayHandler = require('../../src/core/array-handler.js');
const Autofill = require('../../src/core/autofill-engine.js');
const EmbeddedSectionDetector = require('../../src/core/embedded-section-detector.js');
const FieldContext = require('../../src/core/field-context.js');

const REGION_SELECTOR = 'table,[role="table"],fieldset,[data-repeat-list],[data-array-list]';
const CONTROL_SELECTOR_FRAGMENT = /input|textarea|select|contenteditable|combobox|file/;

function selectorParts(selector) {
  return String(selector || '').split(',').map(part => part.trim()).filter(Boolean);
}

function isRegionSelector(selector) {
  return String(selector || '') === REGION_SELECTOR;
}

function isHeaderSelector(selector) {
  return /\bth\b|thead td|first-child td|columnheader/.test(String(selector || ''));
}

function isControlSelector(selector) {
  return CONTROL_SELECTOR_FRAGMENT.test(String(selector || ''));
}

function isActionSelector(selector) {
  return selectorParts(selector).some(part => [
    'button', '[role="button"]', 'a', 'input[type="button"]',
  ].includes(part));
}

function matchesSimple(node, selector) {
  const source = String(selector || '').trim().toLowerCase();
  if (!source) return false;
  if (source === 'table') return node.tagName === 'TABLE';
  if (source === 'fieldset') return node.tagName === 'FIELDSET';
  if (source === 'tbody') return node.tagName === 'TBODY';
  if (source === 'form') return node.tagName === 'FORM';
  if (source === 'tr') return node.tagName === 'TR';
  if (source === 'th') return node.tagName === 'TH';
  if (source === 'td') return node.tagName === 'TD';
  if (source === 'input') return node.tagName === 'INPUT';
  if (source === 'button') return node.tagName === 'BUTTON';
  if (source === 'a') return node.tagName === 'A';
  if (source === '[role="table"]') return node.getAttribute('role') === 'table';
  if (source === '[role="row"]') return node.getAttribute('role') === 'row';
  if (source === '[role="columnheader"]') return node.getAttribute('role') === 'columnheader';
  if (source === '[data-repeat-list]') return node.hasAttribute('data-repeat-list');
  if (source === '[data-array-list]') return node.hasAttribute('data-array-list');
  if (source === '[data-repeat-item]') return node.hasAttribute('data-repeat-item');
  if (source === '[data-array-item]') return node.hasAttribute('data-array-item');
  if (source.startsWith('#')) return node.id === source.slice(1);
  return false;
}

function makeElement(tagName, options = {}) {
  const attributes = new Map(Object.entries(options.attributes || {}));
  const node = {
    nodeType: 1,
    tagName: String(tagName).toUpperCase(),
    id: options.id || '',
    type: options.type || '',
    value: '',
    hidden: false,
    disabled: false,
    readOnly: false,
    isConnected: true,
    parentElement: null,
    ownerDocument: null,
    children: [],
    ownText: options.text || '',
    get innerText() {
      return [this.ownText, ...this.children.map(child => child.innerText || child.textContent || '')]
        .filter(Boolean).join(' ');
    },
    get textContent() { return this.innerText; },
    append(...children) {
      children.flat().filter(Boolean).forEach(child => {
        child.parentElement = this;
        child.ownerDocument = this.ownerDocument;
        this.children.push(child);
      });
      return this;
    },
    hasAttribute(name) { return attributes.has(name); },
    getAttribute(name) {
      if (name === 'id') return this.id || null;
      return attributes.has(name) ? attributes.get(name) : null;
    },
    matches(selector) {
      return selectorParts(selector).some(part => matchesSimple(this, part));
    },
    closest(selector) {
      let current = this;
      while (current) {
        if (current.matches?.(selector)) return current;
        current = current.parentElement;
      }
      return null;
    },
    contains(other) {
      let current = other;
      while (current) {
        if (current === this) return true;
        current = current.parentElement;
      }
      return false;
    },
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
    querySelectorAll(selector) {
      const descendants = [];
      const walk = current => current.children.forEach(child => {
        descendants.push(child);
        walk(child);
      });
      walk(this);

      if (isHeaderSelector(selector)) {
        return descendants.filter(child => child.tagName === 'TH' || child.getAttribute?.('role') === 'columnheader');
      }
      if (isActionSelector(selector)) {
        return descendants.filter(child => child.tagName === 'BUTTON'
          || child.tagName === 'A'
          || child.getAttribute?.('role') === 'button'
          || (child.tagName === 'INPUT' && child.type === 'button'));
      }
      if (isControlSelector(selector)) {
        return descendants.filter(child => ['INPUT', 'TEXTAREA', 'SELECT'].includes(child.tagName));
      }
      if (/table,tbody,form,\[role="table"\],\[data-repeat-list\],\[class\*="list"\],\[class\*="table"\]/.test(String(selector))) {
        return descendants.filter(child => ['TABLE', 'TBODY', 'FORM'].includes(child.tagName) || child.getAttribute?.('role') === 'table' || child.hasAttribute?.('data-repeat-list'));
      }
      if (/data-repeat-item|data-array-item|multi-item|dynamic-item|form-group-item|role="row"|fieldset/.test(String(selector))) {
        return descendants.filter(child => child.tagName === 'FIELDSET' || child.tagName === 'TR' || child.getAttribute?.('role') === 'row' || child.hasAttribute?.('data-repeat-item') || child.hasAttribute?.('data-array-item'));
      }
      return descendants.filter(child => selectorParts(selector).some(part => matchesSimple(child, part)));
    },
    getBoundingClientRect() { return { width: 600, height: 40, left: 0, top: 0 }; },
  };
  return node;
}

function input(label = '') {
  const control = makeElement('input', { type: 'text' });
  control.fieldLabel = label;
  return control;
}

function button(label = '') {
  const control = makeElement('button', { type: 'button', text: label });
  control.clickCount = 0;
  control.click = function click() { this.clickCount += 1; };
  return control;
}

function makeTable(id, headers, rowCount = 0) {
  const table = makeElement('table', { id });
  const headRow = makeElement('tr');
  headRow.append(headers.map(header => makeElement('th', { text: header })));
  table.append(headRow);
  const rows = [];
  for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
    const row = makeElement('tr');
    const controls = headers.map(header => input(header));
    row.append(controls);
    table.append(row);
    rows.push({ row, controls });
  }
  return { table, headRow, rows };
}

function attachDocument(root, regions) {
  const document = {
    nodeType: 9,
    location: { href: 'https://example.test/application' },
    defaultView: {
      getComputedStyle() { return { display: 'block', visibility: 'visible', opacity: '1' }; },
    },
    body: root,
    documentElement: root,
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
    querySelectorAll(selector) {
      if (isRegionSelector(selector)) return regions;
      return root.querySelectorAll(selector);
    },
  };
  const walk = node => {
    node.ownerDocument = document;
    node.children.forEach(walk);
  };
  walk(root);
  return document;
}

function autofillHarness(document, resumeView, sectionContext = {}) {
  const scanId = sectionContext.scanId || 'scan:repeatable-owner-red';
  const records = [];
  const harness = {
    document,
    config: { sections: {} },
    resume: resumeView,
    resumeView,
    task: { scanId },
    scanId,
    lastInspection: {
      scanId,
      sectionContext: {
        sectionId: 'basic',
        section: 'basic',
        collection: 'basic',
        collectionMode: 'record',
        source: 'test',
        confidence: 1,
        ...sectionContext,
      },
    },
    adapter: {
      diagnose() { return { section: {} }; },
    },
    reportManager: null,
    currentSectionRunIds: new Map(),
    progressionState: null,
    callbacks: { onLog() {} },
    async setState() {},
    record(_runId, item) { records.push(item); },
  };
  return { harness, records };
}

function awardsRunSectionHarness(document, rootNode, liveRegions = []) {
  const { harness, records } = autofillHarness(
    document,
    { awards: [{ name: '奖项 A' }, { name: '奖项 B' }] },
    { sectionId: 'awards', section: 'awards', collection: 'awards' },
  );
  Object.setPrototypeOf(harness, Autofill.AutofillEngine.prototype);
  harness.config = {
    sections: {
      awards: { groupSelector: '[data-repeat-item]' },
    },
  };
  harness.adapter = {
    findContentRoot() { return rootNode; },
    diagnose() { return { section: {} }; },
  };
  harness.adapterId = 'test-awards';
  harness.siteProfile = { id: 'test-profile', revision: '1' };
  harness.currentSectionRunIds = new Map();
  harness.reportManager = {
    beginRun() { return 'run:awards-double-stage-red'; },
    finalize() { return {}; },
    toTaskResult() { return {}; },
    getViewModel() { return {}; },
  };
  harness.preferences = { autoSave: false, allowOverwrite: false, skipEmpty: true };
  harness.saveHandler = null;
  harness.stopped = false;
  harness.skipRequested = false;
  harness.abortController = {
    signal: {
      aborted: true,
      addEventListener() {},
      removeEventListener() {},
    },
  };
  harness.waitIfPaused = async () => {};
  harness.processFieldGroup = async () => {};
  harness.scanLiveEmbeddedCandidates = () => [...liveRegions];
  return { harness, records };
}

function configuredAwardRow() {
  const row = makeElement('div', { attributes: { 'data-repeat-item': 'award-0' } });
  row.append(input('时间'), input('内容'));
  return row;
}

function zhejiangLikeFixture() {
  const outer = makeElement('fieldset', { id: 'page' });
  const basicName = input('姓名');
  const educationCollege = input('本科院系');
  const broadFreeText = [
    '姓名',
    '姓名拼音',
    '证件号码',
    '出生日期',
    '档案单位',
    '通讯地址',
    '联系电话',
    '电子邮箱',
    '本科院系',
    '外语成绩',
    '入学',
    '毕业',
    'GPA',
    '专业人数',
    '专业排名',
    '个人陈述',
    '备注',
    // 故意加入可能与嵌入栏目表头重名的普通页面文本。
    '时间',
    '内容',
    '级别',
    '排名',
  ].map(text => makeElement('span', { text }));
  const family = makeTable(
    'family',
    ['姓名', '与本人关系', '在何单位工作任何职务', '联系电话'],
    5,
  );
  const work = makeTable(
    'work-history',
    ['起止年月', '学习或工作单位', '担任职务'],
    1,
  );
  const papers = makeTable(
    'papers',
    ['发表时间', '发表刊物或出版社', '成果名称'],
    0,
  );
  outer.append(
    ...broadFreeText,
    basicName,
    family.table,
    work.table,
    educationCollege,
    papers.table,
  );
  const document = attachDocument(outer, [outer, family.table, work.table, papers.table]);
  return { document, outer, basicName, educationCollege, family, work, papers };
}

function runtimeOwnershipFixture(options = {}) {
  const outer = makeElement('fieldset', { id: 'page-runtime' });
  const work = makeTable(
    'work-history-runtime',
    ['起始年月', '结束年月', '学习或工作单位', '担任职务'],
    1,
  );
  const familyHeaders = ['姓名', '与本人关系', '在何单位工作任何职务', '联系电话'];
  const family = makeTable('family-runtime', familyHeaders, options.familyRows ?? 5);
  const papers = makeTable(
    'papers-runtime',
    ['发表时间', '发表刊物或出版社', '成果名称', '作者排名'],
    0,
  );
  const addFamily = button('添加');
  if (options.addFamilyRowOnClick) {
    addFamily.click = function click() {
      this.clickCount += 1;
      const row = makeElement('tr');
      const controls = familyHeaders.map(header => input(header));
      row.append(controls);
      family.table.append(row);
      family.rows.push({ row, controls });
    };
  }

  // Deliberately place another repeatable table before family. If runtime group
  // discovery expands back to the fieldset, the first mapped family row will
  // come from work-history and the total will become 6 instead of 5.
  let familyActionOwner = null;
  if (options.ownedFamilyActionWrapper) {
    familyActionOwner = makeElement('section', {
      id: 'family-action-owner',
      attributes: { 'data-section': 'family' },
    });
    familyActionOwner.append(family.table, addFamily);
    outer.append(work.table, familyActionOwner, papers.table);
  } else {
    outer.append(work.table, family.table, papers.table, addFamily);
  }
  const document = attachDocument(outer, [outer, work.table, family.table, papers.table]);
  // detectSectionRoot may ascend to outer, just as it would under document.body
  // in a real page. The group root must nevertheless remain the owned table.
  document.body = makeElement('body');
  return { document, outer, work, family, papers, addFamily, familyActionOwner };
}

function legitimateFieldsetFixture() {
  const root = makeElement('form');
  const fieldset = makeElement('fieldset', { id: 'owned-family-root' });
  const legend = makeElement('legend', { text: '家庭主要成员' });
  const row = makeElement('div', { attributes: { 'data-repeat-item': '' } });
  ['姓名', '与本人关系', '在何单位工作任何职务', '联系电话'].forEach(label => {
    row.append(makeElement('span', { text: label }), input(label));
  });
  const addFamily = button('添加');
  const nestedSummary = makeTable(
    'family-summary',
    ['姓名', '与本人关系', '在何单位工作任何职务', '联系电话'],
    0,
  );
  fieldset.append(legend, row, addFamily, nestedSummary.table);
  root.append(fieldset);
  const document = attachDocument(root, [fieldset, nestedSummary.table]);
  return { document, fieldset, row, addFamily, nestedSummary };
}

function contextsFor(fixture, candidates) {
  const regions = [];
  candidates.forEach(candidate => {
    const groups = ArrayHandler.detectGroups(candidate.runtimeRoot, { ownedOnly: true });
    ArrayHandler.mapGroups(candidate, groups).forEach(group => regions.push({
      ...candidate,
      root: group.element,
      index: group.index,
      indexContext: { ...group.indexContext, collection: candidate.collection },
      priority: 300,
    }));
    regions.push({ ...candidate, root: candidate.runtimeRoot, priority: 200 });
  });
  regions.push({
    sectionId: 'basic',
    collection: 'basic',
    collectionMode: 'record',
    source: 'navigation',
    confidence: 1,
    regionId: 'page:basic',
    root: fixture.outer,
    priority: 100,
  });
  return regions;
}

test('Region Ownership: broad outer fieldset 不得成为任何 embedded candidate', () => {
  const fixture = zhejiangLikeFixture();
  const detected = EmbeddedSectionDetector.detect(fixture.document);
  const outerCandidates = detected.filter(candidate => candidate.runtimeRoot === fixture.outer);

  assert.deepEqual(outerCandidates, []);
  assert.equal(outerCandidates.some(candidate => candidate.collection === 'awards'), false);
  assert.ok(detected.some(candidate => candidate.runtimeRoot === fixture.family.table));
  assert.ok(detected.some(candidate => candidate.runtimeRoot === fixture.papers.table));
  assert.equal(ArrayHandler.detectGroups(fixture.outer, { ownedOnly: true }).length, 0);
});

test('真实 family table 保留且 groupCount 只等于自己的 5 行', () => {
  const fixture = zhejiangLikeFixture();
  const detected = EmbeddedSectionDetector.detect(fixture.document);
  const family = detected.find(candidate => candidate.runtimeRoot === fixture.family.table);

  assert.ok(family);
  assert.equal(family.collection, 'family');
  assert.equal(family.groupCount, 5);
  assert.equal(family.zeroRow, false);
  assert.equal(family.evidenceScope, 'owned');
  assert.equal(family.ownedHeaderCount, 4);
  assert.equal(family.nestedHeaderCount, 0);
});

test('FieldContext 优先 descendant/group：basic 不被 family 污染，family 行索引正确', () => {
  const fixture = zhejiangLikeFixture();
  const detected = EmbeddedSectionDetector.detect(fixture.document);
  const regions = contextsFor(fixture, detected);

  const basic = FieldContext.resolve({ element: fixture.basicName }, regions);
  const family = FieldContext.resolve({ element: fixture.family.rows[3].controls[0] }, regions);

  assert.equal(basic.collection, 'basic');
  assert.equal(family.collection, 'family');
  assert.equal(family.index, 3);
  assert.equal(family.indexContext?.index, 3);
});

test('同一字段被 ancestor/descendant 同时包含时，更具体 descendant region 胜出', () => {
  const fixture = zhejiangLikeFixture();
  const element = fixture.family.rows[0].controls[0];
  const ancestor = {
    sectionId: 'family', collection: 'family', source: 'embedded-structure',
    confidence: 0.98, priority: 200, root: fixture.outer, regionId: 'fieldset:0',
  };
  const descendant = {
    sectionId: 'family', collection: 'family', source: 'embedded-structure',
    confidence: 0.93, priority: 200, root: fixture.family.table, regionId: 'table:1',
  };

  assert.equal(FieldContext.selectRegion({ element }, [ancestor, descendant]), descendant);
});

test('work-history 与 education 字段不能得到 family context', () => {
  const fixture = zhejiangLikeFixture();
  const detected = EmbeddedSectionDetector.detect(fixture.document);
  const regions = contextsFor(fixture, detected);
  const work = FieldContext.resolve({ element: fixture.work.rows[0].controls[1] }, regions);
  const education = FieldContext.resolve({ element: fixture.educationCollege }, regions);

  assert.notEqual(work.collection, 'family');
  // Phase 3.3.3.2：组合“起止年月”是 internships start/end 的双结构证据，
  // 因此真实工作经历表应获得自己的 embedded context，而不是留在 basic。
  assert.equal(work.collection, 'internships');
  assert.equal(education.collection, 'basic');
});

test('zero-row papers 结构继续保留，不能因 owned evidence 修复而消失', () => {
  const fixture = zhejiangLikeFixture();
  const papers = EmbeddedSectionDetector.detect(fixture.document)
    .find(candidate => candidate.runtimeRoot === fixture.papers.table);

  assert.ok(papers);
  assert.equal(papers.collection, 'papers');
  assert.equal(papers.groupCount, 0);
  assert.equal(papers.zeroRow, true);
});

test('南京-like 既有 6 embedded sections 保持识别', () => {
  const form = makeElement('form');
  const definitions = [
    ['language', ['考试名称', '成绩'], 2],
    ['internships', ['起始年月', '结束年月', '学习工作单位', '担任职务'], 2],
    ['research', ['名称', '指导教师', '级别', '主要贡献'], 1],
    ['papers', ['发表时间', '发表刊物或出版社', '成果名称', '作者排名'], 1],
    ['awards', ['时间', '内容', '级别', '排名'], 1],
    ['practice', ['开始时间', '结束时间', '地点', '主要内容'], 0],
  ];
  const tables = definitions.map(([id, headers, rows]) => makeTable(id, headers, rows));
  form.append(tables.map(item => item.table));
  const document = attachDocument(form, tables.map(item => item.table));

  assert.deepEqual(
    EmbeddedSectionDetector.detect(document).map(item => item.collection).sort(),
    definitions.map(([id]) => id).sort(),
  );
});

test('Autofill runtime 保持 owned table 为 group root，不因外层 add scope 混入兄弟表格行', async () => {
  const fixture = runtimeOwnershipFixture();
  const candidates = EmbeddedSectionDetector.detect(fixture.document);
  const familyCandidate = candidates.find(candidate => candidate.runtimeRoot === fixture.family.table);
  assert.ok(familyCandidate);

  // This proves the old execution path really has a broader action scope.
  assert.equal(ArrayHandler.detectSectionRoot(fixture.outer, 'family'), fixture.outer);

  const records = [];
  const harness = {
    document: fixture.document,
    config: { sections: {} },
    resumeView: { family: Array.from({ length: 5 }, () => ({})) },
    task: { scanId: 'scan:owned-runtime' },
    scanId: 'scan:owned-runtime',
    callbacks: { onLog() {} },
    async setState() {},
    record(_runId, item) { records.push(item); },
  };

  const prepared = await Autofill.AutofillEngine.prototype.prepareEmbeddedCollections.call(
    harness,
    fixture.outer,
    { regionCandidates: [familyCandidate], scanId: 'scan:owned-runtime' },
    null,
    'run:owned-runtime',
  );
  const family = prepared.find(item => item.collection === 'family');

  assert.ok(family);
  assert.equal(family.regionContext.groupCount, 5);
  assert.equal(family.groupElements.length, 5);
  assert.equal(family.groupElements.includes(fixture.work.rows[0].row), false);
  assert.deepEqual(family.groupElements, fixture.family.rows.map(item => item.row));
  assert.equal(fixture.addFamily.clickCount, 0);
  assert.deepEqual(records, []);
});

test('具有 own legend/direct repeat rows/add control 的合法 fieldset 不被同 collection descendant 抑制', () => {
  const fixture = legitimateFieldsetFixture();
  const detected = EmbeddedSectionDetector.detect(fixture.document);
  const fieldset = detected.find(candidate => candidate.runtimeRoot === fixture.fieldset);

  assert.ok(fieldset, '合法 fieldset 的 owned evidence 不能因 nested 同 collection table 消失');
  assert.equal(fieldset.collection, 'family');
  assert.equal(fieldset.groupCount, 1);
  assert.equal(fieldset.zeroRow, false);
  assert.equal(ArrayHandler.findAddButton(fixture.fieldset, 'family'), fixture.addFamily);
});

test('零行 table-backed wrapper 与内层结构表合并为一个 embedded context', () => {
  const root = makeElement('main');
  const wrapper = makeElement('section', {
    attributes: { 'data-repeat-list': '', 'data-section': 'practice' },
  });
  const heading = makeElement('h3', { text: '社会实践' });
  const practice = makeTable(
    'practice-zero-row',
    ['开始时间', '结束时间', '地点', '主要内容'],
    0,
  );
  const add = button('新增');
  wrapper.append(heading, practice.table, add);
  root.append(wrapper);
  const document = attachDocument(root, [wrapper, practice.table]);

  const detected = EmbeddedSectionDetector.detect(document)
    .filter(candidate => candidate.collection === 'practice');

  assert.equal(detected.length, 1);
  assert.equal(detected[0].runtimeRoot, practice.table);
  assert.equal(detected[0].zeroRow, true);
});

test('owned table 零行时从最小 collection owner 找到 sibling add，并只在目标表创建首行', async () => {
  const fixture = runtimeOwnershipFixture({
    familyRows: 0,
    addFamilyRowOnClick: true,
    ownedFamilyActionWrapper: true,
  });
  const familyCandidate = EmbeddedSectionDetector.detect(fixture.document)
    .find(candidate => candidate.runtimeRoot === fixture.family.table);
  assert.ok(familyCandidate);
  assert.equal(familyCandidate.groupCount, 0);
  assert.equal(ArrayHandler.detectSectionRoot(fixture.outer, 'family'), fixture.familyActionOwner);

  const records = [];
  const harness = {
    document: fixture.document,
    config: { sections: {} },
    resumeView: { family: [{}] },
    task: { scanId: 'scan:owned-zero-row' },
    scanId: 'scan:owned-zero-row',
    callbacks: { onLog() {} },
    async setState() {},
    record(_runId, item) { records.push(item); },
  };
  const prepared = await Autofill.AutofillEngine.prototype.prepareEmbeddedCollections.call(
    harness,
    fixture.outer,
    { regionCandidates: [familyCandidate], scanId: 'scan:owned-zero-row' },
    null,
    'run:owned-zero-row',
  );
  const family = prepared.find(item => item.collection === 'family');

  assert.ok(family);
  assert.equal(fixture.addFamily.clickCount, 1);
  assert.equal(family.regionContext.groupCount, 1);
  assert.deepEqual(family.groupElements, [fixture.family.rows[0].row]);
  assert.equal(family.groupElements.includes(fixture.work.rows[0].row), false);
  assert.deepEqual(records, []);
});

test('Diagnosis 与 embedded execution 必须使用同一 content-root action 搜索边界', async () => {
  const outerOwner = makeElement('section', {
    id: 'outer-practice-owner',
    attributes: { 'data-section': 'practice' },
  });
  const contentRoot = makeElement('div', { id: 'active-content-root' });
  const practice = makeTable(
    'bounded-practice-table',
    ['开始时间', '结束时间', '地点', '主要内容'],
    0,
  );
  const outsideBoundaryAdd = button('新 增');
  contentRoot.append(practice.table);
  outerOwner.append(contentRoot, outsideBoundaryAdd);
  const document = attachDocument(outerOwner, [practice.table]);
  const [candidate] = EmbeddedSectionDetector.detect(document);
  assert.ok(candidate);

  const { harness } = autofillHarness(document, { practice: [{}] });
  harness.adapter.findContentRoot = () => contentRoot;
  const diagnosis = Autofill.AutofillEngine.prototype.diagnoseCurrent.call(harness);
  await Autofill.AutofillEngine.prototype.prepareEmbeddedCollections.call(
    harness,
    contentRoot,
    { regionCandidates: [candidate], scanId: harness.scanId },
    null,
    'run:bounded-diagnosis-red',
  );

  const diagnosisReason = diagnosis.actionOwnershipDebug
    .find(item => item.collection === 'practice')?.finalReasonCode;
  const executionAddRoot = ArrayHandler.detectSectionRoot(
    contentRoot,
    'practice',
    { embeddedRegions: [candidate] },
  ) || practice.table;
  const boundedReason = ArrayHandler.inspectActionOwnership(
    practice.table,
    'practice',
    {
      addRoot: executionAddRoot,
      embeddedRegions: [candidate],
      zeroRow: true,
    },
  ).finalReasonCode;

  assert.deepEqual(
    {
      diagnosisReason,
      executionBoundaryReason: boundedReason,
      outsideBoundaryClicks: outsideBoundaryAdd.clickCount,
    },
    {
      diagnosisReason: 'NO_LOCAL_ADD',
      executionBoundaryReason: 'NO_LOCAL_ADD',
      outsideBoundaryClicks: 0,
    },
  );
});

test('同 collection 多个 live regions 在 Diagnosis 与 execution 都必须 topology ambiguous 且零点击', async () => {
  const page = makeElement('main', { id: 'duplicate-papers-page' });
  const firstOwner = makeElement('section', {
    id: 'papers-owner-a',
    attributes: { 'data-section': 'papers' },
  });
  const secondOwner = makeElement('section', {
    id: 'papers-owner-b',
    attributes: { 'data-section': 'papers' },
  });
  const first = makeTable(
    'papers-table-a',
    ['发表时间', '发表刊物或出版社', '成果名称', '作者排名'],
    0,
  );
  const second = makeTable(
    'papers-table-b',
    ['发表时间', '发表刊物或出版社', '成果名称', '作者排名'],
    0,
  );
  const firstAdd = button('新增');
  const secondAdd = button('新增');
  firstOwner.append(first.table, firstAdd);
  secondOwner.append(second.table, secondAdd);
  page.append(firstOwner, secondOwner);
  const document = attachDocument(page, [first.table, second.table]);
  const candidates = EmbeddedSectionDetector.detect(document)
    .filter(candidate => candidate.collection === 'papers');
  assert.equal(candidates.length, 2);

  const { harness, records } = autofillHarness(document, { papers: [{}] });
  const diagnosis = Autofill.AutofillEngine.prototype.diagnoseCurrent.call(harness);
  await Autofill.AutofillEngine.prototype.prepareEmbeddedCollections.call(
    harness,
    page,
    { regionCandidates: [candidates[0]], scanId: harness.scanId },
    null,
    'run:duplicate-papers-red',
  );

  const diagnosisReasons = [...new Set(
    diagnosis.actionOwnershipDebug
      .filter(item => item.collection === 'papers')
      .map(item => item.finalReasonCode),
  )];
  const executionReason = records
    .find(item => item.reasonCode === 'EMBEDDED_SECTION_TOPOLOGY_AMBIGUOUS')
    ?.reasonCode;

  assert.deepEqual(
    {
      diagnosisReasons,
      executionReason,
      clicks: firstAdd.clickCount + secondAdd.clickCount,
    },
    {
      diagnosisReasons: ['EMBEDDED_SECTION_TOPOLOGY_AMBIGUOUS'],
      executionReason: 'EMBEDDED_SECTION_TOPOLOGY_AMBIGUOUS',
      clicks: 0,
    },
  );
});

test('Awards runSection 在 shared Add 点击后无行增长时全程只能尝试一次', async () => {
  const root = makeElement('section', {
    id: 'direct-awards-no-growth',
    attributes: { 'data-section': 'awards' },
  });
  const row = configuredAwardRow();
  const add = button('新增');
  root.append(row, add);
  const page = makeElement('main', { id: 'application-page' });
  page.append(root);
  const document = attachDocument(page, []);
  const { harness, records } = awardsRunSectionHarness(document, root, []);
  await Autofill.AutofillEngine.prototype.runSection.call(
    harness,
    'awards',
    {
      sectionContext: {
        sectionId: 'awards',
        section: 'awards',
        collection: 'awards',
        collectionMode: 'repeatable',
        regionCandidates: [],
      },
    },
  );

  assert.deepEqual(
    {
      clicks: add.clickCount,
      noGrowthReasonObserved: records.some(item =>
        item.reasonCode === 'ACTION_OWNERSHIP_REJECTED'
        && item.reason === '点击新增后 DOM 中的实际表单组数量没有增加'
      ),
      genericFailureCount: records.filter(
        item => item.reasonCode === 'ARRAY_PREPARATION_FAILED',
      ).length,
    },
    {
      clicks: 1,
      noGrowthReasonObserved: true,
      genericFailureCount: 0,
    },
    'shared ensure 已经点击且确认行数未增长后，runSection 不得再进入第二次扩行',
  );
});

test('Awards runSection 的 topology ambiguous 必须贯穿后续 generic prepare 并保持零点击', async () => {
  const root = makeElement('section', {
    id: 'direct-awards-ambiguous',
    attributes: { 'data-section': 'awards' },
  });
  const row = configuredAwardRow();
  const firstTable = makeTable(
    'ambiguous-awards-a',
    ['时间', '内容', '级别', '排名'],
    0,
  );
  const secondTable = makeTable(
    'ambiguous-awards-b',
    ['时间', '内容', '级别', '排名'],
    0,
  );
  const add = button('新增');
  root.append(row, firstTable.table, secondTable.table, add);
  const page = makeElement('main', { id: 'application-page' });
  page.append(root);
  const document = attachDocument(page, [firstTable.table, secondTable.table]);
  const liveRegions = [firstTable, secondTable].map((table, index) => ({
    sectionId: 'awards',
    collection: 'awards',
    collectionMode: 'repeatable',
    regionId: `awards:ambiguous:${index}`,
    runtimeRoot: table.table,
    root: table.table,
    groupCount: 0,
    zeroRow: true,
  }));
  const { harness, records } = awardsRunSectionHarness(document, root, liveRegions);

  await Autofill.AutofillEngine.prototype.runSection.call(
    harness,
    'awards',
    {
      sectionContext: {
        sectionId: 'awards',
        section: 'awards',
        collection: 'awards',
        collectionMode: 'repeatable',
        regionCandidates: [],
      },
    },
  );
  assert.deepEqual(
    {
      bindingReasonObserved: records.some(
        item => item.reasonCode === 'EMBEDDED_SECTION_TOPOLOGY_AMBIGUOUS',
      ),
      clicks: add.clickCount,
    },
    {
      bindingReasonObserved: true,
      clicks: 0,
    },
    'topologyReason 不得在 awards adapter 失败后的通用数组准备阶段丢失',
  );
});
