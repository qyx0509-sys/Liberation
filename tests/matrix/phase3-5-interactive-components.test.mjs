import test from 'node:test';
import assert from 'node:assert/strict';

import { validateMatrixCatalog } from './matrix-contract.mjs';
import { MATRIX_CASES } from './matrix-cases.mjs';

const REQUIRED_PAGE_CASES = [
  'ant-vue-compound',
  'jqx-compound',
  'native-html-form',
  'modern-ant-design',
  'element-plus',
  'aria-generic',
  'react-select',
  'wizard-step-application',
];

const REQUIRED_CONTROL_FAMILIES = [
  'native-value',
  'native-select',
  'radio',
  'checkbox',
  'jqx',
  'aria-select',
  'ant-select',
  'element-select',
  'element-date-picker',
  'element-cascader',
  'react-select',
  'legacy-ant-date-picker',
  'modern-ant-date-picker',
  'native-date-month',
  'cascader',
  'compound-picker',
  'file-field',
];

test('Interactive matrix: declares the eight cross-platform page structures', () => {
  assert.deepEqual(MATRIX_CASES.map(item => item.id), REQUIRED_PAGE_CASES);
  assert.ok(MATRIX_CASES.every(item => item.fixture.kind === 'sanitized-structural-equivalent'));
  assert.deepEqual(
    MATRIX_CASES.filter(item => item.fixture.availability === 'EXISTING_BROWSER_FIXTURE').map(item => item.id),
    REQUIRED_PAGE_CASES,
  );
  assert.equal(
    MATRIX_CASES.filter(item => item.fixture.availability === 'REQUIRES_BROWSER_FIXTURE').length,
    0,
  );
});

test('Interactive matrix: covers at least twelve families, including all required adapters', () => {
  const coverage = validateMatrixCatalog(MATRIX_CASES);

  assert.ok(coverage.controlFamilyCount >= 12);
  for (const family of REQUIRED_CONTROL_FAMILIES) {
    assert.ok(coverage.controlFamilies.includes(family), `missing control family: ${family}`);
  }
});

test('Interactive matrix: date and cascader transitions are explicit capabilities, not generic click success', () => {
  const capabilities = MATRIX_CASES.flatMap(item => item.capabilities);

  assert.ok(capabilities.some(item => item.id === 'legacy-ant-day-to-month-transition'));
  assert.ok(capabilities.some(item => item.id === 'legacy-ant-same-root-panel-transition'));
  assert.ok(capabilities.some(item => item.id === 'cascader-same-overlay-column-append'));
  assert.ok(capabilities.some(item => item.id === 'cascader-level-owner-refresh'));
});

test('Interactive matrix: JQX and native controls remain first-class regression dimensions', () => {
  const jqx = MATRIX_CASES.find(item => item.id === 'jqx-compound');
  const native = MATRIX_CASES.find(item => item.id === 'native-html-form');

  assert.ok(jqx.controls.includes('jqx'));
  assert.ok(jqx.repeatables.some(item => item.id === 'jqx-zero-row-recovery'));
  assert.ok(['native-value', 'native-select', 'radio', 'checkbox', 'native-date-month']
    .every(family => native.controls.includes(family)));
});
