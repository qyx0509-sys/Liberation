import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const testDirectory = dirname(fileURLToPath(import.meta.url));
const configPath = resolve(testDirectory, '..', '..', 'config', 'site-adapters.json');

test('打包配置只提供空白 Site Profile V2 schema，运行时仍以 storage 为唯一来源', async () => {
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  assert.equal(config.schemaVersion, 2);
  assert.ok(Array.isArray(config.adapters));
  assert.deepEqual(config.adapters, []);
  assert.match(config.description, /不虚构|默认留空/);
  assert.match(config.description, /纯数据/);
  assert.match(config.description, /不能.*执行代码/);
  assert.match(config.description, /chrome\.storage\.local\.siteAdapterConfigs/);
  assert.match(config.description, /不会被自动加载/);
});
