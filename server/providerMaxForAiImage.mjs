import {
  assertRemoteProviderMediaUrlAllowed,
  downloadRemoteProviderMediaUrl as defaultDownloadRemoteProviderMediaUrl,
  inferExtensionFromMimeType,
  parseDataUrlPayload,
} from './providerAssetTransfer.mjs';
import {
  extractKieImageTextMediaUrls,
  rewriteKieImageTextMediaUrls,
} from './providerKieImage.mjs';
import {
  getMaxForAiImageModel,
  resolveMaxForAiImageSize,
} from '../src/utils/maxforaiImageModels.mjs';

const MAXFORAI_BASE_URL_DEFAULT = 'https://maxforai.top/v1';
const MAXFORAI_IMAGE_REQUEST_TIMEOUT_MS_DEFAULT = 600_000;
const MAXFORAI_ASSET_UPLOAD_TIMEOUT_MS_DEFAULT = 120_000;
const MAXFORAI_ASSET_UPLOAD_CONCURRENCY_DEFAULT = 3;
const MAXFORAI_MAX_INPUT_IMAGES = 16;

const createProviderError = (code, message, extras = null) => {
  const error = new Error(message);
  error.code = code;
  error.providerMessage = message;
  if (extras && typeof extras === 'object') Object.assign(error, extras);
  return error;
};

const getEnvValue = (env, key, fallback = '') => (
  String(env?.[key] || process.env[key] || fallback).trim()
);

const getPositiveInteger = (env, key, fallback) => {
  const parsed = Number.parseInt(getEnvValue(env, key), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const getMaxForAiConfig = (env = {}) => ({
  apiKey: getEnvValue(env, 'MAXFORAI_API_KEY'),
  baseUrl: getEnvValue(env, 'MAXFORAI_BASE_URL', MAXFORAI_BASE_URL_DEFAULT).replace(/\/+$/, ''),
  requestTimeoutMs: getPositiveInteger(
    env,
    'MAXFORAI_IMAGE_REQUEST_TIMEOUT_MS',
    MAXFORAI_IMAGE_REQUEST_TIMEOUT_MS_DEFAULT,
  ),
  assetUploadTimeoutMs: getPositiveInteger(
    env,
    'MAXFORAI_ASSET_UPLOAD_TIMEOUT_MS',
    MAXFORAI_ASSET_UPLOAD_TIMEOUT_MS_DEFAULT,
  ),
  assetUploadConcurrency: getPositiveInteger(
    env,
    'MAXFORAI_ASSET_UPLOAD_CONCURRENCY',
    MAXFORAI_ASSET_UPLOAD_CONCURRENCY_DEFAULT,
  ),
});

const uniqueNonEmpty = (items) => Array.from(new Set(
  items.map((item) => String(item || '').trim()).filter(Boolean),
));

const mapWithConcurrency = async (items, limit, mapper) => {
  if (items.length === 0) return [];
  const results = new Array(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(items.length, Math.max(1, limit)) }, async () => {
    for (;;) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      results[index] = await mapper(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
};

const isDirectPublicHttpsUrl = (value) => {
  try {
    const parsed = new URL(String(value || '').trim());
    if (parsed.protocol !== 'https:') return false;
    assertRemoteProviderMediaUrlAllowed(value);
    return true;
  } catch (error) {
    if (String(value || '').trim().toLowerCase().startsWith('https:')) throw error;
    return false;
  }
};

const normalizeAssetPreparationError = (error) => {
  if (error?.code === 'request_cancelled') return error;
  if (error?.code === 'provider_submission_unknown') {
    error.code = 'provider_network_error';
    error.submissionUnknown = false;
  }
  error.providerStage = 'asset_upload';
  error.providerStatus = 'failed';
  return error;
};

const normalizePaidSubmissionError = (error) => {
  if (error?.code === 'request_cancelled') return error;
  if (['provider_network_error', 'provider_timeout', 'provider_submission_unknown'].includes(error?.code)) {
    return createProviderError(
      'provider_submission_unknown',
      'Image-2 付费请求连接中断，无法确认上游是否已接单；已停止自动重试以避免重复付费。',
      {
        providerStage: 'provider_submission',
        providerStatus: 'submission_unknown',
        submissionUnknown: true,
      },
    );
  }
  error.providerStage = error?.providerStage || 'provider_submission';
  error.providerStatus = error?.providerStatus || 'failed';
  return error;
};

const readProviderErrorMessage = (body, fallback) => String(
  body?.error?.message || body?.message || body?.msg || fallback,
).trim();

const throwForHttpResponse = (response, body, label) => {
  const message = readProviderErrorMessage(body, `${label}：HTTP ${response.status}`);
  if (response.status === 401 || response.status === 403) {
    throw createProviderError('provider_auth_invalid', message);
  }
  if (response.status === 429) {
    throw createProviderError('provider_rate_limited', message);
  }
  if (response.status >= 500) {
    throw createProviderError('provider_internal_error', message);
  }
  throw createProviderError('provider_bad_request', message);
};

export const buildMaxForAiImageRequestBody = ({ payload = {}, imageUrls = [], prompt } = {}) => {
  const model = getMaxForAiImageModel(payload.model);
  if (!model) {
    throw createProviderError('provider_bad_request', `不支持的 Image-2 模型：${payload.model || '未指定'}`);
  }
  const normalizedPrompt = String(prompt ?? payload.prompt ?? '').trim();
  if (!normalizedPrompt) {
    throw createProviderError('provider_bad_request', 'Image-2 生成提示词不能为空');
  }
  return {
    model: model.upstreamModel,
    prompt: normalizedPrompt,
    size: resolveMaxForAiImageSize(payload.aspectRatio || 'auto', payload.resolution || '1K'),
    n: 1,
    ...(imageUrls.length > 0
      ? { images: imageUrls.map((imageUrl) => ({ image_url: imageUrl })) }
      : {}),
  };
};

const uploadMaxForAiAsset = async ({
  rawUrl,
  config,
  env,
  signal,
  fetchWithTimeout,
  downloadRemoteProviderMediaUrl,
}) => {
  let downloaded;
  const inline = parseDataUrlPayload(rawUrl);
  if (inline) {
    downloaded = {
      fileName: `inline-reference.${inferExtensionFromMimeType(inline.mimeType)}`,
      mimeType: inline.mimeType,
      fileBuffer: Buffer.from(inline.base64Data, 'base64'),
    };
  } else {
    downloaded = await downloadRemoteProviderMediaUrl(rawUrl, {
      env,
      signal,
      deps: { fetchWithTimeout },
    });
  }

  const form = new FormData();
  form.append(
    'file',
    new Blob([downloaded.fileBuffer], { type: downloaded.mimeType || 'application/octet-stream' }),
    downloaded.fileName || 'reference.bin',
  );

  let response;
  try {
    response = await fetchWithTimeout(`${config.baseUrl}/assets`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.apiKey}` },
      body: form,
      signal,
    }, 'MaxForAI 素材上传超时', config.assetUploadTimeoutMs, 'asset_upload', {
      idempotent: false,
      maxRetries: 0,
    });
  } catch (error) {
    throw normalizeAssetPreparationError(error);
  }

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    try {
      throwForHttpResponse(response, body, 'MaxForAI 素材上传失败');
    } catch (error) {
      throw normalizeAssetPreparationError(error);
    }
  }
  const url = String(body?.url || body?.data?.url || '').trim();
  if (!url) {
    throw createProviderError('provider_bad_response', 'MaxForAI 素材上传成功但未返回 URL', {
      providerStage: 'asset_upload',
      providerStatus: 'failed',
    });
  }
  return url;
};

export const runMaxForAiImageJob = async ({ payload = {}, env = {}, signal = null, deps = {} } = {}) => {
  const config = getMaxForAiConfig(env);
  if (!config.apiKey) {
    throw createProviderError('provider_auth_invalid', 'MAXFORAI_API_KEY 未配置');
  }
  const fetchWithTimeout = deps.fetchWithTimeout;
  if (typeof fetchWithTimeout !== 'function') {
    throw createProviderError('provider_bad_request', 'MaxForAI 请求依赖未配置');
  }
  const downloadRemoteProviderMediaUrl = deps.downloadRemoteProviderMediaUrl
    || defaultDownloadRemoteProviderMediaUrl;

  const textMediaUrls = extractKieImageTextMediaUrls(payload.prompt || '');
  const rawImageUrls = uniqueNonEmpty([
    ...(Array.isArray(payload.imageUrls) ? payload.imageUrls : []),
    ...textMediaUrls,
  ]).slice(0, MAXFORAI_MAX_INPUT_IMAGES);

  const resolvedByRawUrl = new Map();
  try {
    const resolvedImageUrls = await mapWithConcurrency(
      rawImageUrls,
      config.assetUploadConcurrency,
      async (rawUrl) => {
        const resolvedUrl = isDirectPublicHttpsUrl(rawUrl)
          ? rawUrl
          : await uploadMaxForAiAsset({
              rawUrl,
              config,
              env,
              signal,
              fetchWithTimeout,
              downloadRemoteProviderMediaUrl,
            });
        resolvedByRawUrl.set(rawUrl, resolvedUrl);
        return resolvedUrl;
      },
    );
    const prompt = await rewriteKieImageTextMediaUrls(
      payload.prompt || '',
      async (rawUrl) => resolvedByRawUrl.get(rawUrl) || rawUrl,
    );
    const requestBody = buildMaxForAiImageRequestBody({ payload, imageUrls: resolvedImageUrls, prompt });
    const endpoint = resolvedImageUrls.length > 0 ? 'images/edits' : 'images/generations';

    let response;
    try {
      response = await fetchWithTimeout(`${config.baseUrl}/${endpoint}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
        signal,
      }, 'MaxForAI Image-2 生成请求超时', config.requestTimeoutMs, 'provider_submission', {
        idempotent: false,
        maxRetries: 0,
      });
    } catch (error) {
      throw normalizePaidSubmissionError(error);
    }

    let body;
    try {
      body = await response.json();
    } catch (error) {
      if (response.ok) {
        throw normalizePaidSubmissionError(createProviderError(
          'provider_network_error',
          error?.message || 'MaxForAI Image-2 响应正文读取失败',
        ));
      }
      body = {};
    }
    if (!response.ok) {
      try {
        throwForHttpResponse(response, body, 'MaxForAI Image-2 生成失败');
      } catch (error) {
        throw normalizePaidSubmissionError(error);
      }
    }
    const imageUrl = String(body?.data?.[0]?.url || '').trim();
    if (!imageUrl) {
      throw createProviderError('provider_bad_response', 'MaxForAI 返回成功但没有图片 URL', {
        providerStage: 'provider_response',
        providerStatus: 'failed',
      });
    }

    return {
      providerStage: 'completed',
      providerStatus: 'success',
      result: {
        imageUrl,
        status: 'success',
        provider: 'maxforai',
        providerModel: requestBody.model,
        requestCreatedAt: Number(body?.created || 0),
      },
    };
  } catch (error) {
    if (error?.providerStage) throw error;
    throw normalizeAssetPreparationError(error);
  }
};
