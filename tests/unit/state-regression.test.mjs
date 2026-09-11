import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const TaskState = require('../../src/core/task-state.js');
const Reports = require('../../src/core/report-manager.js');
const ArrayHandler = require('../../src/core/array-handler.js');
const PageReady = require('../../src/core/page-ready.js');
const FormFiller = require('../../src/core/form-filler.js');
const Autofill = require('../../src/core/autofill-engine.js');

function memoryStorageArea() {
  const values = Object.create(null);
  return {
    values,
    get(key, callback) { callback({ [key]: values[key] }); },
    set(payload, callback) { Object.assign(values, payload); callback?.(); },
    remove(key, callback) { delete values[key]; callback?.(); },
  };
}

function createTaskStore() {
  const local = memoryStorageArea();
  const chromeApi = { runtime: {}, storage: { local } };
  return { local, store: new TaskState.TaskStateStore({ chromeApi }) };
}

function minimalDocument() {
  const document = {
    nodeType: 9,
    title: '回归测试报名系统',
    location: {
      href: 'https://school.test/apply/family',
      origin: 'https://school.test',
    },
    body: { nodeType: 1 },
    documentElement: { nodeType: 1, childElementCount: 0 },
    defaultView: {
      getComputedStyle() { return { display: 'block', visibility: 'visible', opacity: '1' }; },
      requestAnimationFrame(callback) { return setTimeout(() => callback(Date.now()), 4); },
      cancelAnimationFrame(handle) { clearTimeout(handle); },
    },
    querySelector() { return null; },
    querySelectorAll() { return []; },
  };
  return document;
}

function createEngine({ taskStore, reportManager, callbacks } = {}) {
  const document = minimalDocument();
  const navigation = {
    scan() { return []; },
    buildQueue() { return []; },
    destroy() {},
  };
  const adapter = {
    id: 'regression-adapter',
    navigation,
    detectCurrentSection() { return { section: null, score: 0, label: '' }; },
    findContentRoot() { return document.body; },
    scanFields() { return []; },
    diagnose() { return {}; },
  };
  return new Autofill.AutofillEngine({
    document,
    adapter,
    navigationEngine: navigation,
    taskStore: taskStore || createTaskStore().store,
    reportManager: reportManager || new Reports.ReportManager(),
    formFiller: { async fillMatch() { throw new Error('本测试不应执行实际字段写入'); } },
    saveHandler: { invalidate() {} },
    callbacks,
  });
}

function actionButton(text, onClick) {
  const document = minimalDocument();
  const button = {
    tagName: 'BUTTON',
    type: 'button',
    textContent: text,
    innerText: text,
    value: '',
    disabled: false,
    hidden: false,
    ownerDocument: document,
    getAttribute(name) {
      if (name === 'type') return 'button';
      return '';
    },
    matches() { return false; },
    closest() { return null; },
    click() { onClick?.(); },
  };
  return button;
}

test('TaskState updateTask/updateSection 返回新快照，旧 task/section 引用无法回写新状态', async () => {
  const { local, store } = createTaskStore();
  const original = TaskState.createTask({
    scanId: 'scan:stale-reference',
    queue: [
      { sectionId: 'family', label: '家庭主要成员' },
      { sectionId: 'education', label: '学习信息' },
    ],
  });
  const oldSectionReference = original.queue[0];

  const running = await store.updateTask(original, draft => {
    draft.state = TaskState.TASK_STATES.RUNNING;
    draft.queue[0].state = 'running';
  });
  assert.notEqual(running, original);
  assert.notEqual(running.queue, original.queue);
  assert.notEqual(running.queue[0], oldSectionReference);
  assert.equal(original.state, TaskState.TASK_STATES.QUEUED);
  assert.equal(original.queue[0].state, 'pending');

  const filled = await store.updateSection(running, 0, { state: 'filled', attempts: 1 });
  oldSectionReference.state = 'failed';
  running.queue[0].state = 'failed';

  assert.equal(filled.queue[0].state, 'filled');
  assert.equal(filled.queue[0].scanId, filled.scanId);
  assert.equal(local.values[TaskState.TASK_STORAGE_KEY].queue[0].state, 'filled');
  assert.equal(local.values[TaskState.TASK_STORAGE_KEY].queue[1].state, 'pending');
});

test('scanId 隔离：当前快照和报告都只采用本次扫描结果', () => {
  const manager = new Reports.ReportManager();
  const runA = manager.beginRun({ scanId: 'scan:regression-a', taskId: 'task:scan-a', sectionId: 'basic' });
  manager.recordField(runA, { field: 'basic.name', fieldName: '姓名', status: Reports.REPORT_STATUSES.SUCCESS });
  manager.finalize(runA);

  const runB = manager.beginRun({ scanId: 'scan:regression-b', taskId: 'task:scan-b', sectionId: 'family' });
  manager.recordField(runB, { field: 'family[].relationship', fieldName: '关系', status: Reports.REPORT_STATUSES.NEEDS_CONFIRMATION });
  manager.finalize(runB);

  const engine = createEngine({ reportManager: manager });
  engine.scanId = 'scan:regression-b';
  const finishedAt = new Date().toISOString();
  engine.task = TaskState.createTask({
    taskId: 'task:scan-b',
    scanId: 'scan:regression-b',
    queue: [{ sectionId: 'family', label: '家庭主要成员', state: 'no_changes' }],
    results: [
      { sectionId: 'family', scanId: 'scan:regression-a', status: 'completed', summary: { total: 9, success: 9 }, finishedAt },
      { sectionId: 'family', scanId: 'scan:regression-b', status: 'manual_review', summary: { total: 1, success: 0, manualReview: 1 }, finishedAt },
    ],
  });
  engine.currentSectionRunIds.set('scan:regression-a:basic', runA);
  engine.currentSectionRunIds.set('scan:regression-b:family', runB);

  const snapshot = engine.snapshot();
  assert.equal(snapshot.scanId, 'scan:regression-b');
  assert.equal(snapshot.sectionQueue[0].summary, '0/1');

  const report = engine.getReport();
  assert.equal(report.scanId, 'scan:regression-b');
  assert.equal(report.sections.length, 1);
  assert.equal(report.sections[0].sectionId, 'family');
  assert.equal(report.success, 0);
  assert.equal(report.needsConfirmation, 1);
});

test('0 成功字段产生 FINISHED_NO_CHANGES，并明确提示没有填写任何字段', async () => {
  const { store } = createTaskStore();
  const stateSnapshots = [];
  const engine = createEngine({ taskStore: store, callbacks: { onState: value => stateSnapshots.push(value) } });
  const task = TaskState.createTask({
    taskId: 'task:no-changes',
    scanId: 'scan:no-changes',
    queue: [{
      sectionId: 'family', label: '家庭主要成员', state: 'pending', confidence: 0.91,
      sectionSource: 'field-signature', collection: 'family', collectionMode: 'repeatable',
    }],
  });
  const prepared = {
    taskId: task.taskId,
    scanId: task.scanId,
    task,
    queue: task.queue,
  };
  const authorization = {
    taskId: task.taskId,
    scanId: task.scanId,
    nonce: 'authorization_1234567890',
    userConfirmed: true,
    allowedSectionIds: ['family'],
    allowSafeSave: false,
    filePolicy: 'auto-high-confidence',
    expiresAt: Date.now() + 60_000,
  };
  engine.runSection = async () => ({
    persistent: {
      sectionId: 'family',
      scanId: task.scanId,
      status: 'manual_review',
      reasonCode: 'MANUAL_REVIEW_REQUIRED',
      summary: { total: 5, success: 0, manualReview: 4, missingJson: 1, failed: 0 },
      finishedAt: new Date().toISOString(),
      attempts: 1,
    },
  });

  const report = await engine.runCurrent({ prepared, authorization });
  assert.equal(engine.engineState, Autofill.ENGINE_STATES.FINISHED);
  assert.equal(engine.task.resultStatus, TaskState.RESULT_STATUSES.NO_CHANGES);
  assert.equal(engine.task.queue[0].state, 'no_changes');
  assert.match(engine.currentAction, /没有填写任何字段/);
  assert.doesNotMatch(engine.currentAction, /^填写完成|当前栏目已填写/);
  assert.equal(engine.snapshot().resultStatus, TaskState.RESULT_STATUSES.NO_CHANGES);
  assert.equal(report.resultStatus, TaskState.RESULT_STATUSES.NO_CHANGES);
  assert.equal(report.success, 0);
  assert.equal(stateSnapshots.at(-1).resultStatus, TaskState.RESULT_STATUSES.NO_CHANGES);
});

test('family repeatable：页面 1 组时根据 JSON 安全新增到 3 组并建立逐项上下文', async () => {
  const groups = [{ id: 'row-1' }];
  const button = actionButton('新增一行', () => groups.push({ id: `row-${groups.length + 1}` }));
  const root = {
    nodeType: 1,
    ownerDocument: button.ownerDocument,
    contains(element) { return element === button; },
    querySelector(selector) { return selector === '.add-family-row' ? button : null; },
    querySelectorAll(selector) { return selector === '.add-family-row' ? [button] : []; },
  };
  const context = {
    sectionId: 'family',
    collection: 'family',
    collectionMode: 'repeatable',
    source: 'field-signature',
    confidence: 0.91,
  };

  const result = await ArrayHandler.prepare(context, [{}, {}, {}], root, {
    getGroups: () => groups,
    addButtonSelector: '.add-family-row',
    addPattern: /新增一行/,
    timeoutMs: 250,
  });

  assert.equal(result.ok, true, result.error);
  assert.equal(result.mode, 'repeatable');
  assert.equal(result.initialCount, 1);
  assert.equal(result.count, 3);
  assert.equal(result.added, 2);
  assert.equal(result.clicks, 2);
  assert.deepEqual(result.groupContexts.map(item => item.index), [0, 1, 2]);
  assert.deepEqual(result.groupContexts.map(item => item.collection), ['family', 'family', 'family']);
  assert.equal(new Set(result.groupContexts.map(item => item.groupId)).size, 3);
});

test('education singleton-view：没有新增按钮仍固定映射 education[0]', async () => {
  const document = minimalDocument();
  const controls = Array.from({ length: 4 }, () => ({
    tagName: 'INPUT', type: 'text', ownerDocument: document,
    closest() { return null; },
  }));
  const root = {
    nodeType: 1,
    ownerDocument: document,
    querySelector() { return null; },
    querySelectorAll(selector) {
      if (selector === ArrayHandler.CONTROL_SELECTOR) return controls;
      return [];
    },
  };
  const context = {
    sectionId: 'education',
    collection: 'education',
    collectionMode: 'singleton-view',
    source: 'heading',
    confidence: 0.98,
  };

  const result = await ArrayHandler.prepare(context, [{ school: '示例大学' }], root, {
    getGroups: () => [],
  });

  assert.equal(result.ok, true, result.error);
  assert.equal(result.mode, 'singleton-view');
  assert.equal(result.repeatable, false);
  assert.equal(result.count, 1);
  assert.equal(result.added, 0);
  assert.equal(result.groupContexts.length, 1);
  assert.equal(result.groupContexts[0].element, root);
  assert.equal(result.groupContexts[0].collection, 'education');
  assert.equal(result.groupContexts[0].index, 0);
  assert.equal(result.unhandledCount, 0);
});

test('waitForFormReady 等待延迟出现的可见控件，并在 DOM 安静后才返回', async () => {
  const document = minimalDocument();
  let controls = [];
  const root = {
    nodeType: 1,
    ownerDocument: document,
    querySelector() { return null; },
    querySelectorAll() { return controls; },
  };
  const input = {
    tagName: 'INPUT', type: 'text', ownerDocument: document,
    isConnected: true, hidden: false,
    getAttribute() { return ''; },
    closest() { return null; },
    getBoundingClientRect() { return { width: 180, height: 32 }; },
  };
  const startedAt = Date.now();
  setTimeout(() => { controls = [input]; }, 30);

  const ready = await PageReady.waitForFormReady({
    document,
    root,
    timeoutMs: 500,
    pollIntervalMs: 16,
    stableForMs: 100,
    minFrames: 2,
  });

  assert.equal(ready.ok, true, ready.reason);
  assert.equal(ready.ready, true);
  assert.equal(ready.reason, 'FORM_READY_AND_STABLE');
  assert.equal(ready.controlCount, 1);
  assert.ok(Date.now() - startedAt >= 100, '不应在控件出现前或 DOM 尚未稳定时提前返回');
});

test('compound-picker 由 FormFiller 返回 NEEDS_CONFIRMATION，且不写入显示 input', async () => {
  const element = {
    tagName: 'INPUT',
    type: 'text',
    value: '',
    hidden: false,
    disabled: false,
    readOnly: false,
    getAttribute() { return ''; },
  };
  const descriptor = {
    element,
    controlKind: 'compound-picker',
    type: 'compound-picker',
    visible: true,
    hidden: false,
    disabled: false,
    readOnly: false,
    sensitive: false,
  };

  const result = await FormFiller.fill(descriptor, '示例大学', { allowOverwrite: false, skipEmpty: true });
  assert.equal(result.status, FormFiller.FILL_STATUS.NEEDS_CONFIRMATION);
  assert.match(result.reason, /网站适配器|人工选择/);
  assert.equal(element.value, '');
  assert.equal(result.beforeValue, '');
  assert.equal(result.afterValue, '');
});
