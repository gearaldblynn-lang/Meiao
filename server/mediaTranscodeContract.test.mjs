import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MEDIA_LIMITS,
  buildAudioTranscodeArgs,
  buildVideoTranscodeArgs,
  calculateVideoCanvas,
  isMediaCompatibleForProfile,
  validateMediaTranscodeSource,
  validateTranscodedOutput,
  validateTrimRange,
} from './mediaTranscodeContract.mjs';

test('calculateVideoCanvas preserves landscape and portrait content inside the Seedance pixel range', () => {
  assert.deepEqual(calculateVideoCanvas({ width: 1920, height: 1080 }), {
    width: 1280,
    height: 720,
    padded: false,
  });
  assert.deepEqual(calculateVideoCanvas({ width: 1080, height: 1920 }), {
    width: 720,
    height: 1280,
    padded: false,
  });
  assert.deepEqual(calculateVideoCanvas({ width: 1080, height: 1080 }), {
    width: 720,
    height: 720,
    padded: false,
  });
});

test('calculateVideoCanvas pads extreme ratios without stretching or cropping', () => {
  assert.deepEqual(calculateVideoCanvas({ width: 300, height: 1200 }), {
    width: 512,
    height: 1280,
    padded: true,
  });
  assert.deepEqual(calculateVideoCanvas({ width: 1600, height: 400 }), {
    width: 1280,
    height: 512,
    padded: true,
  });
});

test('validateTrimRange accepts exactly 2 to 15 seconds and rejects implicit truncation', () => {
  assert.deepEqual(
    validateTrimRange({ durationSeconds: 30, startSeconds: 3, endSeconds: 18 }),
    { startSeconds: 3, endSeconds: 18, durationSeconds: 15 },
  );
  assert.throws(
    () => validateTrimRange({ durationSeconds: 30, startSeconds: 0, endSeconds: 15.1 }),
    (error) => error?.code === 'media_trim_too_long' && /不能超过 15 秒/.test(error.message),
  );
  assert.throws(
    () => validateTrimRange({ durationSeconds: 30, startSeconds: 2, endSeconds: 3.9 }),
    (error) => error?.code === 'media_trim_too_short' && /不能少于 2 秒/.test(error.message),
  );
  assert.throws(
    () => validateTrimRange({ durationSeconds: 10, startSeconds: 8, endSeconds: 11 }),
    (error) => error?.code === 'media_trim_out_of_bounds',
  );
});

test('video FFmpeg args normalize to H.264 MP4 without requiring an audio track', () => {
  const args = buildVideoTranscodeArgs({
    inputPath: '/tmp/input.mov',
    outputPath: '/tmp/output.mp4',
    startSeconds: 1.2,
    endSeconds: 6.2,
    width: 1080,
    height: 1920,
    hasAudio: false,
  });
  assert.deepEqual(args.slice(-2), ['+faststart', '/tmp/output.mp4']);
  assert.ok(args.includes('libx264'));
  assert.ok(args.includes('yuv420p'));
  assert.ok(args.includes('30'));
  assert.ok(args.includes('0:a:0?'));
  assert.match(args[args.indexOf('-vf') + 1], /scale=720:1280.*pad=720:1280/);
});

test('audio FFmpeg args normalize to a 44.1 kHz 192 kbps MP3', () => {
  const args = buildAudioTranscodeArgs({
    inputPath: '/tmp/input.wav',
    outputPath: '/tmp/output.mp3',
    startSeconds: 0,
    endSeconds: 5,
  });
  assert.ok(args.includes('libmp3lame'));
  assert.ok(args.includes('44100'));
  assert.ok(args.includes('192k'));
  assert.equal(args.at(-1), '/tmp/output.mp3');
});

test('validateTranscodedOutput enforces canonical video and audio contracts', () => {
  assert.doesNotThrow(() => validateTranscodedOutput('video', {
    durationSeconds: 5,
    formatNames: ['mov', 'mp4', 'm4a'],
    videoCodec: 'h264',
    audioCodec: 'aac',
    width: 1280,
    height: 720,
    frameRate: 30,
    sizeBytes: 2_000_000,
  }));
  assert.doesNotThrow(() => validateTranscodedOutput('audio', {
    durationSeconds: 5,
    formatNames: ['mp3'],
    audioCodec: 'mp3',
    sizeBytes: 200_000,
  }));
  assert.throws(
    () => validateTranscodedOutput('video', {
      durationSeconds: 5,
      formatNames: ['mov', 'mp4'],
      videoCodec: 'hevc',
      width: 1280,
      height: 720,
      frameRate: 30,
      sizeBytes: 2_000_000,
    }),
    (error) => error?.code === 'media_output_invalid_codec',
  );
  assert.equal(MEDIA_LIMITS.video.maxFiles, 3);
  assert.equal(MEDIA_LIMITS.audio.maxTotalSeconds, 15);
});

test('subtitle removal allows a full six-hundred-second selection but no more', () => {
  assert.deepEqual(validateTrimRange({
    profile: 'subtitle_removal',
    durationSeconds: 600,
    startSeconds: 0,
    endSeconds: 600,
  }), { startSeconds: 0, endSeconds: 600, durationSeconds: 600 });
  assert.throws(
    () => validateTrimRange({
      profile: 'subtitle_removal',
      durationSeconds: 600.001,
      startSeconds: 0,
      endSeconds: 600.001,
    }),
    (error) => error?.code === 'media_trim_too_long',
  );
  assert.throws(
    () => validateTrimRange({ durationSeconds: 20, startSeconds: 0, endSeconds: 20 }),
    (error) => error?.code === 'media_trim_too_long',
  );
});

test('subtitle removal ffmpeg keeps the source ratio without pad or forced fps', () => {
  const args = buildVideoTranscodeArgs({
    profile: 'subtitle_removal',
    inputPath: 'in.mov',
    outputPath: 'out.mp4',
    startSeconds: 0,
    endSeconds: 20,
    width: 721,
    height: 1281,
    hasAudio: true,
  });
  assert.ok(args.includes('libx264'));
  assert.ok(args.includes('yuv420p'));
  assert.ok(args.includes('+faststart'));
  assert.ok(args.some((value) => value.includes('trunc(iw/2)*2')));
  assert.ok(!args.some((value) => value.includes('pad=')));
  assert.ok(!args.includes('-r'));
});

test('voiceover profile has no artificial duration cap and requires audio', () => {
  assert.deepEqual(validateTrimRange({
    profile: 'voiceover_translation',
    durationSeconds: 1800,
    startSeconds: 0,
    endSeconds: 1800,
  }), { startSeconds: 0, endSeconds: 1800, durationSeconds: 1800 });
  assert.throws(
    () => validateMediaTranscodeSource({
      profile: 'voiceover_translation',
      kind: 'video',
      hasVideo: true,
      hasAudio: false,
    }),
    (error) => error?.code === 'media_audio_track_required',
  );
});

test('voiceover transcode keeps aspect ratio and produces compatible MP4', () => {
  const args = buildVideoTranscodeArgs({
    profile: 'voiceover_translation',
    inputPath: '/tmp/input.mov',
    outputPath: '/tmp/output.mp4',
    startSeconds: 0,
    endSeconds: 120,
    width: 1080,
    height: 1920,
    hasAudio: true,
  });
  assert.ok(args.includes('scale=trunc(iw/2)*2:trunc(ih/2)*2,setsar=1'));
  assert.deepEqual(args.slice(-8), [
    '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart',
    '/tmp/output.mp4',
  ].slice(-8));
  assert.ok(args.includes('0:a:0'));
  assert.ok(!args.includes('0:a:0?'));
});

test('compatible H264 MP4 skips subtitle removal transcode', () => {
  assert.equal(isMediaCompatibleForProfile('subtitle_removal', {
    durationSeconds: 30,
    sizeBytes: 1_000_000,
    formatNames: ['mov', 'mp4'],
    videoCodec: 'h264',
    width: 1080,
    height: 1920,
  }), true);
  assert.equal(isMediaCompatibleForProfile('subtitle_removal', {
    durationSeconds: 30,
    sizeBytes: 1_000_000,
    formatNames: ['mov'],
    videoCodec: 'hevc',
    width: 1080,
    height: 1920,
  }), false);
});

test('compatible voiceover sources require H.264 yuv420p AAC MP4 without a duration cap', () => {
  assert.equal(isMediaCompatibleForProfile('voiceover_translation', {
    kind: 'video',
    durationSeconds: 1800,
    sizeBytes: 20_000_000,
    formatNames: ['mov', 'mp4'],
    videoCodec: 'h264',
    pixelFormat: 'yuv420p',
    audioCodec: 'aac',
    width: 1080,
    height: 1920,
    hasAudio: true,
    containerBrand: 'isom',
    fastStart: true,
  }), true);
  assert.equal(isMediaCompatibleForProfile('voiceover_translation', {
    kind: 'video',
    durationSeconds: 1800,
    sizeBytes: 20_000_000,
    formatNames: ['mp4'],
    videoCodec: 'h264',
    pixelFormat: 'yuv420p',
    width: 1080,
    height: 1920,
    hasAudio: false,
  }), false);
});

test('voiceover fast path requires a server-proven MP4 container and faststart layout', () => {
  const canonical = {
    kind: 'video',
    durationSeconds: 1800,
    sizeBytes: 20_000_000,
    formatNames: ['mov', 'mp4'],
    videoCodec: 'h264',
    pixelFormat: 'yuv420p',
    audioCodec: 'aac',
    width: 1080,
    height: 1920,
    hasAudio: true,
    containerBrand: 'isom',
    fastStart: true,
  };
  assert.equal(isMediaCompatibleForProfile('voiceover_translation', canonical), true);
  assert.equal(isMediaCompatibleForProfile('voiceover_translation', {
    ...canonical,
    containerBrand: 'qt  ',
  }), false);
  assert.equal(isMediaCompatibleForProfile('voiceover_translation', {
    ...canonical,
    fastStart: false,
  }), false);
});

test('compatible short Seedance media can skip redundant FFmpeg conversion', () => {
  assert.equal(isMediaCompatibleForProfile('seedance_reference', {
    kind: 'video',
    durationSeconds: 12,
    sizeBytes: 2_000_000,
    formatNames: ['mov', 'mp4'],
    videoCodec: 'h264',
    pixelFormat: 'yuv420p',
    audioCodec: 'aac',
    width: 720,
    height: 1280,
    frameRate: 30,
  }), true);
  assert.equal(isMediaCompatibleForProfile('seedance_reference', {
    kind: 'audio',
    durationSeconds: 12,
    sizeBytes: 200_000,
    formatNames: ['mp3'],
    audioCodec: 'mp3',
  }), true);
});

test('Seedance fast path rejects media that still needs trimming or normalization', () => {
  assert.equal(isMediaCompatibleForProfile('seedance_reference', {
    kind: 'video',
    durationSeconds: 20,
    sizeBytes: 2_000_000,
    formatNames: ['mov', 'mp4'],
    videoCodec: 'h264',
    pixelFormat: 'yuv420p',
    width: 720,
    height: 1280,
    frameRate: 30,
  }), false);
  assert.equal(isMediaCompatibleForProfile('seedance_reference', {
    kind: 'video',
    durationSeconds: 12,
    sizeBytes: 2_000_000,
    formatNames: ['mov', 'mp4'],
    videoCodec: 'hevc',
    pixelFormat: 'yuv420p',
    width: 720,
    height: 1280,
    frameRate: 30,
  }), false);
  assert.equal(isMediaCompatibleForProfile('seedance_reference', {
    kind: 'video',
    durationSeconds: 12,
    sizeBytes: 2_000_000,
    formatNames: ['mov', 'mp4'],
    videoCodec: 'h264',
    width: 720,
    height: 1280,
    frameRate: 30,
  }), false);
});

test('subtitle removal output validation ignores Seedance ratio, size and fps limits', () => {
  assert.doesNotThrow(() => validateTranscodedOutput('video', {
    durationSeconds: 600,
    formatNames: ['mov', 'mp4'],
    videoCodec: 'h264',
    audioCodec: 'aac',
    pixelFormat: 'yuv420p',
    width: 2160,
    height: 3840,
    frameRate: 120,
    sizeBytes: 500_000_000,
  }, 'subtitle_removal'));
});
