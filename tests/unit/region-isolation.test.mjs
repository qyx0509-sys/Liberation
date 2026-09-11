import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const testDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(testDirectory, '..', '..');

const Structures = require('../../src/mappings/section-structures.js');
const Detector = require('../../src/core/embedded-section-detector.js');
const Resolver = require('../../src/core/current-section-resolver.js');
const ArrayHandler = require('../../src/core/array-handler.js');
const Engine = require('../../src/core/autofill-engine.js');

function node(text) {
  return {
    innerText: text,
    textContent: text,
    getAttribute() { return null; },
  };
}

function region(headers, actions = []) {
  const regionNode = {
    hidden: false,
    ownerDocument: {
      defaultView: {
        getComputedStyle() {
          return { display: 'block', visibility: 'visible', opacity: '1' };
        },
      },
    },
    getBoundingClientRect() { return { width: 640, height: 200 }; },
    querySelectorAll(selector) {
      if (/th|columnheader|first-child/.test(selector)) return headers.map(node);
      if (/button|input\[type="button"\]|(^|,)a(,|$)/.test(selector)) return actions.map(node);
      return [];
    },
    get innerText() { return headers.join(' '); },
    get textContent() { return headers.join(' '); },
  };
  return regionNode;
}

function documentFor(regions) {
  return {
    querySelectorAll(selector) {
      if (/table|fieldset|repeat-list|array-list/.test(selector)) return regions;
      return [];
    },
  };
}

test('嵌入栏目结构只有一个权威定义源', () => {
  for (const sectionId of ['family', 'language', 'internships', 'research', 'papers', 'awards', 'practice']) {
    const definition = Structures.definitionForSection(sectionId);
    assert.ok(definition, `${sectionId} 缺少结构定义`);
    assert.deepEqual(
      ArrayHandler.SECTION_TABLE_SIGNATURES[sectionId],
      definition.headerGroups,
      `${sectionId} 的 ArrayHandler 结构必须来自统一定义`,
    );
    assert.deepEqual(
      Detector.REGION_SIGNATURES[sectionId],
      definition.headerGroups,
      `${sectionId} 的 EmbeddedSectionDetector 结构必须来自统一定义`,
    );
    assert.ok(
      Resolver.EMBEDDED_COLLECTION_STRUCTURES.includes(definition),
      `${sectionId} 的 Resolver 结构必须引用统一定义对象`,
    );
  }
});

test('同一个 DOM 区域最多只产生一个 embedded 执行上下文', () => {
  const research = region(['开始时间', '结束时间', '名称', '指导教师', '级别', '主要贡献']);
  const awards = region(['时间', '内容', '级别', '排名（排名/团队人数，单人奖项填写1/1）']);
  const detected = Detector.detect(documentFor([research, awards]));

  assert.equal(detected.length, 2);
  assert.deepEqual(detected.map(item => item.sectionId).sort(), ['awards', 'research']);
  assert.equal(new Set(detected.map(item => item.regionId)).size, detected.length);
});

test('embedded 表格字段不会再与主栏目 field-signature 竞争', () => {
  const internshipTable = region(
    ['起始年月', '结束年月', '学习工作单位', '担任职务'],
    ['添加'],
  );
  const document = documentFor([internshipTable]);
  const descriptor = label => ({
    detectorId: label,
    visible: true,
    hidden: false,
    labelText: '',
    tableHeader: label,
    ariaLabel: '',
    placeholder: '',
    groupText: '',
    nearbyText: '',
    parentText: '',
  });

  const resolved = Resolver.resolve({
    document,
    fields: [
      descriptor('所在学校'),
      descriptor('所在院系'),
      descriptor('所在专业'),
      descriptor('在校生注册学号'),
      descriptor('担任职务'),
      descriptor('开始时间'),
      descriptor('结束时间'),
    ],
    adapterContext: { section: 'basic', score: 1 },
  });

  assert.equal(resolved.sectionId, 'education');
  assert.equal(resolved.source, 'field-signature');
  assert.ok(resolved.regionCandidates.some(item => item.collection === 'internships'));
});

test('主栏目排除根使用完整 embedded region，而不是只排除数据行', () => {
  const rootA = { contains(node) { return node === childA; } };
  const childA = {};
  const groupA = {};
  const rootB = { contains() { return false; } };
  const groupsOnly = {};

  const roots = Engine.regionExclusionRoots([
    { rootElement: rootA, groupElements: [groupA] },
    { rootElement: rootA, groupElements: [groupA] },
    { rootElement: rootB, groupElements: [] },
    { groupElements: [groupsOnly] },
  ]);

  assert.deepEqual(roots, [rootA, rootB, groupsOnly]);
  assert.equal(Engine.elementInsideAnyRoot(childA, roots), true);
  assert.equal(Engine.elementInsideAnyRoot({}, roots), false);
});

test('数组主栏目和普通主栏目都必须把 embedded region 传入 excludeRoots', async () => {
  const source = await readFile(resolve(projectRoot, 'src/core/autofill-engine.js'), 'utf8');
  const uses = source.match(/excludeRoots:\s*embeddedRegionElements/g) || [];
  assert.ok(uses.length >= 2, '数组/非数组两条主扫描路径都必须排除 embedded region');
});

test('统一结构定义在浏览器中先于 resolver/detector 注入，并进入构建必需清单', async () => {
  const [popup, build] = await Promise.all([
    readFile(resolve(projectRoot, 'popup.js'), 'utf8'),
    readFile(resolve(projectRoot, 'scripts/build.mjs'), 'utf8'),
  ]);
  const structureIndex = popup.indexOf("'src/mappings/section-structures.js'");
  const resolverIndex = popup.indexOf("'src/core/current-section-resolver.js'");
  const detectorIndex = popup.indexOf("'src/core/embedded-section-detector.js'");
  assert.ok(structureIndex >= 0);
  assert.ok(structureIndex < resolverIndex);
  assert.ok(structureIndex < detectorIndex);
  assert.match(build, /src\/mappings\/section-structures\.js/);
});
