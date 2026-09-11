import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ArrayHandler = require('../../src/core/array-handler.js');

const ACTION_SELECTOR = 'button,[role="button"],a,input[type="button"]';

function createDocument() {
  return {
    nodeType: 9,
    location: {
      href: 'https://example.test/application',
      origin: 'https://example.test',
    },
    body: null,
    defaultView: {
      getComputedStyle(node) {
        return node.style || {
          display: 'block',
          visibility: 'visible',
          opacity: '1',
        };
      },
    },
  };
}

function createNode(tagName, options = {}) {
  const attributes = { ...(options.attributes || {}) };
  const node = {
    nodeType: 1,
    tagName: String(tagName).toUpperCase(),
    type: options.type || '',
    role: options.role || '',
    className: options.className || '',
    hidden: Boolean(options.hidden),
    disabled: Boolean(options.disabled),
    isConnected: true,
    style: {
      display: 'block',
      visibility: 'visible',
      opacity: '1',
    },
    innerText: options.text || '',
    textContent: options.text || '',
    value: options.value || '',
    title: options.title || '',
    id: options.id || '',
    name: options.name || '',
    parentElement: null,
    ownerDocument: null,
    children: [],
    append(...children) {
      for (const child of children) {
        child.parentElement = this;
        child.ownerDocument = this.ownerDocument;
        this.children.push(child);
        assignDocument(child, this.ownerDocument);
      }
      return children.at(-1) || null;
    },
    contains(candidate) {
      if (candidate === this) return true;
      return this.children.some(child => child.contains?.(candidate));
    },
    getAttribute(name) {
      if (name === 'type') return this.type || null;
      if (name === 'role') return this.role || null;
      if (name === 'class') return this.className || null;
      if (name === 'id') return this.id || null;
      if (name === 'name') return this.name || null;
      if (name === 'title') return this.title || null;
      if (name === 'aria-label') return attributes['aria-label'] || null;
      if (name === 'aria-hidden') return this.hidden ? 'true' : attributes['aria-hidden'] || null;
      if (name === 'aria-disabled') return this.disabled ? 'true' : attributes['aria-disabled'] || null;
      return Object.prototype.hasOwnProperty.call(attributes, name)
        ? String(attributes[name])
        : null;
    },
    setAttribute(name, value) {
      attributes[name] = String(value);
    },
    matches(selector) {
      const source = String(selector || '');
      if (source.includes(':disabled') && this.disabled) return true;
      if (source.includes('[hidden]') && this.hidden) return true;
      if (source.includes('input[type="hidden"]') && this.tagName === 'INPUT' && this.type === 'hidden') return true;
      if (source === 'table,[role="table"]') return this.tagName === 'TABLE' || this.role === 'table';
      return false;
    },
    closest(selector) {
      const source = String(selector || '');
      let current = this;
      while (current) {
        if (source === 'form' && current.tagName === 'FORM') return current;
        if (source.includes('#__jf_panel__') && ['__jf_panel__', '__jf_modal__'].includes(current.id)) return current;
        current = current.parentElement;
      }
      return null;
    },
    querySelector(selector) {
      return this.querySelectorAll(selector)[0] || null;
    },
    querySelectorAll(selector) {
      const source = String(selector || '');
      const descendants = flatten(this.children);
      if (source === ACTION_SELECTOR || source.startsWith(ACTION_SELECTOR)) {
        return descendants.filter(isActionNode);
      }
      if (source.startsWith('input') || source.includes('textarea') || source.includes('combobox')) {
        return descendants.filter(item => ['INPUT', 'TEXTAREA', 'SELECT'].includes(item.tagName));
      }
      return [];
    },
  };
  return node;
}

function createAction(text, options = {}) {
  const button = createNode('button', {
    text,
    type: options.type || 'button',
    disabled: options.disabled,
  });
  button.clickCount = 0;
  button.click = () => {
    button.clickCount += 1;
    options.onClick?.(button);
  };
  return button;
}

function createGroup(id) {
  const group = createNode('tr', {
    attributes: { 'data-repeat-item': id },
  });
  group.groupId = id;
  return group;
}

function assignDocument(node, document) {
  if (!node || !document) return;
  node.ownerDocument = document;
  node.children?.forEach(child => assignDocument(child, document));
}

function flatten(nodes) {
  return nodes.flatMap(node => [node, ...flatten(node.children || [])]);
}

function isActionNode(node) {
  return node.tagName === 'BUTTON'
    || node.tagName === 'A'
    || node.role === 'button'
    || (node.tagName === 'INPUT' && node.type === 'button');
}

function context(section) {
  return {
    sectionId: section,
    section,
    collection: section,
    collectionMode: 'repeatable',
  };
}

function runtimeOptions(groups, overrides = {}) {
  return {
    collectionMode: 'repeatable',
    timeoutMs: 200,
    maxAdds: 10,
    getGroups: () => [...groups],
    ...overrides,
  };
}

function createPage() {
  const document = createDocument();
  const page = createNode('main');
  assignDocument(page, document);
  document.body = page;
  return { document, page };
}

test('papers 1→2 uses only its section-owned add and the identical second run adds zero', async () => {
  const { page } = createPage();
  const papers = createNode('section', { attributes: { 'data-section': 'papers' } });
  const table = createNode('table');
  const groups = [createGroup('papers-0')];
  const add = createAction('添加', {
    onClick: () => groups.push(createGroup(`papers-${groups.length}`)),
  });
  const remove = createAction('删除', {
    onClick: () => groups.pop(),
  });
  papers.append(table, add, remove);
  page.append(papers);
  const options = runtimeOptions(groups, { addRoot: papers });

  const first = await ArrayHandler.prepare(context('papers'), [{}, {}], table, options);
  const rowsAfterFirstRun = [...groups];
  const second = await ArrayHandler.prepare(context('papers'), [{}, {}], table, options);

  assert.equal(first.ok, true, first.error);
  assert.equal(first.initialCount, 1);
  assert.equal(first.added, 1);
  assert.equal(first.clicks, 1);
  assert.deepEqual(first.groupContexts.map(item => item.index), [0, 1]);
  assert.equal(second.ok, true, second.error);
  assert.equal(second.added, 0);
  assert.equal(second.clicks, 0);
  assert.equal(add.clickCount, 1);
  assert.equal(remove.clickCount, 0);
  assert.deepEqual(groups, rowsAfterFirstRun);
});

test('awards 1→3 adds exactly two rows, reruns with zero add, and shorter JSON never deletes', async () => {
  const { page } = createPage();
  const awards = createNode('fieldset', { attributes: { 'data-section': 'awards' } });
  const table = createNode('table');
  const groups = [createGroup('awards-0')];
  const add = createAction('新增', {
    onClick: () => groups.push(createGroup(`awards-${groups.length}`)),
  });
  const remove = createAction('删除', {
    onClick: () => groups.pop(),
  });
  awards.append(table, add, remove);
  page.append(awards);
  const options = runtimeOptions(groups, { addRoot: awards });

  const first = await ArrayHandler.prepare(context('awards'), [{}, {}, {}], table, options);
  const rowsAfterFirstRun = [...groups];
  const second = await ArrayHandler.prepare(context('awards'), [{}, {}, {}], table, options);
  const shorter = await ArrayHandler.prepare(context('awards'), [{}], table, options);

  assert.equal(first.ok, true, first.error);
  assert.equal(first.added, 2);
  assert.equal(first.clicks, 2);
  assert.deepEqual(first.groupContexts.map(item => item.index), [0, 1, 2]);
  assert.equal(second.ok, true, second.error);
  assert.equal(second.clicks, 0);
  assert.equal(shorter.ok, true, shorter.error);
  assert.equal(shorter.clicks, 0);
  assert.equal(add.clickCount, 2);
  assert.equal(remove.clickCount, 0);
  assert.deepEqual(groups, rowsAfterFirstRun);
});

test('identical add labels across sibling sections select only the owner of the exact group root', async () => {
  const { page } = createPage();
  const papers = createNode('section', { attributes: { 'data-section': 'papers' } });
  const awards = createNode('section', { attributes: { 'data-section': 'awards' } });
  const papersTable = createNode('table');
  const awardsTable = createNode('table');
  const paperGroups = [createGroup('papers-0')];
  const awardGroups = [createGroup('awards-0')];
  const papersAdd = createAction('添加', {
    onClick: () => paperGroups.push(createGroup(`papers-${paperGroups.length}`)),
  });
  const awardsAdd = createAction('添加', {
    onClick: () => awardGroups.push(createGroup(`awards-${awardGroups.length}`)),
  });
  papers.append(papersTable, papersAdd);
  awards.append(awardsTable, awardsAdd);
  page.append(papers, awards);

  const result = await ArrayHandler.prepare(
    context('papers'),
    [{}, {}],
    papersTable,
    runtimeOptions(paperGroups, { addRoot: page }),
  );

  assert.equal(result.ok, true, result.error);
  assert.equal(papersAdd.clickCount, 1);
  assert.equal(awardsAdd.clickCount, 0);
  assert.equal(paperGroups.length, 2);
  assert.equal(awardGroups.length, 1);
});

test('nested wrapper accepts the nearest outer owner add but rejects a same-label nested sibling add', async () => {
  const { page } = createPage();
  const owner = createNode('fieldset', { attributes: { 'data-section': 'papers' } });
  const inner = createNode('section');
  const sibling = createNode('section', { attributes: { 'data-section': 'awards' } });
  const table = createNode('table');
  const groups = [createGroup('papers-0')];
  const ownerAdd = createAction('新增', {
    onClick: () => groups.push(createGroup(`papers-${groups.length}`)),
  });
  const siblingAdd = createAction('新增');
  inner.append(table);
  sibling.append(createNode('table'), siblingAdd);
  owner.append(inner, ownerAdd, sibling);
  page.append(owner);

  const result = await ArrayHandler.prepare(
    context('papers'),
    [{}, {}],
    table,
    runtimeOptions(groups, { addRoot: owner }),
  );

  assert.equal(result.ok, true, result.error);
  assert.equal(ownerAdd.clickCount, 1);
  assert.equal(siblingAdd.clickCount, 0);
  assert.equal(groups.length, 2);
});

test('a target table without an owned add never clicks the unique sticky footer/global add', async () => {
  const { page } = createPage();
  const papers = createNode('section', { attributes: { 'data-section': 'papers' } });
  const table = createNode('table');
  const groups = [createGroup('papers-0')];
  const stickyFooter = createNode('footer', { className: 'sticky-footer' });
  const globalGroups = [];
  const globalAdd = createAction('添加', {
    onClick: () => globalGroups.push(createGroup('wrong-region')),
  });
  papers.append(table);
  stickyFooter.append(globalAdd);
  page.append(papers, stickyFooter);

  const result = await ArrayHandler.prepare(
    context('papers'),
    [{}, {}],
    table,
    runtimeOptions(groups, { addRoot: page }),
  );

  assert.equal(result.ok, false);
  assert.match(result.error, /安全新增按钮|未找到/);
  assert.equal(result.clicks, 0);
  assert.equal(globalAdd.clickCount, 0);
  assert.equal(groups.length, 1);
  assert.equal(globalGroups.length, 0);
});

test('a trusted split addRoot supplies its item limit and the disabled second run adds zero', async () => {
  const { page } = createPage();
  const papers = createNode('section', {
    attributes: {
      'data-section': 'papers',
      'data-max-items': '2',
    },
  });
  const table = createNode('table');
  const groups = [createGroup('papers-0')];
  const add = createAction('添加', {
    onClick(button) {
      groups.push(createGroup(`papers-${groups.length}`));
      if (groups.length >= 2) button.disabled = true;
    },
  });
  papers.append(table, add);
  page.append(papers);
  const options = runtimeOptions(groups, { addRoot: papers });

  const first = await ArrayHandler.prepare(context('papers'), [{}, {}, {}, {}], table, options);
  const second = await ArrayHandler.prepare(context('papers'), [{}, {}, {}, {}], table, options);

  assert.equal(first.ok, true, first.error);
  assert.equal(first.itemLimit, 2);
  assert.equal(first.targetCount, 2);
  assert.equal(first.limitedCount, 2);
  assert.equal(first.added, 1);
  assert.equal(first.clicks, 1);
  assert.equal(second.ok, true, second.error);
  assert.equal(second.itemLimit, 2);
  assert.equal(second.added, 0);
  assert.equal(second.clicks, 0);
  assert.equal(add.clickCount, 1);
  assert.equal(add.disabled, true);
  assert.equal(groups.length, 2);
});
