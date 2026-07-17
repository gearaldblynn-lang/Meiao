import { GPT_IMAGE_2_DEFAULT_RESOLUTION, normalizeGptImage2Resolution } from '../src/utils/gptImage2.mjs';
import { allowConcurrentAbortListeners } from './providerBodyRead.mjs';
import { attachProviderTaskId, pollKieTask as defaultPollKieTask } from './providerKieTask.mjs';

export const KIE_IMAGE_MODEL_ALIASES = {
  'gpt-image-2': {
    text: 'gpt-image-2-text-to-image',
    image: 'gpt-image-2-image-to-image',
    maxInputImages: 16,
    pollRetries: 150,
    supportedAspectRatios: ['auto', '1:1', '9:16', '16:9', '4:3', '3:4'],
  },
};

const DEFAULT_MEDIA_RESOLUTION_CONCURRENCY = 2;

const escapeRegExp = (value) => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const toPositiveInteger = (value, fallback) => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const mapWithConcurrency = async (items, limit, mapper) => {
  const sourceItems = Array.isArray(items) ? items : [];
  if (sourceItems.length === 0) return [];
  const results = new Array(sourceItems.length);
  const workerCount = Math.min(sourceItems.length, toPositiveInteger(limit, DEFAULT_MEDIA_RESOLUTION_CONCURRENCY));
  let nextIndex = 0;

  const workers = Array.from({ length: workerCount }, async () => {
    for (;;) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= sourceItems.length) return;
      results[index] = await mapper(sourceItems[index], index);
    }
  });

  await Promise.all(workers);
  return results;
};

export const extractKieImageTextMediaUrls = (text = '') => {
  const source = String(text || '');
  const urls = new Set();
  const absoluteMatches = source.match(/https?:\/\/[^\s"'<>，。；、）)\]】]+/gi) || [];
  absoluteMatches.forEach((url) => {
    const normalized = String(url || '').trim();
    if (normalized) urls.add(normalized);
  });
  const relativeMatches = source.matchAll(/(^|[\s"'(<（[【：])((?:\/api\/assets\/file\/[^\s"'<>，。；、）)\]】]+))/gi);
  for (const match of relativeMatches) {
    const normalized = String(match?.[2] || '').trim();
    if (normalized) urls.add(normalized);
  }
  return Array.from(urls);
};

export const rewriteKieImageTextMediaUrls = async (text, resolveMediaUrl) => {
  const source = String(text || '');
  const urls = extractKieImageTextMediaUrls(source);
  if (urls.length === 0) return source;
  let rewritten = source;
  for (const rawUrl of urls) {
    const resolvedUrl = await resolveMediaUrl(rawUrl);
    if (!resolvedUrl || resolvedUrl === rawUrl) continue;
    rewritten = rewritten.replace(new RegExp(escapeRegExp(rawUrl), 'g'), resolvedUrl);
  }
  return rewritten;
};

const augmentImagePromptForModel = (model, prompt) => {
  if (model !== 'gpt-image-2') return String(prompt || '').trim();
  return String(prompt || '').trim();
};

export const buildKieImageTaskRequestBody = ({ payload, imageUrls, prompt }) => {
  const gptImageAlias = KIE_IMAGE_MODEL_ALIASES[payload.model];
  if (gptImageAlias && imageUrls.length > gptImageAlias.maxInputImages) {
    throw new Error(`当前模型最多支持 ${gptImageAlias.maxInputImages} 张输入图片，当前 ${imageUrls.length} 张，请减少产品或参考素材后重试。`);
  }
  const limitedImageUrls = imageUrls;
  const normalizedAspectRatio = String(payload.aspectRatio || 'auto').trim() || 'auto';
  const normalizedResolution = gptImageAlias
    ? normalizeGptImage2Resolution(normalizedAspectRatio, payload.resolution || GPT_IMAGE_2_DEFAULT_RESOLUTION)
    : String(payload.resolution || '1K').trim().toUpperCase();

  if (!gptImageAlias) {
    return {
      model: payload.model || 'gpt-image-2',
      input: {
        prompt,
        image_input: limitedImageUrls,
        aspect_ratio: payload.aspectRatio || 'auto',
        resolution: payload.resolution || GPT_IMAGE_2_DEFAULT_RESOLUTION,
        output_format: 'png',
      },
    };
  }

  return {
    model: limitedImageUrls.length > 0 ? gptImageAlias.image : gptImageAlias.text,
    input: limitedImageUrls.length > 0
      ? {
          prompt,
          input_urls: limitedImageUrls,
          ...((gptImageAlias.supportedAspectRatios || []).includes(String(payload.aspectRatio || 'auto'))
            ? { aspect_ratio: normalizedAspectRatio }
            : {}),
          resolution: normalizedResolution,
        }
      : {
          prompt,
          ...((gptImageAlias.supportedAspectRatios || []).includes(String(payload.aspectRatio || 'auto'))
            ? { aspect_ratio: normalizedAspectRatio }
            : {}),
          resolution: normalizedResolution,
        },
  };
};

export const runKieImageJob = async ({
  payload,
  signal,
  options = {},
  deps,
}) => {
  const {
    kieApiKey,
    createTaskUrl,
    fetchWithTimeout,
    resolveGenerationMediaUrl,
    normalizeTaskCreationError,
    pollKieTask = defaultPollKieTask,
    wait,
  } = deps;
  const rawImageUrls = Array.isArray(payload.imageUrls) ? payload.imageUrls : [];
  const textMediaUrls = Array.from(extractKieImageTextMediaUrls(payload.prompt || ''));
  allowConcurrentAbortListeners(signal, rawImageUrls.length + textMediaUrls.length);

  const resolvedGenerationUrlByRawUrl = new Map();
  const resolveGenerationUrl = async (url) => {
    const rawUrl = String(url || '').trim();
    if (!rawUrl) return '';
    if (!resolvedGenerationUrlByRawUrl.has(rawUrl)) {
      resolvedGenerationUrlByRawUrl.set(rawUrl, resolveGenerationMediaUrl(rawUrl));
    }
    return resolvedGenerationUrlByRawUrl.get(rawUrl);
  };
  const mediaResolutionConcurrency = toPositiveInteger(
    options?.mediaResolutionConcurrency ?? payload?.mediaResolutionConcurrency,
    DEFAULT_MEDIA_RESOLUTION_CONCURRENCY
  );
  const imageUrls = await mapWithConcurrency(rawImageUrls, mediaResolutionConcurrency, (item) => resolveGenerationUrl(item));
  const promptWithResolvedMediaUrls = await rewriteKieImageTextMediaUrls(payload.prompt || '', resolveGenerationUrl);
  const prompt = augmentImagePromptForModel(payload.model, promptWithResolvedMediaUrls);
  const requestBody = buildKieImageTaskRequestBody({ payload, imageUrls, prompt });

  const response = await fetchWithTimeout(createTaskUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${kieApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
    signal,
  }, 'Kie 图像任务创建超时');

  const result = await response.json().catch(() => ({}));
  if (!response.ok || result?.code !== 200 || !result?.data?.taskId) {
    if (typeof normalizeTaskCreationError === 'function') {
      throw normalizeTaskCreationError(response.status, result, 'Kie 图像任务创建失败');
    }
    const error = new Error(result?.msg || 'Kie 图像任务创建失败');
    error.code = response.status === 401 || response.status === 403 ? 'provider_auth_invalid' : 'provider_bad_request';
    throw error;
  }

  const taskId = result.data.taskId;
  if (typeof options?.onProviderTaskId === 'function') {
    await options.onProviderTaskId(taskId);
  }

  try {
    const imageResult = await pollKieTask(taskId, {
      kieApiKey,
      signal,
      model: payload.model,
      fetchWithTimeout,
      wait,
      pollRetries: KIE_IMAGE_MODEL_ALIASES[payload.model]?.pollRetries,
    });
    return {
      ...imageResult,
      providerTaskId: imageResult.providerTaskId || taskId,
      providerStage: imageResult.providerStage || 'completed',
      providerStatus: imageResult.providerStatus || 'success',
    };
  } catch (error) {
    throw attachProviderTaskId(error, taskId);
  }
};
