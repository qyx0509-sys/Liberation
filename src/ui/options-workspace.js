/* Presentation-only profile workspace. Profile normalization and storage stay in options.js. */
(function initOptionsWorkspace(root) {
  'use strict';
  if (!root.document) return;
  const doc = root.document;
  const $ = id => doc.getElementById(id);
  let ready = false;
  let dirty = false;
  let revision = 0;
  let currentSection = 'personal';
  let materialCount = 0;
  let inspectorReturnFocus = null;
  let refreshPending = false;
  let activeConfirmation = null;
  const names = { personal: '个人信息', intention: '求职意向', family: '家庭信息', education: '教育背景', languages: '外语能力', internship: '学习和工作经历', work: '旧版工作经历', projects: '项目经历', research: '科研工作', practice: '社会实践 / 学生工作', awards: '奖励与荣誉', skills: '技能专长', papers: '学术成果', intro: '自我评价', application: '申请附加信息' };
  const sectionIcons = { personal: 'user', intention: 'target', family: 'users', education: 'graduation', languages: 'globe', internship: 'briefcase', work: 'briefcase', projects: 'folder', research: 'flask', practice: 'users', awards: 'award', skills: 'sparkles', papers: 'file', intro: 'message', application: 'file' };
  const descriptions = { personal: '维护常用身份和联系信息，地区与详细地址分别保存。', education: '按学习阶段添加记录，保留学校、专业与成绩信息。', internship: '从高中起逐条维护学习或工作单位与任职信息。', awards: '奖项类别、级别、获奖等级与参与方式分别维护。', application: '申请专用长文本，与自我评价独立保存。', family: '每位家庭成员或社会关系单独添加，记录顺序可调整。' };
  function setState(key, text) {
    const target = $('save-state');
    if (!target) return;
    target.dataset.state = key;
    target.textContent = text;
    target.setAttribute('aria-live', key.endsWith('error') ? 'assertive' : 'polite');
    $('profile-content')?.setAttribute('aria-busy', key === 'loading' ? 'true' : 'false');
    $('btn-save').disabled = key === 'loading' || key === 'saving';
  }
  function message(text, tone = 'neutral') {
    const target = $('workspace-message');
    if (!target) return;
    target.hidden = !text;
    target.dataset.tone = tone;
    target.textContent = text;
    target.setAttribute('aria-live', tone === 'danger' ? 'assertive' : 'polite');
  }
  function markDirty() {
    if (!ready) return;
    dirty = true;
    revision += 1;
    setState('dirty', '未保存');
    message('');
    scheduleRefresh();
  }
  function beginSave() { setState('saving', '正在保存…'); return revision; }
  function saved(savedRevision = revision, note = '') {
    ready = true;
    if (savedRevision === revision) { dirty = false; setState('saved', '已保存'); }
    else { dirty = true; setState('dirty', '仍有未保存修改'); }
    message(note);
    refresh();
  }
  function failed(kind = 'save', detail = '') {
    ready = true;
    setState(kind === 'import' ? 'import-error' : 'save-error', kind === 'import' ? '导入失败' : '保存失败');
    message(detail || (kind === 'import' ? '未能导入资料，请检查格式后重新选择文件。' : '未能保存资料，请重试；当前编辑内容仍保留在页面中。'), 'danger');
  }
  function loaded() {
    ready = true;
    dirty = false;
    setState('saved', '已保存');
    refresh();
    if (root.JFProfileCoverage?.fromDocument(doc).filled === 0) message('从个人信息开始，或导入已有申请资料。空白字段不代表某个学校的必填要求。');
    revealHashTarget();
  }
  function importing() { setState('importing', '正在导入…'); message('正在本地读取文件，申请资料不会发送到外部服务。'); }
  function labelControls(container = doc) {
    let sequence = 0;
    for (const control of container.querySelectorAll('input,select,textarea')) {
      if (control.type === 'hidden' || control.type === 'file' || control.closest('[hidden]')) continue;
      const field = control.closest('.field,.custom-field-row');
      const label = field?.querySelector('label,.custom-field-lbl');
      if (label) {
        if (!control.id) {
          do { control.id = `profile-control-${++sequence}`; } while (doc.getElementById(control.id) !== control);
        }
        if (label.tagName === 'LABEL') label.htmlFor = control.id;
        else control.setAttribute('aria-label', label.textContent.trim());
      }
      if (control.dataset.key === 'gpa' && field && !field.querySelector('.gpa-help')) {
        const help = doc.createElement('div');
        help.className = 'field-hint gpa-help';
        help.id = `${control.id}-help`;
        help.textContent = '格式示例：3.80/4.00';
        field.appendChild(help);
        control.setAttribute('aria-describedby', help.id);
      }
      if (control.tagName === 'TEXTAREA' && field) field.classList.add('full-width');
    }
  }
  function organizePersonal() {
    const body = $('sec-personal')?.querySelector('.card-body');
    if (!body || body.dataset.organized) return;
    body.dataset.organized = 'true';
    const groups = [
      ['身份与基本信息', ['p_name', 'p_namePinyin', 'p_gender', 'p_birthday', 'p_idType', 'p_id_number', 'p_political', 'p_ethnicity', 'p_marital', 'p_nationality']],
      ['联系方式', ['p_phone', 'p_email', 'p_wechat', 'p_qq', 'c_landline', 'c_emergencyPhone', 'p_current_city', 'c_postcode', 'p_address', 'c_address']],
      ['地区与户籍', ['p_hometown_province', 'p_hometown_city', 'p_birthplaceRegion', 'p_householdRegion', 'p_household_address']],
      ['档案信息', ['c_archive_organization', 'c_archive_postcode', 'c_archiveRegion', 'c_archive_address']],
      ['其他信息', ['p_age', 'p_height', 'p_healthStatus', 'p_militaryStatus']],
    ];
    const oldGrids = [...body.children];
    for (const [title, ids] of groups) {
      const section = doc.createElement('section');
      section.className = 'field-group';
      const heading = doc.createElement('h3');
      heading.textContent = title;
      const grid = doc.createElement('div');
      grid.className = 'grid g2';
      ids.forEach(id => {
        const field = $(id)?.closest('.field');
        if (field) { if (['p_address', 'c_address', 'p_household_address', 'c_archive_address'].includes(id)) field.classList.add('full-width'); grid.appendChild(field); }
      });
      section.append(heading, grid);
      body.appendChild(section);
    }
    oldGrids.forEach(grid => { if (!grid.querySelector('input,select,textarea')) grid.remove(); });
  }
  function decorateSections() {
    for (const [section, title] of Object.entries(names)) {
      const card = $(`sec-${section}`);
      const heading = card?.querySelector('.card-header h2');
      if (!heading || heading.dataset.decorated) continue;
      heading.dataset.decorated = 'true';
      const icon = doc.createElement('span');
      icon.dataset.icon = sectionIcons[section];
      heading.prepend(icon);
      if (descriptions[section]) {
        const description = doc.createElement('p');
        description.className = 'card-description';
        description.textContent = descriptions[section];
        card.querySelector('.card-header').after(description);
      }
      for (const button of card.querySelectorAll('.btn-add')) {
        if (!button.querySelector('[data-icon]')) {
          const text = button.textContent.replace(/^\s*\+\s*/, '').replace(/^添加/, '添加一条');
          button.innerHTML = '<span data-icon="plus"></span>';
          button.append(doc.createTextNode(text));
        }
      }
    }
    const legacy = $('sec-work');
    if (legacy && !legacy.closest('.legacy-records')) {
      const details = doc.createElement('details');
      details.className = 'legacy-records';
      const summary = doc.createElement('summary');
      summary.textContent = '更多 / 兼容数据';
      details.appendChild(summary);
      $('sec-family').after(details);
      details.appendChild(legacy);
    }
  }
  function refreshRecords() {
    for (const collection of root.JFProfileCoverage?.ARRAYS || []) {
      const rows = [...doc.querySelectorAll(`#${collection.container} > .multi-item`)];
      rows.forEach((row, index) => {
        const header = row.querySelector('.multi-item-header');
        if (!header) return;
        const title = row.querySelector('.multi-item-title');
        if (title) title.textContent = `${names[collection.section]} ${index + 1}`;
        const values = ['school', 'company', 'name', 'content', 'language', 'title', 'location'].map(key => row.querySelector(`[data-key="${key}"]`)?.value?.trim()).filter(Boolean);
        let summary = row.querySelector('.record-summary');
        if (!summary) { summary = doc.createElement('div'); summary.className = 'record-summary'; title?.after(summary); }
        summary.textContent = values[0] || '填写这条记录的信息';
        if (title && !title.parentElement.classList.contains('record-heading')) {
          const heading = doc.createElement('div'); heading.className = 'record-heading'; title.before(heading); heading.append(title, summary);
        }
        let actions = header.querySelector('.record-actions,.award-actions');
        if (!actions) {
          actions = doc.createElement('div'); actions.className = 'record-actions';
          const remove = header.querySelector('.btn-remove');
          ['up', 'down'].forEach(direction => { const button = doc.createElement('button'); button.type = 'button'; button.className = 'btn-move'; button.dataset.recordMove = direction; actions.appendChild(button); });
          if (remove) actions.appendChild(remove);
          header.appendChild(actions);
        }
        const up = actions.querySelector('[data-record-move="up"],[data-award-move="up"]');
        const down = actions.querySelector('[data-record-move="down"],[data-award-move="down"]');
        for (const [button, iconName, label] of [[up, 'arrow-up', '上移记录'], [down, 'arrow-down', '下移记录'], [actions.querySelector('.btn-remove'), 'trash', '删除记录']]) {
          if (!button) continue;
          button.setAttribute('aria-label', `${label}：${names[collection.section]} ${index + 1}`);
          button.title = label;
          button.innerHTML = root.JFUI?.icon(iconName) || label;
        }
        if (up) up.disabled = index === 0;
        if (down) down.disabled = index === rows.length - 1;
      });
    }
  }
  function focusField(field) {
    const target = field.id ? $(field.id) : doc.querySelectorAll(`#${field.container} > .multi-item`)[field.index]?.querySelector(`[data-key="${field.key}"]`);
    if (!target) return;
    openSection(field.section);
    closeInspector(false);
    target.scrollIntoView({ block: 'center', behavior: 'instant' });
    target.focus({ preventScroll: true });
  }
  function renderCoverage() {
    if (!root.JFProfileCoverage) return;
    const coverage = root.JFProfileCoverage.fromDocument(doc);
    for (const [id, value] of [['header-coverage', `${coverage.percent}%`], ['coverage-percent', `${coverage.percent}%`], ['coverage-filled', coverage.filled], ['coverage-missing', coverage.missing], ['coverage-materials', materialCount]]) { if ($(id)) $(id).textContent = String(value); }
    $('coverage-progress').value = coverage.percent;
    $('nav-total').textContent = `已填写 ${coverage.filled} / ${coverage.total} 个字段`;
    for (const [section, counts] of Object.entries(coverage.sections)) {
      const count = $(`cnt-${section}`);
      if (count) { count.textContent = `${counts.filled}/${counts.total}`; count.classList.toggle('is-complete', counts.filled === counts.total); }
    }
    for (const section of Object.keys(names)) { if (!coverage.sections[section] && $(`cnt-${section}`)) $(`cnt-${section}`).textContent = '0 条'; }
    const module = coverage.sections[currentSection] || { filled: 0, total: 0 };
    $('module-coverage').textContent = `${module.filled} / ${module.total}`;
    $('module-title').textContent = names[currentSection] || '个人信息';
    $('module-progress').value = module.total ? Math.round(module.filled / module.total * 100) : 0;
    const missing = coverage.missingFields.filter(field => field.section === currentSection).slice(0, 5);
    const list = $('missing-fields'); list.replaceChildren();
    missing.forEach(field => { const button = doc.createElement('button'); button.type = 'button'; button.textContent = `${field.index !== undefined ? `第 ${field.index + 1} 条 · ` : ''}${field.label}`; const icon = doc.createElement('span'); icon.dataset.icon = 'chevron-right'; button.appendChild(icon); button.addEventListener('click', () => focusField(field)); list.appendChild(button); });
    if (!missing.length) { const empty = doc.createElement('p'); empty.textContent = module.total ? '本模块已维护的字段均已填写。' : '尚未添加记录，可按需要添加。'; list.appendChild(empty); }
    root.JFUI?.hydrateIcons(list);
  }
  function refresh() { organizePersonal(); decorateSections(); labelControls(); refreshRecords(); renderCoverage(); root.JFUI?.hydrateIcons(doc); }
  function scheduleRefresh() { if (refreshPending) return; refreshPending = true; queueMicrotask(() => { refreshPending = false; refresh(); }); }
  function openSection(section) {
    currentSection = section.replace(/^sec-/, '');
    const anchor = doc.querySelector(`.sidenav a[href="#sec-${currentSection}"]`);
    const group = anchor?.closest('details'); if (group) group.open = true;
    if (currentSection === 'work') {
      doc.querySelector('.compatibility-nav').open = true;
      const legacy = doc.querySelector('.legacy-records');
      if (legacy) legacy.open = true;
    }
    doc.querySelectorAll('.sidenav a').forEach(link => { const active = link === anchor; link.classList.toggle('active', active); if (active) link.setAttribute('aria-current', 'location'); else link.removeAttribute('aria-current'); });
    if ($('section-selector')) $('section-selector').value = currentSection;
    renderCoverage();
  }
  function goToSection(section) { openSection(section); $(`sec-${currentSection}`)?.scrollIntoView({ block: 'start', behavior: root.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' }); }
  function closeExport(restore = false) { $('export-menu').hidden = true; $('btn-export-menu').setAttribute('aria-expanded', 'false'); if (restore) $('btn-export-menu').focus(); }
  function openInspector() {
    inspectorReturnFocus = doc.activeElement;
    $('profile-inspector').classList.add('is-open'); $('inspector-backdrop').hidden = false; $('btn-inspector').setAttribute('aria-expanded', 'true');
    $('profile-inspector').setAttribute('role', 'dialog'); $('profile-inspector').setAttribute('aria-modal', 'true');
    $('btn-inspector-close').focus();
  }
  function closeInspector(restore = true) {
    $('profile-inspector').classList.remove('is-open'); $('inspector-backdrop').hidden = true; $('btn-inspector').setAttribute('aria-expanded', 'false');
    $('profile-inspector').removeAttribute('role'); $('profile-inspector').removeAttribute('aria-modal');
    if (restore && inspectorReturnFocus?.isConnected) inspectorReturnFocus.focus();
  }
  function revealHashTarget() {
    const id = root.location?.hash?.slice(1);
    if (!id) return;
    if (id === 'sec-material-library' || id === 'sec-import') {
      if (root.innerWidth < 1200) openInspector();
      $(id)?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
    } else if (names[id.replace(/^sec-/, '')]) goToSection(id);
  }
  function confirmRemoval() {
    if (activeConfirmation) return Promise.resolve(false);
    const dialog = $('delete-record-dialog');
    const previous = doc.activeElement;
    const session = {};
    activeConfirmation = session;
    dialog.returnValue = 'cancel';
    return new Promise(resolve => {
      let settled = false;
      const finish = value => {
        if (settled || activeConfirmation !== session) return;
        settled = true;
        activeConfirmation = null;
        $('delete-record-confirm').removeEventListener('click', onConfirm);
        $('delete-record-cancel').removeEventListener('click', onCancel);
        dialog.removeEventListener('cancel', onCancel);
        if (dialog.open) dialog.close(value);
        if (previous?.isConnected) previous.focus();
        resolve(value === 'confirm');
      };
      const onConfirm = event => { event.preventDefault(); finish('confirm'); };
      const onCancel = event => { event.preventDefault(); finish('cancel'); };
      // Native close events are queued and carry no originating showModal session.
      // A previous dialog's close can arrive after this shared dialog reopens; never
      // use that event to resolve a confirmation. Only this session's explicit
      // confirm/cancel action (including Escape's cancel event) settles its promise.
      $('delete-record-confirm').addEventListener('click', onConfirm);
      $('delete-record-cancel').addEventListener('click', onCancel);
      dialog.addEventListener('cancel', onCancel);
      dialog.showModal();
      $('delete-record-cancel').focus();
    });
  }
  doc.addEventListener('input', event => { if (event.target.closest('#profile-content') && !event.target.closest('[hidden]') && event.target.id !== 'award-import-text') markDirty(); });
  doc.addEventListener('change', event => { if (event.target.closest('#profile-content') && !event.target.closest('[hidden]') && event.target.id !== 'award-import-text') markDirty(); });
  root.addEventListener('beforeunload', event => { if (!dirty) return; event.preventDefault(); event.returnValue = ''; });
  root.addEventListener('hashchange', revealHashTarget);
  root.matchMedia?.('(min-width: 1200px)').addEventListener('change', event => { if (event.matches) closeInspector(false); });
  doc.addEventListener('click', event => {
    const move = event.target.closest('[data-record-move]');
    if (move && !move.disabled) {
      const row = move.closest('.multi-item'); const container = row.parentElement;
      if (move.dataset.recordMove === 'up' && row.previousElementSibling) container.insertBefore(row, row.previousElementSibling);
      else if (move.dataset.recordMove === 'down' && row.nextElementSibling) container.insertBefore(row.nextElementSibling, row);
      [...container.children].forEach((item, index) => { item.dataset.index = index; });
      markDirty(); refresh(); row.querySelector(`[data-record-move="${move.dataset.recordMove}"]`)?.focus();
    }
    const compatibility = event.target.closest('[data-section-target]');
    if (compatibility) goToSection(compatibility.dataset.sectionTarget);
    if (!event.target.closest('.export-menu-wrap')) closeExport();
  });
  $('btn-export-menu')?.addEventListener('click', () => { const menu = $('export-menu'); menu.hidden = !menu.hidden; $('btn-export-menu').setAttribute('aria-expanded', String(!menu.hidden)); if (!menu.hidden) menu.querySelector('button')?.focus(); });
  $('export-menu')?.addEventListener('click', () => closeExport(true));
  $('btn-import')?.addEventListener('click', () => $('importFile').click());
  $('import-zone')?.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); $('importFile').click(); } });
  $('btn-inspector')?.addEventListener('click', openInspector);
  $('btn-inspector-close')?.addEventListener('click', () => closeInspector());
  $('inspector-backdrop')?.addEventListener('click', () => closeInspector());
  doc.addEventListener('keydown', event => {
    if (event.key === 'Escape') { if (!$('export-menu').hidden) closeExport(true); if ($('profile-inspector').classList.contains('is-open')) closeInspector(); }
    if (event.key === 'Tab' && $('profile-inspector').classList.contains('is-open')) {
      const controls = [...$('profile-inspector').querySelectorAll('button,input:not([type="file"]),select,textarea,[tabindex="0"]')].filter(control => !control.disabled && control.getClientRects().length);
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && doc.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && doc.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
    if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && event.target.closest('#export-menu')) {
      event.preventDefault(); const buttons = [...$('export-menu').querySelectorAll('button')]; const index = buttons.indexOf(doc.activeElement); buttons[(index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length].focus();
    }
  });
  const selector = $('section-selector');
  if (selector) {
    doc.querySelectorAll('.nav-group').forEach(group => { const optionGroup = doc.createElement('optgroup'); optionGroup.label = group.querySelector('summary').textContent.trim(); group.querySelectorAll('a,[data-section-target]').forEach(link => { const section = (link.getAttribute('href')?.replace('#sec-', '') || link.dataset.sectionTarget?.replace('sec-', '')); if (!section) return; const option = doc.createElement('option'); option.value = section; option.textContent = names[section]; optionGroup.appendChild(option); }); selector.appendChild(optionGroup); });
    selector.addEventListener('change', () => goToSection(selector.value));
  }
  doc.addEventListener('jf-materials-rendered', event => { materialCount = Number(event.detail?.count || 0); renderCoverage(); });
  root.chrome?.storage?.onChanged?.addListener(changes => { if (changes.materialLibraryIndex) { materialCount = changes.materialLibraryIndex.newValue?.length || 0; renderCoverage(); } });
  root.chrome?.storage?.local?.get('materialLibraryIndex').then(result => { materialCount = result.materialLibraryIndex?.length || 0; renderCoverage(); }).catch(() => {});
  root.JFOptionsWorkspace = { loaded, refresh, scheduleRefresh, markDirty, beginSave, saved, failed, importing, message, openSection, confirmRemoval, get dirty() { return dirty; }, get revision() { return revision; } };
  refresh();
})(typeof globalThis !== 'undefined' ? globalThis : this);
