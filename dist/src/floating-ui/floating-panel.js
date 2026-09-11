/*
 * 解放：网页内 Shadow DOM 悬浮控制面板。
 * Copyright (c) 2026 zlh and contributors
 * SPDX-License-Identifier: MIT
 */
(function initFloatingPanel(root, factory) {
  const api = factory(root, root?.JFPanelState, root?.JFDragController, root?.JFResizeController);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.JFFloatingPanel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function floatingPanelFactory(root, PanelState, Drag, Resize) {
  'use strict';
  const HOST_ID = '__jf_panel__';
  let singleton = null;

  function escapeHtml(value) {
    return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function icon(name) { return root.JFUI.icon(name); }
  function css() {
    return root.JFUI.tokensCSS + `
:host{all:initial;color-scheme:light dark}*{box-sizing:border-box}[hidden]{display:none!important}button,input,select,textarea{font:inherit}button{cursor:pointer;transition:background 160ms,border-color 160ms}button:disabled{opacity:.5;cursor:not-allowed}.tab-panel,.log,.modal-content,.confirm-list,.overflow-menu{scrollbar-width:thin;scrollbar-color:var(--border-strong) var(--surface)}
.panel{position:fixed;z-index:2147483645;display:flex;flex-direction:column;overflow:hidden;color:var(--text-primary);background:var(--surface);border:1px solid var(--border-strong);border-radius:var(--radius-lg);box-shadow:var(--shadow-floating);font:13px/1.5 var(--font-family);min-width:min(320px,calc(100vw - 16px));min-height:min(360px,calc(100vh - 16px));max-width:calc(100vw - 12px);max-height:calc(100vh - 12px)}
.panel.collapsed{height:52px!important;min-height:52px}.panel.collapsed .body,.panel.collapsed .resize{display:none}.head{flex:none;display:flex;align-items:center;gap:8px;height:52px;padding:8px;color:var(--text-primary);background:var(--surface);border-bottom:1px solid var(--border);cursor:grab;touch-action:none;user-select:none}.head:active{cursor:grabbing}.mark{display:grid;place-items:center;width:32px;height:32px;flex:none;border-radius:var(--radius-control);color:var(--on-brand);background:var(--brand);font-size:18px;font-weight:700}.title{min-width:0;flex:1}.title strong,.title small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.title strong{font-size:16px;line-height:1.3}.title small{color:var(--text-secondary);font-size:11px}.head-actions{display:flex}.icon{display:grid;place-items:center;min-width:36px;height:36px;padding:8px;border:0;border-radius:var(--radius-control);color:var(--text-secondary);background:transparent}.icon:hover{background:var(--surface-soft)}
.body{flex:1;min-height:0;display:flex;flex-direction:column}.tabs{display:flex;flex:none;border-bottom:1px solid var(--border);padding:0 8px;background:var(--surface-hover)}.tabs button{position:relative;display:flex;align-items:center;justify-content:center;gap:6px;flex:1;min-height:44px;padding:8px 4px;border:0;color:var(--text-secondary);background:transparent;font-weight:600;font-size:13px}.tabs button[aria-selected=true]{color:var(--brand)}.tabs button[aria-selected=true]:after{content:"";position:absolute;bottom:0;left:8px;right:8px;height:3px;background:var(--brand);border-radius:3px}.count,.badge{display:inline-grid;place-items:center;min-width:20px;height:20px;padding:0 5px;border-radius:10px;font-size:11px;font-weight:700;color:var(--warning);background:var(--warning-soft)}
.tab-panels{flex:1;min-height:0;display:flex}.tab-panel{flex:1;min-width:0;overflow:auto;padding:16px}.tab-panel h3{margin:0 0 8px;font-size:13px;font-weight:600}.page-summary{margin-bottom:16px}.page-summary strong{display:block;font-size:14px;font-weight:600;overflow-wrap:anywhere}.page-summary small{display:block;margin-top:4px;color:var(--text-secondary);font-size:11px;overflow-wrap:anywhere}.progress-row{display:flex;align-items:center;justify-content:space-between;gap:8px}.progress-row h3{margin:0}.status{font-size:11px;font-weight:600;color:var(--text-secondary)}.progress{height:8px;overflow:hidden;margin:8px 0;border-radius:var(--radius-sm);background:var(--surface-soft)}.progress i{display:block;height:100%;width:0;background:var(--brand)}.activity{margin:0;color:var(--text-secondary);font-size:12px;overflow-wrap:anywhere}
.recent{margin-top:16px}.field-list{list-style:none;margin:0;padding:0}.field-row{display:flex;align-items:center;gap:8px;min-height:36px;border-bottom:1px solid var(--border);padding:8px 0}.field-row:last-child{border-bottom:0}.field-row strong{min-width:0;flex:1;font-size:12px;font-weight:500;overflow-wrap:anywhere}.pill{flex:none;padding:2px 6px;border-radius:var(--radius-sm);font-size:11px;font-weight:500;white-space:nowrap}.tone-success{color:var(--success);background:var(--success-soft)}.tone-success-neutral,.tone-neutral{color:var(--text-secondary);background:var(--surface-soft)}.tone-warning,.tone-warning-strong{color:var(--warning);background:var(--warning-soft)}.tone-neutral-info{color:var(--info);background:var(--info-soft)}.tone-danger{color:var(--danger);background:var(--danger-soft)}
.queue{margin-top:12px;border-top:1px solid var(--border)}.queue summary{display:flex;justify-content:space-between;align-items:center;gap:8px;min-height:40px;color:var(--text-secondary);cursor:pointer;font-size:12px;list-style:none}.queue summary::-webkit-details-marker{display:none}.queue summary svg{width:16px;height:16px}.queue[open] summary svg{transform:rotate(180deg)}.sections{padding-bottom:8px}.section{display:grid;grid-template-columns:20px 1fr auto;gap:8px;align-items:center;padding:8px 0;font-size:12px}.section .state{display:flex;color:var(--text-secondary)}.section.done .state{color:var(--success)}.section.running .state,.section.partial .state{color:var(--warning)}.section.error .state{color:var(--danger)}.section small{color:var(--text-secondary);font-size:11px}
.actions{display:flex;flex:none;gap:8px;padding:12px 16px;border-top:1px solid var(--border);background:var(--surface)}.actions button,.secondary,.confirm-actions button{display:flex;align-items:center;justify-content:center;gap:8px;min-height:38px;padding:8px 12px;border:1px solid var(--border-strong);border-radius:var(--radius-control);color:var(--text-primary);background:var(--surface);font-weight:600;font-size:12px}.actions button{flex:1}.actions button:hover,.secondary:hover{background:var(--surface-soft)}.actions .primary,.confirm-actions .primary{color:var(--on-brand);background:var(--brand);border-color:var(--brand)}.actions .primary:hover,.confirm-actions .primary:hover{background:var(--brand-hover)}.actions .danger{color:var(--text-secondary)}.actions .danger:hover{color:var(--danger);border-color:var(--danger);background:var(--danger-soft)}.privacy{display:flex;align-items:center;justify-content:center;gap:6px;flex:none;min-height:32px;margin:0;padding:6px 36px;color:var(--text-secondary);background:var(--surface-hover);font-size:11px}.privacy svg{width:16px;height:16px}
.empty{display:flex;flex-direction:column;align-items:flex-start;gap:8px;margin:0;padding:12px 0;color:var(--text-secondary);font-size:12px}.empty strong{font-weight:500;color:var(--text-primary)}.empty p{margin:0}.review-intro{margin:0 0 16px;color:var(--text-secondary);font-size:12px}.review-group{margin-bottom:20px}.review-group h3{display:flex;align-items:center;gap:8px}.review-card{padding:12px 0;border-bottom:1px solid var(--border)}.review-card:last-child{border-bottom:0}.review-card header{display:flex;align-items:flex-start;gap:8px}.review-card strong{min-width:0;flex:1;font-size:13px;font-weight:600;overflow-wrap:anywhere}.review-card p{margin:6px 0 4px;color:var(--text-secondary);font-size:12px;overflow-wrap:anywhere}.review-card small{color:var(--text-secondary);font-size:11px}.review-tools{margin-top:12px}.review-tools .secondary{width:100%}
.log-panel{display:flex;flex-direction:column;gap:12px}.log-toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.log-toolbar label{display:flex;gap:6px;align-items:center;flex:1;min-height:36px;font-size:12px;color:var(--text-secondary)}.log-hint{margin:0;color:var(--text-secondary);font-size:11px}.log{flex:1;min-height:120px;overflow:auto;margin:0;padding:12px;border:1px solid var(--border);border-radius:var(--radius-control);color:var(--text-primary);background:var(--surface-soft);font:11px/1.7 ui-monospace,SFMono-Regular,Consolas,monospace;white-space:pre-wrap;overflow-wrap:anywhere}.log-status{min-height:16px;color:var(--text-secondary);font-size:11px}
.overflow-menu{position:absolute;right:8px;top:48px;z-index:5;display:flex;flex-direction:column;min-width:188px;max-width:calc(100% - 16px);max-height:calc(100% - 64px);overflow:auto;padding:4px;border:1px solid var(--border-strong);border-radius:var(--radius-card);color:var(--text-primary);background:var(--surface);box-shadow:var(--shadow-card)}.overflow-menu button{display:flex;align-items:center;gap:8px;min-height:36px;padding:8px;border:0;border-radius:var(--radius-sm);color:var(--text-primary);background:transparent;text-align:left;font-size:12px}.overflow-menu button:hover{background:var(--surface-soft)}.overflow-menu hr{width:100%;height:1px;margin:4px 0;border:0;background:var(--border)}
.resize{position:absolute;right:0;bottom:0;width:36px;height:32px;padding:0;border:0;background:transparent;cursor:nwse-resize;touch-action:none}.resize:after{content:"";position:absolute;right:8px;bottom:8px;width:8px;height:8px;border-right:2px solid var(--border-strong);border-bottom:2px solid var(--border-strong)}
.launcher{position:fixed;right:8px;z-index:2147483645;display:grid;place-items:center;width:48px;height:48px;padding:4px;border:0;border-radius:50%;color:var(--on-brand);background:var(--brand);box-shadow:var(--shadow-floating);font:700 18px var(--font-family);cursor:pointer;touch-action:none;user-select:none}.launcher[data-state=RUNNING]{background:conic-gradient(var(--brand) var(--progress,0%),var(--border-strong) 0)}.launcher-core{display:grid;place-items:center;width:38px;height:38px;border:2px solid var(--surface);border-radius:50%;background:var(--brand)}.launcher .badge{position:absolute;right:-5px;top:-5px;min-width:20px;box-shadow:0 0 0 2px var(--surface)}.launcher-state{position:absolute;right:-2px;bottom:-2px;display:grid;place-items:center;width:18px;height:18px;border:2px solid var(--surface);border-radius:50%;font-size:11px;background:var(--success);color:var(--surface)}.launcher[data-state=ERROR] .launcher-state{background:var(--danger)}
.confirm{position:absolute;inset:52px 0 0;z-index:8;display:flex;flex-direction:column;gap:8px;padding:16px;background:var(--surface)}.confirm h3{margin:0;font-size:16px}.confirm p{margin:0;color:var(--text-secondary);font-size:12px}.confirm-list{flex:1;min-height:0;overflow:auto}.file-option{display:flex;align-items:center;gap:8px;margin:8px 0;padding:12px;border:1px solid var(--border);border-radius:var(--radius-control);font-size:12px;overflow-wrap:anywhere}.file-option small{color:var(--text-secondary)}.confirm-actions{display:flex;justify-content:flex-end;gap:8px}
.modal-backdrop{position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;padding:16px;background:var(--overlay);font:13px/1.55 var(--font-family);color:var(--text-primary)}.modal{display:flex;flex-direction:column;width:min(640px,calc(100vw - 32px));max-height:min(760px,calc(100vh - 32px));overflow:hidden;border:1px solid var(--border-strong);border-radius:var(--radius-lg);background:var(--surface);box-shadow:var(--shadow-modal)}.modal>header{display:flex;align-items:center;gap:12px;padding:16px;border-bottom:1px solid var(--border)}.modal h2{flex:1;margin:0;font-size:17px}.modal>header button{width:36px;height:36px;border:0;border-radius:var(--radius-control);color:var(--text-secondary);background:var(--surface-soft)}.modal-content{min-height:90px;padding:16px;overflow:auto}.modal-content h3{margin:16px 0 8px;font-size:14px}.modal-content p{margin:8px 0;color:var(--text-secondary)}.modal-content ul{margin:8px 0;padding-left:24px}.modal-content li{margin:4px 0;overflow-wrap:anywhere}.modal-content .notice{padding:12px;border-radius:var(--radius-control);color:var(--warning);background:var(--warning-soft)}.modal-content .safe{padding:12px;border-radius:var(--radius-control);color:var(--text-secondary);background:var(--surface-soft)}.modal-content .setting{display:grid;grid-template-columns:1fr minmax(160px,auto);gap:12px;align-items:center;padding:12px 0;border-bottom:1px solid var(--border)}.modal-content select{min-height:38px;width:100%;padding:8px;border:1px solid var(--border-strong);border-radius:var(--radius-control);color:var(--text-primary);background:var(--surface)}.modal>footer{display:flex;justify-content:flex-end;gap:8px;padding:12px 16px;border-top:1px solid var(--border)}.modal>footer button{min-width:92px;min-height:38px;padding:8px 12px;border:1px solid var(--border-strong);border-radius:var(--radius-control);color:var(--text-primary);background:var(--surface);font-weight:600;font-size:12px}.modal>footer .modal-primary{color:var(--on-brand);border-color:var(--brand);background:var(--brand)}.report-grid{display:grid;grid-template-columns:minmax(72px,1fr) repeat(4,auto);gap:8px;align-items:center;font-size:12px}.report-grid .head{height:auto;display:block;padding:0;border:0;color:var(--text-secondary);background:none;cursor:default;font-size:11px}.report-grid .bad{color:var(--danger)}.report-grid .good{color:var(--success)}
@media(max-width:520px){.modal-content .setting{grid-template-columns:1fr}.tab-panel{padding:12px}.actions{padding:12px}.report-grid{font-size:11px;gap:4px}}`;
  }
  function markup() {
    return `<aside class="panel" role="dialog" aria-label="解放网页助手">
<header class="head" id="drag" tabindex="0" aria-label="网页助手标题，方向键移动面板"><span class="mark">解</span><span class="title"><strong>解放</strong><small id="head-status">当前页面 · 等待检查</small></span><span class="head-actions"><button class="icon" id="settings" aria-label="填写设置" title="填写设置" type="button">${icon("settings")}</button><button class="icon" id="minimize" aria-label="最小化网页助手" title="最小化" type="button">${icon("minimize")}</button><button class="icon" id="hide" aria-label="隐藏网页助手，不停止任务" title="隐藏，不停止任务" type="button">${icon("close")}</button><button class="icon" id="overflow-toggle" aria-label="更多操作" aria-expanded="false" aria-controls="overflow-menu" type="button">${icon("more")}</button></span></header>
<div class="overflow-menu" id="overflow-menu" hidden><button id="run-current" type="button">${icon("file")}仅填写当前页</button><button id="scan" type="button">${icon("refresh")}重新检查页面</button><button id="rerun" type="button">${icon("play")}重新执行当前页</button><hr><button id="materials" type="button">${icon("folder")}材料库</button><button id="diagnose" type="button">${icon("list")}兼容性诊断</button><hr><button id="collapse" type="button">${icon("chevron-down")}折叠 / 展开助手</button><button id="hide-temp" type="button">${icon("minimize")}暂时隐藏</button></div>
<div class="body"><nav class="tabs" role="tablist" aria-label="网页助手视图"><button id="task-tab" type="button" role="tab" aria-selected="true" aria-controls="task-panel" tabindex="0">${icon("list")}任务</button><button id="review-tab" type="button" role="tab" aria-selected="false" aria-controls="review-panel" tabindex="-1">${icon("alert")}待确认 <span class="count" id="review-count" hidden>0</span></button><button id="log-toggle" type="button" role="tab" aria-selected="false" aria-controls="log-panel" tabindex="-1">${icon("file")}日志</button></nav>
<div class="tab-panels"><section class="tab-panel" id="task-panel" role="tabpanel" aria-labelledby="task-tab" tabindex="0"><div class="page-summary"><strong id="system-name">当前申请网站</strong><small id="page-context">正在检查当前页面…</small></div><section aria-label="任务进度"><div class="progress-row"><h3>任务进度</h3><span class="status" id="task-state" aria-live="polite">就绪</span><span id="progress-text">尚未开始</span></div><div class="progress" id="progress-track" role="progressbar" aria-label="任务进度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i id="progress-bar"></i></div><p class="activity" id="activity" aria-live="polite">检查页面后，即可预览本次填写。</p></section><section class="recent"><h3>最近处理的字段</h3><ul class="field-list" id="recent-fields"><li class="empty">开始后将在这里显示字段处理结果。</li></ul></section><details class="queue"><summary>栏目队列 <span id="section-count">尚未检查</span>${icon("chevron-down")}</summary><div class="sections" id="sections"></div></details></section>
<section class="tab-panel" id="review-panel" role="tabpanel" aria-labelledby="review-tab" tabindex="0" hidden><p class="review-intro">仅列出字段名称与处理建议。请在网页中核对，不展示你的填写内容。</p><div id="review-items"></div><div class="review-tools"><button class="secondary" id="review-materials" type="button">${icon("folder")}管理申请资料与材料</button></div></section>
<section class="tab-panel log-panel" id="log-panel" role="tabpanel" aria-labelledby="log-toggle" tabindex="0" hidden><div class="log-toolbar"><label><input id="log-autoscroll" type="checkbox" checked>自动滚动</label><button class="icon" id="log-copy" type="button" aria-label="复制当前日志" title="复制日志">${icon("copy")}</button><button class="icon" id="log-clear" type="button" aria-label="清空当前显示的日志，不删除任务报告" title="清空当前显示">${icon("trash")}</button></div><p class="log-hint">高级运行记录；清空仅影响当前显示，不删除任务报告。</p><pre class="log" id="log" tabindex="0">暂无运行日志。</pre><span class="log-status" id="log-status" aria-live="polite"></span></section></div>
<div class="actions" id="dynamic-actions" aria-label="当前任务操作"><button class="primary" id="run-all" type="button">${icon("play")}检查并开始填写</button><button class="primary" id="pause" type="button" hidden>${icon("pause")}暂停</button><button class="primary" id="resume" type="button" hidden>${icon("play")}继续</button><button class="primary" id="review-action" type="button" hidden>处理待确认</button><button class="primary" id="view-results" type="button" hidden>查看填写结果</button><button class="danger" id="stop" type="button" hidden>${icon("stop")}停止</button><button id="skip" type="button" hidden>跳过</button><button id="rescan" type="button" hidden>${icon("refresh")}重新检查</button></div><p class="privacy">${icon("shield")}本地处理 · 不自动提交</p></div>
<section class="confirm" id="file-confirm" role="dialog" aria-modal="true" aria-labelledby="file-confirm-title" hidden><h3 id="file-confirm-title">需要确认上传材料</h3><p id="file-requirement"></p><div class="confirm-list" id="file-options"></div><div class="confirm-actions"><button id="file-skip" type="button">暂不上传</button><button class="primary" id="file-confirm-button" type="button">确认选择</button></div></section><button class="resize" id="resize" type="button" aria-label="调整面板大小，方向键缩放"></button></aside>
<button class="launcher" id="launcher" type="button" aria-label="打开解放网页助手" data-state="IDLE" hidden><span class="launcher-core">解</span><span class="badge" id="launcher-badge" hidden></span><span class="launcher-state" id="launcher-state" hidden></span></button>
<div class="modal-backdrop" id="modal-backdrop" hidden><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><header><h2 id="modal-title"></h2><button id="modal-close" type="button" aria-label="关闭">${icon("close")}</button></header><div class="modal-content" id="modal-content"></div><footer><button id="modal-cancel" type="button">取消</button><button class="modal-primary" id="modal-confirm" type="button">确认</button></footer></section></div>`;
  }
  async function create(callbacks = {}) {
    if (singleton?.host?.isConnected) return singleton;
    if (!root.JFUI?.tokensCSS) throw new Error('网页助手界面资源尚未就绪，请重新打开扩展。');
    const host = document.getElementById(HOST_ID) || document.createElement('div');
    host.id = HOST_ID;
    if (!host.isConnected) document.documentElement.appendChild(host);
    const shadow = host.shadowRoot || host.attachShadow({ mode: 'open' });
    shadow.innerHTML = markup();
    const byId = id => shadow.getElementById(id);
    const Sheet = document.defaultView?.CSSStyleSheet || root.CSSStyleSheet;
    if (typeof Sheet !== 'function' || !('adoptedStyleSheets' in shadow)) throw new Error('当前浏览器不支持安全 Shadow DOM 样式');
    const sheet = new Sheet();
    sheet.replaceSync(css());
    shadow.adoptedStyleSheets = [sheet];
    const panel = shadow.querySelector('.panel');
    const launcher = shadow.getElementById('launcher');
    let state = await PanelState.load();
    let logs = [];
    let currentScanId = '';
    let currentSnapshot = {};
    let activeTab = 'task';
    let lastReport = null;
    const TABS = ['task', 'review', 'log'];
    const applyState = () => {
      state = PanelState.clamp(state);
      panel.style.left = `${state.x}px`; panel.style.top = `${state.y}px`; panel.style.width = `${state.width}px`; panel.style.height = `${state.height}px`;
      panel.classList.toggle('collapsed', state.collapsed);
      panel.hidden = !state.visible || state.minimized;
      launcher.hidden = state.visible && !state.minimized;
      launcher.style.top = `${state.launcherY}px`;
    };
    const persist = patch => { state = PanelState.clamp({ ...state, ...patch }); applyState(); return PanelState.save(state); };
    applyState();
    Drag.attach(shadow.getElementById('drag'), panel, { snap: () => state.snap, onEnd: position => persist(position) });
    Resize.attach(shadow.getElementById('resize'), panel, { ...PanelState.LIMITS, onEnd: size => persist(size) });
    root.addEventListener('resize', () => { state = PanelState.clamp(state); applyState(); });
    function closeMenu(restoreFocus = false) {
      byId('overflow-menu').hidden = true;
      byId('overflow-toggle').setAttribute('aria-expanded', 'false');
      if (restoreFocus) byId('overflow-toggle').focus();
    }
    const invoke = name => {
      try { Promise.resolve(callbacks[name]?.()).catch(error => log(String(name) + ' 操作失败：' + (error?.message || error))); }
      catch (error) { log(String(name) + ' 操作失败：' + (error?.message || error)); }
    };
    const bind = (id, name) => byId(id).addEventListener('click', event => {
      event.preventDefault(); event.stopPropagation(); closeMenu(); invoke(name);
    });
    bind('run-all', 'runAll'); bind('run-current', 'runCurrent'); bind('scan', 'scan'); bind('rescan', 'scan'); bind('pause', 'pause'); bind('resume', 'resume'); bind('stop', 'stop'); bind('skip', 'skip'); bind('rerun', 'rerun'); bind('diagnose', 'diagnose'); bind('materials', 'materials'); bind('review-materials', 'materials'); bind('settings', 'settings');
    byId('overflow-toggle').addEventListener('click', () => {
      const open = byId('overflow-menu').hidden;
      byId('overflow-menu').hidden = !open;
      byId('overflow-toggle').setAttribute('aria-expanded', String(open));
      if (open) focusableElements(byId('overflow-menu'))[0]?.focus();
    });
    shadow.addEventListener('click', event => {
      const path = event.composedPath();
      if (!path.includes(byId('overflow-menu')) && !path.includes(byId('overflow-toggle'))) closeMenu();
    });
    document.addEventListener('pointerdown', event => { if (!event.composedPath().includes(host)) closeMenu(); }, true);
    byId('collapse').addEventListener('click', () => { closeMenu(); persist({ collapsed: !state.collapsed, minimized: false, visible: true }); });
    byId('minimize').addEventListener('click', () => { closeMenu(); persist({ minimized: true, visible: true }); launcher.focus(); });
    byId('hide').addEventListener('click', () => { closeMenu(); persist({ visible: false, minimized: false }); launcher.focus(); });
    byId('hide-temp').addEventListener('click', () => { closeMenu(); persist({ minimized: true, visible: true }); launcher.focus(); });
    byId('drag').addEventListener('keydown', event => {
      if (event.target !== byId('drag') || !/^Arrow/.test(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      const step = event.shiftKey ? 40 : 16;
      persist({ x: state.x + (event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0), y: state.y + (event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0) });
    });
    byId('resize').addEventListener('keydown', event => {
      if (!/^Arrow/.test(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      const step = event.shiftKey ? 40 : 16;
      persist({ width: state.width + (event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0), height: state.height + (event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0) });
    });
    let launcherDrag = null;
    let suppressLauncherClick = false;
    const moveLauncher = event => {
      if (!launcherDrag || launcherDrag.pointerId !== event.pointerId) return;
      event.preventDefault(); event.stopPropagation();
      const distance = Math.abs(event.clientY - launcherDrag.startY);
      if (distance > 4) launcherDrag.moved = true;
      const nextY = Math.min(Math.max(16, launcherDrag.originY + event.clientY - launcherDrag.startY), Math.max(16, (root.innerHeight || 768) - 60));
      launcher.style.top = `${nextY}px`;
      launcherDrag.currentY = nextY;
    };
    const finishLauncher = event => {
      if (!launcherDrag || launcherDrag.pointerId !== event.pointerId) return;
      event.preventDefault(); event.stopPropagation();
      launcher.releasePointerCapture?.(event.pointerId);
      root.removeEventListener('pointermove', moveLauncher, true);
      root.removeEventListener('pointerup', finishLauncher, true);
      root.removeEventListener('pointercancel', finishLauncher, true);
      suppressLauncherClick = launcherDrag.moved;
      const nextY = launcherDrag.currentY;
      launcherDrag = null;
      if (suppressLauncherClick) persist({ launcherY: nextY });
    };
    launcher.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      event.preventDefault(); event.stopPropagation();
      launcherDrag = { pointerId: event.pointerId, startY: event.clientY, originY: state.launcherY, currentY: state.launcherY, moved: false };
      launcher.setPointerCapture?.(event.pointerId);
      root.addEventListener('pointermove', moveLauncher, { capture: true, passive: false });
      root.addEventListener('pointerup', finishLauncher, { capture: true, passive: false });
      root.addEventListener('pointercancel', finishLauncher, { capture: true, passive: false });
    }, { passive: false });
    launcher.addEventListener('click', event => {
      event.preventDefault(); event.stopPropagation();
      if (suppressLauncherClick) { suppressLauncherClick = false; return; }
      persist({ minimized: false, visible: true, collapsed: false });
    });
    function selectTab(name, focus = false) {
      activeTab = TABS.includes(name) ? name : 'task';
      for (const tab of TABS) {
        const button = byId(tab === 'log' ? 'log-toggle' : tab + '-tab');
        const selected = tab === activeTab;
        button.setAttribute('aria-selected', String(selected)); button.tabIndex = selected ? 0 : -1;
        byId(tab + '-panel').hidden = !selected;
        if (selected && focus) button.focus();
      }
      if (activeTab === 'log' && byId('log-autoscroll').checked) byId('log').scrollTop = byId('log').scrollHeight;
      updateActions();
      return activeTab;
    }
    TABS.forEach(tab => {
      const button = byId(tab === 'log' ? 'log-toggle' : tab + '-tab');
      button.addEventListener('click', () => selectTab(tab));
      button.addEventListener('keydown', event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault(); event.stopPropagation();
        const index = TABS.indexOf(tab);
        selectTab(event.key === 'Home' ? 'task' : event.key === 'End' ? 'log' : TABS[(index + (event.key === 'ArrowRight' ? 1 : -1) + TABS.length) % TABS.length], true);
      });
    });
    byId('review-action').addEventListener('click', () => {
      if (activeTab === 'review' && root.JFUI.taskState(currentSnapshot) === 'WAITING_USER' && !currentSnapshot.awaitingPreview) invoke('resume');
      else selectTab('review', true);
    });
    byId('view-results').addEventListener('click', () => {
      if (lastReport?.scanId && lastReport.scanId === currentScanId) showReport(lastReport);
      else selectTab('review', true);
    });
    byId('log-copy').addEventListener('click', async () => {
      try { await root.navigator.clipboard.writeText(logs.join('\n')); byId('log-status').textContent = '日志已复制。'; }
      catch (_) { byId('log-status').textContent = '复制未成功，可选中日志后手动复制。'; }
    });
    byId('log-clear').addEventListener('click', () => { logs = []; byId('log').textContent = '暂无运行日志。'; byId('log-status').textContent = '已清空当前显示；任务报告保留。'; });
    function log(message) {
      logs = [...logs.slice(-99), '[' + new Date().toLocaleTimeString() + '] ' + String(message)];
      byId('log').textContent = logs.join('\n');
      if (byId('log-autoscroll').checked) byId('log').scrollTop = byId('log').scrollHeight;
    }
    function updateActions() {
      const uiState = root.JFUI.taskState(currentSnapshot);
      const visible = { IDLE: ['run-all'], RUNNING: ['pause', 'stop'], PAUSED: ['resume', 'stop'], WAITING_USER: ['review-action', 'skip'], FINISHED: ['view-results', 'rescan'], ERROR: ['review-action', 'rescan'] }[uiState] || ['run-all'];
      for (const button of byId('dynamic-actions').querySelectorAll('button')) button.hidden = !visible.includes(button.id);
      byId('review-action').textContent = uiState === 'ERROR' ? '查看问题' : activeTab === 'review' && !currentSnapshot.awaitingPreview ? '已核对，继续' : '处理待确认';
      byId('skip').disabled = Boolean(currentSnapshot.awaitingPreview);
      for (const id of ['run-current', 'scan', 'rerun']) byId(id).disabled = ['RUNNING', 'PAUSED', 'WAITING_USER'].includes(uiState);
    }
    function renderFields(items, review = false) {
      return items.map(item => {
        const status = root.JFUI.status(item.status);
        // Only the explicit metadata projection is consumed; raw values and diagnostic fields are excluded.
        const label = escapeHtml(item.fieldLabel || '待核对字段');
        const pill = '<span class="pill tone-' + status.tone + '">' + escapeHtml(status.label) + '</span>';
        return review ? '<article class="review-card"><header><strong>' + label + '</strong>' + pill + '</header><p>' + escapeHtml(item.reason || status.reason) + '</p><small>' + escapeHtml(item.section || '当前页面') + '</small></article>'
          : '<li class="field-row"><strong>' + label + '</strong>' + pill + '</li>';
      }).join('');
    }
    function update(snapshot = {}) {
      currentSnapshot = snapshot;
      const queue = snapshot.sectionQueue || snapshot.queue || [];
      const currentIndex = Number(snapshot.currentIndex || 0);
      if (snapshot.scanId) currentScanId = String(snapshot.scanId);
      const stateName = String(snapshot.state || 'IDLE').toUpperCase();
      const uiState = root.JFUI.taskState(snapshot);
      const activeStates = new Set(['SCANNING_NAVIGATION', 'BUILDING_QUEUE', 'NAVIGATING', 'WAITING_PAGE', 'SCANNING_FIELDS', 'MATCHING', 'PREPARING_ARRAYS', 'FILLING', 'VERIFYING', 'SCANNING_FILES', 'MATCHING_FILES', 'WAITING_FILE_CONFIRMATION', 'UPLOADING', 'VERIFYING_UPLOAD', 'SAVING', 'NEXT_SECTION', 'RUNNING']);
      const terminalStatuses = new Set(['SUCCESS', 'COMPLETED', 'FILLED', 'PARTIAL', 'NO_CHANGES', 'SKIPPED', 'ERROR', 'FAILED', 'NEEDS_CONFIRMATION', 'REVIEW']);
      const completed = queue.filter(item => terminalStatuses.has(String(item.status || item.state || '').toUpperCase())).length;
      const projection = snapshot.progress || {};
      const total = Math.max(0, Number(projection.total ?? queue.length) || 0);
      const done = Math.min(total, Math.max(0, Number(projection.completed ?? completed) || 0));
      const progress = Math.min(100, Math.max(0, Number(projection.percent ?? (total ? Math.round((done / total) * 100) : 0)) || 0));
      const finalized = snapshot.scanCountsFinal === true;
      byId('head-status').textContent = '当前页面 · ' + (snapshot.currentSectionLabel || '等待检查');
      byId('system-name').textContent = snapshot.systemName || '当前申请网站';
      byId('section-count').textContent = finalized ? '可自动导航栏目：' + queue.length : '正在检查…';
      byId('page-context').textContent = finalized ? (snapshot.currentSectionLabel || '当前页面') + ' · ' + Math.max(0, Number(snapshot.reliableFieldCount || 0)) + ' 项可自动处理 · ' + Math.max(0, Number(snapshot.embeddedSectionCount || 0)) + ' 个页面内区域' : '正在检查当前页面…';
      byId('task-state').textContent = root.JFUI.taskLabel(snapshot);
      byId('task-state').className = 'status' + (uiState === 'ERROR' ? ' tone-danger' : '');
      byId('progress-text').textContent = total ? done + ' / ' + total + (projection.unit === '栏目' ? ' 栏目' : '') : finalized ? '尚未开始' : '检查中…';
      byId('progress-bar').style.width = progress + '%';
      byId('progress-track').setAttribute('aria-valuenow', String(progress));
      byId('progress-track').setAttribute('aria-valuetext', total ? '已处理 ' + done + ' / ' + total + (projection.unit === '栏目' ? ' 个栏目' : ' 项') : '等待任务开始');
      byId('activity').textContent = root.JFUI.actionText(snapshot);
      byId('activity').setAttribute('aria-live', uiState === 'ERROR' ? 'assertive' : 'polite');
      byId('sections').innerHTML = queue.length ? queue.map((item, index) => {
        const explicitStatus = String(item.status || item.state || '').toUpperCase();
        const status = explicitStatus || (activeStates.has(stateName) && index === currentIndex ? 'RUNNING' : 'PENDING');
        const className = /SUCCESS|COMPLETED|FILLED/.test(status) ? 'done' : /PARTIAL|NEEDS_CONFIRMATION|REVIEW/.test(status) ? 'partial' : /NO_CHANGES|SKIPPED/.test(status) ? 'nochange' : /RUNNING/.test(status) ? 'running' : /ERROR|FAILED/.test(status) ? 'error' : '';
        const labels = { done: '已处理', partial: '待核对', nochange: '无变更', running: '处理中', error: '处理失败' };
        return '<div class="section ' + className + '"><span class="state">' + icon(className === 'done' ? 'check' : className === 'error' || className === 'partial' ? 'alert' : 'circle') + '</span><span>' + escapeHtml(item.label || '其他信息') + '</span><small>' + (labels[className] || '待处理') + '</small></div>';
      }).join('') : '<div class="empty">当前页面没有可自动导航的栏目；仍可检查页内字段。</div>';
      const recent = Array.isArray(snapshot.recentFields) ? snapshot.recentFields.slice(-6) : [];
      byId('recent-fields').innerHTML = recent.length ? renderFields(recent) : '<li class="empty">开始后将在这里显示字段处理结果。</li>';
      const reviewItems = (Array.isArray(snapshot.reviewItems) ? snapshot.reviewItems : []).filter(item => ['ERROR', 'FAILED', 'CONFLICT', 'NEEDS_CONFIRMATION', 'MANUAL_REVIEW', 'MISSING_JSON', 'SKIPPED_EMPTY', 'UNMATCHED', 'NOT_FOUND'].includes(String(item.status || '').toUpperCase()));
      const groups = ['ERROR', 'CONFLICT', 'NEEDS_CONFIRMATION', 'MISSING_JSON', 'UNMATCHED'].map(key => ({ key, items: reviewItems.filter(item => root.JFUI.status(item.status).key === key) })).filter(group => group.items.length);
      byId('review-items').innerHTML = groups.length ? groups.map(group => '<section class="review-group"><h3>' + escapeHtml(root.JFUI.status(group.key).label) + ' <span class="count">' + group.items.length + '</span></h3>' + renderFields(group.items, true) + '</section>').join('') : '<div class="empty">' + icon('check') + '<strong>当前没有需要处理的项目</strong><p>填写中需要你确认的内容，会汇总到这里。</p></div>';
      const reviewCount = Math.max(0, Number(snapshot.reviewCount ?? reviewItems.length) || 0);
      byId('review-count').hidden = !reviewCount; byId('review-count').textContent = reviewCount > 99 ? '99+' : String(reviewCount);
      byId('review-tab').setAttribute('aria-label', '待确认，' + reviewCount + ' 个项目');
      launcher.dataset.state = uiState; launcher.style.setProperty('--progress', progress + '%');
      byId('launcher-badge').hidden = !reviewCount; byId('launcher-badge').textContent = reviewCount > 99 ? '99+' : String(reviewCount);
      byId('launcher-state').hidden = !['FINISHED', 'ERROR'].includes(uiState); byId('launcher-state').textContent = uiState === 'ERROR' ? '!' : '✓';
      launcher.setAttribute('aria-label', '解放，' + root.JFUI.taskLabel(snapshot) + (uiState === 'RUNNING' ? '，进度 ' + progress + '%' : '') + (reviewCount ? '，' + reviewCount + ' 个项目待确认' : '') + '，打开网页助手');
      updateActions();
    }
    function show() { return persist({ visible: true, minimized: false, collapsed: false }); }
    function hide() { return persist({ visible: false, minimized: false }); }
    let fileResolver = null;
    let filePreviousFocus = null;
    function finishFile(value) {
      byId('file-confirm').hidden = true;
      const resolver = fileResolver; fileResolver = null;
      filePreviousFocus?.focus?.(); filePreviousFocus = null;
      resolver?.(value);
    }
    function confirmFile(request = {}) {
      if (fileResolver) finishFile(null);
      persist({ visible: true, minimized: false, collapsed: false });
      return new Promise(resolve => {
        filePreviousFocus = shadow.activeElement || document.activeElement;
        fileResolver = resolve;
        byId('file-requirement').textContent = '页面要求：' + (request.label || '上传材料');
        const options = request.candidates || [];
        byId('file-options').innerHTML = options.map((candidate, index) => '<label class="file-option"><input type="radio" name="jf-file" value="' + escapeHtml(candidate.material?.id || candidate.id || '') + '" ' + (index === 0 ? 'checked' : '') + '><span>' + escapeHtml(candidate.material?.name || candidate.name || '未命名材料') + '</span></label>').join('') || '<p>材料库中没有可选文件。</p>';
        byId('file-confirm').hidden = false;
        byId('file-confirm-button').disabled = !options.length;
        byId('file-skip').onclick = () => finishFile(null);
        byId('file-confirm-button').onclick = () => finishFile(shadow.querySelector('input[name="jf-file"]:checked')?.value || null);
        focusableElements(byId('file-confirm'))[0]?.focus();
      });
    }
    let modalResolver = null;
    let modalPreviousFocus = null;
    const modal = byId('modal-backdrop');
    const closeModal = value => {
      modal.hidden = true;
      byId('modal-content').replaceChildren();
      panel.inert = false; launcher.inert = false;
      const resolver = modalResolver; modalResolver = null;
      modalPreviousFocus?.focus?.(); modalPreviousFocus = null;
      resolver?.(value);
    };
    function focusableElements(scope) {
      return [...scope.querySelectorAll('button,input,select,textarea,a[href],[tabindex]')].filter(element => !element.disabled && element.tabIndex >= 0 && !element.closest('[hidden]') && element.getClientRects().length);
    }
    shadow.addEventListener('keydown', event => {
      const scope = !modal.hidden ? modal : !byId('file-confirm').hidden ? byId('file-confirm') : null;
      if (event.key === 'Escape') {
        if (scope) { event.preventDefault(); event.stopPropagation(); if (scope === modal) closeModal(null); else finishFile(null); }
        else if (!byId('overflow-menu').hidden) { event.preventDefault(); event.stopPropagation(); closeMenu(true); }
      }
      if (event.key !== 'Tab' || !scope) return;
      const controls = focusableElements(scope);
      const first = controls[0]; const last = controls[controls.length - 1];
      if (!first) { event.preventDefault(); return; }
      const active = shadow.activeElement;
      if (event.shiftKey && (active === first || !scope.contains(active))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (active === last || !scope.contains(active))) { event.preventDefault(); first.focus(); }
    }, true);
    function openModal(options = {}) {
      if (modalResolver) closeModal(null);
      closeMenu();
      modalPreviousFocus = shadow.activeElement || document.activeElement;
      byId('modal-title').textContent = options.title || '需要确认';
      byId('modal-content').innerHTML = options.bodyHtml || '';
      const cancel = byId('modal-cancel'); const confirm = byId('modal-confirm');
      cancel.textContent = options.cancelLabel || '取消'; confirm.textContent = options.confirmLabel || '确认'; confirm.hidden = options.confirmLabel === null;
      modal.hidden = false; panel.inert = true; launcher.inert = true;
      return new Promise(resolve => {
        modalResolver = resolve;
        const cancelAction = () => closeModal(null);
        byId('modal-close').onclick = cancelAction; cancel.onclick = cancelAction;
        confirm.onclick = () => {
          try { closeModal(options.readValue ? options.readValue(shadow) : true); }
          catch (error) { log('无法读取确认选项：' + error.message); }
        };
        byId('modal-close').focus();
      });
    }
    function confirmRun(prepared = {}) {
      const preview = prepared.preview || prepared;
      const sections = Array.isArray(preview.sections) ? preview.sections : [];
      const materials = Array.isArray(preview.materials) ? preview.materials : [];
      const sectionHtml = sections.map((item, index) => `<li><strong>${index + 1}. ${escapeHtml(item.label || item.sectionId || '其他栏目')}</strong>${Number(item.itemCount || 0) ? ` · 资料 ${Number(item.itemCount)} 条` : ''}${item.passiveOnly ? ' · 仅人工检查' : ''}</li>`).join('');
      const materialHtml = materials.map(item => `<li>${escapeHtml(item.name || '未命名材料')} · ${escapeHtml(item.category || '未分类')} · ${Math.round(Number(item.size || 0) / 1024)} KB</li>`).join('');
      return openModal({
        title: '填写前预览',
        confirmLabel: '确认开始填写',
        bodyHtml: `<p class="safe">本次授权仅用于下面列出的栏目和材料；关闭、刷新或任务结束后失效。</p><h3>计划处理 ${sections.length} 个栏目</h3><ul>${sectionHtml || '<li>未识别到可处理栏目</li>'}</ul><h3>本次可能使用的本地材料（${materials.length}）</h3><ul>${materialHtml || '<li>无</li>'}</ul><p>安全暂存：${preview.safeSaveEnabled ? '开启（只识别明确的“保存/暂存”）' : '关闭'}</p><p class="notice">最终提交、确认报名、提交申请等操作永久禁止，任务完成后必须由你人工核对并提交。</p>`,
      });
    }
    function editSettings(current = {}) {
      const allowOverwrite = Boolean(current.allowOverwrite);
      const autoSave = Boolean(current.autoSave);
      const snap = current.snap !== false;
      return openModal({
        title: '填写与导航设置',
        confirmLabel: '保存设置',
        bodyHtml: `<label class="setting"><span>填写策略</span><select id="setting-overwrite"><option value="blank" ${allowOverwrite ? '' : 'selected'}>仅填写空白字段（推荐）</option><option value="overwrite" ${allowOverwrite ? 'selected' : ''}>允许覆盖已有字段</option></select></label><label class="setting"><span>文件策略</span><select id="setting-files"><option value="auto-high-confidence" ${current.filePolicy !== 'ask-every-time' ? 'selected' : ''}>高可靠匹配自动上传</option><option value="ask-every-time" ${current.filePolicy === 'ask-every-time' ? 'selected' : ''}>每个文件上传前询问</option></select></label><label class="setting"><span>导航策略</span><select id="setting-navigation"><option value="automatic" ${current.navigationPolicy !== 'confirm-each' ? 'selected' : ''}>自动切换栏目</option><option value="confirm-each" ${current.navigationPolicy === 'confirm-each' ? 'selected' : ''}>每个栏目切换前确认</option></select></label><label class="setting"><span>自动暂存</span><input id="setting-save" type="checkbox" ${autoSave ? 'checked' : ''}></label><label class="setting"><span>靠近边缘自动吸附</span><input id="setting-snap" type="checkbox" ${snap ? 'checked' : ''}></label><p class="notice">“禁止自动最终提交”是不可关闭的全局规则。</p>`,
        readValue: view => ({
          allowOverwrite: view.getElementById('setting-overwrite').value === 'overwrite',
          skipEmpty: true,
          filePolicy: view.getElementById('setting-files').value,
          navigationPolicy: view.getElementById('setting-navigation').value,
          autoSave: view.getElementById('setting-save').checked,
          snap: view.getElementById('setting-snap').checked,
        }),
      });
    }
    function confirmStop() {
      return openModal({
        title: '停止当前任务？',
        confirmLabel: '确认停止任务',
        bodyHtml: '<p class="notice">停止后不会撤销已经填写的页面内容，也不会执行保存或最终提交。若要再次运行，需要重新预览确认。</p>',
      });
    }
    function showReport(report = {}) {
      if (!report.scanId || (currentScanId && report.scanId !== currentScanId)) {
        log('已阻止显示不属于当前扫描的旧填写报告。');
        return Promise.resolve(false);
      }
      lastReport = report;
      const sections = Array.isArray(report.sections) ? report.sections : [];
      const rows = sections.map(section => {
        const summary = section.summary || {};
        return `<span>${escapeHtml(section.sectionLabel || section.sectionId || '栏目')}</span><span class="good">${Number(summary.success || 0)}</span><span>${Number(summary.manualReview || 0) + Number(summary.conflicts || 0)}</span><span>${Number(summary.unmatched || summary.notFound || 0)}</span><span class="bad">${Number(summary.failed || 0)}</span>`;
      }).join('');
      const success = Number(report.success || 0);
      const failed = Number(report.failed || 0);
      const issues = Number(report.needsConfirmation || 0) + Number(report.unmatched || 0) + failed + Number(report.missingJson || 0);
      const title = success === 0
        ? (failed ? '填写未成功' : '流程执行结束，但没有填写任何字段')
        : issues ? '部分填写完成' : '填写完成';
      return openModal({
        title,
        confirmLabel: null,
        cancelLabel: '关闭',
        bodyHtml: `<p class="safe">任务已停止在最终提交之前，请逐页人工核对。</p><div class="report-grid"><span class="head">栏目</span><span class="head">成功</span><span class="head">人工确认</span><span class="head">未识别</span><span class="head">失败</span>${rows || '<span>暂无字段结果</span><span>0</span><span>0</span><span>0</span><span>0</span>'}</div><h3>总计</h3><p>字段 ${Number(report.total || 0)} · 成功 ${success} · 资料缺失 ${Number(report.missingJson || 0)} · 已有内容跳过 ${Number(report.skippedExisting || 0)} · 需要确认 ${Number(report.needsConfirmation || 0)} · 未识别 ${Number(report.unmatched || 0)} · 填写失败 ${failed}</p>`,
      });
    }
    update({});
    singleton = { callbacks, confirmFile, confirmRun, confirmStop, editSettings, hide, host, log, openModal, panel, persist, selectTab, shadow, show, showReport, update, getState: () => ({ ...state }) };
    return singleton;
  }
  return { HOST_ID, create, getInstance: () => singleton };
});
