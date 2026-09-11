import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const testDirectory = dirname(fileURLToPath(import.meta.url));
const root = resolve(testDirectory, '..', '..');
const [popupSource, controllerSource, buildSource, floatingPanelSource] = await Promise.all([
  readFile(resolve(root, 'popup.js'), 'utf8'),
  readFile(resolve(root, 'src', 'content-controller.js'), 'utf8'),
  readFile(resolve(root, 'scripts', 'build.mjs'), 'utf8'),
  readFile(resolve(root, 'src', 'floating-ui', 'floating-panel.js'), 'utf8'),
]);

function declarationArray(source, name) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = source.match(new RegExp(
    `const\\s+${escapedName}\\s*=\\s*(?:Object\\.freeze\\s*\\()?\\s*\\[([\\s\\S]*?)\\]\\s*\\)?\\s*;`,
  ));
  assert.ok(match, `没有找到数组声明 ${name}`);
  return [...match[1].matchAll(/'([^']+)'|"([^"]+)"/g)].map(item => item[1] || item[2]);
}

function functionBlock(source, name, nextMarker) {
  const start = source.indexOf(`function ${name}`);
  assert.ok(start >= 0, `没有找到函数 ${name}`);
  const end = source.indexOf(nextMarker, start);
  assert.ok(end > start, `无法确定函数 ${name} 的结束位置`);
  return source.slice(start, end);
}

test('popup 注入顺序在 AutofillEngine 之前加载 CurrentSectionResolver', () => {
  const files = declarationArray(popupSource, 'INJECTION_FILES');
  const resolverIndex = files.indexOf('src/core/current-section-resolver.js');
  const engineIndex = files.indexOf('src/core/autofill-engine.js');

  assert.ok(resolverIndex >= 0, '注入清单缺少 CurrentSectionResolver');
  assert.ok(engineIndex >= 0, '注入清单缺少 AutofillEngine');
  assert.ok(resolverIndex < engineIndex, 'CurrentSectionResolver 必须先于 AutofillEngine 注入');
  assert.equal(files.filter(file => file === 'src/core/current-section-resolver.js').length, 1);
});

test('content-controller 启动前强制校验 Resolver、PageReady 与 ArrayHandler', () => {
  const globals = declarationArray(controllerSource, 'REQUIRED_GLOBALS');
  for (const required of ['JFCurrentSectionResolver', 'JFPageReady', 'JFArrayHandler']) {
    assert.ok(globals.includes(required), `REQUIRED_GLOBALS 缺少 ${required}`);
  }
  assert.match(controllerSource, /REQUIRED_GLOBALS\.filter\(name\s*=>\s*!root\[name\]\)/);
});

test('构建 requiredPaths 将 CurrentSectionResolver 作为必需产物复制', () => {
  const requiredPaths = declarationArray(buildSource, 'requiredPaths');
  assert.ok(requiredPaths.includes('src/core/current-section-resolver.js'));
  assert.ok(requiredPaths.includes('src/core/autofill-engine.js'));
  assert.equal(requiredPaths.filter(file => file === 'src/core/current-section-resolver.js').length, 1);
  assert.match(buildSource, /for\s*\(const relativePath of requiredPaths\)/);
  assert.match(buildSource, /await assertExists\(source, relativePath\)/);
});

test('悬浮面板识别 FILLED/PARTIAL/NO_CHANGES 三种栏目终态', () => {
  const updateBlock = functionBlock(floatingPanelSource, 'update', 'function show()');
  for (const status of ['FILLED', 'PARTIAL', 'NO_CHANGES']) {
    assert.match(updateBlock, new RegExp(`['"]${status}['"]`), `update() 未处理 ${status}`);
  }
  assert.match(updateBlock, /SUCCESS\|COMPLETED\|FILLED/);
  assert.match(updateBlock, /PARTIAL\|NEEDS_CONFIRMATION\|REVIEW/);
  assert.match(updateBlock, /NO_CHANGES\|SKIPPED/);
});

test('悬浮报告拒绝无 scanId/旧 scanId 报告，且 0 成功标题绝不是“填写完成”', () => {
  const reportBlock = functionBlock(floatingPanelSource, 'showReport', 'singleton =');
  assert.match(
    reportBlock,
    /if\s*\(\s*!report\.scanId\s*\|\|\s*\(\s*currentScanId\s*&&\s*report\.scanId\s*!==\s*currentScanId\s*\)\s*\)/,
  );
  assert.match(reportBlock, /已阻止显示不属于当前扫描的旧填写报告/);
  assert.match(
    reportBlock,
    /success\s*===\s*0\s*\?\s*\(\s*failed\s*\?\s*'填写未成功'\s*:\s*'流程执行结束，但没有填写任何字段'\s*\)\s*:\s*issues\s*\?\s*'部分填写完成'\s*:\s*'填写完成'/,
  );
  assert.doesNotMatch(reportBlock, /success\s*===\s*0\s*\?\s*['"]填写完成['"]/);
});
