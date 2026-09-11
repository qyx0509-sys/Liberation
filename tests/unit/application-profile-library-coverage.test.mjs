import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const testDirectory = dirname(fileURLToPath(import.meta.url));
const root = resolve(testDirectory, '..', '..');

const Fields = require('../../src/mappings/field-aliases.js');
const Matcher = require('../../src/core/field-matcher.js');
const FileAliases = require('../../src/mappings/file-field-aliases.js');
const FileMatcher = require('../../src/core/file-matcher.js');

const [optionsSource, optionsHtml] = await Promise.all([
  readFile(resolve(root, 'options.js'), 'utf8'),
  readFile(resolve(root, 'options.html'), 'utf8'),
]);

const initCutoff = optionsSource.indexOf('// ===== 初始化 =====');
assert.ok(initCutoff > 0, '无法定位 options.js 的可测试函数边界');

const optionsContext = vm.createContext({
  // The source registers one optional listener before initialization. The
  // focused fixture replaces this bootstrap document before invoking a flow.
  document: { getElementById() { return null; } },
});
vm.runInContext(`${optionsSource.slice(0, initCutoff)}
globalThis.__applicationProfileCoverage = {
  validateImportPayload,
  normalizeResumeData,
  normalizeAwardItem,
  parseAwardBatch,
  awardTemplate,
  collectAll,
  fillForm,
  updateApplicationCharacterCounters,
};`, optionsContext, { filename: 'options-application-profile-coverage.js' });
// collectCustomFields is declared after the initialization boundary in the real
// page. The focused VM fixture has no custom rows, so provide its empty result.
optionsContext.collectCustomFields = () => [];
const Options = optionsContext.__applicationProfileCoverage;

function inOptionsContext(value) {
  optionsContext.__jsonInput = JSON.stringify(value);
  return vm.runInContext('JSON.parse(__jsonInput)', optionsContext);
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function descriptor(labelText, context) {
  return {
    detectorId: `application-profile-${labelText}`,
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
    controlKind: 'text',
    baseControlKind: 'text',
    context,
  };
}

function sectionContext(collection, collectionMode = 'record', index = null) {
  return {
    sectionId: collection,
    collection,
    collectionMode,
    source: 'application-profile-library-test',
    confidence: 1,
    indexContext: Number.isInteger(index)
      ? { section: collection, collection, index, [collection]: index }
      : null,
  };
}

function elementTag(id) {
  const match = optionsHtml.match(new RegExp(`<(?:input|select|textarea)\\b[^>]*\\bid="${id}"[^>]*>`, 'i'));
  assert.ok(match, `options.html 缺少 #${id}`);
  return match[0];
}

function fakeOptionsDocument() {
  const ids = [
    'p_idType', 'p_birthplaceRegion', 'p_householdRegion',
    'c_archiveRegion', 'c_emergencyPhone',
    'p_hometown_province', 'p_hometown_city', 'p_household_address', 'c_archive_address',
    'app_disciplinaryHistory', 'app_personalStatement', 'app_notes',
    'intro',
  ];
  const controls = new Map(ids.map(id => [id, { id, value: '' }]));
  for (const id of [
    'edu-list', 'intern-list', 'work-list', 'proj-list', 'research-list',
    'practice-list', 'award-list', 'lang-list', 'paper-list', 'family-list',
  ]) {
    controls.set(id, {
      id,
      innerHTML: '',
      children: [],
      appendChild(item) { this.children.push(item); },
    });
  }
  for (const id of ['app_disciplinaryHistory_count', 'app_personalStatement_count', 'app_notes_count']) {
    controls.set(id, { id, textContent: '' });
  }
  return {
    controls,
    document: {
      getElementById(id) { return controls.get(id) || null; },
      querySelectorAll() { return []; },
      createElement() { return { className: '', dataset: {}, innerHTML: '' }; },
    },
  };
}

test('内容导航以统一学习和工作经历为主，旧版记录仅在兼容数据折叠组中可达', () => {
  const navigation = optionsHtml.match(/<nav class="sidenav">[\s\S]*?<\/nav>/i)?.[0] || '';
  assert.ok(navigation, '缺少内容导航');
  assert.match(navigation, /href="#sec-internship"/);
  assert.match(navigation, /学习和工作经历/);
  assert.doesNotMatch(navigation, /href="#sec-work"/);
  assert.doesNotMatch(navigation, /id="cnt-work"/);
  assert.match(navigation, /class="nav-group compatibility-nav"[\s\S]*?data-section-target="sec-work"/);

  // 只移除旧导航入口；旧 work[] 编辑器继续保留，防止兼容资料无法查看或保存。
  assert.match(optionsHtml, /<div class="card" id="sec-work">/);
  assert.match(optionsHtml, /id="work-list"/);
});

test('资料管理页为五个 canonical 字段和三个申请文本提供独立控件与长度提示', () => {
  for (const id of [
    'p_idType', 'p_birthplaceRegion', 'p_householdRegion',
    'c_archiveRegion', 'c_emergencyPhone',
  ]) {
    elementTag(id);
  }

  for (const [id, limit] of [
    ['app_disciplinaryHistory', 200],
    ['app_personalStatement', 1000],
    ['app_notes', 1000],
  ]) {
    assert.match(elementTag(id), new RegExp(`\\bmaxlength="${limit}"`), `${id} 缺少 maxlength=${limit}`);
    assert.match(optionsHtml, new RegExp(`id="${id}_count"`), `${id} 缺少可见字数计数器`);
  }
});

test('真实 fillForm/collectAll 往返五个新字段，地区与详细地址不串值', () => {
  const fake = fakeOptionsDocument();
  optionsContext.document = fake.document;
  const seed = inOptionsContext({
    profileName: '申请资料覆盖测试',
    intro: '旧自我评价，不能成为个人陈述',
    personal: {
      hometown_province: '山东省',
      hometown_city: '青岛市',
      weight: '55',
    },
    basic: {
      idType: '护照',
      birthplaceRegion: '江苏省 / 南京市 / 鼓楼区',
      hometownRegion: '山东省 / 青岛市',
      householdRegion: '浙江省 / 杭州市 / 西湖区',
      householdAddress: '浙江省杭州市西湖区示例路 1 号',
    },
    contact: {
      archiveRegion: '上海市 / 上海市 / 杨浦区',
      archiveAddress: '上海市杨浦区档案路 2 号',
      emergencyPhone: '13800000001',
    },
    application: {
      disciplinaryHistory: '无处分记录',
      personalStatement: '独立申请陈述',
      notes: '申请备注',
      futureApplicationField: '未知字段必须保留',
    },
    files: { photo: 'file_photo_coverage' },
  });

  Options.fillForm(seed);
  const expectedLoaded = {
    p_idType: '护照',
    p_birthplaceRegion: '江苏省 / 南京市 / 鼓楼区',
    p_householdRegion: '浙江省 / 杭州市 / 西湖区',
    c_archiveRegion: '上海市 / 上海市 / 杨浦区',
    c_emergencyPhone: '13800000001',
    app_disciplinaryHistory: '无处分记录',
    app_personalStatement: '独立申请陈述',
    app_notes: '申请备注',
  };
  for (const [id, value] of Object.entries(expectedLoaded)) {
    assert.equal(fake.controls.get(id).value, value, `fillForm 未回填 #${id}`);
  }
  for (const [id, value] of [
    ['app_disciplinaryHistory', '无处分记录'],
    ['app_personalStatement', '独立申请陈述'],
    ['app_notes', '申请备注'],
  ]) {
    assert.equal(
      fake.controls.get(`${id}_count`).textContent,
      String(value.length),
      `${id} 回填后字数计数未同步`,
    );
  }

  Object.assign(fake.controls.get('p_idType'), { value: '居民身份证' });
  Object.assign(fake.controls.get('p_birthplaceRegion'), { value: '福建省 / 厦门市 / 思明区' });
  Object.assign(fake.controls.get('p_householdRegion'), { value: '安徽省 / 合肥市 / 蜀山区' });
  Object.assign(fake.controls.get('p_household_address'), { value: '安徽省合肥市蜀山区门牌 88 号' });
  Object.assign(fake.controls.get('c_archiveRegion'), { value: '北京市 / 北京市 / 海淀区' });
  Object.assign(fake.controls.get('c_archive_address'), { value: '北京市海淀区档案单位详细地址' });
  Object.assign(fake.controls.get('c_emergencyPhone'), { value: '13900000002' });
  Object.assign(fake.controls.get('app_disciplinaryHistory'), { value: '无' });
  Object.assign(fake.controls.get('app_personalStatement'), { value: '新的独立申请陈述' });
  Object.assign(fake.controls.get('app_notes'), { value: '新的申请备注' });

  const saved = plain(Options.collectAll());
  assert.equal(saved.basic.idType, '居民身份证');
  assert.equal(saved.basic.birthplaceRegion, '福建省 / 厦门市 / 思明区');
  assert.equal(saved.basic.householdRegion, '安徽省 / 合肥市 / 蜀山区');
  assert.equal(saved.basic.householdAddress, '安徽省合肥市蜀山区门牌 88 号');
  assert.equal(saved.contact.archiveRegion, '北京市 / 北京市 / 海淀区');
  assert.equal(saved.contact.archiveAddress, '北京市海淀区档案单位详细地址');
  assert.equal(saved.contact.emergencyPhone, '13900000002');
  assert.notEqual(saved.basic.householdRegion, saved.basic.householdAddress);
  assert.notEqual(saved.contact.archiveRegion, saved.contact.archiveAddress);
  assert.deepEqual(saved.application, {
    disciplinaryHistory: '无',
    personalStatement: '新的独立申请陈述',
    notes: '新的申请备注',
    futureApplicationField: '未知字段必须保留',
  });
  assert.equal(saved.intro, '旧自我评价，不能成为个人陈述');
  assert.notEqual(saved.intro, saved.application.personalStatement, '自我评价和个人陈述必须保持独立');
  assert.equal(saved.files.photo, 'file_photo_coverage', '保存表单不能破坏已有照片绑定');
  assert.equal(saved.personal.weight, '55', '没有可编辑控件的旧资料字段不能被虚空 getter 清除');
});

test('清空新增字段后旧 canonical 或兼容别名不会复活，未知字段仍保留', () => {
  const fake = fakeOptionsDocument();
  optionsContext.document = fake.document;
  Options.fillForm(inOptionsContext({
    personal: {
      id_type: '旧个人证件类型',
      birthplace_region: '旧个人出生地',
      hometown_region: '旧个人籍贯',
      household_region: '旧个人户口地区',
      archive_region: '旧个人档案地区',
      emergency_phone: '13000000000',
    },
    basic: {
      idType: '居民身份证',
      id_type: '旧证件类型',
      birthplaceRegion: '旧出生地',
      birthplace_region: '旧出生地别名',
      hometownRegion: '山东省 / 青岛市',
      hometown_region: '旧籍贯别名',
      hometownProvince: '山东省',
      hometownCity: '青岛市',
      householdRegion: '旧户口地区',
      household_region: '旧户口地区别名',
      futureBasicField: '基本信息未知字段',
    },
    contact: {
      archiveRegion: '旧档案地区',
      archive_region: '旧档案地区别名',
      emergencyPhone: '13800000000',
      emergency_phone: '13900000000',
      futureContactField: '联系信息未知字段',
    },
    application: {
      disciplinaryHistory: '旧处分情况',
      disciplinary_history: '旧处分别名',
      personalStatement: '旧个人陈述',
      personal_statement: '旧个人陈述别名',
      notes: '旧申请备注',
      application_notes: '旧申请备注别名',
      futureApplicationField: '申请未知字段',
    },
    awards: [{
      time: '2025-07',
      content: '测试奖励',
      category: '奖学金',
      award_category: '旧奖项类别',
      futureAwardField: '奖励未知字段',
    }],
  }));

  for (const id of [
    'p_idType', 'p_birthplaceRegion', 'p_hometown_province', 'p_hometown_city',
    'p_householdRegion', 'c_archiveRegion', 'c_emergencyPhone',
    'app_disciplinaryHistory', 'app_personalStatement', 'app_notes',
  ]) {
    fake.controls.get(id).value = '';
  }

  const awardRow = fake.controls.get('award-list').children[0];
  assert.ok(awardRow, '奖励行应由真实 renderAwards 创建');
  awardRow.querySelectorAll = selector => selector === '[data-key]'
    ? [{ dataset: { key: 'category' }, value: '' }]
    : [];
  fake.document.querySelectorAll = selector => selector === '#award-list .award-item'
    ? [awardRow]
    : [];

  const saved = plain(Options.collectAll());
  assert.deepEqual({
    idType: saved.basic.idType,
    birthplaceRegion: saved.basic.birthplaceRegion,
    hometownRegion: saved.basic.hometownRegion,
    householdRegion: saved.basic.householdRegion,
    archiveRegion: saved.contact.archiveRegion,
    emergencyPhone: saved.contact.emergencyPhone,
    disciplinaryHistory: saved.application.disciplinaryHistory,
    personalStatement: saved.application.personalStatement,
    notes: saved.application.notes,
    awardCategory: saved.awards[0].category,
  }, {
    idType: '',
    birthplaceRegion: '',
    hometownRegion: '',
    householdRegion: '',
    archiveRegion: '',
    emergencyPhone: '',
    disciplinaryHistory: '',
    personalStatement: '',
    notes: '',
    awardCategory: '',
  });

  for (const [record, aliases] of [
    [saved.basic, ['id_type', 'birthplace_region', 'hometown_region', 'hometown', 'household_region']],
    [saved.contact, ['archive_region', 'emergency_phone']],
    [saved.application, ['disciplinary_history', 'personal_statement', 'application_notes']],
    [saved.awards[0], ['award_category']],
  ]) {
    aliases.forEach(alias => assert.equal(
      Object.prototype.hasOwnProperty.call(record, alias),
      false,
      `${alias} 应在 canonical 字段被页面编辑后移除`,
    ));
  }
  assert.equal(saved.basic.futureBasicField, '基本信息未知字段');
  assert.equal(saved.contact.futureContactField, '联系信息未知字段');
  assert.equal(saved.application.futureApplicationField, '申请未知字段');
  assert.equal(saved.awards[0].futureAwardField, '奖励未知字段');

  const reloaded = plain(Options.normalizeResumeData(inOptionsContext(saved)));
  const semanticView = Fields.buildResumeView(saved);
  assert.equal(reloaded.basic.idType, '');
  assert.equal(reloaded.basic.hometownRegion, '');
  assert.equal(reloaded.application.personalStatement, '');
  assert.equal(reloaded.awards[0].category, '');
  assert.equal(semanticView.basic.idType, '');
  assert.equal(semanticView.basic.hometownRegion, '');
  assert.equal(semanticView.application.personalStatement, '');
  assert.equal(semanticView.awards[0].category, '');
});

test('籍贯省市可生成 hometownRegion，已有 canonical 地区在省市为空时不丢失', () => {
  const generated = Options.normalizeResumeData(inOptionsContext({
    personal: { hometown_province: '山东省', hometown_city: '青岛市' },
  }));
  assert.match(generated.basic.hometownRegion, /山东省/);
  assert.match(generated.basic.hometownRegion, /青岛市/);

  const fake = fakeOptionsDocument();
  optionsContext.document = fake.document;
  Options.fillForm(inOptionsContext({ basic: { hometownRegion: '辽宁省 / 大连市' } }));
  const saved = plain(Options.collectAll());
  assert.equal(saved.basic.hometownRegion, '辽宁省 / 大连市');
  assert.equal(saved.basic.birthplaceRegion, '');
  assert.equal(saved.basic.householdRegion, '');
  assert.equal(saved.contact.archiveRegion, '');
});

test('导入校验与归一化覆盖新字段，并保持 application 与 intro 隔离', () => {
  const payload = inOptionsContext({
    intro: '仅自我评价',
    basic: {
      idType: '居民身份证',
      birthplaceRegion: '出生地区',
      householdRegion: '户籍地区',
    },
    contact: { archiveRegion: '档案地区', emergencyPhone: '13800000000' },
    application: {
      disciplinary_history: '无处分',
      personal_statement: '个人陈述正文',
      application_notes: '备注正文',
      futureField: '保留',
    },
  });
  assert.equal(Options.validateImportPayload(payload), payload);
  const normalized = plain(Options.normalizeResumeData(payload));
  assert.equal(normalized.basic.idType, '居民身份证');
  assert.equal(normalized.basic.birthplaceRegion, '出生地区');
  assert.equal(normalized.basic.householdRegion, '户籍地区');
  assert.equal(normalized.contact.archiveRegion, '档案地区');
  assert.equal(normalized.contact.emergencyPhone, '13800000000');
  assert.equal(normalized.application.disciplinaryHistory, '无处分');
  assert.equal(normalized.application.personalStatement, '个人陈述正文');
  assert.equal(normalized.application.notes, '备注正文');
  assert.equal(normalized.application.futureField, '保留');
  assert.equal(normalized.intro, '仅自我评价');

  const introOnly = plain(Options.normalizeResumeData(inOptionsContext({ intro: '不得迁移' })));
  assert.equal(introOnly.application?.personalStatement ?? '', '');

  const invalid = [
    [{ basic: { idType: {} } }, /basic\.idType 必须是字符串或 null/],
    [{ basic: { birthplaceRegion: [] } }, /basic\.birthplaceRegion 必须是字符串或 null/],
    [{ basic: { householdRegion: 1 } }, /basic\.householdRegion 必须是字符串或 null/],
    [{ contact: { archiveRegion: false } }, /contact\.archiveRegion 必须是字符串或 null/],
    [{ contact: { emergencyPhone: {} } }, /contact\.emergencyPhone 必须是字符串或 null/],
  ];
  for (const [value, pattern] of invalid) {
    assert.throws(() => Options.validateImportPayload(inOptionsContext(value)), pattern);
  }

  const tooLong = [
    ['disciplinaryHistory', '处'.repeat(201), /application\.disciplinaryHistory 不能超过 200 个字符/],
    ['personal_statement', '陈'.repeat(1001), /application\.personal_statement 不能超过 1000 个字符/],
    ['application_notes', '注'.repeat(1001), /application\.application_notes 不能超过 1000 个字符/],
  ];
  for (const [key, value, pattern] of tooLong) {
    assert.throws(
      () => Options.validateImportPayload(inOptionsContext({ application: { [key]: value } })),
      pattern,
    );
  }
  assert.doesNotThrow(() => Options.validateImportPayload(inOptionsContext({
    application: {
      disciplinaryHistory: '处'.repeat(200),
      personalStatement: '陈'.repeat(1000),
      notes: '注'.repeat(1000),
    },
  })));
});

test('JSON 导出再导入后新增字段、奖项四种语义和未知字段完整往返', () => {
  const exported = plain(Options.normalizeResumeData(inOptionsContext({
    intro: '独立自我评价',
    basic: {
      idType: '护照',
      birthplaceRegion: '江苏省 / 南京市 / 鼓楼区',
      hometownRegion: '山东省 / 青岛市',
      householdRegion: '浙江省 / 杭州市 / 西湖区',
      householdAddress: '户口详细地址',
    },
    contact: {
      archiveRegion: '北京市 / 北京市 / 海淀区',
      archiveAddress: '档案单位详细地址',
      emergencyPhone: '13800000000',
    },
    application: {
      disciplinaryHistory: '无',
      personalStatement: '独立个人陈述',
      notes: '申请备注',
      futureApplicationField: '保留',
    },
    awards: [{
      time: '2025-08',
      content: '示例荣誉',
      category: '荣誉称号',
      level: '校级',
      rank: '一等奖',
      participationMode: '个人',
      futureAwardField: '保留',
    }],
    files: { photo: 'file_photo_roundtrip' },
  })));
  const imported = inOptionsContext(JSON.parse(JSON.stringify(exported)));
  assert.equal(Options.validateImportPayload(imported), imported);
  const roundTrip = plain(Options.normalizeResumeData(imported));

  assert.deepEqual({
    idType: roundTrip.basic.idType,
    birthplaceRegion: roundTrip.basic.birthplaceRegion,
    hometownRegion: roundTrip.basic.hometownRegion,
    householdRegion: roundTrip.basic.householdRegion,
    householdAddress: roundTrip.basic.householdAddress,
    archiveRegion: roundTrip.contact.archiveRegion,
    archiveAddress: roundTrip.contact.archiveAddress,
    emergencyPhone: roundTrip.contact.emergencyPhone,
    intro: roundTrip.intro,
    application: roundTrip.application,
    award: {
      category: roundTrip.awards[0].category,
      level: roundTrip.awards[0].level,
      rank: roundTrip.awards[0].rank,
      participationMode: roundTrip.awards[0].participationMode,
      futureAwardField: roundTrip.awards[0].futureAwardField,
    },
    photo: roundTrip.files.photo,
  }, {
    idType: '护照',
    birthplaceRegion: '江苏省 / 南京市 / 鼓楼区',
    hometownRegion: '山东省 / 青岛市',
    householdRegion: '浙江省 / 杭州市 / 西湖区',
    householdAddress: '户口详细地址',
    archiveRegion: '北京市 / 北京市 / 海淀区',
    archiveAddress: '档案单位详细地址',
    emergencyPhone: '13800000000',
    intro: '独立自我评价',
    application: {
      disciplinaryHistory: '无',
      personalStatement: '独立个人陈述',
      notes: '申请备注',
      futureApplicationField: '保留',
    },
    award: {
      category: '荣誉称号',
      level: '校级',
      rank: '一等奖',
      participationMode: '个人',
      futureAwardField: '保留',
    },
    photo: 'file_photo_roundtrip',
  });
});

test('awards category 归一化后与 level/rank/participationMode 四种语义相互独立', () => {
  const source = inOptionsContext({
    award_category: '奖学金',
    level: '国家级',
    rank: '一等奖',
    participationMode: '团队',
    time: '2025-07',
    content: '示例奖项',
  });
  const award = plain(Options.normalizeAwardItem(source));
  assert.deepEqual({
    category: award.category,
    level: award.level,
    rank: award.rank,
    participationMode: award.participationMode,
  }, {
    category: '奖学金',
    level: '国家级',
    rank: '一等奖',
    participationMode: '团队',
  });

  const canonicalWins = plain(Options.normalizeAwardItem(inOptionsContext({
    category: '荣誉称号',
    awardCategory: '竞赛获奖',
  })));
  assert.equal(canonicalWins.category, '荣誉称号');

  const canonicalClearWins = plain(Options.normalizeAwardItem(inOptionsContext({
    category: '',
    awardCategory: '不得复活',
  })));
  assert.equal(canonicalClearWins.category, '');
  assert.equal(Fields.buildResumeView({ awards: [{ category: '', award_category: '不得复活' }] }).awards[0].category, '');

  const markup = Options.awardTemplate(source);
  for (const key of ['category', 'level', 'rank', 'participationMode']) {
    assert.match(markup, new RegExp(`data-key="${key}"`), `奖励表单缺少 ${key}`);
  }

  assert.throws(
    () => Options.validateImportPayload(inOptionsContext({ awards: [{ category: {} }] })),
    /awards\[0\]\.category 必须是字符串或 null/,
  );
});

test('奖励 TSV 保持旧八列位置，并只把可选第九列解释为 category', () => {
  const oldRows = plain(Options.parseAwardBatch(
    '2025-07\t北京市\t示例奖励\t国家级\t一等奖\t示例主办方\taward.pdf\t旧格式备注',
  ));
  assert.equal(oldRows.length, 1);
  assert.deepEqual({
    time: oldRows[0].time,
    location: oldRows[0].location,
    content: oldRows[0].content,
    level: oldRows[0].level,
    rank: oldRows[0].rank,
    organizer: oldRows[0].organizer,
    certificateFileName: oldRows[0].certificateFileName,
    note: oldRows[0].note,
    category: oldRows[0].category,
  }, {
    time: '2025-07',
    location: '北京市',
    content: '示例奖励',
    level: '国家级',
    rank: '一等奖',
    organizer: '示例主办方',
    certificateFileName: 'award.pdf',
    note: '旧格式备注',
    category: '',
  });

  const newRows = plain(Options.parseAwardBatch(
    '2025-08\t上海市\t优秀学生\t校级\t荣誉称号\t示例学校\thonor.jpg\t新格式备注\t荣誉称号',
  ));
  assert.equal(newRows[0].organizer, '示例学校');
  assert.equal(newRows[0].note, '新格式备注');
  assert.equal(newRows[0].category, '荣誉称号');
});

test('奖项类别别名仅在奖励上下文匹配，裸“类别”不得污染其他栏目', () => {
  const definition = Fields.FIELD_DEFINITIONS.find(item => item.path === 'awards[].category');
  assert.ok(definition, '缺少 awards[].category canonical 字段定义');
  for (const alias of ['奖励类别', '奖项类别', '荣誉类别', '奖学金类别']) {
    assert.ok(definition.aliases.includes(alias), `awards[].category 缺少强别名 ${alias}`);
  }

  const resume = {
    awards: [{ category: '奖学金', level: '校级', rank: '一等奖', participationMode: '个人' }],
  };
  const awardContext = sectionContext('awards', 'repeatable', 0);
  for (const label of ['奖项类别', '类别']) {
    const match = Matcher.matchField(
      descriptor(label, awardContext),
      resume,
      {
        section: 'awards',
        sectionContext: awardContext,
        arrayContext: { section: 'awards', collection: 'awards', index: 0, awards: 0 },
      },
    );
    assert.equal(match.status, 'MATCHED', `${label}: ${match.reason}`);
    assert.equal(match.matchedPath, 'awards[].category');
    assert.equal(match.value, '奖学金');
  }

  const basicContext = sectionContext('basic');
  const outsideAwards = Matcher.matchField(
    descriptor('类别', basicContext),
    resume,
    { section: 'basic', sectionContext: basicContext },
  );
  assert.notEqual(outsideAwards.matchedPath, 'awards[].category');
});

test('Markdown 两条导出路径均包含奖项类别', () => {
  const categoryLines = optionsSource.match(/if\s*\(award\.category\)\s*lines\.push\([^\n]*award\.category/g) || [];
  assert.ok(categoryLines.length >= 2, `预期两条 Markdown 导出路径均输出 category，实际 ${categoryLines.length} 条`);
});

test('照片材料的 canonical、兼容绑定和 photo 分类匹配保持不变', () => {
  assert.equal(FileAliases.CATEGORY_BY_PATH['files.photo'], 'photo');
  assert.ok(FileAliases.FILE_FIELD_ALIASES['files.photo'].includes('证件照'));
  assert.equal(FileAliases.rankFileFields('上传照片')[0]?.path, 'files.photo');

  const material = {
    id: 'file_photo_coverage',
    name: '申请证件照.jpg',
    category: 'photo',
    size: 12_345,
    aliases: ['本人照片'],
    tags: [],
    relatedResumePath: 'files.photo',
  };
  const field = {
    contextText: '上传照片',
    recommendations: FileAliases.rankFileFields('上传照片'),
  };
  const direct = FileMatcher.matchField(field, {
    files: { photo: material.id },
    awards: [{ category: '荣誉称号' }],
  }, [material]);
  assert.equal(direct.status, FileMatcher.STATUS.MATCH);
  assert.equal(direct.path, 'files.photo');
  assert.equal(direct.material.id, material.id);

  const legacy = FileMatcher.matchField(field, { basic: { photo: material.id } }, [material]);
  assert.equal(legacy.status, FileMatcher.STATUS.MATCH);
  assert.equal(legacy.path, 'files.photo');
});
