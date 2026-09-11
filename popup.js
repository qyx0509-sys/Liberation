/* 解放 Popup：用户点击扩展后，按严格依赖顺序注入当前活动标签页。 */
'use strict';

const TASK_STORAGE_KEY = 'jiefang.taskState.v1';
const PAGE_RUNTIME_CONTRACT = Object.freeze({
  revision: 'jiefang-page-runtime-v3',
  requiredCapabilities: Object.freeze([
    'runtime-snapshot-contract-v1',
    'required-globals-verified-v1',
  ]),
});
const INJECTION_FILES = Object.freeze([
  // mappings
  'src/mappings/section-aliases.js',
  'src/mappings/section-structures.js',
  'src/mappings/field-aliases.js',
  'src/mappings/option-aliases.js',
  'src/mappings/date-rules.js',
  'src/mappings/file-field-aliases.js',
  // semantic normalization
  'src/semantics/boolean-semantic-adapter.js',
  'src/semantics/field-semantic-normalizer.js',
  'src/core/semantic-verification.js',
  // core dependencies
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
  // executable control layer: dependencies -> registry -> adapters -> orchestrator
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
  // adapters
  'src/adapters/generic.js',
  'src/adapters/site-profile.js',
  'src/adapters/registry.js',
  'src/adapters/generic-adapter.js',
  'src/adapters/undergraduate-awards.js',
  // Local presentation helpers precede Shadow DOM UI and the controller.
  'src/ui/design-system.js',
  'src/ui/profile-coverage.js',
  'src/ui/review-presenter.js',
  // floating UI
  'src/floating-ui/panel-state.js',
  'src/floating-ui/drag-controller.js',
  'src/floating-ui/resize-controller.js',
  'src/floating-ui/floating-panel.js',
  // engine (ArrayHandler depends on the generic DOM adapter above)
  'src/core/array-handler.js',
  'src/core/autofill-engine.js',
  // legacy fallback marker -> controller -> fail-closed bootstrap
  'src/content-app.js',
  'src/content-controller.js',
  'content.js',
]);

const SECTION_LABELS = Object.freeze({
  basic: '基本信息', contact: '联系方式', family: '家庭成员', education: '教育经历', awards: '获奖荣誉',
  research: '科研经历', projects: '项目经历', papers: '论文成果', patents: '专利成果', practice: '社会实践',
  internships: '实习经历', internship: '实习经历', student_work: '学生工作', certificates: '资格证书',
  language: '外语水平', skills: '专业技能', application: '申请信息', recommenders: '推荐人信息',
  upload_photo: '上传照片', upload_materials: '上传材料', other: '其他信息',
});
let activeTabId = null;
let snapshot = null;
let taskState = null;
let resumeData = null;
let materialIndex = [];
let lastDiagnosis = null;
let lastDiagnosisFilename = '';
let interfacePhase = 'CONNECTING';
let refreshTimer = null;
let refreshInFlight = false;
let popupClosed = false;
const busyButtons = new Set();

function element(id) { return document.getElementById(id); }
function safeText(value, max = 180) { return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max); }
function setStatus(message, tone = '') {
  const target = element('status');
  const text = safeText(message, 500);
  target.textContent = tone === 'error' && (/\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/.test(text) || !/[\u3400-\u9fff]/.test(text))
    ? '操作未完成，请检查当前页面后重试。可在高级功能中查看兼容性诊断。'
    : text;
  target.className = `status ${tone}`.trim();
  target.setAttribute('aria-live', tone === 'error' ? 'assertive' : 'polite');
}

function escapeHtml(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

async function currentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('无法获取当前标签页');
  if (/^(?:chrome|edge|about|devtools|view-source|chrome-extension):/i.test(tab.url || '')) {
    throw new Error('浏览器内部页面不允许注入，请打开学校申请页面后重试');
  }
  activeTabId = tab.id;
  return tab;
}

async function sendWithRetry(tabId, message) {
  let lastError;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await chrome.tabs.sendMessage(tabId, message);
      if (response?.ok === false) throw new Error(response.error || '页面控制器拒绝请求');
      if (response) return response;
    } catch (error) { lastError = error; }
    await new Promise(resolve => setTimeout(resolve, 75));
  }
  throw lastError || new Error('页面控制器未就绪');
}

function assertCurrentPageRuntime(response) {
  const pageSnapshot = response?.ok === true && response.snapshot && typeof response.snapshot === 'object'
    ? response.snapshot
    : null;
  const capabilities = new Set(
    Array.isArray(pageSnapshot?.runtimeCapabilities)
      ? pageSnapshot.runtimeCapabilities.map(item => safeText(item, 100)).filter(Boolean)
      : [],
  );
  const compatible = pageSnapshot?.runtimeRevision === PAGE_RUNTIME_CONTRACT.revision
    && PAGE_RUNTIME_CONTRACT.requiredCapabilities.every(capability => capabilities.has(capability));
  if (compatible) return pageSnapshot;
  throw new Error('当前页面中的“解放”运行组件版本不一致，请刷新页面后重试；为避免重复监听器，本次不会自动重新注入。');
}

function isMissingMessageReceiver(error) {
  const message = safeText(error?.message || error, 500);
  return /(?:receiving end does not exist|no receiving end)/i.test(message);
}

async function ensureController() {
  const tab = await currentTab();
  let existingResponse;
  let controllerReachable = false;
  try {
    existingResponse = await chrome.tabs.sendMessage(tab.id, { type: 'GET_SYSTEM_SNAPSHOT' });
    controllerReachable = true;
  } catch (error) {
    // A closed/navigating tab, permission error or arbitrary transport failure
    // is not evidence that injection is safe. Only Chrome's explicit
    // no-receiver result authorizes the single user-triggered injection.
    if (!isMissingMessageReceiver(error)) throw error;
  }
  if (controllerReachable) {
    assertCurrentPageRuntime(existingResponse);
    return tab;
  }
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: INJECTION_FILES });
  const injectedResponse = await sendWithRetry(tab.id, { type: 'GET_SYSTEM_SNAPSHOT' });
  assertCurrentPageRuntime(injectedResponse);
  return tab;
}

async function sendPage(message) {
  const tab = await ensureController();
  return sendWithRetry(tab.id, message);
}

function normalizedTaskState() {
  const snapshotState = safeText(snapshot?.state || '', 40).toUpperCase();
  const persistentState = safeText(taskState?.state || '', 40).toUpperCase();
  if (snapshot?.scanId) return snapshotState || 'IDLE';
  // 新页面控制器刚挂载时可能处于 IDLE；已持久化的完成/失败摘要仍应显示给用户。
  if ((!snapshotState || snapshotState === 'IDLE') && persistentState && persistentState !== 'IDLE') return persistentState;
  return snapshotState || persistentState || 'IDLE';
}

function queueForDisplay() {
  if (snapshot && Array.isArray(snapshot.sectionQueue)) return snapshot.sectionQueue;
  return Array.isArray(taskState?.queue) ? taskState.queue : [];
}

function provisionalScanSnapshot(previous = snapshot) {
  const base = previous && typeof previous === 'object' ? previous : {};
  return {
    ...base,
    scanPhase: 'SCANNING',
    scanCountsFinal: false,
    scanAttemptCount: 0,
    scanReasonCode: 'SCAN_STARTED',
    scanTelemetryDebug: {
      phase: 'SCANNING',
      attemptCount: 0,
      detectedFieldCount: 0,
      reliableFieldCount: 0,
      embeddedSectionCount: 0,
      topologyChanged: false,
      fieldSignatureChanged: false,
      resumeAvailable: Boolean(resumeData),
      finalizationReason: 'SCAN_STARTED',
    },
  };
}

function failedScanSnapshot(previous = snapshot) {
  const base = previous && typeof previous === 'object' ? previous : {};
  const debug = base.scanTelemetryDebug && typeof base.scanTelemetryDebug === 'object'
    ? base.scanTelemetryDebug
    : {};
  return {
    ...base,
    scanPhase: 'READY',
    scanCountsFinal: false,
    scanReasonCode: 'SCAN_FAILED',
    scanTelemetryDebug: {
      phase: 'READY',
      attemptCount: Math.max(0, Number(debug.attemptCount || base.scanAttemptCount || 0)),
      detectedFieldCount: Math.max(0, Number(debug.detectedFieldCount || 0)),
      reliableFieldCount: Math.max(0, Number(debug.reliableFieldCount || 0)),
      embeddedSectionCount: Math.max(0, Number(debug.embeddedSectionCount || 0)),
      topologyChanged: Boolean(debug.topologyChanged),
      fieldSignatureChanged: Boolean(debug.fieldSignatureChanged),
      resumeAvailable: Boolean(debug.resumeAvailable || resumeData),
      finalizationReason: 'SCAN_FAILED',
    },
  };
}

function presentationSnapshot() {
  return { ...(snapshot || {}), state: normalizedTaskState() };
}

function uiState() {
  if (interfacePhase === 'ERROR' || snapshot?.scanReasonCode === 'SCAN_FAILED') return 'ERROR';
  return globalThis.JFUI.taskState(presentationSnapshot());
}

function renderSystem() {
  const phase = safeText(snapshot?.scanPhase || '', 40).toUpperCase();
  const failed = interfacePhase === 'ERROR' || snapshot?.scanReasonCode === 'SCAN_FAILED';
  const pending = !failed && (interfacePhase === 'CONNECTING' || phase === 'SCANNING'
    || phase === 'STABILIZING' || snapshot?.scanCountsFinal !== true);
  element('system-name').textContent = safeText(snapshot?.systemName, 120) || '当前申请网站';
  element('system-section').textContent = safeText(snapshot?.currentSectionLabel, 100)
    || SECTION_LABELS[snapshot?.currentSection] || (pending ? '正在读取页面信息…' : '当前申请页面');
  element('system-badge').textContent = failed ? '未完成'
    : interfacePhase === 'CONNECTING' ? '连接中'
      : pending ? (phase === 'STABILIZING' ? '等待稳定' : '检查中') : '已检查';
  element('system-meta').textContent = failed
    ? '页面检查未完成，请重新检查或查看问题。'
    : pending ? '正在等待表单稳定，当前计数不会作为最终结果。'
      : `${Math.max(0, Number(snapshot?.reliableFieldCount || 0))} 项可自动处理 · ${Math.max(0, Number(snapshot?.embeddedSectionCount || 0))} 个页面内区域`;
  // 可自动导航栏目属于兼容性信息；不作为用户首屏的主要统计。
  element('system-badge').title = pending || failed ? ''
    : `可自动导航栏目：${queueForDisplay().length}`;
}

function renderResume() {
  // Count the current local profile, never the shape/row count of resumeStats.
  const coverage = globalThis.JFProfileCoverage.fromResume(resumeData || {});
  const filled = Math.max(0, Number(coverage.filled) || 0);
  const missing = Math.max(0, Number(coverage.missing) || 0);
  const percent = Math.max(0, Math.min(100, Number(coverage.percent) || 0));
  element('profile-name').textContent = resumeData
    ? safeText(resumeData.profileName, 100) || '默认申请资料'
    : '还没有申请资料，先添加或导入一份。';
  element('profile-name').hidden = Boolean(resumeData && (!resumeData.profileName || resumeData.profileName === '我的申请资料'));
  element('profile-coverage').textContent = `资料覆盖度 ${percent}%`;
  element('coverage-progress-bar').style.width = `${percent}%`;
  element('coverage-meter').setAttribute('aria-valuenow', String(percent));
  element('resume-stats').innerHTML = [[filled, '已填写'], [missing, '缺失'], [materialIndex.length, '材料']]
    .map(([count, label]) => `<div class="stat"><b>${count}</b><span>${label}${label === '材料' ? '（份）' : '（项）'}</span></div>`).join('');
  element('btn-create-profile').hidden = Boolean(resumeData);
}

function renderTask() {
  const current = presentationSnapshot();
  const state = uiState();
  element('task-summary').hidden = state === 'IDLE';
  element('readiness').className = `readiness${state === 'IDLE' ? '' : ' compact'}`;
  const queue = queueForDisplay();
  const completed = queue.filter(item => /DONE|SUCCESS|COMPLETED|SKIPPED|FILLED|PARTIAL|NO_CHANGES|FAILED/i.test(item.status || item.state || '')).length;
  const supplied = snapshot?.progress;
  const total = Math.max(0, Number(supplied?.total ?? queue.length) || 0);
  const done = Math.min(total, Math.max(0, Number(supplied?.completed ?? completed) || 0));
  const percent = total ? Math.round(done / total * 100) : 0;
  const badge = element('task-state');
  badge.textContent = interfacePhase === 'CONNECTING' ? '连接中'
    : state === 'ERROR' ? '失败'
      : snapshot?.scanCountsFinal === false && state === 'IDLE' ? '检查中'
        : globalThis.JFUI.taskLabel(current);
  badge.className = `badge ${({ IDLE: '', RUNNING: 'info', PAUSED: 'warning', WAITING_USER: 'warning', FINISHED: 'success', ERROR: 'danger' })[state] || ''}`;
  element('task-progress').textContent = total ? `${done} / ${total}${supplied?.unit === '栏目' ? ' 栏目' : ''}` : state === 'IDLE' ? '尚未开始' : '等待任务统计';
  element('task-progress-bar').style.width = `${percent}%`;
  element('task-meter').setAttribute('aria-valuenow', String(percent));
  element('task-section').textContent = safeText(snapshot?.currentSectionLabel, 100) || '核对预览后开始填写';
  element('task-section').hidden = element('task-section').textContent === element('system-section').textContent;
  element('task-note').textContent = globalThis.JFUI.actionText({ ...current, state });
  const visible = {
    IDLE: ['btn-run-all', 'btn-run-current', 'btn-panel'],
    RUNNING: ['btn-pause', 'btn-stop'],
    PAUSED: ['btn-resume', 'btn-stop'],
    WAITING_USER: ['btn-review', 'btn-skip'],
    FINISHED: ['btn-result', 'btn-rescan'],
    ERROR: ['btn-problem', 'btn-rescan'],
  }[state] || ['btn-run-all', 'btn-run-current', 'btn-panel'];
  for (const id of ['btn-run-all', 'btn-pause', 'btn-resume', 'btn-review', 'btn-result', 'btn-problem', 'btn-run-current', 'btn-panel', 'btn-stop', 'btn-skip', 'btn-rescan']) {
    const button = element(id);
    button.hidden = !visible.includes(id);
    button.disabled = busyButtons.has(id) || (['btn-run-all', 'btn-run-current'].includes(id)
      && (!resumeData || interfacePhase === 'CONNECTING' || snapshot?.scanCountsFinal !== true));
  }
}

function reviewItemsForDisplay() {
  const allowed = new Set(['NEEDS_CONFIRMATION', 'CONFLICT', 'MISSING_JSON', 'UNMATCHED', 'ERROR', 'FAILED', 'MANUAL_REVIEW', 'NOT_FOUND']);
  return (Array.isArray(snapshot?.reviewItems) ? snapshot.reviewItems : [])
    .filter(item => allowed.has(safeText(item?.status, 40).toUpperCase()));
}

function renderReview() {
  const items = reviewItemsForDisplay();
  const count = Math.max(items.length, Number(snapshot?.reviewCount) || 0);
  element('review-count').textContent = `${count} 项`;
  element('review-list').innerHTML = items.length ? items.slice(0, 3).map(item => {
    const status = globalThis.JFUI.status(item.status);
    // Render only allowlisted metadata. Never interpolate values or technical reason codes.
    const label = safeText(item.fieldLabel, 80) || '待确认字段';
    const section = SECTION_LABELS[item.section] || safeText(item.section, 60);
    return `<div class="review-item"><div class="review-item-head"><span class="review-field" title="${escapeHtml(section ? section + ' · ' : '')}${escapeHtml(status.reason)}">${escapeHtml(label)}</span><span class="review-status ${escapeHtml(status.tone)}">${escapeHtml(status.label)}</span></div></div>`;
  }).join('') : count ? `<p class="empty">有 ${count} 项需要核对，请打开网页助手查看。</p>`
    : '<p class="empty">当前没有需要处理的项目</p>';
  element('btn-review-all').hidden = !count;
}

function render() {
  renderSystem();
  renderResume();
  renderTask();
  renderReview();
}

async function loadLocalData() {
  const stored = await chrome.storage.local.get(['resumeData', 'materialLibraryIndex']);
  resumeData = stored.resumeData || null;
  materialIndex = Array.isArray(stored.materialLibraryIndex) ? stored.materialLibraryIndex : [];
  const taskResponse = await chrome.runtime.sendMessage({ type: 'GET_TASK_STATE' });
  taskState = taskResponse?.taskState || null;
}

async function scan() {
  const previousSnapshot = snapshot;
  interfacePhase = 'SCANNING';
  snapshot = provisionalScanSnapshot(previousSnapshot);
  render();
  setStatus('正在扫描当前报名系统的栏目与真实表单字段…');
  try {
    const response = await sendPage({ type: 'SCAN_SYSTEM' });
    if (!response?.snapshot || typeof response.snapshot !== 'object') {
      throw new Error('页面扫描未返回有效结果，请稍后重试');
    }
    snapshot = response.snapshot;
    taskState = null;
    interfacePhase = 'READY';
    render();
    const countsFinal = safeText(snapshot?.scanPhase || '', 40).toUpperCase() === 'READY'
      && snapshot?.scanCountsFinal === true;
    if (countsFinal) {
      // The page summary already confirms readiness. Do not leave a stale
      // pre-fill message visible after the task advances to review/results.
      setStatus('');
    } else {
      setStatus('正在等待表单稳定，当前计数不会作为最终结果。');
    }
    return snapshot;
  } catch (error) {
    interfacePhase = 'ERROR';
    snapshot = failedScanSnapshot(previousSnapshot);
    render();
    throw error;
  }
}

async function start(scope) {
  const type = scope === 'current' ? 'RUN_CURRENT' : 'RUN_ALL';
  setStatus('正在网页中打开填写前预览…');
  const response = await sendPage({ type });
  if (!response?.accepted) throw new Error(response?.error || '任务未能进入预览');
  await sendPage({ type: 'SHOW_PANEL' });
  setStatus('请在网页悬浮面板中核对预览并确认。', 'ok');
  setTimeout(() => window.close(), 220);
}

async function control(type) {
  setStatus(type === 'STOP' ? '请在网页悬浮面板中二次确认停止。' : '正在更新任务状态…');
  const response = await sendPage({ type });
  if (response?.snapshot) snapshot = response.snapshot;
  if (type !== 'STOP' && response?.ok === false) throw new Error(response.error || '状态未改变');
  render();
  if (type === 'STOP' && response?.cancelled) setStatus('已取消停止，任务保持原状态。');
  else setStatus(type === 'PAUSE' ? '任务已暂停。' : type === 'RESUME' ? '任务已继续。' : '任务已停止。', 'ok');
}

function diagnosisText() { return lastDiagnosis ? JSON.stringify(lastDiagnosis, null, 2) : ''; }
function downloadDiagnosis() {
  if (!lastDiagnosis) return;
  const blob = new Blob([diagnosisText()], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = lastDiagnosisFilename || 'jiefang-diagnosis.json';
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

async function copyDiagnosis() {
  if (!lastDiagnosis) return;
  try {
    await navigator.clipboard.writeText(diagnosisText());
  } catch (_) {
    const area = document.createElement('textarea');
    area.value = diagnosisText();
    document.body.appendChild(area);
    area.select();
    document.execCommand('copy');
    area.remove();
  }
  setStatus('诊断 JSON 已复制；内容不含字段值、材料正文、Cookie 或 Token。', 'ok');
}

async function diagnose() {
  setStatus('正在生成仅含 DOM 元数据的脱敏诊断…');
  const response = await sendPage({ type: 'RUN_DIAGNOSIS', action: 'return' });
  lastDiagnosis = response.diagnosis;
  lastDiagnosisFilename = response.filename;
  const summary = response?.summary && typeof response.summary === 'object'
    ? response.summary
    : lastDiagnosis?.summary || {};
  const count = value => {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : 0;
  };
  const fields = count(summary.fieldCount);
  const files = count(summary.fileFieldCount);
  const embedded = count(summary.embeddedSectionCount);
  const truncationNotice = response?.diagnosticMeta?.truncated
    ? ' 详细元数据已安全裁剪，以上统计仍来自裁剪前结果。'
    : '';
  element('diagnosis-summary').textContent = `诊断完成：普通字段 ${fields}，文件字段 ${files}，页面内栏目 ${embedded}。${truncationNotice}`;
  element('diagnosis-actions').hidden = false;
  element('btn-copy-diagnosis').disabled = false;
  element('btn-download-diagnosis').disabled = false;
  setAdvancedMenu(true, false);
  setStatus('诊断完成，未读取或导出网页字段当前值。', 'ok');
}

function setAdvancedMenu(open, focus = true) {
  const menu = element('advanced-menu');
  menu.hidden = !open;
  element('btn-advanced').setAttribute('aria-expanded', String(open));
  if (focus) {
    if (open) menu.querySelector('button:not(:disabled)')?.focus();
    else element('btn-advanced').focus();
  }
}

async function openPanel(tab = 'task') {
  await sendPage({ type: 'SHOW_PANEL', tab });
  window.close();
}

async function openOptions() {
  await chrome.runtime.sendMessage({ type: 'OPEN_OPTIONS' });
  window.close();
}

function bindAsync(id, action) {
  element(id).addEventListener('click', async () => {
    if (busyButtons.has(id)) return;
    busyButtons.add(id);
    element(id).disabled = true;
    try { await action(); }
    catch (error) { setStatus(error?.message || '操作失败，请重试', 'error'); }
    finally { busyButtons.delete(id); element(id).disabled = false; renderTask(); }
  });
}

bindAsync('btn-run-all', () => start('all'));
bindAsync('btn-run-current', () => start('current'));
bindAsync('btn-panel', () => openPanel('task'));
bindAsync('btn-review', () => openPanel('review'));
bindAsync('btn-review-all', () => openPanel('review'));
bindAsync('btn-result', () => openPanel('task'));
bindAsync('btn-problem', () => openPanel('review'));
bindAsync('btn-scan', scan);
bindAsync('btn-rescan', scan);
bindAsync('btn-diagnose', diagnose);
bindAsync('btn-pause', () => control('PAUSE'));
bindAsync('btn-resume', () => control('RESUME'));
bindAsync('btn-stop', () => control('STOP'));
bindAsync('btn-skip', async () => {
  const response = await sendPage({ type: 'SKIP' });
  if (response?.snapshot) snapshot = response.snapshot;
  render();
  setStatus('已请求跳过当前栏目。', 'ok');
});
bindAsync('btn-copy-diagnosis', copyDiagnosis);
bindAsync('btn-download-diagnosis', () => {
  if (!lastDiagnosis) return;
  downloadDiagnosis();
  setStatus('诊断 JSON 已下载。', 'ok');
});
bindAsync('btn-options', openOptions);
bindAsync('btn-create-profile', openOptions);
bindAsync('btn-materials', async () => {
  await chrome.tabs.create({ url: chrome.runtime.getURL('options.html#sec-material-library') });
  window.close();
});

element('btn-advanced').addEventListener('click', () => setAdvancedMenu(element('advanced-menu').hidden));
element('advanced-menu').addEventListener('keydown', event => {
  const buttons = [...element('advanced-menu').querySelectorAll('button:not(:disabled)')];
  const index = buttons.indexOf(document.activeElement);
  if (event.key === 'Escape') { event.preventDefault(); setAdvancedMenu(false); }
  if (event.key === 'Tab') setAdvancedMenu(false, false);
  if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
      : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next]?.focus();
  }
});
element('advanced-menu').addEventListener('click', event => {
  if (event.target.closest('button') && !event.target.closest('button').disabled) setAdvancedMenu(false);
});
document.addEventListener('click', event => {
  if (!element('advanced-menu').hidden && !element('advanced-menu').contains(event.target)
      && !element('btn-advanced').contains(event.target)) setAdvancedMenu(false, false);
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !element('advanced-menu').hidden) {
    event.preventDefault(); setAdvancedMenu(false);
  }
});
element('btn-about').addEventListener('click', () => {
  element('about-version').textContent = `版本 ${chrome.runtime.getManifest().version}`;
  element('about-dialog').showModal();
});
element('btn-close-about').addEventListener('click', () => element('about-dialog').close());
element('about-dialog').addEventListener('close', () => element('btn-advanced').focus());

// Read-only, non-overlapping refresh. No reinjection, rescan or writes can be
// initiated by polling/storage events; injection remains a user-opened route.
async function refreshSnapshot() {
  if (popupClosed || refreshInFlight || !activeTabId || document.visibilityState === 'hidden') return;
  refreshInFlight = true;
  try {
    const response = await chrome.tabs.sendMessage(activeTabId, { type: 'GET_SYSTEM_SNAPSHOT' });
    const next = assertCurrentPageRuntime(response);
    if (interfacePhase !== 'SCANNING') {
      snapshot = next;
      if (interfacePhase !== 'ERROR') interfacePhase = 'READY';
      render();
    }
  } catch (_) {
    // A transient navigation should not erase the last known task/review.
  } finally { refreshInFlight = false; }
}

function scheduleRefresh() {
  if (popupClosed) return;
  refreshTimer = setTimeout(async () => { await refreshSnapshot(); scheduleRefresh(); }, 1200);
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local') {
    if (changes.resumeData) resumeData = changes.resumeData.newValue || null;
    if (changes.materialLibraryIndex) materialIndex = Array.isArray(changes.materialLibraryIndex.newValue) ? changes.materialLibraryIndex.newValue : [];
  }
  if ((areaName === 'local' || areaName === 'session') && changes[TASK_STORAGE_KEY]) {
    taskState = changes[TASK_STORAGE_KEY].newValue || null;
    refreshSnapshot();
  }
  render();
});

window.addEventListener('pagehide', () => {
  popupClosed = true;
  clearTimeout(refreshTimer);
});

async function init() {
  globalThis.JFUI.hydrateIcons(document);
  await loadLocalData();
  snapshot = provisionalScanSnapshot(snapshot);
  render();
  try {
    await ensureController();
    await scan();
  } catch (error) {
    interfacePhase = 'ERROR';
    if (snapshot?.scanCountsFinal === false && snapshot?.scanReasonCode !== 'SCAN_FAILED') snapshot = failedScanSnapshot(snapshot);
    render();
    setStatus(error?.message || '当前页面暂时无法运行扩展', 'error');
  }
  scheduleRefresh();
}

init().catch(error => {
  interfacePhase = 'ERROR';
  render();
  setStatus(error?.message || '读取本地状态失败，请重新打开扩展', 'error');
});
