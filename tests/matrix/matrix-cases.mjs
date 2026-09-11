import { MATRIX_CLASSIFICATIONS } from './matrix-contract.mjs';

const SUPPORTED = MATRIX_CLASSIFICATIONS.SUPPORTED;
const NEEDS_CONFIRMATION = MATRIX_CLASSIFICATIONS.NEEDS_CONFIRMATION;
const UNSUPPORTED_SAFE = MATRIX_CLASSIFICATIONS.UNSUPPORTED_SAFE;

function capability(id, expectedClassification = SUPPORTED, details = {}) {
  return Object.freeze({ id, expectedClassification, ...details });
}

function completionEvidence(unitFiles, browserEvidence = 'NONE', browserFiles = []) {
  return Object.freeze({
    evidenceLevel: 'UNIT_RUNTIME',
    unitFiles: Object.freeze([...unitFiles]),
    browserEvidence,
    browserFiles: Object.freeze([...browserFiles]),
  });
}

const DATE_COMPLETION_UNITS = Object.freeze([
  'tests/unit/phase3-3-2-1-calendar-mode-strategy.test.mjs',
  'tests/unit/phase3-3-2-2b-calendar-transition-hardening.test.mjs',
]);
const CASCADER_COMPLETION_UNITS = Object.freeze([
  'tests/unit/phase3-3-2-5-cascader-adapter.test.mjs',
]);
const REPEATABLE_COMPLETION_UNITS = Object.freeze([
  'tests/unit/phase3-5-completion-repeatable-action-owner.test.mjs',
]);
const REPEATABLE_FALLBACK_UNITS = Object.freeze([
  'tests/unit/phase3-5-repeatable-action-ownership-runtime.test.mjs',
]);
const SINGLETON_SCHEMA_UNITS = Object.freeze([
  'tests/unit/phase3-5-completion-singleton-education-author-rank.test.mjs',
]);
const SEMANTIC_COLLECTION_UNITS = Object.freeze([
  'tests/unit/phase3-5-semantic-collection-singleton-binding.test.mjs',
]);
const TELEMETRY_COMPLETION_UNITS = Object.freeze([
  'tests/unit/phase3-5-stable-scan-telemetry.test.mjs',
]);

function repeatable(id, actionOwnership = 'section-local') {
  return Object.freeze({ id, actionOwnership });
}

function matrixCase(definition) {
  return Object.freeze({
    ...definition,
    fixture: Object.freeze({
      kind: 'sanitized-structural-equivalent',
      ...definition.fixture,
    }),
    controls: Object.freeze([...definition.controls]),
    repeatables: Object.freeze([...definition.repeatables]),
    safetyFeatures: Object.freeze([...definition.safetyFeatures]),
    expectedSections: Object.freeze({
      page: Object.freeze([...definition.expectedSections.page]),
      embedded: Object.freeze([...definition.expectedSections.embedded]),
    }),
    expectedPaths: Object.freeze([...definition.expectedPaths]),
    capabilities: Object.freeze([...definition.capabilities]),
  });
}

export const MATRIX_CASES = Object.freeze([
  matrixCase({
    id: 'ant-vue-compound',
    framework: 'Ant Design / Vue structural equivalent',
    pageType: 'compound-application',
    fixture: {
      source: 'tests/fixtures/compound-ant-application.html',
      availability: 'EXISTING_BROWSER_FIXTURE',
    },
    controls: [
      'native-value',
      'ant-select',
      'legacy-ant-date-picker',
      'cascader',
      'file-field',
    ],
    repeatables: [
      repeatable('family-existing-row-growth'),
      repeatable('internships-paired-range'),
      repeatable('papers-zero-row-recovery'),
      repeatable('awards-section-local-add'),
    ],
    safetyFeatures: [
      'submit',
      'delete',
      'unknown-upload',
      'legal-auto-consent',
      'ambiguous-global-add',
      'cross-control-overlay',
      'stale-overlay',
      'overwrite-existing',
    ],
    expectedSections: {
      page: ['basic'],
      embedded: ['family', 'internships', 'papers', 'awards'],
    },
    expectedPaths: [
      'basic.hometown',
      'basic.birthplaceRegion',
      'basic.hometownRegion',
      'basic.householdRegion',
      'basic.householdAddress',
      'family[].address',
      'education[].school',
      'education[].gpa',
      'education[].majorRank',
      'education[].majorRankTotal',
      'language[].language',
      'language[].certificate',
      'language[].score',
      'papers[].status',
      'papers[].authorRank',
      'papers[].impactFactor',
      'awards[].level',
      'awards[].rank',
    ],
    capabilities: [
      capability('legacy-ant-day-to-month-transition'),
      capability('legacy-ant-same-root-panel-transition'),
      capability('legacy-ant-same-overlay', SUPPORTED, completionEvidence(
        DATE_COMPLETION_UNITS,
        'FULL',
        ['tests/e2e/compound-ant.e2e.mjs'],
      )),
      capability('legacy-ant-node-replace', SUPPORTED, completionEvidence(
        DATE_COMPLETION_UNITS,
        'PARTIAL',
        ['tests/e2e/compound-ant.e2e.mjs'],
      )),
      capability('legacy-ant-anchor-mode-switch-safety', SUPPORTED, completionEvidence(
        DATE_COMPLETION_UNITS,
        'FULL',
        ['tests/e2e/compound-ant.e2e.mjs'],
      )),
      capability('cascader-same-overlay-column-append'),
      capability('cascader-level-owner-refresh'),
      capability('same-overlay-menu-append', SUPPORTED, completionEvidence(
        CASCADER_COMPLETION_UNITS,
        'PARTIAL',
        ['tests/e2e/phase3-5-matrix.e2e.mjs', 'tests/e2e/compound-ant.e2e.mjs'],
      )),
      capability('four-cascader-same-overlay-append', SUPPORTED, completionEvidence(
        CASCADER_COMPLETION_UNITS,
        'FULL',
        ['tests/e2e/compound-ant.e2e.mjs'],
      )),
      capability('section-local-identical-add-labels'),
      capability('multiple-identical-add-buttons', SUPPORTED, completionEvidence(
        REPEATABLE_COMPLETION_UNITS,
        'PARTIAL',
        ['tests/e2e/phase3-5-matrix.e2e.mjs', 'tests/e2e/compound-ant.e2e.mjs'],
      )),
      capability('zero-row-sibling-add-after-fallback-root', SUPPORTED, completionEvidence(
        REPEATABLE_FALLBACK_UNITS,
        'PARTIAL',
        ['tests/e2e/compound-ant.e2e.mjs'],
      )),
      capability('singleton-array-binding', SUPPORTED, completionEvidence(
        SINGLETON_SCHEMA_UNITS,
        'PARTIAL',
        ['tests/e2e/compound-ant.e2e.mjs'],
      )),
      capability('ant-inline-singleton-nested-grid', SUPPORTED, completionEvidence(
        SEMANTIC_COLLECTION_UNITS,
        'NONE',
      )),
      capability('education-schema-coverage', SUPPORTED, completionEvidence(
        SINGLETON_SCHEMA_UNITS,
        'PARTIAL',
        ['tests/e2e/phase3-5-matrix.e2e.mjs', 'tests/e2e/compound-ant.e2e.mjs'],
      )),
      capability('annotated-field-label-normalization', SUPPORTED, completionEvidence(
        SEMANTIC_COLLECTION_UNITS,
        'NONE',
      )),
      capability('author-rank', SUPPORTED, completionEvidence(
        SINGLETON_SCHEMA_UNITS,
        'PARTIAL',
        ['tests/e2e/compound-ant.e2e.mjs'],
      )),
      capability('late-stable-field-scan', SUPPORTED, completionEvidence(
        TELEMETRY_COMPLETION_UNITS,
        'NONE',
      )),
      capability('late-stable-scan-final-count', SUPPORTED, completionEvidence(
        TELEMETRY_COMPLETION_UNITS,
        'NONE',
      )),
      capability('language-singleton-multiple-candidates', NEEDS_CONFIRMATION, {
        expectedReasonCode: 'NO_DISCRIMINATOR',
      }),
      capability('papers-status-published-vs-submitted-accepted', NEEDS_CONFIRMATION, {
        expectedReasonCode: 'LOW_SCORE',
        forbiddenCanonicalMappings: Object.freeze(['submitted', 'accepted']),
      }),
      capability('legal-declaration-checkbox', UNSUPPORTED_SAFE, {
        expectedReasonCode: 'LEGAL_ACKNOWLEDGEMENT_REQUIRES_USER',
      }),
      capability('unknown-upload-material', UNSUPPORTED_SAFE, {
        expectedReasonCode: 'UPLOAD_REQUIRES_AUTHORIZATION',
      }),
    ],
  }),
  matrixCase({
    id: 'jqx-compound',
    framework: 'JQX structural equivalent',
    pageType: 'compound-application',
    fixture: {
      source: 'tests/fixtures/phase3-5-matrix.html#case-jqx-compound',
      availability: 'EXISTING_BROWSER_FIXTURE',
    },
    controls: ['native-value', 'jqx', 'compound-picker'],
    repeatables: [repeatable('jqx-zero-row-recovery', 'region-local')],
    safetyFeatures: ['jqx-no-arrow-value-write', 'jqx-cross-widget-overlay'],
    expectedSections: { page: ['basic'], embedded: ['practice'] },
    expectedPaths: [
      'basic.gender',
      'education[].major',
      'practice[].startDate',
      'practice[].endDate',
      'practice[].location',
      'practice[].description',
    ],
    capabilities: [
      capability('jqx-arrow-owned-dropdown'),
      capability('jqx-hidden-option-refresh'),
      capability('jqx-zero-row-first-row-rebind'),
    ],
  }),
  matrixCase({
    id: 'native-html-form',
    framework: 'Native HTML',
    pageType: 'single-page-form',
    fixture: {
      source: 'tests/fixtures/phase3-5-matrix.html#case-native-html-form',
      availability: 'EXISTING_BROWSER_FIXTURE',
    },
    controls: [
      'native-value',
      'native-select',
      'radio',
      'checkbox',
      'native-date-month',
      'file-field',
    ],
    repeatables: [],
    safetyFeatures: ['native-submit', 'native-reset', 'unknown-native-file'],
    expectedSections: { page: ['basic'], embedded: [] },
    expectedPaths: [
      'basic.name',
      'basic.gender',
      'basic.birthday',
      'contact.archiveRegion',
      'contact.address',
      'application.disciplinaryHistory',
      'application.personalStatement',
      'application.notes',
    ],
    capabilities: [
      capability('native-input-textarea-number'),
      capability('native-select-radio-checkbox'),
      capability('native-date-and-month-readback'),
      capability('native-file-authorization-boundary'),
    ],
  }),
  matrixCase({
    id: 'modern-ant-design',
    framework: 'Modern Ant Design structural equivalent',
    pageType: 'dynamic-overlay-form',
    fixture: {
      source: 'tests/fixtures/phase3-5-matrix.html#case-modern-ant-design',
      availability: 'EXISTING_BROWSER_FIXTURE',
    },
    controls: ['native-value', 'ant-select', 'modern-ant-date-picker', 'cascader'],
    repeatables: [],
    safetyFeatures: ['modern-ant-stale-portal', 'modern-ant-cross-control-overlay'],
    expectedSections: { page: ['education'], embedded: [] },
    expectedPaths: [
      'education[].enrollmentDate',
      'education[].graduationDate',
      'education[].major',
    ],
    capabilities: [
      capability('modern-ant-picker-mode-transition'),
      capability('modern-ant-replacement-overlay-owner'),
      capability('modern-ant-cascader-level-refresh'),
    ],
  }),
  matrixCase({
    id: 'element-plus',
    framework: 'Element Plus structural equivalent',
    pageType: 'framework-form',
    fixture: {
      source: 'tests/fixtures/phase3-5-matrix.html#case-element-plus',
      availability: 'EXISTING_BROWSER_FIXTURE',
    },
    controls: ['native-value', 'element-select', 'element-date-picker', 'element-cascader'],
    repeatables: [],
    safetyFeatures: ['element-teleport-overlay'],
    expectedSections: { page: ['education'], embedded: [] },
    expectedPaths: [
      'education[].school',
      'education[].major',
      'education[].enrollmentDate',
      'education[].graduationDate',
    ],
    capabilities: [
      capability('element-form-item-label-ownership'),
      capability('element-select-teleport-owner'),
      capability('element-date-and-cascader-readback'),
    ],
  }),
  matrixCase({
    id: 'aria-generic',
    framework: 'ARIA Generic',
    pageType: 'portal-combobox-form',
    fixture: {
      source: 'tests/fixtures/phase3-5-matrix.html#case-aria-generic',
      availability: 'EXISTING_BROWSER_FIXTURE',
    },
    controls: ['native-value', 'aria-select'],
    repeatables: [],
    safetyFeatures: ['aria-noise-listbox', 'aria-ambiguous-controls-owner'],
    expectedSections: { page: ['basic'], embedded: [] },
    expectedPaths: ['basic.ethnicity', 'basic.political'],
    capabilities: [
      capability('aria-controls-owned-listbox'),
      capability('aria-async-option-refresh'),
      capability('aria-ambiguous-listbox', NEEDS_CONFIRMATION, {
        expectedReasonCode: 'AMBIGUOUS_OVERLAY_OWNER',
      }),
    ],
  }),
  matrixCase({
    id: 'react-select',
    framework: 'React Select structural equivalent',
    pageType: 'portal-combobox-form',
    fixture: {
      source: 'tests/fixtures/phase3-5-matrix.html#case-react-select',
      availability: 'EXISTING_BROWSER_FIXTURE',
    },
    controls: ['native-value', 'react-select'],
    repeatables: [],
    safetyFeatures: ['react-select-portal-isolation'],
    expectedSections: { page: ['basic'], embedded: [] },
    expectedPaths: ['basic.ethnicity', 'basic.political'],
    capabilities: [
      capability('react-select-portal-owner'),
      capability('react-select-dynamic-option-list'),
      capability('react-select-second-run-idempotency'),
    ],
  }),
  matrixCase({
    id: 'wizard-step-application',
    framework: 'Wizard / Step structural equivalent',
    pageType: 'multi-step-application',
    fixture: {
      source: 'tests/fixtures/wizard/index.html',
      availability: 'EXISTING_BROWSER_FIXTURE',
    },
    controls: ['native-value', 'native-select', 'radio', 'native-date-month', 'file-field'],
    repeatables: [repeatable('wizard-section-row-growth')],
    safetyFeatures: [
      'unsafe-next',
      'continue',
      'wizard-submit',
      'viewer-previous',
      'viewer-next',
    ],
    expectedSections: {
      page: ['basic', 'education', 'papers', 'materials'],
      embedded: [],
    },
    expectedPaths: [
      'basic.name',
      'basic.gender',
      'education[].school',
      'papers[].title',
    ],
    capabilities: [
      capability('wizard-verified-safe-progression'),
      capability('wizard-final-submit-never-clicked'),
      capability('wizard-file-authorization-per-run'),
      capability('wizard-second-run-does-not-delete'),
    ],
  }),
]);
