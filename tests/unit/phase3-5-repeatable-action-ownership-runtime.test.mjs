import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Safety = require('../../src/core/safety.js');
const ArrayHandler = require('../../src/core/array-handler.js');

const ACTION_SELECTOR = 'button,[role="button"],a,input[type="button"]';

function createDocument() {
  return {
    nodeType: 9,
    location: { href: 'https://example.test/application', origin: 'https://example.test' },
    defaultView: {
      getComputedStyle(node) {
        return node.style || { display: 'block', visibility: 'visible', opacity: '1' };
      },
    },
  };
}

function createNode(tagName, options = {}) {
  const attributes = { ...(options.attributes || {}) };
  const node = {
    nodeType: 1,
    tagName: tagName.toUpperCase(),
    type: options.type || '',
    role: options.role || '',
    hidden: Boolean(options.hidden),
    disabled: Boolean(options.disabled),
    isConnected: true,
    style: { display: 'block', visibility: 'visible', opacity: '1' },
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
      if (name === 'id') return this.id || null;
      if (name === 'name') return this.name || null;
      if (name === 'title') return this.title || null;
      if (name === 'aria-label') return attributes['aria-label'] || null;
      if (name === 'aria-hidden') return this.hidden ? 'true' : attributes['aria-hidden'] || null;
      if (name === 'aria-disabled') return this.disabled ? 'true' : attributes['aria-disabled'] || null;
      return Object.prototype.hasOwnProperty.call(attributes, name) ? String(attributes[name]) : null;
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
        if (source.includes('#__rf_panel__') && current.id === '__rf_panel__') return current;
        if (source.includes('[data-jiefang-ui]') && current.getAttribute?.('data-jiefang-ui') !== null) return current;
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
      if (source === ACTION_SELECTOR || source.startsWith('button,[role="button"],a,input[type="button"]')) {
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
  const button = createNode('button', { text, type: options.type || 'button', disabled: options.disabled });
  button.clickCount = 0;
  button.click = () => {
    button.clickCount += 1;
    options.onClick?.(button);
  };
  return button;
}

function createRoot(options = {}) {
  const document = options.document || createDocument();
  const root = createNode(options.tagName || 'section', {
    text: options.text || '',
    attributes: options.attributes,
  });
  assignDocument(root, document);
  return { document, root };
}

function createGroup(id) {
  const group = createNode('div', { attributes: { 'data-repeat-item': id } });
  group.groupId = id;
  return group;
}

function context(section = 'practice') {
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

test('identical “新增” labels in two sections click only the target section-owned action', async () => {
  const document = createDocument();
  const page = createNode('main');
  assignDocument(page, document);
  const target = createNode('section');
  const sibling = createNode('section');
  const targetGroups = [];
  const siblingGroups = [];
  const targetAdd = createAction('新增', { onClick: () => targetGroups.push(createGroup('practice-0')) });
  const siblingAdd = createAction('新增', { onClick: () => siblingGroups.push(createGroup('papers-0')) });
  target.append(targetAdd);
  sibling.append(siblingAdd);
  page.append(target, sibling);

  assert.equal(Safety.isSafeAddRowCandidate(targetAdd, { region: target }), true);
  assert.equal(Safety.isSafeAddRowCandidate(siblingAdd, { region: sibling }), true);
  const result = await ArrayHandler.prepare(
    context('practice'),
    [{}],
    target,
    runtimeOptions(targetGroups),
  );

  assert.equal(result.ok, true, result.error);
  assert.equal(targetAdd.clickCount, 1);
  assert.equal(siblingAdd.clickCount, 0);
  assert.equal(targetGroups.length, 1);
  assert.equal(siblingGroups.length, 0);
});

test('multiple same-scope safe add candidates fail closed with zero clicks', async () => {
  const { root } = createRoot();
  const groups = [];
  const first = createAction('新增', { onClick: () => groups.push(createGroup('first')) });
  const second = createAction('新增', { onClick: () => groups.push(createGroup('second')) });
  root.append(first, second);

  const result = await ArrayHandler.prepare(context(), [{}], root, runtimeOptions(groups));

  assert.equal(result.ok, false);
  assert.match(result.error, /安全新增按钮|未找到/);
  assert.equal(first.clickCount, 0);
  assert.equal(second.clickCount, 0);
  assert.equal(groups.length, 0);
});

test('disabled-at-limit action is never clicked beyond the declared item limit', async () => {
  const { root } = createRoot({ attributes: { 'data-max-items': '2' } });
  const groups = [createGroup('row-0')];
  const add = createAction('新增', {
    onClick(button) {
      groups.push(createGroup(`row-${groups.length}`));
      if (groups.length >= 2) button.disabled = true;
    },
  });
  root.append(add);
  const options = runtimeOptions(groups);

  const first = await ArrayHandler.prepare(context(), [{}, {}, {}, {}], root, options);
  const second = await ArrayHandler.prepare(context(), [{}, {}, {}, {}], root, options);

  assert.equal(first.ok, true, first.error);
  assert.equal(first.itemLimit, 2);
  assert.equal(first.targetCount, 2);
  assert.equal(first.limitedCount, 2);
  assert.equal(first.clicks, 1);
  assert.equal(second.ok, true, second.error);
  assert.equal(second.clicks, 0);
  assert.equal(add.clickCount, 1);
  assert.equal(add.disabled, true);
  assert.equal(groups.length, 2);
});

test('nested repeatable root uses a broad ancestor only as action scope, never as a group', async () => {
  const document = createDocument();
  const outer = createNode('fieldset');
  const inner = createNode('section');
  const unrelated = createNode('section');
  assignDocument(outer, document);
  const groups = [];
  // Structural definitions intentionally accept the conservative generic label here;
  // the sibling award-specific label must not enter the practice action set.
  const targetAdd = createAction('新增', { onClick: () => groups.push(createGroup('practice-0')) });
  const unrelatedAdd = createAction('新增奖项');
  inner.append(createNode('table'));
  unrelated.append(unrelatedAdd);
  outer.append(inner, targetAdd, unrelated);

  const result = await ArrayHandler.prepare(context(), [{}], inner, runtimeOptions(groups, { addRoot: outer }));

  assert.equal(result.ok, true, result.error);
  assert.equal(targetAdd.clickCount, 1);
  assert.equal(unrelatedAdd.clickCount, 0);
  assert.equal(result.groups.length, 1);
  assert.equal(result.groups[0], groups[0]);
  assert.notEqual(result.groups[0], outer);
  assert.notEqual(result.groups[0], inner);
});

test('co-located add/delete/submit actions allow only the unique section-owned add click', async () => {
  const { root } = createRoot();
  const groups = [];
  const add = createAction('新增', { onClick: () => groups.push(createGroup('row-0')) });
  const remove = createAction('删除', { onClick: () => groups.pop() });
  const submit = createAction('提交', { type: 'submit' });
  root.append(add, remove, submit);

  assert.equal(Safety.isSafeAddRowCandidate(add, { region: root }), true);
  assert.equal(Safety.isSafeAddRowCandidate(remove, { region: root }), false);
  assert.equal(Safety.isSafeAddRowCandidate(submit, { region: root }), false);
  const result = await ArrayHandler.prepare(context(), [{}], root, runtimeOptions(groups));

  assert.equal(result.ok, true, result.error);
  assert.equal(add.clickCount, 1);
  assert.equal(remove.clickCount, 0);
  assert.equal(submit.clickCount, 0);
  assert.equal(groups.length, 1);
});

test('every add re-scans fresh groups, and shorter JSON never deletes existing rows', async () => {
  const { root } = createRoot();
  const groups = [];
  const scanHistory = [];
  const add = createAction('新增', {
    onClick: () => groups.push(createGroup(`row-${groups.length}`)),
  });
  const remove = createAction('删除', { onClick: () => groups.pop() });
  root.append(add, remove);
  const options = runtimeOptions(groups, {
    getGroups() {
      scanHistory.push(groups.length);
      return [...groups];
    },
  });

  const grown = await ArrayHandler.prepare(context(), [{}, {}, {}], root, options);
  const rowsBeforeShorterRun = [...groups];
  const shorter = await ArrayHandler.prepare(context(), [{}], root, options);

  assert.equal(grown.ok, true, grown.error);
  assert.equal(grown.clicks, 3);
  assert.deepEqual(grown.groupContexts.map(item => item.index), [0, 1, 2]);
  assert.ok([0, 1, 2, 3].every(count => scanHistory.includes(count)), scanHistory.join(','));
  assert.equal(scanHistory.every((count, index) => index === 0 || count >= scanHistory[index - 1]), true);
  assert.equal(shorter.ok, true, shorter.error);
  assert.equal(shorter.clicks, 0);
  assert.equal(add.clickCount, 3);
  assert.equal(remove.clickCount, 0);
  assert.equal(groups.length, 3);
  assert.deepEqual(groups, rowsBeforeShorterRun);
});

test('action text normalization joins CJK whitespace without weakening action safety', () => {
  assert.equal(Safety.normalizeActionText('新 增'), '新增');
  assert.equal(Safety.normalizeActionText('添\u00a0加 一 条'), '添加一条');
  assert.equal(Safety.normalizeActionText('save draft'), 'save draft');
  assert.equal(Safety.normalizeActionText('delete item'), 'delete item');
});

test('metadata-only action ownership selects the smallest owner for a whitespace sibling add', () => {
  const document = createDocument();
  const page = createNode('main');
  const owner = createNode('section', { attributes: { 'data-section': 'papers' } });
  const table = createNode('table');
  const add = createAction('新 增');
  assignDocument(page, document);
  owner.append(add, table);
  page.append(owner);

  const debug = ArrayHandler.inspectActionOwnership(table, 'papers', {
    regionId: 'table:0',
    zeroRow: true,
    embeddedRegions: [table],
  });

  assert.deepEqual(Object.keys(debug), [
    'collection', 'regionId', 'zeroRow', 'regionRootFound',
    'ownerCandidateCount', 'ownerCandidates', 'selectedOwnerDepth',
    'localAddCandidateCount', 'acceptedAddCandidateCount',
    'rejectionReasons', 'finalReasonCode',
  ]);
  assert.equal(debug.collection, 'papers');
  assert.equal(debug.zeroRow, true);
  assert.equal(debug.regionRootFound, true);
  assert.equal(debug.ownerCandidateCount >= 2, true);
  assert.equal(debug.selectedOwnerDepth, 1);
  assert.equal(debug.localAddCandidateCount, 1);
  assert.equal(debug.acceptedAddCandidateCount, 1);
  assert.deepEqual(debug.rejectionReasons, []);
  assert.equal(debug.finalReasonCode, 'ACTION_OWNER_RESOLVED');
  assert.deepEqual(Object.keys(debug.ownerCandidates[0]), [
    'depth', 'ownedRegionCount', 'localButtonCount', 'normalizedAddCount',
    'acceptedAddCount', 'qualification',
  ]);
  assert.equal(JSON.stringify(debug).includes('新 增'), false);
  assert.equal(JSON.stringify(debug).includes('data-section'), false);
});

test('RED: a detectSectionRoot table fallback is a region root, not an action-search boundary', async () => {
  const document = createDocument();
  const page = createNode('main');
  const owner = createNode('section', { attributes: { 'data-section': 'papers' } });
  const wrapper = createNode('div');
  const table = createNode('table');
  const groups = [];
  const add = createAction('新 增', {
    onClick: () => groups.push(createGroup(`papers-${groups.length}`)),
  });
  assignDocument(page, document);
  wrapper.append(table);
  owner.append(wrapper, add);
  page.append(owner);

  // This is the exact stale/fallback shape from detectSectionRoot(): the first
  // owner resolution returned the table, so callers received addRoot === table.
  const fallbackRegionRoot = table;
  const debug = ArrayHandler.inspectActionOwnership(fallbackRegionRoot, 'papers', {
    addRoot: fallbackRegionRoot,
    actionSearchBoundary: page,
    regionId: 'papers:table:0',
    zeroRow: true,
    embeddedRegions: [fallbackRegionRoot],
  });
  const result = await ArrayHandler.prepare(
    context('papers'),
    [{}, {}],
    fallbackRegionRoot,
    runtimeOptions(groups, {
      addRoot: fallbackRegionRoot,
      actionSearchBoundary: page,
      embeddedRegions: [fallbackRegionRoot],
    }),
  );

  assert.equal(debug.selectedOwnerDepth, 2);
  assert.equal(debug.localAddCandidateCount, 1);
  assert.equal(debug.acceptedAddCandidateCount, 1);
  assert.equal(debug.finalReasonCode, 'ACTION_OWNER_RESOLVED');
  assert.equal(result.ok, true, result.error);
  assert.equal(result.initialCount, 0);
  assert.equal(result.count, 2);
  assert.equal(result.clicks, 2);
  assert.equal(add.clickCount, 2);
});

test('an explicit same-root action boundary does not inherit the fallback ancestor expansion', async () => {
  const document = createDocument();
  const owner = createNode('section', { attributes: { 'data-section': 'papers' } });
  const table = createNode('table');
  const groups = [];
  const add = createAction('新增', {
    onClick: () => groups.push(createGroup('unexpected-row')),
  });
  assignDocument(owner, document);
  owner.append(table, add);

  const result = await ArrayHandler.prepare(
    context('papers'),
    [{}],
    table,
    runtimeOptions(groups, { addRoot: table }),
  );

  assert.equal(result.ok, false);
  assert.equal(result.clicks, 0);
  assert.equal(add.clickCount, 0);
  assert.equal(groups.length, 0);
});

test('an unrelated explicit action boundary is clamped to the region root in diagnosis and execution', async () => {
  const document = createDocument();
  const page = createNode('main');
  const owner = createNode('section', { attributes: { 'data-section': 'papers' } });
  const unrelated = createNode('section', { attributes: { 'data-section': 'awards' } });
  const table = createNode('table');
  const groups = [];
  const add = createAction('新增', {
    onClick: () => groups.push(createGroup('unexpected-row')),
  });
  assignDocument(page, document);
  owner.append(table, add);
  page.append(owner, unrelated);

  const ownershipOptions = {
    addRoot: owner,
    actionSearchBoundary: unrelated,
    regionId: 'papers:table:0',
    zeroRow: true,
    embeddedRegions: [table],
  };
  const debug = ArrayHandler.inspectActionOwnership(table, 'papers', ownershipOptions);
  const result = await ArrayHandler.prepare(
    context('papers'),
    [{}],
    table,
    runtimeOptions(groups, ownershipOptions),
  );

  assert.equal(debug.ownerCandidateCount, 1);
  assert.equal(debug.ownerCandidates[0].depth, 0);
  assert.equal(debug.ownerCandidates[0].qualification, 'NO_LOCAL_ADD');
  assert.equal(debug.selectedOwnerDepth, null);
  assert.equal(debug.localAddCandidateCount, 0);
  assert.equal(debug.acceptedAddCandidateCount, 0);
  assert.equal(debug.finalReasonCode, 'NO_LOCAL_ADD');
  assert.equal(result.ok, false);
  assert.equal(result.clicks, 0);
  assert.equal(add.clickCount, 0);
  assert.equal(groups.length, 0);
});

test('action ownership remains fail-closed for a broad form and multiple local adds', () => {
  const document = createDocument();
  const broadForm = createNode('form');
  const table = createNode('table');
  const add = createAction('新增');
  assignDocument(broadForm, document);
  broadForm.append(table, add);

  const broad = ArrayHandler.inspectActionOwnership(table, 'awards', {
    regionId: 'table:0', zeroRow: true, embeddedRegions: [table],
  });
  assert.equal(broad.selectedOwnerDepth, null);
  assert.equal(broad.acceptedAddCandidateCount, 0);
  assert.equal(broad.rejectionReasons.includes('OWNER_TOO_BROAD'), true);
  assert.equal(broad.finalReasonCode, 'OWNER_TOO_BROAD');

  const { root } = createRoot({ attributes: { 'data-section': 'awards' } });
  const localTable = createNode('table');
  root.append(localTable, createAction('新增'), createAction('新 增'));
  const multiple = ArrayHandler.inspectActionOwnership(localTable, 'awards', {
    regionId: 'table:1', zeroRow: true, embeddedRegions: [localTable],
  });
  assert.equal(multiple.selectedOwnerDepth, null);
  assert.equal(multiple.localAddCandidateCount, 2);
  assert.equal(multiple.acceptedAddCandidateCount, 2);
  assert.equal(multiple.rejectionReasons.includes('MULTIPLE_LOCAL_ADD'), true);
  assert.equal(multiple.finalReasonCode, 'MULTIPLE_LOCAL_ADD');
});

test('disabled and safety-rejected local add candidates receive distinct metadata-only reasons', () => {
  const { root } = createRoot({ attributes: { 'data-section': 'papers' } });
  const disabledTable = createNode('table');
  root.append(disabledTable, createAction('新增', { disabled: true }));
  const disabled = ArrayHandler.inspectActionOwnership(disabledTable, 'papers', {
    regionId: 'table:0', zeroRow: true, embeddedRegions: [disabledTable],
  });
  assert.equal(disabled.finalReasonCode, 'ADD_DISABLED');

  const { root: unsafeRoot } = createRoot({ attributes: { 'data-section': 'papers' } });
  const unsafeTable = createNode('table');
  const unsafe = createAction('新增');
  unsafe.setAttribute('onclick', 'fetch("/submit")');
  unsafeRoot.append(unsafeTable, unsafe);
  const rejected = ArrayHandler.inspectActionOwnership(unsafeTable, 'papers', {
    regionId: 'table:1', zeroRow: true, embeddedRegions: [unsafeTable],
  });
  assert.equal(rejected.finalReasonCode, 'SAFETY_REJECTED');
});

test('four identical whitespace add labels stay isolated by their smallest structural owners', async () => {
  const document = createDocument();
  const page = createNode('main');
  assignDocument(page, document);
  const sections = ['papers', 'awards', 'research', 'practice'].map(section => {
    const owner = createNode('section', { attributes: { 'data-section': section } });
    const table = createNode('table');
    const groups = [];
    const add = createAction('新 增', {
      onClick: () => groups.push(createGroup(`${section}-0`)),
    });
    owner.append(table, add);
    page.append(owner);
    return { section, owner, table, groups, add };
  });
  const target = sections[0];

  const result = await ArrayHandler.prepare(
    context('papers'),
    [{}],
    target.table,
    runtimeOptions(target.groups, { addRoot: target.owner }),
  );

  assert.equal(result.ok, true, result.error);
  assert.deepEqual(sections.map(item => item.add.clickCount), [1, 0, 0, 0]);
  assert.deepEqual(sections.map(item => item.groups.length), [1, 0, 0, 0]);
});

test('zero-row papers and awards can grow through whitespace add labels only after each real rescan', async () => {
  for (const section of ['papers', 'awards']) {
    const { root } = createRoot({ attributes: { 'data-section': section } });
    const groups = [];
    const add = createAction('新 增', {
      onClick: () => groups.push(createGroup(`${section}-${groups.length}`)),
    });
    root.append(add);
    const result = await ArrayHandler.prepare(
      context(section),
      [{}, {}],
      root,
      runtimeOptions(groups),
    );
    assert.equal(result.ok, true, `${section}: ${result.error}`);
    assert.equal(result.initialCount, 0);
    assert.equal(result.count, 2);
    assert.equal(result.clicks, 2);
    assert.equal(add.clickCount, 2);
  }
});

test('an accepted add click that produces no real group growth fails closed without retrying', async () => {
  const { root } = createRoot({ attributes: { 'data-section': 'papers' } });
  const groups = [];
  const add = createAction('新增');
  root.append(add);

  const result = await ArrayHandler.prepare(
    context('papers'),
    [{}],
    root,
    runtimeOptions(groups),
  );

  assert.equal(result.ok, false);
  assert.match(result.error, /实际表单组数量没有增加/);
  assert.equal(result.clicks, 1);
  assert.equal(add.clickCount, 1);
  assert.equal(groups.length, 0);
});

test('a conflicting explicit collection owner is rejected by diagnosis and execution', async () => {
  const document = createDocument();
  const wrongOwner = createNode('section', { attributes: { 'data-section': 'awards' } });
  const papersTable = createNode('table');
  const groups = [];
  const wrongAdd = createAction('新增', {
    onClick: () => groups.push(createGroup('wrong-owner-row')),
  });
  assignDocument(wrongOwner, document);
  wrongOwner.append(papersTable, wrongAdd);

  const debug = ArrayHandler.inspectActionOwnership(papersTable, 'papers', {
    regionId: 'papers:table:0',
    zeroRow: true,
    embeddedRegions: [papersTable],
  });
  const result = await ArrayHandler.prepare(
    context('papers'),
    [{}],
    papersTable,
    runtimeOptions(groups, { addRoot: wrongOwner }),
  );

  assert.equal(debug.selectedOwnerDepth, null);
  assert.equal(debug.acceptedAddCandidateCount, 0);
  assert.equal(debug.finalReasonCode, 'REGION_COLLECTION_CONFLICT');
  assert.equal(result.ok, false);
  assert.equal(wrongAdd.clickCount, 0);
  assert.equal(groups.length, 0);
});

test('diagnosis honors a strict configured add selector just like execution', async () => {
  const document = createDocument();
  const owner = createNode('section', { attributes: { 'data-section': 'papers' } });
  const table = createNode('table');
  const genericAdd = createAction('新增');
  assignDocument(owner, document);
  owner.append(table, genericAdd);
  const options = {
    addButtonSelector: '[data-target-add]',
    regionId: 'papers:table:0',
    zeroRow: true,
    embeddedRegions: [table],
  };

  const debug = ArrayHandler.inspectActionOwnership(table, 'papers', options);
  const result = await ArrayHandler.prepare(
    context('papers'),
    [{}],
    table,
    runtimeOptions([], { ...options, addRoot: owner }),
  );

  assert.notEqual(debug.finalReasonCode, 'ACTION_OWNER_RESOLVED');
  assert.equal(debug.acceptedAddCandidateCount, 0);
  assert.equal(result.ok, false);
  assert.equal(genericAdd.clickCount, 0);
});

test('one safe and one unsafe same-owner add label remain ambiguous and produce zero clicks', async () => {
  const { root } = createRoot({ attributes: { 'data-section': 'papers' } });
  const table = createNode('table');
  const groups = [];
  const safeAdd = createAction('新增', {
    onClick: () => groups.push(createGroup('safe-row')),
  });
  const unsafeAdd = createAction('新增', {
    onClick: () => groups.push(createGroup('unsafe-row')),
  });
  unsafeAdd.setAttribute('onclick', 'fetch("/submit")');
  root.append(table, safeAdd, unsafeAdd);

  const debug = ArrayHandler.inspectActionOwnership(table, 'papers', {
    regionId: 'papers:table:0', zeroRow: true, embeddedRegions: [table],
  });
  const result = await ArrayHandler.prepare(
    context('papers'), [{}], table, runtimeOptions(groups, { addRoot: root }),
  );

  assert.equal(debug.finalReasonCode, 'MULTIPLE_LOCAL_ADD');
  assert.equal(debug.localAddCandidateCount, 2);
  assert.equal(debug.acceptedAddCandidateCount, 1);
  assert.equal(result.ok, false);
  assert.equal(safeAdd.clickCount, 0);
  assert.equal(unsafeAdd.clickCount, 0);
  assert.equal(groups.length, 0);
});

test('aria-disabled add receives ADD_DISABLED and is never clicked', async () => {
  const { root } = createRoot({ attributes: { 'data-section': 'awards' } });
  const table = createNode('table');
  const add = createAction('新增');
  add.setAttribute('aria-disabled', 'true');
  root.append(table, add);

  const debug = ArrayHandler.inspectActionOwnership(table, 'awards', {
    regionId: 'awards:table:0', zeroRow: true, embeddedRegions: [table],
  });
  const result = await ArrayHandler.prepare(
    context('awards'), [{}], table, runtimeOptions([], { addRoot: root }),
  );

  assert.equal(debug.finalReasonCode, 'ADD_DISABLED');
  assert.equal(result.ok, false);
  assert.equal(add.clickCount, 0);
});

test('extension-owned add labels do not pollute action ownership counts', async () => {
  const { root } = createRoot({ attributes: { 'data-section': 'papers' } });
  const table = createNode('table');
  const groups = [];
  const pageAdd = createAction('新增', {
    onClick: () => groups.push(createGroup('page-row')),
  });
  const extensionPanel = createNode('aside', { id: '__rf_panel__' });
  const extensionAdd = createAction('新增');
  extensionPanel.id = '__rf_panel__';
  extensionPanel.append(extensionAdd);
  root.append(table, pageAdd, extensionPanel);

  const debug = ArrayHandler.inspectActionOwnership(table, 'papers', {
    regionId: 'papers:table:0', zeroRow: true, embeddedRegions: [table],
  });
  const result = await ArrayHandler.prepare(
    context('papers'), [{}], table, runtimeOptions(groups, { addRoot: root }),
  );

  assert.equal(debug.finalReasonCode, 'ACTION_OWNER_RESOLVED');
  assert.equal(debug.localAddCandidateCount, 1);
  assert.equal(result.ok, true, result.error);
  assert.equal(pageAdd.clickCount, 1);
  assert.equal(extensionAdd.clickCount, 0);
});
