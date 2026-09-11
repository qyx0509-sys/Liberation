/* 解放：悬浮面板位置与尺寸状态。SPDX-License-Identifier: MIT */
(function initPanelState(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.JFPanelState = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function panelStateFactory(root) {
  'use strict';
  const STORAGE_KEY = 'floatingPanel';
  const DEFAULTS = Object.freeze({ x: null, y: 96, width: 380, height: 544, collapsed: false, minimized: false, visible: true, snap: true, launcherY: 220 });
  const LIMITS = Object.freeze({ minWidth: 320, minHeight: 360, maxWidth: 720, maxHeight: 900, margin: 8 });
  function number(value, fallback) {
    if (value === null || value === undefined || value === '') return fallback;
    return Number.isFinite(Number(value)) ? Number(value) : fallback;
  }
  function clamp(raw = {}, viewport = {}) {
    const vw = Math.max(160, number(viewport.width, root?.innerWidth || 1366));
    const vh = Math.max(160, number(viewport.height, root?.innerHeight || 768));
    const width = Math.min(Math.max(number(raw.width, DEFAULTS.width), LIMITS.minWidth), Math.min(LIMITS.maxWidth, vw - LIMITS.margin * 2));
    const height = Math.min(Math.max(number(raw.height, DEFAULTS.height), LIMITS.minHeight), Math.min(LIMITS.maxHeight, vh - LIMITS.margin * 2));
    const fallbackX = vw - width - 22;
    const x = Math.min(Math.max(number(raw.x, fallbackX), LIMITS.margin), Math.max(LIMITS.margin, vw - width - LIMITS.margin));
    const y = Math.min(Math.max(number(raw.y, DEFAULTS.y), LIMITS.margin), Math.max(LIMITS.margin, vh - (raw.collapsed ? 52 : height) - LIMITS.margin));
    return {
      ...DEFAULTS, ...raw, x, y, width, height,
      collapsed: Boolean(raw.collapsed), minimized: Boolean(raw.minimized),
      visible: raw.visible !== false, snap: raw.snap !== false,
      launcherY: Math.min(Math.max(number(raw.launcherY, DEFAULTS.launcherY), 16), Math.max(16, vh - 60)),
    };
  }
  function load() {
    return new Promise(resolve => {
      if (!root?.chrome?.storage?.local) { resolve(clamp(DEFAULTS)); return; }
      root.chrome.storage.local.get(STORAGE_KEY, value => resolve(clamp(value?.[STORAGE_KEY] || DEFAULTS)));
    });
  }
  function save(value) {
    const normalized = clamp(value);
    return new Promise(resolve => {
      if (!root?.chrome?.storage?.local) { resolve(normalized); return; }
      root.chrome.storage.local.set({ [STORAGE_KEY]: normalized }, () => resolve(normalized));
    });
  }
  return { DEFAULTS, LIMITS, STORAGE_KEY, clamp, load, save };
});
