import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Sections = require('../../src/mappings/section-aliases.js');
const Fields = require('../../src/mappings/field-aliases.js');
const Options = require('../../src/mappings/option-aliases.js');
const Dates = require('../../src/mappings/date-rules.js');
const Detector = require('../../src/core/field-detector.js');
const Matcher = require('../../src/core/field-matcher.js');
const Events = require('../../src/core/event-dispatcher.js');
const Verification = require('../../src/core/verification-engine.js');
const Form = require('../../src/core/form-filler.js');

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
  CSS: { escape(value) { return String(value); } },
};

class FakeInput {
  constructor(type = 'text') {
    this.tagName = 'INPUT';
    this.type = type;
    this.id = '';
    this.name = '';
    this.placeholder = '';
    this.disabled = false;
    this.readOnly = false;
    this.required = false;
    this.multiple = false;
    this.hidden = false;
    this.isConnected = true;
    this.isContentEditable = false;
    this.events = [];
    this.attributes = new Map();
    this._value = '';
    this._checked = false;
    this.ownerDocument = {
      defaultView: fakeView,
      body: null,
      documentElement: null,
      getElementById() { return null; },
      querySelector() { return null; },
      querySelectorAll() { return []; },
    };
  }

  get value() { return this._value; }
  set value(value) { this._value = String(value); }
  get checked() { return this._checked; }
  set checked(value) { this._checked = Boolean(value); }
  focus() {}
  blur() {}
  dispatchEvent(event) {
    this.events.push(event.type);
    if (event.type === 'input') this.frameworkValue = this.value;
    if (event.type === 'change') this.frameworkChecked = this.checked;
    return true;
  }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  matches(selector) {
    if (selector.includes('input[type="hidden"]')) return this.type === 'hidden';
    if (selector.includes('[role="combobox"]')) return this.getAttribute('role') === 'combobox';
    if (selector.includes('input')) return true;
    return false;
  }
  closest() { return null; }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  getBoundingClientRect() { return { width: 220, height: 34, top: 0, left: 0 }; }
}

class FakeSelect extends FakeInput {
  constructor(optionTexts) {
    super('select-one');
    this.tagName = 'SELECT';
    this.options = optionTexts.map((text, index) => ({
      textContent: text,
      label: text,
      value: index === 0 ? '' : text,
      selected: index === 0,
      disabled: false,
    }));
    this._value = '';
  }

  get value() { return this._value; }
  set value(value) {
    this._value = String(value);
    this.options?.forEach(option => { option.selected = option.value === this._value; });
  }
  get selectedOptions() { return this.options.filter(option => option.selected); }
  matches(selector) { return selector.includes('select') || super.matches(selector); }
}

function descriptor(labelText, section, controlKind = 'text', element = new FakeInput()) {
  return {
    detectorId: `${section}-${labelText}`,
    element,
    elements: [element],
    visible: true,
    hidden: false,
    disabled: false,
    readOnly: false,
    section,
    controlKind,
    type: controlKind,
    labelText,
    tableHeader: '',
    placeholder: '',
    ariaLabel: '',
    name: '',
    id: '',
    title: '',
    groupText: '',
    nearbyText: '',
    parentText: '',
    options: [],
  };
}

test('SectionAliases 识别主要栏目，弱词“信息”不强判', () => {
  const cases = {
    基本信息: 'basic',
    教育背景: 'education',
    奖励或处分: 'awards',
    科研情况: 'research',
    项目经历: 'projects',
    论文成果: 'papers',
  };
  Object.entries(cases).forEach(([text, section]) => {
    const result = Sections.classifySection(text);
    assert.equal(result.section, section);
    assert.ok(result.score >= 0.9);
  });
  assert.equal(Sections.classifySection('信息').section, null);
  assert.equal(Sections.classifySection('其他情况').section, null);
});

test('Resume 语义视图兼容 personal、internship、languages 和 awards content/time', () => {
  const resume = {
    personal: { name: '示例同学', phone: '13800000000', current_city: '上海' },
    internship: [{ company: '示例单位', start: '2025-01', desc: '示例工作' }],
    languages: [{ language: '英语', exam_date: '2024-06' }],
    awards: [{ content: '第一项', time: '2025-7' }, { content: '第二项', time: '2025-8' }],
  };
  const view = Fields.buildResumeView(resume);
  assert.equal(view.basic.name, '示例同学');
  assert.equal(view.contact.phone, '13800000000');
  assert.equal(view.internships[0].startDate, '2025-01');
  assert.equal(view.language[0].examDate, '2024-06');
  assert.equal(view.awards[0].name, '第一项');
  assert.equal(view.awards[0].date, '2025-7');
  assert.equal(Fields.resolveValue(resume, 'awards[].name', { arrayContext: { section: 'awards', index: 1 } }), '第二项');
  assert.equal(Fields.resolveValue('internships[].description', resume), '示例工作');
});

test('FieldMatcher 通过字段级评分匹配姓名、手机号、出生日期、学校、专业和奖励字段', () => {
  const resume = {
    personal: { name: '示例同学', phone: '13800000000', birthday: '2002-01-02' },
    education: [{ school: '示例大学', major: '材料科学' }],
    awards: [{ content: '示例奖项', time: '2025-7' }],
  };
  const cases = [
    ['姓名', 'basic', 'basic.name'],
    ['手机号码', 'basic', 'contact.phone'],
    ['出生日期', 'basic', 'basic.birthday'],
    ['学校名称', 'education', 'education[].school'],
    ['所学专业', 'education', 'education[].major'],
    ['获奖名称', 'awards', 'awards[].name'],
    ['获奖时间', 'awards', 'awards[].date'],
  ];
  cases.forEach(([label, section, path]) => {
    const match = Matcher.matchFields([descriptor(label, section)], resume, { section })[0];
    assert.equal(match.status, 'MATCHED', `${label}: ${match.reason}`);
    assert.equal(match.matchedPath, path);
    assert.ok(match.score >= 62);
  });
});

test('FieldMatcher 使用数组 index，一条 Resume 数据只映射对应 DOM 组', () => {
  const resume = { awards: [{ content: '第一项' }, { content: '第二项' }, { content: '第三项' }] };
  const match = Matcher.matchFields([descriptor('奖项名称', 'awards')], resume, {
    section: 'awards',
    arrayContext: { section: 'awards', index: 2 },
  })[0];
  assert.equal(match.matchedPath, 'awards[].name');
  assert.equal(match.value, '第三项');
});

test('FieldMatcher 对无上下文的“名称”保持人工确认，不猜模块', () => {
  const resume = { basic: { name: '示例' }, awards: [{ name: '奖项' }], projects: [{ name: '项目' }] };
  const match = Matcher.matchFields([descriptor('名称', null)], resume, { section: null })[0];
  assert.notEqual(match.status, 'MATCHED');
  assert.ok(['NEEDS_CONFIRMATION', 'UNMATCHED'].includes(match.status));
});

test('OptionAliases 支持性别、政治面貌和学历同义选项，但不选择占位项', () => {
  const gender = Options.findBestOption('男性', [
    { label: '请选择', value: '' },
    { label: '男', value: 'M' },
    { label: '女', value: 'F' },
  ]);
  assert.equal(gender.matched, true);
  assert.equal(gender.label, '男');
  assert.equal(Options.findBestOption('中国共产党党员', ['中共党员', '共青团员']).label, '中共党员');
  assert.equal(Options.findBestOption('大学本科', ['本科', '硕士']).label, '本科');
});

test('DateRules 解析并按 date/month/斜线/中文提示转换，缺少日时不猜具体日期', () => {
  assert.deepEqual(Dates.parseDateValue('2025年7月9日'), {
    year: 2025, month: 7, day: 9, precision: 'day', source: '2025年7月9日',
  });
  assert.equal(Dates.formatDateForField('2025/7/9', { inputType: 'date' }).value, '2025-07-09');
  assert.equal(Dates.formatDateForField('2025.7', { inputType: 'month' }).value, '2025-07');
  assert.equal(Dates.formatDateForField('2025-7-9', { placeholder: 'YYYY/MM/DD' }).value, '2025/07/09');
  assert.equal(Dates.formatDateForField('2025-7', { inputType: 'date' }).ok, false);
  assert.equal(Dates.datesEquivalent('2025-7', '2025-07-31'), true);
});

test('EventDispatcher 使用原生 setter 并按 React/Vue 事件链回读', async () => {
  const input = new FakeInput();
  const result = await Events.setNativeValue(input, '示例值');
  assert.equal(result.ok, true);
  assert.equal(input.value, '示例值');
  assert.equal(input.frameworkValue, '示例值');
  const requiredOrder = ['focus', 'pointerdown', 'mousedown', 'input', 'change', 'blur'];
  let cursor = -1;
  requiredOrder.forEach(eventName => {
    const next = input.events.indexOf(eventName, cursor + 1);
    assert.ok(next > cursor, `${eventName} 事件顺序不正确: ${input.events.join(',')}`);
    cursor = next;
  });
});

test('FormFiller 填写普通 input 并默认不覆盖已有内容', async () => {
  const input = new FakeInput();
  const field = descriptor('姓名', 'basic', 'text', input);
  const filled = await Form.fill(field, '示例同学', { allowOverwrite: false });
  assert.equal(filled.status, 'SUCCESS');
  input.value = '网页已有姓名';
  const conflict = await Form.fill(field, '另一姓名', { allowOverwrite: false });
  assert.equal(conflict.status, 'CONFLICT');
  assert.equal(input.value, '网页已有姓名');
});

test('FormFiller 可靠选择 native select 与 radio，不猜首项', async () => {
  const select = new FakeSelect(['请选择', '男', '女']);
  const selectDescriptor = descriptor('性别', 'basic', 'native-select', select);
  selectDescriptor.options = select.options.map(option => ({
    element: option, label: option.textContent, value: option.value, disabled: option.disabled,
  }));
  const selectResult = await Form.fill(selectDescriptor, '男性', { allowOverwrite: false });
  assert.equal(selectResult.status, 'SUCCESS');
  assert.equal(select.value, '男');

  const male = new FakeInput('radio');
  const female = new FakeInput('radio');
  male.value = '男';
  female.value = '女';
  const radioDescriptor = descriptor('性别', 'basic', 'radio', male);
  radioDescriptor.elements = [male, female];
  radioDescriptor.options = [
    { label: '男', value: '男', element: male },
    { label: '女', value: '女', element: female },
  ];
  const radioResult = await Form.fill(radioDescriptor, '女性', { allowOverwrite: false });
  assert.equal(radioResult.status, 'SUCCESS');
  assert.equal(female.checked, true);
  assert.equal(male.checked, false);
});

test('FieldDetector 扫描标准字段，诊断结果不含当前真实 value 或 DOM 引用', () => {
  const input = new FakeInput();
  input.id = 'student_name';
  input.name = 'studentName';
  input.value = '不应出现在诊断中的真实姓名';
  input.placeholder = '请输入姓名';
  input.labels = [{
    textContent: '姓名',
    cloneNode() { return { textContent: '姓名', querySelectorAll() { return []; } }; },
  }];
  const document = {
    nodeType: 9,
    defaultView: fakeView,
    body: null,
    documentElement: null,
    getElementById() { return null; },
    querySelector() { return null; },
    querySelectorAll(selector) {
      if (selector === Detector.STANDARD_SELECTOR) return [input];
      if (selector === 'input[type="file"]') return [];
      return [];
    },
  };
  document.body = document;
  document.documentElement = document;
  input.ownerDocument = document;
  const fields = Detector.scan(document, { section: 'basic' });
  assert.equal(fields.length, 1);
  assert.equal(fields[0].labelText, '姓名');
  assert.equal(fields[0].currentValue, '不应出现在诊断中的真实姓名');
  const diagnostic = Detector.toDiagnostic(fields[0]);
  assert.equal(Object.hasOwn(diagnostic, 'currentValue'), false);
  assert.equal(Object.hasOwn(diagnostic, 'element'), false);
  assert.doesNotMatch(JSON.stringify(diagnostic), /不应出现在诊断中的真实姓名/);
});

test('VerificationEngine 验证 checkbox 状态', async () => {
  const checkbox = new FakeInput('checkbox');
  const field = descriptor('是否同意', 'basic', 'checkbox', checkbox);
  const result = await Events.setChecked(checkbox, true);
  assert.equal(result.ok, true);
  const verified = Verification.verify(field, true);
  assert.equal(verified.status, 'SUCCESS');
});

test('事件层拒绝密码、文件和提交控件，通用点击必须声明受限用途', async () => {
  for (const type of ['password', 'file', 'submit', 'reset']) {
    const element = new FakeInput(type);
    const result = await Events.setNativeValue(element, '禁止写入');
    assert.equal(result.ok, false, type);
    assert.notEqual(element.value, '禁止写入', type);
  }
  const ordinary = new FakeInput('button');
  assert.equal(Events.clickLikeUser(ordinary), false);
});

test('敏感认证字段不进入诊断或匹配', () => {
  const password = new FakeInput('password');
  const sensitive = descriptor('登录密码', 'basic', 'text', password);
  sensitive.inputType = 'password';
  sensitive.sensitive = true;
  assert.equal(Detector.toDiagnostic(sensitive), null);
  const match = Matcher.matchFields([sensitive], { basic: { name: '示例' } }, { section: 'basic' })[0];
  assert.equal(match.status, 'SKIPPED');
  assert.equal(match.matchedPath, null);
});

test('自定义 Select 没有高可靠选项时返回人工确认，不点击任意首项', async () => {
  const trigger = new FakeInput('text');
  trigger.setAttribute('role', 'combobox');
  trigger.ownerDocument.body = null;
  const field = descriptor('政治面貌', 'basic', 'custom-select', trigger);
  field.interactionElement = trigger;
  const result = await Form.fill(field, '中共党员', { allowOverwrite: false });
  assert.equal(result.status, 'NEEDS_CONFIRMATION');
  assert.match(result.reason, /没有可靠匹配项/);
});
