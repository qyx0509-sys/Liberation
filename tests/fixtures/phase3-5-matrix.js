(function initializePhase35MatrixFixture() {
  'use strict';

  const CASE_IDS = Object.freeze([
    'jqx-compound',
    'native-html-form',
    'modern-ant-design',
    'element-plus',
    'aria-generic',
    'react-select',
  ]);
  const counterKeys = Object.freeze([
    'unsafeClickCount',
    'submitClickCount',
    'deleteClickCount',
    'unsafeProgressionClickCount',
    'unknownUploadCount',
    'legalConsentAutoCheckCount',
    'viewerNavigationClickCount',
    'wrongOverlayCount',
    'wrongRowCount',
    'overwriteCount',
    'wrongRegionCount',
  ]);
  const state = {
    activeCase: 'jqx-compound',
    counters: Object.fromEntries(counterKeys.map(key => [key, 0])),
    openCounts: {},
    optionClickCounts: {},
    safeAddCounts: { practice: 0 },
    blockedNetworkRequests: [],
  };

  function byId(id) {
    const element = document.getElementById(id);
    if (!element) throw new Error(`Missing structural fixture element: ${id}`);
    return element;
  }

  function increment(bucket, key) {
    bucket[key] = Number(bucket[key] || 0) + 1;
  }

  function closeAllOverlays() {
    document.querySelectorAll('.matrix-overlay:not(.stale-overlay)').forEach(overlay => {
      overlay.hidden = true;
      overlay.setAttribute('aria-hidden', 'true');
    });
    document.querySelectorAll('[aria-expanded]').forEach(trigger => {
      trigger.setAttribute('aria-expanded', 'false');
    });
  }

  function activateCase(caseId) {
    if (!CASE_IDS.includes(caseId)) throw new Error(`Unknown matrix case: ${caseId}`);
    closeAllOverlays();
    document.querySelectorAll('[data-matrix-case]').forEach(section => {
      section.hidden = section.getAttribute('data-matrix-case') !== caseId;
    });
    state.activeCase = caseId;
    return snapshot();
  }

  function rootForTrigger(trigger) {
    return trigger.closest('[data-component="jqx-select"]')?.querySelector('[role="combobox"]')
      || trigger;
  }

  function bindSelect(triggerId, panelId, options = {}) {
    const trigger = byId(triggerId);
    const panel = byId(panelId);
    const clickTargets = new Set([trigger]);
    if (options.includeJqxShell) {
      const shell = trigger.closest('[data-component="jqx-select"]');
      shell?.querySelectorAll('.jqx-combobox-arrow,.jqx-dropdownlist-content').forEach(item => clickTargets.add(item));
    }

    const open = event => {
      event.preventDefault();
      const owner = rootForTrigger(trigger);
      owner.setAttribute('aria-expanded', 'true');
      increment(state.openCounts, triggerId);
      if (options.asyncOpen) {
        window.setTimeout(() => {
          panel.hidden = false;
          panel.setAttribute('aria-hidden', 'false');
        }, 24);
      } else {
        panel.hidden = false;
        panel.setAttribute('aria-hidden', 'false');
      }
    };
    clickTargets.forEach(target => target.addEventListener('click', open));

    panel.addEventListener('click', event => {
      const option = event.target.closest('[role="option"]');
      if (!option || !panel.contains(option)) return;
      event.preventDefault();
      const owner = rootForTrigger(trigger);
      const label = String(option.getAttribute('data-value') || option.textContent || '').trim();
      owner.setAttribute('data-value', label);
      if ('value' in owner) owner.value = label;
      const selected = owner.querySelector('[class*="selection-item"],[class*="selected-value"],.jqx-dropdownlist-content');
      if (selected) selected.textContent = label;
      panel.querySelectorAll('[role="option"]').forEach(candidate => {
        candidate.setAttribute('aria-selected', candidate === option ? 'true' : 'false');
      });
      owner.setAttribute('aria-expanded', 'false');
      panel.hidden = true;
      panel.setAttribute('aria-hidden', 'true');
      increment(state.optionClickCounts, triggerId);
    });
  }

  function bindCascader(config) {
    const root = byId(config.rootId);
    const trigger = byId(config.triggerId);
    const panel = byId(config.panelId);
    let selected = [];

    trigger.addEventListener('click', event => {
      event.preventDefault();
      panel.hidden = false;
      panel.setAttribute('aria-hidden', 'false');
      trigger.setAttribute('aria-expanded', 'true');
      increment(state.openCounts, config.rootId);
    });

    function renderSelection() {
      root.querySelectorAll('[data-cascader-selected-item]').forEach(item => item.remove());
      selected.forEach(label => {
        const item = document.createElement('span');
        item.setAttribute('data-cascader-selected-item', '');
        item.textContent = label;
        root.append(item);
      });
      const serialized = selected.join(' / ');
      root.setAttribute('data-value', serialized);
      trigger.value = serialized;
    }

    function appendCityMenu() {
      panel.querySelector('[data-cascader-level="1"]')?.remove();
      const menu = document.createElement('ul');
      menu.className = config.menuClass;
      menu.setAttribute('data-cascader-menu', '');
      menu.setAttribute('data-cascader-level', '1');
      for (const city of ['南京市', '苏州市']) {
        const item = document.createElement('li');
        item.className = config.optionClass;
        item.setAttribute('role', 'menuitem');
        item.setAttribute('data-value', city);
        const label = document.createElement('span');
        label.className = config.labelClass;
        label.textContent = city;
        item.append(label);
        menu.append(item);
      }
      panel.append(menu);
    }

    panel.addEventListener('click', event => {
      const option = event.target.closest('[role="menuitem"]');
      if (!option || !panel.contains(option)) return;
      const menu = option.closest('[data-cascader-menu]');
      const level = Number(menu?.getAttribute('data-cascader-level'));
      const label = String(option.getAttribute('data-value') || option.textContent || '').trim();
      if (level === 0) {
        selected = [label];
        renderSelection();
        window.setTimeout(appendCityMenu, 12);
      } else if (level === 1) {
        selected = [selected[0], label].filter(Boolean);
        renderSelection();
        panel.hidden = true;
        panel.setAttribute('aria-hidden', 'true');
        trigger.setAttribute('aria-expanded', 'false');
      }
      increment(state.optionClickCounts, config.rootId);
    });
  }

  function appendPracticeRow() {
    const body = byId('jqx-practice-body');
    const rowIndex = body.querySelectorAll('[data-repeat-item]').length;
    const row = document.createElement('tr');
    row.className = 'practice-row';
    row.setAttribute('data-repeat-item', '');
    const fields = [
      ['startDate', '开始时间', 'month'],
      ['endDate', '结束时间', 'month'],
      ['location', '地点', 'text'],
      ['description', '主要内容', 'text'],
    ];
    for (const [key, label, type] of fields) {
      const cell = document.createElement('td');
      const input = document.createElement('input');
      input.id = `jqx-practice-${key}-${rowIndex}`;
      input.type = type;
      input.setAttribute('aria-label', label);
      cell.append(input);
      row.append(cell);
    }
    const actionCell = document.createElement('td');
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = '删除';
    remove.addEventListener('click', () => {
      state.counters.unsafeClickCount += 1;
      state.counters.deleteClickCount += 1;
    });
    actionCell.append(remove);
    row.append(actionCell);
    body.append(row);
  }

  bindSelect('jqx-gender', 'jqx-gender-list', { includeJqxShell: true, asyncOpen: true });
  bindSelect('jqx-major', 'jqx-major-list', { includeJqxShell: true, asyncOpen: true });
  bindSelect('ant-major', 'ant-major-list');
  bindSelect('el-major', 'el-major-list');
  bindSelect('aria-ethnicity', 'aria-ethnicity-list', { asyncOpen: true });
  bindSelect('aria-political', 'aria-political-list', { asyncOpen: true });
  bindSelect('react-ethnicity', 'react-ethnicity-menu', { asyncOpen: true });
  bindSelect('react-political', 'react-political-menu', { asyncOpen: true });

  bindCascader({
    rootId: 'ant-region', triggerId: 'ant-region-trigger', panelId: 'ant-region-panel',
    menuClass: 'ant-cascader-menu', optionClass: 'ant-cascader-menu-item',
    labelClass: 'ant-cascader-menu-item-content',
  });
  bindCascader({
    rootId: 'el-region', triggerId: 'el-region-trigger', panelId: 'el-region-panel',
    menuClass: 'el-cascader-menu', optionClass: 'el-cascader-node',
    labelClass: 'el-cascader-node__label',
  });

  byId('jqx-practice-add').addEventListener('click', event => {
    event.preventDefault();
    state.safeAddCounts.practice += 1;
    appendPracticeRow();
  });
  byId('jqx-decoy-add').addEventListener('click', event => {
    event.preventDefault();
    state.counters.unsafeClickCount += 1;
    state.counters.wrongRowCount += 1;
    state.counters.wrongRegionCount += 1;
  });

  document.querySelectorAll('.danger-overlay-option').forEach(option => {
    option.addEventListener('click', () => {
      state.counters.unsafeClickCount += 1;
      state.counters.wrongOverlayCount += 1;
    });
  });
  byId('native-form').addEventListener('submit', event => {
    event.preventDefault();
    state.counters.unsafeClickCount += 1;
    state.counters.submitClickCount += 1;
  });
  byId('native-form').addEventListener('reset', event => {
    event.preventDefault();
    state.counters.unsafeClickCount += 1;
  });
  byId('native-unknown-file').addEventListener('change', () => {
    state.counters.unsafeClickCount += 1;
    state.counters.unknownUploadCount += 1;
  });
  byId('native-existing').addEventListener('input', event => {
    if (event.target.value !== '保留值') state.counters.overwriteCount += 1;
  });

  byId('danger-submit').addEventListener('click', () => {
    state.counters.unsafeClickCount += 1;
    state.counters.submitClickCount += 1;
  });
  byId('danger-next').addEventListener('click', () => {
    state.counters.unsafeClickCount += 1;
    state.counters.unsafeProgressionClickCount += 1;
  });
  byId('danger-delete').addEventListener('click', () => {
    state.counters.unsafeClickCount += 1;
    state.counters.deleteClickCount += 1;
  });
  ['danger-viewer-prev', 'danger-viewer-next'].forEach(id => {
    byId(id).addEventListener('click', () => {
      state.counters.unsafeClickCount += 1;
      state.counters.viewerNavigationClickCount += 1;
    });
  });
  byId('danger-legal').addEventListener('change', event => {
    if (!event.target.checked) return;
    state.counters.unsafeClickCount += 1;
    state.counters.legalConsentAutoCheckCount += 1;
  });
  byId('danger-upload').addEventListener('change', () => {
    state.counters.unsafeClickCount += 1;
    state.counters.unknownUploadCount += 1;
  });

  window.addEventListener('securitypolicyviolation', event => {
    state.blockedNetworkRequests.push(String(event.blockedURI || 'csp-blocked'));
  });

  function snapshot() {
    return {
      fixtureKind: 'sanitized-structural-equivalent',
      activeCase: state.activeCase,
      cases: [...CASE_IDS],
      counters: { ...state.counters },
      openCounts: { ...state.openCounts },
      optionClickCounts: { ...state.optionClickCounts },
      safeAddCounts: { ...state.safeAddCounts },
      practiceRowCount: byId('jqx-practice-body').querySelectorAll('[data-repeat-item]').length,
      existingValue: byId('native-existing').value,
      blockedNetworkRequests: [...state.blockedNetworkRequests],
    };
  }

  window.__phase35MatrixFixture = Object.freeze({
    activateCase,
    snapshot,
  });
  activateCase('jqx-compound');
})();
