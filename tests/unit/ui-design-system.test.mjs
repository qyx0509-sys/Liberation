import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const UI = require('../../src/ui/design-system.js');
require('../../src/mappings/field-aliases.js');
const Review = require('../../src/ui/review-presenter.js');

test('UI field statuses preserve distinct semantics and never expose raw codes as copy', () => {
  const expected = { SUCCESS: '已填写', SKIPPED_EXISTING: '已存在', MISSING_JSON: '资料缺失', NEEDS_CONFIRMATION: '待确认', CONFLICT: '内容冲突', UNMATCHED: '暂未适配', ERROR: '处理失败', FAILED: '处理失败' };
  for (const [code, label] of Object.entries(expected)) assert.equal(UI.status(code).label, label);
  assert.equal(UI.status('MISSING_JSON').tone, 'neutral');
  assert.equal(UI.status('FAILED').tone, 'danger');
  assert.equal(UI.status('MATCHED').key, 'PLANNED', 'a scan match is not a successful fill');
  assert.doesNotMatch(UI.reasonText('NEEDS_CONFIRMATION', 'PANEL_REBIND_FAILED_LEVEL_0'), /PANEL|LEVEL/);
});

test('Task presenter covers engine and persisted states without changing task objects', () => {
  for (const [state, expected] of Object.entries({ idle: 'IDLE', RUNNING: 'RUNNING', paused: 'PAUSED', needs_user_review: 'WAITING_USER', WAITING_FILE_CONFIRMATION: 'WAITING_USER', completed: 'FINISHED', failed: 'ERROR', STOPPED: 'IDLE' })) {
    const snapshot = Object.freeze({ state });
    assert.equal(UI.taskState(snapshot), expected);
    assert.doesNotMatch(UI.actionText(snapshot), /TaskState|Resume JSON|reasonCode/);
  }
  assert.equal(UI.taskState({ state: 'FINISHED', progressionBlocked: true }), 'WAITING_USER');
});

test('Review projection strips values, debug traces and untrusted DOM labels/reasons', () => {
  const scanId = 'scan:ui-test';
  const result = Review.project({ scanId, report: { scanId, sections: [{ scanId, sectionId: 'basic', items: [
    { field: 'basic.idNumber', fieldName: 'PRIVATE-LABEL', status: 'conflict', beforeValue: 'PRIVATE-ID', reason: 'PRIVATE-ADDRESS', optionMatchingDebug: { expectedCanonical: 'PRIVATE-PHONE' } },
    { field: 'unknown', fieldName: 'SECRET-CONTACT', status: 'needs_confirmation', reason: 'PRIVATE-EMAIL' },
    { field: 'basic.name', status: 'success', afterValue: 'PRIVATE-NAME' },
  ] }] } });
  assert.equal(result.reviewItems.length, 2);
  assert.equal(result.reviewItems[0].fieldLabel, '证件号码');
  assert.equal(result.reviewItems[1].fieldLabel, '待检查字段');
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|SECRET/);
  for (const item of result.reviewItems) assert.deepEqual(Object.keys(item), ['fieldLabel', 'section', 'status', 'reason']);
});

test('Review rejects stale reports and avoids unresolved scan entries after success', () => {
  const inspection = { scanId: 'scan:new', current: { section: 'basic' }, matches: [{ matchedPath: 'basic.name', status: 'MISSING_JSON' }], fields: [{}] };
  const stale = { scanId: 'scan:old', sections: [{ sectionId: 'basic', items: [{ field: 'basic.idNumber', status: 'FAILED' }] }] };
  assert.equal(Review.project({ scanId: 'scan:new', report: stale, inspection }).reviewItems[0].status, 'MISSING_JSON');
  const report = { scanId: 'scan:new', sections: [{ sectionId: 'basic', items: [{ field: 'basic.name', status: 'SUCCESS' }] }] };
  assert.equal(Review.project({ scanId: 'scan:new', report, inspection }).reviewItems.length, 0);
  assert.equal(Review.project({ scanId: 'scan:new', report }).recentFields.length, 1);
});

test('Tokens are shared by document and Shadow DOM and offer reduced motion and focus', () => {
  const css = readFileSync(new URL('../../src/ui/design-tokens.css', import.meta.url), 'utf8');
  assert.ok(css.includes(UI.tokensCSS));
  assert.match(UI.tokensCSS, /:root,:host/);
  assert.match(UI.tokensCSS, /prefers-color-scheme:dark/);
  assert.match(UI.tokensCSS, /prefers-reduced-motion:reduce/);
  assert.match(UI.tokensCSS, /focus-visible/);
  assert.doesNotMatch(UI.tokensCSS, /https?:|@import|url\(/i);
  assert.match(UI.icon('settings'), /aria-hidden="true"/);
});

function luminance(color) {
  const channels = color.match(/[a-f0-9]{2}/gi).map(value => parseInt(value, 16) / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
}
function contrast(a, b) { const values = [luminance(a), luminance(b)].sort((x, y) => y - x); return (values[0] + .05) / (values[1] + .05); }
test('Light and dark text/status colors satisfy basic AA text contrast', () => {
  for (const palette of [UI.light, UI.dark]) {
    for (const foreground of ['text-primary', 'text-secondary', 'text-muted']) {
      assert.ok(contrast(palette[foreground], palette.surface) >= 4.5, foreground);
    }
    for (const tone of ['brand', 'success', 'warning', 'danger', 'info']) assert.ok(contrast(palette[tone], palette[`${tone}-soft`]) >= 4.5, tone);
    assert.ok(contrast(palette.brand, palette['on-brand']) >= 4.5);
    assert.ok(contrast(palette['border-strong'], palette.surface) >= 3, 'control boundary');
  }
});
