/* 解放：扩展本地 IndexedDB 封装。SPDX-License-Identifier: MIT */
(function initIndexedDBStore(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.JFIndexedDB = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function indexedDBFactory(root) {
  'use strict';

  const DB_NAME = 'jiefang-material-library';
  const DB_VERSION = 1;
  const STORE_NAME = 'materials';
  let openPromise = null;

  function getFactory() {
    return root?.indexedDB || globalThis.indexedDB;
  }

  function open() {
    if (openPromise) return openPromise;
    const factory = getFactory();
    if (!factory) return Promise.reject(new Error('当前环境不支持 IndexedDB'));
    openPromise = new Promise((resolve, reject) => {
      const request = factory.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          store.createIndex('hash', 'hash', { unique: false });
          store.createIndex('category', 'category', { unique: false });
          store.createIndex('updatedAt', 'updatedAt', { unique: false });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('IndexedDB 打开失败'));
      request.onblocked = () => reject(new Error('材料库数据库被其他页面占用，请关闭旧管理页后重试'));
    }).catch(error => {
      openPromise = null;
      throw error;
    });
    return openPromise;
  }

  async function transaction(mode, action) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, mode);
      const store = tx.objectStore(STORE_NAME);
      let request;
      try { request = action(store); }
      catch (error) { reject(error); return; }
      tx.oncomplete = () => resolve(request?.result);
      tx.onerror = () => reject(tx.error || request?.error || new Error('材料库操作失败'));
      tx.onabort = () => reject(tx.error || new Error('材料库操作已中止'));
    });
  }

  const put = record => transaction('readwrite', store => store.put(record));
  const get = id => transaction('readonly', store => store.get(id));
  const getAll = () => transaction('readonly', store => store.getAll());
  const remove = id => transaction('readwrite', store => store.delete(id));
  const clear = () => transaction('readwrite', store => store.clear());

  async function findByHash(hash) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const request = tx.objectStore(STORE_NAME).index('hash').get(hash);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error || new Error('材料哈希查询失败'));
    });
  }

  return { DB_NAME, STORE_NAME, clear, findByHash, get, getAll, open, put, remove };
});
