import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MAXFORAI_VIDEO_MODEL,
  MAXFORAI_VIDEO_MODEL_ID,
  assertMaxForAiVideoMediaContract,
  formatMaxForAiVideoPrice,
  isMaxForAiVideoModel,
  normalizeMaxForAiVideoAspectRatio,
  normalizeMaxForAiVideoSeconds,
} from './maxforaiVideoModels.mjs';

test('defines the MaxForAI video model without exposing upstream identity as display copy', () => {
  assert.equal(MAXFORAI_VIDEO_MODEL_ID, 'maxforai-sora-v9-pro');
  assert.deepEqual(MAXFORAI_VIDEO_MODEL, {
    id: 'maxforai-sora-v9-pro',
    label: 'Seedance 2.0 Pro 特价',
    upstreamModel: 'sora-v9-pro',
    provider: 'maxforai',
    taskType: 'maxforai_video',
    displayPriceCnyPerSecond: 0.5,
    supportedModes: ['multimodal2video'],
    supportedAspectRatios: ['16:9', '9:16', '1:1'],
    minSeconds: 4,
    maxSeconds: 15,
    defaultSeconds: 4,
    maxImages: 9,
    maxVideos: 3,
    maxAudios: 3,
    maxVideoDurationSeconds: 15,
    maxAudioDurationSeconds: 15,
    resolution: '720p',
  });
  assert.equal(isMaxForAiVideoModel('maxforai-sora-v9-pro'), true);
  assert.equal(isMaxForAiVideoModel('sora-v9-pro'), false);
});

test('normalizes seconds, ratios and display totals conservatively', () => {
  assert.equal(normalizeMaxForAiVideoSeconds('4秒'), 4);
  assert.equal(normalizeMaxForAiVideoSeconds('15'), 15);
  assert.equal(normalizeMaxForAiVideoSeconds('16秒'), 4);
  assert.equal(normalizeMaxForAiVideoAspectRatio('9:16'), '9:16');
  assert.equal(normalizeMaxForAiVideoAspectRatio('4:3'), '16:9');
  assert.equal(formatMaxForAiVideoPrice(4), '2.00');
  assert.equal(formatMaxForAiVideoPrice(15), '7.50');
});

test('rejects media counts and known duration totals before paid submission', () => {
  assert.doesNotThrow(() => assertMaxForAiVideoMediaContract({
    imageUrls: Array(9).fill('https://cdn.test/image.png'),
    videoUrls: Array(3).fill('https://cdn.test/video.mp4'),
    audioUrls: Array(3).fill('https://cdn.test/audio.wav'),
    videoDurations: [5, 5, 5],
    audioDurations: [4, 5, 6],
  }));
  assert.throws(
    () => assertMaxForAiVideoMediaContract({ imageUrls: Array(10).fill('x') }),
    /图片最多 9 张/,
  );
  assert.throws(
    () => assertMaxForAiVideoMediaContract({ videoUrls: Array(4).fill('x') }),
    /视频最多 3 个/,
  );
  assert.throws(
    () => assertMaxForAiVideoMediaContract({ audioUrls: Array(4).fill('x') }),
    /音频最多 3 个/,
  );
  assert.throws(
    () => assertMaxForAiVideoMediaContract({ videoUrls: ['a', 'b'], videoDurations: [8, 8] }),
    /视频合计时长不能超过 15 秒/,
  );
  assert.throws(
    () => assertMaxForAiVideoMediaContract({ audioUrls: ['a', 'b'], audioDurations: [9, 7] }),
    /音频合计时长不能超过 15 秒/,
  );
});
