/* 解放：申请资料管理页材料库 UI。SPDX-License-Identifier: MIT */
(function initMaterialLibraryUI(root) {
  'use strict';
  const Library = root.JFMaterialLibrary;
  if (!Library || typeof document === 'undefined') return;
  const CATEGORIES = Object.freeze([
    ['', '待确认'], ['photo', '证件照'], ['id_front', '身份证正面'], ['id_back', '身份证反面'],
    ['resume', '个人简历'], ['transcript', '成绩单'], ['language_certificate', '语言证书'],
    ['award_certificate', '获奖证书'], ['research', '科研证明'], ['paper', '论文材料'],
    ['patent', '专利材料'], ['practice', '实践证明'], ['internship', '实习证明'],
    ['recommendation', '推荐信'], ['other', '其他材料'],
  ]);
  let replaceId = '';
  const $ = id => document.getElementById(id);
  const escapeHtml = value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const formatBytes = value => {
    const bytes = Number(value || 0);
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 ** 2).toFixed(2)} MB`;
  };
  function toast(message) {
    if (typeof root.showToast === 'function') root.showToast(message);
    else { const target = $('material-message'); if (target) target.textContent = message; }
  }
  function rowMarkup(item) {
    const options = CATEGORIES.map(([value, label]) => `<option value="${value}"${value === item.category ? ' selected' : ''}>${label}</option>`).join('');
    const categoryLabel = CATEGORIES.find(([value]) => value === item.category)?.[1] || '待确认分类';
    return `<article class="material-item" data-material-id="${escapeHtml(item.id)}"><div class="material-head"><span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(categoryLabel)} · ${escapeHtml(item.extension?.toUpperCase())} · ${formatBytes(item.size)}</small></span><span class="material-actions"><button type="button" data-material-action="preview">预览</button><button type="button" data-material-action="replace">更换</button><button type="button" data-material-action="remove" class="danger">删除</button></span></div><details class="material-details"><summary>编辑材料信息</summary><div class="material-grid"><label>显示名称<input data-material-key="name" value="${escapeHtml(item.name)}"></label><label>分类<select data-material-key="category">${options}</select></label><label>标签（逗号分隔）<input data-material-key="tags" value="${escapeHtml((item.tags || []).join(', '))}"></label><label>别名（逗号分隔）<input data-material-key="aliases" value="${escapeHtml((item.aliases || []).join(', '))}"></label><label class="wide">关联申请资料（高级）<input data-material-key="relatedResumePath" value="${escapeHtml(item.relatedResumePath || '')}" placeholder="例如 awards[0] 或 basic.photo"></label></div><button type="button" class="material-save" data-material-action="save">保存材料信息</button></details></article>`;
  }
  async function render() {
    const [items, usage] = await Promise.all([Library.list(), Library.estimateUsage()]);
    $('material-list').innerHTML = items.length ? items.map(rowMarkup).join('') : '<div class="material-empty">材料库为空。拖入常用文件后，它们只保存在本机浏览器。</div>';
    $('material-usage').textContent = `${usage.fileCount} 个文件 · ${formatBytes(usage.usedBytes)}${usage.quota ? ` / 可用配额约 ${formatBytes(usage.quota)}` : ''}`;
    document.dispatchEvent(new CustomEvent('jf-materials-rendered', { detail: { count: usage.fileCount } }));
  }
  async function importFiles(files) {
    try {
      $('material-drop').classList.add('busy');
      const added = await Library.addFiles(files);
      const duplicateCount = added.filter(item => item.duplicate).length;
      await render();
      toast(`✅ 已导入 ${added.length - duplicateCount} 个材料${duplicateCount ? `，跳过 ${duplicateCount} 个重复文件` : ''}`);
    } catch (error) { toast(`❌ ${error.message || error}`); }
    finally { $('material-drop').classList.remove('busy'); $('material-file-input').value = ''; }
  }
  async function handleAction(button) {
    const row = button.closest('[data-material-id]');
    const id = row?.dataset.materialId;
    if (!id) return;
    const action = button.dataset.materialAction;
    if (action === 'save') {
      const value = key => row.querySelector(`[data-material-key="${key}"]`)?.value.trim() || '';
      await Library.update(id, { name: value('name'), category: value('category'), tags: value('tags').split(/[,，]/).map(item => item.trim()).filter(Boolean), aliases: value('aliases').split(/[,，]/).map(item => item.trim()).filter(Boolean), relatedResumePath: value('relatedResumePath') });
      await render(); toast('✅ 材料元数据已保存'); return;
    }
    if (action === 'remove') {
      if (!confirm('只删除材料库中的本地副本，不会删除你电脑上的原文件。确认删除？')) return;
      await Library.remove(id); await render(); toast('已从材料库删除'); return;
    }
    if (action === 'replace') { replaceId = id; $('material-replace-input').click(); return; }
    if (action === 'preview') {
      const record = await Library.getRecord(id);
      if (!record?.blob) throw new Error('材料内容不存在');
      const url = URL.createObjectURL(record.blob);
      root.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    }
  }
  document.addEventListener('DOMContentLoaded', async () => {
    const drop = $('material-drop');
    if (!drop) return;
    ['dragenter', 'dragover'].forEach(type => drop.addEventListener(type, event => { event.preventDefault(); event.stopPropagation(); drop.classList.add('drag-over'); }));
    ['dragleave', 'drop'].forEach(type => drop.addEventListener(type, event => { event.preventDefault(); event.stopPropagation(); drop.classList.remove('drag-over'); }));
    drop.addEventListener('drop', event => importFiles(event.dataTransfer.files));
    drop.addEventListener('click', () => $('material-file-input').click());
    drop.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); $('material-file-input').click(); } });
    $('material-file-input').addEventListener('change', event => importFiles(event.target.files));
    $('material-replace-input').addEventListener('change', async event => {
      try { if (replaceId && event.target.files[0]) { await Library.replace(replaceId, event.target.files[0]); await render(); toast('✅ 已更换材料文件'); } }
      catch (error) { toast(`❌ ${error.message || error}`); }
      finally { replaceId = ''; event.target.value = ''; }
    });
    $('material-list').addEventListener('click', async event => {
      const button = event.target.closest('[data-material-action]');
      if (!button) return;
      try { await handleAction(button); } catch (error) { toast(`❌ ${error.message || error}`); }
    });
    await render();
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
