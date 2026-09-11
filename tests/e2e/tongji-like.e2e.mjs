import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test, { after, afterEach, before } from 'node:test';
import {
  evaluate as evaluateInPage,
  launchHeadlessBrowser,
  waitFor,
} from './support/headless-browser.mjs';

const testDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(testDirectory, '..', '..');
const fixturePath = resolve(projectRoot, 'tests', 'fixtures', 'tongji-like', 'index.html');
const runtimeFiles = [
  'src/mappings/section-aliases.js',
  'src/mappings/section-structures.js',
  'src/mappings/field-aliases.js',
  'src/mappings/option-aliases.js',
  'src/mappings/date-rules.js',
  'src/mappings/file-field-aliases.js',
  'src/semantics/boolean-semantic-adapter.js',
  'src/semantics/field-semantic-normalizer.js',
  'src/core/semantic-verification.js',
  'src/core/safety.js',
  'src/core/diagnostic-sanitizer.js',
  'src/core/page-ready.js',
  'src/core/task-state.js',
  'src/core/report-manager.js',
  'src/core/current-section-resolver.js',
  'src/core/embedded-section-detector.js',
  'src/core/field-context.js',
  'src/core/event-dispatcher.js',
  'src/core/field-detector.js',
  'src/core/field-matcher.js',
  'src/core/verification-engine.js',
  'src/controls/control-adapter-registry.js',
  'src/controls/adapters/native-value-adapter.js',
  'src/controls/adapters/native-select-adapter.js',
  'src/controls/adapters/choice-adapter.js',
  'src/controls/adapters/cascader-adapter.js',
  'src/controls/adapters/custom-select-adapter.js',
  'src/controls/adapters/date-like-adapter.js',
  'src/controls/adapters/compound-picker-adapter.js',
  'src/core/form-filler.js',
  'src/core/file-field-detector.js',
  'src/core/file-matcher.js',
  'src/core/file-upload-engine.js',
  'src/core/save-handler.js',
  'src/core/navigation-engine.js',
  'src/adapters/generic.js',
  'src/adapters/site-profile.js',
  'src/adapters/registry.js',
  'src/adapters/generic-adapter.js',
  'src/adapters/undergraduate-awards.js',
  'src/core/array-handler.js',
  'src/core/autofill-engine.js',
];

const expectedSections = Object.freeze([
  'basic',
  'family',
  'education',
  'language',
  'skills',
  'internship',
  'research',
  'awards',
  'application',
  'recommenders',
  'upload_photo',
  'upload_materials',
]);

const syntheticResume = Object.freeze({
  basic: Object.freeze({
    name: '示例申请人',
    namePinyin: 'SHILI SHENQINGREN',
    ethnicity: '汉族',
    marital: '未婚',
    political: '群众',
  }),
  contact: Object.freeze({
    address: '示例通讯地址',
    phone: 'TEST-MOBILE',
    email: 'applicant@example.invalid',
  }),
  family: Object.freeze([
    Object.freeze({ name: '示例成员甲', relationship: '父亲', employerPosition: '示例单位甲 教师', phone: '010-TEST-0001' }),
    Object.freeze({ name: '示例成员乙', relationship: '母亲', employerPosition: '示例单位乙 工程师', phone: '010-TEST-0002' }),
    Object.freeze({ name: '示例成员丙', relationship: '兄弟', employerPosition: '示例单位丙 学生', phone: '010-TEST-0003' }),
  ]),
  education: Object.freeze([
    Object.freeze({
      school: '第一示例大学',
      college: '材料学院',
      major: '材料科学与工程',
      enrollmentDate: '2022-09',
      graduationDate: '2026-06',
      studentId: 'STUDENT-0001',
      gpa: '4.2/5',
      gpaScale: '5',
      percentageScore: '91.50',
    }),
    Object.freeze({
      school: '第二示例大学',
      college: '研究生院',
      major: '测试专业',
      studentId: 'STUDENT-0002',
    }),
  ]),
});

let browser;
let runtimeSources;

before(async () => {
  runtimeSources = await Promise.all(runtimeFiles.map(async relativePath => ({
    relativePath,
    source: await readFile(resolve(projectRoot, relativePath), 'utf8'),
  })));
  browser = await launchHeadlessBrowser({
    width: 1440,
    height: 1000,
    initialUrl: pathToFileURL(fixturePath).href,
  });
}, { timeout: 30_000 });

after(async () => {
  await browser?.close();
});

afterEach(async () => {
  if (!browser) return;
  const snapshot = await evaluate('window.__tongjiLikeFixture?.getSnapshot?.()').catch(() => null);
  assert.deepEqual(snapshot?.attemptedNetworkRequests || [], [], '脱敏夹具不得尝试网络请求');
  assert.deepEqual(browser.externalRequests, [], '浏览器页面不得产生 HTTP(S) 请求');
  assert.deepEqual(browser.consoleMessages, [], '严格 CSP 下不得出现 console warning/error');
});

test('Navigation：未知容器中的栏目语义簇可被扫描，提交入口必须排除', async () => {
  await prepareFixture();
  const result = await evaluate(`(() => {
    window.__tongjiNavigation = JFNavigationEngine.createNavigationEngine({ document });
    const detailed = window.__tongjiNavigation.scanDetailed();
    const scan = detailed.items;
    const queue = window.__tongjiNavigation.buildQueue(scan);
    const fallbackCandidates = [...document.querySelectorAll(JFNavigationEngine.FALLBACK_NAV_ITEM_SELECTOR)];
    const diagnosis = JFGenericAdapter.createAdapter(document, {
      navigationEngine: window.__tongjiNavigation,
      config: { contentRoot: '#application-content' },
    }).diagnose({ resume: ${JSON.stringify(syntheticResume)} });
    return {
      scan: scan.map(item => ({
        sectionId: item.sectionId,
        text: item.text,
        active: item.active,
        safe: item.safe,
        passiveOnly: item.passiveOnly,
        reasonCode: item.reasonCode,
      })),
      queue: queue.map(item => ({
        sectionId: item.sectionId,
        passiveOnly: item.passiveOnly,
        reasonCode: item.reasonCode,
      })),
      candidates: detailed.candidates,
      diagnosisCandidates: diagnosis.navigation.candidates,
      debug: fallbackCandidates.map(element => {
        const match = JFNavigationEngine.matchSection(JFSafety.actionText(element));
        return {
          text: JFSafety.actionText(element),
          matchedSection: match?.definition?.id || null,
          safe: JFSafety.isNavigationCandidateSafe(element, { baseUrl: location.href }),
          hidden: JFSafety.isHiddenOrDisabled(element),
          parentTag: element.parentElement?.tagName?.toLowerCase() || '',
          parentClass: element.parentElement?.className || '',
        };
      }),
    };
  })()`);

  const scannedIds = new Set(result.scan.map(item => item.sectionId));
  const queuedIds = new Set(result.queue.map(item => item.sectionId));
  for (const sectionId of expectedSections) {
    assert.equal(scannedIds.has(sectionId), true, `导航扫描缺少 ${sectionId}：${JSON.stringify(result)}`);
    assert.equal(queuedIds.has(sectionId), true, `栏目队列缺少 ${sectionId}：${JSON.stringify(result.queue)}`);
  }
  assert.equal(result.scan.some(item => /提交/.test(item.text)), false, JSON.stringify(result.scan));
  assert.equal(result.scan.find(item => item.sectionId === 'basic')?.active, true, '父级活动行应标记基本信息为当前栏目');

  const javascriptCandidate = result.candidates.find(item => item.semanticSection === 'basic' && item.hrefType === 'javascript');
  assert.equal(javascriptCandidate?.accepted, true, JSON.stringify(result.candidates));
  assert.equal(javascriptCandidate?.insideForm, true, JSON.stringify(javascriptCandidate));
  assert.equal(javascriptCandidate?.rejectReason, '', JSON.stringify(javascriptCandidate));

  const noHrefButton = result.candidates.find(item => item.semanticSection === 'family' && item.hrefType === 'none' && item.accepted);
  assert.equal(noHrefButton?.insideForm, true, JSON.stringify(result.candidates));
  const onclickCandidate = result.candidates.find(item => item.semanticSection === 'education' && item.hrefType === 'none');
  assert.equal(onclickCandidate?.accepted, true, JSON.stringify(onclickCandidate));
  assert.equal(onclickCandidate?.insideForm, true, JSON.stringify(onclickCandidate));

  const rejectedDangerous = result.candidates.find(item => item.accepted === false && /DANGEROUS|FORM_ACTION/.test(item.rejectReason));
  assert.ok(rejectedDangerous, JSON.stringify(result.candidates));
  for (const candidate of result.diagnosisCandidates) {
    assert.equal(typeof candidate.rejectReason, 'string');
    assert.equal(typeof candidate.insideForm, 'boolean');
    assert.equal(typeof candidate.hrefType, 'string');
  }
  assert.ok(result.diagnosisCandidates.some(item => item.hrefType === 'javascript' && item.insideForm));
  assert.ok(result.diagnosisCandidates.some(item => item.rejectReason));

  const navigation = await evaluate(`(async () => {
    window.__tongjiNavigation.scan();
    return window.__tongjiNavigation.navigate('family', {
      userInitiated: true,
      confirmSectionId: 'family',
      timeoutMs: 1200,
    });
  })()`, { awaitPromise: true, timeoutMs: 4_000 });
  assert.equal(navigation.ok, true, JSON.stringify(navigation));
  assert.equal((await fixtureSnapshot()).currentSection, 'family');
  assert.equal((await fixtureSnapshot()).attemptedSubmitClicks, 0);
});

test('FieldDetector/Matcher：表格前置单元格成为强标签，姓名拼音保持独立语义', async () => {
  await prepareFixture();
  const result = await evaluate(`(() => {
    const resume = ${JSON.stringify(syntheticResume)};
    const fields = JFFieldDetector.scan(document.getElementById('section-basic'), { section: 'basic' });
    const normalizedLabel = value => String(value || '').replace(/[\\s*]/g, '');
    const expected = [
      ['姓名', 'basic.name'],
      ['姓名拼音', 'basic.namePinyin'],
      ['民族', 'basic.ethnicity'],
      ['婚否', 'basic.marital'],
      ['政治面貌', 'basic.political'],
      ['通讯地址', 'contact.address'],
      ['移动电话', 'contact.phone'],
      ['考生电子邮箱', 'contact.email'],
    ];
    const matches = expected.map(([label, expectedPath]) => {
      const descriptor = fields.find(field => normalizedLabel(field.labelText) === label);
      const match = JFFieldMatcher.matchField(descriptor, resume, { section: 'basic' });
      return {
        label,
        expectedPath,
        found: Boolean(descriptor),
        nearbyOnly: Boolean(descriptor?.nearbyText) && !descriptor?.labelText,
        status: match.status,
        path: match.matchedPath,
        score: match.score,
      };
    });
    const backupDescriptor = fields.find(field => normalizedLabel(field.labelText || field.nearbyText) === '备用信息');
    const backup = JFFieldMatcher.matchField(backupDescriptor, resume, { section: 'basic' });
    return {
      matches,
      backup: { found: Boolean(backupDescriptor), status: backup.status, path: backup.matchedPath, score: backup.score },
    };
  })()`);

  for (const match of result.matches) {
    assert.equal(match.found, true, `${match.label} 未被 FieldDetector 识别`);
    assert.equal(match.nearbyOnly, false, `${match.label} 仍然只有低权重 nearbyText`);
    assert.equal(match.status, 'MATCHED', `${match.label}: ${JSON.stringify(match)}`);
    assert.equal(match.path, match.expectedPath, `${match.label}: ${JSON.stringify(match)}`);
    assert.ok(match.score >= 62, `${match.label}: ${match.score}`);
  }
  assert.equal(result.matches.find(item => item.label === '姓名拼音')?.path, 'basic.namePinyin');
  assert.equal(result.matches.find(item => item.label === '姓名')?.path, 'basic.name');
  assert.equal(result.backup.found, true);
  assert.ok(['UNMATCHED', 'NEEDS_CONFIRMATION'].includes(result.backup.status), JSON.stringify(result.backup));
});

test('AutofillEngine：导航为空时由家庭字段签名恢复上下文，3 条 JSON 从 1 行扩为 3 行并逐组填写', async () => {
  await prepareFixture();
  await evaluate(`window.__tongjiLikeFixture.activateSection('family', false)`);

  const result = await evaluate(`(async () => {
    const resume = ${JSON.stringify(syntheticResume)};
    const noNavigation = {
      scan: () => [],
      scanDetailed: () => ({ items: [], candidates: [] }),
      buildQueue: () => [],
      invalidate: () => undefined,
    };
    const config = {
      contentRoot: '#application-content',
      sections: {
        family: {
          root: '#section-family',
          groupSelector: '#family-body [data-repeat-item]',
        },
      },
    };
    const fields = JFFieldDetector.scan(document.getElementById('section-family'), {});
    const resolved = JFCurrentSectionResolver.resolve({
      document,
      rootNode: document.getElementById('section-family'),
      navigationItems: [],
      headings: [],
      breadcrumbs: [],
      formTitles: [],
      fields,
      adapterResult: null,
    });
    const adapter = JFGenericAdapter.createAdapter(document, { config, navigationEngine: noNavigation });
    const engine = new JFAutofillEngine.AutofillEngine({
      document,
      adapter,
      navigationEngine: noNavigation,
      config,
      resume,
      preferences: {
        allowOverwrite: false,
        skipEmpty: true,
        autoSave: false,
        filePolicy: 'ask-every-time',
      },
    });
    const prepared = await engine.prepareRun('current');
    const authorization = await engine.authorizeRun(prepared);
    const report = await engine.runCurrent({ prepared, authorization });
    return {
      resolved,
      prepared: {
        sectionId: prepared.queue[0]?.sectionId,
        sectionSource: prepared.queue[0]?.sectionSource,
        collection: prepared.queue[0]?.collection,
        collectionMode: prepared.queue[0]?.collectionMode,
        sectionContext: prepared.sectionContext,
        detectedFields: engine.lastInspection?.fields?.map(field => ({ id: field.id, label: field.labelText, hidden: field.hidden })),
      },
      report: {
        state: report.state,
        resultStatus: report.resultStatus,
        total: report.total,
        success: report.success,
        failed: report.failed,
        needsConfirmation: report.needsConfirmation,
        finalSubmitBlocked: report.finalSubmitBlocked,
      },
      fixture: window.__tongjiLikeFixture.getSnapshot(),
    };
  })()`, { awaitPromise: true, timeoutMs: 20_000 });

  assert.equal(result.resolved.sectionId, 'family', JSON.stringify(result.resolved));
  assert.equal(result.resolved.collection, 'family');
  assert.equal(result.resolved.source, 'field-signature');
  assert.ok(result.resolved.confidence >= 0.74, JSON.stringify(result.resolved));
  assert.equal(result.prepared.sectionId, 'family', JSON.stringify(result.prepared));
  assert.equal(result.prepared.sectionSource, 'field-signature');
  assert.equal(result.prepared.collection, 'family');
  assert.equal(result.prepared.collectionMode, 'repeatable');

  assert.equal(result.fixture.addFamilyClicks, 2, JSON.stringify(result.fixture));
  assert.deepEqual(result.fixture.familyRows, syntheticResume.family);
  assert.ok(result.fixture.frameworkEvents.filter(item => item.type === 'input').length >= 12, JSON.stringify(result.fixture.frameworkEvents));
  assert.ok(result.fixture.frameworkEvents.filter(item => item.type === 'change').length >= 12, JSON.stringify(result.fixture.frameworkEvents));
  assert.equal(result.report.success, 12, JSON.stringify(result.report));
  assert.equal(result.report.failed, 0, JSON.stringify(result.report));
  assert.equal(result.report.resultStatus, 'finished_success', JSON.stringify(result.report));
  assert.equal(result.report.finalSubmitBlocked, true);
  assert.equal(result.fixture.attemptedSubmitClicks, 0);
});

test('AutofillEngine：学习信息保持固定 education[0]，复合选择器不直写且已有成绩不覆盖', async () => {
  await prepareFixture();
  await evaluate(`window.__tongjiLikeFixture.activateSection('education', false)`);

  const result = await evaluate(`(async () => {
    const resume = ${JSON.stringify(syntheticResume)};
    const noNavigation = {
      scan: () => [],
      scanDetailed: () => ({ items: [], candidates: [] }),
      buildQueue: () => [],
      invalidate: () => undefined,
    };
    const config = {
      contentRoot: '#application-content',
      sections: { education: { root: '#section-education' } },
    };
    const rootNode = document.getElementById('section-education');
    const fields = JFFieldDetector.scan(rootNode, {});
    const resolved = JFCurrentSectionResolver.resolve({
      document,
      rootNode,
      navigationItems: [],
      headings: [],
      breadcrumbs: [],
      formTitles: [],
      fields,
      adapterResult: null,
    });
    const indexedContext = {
      ...resolved,
      collectionMode: 'singleton-view',
      indexContext: { section: 'education', collection: 'education', index: 0, education: 0 },
    };
    const directMatches = JFFieldMatcher.matchFields(fields, resume, {
      section: 'education',
      sectionContext: indexedContext,
      arrayContext: indexedContext.indexContext,
      arrayIndex: 0,
      resumeView: JFFieldAliases.buildResumeView(resume),
    });
    const adapter = JFGenericAdapter.createAdapter(document, { config, navigationEngine: noNavigation });
    const engine = new JFAutofillEngine.AutofillEngine({
      document,
      adapter,
      navigationEngine: noNavigation,
      config,
      resume,
      preferences: {
        allowOverwrite: false,
        skipEmpty: true,
        autoSave: false,
        filePolicy: 'ask-every-time',
      },
    });
    const prepared = await engine.prepareRun('current');
    const authorization = await engine.authorizeRun(prepared);
    const report = await engine.runCurrent({ prepared, authorization });
    return {
      resolved,
      descriptorKinds: fields.map(field => ({ id: field.id, label: field.labelText, kind: field.controlKind })),
      directMatches: directMatches.map(match => ({
        id: match.descriptor?.id,
        path: match.matchedPath,
        status: match.status,
        kind: match.descriptor?.controlKind,
      })),
      prepared: {
        sectionId: prepared.queue[0]?.sectionId,
        sectionSource: prepared.queue[0]?.sectionSource,
        collection: prepared.queue[0]?.collection,
        collectionMode: prepared.queue[0]?.collectionMode,
        sectionContext: prepared.sectionContext,
        detectedFields: engine.lastInspection?.fields?.map(field => ({ id: field.id, label: field.labelText, hidden: field.hidden })),
      },
      report: {
        state: report.state,
        resultStatus: report.resultStatus,
        total: report.total,
        success: report.success,
        failed: report.failed,
        needsConfirmation: report.needsConfirmation,
        skippedExisting: report.skippedExisting,
        conflicts: report.conflicts,
        finalSubmitBlocked: report.finalSubmitBlocked,
      },
      fixture: window.__tongjiLikeFixture.getSnapshot(),
    };
  })()`, { awaitPromise: true, timeoutMs: 20_000 });

  assert.equal(result.resolved.sectionId, 'education', JSON.stringify(result.resolved));
  assert.equal(result.resolved.source, 'field-signature');
  assert.equal(result.prepared.sectionId, 'education', JSON.stringify(result.prepared));
  assert.equal(result.prepared.sectionSource, 'field-signature');
  assert.equal(result.prepared.collection, 'education');
  assert.equal(result.prepared.collectionMode, 'singleton-view');

  const schoolDescriptor = result.descriptorKinds.find(item => item.id === 'education-school');
  const majorDescriptor = result.descriptorKinds.find(item => item.id === 'education-major');
  assert.equal(schoolDescriptor?.kind, 'compound-picker', JSON.stringify(result.descriptorKinds));
  assert.equal(majorDescriptor?.kind, 'compound-picker', JSON.stringify(result.descriptorKinds));
  assert.equal(result.directMatches.find(item => item.id === 'education-school')?.status, 'NEEDS_CONFIRMATION', JSON.stringify(result.directMatches));
  assert.equal(result.directMatches.find(item => item.id === 'education-major')?.status, 'NEEDS_CONFIRMATION', JSON.stringify(result.directMatches));

  assert.equal(result.fixture.education.school, '', '未适配的学校选择器不得直接写显示 input');
  assert.equal(result.fixture.education.major, '', '未适配的专业选择器不得直接写显示 input');
  assert.equal(result.fixture.pickerClicks, 0, '未适配的复合选择器不得自动点击');
  assert.equal(result.fixture.education.college, syntheticResume.education[0].college);
  assert.equal(result.fixture.education.enrollmentDate, '2022年09月');
  assert.equal(result.fixture.education.graduationDate, '2026年06月');
  assert.equal(result.fixture.education.studentId, syntheticResume.education[0].studentId);
  assert.notEqual(result.fixture.education.studentId, syntheticResume.education[1].studentId);
  assert.equal(result.fixture.education.gpa, '3.8/5', '默认不覆盖已有 GPA/总绩点');
  assert.equal(result.fixture.education.percentageScore, '76.00', '默认不覆盖已有百分制成绩');
  assert.ok(result.report.success >= 4, JSON.stringify(result.report));
  assert.ok(result.report.needsConfirmation >= 3, JSON.stringify(result.report));
  assert.ok(result.report.conflicts >= 2, JSON.stringify(result.report));
  assert.equal(result.report.resultStatus, 'finished_partial', JSON.stringify(result.report));
  assert.equal(result.report.finalSubmitBlocked, true);
  assert.equal(result.fixture.addFamilyClicks, 0, '固定学习信息页不得误点隐藏的家庭新增按钮');
  assert.equal(result.fixture.attemptedSubmitClicks, 0);
});

async function prepareFixture() {
  browser.resetSignals();
  await browser.cdp.call('Page.navigate', { url: pathToFileURL(fixturePath).href });
  await waitFor(async () => {
    try {
      return await evaluate(`document.readyState === 'complete' && window.__tongjiLikeFixture?.ready`);
    } catch {
      return false;
    }
  }, 5_000, '同济风格测试夹具加载超时');
  await evaluate('window.__tongjiLikeFixture.ready', { awaitPromise: true });
  await evaluate(`(() => {
    const localData = { resumeData: ${JSON.stringify(syntheticResume)}, materialLibraryIndex: [] };
    const sessionData = {};
    const makeArea = bucket => ({
      get(keys, callback) {
        const result = {};
        if (keys == null) Object.assign(result, bucket);
        else if (typeof keys === 'string') result[keys] = bucket[keys];
        else if (Array.isArray(keys)) keys.forEach(key => { result[key] = bucket[key]; });
        else Object.keys(keys || {}).forEach(key => { result[key] = Object.hasOwn(bucket, key) ? bucket[key] : keys[key]; });
        callback?.(result);
      },
      set(values, callback) {
        Object.assign(bucket, values || {});
        callback?.();
      },
      remove(keys, callback) {
        (Array.isArray(keys) ? keys : [keys]).forEach(key => { delete bucket[key]; });
        callback?.();
      },
      clear(callback) {
        Object.keys(bucket).forEach(key => { delete bucket[key]; });
        callback?.();
      },
    });
    const chromeApi = window.chrome || {};
    chromeApi.storage = { local: makeArea(localData), session: makeArea(sessionData) };
    chromeApi.runtime = {
      lastError: null,
      sendMessage(message, callback) { callback?.({ ok: true, type: message?.type || '' }); },
    };
    if (!window.chrome) {
      Object.defineProperty(window, 'chrome', { configurable: true, value: chromeApi });
    }
  })()`);
  for (const { relativePath, source } of runtimeSources) {
    if (relativePath === 'src/core/autofill-engine.js') {
      // file:// 夹具没有 http(s) origin；仅在测试中移除这个不可持久化的伪 origin，
      // 其余任务状态仍走真实 normalize/save/update 链路。
      await evaluate(`(() => {
        const original = JFTaskState;
        window.JFTaskState = Object.freeze({
          ...original,
          createTask(options = {}) {
            const origin = String(options.origin || '');
            return original.createTask({ ...options, origin: origin === 'null' || origin.startsWith('file:') ? '' : origin });
          },
        });
      })()`);
    }
    await evaluate(`${source}\n//# sourceURL=${basename(relativePath)}`);
  }
  const globals = await evaluate(`(() => ({
    navigation: typeof JFNavigationEngine?.createNavigationEngine,
    detector: typeof JFFieldDetector?.scan,
    matcher: typeof JFFieldMatcher?.matchField,
    adapter: typeof JFGenericAdapter?.createAdapter,
    resolver: typeof JFCurrentSectionResolver?.resolve,
    arrayHandler: typeof JFArrayHandler?.prepare,
    engine: typeof JFAutofillEngine?.AutofillEngine,
  }))()`);
  assert.ok(Object.values(globals).every(value => value === 'function'), JSON.stringify(globals));
}

function evaluate(expression, options = {}) {
  return evaluateInPage(browser.cdp, expression, options);
}

function fixtureSnapshot() {
  return evaluate('window.__tongjiLikeFixture.getSnapshot()');
}
