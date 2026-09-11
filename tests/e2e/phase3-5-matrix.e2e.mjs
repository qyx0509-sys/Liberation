import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test, { after, afterEach, before } from 'node:test';

import { MATRIX_CASES } from '../matrix/matrix-cases.mjs';
import {
  evaluate as evaluateInPage,
  launchHeadlessBrowser,
  waitFor,
} from './support/headless-browser.mjs';
import {
  parseProductionInjectionFiles,
  readProductionRuntimeSources,
} from './support/production-runtime-loader.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, '..', '..');
const fixturePath = resolve(projectRoot, 'tests', 'fixtures', 'phase3-5-matrix.html');
const popupPath = resolve(projectRoot, 'popup.js');
const NEW_CASE_IDS = Object.freeze([
  'jqx-compound',
  'native-html-form',
  'modern-ant-design',
  'element-plus',
  'aria-generic',
  'react-select',
]);
const ZERO_SAFETY_COUNTERS = Object.freeze([
  'unsafeClickCount',
  'submitClickCount',
  'deleteClickCount',
  'unsafeProgressionClickCount',
  'unknownUploadCount',
  'legalConsentAutoCheckCount',
  'viewerNavigationClickCount',
  'wrongOverlayCount',
  'wrongRowCount',
  'overwriteCount',
  'wrongRegionCount',
]);

let browser;
let runtimeSources = [];
let fixturePrepared = false;

before(async () => {
  runtimeSources = await readProductionRuntimeSources(projectRoot);
  browser = await launchHeadlessBrowser({
    width: 1440,
    height: 1100,
    initialUrl: pathToFileURL(fixturePath).href,
  });
}, { timeout: 30_000 });

after(async () => {
  await browser?.close();
});

afterEach(async () => {
  if (!fixturePrepared) return;
  const snapshot = await evaluate('window.__phase35MatrixFixture.snapshot()');
  for (const key of ZERO_SAFETY_COUNTERS) {
    assert.equal(snapshot.counters[key], 0, key + ' must stay zero');
  }
  assert.equal(snapshot.existingValue, '保留值', 'pre-existing content must not be overwritten');
  assert.deepEqual(snapshot.blockedNetworkRequests, [], 'fixture CSP must not observe a blocked network attempt');
  assert.deepEqual(browser.externalRequests, [], 'browser must not observe external HTTP(S) requests');
  assert.deepEqual(browser.consoleMessages, [], 'browser console and runtime exceptions must stay empty');
  fixturePrepared = false;
});

test('matrix catalog binds existing cases 1/8 and the six sanitized structural-equivalent browser cases', async () => {
  const popupSource = await readFile(popupPath, 'utf8');
  const canonicalInjectionFiles = parseProductionInjectionFiles(popupSource);
  const casesById = new Map(MATRIX_CASES.map(item => [item.id, item]));
  assert.equal(casesById.get('ant-vue-compound')?.fixture.availability, 'EXISTING_BROWSER_FIXTURE');
  assert.equal(casesById.get('wizard-step-application')?.fixture.availability, 'EXISTING_BROWSER_FIXTURE');
  for (const caseId of NEW_CASE_IDS) {
    assert.equal(casesById.get(caseId)?.fixture.kind, 'sanitized-structural-equivalent');
    assert.equal(casesById.get(caseId)?.fixture.availability, 'EXISTING_BROWSER_FIXTURE');
    assert.match(casesById.get(caseId)?.fixture.source || '', /^tests\/fixtures\/phase3-5-matrix\.html#case-/);
  }
  assert.ok(canonicalInjectionFiles.includes('src/core/autofill-engine.js'));
  assert.equal(runtimeSources.at(-1)?.relativePath, 'src/core/autofill-engine.js');
  assert.equal(new Set(runtimeSources.map(item => item.relativePath)).size, runtimeSources.length);
});

test('JQX: owned dropdown write/readback is idempotent and zero-row practice uses only its region-local add', async () => {
  await prepareFixture('jqx-compound');
  const custom = await evaluate("(async () => window.__phase35ProductionHarness.runPlans(" +
    JSON.stringify('jqx-compound') + "," +
    JSON.stringify({
      basic: { gender: '女' },
      education: [{ major: '计算机科学与技术' }],
    }) + "," +
    JSON.stringify([
      { id: 'jqx-gender', section: 'basic', path: 'basic.gender', value: '女', expectedType: 'choice' },
      { id: 'jqx-major', section: 'education', path: 'education[].major', value: '计算机科学与技术', expectedType: 'choice' },
    ]) + "))()", { awaitPromise: true, timeoutMs: 10_000 });
  assertSupportedPlans(custom, {
    'jqx-gender': ['basic.gender', 'custom-select', 'jqx', '女'],
    'jqx-major': ['education[].major', 'custom-select', 'jqx', '计算机科学与技术'],
  });

  const repeatable = await evaluate("(async () => window.__phase35ProductionHarness.runPractice())()", {
    awaitPromise: true,
    timeoutMs: 10_000,
  });
  assert.equal(repeatable.ok, true, JSON.stringify(repeatable));
  assert.deepEqual(
    [repeatable.initialCount, repeatable.count, repeatable.added, repeatable.clicks],
    [0, 1, 1, 1],
  );
  assert.equal(repeatable.groupIndex, 0);
  assert.equal(repeatable.groupRootTag, 'TABLE');
  assert.equal(repeatable.addRootId, 'jqx-practice-region');
  assert.equal(repeatable.safeAddCount, 1);
  assert.equal(repeatable.decoyAddDelta, 0);
  for (const entry of repeatable.fields) {
    assert.equal(entry.matchStatus, 'MATCHED', JSON.stringify(entry));
    assert.equal(entry.matchedPath, entry.path);
    assert.equal(entry.firstStatus, 'SUCCESS');
    assert.equal(entry.rerunStatus, 'SKIPPED_EXISTING');
  }
});

test('Native HTML: detector/matcher/form-filler cover value/select/date/textareas while file remains confirmation-only', async () => {
  await prepareFixture('native-html-form');
  const result = await evaluate("(async () => window.__phase35ProductionHarness.runPlans(" +
    JSON.stringify('native-html-form') + "," +
    JSON.stringify({
      basic: { name: '示例用户', gender: '男', birthday: '2000-01-02' },
      contact: { archiveRegion: '示例档案地区', address: '示例路 1 号' },
      application: { personalStatement: '结构等价测试文本' },
    }) + "," +
    JSON.stringify([
      { id: 'native-name', section: 'basic', path: 'basic.name', value: '示例用户', expectedType: 'text' },
      { id: 'native-gender', section: 'basic', path: 'basic.gender', value: '男', expectedType: 'choice' },
      { id: 'native-birthday', section: 'basic', path: 'basic.birthday', value: '2000-01-02', expectedType: 'date' },
      { id: 'native-archive-region', section: 'contact', path: 'contact.archiveRegion', value: '示例档案地区', expectedType: 'text' },
      { id: 'native-address', section: 'contact', path: 'contact.address', value: '示例路 1 号', expectedType: 'textarea' },
      { id: 'native-statement', section: 'application', path: 'application.personalStatement', value: '结构等价测试文本', expectedType: 'textarea' },
    ]) + "))()", { awaitPromise: true, timeoutMs: 10_000 });
  assertSupportedPlans(result, {
    'native-name': ['basic.name', 'native-value', 'generic', '示例用户'],
    'native-gender': ['basic.gender', 'native-select', 'generic', '男'],
    'native-birthday': ['basic.birthday', 'date-like', 'generic', '2000-01-02'],
    'native-archive-region': ['contact.archiveRegion', 'native-value', 'generic', '示例档案地区'],
    'native-address': ['contact.address', 'native-value', 'generic', '示例路 1 号'],
    'native-statement': ['application.personalStatement', 'native-value', 'generic', '结构等价测试文本'],
  });

  const fileBoundary = await evaluate("(async () => window.__phase35ProductionHarness.runFileBoundary())()", {
    awaitPromise: true,
  });
  assert.equal(fileBoundary.controlKind, 'file');
  assert.equal(fileBoundary.status, 'NEEDS_CONFIRMATION');
  assert.equal(fileBoundary.readback, '');
});

test('Modern Ant classes: owned select, month values and same-overlay cascader append use production adapters', async () => {
  await prepareFixture('modern-ant-design');
  const education = await evaluate("(async () => window.__phase35ProductionHarness.runPlans(" +
    JSON.stringify('modern-ant-design') + "," +
    JSON.stringify({
      education: [{
        major: '计算机科学与技术',
        enrollmentDate: '2023-09',
        graduationDate: '2027-06',
      }],
    }) + "," +
    JSON.stringify([
      { id: 'ant-major', section: 'education', path: 'education[].major', value: '计算机科学与技术', expectedType: 'choice' },
      { id: 'ant-enrollment', section: 'education', path: 'education[].enrollmentDate', value: '2023-09', expectedType: 'date' },
      { id: 'ant-graduation', section: 'education', path: 'education[].graduationDate', value: '2027-06', expectedType: 'date' },
    ]) + "))()", { awaitPromise: true, timeoutMs: 10_000 });
  assertSupportedPlans(education, {
    'ant-major': ['education[].major', 'custom-select', 'ant-design', '计算机科学与技术'],
    'ant-enrollment': ['education[].enrollmentDate', 'date-like', 'ant-design', '2023-09'],
    'ant-graduation': ['education[].graduationDate', 'date-like', 'ant-design', '2027-06'],
  });

  const cascader = await evaluate("(async () => window.__phase35ProductionHarness.runPlans(" +
    JSON.stringify('modern-ant-design') + "," +
    JSON.stringify({ basic: { hometown: '江苏省 / 南京市' } }) + "," +
    JSON.stringify([
      { id: 'ant-region', section: 'basic', path: 'basic.hometown', value: '江苏省 / 南京市', expectedType: 'cascader', counterId: 'ant-region' },
    ]) + "))()", { awaitPromise: true, timeoutMs: 10_000 });
  assertSupportedPlans(cascader, {
    'ant-region': ['basic.hometown', 'cascader', 'ant-design', '江苏省 / 南京市'],
  });
});

test('Element Plus classes: form-item ownership, teleported select and cascader remain uniquely owned and idempotent', async () => {
  await prepareFixture('element-plus');
  const education = await evaluate("(async () => window.__phase35ProductionHarness.runPlans(" +
    JSON.stringify('element-plus') + "," +
    JSON.stringify({
      education: [{
        school: '示例大学',
        major: '软件工程',
        enrollmentDate: '2022-09',
        graduationDate: '2026-06',
      }],
    }) + "," +
    JSON.stringify([
      { id: 'el-school', section: 'education', path: 'education[].school', value: '示例大学', expectedType: 'text' },
      { id: 'el-major', section: 'education', path: 'education[].major', value: '软件工程', expectedType: 'choice' },
      { id: 'el-enrollment', section: 'education', path: 'education[].enrollmentDate', value: '2022-09', expectedType: 'date' },
      { id: 'el-graduation', section: 'education', path: 'education[].graduationDate', value: '2026-06', expectedType: 'date' },
    ]) + "))()", { awaitPromise: true, timeoutMs: 10_000 });
  assertSupportedPlans(education, {
    'el-school': ['education[].school', 'native-value', 'generic', '示例大学'],
    'el-major': ['education[].major', 'custom-select', 'element-plus', '软件工程'],
    'el-enrollment': ['education[].enrollmentDate', 'date-like', 'element-plus', '2022-09'],
    'el-graduation': ['education[].graduationDate', 'date-like', 'element-plus', '2026-06'],
  });

  const cascader = await evaluate("(async () => window.__phase35ProductionHarness.runPlans(" +
    JSON.stringify('element-plus') + "," +
    JSON.stringify({ basic: { hometownRegion: '江苏省 / 南京市' } }) + "," +
    JSON.stringify([
      { id: 'el-region', section: 'basic', path: 'basic.hometownRegion', value: '江苏省 / 南京市', expectedType: 'cascader', counterId: 'el-region' },
    ]) + "))()", { awaitPromise: true, timeoutMs: 10_000 });
  assertSupportedPlans(cascader, {
    'el-region': ['basic.hometownRegion', 'cascader', 'element-plus', '江苏省 / 南京市'],
  });
});

test('Pure ARIA: controlled listbox succeeds while an unresolved multi-owner scope stops as NEEDS_CONFIRMATION', async () => {
  await prepareFixture('aria-generic');
  const result = await evaluate("(async () => window.__phase35ProductionHarness.runPlans(" +
    JSON.stringify('aria-generic') + "," +
    JSON.stringify({ basic: { ethnicity: '汉族', political: '中共党员' } }) + "," +
    JSON.stringify([
      { id: 'aria-ethnicity', section: 'basic', path: 'basic.ethnicity', value: '汉族', expectedType: 'choice' },
      { id: 'aria-political', section: 'basic', path: 'basic.political', value: '中共党员', expectedType: 'choice', rerun: false },
    ]) + "))()", { awaitPromise: true, timeoutMs: 10_000 });
  const supported = result.plans.find(item => item.id === 'aria-ethnicity');
  assertSupportedPlan(supported, ['basic.ethnicity', 'custom-select', 'aria', '汉族']);
  const ambiguous = result.plans.find(item => item.id === 'aria-political');
  assert.equal(ambiguous.matchStatus, 'MATCHED', JSON.stringify(ambiguous));
  assert.equal(ambiguous.matchedPath, 'basic.political');
  assert.equal(ambiguous.adapterId, 'custom-select');
  assert.equal(ambiguous.framework, 'aria');
  assert.equal(ambiguous.firstStatus, 'NEEDS_CONFIRMATION');
  assert.equal(ambiguous.readback, '');
  assert.equal(ambiguous.optionClickDelta, 0);
  assert.equal(ambiguous.optionMatchingReason, 'OPTION_SCOPE_UNCERTAIN');
});

test('React Select: two controlled portal menus support dynamic option selection and zero-open second runs', async () => {
  await prepareFixture('react-select');
  const result = await evaluate("(async () => window.__phase35ProductionHarness.runPlans(" +
    JSON.stringify('react-select') + "," +
    JSON.stringify({ basic: { ethnicity: '蒙古族', political: '共青团员' } }) + "," +
    JSON.stringify([
      { id: 'react-ethnicity', section: 'basic', path: 'basic.ethnicity', value: '蒙古族', expectedType: 'choice' },
      { id: 'react-political', section: 'basic', path: 'basic.political', value: '共青团员', expectedType: 'choice' },
    ]) + "))()", { awaitPromise: true, timeoutMs: 10_000 });
  assertSupportedPlans(result, {
    'react-ethnicity': ['basic.ethnicity', 'custom-select', 'react-select', '蒙古族'],
    'react-political': ['basic.political', 'custom-select', 'react-select', '共青团员'],
  });
});

async function prepareFixture(caseId) {
  browser.resetSignals();
  await browser.cdp.call('Page.navigate', { url: pathToFileURL(fixturePath).href });
  await waitFor(async () => {
    try {
      return await evaluate(
        "document.readyState === 'complete' && typeof window.__phase35MatrixFixture?.snapshot === 'function'",
      );
    } catch {
      return false;
    }
  }, 5_000, 'Phase 3.5 structural-equivalent fixture load timeout');

  for (const { relativePath, source } of runtimeSources) {
    await evaluate(source + "\n//# sourceURL=" + basename(relativePath));
  }
  await evaluate("(" + installBrowserHarness.toString() + ")()");
  const globals = await evaluate("(() => ({"+
    "detector:typeof JFFieldDetector?.scan,"+
    "matcher:typeof JFFieldMatcher?.matchField,"+
    "formFiller:typeof JFFormFiller?.fill,"+
    "registryResolve:typeof JFControlAdapterRegistry?.resolve,"+
    "registryExecute:typeof JFControlAdapterRegistry?.execute,"+
    "events:typeof JFEventDispatcher?.readControlValue,"+
    "arrays:typeof JFArrayHandler?.prepare"+
    "}))()");
  assert.ok(Object.values(globals).every(value => value === 'function'), JSON.stringify(globals));
  const activated = await evaluate(
    "window.__phase35MatrixFixture.activateCase(" + JSON.stringify(caseId) + ")",
  );
  assert.equal(activated.fixtureKind, 'sanitized-structural-equivalent');
  assert.equal(activated.activeCase, caseId);
  fixturePrepared = true;
}

function installBrowserHarness() {
  'use strict';
  window.siteAdapterConfigs = [];

  function genericResolution() {
    return JFAdapterRegistry.resolve(window.siteAdapterConfigs, document.location, {
      source: 'phase3-5-structural-e2e',
    });
  }

  function sectionContext(section, index = 0) {
    const isCollection = [
      'education', 'practice', 'family', 'internships', 'research', 'papers', 'awards',
    ].includes(section);
    return {
      sectionId: section,
      section,
      collection: section,
      collectionMode: isCollection ? 'singleton-view' : 'record',
      index: isCollection ? index : null,
      indexContext: isCollection ? { section, index } : null,
      source: 'phase3-5-structural-e2e',
      confidence: 1,
      regionId: 'phase3-5:' + section + ':' + index,
    };
  }

  function descriptorOwnsId(descriptor, id) {
    if (!descriptor) return false;
    if (
      descriptor.element?.id === id
      || descriptor.interactionElement?.id === id
      || descriptor.cascaderTrigger?.id === id
      || descriptor.datePickerTrigger?.id === id
    ) return true;
    try {
      return Boolean(descriptor.element?.querySelector?.('#' + id));
    } catch {
      return false;
    }
  }

  function scanFor(caseId, section, index = 0) {
    const root = document.querySelector('[data-matrix-case="' + caseId + '"]');
    if (!root || root.hidden) throw new Error('Matrix case is not the isolated visible case: ' + caseId);
    const context = sectionContext(section, index);
    return {
      context,
      fields: JFFieldDetector.scan(root, {
        section,
        sectionContext: context,
        regions: [],
      }),
    };
  }

  async function runPlans(caseId, resume, plans) {
    const profile = genericResolution();
    const resumeView = JFFieldAliases.buildResumeView(resume);
    const results = [];
    for (const plan of plans) {
      const scanned = scanFor(caseId, plan.section, plan.index || 0);
      const descriptor = scanned.fields.find(field => descriptorOwnsId(field, plan.id));
      if (!descriptor) throw new Error('Production FieldDetector missed ' + caseId + ':' + plan.id);
      const match = JFFieldMatcher.matchField(descriptor, resume, {
        section: plan.section,
        sectionContext: scanned.context,
        resumeView,
      });
      const settings = {
        fieldPath: plan.path,
        matchedPath: plan.path,
        expectedType: plan.expectedType,
        allowOverwrite: false,
        sectionContext: scanned.context,
        collectionMode: scanned.context.collectionMode,
        sectionId: plan.section,
        customSelectTimeoutMs: 700,
        cascaderTimeoutMs: 700,
        datePickerTimeoutMs: 700,
      };
      const resolution = JFControlAdapterRegistry.resolve(descriptor, settings);
      const before = window.__phase35MatrixFixture.snapshot();
      const first = await JFFormFiller.fill(descriptor, plan.value, settings);
      const afterFirst = window.__phase35MatrixFixture.snapshot();
      const readback = JFEventDispatcher.readControlValue(descriptor);
      let rerun = null;
      let afterRerun = afterFirst;
      if (plan.rerun !== false) {
        rerun = await JFFormFiller.fill(descriptor, plan.value, settings);
        afterRerun = window.__phase35MatrixFixture.snapshot();
      }
      const counterId = plan.counterId || plan.id;
      results.push({
        id: plan.id,
        path: plan.path,
        descriptorCount: scanned.fields.length,
        labelText: descriptor.labelText || '',
        controlKind: descriptor.controlKind || descriptor.type || '',
        matchStatus: match.status,
        matchedPath: match.matchedPath || '',
        adapterId: resolution.adapterId,
        framework: resolution.framework,
        firstStatus: first.status,
        rerunStatus: rerun?.status || '',
        readback,
        optionMatchingReason: first.optionMatchingDebug?.reasonCode || '',
        openDelta: Number(afterFirst.openCounts[counterId] || 0) - Number(before.openCounts[counterId] || 0),
        rerunOpenDelta: Number(afterRerun.openCounts[counterId] || 0) - Number(afterFirst.openCounts[counterId] || 0),
        optionClickDelta: Number(afterFirst.optionClickCounts[counterId] || 0)
          - Number(before.optionClickCounts[counterId] || 0),
      });
    }
    return {
      generic: !profile.matched && profile.resolution === 'GENERIC' && profile.adapterId === 'generic',
      profileResolution: profile.resolution,
      plans: results,
    };
  }

  async function runPractice() {
    const profile = genericResolution();
    const region = document.getElementById('jqx-practice-region');
    const groupRoot = region?.querySelector('table');
    if (!groupRoot) throw new Error('JQX practice fixture is missing its owned table group root');
    const before = window.__phase35MatrixFixture.snapshot();
    const prepared = await JFArrayHandler.prepare(
      { section: 'practice', collection: 'practice', collectionMode: 'repeatable' },
      [{ startDate: '2024-01', endDate: '2024-02', location: '示例地点', description: '示例实践内容' }],
      groupRoot,
      {
        groupSelector: '[data-repeat-item]',
        addButtonSelector: '[data-add-practice]',
        addRoot: region,
        ownedOnly: true,
        timeoutMs: 800,
        maxAdds: 1,
      },
    );
    const afterPrepare = window.__phase35MatrixFixture.snapshot();
    if (!prepared.ok || !prepared.groups?.[0]) {
      return {
        ok: false,
        error: prepared.error || 'practice row was not created',
        initialCount: prepared.initialCount,
        count: prepared.count,
      };
    }
    const resume = {
      practice: [{
        startDate: '2024-01',
        endDate: '2024-02',
        location: '示例地点',
        description: '示例实践内容',
      }],
    };
    const resumeView = JFFieldAliases.buildResumeView(resume);
    const context = prepared.groupContexts[0];
    const fields = JFFieldDetector.scan(prepared.groups[0], {
      section: 'practice',
      sectionContext: context,
      regions: [],
    });
    const plans = [
      { id: 'jqx-practice-location-0', path: 'practice[].location', value: '示例地点', expectedType: 'text' },
      { id: 'jqx-practice-description-0', path: 'practice[].description', value: '示例实践内容', expectedType: 'text' },
    ];
    const fieldResults = [];
    for (const plan of plans) {
      const descriptor = fields.find(field => descriptorOwnsId(field, plan.id));
      if (!descriptor) throw new Error('Production FieldDetector missed practice field ' + plan.id);
      const match = JFFieldMatcher.matchField(descriptor, resume, {
        section: 'practice',
        sectionContext: context,
        resumeView,
      });
      const settings = {
        fieldPath: plan.path,
        matchedPath: plan.path,
        expectedType: plan.expectedType,
        allowOverwrite: false,
        sectionContext: context,
      };
      const first = await JFFormFiller.fill(descriptor, plan.value, settings);
      const readback = JFEventDispatcher.readControlValue(descriptor);
      const rerun = await JFFormFiller.fill(descriptor, plan.value, settings);
      fieldResults.push({
        id: plan.id,
        path: plan.path,
        matchStatus: match.status,
        matchedPath: match.matchedPath || '',
        adapterId: JFControlAdapterRegistry.resolve(descriptor, settings).adapterId,
        firstStatus: first.status,
        rerunStatus: rerun.status,
        readback,
      });
    }
    const finalSnapshot = window.__phase35MatrixFixture.snapshot();
    return {
      ok: prepared.ok && !profile.matched,
      initialCount: prepared.initialCount,
      count: prepared.count,
      added: prepared.added,
      clicks: prepared.clicks,
      groupIndex: prepared.groupContexts[0]?.index,
      groupRootTag: groupRoot.tagName,
      addRootId: region.id,
      safeAddCount: finalSnapshot.safeAddCounts.practice,
      decoyAddDelta: finalSnapshot.counters.wrongRegionCount - before.counters.wrongRegionCount,
      prepareAddDelta: afterPrepare.safeAddCounts.practice - before.safeAddCounts.practice,
      fields: fieldResults,
    };
  }

  async function runFileBoundary() {
    const scanned = scanFor('native-html-form', 'materials', 0);
    const descriptor = scanned.fields.find(field => descriptorOwnsId(field, 'native-unknown-file'));
    if (!descriptor) throw new Error('Production FieldDetector missed native file boundary');
    const result = await JFFormFiller.fill(descriptor, 'forbidden-auto-upload.pdf', {
      fieldPath: 'materials[].file',
      allowOverwrite: false,
    });
    return {
      controlKind: descriptor.controlKind || descriptor.type || '',
      status: result.status,
      readback: JFEventDispatcher.readControlValue(descriptor),
    };
  }

  window.__phase35ProductionHarness = Object.freeze({
    runFileBoundary,
    runPlans,
    runPractice,
  });
}

function assertSupportedPlans(result, expected) {
  assert.equal(result.generic, true, JSON.stringify(result));
  assert.equal(result.profileResolution, 'GENERIC');
  for (const [id, expectation] of Object.entries(expected)) {
    const plan = result.plans.find(item => item.id === id);
    assertSupportedPlan(plan, expectation);
  }
}

function assertSupportedPlan(plan, [path, adapterId, framework, readback]) {
  assert.ok(plan, path + ' result must exist');
  assert.equal(plan.matchStatus, 'MATCHED', JSON.stringify(plan));
  assert.equal(plan.matchedPath, path, JSON.stringify(plan));
  assert.equal(plan.adapterId, adapterId, JSON.stringify(plan));
  assert.equal(plan.framework, framework, JSON.stringify(plan));
  assert.equal(plan.firstStatus, 'SUCCESS', JSON.stringify(plan));
  assert.equal(plan.readback, readback, JSON.stringify(plan));
  assert.equal(plan.rerunStatus, 'SKIPPED_EXISTING', JSON.stringify(plan));
  assert.equal(plan.rerunOpenDelta, 0, JSON.stringify(plan));
}

function evaluate(expression, options = {}) {
  return evaluateInPage(browser.cdp, expression, options);
}
