/* 解放：radio / checkbox Adapter。 SPDX-License-Identifier: MIT */
(function initChoiceAdapter(root, factory) {
  let events = root?.JFEventDispatcher;
  let options = root?.JFOptionAliases;
  let verification = root?.JFVerificationEngine;
  let booleanSemantic = root?.JFBooleanSemanticAdapter;
  if (typeof module === 'object' && module.exports) {
    events = require('../../core/event-dispatcher.js');
    options = require('../../mappings/option-aliases.js');
    verification = require('../../core/verification-engine.js');
    booleanSemantic = require('../../semantics/boolean-semantic-adapter.js');
  }
  const api = factory(events, options, verification, booleanSemantic);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.JFChoiceAdapter = api;
  root?.JFControlAdapterRegistry?.register?.(api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function choiceAdapterFactory(E, O, V, B) {
  'use strict';

  function text(value) { return value === null || value === undefined ? '' : String(value).trim(); }
  function kind(context) { return text(context?.descriptor?.controlKind || context?.descriptor?.type).toLowerCase(); }
  function events(context) { return context?.dependencies?.EventDispatcher || E; }
  function options(context) { return context?.dependencies?.OptionAliases || O; }
  function verifier(context) { return context?.dependencies?.VerificationEngine || V; }
  function booleanSemantic(context) { return context?.dependencies?.BooleanSemanticAdapter || B; }

  function normalizedPath(context) {
    const aliases = options(context);
    return aliases?.normalizeFieldPath ? aliases.normalizeFieldPath(context.fieldPath) : text(context.fieldPath).replace(/\[\d+\]/g, '[]');
  }

  function explicitBoolean(context) {
    const expected = text(context?.expectedType).toLowerCase();
    const semantic = text(context?.descriptor?.semanticType || context?.descriptor?.valueType).toLowerCase();
    return expected === 'boolean' || expected === 'bool' || semantic === 'boolean'
      || normalizedPath(context) === 'education[].eliteTrainingBase';
  }

  function optionCandidates(context) {
    const descriptor = context?.descriptor || {};
    const elements = Array.isArray(descriptor.elements) && descriptor.elements.length
      ? descriptor.elements
      : [descriptor.element].filter(Boolean);
    if (Array.isArray(descriptor.options) && descriptor.options.length) return descriptor.options;
    return elements.map(element => ({
      element,
      label: text(element?.getAttribute?.('aria-label') || element?.value || element?.textContent),
      value: text(element?.value || element?.getAttribute?.('data-value')),
      disabled: Boolean(element?.disabled),
    }));
  }

  const adapter = {
    id: 'choice',
    priority: 400,
    capabilities: Object.freeze(['toggle', 'enumerate-options', 'select-option', 'verify']),
    adapterIdFor(context) { return kind(context) === 'checkbox' ? 'checkbox' : 'radio'; },
    supports(context) { return ['radio', 'checkbox'].includes(kind(context)); },
    read(context) {
      const runtime = events(context);
      return runtime?.readControlValue ? runtime.readControlValue(context.descriptor) : '';
    },
    async write(context) {
      const runtime = events(context);
      if (!runtime?.setChecked) {
        return { handled: true, ok: false, status: 'FAILED', reason: 'EventDispatcher.setChecked 不可用', strategy: 'choice' };
      }
      const candidates = optionCandidates(context).filter(option => !option?.disabled && option?.element);
      if (kind(context) === 'checkbox' && candidates.length <= 1) {
        if (!explicitBoolean(context)) {
          return { handled: true, ok: false, status: 'NEEDS_CONFIRMATION', reason: '该单选勾选框没有明确 Boolean 语义', strategy: 'checkbox-field-aware' };
        }
        const desired = booleanSemantic(context)?.normalize?.(context.value);
        if (desired === null || desired === undefined) {
          return { handled: true, ok: false, status: 'NEEDS_CONFIRMATION', reason: 'Boolean 值无法可靠解释', strategy: 'checkbox-field-aware' };
        }
        const result = await runtime.setChecked(candidates[0]?.element || context.descriptor.element, desired);
        return {
          handled: true,
          ok: Boolean(result?.ok),
          status: result?.ok ? 'SUCCESS' : 'FAILED',
          reason: result?.reason || '',
          actualValue: result?.afterValue,
          strategy: 'checkbox-boolean-semantic',
        };
      }

      const aliases = options(context);
      if (!aliases?.findBestOption) {
        return { handled: true, ok: false, status: 'FAILED', reason: 'OptionAliases 不可用', strategy: 'choice' };
      }
      const match = aliases.findBestOption(context.value, candidates, {
        fieldPath: context.fieldPath,
        optionAliases: context.settings?.optionAliases,
        minScore: Number.isFinite(context.settings?.optionMinScore) ? context.settings.optionMinScore : 0.9,
        ambiguityMargin: Number.isFinite(context.settings?.optionAmbiguityMargin) ? context.settings.optionAmbiguityMargin : 0.06,
      });
      if (!match.matched || !match.option?.element) {
        return {
          handled: true,
          ok: false,
          status: 'NEEDS_CONFIRMATION',
          reason: match.ambiguous ? '选择项存在歧义，需要人工确认' : '没有可靠匹配的选择项',
          strategy: 'choice-semantic-match',
          optionCandidates: match.candidates || [],
          optionMatchingDebug: match.optionMatchingDebug || null,
        };
      }
      const result = await runtime.setChecked(match.option.element, true);
      return {
        handled: true,
        ok: Boolean(result?.ok),
        status: result?.ok ? 'SUCCESS' : 'FAILED',
        reason: result?.reason || '',
        actualValue: result?.afterValue,
        selectedOption: match.label,
        optionCandidates: match.candidates || [],
        optionMatchingDebug: match.optionMatchingDebug || null,
        strategy: 'choice-semantic-match',
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
