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
const Reports = require('../../src/core/report-manager.js');
const TaskState = require('../../src/core/task-state.js');
const DiagnosticSanitizer = require('../../src/core/diagnostic-sanitizer.js');
const FieldDetector = require('../../src/core/field-detector.js');
const FieldMatcher = require('../../src/core/field-matcher.js');
const FileFieldDetector = require('../../src/core/file-field-detector.js');

Object.assign(globalThis, {
  JFEventDispatcher: Events,
  JFOptionAliases: Options,
  JFDateRules: Dates,
  JFSemanticVerification: SemanticVerification,
  JFVerificationEngine: Verification,
  JFControlAdapterRegistry: Controls,
});

require('../../src/controls/adapters/native-select-adapter.js');
require('../../src/controls/adapters/choice-adapter.js');
require('../../src/controls/adapters/custom-select-adapter.js');

const FormFiller = require('../../src/core/form-filler.js');
const Autofill = require('../../src/core/autofill-engine.js');

const STATUS_PATH = 'papers[].status';
const AUTHOR_RANK_PATH = 'papers[].authorRank';
const TRACE_KEYS = Object.freeze([
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
const REASON_CODES = Object.freeze(new Set([
  'OPTION_MATCHED',
  'NO_OPTIONS',
  'NO_CANONICAL_ALIAS',
  'LOW_SCORE',
  'AMBIGUOUS_OPTIONS',
  'INSUFFICIENT_MARGIN',
  'OPTION_SCOPE_UNCERTAIN',
  'READBACK_MISMATCH',
]));

function option(label, value = label, element = null) {
  return { label, text: label, textContent: label, value, disabled: false, element };
}

function assertTraceSchema(debug, fieldPath) {
  assert.ok(debug && typeof debug === 'object', '必须输出 optionMatchingDebug');
  assert.deepEqual(Object.keys(debug).sort(), [...TRACE_KEYS].sort());
  assert.equal(debug.fieldPath, fieldPath);
  assert.equal(Array.isArray(debug.normalizedOptionLabels), true);
  assert.equal(Array.isArray(debug.canonicalCandidates), true);
  assert.equal(typeof debug.expectedShape, 'string');
  assert.equal(typeof debug.bestOptionLabel, 'string');
  for (const key of ['bestScore', 'secondBestScore', 'threshold', 'margin']) {
    assert.equal(Number.isFinite(debug[key]), true, `${key} 必须是有限数字`);
    assert.ok(debug[key] >= 0 && debug[key] <= 1, `${key} 必须限制在 0..1`);
  }
  assert.equal(REASON_CODES.has(debug.reasonCode), true, debug.reasonCode);
}

function nativeSelectDescriptor(entries) {
  const optionElements = entries.map(([value, label]) => ({
    value,
    label,
    textContent: label,
    disabled: false,
    selected: false,
    getAttribute() { return null; },
  }));
  const element = {
    tagName: 'SELECT',
    type: 'select-one',
    value: '',
    options: optionElements,
    selectedOptions: [],
    disabled: false,
    readOnly: false,
    isConnected: true,
    getAttribute() { return null; },
  };
  return {
    detectorId: 'paper-status-native',
    element,
    elements: [element],
    options: optionElements.map(item => option(item.label, item.value, item)),
    controlKind: 'native-select',
    baseControlKind: 'native-select',
    type: 'native-select',
    visible: true,
    disabled: false,
    readOnly: false,
  };
}

async function fillKnownNativeStatus() {
  const descriptor = nativeSelectDescriptor([
    ['published', '已发表'],
    ['accepted', '已录用'],
    ['underReview', '审稿中'],
    ['submitted', '投稿中'],
    ['inPress', 'in press'],
  ]);
  const counters = { write: 0 };
  const runtime = {
    readControlValue: Events.readControlValue,
    async setNativeSelect(target, selected) {
      counters.write += 1;
      const selectedElement = selected.element;
      for (const item of target.element.options) item.selected = item === selectedElement;
      target.element.value = selected.value;
      target.element.selectedOptions = [selectedElement];
      return { ok: true, beforeValue: '', afterValue: selected.value, reason: '' };
    },
  };
  const result = await FormFiller.fill(descriptor, '正式发表', {
    fieldPath: STATUS_PATH,
    expectedType: 'choice',
    allowOverwrite: false,
    dependencies: {
      EventDispatcher: runtime,
      OptionAliases: Options,
      VerificationEngine: Verification,
    },
  });
  return { descriptor, result, counters };
}

function radioDescriptor(labels) {
  const elements = labels.map(label => ({
    tagName: 'INPUT',
    type: 'radio',
    value: label,
    checked: false,
    disabled: false,
    readOnly: false,
    isConnected: true,
    getAttribute(name) { return name === 'aria-label' ? label : null; },
  }));
  return {
    detectorId: 'paper-status-radio',
    element: elements[0],
    elements,
    options: elements.map(element => option(element.value, element.value, element)),
    controlKind: 'radio',
    baseControlKind: 'radio',
    type: 'radio',
    visible: true,
    disabled: false,
    readOnly: false,
  };
}

function customSelectWithMissingOwnedListbox() {
  const body = {
    isConnected: true,
    hidden: false,
    parentElement: null,
    querySelectorAll() { return []; },
  };
  const document = {
    body,
    documentElement: body,
    defaultView: {
      getComputedStyle() { return { display: 'block', visibility: 'visible', opacity: '1' }; },
      requestAnimationFrame(callback) { callback(Date.now()); },
    },
    getElementById() { return null; },
    querySelectorAll() { return []; },
  };
  const element = {
    tagName: 'DIV',
    type: '',
    value: '',
    disabled: false,
    readOnly: false,
    hidden: false,
    isConnected: true,
    ownerDocument: document,
    parentElement: null,
    querySelector() { return null; },
    querySelectorAll() { return []; },
    closest() { return null; },
    getBoundingClientRect() { return { width: 180, height: 32 }; },
    getAttribute(name) {
      if (name === 'role') return 'combobox';
      if (name === 'aria-controls') return 'paper-status-listbox-that-does-not-exist';
      if (name === 'aria-expanded') return 'false';
      return null;
    },
  };
  return {
    detectorId: 'paper-status-custom',
    element,
    elements: [element],
    interactionElement: element,
    controlKind: 'custom-select',
    baseControlKind: 'custom-select',
    type: 'custom-select',
    visible: true,
    disabled: false,
    readOnly: false,
  };
}

function minimalDocument() {
  const body = {
    nodeType: 1,
    isConnected: true,
    hidden: false,
    childElementCount: 0,
    querySelector() { return null; },
    querySelectorAll() { return []; },
    contains() { return false; },
  };
  return {
    nodeType: 9,
    title: 'Option Runtime Trace Test',
    location: { href: 'https://example.test/apply/papers', origin: 'https://example.test' },
    body,
    documentElement: body,
    defaultView: {
      getComputedStyle() { return { display: 'block', visibility: 'visible', opacity: '1' }; },
      requestAnimationFrame(callback) { callback(Date.now()); },
      cancelAnimationFrame() {},
    },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    getElementById() { return null; },
  };
}

function memoryTaskStore() {
  return {
    async load() { return null; },
    async clear() {},
    async save(task) { return task; },
    async updateTask(task, updater) {
      const draft = JSON.parse(JSON.stringify(task));
      return updater(draft) || draft;
    },
    async updateSection(task, index, patch) {
      const draft = JSON.parse(JSON.stringify(task));
      draft.queue[index] = { ...draft.queue[index], ...patch };
      return draft;
    },
  };
}

function createTraceEngine({ reportManager, onUnexpectedFill } = {}) {
  const document = minimalDocument();
  const navigation = {
    scan() { return []; },
    scanDetailed() { return { items: [], candidates: [] }; },
    buildQueue() { return []; },
    invalidate() {},
    destroy() {},
  };
  const adapter = {
    id: 'option-runtime-trace-adapter',
    navigation,
    detectCurrentSection() { return { section: 'papers', score: 1, label: '论文成果' }; },
    findContentRoot() { return document.body; },
    scanFields() { return []; },
    diagnose() {
      return {
        schemaVersion: 2,
        section: { detected: 'papers', source: 'test', confidence: 1 },
        fields: [{
          detectorId: 'paper-status-field',
          labelText: '发表状态',
          matchedJsonPath: STATUS_PATH,
          status: 'NEEDS_CONFIRMATION',
          context: { section: 'papers', collection: 'papers', index: 0 },
        }],
      };
    },
  };
  const engine = new Autofill.AutofillEngine({
    document,
    adapter,
    navigationEngine: navigation,
    taskStore: memoryTaskStore(),
    reportManager: reportManager || new Reports.ReportManager(),
    formFiller: {
      async fillMatch() {
        onUnexpectedFill?.();
        throw new Error('Diagnosis 不得为了生成 option trace 主动执行 Select');
      },
    },
    saveHandler: { invalidate() {} },
  });
  engine.scanId = 'scan:option-runtime-trace';
  engine.lastInspection = {
    scanId: engine.scanId,
    sectionContext: {
      sectionId: 'papers',
      section: 'papers',
      collection: 'papers',
      collectionMode: 'repeatable',
      source: 'test',
      confidence: 1,
      scanId: engine.scanId,
    },
  };
  return engine;
}

test('Papers 已有 fixture 证据继续可靠匹配，且无证据词不得被猜入 alias', () => {
  const statusOptions = [
    option('已发表', 'published'),
    option('已录用', 'accepted'),
    option('审稿中', 'underReview'),
    option('投稿中', 'submitted'),
    option('in press', 'inPress'),
  ];
  const statusCases = [
    ['正式发表', '已发表'],
    ['accepted', '已录用'],
    ['underReview', '审稿中'],
    ['submitted', '投稿中'],
    ['inPress', 'in press'],
  ];
  for (const [expected, label] of statusCases) {
    const match = Options.findBestOption(expected, statusOptions, {
      fieldPath: STATUS_PATH,
      minScore: 0.9,
      ambiguityMargin: 0.06,
    });
    assert.equal(match.matched, true, expected);
    assert.equal(match.label, label, expected);
  }

  const authorOptions = [option('第一作者', '1'), option('第二作者', '2')];
  assert.equal(Options.findBestOption('一作', authorOptions, { fieldPath: AUTHOR_RANK_PATH }).label, '第一作者');
  assert.equal(Options.findBestOption('二作', authorOptions, { fieldPath: AUTHOR_RANK_PATH }).label, '第二作者');

  for (const unsupported of ['已接收', '待刊', '出版中']) {
    assert.equal(Options.canonicalFieldOption(STATUS_PATH, unsupported), unsupported);
  }
  for (const ratio of ['1/4', '1/5']) {
    assert.equal(Options.canonicalFieldOption(AUTHOR_RANK_PATH, ratio), ratio);
    assert.equal(Options.findBestOption(ratio, authorOptions, { fieldPath: AUTHOR_RANK_PATH }).matched, false);
  }
});

test('optionMatchingDebug V2 使用固定 metadata-only schema，未知 expected/value 不泄露', () => {
  const privateExpected = 'PRIVATE_EXPECTED_6B_9817';
  const privateValue = 'PRIVATE_OPTION_VALUE_6B_2741';
  const match = Options.findBestOption(privateExpected, [
    option('已发表', privateValue),
    option('审稿中', 'opaque-review'),
  ], { fieldPath: 'papers[3].status', minScore: 0.9, ambiguityMargin: 0.06 });

  assert.equal(match.matched, false);
  assertTraceSchema(match.optionMatchingDebug, STATUS_PATH);
  assert.equal(match.optionMatchingDebug.expectedCanonical, '');
  assert.deepEqual(match.optionMatchingDebug.canonicalCandidates, []);
  assert.equal(match.optionMatchingDebug.reasonCode, 'NO_CANONICAL_ALIAS');
  const serialized = JSON.stringify(match.optionMatchingDebug);
  assert.doesNotMatch(serialized, new RegExp(privateExpected));
  assert.doesNotMatch(serialized, new RegExp(privateValue));
});

test('RED privacy: non-vocabulary option labels never survive producer → ReportManager → Diagnosis → sanitizer', () => {
  const privateNames = ['张三', '李四'];
  const fieldPath = 'contact.emergencyName';
  const produced = Options.findBestOption(privateNames[0], [
    option(privateNames[0], 'contact-a'),
    option(privateNames[1], 'contact-b'),
  ], { fieldPath });

  assert.equal(produced.matched, true, 'privacy hardening must not change normal option matching');
  assertTraceSchema(produced.optionMatchingDebug, fieldPath);

  const manager = new Reports.ReportManager();
  const engine = createTraceEngine({ reportManager: manager });
  const runId = manager.beginRun({
    scanId: engine.scanId,
    taskId: 'task:generic-option-privacy',
    sectionId: 'contact',
  });
  engine.currentSectionRunIds.set(`${engine.scanId}:contact`, runId);
  manager.recordField(runId, {
    field: fieldPath,
    fieldName: '紧急联系人',
    status: Reports.REPORT_STATUSES.SUCCESS,
    optionMatchingDebug: produced.optionMatchingDebug,
  });

  const reportDebug = manager.getViewModel(runId, { includeValues: false })
    .items[0].optionMatchingDebug;
  const diagnosis = engine.diagnoseCurrent();
  const diagnosisDebug = diagnosis.optionMatchingTraces[0]?.optionMatchingDebug;
  const sanitized = DiagnosticSanitizer.sanitize(diagnosis).diagnosis;
  const sanitizedDebug = sanitized.optionMatchingTraces[0]?.optionMatchingDebug;

  for (const [stage, debug] of [
    ['producer', produced.optionMatchingDebug],
    ['ReportManager', reportDebug],
    ['Diagnosis', diagnosisDebug],
    ['DiagnosticSanitizer', sanitizedDebug],
  ]) {
    assertTraceSchema(debug, fieldPath);
    assert.deepEqual(debug.normalizedOptionLabels, [], `${stage} must not expose page option labels`);
    assert.equal(debug.bestOptionLabel, '', `${stage} must not expose the matched page label`);
    assert.equal(debug.expectedCanonical, '', `${stage} must not expose generic expected text`);
    assert.equal(debug.matchedCanonical, '', `${stage} must not expose generic matched text`);
    for (const privateName of privateNames) {
      assert.doesNotMatch(JSON.stringify(debug), new RegExp(privateName), `${stage} leaked ${privateName}`);
    }
  }

  const persistentSummary = manager.finalize(runId);
  const taskResult = manager.toTaskResult(runId);
  const persistedTask = TaskState.createTask({ scanId: engine.scanId, results: [taskResult] });
  for (const persistent of [persistentSummary, taskResult, persistedTask]) {
    const serialized = JSON.stringify(persistent);
    assert.equal(serialized.includes('optionMatchingDebug'), false);
    assert.equal(serialized.includes('optionMatchingTraces'), false);
    for (const privateName of privateNames) assert.doesNotMatch(serialized, new RegExp(privateName));
  }
});

test('phase 3.5 RED: education[].major exposes only bounded static UI labels through ephemeral diagnosis', () => {
  const fieldPath = 'education[0].major';
  const canonicalPath = 'education[].major';
  const privateExpected = 'PRIVATE_EXPECTED_MAJOR_3517';
  const privateValues = Array.from({ length: 55 }, (_, index) => `PRIVATE_MAJOR_VALUE_${index}_8912`);
  const labels = Array.from({ length: 55 }, (_, index) => `专业方向${String(index + 1).padStart(2, '0')}`);
  const produced = Options.findBestOption(
    privateExpected,
    labels.map((label, index) => option(label, privateValues[index])),
    { fieldPath },
  );

  assert.equal(produced.matched, false);
  assertTraceSchema(produced.optionMatchingDebug, canonicalPath);
  assert.equal(produced.optionMatchingDebug.reasonCode, 'LOW_SCORE');
  assert.equal(produced.optionMatchingDebug.normalizedOptionLabels.length, 40, 'existing trace bound stays below 50');
  assert.deepEqual(
    produced.optionMatchingDebug.normalizedOptionLabels.slice(0, 2),
    labels.slice(0, 2).map(Options.normalizeOptionText),
  );
  assert.equal(produced.optionMatchingDebug.bestOptionLabel, '');
  assert.equal(produced.optionMatchingDebug.expectedCanonical, '');
  assert.equal(produced.optionMatchingDebug.matchedCanonical, '');
  assert.deepEqual(produced.optionMatchingDebug.canonicalCandidates, []);

  const manager = new Reports.ReportManager();
  const engine = createTraceEngine({ reportManager: manager });
  const runId = manager.beginRun({
    scanId: engine.scanId,
    taskId: 'task:education-major-static-labels',
    sectionId: 'education',
  });
  engine.currentSectionRunIds.set(`${engine.scanId}:education`, runId);
  manager.recordField(runId, {
    field: canonicalPath,
    fieldName: '本科专业',
    status: Reports.REPORT_STATUSES.NEEDS_CONFIRMATION,
    optionMatchingDebug: produced.optionMatchingDebug,
  });

  const ephemeral = manager.getViewModel(runId, { includeValues: false }).items[0].optionMatchingDebug;
  const diagnosis = engine.diagnoseCurrent();
  const diagnosisDebug = diagnosis.optionMatchingTraces[0]?.optionMatchingDebug;
  const sanitizedDebug = DiagnosticSanitizer.sanitize(diagnosis).diagnosis
    .optionMatchingTraces[0]?.optionMatchingDebug;
  for (const debug of [ephemeral, diagnosisDebug, sanitizedDebug]) {
    assertTraceSchema(debug, canonicalPath);
    assert.deepEqual(debug.normalizedOptionLabels, produced.optionMatchingDebug.normalizedOptionLabels);
    assert.equal(debug.bestOptionLabel, '');
    assert.equal(debug.expectedCanonical, '');
    assert.equal(debug.matchedCanonical, '');
    const serialized = JSON.stringify(debug);
    assert.doesNotMatch(serialized, new RegExp(privateExpected));
    for (const privateValue of privateValues) assert.doesNotMatch(serialized, new RegExp(privateValue));
  }

  for (const persistent of [manager.finalize(runId), manager.toTaskResult(runId)]) {
    const serialized = JSON.stringify(persistent);
    assert.equal(serialized.includes('optionMatchingDebug'), false);
    assert.equal(serialized.includes('optionMatchingTraces'), false);
  }
});

test('reasonCode：空 option scope 明确为 NO_OPTIONS', () => {
  const match = Options.findBestOption('published', [], {
    fieldPath: STATUS_PATH,
    minScore: 0.9,
    ambiguityMargin: 0.06,
  });
  assertTraceSchema(match.optionMatchingDebug, STATUS_PATH);
  assert.equal(match.optionMatchingDebug.reasonCode, 'NO_OPTIONS');
  assert.equal(match.optionMatchingDebug.optionCount, 0);
});

test('reasonCode：expected 有 canonical、页面标签无证据时明确为 LOW_SCORE', () => {
  const match = Options.findBestOption('published', [option('公开态甲'), option('公开态乙')], {
    fieldPath: STATUS_PATH,
    minScore: 0.9,
    ambiguityMargin: 0.06,
  });
  assertTraceSchema(match.optionMatchingDebug, STATUS_PATH);
  assert.equal(match.optionMatchingDebug.expectedCanonical, 'published');
  assert.equal(match.optionMatchingDebug.reasonCode, 'LOW_SCORE');
  assert.equal(match.optionMatchingDebug.threshold, 0.9);
});

test('reasonCode：同分歧义与非零但不足 margin 必须可区分', () => {
  const tied = Options.findBestOption('published', [option('已发表'), option('正式发表')], {
    fieldPath: STATUS_PATH,
    minScore: 0.9,
    ambiguityMargin: 0.06,
  });
  assert.equal(tied.optionMatchingDebug.reasonCode, 'AMBIGUOUS_OPTIONS');
  assert.equal(tied.optionMatchingDebug.bestScore, tied.optionMatchingDebug.secondBestScore);

  const narrow = Options.findBestOption('abcd', [option('abc'), option('ab')], {
    fieldPath: 'projects[].type',
    minScore: 0.7,
    ambiguityMargin: 0.06,
  });
  assert.equal(narrow.matched, false);
  assert.equal(narrow.optionMatchingDebug.reasonCode, 'INSUFFICIENT_MARGIN');
  assert.ok(narrow.optionMatchingDebug.bestScore > narrow.optionMatchingDebug.secondBestScore);
  assert.ok(narrow.optionMatchingDebug.bestScore - narrow.optionMatchingDebug.secondBestScore < 0.06);
});

test('Native Select 与 Choice Adapter 都把完整 producer trace 传到 FormFiller', async () => {
  const native = await fillKnownNativeStatus();
  assert.equal(native.result.status, 'SUCCESS', native.result.reason);
  assert.equal(native.counters.write, 1);
  assertTraceSchema(native.result.optionMatchingDebug, STATUS_PATH);
  assert.equal(native.result.optionMatchingDebug.reasonCode, 'OPTION_MATCHED');
  assert.equal(native.result.optionMatchingDebug.expectedCanonical, 'published');
  assert.deepEqual(native.result.optionMatchingDebug.canonicalCandidates, ['published']);
  assert.equal(native.result.optionMatchingDebug.bestOptionLabel, '已发表');
  assert.equal(native.result.optionMatchingDebug.threshold, 0.88);
  assert.equal(native.result.optionMatchingDebug.margin, 0.06);

  const privateExpected = 'PRIVATE_CHOICE_EXPECTED_6B_6204';
  const choice = await FormFiller.fill(radioDescriptor(['已发表', '审稿中']), privateExpected, {
    fieldPath: STATUS_PATH,
    expectedType: 'choice',
    allowOverwrite: false,
    dependencies: {
      EventDispatcher: {
        readControlValue: Events.readControlValue,
        async setChecked() { throw new Error('未知 expected 不得触发选择'); },
      },
      OptionAliases: Options,
      VerificationEngine: Verification,
    },
  });
  assert.equal(choice.status, 'NEEDS_CONFIRMATION');
  assertTraceSchema(choice.optionMatchingDebug, STATUS_PATH);
  assert.equal(choice.optionMatchingDebug.reasonCode, 'NO_CANONICAL_ALIAS');
  assert.doesNotMatch(JSON.stringify(choice.optionMatchingDebug), new RegExp(privateExpected));
});

test('Custom Select：声明的 owned listbox 不存在时 fail-closed 并记录 OPTION_SCOPE_UNCERTAIN', async () => {
  const descriptor = customSelectWithMissingOwnedListbox();
  let openCount = 0;
  const result = await FormFiller.fill(descriptor, 'published', {
    fieldPath: STATUS_PATH,
    expectedType: 'choice',
    allowOverwrite: false,
    customSelectTimeoutMs: 1,
    dependencies: {
      EventDispatcher: {
        readControlValue: Events.readControlValue,
        clickLikeUser() { openCount += 1; return true; },
      },
      OptionAliases: Options,
      VerificationEngine: Verification,
    },
  });

  assert.equal(openCount, 1, '只允许正常 Adapter 执行打开一次，不得为 debug 额外打开');
  assert.equal(result.status, 'NEEDS_CONFIRMATION');
  assertTraceSchema(result.optionMatchingDebug, STATUS_PATH);
  assert.equal(result.optionMatchingDebug.reasonCode, 'OPTION_SCOPE_UNCERTAIN');
  assert.equal(result.optionMatchingDebug.optionCount, 0);
});

test('Registry：option 已匹配但 readback 验证失败时 trace 明确为 READBACK_MISMATCH', async () => {
  const produced = Options.findBestOption('published', [option('已发表')], {
    fieldPath: STATUS_PATH,
    minScore: 0.9,
    ambiguityMargin: 0.06,
  }).optionMatchingDebug;
  Controls.register({
    id: 'option-runtime-readback-probe',
    priority: 9999,
    capabilities: ['enumerate-options', 'select-option', 'verify'],
    supports(context) { return context.descriptor?.controlKind === 'option-runtime-readback-probe'; },
    read(context) { return context.descriptor.element.value; },
    write(context) {
      context.descriptor.element.value = '页面未接受';
      return { handled: true, ok: true, status: 'SUCCESS', optionMatchingDebug: produced };
    },
    verify() {
      return { ok: false, status: 'NEEDS_CONFIRMATION', reason: 'readback mismatch', actualValue: '页面未接受' };
    },
  });
  const element = {
    tagName: 'DIV', type: '', value: '', disabled: false, readOnly: false, isConnected: true,
    getAttribute() { return null; },
  };
  const result = await FormFiller.fill({
    detectorId: 'readback-probe',
    element,
    elements: [element],
    controlKind: 'option-runtime-readback-probe',
    type: 'option-runtime-readback-probe',
    visible: true,
    disabled: false,
    readOnly: false,
  }, 'published', {
    fieldPath: STATUS_PATH,
    expectedType: 'choice',
    allowOverwrite: true,
  });

  assert.equal(result.status, 'NEEDS_CONFIRMATION');
  assertTraceSchema(result.optionMatchingDebug, STATUS_PATH);
  assert.equal(result.optionMatchingDebug.reasonCode, 'READBACK_MISMATCH');
});

test('ReportManager：完整 trace 只进入 ephemeral view，不进入 persistent summary/task result', () => {
  const debug = {
    fieldPath: STATUS_PATH,
    optionCount: 2,
    normalizedOptionLabels: ['已发表', '审稿中'],
    expectedShape: 'text',
    canonicalCandidates: ['published'],
    expectedCanonical: 'published',
    bestScore: 0.98,
    secondBestScore: 0,
    threshold: 0.9,
    margin: 0.06,
    bestOptionLabel: '已发表',
    matchedCanonical: 'published',
    reasonCode: 'OPTION_MATCHED',
  };
  const manager = new Reports.ReportManager();
  const runId = manager.beginRun({ scanId: 'scan:option-report', sectionId: 'papers' });
  manager.recordField(runId, {
    field: STATUS_PATH,
    fieldName: '发表状态',
    status: Reports.REPORT_STATUSES.SUCCESS,
    optionMatchingDebug: debug,
  });

  const view = manager.getViewModel(runId, { includeValues: false });
  assert.deepEqual(view.items[0].optionMatchingDebug, debug);
  assert.equal(JSON.stringify(manager.toPersistentSummary(runId)).includes('optionMatchingDebug'), false);
  assert.equal(JSON.stringify(manager.toTaskResult(runId)).includes('optionMatchingDebug'), false);
});

test('正常 Adapter→Registry→FormFiller→Engine ephemeral→Diagnosis 保持 trace，诊断不主动打开 Select', async () => {
  const filled = await fillKnownNativeStatus();
  assert.equal(filled.result.status, 'SUCCESS', filled.result.reason);
  const writesBeforeDiagnosis = filled.counters.write;
  let unexpectedFillCount = 0;
  const manager = new Reports.ReportManager();
  const engine = createTraceEngine({
    reportManager: manager,
    onUnexpectedFill() { unexpectedFillCount += 1; },
  });
  const runId = manager.beginRun({
    scanId: engine.scanId,
    taskId: 'task:option-runtime-trace',
    sectionId: 'papers',
  });
  engine.currentSectionRunIds.set(`${engine.scanId}:papers`, runId);
  engine.record(runId, {
    itemIndex: 0,
    field: STATUS_PATH,
    fieldName: '发表状态',
    status: filled.result.status,
    reason: filled.result.reason,
    confidence: 1,
    optionMatchingDebug: filled.result.optionMatchingDebug,
  });

  const report = engine.getReport();
  assertTraceSchema(report.sections[0].items[0].optionMatchingDebug, STATUS_PATH);
  const diagnosis = engine.diagnoseCurrent();
  assert.equal(Array.isArray(diagnosis.optionMatchingTraces), true);
  const trace = diagnosis.optionMatchingTraces.find(item => (
    item.fieldPath === STATUS_PATH && item.itemIndex === 0
  ));
  assert.ok(trace, '后续 Diagnosis 必须能看到当前 scan 的执行 trace');
  assert.deepEqual(trace.optionMatchingDebug, filled.result.optionMatchingDebug);
  assert.equal(unexpectedFillCount, 0, 'Diagnosis 不得调用 FormFiller/Adapter');
  assert.equal(filled.counters.write, writesBeforeDiagnosis, 'Diagnosis 不得为 debug 再次打开或写入 Select');
});

test('Diagnosis 只暴露当前 scan 的 option trace，旧 scan 不得串入', () => {
  const manager = new Reports.ReportManager();
  const oldRun = manager.beginRun({ scanId: 'scan:old-option-trace', sectionId: 'papers' });
  manager.recordField(oldRun, {
    field: STATUS_PATH,
    fieldName: '发表状态',
    status: Reports.REPORT_STATUSES.NEEDS_CONFIRMATION,
    optionMatchingDebug: {
      fieldPath: STATUS_PATH,
      optionCount: 1,
      normalizedOptionLabels: ['旧选项'],
      expectedShape: 'text',
      canonicalCandidates: ['published'],
      expectedCanonical: 'published',
      bestScore: 0,
      secondBestScore: 0,
      threshold: 0.9,
      margin: 0.06,
      bestOptionLabel: '',
      matchedCanonical: '',
      reasonCode: 'LOW_SCORE',
    },
  });
  const engine = createTraceEngine({ reportManager: manager });
  engine.currentSectionRunIds.set('scan:old-option-trace:papers', oldRun);

  const diagnosis = engine.diagnoseCurrent();
  assert.deepEqual(diagnosis.optionMatchingTraces || [], []);
});

test('中央诊断边界把 optionMatchingTraces 保持为核心数组，并递归剔除值/DOM', () => {
  const invalid = DiagnosticSanitizer.sanitize({ optionMatchingTraces: 'not-an-array' });
  assert.deepEqual(invalid.diagnosis.optionMatchingTraces, []);

  const safe = DiagnosticSanitizer.sanitize({
    optionMatchingTraces: [{
      itemIndex: 0,
      fieldPath: STATUS_PATH,
      optionMatchingDebug: {
        fieldPath: STATUS_PATH,
        optionCount: 1,
        normalizedOptionLabels: ['已发表'],
        expectedShape: 'text',
        canonicalCandidates: ['published'],
        expectedCanonical: 'published',
        bestScore: 1,
        secondBestScore: 0,
        threshold: 0.9,
        margin: 0.06,
        bestOptionLabel: '已发表',
        matchedCanonical: 'published',
        reasonCode: 'OPTION_MATCHED',
        currentValue: 'PRIVATE-PAPER-STATUS',
        element: { outerHTML: '<select>PRIVATE-PAPER-STATUS</select>' },
      },
    }],
  });
  assert.equal(Array.isArray(safe.diagnosis.optionMatchingTraces), true);
  assert.equal(safe.diagnosis.optionMatchingTraces.length, 1);
  assert.doesNotMatch(JSON.stringify(safe.diagnosis.optionMatchingTraces), /PRIVATE-PAPER-STATUS|outerHTML/);
});

test('真实 processFieldGroup：Native Adapter→Registry→FormFiller→Engine→Diagnosis 保持 trace 且持久层排除', { concurrency: false }, async () => {
  const privateExpected = 'PRIVATE_PROCESS_EXPECTED_81553';
  const privateOptionValue = 'PRIVATE_PROCESS_VALUE_29714';
  const knownDescriptor = nativeSelectDescriptor([
    ['published', '已发表'],
    ['underReview', '审稿中'],
  ]);
  knownDescriptor.detectorId = 'paper-status-process-known';
  knownDescriptor.labelText = '发表状态';
  const unknownDescriptor = nativeSelectDescriptor([
    [privateOptionValue, '已发表'],
    ['opaque-review', '审稿中'],
  ]);
  unknownDescriptor.detectorId = 'paper-status-process-unknown';
  unknownDescriptor.labelText = '发表状态';

  const originalFieldScan = FieldDetector.scan;
  const originalMatchFields = FieldMatcher.matchFields;
  const originalFileScan = FileFieldDetector.scan;
  FieldDetector.scan = () => [knownDescriptor, unknownDescriptor];
  FieldMatcher.matchFields = () => [{
    descriptor: knownDescriptor,
    status: 'MATCHED',
    matchedPath: STATUS_PATH,
    value: '正式发表',
    score: 100,
    evidence: [{ source: 'type', alias: 'choice' }],
  }, {
    descriptor: unknownDescriptor,
    status: 'MATCHED',
    matchedPath: STATUS_PATH,
    value: privateExpected,
    score: 100,
    evidence: [{ source: 'type', alias: 'choice' }],
  }];
  FileFieldDetector.scan = () => [];

  try {
    const document = minimalDocument();
    const navigation = {
      scan() { return []; },
      scanDetailed() { return { items: [], candidates: [] }; },
      buildQueue() { return []; },
      invalidate() {},
      destroy() {},
    };
    const adapter = {
      id: 'option-process-field-group-adapter',
      navigation,
      findContentRoot() { return document.body; },
      diagnose() { return { schemaVersion: 2, fields: [] }; },
    };
    let optionWriteCount = 0;
    const runtime = {
      readControlValue: Events.readControlValue,
      async setNativeSelect(target, selected) {
        optionWriteCount += 1;
        for (const item of target.element.options) item.selected = item === selected.element;
        target.element.value = selected.value;
        target.element.selectedOptions = [selected.element];
        return { ok: true, beforeValue: '', afterValue: selected.value, reason: '' };
      },
    };
    const manager = new Reports.ReportManager();
    const engine = new Autofill.AutofillEngine({
      document,
      adapter,
      navigationEngine: navigation,
      taskStore: memoryTaskStore(),
      reportManager: manager,
      saveHandler: { invalidate() {} },
      preferences: {
        allowOverwrite: true,
        dependencies: {
          EventDispatcher: runtime,
          OptionAliases: Options,
          VerificationEngine: Verification,
        },
      },
    });
    const scanId = 'scan:real-process-field-group';
    const sectionContext = {
      sectionId: 'papers',
      section: 'papers',
      collection: 'papers',
      collectionMode: 'array',
      source: 'test',
      confidence: 1,
      scanId,
    };
    engine.scanId = scanId;
    engine.lastInspection = { scanId, sectionContext };
    const runId = manager.beginRun({ scanId, sectionId: 'papers' });
    engine.currentSectionRunIds.set(`${scanId}:papers`, runId);

    await engine.processFieldGroup(runId, document.body, 'papers', 0, null, { sectionContext });

    const report = engine.getReport();
    assert.equal(report.sections.length, 1);
    assert.equal(report.sections[0].items.length, 2);
    const [matchedItem, unknownItem] = report.sections[0].items;
    assertTraceSchema(matchedItem.optionMatchingDebug, STATUS_PATH);
    assertTraceSchema(unknownItem.optionMatchingDebug, STATUS_PATH);
    assert.equal(matchedItem.optionMatchingDebug.reasonCode, 'OPTION_MATCHED');
    assert.equal(unknownItem.optionMatchingDebug.reasonCode, 'NO_CANONICAL_ALIAS');
    assert.equal(optionWriteCount, 1, '未知 expected 不得触发第二次 option 写入');
    const ephemeralText = JSON.stringify(report);
    assert.doesNotMatch(ephemeralText, new RegExp(privateExpected));
    assert.doesNotMatch(ephemeralText, new RegExp(privateOptionValue));

    const writesBeforeDiagnosis = optionWriteCount;
    const diagnosis = engine.diagnoseCurrent();
    assert.equal(diagnosis.optionMatchingTraces.length, 2);
    for (const trace of diagnosis.optionMatchingTraces) {
      assertTraceSchema(trace.optionMatchingDebug, STATUS_PATH);
    }
    assert.equal(optionWriteCount, writesBeforeDiagnosis, 'Diagnosis 不得重跑 Adapter 或重新打开 Select');
    const sanitizedDiagnosis = DiagnosticSanitizer.sanitize(diagnosis).diagnosis;
    const diagnosisText = JSON.stringify(sanitizedDiagnosis.optionMatchingTraces);
    assert.doesNotMatch(diagnosisText, new RegExp(privateExpected));
    assert.doesNotMatch(diagnosisText, new RegExp(privateOptionValue));

    const persistentSummary = manager.finalize(runId);
    const taskResult = manager.toTaskResult(runId);
    const persistedTask = TaskState.createTask({ scanId, results: [taskResult] });
    for (const persistent of [persistentSummary, taskResult, persistedTask]) {
      const serialized = JSON.stringify(persistent);
      assert.equal(serialized.includes('optionMatchingDebug'), false);
      assert.equal(serialized.includes('optionMatchingTraces'), false);
      assert.doesNotMatch(serialized, new RegExp(privateExpected));
      assert.doesNotMatch(serialized, new RegExp(privateOptionValue));
    }
  } finally {
    FieldDetector.scan = originalFieldScan;
    FieldMatcher.matchFields = originalMatchFields;
    FileFieldDetector.scan = originalFileScan;
  }
});
