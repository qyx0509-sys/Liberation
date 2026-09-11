(function initializeTongjiLikeFixture() {
  'use strict';

  const sectionLabels = Object.freeze({
    basic: '基本信息',
    family: '家庭主要成员',
    education: '学习信息',
    language: '外语水平',
    skills: '计算机水平',
    internship: '学习和工作经历',
    research: '学术成果',
    awards: '奖励或处分（本科期间）',
    application: '申请信息',
    recommenders: '推荐人信息维护',
    upload_photo: '上传照片',
    upload_materials: '上传材料',
  });
  const state = {
    currentSection: 'basic',
    navigation: [],
    addFamilyClicks: 0,
    pickerClicks: 0,
    frameworkEvents: [],
    attemptedSubmitClicks: 0,
    attemptedNetworkRequests: [],
    ready: false,
  };

  installNetworkTripwires();
  appendFamilyRow();
  wireNavigation();
  wireDynamicFamilyRows();
  wireFrameworkLikeState();
  wireCompoundPickers();
  document.getElementById('formal-submit-link').addEventListener('click', event => {
    event.preventDefault();
    state.attemptedSubmitClicks += 1;
  });
  document.getElementById('legacy-application-form').addEventListener('submit', event => {
    event.preventDefault();
    state.attemptedSubmitClicks += 1;
  });
  activateSection('basic', false);
  state.ready = true;
  document.documentElement.dataset.fixtureReady = 'true';
  document.getElementById('fixture-status').textContent = '同济风格脱敏夹具已就绪';

  window.__tongjiLikeFixture = Object.freeze({
    ready: Promise.resolve(true),
    activateSection,
    getSnapshot: snapshot,
  });

  function wireNavigation() {
    document.querySelectorAll('[data-fixture-section]').forEach(control => {
      control.addEventListener('click', event => {
        event.preventDefault();
        const section = control.dataset.fixtureSection;
        if (!Object.hasOwn(sectionLabels, section)) return;
        history.pushState({ section }, '', control.dataset.route || `#${section}`);
        state.navigation.push(section);
        activateSection(section, true);
      });
    });
  }

  function wireDynamicFamilyRows() {
    document.getElementById('add-family-row').addEventListener('click', event => {
      event.preventDefault();
      state.addFamilyClicks += 1;
      // 模拟旧站点/React 在事件循环后异步渲染新行。
      setTimeout(() => appendFamilyRow(), 35);
    });
  }

  function appendFamilyRow() {
    const body = document.getElementById('family-body');
    const index = body.children.length;
    const row = document.createElement('tr');
    row.dataset.repeatItem = 'family';
    row.dataset.familyIndex = String(index);
    ['name', 'relationship', 'employerPosition', 'phone'].forEach(field => {
      const cell = document.createElement('td');
      const input = document.createElement('input');
      input.id = `family-${index}-${field}`;
      input.name = `family[${index}].${field}`;
      input.autocomplete = 'off';
      cell.append(input);
      row.append(cell);
    });
    body.append(row);
    return row;
  }

  function wireFrameworkLikeState() {
    document.getElementById('application-content').addEventListener('input', captureFrameworkEvent, true);
    document.getElementById('application-content').addEventListener('change', captureFrameworkEvent, true);
  }

  function captureFrameworkEvent(event) {
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement)) return;
    state.frameworkEvents.push({
      type: event.type,
      id: target.id || target.name || '',
      value: String(target.value ?? ''),
    });
  }

  function wireCompoundPickers() {
    document.querySelectorAll('[data-picker]').forEach(button => {
      button.addEventListener('click', event => {
        event.preventDefault();
        state.pickerClicks += 1;
      });
    });
  }

  function activateSection(section, announce) {
    if (!Object.hasOwn(sectionLabels, section)) return false;
    state.currentSection = section;
    document.querySelectorAll('[data-nav-row]').forEach(item => item.classList.remove('active'));
    const activeControl = document.querySelector(`[data-fixture-section="${section}"]`);
    activeControl?.closest('[data-nav-row]')?.classList.add('active');

    const basic = document.getElementById('section-basic');
    const family = document.getElementById('section-family');
    const education = document.getElementById('section-education');
    const placeholder = document.getElementById('section-placeholder');
    basic.hidden = section !== 'basic';
    family.hidden = section !== 'family';
    education.hidden = section !== 'education';
    const hasDedicatedFixture = ['basic', 'family', 'education'].includes(section);
    placeholder.hidden = hasDedicatedFixture;
    if (!hasDedicatedFixture) document.getElementById('placeholder-caption').textContent = sectionLabels[section];
    if (announce) document.getElementById('fixture-status').textContent = `已切换到${sectionLabels[section]}`;
    return true;
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
    if ('WebSocket' in window) window.WebSocket = function BlockedWebSocket(url) { throw capture('WebSocket', url); };
    if ('EventSource' in window) window.EventSource = function BlockedEventSource(url) { throw capture('EventSource', url); };
  }

  function snapshot() {
    return {
      currentSection: state.currentSection,
      navigation: [...state.navigation],
      addFamilyClicks: state.addFamilyClicks,
      familyRows: [...document.querySelectorAll('#family-body [data-repeat-item]')].map(row => ({
        name: row.querySelector('[name$=".name"]')?.value || '',
        relationship: row.querySelector('[name$=".relationship"]')?.value || '',
        employerPosition: row.querySelector('[name$=".employerPosition"]')?.value || '',
        phone: row.querySelector('[name$=".phone"]')?.value || '',
      })),
      education: {
        school: document.getElementById('education-school').value,
        college: document.getElementById('education-college').value,
        major: document.getElementById('education-major').value,
        enrollmentDate: document.getElementById('education-enrollment').value,
        graduationDate: document.getElementById('education-graduation').value,
        studentId: document.getElementById('education-student-id').value,
        gpa: document.getElementById('education-gpa').value,
        percentageScore: document.getElementById('education-percentage').value,
      },
      pickerClicks: state.pickerClicks,
      frameworkEvents: state.frameworkEvents.map(item => ({ ...item })),
      attemptedSubmitClicks: state.attemptedSubmitClicks,
      attemptedNetworkRequests: state.attemptedNetworkRequests.map(item => ({ ...item })),
      ready: state.ready,
    };
  }
})();
