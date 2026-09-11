import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Detector = require('../../src/core/field-detector.js');
const Matcher = require('../../src/core/field-matcher.js');
const FieldAliases = require('../../src/mappings/field-aliases.js');
const CascaderAdapter = require('../../src/controls/adapters/cascader-adapter.js');

function splitSelectorList(selector) {
  const parts = [];
  let current = '';
  let bracketDepth = 0;
  let parenDepth = 0;
  let quote = '';
  for (const char of String(selector || '')) {
    if (quote) {
      current += char;
      if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }
    if (char === '[') bracketDepth += 1;
    if (char === ']') bracketDepth -= 1;
    if (char === '(') parenDepth += 1;
    if (char === ')') parenDepth -= 1;
    if (char === ',' && bracketDepth === 0 && parenDepth === 0) {
      if (current.trim()) parts.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function splitDescendantSelector(selector) {
  const parts = [];
  let current = '';
  let bracketDepth = 0;
  let parenDepth = 0;
  let quote = '';
  for (const char of String(selector || '').trim()) {
    if (quote) {
      current += char;
      if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }
    if (char === '[') bracketDepth += 1;
    if (char === ']') bracketDepth -= 1;
    if (char === '(') parenDepth += 1;
    if (char === ')') parenDepth -= 1;
    if (/\s/.test(char) && bracketDepth === 0 && parenDepth === 0) {
      if (current.trim()) parts.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function attributeValue(element, name) {
  if (name === 'class') return element.className || null;
  if (name === 'id') return element.id || null;
  if (name === 'type') return element.type || null;
  if (name === 'name') return element.name || null;
  if (name === 'placeholder') return element.placeholder || null;
  if (name === 'readonly') return element.readOnly ? '' : null;
  if (name === 'disabled') return element.disabled ? '' : null;
  if (name === 'hidden') return element.hidden ? '' : null;
  return element.attributes.get(name) ?? null;
}

function matchesSimpleSelector(element, selector) {
  let source = String(selector || '').trim();
  if (!source || source === '*') return true;
  if (source === ':scope') return true;

  let notMatch = null;
  source = source.replace(/:not\(([^)]+)\)/g, (_, nested) => {
    notMatch = notMatch || matchesSelector(element, nested);
    return '';
  });
  if (notMatch) return false;

  if (source.includes(':first-child')) {
    if (!element.parentElement || element.parentElement.children[0] !== element) return false;
    source = source.replace(':first-child', '');
  }

  const tagMatch = source.match(/^([a-zA-Z][\w-]*)/);
  if (tagMatch && element.tagName !== tagMatch[1].toUpperCase()) return false;

  const idMatches = [...source.matchAll(/#([\w-]+)/g)].map(match => match[1]);
  if (idMatches.some(id => element.id !== id)) return false;

  const classes = String(element.className || '').split(/\s+/).filter(Boolean);
  const classMatches = [...source.matchAll(/\.([\w-]+)/g)].map(match => match[1]);
  if (classMatches.some(className => !classes.includes(className))) return false;

  const attributePattern = /\[([^\]\s~*^$|=]+)\s*(?:(\*=|=)\s*(?:"([^"]*)"|'([^']*)'|([^\]]*)))?\]/g;
  for (const match of source.matchAll(attributePattern)) {
    const [, name, operator, doubleQuoted, singleQuoted, bare] = match;
    const actual = attributeValue(element, name);
    if (!operator) {
      if (actual === null || actual === undefined) return false;
      continue;
    }
    const expected = String(doubleQuoted ?? singleQuoted ?? bare ?? '').trim();
    if (operator === '=' && String(actual ?? '') !== expected) return false;
    if (operator === '*=' && !String(actual ?? '').includes(expected)) return false;
  }

  return true;
}

function matchesSelector(element, selector) {
  return splitSelectorList(selector).some(part => {
    const chain = splitDescendantSelector(part);
    if (!chain.length || !matchesSimpleSelector(element, chain.at(-1))) return false;
    let ancestor = element.parentElement;
    for (let index = chain.length - 2; index >= 0; index -= 1) {
      while (ancestor && !matchesSimpleSelector(ancestor, chain[index])) ancestor = ancestor.parentElement;
      if (!ancestor) return false;
      ancestor = ancestor.parentElement;
    }
    return true;
  });
}

class FakeElement {
  constructor(tagName = 'div', options = {}) {
    this.nodeType = 1;
    this.tagName = String(tagName).toUpperCase();
    this.className = options.className || '';
    this.id = options.id || '';
    this.name = options.name || '';
    this.type = options.type || '';
    this.placeholder = options.placeholder || '';
    this.value = options.value || '';
    this.hidden = Boolean(options.hidden);
    this.disabled = Boolean(options.disabled);
    this.readOnly = Boolean(options.readOnly);
    this.required = false;
    this.multiple = false;
    this.isConnected = true;
    this.isContentEditable = false;
    this.labels = [];
    this.dataset = {};
    this.attributes = new Map(Object.entries(options.attributes || {}));
    this.parentElement = null;
    this.previousElementSibling = null;
    this.ownerDocument = null;
    this.children = [];
    this._ownText = options.textContent || '';
  }

  get textContent() {
    return `${this._ownText}${this.children.map(child => child.textContent).join('')}`;
  }

  set textContent(value) {
    this._ownText = String(value ?? '');
  }

  get innerText() {
    return this.textContent;
  }

  get childNodes() {
    return [
      ...(this._ownText ? [{ nodeType: 3, textContent: this._ownText }] : []),
      ...this.children,
    ];
  }

  append(...children) {
    for (const child of children) {
      if (!child) continue;
      if (child.parentElement) {
        child.parentElement.children = child.parentElement.children.filter(item => item !== child);
      }
      child.parentElement = this;
      child.previousElementSibling = this.children.at(-1) || null;
      this.children.push(child);
      if (this.ownerDocument) attachOwnerDocument(child, this.ownerDocument);
    }
    return this;
  }

  remove() {
    if (!this.parentElement) return;
    const siblings = this.parentElement.children;
    const index = siblings.indexOf(this);
    if (index >= 0) siblings.splice(index, 1);
    for (let cursor = 0; cursor < siblings.length; cursor += 1) {
      siblings[cursor].previousElementSibling = siblings[cursor - 1] || null;
    }
    this.parentElement = null;
    this.previousElementSibling = null;
  }

  setAttribute(name, value = '') {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return attributeValue(this, name);
  }

  contains(candidate) {
    for (let current = candidate; current; current = current.parentElement) {
      if (current === this) return true;
    }
    return false;
  }

  matches(selector) {
    return matchesSelector(this, selector);
  }

  closest(selector) {
    for (let current = this; current; current = current.parentElement) {
      if (matchesSelector(current, selector)) return current;
    }
    return null;
  }

  descendants() {
    return this.children.flatMap(child => [child, ...child.descendants()]);
  }

  querySelectorAll(selector) {
    return this.descendants().filter(node => matchesSelector(node, selector));
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  cloneNode(deep = false) {
    const clone = new FakeElement(this.tagName, {
      className: this.className,
      id: this.id,
      name: this.name,
      type: this.type,
      placeholder: this.placeholder,
      value: this.value,
      hidden: this.hidden,
      disabled: this.disabled,
      readOnly: this.readOnly,
      textContent: this._ownText,
      attributes: Object.fromEntries(this.attributes),
    });
    if (deep) clone.append(...this.children.map(child => child.cloneNode(true)));
    return clone;
  }

  getBoundingClientRect() {
    return this.hidden
      ? { width: 0, height: 0, top: 0, left: 0 }
      : { width: 240, height: 32, top: 0, left: 0 };
  }
}

function attachOwnerDocument(element, document) {
  element.ownerDocument = document;
  for (const child of element.children) attachOwnerDocument(child, document);
}

function makeDocument(roots) {
  const document = {
    nodeType: 9,
    roots,
    defaultView: {
      CSS: { escape(value) { return String(value); } },
      getComputedStyle(element) {
        const hidden = Boolean(element?.hidden || element?.getAttribute?.('aria-hidden') === 'true');
        return hidden
          ? { display: 'none', visibility: 'hidden', opacity: '0', position: 'static' }
          : { display: 'block', visibility: 'visible', opacity: '1', position: 'static' };
      },
      requestAnimationFrame(callback) { callback(); },
    },
    querySelectorAll(selector) {
      const nodes = roots.flatMap(root => [root, ...root.descendants()]);
      return nodes.filter(node => matchesSelector(node, selector));
    },
    querySelector(selector) {
      return this.querySelectorAll(selector)[0] || null;
    },
    getElementById(id) {
      return this.querySelectorAll(`#${id}`)[0] || null;
    },
  };
  document.body = roots[0] || null;
  document.documentElement = roots[0] || null;
  for (const root of roots) attachOwnerDocument(root, document);
  return document;
}

function element(tagName, options, ...children) {
  return new FakeElement(tagName, options).append(...children);
}

function antCustomSelect(id = '') {
  return element('div', {
    id,
    className: 'ant-select-selector',
    attributes: { role: 'combobox' },
  },
  element('span', { className: 'ant-select-selection-search' },
    element('input', { type: 'search', attributes: { role: 'combobox' } }),
    element('input', { type: 'text', attributes: { 'aria-hidden': 'true', tabindex: '-1' } })),
  element('span', { className: 'ant-select-selection-item' }));
}

function vueCustomSelect(id = '') {
  const inner = element('div', {
    className: 'el-select__wrapper',
    attributes: { role: 'combobox' },
  },
  element('input', { type: 'search', attributes: { role: 'combobox' } }),
  element('input', { type: 'text', attributes: { 'aria-hidden': 'true' } }));
  return element('div', { id, className: 'el-select' }, inner);
}

function cascaderRoot(id, options = {}) {
  const trigger = element('input', {
    id: `${id}-input`,
    className: 'ant-input ant-cascader-input',
    type: 'text',
    placeholder: options.placeholder || '请选择省/市/区',
    readOnly: true,
    attributes: {
      role: 'combobox',
      'aria-haspopup': 'menu',
      'aria-controls': options.panelId || `${id}-panel`,
    },
  });
  const root = element('span', {
    id,
    className: 'ant-cascader-picker',
    attributes: {
      'data-cascader-root': '',
      'data-required-levels': String(options.requiredLevels ?? 3),
    },
  }, trigger, element('span', { className: 'ant-cascader-picker-label' }));
  return { root, trigger };
}

function antGridField(labelText, controlRoot, options = {}) {
  const label = element('label', { textContent: labelText });
  const labelColumn = element('div', { className: 'ant-col label-column' },
    element('div', { className: 'legacy-label-wrapper' }, label));
  const children = element('div', { className: 'ant-form-item-children' }, controlRoot);
  const control = element('div', { className: 'ant-form-item-control' }, children);
  const wrappedControl = options.omitControlWrapper
    ? control
    : element('div', { className: 'ant-form-item-control-wrapper' }, control);
  const formItem = element('div', { className: 'ant-form-item' }, wrappedControl);
  const controlColumn = element('div', { className: 'ant-col control-column' }, formItem);
  const row = element('div', { className: 'ant-row semantic-field-row' }, labelColumn, controlColumn);
  return { row, label, labelColumn, controlColumn, formItem, controlRoot };
}

function vueGridField(labelText, controlRoot) {
  const label = element('label', { textContent: labelText });
  const labelColumn = element('div', { className: 'el-col label-column' }, label);
  const content = element('div', { className: 'el-form-item__content' }, controlRoot);
  const control = element('div', { className: 'el-form-item-control' }, content);
  const wrapper = element('div', { className: 'el-form-item-control-wrapper' }, control);
  const formItem = element('div', { className: 'el-form-item' }, wrapper);
  const controlColumn = element('div', { className: 'el-col control-column' }, formItem);
  const row = element('div', { className: 'el-row semantic-field-row' }, labelColumn, controlColumn);
  return { row, label, labelColumn, controlColumn, formItem, controlRoot };
}

function basicContext() {
  return {
    section: 'basic', sectionId: 'basic', collection: 'basic', collectionMode: 'record',
    confidence: 1, source: 'adapter', regionId: 'page:basic',
  };
}

test('RED Ant/Vue: 5-6 layer sibling/grid labels resolve without changing one logical control', () => {
  const ant = antGridField('性别', antCustomSelect('gender'));
  const vue = vueGridField('民族', vueCustomSelect('ethnicity'));
  const document = makeDocument([ant.row, vue.row]);
  const descriptors = Detector.scan(document, { section: 'basic' });
  const byId = id => descriptors.find(descriptor => descriptor.element?.id === id);

  assert.equal(descriptors.length, 2);
  assert.equal(byId('gender')?.labelText, '性别');
  assert.equal(byId('gender')?.labelSource, 'form-row-sibling');
  assert.equal(byId('ethnicity')?.labelText, '民族');
  assert.equal(byId('ethnicity')?.labelSource, 'form-row-sibling');
  for (const descriptor of descriptors) {
    assert.deepEqual(descriptor.semanticOwnershipDebug, {
      logicalControlCount: 1,
      formItemFound: true,
      formItemLabelFound: true,
      ownershipReason: 'local-sibling-label',
    });
  }
});

test('RED nested owners: an unlabeled inner item/row continues to the next unique outer owner', () => {
  const rowControl = antCustomSelect('nested-row');
  const innerRow = element('div', { className: 'ant-row inner-layout-row' }, rowControl);
  const outerRow = element('div', { className: 'ant-row semantic-field-row' },
    element('div', { className: 'ant-col label-column' },
      element('label', { textContent: 'Nested row label' })),
    element('div', { className: 'ant-col control-column' }, innerRow));

  const itemControl = antCustomSelect('nested-item');
  const innerItem = element('div', { className: 'ant-form-item inner-item' },
    element('div', { className: 'ant-form-item-control' }, itemControl));
  const outerItem = element('div', { className: 'ant-form-item outer-item' },
    element('div', { className: 'ant-form-item-label' },
      element('label', { textContent: 'Nested item label' })),
    innerItem);
  makeDocument([outerRow, outerItem]);

  const rowDescriptor = Detector.buildDescriptor(rowControl, 0, { section: 'basic' });
  const itemDescriptor = Detector.buildDescriptor(itemControl, 1, { section: 'basic' });
  assert.equal(rowDescriptor.labelText, 'Nested row label');
  assert.equal(rowDescriptor.labelSource, 'form-row-sibling');
  assert.deepEqual(rowDescriptor.semanticOwnershipDebug, {
    logicalControlCount: 1,
    formItemFound: false,
    formItemLabelFound: true,
    ownershipReason: 'local-sibling-label',
  });
  assert.equal(itemDescriptor.labelText, 'Nested item label');
  assert.equal(itemDescriptor.labelSource, 'form-item-label');
  assert.deepEqual(itemDescriptor.semanticOwnershipDebug, {
    logicalControlCount: 1,
    formItemFound: true,
    formItemLabelFound: true,
    ownershipReason: 'single-logical-field',
  });
});

test('RED portal purity: external selected/current option references never become field labels', () => {
  const select = antCustomSelect('portal-selected-reference');
  select.setAttribute('aria-labelledby', 'portal-role-option portal-aria-selected portal-current-option');
  const roleOption = element('div', {
    id: 'portal-role-option', textContent: 'Role option value',
    attributes: { role: 'option' },
  });
  const ariaSelected = element('div', {
    id: 'portal-aria-selected', textContent: 'ARIA selected value',
    attributes: { 'aria-selected': 'true' },
  });
  const currentOption = element('div', {
    id: 'portal-current-option', className: 'ant-cascader-menu-item-active',
    textContent: 'Current option value',
  });
  makeDocument([select, roleOption, ariaSelected, currentOption]);

  const descriptor = Detector.buildDescriptor(select, 0, { section: 'basic' });
  assert.equal(descriptor.labelText, '');
  assert.equal(descriptor.labelSource, '');
});

test('RED provenance: diagnostic reports bounded sibling ownership without DOM or label values', () => {
  const fixture = antGridField('政治面貌', antCustomSelect('political'));
  makeDocument([fixture.row]);
  const descriptor = Detector.buildDescriptor(fixture.controlRoot, 0, { section: 'basic' });
  const diagnostic = Detector.toDiagnostic(descriptor);

  assert.equal(descriptor.labelText, '政治面貌');
  assert.deepEqual(diagnostic.semanticOwnershipDebug, {
    logicalControlCount: 1,
    formItemFound: true,
    formItemLabelFound: true,
    ownershipReason: 'local-sibling-label',
  });
  assert.doesNotMatch(
    JSON.stringify(diagnostic.semanticOwnershipDebug),
    /政治面貌|element|ownerDocument|children|semanticRoot/,
  );
});

test('fail-close: two independent controls in one grid row never borrow either sibling label', () => {
  const first = antGridField('性别', antCustomSelect('first'));
  const second = antGridField('民族', antCustomSelect('second'));
  const sharedRow = element('div', { className: 'ant-row semantic-field-row' },
    first.labelColumn, first.controlColumn, second.labelColumn, second.controlColumn);
  makeDocument([sharedRow]);

  const firstDescriptor = Detector.buildDescriptor(first.controlRoot, 0, { section: 'basic' });
  const secondDescriptor = Detector.buildDescriptor(second.controlRoot, 1, { section: 'basic' });
  assert.equal(firstDescriptor.labelText, '');
  assert.equal(secondDescriptor.labelText, '');
});

test('RED table boundary: data-table custom select keeps tableHeader authoritative and ignores outer grid label', () => {
  const select = antCustomSelect('paper-status');
  const table = element('table', { id: 'papers-table' },
    element('thead', {}, element('tr', {}, element('th', { textContent: '发表状态' }))),
    element('tbody', {}, element('tr', {}, element('td', {}, select))));
  const fixture = antGridField('不得借用的外层字段', table, { omitControlWrapper: true });
  makeDocument([fixture.row]);

  const descriptor = Detector.buildDescriptor(select, 0, { section: 'papers' });
  assert.equal(descriptor.tableHeader, '发表状态');
  assert.equal(descriptor.labelText, '');
});

test('RED shared resolver: Cascader, readonly Date-like and compound picker recover the same local owner', () => {
  const place = cascaderRoot('birth-place');
  const placeField = antGridField('出生地', place.root);

  const birthday = element('input', {
    id: 'birthday', type: 'text', readOnly: true, placeholder: '请选择出生日期',
  });
  const dateShell = element('div', { className: 'ant-picker' }, birthday,
    element('button', {
      type: 'button', className: 'ant-picker-suffix calendar-trigger', textContent: '日历',
      attributes: { 'aria-label': '选择出生日期', 'aria-controls': 'birthday-panel' },
    }));
  const dateField = antGridField('出生日期', dateShell, { omitControlWrapper: true });

  const schoolInput = element('input', { id: 'school', type: 'text', readOnly: true });
  const compoundShell = element('div', { className: 'compound-picker-shell' }, schoolInput,
    element('button', { type: 'button', textContent: '选择学校' }));
  const schoolField = antGridField('毕业院校', compoundShell, { omitControlWrapper: true });

  makeDocument([placeField.row, dateField.row, schoolField.row]);
  const cascader = Detector.buildDescriptor(place.root, 0, { section: 'basic' });
  const date = Detector.buildDescriptor(birthday, 1, { section: 'basic' });
  const compound = Detector.buildDescriptor(schoolInput, 2, {
    section: 'basic', compoundPickerSupported: true,
  });

  assert.equal(cascader.controlKind, 'cascader');
  assert.equal(cascader.labelText, '出生地');
  assert.equal(date.labelText, '出生日期');
  assert.equal(date.interactiveReadonly, true);
  assert.equal(date.readonlyInteractionKind, 'date-like');
  assert.equal(compound.labelText, '毕业院校');
  assert.equal(compound.controlKind, 'compound-picker');
});

test('Date regression: absent local owner preserves semantic-placeholder instead of promoting it to labelText', () => {
  const input = element('input', {
    id: 'fallback-birthday', type: 'text', readOnly: true, placeholder: '请选择出生日期',
  });
  const shell = element('div', { className: 'ant-picker' }, input,
    element('button', {
      type: 'button', className: 'calendar-trigger', textContent: '日历',
      attributes: { 'aria-label': '选择出生日期' },
    }));
  const formItem = element('div', { className: 'ant-form-item' }, shell);
  makeDocument([formItem]);

  const descriptor = Detector.buildDescriptor(input, 0, { section: 'basic' });
  assert.equal(descriptor.labelText, '');
  assert.equal(descriptor.labelSource, 'semantic-placeholder');
  assert.equal(descriptor.semanticPlaceholder, '出生日期');
  assert.equal(descriptor.interactiveReadonly, true);
});

test('JQX regression: direct form-item labels and logical grouping remain unchanged', () => {
  const label = element('label', { className: 'ant-form-item-label', textContent: '本科学制' });
  const jqx = element('div', {
    id: 'jqx-duration', className: 'jqx-widget jqx-dropdownlist-state-normal',
    attributes: { role: 'combobox' },
  }, element('input', { type: 'text' }));
  const formItem = element('div', { className: 'ant-form-item' }, label, jqx);
  const document = makeDocument([formItem]);

  const descriptors = Detector.scan(document, { section: 'education' });
  assert.equal(descriptors.length, 1);
  assert.equal(descriptors[0].element, jqx);
  assert.equal(descriptors[0].controlKind, 'custom-select');
  assert.equal(descriptors[0].labelText, '本科学制');
});

test('RED Cascader labels: all real sibling-owned geographic controls recover their actual page wording', () => {
  const labels = ['出生地', '籍贯所在地', '户口所在地', '档案所在地'];
  const fixtures = labels.map((label, index) => {
    const picker = cascaderRoot(`location-${index}`);
    return { label, picker, field: antGridField(label, picker.root) };
  });
  makeDocument(fixtures.map(fixture => fixture.field.row));

  const recovered = fixtures.map((fixture, index) => {
    const descriptor = Detector.buildDescriptor(fixture.picker.root, index, { section: 'basic' });
    assert.equal(descriptor.controlKind, 'cascader');
    return descriptor.labelText;
  });
  assert.deepEqual(recovered, labels);
});

test('schema guard: resolver does not invent Cascader canonical fields absent from the current Resume schema', () => {
  const paths = new Set(FieldAliases.FIELD_DEFINITIONS.map(definition => definition.path));
  assert.equal(paths.has('basic.hometown'), true);
  assert.equal(paths.has('contact.currentCity'), true);
  assert.equal(paths.has('basic.householdAddress'), true);
  assert.equal(paths.has('contact.archiveAddress'), true);
  assert.equal(paths.has('basic.birthplace'), false);
  assert.equal(paths.has('basic.householdLocation'), false);
  assert.equal(paths.has('contact.archiveLocation'), false);
});

test('RED canonical matcher: recovered Cascader labels use existing paths at the unchanged default threshold', () => {
  const hometownPicker = cascaderRoot('canonical-hometown');
  const hometownField = antGridField('籍贯所在地', hometownPicker.root);
  const currentCityPicker = cascaderRoot('canonical-current-city');
  const currentCityField = antGridField('现居城市', currentCityPicker.root);
  makeDocument([hometownField.row, currentCityField.row]);

  const resume = {
    basic: { hometown: '山东省 / 青岛市 / 市北区' },
    contact: { currentCity: '江苏省 / 南京市 / 玄武区' },
  };
  const resumeView = FieldAliases.buildResumeView(resume);
  const expectations = [
    [hometownPicker.root, 'basic.hometown'],
    [currentCityPicker.root, 'contact.currentCity'],
  ];

  expectations.forEach(([root, expectedPath], index) => {
    const descriptor = Detector.buildDescriptor(root, index, { section: 'basic' });
    descriptor.context = basicContext();
    const match = Matcher.matchField(descriptor, resume, { section: 'basic', resumeView });
    assert.equal(match.status, 'MATCHED', `${expectedPath}: ${match.reason}`);
    assert.equal(match.matchedPath, expectedPath);
    assert.ok(match.score >= 62, `${expectedPath}: default threshold must remain 62`);
  });
});

test('RED matcher isolation: a pre-resolved Cascader label is not penalized as an incompatible text field', () => {
  const resume = {
    basic: { hometown: '山东省 / 青岛市 / 市北区' },
    contact: { currentCity: '江苏省 / 南京市 / 玄武区' },
  };
  const resumeView = FieldAliases.buildResumeView(resume);
  for (const [labelText, expectedPath] of [
    ['籍贯所在地', 'basic.hometown'],
    ['现居城市', 'contact.currentCity'],
  ]) {
    const descriptor = {
      detectorId: `pre-resolved-${expectedPath}`,
      element: {},
      visible: true,
      hidden: false,
      disabled: false,
      readOnly: false,
      sensitive: false,
      maskedDisplay: false,
      labelText,
      labelSource: 'form-row-sibling',
      controlKind: 'cascader',
      baseControlKind: 'cascader',
      context: basicContext(),
    };
    const match = Matcher.matchField(descriptor, resume, { section: 'basic', resumeView });
    assert.equal(match.status, 'MATCHED', `${expectedPath}: ${match.reason}`);
    assert.equal(match.matchedPath, expectedPath);
    assert.ok(match.score >= 62, `${expectedPath}: matcher threshold must not be reduced`);
  }
});

test('RED Compound Cascader: exact current-city label under basic context resolves canonical contact path', () => {
  const resume = {
    basic: { hometown: '山东省 / 青岛市 / 市北区' },
    contact: { currentCity: '江苏省 / 南京市 / 玄武区' },
  };
  const resumeView = FieldAliases.buildResumeView(resume);
  const descriptor = {
    detectorId: 'compound-native-place-cascader',
    element: {},
    interactionElement: {},
    visible: true,
    hidden: false,
    disabled: false,
    readOnly: false,
    sensitive: false,
    maskedDisplay: false,
    labelText: '现居城市（省/市/区）',
    labelSource: 'form-row-sibling',
    controlKind: 'cascader',
    baseControlKind: 'cascader',
    context: basicContext(),
  };

  const match = Matcher.matchField(descriptor, resume, {
    section: 'basic',
    sectionContext: basicContext(),
    resumeView,
  });

  assert.equal(match.status, 'MATCHED', match.reason);
  assert.equal(match.matchedPath, 'contact.currentCity');
  assert.equal(match.value, '江苏省 / 南京市 / 玄武区');
  assert.ok(match.score >= 62, 'default matcher threshold must remain unchanged');
  assert.equal(match.scope?.collection, 'basic');
  assert.equal(match.scope?.usedGlobalFallback, true);
});

test('Cascader missing layer stays fail-closed: two-level legacy JSON never guesses district', async () => {
  const picker = cascaderRoot('required-three', { panelId: 'required-three-panel', requiredLevels: 3 });
  const panel = element('div', {
    id: 'required-three-panel', className: 'ant-cascader-menus', hidden: true,
  });
  const provinceMenu = element('ul', {
    className: 'ant-cascader-menu', hidden: true, attributes: { 'data-cascader-level': '0' },
  }, element('li', {
    className: 'ant-cascader-menu-item', textContent: '山东省',
    attributes: { role: 'menuitem', 'data-cascader-level': '0', 'data-value': '山东省' },
  }));
  const cityMenu = element('ul', {
    className: 'ant-cascader-menu', hidden: true, attributes: { 'data-cascader-level': '1' },
  }, element('li', {
    className: 'ant-cascader-menu-item', textContent: '青岛市',
    attributes: { role: 'menuitem', 'data-cascader-level': '1', 'data-value': '青岛市' },
  }));
  const districtMenu = element('ul', {
    className: 'ant-cascader-menu', hidden: true, attributes: { 'data-cascader-level': '2' },
  }, element('li', {
    className: 'ant-cascader-menu-item', textContent: '市北区',
    attributes: { role: 'menuitem', 'data-cascader-level': '2', 'data-value': '市北区' },
  }));
  panel.append(provinceMenu, cityMenu, districtMenu);
  makeDocument([picker.root, panel]);

  const legacyResume = { personal: { hometown_province: '山东省', hometown_city: '青岛市' } };
  const legacyValue = FieldAliases.buildResumeView(legacyResume).basic.hometown;
  assert.deepEqual(CascaderAdapter.parsePath(legacyValue), ['山东省', '青岛市']);

  const clickedLevels = [];
  const result = await CascaderAdapter.write({
    descriptor: {
      element: picker.root,
      interactionElement: picker.trigger,
      cascaderRoot: picker.root,
      cascaderTrigger: picker.trigger,
      controlKind: 'cascader',
    },
    value: legacyValue,
    fieldPath: 'basic.hometown',
    settings: { cascaderTimeoutMs: 10 },
    dependencies: {
      EventDispatcher: {
        clickLikeUser(target, details = {}) {
          if (details.purpose === 'cascader-trigger') {
            panel.hidden = false;
            provinceMenu.hidden = false;
            return true;
          }
          if (details.purpose !== 'cascader-option') return false;
          clickedLevels.push(details.level);
          if (details.level === 0) cityMenu.hidden = false;
          if (details.level === 1) districtMenu.hidden = false;
          return true;
        },
      },
    },
  });

  assert.equal(result.status, 'NEEDS_CONFIRMATION');
  assert.deepEqual(clickedLevels, [0, 1]);
  assert.equal(CascaderAdapter.getDebugTrace(picker.root)?.ambiguityReason, 'MISSING_REQUIRED_LEVEL');
});
