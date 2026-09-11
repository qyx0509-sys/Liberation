/* 解放：悬浮面板 Pointer Events 尺寸控制。SPDX-License-Identifier: MIT */
(function initResizeController(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.JFResizeController = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function resizeControllerFactory(root) {
  'use strict';
  function attach(handle, panel, options = {}) {
    const minWidth = options.minWidth || 300;
    const minHeight = options.minHeight || 300;
    let active = null;
    const move = event => {
      if (!active || event.pointerId !== active.pointerId) return;
      event.preventDefault();
      event.stopPropagation();
      const maxWidth = Math.min(options.maxWidth || 720, (root.innerWidth || 1366) - active.left - 8);
      const maxHeight = Math.min(options.maxHeight || 900, (root.innerHeight || 768) - active.top - 8);
      const width = Math.min(Math.max(minWidth, active.width + event.clientX - active.x), maxWidth);
      const height = Math.min(Math.max(minHeight, active.height + event.clientY - active.y), maxHeight);
      panel.style.width = `${width}px`;
      panel.style.height = `${height}px`;
      active.current = { width, height };
    };
    const finish = event => {
      if (!active || event.pointerId !== active.pointerId) return;
      event.preventDefault();
      event.stopPropagation();
      handle.releasePointerCapture?.(event.pointerId);
      root.removeEventListener('pointermove', move, true);
      root.removeEventListener('pointerup', finish, true);
      root.removeEventListener('pointercancel', finish, true);
      const current = active.current || { width: active.width, height: active.height };
      active = null;
      options.onEnd?.(current);
    };
    const down = event => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      const rect = panel.getBoundingClientRect();
      active = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, width: rect.width, height: rect.height, left: rect.left, top: rect.top, current: null };
      handle.setPointerCapture?.(event.pointerId);
      root.addEventListener('pointermove', move, { capture: true, passive: false });
      root.addEventListener('pointerup', finish, { capture: true, passive: false });
      root.addEventListener('pointercancel', finish, { capture: true, passive: false });
    };
    handle.addEventListener('pointerdown', down, { passive: false });
    return () => handle.removeEventListener('pointerdown', down);
  }
  return { attach };
});
