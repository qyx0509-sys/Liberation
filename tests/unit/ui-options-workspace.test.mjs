import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const require = createRequire(import.meta.url);
const Coverage = require('../../src/ui/profile-coverage.js');

test('资料覆盖度只统计受管理的可编辑字段，不统计未知 JSON 或已绑定材料', () => {
  const empty = Coverage.fromResume({});
  const result = Coverage.fromResume({ basic: { name: '示例姓名', unknown: '不计数' }, files: { photo: 'file_photo' }, futureField: '不计数' });
  assert.equal(empty.total, Coverage.SCALARS.length);
  assert.equal(result.total, empty.total);
  assert.equal(result.filled, 1);
  assert.equal(result.missing, result.total - 1);
  assert.equal(result.percent, Math.round(100 / result.total));
  assert.doesNotMatch(JSON.stringify(result), /示例姓名|file_photo|futureField/);
});

test('资料覆盖度分开统计地区、详细地址、自我评价与个人陈述', () => {
  const result = Coverage.fromResume({ basic: { householdRegion: '示例省 / 示例市' }, contact: { archiveAddress: '示例详细地址' }, intro: '自我评价' });
  assert.equal(result.filled, 3);
  assert.equal(result.missingFields.some(field => field.id === 'p_household_address'), true);
  assert.equal(result.missingFields.some(field => field.id === 'c_archiveRegion'), true);
  assert.equal(result.missingFields.some(field => field.id === 'app_personalStatement'), true);
});

test('资料覆盖度的 DOM 和已保存资料使用同一字段清单与分母', () => {
  const seed = { basic: { name: '示例姓名' }, education: [{ school: '示例大学', gpa: '3.8/4' }], awards: [{ time: '2025-07', content: '示例奖励', category: '荣誉', level: '校级', rank: '一等奖', participationMode: '个人' }] };
  const read = path => path.split('.').reduce((value, key) => value?.[key], seed);
  const controls = new Map(Coverage.SCALARS.map(field => [field.id, { value: field.paths.map(read).find(value => value !== undefined) || '' }]));
  const document = {
    getElementById(id) { return controls.get(id); },
    querySelectorAll(selector) {
      const collection = Coverage.ARRAYS.find(item => selector === `#${item.container} > .multi-item`);
      return (seed[collection?.paths[0]] || []).map(record => ({ querySelector(selector) { const key = selector.match(/data-key="([^"]+)"/)[1]; return { value: record[key] || '' }; } }));
    },
  };
  assert.deepEqual(Coverage.fromDocument(document), Coverage.fromResume(seed));
});

test('重复记录的覆盖度保留独立类别/级别/等级/参与方式，并且不暴露填写值', () => {
  const result = Coverage.fromResume({ awards: [{ category: '奖学金', level: '国家级', rank: '金奖', participationMode: '团队' }] });
  assert.equal(result.sections.awards.filled, 4);
  assert.equal(result.sections.awards.total, 12);
  assert.doesNotMatch(JSON.stringify(result), /奖学金|国家级|金奖|"value"/);
});

test('覆盖度没有把不存在的重复条目误算为学校必填缺失', () => {
  assert.equal(Coverage.fromResume({ education: [] }).sections.education, undefined);
  assert.equal(Coverage.fromResume({ education: [{}] }).sections.education.total, 20);
});

test('已有可编辑补充字段计入覆盖度，而未知 JSON 字段仍不计入', () => {
  const result = Coverage.fromResume({ customFields: [{ key: 'extra-study', section: 'education', label: '补充学习信息', value: '私密值不进入统计' }, { key: 'extra-empty', section: 'unknown', label: '补充信息', value: '' }], unknown: 'ignored' });
  assert.equal(result.total, Coverage.SCALARS.length + 2);
  assert.equal(result.filled, 1);
  assert.equal(result.sections.education.filled, 1);
  assert.ok(result.missingFields.some(field => field.customKey === 'extra-empty' && field.section === 'skills'));
  assert.doesNotMatch(JSON.stringify(result), /私密值|ignored/);
});

test('覆盖度保留现有 canonical 优先策略，并只为语言兼容空 canonical 回退', () => {
  assert.equal(Coverage.fromResume({ internships: [], internship: [{ company: '旧版单位' }] }).sections.internship, undefined);
  assert.equal(Coverage.fromResume({ language: [], languages: [{ language: '英语' }] }).sections.languages.filled, 1);
});

const [html, css, workspaceSource, optionsSource] = await Promise.all([
  readFile(new URL('../../options.html', import.meta.url), 'utf8'),
  readFile(new URL('../../src/ui/options.css', import.meta.url), 'utf8'),
  readFile(new URL('../../src/ui/options-workspace.js', import.meta.url), 'utf8'),
  readFile(new URL('../../options.js', import.meta.url), 'utf8'),
]);

test('Options 使用统一设计系统、分组导航、检查器与保存状态，并保留所有原有资料栏目', () => {
  assert.match(html, /href="src\/ui\/design-tokens\.css"/);
  assert.match(html, /src="src\/ui\/design-system\.js"/);
  for (const id of ['save-state', 'header-coverage', 'profile-inspector', 'coverage-percent', 'coverage-filled', 'coverage-missing', 'coverage-materials', 'module-coverage', 'missing-fields', 'section-selector', 'btn-inspector']) assert.match(html, new RegExp(`id="${id}"`));
  for (const section of ['personal', 'education', 'intention', 'internship', 'work', 'projects', 'research', 'practice', 'awards', 'languages', 'papers', 'intro', 'application', 'family', 'skills']) assert.match(html, new RegExp(`id="sec-${section}"`));
  assert.equal((html.match(/class="nav-group"/g) || []).length, 6);
  assert.match(html, /class="nav-group compatibility-nav"/);
  assert.match(html, /id="sec-ai" hidden/);
});

test('Options 导出菜单和删除对话框提供语义与键盘关闭，导入入口仍支持全部五种格式', () => {
  assert.match(html, /id="export-menu"[^>]+role="menu"[^>]+hidden/);
  assert.match(html, /id="delete-record-dialog"[^>]+aria-modal="true"/);
  assert.match(html, /id="import-zone"[^>]+role="button"[^>]+tabindex="0"/);
  assert.match(html, /accept="\.json,\.md,\.txt,\.docx,\.pdf"/);
  assert.match(workspaceSource, /event\.key === 'Escape'/);
  assert.match(workspaceSource, /event\.key === 'Tab'/);
  assert.match(workspaceSource, /dialog\.showModal\(\)/);
  assert.match(workspaceSource, /previous\?\.isConnected/);
});

test('Options 默认两列表单、长文本可调整、移动端与抽屉响应式不依赖远程资源', () => {
  assert.doesNotMatch(html, /\bg4\b|https?:\/\//);
  assert.doesNotMatch(css, /repeat\(4|font-size\s*:\s*9px|https?:\/\/|@import/);
  assert.match(css, /repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(css, /min-height:120px!important;resize:vertical/);
  assert.match(css, /focus-visible/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /max-width:1199px/);
  assert.match(css, /max-width:759px/);
  assert.match(css, /background:var\(--surface\)/);
});

test('Options 保存状态仅是 UI 投影，编辑时防离开、保存异常受控，不创建存储字段', () => {
  assert.match(workspaceSource, /beforeunload[\s\S]*?if \(!dirty\) return/);
  assert.match(optionsSource, /const revision = globalThis\.JFOptionsWorkspace\?\.beginSave\(\)/);
  assert.match(optionsSource, /JFOptionsWorkspace\?\.saved\(revision\)/);
  assert.match(optionsSource, /JFOptionsWorkspace\?\.failed\('save'\)/);
  assert.doesNotMatch(workspaceSource, /storage\.local\.set|storage\.local\.remove|fetch\s*\(/);
  assert.doesNotMatch(workspaceSource, /MutationObserver|requestAnimationFrame|setInterval/);
  assert.doesNotMatch(optionsSource, /v\('p_weight'\)|getElementById\('skills_tech'\)/);
});
