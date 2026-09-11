import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const UI = require('../../src/ui/design-system.js');
const PanelState = require('../../src/floating-ui/panel-state.js');
const source = await readFile(new URL('../../src/floating-ui/floating-panel.js', import.meta.url), 'utf8');
const markup = source.slice(source.indexOf('  function markup()'), source.indexOf('  async function create'));
const allIds = [...source.matchAll(/id="([^"]+)"/g)].map(match => match[1]);
const baseIds = [...markup.matchAll(/id="([^"]+)"/g)].map(match => match[1]);
const actionIds = ['run-all', 'pause', 'resume', 'review-action', 'view-results', 'stop', 'skip', 'rescan'];
const actionBlock = source.slice(source.indexOf('    function updateActions()'), source.indexOf('    function renderFields'));
const fieldsBlock = source.slice(source.indexOf('    function renderFields'), source.indexOf('    function update(snapshot'));
const updateBlock = source.slice(source.indexOf('    function update(snapshot'), source.indexOf('    function show()'));

function element(id) {
  return {
    id, hidden: false, disabled: false, textContent: '', innerHTML: '', className: '', dataset: {},
    style: { setProperty(name, value) { this[name] = value; } },
    attributes: {}, setAttribute(name, value) { this.attributes[name] = value; },
  };
}
function contextFor(snapshot = {}, activeTab = 'task') {
  const nodes = Object.fromEntries(baseIds.map(id => [id, element(id)]));
  nodes['dynamic-actions'].querySelectorAll = () => actionIds.map(id => nodes[id]);
  return {
    root: { JFUI: UI },
    byId: id => { assert.ok(nodes[id], '不存在的 DOM ID: ' + id); return nodes[id]; },
    launcher: nodes.launcher, nodes, snapshot, currentSnapshot: snapshot, activeTab, currentScanId: '',
    icon: () => '<svg aria-hidden="true"></svg>',
    escapeHtml: value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;'),
  };
}

test('Floating UI contract: three semantic tabs, consistent IDs, and every queried/bound target exists', () => {
  assert.equal(new Set(baseIds).size, baseIds.length, '不能重复 DOM ID');
  assert.equal((markup.match(/role="tab"/g) || []).length, 3);
  assert.equal((markup.match(/role="tabpanel"/g) || []).length, 3);
  for (const id of ['task-panel', 'review-panel', 'log-panel', 'dynamic-actions', 'launcher-badge', 'launcher-state', 'settings']) assert.ok(baseIds.includes(id));
  for (const [, id] of source.matchAll(/(?:byId|shadow\.getElementById)\('([^']+)'\)/g)) assert.ok(allIds.includes(id), '缺失 listener/query target: ' + id);
  for (const [, id] of source.matchAll(/bind\('([^']+)'/g)) assert.ok(baseIds.includes(id), '缺失 callback target: ' + id);
  assert.match(markup, /aria-controls="review-panel"/);
  assert.match(source, /ArrowLeft.*ArrowRight.*Home.*End/);
  assert.match(source, /selectTab, shadow, show/);
});

test('Floating UI actions follow six states, with one primary and at most two visible controls', () => {
  const expected = {
    IDLE: ['run-all'], RUNNING: ['pause', 'stop'], PAUSED: ['resume', 'stop'],
    WAITING_USER: ['review-action', 'skip'], FINISHED: ['view-results', 'rescan'], ERROR: ['review-action', 'rescan'],
  };
  const primary = new Set(['run-all', 'pause', 'resume', 'review-action', 'view-results']);
  for (const [state, ids] of Object.entries(expected)) {
    const context = contextFor({ state });
    vm.runInNewContext(actionBlock + '\nupdateActions();', context);
    const visible = actionIds.filter(id => !context.nodes[id].hidden);
    assert.deepEqual(visible, ids, state);
    assert.equal(visible.filter(id => primary.has(id)).length, 1, state);
    assert.ok(visible.length <= 2, state);
  }
});

test('Floating UI pending preview does not turn into resume or skip authorization', () => {
  const context = contextFor({ state: 'IDLE', awaitingPreview: true }, 'review');
  vm.runInNewContext(actionBlock + '\nupdateActions();', context);
  assert.equal(context.nodes.skip.disabled, true);
  assert.equal(context.nodes['review-action'].textContent, '处理待确认');
  assert.match(source, /taskState\(currentSnapshot\) === 'WAITING_USER' && !currentSnapshot\.awaitingPreview/);
  const confirmed = contextFor({ state: 'WAITING_USER' }, 'review');
  vm.runInNewContext(actionBlock + '\nupdateActions();', confirmed);
  assert.equal(confirmed.nodes['review-action'].textContent, '已核对，继续');
});

test('Floating UI review is grouped, escaped, and does not render values or technical currentAction', () => {
  const context = contextFor({
    state: 'WAITING_USER', scanId: 'scan:ui-review', scanCountsFinal: true, reviewCount: 102,
    currentAction: 'PRIVATE-ID-VALUE / PANEL_REBIND_FAILED_LEVEL_0',
    reviewItems: [
      { fieldLabel: '姓名<script>', section: '基本信息', status: 'MISSING_JSON', reason: '请补充资料', plannedValue: 'PRIVATE-PHONE' },
      { fieldLabel: '出生日期', section: '基本信息', status: 'NEEDS_CONFIRMATION', reason: '日期控件需要你确认', afterValue: 'PRIVATE-DATE' },
      { fieldLabel: '材料', section: '个人材料', status: 'FAILED', reason: '请重新检查材料', beforeValue: 'PRIVATE-FILE' },
    ],
    recentFields: Array.from({ length: 8 }, (_, i) => ({ fieldLabel: '字段' + i, status: 'SUCCESS', value: 'PRIVATE-RECENT' })),
    progress: { completed: 14, total: 26, percent: 54 },
  });
  vm.runInNewContext(actionBlock + fieldsBlock + updateBlock + '\nupdate(snapshot);', context);
  const review = context.nodes['review-items'].innerHTML;
  assert.ok(review.indexOf('处理失败') < review.indexOf('待确认'));
  assert.ok(review.indexOf('待确认') < review.indexOf('资料缺失'));
  assert.match(review, /姓名&lt;script&gt;/);
  assert.doesNotMatch(review, /PRIVATE-|<script>/);
  assert.doesNotMatch(context.nodes.activity.textContent, /PRIVATE-|PANEL_REBIND/);
  assert.equal(context.nodes['launcher-badge'].textContent, '99+');
  assert.match(context.nodes.launcher.attributes['aria-label'], /102 个项目待确认/);
  assert.equal((context.nodes['recent-fields'].innerHTML.match(/class="field-row"/g) || []).length, 6);
  assert.equal(context.nodes['progress-bar'].style.width, '54%');
});

test('Floating UI scan counts remain provisional and launcher reflects completion/error without animation', () => {
  const context = contextFor({ state: 'IDLE', scanCountsFinal: false, reliableFieldCount: 0 });
  vm.runInNewContext(actionBlock + fieldsBlock + updateBlock + '\nupdate(snapshot);', context);
  assert.equal(context.nodes['page-context'].textContent, '正在检查当前页面…');
  assert.doesNotMatch(context.nodes['page-context'].textContent, /0 项/);
  context.snapshot = { state: 'FINISHED', scanCountsFinal: true, reviewItems: [] };
  vm.runInNewContext('update(snapshot);', context);
  assert.equal(context.nodes['launcher-state'].hidden, false);
  assert.equal(context.nodes['launcher-state'].textContent, '✓');
  context.snapshot = { state: 'ERROR' };
  vm.runInNewContext('update(snapshot);', context);
  assert.equal(context.nodes['launcher-state'].textContent, '!');
  assert.match(source, /conic-gradient/);
  assert.doesNotMatch(source, /setInterval|requestAnimationFrame|new MutationObserver/);
});

test('Floating UI uses shared dark tokens, named controls, accessible dialogs, and display-only log clearing', () => {
  assert.match(source, /root\.JFUI\.tokensCSS/);
  assert.match(source, /aria-live="polite"/);
  assert.match(source, /aria-modal="true"/);
  assert.match(source, /event\.key === 'Escape'/);
  assert.match(source, /modalPreviousFocus\?\.focus/);
  assert.match(source, /event\.shiftKey/);
  for (const [, attributes] of markup.matchAll(/<button([^>]*class="(?:icon|resize|launcher)"[^>]*)>/g)) assert.match(attributes, /aria-label=/);
  assert.match(source, /logs = \[\];.*已清空当前显示；任务报告保留/);
  assert.doesNotMatch(source, /reportManager\.(?:clear|dispose)|fetch\(|https?:\/\/|font-size:9px/);
});

test('Floating panel persisted state preserves unknown properties and fits desktop/narrow viewports', () => {
  assert.equal(PanelState.DEFAULTS.width, 380);
  assert.equal(PanelState.DEFAULTS.height, 544);
  assert.equal(PanelState.LIMITS.minWidth, 320);
  assert.equal(PanelState.LIMITS.minHeight, 360);
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 700 }, { width: 280, height: 280 }]) {
    const result = PanelState.clamp({ x: 9999, y: 9999, width: 700, height: 900, futureSetting: 'kept', minimized: true }, viewport);
    assert.ok(result.x + result.width <= viewport.width, JSON.stringify(result));
    assert.ok(result.y + result.height <= viewport.height, JSON.stringify(result));
    assert.equal(result.futureSetting, 'kept');
    assert.equal(result.minimized, true);
  }
});

