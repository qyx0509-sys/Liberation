import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const FieldAliases = require('../../src/mappings/field-aliases.js');
const OptionAliases = require('../../src/mappings/option-aliases.js');
const SectionAliases = require('../../src/mappings/section-aliases.js');
const FieldMatcher = require('../../src/core/field-matcher.js');
const Navigation = require('../../src/core/navigation-engine.js');

let SiteProfile = null;
let siteProfileLoadError = null;
try {
  SiteProfile = require('../../src/adapters/site-profile.js');
} catch (error) {
  siteProfileLoadError = error;
}

function profileApi() {
  assert.equal(siteProfileLoadError, null, 'Phase 3.4 必须提供 src/adapters/site-profile.js');
  assert.equal(typeof SiteProfile.normalizeProfile, 'function');
  assert.equal(typeof SiteProfile.toRuntimeConfig, 'function');
  return SiteProfile;
}

function profile(id, marker) {
  const local = {
    甲站: { section: '星河入口', field: '霜序令牌', option: '琥珀档' },
    乙站: { section: '沧海页签', field: '云岫密钥', option: '翡翠档' },
    局部站: { section: '长风端口', field: '青冥标识', option: '赤霞档' },
  }[marker];
  return {
    schemaVersion: 2,
    id,
    revision: `${id}-r1`,
    enabled: true,
    priority: 10,
    match: {
      origins: [`https://${id}.example.invalid`],
      urlPrefixes: [],
      urlPatterns: [],
    },
    navigation: {
      selectors: [],
      minimumConfidence: 0.78,
      sectionAliases: { awards: [local.section] },
    },
    contentRoot: '',
    sections: {},
    fieldAliases: { 'basic.name': [local.field] },
    optionAliases: { 'basic.gender': { 男: [local.option] } },
    save: { selectors: [] },
  };
}

function runtime(raw) {
  const module = profileApi();
  return module.toRuntimeConfig(module.normalizeProfile(raw));
}

function descriptor(label) {
  return {
    detectorId: `profile_overlay_${label}`,
    element: { tagName: 'INPUT' },
    visible: true,
    hidden: false,
    disabled: false,
    readOnly: false,
    sensitive: false,
    maskedDisplay: false,
    labelText: label,
    placeholder: '',
    name: '',
    id: '',
    ariaLabel: '',
    nearbyText: '',
    parentText: '',
    groupText: '',
    tableHeader: '',
    controlKind: 'text',
    baseControlKind: 'text',
    type: 'text',
    context: { sectionId: 'basic', collection: 'basic', confidence: 1, source: 'test' },
  };
}

function minimalDocument() {
  return {
    nodeType: 9,
    title: 'Profile Overlay',
    location: { origin: 'https://profile.example.invalid', href: 'https://profile.example.invalid/apply' },
    documentElement: { childElementCount: 0 },
    defaultView: { getComputedStyle() { return { display: 'block', visibility: 'visible', opacity: '1' }; } },
    querySelectorAll() { return []; },
  };
}

test('field alias overlay 只对本次 match 调用生效，不污染另一个 Profile', () => {
  const alpha = runtime(profile('profile-alpha', '甲站'));
  const beta = runtime(profile('profile-beta', '乙站'));
  const resume = { basic: { name: '测试用户' } };

  const alphaOwn = FieldMatcher.matchField(descriptor('霜序令牌'), resume, {
    section: 'basic',
    minScore: 62,
    fieldAliases: alpha.fieldAliases,
  });
  const alphaForeign = FieldMatcher.matchField(descriptor('云岫密钥'), resume, {
    section: 'basic',
    minScore: 62,
    fieldAliases: alpha.fieldAliases,
  });
  const betaOwn = FieldMatcher.matchField(descriptor('云岫密钥'), resume, {
    section: 'basic',
    minScore: 62,
    fieldAliases: beta.fieldAliases,
  });

  assert.equal(alphaOwn.status, FieldMatcher.MATCH_STATUS.MATCHED);
  assert.equal(alphaOwn.matchedPath, 'basic.name');
  assert.notEqual(alphaForeign.status, FieldMatcher.MATCH_STATUS.MATCHED);
  assert.equal(betaOwn.status, FieldMatcher.MATCH_STATUS.MATCHED);
  assert.equal(betaOwn.matchedPath, 'basic.name');
});

test('option alias overlay 按 fieldPath + canonical value 局部生效', () => {
  const alpha = runtime(profile('profile-alpha-option', '甲站'));
  const beta = runtime(profile('profile-beta-option', '乙站'));
  const alphaOption = { label: '琥珀档', value: 'profile-male-alpha' };
  const betaOption = { label: '翡翠档', value: 'profile-male-beta' };

  const alphaOwn = OptionAliases.findBestOption('男', [alphaOption], {
    fieldPath: 'basic.gender',
    optionAliases: alpha.optionAliases,
  });
  const alphaForeign = OptionAliases.findBestOption('男', [betaOption], {
    fieldPath: 'basic.gender',
    optionAliases: alpha.optionAliases,
  });
  const betaOwn = OptionAliases.findBestOption('男', [betaOption], {
    fieldPath: 'basic.gender',
    optionAliases: beta.optionAliases,
  });

  assert.equal(alphaOwn.matched, true);
  assert.equal(alphaOwn.option, alphaOption);
  assert.equal(alphaForeign.matched, false);
  assert.equal(betaOwn.matched, true);
  assert.equal(betaOwn.option, betaOption);
});

test('section alias overlay 只注入当前 NavigationEngine 实例', () => {
  const alpha = runtime(profile('profile-alpha-section', '甲站'));
  const beta = runtime(profile('profile-beta-section', '乙站'));
  const document = minimalDocument();
  const alphaNavigation = Navigation.createNavigationEngine({ document, sectionAliases: alpha.sectionAliases });
  const betaNavigation = Navigation.createNavigationEngine({ document, sectionAliases: beta.sectionAliases });

  assert.equal(alphaNavigation.classify('星河入口').sectionId, 'awards');
  assert.notEqual(alphaNavigation.classify('沧海页签').sectionId, 'awards');
  assert.equal(betaNavigation.classify('沧海页签').sectionId, 'awards');
  assert.notEqual(betaNavigation.classify('星河入口').sectionId, 'awards');
  alphaNavigation.destroy();
  betaNavigation.destroy();
});

test('三类 local overlay 执行后，全局 alias 真源逐字节不变', () => {
  const before = {
    fields: JSON.stringify(FieldAliases.FIELD_ALIASES),
    fieldOptions: JSON.stringify(OptionAliases.FIELD_OPTION_ALIASES),
    options: JSON.stringify(OptionAliases.OPTION_ALIASES),
    sections: JSON.stringify(SectionAliases.SECTION_ALIASES),
  };
  const local = runtime(profile('profile-no-global-pollution', '局部站'));
  FieldMatcher.matchField(descriptor('青冥标识'), { basic: { name: '测试用户' } }, {
    section: 'basic', fieldAliases: local.fieldAliases,
  });
  OptionAliases.findBestOption('男', [{ label: '赤霞档', value: 'local-male' }], {
    fieldPath: 'basic.gender', optionAliases: local.optionAliases,
  });
  const navigation = Navigation.createNavigationEngine({
    document: minimalDocument(), sectionAliases: local.sectionAliases,
  });
  navigation.classify('长风端口');
  navigation.destroy();

  assert.equal(JSON.stringify(FieldAliases.FIELD_ALIASES), before.fields);
  assert.equal(JSON.stringify(OptionAliases.FIELD_OPTION_ALIASES), before.fieldOptions);
  assert.equal(JSON.stringify(OptionAliases.OPTION_ALIASES), before.options);
  assert.equal(JSON.stringify(SectionAliases.SECTION_ALIASES), before.sections);
});
