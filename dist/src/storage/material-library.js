/*
 * 解放：个人材料库。Blob 仅保存于扩展 IndexedDB；chrome.storage.local 只保存元数据索引。
 * SPDX-License-Identifier: MIT
 */
(function initMaterialLibrary(root, factory) {
  let store = root?.JFIndexedDB;
  let aliases = root?.JFFileFieldAliases;
  if (typeof require === 'function') {
    try { store ||= require('./indexeddb.js'); } catch (_) { /* browser */ }
    try { aliases ||= require('../mappings/file-field-aliases.js'); } catch (_) { /* browser */ }
  }
  const api = factory(root, store, aliases);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.JFMaterialLibrary = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function materialLibraryFactory(root, DB, FileAliases) {
  'use strict';

  const INDEX_KEY = 'materialLibraryIndex';
  const MAX_FILE_BYTES = 50 * 1024 * 1024;
  const ALLOWED_EXTENSIONS = Object.freeze(['pdf', 'jpg', 'jpeg', 'png', 'docx']);

  function safeString(value, max = 500) {
    return String(value ?? '').trim().slice(0, max);
  }

  function extensionOf(name) {
    const match = safeString(name).toLowerCase().match(/\.([a-z0-9]+)$/);
    return match?.[1] || '';
  }

  function randomId() {
    if (root?.crypto?.randomUUID) return `file_${root.crypto.randomUUID()}`;
    return `file_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 11)}`;
  }

  async function digestHex(blob) {
    const bytes = await blob.arrayBuffer();
    const subtle = root?.crypto?.subtle || globalThis.crypto?.subtle;
    if (!subtle) throw new Error('当前浏览器不支持本地文件哈希');
    const digest = await subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
  }

  function metadataOf(record) {
    if (!record) return null;
    const { blob: _blob, ...metadata } = record;
    return metadata;
  }

  function storageSet(value) {
    return new Promise(resolve => {
      if (!root?.chrome?.storage?.local) { resolve(); return; }
      root.chrome.storage.local.set(value, resolve);
    });
  }

  async function syncIndex() {
    const records = await DB.getAll();
    const index = records.map(metadataOf).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    await storageSet({ [INDEX_KEY]: index });
    return index;
  }

  function normalizeMetadata(input = {}) {
    return {
      name: safeString(input.name, 255),
      category: safeString(input.category, 80),
      aliases: Array.isArray(input.aliases) ? input.aliases.map(value => safeString(value, 120)).filter(Boolean).slice(0, 30) : [],
      tags: Array.isArray(input.tags) ? input.tags.map(value => safeString(value, 80)).filter(Boolean).slice(0, 50) : [],
      relatedResumePath: safeString(input.relatedResumePath, 240),
    };
  }

  async function addFiles(fileList, overrides = {}) {
    const files = [...(fileList || [])];
    if (!files.length) return [];
    if (files.length > 50) throw new Error('单次最多导入 50 个材料文件');
    const added = [];
    for (const file of files) {
      const extension = extensionOf(file?.name);
      if (!ALLOWED_EXTENSIONS.includes(extension)) throw new Error(`${safeString(file?.name)}：仅支持 PDF/JPG/PNG/DOCX`);
      if (!file.size) throw new Error(`${safeString(file?.name)}：文件为空`);
      if (file.size > MAX_FILE_BYTES) throw new Error(`${safeString(file?.name)}：超过材料库单文件 50MB 限制`);
      const hash = await digestHex(file);
      const duplicate = await DB.findByHash(hash);
      if (duplicate) { added.push({ ...metadataOf(duplicate), duplicate: true }); continue; }
      const inference = FileAliases?.inferCategoryFromName?.(file.name) || {};
      const override = normalizeMetadata(overrides[file.name] || overrides.default || {});
      const now = new Date().toISOString();
      const record = {
        id: randomId(),
        name: override.name || safeString(file.name, 255),
        category: override.category || (inference.status === 'MATCH' ? inference.category : ''),
        categoryStatus: override.category ? 'CONFIRMED' : (inference.status || 'NEEDS_CONFIRMATION'),
        aliases: override.aliases,
        tags: override.tags,
        relatedResumePath: override.relatedResumePath,
        mimeType: safeString(file.type || 'application/octet-stream', 160),
        extension,
        size: Number(file.size),
        hash,
        createdAt: now,
        updatedAt: now,
        blob: file.slice(0, file.size, file.type || 'application/octet-stream'),
      };
      await DB.put(record);
      added.push(metadataOf(record));
    }
    await syncIndex();
    return added;
  }

  async function list() {
    return (await DB.getAll()).map(metadataOf).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  }

  async function getRecord(id) {
    return DB.get(id);
  }

  async function update(id, patch = {}) {
    const current = await DB.get(id);
    if (!current) throw new Error('材料不存在或已被删除');
    const metadata = normalizeMetadata({ ...current, ...patch });
    const next = { ...current, ...metadata, categoryStatus: metadata.category ? 'CONFIRMED' : 'NEEDS_CONFIRMATION', updatedAt: new Date().toISOString() };
    await DB.put(next);
    await syncIndex();
    return metadataOf(next);
  }

  async function remove(id) {
    await DB.remove(id);
    await syncIndex();
  }

  async function replace(id, file) {
    const current = await DB.get(id);
    if (!current) throw new Error('材料不存在或已被删除');
    const extension = extensionOf(file?.name);
    if (!ALLOWED_EXTENSIONS.includes(extension)) throw new Error('仅支持 PDF/JPG/PNG/DOCX');
    if (!file?.size || file.size > MAX_FILE_BYTES) throw new Error('替换文件为空或超过 50MB');
    const hash = await digestHex(file);
    const duplicate = await DB.findByHash(hash);
    if (duplicate && duplicate.id !== id) throw new Error(`该文件已存在于材料库：${duplicate.name}`);
    const next = {
      ...current,
      name: safeString(file.name, 255),
      mimeType: safeString(file.type || 'application/octet-stream', 160),
      extension,
      size: Number(file.size),
      hash,
      updatedAt: new Date().toISOString(),
      blob: file.slice(0, file.size, file.type || 'application/octet-stream'),
    };
    await DB.put(next);
    await syncIndex();
    return metadataOf(next);
  }

  async function clear() {
    await DB.clear();
    await syncIndex();
  }

  async function getPayload(id) {
    const record = await DB.get(id);
    if (!record?.blob) throw new Error('材料文件不存在');
    const bytes = new Uint8Array(await record.blob.arrayBuffer());
    let binary = '';
    const chunkSize = 0x8000;
    for (let index = 0; index < bytes.length; index += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
    }
    return { metadata: metadataOf(record), base64: btoa(binary) };
  }

  async function estimateUsage() {
    const records = await DB.getAll();
    const usedBytes = records.reduce((sum, record) => sum + Number(record.size || 0), 0);
    const estimate = await root?.navigator?.storage?.estimate?.().catch?.(() => null);
    return { usedBytes, quota: Number(estimate?.quota || 0), fileCount: records.length };
  }

  return {
    ALLOWED_EXTENSIONS, INDEX_KEY, MAX_FILE_BYTES, addFiles, clear, estimateUsage,
    extensionOf, getPayload, getRecord, list, metadataOf, normalizeMetadata, remove, replace, syncIndex, update,
  };
});
