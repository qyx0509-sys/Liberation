import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MATRIX_CLASSIFICATIONS,
  MATRIX_RUNTIME_BOUNDARIES,
  MATRIX_STAGES,
  validateMatrixCatalog,
} from './matrix-contract.mjs';
import { MATRIX_CASES } from './matrix-cases.mjs';
import { runMatrix, runMatrixCase } from './run-matrix.mjs';

function supportedDriver(overrides = {}) {
  const calls = [];
  const driver = {
    calls,
    async runStage(stage, context) {
      calls.push({ id: stage.id, priorStageCount: context.stages.length });
      return {
        status: 'PASS',
        classification: MATRIX_CLASSIFICATIONS.SUPPORTED,
        reasonCode: `${stage.id.toUpperCase()}_PASS`,
        snapshotId: snapshotIdFor(stage.id),
        evidence: { assertionCount: 1 },
        ...(stage.id === 'fill-execution'
          ? { metrics: { successCount: 7 } }
          : {}),
        ...(stage.id === 'second-run-idempotency'
          ? { metrics: { skippedExistingCount: 7 } }
          : {}),
        ...(stage.id === 'readback-verification'
          ? {
              capabilityResults: context.caseDefinition.capabilities.map(item => ({
                id: item.id,
                classification: item.expectedClassification,
                reasonCode: item.expectedReasonCode || 'SUPPORTED_READBACK',
              })),
            }
          : {}),
        ...(stage.id === 'safety-audit'
          ? { safety: { unsafeClickCount: 0, submitClickCount: 0, deleteClickCount: 0 } }
          : {}),
        ...(overrides[stage.id] || {}),
      };
    },
  };
  return driver;
}

function snapshotIdFor(stageId) {
  if ([
    'page-section-detection',
    'embedded-region-detection',
    'field-detection',
    'field-matching',
    'control-resolution',
  ].includes(stageId)) return 'inspect-scan-1';
  if (['fill-execution', 'readback-verification'].includes(stageId)) return 'authorized-run-1';
  if (stageId === 'second-run-idempotency') return 'authorized-run-2';
  return 'fixture-signals-1';
}

test('Matrix contract: catalog has exactly the eight required page cases and nine ordered stages', () => {
  const coverage = validateMatrixCatalog(MATRIX_CASES);

  assert.equal(MATRIX_CASES.length, 8);
  assert.equal(coverage.pageCaseCount, 8);
  assert.deepEqual(
    MATRIX_STAGES.map(stage => stage.label),
    [
      'Page Section Detection',
      'Embedded Region Detection',
      'Field Detection',
      'Field Matching',
      'Control Resolution',
      'Fill Execution',
      'Readback Verification',
      'Second-run Idempotency',
      'Safety Audit',
    ],
  );
});

test('Matrix contract: stages 1-4 share one inspectSystem snapshot and mutations require authorization', () => {
  const inspectStages = MATRIX_STAGES.slice(0, 4);
  assert.ok(inspectStages.every(stage => (
    MATRIX_RUNTIME_BOUNDARIES[stage.id].api === 'AutofillEngine.inspectSystem'
    && MATRIX_RUNTIME_BOUNDARIES[stage.id].snapshot === 'shared-inspect-system-snapshot'
    && MATRIX_RUNTIME_BOUNDARIES[stage.id].mutation === 'READ_ONLY'
  )));

  assert.equal(
    MATRIX_RUNTIME_BOUNDARIES['fill-execution'].api,
    'AutofillEngine.prepareRun>authorizeRun>runCurrent|runAll',
  );
  assert.equal(MATRIX_RUNTIME_BOUNDARIES['fill-execution'].mutation, 'AUTHORIZED_ONLY');
  assert.equal(MATRIX_RUNTIME_BOUNDARIES['second-run-idempotency'].freshRunRequired, true);
  assert.equal(MATRIX_RUNTIME_BOUNDARIES['safety-audit'].mutation, 'READ_ONLY');
});

test('Matrix runner: executes all nine stages in order and emits the unified result shape', async () => {
  const driver = supportedDriver();
  const result = await runMatrixCase(MATRIX_CASES[2], driver);

  assert.deepEqual(driver.calls.map(call => call.id), MATRIX_STAGES.map(stage => stage.id));
  assert.deepEqual(driver.calls.map(call => call.priorStageCount), [0, 1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(result.caseId, MATRIX_CASES[2].id);
  assert.equal(result.sectionDetection.status, 'PASS');
  assert.equal(result.regionDetection.status, 'PASS');
  assert.equal(result.fieldDetection.status, 'PASS');
  assert.equal(result.fieldMatching.status, 'PASS');
  assert.equal(result.controlCoverage.status, 'PASS');
  assert.equal(result.successCount, 7);
  assert.equal(result.skippedExistingCount, 7);
  assert.equal(result.needsConfirmationCount, 0);
  assert.equal(result.unmatchedCount, 0);
  assert.equal(result.missingJsonCount, 0);
  assert.equal(result.unsafeClickCount, 0);
  assert.equal(result.submitClickCount, 0);
  assert.equal(result.deleteClickCount, 0);
  assert.equal(result.classification, MATRIX_CLASSIFICATIONS.SUPPORTED);
  assert.equal(result.pass, true);
});

test('Matrix runner: a submit click hard-fails the whole case even when fills succeed', async () => {
  const driver = supportedDriver({
    'fill-execution': { metrics: { successCount: 98 } },
    'safety-audit': {
      safety: { unsafeClickCount: 1, submitClickCount: 1, deleteClickCount: 0 },
    },
  });

  const result = await runMatrixCase(MATRIX_CASES[2], driver);

  assert.equal(result.successCount, 98);
  assert.equal(result.submitClickCount, 1);
  assert.equal(result.classification, MATRIX_CLASSIFICATIONS.FAIL);
  assert.equal(result.pass, false);
  assert.ok(result.failureReasons.includes('SAFETY_HARD_GATE'));
});

test('Matrix runner: rejects topology snapshot drift and a reused second-run snapshot', async () => {
  const topologyDrift = await runMatrixCase(MATRIX_CASES[2], supportedDriver({
    'field-matching': { snapshotId: 'inspect-scan-stale' },
  }));
  assert.equal(topologyDrift.classification, MATRIX_CLASSIFICATIONS.FAIL);
  assert.ok(topologyDrift.failureReasons.includes('INSPECT_SNAPSHOT_DRIFT'));

  const reusedSecondRun = await runMatrixCase(MATRIX_CASES[2], supportedDriver({
    'second-run-idempotency': { snapshotId: 'authorized-run-1' },
  }));
  assert.equal(reusedSecondRun.classification, MATRIX_CLASSIFICATIONS.FAIL);
  assert.ok(reusedSecondRun.failureReasons.includes('SECOND_RUN_SNAPSHOT_REUSED'));
});

test('Matrix runner: correct fail-closed outcomes remain passing matrix evidence', async () => {
  const caseDefinition = {
    ...MATRIX_CASES[5],
    capabilities: [{
      id: 'ambiguous-option',
      expectedClassification: MATRIX_CLASSIFICATIONS.NEEDS_CONFIRMATION,
      expectedReasonCode: 'LOW_SCORE',
    }],
  };
  const driver = supportedDriver({
    'readback-verification': {
      classification: MATRIX_CLASSIFICATIONS.NEEDS_CONFIRMATION,
      reasonCode: 'LOW_SCORE',
      metrics: { needsConfirmationCount: 1 },
      capabilityResults: [{
        id: 'ambiguous-option',
        classification: MATRIX_CLASSIFICATIONS.NEEDS_CONFIRMATION,
        reasonCode: 'LOW_SCORE',
      }],
    },
  });

  const result = await runMatrixCase(caseDefinition, driver);

  assert.equal(result.classification, MATRIX_CLASSIFICATIONS.NEEDS_CONFIRMATION);
  assert.equal(result.needsConfirmationCount, 1);
  assert.equal(result.pass, true);
});

test('Matrix runner: rejects private values and DOM/profile material from stage evidence', async () => {
  const driver = supportedDriver({
    'field-matching': {
      evidence: { resume: { basic: { name: 'private' } } },
    },
  });

  await assert.rejects(
    runMatrixCase(MATRIX_CASES[2], driver),
    error => error?.code === 'MATRIX_PRIVATE_EVIDENCE',
  );
});

test('Matrix runner: runs each case with an isolated driver instance', async () => {
  const created = [];
  const results = await runMatrix(MATRIX_CASES.slice(0, 2), async caseDefinition => {
    const driver = supportedDriver();
    created.push({ caseId: caseDefinition.id, driver });
    return driver;
  });

  assert.equal(results.length, 2);
  assert.notEqual(created[0].driver, created[1].driver);
  assert.deepEqual(created.map(item => item.caseId), MATRIX_CASES.slice(0, 2).map(item => item.id));
  assert.ok(created.every(item => item.driver.calls.length === 9));
});

test('Matrix runner: rejects a driver reused across page cases', async () => {
  const driver = supportedDriver();
  await assert.rejects(
    runMatrix(MATRIX_CASES.slice(0, 2), async () => driver),
    error => error?.code === 'MATRIX_DRIVER_REUSED',
  );
});
