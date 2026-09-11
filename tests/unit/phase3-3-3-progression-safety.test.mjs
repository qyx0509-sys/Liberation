import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';

const require = createRequire(import.meta.url);
const Autofill = require('../../src/core/autofill-engine.js');
const Navigation = require('../../src/core/navigation-engine.js');
const TaskState = require('../../src/core/task-state.js');
const Reports = require('../../src/core/report-manager.js');
const Diagnostics = require('../../src/core/diagnostic-sanitizer.js');

function field(status, overrides = {}) {
  return {
    field: overrides.field || 'basic.example',
    fieldName: overrides.fieldName || '示例字段',
    status,
    visible: overrides.visible !== false,
    disabled: Boolean(overrides.disabled),
    hidden: Boolean(overrides.hidden),
    ...overrides,
  };
}

function gate(items, options = {}) {
  assert.equal(typeof Autofill.evaluateProgression, 'function', 'AutofillEngine 必须导出统一 Progression Gate');
  return Autofill.evaluateProgression({ items, ...options });
}

function fakeAction({
  text = '', ariaLabel = '', tagName = 'BUTTON', type = 'button', role = '',
  inNavigation = false, inFooter = false, dataSection = '', dataStep = '',
} = {}) {
  const navRoot = { nodeType: 1 };
  const footer = { nodeType: 1 };
  const element = {
    tagName,
    type,
    textContent: text,
    innerText: text,
    value: '',
    disabled: false,
    hidden: false,
    parentElement: null,
    dataset: { section: dataSection, step: dataStep },
    getAttribute(name) {
      if (name === 'type') return type;
      if (name === 'role') return role;
      if (name === 'aria-label') return ariaLabel;
      if (name === 'data-section') return dataSection;
      if (name === 'data-step') return dataStep;
      return '';
    },
    matches() { return false; },
    closest(selector) {
      if (inNavigation && /navigation|tablist|menu|sidebar|nav/.test(selector)) return navRoot;
      if (inFooter && /footer|actions|button-bar|form-buttons|steps-action/.test(selector)) return footer;
      if (role === 'tab' && selector.includes('[role="tab"]')) return this;
      return null;
    },
  };
  return element;
}

test('全部 SUCCESS / SKIPPED_EXISTING 时允许切换明确 sidebar 栏目', () => {
  const result = gate([
    field('SUCCESS'),
    field('SKIPPED_EXISTING'),
  ], { navigationIntent: 'SECTION_NAVIGATION' });
  assert.equal(result.allowed, true);
  assert.equal(result.blockers.length, 0);
});

test('NEEDS_CONFIRMATION 阻止自动离开当前栏目', () => {
  const result = gate([field('NEEDS_CONFIRMATION')]);
  assert.equal(result.allowed, false);
  assert.equal(result.reasonCode, 'AUTO_PROGRESSION_BLOCKED');
});

test('CONFLICT 阻止自动离开当前栏目', () => {
  const result = gate([field('CONFLICT')]);
  assert.equal(result.allowed, false);
  assert.ok(result.blockers.some(item => item.status === 'CONFLICT'));
});

test('FAILED 阻止自动离开当前栏目', () => {
  const result = gate([field('FAILED')]);
  assert.equal(result.allowed, false);
  assert.ok(result.blockers.some(item => item.status === 'FAILED'));
});

test('可见 actionable UNMATCHED 默认阻止自动离页', () => {
  const result = gate([field('UNMATCHED', { visible: true, disabled: false })]);
  assert.equal(result.allowed, false);
  assert.equal(result.blockers[0].reasonCode, 'UNRESOLVED_FIELDS');
});

test('可见 actionable MISSING_JSON 默认阻止自动离页', () => {
  const result = gate([field('MISSING_JSON', { visible: true, disabled: false })]);
  assert.equal(result.allowed, false);
  assert.equal(result.blockers[0].reasonCode, 'UNRESOLVED_FIELDS');
});

test('隐藏或 disabled 的 SKIPPED 不阻止栏目切换', () => {
  const result = gate([
    field('SKIPPED', { visible: false, hidden: true }),
    field('SKIPPED', { visible: true, disabled: true }),
  ]);
  assert.equal(result.allowed, true);
  assert.equal(result.blockers.length, 0);
});

test('文字“下一步”的动作永久归类为 FORM_PROGRESSION_USER_ONLY', () => {
  assert.equal(typeof Navigation.classifyNavigationIntent, 'function');
  const intent = Navigation.classifyNavigationIntent(fakeAction({ text: '下一步', inNavigation: true }));
  assert.equal(intent.kind, 'FORM_PROGRESSION');
  assert.equal(intent.allowed, false);
  assert.equal(intent.reasonCode, 'FORM_PROGRESSION_USER_ONLY');
});

test('aria-label=Next 的动作永久归类为 FORM_PROGRESSION_USER_ONLY', () => {
  const intent = Navigation.classifyNavigationIntent(fakeAction({ text: '→', ariaLabel: 'Next', inNavigation: true }));
  assert.equal(intent.kind, 'FORM_PROGRESSION');
  assert.equal(intent.allowed, false);
});

test('文案看似栏目但位于 form footer 的动作仍是 FORM_PROGRESSION', () => {
  const intent = Navigation.classifyNavigationIntent(fakeAction({
    text: '学习信息',
    dataStep: '3',
    inFooter: true,
  }));
  assert.equal(intent.kind, 'FORM_PROGRESSION');
  assert.equal(intent.allowed, false);
  assert.equal(intent.reasonCode, 'FORM_PROGRESSION_USER_ONLY');
});

test('用户明确 Skip 当前栏目后可继续到下一栏目', () => {
  const result = gate([
    field('NEEDS_CONFIRMATION'),
    field('MISSING_JSON'),
  ], { explicitUserSkip: true, navigationIntent: 'SECTION_NAVIGATION' });
  assert.equal(result.allowed, true);
  assert.equal(result.reasonCode, 'EXPLICIT_USER_SKIP');
  assert.equal(result.blockers.length, 0);
});

function minimalDocument() {
  const control = {
    tagName: 'INPUT', type: 'text', hidden: false, isConnected: true,
    getAttribute() { return ''; }, closest() { return null; },
    getBoundingClientRect() { return { width: 120, height: 32 }; },
  };
  const body = {
    nodeType: 1, isConnected: true,
    querySelector() { return control; },
    querySelectorAll() { return [control]; },
  };
  const document = {
    nodeType: 9,
    title: '通用申请系统',
    location: { href: 'https://school.test/apply/basic', origin: 'https://school.test' },
    body,
    documentElement: { nodeType: 1, childElementCount: 0 },
    defaultView: {
      getComputedStyle() { return { display: 'block', visibility: 'visible', opacity: '1' }; },
      requestAnimationFrame(callback) { return setTimeout(() => callback(Date.now()), 1); },
      cancelAnimationFrame(handle) { clearTimeout(handle); },
    },
    querySelector() { return null; },
    querySelectorAll() { return []; },
  };
  control.ownerDocument = document;
  return document;
}

function inMemoryTaskStore() {
  const normalize = task => TaskState.normalizeTaskState(task);
  return {
    async save(task) { return normalize(task); },
    async updateTask(task, updater) {
      const draft = JSON.parse(JSON.stringify(task));
      return normalize(updater(draft) || draft);
    },
    async updateSection(task, index, patch) {
      const draft = JSON.parse(JSON.stringify(task));
      draft.queue[index] = { ...draft.queue[index], ...patch };
      return normalize(draft);
    },
  };
}

test('runAll 被 unresolved fields 阻止后，只有用户明确 Skip 才继续下一栏', async () => {
  const document = minimalDocument();
  let navigateCount = 0;
  const navigation = {
    scan() { return [{ sectionId: 'basic', active: true, confidence: 0.98, safe: true }]; },
    buildQueue() { return []; },
    async navigate() { navigateCount += 1; return { ok: true, changed: true }; },
    destroy() {},
  };
  const adapter = {
    id: 'generic',
    navigation,
    detectCurrentSection() { return { section: 'basic', score: 98, label: '基本信息' }; },
    findContentRoot() { return document.body; },
    scanFields() { return []; },
    diagnose() { return {}; },
  };
  const engine = new Autofill.AutofillEngine({
    document,
    adapter,
    navigationEngine: navigation,
    taskStore: inMemoryTaskStore(),
    reportManager: new Reports.ReportManager(),
    formFiller: { async fillMatch() { throw new Error('不应执行字段写入'); } },
    saveHandler: { invalidate() {} },
  });
  const task = TaskState.createTask({
    taskId: 'task:progression-gate',
    scanId: 'scan:progression-gate',
    queue: [
      { sectionId: 'basic', label: '基本信息', confidence: 0.98, sectionSource: 'navigation', collection: 'basic', collectionMode: 'record' },
      { sectionId: 'education', label: '学习信息', confidence: 0.98, sectionSource: 'navigation', collection: 'education', collectionMode: 'singleton-view' },
    ],
  });
  const prepared = { taskId: task.taskId, scanId: task.scanId, task, queue: task.queue };
  const authorization = {
    taskId: task.taskId,
    scanId: task.scanId,
    nonce: 'authorization_progression_123456',
    userConfirmed: true,
    allowedSectionIds: ['basic', 'education'],
    filePolicy: 'auto-high-confidence',
    expiresAt: Date.now() + 60_000,
  };
  let sectionRuns = 0;
  engine.runSection = async sectionId => {
    sectionRuns += 1;
    const blocked = sectionId === 'basic';
    return {
      persistent: {
        sectionId,
        scanId: task.scanId,
        status: blocked ? 'manual_review' : 'completed',
        reasonCode: blocked ? 'MANUAL_REVIEW_REQUIRED' : 'SUCCESS',
        summary: blocked ? { total: 1, manualReview: 1 } : { total: 1, success: 1 },
        finishedAt: new Date().toISOString(),
        attempts: 1,
      },
      view: { items: [field(blocked ? 'NEEDS_CONFIRMATION' : 'SUCCESS')] },
    };
  };

  const run = engine.runAll({ prepared, authorization });
  const deadline = Date.now() + 2_000;
  while (engine.engineState !== Autofill.ENGINE_STATES.WAITING_USER && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.equal(sectionRuns, 1);
  assert.equal(navigateCount, 0);
  assert.equal(engine.engineState, Autofill.ENGINE_STATES.WAITING_USER);
  assert.equal(engine.snapshot().progressionBlocked, true);
  assert.equal(engine.snapshot().progressionBlockers[0].reasonCode, 'UNRESOLVED_FIELDS');

  engine.skipCurrent();
  const report = await run;
  assert.equal(sectionRuns, 2);
  assert.equal(navigateCount, 1);
  assert.equal(engine.engineState, Autofill.ENGINE_STATES.FINISHED);
  assert.equal(report.progressionBlocked, false);
  assert.equal(engine.task.queue[0].state, 'skipped');
  assert.equal(engine.task.results.find(result => result.sectionId === 'basic')?.reasonCode, 'EXPLICIT_USER_SKIP');
});

test('stop/skip 在 progression waiter 注册前到达也不会丢信号或悬挂', async () => {
  async function exercise(decision) {
    const document = minimalDocument();
    let navigateCount = 0;
    let reachedBlockedCommit;
    let releaseBlockedCommit;
    const blockedCommitReached = new Promise(resolve => { reachedBlockedCommit = resolve; });
    const blockedCommitRelease = new Promise(resolve => { releaseBlockedCommit = resolve; });
    let held = false;
    const normalize = task => TaskState.normalizeTaskState(task);
    const taskStore = {
      async save(task) { return normalize(task); },
      async updateTask(task, updater) {
        const draft = JSON.parse(JSON.stringify(task));
        const next = updater(draft) || draft;
        const blocked = next.results?.some(result => result.reasonCode === 'AUTO_PROGRESSION_BLOCKED');
        if (blocked && !held) {
          held = true;
          reachedBlockedCommit();
          await blockedCommitRelease;
        }
        return normalize(next);
      },
      async updateSection(task, index, patch) {
        const draft = JSON.parse(JSON.stringify(task));
        draft.queue[index] = { ...draft.queue[index], ...patch };
        return normalize(draft);
      },
    };
    const navigation = {
      scan() { return [{ sectionId: 'basic', active: true, confidence: 0.98, safe: true }]; },
      buildQueue() { return []; },
      async navigate() { navigateCount += 1; return { ok: true, changed: true }; },
      destroy() {},
    };
    const adapter = {
      id: 'generic', navigation,
      detectCurrentSection() { return { section: 'basic', score: 98, label: '基本信息' }; },
      findContentRoot() { return document.body; },
      scanFields() { return []; },
      diagnose() { return {}; },
    };
    const engine = new Autofill.AutofillEngine({
      document, adapter, navigationEngine: navigation, taskStore,
      reportManager: new Reports.ReportManager(),
      formFiller: { async fillMatch() { throw new Error('不应执行字段写入'); } },
      saveHandler: { invalidate() {} },
    });
    const task = TaskState.createTask({
      taskId: `task:progression-race-${decision}`,
      scanId: `scan:progression-race-${decision}`,
      queue: [
        { sectionId: 'basic', label: '基本信息', confidence: 0.98, sectionSource: 'navigation', collection: 'basic', collectionMode: 'record' },
        { sectionId: 'education', label: '学习信息', confidence: 0.98, sectionSource: 'navigation', collection: 'education', collectionMode: 'singleton-view' },
      ],
    });
    const prepared = { taskId: task.taskId, scanId: task.scanId, task, queue: task.queue };
    const authorization = {
      taskId: task.taskId, scanId: task.scanId,
      nonce: `authorization_race_${decision}_123456`, userConfirmed: true,
      allowedSectionIds: ['basic', 'education'], filePolicy: 'auto-high-confidence',
      expiresAt: Date.now() + 60_000,
    };
    let sectionRuns = 0;
    engine.runSection = async sectionId => {
      sectionRuns += 1;
      const blocked = sectionId === 'basic';
      return {
        persistent: {
          sectionId, scanId: task.scanId,
          status: blocked ? 'manual_review' : 'completed',
          reasonCode: blocked ? 'MANUAL_REVIEW_REQUIRED' : 'SUCCESS',
          summary: blocked ? { total: 1, manualReview: 1 } : { total: 1, success: 1 },
          finishedAt: new Date().toISOString(), attempts: 1,
        },
        view: { items: [field(blocked ? 'NEEDS_CONFIRMATION' : 'SUCCESS')] },
      };
    };

    const run = engine.runAll({ prepared, authorization });
    await Promise.race([
      blockedCommitReached,
      new Promise((_, reject) => setTimeout(() => reject(new Error('未到达 blocked commit')), 2_000)),
    ]);
    assert.equal(engine.progressionWaiters.length, 0, '信号发生时 waiter 尚未注册');
    if (decision === 'stop') engine.stop();
    else engine.skipCurrent();
    releaseBlockedCommit();
    const report = await Promise.race([
      run,
      new Promise((_, reject) => setTimeout(() => reject(new Error(`${decision} 后 runAll 悬挂`)), 2_000)),
    ]);
    return { engine, navigateCount, report, sectionRuns };
  }

  const stopped = await exercise('stop');
  assert.equal(stopped.engine.engineState, Autofill.ENGINE_STATES.STOPPED);
  assert.equal(stopped.navigateCount, 0);
  assert.equal(stopped.sectionRuns, 1);

  const skipped = await exercise('skip');
  assert.equal(skipped.engine.engineState, Autofill.ENGINE_STATES.FINISHED);
  assert.equal(skipped.navigateCount, 1);
  assert.equal(skipped.sectionRuns, 2);
  assert.equal(skipped.engine.task.queue[0].state, 'skipped');
  assert.equal(skipped.report.progressionBlocked, false);
});

test('UI 分离“可自动导航栏目”与当前页面/页面内区域统计', async () => {
  const [panelSource, popupSource, controllerSource] = await Promise.all([
    readFile(new URL('../../src/floating-ui/floating-panel.js', import.meta.url), 'utf8'),
    readFile(new URL('../../popup.js', import.meta.url), 'utf8'),
    readFile(new URL('../../src/content-controller.js', import.meta.url), 'utf8'),
  ]);
  assert.match(panelSource, /可自动导航栏目/);
  assert.match(panelSource, /页面内区域/);
  assert.match(popupSource, /可自动导航栏目/);
  assert.match(popupSource, /页面内区域/);
  assert.match(controllerSource, /embeddedSectionCount/);
  assert.doesNotMatch(panelSource, /id="section-count">0 个栏目/);
});

test('Progression blockers 诊断只保留 metadata，不导出值或 DOM', () => {
  const sanitized = Diagnostics.sanitize({
    progressionBlocked: true,
    progressionBlockers: [{
      status: 'CONFLICT',
      reasonCode: 'UNRESOLVED_FIELDS',
      field: 'basic.name',
      fieldName: '姓名',
      plannedValue: 'PRIVATE-EXPECTED',
      currentValue: 'PRIVATE-ACTUAL',
      beforeValue: 'PRIVATE-BEFORE',
      afterValue: 'PRIVATE-AFTER',
      element: { nodeType: 1, tagName: 'INPUT' },
    }],
  }).diagnosis;
  assert.equal(sanitized.progressionBlocked, true);
  assert.equal(sanitized.progressionBlockers.length, 1);
  assert.deepEqual(
    Object.keys(sanitized.progressionBlockers[0]).sort(),
    ['field', 'fieldName', 'reasonCode', 'status'],
  );
  assert.doesNotMatch(JSON.stringify(sanitized), /PRIVATE-|nodeType|tagName/);
});
