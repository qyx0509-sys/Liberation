(function initializeWizardFixture() {
  'use strict';

  const sectionLabels = Object.freeze({
    basic: '基本信息',
    education: '学习信息',
    awards: '奖励或处分',
    research: '科研成果',
  });
  const state = {
    currentSection: 'basic',
    navigation: [],
    events: [],
    framework: {},
    directSetters: {},
    awardRows: [],
    attemptedNetworkRequests: [],
    actions: {
      addAward: 0,
      deleteAward: 0,
      previous: 0,
      next: 0,
      safeSave: 0,
      saveNext: 0,
      finalSubmit: 0,
      fileInput: 0,
      fileChange: 0,
    },
    ready: false,
  };
  const params = new URLSearchParams(location.search);
  const addDelay = Math.max(0, Math.min(800, Number.parseInt(params.get('addDelay') || '70', 10) || 0));

  installNetworkTripwires();
  wireNavigation();
  wireStaticControls();
  appendAwardRow();
  activateSection(normalizeSection(location.hash.slice(1)) || 'basic', false);

  state.ready = true;
  document.documentElement.dataset.fixtureReady = 'true';
  document.getElementById('fixture-status').textContent = '本地多栏目测试夹具已就绪';

  window.__jiefangFixture = Object.freeze({
    ready: Promise.resolve(true),
    getSnapshot: snapshot,
    appendAwardRow,
    activateSection,
  });

  function normalizeSection(value) {
    return Object.hasOwn(sectionLabels, value) ? value : '';
  }

  function wireNavigation() {
    document.querySelectorAll('[data-fixture-section]').forEach(link => {
      link.addEventListener('click', event => {
        event.preventDefault();
        const section = normalizeSection(link.dataset.fixtureSection);
        state.navigation.push(section);
        history.pushState({ section }, '', `#${section}`);
        activateSection(section, true);
      });
    });
    window.addEventListener('popstate', () => activateSection(normalizeSection(location.hash.slice(1)) || 'basic', true));
  }

  function activateSection(section, announce) {
    const next = normalizeSection(section);
    if (!next) return false;
    state.currentSection = next;
    document.querySelectorAll('[data-fixture-section]').forEach(link => {
      link.setAttribute('aria-selected', String(link.dataset.fixtureSection === next));
    });
    document.querySelectorAll('.wizard-section').forEach(panel => {
      panel.hidden = panel.dataset.section !== next;
    });
    document.getElementById('breadcrumb').textContent = `申请信息 / ${sectionLabels[next]}`;
    if (announce) document.getElementById('fixture-status').textContent = `已切换到${sectionLabels[next]}`;
    return true;
  }

  function wireStaticControls() {
    const tracked = [
      ['applicant-name', 'basic.name'],
      ['applicant-phone', 'contact.phone'],
      ['applicant-birthday', 'basic.birthday'],
      ['education-school', 'education.school'],
      ['education-major', 'education.major'],
      ['education-level', 'education.level'],
      ['research-name', 'research.name'],
    ];
    tracked.forEach(([id, key]) => installFrameworkBinding(document.getElementById(id), key, 'value'));
    installFrameworkBinding(document.getElementById('gender-male'), 'basic.gender', 'checked');
    installFrameworkBinding(document.getElementById('gender-female'), 'basic.gender', 'checked');

    document.getElementById('add-award').addEventListener('click', () => {
      state.actions.addAward += 1;
      setTimeout(() => appendAwardRow(), addDelay);
    });
    document.getElementById('previous').addEventListener('click', () => { state.actions.previous += 1; });
    document.getElementById('next').addEventListener('click', () => { state.actions.next += 1; });
    document.getElementById('safe-save').addEventListener('click', () => { state.actions.safeSave += 1; });
    document.getElementById('save-next').addEventListener('click', () => { state.actions.saveNext += 1; });
    document.getElementById('submit-form').addEventListener('submit', event => {
      event.preventDefault();
      state.actions.finalSubmit += 1;
    });
    const fileInput = document.getElementById('research-file');
    fileInput.addEventListener('input', () => { state.actions.fileInput += 1; });
    fileInput.addEventListener('change', () => { state.actions.fileChange += 1; });
  }

  function appendAwardRow(initial = {}) {
    const index = state.awardRows.length;
    const row = document.createElement('div');
    row.className = 'award-row';
    row.dataset.repeatItem = '';
    row.dataset.awardIndex = String(index);

    const nameItem = document.createElement('div');
    nameItem.className = 'form-item';
    const nameLabel = document.createElement('label');
    const nameId = `award-name-${index}`;
    nameLabel.htmlFor = nameId;
    nameLabel.textContent = '获奖名称';
    const name = document.createElement('input');
    name.id = nameId;
    name.name = `opaque_award_${index}_name`;
    name.value = String(initial.name || '');
    nameItem.append(nameLabel, name);

    const dateItem = document.createElement('div');
    dateItem.className = 'form-item';
    const dateLabel = document.createElement('label');
    const dateId = `award-date-${index}`;
    dateLabel.htmlFor = dateId;
    dateLabel.textContent = '获奖时间';
    const date = document.createElement('input');
    date.id = dateId;
    date.name = `opaque_award_${index}_date`;
    date.placeholder = 'YYYY-MM';
    date.value = String(initial.date || '');
    dateItem.append(dateLabel, date);

    const remove = document.createElement('button');
    remove.className = 'delete-award';
    remove.type = 'button';
    remove.textContent = '删除';
    remove.addEventListener('click', () => {
      state.actions.deleteAward += 1;
      row.remove();
    });

    row.append(nameItem, dateItem, remove);
    document.getElementById('award-list').appendChild(row);
    const record = { index, row, name, date };
    state.awardRows.push(record);
    installFrameworkBinding(name, `awards.${index}.name`, 'value');
    installFrameworkBinding(date, `awards.${index}.date`, 'value');
    return row;
  }

  function installFrameworkBinding(element, key, property) {
    const prototype = element.constructor.prototype;
    const nativeDescriptor = Object.getOwnPropertyDescriptor(prototype, property);
    if (nativeDescriptor?.get && nativeDescriptor?.set) {
      Object.defineProperty(element, property, {
        configurable: true,
        enumerable: true,
        get() { return nativeDescriptor.get.call(this); },
        set(value) {
          state.directSetters[key] = (state.directSetters[key] || 0) + 1;
          nativeDescriptor.set.call(this, value);
        },
      });
    }
    for (const type of ['focus', 'pointerdown', 'mousedown', 'click', 'input', 'change', 'blur']) {
      element.addEventListener(type, event => {
        state.events.push({ key, type, bubbles: event.bubbles });
        if (type === 'input' || type === 'change') {
          if (property === 'checked') {
            if (element.checked) state.framework[key] = element.value;
          } else {
            state.framework[key] = element.value;
          }
        }
      });
    }
  }

  function installNetworkTripwires() {
    const capture = (kind, url) => {
      state.attemptedNetworkRequests.push({ kind, url: String(url || '') });
      return new Error(`测试夹具禁止网络请求：${kind}`);
    };
    window.fetch = (...args) => Promise.reject(capture('fetch', args[0]));
    navigator.sendBeacon = url => { throw capture('sendBeacon', url); };
    XMLHttpRequest.prototype.open = function blockedOpen(method, url) {
      throw capture(`XMLHttpRequest:${method}`, url);
    };
    if ('WebSocket' in window) {
      window.WebSocket = function BlockedWebSocket(url) { throw capture('WebSocket', url); };
    }
    if ('EventSource' in window) {
      window.EventSource = function BlockedEventSource(url) { throw capture('EventSource', url); };
    }
  }

  function snapshot() {
    const fileInput = document.getElementById('research-file');
    return {
      currentSection: state.currentSection,
      navigation: [...state.navigation],
      events: state.events.map(event => ({ ...event })),
      framework: { ...state.framework },
      directSetters: { ...state.directSetters },
      actions: { ...state.actions },
      awardRows: state.awardRows.filter(record => record.row.isConnected).map(record => ({
        index: record.index,
        name: record.name.value,
        date: record.date.value,
      })),
      files: [...fileInput.files].map(file => ({ name: file.name, size: file.size, type: file.type })),
      attemptedNetworkRequests: state.attemptedNetworkRequests.map(item => ({ ...item })),
      siteSearch: document.getElementById('site-search').value,
      ready: state.ready,
    };
  }
})();
