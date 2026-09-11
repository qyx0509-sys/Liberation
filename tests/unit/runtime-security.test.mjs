import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const testDirectory = dirname(fileURLToPath(import.meta.url));
const root = resolve(testDirectory, '..', '..');
const [manifestText, backgroundSource, popupSource, contentSource, localAppSource, awardsAdapterSource, arrayHandlerSource] = await Promise.all([
  readFile(resolve(root, 'manifest.json'), 'utf8'),
  readFile(resolve(root, 'background.js'), 'utf8'),
  readFile(resolve(root, 'popup.js'), 'utf8'),
  readFile(resolve(root, 'content.js'), 'utf8'),
  readFile(resolve(root, 'src', 'content-app.js'), 'utf8'),
  readFile(resolve(root, 'src', 'adapters', 'undergraduate-awards.js'), 'utf8'),
  readFile(resolve(root, 'src', 'core', 'array-handler.js'), 'utf8'),
]);
const manifest = JSON.parse(manifestText);

test('Manifest 仅保留用户触发注入所需的最小权限', () => {
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual([...manifest.permissions].sort(), ['activeTab', 'scripting', 'storage'].sort());
  assert.equal(manifest.host_permissions, undefined);
  assert.equal(manifest.content_scripts, undefined);
  assert.equal(manifest.web_accessible_resources, undefined);
  assert.equal(manifest.permissions.includes('tabs'), false);
  assert.match(manifest.content_security_policy.extension_pages, /connect-src 'self'/);
});

test('popup 只在用户点击后按固定本地清单注入当前活动标签页', () => {
  assert.match(popupSource, /addEventListener\('click'/);
  for (const localFile of [
    'src/adapters/generic.js',
    'src/adapters/undergraduate-awards.js',
    'src/content-app.js',
    'content.js',
  ]) {
    assert.match(popupSource, new RegExp(localFile.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.doesNotMatch(popupSource, /https?:\/\//i);
  assert.doesNotMatch(popupSource, /all_urls|<all_urls>/i);
});

test('本地模式后台拒绝所有 AI 消息且不会触发 fetch', () => {
  let listener;
  let fetchCalls = 0;
  const context = {
    AbortController,
    URL,
    clearTimeout,
    console: { log() {}, warn() {}, error() {} },
    fetch: async () => {
      fetchCalls += 1;
      throw new Error('本地模式不应调用 fetch');
    },
    setTimeout,
    chrome: {
      runtime: {
        getURL: path => `chrome-extension://test/${path}`,
        onMessage: { addListener(callback) { listener = callback; } },
      },
      tabs: { create() {} },
    },
  };
  vm.runInNewContext(backgroundSource, context, { filename: 'background.js' });
  assert.equal(typeof listener, 'function');

  for (const type of ['AI_FILL', 'AI_PARSE_RESUME', 'AI_OPTIMIZE', 'JD_MOCK_INTERVIEW']) {
    let response;
    const returned = listener({ type }, {}, value => { response = value; });
    assert.equal(returned, false);
    assert.equal(response?.localMode, true);
    assert.match(response?.error || '', /本地模式|AI.*禁用/);
  }
  assert.equal(fetchCalls, 0);
});

test('本地页面入口优先挂载 JFLocalApp，旧 JobFill 路径不会正常执行', () => {
  const guardIndex = contentSource.indexOf('globalThis.JFLocalApp?.mount');
  const legacyPanelIndex = contentSource.indexOf("panel.id = '__rf_panel__'");
  assert.ok(guardIndex >= 0 && legacyPanelIndex > guardIndex);
  const guardBlock = contentSource.slice(guardIndex, legacyPanelIndex);
  assert.match(guardBlock, /return;/);
  assert.doesNotMatch(localAppSource, /\bfetch\s*\(|XMLHttpRequest|new\s+WebSocket|sendBeacon/i);
  assert.doesNotMatch(localAppSource, /requestSubmit\s*\(|\.submit\s*\(/i);
  assert.match(localAppSource, /不会点击“下一步”或任何提交按钮/);
  const appClickSites = [...localAppSource.matchAll(/\b([A-Za-z_$][\w$]*)\.click\s*\(/g)].map(match => match[1]);
  assert.deepEqual(appClickSites, ['anchor'], '本地面板只允许点击诊断 JSON 的临时下载链接');
  const adapterClickSites = [...awardsAdapterSource.matchAll(/\b([A-Za-z_$][\w$]*)\.click\s*\(/g)].map(match => match[1]);
  assert.deepEqual(adapterClickSites, [], '奖励适配器只能委托共享 Action Ownership Runtime，不能自行点击');
  const arrayClickSites = [...arrayHandlerSource.matchAll(/\b([A-Za-z_$][\w$]*)\.click\s*\(/g)].map(match => match[1]);
  assert.deepEqual(arrayClickSites, ['button'], '所有重复栏目只允许共享 ArrayHandler 点击唯一已验证 Add');
  assert.doesNotMatch(awardsAdapterSource, /requestSubmit\s*\(|\.submit\s*\(/i);
});
