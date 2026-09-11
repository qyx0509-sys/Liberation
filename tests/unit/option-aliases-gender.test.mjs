import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const {
  findBestOption,
} = require('../../src/mappings/option-aliases.js');


test('性别选择必须优先依据显示文字，不能把 value=1 猜成男', () => {
  const options = [
    {
      label: '女',
      value: '1',
    },
    {
      label: '男',
      value: '2',
    },
  ];

  const result = findBestOption(
    '男',
    options,
    {
      minScore: 0.9,
      ambiguityMargin: 0.06,
    },
  );

  assert.equal(result.matched, true);
  assert.equal(result.label, '男');
  assert.equal(result.index, 1);
});


test('JSON 为女时必须选择显示文字为女的选项', () => {
  const options = [
    {
      label: '女',
      value: '1',
    },
    {
      label: '男',
      value: '2',
    },
  ];

  const result = findBestOption(
    '女',
    options,
    {
      minScore: 0.9,
      ambiguityMargin: 0.06,
    },
  );

  assert.equal(result.matched, true);
  assert.equal(result.label, '女');
  assert.equal(result.index, 0);
});


test('语义值为男时不能只依赖无文字的数字编码进行猜测', () => {
  const options = [
    {
      label: '',
      value: '1',
    },
    {
      label: '',
      value: '2',
    },
  ];

  const result = findBestOption(
    '男',
    options,
    {
      minScore: 0.9,
      ambiguityMargin: 0.06,
    },
  );

  assert.equal(result.matched, false);
});
