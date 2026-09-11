import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../src/core/array-handler.js');
const SectionStructures = require('../../src/mappings/section-structures.js');
const EmbeddedSectionDetector = require('../../src/core/embedded-section-detector.js');

const REGION_SELECTOR = 'table,[role="table"],fieldset,[data-repeat-list],[data-array-list]';

function fixtureElement(tagName, text = '') {
  const node = {
    nodeType: 1,
    tagName: String(tagName).toUpperCase(),
    type: '', hidden: false, disabled: false, readOnly: false, isConnected: true,
    parentElement: null, ownerDocument: null, children: [], ownText: text,
    get childNodes() { return this.children; },
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
    hasAttribute() { return false; },
    getAttribute(name) { return name === 'role' ? null : null; },
    matches(selector) {
      return String(selector || '').split(',').map(part => part.trim()).some(part => {
        if (part === 'table') return this.tagName === 'TABLE';
        if (part === 'tr') return this.tagName === 'TR';
        if (part === 'th') return this.tagName === 'TH';
        if (part === 'fieldset') return this.tagName === 'FIELDSET';
        return false;
      });
    },
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
      const source = String(selector || '');
      if (/\bth\b|thead td|first-child td|columnheader/.test(source)) {
        return descendants.filter(child => child.tagName === 'TH');
      }
      if (/input|textarea|select|contenteditable|combobox|file/.test(source)) return [];
      if (/button|role="button"|\ba\b/.test(source)) return [];
      return descendants.filter(child => child.matches?.(selector));
    },
    getBoundingClientRect() { return { width: 640, height: 40, left: 0, top: 0 }; },
  };
  return node;
}

function zeroRowPaperDocument(headers) {
  const table = fixtureElement('table');
  table.id = 'papers-table';
  table.append(fixtureElement('tr').append(headers.map(header => fixtureElement('th', header))));
  const document = {
    nodeType: 9,
    location: { href: 'https://example.test/application' },
    defaultView: { getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }) },
    body: table,
    documentElement: table,
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
    querySelectorAll(selector) {
      return String(selector) === REGION_SELECTOR ? [table] : table.querySelectorAll(selector);
    },
  };
  const bind = current => {
    current.ownerDocument = document;
    current.children.forEach(bind);
  };
  bind(table);
  return { document, table };
}

const fixtureUrl = new URL('../fixtures/compound-ant-application.html', import.meta.url);
const scriptUrl = new URL('../fixtures/compound-ant-application.js', import.meta.url);

const [html, script] = await Promise.all([
  readFile(fixtureUrl, 'utf8'),
  readFile(scriptUrl, 'utf8'),
]);

test('复合申请夹具使用严格 CSP 与本地资源，不依赖网络', () => {
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /connect-src 'none'/);
  assert.match(html, /src="compound-ant-application\.js"/);
  assert.match(html, /href="compound-ant-application\.css"/);
  assert.doesNotMatch(html, /https?:\/\//i);
});

test('外层 fieldset 与真实 family 表格并存，family 固定五行', () => {
  assert.match(html, /<fieldset id="application-shell">/);
  assert.match(html, /id="outer-generic-copy"[\s\S]*?时间[\s\S]*?内容[\s\S]*?级别[\s\S]*?排名/);
  const family = html.match(/<table id="family-table">([\s\S]*?)<\/table>/)?.[1] || '';
  assert.match(family, /家庭|与本人关系|在何单位工作任何职务|联系电话/);
  assert.equal((family.match(/<tbody>[\s\S]*?<\/tbody>/)?.[0].match(/<tr>/g) || []).length, 5);
});

test('夹具同时覆盖主区、教育 singleton、零行论文与上传材料', () => {
  for (const expected of ['基本信息', '教育信息', '本科院系', '大学英语四级成绩', '论文成果', '上传材料']) {
    assert.ok(html.includes(expected), `缺少夹具语义：${expected}`);
  }
  assert.match(html, /<table id="papers-table">[\s\S]*?<tbody><\/tbody>[\s\S]*?<\/table>/);
  assert.equal((html.match(/type="file"/g) || []).length, 2);
});

test('五个基本信息字段使用 wrapper-owned Ant custom select 与各自受控 listbox', () => {
  for (const [id, label] of [
    ['id-type', '证件类型'],
    ['gender', '性别'],
    ['political', '政治面貌'],
    ['ethnicity', '民族'],
    ['marital', '婚姻状况'],
  ]) {
    assert.match(html, new RegExp(`id="${id}-label"[^>]*>${label}<`));
    assert.match(html, new RegExp(`id="${id}"[^>]*class="[^"]*ant-select-selector[^"]*"[^>]*role="combobox"`));
    assert.match(html, new RegExp(`id="${id}"[^>]*aria-controls="${id}-listbox"`));
    assert.match(html, new RegExp(`id="${id}-input"[^>]*class="[^"]*ant-select-selection-search-input`));
    assert.match(html, new RegExp(`id="${id}-listbox"[^>]*role="listbox"`));
  }
  assert.equal((html.match(/data-ant-select="true"/g) || []).length, 5);
  assert.match(script, /customSelectOpenClicks/);
  assert.match(script, /customSelectOptionClicks/);
});

test('三个 readonly 日期分别绑定本地面板，图片查看器含干扰 Previous/Next', () => {
  for (const id of ['birthday', 'enrollment', 'graduation']) {
    assert.match(html, new RegExp(`id="${id}"[^>]*readonly`));
    assert.match(html, new RegExp(`aria-controls="${id}-panel"`));
  }
  for (const id of ['birthday', 'enrollment', 'graduation']) {
    assert.match(html, new RegExp(`id="${id}-panel"[^>]*data-calendar-mode="DAY"`));
  }
  assert.equal((html.match(/data-calendar-mode-switch="MONTH"/g) || []).length, 2);
  assert.match(html, /<a class="ant-calendar-month-select"(?![^>]*data-calendar-mode-switch)[^>]*href="#"/);
  assert.match(html, /<a class="ant-calendar-year-select"(?![^>]*data-calendar-mode-switch)[^>]*href="#"/);
  assert.match(script, /data-calendar-weekday/);
  assert.match(html, /id="image-viewer"[\s\S]*?>Previous<[\s\S]*?>Next</);
});

test('暂存、下一步与最终提交均有独立计数，夹具不含站点特例', () => {
  assert.match(html, /id="draft" type="button">暂存/);
  assert.match(html, /id="next-step" type="button" aria-label="Next">下一步/);
  assert.match(html, /id="final-submit" type="submit">提交申请/);
  for (const counter of ['draft', 'next', 'submit', 'addPaper', 'viewerPrevious', 'viewerNext']) {
    assert.match(script, new RegExp(`${counter}: 0`));
  }
  assert.match(script, /dataset\.calendarMode/);
  assert.match(script, /attemptedNetworkRequests/);
  assert.doesNotMatch(`${html}\n${script}`, /hostname|location\.host|siteAdapterConfigs|data-test/i);
});

test('Custom Select V2 fixture exposes multiple internal inputs behind one external labelled logical root', () => {
  for (const id of ['id-type', 'gender', 'political', 'ethnicity', 'marital']) {
    assert.match(html, new RegExp(`id="${id}"[^>]*role="combobox"[^>]*aria-labelledby="${id}-label"`));
    assert.match(html, new RegExp(`id="${id}-input"[^>]*ant-select-selection-search-input`));
    assert.match(html, new RegExp(`id="${id}-mirror-input"[^>]*ant-select-selection-mirror-input[^>]*aria-hidden="true"`));
    assert.equal((html.match(new RegExp(`aria-labelledby="${id}-label"`, 'g')) || []).length, 2,
      `${id} must expose one external label on the logical root and one actionable internal input only`);
  }
  assert.doesNotMatch(script, /-mirror-input['"]?\)\.addEventListener/);
});

test('fixture contains four independently owned Cascaders whose lower columns are appended in the same overlay', () => {
  for (const [id, panelId] of [
    ['hometown-cascader', 'hometown-cascader-panel'],
    ['birthplace-region-cascader', 'birthplace-region-cascader-panel'],
    ['household-region-cascader', 'household-region-cascader-panel'],
    ['archive-region-cascader', 'archive-region-cascader-panel'],
  ]) {
    assert.match(html, new RegExp(`id="${id}"[^>]*role="combobox"[^>]*aria-controls="${panelId}"`));
    assert.match(html, new RegExp(`id="${panelId}"[^>]*ant-cascader-menus`));
    assert.match(html, new RegExp(`id="${panelId}-level-0"[^>]*data-cascader-level="0"`));
    assert.doesNotMatch(html, new RegExp(`id="${panelId}-level-[12]"`));
  }
  assert.match(script, /cascaderTriggerClicks/);
  assert.match(script, /cascaderOptionClicks/);
  assert.match(script, /aria-controls/);
  assert.match(script, /activeCascaderPanel/);
  assert.match(script, /panel\.append\(menu\)/);
});

test('zero-row papers fixture separates journalType, journal, status, and authorRank', () => {
  const papers = html.match(/<table id="papers-table">([\s\S]*?)<\/table>/)?.[1] || '';
  for (const heading of ['期刊类型', '期刊名称', '发表状态', '作者排名']) {
    assert.ok(papers.includes(heading), `missing papers heading: ${heading}`);
  }
  assert.match(papers, /<tbody><\/tbody>/);
  assert.match(script, /createPaperRow/);
  assert.match(script, /paperJournalType/);
  assert.match(script, /paperStatus/);
  assert.match(script, /paperAuthorRank/);
});

test('zero-row papers fixture qualifies through authoritative structure scoring and topology detection', () => {
  const papers = html.match(/<table id="papers-table">([\s\S]*?)<\/table>/)?.[1] || '';
  const headerSource = papers.match(/<thead><tr>([\s\S]*?)<\/tr><\/thead>/)?.[1] || '';
  const headers = [...headerSource.matchAll(/<th>([^<]+)<\/th>/g)].map(match => match[1].trim());
  assert.deepEqual(headers, ['时间', '成果名称', '期刊类型', '期刊名称', '发表状态', '作者排名']);

  const score = SectionStructures.scoreHeaderGroups(headers, 'papers');
  assert.equal(score.qualifies, true, JSON.stringify(score));
  assert.ok(score.matchedCount >= score.required, JSON.stringify(score));

  const fixture = zeroRowPaperDocument(headers);
  const topology = EmbeddedSectionDetector.detect(fixture.document)
    .find(candidate => candidate.runtimeRoot === fixture.table && candidate.collection === 'papers');
  assert.ok(topology, 'papers zero-row table must remain in embedded topology');
  assert.equal(topology.groupCount, 0);
  assert.equal(topology.zeroRow, true);
  assert.equal(topology.collectionMode, 'repeatable');
});

test('competition awards fixture has the exact five-column structural variant and multiple existing rows', () => {
  const awards = html.match(/<table id="competition-awards-table">([\s\S]*?)<\/table>/)?.[1] || '';
  for (const heading of ['竞赛级别', '获奖等级', '获奖名称', '个人/团队', '个人排名']) {
    assert.ok(awards.includes(heading), `missing awards heading: ${heading}`);
  }
  const body = awards.match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1] || '';
  assert.equal((body.match(/<tr/g) || []).length, 2);
  assert.match(html, /id="add-competition-award"/);
  assert.equal((body.match(/class="delete-award"/g) || []).length, 2);
});

test('three readonly date fields model legacy/modern overlap and popup replacement transitions', () => {
  assert.match(html, /id="birthday"[^>]*data-calendar-transition="legacy-overlap"/);
  assert.match(html, /id="enrollment"[^>]*data-calendar-transition="modern-replacement"/);
  assert.match(html, /id="graduation"[^>]*data-calendar-transition="modern-overlap"/);
  assert.match(script, /calendarTransitionStates/);
  assert.match(script, /replaceCalendarPanel/);
  assert.match(script, /retireStaleCalendarPanels/);
});

test('fixture preserves fixed-five and zero-row structures and instruments every dangerous control', () => {
  const family = html.match(/<table id="family-table">([\s\S]*?)<\/table>/)?.[1] || '';
  const internships = html.match(/<table id="work-history-table">([\s\S]*?)<\/table>/)?.[1] || '';
  const papers = html.match(/<table id="papers-table">([\s\S]*?)<\/table>/)?.[1] || '';
  assert.equal((family.match(/<tbody>[\s\S]*?<\/tbody>/)?.[0].match(/<tr>/g) || []).length, 5);
  assert.equal((internships.match(/<tbody>[\s\S]*?<\/tbody>/)?.[0].match(/<tr>/g) || []).length, 5);
  assert.equal((papers.match(/<tbody>[\s\S]*?<\/tbody>/)?.[0].match(/<tr>/g) || []).length, 0);
  for (const counter of [
    'draft', 'next', 'submit', 'addPaper', 'addAward', 'deleteAward',
    'viewerPrevious', 'viewerNext',
  ]) {
    assert.match(script, new RegExp(`${counter}: 0`));
  }
});
