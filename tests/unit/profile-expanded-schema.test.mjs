import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const testDirectory = dirname(fileURLToPath(import.meta.url));
const root = resolve(testDirectory, '..', '..');
const [optionsSource, optionsHtml] = await Promise.all([
  readFile(resolve(root, 'options.js'), 'utf8'),
  readFile(resolve(root, 'options.html'), 'utf8'),
]);
const cutoff = optionsSource.indexOf('// 导入统一入口');
assert.ok(cutoff > 0, '无法定位 options.js 的纯函数测试边界');

const context = vm.createContext({});
vm.runInContext(`${optionsSource.slice(0, cutoff)}
globalThis.__expandedProfile = {
  validateImportPayload,
  normalizeResumeData,
  normalizeEducationItem,
  normalizeFamilyItem,
  normalizeStudyWorkItem,
  mergeResumeData,
  eduTemplate,
  internTemplate,
  familyTemplate,
  listItemSources,
  collectList,
};`, context, { filename: 'options-expanded-profile-functions.js' });

const profile = context.__expandedProfile;
function parseInContext(value) {
  context.__jsonInput = typeof value === 'string' ? value : JSON.stringify(value);
  return vm.runInContext('JSON.parse(__jsonInput)', context);
}

test('扩展资料 canonical JSON 通过导入校验并保持规范字段', () => {
  const payload = parseInContext({
    profileName: '示例申请资料',
    basic: {
      namePinyin: 'SHILI TONGXUE', healthStatus: '健康', political: '中国共产党预备党员',
      householdAddress: '示例户籍地址',
    },
    contact: {
      address: '示例通讯地址',
      postcode: '000000',
      archiveOrganization: '示例档案单位',
      archiveAddress: '示例档案地址',
      archivePostcode: '000000',
    },
    education: [{
      school: '示例大学', studentId: 'SAMPLE-001', gpa: '3.80/4.00',
      attachments: ['file_transcript_001'], futureField: '保留字段',
    }],
    family: [{
      name: '示例成员', relationship: '父亲', employer: '示例单位', position: '示例职务',
      phone: '', political: '', description: '虚构示例', futureField: '家庭扩展字段',
    }],
    internships: [{
      company: '示例实习单位', position: '示例岗位', startDate: '2024-07', endDate: '2024-08',
      location: '', description: '虚构实习经历', attachments: ['file_proof_001'], futureField: '实习扩展字段',
    }],
  });

  assert.equal(profile.validateImportPayload(payload), payload);
  const normalized = profile.normalizeResumeData(payload);
  assert.equal(normalized.basic.householdAddress, '示例户籍地址');
  assert.equal(normalized.basic.namePinyin, 'SHILI TONGXUE');
  assert.equal(normalized.basic.healthStatus, '健康');
  assert.equal(normalized.basic.political, '中国共产党预备党员');
  assert.equal(normalized.contact.archiveOrganization, '示例档案单位');
  assert.equal(normalized.education[0].studentId, 'SAMPLE-001');
  assert.equal(normalized.education[0].gpa, '3.80/4.00');
  assert.equal(normalized.education[0].futureField, '保留字段');
  assert.equal(normalized.family[0].futureField, '家庭扩展字段');
  assert.equal(normalized.internships[0].futureField, '实习扩展字段');
  assert.deepEqual([...normalized.internships[0].attachments], ['file_proof_001']);
});

test('旧 family 字符串、旧 internship 与 snake_case 教育字段迁移到 canonical 结构', () => {
  const legacy = parseInContext({
    personal: {
      name_pinyin: 'JIU ZILIAO', health_status: '良好', political_status: '预备党员',
      household_address: '旧户籍地址', mailing_address: '旧通讯地址',
      archive_organization: '旧档案单位', archive_address: '旧档案地址', archive_postcode: '100000',
    },
    education: [{ student_id: 'LEGACY-01', grade_point: '88.5', start: '2020-09', end: '2024-06' }],
    family: '旧版家庭成员说明',
    internship: [{
      organization: '旧实习单位', role: '旧岗位', start: '2023-07', end: '2023-08', desc: '旧描述',
      attachments: ['file_legacy_001'],
    }],
  });
  profile.validateImportPayload(legacy);
  const normalized = profile.normalizeResumeData(legacy);

  assert.equal(normalized.basic.householdAddress, '旧户籍地址');
  assert.equal(normalized.basic.namePinyin, 'JIU ZILIAO');
  assert.equal(normalized.basic.healthStatus, '良好');
  assert.equal(normalized.basic.political, '中国共产党预备党员');
  assert.equal(normalized.contact.address, '旧通讯地址');
  assert.equal(normalized.contact.archiveOrganization, '旧档案单位');
  assert.equal(normalized.education[0].studentId, 'LEGACY-01');
  assert.equal(normalized.education[0].gpa, '88.5');
  assert.equal(normalized.education[0].startDate, '2020-09');
  assert.deepEqual(JSON.parse(JSON.stringify(normalized.family)), [{
    description: '旧版家庭成员说明', name: '', relationship: '', employer: '', position: '', phone: '', political: '',
  }]);
  assert.equal(normalized.internships[0].company, '旧实习单位');
  assert.equal(normalized.internships[0].position, '旧岗位');
  assert.equal(normalized.internships[0].startDate, '2023-07');
  assert.equal(normalized.internships[0].endDate, '2023-08');
  assert.equal(normalized.internships[0].description, '旧描述');
  assert.deepEqual([...normalized.internships[0].attachments], ['file_legacy_001']);
});

test('canonical internships 优先于冲突的旧 internship，兼容视图不会分叉', () => {
  const normalized = profile.normalizeResumeData(parseInContext({
    internships: [{ company: '规范单位', description: '规范描述' }],
    internship: [{ company: '旧单位', description: '旧描述' }],
  }));
  assert.equal(normalized.internships[0].company, '规范单位');
  assert.equal(normalized.internships[0].description, '规范描述');
  assert.deepEqual(normalized.internship, normalized.internships);
  assert.match(optionsSource, /incoming\.internships\s*=\s*incoming\.internship/);
});

test('新增已知字段拒绝对象、数组等错误类型，attachments 只接受 fileId 数组', () => {
  const invalidPayloads = [
    [{ basic: { householdAddress: { text: '错误对象' } } }, /basic\.householdAddress 必须是字符串或 null/],
    [{ basic: { namePinyin: [] } }, /basic\.namePinyin 必须是字符串或 null/],
    [{ basic: { healthStatus: { text: '健康' } } }, /basic\.healthStatus 必须是字符串或 null/],
    [{ personal: { political_status: [] } }, /personal\.political_status 必须是字符串或 null/],
    [{ contact: { archivePostcode: [] } }, /contact\.archivePostcode 必须是字符串或 null/],
    [{ education: [{ studentId: { value: 'S1' } }] }, /education\[0\]\.studentId 必须是字符串或 null/],
    [{ family: [{ phone: [] }] }, /family\[0\]\.phone 必须是字符串或 null/],
    [{ internships: [{ description: { text: '错误对象' } }] }, /internships\[0\]\.description 必须是字符串或 null/],
    [{ internship: [{ attachments: ['not-a-file-id'] }] }, /attachments 必须是 fileId 字符串数组/],
    [{ education: [{ attachments: 'file_transcript_001' }] }, /attachments 必须是 fileId 字符串数组/],
  ];

  for (const [payload, pattern] of invalidPayloads) {
    assert.throws(() => profile.validateImportPayload(parseInContext(payload)), pattern);
  }
  assert.doesNotThrow(() => profile.validateImportPayload(parseInContext({
    basic: { householdAddress: null },
    contact: { archiveAddress: null },
    family: [{ phone: null, attachments: [] }],
  })));
});

test('教育、家庭和实习模板转义导入值并固定使用 canonical data-key', () => {
  const malicious = `"><img src=x onerror=alert(1)></textarea><script>alert(2)</script>&'`;
  const cases = [
    [profile.eduTemplate, { studentId: malicious, gpa: malicious }, ['studentId', 'gpa']],
    [profile.internTemplate, { company: malicious, description: malicious }, ['company', 'startDate', 'endDate', 'description']],
    [profile.familyTemplate, { name: malicious, description: malicious }, ['name', 'relationship', 'employer', 'position', 'phone', 'political', 'description']],
  ];

  for (const [template, data, keys] of cases) {
    const html = template(parseInContext(data));
    assert.doesNotMatch(html, /<img|<script|<\/textarea><script/i);
    assert.match(html, /&quot;|&lt;|&#39;/);
    keys.forEach(key => assert.match(html, new RegExp(`data-key="${key}"`)));
  }
});

function fakeRow(values) {
  const controls = Object.entries(values).map(([key, value]) => ({ dataset: { key }, value }));
  return { querySelectorAll(selector) { return selector === '[data-key]' ? controls : []; } };
}

test('WeakMap 行绑定在删除前一行后仍保留正确 attachments 和未知字段', () => {
  const firstRow = fakeRow({ company: '第一行已编辑' });
  const secondRow = fakeRow({ company: '第二行已编辑', description: '第二行新描述' });
  const familyRow = fakeRow({ name: '第二位成员已编辑' });
  profile.listItemSources.set(firstRow, parseInContext({
    company: '第一行', attachments: ['file_first_001'], hiddenMarker: 'first',
  }));
  profile.listItemSources.set(secondRow, parseInContext({
    company: '第二行', attachments: ['file_second_001'], hiddenMarker: 'second',
  }));
  profile.listItemSources.set(familyRow, parseInContext({
    name: '第二位成员', futureField: 'family-second',
  }));

  // 模拟用户删除第一条实习：DOM 中只剩原第二行。WeakMap 必须按行身份取基线，不能按新 index 取旧数组。
  context.document = {
    querySelectorAll(selector) {
      if (selector === '#intern-list .multi-item') return [secondRow];
      if (selector === '#family-list .multi-item') return [familyRow];
      return [];
    },
  };
  const internships = profile.collectList('intern-list');
  const family = profile.collectList('family-list');

  assert.equal(internships.length, 1);
  assert.equal(internships[0].company, '第二行已编辑');
  assert.equal(internships[0].description, '第二行新描述');
  assert.equal(internships[0].hiddenMarker, 'second');
  assert.deepEqual([...internships[0].attachments], ['file_second_001']);
  assert.doesNotMatch(JSON.stringify(internships), /file_first_001|"first"/);
  assert.equal(family[0].name, '第二位成员已编辑');
  assert.equal(family[0].futureField, 'family-second');
});

test('options HTML 与 collect/fill 静态契约覆盖扩展资料字段', () => {
  for (const id of [
    'p_namePinyin', 'p_healthStatus', 'p_political',
    'p_household_address', 'c_address', 'c_postcode', 'c_archive_organization',
    'c_archive_address', 'c_archive_postcode', 'family-list', 'family-add',
  ]) {
    assert.match(optionsHtml, new RegExp(`id="${id}"`), `options.html 缺少 #${id}`);
  }
  assert.match(optionsHtml, /<option>中国共产党预备党员<\/option>/);

  assert.match(optionsSource, /namePinyin:\s*v\('p_namePinyin'\)/);
  assert.match(optionsSource, /healthStatus:\s*v\('p_healthStatus'\)/);
  assert.match(optionsSource, /set\('p_namePinyin',\s*normalized\.basic\?\.namePinyin/);
  assert.match(optionsSource, /set\('p_healthStatus',\s*normalized\.basic\?\.healthStatus/);
  assert.match(optionsSource, /householdAddress:\s*v\('p_household_address'\)/);
  assert.match(optionsSource, /archiveOrganization:\s*v\('c_archive_organization'\)/);
  assert.match(optionsSource, /archiveAddress:\s*v\('c_archive_address'\)/);
  assert.match(optionsSource, /archivePostcode:\s*v\('c_archive_postcode'\)/);
  assert.match(optionsSource, /const educationRows = collectList\('edu-list'\)\.map\(normalizeEducationItem\)/);
  assert.match(optionsSource, /const internshipRows = collectList\('intern-list'\)\.map\(normalizeStudyWorkItem\)/);
  assert.match(optionsSource, /const familyRows = collectList\('family-list'\)\.map\(normalizeFamilyItem\)/);
  assert.match(optionsSource, /renderList\('intern-list',\s*normalized\.internships/);
  assert.match(optionsSource, /renderList\('family-list',\s*normalized\.family/);
  assert.match(optionsSource, /const listItemSources = new WeakMap\(\)/);
  assert.match(optionsSource, /listItemSources\.set\(div,\s*(?:source|item)\)/);
  assert.match(optionsSource, /loadedResumeData = data/);
  assert.doesNotMatch(optionsSource, /set\('family',\s*normalized\.family\)/);
});
