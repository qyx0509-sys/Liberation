/* 解放：文件上传执行与验证。SPDX-License-Identifier: MIT */
(function initFileUploadEngine(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.JFFileUploadEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function fileUploadEngineFactory(root) {
  'use strict';
  const STATUS = Object.freeze({
    PENDING: 'PENDING', UPLOADING: 'UPLOADING', SUCCESS: 'UPLOAD_SUCCESS', FAILED: 'UPLOAD_FAILED',
    FORMAT_ERROR: 'FORMAT_ERROR', SIZE_ERROR: 'SIZE_ERROR', COUNT_ERROR: 'COUNT_ERROR', NEEDS_CONFIRMATION: 'NEEDS_CONFIRMATION',
  });
  const MAX_FILE_BYTES = 50 * 1024 * 1024;
  const MAX_BASE64_CHARS = Math.ceil(MAX_FILE_BYTES / 3) * 4 + 4;
  const ALLOWED_EXTENSIONS = new Set(['pdf', 'jpg', 'jpeg', 'png', 'docx']);
  function extensionOf(name) { return String(name || '').toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] || ''; }
  function safeReason(value) {
    return String(value || '文件上传失败')
      .replace(/[\r\n\u0000-\u001f\u007f]+/g, ' ')
      .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '<redacted-email>')
      .replace(/(?<!\d)1[3-9]\d{9}(?!\d)/g, '<redacted-phone>')
      .replace(/(?<!\d)\d{17}[\dXx](?![\dXx])/g, '<redacted-id>')
      .replace(/(?:[A-Za-z]:\\|\\\\)[^\s"'<>]{1,260}/g, '<redacted-path>')
      .replace(/[^\s\\/<>":'：]{1,180}\.(?:pdf|docx?|jpe?g|png)(?=$|[\s,，。;；)）\]}])/gi, '<redacted-filename>')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 180);
  }
  function validate(match) {
    if (!match?.material || match.status !== 'MATCH') return { ok: false, status: STATUS.NEEDS_CONFIRMATION, reason: match?.reason || '尚未可靠匹配材料' };
    const restrictions = match.field?.restrictions || {};
    const material = match.material;
    if (!/^file_[\w-]{4,180}$/i.test(String(material.id || ''))) {
      return { ok: false, status: STATUS.NEEDS_CONFIRMATION, reason: '材料标识无效，请重新选择' };
    }
    const extension = material.extension || extensionOf(material.name);
    if (!ALLOWED_EXTENSIONS.has(String(extension).toLowerCase())) {
      return { ok: false, status: STATUS.FORMAT_ERROR, reason: '材料格式不在本地安全白名单中' };
    }
    if (!Number.isInteger(Number(material.size)) || Number(material.size) <= 0 || Number(material.size) > MAX_FILE_BYTES) {
      return { ok: false, status: STATUS.SIZE_ERROR, reason: '材料为空、大小无效或超过 50MB 限制' };
    }
    if (restrictions.extensions?.length && !restrictions.extensions.includes(extension)) {
      return { ok: false, status: STATUS.FORMAT_ERROR, reason: `页面仅允许 ${restrictions.extensions.join('/')}，材料为 ${extension || '未知格式'}` };
    }
    if (restrictions.maxBytes && Number(material.size) > restrictions.maxBytes) {
      return { ok: false, status: STATUS.SIZE_ERROR, reason: `材料 ${material.size} 字节，超过页面限制 ${restrictions.maxBytes} 字节` };
    }
    if (restrictions.maxCount === 1 && match.materials?.length > 1) {
      return { ok: false, status: STATUS.COUNT_ERROR, reason: '页面只允许上传 1 个文件' };
    }
    return { ok: true, status: STATUS.PENDING, reason: '' };
  }
  function runtimeMessage(message, timeoutMs = 30_000) {
    return new Promise((resolve, reject) => {
      if (!root?.chrome?.runtime?.sendMessage) { reject(new Error('扩展材料服务不可用')); return; }
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error('扩展材料服务响应超时'));
      }, Math.max(1_000, Math.min(60_000, Number(timeoutMs) || 30_000)));
      root.chrome.runtime.sendMessage(message, response => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const error = root.chrome.runtime.lastError;
        if (error || response?.error || response?.ok === false) reject(new Error(response?.error || error?.message || '扩展材料服务失败'));
        else resolve(response || {});
      });
    });
  }

  function validAuthorization(authorization, materialId) {
    return Boolean(
      authorization
      && authorization.userConfirmed === true
      && Number(authorization.expiresAt) > Date.now()
      && /^[a-z0-9._:-]{6,160}$/i.test(String(authorization.taskId || ''))
      && /^[a-z0-9_-]{16,200}$/i.test(String(authorization.nonce || ''))
      && ['auto-high-confidence', 'ask-every-time'].includes(String(authorization.filePolicy || ''))
      && /^file_[\w-]{4,180}$/i.test(String(materialId || ''))
    );
  }

  async function requestSingleUseAuthorization(material, authorization, timeoutMs) {
    const response = await runtimeMessage({
      type: 'AUTHORIZE_FILE_UPLOADS',
      taskId: authorization.taskId,
      nonce: authorization.nonce,
      userConfirmed: true,
      confirmationMode: 'per-file',
      materialIds: [material.id],
      confirmedMaterialId: material.id,
      materials: [{ id: material.id, hash: material.hash || '', size: Number(material.size) || 0 }],
      expiresAt: authorization.expiresAt,
    }, timeoutMs);
    if (response?.authorization?.oneTime !== true) throw new Error('后台未签发一次性文件授权');
    return response.authorization;
  }

  async function requestPayload(material, authorization, timeoutMs) {
    const response = await runtimeMessage({
      type: 'MATERIAL_GET_PAYLOAD',
      id: material.id,
      taskId: authorization.taskId,
      nonce: authorization.nonce,
    }, timeoutMs);
    return response.payload;
  }

  function safeFileName(value, extension) {
    const basename = String(value || '').split(/[\\/]/).pop()
      .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]+/g, '_')
      .trim()
      .slice(0, 255);
    return basename || `material.${extension}`;
  }

  function fileFromAuthorizedPayload(payload, expectedMaterial, view) {
    if (!payload || typeof payload !== 'object' || typeof payload.base64 !== 'string') throw new Error('授权材料载荷格式无效');
    if (!payload.base64 || payload.base64.length > MAX_BASE64_CHARS || payload.base64.length % 4 !== 0) throw new Error('授权材料载荷为空或超过限制');
    if (/[^A-Za-z0-9+/=]/.test(payload.base64) || !/^[A-Za-z0-9+/]*={0,2}$/.test(payload.base64)) throw new Error('授权材料载荷编码无效');
    const decode = view?.atob || root?.atob;
    if (typeof decode !== 'function') throw new Error('当前页面不支持本地文件解码');
    const binary = decode(payload.base64);
    if (!binary.length || binary.length > MAX_FILE_BYTES) throw new Error('授权材料大小无效或超过 50MB');
    const metadata = payload.metadata && typeof payload.metadata === 'object' ? payload.metadata : {};
    if (String(metadata.id || '') !== String(expectedMaterial.id || '')) throw new Error('授权材料与计划材料不匹配');
    if (Number(metadata.size) !== binary.length || Number(expectedMaterial.size) !== binary.length) throw new Error('材料大小在预览确认后发生变化');
    const extension = String(metadata.extension || extensionOf(metadata.name)).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(extension) || extension !== String(expectedMaterial.extension || extensionOf(expectedMaterial.name)).toLowerCase()) {
      throw new Error('材料格式在预览确认后发生变化');
    }
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    const FileConstructor = view?.File || root?.File;
    if (typeof FileConstructor !== 'function') throw new Error('当前页面不支持本地 File 对象');
    return new FileConstructor([bytes], safeFileName(metadata.name, extension), {
      type: /^[\w.+-]+\/[\w.+-]+$/i.test(String(metadata.mimeType || '')) ? metadata.mimeType : 'application/octet-stream',
      lastModified: Date.now(),
    });
  }

  function assignAuthorizedFile(input, file) {
    const view = input.ownerDocument?.defaultView || root;
    if (typeof view.DataTransfer !== 'function') throw new Error('当前页面不支持安全构造 FileList');
    const transfer = new view.DataTransfer();
    transfer.items.add(file);
    let prototype = view.HTMLInputElement?.prototype || Object.getPrototypeOf(input);
    let descriptor = null;
    while (prototype && !descriptor) {
      descriptor = Object.getOwnPropertyDescriptor(prototype, 'files');
      prototype = Object.getPrototypeOf(prototype);
    }
    if (typeof descriptor?.set !== 'function') throw new Error('当前页面不支持原生 FileList setter');
    descriptor.set.call(input, transfer.files);
    input.dispatchEvent(new view.Event('input', { bubbles: true, composed: true }));
    input.dispatchEvent(new view.Event('change', { bubbles: true, composed: true }));
  }

  async function waitForVerification(input, file, timeoutMs = 8000, signal) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (signal?.aborted) throw new DOMException('文件上传验证已取消', 'AbortError');
      const selected = [...(input.files || [])];
      if (selected.some(current => current.name === file.name && current.size === file.size && current.type === file.type)) return true;
      await new Promise(resolve => setTimeout(resolve, 80));
    }
    return false;
  }

  function usableInput(match) {
    const input = match?.field?.element;
    if (!input?.isConnected || input.disabled || input.readOnly) return false;
    if (String(input.tagName || '').toLowerCase() !== 'input' || String(input.type || '').toLowerCase() !== 'file') return false;
    if (!input.ownerDocument || input.closest?.('#__jf_panel__,#__jf_modal__,#__rf_panel__,[data-jiefang-ui]')) return false;
    if (match.field.hiddenInput && (!match.field.wrapper?.isConnected || match.field.visibleWrapper !== true)) return false;
    return true;
  }

  async function upload(match, options = {}) {
    const validation = validate(match);
    const result = { status: validation.status, reason: safeReason(validation.reason || '') };
    if (!validation.ok) return result;
    const input = match.field?.element;
    if (!usableInput(match)) return { ...result, status: STATUS.FAILED, reason: '上传 input 不可用或不属于可见上传区域' };
    try {
      result.status = STATUS.UPLOADING;
      const authorization = options.authorization;
      if (!validAuthorization(authorization, match.material.id)) throw new Error('本次任务没有新鲜且有效的文件上传授权');
      const perFileConfirmed = options.perFileConfirmed === true;
      if (authorization.filePolicy === 'ask-every-time' && !perFileConfirmed) {
        return { ...result, status: STATUS.NEEDS_CONFIRMATION, reason: '当前策略要求在每个文件上传前单独确认' };
      }
      const timeoutMs = Math.max(1_000, Math.min(60_000, Number(options.timeoutMs) || 30_000));
      if (perFileConfirmed) await requestSingleUseAuthorization(match.material, authorization, timeoutMs);
      const payload = await requestPayload(match.material, authorization, timeoutMs);
      const view = input.ownerDocument?.defaultView || root;
      const file = fileFromAuthorizedPayload(payload, match.material, view);
      // 授权已经在后台原子消费；执行前再检查一次，DOM 替换或配置变更都必须失败。
      if (!usableInput(match) || input !== match.field?.element) throw new Error('上传字段在授权消费后发生变化');
      assignAuthorizedFile(input, file);
      const verified = await waitForVerification(input, file, timeoutMs, options.signal);
      return verified ? { ...result, status: STATUS.SUCCESS, reason: '' } : { ...result, status: STATUS.FAILED, reason: '网页未保留所选文件' };
    } catch (error) {
      return { ...result, status: STATUS.FAILED, reason: safeReason(error?.message) };
    }
  }
  return Object.freeze({ ALLOWED_EXTENSIONS: Object.freeze([...ALLOWED_EXTENSIONS]), MAX_FILE_BYTES, STATUS, extensionOf, upload, validate });
});
