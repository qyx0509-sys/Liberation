import test, { before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { launchHeadlessBrowser, evaluate, waitFor } from './support/headless-browser.mjs';
const root = resolve(import.meta.dirname, '../..');
const output = resolve(root, 'ui-review');
const seed = { profileName: '我的申请资料', basic: { name: '示例同学', namePinyin: 'SHILI TONGXUE', gender: '女', idType: '居民身份证', nationality: '中国' }, personal: {}, contact: {}, education: [{ school: '示例大学', major: '材料科学与工程', gpa: '3.80/4.00' }], awards: [{ time: '2025-06', category: '荣誉称号', content: '优秀学生', level: '校级', rank: '一等奖', participationMode: '个人' }], family: [], internships: [], work: [], projects: [], research: [], practice: [], languages: [], papers: [], skills: {}, application: {}, preservedUnknown: { marker: 'keep-me' } };
const ready = { schemaVersion: 1, runtimeRevision: 'jiefang-page-runtime-v3', runtimeCapabilities: ['runtime-snapshot-contract-v1', 'required-globals-verified-v1'], scanId: 'scan:ui-visual', state: 'IDLE', systemName: '示例大学研究生申请', currentSection: 'basic', currentSectionLabel: '基本信息', scanPhase: 'READY', scanCountsFinal: true, reliableFieldCount: 18, detectedFieldCount: 26, embeddedSectionCount: 4, sectionCount: 2, sectionQueue: [{ label: '基本信息', sectionId: 'basic', status: 'CURRENT' }, { label: '教育经历', sectionId: 'education', status: 'PENDING' }], progress: { completed: 0, total: 26, percent: 0 }, profileCoverage: { filled: 12, total: 52, missing: 40, percent: 23 }, reviewItems: [], recentFields: [], finalSubmitBlocked: true };
const reviewItems = [
  { fieldLabel: '出生日期', section: '基本信息', status: 'NEEDS_CONFIRMATION', reason: '日期控件需要你确认，请核对后继续' },
  { fieldLabel: '本科专业', section: '教育经历', status: 'CONFLICT', reason: '页面已有不同内容，已保留页面内容' },
  { fieldLabel: '固定电话', section: '基本信息', status: 'MISSING_JSON', reason: '我的申请资料中没有该信息，请补充资料' },
  { fieldLabel: '上传材料', section: '材料上传', status: 'UNMATCHED', reason: '当前字段暂未可靠识别，请手动填写' },
];
let browser;
const evidence = [];
before(async () => {
  await mkdir(output, { recursive: true });
  browser = await launchHeadlessBrowser({ initialUrl: pathToFileURL(resolve(root, 'tests/fixtures/awards.html')).href, width: 1440, height: 1000 });
  await browser.cdp.call('Page.addScriptToEvaluateOnNewDocument', { source: mockSource() });
}, { timeout: 30000 });
after(async () => {
  await writeFile(resolve(output, 'ui-checks.json'), JSON.stringify(evidence, null, 2));
  await browser?.close();
});
afterEach(() => {
  assert.deepEqual(browser.consoleMessages, [], 'no relevant console warning/error');
  assert.deepEqual(browser.externalRequests, [], 'all UI assets remain local');
  browser.resetSignals();
});
const run = expression => evaluate(browser.cdp, expression, { awaitPromise: true, userGesture: true });
async function viewport(width, height = 1000) { await browser.cdp.call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }); }
async function navigate(path) {
  await browser.cdp.call('Page.navigate', { url: pathToFileURL(resolve(root, path)).href });
  await waitFor(() => run('document.readyState === "complete"'), 5000, 'UI document did not load');
}
async function capture(name, scope = 'document') {
  // Let local 120–220ms color transitions settle before visual comparison.
  await new Promise(done => setTimeout(done, 240));
  const check = await run(`(() => {
    const root = ${scope === 'floating' ? 'window.__panel.shadow' : 'document'};
    const buttons = [...root.querySelectorAll('button')].filter(e => e.getBoundingClientRect().width && getComputedStyle(e).visibility !== 'hidden');
    const ids = [...root.querySelectorAll('[id]')].map(e => e.id);
    return { title: document.title, href: location.href, bodyLength: document.body.innerText.length,
      overflow: document.documentElement.scrollWidth > innerWidth + 1,
      duplicateIds: ids.filter((id, index) => ids.indexOf(id) !== index),
      unnamedButtons: buttons.filter(e => !(e.getAttribute('aria-label') || e.textContent.trim() || e.title)).map(e => e.id),
      overlay: Boolean(document.querySelector('vite-error-overlay,nextjs-portal,#webpack-dev-server-client-overlay')) };
  })()`);
  assert.equal(check.overflow, false, `${name}: horizontal overflow`);
  assert.deepEqual(check.duplicateIds, [], `${name}: duplicate IDs`);
  assert.deepEqual(check.unnamedButtons, [], `${name}: unnamed buttons`);
  assert.equal(check.overlay, false);
  assert.ok(check.bodyLength > 10);
  const shot = await browser.cdp.call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile(resolve(output, `${name}.png`), Buffer.from(shot.data, 'base64'));
  evidence.push({ name, ...check });
}
async function setPopup(patch) { await run(`window.__uiSnapshot = ${JSON.stringify({ ...ready, ...patch })}; snapshot = window.__uiSnapshot; render();`); }

test('Popup: real local page, unique state-driven CTA, review and keyboard advanced menu', async () => {
  // Supplement the un-emulated native popup test with the same 600px height cap.
  await viewport(420, 600);
  await navigate('dist/popup.html');
  await waitFor(() => run('document.getElementById("system-name").textContent.includes("示例")'), 5000, 'Popup did not finish scanning');
  for (const [name, patch, primary] of [
    ['popup-empty', { profileCoverage: { filled: 0, total: 52, missing: 52, percent: 0 } }, 'btn-run-all'],
    ['popup-ready', {}, 'btn-run-all'],
    ['popup-running', { state: 'RUNNING', running: true, progress: { completed: 14, total: 26, percent: 54 } }, 'btn-pause'],
    ['popup-paused', { state: 'PAUSED' }, 'btn-resume'],
    ['popup-review', { state: 'WAITING_USER', reviewItems, reviewCount: 4 }, 'btn-review'],
    ['popup-finished', { state: 'FINISHED', progress: { completed: 26, total: 26, percent: 100 } }, 'btn-result'],
    ['popup-error', { state: 'ERROR' }, 'btn-problem'],
  ]) {
    await setPopup(patch);
    await run(`resumeData = ${JSON.stringify(seed)}; ${name === 'popup-empty' ? 'resumeData = null;' : ''} render();`);
    const visible = await run(`[...document.querySelectorAll('.actions .primary')].filter(e => e.getBoundingClientRect().width).map(e => ({id:e.id,bottom:e.getBoundingClientRect().bottom}))`);
    assert.deepEqual(visible.map(e => e.id), [primary]);
    assert.ok(visible[0].bottom <= 600, 'primary action must fit first viewport');
    await capture(name);
  }
  await setPopup({ state: 'WAITING_USER', reviewItems, reviewCount: 4 });
  assert.ok(await run('document.getElementById("review-list").children.length <= 3'));
  await run('document.getElementById("btn-review-all").click()');
  assert.ok(await run('window.__messages.some(m => m.type === "SHOW_PANEL" && m.tab === "review")'));
  await run('document.getElementById("btn-advanced").click()');
  assert.equal(await run('document.getElementById("advanced-menu").hidden'), false);
  await browser.cdp.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  assert.equal(await run('document.getElementById("advanced-menu").hidden'), true);
  assert.equal(await run('document.activeElement.id'), 'btn-advanced');
  await browser.cdp.call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
  await capture('popup-dark');
  await browser.cdp.call('Emulation.setEmulatedMedia', { features: [] });
}, { timeout: 30000 });

test('Floating: semantic tabs, task/review/log, launcher, modal focus and persisted sizing', async () => {
  await viewport(1100, 800);
  await navigate('tests/fixtures/awards.html');
  for (const file of ['src/ui/design-system.js', 'src/ui/profile-coverage.js', 'src/floating-ui/panel-state.js', 'src/floating-ui/drag-controller.js', 'src/floating-ui/resize-controller.js', 'src/floating-ui/floating-panel.js']) await run(await readFile(resolve(root, file), 'utf8'));
  await run('(async () => { window.__actions=[]; window.__panel = await JFFloatingPanel.create(Object.fromEntries(["runAll","runCurrent","scan","pause","resume","stop","skip","rerun","diagnose","materials","settings"].map(key=>[key,()=>window.__actions.push(key)]))); })()');
  await run(`window.__panel.update(${JSON.stringify({ ...ready, state: 'RUNNING', running: true, reviewItems, reviewCount: 4, recentFields: [{ fieldLabel: '姓名', section: '基本信息', status: 'SUCCESS', reason: '已填写' }, ...reviewItems.slice(0, 3)], progress: { completed: 14, total: 26, percent: 54 } })});`);
  assert.equal(await run('window.__panel.shadow.querySelectorAll("[role=tab]").length'), 3);
  for (const tab of ['task', 'review', 'log']) {
    await run(`window.__panel.selectTab('${tab}')`);
    if (tab === 'log') await run('window.__panel.log("当前页面检查完成，等待用户核对。");');
    assert.equal(await run('window.__panel.shadow.querySelectorAll("[role=tab][aria-selected=true]").length'), 1);
    await capture(`floating-${tab}`, 'floating');
  }
  await run('window.__panel.selectTab("task")');
  const pauseId = await run('[...window.__panel.shadow.querySelectorAll("button")].find(e=>e.textContent.trim()==="暂停")?.id');
  assert.ok(pauseId);
  await run(`window.__panel.shadow.getElementById(${JSON.stringify(pauseId)}).click()`);
  assert.ok(await run('window.__actions.includes("pause")'));
  await run('window.__panel.persist({ minimized: true });');
  await capture('launcher', 'floating');
  await run('window.__panel.show()');
  await browser.cdp.call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
  await capture('floating-dark', 'floating');
  await browser.cdp.call('Emulation.setEmulatedMedia', { features: [] });
}, { timeout: 30000 });

test('Options: responsive workspace, editable-field coverage, dirty/save/reload and no data loss', async () => {
  await viewport(1440);
  await navigate('dist/options.html');
  await waitFor(() => run('document.getElementById("p_name").value === "示例同学"'), 5000, 'Options failed to fill stored data');
  for (const width of [1440, 1024, 768, 390]) {
    await viewport(width);
    await capture(width === 390 ? 'options-mobile' : `options-${width}`);
  }
  await viewport(1440);
  await browser.cdp.call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
  await capture('options-dark');
  await browser.cdp.call('Emulation.setEmulatedMedia', { features: [] });
  const coverage = await run('JFProfileCoverage.fromDocument(document)');
  assert.ok(coverage.total > 50 && coverage.filled > 0 && coverage.missing > 0);
  const beforeUnloadBlocked = () => run('(() => { const event = new Event("beforeunload",{cancelable:true}); window.dispatchEvent(event); return event.defaultPrevented; })()');
  const escape = () => browser.cdp.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  assert.equal(await beforeUnloadBlocked(), false, 'saved profile must not block closing');
  await run('document.getElementById("btn-export-menu").click()');
  assert.equal(await run('document.getElementById("export-menu").hidden'), false);
  await escape();
  assert.equal(await run('document.getElementById("export-menu").hidden'), true);
  assert.equal(await run('document.activeElement.id'), 'btn-export-menu');
  for (const width of [1024, 390]) {
    await viewport(width);
    await run('document.getElementById("btn-inspector").focus();document.getElementById("btn-inspector").click()');
    assert.equal(await run('document.getElementById("profile-inspector").getAttribute("aria-modal")'), 'true');
    assert.equal(await run('document.activeElement.id'), 'btn-inspector-close');
    assert.ok(await run('document.querySelectorAll("#missing-fields > button").length <= 5'));
    await escape();
    assert.equal(await run('document.getElementById("profile-inspector").classList.contains("is-open")'), false);
    assert.equal(await run('document.activeElement.id'), 'btn-inspector');
  }
  await run('document.getElementById("btn-inspector").click();document.querySelector("#missing-fields > button").click()');
  assert.ok(await run('document.activeElement.matches("#profile-content input,#profile-content select,#profile-content textarea")'), 'missing-field action focuses a real profile field');
  assert.equal(await run('document.getElementById("profile-inspector").classList.contains("is-open")'), false);
  await viewport(1440);
  await run('const input = document.getElementById("p_name"); input.value="已修改示例"; input.dispatchEvent(new Event("input",{bubbles:true}));');
  await waitFor(() => run('/未保存/.test(document.body.innerText)'), 3000, 'dirty state absent');
  assert.equal(await beforeUnloadBlocked(), true, 'dirty profile prevents accidental closing');
  await run('window.__failNextProfileSave=true;document.getElementById("btn-save").click()');
  await waitFor(() => run('document.getElementById("save-state").dataset.state === "save-error"'), 3000, 'storage error is surfaced');
  assert.equal(await run('document.getElementById("p_name").value'), '已修改示例');
  assert.equal(await run('JSON.parse(localStorage.getItem("__jf_ui_store__")).resumeData.basic.name'), '示例同学');
  assert.equal(await beforeUnloadBlocked(), true, 'failed save keeps unsaved edits protected');
  await run('document.getElementById("btn-save").click()');
  await waitFor(() => run('JSON.parse(localStorage.getItem("__jf_ui_store__")).resumeData.basic.name === "已修改示例"'), 3000, 'save did not persist edit');
  assert.equal(await beforeUnloadBlocked(), false);
  assert.equal(await run('JSON.parse(localStorage.getItem("__jf_ui_store__")).resumeData.preservedUnknown.marker'), 'keep-me');
  await navigate('dist/options.html');
  await waitFor(() => run('document.getElementById("p_name").value === "已修改示例"'), 5000, 'saved edit lost on reload');
  assert.ok(await run('/已保存/.test(document.body.innerText)'));
  const unlabeled = await run('[...document.querySelectorAll("#profile-content input,#profile-content select,#profile-content textarea")].filter(e=>!e.hidden && !e.closest("[hidden]") && !e.labels?.length && !e.getAttribute("aria-label") && e.type!=="hidden").map(e=>e.id || e.dataset.key)');
  assert.deepEqual(unlabeled, [], 'all main form controls have associated labels');
  await run('(() => { const transfer = new DataTransfer(); transfer.items.add(new File(["{broken-json"],"broken.json",{type:"application/json"})); const file=document.getElementById("importFile"); file.files=transfer.files; file.dispatchEvent(new Event("change",{bubbles:true})); })()');
  await waitFor(() => run('document.getElementById("save-state").dataset.state === "import-error"'), 3000, 'invalid JSON reports import error');
  assert.equal(await run('document.getElementById("p_name").value'), '已修改示例');
  assert.equal(await run('JSON.parse(localStorage.getItem("__jf_ui_store__")).resumeData.preservedUnknown.marker'), 'keep-me');
  assert.equal(await beforeUnloadBlocked(), false, 'failed import does not invent unsaved profile changes');

  // Load two real saved records carrying non-editable metadata, then operate only through their controls.
  await run('chrome.storage.local.get("resumeData").then(({resumeData})=>chrome.storage.local.set({resumeData:{...resumeData,education:[{school:"记录甲",attachments:["file_alpha"],futureField:"alpha"},{school:"记录乙",attachments:["file_beta"],futureField:"beta"}]}}))');
  await navigate('dist/options.html');
  await waitFor(() => run('document.querySelectorAll("#edu-list > .multi-item").length === 2'), 3000, 'two records loaded');
  await run('document.querySelector("#edu-list .multi-item:first-child [data-record-move=down]").click()');
  await waitFor(() => run('document.querySelector("#edu-list .multi-item:first-child [data-key=school]").value === "记录乙"'), 3000, 'record moved down');
  await run('document.getElementById("btn-save").click()');
  await waitFor(() => run('document.getElementById("save-state").dataset.state === "saved"'), 3000, 'moved records saved');
  assert.deepEqual(await run('JSON.parse(localStorage.getItem("__jf_ui_store__")).resumeData.education.map(item=>({school:item.school,attachments:item.attachments,futureField:item.futureField}))'), [
    { school: '记录乙', attachments: ['file_beta'], futureField: 'beta' },
    { school: '记录甲', attachments: ['file_alpha'], futureField: 'alpha' },
  ]);
  // Each cycle cancels and immediately reopens the same native dialog within one
  // task, then drains the OLD native close event. It must not settle the new session.
  for (let cycle = 0; cycle < 8; cycle += 1) {
    await run('document.getElementById("edu-add").click()');
    await waitFor(() => run('document.querySelectorAll("#edu-list > .multi-item").length === 3'), 3000, 'temporary lifecycle-test record added');
    const dialogSurvived = await run(`(async () => {
      const dialog = document.getElementById('delete-record-dialog');
      const remove = document.querySelector('#edu-list .multi-item:last-child .btn-remove');
      remove.click();
      const oldCloseArrived = new Promise(resolve => dialog.addEventListener('close', resolve, { once: true }));
      document.getElementById('delete-record-cancel').click();
      remove.click();
      await oldCloseArrived;
      const survived = dialog.open;
      document.getElementById('delete-record-confirm').click();
      return survived;
    })()`);
    assert.equal(dialogSurvived, true, `cycle ${cycle + 1}: old close event must not cancel newly opened dialog`);
    await waitFor(() => run('document.querySelectorAll("#edu-list > .multi-item").length === 2'), 3000, `cycle ${cycle + 1}: only confirmed temporary record removed`);
  }
  await run('document.getElementById("btn-save").click()');
  await waitFor(() => run('document.getElementById("save-state").dataset.state === "saved"'), 3000, 'lifecycle checks saved');
  await run('document.querySelector("#edu-list .multi-item:first-child .btn-remove").click()');
  assert.equal(await run('document.getElementById("delete-record-dialog").open'), true);
  await run('document.getElementById("delete-record-cancel").click()');
  assert.equal(await run('document.querySelectorAll("#edu-list > .multi-item").length'), 2, 'cancel deletion keeps both records');
  assert.equal(await beforeUnloadBlocked(), false, 'cancel deletion keeps saved state');
  await run('document.querySelector("#edu-list .multi-item:first-child .btn-remove").click()');
  await run('document.getElementById("delete-record-confirm").click()');
  await waitFor(() => run('document.querySelectorAll("#edu-list > .multi-item").length === 1'), 3000, 'confirmed record removed');
  assert.equal(await beforeUnloadBlocked(), true);
  await run('document.getElementById("btn-save").click()');
  await waitFor(() => run('JSON.parse(localStorage.getItem("__jf_ui_store__")).resumeData.education.length === 1'), 3000, 'deletion persisted');
  assert.deepEqual(await run('JSON.parse(localStorage.getItem("__jf_ui_store__")).resumeData.education[0].attachments'), ['file_alpha']);
  assert.equal(await run('JSON.parse(localStorage.getItem("__jf_ui_store__")).resumeData.education[0].futureField'), 'alpha');
  assert.equal(await run('JSON.parse(localStorage.getItem("__jf_ui_store__")).resumeData.preservedUnknown.marker'), 'keep-me');
}, { timeout: 60000 });

function mockSource() {
  return `(() => {
    const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
    const key='__jf_ui_store__';
    if(!localStorage.getItem(key)) localStorage.setItem(key,JSON.stringify({resumeData:${JSON.stringify(seed)}}));
    const read=()=>JSON.parse(localStorage.getItem(key)||'{}');
    const finish=(value,callback)=>{if(typeof callback==='function')queueMicrotask(()=>callback(clone(value)));return Promise.resolve(clone(value));};
    const local={get(keys,callback){const data=read();return finish(keys==null?data:typeof keys==='string'?{[keys]:data[keys]}:Object.fromEntries((Array.isArray(keys)?keys:Object.keys(keys)).map(k=>[k,data[k]])),callback);},set(items,callback){if(window.__failNextProfileSave && items.resumeData){window.__failNextProfileSave=false;return Promise.reject(new Error("Simulated local storage failure"));}localStorage.setItem(key,JSON.stringify({...read(),...clone(items)}));return finish(undefined,callback);},remove(keys,callback){const data=read();for(const k of Array.isArray(keys)?keys:[keys])delete data[k];localStorage.setItem(key,JSON.stringify(data));return finish(undefined,callback);}};
    window.__messages=[];window.__uiSnapshot=${JSON.stringify(ready)};
    window.close=()=>{window.__popupClosed=true;};
    const chromeRoot=globalThis.chrome||{};
    chromeRoot.storage={local,session:local,onChanged:{addListener(){},removeListener(){}}};
    chromeRoot.runtime={id:'jobfill-local-ui-test',lastError:null,getManifest:()=>({version:'3.0.3'}),getURL:path=>new URL(path,location.href).href,sendMessage(message,callback){window.__messages.push(message);return finish({ok:true,taskState:null},callback);},onMessage:{addListener(){},removeListener(){}}};
    chromeRoot.tabs={query:async()=>[{id:73,url:'https://example.invalid/application'}],sendMessage:async(id,message)=>{window.__messages.push(message);return {ok:true,snapshot:window.__uiSnapshot};},create:async()=>{}};
    chromeRoot.scripting={executeScript:async()=>{throw new Error('Unexpected runtime reinjection')}};
    globalThis.chrome=chromeRoot;
  })();`;
}
