import {
  downloadRemoteProviderMediaUrl as defaultDownloadRemoteProviderMediaUrl,
  ensureProviderFileNameWithExtension,
  inferExtensionFromMimeType,
  isManagedAssetUrl,
  parseDataUrlPayload,
} from './providerAssetTransfer.mjs';
import {
  MAXFORAI_VIDEO_MODEL,
  assertMaxForAiVideoMediaContract,
  isMaxForAiVideoModel,
  normalizeMaxForAiVideoAspectRatio,
  normalizeMaxForAiVideoSeconds,
} from '../src/utils/maxforaiVideoModels.mjs';

const DEFAULTS = Object.freeze({
  baseUrl: 'https://maxforai.top/v1',
  createTimeoutMs: 60_000,
  assetTimeoutMs: 120_000,
  assetConcurrency: 2,
  pollIntervalMs: 5_000,
  pollTimeoutMs: 1_500_000,
});

const createProviderError = (code, message, extras = null) => {
  const error = new Error(message);
  error.code = code;
  error.providerMessage = message;
  if (extras && typeof extras === 'object') Object.assign(error, extras);
  return error;
};

const getPositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const getConfig = (env = {}) => ({
  apiKey: String(env.MAXFORAI_VIDEO_API_KEY || '').trim(),
  baseUrl: String(env.MAXFORAI_VIDEO_BASE_URL || DEFAULTS.baseUrl).trim().replace(/\/+$/, ''),
  createTimeoutMs: getPositiveInt(env.MAXFORAI_VIDEO_CREATE_TIMEOUT_MS, DEFAULTS.createTimeoutMs),
  assetTimeoutMs: getPositiveInt(env.MAXFORAI_VIDEO_ASSET_TIMEOUT_MS, DEFAULTS.assetTimeoutMs),
  assetConcurrency: getPositiveInt(
    env.MAXFORAI_VIDEO_ASSET_UPLOAD_CONCURRENCY,
    DEFAULTS.assetConcurrency,
  ),
  pollIntervalMs: getPositiveInt(env.MAXFORAI_VIDEO_POLL_INTERVAL_MS, DEFAULTS.pollIntervalMs),
  pollTimeoutMs: getPositiveInt(env.MAXFORAI_VIDEO_POLL_TIMEOUT_MS, DEFAULTS.pollTimeoutMs),
});

const unique = (items = []) => Array.from(new Set(
  items.map((item) => String(item || '').trim()).filter(Boolean),
));

const mapWithConcurrency = async (items, concurrency, mapper) => {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(items.length, Math.max(1, concurrency)) },
    async () => {
      for (;;) {
        const index = nextIndex;
        nextIndex += 1;
        if (index >= items.length) return;
        results[index] = await mapper(items[index], index);
      }
    },
  );
  await Promise.all(workers);
  return results;
};

const withProviderMeta = (error, extras = {}) => {
  if (!error || typeof error !== 'object') {
    return createProviderError('provider_internal_error', String(error || '未知错误'), extras);
  }
  Object.assign(error, extras);
  return error;
};

const sanitizeMessage = (value, apiKey = '') => {
  let message = String(value || '').trim();
  if (apiKey) message = message.split(apiKey).join('[REDACTED]');
  return message;
};

const sanitizeProviderError = (error, apiKey = '') => {
  if (!error || typeof error !== 'object') return error;
  error.message = sanitizeMessage(error.message, apiKey);
  if (error.providerMessage) {
    error.providerMessage = sanitizeMessage(error.providerMessage, apiKey);
  }
  return error;
};

const readProviderErrorMessage = (body, fallback, apiKey) => sanitizeMessage(
  body?.error?.message
    || body?.message
    || body?.msg
    || body?.data?.error?.message
    || body?.data?.message
    || fallback,
  apiKey,
);

const throwForHttpResponse = (response, body, label, apiKey, extras = {}) => {
  const message = readProviderErrorMessage(body, `${label}：HTTP ${response.status}`, apiKey);
  if (response.status === 401 || response.status === 403) {
    throw createProviderError('provider_auth_invalid', message, extras);
  }
  if (response.status === 429) {
    throw createProviderError('provider_rate_limited', message, extras);
  }
  if (response.status >= 500) {
    throw createProviderError('provider_internal_error', message, extras);
  }
  throw createProviderError('provider_bad_request', message, extras);
};

const normalizeAssetError = (error, apiKey = '') => withProviderMeta(sanitizeProviderError(error, apiKey), {
  providerStage: 'asset_upload',
  providerStatus: error?.code === 'request_cancelled' ? 'cancelled' : 'failed',
  submissionUnknown: false,
});

const normalizeCreateTransportError = () => createProviderError(
  'provider_submission_unknown',
  'MaxForAI 视频付费请求连接中断，无法确认上游是否已接单；已停止自动重试以避免重复付费。',
  {
    providerStage: 'provider_submission',
    providerStatus: 'submission_unknown',
    submissionUnknown: true,
  },
);

const defaultWait = (milliseconds, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) {
    reject(createProviderError('request_cancelled', '任务已取消'));
    return;
  }
  let timeoutId;
  const onAbort = () => {
    clearTimeout(timeoutId);
    reject(createProviderError('request_cancelled', '任务已取消'));
  };
  timeoutId = setTimeout(() => {
    signal?.removeEventListener?.('abort', onAbort);
    resolve();
  }, milliseconds);
  signal?.addEventListener?.('abort', onAbort, { once: true });
});

export const buildMaxForAiVideoRequest = ({ payload = {}, preparedMedia = {} } = {}) => {
  if (!isMaxForAiVideoModel(payload.model)) {
    throw createProviderError('provider_bad_request', '不支持的 MaxForAI 视频模型。');
  }
  const prompt = String(payload.prompt || '').trim();
  if (!prompt) {
    throw createProviderError('provider_bad_request', '视频生成提示词不能为空。');
  }
  const images = unique(preparedMedia.images);
  const videos = unique(preparedMedia.videos);
  const audios = unique(preparedMedia.audios);
  assertMaxForAiVideoMediaContract({
    imageUrls: images,
    videoUrls: videos,
    audioUrls: audios,
    videoDurations: payload.referenceVideoDurations,
    audioDurations: payload.referenceAudioDurations,
  });
  return {
    model: MAXFORAI_VIDEO_MODEL.upstreamModel,
    prompt,
    seconds: normalizeMaxForAiVideoSeconds(payload.seconds ?? payload.duration),
    aspect_ratio: normalizeMaxForAiVideoAspectRatio(payload.aspectRatio ?? payload.ratio),
    ...(images.length ? { images } : {}),
    ...(videos.length ? { videos } : {}),
    ...(audios.length ? { audios } : {}),
  };
};

export const extractMaxForAiVideoTaskId = (body = {}) => String(
  body.task_id || body.id || body.data?.task_id || body.data?.id || '',
).trim();

export const extractMaxForAiVideoResult = (body = {}) => ({
  status: String(body.status || body.data?.status || '').trim().toLowerCase(),
  resultUrl: String(body.result_url || body.data?.result_url || '').trim(),
  errorMessage: String(
    body.error?.message
      || body.message
      || body.data?.error?.message
      || body.data?.message
      || '',
  ).trim(),
});

const normalizeMimeType = (value, kind) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized.includes('/')) return normalized;
  if (kind === 'images') return 'image/jpeg';
  if (kind === 'videos') return 'video/mp4';
  return 'audio/mpeg';
};

const extractAssetUrl = (body = {}) => String(body.url || body.data?.url || '').trim();

const readJson = async (response, { stage, apiKey, taskId = '' } = {}) => {
  try {
    return await response.json();
  } catch (error) {
    throw createProviderError(
      'provider_network_error',
      sanitizeMessage(error?.message || 'MaxForAI 响应正文读取失败', apiKey),
      {
        providerStage: stage,
        providerStatus: 'network_error',
        ...(taskId ? { providerTaskId: taskId } : {}),
      },
    );
  }
};

const prepareDefaultAsset = async ({
  rawUrl,
  kind,
  index,
  config,
  env,
  signal,
  fetchWithTimeout,
  downloadRemoteProviderMediaUrl,
}) => {
  const isRemoteHttps = /^https:\/\//i.test(rawUrl) && !isManagedAssetUrl(rawUrl);
  let response;
  if (isRemoteHttps) {
    response = await fetchWithTimeout(
      `${config.baseUrl}/assets/url`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url: rawUrl }),
        signal,
      },
      'MaxForAI 远程素材转存超时',
      config.assetTimeoutMs,
      'asset_upload',
      { idempotent: true, maxRetries: 2 },
    );
  } else {
    const inline = parseDataUrlPayload(rawUrl);
    const downloaded = inline
      ? {
          fileName: `inline-${kind}-${index + 1}.${inferExtensionFromMimeType(inline.mimeType)}`,
          mimeType: inline.mimeType,
          fileBuffer: Buffer.from(inline.base64Data, 'base64'),
        }
      : await downloadRemoteProviderMediaUrl(rawUrl, {
          env,
          signal,
          timeoutMs: config.assetTimeoutMs,
          deps: { fetchWithTimeout },
        });
    const mimeType = normalizeMimeType(downloaded?.mimeType, kind);
    const fileBuffer = Buffer.from(downloaded?.fileBuffer || '');
    if (fileBuffer.length === 0) {
      throw createProviderError('provider_bad_request', 'MaxForAI 上传素材为空。');
    }
    const fileName = ensureProviderFileNameWithExtension(
      downloaded?.fileName || `${kind}-${index + 1}`,
      mimeType,
    );
    const form = new FormData();
    form.append('file', new Blob([fileBuffer], { type: mimeType }), fileName);
    response = await fetchWithTimeout(
      `${config.baseUrl}/assets`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.apiKey}` },
        body: form,
        signal,
      },
      'MaxForAI 本地素材上传超时',
      config.assetTimeoutMs,
      'asset_upload',
      { idempotent: true, maxRetries: 2 },
    );
  }

  const body = await readJson(response, { stage: 'asset_upload', apiKey: config.apiKey });
  if (!response.ok) {
    throwForHttpResponse(response, body, 'MaxForAI 素材上传失败', config.apiKey, {
      providerStage: 'asset_upload',
      providerStatus: 'failed',
    });
  }
  const url = extractAssetUrl(body);
  if (!url) {
    throw createProviderError('provider_bad_response', 'MaxForAI 素材上传成功但未返回 URL。');
  }
  return url;
};

const prepareMedia = async ({ payload, config, env, signal, deps, fetchWithTimeout }) => {
  const rawMedia = {
    images: unique(payload.imageUrls),
    videos: unique(payload.videoUrls),
    audios: unique(payload.audioUrls),
  };
  assertMaxForAiVideoMediaContract({
    imageUrls: rawMedia.images,
    videoUrls: rawMedia.videos,
    audioUrls: rawMedia.audios,
    videoDurations: payload.referenceVideoDurations,
    audioDurations: payload.referenceAudioDurations,
  });
  const descriptors = Object.entries(rawMedia).flatMap(([kind, values]) => (
    values.map((rawUrl, index) => ({ kind, rawUrl, index }))
  ));
  const downloadRemoteProviderMediaUrl = deps.downloadRemoteProviderMediaUrl
    || ((value, options = {}) => defaultDownloadRemoteProviderMediaUrl(value, {
      ...options,
      deps: {
        ...(options.deps || {}),
        ...(deps.assetTransferDeps || {}),
      },
    }));
  const prepared = await mapWithConcurrency(
    descriptors,
    config.assetConcurrency,
    async (descriptor) => {
      try {
        const prepareAsset = deps.prepareAsset || ((rawUrl, options) => prepareDefaultAsset({
          rawUrl,
          ...options,
        }));
        const url = await prepareAsset(descriptor.rawUrl, {
          ...descriptor,
          config,
          env,
          signal,
          fetchWithTimeout,
          downloadRemoteProviderMediaUrl,
        });
        if (!String(url || '').trim()) {
          throw createProviderError('provider_bad_response', 'MaxForAI 素材准备未返回 URL。');
        }
        return { ...descriptor, url: String(url).trim() };
      } catch (error) {
        throw normalizeAssetError(error, config.apiKey);
      }
    },
  );
  return prepared.reduce((result, item) => {
    result[item.kind][item.index] = item.url;
    return result;
  }, { images: [], videos: [], audios: [] });
};

const pollMaxForAiVideo = async ({ taskId, config, signal, fetchWithTimeout, wait, now }) => {
  const startedAt = now();
  for (;;) {
    if (signal?.aborted) {
      throw createProviderError('request_cancelled', '任务已取消', {
        providerTaskId: taskId,
        providerStage: 'polling',
        providerStatus: 'cancelled',
      });
    }
    if (now() - startedAt >= config.pollTimeoutMs) {
      throw createProviderError('provider_timeout', 'MaxForAI 视频任务轮询超时。', {
        providerTaskId: taskId,
        providerStage: 'polling',
        providerStatus: 'timeout',
      });
    }

    let response;
    try {
      response = await fetchWithTimeout(
        `${config.baseUrl}/videos/${encodeURIComponent(taskId)}`,
        {
          method: 'GET',
          headers: { Authorization: `Bearer ${config.apiKey}` },
          signal,
        },
        'MaxForAI 视频任务查询超时',
        config.createTimeoutMs,
        'polling',
        { idempotent: true, maxRetries: 2 },
      );
    } catch (error) {
      if (signal?.aborted || error?.code === 'request_cancelled') {
        throw createProviderError('request_cancelled', '任务已取消', {
          providerTaskId: taskId,
          providerStage: 'polling',
          providerStatus: 'cancelled',
        });
      }
      throw withProviderMeta(sanitizeProviderError(error, config.apiKey), {
        providerTaskId: taskId,
        providerStage: 'polling',
        providerStatus: error?.code === 'provider_timeout' ? 'timeout' : 'failed',
      });
    }
    const body = await readJson(response, {
      stage: 'polling',
      apiKey: config.apiKey,
      taskId,
    });
    if (!response.ok) {
      throwForHttpResponse(response, body, 'MaxForAI 视频任务查询失败', config.apiKey, {
        providerTaskId: taskId,
        providerStage: 'polling',
        providerStatus: 'failed',
      });
    }
    const result = extractMaxForAiVideoResult(body);
    if (result.status === 'succeeded') {
      if (!result.resultUrl) {
        throw createProviderError('provider_bad_response', 'MaxForAI 视频任务成功但未返回 result_url。', {
          providerTaskId: taskId,
          providerStage: 'polling',
          providerStatus: 'failed',
        });
      }
      return result.resultUrl;
    }
    if (result.status === 'failed') {
      throw createProviderError(
        'provider_bad_request',
        sanitizeMessage(result.errorMessage || 'MaxForAI 视频生成失败。', config.apiKey),
        {
          providerTaskId: taskId,
          providerStage: 'polling',
          providerStatus: 'failed',
        },
      );
    }
    if (!['queued', 'processing'].includes(result.status)) {
      throw createProviderError('provider_bad_response', 'MaxForAI 视频任务返回了无法识别的状态。', {
        providerTaskId: taskId,
        providerStage: 'polling',
        providerStatus: 'failed',
      });
    }
    try {
      await wait(config.pollIntervalMs, signal);
    } catch (error) {
      if (signal?.aborted || error?.code === 'request_cancelled') {
        throw createProviderError('request_cancelled', '任务已取消', {
          providerTaskId: taskId,
          providerStage: 'polling',
          providerStatus: 'cancelled',
        });
      }
      throw sanitizeProviderError(error, config.apiKey);
    }
  }
};

export const runMaxForAiVideoJob = async ({
  payload = {},
  env = {},
  signal = null,
  providerTaskId = '',
  deps = {},
} = {}) => {
  const config = getConfig(env);
  if (!config.apiKey) {
    throw createProviderError('provider_auth_invalid', 'MAXFORAI_VIDEO_API_KEY 未配置');
  }
  const fetchWithTimeout = deps.fetchWithTimeout;
  if (typeof fetchWithTimeout !== 'function') {
    throw createProviderError('provider_bad_request', 'MaxForAI 视频请求依赖未配置。');
  }
  const wait = deps.wait || defaultWait;
  const now = deps.now || Date.now;
  let taskId = String(providerTaskId || '').trim();

  if (!taskId) {
    buildMaxForAiVideoRequest({ payload });
    let preparedMedia;
    try {
      preparedMedia = await prepareMedia({ payload, config, env, signal, deps, fetchWithTimeout });
    } catch (error) {
      throw error?.providerStage
        ? sanitizeProviderError(error, config.apiKey)
        : normalizeAssetError(error, config.apiKey);
    }
    const requestBody = buildMaxForAiVideoRequest({ payload, preparedMedia });
    if (signal?.aborted) {
      throw createProviderError('request_cancelled', '任务已取消', {
        providerStage: 'provider_submission',
        providerStatus: 'cancelled',
      });
    }

    let response;
    try {
      response = await fetchWithTimeout(
        `${config.baseUrl}/videos`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${config.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
          signal,
        },
        'MaxForAI 视频创建请求超时',
        config.createTimeoutMs,
        'provider_submission',
        { idempotent: false, maxRetries: 0 },
      );
    } catch (error) {
      if (
        !error?.code
        || error?.name === 'AbortError'
        || ['request_cancelled', 'provider_network_error', 'provider_timeout', 'provider_submission_unknown'].includes(error.code)
      ) {
        throw normalizeCreateTransportError();
      }
      throw withProviderMeta(sanitizeProviderError(error, config.apiKey), {
        providerStage: 'provider_submission',
        providerStatus: 'failed',
      });
    }

    let body;
    try {
      body = await readJson(response, {
        stage: 'provider_submission',
        apiKey: config.apiKey,
      });
    } catch (error) {
      if (response.ok) throw normalizeCreateTransportError();
      throw error;
    }
    if (!response.ok) {
      throwForHttpResponse(response, body, 'MaxForAI 视频创建失败', config.apiKey, {
        providerStage: 'provider_submission',
        providerStatus: 'failed',
      });
    }
    taskId = extractMaxForAiVideoTaskId(body);
    if (!taskId) {
      throw createProviderError('provider_bad_response', 'MaxForAI 视频创建成功但未返回任务 ID。', {
        providerStage: 'provider_submission',
        providerStatus: 'failed',
      });
    }
    if (typeof deps.onProviderTaskId === 'function') {
      try {
        await deps.onProviderTaskId(taskId);
      } catch (error) {
        throw withProviderMeta(sanitizeProviderError(error, config.apiKey), {
          providerTaskId: taskId,
          providerStage: 'provider_submission',
          providerStatus: 'submitted',
        });
      }
    }
  }

  const resultUrl = await pollMaxForAiVideo({
    taskId,
    config,
    signal,
    fetchWithTimeout,
    wait,
    now,
  });
  return {
    providerTaskId: taskId,
    providerStage: 'completed',
    providerStatus: 'success',
    result: {
      videoUrl: resultUrl,
      provider: 'maxforai',
      providerModel: MAXFORAI_VIDEO_MODEL.upstreamModel,
      providerTaskId: taskId,
    },
  };
};
