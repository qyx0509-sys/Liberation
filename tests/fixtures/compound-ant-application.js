(() => {
  'use strict';
  const counters = {
    draft: 0,
    next: 0,
    submit: 0,
    addPaper: 0,
    addAward: 0,
    deleteAward: 0,
    viewerPrevious: 0,
    viewerNext: 0,
  };
  const dateTriggerClicks = { birthday: 0, enrollment: 0, graduation: 0 };
  const customSelectOpenClicks = { idType: 0, gender: 0, political: 0, ethnicity: 0, marital: 0 };
  const customSelectOptionClicks = { idType: 0, gender: 0, political: 0, ethnicity: 0, marital: 0 };
  const customSelectKeys = {
    'id-type': 'idType', gender: 'gender', political: 'political', ethnicity: 'ethnicity', marital: 'marital',
  };
  const cascaderTriggerClicks = { hometown: 0, birthplace: 0, household: 0, archive: 0 };
  const cascaderOptionClicks = {
    hometown: [0, 0, 0],
    birthplace: [0, 0, 0],
    household: [0, 0, 0],
    archive: [0, 0, 0],
  };
  const cascaderConfigs = Object.freeze({
    'hometown-cascader': Object.freeze({ key: 'hometown', panelId: 'hometown-cascader-panel' }),
    'birthplace-region-cascader': Object.freeze({ key: 'birthplace', panelId: 'birthplace-region-cascader-panel' }),
    'household-region-cascader': Object.freeze({ key: 'household', panelId: 'household-region-cascader-panel' }),
    'archive-region-cascader': Object.freeze({ key: 'archive', panelId: 'archive-region-cascader-panel' }),
  });
  const cascaderVocabulary = Object.freeze({
    山东省: Object.freeze({ 青岛市: Object.freeze(['市北区', '市南区']), 济南市: Object.freeze(['历下区', '市中区']) }),
    浙江省: Object.freeze({ 杭州市: Object.freeze(['西湖区', '滨江区']), 宁波市: Object.freeze(['海曙区', '鄞州区']) }),
    江苏省: Object.freeze({ 南京市: Object.freeze(['玄武区', '鼓楼区']), 苏州市: Object.freeze(['姑苏区', '吴中区']) }),
  });
  const cascaderSelections = new Map();
  let activeCascaderPanel = null;
  const paperJournalType = Object.freeze(['期刊论文', '会议论文', '专著']);
  const paperStatus = Object.freeze([
    ['published', '已发表'], ['accepted', '已录用'], ['underReview', '审稿中'],
    ['submitted', '投稿中'], ['inPress', 'in press'],
  ]);
  const paperAuthorRank = Object.freeze([['1', '第一作者'], ['2', '第二作者']]);
  const attemptedNetworkRequests = [];
  const form = document.getElementById('application-form');

  document.getElementById('draft').addEventListener('click', () => { counters.draft += 1; });
  document.getElementById('next-step').addEventListener('click', () => { counters.next += 1; });
  function createSelect(label, entries) {
    const select = document.createElement('select');
    select.setAttribute('aria-label', label);
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = '请选择';
    select.append(placeholder);
    entries.forEach(entry => {
      const [value, text] = Array.isArray(entry) ? entry : [entry, entry];
      const option = document.createElement('option');
      option.value = value;
      option.textContent = text;
      select.append(option);
    });
    return select;
  }

  function createPaperRow() {
    const row = document.createElement('tr');
    const timeCell = document.createElement('td');
    const titleCell = document.createElement('td');
    const journalTypeCell = document.createElement('td');
    const journalCell = document.createElement('td');
    const statusCell = document.createElement('td');
    const authorRankCell = document.createElement('td');
    const paperTime = document.createElement('input');
    paperTime.type = 'text';
    paperTime.setAttribute('aria-label', '时间');
    timeCell.append(paperTime);
    const paperTitle = document.createElement('input');
    paperTitle.type = 'text';
    paperTitle.setAttribute('aria-label', '成果名称');
    titleCell.append(paperTitle);
    journalTypeCell.append(createSelect('期刊类型', paperJournalType));
    const paperJournal = document.createElement('input');
    paperJournal.type = 'text';
    paperJournal.setAttribute('aria-label', '期刊名称');
    journalCell.append(paperJournal);
    statusCell.append(createSelect('发表状态', paperStatus));
    authorRankCell.append(createSelect('作者排名', paperAuthorRank));
    row.append(timeCell, titleCell, journalTypeCell, journalCell, statusCell, authorRankCell);
    return row;
  }

  function createAwardRow() {
    const row = document.createElement('tr');
    row.setAttribute('data-award-row', '');
    const levelCell = document.createElement('td');
    const rankCell = document.createElement('td');
    const nameCell = document.createElement('td');
    const participationCell = document.createElement('td');
    const individualRankCell = document.createElement('td');
    const actionCell = document.createElement('td');
    levelCell.append(createSelect('竞赛级别', ['国家级', '省级', '校级']));
    rankCell.append(createSelect('获奖等级', ['一等奖', '二等奖', '三等奖']));
    const name = document.createElement('input');
    name.type = 'text';
    name.setAttribute('aria-label', '获奖名称');
    nameCell.append(name);
    participationCell.append(createSelect('个人/团队', ['个人', '团队']));
    const individualRank = document.createElement('input');
    individualRank.type = 'text';
    individualRank.setAttribute('aria-label', '个人排名');
    individualRankCell.append(individualRank);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'delete-award';
    remove.textContent = '删除';
    actionCell.append(remove);
    row.append(levelCell, rankCell, nameCell, participationCell, individualRankCell, actionCell);
    return row;
  }

  document.getElementById('add-paper').addEventListener('click', () => {
    counters.addPaper += 1;
    document.querySelector('#papers-table tbody').append(createPaperRow());
  });
  document.getElementById('add-competition-award').addEventListener('click', () => {
    counters.addAward += 1;
    document.querySelector('#competition-awards-table tbody').append(createAwardRow());
  });
  document.getElementById('competition-awards-table').addEventListener('click', event => {
    const remove = event.target.closest('.delete-award');
    if (!remove) return;
    counters.deleteAward += 1;
    remove.closest('tr')?.remove();
  });
  const viewerButtons = document.querySelectorAll('#image-viewer button');
  viewerButtons[0].addEventListener('click', () => { counters.viewerPrevious += 1; });
  viewerButtons[1].addEventListener('click', () => { counters.viewerNext += 1; });
  form.addEventListener('submit', event => {
    event.preventDefault();
    counters.submit += 1;
  });

  document.querySelectorAll('[data-ant-select="true"][aria-controls]').forEach(trigger => {
    trigger.addEventListener('click', () => {
      const controlled = document.getElementById(trigger.getAttribute('aria-controls'));
      if (!controlled) return;
      document.querySelectorAll('.ant-select-dropdown[role="listbox"]').forEach(listbox => {
        listbox.hidden = listbox !== controlled;
      });
      trigger.setAttribute('aria-expanded', 'true');
      controlled.hidden = false;
      const key = customSelectKeys[trigger.id];
      if (key) customSelectOpenClicks[key] += 1;
    });
  });

  document.querySelectorAll('.ant-select-dropdown[role="listbox"]').forEach(listbox => {
    listbox.addEventListener('click', event => {
      const option = event.target.closest('[role="option"]');
      if (!option || !listbox.contains(option)) return;
      const triggerId = listbox.id.replace(/-listbox$/, '');
      const trigger = document.getElementById(triggerId);
      if (!trigger) return;
      const value = option.getAttribute('data-value') || option.textContent.trim();
      const selected = trigger.querySelector('.ant-select-selection-item');
      if (selected) selected.textContent = value;
      trigger.setAttribute('data-value', value);
      trigger.setAttribute('aria-expanded', 'false');
      listbox.hidden = true;
      const key = customSelectKeys[triggerId];
      if (key) customSelectOptionClicks[key] += 1;
    });
  });

  function cascaderOption(value, level) {
    const option = document.createElement('li');
    option.className = 'ant-cascader-menu-item';
    option.setAttribute('role', 'menuitem');
    option.setAttribute('data-cascader-option', '');
    option.setAttribute('data-cascader-level', String(level));
    option.setAttribute('data-value', value);
    const label = document.createElement('span');
    label.className = 'ant-cascader-menu-item-content';
    label.textContent = value;
    option.append(label);
    return option;
  }

  function cascaderMenu(panel, level, create = false) {
    const current = panel.querySelector(`[data-cascader-level="${level}"]`);
    if (current || !create) return current;
    const menu = document.createElement('ul');
    menu.id = `${panel.id}-level-${level}`;
    menu.className = 'ant-cascader-menu';
    menu.setAttribute('data-cascader-level', String(level));
    panel.append(menu);
    return menu;
  }

  function resetCascaderPanel(panel) {
    panel.querySelectorAll('.ant-cascader-menu[data-cascader-level]:not([data-cascader-level="0"])')
      .forEach(menu => menu.remove());
  }

  Object.entries(cascaderConfigs).forEach(([rootId, config]) => {
    const root = document.getElementById(rootId);
    const panel = document.getElementById(config.panelId);
    root.addEventListener('click', event => {
      if (event.target.closest('[data-cascader-option]')) return;
      document.querySelectorAll('.ant-cascader-menus').forEach(candidate => {
        candidate.hidden = candidate !== panel;
      });
      resetCascaderPanel(panel);
      panel.hidden = false;
      root.setAttribute('aria-expanded', 'true');
      cascaderSelections.set(panel, []);
      activeCascaderPanel = panel;
      cascaderTriggerClicks[config.key] += 1;
    });

    panel.addEventListener('click', event => {
      const option = event.target.closest('[data-cascader-option]');
      if (!option || !panel.contains(option) || activeCascaderPanel !== panel) return;
      const level = Number(option.getAttribute('data-cascader-level'));
      const value = option.getAttribute('data-value') || option.textContent.trim();
      const selection = cascaderSelections.get(panel) || [];
      selection.splice(level, selection.length - level, value);
      cascaderSelections.set(panel, selection);
      cascaderOptionClicks[config.key][level] += 1;

      if (level === 0) {
        panel.querySelectorAll('.ant-cascader-menu[data-cascader-level]:not([data-cascader-level="0"])')
          .forEach(menu => menu.remove());
        const cityMenu = cascaderMenu(panel, 1, true);
        const cities = Object.keys(cascaderVocabulary[value] || {});
        cityMenu.replaceChildren(...cities.map(city => cascaderOption(city, 1)));
        return;
      }
      if (level === 1) {
        cascaderMenu(panel, 2)?.remove();
        const districtMenu = cascaderMenu(panel, 2, true);
        const districts = cascaderVocabulary[selection[0]]?.[value] || [];
        districtMenu.replaceChildren(...districts.map(district => cascaderOption(district, 2)));
        return;
      }
      if (level === 2) {
        const displayValue = selection.join(' / ');
        const input = root.querySelector('.ant-cascader-input');
        const selected = root.querySelector('[data-cascader-selected-item]');
        input.value = displayValue;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        if (selected) selected.textContent = displayValue;
        root.setAttribute('data-value', displayValue);
        root.setAttribute('aria-expanded', 'false');
        panel.hidden = true;
        activeCascaderPanel = null;
      }
    });
  });

  document.querySelectorAll('.calendar-trigger[aria-controls]').forEach(button => {
    button.addEventListener('click', () => {
      const controlled = document.getElementById(button.getAttribute('aria-controls'));
      if (controlled) {
        const inputId = controlled.id.replace(/-panel$/, '');
        if (Object.hasOwn(dateTriggerClicks, inputId)) dateTriggerClicks[inputId] += 1;
        controlled.hidden = false;
      }
    });
  });

  const pad2 = value => String(value).padStart(2, '0');
  const panelInput = panel => document.getElementById(panel.dataset.calendarInput || '');
  const panelOverlay = panel => panel.closest('.ant-calendar-picker-container');
  const calendarTransitionStates = new Map(
    ['birthday', 'enrollment', 'graduation'].map(inputId => [inputId, {
      strategy: document.getElementById(inputId)?.dataset.calendarTransition || '',
      generation: 0,
      mode: 'DAY',
    }]),
  );

  function retireStaleCalendarPanels(overlay, keepPanel) {
    if (!overlay) return;
    overlay.querySelectorAll('.ant-calendar-date-panel[data-calendar-stale="true"]').forEach(stale => {
      if (stale === keepPanel) return;
      stale.hidden = true;
      stale.setAttribute('aria-hidden', 'true');
      stale.remove();
    });
  }

  function scheduleCalendarRetirement(overlay, keepPanel) {
    window.setTimeout(() => retireStaleCalendarPanels(overlay, keepPanel), 70);
  }

  function replaceCalendarPanel(panel, targetMode) {
    const oldOverlay = panelOverlay(panel);
    if (!oldOverlay) return panel;
    const replacement = oldOverlay.cloneNode(true);
    replacement.hidden = false;
    replacement.removeAttribute('aria-hidden');
    replacement.dataset.calendarMode = targetMode;
    const panels = [...replacement.querySelectorAll('.ant-calendar-date-panel[data-calendar-input]')];
    const nextPanel = panels.find(candidate => candidate.dataset.calendarInput === panel.dataset.calendarInput) || panels[0];
    if (!nextPanel) return panel;
    nextPanel.dataset.calendarMode = targetMode;
    nextPanel.dataset.calendarStale = 'false';
    delete nextPanel.dataset.calendarBound;
    nextPanel.hidden = false;
    nextPanel.removeAttribute('aria-hidden');
    oldOverlay.replaceWith(replacement);
    bindCalendarPanel(nextPanel);
    renderCalendar(nextPanel);
    return nextPanel;
  }

  function transitionCalendarPanel(panel, targetMode) {
    const inputId = panel.dataset.calendarInput || '';
    const state = calendarTransitionStates.get(inputId) || { strategy: '', generation: 0, mode: panel.dataset.calendarMode };
    state.generation += 1;
    state.mode = targetMode;
    calendarTransitionStates.set(inputId, state);
    if (state.strategy === 'modern-replacement') return replaceCalendarPanel(panel, targetMode);

    const overlay = panelOverlay(panel);
    const nextPanel = panel.cloneNode(true);
    panel.dataset.calendarStale = 'true';
    panel.classList.add('calendar-panel-stale');
    nextPanel.dataset.calendarMode = targetMode;
    nextPanel.dataset.calendarStale = 'false';
    delete nextPanel.dataset.calendarBound;
    nextPanel.classList.remove('calendar-panel-stale');
    nextPanel.hidden = false;
    nextPanel.removeAttribute('aria-hidden');
    panel.parentElement.append(nextPanel);
    if (overlay) overlay.dataset.calendarMode = targetMode;
    bindCalendarPanel(nextPanel);
    renderCalendar(nextPanel);
    scheduleCalendarRetirement(overlay, nextPanel);
    return nextPanel;
  }

  function calendarButton(text, attributes) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = text;
    button.setAttribute('role', attributes.role || 'gridcell');
    Object.entries(attributes)
      .filter(([name]) => name !== 'role')
      .forEach(([name, value]) => button.setAttribute(name, value));
    return button;
  }

  function renderCalendar(panel) {
    const grid = panel.querySelector('[data-calendar-grid]');
    const label = panel.querySelector('[data-calendar-label]');
    const yearLabel = panel.querySelector('[data-calendar-year-label]');
    const year = Number(panel.dataset.calendarYear);
    const month = Number(panel.dataset.calendarMonth || 1);
    const mode = panel.dataset.calendarMode;
    const cells = [];

    if (mode === 'YEAR') {
      const decade = Math.floor(year / 10) * 10;
      yearLabel.textContent = `${decade}-${decade + 9}`;
      label.textContent = '年份';
      for (let value = decade; value < decade + 10; value += 1) {
        cells.push(calendarButton(`${value}年`, {
          role: 'option',
          'data-calendar-year-option': String(value),
          'aria-label': `${value}年`,
        }));
      }
    } else if (mode === 'MONTH') {
      yearLabel.textContent = `${year}年`;
      label.textContent = '月份';
      for (let value = 1; value <= 12; value += 1) {
        cells.push(calendarButton(`${value}月`, {
          role: 'option',
          'data-calendar-month-option': String(value),
          'aria-label': `${value}月`,
        }));
      }
    } else if (mode === 'DAY') {
      yearLabel.textContent = `${year}年`;
      label.textContent = `${month}月`;
      for (const weekday of ['日', '一', '二', '三', '四', '五', '六']) {
        const heading = document.createElement('span');
        heading.setAttribute('role', 'columnheader');
        heading.setAttribute('data-calendar-weekday', weekday);
        heading.textContent = weekday;
        cells.push(heading);
      }
      const dayCount = new Date(year, month, 0).getDate();
      for (let value = 1; value <= dayCount; value += 1) {
        cells.push(calendarButton(String(value), {
          'data-calendar-day-option': String(value),
          'aria-label': `${year}年${month}月${value}日`,
        }));
      }
    }
    grid.replaceChildren(...cells);
  }

  function selectCalendarCell(panel, button) {
    const mode = panel.dataset.calendarMode;
    const year = Number(panel.dataset.calendarYear);
    const input = panelInput(panel);
    if (!input) return;

    if (mode === 'YEAR') {
      const selectedYear = Number(button.getAttribute('data-calendar-year-option'));
      if (!Number.isFinite(selectedYear)) return;
      panel.dataset.calendarYear = String(selectedYear);
      transitionCalendarPanel(panel, 'MONTH');
      return;
    }

    if (mode === 'MONTH') {
      const selectedMonth = Number(button.getAttribute('data-calendar-month-option'));
      if (!Number.isFinite(selectedMonth)) return;
      panel.dataset.calendarMonth = String(selectedMonth);
      if (panel.dataset.calendarInput === 'birthday') {
        transitionCalendarPanel(panel, 'DAY');
        return;
      }
      input.value = `${year}-${pad2(selectedMonth)}`;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      const overlay = panelOverlay(panel);
      if (overlay) overlay.hidden = true;
      return;
    }

    if (mode === 'DAY') {
      const selectedDay = Number(button.getAttribute('data-calendar-day-option'));
      const selectedMonth = Number(panel.dataset.calendarMonth);
      if (!Number.isFinite(selectedDay) || !Number.isFinite(selectedMonth)) return;
      input.value = `${year}-${pad2(selectedMonth)}-${pad2(selectedDay)}`;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      const overlay = panelOverlay(panel);
      if (overlay) overlay.hidden = true;
    }
  }

  function bindCalendarPanel(panel) {
    if (!panel || panel.dataset.calendarBound === 'true') return;
    panel.dataset.calendarBound = 'true';
    panel.addEventListener('click', event => {
      const control = event.target.closest('button,.ant-calendar-month-select,.ant-calendar-year-select');
      if (!control || !panel.contains(control)) return;
      const modeSwitch = control.getAttribute('data-calendar-mode-switch')
        || (control.classList.contains('ant-calendar-month-select') ? 'MONTH' : '')
        || (control.classList.contains('ant-calendar-year-select') ? 'YEAR' : '');
      if (modeSwitch === 'MONTH' || modeSwitch === 'YEAR') {
        transitionCalendarPanel(panel, modeSwitch);
        return;
      }
      const navigation = control.getAttribute('data-calendar-nav');
      if (navigation) {
        const amount = navigation.includes('decade') ? 10 : 1;
        const direction = navigation.startsWith('previous') ? -1 : 1;
        panel.dataset.calendarYear = String(Number(panel.dataset.calendarYear) + amount * direction);
        renderCalendar(panel);
        return;
      }
      selectCalendarCell(panel, control);
    });
  }

  document.querySelectorAll('.ant-calendar-date-panel[data-calendar-mode][data-calendar-input]').forEach(panel => {
    bindCalendarPanel(panel);
    renderCalendar(panel);
  });

  const originalFetch = window.fetch?.bind(window);
  window.fetch = (...args) => {
    attemptedNetworkRequests.push(String(args[0] || 'fetch'));
    return originalFetch ? originalFetch(...args) : Promise.reject(new Error('network disabled'));
  };
  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function open(method, url, ...rest) {
    attemptedNetworkRequests.push(String(url || 'xhr'));
    return originalOpen.call(this, method, url, ...rest);
  };

  window.__compoundAntFixture = Object.freeze({
    snapshot() {
      return {
        counters: { ...counters },
        dateTriggerClicks: { ...dateTriggerClicks },
        customSelectOpenClicks: { ...customSelectOpenClicks },
        customSelectOptionClicks: { ...customSelectOptionClicks },
        cascaderTriggerClicks: { ...cascaderTriggerClicks },
        cascaderOptionClicks: Object.fromEntries(
          Object.entries(cascaderOptionClicks).map(([key, values]) => [key, values.slice()]),
        ),
        attemptedNetworkRequests: attemptedNetworkRequests.slice(),
        familyRows: document.querySelectorAll('#family-table tbody tr').length,
        paperRows: document.querySelectorAll('#papers-table tbody tr').length,
        awardRows: document.querySelectorAll('#competition-awards-table tbody tr').length,
        calendarTransitionStates: Object.fromEntries(
          [...calendarTransitionStates.entries()].map(([key, value]) => [key, { ...value }]),
        ),
        calendarModes: Object.fromEntries(
          [...document.querySelectorAll('.ant-calendar-date-panel[data-calendar-mode][data-calendar-input]')]
            .map(panel => [`${panel.dataset.calendarInput}-panel`, panel.dataset.calendarMode]),
        ),
        nestedPanelCandidateCounts: Object.fromEntries(
          ['birthday-panel', 'enrollment-panel', 'graduation-panel'].map(id => {
            const overlay = document.getElementById(id);
            const selector = '[role="dialog"],[class*="date-picker"],[class*="datepicker"],[class*="month-picker"],[class*="monthpicker"],[class*="calendar"],[class*="picker-panel"]';
            return [id, 1 + overlay.querySelectorAll(selector).length];
          }),
        ),
      };
    },
  });
})();
