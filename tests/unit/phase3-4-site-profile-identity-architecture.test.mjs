import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(here, '../..');
const TaskState = require('../../src/core/task-state.js');
const Reports = require('../../src/core/report-manager.js');
const Generic = require('../../src/adapters/generic-adapter.js');
const DiagnosticSanitizer = require('../../src/core/diagnostic-sanitizer.js');
const Autofill = require('../../src/core/autofill-engine.js');

let SiteProfile = null;
let siteProfileLoadError = null;
try {
  SiteProfile = require('../../src/adapters/site-profile.js');
} catch (error) {
  siteProfileLoadError = error;
}

function siteProfileApi(...methods) {
  assert.equal(siteProfileLoadError, null, 'Phase 3.4 必须提供 src/adapters/site-profile.js');
  methods.forEach(method => assert.equal(typeof SiteProfile?.[method], 'function', `JFSiteProfile.${method} 必须存在`));
  return SiteProfile;
}

function profile() {
  return {
    schemaVersion: 2,
    id: 'identity-contract',
    revision: 'identity-r3',
    enabled: true,
    priority: 30,
    match: {
      origins: ['https://apply.example.invalid'],
      urlPrefixes: ['https://apply.example.invalid/application/'],
      urlPatterns: [],
    },
    config: {},
  };
}

function identityFrom(value) {
  const source = value?.siteProfile || value?.profileIdentity || value?.profile || value || {};
  return {
    id: source.id || value?.siteProfileId || value?.profileId || '',
    revision: source.revision || value?.siteProfileRevision || value?.profileRevision || '',
  };
}

function minimalDocument() {
  const document = {
    nodeType: 9,
    title: 'Identity Contract',
    location: {
      origin: 'https://apply.example.invalid',
      href: 'https://apply.example.invalid/application/basic',
    },
    body: null,
    documentElement: { nodeType: 1, childElementCount: 0 },
    defaultView: {
      getComputedStyle() { return { display: 'block', visibility: 'visible', opacity: '1' }; },
    },
    querySelector() { return null; },
    querySelectorAll() { return []; },
  };
  document.body = {
    nodeType: 1,
    isConnected: true,
    ownerDocument: document,
    closest() { return null; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
  };
  return document;
}

function sourceFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...sourceFiles(path));
    else if (entry.isFile() && ['.js', '.mjs'].includes(extname(entry.name))) files.push(path);
  }
  return files;
}

function occurrences(source, needle) {
  return source.split(needle).length - 1;
}

test('规范 Profile 的 id/revision 是纯数据 identity，不携带 DOM 或可执行能力', () => {
  const module = siteProfileApi('normalizeProfile');
  const normalized = module.normalizeProfile(profile());
  assert.equal(normalized.id, 'identity-contract');
  assert.equal(normalized.revision, 'identity-r3');
  assert.equal(Object.hasOwn(normalized, 'element'), false);
  assert.equal(Object.hasOwn(normalized, 'document'), false);
  assert.doesNotThrow(() => JSON.stringify(normalized));
});

test('Generic diagnosis 携带本次实际 Profile identity，便于后续适配复现', () => {
  const document = minimalDocument();
  const selectedProfile = profile();
  const adapter = Generic.createAdapter(document, {
    profile: selectedProfile,
    config: {},
    navigationEngine: {
      scan() { return []; },
      scanDetailed() { return { items: [], candidates: [] }; },
    },
  });
  const diagnosis = adapter.diagnose();

  assert.equal(diagnosis.siteProfile?.matched, true);
  assert.equal(diagnosis.siteProfile?.id, 'identity-contract');
  assert.equal(diagnosis.siteProfile?.revision, 'identity-r3');
  assert.equal(typeof diagnosis.siteProfile?.source, 'string');
  assert.ok(diagnosis.siteProfile.source.length > 0);
  assert.equal(typeof diagnosis.siteProfile?.resolution, 'string');
  assert.ok(diagnosis.siteProfile.resolution.length > 0);
  const sanitized = DiagnosticSanitizer.sanitize(diagnosis).diagnosis;
  assert.deepEqual(sanitized.siteProfile, diagnosis.siteProfile);
});

test('Generic/ambiguous Profile diagnosis 保持 metadata-only identity 与警告，不携带配置正文', () => {
  const document = minimalDocument();
  const generic = Generic.createAdapter(document, {
    config: {
      siteProfile: { matched: false, id: '', revision: '', source: 'storage', resolution: 'GENERIC' },
    },
    navigationEngine: { scan() { return []; }, scanDetailed() { return { items: [], candidates: [] }; } },
  }).diagnose();
  assert.deepEqual(generic.siteProfile, {
    matched: false, id: '', revision: '', source: 'storage', resolution: 'GENERIC',
  });

  const ambiguous = Generic.createAdapter(document, {
    config: {
      siteProfile: { matched: false, id: '', revision: '', source: 'storage', resolution: 'AMBIGUOUS_PROFILE' },
      profileWarnings: [{ code: 'AMBIGUOUS_PROFILE', path: '$' }],
    },
    navigationEngine: { scan() { return []; }, scanDetailed() { return { items: [], candidates: [] }; } },
  }).diagnose();
  assert.equal(ambiguous.siteProfile.resolution, 'AMBIGUOUS_PROFILE');
  assert.ok(ambiguous.warnings.length > 0);
  assert.equal(Object.hasOwn(ambiguous.siteProfile, 'config'), false);
  assert.equal(Object.hasOwn(ambiguous.siteProfile, 'selectors'), false);
});

test('TaskState 创建、规范化与持久快照保留 siteProfileId + siteProfileRevision', () => {
  const task = TaskState.createTask({
    taskId: 'task:phase34-profile-identity',
    scanId: 'scan:phase34-profile-identity',
    siteProfileId: 'identity-contract',
    siteProfileRevision: 'identity-r3',
    adapterId: 'generic',
    queue: [{ sectionId: 'basic', label: '基本信息' }],
  });

  assert.equal(task.siteProfileId, 'identity-contract');
  assert.equal(task.siteProfileRevision, 'identity-r3');
  const restored = TaskState.normalizeTaskState(JSON.parse(JSON.stringify(task)));
  assert.equal(restored.siteProfileId, 'identity-contract');
  assert.equal(restored.siteProfileRevision, 'identity-r3');
});

test('Report view/persistent summary/task result 保留相同 Profile identity', () => {
  const manager = new Reports.ReportManager();
  const runId = manager.beginRun({
    runId: 'run:phase34-profile-identity',
    scanId: 'scan:phase34-profile-identity',
    taskId: 'task:phase34-profile-identity',
    sectionId: 'basic',
    adapterId: 'generic',
    siteProfileId: 'identity-contract',
    siteProfileRevision: 'identity-r3',
  });
  manager.recordField(runId, {
    field: 'basic.name',
    fieldName: '姓名',
    status: Reports.REPORT_STATUSES.SUCCESS,
  });
  const view = manager.getViewModel(runId, { includeValues: false });
  const persistent = manager.finalize(runId);
  const taskResult = manager.toTaskResult(runId);

  for (const value of [view, persistent, taskResult]) {
    assert.deepEqual(identityFrom(value), {
      id: 'identity-contract',
      revision: 'identity-r3',
    });
  }
});

test('Autofill 聚合报告、runtime snapshot 与冷恢复结果统一保留 Profile identity', () => {
  const document = minimalDocument();
  const navigation = { invalidate() {} };
  const engine = new Autofill.AutofillEngine({
    document,
    config: {
      adapterId: 'identity-contract',
      siteProfile: {
        matched: true,
        id: 'identity-contract',
        revision: 'identity-r3',
        source: 'storage',
        resolution: 'MATCHED_PROFILE',
      },
    },
    adapter: {
      navigation,
      findContentRoot() { return document.body; },
    },
    navigationEngine: navigation,
    formFiller: {},
    reportManager: new Reports.ReportManager(),
    taskStore: {},
    saveHandler: { invalidate() {} },
  });
  engine.scanId = 'scan:phase34-aggregate-identity';
  engine.task = TaskState.createTask({
    taskId: 'task:phase34-aggregate-identity',
    scanId: engine.scanId,
    adapterId: 'identity-contract',
    siteProfileId: 'identity-contract',
    siteProfileRevision: 'identity-r3',
    queue: [{ sectionId: 'basic', label: '基本信息', scanId: engine.scanId }],
    // 模拟旧/手工结果没有重复写 identity；TaskState 必须从任务 identity 安全补齐。
    results: [{
      sectionId: 'basic',
      scanId: engine.scanId,
      status: 'manual_review',
      reasonCode: 'SECTION_NAVIGATION_NOT_CONFIRMED',
      summary: { total: 0, manualReview: 1 },
    }],
  });

  assert.deepEqual(identityFrom(engine.task.results[0]), {
    id: 'identity-contract', revision: 'identity-r3',
  });
  const snapshot = engine.snapshot();
  assert.deepEqual(identityFrom(snapshot), {
    id: 'identity-contract', revision: 'identity-r3',
  });
  assert.deepEqual(snapshot.siteProfile, {
    matched: true,
    id: 'identity-contract',
    revision: 'identity-r3',
    source: 'storage',
    resolution: 'MATCHED_PROFILE',
  });

  const report = engine.getReport();
  assert.deepEqual(identityFrom(report), {
    id: 'identity-contract', revision: 'identity-r3',
  });
  assert.deepEqual(identityFrom(report.sections[0]), {
    id: 'identity-contract', revision: 'identity-r3',
  });
  assert.equal(report.finalSubmitBlocked, true);

  const controller = readFileSync(join(rootDir, 'src', 'content-controller.js'), 'utf8');
  assert.match(controller, /siteProfile:\s*engineSnapshot\.siteProfile/);
});

test('control adapters 保持 Profile 无感：不依赖 profile API、identity 或 hostname', () => {
  const controlsRoot = join(rootDir, 'src', 'controls');
  const forbidden = /JFSiteProfile|site-profile|resolveProfile|siteProfileId|siteProfileRevision|profileId|profileRevision|\bhostname\b|location\.host\b/i;
  const violations = [];
  for (const file of sourceFiles(controlsRoot)) {
    const source = readFileSync(file, 'utf8');
    if (forbidden.test(source)) violations.push(relative(rootDir, file));
  }

  assert.deepEqual(violations, [], `Control Adapter 层不得感知 Site Profile：${violations.join(', ')}`);
});

test('Profile 选择层不写 hostname/platform 分支，保持通用 location match', () => {
  siteProfileApi();
  const files = [
    join(rootDir, 'src', 'adapters', 'registry.js'),
    join(rootDir, 'src', 'adapters', 'site-profile.js'),
  ];
  const violations = files.filter(file => /\bhostname\b|location\.host\b|nju|tongji|同济|南京大学/i.test(readFileSync(file, 'utf8')));
  assert.deepEqual(violations.map(file => relative(rootDir, file)), []);
});

test('浏览器注入与 build 清单都恰好一次加载 site-profile，并早于 Registry/Generic consumer', () => {
  siteProfileApi();
  const popup = readFileSync(join(rootDir, 'popup.js'), 'utf8');
  const build = readFileSync(join(rootDir, 'scripts', 'build.mjs'), 'utf8');
  const profilePath = 'src/adapters/site-profile.js';

  for (const [label, source] of [['popup', popup], ['build', build]]) {
    assert.equal(occurrences(source, profilePath), 1, `${label} 中 site-profile runtime path 必须且只能出现一次`);
    assert.ok(source.indexOf(profilePath) < source.indexOf('src/adapters/registry.js'), `${label} 必须先加载 SiteProfile 再加载 Registry`);
    assert.ok(source.indexOf(profilePath) < source.indexOf('src/adapters/generic-adapter.js'), `${label} 必须先加载 SiteProfile 再加载 GenericAdapter`);
  }
});

test('Autofill Runtime 将 Profile 局部能力与 identity 接入既有 Engine，不让 Control Adapter 感知站点', () => {
  const engine = readFileSync(join(rootDir, 'src', 'core', 'autofill-engine.js'), 'utf8');
  const controller = readFileSync(join(rootDir, 'src', 'content-controller.js'), 'utf8');

  assert.match(controller, /resolveProfile\?\.\(configs, root\.location/);
  assert.match(controller, /siteProfile[\s\S]{0,500}resolution/);
  assert.match(controller, /'JFSiteProfile'/);
  assert.match(engine, /configuredSelectors:\s*this\.config\.(?:safeSaveSelectors|save)/);
  assert.match(engine, /siteProfileId:\s*this\.siteProfile\.id/);
  assert.match(engine, /siteProfileRevision:\s*this\.siteProfile\.revision/);
  assert.match(engine, /fieldAliases:\s*this\.config\.fieldAliases/);
  assert.match(engine, /optionAliases:\s*this\.config\.optionAliases/);
});
