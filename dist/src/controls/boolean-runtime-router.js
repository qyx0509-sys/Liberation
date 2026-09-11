/*
 * Phase 2.3-E Boolean Runtime Router（兼容转发层）
 * Boolean 词典只由 BooleanSemanticAdapter 维护。
 */
(function initBooleanRuntimeRouter(root, factory) {
  let semantic = root?.JFBooleanSemanticAdapter;
  if (typeof module === 'object' && module.exports) semantic = require('../semantics/boolean-semantic-adapter.js');
  const api = factory(semantic);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.JFBooleanRuntimeRouter = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function booleanRuntimeRouterFactory(Semantic) {
  'use strict';

  function canonical(value) {
    return Semantic?.normalize ? Semantic.normalize(value) : null;
  }

  return Object.freeze({ canonical });
});
