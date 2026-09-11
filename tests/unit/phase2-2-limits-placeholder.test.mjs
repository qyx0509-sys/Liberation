import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Options = require('../../src/mappings/option-aliases.js');
const Verification = require('../../src/core/verification-engine.js');
const ArrayHandler = require('../../src/core/array-handler.js');

function rootWithText(text, attrs = {}) {
  return {
    innerText: text,
    textContent: text,
    getAttribute(name) { return attrs[name] ?? null; },
    querySelectorAll() { return []; },
    ownerDocument: { defaultView: { getComputedStyle() { return { display: 'block', visibility: 'visible', opacity: '1' }; } } },
  };
}

test('Custom Select 常见装饰型占位文本必须视为空值', () => {
  for (const text of ['请选择', '--请选择--', '【请选择】', '请选择...', '  -- 请选择一项 --  ', '未选择']) {
    assert.equal(Options.isPlaceholderOption({ label: text, value: '' }), true, text);
  }
  assert.equal(Options.isPlaceholderOption({ label: '否', value: '0' }), false);
  assert.equal(Options.isPlaceholderOption({ label: '四年制', value: '4' }), false);
});

test('studyDuration 兼容 4 / 4.0 / 四 / 四年制', () => {
  const fieldPath = 'education[].studyDuration';
  for (const actual of ['4', '4.0', '4年', '4.0年', '四', '四年', '四年制', '本科四年制']) {
    assert.equal(
      Verification.semanticOptionEquivalent('4年', actual, { fieldPath }),
      true,
      actual,
    );
  }
});

test('eliteTrainingBase 的 0/1 与 是否 只在该字段上下文中做等价归一', () => {
  const fieldPath = 'education[].eliteTrainingBase';
  assert.equal(Verification.semanticOptionEquivalent('否', '0', { fieldPath }), true);
  assert.equal(Verification.semanticOptionEquivalent('是', '1', { fieldPath }), true);
  assert.equal(Verification.semanticOptionEquivalent('否', '1', { fieldPath }), false);
});

test('通用数组限制解析支持“最多3项 / 至多三条 / 限填5篇”', () => {
  assert.equal(ArrayHandler.detectItemLimit(rootWithText('奖励情况（本科期间具有代表性，最多3项）'), 'awards'), 3);
  assert.equal(ArrayHandler.detectItemLimit(rootWithText('科研经历：至多三条'), 'research'), 3);
  assert.equal(ArrayHandler.detectItemLimit(rootWithText('论文限填5篇'), 'papers'), 5);
  assert.equal(ArrayHandler.detectItemLimit(rootWithText('主要内容最多300字'), 'practice'), null);
});

test('ArrayHandler.prepare 必须按页面声明上限裁剪自动新增数量', async () => {
  const root = rootWithText('奖励情况（本科期间具有代表性，最多3项）');
  const rowContainers = Array.from({ length: 3 }, (_, index) => ({ index }));
  const awardsAdapter = {
    getRows() { return rowContainers.map(container => ({ container })); },
  };
  const items = Array.from({ length: 7 }, (_, index) => ({ name: `A${index}` }));
  const result = await ArrayHandler.prepare(
    { sectionId: 'awards', collection: 'awards', collectionMode: 'repeatable' },
    items,
    root,
    { awardsAdapter },
  );

  assert.equal(result.targetCount, 3);
  assert.equal(result.itemLimit, 3);
  assert.equal(result.limitedCount, 4);
  assert.equal(result.groups.length, 3);
  assert.equal(result.unhandledCount, 4);
  assert.equal(result.clicks, 0);
});
