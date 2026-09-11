import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const testDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(testDirectory, '..', '..');

const Semantics = require('../../src/semantics/field-semantic-normalizer.js');
const Fields = require('../../src/mappings/field-aliases.js');
const Options = require('../../src/mappings/option-aliases.js');
const Matcher = require('../../src/core/field-matcher.js');
const Verification = require('../../src/core/verification-engine.js');
const Form = require('../../src/core/form-filler.js');
const Controls = require('../../src/controls/control-adapter-registry.js');

function descriptor(label, controlKind = 'text') {
  return {
    detectorId: `field:${label}`,
    visible: true,
    hidden: false,
    disabled: false,
    readOnly: false,
    maskedDisplay: false,
    sensitive: false,
    controlKind,
    baseControlKind: controlKind,
    type: controlKind,
    labelText: '',
    tableHeader: label,
    ariaLabel: '',
    placeholder: '',
    name: '',
    id: '',
    title: '',
    groupText: '',
    nearbyText: '',
    parentText: '',
  };
}

function arrayContext(section, index = 0) {
  return {
    sectionId: section,
    source: 'embedded-structure',
    confidence: 0.98,
    collection: section,
    collectionMode: 'repeatable',
    indexContext: { section, index },
  };
}



class FakeEvent {
  constructor(type, init = {}) { this.type = type; Object.assign(this, init); }
}

const fakeView = {
  Event: FakeEvent,
  InputEvent: FakeEvent,
  FocusEvent: FakeEvent,
  MouseEvent: FakeEvent,
  PointerEvent: FakeEvent,
  KeyboardEvent: FakeEvent,
  requestAnimationFrame(callback) { callback(); },
  getComputedStyle() { return { display: 'block', visibility: 'visible', position: 'static' }; },
};

class FakeSelect {
  constructor(optionTexts) {
    this.tagName = 'SELECT';
    this.type = 'select-one';
    this.hidden = false;
    this.disabled = false;
    this.readOnly = false;
    this.isConnected = true;
    this.events = [];
    this._value = '';
    this.options = optionTexts.map((text, index) => ({
      textContent: text,
      label: text,
      value: index === 0 ? '' : text,
      selected: index === 0,
      disabled: false,
    }));
    this.ownerDocument = { defaultView: fakeView, body: null, documentElement: null };
  }
  get value() { return this._value; }
  set value(value) {
    this._value = String(value);
    for (const option of this.options) option.selected = option.value === this._value;
  }
  get selectedOptions() { return this.options.filter(option => option.selected); }
  focus() {}
  blur() {}
  dispatchEvent(event) { this.events.push(event.type); return true; }
  getAttribute() { return null; }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  getBoundingClientRect() { return { width: 220, height: 34, left: 0, top: 0 }; }
}


test('SemanticNormalizer 统一跨平台日期字段措辞，但不改写毕业年月等独立语义', () => {
  assert.equal(Semantics.normalizeFieldPhrase('起始年月'), Semantics.normalizeFieldPhrase('开始时间'));
  assert.equal(Semantics.normalizeFieldPhrase('开始年月'), Semantics.normalizeFieldPhrase('开始时间'));
  assert.equal(Semantics.normalizeFieldPhrase('截止日期'), Semantics.normalizeFieldPhrase('结束时间'));
  assert.equal(Semantics.normalizeFieldPhrase('实习起始年月'), Semantics.normalizeFieldPhrase('实习开始时间'));
  assert.notEqual(Semantics.normalizeFieldPhrase('预计毕业年月'), Semantics.normalizeFieldPhrase('结束时间'));
});

test('internships 在不同平台的起始年月/结束年月都能匹配 canonical startDate/endDate', () => {
  const resume = { internships: [{ startDate: '2024-01', endDate: '2024-06', company: '示例单位', position: '实习生' }] };
  const view = Fields.buildResumeView(resume);
  const context = arrayContext('internships');

  const start = Matcher.matchField(descriptor('起始年月'), resume, { sectionContext: context, resumeView: view });
  const end = Matcher.matchField(descriptor('结束年月'), resume, { sectionContext: context, resumeView: view });

  assert.equal(start.status, 'MATCHED', start.reason);
  assert.equal(start.matchedPath, 'internships[].startDate');
  assert.equal(end.status, 'MATCHED', end.reason);
  assert.equal(end.matchedPath, 'internships[].endDate');
});

test('studyDuration 使用字段感知 option canonicalization 匹配 4/4年/四年制', () => {
  const options = [
    { label: '三年制', value: '3' },
    { label: '四年制', value: '4' },
    { label: '五年制', value: '5' },
  ];
  for (const expected of ['4', '4年', '四年', '本科四年制']) {
    const result = Options.findBestOption(expected, options, {
      fieldPath: 'education[].studyDuration',
      minScore: 0.88,
    });
    assert.equal(result.matched, true, `${expected}: ${JSON.stringify(result)}`);
    assert.equal(result.label, '四年制');
  }
  assert.equal(
    Verification.semanticOptionEquivalent('4年', '四年制', { fieldPath: 'education[].studyDuration' }),
    true,
  );
});

test('ControlAdapterRegistry 以能力/框架识别控件，而不是依赖站点域名', () => {
  const jqxElement = {
    id: 'jqxWidget123', className: 'jqx-widget jqx-dropdownlist-state-normal',
    getAttribute(name) { return name === 'role' ? 'combobox' : null; },
    querySelector(selector) { return selector.includes('jqx') ? {} : null; },
  };
  const jqx = Controls.resolve({
    controlKind: 'custom-select', baseControlKind: 'custom-select', type: 'custom-select',
    element: jqxElement, interactionElement: jqxElement, parent: { classes: [] },
  });
  assert.equal(jqx.framework, 'jqx');
  assert.equal(jqx.adapterId, 'custom-select');
  assert.ok(jqx.capabilities.includes('enumerate-options'));

  const date = Controls.resolve(descriptor('开始时间', 'text'), { expectedType: 'date' });
  assert.equal(date.adapterId, 'date-like');
  assert.ok(date.capabilities.includes('select-month'));

  const native = Controls.resolve(descriptor('姓名', 'text'));
  assert.equal(native.adapterId, 'native-value');
});

test('Phase 2 新模块必须进入浏览器注入顺序与构建契约', async () => {
  const [popup, build] = await Promise.all([
    readFile(resolve(projectRoot, 'popup.js'), 'utf8'),
    readFile(resolve(projectRoot, 'scripts/build.mjs'), 'utf8'),
  ]);
  const semantics = popup.indexOf("'src/semantics/field-semantic-normalizer.js'");
  const matcher = popup.indexOf("'src/core/field-matcher.js'");
  const controls = popup.indexOf("'src/controls/control-adapter-registry.js'");
  const filler = popup.indexOf("'src/core/form-filler.js'");
  assert.ok(semantics >= 0 && semantics < matcher);
  assert.ok(controls >= 0 && controls < filler);
  assert.match(build, /src\/semantics\/field-semantic-normalizer\.js/);
  assert.match(build, /src\/controls\/control-adapter-registry\.js/);
});


test('FormFiller 通过 ControlRegistry + field-aware options 选择跨平台学制选项', async () => {
  const select = new FakeSelect(['请选择', '三年制', '四年制', '五年制']);
  const field = descriptor('培养年限', 'native-select');
  field.element = select;
  field.interactionElement = select;
  field.options = select.options.map(option => ({
    element: option,
    label: option.textContent,
    value: option.value,
    disabled: option.disabled,
  }));
  const result = await Form.fill(field, '4年', {
    fieldPath: 'education[].studyDuration',
    expectedType: 'choice',
    allowOverwrite: false,
  });
  assert.equal(result.status, 'SUCCESS', result.reason);
  assert.equal(select.value, '四年制');
});


test('Custom Select 的“请选择/未选择”视为占位状态，不应被误判为已有内容冲突', async () => {
  const selected = { textContent: '请选择' };
  const custom = {
    tagName: 'DIV', id: '', className: '', hidden: false, disabled: false, readOnly: false,
    isConnected: true, ownerDocument: { defaultView: fakeView, body: null, documentElement: null,
      querySelectorAll() { return []; }, getElementById() { return null; } },
    getAttribute() { return null; },
    querySelector(selector) { return selector.includes('selection-item') ? selected : null; },
    querySelectorAll() { return []; },
    getBoundingClientRect() { return { width: 220, height: 34, left: 0, top: 0 }; },
    focus() {}, click() {}, dispatchEvent() { return true; }, closest() { return null; },
  };
  const field = descriptor('本科学制', 'custom-select');
  field.element = custom;
  field.interactionElement = custom;
  const result = await Form.fill(field, '4年', {
    fieldPath: 'education[].studyDuration',
    expectedType: 'choice',
    allowOverwrite: false,
    customSelectTimeoutMs: 100,
  });
  assert.notEqual(result.status, 'CONFLICT');
  assert.equal(result.status, 'NEEDS_CONFIRMATION');
});
