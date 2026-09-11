import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { MATRIX_CASES } from './matrix-cases.mjs';

const REQUIRED_COMPLETION_CAPABILITIES = Object.freeze([
  'legacy-ant-same-overlay',
  'legacy-ant-node-replace',
  'same-overlay-menu-append',
  'multiple-identical-add-buttons',
  'singleton-array-binding',
  'education-schema-coverage',
  'author-rank',
  'late-stable-field-scan',
  'ant-inline-singleton-nested-grid',
  'zero-row-sibling-add-after-fallback-root',
  'annotated-field-label-normalization',
  'late-stable-scan-final-count',
  'legacy-ant-anchor-mode-switch-safety',
  'four-cascader-same-overlay-append',
]);

function capabilityMap() {
  return new Map(MATRIX_CASES
    .flatMap(caseDefinition => caseDefinition.capabilities
      .map(capability => [capability.id, { caseId: caseDefinition.id, ...capability }])));
}

test('Completion Matrix: declares every required closure dimension with a stable capability id', () => {
  const capabilities = capabilityMap();
  for (const id of REQUIRED_COMPLETION_CAPABILITIES) {
    assert.ok(capabilities.has(id), `missing Phase 3.5 completion capability: ${id}`);
  }
});

test('Completion Matrix: every closure dimension declares executable unit evidence and an honest browser tier', () => {
  const capabilities = capabilityMap();
  for (const id of REQUIRED_COMPLETION_CAPABILITIES) {
    assert.equal(capabilities.get(id)?.caseId, 'ant-vue-compound', id);
    assert.equal(capabilities.get(id)?.expectedClassification, 'SUPPORTED', id);
    assert.equal(capabilities.get(id)?.evidenceLevel, 'UNIT_RUNTIME', id);
    assert.ok(capabilities.get(id)?.unitFiles?.length > 0, id);
    assert.ok(['FULL', 'PARTIAL', 'NONE'].includes(capabilities.get(id)?.browserEvidence), id);
  }
  assert.equal(capabilities.get('legacy-ant-same-overlay')?.browserEvidence, 'FULL');
  assert.equal(capabilities.get('legacy-ant-node-replace')?.browserEvidence, 'PARTIAL');
  assert.equal(capabilities.get('late-stable-field-scan')?.browserEvidence, 'NONE');
});

test('Completion Matrix: mapped runtime evidence executes instead of relying on catalog-generated PASS', {
  timeout: 30_000,
}, () => {
  const capabilities = capabilityMap();
  const unitFiles = [...new Set(REQUIRED_COMPLETION_CAPABILITIES
    .flatMap(id => capabilities.get(id)?.unitFiles || []))];
  assert.ok(unitFiles.length >= 5);
  unitFiles.forEach(file => assert.equal(existsSync(resolve(file)), true, file));

  const result = spawnSync(process.execPath, ['--test', ...unitFiles], {
    cwd: resolve('.'),
    encoding: 'utf8',
    env: Object.fromEntries(Object.entries(process.env)
      .filter(([key]) => key !== 'NODE_TEST_CONTEXT')),
    maxBuffer: 8 * 1024 * 1024,
    timeout: 25_000,
  });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /(?:#|\u2139)\s*fail\s+0\b/);
});

test('Completion Matrix: Singleton/Education/authorRank retain their canonical paths', () => {
  const compound = MATRIX_CASES.find(item => item.id === 'ant-vue-compound');
  const paths = new Set(compound?.expectedPaths || []);
  for (const path of [
    'language[].language',
    'language[].score',
    'education[].school',
    'education[].majorRank',
    'education[].majorRankTotal',
    'education[].gpa',
    'papers[].authorRank',
  ]) {
    assert.ok(paths.has(path), `missing completion canonical path: ${path}`);
  }
});

test('Completion Matrix: correct fail-closed outcomes remain explicit rather than counted as product failures', () => {
  const capabilities = capabilityMap();
  assert.equal(
    capabilities.get('language-singleton-multiple-candidates')?.expectedClassification,
    'NEEDS_CONFIRMATION',
  );
  assert.equal(
    capabilities.get('language-singleton-multiple-candidates')?.expectedReasonCode,
    'NO_DISCRIMINATOR',
  );
  assert.equal(
    capabilities.get('papers-status-published-vs-submitted-accepted')?.expectedClassification,
    'NEEDS_CONFIRMATION',
  );
  assert.equal(capabilities.get('legal-declaration-checkbox')?.expectedClassification, 'UNSUPPORTED_SAFE');
  assert.equal(capabilities.get('unknown-upload-material')?.expectedClassification, 'UNSUPPORTED_SAFE');
});
