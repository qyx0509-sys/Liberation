import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Detector = require('../../src/core/field-detector.js');
const DateLike = require('../../src/controls/adapters/date-like-adapter.js');
const Events = require('../../src/core/event-dispatcher.js');

function visibleNode(tagName, options = {}) {
  const attributes = new Map(Object.entries(options.attributes || {}));
  return {
    tagName,
    type: options.type || '',
    id: options.id || '',
    className: options.className || '',
    textContent: options.textContent || '',
    innerText: options.textContent || '',
    hidden: Boolean(options.hidden),
    disabled: false,
    isConnected: true,
    clickCount: 0,
    parentElement: options.parentElement || null,
    ownerDocument: null,
    getAttribute(name) { return attributes.get(name) ?? null; },
    getBoundingClientRect() { return { width: 120, height: 32 }; },
    querySelectorAll() { return []; },
    click() { this.clickCount += 1; options.onClick?.(); },
    focus() {},
  };
}

function overlayDocument(trigger, panel, { initiallyVisible = false } = {}) {
  let panelVisible = initiallyVisible;
  trigger.click = function click() {
    this.clickCount += 1;
    panelVisible = true;
  };
  const document = {
    body: null,
    documentElement: null,
    defaultView: {
      requestAnimationFrame(callback) { callback(); },
      getComputedStyle() { return { display: 'block', visibility: 'visible', opacity: '1' }; },
    },
    querySelectorAll(selector) {
      return panelVisible && /role="dialog"|date-picker|datepicker|month-picker|monthpicker|calendar|picker-panel/.test(String(selector))
        ? [panel]
        : [];
    },
    getElementById(id) { return panelVisible && id === panel.id ? panel : null; },
  };
  document.body = { ownerDocument: document };
  document.documentElement = { ownerDocument: document };
  for (const node of [trigger, panel, ...(panel.children || [])]) node.ownerDocument = document;
  return document;
}

function dateContext(trigger, panel, document) {
  const input = visibleNode('INPUT', { type: 'text' });
  input.readOnly = true;
  input.value = '';
  input.ownerDocument = document;
  input.parentElement = { querySelectorAll() { return [trigger]; } };
  const runtime = {
    canClickLikeUser() { return true; },
    clickLikeUser(node) { node.click(); return true; },
    readControlValue() { return input.value; },
  };
  return {
    descriptor: {
      element: input,
      interactionElement: input,
      controlKind: 'month',
      inputType: 'text',
      readOnly: true,
      datePickerTrigger: trigger,
      datePickerAmbiguous: false,
    },
    value: '2025-09',
    fieldPath: 'education[].enrollmentDate',
    expectedType: 'date',
    settings: { datePickerTimeoutMs: 1 },
    dependencies: { EventDispatcher: runtime },
  };
}

function imageViewerFixture({ controlled = false } = {}) {
  const month = visibleNode('DIV', { className: 'image-caption', textContent: '9月' });
  const next = visibleNode('BUTTON', { type: 'button', className: 'image-viewer-next', textContent: 'Next year' });
  const panel = visibleNode('DIV', {
    id: 'photo-viewer',
    // A filename/photo-date class is only metadata; it must not turn a viewer
    // into a trusted date picker without date-control structure.
    className: 'image-date-viewer-dialog',
    textContent: '2025 年 · 9月 · 图片 9/12',
    attributes: { role: 'dialog', 'aria-label': '图片查看器' },
  });
  panel.children = [month, next];
  panel.querySelectorAll = selector => {
    const source = String(selector);
    if (/button|role="button"|prev|next|left|right/.test(source)) return [next];
    if (/role="option"|month|td|li|span|div/.test(source)) return [month];
    return [];
  };
  month.parentElement = panel;
  next.parentElement = panel;
  const trigger = visibleNode('BUTTON', {
    type: 'button',
    className: 'calendar-trigger',
    textContent: '选择入学年月',
    attributes: controlled
      ? { type: 'button', 'aria-label': '选择入学年月', 'aria-controls': panel.id }
      : { type: 'button', 'aria-label': '选择入学年月' },
  });
  const document = overlayDocument(trigger, panel, { initiallyVisible: controlled });
  return { trigger, panel, month, next, document };
}

test('Date overlay safety: fresh image viewer containing year/month is never treated as a date panel', async () => {
  const fixture = imageViewerFixture();
  const result = await DateLike.write(dateContext(fixture.trigger, fixture.panel, fixture.document));

  assert.equal(result.status, 'NEEDS_CONFIRMATION');
  assert.equal(fixture.trigger.clickCount, 1);
  assert.equal(fixture.next.clickCount, 0);
  assert.equal(fixture.month.clickCount, 0);
});

test('Date overlay safety: aria-controls cannot authorize a non-date dialog', async () => {
  const fixture = imageViewerFixture({ controlled: true });
  const result = await DateLike.write(dateContext(fixture.trigger, fixture.panel, fixture.document));

  assert.equal(result.status, 'NEEDS_CONFIRMATION');
  assert.equal(fixture.next.clickCount, 0);
  assert.equal(fixture.month.clickCount, 0);
});

test('ReadOnly native date/month: the input itself is not a reliable interactive picker trigger', () => {
  for (const baseKind of ['date', 'month']) {
    const input = visibleNode('INPUT', { type: baseKind });
    input.readOnly = true;
    input.parentElement = { querySelectorAll() { return []; }, parentElement: null };
    input.getAttribute = name => name === 'readonly' ? '' : null;

    const interaction = Detector.detectReadonlyInteraction(input, {
      baseKind,
      label: { text: baseKind === 'date' ? '出生日期' : '入学年月', semanticPlaceholder: '' },
    });

    assert.equal(interaction.interactive, false, baseKind);
    assert.equal(interaction.trigger, null, baseKind);
  }
});

test('ReadOnly native date/month: a unique local calendar button remains an eligible route', () => {
  const calendar = visibleNode('BUTTON', {
    type: 'button', className: 'calendar-trigger', textContent: '选择入学年月',
    attributes: { type: 'button', 'aria-label': '选择入学年月' },
  });
  const parent = {
    tagName: 'DIV', className: 'local-month-field', parentElement: null,
    getAttribute() { return null; }, matches() { return false; },
    querySelectorAll() { return [calendar]; },
  };
  const input = visibleNode('INPUT', { type: 'month', parentElement: parent });
  input.readOnly = true;
  input.getAttribute = name => name === 'readonly' ? '' : null;
  const interaction = Detector.detectReadonlyInteraction(input, {
    baseKind: 'month', label: { text: '入学年月', semanticPlaceholder: '' },
  });

  assert.equal(interaction.interactive, true);
  assert.equal(interaction.trigger, calendar);
  assert.equal(interaction.ambiguous, false);
});

function nativeChoice({ onclick = '', ancestor = null } = {}) {
  const attributes = new Map(onclick ? [['onclick', onclick]] : []);
  return {
    tagName: 'INPUT',
    type: 'checkbox',
    checked: false,
    disabled: false,
    hidden: false,
    isConnected: true,
    clickCount: 0,
    parentElement: ancestor,
    ownerDocument: { defaultView: {} },
    getAttribute(name) { return attributes.get(name) ?? null; },
    getRootNode() { return this.ownerDocument; },
    closest(selector) {
      if (String(selector).includes('#__jf_panel__')) return null;
      if (ancestor && /onclick|a\[href\]|button|role="link"|role="button"|formaction|label/.test(String(selector))) return ancestor;
      return null;
    },
    focus() {}, blur() {}, dispatchEvent() { return true; },
    click() { this.clickCount += 1; this.checked = !this.checked; },
  };
}

test('Choice safety: native checkbox/radio with submit or Next onclick is never clicked', async () => {
  for (const onclick of ['this.form.requestSubmit()', 'nextStep()']) {
    const checkbox = nativeChoice({ onclick });
    const result = await Events.setChecked(checkbox, true);
    assert.equal(result.ok, false, onclick);
    assert.equal(checkbox.clickCount, 0, onclick);
  }
});

test('Choice safety: native choice inside a dangerous clickable ancestor is never clicked', async () => {
  const ancestor = {
    tagName: 'LABEL', textContent: 'Continue / 下一步',
    getAttribute(name) { return name === 'onclick' ? 'nextStep()' : null; },
  };
  const checkbox = nativeChoice({ ancestor });
  const result = await Events.setChecked(checkbox, true);
  assert.equal(result.ok, false);
  assert.equal(checkbox.clickCount, 0);
});

test('Choice safety: legal declaration and authenticity acknowledgements are always user-only', async () => {
  for (const textContent of [
    '本人保证以上信息真实有效，并愿意承担相应法律责任',
    '本人郑重承诺所填材料真实、完整',
    '我同意并确认上述诚信声明',
  ]) {
    const ancestor = {
      tagName: 'LABEL',
      textContent,
      innerText: textContent,
      getAttribute() { return null; },
    };
    const checkbox = nativeChoice({ ancestor });
    const result = await Events.setChecked(checkbox, true);

    assert.equal(result.ok, false, textContent);
    assert.equal(checkbox.clickCount, 0, textContent);
    assert.equal(checkbox.checked, false, textContent);
  }
});
