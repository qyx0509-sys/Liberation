import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const testDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(testDirectory, '..', '..');

const Fields = require('../../src/mappings/field-aliases.js');
const Structures = require('../../src/mappings/section-structures.js');
const FieldContext = require('../../src/core/field-context.js');
const FieldDetector = require('../../src/core/field-detector.js');
const FieldMatcher = require('../../src/core/field-matcher.js');
const EmbeddedSectionDetector = require('../../src/core/embedded-section-detector.js');
const CurrentSectionResolver = require('../../src/core/current-section-resolver.js');

function headerNode(value) {
  return {
    tagName: 'TH',
    innerText: value,
    textContent: value,
    getAttribute() { return null; },
  };
}

function fieldElement() {
  return {
    tagName: 'INPUT',
    type: 'text',
    value: '',
    hidden: false,
    disabled: false,
    readOnly: false,
    isConnected: true,
    ownerDocument: null,
    getAttribute() { return null; },
    closest() { return null; },
    getBoundingClientRect() { return { width: 240, height: 32, left: 0, top: 0 }; },
  };
}

function descriptor(detectorId, tableHeader, element) {
  return {
    detectorId,
    element,
    interactionElement: element,
    elements: [element],
    section: 'education',
    tagName: 'input',
    controlKind: 'text',
    baseControlKind: 'text',
    type: 'text',
    inputType: 'text',
    labelText: '',
    tableHeader,
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

function selectorRequestsControls(selector) {
  return /input|textarea|select|contenteditable|combobox/.test(String(selector));
}

function selectorRequestsRegions(selector) {
  return /(?:^|,)(?:table|\[role="table"\]|fieldset|\[data-repeat-list\]|\[data-array-list\])(?:,|$)/.test(String(selector));
}

function createRegion(sectionId, headers, elements) {
  const region = {
    tagName: 'TABLE',
    sectionId,
    hidden: false,
    ownerDocument: null,
    innerText: headers.join(' '),
    textContent: headers.join(' '),
    contains(node) { return elements.includes(node); },
    getAttribute() { return null; },
    getBoundingClientRect() { return { width: 800, height: 180, left: 0, top: 0 }; },
    querySelector() { return null; },
    querySelectorAll(selector) {
      if (/th|columnheader|first-child/.test(String(selector))) return headers.map(headerNode);
      if (selectorRequestsControls(selector)) return elements;
      return [];
    },
  };
  return region;
}

function createFixture() {
  const fieldSpecs = [
    // education 主表单
    ['field_0', '所在学校', 'education-main'],
    ['field_1', '所在院系', 'education-main'],
    ['field_2', '所在专业', 'education-main'],
    ['field_3', '指导教师', 'education-main'],
    ['field_4', '成绩排名', 'education-main'],

    // embedded language
    ['field_5', '考试名称', 'language'],
    ['field_6', '成绩', 'language'],

    // embedded research
    ['field_7', '名称', 'research'],
    ['field_8', '指导教师', 'research'],
    ['field_9', '级别', 'research'],
    ['field_10', '主要贡献', 'research'],

    // embedded papers / awards / practice
    ['field_11', '作者排名', 'papers'],
    ['field_12', '排名（排名/团队人数，单人奖项填写1/1）', 'awards'],
    ['field_13', '地点', 'practice'],
    ['field_14', '主要内容', 'practice'],
    ['field_15', '获奖等级', 'awards'],
  ];

  const elements = fieldSpecs.map(() => fieldElement());
  const rawFields = fieldSpecs.map(([detectorId, label], index) =>
    descriptor(detectorId, label, elements[index]));

  const elementsFor = sectionId => fieldSpecs
    .map(([, , section], index) => (section === sectionId ? elements[index] : null))
    .filter(Boolean);

  const regions = [
    createRegion('language', ['考试名称', '成绩'], elementsFor('language')),
    createRegion('research', ['名称', '指导教师', '级别', '主要贡献'], elementsFor('research')),
    createRegion('papers', ['发表时间', '发表刊物或出版社', '成果名称', '作者排名'], elementsFor('papers')),
    createRegion('awards', ['时间', '内容', '级别', '排名（排名/团队人数，单人奖项填写1/1）'], elementsFor('awards')),
    createRegion('practice', ['开始时间', '结束时间', '地点', '主要内容'], elementsFor('practice')),
  ];

  const defaultView = {
    getComputedStyle() { return { display: 'block', visibility: 'visible', opacity: '1' }; },
  };
  const heading = {
    textContent: '教育信息',
    innerText: '教育信息',
    hidden: false,
    isConnected: true,
    ownerDocument: null,
    getAttribute() { return null; },
    closest() { return null; },
  };
  const mainRoot = {
    tagName: 'MAIN',
    hidden: false,
    isConnected: true,
    ownerDocument: null,
    contains(node) { return elements.includes(node) || regions.includes(node); },
    getAttribute() { return null; },
    closest() { return null; },
    querySelector() { return null; },
    querySelectorAll(selector) {
      if (selectorRequestsRegions(selector)) return regions;
      if (selectorRequestsControls(selector)) return elements;
      return [];
    },
  };
  const document = {
    nodeType: 9,
    title: '示例申请系统 - 教育信息',
    location: { href: 'https://example.test/application/edit' },
    defaultView,
    body: null,
    documentElement: null,
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
    querySelectorAll(selector) {
      const source = String(selector);
      if (source === 'table,[role="table"],fieldset,[data-repeat-list],[data-array-list]') return regions;
      if (/^main,\[role="main"\],form,article/.test(source)) return [mainRoot];
      if (/^h1,h2,h3/.test(source)) return [heading];
      if (selectorRequestsControls(source)) return elements;
      return [];
    },
  };
  document.body = mainRoot;
  document.documentElement = mainRoot;
  mainRoot.ownerDocument = document;
  heading.ownerDocument = document;
  elements.forEach(element => { element.ownerDocument = document; });
  regions.forEach(region => { region.ownerDocument = document; });

  const resume = {
    education: [{
      school: '示例大学', college: '示例学院', major: '示例专业',
      advisor: '教育导师', rank: '3', cet4Score: '510',
    }],
    language: [{ certificate: 'CET-6', score: '520' }],
    research: [{ name: '科研课题', advisor: '科研导师', level: '国家级', contribution: '负责实验' }],
    papers: [{ title: '示例论文', journal: '示例期刊', date: '2025-01', authorRank: '1' }],
    awards: [{ name: '示例奖项', date: '2025-01', level: '国家级', rank: '一等奖', teamRank: '1/3' }],
    practice: [{ startDate: '2024-01', endDate: '2024-02', location: '示例地点', description: '示例实践内容' }],
  };
  const resumeView = Fields.buildResumeView(resume);

  const navigationEngine = {
    scan() {
      return [{
        sectionId: 'education', label: '教育信息', text: '教育信息',
        confidence: 0.99, active: true, safe: true, reasonCode: 'SAFE_NAVIGATION',
      }];
    },
    scanDetailed() { return { items: this.scan(), candidates: [] }; },
  };

  const mainContext = {
    sectionId: 'education',
    label: '教育信息',
    source: 'navigation',
    confidence: 0.99,
    collection: 'education',
    collectionMode: 'singleton-view',
    indexContext: null,
  };

  return {
    document,
    mainRoot,
    rawFields,
    resume,
    resumeView,
    navigationEngine,
    mainContext,
  };
}

const fixture = createFixture();

// GenericAdapter 的 UMD 依赖来自同一个 runtime root。Detector 的 scan 保留
// 真实 FieldContext.resolve 路径，仅省去与本契约无关的浏览器 DOM label 提取。
globalThis.JFSectionStructures = Structures;
globalThis.JFFieldContext = FieldContext;
globalThis.JFFieldMatcher = FieldMatcher;
globalThis.JFEmbeddedSectionDetector = EmbeddedSectionDetector;
globalThis.JFCurrentSectionResolver = CurrentSectionResolver;
globalThis.JFFieldDetector = {
  ...FieldDetector,
  scan(_rootNode, settings = {}) {
    const regions = settings.regionCandidates || settings.embeddedRegions || settings.regions || [];
    return fixture.rawFields.map(raw => {
      const field = { ...raw, section: settings.section || 'education' };
      if (regions.length && FieldContext?.resolve) field.context = FieldContext.resolve(field, regions);
      return field;
    });
  },
};
globalThis.JFFileFieldDetector = { scan() { return []; }, toDiagnostic() { return null; } };
globalThis.JFArrayHandler = {
  detectGroups(rootNode) { return rootNode ? [rootNode] : []; },
  mapGroups(sectionOrContext, groups = []) {
    const section = sectionOrContext?.sectionId || sectionOrContext?.collection || sectionOrContext || '';
    const collection = sectionOrContext?.collection || section;
    return groups.map((element, index) => ({
      element,
      section,
      collection,
      index,
      indexContext: { section, collection, index, [collection]: index },
    }));
  },
};

const GenericAdapter = require('../../src/adapters/generic-adapter.js');
const adapter = GenericAdapter.createAdapter(fixture.document, {
  navigationEngine: fixture.navigationEngine,
});
const diagnosis = adapter.diagnose({
  resume: fixture.resume,
  resumeView: fixture.resumeView,
  sectionContext: fixture.mainContext,
});

function diagnosed(detectorId) {
  const field = diagnosis.fields.find(item => item.detectorId === detectorId);
  assert.ok(field, `诊断结果缺少 ${detectorId}`);
  return field;
}

function assertContext(field, expectedCollection) {
  assert.ok(field.context && typeof field.context === 'object', `${field.detectorId} 缺少诊断 context`);
  assert.equal(field.context.sectionId, expectedCollection, `${field.detectorId} sectionId`);
  assert.equal(field.context.collection, expectedCollection, `${field.detectorId} collection`);
  if (expectedCollection === 'education') {
    assert.equal(field.context.source, 'navigation', `${field.detectorId} source`);
  } else {
    assert.equal(field.context.source, 'embedded-structure', `${field.detectorId} source`);
    assert.ok(field.context.regionId, `${field.detectorId} embedded context 缺少 regionId`);
  }
}

function assertPath(detectorId, expectedPath, expectedCollection, forbiddenPaths = []) {
  const field = diagnosed(detectorId);
  assert.equal(field.matchedJsonPath, expectedPath, `${detectorId}: ${field.reason}`);
  assertContext(field, expectedCollection);
  for (const forbidden of forbiddenPaths) assert.notEqual(field.matchedJsonPath, forbidden, detectorId);
  return field;
}

test('diagnosis: language embedded 的考试名称/成绩保持 language context，不误匹配 education CET4', () => {
  assertPath('field_5', 'language[].certificate', 'language', ['education[].cet4Score']);
  assertPath('field_6', 'language[].score', 'language', ['education[].cet4Score', 'education[].percentageScore']);
});

test('diagnosis: research 的名称/指导教师/级别/主要贡献不借用 education 字段', () => {
  assertPath('field_7', 'research[].name', 'research', ['education[].college']);
  assertPath('field_8', 'research[].advisor', 'research', ['education[].advisor']);
  assertPath('field_9', 'research[].level', 'research');
  assertPath('field_10', 'research[].contribution', 'research');
});

test('diagnosis: papers 作者排名必须保持 papers.authorRank，不能降级为 education.rank', () => {
  assertPath('field_11', 'papers[].authorRank', 'papers', ['education[].rank']);
});

test('diagnosis: awards 团队排名必须映射 teamRank，不能误用 education.rank 或 awards.rank', () => {
  assertPath('field_12', 'awards[].teamRank', 'awards', ['education[].rank', 'awards[].rank']);
  assertPath('field_15', 'awards[].rank', 'awards', ['education[].rank', 'awards[].teamRank']);
});

test('diagnosis: practice 的地点/主要内容保持 practice context', () => {
  assertPath('field_13', 'practice[].location', 'practice', ['awards[].location']);
  assertPath('field_14', 'practice[].description', 'practice', ['awards[].name']);
});

test('diagnosis: education 主字段不被同页 embedded regions 污染', () => {
  const cases = [
    ['field_0', 'education[].school'],
    ['field_1', 'education[].college'],
    ['field_2', 'education[].major'],
    ['field_3', 'education[].advisor'],
    ['field_4', 'education[].rank'],
  ];
  for (const [detectorId, path] of cases) assertPath(detectorId, path, 'education');
});

test('diagnosis: education singleton-view 必须合成 index 0，不因缺少 group index 要求人工确认', () => {
  const school = diagnosed('field_0');
  assert.equal(school.status, 'MATCHED', school.reason);
  assert.equal(school.matchedJsonPath, 'education[].school');
  assertContext(school, 'education');
  assert.equal(school.context.collectionMode, 'singleton-view');
  assert.equal(school.context.indexContext?.index ?? school.context.index, 0);
  assert.equal(school.context.indexContext?.section || school.context.sectionId, 'education');
});

test('diagnosis 与 runtime matcher 在同页 education/language/research/awards 上使用同一 collection 语义', () => {
  assert.equal(diagnosis.section.detected, 'education');
  assert.equal(fixture.rawFields.every(field => !field.name && !field.id), true, '测试不得借助 name/id 特例');
  assert.deepEqual(
    EmbeddedSectionDetector.detect(fixture.document).map(item => item.collection).sort(),
    ['awards', 'language', 'papers', 'practice', 'research'],
  );
  const cases = [
    ['field_0', 'education', 'singleton-view'],
    ['field_5', 'language', 'repeatable'],
    ['field_7', 'research', 'repeatable'],
    ['field_12', 'awards', 'repeatable'],
  ];

  for (const [detectorId, collection, collectionMode] of cases) {
    const raw = fixture.rawFields.find(field => field.detectorId === detectorId);
    const diagnosticField = diagnosed(detectorId);
    const runtimeContext = {
      sectionId: collection,
      collection,
      collectionMode,
      source: collection === 'education' ? 'navigation' : 'embedded-structure',
      confidence: 0.95,
      indexContext: { section: collection, collection, index: 0, [collection]: 0 },
    };
    const runtimeMatch = FieldMatcher.matchField(raw, fixture.resume, {
      resumeView: fixture.resumeView,
      sectionContext: runtimeContext,
    });
    assert.equal(diagnosticField.matchedJsonPath, runtimeMatch.matchedPath, detectorId);
    assert.equal(diagnosticField.context.collection, runtimeMatch.scope.collection, detectorId);
  }

  assert.deepEqual(
    cases.map(([detectorId]) => diagnosed(detectorId).context.collection),
    ['education', 'language', 'research', 'awards'],
  );
});

test('FieldContext 进入生产注入、构建契约、fail-closed 与浏览器 E2E 运行清单', async () => {
  const [popup, build, controller, wizard, tongji] = await Promise.all([
    readFile(resolve(projectRoot, 'popup.js'), 'utf8'),
    readFile(resolve(projectRoot, 'scripts', 'build.mjs'), 'utf8'),
    readFile(resolve(projectRoot, 'src', 'content-controller.js'), 'utf8'),
    readFile(resolve(projectRoot, 'tests', 'e2e', 'wizard.e2e.mjs'), 'utf8'),
    readFile(resolve(projectRoot, 'tests', 'e2e', 'tongji-like.e2e.mjs'), 'utf8'),
  ]);

  const popupContext = popup.indexOf("'src/core/field-context.js'");
  const popupEmbedded = popup.indexOf("'src/core/embedded-section-detector.js'");
  const popupDetector = popup.indexOf("'src/core/field-detector.js'");
  assert.ok(popupEmbedded >= 0 && popupEmbedded < popupContext);
  assert.ok(popupContext >= 0 && popupContext < popupDetector);
  assert.match(build, /src\/core\/field-context\.js/);
  assert.match(build, /src\/core\/embedded-section-detector\.js/);
  assert.match(controller, /['"]JFFieldContext['"]/);

  for (const source of [wizard, tongji]) {
    const contextIndex = source.indexOf("'src/core/field-context.js'");
    const detectorIndex = source.indexOf("'src/core/field-detector.js'");
    assert.ok(contextIndex >= 0 && contextIndex < detectorIndex);
  }
});
