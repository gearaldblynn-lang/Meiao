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
    formatNames: ['mov', 'mp4'],
    containerBrand: 'isom',
    videoCodec: 'h264',
    pixelFormat: 'yuv420p',
    width: 1080,
    height: 1920,
    audioCodec: 'aac',
    sampleRate: 48000,
    channels: 2,
    hasVideo: true,
    hasAudio: true,
    fastStart: true,
  };
  const validAudio = {
    durationSeconds: 1,
    sizeBytes: 256,
    formatNames: ['wav'],
    audioCodec: 'pcm_s16le',
    sampleRate: 48000,
    channels: 1,
    hasVideo: false,
    hasAudio: true,
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

test('voiceover resume probe enforces stage-specific WAV and MP4 contracts', async () => {
  const commonAudio = {
    durationSeconds: 4,
    sizeBytes: 1024,
    hasVideo: false,
  };
  await assert.rejects(
    probeVoiceoverManagedMedia({
      filePath: '/private/background.mp3',
      expectedKind: 'background_audio',
      probe: async () => ({
        ...commonAudio,
        audioCodec: 'mp3',
        sampleRate: 44100,
        channels: 1,
      }),
    }),
    (error) => error?.code === 'voiceover_checkpoint_asset_invalid',
  );
  await assert.rejects(
    probeVoiceoverManagedMedia({
      filePath: '/private/final.mp4',
      expectedKind: 'final_video',
      probe: async () => ({
        durationSeconds: 4,
        sizeBytes: 4096,
        formatNames: ['mov', 'mp4'],
        containerBrand: 'isom',
        videoCodec: 'hevc',
        pixelFormat: 'yuv420p',
        width: 1080,
        height: 1920,
        audioCodec: 'mp3',
        sampleRate: 44100,
        channels: 2,
        hasVideo: true,
        hasAudio: true,
        fastStart: false,
      }),
    }),
    (error) => error?.code === 'voiceover_checkpoint_asset_invalid',
  );
  await assert.rejects(
    probeVoiceoverManagedMedia({
      filePath: '/private/fake-tts.mp4',
      expectedKind: 'tts_audio',
      probe: async () => ({
        ...commonAudio,
        audioCodec: 'aac',
        sampleRate: 48000,
        channels: 1,
        hasVideo: true,
      }),
    }),
    (error) => error?.code === 'voiceover_checkpoint_asset_invalid',
  );
});

test('voiceover media probe accepts Golden full-range H.264 intermediate video', async () => {
  const metadata = {
    durationSeconds: 22.220998,
    sizeBytes: 7_592_215,
    formatNames: ['mov', 'mp4'],
    containerBrand: 'isom',
    videoCodec: 'h264',
    pixelFormat: 'yuvj420p',
    width: 720,
    height: 1280,
    audioCodec: 'aac',
    sampleRate: 44_100,
    channels: 2,
    hasVideo: true,
    hasAudio: true,
    fastStart: true,
  };

  assert.equal((await probeVoiceoverManagedMedia({
    filePath: '/private/golden.mp4',
    expectedKind: 'golden_video',
    expectedDurationMs: 22_221,
    durationToleranceMs: 100,
    probe: async () => metadata,
  })).pixelFormat, 'yuvj420p');
});

test('voiceover media probe keeps final delivery video on yuv420p', async () => {
  await assert.rejects(
    probeVoiceoverManagedMedia({
      filePath: '/private/final-full-range.mp4',
      expectedKind: 'final_video',
      probe: async () => ({
        durationSeconds: 22.220998,
        sizeBytes: 7_592_215,
        formatNames: ['mov', 'mp4'],
        containerBrand: 'isom',
        videoCodec: 'h264',
        pixelFormat: 'yuvj420p',
        width: 720,
        height: 1280,
        audioCodec: 'aac',
        sampleRate: 44_100,
        channels: 2,
        hasVideo: true,
        hasAudio: true,
        fastStart: true,
      }),
    }),
    (error) => error?.code === 'voiceover_checkpoint_asset_invalid',
  );
});
