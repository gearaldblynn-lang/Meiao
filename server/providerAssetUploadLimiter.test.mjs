import assert from 'node:assert/strict';
import test from 'node:test';

import {
  __testOnly_resetKieAssetUploadLimiters,
  withKieAssetUploadSlot,
} from './providerAssetUploadLimiter.mjs';

test('process-wide upload limiter caps concurrent transfers', async () => {
  __testOnly_resetKieAssetUploadLimiters();
  let active = 0;
  let maxActive = 0;

  await Promise.all(Array.from({ length: 6 }, () => withKieAssetUploadSlot(async () => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
  }, { limit: 2 })));

  assert.equal(maxActive, 2);
});

test('queued upload exits when its task is cancelled', async () => {
  __testOnly_resetKieAssetUploadLimiters();
  let releaseFirst;
  let markStarted;
  const started = new Promise((resolve) => {
    markStarted = resolve;
  });
  const first = withKieAssetUploadSlot(async () => {
    markStarted();
    await new Promise((resolve) => {
      releaseFirst = resolve;
    });
  }, { limit: 1 });
  await started;

  const controller = new AbortController();
  const queued = withKieAssetUploadSlot(async () => {
    throw new Error('cancelled upload must not start');
  }, { limit: 1, signal: controller.signal });
  controller.abort();

  await assert.rejects(
    queued,
    (error) => error?.code === 'request_cancelled'
  );
  releaseFirst();
  await first;
});
