import { spawn } from 'node:child_process';
import path from 'node:path';
import { readFile, stat } from 'node:fs/promises';

import {
  inspectMp4Container,
  resolvePackagedFfmpegPath,
  resolvePackagedFfprobePath,
} from './mediaTranscodeService.mjs';
import { buildVoiceoverError, VOICEOVER_MAX_TTS_GROUPS } from './voiceoverContract.mjs';

const DEFAULT_PROCESS_TIMEOUT_MS = 600_000;
const DEFAULT_PROBE_TIMEOUT_MS = 30_000;
const MIN_PROCESS_TIMEOUT_MS = 1_000;
const MAX_PROCESS_TIMEOUT_MS = 7_200_000;
const MAX_STDOUT_BYTES = 2 * 1024 * 1024;
const MAX_STDERR_BYTES = 64 * 1024;

const fail = (message, details = {}) => buildVoiceoverError('voiceover_mix_failed', message, details);
const timingFailure = (message, details = {}) => (
  buildVoiceoverError('voiceover_timing_out_of_range', message, details)
);
const analysisEvidenceFailure = (message, details = {}) => (
  buildVoiceoverError('voiceover_analysis_invalid', message, details)
);

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
}

function formatNumber(value) {
  const rounded = Number(Number(value).toFixed(9));
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

function assertAbsoluteFilePath(value, label) {
  if (typeof value !== 'string' || !value.trim() || !path.isAbsolute(value)) {
    throw fail(`${label} 必须是内部绝对路径`);
  }
  return value;
}

function assertDistinctOutput(outputPath, inputPaths) {
  if (inputPaths.includes(outputPath)) throw fail('媒体输出路径不能覆盖输入文件');
}

function runtime(deps = {}) {
  const env = deps.env || process.env;
  const ffmpegPath = deps.ffmpegPath
    || env.MEIAO_FFMPEG_PATH
    || resolvePackagedFfmpegPath();
  const ffprobePath = deps.ffprobePath
    || env.MEIAO_FFPROBE_PATH
    || resolvePackagedFfprobePath();
  assertAbsoluteFilePath(ffmpegPath, 'FFmpeg 路径');
  assertAbsoluteFilePath(ffprobePath, 'FFprobe 路径');
  const processTimeoutMs = boundedInteger(
    deps.processTimeoutMs ?? env.MEIAO_MEDIA_TRANSCODE_TIMEOUT_MS,
    DEFAULT_PROCESS_TIMEOUT_MS,
    MIN_PROCESS_TIMEOUT_MS,
    MAX_PROCESS_TIMEOUT_MS,
  );
  const probeTimeoutMs = boundedInteger(
    deps.probeTimeoutMs ?? env.MEIAO_MEDIA_PROBE_TIMEOUT_MS,
    DEFAULT_PROBE_TIMEOUT_MS,
    MIN_PROCESS_TIMEOUT_MS,
    MAX_PROCESS_TIMEOUT_MS,
  );
  const runProcess = deps.runProcess || ((command, args, options = {}) => (
    runVoiceoverProcess(command, args, {
      ...options,
      spawnImpl: deps.spawnImpl,
    })
  ));
  return {
    ffmpegPath,
    ffprobePath,
    processTimeoutMs,
    probeTimeoutMs,
    runProcess,
    statFile: deps.statFile || stat,
    inspectContainer: deps.inspectContainer || inspectMp4Container,
  };
}

function appendBoundedTail(current, chunk, limit) {
  const combined = Buffer.concat([current, Buffer.from(chunk)]);
  return combined.length <= limit ? combined : combined.subarray(combined.length - limit);
}

export function runVoiceoverProcess(command, args, {
  signal,
  timeoutMs = DEFAULT_PROCESS_TIMEOUT_MS,
  spawnImpl = spawn,
  maxStdoutBytes = MAX_STDOUT_BYTES,
  maxStderrBytes = MAX_STDERR_BYTES,
  terminationGraceMs = 250,
  terminationCloseTimeoutMs = 5_000,
} = {}) {
  assertAbsoluteFilePath(command, '媒体处理命令');
  if (!Array.isArray(args) || args.some((value) => typeof value !== 'string')) {
    return Promise.reject(fail('媒体处理参数无效'));
  }
  if (signal?.aborted) {
    return Promise.reject(fail('口播媒体处理已取消', { cancelled: true }));
  }
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnImpl(command, args, {
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      reject(fail('无法启动媒体处理进程', { cause: error?.message || String(error) }));
      return;
    }
    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    let callerSettled = false;
    let terminalError = null;
    let killTimer = null;
    let closeTimer = null;
    let resolveClosed;
    const closed = new Promise((resolve) => { resolveClosed = resolve; });

    const onStdout = (chunk) => {
      stdout = appendBoundedTail(stdout, chunk, maxStdoutBytes);
    };
    const onStderr = (chunk) => {
      stderr = appendBoundedTail(stderr, chunk, maxStderrBytes);
    };
    const cleanupAfterClose = () => {
      clearTimeout(timer);
      clearTimeout(killTimer);
      clearTimeout(closeTimer);
      signal?.removeEventListener('abort', onAbort);
      child.removeListener('error', onError);
      child.removeListener('close', onClose);
      child.stdout?.removeListener('data', onStdout);
      child.stderr?.removeListener('data', onStderr);
    };
    const settleCaller = (callback, value) => {
      if (callerSettled) return;
      callerSettled = true;
      callback(value);
    };
    const terminate = (error) => {
      if (terminalError) return;
      terminalError = error;
      child.kill('SIGTERM');
      killTimer = setTimeout(() => child.kill('SIGKILL'), boundedInteger(
        terminationGraceMs, 250, 1, 60_000,
      ));
      killTimer.unref?.();
      closeTimer = setTimeout(() => {
        if (callerSettled) return;
        Object.defineProperty(terminalError, 'releasePermitWhenClosed', {
          value: closed,
          enumerable: false,
        });
        signal?.removeEventListener('abort', onAbort);
        settleCaller(reject, terminalError);
      }, boundedInteger(terminationCloseTimeoutMs, 5_000, 1, 60_000));
      closeTimer.unref?.();
    };
    const onAbort = () => terminate(fail('口播媒体处理已取消', { cancelled: true }));
    const onError = (error) => {
      if (terminalError) return;
      terminate(fail('媒体处理进程启动失败', { cause: error?.message || String(error) }));
    };
    const onClose = (exitCode, processSignal) => {
      resolveClosed();
      const result = {
        stdout: stdout.toString('utf8'),
        stderr: stderr.toString('utf8'),
        exitCode,
        signal: processSignal || null,
      };
      if (terminalError) {
        settleCaller(reject, terminalError);
      } else if (exitCode === 0) {
        settleCaller(resolve, result);
      } else {
        settleCaller(reject, fail('媒体处理进程失败', result));
      }
      cleanupAfterClose();
    };
    const timer = setTimeout(() => {
      terminate(fail('口播媒体处理超时', {
        timedOut: true,
        stderr: stderr.toString('utf8'),
      }));
    }, boundedInteger(timeoutMs, DEFAULT_PROCESS_TIMEOUT_MS, 1, MAX_PROCESS_TIMEOUT_MS));
    timer.unref?.();

    child.stdout?.on('data', onStdout);
    child.stderr?.on('data', onStderr);
    child.once('error', onError);
    child.once('close', onClose);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export function parseVoiceoverProbeOutput(stdout, {
  requireAudio = false,
  noAudioCode = 'voiceover_mix_failed',
} = {}) {
  let payload;
  try {
    payload = JSON.parse(String(stdout || ''));
  } catch (error) {
    throw fail('FFprobe 返回了无效 JSON', { cause: error?.message || String(error) });
  }
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.streams)) {
    throw fail('FFprobe 返回缺少媒体流');
  }
  const video = payload.streams.find((stream) => stream?.codec_type === 'video');
  const audio = payload.streams.find((stream) => stream?.codec_type === 'audio');
  if (requireAudio && !audio) {
    if (noAudioCode === 'voiceover_source_has_no_audio') {
      throw buildVoiceoverError(noAudioCode, '源视频没有可用音轨');
    }
    throw fail('媒体文件没有可用音轨');
  }
  const finiteDuration = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  };
  const videoDurationSeconds = finiteDuration(video?.duration);
  const audioDurationSeconds = finiteDuration(audio?.duration);
  const formatDurationSeconds = finiteDuration(payload?.format?.duration);
  const durationSeconds = video
    ? (videoDurationSeconds ?? formatDurationSeconds)
    : (audioDurationSeconds ?? formatDurationSeconds);
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw fail('媒体时长无效');
  }
  const sampleRate = audio ? Number(audio.sample_rate || 0) : 0;
  const channels = audio ? Number(audio.channels || 0) : 0;
  return {
    durationMs: durationSeconds * 1000,
    durationSeconds,
    videoDurationMs: videoDurationSeconds === null ? null : videoDurationSeconds * 1000,
    audioDurationMs: audioDurationSeconds === null ? null : audioDurationSeconds * 1000,
    formatDurationMs: formatDurationSeconds === null ? null : formatDurationSeconds * 1000,
    formatNames: String(payload?.format?.format_name || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
    sizeBytes: Number(payload?.format?.size || 0),
    videoCodec: video?.codec_name || null,
    width: Number(video?.width || 0),
    height: Number(video?.height || 0),
    audioCodec: audio?.codec_name || null,
    sampleRate,
    channels,
    hasAudio: Boolean(audio),
  };
}

async function assertReadableFile(filePath, statFile) {
  let info;
  try {
    info = await statFile(filePath);
  } catch (error) {
    throw fail('媒体文件不存在或不可读', { cause: error?.message || String(error) });
  }
  if (!Number.isFinite(Number(info?.size)) || Number(info.size) <= 0) {
    throw fail('媒体文件为空');
  }
}

async function probeMedia(filePath, deps = {}, options = {}) {
  assertAbsoluteFilePath(filePath, '媒体文件');
  const tools = runtime(deps);
  await assertReadableFile(filePath, tools.statFile);
  let result;
  try {
    result = await tools.runProcess(
      tools.ffprobePath,
      ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', filePath],
      { signal: options.signal, timeoutMs: tools.probeTimeoutMs },
    );
  } catch (error) {
    if (error?.code === 'voiceover_source_has_no_audio') throw error;
    if (error?.code === 'voiceover_mix_failed') throw error;
    throw fail('无法读取媒体信息', { cause: error?.message || String(error) });
  }
  if ((result?.exitCode ?? 0) !== 0) {
    throw fail('FFprobe 读取媒体失败', { exitCode: result?.exitCode });
  }
  return parseVoiceoverProbeOutput(result?.stdout, options);
}

async function runCheckedFfmpeg(tools, args, signal) {
  let result;
  try {
    result = await tools.runProcess(tools.ffmpegPath, args, {
      signal,
      timeoutMs: tools.processTimeoutMs,
    });
  } catch (error) {
    if (error?.code === 'voiceover_mix_failed') throw error;
    throw fail(
      error?.name === 'AbortError' ? '口播媒体处理已取消' : '口播媒体处理失败',
      {
        cancelled: error?.name === 'AbortError',
        cause: error?.message || String(error),
      },
    );
  }
  if ((result?.exitCode ?? 0) !== 0) {
    throw fail('媒体处理进程失败', {
      exitCode: result?.exitCode,
      stderr: String(result?.stderr || '').slice(-MAX_STDERR_BYTES),
    });
  }
  return result;
}

export function probeVoiceoverAudio(filePath, deps = {}) {
  return probeMedia(filePath, deps, { requireAudio: true, signal: deps.signal });
}

export function buildExtractAudioArgs(inputVideoPath, outputWavPath) {
  assertAbsoluteFilePath(inputVideoPath, '输入视频');
  assertAbsoluteFilePath(outputWavPath, '输出音频');
  assertDistinctOutput(outputWavPath, [inputVideoPath]);
  return [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-i', inputVideoPath,
    '-map', '0:a:0',
    '-vn',
    '-ac', '2',
    '-ar', '48000',
    '-c:a', 'pcm_s16le',
    outputWavPath,
  ];
}

export function buildVocalOnlyVideoArgs(sourceVideoPath, vocalPath, outputPath) {
  assertAbsoluteFilePath(sourceVideoPath, '底片视频');
  assertAbsoluteFilePath(vocalPath, '人声轨');
  assertAbsoluteFilePath(outputPath, '分析视频');
  assertDistinctOutput(outputPath, [sourceVideoPath, vocalPath]);
  return [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-i', sourceVideoPath,
    '-i', vocalPath,
    '-map', '0:v:0',
    '-map', '1:a:0',
    '-c:v', 'copy',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-movflags', '+faststart',
    '-shortest',
    outputPath,
  ];
}

export function buildAnalysisAudioEvidenceArgs(vocalPath, outputPath) {
  assertAbsoluteFilePath(vocalPath, '人声轨');
  assertAbsoluteFilePath(outputPath, '分析音频');
  assertDistinctOutput(outputPath, [vocalPath]);
  return [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-i', vocalPath,
    '-map', '0:a:0',
    '-vn',
    '-ac', '1',
    '-ar', '16000',
    '-c:a', 'aac',
    '-b:a', '48k',
    '-movflags', '+faststart',
    '-f', 'mp4',
    outputPath,
  ];
}

function assertPcmWorkTrack(metadata, expectedChannels) {
  if (
    metadata.audioCodec !== 'pcm_s16le'
    || metadata.sampleRate !== 48000
    || metadata.channels !== expectedChannels
  ) {
    throw fail('口播工作音轨格式无效', {
      audioCodec: metadata.audioCodec,
      sampleRate: metadata.sampleRate,
      channels: metadata.channels,
    });
  }
}

export async function extractVoiceoverAudio({
  inputVideoPath,
  outputWavPath,
  signal,
  deps = {},
}) {
  const args = buildExtractAudioArgs(inputVideoPath, outputWavPath);
  const source = await probeMedia(inputVideoPath, deps, {
    requireAudio: true,
    noAudioCode: 'voiceover_source_has_no_audio',
    signal,
  });
  const tools = runtime(deps);
  await runCheckedFfmpeg(tools, args, signal);
  const output = await probeMedia(outputWavPath, deps, { requireAudio: true, signal });
  assertPcmWorkTrack(output, 2);
  return { ...output, sourceDurationMs: source.durationMs };
}

export async function validateVoiceoverOutput({
  path: outputPath,
  expectedDurationMs,
  toleranceMs,
  deps = {},
  signal,
}) {
  assertAbsoluteFilePath(outputPath, '输出视频');
  const expected = Number(expectedDurationMs);
  const tolerance = Number(toleranceMs);
  if (!Number.isFinite(expected) || expected <= 0 || !Number.isFinite(tolerance) || tolerance < 0) {
    throw fail('输出视频校验参数无效');
  }
  const metadata = await probeMedia(outputPath, deps, { requireAudio: true, signal });
  if (
    metadata.videoCodec !== 'h264'
    || metadata.audioCodec !== 'aac'
    || !Number.isFinite(metadata.width) || metadata.width <= 0
    || !Number.isFinite(metadata.height) || metadata.height <= 0
    || !Number.isFinite(metadata.channels) || metadata.channels <= 0
    || !Number.isFinite(metadata.sampleRate) || metadata.sampleRate <= 0
    || !metadata.formatNames.some((name) => name === 'mov' || name === 'mp4')
  ) {
    throw fail('口播视频编码或媒体流无效', metadata);
  }
  if (Math.abs(metadata.durationMs - expected) > tolerance) {
    throw fail('口播视频时长超出允许误差', {
      actualDurationMs: metadata.durationMs,
      expectedDurationMs: expected,
      toleranceMs: tolerance,
    });
  }
  const tools = runtime(deps);
  const container = await tools.inspectContainer(outputPath);
  if (container?.inspectable !== false && container?.fastStart !== true) {
    throw fail('口播视频未启用 faststart');
  }
  return { ...metadata, fastStart: container?.fastStart === true };
}

export async function buildVocalOnlyAnalysisVideo({
  sourceVideoPath,
  vocalPath,
  outputPath,
  config = {},
  signal,
  deps = {},
}) {
  const args = buildVocalOnlyVideoArgs(sourceVideoPath, vocalPath, outputPath);
  const source = await probeMedia(sourceVideoPath, deps, { signal });
  if (source.videoCodec !== 'h264' || source.width <= 0 || source.height <= 0) {
    throw fail('分析底片必须是有效 H.264 视频');
  }
  const vocal = await probeMedia(vocalPath, deps, { requireAudio: true, signal });
  assertPcmWorkTrack(vocal, 2);
  const tools = runtime(deps);
  await runCheckedFfmpeg(tools, args, signal);
  return validateVoiceoverOutput({
    path: outputPath,
    expectedDurationMs: source.durationMs,
    toleranceMs: Number.isFinite(Number(config.durationToleranceMs))
      ? Number(config.durationToleranceMs)
      : 100,
    deps,
    signal,
  });
}

export async function buildVoiceoverAnalysisAudioEvidence({
  vocalPath,
  outputPath,
  maxBytes,
  signal,
  deps = {},
}) {
  const normalizedMaxBytes = Number(maxBytes);
  if (!Number.isSafeInteger(normalizedMaxBytes) || normalizedMaxBytes <= 0) {
    throw analysisEvidenceFailure('分析音频大小门限无效');
  }
  const args = buildAnalysisAudioEvidenceArgs(vocalPath, outputPath);
  const vocal = await probeMedia(vocalPath, deps, { requireAudio: true, signal });
  assertPcmWorkTrack(vocal, 2);
  const tools = runtime(deps);
  await runCheckedFfmpeg(tools, args, signal);
  const output = await probeMedia(outputPath, deps, { requireAudio: true, signal });
  if (
    output.audioCodec !== 'aac'
    || output.sampleRate !== 16000
    || output.channels !== 1
    || !output.formatNames.some((name) => name === 'mov' || name === 'mp4' || name === 'm4a')
  ) {
    throw analysisEvidenceFailure('分析音频编码格式无效');
  }
  const fileInfo = await tools.statFile(outputPath);
  const declaredSize = Number(fileInfo?.size || 0);
  if (!Number.isSafeInteger(declaredSize) || declaredSize <= 0 || declaredSize > normalizedMaxBytes) {
    throw analysisEvidenceFailure('分析音频超过内联证据大小上限', {
      sizeBytes: declaredSize,
      maxBytes: normalizedMaxBytes,
    });
  }
  const fileBytes = await (deps.readFile || readFile)(outputPath);
  const buffer = Buffer.isBuffer(fileBytes) ? fileBytes : Buffer.from(fileBytes);
  if (!buffer.length || buffer.length > normalizedMaxBytes || buffer.length !== declaredSize) {
    throw analysisEvidenceFailure('分析音频字节校验失败', {
      sizeBytes: buffer.length,
      declaredSize,
      maxBytes: normalizedMaxBytes,
    });
  }
  return Object.freeze({
    data: buffer.toString('base64'),
    mimeType: 'audio/mp4',
    sizeBytes: buffer.length,
    durationMs: output.durationMs,
  });
}

export function calculateAtempo({
  actualDurationMs,
  targetDurationMs,
  minAtempo,
  maxAtempo,
}) {
  const actual = Number(actualDurationMs);
  const target = Number(targetDurationMs);
  const minimum = Number(minAtempo);
  const maximum = Number(maxAtempo);
  if (
    !Number.isFinite(actual) || actual <= 0
    || !Number.isFinite(target) || target <= 0
    || !Number.isFinite(minimum) || minimum <= 0
    || !Number.isFinite(maximum) || maximum <= 0
    || minimum > maximum
  ) {
    throw timingFailure('口播时长适配参数无效');
  }
  const ratio = actual / target;
  if (!Number.isFinite(ratio) || ratio > maximum) {
    throw timingFailure('口播时长无法安全适配', {
      actualDurationMs: actual,
      targetDurationMs: target,
      atempo: ratio,
    });
  }
  return Number(Math.max(ratio, minimum).toFixed(9));
}

function validateGroupWindows(groups, totalDurationMs, overlapToleranceMs) {
  if (!Array.isArray(groups) || groups.length === 0 || groups.length > VOICEOVER_MAX_TTS_GROUPS) {
    throw timingFailure('没有可安全对齐的口播组');
  }
  const total = Number(totalDurationMs);
  const tolerance = Number(overlapToleranceMs);
  if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(tolerance) || tolerance < 0) {
    throw timingFailure('口播时间轴参数无效');
  }
  const indexes = new Set();
  let previous = null;
  return groups.map((group) => {
    const index = Number(group?.index);
    const startMs = Number(group?.startMs);
    const endMs = Number(group?.endMs);
    if (
      !Number.isInteger(index) || index < 0 || index >= VOICEOVER_MAX_TTS_GROUPS || indexes.has(index)
      || !Number.isFinite(startMs) || startMs < 0
      || !Number.isFinite(endMs) || endMs <= startMs || endMs > total
      || (previous && (index <= previous.index || startMs < previous.startMs))
      || (previous && previous.endMs - startMs > tolerance)
    ) {
      throw timingFailure('口播组时间轴无效', { index, startMs, endMs });
    }
    const audioPath = assertAbsoluteFilePath(group?.audioPath, '口播组音频');
    indexes.add(index);
    const normalized = { ...group, index, startMs, endMs, audioPath };
    previous = normalized;
    return normalized;
  });
}

export function buildAlignmentArgs({
  groups,
  outputPath,
  totalDurationMs,
  config = {},
}) {
  assertAbsoluteFilePath(outputPath, '对齐音频');
  const normalized = validateGroupWindows(
    groups,
    totalDurationMs,
    Number(config.overlapToleranceMs ?? 0),
  );
  assertDistinctOutput(outputPath, normalized.map((group) => group.audioPath));
  const totalSeconds = Number(totalDurationMs) / 1000;
  const fadeMs = Number(config.fadeMs ?? 40);
  if (!Number.isFinite(fadeMs) || fadeMs < 0) throw timingFailure('淡入淡出配置无效');
  const filters = normalized.map((group, inputIndex) => {
    const durationSeconds = (group.endMs - group.startMs) / 1000;
    const ratio = calculateAtempo({
      actualDurationMs: group.actualDurationMs,
      targetDurationMs: group.endMs - group.startMs,
      minAtempo: config.minAtempo,
      maxAtempo: config.maxAtempo,
    });
    const alignedVoiceSeconds = Math.min(
      durationSeconds,
      Number(group.actualDurationMs) / 1000 / ratio,
    );
    const residualSilenceMs = Math.max(0, (
      (group.endMs - group.startMs)
      - (Number(group.actualDurationMs) / ratio)
    ));
    const delayMs = group.startMs + (residualSilenceMs / 2);
    const fadeSeconds = Math.min(fadeMs / 1000, alignedVoiceSeconds / 2);
    const fadeOutStart = Math.max(0, alignedVoiceSeconds - fadeSeconds);
    return [
      `[${inputIndex}:a]aresample=48000`,
      'pan=mono|c0=c0',
      `atempo=${formatNumber(ratio)}`,
      `afade=t=in:st=0:d=${formatNumber(fadeSeconds)}`,
      `afade=t=out:st=${formatNumber(fadeOutStart)}:d=${formatNumber(fadeSeconds)}`,
      `adelay=${formatNumber(delayMs)}|${formatNumber(delayMs)}[voice_${inputIndex}]`,
    ].join(',');
  });
  filters.push(
    `anullsrc=r=48000:cl=mono,atrim=duration=${formatNumber(totalSeconds)},volume=0[bed]`,
  );
  const mixInputs = ['[bed]', ...normalized.map((_, index) => `[voice_${index}]`)].join('');
  filters.push(
    `${mixInputs}amix=inputs=${normalized.length + 1}:duration=longest:normalize=0,`
    + `atrim=duration=${formatNumber(totalSeconds)},aresample=48000,`
    + 'aformat=sample_fmts=s16:channel_layouts=mono[out]',
  );
  const filterGraph = filters.join(';');
  const args = ['-hide_banner', '-loglevel', 'error', '-y'];
  for (const group of normalized) args.push('-i', group.audioPath);
  args.push(
    '-filter_complex', filterGraph,
    '-map', '[out]',
    '-ar', '48000',
    '-ac', '1',
    '-c:a', 'pcm_s16le',
    outputPath,
  );
  return { args, filterGraph };
}

export async function alignVoiceoverGroups({
  groups,
  outputPath,
  totalDurationMs,
  config = {},
  signal,
  deps = {},
}) {
  const normalized = validateGroupWindows(
    groups,
    totalDurationMs,
    Number(config.overlapToleranceMs ?? 0),
  );
  const withDurations = [];
  for (const group of normalized) {
    const metadata = await probeMedia(group.audioPath, deps, { requireAudio: true, signal });
    withDurations.push({ ...group, actualDurationMs: metadata.durationMs });
  }
  const { args } = buildAlignmentArgs({
    groups: withDurations,
    outputPath,
    totalDurationMs,
    config,
  });
  const tools = runtime(deps);
  await runCheckedFfmpeg(tools, args, signal);
  const output = await probeMedia(outputPath, deps, { requireAudio: true, signal });
  assertPcmWorkTrack(output, 1);
  const tolerance = Number(config.durationToleranceMs ?? 100);
  if (!Number.isFinite(tolerance) || tolerance < 0
    || Math.abs(output.durationMs - Number(totalDurationMs)) > tolerance) {
    throw fail('对齐口播音轨时长无效');
  }
  return {
    ...output,
    groups: withDurations.map((group) => ({
      index: group.index,
      actualDurationMs: group.actualDurationMs,
      atempo: calculateAtempo({
        actualDurationMs: group.actualDurationMs,
        targetDurationMs: group.endMs - group.startMs,
        minAtempo: config.minAtempo,
        maxAtempo: config.maxAtempo,
      }),
    })),
  };
}

function validateContinuousTurns(
  turns,
  totalDurationMs,
  sourceDurationMs,
  overlapToleranceMs,
) {
  if (!Array.isArray(turns) || !turns.length || turns.length > VOICEOVER_MAX_TTS_GROUPS) {
    throw timingFailure('没有可安全对齐的连续口播组');
  }
  const total = Number(totalDurationMs);
  const sourceDuration = Number(sourceDurationMs);
  const tolerance = Number(overlapToleranceMs);
  if (!Number.isFinite(total) || total <= 0
    || !Number.isFinite(sourceDuration) || sourceDuration <= 0
    || !Number.isFinite(tolerance) || tolerance < 0) {
    throw timingFailure('连续口播时间轴参数无效');
  }
  let previous = null;
  return turns.map((turn, position) => {
    const index = Number(turn?.index);
    const startMs = Number(turn?.startMs);
    const endMs = Number(turn?.endMs);
    const sourceStartMs = Number(turn?.sourceStartMs);
    const sourceEndMs = Number(turn?.sourceEndMs);
    const actualDurationMs = Number(turn?.actualDurationMs);
    if (!Number.isInteger(index) || index !== position
      || !Number.isInteger(startMs) || !Number.isInteger(endMs)
      || startMs < 0 || endMs <= startMs || endMs > total
      || !Number.isInteger(sourceStartMs) || !Number.isInteger(sourceEndMs)
      || sourceStartMs < 0 || sourceEndMs <= sourceStartMs
      || sourceEndMs > sourceDuration
      || !Number.isInteger(actualDurationMs)
      || actualDurationMs !== sourceEndMs - sourceStartMs
      || (previous && previous.endMs - startMs > tolerance)
      || (previous && sourceStartMs < previous.sourceEndMs)) {
      throw timingFailure('连续口播声学边界无效', {
        index,
        startMs,
        endMs,
        sourceStartMs,
        sourceEndMs,
      });
    }
    const normalized = {
      index,
      startMs,
      endMs,
      sourceStartMs,
      sourceEndMs,
      actualDurationMs,
    };
    previous = normalized;
    return normalized;
  });
}

export function buildContinuousAlignmentArgs({
  audioPath,
  turns,
  outputPath,
  totalDurationMs,
  sourceDurationMs,
  config = {},
}) {
  const sourcePath = assertAbsoluteFilePath(audioPath, '连续口播音频');
  assertAbsoluteFilePath(outputPath, '对齐音频');
  assertDistinctOutput(outputPath, [sourcePath]);
  const normalized = validateContinuousTurns(
    turns,
    totalDurationMs,
    sourceDurationMs,
    Number(config.overlapToleranceMs ?? 0),
  );
  const fadeMs = Number(config.fadeMs ?? 40);
  if (!Number.isFinite(fadeMs) || fadeMs < 0) throw timingFailure('淡入淡出配置无效');
  const groups = normalized.map((turn) => {
    const atempo = calculateAtempo({
      actualDurationMs: turn.actualDurationMs,
      targetDurationMs: turn.endMs - turn.startMs,
      minAtempo: config.minAtempo,
      maxAtempo: config.maxAtempo,
    });
    return { ...turn, atempo };
  });
  const filters = [
    `[0:a]aresample=48000,pan=mono|c0=c0,asplit=${groups.length}`
      + groups.map(({ index }) => `[continuous_${index}]`).join(''),
  ];
  for (const group of groups) {
    const alignedVoiceSeconds = Math.min(
      (group.endMs - group.startMs) / 1000,
      group.actualDurationMs / 1000 / group.atempo,
    );
    const residualSilenceMs = Math.max(
      0,
      (group.endMs - group.startMs) - (group.actualDurationMs / group.atempo),
    );
    const delayMs = group.startMs + (residualSilenceMs / 2);
    const fadeSeconds = Math.min(fadeMs / 1000, alignedVoiceSeconds / 2);
    const fadeOutStart = Math.max(0, alignedVoiceSeconds - fadeSeconds);
    filters.push([
      `[continuous_${group.index}]atrim=start=${formatNumber(group.sourceStartMs / 1000)}`
        + `:end=${formatNumber(group.sourceEndMs / 1000)}`,
      'asetpts=PTS-STARTPTS',
      `atempo=${formatNumber(group.atempo)}`,
      `afade=t=in:st=0:d=${formatNumber(fadeSeconds)}`,
      `afade=t=out:st=${formatNumber(fadeOutStart)}:d=${formatNumber(fadeSeconds)}`,
      `adelay=${formatNumber(delayMs)}|${formatNumber(delayMs)}[voice_${group.index}]`,
    ].join(','));
  }
  const totalSeconds = Number(totalDurationMs) / 1000;
  filters.push(
    `anullsrc=r=48000:cl=mono,atrim=duration=${formatNumber(totalSeconds)},volume=0[bed]`,
  );
  const mixInputs = ['[bed]', ...groups.map(({ index }) => `[voice_${index}]`)].join('');
  filters.push(
    `${mixInputs}amix=inputs=${groups.length + 1}:duration=longest:normalize=0,`
    + `atrim=duration=${formatNumber(totalSeconds)},aresample=48000,`
    + 'aformat=sample_fmts=s16:channel_layouts=mono[out]',
  );
  const filterGraph = filters.join(';');
  return {
    args: [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-i', sourcePath,
      '-filter_complex', filterGraph,
      '-map', '[out]',
      '-ar', '48000',
      '-ac', '1',
      '-c:a', 'pcm_s16le',
      outputPath,
    ],
    filterGraph,
    groups,
  };
}

export async function alignContinuousVoiceover({
  audioPath,
  turns,
  outputPath,
  totalDurationMs,
  config = {},
  signal,
  deps = {},
}) {
  assertAbsoluteFilePath(audioPath, '连续口播音频');
  assertAbsoluteFilePath(outputPath, '对齐音频');
  assertDistinctOutput(outputPath, [audioPath]);
  const source = await probeMedia(audioPath, deps, { requireAudio: true, signal });
  const built = buildContinuousAlignmentArgs({
    audioPath,
    turns,
    outputPath,
    totalDurationMs,
    sourceDurationMs: source.durationMs,
    config,
  });
  const tools = runtime(deps);
  await runCheckedFfmpeg(tools, built.args, signal);
  const output = await probeMedia(outputPath, deps, { requireAudio: true, signal });
  assertPcmWorkTrack(output, 1);
  const tolerance = Number(config.durationToleranceMs ?? 100);
  if (!Number.isFinite(tolerance) || tolerance < 0
    || Math.abs(output.durationMs - Number(totalDurationMs)) > tolerance) {
    throw fail('连续对齐口播音轨时长无效');
  }
  return {
    ...output,
    groups: built.groups,
  };
}

export function buildFinalMixArgs({
  baseVideoPath,
  narrationPath,
  outputPath,
  durationMs,
}) {
  for (const [value, label] of [
    [baseVideoPath, '底片视频'],
    [narrationPath, '口播音轨'],
    [outputPath, '最终视频'],
  ]) assertAbsoluteFilePath(value, label);
  assertDistinctOutput(outputPath, [
    baseVideoPath,
    narrationPath,
  ]);
  const duration = Number(durationMs);
  if (!Number.isFinite(duration) || duration <= 0) throw fail('最终视频时长无效');
  const seconds = formatNumber(duration / 1000);
  const filterGraph = '[1:a]aresample=48000,pan=stereo|c0=c0|c1=c0,'
    + `alimiter=limit=0.8912509381:level=0,atrim=duration=${seconds}[mixed]`;
  return {
    filterGraph,
    args: [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-i', baseVideoPath,
      '-i', narrationPath,
      '-filter_complex', filterGraph,
      '-map', '0:v:0',
      '-map', '[mixed]',
      '-c:v', 'copy',
      '-c:a', 'aac',
      '-b:a', '192k',
      '-movflags', '+faststart',
      '-shortest',
      outputPath,
    ],
  };
}

export async function mixVoiceoverResult({
  baseVideoPath,
  narrationPath,
  outputPath,
  config = {},
  signal,
  deps = {},
}) {
  const base = await probeMedia(baseVideoPath, deps, { signal });
  if (base.videoCodec !== 'h264' || base.width <= 0 || base.height <= 0) {
    throw fail('最终底片必须是有效 H.264 视频');
  }
  const narration = await probeMedia(narrationPath, deps, { requireAudio: true, signal });
  assertPcmWorkTrack(narration, 1);
  const { args } = buildFinalMixArgs({
    baseVideoPath,
    narrationPath,
    outputPath,
    durationMs: base.durationMs,
  });
  const tools = runtime(deps);
  await runCheckedFfmpeg(tools, args, signal);
  return validateVoiceoverOutput({
    path: outputPath,
    expectedDurationMs: base.durationMs,
    toleranceMs: Number(config.durationToleranceMs ?? 100),
    deps,
    signal,
  });
}
