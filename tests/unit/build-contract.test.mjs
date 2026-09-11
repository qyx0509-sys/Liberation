import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const testDirectory = dirname(fileURLToPath(import.meta.url));
const root = resolve(testDirectory, '..', '..');
const packageJson = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
const buildScript = await readFile(resolve(root, 'scripts', 'build.mjs'), 'utf8');

test('测试与构建脚本不依赖第三方包或安装阶段', () => {
  assert.equal(packageJson.private, true);
  assert.deepEqual(packageJson.dependencies, undefined);
  assert.deepEqual(packageJson.devDependencies, undefined);
  assert.match(packageJson.scripts.test, /node/);
  assert.match(packageJson.scripts.build, /node scripts\/build\.mjs/);
  assert.doesNotMatch(JSON.stringify(packageJson.scripts), /install|npx|curl|wget/i);
  assert.match(packageJson.engines.node, />=22/);
});

test('构建仅写入项目内 dist 并保留许可证', () => {
  assert.match(buildScript, /resolve\(projectRoot, 'dist'\)/);
  assert.match(buildScript, /dirname\(outputDirectory\) !== projectRoot/);
  assert.match(buildScript, /'LICENSE'/);
  assert.match(buildScript, /'src\/adapters\/generic\.js'/);
  assert.match(buildScript, /'src\/adapters\/generic-adapter\.js'/);
  assert.match(buildScript, /'src\/adapters\/undergraduate-awards\.js'/);
  assert.match(buildScript, /'src\/content-app\.js'/);
  assert.match(buildScript, /'src\/content-controller\.js'/);
  assert.match(buildScript, /'src\/core\/autofill-engine\.js'/);
  assert.match(buildScript, /'src\/floating-ui\/floating-panel\.js'/);
  assert.match(buildScript, /'src\/storage\/material-library\.js'/);
  assert.match(buildScript, /'config\/site-adapters\.json'/);
  assert.match(buildScript, /assertManifestResourcesExist/);
  assert.match(buildScript, /manifest\.manifest_version !== 3/);
});
