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

test('process-wide upload limiter uses the minimum mixed limit without additive pools', async () => {
  __testOnly_resetKieAssetUploadLimiters();
  let active = 0;
  let maxActive = 0;
  let releaseFirst;
  let markFirstStarted;
  const firstStarted = new Promise((resolve) => {
    markFirstStarted = resolve;
  });
  const startOrder = [];

  const first = withKieAssetUploadSlot(async () => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    startOrder.push('limit-1');
    markFirstStarted();
    await new Promise((resolve) => {
      releaseFirst = resolve;
    });
    active -= 1;
  }, { limit: 1 });
  await firstStarted;

  const queued = [
    withKieAssetUploadSlot(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      startOrder.push('limit-2');
      active -= 1;
    }, { limit: 2 }),
    withKieAssetUploadSlot(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      startOrder.push('limit-3');
      active -= 1;
    }, { limit: 3 }),
  ];

  await Promise.resolve();
  assert.deepEqual(startOrder, ['limit-1']);
  releaseFirst();
  await Promise.all([first, ...queued]);

  assert.equal(maxActive, 1);
  assert.deepEqual(startOrder, ['limit-1', 'limit-2', 'limit-3']);
});

test('process-wide upload limiter reconfigures to the default limit after becoming idle', async () => {
  __testOnly_resetKieAssetUploadLimiters();
  await withKieAssetUploadSlot(async () => {}, { limit: 1 });

  let active = 0;
  let maxActive = 0;
  let releaseUploads;
  let markDefaultLimitReached;
  const defaultLimitReached = new Promise((resolve) => {
    markDefaultLimitReached = resolve;
  });
  const uploadsMayFinish = new Promise((resolve) => {
    releaseUploads = resolve;
  });

  const uploads = Array.from({ length: 4 }, () => withKieAssetUploadSlot(async () => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    if (active === 3) markDefaultLimitReached();
    await uploadsMayFinish;
    active -= 1;
  }));

  await defaultLimitReached;
  assert.equal(maxActive, 3);
  releaseUploads();
  await Promise.all(uploads);
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
