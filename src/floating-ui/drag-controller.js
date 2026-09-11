/* 解放：Pointer Events 悬浮面板拖动控制。SPDX-License-Identifier: MIT */
(function initDragController(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.JFDragController = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function dragControllerFactory(root) {
  'use strict';
  function attach(handle, panel, options = {}) {
    let active = null;
    let frame = 0;
    const apply = () => {
      frame = 0;
      if (!active) return;
      panel.style.left = `${active.x}px`;
      panel.style.top = `${active.y}px`;
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
    };
    const onMove = event => {
      if (!active || event.pointerId !== active.pointerId) return;
      event.preventDefault();
      event.stopPropagation();
      const rect = panel.getBoundingClientRect();
      const maxX = Math.max(8, (root.innerWidth || 1366) - rect.width - 8);
      const maxY = Math.max(8, (root.innerHeight || 768) - rect.height - 8);
      active.x = Math.min(Math.max(8, active.startX + event.clientX - active.pointerX), maxX);
      active.y = Math.min(Math.max(8, active.startY + event.clientY - active.pointerY), maxY);
      if (!frame) frame = root.requestAnimationFrame(apply);
    };
    const finish = event => {
      if (!active || event.pointerId !== active.pointerId) return;
      event.preventDefault();
      event.stopPropagation();
      handle.releasePointerCapture?.(event.pointerId);
      root.removeEventListener('pointermove', onMove, true);
      root.removeEventListener('pointerup', finish, true);
      root.removeEventListener('pointercancel', finish, true);
      if (frame) { root.cancelAnimationFrame(frame); frame = 0; apply(); }
      const rect = panel.getBoundingClientRect();
      let x = active.x;
      const snapEnabled = typeof options.snap === 'function' ? options.snap() : options.snap;
      if (snapEnabled !== false) {
        if (x < 16) x = 8;
        else if ((root.innerWidth || 1366) - (x + rect.width) < 16) x = (root.innerWidth || 1366) - rect.width - 8;
      }
      panel.style.left = `${x}px`;
      active = null;
      options.onEnd?.({ x, y: Number.parseFloat(panel.style.top) || rect.top });
    };
    const onDown = event => {
      if (event.button !== 0 || event.target.closest?.('button,input,a,select,textarea')) return;
      event.preventDefault();
      event.stopPropagation();
      const rect = panel.getBoundingClientRect();
      active = { pointerId: event.pointerId, pointerX: event.clientX, pointerY: event.clientY, startX: rect.left, startY: rect.top, x: rect.left, y: rect.top };
      handle.setPointerCapture?.(event.pointerId);
      root.addEventListener('pointermove', onMove, { capture: true, passive: false });
      root.addEventListener('pointerup', finish, { capture: true, passive: false });
      root.addEventListener('pointercancel', finish, { capture: true, passive: false });
      options.onStart?.();
    };
    handle.addEventListener('pointerdown', onDown, { passive: false });
    return () => {
      handle.removeEventListener('pointerdown', onDown);
      root.removeEventListener('pointermove', onMove, true);
      root.removeEventListener('pointerup', finish, true);
      root.removeEventListener('pointercancel', finish, true);
    };
  }
  return { attach };
});
