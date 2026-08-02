import assert from 'node:assert/strict';
import test from 'node:test';

import {
  formatTranslationProjectName,
  getNextTranslationProjectSequence,
  normalizeTranslationProjectNames,
} from './translationProjectPresentation.ts';

const at = (day, hour = 12) => new Date(2026, 6, day, hour, 0, 0, 0).getTime();

const project = ({
  id,
  createdAt,
  subFeature = 'detail',
  taskCount = 1,
  name = '旧名称',
  module = 'translation',
}) => ({
  id,
  name,
  module,
  subFeature,
  createdAt,
  taskCount,
  completedCount: 0,
  results: [],
});

test('formatTranslationProjectName uses the exact date sequence submode and count format', () => {
  assert.equal(formatTranslationProjectName({
    createdAt: at(31), sequence: 3, subFeature: 'detail', count: 3,
  }), '7月31日 项目3 详情出海·3张');
  assert.equal(formatTranslationProjectName({
    createdAt: at(31), sequence: 2, subFeature: 'main', count: 2,
  }), '7月31日 项目2 主图出海·2张');
  assert.equal(formatTranslationProjectName({
    createdAt: at(31), sequence: 1, subFeature: 'remove_text', count: 1,
  }), '7月31日 项目1 去文案·1张');
});

test('normalizeTranslationProjectNames numbers each day and submode independently without mutation', () => {
  const source = [
    project({ id: 'detail-new', createdAt: at(31, 15), taskCount: 3 }),
    project({ id: 'main-only', createdAt: at(31, 14), subFeature: 'main', taskCount: 2 }),
    project({ id: 'detail-old', createdAt: at(31, 9), taskCount: 1 }),
    project({ id: 'detail-prior-day', createdAt: at(30, 18), taskCount: 4 }),
    project({ id: 'other-module', createdAt: at(31, 16), module: 'retouch', name: '产品精修项目' }),
  ];

  const normalized = normalizeTranslationProjectNames(source);

  assert.deepEqual(normalized.map((item) => item.name), [
    '7月31日 项目2 详情出海·3张',
    '7月31日 项目1 主图出海·2张',
    '7月31日 项目1 详情出海·1张',
    '7月30日 项目1 详情出海·4张',
    '产品精修项目',
  ]);
  assert.deepEqual(source.map((item) => item.name), [
    '旧名称', '旧名称', '旧名称', '旧名称', '产品精修项目',
  ]);
});

test('normalizeTranslationProjectNames uses task count before result count and preserves missing-date names', () => {
  const withResults = {
    ...project({ id: 'results-fallback', createdAt: at(31), taskCount: 0 }),
    results: [{ id: 'a' }, { id: 'b' }],
  };
  const missingDate = project({ id: 'missing-date', createdAt: 0, name: '详情出海 · 5张' });

  const normalized = normalizeTranslationProjectNames([withResults, missingDate]);

  assert.equal(normalized[0].name, '7月31日 项目1 详情出海·2张');
  assert.equal(normalized[1].name, '详情出海 · 5张');
});

test('getNextTranslationProjectSequence counts only the same local day and submode', () => {
  const projects = [
    project({ id: 'detail-1', createdAt: at(31, 8) }),
    project({ id: 'detail-2', createdAt: at(31, 9) }),
    project({ id: 'main-1', createdAt: at(31, 10), subFeature: 'main' }),
    project({ id: 'previous-day', createdAt: at(30, 18) }),
  ];

  assert.equal(getNextTranslationProjectSequence(projects, {
    createdAt: at(31, 12), subFeature: 'detail',
  }), 3);
  assert.equal(getNextTranslationProjectSequence(projects, {
    createdAt: at(31, 12), subFeature: 'main',
  }), 2);
});
