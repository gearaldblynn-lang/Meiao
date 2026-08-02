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
  alignContinuousVoiceover,
  buildAlignmentArgs,
  buildContinuousAlignmentArgs,
  buildAnalysisAudioEvidenceArgs,
  buildExtractAudioArgs,
  buildFinalMixArgs,
  buildVocalOnlyVideoArgs,
  buildVoiceoverAnalysisAudioEvidence,
  calculateAtempo,
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
  formatName = 'wav',
} = {}) => JSON.stringify({
  streams: [{
    codec_type: 'audio',
    codec_name: codec,
    sample_rate: sampleRate,
    channels,
  }],
  format: { duration, format_name: formatName, size: '1000' },
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

test('analysis audio evidence is mono low-bitrate AAC in an M4A container', () => {
  const args = buildAnalysisAudioEvidenceArgs('/tmp/vocals.wav', '/tmp/evidence.m4a');
  assert.deepEqual(args, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-i', '/tmp/vocals.wav',
    '-map', '0:a:0',
    '-vn',
    '-ac', '1',
    '-ar', '16000',
    '-c:a', 'aac',
    '-b:a', '48k',
    '-movflags', '+faststart',
    '-f', 'mp4',
    '/tmp/evidence.m4a',
  ]);
});

test('analysis audio evidence returns canonical base64 and rejects bytes above the configured limit', async () => {
  const bytes = Buffer.from('voice');
  const runProcess = async (command, args) => {
    if (command.endsWith('ffmpeg')) return { exitCode: 0, stdout: '', stderr: '' };
    const filePath = args.at(-1);
    return {
      exitCode: 0,
      stdout: filePath.endsWith('.m4a')
        ? audioProbe({ codec: 'aac', sampleRate: '16000', channels: 1, formatName: 'mov,mp4,m4a,3gp,3g2,mj2' })
        : audioProbe(),
    };
  };
  const deps = {
    ffmpegPath: '/private/ffmpeg',
    ffprobePath: '/private/ffprobe',
    statFile: async (filePath) => ({ size: filePath.endsWith('.m4a') ? bytes.length : 1_000 }),
    readFile: async () => bytes,
    runProcess,
  };

  const evidence = await buildVoiceoverAnalysisAudioEvidence({
    vocalPath: '/tmp/vocals.wav',
    outputPath: '/tmp/evidence.m4a',
    maxBytes: bytes.length,
    deps,
  });
  assert.deepEqual(evidence, {
    data: bytes.toString('base64'),
    mimeType: 'audio/mp4',
    sizeBytes: bytes.length,
    durationMs: 3_000,
  });

  await assert.rejects(
    buildVoiceoverAnalysisAudioEvidence({
      vocalPath: '/tmp/vocals.wav',
      outputPath: '/tmp/evidence.m4a',
      maxBytes: bytes.length - 1,
      deps,
    }),
    (error) => error.code === 'voiceover_analysis_invalid',
  );
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
  assert.equal(calculateAtempo({
    actualDurationMs: 500, targetDurationMs: 1000, minAtempo: 0.75, maxAtempo: 1.35,
  }), 0.75);
  assert.equal(calculateAtempo({
    actualDurationMs: 1750, targetDurationMs: 1000, minAtempo: 0.75, maxAtempo: 1.75,
  }), 1.75);
});

test('calculateAtempo rejects out-of-range and invalid numeric inputs', () => {
  for (const input of [
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

test('alignment safely slows and centers a short narration inside its speech window', () => {
  const { filterGraph } = buildAlignmentArgs({
    groups: [{
      index: 0,
      startMs: 1_000,
      endMs: 2_000,
      audioPath: '/tmp/short.wav',
      actualDurationMs: 500,
    }],
    outputPath: '/tmp/aligned.wav',
    totalDurationMs: 3_000,
    config: {
      minAtempo: 0.75,
      maxAtempo: 1.35,
      fadeMs: 40,
      overlapToleranceMs: 0,
    },
  });

  assert.match(filterGraph, /atempo=0\.75/);
  assert.match(filterGraph, /adelay=1166\.666666667\|1166\.666666667/);
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

test('continuous alignment reads one normalized source and trims every acoustic turn', () => {
  const { args, filterGraph, groups } = buildContinuousAlignmentArgs({
    audioPath: '/tmp/continuous.wav',
    turns: [
      {
        index: 0,
        startMs: 100,
        endMs: 1_100,
        sourceStartMs: 100,
        sourceEndMs: 1_300,
        actualDurationMs: 1_200,
      },
      {
        index: 1,
        startMs: 1_300,
        endMs: 2_300,
        sourceStartMs: 1_500,
        sourceEndMs: 2_000,
        actualDurationMs: 500,
      },
    ],
    outputPath: '/tmp/aligned.wav',
    totalDurationMs: 3_000,
    sourceDurationMs: 2_500,
    config: {
      minAtempo: 0.75,
      maxAtempo: 1.35,
      fadeMs: 40,
      overlapToleranceMs: 0,
    },
  });
  assert.deepEqual(args.flatMap((value, index) => (
    value === '-i' ? [args[index + 1]] : []
  )), ['/tmp/continuous.wav']);
  assert.match(filterGraph, /^\[0:a\]aresample=48000,pan=mono\|c0=c0,asplit=2\[continuous_0\]\[continuous_1\];/);
  assert.match(filterGraph, /\[continuous_0\]atrim=start=0\.1:end=1\.3,asetpts=PTS-STARTPTS,atempo=1\.2/);
  assert.match(filterGraph, /\[continuous_1\]atrim=start=1\.5:end=2,asetpts=PTS-STARTPTS,atempo=0\.75/);
  assert.match(filterGraph, /adelay=1466\.666666667\|1466\.666666667\[voice_1\]/);
  assert.match(filterGraph, /aformat=sample_fmts=s16:channel_layouts=mono\[out\]/);
  assert.ok(args.includes('48000'));
  assert.ok(args.includes('pcm_s16le'));
  assert.deepEqual(groups.map(({ index, atempo }) => ({ index, atempo })), [
    { index: 0, atempo: 1.2 },
    { index: 1, atempo: 0.75 },
  ]);
});

test('continuous alignment rejects guessed, overlapping, or out-of-source acoustic cuts', () => {
  const valid = {
    index: 0,
    startMs: 0,
    endMs: 1_000,
    sourceStartMs: 100,
    sourceEndMs: 900,
    actualDurationMs: 800,
  };
  for (const turns of [
    [{ ...valid, actualDurationMs: 700 }],
    [{ ...valid, sourceEndMs: 2_100, actualDurationMs: 2_000 }],
    [
      valid,
      {
        ...valid,
        index: 1,
        startMs: 1_100,
        endMs: 2_000,
        sourceStartMs: 800,
        sourceEndMs: 1_200,
        actualDurationMs: 400,
      },
    ],
    [
      valid,
      {
        ...valid,
        index: 1,
        startMs: 900,
        endMs: 1_500,
        sourceStartMs: 1_000,
        sourceEndMs: 1_400,
        actualDurationMs: 400,
      },
    ],
  ]) {
    assert.throws(
      () => buildContinuousAlignmentArgs({
        audioPath: '/tmp/continuous.wav',
        turns,
        outputPath: '/tmp/aligned.wav',
        totalDurationMs: 2_000,
        sourceDurationMs: 2_000,
        config: {
          minAtempo: 0.75,
          maxAtempo: 1.35,
          fadeMs: 40,
          overlapToleranceMs: 0,
        },
      }),
      (error) => error.code === 'voiceover_timing_out_of_range',
    );
  }
});

test('continuous alignment probes one source, returns durable evidence, and validates PCM output', async () => {
  let probeCalls = 0;
  let ffmpegArgs;
  const metadata = await alignContinuousVoiceover({
    audioPath: '/tmp/continuous.wav',
    turns: [{
      index: 0,
      startMs: 500,
      endMs: 1_500,
      sourceStartMs: 100,
      sourceEndMs: 1_100,
      actualDurationMs: 1_000,
    }],
    outputPath: '/tmp/aligned.wav',
    totalDurationMs: 3_000,
    config: {
      minAtempo: 0.75,
      maxAtempo: 1.35,
      fadeMs: 40,
      overlapToleranceMs: 0,
      durationToleranceMs: 100,
    },
    deps: {
      ffmpegPath: '/private/ffmpeg',
      ffprobePath: '/private/ffprobe',
      statFile: async () => ({ size: 1 }),
      runProcess: async (command, args) => {
        if (command.endsWith('ffmpeg')) {
          ffmpegArgs = args;
          return { exitCode: 0, stdout: '', stderr: '' };
        }
        probeCalls += 1;
        return {
          exitCode: 0,
          stdout: audioProbe({
            duration: probeCalls === 1 ? '2' : '3',
            channels: probeCalls === 1 ? 2 : 1,
          }),
          stderr: '',
        };
      },
    },
  });
  assert.equal(probeCalls, 2);
  assert.deepEqual(ffmpegArgs.flatMap((value, index) => (
    value === '-i' ? [ffmpegArgs[index + 1]] : []
  )), ['/tmp/continuous.wav']);
  assert.deepEqual(metadata.groups, [{
    index: 0,
    startMs: 500,
    endMs: 1_500,
    sourceStartMs: 100,
    sourceEndMs: 1_100,
    actualDurationMs: 1_000,
    atempo: 1,
  }]);
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

test('final mix accepts only the base video and translated narration as media inputs', () => {
  const { args, filterGraph } = buildFinalMixArgs({
    baseVideoPath: '/tmp/base.mp4',
    narrationPath: '/tmp/narration.wav',
    outputPath: '/tmp/final.mp4',
    durationMs: 3000,
  });
  assert.match(filterGraph, /^\[1:a\]aresample=48000,pan=stereo\|c0=c0\|c1=c0,/);
  assert.doesNotMatch(filterGraph, /sidechaincompress|amix|\[2:a\]|\[3:a\]/);
  assert.match(filterGraph, /alimiter=limit=0\.8912509381/);
  assert.match(filterGraph, /atrim=duration=3/);
  const inputs = args.flatMap((value, index) => value === '-i' ? [args[index + 1]] : []);
  assert.deepEqual(inputs, ['/tmp/base.mp4', '/tmp/narration.wav']);
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
  const killDeadline = Date.now() + 250;
  while (timeoutChild.killCalls.length < 2 && Date.now() < killDeadline) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
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

function rmsBetween(samples, sampleRate, startSeconds, endSeconds) {
  const start = Math.max(0, Math.floor(startSeconds * sampleRate));
  const end = Math.min(samples.length, Math.ceil(endSeconds * sampleRate));
  let sum = 0;
  for (let index = start; index < end; index += 1) {
    sum += samples[index] * samples[index];
  }
  return Math.sqrt(sum / Math.max(1, end - start));
}

test('real alignment centers slowed speech energy inside its durable window', {
  skip: ffmpegPath && ffprobePath ? false : 'packaged FFmpeg/FFprobe unavailable',
  timeout: 30_000,
}, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'voiceover-centered-alignment-'));
  const speech = path.join(dir, 'speech.wav');
  const aligned = path.join(dir, 'aligned.wav');
  const pcm = path.join(dir, 'aligned.f32le');
  try {
    await runFfmpeg([
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'sine=frequency=1200:sample_rate=48000:duration=0.5',
      '-ac', '1', '-c:a', 'pcm_s16le', speech,
    ]);
    const metadata = await alignVoiceoverGroups({
      groups: [{
        index: 0,
        startMs: 1_000,
        endMs: 2_000,
        audioPath: speech,
      }],
      outputPath: aligned,
      totalDurationMs: 3_000,
      config: {
        minAtempo: 0.75,
        maxAtempo: 1.35,
        fadeMs: 40,
        overlapToleranceMs: 0,
        durationToleranceMs: 120,
      },
      deps: { ffmpegPath, ffprobePath },
    });
    assert.equal(metadata.groups[0].atempo, 0.75);

    await runFfmpeg([
      '-hide_banner', '-loglevel', 'error', '-y',
      '-i', aligned, '-map', '0:a:0', '-ac', '1', '-ar', '48000', '-f', 'f32le', pcm,
    ]);
    const raw = await readFile(pcm);
    const samples = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
    const centerEnergy = rmsBetween(samples, 48_000, 1.25, 1.75);
    const leadingEnergy = rmsBetween(samples, 48_000, 0, 1.05);
    const trailingEnergy = rmsBetween(samples, 48_000, 1.95, 3);
    assert.ok(centerEnergy > 0.03, `center=${centerEnergy}`);
    assert.ok(leadingEnergy < centerEnergy * 0.01, `leading=${leadingEnergy}, center=${centerEnergy}`);
    assert.ok(trailingEnergy < centerEnergy * 0.01, `trailing=${trailingEnergy}, center=${centerEnergy}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('packaged FFmpeg fixture removes every source-audio component and keeps only translated narration', {
  skip: ffmpegPath && ffprobePath ? false : 'packaged FFmpeg/FFprobe unavailable',
  timeout: 60_000,
}, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'voiceover-audio-fixture-'));
  const base = path.join(dir, 'base.mp4');
  const background = path.join(dir, 'background.wav');
  const original = path.join(dir, 'original.wav');
  const vocals = path.join(dir, 'vocals.wav');
  const narration = path.join(dir, 'narration.wav');
  const aligned = path.join(dir, 'aligned.wav');
  const analysisVideo = path.join(dir, 'analysis.mp4');
  const final = path.join(dir, 'final.mp4');
  const pcm = path.join(dir, 'final.f32le');
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
      outputWavPath: original,
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
      narrationPath: aligned,
      outputPath: final,
      config: { durationToleranceMs: 120 },
      deps: { ffmpegPath, ffprobePath },
    });
    assert.equal(mixed.videoCodec, 'h264');
    assert.equal(mixed.audioCodec, 'aac');
    assert.equal(mixed.fastStart, true);
    assert.ok(Math.abs(mixed.durationMs - 3000) <= 120);

    await runFfmpeg([
      '-hide_banner', '-loglevel', 'error', '-y',
      '-i', final, '-map', '0:a:0', '-ac', '1', '-ar', '48000', '-f', 'f32le', pcm,
    ]);
    const raw = await readFile(pcm);
    const samples = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
    const peak = samples.reduce((max, value) => Math.max(max, Math.abs(value)), 0);
    const amplitudes = Object.fromEntries([300, 600, 1000, 1400].map((frequency) => (
      [frequency, goertzel(samples, 48000, frequency)]
    )));
    assert.ok(amplitudes[1400] > 0.01, `1400Hz=${amplitudes[1400]}`);
    assert.ok(amplitudes[300] < amplitudes[1400] * 0.01, JSON.stringify(amplitudes));
    assert.ok(amplitudes[600] < amplitudes[1400] * 0.01, JSON.stringify(amplitudes));
    assert.ok(amplitudes[1000] < amplitudes[1400] * 0.12, JSON.stringify(amplitudes));
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
    await runFfmpeg([
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'sine=frequency=1400:sample_rate=48000:duration=2',
      '-ac', '1', '-c:a', 'pcm_s16le', narration,
    ]);
    const result = await mixVoiceoverResult({
      baseVideoPath: base,
      narrationPath: narration,
      outputPath: final,
      config: { durationToleranceMs: 120 },
      deps: { ffmpegPath, ffprobePath },
    });
    assert.ok(Math.abs(result.durationMs - 1000) <= 120, JSON.stringify(result));
    assert.equal(result.videoDurationMs, 1000);
    assert.ok(result.audioDurationMs <= 1120);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('real mix excludes original stereo music and old centered speech', {
  skip: ffmpegPath && ffprobePath ? false : 'packaged FFmpeg/FFprobe unavailable',
  timeout: 30_000,
}, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'voiceover-side-bed-fixture-'));
  const base = path.join(dir, 'base.mp4');
  const narration = path.join(dir, 'narration.wav');
  const final = path.join(dir, 'final.mp4');
  const pcm = path.join(dir, 'final.f32le');
  try {
    await runFfmpeg([
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'color=c=blue:s=160x120:r=24:d=2',
      '-f', 'lavfi', '-i',
      'aevalsrc=0.2*sin(2*PI*300*t)+0.15*sin(2*PI*1000*t)|0.2*sin(2*PI*600*t)+0.15*sin(2*PI*1000*t):s=48000:d=2',
      '-map', '0:v:0', '-map', '1:a:0',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart',
      base,
    ]);
    await runFfmpeg([
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'sine=frequency=1400:sample_rate=48000:duration=2',
      '-ac', '1', '-c:a', 'pcm_s16le', narration,
    ]);

    await mixVoiceoverResult({
      baseVideoPath: base,
      narrationPath: narration,
      outputPath: final,
      config: { durationToleranceMs: 120 },
      deps: { ffmpegPath, ffprobePath },
    });
    await runFfmpeg([
      '-hide_banner', '-loglevel', 'error', '-y',
      '-i', final, '-map', '0:a:0', '-ac', '1', '-ar', '48000', '-f', 'f32le', pcm,
    ]);
    const raw = await readFile(pcm);
    const samples = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
    const amplitudes = Object.fromEntries([300, 600, 1000, 1400].map((frequency) => (
      [frequency, goertzel(samples, 48000, frequency)]
    )));
    assert.ok(amplitudes[1400] > 0.02, JSON.stringify(amplitudes));
    assert.ok(amplitudes[300] < amplitudes[1400] * 0.01, JSON.stringify(amplitudes));
    assert.ok(amplitudes[600] < amplitudes[1400] * 0.01, JSON.stringify(amplitudes));
    assert.ok(amplitudes[1000] < amplitudes[1400] * 0.01, JSON.stringify(amplitudes));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
