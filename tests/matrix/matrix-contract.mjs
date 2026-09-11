export const MATRIX_SCHEMA_VERSION = 'phase3.5-cross-platform-matrix.v1';

export const MATRIX_CLASSIFICATIONS = Object.freeze({
  SUPPORTED: 'SUPPORTED',
  NEEDS_CONFIRMATION: 'NEEDS_CONFIRMATION',
  UNSUPPORTED_SAFE: 'UNSUPPORTED_SAFE',
  FAIL: 'FAIL',
});

export const MATRIX_RUNTIME_BOUNDARIES = Object.freeze({
  'page-section-detection': Object.freeze({
    api: 'AutofillEngine.inspectSystem',
    snapshot: 'shared-inspect-system-snapshot',
    mutation: 'READ_ONLY',
  }),
  'embedded-region-detection': Object.freeze({
    api: 'AutofillEngine.inspectSystem',
    snapshot: 'shared-inspect-system-snapshot',
    mutation: 'READ_ONLY',
  }),
  'field-detection': Object.freeze({
    api: 'AutofillEngine.inspectSystem',
    snapshot: 'shared-inspect-system-snapshot',
    mutation: 'READ_ONLY',
  }),
  'field-matching': Object.freeze({
    api: 'AutofillEngine.inspectSystem',
    snapshot: 'shared-inspect-system-snapshot',
    mutation: 'READ_ONLY',
  }),
  'control-resolution': Object.freeze({
    api: 'ControlAdapterRegistry.resolve',
    snapshot: 'shared-inspect-system-snapshot',
    mutation: 'READ_ONLY',
  }),
  'fill-execution': Object.freeze({
    api: 'AutofillEngine.prepareRun>authorizeRun>runCurrent|runAll',
    snapshot: 'authorized-run-snapshot',
    mutation: 'AUTHORIZED_ONLY',
  }),
  'readback-verification': Object.freeze({
    api: 'AutofillEngine.getReport|verificationStatus',
    snapshot: 'authorized-run-snapshot',
    mutation: 'READ_ONLY',
  }),
  'second-run-idempotency': Object.freeze({
    api: 'AutofillEngine.prepareRun>authorizeRun>runCurrent|runAll',
    snapshot: 'fresh-second-run-snapshot',
    mutation: 'AUTHORIZED_ONLY',
    freshRunRequired: true,
  }),
  'safety-audit': Object.freeze({
    api: 'FixtureSignals.externalRequests|consoleMessages|dangerCounters',
    snapshot: 'post-run-fixture-signals',
    mutation: 'READ_ONLY',
  }),
});

export const MATRIX_STAGES = Object.freeze([
  stage('page-section-detection', 'Page Section Detection'),
  stage('embedded-region-detection', 'Embedded Region Detection'),
  stage('field-detection', 'Field Detection'),
  stage('field-matching', 'Field Matching'),
  stage('control-resolution', 'Control Resolution'),
  stage('fill-execution', 'Fill Execution'),
  stage('readback-verification', 'Readback Verification'),
  stage('second-run-idempotency', 'Second-run Idempotency'),
  stage('safety-audit', 'Safety Audit'),
]);

export const SAFETY_COUNTER_KEYS = Object.freeze([
  'unsafeClickCount',
  'submitClickCount',
  'deleteClickCount',
  'unsafeProgressionClickCount',
  'unknownUploadCount',
  'legalConsentAutoCheckCount',
  'viewerNavigationClickCount',
  'wrongOverlayCount',
  'wrongRowCount',
  'overwriteCount',
  'wrongRegionCount',
]);

export const TRUE_FAILURE_REASON_CODES = Object.freeze([
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
]);

export const RESULT_COUNT_KEYS = Object.freeze([
  'successCount',
  'skippedExistingCount',
  'needsConfirmationCount',
  'unmatchedCount',
  'missingJsonCount',
]);

const CLASSIFICATION_VALUES = new Set(Object.values(MATRIX_CLASSIFICATIONS));
const STAGE_STATUSES = new Set(['PASS', 'EXPECTED_STOP', 'FAIL', 'SKIPPED']);
const PRIVATE_EVIDENCE_KEYS = new Set([
  'authorization',
  'beforevalue',
  'cookie',
  'currentvalue',
  'document',
  'element',
  'elements',
  'password',
  'profile',
  'resume',
  'token',
  'value',
  'values',
  'aftervalue',
]);

export function validateMatrixCase(caseDefinition) {
  if (!caseDefinition || typeof caseDefinition !== 'object' || Array.isArray(caseDefinition)) {
    throw contractError('MATRIX_INVALID_CASE', 'Matrix case must be an object');
  }

  requireNonEmptyString(caseDefinition.id, 'id');
  requireNonEmptyString(caseDefinition.framework, `${caseDefinition.id}.framework`);
  requireNonEmptyString(caseDefinition.pageType, `${caseDefinition.id}.pageType`);
  if (!caseDefinition.fixture || typeof caseDefinition.fixture !== 'object') {
    throw contractError('MATRIX_INVALID_CASE', `${caseDefinition.id}.fixture must be an object`);
  }
  requireNonEmptyString(caseDefinition.fixture.kind, `${caseDefinition.id}.fixture.kind`);
  requireNonEmptyString(caseDefinition.fixture.source, `${caseDefinition.id}.fixture.source`);

  requireUniqueStringArray(caseDefinition.controls, `${caseDefinition.id}.controls`);
  requireUniqueStringArray(caseDefinition.safetyFeatures, `${caseDefinition.id}.safetyFeatures`, true);
  requireUniqueStringArray(caseDefinition.expectedPaths, `${caseDefinition.id}.expectedPaths`, true);

  if (!Array.isArray(caseDefinition.repeatables)) {
    throw contractError('MATRIX_INVALID_CASE', `${caseDefinition.id}.repeatables must be an array`);
  }
  for (const repeatable of caseDefinition.repeatables) {
    requireNonEmptyString(repeatable?.id, `${caseDefinition.id}.repeatables[].id`);
    if (!['section-local', 'region-local'].includes(repeatable.actionOwnership)) {
      throw contractError(
        'MATRIX_INVALID_ACTION_OWNERSHIP',
        `${caseDefinition.id}.${repeatable.id} must use section-local or region-local ownership`,
      );
    }
  }

  if (!caseDefinition.expectedSections || typeof caseDefinition.expectedSections !== 'object') {
    throw contractError('MATRIX_INVALID_CASE', `${caseDefinition.id}.expectedSections must be an object`);
  }
  requireUniqueStringArray(
    caseDefinition.expectedSections.page,
    `${caseDefinition.id}.expectedSections.page`,
  );
  requireUniqueStringArray(
    caseDefinition.expectedSections.embedded,
    `${caseDefinition.id}.expectedSections.embedded`,
    true,
  );

  if (!Array.isArray(caseDefinition.capabilities) || !caseDefinition.capabilities.length) {
    throw contractError('MATRIX_INVALID_CASE', `${caseDefinition.id}.capabilities must not be empty`);
  }
  const capabilityIds = new Set();
  for (const capability of caseDefinition.capabilities) {
    requireNonEmptyString(capability?.id, `${caseDefinition.id}.capabilities[].id`);
    if (capabilityIds.has(capability.id)) {
      throw contractError('MATRIX_DUPLICATE_CAPABILITY', `${caseDefinition.id}.${capability.id} is duplicated`);
    }
    capabilityIds.add(capability.id);
    assertClassification(capability.expectedClassification, `${caseDefinition.id}.${capability.id}`);
    if (capability.expectedClassification !== MATRIX_CLASSIFICATIONS.SUPPORTED) {
      requireNonEmptyString(
        capability.expectedReasonCode,
        `${caseDefinition.id}.${capability.id}.expectedReasonCode`,
      );
    }
  }

  return caseDefinition;
}

export function validateMatrixCatalog(cases) {
  if (!Array.isArray(cases) || cases.length < 8) {
    throw contractError('MATRIX_INSUFFICIENT_PAGE_CASES', 'Matrix catalog requires at least eight page cases');
  }

  const ids = new Set();
  const controls = new Set();
  const repeatables = new Set();
  const safetyFeatures = new Set();
  const capabilityIds = new Set();

  for (const caseDefinition of cases) {
    validateMatrixCase(caseDefinition);
    if (ids.has(caseDefinition.id)) {
      throw contractError('MATRIX_DUPLICATE_CASE', `Duplicate matrix case: ${caseDefinition.id}`);
    }
    ids.add(caseDefinition.id);
    caseDefinition.controls.forEach(item => controls.add(item));
    caseDefinition.repeatables.forEach(item => repeatables.add(item.id));
    caseDefinition.safetyFeatures.forEach(item => safetyFeatures.add(item));
    for (const capability of caseDefinition.capabilities) {
      if (capabilityIds.has(capability.id)) {
        throw contractError('MATRIX_DUPLICATE_CAPABILITY', `Duplicate catalog capability: ${capability.id}`);
      }
      capabilityIds.add(capability.id);
    }
  }

  if (controls.size < 12) {
    throw contractError('MATRIX_INSUFFICIENT_CONTROL_FAMILIES', 'Matrix requires at least twelve control families');
  }
  if (repeatables.size < 5) {
    throw contractError('MATRIX_INSUFFICIENT_REPEATABLES', 'Matrix requires at least five repeatable scenarios');
  }
  if (safetyFeatures.size < 10) {
    throw contractError('MATRIX_INSUFFICIENT_SAFETY_CASES', 'Matrix requires at least ten safety adversarial cases');
  }

  return Object.freeze({
    pageCaseCount: cases.length,
    controlFamilyCount: controls.size,
    controlFamilies: Object.freeze([...controls].sort()),
    repeatableScenarioCount: repeatables.size,
    repeatableScenarios: Object.freeze([...repeatables].sort()),
    safetyAdversarialCount: safetyFeatures.size,
    safetyFeatures: Object.freeze([...safetyFeatures].sort()),
    capabilityCount: capabilityIds.size,
  });
}

export function normalizeStageObservation(stage, observation) {
  const source = observation && typeof observation === 'object' ? observation : {};
  const classification = source.classification || MATRIX_CLASSIFICATIONS.FAIL;
  assertClassification(classification, `${stage.id}.classification`);
  const status = source.status || (classification === MATRIX_CLASSIFICATIONS.FAIL ? 'FAIL' : 'PASS');
  if (!STAGE_STATUSES.has(status)) {
    throw contractError('MATRIX_INVALID_STAGE_STATUS', `${stage.id}.status is invalid: ${status}`);
  }

  const metrics = normalizeCounters(source.metrics, RESULT_COUNT_KEYS, `${stage.id}.metrics`);
  const safety = normalizeCounters(source.safety, SAFETY_COUNTER_KEYS, `${stage.id}.safety`);
  const capabilityResults = normalizeCapabilityResults(source.capabilityResults, stage.id);

  return Object.freeze({
    id: stage.id,
    label: stage.label,
    status,
    classification,
    reasonCode: safeReasonCode(source.reasonCode, classification),
    snapshotId: normalizeSnapshotId(source.snapshotId, stage.id),
    evidence: metadataOnlyClone(source.evidence ?? {}),
    metrics: Object.freeze(metrics),
    safety: Object.freeze(safety),
    capabilityResults: Object.freeze(capabilityResults),
  });
}

export function metadataOnlyClone(value) {
  assertMetadataOnly(value);
  if (value === undefined) return undefined;
  return cloneMetadata(value);
}

export function assertClassification(classification, label = 'classification') {
  if (!CLASSIFICATION_VALUES.has(classification)) {
    throw contractError('MATRIX_INVALID_CLASSIFICATION', `${label} is invalid: ${classification}`);
  }
  return classification;
}

export function contractError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function normalizeCapabilityResults(results, stageId) {
  if (results === undefined) return [];
  if (!Array.isArray(results)) {
    throw contractError('MATRIX_INVALID_CAPABILITY_RESULT', `${stageId}.capabilityResults must be an array`);
  }

  const seen = new Set();
  return results.map(result => {
    requireNonEmptyString(result?.id, `${stageId}.capabilityResults[].id`);
    if (seen.has(result.id)) {
      throw contractError('MATRIX_DUPLICATE_CAPABILITY_RESULT', `${stageId}.${result.id} is duplicated`);
    }
    seen.add(result.id);
    assertClassification(result.classification, `${stageId}.${result.id}.classification`);
    return Object.freeze({
      id: result.id,
      classification: result.classification,
      reasonCode: safeReasonCode(result.reasonCode, result.classification),
      evidence: metadataOnlyClone(result.evidence ?? {}),
    });
  });
}

function normalizeCounters(source, keys, label) {
  if (source === undefined) return {};
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    throw contractError('MATRIX_INVALID_COUNTERS', `${label} must be an object`);
  }
  const allowed = new Set(keys);
  const normalized = {};
  for (const [key, rawValue] of Object.entries(source)) {
    if (!allowed.has(key)) {
      throw contractError('MATRIX_UNKNOWN_COUNTER', `${label}.${key} is not part of the matrix contract`);
    }
    const value = Number(rawValue);
    if (!Number.isSafeInteger(value) || value < 0) {
      throw contractError('MATRIX_INVALID_COUNTER', `${label}.${key} must be a non-negative integer`);
    }
    normalized[key] = value;
  }
  return normalized;
}

function assertMetadataOnly(value, path = 'evidence', seen = new Set()) {
  if (value === null || value === undefined) return;
  if (typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') {
    throw contractError('MATRIX_PRIVATE_EVIDENCE', `${path} contains a non-serializable value`);
  }
  if (typeof value !== 'object') return;
  if (seen.has(value)) {
    throw contractError('MATRIX_PRIVATE_EVIDENCE', `${path} contains a cycle`);
  }
  if (Number.isInteger(value.nodeType) || typeof value.querySelector === 'function') {
    throw contractError('MATRIX_PRIVATE_EVIDENCE', `${path} contains a DOM-like object`);
  }

  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertMetadataOnly(item, `${path}[${index}]`, seen));
  } else {
    for (const [key, child] of Object.entries(value)) {
      if (PRIVATE_EVIDENCE_KEYS.has(key.toLowerCase())) {
        throw contractError('MATRIX_PRIVATE_EVIDENCE', `${path}.${key} is forbidden`);
      }
      assertMetadataOnly(child, `${path}.${key}`, seen);
    }
  }
  seen.delete(value);
}

function cloneMetadata(value) {
  if (value === null || value === undefined || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(cloneMetadata);
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, cloneMetadata(child)]));
}

function safeReasonCode(reasonCode, classification) {
  if (typeof reasonCode === 'string' && /^[A-Z][A-Z0-9_:-]*$/.test(reasonCode)) return reasonCode;
  return classification === MATRIX_CLASSIFICATIONS.FAIL ? 'UNSPECIFIED_FAILURE' : 'UNSPECIFIED_RESULT';
}

function normalizeSnapshotId(snapshotId, stageId) {
  if (snapshotId === undefined || snapshotId === null || snapshotId === '') return null;
  if (
    typeof snapshotId !== 'string'
    || snapshotId.length > 128
    || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(snapshotId)
  ) {
    throw contractError('MATRIX_INVALID_SNAPSHOT_ID', `${stageId}.snapshotId is invalid`);
  }
  return snapshotId;
}

function requireNonEmptyString(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw contractError('MATRIX_INVALID_CASE', `${label} must be a non-empty string`);
  }
}

function requireUniqueStringArray(value, label, allowEmpty = false) {
  if (!Array.isArray(value) || (!allowEmpty && !value.length)) {
    throw contractError('MATRIX_INVALID_CASE', `${label} must be ${allowEmpty ? 'an' : 'a non-empty'} array`);
  }
  const seen = new Set();
  for (const item of value) {
    requireNonEmptyString(item, `${label}[]`);
    if (seen.has(item)) throw contractError('MATRIX_INVALID_CASE', `${label} contains duplicate ${item}`);
    seen.add(item);
  }
}

function stage(id, label) {
  return Object.freeze({ id, label, runtimeBoundary: MATRIX_RUNTIME_BOUNDARIES[id] });
}
