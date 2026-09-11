import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';
import { clickPoint, launchHeadlessBrowser, waitFor } from './support/headless-browser.mjs';

const testDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(testDirectory, '..', '..');
const extensionDirectory = resolve(projectRoot, 'dist');
const manifestPath = resolve(extensionDirectory, 'manifest.json');
// Run with JF_POPUP_DEVICE_SCALE_FACTOR=1 or 2 for real 100% / 200%
// device scaling. This browser flag is not a popup viewport override.
const popupDeviceScaleFactor = Number(process.env.JF_POPUP_DEVICE_SCALE_FACTOR || 1);
assert.ok([1, 2].includes(popupDeviceScaleFactor), 'JF_POPUP_DEVICE_SCALE_FACTOR must be 1 or 2');
const matrixFixtureDirectory = resolve(projectRoot, 'tests', 'fixtures');
const matrixFixtureFiles = new Map([
  ['/', ['phase3-5-matrix.html', 'text/html; charset=utf-8']],
  ['/phase3-5-matrix.html', ['phase3-5-matrix.html', 'text/html; charset=utf-8']],
  ['/phase3-5-matrix.css', ['phase3-5-matrix.css', 'text/css; charset=utf-8']],
  ['/phase3-5-matrix.js', ['phase3-5-matrix.js', 'text/javascript; charset=utf-8']],
]);
let browser;
let manifest;
let fixtureServer;
let fixtureUrl;
let serviceWorkerCdp;
let popupCdp;
let extensionId;
let serviceWorkerSignals = [];
let popupSignals = [];
let diagnosisBrowser;
let diagnosisPopupCdp;
let diagnosisRuntimeDirectory;

before(async () => {
  manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.background?.service_worker, 'background.js');
  assert.equal(manifest.action?.default_popup, 'popup.html');
  fixtureServer = createServer(async (request, response) => {
    const pathname = new URL(request.url || '/', 'http://127.0.0.1').pathname;
    const fixture = matrixFixtureFiles.get(pathname);
    if (!fixture) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('not found');
      return;
    }
    try {
      const body = await readFile(resolve(matrixFixtureDirectory, fixture[0]));
      response.writeHead(200, {
        'content-type': fixture[1],
        'cache-control': 'no-store',
      });
      response.end(body);
    } catch (error) {
      response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      response.end(error.message);
    }
  });
  await new Promise((resolveListen, rejectListen) => {
    fixtureServer.once('error', rejectListen);
    fixtureServer.listen(0, '127.0.0.1', resolveListen);
  });
  const fixtureAddress = fixtureServer.address();
  fixtureUrl = `http://127.0.0.1:${fixtureAddress.port}/phase3-5-matrix.html`;
  browser = await launchHeadlessBrowser({
    initialUrl: 'about:blank',
    // Branded Chrome 137+ may ignore --load-extension. Prefer Edge on Windows,
    // while retaining the normal Chromium fallback order on other platforms.
    preferExtensionLoader: true,
    browserArgs: [
      `--force-device-scale-factor=${popupDeviceScaleFactor}`,
      `--disable-extensions-except=${extensionDirectory}`,
      `--load-extension=${extensionDirectory}`,
    ],
  });
}, { timeout: 30_000 });

after(async () => {
  serviceWorkerCdp?.close();
  popupCdp?.close();
  diagnosisPopupCdp?.close();
  await diagnosisBrowser?.close();
  await browser?.close();
  if (fixtureServer?.listening) {
    await new Promise(resolveClose => fixtureServer.close(resolveClose));
  }
  if (diagnosisRuntimeDirectory) {
    await rm(diagnosisRuntimeDirectory, { recursive: true, force: true });
  }
});

test('dist 可作为 MV3 扩展加载，service worker 可运行且没有加载错误', async () => {
  const { target, cdp, runtimeManifest } = await jobFillServiceWorker();
  extensionId = extensionIdOf(target.url);
  assert.ok(extensionId, `未从 service worker URL 解析扩展 ID：${target.url}`);
  // Chrome exposes an internal service_worker.js inspector URL even when the
  // manifest points at background.js. Verify the manifest through its runtime
  // API below instead of assuming the debugger URL mirrors that filename.
  assert.match(target.url, new RegExp(`^chrome-extension://${extensionId}/`));

  serviceWorkerCdp = cdp;
  serviceWorkerSignals = collectErrors(serviceWorkerCdp);
  await serviceWorkerCdp.call('Runtime.enable');
  await serviceWorkerCdp.call('Log.enable');
  const workerManifest = runtimeManifest;
  assert.equal(workerManifest.manifest_version, 3);
  assert.equal(workerManifest.name, manifest.name);
  assert.equal(workerManifest.action.default_popup, manifest.action.default_popup);
  await quietPeriod();
  assert.deepEqual(serviceWorkerSignals, []);
  assert.doesNotMatch(browser.getBrowserOutput(), /failed to load extension|extension error/i);
});

test('manifest 指定的 popup 页面可访问并完成脚本初始化', async () => {
  assert.ok(serviceWorkerCdp && extensionId, 'service worker 烟测必须先成功');
  await openPopupInTestWindow(serviceWorkerCdp);
  let popupTarget;
  const popupUrl = `chrome-extension://${extensionId}/${manifest.action.default_popup}`;
  await waitFor(async () => {
    const targets = await browser.listTargets();
    popupTarget = targets.find(target => target.type === 'page' && target.url === popupUrl);
    return Boolean(popupTarget);
  }, 8_000, 'chrome.action.openPopup 未创建 popup 页面目标');
  popupCdp = await browser.connectTarget(popupTarget);
  popupSignals = collectErrors(popupCdp);
  await popupCdp.call('Page.enable');
  await popupCdp.call('Runtime.enable');
  await popupCdp.call('Log.enable');
  await waitFor(
    () => evaluate(popupCdp, "document.readyState === 'complete'"),
    8_000,
    'popup 页面未完成加载',
  );
  const popup = await evaluate(popupCdp, `(() => ({
    href: location.href,
    runtimeId: chrome.runtime.id,
    manifestVersion: chrome.runtime.getManifest().manifest_version,
    hasRunButton: Boolean(document.getElementById('btn-run-all')),
    scriptLoaded: typeof chrome.tabs?.query === 'function',
  }))()`);
  assert.equal(popup.href, popupUrl);
  assert.equal(popup.runtimeId, extensionId);
  assert.equal(popup.manifestVersion, 3);
  assert.equal(popup.hasRunButton, true);
  assert.equal(popup.scriptLoaded, true);
  await quietPeriod();
  assert.deepEqual(popupSignals, []);
});

test(`真实 Popup 原生尺寸、内部滚动与菜单键盘交互（${popupDeviceScaleFactor * 100}% 设备比例）`, async () => {
  assert.ok(popupCdp, 'must use the actual chrome.action.openPopup target');
  // Never use Emulation.setDeviceMetricsOverride here. Supplying a 420px
  // viewport would mask the very auto-sizing regression this test guards.
  await quietPeriod();
  const initial = await nativePopupGeometry(popupCdp);
  assertNativePopupGeometry(initial, { label: 'initial native popup', checkPrimary: true });
  assert.ok(Math.abs(initial.deviceScaleFactor - popupDeviceScaleFactor) < 0.05,
    `expected real device scale ${popupDeviceScaleFactor}, got ${initial.deviceScaleFactor}`);

  // Exercise the real renderer with bounded but long metadata text. No page
  // dimensions, CSS, storage or native viewport are modified by this fixture.
  await evaluate(popupCdp, `(() => {
    interfacePhase = 'READY';
    resumeData = { profileName: '尺寸回归测试资料', basic: { name: '示例同学' } };
    snapshot = {
      state: 'WAITING_USER', scanPhase: 'READY', scanCountsFinal: true,
      systemName: '示例大学申请', currentSectionLabel: '基本信息',
      reviewCount: 3,
      reviewItems: ['NEEDS_CONFIRMATION', 'CONFLICT', 'MISSING_JSON'].map((status, index) => ({
        fieldLabel: '待核对申请字段' + (index + 1), section: '基本信息', status,
      })),
    };
    render();
    setStatus('这是一段较长的人工核对提示，用于确认内容超过窗口高度时仅正文内部滚动。'.repeat(20), 'error');
    document.querySelector('main').scrollTop = 0;
  })()`);
  await quietPeriod();
  const longContent = await nativePopupGeometry(popupCdp);
  assertNativePopupGeometry(longContent, { label: 'long native popup', checkPrimary: true });
  assert.ok(longContent.main.scrollHeight > longContent.main.clientHeight + 20,
    `long-content fixture must actually overflow main: ${JSON.stringify(longContent.main)}`);

  await evaluate(popupCdp, 'document.querySelector("main").scrollTop = document.querySelector("main").scrollHeight');
  const scrolled = await nativePopupGeometry(popupCdp);
  assertNativePopupGeometry(scrolled, { label: 'scrolled native popup' });
  assert.ok(scrolled.main.scrollTop > 0, 'main must respond to scrolling');
  assert.equal(scrolled.rootScrollTop, 0, 'the document itself must not scroll');
  assert.ok(Math.abs(scrolled.footer.top - longContent.footer.top) <= 1,
    'footer must stay visible in place while main scrolls');

  const trigger = await evaluate(popupCdp, `(() => {
    const rect = document.getElementById('btn-advanced').getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  })()`);
  await clickPoint(popupCdp, trigger.x, trigger.y);
  const menu = await evaluate(popupCdp, `(() => {
    const element = document.getElementById('advanced-menu');
    const rect = element.getBoundingClientRect();
    return { hidden: element.hidden, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height, viewportWidth: innerWidth, viewportHeight: innerHeight };
  })()`);
  assert.equal(menu.hidden, false);
  assert.ok(menu.width > 0 && menu.height > 0);
  assert.ok(menu.left >= -1 && menu.right <= menu.viewportWidth + 1 && menu.top >= -1 && menu.bottom <= menu.viewportHeight + 1,
    `advanced menu must fit the native popup: ${JSON.stringify(menu)}`);
  await popupCdp.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await popupCdp.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  assert.equal(await evaluate(popupCdp, 'document.getElementById("advanced-menu").hidden'), true);
  assert.equal(await evaluate(popupCdp, 'document.activeElement.id'), 'btn-advanced');
  assert.deepEqual(popupSignals, []);
});

test('真实扩展消息出口保留 metadata-only actionOwnershipDebug', async () => {
  assert.ok(serviceWorkerCdp && extensionId, '最终 dist 的扩展加载烟测必须先成功');

  // Headless CDP cannot synthesize a real browser-toolbar click, so Chrome does
  // not grant activeTab to chrome.action.openPopup(). Copy the already-built
  // dist byte-for-byte and add only a loopback fixture host grant to exercise
  // the real popup -> tabs.sendMessage -> ContentController -> sanitizer route.
  // The shipped manifest above is still loaded and checked separately unchanged.
  diagnosisRuntimeDirectory = await mkdtemp(join(tmpdir(), 'jiefang-diagnosis-extension-'));
  const testExtensionDirectory = join(diagnosisRuntimeDirectory, 'dist-runtime');
  await cp(extensionDirectory, testExtensionDirectory, { recursive: true });
  await writeFile(
    join(testExtensionDirectory, 'manifest.json'),
    JSON.stringify({ ...manifest, host_permissions: ['http://127.0.0.1/*'] }, null, 2),
    'utf8',
  );
  diagnosisBrowser = await launchHeadlessBrowser({
    initialUrl: fixtureUrl,
    preferExtensionLoader: true,
    browserArgs: [
      `--force-device-scale-factor=${popupDeviceScaleFactor}`,
      `--disable-extensions-except=${testExtensionDirectory}`,
      `--load-extension=${testExtensionDirectory}`,
    ],
  });
  await waitFor(
    () => evaluate(
      diagnosisBrowser.cdp,
      "document.readyState === 'complete' && typeof window.__phase35MatrixFixture?.activateCase === 'function'",
    ),
    5_000,
    '诊断结构夹具未完成加载',
  );
  await evaluate(
    diagnosisBrowser.cdp,
    "window.__phase35MatrixFixture.activateCase('jqx-compound')",
  );
  const runtimeWorker = await jobFillServiceWorker(diagnosisBrowser);
  const runtimeExtensionId = extensionIdOf(runtimeWorker.target.url);
  await openPopupInTestWindow(runtimeWorker.cdp, fixtureUrl);
  let diagnosisPopupTarget;
  const diagnosisPopupUrl = `chrome-extension://${runtimeExtensionId}/${manifest.action.default_popup}`;
  await waitFor(async () => {
    const targets = await diagnosisBrowser.listTargets();
    diagnosisPopupTarget = targets.find(target => target.type === 'page' && target.url === diagnosisPopupUrl);
    return Boolean(diagnosisPopupTarget);
  }, 8_000, '测试宿主授权下未创建 popup 页面目标');
  diagnosisPopupCdp = await diagnosisBrowser.connectTarget(diagnosisPopupTarget);
  await diagnosisPopupCdp.call('Runtime.enable');
  await waitFor(async () => {
    const runtime = await evaluate(diagnosisPopupCdp, `(async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id || tab.url !== ${JSON.stringify(fixtureUrl)}) return null;
      try {
        const response = await chrome.tabs.sendMessage(tab.id, { type: 'GET_SYSTEM_SNAPSHOT' });
        return response?.snapshot?.runtimeRevision || null;
      } catch (_) {
        return null;
      }
    })()`);
    return runtime === 'jiefang-page-runtime-v3';
  }, 12_000, '页面控制器未按最终 dist 注入或 runtime handshake 不匹配');

  const response = await evaluate(diagnosisPopupCdp, `(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return chrome.tabs.sendMessage(tab.id, { type: 'RUN_DIAGNOSIS', action: 'return' });
  })()`);
  assert.equal(response.ok, true, JSON.stringify(response));
  assert.equal(response.diagnosis?.privacy?.mode, 'metadata-only');
  assert.equal(Array.isArray(response.diagnosis?.actionOwnershipDebug), true);
  const practice = response.diagnosis.actionOwnershipDebug
    .find(item => item?.collection === 'practice');
  assert.ok(practice, JSON.stringify(response.diagnosis.actionOwnershipDebug));
  assert.equal(practice.zeroRow, true);
  assert.equal(practice.regionRootFound, true);
  assert.equal(
    practice.finalReasonCode,
    'ACTION_OWNER_RESOLVED',
    JSON.stringify({
      actionOwnershipDebug: response.diagnosis.actionOwnershipDebug,
      embeddedSections: response.diagnosis.embeddedSections,
    }),
  );
  assert.equal(practice.acceptedAddCandidateCount, 1);
  assert.deepEqual(Object.keys(practice).sort(), [
    'acceptedAddCandidateCount',
    'collection',
    'finalReasonCode',
    'localAddCandidateCount',
    'ownerCandidateCount',
    'ownerCandidates',
    'regionId',
    'regionRootFound',
    'rejectionReasons',
    'selectedOwnerDepth',
    'zeroRow',
  ].sort());
  assert.equal(practice.ownerCandidates.every(candidate => {
    return JSON.stringify(Object.keys(candidate).sort()) === JSON.stringify([
      'acceptedAddCount',
      'depth',
      'localButtonCount',
      'normalizedAddCount',
      'ownedRegionCount',
      'qualification',
    ].sort());
  }), true);
  assert.doesNotMatch(
    JSON.stringify(practice),
    /(?:selector|outerHTML|innerHTML|currentValue|plannedValue|resume|token|cookie|password)/i,
  );
  const embeddedPractice = response.diagnosis.embeddedSections
    .find(item => item?.collection === 'practice');
  assert.equal(embeddedPractice?.actionOwnershipDebug?.finalReasonCode, 'ACTION_OWNER_RESOLVED');
  runtimeWorker.cdp.close();
});

async function nativePopupGeometry(cdp) {
  return evaluate(cdp, `(() => {
    const box = element => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom,
        width: rect.width, height: rect.height, clientWidth: element.clientWidth,
        clientHeight: element.clientHeight, scrollWidth: element.scrollWidth,
        scrollHeight: element.scrollHeight, scrollTop: element.scrollTop };
    };
    const title = document.querySelector('h1');
    const titleRange = document.createRange();
    titleRange.selectNodeContents(title);
    const titleLines = new Set([...titleRange.getClientRects()].map(rect => Math.round(rect.top)));
    const main = document.querySelector('main');
    const primary = [...document.querySelectorAll('.actions .primary')]
      .filter(element => !element.hidden && element.getBoundingClientRect().width > 0)
      .map(element => ({ id: element.id, ...box(element) }));
    return { viewportWidth: innerWidth, viewportHeight: innerHeight, deviceScaleFactor: devicePixelRatio,
      html: box(document.documentElement), body: box(document.body), main: box(main),
      footer: box(document.querySelector('body > .footer')), title: box(title),
      titleLines: titleLines.size, rootScrollTop: document.scrollingElement.scrollTop, primary };
  })()`);
}

function assertNativePopupGeometry(geometry, { label, checkPrimary = false }) {
  const evidence = `${label}: ${JSON.stringify(geometry)}`;
  for (const [name, width] of [['viewport', geometry.viewportWidth], ['html', geometry.html.width], ['body', geometry.body.width]]) {
    assert.ok(Math.abs(width - 420) <= 1, `${name} must be approximately 420 CSS px; ${evidence}`);
  }
  assert.equal(geometry.titleLines, 1, `product title must remain on one line; ${evidence}`);
  for (const [name, element] of [['html', geometry.html], ['body', geometry.body]]) {
    assert.ok(element.scrollWidth <= geometry.viewportWidth + 1, `${name} must not overflow horizontally; ${evidence}`);
    assert.ok(element.scrollHeight <= geometry.viewportHeight + 1, `${name} must not overflow vertically; ${evidence}`);
  }
  assert.ok(geometry.footer.height > 0 && geometry.footer.top >= -1 && geometry.footer.bottom <= geometry.viewportHeight + 1,
    `privacy footer must remain inside the native popup; ${evidence}`);
  if (checkPrimary) {
    assert.equal(geometry.primary.length, 1, `exactly one visible primary action is required; ${evidence}`);
    const primary = geometry.primary[0];
    assert.ok(primary.width > 0 && primary.height > 0 && primary.left >= -1 && primary.right <= geometry.viewportWidth + 1
      && primary.top >= geometry.main.top - 1 && primary.bottom <= geometry.main.bottom + 1
      && primary.bottom <= geometry.footer.top + 1,
    `primary action must be visible without scrolling; ${evidence}`);
  }
}

async function openPopupInTestWindow(workerCdp, expectedFixtureUrl = '') {
  // Each worker belongs to the fresh temporary profile created by this suite.
  // An unfocused/minimized headed browser has no implicit "current" window:
  // resolve only that test profile's host window and pass its ID explicitly.
  // The released manifest has no tabs permission, so the about:blank smoke
  // test identifies its sole normal window without requiring a readable URL.
  const host = await evaluate(workerCdp, `(async () => {
    const expectedUrl = ${JSON.stringify(expectedFixtureUrl)};
    const windows = await chrome.windows.getAll({ populate: true, windowTypes: ['normal'] });
    const candidates = expectedUrl
      ? windows.filter(window => window.tabs?.some(tab => tab.url === expectedUrl))
      : windows;
    if (candidates.length !== 1) {
      throw new Error('Expected exactly one fixture browser window, found ' + candidates.length);
    }
    const hostWindow = candidates[0];
    const fixtureTab = expectedUrl
      ? hostWindow.tabs.find(tab => tab.url === expectedUrl)
      : hostWindow.tabs?.find(tab => tab.active);
    if (!Number.isInteger(hostWindow.id) || hostWindow.id < 0 || !Number.isInteger(fixtureTab?.id)) {
      throw new Error('Fixture browser window or active tab is missing');
    }
    if (!fixtureTab.active) await chrome.tabs.update(fixtureTab.id, { active: true });
    await chrome.action.openPopup({ windowId: hostWindow.id });
    return { windowId: hostWindow.id, tabId: fixtureTab.id };
  })()`, { userGesture: true });
  assert.ok(Number.isInteger(host.windowId) && host.windowId >= 0);
  assert.ok(Number.isInteger(host.tabId) && host.tabId >= 0);
  return host;
}

async function jobFillServiceWorker(targetBrowser = browser) {
  let found;
  const observations = new Set();
  try {
    await waitFor(async () => {
      const targets = await targetBrowser.listTargets();
      for (const target of targets.filter(item => item.type === 'service_worker' && item.url.startsWith('chrome-extension://'))) {
      const cdp = await targetBrowser.connectTarget(target);
      try {
        await cdp.call('Runtime.enable');
        const runtimeManifest = await evaluate(cdp, 'chrome.runtime.getManifest()');
        observations.add(`${target.url} :: ${runtimeManifest.name || 'unnamed'} :: ${runtimeManifest.action?.default_popup || ''}`);
        if (runtimeManifest.name === manifest.name && runtimeManifest.action?.default_popup === manifest.action?.default_popup) {
          found = { target, cdp, runtimeManifest };
          return true;
        }
      } catch (error) {
        // Another browser or component extension can expose a service worker.
        observations.add(`${target.url} :: ${error.message}`);
      }
      cdp.close();
      }
      return Boolean(found);
    }, 10_000, '未发现 JobFill 扩展 service worker 调试目标');
  } catch (error) {
    const browserOutput = targetBrowser.getBrowserOutput().slice(-2_000).replace(/\s+/g, ' ');
    throw new Error(`${error.message}；观察到：${[...observations].join(' | ') || '无 chrome-extension worker'}；浏览器输出：${browserOutput}`);
  }
  return found;
}

function extensionIdOf(url) {
  return new URL(url).host;
}

function collectErrors(cdp) {
  const signals = [];
  cdp.on('Runtime.exceptionThrown', event => signals.push(event.exceptionDetails?.text || 'Uncaught exception'));
  cdp.on('Log.entryAdded', ({ entry }) => {
    if (['error', 'warning'].includes(entry?.level)) signals.push(entry.text || entry.level);
  });
  cdp.on('Runtime.consoleAPICalled', event => {
    if (['error', 'warning'].includes(event.type)) signals.push(event.type);
  });
  return signals;
}

async function evaluate(cdp, expression, options = {}) {
  const result = await cdp.call('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
    userGesture: Boolean(options.userGesture),
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || '运行时求值失败');
  }
  return result.result?.value;
}

function quietPeriod() {
  return new Promise(resolve => setTimeout(resolve, 350));
}
