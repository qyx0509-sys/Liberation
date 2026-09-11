import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
let DiagnosticSanitizer = null;
let moduleLoadError = null;

try {
  DiagnosticSanitizer = require('../../src/core/diagnostic-sanitizer.js');
} catch (error) {
  moduleLoadError = error;
}

const EXPECTED_SUMMARY = Object.freeze({
  fieldCount: 2,
  fileFieldCount: 1,
  embeddedSectionCount: 1,
  navigationItemCount: 2,
  groupCount: 1,
  buttonCount: 2,
  saveCandidateCount: 1,
  warningCount: 1,
});

function api() {
  assert.ok(
    DiagnosticSanitizer,
    `缺少 Phase 3.1-F 公共模块 src/core/diagnostic-sanitizer.js：${moduleLoadError?.message || 'unknown'}`,
  );
  return DiagnosticSanitizer;
}

function sanitize(raw, options = {}) {
  const sanitizer = api();
  assert.equal(typeof sanitizer.sanitize, 'function', '必须导出 sanitize(raw, options?)');
  const result = sanitizer.sanitize(raw, options);
  assert.ok(result && typeof result === 'object' && !Array.isArray(result));
  assert.ok(result.diagnosis && typeof result.diagnosis === 'object');
  assert.ok(result.summary && typeof result.summary === 'object');
  assert.ok(result.diagnosticMeta && typeof result.diagnosticMeta === 'object');
  return result;
}

function rawDiagnosis(overrides = {}) {
  return {
    schemaVersion: 2,
    generatedAt: '2026-08-23T00:00:00.000Z',
    page: {
      origin: 'https://apply.example.edu',
      title: '研究生报名系统',
    },
    section: {
      detected: 'education',
      title: '学习信息',
      score: 0.98,
      source: 'navigation',
    },
    sectionDetection: {
      final: 'education',
      source: 'navigation',
      confidence: 0.98,
      attempts: [],
    },
    navigation: {
      itemCount: 2,
      items: [
        { section: 'education', label: '学习信息', confidence: 0.98, active: true, safe: true },
        { section: 'practice', label: '社会实践', confidence: 0.94, active: false, safe: true },
      ],
      candidates: [],
    },
    embeddedSections: [
      { sectionId: 'practice', collection: 'practice', collectionMode: 'repeatable', groupCount: 1 },
    ],
    fields: [
      { detectorId: 'field_1', tagName: 'input', type: 'text', visible: true, score: 92 },
      { detectorId: 'field_2', tagName: 'select', type: 'select', visible: true, score: 88 },
    ],
    fileFields: [
      { detectorId: 'file_1', type: 'file', accept: '.pdf', multiple: false },
    ],
    groups: [{ index: 0, controlCount: 4 }],
    buttons: [
      { text: '添加一行', dangerous: false },
      { text: '下一步', dangerous: true },
    ],
    saveCandidates: [{ text: '保存', safe: true }],
    warnings: ['示例警告'],
    privacy: {
      mode: 'metadata-only',
      excluded: ['field-values', 'resume-data'],
    },
    ...overrides,
  };
}

function assertJsonRoundTrip(value) {
  let encoded = '';
  assert.doesNotThrow(() => { encoded = JSON.stringify(value); });
  assert.doesNotThrow(() => JSON.parse(encoded));
  return encoded;
}

function sixEmbeddedSections() {
  return ['language', 'internships', 'research', 'papers', 'awards', 'practice']
    .map((collection, index) => ({
      sectionId: collection,
      collection,
      collectionMode: 'repeatable',
      groupCount: collection === 'practice' ? 1 : index + 1,
      zeroRow: false,
    }));
}

test('Phase 3.1-F 公共 API：UMD/CommonJS 导出 sanitize、summarize、formatSummary', () => {
  const sanitizer = api();
  assert.equal(typeof sanitizer.sanitize, 'function');
  assert.equal(typeof sanitizer.summarize, 'function');
  assert.equal(typeof sanitizer.formatSummary, 'function');
});

test('类型稳定：数字、布尔、null、字符串与核心数组/对象经过 sanitize 后不变型', () => {
  const { diagnosis } = sanitize(rawDiagnosis({
    scalarProbe: { number: 7, boolean: false, empty: null, text: 'safe' },
  }));

  assert.equal(diagnosis.scalarProbe.number, 7);
  assert.equal(diagnosis.scalarProbe.boolean, false);
  assert.equal(diagnosis.scalarProbe.empty, null);
  assert.equal(diagnosis.scalarProbe.text, 'safe');
  assert.equal(Array.isArray(diagnosis.fields), true);
  assert.equal(Array.isArray(diagnosis.navigation.items), true);
  assert.equal(typeof diagnosis.section, 'object');
});

test('raw summary：summarize 在截断前统计全部真实条目', () => {
  const raw = rawDiagnosis({ fields: Array.from({ length: 620 }, (_, index) => ({ detectorId: `f_${index}` })) });
  const summary = api().summarize(raw);

  assert.equal(summary.fieldCount, 620);
  assert.equal(summary.fileFieldCount, 1);
  assert.equal(summary.embeddedSectionCount, 1);
  assert.equal(summary.navigationItemCount, 2);
});

test('大量复杂 fields 不能挤掉六个 embeddedSections，practice 结构保持完整', () => {
  const fields = Array.from({ length: 120 }, (_, index) => ({
    detectorId: `complex_${index}`,
    context: {
      sectionId: 'education', collection: 'education', collectionMode: 'singleton-view',
      index: 0, indexContext: { section: 'education', collection: 'education', index: 0 },
    },
    parent: { tagName: 'td', classes: ['form-cell', `cell-${index}`] },
    options: Array.from({ length: 10 }, (__, optionIndex) => ({ label: `选项${optionIndex}`, disabled: false })),
    metadata: { labelText: `字段${index}`, nearbyText: '仅用于结构压力测试', required: index % 2 === 0 },
  }));
  const { diagnosis } = sanitize(rawDiagnosis({ fields, embeddedSections: sixEmbeddedSections() }));

  assert.equal(Array.isArray(diagnosis.embeddedSections), true);
  assert.equal(diagnosis.embeddedSections.length, 6);
  const practice = diagnosis.embeddedSections.find(item => item.collection === 'practice');
  assert.ok(practice);
  assert.equal(practice.groupCount, 1);
  assert.equal(practice.zeroRow, false);
});

test('可信统计使用 raw 的 98/5/6，不受 serialized fields 数量影响', () => {
  const raw = rawDiagnosis({
    fields: Array.from({ length: 98 }, (_, index) => ({ detectorId: `f_${index}` })),
    fileFields: Array.from({ length: 5 }, (_, index) => ({ detectorId: `file_${index}`, type: 'file' })),
    embeddedSections: sixEmbeddedSections(),
  });
  const { diagnosis, summary } = sanitize(raw, {
    limits: { maxArrayItems: 10, maxObjectKeys: 500, maxDepth: 10, maxNodes: 5_000 },
  });

  assert.equal(diagnosis.fields.length, 10);
  assert.equal(summary.fieldCount, 98);
  assert.equal(summary.fileFieldCount, 5);
  assert.equal(summary.embeddedSectionCount, 6);
});

test('summary 契约：sanitize 顶层 summary 与 diagnosis.summary 语义等价', () => {
  const { diagnosis, summary } = sanitize(rawDiagnosis());

  assert.deepEqual(summary, EXPECTED_SUMMARY);
  assert.deepEqual(diagnosis.summary, summary);
});

test('diagnosticMeta 契约：顶层与 diagnosis 内均存在且语义等价', () => {
  const { diagnosis, diagnosticMeta } = sanitize(rawDiagnosis());

  assert.deepEqual(diagnosis.diagnosticMeta, diagnosticMeta);
  assert.equal(typeof diagnosticMeta.truncated, 'boolean');
  assert.equal(Array.isArray(diagnosticMeta.truncations), true);
});

test('关键 top-level：上下文诊断结构不会在序列化中丢失', () => {
  const { diagnosis } = sanitize(rawDiagnosis());
  const required = [
    'schemaVersion', 'generatedAt', 'page', 'section', 'sectionDetection',
    'navigation', 'embeddedSections', 'fields', 'fileFields', 'groups',
    'buttons', 'saveCandidates', 'warnings', 'privacy', 'summary', 'diagnosticMeta',
  ];

  for (const key of required) assert.equal(Object.hasOwn(diagnosis, key), true, key);
});

test('隐私：递归移除字段值、Resume、DOM/HTML、Cookie/Token/Session 与文件正文', () => {
  const raw = rawDiagnosis({
    value: 'SHOULD_NOT_EXPORT',
    resumeData: { basic: { name: 'SHOULD_NOT_EXPORT' } },
    outerHTML: '<input value="SHOULD_NOT_EXPORT">',
    nested: {
      currentValue: 'SHOULD_NOT_EXPORT',
      cookie: 'SHOULD_NOT_EXPORT',
      token: 'SHOULD_NOT_EXPORT',
      session: 'SHOULD_NOT_EXPORT',
      authorization: 'SHOULD_NOT_EXPORT',
      fileContent: 'SHOULD_NOT_EXPORT',
      safeMetadata: 'keep-me',
    },
  });
  const { diagnosis } = sanitize(raw);
  const encoded = assertJsonRoundTrip(diagnosis);

  assert.doesNotMatch(encoded, /SHOULD_NOT_EXPORT|outerHTML|currentValue|resumeData|fileContent/i);
  assert.equal(diagnosis.nested.safeMetadata, 'keep-me');
});

test('隐私：文本中的姓名、手机号、邮箱、身份证、详细地址、路径和真实文件名被脱敏', () => {
  const secretText = '姓名：张三 手机：13812345678 邮箱：zhangsan@example.com 身份证：110101199001011234 '
    + '通讯地址：上海市四平路1239号 C:\\Users\\zhangsan\\成绩单.pdf';
  const { diagnosis } = sanitize(rawDiagnosis({ warnings: [secretText] }));
  const encoded = assertJsonRoundTrip(diagnosis);

  assert.doesNotMatch(encoded, /张三|13812345678|zhangsan@example\.com|110101199001011234|四平路1239号|\\Users\\zhangsan|成绩单\.pdf/);
  assert.match(encoded, /redacted|脱敏/i);
});

test('隐私：页面 URL 不导出 query/hash 中的 token、session 或身份证参数', () => {
  const { diagnosis } = sanitize(rawDiagnosis({
    page: {
      url: 'https://apply.example.edu/form/edit?token=SECRET_TOKEN&idCard=110101199001011234#session=SECRET_SESSION',
      origin: 'https://apply.example.edu',
      title: '研究生报名系统',
    },
  }));
  const encoded = assertJsonRoundTrip(diagnosis);

  assert.equal(diagnosis.page.origin, 'https://apply.example.edu');
  assert.doesNotMatch(encoded, /SECRET_TOKEN|SECRET_SESSION|110101199001011234|\?token=|#session=/);
});

test('JSON stringify：循环引用不会抛错，且记录 circular truncation 元数据', () => {
  const raw = rawDiagnosis();
  raw.self = raw;
  raw.fields[0].owner = raw;

  const { diagnosis, diagnosticMeta } = sanitize(raw);
  assertJsonRoundTrip(diagnosis);
  assert.equal(diagnosticMeta.truncated, true);
  assert.equal(
    diagnosticMeta.truncations.some(item => item.reason === 'circular-reference'),
    true,
  );
});

test('JSON stringify：function、symbol、bigint 与 DOM-like 对象不会破坏导出', () => {
  const domLike = {
    nodeType: 1,
    tagName: 'INPUT',
    ownerDocument: { title: '不应递归导出' },
    outerHTML: '<input value="secret">',
  };
  const { diagnosis } = sanitize(rawDiagnosis({
    unsupported: {
      fn() {},
      symbol: Symbol('secret'),
      bigint: 10n,
      element: domLike,
      safe: true,
    },
  }));
  const encoded = assertJsonRoundTrip(diagnosis);

  assert.equal(diagnosis.unsupported.safe, true);
  assert.doesNotMatch(encoded, /不应递归导出|outerHTML|value=|Symbol|10n/);
});

test('结构化 truncation：数组保持数组，并记录 path/original/kept/omitted', () => {
  const raw = rawDiagnosis({ fields: Array.from({ length: 5 }, (_, index) => ({ detectorId: `field_${index}` })) });
  const { diagnosis, summary, diagnosticMeta } = sanitize(raw, {
    limits: { maxArrayItems: 2, maxObjectKeys: 500, maxDepth: 10, maxNodes: 5_000 },
  });

  assert.equal(Array.isArray(diagnosis.fields), true);
  assert.equal(diagnosis.fields.length, 2);
  assert.equal(summary.fieldCount, 5, 'summary 必须来自 raw，而不是截断后的 fields.length');
  assert.equal(diagnosticMeta.truncated, true);
  assert.equal(diagnosticMeta.truncations.some(item =>
    item.path === '$.fields'
      && item.kind === 'array'
      && item.originalCount === 5
      && item.keptCount === 2
      && item.omittedCount === 3), true);
});

test('结构化 truncation：对象与深层节点使用对象标记，不能退化为字符串“[已截断]”', () => {
  const raw = rawDiagnosis({
    extra: { one: 1, two: 2, three: 3 },
    deep: { level1: { level2: { level3: { safe: true } } } },
  });
  const { diagnosis, diagnosticMeta } = sanitize(raw, {
    limits: { maxArrayItems: 500, maxObjectKeys: 2, maxDepth: 2, maxNodes: 5_000 },
  });

  assert.equal(typeof diagnosis.extra, 'object');
  assert.equal(Array.isArray(diagnosis.extra), false);
  assert.notEqual(diagnosis.deep, '[已截断]');
  assert.equal(typeof diagnosis.deep, 'object');
  assert.equal(diagnosticMeta.truncated, true);
  assert.equal(diagnosticMeta.truncations.some(item => item.kind === 'object' || item.reason === 'max-depth'), true);
  assertJsonRoundTrip(diagnosis);
});

test('小诊断：未触及限额时内容完整，truncated=false 且无 truncation 记录', () => {
  const raw = rawDiagnosis();
  const { diagnosis, summary, diagnosticMeta } = sanitize(raw);

  assert.equal(diagnosis.fields.length, raw.fields.length);
  assert.equal(diagnosis.navigation.items.length, raw.navigation.items.length);
  assert.equal(diagnosis.embeddedSections[0].groupCount, 1);
  assert.deepEqual(summary, EXPECTED_SUMMARY);
  assert.equal(diagnosticMeta.truncated, false);
  assert.deepEqual(diagnosticMeta.truncations, []);
});

test('500 fields stress：默认限制完整保留 500 字段、raw summary 正确且可 JSON round-trip', () => {
  const fields = Array.from({ length: 500 }, (_, index) => ({
    detectorId: `field_${index}`,
    tagName: index % 2 === 0 ? 'input' : 'select',
    type: index % 2 === 0 ? 'text' : 'select',
    visible: true,
    context: {
      sectionId: 'education', collection: 'education', collectionMode: 'singleton-view',
      index: 0, regionId: 'education:0',
    },
  }));
  const { diagnosis, summary, diagnosticMeta } = sanitize(rawDiagnosis({ fields }));

  assert.equal(summary.fieldCount, 500);
  assert.equal(diagnosis.fields.length, 500);
  assert.equal(diagnosticMeta.truncated, false);
  assertJsonRoundTrip(diagnosis);
});

test('Phase E raw practice：sanitize 后保留 groupCount 与 4 个字段的 section/index/regionId context', () => {
  const practiceFields = ['startDate', 'endDate', 'location', 'description'].map((field, index) => ({
    detectorId: `practice_${field}`,
    tagName: 'input',
    type: 'text',
    labelText: field,
    matchedJsonPath: `practice[0].${field}`,
    score: 90 - index,
    context: {
      section: 'practice',
      sectionId: 'practice',
      collection: 'practice',
      collectionMode: 'repeatable',
      source: 'embedded-structure',
      confidence: 0.96,
      regionId: 'practice:region:0:group:0',
      index: 0,
      indexContext: { section: 'practice', collection: 'practice', index: 0 },
    },
  }));
  const raw = rawDiagnosis({
    embeddedSections: [{
      sectionId: 'practice', collection: 'practice', collectionMode: 'repeatable',
      source: 'embedded-structure', confidence: 0.96, groupCount: 1,
    }],
    fields: practiceFields,
    groups: [{ sectionId: 'practice', collection: 'practice', groupCount: 1, index: 0, controlCount: 4 }],
  });
  const { diagnosis, summary } = sanitize(raw);

  assert.equal(diagnosis.embeddedSections[0].collection, 'practice');
  assert.equal(diagnosis.embeddedSections[0].groupCount, 1);
  assert.equal(diagnosis.fields.length, 4);
  assert.equal(summary.fieldCount, 4);
  assert.equal(diagnosis.fields.every(field => field.context.sectionId === 'practice'), true);
  assert.equal(diagnosis.fields.every(field => field.context.index === 0), true);
  assert.equal(diagnosis.fields.every(field => Boolean(field.context.regionId)), true);
});

test('formatSummary：使用 raw summary，不依赖可能被截断的 diagnosis.fields.length', () => {
  const raw = rawDiagnosis({ fields: Array.from({ length: 620 }, (_, index) => ({ detectorId: `f_${index}` })) });
  const { diagnosis, summary } = sanitize(raw, {
    limits: { maxArrayItems: 10, maxObjectKeys: 500, maxDepth: 10, maxNodes: 5_000 },
  });
  const formatted = api().formatSummary(summary);

  assert.equal(diagnosis.fields.length, 10);
  assert.equal(summary.fieldCount, 620);
  assert.equal(typeof formatted, 'string');
  assert.match(formatted, /620/);
  assert.match(formatted, /字段/);
});

test('Runtime wiring：Sanitizer 在 Controller 前且只注入一次，并进入构建必需清单', () => {
  const popup = readFileSync(new URL('../../popup.js', import.meta.url), 'utf8');
  const build = readFileSync(new URL('../../scripts/build.mjs', import.meta.url), 'utf8');
  const controller = readFileSync(new URL('../../src/content-controller.js', import.meta.url), 'utf8');
  const runtimePath = 'src/core/diagnostic-sanitizer.js';

  assert.equal(popup.split(runtimePath).length - 1, 1);
  assert.ok(popup.indexOf(runtimePath) < popup.indexOf('src/content-controller.js'));
  assert.equal(build.split(runtimePath).length - 1, 1);
  assert.match(controller, /JFDiagnosticSanitizer/);
});

test('手工浏览器 Runtime 清单在 Controller/Adapter 消费前加载 Sanitizer', () => {
  for (const relative of ['../e2e/wizard.e2e.mjs', '../e2e/tongji-like.e2e.mjs']) {
    const source = readFileSync(new URL(relative, import.meta.url), 'utf8');
    const sanitizerIndex = source.indexOf('src/core/diagnostic-sanitizer.js');
    assert.ok(sanitizerIndex >= 0, `${relative} 缺少 Sanitizer`);
    const consumerIndexes = [
      source.indexOf('src/core/file-field-detector.js'),
      source.indexOf('src/adapters/generic-adapter.js'),
      source.indexOf('src/content-controller.js'),
    ].filter(index => index >= 0);
    assert.equal(consumerIndexes.every(index => sanitizerIndex < index), true);
  }
});

test('UI 统计只消费 raw summary，不读取 sanitized Array/String 的 length', () => {
  const controller = readFileSync(new URL('../../src/content-controller.js', import.meta.url), 'utf8');
  const popup = readFileSync(new URL('../../popup.js', import.meta.url), 'utf8');

  assert.doesNotMatch(controller, /diagnosis\.(?:fields|fileFields|embeddedSections)\?\.length/);
  assert.match(controller, /formatSummary\s*\(/);
  assert.doesNotMatch(popup, /lastDiagnosis\?\.(?:fields|fileFields|embeddedSections)\?\.length/);
  assert.match(popup, /response\?\.summary|response\.summary/);
});

test('P1 隐私：标题中的分隔手机号、户口/档案/通讯详细地址必须全部脱敏', () => {
  const title = '申请人姓名：乔天翔｜手机：138 1234 5678｜备用电话：139-8765-4321｜'
    + '户口所在地详细地址：山东省青岛市市南区敏感路88号；'
    + '档案所在单位地址：上海市杨浦区档案路66号；'
    + '通讯地址：上海市四平路1239号';
  const { diagnosis } = sanitize(rawDiagnosis({
    page: { origin: 'https://apply.example.edu', title },
  }));
  const encoded = assertJsonRoundTrip(diagnosis);

  assert.doesNotMatch(encoded, /乔天翔|138 1234 5678|139-8765-4321|敏感路88号|档案路66号|四平路1239号/);
  assert.doesNotMatch(encoded, /1234\s+5678|8765-4321/, '不得因相邻姓名规则吞掉手机号前缀后泄露号码尾部');
  assert.match(encoded, /redacted|脱敏/i);
});

test('P1 隐私：page.title fail-closed，点号手机号与无分隔姓名也不能泄露', () => {
  const { diagnosis } = sanitize(rawDiagnosis({
    page: {
      origin: 'https://apply.example.edu',
      title: '研究生报名系统（张三）- 姓名李四 - 手机：138.1234.5678',
    },
    warnings: ['姓名王五；备用手机：139·8765·4321'],
    fields: [{ detectorId: 'name_pinyin', labelText: '姓名拼音', placeholder: '请输入姓名拼音' }],
  }));
  const encoded = assertJsonRoundTrip(diagnosis);

  assert.equal(diagnosis.page.title, '<redacted-title>');
  assert.equal(diagnosis.fields[0].labelText, '姓名拼音');
  assert.equal(diagnosis.fields[0].placeholder, '请输入姓名拼音');
  assert.doesNotMatch(encoded, /张三|李四|王五|138\.1234\.5678|139·8765·4321/);
});

test('P1 隐私：Unix/file URL 路径及 xlsx/zip 真实材料名不得进入诊断', () => {
  const raw = rawDiagnosis({
    warnings: [
      'Unix材料路径：/mnt/d/private/乔天翔/推免材料.zip',
      '文件URL：file:///C:/Users/qiao/Documents/本科成绩单.xlsx',
      '待处理材料：家庭主要成员信息表.xlsx',
      '附件包：个人敏感证明材料.zip',
    ],
  });
  const { diagnosis } = sanitize(raw);
  const encoded = assertJsonRoundTrip(diagnosis);

  assert.doesNotMatch(encoded, /\/mnt\/d\/private|file:\/\/\/C:|乔天翔|推免材料\.zip|本科成绩单\.xlsx|家庭主要成员信息表\.xlsx|个人敏感证明材料\.zip/i);
  assert.match(encoded, /redacted|脱敏/i);
});

test('P1 隐私：动态 PII 键、current.value、resume.data、credentials、Bearer/JWT 均 fail-closed', () => {
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMTAxMDEyMDAwMDUwNTM5MTMifQ.private-signature';
  const raw = rawDiagnosis({
    dynamicMetadata: {
      applicantName: '乔天翔',
      mobilePhone: '138 1234 5678',
      idCardNo: '110101200005053913',
      householdDetailedAddress: '山东省青岛市市南区敏感路88号',
      archiveUnitAddress: '上海市杨浦区档案路66号',
      communicationAddress: '上海市四平路1239号',
    },
    current: { value: 'CURRENT_VALUE_SECRET', safe: 'current-safe' },
    resume: { data: { name: 'RESUME_DATA_SECRET' } },
    credentials: { username: 'private-user', passcode: 'private-passcode' },
    headers: { authHeader: `Bearer ${jwt}` },
    debugMessage: `Authorization retry: Bearer ${jwt}`,
  });
  const { diagnosis } = sanitize(raw);
  const encoded = assertJsonRoundTrip(diagnosis);

  assert.doesNotMatch(
    encoded,
    /乔天翔|138 1234 5678|110101200005053913|敏感路88号|档案路66号|四平路1239号|CURRENT_VALUE_SECRET|RESUME_DATA_SECRET|private-user|private-passcode|Bearer|eyJhbGci/i,
  );
  assert.equal(diagnosis.current.safe, 'current-safe');
  assert.equal(Object.hasOwn(diagnosis.current, 'value'), false);
  assert.equal(Object.hasOwn(diagnosis, 'resume'), false);
});

test('P1 类型稳定：Date/DOM-like 核心对象始终为普通对象，错误类型的核心集合始终为数组', () => {
  const domLike = {
    nodeType: 1,
    tagName: 'SECTION',
    ownerDocument: { title: 'secret document' },
    outerHTML: '<section>secret</section>',
  };
  const { diagnosis } = sanitize(rawDiagnosis({
    page: new Date('2026-08-23T00:00:00.000Z'),
    section: new Date('2026-08-23T00:00:00.000Z'),
    sectionDetection: domLike,
    navigation: new Date('2026-08-23T00:00:00.000Z'),
    privacy: domLike,
    embeddedSections: new Date(),
    warnings: domLike,
    fileFields: {},
    groups: 'not-an-array',
    buttons: new Set(['not-an-array']),
    saveCandidates: 42,
    fields: domLike,
  }));

  for (const key of ['page', 'section', 'sectionDetection', 'navigation', 'privacy']) {
    assert.equal(typeof diagnosis[key], 'object', key);
    assert.notEqual(diagnosis[key], null, key);
    assert.equal(Array.isArray(diagnosis[key]), false, key);
  }
  for (const key of ['embeddedSections', 'warnings', 'fileFields', 'groups', 'buttons', 'saveCandidates', 'fields']) {
    assert.equal(Array.isArray(diagnosis[key]), true, key);
  }
  assertJsonRoundTrip(diagnosis);
});

test('P1 global emergency cap：全局节点预算结构化截断且核心对象/数组不变型', () => {
  const futureBranches = Object.fromEntries(Array.from({ length: 120 }, (_, index) => [
    `future_${index}`,
    { branch: { index, metadata: { label: `安全结构${index}`, enabled: true } } },
  ]));
  const { diagnosis, summary, diagnosticMeta } = sanitize(rawDiagnosis({
    fields: Array.from({ length: 20 }, (_, index) => ({ detectorId: `field_${index}`, context: { sectionId: 'education' } })),
    futureBranches,
  }), {
    limits: {
      maxArrayItems: 500,
      maxObjectKeys: 500,
      maxDepth: 10,
      maxNodes: 5_000,
      maxTotalNodes: 40,
    },
  });

  assert.equal(summary.fieldCount, 20);
  assert.equal(diagnosticMeta.limits.maxTotalNodes, 40);
  assert.equal(diagnosticMeta.truncated, true);
  assert.equal(diagnosticMeta.truncations.some(item =>
    /global|emergency/i.test(`${item.reason || ''} ${item.kind || ''}`)), true);
  for (const key of ['page', 'section', 'sectionDetection', 'navigation', 'privacy']) {
    assert.equal(typeof diagnosis[key], 'object', key);
    assert.equal(Array.isArray(diagnosis[key]), false, key);
  }
  for (const key of ['embeddedSections', 'warnings', 'fileFields', 'groups', 'buttons', 'saveCandidates', 'fields']) {
    assert.equal(Array.isArray(diagnosis[key]), true, key);
  }
  assert.doesNotMatch(assertJsonRoundTrip(diagnosis), /\[已截断\]/);
});

test('P1 真实 GenericAdapter 诊断出口：>500 fields 的中央 summary 仍等于 raw 620', () => {
  const fields = Array.from({ length: 620 }, (_, index) => ({
    detectorId: `generic_${index}`,
    tagName: 'input',
    type: 'text',
    visible: true,
    disabled: false,
    readOnly: false,
    required: index % 2 === 0,
    context: {
      sectionId: 'basic', collection: 'basic', collectionMode: 'singleton-view',
      source: 'navigation', confidence: 0.99, regionId: 'page:basic', index: 0,
    },
  }));
  const savedGlobals = new Map();
  const installGlobal = (key, value) => {
    savedGlobals.set(key, { exists: Object.hasOwn(globalThis, key), value: globalThis[key] });
    globalThis[key] = value;
  };
  let document;
  const control = {
    isConnected: true,
    hidden: false,
    getAttribute() { return null; },
    closest() { return null; },
  };
  const contentRoot = {
    isConnected: true,
    hidden: false,
    getAttribute() { return null; },
    closest() { return null; },
    contains() { return true; },
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
    querySelectorAll(selector) {
      const source = String(selector || '');
      if (/input|textarea|select|contenteditable|combobox/.test(source)) return [control];
      return [];
    },
  };
  document = {
    nodeType: 9,
    title: '通用适配器压力诊断',
    location: { href: 'https://apply.example.edu/form', origin: 'https://apply.example.edu' },
    defaultView: { getComputedStyle() { return { display: 'block', visibility: 'visible' }; } },
    body: contentRoot,
    documentElement: contentRoot,
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
    querySelectorAll(selector) {
      const source = String(selector || '');
      if (source.startsWith('main,[role="main"],form,article')) return [contentRoot];
      return [];
    },
  };
  contentRoot.ownerDocument = document;
  control.ownerDocument = document;

  try {
    installGlobal('JFFieldDetector', {
      scan() { return fields; },
      toDiagnostic(value) { return Array.isArray(value) ? value.map(item => ({ ...item })) : { ...value }; },
    });
    installGlobal('JFFileFieldDetector', { scan() { return []; }, toDiagnostic(value) { return value; } });
    installGlobal('JFEmbeddedSectionDetector', { scan() { return []; }, detect() { return []; } });
    installGlobal('JFArrayHandler', { detectGroups() { return []; }, mapGroups() { return []; } });
    installGlobal('JFSectionStructures', { canonicalSectionId(value) { return value; } });
    installGlobal('JFSectionAliases', { collectionForSection(value) { return value; } });
    installGlobal('JFFieldMatcher', { matchFields() { return []; } });
    installGlobal('JFSaveHandler', null);
    installGlobal('JFSafety', { isDangerousAction() { return false; } });

    const GenericAdapter = require('../../src/adapters/generic-adapter.js');
    const navigationEngine = {
      scan() {
        return [{ sectionId: 'basic', label: '基本信息', text: '基本信息', confidence: 0.99, active: true, safe: true }];
      },
      scanDetailed() { return { items: this.scan(), candidates: [] }; },
    };
    const adapter = GenericAdapter.createAdapter(document, { navigationEngine });
    const raw = adapter.diagnose({
      sectionContext: {
        sectionId: 'basic', collection: 'basic', collectionMode: 'singleton-view',
        source: 'navigation', confidence: 0.99,
      },
    });
    const central = sanitize(raw);

    assert.equal(fields.length, 620);
    assert.equal(central.summary.fieldCount, 620);
    assert.equal(central.diagnosis.fields.length, 500);
  } finally {
    for (const [key, previous] of savedGlobals) {
      if (previous.exists) globalThis[key] = previous.value;
      else delete globalThis[key];
    }
  }
});
