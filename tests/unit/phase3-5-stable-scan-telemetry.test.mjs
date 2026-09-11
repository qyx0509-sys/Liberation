import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const ROOT = resolve(import.meta.dirname, '..', '..');
const CONTROLLER_PATH = resolve(ROOT, 'src', 'content-controller.js');
const AUTOFILL_ENGINE_PATH = resolve(ROOT, 'src', 'core', 'autofill-engine.js');
const DIAGNOSTIC_SANITIZER_PATH = resolve(ROOT, 'src', 'core', 'diagnostic-sanitizer.js');
const POPUP_PATH = resolve(ROOT, 'popup.js');
const Autofill = require(AUTOFILL_ENGINE_PATH);
const DiagnosticSanitizer = require(DIAGNOSTIC_SANITIZER_PATH);

const REQUIRED_GLOBALS = [
  'JFAutofillEngine', 'JFFloatingPanel', 'JFSiteProfile', 'JFAdapterRegistry', 'JFGenericAdapter',
  'JFNavigationEngine', 'JFCurrentSectionResolver', 'JFFieldContext', 'JFFieldDetector', 'JFFieldMatcher',
  'JFFormFiller', 'JFArrayHandler', 'JFPageReady', 'JFTaskState', 'JFReportManager',
  'JFBooleanSemanticAdapter', 'JFSemanticVerification', 'JFDiagnosticSanitizer', 'JFOptionAliases',
  'JFDateRules', 'JFEventDispatcher', 'JFVerificationEngine', 'JFControlAdapterRegistry',
  'JFNativeValueAdapter', 'JFNativeSelectAdapter', 'JFChoiceAdapter', 'JFCascaderAdapter',
  'JFCustomSelectAdapter', 'JFDateLikeAdapter', 'JFCompoundPickerAdapter',
  'JFUI', 'JFProfileCoverage', 'JFReviewPresenter',
];

function inspection(scanId, rawObservation) {
  const observation = typeof rawObservation === 'number'
    ? { detected: rawObservation, reliable: rawObservation, embedded: 0 }
    : { ...(rawObservation || {}) };
  const fieldCount = Math.max(0, Number(observation.detected || 0));
  const reliableFieldCount = Math.max(0, Math.min(fieldCount, Number(observation.reliable || 0)));
  const embeddedSectionCount = Math.max(0, Number(observation.embedded || 0));
  const fields = Array.from({ length: fieldCount }, (_, index) => ({
    id: `field-${index}`,
    type: 'text',
    labelText: `字段 ${index}`,
    context: { collection: 'basic', collectionMode: 'record' },
    element: { privateValue: `PRIVATE_FIELD_${index}` },
  }));
  return {
    scanId,
    scan: [],
    queue: [],
    current: { section: 'basic', sectionId: 'basic', label: '基本信息' },
    sectionContext: {
      sectionId: 'basic',
      collection: 'basic',
      collectionMode: 'record',
      regionCandidates: Array.from({ length: embeddedSectionCount }, (_, index) => ({
        sectionId: ['family', 'internships', 'papers', 'awards'][index] || `other-${index}`,
        collection: ['family', 'internships', 'papers', 'awards'][index] || `other-${index}`,
        collectionMode: 'repeatable',
        groupCount: Number(observation.topologyVariant || 0) + index,
        zeroRow: index >= 2,
      })),
    },
    fields,
    matches: fields.map((field, index) => ({
      field,
      matchedPath: `${observation.pathRoot || 'basic.field'}${index}`,
      status: observation.matchStatus || (index < reliableFieldCount ? 'MATCHED' : 'UNMATCHED'),
    })),
    reliableFieldCount,
  };
}

async function withController(fieldCounts, run, options = {}) {
  const harnessOptions = options;
  const originals = new Map();
  for (const name of [...REQUIRED_GLOBALS, 'chrome', 'document', 'location', 'JFContentController']) {
    originals.set(name, Object.prototype.hasOwnProperty.call(globalThis, name)
      ? { present: true, value: globalThis[name] }
      : { present: false });
  }

  const updates = [];
  const logs = [];
  let inspectCalls = 0;
  let stabilityCalls = 0;
  let engineInstance = null;
  const stabilityOptions = [];
  const scanId = 'scan:stable-telemetry';

  class FakeEngine {
    constructor(options = {}) {
      this.callbacks = options.callbacks || {};
      this.scanId = '';
      this.engineState = 'IDLE';
      this.currentAction = '';
      this.resumeView = harnessOptions.resumeView || {};
      this.materials = [];
      this.preferences = {};
      this.task = null;
      this.taskStore = { load: async () => null };
      this.navigation = { startWatching() {} };
      engineInstance = this;
    }

    async refreshData() {}

    diagnoseCurrent() {
      return {
        schemaVersion: 2,
        fields: [],
        fileFields: [],
        embeddedSections: [],
        groups: [],
        buttons: [],
        saveCandidates: [],
        warnings: [],
        navigation: { items: [] },
      };
    }

    async resetRecognition() {
      if (!['IDLE', 'ERROR'].includes(this.engineState)) {
        throw new Error('RESET_BLOCKED_WHILE_SCANNING');
      }
      this.scanId = scanId;
      this.engineState = 'IDLE';
      return scanId;
    }

    async inspectSystem({ scanId: requestedScanId } = {}) {
      this.scanId = requestedScanId || scanId;
      this.engineState = 'SCANNING_NAVIGATION';
      const observation = fieldCounts[Math.min(inspectCalls, fieldCounts.length - 1)] ?? 0;
      inspectCalls += 1;
      if (observation instanceof Error) {
        this.engineState = 'ERROR';
        throw observation;
      }
      const result = inspection(this.scanId, observation);
      this.engineState = 'IDLE';
      this.currentAction = `当前页面有 ${result.reliableFieldCount} 个可可靠匹配字段。`;
      this.callbacks.onState?.(this.snapshot());
      return result;
    }

    snapshot() {
      return { scanId: this.scanId, state: this.engineState, currentAction: this.currentAction };
    }
  }

  try {
    for (const name of REQUIRED_GLOBALS) globalThis[name] = {};
    globalThis.JFAutofillEngine = { AutofillEngine: FakeEngine };
    globalThis.JFDiagnosticSanitizer = DiagnosticSanitizer;
    globalThis.JFFloatingPanel = {
      async create() {
        return {
          host: { isConnected: true },
          update(snapshot) { updates.push(structuredClone(snapshot)); },
          log(message) { logs.push(String(message)); },
          async show() {},
          persist() {},
        };
      },
    };
    globalThis.JFPageReady = {
      async waitForDOMStable(waitOptions = {}) {
        stabilityOptions.push({ ...waitOptions });
        const result = options.stabilityResults?.[
          Math.min(stabilityCalls, Math.max(0, (options.stabilityResults?.length || 1) - 1))
        ] || { ok: true, stable: true, reason: 'DOM_QUIET', mutationCount: 1 };
        stabilityCalls += 1;
        if (Number(result.waitMs || 0) > 0) {
          await new Promise(resolveDelay => setTimeout(resolveDelay, Number(result.waitMs)));
        }
        return { ...result };
      },
    };
    globalThis.JFTaskState = {
      FINAL_STATES: new Set(),
      createScanId: () => scanId,
    };
    globalThis.chrome = {
      runtime: { lastError: null, onMessage: { addListener() {} }, id: 'test-extension' },
      storage: { local: { get(_keys, callback) { callback({}); }, set(_value, callback) { callback?.(); } } },
    };
    globalThis.document = { title: 'Sanitized delayed form' };
    globalThis.location = { origin: 'https://example.invalid' };

    delete require.cache[require.resolve(CONTROLLER_PATH)];
    const controller = require(CONTROLLER_PATH);
    await controller.mount();
    return await run({
      controller,
      updates,
      logs,
      get inspectCalls() { return inspectCalls; },
      get stabilityCalls() { return stabilityCalls; },
      getInspectCalls: () => inspectCalls,
      getStabilityCalls: () => stabilityCalls,
      stabilityOptions,
      engine: engineInstance,
    });
  } finally {
    delete require.cache[require.resolve(CONTROLLER_PATH)];
    for (const [name, original] of originals) {
      if (original.present) globalThis[name] = original.value;
      else delete globalThis[name];
    }
  }
}

test('Stable Scan: initial 0 is provisional and final READY summary refreshes to 22 fields', async () => {
  await withController([0, 22], async ({ controller, updates, logs }) => {
    const snapshot = await controller.scanSystem({
      stabilizationDelayMs: 0,
      stabilizationMaxMs: 80,
      stabilizationMaxAttempts: 2,
    });

    assert.equal(snapshot.detectedFieldCount, 22);
    assert.equal(snapshot.reliableFieldCount, 22);
    assert.equal(snapshot.scanPhase, 'READY');
    assert.equal(snapshot.scanCountsFinal, true);
    assert.equal(snapshot.scanAttemptCount, 2);
    const scanUpdates = updates.slice(updates.findIndex(item => item.scanPhase === 'SCANNING'));
    assert.deepEqual(
      [...new Set(scanUpdates.map(item => item.scanPhase).filter(Boolean))],
      ['SCANNING', 'STABILIZING', 'READY'],
    );
    assert.ok(logs.some(line => /22/.test(line)), 'final log must publish the stable count');
    assert.ok(!logs.some(line => /0\s*个当前页可靠字段|reliable fields?\s*[:=]?\s*0/i.test(line)), 'provisional zero must not be logged as final');
    assert.ok(
      !scanUpdates.some(item => item.scanCountsFinal === false && /0\s*个可可靠匹配字段/.test(item.currentAction || '')),
      'engine callbacks must not overwrite the provisional waiting message with a zero summary',
    );
  });
});

test('Stable Scan: bounded retry finishes READY when the page remains empty', async () => {
  await withController([0, 0, 0], async ({ controller, updates }) => {
    const startedAt = Date.now();
    const snapshot = await controller.scanSystem({
      stabilizationDelayMs: 0,
      stabilizationMaxMs: 50,
      stabilizationMaxAttempts: 2,
    });

    assert.ok(Date.now() - startedAt < 500, 'test override must prove bounded completion');
    assert.equal(snapshot.detectedFieldCount, 0);
    assert.equal(snapshot.scanPhase, 'READY');
    assert.equal(snapshot.scanCountsFinal, true);
    assert.equal(snapshot.scanReasonCode, 'BOUNDED_EMPTY_SCAN');
    assert.ok(updates.some(item => item.scanPhase === 'STABILIZING'));
  });
});

test('Stable Scan: embedded topology with provisional reliable=0 extends only after dynamic evidence and finalizes the later usable scan', async () => {
  await withController([
    { detected: 6, reliable: 0, embedded: 4 },
    { detected: 6, reliable: 0, embedded: 4 },
    { detected: 6, reliable: 6, embedded: 4 },
  ], async ({ controller, updates, getInspectCalls }) => {
    const snapshot = await controller.scanSystem({
      stabilizationDelayMs: 0,
      stabilizationMaxMs: 50,
      stabilizationAdaptiveMaxMs: 160,
      stabilizationMaxAttempts: 3,
    });

    assert.equal(getInspectCalls(), 3, 'observed mutation must unlock the bounded adaptive rescan window');
    assert.equal(snapshot.detectedFieldCount, 6);
    assert.equal(snapshot.reliableFieldCount, 6);
    assert.equal(snapshot.embeddedSectionCount, 4);
    assert.equal(snapshot.scanPhase, 'READY');
    assert.equal(snapshot.scanCountsFinal, true);
    assert.equal(snapshot.scanReasonCode, 'STABLE_RESCAN');
    assert.deepEqual(snapshot.scanTelemetryDebug, {
      phase: 'READY',
      attemptCount: 3,
      detectedFieldCount: 6,
      reliableFieldCount: 6,
      embeddedSectionCount: 4,
      topologyChanged: false,
      fieldSignatureChanged: true,
      resumeAvailable: true,
      finalizationReason: 'STABLE_RESCAN',
    });

    const provisional = updates.find(item => item.scanPhase === 'STABILIZING');
    assert.equal(provisional?.scanCountsFinal, false);
    assert.equal(provisional?.scanTelemetryDebug?.reliableFieldCount, 0);
    assert.equal(provisional?.scanTelemetryDebug?.embeddedSectionCount, 4);
  }, {
    resumeView: { basic: { name: '仅用于证明资料已加载' } },
    stabilityResults: [
      { ok: false, stable: false, reason: 'TIMEOUT', mutationCount: 2, waitMs: 65 },
      { ok: true, stable: true, reason: 'DOM_QUIET', mutationCount: 1 },
    ],
  });
});

test('Stable Scan: topologyChanged reflects structural signature changes rather than any DOM mutation', async () => {
  await withController([
    { detected: 2, reliable: 0, embedded: 4, topologyVariant: 0 },
    { detected: 2, reliable: 0, embedded: 4, topologyVariant: 1 },
  ], async ({ controller }) => {
    const snapshot = await controller.scanSystem({
      stabilizationDelayMs: 0,
      stabilizationMaxMs: 50,
      stabilizationAdaptiveMaxMs: 120,
      stabilizationMaxAttempts: 2,
    });

    assert.equal(snapshot.scanTelemetryDebug.topologyChanged, true);
    assert.equal(snapshot.scanTelemetryDebug.fieldSignatureChanged, false);
  }, {
    resumeView: { basic: { name: '资料存在' } },
    stabilityResults: [{ ok: true, stable: true, reason: 'DOM_QUIET', mutationCount: 0 }],
  });
});

test('Stable Scan: a stable detected-but-unreliable result is a final zero with an explicit reason', async () => {
  await withController([
    { detected: 5, reliable: 0, embedded: 4 },
    { detected: 5, reliable: 0, embedded: 4 },
  ], async ({ controller }) => {
    const snapshot = await controller.scanSystem({
      stabilizationDelayMs: 0,
      stabilizationMaxMs: 40,
      stabilizationAdaptiveMaxMs: 80,
      stabilizationMaxAttempts: 2,
    });

    assert.equal(snapshot.scanPhase, 'READY');
    assert.equal(snapshot.scanCountsFinal, true);
    assert.equal(snapshot.detectedFieldCount, 5);
    assert.equal(snapshot.reliableFieldCount, 0);
    assert.equal(snapshot.scanReasonCode, 'BOUNDED_UNRELIABLE_SCAN');
    assert.equal(snapshot.scanTelemetryDebug.finalizationReason, 'BOUNDED_UNRELIABLE_SCAN');
  }, {
    resumeView: { basic: { name: '资料存在' } },
    stabilityResults: [{ ok: true, stable: true, reason: 'ALREADY_STABLE', mutationCount: 0 }],
  });
});

test('Stable Scan: canonical matchedPath changes are part of the field signature even when count and status stay equal', async () => {
  await withController([
    { detected: 2, reliable: 0, embedded: 4, matchStatus: 'MISSING_JSON', pathRoot: 'basic.field' },
    { detected: 2, reliable: 0, embedded: 4, matchStatus: 'MISSING_JSON', pathRoot: 'education.field' },
  ], async ({ controller }) => {
    const snapshot = await controller.scanSystem({
      stabilizationDelayMs: 0,
      stabilizationMaxMs: 50,
      stabilizationAdaptiveMaxMs: 120,
      stabilizationMaxAttempts: 2,
    });

    assert.equal(snapshot.detectedFieldCount, 2);
    assert.equal(snapshot.reliableFieldCount, 0);
    assert.equal(snapshot.scanTelemetryDebug.fieldSignatureChanged, true);
  }, {
    resumeView: { education: [{ school: '资料存在' }] },
    stabilityResults: [{ ok: true, stable: true, reason: 'ALREADY_STABLE', mutationCount: 0 }],
  });
});

test('Stable Scan: inspection errors leave READY/SCAN_FAILED without claiming final counts before rethrow', async () => {
  await withController([new Error('SANITIZED_SCAN_FAILURE')], async ({ controller, updates }) => {
    await assert.rejects(
      controller.scanSystem({ stabilizationDelayMs: 0 }),
      /SANITIZED_SCAN_FAILURE/,
    );

    const snapshot = controller.buildSnapshot();
    assert.equal(snapshot.scanPhase, 'READY');
    assert.equal(snapshot.scanCountsFinal, false);
    assert.equal(snapshot.scanReasonCode, 'SCAN_FAILED');
    assert.equal(snapshot.detectedFieldCount, 0);
    assert.equal(snapshot.reliableFieldCount, 0);
    assert.equal(updates.at(-1)?.scanPhase, 'READY');
    assert.equal(updates.at(-1)?.scanReasonCode, 'SCAN_FAILED');
    assert.equal(updates.at(-1)?.scanCountsFinal, false);
  });
});

test('Stable Scan: a stabilization rescan error is final and a later user rescan can recover', async () => {
  await withController([0, new Error('SANITIZED_RESCAN_FAILURE'), 22], async ({ controller }) => {
    await assert.rejects(
      controller.scanSystem({
        stabilizationDelayMs: 0,
        stabilizationMaxMs: 80,
        stabilizationMaxAttempts: 2,
      }),
      /SANITIZED_RESCAN_FAILURE/,
    );
    assert.equal(controller.buildSnapshot().scanPhase, 'READY');
    assert.equal(controller.buildSnapshot().scanReasonCode, 'SCAN_FAILED');

    const recovered = await controller.scanSystem({ stabilizationDelayMs: 0 });
    assert.equal(recovered.scanPhase, 'READY');
    assert.equal(recovered.scanReasonCode, 'INITIAL_SCAN_READY');
    assert.equal(recovered.reliableFieldCount, 22);
  });
});

test('Stable Scan: the production engine preserves the scan error and enters a resettable terminal state', async () => {
  const originalError = new Error('SANITIZED_PRODUCTION_SCAN_FAILURE');
  let scanCalls = 0;
  let document;
  const control = {
    hidden: false,
    isConnected: true,
    getAttribute() { return null; },
    closest() { return null; },
    getBoundingClientRect() { return { width: 10, height: 10 }; },
  };
  const root = {
    nodeType: 1,
    querySelectorAll(selector) {
      return /input|textarea|select|combobox|contenteditable/.test(selector) ? [control] : [];
    },
    querySelector() { return null; },
    getAttribute() { return null; },
    contains() { return false; },
  };
  document = {
    nodeType: 9,
    title: 'Sanitized scan recovery probe',
    body: root,
    documentElement: root,
    defaultView: {
      getComputedStyle() { return { display: 'block', visibility: 'visible' }; },
    },
    querySelectorAll(selector) { return root.querySelectorAll(selector); },
    querySelector() { return null; },
  };
  root.ownerDocument = document;
  control.ownerDocument = document;
  const engine = new Autofill.AutofillEngine({
    document,
    adapter: {
      detectCurrentSection() {
        return { section: 'basic', source: 'adapter', score: 1, label: 'Basic' };
      },
      findContentRoot() { return root; },
      scanFields() { return []; },
    },
    navigationEngine: {
      scan() {
        scanCalls += 1;
        if (scanCalls === 1) throw originalError;
        return [];
      },
      buildQueue() { return []; },
      invalidate() {},
    },
    formFiller: {},
    reportManager: { clear() {} },
    taskStore: {
      async clear() {},
      async load() { return null; },
    },
    saveHandler: { invalidate() {} },
    callbacks: {
      onState(snapshot) {
        if (snapshot.state === Autofill.ENGINE_STATES.ERROR) {
          throw new Error('SANITIZED_STATE_CALLBACK_FAILURE');
        }
      },
    },
  });

  await assert.rejects(
    engine.inspectSystem({ scanId: 'scan:production-recovery' }),
    error => error === originalError,
  );
  assert.equal(engine.engineState, Autofill.ENGINE_STATES.ERROR);

  const nextScanId = await engine.resetRecognition();
  assert.match(nextScanId, /^scan[:_]/);
  assert.notEqual(nextScanId, 'scan:production-recovery');
  assert.equal(engine.engineState, Autofill.ENGINE_STATES.IDLE);

  const recovered = await engine.inspectSystem({ scanId: nextScanId, timeoutMs: 100 });
  assert.equal(recovered.scanId, nextScanId);
  assert.equal(recovered.reliableFieldCount, 0);
  assert.equal(scanCalls, 2);
  assert.equal(engine.engineState, Autofill.ENGINE_STATES.IDLE);
});

test('Stable Scan telemetry is metadata-only and never contains descriptors or field values', async () => {
  await withController([0, 22], async ({ controller, updates }) => {
    const snapshot = await controller.scanSystem({
      stabilizationDelayMs: 0,
      stabilizationMaxMs: 80,
      stabilizationMaxAttempts: 2,
    });
    const serialized = JSON.stringify({ snapshot, updates });
    assert.doesNotMatch(serialized, /PRIVATE_FIELD_/);
    for (const key of ['scanPhase', 'scanCountsFinal', 'scanAttemptCount', 'scanReasonCode']) {
      assert.ok(Object.hasOwn(snapshot, key), `missing telemetry key ${key}`);
    }
    assert.deepEqual(
      Object.keys(snapshot.scanTelemetryDebug).sort(),
      [
        'attemptCount',
        'detectedFieldCount',
        'embeddedSectionCount',
        'fieldSignatureChanged',
        'finalizationReason',
        'phase',
        'reliableFieldCount',
        'resumeAvailable',
        'topologyChanged',
      ],
    );
    const diagnosticResult = await controller.runDiagnosis();
    assert.deepEqual(diagnosticResult.diagnosis.scanTelemetryDebug, snapshot.scanTelemetryDebug);
  });
});

test('Popup renders provisional scan state without presenting zero as final and publishes final reliable count', async () => {
  const source = await readFile(POPUP_PATH, 'utf8');
  const cutoff = source.indexOf('async function start(scope)');
  assert.ok(cutoff > 0, 'popup scan boundary must remain discoverable');

  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) {
      nodes.set(id, {
        id,
        textContent: '',
        className: '',
        innerHTML: '',
        disabled: false,
        style: {},
        setAttribute() {},
        removeAttribute() {},
        getAttribute() { return null; },
        classList: { add() {}, remove() {} },
      });
    }
    return nodes.get(id);
  };
  let resolveScan;
  const scanResponse = new Promise(resolveResponse => { resolveScan = resolveResponse; });
  const context = vm.createContext({
    console,
    setTimeout,
    clearTimeout,
    document: { getElementById: node },
    chrome: {
      tabs: {
        async query() { return [{ id: 7, url: 'https://example.invalid/application' }]; },
        async sendMessage(_tabId, message) {
          if (message?.type === 'GET_SYSTEM_SNAPSHOT') {
            return {
              ok: true,
              snapshot: {
                runtimeRevision: 'jiefang-page-runtime-v3',
                runtimeCapabilities: ['runtime-snapshot-contract-v1', 'required-globals-verified-v1'],
              },
            };
          }
          if (message?.type === 'SCAN_SYSTEM') return scanResponse;
          throw new Error(`unexpected popup message: ${message?.type}`);
        },
      },
      scripting: { async executeScript() {} },
    },
  });
  for (const file of ['design-system.js', 'profile-coverage.js']) {
    vm.runInContext(await readFile(resolve(ROOT, 'src/ui', file), 'utf8'), context);
  }
  vm.runInContext(`${source.slice(0, cutoff)}
globalThis.__popupStableScanTest = Object.freeze({
  scan,
  render,
  setSnapshot(next) { snapshot = next; render(); },
  getSnapshot() { return snapshot; },
});`, context, { filename: 'popup.js' });

  context.__popupStableScanTest.setSnapshot({
    scanPhase: 'READY',
    scanCountsFinal: true,
    scanReasonCode: 'BOUNDED_EMPTY_SCAN',
    sectionQueue: [],
    detectedFieldCount: 0,
    reliableFieldCount: 0,
    embeddedSectionCount: 0,
  });
  const pending = context.__popupStableScanTest.scan();
  await new Promise(resolveTurn => setImmediate(resolveTurn));

  assert.equal(node('system-badge').textContent, '检查中');
  assert.match(node('system-meta').textContent, /当前计数不会作为最终结果/);
  assert.doesNotMatch(node('system-badge').textContent, /可自动导航栏目：0/);

  resolveScan({
    ok: true,
    snapshot: {
      scanPhase: 'READY',
      scanCountsFinal: true,
      scanReasonCode: 'STABLE_RESCAN',
      sectionQueue: [{ sectionId: 'basic', label: '基本信息', status: 'CURRENT' }],
      sectionCount: 1,
      detectedFieldCount: 10,
      reliableFieldCount: 8,
      embeddedSectionCount: 4,
    },
  });
  await pending;

  assert.equal(node('system-badge').textContent, '已检查');
  assert.match(node('system-meta').textContent, /8 项可自动处理 · 4 个页面内区域/);
});
