/* 解放：原生 select Adapter。 SPDX-License-Identifier: MIT */
(function initNativeSelectAdapter(root, factory) {
  let events = root?.JFEventDispatcher;
  let options = root?.JFOptionAliases;
  let verification = root?.JFVerificationEngine;
  if (typeof module === 'object' && module.exports) {
    events = require('../../core/event-dispatcher.js');
    options = require('../../mappings/option-aliases.js');
    verification = require('../../core/verification-engine.js');
  }
  const api = factory(events, options, verification);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.JFNativeSelectAdapter = api;
  root?.JFControlAdapterRegistry?.register?.(api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function nativeSelectAdapterFactory(E, O, V) {
  'use strict';

  function text(value) { return value === null || value === undefined ? '' : String(value).trim(); }
  function events(context) { return context?.dependencies?.EventDispatcher || E; }
  function options(context) { return context?.dependencies?.OptionAliases || O; }
  function verifier(context) { return context?.dependencies?.VerificationEngine || V; }

  function candidates(context) {
    const descriptor = context?.descriptor || {};
    const source = Array.isArray(descriptor.options) && descriptor.options.length
      ? descriptor.options
      : Array.from(descriptor.element?.options || []).map(option => ({
        element: option,
        label: text(option?.label || option?.textContent || option?.value),
        value: text(option?.value),
        disabled: Boolean(option?.disabled),
      }));
    const aliases = options(context);
    return source.filter(option => !option?.disabled && !(aliases?.isPlaceholderOption?.(option)));
  }

  const adapter = {
    id: 'native-select',
    priority: 500,
    capabilities: Object.freeze(['enumerate-options', 'select-option', 'verify']),
    supports(context) {
      const descriptor = context?.descriptor;
      const kind = text(descriptor?.controlKind || descriptor?.type).toLowerCase();
      return kind === 'native-select' || text(descriptor?.element?.tagName).toLowerCase() === 'select';
    },
    read(context) {
      const runtime = events(context);
      return runtime?.readControlValue ? runtime.readControlValue(context.descriptor) : context?.descriptor?.element?.value;
    },
    async write(context) {
      const aliases = options(context);
      const runtime = events(context);
      if (!aliases?.findBestOption || !runtime?.setNativeSelect) {
        return { handled: true, ok: false, status: 'FAILED', reason: '原生下拉依赖不可用', strategy: 'native-select' };
      }
      const available = candidates(context);
      const match = aliases.findBestOption(context.value, available, {
        fieldPath: context.fieldPath,
        optionAliases: context.settings?.optionAliases,
        minScore: Number.isFinite(context.settings?.optionMinScore) ? context.settings.optionMinScore : 0.88,
        ambiguityMargin: Number.isFinite(context.settings?.optionAmbiguityMargin) ? context.settings.optionAmbiguityMargin : 0.06,
      });
      if (!match.matched || !match.option) {
        return {
          handled: true,
          ok: false,
          status: 'NEEDS_CONFIRMATION',
          reason: match.ambiguous ? '下拉选项存在歧义，需要人工确认' : '没有可靠匹配的下拉选项',
          strategy: 'native-select-semantic-match',
          optionCandidates: match.candidates || [],
          optionMatchingDebug: match.optionMatchingDebug || null,
        };
      }
      const result = await runtime.setNativeSelect(context.descriptor, match.option);
      return {
        handled: true,
        ok: Boolean(result?.ok),
        status: result?.ok ? 'SUCCESS' : 'FAILED',
        reason: result?.reason || '',
        actualValue: result?.afterValue,
        selectedOption: match.label,
        optionCandidates: match.candidates || [],
        optionMatchingDebug: match.optionMatchingDebug || null,
        strategy: 'native-select-semantic-match',
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
