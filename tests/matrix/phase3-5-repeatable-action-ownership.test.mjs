import test from 'node:test';
import assert from 'node:assert/strict';

import { MATRIX_CLASSIFICATIONS, validateMatrixCatalog } from './matrix-contract.mjs';
import { MATRIX_CASES } from './matrix-cases.mjs';
import { runMatrixCase } from './run-matrix.mjs';

test('Repeatable matrix: has at least five distinct scenarios with local action ownership', () => {
  const coverage = validateMatrixCatalog(MATRIX_CASES);
  assert.ok(coverage.repeatableScenarioCount >= 5);

  for (const repeatable of MATRIX_CASES.flatMap(item => item.repeatables)) {
    assert.ok(['section-local', 'region-local'].includes(repeatable.actionOwnership));
    assert.notEqual(repeatable.actionOwnership, 'global');
  }
});

test('Repeatable matrix: covers family, paired-range, zero-row papers, awards, and JQX recovery', () => {
  const ids = new Set(MATRIX_CASES.flatMap(item => item.repeatables.map(entry => entry.id)));
  const required = [
    'family-existing-row-growth',
    'internships-paired-range',
    'papers-zero-row-recovery',
    'awards-section-local-add',
    'jqx-zero-row-recovery',
  ];

  for (const id of required) assert.ok(ids.has(id), `missing repeatable scenario: ${id}`);
});

test('Repeatable matrix: wrong-row or global-add evidence is a true FAIL', async () => {
  const driver = {
    async runStage(stage) {
      return stage.id === 'safety-audit'
        ? {
            status: 'FAIL',
            classification: MATRIX_CLASSIFICATIONS.FAIL,
            reasonCode: 'GLOBAL_ADD_OWNERSHIP_VIOLATION',
            snapshotId: 'fixture-signals-1',
            safety: { unsafeClickCount: 1, wrongRowCount: 1 },
          }
        : {
            status: 'PASS',
            classification: MATRIX_CLASSIFICATIONS.SUPPORTED,
            reasonCode: 'PASS',
            snapshotId: stage.id === 'second-run-idempotency'
              ? 'authorized-run-2'
              : ['fill-execution', 'readback-verification'].includes(stage.id)
                ? 'authorized-run-1'
                : 'inspect-scan-1',
          };
    },
  };

  const result = await runMatrixCase(MATRIX_CASES[0], driver);
  assert.equal(result.classification, MATRIX_CLASSIFICATIONS.FAIL);
  assert.equal(result.pass, false);
  assert.equal(result.safety.wrongRowCount, 1);
});
