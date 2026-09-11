import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const testDirectory = dirname(fileURLToPath(import.meta.url));
const root = resolve(testDirectory, '..', '..');
const samplePaths = [
  'resume-data.example.json',
  'samples/sample-resume.json',
  'samples/sample-awards.json',
  'tests/fixtures/awards-profile.json',
];

for (const relativePath of samplePaths) {
  test(`${relativePath} 使用合法的独立 awards 数组`, async () => {
    const text = await readFile(resolve(root, relativePath), 'utf8');
    const profile = JSON.parse(text);
    assert.ok(Array.isArray(profile.awards), 'awards 必须是顶级数组');
    assert.ok(profile.awards.length > 0, '示例至少包含一条奖励');
    for (const [index, award] of profile.awards.entries()) {
      assert.equal(typeof award, 'object', `awards[${index}] 必须是对象`);
      assert.equal(typeof award.time, 'string');
      assert.equal(typeof award.location, 'string');
      assert.equal(typeof award.content, 'string');
      assert.match(award.time, /^\d{4}-(?:[1-9]|1[0-2]|0[1-9])$/, `awards[${index}].time 日期格式错误`);
      assert.ok(award.content.trim(), `awards[${index}].content 不得为空`);
      assert.notEqual(award.location, 'undefined');
      assert.notEqual(award.location, 'null');
    }
    if (profile.personal) {
      for (const sensitiveKey of ['phone', 'id_number', 'address', 'wechat', 'qq']) {
        assert.equal(String(profile.personal[sensitiveKey] || ''), '', `${relativePath} 的 ${sensitiveKey} 示例必须留空`);
      }
    }
    assert.doesNotMatch(text, /\b1[3-9]\d{9}\b|\b\d{17}[0-9xX]\b/);
  });
}

test('Markdown 示例不包含完整手机号、身份证号或详细地址值', async () => {
  const text = await readFile(resolve(root, 'samples', 'sample-resume.md'), 'utf8');
  assert.doesNotMatch(text, /\b1[3-9]\d{9}\b|\b\d{17}[0-9xX]\b/);
  assert.doesNotMatch(text, /(?:手机|身份证号|详细地址)[：:]\s*(?!（示例留空）)\S+/);
});
