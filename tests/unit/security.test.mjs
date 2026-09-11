import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const testDirectory = dirname(fileURLToPath(import.meta.url));
const root = resolve(testDirectory, '..', '..');
const optionsSource = await readFile(resolve(root, 'options.js'), 'utf8');
const cutoff = optionsSource.indexOf('// 导入统一入口');
assert.ok(cutoff > 0, '无法定位 options.js 的纯函数测试边界');

const context = vm.createContext({});
vm.runInContext(`${optionsSource.slice(0, cutoff)}
globalThis.__security = {
  IMPORT_SECURITY_LIMITS,
  escHtml,
  validateImportPayload,
  mergeResumeData,
  eduTemplate,
  internTemplate,
  projTemplate,
  langTemplate,
  paperTemplate,
};`, context, { filename: 'options-security-functions.js' });

const security = context.__security;
function parseInContext(json) {
  context.__jsonInput = json;
  return vm.runInContext('JSON.parse(__jsonInput)', context);
}

test('JSON 导入仅接受允许的顶层字段和对应容器类型', () => {
  const valid = parseInContext(JSON.stringify({
    profileName: '默认申请资料',
    personal: { name: '示例用户' },
    awards: [{ time: '2025-7', location: '', content: '示例奖项' }],
  }));
  assert.equal(security.validateImportPayload(valid), valid);

  assert.throws(
    () => security.validateImportPayload(parseInContext('{"unexpected":"value"}')),
    /不支持的顶层字段/,
  );
  assert.throws(
    () => security.validateImportPayload(parseInContext('{"awards":{}}')),
    /awards 必须是数组/,
  );
  assert.throws(
    () => security.validateImportPayload(parseInContext('{"education":["不是对象"]}')),
    /education\[0\] 必须是 JSON 对象/,
  );
});

test('JSON 导入拒绝任意层级的原型污染字段', () => {
  for (const key of ['__proto__', 'constructor', 'prototype']) {
    const payload = parseInContext(`{"personal":{"${key}":{"polluted":"yes"}}}`);
    assert.throws(() => security.validateImportPayload(payload), /禁止字段/);
    assert.throws(() => security.mergeResumeData(parseInContext('{}'), payload), /禁止字段/);
  }
  assert.equal({}.polluted, undefined);
  assert.equal(vm.runInContext('({}).polluted', context), undefined);
});

test('JSON 导入限制数组、字符串、深度和总体节点数', () => {
  const { maxArrayItems, maxStringLength, maxDepth, maxNodes } = security.IMPORT_SECURITY_LIMITS;
  const tooManyAwards = Array.from({ length: maxArrayItems + 1 }, () => ({}));
  assert.throws(
    () => security.validateImportPayload(parseInContext(JSON.stringify({ awards: tooManyAwards }))),
    /超过 .* 条记录/,
  );
  assert.throws(
    () => security.validateImportPayload(parseInContext(JSON.stringify({ intro: 'x'.repeat(maxStringLength + 1) }))),
    /超过 .* 个字符/,
  );

  let nested = 'value';
  for (let index = 0; index < maxDepth + 1; index += 1) nested = { child: nested };
  assert.throws(
    () => security.validateImportPayload(parseInContext(JSON.stringify({ personal: nested }))),
    /嵌套超过/,
  );

  const manyNodes = { personal: {} };
  for (let index = 0; index < Math.min(maxNodes, 100); index += 1) {
    manyNodes.personal[`field${index}`] = Array.from({ length: 100 }, () => 'x');
  }
  assert.throws(
    () => security.validateImportPayload(parseInContext(JSON.stringify(manyNodes))),
    /节点数超过/,
  );
});

test('mergeResumeData 保留原合并语义且不会复制危险键', () => {
  const oldData = parseInContext('{"personal":{"name":"旧姓名","email":"old@example.invalid"},"awards":[{"content":"旧奖项"}]}');
  const newData = parseInContext('{"personal":{"name":"新姓名","email":""},"awards":[{"content":"新奖项"}]}');
  const merged = security.mergeResumeData(oldData, newData);
  assert.equal(merged.personal.name, '新姓名');
  assert.equal(merged.personal.email, 'old@example.invalid');
  assert.equal(merged.awards[0].content, '新奖项');
  assert.equal(Object.prototype.hasOwnProperty.call(merged, '__proto__'), false);
});

test('旧资料模板统一转义属性和文本插值', () => {
  const malicious = `"><img src=x onerror=alert(1)>&'</textarea><script>alert(2)</script>`;
  const cases = [
    [security.eduTemplate, { school: malicious, thesis: malicious }],
    [security.internTemplate, { company: malicious, desc: malicious }],
    [security.projTemplate, { name: malicious, desc: malicious }],
    [security.langTemplate, { language: malicious }],
    [security.paperTemplate, { title: malicious, url: malicious }],
  ];
  for (const [template, input] of cases) {
    const html = template(parseInContext(JSON.stringify(input)));
    assert.doesNotMatch(html, /<img|<script|<\/textarea><script/i);
    assert.match(html, /&quot;|&lt;/);
  }
  assert.equal(security.escHtml(`&<>"'`), '&amp;&lt;&gt;&quot;&#39;');
  assert.match(optionsSource, /escHtml\(labelFn\(item, i\)\)/);
});

test('options.js 不再把简历正文、字段值或解析响应写入控制台', () => {
  assert.doesNotMatch(optionsSource, /console\.(?:log|warn|error)\s*\(/);
  assert.match(optionsSource, /maxJsonFileBytes/);
});
