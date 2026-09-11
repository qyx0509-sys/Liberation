import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Events = require('../../src/core/event-dispatcher.js');
const Options = require('../../src/mappings/option-aliases.js');
const Dates = require('../../src/mappings/date-rules.js');
const SemanticVerification = require('../../src/core/semantic-verification.js');
const Verification = require('../../src/core/verification-engine.js');
const Controls = require('../../src/controls/control-adapter-registry.js');

Object.assign(globalThis, {
  JFEventDispatcher: Events,
  JFOptionAliases: Options,
  JFDateRules: Dates,
  JFSemanticVerification: SemanticVerification,
  JFVerificationEngine: Verification,
  JFControlAdapterRegistry: Controls,
});

require('../../src/controls/adapters/native-select-adapter.js');
const FormFiller = require('../../src/core/form-filler.js');

const STATUS_PATH = 'papers[].status';
const AUTHOR_RANK_PATH = 'papers[].authorRank';
const DEBUG_KEYS = Object.freeze([
  'bestOptionLabel',
  'bestScore',
  'canonicalCandidates',
  'expectedCanonical',
  'expectedShape',
  'fieldPath',
  'margin',
  'matchedCanonical',
  'normalizedOptionLabels',
  'optionCount',
  'reasonCode',
  'secondBestScore',
  'threshold',
]);

function option(label, value = label) {
  return { label, text: label, textContent: label, value, disabled: false };
}

function nativeSelectDescriptor(selectedLabel, selectedValue = `opaque-${selectedLabel}`) {
  const selected = {
    ...option(selectedLabel, selectedValue),
    selected: true,
  };
  const element = {
    tagName: 'SELECT',
    value: selected.value,
    options: [selected],
    selectedOptions: [selected],
    disabled: false,
    readOnly: false,
    getAttribute() { return null; },
  };
  return {
    detectorId: 'field_paper_option',
    element,
    elements: [element],
    controlKind: 'native-select',
    baseControlKind: 'native-select',
    type: 'native-select',
    visible: true,
    disabled: false,
    readOnly: false,
  };
}

function assertDebugShape(debug) {
  assert.ok(debug && typeof debug === 'object', 'findBestOption 必须返回 optionMatchingDebug');
  assert.deepEqual(Object.keys(debug).sort(), [...DEBUG_KEYS].sort());
  assert.equal(debug.fieldPath.includes('[0]'), false, 'debug fieldPath 必须规范成 [] canonical path');
  assert.equal(Array.isArray(debug.normalizedOptionLabels), true);
}

test('papers status：内建词表使用 field-aware canonical，且不加入无页面证据的概念词', () => {
  const table = Options.FIELD_OPTION_ALIASES[STATUS_PATH];
  assert.ok(table, '缺少 papers[].status field-aware vocabulary');

  assert.equal(Options.canonicalFieldOption(STATUS_PATH, 'published'), 'published');
  assert.equal(Options.canonicalFieldOption(STATUS_PATH, '已发表'), 'published');
  assert.equal(Options.canonicalFieldOption(STATUS_PATH, 'accepted'), 'accepted');
  assert.equal(Options.canonicalFieldOption(STATUS_PATH, '录用待刊'), 'accepted');
  assert.equal(Options.canonicalFieldOption(STATUS_PATH, '审稿中'), 'underReview');
  assert.equal(Options.canonicalFieldOption(STATUS_PATH, '投稿中'), 'submitted');
  assert.equal(Options.canonicalFieldOption(STATUS_PATH, 'in press'), 'inPress');

  for (const unsupportedPageWord of ['已接收', '待刊', '出版中']) {
    assert.equal(
      Options.canonicalFieldOption(STATUS_PATH, unsupportedPageWord),
      unsupportedPageWord,
      `${unsupportedPageWord} 尚无真实 page option 证据，不得提前收进词表`,
    );
  }
});

test('papers status：published 能可靠选择真实 UI“已发表”', () => {
  const result = Options.findBestOption('published', [
    option('请选择', ''),
    option('已发表', 'PUBLISHED_CODE'),
    option('审稿中', 'UNDER_REVIEW_CODE'),
  ], { fieldPath: STATUS_PATH, minScore: 0.9, ambiguityMargin: 0.06 });

  assert.equal(result.matched, true);
  assert.equal(result.label, '已发表');
  assert.equal(Options.canonicalFieldOption(STATUS_PATH, result.label), 'published');
});

test('papers status：accepted 能可靠选择真实 UI“录用待刊”', () => {
  const result = Options.findBestOption('accepted', [
    option('已发表'),
    option('录用待刊'),
    option('审稿中'),
  ], { fieldPath: STATUS_PATH, minScore: 0.9, ambiguityMargin: 0.06 });

  assert.equal(result.matched, true);
  assert.equal(result.label, '录用待刊');
  assert.equal(Options.canonicalFieldOption(STATUS_PATH, result.label), 'accepted');
});

test('papers status：现有“审稿中/在审/underreview”继续归一为 underReview', () => {
  for (const value of ['审稿中', '在审', 'underreview']) {
    assert.equal(Options.canonicalFieldOption(STATUS_PATH, value), 'underReview');
  }
  const result = Options.findBestOption('underReview', [option('已发表'), option('在审')], {
    fieldPath: STATUS_PATH,
  });
  assert.equal(result.matched, true);
  assert.equal(result.label, '在审');
});

test('papers authorRank：仅数字 1/2 与对应作者位次建立字段局部等价', () => {
  const first = Options.findBestOption(1, [option('第一作者'), option('第二作者')], {
    fieldPath: AUTHOR_RANK_PATH,
  });
  const second = Options.findBestOption('二作', [option('第一作者'), option('第二作者')], {
    fieldPath: AUTHOR_RANK_PATH,
  });

  assert.equal(first.matched, true);
  assert.equal(first.label, '第一作者');
  assert.equal(Options.canonicalFieldOption(AUTHOR_RANK_PATH, '一作'), '1');
  assert.equal(second.matched, true);
  assert.equal(second.label, '第二作者');
  assert.equal(Options.canonicalFieldOption(AUTHOR_RANK_PATH, '二作'), '2');
});

test('papers authorRank：比例 1/4、1/5 绝不能等价于第一作者', () => {
  for (const ratio of ['1/4', '1/5']) {
    assert.equal(Options.canonicalFieldOption(AUTHOR_RANK_PATH, ratio), ratio);
    const result = Options.findBestOption(ratio, [option('第一作者'), option('第二作者')], {
      fieldPath: AUTHOR_RANK_PATH,
      minScore: 0.1,
    });
    assert.equal(result.matched, false, `${ratio} 不得降格成数字作者位次`);
  }
});

test('field-aware vocabulary：未知 expected 不能借 opaque option.value 精确命中已知 label', () => {
  const privateExpectedSentinel = 'PRIVATE_EXPECTED_SENTINEL_RAW_VALUE_8402';
  const result = Options.findBestOption(privateExpectedSentinel, [
    option('已发表', privateExpectedSentinel),
  ], { fieldPath: STATUS_PATH });

  assert.equal(result.matched, false);
  assert.equal(result.optionMatchingDebug.expectedCanonical, '');
  assert.equal(result.optionMatchingDebug.matchedCanonical, '');
  assert.doesNotMatch(JSON.stringify(result.optionMatchingDebug), new RegExp(privateExpectedSentinel));
});

test('field-aware vocabulary：作者比例不能借 opaque option.value 绕过 canonical，readback 也必须失败', () => {
  for (const ratio of ['1/4', '1/5']) {
    const selection = Options.findBestOption(ratio, [option('第一作者', ratio)], {
      fieldPath: AUTHOR_RANK_PATH,
    });
    assert.equal(selection.matched, false, `${ratio} 不得通过 option.value 选择第一作者`);

    const verification = Verification.verify(nativeSelectDescriptor('第一作者', ratio), ratio, {
      fieldPath: AUTHOR_RANK_PATH,
      expectedType: 'choice',
    });
    assert.equal(verification.ok, false, `${ratio} 不得通过原始 select value 验证第一作者`);
  }
});

test('unknown status：继续 fail closed，debug 不得回显未知 expected 或 option value', () => {
  const privateExpectedSentinel = 'PRIVATE_EXPECTED_SENTINEL_9831';
  const privateOptionValueSentinel = 'PRIVATE_OPTION_VALUE_SENTINEL_7214';
  const result = Options.findBestOption(privateExpectedSentinel, [
    option('已发表', privateOptionValueSentinel),
    option('审稿中', 'opaque-review-code'),
  ], { fieldPath: STATUS_PATH });

  assert.equal(result.matched, false);
  assert.equal(result.ambiguous, false);
  assertDebugShape(result.optionMatchingDebug);
  assert.equal(result.optionMatchingDebug.reasonCode, 'NO_CANONICAL_ALIAS');
  assert.equal(result.optionMatchingDebug.expectedCanonical, '');
  assert.equal(result.optionMatchingDebug.matchedCanonical, '');
  const serialized = JSON.stringify(result.optionMatchingDebug);
  assert.doesNotMatch(serialized, new RegExp(privateExpectedSentinel));
  assert.doesNotMatch(serialized, new RegExp(privateOptionValueSentinel));
});

test('ambiguous status：同 canonical 的两个页面 option 必须 NEEDS_CONFIRMATION 语义', () => {
  const result = Options.findBestOption('published', [
    option('已发表', 'published-a'),
    option('正式发表', 'published-b'),
  ], { fieldPath: STATUS_PATH, ambiguityMargin: 0.06 });

  assert.equal(result.matched, false);
  assert.equal(result.ambiguous, true);
  assertDebugShape(result.optionMatchingDebug);
  assert.equal(result.optionMatchingDebug.reasonCode, 'AMBIGUOUS_OPTIONS');
  assert.equal(result.optionMatchingDebug.expectedCanonical, 'published');
  assert.equal(result.optionMatchingDebug.matchedCanonical, '');
});

test('optionMatchingDebug：已匹配时只输出受限 UI metadata 与 canonical，不输出 option value', () => {
  const privateValueSentinel = 'PRIVATE_OPTION_VALUE_SENTINEL_4492';
  const result = Options.findBestOption('published', [
    option(' 已发表 ', privateValueSentinel),
    option('审稿中', 'opaque-review-code'),
  ], { fieldPath: 'papers[4].status' });

  assert.equal(result.matched, true);
  assertDebugShape(result.optionMatchingDebug);
  assert.equal(result.optionMatchingDebug.fieldPath, STATUS_PATH);
  assert.equal(result.optionMatchingDebug.optionCount, 2);
  assert.deepEqual(result.optionMatchingDebug.normalizedOptionLabels, ['已发表', '审稿中']);
  assert.equal(result.optionMatchingDebug.expectedCanonical, 'published');
  assert.equal(result.optionMatchingDebug.matchedCanonical, 'published');
  assert.equal(result.optionMatchingDebug.reasonCode, 'OPTION_MATCHED');
  assert.doesNotMatch(JSON.stringify(result.optionMatchingDebug), new RegExp(privateValueSentinel));
});

test('同一 authorRank vocabulary 同时用于 option match 与 Verification readback', () => {
  const selection = Options.findBestOption(1, [option('第一作者'), option('第二作者')], {
    fieldPath: AUTHOR_RANK_PATH,
  });
  assert.equal(selection.matched, true);

  const verification = Verification.verify(nativeSelectDescriptor('第一作者'), 1, {
    fieldPath: AUTHOR_RANK_PATH,
    expectedType: 'choice',
  });
  assert.equal(verification.ok, true, verification.reason);
  assert.equal(verification.status, Verification.VERIFICATION_STATUS.SUCCESS);
});

test('已有 authorRank 语义等价值必须 SKIPPED_EXISTING，不得报 CONFLICT 或重复写入', async () => {
  const descriptor = nativeSelectDescriptor('第一作者');
  const result = await FormFiller.fill(descriptor, 1, {
    fieldPath: AUTHOR_RANK_PATH,
    expectedType: 'choice',
    allowOverwrite: false,
    skipEmpty: true,
  });

  assert.equal(result.status, FormFiller.FILL_STATUS.SKIPPED_EXISTING, result.reason);
  assert.equal(descriptor.element.value, 'opaque-第一作者');
});

test('Profile option overlay 与内建 papers vocabulary 合并且调用后不污染全局表', () => {
  const before = JSON.stringify(Options.FIELD_OPTION_ALIASES);
  const optionAliases = {
    [STATUS_PATH]: {
      published: ['站点公开态'],
    },
  };

  const local = Options.findBestOption('published', [option('站点公开态')], {
    fieldPath: STATUS_PATH,
    optionAliases,
  });
  const generic = Options.findBestOption('published', [option('站点公开态')], {
    fieldPath: STATUS_PATH,
  });

  assert.equal(local.matched, true);
  assert.equal(generic.matched, false);
  assert.equal(JSON.stringify(Options.FIELD_OPTION_ALIASES), before);
});

test('optionMatchingDebug：producer → Registry → FormFiller 保持同一 metadata-only 稳定结构', async () => {
  const privateSentinel = 'PRIVATE_OPTION_DEBUG_SENTINEL_6197';
  const produced = Options.findBestOption('published', [option('已发表', privateSentinel)], {
    fieldPath: STATUS_PATH,
  }).optionMatchingDebug;
  assertDebugShape(produced);

  Controls.register({
    id: 'field-aware-option-debug-probe',
    priority: 9999,
    capabilities: ['verify'],
    supports(context) {
      return context.descriptor?.controlKind === 'field-aware-option-debug-probe';
    },
    read() { return ''; },
    write() {
      return {
        handled: true,
        ok: true,
        status: 'SUCCESS',
        optionMatchingDebug: {
          ...produced,
          rawExpected: privateSentinel,
          rawValue: privateSentinel,
        },
      };
    },
    verify() { return { ok: true, status: 'SUCCESS', actualValue: '' }; },
  });
  const element = {
    tagName: 'DIV', value: '', disabled: false, readOnly: false,
    getAttribute() { return null; },
  };
  const descriptor = {
    detectorId: 'option-debug-probe', element, elements: [element],
    controlKind: 'field-aware-option-debug-probe', type: 'field-aware-option-debug-probe',
    visible: true, disabled: false, readOnly: false,
  };

  const execution = await Controls.execute(descriptor, 'published', { fieldPath: STATUS_PATH });
  assertDebugShape(execution.optionMatchingDebug);
  assert.deepEqual(execution.optionMatchingDebug, produced);

  const filled = await FormFiller.fill(descriptor, 'published', {
    fieldPath: STATUS_PATH,
    expectedType: 'choice',
    allowOverwrite: true,
  });
  assertDebugShape(filled.optionMatchingDebug);
  assert.deepEqual(filled.optionMatchingDebug, produced);
  assert.doesNotMatch(JSON.stringify(filled.optionMatchingDebug), new RegExp(privateSentinel));
});
