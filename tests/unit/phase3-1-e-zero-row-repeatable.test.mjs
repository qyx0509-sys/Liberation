import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const Structures = require('../../src/mappings/section-structures.js');
const Sections = require('../../src/mappings/section-aliases.js');
const Fields = require('../../src/mappings/field-aliases.js');
const Safety = require('../../src/core/safety.js');
const ArrayHandler = require('../../src/core/array-handler.js');
const EmbeddedSectionDetector = require('../../src/core/embedded-section-detector.js');
const FieldContext = require('../../src/core/field-context.js');
const FieldDetector = require('../../src/core/field-detector.js');
const FieldMatcher = require('../../src/core/field-matcher.js');

const SECTION_FIXTURES = Object.freeze({
  practice: Object.freeze({
    headers: Object.freeze(['开始时间', '结束时间', '地点', '主要内容']),
    fields: Object.freeze(['开始时间', '结束时间', '地点', '主要内容']),
    addText: '添加一行',
  }),
  awards: Object.freeze({
    headers: Object.freeze(['时间', '内容', '级别', '排名（排名/团队人数，单人奖项填写1/1）']),
    fields: Object.freeze(['时间', '内容', '级别', '排名（排名/团队人数，单人奖项填写1/1）']),
    addText: '添加奖项',
  }),
  papers: Object.freeze({
    headers: Object.freeze(['发表时间', '发表刊物或出版社', '成果名称', '作者排名']),
    fields: Object.freeze(['发表时间', '发表刊物或出版社', '成果名称', '作者排名']),
    addText: '添加论文',
  }),
  language: Object.freeze({
    headers: Object.freeze(['考试名称', '成绩']),
    fields: Object.freeze(['考试名称', '成绩']),
    addText: '添加外语',
  }),
  internships: Object.freeze({
    headers: Object.freeze(['起始时间', '结束时间', '学校或工作单位', '担任职务']),
    fields: Object.freeze(['起始时间', '结束时间', '学校或工作单位', '担任职务']),
    addText: '添加经历',
  }),
  research: Object.freeze({
    headers: Object.freeze(['名称', '指导教师', '级别', '主要贡献']),
    fields: Object.freeze(['名称', '指导教师', '级别', '主要贡献']),
    addText: '添加科研',
  }),
});

function selectorText(selector) {
  return String(selector || '');
}

function requestsButtons(selector) {
  return selectorText(selector).startsWith('button,[role="button"],a,input[type="button"]')
    || selectorText(selector).startsWith('button,[role="button"],input[type="button"]');
}

function requestsControls(selector) {
  const source = selectorText(selector);
  return source.startsWith('input')
    || source.includes('textarea')
    || source.includes('contenteditable')
    || source.includes('combobox');
}

function requestsTables(selector) {
  const source = selectorText(selector);
  return source === 'table'
    || source.startsWith('table,[role="table"]')
    || source.startsWith('table,tbody,form');
}

function visibleRect(width = 640, height = 120) {
  return { width, height, left: 0, top: 0, right: width, bottom: height };
}

function baseElement(tagName) {
  return {
    nodeType: 1,
    tagName,
    hidden: false,
    disabled: false,
    isConnected: true,
    parentElement: null,
    ownerDocument: null,
    getAttribute() { return null; },
    getBoundingClientRect() { return visibleRect(); },
  };
}

function makeHeader(value) {
  return {
    ...baseElement('TH'),
    innerText: value,
    textContent: value,
  };
}

function makeControl(label) {
  const control = {
    ...baseElement('INPUT'),
    type: 'text',
    value: '',
    readOnly: false,
    fieldLabel: label,
    id: '',
    name: '',
    closest(selector) {
      const source = selectorText(selector);
      if (source === 'table' || source === 'td,th') return this.row?.table || null;
      return null;
    },
    matches(selector) { return selectorText(selector).includes('input'); },
    querySelector() { return null; },
    querySelectorAll() { return []; },
  };
  return control;
}

function makeRow(sectionId, labels) {
  const row = {
    ...baseElement('TR'),
    sectionId,
    table: null,
    controls: labels.map(makeControl),
    contains(node) { return this.controls.includes(node); },
    closest(selector) { return selectorText(selector) === 'table' ? this.table : null; },
    matches(selector) { return selectorText(selector).split(',').some(item => item.trim() === '[role="row"]' || item.trim() === 'tr'); },
    querySelector(selector) {
      if (selectorText(selector) === 'th') return null;
      return this.querySelectorAll(selector)[0] || null;
    },
    querySelectorAll(selector) { return requestsControls(selector) ? this.controls : []; },
    getFieldDescriptors(settings = {}) {
      return this.controls.map((control, fieldIndex) => descriptorForControl(control, settings, fieldIndex));
    },
  };
  row.children = row.controls;
  row.controls.forEach(control => {
    control.row = row;
    control.parentElement = row;
  });
  return row;
}

function makeHeaderRow(table) {
  return {
    ...baseElement('TR'),
    table,
    parentElement: table,
    contains() { return false; },
    closest(selector) { return selectorText(selector) === 'table' ? table : null; },
    querySelector(selector) { return selectorText(selector) === 'th' ? table.headerNodes[0] || null : null; },
    querySelectorAll() { return []; },
    children: table.headerNodes,
  };
}

function makeButton(text, onClick = () => undefined) {
  const button = {
    ...baseElement('BUTTON'),
    type: 'button',
    innerText: text,
    textContent: text,
    value: '',
    title: '',
    id: '',
    name: '',
    clickCount: 0,
    click() {
      this.clickCount += 1;
      onClick();
    },
    closest(selector) {
      const source = selectorText(selector);
      if (source.includes('#__jf_panel__') || source === 'form') return null;
      return null;
    },
    matches(selector) {
      const source = selectorText(selector);
      return source.includes('button') && !source.includes(':disabled');
    },
    querySelector() { return null; },
    querySelectorAll() { return []; },
  };
  return button;
}

function makeSection(sectionId, initialRows = 0, options = {}) {
  const fixture = SECTION_FIXTURES[sectionId];
  if (!fixture) throw new Error(`缺少 ${sectionId} 测试结构`);
  const table = {
    ...baseElement('TABLE'),
    sectionId,
    headerNodes: fixture.headers.map(makeHeader),
    rows: [],
    contains(node) {
      return this.headerNodes.includes(node)
        || this.rows.includes(node)
        || this.rows.some(row => row.contains(node));
    },
    matches(selector) { return selectorText(selector).includes('table'); },
    closest(selector) { return selectorText(selector) === 'table' ? this : null; },
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
    querySelectorAll(selector) {
      const source = selectorText(selector);
      if (source === 'tr') return [this.headerRow, ...this.rows];
      if (/th|thead td|first-child|columnheader/.test(source)) return this.headerNodes;
      if (requestsControls(source)) return this.rows.flatMap(row => row.controls);
      return [];
    },
    get innerText() { return fixture.headers.join(' '); },
    get textContent() { return fixture.headers.join(' '); },
    getFieldDescriptors(settings = {}) {
      return this.rows.flatMap(row => row.getFieldDescriptors(settings));
    },
  };
  table.headerRow = makeHeaderRow(table);
  table.headerNodes.forEach(node => {
    node.parentElement = table.headerRow;
  });

  const section = {
    ...baseElement('SECTION'),
    sectionId,
    table,
    buttons: [],
    contains(node) {
      return node === this.table || this.buttons.includes(node) || this.table.contains(node);
    },
    closest() { return null; },
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
    querySelectorAll(selector) {
      const source = selectorText(selector);
      if (requestsTables(source)) return [this.table];
      if (requestsButtons(source)) return this.buttons;
      if (requestsControls(source)) return this.table.rows.flatMap(row => row.controls);
      return [];
    },
    get innerText() { return `${fixture.headers.join(' ')} ${this.buttons.map(button => button.innerText).join(' ')}`; },
    get textContent() { return this.innerText; },
    getFieldDescriptors(settings = {}) { return this.table.getFieldDescriptors(settings); },
    addRow() {
      const row = makeRow(sectionId, fixture.fields);
      row.table = this.table;
      row.parentElement = this.table;
      row.controls.forEach(control => {
        control.ownerDocument = this.ownerDocument;
      });
      row.ownerDocument = this.ownerDocument;
      this.table.rows.push(row);
      this.table.children = [this.table.headerRow, ...this.table.rows];
      return row;
    },
  };
  table.parentElement = section;
  table.children = [table.headerRow];
  for (let index = 0; index < initialRows; index += 1) section.addRow();

  if (options.withAddButton !== false) {
    const button = makeButton(options.addText || fixture.addText, () => {
      if (options.mutateOnClick !== false) section.addRow();
    });
    button.parentElement = section;
    section.buttons.push(button);
    section.addButton = button;
  }
  return section;
}

function descriptorForControl(control, settings, fieldIndex) {
  const rowIndex = control.row?.table?.rows?.indexOf(control.row) ?? 0;
  const sectionId = control.row?.sectionId || settings.section || '';
  return {
    detectorId: `${sectionId || 'field'}_${Math.max(0, rowIndex)}_${fieldIndex}`,
    element: control,
    interactionElement: control,
    elements: [control],
    section: settings.section || sectionId,
    tagName: 'input',
    controlKind: 'text',
    baseControlKind: 'text',
    type: 'text',
    inputType: 'text',
    labelText: '',
    tableHeader: control.fieldLabel,
    placeholder: '',
    ariaLabel: '',
    name: '',
    id: '',
    title: '',
    groupText: '',
    nearbyText: '',
    parentText: '',
    visible: true,
    hidden: false,
    disabled: false,
    readOnly: false,
    sensitive: false,
    options: [],
  };
}

function makePage(sectionSpecs, options = {}) {
  const sections = Object.entries(sectionSpecs).map(([sectionId, countOrOptions]) => {
    const sectionOptions = typeof countOrOptions === 'object' ? countOrOptions : {};
    const count = typeof countOrOptions === 'number' ? countOrOptions : Number(sectionOptions.rows || 0);
    return makeSection(sectionId, count, sectionOptions);
  });
  const main = {
    ...baseElement('MAIN'),
    sections,
    extraButtons: [],
    contains(node) {
      return this.sections.includes(node)
        || this.extraButtons.includes(node)
        || this.sections.some(section => section.contains(node));
    },
    closest() { return null; },
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
    querySelectorAll(selector) {
      const source = selectorText(selector);
      if (requestsTables(source)) return this.sections.map(section => section.table);
      if (requestsButtons(source)) return [
        ...this.sections.flatMap(section => section.buttons),
        ...this.extraButtons,
      ];
      if (requestsControls(source)) return this.sections.flatMap(section => section.table.rows.flatMap(row => row.controls));
      return [];
    },
    getFieldDescriptors(settings = {}) {
      return this.sections.flatMap(section => section.getFieldDescriptors(settings));
    },
  };

  const document = {
    nodeType: 9,
    title: '示例研究生申请系统',
    location: {
      href: 'https://example.test/application/edit',
      origin: 'https://example.test',
    },
    defaultView: {
      getComputedStyle() { return { display: 'block', visibility: 'visible', opacity: '1' }; },
    },
    body: main,
    documentElement: main,
    // Mirror the real DOM Node.contains contract so an explicit document
    // action-search boundary can prove that it owns the embedded table.
    contains(node) { return node === main || main.contains(node); },
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
    querySelectorAll(selector) {
      const source = selectorText(selector);
      if (source === 'table,[role="table"],fieldset,[data-repeat-list],[data-array-list]') {
        return sections.map(section => section.table);
      }
      if (source.startsWith('main,[role="main"],form,article')) return [main];
      if (requestsTables(source)) return sections.map(section => section.table);
      if (requestsButtons(source)) return main.querySelectorAll(source);
      if (requestsControls(source)) return main.querySelectorAll(source);
      return [];
    },
  };
  main.ownerDocument = document;
  sections.forEach(section => {
    section.ownerDocument = document;
    section.parentElement = main;
    section.table.ownerDocument = document;
    section.table.headerRow.ownerDocument = document;
    section.table.headerNodes.forEach(node => { node.ownerDocument = document; });
    section.buttons.forEach(button => { button.ownerDocument = document; });
    section.table.rows.forEach(row => {
      row.ownerDocument = document;
      row.controls.forEach(control => { control.ownerDocument = document; });
    });
  });

  if (Array.isArray(options.extraButtons)) {
    options.extraButtons.forEach(button => {
      button.ownerDocument = document;
      button.parentElement = main;
      main.extraButtons.push(button);
    });
  }

  return {
    document,
    main,
    sections: Object.fromEntries(sections.map(section => [section.sectionId, section])),
  };
}

function sectionContext(sectionId) {
  return {
    sectionId,
    section: sectionId,
    collection: sectionId,
    collectionMode: 'repeatable',
    source: 'embedded-structure',
    confidence: 0.95,
    indexContext: null,
  };
}

function embeddedCandidates(page, onlySection = null) {
  return EmbeddedSectionDetector.detect(page.document)
    .filter(candidate => !onlySection || candidate.collection === onlySection);
}

function embeddedHarness(page, resume) {
  const records = [];
  return {
    document: page.document,
    resumeView: Fields.buildResumeView(resume),
    config: {},
    task: { scanId: 'scan_zero_row' },
    scanId: 'scan_zero_row',
    callbacks: { onLog() {} },
    async setState() {},
    record(_runId, item) { records.push(item); },
    records,
  };
}

function pageSectionContext(page, onlySection = null) {
  return {
    sectionId: 'education',
    collection: 'education',
    collectionMode: 'singleton-view',
    source: 'navigation',
    confidence: 0.99,
    scanId: 'scan_zero_row',
    regionCandidates: embeddedCandidates(page, onlySection),
  };
}

function prepareEmbedded(harness, page, onlySection = null) {
  return AutofillEngine.AutofillEngine.prototype.prepareEmbeddedCollections.call(
    harness,
    page.main,
    pageSectionContext(page, onlySection),
    null,
    'run_zero_row',
  );
}

globalThis.JFSectionStructures = Structures;
globalThis.JFSectionAliases = Sections;
globalThis.JFFieldAliases = Fields;
globalThis.JFSafety = Safety;
globalThis.JFArrayHandler = ArrayHandler;
globalThis.JFEmbeddedSectionDetector = EmbeddedSectionDetector;
globalThis.JFFieldContext = FieldContext;
globalThis.JFFieldMatcher = FieldMatcher;
globalThis.JFFieldDetector = {
  ...FieldDetector,
  scan(rootNode, settings = {}) {
    const descriptors = rootNode?.getFieldDescriptors?.(settings) || [];
    const regions = settings.regions || settings.regionCandidates || settings.embeddedRegions || [];
    return descriptors.map(descriptor => ({
      ...descriptor,
      context: FieldContext.resolve(descriptor, regions, settings.sectionContext || null),
    }));
  },
};
globalThis.JFFileFieldDetector = { scan() { return []; }, toDiagnostic() { return null; } };

const GenericAdapter = require('../../src/adapters/generic-adapter.js');
globalThis.JFGenericAdapter = GenericAdapter;
const AutofillEngine = require('../../src/core/autofill-engine.js');

function createAdapter(page) {
  const navigationEngine = {
    scan() {
      return [{
        sectionId: 'education', label: '学习信息', text: '学习信息',
        confidence: 0.99, active: true, safe: true,
      }];
    },
    scanDetailed() { return { items: this.scan(), candidates: [] }; },
  };
  return GenericAdapter.createAdapter(page.document, { navigationEngine });
}

function freshDiagnosis(page, resume) {
  const resumeView = Fields.buildResumeView(resume);
  const mainContext = pageSectionContext(page);
  const adapter = createAdapter(page);
  return AutofillEngine.AutofillEngine.prototype.diagnoseCurrent.call({
    document: page.document,
    adapter,
    resume,
    resumeView,
    lastInspection: { sectionContext: mainContext, scanId: 'scan_fresh' },
    task: null,
    scanId: 'scan_fresh',
  });
}

test('zero-row repeatable：只有表头、没有数据行时栏目仍然存在', () => {
  const page = makePage({ practice: 0 });
  const candidates = embeddedCandidates(page);

  assert.equal(ArrayHandler.detectGroups(page.sections.practice).length, 0);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].collection, 'practice');
  assert.equal(candidates[0].runtimeRoot, page.sections.practice.table);
  assert.equal(candidates[0].groupCount, 0);
  assert.equal(candidates[0].zeroRow, true);
});

test('zero-row + JSON 1 条：只点击一次安全新增按钮并创建一行', async () => {
  const page = makePage({ practice: 0 });
  const result = await ArrayHandler.prepare(
    sectionContext('practice'),
    [{ location: '示例地点', description: '示例内容' }],
    page.sections.practice,
    { collectionMode: 'repeatable', timeoutMs: 200, maxAdds: 2 },
  );

  assert.equal(result.ok, true, result.error);
  assert.equal(result.initialCount, 0);
  assert.equal(result.count, 1);
  assert.equal(result.clicks, 1);
  assert.equal(page.sections.practice.addButton.clickCount, 1);
  assert.equal(page.sections.practice.table.rows.length, 1);
});

test('新增首行后必须重新扫描：groupCount=1、index=0 且 regionId 稳定存在', async () => {
  const page = makePage({ practice: 0 });
  await ArrayHandler.prepare(sectionContext('practice'), [{}], page.sections.practice, {
    collectionMode: 'repeatable', timeoutMs: 200, maxAdds: 2,
  });

  const groups = ArrayHandler.detectGroups(page.sections.practice);
  const mapped = ArrayHandler.mapGroups(sectionContext('practice'), groups);
  const diagnosticRegions = GenericAdapter.buildDiagnosticRegions(
    page.document,
    page.main,
    pageSectionContext(page),
    {},
  );
  const groupRegion = diagnosticRegions.regions.find(region =>
    region.collection === 'practice' && region.index === 0);

  assert.equal(groups.length, 1);
  assert.equal(mapped[0].index, 0);
  assert.equal(mapped[0].indexContext.index, 0);
  assert.ok(groupRegion?.regionId);
  assert.equal(groupRegion?.indexContext?.index, 0);
});

test('新增行的 4 个字段全部获得 practice/index 0/regionId context', async () => {
  const page = makePage({ practice: 0 });
  await ArrayHandler.prepare(sectionContext('practice'), [{}], page.sections.practice, {
    collectionMode: 'repeatable', timeoutMs: 200, maxAdds: 2,
  });
  const diagnosticRegions = GenericAdapter.buildDiagnosticRegions(
    page.document,
    page.main,
    pageSectionContext(page),
    {},
  );
  const descriptors = globalThis.JFFieldDetector.scan(page.main, {
    section: 'education',
    sectionContext: pageSectionContext(page),
    regions: diagnosticRegions.regions,
  }).filter(field => field.context?.collection === 'practice');

  assert.equal(descriptors.length, 4);
  for (const field of descriptors) {
    assert.equal(field.context.sectionId, 'practice');
    assert.equal(field.context.collection, 'practice');
    assert.equal(field.context.index, 0);
    assert.equal(field.context.indexContext?.index, 0);
    assert.ok(field.context.regionId);
    assert.equal(field.name, '');
    assert.equal(field.id, '');
  }
});

test('JSON 数组为空时不新增页面行', async () => {
  const page = makePage({ practice: 0 });
  const harness = embeddedHarness(page, { practice: [] });
  const result = await prepareEmbedded(harness, page, 'practice');

  assert.deepEqual(result, []);
  assert.equal(page.sections.practice.addButton.clickCount, 0);
  assert.equal(page.sections.practice.table.rows.length, 0);
});

test('页面已有 1 行且 JSON 只有 1 条时不重复新增', async () => {
  const page = makePage({ practice: 1 });
  const result = await ArrayHandler.prepare(sectionContext('practice'), [{}], page.sections.practice, {
    collectionMode: 'repeatable', timeoutMs: 200, maxAdds: 2,
  });

  assert.equal(result.ok, true, result.error);
  assert.equal(result.initialCount, 1);
  assert.equal(result.count, 1);
  assert.equal(result.clicks, 0);
  assert.equal(page.sections.practice.addButton.clickCount, 0);
});

test('页面已有 2 行而 JSON 只有 1 条时不删除、不缩减现有行', async () => {
  const page = makePage({ practice: 2 });
  const rowsBefore = [...page.sections.practice.table.rows];
  const result = await ArrayHandler.prepare(sectionContext('practice'), [{}], page.sections.practice, {
    collectionMode: 'repeatable', timeoutMs: 200, maxAdds: 2,
  });

  assert.equal(result.ok, true, result.error);
  assert.equal(page.sections.practice.table.rows.length, 2);
  assert.deepEqual(page.sections.practice.table.rows, rowsBefore);
  assert.equal(page.sections.practice.addButton.clickCount, 0);
});

test('同页多个栏目都有新增按钮时，只能点击 section-scoped practice 按钮', async () => {
  const page = makePage({ practice: 0, awards: 0, papers: 0 });
  const harness = embeddedHarness(page, {
    practice: [{ location: '示例地点', description: '示例内容' }],
    awards: [{ name: '不应在本次处理的奖项' }],
    papers: [{ title: '不应在本次处理的论文' }],
  });
  const result = await prepareEmbedded(harness, page, 'practice');

  assert.equal(result.length, 1);
  assert.equal(result[0].collection, 'practice');
  assert.equal(page.sections.practice.addButton.clickCount, 1);
  assert.equal(page.sections.awards.addButton.clickCount, 0);
  assert.equal(page.sections.papers.addButton.clickCount, 0);
});

test('多个模糊“添加”按钮与结构区域无可靠关联时必须 fail-closed', async () => {
  const first = makeButton('添加');
  const second = makeButton('添加');
  const page = makePage(
    { practice: { rows: 0, withAddButton: false } },
    { extraButtons: [first, second] },
  );
  // 模拟旧页面：表格直属公共主容器，两个“添加”都无法归属到 practice。
  page.sections.practice.table.parentElement = page.main;
  const scopedRoot = ArrayHandler.detectSectionRoot(page.main, 'practice');
  const result = await ArrayHandler.prepare(sectionContext('practice'), [{}], scopedRoot, {
    collectionMode: 'repeatable', timeoutMs: 200, maxAdds: 2,
  });

  assert.equal(scopedRoot, page.sections.practice.table);
  assert.equal(result.ok, false);
  assert.match(result.error, /安全新增按钮|未找到/);
  assert.equal(first.clickCount, 0);
  assert.equal(second.clickCount, 0);
});

test('旧语义候选失去实时结构锚点后不得退化到整页点击“添加”', async () => {
  const page = makePage({ practice: 0 });
  const staleContext = pageSectionContext(page, 'practice');
  const harness = embeddedHarness(page, {
    practice: [{ location: '示例地点', description: '示例内容' }],
  });

  // 模拟预览确认期间 SPA 替换/隐藏了原表格，但旧候选和按钮仍暂时存在。
  page.sections.practice.table.hidden = true;
  const result = await AutofillEngine.AutofillEngine.prototype.prepareEmbeddedCollections.call(
    harness,
    page.main,
    staleContext,
    null,
    'run_stale_topology',
  );

  assert.deepEqual(result, []);
  assert.equal(page.sections.practice.addButton.clickCount, 0);
  assert.equal(page.sections.practice.table.rows.length, 0);
  assert.equal(harness.records.some(item => item.status === 'NEEDS_CONFIRMATION'), true);
});

test('Mutation 后 fresh diagnosis 必须报告 practice groupCount=1 并包含新字段 context', async () => {
  const page = makePage({ practice: 0, language: 1 });
  await ArrayHandler.prepare(sectionContext('practice'), [{}], page.sections.practice, {
    collectionMode: 'repeatable', timeoutMs: 200, maxAdds: 2,
  });
  const resume = {
    practice: [{ startDate: '2025-01', endDate: '2025-02', location: '示例地点', description: '示例内容' }],
    language: [{ certificate: 'CET-6', score: '520' }],
  };
  const diagnosis = freshDiagnosis(page, resume);
  const practiceSection = diagnosis.embeddedSections.find(item => item.collection === 'practice');
  const practiceFields = diagnosis.fields.filter(field => field.context?.collection === 'practice');

  assert.ok(practiceSection, 'fresh diagnosis 缺少 practice');
  assert.equal(practiceSection.groupCount, 1);
  assert.equal(practiceFields.length, 4);
  assert.equal(practiceFields.every(field => field.context.index === 0), true);
  assert.equal(practiceFields.every(field => Boolean(field.context.regionId)), true);
});

test('fresh Browser diagnosis exposes metadata-only zero-row action ownership evidence', () => {
  const page = makePage({
    papers: { rows: 0, addText: '新 增' },
    awards: { rows: 0, addText: '新 增' },
  });
  const diagnosis = freshDiagnosis(page, {
    papers: [{ title: '示例论文' }],
    awards: [{ name: '示例奖项' }],
  });

  for (const collection of ['papers', 'awards']) {
    const section = diagnosis.embeddedSections.find(item => item.collection === collection);
    assert.ok(section?.actionOwnershipDebug, `${collection} 缺少 actionOwnershipDebug`);
    assert.equal(section.actionOwnershipDebug.collection, collection);
    assert.equal(section.actionOwnershipDebug.zeroRow, true);
    assert.equal(section.actionOwnershipDebug.regionRootFound, true);
    assert.equal(section.actionOwnershipDebug.ownerCandidateCount > 0, true);
    assert.notEqual(
      section.actionOwnershipDebug.selectedOwnerDepth,
      null,
      JSON.stringify(section.actionOwnershipDebug),
    );
    assert.equal(section.actionOwnershipDebug.acceptedAddCandidateCount, 1);
    assert.equal(section.actionOwnershipDebug.finalReasonCode, 'ACTION_OWNER_RESOLVED');
  }
  assert.equal(Array.isArray(diagnosis.actionOwnershipDebug), true);
  assert.deepEqual(
    diagnosis.actionOwnershipDebug.map(item => item.collection).sort(),
    ['awards', 'papers'],
  );
  assert.equal(JSON.stringify(diagnosis.actionOwnershipDebug).includes('示例'), false);
});

test('zero-row 机制必须可复用于另一个 collection，而不是写死 practice', async () => {
  const page = makePage({ awards: 0 });
  const harness = embeddedHarness(page, {
    awards: [{ date: '2025-01', name: '示例奖项', level: '国家级', teamRank: '1/3' }],
  });
  const result = await prepareEmbedded(harness, page, 'awards');

  assert.equal(result.length, 1);
  assert.equal(result[0].collection, 'awards');
  assert.equal(result[0].groupContexts.length, 1);
  assert.equal(result[0].groupContexts[0].index, 0);
  assert.equal(page.sections.awards.addButton.clickCount, 1);
  assert.equal(page.sections.awards.table.rows.length, 1);
});

test('既有 repeatable sections 的 context/index/regionId 不回归', () => {
  const expectedCounts = {
    language: 2,
    internships: 2,
    research: 1,
    papers: 2,
    awards: 3,
  };
  const page = makePage(expectedCounts);
  const built = GenericAdapter.buildDiagnosticRegions(
    page.document,
    page.main,
    pageSectionContext(page),
    {},
  );
  const descriptors = globalThis.JFFieldDetector.scan(page.main, {
    section: 'education',
    sectionContext: pageSectionContext(page),
    regions: built.regions,
  });

  for (const [collection, count] of Object.entries(expectedCounts)) {
    const contexts = built.regions
      .filter(region => region.collection === collection && Number.isInteger(region.index))
      .sort((left, right) => left.index - right.index);
    assert.equal(contexts.length, count, collection);
    assert.deepEqual(contexts.map(context => context.index), [...Array(count).keys()], collection);
    assert.equal(new Set(contexts.map(context => context.regionId)).size, count, collection);

    const fieldContexts = descriptors
      .filter(field => field.context?.collection === collection)
      .map(field => field.context);
    assert.equal(fieldContexts.length > 0, true, `${collection} 无字段 context`);
    assert.equal(fieldContexts.every(context => Number.isInteger(context.index)), true, collection);
    assert.equal(fieldContexts.every(context => Boolean(context.regionId)), true, collection);
  }

  assert.equal(descriptors.every(field => !field.name && !field.id), true, '不得借助 fixture name/id 特例');
});
