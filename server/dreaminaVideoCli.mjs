import { execFile } from 'node:child_process';
import { buildDreaminaCommandEnv, resolveDreaminaBinary } from './dreaminaCli.mjs';

const DEFAULT_VIDEO_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_BUFFER = 4 * 1024 * 1024;
const DREAMINA_VIDEO_MODES = new Set(['image2video', 'frames2video', 'multiframe2video', 'multimodal2video']);

const normalizeOutput = (stdout = '', stderr = '') =>
  [stdout, stderr].map((item) => String(item || '').trim()).filter(Boolean).join('\n').trim();

const parseJsonPayload = (text = '') => {
  const trimmed = String(text || '').trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
};

const findFirst = (text, patterns) => {
  for (const pattern of patterns) {
    const match = String(text || '').match(pattern);
    if (match?.[1]) return match[1].trim().replace(/[，。,.]+$/, '');
  }
  return '';
};

const firstArray = (value) => (Array.isArray(value) ? value : []);

const pushStringFlag = (args, name, value) => {
  const normalized = String(value || '').trim();
  if (normalized) args.push(`--${name}=${normalized}`);
};

const pushNumberFlag = (args, name, value) => {
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed > 0) args.push(`--${name}=${parsed}`);
};

const findVideoUrlRecursively = (value, depth = 0) => {
  if (!value || depth > 8) return '';
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (/^https?:\/\/\S+/i.test(trimmed)) {
      const urlMatch = trimmed.match(/https?:\/\/[^\s"',，。)]+/i);
      return urlMatch?.[0] || trimmed;
    }
    return '';
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findVideoUrlRecursively(item, depth + 1);
      if (found) return found;
    }
    return '';
  }
  if (typeof value !== 'object') return '';
  const priorityKeys = ['video_url', 'videoUrl', 'url', 'download_url', 'downloadUrl', 'play_url', 'playUrl', 'uri', 'result_url', 'resultUrl', 'resultUrls'];
  for (const key of priorityKeys) {
    if (value[key]) {
      const found = findVideoUrlRecursively(value[key], depth + 1);
      if (found) return found;
    }
  }
  for (const child of Object.values(value)) {
    const found = findVideoUrlRecursively(child, depth + 1);
    if (found) return found;
  }
  return '';
};

export const buildDreaminaVideoCommandArgs = (mode, options = {}) => {
  const normalizedMode = String(mode || '').trim();
  if (!DREAMINA_VIDEO_MODES.has(normalizedMode)) {
    throw new Error(`不支持的即梦视频模式：${normalizedMode || '未知'}`);
  }

  const args = [normalizedMode];
  if (normalizedMode === 'image2video') {
    pushStringFlag(args, 'image', options.image || firstArray(options.images)[0]);
    pushStringFlag(args, 'prompt', options.prompt);
    pushNumberFlag(args, 'duration', options.duration);
    pushStringFlag(args, 'video_resolution', options.videoResolution || options.video_resolution);
    pushStringFlag(args, 'model_version', options.modelVersion || options.model_version);
  }

  if (normalizedMode === 'frames2video') {
    const images = firstArray(options.images).map((item) => String(item || '').trim()).filter(Boolean);
    pushStringFlag(args, 'first', options.first || images[0]);
    pushStringFlag(args, 'last', options.last || images[1]);
    pushStringFlag(args, 'prompt', options.prompt);
    pushNumberFlag(args, 'duration', options.duration);
    pushStringFlag(args, 'video_resolution', options.videoResolution || options.video_resolution);
    pushStringFlag(args, 'model_version', options.modelVersion || options.model_version);
  }

  if (normalizedMode === 'multiframe2video') {
    const images = firstArray(options.images).map((item) => String(item || '').trim()).filter(Boolean);
    if (images.length > 0) args.push(`--images=${images.join(',')}`);
    pushStringFlag(args, 'prompt', options.prompt);
    pushNumberFlag(args, 'duration', options.duration);
    firstArray(options.transitionPrompts || options.transition_prompts).forEach((item) => pushStringFlag(args, 'transition-prompt', item));
    firstArray(options.transitionDurations || options.transition_durations).forEach((item) => pushStringFlag(args, 'transition-duration', item));
  }

  if (normalizedMode === 'multimodal2video') {
    firstArray(options.images).forEach((item) => pushStringFlag(args, 'image', item));
    firstArray(options.videos).forEach((item) => pushStringFlag(args, 'video', item));
    firstArray(options.audios).forEach((item) => pushStringFlag(args, 'audio', item));
    pushStringFlag(args, 'prompt', options.prompt);
    pushNumberFlag(args, 'duration', options.duration);
    pushStringFlag(args, 'ratio', options.ratio);
    pushStringFlag(args, 'video_resolution', options.videoResolution || options.video_resolution);
    pushStringFlag(args, 'model_version', options.modelVersion || options.model_version);
  }

  pushNumberFlag(args, 'session', options.session);
  if (options.poll !== undefined) {
    const poll = Math.max(0, Number(options.poll));
    if (Number.isFinite(poll)) args.push(`--poll=${poll}`);
  }
  return args;
};

export const buildDreaminaQueryResultArgs = ({ submitId, downloadDir } = {}) => {
  const normalizedSubmitId = String(submitId || '').trim();
  if (!normalizedSubmitId) throw new Error('缺少即梦 submit_id，无法查询视频结果。');
  const args = ['query_result', `--submit_id=${normalizedSubmitId}`];
  pushStringFlag(args, 'download_dir', downloadDir);
  return args;
};

export const parseDreaminaVideoOutput = (stdout = '', stderr = '') => {
  const rawOutput = normalizeOutput(stdout, stderr);
  const jsonPayload = parseJsonPayload(rawOutput);
  const source = jsonPayload && typeof jsonPayload === 'object' ? jsonPayload : {};
  const submitId = String(
    source.submit_id
    || source.submitId
    || source.id
    || findFirst(rawOutput, [
      /submit_id\s*[:：=]\s*([A-Za-z0-9._-]+)/i,
      /submitId\s*[:：=]\s*([A-Za-z0-9._-]+)/i,
      /任务\s*ID\s*[:：=]\s*([A-Za-z0-9._-]+)/i,
    ])
    || ''
  ).trim();
  const rawStatus = String(
    source.gen_status
    || source.genStatus
    || source.status
    || findFirst(rawOutput, [/gen_status\s*[:：=]\s*([A-Za-z0-9._-]+)/i, /status\s*[:：=]\s*([A-Za-z0-9._-]+)/i])
    || ''
  ).trim().toLowerCase();
  const videoUrl = findVideoUrlRecursively(source) || findFirst(rawOutput, [/(https?:\/\/\S+\.(?:mp4|mov|webm)(?:\?\S*)?)/i]);
  const failReason = String(
    source.fail_reason
    || source.failReason
    || source.error
    || source.message
    || findFirst(rawOutput, [/fail_reason\s*[:：=]\s*(.+)$/im, /error\s*[:：=]\s*(.+)$/im])
    || ''
  ).trim();
  const status = videoUrl
    ? 'success'
    : /success|succeeded|done|completed|complete|成功/i.test(rawStatus)
      ? 'success'
      : /fail|failed|error|失败/i.test(rawStatus)
        ? 'failed'
        : 'querying';

  return {
    submitId,
    status,
    videoUrl,
    failReason,
    rawOutput,
    jsonPayload,
  };
};

const runDreaminaCommand = (args, options = {}) => {
  const env = options.env || process.env;
  const binary = resolveDreaminaBinary(env);
  const commandEnv = buildDreaminaCommandEnv(env);
  return new Promise((resolve, reject) => {
    execFile(binary, args, {
      env: commandEnv,
      timeout: options.timeoutMs || DEFAULT_VIDEO_TIMEOUT_MS,
      maxBuffer: DEFAULT_MAX_BUFFER,
    }, (error, stdout, stderr) => {
      const result = { binary, args, stdout: String(stdout || ''), stderr: String(stderr || '') };
      if (error) {
        error.stdout = result.stdout;
        error.stderr = result.stderr;
        error.binary = binary;
        error.args = args;
        reject(error);
        return;
      }
      resolve(result);
    });
  });
};

export const submitDreaminaVideoTask = async (mode, options = {}) => {
  const args = buildDreaminaVideoCommandArgs(mode, { ...options, poll: options.poll ?? 0 });
  const result = await runDreaminaCommand(args, options);
  return parseDreaminaVideoOutput(result.stdout, result.stderr);
};

export const queryDreaminaVideoTask = async ({ submitId, downloadDir, env, timeoutMs } = {}) => {
  const args = buildDreaminaQueryResultArgs({ submitId, downloadDir });
  const result = await runDreaminaCommand(args, { env, timeoutMs });
  return parseDreaminaVideoOutput(result.stdout, result.stderr);
};
