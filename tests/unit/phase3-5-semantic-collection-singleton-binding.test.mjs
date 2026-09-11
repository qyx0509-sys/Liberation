import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Matcher = require('../../src/core/field-matcher.js');
const GenericAdapter = require('../../src/adapters/generic-adapter.js');

function context(collection = 'basic', collectionMode = 'record', index = null) {
  return {
    section: collection,
    sectionId: collection,
    collection,
    collectionMode,
    source: 'phase3-5-semantic-collection-fixture',
    confidence: 1,
    regionId: collection === 'basic' ? 'page:basic' : `${collection}:fixture`,
    index: Number.isInteger(index) ? index : null,
    indexContext: Number.isInteger(index)
      ? { section: collection, collection, index, [collection]: index }
      : null,
  };
}

function domNode(tagName, attributes = {}) {
  const node = {
    nodeType: 1,
    tagName: String(tagName).toUpperCase(),
    parentElement: null,
    children: [],
    append(child) {
      child.parentElement = this;
      this.children.push(child);
      return child;
    },
    contains(candidate) {
      for (let current = candidate; current; current = current.parentElement) {
        if (current === this) return true;
      }
      return false;
    },
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(attributes, name)
        ? String(attributes[name])
        : null;
    },
    closest(selector) {
      for (let current = this; current; current = current.parentElement) {
        if (String(selector).includes('tr') && current.tagName === 'TR') return current;
        if (
          String(selector).includes('[role="row"]')
          && current.getAttribute?.('role') === 'row'
        ) return current;
        for (const attribute of [
          'data-singleton-slot',
          'data-singleton-slot-id',
          'data-repeat-item',
          'data-repeat-row',
          'data-array-item',
          'data-array-row',
        ]) {
          if (
            String(selector).includes(`[${attribute}]`)
            && current.getAttribute?.(attribute) !== null
          ) return current;
        }
      }
      return null;
    },
  };
  return node;
}

function descriptor(labelText, owner, settings = {}) {
  const groupElement = domNode('div', { class: 'ant-form-item' });
  const element = domNode('input');
  owner.append(groupElement);
  groupElement.append(element);
  const fieldContext = settings.context || context('basic');
  return {
    detectorId: settings.detectorId || `semantic-${labelText}`,
    element,
    interactionElement: element,
    groupElement,
    visible: true,
    hidden: false,
    disabled: false,
    readOnly: false,
    sensitive: false,
    maskedDisplay: false,
    labelText,
    tableHeader: settings.tableHeader || '',
    ariaLabel: '',
    semanticPlaceholder: settings.semanticPlaceholder || '',
    placeholder: '',
    name: '',
    id: '',
    title: '',
    groupText: '',
    nearbyText: '',
    parentText: '',
    controlKind: settings.controlKind || 'text',
    baseControlKind: settings.controlKind || 'text',
    context: fieldContext,
  };
}

const educationResume = {
  education: [{
    school: 'Example University',
    college: 'Example College',
    major: 'Example Major',
    enrollmentDate: '2020-09',
    graduationDate: '2024-06',
    majorRankTotal: '100',
    majorRank: '2',
    gpa: '3.8',
  }],
};

function educationDescriptors(owner, suffix = '') {
  return [
    descriptor('本科学校', owner, { detectorId: `education-school${suffix}` }),
    descriptor('本科院系', owner, { detectorId: `education-college${suffix}` }),
    descriptor('本科专业', owner, { detectorId: `education-major${suffix}` }),
    descriptor('入学时间', owner, { detectorId: `education-enrollment${suffix}` }),
    descriptor('毕业时间', owner, { detectorId: `education-graduation${suffix}` }),
    descriptor('申请人所在专业总人数', owner, {
      detectorId: `education-rank-total${suffix}`,
      controlKind: 'number',
      // Isolates singleton inference from the pre-existing major/majorRankTotal
      // candidate margin; the real page exposes the same semantic placeholder.
      semanticPlaceholder: '专业总人数',
    }),
    descriptor('申请人专业排名', owner, {
      detectorId: `education-rank${suffix}`,
      controlKind: 'number',
    }),
  ];
}

function nestedPlainOwner(root, id) {
  const row = domNode('div', { class: `ant-row ${id}-row` });
  const column = domNode('div', { class: `ant-col ${id}-column` });
  const wrapper = domNode('div', { class: `${id}-wrapper` });
  root.append(row);
  row.append(column);
  column.append(wrapper);
  return wrapper;
}

function scatteredEducationDescriptors(root) {
  const definitions = [
    ['本科学校', 'education-school-scattered', 'text', ''],
    ['本科院系', 'education-college-scattered', 'text', ''],
    ['本科专业', 'education-major-scattered', 'text', ''],
    ['入学时间', 'education-enrollment-scattered', 'text', ''],
    ['毕业时间', 'education-graduation-scattered', 'text', ''],
    ['申请人所在专业总人数', 'education-rank-total-scattered', 'number', '专业总人数'],
    ['申请人专业排名', 'education-rank-scattered', 'number', ''],
  ];
  return definitions.map(([label, detectorId, controlKind, semanticPlaceholder], index) =>
    descriptor(label, nestedPlainOwner(root, `education-${index}`), {
      detectorId,
      controlKind,
      semanticPlaceholder,
    })
  );
}

test('semanticCollectionFromPath separates semantic data collection from structural context', () => {
  assert.equal(typeof Matcher.semanticCollectionFromPath, 'function');
  assert.equal(Matcher.semanticCollectionFromPath('education[].school'), 'education');
  assert.equal(Matcher.semanticCollectionFromPath('education[3].school'), 'education');
  assert.equal(Matcher.semanticCollectionFromPath('basic.name'), 'basic');
  assert.equal(Matcher.semanticCollectionFromPath('contact.phone'), 'contact');
  assert.equal(Matcher.semanticCollectionFromPath('education[abc].school'), '');
  assert.equal(Matcher.semanticCollectionFromPath(''), '');
});

test('seven inline education leaves in structural basic form one semantic slot', () => {
  const educationBlock = domNode('div', { 'data-form-block': 'education' });
  const descriptors = educationDescriptors(educationBlock);
  const matches = Matcher.matchFields(descriptors, educationResume, { section: 'basic' });
  const expectedPaths = [
    'education[].college',
    'education[].enrollmentDate',
    'education[].graduationDate',
    'education[].major',
    'education[].majorRank',
    'education[].majorRankTotal',
    'education[].school',
  ];

  assert.equal(matches.length, 7);
  for (const match of matches) {
    assert.equal(match.descriptor.context.collection, 'basic');
    assert.equal(match.status, 'MATCHED', `${match.matchedPath}: ${match.reason}`);
    assert.equal(match.singletonBindingDebug?.collection, 'education');
    assert.deepEqual(match.singletonBindingDebug?.structuralCollections, ['basic']);
    assert.equal(match.singletonBindingDebug?.semanticDescriptorCount, 7);
    assert.deepEqual(match.singletonBindingDebug?.descriptorPaths, expectedPaths);
    assert.equal(match.singletonBindingDebug?.inlineCandidateClusterCount, 1);
    assert.equal(match.singletonBindingDebug?.pageSlotCount, 1);
    assert.deepEqual(match.singletonBindingDebug?.candidateIndexes, [0]);
    assert.equal(match.singletonBindingDebug?.selectedIndex, 0);
    assert.equal(match.singletonBindingDebug?.reasonCode, 'SINGLETON_SINGLE_JSON_ITEM');
    assert.deepEqual(match.singletonBindingDebug?.slotSources, [{
      kind: 'inline-group-parent',
      descriptorCount: 7,
      pathCount: 7,
    }]);
  }
});

test('scattered Ant row/col/wrapper education leaves use one conservative semantic region slot', () => {
  const broadForm = domNode('form');
  const education = scatteredEducationDescriptors(broadForm);
  const name = descriptor('姓名', nestedPlainOwner(broadForm, 'basic-name'), {
    detectorId: 'interleaved-basic-name',
  });
  const descriptors = [
    education[0],
    name,
    education[1],
    education[2],
    education[3],
    education[4],
    education[5],
    education[6],
  ];
  const matches = Matcher.matchFields(descriptors, {
    basic: { name: 'Example Name' },
    ...educationResume,
  }, { section: 'basic' });
  const semanticMatches = matches.filter(match => match.matchedPath?.startsWith('education[].'));

  assert.equal(semanticMatches.length, 7, matches.map(match => `${match.status}:${match.matchedPath || ''}`).join('|'));
  assert.equal(matches.find(match => match.matchedPath === 'basic.name')?.status, 'MATCHED');
  for (const match of semanticMatches) {
    assert.equal(match.status, 'MATCHED', `${match.matchedPath}: ${match.reason}`);
    assert.equal(match.singletonBindingDebug?.pageSlotCount, 1);
    assert.equal(match.singletonBindingDebug?.selectedIndex, 0);
    assert.deepEqual(match.singletonBindingDebug?.slotSources, [{
      kind: 'semantic-region-singleton',
      descriptorCount: 7,
      pathCount: 7,
    }]);
  }

  const [diagnostic] = GenericAdapter.attachFieldMatchDiagnostics([
    { detectorId: semanticMatches[0].descriptor.detectorId },
  ], [semanticMatches[0]]);
  assert.deepEqual(diagnostic.singletonBindingDebug?.slotSources, [{
    kind: 'semantic-region-singleton',
    descriptorCount: 7,
    pathCount: 7,
  }]);
});

test('semantic region singleton also supports a page-mode language block with unique strong leaves', () => {
  const broadForm = domNode('form');
  const pageContext = context('basic', 'page');
  const matches = Matcher.matchFields([
    descriptor('外语类型', nestedPlainOwner(broadForm, 'page-language-type'), {
      detectorId: 'page-language-type',
      controlKind: 'custom-select',
      context: pageContext,
    }),
    descriptor('外语成绩', nestedPlainOwner(broadForm, 'page-language-score'), {
      detectorId: 'page-language-score',
      context: pageContext,
    }),
  ], {
    language: [{ language: 'English', score: '600' }],
  }, { section: 'basic' });

  for (const match of matches) {
    assert.equal(match.status, 'MATCHED', `${match.matchedPath}: ${match.reason}`);
    assert.equal(match.singletonBindingDebug?.collection, 'language');
    assert.equal(match.singletonBindingDebug?.pageSlotCount, 1);
    assert.equal(match.singletonBindingDebug?.slotSources?.[0]?.kind, 'semantic-region-singleton');
  }
});

test('interleaved scattered education and language leaves keep distinct semantic region singletons', () => {
  const broadForm = domNode('form');
  const pageContext = context('basic', 'page');
  const descriptors = [
    descriptor('本科学校', nestedPlainOwner(broadForm, 'interleaved-education-school'), {
      detectorId: 'interleaved-education-school',
      context: pageContext,
    }),
    descriptor('外语类型', nestedPlainOwner(broadForm, 'interleaved-language-type'), {
      detectorId: 'interleaved-language-type',
      controlKind: 'custom-select',
      context: pageContext,
    }),
    descriptor('本科专业', nestedPlainOwner(broadForm, 'interleaved-education-major'), {
      detectorId: 'interleaved-education-major',
      context: pageContext,
    }),
    descriptor('外语成绩', nestedPlainOwner(broadForm, 'interleaved-language-score'), {
      detectorId: 'interleaved-language-score',
      context: pageContext,
    }),
  ];
  const matches = Matcher.matchFields(descriptors, {
    education: [{ school: 'Example University', major: 'Example Major' }],
    language: [{ language: 'English', score: '600' }],
  }, { section: 'basic' });
  const expectedPaths = new Map([
    ['interleaved-education-school', 'education[].school'],
    ['interleaved-language-type', 'language[].language'],
    ['interleaved-education-major', 'education[].major'],
    ['interleaved-language-score', 'language[].score'],
  ]);

  assert.equal(matches.length, 4);
  assert.deepEqual(
    matches.map(match => match.descriptor.detectorId),
    [...expectedPaths.keys()],
    'descriptor and DOM order must remain genuinely interleaved',
  );
  assert.deepEqual(
    [...new Set(matches.map(match => match.descriptor.context.regionId))],
    ['page:basic'],
    'both semantic collections intentionally share one broad structural region',
  );
  for (const match of matches) {
    assert.equal(match.status, 'MATCHED', `${match.matchedPath}: ${match.reason}`);
    assert.equal(match.matchedPath, expectedPaths.get(match.descriptor.detectorId));
    assert.equal(match.singletonBindingDebug?.pageSlotCount, 1);
    assert.equal(match.singletonBindingDebug?.selectedIndex, 0);
    assert.deepEqual(match.singletonBindingDebug?.slotSources, [{
      kind: 'semantic-region-singleton',
      descriptorCount: 2,
      pathCount: 2,
    }]);
  }

  const educationMatches = matches.filter(match => match.matchedPath.startsWith('education[].'));
  const languageMatches = matches.filter(match => match.matchedPath.startsWith('language[].'));
  assert.equal(educationMatches.length, 2);
  assert.equal(languageMatches.length, 2);
  assert.equal(educationMatches.every(match => match.singletonBindingDebug?.collection === 'education'), true);
  assert.equal(languageMatches.every(match => match.singletonBindingDebug?.collection === 'language'), true);
  assert.notEqual(
    educationMatches[0].singletonBindingDebug.collection,
    languageMatches[0].singletonBindingDebug.collection,
    'singletonBindingDebug collection is the metadata-only semantic region identity',
  );
});

test('semantic region fallback rejects a single leaf and never replaces an explicit array index', () => {
  const singleForm = domNode('form');
  const single = Matcher.matchFields([
    descriptor('本科学校', nestedPlainOwner(singleForm, 'single-school'), {
      detectorId: 'single-semantic-leaf',
    }),
  ], educationResume, { section: 'basic' });
  assert.equal(single[0].status, 'NEEDS_CONFIRMATION', `${single[0].status}:${single[0].matchedPath || ''}:${single[0].reason}`);
  assert.equal(single[0].singletonBindingDebug?.pageSlotCount, 0);
  assert.equal(single[0].singletonBindingDebug?.selectedIndex, null);

  const indexedForm = domNode('form');
  const indexedContext = {
    ...context('basic'),
    indexContext: {
      section: 'education',
      collection: 'education',
      index: 0,
      education: 0,
    },
  };
  const indexed = Matcher.matchFields([
    descriptor('本科学校', nestedPlainOwner(indexedForm, 'indexed-school'), {
      detectorId: 'explicit-index-school',
      context: indexedContext,
    }),
    descriptor('本科专业', nestedPlainOwner(indexedForm, 'indexed-major'), {
      detectorId: 'explicit-index-major',
      context: indexedContext,
    }),
  ], educationResume, { section: 'basic' });
  for (const match of indexed) {
    assert.equal(
      Boolean(match.singletonBindingDebug?.slotSources?.some(item => item.kind === 'semantic-region-singleton')),
      false,
      `${match.status}:${match.matchedPath || ''}:${match.reason}`,
    );
  }

  const splitRegionForm = domNode('form');
  const splitRegionMatches = Matcher.matchFields([
    descriptor('本科学校', nestedPlainOwner(splitRegionForm, 'split-school'), {
      detectorId: 'split-region-school',
      context: { ...context('basic'), regionId: 'page:basic:one' },
    }),
    descriptor('本科专业', nestedPlainOwner(splitRegionForm, 'split-major'), {
      detectorId: 'split-region-major',
      context: { ...context('basic'), regionId: 'page:basic:two' },
    }),
  ], educationResume, { section: 'basic' });
  for (const match of splitRegionMatches) {
    assert.equal(match.status, 'NEEDS_CONFIRMATION', `${match.matchedPath}: ${match.reason}`);
    assert.equal(match.singletonBindingDebug?.pageSlotCount, 0);
  }
});

test('one inline language slot with two JSON items remains confirmation without discriminator', () => {
  const languageSection = domNode('section', { 'aria-label': 'language' });
  const matches = Matcher.matchFields([
    descriptor('外语类型', languageSection, {
      detectorId: 'language-type',
      controlKind: 'custom-select',
    }),
    descriptor('外语成绩', languageSection, { detectorId: 'language-score' }),
  ], {
    language: [
      { language: 'English', score: '600' },
      { language: 'Japanese', score: '160' },
    ],
  }, { section: 'basic' });

  for (const match of matches) {
    assert.equal(match.status, 'NEEDS_CONFIRMATION', match.reason);
    assert.equal(match.singletonBindingDebug?.pageSlotCount, 1);
    assert.equal(match.singletonBindingDebug?.jsonItemCount, 2);
    assert.deepEqual(match.singletonBindingDebug?.candidateIndexes, []);
    assert.equal(match.singletonBindingDebug?.selectedIndex, null);
    assert.equal(match.singletonBindingDebug?.reasonCode, 'NO_DISCRIMINATOR');
  }
});

test('embedded repeatable explicit index remains authoritative and is not an inline singleton', () => {
  const familyRow = domNode('tr');
  const familyContext = context('family', 'repeatable', 1);
  const [match] = Matcher.matchFields([
    descriptor('家庭成员姓名', familyRow, {
      detectorId: 'family-index-one',
      context: familyContext,
    }),
  ], {
    family: [{ name: 'First' }, { name: 'Second' }],
  }, {
    section: 'family',
    arrayContext: familyContext.indexContext,
  });

  assert.equal(match.status, 'MATCHED', match.reason);
  assert.equal(match.matchedPath, 'family[].name');
  assert.equal(match.value, 'Second');
  assert.equal(match.scope?.index, 1);
  assert.equal(match.singletonBindingDebug, undefined);
});

test('two independent inline education blocks prove two slots and never collapse to index zero', () => {
  const first = domNode('section', { 'aria-label': 'education-one' });
  const second = domNode('section', { 'aria-label': 'education-two' });
  const matches = Matcher.matchFields([
    descriptor('本科学校', first, { detectorId: 'first-school' }),
    descriptor('本科专业', first, { detectorId: 'first-major' }),
    descriptor('本科学校', second, { detectorId: 'second-school' }),
    descriptor('本科专业', second, { detectorId: 'second-major' }),
  ], educationResume, { section: 'basic' });

  for (const match of matches) {
    assert.equal(match.status, 'NEEDS_CONFIRMATION', match.reason);
    assert.equal(match.singletonBindingDebug?.semanticDescriptorCount, 4);
    assert.equal(match.singletonBindingDebug?.inlineCandidateClusterCount, 2);
    assert.equal(match.singletonBindingDebug?.pageSlotCount, 2);
    assert.equal(match.singletonBindingDebug?.selectedIndex, null);
    assert.equal(match.singletonBindingDebug?.reasonCode, 'PAGE_SLOT_COUNT_NOT_SINGLETON');
  }
});

test('broad FORM owner remains untrusted even when semantic paths are unique', () => {
  const broadForm = domNode('form');
  const matches = Matcher.matchFields([
    descriptor('本科学校', broadForm, { detectorId: 'broad-school' }),
    descriptor('本科专业', broadForm, { detectorId: 'broad-major' }),
  ], educationResume, { section: 'basic' });

  for (const match of matches) {
    assert.equal(match.status, 'NEEDS_CONFIRMATION', match.reason);
    assert.equal(match.singletonBindingDebug?.pageSlotCount, 0);
    assert.equal(match.singletonBindingDebug?.selectedIndex, null);
  }
});

test('duplicate canonical paths in one inline root are ambiguous rather than one slot', () => {
  const ambiguousSection = domNode('section', { 'aria-label': 'ambiguous-education' });
  const matches = Matcher.matchFields([
    descriptor('本科学校', ambiguousSection, { detectorId: 'duplicate-school-one' }),
    descriptor('本科学校', ambiguousSection, { detectorId: 'duplicate-school-two' }),
  ], educationResume, { section: 'basic' });

  for (const match of matches) {
    assert.equal(match.status, 'NEEDS_CONFIRMATION', match.reason);
    assert.equal(match.singletonBindingDebug?.inlineCandidateClusterCount, 0);
    assert.equal(match.singletonBindingDebug?.pageSlotCount, 0);
    assert.equal(match.singletonBindingDebug?.selectedIndex, null);
  }
});

test('singleton diagnostic exposes only bounded aggregate structural metadata', () => {
  const educationSection = domNode('div', { 'data-form-block': 'education' });
  const [match] = Matcher.matchFields(
    educationDescriptors(educationSection),
    educationResume,
    { section: 'basic' },
  );
  const [diagnostic] = GenericAdapter.attachFieldMatchDiagnostics([
    { detectorId: match.descriptor.detectorId, labelText: '本科学校' },
  ], [{
    ...match,
    singletonBindingDebug: {
      ...match.singletonBindingDebug,
      value: 'PRIVATE_VALUE',
      currentValue: 'PRIVATE_CURRENT_VALUE',
      element: match.descriptor.element,
      slotSources: [
        ...match.singletonBindingDebug.slotSources,
        { kind: 'untrusted-kind', descriptorCount: 9999, rootId: 'PRIVATE_ROOT_ID' },
      ],
    },
  }]);

  assert.deepEqual(diagnostic.singletonBindingDebug.structuralCollections, ['basic']);
  assert.equal(diagnostic.singletonBindingDebug.semanticDescriptorCount, 7);
  assert.equal(diagnostic.singletonBindingDebug.inlineCandidateClusterCount, 1);
  assert.deepEqual(diagnostic.singletonBindingDebug.slotSources, [{
    kind: 'inline-group-parent',
    descriptorCount: 7,
    pathCount: 7,
  }]);
  assert.doesNotMatch(
    JSON.stringify(diagnostic.singletonBindingDebug),
    /PRIVATE_VALUE|PRIVATE_CURRENT_VALUE|PRIVATE_ROOT_ID|nodeType/,
  );
});

test('GPA exact and strict annotated base labels resolve without admitting suffix lookalikes', () => {
  const owner = domNode('section');
  for (const label of [
    '本科GPA',
    '本科 GPA',
    '本科GPA（绩点/满绩，示例：3.5/4）',
    '本科GPA(示例3.5/4)',
  ]) {
    const match = Matcher.matchField(descriptor(label, owner, {
      detectorId: `gpa-${label}`,
    }), educationResume, { section: 'basic' });
    assert.equal(match.status, 'MATCHED', `${label}: ${match.reason}`);
    assert.equal(match.matchedPath, 'education[].gpa', label);
  }

  const gpaScale = Matcher.matchField(descriptor('绩点满分', owner, {
    detectorId: 'gpa-scale',
  }), { education: [{ gpa: '3.8', gpaScale: '4' }] }, { section: 'basic' });
  assert.equal(gpaScale.status, 'MATCHED', gpaScale.reason);
  assert.equal(gpaScale.matchedPath, 'education[].gpaScale');

  for (const label of ['本科GPA排名', '本科GPA排名（示例：第2名）', '满绩']) {
    const notGpa = Matcher.matchField(
      descriptor(label, owner, { detectorId: `not-gpa-${label}` }),
      { education: [{ gpa: '3.8', gpaScale: '4' }] },
      { section: 'basic' },
    );
    assert.notEqual(
      notGpa.status === 'MATCHED' && notGpa.matchedPath === 'education[].gpa',
      true,
      `${label}:${notGpa.status}:${notGpa.matchedPath || ''}:${notGpa.reason || ''}`,
    );
  }
});
