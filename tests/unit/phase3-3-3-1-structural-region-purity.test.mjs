import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// EmbeddedSectionDetector obtains ArrayHandler from the shared runtime root.
// Load it first so these tests exercise the same dependency path as Chrome.
require('../../src/core/array-handler.js');
const EmbeddedSectionDetector = require('../../src/core/embedded-section-detector.js');
const AutofillEngine = require('../../src/core/autofill-engine.js');

const REGION_SELECTOR = 'table,[role="table"],fieldset,[data-repeat-list],[data-array-list]';

function selectorParts(selector) {
  return String(selector || '').split(',').map(part => part.trim()).filter(Boolean);
}

function matchesSimple(node, selector) {
  const source = String(selector || '').trim().toLowerCase();
  if (!source) return false;
  if (source === 'table') return node.tagName === 'TABLE';
  if (source === 'fieldset') return node.tagName === 'FIELDSET';
  if (source === 'legend') return node.tagName === 'LEGEND';
  if (source === 'tr') return node.tagName === 'TR';
  if (source === 'th') return node.tagName === 'TH';
  if (source === 'td') return node.tagName === 'TD';
  if (source === 'button') return node.tagName === 'BUTTON';
  if (source === 'a') return node.tagName === 'A';
  if (/^h[1-6]$/.test(source)) return node.tagName === source.toUpperCase();
  if (source === '[role="table"]') return node.getAttribute('role') === 'table';
  if (source === '[role="row"]') return node.getAttribute('role') === 'row';
  if (source === '[role="columnheader"]') return node.getAttribute('role') === 'columnheader';
  if (source === '[role="button"]') return node.getAttribute('role') === 'button';
  if (source === '[data-repeat-list]') return node.hasAttribute('data-repeat-list');
  if (source === '[data-array-list]') return node.hasAttribute('data-array-list');
  if (source === '[data-repeat-item]') return node.hasAttribute('data-repeat-item');
  if (source === '[data-array-item]') return node.hasAttribute('data-array-item');
  if (source.startsWith('#')) return node.id === source.slice(1);
  return false;
}

function isHeaderSelector(selector) {
  return /\bth\b|thead td|first-child td|columnheader/.test(String(selector || ''));
}

function isControlSelector(selector) {
  return /input|textarea|select|contenteditable|combobox|file/.test(String(selector || ''));
}

function isActionSelector(selector) {
  return selectorParts(selector).some(part => [
    'button', '[role="button"]', 'a', 'input[type="button"]',
  ].includes(part));
}

function makeElement(tagName, options = {}) {
  const attributes = new Map(Object.entries(options.attributes || {}));
  return {
    nodeType: 1,
    tagName: String(tagName).toUpperCase(),
    id: options.id || '',
    type: options.type || '',
    hidden: false,
    disabled: false,
    readOnly: false,
    isConnected: true,
    parentElement: null,
    ownerDocument: null,
    children: [],
    ownText: options.text || '',
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
    hasAttribute(name) { return attributes.has(name); },
    getAttribute(name) {
      if (name === 'id') return this.id || null;
      return attributes.has(name) ? attributes.get(name) : null;
    },
    matches(selector) {
      return selectorParts(selector).some(part => matchesSimple(this, part));
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

      if (isHeaderSelector(selector)) {
        return descendants.filter(child => child.tagName === 'TH'
          || child.getAttribute?.('role') === 'columnheader');
      }
      if (isActionSelector(selector)) {
        return descendants.filter(child => child.tagName === 'BUTTON'
          || child.tagName === 'A'
          || child.getAttribute?.('role') === 'button'
          || (child.tagName === 'INPUT' && child.type === 'button'));
      }
      if (isControlSelector(selector)) {
        return descendants.filter(child => ['INPUT', 'TEXTAREA', 'SELECT'].includes(child.tagName));
      }
      return descendants.filter(child => selectorParts(selector)
        .some(part => matchesSimple(child, part)));
    },
    getBoundingClientRect() { return { width: 640, height: 40, left: 0, top: 0 }; },
  };
}

function input() {
  return makeElement('input', { type: 'text' });
}

function repeatItem() {
  const row = makeElement('div', { attributes: { 'data-repeat-item': '' } });
  row.append(input(), input());
  return row;
}

function button(text) {
  const value = makeElement('button', { type: 'button', text });
  value.click = () => {};
  return value;
}

function makeTable(headers, rowCount = 0) {
  const table = makeElement('table');
  const headerRow = makeElement('tr');
  headerRow.append(headers.map(header => makeElement('th', { text: header })));
  table.append(headerRow);
  const rows = [];
  for (let index = 0; index < rowCount; index += 1) {
    const row = makeElement('tr');
    row.append(input(), input());
    table.append(row);
    rows.push(row);
  }
  return { table, rows };
}

function attachDocument(root, regions) {
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

function candidatesForRoot(document, root) {
  return EmbeddedSectionDetector.detect(document)
    .filter(candidate => candidate.runtimeRoot === root);
}

const FAMILY_HEADERS = [
  '\u59d3\u540d',
  '\u4e0e\u672c\u4eba\u5173\u7cfb',
  '\u5728\u4f55\u5355\u4f4d\u5de5\u4f5c\u4efb\u4f55\u804c\u52a1',
  '\u8054\u7cfb\u7535\u8bdd',
];
const PAPERS_HEADERS = ['\u53d1\u8868\u65f6\u95f4', '\u671f\u520a', '\u8bba\u6587\u540d\u79f0', '\u4f5c\u8005\u6392\u540d'];
const AWARDS_TERMS = ['\u65f6\u95f4', '\u5185\u5bb9', '\u7ea7\u522b', '\u6392\u540d'];

test('case 1: a broad fieldset cannot own embedded collections through free text or nested tables', () => {
  const outer = makeElement('fieldset');
  outer.append(
    ...['\u59d3\u540d', '\u51fa\u751f\u65e5\u671f', ...AWARDS_TERMS, '\u672c\u79d1\u9662\u7cfb', '\u4e2a\u4eba\u9648\u8ff0']
      .map(text => makeElement('span', { text })),
  );
  const family = makeTable(FAMILY_HEADERS, 5);
  const papers = makeTable(PAPERS_HEADERS, 0);
  outer.append(family.table, papers.table);
  const document = attachDocument(outer, [outer, family.table, papers.table]);

  assert.deepEqual(candidatesForRoot(document, outer), []);
  assert.deepEqual(
    EmbeddedSectionDetector.detect(document).map(item => item.collection).sort(),
    ['family', 'papers'],
  );
});

test('case 2: exact awards signature words in direct free text are not structural headers', () => {
  const fieldset = makeElement('fieldset');
  fieldset.append(AWARDS_TERMS.map(text => makeElement('span', { text })));
  const document = attachDocument(fieldset, [fieldset]);

  assert.equal(
    candidatesForRoot(document, fieldset).some(candidate => candidate.collection === 'awards'),
    false,
  );
});

test('case 3: nested headers without owned headers or a strong title do not qualify the ancestor', () => {
  const outer = makeElement('fieldset');
  const nested = makeTable(AWARDS_TERMS, 1);
  outer.append(nested.table);
  const document = attachDocument(outer, [outer, nested.table]);

  assert.deepEqual(candidatesForRoot(document, outer), []);
  assert.equal(
    EmbeddedSectionDetector.detect(document).some(candidate => candidate.runtimeRoot === nested.table),
    true,
  );
});

test('case 4: a real four-header family table keeps all five owned groups', () => {
  const family = makeTable(FAMILY_HEADERS, 5);
  const document = attachDocument(family.table, [family.table]);
  const candidate = candidatesForRoot(document, family.table)[0];

  assert.ok(candidate);
  assert.equal(candidate.collection, 'family');
  assert.equal(candidate.groupCount, 5);
  assert.equal(candidate.zeroRow, false);
  assert.equal(candidate.evidenceKind, 'structural-headers');
});

test('case 5: a zero-row papers table remains structural topology', () => {
  const papers = makeTable(PAPERS_HEADERS, 0);
  const document = attachDocument(papers.table, [papers.table]);
  const candidate = candidatesForRoot(document, papers.table)[0];

  assert.ok(candidate);
  assert.equal(candidate.collection, 'papers');
  assert.equal(candidate.groupCount, 0);
  assert.equal(candidate.zeroRow, true);
  assert.equal(candidate.evidenceKind, 'structural-headers');
});

test('case 6: family legend plus a direct repeat item stays valid beside a nested summary table', () => {
  const root = makeElement('form');
  const fieldset = makeElement('fieldset');
  const legend = makeElement('legend', { text: '\u5bb6\u5ead\u4e3b\u8981\u6210\u5458' });
  const row = repeatItem();
  const add = button('\u6dfb\u52a0');
  const summary = makeTable(FAMILY_HEADERS, 0);
  fieldset.append(legend, row, add, summary.table);
  root.append(fieldset);
  const document = attachDocument(root, [fieldset, summary.table]);
  const candidate = candidatesForRoot(document, fieldset)[0];

  assert.ok(candidate);
  assert.equal(candidate.collection, 'family');
  assert.equal(candidate.groupCount, 1);
  assert.equal(candidate.evidenceKind, 'strong-title-repeatable');
});

test('case 7: an awards legend alone does not prove a repeatable section', () => {
  const fieldset = makeElement('fieldset');
  fieldset.append(
    makeElement('legend', { text: '\u83b7\u5956\u60c5\u51b5' }),
    makeElement('p', { text: '\u8fd9\u662f\u666e\u901a\u9759\u6001\u8bf4\u660e' }),
  );
  const document = attachDocument(fieldset, [fieldset]);

  assert.deepEqual(candidatesForRoot(document, fieldset), []);
});

test('case 8: an awards legend plus a direct repeat item uses the strong-title path', () => {
  const fieldset = makeElement('fieldset');
  fieldset.append(
    makeElement('legend', { text: '\u83b7\u5956\u60c5\u51b5' }),
    repeatItem(),
  );
  const document = attachDocument(fieldset, [fieldset]);
  const candidate = candidatesForRoot(document, fieldset)[0];

  assert.ok(candidate);
  assert.equal(candidate.collection, 'awards');
  assert.equal(candidate.groupCount, 1);
  assert.equal(candidate.evidenceKind, 'strong-title-repeatable');
});

test('diagnosis preserves structural qualification metadata without DOM or values', () => {
  const family = makeTable(FAMILY_HEADERS, 1);
  const document = attachDocument(family.table, [family.table]);
  const rawCandidate = candidatesForRoot(document, family.table)[0];
  assert.ok(rawCandidate);
  assert.equal(rawCandidate.evidenceKind, 'structural-headers');
  assert.equal(rawCandidate.qualificationReason, 'OWNED_STRUCTURAL_HEADERS');
  assert.equal(rawCandidate.ownedEvidenceCount > 0, true);

  const diagnosis = AutofillEngine.AutofillEngine.prototype.diagnoseCurrent.call({
    document,
    adapter: {
      diagnose() { return { fields: [], section: {} }; },
    },
    resume: {},
    resumeView: {},
    lastInspection: { scanId: 'scan:structural-metadata', sectionContext: null },
    task: null,
    scanId: 'scan:structural-metadata',
  });
  const serialized = diagnosis.embeddedSections
    .find(item => item.collection === 'family');

  assert.ok(serialized);
  assert.equal(serialized.evidenceKind, rawCandidate.evidenceKind);
  assert.equal(serialized.qualificationReason, rawCandidate.qualificationReason);
  assert.equal(serialized.ownedEvidenceCount, rawCandidate.ownedEvidenceCount);
  assert.equal(Object.hasOwn(serialized, 'runtimeRoot'), false);
  assert.equal(Object.hasOwn(serialized, 'value'), false);
});
