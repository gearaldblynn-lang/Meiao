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
