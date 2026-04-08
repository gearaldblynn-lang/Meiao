import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { getUserVisibleTaskId } from './kieTaskUtils.mjs';

const kieAiSource = readFileSync(new URL('./kieAiService.ts', import.meta.url), 'utf8');

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

test('kieAiService preserves provider task id when wait timeout happens so recover can target the latest job', () => {
  assert.match(kieAiSource, /const timeoutJob = await fetchInternalJob\(jobId\)\.catch\(\(\) => null\)/);
  assert.match(kieAiSource, /taskId: getUserVisibleTaskId\(timeoutJob\?\.job\)/);
});

test('kieAiService gives image generation a longer timeout budget for slow cloud runs', () => {
  assert.match(kieAiSource, /const KIE_IMAGE_DEFAULT_TIMEOUT = 6 \* 60_000/);
  assert.match(kieAiSource, /const KIE_RECOVER_TIMEOUT = 4 \* 60_000/);
});
