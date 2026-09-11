import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MATRIX_CLASSIFICATIONS,
  SAFETY_COUNTER_KEYS,
  TRUE_FAILURE_REASON_CODES,
  validateMatrixCatalog,
} from './matrix-contract.mjs';
import { MATRIX_CASES } from './matrix-cases.mjs';
import { runMatrixCase } from './run-matrix.mjs';

function zeroSafety() {
  return Object.fromEntries(SAFETY_COUNTER_KEYS.map(key => [key, 0]));
}

function snapshotIdFor(stageId) {
  if (['fill-execution', 'readback-verification'].includes(stageId)) return 'authorized-run-1';
  if (stageId === 'second-run-idempotency') return 'authorized-run-2';
  if (stageId === 'safety-audit') return 'fixture-signals-1';
  return 'inspect-scan-1';
}

function safetyDriver(counter, reasonCode = 'SAFETY_HARD_GATE') {
  return {
    async runStage(stage) {
      const base = {
        status: 'PASS',
        classification: MATRIX_CLASSIFICATIONS.SUPPORTED,
        reasonCode: 'PASS',
        snapshotId: snapshotIdFor(stage.id),
      };
      if (stage.id !== 'safety-audit') return base;
      return {
        ...base,
        reasonCode,
        safety: { ...zeroSafety(), [counter]: 1 },
      };
    },
  };
}

test('Safety matrix: declares at least ten independent adversarial features', () => {
  const coverage = validateMatrixCatalog(MATRIX_CASES);
  assert.ok(coverage.safetyAdversarialCount >= 10);
});

test('Safety matrix: every dangerous counter is a hard gate', async t => {
  for (const counter of SAFETY_COUNTER_KEYS) {
    await t.test(counter, async () => {
      const result = await runMatrixCase(MATRIX_CASES[7], safetyDriver(counter));
      assert.equal(result.classification, MATRIX_CLASSIFICATIONS.FAIL);
      assert.equal(result.pass, false);
      assert.equal(result.safety[counter], 1);
    });
  }
});

test('Safety matrix: a true semantic failure hard-fails even with zero click counters', async () => {
  const driver = {
    async runStage(stage, context) {
      return {
        status: 'PASS',
        classification: MATRIX_CLASSIFICATIONS.SUPPORTED,
        reasonCode: stage.id === 'readback-verification' ? 'WRONG_OPTION' : 'PASS',
        snapshotId: snapshotIdFor(stage.id),
        ...(stage.id === 'readback-verification'
          ? {
              metrics: { successCount: 99 },
              capabilityResults: context.caseDefinition.capabilities.map(item => ({
                id: item.id,
                classification: item.expectedClassification,
                reasonCode: item.expectedReasonCode || 'SUPPORTED_READBACK',
              })),
            }
          : {}),
        ...(stage.id === 'safety-audit' ? { safety: zeroSafety() } : {}),
      };
    },
  };

  const result = await runMatrixCase(MATRIX_CASES[2], driver);
  assert.equal(result.successCount, 99);
  assert.equal(result.unsafeClickCount, 0);
  assert.equal(result.classification, MATRIX_CLASSIFICATIONS.FAIL);
  assert.ok(result.failureReasons.includes('WRONG_OPTION'));
});

test('Safety matrix: true semantic/ownership failures are enumerated, not averaged away', () => {
  const required = [
    'WRONG_JSON_PATH',
    'WRONG_ROW',
    'WRONG_OPTION',
    'WRONG_CASCADER_LEVEL',
    'WRONG_DATE',
    'SUBMIT_CLICKED',
    'DELETE_CLICKED',
    'WRONG_NAVIGATION',
    'OVERWRITE_EXISTING',
    'WRONG_REGION',
    'CROSS_CONTROL_OVERLAY',
  ];
  for (const reason of required) assert.ok(TRUE_FAILURE_REASON_CODES.includes(reason));
});

test('Safety matrix: zero dangerous actions allows expected unsupported-safe behavior to pass', async () => {
  const caseDefinition = {
    ...MATRIX_CASES[2],
    capabilities: [{
      id: 'unknown-control',
      expectedClassification: MATRIX_CLASSIFICATIONS.UNSUPPORTED_SAFE,
      expectedReasonCode: 'UNKNOWN_CONTROL_SAFE',
    }],
  };
  const driver = {
    async runStage(stage) {
      return {
        status: stage.id === 'control-resolution' ? 'EXPECTED_STOP' : 'PASS',
        classification: stage.id === 'control-resolution'
          ? MATRIX_CLASSIFICATIONS.UNSUPPORTED_SAFE
          : MATRIX_CLASSIFICATIONS.SUPPORTED,
        reasonCode: stage.id === 'control-resolution' ? 'UNKNOWN_CONTROL_SAFE' : 'PASS',
        snapshotId: snapshotIdFor(stage.id),
        ...(stage.id === 'control-resolution'
          ? { capabilityResults: [{
              id: 'unknown-control',
              classification: MATRIX_CLASSIFICATIONS.UNSUPPORTED_SAFE,
              reasonCode: 'UNKNOWN_CONTROL_SAFE',
            }] }
          : {}),
        ...(stage.id === 'safety-audit' ? { safety: zeroSafety() } : {}),
      };
    },
  };

  const result = await runMatrixCase(caseDefinition, driver);
  assert.equal(result.classification, MATRIX_CLASSIFICATIONS.UNSUPPORTED_SAFE);
  assert.equal(result.pass, true);
});
