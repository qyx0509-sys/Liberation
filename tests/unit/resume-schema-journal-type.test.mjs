import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const Fields = require('../../src/mappings/field-aliases.js');
const Matcher = require('../../src/core/field-matcher.js');

const testDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(testDirectory, '..', '..');
const optionsSource = await readFile(resolve(projectRoot, 'options.js'), 'utf8');
const cutoff = optionsSource.indexOf('// 导入统一入口');
assert.ok(cutoff > 0, '无法定位 options.js 的纯函数测试边界');

const optionsContext = vm.createContext({});
vm.runInContext(`${optionsSource.slice(0, cutoff)}
globalThis.__journalType = {
  validateImportPayload,
  normalizePaperItem,
  normalizeResumeData,
  paperTemplate,
  collectItem,
};`, optionsContext, { filename: 'options-journal-type-functions.js' });
const OptionsPage = optionsContext.__journalType;

function inOptionsContext(value) {
  optionsContext.__jsonInput = JSON.stringify(value);
  return vm.runInContext('JSON.parse(__jsonInput)', optionsContext);
}

function descriptor(labelText, controlKind = 'text') {
  return {
    detectorId: `papers-${labelText}`,
    element: null,
    section: 'papers',
    context: {
      sectionId: 'papers',
      section: 'papers',
      collection: 'papers',
      collectionMode: 'repeatable',
      confidence: 0.98,
      indexContext: { section: 'papers', collection: 'papers', index: 0, papers: 0 },
    },
    controlKind,
    type: controlKind,
    labelText,
    tableHeader: labelText,
    placeholder: '',
    ariaLabel: '',
    name: '',
    id: '',
    title: '',
    groupText: '',
    nearbyText: '',
    parentText: '',
    visible: true,
    hidden: false,
    disabled: false,
    readOnly: false,
    options: [],
  };
}

test('papers[].journalType 注册为 choice，且不改变 papers[].journal 文本字段', () => {
  assert.equal(Fields.FIELD_TYPES['papers[].journalType'], 'choice');
  assert.equal(Fields.FIELD_TYPES['papers[].journal'], 'text');
  for (const alias of ['期刊类型', '刊物类型', '发表类型', '收录类型']) {
    assert.ok(Fields.FIELD_ALIASES['papers[].journalType'].includes(alias), alias);
  }
  assert.equal(Fields.FIELD_ALIASES['papers[].journalType'].includes('期刊名称'), false);
  assert.equal(Fields.FIELD_ALIASES['papers[].journal'].includes('期刊名称'), true);
});

test('FieldAliases 与 options normalizer 同步兼容 journalType 的 canonical 和 snake_case', () => {
  for (const [key, expected] of [
    ['journalType', 'journal'],
    ['journal_type', 'conference'],
  ]) {
    const source = { [key]: expected };
    assert.equal(Fields.buildResumeView({ papers: [source] }).papers[0].journalType, expected, key);
    assert.equal(OptionsPage.normalizePaperItem(inOptionsContext(source)).journalType, expected, key);
  }
});

test('FieldAliases 与 options normalizer 同步兼容 journalCategory/publicationType 及 snake_case', () => {
  for (const [key, expected] of [
    ['journalCategory', 'SCI'],
    ['journal_category', 'SSCI'],
    ['publicationType', 'conference'],
    ['publication_type', 'bookChapter'],
  ]) {
    const source = { [key]: expected };
    assert.equal(Fields.buildResumeView({ papers: [source] }).papers[0].journalType, expected, key);
    assert.equal(OptionsPage.normalizePaperItem(inOptionsContext(source)).journalType, expected, key);
  }
});

test('journalType canonical 空字符串时，两条 normalizer 都回退到非空 legacy alias', () => {
  const source = { journalType: '', publication_type: 'conference' };
  assert.equal(Fields.buildResumeView({ papers: [source] }).papers[0].journalType, 'conference');
  assert.equal(OptionsPage.normalizePaperItem(inOptionsContext(source)).journalType, 'conference');
});

test('journal 与 journalLevel 绝不能被推导为 journalType', () => {
  const source = { journal: '示例期刊', journalLevel: 'SCI 一区' };
  const runtime = Fields.buildResumeView({ papers: [source] }).papers[0];
  const editor = OptionsPage.normalizePaperItem(inOptionsContext(source));
  assert.equal(runtime.journal, '示例期刊');
  assert.equal(editor.journal, '示例期刊');
  assert.equal(runtime.journalType ?? '', '');
  assert.equal(editor.journalType ?? '', '');
});

test('options 导入接受 journalType 兼容键，并对其执行字符串类型验证', () => {
  for (const key of [
    'journalType', 'journal_type', 'journalCategory', 'journal_category',
    'publicationType', 'publication_type',
  ]) {
    const valid = inOptionsContext({ papers: [{ [key]: 'journal' }] });
    assert.equal(OptionsPage.validateImportPayload(valid), valid, key);

    const invalid = inOptionsContext({ papers: [{ [key]: { private: 'not-a-string' } }] });
    assert.throws(
      () => OptionsPage.validateImportPayload(invalid),
      new RegExp(`papers\\[0\\]\\.${key} 必须是字符串`),
      key,
    );
  }
});

test('paperTemplate 暴露 canonical journalType 控件，并在编辑收集后完整 round-trip', () => {
  const normalized = OptionsPage.normalizePaperItem(inOptionsContext({
    date: '2026-01', journal: '示例期刊', title: '示例成果', publication_type: 'conference',
  }));
  const html = OptionsPage.paperTemplate(normalized);
  assert.match(html, /data-key="journalType"/);
  assert.match(html, /value="conference"/);

  const controls = [
    ['date', '2026-01'],
    ['journal', '示例期刊'],
    ['journalType', 'conference'],
    ['title', '示例成果'],
    ['authorRank', '1'],
    ['status', '已发表'],
    ['url', ''],
  ].map(([key, value]) => ({ dataset: { key }, value }));
  const collected = OptionsPage.collectItem({ querySelectorAll: () => controls });
  const roundTripped = OptionsPage.normalizePaperItem(collected);
  assert.equal(roundTripped.journal, '示例期刊');
  assert.equal(roundTripped.journalType, 'conference');
});

test('同一 papers row 的期刊类型与期刊名称诊断为不同 canonical path，且不重复占用', () => {
  const resume = { papers: [{ journalType: 'journal', journal: '示例期刊' }] };
  const options = {
    section: 'papers',
    sectionContext: descriptor('').context,
    arrayContext: { section: 'papers', collection: 'papers', index: 0, papers: 0 },
  };
  const typeMatch = Matcher.matchField(descriptor('期刊类型', 'native-select'), resume, options);
  const journalMatch = Matcher.matchField(descriptor('期刊名称'), resume, options);

  assert.equal(typeMatch.status, 'MATCHED', typeMatch.reason);
  assert.equal(typeMatch.matchedPath, 'papers[].journalType');
  assert.equal(journalMatch.status, 'MATCHED', journalMatch.reason);
  assert.equal(journalMatch.matchedPath, 'papers[].journal');
  assert.deepEqual(new Set([typeMatch.matchedPath, journalMatch.matchedPath]).size, 2);
});
