import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Fields = require('../../src/mappings/field-aliases.js');
const Matcher = require('../../src/core/field-matcher.js');
const Options = require('../../src/mappings/option-aliases.js');

function descriptor(labelText, section, controlKind = 'text') {
  return {
    detectorId: `${section}-${labelText}`,
    element: null,
    section,
    controlKind,
    type: controlKind,
    labelText,
    tableHeader: '',
    placeholder: '',
    ariaLabel: '',
    name: '',
    id: '',
    title: '',
    groupText: section === 'family' ? '家庭主要成员及主要社会关系' : '',
    nearbyText: '',
    parentText: '',
    visible: true,
    hidden: false,
    disabled: false,
    readOnly: false,
    options: [],
  };
}

test('教育信息补充注册学号、成绩绩点和总绩点语义', () => {
  const resume = { education: [{ studentId: 'SAMPLE-001', gpa: '3.80' }] };
  for (const label of ['在校生注册学号', '注册学号']) {
    const match = Matcher.matchField(descriptor(label, 'education'), resume, {
      section: 'education', arrayContext: { section: 'education', index: 0 },
    });
    assert.equal(match.status, 'MATCHED', `${label}: ${match.reason}`);
    assert.equal(match.matchedPath, 'education[].studentId');
  }
  for (const label of ['成绩绩点', '总绩点']) {
    const match = Matcher.matchField(descriptor(label, 'education'), resume, {
      section: 'education', arrayContext: { section: 'education', index: 0 },
    });
    assert.equal(match.status, 'MATCHED', `${label}: ${match.reason}`);
    assert.equal(match.matchedPath, 'education[].gpa');
  }
});

test('学习和工作经历统一映射到 internships[] 的四个核心字段', () => {
  const resume = {
    internships: [{
      startDate: '2022-09', endDate: '2026-06', company: '示例大学', position: '学生',
    }],
  };
  const cases = [
    ['起始时间', 'internships[].startDate'],
    ['结束时间', 'internships[].endDate'],
    ['学校或工作单位', 'internships[].company'],
    ['担任职务', 'internships[].position'],
  ];
  cases.forEach(([label, path]) => {
    const match = Matcher.matchField(descriptor(label, 'internships'), resume, {
      section: 'internships', arrayContext: { section: 'internships', index: 0 },
    });
    assert.equal(match.status, 'MATCHED', `${label}: ${match.reason}`);
    assert.equal(match.matchedPath, path);
  });
});

test('家庭主要成员及主要社会关系按 family[] 上下文映射分列及单位职务合并字段', () => {
  const resume = {
    family: [{
      name: '示例家属', relationship: '父亲', employer: '示例单位', position: '职员', phone: '13000000000',
    }],
  };
  const cases = [
    ['姓名', 'family[].name'],
    ['与本人关系', 'family[].relationship'],
    ['工作或学习单位', 'family[].employer'],
    ['职务或职业', 'family[].position'],
    ['在何单位工作任何职务', 'family[].employerPosition'],
    ['工作单位及职务', 'family[].employerPosition'],
    ['单位及职务', 'family[].employerPosition'],
    ['联系电话（手机）', 'family[].phone'],
  ];
  cases.forEach(([label, path]) => {
    const match = Matcher.matchField(descriptor(label, 'family'), resume, {
      section: 'family', arrayContext: { section: 'family', index: 0 },
    });
    assert.equal(match.status, 'MATCHED', `${label}: ${match.reason}`);
    assert.equal(match.matchedPath, path);
  });
});

test('Resume resolver 将旧数组键和 snake_case 字段归一到统一模型', () => {
  const resume = {
    education: [],
    education_experience: [{
      school_name: '示例大学', student_id: 'SAMPLE-002', total_gpa: '3.90',
      start_date: '2022-09', end_date: '2026-06', research_direction: '示例方向',
    }],
    internships: [],
    study_work_experience: [{
      start_date: '2022-09', end_date: '2026-06', school_or_work_unit: '示例大学', job_title: '学生',
    }],
    family: [],
    family_members: [{
      member_name: '示例家属', relation_to_me: '父亲', work_unit: '示例单位', occupation: '职员', contact_phone: '13000000000',
    }],
  };
  const view = Fields.buildResumeView(resume);
  assert.deepEqual(view.education[0], {
    ...resume.education_experience[0],
    school: '示例大学',
    college: '',
    major: '',
    degree: '',
    educationLevel: '',
    enrollmentDate: '2022-09',
    graduationDate: '2026-06',
    startDate: '2022-09',
    endDate: '2026-06',
    gpa: '3.90',
    gpaScale: '',
    percentageScore: '',
    majorRank: '',
    majorRankTotal: '',
    rank: '',
    studentId: 'SAMPLE-002',
    mode: '',
    advisor: '',
    researchDirection: '示例方向',
    thesis: '',
  });
  assert.equal(view.internships[0].startDate, '2022-09');
  assert.equal(view.internships[0].endDate, '2026-06');
  assert.equal(view.internships[0].company, '示例大学');
  assert.equal(view.internships[0].position, '学生');
  assert.equal(view.family[0].name, '示例家属');
  assert.equal(view.family[0].relationship, '父亲');
  assert.equal(view.family[0].employer, '示例单位');
  assert.equal(view.family[0].position, '职员');
  assert.equal(view.family[0].employerPosition, '示例单位 / 职员');
  assert.equal(view.family[0].phone, '13000000000');
  assert.equal(Fields.resolveValue(resume, 'internships[].company', {
    arrayContext: { section: 'study_work_experience', index: 0 },
  }), '示例大学');

  const oldJobFill = Fields.buildResumeView({
    work: [{ company_name: '旧版工作单位', job_position: '旧版职务', start_date: '2020-01', end_date: '2021-01' }],
  });
  assert.equal(oldJobFill.internships[0].company, '旧版工作单位');
  assert.equal(oldJobFill.internships[0].position, '旧版职务');
  assert.equal(oldJobFill.internships[0].startDate, '2020-01');
  assert.equal(oldJobFill.internships[0].endDate, '2021-01');

  const combinedOldJobFill = Fields.buildResumeView({
    internship: [{ company: '旧版实习单位', position: '实习生', start: '2019-07', end: '2019-08' }],
    work: [{ company: '旧版工作单位', position: '职员', start: '2020-01', end: '2021-01' }],
  });
  assert.equal(combinedOldJobFill.internships.length, 2);
  assert.deepEqual(combinedOldJobFill.internships.map(item => item.company), ['旧版实习单位', '旧版工作单位']);

  const explicitFamilyCombined = Fields.buildResumeView({
    family_members: [{
      work_unit: '不会用于合并结果的单位',
      occupation: '不会用于合并结果的职务',
      employer_position: '显式单位与职务',
    }],
  });
  assert.equal(explicitFamilyCombined.family[0].employerPosition, '显式单位与职务');
});

test('基本信息支持姓名拼音与健康状况语义，并兼容 snake_case', () => {
  const personalView = Fields.buildResumeView({
    personal: {
      name_pinyin: 'ZHANG SAN',
      health_status: '健康',
    },
  });
  assert.equal(personalView.basic.namePinyin, 'ZHANG SAN');
  assert.equal(personalView.basic.healthStatus, '健康');

  const basicView = Fields.buildResumeView({
    basic: {
      name_pinyin: 'LI SI',
      physical_health_status: '良好',
    },
  });
  assert.equal(basicView.basic.namePinyin, 'LI SI');
  assert.equal(basicView.basic.healthStatus, '良好');
  assert.equal(Fields.resolveValue({ basic: { health_condition: '正常' } }, 'basic.healthStatus'), '正常');

  for (const label of ['姓名拼音', '姓名全拼']) {
    const match = Matcher.matchField(descriptor(label, 'basic'), { basic: { namePinyin: 'ZHANG SAN' } }, {
      section: 'basic',
      sectionContext: { sectionId: 'basic', collection: 'basic', confidence: 0.95 },
    });
    assert.equal(match.status, 'MATCHED', `${label}: ${match.reason}`);
    assert.equal(match.matchedPath, 'basic.namePinyin');
  }

  for (const label of ['健康状况', '身体健康状况', '健康情况']) {
    const match = Matcher.matchField(descriptor(label, 'basic', 'native-select'), { basic: { healthStatus: '健康' } }, {
      section: 'basic',
      sectionContext: { sectionId: 'basic', collection: 'basic', confidence: 0.95 },
    });
    assert.equal(match.status, 'MATCHED', `${label}: ${match.reason}`);
    assert.equal(match.matchedPath, 'basic.healthStatus');
  }
});

test('政治面貌严格区分中共预备党员与正式党员', () => {
  for (const alias of ['中国共产党预备党员', '中共预备党员', '预备党员']) {
    assert.equal(Options.canonicalOption(alias), '中共预备党员');
  }
  assert.equal(Options.canonicalOption('中国共产党党员'), '中共党员');
  assert.equal(Options.partyMembershipStageConflicts('预备党员', '中共党员'), true);
  assert.equal(Options.partyMembershipStageConflicts('中国共产党党员', '中共预备党员'), true);
  assert.equal(Options.scoreOption('预备党员', '中共党员'), 0);
  assert.equal(Options.scoreOption('中共党员', '预备党员'), 0);

  const options = ['请选择', '中共党员', '中共预备党员', '共青团员'];
  const preparatory = Options.findBestOption('中国共产党预备党员', options);
  assert.equal(preparatory.matched, true);
  assert.equal(preparatory.label, '中共预备党员');
  const full = Options.findBestOption('中国共产党党员', options);
  assert.equal(full.matched, true);
  assert.equal(full.label, '中共党员');

  assert.equal(Options.findBestOption('预备党员', ['中共党员'], { minScore: 0.1 }).matched, false);
  assert.equal(Options.findBestOption('中共党员', ['预备党员'], { minScore: 0.1 }).matched, false);
});
