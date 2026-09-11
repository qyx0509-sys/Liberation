import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const Fields = require('../../src/mappings/field-aliases.js');
const Matcher = require('../../src/core/field-matcher.js');

const testDirectory = dirname(fileURLToPath(import.meta.url));
const root = resolve(testDirectory, '..', '..');
const optionsSource = await readFile(resolve(root, 'options.js'), 'utf8');
const optionsCutoff = optionsSource.indexOf('// 导入统一入口');
assert.ok(optionsCutoff > 0, '无法定位 options.js 的纯函数测试边界');

const optionsContext = vm.createContext({});
vm.runInContext(`${optionsSource.slice(0, optionsCutoff)}
globalThis.__phase35Schema = {
  validateImportPayload,
  normalizeResumeData,
  normalizeEducationItem,
  normalizeFamilyItem,
  normalizePaperItem,
};`, optionsContext, { filename: 'options-phase3-5-schema-functions.js' });
const OptionsSchema = optionsContext.__phase35Schema;

function inOptionsContext(value) {
  optionsContext.__jsonInput = JSON.stringify(value);
  return vm.runInContext('JSON.parse(__jsonInput)', optionsContext);
}

function descriptor(labelText, controlKind = 'text', context = null) {
  return {
    detectorId: `phase35-${labelText}`,
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
    ...(context ? { context } : {}),
  };
}

function sectionContext(collection, collectionMode = 'record', index = null) {
  return {
    sectionId: collection,
    collection,
    collectionMode,
    source: 'phase3-5-schema-fixture',
    confidence: 1,
    indexContext: Number.isInteger(index)
      ? { section: collection, collection, index, [collection]: index }
      : null,
  };
}

test('Geographic canonical paths distinguish hierarchical regions from detailed addresses', () => {
  const resume = {
    basic: {
      birthplaceRegion: '示例省 / 示例市 / 示例区',
      hometownRegion: '籍贯省 / 籍贯市 / 籍贯区',
      householdRegion: '户籍省 / 户籍市 / 户籍区',
      householdAddress: '示例详细门牌地址',
    },
    contact: {
      archiveRegion: '档案省 / 档案市 / 档案区',
      archiveAddress: '示例档案单位详细地址',
    },
  };
  const expected = [
    ['出生地', 'basic.birthplaceRegion'],
    ['籍贯地所在地', 'basic.hometownRegion'],
    ['户口所在地', 'basic.householdRegion'],
    ['档案所在地', 'contact.archiveRegion'],
  ];

  expected.forEach(([label, path]) => {
    const match = Matcher.matchField(
      descriptor(label, 'cascader', sectionContext('basic')),
      resume,
      { section: 'basic' },
    );
    assert.equal(match.status, 'MATCHED', `${label}: ${match.reason}`);
    assert.equal(match.matchedPath, path, label);
  });

  assert.equal(Fields.resolveValue(resume, 'basic.householdAddress'), '示例详细门牌地址');
  assert.equal(Fields.resolveValue(resume, 'contact.archiveAddress'), '示例档案单位详细地址');
  assert.notEqual(Fields.FIELD_ALIASES['basic.householdRegion'], Fields.FIELD_ALIASES['basic.householdAddress']);
});

test('explicit hometown-region label with a cascader annotation beats the legacy hometown catch-all', () => {
  const context = sectionContext('basic');
  const realisticDescriptor = {
    ...descriptor('籍贯地区（级联）', 'cascader', context),
    semanticPlaceholder: '省/市/区',
    placeholder: '请选择省/市/区',
    id: 'hometown-cascader',
    groupText: '籍贯地区（级联） 请选择省/市/区',
    parentText: '籍贯地区（级联） 请选择省/市/区',
  };
  const match = Matcher.matchField(
    realisticDescriptor,
    { basic: { hometownRegion: '江苏省 / 南京市', hometown: '旧籍贯文本' } },
    { section: 'basic', sectionContext: context },
  );

  assert.equal(match.status, 'MATCHED', JSON.stringify({
    status: match.status,
    reason: match.reason,
    alternatives: match.alternatives,
    evidence: match.evidence,
  }));
  assert.equal(match.matchedPath, 'basic.hometownRegion');
  assert.equal(match.value, '江苏省 / 南京市');
  assert.equal(match.evidence?.some(item =>
    item.source === 'labelText'
    && item.alias === '籍贯地区（级联）'
    && item.score === Matcher.SOURCE_WEIGHTS.labelText), true);
});

test('legacy hometown is the sole explicit geographic fallback and ambiguous addresses are never copied into regions', () => {
  const legacy = {
    basic: {
      hometown: '旧籍贯完整字符串',
      householdAddress: '旧户口详细地址',
    },
    contact: { archiveAddress: '旧档案详细地址' },
  };
  const before = JSON.stringify(legacy);
  const view = Fields.buildResumeView(legacy);

  assert.equal(view.basic.hometown, '旧籍贯完整字符串');
  assert.equal(view.basic.hometownRegion, '旧籍贯完整字符串');
  assert.equal(view.basic.householdAddress, '旧户口详细地址');
  assert.equal(view.basic.householdRegion ?? '', '');
  assert.equal(view.basic.birthplaceRegion ?? '', '');
  assert.equal(view.contact.archiveAddress, '旧档案详细地址');
  assert.equal(view.contact.archiveRegion ?? '', '');
  assert.equal(JSON.stringify(legacy), before, '只读 Resume view 不得修改旧 JSON');
});

test('family address and paper impact factor are reusable canonical fields with legacy aliases', () => {
  const resume = {
    family: [{ mailing_address: '家庭成员通讯地址' }],
    papers: [{ impact_factor: '8.8' }],
  };
  const view = Fields.buildResumeView(resume);
  assert.equal(view.family[0].address, '家庭成员通讯地址');
  assert.equal(view.papers[0].impactFactor, '8.8');

  const familyMatch = Matcher.matchField(
    descriptor('通讯地址', 'text', sectionContext('family', 'repeatable', 0)),
    resume,
    { section: 'family', arrayContext: { section: 'family', collection: 'family', index: 0, family: 0 } },
  );
  assert.equal(familyMatch.status, 'MATCHED', familyMatch.reason);
  assert.equal(familyMatch.matchedPath, 'family[].address');

  const paperMatch = Matcher.matchField(
    descriptor('影响因子', 'text', sectionContext('papers', 'repeatable', 0)),
    resume,
    { section: 'papers', arrayContext: { section: 'papers', collection: 'papers', index: 0, papers: 0 } },
  );
  assert.equal(paperMatch.status, 'MATCHED', paperMatch.reason);
  assert.equal(paperMatch.matchedPath, 'papers[].impactFactor');
});

test('education coverage reuses school/gpa/majorRank/majorRankTotal without duplicate canonical paths', () => {
  const paths = Fields.FIELD_DEFINITIONS.map(definition => definition.path);
  for (const path of [
    'education[].school',
    'education[].gpa',
    'education[].majorRank',
    'education[].majorRankTotal',
  ]) {
    assert.equal(paths.filter(candidate => candidate === path).length, 1, path);
  }

  const view = Fields.buildResumeView({
    education: [{
      institution: '示例本科院校',
      total_grade_point: '3.7/4',
      professional_rank: '4',
      major_student_count: '120',
    }],
  });
  assert.equal(view.education[0].school, '示例本科院校');
  assert.equal(view.education[0].gpa, '3.7/4');
  assert.equal(view.education[0].majorRank, '4');
  assert.equal(view.education[0].majorRankTotal, '120');
});

test('application text fields use an explicit namespace and never infer personalStatement from legacy intro', () => {
  const resume = {
    intro: '旧自我评价不是申请个人陈述',
    application: {
      disciplinary_history: '无处分记录',
      personal_statement: '脱敏个人陈述',
      notes: '脱敏备注',
    },
  };
  const view = Fields.buildResumeView(resume);
  assert.equal(view.application.disciplinaryHistory, '无处分记录');
  assert.equal(view.application.personalStatement, '脱敏个人陈述');
  assert.equal(view.application.notes, '脱敏备注');

  const introOnly = Fields.buildResumeView({ intro: '仅旧自我评价' });
  assert.equal(introOnly.application?.personalStatement ?? '', '');

  for (const [label, path] of [
    ['作弊处分等情况(200字以内)', 'application.disciplinaryHistory'],
    ['个人陈述(1000字以内)', 'application.personalStatement'],
    ['备注信息(1000字以内)', 'application.notes'],
  ]) {
    const match = Matcher.matchField(
      descriptor(label, 'textarea', sectionContext('basic')),
      resume,
      { section: 'basic' },
    );
    assert.equal(match.status, 'MATCHED', `${label}: ${match.reason}`);
    assert.equal(match.matchedPath, path, label);
  }
});

test('language singleton policy only permits implicit index 0 for exactly one Resume entry', () => {
  const one = { language: [{ language: '英语', score: '600' }] };
  const many = {
    language: [
      { language: '英语', score: '600' },
      { language: '日语', score: '160' },
    ],
  };

  assert.equal(Fields.resolveValue(one, 'language[].score'), '600');
  assert.equal(Fields.resolveValue(many, 'language[].score'), undefined);
  assert.equal(
    Fields.resolveValue(many, 'language[].score', { arrayContext: { section: 'language', index: 1 } }),
    '160',
  );

  const singletonMatch = Matcher.matchField(
    descriptor('外语成绩', 'text', sectionContext('basic')),
    one,
    { section: 'basic' },
  );
  assert.equal(singletonMatch.status, 'MATCHED', singletonMatch.reason);
  assert.equal(singletonMatch.matchedPath, 'language[].score');
  assert.equal(singletonMatch.value, '600');

  const ambiguousMatch = Matcher.matchField(
    descriptor('外语成绩', 'text', sectionContext('basic')),
    many,
    { section: 'basic' },
  );
  assert.equal(ambiguousMatch.status, 'NEEDS_CONFIRMATION', ambiguousMatch.reason);
  assert.equal(ambiguousMatch.matchedPath, 'language[].score');
  assert.match(ambiguousMatch.reason, /多条|language|索引/);
});

test('an empty canonical language array does not mask a populated legacy languages array', () => {
  const legacy = {
    language: [],
    languages: [{ language_type: '法语', score: 'B2' }],
  };
  const runtime = Fields.buildResumeView(legacy);
  assert.equal(runtime.language.length, 1);
  assert.equal(runtime.language[0].score, 'B2');

  const editor = OptionsSchema.normalizeResumeData(inOptionsContext(legacy));
  assert.equal(editor.language.length, 1);
  assert.equal(editor.language[0].language, '法语');
  assert.equal(editor.languages, editor.language);
});

test('legal declaration stays outside writable Resume aliases even when imported JSON contains a truthy flag', () => {
  const writableAliases = Fields.FIELD_DEFINITIONS.flatMap(definition => definition.aliases);
  assert.equal(writableAliases.some(alias => /本人保证|承诺声明|法律声明/.test(alias)), false);

  const match = Matcher.matchField(
    descriptor('本人保证以上信息真实有效', 'checkbox', sectionContext('basic')),
    { application: { declarationAcknowledged: 'true' } },
    { section: 'basic' },
  );
  assert.equal(match.status, 'UNMATCHED');
  assert.equal(match.matchedPath, null);
});

test('options import validates and normalizes Phase 3.5 schema without dropping unknown compatible fields', () => {
  const payload = inOptionsContext({
    basic: {
      birthplace_region: '出生区域',
      hometown: '旧籍贯',
      household_region: '户籍区域',
      householdAddress: '户籍详细地址',
    },
    contact: {
      archive_region: '档案区域',
      archiveAddress: '档案详细地址',
    },
    education: [{
      institution: '示例学校',
      total_grade_point: '3.5/4',
      professional_rank: '5',
      major_student_count: '100',
      futureEducationField: '保留',
    }],
    family: [{ contact_address: '家庭通讯地址', futureFamilyField: '保留' }],
    papers: [{ journal_impact_factor: '6.6', futurePaperField: '保留' }],
    application: {
      disciplinary_history: '无',
      personal_statement: '申请陈述',
      notes: '申请备注',
      futureApplicationField: '保留',
    },
    languages: [{ language_type: '英语', score: '590' }],
  });

  assert.equal(OptionsSchema.validateImportPayload(payload), payload);
  const normalized = OptionsSchema.normalizeResumeData(payload);
  assert.equal(normalized.basic.birthplaceRegion, '出生区域');
  assert.equal(normalized.basic.hometownRegion, '旧籍贯');
  assert.equal(normalized.basic.householdRegion, '户籍区域');
  assert.equal(normalized.basic.householdAddress, '户籍详细地址');
  assert.equal(normalized.contact.archiveRegion, '档案区域');
  assert.equal(normalized.contact.archiveAddress, '档案详细地址');
  assert.equal(normalized.education[0].school, '示例学校');
  assert.equal(normalized.education[0].gpa, '3.5/4');
  assert.equal(normalized.education[0].majorRank, '5');
  assert.equal(normalized.education[0].majorRankTotal, '100');
  assert.equal(normalized.education[0].futureEducationField, '保留');
  assert.equal(normalized.family[0].address, '家庭通讯地址');
  assert.equal(normalized.family[0].futureFamilyField, '保留');
  assert.equal(normalized.papers[0].impactFactor, '6.6');
  assert.equal(normalized.papers[0].futurePaperField, '保留');
  assert.equal(normalized.application.disciplinaryHistory, '无');
  assert.equal(normalized.application.personalStatement, '申请陈述');
  assert.equal(normalized.application.notes, '申请备注');
  assert.equal(normalized.application.futureApplicationField, '保留');
  assert.equal(normalized.language[0].language, '英语');
  assert.equal(normalized.languages[0].language, '英语');
  assert.equal(normalized.language, normalized.languages, 'canonical/legacy language arrays share one normalized view');
});

test('options import rejects non-string values for every newly supported semantic field', () => {
  const invalid = [
    [{ basic: { birthplaceRegion: {} } }, /basic\.birthplaceRegion 必须是字符串或 null/],
    [{ personal: { household_region: [] } }, /personal\.household_region 必须是字符串或 null/],
    [{ contact: { archiveRegion: 42 } }, /contact\.archiveRegion 必须是字符串或 null/],
    [{ family: [{ address: {} }] }, /family\[0\]\.address 必须是字符串或 null/],
    [{ papers: [{ impact_factor: [] }] }, /papers\[0\]\.impact_factor 必须是字符串或 null/],
    [{ application: { personalStatement: {} } }, /application\.personalStatement 必须是字符串或 null/],
    [{ language: [{ language_type: [] }] }, /language\[0\]\.language_type 必须是字符串或 null/],
    [{ languages: [{ score: {} }] }, /languages\[0\]\.score 必须是字符串或 null/],
  ];

  for (const [payload, expected] of invalid) {
    assert.throws(() => OptionsSchema.validateImportPayload(inOptionsContext(payload)), expected);
  }
});

test('options compatibility never copies detailed/ambiguous strings into unrelated region or application semantics', () => {
  const normalized = OptionsSchema.normalizeResumeData(inOptionsContext({
    intro: '旧自我评价',
    basic: { householdAddress: '旧户籍详细地址' },
    contact: { archiveAddress: '旧档案详细地址' },
  }));

  assert.equal(normalized.basic.householdAddress, '旧户籍详细地址');
  assert.equal(normalized.basic.householdRegion ?? '', '');
  assert.equal(normalized.basic.birthplaceRegion ?? '', '');
  assert.equal(normalized.contact.archiveAddress, '旧档案详细地址');
  assert.equal(normalized.contact.archiveRegion ?? '', '');
  assert.equal(normalized.application?.personalStatement ?? '', '');
});
