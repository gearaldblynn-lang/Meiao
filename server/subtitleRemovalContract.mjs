import {
  clampSubtitleRegion,
  subtitleRegionToPixels,
} from '../src/utils/subtitleRemovalRegion.mjs';

export const SUBTITLE_REMOVAL_DEFAULTS = Object.freeze({
  baseUrl: 'https://goodline.simplemokey.com/api/openAi',
  pollIntervalMs: 5_000,
  timeoutMs: 1_800_000,
  minPollIntervalMs: 2_000,
  maxPollIntervalMs: 30_000,
  minTimeoutMs: 300_000,
  maxTimeoutMs: 7_200_000,
  maxDurationSeconds: 600,
});

export function createSubtitleRemovalError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, details);
  return error;
}

const parseEnabled = (value, fallback = false) => {
  if (value == null || value === '') return fallback;
  return ['1', 'true', 'on', 'yes'].includes(String(value).trim().toLowerCase());
};

const boundedInteger = (value, fallback, min, max) => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
};

const normalizeBaseUrl = (value) => {
  const candidate = String(value || '').trim().replace(/\/+$/u, '');
  if (!candidate) return SUBTITLE_REMOVAL_DEFAULTS.baseUrl;
  try {
    const parsed = new URL(candidate);
    return ['http:', 'https:'].includes(parsed.protocol)
      ? candidate
      : SUBTITLE_REMOVAL_DEFAULTS.baseUrl;
  } catch {
    return SUBTITLE_REMOVAL_DEFAULTS.baseUrl;
  }
};

export function getSubtitleRemovalConfig(env = {}) {
  const token = String(env.GOLDEN_SUBTITLE_API_TOKEN || '').trim();
  return {
    enabled: parseEnabled(env.MEIAO_SUBTITLE_REMOVAL_ENABLED, false),
    configured: Boolean(token),
    baseUrl: normalizeBaseUrl(env.MEIAO_SUBTITLE_REMOVAL_BASE_URL),
    pollIntervalMs: boundedInteger(
      env.MEIAO_SUBTITLE_REMOVAL_POLL_INTERVAL_MS,
      SUBTITLE_REMOVAL_DEFAULTS.pollIntervalMs,
      SUBTITLE_REMOVAL_DEFAULTS.minPollIntervalMs,
      SUBTITLE_REMOVAL_DEFAULTS.maxPollIntervalMs,
    ),
    timeoutMs: boundedInteger(
      env.MEIAO_SUBTITLE_REMOVAL_TIMEOUT_MS,
      SUBTITLE_REMOVAL_DEFAULTS.timeoutMs,
      SUBTITLE_REMOVAL_DEFAULTS.minTimeoutMs,
      SUBTITLE_REMOVAL_DEFAULTS.maxTimeoutMs,
    ),
  };
}

const positiveNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

export function assertSubtitleRemovalInput(input = {}) {
  const sourceUrl = String(input.sourceUrl || '').trim();
  const sizeBytes = positiveNumber(input.sizeBytes);
  const durationSeconds = positiveNumber(input.durationSeconds);
  const width = Math.round(positiveNumber(input.width));
  const height = Math.round(positiveNumber(input.height));
  if (!/^https?:\/\//iu.test(sourceUrl)) {
    throw createSubtitleRemovalError('subtitle_video_invalid_source', '请选择可用的托管视频');
  }
  if (!sizeBytes || !durationSeconds || !width || !height) {
    throw createSubtitleRemovalError('subtitle_video_invalid_metadata', '无法读取视频的时长或分辨率');
  }
  if (durationSeconds > SUBTITLE_REMOVAL_DEFAULTS.maxDurationSeconds) {
    throw createSubtitleRemovalError('subtitle_video_too_long', '单个视频最长支持 600 秒，请先裁剪后再提交');
  }
  const region = clampSubtitleRegion(input.region);
  const subtitleRegionPixels = subtitleRegionToPixels(region, width, height);
  return {
    sourceUrl,
    sizeBytes,
    durationSeconds,
    width,
    height,
    region,
    subtitleRegionPixels,
  };
}

export function buildSubtitleRemovalSubmitBody(input = {}) {
  const validated = assertSubtitleRemovalInput(input);
  const { x1, y1, x2, y2 } = validated.subtitleRegionPixels;
  return {
    biz: 'aiRemoveSubtitleSubmitTask',
    fileSize: Number((validated.sizeBytes / (1024 * 1024)).toFixed(2)),
    duration: Math.ceil(validated.durationSeconds),
    resolution: `${validated.width}x${validated.height}`,
    videoName: `${x1}_${y1}_${x2}_${y2}`,
    coverUrl: '',
    url: validated.sourceUrl,
  };
}

const providerMessage = (body, fallback) => String(body?.msg || fallback || '').trim().slice(0, 500);

const assertProviderCode = (body, fallbackMessage) => {
  const code = Number(body?.code);
  if (code === 0) return;
  if (code === -25) {
    throw createSubtitleRemovalError(
      'provider_balance_insufficient',
      '去字幕服务余额不足，请联系管理员充值',
      { providerMessage: providerMessage(body, fallbackMessage), providerStatus: 'balance_insufficient' },
    );
  }
  throw createSubtitleRemovalError(
    'provider_bad_response',
    providerMessage(body, fallbackMessage),
    { providerStatus: 'failed' },
  );
};

export function normalizeSubtitleRemovalSubmitResponse(body = {}) {
  assertProviderCode(body, '去字幕任务提交失败');
  const providerTaskId = String(body?.data?.taskId || '').trim();
  if (!providerTaskId) {
    throw createSubtitleRemovalError('provider_bad_response', '去字幕服务未返回任务编号', {
      providerStatus: 'missing_task_id',
    });
  }
  const leftSeconds = Number(body?.data?.leftSeconds);
  return {
    providerTaskId,
    ...(Number.isFinite(leftSeconds) ? { leftSeconds } : {}),
  };
}

export function normalizeSubtitleRemovalProgressResponse(body = {}, providerTaskId = '') {
  assertProviderCode(body, '去字幕任务查询失败');
  const taskId = String(providerTaskId || '').trim();
  const items = Array.isArray(body?.data) ? body.data : [];
  const item = items.find((candidate) => String(candidate?.taskId || '').trim() === taskId);
  if (!item) {
    throw createSubtitleRemovalError('provider_bad_response', '去字幕服务未返回对应任务', {
      providerTaskId: taskId,
      providerStatus: 'missing_task',
    });
  }
  const status = String(item.status || '').trim().toLowerCase();
  const message = String(item.emsg || '').trim().slice(0, 500);
  if (status === 'waiting' || status === 'doing') {
    return { state: status, providerMessage: message };
  }
  if (status === 'success') {
    const resultUrl = String(item.resultUrl || '').trim();
    if (!/^https?:\/\//iu.test(resultUrl)) {
      throw createSubtitleRemovalError('provider_bad_response', '去字幕服务已完成，但未返回结果视频', {
        providerTaskId: taskId,
        providerStatus: 'success_without_result',
      });
    }
    const costRemove = Number(item.costRemove);
    return {
      state: 'success',
      resultUrl,
      providerMessage: message,
      ...(Number.isFinite(costRemove) ? { costRemove } : {}),
    };
  }
  if (status === 'failed') {
    return { state: 'failed', providerMessage: message };
  }
  return { state: 'unknown', providerMessage: message };
}
