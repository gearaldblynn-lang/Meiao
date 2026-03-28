import test from 'node:test';
import assert from 'node:assert/strict';

import { getUserVisibleTaskId } from './kieTaskUtils.mjs';

test('getUserVisibleTaskId only exposes provider task id and never falls back to internal job id', () => {
  assert.equal(
    getUserVisibleTaskId({
      id: 'internal-job-1',
      providerTaskId: 'provider-task-1',
    }),
    'provider-task-1'
  );

  assert.equal(
    getUserVisibleTaskId({
      id: 'internal-job-2',
      providerTaskId: '',
    }),
    ''
  );
});
