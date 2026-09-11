import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const directory = dirname(fileURLToPath(import.meta.url));
const fixtureDirectory = resolve(directory, '..', 'fixtures', 'wizard');
const [html, script, css, e2e] = await Promise.all([
  readFile(resolve(fixtureDirectory, 'index.html'), 'utf8'),
  readFile(resolve(fixtureDirectory, 'wizard-fixture.js'), 'utf8'),
  readFile(resolve(fixtureDirectory, 'wizard.css'), 'utf8'),
  readFile(resolve(directory, '..', 'e2e', 'wizard.e2e.mjs'), 'utf8'),
]);

test('多栏目 SPA 夹具包含基本/学习/奖励/科研及安全边界按钮', () => {
  for (const text of ['基本信息', '学习信息', '奖励或处分', '科研成果']) assert.match(html, new RegExp(text));
  for (const id of ['applicant-name', 'applicant-phone', 'applicant-birthday', 'education-school', 'education-major', 'add-award', 'research-file']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  for (const text of ['保存本页', '保存并下一步', '下一步', '正式提交', '删除']) {
    assert.match(`${html}\n${script}`, new RegExp(text));
  }
});

test('多栏目夹具使用严格 CSP、本地相对资源和网络 tripwire', () => {
  assert.match(html, /connect-src 'none'/);
  assert.match(html, /script-src 'self'/);
  assert.match(html, /style-src 'self'/);
  assert.match(html, /form-action 'none'/);
  assert.doesNotMatch(html, /<(?:script|style)\b[^>]*>\s*[^<\s]/i);
  assert.doesNotMatch(html, /(?:src|href)=["']https?:/i);
  for (const api of ['fetch', 'sendBeacon', 'XMLHttpRequest', 'WebSocket', 'EventSource']) assert.match(script, new RegExp(api));
});

test('多栏目 E2E 覆盖导航、七字段、数组不删除、事件、保存、文件授权和悬浮面板', () => {
  for (const marker of [
    'Navigation', 'FieldMatcher', '姓名', '手机号码', '出生日期', '学校名称', '所学专业',
    '获奖名称', '获奖时间', '1→3', '3→1', 'input/select/radio', 'Save', 'File',
    'FORMAT_ERROR', 'SIZE_ERROR', '明确绑定', 'confirmFile', 'FloatingPanel', 'dragPointer',
    'collapse', 'minimize',
  ]) {
    assert.match(e2e, new RegExp(marker), marker);
  }
  assert.match(e2e, /actions\.deleteAward, 0/);
  assert.match(e2e, /actions\.finalSubmit, 0/);
  assert.match(e2e, /externalRequests, \[\]/);
});

test('夹具 CSS 保证隐藏栏目不参与字段扫描，且页面可在窄屏查看', () => {
  assert.match(css, /\[hidden\]\s*\{\s*display:\s*none\s*!important/);
  assert.match(css, /@media\s*\(max-width:\s*760px\)/);
});
