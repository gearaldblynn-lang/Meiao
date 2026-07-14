import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getMediaBudget,
  normalizeTrimSelection,
  resolveMediaPreviewBoundary,
  validateMediaQueueSelection,
} from './mediaTrimRules.mjs';

test('remaining duration subtracts existing canonical media', () => {
  assert.deepEqual(getMediaBudget([{ durationSeconds: 6 }, { durationSeconds: 4 }]), {
    usedSeconds: 10,
    remainingSeconds: 5,
    remainingFiles: 1,
  });
});

test('selection rejects a fourth reference file before upload', () => {
  assert.throws(
    () => validateMediaQueueSelection({ existing: [{}, {}, {}], incomingCount: 1 }),
    (error) => error?.code === 'media_queue_too_many' && /最多上传 3 个/.test(error.message),
  );
});

test('selection rejects when existing canonical duration has exhausted the shared budget', () => {
  assert.throws(
    () => validateMediaQueueSelection({ existing: [{ durationSeconds: 8 }, { durationSeconds: 7 }], incomingCount: 1 }),
    (error) => error?.code === 'media_queue_duration_exhausted' && /总时长/.test(error.message),
  );
});

test('trim selection stays inside source and remaining task duration without auto-taking an overlong source', () => {
  assert.deepEqual(normalizeTrimSelection({
    durationSeconds: 30,
    startSeconds: 12,
    endSeconds: 28,
    remainingSeconds: 5,
  }), {
    startSeconds: 12,
    endSeconds: 17,
    durationSeconds: 5,
  });
  assert.deepEqual(normalizeTrimSelection({
    durationSeconds: 4,
    startSeconds: 0,
    endSeconds: 4,
    remainingSeconds: 15,
  }), {
    startSeconds: 0,
    endSeconds: 4,
    durationSeconds: 4,
  });
});

test('trim selection rejects a remaining budget below the two-second minimum', () => {
  assert.throws(
    () => normalizeTrimSelection({ durationSeconds: 5, startSeconds: 0, endSeconds: 5, remainingSeconds: 1 }),
    (error) => error?.code === 'media_queue_duration_exhausted',
  );
});

test('trim selection explains when the source itself is shorter than two seconds', () => {
  assert.throws(
    () => normalizeTrimSelection({ durationSeconds: 1.5, startSeconds: 0, endSeconds: 1.5, remainingSeconds: 15 }),
    (error) => error?.code === 'media_source_too_short' && /原始素材不足 2 秒/.test(error.message),
  );
});

test('preview playback starts from the selected left boundary when current time is outside the range', () => {
  assert.deepEqual(resolveMediaPreviewBoundary({
    currentTime: 2,
    startSeconds: 7.3,
    endSeconds: 22.3,
    phase: 'play',
  }), {
    seekSeconds: 7.3,
    pause: false,
  });
  assert.deepEqual(resolveMediaPreviewBoundary({
    currentTime: 24,
    startSeconds: 7.3,
    endSeconds: 22.3,
    phase: 'play',
  }), {
    seekSeconds: 7.3,
    pause: false,
  });
});

test('preview playback stops at the selected right boundary and rewinds to the left boundary', () => {
  assert.deepEqual(resolveMediaPreviewBoundary({
    currentTime: 22.3,
    startSeconds: 7.3,
    endSeconds: 22.3,
    phase: 'timeupdate',
  }), {
    seekSeconds: 7.3,
    pause: true,
  });
});

test('preview seeking cannot leave the selected range', () => {
  assert.deepEqual(resolveMediaPreviewBoundary({
    currentTime: 4,
    startSeconds: 7.3,
    endSeconds: 22.3,
    phase: 'seeking',
  }), {
    seekSeconds: 7.3,
    pause: false,
  });
  assert.deepEqual(resolveMediaPreviewBoundary({
    currentTime: 25,
    startSeconds: 7.3,
    endSeconds: 22.3,
    phase: 'seeking',
  }), {
    seekSeconds: 22.3,
    pause: false,
  });
});
