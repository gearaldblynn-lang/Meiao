import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  createMediaTranscodeService,
  runMediaProcess,
} from '../server/mediaTranscodeService.mjs';
import { validateTranscodedOutput } from '../server/mediaTranscodeContract.mjs';

const require = createRequire(import.meta.url);
const ffmpegPath = require('ffmpeg-static');
const service = createMediaTranscodeService({
  env: { ...process.env, MEIAO_MEDIA_TRANSCODE_ENABLED: '1' },
});

const summarize = (metadata) => ({
  durationSeconds: metadata.durationSeconds,
  formatNames: metadata.formatNames,
  videoCodec: metadata.videoCodec || null,
  audioCodec: metadata.audioCodec || null,
  width: metadata.width || null,
  height: metadata.height || null,
  frameRate: metadata.frameRate || null,
  sizeBytes: metadata.sizeBytes,
});

const rootDir = await mkdtemp(join(tmpdir(), 'meiao-media-transcode-probe-'));

try {
  const readiness = await service.checkReadiness();
  if (!readiness.ffmpegReady || !readiness.ffprobeReady) {
    throw new Error('FFmpeg or FFprobe is not ready');
  }

  const sourceVideoPath = join(rootDir, 'source-video.mov');
  const sourceAudioPath = join(rootDir, 'source-audio.wav');
  const outputVideoPath = join(rootDir, 'canonical-video.mp4');
  const outputAudioPath = join(rootDir, 'canonical-audio.mp3');

  await runMediaProcess(ffmpegPath, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'testsrc2=size=360x640:rate=30',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100',
    '-t', '4', '-shortest',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    sourceVideoPath,
  ], { timeoutMs: 60_000 });

  await runMediaProcess(ffmpegPath, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'sine=frequency=660:sample_rate=44100',
    '-t', '4', '-c:a', 'pcm_s16le',
    sourceAudioPath,
  ], { timeoutMs: 30_000 });

  const sourceVideo = await service.probe(sourceVideoPath, 'video');
  const videoResult = await service.transcode({
    sessionId: 'probe-video',
    kind: 'video',
    inputPath: sourceVideoPath,
    outputPath: outputVideoPath,
    startSeconds: 0.5,
    endSeconds: 3.5,
    width: sourceVideo.width,
    height: sourceVideo.height,
    hasAudio: sourceVideo.hasAudio,
  });
  validateTranscodedOutput('video', videoResult.metadata);

  const audioResult = await service.transcode({
    sessionId: 'probe-audio',
    kind: 'audio',
    inputPath: sourceAudioPath,
    outputPath: outputAudioPath,
    startSeconds: 0.5,
    endSeconds: 3.5,
  });
  validateTranscodedOutput('audio', audioResult.metadata);
  if (audioResult.metadata.audioCodec !== 'mp3') {
    throw new Error('libmp3lame output validation failed');
  }

  const encoders = await runMediaProcess(ffmpegPath, ['-hide_banner', '-encoders'], { timeoutMs: 30_000 });
  const supportsHevc = /\blibx265\b/.test(`${encoders.stdout}\n${encoders.stderr}`);
  let hevc = { supported: false };
  if (supportsHevc) {
    const hevcSourcePath = join(rootDir, 'source-hevc.mp4');
    const hevcOutputPath = join(rootDir, 'canonical-from-hevc.mp4');
    await runMediaProcess(ffmpegPath, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'color=c=blue:size=360x640:rate=30',
      '-t', '2.5', '-c:v', 'libx265', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-an',
      hevcSourcePath,
    ], { timeoutMs: 60_000 });
    const hevcSource = await service.probe(hevcSourcePath, 'video');
    const hevcResult = await service.transcode({
      sessionId: 'probe-hevc',
      kind: 'video',
      inputPath: hevcSourcePath,
      outputPath: hevcOutputPath,
      startSeconds: 0.1,
      endSeconds: 2.3,
      width: hevcSource.width,
      height: hevcSource.height,
      hasAudio: false,
    });
    validateTranscodedOutput('video', hevcResult.metadata);
    if (hevcSource.videoCodec !== 'hevc' || hevcResult.metadata.videoCodec !== 'h264') {
      throw new Error('hevc to h264 conversion validation failed');
    }
    hevc = {
      supported: true,
      sourceCodec: hevcSource.videoCodec,
      output: summarize(hevcResult.metadata),
    };
  }

  console.log(JSON.stringify({
    ok: true,
    readiness,
    video: summarize(videoResult.metadata),
    audio: summarize(audioResult.metadata),
    hevc,
  }));
} finally {
  await rm(rootDir, { recursive: true, force: true });
}
