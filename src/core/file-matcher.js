/* 解放：上传字段与材料库匹配。SPDX-License-Identifier: MIT */
(function initFileMatcher(root, factory) {
  let aliases = root?.JFFileFieldAliases;
  if (!aliases && typeof require === 'function') {
    try { aliases = require('../mappings/file-field-aliases.js'); } catch (_) { /* browser */ }
  }
  const api = factory(aliases);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.JFFileMatcher = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function fileMatcherFactory(FileAliases) {
  'use strict';
  const STATUS = Object.freeze({ MATCH: 'MATCH', NEEDS_CONFIRMATION: 'NEEDS_CONFIRMATION', MISSING_FILE: 'MISSING_FILE' });
  const text = value => String(value ?? '').trim();
  function usableMaterial(material) {
    return Boolean(
      material
      && /^file_[\w-]{4,180}$/i.test(text(material.id))
      && Number.isFinite(Number(material.size))
      && Number(material.size) > 0
      && Number(material.size) <= 50 * 1024 * 1024
    );
  }
  function getPath(object, path) {
    return String(path || '').split('.').filter(Boolean).reduce((value, key) => value?.[key], object);
  }
  function explicitIds(resume, path, context = {}) {
    const values = [];
    const fallbackPaths = {
      'files.photo': ['basic.photo', 'personal.photo'],
      'files.resume': ['basic.resume', 'personal.resume'],
      'files.transcript': ['basic.transcript'],
      'files.id_front': ['basic.idFront'],
      'files.id_back': ['basic.idBack'],
    };
    [path, ...(fallbackPaths[path] || [])].forEach(candidatePath => {
      const direct = getPath(resume, candidatePath);
      if (typeof direct === 'string') values.push(direct);
      if (Array.isArray(direct)) values.push(...direct);
    });
    const item = context.arrayItem;
    if (item) {
      ['attachments', 'attachment', 'fileIds', 'certificateFileId', 'photo', 'transcript'].forEach(key => {
        const value = item[key];
        if (typeof value === 'string') values.push(value);
        if (Array.isArray(value)) values.push(...value);
      });
    }
    return [...new Set(values.filter(value => /^file_[\w-]+$/i.test(text(value))))];
  }
  function materialScore(material, candidate, field, context = {}) {
    let score = 0;
    if (material.category && material.category === candidate.category) score += 70;
    const aliases = Array.isArray(material.aliases) ? material.aliases.slice(0, 30) : [];
    const tags = Array.isArray(material.tags) ? material.tags.slice(0, 50) : [];
    const corpus = [
      text(material.name).slice(0, 255),
      ...aliases.map(value => text(value).slice(0, 120)),
      ...tags.map(value => text(value).slice(0, 80)),
    ].join(' ').slice(0, 5_000);
    score += Math.round((FileAliases?.scoreText?.(field.contextText, corpus) || 0) * 0.25);
    const relatedPath = text(material.relatedResumePath);
    const contextPath = text(field.context?.resumePath || context.resumePath);
    const itemPath = context.section && Number.isInteger(context.arrayIndex)
      ? `${context.section}[${context.arrayIndex}]`
      : '';
    if (relatedPath && contextPath && relatedPath === contextPath) score += 35;
    else if (relatedPath && itemPath && (relatedPath === itemPath || relatedPath.startsWith(`${itemPath}.`))) score += 35;
    else if (relatedPath && relatedPath === candidate.path) score += 25;
    return Math.min(100, score);
  }
  function matchField(field, resume, materials = [], context = {}) {
    const availableMaterials = (Array.isArray(materials) ? materials : []).filter(usableMaterial).slice(0, 500);
    const candidate = field.recommendations?.[0] || (FileAliases?.rankFileFields?.(field.contextText)?.[0]);
    if (!candidate || candidate.score < 72 || candidate.path === 'files.other') {
      return {
        field,
        status: STATUS.NEEDS_CONFIRMATION,
        path: candidate?.path || 'files.other',
        score: candidate?.score || 0,
        reason: '上传字段语义不够明确，请人工选择材料或跳过',
        candidates: availableMaterials.slice(0, 20).map(material => ({ material, score: 0 })),
      };
    }
    const explicit = explicitIds(resume, candidate.path, context);
    if (explicit.length) {
      const selected = availableMaterials.find(material => material.id === explicit[0]);
      return selected
        ? { field, status: STATUS.MATCH, path: candidate.path, score: 100, material: selected, candidates: [{ material: selected, score: 100 }], reason: 'Resume JSON 明确绑定' }
        : {
          field,
          status: STATUS.MISSING_FILE,
          path: candidate.path,
          score: 100,
          reason: 'Resume JSON 绑定的材料在本地材料库中不存在',
          candidates: availableMaterials
            .map(material => ({ material, score: materialScore(material, candidate, field, context) }))
            .sort((a, b) => b.score - a.score)
            .slice(0, 20),
        };
    }
    const ranked = availableMaterials.map(material => ({ material, score: materialScore(material, candidate, field, context) })).sort((a, b) => b.score - a.score);
    const best = ranked[0];
    const second = ranked[1];
    if (!best || best.score < 82 || (second && best.score - second.score < 12)) {
      return { field, status: STATUS.NEEDS_CONFIRMATION, path: candidate.path, score: best?.score || candidate.score, reason: '材料候选分数不足或候选过于接近', candidates: ranked.slice(0, 20) };
    }
    return { field, status: STATUS.MATCH, path: candidate.path, score: best.score, material: best.material, candidates: ranked.slice(0, 5), reason: '材料分类与字段语义高可靠匹配' };
  }
  function matchFields(fields, resume, materials, context = {}) {
    return (fields || []).map(field => matchField(field, resume || {}, materials || [], context));
  }
  return { STATUS, explicitIds, matchField, matchFields, materialScore, usableMaterial };
});
