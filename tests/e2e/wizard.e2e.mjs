import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test, { after, afterEach, before } from 'node:test';
import {
  clickPoint,
  dragPointer,
  evaluate as evaluateInPage,
  launchHeadlessBrowser,
  waitFor,
} from './support/headless-browser.mjs';

const testDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(testDirectory, '..', '..');
const fixturePath = resolve(projectRoot, 'tests', 'fixtures', 'wizard', 'index.html');
const runtimeFiles = [
  'src/core/safety.js',
  'src/core/diagnostic-sanitizer.js',
  'src/core/page-ready.js',
  'src/mappings/section-aliases.js',
  'src/mappings/section-structures.js',
  'src/mappings/field-aliases.js',
  'src/mappings/option-aliases.js',
  'src/mappings/date-rules.js',
  'src/mappings/file-field-aliases.js',
  'src/adapters/site-profile.js',
  'src/adapters/registry.js',
  'src/semantics/boolean-semantic-adapter.js',
  'src/semantics/field-semantic-normalizer.js',
  'src/core/semantic-verification.js',
  'src/core/field-context.js',
  'src/core/field-detector.js',
  'src/core/field-matcher.js',
  'src/core/event-dispatcher.js',
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
  'src/core/array-handler.js',
  'src/core/navigation-engine.js',
  'src/core/save-handler.js',
  'src/core/file-field-detector.js',
  'src/core/file-matcher.js',
  'src/core/file-upload-engine.js',
  'src/floating-ui/panel-state.js',
  'src/ui/design-system.js',
  'src/ui/profile-coverage.js',
  'src/ui/review-presenter.js',
  'src/floating-ui/drag-controller.js',
  'src/floating-ui/resize-controller.js',
  'src/floating-ui/floating-panel.js',
];

const resume = Object.freeze({
  basic: Object.freeze({
    name: '测试同学',
    birthday: '2002-01-02',
    gender: '女性',
  }),
  contact: Object.freeze({ phone: '13000000000' }),
  education: Object.freeze([
    Object.freeze({ school: '示例大学', major: '材料科学与工程', educationLevel: '大学本科' }),
  ]),
  awards: Object.freeze([
    Object.freeze({ content: '全国大学生材料创新竞赛一等奖', time: '2025-7' }),
    Object.freeze({ content: '校级优秀学生荣誉称号', time: '2024-12' }),
    Object.freeze({ content: '本科生科研训练优秀项目', time: '2024-6' }),
  ]),
  files: Object.freeze({ research: 'file_research_pdf' }),
});

let browser;
let runtimeSources;

before(async () => {
  runtimeSources = await Promise.all(runtimeFiles.map(async relativePath => ({
    relativePath,
    source: await readFile(resolve(projectRoot, relativePath), 'utf8'),
  })));
  browser = await launchHeadlessBrowser({ width: 1440, height: 1000, initialUrl: pathToFileURL(fixturePath).href });
}, { timeout: 30_000 });

after(async () => {
  await browser?.close();
});

afterEach(async () => {
  if (!browser) return;
  const attempted = await evaluate(`window.__jiefangFixture?.getSnapshot?.().attemptedNetworkRequests || []`).catch(() => []);
  assert.deepEqual(attempted, [], '本地 SPA 夹具不得尝试任何网络请求');
  assert.deepEqual(browser.externalRequests, [], '浏览器页面不得产生 HTTP(S) 请求');
  assert.deepEqual(browser.consoleMessages, [], '严格 CSP 下不得出现 console warning/error');
});

test('Navigation：识别基本/教育/奖励/科研，且每次跳转都需要新鲜用户确认', async () => {
  await prepareFixture();
  const initial = await evaluate(`(() => {
    window.__navigation = JFNavigationEngine.createNavigationEngine({ document });
    const scan = window.__navigation.scan();
    return {
      descriptors: scan.map(item => ({ sectionId: item.sectionId, text: item.text, safe: item.safe, reasonCode: item.reasonCode, confidence: item.confidence })),
      queue: window.__navigation.buildQueue(scan),
    };
  })()`);
  assert.deepEqual(initial.descriptors.map(item => item.sectionId), [
    'basic',
    'education',
    'awards',
    'research',
  ]);
  assert.ok(initial.descriptors.every(item => item.safe), JSON.stringify(initial.descriptors));
  assert.deepEqual(new Set(initial.queue.map(item => item.sectionId)), new Set([
    'basic', 'education', 'awards', 'research',
  ]));

  const blocked = await evaluate(`window.__navigation.navigate('education', {
    userInitiated: false,
    confirmSectionId: 'education',
    timeoutMs: 800,
  })`, { awaitPromise: true });
  assert.deepEqual(blocked, { ok: false, code: 'FRESH_USER_CONFIRMATION_REQUIRED', changed: false });
  assert.equal((await fixtureSnapshot()).navigation.length, 0);

  const targets = [
    ['basic', 'basic'],
    ['education', 'education'],
    ['awards', 'awards'],
    ['research', 'research'],
  ];
  for (const [sectionId, fixtureSection] of targets) {
    const result = await evaluate(`(async () => {
      window.__navigation.scan();
      return window.__navigation.navigate(${JSON.stringify(sectionId)}, {
        userInitiated: true,
        confirmSectionId: ${JSON.stringify(sectionId)},
        timeoutMs: 1200,
      });
    })()`, { awaitPromise: true, timeoutMs: 4_000 });
    assert.equal(result.ok, true, `${sectionId}: ${JSON.stringify(result)}`);
    assert.equal(result.changed, true);
    assert.equal((await fixtureSnapshot()).currentSection, fixtureSection);
  }
  const actions = (await fixtureSnapshot()).actions;
  assert.equal(actions.previous, 0);
  assert.equal(actions.next, 0);
  assert.equal(actions.saveNext, 0);
  assert.equal(actions.finalSubmit, 0);
});

test('FieldMatcher：真实 DOM 匹配姓名/手机号/生日/学校/专业/获奖名称/获奖时间', async () => {
  await prepareFixture();
  const matches = await evaluate(`(() => {
    const resume = ${JSON.stringify(resume)};
    const cases = [
      ['basic', '#section-basic', '姓名', 'basic.name', null],
      ['basic', '#section-basic', '手机号码', 'contact.phone', null],
      ['basic', '#section-basic', '出生日期', 'basic.birthday', null],
      ['education', '#section-education', '学校名称', 'education[].school', { section: 'education', index: 0 }],
      ['education', '#section-education', '所学专业', 'education[].major', { section: 'education', index: 0 }],
      ['awards', '#section-awards', '获奖名称', 'awards[].name', { section: 'awards', index: 0 }],
      ['awards', '#section-awards', '获奖时间', 'awards[].date', { section: 'awards', index: 0 }],
    ];
    return cases.map(([section, selector, label, expectedPath, arrayContext]) => {
      window.__jiefangFixture.activateSection(section, false);
      const descriptors = JFFieldDetector.scan(document.querySelector(selector), { section });
      const descriptor = descriptors.find(item => item.labelText === label);
      const match = JFFieldMatcher.matchField(descriptor, resume, { section, arrayContext });
      return {
        label,
        expectedPath,
        found: Boolean(descriptor),
        status: match.status,
        matchedPath: match.matchedPath,
        score: match.score,
        value: match.value,
      };
    });
  })()`);
  assert.equal(matches.length, 7);
  for (const match of matches) {
    assert.equal(match.found, true, match.label);
    assert.equal(match.status, 'MATCHED', `${match.label}: ${JSON.stringify(match)}`);
    assert.equal(match.matchedPath, match.expectedPath, match.label);
    assert.ok(match.score >= 62, `${match.label}: ${match.score}`);
    assert.notEqual(String(match.value || '').trim(), '', match.label);
  }
});

test('Array：1→3 只新增缺失组，随后 3→1 绝不删除网页已有记录', async () => {
  await prepareFixture({ addDelay: 90 });
  const outcome = await evaluate(`(async () => {
    const resume = ${JSON.stringify(resume)};
    window.__jiefangFixture.activateSection('awards', false);
    const root = document.getElementById('section-awards');
    const expanded = await JFArrayHandler.prepare('awards', resume.awards, root, {
      groupSelector: '.award-row',
      addButtonSelector: '#add-award',
      timeoutMs: 900,
      maxAdds: 5,
    });
    const fillResults = [];
    const groups = [...root.querySelectorAll('.award-row')];
    for (let index = 0; index < groups.length; index += 1) {
      const descriptors = JFFieldDetector.scan(groups[index], { section: 'awards' });
      const matches = JFFieldMatcher.matchFields(descriptors, resume, {
        section: 'awards',
        arrayContext: { section: 'awards', index },
      });
      const fields = await JFFormFiller.fillMany(matches, { allowOverwrite: false, skipEmpty: true });
      fillResults.push(fields.map(field => ({ fieldPath: field.fieldPath, status: field.status, afterValue: field.afterValue })));
    }
    const preserve = await JFArrayHandler.prepare('awards', resume.awards.slice(0, 1), root, {
      groupSelector: '.award-row',
      addButtonSelector: '#add-award',
      timeoutMs: 500,
      maxAdds: 2,
    });
    return {
      expanded: { ok: expanded.ok, initialCount: expanded.initialCount, count: expanded.count, added: expanded.added, clicks: expanded.clicks },
      preserve: { ok: preserve.ok, initialCount: preserve.initialCount, count: preserve.count, added: preserve.added, clicks: preserve.clicks },
      fillResults,
    };
  })()`, { awaitPromise: true, timeoutMs: 8_000 });

  assert.deepEqual(outcome.expanded, { ok: true, initialCount: 1, count: 3, added: 2, clicks: 2 });
  assert.deepEqual(outcome.preserve, { ok: true, initialCount: 3, count: 3, added: 0, clicks: 0 });
  assert.equal(outcome.fillResults.length, 3);
  assert.ok(outcome.fillResults.flat().every(field => field.status === 'SUCCESS'), JSON.stringify(outcome.fillResults));

  const snapshot = await fixtureSnapshot();
  assert.equal(snapshot.awardRows.length, 3);
  assert.equal(snapshot.actions.addAward, 2);
  assert.equal(snapshot.actions.deleteAward, 0);
  assert.deepEqual(snapshot.awardRows.map(row => row.name), resume.awards.map(item => item.content));
  assert.deepEqual(snapshot.awardRows.map(row => row.date), ['2025-07', '2024-12', '2024-06']);
  assert.equal(snapshot.actions.next, 0);
  assert.equal(snapshot.actions.finalSubmit, 0);
});

test('Events：input/select/radio 使用原生 setter、框架事件和最终回读', async () => {
  await prepareFixture();
  const results = await evaluate(`(async () => {
    window.__jiefangFixture.activateSection('basic', false);
    const basic = JFFieldDetector.scan(document.getElementById('section-basic'), { section: 'basic' });
    const name = basic.find(field => field.labelText === '姓名');
    const gender = basic.find(field => field.labelText === '性别');
    const inputResult = await JFFormFiller.fill(name, '测试同学', { allowOverwrite: false });
    const radioResult = await JFFormFiller.fill(gender, '女性', { allowOverwrite: false, expectedType: 'choice' });
    window.__jiefangFixture.activateSection('education', false);
    const education = JFFieldDetector.scan(document.getElementById('section-education'), { section: 'education' });
    const level = education.find(field => field.labelText === '学历层次');
    const selectResult = await JFFormFiller.fill(level, '大学本科', { allowOverwrite: false, expectedType: 'choice' });
    return [inputResult, selectResult, radioResult].map(result => ({ status: result.status, afterValue: result.afterValue, reason: result.reason }));
  })()`, { awaitPromise: true });
  assert.deepEqual(results.map(result => result.status), ['SUCCESS', 'SUCCESS', 'SUCCESS'], JSON.stringify(results));

  const snapshot = await fixtureSnapshot();
  assert.equal(snapshot.framework['basic.name'], '测试同学');
  assert.equal(snapshot.framework['education.level'], '本科');
  assert.equal(snapshot.framework['basic.gender'], '女');
  assert.equal(snapshot.directSetters['basic.name'] || 0, 0);
  assert.equal(snapshot.directSetters['education.level'] || 0, 0);
  assert.equal(snapshot.directSetters['basic.gender'] || 0, 0);
  assertEventSubsequence(snapshot.events, 'basic.name', ['focus', 'pointerdown', 'mousedown', 'input', 'change', 'blur']);
  assertEventSubsequence(snapshot.events, 'education.level', ['focus', 'pointerdown', 'mousedown', 'input', 'change', 'blur']);
  assertEventSubsequence(snapshot.events, 'basic.gender', ['focus', 'pointerdown', 'mousedown', 'input', 'change', 'blur']);
});

test('Save：只允许用户明确确认的安全保存，拒绝保存并下一步和正式提交', async () => {
  await prepareFixture();
  const outcome = await evaluate(`(async () => {
    const handler = JFSaveHandler.createSaveHandler({ document });
    const inspection = handler.inspect();
    const safe = inspection.find(item => item.text === '保存本页');
    const withoutGesture = await handler.save({ handleId: safe.handleId, confirmText: safe.text });
    const wrongLabel = await handler.save({ handleId: safe.handleId, userInitiated: true, confirmText: '保存' });
    const saved = await handler.save({ handleId: safe.handleId, userInitiated: true, confirmText: safe.text, timeoutMs: 600 });
    return {
      inspection: inspection.map(item => ({ text: item.text, safe: item.safe, kind: item.kind, reasonCode: item.reasonCode })),
      withoutGesture,
      wrongLabel,
      saved: { ok: saved.ok, clicked: saved.clicked, code: saved.code, verificationRequired: saved.verificationRequired },
    };
  })()`, { awaitPromise: true, timeoutMs: 4_000 });
  assert.equal(outcome.inspection.find(item => item.text === '保存本页').safe, true);
  assert.equal(outcome.inspection.find(item => item.text === '保存并下一步').safe, false);
  assert.equal(outcome.inspection.find(item => item.text === '正式提交').safe, false);
  assert.equal(outcome.withoutGesture.code, 'FRESH_USER_CONFIRMATION_REQUIRED');
  assert.equal(outcome.wrongLabel.code, 'SAVE_LABEL_CONFIRMATION_MISMATCH');
  assert.deepEqual(outcome.saved, {
    ok: true,
    clicked: true,
    code: 'SAFE_SAVE_TRIGGERED_MANUAL_VERIFICATION_REQUIRED',
    verificationRequired: true,
  });
  const actions = (await fixtureSnapshot()).actions;
  assert.equal(actions.safeSave, 1);
  assert.equal(actions.saveNext, 0);
  assert.equal(actions.next, 0);
  assert.equal(actions.finalSubmit, 0);
});

test('File：识别格式/大小限制，并优先采用 Resume JSON 的明确材料绑定', async () => {
  await prepareFixture();
  const outcome = await evaluate(`(() => {
    window.__jiefangFixture.activateSection('research', false);
    const field = JFFileFieldDetector.scan(document.getElementById('section-research'))[0];
    const resume = ${JSON.stringify(resume)};
    const good = { id: 'file_research_pdf', name: '科研证明.pdf', extension: 'pdf', size: 524288, category: 'research' };
    const materials = [good, { id: 'file_other', name: '其他材料.pdf', extension: 'pdf', size: 100, category: 'other' }];
    const explicit = JFFileMatcher.matchField(field, resume, materials);
    const formatError = JFFileUploadEngine.validate({ ...explicit, material: { ...good, name: '科研证明.docx', extension: 'docx' } });
    const sizeError = JFFileUploadEngine.validate({ ...explicit, material: { ...good, size: 2 * 1024 * 1024 } });
    const valid = JFFileUploadEngine.validate(explicit);
    const ambiguous = JFFileMatcher.matchField(field, {}, [
      { id: 'file_a', name: '科研材料A.pdf', extension: 'pdf', size: 10, category: 'research' },
      { id: 'file_b', name: '科研材料B.pdf', extension: 'pdf', size: 10, category: 'research' },
    ]);
    return {
      restrictions: field.restrictions,
      explicit: { status: explicit.status, path: explicit.path, score: explicit.score, materialId: explicit.material?.id, reason: explicit.reason },
      formatError,
      sizeError,
      valid,
      ambiguous: { status: ambiguous.status, candidates: ambiguous.candidates?.length || 0 },
    };
  })()`);
  assert.ok(outcome.restrictions.extensions.includes('pdf'));
  assert.equal(outcome.restrictions.maxBytes, 1024 * 1024);
  assert.equal(outcome.restrictions.maxCount, 1);
  assert.deepEqual(outcome.explicit, {
    status: 'MATCH',
    path: 'files.research',
    score: 100,
    materialId: 'file_research_pdf',
    reason: 'Resume JSON 明确绑定',
  });
  assert.equal(outcome.formatError.status, 'FORMAT_ERROR');
  assert.equal(outcome.sizeError.status, 'SIZE_ERROR');
  assert.deepEqual(outcome.valid, { ok: true, status: 'PENDING', reason: '' });
  assert.equal(outcome.ambiguous.status, 'NEEDS_CONFIRMATION');
});

test('File：明确绑定仍需面板逐次确认，确认前不写 FileList，确认后再上传并验证', async () => {
  await prepareFixture();
  await evaluate(`(async () => {
    window.__jiefangFixture.activateSection('research', false);
    const field = JFFileFieldDetector.scan(document.getElementById('section-research'))[0];
    const material = { id: 'file_research_pdf', name: '科研证明.pdf', extension: 'pdf', size: 15, category: 'research' };
    window.__runtimeMessages = [];
    window.chrome = window.chrome || {};
    window.chrome.runtime = {
      lastError: null,
      sendMessage(message, callback) {
        window.__runtimeMessages.push(JSON.parse(JSON.stringify(message)));
        queueMicrotask(() => {
          if (message.type === 'AUTHORIZE_FILE_UPLOADS') {
            callback({ ok: true, authorization: { oneTime: true } });
            return;
          }
          if (message.type === 'MATERIAL_GET_PAYLOAD' && message.id === material.id) {
            callback({
              ok: true,
              payload: {
                base64: 'JVBERi0xLjQKJVRlc3QK',
                metadata: {
                  id: material.id,
                  name: material.name,
                  extension: material.extension,
                  size: material.size,
                  mimeType: 'application/pdf',
                },
              },
            });
            return;
          }
          callback({ ok: false, error: '测试后台拒绝未知消息' });
        });
      },
    };
    window.__fileMatch = JFFileMatcher.matchField(field, ${JSON.stringify(resume)}, [material]);
    window.__floatingPanel = await JFFloatingPanel.create();
    window.__fileAuthorization = 'PENDING';
    window.__floatingPanel.confirmFile({
      label: '科研证明（PDF，不超过 1 MB）',
      candidates: [{ material, score: 100 }],
    }).then(value => { window.__fileAuthorization = value; });
  })()`, { awaitPromise: true });
  const before = await fixtureSnapshot();
  assert.deepEqual(before.files, []);
  assert.equal(before.actions.fileInput, 0);
  assert.equal(before.actions.fileChange, 0);
  assert.equal(await evaluate('window.__fileAuthorization'), 'PENDING');
  assert.deepEqual(await evaluate('window.__runtimeMessages'), [], '用户确认前不得请求后台文件载荷');

  const confirmation = await panelElementCenter('file-confirm-button');
  await clickPoint(browser.cdp, confirmation.x, confirmation.y);
  await waitFor(
    () => evaluate(`window.__fileAuthorization === 'file_research_pdf'`),
    1_500,
    '文件确认按钮未返回材料授权',
  );

  const uploaded = await evaluate(`JFFileUploadEngine.upload(window.__fileMatch, {
    authorization: {
      taskId: 'task:wizard-file-e2e',
      nonce: 'wizard_file_nonce_1234567890',
      userConfirmed: true,
      filePolicy: 'ask-every-time',
      expiresAt: Date.now() + 60_000,
    },
    perFileConfirmed: true,
    timeoutMs: 800,
  })`, { awaitPromise: true, timeoutMs: 3_000 });
  assert.equal(uploaded.status, 'UPLOAD_SUCCESS', JSON.stringify(uploaded));
  const afterUpload = await fixtureSnapshot();
  assert.deepEqual(afterUpload.files.map(file => file.name), ['科研证明.pdf']);
  assert.equal(afterUpload.actions.fileInput, 1);
  assert.equal(afterUpload.actions.fileChange, 1);
  const runtimeMessages = await evaluate('window.__runtimeMessages');
  assert.deepEqual(runtimeMessages.map(message => message.type), ['AUTHORIZE_FILE_UPLOADS', 'MATERIAL_GET_PAYLOAD']);
  assert.equal(runtimeMessages[0].confirmationMode, 'per-file');
  assert.equal(runtimeMessages[0].confirmedMaterialId, 'file_research_pdf');
  assert.equal(afterUpload.actions.next, 0);
  assert.equal(afterUpload.actions.finalSubmit, 0);
});

test('FloatingPanel：支持真实指针拖拽、缩放、折叠、最小化与恢复', async () => {
  await prepareFixture();
  await evaluate(`JFFloatingPanel.create().then(panel => { window.__floatingPanel = panel; return true; })`, { awaitPromise: true });
  const initial = await panelGeometry();
  assert.equal(initial.position, 'fixed');
  assert.equal(initial.hidden, false);
  const horizontalDrag = initial.left > 420 ? -220 : 220;

  await dragPointer(browser.cdp, {
    x: initial.left + 155,
    y: initial.top + 25,
  }, {
    x: initial.left + 155 + horizontalDrag,
    y: initial.top + 70,
  });
  await new Promise(resolvePromise => setTimeout(resolvePromise, 120));
  const dragProbe = await panelGeometry();
  assert.ok(
    Math.abs(dragProbe.left - initial.left) > 100 && dragProbe.top > initial.top + 25,
    `悬浮面板未响应拖拽：${JSON.stringify({ initial, dragProbe })}`,
  );
  const dragged = await panelGeometry();
  const resizeHandle = await panelElementCenter('resize');

  await dragPointer(browser.cdp, {
    x: resizeHandle.x,
    y: resizeHandle.y,
  }, {
    x: resizeHandle.x + 80,
    y: resizeHandle.y + 65,
  });
  await new Promise(resolvePromise => setTimeout(resolvePromise, 120));
  const resizeProbe = await panelGeometry();
  assert.ok(
    resizeProbe.width > dragged.width + 45 && resizeProbe.height > dragged.height + 35,
    `悬浮面板未响应缩放：${JSON.stringify({ dragged, resizeProbe })}`,
  );
  const resized = await panelGeometry();
  assert.ok(resized.width > dragged.width);
  assert.ok(resized.height > dragged.height);

  await clickPanelElement('overflow-toggle');
  await clickPanelElement('collapse');
  await waitFor(() => evaluate(`window.__floatingPanel.getState().collapsed === true`), 1_000, '悬浮面板未折叠');
  const collapsed = await panelGeometry();
  assert.equal(collapsed.collapsed, true);
  assert.ok(collapsed.height <= 54);

  await clickPanelElement('minimize');
  await waitFor(() => evaluate(`window.__floatingPanel.getState().minimized === true`), 1_000, '悬浮面板未最小化');
  const minimized = await evaluate(`(() => {
    const root = document.getElementById('__jf_panel__').shadowRoot;
    return {
      panelHidden: root.querySelector('.panel').hidden,
      launcherHidden: root.getElementById('launcher').hidden,
    };
  })()`);
  assert.deepEqual(minimized, { panelHidden: true, launcherHidden: false });

  await clickPanelElement('launcher');
  await waitFor(() => evaluate(`window.__floatingPanel.getState().minimized === false`), 1_000, '悬浮面板未从最小化恢复');
  const restored = await panelGeometry();
  assert.equal(restored.hidden, false);
  assert.equal(restored.collapsed, false);
});

async function prepareFixture(query = {}) {
  browser.resetSignals();
  const url = new URL(pathToFileURL(fixturePath));
  Object.entries(query).forEach(([key, value]) => url.searchParams.set(key, String(value)));
  await browser.cdp.call('Page.navigate', { url: url.href });
  await waitFor(async () => {
    try {
      return await evaluate(`document.readyState === 'complete' && window.__jiefangFixture?.ready`);
    } catch {
      return false;
    }
  }, 5_000, '多栏目 SPA 测试夹具加载超时');
  await evaluate('window.__jiefangFixture.ready', { awaitPromise: true });
  for (const { relativePath, source } of runtimeSources) {
    await evaluate(`${source}\n//# sourceURL=${basename(relativePath)}`);
  }
  const globals = await evaluate(`(() => ({
    navigation: typeof JFNavigationEngine?.createNavigationEngine,
    detector: typeof JFFieldDetector?.scan,
    matcher: typeof JFFieldMatcher?.matchField,
    array: typeof JFArrayHandler?.prepare,
    filler: typeof JFFormFiller?.fill,
    save: typeof JFSaveHandler?.createSaveHandler,
    fileDetector: typeof JFFileFieldDetector?.scan,
    fileMatcher: typeof JFFileMatcher?.matchField,
    fileUpload: typeof JFFileUploadEngine?.upload,
    panel: typeof JFFloatingPanel?.create,
  }))()`);
  assert.ok(Object.values(globals).every(value => value === 'function'), JSON.stringify(globals));
}

function evaluate(expression, options = {}) {
  return evaluateInPage(browser.cdp, expression, options);
}

function fixtureSnapshot() {
  return evaluate('window.__jiefangFixture.getSnapshot()');
}

function assertEventSubsequence(events, key, expected) {
  const actual = events.filter(event => event.key === key).map(event => event.type);
  let cursor = -1;
  for (const eventName of expected) {
    cursor = actual.indexOf(eventName, cursor + 1);
    assert.notEqual(cursor, -1, `${key} 缺少事件 ${eventName}：${actual.join(',')}`);
  }
}

async function panelElementCenter(id) {
  return evaluate(`(() => {
    const element = document.getElementById('__jf_panel__').shadowRoot.getElementById(${JSON.stringify(id)});
    const rect = element.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
}

async function clickPanelElement(id) {
  const center = await panelElementCenter(id);
  await clickPoint(browser.cdp, center.x, center.y);
}

function panelGeometry() {
  return evaluate(`(() => {
    const panel = document.getElementById('__jf_panel__').shadowRoot.querySelector('.panel');
    const rect = panel.getBoundingClientRect();
    return {
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
      position: getComputedStyle(panel).position,
      hidden: panel.hidden,
      collapsed: panel.classList.contains('collapsed'),
    };
  })()`);
}
