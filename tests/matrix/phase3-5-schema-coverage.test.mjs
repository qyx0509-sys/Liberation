import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

import { MATRIX_CLASSIFICATIONS } from './matrix-contract.mjs';
import { MATRIX_CASES } from './matrix-cases.mjs';

const require = createRequire(import.meta.url);
const FieldAliases = require('../../src/mappings/field-aliases.js');

function allExpectedPaths() {
  return new Set(MATRIX_CASES.flatMap(item => item.expectedPaths));
}

test('Schema matrix: every expectedPath is a real canonical FieldAliases definition', () => {
  const canonicalPaths = new Set(FieldAliases.FIELD_DEFINITIONS.map(item => item.path));
  const missing = [...allExpectedPaths()]
    .filter(path => !canonicalPaths.has(path))
    .sort();

  assert.deepEqual(missing, []);
});

test('Schema matrix: covers geographic region/address separation and generic family/education/paper fields', () => {
  const paths = allExpectedPaths();
  const required = [
    'basic.birthplaceRegion',
    'basic.hometownRegion',
    'basic.householdRegion',
    'basic.householdAddress',
    'contact.archiveRegion',
    'family[].address',
    'education[].school',
    'education[].gpa',
    'education[].majorRank',
    'education[].majorRankTotal',
    'language[].certificate',
    'language[].score',
    'application.disciplinaryHistory',
    'application.personalStatement',
    'application.notes',
    'papers[].impactFactor',
  ];

  for (const path of required) assert.ok(paths.has(path), `missing schema matrix path: ${path}`);
});

test('Schema matrix: preserves legacy address paths while never treating region and detail as one path', () => {
  const paths = allExpectedPaths();

  assert.ok(paths.has('basic.hometown'));
  assert.ok(paths.has('basic.householdAddress'));
  assert.ok(paths.has('basic.householdRegion'));
  assert.notEqual('basic.householdAddress', 'basic.householdRegion');
});

test('Schema matrix: language singleton without a discriminator is an expected NEEDS_CONFIRMATION capability', () => {
  const capability = MATRIX_CASES
    .flatMap(item => item.capabilities)
    .find(item => item.id === 'language-singleton-multiple-candidates');

  assert.equal(capability?.expectedClassification, MATRIX_CLASSIFICATIONS.NEEDS_CONFIRMATION);
  assert.equal(capability?.expectedReasonCode, 'NO_DISCRIMINATOR');
});

test('Schema matrix: published must not alias to submitted or accepted', () => {
  const capability = MATRIX_CASES
    .flatMap(item => item.capabilities)
    .find(item => item.id === 'papers-status-published-vs-submitted-accepted');

  assert.equal(capability?.expectedClassification, MATRIX_CLASSIFICATIONS.NEEDS_CONFIRMATION);
  assert.equal(capability?.expectedReasonCode, 'LOW_SCORE');
  assert.deepEqual(capability?.forbiddenCanonicalMappings, ['submitted', 'accepted']);
});

test('Schema matrix: legal declarations and unknown uploads remain UNSUPPORTED_SAFE', () => {
  const capabilities = MATRIX_CASES.flatMap(item => item.capabilities);
  for (const id of ['legal-declaration-checkbox', 'unknown-upload-material']) {
    const capability = capabilities.find(item => item.id === id);
    assert.equal(capability?.expectedClassification, MATRIX_CLASSIFICATIONS.UNSUPPORTED_SAFE);
  }
});
