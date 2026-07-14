import {
  downloadRemoteProviderMediaUrl as defaultDownloadRemoteProviderMediaUrl,
  ensureProviderFileNameWithExtension,
  inferExtensionFromMimeType,
  parseDataUrlPayload,
} from './providerAssetTransfer.mjs';
import { extractKieImageTextMediaUrls } from './providerKieImage.mjs';
import {
  getMaxForAiImageModel,
  resolveMaxForAiImageSize,
} from '../src/utils/maxforaiImageModels.mjs';

const MAXFORAI_BASE_URL_DEFAULT = 'https://maxforai.top/v1';
const MAXFORAI_IMAGE_REQUEST_TIMEOUT_MS_DEFAULT = 600_000;
const MAXFORAI_ASSET_PREPARATION_TIMEOUT_MS_DEFAULT = 120_000;
const MAXFORAI_ASSET_PREPARATION_CONCURRENCY_DEFAULT = 3;
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
  assetPreparationTimeoutMs: getPositiveInteger(
    env,
    'MAXFORAI_ASSET_UPLOAD_TIMEOUT_MS',
    MAXFORAI_ASSET_PREPARATION_TIMEOUT_MS_DEFAULT,
  ),
  assetPreparationConcurrency: getPositiveInteger(
    env,
    'MAXFORAI_ASSET_UPLOAD_CONCURRENCY',
    MAXFORAI_ASSET_PREPARATION_CONCURRENCY_DEFAULT,
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
    response_format: 'url',
    ...(imageUrls.length > 0
      ? { images: imageUrls.map((imageUrl) => ({ image_url: imageUrl })) }
      : {}),
  };
};

const listResponseKeys = (value) => (
  value && typeof value === 'object' && !Array.isArray(value)
    ? Object.keys(value).sort().join(',') || '无'
    : '无'
);

const normalizeImageMimeType = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  return /^image\/(?:png|jpe?g|webp)$/.test(normalized) ? normalized : 'image/png';
};

const prepareMaxForAiEditImage = async ({
  rawUrl,
  index,
  config,
  env,
  signal,
  fetchWithTimeout,
  downloadRemoteProviderMediaUrl,
}) => {
  const inline = parseDataUrlPayload(rawUrl);
  const downloaded = inline
    ? {
        fileName: `inline-reference-${index + 1}.${inferExtensionFromMimeType(inline.mimeType)}`,
        mimeType: inline.mimeType,
        fileBuffer: Buffer.from(inline.base64Data, 'base64'),
      }
    : await downloadRemoteProviderMediaUrl(rawUrl, {
        env,
        signal,
        timeoutMs: config.assetPreparationTimeoutMs,
        deps: { fetchWithTimeout },
      });
  const mimeType = String(downloaded?.mimeType || '').trim().toLowerCase();
  if (!/^image\/(?:png|jpe?g|webp)$/.test(mimeType)) {
    throw createProviderError('provider_bad_request', `Image-2 编辑素材格式不支持：${mimeType || '未知格式'}`);
  }
  const fileBuffer = Buffer.from(downloaded?.fileBuffer || '');
  if (fileBuffer.length === 0) {
    throw createProviderError('provider_bad_request', 'Image-2 编辑素材为空');
  }
  return {
    fileName: ensureProviderFileNameWithExtension(
      downloaded?.fileName || `reference-${index + 1}`,
      mimeType,
    ),
    mimeType,
    fileBuffer,
  };
};

const buildMaxForAiEditFormData = (requestBody, imageFiles) => {
  const form = new FormData();
  form.append('model', requestBody.model);
  form.append('prompt', requestBody.prompt);
  form.append('size', requestBody.size);
  form.append('n', String(requestBody.n));
  form.append('response_format', requestBody.response_format);
  imageFiles.forEach((imageFile) => {
    form.append(
      'image',
      new Blob([imageFile.fileBuffer], { type: imageFile.mimeType }),
      imageFile.fileName,
    );
  });
  return form;
};

export const extractMaxForAiImageResult = (body = {}) => {
  const first = Array.isArray(body?.data) ? body.data[0] : null;
  const imageUrl = String(first?.url || '').trim();
  if (imageUrl) {
    return { imageUrl, providerResponseFormat: 'url' };
  }

  const rawBase64 = String(first?.b64_json || '').trim();
  if (rawBase64) {
    const mimeType = normalizeImageMimeType(first?.mime_type || first?.mimeType);
    const dataUrl = /^data:image\//i.test(rawBase64)
      ? rawBase64
      : `data:${mimeType};base64,${rawBase64}`;
    const parsed = parseDataUrlPayload(dataUrl);
    if (parsed?.base64Data && Buffer.from(parsed.base64Data, 'base64').length > 0) {
      return { imageUrl: dataUrl, providerResponseFormat: 'b64_json' };
    }
  }

  throw createProviderError(
    'provider_bad_response',
    `MaxForAI 返回成功但没有可用图片（顶层字段: ${listResponseKeys(body)}; data[0]字段: ${listResponseKeys(first)}）`,
    {
      providerStage: 'provider_response',
      providerStatus: 'failed',
    },
  );
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

  try {
    const editImageFiles = await mapWithConcurrency(
      rawImageUrls,
      config.assetPreparationConcurrency,
      (rawUrl, index) => prepareMaxForAiEditImage({
        rawUrl,
        index,
        config,
        env,
        signal,
        fetchWithTimeout,
        downloadRemoteProviderMediaUrl,
      }),
    );
    const prompt = String(payload.prompt || '');
    const requestBody = buildMaxForAiImageRequestBody({ payload, imageUrls: rawImageUrls, prompt });
    const endpoint = editImageFiles.length > 0 ? 'images/edits' : 'images/generations';
    const requestInit = editImageFiles.length > 0
      ? {
          method: 'POST',
          headers: { Authorization: `Bearer ${config.apiKey}` },
          body: buildMaxForAiEditFormData(requestBody, editImageFiles),
          signal,
        }
      : {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${config.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
          signal,
        };

    let response;
    try {
      response = await fetchWithTimeout(`${config.baseUrl}/${endpoint}`, requestInit, 'MaxForAI Image-2 生成请求超时', config.requestTimeoutMs, 'provider_submission', {
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
    const imageResult = extractMaxForAiImageResult(body);

    return {
      providerStage: 'completed',
      providerStatus: 'success',
      result: {
        ...imageResult,
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
