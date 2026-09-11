import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const Awards = require('../../src/adapters/undergraduate-awards.js');

function element(document, overrides = {}) {
  return {
    nodeType: 1,
    tagName: 'DIV',
    type: '',
    isConnected: true,
    hidden: false,
    disabled: false,
    readOnly: false,
    ownerDocument: document,
    parentElement: null,
    style: {},
    textContent: '',
    innerText: '',
    value: '',
    children: [],
    clickCount: 0,
    getAttribute(name) {
      if (name === 'type') return this.type;
      if (name === 'aria-label') return this.ariaLabel || '';
      return '';
    },
    matches(selector) {
      if (selector.includes('input') && this.tagName === 'INPUT') return true;
      if (selector.includes('button') && this.tagName === 'BUTTON') return true;
      return false;
    },
    closest() { return null; },
    contains(node) { return node === this; },
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
    querySelectorAll() { return []; },
    getBoundingClientRect() { return { width: 120, height: 32, top: 10, left: 10 }; },
    click() { this.clickCount += 1; },
    ...overrides,
  };
}

function awardRow(document, id) {
  const controls = [
    element(document, { tagName: 'INPUT', ariaLabel: '时间' }),
    element(document, { tagName: 'INPUT', ariaLabel: '内容' }),
  ];
  const row = element(document, {
    id,
    contains(node) { return controls.includes(node); },
    querySelectorAll(selector) {
      return selector.includes('input:not') ? controls : [];
    },
  });
  controls.forEach(control => { control.parentElement = row; });
  return row;
}

function fixture({ duplicateConfiguredAdd = false } = {}) {
  let observer = null;
  const document = {
    nodeType: 9,
    title: '奖励情况',
    location: {
      origin: 'https://apply.example.invalid',
      href: 'https://apply.example.invalid/application/awards',
    },
    defaultView: {
      getComputedStyle() { return { display: 'block', visibility: 'visible', opacity: '1', position: 'static' }; },
      MutationObserver: class {
        constructor(callback) { this.callback = callback; }
        observe() { observer = this; }
        disconnect() { if (observer === this) observer = null; }
      },
    },
    body: null,
    querySelector() { return null; },
    querySelectorAll(selector) {
      if (selector.includes('button')) return [outsideAdd];
      return [];
    },
  };
  const rows = [awardRow(document, 'award-1')];
  const insideAdd = element(document, {
    tagName: 'BUTTON', type: 'button', textContent: '新增奖励', innerText: '新增奖励',
  });
  insideAdd.click = () => {
    insideAdd.clickCount += 1;
    const row = awardRow(document, `award-${rows.length + 1}`);
    row.parentElement = root;
    rows.push(row);
    observer?.callback?.([]);
  };
  const secondInsideAdd = element(document, {
    tagName: 'BUTTON', type: 'button', textContent: '新增奖励', innerText: '新增奖励',
  });
  const outsideAdd = element(document, {
    tagName: 'BUTTON', type: 'button', textContent: '新增奖励', innerText: '新增奖励',
  });
  const root = element(document, {
    id: 'profile-awards-root',
    contains(node) {
      return node === insideAdd || node === secondInsideAdd || rows.includes(node)
        || rows.some(row => row.contains(node));
    },
    querySelectorAll(selector) {
      if (selector === '.profile-award-row') return rows;
      if (selector === '.profile-add-award') {
        return duplicateConfiguredAdd ? [insideAdd, secondInsideAdd] : [insideAdd];
      }
      if (selector === 'button,[role="button"],a,input[type="button"]') {
        return duplicateConfiguredAdd ? [insideAdd, secondInsideAdd] : [insideAdd];
      }
      if (selector === 'table') return [];
      return [];
    },
  });
  document.body = element(document, {
    contains(node) { return node === root || node === outsideAdd || root.contains(node); },
    querySelectorAll(selector) {
      if (selector.includes('button')) return [outsideAdd];
      return [];
    },
  });
  rows.forEach(row => { row.parentElement = root; });
  insideAdd.parentElement = root;
  secondInsideAdd.parentElement = root;
  outsideAdd.parentElement = document.body;
  return { document, root, rows, insideAdd, secondInsideAdd, outsideAdd };
}

const sectionConfig = Object.freeze({
  root: '#profile-awards-root',
  groupSelector: '.profile-award-row',
  addButtonSelector: '.profile-add-award',
});

test('Awards fallback 使用 canonical Profile root/group/add，新增不得越出栏目区域', async () => {
  const page = fixture();
  const adapter = Awards.createAdapter(page.document, sectionConfig, { root: page.root });

  assert.equal(adapter.getRows().length, 1);
  assert.equal(adapter.getRows()[0].container, page.rows[0]);
  assert.equal(adapter.findAddButton(), page.insideAdd);
  const result = await adapter.ensureRows(2, { timeoutMs: 250, maxAdds: 2 });
  assert.equal(result.ok, true, result.error);
  assert.equal(result.rowCount, 2);
  assert.equal(page.insideAdd.clickCount, 1);
  assert.equal(page.outsideAdd.clickCount, 0);
});

test('Awards fallback 的 configured add selector 多匹配时 fail-closed，且不退回全页第一个按钮', async () => {
  const page = fixture({ duplicateConfiguredAdd: true });
  const adapter = Awards.createAdapter(page.document, sectionConfig, { root: page.root });

  assert.equal(adapter.findAddButton(), null);
  const result = await adapter.ensureRows(2, { timeoutMs: 100, maxAdds: 2 });
  assert.equal(result.ok, false);
  assert.equal(page.insideAdd.clickCount + page.secondInsideAdd.clickCount + page.outsideAdd.clickCount, 0);
});

test('Awards fallback 没有可信奖励区域时不得把 document/body 的唯一新增按钮当成栏目按钮', async () => {
  const page = fixture();
  const adapter = Awards.createAdapter(page.document, {}, { root: page.document });

  assert.equal(adapter.getRows().length, 0);
  assert.equal(adapter.findAddButton(), null);
  const result = await adapter.ensureRows(1, { timeoutMs: 100, maxAdds: 1 });
  assert.equal(result.ok, false);
  assert.equal(page.outsideAdd.clickCount, 0);
});

test('Awards fallback broad root 不得点击显式属于其他 collection 的唯一新增按钮', async () => {
  const page = fixture();
  page.root.tagName = 'MAIN';
  const papersOwner = element(page.document, {
    tagName: 'SECTION',
    getAttribute(name) {
      if (name === 'data-section') return 'papers';
      return '';
    },
    contains(node) { return node === page.insideAdd; },
  });
  papersOwner.parentElement = page.root;
  page.insideAdd.parentElement = papersOwner;

  // Keep this intentionally side-effect free: the regression is the forbidden
  // click itself, even though the adapter later notices that awards rows did not grow.
  page.insideAdd.click = () => { page.insideAdd.clickCount += 1; };

  const adapter = Awards.createAdapter(page.document, sectionConfig, { root: page.root });
  const selected = adapter.findAddButton();
  const result = await adapter.ensureRows(2, { timeoutMs: 100, maxAdds: 1 });

  assert.deepEqual(
    {
      selectedWrongCollectionAdd: selected === page.insideAdd,
      wrongCollectionClicks: page.insideAdd.clickCount,
      outcome: result.ok,
    },
    {
      selectedWrongCollectionAdd: false,
      wrongCollectionClicks: 0,
      outcome: false,
    },
  );
});

test('AutofillEngine 将实时 binding 与共享 ArrayHandler 传给 awards row mapper', () => {
  const source = readFileSync(new URL('../../src/core/autofill-engine.js', import.meta.url), 'utf8');
  const arraySource = readFileSync(new URL('../../src/core/array-handler.js', import.meta.url), 'utf8');
  assert.match(source, /AwardsAdapter\.createAdapter\(this\.document,\s*sectionConfig,\s*\{/);
  assert.match(source, /arrayHandler:\s*D\.ArrayHandler/);
  assert.match(source, /groupRoot:\s*awardBinding\.collectionRoot/);
  assert.match(source, /addRoot:\s*awardBinding\.addRoot/);
  assert.doesNotMatch(arraySource, /awardsAdapter\?\.ensureRows|awardsAdapter\.ensureRows/);
});
