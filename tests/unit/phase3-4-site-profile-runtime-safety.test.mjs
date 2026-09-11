import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Generic = require('../../src/adapters/generic-adapter.js');
const ArrayHandler = require('../../src/core/array-handler.js');
const Safety = require('../../src/core/safety.js');
const SaveHandler = require('../../src/core/save-handler.js');

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

function rawProfile(config = {}) {
  return {
    schemaVersion: 2,
    id: 'runtime-contract',
    revision: 'runtime-r1',
    enabled: true,
    priority: 10,
    match: {
      origins: ['https://apply.example.invalid'],
      urlPrefixes: ['https://apply.example.invalid/application/'],
      urlPatterns: [],
    },
    ...config,
  };
}

function normalized(raw) {
  const result = profileApi().normalizeProfile(raw);
  return result?.profile || result;
}

function runtimeConfig(profile) {
  return profileApi().toRuntimeConfig(profile);
}

function visibleElement(document, overrides = {}) {
  return {
    nodeType: 1,
    tagName: 'DIV',
    isConnected: true,
    hidden: false,
    disabled: false,
    readOnly: false,
    ownerDocument: document,
    parentElement: null,
    style: {},
    textContent: '',
    innerText: '',
    value: '',
    getAttribute() { return ''; },
    closest() { return null; },
    contains(node) { return node === this; },
    matches() { return false; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    ...overrides,
  };
}

function documentForContentRoots(configuredRoots = []) {
  const document = {
    nodeType: 9,
    title: 'Profile Runtime Contract',
    location: {
      origin: 'https://apply.example.invalid',
      href: 'https://apply.example.invalid/application/basic',
    },
    defaultView: {
      getComputedStyle() { return { display: 'block', visibility: 'visible', opacity: '1' }; },
    },
    querySelector(selector) {
      if (selector === '#configured-root') return configuredRoots[0] || null;
      return null;
    },
    querySelectorAll(selector) {
      if (selector === '#configured-root') return configuredRoots;
      if (selector === 'main,[role="main"],form,article,[class*="content"],[class*="form"]') return [this.fallback];
      return [];
    },
  };
  document.fallback = visibleElement(document, {
    tagName: 'MAIN',
    querySelectorAll(selector) {
      if (selector.includes('input')) return [visibleElement(document, { tagName: 'INPUT', type: 'text' })];
      return [];
    },
  });
  configuredRoots.forEach(root => { root.ownerDocument = document; });
  return document;
}

function actionElement(text, overrides = {}) {
  const element = {
    nodeType: 1,
    tagName: 'BUTTON',
    type: 'button',
    textContent: text,
    innerText: text,
    value: '',
    disabled: false,
    hidden: false,
    isConnected: true,
    style: {},
    parentElement: null,
    clickCount: 0,
    getAttribute(name) {
      if (name === 'type') return this.type;
      if (name === 'aria-hidden' || name === 'aria-disabled') return '';
      return '';
    },
    matches() { return false; },
    closest() { return null; },
    click() { this.clickCount += 1; },
    ...overrides,
  };
  return element;
}

function attachActionDocument(elements, configuredSelector = '.profile-action') {
  const url = 'https://apply.example.invalid/application/awards';
  const document = {
    nodeType: 9,
    title: '奖励情况',
    location: { href: url, origin: new URL(url).origin },
    defaultView: {
      getComputedStyle() { return { display: 'block', visibility: 'visible', opacity: '1' }; },
    },
    querySelector(selector) {
      return selector === configuredSelector ? elements[0] || null : null;
    },
    querySelectorAll(selector) {
      if (selector === configuredSelector) return elements;
      if (selector === SaveHandler.SAVE_CONTROL_SELECTOR) return elements;
      if (selector === 'button,[role="button"],a,input[type="button"]') return elements;
      return [];
    },
  };
  elements.forEach(element => { element.ownerDocument = document; });
  return document;
}

function repeatableGroup(document, id) {
  const controls = [
    visibleElement(document, { tagName: 'INPUT', type: 'text' }),
    visibleElement(document, { tagName: 'INPUT', type: 'text' }),
  ];
  return visibleElement(document, {
    id,
    contains(node) { return controls.includes(node); },
    querySelectorAll(selector) {
      return selector === ArrayHandler.CONTROL_SELECTOR ? controls : [];
    },
  });
}

test('配置 contentRoot 只有一个可见匹配时采用该 root', () => {
  const placeholderDocument = documentForContentRoots([]);
  const configured = visibleElement(placeholderDocument, { id: 'configured' });
  const document = documentForContentRoots([configured]);
  configured.ownerDocument = document;
  const profile = normalized(rawProfile({ contentRoot: '#configured-root' }));
  const adapter = Generic.createAdapter(document, { profile, config: runtimeConfig(profile), navigationEngine: { scan() { return []; } } });

  assert.equal(adapter.findContentRoot('basic'), configured);
});

test('配置 contentRoot 有多个可见匹配时不得猜第一个，必须回退 Generic root', () => {
  const placeholderDocument = documentForContentRoots([]);
  const first = visibleElement(placeholderDocument, { id: 'duplicate-first' });
  const second = visibleElement(placeholderDocument, { id: 'duplicate-second' });
  const document = documentForContentRoots([first, second]);
  first.ownerDocument = document;
  second.ownerDocument = document;
  const profile = normalized(rawProfile({ contentRoot: '#configured-root' }));
  const adapter = Generic.createAdapter(document, { profile, config: runtimeConfig(profile), navigationEngine: { scan() { return []; } } });

  assert.equal(adapter.findContentRoot('basic'), document.fallback);
  assert.notEqual(adapter.findContentRoot('basic'), first);
});

test('repeatable Profile 的 root/group/add 只作用于局部区域，并按 JSON 3 条安全新增到 3 组', async () => {
  const groups = [];
  const addButton = actionElement('新增奖励');
  const document = attachActionDocument([addButton], '.profile-add-award');
  groups.push(repeatableGroup(document, 'award-1'));
  addButton.click = () => {
    addButton.clickCount += 1;
    groups.push(repeatableGroup(document, `award-${groups.length + 1}`));
  };
  const root = visibleElement(document, {
    id: 'awards-root',
    contains(node) { return node === addButton || groups.includes(node); },
    querySelector(selector) { return selector === '.profile-add-award' ? addButton : null; },
    querySelectorAll(selector) {
      if (selector === '.profile-award-row') return groups;
      if (selector === '.profile-add-award') return [addButton];
      if (selector === 'button,[role="button"],a,input[type="button"]') return [addButton];
      if (selector === ArrayHandler.CONTROL_SELECTOR) return [];
      return [];
    },
  });
  groups.forEach(group => { group.parentElement = root; });
  addButton.parentElement = root;
  const profile = normalized(rawProfile({
    sections: {
      awards: {
        root: '#awards-root',
        groupSelector: '.profile-award-row',
        addButtonSelector: '.profile-add-award',
      },
    },
  }));
  const options = runtimeConfig(profile).sections.awards;

  assert.deepEqual(ArrayHandler.detectGroups(root, options), [groups[0]]);
  const result = await ArrayHandler.prepare('awards', [{}, {}, {}], root, { ...options, timeoutMs: 250 });
  assert.equal(result.ok, true, result.error);
  assert.equal(result.count, 3);
  assert.equal(result.clicks, 2);
  assert.equal(addButton.clickCount, 2);
  assert.deepEqual(result.groups, groups);
  assert.deepEqual(result.groupContexts.map(item => item.index), [0, 1, 2]);
});

test('Profile addButtonSelector 指向提交按钮时仍被全局 Safety 拒绝，零点击', async () => {
  const submit = actionElement('最终提交', { type: 'button' });
  const document = attachActionDocument([submit], '.profile-add-award');
  const groups = [{ id: 'row-1' }];
  const root = visibleElement(document, {
    contains(node) { return node === submit; },
    querySelector(selector) { return selector === '.profile-add-award' ? submit : null; },
    querySelectorAll(selector) {
      if (selector === 'button,[role="button"],a,input[type="button"]') return [submit];
      return [];
    },
  });
  submit.parentElement = root;
  const result = await ArrayHandler.prepare('awards', [{}, {}], root, {
    getGroups: () => groups,
    addButtonSelector: '.profile-add-award',
    timeoutMs: 250,
  });

  assert.equal(result.ok, false);
  assert.equal(result.clicks, 0);
  assert.equal(submit.clickCount, 0);
});

test('Profile addButtonSelector 命中多个安全候选时必须 fail-closed，零点击且不回退全页按钮', async () => {
  const first = actionElement('新增奖励');
  const second = actionElement('新增奖励');
  const document = attachActionDocument([first, second], '.profile-add-award');
  const groups = [{ id: 'row-1' }];
  const root = visibleElement(document, {
    contains(node) { return node === first || node === second; },
    querySelector(selector) { return selector === '.profile-add-award' ? first : null; },
    querySelectorAll(selector) {
      if (selector === '.profile-add-award') return [first, second];
      if (selector === 'button,[role="button"],a,input[type="button"]') return [first, second];
      return [];
    },
  });
  first.parentElement = root;
  second.parentElement = root;

  const result = await ArrayHandler.prepare('awards', [{}, {}], root, {
    getGroups: () => groups,
    addButtonSelector: '.profile-add-award',
    timeoutMs: 250,
  });

  assert.equal(result.ok, false);
  assert.equal(result.clicks, 0);
  assert.equal(first.clickCount + second.clickCount, 0);
});

test('Profile safeSaveSelector 的唯一“保存”候选在用户授权后可安全暂存', async () => {
  const safeSave = actionElement('保存', { tagName: 'BUTTON', type: 'button' });
  const document = attachActionDocument([safeSave], '#profile-safe-save');
  const profile = normalized(rawProfile({ save: { selectors: ['#profile-safe-save'] } }));
  const config = runtimeConfig(profile);
  const handler = SaveHandler.createSaveHandler({
    document,
    configuredSelectors: config.safeSaveSelectors,
  });
  const inspection = handler.inspect();
  assert.equal(inspection.length, 1);
  assert.equal(inspection[0].safe, true);
  assert.equal(Safety.validateConfiguredCandidate(safeSave, 'save', { baseUrl: document.location.href }), true);

  const result = await handler.save({ userInitiated: true, confirmText: '保存' });
  assert.equal(result.ok, true, result.reason || result.code);
  assert.equal(result.clicked, true);
  assert.equal(safeSave.clickCount, 1);
});

test('submit/image 控件即使精确写着保存、同源 action 且运行已授权，也必须零点击', async () => {
  const cases = [
    { tagName: 'BUTTON', type: 'submit', label: '保存' },
    { tagName: 'INPUT', type: 'submit', label: '保存' },
    { tagName: 'INPUT', type: 'image', label: '暂存' },
  ];

  for (const sample of cases) {
    const form = {
      action: 'https://apply.example.invalid/application/save-draft',
      method: 'post',
      getAttribute(name) { return name === 'action' ? this.action : name === 'method' ? this.method : ''; },
    };
    const control = actionElement(sample.label, {
      tagName: sample.tagName,
      type: sample.type,
      value: sample.label,
      form,
      closest(selector) { return selector === 'form' ? form : null; },
    });
    const document = attachActionDocument([control], '#profile-safe-save');
    const handler = SaveHandler.createSaveHandler({
      document,
      configuredSelectors: ['#profile-safe-save'],
    });

    const inspection = handler.inspect();
    assert.equal(inspection.length, 1, `${sample.tagName}/${sample.type} 应进入被动诊断`);
    assert.equal(inspection[0].safe, false, `${sample.tagName}/${sample.type} 不能成为安全保存候选`);
    assert.equal(Safety.isSafeSaveCandidate(control, { baseUrl: document.location.href }), false);
    assert.equal(Safety.validateConfiguredCandidate(control, 'save', { baseUrl: document.location.href }), false);

    const result = await handler.save({
      confirmText: sample.label,
      runAuthorization: {
        taskId: 'task-safe-save-001',
        nonce: 'nonce_safe_save_1234567890',
        userConfirmed: true,
        allowSafeSave: true,
        expiresAt: Date.now() + 60_000,
      },
    });
    assert.equal(result.ok, false);
    assert.equal(result.clicked, false);
    assert.equal(control.clickCount, 0);
  }
});

test('Profile safeSaveSelector 指向“保存并提交”时仍 fail-closed，零点击', async () => {
  const dangerous = actionElement('保存并提交');
  const document = attachActionDocument([dangerous], '#profile-safe-save');
  const profile = normalized(rawProfile({ save: { selectors: ['#profile-safe-save'] } }));
  const config = runtimeConfig(profile);
  const handler = SaveHandler.createSaveHandler({
    document,
    configuredSelectors: config.safeSaveSelectors,
  });
  const inspection = handler.inspect();
  assert.equal(inspection.every(item => item.safe === false), true);
  const result = await handler.save({ userInitiated: true, confirmText: '保存并提交' });

  assert.equal(result.ok, false);
  assert.equal(result.clicked, false);
  assert.equal(dangerous.clickCount, 0);
});
