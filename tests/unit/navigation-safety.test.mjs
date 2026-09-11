import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const testDirectory = dirname(fileURLToPath(import.meta.url));
const root = resolve(testDirectory, '..', '..');
const Safety = require(resolve(root, 'src', 'core', 'safety.js'));
const PageReady = require(resolve(root, 'src', 'core', 'page-ready.js'));
const Navigation = require(resolve(root, 'src', 'core', 'navigation-engine.js'));
const TaskState = require(resolve(root, 'src', 'core', 'task-state.js'));
const Reports = require(resolve(root, 'src', 'core', 'report-manager.js'));
const Save = require(resolve(root, 'src', 'core', 'save-handler.js'));
const Events = require(resolve(root, 'src', 'core', 'event-dispatcher.js'));

function fakeElement({
  text = '', tagName = 'BUTTON', type = 'button', href = '', formAction = '', role = '',
  declaredType = type, onclick = '', dataStep = '', dataSection = '', id = '', name = '',
  disabled = false, hidden = false, inNavigation = false, inForm = false, extensionUi = false,
} = {}) {
  const form = inForm || formAction
    ? {
      action: formAction,
      method: 'post',
      getAttribute(name) { return name === 'action' ? formAction : name === 'method' ? 'post' : ''; },
    }
    : null;
  const element = {
    tagName,
    type,
    textContent: text,
    value: tagName === 'INPUT' ? text : '',
    href,
    id,
    name,
    form,
    disabled,
    hidden,
    isConnected: true,
    style: {},
    dataset: { step: dataStep, section: dataSection },
    parentElement: null,
    clickCount: 0,
    scrollCount: 0,
    getAttribute(name) {
      if (name === 'type') return declaredType;
      if (name === 'role') return role;
      if (name === 'href') return href;
      if (name === 'formaction') return formAction;
      if (name === 'onclick') return onclick;
      if (name === 'data-step') return dataStep;
      if (name === 'data-section') return dataSection;
      if (name === 'id') return id;
      if (name === 'name') return name;
      if (name === 'aria-hidden') return hidden ? 'true' : '';
      if (name === 'aria-disabled') return disabled ? 'true' : '';
      return '';
    },
    matches(selector) {
      if (selector.includes(':disabled')) return disabled;
      if (selector.includes('input[type="hidden"]')) return tagName === 'INPUT' && type === 'hidden';
      return false;
    },
    closest(selector) {
      if (selector === 'form') return form;
      if (selector.includes('#__jf_panel__')) return extensionUi ? this : null;
      if (selector.includes('[aria-current="page"]')) return this.active ? this : null;
      if (inNavigation && selector.includes('[role="navigation"]')) return this.navRoot;
      return null;
    },
    click() { this.clickCount += 1; },
    scrollIntoView() { this.scrollCount += 1; },
  };
  return element;
}

function attachDocument(elements, { url = 'https://school.test/apply/awards' } = {}) {
  const navRoot = {
    nodeType: 1,
    querySelectorAll() { return elements; },
  };
  const body = { nodeType: 1, getElementsByTagName() { return elements; } };
  const document = {
    nodeType: 9,
    title: '高校申请系统',
    location: { href: url },
    body,
    documentElement: { nodeType: 1, childElementCount: elements.length },
    defaultView: {
      getComputedStyle() { return { display: 'block', visibility: 'visible', opacity: '1' }; },
      requestAnimationFrame(callback) { return setTimeout(() => callback(Date.now()), 4); },
      cancelAnimationFrame(handle) { clearTimeout(handle); },
    },
    querySelectorAll(selector) {
      if (selector === Navigation.NAV_CONTAINER_SELECTOR) return [navRoot];
      if (selector === Save.SAVE_CONTROL_SELECTOR) return elements;
      if (selector === '.configured-target') return elements;
      return [];
    },
    querySelector() { return null; },
  };
  for (const element of elements) {
    element.ownerDocument = document;
    element.navRoot = navRoot;
  }
  return document;
}

function attachTongjiStyleDocument(items, { url = 'https://school.test/apply/home' } = {}) {
  const contains = function contains(element) {
    let current = element;
    while (current) {
      if (current === this) return true;
      current = current.parentElement;
    }
    return false;
  };
  const body = {
    tagName: 'BODY', parentElement: null, contains, closest() { return null; },
  };
  const sidebar = {
    tagName: 'DIV', className: 'apply-step-box', parentElement: body, contains,
    getAttribute() { return ''; }, matches() { return false; }, closest() { return null; },
  };
  const documentElement = {
    tagName: 'HTML', parentElement: null, childElementCount: items.length, contains,
    closest() { return null; },
  };
  const document = {
    nodeType: 9,
    title: '研究生报考服务系统',
    location: { href: url, origin: new URL(url).origin },
    body,
    documentElement,
    defaultView: {
      getComputedStyle() { return { display: 'block', visibility: 'visible', opacity: '1' }; },
      requestAnimationFrame(callback) { return setTimeout(() => callback(Date.now()), 4); },
      cancelAnimationFrame(handle) { clearTimeout(handle); },
    },
    querySelectorAll(selector) {
      if (selector === Navigation.NAV_CONTAINER_SELECTOR) return [];
      if (selector === Navigation.FALLBACK_NAV_ITEM_SELECTOR) return items;
      return [];
    },
    querySelector() { return null; },
  };

  items.forEach((element, index) => {
    const row = {
      tagName: 'DIV', className: 'apply-step-row', parentElement: sidebar, contains,
      active: index === 1,
      getAttribute() { return ''; },
      matches(selector) { return this.active && selector.includes('.active'); },
      closest(selector) { return this.matches(selector) ? this : null; },
    };
    element.parentElement = row;
    element.ownerDocument = document;
    element.contains = contains;
    element.matches = function matches(selector) {
      if (selector.includes(':disabled') || selector.includes('input[type="hidden"]')) return false;
      return Boolean(this.active && selector.includes('.active'));
    };
    element.closest = function closest(selector) {
      if (selector === 'form') return this.form || null;
      if (selector === Navigation.NAV_CONTAINER_SELECTOR || selector.includes('#__jf_panel__')) return null;
      let current = this;
      while (current) {
        if (current.matches?.(selector)) return current;
        current = current.parentElement;
      }
      return null;
    };
  });
  return { document, sidebar };
}

function moveCommonAncestorToDepth(items, sidebar, wrapperCount) {
  const contains = sidebar.contains;
  items.forEach(item => {
    let current = item.parentElement;
    for (let index = 0; index < wrapperCount; index += 1) {
      const wrapper = {
        tagName: 'DIV', parentElement: null, contains,
        getAttribute() { return ''; }, matches() { return false; }, closest() { return null; },
      };
      current.parentElement = wrapper;
      current = wrapper;
    }
    current.parentElement = sidebar;
  });
}

test('危险动作词为冻结的全局拒绝规则，保存并下一步/提交/上传均不可被配置放行', () => {
  assert.equal(Object.isFrozen(Safety.DANGEROUS_ACTION_KEYWORDS), true);
  for (const text of ['下一步', '保存并下一步', '保存并提交', '正式提交', '删除', '上传材料', 'Submit', 'Upload']) {
    const element = fakeElement({ text });
    attachDocument([element]);
    assert.equal(Safety.isDangerousAction(element, { baseUrl: 'https://school.test/apply' }), true, text);
    assert.equal(Safety.validateConfiguredCandidate(element, 'save', { baseUrl: 'https://school.test/apply' }), false, text);
  }
});

test('安全保存只接受精确白名单，并复核控件类型、跨域/危险 form action', () => {
  const valid = fakeElement({ text: '保存', type: 'button' });
  const draft = fakeElement({ text: '暂存', type: 'submit', formAction: 'https://school.test/apply/save' });
  const submitAction = fakeElement({ text: '保存', type: 'submit', formAction: 'https://school.test/apply/submit' });
  const crossOrigin = fakeElement({ text: '保存本页', type: 'submit', formAction: 'https://evil.test/collect' });
  const fileInput = fakeElement({ text: '保存', tagName: 'INPUT', type: 'file' });
  [valid, draft, submitAction, crossOrigin, fileInput].forEach(element => attachDocument([element]));
  const options = { baseUrl: 'https://school.test/apply/page' };
  assert.equal(Safety.isSafeSaveCandidate(valid, options), true);
  assert.equal(Safety.isSafeSaveCandidate(draft, options), false);
  assert.equal(Safety.isSafeSaveCandidate(submitAction, options), false);
  assert.equal(Safety.isSafeSaveCandidate(crossOrigin, options), false);
  assert.equal(Safety.isSafeSaveCandidate(fileInput, options), false);
});

test('配置新增行按钮仍须匹配新增文字、type=button、区域与 form action', () => {
  const region = { contains: element => element.insideRegion === true };
  const valid = fakeElement({ text: '新增一行', type: 'button' });
  valid.insideRegion = true;
  const submitType = fakeElement({ text: '新增一行', type: 'submit', inForm: true });
  submitType.insideRegion = true;
  const wrongText = fakeElement({ text: '保存', type: 'button' });
  wrongText.insideRegion = true;
  const outside = fakeElement({ text: '新增一行', type: 'button' });
  outside.insideRegion = false;
  const navigationLink = fakeElement({ text: '新增一行', tagName: 'A', href: '/apply/next', role: 'button' });
  navigationLink.insideRegion = true;
  const extensionButton = fakeElement({ text: '新增一行', extensionUi: true });
  extensionButton.insideRegion = true;
  [valid, submitType, wrongText, outside, navigationLink, extensionButton].forEach(element => attachDocument([element]));
  const options = { baseUrl: 'https://school.test/apply', region };
  assert.equal(Safety.validateConfiguredCandidate(valid, 'add-row', options), true);
  assert.equal(Safety.validateConfiguredCandidate(submitType, 'add-row', options), false);
  assert.equal(Safety.validateConfiguredCandidate(wrongText, 'add-row', options), false);
  assert.equal(Safety.validateConfiguredCandidate(outside, 'add-row', options), false);
  assert.equal(Safety.validateConfiguredCandidate(navigationLink, 'add-row', options), false);
  assert.equal(Safety.validateConfiguredCandidate(extensionButton, 'add-row', options), false);
  assert.equal(Safety.validateConfiguredCandidate(wrongText, 'add-row', { ...options, allowedTextPattern: /保存/ }), false, '配置正则不能改写内置新增语义');
});

test('导航容器支持原生 li 和语义 button，允许 form 内非提交 tab 并去重 li 内链接', () => {
  const nestedLink = fakeElement({ text: '基本信息', tagName: 'A', href: '/apply/basic', inNavigation: true });
  const wrapperLi = fakeElement({ text: '基本信息', tagName: 'LI', inNavigation: true });
  wrapperLi.contains = element => element === nestedLink;
  nestedLink.parentElement = wrapperLi;
  const tabButton = fakeElement({ text: '奖励情况', tagName: 'BUTTON', role: 'tab', inNavigation: true });
  const formTabButton = fakeElement({ text: '教育经历', tagName: 'BUTTON', role: 'tab', inNavigation: true, inForm: true });
  const rawButton = fakeElement({ text: '联系方式', tagName: 'BUTTON', inNavigation: true });
  const rawButtonLi = fakeElement({ text: '联系方式', tagName: 'LI', inNavigation: true });
  rawButtonLi.contains = element => element === rawButton;
  rawButton.parentElement = rawButtonLi;
  const parent = {};
  wrapperLi.parentElement = parent;
  rawButtonLi.parentElement = parent;
  tabButton.parentElement = parent;
  formTabButton.parentElement = parent;
  const document = attachDocument([wrapperLi, nestedLink, rawButtonLi, rawButton, tabButton, formTabButton]);
  const engine = Navigation.createNavigationEngine({ document });
  const scan = engine.scan();
  const basics = scan.filter(item => item.sectionId === 'basic');
  assert.equal(basics.length, 1, 'li 与内部 a 只能形成一个栏目句柄');
  assert.notEqual(basics[0].reasonCode, 'AMBIGUOUS_SECTION');
  assert.equal(scan.find(item => item.sectionId === 'awards')?.safe, true);
  assert.equal(scan.filter(item => item.sectionId === 'contact').length, 1);
  assert.equal(scan.find(item => item.sectionId === 'contact')?.safe, true, '无语义 button 不可执行，但其导航 li 仍可识别');
  assert.equal(scan.find(item => item.sectionId === 'education')?.safe, true);
  assert.equal(formTabButton.clickCount, 0);
  engine.destroy();
});

test('未声明 type 的导航 button 仅在 form 外且带明确栏目语义时允许', () => {
  const outsideImplicit = fakeElement({
    text: '联系方式', tagName: 'BUTTON', type: 'submit', declaredType: '', role: 'tab', inNavigation: true,
  });
  const insideImplicit = fakeElement({
    text: '学习信息', tagName: 'BUTTON', type: 'submit', declaredType: '', role: 'tab', inNavigation: true, inForm: true,
  });
  const explicitSubmit = fakeElement({
    text: '奖励情况', tagName: 'BUTTON', type: 'submit', declaredType: 'submit', role: 'menuitem', inNavigation: true,
  });
  const document = attachDocument([outsideImplicit, insideImplicit, explicitSubmit]);
  const engine = Navigation.createNavigationEngine({ document });
  const detailed = engine.scanDetailed();
  assert.equal(detailed.items.find(item => item.sectionId === 'contact')?.safe, true);
  assert.equal(detailed.items.some(item => item.sectionId === 'education'), false);
  assert.equal(detailed.items.some(item => item.sectionId === 'awards'), false);
  assert.equal(detailed.candidates.find(item => item.semanticSection === 'education')?.rejectReason, 'FORM_ACTION_CONTROL_REJECTED');
  assert.equal(detailed.candidates.find(item => item.semanticSection === 'awards')?.rejectReason, 'FORM_ACTION_CONTROL_REJECTED');
  assert.equal(outsideImplicit.clickCount + insideImplicit.clickCount + explicitSubmit.clickCount, 0);
  engine.destroy();
});

test('同济式非标准侧栏按独立 a 节点识别，不把共同祖先合并成 other', async () => {
  const labels = [
    '申请须知', '基本信息', '家庭主要成员', '学习信息', '外语水平', '计算机水平',
    '学习和工作经历', '学术成果', '奖励或处分（本科期间）', '申请信息', '推荐人信息维护',
    '上传照片', '上传材料', '申请信息提交', '首页', '显示敏感信息',
  ];
  const items = labels.map(text => fakeElement({
    text,
    tagName: 'A',
    type: '',
    // 复现旧系统：普通栏目 a 没有 href；文件栏目为同源链接。
    href: text === '上传照片' ? '/apply/photo' : text === '上传材料' ? '/apply/materials' : '',
  }));
  const { document, sidebar } = attachTongjiStyleDocument(items);
  const engine = Navigation.createNavigationEngine({ document });
  const scan = engine.scan();
  const queue = engine.buildQueue(scan);
  const recognized = new Set(scan.map(item => item.sectionId));

  for (const sectionId of [
    'basic', 'family', 'education', 'language', 'skills', 'internship',
    'research', 'awards', 'application', 'recommenders', 'upload_photo', 'upload_materials',
  ]) assert.equal(recognized.has(sectionId), true, sectionId);

  assert.equal(scan.some(item => item.sectionId === 'other'), false);
  assert.equal(scan.some(item => item.text === sidebar.textContent), false, '共同祖先不能成为栏目句柄');
  assert.equal(scan.some(item => item.text === '申请信息提交'), false, '最终提交入口不得伪装成申请信息栏目');
  assert.equal(scan.find(item => item.sectionId === 'basic')?.active, true, 'active 行容器应只激活内部一个栏目');
  assert.equal(queue.length, 12);
  assert.equal(queue.find(item => item.sectionId === 'upload_photo')?.passiveOnly, false);
  assert.equal(queue.find(item => item.sectionId === 'upload_materials')?.passiveOnly, false);
  assert.equal(scan.find(item => item.sectionId === 'upload_photo')?.reasonCode, 'SAFE_UPLOAD_SECTION_NAVIGATION');

  const photo = items.find(item => item.textContent === '上传照片');
  photo.click = function click() {
    this.clickCount += 1;
    document.location.href = 'https://school.test/apply/photo';
  };
  const navigation = await engine.navigate('upload_photo', {
    userInitiated: true,
    confirmSectionId: 'upload_photo',
    timeoutMs: 500,
  });
  assert.equal(navigation.ok, true);
  assert.equal(photo.clickCount, 1, '只允许经过确认的同源文件栏目链接被点击');
  engine.destroy();
});

test('文件栏目只放行可信导航控件，不放行跨域链接或提交路径', () => {
  const baseItems = ['基本信息', '家庭主要成员', '学习信息'].map(text => fakeElement({
    text, tagName: 'A', type: '', href: '',
  }));
  const uploadButton = fakeElement({ text: '上传材料', tagName: 'BUTTON', role: 'menuitem' });
  const crossOrigin = fakeElement({ text: '上传照片', tagName: 'A', type: '', href: 'https://evil.test/photo' });
  const submitPath = fakeElement({ text: '上传材料', tagName: 'A', type: '', href: '/apply/submit' });
  const items = [...baseItems, uploadButton, crossOrigin, submitPath];
  const { document } = attachTongjiStyleDocument(items);
  const engine = Navigation.createNavigationEngine({ document });
  const detailed = engine.scanDetailed();
  const scan = detailed.items;

  assert.equal(Safety.isDangerousAction(uploadButton, { baseUrl: document.location.href }), true);
  const uploadNavigation = scan.find(item => item.text === '上传材料' && item.sectionId === 'upload_materials');
  assert.equal(uploadNavigation?.safe, true);
  assert.equal(uploadNavigation?.uploadNavigationOnly, true);
  assert.equal(uploadNavigation?.reasonCode, 'SAFE_UPLOAD_SECTION_NAVIGATION');
  assert.equal(scan.some(item => item.text === '上传照片'), false);
  assert.equal(detailed.candidates.some(item => item.semanticSection === 'upload_photo'
    && item.hrefType === 'cross-origin' && item.accepted === false && /DANGEROUS|UNSAFE/.test(item.rejectReason)), true);
  assert.equal(detailed.candidates.some(item => item.semanticSection === 'upload_materials'
    && item.accepted === false && /DANGEROUS|UNSAFE/.test(item.rejectReason)), true);
  const queue = engine.buildQueue(scan);
  assert.equal(Object.hasOwn(queue.find(item => item.sectionId === 'upload_materials'), 'navigationOnly'), false);
  assert.equal(Object.hasOwn(queue.find(item => item.sectionId === 'upload_materials'), 'uploadNavigationOnly'), false);
  assert.doesNotThrow(() => TaskState.createTask({ queue }));
  assert.equal(uploadButton.clickCount + crossOrigin.clickCount + submitPath.clickCount, 0);
  engine.destroy();
});

test('旧式 javascript/onclick 仅允许字面量导航调用和严格同源 location', () => {
  const options = { baseUrl: 'https://school.test/apply/home' };
  assert.equal(Safety.isSafeLegacyNavigationScript("javascript:showPage('basic');", options), true);
  assert.equal(Safety.isSafeLegacyNavigationScript("switchTab(2); return false", options), true);
  assert.equal(Safety.isSafeLegacyNavigationScript("location='/apply/basic'", options), true);
  assert.equal(Safety.isSafeLegacyNavigationScript("location='https://school.test/apply/basic'", options), true);
  assert.equal(Safety.isSafeLegacyNavigationScript("location='//evil.test/collect'", options), false);
  assert.equal(Safety.isSafeLegacyNavigationScript("location='https://evil.test/collect'", options), false);
  assert.equal(Safety.isSafeLegacyNavigationScript("showPage(document.querySelector('#submit').click())", options), false);
  assert.equal(Safety.isSafeLegacyNavigationScript("showPage(eval('submit()'))", options), false);
  assert.equal(Safety.isSafeLegacyNavigationScript("showPage('basic'); submitForm()", options), false);
  assert.equal(Safety.isSafeLegacyNavigationScript("showUploadPage('materials')", options), false);
  assert.equal(Safety.isSafeLegacyNavigationScript("showUploadPage('materials')", { ...options, allowUploadNavigation: true }), true);
  assert.equal(Safety.isSafeLegacyNavigationScript("openUploadDialog()", { ...options, allowUploadNavigation: true }), false);
  assert.equal(Safety.isSafeLegacyNavigationScript("showFilePickerPage()", { ...options, allowUploadNavigation: true }), false);
  assert.equal(Safety.isSafeLegacyNavigationScript("showUploadPage(eval('upload()'))", { ...options, allowUploadNavigation: true }), false);
});

test('form 内 a/li/onclick 与非提交 button 可组成导航簇，危险提交始终拒绝且诊断保留原因', () => {
  const basic = fakeElement({
    text: '基本信息', tagName: 'A', type: '', href: 'javascript:void(0);',
    onclick: "showPage('basic'); return false", inForm: true,
  });
  const family = fakeElement({
    text: '家庭主要成员', tagName: 'LI', type: '', onclick: "changeStep('family')", inForm: true,
  });
  const education = fakeElement({
    text: '学习信息', tagName: 'BUTTON', type: 'button', role: 'tab',
    onclick: "switchTab('education')", inForm: true,
  });
  const finalSubmit = fakeElement({
    text: '申请信息提交', tagName: 'A', type: '', onclick: 'submitApplication()', inForm: true,
  });
  const disguisedSubmit = fakeElement({
    text: '奖励情况', tagName: 'BUTTON', type: 'submit', role: 'tab', inForm: true,
  });
  const items = [basic, family, education, finalSubmit, disguisedSubmit];
  const { document } = attachTongjiStyleDocument(items);
  const engine = Navigation.createNavigationEngine({ document });
  const detailed = engine.scanDetailed();

  for (const sectionId of ['basic', 'family', 'education']) {
    const item = detailed.items.find(candidate => candidate.sectionId === sectionId);
    assert.equal(item?.safe, true, sectionId);
    const diagnostic = detailed.candidates.find(candidate => candidate.semanticSection === sectionId && candidate.accepted);
    assert.equal(diagnostic?.insideForm, true, sectionId);
    for (const key of ['semanticSection', 'accepted', 'rejectReason', 'insideForm', 'hrefType', 'acceptReason']) {
      assert.equal(Object.hasOwn(diagnostic, key), true, `${sectionId}.${key}`);
    }
  }
  assert.equal(detailed.items.some(item => item.text === '申请信息提交'), false);
  assert.equal(detailed.items.some(item => item.sectionId === 'awards'), false);
  assert.equal(detailed.candidates.some(item => item.semanticSection === 'application'
    && item.accepted === false && item.rejectReason === 'DANGEROUS_ACTION_REJECTED'), true);
  assert.equal(detailed.candidates.some(item => item.semanticSection === 'awards'
    && item.accepted === false && item.rejectReason === 'FORM_ACTION_CONTROL_REJECTED'), true);
  assert.doesNotMatch(JSON.stringify(detailed.candidates), /javascript:void|showPage|submitApplication/);
  assert.equal(items.reduce((sum, item) => sum + item.clickCount, 0), 0);
  engine.destroy();
});

test('fallback 在第 8 层共同祖先和前置噪声超过 500 项时仍以 LCA 识别，第 9 层则失败关闭', () => {
  const noise = Array.from({ length: 600 }, (_, index) => fakeElement({
    text: `普通操作 ${index}`, tagName: index % 2 ? 'LI' : 'BUTTON', type: 'button',
  }));
  const semantic = ['基本信息', '家庭主要成员', '学习信息'].map(text => fakeElement({
    text, tagName: 'A', type: '', onclick: "showPage('section')",
  }));
  const items = [...noise, ...semantic];
  const { document, sidebar } = attachTongjiStyleDocument(items);
  moveCommonAncestorToDepth(semantic, sidebar, 6);
  const engine = Navigation.createNavigationEngine({ document });
  const detailed = engine.scanDetailed();
  assert.deepEqual(new Set(detailed.items.map(item => item.sectionId)), new Set(['basic', 'family', 'education']));
  assert.equal(detailed.candidates.filter(item => item.accepted).every(item => item.acceptReason === 'SEMANTIC_CLUSTER_LCA'), true);
  engine.destroy();

  const tooDeep = ['基本信息', '家庭主要成员', '学习信息'].map(text => fakeElement({
    text, tagName: 'A', type: '', onclick: "showPage('section')",
  }));
  const second = attachTongjiStyleDocument(tooDeep);
  moveCommonAncestorToDepth(tooDeep, second.sidebar, 7);
  const secondEngine = Navigation.createNavigationEngine({ document: second.document });
  const rejected = secondEngine.scanDetailed();
  assert.equal(rejected.items.length, 0);
  assert.equal(rejected.candidates.every(item => item.accepted === false && item.rejectReason === 'OUTSIDE_SEMANTIC_CLUSTER'), true);
  assert.equal(tooDeep.reduce((sum, item) => sum + item.clickCount, 0), 0);
  secondEngine.destroy();
});

test('ARIA 伪选择控件不能把提交按钮或链接伪装成可点击字段', async () => {
  const submitRadio = fakeElement({
    text: '确认选项', tagName: 'BUTTON', type: 'submit', role: 'radio', inForm: true,
  });
  const linkedCheckbox = fakeElement({
    text: '查看选项', tagName: 'A', type: '', role: 'checkbox', href: '/apply/next',
  });

  const submitResult = await Events.setChecked(submitRadio, true);
  const linkResult = await Events.setChecked(linkedCheckbox, true);

  assert.equal(submitResult.ok, false);
  assert.equal(linkResult.ok, false);
  assert.equal(submitRadio.clickCount, 0, 'button[type=submit][role=radio] 必须零点击');
  assert.equal(linkedCheckbox.clickCount, 0, 'a[role=checkbox] 必须零点击');
});

test('导航扫描识别栏目与兄弟关系，允许上传栏目导航但排除下一步与危险动作', () => {
  const basic = fakeElement({ text: '基本信息', tagName: 'A', href: '/apply/basic', inNavigation: true });
  const awards = fakeElement({ text: '奖励情况（本科期间）', tagName: 'A', href: '/apply/awards', inNavigation: true });
  const next = fakeElement({ text: '下一步', tagName: 'A', href: '/apply/next', inNavigation: true });
  const upload = fakeElement({ text: '上传材料', tagName: 'A', href: '/apply/materials', inNavigation: true });
  const formBasic = fakeElement({ text: '基本信息', tagName: 'BUTTON', type: 'button', inNavigation: true, inForm: true });
  const elements = [basic, awards, next, upload, formBasic];
  const parent = {};
  elements.forEach(element => { element.parentElement = parent; });
  const document = attachDocument(elements);
  const engine = Navigation.createNavigationEngine({ document, configuredSelectors: ['.configured-target'] });
  const scanned = engine.scan();
  assert.ok(scanned.some(item => item.sectionId === 'awards'));
  assert.ok(scanned.some(item => item.sectionId === 'upload_materials' && item.safe === true && item.uploadNavigationOnly));
  assert.equal(scanned.some(item => item.text === '下一步'), false, '下一步不是栏目，不应进入队列');
  assert.ok(scanned.some(item => item.text === '基本信息' && item.reasonCode === 'AMBIGUOUS_SECTION'));
  const queue = engine.buildQueue(scanned);
  assert.ok(queue.filter(item => item.passiveOnly).every(item => item.requiresUserAction === true));
  assert.ok(queue.filter(item => !item.passiveOnly).every(item => item.requiresUserAction === false));
  engine.destroy();
});

test('导航执行需要新鲜用户确认，URL 变化会令旧扫描失效', async () => {
  const basic = fakeElement({ text: '基本信息', tagName: 'A', href: '/apply/basic', inNavigation: true });
  const document = attachDocument([basic], { url: 'https://school.test/apply/home' });
  basic.click = function click() {
    this.clickCount += 1;
    this.active = true;
    document.location.href = 'https://school.test/apply/basic';
    document.title = '基本信息';
  };
  const engine = Navigation.createNavigationEngine({ document });
  engine.scan();
  assert.equal((await engine.navigate('basic')).code, 'FRESH_USER_CONFIRMATION_REQUIRED');
  assert.equal(basic.clickCount, 0);
  const result = await engine.navigate('basic', {
    userInitiated: true,
    confirmSectionId: 'basic',
    timeoutMs: 500,
  });
  assert.equal(result.ok, true);
  assert.equal(basic.clickCount, 1);

  engine.scan();
  document.location.href = 'https://school.test/apply/other';
  const stale = await engine.navigate('basic', {
    userInitiated: true,
    confirmSectionId: 'basic',
  });
  assert.equal(stale.code, 'STALE_SCAN_AFTER_NAVIGATION');
  assert.equal(basic.clickCount, 1);
  engine.destroy();
});

test('保存处理器对配置目标仍执行最终复核，危险/歧义目标零点击', async () => {
  const dangerous = fakeElement({ text: '保存并下一步' });
  const dangerDoc = attachDocument([dangerous]);
  const dangerousHandler = Save.createSaveHandler({ document: dangerDoc, configuredSelectors: ['.configured-target'] });
  const dangerInspection = dangerousHandler.inspect();
  assert.equal(dangerInspection.every(item => item.safe === false), true);
  const blocked = await dangerousHandler.save({
    userInitiated: true,
    confirmText: '保存并下一步',
  });
  assert.equal(blocked.ok, false);
  assert.equal(dangerous.clickCount, 0);

  const saveOne = fakeElement({ text: '保存' });
  const saveTwo = fakeElement({ text: '暂存' });
  const ambiguousDoc = attachDocument([saveOne, saveTwo]);
  const ambiguous = Save.createSaveHandler({ document: ambiguousDoc });
  ambiguous.inspect();
  const ambiguousResult = await ambiguous.save({ userInitiated: true, confirmText: '保存' });
  assert.equal(ambiguousResult.code, 'AMBIGUOUS_SAVE_CONTROLS');
  assert.equal(saveOne.clickCount + saveTwo.clickCount, 0);
});

test('安全保存只能由明确用户操作触发，触发后仍要求人工验证结果', async () => {
  const control = fakeElement({ text: '保存当前信息' });
  const document = attachDocument([control]);
  const handler = Save.createSaveHandler({ document });
  handler.inspect();
  assert.equal((await handler.save({ confirmText: '保存当前信息' })).code, 'FRESH_USER_CONFIRMATION_REQUIRED');
  assert.equal((await handler.save({ userInitiated: true, confirmText: '保存' })).code, 'SAVE_LABEL_CONFIRMATION_MISMATCH');
  assert.equal(control.clickCount, 0);
  const result = await handler.save({
    userInitiated: true,
    confirmText: '保存当前信息',
    timeoutMs: 250,
  });
  assert.equal(result.ok, true);
  assert.equal(result.verificationRequired, true);
  assert.equal(control.clickCount, 1);
});

test('页面等待使用实际元素/URL 变化，支持超时且不依赖固定两秒延迟', async () => {
  const element = fakeElement({ text: '基本信息', tagName: 'A' });
  const document = attachDocument([element]);
  document.querySelector = selector => selector === '#ready' ? element : null;
  assert.equal(await PageReady.waitForElement('#ready', { document, timeoutMs: 100 }), element);

  const beforeSnapshot = PageReady.captureNavigationSnapshot(document);
  setTimeout(() => { document.location.href = 'https://school.test/apply/basic'; }, 20);
  const change = await PageReady.waitForNavigationChange({
    document,
    beforeSnapshot,
    timeoutMs: 300,
    quietMs: 32,
    pollIntervalMs: 16,
  });
  assert.equal(change.changed, true);
  assert.equal(change.reason, 'URL');

  const missing = await PageReady.waitForElement('#missing', { document, timeoutMs: 40, pollIntervalMs: 16 });
  assert.equal(missing, null);
});

test('任务状态只保存白名单 JSON；恢复 running/queued 必须转人工确认', () => {
  const task = TaskState.createTask({
    queue: [{ sectionId: 'basic-information', label: '基本信息' }],
    origin: 'https://school.test',
    profileRevision: 'rev-1',
  });
  assert.equal(task.state, TaskState.TASK_STATES.QUEUED);
  const restored = TaskState.normalizeTaskState({ ...task, state: TaskState.TASK_STATES.RUNNING }, { forRestore: true });
  assert.equal(restored.state, TaskState.TASK_STATES.NEEDS_USER_REVIEW);
  assert.equal(restored.paused, true);
  assert.equal(restored.origin, 'https://school.test');

  for (const malicious of [
    { ...task, url: 'https://school.test/apply?token=secret' },
    { ...task, allowOverwrite: true },
    { ...task, results: [{ sectionId: 'basic-information', status: 'ok', beforeValue: 'private' }] },
    { ...task, queue: [{ sectionId: 'basic-information', selector: '#submit' }] },
  ]) {
    assert.throws(() => TaskState.normalizeTaskState(malicious), /不允许字段|禁止持久化字段/);
  }
  const cyclic = {};
  cyclic.self = cyclic;
  assert.throws(() => TaskState.cloneSerializable(cyclic), /普通可序列化|嵌套|节点/);
});

function storageArea({ throwOnSet = false } = {}) {
  const values = {};
  return {
    values,
    getCalls: 0,
    setCalls: 0,
    removeCalls: 0,
    get(key, callback) { this.getCalls += 1; callback({ [key]: values[key] }); },
    set(value, callback) {
      this.setCalls += 1;
      if (throwOnSet) throw new Error('session unavailable');
      Object.assign(values, value);
      callback?.();
    },
    remove(key, callback) { this.removeCalls += 1; delete values[key]; callback?.(); },
  };
}

test('任务存储优先 session，失败时回退 local，清除会覆盖两个区域', async () => {
  const session = storageArea({ throwOnSet: true });
  const local = storageArea();
  const chromeApi = { runtime: {}, storage: { session, local } };
  const store = new TaskState.TaskStateStore({ chromeApi });
  const task = TaskState.createTask({ queue: [{ sectionId: 'awards-discipline' }] });
  await store.save(task);
  assert.equal(session.setCalls, 1);
  assert.equal(local.setCalls, 1);
  assert.ok(local.values[TaskState.TASK_STORAGE_KEY]);
  const loaded = await store.load();
  assert.equal(loaded.state, TaskState.TASK_STATES.NEEDS_USER_REVIEW);
  await store.clear();
  assert.equal(session.removeCalls, 1);
  assert.equal(local.removeCalls, 1);
});

test('报告完整字段值仅在内存视图，持久摘要与任务结果不含值或 DOM', () => {
  const manager = new Reports.ReportManager();
  const runId = manager.beginRun({ taskId: 'task:123456', sectionId: 'awards-discipline', adapterId: 'undergraduate-awards' });
  const element = fakeElement({ text: '' });
  manager.recordField(runId, {
    field: 'content', fieldName: '内容', status: Reports.REPORT_STATUSES.SUCCESS,
    plannedValue: '私密计划值', beforeValue: '网页原值', afterValue: '网页新值', element,
  });
  const view = manager.getViewModel(runId);
  assert.equal(view.items[0].plannedValue, '私密计划值');
  const persistent = JSON.stringify(manager.toPersistentSummary(runId));
  assert.doesNotMatch(persistent, /私密计划值|网页原值|网页新值|element/);
  const taskResult = manager.toTaskResult(runId);
  assert.doesNotThrow(() => TaskState.normalizeTaskState({
    ...TaskState.createTask({ queue: [{ sectionId: 'awards-discipline' }] }),
    results: [taskResult],
  }));
  assert.equal(manager.locate(runId, view.items[0].itemId).ok, true);
  assert.equal(element.clickCount, 0);
  manager.dispose(runId);
});

test('后台任务消息走安全状态仓库，未知/AI 消息不会触发任务写入或 fetch', async () => {
  const backgroundSource = await readFile(resolve(root, 'background.js'), 'utf8');
  const session = storageArea();
  const local = storageArea();
  let listener;
  let fetchCalls = 0;
  const context = {
    AbortController,
    URL,
    TextEncoder,
    JFTaskState: TaskState,
    clearTimeout,
    console: { log() {}, warn() {}, error() {} },
    fetch: async () => { fetchCalls += 1; throw new Error('network forbidden'); },
    setTimeout,
    chrome: {
      runtime: {
        id: 'extension-id',
        getURL: path => `chrome-extension://extension-id/${path}`,
        openOptionsPage: async () => undefined,
        onMessage: { addListener(callback) { listener = callback; } },
      },
      storage: { session, local },
      tabs: { create() {} },
    },
  };
  vm.runInNewContext(backgroundSource, context, { filename: 'background.js' });

  const send = message => new Promise(resolveResponse => {
    const returned = listener(message, { id: 'extension-id' }, resolveResponse);
    if (returned !== true) resolveResponse({ returned });
  });
  const task = TaskState.createTask({ queue: [{ sectionId: 'basic-information' }] });
  assert.equal((await send({ type: 'SET_TASK_STATE', taskState: task })).ok, true);
  const loaded = await send({ type: 'GET_TASK_STATE' });
  assert.equal(loaded.ok, true);
  assert.equal(loaded.taskState.state, TaskState.TASK_STATES.NEEDS_USER_REVIEW);
  assert.equal((await send({ type: 'CLEAR_TASK_STATE' })).ok, true);

  let aiResponse;
  const aiReturned = listener({ type: 'AI_FILL' }, { id: 'extension-id' }, value => { aiResponse = value; });
  assert.equal(aiReturned, false);
  assert.equal(aiResponse.localMode, true);
  assert.equal(fetchCalls, 0);
});

test('核心模块不含自动提交、文件注入或 location 赋值路径', async () => {
  const sources = await Promise.all([
    'safety.js', 'page-ready.js', 'navigation-engine.js', 'task-state.js', 'report-manager.js', 'save-handler.js',
  ].map(file => readFile(resolve(root, 'src', 'core', file), 'utf8')));
  const source = sources.join('\n');
  // 安全拒绝正则必须保留这些危险 API 名；静态检查只排除可执行语句，避免把
  // `const ..._RE = /requestSubmit|DataTransfer/` 这样的防御规则误报成调用。
  const executableSource = source.split('\n')
    .filter(line => !/^\s*(?:\/\/|\*|const\s+[A-Z0-9_]+_RE\s*=)/.test(line))
    .join('\n');
  assert.doesNotMatch(executableSource, /requestSubmit\s*\(|\.submit\s*\(|\bnew\s+(?:DataTransfer|FileReader)\b|input\.files\s*=|(?:window\.)?location(?:\.href)?\s*=/);
  assert.doesNotMatch(source, /chrome\.storage\.sync|<all_urls>|host_permissions/);
  assert.match(source, /FRESH_USER_CONFIRMATION_REQUIRED/);
});
