import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Fields = require('../../src/mappings/field-aliases.js');
const FieldContext = require('../../src/core/field-context.js');
const Matcher = require('../../src/core/field-matcher.js');
const Options = require('../../src/mappings/option-aliases.js');
const GenericAdapter = require('../../src/adapters/generic-adapter.js');

function sectionContext(collection, collectionMode = 'record', index = null, extra = {}) {
  return {
    section: collection,
    sectionId: collection,
    collection,
    collectionMode,
    source: 'phase3-5-completion-fixture',
    confidence: 1,
    indexContext: Number.isInteger(index)
      ? { section: collection, collection, index, [collection]: index }
      : null,
    ...extra,
  };
}

function descriptor(labelText, controlKind = 'text', context = sectionContext('basic'), extra = {}) {
  return {
    detectorId: `phase35-completion-${labelText}`,
    element: {},
    visible: true,
    hidden: false,
    disabled: false,
    readOnly: false,
    sensitive: false,
    maskedDisplay: false,
    labelText,
    tableHeader: '',
    ariaLabel: '',
    semanticPlaceholder: '',
    placeholder: '',
    name: '',
    id: '',
    title: '',
    groupText: '',
    nearbyText: '',
    parentText: '',
    controlKind,
    baseControlKind: controlKind,
    context,
    ...extra,
  };
}

function structuralRoot(tagName, attributes = {}) {
  return {
    nodeType: 1,
    tagName: String(tagName).toUpperCase(),
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(attributes, name)
        ? String(attributes[name])
        : null;
    },
  };
}

function elementWithin(root) {
  return {
    nodeType: 1,
    closest() { return root; },
  };
}

const oneLanguage = {
  language: [{ language: '英语', certificate: '大学英语六级', score: '600' }],
};

const twoLanguages = {
  language: [
    { language: '英语', certificate: '大学英语六级', score: '600' },
    { language: '日语', certificate: '日本语能力测试 N1', score: '160' },
  ],
};

test('Phase 3.5 Completion: one JSON item binds a singleton language page slot to index 0 with metadata-only diagnostics', () => {
  const match = Matcher.matchField(descriptor('外语成绩'), oneLanguage, { section: 'basic' });

  assert.equal(match.status, 'MATCHED', match.reason);
  assert.equal(match.matchedPath, 'language[].score');
  assert.equal(match.value, '600');
  assert.deepEqual(match.singletonBindingDebug, {
    collection: 'language',
    pageSlotCount: 1,
    jsonItemCount: 1,
    discriminator: null,
    candidateIndexes: [0],
    selectedIndex: 0,
    reasonCode: 'SINGLETON_SINGLE_JSON_ITEM',
  });
  assert.doesNotMatch(JSON.stringify(match.singletonBindingDebug), /英语|600/);
});

test('Phase 3.5 Completion: Generic diagnosis preserves only the singleton binding metadata whitelist', () => {
  const fields = [{ detectorId: 'language-score', labelText: '外语成绩' }];
  const matches = [{
    descriptor: { detectorId: 'language-score' },
    status: 'MATCHED',
    matchedPath: 'language[].score',
    score: 96,
    singletonBindingDebug: {
      collection: 'language',
      pageSlotCount: 1,
      jsonItemCount: 2,
      discriminator: {
        fieldPath: 'language[].language',
        source: 'page-field-current-value',
        value: 'PRIVATE_LANGUAGE_VALUE',
      },
      candidateIndexes: [1],
      selectedIndex: 1,
      reasonCode: 'UNIQUE_DISCRIMINATOR_MATCH',
      resumeValue: 'PRIVATE_SCORE_VALUE',
      element: { nodeType: 1 },
    },
  }];

  const [diagnostic] = GenericAdapter.attachFieldMatchDiagnostics(fields, matches);
  assert.deepEqual(diagnostic.singletonBindingDebug, {
    collection: 'language',
    pageSlotCount: 1,
    jsonItemCount: 2,
    discriminator: {
      fieldPath: 'language[].language',
      source: 'page-field-current-value',
    },
    candidateIndexes: [1],
    selectedIndex: 1,
    reasonCode: 'UNIQUE_DISCRIMINATOR_MATCH',
  });
  assert.doesNotMatch(JSON.stringify(diagnostic), /PRIVATE_LANGUAGE_VALUE|PRIVATE_SCORE_VALUE|nodeType/);
});

test('Phase 3.5 Completion: a unique canonical page discriminator selects the matching language item instead of page order', () => {
  const match = Matcher.matchField(descriptor('外语成绩'), twoLanguages, {
    section: 'basic',
    singletonDiscriminator: {
      fieldPath: 'language[].language',
      value: '日语',
      source: 'page-static-requirement',
    },
  });

  assert.equal(match.status, 'MATCHED', match.reason);
  assert.equal(match.matchedPath, 'language[].score');
  assert.equal(match.value, '160');
  assert.equal(match.scope?.index, 1);
  assert.deepEqual(match.singletonBindingDebug, {
    collection: 'language',
    pageSlotCount: 1,
    jsonItemCount: 2,
    discriminator: {
      fieldPath: 'language[].language',
      source: 'page-static-requirement',
    },
    candidateIndexes: [1],
    selectedIndex: 1,
    reasonCode: 'UNIQUE_DISCRIMINATOR_MATCH',
  });
  assert.doesNotMatch(JSON.stringify(match.singletonBindingDebug), /日语|160/);
});

test('Phase 3.5 Completion: a certificate/exam discriminator uses the canonical language certificate field', () => {
  const match = Matcher.matchField(descriptor('外语成绩'), twoLanguages, {
    section: 'basic',
    singletonDiscriminator: {
      fieldPath: 'language[].certificate',
      value: '日本语能力测试 N1',
      source: 'page-static-certificate',
    },
  });

  assert.equal(match.status, 'MATCHED', match.reason);
  assert.equal(match.value, '160');
  assert.equal(match.singletonBindingDebug?.selectedIndex, 1);
  assert.equal(match.singletonBindingDebug?.discriminator?.fieldPath, 'language[].certificate');
});

test('Phase 3.5 Completion: matchFields derives a unique invocation-local discriminator from an existing page language type', () => {
  const singleSlot = sectionContext('basic', 'record', null, { singletonSlotId: 'language-slot:single' });
  const languageType = descriptor('外语类型', 'custom-select', singleSlot, {
    currentValue: '日语',
  });
  const languageScore = descriptor('外语成绩', 'text', singleSlot);
  const matches = Matcher.matchFields([languageType, languageScore], twoLanguages, { section: 'basic' });

  assert.equal(matches[0].status, 'MATCHED', matches[0].reason);
  assert.equal(matches[0].matchedPath, 'language[].language');
  assert.equal(matches[0].value, '日语');
  assert.equal(matches[1].status, 'MATCHED', matches[1].reason);
  assert.equal(matches[1].matchedPath, 'language[].score');
  assert.equal(matches[1].value, '160');
  assert.equal(matches[1].singletonBindingDebug?.selectedIndex, 1);
  assert.equal(
    matches[1].singletonBindingDebug?.discriminator?.source,
    'page-field-current-value',
  );
  assert.doesNotMatch(JSON.stringify(matches[1].singletonBindingDebug), /日语|160/);

  const nextInvocation = Matcher.matchFields(
    [
      descriptor('外语类型', 'custom-select', singleSlot),
      descriptor('外语成绩', 'text', singleSlot),
    ],
    twoLanguages,
    { section: 'basic' },
  );
  assert.equal(nextInvocation[0].status, 'NEEDS_CONFIRMATION');
  assert.equal(nextInvocation[1].status, 'NEEDS_CONFIRMATION');
  assert.equal(nextInvocation[1].singletonBindingDebug?.reasonCode, 'NO_DISCRIMINATOR');
});

test('Phase 3.5 Completion: multiple language items without a discriminator never default to index 0', () => {
  const match = Matcher.matchField(descriptor('外语成绩'), twoLanguages, { section: 'basic' });

  assert.equal(match.status, 'NEEDS_CONFIRMATION', match.reason);
  assert.equal(match.matchedPath, 'language[].score');
  assert.equal(match.singletonBindingDebug?.selectedIndex, null);
  assert.deepEqual(match.singletonBindingDebug?.candidateIndexes, []);
  assert.equal(match.singletonBindingDebug?.reasonCode, 'NO_DISCRIMINATOR');
});

test('Phase 3.5 Completion: the implicit binding policy is disabled when the page does not have exactly one slot', () => {
  const match = Matcher.matchField(descriptor('外语成绩'), oneLanguage, {
    section: 'basic',
    singletonPageSlotCount: 2,
  });

  assert.equal(match.status, 'NEEDS_CONFIRMATION', match.reason);
  assert.equal(match.singletonBindingDebug?.pageSlotCount, 2);
  assert.equal(match.singletonBindingDebug?.selectedIndex, null);
  assert.equal(
    match.singletonBindingDebug?.reasonCode,
    'PAGE_SLOT_COUNT_NOT_SINGLETON',
  );
});

test('Phase 3.5 Completion: batch matching derives two page slots and never binds the first group by DOM order', () => {
  const descriptors = [
    descriptor('\u5916\u8bed\u7c7b\u578b', 'custom-select', sectionContext('basic', 'record', null, { singletonSlotId: 'language-slot:0' }), { detectorId: 'language-0' }),
    descriptor('\u5916\u8bed\u6210\u7ee9', 'text', sectionContext('basic', 'record', null, { singletonSlotId: 'language-slot:0' }), { detectorId: 'score-0' }),
    descriptor('\u5916\u8bed\u7c7b\u578b', 'custom-select', sectionContext('basic', 'record', null, { singletonSlotId: 'language-slot:1' }), { detectorId: 'language-1' }),
    descriptor('\u5916\u8bed\u6210\u7ee9', 'text', sectionContext('basic', 'record', null, { singletonSlotId: 'language-slot:1' }), { detectorId: 'score-1' }),
  ];

  const matches = Matcher.matchFields(descriptors, oneLanguage, { section: 'basic' });

  assert.equal(matches.length, 4);
  assert.equal(matches.filter(match => match.status === 'MATCHED').length, 0, JSON.stringify(matches));
  const semanticMatches = matches.filter(match => match.singletonBindingDebug);
  assert.ok(semanticMatches.length >= 2, JSON.stringify(matches));
  for (const match of semanticMatches) {
    assert.equal(match.status, 'NEEDS_CONFIRMATION', JSON.stringify(match));
    assert.equal(match.singletonBindingDebug?.pageSlotCount, 2);
    assert.equal(match.singletonBindingDebug?.selectedIndex, null);
    assert.equal(
      match.singletonBindingDebug?.reasonCode,
      'PAGE_SLOT_COUNT_NOT_SINGLETON',
    );
  }
});

test('Phase 3.5 Completion: asymmetric structural slots never collapse through max duplicate field-path counting', () => {
  const descriptors = [
    descriptor('\u5916\u8bed\u7c7b\u578b', 'custom-select', sectionContext('basic', 'record', null, {
      singletonSlotId: 'language-slot:type-only',
    }), { detectorId: 'language-type-only-slot' }),
    descriptor('\u5916\u8bed\u6210\u7ee9', 'text', sectionContext('basic', 'record', null, {
      singletonSlotId: 'language-slot:score-only',
    }), { detectorId: 'language-score-only-slot' }),
  ];

  const matches = Matcher.matchFields(descriptors, oneLanguage, { section: 'basic' });

  assert.equal(matches.filter(match => match.status === 'MATCHED').length, 0, JSON.stringify(matches));
  assert.equal(matches.length, 2);
  for (const match of matches) {
    assert.equal(match.status, 'NEEDS_CONFIRMATION', JSON.stringify(match));
    assert.equal(match.singletonBindingDebug?.pageSlotCount, 2);
    assert.equal(match.singletonBindingDebug?.selectedIndex, null);
    assert.equal(
      match.singletonBindingDebug?.reasonCode,
      'PAGE_SLOT_COUNT_NOT_SINGLETON',
    );
  }
});

test('Phase 3.5 Completion: two fields in the same real table row prove one reachable singleton slot', () => {
  const row = structuralRoot('tr');
  const matches = Matcher.matchFields([
    descriptor('\u5916\u8bed\u7c7b\u578b', 'custom-select', sectionContext('basic'), {
      detectorId: 'reachable-row-language-type',
      element: elementWithin(row),
    }),
    descriptor('\u5916\u8bed\u6210\u7ee9', 'text', sectionContext('basic'), {
      detectorId: 'reachable-row-language-score',
      element: elementWithin(row),
    }),
  ], oneLanguage, { section: 'basic' });

  assert.equal(matches.filter(match => match.status === 'MATCHED').length, 2, JSON.stringify(matches));
  for (const match of matches) {
    assert.equal(match.singletonBindingDebug?.pageSlotCount, 1);
    assert.equal(match.singletonBindingDebug?.selectedIndex, 0);
  }
});

test('Phase 3.5 Completion: asymmetric fields in different real table rows prove two slots', () => {
  const typeRow = structuralRoot('tr');
  const scoreRow = structuralRoot('tr');
  const matches = Matcher.matchFields([
    descriptor('\u5916\u8bed\u7c7b\u578b', 'custom-select', sectionContext('basic'), {
      detectorId: 'reachable-type-row',
      element: elementWithin(typeRow),
    }),
    descriptor('\u5916\u8bed\u6210\u7ee9', 'text', sectionContext('basic'), {
      detectorId: 'reachable-score-row',
      element: elementWithin(scoreRow),
    }),
  ], oneLanguage, { section: 'basic' });

  assert.equal(matches.filter(match => match.status === 'MATCHED').length, 0, JSON.stringify(matches));
  for (const match of matches) {
    assert.equal(match.status, 'NEEDS_CONFIRMATION', JSON.stringify(match));
    assert.equal(match.singletonBindingDebug?.pageSlotCount, 2);
    assert.equal(match.singletonBindingDebug?.selectedIndex, null);
  }
});

test('Phase 3.5 Completion: a shared broad page region is not trusted as singleton slot evidence', () => {
  const broadPageContext = sectionContext('basic', 'record', null, { regionId: 'page:basic' });
  const matches = Matcher.matchFields([
    descriptor('\u5916\u8bed\u7c7b\u578b', 'custom-select', broadPageContext, {
      detectorId: 'broad-page-language-type',
    }),
    descriptor('\u5916\u8bed\u6210\u7ee9', 'text', broadPageContext, {
      detectorId: 'broad-page-language-score',
    }),
  ], oneLanguage, { section: 'basic' });

  assert.equal(matches.filter(match => match.status === 'MATCHED').length, 0, JSON.stringify(matches));
  for (const match of matches) {
    assert.equal(match.status, 'NEEDS_CONFIRMATION', JSON.stringify(match));
    assert.equal(match.singletonBindingDebug?.pageSlotCount, 0);
    assert.equal(match.singletonBindingDebug?.selectedIndex, null);
    assert.equal(
      match.singletonBindingDebug?.reasonCode,
      'PAGE_SLOT_COUNT_NOT_SINGLETON',
    );
  }
});

test('Phase 3.5 Completion: a broad form ancestor is never accepted as a singleton slot root', () => {
  const form = structuralRoot('form');
  const matches = Matcher.matchFields([
    descriptor('\u5916\u8bed\u6210\u7ee9', 'text', sectionContext('basic'), {
      detectorId: 'broad-form-language-score',
      element: elementWithin(form),
    }),
  ], oneLanguage, { section: 'basic' });

  assert.equal(matches[0].status, 'NEEDS_CONFIRMATION', JSON.stringify(matches[0]));
  assert.equal(matches[0].singletonBindingDebug?.pageSlotCount, 0);
  assert.equal(matches[0].singletonBindingDebug?.selectedIndex, null);
});

test('Phase 3.5 Completion: batch singleton binding without structural slot identity fails closed', () => {
  const matches = Matcher.matchFields(
    [descriptor('\u5916\u8bed\u6210\u7ee9')],
    oneLanguage,
    { section: 'basic' },
  );

  assert.equal(matches.length, 1);
  assert.equal(matches[0].status, 'NEEDS_CONFIRMATION', JSON.stringify(matches[0]));
  assert.equal(matches[0].singletonBindingDebug?.pageSlotCount, 0);
  assert.equal(matches[0].singletonBindingDebug?.selectedIndex, null);
  assert.equal(
    matches[0].singletonBindingDebug?.reasonCode,
    'PAGE_SLOT_COUNT_NOT_SINGLETON',
  );
});

test('Phase 3.5 Completion: duplicate discriminator candidates remain fail-closed', () => {
  const resume = {
    language: [
      { language: '英语', certificate: '大学英语六级', score: '600' },
      { language: '英语', certificate: '雅思', score: '7.5' },
    ],
  };
  const match = Matcher.matchField(descriptor('外语成绩'), resume, {
    section: 'basic',
    singletonDiscriminator: {
      fieldPath: 'language[].language',
      value: '英语',
      source: 'page-static-requirement',
    },
  });

  assert.equal(match.status, 'NEEDS_CONFIRMATION', match.reason);
  assert.deepEqual(match.singletonBindingDebug?.candidateIndexes, [0, 1]);
  assert.equal(match.singletonBindingDebug?.selectedIndex, null);
  assert.equal(match.singletonBindingDebug?.reasonCode, 'AMBIGUOUS_DISCRIMINATOR');
});

test('Phase 3.5 Completion: FieldContext keeps invocation-local singleton discriminator evidence bounded and explicit', () => {
  const field = descriptor('外语成绩');
  const context = FieldContext.contextFrom(field, {
    ...sectionContext('basic'),
    singletonDiscriminator: {
      fieldPath: 'language[].language',
      value: '日语',
      source: 'page-static-requirement',
    },
  });

  assert.deepEqual(context.singletonDiscriminator, {
    fieldPath: 'language[].language',
    value: '日语',
    source: 'page-static-requirement',
  });
  assert.equal(Object.hasOwn(context, 'resumeView'), false);
});

test('Phase 3.5 Completion: exact Education labels map to existing canonical fields without collisions', () => {
  const resume = {
    education: [{
      school: '示例大学',
      college: '示例学院',
      major: '示例专业',
      majorRankTotal: '120',
      majorRank: '3',
      gpa: '3.7/4',
    }],
  };
  const context = sectionContext('education', 'singleton-view', 0);
  const cases = [
    ['本科学校', 'education[].school', '示例大学'],
    ['本科院系', 'education[].college', '示例学院'],
    ['本科专业', 'education[].major', '示例专业'],
    ['申请人所在专业总人数', 'education[].majorRankTotal', '120'],
    ['申请人专业排名', 'education[].majorRank', '3'],
    ['本科 GPA', 'education[].gpa', '3.7/4'],
    ['本科GPA', 'education[].gpa', '3.7/4'],
  ];

  const matchedPaths = [];
  for (const [label, path, value] of cases) {
    const match = Matcher.matchField(descriptor(label, 'text', context), resume, {
      section: 'education',
      sectionContext: context,
      arrayContext: context.indexContext,
      arrayIndex: 0,
    });
    assert.equal(match.status, 'MATCHED', `${label}: ${match.reason}`);
    assert.equal(match.matchedPath, path, label);
    assert.equal(match.value, value, label);
    matchedPaths.push(match.matchedPath);
  }

  assert.equal(matchedPaths[0], 'education[].school');
  assert.equal(matchedPaths[1], 'education[].college');
  assert.equal(matchedPaths[2], 'education[].major');
});

test('Phase 3.5 Completion: exact Education labels report MISSING_JSON and do not invent values', () => {
  const context = sectionContext('education', 'singleton-view', 0);
  for (const [label, path] of [
    ['本科学校', 'education[].school'],
    ['申请人所在专业总人数', 'education[].majorRankTotal'],
    ['申请人专业排名', 'education[].majorRank'],
    ['本科 GPA', 'education[].gpa'],
  ]) {
    const match = Matcher.matchField(descriptor(label, 'text', context), { education: [{}] }, {
      section: 'education',
      sectionContext: context,
      arrayContext: context.indexContext,
      arrayIndex: 0,
    });
    assert.equal(match.status, 'MISSING_JSON', `${label}: ${match.reason}`);
    assert.equal(match.matchedPath, path, label);
    assert.equal(Fields.hasUsableValue(match.value), false, label);
  }

  const notGpa = Matcher.matchField(descriptor('满绩', 'text', context), {
    education: [{ gpa: '3.7/4', gpaScale: '4' }],
  }, {
    section: 'education',
    sectionContext: context,
    arrayContext: context.indexContext,
    arrayIndex: 0,
  });
  assert.notEqual(
    notGpa.status === 'MATCHED' && notGpa.matchedPath === 'education[].gpa',
    true,
    JSON.stringify(notGpa),
  );
});

test('Phase 3.5 Completion: papers authorRank accepts only evidence-backed first/second/third-author vocabulary', () => {
  const pageOptions = ['第一作者', '第二作者', '第三作者', '其他'].map(label => ({ label, value: label }));
  const allowed = [
    ['1', '第一作者'],
    ['一作', '第一作者'],
    ['第一作者', '第一作者'],
    ['2', '第二作者'],
    ['二作', '第二作者'],
    ['第二作者', '第二作者'],
    ['3', '第三作者'],
    ['三作', '第三作者'],
    ['第三作者', '第三作者'],
  ];

  for (const [expected, selected] of allowed) {
    const match = Options.findBestOption(expected, pageOptions, { fieldPath: 'papers[].authorRank' });
    assert.equal(match.matched, true, `${expected}: ${match.optionMatchingDebug.reasonCode}`);
    assert.equal(match.label, selected, expected);
  }
});

test('Phase 3.5 Completion: ratios, roles, rankings, unknown values and 4→其他 remain fail-closed for authorRank', () => {
  const pageOptions = ['第一作者', '第二作者', '第三作者', '其他'].map(label => ({ label, value: label }));
  for (const expected of ['1/4', '排名第一', '通讯作者', '共同一作', 'unknown', '4']) {
    const match = Options.findBestOption(expected, pageOptions, { fieldPath: 'papers[].authorRank' });
    assert.equal(match.matched, false, `${expected}: ${JSON.stringify(match)}`);
    assert.equal(match.optionMatchingDebug.reasonCode, 'NO_CANONICAL_ALIAS', expected);
  }
});

test('Phase 3.5 Completion: published never becomes submitted or accepted through option aliases', () => {
  const match = Options.findBestOption('published', [
    { label: '在投', value: 'submitted' },
    { label: '录用', value: 'accepted' },
  ], { fieldPath: 'papers[].status' });

  assert.equal(match.matched, false);
  assert.notEqual(match.label, '在投');
  assert.equal(match.optionMatchingDebug.reasonCode, 'LOW_SCORE');
});

test('Phase 3.5 Completion: canonical authorRank remains an author-order string in the Resume view', () => {
  const view = Fields.buildResumeView({ papers: [{ author_rank: '3' }] });
  assert.equal(view.papers[0].authorRank, '3');
  assert.equal(Options.knownFieldOptionCanonical('papers[].authorRank', '3'), '3');
  assert.equal(Options.knownFieldOptionCanonical('papers[].authorRank', '三作'), '3');
  assert.equal(Options.knownFieldOptionCanonical('papers[].authorRank', '通讯作者'), '');
});
