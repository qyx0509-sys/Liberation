import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Resolver = require('../../src/core/current-section-resolver.js');
const Sections = require('../../src/mappings/section-aliases.js');
const Fields = require('../../src/mappings/field-aliases.js');
const Matcher = require('../../src/core/field-matcher.js');
const Detector = require('../../src/core/field-detector.js');

function descriptor(label, overrides = {}) {
  return {
    detectorId: `field-${label}`,
    element: null,
    section: null,
    controlKind: 'text',
    type: 'text',
    baseControlKind: 'text',
    labelText: '',
    tableHeader: label,
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
    ...overrides,
  };
}

test('SectionContext 按 navigation → heading → breadcrumb/form-title → signature → adapter 选择来源', () => {
  const navigationFirst = Resolver.resolve({
    navigation: [{ sectionId: 'family', label: '家庭主要成员', active: true, safe: true, confidence: 0.98 }],
    headings: ['学习信息'],
    breadcrumbs: ['奖励或处分'],
    fields: [descriptor('所在学校'), descriptor('所在院系'), descriptor('所在专业')],
    adapterContext: { section: 'awards', score: 0.99 },
    indexContext: { section: 'family', index: 1 },
  });
  assert.deepEqual({
    sectionId: navigationFirst.sectionId,
    source: navigationFirst.source,
    collection: navigationFirst.collection,
    collectionMode: navigationFirst.collectionMode,
    indexContext: navigationFirst.indexContext,
  }, {
    sectionId: 'family',
    source: 'navigation',
    collection: 'family',
    collectionMode: 'array',
    indexContext: { section: 'family', index: 1 },
  });
  assert.deepEqual(navigationFirst.trace.map(entry => entry.source), Resolver.SOURCE_PRIORITY);

  const heading = Resolver.resolve({ headings: ['本科阶段学习信息'] });
  assert.equal(heading.sectionId, 'education');
  assert.equal(heading.source, 'heading');

  const breadcrumb = Resolver.resolve({ breadcrumbs: ['首页 / 奖励或处分（本科期间）'] });
  assert.equal(breadcrumb.sectionId, 'awards');
  assert.equal(breadcrumb.source, 'breadcrumb/form-title');

  const adapter = Resolver.resolve({ adapterContext: { section: 'language', score: 0.91 } });
  assert.equal(adapter.sectionId, 'language');
  assert.equal(adapter.source, 'adapter');
});

test('字段签名需要多个互补证据，单个常见字段不能强判栏目', () => {
  const familyFields = [
    descriptor('姓名'),
    descriptor('关系'),
    descriptor('在何单位工作，任何职务'),
    descriptor('联系电话'),
  ];
  const family = Resolver.resolve({ fields: familyFields });
  assert.equal(family.sectionId, 'family');
  assert.equal(family.source, 'field-signature');
  assert.equal(family.collection, 'family');

  const weak = Resolver.resolve({ fields: [descriptor('姓名')] });
  assert.equal(weak.sectionId, null);
  assert.equal(weak.source, 'unknown');

  const awards = Resolver.resolve({ fields: [descriptor('获奖名称'), descriptor('获奖时间'), descriptor('奖项级别')] });
  assert.equal(awards.sectionId, 'awards');
});

test('字段签名忽略其他隐藏栏目，避免可见家庭页与隐藏学习页形成歧义', () => {
  const fields = [
    descriptor('姓名'),
    descriptor('关系'),
    descriptor('在何单位工作，任何职务'),
    descriptor('联系电话'),
    descriptor('所在学校', { hidden: true, visible: false }),
    descriptor('所在院系', { hidden: true, visible: false }),
    descriptor('所在专业', { hidden: true, visible: false }),
    descriptor('入学年月', { hidden: true, visible: false }),
  ];
  const resolved = Resolver.resolve({ fields });
  assert.equal(resolved.sectionId, 'family');
  assert.equal(resolved.source, 'field-signature');
});

test('FieldMatcher 在高置信 SectionContext 中先限定 collection，并仅谨慎回退相关集合', () => {
  const familyContext = {
    sectionId: 'family', source: 'field-signature', confidence: 0.9,
    collection: 'family', collectionMode: 'array',
    indexContext: { section: 'family', index: 1 },
  };
  const resume = {
    basic: { name: '申请人姓名', birthday: '2002-01-02' },
    contact: { phone: '13000000000' },
    family: [
      { name: '第一位成员', relationship: '父亲', employer: '甲单位', position: '职员', phone: '13100000000' },
      { name: '第二位成员', relationship: '母亲', employer: '乙单位', position: '教师', phone: '13200000000' },
    ],
  };
  const name = Matcher.matchField(descriptor('姓名'), resume, { sectionContext: familyContext });
  assert.equal(name.status, 'MATCHED');
  assert.equal(name.matchedPath, 'family[].name');
  assert.equal(name.value, '第二位成员');
  assert.equal(name.scope.usedGlobalFallback, false);

  const combined = Matcher.matchField(descriptor('在何单位工作，任何职务'), resume, { sectionContext: familyContext });
  assert.equal(combined.status, 'MATCHED');
  assert.equal(combined.matchedPath, 'family[].employerPosition');
  assert.equal(combined.value, '乙单位 / 教师');

  const unrelated = Matcher.matchField(descriptor('出生日期'), resume, { sectionContext: familyContext });
  assert.notEqual(unrelated.status, 'MATCHED');
  assert.notEqual(unrelated.matchedPath, 'basic.birthday');

  const basicContext = {
    sectionId: 'basic', source: 'heading', confidence: 0.98,
    collection: 'basic', collectionMode: 'record', indexContext: null,
  };
  const phone = Matcher.matchField(descriptor('手机号码'), resume, { sectionContext: basicContext });
  assert.equal(phone.status, 'MATCHED');
  assert.equal(phone.matchedPath, 'contact.phone');
  assert.equal(phone.scope.usedGlobalFallback, true);
});

test('other/unknown 不是高置信栏目上下文，不得成为字段匹配硬门槛', () => {
  const match = Matcher.matchField(
    descriptor('', { labelText: '姓名' }),
    { basic: { name: '示例姓名' } },
    { sectionContext: { sectionId: 'other', collection: 'other', confidence: 0.9, collectionMode: 'unknown' } },
  );
  assert.equal(match.status, 'MATCHED');
  assert.equal(match.matchedPath, 'basic.name');
});

test('数组 SectionContext 没有 indexContext 时不猜 JSON 条目', () => {
  const context = {
    sectionId: 'family', source: 'heading', confidence: 0.95,
    collection: 'family', collectionMode: 'array', indexContext: null,
  };
  const match = Matcher.matchField(descriptor('关系'), { family: [{ relationship: '父亲' }] }, { sectionContext: context });
  assert.equal(match.matchedPath, 'family[].relationship');
  assert.equal(match.status, 'NEEDS_CONFIRMATION');
  assert.match(match.reason, /尚未建立.*索引/);
});

test('教育 canonical 字段兼容旧 startDate/endDate/rank 与 snake_case', () => {
  const resume = {
    education: [{
      school_name: '示例大学', college_name: '示例学院', major_name: '示例专业',
      student_id: 'SAMPLE-003', start_date: '2022-09', end_date: '2026-06',
      total_gpa: '3.80', gpa_scale: '4.00', percentage_score: '88.5',
      rank: '3', major_rank_total: '120',
    }],
  };
  const item = Fields.buildResumeView(resume).education[0];
  assert.equal(item.enrollmentDate, '2022-09');
  assert.equal(item.graduationDate, '2026-06');
  assert.equal(item.startDate, '2022-09');
  assert.equal(item.endDate, '2026-06');
  assert.equal(item.majorRank, '3');
  assert.equal(item.rank, '3');
  assert.equal(item.majorRankTotal, '120');
  assert.equal(item.gpaScale, '4.00');
  assert.equal(item.percentageScore, '88.5');

  const context = {
    sectionId: 'education', source: 'heading', confidence: 0.98,
    collection: 'education', collectionMode: 'array',
    indexContext: { section: 'education', index: 0 },
  };
  const cases = [
    ['所在学校', 'education[].school'],
    ['所在院系', 'education[].college'],
    ['所在专业', 'education[].major'],
    ['入学年月', 'education[].enrollmentDate'],
    ['预计毕业年月', 'education[].graduationDate'],
    ['在校生注册学号', 'education[].studentId'],
    ['成绩绩点', 'education[].gpa'],
    ['绩点满分', 'education[].gpaScale'],
    ['百分制成绩', 'education[].percentageScore'],
    ['专业成绩排名', 'education[].majorRank'],
    ['专业排名总人数', 'education[].majorRankTotal'],
  ];
  for (const [label, path] of cases) {
    const match = Matcher.matchField(descriptor(label), resume, { sectionContext: context });
    assert.equal(match.status, 'MATCHED', `${label}: ${match.reason}`);
    assert.equal(match.matchedPath, path);
  }
});

test('复合选择器被检测后在无适配器时只能人工确认', () => {
  const trigger = {
    tagName: 'BUTTON', type: 'button', innerText: '选择', disabled: false,
    getAttribute() { return null; },
  };
  const scope = {
    querySelectorAll(selector) { return selector.includes('button') ? [trigger] : []; },
  };
  const input = {
    tagName: 'INPUT', type: 'text', parentElement: scope,
    getAttribute() { return null; },
    closest() { return null; },
  };
  const detected = Detector.detectCompoundPicker(input, 'text');
  assert.equal(detected.triggerText, '选择');
  assert.equal(detected.supported, false);

  const context = {
    sectionId: 'education', source: 'heading', confidence: 0.98,
    collection: 'education', collectionMode: 'array',
    indexContext: { section: 'education', index: 0 },
  };
  const field = descriptor('所在学校', {
    controlKind: 'compound-picker', type: 'compound-picker', baseControlKind: 'text',
    compoundPicker: true, compoundPickerAdapted: false,
  });
  const match = Matcher.matchField(field, { education: [{ school: '示例大学' }] }, { sectionContext: context });
  assert.equal(match.matchedPath, 'education[].school');
  assert.equal(match.status, 'NEEDS_CONFIRMATION');
  assert.match(match.reason, /复合选择器适配/);
});

test('中文标点归一化且姓名拼音不降级为姓名，备用信息保持未匹配', () => {
  assert.equal(
    Fields.normalizeFieldText('在何单位工作，任何职务'),
    Fields.normalizeFieldText('在何单位工作任何职务'),
  );
  assert.equal(Sections.normalizeSectionText('家庭主要成员，及主要社会关系'), '家庭主要成员及主要社会关系');

  const basicContext = {
    sectionId: 'basic', source: 'heading', confidence: 0.98,
    collection: 'basic', collectionMode: 'record', indexContext: null,
  };
  const resume = { basic: { name: '示例姓名', namePinyin: 'SHILI XINGMING' } };
  const pinyin = Matcher.matchField(descriptor('姓名拼音'), resume, { sectionContext: basicContext });
  assert.equal(pinyin.status, 'MATCHED');
  assert.equal(pinyin.matchedPath, 'basic.namePinyin');

  const spare = Matcher.matchField(descriptor('备用信息'), resume, { sectionContext: basicContext });
  assert.equal(spare.status, 'UNMATCHED');
  assert.equal(spare.matchedPath, null);
});
