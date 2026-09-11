/* 解放：复合选择器安全边界 Adapter。 SPDX-License-Identifier: MIT */
(function initCompoundPickerAdapter(root, factory) {
  let events = root?.JFEventDispatcher;
  let verification = root?.JFVerificationEngine;
  if (typeof module === 'object' && module.exports) {
    events = require('../../core/event-dispatcher.js');
    verification = require('../../core/verification-engine.js');
  }
  const api = factory(events, verification);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.JFCompoundPickerAdapter = api;
  root?.JFControlAdapterRegistry?.register?.(api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function compoundPickerAdapterFactory(E, V) {
  'use strict';

  function text(value) { return value === null || value === undefined ? '' : String(value).trim().toLowerCase(); }

  const adapter = {
    id: 'compound-picker',
    priority: 700,
    capabilities: Object.freeze(['open', 'needs-site-capability']),
    supports(context) {
      return text(context?.descriptor?.controlKind || context?.descriptor?.type) === 'compound-picker';
    },
    read(context) {
      return E?.readControlValue ? E.readControlValue(context.descriptor) : context?.descriptor?.element?.value;
    },
    async write() {
      return {
        handled: true,
        ok: false,
        status: 'NEEDS_CONFIRMATION',
        reason: '复合选择器需要网站适配器提供可靠能力或由用户人工选择',
        strategy: 'compound-picker-site-capability',
      };
    },
    verify(context) {
      void V;
      return {
        ok: false,
        status: 'NEEDS_CONFIRMATION',
        actualValue: adapter.read(context),
        reason: '复合选择器尚未执行，需人工确认',
      };
    },
  };

  return Object.freeze(adapter);
});
