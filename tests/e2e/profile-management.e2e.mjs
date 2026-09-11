import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test, { after, before } from 'node:test';
import {
  clickPoint,
  evaluate,
  launchHeadlessBrowser,
  waitFor,
} from './support/headless-browser.mjs';

const testDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(testDirectory, '..', '..');
const extensionDirectory = resolve(projectRoot, 'dist');
const manifestPath = resolve(extensionDirectory, 'manifest.json');
const bootstrapUrl = pathToFileURL(resolve(projectRoot, 'tests', 'fixtures', 'awards.html')).href;
const profileScreenshotPath = process.env.JF_PROFILE_SCREENSHOT_PATH || '';

const seedResume = Object.freeze({
  profileName: '资料管理 E2E 契约',
  personal: {},
  basic: {},
  contact: {},
  application: {},
  education: [
    {
      school: '示例大学',
      attachments: ['file_education_only'],
    },
  ],
  family: [
    {
      name: '待编辑成员甲',
      attachments: ['file_family_first'],
    },
    {
      name: '待编辑成员乙',
      attachments: ['file_family_second'],
    },
  ],
  internships: [
    {
      company: '待编辑单位甲',
      attachments: ['file_experience_first'],
    },
    {
      company: '待编辑单位乙',
      attachments: ['file_experience_second'],
    },
  ],
  awards: [
    {
      time: '2025-06',
      content: '待编辑奖励',
      category: '待编辑类别',
      level: '待编辑级别',
      rank: '待编辑等级',
      participationMode: '待编辑方式',
      attachments: ['file_award_only'],
      legacyPortalField: '旧系统奖项字段必须保留',
    },
  ],
  work: [],
  projects: [],
  languages: [],
  papers: [],
  skills: {},
});

const scalarValues = Object.freeze({
  '#p_namePinyin': 'SHILI TONGXUE',
  '#p_healthStatus': '健康',
  '#p_political': '中国共产党预备党员',
  '#p_idType': '居民身份证',
  '#p_birthplaceRegion': '江苏省 / 南京市 / 鼓楼区',
  '#p_hometown_province': '四川省',
  '#p_hometown_city': '成都市',
  '#p_householdRegion': '浙江省 / 杭州市 / 西湖区',
  '#p_household_address': '上海市杨浦区示例路 1 号',
  '#c_archiveRegion': '北京市 / 北京市 / 海淀区',
  '#c_archive_organization': '示例大学档案馆',
  '#c_archive_address': '上海市杨浦区档案路 2 号',
  '#c_archive_postcode': '200092',
  '#c_address': '上海市杨浦区通讯路 3 号',
  '#c_postcode': '200093',
  '#c_emergencyPhone': 'TEST-EMERGENCY-PHONE',
});

const introValue = '这是独立的自我评价，不得写入个人陈述。';

const applicationValues = Object.freeze({
  '#app_disciplinaryHistory': '无处分记录',
  '#app_personalStatement': '这是独立的申请个人陈述，不得被自我评价覆盖。',
  '#app_notes': '高校申请专用备注信息。',
});

const applicationMaxLengths = Object.freeze({
  disciplinaryHistory: 200,
  personalStatement: 1000,
  notes: 1000,
});

const awardValues = Object.freeze({
  category: '荣誉称号',
  level: '校级',
  rank: '一等奖',
  participationMode: '个人',
});

const educationValues = Object.freeze({
  '#edu-list .multi-item:nth-child(1) [data-key="studentId"]': 'TEST-STUDENT-2026',
  '#edu-list .multi-item:nth-child(1) [data-key="gpa"]': '3.80/4.00',
});

const familyValues = Object.freeze([
  {
    name: '示例成员甲',
    relationship: '父亲',
    employer: '示例单位甲',
    position: '工程师',
    phone: 'TEST-PHONE-A',
  },
  {
    name: '示例成员乙',
    relationship: '母亲',
    employer: '示例单位乙',
    position: '教师',
    phone: 'TEST-PHONE-B',
  },
]);

const experienceValues = Object.freeze([
  {
    startDate: '2020-09',
    endDate: '2024-06',
    company: '示例大学',
    position: '学生',
  },
  {
    startDate: '2024-07',
    endDate: '2025-06',
    company: '示例研究院',
    position: '研究助理',
  },
]);

let browser;
let manifest;
let optionsCdp;
let optionsUrl;
const optionsConsoleMessages = [];
const optionsExternalRequests = [];

before(async () => {
  manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.options_page, 'options.html');
  optionsUrl = pathToFileURL(resolve(extensionDirectory, manifest.options_page)).href;
  browser = await launchHeadlessBrowser({
    // 先连接稳定的 file:// fixture target，再同方案导航到真实 dist/options.html。
    initialUrl: bootstrapUrl,
    width: 1440,
    height: 1000,
  });
  optionsCdp = browser.cdp;
  collectOptionsSignals(optionsCdp);
  await optionsCdp.call('Page.addScriptToEvaluateOnNewDocument', {
    source: chromeStorageMockSource(seedResume, manifest),
  });
}, { timeout: 30_000 });

after(async () => {
  await browser?.close();
});

test('资料管理：新增申请字段、奖项类别和重复条目经保存刷新后保持正确关联', async () => {
  // 文档创建前的 chrome.storage.local 替身已预置不可见 attachments；可见字段仍只通过真实 UI 修改。
  await navigateToOptions();

  const identity = await evaluate(optionsCdp, `(() => ({
    href: location.href,
    title: document.title,
    heading: document.querySelector('h1')?.textContent?.trim() || '',
    bodyTextLength: document.body?.innerText?.trim().length || 0,
    frameworkOverlay: Boolean(document.querySelector('vite-error-overlay, nextjs-portal, #webpack-dev-server-client-overlay')),
    navigation: [...document.querySelectorAll('.sidenav a')].map(link => ({
      href: link.getAttribute('href') || '',
      text: link.textContent?.trim() || '',
    })),
    legacyWorkEditorPresent: Boolean(document.querySelector('#sec-work #work-list')),
  }))()`);
  assert.equal(identity.href, optionsUrl);
  assert.equal(identity.title, '解放 · 申请资料管理');
  assert.equal(identity.heading, '我的申请资料');
  assert.ok(identity.bodyTextLength > 500, '资料管理页面不应为空白页');
  assert.equal(identity.frameworkOverlay, false, '页面不应出现框架错误遮罩');
  assert.equal(identity.navigation.some(item => item.href === '#sec-internship'), true);
  assert.equal(identity.navigation.some(item => item.href === '#sec-work'), false);
  assert.equal(identity.navigation.some(item => /旧版工作经历/.test(item.text)), false);
  assert.equal(identity.legacyWorkEditorPresent, true, '旧 work[] 编辑器必须继续兼容已有资料');

  await fillControls({
    ...scalarValues,
    ...educationValues,
    ...applicationValues,
    '#intro': introValue,
  });
  await fillRepeatedRows('#family-list', familyValues);
  await fillRepeatedRows('#intern-list', experienceValues);
  await fillRepeatedRows('#award-list', [awardValues]);
  assertApplicationUiState(await applicationUiSnapshot());

  // 添加按钮应真正创建一条 UI 记录；立即删除临时记录后保留原有两条。
  await assertAddThenRemove('#family-add', '#family-list');
  await assertAddThenRemove('#intern-add', '#intern-list');
  await captureProfileScreenshot();

  await clickSelector('#btn-save');
  await waitFor(
    async () => (await storedResume())?.education?.[0]?.studentId === educationValues['#edu-list .multi-item:nth-child(1) [data-key="studentId"]'],
    3_000,
    '点击保存后 chrome.storage.local 未更新',
  );
  const saved = await storedResume();
  assertSavedExpandedProfile(saved);

  await reloadOptions();
  const reloadedUi = await profileUiSnapshot();
  assert.deepEqual(reloadedUi.scalars, Object.values(scalarValues));
  assert.deepEqual(reloadedUi.education, {
    studentId: 'TEST-STUDENT-2026',
    gpa: '3.80/4.00',
  });
  assert.equal(reloadedUi.intro, introValue);
  assert.deepEqual(reloadedUi.application, applicationValuesByName());
  assert.deepEqual(reloadedUi.awards, [awardValues]);
  assertApplicationUiState(await applicationUiSnapshot());
  assert.deepEqual(reloadedUi.family, familyValues);
  assert.deepEqual(reloadedUi.internships, experienceValues);

  // 删除首行后再次保存，第二行必须继续携带自己的 attachments，不能按旧索引串到第一行。
  await clickSelector('#family-list .multi-item:first-child .btn-remove');
  await clickSelector('#intern-list .multi-item:first-child .btn-remove');
  await waitFor(
    async () => {
      const counts = await rowCounts();
      return counts.family === 1 && counts.internships === 1;
    },
    2_000,
    '删除首行后重复条目数量未更新',
  );
  await clickSelector('#btn-save');
  await waitFor(
    async () => {
      const value = await storedResume();
      return value?.family?.length === 1 && value?.internships?.length === 1;
    },
    3_000,
    '删除首行后的资料未保存',
  );

  const afterDelete = await storedResume();
  assert.equal(afterDelete.family[0].name, familyValues[1].name);
  assert.deepEqual(afterDelete.family[0].attachments, ['file_family_second']);
  assert.equal(afterDelete.internships[0].company, experienceValues[1].company);
  assert.deepEqual(afterDelete.internships[0].attachments, ['file_experience_second']);
  assert.deepEqual(afterDelete.internship[0].attachments, ['file_experience_second']);
  assertSavedAward(afterDelete.awards[0]);
  assert.doesNotMatch(JSON.stringify(afterDelete.family), /file_family_first/);
  assert.doesNotMatch(JSON.stringify(afterDelete.internships), /file_experience_first/);

  await reloadOptions();
  const afterDeleteUi = await profileUiSnapshot();
  assert.equal(afterDeleteUi.intro, introValue);
  assert.deepEqual(afterDeleteUi.application, applicationValuesByName());
  assert.deepEqual(afterDeleteUi.awards, [awardValues]);
  assertApplicationUiState(await applicationUiSnapshot());
  assert.deepEqual(afterDeleteUi.family, [familyValues[1]]);
  assert.deepEqual(afterDeleteUi.internships, [experienceValues[1]]);

  const resourceUrls = await evaluate(optionsCdp, `performance.getEntriesByType('resource').map(entry => entry.name)`);
  assert.deepEqual(resourceUrls.filter(url => /^https?:/i.test(url)), [], '本地资料管理不得加载外部资源');
  assert.deepEqual(optionsExternalRequests, [], '本地资料管理不得产生外部网络请求');
  assert.deepEqual(optionsConsoleMessages, [], '资料管理不得产生 console warning/error、CSP 报错或未捕获异常');
  assert.doesNotMatch(
    browser.getBrowserOutput(),
    /Refused to (?:execute|load|connect).*Content Security Policy/i,
    '浏览器输出中不得包含 CSP 拒绝记录',
  );
}, { timeout: 30_000 });

function assertSavedExpandedProfile(saved) {
  assert.equal(saved.basic.namePinyin, scalarValues['#p_namePinyin']);
  assert.equal(saved.basic.healthStatus, scalarValues['#p_healthStatus']);
  assert.equal(saved.basic.political, scalarValues['#p_political']);
  assert.equal(saved.personal.namePinyin, scalarValues['#p_namePinyin']);
  assert.equal(saved.personal.healthStatus, scalarValues['#p_healthStatus']);
  assert.equal(saved.basic.householdAddress, scalarValues['#p_household_address']);
  assert.equal(saved.basic.idType, scalarValues['#p_idType']);
  assert.equal(saved.basic.birthplaceRegion, scalarValues['#p_birthplaceRegion']);
  assert.equal(saved.basic.hometownRegion, '四川省 / 成都市');
  assert.equal(saved.basic.householdRegion, scalarValues['#p_householdRegion']);
  assert.equal(saved.contact.archiveRegion, scalarValues['#c_archiveRegion']);
  assert.equal(saved.contact.archiveOrganization, scalarValues['#c_archive_organization']);
  assert.equal(saved.contact.archiveAddress, scalarValues['#c_archive_address']);
  assert.equal(saved.contact.archivePostcode, scalarValues['#c_archive_postcode']);
  assert.equal(saved.contact.address, scalarValues['#c_address']);
  assert.equal(saved.contact.postcode, scalarValues['#c_postcode']);
  assert.equal(saved.contact.emergencyPhone, scalarValues['#c_emergencyPhone']);
  assert.notEqual(saved.basic.birthplaceRegion, saved.basic.hometownRegion);
  assert.notEqual(saved.basic.birthplaceRegion, saved.basic.householdRegion);
  assert.notEqual(saved.basic.householdRegion, saved.basic.householdAddress);
  assert.notEqual(saved.contact.archiveRegion, saved.contact.archiveAddress);
  assert.notEqual(saved.contact.archiveRegion, saved.basic.householdRegion);
  assert.equal(saved.intro, introValue);
  assert.deepEqual(saved.application, applicationValuesByName());
  assert.notEqual(saved.intro, saved.application.personalStatement);
  assert.equal(saved.education[0].studentId, 'TEST-STUDENT-2026');
  assert.equal(saved.education[0].gpa, '3.80/4.00');
  assert.deepEqual(saved.education[0].attachments, ['file_education_only']);
  assert.deepEqual(saved.family.map(pickFamilyFields), familyValues);
  assert.deepEqual(saved.internships.map(pickExperienceFields), experienceValues);
  assert.deepEqual(saved.internship.map(pickExperienceFields), experienceValues);
  assert.deepEqual(saved.family.map(item => item.attachments), [
    ['file_family_first'],
    ['file_family_second'],
  ]);
  assert.deepEqual(saved.internships.map(item => item.attachments), [
    ['file_experience_first'],
    ['file_experience_second'],
  ]);
  assertSavedAward(saved.awards[0]);
}

function assertSavedAward(award) {
  assert.equal(award.category, awardValues.category);
  assert.equal(award.level, awardValues.level);
  assert.equal(award.rank, awardValues.rank);
  assert.equal(award.participationMode, awardValues.participationMode);
  assert.deepEqual(award.attachments, ['file_award_only']);
  assert.equal(award.legacyPortalField, '旧系统奖项字段必须保留');
}

async function navigateToOptions() {
  optionsConsoleMessages.length = 0;
  optionsExternalRequests.length = 0;
  // addScriptToEvaluateOnNewDocument 已安装，mock 会先于真实 options.js 执行。
  await optionsCdp.call('Page.navigate', { url: optionsUrl });
  await waitForOptionsReady();
}

async function reloadOptions() {
  await optionsCdp.call('Page.reload', { ignoreCache: true });
  await waitForOptionsReady();
}

async function waitForOptionsReady() {
  await waitFor(async () => {
    try {
      return await evaluate(optionsCdp, `document.readyState === 'complete'
        && document.getElementById('profile_name')?.value === ${JSON.stringify(seedResume.profileName)}
        && document.querySelectorAll('#edu-list .multi-item').length === 1
        && document.querySelectorAll('#family-list .multi-item').length >= 1
        && document.querySelectorAll('#intern-list .multi-item').length >= 1
        && document.querySelectorAll('#award-list .award-item').length === 1`);
    } catch {
      return false;
    }
  }, 8_000, '资料管理页面初始化超时');
}

async function fillControls(values) {
  const payload = JSON.stringify(values);
  const outcome = await evaluate(optionsCdp, `(() => {
    const values = ${payload};
    const missing = [];
    for (const [selector, value] of Object.entries(values)) {
      const element = document.querySelector(selector);
      if (!element) { missing.push(selector); continue; }
      const prototype = element.tagName === 'TEXTAREA'
        ? HTMLTextAreaElement.prototype
        : element.tagName === 'SELECT'
          ? HTMLSelectElement.prototype
          : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value);
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
    }
    return { missing };
  })()`);
  assert.deepEqual(outcome.missing, [], `资料管理缺少控件：${outcome.missing.join(', ')}`);
}

async function fillRepeatedRows(containerSelector, rows) {
  const values = {};
  rows.forEach((row, index) => {
    Object.entries(row).forEach(([key, value]) => {
      values[`${containerSelector} .multi-item:nth-child(${index + 1}) [data-key="${key}"]`] = value;
    });
  });
  await fillControls(values);
}

async function assertAddThenRemove(addSelector, containerSelector) {
  const before = await evaluate(optionsCdp, `document.querySelectorAll(${JSON.stringify(`${containerSelector} .multi-item`)}).length`);
  await clickSelector(addSelector);
  await waitFor(
    () => evaluate(optionsCdp, `document.querySelectorAll(${JSON.stringify(`${containerSelector} .multi-item`)}).length === ${before + 1}`),
    2_000,
    `${addSelector} 未创建新记录`,
  );
  await clickSelector(`${containerSelector} .multi-item:last-child .btn-remove`);
  await waitFor(
    () => evaluate(optionsCdp, `document.querySelectorAll(${JSON.stringify(`${containerSelector} .multi-item`)}).length === ${before}`),
    2_000,
    `${containerSelector} 未删除临时记录`,
  );
}

async function clickSelector(selector) {
  const center = await evaluate(optionsCdp, `(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) return null;
    element.scrollIntoView({ block: 'center', inline: 'nearest' });
    const rect = element.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  assert.ok(center, `找不到待点击控件：${selector}`);
  await clickPoint(optionsCdp, center.x, center.y);
  if (selector.includes('.btn-remove')) {
    await waitFor(() => evaluate(optionsCdp, `document.getElementById('delete-record-dialog')?.open === true`), 2_000, '删除记录前应显示确认对话框');
    await clickSelector('#delete-record-confirm');
  }
}

function storedResume() {
  return evaluate(optionsCdp, `new Promise(resolve => {
    chrome.storage.local.get('resumeData', result => resolve(result.resumeData || null));
  })`, { awaitPromise: true });
}

function rowCounts() {
  return evaluate(optionsCdp, `(() => ({
    family: document.querySelectorAll('#family-list .multi-item').length,
    internships: document.querySelectorAll('#intern-list .multi-item').length,
  }))()`);
}

function profileUiSnapshot() {
  return evaluate(optionsCdp, `(() => {
    const value = selector => document.querySelector(selector)?.value || '';
    const rows = (container, keys) => [...document.querySelectorAll(container + ' .multi-item')].map(row =>
      Object.fromEntries(keys.map(key => [key, row.querySelector('[data-key="' + key + '"]')?.value || '']))
    );
    return {
      scalars: ${JSON.stringify(Object.keys(scalarValues))}.map(value),
      education: {
        studentId: value('#edu-list .multi-item:nth-child(1) [data-key="studentId"]'),
        gpa: value('#edu-list .multi-item:nth-child(1) [data-key="gpa"]'),
      },
      intro: value('#intro'),
      application: {
        disciplinaryHistory: value('#app_disciplinaryHistory'),
        personalStatement: value('#app_personalStatement'),
        notes: value('#app_notes'),
      },
      awards: rows('#award-list', ['category', 'level', 'rank', 'participationMode']),
      family: rows('#family-list', ['name', 'relationship', 'employer', 'position', 'phone']),
      internships: rows('#intern-list', ['startDate', 'endDate', 'company', 'position']),
    };
  })()`);
}

function applicationUiSnapshot() {
  return evaluate(optionsCdp, `(() => {
    const controls = {
      disciplinaryHistory: document.getElementById('app_disciplinaryHistory'),
      personalStatement: document.getElementById('app_personalStatement'),
      notes: document.getElementById('app_notes'),
    };
    return Object.fromEntries(Object.entries(controls).map(([key, control]) => [key, {
      value: control?.value || '',
      maxLength: control?.maxLength ?? -1,
      count: document.getElementById(control?.getAttribute('aria-describedby') || '')?.textContent?.trim() || '',
    }]));
  })()`);
}

function applicationValuesByName() {
  return {
    disciplinaryHistory: applicationValues['#app_disciplinaryHistory'],
    personalStatement: applicationValues['#app_personalStatement'],
    notes: applicationValues['#app_notes'],
  };
}

function assertApplicationUiState(snapshot) {
  const expectedValues = applicationValuesByName();
  for (const [key, value] of Object.entries(expectedValues)) {
    assert.deepEqual(snapshot[key], {
      value,
      maxLength: applicationMaxLengths[key],
      count: String(value.length),
    });
  }
}

function pickFamilyFields(item) {
  return Object.fromEntries(['name', 'relationship', 'employer', 'position', 'phone'].map(key => [key, item[key]]));
}

function pickExperienceFields(item) {
  return Object.fromEntries(['startDate', 'endDate', 'company', 'position'].map(key => [key, item[key]]));
}

async function captureProfileScreenshot() {
  if (!profileScreenshotPath) return;
  const metrics = await optionsCdp.call('Page.getLayoutMetrics');
  const contentSize = metrics.cssContentSize || metrics.contentSize;
  const screenshot = await optionsCdp.call('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: true,
    clip: {
      x: 0,
      y: 0,
      width: Math.ceil(contentSize.width),
      height: Math.ceil(contentSize.height),
      scale: 1,
    },
  }, 20_000);
  await mkdir(dirname(profileScreenshotPath), { recursive: true });
  await writeFile(profileScreenshotPath, Buffer.from(screenshot.data, 'base64'));
}

function chromeStorageMockSource(initialResume, runtimeManifest) {
  const initialPayload = JSON.stringify({ resumeData: initialResume });
  const manifestPayload = JSON.stringify(runtimeManifest);
  return `(() => {
    const STORAGE_KEY = '__jiefang_profile_e2e_storage__';
    const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
    const readStore = () => {
      try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); }
      catch { return {}; }
    };
    const writeStore = value => localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    if (!localStorage.getItem(STORAGE_KEY)) writeStore(${initialPayload});

    const finish = (value, callback) => {
      const output = clone(value);
      if (typeof callback === 'function') queueMicrotask(() => callback(output));
      return Promise.resolve(output);
    };
    const local = {
      get(keys, callback) {
        const store = readStore();
        let result;
        if (keys === null || keys === undefined) result = store;
        else if (typeof keys === 'string') result = { [keys]: store[keys] };
        else if (Array.isArray(keys)) result = Object.fromEntries(keys.map(key => [key, store[key]]));
        else result = Object.fromEntries(Object.entries(keys).map(([key, fallback]) => [
          key,
          Object.prototype.hasOwnProperty.call(store, key) ? store[key] : fallback,
        ]));
        return finish(result, callback);
      },
      set(items, callback) {
        writeStore({ ...readStore(), ...clone(items) });
        return finish(undefined, callback);
      },
      remove(keys, callback) {
        const store = readStore();
        for (const key of Array.isArray(keys) ? keys : [keys]) delete store[key];
        writeStore(store);
        return finish(undefined, callback);
      },
      clear(callback) {
        writeStore({});
        return finish(undefined, callback);
      },
    };

    const chromeRoot = globalThis.chrome || {};
    chromeRoot.storage = {
      local,
      onChanged: { addListener() {}, removeListener() {}, hasListener() { return false; } },
    };
    chromeRoot.runtime = {
      id: 'jiefang-profile-e2e',
      lastError: null,
      getManifest: () => clone(${manifestPayload}),
      getURL: path => new URL(String(path || ''), location.href).href,
      sendMessage(message, callback) {
        return finish({ ok: false, error: '资料管理 E2E 未启用后台消息：' + String(message?.type || '') }, callback);
      },
      onMessage: { addListener() {}, removeListener() {}, hasListener() { return false; } },
    };
    globalThis.chrome = chromeRoot;
  })();`;
}

function collectOptionsSignals(cdp) {
  cdp.on('Network.requestWillBeSent', ({ request }) => {
    if (/^https?:/i.test(request?.url || '')) optionsExternalRequests.push(request.url);
  });
  cdp.on('Runtime.consoleAPICalled', event => {
    if (!['warning', 'error'].includes(event.type)) return;
    optionsConsoleMessages.push({
      source: 'console',
      level: event.type,
      text: (event.args || []).map(arg => arg.value ?? arg.description ?? '').join(' '),
    });
  });
  cdp.on('Runtime.exceptionThrown', event => {
    optionsConsoleMessages.push({
      source: 'exception',
      level: 'error',
      text: event.exceptionDetails?.exception?.description || event.exceptionDetails?.text || 'Uncaught exception',
    });
  });
  cdp.on('Log.entryAdded', ({ entry }) => {
    if (!['warning', 'error'].includes(entry?.level)) return;
    optionsConsoleMessages.push({
      source: entry.source || 'log',
      level: entry.level,
      text: entry.text || '',
    });
  });
}
