import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Resolver = require('../../src/core/current-section-resolver.js');
const Autofill = require('../../src/core/autofill-engine.js');
const GenericAdapter = require('../../src/adapters/generic-adapter.js');

function candidate(sectionId, source, confidence, authority, overrides = {}) {
  return {
    sectionId,
    source,
    confidence,
    scope: 'current-page',
    evidence: [`${source}:${sectionId}`],
    authority,
    accepted: true,
    ...overrides,
  };
}

function selectedSection(arbitration) {
  return arbitration?.selected?.sectionId || null;
}

function assertSelected(arbitration, sectionId, source) {
  assert.equal(arbitration?.reasonCode, 'SECTION_SELECTED');
  assert.equal(selectedSection(arbitration), sectionId);
  assert.equal(arbitration?.selected?.source, source);
  assert.ok(Array.isArray(arbitration?.candidates));
  assert.ok(Array.isArray(arbitration?.rejected));
}

test('Arbitration Case 1: current-page adapter basic 1.0 胜过 field-signature language 0.812', () => {
  const arbitration = Resolver.resolveFinalSection([
    candidate('language', 'field-signature', 0.812, 200, {
      scope: 'page-owned',
      evidence: ['外语成绩', '等级'],
    }),
    candidate('basic', 'adapter', 1, 400, {
      evidence: ['adapter-current-page'],
    }),
  ]);

  assertSelected(arbitration, 'basic', 'adapter');
  assert.ok(arbitration.rejected.some(item =>
    item.sectionId === 'language'
    && item.source === 'field-signature'
    && item.reason === 'LOWER_AUTHORITY'
  ));
});

test('Arbitration Case 2: verified active navigation education 0.99 胜过 weak adapter basic 0.55', () => {
  const arbitration = Resolver.resolveFinalSection([
    candidate('basic', 'adapter', 0.55, 100, {
      scope: 'fallback',
      evidence: ['generic-adapter-fallback'],
    }),
    candidate('education', 'navigation', 0.99, 400, {
      evidence: ['verified-active-navigation'],
    }),
  ]);

  assertSelected(arbitration, 'education', 'navigation');
});

test('Arbitration Case 3: strong heading papers 0.95 胜过 weak field signature basic 0.65', () => {
  const arbitration = Resolver.resolveFinalSection([
    candidate('basic', 'field-signature', 0.65, 100, {
      scope: 'page-owned',
      evidence: ['weak-basic-signature'],
    }),
    candidate('papers', 'heading', 0.95, 300, {
      evidence: ['论文成果'],
    }),
  ]);

  assertSelected(arbitration, 'papers', 'heading');
});

test('Arbitration Case 4: 两个同 authority 强 source 接近时返回 AMBIGUOUS_SECTION，不能由数组顺序决定', () => {
  const firstOrder = [
    candidate('education', 'navigation', 0.97, 400, {
      evidence: ['verified-active-navigation'],
    }),
    candidate('basic', 'adapter', 0.95, 400, {
      evidence: ['explicit-current-page-adapter'],
    }),
  ];

  for (const candidates of [firstOrder, firstOrder.slice().reverse()]) {
    const arbitration = Resolver.resolveFinalSection(candidates);
    assert.equal(arbitration?.reasonCode, 'AMBIGUOUS_SECTION');
    assert.equal(arbitration?.selected, null);
    assert.ok(Array.isArray(arbitration?.candidates));
    assert.equal(arbitration.candidates.length, 2);
  }
});

function assertMetadataOnly(value) {
  const forbidden = new Set([
    'value', 'values', 'currentValue', 'beforeValue', 'afterValue',
    'element', 'elements', 'interactionElement', 'document', 'resume',
  ]);
  const visit = item => {
    if (!item || typeof item !== 'object') return;
    if (Array.isArray(item)) {
      item.forEach(visit);
      return;
    }
    Object.entries(item).forEach(([key, child]) => {
      assert.equal(forbidden.has(key), false, `arbitration 不得输出私有/DOM 键：${key}`);
      visit(child);
    });
  };
  visit(value);
}

test('Resolver context: arbitration 透传统一 winner/rejected，且候选输出保持 metadata-only', () => {
  const arbitration = Resolver.resolveFinalSection([
    candidate('language', 'field-signature', 0.812, 200, {
      scope: 'page-owned',
      evidence: ['外语成绩', '等级'],
      value: 'PRIVATE-RESUME-VALUE',
      element: { outerHTML: '<input value="PRIVATE-RESUME-VALUE">' },
    }),
    candidate('basic', 'adapter', 1, 400, {
      evidence: ['adapter-current-page'],
      value: 'PRIVATE-BASIC-VALUE',
    }),
  ]);
  assertMetadataOnly(arbitration);
  assert.doesNotMatch(JSON.stringify(arbitration), /PRIVATE-(?:RESUME|BASIC)-VALUE/);

  const resolved = Resolver.resolve({
    fields: [
      { labelText: '外语成绩', visible: true, hidden: false },
      { labelText: '等级', visible: true, hidden: false },
    ],
    embeddedRegions: [],
    adapterContext: {
      section: 'basic',
      score: 1,
      scope: 'current-page',
      authority: 400,
    },
  });
  assert.equal(resolved.sectionId, 'basic');
  assert.equal(resolved.arbitration.selected.sectionId, 'basic');
  assert.equal(resolved.arbitration.reasonCode, 'SECTION_SELECTED');
  assertMetadataOnly(resolved.arbitration);
});

test('Diagnosis: sectionDetection.arbitration 原样保留 metadata-only winner/rejected', () => {
  const arbitration = Resolver.resolveFinalSection([
    candidate('language', 'field-signature', 0.812, 200, {
      scope: 'page-owned',
      evidence: ['外语成绩'],
    }),
    candidate('basic', 'adapter', 1, 400, {
      evidence: ['adapter-current-page'],
    }),
  ]);
  const harness = {
    document: { querySelectorAll() { return []; } },
    lastInspection: {
      scanId: 'scan:section-arbitration-diagnosis',
      sectionContext: {
        sectionId: 'basic',
        source: 'adapter',
        confidence: 1,
        collection: 'basic',
        collectionMode: 'record',
        trace: [],
        arbitration,
      },
    },
    adapter: {
      diagnose() {
        return { section: { detected: 'basic' }, fields: [], embeddedSections: [] };
      },
    },
    progressionState: { blocked: false, blockers: [] },
    task: null,
    scanId: 'scan:section-arbitration-diagnosis',
    resume: {},
    resumeView: {},
  };

  const diagnosis = Autofill.AutofillEngine.prototype.diagnoseCurrent.call(harness);
  assert.deepEqual(diagnosis.sectionDetection.arbitration, arbitration);
  assert.equal(diagnosis.sectionDetection.arbitration.selected.sectionId, 'basic');
  assertMetadataOnly(diagnosis.sectionDetection.arbitration);
});

test('AMBIGUOUS_SECTION: GenericAdapter 与 Engine legacy section 都不得回退 detected adapter', () => {
  const arbitration = Resolver.resolveFinalSection([
    candidate('education', 'navigation', 0.97, 400),
    candidate('basic', 'adapter', 0.95, 400),
  ]);
  assert.equal(arbitration.reasonCode, 'AMBIGUOUS_SECTION');

  const sectionContext = {
    sectionId: null,
    source: 'unknown',
    confidence: 0,
    collection: null,
    collectionMode: 'unknown',
    trace: [],
    arbitration,
  };
  const document = {
    title: '基本信息',
    querySelectorAll() { return []; },
  };
  const navigation = {
    scan() {
      return [{
        sectionId: 'basic',
        label: '基本信息',
        confidence: 1,
        active: true,
        safe: true,
      }];
    },
    scanDetailed() { return { items: this.scan(), candidates: [] }; },
  };
  const generic = GenericAdapter.createAdapter(document, { navigationEngine: navigation });
  const adapterDiagnosis = generic.diagnose({
    resume: {},
    resumeView: {},
    sectionContext,
    embeddedSections: [],
  });
  assert.equal(adapterDiagnosis.section.detected, null);
  assert.equal(adapterDiagnosis.section.score, 0);
  assert.equal(adapterDiagnosis.section.source, 'unknown');

  const harness = {
    document,
    lastInspection: { scanId: 'scan:ambiguous', sectionContext },
    adapter: {
      diagnose() {
        return {
          section: { detected: 'basic', source: 'adapter', confidence: 1, score: 1 },
          fields: [],
          embeddedSections: [],
        };
      },
    },
    progressionState: { blocked: false, blockers: [] },
    currentSectionRunIds: new Map(),
    scanId: 'scan:ambiguous',
    resume: {},
    resumeView: {},
  };
  const engineDiagnosis = Autofill.AutofillEngine.prototype.diagnoseCurrent.call(harness);
  assert.equal(engineDiagnosis.section.detected, null);
  assert.equal(engineDiagnosis.section.confidence, 0);
  assert.equal(engineDiagnosis.section.source, 'unknown');
  assert.equal(engineDiagnosis.sectionDetection.final, null);
  assert.equal(engineDiagnosis.sectionDetection.arbitration.reasonCode, 'AMBIGUOUS_SECTION');
});
