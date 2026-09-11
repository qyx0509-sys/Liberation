import {
  MATRIX_CLASSIFICATIONS,
  MATRIX_SCHEMA_VERSION,
  MATRIX_STAGES,
  RESULT_COUNT_KEYS,
  SAFETY_COUNTER_KEYS,
  TRUE_FAILURE_REASON_CODES,
  contractError,
  normalizeStageObservation,
  validateMatrixCase,
} from './matrix-contract.mjs';

const CLASSIFICATION_PRIORITY = Object.freeze({
  [MATRIX_CLASSIFICATIONS.SUPPORTED]: 0,
  [MATRIX_CLASSIFICATIONS.UNSUPPORTED_SAFE]: 1,
  [MATRIX_CLASSIFICATIONS.NEEDS_CONFIRMATION]: 2,
  [MATRIX_CLASSIFICATIONS.FAIL]: 3,
});

export async function runMatrixCase(caseDefinition, driver) {
  validateMatrixCase(caseDefinition);
  if (!driver || typeof driver.runStage !== 'function') {
    throw contractError('MATRIX_INVALID_DRIVER', `${caseDefinition.id} driver must implement runStage(stage, context)`);
  }

  const stages = [];
  const counts = zeroCounters(RESULT_COUNT_KEYS);
  const safety = zeroCounters(SAFETY_COUNTER_KEYS);
  const capabilityResults = new Map();
  const failureReasons = [];
  let blockedByFailure = false;

  await driver.beginCase?.({ caseDefinition });
  try {
    for (const stage of MATRIX_STAGES) {
      let normalized;
      if (blockedByFailure && stage.id !== 'safety-audit') {
        normalized = normalizeStageObservation(stage, {
          status: 'SKIPPED',
          classification: MATRIX_CLASSIFICATIONS.FAIL,
          reasonCode: 'PREVIOUS_STAGE_FAILED',
          evidence: { blocked: true },
        });
      } else {
        normalized = await executeStage(driver, stage, caseDefinition, stages);
      }

      stages.push(normalized);
      mergeMaximumCounters(counts, normalized.metrics);
      mergeMaximumCounters(safety, normalized.safety);
      collectCapabilityResults(capabilityResults, normalized, failureReasons);

      if (normalized.status === 'FAIL' || normalized.classification === MATRIX_CLASSIFICATIONS.FAIL) {
        addFailure(failureReasons, normalized.reasonCode);
        blockedByFailure = stage.id !== 'safety-audit';
      }
      if (TRUE_FAILURE_REASON_CODES.includes(normalized.reasonCode)) {
        addFailure(failureReasons, normalized.reasonCode);
        blockedByFailure = stage.id !== 'safety-audit';
      }
    }
  } finally {
    await driver.endCase?.({ caseDefinition, stages: Object.freeze([...stages]) });
  }

  validateRuntimeSnapshots(stages, failureReasons);
  if (Object.values(safety).some(count => count > 0)) {
    addFailure(failureReasons, 'SAFETY_HARD_GATE');
  }

  compareCapabilities(caseDefinition, capabilityResults, failureReasons);
  const observedClassification = aggregateClassification([
    ...stages.map(stage => stage.classification),
    ...[...capabilityResults.values()].map(result => result.classification),
  ]);
  const classification = failureReasons.length
    ? MATRIX_CLASSIFICATIONS.FAIL
    : observedClassification;
  const byId = Object.fromEntries(stages.map(stage => [stage.id, stage]));
  const classificationSummary = summarizeClassifications(capabilityResults.values());

  return Object.freeze({
    schemaVersion: MATRIX_SCHEMA_VERSION,
    caseId: caseDefinition.id,
    framework: caseDefinition.framework,
    pageType: caseDefinition.pageType,
    stages: Object.freeze([...stages]),
    sectionDetection: byId['page-section-detection'],
    regionDetection: byId['embedded-region-detection'],
    fieldDetection: byId['field-detection'],
    fieldMatching: byId['field-matching'],
    controlCoverage: byId['control-resolution'],
    ...counts,
    ...pickPublicSafetyCounters(safety),
    safety: Object.freeze({ ...safety }),
    capabilityResults: Object.freeze([...capabilityResults.values()]),
    classificationSummary: Object.freeze(classificationSummary),
    observedClassification,
    classification,
    failureReasons: Object.freeze([...failureReasons]),
    pass: classification !== MATRIX_CLASSIFICATIONS.FAIL,
  });
}

export async function runMatrix(cases, createDriver) {
  if (!Array.isArray(cases)) throw contractError('MATRIX_INVALID_CATALOG', 'cases must be an array');
  if (typeof createDriver !== 'function') {
    throw contractError('MATRIX_INVALID_DRIVER_FACTORY', 'createDriver must be a function');
  }

  const seenDrivers = new WeakSet();
  const results = [];
  for (const caseDefinition of cases) {
    validateMatrixCase(caseDefinition);
    const driver = await createDriver(caseDefinition);
    if (!driver || (typeof driver !== 'object' && typeof driver !== 'function')) {
      throw contractError('MATRIX_INVALID_DRIVER', `${caseDefinition.id} driver factory returned no driver`);
    }
    if (seenDrivers.has(driver)) {
      throw contractError(
        'MATRIX_DRIVER_REUSED',
        `${caseDefinition.id} reused a driver; every page case requires an isolated runtime`,
      );
    }
    seenDrivers.add(driver);
    try {
      results.push(await runMatrixCase(caseDefinition, driver));
    } finally {
      await driver.close?.();
    }
  }
  return Object.freeze(results);
}

async function executeStage(driver, stage, caseDefinition, stages) {
  try {
    const observation = await driver.runStage(stage, Object.freeze({
      caseDefinition,
      stages: Object.freeze([...stages]),
    }));
    return normalizeStageObservation(stage, observation);
  } catch (error) {
    if (error?.code?.startsWith?.('MATRIX_')) throw error;
    return normalizeStageObservation(stage, {
      status: 'FAIL',
      classification: MATRIX_CLASSIFICATIONS.FAIL,
      reasonCode: 'DRIVER_STAGE_ERROR',
      evidence: { errorName: String(error?.name || 'Error') },
    });
  }
}

function compareCapabilities(caseDefinition, actualResults, failureReasons) {
  const expectedById = new Map(caseDefinition.capabilities.map(item => [item.id, item]));

  for (const expected of caseDefinition.capabilities) {
    const actual = actualResults.get(expected.id);
    if (!actual) {
      addFailure(failureReasons, `MISSING_CAPABILITY_RESULT:${expected.id}`);
      continue;
    }
    if (actual.classification !== expected.expectedClassification) {
      addFailure(failureReasons, `CAPABILITY_CLASSIFICATION_MISMATCH:${expected.id}`);
    }
    if (expected.expectedReasonCode && actual.reasonCode !== expected.expectedReasonCode) {
      addFailure(failureReasons, `CAPABILITY_REASON_MISMATCH:${expected.id}`);
    }
  }

  for (const actualId of actualResults.keys()) {
    if (!expectedById.has(actualId)) {
      addFailure(failureReasons, `UNDECLARED_CAPABILITY_RESULT:${actualId}`);
    }
  }
}

function collectCapabilityResults(target, stage, failureReasons) {
  for (const result of stage.capabilityResults) {
    if (target.has(result.id)) {
      addFailure(failureReasons, `DUPLICATE_CAPABILITY_RESULT:${result.id}`);
      continue;
    }
    target.set(result.id, Object.freeze({ ...result, stageId: stage.id }));
  }
}

function validateRuntimeSnapshots(stages, failureReasons) {
  const byId = new Map(stages.map(stage => [stage.id, stage]));
  const inspectIds = [
    'page-section-detection',
    'embedded-region-detection',
    'field-detection',
    'field-matching',
    'control-resolution',
  ].map(id => byId.get(id)?.snapshotId).filter(Boolean);
  if (inspectIds.length !== 5) addFailure(failureReasons, 'MISSING_INSPECT_SNAPSHOT');
  if (new Set(inspectIds).size > 1) addFailure(failureReasons, 'INSPECT_SNAPSHOT_DRIFT');

  const fillSnapshot = byId.get('fill-execution')?.snapshotId;
  const readbackSnapshot = byId.get('readback-verification')?.snapshotId;
  if (!fillSnapshot || !readbackSnapshot) {
    addFailure(failureReasons, 'MISSING_AUTHORIZED_RUN_SNAPSHOT');
  } else if (fillSnapshot !== readbackSnapshot) {
    addFailure(failureReasons, 'AUTHORIZED_RUN_SNAPSHOT_DRIFT');
  }

  const secondRunSnapshot = byId.get('second-run-idempotency')?.snapshotId;
  if (!secondRunSnapshot) {
    addFailure(failureReasons, 'MISSING_SECOND_RUN_SNAPSHOT');
  } else if (fillSnapshot && secondRunSnapshot === fillSnapshot) {
    addFailure(failureReasons, 'SECOND_RUN_SNAPSHOT_REUSED');
  }
}

function aggregateClassification(classifications) {
  return classifications.reduce((selected, current) => (
    CLASSIFICATION_PRIORITY[current] > CLASSIFICATION_PRIORITY[selected] ? current : selected
  ), MATRIX_CLASSIFICATIONS.SUPPORTED);
}

function summarizeClassifications(results) {
  const summary = Object.fromEntries(Object.values(MATRIX_CLASSIFICATIONS).map(key => [key, 0]));
  for (const result of results) summary[result.classification] += 1;
  return summary;
}

function zeroCounters(keys) {
  return Object.fromEntries(keys.map(key => [key, 0]));
}

function mergeMaximumCounters(target, source) {
  for (const [key, value] of Object.entries(source)) target[key] = Math.max(target[key] || 0, value);
}

function pickPublicSafetyCounters(safety) {
  return {
    unsafeClickCount: safety.unsafeClickCount,
    submitClickCount: safety.submitClickCount,
    deleteClickCount: safety.deleteClickCount,
  };
}

function addFailure(failureReasons, reasonCode) {
  if (reasonCode && !failureReasons.includes(reasonCode)) failureReasons.push(reasonCode);
}
