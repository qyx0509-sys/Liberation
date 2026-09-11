import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Resolver = require('../../src/core/current-section-resolver.js');
const EmbeddedSectionDetector = require('../../src/core/embedded-section-detector.js');
const Autofill = require('../../src/core/autofill-engine.js');

function fieldElement(id) {
  return Object.freeze({ id });
}

function descriptor(labelText, element) {
  return {
    detectorId: `field:${element.id}`,
    element,
    interactionElement: element,
    visible: true,
    hidden: false,
    sensitive: false,
    labelText,
    tableHeader: '',
    ariaLabel: '',
    placeholder: '',
    groupText: '',
    nearbyText: '',
    parentText: '',
  };
}

function tableRegion(id, headers, ownedElements = []) {
  const owned = new Set(ownedElements);
  const region = {
    id,
    nodeType: 1,
    tagName: 'TABLE',
    hidden: false,
    ownerDocument: null,
    children: [],
    matches(selector) {
      return /table|role="table"/.test(selector);
    },
    getAttribute() {
      return null;
    },
    getBoundingClientRect() {
      return { width: 640, height: 160 };
    },
    contains(element) {
      return element === region || owned.has(element);
    },
    querySelectorAll(selector) {
      if (/th|columnheader|first-child/.test(selector)) {
        return headers.map(header => ({
          nodeType: 1,
          innerText: header,
          textContent: header,
          getAttribute() {
            return null;
          },
          closest(selector) {
            return /__jf_|__rf_|data-jiefang-ui/.test(String(selector || ''))
              ? null
              : region;
          },
        }));
      }
      return [];
    },
  };
  return region;
}

function documentFor(regions = []) {
  const document = {
    nodeType: 9,
    defaultView: {
      getComputedStyle() {
        return { display: 'block', visibility: 'visible', opacity: '1' };
      },
    },
    querySelectorAll(selector) {
      return /table|role="table"|fieldset|repeat-list|array-list/.test(selector)
        ? regions
        : [];
    },
  };
  regions.forEach(region => {
    region.ownerDocument = document;
  });
  return document;
}

function fieldAttempt(resolved) {
  return resolved.trace.find(item => item.source === 'field-signature');
}

function assertNoFieldCandidate(resolved, sectionId) {
  assert.equal(
    fieldAttempt(resolved)?.candidates?.some(candidate => candidate.sectionId === sectionId),
    false,
    `${sectionId} 不得由 embedded-owned descriptor 进入 page field-signature`,
  );
}

function assertSelected(resolved, sectionId) {
  assert.equal(resolved.sectionId, sectionId);
  assert.equal(resolved.arbitration?.selected?.sectionId, sectionId);
  assert.equal(resolved.arbitration?.reasonCode, 'SECTION_SELECTED');
}

test('Evidence Isolation Case 1: page 外语成绩不能与 embedded awards 获奖等级拼成 language', () => {
  const pageForeignScore = fieldElement('page-foreign-score');
  const awardLevel = fieldElement('award-level');
  const awardsTable = tableRegion(
    'awards-table',
    ['竞赛级别', '获奖等级', '获奖名称', '个人/团队', '个人排名'],
    [awardLevel],
  );
  const document = documentFor([awardsTable]);
  const embeddedRegions = EmbeddedSectionDetector.detect(document);
  const pageWorkspace = {
    nodeType: 1,
    contains(node) {
      return node === pageForeignScore
        || node === awardsTable
        || awardsTable.contains(node);
    },
  };

  assert.deepEqual(embeddedRegions.map(item => item.collection), ['awards']);

  const resolved = Resolver.resolve({
    document,
    rootNode: pageWorkspace,
    fields: [
      descriptor('外语成绩', pageForeignScore),
      descriptor('获奖等级', awardLevel),
    ],
    embeddedRegions,
    adapterContext: {
      section: 'basic',
      score: 1,
      scope: 'current-page',
      authority: 400,
    },
  });

  assertSelected(resolved, 'basic');
  assertNoFieldCandidate(resolved, 'language');
  assert.ok(resolved.regionCandidates.some(item => item.collection === 'awards'));
});

test('Evidence Isolation Case 2: compound basic 只消费 page-owned descriptors，三个 embedded collections 不参与主签名', () => {
  const mainElements = [
    fieldElement('main-name'),
    fieldElement('main-id-number'),
    fieldElement('main-phone'),
    fieldElement('main-college'),
  ];
  const familyElements = [
    fieldElement('family-name'),
    fieldElement('family-relationship'),
    fieldElement('family-employer'),
  ];
  const paperElements = [
    fieldElement('paper-title'),
    fieldElement('paper-journal'),
  ];
  const awardElements = [
    fieldElement('award-name'),
    fieldElement('award-date'),
  ];

  const familyTable = tableRegion(
    'family-table',
    ['姓名', '与本人关系', '在何单位工作任何职务', '联系电话'],
    familyElements,
  );
  const papersTable = tableRegion(
    'papers-table',
    ['论文题目', '发表期刊', '发表时间', '作者排名'],
    paperElements,
  );
  const awardsTable = tableRegion(
    'awards-table',
    ['竞赛级别', '获奖等级', '获奖名称', '个人/团队', '个人排名'],
    awardElements,
  );
  const document = documentFor([familyTable, papersTable, awardsTable]);
  const embeddedRegions = EmbeddedSectionDetector.detect(document);

  assert.deepEqual(
    embeddedRegions.map(item => item.collection).sort(),
    ['awards', 'family', 'papers'],
  );

  const fields = [
    descriptor('姓名', mainElements[0]),
    descriptor('证件号码', mainElements[1]),
    descriptor('电话', mainElements[2]),
    descriptor('本科院系', mainElements[3]),
    descriptor('姓名', familyElements[0]),
    descriptor('与本人关系', familyElements[1]),
    descriptor('在何单位工作任何职务', familyElements[2]),
    descriptor('论文题目', paperElements[0]),
    descriptor('发表期刊', paperElements[1]),
    descriptor('获奖名称', awardElements[0]),
    descriptor('获奖时间', awardElements[1]),
  ];

  const resolved = Resolver.resolve({
    document,
    fields,
    embeddedRegions,
    adapterContext: {
      section: 'basic',
      score: 1,
      scope: 'current-page',
      authority: 400,
    },
  });

  assertSelected(resolved, 'basic');
  assert.deepEqual(fieldAttempt(resolved)?.candidates || [], []);
  assert.deepEqual(
    resolved.regionCandidates.map(item => item.collection).sort(),
    ['awards', 'family', 'papers'],
  );
});

test('Evidence Isolation Case 3: 无 embedded contamination 的真实 language page 仍可识别', () => {
  const labels = ['语言种类', '考试名称', '等级', '成绩'];
  const fields = labels.map((label, index) => descriptor(label, fieldElement(`language-${index}`)));
  const resolved = Resolver.resolve({
    document: documentFor([]),
    fields,
    embeddedRegions: [],
  });

  assertSelected(resolved, 'language');
  assert.equal(fieldAttempt(resolved)?.accepted, true);
  assert.ok(fieldAttempt(resolved)?.candidates?.some(candidate => candidate.sectionId === 'language'));
});

test('Evidence Isolation Case 4: embedded language 继续被识别，但不能覆盖 basic 主页面', () => {
  const languageElements = [
    fieldElement('embedded-language-kind'),
    fieldElement('embedded-language-exam'),
    fieldElement('embedded-language-level'),
    fieldElement('embedded-language-score'),
  ];
  const languageTable = tableRegion(
    'language-table',
    ['语言种类', '考试名称', '等级', '成绩'],
    languageElements,
  );
  const document = documentFor([languageTable]);
  const embeddedRegions = EmbeddedSectionDetector.detect(document);

  assert.deepEqual(embeddedRegions.map(item => item.collection), ['language']);

  const resolved = Resolver.resolve({
    document,
    fields: [
      descriptor('姓名', fieldElement('main-name')),
      descriptor('证件号码', fieldElement('main-id-number')),
      descriptor('电话', fieldElement('main-phone')),
      descriptor('语言种类', languageElements[0]),
      descriptor('考试名称', languageElements[1]),
      descriptor('等级', languageElements[2]),
      descriptor('成绩', languageElements[3]),
    ],
    embeddedRegions,
    adapterContext: {
      section: 'basic',
      score: 1,
      scope: 'current-page',
      authority: 400,
    },
  });

  assertSelected(resolved, 'basic');
  assertNoFieldCandidate(resolved, 'language');
  assert.ok(resolved.regionCandidates.some(item => item.collection === 'language'));
});

test('Legacy compatibility: 未提供 embeddedRegions 且 descriptor 无 element 时保留旧 field-signature 判断', () => {
  const languageTable = tableRegion(
    'language-main-table',
    ['语言种类', '考试名称', '等级', '成绩'],
  );
  const document = documentFor([languageTable]);
  const fields = ['语言种类', '考试名称', '等级', '成绩'].map(labelText => ({
    detectorId: `legacy:${labelText}`,
    visible: true,
    hidden: false,
    labelText,
    tableHeader: '',
    ariaLabel: '',
    placeholder: '',
    groupText: '',
    nearbyText: '',
    parentText: '',
  }));

  const resolved = Resolver.resolve({ document, fields });

  assertSelected(resolved, 'language');
  assert.equal(resolved.source, 'field-signature');
  assert.equal(resolved.regionCandidates.some(item => item.collection === 'language'), false);
});

test('Engine canonical collection: internship 主栏目不得被 internships topology 重新加回 embedded', async () => {
  const internshipField = fieldElement('internship-company');
  const internshipTable = tableRegion(
    'internships-main-table',
    ['起始年月', '结束年月', '学习工作单位', '担任职务'],
    [internshipField],
  );
  const document = documentFor([internshipTable]);
  document.title = '实习经历';
  const embedded = EmbeddedSectionDetector.detect(document);
  assert.deepEqual(embedded.map(item => item.sectionId), ['internships']);

  const field = descriptor('学习工作单位', internshipField);
  const harness = {
    document,
    resume: {},
    resumeView: {},
    config: { sections: {}, fieldAliases: {} },
    navigation: {
      scan() { return []; },
      buildQueue() { return []; },
    },
    adapter: {
      detectCurrentSection() {
        return { section: 'internship', score: 1, source: 'heading' };
      },
      findContentRoot() { return document; },
      scanFields() { return [field]; },
    },
    async refreshData() {},
    async setState() {},
  };

  const inspection = await Autofill.AutofillEngine.prototype.inspectSystem.call(
    harness,
    { scanId: 'scan:canonical-main-section', timeoutMs: 100 },
  );

  assert.equal(inspection.sectionContext.sectionId, 'internship');
  assert.equal(inspection.sectionContext.collection, 'internships');
  assert.equal(inspection.fields.length, 1, '主栏目字段不得被同 collection topology 排除');
  assert.equal(
    inspection.sectionContext.regionCandidates.some(item => item.collection === 'internships'),
    false,
    '主栏目 collection 不得同时成为 embedded region',
  );
});

test('Unique repeatable workspace: 无导航时唯一 family 工作区安全提升为主栏目', () => {
  const familyElements = [
    fieldElement('family-name'),
    fieldElement('family-relationship'),
    fieldElement('family-employer'),
    fieldElement('family-phone'),
  ];
  const familyTable = tableRegion(
    'family-main-table',
    ['姓名', '关系', '在何单位工作任何职务', '联系电话'],
    familyElements,
  );
  const document = documentFor([familyTable]);
  const workspace = {
    nodeType: 1,
    contains(node) {
      return node === familyTable || familyTable.contains(node);
    },
  };
  const fields = [
    descriptor('姓名', familyElements[0]),
    descriptor('关系', familyElements[1]),
    descriptor('在何单位工作，任何职务', familyElements[2]),
    descriptor('联系电话', familyElements[3]),
  ];
  const embeddedRegions = EmbeddedSectionDetector.detect(document);
  assert.deepEqual(embeddedRegions.map(item => item.collection), ['family']);

  for (const options of [
    {},
    { embeddedRegions },
  ]) {
    const resolved = Resolver.resolve({
      document,
      rootNode: workspace,
      navigationItems: [],
      headings: [],
      breadcrumbs: [],
      formTitles: [],
      fields,
      adapterResult: null,
      ...options,
    });

    assertSelected(resolved, 'family');
    assert.equal(resolved.source, 'field-signature');
    assert.equal(resolved.collection, 'family');
    assert.equal(resolved.regionCandidates.some(item => item.collection === 'family'), false);
  }
});

function unsafeFamilyPromotionScenario(options = {}) {
  const includeFamilyFields = options.includeFamilyFields !== false;
  const familyElements = includeFamilyFields
    ? [
        fieldElement('unsafe-family-name'),
        fieldElement('unsafe-family-relationship'),
        fieldElement('unsafe-family-employer'),
        fieldElement('unsafe-family-phone'),
      ]
    : [];
  const familyTable = tableRegion(
    'unsafe-family-table',
    ['姓名', '关系', '在何单位工作任何职务', '联系电话'],
    familyElements,
  );
  const document = documentFor([familyTable]);
  const detected = EmbeddedSectionDetector.detect(document);
  assert.equal(detected.length, 1);
  Object.assign(familyTable, options.rootOverrides || {});

  const outsideElements = [];
  const fields = includeFamilyFields
    ? [
        descriptor('姓名', familyElements[0]),
        descriptor('关系', familyElements[1]),
        descriptor('在何单位工作，任何职务', familyElements[2]),
        descriptor('联系电话', familyElements[3]),
      ]
    : [];
  if (options.outsideSensitive) {
    const otp = fieldElement('outside-sensitive-otp');
    outsideElements.push(otp);
    fields.push({
      ...descriptor('验证码', otp),
      sensitive: true,
      type: 'password',
      controlKind: 'text',
    });
  }

  const workspace = {
    nodeType: 1,
    contains(node) {
      return node === familyTable
        || familyTable.contains(node)
        || outsideElements.includes(node);
    },
  };
  const embeddedRegions = [{
    ...detected[0],
    ...(options.regionOverrides || {}),
    runtimeRoot: familyTable,
  }];

  return Resolver.resolve({
    document,
    rootNode: workspace,
    navigationItems: [],
    headings: [],
    breadcrumbs: [],
    formTitles: [],
    fields,
    embeddedRegions,
    adapterResult: null,
  });
}

for (const safetyCase of [
  {
    name: 'disconnected/stale region',
    options: { rootOverrides: { isConnected: false } },
  },
  {
    name: 'hidden region',
    options: { rootOverrides: { hidden: true } },
  },
  {
    name: 'weak-confidence region',
    options: { regionOverrides: { confidence: 0.2 } },
  },
  {
    name: 'nested-only evidence region',
    options: {
      regionOverrides: {
        evidenceScope: 'nested',
        ownedHeaderCount: 0,
        ownedEvidenceCount: 0,
        nestedHeaderCount: 4,
      },
    },
  },
  {
    name: 'unqualified region',
    options: { regionOverrides: { qualificationReason: 'UNQUALIFIED_STRUCTURE' } },
  },
  {
    name: 'visible sensitive descriptor outside region',
    options: { outsideSensitive: true },
  },
]) {
  test(`Unique repeatable workspace safety: reject ${safetyCase.name}`, () => {
    const resolved = unsafeFamilyPromotionScenario(safetyCase.options);
    assert.equal(resolved.sectionId, null);
    assert.equal(resolved.arbitration.reasonCode, 'NO_ACCEPTED_SECTION');
    assert.ok(resolved.regionCandidates.some(item => item.collection === 'family'));
  });
}

test('Unique repeatable workspace safety: zero-row unique table remains topology only', () => {
  const resolved = unsafeFamilyPromotionScenario({ includeFamilyFields: false });
  assert.equal(resolved.sectionId, null);
  assert.equal(resolved.arbitration.reasonCode, 'NO_ACCEPTED_SECTION');
  assert.ok(resolved.regionCandidates.some(item =>
    item.collection === 'family' && item.zeroRow === true
  ));
});
