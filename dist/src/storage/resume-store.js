/* 解放：统一 Resume JSON 本地存储与向后兼容。SPDX-License-Identifier: MIT */
(function initResumeStore(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.JFResumeStore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function resumeStoreFactory(root) {
  'use strict';
  const KEY = 'resumeData';
  const ARRAY_KEYS = Object.freeze(['family', 'education', 'awards', 'research', 'projects', 'papers', 'patents', 'practice', 'internships', 'student_work', 'certificates', 'language']);

  function isRecord(value) { return Boolean(value && typeof value === 'object' && !Array.isArray(value)); }
  function clone(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }

  function migrate(input = {}) {
    const source = isRecord(input) ? clone(input) : {};
    source.profileName = String(source.profileName || '默认申请资料');
    source.basic = isRecord(source.basic) ? source.basic : { ...(isRecord(source.personal) ? source.personal : {}) };
    source.contact = isRecord(source.contact) ? source.contact : {
      phone: source.personal?.phone || '', email: source.personal?.email || '',
      wechat: source.personal?.wechat || '', qq: source.personal?.qq || '',
      address: source.personal?.address || '', currentCity: source.personal?.current_city || '',
    };
    if (!Array.isArray(source.internships)) source.internships = Array.isArray(source.internship) ? clone(source.internship) : [];
    if (!Array.isArray(source.language)) source.language = Array.isArray(source.languages) ? clone(source.languages) : [];
    ARRAY_KEYS.forEach(key => {
      if (key === 'family' && typeof source.family === 'string') return;
      if (!Array.isArray(source[key])) source[key] = [];
    });
    if (!isRecord(source.files)) source.files = {};
    return source;
  }

  function storageGet() {
    return new Promise(resolve => {
      if (!root?.chrome?.storage?.local) { resolve({}); return; }
      root.chrome.storage.local.get(KEY, value => resolve(value || {}));
    });
  }
  function storageSet(value) {
    return new Promise(resolve => {
      if (!root?.chrome?.storage?.local) { resolve(); return; }
      root.chrome.storage.local.set({ [KEY]: value }, resolve);
    });
  }
  async function get() { const result = await storageGet(); return migrate(result[KEY] || {}); }
  async function save(value) { const migrated = migrate(value); await storageSet(migrated); return migrated; }
  return { ARRAY_KEYS, KEY, get, migrate, save };
});
