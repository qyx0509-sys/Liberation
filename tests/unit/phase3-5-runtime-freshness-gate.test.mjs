import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, '..', '..');
const EXPECTED_RUNTIME_REVISION = 'jiefang-page-runtime-v3';
const EXPECTED_RUNTIME_CAPABILITIES = Object.freeze([
  'runtime-snapshot-contract-v1',
  'required-globals-verified-v1',
]);

function parseInjectionFiles(source) {
  const declaration = String(source).match(
    /const\s+INJECTION_FILES\s*=\s*Object\.freeze\(\s*\[([\s\S]*?)\]\s*\);/,
  );
  assert.ok(declaration, 'popup must declare the canonical INJECTION_FILES list');
  return [...declaration[1].matchAll(/(['"])([^'"\r\n]+\.js)\1/g)]
    .map(match => match[2]);
}

function popupHarness(sendMessage) {
  const popupSource = readFileSync(resolve(projectRoot, 'popup.js'), 'utf8');
  const cutoff = popupSource.indexOf('function normalizedTaskState');
  assert.ok(cutoff > 0, 'popup test boundary must remain available');
  const executeCalls = [];
  const tab = Object.freeze({ id: 73, url: 'https://apply.example.invalid/basic' });
  const context = vm.createContext({
    console,
    setTimeout,
    clearTimeout,
    chrome: {
      tabs: {
        query: async () => [tab],
        sendMessage,
      },
      scripting: {
        executeScript: async details => { executeCalls.push(details); },
      },
    },
  });
  vm.runInContext(`${popupSource.slice(0, cutoff)}
globalThis.__popupRuntimeTest = Object.freeze({
  ensureController,
  injectionFiles: INJECTION_FILES,
  runtimeContract: typeof PAGE_RUNTIME_CONTRACT === 'object' ? PAGE_RUNTIME_CONTRACT : null,
});`, context, { filename: 'popup.js' });
  return { api: context.__popupRuntimeTest, executeCalls, tab };
}

function currentSnapshot() {
  return {
    schemaVersion: 1,
    runtimeRevision: EXPECTED_RUNTIME_REVISION,
    runtimeCapabilities: [...EXPECTED_RUNTIME_CAPABILITIES],
  };
}

test('popup hard-fails a reachable legacy controller and never blindly reinjects a second listener', async () => {
  const harness = popupHarness(async () => ({ ok: true, snapshot: { schemaVersion: 1 } }));

  await assert.rejects(
    () => harness.api.ensureController(),
    error => {
      assert.match(String(error?.message), /版本不一致/);
      assert.match(String(error?.message), /刷新页面/);
      assert.match(String(error?.message), /不会自动重新注入/);
      return true;
    },
  );
  assert.deepEqual(harness.executeCalls, []);
});

test('popup accepts the current controller handshake without injecting again', async () => {
  const harness = popupHarness(async () => ({ ok: true, snapshot: currentSnapshot() }));

  const tab = await harness.api.ensureController();

  assert.equal(tab.id, harness.tab.id);
  assert.deepEqual(harness.executeCalls, []);
  assert.deepEqual(
    JSON.parse(JSON.stringify(harness.api.runtimeContract)),
    {
      revision: EXPECTED_RUNTIME_REVISION,
      requiredCapabilities: [...EXPECTED_RUNTIME_CAPABILITIES],
    },
  );
});

test('popup rejects an explicit runtime revision mismatch without reinjection', async () => {
  const stale = { ...currentSnapshot(), runtimeRevision: 'jiefang-page-runtime-obsolete' };
  const harness = popupHarness(async () => ({ ok: true, snapshot: stale }));

  await assert.rejects(
    () => harness.api.ensureController(),
    error => /版本不一致.*刷新页面.*不会自动重新注入/.test(String(error?.message)),
  );
  assert.deepEqual(harness.executeCalls, []);
});

test('popup injects only when no controller exists and validates the post-injection handshake', async () => {
  let messageCount = 0;
  const harness = popupHarness(async () => {
    messageCount += 1;
    if (messageCount === 1) throw new Error('Could not establish connection. Receiving end does not exist.');
    return { ok: true, snapshot: currentSnapshot() };
  });

  await harness.api.ensureController();

  assert.equal(harness.executeCalls.length, 1);
  assert.deepEqual(
    Array.from(harness.executeCalls[0].files),
    JSON.parse(JSON.stringify(harness.api.injectionFiles)),
  );
});

test('popup does not treat an arbitrary messaging failure as proof that no controller exists', async () => {
  const harness = popupHarness(async () => {
    throw new Error('The tab was closed while sending a message.');
  });

  await assert.rejects(
    () => harness.api.ensureController(),
    error => /tab was closed/i.test(String(error?.message)),
  );
  assert.deepEqual(harness.executeCalls, []);
});

test('production popup module list is unique and preserves browser-global dependency order', () => {
  const source = readFileSync(resolve(projectRoot, 'popup.js'), 'utf8');
  const files = parseInjectionFiles(source);
  assert.equal(new Set(files).size, files.length, 'production injection paths must be unique');

  const before = (dependency, consumer) => {
    const dependencyIndex = files.indexOf(dependency);
    const consumerIndex = files.indexOf(consumer);
    assert.ok(dependencyIndex >= 0, `missing browser dependency: ${dependency}`);
    assert.ok(consumerIndex >= 0, `missing browser consumer: ${consumer}`);
    assert.ok(dependencyIndex < consumerIndex, `${dependency} must load before ${consumer}`);
  };

  before('src/mappings/field-aliases.js', 'src/core/field-matcher.js');
  before('src/semantics/field-semantic-normalizer.js', 'src/core/field-matcher.js');
  before('src/core/safety.js', 'src/controls/adapters/cascader-adapter.js');
  before('src/core/event-dispatcher.js', 'src/controls/adapters/date-like-adapter.js');
  before('src/core/verification-engine.js', 'src/controls/adapters/cascader-adapter.js');
  before('src/controls/control-adapter-registry.js', 'src/controls/adapters/date-like-adapter.js');
  before('src/adapters/generic.js', 'src/core/array-handler.js');
  before('src/core/array-handler.js', 'src/core/autofill-engine.js');
  before('src/core/autofill-engine.js', 'src/content-controller.js');
  before('src/content-app.js', 'src/content-controller.js');
  before('src/content-controller.js', 'content.js');
});

test('built dist runtime loads in production order and exposes a current dependency-complete controller', () => {
  const distRoot = resolve(projectRoot, 'dist');
  const popupSource = readFileSync(resolve(distRoot, 'popup.js'), 'utf8');
  const files = parseInjectionFiles(popupSource);
  const throughController = files.slice(0, files.indexOf('src/content-controller.js') + 1);
  assert.equal(throughController.at(-1), 'src/content-controller.js');

  const quietConsole = Object.freeze({ log() {}, info() {}, warn() {}, error() {} });
  const context = vm.createContext({
    console: quietConsole,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    URL,
    URLSearchParams,
    AbortController,
    DOMException,
    TextEncoder,
    TextDecoder,
  });
  for (const relativePath of throughController) {
    const source = readFileSync(resolve(distRoot, relativePath), 'utf8');
    vm.runInContext(source, context, { filename: `dist/${relativePath}` });
  }

  const requiredGlobals = [
    'JFAutofillEngine', 'JFFloatingPanel', 'JFSiteProfile', 'JFAdapterRegistry', 'JFGenericAdapter',
    'JFNavigationEngine', 'JFCurrentSectionResolver', 'JFFieldContext', 'JFFieldDetector',
    'JFFieldMatcher', 'JFFormFiller', 'JFArrayHandler', 'JFPageReady', 'JFTaskState',
    'JFReportManager', 'JFBooleanSemanticAdapter', 'JFSemanticVerification', 'JFDiagnosticSanitizer',
    'JFOptionAliases', 'JFDateRules', 'JFEventDispatcher', 'JFVerificationEngine',
    'JFControlAdapterRegistry', 'JFNativeValueAdapter', 'JFNativeSelectAdapter', 'JFChoiceAdapter',
    'JFCascaderAdapter', 'JFCustomSelectAdapter', 'JFDateLikeAdapter', 'JFCompoundPickerAdapter',
    'JFLocalApp', 'JFContentController',
  ];
  for (const globalName of requiredGlobals) {
    assert.ok(context[globalName], `dist browser runtime did not expose ${globalName}`);
  }
  assert.equal(typeof context.JFAutofillEngine.AutofillEngine, 'function');
  assert.equal(typeof context.JFContentController.buildSnapshot, 'function');

  const snapshot = context.JFContentController.buildSnapshot();
  assert.equal(snapshot.runtimeRevision, EXPECTED_RUNTIME_REVISION);
  assert.deepEqual(
    Array.from(snapshot.runtimeCapabilities || []),
    [...EXPECTED_RUNTIME_CAPABILITIES],
  );
});
