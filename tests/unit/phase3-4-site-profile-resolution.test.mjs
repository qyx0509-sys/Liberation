import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Registry = require('../../src/adapters/registry.js');

function profile(profileId, {
  priority = 10,
  origins = ['https://apply.example.invalid'],
  urlPrefixes = [],
  urlPatterns = [],
  enabled = true,
} = {}) {
  return {
    schemaVersion: 2,
    id: profileId,
    revision: `${profileId}-r1`,
    enabled,
    priority,
    match: { origins, urlPrefixes, urlPatterns },
    contentRoot: `#${profileId}-root`,
  };
}

function resolutionApi() {
  assert.equal(typeof Registry.resolveProfile, 'function', 'JFAdapterRegistry.resolveProfile() 必须成为唯一确定性 Profile 选择入口');
  assert.equal(typeof Registry.resolveSiteConfig, 'function', '旧 resolveSiteConfig() 必须保留兼容');
  return Registry;
}

function selectedProfile(result) {
  return result?.profile || (result?.id ? result : null);
}

function selectedId(result) {
  return selectedProfile(result)?.id || result?.siteProfileId || result?.profileId || '';
}

test('resolveProfile 先按 priority 选择，不受数组顺序影响', () => {
  const registry = resolutionApi();
  const low = profile('priority-low', { priority: 10 });
  const high = profile('priority-high', { priority: 90 });
  const location = {
    origin: 'https://apply.example.invalid',
    href: 'https://apply.example.invalid/application/basic',
  };

  assert.equal(selectedId(registry.resolveProfile([low, high], location)), 'priority-high');
  assert.equal(selectedId(registry.resolveProfile([high, low], location)), 'priority-high');
});

test('priority 相同时按 match specificity 选择更窄、更长的 URL 范围', () => {
  const registry = resolutionApi();
  const broad = profile('specificity-broad', {
    priority: 40,
    urlPrefixes: ['https://apply.example.invalid/'],
  });
  const narrow = profile('specificity-narrow', {
    priority: 40,
    urlPrefixes: ['https://apply.example.invalid/application/graduate/'],
  });
  const location = {
    origin: 'https://apply.example.invalid',
    href: 'https://apply.example.invalid/application/graduate/basic',
  };

  const result = registry.resolveProfile([broad, narrow], location);
  assert.equal(selectedId(result), 'specificity-narrow');
  assert.ok(Number(result?.specificity ?? selectedProfile(result)?.specificity ?? 0) >= 0);
});

test('priority 与 specificity 精确并列时必须判 ambiguous 并回退 Generic，禁止 find-first', () => {
  const registry = resolutionApi();
  const left = profile('tie-left', {
    priority: 50,
    urlPrefixes: ['https://apply.example.invalid/application/'],
  });
  const right = profile('tie-right', {
    priority: 50,
    urlPrefixes: ['https://apply.example.invalid/application/'],
  });
  const location = {
    origin: 'https://apply.example.invalid',
    href: 'https://apply.example.invalid/application/basic',
  };

  for (const candidates of [[left, right], [right, left]]) {
    const result = registry.resolveProfile(candidates, location);
    assert.equal(result?.matched, false);
    assert.equal(result?.resolution, registry.RESOLUTION.AMBIGUOUS);
    assert.equal(result?.profile, null);
    assert.equal(result?.adapterId, 'generic');
    assert.equal(result?.reasonCode, registry.RESOLUTION.AMBIGUOUS);
  }
});

test('没有匹配或 profile 被禁用时确定性回退 Generic，不产生虚假 identity', () => {
  const registry = resolutionApi();
  const candidates = [
    profile('other-origin', { origins: ['https://other.example.invalid'] }),
    profile('disabled-match', { enabled: false }),
  ];
  const result = registry.resolveProfile(candidates, {
    origin: 'https://apply.example.invalid',
    href: 'https://apply.example.invalid/application/basic',
  });

  assert.equal(result?.profile, null);
  assert.equal(result?.adapterId, 'generic');
  assert.equal(result?.matched, false);
  assert.equal(result?.resolution, registry.RESOLUTION.GENERIC);
  assert.equal(result?.reasonCode, registry.RESOLUTION.GENERIC);
  assert.equal(result?.siteProfileId || result?.profileId || '', '');
  assert.equal(result?.siteProfileRevision || result?.profileRevision || '', '');
});

test('resolveProfile 每次返回隔离配置，调用方修改不能污染注册源或下一次选择', () => {
  const registry = resolutionApi();
  const source = profile('immutable-resolution', {
    priority: 60,
    urlPrefixes: ['https://apply.example.invalid/application/'],
  });
  const location = {
    origin: 'https://apply.example.invalid',
    href: 'https://apply.example.invalid/application/basic',
  };
  const first = registry.resolveProfile([source], location);
  const firstProfile = selectedProfile(first);
  assert.equal(selectedId(first), 'immutable-resolution');
  try { firstProfile.contentRoot = '#mutated'; } catch (_) { /* frozen is preferred */ }

  const second = registry.resolveProfile([source], location);
  assert.equal(selectedProfile(second).contentRoot, '#immutable-resolution-root');
  assert.equal(source.contentRoot, '#immutable-resolution-root');
});

test('resolveSiteConfig 继续接受 V1 配置，兼容现有 chrome.storage 数据', () => {
  const registry = resolutionApi();
  const legacy = {
    id: 'legacy-compatible',
    revision: 'legacy-r1',
    enabled: true,
    origin: 'https://legacy.example.invalid',
    urlPrefix: 'https://legacy.example.invalid/apply/',
    contentRoot: '#legacy-root',
  };
  const selected = registry.resolveSiteConfig([legacy], {
    origin: 'https://legacy.example.invalid',
    href: 'https://legacy.example.invalid/apply/basic',
  });

  assert.equal(selected.adapterId, 'legacy-compatible');
  assert.equal(selected.contentRoot, '#legacy-root');
});
