import test from 'node:test';
import assert from 'node:assert/strict';

import {
  probeVoiceoverManagedMedia,
  resolveVoiceoverExpectedMediaKind,
} from './voiceoverMediaProbe.mjs';

test('voiceover expected media kinds map every durable stage to video or audio', () => {
  for (const kind of ['source_video', 'golden_video', 'final_video', 'analysis_video']) {
    assert.equal(resolveVoiceoverExpectedMediaKind(kind), 'video');
  }
  for (const kind of [
    'original_audio',
    'vocal_audio',
    'background_audio',
    'tts_audio',
    'aligned_audio',
  ]) {
    assert.equal(resolveVoiceoverExpectedMediaKind(kind), 'audio');
  }
  assert.throws(
    () => resolveVoiceoverExpectedMediaKind('unknown_media'),
    (error) => error?.code === 'voiceover_checkpoint_asset_invalid',
  );
});

test('voiceover media probe rejects empty, wrong-type, and unplayable checkpoint assets', async () => {
  const validVideo = {
    durationSeconds: 4,
    sizeBytes: 1024,
    videoCodec: 'h264',
    width: 1080,
    height: 1920,
    hasAudio: true,
  };
  const validAudio = {
    durationSeconds: 1,
    sizeBytes: 256,
    audioCodec: 'pcm_s16le',
  };
  assert.deepEqual(await probeVoiceoverManagedMedia({
    filePath: '/tmp/video.mp4',
    expectedKind: 'final_video',
    probe: async (_filePath, kind) => {
      assert.equal(kind, 'video');
      return validVideo;
    },
  }), {
    ...validVideo,
    durationMs: 4_000,
    hasAudio: true,
  });
  assert.equal((await probeVoiceoverManagedMedia({
    filePath: '/tmp/source-silent.mp4',
    expectedKind: 'source_video',
    probe: async () => ({ ...validVideo, hasAudio: false }),
  })).hasAudio, false);
  assert.deepEqual(await probeVoiceoverManagedMedia({
    filePath: '/tmp/audio.wav',
    expectedKind: 'tts_audio',
    probe: async (_filePath, kind) => {
      assert.equal(kind, 'audio');
      return validAudio;
    },
  }), {
    ...validAudio,
    durationMs: 1_000,
    hasAudio: true,
  });

  for (const [expectedKind, metadata] of [
    ['final_video', { ...validVideo, sizeBytes: 0 }],
    ['final_video', { ...validVideo, videoCodec: null }],
    ['final_video', { ...validVideo, hasAudio: false }],
    ['tts_audio', { ...validAudio, audioCodec: null }],
    ['tts_audio', { ...validAudio, durationSeconds: 0 }],
  ]) {
    await assert.rejects(
      probeVoiceoverManagedMedia({
        filePath: '/tmp/corrupt',
        expectedKind,
        probe: async () => metadata,
      }),
      (error) => error?.code === 'voiceover_checkpoint_asset_invalid',
      expectedKind,
    );
  }
  await assert.rejects(
    probeVoiceoverManagedMedia({
      filePath: '/tmp/wrong-duration.wav',
      expectedKind: 'aligned_audio',
      expectedDurationMs: 4_000,
      durationToleranceMs: 100,
      probe: async () => ({ ...validAudio, durationSeconds: 3.8 }),
    }),
    (error) => error?.code === 'voiceover_checkpoint_asset_invalid',
  );
  await assert.rejects(
    probeVoiceoverManagedMedia({
      filePath: '/secret/path/checkpoint.wav',
      expectedKind: 'tts_audio',
      probe: async () => {
        throw new Error('ffprobe failed at /secret/path/checkpoint.wav');
      },
    }),
    (error) => (
      error?.code === 'voiceover_checkpoint_asset_invalid'
      && !error.message.includes('/secret/path')
    ),
  );
});
