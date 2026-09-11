/*
 * 解放（基于 JobFill）— 本地半自动填写面板
 * Copyright (c) 2026 zlh and contributors
 * SPDX-License-Identifier: MIT
 */
(function initLocalApp(root, factory) {
  const api = factory(root?.JFGeneric, root?.JFAwardsAdapter);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.JFLocalApp = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function localAppFactory(G, AwardsApi) {
  'use strict';

  const HOST_ID = '__jf_panel__';
  const DEFAULT_PREFERENCES = Object.freeze({
    allowOverwrite: false,
    previewBeforeFill: true,
    skipEmpty: true,
  });
  const STATUS_LABELS = Object.freeze({
    success: '填写成功',
    skipped_empty: '跳过空值',
    skipped_existing: '跳过已有内容',
    conflict: '内容冲突',
    not_found: '未找到字段',
    manual_review: '需要人工确认',
    failed: '填写失败',
    planned: '计划填写',
  });

  let mounted = false;
  let host;
  let shadow;
  let adapter;
  let lastResult = null;
  let listenerInstalled = false;

  function storageGet(keys) {
    return new Promise(resolve => {
      if (!globalThis.chrome?.storage?.local) { resolve({}); return; }
      chrome.storage.local.get(keys, value => resolve(value || {}));
    });
  }

  function storageSet(value) {
    return new Promise(resolve => {
      if (!globalThis.chrome?.storage?.local) { resolve(); return; }
      chrome.storage.local.set(value, resolve);
    });
  }

  function sendMessage(message) {
    if (!globalThis.chrome?.runtime?.sendMessage) return;
    chrome.runtime.sendMessage(message, () => void chrome.runtime.lastError);
  }

  function stylesheet() {
    return `
      :host { all: initial; }
      * { box-sizing: border-box; }
      .panel {
        position: fixed; right: 22px; bottom: 22px; z-index: 2147483646;
        width: min(410px, calc(100vw - 28px)); max-height: min(760px, calc(100vh - 44px));
        overflow: hidden; color: #172033; background: #fff; border: 1px solid #d7e0ec;
        border-radius: 16px; box-shadow: 0 22px 70px rgba(15, 31, 54, .24);
        font: 13px/1.55 "Microsoft YaHei", system-ui, sans-serif;
      }
      .header { display:flex; align-items:center; justify-content:space-between; padding:14px 16px; color:#fff; background:linear-gradient(135deg,#123c69,#1b5d79); }
      .brand { display:flex; gap:10px; align-items:center; }
      .brand-mark { display:grid; place-items:center; width:34px; height:34px; border-radius:10px; background:rgba(255,255,255,.16); font-size:18px; }
      .brand strong { display:block; font-size:15px; }
      .brand small { display:block; color:#cfe9ef; font-size:11px; }
      button { font:inherit; }
      .icon-button { border:0; color:#fff; background:transparent; font-size:22px; cursor:pointer; }
      .content { max-height:calc(min(760px, 100vh - 44px) - 63px); padding:14px 16px 16px; overflow:auto; }
      .mode-note { padding:8px 10px; color:#285b43; background:#edf8f1; border:1px solid #cce8d5; border-radius:8px; font-size:11px; }
      .page-state { display:flex; align-items:flex-start; gap:9px; margin:12px 0; padding:10px 12px; background:#f5f7fa; border-radius:10px; }
      .dot { flex:none; width:9px; height:9px; margin-top:5px; border-radius:50%; background:#94a3b8; }
      .dot.ok { background:#16a34a; } .dot.warn { background:#d97706; } .dot.error { background:#dc2626; }
      .page-state strong { display:block; color:#26364a; }
      .page-state small { color:#64748b; }
      .settings { display:grid; grid-template-columns:1fr; gap:7px; margin:12px 0; padding:10px 12px; border:1px solid #e1e7ef; border-radius:10px; }
      .settings label { display:flex; align-items:center; gap:8px; cursor:pointer; }
      .settings input { accent-color:#1b647d; }
      .actions { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
      .button { min-height:38px; padding:8px 10px; border:1px solid #cbd5e1; border-radius:9px; color:#334155; background:#fff; cursor:pointer; font-weight:600; }
      .button:hover:not(:disabled) { border-color:#7c95ad; background:#f8fafc; }
      .button:disabled { opacity:.45; cursor:not-allowed; }
      .button.primary { grid-column:1 / -1; color:#fff; border-color:#167252; background:#167252; }
      .button.primary:hover:not(:disabled) { background:#115d44; }
      .button.secondary { color:#174b64; border-color:#a9c8d5; background:#eff8fb; }
      .message { margin-top:10px; color:#526173; white-space:pre-wrap; }
      .result { margin-top:12px; }
      .summary { display:grid; grid-template-columns:repeat(3,1fr); gap:6px; }
      .metric { padding:7px 5px; text-align:center; background:#f4f7fa; border-radius:8px; }
      .metric b { display:block; color:#1f3348; font-size:15px; }
      .metric span { color:#6b7b8d; font-size:10px; }
      .result-list { display:grid; gap:7px; margin-top:10px; }
      .result-item { display:grid; grid-template-columns:5px 1fr auto; gap:8px; align-items:start; padding:8px 9px; border:1px solid #e4e9ef; border-radius:8px; background:#fff; }
      .result-item .bar { width:5px; height:100%; min-height:44px; border-radius:5px; background:#64748b; }
      .result-item.success .bar { background:#16a34a; } .result-item.review .bar { background:#d97706; } .result-item.failed .bar { background:#dc2626; }
      .result-item strong { display:block; font-size:12px; }
      .result-item p { margin:2px 0 0; color:#64748b; font-size:10px; word-break:break-all; }
      .locate { padding:3px 7px; border:1px solid #cbd5e1; border-radius:6px; background:#fff; color:#334155; cursor:pointer; font-size:10px; }
      .completion { margin-top:10px; padding:9px 10px; color:#6b4c0c; background:#fff8e6; border:1px solid #f4d78b; border-radius:8px; }
      .modal-backdrop { position:fixed; inset:0; z-index:2147483647; display:grid; place-items:center; padding:18px; background:rgba(15,23,42,.54); }
      .modal-backdrop[hidden] { display:none; }
      .modal { width:min(540px,100%); max-height:min(720px,calc(100vh - 36px)); overflow:auto; padding:20px; border-radius:15px; background:#fff; box-shadow:0 24px 80px rgba(0,0,0,.32); }
      .modal h2 { margin:0 0 5px; font-size:18px; }
      .modal-intro { margin:0 0 14px; color:#64748b; }
      .preview-item { margin:9px 0; padding:10px 12px; border-left:4px solid #2b7185; border-radius:7px; background:#f4f8fa; }
      .preview-item strong { display:block; margin-bottom:4px; }
      .preview-item div { white-space:pre-wrap; word-break:break-word; }
      .modal-actions { display:flex; justify-content:flex-end; gap:8px; margin-top:16px; }
      .modal-actions button { min-width:96px; padding:9px 13px; border-radius:8px; cursor:pointer; }
      .cancel { border:1px solid #cbd5e1; background:#fff; }
      .confirm { border:1px solid #167252; color:#fff; background:#167252; }
      @media (max-width:520px) { .panel { right:10px; bottom:10px; width:calc(100vw - 20px); max-height:calc(100vh - 20px); } .summary { grid-template-columns:repeat(2,1fr); } }
    `;
  }

  function panelMarkup() {
    return `
      <aside class="panel" role="dialog" aria-label="解放本地填表工具">
        <div class="header">
          <div class="brand"><span class="brand-mark">解</span><span><strong>解放</strong><small>高校申请 · 本地半自动填表</small></span></div>
          <button class="icon-button" id="close" type="button" aria-label="关闭">×</button>
        </div>
        <div class="content">
          <div class="mode-note">🔒 保研本地模式：AI 已关闭，不发送资料、页面字段或页面源码。</div>
          <div class="page-state"><span class="dot" id="state-dot"></span><span><strong id="state-title">等待识别当前页面</strong><small id="state-detail">点击“识别本页”开始。</small></span></div>
          <div class="settings" aria-label="填写设置">
            <label><input id="allow-overwrite" type="checkbox">允许覆盖已有内容</label>
            <label><input id="preview-before-fill" type="checkbox" checked>填写前预览</label>
            <label><input id="skip-empty" type="checkbox" checked>跳过空值</label>
          </div>
          <div class="actions">
            <button class="button secondary" id="scan" type="button">识别本页</button>
            <button class="button secondary" id="diagnose" type="button">诊断当前页面</button>
            <button class="button primary" id="fill" type="button" disabled>一键填充本页</button>
            <button class="button" id="manage" type="button">管理申请资料</button>
            <button class="button" id="clear" type="button">清除结果高亮</button>
          </div>
          <div class="message" id="message" aria-live="polite"></div>
          <div class="result" id="result"></div>
        </div>
      </aside>
      <div class="modal-backdrop" id="preview-modal" hidden>
        <section class="modal" role="alertdialog" aria-modal="true" aria-labelledby="preview-title">
          <h2 id="preview-title">填写前预览</h2>
          <p class="modal-intro" id="preview-intro"></p>
          <div id="preview-list"></div>
          <div class="modal-actions"><button class="cancel" id="preview-cancel" type="button">取消</button><button class="confirm" id="preview-confirm" type="button">确认填写</button></div>
        </section>
      </div>`;
  }

  function applyPanelStyles() {
    const ViewStyleSheet = document.defaultView?.CSSStyleSheet || globalThis.CSSStyleSheet;
    if (typeof ViewStyleSheet !== 'function' || !('adoptedStyleSheets' in shadow)) {
      throw new Error('当前浏览器不支持安全的 Shadow DOM 样式表，请升级 Chrome/Edge');
    }
    const sheet = new ViewStyleSheet();
    sheet.replaceSync(stylesheet());
    shadow.adoptedStyleSheets = [sheet];
  }

  function normalizeAwards(value) {
    if (!Array.isArray(value)) return [];
    return value.slice(0, 100).map(item => ({
      time: G.safeString(item?.time),
      location: G.safeString(item?.location),
      content: G.safeString(item?.content),
      level: G.safeString(item?.level),
      rank: G.safeString(item?.rank),
      organizer: G.safeString(item?.organizer),
      certificateFileName: G.safeString(item?.certificateFileName),
      note: G.safeString(item?.note),
    }));
  }

  function setMessage(text, tone = '') {
    const element = shadow?.getElementById('message');
    if (!element) return;
    element.textContent = text;
    element.style.color = tone === 'error' ? '#b91c1c' : tone === 'ok' ? '#166534' : '#526173';
  }

  function setPageState(title, detail, tone = '') {
    shadow.getElementById('state-title').textContent = title;
    shadow.getElementById('state-detail').textContent = detail;
    shadow.getElementById('state-dot').className = `dot ${tone}`;
  }

  function getPreferences() {
    return {
      allowOverwrite: shadow.getElementById('allow-overwrite').checked,
      previewBeforeFill: shadow.getElementById('preview-before-fill').checked,
      skipEmpty: shadow.getElementById('skip-empty').checked,
    };
  }

  async function loadAdapter() {
    if (!AwardsApi?.createAdapter) throw new Error('奖励页面适配器未加载');
    const { siteAdapterConfigs } = await storageGet('siteAdapterConfigs');
    const configs = Array.isArray(siteAdapterConfigs) ? siteAdapterConfigs : [];
    const config = configs.find(item => {
      if (!item || item.enabled === false) return false;
      try {
        if (item.origin && item.origin !== location.origin) return false;
        if (item.urlPattern && !(new RegExp(item.urlPattern, 'i')).test(location.href)) return false;
        return Boolean(item.origin || item.urlPattern);
      } catch (_) { return false; }
    }) || {};
    adapter = AwardsApi.createAdapter(document, config);
    return adapter;
  }

  async function scanPage() {
    setMessage('正在识别奖励页面…');
    const currentAdapter = adapter || await loadAdapter();
    const inspection = currentAdapter.inspect();
    const { resumeData } = await storageGet('resumeData');
    const awards = normalizeAwards(resumeData?.awards);
    if (!inspection.matched) {
      setPageState('未能确认这是奖励页面', `匹配置信度 ${Math.round(inspection.confidence * 100)}%。请运行诊断并根据真实 DOM 添加适配配置。`, 'warn');
      shadow.getElementById('fill').disabled = true;
      setMessage('为避免错填，置信度不足时不会猜测字段。', 'error');
      return inspection;
    }
    const completeRows = inspection.rows.filter(row => row.fields.time && row.fields.content).length;
    setPageState('已识别：奖励情况（本科期间）', `置信度 ${Math.round(inspection.confidence * 100)}%，当前 ${completeRows} 行，资料中 ${awards.length} 条奖励。`, 'ok');
    shadow.getElementById('fill').disabled = awards.length === 0;
    setMessage(awards.length ? '可以预览并填充。网页原有内容默认不会被覆盖。' : '资料中暂无奖励，请先到“管理申请资料”添加。');
    return inspection;
  }

  function showPreview(awards) {
    return new Promise(resolve => {
      const modal = shadow.getElementById('preview-modal');
      shadow.getElementById('preview-intro').textContent = `计划填写 ${awards.length} 条奖励。确认前不会新增行，也不会修改页面。`;
      shadow.getElementById('preview-list').innerHTML = awards.map((award, index) => `
        <article class="preview-item">
          <strong>第 ${index + 1} 条</strong>
          <div>时间：${G.escapeHtml(award.time) || '（空，将跳过）'}</div>
          <div>地点：${G.escapeHtml(award.location) || '（空，将跳过）'}</div>
          <div>内容：${G.escapeHtml(award.content) || '（空，将跳过）'}</div>
        </article>`).join('');
      modal.hidden = false;
      const finish = accepted => {
        modal.hidden = true;
        shadow.getElementById('preview-confirm').onclick = null;
        shadow.getElementById('preview-cancel').onclick = null;
        resolve(accepted);
      };
      shadow.getElementById('preview-confirm').onclick = () => finish(true);
      shadow.getElementById('preview-cancel').onclick = () => finish(false);
      shadow.getElementById('preview-confirm').focus();
    });
  }

  async function preExpandSections(currentAdapter, awards) {
    return currentAdapter.ensureRows(awards.length, {
      timeoutMs: 3500,
      maxAdds: Math.min(50, Math.max(10, awards.length)),
    });
  }

  function toneForStatus(status) {
    if (status === 'success') return 'success';
    if (status === 'failed' || status === 'not_found') return 'failed';
    if (status === 'conflict' || status === 'manual_review') return 'review';
    return 'skipped';
  }

  function safeDisplay(value) {
    const text = G.safeString(value);
    return text || '（空）';
  }

  function renderResult(result) {
    lastResult = result;
    const summary = result.summary || {};
    const metrics = [
      ['计划字段', summary.planned || 0],
      ['填写成功', summary.success || 0],
      ['跳过空值', summary.skippedEmpty || 0],
      ['跳过已有', summary.skippedExisting || 0],
      ['未找到', summary.notFound || 0],
      ['人工确认', (summary.manualReview || 0) + (summary.conflicts || 0)],
    ];
    const resultElement = shadow.getElementById('result');
    resultElement.innerHTML = `
      <div class="summary">${metrics.map(([label, value]) => `<div class="metric"><b>${value}</b><span>${label}</span></div>`).join('')}</div>
      <div class="result-list">${result.fields.map((field, index) => `
        <div class="result-item ${toneForStatus(field.status)}">
          <span class="bar"></span>
          <span><strong>第 ${field.awardIndex + 1} 条 · ${G.escapeHtml(field.fieldName)} · ${STATUS_LABELS[field.status] || field.status}</strong>
          <p>计划：${G.escapeHtml(safeDisplay(field.plannedValue))}<br>填写前：${G.escapeHtml(safeDisplay(field.beforeValue))}<br>填写后：${G.escapeHtml(safeDisplay(field.afterValue))}${field.reason ? `<br>说明：${G.escapeHtml(field.reason)}` : ''}</p></span>
          ${field.element ? `<button class="locate" type="button" data-locate="${index}">定位</button>` : ''}
        </div>`).join('')}</div>
      <div class="completion">本页填写完成，请人工核对后继续。扩展不会点击“下一步”或任何提交按钮。</div>`;
    resultElement.querySelectorAll('[data-locate]').forEach(button => {
      button.addEventListener('click', () => {
        const field = lastResult?.fields?.[Number(button.dataset.locate)];
        G.highlight(field?.element, toneForStatus(field?.status) === 'failed' ? 'failed' : 'manual');
      });
    });
  }

  async function fillPage() {
    const button = shadow.getElementById('fill');
    button.disabled = true;
    try {
      const currentAdapter = adapter || await loadAdapter();
      const detection = currentAdapter.detectPage();
      if (!detection.matched) throw new Error('无法高置信度确认奖励页面，已停止填写');
      const { resumeData } = await storageGet('resumeData');
      const awards = normalizeAwards(resumeData?.awards);
      if (!awards.length) throw new Error('资料中没有 awards 奖励数据');
      const preferences = getPreferences();
      await storageSet({ fillPreferences: preferences });
      if (preferences.previewBeforeFill && !(await showPreview(awards))) {
        setMessage('已取消。页面未发生任何修改。');
        return;
      }

      setMessage(`正在核对并准备 ${awards.length} 行…`);
      const expansion = await preExpandSections(currentAdapter, awards);
      if (!expansion.ok) throw new Error(expansion.error || '奖励行新增失败');
      setMessage(expansion.added > 0 ? `已确认新增 ${expansion.added} 行，正在逐行填写…` : '页面行数充足，正在逐行填写…');
      const plan = currentAdapter.buildPlan(awards, preferences);
      const result = await currentAdapter.executePlan(plan, preferences);
      renderResult(result);
      setMessage(`填写检查完成：成功 ${result.summary.success} 个字段，需人工处理 ${(result.summary.manualReview || 0) + (result.summary.conflicts || 0) + (result.summary.failed || 0)} 个。`, 'ok');
      setPageState('填写检查已完成', '请查看逐项结果并人工核对网页。', result.summary.failed || result.summary.notFound ? 'warn' : 'ok');
    } catch (error) {
      setMessage(`已停止：${error?.message || error}`, 'error');
      setPageState('填写未完成', '未自动继续，也未点击页面导航或提交按钮。', 'error');
    } finally {
      button.disabled = false;
    }
  }

  function downloadJson(data, fileName) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    anchor.style.display = 'none';
    host.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  async function diagnosePage() {
    try {
      const currentAdapter = adapter || await loadAdapter();
      const diagnosis = currentAdapter.diagnosePage();
      downloadJson(diagnosis, `jiefang-page-diagnosis-${new Date().toISOString().slice(0, 10)}.json`);
      setMessage(`诊断已导出：${diagnosis.visibleFormFieldCount} 个可见字段。文件不含字段值、页面源码或浏览器认证数据。`, 'ok');
      return diagnosis;
    } catch (error) {
      setMessage(`诊断失败：${error?.message || error}`, 'error');
      return null;
    }
  }

  function clearHighlights() {
    lastResult?.fields?.forEach(field => {
      if (!field.element) return;
      field.element.style.outline = '';
      field.element.style.outlineOffset = '';
    });
    shadow.getElementById('result').innerHTML = '';
    lastResult = null;
    setMessage('已清除本次检查结果和高亮。');
  }

  async function mount() {
    if (!G || !AwardsApi) throw new Error('解放核心脚本加载不完整');
    if (mounted && host?.isConnected) {
      host.style.display = '';
      await scanPage();
      return { visible: true };
    }
    host = document.getElementById(HOST_ID) || document.createElement('div');
    host.id = HOST_ID;
    if (!host.isConnected) document.documentElement.appendChild(host);
    shadow = host.shadowRoot || host.attachShadow({ mode: 'open' });
    shadow.innerHTML = panelMarkup();
    applyPanelStyles();
    mounted = true;

    const { fillPreferences } = await storageGet('fillPreferences');
    const preferences = { ...DEFAULT_PREFERENCES, ...(fillPreferences || {}) };
    shadow.getElementById('allow-overwrite').checked = Boolean(preferences.allowOverwrite);
    shadow.getElementById('preview-before-fill').checked = preferences.previewBeforeFill !== false;
    shadow.getElementById('skip-empty').checked = preferences.skipEmpty !== false;

    shadow.getElementById('close').addEventListener('click', () => { host.style.display = 'none'; });
    shadow.getElementById('scan').addEventListener('click', scanPage);
    shadow.getElementById('fill').addEventListener('click', fillPage);
    shadow.getElementById('diagnose').addEventListener('click', diagnosePage);
    shadow.getElementById('manage').addEventListener('click', () => sendMessage({ type: 'OPEN_OPTIONS' }));
    shadow.getElementById('clear').addEventListener('click', clearHighlights);
    shadow.querySelectorAll('.settings input').forEach(input => input.addEventListener('change', () => storageSet({ fillPreferences: getPreferences() })));

    if (!listenerInstalled && globalThis.chrome?.runtime?.onMessage) {
      listenerInstalled = true;
      chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
        if (message?.type === 'QUERY_PANEL') {
          sendResponse({ visible: Boolean(host?.isConnected && host.style.display !== 'none') });
          return true;
        }
        if (message?.type === 'SHOW_PANEL') {
          host.style.display = '';
          scanPage().finally(() => sendResponse({ visible: true }));
          return true;
        }
        if (message?.type === 'TOGGLE_PANEL') {
          const visible = host.style.display === 'none';
          host.style.display = visible ? '' : 'none';
          if (visible) scanPage();
          sendResponse({ visible });
          return true;
        }
        if (message?.type === 'RUN_DIAGNOSIS') {
          diagnosePage().then(value => sendResponse({ ok: Boolean(value) }));
          return true;
        }
        return undefined;
      });
    }

    await loadAdapter();
    await scanPage();
    return { visible: true };
  }

  return {
    DEFAULT_PREFERENCES,
    diagnosePage,
    mount,
    preExpandSections,
    scanPage,
  };
});
