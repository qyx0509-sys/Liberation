/* 解放：普通输入控件 Adapter。 SPDX-License-Identifier: MIT */
(function initNativeValueAdapter(root, factory) {
  let events = root?.JFEventDispatcher;
  let verification = root?.JFVerificationEngine;
  if (typeof module === 'object' && module.exports) {
    events = require('../../core/event-dispatcher.js');
    verification = require('../../core/verification-engine.js');
  }
  const api = factory(events, verification);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.JFNativeValueAdapter = api;
  root?.JFControlAdapterRegistry?.register?.(api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function nativeValueAdapterFactory(E, V) {
  'use strict';

  function text(value) { return value === null || value === undefined ? '' : String(value).trim().toLowerCase(); }
  function kind(context) {
    return text(context?.descriptor?.controlKind || context?.descriptor?.type || context?.descriptor?.baseControlKind || 'text');
  }
  function events(context) { return context?.dependencies?.EventDispatcher || E; }
  function verifier(context) { return context?.dependencies?.VerificationEngine || V; }

  const SUPPORTED_KINDS = Object.freeze(new Set([
    'text', 'textarea', 'contenteditable', 'number', 'email', 'tel', 'url', 'search',
  ]));

  const adapter = {
    id: 'native-value',
    priority: 0,
    capabilities: Object.freeze(['write-value', 'verify']),
    supports(context) {
      const control = kind(context);
      const expected = text(context?.expectedType);
      return SUPPORTED_KINDS.has(control) && expected !== 'date';
    },
    read(context) {
      const runtime = events(context);
      return runtime?.readControlValue ? runtime.readControlValue(context.descriptor) : context?.descriptor?.element?.value;
    },
    async write(context) {
      const runtime = events(context);
      if (!runtime?.setNativeValue) {
        return { handled: true, ok: false, status: 'FAILED', reason: 'EventDispatcher.setNativeValue 不可用', strategy: 'native-value' };
      }
      const result = await runtime.setNativeValue(context.descriptor, context.value, { kind: kind(context) });
      return {
        handled: true,
        ok: Boolean(result?.ok),
        status: result?.ok ? 'SUCCESS' : 'FAILED',
        reason: result?.reason || '',
        actualValue: result?.afterValue,
        strategy: 'native-value',
      };
    },
    verify(context) {
      const runtime = verifier(context);
      if (!runtime?.verify) return { ok: false, status: 'FAILED', reason: 'VerificationEngine 不可用' };
      return runtime.verify(context.descriptor, context.value, {
        ...context.settings,
        fieldPath: context.fieldPath,
        expectedType: context.expectedType,
      });
    },
  };

  return Object.freeze(adapter);
});
