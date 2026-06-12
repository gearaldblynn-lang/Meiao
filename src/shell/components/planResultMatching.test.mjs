import assert from 'node:assert/strict';
import test from 'node:test';
import { findResultsForPlanDisplay } from './planResultMatching.ts';

test('findResultsForPlanDisplay prefers direct planId matches', () => {
  const plans = [{ id: 'plan-a' }, { id: 'plan-b' }];
  const results = [
    { id: 'result-b', planId: 'plan-b', backendJobId: 'job-b' },
    { id: 'result-a', planId: 'plan-a', backendJobId: 'job-a' },
  ];

  assert.deepEqual(
    findResultsForPlanDisplay(plans, results, plans[0], 0).map((result) => result.id),
    ['result-a'],
  );
});

test('findResultsForPlanDisplay falls back to orphan media when plan ids are stale', () => {
  const plans = [{ id: 'new-plan-a' }, { id: 'new-plan-b' }];
  const results = [
    { id: 'result-a', planId: 'old-plan-a', backendJobId: 'job-a' },
    { id: 'result-b', planId: 'old-plan-b', backendJobId: 'job-b' },
  ];

  assert.deepEqual(
    findResultsForPlanDisplay(plans, results, plans[0], 0).map((result) => result.id),
    ['result-a'],
  );
  assert.deepEqual(
    findResultsForPlanDisplay(plans, results, plans[1], 1).map((result) => result.id),
    ['result-b'],
  );
});

test('findResultsForPlanDisplay does not reuse results already matched to another plan', () => {
  const plans = [{ id: 'plan-a' }, { id: 'plan-b' }];
  const results = [
    { id: 'result-a', planId: 'plan-a', backendJobId: 'job-a' },
    { id: 'orphan-b', planId: 'old-plan-b', backendJobId: 'job-b' },
  ];

  assert.deepEqual(
    findResultsForPlanDisplay(plans, results, plans[0], 0).map((result) => result.id),
    ['result-a'],
  );
  assert.deepEqual(
    findResultsForPlanDisplay(plans, results, plans[1], 1).map((result) => result.id),
    ['orphan-b'],
  );
});

test('findResultsForPlanDisplay assigns orphan media deterministically by stable result identity', () => {
  const plans = [{ id: 'new-plan-a' }, { id: 'new-plan-b' }];
  const results = [
    { id: 'result-b', planId: 'old-plan-b', backendJobId: 'job-b' },
    { id: 'result-a', planId: 'old-plan-a', backendJobId: 'job-a' },
  ];

  assert.deepEqual(
    findResultsForPlanDisplay(plans, results, plans[0], 0).map((result) => result.id),
    ['result-a'],
  );
  assert.deepEqual(
    findResultsForPlanDisplay(plans, results, plans[1], 1).map((result) => result.id),
    ['result-b'],
  );
});

test('findResultsForPlanDisplay shows completed media before stale same-plan failures', () => {
  const plans = [{ id: 'plan-detail-6' }];
  const results = [
    {
      id: '032d51d6e6828c4b970cf78c-error',
      planId: 'plan-detail-6',
      backendJobId: '032d51d6e6828c4b970cf78c',
      taskId: '705e5006f68f209d6023372d02f2ea65',
      status: 'error',
    },
    {
      id: '766a8224eebd2f5c264c4ad35b722fb7',
      planId: 'plan-detail-6',
      backendJobId: '677a83b1448a37c928c03f6e',
      taskId: '766a8224eebd2f5c264c4ad35b722fb7',
      status: 'completed',
      imageUrl: '/retry-success.png',
    },
  ];

  assert.deepEqual(
    findResultsForPlanDisplay(plans, results, plans[0], 0).map((result) => result.id),
    ['766a8224eebd2f5c264c4ad35b722fb7', '032d51d6e6828c4b970cf78c-error'],
  );
});
