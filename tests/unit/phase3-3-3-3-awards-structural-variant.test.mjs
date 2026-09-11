import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const Structures = require('../../src/mappings/section-structures.js');
const Fields = require('../../src/mappings/field-aliases.js');
const Matcher = require('../../src/core/field-matcher.js');
const ArrayHandler = require('../../src/core/array-handler.js');
const EmbeddedSectionDetector = require('../../src/core/embedded-section-detector.js');

const testDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(testDirectory, '..', '..');
const optionsSource = await readFile(resolve(projectRoot, 'options.js'), 'utf8');
const cutoff = optionsSource.indexOf('// 导入统一入口');
assert.ok(cutoff > 0, '无法定位 options.js 的纯函数测试边界');
const optionsContext = vm.createContext({});
vm.runInContext(`${optionsSource.slice(0, cutoff)}
globalThis.__awardsVariant = {
  AWARD_STRING_FIELDS,
  validateImportPayload,
  inspectAwardsPayload,
  normalizeAwardItem,
  normalizeResumeData,
  awardTemplate,
  collectItem,
};`, optionsContext, { filename: 'options-awards-variant-functions.js' });
const OptionsPage = optionsContext.__awardsVariant;

function inOptionsContext(value) {
  optionsContext.__jsonInput = JSON.stringify(value);
  return vm.runInContext('JSON.parse(__jsonInput)', optionsContext);
}

const LEGACY_HEADERS = Object.freeze(['时间', '内容', '级别', '排名']);
const COMPETITION_HEADERS = Object.freeze(['竞赛级别', '获奖等级', '获奖名称', '个人/团队', '个人排名']);
const REGION_SELECTOR = 'table,[role="table"],fieldset,[data-repeat-list],[data-array-list]';

function selectorParts(selector) {
  return String(selector || '').split(',').map(part => part.trim()).filter(Boolean);
}

function isHeaderSelector(selector) {
  return /\bth\b|thead td|first-child td|columnheader/.test(String(selector || ''));
}

function isControlSelector(selector) {
  return /input|textarea|select|contenteditable|combobox|file/.test(String(selector || ''));
}

function matches(node, selector) {
  return selectorParts(selector).some(part => {
    const value = part.toLowerCase();
    if (value === 'table') return node.tagName === 'TABLE';
    if (value === '[role="table"]') return node.getAttribute('role') === 'table';
    if (value === 'tr' || value === '[role="row"]') return node.tagName === 'TR';
    if (value === 'th' || value === '[role="columnheader"]') return node.tagName === 'TH';
    if (value === 'input' || value.startsWith('input:') || value.startsWith('input[')) return node.tagName === 'INPUT';
    if (value === 'button' || value === '[role="button"]') return node.tagName === 'BUTTON';
    if (value === 'fieldset') return node.tagName === 'FIELDSET';
    if (value === '[data-repeat-list]') return node.hasAttribute('data-repeat-list');
    if (value === '[data-array-list]') return node.hasAttribute('data-array-list');
    if (value === '[data-repeat-item]') return node.hasAttribute('data-repeat-item');
    if (value === '[data-array-item]') return node.hasAttribute('data-array-item');
    return false;
  });
}

function element(tagName, options = {}) {
  const attributes = new Map(Object.entries(options.attributes || {}));
  return {
    nodeType: 1,
    tagName: String(tagName).toUpperCase(),
    type: options.type || '',
    ownText: options.text || '',
    hidden: false,
    disabled: false,
    readOnly: false,
    isConnected: true,
    parentElement: null,
    ownerDocument: null,
    children: [],
    get innerText() {
      return [this.ownText, ...this.children.map(child => child.innerText || child.textContent || '')]
        .filter(Boolean).join(' ');
    },
    get textContent() { return this.innerText; },
    append(...children) {
      children.flat().filter(Boolean).forEach(child => {
        child.parentElement = this;
        child.ownerDocument = this.ownerDocument;
        this.children.push(child);
      });
      return this;
    },
    hasAttribute(name) { return attributes.has(name); },
    getAttribute(name) { return attributes.has(name) ? attributes.get(name) : null; },
    matches(selector) { return matches(this, selector); },
    closest(selector) {
      let current = this;
      while (current) {
        if (current.matches?.(selector)) return current;
        current = current.parentElement;
      }
      return null;
    },
    contains(other) {
      let current = other;
      while (current) {
        if (current === this) return true;
        current = current.parentElement;
      }
      return false;
    },
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
    querySelectorAll(selector) {
      const descendants = [];
      const walk = current => current.children.forEach(child => {
        descendants.push(child);
        walk(child);
      });
      walk(this);
      if (isHeaderSelector(selector)) return descendants.filter(child => child.tagName === 'TH');
      if (isControlSelector(selector)) return descendants.filter(child => child.tagName === 'INPUT');
      if (/button|role="button"/.test(String(selector || ''))) {
        return descendants.filter(child => child.tagName === 'BUTTON');
      }
      return descendants.filter(child => matches(child, selector));
    },
    getBoundingClientRect() { return { width: 640, height: 40, left: 0, top: 0 }; },
  };
}

function makeTable(headers, rowCount) {
  const table = element('table');
  const headerRow = element('tr');
  headerRow.append(headers.map(header => element('th', { text: header })));
  table.append(headerRow);
  const rows = [];
  for (let index = 0; index < rowCount; index += 1) {
    const row = element('tr');
    row.append(headers.map(() => element('input', { type: 'text' })));
    table.append(row);
    rows.push(row);
  }
  return { table, rows };
}

function attachDocument(...regions) {
  const root = element('main');
  root.append(regions);
  const document = {
    nodeType: 9,
    location: { href: 'https://example.test/application' },
    defaultView: {
      getComputedStyle() { return { display: 'block', visibility: 'visible', opacity: '1' }; },
    },
    body: root,
    documentElement: root,
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
    querySelectorAll(selector) {
      if (String(selector) === REGION_SELECTOR) return regions;
      return root.querySelectorAll(selector);
    },
  };
  const bind = node => {
    node.ownerDocument = document;
    node.children.forEach(bind);
  };
  bind(root);
  return document;
}

function fieldDescriptor(labelText, controlKind = 'text') {
  return {
    detectorId: `awards-${labelText}`,
    element: null,
    section: 'awards',
    context: {
      sectionId: 'awards', collection: 'awards', collectionMode: 'repeatable', confidence: 0.98,
      indexContext: { section: 'awards', collection: 'awards', index: 0, awards: 0 },
    },
    controlKind,
    type: controlKind,
    labelText,
    tableHeader: labelText,
    placeholder: '', ariaLabel: '', name: '', id: '', title: '', groupText: '', nearbyText: '', parentText: '',
    visible: true, hidden: false, disabled: false, readOnly: false, options: [],
  };
}

test('awards 结构定义保留 legacy，并以独立 OR variant 注册 competition 5-column', () => {
  const definition = Structures.definitionForSection('awards');
  assert.ok(definition);
  assert.equal(definition.headerVariants.length, 2);
  const legacy = definition.headerVariants.find(variant => variant.id === 'legacy');
  const competition = definition.headerVariants.find(variant => variant.id === 'competition-award');
  assert.equal(legacy.minHeaderGroups, 3);
  assert.equal(legacy.headerGroups.length, 4);
  assert.equal(competition.minHeaderGroups, 4);
  assert.equal(competition.headerGroups.length, 5);
  assert.deepEqual(competition.headerGroups.map(group => group[0]), COMPETITION_HEADERS);
  assert.equal(Object.isFrozen(definition.headerVariants), true);
});

test('competition awards 5/5 与任意明确 4/5 作为一个 variant 达标，3/5 不达标', () => {
  const full = Structures.scoreHeaderGroups(COMPETITION_HEADERS, 'awards');
  assert.equal(full.qualifies, true);
  assert.equal(full.variantId, 'competition-award');
  assert.equal(full.matchedCount, 5);
  for (let missing = 0; missing < COMPETITION_HEADERS.length; missing += 1) {
    const headers = COMPETITION_HEADERS.filter((_header, index) => index !== missing);
    const score = Structures.scoreHeaderGroups(headers, 'awards');
    assert.equal(score.qualifies, true, `missing ${COMPETITION_HEADERS[missing]}`);
    assert.equal(score.variantId, 'competition-award');
    assert.equal(score.required, 4);
  }
  assert.equal(Structures.scoreHeaderGroups(COMPETITION_HEADERS.slice(0, 3), 'awards').qualifies, false);
});

test('legacy/new 表头证据不能跨 variant 平铺凑阈值', () => {
  const mixed = ['时间', '内容', '竞赛级别', '获奖名称'];
  const score = Structures.scoreHeaderGroups(mixed, 'awards');
  assert.equal(score.qualifies, false);
  assert.equal(Structures.selectBestDefinitionForHeaders(mixed), null);
});

test('带装饰词的明确 competition 表头仍归 competition owner，不能被 legacy 泛词偷走', () => {
  const competition = Structures.scoreHeaderGroups([
    '竞赛级别（必填）', '获奖等级（必填）', '获奖名称（必填）', '个人/团队（必填）',
  ], 'awards');
  assert.equal(competition.qualifies, true);
  assert.equal(competition.variantId, 'competition-award');

  for (const mixed of [
    ['时间', '内容', '竞赛级别（必填）', '获奖名称（必填）'],
    ['时间', '内容', '个人排名（选填）', '获奖名称（必填）'],
  ]) {
    const score = Structures.scoreHeaderGroups(mixed, 'awards');
    assert.equal(score.qualifies, false, JSON.stringify({ mixed, score }));
    assert.equal(Structures.selectBestDefinitionForHeaders(mixed), null);
  }
});

test('两个普通 label 且无 repeatable table 不能被识别为 awards region', () => {
  const fieldset = element('fieldset');
  fieldset.append(element('span', { text: '获奖名称' }), element('span', { text: '个人排名' }));
  const document = attachDocument(fieldset);
  assert.equal(Structures.selectBestDefinitionForHeaders(['获奖名称', '个人排名']), null);
  assert.deepEqual(EmbeddedSectionDetector.detect(document), []);
});

test('new awards table 通过 owned structural evidence 识别 repeatable，多行 index 隔离', () => {
  const { table, rows } = makeTable(COMPETITION_HEADERS, 3);
  const document = attachDocument(table);
  const candidate = EmbeddedSectionDetector.detect(document)[0];
  assert.ok(candidate);
  assert.equal(candidate.collection, 'awards');
  assert.equal(candidate.collectionMode, 'repeatable');
  assert.equal(candidate.evidenceKind, 'structural-headers');
  assert.equal(candidate.groupCount, 3);

  const groups = ArrayHandler.detectGroups(table, { ownedOnly: true });
  const mapped = ArrayHandler.mapGroups({ sectionId: 'awards', collection: 'awards' }, groups);
  assert.deepEqual(groups, rows);
  assert.deepEqual(mapped.map(item => item.index), [0, 1, 2]);
  assert.equal(new Set(mapped.map(item => item.groupId)).size, 3);
});

test('JSON 少于 new awards 页面行时永不删除或缩减已有行', async () => {
  const { table, rows } = makeTable(COMPETITION_HEADERS, 3);
  attachDocument(table);
  const before = [...rows];
  const result = await ArrayHandler.prepare(
    { sectionId: 'awards', collection: 'awards', collectionMode: 'repeatable' },
    [{ name: '仅一条 JSON 奖项' }],
    table,
    { collectionMode: 'repeatable' },
  );
  assert.equal(result.ok, true, result.error);
  assert.equal(ArrayHandler.detectGroups(table).length, 3);
  assert.deepEqual(table.children.slice(1), before);
  assert.equal(result.clicks, 0);
});

test('legacy 时间/内容/级别/排名结构和多行检测保持不变', () => {
  const score = Structures.scoreHeaderGroups(LEGACY_HEADERS, 'awards');
  assert.equal(score.qualifies, true);
  assert.equal(score.variantId, 'legacy');
  const { table } = makeTable(LEGACY_HEADERS, 2);
  const document = attachDocument(table);
  const candidate = EmbeddedSectionDetector.detect(document)[0];
  assert.equal(candidate.collection, 'awards');
  assert.equal(candidate.groupCount, 2);
});

test('awards minimal schema 区分 level/rank/name/participationMode/individualRank/teamRank', () => {
  assert.equal(Fields.FIELD_TYPES['awards[].participationMode'], 'choice');
  assert.equal(Fields.FIELD_TYPES['awards[].individualRank'], 'text');
  assert.ok(Fields.FIELD_ALIASES['awards[].level'].includes('竞赛级别'));
  assert.ok(Fields.FIELD_ALIASES['awards[].rank'].includes('获奖等级'));
  assert.ok(Fields.FIELD_ALIASES['awards[].name'].includes('获奖名称'));
  assert.ok(Fields.FIELD_ALIASES['awards[].participationMode'].includes('个人/团队'));
  assert.ok(Fields.FIELD_ALIASES['awards[].individualRank'].includes('个人排名'));
  assert.equal(Fields.FIELD_ALIASES['awards[].teamRank'].includes('个人排名'), false);
});

test('新结构的五个字段各自匹配 canonical path，个人排名不再占用 teamRank', () => {
  const resume = {
    awards: [{
      level: '国家级', rank: '一等奖', name: '示例奖项', participationMode: '团队',
      individualRank: '2', teamRank: '2/5',
    }],
  };
  const cases = [
    ['竞赛级别', 'awards[].level', 'native-select'],
    ['获奖等级', 'awards[].rank', 'native-select'],
    ['获奖名称', 'awards[].name', 'text'],
    ['个人/团队', 'awards[].participationMode', 'native-select'],
    ['个人排名', 'awards[].individualRank', 'text'],
  ];
  for (const [label, expectedPath, kind] of cases) {
    const match = Matcher.matchField(fieldDescriptor(label, kind), resume, {
      section: 'awards',
      sectionContext: fieldDescriptor(label, kind).context,
      arrayContext: { section: 'awards', collection: 'awards', index: 0, awards: 0 },
    });
    assert.equal(match.status, 'MATCHED', `${label}: ${match.reason}`);
    assert.equal(match.matchedPath, expectedPath, label);
  }
});

test('FieldAliases/options 两条 normalizer 同步新字段，且 individualRank/teamRank 绝不互相复制', () => {
  const source = {
    time: '2026-01', content: '示例奖项', participation_mode: '团队', individual_rank: '2', team_rank: '2/5',
  };
  const runtime = Fields.buildResumeView({ awards: [source] }).awards[0];
  const editor = OptionsPage.normalizeAwardItem(inOptionsContext(source));
  for (const item of [runtime, editor]) {
    assert.equal(item.participationMode, '团队');
    assert.equal(item.individualRank, '2');
    assert.equal(item.teamRank, '2/5');
  }

  const teamOnlyRuntime = Fields.buildResumeView({ awards: [{ teamRank: '1/4' }] }).awards[0];
  const individualOnlyRuntime = Fields.buildResumeView({ awards: [{ individualRank: '1' }] }).awards[0];
  const teamOnlyEditor = OptionsPage.normalizeAwardItem(inOptionsContext({ teamRank: '1/4' }));
  const individualOnlyEditor = OptionsPage.normalizeAwardItem(inOptionsContext({ individualRank: '1' }));
  assert.equal(teamOnlyRuntime.individualRank ?? '', '');
  assert.equal(teamOnlyEditor.individualRank ?? '', '');
  assert.equal(individualOnlyRuntime.teamRank ?? '', '');
  assert.equal(individualOnlyEditor.teamRank ?? '', '');
});

test('options awards 校验新字段类型，并以两个独立 canonical 控件 round-trip', () => {
  assert.ok(OptionsPage.AWARD_STRING_FIELDS.includes('participationMode'));
  assert.ok(OptionsPage.AWARD_STRING_FIELDS.includes('individualRank'));
  const valid = inOptionsContext({
    awards: [{ time: '2026-01', content: '示例奖项', participationMode: '团队', individualRank: '2', teamRank: '2/5' }],
  });
  assert.equal(OptionsPage.validateImportPayload(valid), valid);
  assert.equal(OptionsPage.inspectAwardsPayload(valid).valid, true);
  const invalid = inOptionsContext({
    awards: [{ time: '2026-01', content: '示例奖项', participationMode: {}, individualRank: [] }],
  });
  assert.equal(OptionsPage.inspectAwardsPayload(invalid).valid, false);

  const html = OptionsPage.awardTemplate(valid.awards[0]);
  assert.match(html, /data-key="participationMode"[^>]*value="团队"/);
  assert.match(html, /data-key="individualRank"[^>]*value="2"/);
  const controls = [
    ['time', '2026-01'], ['content', '示例奖项'], ['participationMode', '团队'],
    ['individualRank', '2'], ['teamRank', '2/5'],
  ].map(([key, value]) => ({ dataset: { key }, value }));
  const collected = OptionsPage.collectItem({ querySelectorAll: () => controls });
  const roundTripped = OptionsPage.normalizeAwardItem(collected);
  assert.equal(roundTripped.participationMode, '团队');
  assert.equal(roundTripped.individualRank, '2');
  assert.equal(roundTripped.teamRank, '2/5');
});

test('awards snake_case 新键必须执行与 canonical 相同的导入字符串类型校验', () => {
  for (const key of ['participation_mode', 'individual_rank']) {
    const invalid = inOptionsContext({
      awards: [{ time: '2026-01', content: '示例奖项', [key]: { private: 'not-a-string' } }],
    });
    assert.throws(
      () => OptionsPage.validateImportPayload(invalid),
      new RegExp(`awards\\[0\\]\\.${key} 必须是字符串`),
      key,
    );
    assert.equal(OptionsPage.inspectAwardsPayload(invalid).valid, false, key);
  }
});
