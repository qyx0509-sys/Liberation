import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const popupSource = readFileSync(new URL('../../popup.js', import.meta.url), 'utf8');
const popupHtml = readFileSync(new URL('../../popup.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../../src/ui/popup.css', import.meta.url), 'utf8');
const helperSources = ['design-system.js', 'profile-coverage.js'].map(name => readFileSync(new URL(`../../src/ui/${name}`, import.meta.url), 'utf8'));
const allIds = [...popupHtml.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
const primaryIds = ['btn-run-all', 'btn-pause', 'btn-resume', 'btn-review', 'btn-result', 'btn-problem'];

function harness() {
  const nodes = new Map();
  const messages = [];
  const callbacks = new Map();
  let document;
  function node(id) {
    if (!nodes.has(id)) {
      const listeners = new Map();
      const attributes = new Map();
      const value = {
        id, hidden: false, disabled: false, textContent: '', innerHTML: '', className: '', style: {},
        classList: { add() {}, remove() {} },
        listeners,
        addEventListener(event, handler) { listeners.set(event, handler); },
        setAttribute(name, input) { attributes.set(name, String(input)); },
        getAttribute(name) { return attributes.get(name); },
        focus() { document.activeElement = value; },
        contains(target) { return target === value; },
        querySelector() { return node('btn-scan'); },
        querySelectorAll() { return ['btn-scan', 'btn-diagnose', 'btn-copy-diagnosis', 'btn-download-diagnosis', 'btn-options', 'btn-materials', 'btn-about'].map(node).filter(item => !item.disabled); },
        closest() { return value; },
        showModal() { value.open = true; },
        close() { value.open = false; listeners.get('close')?.(); },
      };
      nodes.set(id, value);
    }
    return nodes.get(id);
  }
  document = { getElementById: node, visibilityState: 'visible', activeElement: null, addEventListener(type, callback) { callbacks.set(type, callback); }, querySelectorAll() { return []; } };
  allIds.forEach(node);
  const nextSnapshot = { runtimeRevision: 'jiefang-page-runtime-v3', runtimeCapabilities: ['runtime-snapshot-contract-v1', 'required-globals-verified-v1'], scanCountsFinal: true, state: 'RUNNING', scanId: 'scan:ui-popup-current' };
  const context = vm.createContext({
    document, console, setTimeout, clearTimeout,
    window: { addEventListener(type, callback) { callbacks.set(type, callback); }, close() { messages.push({ type: 'WINDOW_CLOSE' }); } },
    chrome: {
      runtime: { getManifest: () => ({ version: '3.0.3' }), sendMessage: async message => { messages.push(message); return {}; }, getURL: path => `chrome-extension://test/${path}` },
      storage: { onChanged: { addListener(callback) { callbacks.set('storage', callback); } }, local: { get: async () => ({}) } },
      tabs: {
        query: async () => [{ id: 7, url: 'https://fixture.invalid/apply' }],
        sendMessage: async (_tabId, message) => { messages.push(message); return { ok: true, snapshot: nextSnapshot }; },
        create: async data => { messages.push(data); },
      },
      scripting: { executeScript: async data => { messages.push(data); } },
    },
  });
  helperSources.forEach(source => vm.runInContext(source, context));
  const cutoff = popupSource.indexOf('init().catch');
  vm.runInContext(`${popupSource.slice(0, cutoff)}
    globalThis.__test = {
      setState(next, profile = { basic: { name: '测试资料' } }, phase = 'READY') { snapshot = next; taskState = null; resumeData = profile; interfacePhase = phase; render(); },
      menu: setAdvancedMenu,
      setTab(id) { activeTabId = id; },
      refresh: refreshSnapshot,
      status: setStatus,
      review: reviewItemsForDisplay,
      render,
    };`, context);
  return { api: context.__test, context, node, nodes, messages, callbacks };
}

test('Popup uses local design resources, product language and complete unique action IDs', () => {
  assert.equal(new Set(allIds).size, allIds.length);
  for (const id of [...popupSource.matchAll(/(?:element|bindAsync)\('([^']+)'/g)].map(match => match[1])) assert.ok(allIds.includes(id), `missing popup element ${id}`);
  assert.match(popupHtml, /我的申请资料/);
  assert.match(popupHtml, /按已维护的申请资料字段统计/);
  assert.match(popupHtml, /检查并开始填写/);
  assert.doesNotMatch(popupHtml, /TaskState|统一 Resume JSON|\p{Extended_Pictographic}/u);
  assert.doesNotMatch(popupHtml + css, /(?:src|href)=["']https?:|@import|url\(["']?https?:/i);
  assert.match(css, /width:\s*420px/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /var\(--on-brand\)/);
});

test('Native Popup requests a fixed intrinsic width instead of capping itself to its initial viewport', () => {
  // Ignore explanatory comments: only executable declarations participate in
  // native popup sizing. Real window geometry is verified by extension-load.
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const declarations = selector => {
    const body = rules.match(new RegExp(`(?:^|})\\s*${selector}\\s*\\{([^}]*)\\}`, 'm'))?.[1];
    assert.ok(body, `missing ${selector} sizing rule`);
    return Object.fromEntries(body.split(';').filter(item => item.includes(':')).map(item => {
      const separator = item.indexOf(':');
      return [item.slice(0, separator).trim(), item.slice(separator + 1).trim()];
    }));
  };
  for (const selector of ['html', 'body']) {
    const style = declarations(selector);
    assert.equal(style.width, '420px', `${selector} must request the intended native width`);
    assert.equal(style['min-width'], '420px', `${selector} must not shrink to the popup's initial size`);
    assert.doesNotMatch(style['max-width'] || '', /(?:\d|\.)\s*(?:[dsl]?vw|%)/, `${selector} cannot cap intrinsic width to its own viewport`);
  }
  const body = declarations('body');
  assert.ok(parseFloat(body['max-height']) > 0 && parseFloat(body['max-height']) <= 600, 'body must fit the native popup height limit');
  assert.equal(body.overflow, 'hidden');
  assert.equal(declarations('main')['overflow-y'], 'auto', 'long content must scroll inside main');
});

for (const [state, primary, secondary] of [
  ['IDLE', 'btn-run-all', ['btn-run-current', 'btn-panel']],
  ['RUNNING', 'btn-pause', ['btn-stop']],
  ['PAUSED', 'btn-resume', ['btn-stop']],
  ['WAITING_USER', 'btn-review', ['btn-skip']],
  ['FINISHED', 'btn-result', ['btn-rescan']],
  ['ERROR', 'btn-problem', ['btn-rescan']],
]) {
  test(`Popup ${state} exposes one primary action and only relevant controls`, () => {
    const { api, node } = harness();
    api.setState({ state, scanCountsFinal: true, scanPhase: 'READY' });
    assert.deepEqual(primaryIds.filter(id => !node(id).hidden), [primary]);
    for (const id of secondary) assert.equal(node(id).hidden, false);
    const hiddenControl = state === 'PAUSED' ? 'btn-pause' : 'btn-resume';
    if (hiddenControl !== primary) assert.equal(node(hiddenControl).hidden, true);
    assert.doesNotMatch(node('task-state').textContent, /IDLE|RUNNING|PAUSED|WAITING_USER|FINISHED|ERROR/);
  });
}

test('Popup scan placeholders never present provisional zero as final', () => {
  const { api, node } = harness();
  api.setState({ state: 'IDLE', scanPhase: 'STABILIZING', scanCountsFinal: false }, {}, 'SCANNING');
  assert.match(node('system-badge').textContent, /等待稳定/);
  assert.doesNotMatch(node('system-meta').textContent, /0 项可自动处理/);
  assert.equal(node('btn-run-all').disabled, true);
  api.setState({ state: 'IDLE', scanPhase: 'READY', scanCountsFinal: true, reliableFieldCount: 18, embeddedSectionCount: 4 });
  assert.equal(node('system-meta').textContent, '18 项可自动处理 · 4 个页面内区域');
  assert.equal(node('btn-run-all').disabled, false);
});

test('Popup empty profile uses actual editable-field coverage and no invented readiness', () => {
  const { api, context, node } = harness();
  api.setState({ state: 'IDLE', scanCountsFinal: true, resumeStats: { basic: 1 } }, null);
  const actual = context.JFProfileCoverage.fromResume({});
  assert.equal(node('profile-coverage').textContent, '资料覆盖度 0%');
  assert.match(node('resume-stats').innerHTML, new RegExp(`<b>${actual.missing}</b>`));
  assert.equal(node('btn-create-profile').hidden, false);
  assert.equal(node('btn-run-all').disabled, true);
});

test('Popup review is bounded to 3, filters success and never renders private values or reason codes', () => {
  const { api, node } = harness();
  api.setState({ state: 'WAITING_USER', scanCountsFinal: true, reviewCount: 8, reviewItems: [
    ...['NEEDS_CONFIRMATION', 'MISSING_JSON', 'CONFLICT', 'ERROR'].map((status, index) => ({ fieldLabel: `字段${index}`, section: 'basic', status, reason: 'SECRET_VALUE', reasonCode: 'NO_MONTH_MODE_SWITCH', plannedValue: 'PRIVATE_PHONE', afterValue: 'PRIVATE_ID' })),
    { status: 'SUCCESS', fieldLabel: '已经处理' },
  ] });
  assert.equal((node('review-list').innerHTML.match(/class="review-item"/g) || []).length, 3);
  assert.equal(node('review-count').textContent, '8 项');
  assert.doesNotMatch(node('review-list').innerHTML, /SECRET_VALUE|NO_MONTH_MODE_SWITCH|PRIVATE_PHONE|PRIVATE_ID|已经处理/);
  assert.match(node('review-list').innerHTML, /资料缺失/);
  assert.equal(node('btn-review-all').hidden, false);
});

test('Popup preview remains waiting for user even when a run is active', () => {
  const { api, node } = harness();
  api.setState({ state: 'PREPARING', running: true, awaitingPreview: true, scanCountsFinal: true });
  assert.equal(node('btn-review').hidden, false);
  assert.equal(node('btn-pause').hidden, true);
});

test('Popup restored review count does not incorrectly claim there are no issues', () => {
  const { api, node } = harness();
  api.setState({ state: 'WAITING_USER', scanCountsFinal: true, reviewCount: 5, reviewItems: [] });
  assert.match(node('review-list').innerHTML, /5 项需要核对/);
  assert.doesNotMatch(node('review-list').innerHTML, /没有需要处理/);
});

test('Popup advanced menu is keyboard navigable and Escape restores the trigger', () => {
  const { api, node } = harness();
  api.menu(true);
  assert.equal(node('advanced-menu').hidden, false);
  assert.equal(node('btn-advanced').getAttribute('aria-expanded'), 'true');
  node('advanced-menu').listeners.get('keydown')({ key: 'ArrowDown', preventDefault() {} });
  node('advanced-menu').listeners.get('keydown')({ key: 'Escape', preventDefault() {} });
  assert.equal(node('advanced-menu').hidden, true);
  assert.equal(node('btn-advanced').getAttribute('aria-expanded'), 'false');
});

test('Popup review action only opens the existing assistant review tab', async () => {
  const { api, node, messages } = harness();
  api.setState({ state: 'WAITING_USER', scanCountsFinal: true });
  await node('btn-review').listeners.get('click')();
  assert.ok(messages.some(message => message.type === 'SHOW_PANEL' && message.tab === 'review'));
  assert.ok(!messages.some(message => ['RUN_ALL', 'RUN_CURRENT', 'SKIP'].includes(message.type)));
});

test('Popup normal error feedback keeps technical reason codes in advanced diagnosis only', () => {
  const { api, node } = harness();
  api.status('日期控件失败 NO_MONTH_MODE_SWITCH', 'error');
  assert.doesNotMatch(node('status').textContent, /NO_MONTH_MODE_SWITCH/);
  assert.match(node('status').textContent, /检查当前页面/);
  assert.equal(node('status').getAttribute('aria-live'), 'assertive');
});

test('Popup refresh reads existing runtime without scanning, reinjecting or writing the page', async () => {
  const { api, node, messages } = harness();
  api.setState({ state: 'IDLE', scanCountsFinal: true });
  api.setTab(7);
  await api.refresh();
  assert.equal(node('btn-pause').hidden, false);
  assert.deepEqual(messages.map(message => message.type), ['GET_SYSTEM_SNAPSHOT']);
});
