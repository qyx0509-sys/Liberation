import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const SemanticVerification = require('../../src/core/semantic-verification.js');
const VerificationEngine = require('../../src/core/verification-engine.js');

function compare(fieldPath, expected, actual, settings = {}) {
  return SemanticVerification.compare({
    fieldPath,
    expected,
    actual,
    ...settings,
  });
}

function textDescriptor(actualValue, controlKind = 'text') {
  return {
    controlKind,
    type: controlKind,
    element: {
      tagName: 'INPUT',
      type: controlKind,
      value: actualValue,
    },
  };
}

test('studyDuration: 数字 4 与“四年制”语义相同', () => {
  const result = compare('education[].studyDuration', 4, '四年制');

  assert.equal(result.equivalent, true);
  assert.equal(result.strategy, 'enum');
  assert.equal(result.expectedCanonical, '4');
  assert.equal(result.actualCanonical, '4');
});

test('studyDuration: “4年”与“本科四年制”语义相同', () => {
  const result = compare('education[].studyDuration', '4年', '本科四年制');

  assert.equal(result.equivalent, true);
  assert.equal(result.strategy, 'enum');
  assert.equal(result.expectedCanonical, '4');
  assert.equal(result.actualCanonical, '4');
});

test('studyDuration: 4 与“五年制”必须判定为不相同', () => {
  const result = compare('education[].studyDuration', 4, '五年制');

  assert.equal(result.equivalent, false);
  assert.equal(result.strategy, 'enum');
  assert.equal(result.expectedCanonical, '4');
  assert.equal(result.actualCanonical, '5');
});

test('studyDuration: 2–8 年制常见写法使用同一字段级 canonical value', () => {
  const cases = [
    [2, '两年制', '2'],
    ['3.0年', '三年制', '3'],
    ['5年', '本科五年制', '5'],
    [6, '六年', '6'],
    ['7.0', '七年制', '7'],
    [8, '八年制', '8'],
  ];

  for (const [expected, actual, canonical] of cases) {
    const result = compare('education[0].studyDuration', expected, actual);
    assert.equal(result.equivalent, true, `${expected} / ${actual}`);
    assert.equal(result.expectedCanonical, canonical);
    assert.equal(result.actualCanonical, canonical);
  }
});

test('数字/中文数字转换只能用于 studyDuration，不能污染普通字段', () => {
  const result = compare('awards[].rank', 4, '四');

  assert.equal(result.equivalent, null);
  assert.equal(result.strategy, 'unknown');
});

test('Boolean: false 与“否”语义相同', () => {
  const result = compare('education[].eliteTrainingBase', false, '否');

  assert.equal(result.equivalent, true);
  assert.equal(result.strategy, 'boolean');
  assert.equal(result.expectedCanonical, false);
  assert.equal(result.actualCanonical, false);
});

test('Boolean: false 与“无”语义相同', () => {
  const result = compare('education[].eliteTrainingBase', false, '无');

  assert.equal(result.equivalent, true);
  assert.equal(result.strategy, 'boolean');
});

test('Boolean: true 与“是”语义相同', () => {
  const result = compare('education[].eliteTrainingBase', true, '是');

  assert.equal(result.equivalent, true);
  assert.equal(result.strategy, 'boolean');
  assert.equal(result.expectedCanonical, true);
  assert.equal(result.actualCanonical, true);
});

test('Boolean: true 与“否”必须判定为不相同', () => {
  const result = compare('education[].eliteTrainingBase', true, '否');

  assert.equal(result.equivalent, false);
  assert.equal(result.strategy, 'boolean');
  assert.equal(result.expectedCanonical, true);
  assert.equal(result.actualCanonical, false);
});

test('Boolean 候选词只在明确 boolean 字段中生效', () => {
  const nonBoolean = compare('education[].gpa', 1, '是');
  assert.notEqual(nonBoolean.equivalent, true);

  const trueAliases = ['1', '有', '具有', '属于', '来自', 'yes', 'y'];
  const falseAliases = ['0', '无', '没有', '不是', '非', 'no', 'n'];
  for (const actual of trueAliases) {
    assert.equal(compare('education[].eliteTrainingBase', true, actual).equivalent, true, actual);
  }
  for (const actual of falseAliases) {
    assert.equal(compare('education[].eliteTrainingBase', false, actual).equivalent, true, actual);
  }
  for (const actual of ['不属于', '不来自']) {
    const result = compare('education[].eliteTrainingBase', false, actual);
    assert.equal(result.equivalent, true, actual);
    assert.equal(result.strategy, 'enum');
  }
});

test('Date: year-month 字段将 2025-09 与 2025年9月判为相同', () => {
  const result = compare('education[].enrollmentDate', '2025-09', '2025年9月', {
    descriptor: { inputType: 'month' },
    controlKind: 'month',
    expectedType: 'date',
  });

  assert.equal(result.equivalent, true);
  assert.equal(result.strategy, 'date');
  assert.equal(result.expectedCanonical, '2025-09');
  assert.equal(result.actualCanonical, '2025-09');
});

test('Date: year-month 字段将斜线与横线格式判为相同', () => {
  const result = compare('education[].graduationDate', '2025/09', '2025-09', {
    descriptor: { inputType: 'month' },
    controlKind: 'month',
    expectedType: 'date',
  });

  assert.equal(result.equivalent, true);
  assert.equal(result.strategy, 'date');
});

test('Date: year-month 字段不接受不同月份', () => {
  const result = compare('education[].graduationDate', '2025-09', '2025年10月', {
    descriptor: { inputType: 'month' },
    controlKind: 'month',
    expectedType: 'date',
  });

  assert.equal(result.equivalent, false);
  assert.equal(result.strategy, 'date');
});

test('Date: 完整日期字段不能把仅年月与具体日期无条件判为相同', () => {
  const result = compare('basic.birthday', '2025-09', '2025-09-15', {
    descriptor: { inputType: 'date' },
    controlKind: 'date',
    expectedType: 'date',
  });

  assert.equal(result.equivalent, false);
  assert.equal(result.strategy, 'date');
});

test('Generic Option: 复用政治面貌 option aliases', () => {
  const result = compare('basic.political', '中共党员', '中国共产党党员', {
    descriptor: { expectedType: 'choice' },
    controlKind: 'native-select',
    expectedType: 'choice',
  });

  assert.equal(result.equivalent, true);
  assert.equal(result.strategy, 'option');
  assert.equal(result.expectedCanonical, '中共党员');
  assert.equal(result.actualCanonical, '中共党员');
});

test('未知语义值不产生错误匹配', () => {
  const result = compare('projects[].description', 'ABC', 'XYZ');

  assert.equal(result.equivalent, null);
  assert.equal(result.strategy, 'unknown');
  assert.match(result.reason, /NO_SEMANTIC_RULE|无语义规则/i);
});

test('VerificationEngine 保留原始精确匹配能力', () => {
  const result = VerificationEngine.verify(textDescriptor('425'), 425, {
    fieldPath: 'education[].score',
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, 'SUCCESS');
});

test('VerificationEngine 对普通文本控件使用 studyDuration 语义验证', () => {
  const result = VerificationEngine.verify(textDescriptor('四年制'), 4, {
    fieldPath: 'education[].studyDuration',
    expectedType: 'choice',
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, 'SUCCESS');
});

test('VerificationEngine 对普通文本控件使用字段感知 Boolean 语义验证', () => {
  const result = VerificationEngine.verify(textDescriptor('否'), false, {
    fieldPath: 'education[].eliteTrainingBase',
    expectedType: 'choice',
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, 'SUCCESS');
});

test('VerificationEngine 的完整日期验证不能退回旧年月宽松比较', () => {
  const result = VerificationEngine.verify(textDescriptor('2025-09-15', 'date'), '2025-09', {
    fieldPath: 'basic.birthday',
    expectedType: 'date',
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 'FAILED');
});

test('VerificationEngine 无语义规则时继续原有 fallback，而不是误报成功', () => {
  const result = VerificationEngine.verify(textDescriptor('XYZ'), 'ABC', {
    fieldPath: 'projects[].description',
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 'FAILED');
});

test('Semantic Verification 进入构建契约、生产注入和浏览器 E2E 运行时清单', async () => {
  const [popup, build, controller, wizard, tongji] = await Promise.all([
    readFile(resolve(projectRoot, 'popup.js'), 'utf8'),
    readFile(resolve(projectRoot, 'scripts', 'build.mjs'), 'utf8'),
    readFile(resolve(projectRoot, 'src', 'content-controller.js'), 'utf8'),
    readFile(resolve(projectRoot, 'tests', 'e2e', 'wizard.e2e.mjs'), 'utf8'),
    readFile(resolve(projectRoot, 'tests', 'e2e', 'tongji-like.e2e.mjs'), 'utf8'),
  ]);

  const booleanIndex = popup.indexOf("'src/semantics/boolean-semantic-adapter.js'");
  const semanticIndex = popup.indexOf("'src/core/semantic-verification.js'");
  const verificationIndex = popup.indexOf("'src/core/verification-engine.js'");
  assert.ok(booleanIndex >= 0 && booleanIndex < semanticIndex);
  assert.ok(semanticIndex < verificationIndex);
  assert.match(build, /src\/semantics\/boolean-semantic-adapter\.js/);
  assert.match(build, /src\/core\/semantic-verification\.js/);
  assert.match(controller, /JFBooleanSemanticAdapter/);
  assert.match(controller, /JFSemanticVerification/);

  for (const runtime of [wizard, tongji]) {
    assert.ok(runtime.indexOf("'src/semantics/boolean-semantic-adapter.js'") < runtime.indexOf("'src/core/semantic-verification.js'"));
    assert.ok(runtime.indexOf("'src/core/semantic-verification.js'") < runtime.indexOf("'src/core/verification-engine.js'"));
  }
});
