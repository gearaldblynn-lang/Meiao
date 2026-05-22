import test from 'node:test';
import assert from 'node:assert/strict';

import {
  countCompletedProjectResults,
  mergeGeneratedPlanResults,
} from './shellProjectResults.mjs';

const makeResult = (planId, status = 'completed') => ({
  id: `result-${planId}`,
  planId,
  imageUrl: status === 'completed' ? `https://example.com/${planId}.png` : '',
  prompt: planId,
  model: 'gpt-image-2',
  aspectRatio: '1:1',
  status,
  createdAt: '05-19',
  module: 'one_click',
  subFeature: 'detail_page',
});

test('mergeGeneratedPlanResults replaces only selected detail-page plans', () => {
  const existing = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'].map((planId) => makeResult(planId));
  const regeneratedLastPage = {
    ...makeResult('p7'),
    id: 'new-last-page',
    imageUrl: 'https://example.com/new-last-page.png',
  };

  const merged = mergeGeneratedPlanResults(existing, [regeneratedLastPage], ['p7']);

  assert.equal(merged.length, 7);
  assert.deepEqual(merged.map((result) => result.planId), ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7']);
  assert.equal(merged[6].id, 'new-last-page');
  assert.equal(merged[0].id, 'result-p1');
});

test('mergeGeneratedPlanResults removes stale selected results while a page is regenerating', () => {
  const existing = ['p1', 'p2', 'p3'].map((planId) => makeResult(planId));

  const merged = mergeGeneratedPlanResults(existing, [], ['p3']);

  assert.deepEqual(merged.map((result) => result.planId), ['p1', 'p2']);
});

test('mergeGeneratedPlanResults keeps multiple provider tasks generated from the same selected plan', () => {
  const existing = [makeResult('p1'), makeResult('p2')];
  const generated = [
    { ...makeResult('p1'), id: 'kie-task-a', taskId: 'kie-task-a', imageUrl: 'https://example.com/a.png' },
    { ...makeResult('p1'), id: 'kie-task-b', taskId: 'kie-task-b', imageUrl: 'https://example.com/b.png' },
  ];

  const merged = mergeGeneratedPlanResults(existing, generated, ['p1']);

  assert.deepEqual(merged.map((result) => result.id), ['kie-task-a', 'kie-task-b', 'result-p2']);
  assert.deepEqual(merged.filter((result) => result.planId === 'p1').map((result) => result.taskId), ['kie-task-a', 'kie-task-b']);
});

test('countCompletedProjectResults requires a completed media URL', () => {
  const results = [
    makeResult('p1'),
    makeResult('p2', 'generating'),
    { ...makeResult('p3'), imageUrl: '', status: 'completed' },
    { ...makeResult('p4'), imageUrl: '', videoUrl: 'https://example.com/p4.mp4', status: 'completed' },
  ];

  assert.equal(countCompletedProjectResults(results), 2);
});
