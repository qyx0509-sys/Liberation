import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const testDirectory = dirname(fileURLToPath(import.meta.url));
const generic = require(resolve(testDirectory, '..', '..', 'src', 'adapters', 'generic.js'));

test('通用适配器将 null/undefined 归一为空字符串', () => {
  assert.equal(generic.safeString(null), '');
  assert.equal(generic.safeString(undefined), '');
  assert.equal(generic.safeString('  青岛  '), '青岛');
});

test('通用适配器识别奖励三列常见中文标签', () => {
  assert.deepEqual(generic.inferField('获奖时间'), { field: 'time', confidence: 1 });
  assert.deepEqual(generic.inferField('奖励地点'), { field: 'location', confidence: 1 });
  assert.deepEqual(generic.inferField('奖项名称'), { field: 'content', confidence: 1 });
  assert.deepEqual(generic.inferField('手机号'), { field: null, confidence: 0 });
});

test('诊断 URL 去除 fragment、敏感参数名，并脱敏普通查询值', () => {
  const result = generic.sanitizeUrl('https://apply.example.edu/form?token=secret&id=123#step-2');
  const parsed = new URL(result);
  assert.equal(parsed.hash, '');
  assert.equal(parsed.searchParams.has('token'), false);
  assert.equal(parsed.searchParams.get('id'), '<redacted>');
  assert.doesNotMatch(result, /token|secret|123|step-2/i);
});

test('诊断 HTML 转义不允许字段元数据注入标记', () => {
  assert.equal(generic.escapeHtml('<img src=x onerror="boom">'), '&lt;img src=x onerror=&quot;boom&quot;&gt;');
});
