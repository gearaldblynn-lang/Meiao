import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';

import {
  buildAudioTranscodeArgs,
  buildVideoTranscodeArgs,
  createMediaTranscodeError,
  validateTranscodedOutput,
} from './mediaTranscodeContract.mjs';

const require = createRequire(import.meta.url);

function resolvePackagedFfmpegPath() {
  try {
    return require('ffmpeg-static');
  } catch {
    return null;
  }
}

function resolvePackagedFfprobePath() {
  try {
    return require('@ffprobe-installer/ffprobe')?.path || null;
  } catch {
    return null;
  }
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseEnabled(value, fallback = true) {
  if (value == null || value === '') return fallback;
  return !['0', 'false', 'off', 'no'].includes(String(value).trim().toLowerCase());
}

function parseFrameRate(value) {
  if (typeof value === 'number') return value;
  const [numerator, denominator = '1'] = String(value || '').split('/');
  const top = Number(numerator);
  const bottom = Number(denominator);
  if (!Number.isFinite(top) || !Number.isFinite(bottom) || bottom === 0) return 0;
  return Number((top / bottom).toFixed(2));
}

export function parseFfprobeOutput(stdout, kind) {
  let payload;
  try {
    payload = JSON.parse(String(stdout || '{}'));
  } catch (error) {
    throw createMediaTranscodeError('media_probe_invalid_output', '无法解析媒体信息', {
      cause: error?.message || String(error),
    });
  }
  const streams = Array.isArray(payload?.streams) ? payload.streams : [];
  const videoStream = streams.find((stream) => stream?.codec_type === 'video');
  const audioStream = streams.find((stream) => stream?.codec_type === 'audio');
  const format = payload?.format || {};
  const result = {
    kind,
    durationSeconds: Number(format.duration || 0),
    formatNames: String(format.format_name || '').split(',').map((item) => item.trim()).filter(Boolean),
    audioCodec: audioStream?.codec_name || null,
    sizeBytes: Number(format.size || 0),
  };
  if (kind === 'video') {
    return {
      ...result,
      videoCodec: videoStream?.codec_name || null,
      width: Number(videoStream?.width || 0),
      height: Number(videoStream?.height || 0),
      frameRate: parseFrameRate(videoStream?.avg_frame_rate || videoStream?.r_frame_rate),
      hasAudio: Boolean(audioStream),
    };
  }
  return result;
}

export function runMediaProcess(command, args, { signal, timeoutMs = 600_000 } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      return;
    }
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const maxCapturedCharacters = 2 * 1024 * 1024;

    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      callback(value);
    };
    const abort = () => {
      child.kill('SIGKILL');
      finish(reject, Object.assign(new Error('aborted'), { name: 'AbortError' }));
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(reject, createMediaTranscodeError('media_process_timeout', '媒体处理超时'));
    }, timeoutMs);
    timer.unref?.();

    signal?.addEventListener('abort', abort, { once: true });
    child.stdout.on('data', (chunk) => {
      if (stdout.length < maxCapturedCharacters) stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      if (stderr.length < maxCapturedCharacters) stderr += chunk.toString();
    });
    child.once('error', (error) => finish(reject, error));
    child.once('close', (exitCode) => {
      if (exitCode === 0) {
        finish(resolve, { stdout, stderr, exitCode });
        return;
      }
      finish(reject, createMediaTranscodeError('media_process_failed', '媒体处理失败', {
        exitCode,
        stderr: stderr.slice(-4000),
      }));
    });
  });
}

function createSemaphore(limit) {
  let active = 0;
  const queue = [];
  const pump = () => {
    while (active < limit && queue.length > 0) {
      const entry = queue.shift();
      if (entry.signal?.aborted) {
        entry.reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        continue;
      }
      active += 1;
      entry.resolve(() => {
        active = Math.max(0, active - 1);
        pump();
      });
    }
  };
  return {
    acquire(signal) {
      return new Promise((resolve, reject) => {
        queue.push({ resolve, reject, signal });
        pump();
      });
    },
    status() {
      return { active, queued: queue.filter((entry) => !entry.signal?.aborted).length };
    },
  };
}

export function createMediaTranscodeService({
  env = process.env,
  ffmpegPath = env.MEIAO_FFMPEG_PATH || resolvePackagedFfmpegPath() || 'ffmpeg',
  ffprobePath = env.MEIAO_FFPROBE_PATH || resolvePackagedFfprobePath() || 'ffprobe',
  runProcess = runMediaProcess,
  readOutput = readFile,
} = {}) {
  const enabled = parseEnabled(env.MEIAO_MEDIA_TRANSCODE_ENABLED, true);
  const concurrency = parsePositiveInteger(env.MEIAO_MEDIA_TRANSCODE_CONCURRENCY, 1);
  const transcodeTimeoutMs = parsePositiveInteger(env.MEIAO_MEDIA_TRANSCODE_TIMEOUT_MS, 600_000);
  const probeTimeoutMs = parsePositiveInteger(env.MEIAO_MEDIA_PROBE_TIMEOUT_MS, 30_000);
  const semaphore = createSemaphore(concurrency);
  const controllers = new Map();

  const probe = async (filePath, kind, signal) => {
    const { stdout, exitCode = 0 } = await runProcess(
      ffprobePath,
      ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', filePath],
      { signal, timeoutMs: probeTimeoutMs },
    );
    if (exitCode !== 0) {
      throw createMediaTranscodeError('media_probe_failed', '无法读取媒体信息', { exitCode });
    }
    return parseFfprobeOutput(stdout, kind);
  };

  return {
    async checkReadiness() {
      if (!enabled) return { enabled: false, ffmpegReady: false, ffprobeReady: false };
      const check = async (command) => {
        try {
          const result = await runProcess(command, ['-version'], { timeoutMs: probeTimeoutMs });
          return (result?.exitCode ?? 0) === 0;
        } catch {
          return false;
        }
      };
      const [ffmpegReady, ffprobeReady] = await Promise.all([check(ffmpegPath), check(ffprobePath)]);
      return { enabled, ffmpegReady, ffprobeReady };
    },

    getStatus() {
      return { enabled, ...semaphore.status() };
    },

    probe,

    cancel(sessionId) {
      const controller = controllers.get(sessionId);
      if (!controller) return false;
      controller.abort();
      return true;
    },

    async transcode({
      sessionId,
      kind,
      inputPath,
      outputPath,
      startSeconds,
      endSeconds,
      width,
      height,
      hasAudio = false,
      signal,
    }) {
      if (!enabled) {
        throw createMediaTranscodeError('media_transcode_disabled', '媒体转码功能当前未启用');
      }
      const controller = new AbortController();
      const abortFromParent = () => controller.abort();
      signal?.addEventListener('abort', abortFromParent, { once: true });
      controllers.set(sessionId, controller);
      let release;
      try {
        release = await semaphore.acquire(controller.signal);
        const args = kind === 'video'
          ? buildVideoTranscodeArgs({
            inputPath,
            outputPath,
            startSeconds,
            endSeconds,
            width,
            height,
            hasAudio,
          })
          : buildAudioTranscodeArgs({ inputPath, outputPath, startSeconds, endSeconds });
        const processResult = await runProcess(ffmpegPath, args, {
          signal: controller.signal,
          timeoutMs: transcodeTimeoutMs,
        });
        if ((processResult?.exitCode ?? 0) !== 0) {
          throw createMediaTranscodeError('media_process_failed', '媒体转码失败', {
            exitCode: processResult?.exitCode,
          });
        }
        const outputMetadata = await probe(outputPath, kind, controller.signal);
        validateTranscodedOutput(kind, outputMetadata);
        const fileBuffer = await readOutput(outputPath);
        return {
          fileBuffer,
          metadata: outputMetadata,
          fileName: kind === 'video' ? 'converted.mp4' : 'converted.mp3',
          mimeType: kind === 'video' ? 'video/mp4' : 'audio/mpeg',
        };
      } catch (error) {
        if (controller.signal.aborted || error?.name === 'AbortError') {
          throw createMediaTranscodeError('media_transcode_cancelled', '媒体转码已取消');
        }
        throw error;
      } finally {
        release?.();
        controllers.delete(sessionId);
        signal?.removeEventListener('abort', abortFromParent);
      }
    },
  };
}
