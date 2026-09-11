import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Structures = require('../../src/mappings/section-structures.js');
require('../../src/core/array-handler.js');
const EmbeddedSectionDetector = require('../../src/core/embedded-section-detector.js');
const FieldContext = require('../../src/core/field-context.js');
const FieldDetector = require('../../src/core/field-detector.js');
const FieldMatcher = require('../../src/core/field-matcher.js');

const REGION_SELECTOR = 'table,[role="table"],fieldset,[data-repeat-list],[data-array-list]';

function selectorParts(selector) {
  return String(selector || '').split(',').map(part => part.trim()).filter(Boolean);
}

function matchesSimple(node, selector) {
  const source = String(selector || '').trim().toLowerCase();
  if (source === 'table') return node.tagName === 'TABLE';
  if (source === 'thead') return node.tagName === 'THEAD';
  if (source === 'tr') return node.tagName === 'TR';
  if (source === 'th') return node.tagName === 'TH';
  if (source === 'td') return node.tagName === 'TD';
  if (source === 'input') return node.tagName === 'INPUT';
  if (source === '[role="table"]') return node.getAttribute('role') === 'table';
  if (source === '[role="row"]') return node.getAttribute('role') === 'row';
  if (source === '[role="columnheader"]') return node.getAttribute('role') === 'columnheader';
  if (source === '[data-repeat-item]') return node.hasAttribute('data-repeat-item');
  if (source === '[data-array-item]') return node.hasAttribute('data-array-item');
  return false;
}

function isHeaderSelector(selector) {
  return /\bth\b|thead td|first-child td|columnheader/.test(String(selector || ''));
}

function isControlSelector(selector) {
  return /input|textarea|select|contenteditable|combobox|file/.test(String(selector || ''));
}

function makeElement(tagName, options = {}) {
  const attributes = new Map(Object.entries(options.attributes || {}));
  return {
    nodeType: 1,
    tagName: String(tagName).toUpperCase(),
    type: options.type || '',
    id: '',
    name: '',
    value: '',
    placeholder: options.placeholder || '',
    readOnly: false,
    isConnected: true,
    hidden: false,
    disabled: false,
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
      if (name === 'placeholder') return this.placeholder || null;
      if (name === 'type') return this.type || null;
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
      const visit = current => current.children.forEach(child => {
        descendants.push(child);
        visit(child);
      });
      visit(this);
      if (isHeaderSelector(selector)) {
        const source = String(selector || '');
        return descendants.filter(child => child.tagName === 'TH'
          || child.getAttribute?.('role') === 'columnheader'
          || (child.tagName === 'TD'
            && ((source.includes('thead td') && Boolean(child.closest?.('thead')))
              || (source.includes('first-child td')
                && child.parentElement?.parentElement?.children?.[0] === child.parentElement))));
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

function internshipsContext(index) {
  return {
    section: 'internships',
    sectionId: 'internships',
    collection: 'internships',
    collectionMode: 'repeatable',
    source: 'embedded-structure',
    confidence: 0.98,
    regionId: `internships:group:${index}`,
    index,
    indexContext: { section: 'internships', collection: 'internships', internships: index, index },
  };
}

function rangeDescriptors(fixture, rowIndex) {
  const rangeCell = fixture.rows[rowIndex].children[0];
  return rangeCell.children.map((control, controlIndex) => {
    const descriptor = FieldDetector.buildDescriptor(control, controlIndex, {
      section: 'internships',
      sectionContext: internshipsContext(rowIndex),
    });
    descriptor.context = FieldContext.contextFrom(descriptor, internshipsContext(rowIndex));
    return descriptor;
  });
}

function makeInternshipsTable(rowCount = 1, options = {}) {
  const headers = options.headers || ['起止年月', '学习或工作单位', '任何职务'];
  const headerTag = options.headerTag || 'th';
  const headerRole = options.headerRole || '';
  const table = makeElement('table');
  const heading = makeElement('tr');
  heading.append(...headers.map(text => makeElement(headerTag, {
    text,
    attributes: headerRole ? { role: headerRole } : {},
  })));
  if (headerTag === 'td') {
    const thead = makeElement('thead');
    thead.append(heading);
    table.append(thead);
  } else {
    table.append(heading);
  }
  const rows = [];
  for (let index = 0; index < rowCount; index += 1) {
    const row = makeElement('tr');
    const range = makeElement('td');
    range.append(makeElement('input', { type: 'text' }), makeElement('input', { type: 'text' }));
    const remaining = headers.slice(1).map(() => {
      const cell = makeElement('td');
      cell.append(makeElement('input', { type: 'text' }));
      return cell;
    });
    row.append(range, ...remaining);
    table.append(row);
    rows.push(row);
  }
  return { table, rows };
}

function documentFor(table) {
  const document = {
    nodeType: 9,
    defaultView: {
      getComputedStyle() { return { display: 'block', visibility: 'visible', opacity: '1' }; },
    },
    querySelectorAll(selector) {
      if (String(selector) === REGION_SELECTOR) return [table];
      return table.querySelectorAll(selector);
    },
  };
  const bind = node => {
    node.ownerDocument = document;
    node.children.forEach(bind);
  };
  bind(table);
  return document;
}

test('combined 起止年月 contributes distinct start/end structural evidence without lowering threshold', () => {
  const score = Structures.scoreHeaderGroups(
    ['起止年月', '学习或工作单位', '任何职务'],
    'internships',
  );

  assert.equal(score.required, 3);
  assert.equal(score.qualifies, true);
  assert.equal(score.matchedCount, 4);
  assert.equal(score.coverage, 1);
  assert.equal(score.matchedPairedRanges.length, 1);
});

test('all supported combined range headings use the same internships structural model', () => {
  for (const header of ['起止年月', '起止时间', '起止日期', '时间范围']) {
    const rule = Structures.pairedRangeForHeader('internships', header);
    assert.ok(rule, header);
    assert.deepEqual(rule.roles.map(role => role.field), ['startDate', 'endDate']);
  }
});

test('combined range evidence is section-aware and does not qualify unrelated collections', () => {
  assert.equal(Structures.pairedRangeForHeader('awards', '起止年月'), null);
  assert.equal(Structures.pairedRangeForHeader('practice', '时间范围'), null);
  assert.equal(
    Structures.scoreHeaderGroups(['起止年月', '学习或工作单位', '任何职务'], 'awards').qualifies,
    false,
  );
});

test('paired range does not let two physical headers bypass the internships structural threshold', () => {
  for (const headers of [
    ['时间范围', '职位'],
    ['起止年月', '学习或工作单位'],
  ]) {
    const score = Structures.scoreHeaderGroups(headers, 'internships');
    assert.equal(score.matchedCount, 3, 'logical start/end coverage remains visible');
    assert.equal(score.qualifies, false, headers.join(' + '));
    assert.equal(Structures.selectBestDefinitionForHeaders(headers), null);
  }
});

test('an unrelated two-column range table cannot activate paired field roles', () => {
  const fixture = makeInternshipsTable(1, { headers: ['时间范围', '职位'] });
  documentFor(fixture.table);
  const [first, second] = fixture.rows[0].children[0].children;

  assert.equal(FieldDetector.pairedRangeRoleFor(first), null);
  assert.equal(FieldDetector.pairedRangeRoleFor(second), null);
});

test('EmbeddedSectionDetector recognizes the real three-column work-history table as internships', () => {
  const fixture = makeInternshipsTable(5);
  const detected = EmbeddedSectionDetector.detect(documentFor(fixture.table));
  const region = detected.find(candidate => candidate.runtimeRoot === fixture.table);

  assert.ok(region);
  assert.equal(region.collection, 'internships');
  assert.equal(region.collectionMode, 'repeatable');
  assert.equal(region.groupCount, 5);
  assert.equal(region.zeroRow, false);
});

test('exactly two otherwise-unlabelled controls use cell-local order for start/end roles', () => {
  const start = Structures.resolvePairedRangeRole({
    sectionId: 'internships', header: '起止年月', controlIndex: 0, controlCount: 2,
  });
  const end = Structures.resolvePairedRangeRole({
    sectionId: 'internships', header: '起止年月', controlIndex: 1, controlCount: 2,
  });

  assert.deepEqual(
    [start.field, start.semanticLabel, start.source],
    ['startDate', '起始时间', 'cell-order'],
  );
  assert.deepEqual(
    [end.field, end.semanticLabel, end.source],
    ['endDate', '结束时间', 'cell-order'],
  );
});

test('explicit local start/end semantics outrank reversed DOM order', () => {
  const endFirst = Structures.resolvePairedRangeRole({
    sectionId: 'internships', header: '时间范围', controlIndex: 0, controlCount: 2,
    semanticText: '结束日期',
  });
  const startSecond = Structures.resolvePairedRangeRole({
    sectionId: 'internships', header: '时间范围', controlIndex: 1, controlCount: 2,
    semanticText: '开始日期',
  });

  assert.equal(endFirst.field, 'endDate');
  assert.equal(endFirst.source, 'explicit-semantic');
  assert.equal(startSecond.field, 'startDate');
  assert.equal(startSecond.source, 'explicit-semantic');
});

test('ambiguous control counts fail closed instead of using row-wide order', () => {
  for (const controlCount of [1, 3]) {
    assert.equal(Structures.resolvePairedRangeRole({
      sectionId: 'internships', header: '起止年月', controlIndex: 0, controlCount,
    }), null);
  }
});

test('unknown non-empty local semantics fail closed instead of being overwritten by position', () => {
  assert.equal(Structures.resolvePairedRangeRole({
    sectionId: 'internships', header: '起止年月', controlIndex: 0, controlCount: 2,
    semanticText: '审核时间',
  }), null);
});

test('a repeated generic range caption is not mistaken for a field-specific role', () => {
  const start = Structures.resolvePairedRangeRole({
    sectionId: 'internships', header: '起止年月', controlIndex: 0, controlCount: 2,
    semanticText: '起止年月',
  });
  const end = Structures.resolvePairedRangeRole({
    sectionId: 'internships', header: '起止年月', controlIndex: 1, controlCount: 2,
    semanticText: '起止年月',
  });

  assert.equal(start.field, 'startDate');
  assert.equal(end.field, 'endDate');
  assert.equal(start.source, 'cell-order');
  assert.equal(end.source, 'cell-order');
});

test('the same pair-role policy cannot be activated outside an internships context', () => {
  assert.equal(Structures.resolvePairedRangeRole({
    sectionId: 'basic', header: '起止年月', controlIndex: 0, controlCount: 2,
  }), null);
  assert.equal(Structures.resolvePairedRangeRole({
    sectionId: '', header: '起止年月', controlIndex: 0, controlCount: 2,
  }), null);
});

test('canonical schema remains internships[] startDate/endDate/company/position', () => {
  const definition = Structures.definitionForSection('work_history');
  assert.equal(definition, null, 'section structures must not invent a second work_history collection');
  const internships = Structures.definitionForSection('internships');
  assert.equal(internships.collection, 'internships');
  assert.deepEqual(
    internships.pairedRangeGroups[0].roles.map(role => `internships[].${role.field}`),
    ['internships[].startDate', 'internships[].endDate'],
  );
});

test('FieldDetector binds two unlabelled controls only within a confirmed paired-range cell', () => {
  const fixture = makeInternshipsTable(1);
  documentFor(fixture.table);
  const [start, end] = rangeDescriptors(fixture, 0);

  assert.equal(start.tableHeader, '起止年月');
  assert.equal(end.tableHeader, '起止年月');
  assert.equal(start.semanticPlaceholder, '起始时间');
  assert.equal(end.semanticPlaceholder, '结束时间');
  assert.equal(start.pairedRangeRole?.source, 'cell-order');
  assert.equal(end.pairedRangeRole?.source, 'cell-order');
});

test('paired role binding reuses structural header extraction for td and ARIA column headers', () => {
  for (const options of [
    { headerTag: 'td' },
    { headerTag: 'td', headerRole: 'columnheader' },
  ]) {
    const fixture = makeInternshipsTable(1, options);
    documentFor(fixture.table);
    const [start, end] = rangeDescriptors(fixture, 0);

    assert.equal(start.tableHeader, '起止年月');
    assert.equal(end.tableHeader, '起止年月');
    assert.equal(start.pairedRangeRole?.field, 'startDate');
    assert.equal(end.pairedRangeRole?.field, 'endDate');
  }
});

test('an unmarked first data row is not exposed as a semantic table header', () => {
  const table = makeElement('table');
  const firstDataRow = makeElement('tr');
  firstDataRow.append(makeElement('td', { text: '张三' }), makeElement('td', { text: '内部记录' }));
  const editableRow = makeElement('tr');
  const editableCell = makeElement('td');
  const input = makeElement('input', { type: 'text' });
  editableCell.append(input);
  editableRow.append(editableCell);
  table.append(firstDataRow, editableRow);
  documentFor(table);

  assert.equal(FieldDetector.tableHeaderFor(input), '');
});

test('paired-range descriptors match distinct canonical paths without one input owning two fields', () => {
  const fixture = makeInternshipsTable(1);
  documentFor(fixture.table);
  const [start, end] = rangeDescriptors(fixture, 0);
  const resume = {
    internships: [{
      startDate: '2022-09', endDate: '2026-06', company: '示例大学', position: '学生',
    }],
  };
  const startMatch = FieldMatcher.matchField(start, resume, {
    sectionContext: start.context,
    arrayContext: start.context.indexContext,
  });
  const endMatch = FieldMatcher.matchField(end, resume, {
    sectionContext: end.context,
    arrayContext: end.context.indexContext,
  });

  assert.equal(startMatch.status, 'MATCHED');
  assert.equal(startMatch.matchedPath, 'internships[].startDate');
  assert.equal(startMatch.value, '2022-09');
  assert.equal(endMatch.status, 'MATCHED');
  assert.equal(endMatch.matchedPath, 'internships[].endDate');
  assert.equal(endMatch.value, '2026-06');
  assert.notEqual(startMatch.descriptor.element, endMatch.descriptor.element);
});

test('five page rows stay index-isolated: JSON rows 0/1 match and remaining rows are MISSING_JSON', () => {
  const fixture = makeInternshipsTable(5);
  documentFor(fixture.table);
  const resume = {
    internships: [
      { startDate: '2020-01', endDate: '2021-01', company: '甲单位', position: '甲职务' },
      { startDate: '2021-02', endDate: '2022-02', company: '乙单位', position: '乙职务' },
    ],
  };

  const results = fixture.rows.map((_row, rowIndex) => rangeDescriptors(fixture, rowIndex)
    .map(descriptor => FieldMatcher.matchField(descriptor, resume, {
      sectionContext: descriptor.context,
      arrayContext: descriptor.context.indexContext,
    })));

  assert.deepEqual(results[0].map(match => match.value), ['2020-01', '2021-01']);
  assert.deepEqual(results[1].map(match => match.value), ['2021-02', '2022-02']);
  assert.equal(results.slice(0, 2).flat().every(match => match.status === 'MATCHED'), true);
  assert.equal(results.slice(2).flat().every(match => match.status === 'MISSING_JSON'), true);
  assert.equal(results.flat().every((match, index) =>
    match.matchedPath === (index % 2 === 0
      ? 'internships[].startDate'
      : 'internships[].endDate')), true);
});
