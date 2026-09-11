import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let SiteProfile = null;
let siteProfileLoadError = null;
try {
  SiteProfile = require('../../src/adapters/site-profile.js');
} catch (error) {
  siteProfileLoadError = error;
}

function api(...methods) {
  assert.equal(siteProfileLoadError, null, 'Phase 3.4 必须提供 src/adapters/site-profile.js');
  assert.ok(SiteProfile && typeof SiteProfile === 'object');
  methods.forEach(method => assert.equal(typeof SiteProfile[method], 'function', `JFSiteProfile.${method} 必须存在`));
  return SiteProfile;
}

function validV2(overrides = {}) {
  const base = {
    schemaVersion: 2,
    id: 'example-graduate-application',
    revision: '2026-08-24.1',
    enabled: true,
    priority: 20,
    match: {
      origins: ['https://apply.example.invalid'],
      urlPrefixes: ['https://apply.example.invalid/application/'],
      urlPatterns: [],
    },
    navigation: {
      selectors: ['#verified-sidebar a'],
      sectionAliases: { awards: ['平台荣誉'] },
    },
    contentRoot: '#verified-form-root',
    fieldAliases: { 'basic.name': ['平台姓名'] },
    optionAliases: { 'basic.gender': { 男: ['平台男'] } },
    save: { selectors: ['#verified-save'] },
    sections: {
      awards: {
        root: '#verified-awards-panel',
        groupSelector: '.verified-award-row',
        addButtonSelector: '.verified-add-award',
      },
    },
  };
  return {
    ...base,
    ...overrides,
    match: { ...base.match, ...(overrides.match || {}) },
    navigation: { ...base.navigation, ...(overrides.navigation || {}) },
    save: { ...base.save, ...(overrides.save || {}) },
  };
}

function verdictOk(verdict) {
  return verdict?.ok ?? verdict?.valid ?? false;
}

function normalizedProfile(result) {
  return result?.profile || result;
}

test('Site Profile 暴露 V2 schema 的纯数据 API 与浏览器全局名称', () => {
  const module = api('normalizeProfile', 'validateProfile', 'sanitizeProfile', 'toRuntimeConfig');
  assert.equal(module.SCHEMA_VERSION, 2);
  assert.equal(globalThis.JFSiteProfile, module);
});

test('V1 配置无损迁移为 V2，且不修改调用方原对象', () => {
  const module = api('normalizeProfile');
  const legacy = {
    enabled: true,
    id: 'legacy-example',
    revision: 'legacy-r7',
    adapterId: 'generic',
    priority: 12,
    origin: 'https://apply.example.invalid',
    urlPrefix: 'https://apply.example.invalid/application/',
    urlPattern: 'https://apply.example.invalid/application/*',
    navigationSelectors: ['#legacy-nav a'],
    contentRoot: '#legacy-root',
    fieldAliases: { 'basic.name': ['旧站姓名'] },
    optionAliases: { 'basic.gender': { 男: ['旧站男'] } },
    safeSaveSelector: '#legacy-save',
    sections: {
      awards: {
        root: '#legacy-awards',
        groupSelector: '.legacy-award-row',
        addButtonSelector: '.legacy-add-award',
      },
    },
  };
  const before = JSON.stringify(legacy);
  const migrated = normalizedProfile(module.normalizeProfile(legacy));

  assert.equal(JSON.stringify(legacy), before, '迁移不得原地修改 chrome.storage 中的旧对象');
  assert.equal(migrated.schemaVersion, 2);
  assert.equal(migrated.id, 'legacy-example');
  assert.equal(migrated.revision, 'legacy-r7');
  assert.equal(migrated.priority, 12);
  assert.deepEqual(migrated.match.origins, ['https://apply.example.invalid']);
  assert.deepEqual(migrated.match.urlPrefixes, ['https://apply.example.invalid/application/']);
  assert.deepEqual(migrated.match.urlPatterns, ['https://apply.example.invalid/application/*']);
  assert.equal(migrated.contentRoot, '#legacy-root');
  assert.deepEqual(migrated.navigation.selectors, ['#legacy-nav a']);
  assert.deepEqual(migrated.sections.awards, legacy.sections.awards);
  assert.deepEqual(migrated.fieldAliases, legacy.fieldAliases);
  assert.deepEqual(migrated.optionAliases, legacy.optionAliases);
  assert.deepEqual(migrated.save.selectors, ['#legacy-save']);
});

test('合法 V2 通过校验并得到可序列化、无函数的规范对象', () => {
  const module = api('validateProfile', 'normalizeProfile');
  const raw = validV2();
  const verdict = module.validateProfile(raw);
  assert.equal(verdictOk(verdict), true, JSON.stringify(verdict?.errors || verdict));
  const normalized = normalizedProfile(verdict?.profile ? verdict : module.normalizeProfile(raw));
  assert.doesNotThrow(() => JSON.stringify(normalized));
  assert.equal(normalized.id, raw.id);
  assert.equal(normalized.revision, raw.revision);
  assert.equal(normalized.schemaVersion, 2);
});

test('非法 V2 被 fail-closed 拒绝：版本、identity、match 与 selector 类型都不能含糊通过', () => {
  const module = api('validateProfile');
  const cases = [
    validV2({ schemaVersion: 3 }),
    validV2({ schemaVersion: '2' }),
    validV2({ id: '' }),
    validV2({ revision: '' }),
    validV2({ match: { origins: [], urlPrefixes: [], urlPatterns: [] } }),
    validV2({ match: { origins: [42] } }),
    validV2({ navigation: { selectors: '#not-an-array' } }),
    validV2({ sections: { awards: { groupSelector: ['not-a-selector'] } } }),
  ];

  cases.forEach((candidate, index) => {
    const verdict = module.validateProfile(candidate);
    assert.equal(verdictOk(verdict), false, `非法样例 ${index + 1} 不得通过：${JSON.stringify(verdict)}`);
    assert.ok(Array.isArray(verdict?.errors) && verdict.errors.length > 0, '拒绝时必须返回结构化 errors');
  });
});

test('不安全 host 通配 pattern 必须拒绝，不能把 Profile 激活到相邻恶意 origin', () => {
  const module = api('validateProfile', 'wildcardMatches');
  const unsafe = validV2({
    match: {
      origins: [],
      urlPrefixes: [],
      urlPatterns: ['https://apply.example.invalid*/application/*'],
    },
  });

  const verdict = module.validateProfile(unsafe);
  assert.equal(verdictOk(verdict), false);
  assert.equal(
    module.wildcardMatches(
      'https://apply.example.invalid*/application/*',
      'https://apply.example.invalid.evil/application/basic',
    ),
    false,
  );
});

test('V2 wrapper 必须要求每个 adapters 子项显式为 V2；顶层旧数组仍保持 V1 兼容', () => {
  const module = api('normalizeProfiles');
  const legacy = {
    id: 'legacy-array-profile',
    revision: 'legacy-r1',
    origin: 'https://legacy.example.invalid',
    contentRoot: '#legacy-root',
  };

  const strictV2 = module.normalizeProfiles({
    schemaVersion: 2,
    description: 'strict-v2-wrapper',
    adapters: [legacy],
  });
  assert.equal(strictV2.profiles.length, 0);
  assert.equal(strictV2.rejected.length, 1);
  assert.equal(strictV2.rejected[0].errors[0].code, 'V2_PROFILE_REQUIRED');

  const compatibleLegacyArray = module.normalizeProfiles([legacy]);
  assert.equal(compatibleLegacyArray.rejected.length, 0);
  assert.equal(compatibleLegacyArray.profiles.length, 1);
  assert.equal(compatibleLegacyArray.profiles[0].id, 'legacy-array-profile');
});

test('wrapper schemaVersion 必须是 JSON integer，不接受字符串数值强转', () => {
  const module = api('normalizeProfiles');
  const result = module.normalizeProfiles({
    schemaVersion: '2',
    description: 'coerced-version-must-fail',
    adapters: [],
  });

  assert.equal(result.profiles.length, 0);
  assert.equal(result.rejected.length, 1);
  assert.equal(result.rejected[0].errors[0].code, 'UNSUPPORTED_SCHEMA_VERSION');
});

test('原型污染键必须拒绝或剥离，且绝不能污染 Object.prototype', () => {
  const module = api('validateProfile', 'sanitizeProfile');
  const polluted = validV2();
  Object.assign(polluted, JSON.parse(`{
    "__proto__": { "phase34Polluted": true },
    "constructor": { "prototype": { "phase34Polluted": true } }
  }`));

  const verdict = module.validateProfile(polluted);
  assert.equal(verdictOk(verdict), false, '含 prototype-pollution 键的 profile 必须拒绝');
  assert.equal(Object.prototype.phase34Polluted, undefined);

  const sanitized = module.sanitizeProfile(polluted);
  assert.equal(Object.prototype.phase34Polluted, undefined);
  assert.equal(Object.hasOwn(sanitized || {}, '__proto__'), false);
  assert.equal(Object.hasOwn(sanitized || {}, 'constructor'), false);
});

test('函数、RegExp 与危险执行能力不能进入 Site Profile', () => {
  const module = api('validateProfile');
  const candidates = [
    validV2({ navigation: { selectors: [() => '#nav'] } }),
    validV2({ match: { urlPatterns: [/application/i] } }),
    validV2({ autoSubmit: true }),
    validV2({ submitSelector: '#final-submit' }),
    validV2({ finalSubmitSelector: '#final-submit' }),
    validV2({ script: 'document.querySelector("button").click()' }),
    validV2({ evaluate() {} }),
    validV2({ capabilities: { fetch: true, cookies: true } }),
  ];

  candidates.forEach((candidate, index) => {
    const verdict = module.validateProfile(candidate);
    assert.equal(verdictOk(verdict), false, `危险能力样例 ${index + 1} 不得通过`);
  });
});
