import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import test, { after, before } from 'node:test';

const testDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(testDirectory, '..', '..');
const fixturePath = resolve(projectRoot, 'tests', 'fixtures', 'awards.html');
const sectionStructuresPath = resolve(projectRoot, 'src', 'mappings', 'section-structures.js');
const genericAdapterPath = resolve(projectRoot, 'src', 'adapters', 'generic.js');
const safetyPath = resolve(projectRoot, 'src', 'core', 'safety.js');
const awardsAdapterPath = resolve(projectRoot, 'src', 'adapters', 'undergraduate-awards.js');
const arrayHandlerPath = resolve(projectRoot, 'src', 'core', 'array-handler.js');
const visualQaDirectory = process.env.JF_VISUAL_QA_DIR || '';
const visualQaOnly = process.env.JF_VISUAL_QA_ONLY || '';
const awards = [
  {
    time: '2025-7',
    location: '青岛',
    content: '中国大学生高分子材料创新创业大赛国家级奖项',
  },
  {
    time: '2025-7',
    location: '青岛',
    content: '全国大学生高分子材料实验实践大赛国家级奖项',
  },
  {
    time: '2025-8',
    location: '上海',
    content: '第三条本地自动化测试奖励',
  },
];

let browser;
let sectionStructuresSource;
let genericAdapterSource;
let safetySource;
let awardsAdapterSource;
let arrayHandlerSource;
let contentAppSource;

before(async () => {
  [sectionStructuresSource, genericAdapterSource, safetySource, awardsAdapterSource, arrayHandlerSource, contentAppSource] = await Promise.all([
    readFile(sectionStructuresPath, 'utf8'),
    readFile(genericAdapterPath, 'utf8'),
    readFile(safetyPath, 'utf8'),
    readFile(awardsAdapterPath, 'utf8'),
    readFile(arrayHandlerPath, 'utf8'),
    readFile(resolve(projectRoot, 'src', 'content-app.js'), 'utf8'),
  ]);
  browser = await launchHeadlessBrowser(pathToFileURL(fixturePath).href);
  await browser.cdp.call('Page.enable');
  await browser.cdp.call('Runtime.enable');
  await browser.cdp.call('Network.enable');
  await browser.cdp.call('Log.enable');
  await browser.cdp.call('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });
}, { timeout: 30_000 });

after(async () => {
  if (visualQaDirectory) {
    console.log(`[visual-qa] console-messages=${JSON.stringify(browser?.consoleMessages || [])}`);
  }
  await browser?.close();
});

test('1. 一条奖励填入默认行', async () => {
  await prepareFixture();
  assert.equal(await detectAwardsPage(), true);
  const result = await fillAwards(awards.slice(0, 1));
  const snapshot = await fixtureSnapshot();
  assert.equal(snapshot.rows.length, 1);
  assert.deepEqual(snapshot.rows[0].values, awards[0]);
  assert.deepEqual(snapshot.rows[0].domValues, awards[0]);
  assert.deepEqual(result.summary, expectedSummary({ planned: 3, success: 3 }));
  assert.deepEqual(result.fields.map(field => field.status), ['success', 'success', 'success']);
  for (const field of result.fields) {
    assert.equal(field.awardIndex, 0);
    assert.equal(field.afterValue, field.plannedValue);
    assert.equal(typeof field.reason, 'string');
  }
});

test('2. 两条奖励通过 MutationObserver 路径自动新增一行', async () => {
  await prepareFixture({ delay: 120 });
  const result = await fillAwards(awards.slice(0, 2));
  const snapshot = await fixtureSnapshot();
  assert.equal(snapshot.rows.length, 2);
  assert.equal(snapshot.actions.addClicks, 1);
  assert.equal(snapshot.actions.deleteClicks, 0);
  assert.deepEqual(snapshot.rows.map(row => row.values), awards.slice(0, 2));
  assert.ok(snapshot.mutationObservers.created >= 1);
  assert.ok(snapshot.mutationObservers.observeCalls >= 1);
  assert.ok(snapshot.mutationObservers.callbacks >= 1);
  assert.deepEqual(result.summary, expectedSummary({ planned: 6, success: 6 }));
});

test('3. 三条奖励连续新增两行', async () => {
  await prepareFixture({ delay: 90 });
  const result = await fillAwards(awards);
  const snapshot = await fixtureSnapshot();
  assert.equal(snapshot.rows.length, 3);
  assert.equal(snapshot.actions.addClicks, 2);
  assert.deepEqual(snapshot.rows.map(row => row.values), awards);
  assert.deepEqual(result.summary, expectedSummary({ planned: 9, success: 9 }));
});

test('4. 地点为空时保持空值且不写入 undefined/null/空格', async () => {
  await prepareFixture();
  const awardWithEmptyLocation = { ...awards[0], location: '' };
  const result = await fillAwards([awardWithEmptyLocation]);
  const snapshot = await fixtureSnapshot();
  assert.equal(snapshot.rows[0].values.location, '');
  assert.equal(snapshot.rows[0].domValues.location, '');
  assert.equal(snapshot.rows[0].values.time, awardWithEmptyLocation.time);
  assert.equal(snapshot.rows[0].values.content, awardWithEmptyLocation.content);
  const locationEvents = snapshot.events.filter(event => event.row === 0 && event.field === 'location');
  assert.deepEqual(locationEvents, [], '空地点字段不应触发任何输入事件');
  assert.deepEqual(result.summary, expectedSummary({ planned: 3, success: 2, skippedEmpty: 1 }));
});

test('5. 默认不覆盖网页已有内容', async () => {
  await prepareFixture({ existing: 'full' });
  const result = await fillAwards(awards.slice(0, 1));
  const snapshot = await fixtureSnapshot();
  assert.deepEqual(snapshot.rows[0].values, {
    time: '2024-6',
    location: '北京',
    content: '网页原有奖励（默认不得覆盖）',
  });
  assert.deepEqual(snapshot.rows[0].domValues, snapshot.rows[0].values);
  assert.deepEqual(result.summary, expectedSummary({ planned: 3, conflicts: 3 }));
});

test('6. 主动开启允许覆盖后可以覆盖', async () => {
  await prepareFixture({ existing: 'full' });
  const result = await fillAwards(awards.slice(0, 1), { allowOverwrite: true });
  const snapshot = await fixtureSnapshot();
  assert.deepEqual(snapshot.rows[0].values, awards[0]);
  assert.deepEqual(snapshot.rows[0].domValues, awards[0]);
  assert.deepEqual(result.summary, expectedSummary({ planned: 3, success: 3 }));
});

test('7. 重复执行不会无限新增或制造重复行', async () => {
  await prepareFixture({ delay: 70 });
  await fillAwards(awards.slice(0, 2));
  const afterFirstRun = await fixtureSnapshot();
  const secondResult = await fillAwards(awards.slice(0, 2));
  const afterSecondRun = await fixtureSnapshot();
  assert.equal(afterFirstRun.rows.length, 2);
  assert.equal(afterSecondRun.rows.length, 2);
  assert.equal(afterSecondRun.actions.addClicks, 1);
  assert.deepEqual(afterSecondRun.rows.map(row => row.values), awards.slice(0, 2));
  assert.equal(afterSecondRun.events.length, afterFirstRun.events.length);
  assert.deepEqual(secondResult.summary, expectedSummary({ planned: 6, skippedExisting: 6 }));
});

test('8. 找不到新增按钮时停止并给出明确失败', async () => {
  await prepareFixture({ add: 'missing' });
  const outcome = await ensureRows(2, { timeoutMs: 300, maxAdds: 3 });
  const snapshot = await fixtureSnapshot();
  assert.equal(snapshot.rows.length, 1);
  assert.equal(snapshot.actions.addClicks, 0);
  assert.equal(outcome.failed, true, outcome.description);
});

test('9. 新增按钮点击后 DOM 无变化时按上限停止并报错', async () => {
  await prepareFixture({ add: 'noop' });
  const outcome = await ensureRows(2, { timeoutMs: 250, maxAdds: 3 });
  const snapshot = await fixtureSnapshot();
  assert.equal(snapshot.rows.length, 1);
  assert.ok(snapshot.actions.addClicks >= 1 && snapshot.actions.addClicks <= 3);
  assert.equal(outcome.failed, true, outcome.description);
});

test('10. 字段顺序改变后仍根据表头按行识别', async () => {
  await prepareFixture({ order: 'location,content,time', delay: 60 });
  const result = await fillAwards(awards.slice(0, 2));
  const snapshot = await fixtureSnapshot();
  assert.deepEqual(snapshot.config.columns, ['location', 'content', 'time']);
  assert.deepEqual(snapshot.rows.map(row => row.values), awards.slice(0, 2));
  assert.deepEqual(result.summary, expectedSummary({ planned: 6, success: 6 }));
});

test('11. 页面包含其他输入框时不会错填', async () => {
  await prepareFixture();
  await fillAwards(awards.slice(0, 1));
  const snapshot = await fixtureSnapshot();
  assert.deepEqual(snapshot.unrelated, {
    search: '',
    phone: '示例占位值',
    reason: '保留原内容',
  });
});

test('12. 填写触发完整事件序列并更新框架状态', async () => {
  await prepareFixture();
  await fillAwards(awards.slice(0, 1));
  const snapshot = await fixtureSnapshot();
  for (const field of ['time', 'location', 'content']) {
    const events = snapshot.events
      .filter(event => event.row === 0 && event.field === field)
      .map(event => event.type);
    const collapsed = events.filter((event, index) => index === 0 || event !== events[index - 1]);
    assert.deepEqual(collapsed, ['focus', 'pointerdown', 'mousedown', 'input', 'change', 'blur']);
    assert.equal(snapshot.rows[0].values[field], awards[0][field]);
    assert.equal(snapshot.rows[0].directSetterCalls[field], 0, `${field} 不得使用实例 value 赋值`);
  }
});

test('13. 填写过程不会点击“下一步”', async () => {
  await prepareFixture();
  await fillAwards(awards.slice(0, 1));
  assert.equal((await fixtureSnapshot()).actions.nextClicks, 0);
});

test('14. 填写过程不会点击最终提交或删除按钮', async () => {
  await prepareFixture();
  await fillAwards(awards.slice(0, 1));
  const actions = (await fixtureSnapshot()).actions;
  assert.equal(actions.finalSubmitClicks, 0);
  assert.equal(actions.deleteClicks, 0);
});

test('15. 本地奖励填写不产生任何运行时外部网络请求', async () => {
  await prepareFixture();
  await fillAwards(awards.slice(0, 1));
  const snapshot = await fixtureSnapshot();
  assert.deepEqual(snapshot.attemptedNetworkRequests, []);
  assert.deepEqual(browser.externalRequests, []);
});

test('诊断结果可序列化且不包含字段当前值或完整查询参数', async () => {
  await prepareFixture({ existing: 'full', marker: 'private-query-value' });
  const diagnosis = await evaluate(`(async () => {
    const value = await window.__testAwardsAdapter.diagnosePage();
    return JSON.parse(JSON.stringify(value));
  })()`, { awaitPromise: true });
  const serialized = JSON.stringify(diagnosis);
  assert.match(serialized, /奖励情况（本科期间）/);
  assert.doesNotMatch(serialized, /网页原有奖励|北京|2024-6|示例占位值|保留原内容/);
  assert.doesNotMatch(serialized, /private-query-value/);
  if (diagnosis.privacy?.mode === 'metadata-only') {
    assert.ok(diagnosis.privacy.excludedData.includes('field-values'));
    assert.ok(diagnosis.privacy.excludedData.includes('browser-auth'));
    assert.ok(diagnosis.privacy.excludedData.includes('page-html'));
    assert.ok(diagnosis.privacy.excludedData.includes('passwords'));
  } else {
    assert.equal(diagnosis.privacy?.includesFieldValues, false);
    assert.equal(diagnosis.privacy?.includesCookies, false);
    assert.equal(diagnosis.privacy?.includesTokens, false);
    assert.equal(diagnosis.privacy?.includesPageHtml, false);
  }
});

test('非奖励页面不会被奖励适配器误判', async () => {
  await prepareFixture();
  await evaluate(`(() => {
    document.title = '普通申请页面';
    document.querySelector('#awards-section')?.remove();
    document.querySelector('h1').textContent = '普通申请信息';
    document.querySelector('nav').textContent = '首页 / 普通申请信息';
  })()`);
  assert.equal(await detectAwardsPage(), false);
});

test('本地内容面板默认预览；取消不改 DOM，确认后显示逐项结果', async () => {
  browser.consoleMessages.length = 0;
  await prepareFixture();
  await mountLocalPanel(awards.slice(0, 1));

  const defaults = await evaluate(`(() => {
    const root = document.getElementById('__jf_panel__').shadowRoot;
    return {
      allowOverwrite: root.getElementById('allow-overwrite').checked,
      previewBeforeFill: root.getElementById('preview-before-fill').checked,
      skipEmpty: root.getElementById('skip-empty').checked,
      fillDisabled: root.getElementById('fill').disabled,
      panelPosition: getComputedStyle(root.querySelector('.panel')).position,
    };
  })()`);
  assert.deepEqual(defaults, {
    allowOverwrite: false,
    previewBeforeFill: true,
    skipEmpty: true,
    fillDisabled: false,
    panelPosition: 'fixed',
  });

  const beforeCancel = await fixtureSnapshot();
  await evaluate(`document.getElementById('__jf_panel__').shadowRoot.getElementById('fill').click()`);
  await waitFor(
    () => evaluate(`document.getElementById('__jf_panel__').shadowRoot.getElementById('preview-modal').hidden === false`),
    2_000,
    '点击填充后未出现预览',
  );
  const previewLayer = await evaluate(`(() => {
    const root = document.getElementById('__jf_panel__').shadowRoot;
    const panel = root.querySelector('.panel');
    const backdrop = root.getElementById('preview-modal');
    const checkbox = root.getElementById('allow-overwrite');
    const rect = checkbox.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const topElement = root.elementFromPoint(x, y);
    return {
      panelZIndex: Number.parseInt(getComputedStyle(panel).zIndex, 10),
      backdropZIndex: Number.parseInt(getComputedStyle(backdrop).zIndex, 10),
      backdropPosition: getComputedStyle(backdrop).position,
      x,
      y,
      topId: topElement?.id || '',
      topClass: typeof topElement?.className === 'string' ? topElement.className : '',
    };
  })()`);
  assert.equal(previewLayer.backdropPosition, 'fixed');
  assert.ok(previewLayer.backdropZIndex > previewLayer.panelZIndex);
  assert.equal(previewLayer.topId, 'preview-modal');
  await browser.cdp.call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: previewLayer.x, y: previewLayer.y });
  await browser.cdp.call('Input.dispatchMouseEvent', { type: 'mousePressed', x: previewLayer.x, y: previewLayer.y, button: 'left', buttons: 1, clickCount: 1 });
  await browser.cdp.call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: previewLayer.x, y: previewLayer.y, button: 'left', buttons: 0, clickCount: 1 });
  const blockedInteraction = await evaluate(`(() => {
    const root = document.getElementById('__jf_panel__').shadowRoot;
    return {
      allowOverwrite: root.getElementById('allow-overwrite').checked,
      previewStillOpen: root.getElementById('preview-modal').hidden === false,
    };
  })()`);
  assert.deepEqual(blockedInteraction, { allowOverwrite: false, previewStillOpen: true });
  await captureVisualQa('jiefang-preview-1440x1000.png', 'preview');
  assert.equal((await fixtureSnapshot()).actions.addClicks, 0, '预览确认前不得新增页面行');
  await evaluate(`document.getElementById('__jf_panel__').shadowRoot.getElementById('preview-cancel').click()`);
  await waitFor(
    () => evaluate(`document.getElementById('__jf_panel__').shadowRoot.getElementById('message').textContent.includes('已取消')`),
    2_000,
    '取消预览后未显示取消提示',
  );
  const afterCancel = await fixtureSnapshot();
  assert.deepEqual(afterCancel.rows.map(row => row.domValues), beforeCancel.rows.map(row => row.domValues));
  assert.equal(afterCancel.events.length, beforeCancel.events.length);

  await evaluate(`document.getElementById('__jf_panel__').shadowRoot.getElementById('fill').click()`);
  await waitFor(
    () => evaluate(`document.getElementById('__jf_panel__').shadowRoot.getElementById('preview-modal').hidden === false`),
    2_000,
    '第二次点击填充后未出现预览',
  );
  await evaluate(`document.getElementById('__jf_panel__').shadowRoot.getElementById('preview-confirm').click()`);
  await waitFor(
    () => evaluate(`document.getElementById('__jf_panel__').shadowRoot.getElementById('result').textContent.includes('本页填写完成')`),
    3_000,
    '确认后未显示填写结果',
  );
  await captureVisualQa('jiefang-results-1440x1000.png', 'results');

  const panelResult = await evaluate(`(() => {
    const root = document.getElementById('__jf_panel__').shadowRoot;
    return {
      itemCount: root.querySelectorAll('.result-item').length,
      resultText: root.getElementById('result').textContent,
      message: root.getElementById('message').textContent,
    };
  })()`);
  assert.equal(panelResult.itemCount, 3);
  assert.match(panelResult.resultText, /3\s*计划字段/);
  assert.match(panelResult.resultText, /3\s*填写成功/);
  assert.match(panelResult.resultText, /本页填写完成，请人工核对后继续/);
  assert.match(panelResult.message, /填写检查完成：成功 3 个字段/);

  const filled = await fixtureSnapshot();
  assert.deepEqual(filled.rows[0].values, awards[0]);
  assert.equal(filled.actions.nextClicks, 0);
  assert.equal(filled.actions.finalSubmitClicks, 0);
  assert.equal(filled.actions.deleteClicks, 0);
  assert.deepEqual(browser.consoleMessages, [], '本地面板不得产生 CSP 或其他 console warning/error');
});

async function prepareFixture(query = {}) {
  browser.externalRequests.length = 0;
  const url = new URL(pathToFileURL(fixturePath));
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, String(value));
  }

  await browser.cdp.call('Page.navigate', { url: url.href });
  await waitFor(async () => {
    try {
      return await evaluate('document.readyState === "complete" && Boolean(window.__awardsFixture)');
    } catch {
      return false;
    }
  }, 5_000, '奖励测试夹具加载超时');
  await evaluate('window.__awardsFixture.ready', { awaitPromise: true });
  await evaluate(`${sectionStructuresSource}\n//# sourceURL=section-structures.js`);
  await evaluate(`${genericAdapterSource}\n//# sourceURL=generic.js`);
  await evaluate(`${safetySource}\n//# sourceURL=safety.js`);
  await evaluate(`${awardsAdapterSource}\n//# sourceURL=undergraduate-awards.js`);
  await evaluate(`${arrayHandlerSource}\n//# sourceURL=array-handler.js`);
  const hasApi = await evaluate('typeof globalThis.JFAwardsAdapter?.createAdapter === "function"');
  assert.equal(hasApi, true, 'JFAwardsAdapter.createAdapter 未暴露');
  await evaluate('window.__testAwardsAdapter = globalThis.JFAwardsAdapter.createAdapter(document)');
}

async function detectAwardsPage() {
  return evaluate(`(() => {
    const result = window.__testAwardsAdapter.detectPage();
    if (typeof result === 'boolean') return result;
    return Boolean(
      result?.matched ??
      result?.detected ??
      result?.isAwardsPage ??
      result?.isMatch ??
      result?.ok ??
      (Number(result?.confidence) >= 0.6)
    );
  })()`);
}

async function fillAwards(items, options = {}) {
  const ensureOutcome = await ensureRows(items.length, { timeoutMs: 1_000, maxAdds: 10 });
  assert.equal(ensureOutcome.failed, false, ensureOutcome.description);
  const payload = JSON.stringify(items);
  const fillOptions = JSON.stringify({
    allowOverwrite: false,
    skipEmpty: true,
    ...options,
  });
  return evaluate(`(async () => {
    const adapter = window.__testAwardsAdapter;
    const options = ${fillOptions};
    const plan = await adapter.buildPlan(${payload}, options);
    const result = await adapter.executePlan(plan, options);
    return compactResult(result);

    function compactResult(value) {
      if (value == null || typeof value !== 'object') return value;
      return {
        ok: value.ok,
        success: value.success,
        status: value.status,
        error: value.error ? String(value.error) : undefined,
        reason: value.reason ? String(value.reason) : undefined,
        summary: value.summary,
        fields: Array.isArray(value.fields) ? value.fields.map(field => ({
          awardIndex: field.awardIndex,
          field: field.field,
          fieldName: field.fieldName,
          plannedValue: field.plannedValue,
          beforeValue: field.beforeValue,
          afterValue: field.afterValue,
          status: field.status,
          reason: field.reason,
          confidence: field.confidence,
        })) : [],
      };
    }
  })()`, { awaitPromise: true });
}

async function ensureRows(targetCount, options) {
  const payload = JSON.stringify(options);
  return evaluate(`(async () => {
    try {
      const result = await window.__testAwardsAdapter.ensureRows(${targetCount}, ${payload});
      const description = result == null ? String(result) : JSON.stringify(result, (_key, value) => {
        if (value instanceof Element) return '[Element]';
        return value;
      });
      const text = description.toLowerCase();
      const explicitSuccess = result?.ok === true || result?.success === true || result?.status === 'success';
      const failed = result === false || result?.ok === false || result?.success === false ||
        result?.status === 'error' || result?.status === 'failed' ||
        (!explicitSuccess && /error|fail|失败|未找到|不存在|超时|没有增加|无法新增/.test(text));
      return { failed, description };
    } catch (error) {
      return { failed: true, description: String(error?.message || error) };
    }
  })()`, { awaitPromise: true });
}

async function fixtureSnapshot() {
  return evaluate('window.__awardsFixture.getSnapshot()');
}

async function captureVisualQa(fileName, stage) {
  if (!visualQaDirectory) return;
  if (visualQaOnly && visualQaOnly !== stage) return;
  await mkdir(visualQaDirectory, { recursive: true });
  const { data } = await browser.cdp.call('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: false,
  });
  await writeFile(resolve(visualQaDirectory, fileName), Buffer.from(data, 'base64'));
}

async function mountLocalPanel(profileAwards) {
  const profile = JSON.stringify({ profileName: '自动化测试资料', awards: profileAwards });
  await evaluate(`(() => {
    const data = { resumeData: ${profile} };
    const pick = keys => {
      if (typeof keys === 'string') return { [keys]: data[keys] };
      if (Array.isArray(keys)) return Object.fromEntries(keys.map(key => [key, data[key]]));
      if (keys && typeof keys === 'object') {
        return Object.fromEntries(Object.entries(keys).map(([key, fallback]) => [key, data[key] ?? fallback]));
      }
      return { ...data };
    };
    globalThis.chrome = globalThis.chrome || {};
    chrome.storage = {
      local: {
        get(keys, callback) { queueMicrotask(() => callback(pick(keys))); },
        set(value, callback) { Object.assign(data, value || {}); queueMicrotask(() => callback?.()); },
      },
    };
    chrome.runtime = {
      lastError: null,
      sendMessage(_message, callback) { queueMicrotask(() => callback?.({ ok: true })); },
      onMessage: { addListener(callback) { window.__mockRuntimeListener = callback; } },
    };
    window.__mockExtensionStorage = data;
  })()`);
  await evaluate(`${contentAppSource}\n//# sourceURL=content-app.js`);
  await evaluate('globalThis.JFLocalApp.mount()', { awaitPromise: true });
}

async function evaluate(expression, options = {}) {
  const response = await browser.cdp.call('Runtime.evaluate', {
    expression,
    awaitPromise: options.awaitPromise ?? true,
    returnByValue: true,
    userGesture: true,
  });
  if (response.exceptionDetails) {
    const detail = response.exceptionDetails.exception?.description ||
      response.exceptionDetails.text || '页面脚本执行失败';
    throw new Error(detail);
  }
  return response.result?.value;
}

function expectedSummary(overrides = {}) {
  return {
    planned: 0,
    success: 0,
    skippedEmpty: 0,
    skippedExisting: 0,
    conflicts: 0,
    notFound: 0,
    manualReview: 0,
    failed: 0,
    ...overrides,
  };
}

async function waitFor(predicate, timeoutMs, message) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise(resolvePromise => setTimeout(resolvePromise, 30));
  }
  throw new Error(message);
}

async function launchHeadlessBrowser(initialUrl = 'about:blank') {
  const executable = await findBrowserExecutable();
  const userDataDirectory = await mkdtemp(join(tmpdir(), 'jiefang-awards-e2e-'));
  const child = spawn(executable, [
    ...(process.env.JF_E2E_HEADED ? ['--start-minimized'] : ['--headless=new', '--disable-gpu']),
    '--disable-skia-graphite',
    '--disable-software-rasterizer',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-default-apps',
    '--disable-domain-reliability',
    '--disable-features=OptimizationHints,MediaRouter,AutofillServerCommunication',
    '--disable-sync',
    '--metrics-recording-only',
    '--no-default-browser-check',
    '--no-first-run',
    '--no-proxy-server',
    '--remote-debugging-port=0',
    `--user-data-dir=${userDataDirectory}`,
    initialUrl,
  ], {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let browserOutput = '';
  let browserExitCode = null;
  const rememberOutput = chunk => { browserOutput = `${browserOutput}${chunk.toString()}`.slice(-2_000); };
  child.stdout.on('data', rememberOutput);
  child.stderr.on('data', rememberOutput);
  child.on('exit', code => { browserExitCode = code; });

  try {
    const browserWebSocketUrl = await waitForDevToolsUrl(child, 15_000);
    const endpoint = new URL(browserWebSocketUrl);
    const httpBase = `http://${endpoint.hostname}:${endpoint.port}`;
    const targets = await waitForTargets(httpBase);
    const page = targets.find(target => target.type === 'page' && target.webSocketDebuggerUrl);
    if (!page) throw new Error('未找到浏览器页面调试目标');

    const cdp = await CdpConnection.connect(page.webSocketDebuggerUrl);
    cdp.closeDetails = () => `exit=${browserExitCode ?? 'running'} ${browserOutput.slice(-500)}`;
    const externalRequests = [];
    const consoleMessages = [];
    cdp.on('Network.requestWillBeSent', ({ request }) => {
      if (/^https?:/i.test(request.url)) externalRequests.push(request.url);
    });
    cdp.on('Runtime.consoleAPICalled', event => {
      if (!['warning', 'error'].includes(event.type)) return;
      consoleMessages.push({
        source: 'console',
        level: event.type,
        text: (event.args || []).map(arg => arg.value ?? arg.description ?? '').join(' '),
      });
    });
    cdp.on('Runtime.exceptionThrown', event => {
      consoleMessages.push({
        source: 'exception',
        level: 'error',
        text: event.exceptionDetails?.exception?.description || event.exceptionDetails?.text || 'Uncaught exception',
      });
    });
    cdp.on('Log.entryAdded', ({ entry }) => {
      if (!['warning', 'error'].includes(entry?.level)) return;
      consoleMessages.push({ source: entry.source || 'log', level: entry.level, text: entry.text || '' });
    });

    return {
      cdp,
      externalRequests,
      consoleMessages,
      async close() {
        cdp.close();
        await terminateBrowser(child);
        await rm(userDataDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      },
    };
  } catch (error) {
    await terminateBrowser(child);
    await rm(userDataDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    throw error;
  }
}

async function findBrowserExecutable() {
  const candidates = process.platform === 'win32'
    ? [
        process.env.JF_BROWSER_PATH,
        process.env.PROGRAMFILES && join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        process.env.PROGRAMFILES && join(process.env.PROGRAMFILES, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        process.env['PROGRAMFILES(X86)'] && join(process.env['PROGRAMFILES(X86)'], 'Google', 'Chrome', 'Application', 'chrome.exe'),
        process.env['PROGRAMFILES(X86)'] && join(process.env['PROGRAMFILES(X86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      ]
    : [
        '/usr/bin/google-chrome',
        '/usr/bin/google-chrome-stable',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
        '/snap/bin/chromium',
        '/usr/bin/microsoft-edge',
        '/usr/bin/microsoft-edge-stable',
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      ];

  for (const candidate of candidates.filter(Boolean)) {
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // 继续尝试下一个浏览器路径。
    }
  }
  throw new Error('未找到可用于测试的 Chrome 或 Edge 浏览器');
}

async function terminateBrowser(child) {
  if (child.killed || child.exitCode !== null) return;
  const exited = new Promise(resolvePromise => child.once('exit', resolvePromise));
  child.kill();
  await Promise.race([
    exited,
    new Promise(resolvePromise => setTimeout(resolvePromise, 3_000)),
  ]);
}

function waitForDevToolsUrl(child, timeoutMs) {
  return new Promise((resolvePromise, reject) => {
    let output = '';
    const timer = setTimeout(() => {
      reject(new Error(`浏览器调试端口启动超时：${output.slice(-500)}`));
    }, timeoutMs);
    const consume = chunk => {
      output += chunk.toString();
      const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (!match) return;
      clearTimeout(timer);
      resolvePromise(match[1]);
    };
    child.stdout.on('data', consume);
    child.stderr.on('data', consume);
    child.once('error', error => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', code => {
      if (!output.includes('DevTools listening on')) {
        clearTimeout(timer);
        reject(new Error(`浏览器提前退出（${code}）：${output.slice(-500)}`));
      }
    });
  });
}

async function waitForTargets(httpBase) {
  let lastError;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`${httpBase}/json/list`);
      if (response.ok) return response.json();
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolvePromise => setTimeout(resolvePromise, 50));
  }
  throw new Error(`无法读取浏览器调试目标：${lastError?.message || '未知错误'}`);
}

class CdpConnection {
  static async connect(url) {
    const connection = new CdpConnection(url);
    await connection.opened;
    return connection;
  }

  constructor(url) {
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    this.socket = new WebSocket(url);
    this.opened = new Promise((resolvePromise, reject) => {
      this.socket.addEventListener('open', resolvePromise, { once: true });
      this.socket.addEventListener('error', reject, { once: true });
    });
    this.socket.addEventListener('message', event => this.handleMessage(event.data));
    this.socket.addEventListener('close', () => {
      for (const { reject, timer } of this.pending.values()) {
        clearTimeout(timer);
        reject(new Error(`浏览器调试连接已关闭${this.closeDetails ? `：${this.closeDetails()}` : ''}`));
      }
      this.pending.clear();
    });
  }

  call(method, params = {}, timeoutMs = 10_000) {
    const id = this.nextId++;
    return new Promise((resolvePromise, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`浏览器调试命令超时：${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve: resolvePromise, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  on(method, listener) {
    const listeners = this.listeners.get(method) || [];
    listeners.push(listener);
    this.listeners.set(method, listeners);
  }

  close() {
    this.socket.close();
  }

  handleMessage(data) {
    const message = JSON.parse(String(data));
    if (message.id) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(`${message.error.code}: ${message.error.message}`));
      else pending.resolve(message.result || {});
      return;
    }
    for (const listener of this.listeners.get(message.method) || []) {
      listener(message.params || {});
    }
  }
}
