import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const Controls = require('../../src/controls/control-adapter-registry.js');

function executableApi() {
  assert.equal(typeof Controls.register, 'function', 'Registry 必须支持 register(adapter)');
  assert.equal(typeof Controls.resolve, 'function', '旧 resolve() API 必须保留');
  assert.equal(typeof Controls.execute, 'function', 'Registry 必须成为统一 execute() 入口');
  return Controls;
}

function element(overrides = {}) {
  return {
    tagName: 'INPUT',
    type: 'text',
    value: '',
    className: '',
    isConnected: true,
    hidden: false,
    disabled: false,
    readOnly: false,
    getAttribute() { return null; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    closest() { return null; },
    ...overrides,
  };
}

function descriptor(marker = '', overrides = {}) {
  const node = overrides.element || element();
  return {
    detectorId: `contract_${marker || 'field'}`,
    marker,
    element: node,
    interactionElement: node,
    controlKind: 'text',
    type: 'text',
    baseControlKind: 'text',
    visible: true,
    hidden: false,
    disabled: false,
    readOnly: false,
    sensitive: false,
    parent: { classes: [] },
    ...overrides,
  };
}

function register(adapter) {
  const registry = executableApi();
  const registered = registry.register(adapter);
  assert.notEqual(registered, false, `${adapter.id} 注册失败`);
  return registered;
}

test('Executable Registry 暴露 register / resolve / execute，旧分类 API 不丢失', () => {
  const registry = executableApi();
  assert.equal(typeof registry.detectFramework, 'function');
  assert.ok(registry.CAPABILITIES);
});

test('resolve 向后兼容 adapterId/framework/capabilities/fieldPath，并增加 executable adapter', () => {
  const resolved = executableApi().resolve(descriptor('legacy'), {
    fieldPath: 'basic.name',
  });

  assert.equal(resolved.adapterId, 'native-value');
  assert.equal(resolved.framework, 'generic');
  assert.equal(resolved.fieldPath, 'basic.name');
  assert.equal(Array.isArray(resolved.capabilities), true);
  assert.ok(resolved.adapter && typeof resolved.adapter === 'object');
  assert.equal(typeof resolved.adapter.write, 'function');
  assert.equal(typeof resolved.adapter.read, 'function');
  assert.equal(typeof resolved.adapter.verify, 'function');
});

test('register 校验真正可执行 Adapter contract，拒绝只有 id 的分类器', () => {
  const registry = executableApi();
  assert.throws(
    () => registry.register({ id: 'invalid_classifier_only' }),
    /supports|match|write|execute|adapter/i,
  );
});

test('priority 决定 Adapter，不能由对象/注册迭代顺序决定', () => {
  const marker = 'priority_contract';
  const low = {
    id: 'contract-low-priority', priority: 10, capabilities: ['write-value'],
    supports: context => context.descriptor.marker === marker,
    read: context => context.descriptor.element.value,
    async write() { return { handled: true, ok: true, status: 'SUCCESS', strategy: 'low' }; },
    verify() { return { ok: true, status: 'SUCCESS' }; },
  };
  const high = {
    id: 'contract-high-priority', priority: 900, capabilities: ['write-value'],
    supports: context => context.descriptor.marker === marker,
    read: context => context.descriptor.element.value,
    async write() { return { handled: true, ok: true, status: 'SUCCESS', strategy: 'high' }; },
    verify() { return { ok: true, status: 'SUCCESS' }; },
  };
  // 故意先注册低优先级，确保选择不是“第一个注册者”。
  register(low);
  register(high);

  const resolved = Controls.resolve(descriptor(marker));
  assert.equal(resolved.adapterId, high.id);
  assert.equal(resolved.adapter, high);
});

test('同一 descriptor 重复 resolve 结果确定且稳定', () => {
  const marker = 'stable_contract';
  const adapter = {
    id: 'contract-stable', priority: 850, capabilities: ['write-value'],
    supports: context => context.descriptor.marker === marker,
    read: context => context.descriptor.element.value,
    async write() { return { handled: true, ok: true, status: 'SUCCESS', strategy: 'stable' }; },
    verify() { return { ok: true, status: 'SUCCESS' }; },
  };
  register(adapter);
  const field = descriptor(marker);
  const ids = Array.from({ length: 20 }, () => Controls.resolve(field).adapterId);

  assert.deepEqual(new Set(ids), new Set([adapter.id]));
});

test('execute 传入统一 context 并真正执行 write/read/verify', async () => {
  const marker = 'execute_contract';
  const seen = [];
  const adapter = {
    id: 'contract-executable', priority: 1000, capabilities: ['write-value', 'verify'],
    supports(context) { seen.push(['supports', context]); return context.descriptor.marker === marker; },
    read(context) { seen.push(['read', context]); return context.descriptor.element.value; },
    async write(context) {
      seen.push(['write', context]);
      context.descriptor.element.value = String(context.value);
      return { handled: true, ok: true, status: 'SUCCESS', actualValue: String(context.value), strategy: 'contract-write' };
    },
    verify(context) {
      seen.push(['verify', context]);
      return { ok: context.descriptor.element.value === String(context.value), status: 'SUCCESS' };
    },
  };
  register(adapter);
  const field = descriptor(marker);
  const result = await Controls.execute(field, '新值', {
    fieldPath: 'basic.name', expectedType: 'text', dependencies: { probe: true },
  });

  assert.equal(field.element.value, '新值');
  assert.equal(result.handled, true);
  assert.equal(result.ok, true);
  assert.equal(result.status, 'SUCCESS');
  assert.equal(result.adapterId, adapter.id);
  assert.equal(result.framework, 'generic');
  assert.equal(result.strategy, 'contract-write');
  const writeContext = seen.find(([phase]) => phase === 'write')?.[1];
  assert.equal(writeContext.descriptor, field);
  assert.equal(writeContext.value, '新值');
  assert.equal(writeContext.fieldPath, 'basic.name');
  assert.equal(writeContext.expectedType, 'text');
  assert.equal(writeContext.framework, 'generic');
  assert.equal(writeContext.settings.fieldPath, 'basic.name');
  assert.equal(writeContext.dependencies.probe, true);
  assert.equal(seen.some(([phase]) => phase === 'verify'), true);
});

test('execute 将 Adapter 差异归一成稳定 Execution Result', async () => {
  const marker = 'normalized_result_contract';
  register({
    id: 'contract-normalized-result', priority: 1001, capabilities: ['write-value'],
    supports: context => context.descriptor.marker === marker,
    read: () => '',
    async write() { return { ok: false, reason: '证据不足' }; },
    verify() { return { ok: false, status: 'NEEDS_CONFIRMATION' }; },
  });

  const result = await Controls.execute(descriptor(marker), '目标', { fieldPath: 'basic.name' });
  for (const key of ['handled', 'ok', 'status', 'reason', 'adapterId', 'framework', 'strategy', 'actualValue']) {
    assert.equal(Object.hasOwn(result, key), true, key);
  }
  assert.equal(result.status, 'NEEDS_CONFIRMATION');
});

test('Adapter 声明 handled=false 时验证成功也不能被归一成 SUCCESS', async () => {
  const marker = 'unhandled_result_contract';
  let verifyCalls = 0;
  register({
    id: 'contract-unhandled-result', priority: 1002, capabilities: ['write-value'],
    supports: context => context.descriptor.marker === marker,
    read: context => context.descriptor.element.value,
    async write() { return { handled: false, ok: true, status: 'NEEDS_CONFIRMATION', reason: '需要站点能力' }; },
    verify() { verifyCalls += 1; return { ok: true, status: 'SUCCESS' }; },
  });

  const result = await Controls.execute(descriptor(marker), '目标', { fieldPath: 'basic.name' });
  assert.equal(result.handled, false);
  assert.equal(result.ok, false);
  assert.equal(result.status, 'NEEDS_CONFIRMATION');
  assert.equal(verifyCalls, 0, 'Adapter 明确未处理时不得继续验证或改写状态');
});

test('Adapter 的 NEEDS_CONFIRMATION 状态不能被 ok=true 验证结果提升为 SUCCESS', async () => {
  const marker = 'contradictory_status_contract';
  register({
    id: 'contract-contradictory-status', priority: 1003, capabilities: ['write-value'],
    supports: context => context.descriptor.marker === marker,
    read: context => context.descriptor.element.value,
    async write() { return { handled: true, ok: true, status: 'NEEDS_CONFIRMATION', reason: '写入证据不足' }; },
    verify() { return { ok: true, status: 'SUCCESS' }; },
  });

  const result = await Controls.execute(descriptor(marker), '目标', { fieldPath: 'basic.name' });
  assert.equal(result.ok, false);
  assert.equal(result.status, 'NEEDS_CONFIRMATION');
});

test('未知或危险控件 fail-closed：不写 submit/file/password，也不触发 click', async () => {
  for (const type of ['submit', 'file', 'password', 'reset', 'image']) {
    let clicks = 0;
    const node = element({
      tagName: type === 'submit' ? 'BUTTON' : 'INPUT',
      type,
      value: '原值',
      click() { clicks += 1; },
    });
    const field = descriptor(`danger_${type}`, {
      element: node,
      interactionElement: node,
      controlKind: 'unknown-control',
      type: 'unknown-control',
    });
    const result = await executableApi().execute(field, '禁止写入', { fieldPath: 'basic.name' });
    assert.notEqual(result.status, 'SUCCESS', type);
    assert.equal(node.value, '原值', type);
    assert.equal(clicks, 0, type);
  }
});

test('未知但表面安全的控件也必须 fail-closed，不能静默降级为 native value', async () => {
  const node = element({ type: 'text', value: '原值' });
  const field = descriptor('unknown_safe', {
    element: node,
    interactionElement: node,
    controlKind: 'unknown-control',
    type: 'unknown-control',
    baseControlKind: 'unknown-control',
  });
  const result = await executableApi().execute(field, '禁止猜测', { fieldPath: 'basic.name' });
  assert.equal(result.status, 'NEEDS_CONFIRMATION');
  assert.equal(result.handled, false);
  assert.equal(node.value, '原值');
});

test('Control Registry/Adapter Runtime 维持 CommonJS + Browser global 双环境契约', () => {
  const registrySource = readFileSync(new URL('../../src/controls/control-adapter-registry.js', import.meta.url), 'utf8');
  assert.match(registrySource, /module\.exports/);
  assert.match(registrySource, /JFControlAdapterRegistry/);
  assert.doesNotMatch(registrySource, /hostname|location\.host|\bnju\b|\btongji\b/i);
});
