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
const fixturePath = resolve(projectRoot, 'tests', 'fixtures', 'compound-ant-application.html');

// Keep this list aligned with the real browser runtime dependency order. The E2E
// deliberately injects src/ modules into a profile-free page instead of importing
// CommonJS test shims, so an undefined browser global is caught here.
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

const resume = Object.freeze({
  basic: Object.freeze({
    name: '示例申请人',
    namePinyin: 'SHILI SHENQINGREN',
    idType: '居民身份证',
    idNumber: 'TEST-ID-0001',
    gender: '男',
    political: '群众',
    birthday: '2000-02-03',
    ethnicity: '汉族',
    marital: '未婚',
    hometown: '山东省 / 青岛市 / 市北区',
    hometownRegion: '山东省 / 青岛市 / 市北区',
    birthplaceRegion: '浙江省 / 杭州市 / 西湖区',
    householdRegion: '江苏省 / 南京市 / 玄武区',
  }),
  contact: Object.freeze({
    address: '示例通讯地址',
    currentCity: '江苏省 / 南京市 / 玄武区',
    archiveRegion: '山东省 / 济南市 / 历下区',
    phone: 'TEST-MOBILE',
    email: 'applicant@example.invalid',
  }),
  education: Object.freeze([Object.freeze({
    college: '计算机学院',
    cet4Score: '520',
    enrollmentDate: '2022-09',
    graduationDate: '2026-06',
    gpa: '3.8/5',
    majorRankTotal: '120',
    majorRank: '10',
  })]),
  family: Object.freeze(Array.from({ length: 5 }, (_, index) => Object.freeze({
    name: `示例成员${index + 1}`,
    relationship: index % 2 ? '母亲' : '父亲',
    employerPosition: `示例单位${index + 1} 示例职务`,
    phone: `TEST-PHONE-${index + 1}`,
  }))),
  internships: Object.freeze([
    Object.freeze({
      startDate: '2020-09', endDate: '2021-06', company: '示例大学', position: '学生',
    }),
    Object.freeze({
      startDate: '2021-07', endDate: '2022-08', company: '示例单位', position: '实习生',
    }),
  ]),
  papers: Object.freeze([]),
});

const cascaderPlans = Object.freeze([
  Object.freeze({
    id: 'hometown-cascader', label: '籍贯地区（级联）', fieldPath: 'basic.hometownRegion', section: 'basic',
    value: '山东省 / 青岛市 / 市北区', counterKey: 'hometown',
  }),
  Object.freeze({
    id: 'birthplace-region-cascader', label: '出生地', fieldPath: 'basic.birthplaceRegion', section: 'basic',
    value: '浙江省 / 杭州市 / 西湖区', counterKey: 'birthplace',
  }),
  Object.freeze({
    id: 'household-region-cascader', label: '户口所在地', fieldPath: 'basic.householdRegion', section: 'basic',
    value: '江苏省 / 南京市 / 玄武区', counterKey: 'household',
  }),
  Object.freeze({
    id: 'archive-region-cascader', label: '档案所在地', fieldPath: 'contact.archiveRegion', section: 'contact',
    value: '山东省 / 济南市 / 历下区', counterKey: 'archive',
  }),
]);

const paperResumeItem = Object.freeze({
  date: '2026-03',
  title: '通用语义验证论文',
  journalType: '会议论文',
  journal: '示例计算机学报',
  status: '正式发表',
  authorRank: '一作',
});

const awardResumeItems = Object.freeze([
  Object.freeze({
    level: '国家级', rank: '一等奖', name: '通用创新竞赛', participationMode: '团队', individualRank: '2',
  }),
  Object.freeze({
    level: '省部级', rank: '二等奖', name: '通用建模竞赛', participationMode: '个人', individualRank: '1',
  }),
]);

let browser;
let runtimeSources;

before(async () => {
  runtimeSources = await Promise.all(runtimeFiles.map(async relativePath => ({
    relativePath,
    source: await readFile(resolve(projectRoot, relativePath), 'utf8'),
  })));
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
  if (!browser) return;
  const snapshot = await fixtureSnapshot().catch(() => null);
  assert.deepEqual(snapshot?.attemptedNetworkRequests || [], [], 'compound Ant 夹具不得尝试网络请求');
  assert.deepEqual(browser.externalRequests, [], '浏览器页面不得产生 HTTP(S) 请求');
  assert.deepEqual(browser.consoleMessages, [], '严格 CSP 下不得出现 console warning/error');
});

test('Generic Mode + Region Ownership：空 Profile、fixed-five/zero-row 与 competition awards topology 同时保留', async () => {
  await prepareFixture();
  const result = await evaluate(`(async () => {
    window.siteAdapterConfigs = [];
    const profile = JFAdapterRegistry.resolve(window.siteAdapterConfigs, document.location, { source: 'e2e-fixture' });
    const navigation = JFNavigationEngine.createNavigationEngine({ document });
    const adapter = JFGenericAdapter.createAdapter(document, {
      config: profile.config,
      navigationEngine: navigation,
      siteProfile: profile,
    });
    const engine = new JFAutofillEngine.AutofillEngine({
      document,
      adapter,
      navigationEngine: navigation,
      taskStore: {
        async load() { return null; },
        async save(task) { return task; },
        async clear() {},
      },
    });
    const inspection = await engine.inspectSystem({
      scanId: 'scan:compound-main-section',
      timeoutMs: 1_500,
    });
    const engineDiagnosis = engine.diagnoseCurrent();
    const embedded = JFEmbeddedSectionDetector.detect(document);
    const workRowCountBeforeDiagnosis = document.querySelectorAll('#work-history-table tbody tr').length;
    const sectionContext = {
      sectionId: 'basic', section: 'basic', collection: 'basic', collectionMode: 'record',
      source: 'heading', confidence: 1, regionId: 'page:basic', label: '基本信息',
    };
    const diagnosis = adapter.diagnose({
      resume: ${JSON.stringify(resume)},
      sectionContext,
      embeddedSections: embedded,
    });
    return {
      profile: {
        matched: profile.matched,
        adapterId: profile.adapterId,
        profileId: profile.profileId,
        resolution: profile.resolution,
      },
      adapterSiteProfile: diagnosis.siteProfile,
      section: diagnosis.section,
      inspection: {
        sectionId: inspection.sectionContext?.sectionId || null,
        source: inspection.sectionContext?.source || 'unknown',
        pageFieldCount: inspection.fields?.length || 0,
        arbitration: inspection.sectionContext?.arbitration || null,
        regionCollections: (inspection.sectionContext?.regionCandidates || [])
          .map(item => item.collection)
          .sort(),
      },
      engineDiagnosis: {
        detected: engineDiagnosis.section?.detected || null,
        final: engineDiagnosis.sectionDetection?.final || null,
        arbitration: engineDiagnosis.sectionDetection?.arbitration || null,
        embeddedSectionCount: engineDiagnosis.embeddedSections?.length || 0,
      },
      outerGenericText: document.getElementById('outer-generic-copy')?.innerText || '',
      workRowCountBeforeDiagnosis,
      workRowCountAfterDiagnosis: document.querySelectorAll('#work-history-table tbody tr').length,
      workDiagnosis: diagnosis.fields
        .filter(field => field.context?.collection === 'internships')
        .map(field => ({
          index: field.context?.index ?? null,
          regionId: field.context?.regionId || '',
          tableHeader: field.tableHeader || '',
          semanticPlaceholder: field.semanticPlaceholder || '',
          matchedJsonPath: field.matchedJsonPath || '',
          status: field.status,
        })),
      embedded: embedded.map(item => ({
        rootId: item.runtimeRoot?.id || '',
        rootTag: item.runtimeRoot?.tagName?.toLowerCase() || '',
        sectionId: item.sectionId,
        collection: item.collection,
        groupCount: item.groupCount,
        zeroRow: item.zeroRow,
        evidenceScope: item.evidenceScope,
        ownedHeaderCount: item.ownedHeaderCount,
        nestedHeaderCount: item.nestedHeaderCount,
      })),
    };
  })()`, { awaitPromise: true, timeoutMs: 8_000 });

  assert.deepEqual(result.profile, {
    matched: false,
    adapterId: 'generic',
    profileId: '',
    resolution: 'GENERIC',
  });
  assert.equal(result.adapterSiteProfile.matched, false);
  assert.equal(result.adapterSiteProfile.resolution, 'GENERIC');
  assert.equal(result.adapterSiteProfile.id, '');
  assert.equal(result.section.detected, 'basic');
  assert.equal(result.inspection.sectionId, 'basic', JSON.stringify(result.inspection));
  assert.ok(result.inspection.pageFieldCount > 0);
  assert.deepEqual(result.inspection.regionCollections, ['awards', 'family', 'internships', 'papers']);
  assert.equal(result.inspection.arbitration?.reasonCode, 'SECTION_SELECTED');
  assert.equal(result.inspection.arbitration?.selected?.sectionId, 'basic');
  assert.equal(
    result.inspection.arbitration?.candidates?.some(candidate => (
      candidate.sectionId === 'language' && candidate.source === 'field-signature'
    )),
    false,
    JSON.stringify(result.inspection.arbitration),
  );
  assert.equal(result.engineDiagnosis.detected, 'basic');
  assert.equal(result.engineDiagnosis.final, 'basic');
  assert.equal(result.engineDiagnosis.arbitration?.selected?.sectionId, 'basic');
  assert.equal(result.engineDiagnosis.embeddedSectionCount, 4);
  for (const word of ['时间', '内容', '级别', '排名']) {
    assert.match(result.outerGenericText, new RegExp(word));
  }

  assert.deepEqual(
    result.embedded.map(item => item.rootId).sort(),
    ['competition-awards-table', 'family-table', 'papers-table', 'work-history-table'],
    JSON.stringify(result.embedded),
  );
  assert.equal(
    result.embedded.some(item => item.rootId === 'application-shell'),
    false,
    'broad outer 普通文本与 nested headers 均不得把 fieldset 升格为 embedded region',
  );
  assert.equal(
    result.embedded.some(item => ['research', 'practice'].includes(item.collection)),
    false,
    JSON.stringify(result.embedded),
  );

  const family = result.embedded.filter(item => item.collection === 'family');
  assert.equal(family.length, 1, JSON.stringify(result.embedded));
  assert.equal(family[0].rootId, 'family-table');
  assert.equal(family[0].rootTag, 'table');
  assert.equal(family[0].groupCount, 5);
  assert.equal(family[0].zeroRow, false);
  assert.equal(family[0].evidenceScope, 'owned');
  assert.ok(family[0].ownedHeaderCount >= 3);
  assert.equal(family[0].nestedHeaderCount, 0);

  const work = result.embedded.find(item => item.rootId === 'work-history-table');
  assert.equal(work?.collection, 'internships', JSON.stringify(result.embedded));
  assert.equal(work?.groupCount, 5);
  assert.equal(work?.zeroRow, false);
  assert.equal(work?.evidenceScope, 'owned');

  assert.equal(result.workRowCountBeforeDiagnosis, 5);
  assert.equal(result.workRowCountAfterDiagnosis, 5, 'diagnosis 不得删除页面已有工作经历行');
  assert.equal(result.workDiagnosis.length, 20, JSON.stringify(result.workDiagnosis));
  const expectedWorkPaths = [
    'internships[].startDate',
    'internships[].endDate',
    'internships[].company',
    'internships[].position',
  ];
  const workRegionIds = new Set();
  for (let index = 0; index < 5; index += 1) {
    const row = result.workDiagnosis.filter(field => field.index === index);
    assert.equal(row.length, 4, `work row ${index}: ${JSON.stringify(row)}`);
    assert.deepEqual(row.map(field => field.matchedJsonPath), expectedWorkPaths, `work row ${index}`);
    assert.equal(
      row.every(field => field.status === (index < 2 ? 'MATCHED' : 'MISSING_JSON')),
      true,
      `work row ${index}: ${JSON.stringify(row)}`,
    );
    assert.equal(new Set(row.map(field => field.regionId)).size, 1, `work row ${index} context 泄漏`);
    assert.notEqual(row[0].regionId, '');
    workRegionIds.add(row[0].regionId);
  }
  assert.equal(workRegionIds.size, 5, '五个工作经历行必须拥有隔离的 regionId/index context');
  assert.deepEqual(
    result.workDiagnosis.slice(0, 2).map(field => field.semanticPlaceholder),
    ['起始时间', '结束时间'],
  );

  const papers = result.embedded.find(item => item.rootId === 'papers-table');
  assert.equal(papers?.collection, 'papers', JSON.stringify(result.embedded));
  assert.equal(papers?.groupCount, 0);
  assert.equal(papers?.zeroRow, true);

  const awards = result.embedded.find(item => item.rootId === 'competition-awards-table');
  assert.equal(awards?.collection, 'awards', JSON.stringify(result.embedded));
  assert.equal(awards?.groupCount, 2);
  assert.equal(awards?.zeroRow, false);
  assert.equal(awards?.evidenceScope, 'owned');
});

test('FieldContext + Matcher：本地 Ant 标签、真实 family index 与 compound education singleton 共用真实 Runtime', async () => {
  await prepareFixture();
  const result = await evaluate(`(() => {
    const resume = ${JSON.stringify(resume)};
    const shell = document.getElementById('application-shell');
    const embedded = JFEmbeddedSectionDetector.detect(document);
    const sectionContext = {
      sectionId: 'basic', section: 'basic', collection: 'basic', collectionMode: 'record',
      source: 'heading', confidence: 1, regionId: 'page:basic', label: '基本信息',
    };
    const topology = JFGenericAdapter.buildDiagnosticRegions(document, shell, sectionContext, {}, embedded);
    const fields = JFFieldDetector.scan(shell, {
      section: 'basic',
      sectionContext,
      regions: topology.regions,
    });
    const byId = id => fields.find(field => field.element?.id === id);
    const summarize = id => {
      const descriptor = byId(id);
      const match = JFFieldMatcher.matchField(descriptor, resume, {
        section: 'basic',
        resumeView: JFFieldAliases.buildResumeView(resume),
      });
      return {
        id,
        found: Boolean(descriptor),
        labelText: descriptor?.labelText || '',
        labelSource: descriptor?.labelSource || '',
        collection: descriptor?.context?.collection || '',
        contextIndex: descriptor?.context?.index ?? null,
        status: match.status,
        matchedPath: match.matchedPath || '',
        scopeCollection: match.scope?.collection || '',
        scopeMode: match.scope?.collectionMode || '',
        scopeIndex: match.scope?.index ?? null,
      };
    };
    const familyRows = [...document.querySelectorAll('#family-table tbody tr')];
    const familyNames = [familyRows[0], familyRows[4]].map(row => {
      const element = row.querySelector('input');
      const descriptor = fields.find(field => field.element === element);
      const match = JFFieldMatcher.matchField(descriptor, resume, {
        resumeView: JFFieldAliases.buildResumeView(resume),
      });
      return {
        contextCollection: descriptor?.context?.collection || '',
        contextIndex: descriptor?.context?.index ?? null,
        regionId: descriptor?.context?.regionId || '',
        status: match.status,
        matchedPath: match.matchedPath || '',
        scopeIndex: match.scope?.index ?? null,
      };
    });
    const work = document.querySelector('#work-history-table tbody input');
    const workDescriptor = fields.find(field => field.element === work);
    return {
      fields: [
        summarize('name'),
        summarize('name-pinyin'),
        summarize('id-type'),
        summarize('id-number'),
        summarize('gender'),
        summarize('political'),
        summarize('ethnicity'),
        summarize('marital'),
        summarize('phone'),
        summarize('email'),
        summarize('college'),
        summarize('enrollment'),
        summarize('graduation'),
      ],
      familyNames,
      workContext: {
        collection: workDescriptor?.context?.collection || '',
        index: workDescriptor?.context?.index ?? null,
        regionId: workDescriptor?.context?.regionId || '',
      },
      regionRoots: topology.regions.map(region => ({
        rootId: region.root?.id || region.runtimeRoot?.id || '',
        embedded: Boolean(region.embedded),
        collection: region.collection || '',
      })),
      totalRegions: topology.regions.length,
    };
  })()`);

  const expectedPaths = new Map([
    ['name', 'basic.name'],
    ['name-pinyin', 'basic.namePinyin'],
    ['id-type', 'basic.idType'],
    ['id-number', 'basic.idNumber'],
    ['gender', 'basic.gender'],
    ['political', 'basic.political'],
    ['ethnicity', 'basic.ethnicity'],
    ['marital', 'basic.marital'],
    ['phone', 'contact.phone'],
    ['email', 'contact.email'],
    ['college', 'education[].college'],
    ['enrollment', 'education[].enrollmentDate'],
    ['graduation', 'education[].graduationDate'],
  ]);
  for (const field of result.fields) {
    assert.equal(field.found, true, field.id);
    assert.notEqual(field.labelText, '', `${field.id} labelText`);
    assert.notEqual(field.labelSource, '', `${field.id} labelSource`);
    assert.equal(field.status, 'MATCHED', `${field.id}: ${JSON.stringify(field)}`);
    assert.equal(field.matchedPath, expectedPaths.get(field.id), field.id);
    assert.notEqual(field.collection, 'family', `${field.id} 不得被 outer fieldset 污染`);
  }
  assert.equal(result.fields.find(field => field.id === 'id-number')?.labelSource, 'form-item-label');

  for (const [position, family] of result.familyNames.entries()) {
    const expectedIndex = position === 0 ? 0 : 4;
    assert.equal(family.contextCollection, 'family');
    assert.equal(family.contextIndex, expectedIndex);
    assert.notEqual(family.regionId, '');
    assert.equal(family.status, 'MATCHED', JSON.stringify(family));
    assert.equal(family.matchedPath, 'family[].name');
    assert.equal(family.scopeIndex, expectedIndex);
  }
  assert.equal(result.workContext.collection, 'internships');
  assert.equal(result.workContext.index, 0);
  assert.notEqual(result.workContext.regionId, '');
  assert.equal(
    result.regionRoots.some(region => region.rootId === 'application-shell' && region.embedded),
    false,
    JSON.stringify(result.regionRoots),
  );
  for (const rootId of ['family-table', 'work-history-table', 'papers-table', 'competition-awards-table']) {
    assert.equal(
      result.regionRoots.some(region => region.rootId === rootId && region.embedded),
      true,
      `${rootId}: ${JSON.stringify(result.regionRoots)}`,
    );
  }

  for (const id of ['college', 'enrollment', 'graduation']) {
    const field = result.fields.find(item => item.id === id);
    assert.equal(field.collection, 'basic', `${id} 的页面 Context 仍是 compound main basic`);
    assert.equal(field.scopeCollection, 'education');
    assert.equal(field.scopeMode, 'singleton-view');
    assert.equal(field.scopeIndex, 0);
  }
});

test('Custom Select Semantic Ownership：五个 Ant wrapper 各绑定自己的 label/path 并经 Generic Runtime 成功填写', async () => {
  await prepareFixture();
  const result = await evaluate(`(async () => {
    const resume = ${JSON.stringify(resume)};
    const shell = document.getElementById('application-shell');
    const sectionContext = {
      sectionId: 'basic', section: 'basic', collection: 'basic', collectionMode: 'record',
      source: 'heading', confidence: 1, regionId: 'page:basic',
    };
    const topology = JFGenericAdapter.buildDiagnosticRegions(
      document,
      shell,
      sectionContext,
      {},
      JFEmbeddedSectionDetector.detect(document),
    );
    const fields = JFFieldDetector.scan(shell, {
      section: 'basic', sectionContext, regions: topology.regions,
    });
    const plans = [
      ['id-type', '证件类型', 'basic.idType', '居民身份证'],
      ['gender', '性别', 'basic.gender', '男'],
      ['political', '政治面貌', 'basic.political', '群众'],
      ['ethnicity', '民族', 'basic.ethnicity', '汉族'],
      ['marital', '婚姻状况', 'basic.marital', '未婚'],
    ];
    const executions = [];
    for (const [id, label, fieldPath, value] of plans) {
      const owned = fields.filter(field => field.element?.id === id);
      const descriptor = owned[0];
      const match = JFFieldMatcher.matchField(descriptor, resume, {
        section: 'basic', resumeView: JFFieldAliases.buildResumeView(resume),
      });
      const execution = await JFFormFiller.fill(descriptor, value, {
        fieldPath, expectedType: 'choice', allowOverwrite: false, customSelectTimeoutMs: 300,
      });
      const diagnostic = JFFieldDetector.toDiagnostic(descriptor);
      executions.push({
        id, label, fieldPath,
        descriptorCount: owned.length,
        internalDescriptorCount: fields.filter(field => field.element?.id === id + '-input').length,
        mirrorDescriptorCount: fields.filter(field => field.element?.id === id + '-mirror-input').length,
        labelText: descriptor?.labelText || '',
        labelSource: descriptor?.labelSource || '',
        controlKind: descriptor?.controlKind || '',
        semanticOwnershipDebug: descriptor?.semanticOwnershipDebug || null,
        diagnosticSemanticOwnershipDebug: diagnostic?.semanticOwnershipDebug || null,
        matchedPath: match.matchedPath || '',
        matchStatus: match.status,
        status: execution.status,
        actual: JFEventDispatcher.readControlValue(descriptor),
      });
    }
    const beforeRerun = window.__compoundAntFixture.snapshot();
    const reruns = [];
    for (const [id, , fieldPath, value] of plans) {
      const descriptor = fields.find(field => field.element?.id === id);
      const rerun = await JFFormFiller.fill(descriptor, value, {
        fieldPath, expectedType: 'choice', allowOverwrite: false,
      });
      reruns.push({ id, status: rerun.status });
    }
    return {
      executions,
      reruns,
      beforeRerun,
      afterRerun: window.__compoundAntFixture.snapshot(),
      openListboxes: [...document.querySelectorAll('.ant-select-dropdown[role="listbox"]')]
        .filter(item => !item.hidden).length,
    };
  })()`, { awaitPromise: true, timeoutMs: 5_000 });

  for (const execution of result.executions) {
    assert.equal(execution.descriptorCount, 1, execution.id);
    assert.equal(execution.internalDescriptorCount, 0, execution.id);
    assert.equal(execution.mirrorDescriptorCount, 0, execution.id);
    assert.equal(execution.labelText, execution.label, execution.id);
    assert.notEqual(execution.labelSource, '', execution.id);
    assert.equal(execution.controlKind, 'custom-select', execution.id);
    assert.equal(execution.matchStatus, 'MATCHED', JSON.stringify(execution));
    assert.equal(execution.matchedPath, execution.fieldPath, execution.id);
    assert.equal(execution.status, 'SUCCESS', JSON.stringify(execution));
    assert.notEqual(execution.actual, '', execution.id);
    assert.deepEqual(execution.semanticOwnershipDebug, {
      logicalControlCount: 1,
      formItemFound: true,
      formItemLabelFound: true,
      ownershipReason: 'single-logical-field',
    }, execution.id);
    assert.deepEqual(execution.diagnosticSemanticOwnershipDebug, execution.semanticOwnershipDebug, execution.id);
  }
  for (const rerun of result.reruns) assert.equal(rerun.status, 'SKIPPED_EXISTING', rerun.id);
  assert.deepEqual(result.beforeRerun.customSelectOpenClicks, {
    idType: 1, gender: 1, political: 1, ethnicity: 1, marital: 1,
  });
  assert.deepEqual(result.beforeRerun.customSelectOptionClicks, {
    idType: 1, gender: 1, political: 1, ethnicity: 1, marital: 1,
  });
  assert.deepEqual(result.afterRerun.customSelectOpenClicks, result.beforeRerun.customSelectOpenClicks);
  assert.deepEqual(result.afterRerun.customSelectOptionClicks, result.beforeRerun.customSelectOptionClicks);
  assert.equal(result.openListboxes, 0);
  assertSafetyCounters(result.afterRerun);
});

test('Cascader：同页四个三级地区控件各自在原 owned overlay 追加 1→2→3 列', async () => {
  await prepareFixture();
  const result = await evaluate(`(async () => {
    const resume = ${JSON.stringify(resume)};
    const plans = ${JSON.stringify(cascaderPlans)};
    const shell = document.getElementById('application-shell');
    const sectionContext = {
      sectionId: 'basic', section: 'basic', collection: 'basic', collectionMode: 'record',
      source: 'heading', confidence: 1, regionId: 'page:basic',
    };
    const topology = JFGenericAdapter.buildDiagnosticRegions(
      document, shell, sectionContext, {}, JFEmbeddedSectionDetector.detect(document),
    );
    const fields = JFFieldDetector.scan(shell, {
      section: 'basic', sectionContext, regions: topology.regions,
    });
    const initialMenuCounts = Object.fromEntries(plans.map(plan => [
      plan.id,
      document.getElementById(plan.id + '-panel')?.querySelectorAll('.ant-cascader-menu').length || 0,
    ]));
    const executions = [];
    for (const plan of plans) {
      const descriptor = fields.find(field => field.element?.id === plan.id);
      const match = JFFieldMatcher.matchField(descriptor, resume, {
        section: plan.section, resumeView: JFFieldAliases.buildResumeView(resume),
      });
      const resolution = JFControlAdapterRegistry.resolve(descriptor, {
        fieldPath: plan.fieldPath, expectedType: 'text',
      });
      const execution = await JFFormFiller.fill(descriptor, plan.value, {
        fieldPath: plan.fieldPath, expectedType: 'text', allowOverwrite: false, cascaderTimeoutMs: 500,
      });
      const diagnostic = JFFieldDetector.toDiagnostic(descriptor);
      executions.push({
        id: plan.id,
        label: plan.label,
        fieldPath: plan.fieldPath,
        descriptorCount: fields.filter(field => field.element?.id === plan.id).length,
        internalDescriptorCount: fields.filter(field => field.element?.id === plan.id + '-input').length,
        labelText: descriptor?.labelText || '',
        controlKind: descriptor?.controlKind || '',
        triggerControls: descriptor?.cascaderTrigger?.getAttribute?.('aria-controls') || '',
        adapterId: resolution.adapterId,
        matchStatus: match.status,
        matchedPath: match.matchedPath || '',
        status: execution.status,
        actual: JFEventDispatcher.readControlValue(descriptor),
        cascaderDebug: diagnostic?.cascaderDebug || null,
        visiblePanelsAfter: [...document.querySelectorAll('.ant-cascader-menus')]
          .filter(panel => !panel.hidden).map(panel => panel.id),
      });
    }
    const beforeRerun = window.__compoundAntFixture.snapshot();
    const reruns = [];
    for (const plan of plans) {
      const descriptor = fields.find(field => field.element?.id === plan.id);
      const rerun = await JFFormFiller.fill(descriptor, plan.value, {
        fieldPath: plan.fieldPath, expectedType: 'text', allowOverwrite: false,
      });
      reruns.push({ id: plan.id, status: rerun.status });
    }
    const beforeConflicts = window.__compoundAntFixture.snapshot();
    const conflicts = [];
    for (const plan of plans) {
      const descriptor = fields.find(field => field.element?.id === plan.id);
      const conflict = await JFFormFiller.fill(descriptor, '浙江省 / 宁波市 / 海曙区', {
        fieldPath: plan.fieldPath, expectedType: 'text', allowOverwrite: false,
      });
      conflicts.push({
        id: plan.id,
        status: conflict.status,
        actual: JFEventDispatcher.readControlValue(descriptor),
      });
    }
    return {
      executions,
      reruns,
      conflicts,
      initialMenuCounts,
      beforeRerun,
      beforeConflicts,
      afterRerun: window.__compoundAntFixture.snapshot(),
      openPanels: [...document.querySelectorAll('.ant-cascader-menus')]
        .filter(panel => !panel.hidden).map(panel => panel.id),
    };
  })()`, { awaitPromise: true, timeoutMs: 8_000 });

  assert.deepEqual(result.initialMenuCounts, Object.fromEntries(
    cascaderPlans.map(plan => [plan.id, 1]),
  ));

  for (const execution of result.executions) {
    assert.equal(execution.descriptorCount, 1, execution.id);
    assert.equal(execution.internalDescriptorCount, 0, execution.id);
    assert.equal(execution.labelText, execution.label, execution.id);
    assert.equal(execution.controlKind, 'cascader', execution.id);
    assert.equal(execution.triggerControls, `${execution.id}-panel`, execution.id);
    assert.equal(execution.adapterId, 'cascader', execution.id);
    assert.equal(execution.matchStatus, 'MATCHED', JSON.stringify(execution));
    assert.equal(execution.matchedPath, execution.fieldPath, execution.id);
    assert.equal(execution.status, 'SUCCESS', JSON.stringify(execution));
    assert.equal(execution.actual, cascaderPlans.find(plan => plan.id === execution.id)?.value, execution.id);
    assert.deepEqual(execution.cascaderDebug, {
      levelCount: 3,
      selectedLevelCount: 3,
      panelOwnership: 'aria-controls',
      ambiguityReason: '',
      overlayIdentityStable: true,
      menuCountBefore: 2,
      menuCountAfter: 3,
      visibleMenuCountBefore: 2,
      visibleMenuCountAfter: 3,
      newMenuIndexes: [2],
      newMenuCount: 1,
      optionSetChanged: true,
      rebindStrategy: 'same-overlay',
      rebindFailureReason: '',
    }, execution.id);
    assert.deepEqual(execution.visiblePanelsAfter, [], execution.id);
  }
  for (const rerun of result.reruns) assert.equal(rerun.status, 'SKIPPED_EXISTING', rerun.id);
  for (const conflict of result.conflicts) {
    assert.equal(conflict.status, 'CONFLICT', conflict.id);
    assert.equal(conflict.actual, cascaderPlans.find(plan => plan.id === conflict.id)?.value, conflict.id);
  }
  assert.deepEqual(result.beforeRerun.cascaderTriggerClicks, {
    hometown: 1, birthplace: 1, household: 1, archive: 1,
  });
  assert.deepEqual(result.beforeRerun.cascaderOptionClicks, {
    hometown: [1, 1, 1],
    birthplace: [1, 1, 1],
    household: [1, 1, 1],
    archive: [1, 1, 1],
  });
  assert.deepEqual(result.afterRerun.cascaderTriggerClicks, result.beforeRerun.cascaderTriggerClicks);
  assert.deepEqual(result.afterRerun.cascaderOptionClicks, result.beforeRerun.cascaderOptionClicks);
  assert.deepEqual(result.afterRerun.cascaderTriggerClicks, result.beforeConflicts.cascaderTriggerClicks);
  assert.deepEqual(result.afterRerun.cascaderOptionClicks, result.beforeConflicts.cascaderOptionClicks);
  assert.deepEqual(result.openPanels, []);
  assertSafetyCounters(result.afterRerun);
});

test('Repeatable Action Boundary：fallback table 继续向上找到唯一 sibling Add，并按 fresh rescan 完成 papers 0→2', async () => {
  await prepareFixture();
  const result = await evaluate(`(async () => {
    const embedded = JFEmbeddedSectionDetector.detect(document);
    const papers = embedded.find(section => section.collection === 'papers');
    const regionRoot = papers?.runtimeRoot;
    const actionOwnershipDebug = JFArrayHandler.inspectActionOwnership(regionRoot, 'papers', {
      addRoot: regionRoot,
      actionSearchBoundary: document.getElementById('application-shell'),
      regionId: papers?.regionId || 'papers:table:0',
      zeroRow: true,
      embeddedRegions: embedded.map(section => section.runtimeRoot),
    });
    const prepared = await JFArrayHandler.prepare(
      { sectionId: 'papers', section: 'papers', collection: 'papers', collectionMode: 'repeatable' },
      [{}, {}],
      regionRoot,
      {
        collectionMode: 'repeatable',
        // Simulate detectSectionRoot's unresolved fallback. The table is the
        // regionRoot; it must not become the ancestor-search hard boundary.
        addRoot: regionRoot,
        actionSearchBoundary: document.getElementById('application-shell'),
        embeddedRegions: embedded.map(section => section.runtimeRoot),
        timeoutMs: 500,
      },
    );
    return {
      actionOwnershipDebug,
      prepared: {
        ok: prepared.ok,
        initialCount: prepared.initialCount,
        count: prepared.count,
        clicks: prepared.clicks,
        indexes: (prepared.groupContexts || []).map(context => context.index),
      },
      fixture: window.__compoundAntFixture.snapshot(),
    };
  })()`, { awaitPromise: true, timeoutMs: 8_000 });

  assert.equal(result.actionOwnershipDebug.selectedOwnerDepth, 1);
  assert.equal(result.actionOwnershipDebug.localAddCandidateCount, 1);
  assert.equal(result.actionOwnershipDebug.acceptedAddCandidateCount, 1);
  assert.equal(result.actionOwnershipDebug.finalReasonCode, 'ACTION_OWNER_RESOLVED');
  assert.deepEqual(result.prepared, {
    ok: true,
    initialCount: 0,
    count: 2,
    clicks: 2,
    indexes: [0, 1],
  });
  assertSafetyCounters(result.fixture, { addPaper: 2 });
});

test('Repeatable Action Boundary：zero-row awards 只用本区 sibling Add，并有界增长到七行', async () => {
  await prepareFixture();
  const result = await evaluate(`(async () => {
    document.querySelector('#competition-awards-table tbody').replaceChildren();
    const embedded = JFEmbeddedSectionDetector.detect(document);
    const awards = embedded.find(section => section.collection === 'awards');
    const regionRoot = awards?.runtimeRoot;
    const actionOwnershipDebug = JFArrayHandler.inspectActionOwnership(regionRoot, 'awards', {
      addRoot: regionRoot,
      actionSearchBoundary: document.getElementById('application-shell'),
      regionId: awards?.regionId || 'awards:table:0',
      zeroRow: true,
      embeddedRegions: embedded.map(section => section.runtimeRoot),
    });
    const prepared = await JFArrayHandler.prepare(
      { sectionId: 'awards', section: 'awards', collection: 'awards', collectionMode: 'repeatable' },
      Array.from({ length: 7 }, () => ({})),
      regionRoot,
      {
        collectionMode: 'repeatable',
        addRoot: regionRoot,
        actionSearchBoundary: document.getElementById('application-shell'),
        embeddedRegions: embedded.map(section => section.runtimeRoot),
        maxAdds: 7,
        timeoutMs: 500,
      },
    );
    return {
      actionOwnershipDebug,
      prepared: {
        ok: prepared.ok,
        initialCount: prepared.initialCount,
        count: prepared.count,
        clicks: prepared.clicks,
        indexes: (prepared.groupContexts || []).map(context => context.index),
      },
      fixture: window.__compoundAntFixture.snapshot(),
    };
  })()`, { awaitPromise: true, timeoutMs: 10_000 });

  assert.equal(result.actionOwnershipDebug.selectedOwnerDepth, 1);
  assert.equal(result.actionOwnershipDebug.localAddCandidateCount, 1);
  assert.equal(result.actionOwnershipDebug.acceptedAddCandidateCount, 1);
  assert.equal(result.actionOwnershipDebug.finalReasonCode, 'ACTION_OWNER_RESOLVED');
  assert.deepEqual(result.prepared, {
    ok: true,
    initialCount: 0,
    count: 7,
    clicks: 7,
    indexes: [0, 1, 2, 3, 4, 5, 6],
  });
  assertSafetyCounters(result.fixture, { addAward: 7 });
});

test('Papers：zero-row 安全恢复首行，fresh Context 区分 journalType/journal/status/authorRank 并复用字段词表', async () => {
  await prepareFixture();
  const result = await evaluate(`(async () => {
    const item = ${JSON.stringify(paperResumeItem)};
    const resume = { papers: [item] };
    const initialEmbedded = JFEmbeddedSectionDetector.detect(document);
    const initialPapers = initialEmbedded.find(section => section.collection === 'papers');
    const prepared = await JFArrayHandler.prepare(
      { sectionId: 'papers', section: 'papers', collection: 'papers', collectionMode: 'repeatable' },
      resume.papers,
      initialPapers?.runtimeRoot,
      {
        collectionMode: 'repeatable',
        addRoot: initialPapers?.runtimeRoot?.parentElement,
        timeoutMs: 500,
      },
    );
    const freshEmbedded = JFEmbeddedSectionDetector.detect(document);
    const freshPapers = freshEmbedded.find(section => section.collection === 'papers');
    const shell = document.getElementById('application-shell');
    const sectionContext = {
      sectionId: 'basic', section: 'basic', collection: 'basic', collectionMode: 'record',
      source: 'heading', confidence: 1, regionId: 'page:basic',
    };
    const topology = JFGenericAdapter.buildDiagnosticRegions(
      document, shell, sectionContext, {}, freshEmbedded,
    );
    const fields = JFFieldDetector.scan(shell, {
      section: 'basic', sectionContext, regions: topology.regions,
    });
    const resumeView = JFFieldAliases.buildResumeView(resume);
    const paperFields = fields.filter(field => field.context?.collection === 'papers');
    const matched = paperFields.map(descriptor => ({
      descriptor,
      match: JFFieldMatcher.matchField(descriptor, resume, {
        section: 'papers', sectionContext: descriptor.context, resumeView,
      }),
    }));
    const plans = [
      ['papers[].date', item.date, 'date'],
      ['papers[].title', item.title, 'text'],
      ['papers[].journalType', item.journalType, 'choice'],
      ['papers[].journal', item.journal, 'text'],
      ['papers[].status', item.status, 'choice'],
      ['papers[].authorRank', item.authorRank, 'choice'],
    ];
    const executions = [];
    for (const [fieldPath, value, expectedType] of plans) {
      const candidates = matched.filter(entry => entry.match.matchedPath === fieldPath);
      const descriptor = candidates[0]?.descriptor;
      const execution = await JFFormFiller.fill(descriptor, value, {
        fieldPath, expectedType, allowOverwrite: false,
      });
      executions.push({
        fieldPath,
        candidateCount: candidates.length,
        index: descriptor?.context?.index ?? null,
        regionId: descriptor?.context?.regionId || '',
        controlKind: descriptor?.controlKind || '',
        status: execution.status,
        actual: JFEventDispatcher.readControlValue(descriptor),
        optionMatchingDebug: execution.optionMatchingDebug || null,
      });
    }
    const beforeRerun = window.__compoundAntFixture.snapshot();
    const reruns = [];
    for (const [fieldPath, value, expectedType] of plans) {
      const descriptor = matched.find(entry => entry.match.matchedPath === fieldPath)?.descriptor;
      const rerun = await JFFormFiller.fill(descriptor, value, {
        fieldPath, expectedType, allowOverwrite: false,
      });
      reruns.push({ fieldPath, status: rerun.status });
    }
    return {
      initial: {
        found: Boolean(initialPapers),
        groupCount: initialPapers?.groupCount ?? null,
        zeroRow: initialPapers?.zeroRow ?? null,
      },
      prepared: {
        ok: prepared.ok,
        initialCount: prepared.initialCount,
        count: prepared.count,
        clicks: prepared.clicks,
        groupContextIndexes: (prepared.groupContexts || []).map(context => context.index),
      },
      fresh: {
        found: Boolean(freshPapers),
        groupCount: freshPapers?.groupCount ?? null,
        zeroRow: freshPapers?.zeroRow ?? null,
      },
      matchedPaths: matched.map(entry => entry.match.matchedPath || '').filter(Boolean),
      executions,
      reruns,
      beforeRerun,
      afterRerun: window.__compoundAntFixture.snapshot(),
    };
  })()`, { awaitPromise: true, timeoutMs: 8_000 });

  assert.deepEqual(result.initial, { found: true, groupCount: 0, zeroRow: true });
  assert.deepEqual(result.prepared, {
    ok: true,
    initialCount: 0,
    count: 1,
    clicks: 1,
    groupContextIndexes: [0],
  });
  assert.deepEqual(result.fresh, { found: true, groupCount: 1, zeroRow: false });
  for (const fieldPath of [
    'papers[].journalType', 'papers[].journal', 'papers[].status', 'papers[].authorRank',
  ]) {
    assert.equal(result.matchedPaths.filter(path => path === fieldPath).length, 1, fieldPath);
  }
  for (const execution of result.executions) {
    assert.equal(execution.candidateCount, 1, execution.fieldPath);
    assert.equal(execution.index, 0, execution.fieldPath);
    assert.notEqual(execution.regionId, '', execution.fieldPath);
    assert.equal(execution.status, 'SUCCESS', JSON.stringify(execution));
  }
  for (const fieldPath of ['papers[].journalType', 'papers[].status', 'papers[].authorRank']) {
    const debug = result.executions.find(execution => execution.fieldPath === fieldPath)?.optionMatchingDebug;
    assert.ok(debug, fieldPath);
    assert.deepEqual(Object.keys(debug).sort(), [
      'bestOptionLabel', 'bestScore', 'canonicalCandidates', 'expectedCanonical',
      'expectedShape', 'fieldPath', 'margin', 'matchedCanonical',
      'normalizedOptionLabels', 'optionCount', 'reasonCode', 'secondBestScore',
      'threshold',
    ].sort(), fieldPath);
    assert.equal(debug.fieldPath, fieldPath);
    assert.equal(debug.reasonCode, 'OPTION_MATCHED');
    assert.ok(debug.optionCount >= 2, fieldPath);
    assert.doesNotMatch(JSON.stringify(debug), /selectedOption|rawExpected|outerHTML|cookie|token/i);
  }
  assert.equal(
    result.executions.find(execution => execution.fieldPath === 'papers[].status')?.actual,
    'published',
  );
  assert.equal(
    result.executions.find(execution => execution.fieldPath === 'papers[].authorRank')?.actual,
    '1',
  );
  for (const rerun of result.reruns) assert.equal(rerun.status, 'SKIPPED_EXISTING', rerun.fieldPath);
  assert.equal(result.beforeRerun.paperRows, 1);
  assert.equal(result.afterRerun.paperRows, 1);
  assertSafetyCounters(result.afterRerun, { addPaper: 1 });
});

test('Competition Awards：五个语义列按两行 index 隔离填写，个人排名不占 teamRank 且不新增/删除', async () => {
  await prepareFixture();
  const result = await evaluate(`(async () => {
    const items = ${JSON.stringify(awardResumeItems)};
    const resume = { awards: items };
    const embedded = JFEmbeddedSectionDetector.detect(document);
    const awardsRegion = embedded.find(section => section.collection === 'awards');
    const prepared = await JFArrayHandler.prepare(
      { sectionId: 'awards', section: 'awards', collection: 'awards', collectionMode: 'repeatable' },
      items,
      awardsRegion?.runtimeRoot,
      {
        collectionMode: 'repeatable',
        addRoot: awardsRegion?.runtimeRoot?.parentElement,
        timeoutMs: 500,
      },
    );
    const shell = document.getElementById('application-shell');
    const sectionContext = {
      sectionId: 'basic', section: 'basic', collection: 'basic', collectionMode: 'record',
      source: 'heading', confidence: 1, regionId: 'page:basic',
    };
    const topology = JFGenericAdapter.buildDiagnosticRegions(
      document, shell, sectionContext, {}, JFEmbeddedSectionDetector.detect(document),
    );
    const fields = JFFieldDetector.scan(shell, {
      section: 'basic', sectionContext, regions: topology.regions,
    });
    const resumeView = JFFieldAliases.buildResumeView(resume);
    const awardsFields = fields.filter(field => field.context?.collection === 'awards');
    const matched = awardsFields.map(descriptor => ({
      descriptor,
      match: JFFieldMatcher.matchField(descriptor, resume, {
        section: 'awards', sectionContext: descriptor.context, resumeView,
      }),
    }));
    const fieldPlans = [
      ['awards[].level', 'level', 'choice'],
      ['awards[].rank', 'rank', 'choice'],
      ['awards[].name', 'name', 'text'],
      ['awards[].participationMode', 'participationMode', 'choice'],
      ['awards[].individualRank', 'individualRank', 'text'],
    ];
    const executions = [];
    for (let index = 0; index < items.length; index += 1) {
      for (const [fieldPath, key, expectedType] of fieldPlans) {
        const candidates = matched.filter(entry =>
          entry.descriptor.context?.index === index && entry.match.matchedPath === fieldPath);
        const descriptor = candidates[0]?.descriptor;
        const execution = await JFFormFiller.fill(descriptor, items[index][key], {
          fieldPath, expectedType, allowOverwrite: false,
        });
        executions.push({
          index,
          fieldPath,
          candidateCount: candidates.length,
          regionId: descriptor?.context?.regionId || '',
          status: execution.status,
          actual: JFEventDispatcher.readControlValue(descriptor),
        });
      }
    }
    const beforeRerun = window.__compoundAntFixture.snapshot();
    const reruns = [];
    for (let index = 0; index < items.length; index += 1) {
      for (const [fieldPath, key, expectedType] of fieldPlans) {
        const descriptor = matched.find(entry =>
          entry.descriptor.context?.index === index && entry.match.matchedPath === fieldPath)?.descriptor;
        const rerun = await JFFormFiller.fill(descriptor, items[index][key], {
          fieldPath, expectedType, allowOverwrite: false,
        });
        reruns.push({ index, fieldPath, status: rerun.status });
      }
    }
    return {
      region: {
        found: Boolean(awardsRegion),
        collection: awardsRegion?.collection || '',
        groupCount: awardsRegion?.groupCount ?? null,
        zeroRow: awardsRegion?.zeroRow ?? null,
      },
      prepared: {
        ok: prepared.ok,
        initialCount: prepared.initialCount,
        count: prepared.count,
        clicks: prepared.clicks,
        groupContextIndexes: (prepared.groupContexts || []).map(context => context.index),
      },
      pathsByIndex: Object.fromEntries([0, 1].map(index => [index, matched
        .filter(entry => entry.descriptor.context?.index === index)
        .map(entry => entry.match.matchedPath || '').filter(Boolean)])),
      executions,
      reruns,
      beforeRerun,
      afterRerun: window.__compoundAntFixture.snapshot(),
    };
  })()`, { awaitPromise: true, timeoutMs: 8_000 });

  assert.deepEqual(result.region, { found: true, collection: 'awards', groupCount: 2, zeroRow: false });
  assert.deepEqual(result.prepared, {
    ok: true,
    initialCount: 2,
    count: 2,
    clicks: 0,
    groupContextIndexes: [0, 1],
  });
  const expectedPaths = [
    'awards[].level',
    'awards[].rank',
    'awards[].name',
    'awards[].participationMode',
    'awards[].individualRank',
  ];
  for (const index of [0, 1]) {
    for (const fieldPath of expectedPaths) {
      assert.equal(result.pathsByIndex[index].filter(path => path === fieldPath).length, 1, `${index}:${fieldPath}`);
    }
    assert.equal(result.pathsByIndex[index].includes('awards[].teamRank'), false, `row ${index}`);
  }
  for (const execution of result.executions) {
    assert.equal(execution.candidateCount, 1, `${execution.index}:${execution.fieldPath}`);
    assert.notEqual(execution.regionId, '', `${execution.index}:${execution.fieldPath}`);
    assert.equal(execution.status, 'SUCCESS', JSON.stringify(execution));
  }
  assert.equal(
    result.executions.find(execution => execution.index === 1 && execution.fieldPath === 'awards[].level')?.actual,
    '省级',
    '省部级 JSON 应以 option alias 选择页面省级',
  );
  for (const rerun of result.reruns) {
    assert.equal(rerun.status, 'SKIPPED_EXISTING', `${rerun.index}:${rerun.fieldPath}`);
  }
  assert.equal(result.beforeRerun.awardRows, 2);
  assert.equal(result.afterRerun.awardRows, 2);
  assertSafetyCounters(result.afterRerun);
});

test('ReadOnly Date：三个字段都路由 DateLike，执行只打开自身 aria-controls 面板', async () => {
  await prepareFixture();
  const result = await evaluate(`(async () => {
    const urlBefore = location.href;
    const hashBefore = location.hash;
    const shell = document.getElementById('application-shell');
    const sectionContext = {
      sectionId: 'basic', section: 'basic', collection: 'basic', collectionMode: 'record',
      source: 'heading', confidence: 1, regionId: 'page:basic',
    };
    const topology = JFGenericAdapter.buildDiagnosticRegions(
      document,
      shell,
      sectionContext,
      {},
      JFEmbeddedSectionDetector.detect(document),
    );
    const fields = JFFieldDetector.scan(shell, {
      section: 'basic', sectionContext, regions: topology.regions,
    });
    const dateCases = [
      ['birthday', 'basic.birthday'],
      ['enrollment', 'education[].enrollmentDate'],
      ['graduation', 'education[].graduationDate'],
    ].map(([id, fieldPath]) => {
      const descriptor = fields.find(field => field.element?.id === id);
      const resolution = JFControlAdapterRegistry.resolve(descriptor, { fieldPath, expectedType: 'date' });
      return {
        id,
        fieldPath,
        readOnly: descriptor?.readOnly,
        interactiveReadonly: descriptor?.interactiveReadonly,
        readonlyInteractionKind: descriptor?.readonlyInteractionKind,
        triggerControls: descriptor?.datePickerTrigger?.getAttribute?.('aria-controls') || '',
        ambiguous: descriptor?.datePickerAmbiguous,
        adapterId: resolution.adapterId,
      };
    });
    const viewerClicks = { previous: 0, next: 0 };
    const viewerButtons = document.querySelectorAll('#image-viewer button');
    viewerButtons[0].addEventListener('click', () => { viewerClicks.previous += 1; });
    viewerButtons[1].addEventListener('click', () => { viewerClicks.next += 1; });
    const executionPlans = [
      ['birthday', '2000-02-03', 'basic.birthday'],
      ['enrollment', '2022-09', 'education[].enrollmentDate'],
      ['graduation', '2026-06', 'education[].graduationDate'],
    ];
    const executions = [];
    for (const [id, value, fieldPath] of executionPlans) {
      const descriptor = fields.find(field => field.element?.id === id);
      const execution = await JFControlAdapterRegistry.execute(descriptor, value, {
        fieldPath,
        expectedType: 'date',
        datePickerTimeoutMs: 250,
        maxYearNavigationSteps: 4,
        maxCalendarModeTransitions: 4,
      });
      executions.push({
        id,
        adapterId: execution.adapterId,
        status: execution.status,
        strategy: execution.strategy,
        value: descriptor.element.value,
        datePickerDebug: JFDateLikeAdapter.getDebugTrace(descriptor),
      });
    }
    const triggerCountsBeforeRerun = window.__compoundAntFixture.snapshot().dateTriggerClicks;
    const reruns = [];
    for (const [id, value, fieldPath] of executionPlans) {
      const descriptor = fields.find(field => field.element?.id === id);
      const rerun = await JFFormFiller.fill(descriptor, value, {
        fieldPath,
        expectedType: 'date',
        allowOverwrite: false,
      });
      const currentTriggerCount = window.__compoundAntFixture.snapshot().dateTriggerClicks[id];
      reruns.push({
        id,
        status: rerun.status,
        triggerClickDelta: currentTriggerCount - triggerCountsBeforeRerun[id],
      });
    }
    return {
      dateCases,
      executions,
      reruns,
      panels: {
        birthdayHidden: document.getElementById('birthday-panel').hidden,
        enrollmentHidden: document.getElementById('enrollment-panel').hidden,
        graduationHidden: document.getElementById('graduation-panel').hidden,
        viewerHidden: document.getElementById('image-viewer').hidden,
      },
      viewerClicks,
      urlBefore,
      urlAfter: location.href,
      hashBefore,
      hashAfter: location.hash,
      fixture: window.__compoundAntFixture.snapshot(),
    };
  })()`, { awaitPromise: true, timeoutMs: 5_000 });

  for (const date of result.dateCases) {
    assert.equal(date.readOnly, true, date.id);
    assert.equal(date.interactiveReadonly, true, date.id);
    assert.equal(date.readonlyInteractionKind, 'date-like', date.id);
    assert.equal(date.triggerControls, `${date.id}-panel`, date.id);
    assert.equal(date.ambiguous, false, date.id);
    assert.equal(date.adapterId, 'date-like', date.id);
  }
  const expectedValues = new Map([
    ['birthday', '2000-02-03'],
    ['enrollment', '2022-09'],
    ['graduation', '2026-06'],
  ]);
  for (const execution of result.executions) {
    assert.equal(execution.adapterId, 'date-like', execution.id);
    assert.equal(execution.status, 'SUCCESS', `${execution.id}: ${JSON.stringify(execution)}`);
    assert.equal(execution.value, expectedValues.get(execution.id), execution.id);
    assert.ok(execution.datePickerDebug.rawPanelCandidateCount >= 3, execution.id);
    assert.ok(execution.datePickerDebug.visiblePanelCandidateCount >= 3, execution.id);
    assert.equal(execution.datePickerDebug.canonicalClusterCount, 1, execution.id);
    assert.equal(execution.datePickerDebug.finalReasonCode, 'SUCCESS', execution.id);
    assert.notEqual(execution.datePickerDebug.selectedAfterTransitionEvidence, '', execution.id);
  }
  const birthdayExecution = result.executions.find(execution => execution.id === 'birthday');
  const legacySwitchDebug = birthdayExecution.datePickerDebug.modeSwitchDebug;
  assert.equal(legacySwitchDebug.panelMode, 'DAY');
  assert.equal(legacySwitchDebug.headerCandidateCount, 2);
  assert.equal(legacySwitchDebug.monthSwitchCandidateCount, 1);
  assert.equal(legacySwitchDebug.yearSwitchCandidateCount, 1);
  assert.deepEqual([...legacySwitchDebug.candidateKinds].sort(), ['MONTH_ANCHOR', 'YEAR_ANCHOR']);
  assert.deepEqual(legacySwitchDebug.rejectionReasons, []);
  assert.equal(legacySwitchDebug.selectedSwitchSource, 'LEGACY_ANT_CLASS');
  assert.equal(legacySwitchDebug.safetyReason, '');
  for (const rerun of result.reruns) {
    assert.equal(rerun.status, 'SKIPPED_EXISTING', rerun.id);
    assert.equal(rerun.triggerClickDelta, 0, rerun.id);
  }
  assert.deepEqual(result.fixture.dateTriggerClicks, { birthday: 1, enrollment: 1, graduation: 1 });
  assert.deepEqual(
    Object.fromEntries(Object.entries(result.fixture.calendarTransitionStates)
      .map(([id, state]) => [id, state.strategy])),
    {
      birthday: 'legacy-overlap',
      enrollment: 'modern-replacement',
      graduation: 'modern-overlap',
    },
  );
  for (const state of Object.values(result.fixture.calendarTransitionStates)) {
    assert.ok(state.generation >= 1, JSON.stringify(state));
  }
  for (const count of Object.values(result.fixture.nestedPanelCandidateCounts)) assert.ok(count >= 3);
  assert.equal(result.panels.birthdayHidden, true);
  assert.equal(result.panels.enrollmentHidden, true);
  assert.equal(result.panels.graduationHidden, true);
  assert.equal(result.panels.viewerHidden, true);
  assert.deepEqual(result.viewerClicks, { previous: 0, next: 0 });
  assert.equal(result.urlAfter, result.urlBefore, 'Legacy Ant inert anchor 不得改变页面 URL');
  assert.equal(result.hashAfter, result.hashBefore, 'Legacy Ant inert anchor 不得改变 hash');
  assertSafetyCounters(result.fixture);
});

test('Progression Gate：真实 diagnosis unresolved 阻止离页，Skip 不授权 Next/submit 且 0 自动点击', async () => {
  await prepareFixture();
  const result = await evaluate(`(() => {
    window.siteAdapterConfigs = [];
    const profile = JFAdapterRegistry.resolve(window.siteAdapterConfigs, document.location);
    const navigation = JFNavigationEngine.createNavigationEngine({ document });
    const adapter = JFGenericAdapter.createAdapter(document, {
      config: profile.config,
      navigationEngine: navigation,
      siteProfile: profile,
    });
    const sectionContext = {
      sectionId: 'basic', section: 'basic', collection: 'basic', collectionMode: 'record',
      source: 'heading', confidence: 1, regionId: 'page:basic', label: '基本信息',
    };
    const diagnosis = adapter.diagnose({
      resume: { basic: { name: '仅提供姓名' } },
      sectionContext,
      embeddedSections: JFEmbeddedSectionDetector.detect(document),
    });
    const gate = JFAutofillEngine.evaluateProgression({
      items: diagnosis.fields,
      navigationIntent: 'SECTION_NAVIGATION',
    });
    const explicitSkip = JFAutofillEngine.evaluateProgression({
      items: diagnosis.fields,
      explicitUserSkip: true,
      navigationIntent: 'SECTION_NAVIGATION',
    });
    const next = document.getElementById('next-step');
    const submit = document.getElementById('final-submit');
    const nextIntent = JFNavigationEngine.classifyNavigationIntent(next);
    const submitIntent = JFNavigationEngine.classifyNavigationIntent(submit);
    const skipCannotProgressForm = JFAutofillEngine.evaluateProgression({
      items: diagnosis.fields,
      explicitUserSkip: true,
      navigationIntent: nextIntent.kind,
    });
    const detailed = navigation.scanDetailed();
    return {
      unresolved: diagnosis.fields
        .filter(field => ['FAILED', 'NEEDS_CONFIRMATION', 'CONFLICT', 'UNMATCHED', 'MISSING_JSON'].includes(field.status))
        .map(field => ({ status: field.status, visible: field.visible, disabled: field.disabled, labelText: field.labelText }))
        .slice(0, 20),
      gate: {
        allowed: gate.allowed,
        reasonCode: gate.reasonCode,
        blockerCount: gate.blockers.length,
        blockerStatuses: [...new Set(gate.blockers.map(item => item.status))],
      },
      explicitSkip: { allowed: explicitSkip.allowed, reasonCode: explicitSkip.reasonCode },
      nextIntent,
      submitIntent,
      skipCannotProgressForm: {
        allowed: skipCannotProgressForm.allowed,
        reasonCode: skipCannotProgressForm.reasonCode,
      },
      acceptedNavigationCount: detailed.items.filter(item => item.safe && !item.passiveOnly).length,
      fixture: window.__compoundAntFixture.snapshot(),
    };
  })()`);

  assert.ok(result.unresolved.length > 0, JSON.stringify(result));
  assert.equal(result.gate.allowed, false);
  assert.equal(result.gate.reasonCode, 'AUTO_PROGRESSION_BLOCKED');
  assert.ok(result.gate.blockerCount > 0);
  assert.equal(result.nextIntent.kind, 'FORM_PROGRESSION');
  assert.equal(result.nextIntent.allowed, false);
  assert.equal(result.nextIntent.reasonCode, 'FORM_PROGRESSION_USER_ONLY');
  assert.equal(result.submitIntent.kind, 'FORM_PROGRESSION');
  assert.equal(result.submitIntent.allowed, false);
  assert.equal(result.explicitSkip.allowed, true, '用户明确 Skip 可继续受控栏目导航');
  assert.equal(result.explicitSkip.reasonCode, 'EXPLICIT_USER_SKIP');
  assert.equal(result.skipCannotProgressForm.allowed, false, 'Skip 永不授权 Next/submit');
  assert.equal(result.skipCannotProgressForm.reasonCode, 'FORM_PROGRESSION_USER_ONLY');
  assert.equal(result.acceptedNavigationCount, 0, 'compound 单页 fixture 没有可自动导航 sidebar');
  assertSafetyCounters(result.fixture);
});

async function prepareFixture() {
  browser.resetSignals();
  await browser.cdp.call('Page.navigate', { url: pathToFileURL(fixturePath).href });
  await waitFor(async () => {
    try {
      return await evaluate(`document.readyState === 'complete' && typeof window.__compoundAntFixture?.snapshot === 'function'`);
    } catch {
      return false;
    }
  }, 5_000, 'compound Ant 测试夹具加载超时');

  for (const { relativePath, source } of runtimeSources) {
    await evaluate(`${source}\n//# sourceURL=${basename(relativePath)}`);
  }
  const globals = await evaluate(`(() => ({
    profiles: typeof JFAdapterRegistry?.resolve,
    generic: typeof JFGenericAdapter?.createAdapter,
    embedded: typeof JFEmbeddedSectionDetector?.detect,
    contexts: typeof JFFieldContext?.resolve,
    detector: typeof JFFieldDetector?.scan,
    diagnostics: typeof JFFieldDetector?.toDiagnostic,
    matcher: typeof JFFieldMatcher?.matchField,
    controls: typeof JFControlAdapterRegistry?.resolve,
    cascader: typeof JFCascaderAdapter?.write,
    arrays: typeof JFArrayHandler?.prepare,
    progression: typeof JFAutofillEngine?.evaluateProgression,
    navigationIntent: typeof JFNavigationEngine?.classifyNavigationIntent,
  }))()`);
  assert.ok(Object.values(globals).every(value => value === 'function'), JSON.stringify(globals));
}

function evaluate(expression, options = {}) {
  return evaluateInPage(browser.cdp, expression, options);
}

function fixtureSnapshot() {
  return evaluate('window.__compoundAntFixture.snapshot()');
}

function assertSafetyCounters(snapshot, overrides = {}) {
  assert.deepEqual(snapshot.counters, {
    draft: 0,
    next: 0,
    submit: 0,
    addPaper: 0,
    addAward: 0,
    deleteAward: 0,
    viewerPrevious: 0,
    viewerNext: 0,
    ...overrides,
  });
}
