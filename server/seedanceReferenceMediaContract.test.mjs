import test from 'node:test';
import assert from 'node:assert/strict';

import { assertSeedanceReferenceMediaContract } from './seedanceReferenceMediaContract.mjs';

test('Seedance rejects four reference videos before media resolution', () => {
  assert.throws(
    () => assertSeedanceReferenceMediaContract({
      videoUrls: ['v1', 'v2', 'v3', 'v4'],
      videoDurations: [2, 2, 2, 2],
    }),
    (error) => error?.code === 'provider_bad_request' && /最多 3 个/.test(error.message),
  );
});

test('Seedance rejects supplied reference audio durations totaling over 15 seconds', () => {
  assert.throws(
    () => assertSeedanceReferenceMediaContract({
      audioUrls: ['a1', 'a2'],
      audioDurations: [8, 8],
    }),
    (error) => error?.code === 'provider_bad_request' && /总时长不能超过 15 秒/.test(error.message),
  );
});

test('Seedance rejects a supplied duration outside the per-file range', () => {
  assert.throws(
    () => assertSeedanceReferenceMediaContract({ videoUrls: ['v1'], videoDurations: [1.9] }),
    (error) => error?.code === 'provider_bad_request' && /2–15 秒/.test(error.message),
  );
});

test('Seedance accepts canonical references totaling exactly 15 seconds', () => {
  assert.doesNotThrow(() => assertSeedanceReferenceMediaContract({
    imageUrls: Array.from({ length: 9 }, (_, index) => `i${index}`),
    videoUrls: ['v1', 'v2', 'v3'],
    videoDurations: [5, 5, 5],
    audioUrls: ['a1'],
    audioDurations: [15],
  }));
});

test('Seedance rejects partial duration metadata instead of trusting a mismatched array', () => {
  assert.throws(
    () => assertSeedanceReferenceMediaContract({ audioUrls: ['a1', 'a2'], audioDurations: [5] }),
    (error) => error?.code === 'provider_bad_request' && /时长信息不完整/.test(error.message),
  );
});
