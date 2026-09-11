/* JobFill local UI primitives. Tokens are the source of truth for CSS and Shadow DOM. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.JFUI = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const light = Object.freeze({
    bg: '#F6F8FB', surface: '#FFFFFF', 'surface-soft': '#F1F5F9', 'surface-hover': '#F8FAFC',
    'text-primary': '#172033', 'text-secondary': '#526176', 'text-muted': '#64748B',
    border: '#E2E8F0', 'border-strong': '#7A8CA3', brand: '#155E75', 'brand-hover': '#164E63', 'brand-soft': '#ECF7F9',
    success: '#15803D', 'success-soft': '#ECFDF3', warning: '#9A4709', 'warning-soft': '#FFF7ED',
    danger: '#B42318', 'danger-soft': '#FEF3F2', info: '#1D4ED8', 'info-soft': '#EFF6FF',
    'on-brand': '#FFFFFF', 'focus-ring': '#2563EB', overlay: 'rgba(15,23,42,.46)',
    'shadow-card': '0 1px 3px rgba(15,23,42,.04)', 'shadow-floating': '0 12px 36px rgba(15,23,42,.18)', 'shadow-modal': '0 24px 64px rgba(15,23,42,.24)',
  });
  const dark = Object.freeze({
    bg: '#101722', surface: '#192332', 'surface-soft': '#222F41', 'surface-hover': '#28374B',
    'text-primary': '#F1F5F9', 'text-secondary': '#BAC7D7', 'text-muted': '#A6B7CC',
    border: '#35465D', 'border-strong': '#667F9D', brand: '#8AD5E6', 'brand-hover': '#B3E9F2', 'brand-soft': '#193B49',
    success: '#86D8A2', 'success-soft': '#183A2A', warning: '#F3BD76', 'warning-soft': '#42301C',
    danger: '#FFABA1', 'danger-soft': '#492827', info: '#ACC8FF', 'info-soft': '#233957',
    'on-brand': '#102531', 'focus-ring': '#90C5FF', overlay: 'rgba(0,0,0,.68)',
    'shadow-card': '0 1px 3px rgba(0,0,0,.16)', 'shadow-floating': '0 12px 36px rgba(0,0,0,.42)', 'shadow-modal': '0 24px 64px rgba(0,0,0,.55)',
  });
  const common = Object.freeze({
    'font-family': 'system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif',
    'radius-sm': '6px', 'radius-control': '8px', 'radius-card': '12px', 'radius-lg': '16px',
    'space-1': '4px', 'space-2': '8px', 'space-3': '12px', 'space-4': '16px', 'space-5': '20px', 'space-6': '24px', 'space-8': '32px',
  });
  const declarations = entries => Object.entries(entries).map(([name, value]) => `--${name}:${value};`).join('');
  const tokensCSS = `:root,:host{${declarations(common)}${declarations(light)}color-scheme:light dark;}
@media(prefers-color-scheme:dark){:root,:host{${declarations(dark)}}}
[hidden]{display:none!important}
:where(button,input,select,textarea,a,summary,[role=tab],[tabindex]):focus-visible{outline:2px solid var(--focus-ring);outline-offset:3px}
.jf-icon{width:20px;height:20px;flex:none;vertical-align:middle;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
@media(prefers-reduced-motion:reduce){*,*::before,*::after{scroll-behavior:auto!important;transition:none!important;animation:none!important}}`;
  const paths = {
    more: '<circle cx="10" cy="4" r="1"/><circle cx="10" cy="10" r="1"/><circle cx="10" cy="16" r="1"/>',
    globe: '<circle cx="10" cy="10" r="7.5"/><ellipse cx="10" cy="10" rx="3.5" ry="7.5"/><path d="M2.5 10h15"/>',
    'chevron-right': '<path d="m7 4 6 6-6 6"/>', 'chevron-down': '<path d="m4 7 6 6 6-6"/>',
    'chevron-up': '<path d="m4 13 6-6 6 6"/>',
    play: '<path d="m7 3 9 7-9 7Z"/>', pause: '<path d="M6 3v14M14 3v14"/>', stop: '<rect x="4" y="4" width="12" height="12" rx="1"/>',
    refresh: '<path d="M16.5 7A7 7 0 1 0 17 12M17 2v5h-5"/>',
    panel: '<rect x="2.5" y="3" width="15" height="14" rx="2"/><path d="M12 3v14"/>',
    check: '<path d="m4 10 4 4 8-8"/>', close: '<path d="m5 5 10 10M15 5 5 15"/>',
    minimize: '<path d="M4 13h12"/>',
    alert: '<circle cx="10" cy="10" r="7.5"/><path d="M10 5v5M10 14h.01"/>',
    circle: '<circle cx="10" cy="10" r="7.5"/>',
    settings: '<path d="m8 2-.6 2-1.6 1-2-.4-1.6 2.8 1.4 1.5v2.2l-1.4 1.5 1.6 2.8 2-.4 1.6 1L8 18h4l.6-2 1.6-1 2 .4 1.6-2.8-1.4-1.5V8.9l1.4-1.5-1.6-2.8-2 .4-1.6-1L12 2Z"/><circle cx="10" cy="10" r="2.5"/>',
    folder: '<path d="M2 5a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2Z"/>',
    copy: '<rect x="7" y="7" width="10" height="11" rx="2"/><path d="M4 13H3a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v1"/>',
    download: '<path d="M10 2v10m-4-4 4 4 4-4M3 13v4h14v-4"/>',
    upload: '<path d="M10 13V2M6 6l4-4 4 4M3 13v4h14v-4"/>',
    shield: '<path d="m10 2 7 3v5c0 4-5 7-7 8-2-1-7-4-7-8V5Z"/><path d="m6.5 9.5 2.5 2.5 4.5-5"/>',
    info: '<circle cx="10" cy="10" r="7.5"/><path d="M10 9v6M10 5h.01"/>',
    file: '<path d="M11 2H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/><path d="M11 2v6h6M6 12h8M6 15h5"/>',
    trash: '<path d="M3 5h14M7 5V2h6v3M5 5l1 13h8l1-13M8 8v7M12 8v7"/>',
    list: '<path d="M7 4h10M7 10h10M7 16h10M3 4h.01M3 10h.01M3 16h.01"/>',
    user: '<circle cx="10" cy="6" r="3.5"/><path d="M3 18v-2a7 5 0 0 1 14 0v2Z"/>',
    users: '<circle cx="7" cy="6" r="3"/><path d="M1.5 17v-2a5.5 4 0 0 1 11 0v2M13 3a3 3 0 0 1 0 6M15 12a4 4 0 0 1 3.5 4v1"/>',
    briefcase: '<rect x="2" y="5" width="16" height="13" rx="2"/><path d="M7 5V2h6v3M2 10c5 3 11 3 16 0M10 10v3"/>',
    education: '<path d="m1 7 9-5 9 5-9 5Zm3 2v6c4 3 8 3 12 0V9M19 7v8"/>',
    award: '<circle cx="10" cy="7" r="5"/><path d="m6 11-2 7 6-3 6 3-2-7"/>',
    language: '<path d="M2 4h10M7 2v2M4 4c1 5 4 7 7 8M10 4c-1 5-4 7-8 9M11 18l4-11 4 11M12.5 14h5"/>',
    research: '<path d="M7 2h6M8 2v6L3 16a1 1 0 0 0 1 2h12a1 1 0 0 0 1-2l-5-8V2M6 12h8"/>',
    plus: '<path d="M10 3v14M3 10h14"/>', save: '<path d="M3 2h12l3 3v13H2V2Zm3 0v5h8V2M6 18v-7h8v7"/>',
    target: '<circle cx="10" cy="10" r="7.5"/><circle cx="10" cy="10" r="4"/><circle cx="10" cy="10" r=".8"/>',
    paperclip: '<path d="m7 11 6-6a2 2 0 0 1 3 3l-8 8a4 4 0 0 1-6-6l8-8"/>',
    message: '<path d="M4 3h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H8l-5 3v-3a2 2 0 0 1-1-2V5a2 2 0 0 1 2-2Z"/><path d="M6 7h8M6 11h5"/>',
    sparkles: '<path d="m10 3 2 5 5 2-5 2-2 5-2-5-5-2 5-2ZM16 1v4M14 3h4"/>',
    menu: '<path d="M3 4h14M3 10h14M3 16h14"/>', search: '<circle cx="8.5" cy="8.5" r="6"/><path d="m13 13 5 5"/>',
    'arrow-up': '<path d="M10 17V3M4 9l6-6 6 6"/>', 'arrow-down': '<path d="M10 3v14M4 11l6 6 6-6"/>',
  };
  const aliases = { 'alert-circle': 'alert', 'alert-triangle': 'alert', 'check-circle': 'check', 'file-text': 'file', 'graduation-cap': 'education', book: 'education', 'book-open': 'education', trophy: 'award', 'flask-conical': 'research', 'refresh-cw': 'refresh', x: 'close', 'more-horizontal': 'more', 'folder-open': 'folder', 'external-link': 'panel' };
  function icon(name) { return `<svg class="jf-icon" viewBox="0 0 20 20" aria-hidden="true" focusable="false">${paths[aliases[name] || ({ graduation: 'education', flask: 'research' })[name] || name] || paths.circle}</svg>`; }
  function hydrateIcons(container) {
    container?.querySelectorAll?.('[data-icon]').forEach(element => { element.innerHTML = icon(element.dataset.icon); element.setAttribute('aria-hidden', 'true'); });
  }
  const states = Object.freeze({
    SUCCESS: ['已填写', 'success', '已完成填写并核对'],
    SKIPPED_EXISTING: ['已存在', 'success-neutral', '页面已有内容，已保留'],
    MISSING_JSON: ['资料缺失', 'neutral', '我的申请资料中没有该信息，请补充资料'],
    NEEDS_CONFIRMATION: ['待确认', 'warning', '请核对当前字段后继续'],
    CONFLICT: ['内容冲突', 'warning-strong', '页面已有不同内容，已保留页面内容'],
    UNMATCHED: ['暂未适配', 'neutral-info', '当前字段暂未可靠识别，请手动填写'],
    ERROR: ['处理失败', 'danger', '未能完成处理，请检查页面后重试'],
    PLANNED: ['待处理', 'neutral', '尚未处理此字段'],
    SKIPPED: ['已跳过', 'neutral', '本次未处理该字段'],
  });
  const statusAliases = { FAILED: 'ERROR', MANUAL_REVIEW: 'NEEDS_CONFIRMATION', NOT_FOUND: 'UNMATCHED', SKIPPED_EMPTY: 'MISSING_JSON', MATCHED: 'PLANNED', COMPLETED: 'SUCCESS', FILLED: 'SUCCESS', PARTIAL: 'NEEDS_CONFIRMATION', NO_CHANGES: 'SKIPPED' };
  function status(value) {
    const raw = String(value || '').toUpperCase();
    const key = statusAliases[raw] || (states[raw] ? raw : 'UNMATCHED');
    const [label, tone, reason] = states[key];
    return { key, label, tone, reason };
  }
  function reasonText(value, code) {
    const state = status(value);
    if (state.key === 'NEEDS_CONFIRMATION' && /DATE|MONTH|YEAR|CALENDAR/.test(String(code || ''))) return '日期控件需要你确认，请核对后继续';
    if (state.key === 'NEEDS_CONFIRMATION' && /FILE|UPLOAD|MATERIAL/.test(String(code || ''))) return '请确认本次使用的材料';
    return state.reason;
  }
  function taskState(snapshot = {}) {
    const raw = String(snapshot.state || '').toUpperCase();
    if (/ERROR|FAILED/.test(raw)) return 'ERROR';
    if (snapshot.awaitingPreview) return 'WAITING_USER';
    if (/PAUSED/.test(raw)) return 'PAUSED';
    if (/WAITING_USER|NEEDS_USER_REVIEW|WAITING_FILE|WAITING_SECTION|NEEDS_CONFIRMATION/.test(raw) || snapshot.progressionBlocked) return 'WAITING_USER';
    if (/FINISHED|COMPLETED|FILLED|PARTIAL|NO_CHANGES/.test(raw)) return 'FINISHED';
    if (/STOPPED|CANCELLED/.test(raw)) return 'IDLE';
    if (/RUNNING|FILLING|NAVIGATING|VERIFYING|WAITING_PAGE|SAVING|UPLOADING|MATCHING|PREPARING|NEXT_SECTION|BUILDING_QUEUE/.test(raw) || snapshot.running) return 'RUNNING';
    return 'IDLE';
  }
  function taskLabel(snapshot = {}) { return ({ IDLE: '就绪', RUNNING: '填写中', PAUSED: '已暂停', WAITING_USER: '待确认', FINISHED: '已完成', ERROR: '失败' })[taskState(snapshot)]; }
  function actionText(snapshot = {}) {
    if (snapshot.scanPhase === 'SCANNING') return '正在检查当前页面…';
    if (snapshot.scanPhase === 'STABILIZING') return '正在等待表单稳定…';
    return ({ IDLE: '检查页面后可开始填写', RUNNING: '正在处理当前栏目', PAUSED: '任务已暂停，继续前请核对页面', WAITING_USER: '请处理待确认项目后继续', FINISHED: '本次处理已结束，请核对填写结果', ERROR: '处理遇到问题，请检查页面后重试' })[taskState(snapshot)];
  }
  return Object.freeze({ light, dark, common, tokensCSS, icon, hydrateIcons, status, reasonText, taskState, taskLabel, actionText });
});
