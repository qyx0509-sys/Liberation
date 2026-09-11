import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const ADAPTER_FILES = Object.freeze([
  'src/controls/adapters/native-value-adapter.js',
  'src/controls/adapters/native-select-adapter.js',
  'src/controls/adapters/choice-adapter.js',
  'src/controls/adapters/cascader-adapter.js',
  'src/controls/adapters/custom-select-adapter.js',
  'src/controls/adapters/date-like-adapter.js',
  'src/controls/adapters/compound-picker-adapter.js',
]);

const RUNTIME_WIRING_FILES = Object.freeze([
  'popup.js',
  'tests/e2e/wizard.e2e.mjs',
  'tests/e2e/tongji-like.e2e.mjs',
  'tests/e2e/compound-ant.e2e.mjs',
]);

function source(path) {
  assert.ok(existsSync(path), `缺少 Phase 3.3 文件：${path}`);
  return readFileSync(path, 'utf8');
}

function occurrences(text, token) {
  return text.split(token).length - 1;
}

function assertOnce(text, paths, owner) {
  for (const path of paths) {
    assert.equal(occurrences(text, path), 1, `${owner} 中 ${path} 必须且只能接线一次`);
  }
}

test('所有可执行 adapter 都是独立 UMD/CommonJS 模块，并注册浏览器全局', () => {
  for (const path of ADAPTER_FILES) {
    const text = source(path);
    assert.match(text, /module\.exports/, `${path} 必须支持 CommonJS 单测`);
    assert.match(text, /globalThis|\broot\b/, `${path} 必须支持浏览器 Runtime`);
    assert.match(text, /JF[A-Za-z]+Adapter/, `${path} 必须暴露唯一的 JF*Adapter 全局`);
    assert.match(text, /\b(?:id|adapterId)\b/, `${path} 必须声明稳定 adapter id`);
    assert.match(text, /\bpriority\b/, `${path} 必须声明确定性 priority`);
    assert.match(text, /\b(?:supports|match)\b/, `${path} 缺少 supports/match contract`);
    for (const method of ['read', 'write', 'verify']) {
      assert.match(text, new RegExp(`\\b${method}\\b`), `${path} 缺少 ${method} contract`);
    }
  }
});

test('FormFiller 是薄编排层：统一委托 Registry 且保留公共 API', () => {
  const text = source('src/core/form-filler.js');
  assert.match(text, /JFControlAdapterRegistry|control-adapter-registry/, 'FormFiller 必须依赖 ControlAdapterRegistry');
  assert.match(text, /(?:\bC|controls?|ControlAdapterRegistry)\s*\.\s*execute/, '普通控件必须统一委托 Registry.execute()');
  for (const api of ['fill', 'fillMatch', 'fillMany']) {
    assert.match(text, new RegExp(`\\b${api}\\b`), `FormFiller 必须保留 ${api} API`);
  }
});

test('FormFiller 不再持有框架、overlay、月份面板或日期箭头 selector', () => {
  const text = source('src/core/form-filler.js');
  const forbiddenSelectors = /jqx-(?:listitem|dropdown|calendar)|ant-(?:select|picker)|el-(?:select|date-picker)|react-select__option|arco-(?:select|picker)|ivu-(?:select|date)|month[-_ ]?picker|monthpanel|date[-_ ]?(?:prev|next)|aria-controls/gi;
  assert.doesNotMatch(text, forbiddenSelectors, '框架/日期 selector 必须迁移出 FormFiller');
});

test('FormFiller 不再实现 native/select/choice/custom/date 执行器', () => {
  const text = source('src/core/form-filler.js');
  const forbiddenImplementations = /function\s+(?:fillNativeSelect|fillChoice|fillCheckbox|fillRadio|fillCustomSelect|tryCustomDatePicker|openDatePicker|monthPanelRoots|clickableMonthNodes)\b|const\s+CUSTOM_OPTION_SELECTOR\b/g;
  assert.doesNotMatch(text, forbiddenImplementations, 'FormFiller 只能保留明确的轻量兼容 wrapper，不能保留完整控件实现');
});

test('popup 与两套 E2E runtime 在依赖就绪后、FormFiller 前且仅一次加载 adapters', () => {
  for (const owner of RUNTIME_WIRING_FILES) {
    const text = source(owner);
    const runtimePaths = [
      'src/mappings/option-aliases.js',
      'src/mappings/date-rules.js',
      'src/core/semantic-verification.js',
      'src/core/event-dispatcher.js',
      'src/core/verification-engine.js',
      'src/controls/control-adapter-registry.js',
      ...ADAPTER_FILES,
      'src/core/form-filler.js',
    ];
    assertOnce(text, runtimePaths, owner);

    const dependencyEnd = Math.max(...[
      'src/mappings/option-aliases.js',
      'src/mappings/date-rules.js',
      'src/core/semantic-verification.js',
      'src/core/event-dispatcher.js',
      'src/core/verification-engine.js',
      'src/controls/control-adapter-registry.js',
    ].map(path => text.indexOf(path)));
    const adapterStart = Math.min(...ADAPTER_FILES.map(path => text.indexOf(path)));
    const adapterEnd = Math.max(...ADAPTER_FILES.map(path => text.indexOf(path)));
    const formIndex = text.indexOf('src/core/form-filler.js');
    assert.ok(adapterStart > dependencyEnd, `${owner} 必须在 adapter 执行依赖就绪后加载 adapter`);
    assert.ok(formIndex > adapterEnd, `${owner} 必须在所有 adapter 后加载 FormFiller`);
    const engineIndex = text.indexOf('src/core/autofill-engine.js');
    if (engineIndex >= 0) assert.ok(engineIndex > formIndex, `${owner} 必须在 FormFiller 后加载 AutofillEngine`);
  }
});

test('build 必须复制所有 adapter 源码，dist 由构建生成而非手工旁路', () => {
  const text = source('scripts/build.mjs');
  for (const path of ADAPTER_FILES) {
    assert.equal(occurrences(text, path), 1, `build requiredPaths 缺少或重复：${path}`);
  }
  assert.match(text, /requiredPaths/, 'build 应通过统一 requiredPaths 复制源码');
  assert.doesNotMatch(text, /writeFile\([^)]*dist[\\/]+src[\\/]+controls/i, '不得手工拼写 dist adapter');
});

test('依赖方向单向：adapter/registry 不得反向依赖 FormFiller 或网站 adapter', () => {
  const paths = ['src/controls/control-adapter-registry.js', ...ADAPTER_FILES];
  for (const path of paths) {
    const text = source(path);
    assert.doesNotMatch(text, /form-filler|JFFormFiller/i, `${path} 造成 controls -> FormFiller 环依赖`);
    assert.doesNotMatch(text, /src\/adapters|generic-adapter|undergraduate-awards|JFAdapterRegistry/i, `${path} 不得反向依赖网站 adapter`);
  }
});

test('控件执行层没有 hostname/platform 特判', () => {
  const paths = ['src/core/form-filler.js', 'src/controls/control-adapter-registry.js', ...ADAPTER_FILES];
  const platformBranch = /location\.(?:host|hostname)|hostname\s*\.\s*includes|(?:nju|tongji|yzbm|yzb|sustech|pku|tsinghua)\.(?:edu\.)?cn|if\s*\([^)]*(?:同济|南京大学|报名系统)/i;
  for (const path of paths) assert.doesNotMatch(source(path), platformBranch, `${path} 包含网站硬编码`);
});

test('EventDispatcher、OptionAliases、DateRules、VerificationEngine 仍是单一公共能力', () => {
  const nativeValue = source('src/controls/adapters/native-value-adapter.js');
  const nativeSelect = source('src/controls/adapters/native-select-adapter.js');
  const choice = source('src/controls/adapters/choice-adapter.js');
  const custom = source('src/controls/adapters/custom-select-adapter.js');
  const date = source('src/controls/adapters/date-like-adapter.js');
  const all = [nativeValue, nativeSelect, choice, custom, date].join('\n');

  assert.match(nativeValue, /setNativeValue/, 'native value 必须复用 EventDispatcher.setNativeValue');
  assert.match(nativeSelect, /setNativeSelect/, 'native select 必须复用 EventDispatcher.setNativeSelect');
  assert.match(choice, /setChecked|clickLikeUser/, 'choice 必须复用安全事件入口');
  assert.match(custom, /JFOptionAliases|option-aliases|canonical/i, 'custom select 必须复用 OptionAliases');
  assert.match(date, /JFDateRules|date-rules/, 'date adapter 必须复用 DateRules');
  assert.match(all, /JFVerificationEngine|verification-engine/, 'adapter 层必须复用 VerificationEngine');
  assert.doesNotMatch(custom, /\.click\s*\(/, 'custom select 禁止绕过 EventDispatcher 原始 click');
  assert.doesNotMatch(date, /\.click\s*\(/, 'date picker 禁止绕过 EventDispatcher 原始 click');
});

test('Boolean semantic 只有一个真源，旧 router 只能删除或成为兼容转发', () => {
  const routerPath = 'src/controls/boolean-runtime-router.js';
  if (!existsSync(routerPath)) return;
  const text = source(routerPath);
  assert.match(text, /JFBooleanSemanticAdapter|boolean-semantic-adapter/, '保留旧 router 时必须转发到 BooleanSemanticAdapter');
  assert.doesNotMatch(text, /TRUE_(?:TOKENS|VALUES)|FALSE_(?:TOKENS|VALUES)|function\s+(?:canonicalizeBoolean|normalizeBoolean)\b/, '旧 router 不得保留第二套 Boolean 词典/实现');
});

test('性能守卫：native adapter 不扫描 document，框架 option 扫描只属于 custom/date adapter', () => {
  const nativeSources = [
    source('src/controls/adapters/native-value-adapter.js'),
    source('src/controls/adapters/native-select-adapter.js'),
  ].join('\n');
  assert.doesNotMatch(nativeSources, /\bdocument\s*\.|document\?\.|querySelectorAll\s*\(/, 'native adapter 不得进行全页/option overlay 扫描');
  assert.doesNotMatch(nativeSources, /jqx-|ant-select|el-select|react-select|arco-select|ivu-select/i, '框架 selector 只能存在于 custom/date adapter');
  const choice = source('src/controls/adapters/choice-adapter.js');
  assert.doesNotMatch(choice, /\bdocument\s*\.\s*querySelectorAll|ownerDocument\s*\.\s*querySelectorAll/, 'choice adapter 不得退化为全页扫描');
});
