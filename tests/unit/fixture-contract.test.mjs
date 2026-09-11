import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const testDirectory = dirname(fileURLToPath(import.meta.url));
const fixtureDirectory = resolve(testDirectory, '..', 'fixtures');
const [html, fixtureScript, profileText] = await Promise.all([
  readFile(resolve(fixtureDirectory, 'awards.html'), 'utf8'),
  readFile(resolve(fixtureDirectory, 'awards-fixture.js'), 'utf8'),
  readFile(resolve(fixtureDirectory, 'awards-profile.json'), 'utf8'),
]);

test('奖励页夹具包含目标页面文字、三列表头和受保护操作按钮', () => {
  assert.match(html, /奖励情况（本科期间）/);
  assert.match(fixtureScript, /time:\s*'时间'/);
  assert.match(fixtureScript, /location:\s*'地点'/);
  assert.match(fixtureScript, /content:\s*'内容'/);
  assert.match(html, />下一步</);
  assert.match(html, />正式提交</);
  assert.match(fixtureScript, /textContent = '新增一行'/);
  assert.match(fixtureScript, /textContent = '删除'/);
});

test('奖励页夹具支持所有动态行与防错填场景开关', () => {
  assert.match(fixtureScript, /\['normal', 'missing', 'noop'\]/);
  assert.match(fixtureScript, /\['none', 'full', 'partial', 'duplicate'\]/);
  assert.match(fixtureScript, /params\.get\('order'\)/);
  assert.match(fixtureScript, /params\.get\('delay'\)/);
  assert.match(fixtureScript, /params\.get\('rows'\)/);
  assert.match(html, /other-phone/);
  assert.match(html, /other-reason/);
  assert.doesNotMatch(fixtureScript, /data-fixture-field|dataset\.fixtureField/);
});

test('奖励页夹具记录框架输入事件、敏感按钮和网络尝试', () => {
  for (const eventName of ['focus', 'pointerdown', 'mousedown', 'input', 'change', 'blur']) {
    assert.match(fixtureScript, new RegExp(`['\"]${eventName}['\"]`));
  }
  for (const counter of ['addClicks', 'deleteClicks', 'nextClicks', 'finalSubmitClicks']) {
    assert.match(fixtureScript, new RegExp(counter));
  }
  assert.match(fixtureScript, /attemptedNetworkRequests/);
  assert.match(fixtureScript, /window\.fetch/);
  assert.match(fixtureScript, /navigator\.sendBeacon/);
  assert.match(fixtureScript, /XMLHttpRequest/);
  assert.match(fixtureScript, /WebSocket/);
});

test('夹具 CSP 禁止外连且资源引用全部为本地相对路径', () => {
  assert.match(html, /connect-src 'none'/);
  assert.doesNotMatch(html, /(?:src|href)=["']https?:\/\//i);
  assert.doesNotMatch(fixtureScript, /https?:\/\//i);
});

test('示例奖励 JSON 使用独立 awards 数组且不含明显敏感字段', () => {
  const profile = JSON.parse(profileText);
  assert.equal(profile.profileName, '默认申请资料');
  assert.ok(Array.isArray(profile.awards));
  assert.equal(profile.awards.length, 2);
  assert.deepEqual(
    Object.keys(profile.awards[0]).filter(key => ['time', 'location', 'content'].includes(key)),
    ['time', 'location', 'content'],
  );
  assert.doesNotMatch(profileText, /id_?number|身份证|手机号|address|password|token/i);
  assert.doesNotMatch(`${html}\n${profileText}`, /\b1[3-9]\d{9}\b|\b\d{17}[0-9xX]\b/);
});
