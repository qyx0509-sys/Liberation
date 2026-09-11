import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const Fields = require('../../src/mappings/field-aliases.js');
const Matcher = require('../../src/core/field-matcher.js');
const FileFields = require('../../src/mappings/file-field-aliases.js');

function awardsContext() {
  return {
    sectionId: 'awards',
    collection: 'awards',
    collectionMode: 'repeatable',
    source: 'award-category-semantic-test',
    confidence: 1,
    indexContext: { section: 'awards', collection: 'awards', index: 0, awards: 0 },
  };
}

function basicContext() {
  return {
    sectionId: 'basic',
    collection: 'basic',
    collectionMode: 'record',
    source: 'award-category-semantic-test',
    confidence: 1,
    indexContext: null,
  };
}

function patentsContext() {
  return {
    sectionId: 'patents',
    collection: 'patents',
    collectionMode: 'repeatable',
    source: 'award-category-semantic-test',
    confidence: 1,
    indexContext: { section: 'patents', collection: 'patents', index: 0, patents: 0 },
  };
}

function descriptor(labelText, context = null) {
  return {
    detectorId: `award-category-${labelText}`,
    element: {},
    visible: true,
    hidden: false,
    disabled: false,
    readOnly: false,
    sensitive: false,
    maskedDisplay: false,
    labelText,
    tableHeader: '',
    ariaLabel: '',
    semanticPlaceholder: '',
    placeholder: '',
    name: '',
    id: '',
    title: '',
    groupText: '',
    nearbyText: '',
    parentText: '',
    controlKind: 'native-select',
    baseControlKind: 'native-select',
    ...(context ? { context } : {}),
  };
}

const award = {
  category: '荣誉称号',
  level: '校级',
  rank: '一等奖',
  participationMode: '个人',
};

test('awards category is a distinct canonical choice field with one section-scoped short alias', () => {
  const definition = Fields.FIELD_DEFINITIONS.find(item => item.path === 'awards[].category');
  assert.ok(definition);
  assert.equal(definition.type, 'choice');
  assert.deepEqual(
    [...definition.aliases],
    ['奖励类别', '奖项类别', '荣誉类别', '奖学金类别'],
  );
  assert.deepEqual([...definition.sectionAliases], ['类别']);

  for (const path of ['awards[].level', 'awards[].rank', 'awards[].participationMode']) {
    assert.notEqual(definition.path, path);
    assert.ok(Fields.FIELD_DEFINITIONS.some(item => item.path === path));
  }
});

test('award category normalization prefers canonical data and accepts explicit legacy category keys', () => {
  const canonical = Fields.buildResumeView({
    awards: [{ ...award, award_category: '不应覆盖' }],
  }).awards[0];
  assert.deepEqual(
    {
      category: canonical.category,
      level: canonical.level,
      rank: canonical.rank,
      participationMode: canonical.participationMode,
    },
    award,
  );

  const legacy = Fields.buildResumeView({
    awards: [{ award_category: '奖学金', level: '国家级', rank: '二等奖', participation_mode: '团队' }],
  }).awards[0];
  assert.equal(legacy.category, '奖学金');
  assert.equal(legacy.level, '国家级');
  assert.equal(legacy.rank, '二等奖');
  assert.equal(legacy.participationMode, '团队');
});

test('bare category label is fail-closed without context and cannot claim award category outside awards', () => {
  const resume = {
    basic: { idType: '居民身份证' },
    patents: [{ type: '发明专利' }],
    awards: [award],
  };

  const unscoped = Matcher.matchField(descriptor('类别'), resume);
  assert.notEqual(unscoped.status, 'MATCHED');
  assert.notEqual(unscoped.matchedPath, 'awards[].category');

  const unscopedPatent = Matcher.matchField({
    ...descriptor('类别'),
    semanticPlaceholder: '专利类型',
  }, resume, { arrayIndex: 0 });
  assert.equal(unscopedPatent.status, 'MATCHED', unscopedPatent.reason);
  assert.equal(unscopedPatent.matchedPath, 'patents[].type');
  assert.equal(unscopedPatent.value, '发明专利');

  const basicDescriptor = {
    ...descriptor('类别', basicContext()),
    semanticPlaceholder: '证件类型',
  };
  const basicMatch = Matcher.matchField(
    basicDescriptor,
    resume,
    { section: 'basic', sectionContext: basicContext() },
  );
  assert.equal(basicMatch.status, 'MATCHED', basicMatch.reason);
  assert.equal(basicMatch.matchedPath, 'basic.idType');
  assert.notEqual(basicMatch.matchedPath, 'awards[].category');

  const patentContext = patentsContext();
  const patentDescriptor = {
    ...descriptor('类别', patentContext),
    semanticPlaceholder: '专利类型',
  };
  const patentMatch = Matcher.matchField(
    patentDescriptor,
    resume,
    {
      section: 'patents',
      sectionContext: patentContext,
      arrayContext: patentContext.indexContext,
    },
  );
  assert.equal(patentMatch.status, 'MATCHED', patentMatch.reason);
  assert.equal(patentMatch.matchedPath, 'patents[].type');
  assert.equal(patentMatch.value, '发明专利');
  assert.notEqual(patentMatch.matchedPath, 'awards[].category');
});

test('bare category label and explicit award aliases resolve only to their independent award paths', () => {
  const context = awardsContext();
  const options = {
    section: 'awards',
    sectionContext: context,
    arrayContext: context.indexContext,
  };
  const resume = { awards: [award] };
  const expected = [
    ['类别', 'awards[].category', '荣誉称号'],
    ['奖学金类别', 'awards[].category', '荣誉称号'],
    ['奖项级别', 'awards[].level', '校级'],
    ['获奖等级', 'awards[].rank', '一等奖'],
    ['参赛方式', 'awards[].participationMode', '个人'],
  ];

  for (const [label, path, value] of expected) {
    const match = Matcher.matchField(descriptor(label, context), resume, options);
    assert.equal(match.status, 'MATCHED', `${label}: ${match.reason}`);
    assert.equal(match.matchedPath, path, label);
    assert.equal(match.value, value, label);
  }
});

test('award category schema leaves the existing photo paths and photo inference untouched', () => {
  const resumeView = Fields.buildResumeView({
    basic: { photo: 'file_basic_photo' },
    files: { photo: 'file_files_photo' },
    awards: [award],
  });
  assert.equal(resumeView.basic.photo, 'file_basic_photo');
  assert.equal(resumeView.files.photo, 'file_files_photo');
  assert.deepEqual(
    [...FileFields.FILE_FIELD_ALIASES['files.photo']],
    ['证件照', '个人照片', '本人照片', '报名照片', '头像', '照片'],
  );
  assert.equal(FileFields.inferCategoryFromName('本人报名照片.jpg').path, 'files.photo');
});
