import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { createRequire } from 'node:module';
import test from 'node:test';

import {
  alignVoiceoverGroups,
  buildAlignmentArgs,
  buildExtractAudioArgs,
  buildFinalMixArgs,
  buildVocalOnlyVideoArgs,
  calculateAtempo,
  calculateDuckingRatio,
  extractVoiceoverAudio,
  mixVoiceoverResult,
  parseVoiceoverProbeOutput,
  probeVoiceoverAudio,
  runVoiceoverProcess,
  validateVoiceoverOutput,
} from './voiceoverAudio.mjs';

const require = createRequire(import.meta.url);

const audioProbe = ({
  duration = '3.000000',
  codec = 'pcm_s16le',
  sampleRate = '48000',
  channels = 2,
} = {}) => JSON.stringify({
  streams: [{
    codec_type: 'audio',
    codec_name: codec,
    sample_rate: sampleRate,
    channels,
  }],
  format: { duration, format_name: 'wav', size: '1000' },
});

const videoProbe = ({
  duration = '3.000000',
  videoDuration,
  audioDuration,
  videoCodec = 'h264',
  audioCodec = 'aac',
  width = 160,
  height = 120,
  channels = 2,
} = {}) => JSON.stringify({
  streams: [
    { codec_type: 'video', codec_name: videoCodec, width, height, ...(videoDuration ? { duration: videoDuration } : {}) },
    { codec_type: 'audio', codec_name: audioCodec, sample_rate: '48000', channels, ...(audioDuration ? { duration: audioDuration } : {}) },
  ],
  format: { duration, format_name: 'mov,mp4,m4a,3gp,3g2,mj2', size: '1000' },
});

test('extract argv emits a stereo 48khz pcm working track and keeps metacharacters literal', () => {
  const input = '/tmp/a;$(touch nope).mp4';
  assert.deepEqual(buildExtractAudioArgs(input, '/tmp/out.wav'), [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-i', input,
    '-map', '0:a:0',
    '-vn',
    '-ac', '2',
    '-ar', '48000',
    '-c:a', 'pcm_s16le',
    '/tmp/out.wav',
  ]);
});

test('vocal-only analysis input copies video, replaces audio, and enables faststart', () => {
  const args = buildVocalOnlyVideoArgs('/tmp/base.mp4', '/tmp/vocals.wav', '/tmp/analysis.mp4');
  assert.deepEqual(args.slice(0, 10), [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-i', '/tmp/base.mp4', '-i', '/tmp/vocals.wav',
    '-map', '0:v:0',
  ]);
  assert.ok(args.includes('copy'));
  assert.ok(args.includes('aac'));
  assert.ok(args.includes('128k'));
  assert.ok(args.includes('+faststart'));
  assert.ok(args.includes('-shortest'));
  assert.equal(args.includes('0:a:0'), false);
});

test('probe parser fails closed on malformed JSON and absent audio', () => {
  assert.throws(
    () => parseVoiceoverProbeOutput('{'),
    (error) => error.code === 'voiceover_mix_failed',
  );
  assert.throws(
    () => parseVoiceoverProbeOutput(JSON.stringify({
      streams: [{ codec_type: 'video', codec_name: 'h264', width: 10, height: 10 }],
      format: { duration: 1 },
    }), { requireAudio: true, noAudioCode: 'voiceover_source_has_no_audio' }),
    (error) => error.code === 'voiceover_source_has_no_audio',
  );
});

test('probe exposes distinct durations and treats the video stream as authoritative for video media', () => {
  const video = parseVoiceoverProbeOutput(videoProbe({
    duration: '2',
    videoDuration: '1',
    audioDuration: '2',
  }), { requireAudio: true });
  assert.equal(video.videoDurationMs, 1000);
  assert.equal(video.audioDurationMs, 2000);
  assert.equal(video.formatDurationMs, 2000);
  assert.equal(video.durationMs, 1000);

  const audio = parseVoiceoverProbeOutput(audioProbe({ duration: '2' }), { requireAudio: true });
  assert.equal(audio.videoDurationMs, null);
  assert.equal(audio.audioDurationMs, null);
  assert.equal(audio.formatDurationMs, 2000);
  assert.equal(audio.durationMs, 2000);
});

test('probeVoiceoverAudio rejects missing, empty, and invalid audio files', async () => {
  const baseDeps = {
    ffprobePath: '/private/ffprobe',
    statFile: async () => ({ size: 1 }),
  };
  await assert.rejects(
    probeVoiceoverAudio('/tmp/missing.wav', {
      ...baseDeps,
      statFile: async () => { throw Object.assign(new Error('missing'), { code: 'ENOENT' }); },
      runProcess: async () => ({ stdout: audioProbe() }),
    }),
    (error) => error.code === 'voiceover_mix_failed',
  );
  await assert.rejects(
    probeVoiceoverAudio('/tmp/empty.wav', {
      ...baseDeps,
      statFile: async () => ({ size: 0 }),
      runProcess: async () => ({ stdout: audioProbe() }),
    }),
    (error) => error.code === 'voiceover_mix_failed',
  );
  await assert.rejects(
    probeVoiceoverAudio('/tmp/invalid.wav', {
      ...baseDeps,
      runProcess: async () => ({ stdout: audioProbe({ duration: 'NaN' }) }),
    }),
    (error) => error.code === 'voiceover_mix_failed',
  );
});

test('extractVoiceoverAudio rejects a source without audio before starting ffmpeg', async () => {
  let ffmpegCalls = 0;
  await assert.rejects(
    extractVoiceoverAudio({
      inputVideoPath: '/tmp/in.mp4',
      outputWavPath: '/tmp/out.wav',
      deps: {
        ffmpegPath: '/private/ffmpeg',
        ffprobePath: '/private/ffprobe',
        statFile: async () => ({ size: 1 }),
        runProcess: async (command) => {
          if (command.endsWith('ffmpeg')) ffmpegCalls += 1;
          return { stdout: JSON.stringify({
            streams: [{ codec_type: 'video', codec_name: 'h264', width: 10, height: 10 }],
            format: { duration: 3 },
          }) };
        },
      },
    }),
    (error) => error.code === 'voiceover_source_has_no_audio',
  );
  assert.equal(ffmpegCalls, 0);
});

test('extractVoiceoverAudio rejects an invalid WAV work track after ffmpeg succeeds', async () => {
  let probeCalls = 0;
  await assert.rejects(
    extractVoiceoverAudio({
      inputVideoPath: '/tmp/in.mp4',
      outputWavPath: '/tmp/out.wav',
      deps: {
        ffmpegPath: '/private/ffmpeg',
        ffprobePath: '/private/ffprobe',
        statFile: async () => ({ size: 1 }),
        runProcess: async (command) => {
          if (command.endsWith('ffmpeg')) return { exitCode: 0 };
          probeCalls += 1;
          return {
            stdout: probeCalls === 1
              ? videoProbe()
              : audioProbe({ codec: 'aac', sampleRate: '44100', channels: 1 }),
          };
        },
      },
    }),
    (error) => error.code === 'voiceover_mix_failed',
  );
  assert.equal(probeCalls, 2);
});

test('extractVoiceoverAudio fails closed when an injected ffmpeg runner returns non-zero', async () => {
  let probeCalls = 0;
  await assert.rejects(
    extractVoiceoverAudio({
      inputVideoPath: '/tmp/in.mp4',
      outputWavPath: '/tmp/out.wav',
      deps: {
        ffmpegPath: '/private/ffmpeg',
        ffprobePath: '/private/ffprobe',
        statFile: async () => ({ size: 1 }),
        runProcess: async (command) => {
          if (command.endsWith('ffmpeg')) return { exitCode: 9, stderr: 'failed' };
          probeCalls += 1;
          return { stdout: videoProbe() };
        },
      },
    }),
    (error) => error.code === 'voiceover_mix_failed' && error.exitCode === 9,
  );
  assert.equal(probeCalls, 1);
});

test('calculateAtempo uses actual duration divided by target duration with inclusive boundaries', () => {
  assert.equal(calculateAtempo({
    actualDurationMs: 1200, targetDurationMs: 1000, minAtempo: 0.75, maxAtempo: 1.35,
  }), 1.2);
  assert.equal(calculateAtempo({
    actualDurationMs: 750, targetDurationMs: 1000, minAtempo: 0.75, maxAtempo: 1.35,
  }), 0.75);
  assert.equal(calculateAtempo({
    actualDurationMs: 1350, targetDurationMs: 1000, minAtempo: 0.75, maxAtempo: 1.35,
  }), 1.35);
});

test('calculateAtempo rejects out-of-range and invalid numeric inputs', () => {
  for (const input of [
    { actualDurationMs: 749, targetDurationMs: 1000, minAtempo: 0.75, maxAtempo: 1.35 },
    { actualDurationMs: 1351, targetDurationMs: 1000, minAtempo: 0.75, maxAtempo: 1.35 },
    { actualDurationMs: NaN, targetDurationMs: 1000, minAtempo: 0.75, maxAtempo: 1.35 },
    { actualDurationMs: 1000, targetDurationMs: 0, minAtempo: 0.75, maxAtempo: 1.35 },
    { actualDurationMs: 1000, targetDurationMs: 1000, minAtempo: 2, maxAtempo: 1 },
  ]) {
    assert.throws(
      () => calculateAtempo(input),
      (error) => error.code === 'voiceover_timing_out_of_range',
    );
  }
});

test('alignment graph places ordered groups on an exact zero bed with clamped fades', () => {
  const { args, filterGraph } = buildAlignmentArgs({
    groups: [
      { index: 0, startMs: 100, endMs: 1100, audioPath: '/tmp/0.wav', actualDurationMs: 1200 },
      { index: 1, startMs: 1300, endMs: 1380, audioPath: '/tmp/1.wav', actualDurationMs: 80 },
    ],
    outputPath: '/tmp/aligned.wav',
    totalDurationMs: 3000,
    config: { minAtempo: 0.75, maxAtempo: 1.35, fadeMs: 100, overlapToleranceMs: 20 },
  });
  assert.match(filterGraph, /aresample=48000,pan=mono\|c0=c0,atempo=1\.2/);
  assert.match(filterGraph, /afade=t=in:st=0:d=0\.1,afade=t=out:st=0\.9:d=0\.1,adelay=100\|100/);
  assert.match(filterGraph, /afade=t=in:st=0:d=0\.04,afade=t=out:st=0\.04:d=0\.04,adelay=1300\|1300/);
  assert.match(filterGraph, /anullsrc=r=48000:cl=mono/);
  assert.match(filterGraph, /volume=0/);
  assert.match(filterGraph, /amix=inputs=3:duration=longest:normalize=0/);
  assert.match(filterGraph, /atrim=duration=3/);
  assert.deepEqual(args.filter((value) => value === '-i').length, 2);
  assert.equal(args.at(-1), '/tmp/aligned.wav');
});

test('alignment rejects unordered, duplicate, out-of-bounds, and unsafe-overlap groups before ffmpeg', async () => {
  const cases = [
    [
      { index: 1, startMs: 100, endMs: 500, audioPath: '/tmp/1.wav' },
      { index: 0, startMs: 600, endMs: 900, audioPath: '/tmp/0.wav' },
    ],
    [
      { index: 0, startMs: 100, endMs: 500, audioPath: '/tmp/0.wav' },
      { index: 0, startMs: 600, endMs: 900, audioPath: '/tmp/1.wav' },
    ],
    [{ index: 0, startMs: -1, endMs: 500, audioPath: '/tmp/0.wav' }],
    [
      { index: 0, startMs: 100, endMs: 700, audioPath: '/tmp/0.wav' },
      { index: 1, startMs: 500, endMs: 900, audioPath: '/tmp/1.wav' },
    ],
  ];
  for (const groups of cases) {
    let calls = 0;
    await assert.rejects(
      alignVoiceoverGroups({
        groups,
        outputPath: '/tmp/out.wav',
        totalDurationMs: 1000,
        config: {
          minAtempo: 0.75, maxAtempo: 1.35, fadeMs: 40,
          overlapToleranceMs: 50, durationToleranceMs: 100,
        },
        deps: { runProcess: async () => { calls += 1; } },
      }),
      (error) => error.code === 'voiceover_timing_out_of_range',
    );
    assert.equal(calls, 0);
  }
});

test('unsafe timing is rejected after probe without spawning alignment ffmpeg', async () => {
  let ffmpegCalls = 0;
  await assert.rejects(
    alignVoiceoverGroups({
      groups: [{ index: 0, startMs: 0, endMs: 1000, audioPath: '/tmp/0.wav' }],
      outputPath: '/tmp/out.wav',
      totalDurationMs: 1000,
      config: {
        minAtempo: 0.75, maxAtempo: 1.35, fadeMs: 40,
        overlapToleranceMs: 0, durationToleranceMs: 100,
      },
      deps: {
        ffmpegPath: '/private/ffmpeg',
        ffprobePath: '/private/ffprobe',
        statFile: async () => ({ size: 1 }),
        runProcess: async (command) => {
          if (command.endsWith('ffmpeg')) ffmpegCalls += 1;
          return { stdout: audioProbe({ duration: '2' }) };
        },
      },
    }),
    (error) => error.code === 'voiceover_timing_out_of_range',
  );
  assert.equal(ffmpegCalls, 0);
});

test('ducking ratio maps 0, 4, and 12 dB onto FFmpeg 1..20', () => {
  assert.equal(calculateDuckingRatio(0), 1);
  assert.equal(calculateDuckingRatio(4), 1 + (4 * 19 / 12));
  assert.equal(calculateDuckingRatio(12), 20);
});

test('final mix maps base video only and excludes its original audio', () => {
  const { args, filterGraph } = buildFinalMixArgs({
    baseVideoPath: '/tmp/base.mp4',
    backgroundPath: '/tmp/no_vocals.wav',
    narrationPath: '/tmp/narration.wav',
    outputPath: '/tmp/final.mp4',
    durationMs: 3000,
    duckingDb: 4,
  });
  assert.match(filterGraph, /\[1:a\]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo\[bg\]/);
  assert.match(filterGraph, /\[2:a\]aresample=48000,pan=stereo\|c0=c0\|c1=c0\[narr\]/);
  assert.match(filterGraph, /sidechaincompress=threshold=0\.02:ratio=7\.333333333:attack=20:release=250:makeup=1/);
  assert.match(filterGraph, /amix=inputs=2:duration=longest:normalize=0/);
  assert.match(filterGraph, /alimiter=limit=0\.8912509381/);
  assert.match(filterGraph, /atrim=duration=3/);
  const maps = args.flatMap((value, index) => value === '-map' ? [args[index + 1]] : []);
  assert.deepEqual(maps, ['0:v:0', '[mixed]']);
  assert.ok(args.includes('copy'));
  assert.ok(args.includes('192k'));
  assert.ok(args.includes('+faststart'));
  assert.ok(args.includes('-shortest'));
});

test('validateVoiceoverOutput rejects duration drift, wrong codecs, and invalid dimensions/audio', async () => {
  const validate = (stdout) => validateVoiceoverOutput({
    path: '/tmp/final.mp4',
    expectedDurationMs: 3000,
    toleranceMs: 100,
    deps: {
      ffprobePath: '/private/ffprobe',
      statFile: async () => ({ size: 1 }),
      inspectContainer: async () => ({ fastStart: true, inspectable: true }),
      runProcess: async () => ({ stdout }),
    },
  });
  await assert.rejects(validate(videoProbe({ duration: '3.2' })), (error) => error.code === 'voiceover_mix_failed');
  await assert.rejects(validate(videoProbe({ videoCodec: 'hevc' })), (error) => error.code === 'voiceover_mix_failed');
  await assert.rejects(validate(videoProbe({ audioCodec: 'mp3' })), (error) => error.code === 'voiceover_mix_failed');
  await assert.rejects(validate(videoProbe({ width: 0 })), (error) => error.code === 'voiceover_mix_failed');
  await assert.rejects(validate(videoProbe({ channels: 0 })), (error) => error.code === 'voiceover_mix_failed');
  await assert.rejects(validate(videoProbe().replace('"width":160', '"width":"NaN"')), (error) => error.code === 'voiceover_mix_failed');
  await assert.rejects(validate(videoProbe().replace('"format_name":"mov,mp4,m4a,3gp,3g2,mj2"', '"format_name":"matroska"')), (error) => error.code === 'voiceover_mix_failed');
});

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.killCalls = [];
  child.kill = (signal) => child.killCalls.push(signal);
  return child;
}

test('runVoiceoverProcess never uses a shell and rejects non-zero exits with bounded stderr', async () => {
  const child = fakeChild();
  let options;
  const promise = runVoiceoverProcess('/private/ffmpeg', ['-i', '/tmp/a;bad'], {
    spawnImpl: (_command, _args, supplied) => {
      options = supplied;
      return child;
    },
    timeoutMs: 1000,
    maxStderrBytes: 16,
  });
  child.stderr.write('abcdefghijklmnopqrstuvwxyz');
  child.emit('close', 2);
  await assert.rejects(promise, (error) => {
    assert.equal(error.code, 'voiceover_mix_failed');
    assert.ok(Buffer.byteLength(error.stderr || '') <= 16);
    return true;
  });
  assert.equal(options.shell, false);
});

test('runVoiceoverProcess terminates but stays pending until the child closes', async () => {
  const abortChild = fakeChild();
  const controller = new AbortController();
  let settled = false;
  const aborted = runVoiceoverProcess('/private/ffmpeg', [], {
    spawnImpl: () => abortChild,
    signal: controller.signal,
    timeoutMs: 1000,
    terminationGraceMs: 5,
    terminationCloseTimeoutMs: 100,
  }).finally(() => { settled = true; });
  controller.abort();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false);
  assert.equal(abortChild.killCalls[0], 'SIGTERM');
  abortChild.emit('error', new Error('late error during termination'));
  assert.equal(settled, false);
  abortChild.emit('close', null, 'SIGTERM');
  await assert.rejects(aborted, (error) => error.code === 'voiceover_mix_failed' && error.cancelled === true);

  const timeoutChild = fakeChild();
  const timedOut = runVoiceoverProcess('/private/ffmpeg', [], {
    spawnImpl: () => timeoutChild,
    timeoutMs: 5,
    terminationGraceMs: 5,
    terminationCloseTimeoutMs: 100,
  });
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.deepEqual(timeoutChild.killCalls, ['SIGTERM', 'SIGKILL']);
  timeoutChild.emit('close', null, 'SIGKILL');
  await assert.rejects(
    timedOut,
    (error) => error.code === 'voiceover_mix_failed' && error.timedOut === true,
  );
});

test('runVoiceoverProcess exposes a close promise when kill completion exceeds its hard deadline', async () => {
  const child = fakeChild();
  const controller = new AbortController();
  const promise = runVoiceoverProcess('/private/ffmpeg', [], {
    spawnImpl: () => child,
    signal: controller.signal,
    timeoutMs: 1000,
    terminationGraceMs: 2,
    terminationCloseTimeoutMs: 6,
  });
  controller.abort();
  let terminalError;
  await assert.rejects(promise, (error) => {
    terminalError = error;
    return error.code === 'voiceover_mix_failed'
      && error.cancelled === true
      && error.releasePermitWhenClosed instanceof Promise;
  });
  let closed = false;
  terminalError.releasePermitWhenClosed.then(() => { closed = true; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(closed, false);
  child.emit('error', new Error('late error after caller rejection'));
  child.emit('close', null, 'SIGKILL');
  await terminalError.releasePermitWhenClosed;
  assert.equal(closed, true);
});

const ffmpegPath = (() => {
  try { return require('ffmpeg-static'); } catch { return null; }
})();
const ffprobePath = (() => {
  try { return require('@ffprobe-installer/ffprobe')?.path || null; } catch { return null; }
})();

async function runFfmpeg(args) {
  return runVoiceoverProcess(ffmpegPath, args, { timeoutMs: 30_000 });
}

function goertzel(samples, sampleRate, frequency) {
  const omega = (2 * Math.PI * frequency) / sampleRate;
  const coeff = 2 * Math.cos(omega);
  let q0 = 0;
  let q1 = 0;
  let q2 = 0;
  for (const sample of samples) {
    q0 = coeff * q1 - q2 + sample;
    q2 = q1;
    q1 = q0;
  }
  return Math.sqrt(q1 * q1 + q2 * q2 - q1 * q2 * coeff) / samples.length;
}

test('packaged FFmpeg fixture retains background, replaces vocals, limits peak, and validates MP4', {
  skip: ffmpegPath && ffprobePath ? false : 'packaged FFmpeg/FFprobe unavailable',
  timeout: 60_000,
}, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'voiceover-audio-fixture-'));
  const base = path.join(dir, 'base.mp4');
  const background = path.join(dir, 'background.wav');
  const vocals = path.join(dir, 'vocals.wav');
  const narration = path.join(dir, 'narration.wav');
  const aligned = path.join(dir, 'aligned.wav');
  const analysisVideo = path.join(dir, 'analysis.mp4');
  const final = path.join(dir, 'final.mp4');
  const control = path.join(dir, 'control.mp4');
  const pcm = path.join(dir, 'final.f32le');
  const controlPcm = path.join(dir, 'control.f32le');
  try {
    await runFfmpeg([
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'color=c=blue:s=160x120:r=24:d=3',
      '-f', 'lavfi', '-i', 'sine=frequency=300:sample_rate=48000:duration=3',
      '-f', 'lavfi', '-i', 'sine=frequency=600:sample_rate=48000:duration=3',
      '-f', 'lavfi', '-i', 'sine=frequency=1000:sample_rate=48000:duration=3',
      '-filter_complex', '[1:a][2:a][3:a]amix=inputs=3:normalize=0,volume=0.35[a]',
      '-map', '0:v:0', '-map', '[a]',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart',
      base,
    ]);
    for (const [output, graph] of [
      [background, 'sine=frequency=300:sample_rate=48000:duration=3[a];sine=frequency=600:sample_rate=48000:duration=3[b];[a][b]amix=inputs=2:normalize=0,volume=3[out]'],
      [vocals, 'sine=frequency=1000:sample_rate=48000:duration=3[out]'],
      [narration, 'sine=frequency=1400:sample_rate=48000:duration=3,volume=5[out]'],
    ]) {
      await runFfmpeg([
        '-hide_banner', '-loglevel', 'error', '-y',
        '-f', 'lavfi', '-i', graph,
        '-map', '0:a:0', '-ar', '48000', '-ac', output === narration ? '1' : '2',
        '-c:a', 'pcm_s16le', output,
      ]);
    }

    await extractVoiceoverAudio({
      inputVideoPath: base,
      outputWavPath: path.join(dir, 'extracted.wav'),
      deps: { ffmpegPath, ffprobePath },
    });
    const analysis = await import('./voiceoverAudio.mjs').then(({ buildVocalOnlyAnalysisVideo }) => (
      buildVocalOnlyAnalysisVideo({
        sourceVideoPath: base,
        vocalPath: vocals,
        outputPath: analysisVideo,
        deps: { ffmpegPath, ffprobePath },
        config: { durationToleranceMs: 120 },
      })
    ));
    assert.equal(analysis.videoCodec, 'h264');
    assert.equal(analysis.audioCodec, 'aac');

    const alignedMetadata = await alignVoiceoverGroups({
      groups: [{ index: 0, startMs: 0, endMs: 3000, audioPath: narration }],
      outputPath: aligned,
      totalDurationMs: 3000,
      config: {
        minAtempo: 0.75,
        maxAtempo: 1.35,
        fadeMs: 40,
        overlapToleranceMs: 0,
        durationToleranceMs: 120,
      },
      deps: { ffmpegPath, ffprobePath },
    });
    assert.equal(alignedMetadata.audioCodec, 'pcm_s16le');
    assert.equal(alignedMetadata.sampleRate, 48000);
    assert.equal(alignedMetadata.channels, 1);

    const mixed = await mixVoiceoverResult({
      baseVideoPath: base,
      backgroundPath: background,
      narrationPath: aligned,
      outputPath: final,
      config: { duckingDb: 4, durationToleranceMs: 120 },
      deps: { ffmpegPath, ffprobePath },
    });
    assert.equal(mixed.videoCodec, 'h264');
    assert.equal(mixed.audioCodec, 'aac');
    assert.equal(mixed.fastStart, true);
    assert.ok(Math.abs(mixed.durationMs - 3000) <= 120);

    const { args: controlArgs } = buildFinalMixArgs({
      baseVideoPath: base,
      backgroundPath: background,
      narrationPath: aligned,
      outputPath: control,
      durationMs: 3000,
      duckingDb: 0,
    });
    const controlGraphIndex = controlArgs.indexOf('-filter_complex') + 1;
    controlArgs[controlGraphIndex] = controlArgs[controlGraphIndex]
      .replace('alimiter=limit=0.8912509381:level=0,', '');
    await runFfmpeg(controlArgs);

    await runFfmpeg([
      '-hide_banner', '-loglevel', 'error', '-y',
      '-i', final, '-map', '0:a:0', '-ac', '1', '-ar', '48000', '-f', 'f32le', pcm,
    ]);
    await runFfmpeg([
      '-hide_banner', '-loglevel', 'error', '-y',
      '-i', control, '-map', '0:a:0', '-ac', '1', '-ar', '48000', '-f', 'f32le', controlPcm,
    ]);
    const raw = await readFile(pcm);
    const controlRaw = await readFile(controlPcm);
    const samples = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
    const controlSamples = new Float32Array(controlRaw.buffer, controlRaw.byteOffset, controlRaw.byteLength / 4);
    const peak = samples.reduce((max, value) => Math.max(max, Math.abs(value)), 0);
    const controlPeak = controlSamples.reduce((max, value) => Math.max(max, Math.abs(value)), 0);
    const amplitudes = Object.fromEntries([300, 600, 1000, 1400].map((frequency) => (
      [frequency, goertzel(samples, 48000, frequency)]
    )));
    assert.ok(amplitudes[300] > 0.005, `300Hz=${amplitudes[300]}`);
    assert.ok(amplitudes[600] > 0.005, `600Hz=${amplitudes[600]}`);
    assert.ok(amplitudes[1400] > 0.01, `1400Hz=${amplitudes[1400]}`);
    assert.ok(amplitudes[1000] < amplitudes[1400] * 0.12, JSON.stringify(amplitudes));
    assert.ok(controlPeak > 0.98, `unlimited control peak=${controlPeak}`);
    // AAC can overshoot the PCM limiter by about 0.44 dB in this fixture.
    assert.ok(peak <= 0.94, `limited AAC peak=${peak}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('real mix uses 1s video-stream duration instead of a 2s audio/container duration', {
  skip: ffmpegPath && ffprobePath ? false : 'packaged FFmpeg/FFprobe unavailable',
  timeout: 30_000,
}, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'voiceover-duration-fixture-'));
  const base = path.join(dir, 'base.mp4');
  const background = path.join(dir, 'background.wav');
  const narration = path.join(dir, 'narration.wav');
  const final = path.join(dir, 'final.mp4');
  try {
    await runFfmpeg([
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'color=c=blue:s=160x120:r=24:d=1',
      '-f', 'lavfi', '-i', 'sine=frequency=300:sample_rate=48000:duration=2',
      '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-movflags', '+faststart', base,
    ]);
    for (const [output, channels, frequency] of [
      [background, '2', '400'],
      [narration, '1', '1400'],
    ]) {
      await runFfmpeg([
        '-hide_banner', '-loglevel', 'error', '-y',
        '-f', 'lavfi', '-i', `sine=frequency=${frequency}:sample_rate=48000:duration=2`,
        '-ac', channels, '-c:a', 'pcm_s16le', output,
      ]);
    }
    const result = await mixVoiceoverResult({
      baseVideoPath: base,
      backgroundPath: background,
      narrationPath: narration,
      outputPath: final,
      config: { duckingDb: 4, durationToleranceMs: 120 },
      deps: { ffmpegPath, ffprobePath },
    });
    assert.ok(Math.abs(result.durationMs - 1000) <= 120, JSON.stringify(result));
    assert.equal(result.videoDurationMs, 1000);
    assert.ok(result.audioDurationMs <= 1120);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
