import test from 'node:test';
import assert from 'node:assert/strict';

import { mergeShellRuntimeEntities } from './shellRuntimeMerge.ts';

test('shell runtime merge deduplicates confirmed entities by backend job id', () => {
  const runtime = [{
    id: 'local-project-1',
    backendJobId: 'job-123',
    status: 'generating',
  }];
  const live = [{
    id: 'job-job-123',
    backendJobId: 'job-123',
    status: 'completed',
  }];

  const merged = mergeShellRuntimeEntities(runtime, live);

  assert.equal(merged.length, 1);
  assert.equal(merged[0].id, 'job-job-123');
  assert.equal(merged[0].status, 'completed');
});

test('shell runtime merge treats the same project id with a later backend job id as one entity', () => {
  const runtime = [{
    id: 'proj-plan-1',
    status: 'planning',
  }];
  const live = [{
    id: 'proj-plan-1',
    backendJobId: 'job-456',
    status: 'completed',
  }];

  const merged = mergeShellRuntimeEntities(runtime, live);

  assert.equal(merged.length, 1);
  assert.equal(merged[0].id, 'proj-plan-1');
  assert.equal(merged[0].backendJobId, 'job-456');
  assert.equal(merged[0].status, 'completed');
});
