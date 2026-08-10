import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

import {
  createMediaTranscodeService,
  inspectMp4Container,
  parseFfprobeOutput,
  runMediaProcess,
} from './mediaTranscodeService.mjs';

const require = createRequire(import.meta.url);

const sampleProbeJson = JSON.stringify({
  format: {
    format_name: 'mov,mp4,m4a,3gp,3g2,mj2',
    duration: '5.250000',
    size: '1024000',
    tags: { major_brand: 'isom' },
  },
  streams: [
    { codec_type: 'video', codec_name: 'hevc', width: 1080, height: 1920, avg_frame_rate: '30000/1001' },
    { codec_type: 'audio', codec_name: 'aac' },
  ],
});

test('parseFfprobeOutput returns authoritative video metadata', () => {
  assert.deepEqual(parseFfprobeOutput(sampleProbeJson, 'video'), {
    kind: 'video',
    durationSeconds: 5.25,
    formatNames: ['mov', 'mp4', 'm4a', '3gp', '3g2', 'mj2'],
    containerBrand: 'isom',
    videoCodec: 'hevc',
    pixelFormat: null,
    audioCodec: 'aac',
    sampleRate: 0,
    channels: 0,
    hasVideo: true,
    width: 1080,
    height: 1920,
    frameRate: 29.97,
    sizeBytes: 1_024_000,
    hasAudio: true,
  });
});

test('parseFfprobeOutput exposes audio stream shape and detects video in audio probes', () => {
  const metadata = parseFfprobeOutput(JSON.stringify({
    format: {
      format_name: 'wav',
      duration: '1.250000',
      size: '240000',
    },
    streams: [
      { codec_type: 'video', codec_name: 'mjpeg', width: 320, height: 240 },
      {
        codec_type: 'audio',
        codec_name: 'pcm_s16le',
        sample_rate: '48000',
        channels: 2,
      },
    ],
  }), 'audio');

  assert.equal(metadata.sampleRate, 48000);
  assert.equal(metadata.channels, 2);
  assert.equal(metadata.hasVideo, true);
  assert.equal(metadata.hasAudio, true);
});

test('service readiness checks both configured binaries without exposing paths', async () => {
  const calls = [];
  const service = createMediaTranscodeService({
    env: { MEIAO_MEDIA_TRANSCODE_ENABLED: '1' },
    ffmpegPath: '/private/ffmpeg',
    ffprobePath: '/private/ffprobe',
    runProcess: async (command, args) => {
      calls.push({ command, args });
      return { stdout: '', stderr: '', exitCode: 0 };
    },
  });

  assert.deepEqual(await service.checkReadiness(), {
    enabled: true,
    ffmpegReady: true,
    ffprobeReady: true,
  });
  assert.deepEqual(calls.map((item) => item.args), [['-version'], ['-version']]);
  assert.deepEqual(service.getStatus(), {
    enabled: true,
    active: 0,
    queued: 0,
  });
});

test('service probe passes structured FFprobe arguments and parses stdout', async () => {
  const calls = [];
  const service = createMediaTranscodeService({
    env: { MEIAO_MEDIA_TRANSCODE_ENABLED: '1' },
    ffmpegPath: '/private/ffmpeg',
    ffprobePath: '/private/ffprobe',
    runProcess: async (command, args) => {
      calls.push({ command, args });
      return { stdout: sampleProbeJson, stderr: '', exitCode: 0 };
    },
  });

  const result = await service.probe('/tmp/source.mov', 'video');
  assert.equal(result.videoCodec, 'hevc');
  assert.deepEqual(calls[0], {
    command: '/private/ffprobe',
    args: ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', '/tmp/source.mov'],
  });
});

test('MP4 container inspection caps malformed atom walks and fails closed', async (t) => {
  const rootDir = await mkdtemp(join(tmpdir(), 'meiao-mp4-atoms-'));
  const fixturePath = join(rootDir, 'many-atoms.mp4');
  t.after(async () => { await rm(rootDir, { recursive: true, force: true }); });
  const atom = (type, payload = Buffer.alloc(0)) => {
    const header = Buffer.alloc(8);
    header.writeUInt32BE(header.length + payload.length, 0);
    header.write(type, 4, 4, 'latin1');
    return Buffer.concat([header, payload]);
  };
  await writeFile(fixturePath, Buffer.concat([
    atom('ftyp', Buffer.from('isom')),
    ...Array.from({ length: 64 }, () => atom('free')),
  ]));

  assert.deepEqual(await inspectMp4Container(fixturePath, { maxAtoms: 4 }), {
    containerBrand: 'isom',
    fastStart: false,
    atomCount: 4,
    capped: true,
  });
});

test('service cancellation aborts an active conversion and releases its permit', async () => {
  let rejectRunning;
  const runProcess = (command, args, options) => new Promise((resolve, reject) => {
    rejectRunning = reject;
    options.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true });
  });
  const service = createMediaTranscodeService({
    env: { MEIAO_MEDIA_TRANSCODE_ENABLED: '1', MEIAO_MEDIA_TRANSCODE_CONCURRENCY: '1' },
    ffmpegPath: '/private/ffmpeg',
    ffprobePath: '/private/ffprobe',
    runProcess,
  });

  const pending = service.transcode({
    sessionId: 'session-1',
    kind: 'audio',
    inputPath: '/tmp/source.wav',
    outputPath: '/tmp/output.mp3',
    startSeconds: 0,
    endSeconds: 3,
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(service.getStatus().active, 1);
  assert.equal(await service.cancel('session-1'), true);
  await assert.rejects(pending, (error) => error?.code === 'media_transcode_cancelled');
  assert.equal(service.getStatus().active, 0);
  assert.equal(typeof rejectRunning, 'function');
});

test('service uses the subtitle profile for FFmpeg and output validation', async () => {
  const calls = [];
  const subtitleProbeJson = JSON.stringify({
    format: { format_name: 'mov,mp4', duration: '20', size: '2048000' },
    streams: [
      { codec_type: 'video', codec_name: 'h264', pix_fmt: 'yuv420p', width: 720, height: 1280, avg_frame_rate: '120/1' },
      { codec_type: 'audio', codec_name: 'aac' },
    ],
  });
  const service = createMediaTranscodeService({
    env: { MEIAO_MEDIA_TRANSCODE_ENABLED: '1' },
    ffmpegPath: '/private/ffmpeg',
    ffprobePath: '/private/ffprobe',
    runProcess: async (command, args) => {
      calls.push({ command, args });
      return command.includes('ffprobe')
        ? { stdout: subtitleProbeJson, exitCode: 0 }
        : { stdout: '', exitCode: 0 };
    },
    readOutput: async () => Buffer.from('video'),
  });

  const result = await service.transcode({
    sessionId: 'subtitle-session',
    profile: 'subtitle_removal',
    kind: 'video',
    inputPath: '/tmp/source.mov',
    outputPath: '/tmp/output.mp4',
    startSeconds: 0,
    endSeconds: 20,
    width: 721,
    height: 1281,
    hasAudio: true,
  });

  const ffmpegArgs = calls.find((item) => item.command.includes('ffmpeg')).args;
  assert.ok(!ffmpegArgs.includes('-r'));
  assert.ok(!ffmpegArgs.some((value) => value.includes('pad=')));
  assert.equal(result.metadata.pixelFormat, 'yuv420p');
});

test('voiceover service preserves a portrait source as H.264 yuv420p AAC MP4', async (t) => {
  const rootDir = await mkdtemp(join(tmpdir(), 'meiao-voiceover-media-'));
  const sourcePath = join(rootDir, 'source.mov');
  const outputPath = join(rootDir, 'output.mp4');
  const ffmpegPath = require('ffmpeg-static');
  t.after(async () => { await rm(rootDir, { recursive: true, force: true }); });

  await runMediaProcess(ffmpegPath, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'color=c=blue:size=1080x1920:rate=30',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100',
    '-t', '3', '-shortest',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac',
    sourcePath,
  ], { timeoutMs: 60_000 });

  const service = createMediaTranscodeService({
    env: { MEIAO_MEDIA_TRANSCODE_ENABLED: '1', MEIAO_MEDIA_TRANSCODE_TIMEOUT_MS: '60000' },
  });
  const sourceProbe = await service.probe(sourcePath, 'video');
  const result = await service.transcode({
    sessionId: 'voiceover-fixture',
    profile: 'voiceover_translation',
    kind: 'video',
    inputPath: sourcePath,
    outputPath,
    startSeconds: 0,
    endSeconds: 3,
    width: sourceProbe.width,
    height: sourceProbe.height,
    hasAudio: sourceProbe.hasAudio,
  });

  assert.equal(result.metadata.videoCodec, 'h264');
  assert.equal(result.metadata.pixelFormat, 'yuv420p');
  assert.equal(result.metadata.audioCodec, 'aac');
  assert.ok(['isom', 'iso2', 'avc1', 'mp41', 'mp42'].includes(result.metadata.containerBrand));
  assert.equal(result.metadata.fastStart, true);
  assert.equal(result.metadata.width / result.metadata.height, 1080 / 1920);
});
