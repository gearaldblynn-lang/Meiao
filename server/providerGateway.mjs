const KIE_CREATE_TASK_URL = 'https://api.kie.ai/api/v1/jobs/createTask';
const KIE_RECORD_INFO_URL = 'https://api.kie.ai/api/v1/jobs/recordInfo';
const KIE_VEO_BASE_URL = 'https://api.kie.ai/api/v1/veo';
const KIE_CHAT_URL = 'https://api.kie.ai/gpt-5-2/v1/chat/completions';
const KIE_RESPONSES_URL = 'https://api.kie.ai/codex/v1/responses';
const KIE_TRANSIENT_NOT_FOUND_GRACE_MS = 45_000;
const KIE_TRANSIENT_FETCH_ERROR_GRACE_MS = 240_000;
const MANAGED_ASSET_PATH_SEGMENT = '/api/assets/file/';
const KIE_RESPONSES_MODEL_ALIASES = {
  'gpt-5-4-openai-resp': 'gpt-5-4',
  'gpt-5-4': 'gpt-5-4',
};
const KIE_CHAT_MODEL_ENDPOINTS = {
  'gpt-5-2': KIE_CHAT_URL,
  'gemini-3.1-pro-openai': 'https://api.kie.ai/gemini-3.1-pro/v1/chat/completions',
  'gemini-3-flash-openai': 'https://api.kie.ai/gemini-3-flash/v1/chat/completions',
};
const PROVIDER_ATTACHMENT_STRATEGIES = {
  kie_responses: {
    image: 'input_image_url',
    file: 'input_file_url',
  },
  kie_chat_completions: {
    image: 'image_url',
    file: 'image_url',
  },
};

const wait = (ms, signal) =>
  new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      signal?.removeEventListener?.('abort', onAbort);
      resolve();
    }, ms);

    const onAbort = () => {
      clearTimeout(timeoutId);
      signal?.removeEventListener?.('abort', onAbort);
      reject(createProviderError('request_cancelled', '任务已取消'));
    };

    if (signal) {
      signal.addEventListener('abort', onAbort);
    }
  });

const createProviderError = (code, message, extras = null) => {
  const error = new Error(message);
  error.code = code;
  error.providerMessage = message;
  if (extras && typeof extras === 'object') {
    Object.assign(error, extras);
  }
  return error;
};

const attachProviderTaskId = (error, providerTaskId) => {
  if (error && typeof error === 'object' && providerTaskId && !error.providerTaskId) {
    error.providerTaskId = providerTaskId;
  }
  return error;
};

const getEnvValue = (env, ...keys) => keys.map((key) => env[key]).find(Boolean) || '';

const getProviderEnv = (env) => ({
  kieApiKey: getEnvValue(env, 'KIE_API_KEY', 'MEIAO_KIE_API_KEY'),
});

const ensureProviderKey = (value, label) => {
  if (!value) {
    throw createProviderError('provider_auth_invalid', `${label} 未配置`);
  }
};

const normalizeMessageContentItems = (content) => {
  if (typeof content === 'string') {
    return [{ type: 'text', text: content }];
  }
  if (!Array.isArray(content)) return [];
  return content;
};

const buildProviderInputMessages = (messages = [], mapper) =>
  (Array.isArray(messages) ? messages : []).map((message) => ({
    role: message?.role || 'user',
    content: mapper(normalizeMessageContentItems(message?.content)),
  }));

const extractResponsesInstructions = (messages = []) =>
  (Array.isArray(messages) ? messages : [])
    .filter((message) => String(message?.role || '').trim() === 'system')
    .flatMap((message) => normalizeMessageContentItems(message?.content))
    .filter((item) => item?.type === 'text' || item?.type === 'input_text')
    .map((item) => String(item?.text || '').trim())
    .filter(Boolean)
    .join('\n\n')
    .trim();

const buildResponsesInputMessages = (messages = [], mapper) =>
  buildProviderInputMessages(
    (Array.isArray(messages) ? messages : []).filter((message) => String(message?.role || '').trim() !== 'system'),
    mapper
  );

const isManagedAssetUrl = (value) =>
  typeof value === 'string' && value.includes(MANAGED_ASSET_PATH_SEGMENT);

const isLocalHostValue = (value) =>
  /(^|\/\/)(127\.0\.0\.1|localhost)(:|$)/i.test(String(value || ''));

const normalizeManagedAssetDownloadUrl = (value) => {
  const normalized = String(value || '').trim();
  if (!isManagedAssetUrl(normalized)) return normalized;
  if (normalized.startsWith('/')) {
    return `http://127.0.0.1:${process.env.PORT || 3100}${normalized}`;
  }
  try {
    const url = new URL(normalized);
    return `http://127.0.0.1:3100${url.pathname || ''}${url.search || ''}`;
  } catch {
    return normalized;
  }
};

const extractFileNameFromUrl = (value, fallback = 'upload.bin') => {
  try {
    const url = new URL(String(value || ''));
    const pathname = decodeURIComponent(url.pathname || '');
    const segments = pathname.split('/').filter(Boolean);
    const candidate = segments[segments.length - 1] || '';
    return candidate || fallback;
  } catch {
    return fallback;
  }
};

const inferMimeTypeFromName = (value, fallback = 'application/octet-stream') => {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized.endsWith('.png')) return 'image/png';
  if (normalized.endsWith('.jpg') || normalized.endsWith('.jpeg')) return 'image/jpeg';
  if (normalized.endsWith('.webp')) return 'image/webp';
  if (normalized.endsWith('.gif')) return 'image/gif';
  if (normalized.endsWith('.bmp')) return 'image/bmp';
  if (normalized.endsWith('.svg')) return 'image/svg+xml';
  if (normalized.endsWith('.pdf')) return 'application/pdf';
  if (normalized.endsWith('.txt')) return 'text/plain';
  if (normalized.endsWith('.md')) return 'text/markdown';
  if (normalized.endsWith('.json')) return 'application/json';
  return fallback;
};

const inferExtensionFromMimeType = (value, fallback = 'bin') => {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'image/png') return 'png';
  if (normalized === 'image/jpeg') return 'jpg';
  if (normalized === 'image/webp') return 'webp';
  if (normalized === 'image/gif') return 'gif';
  if (normalized === 'image/bmp') return 'bmp';
  if (normalized === 'image/svg+xml') return 'svg';
  if (normalized === 'application/pdf') return 'pdf';
  if (normalized === 'text/plain') return 'txt';
  if (normalized === 'text/markdown') return 'md';
  if (normalized === 'application/json') return 'json';
  return fallback;
};

const parseDataUrlPayload = (value) => {
  const raw = String(value || '').trim();
  const match = raw.match(/^data:([^;,]+)?(?:;charset=[^;,]+)?;base64,([A-Za-z0-9+/=]+)$/i);
  if (!match) return null;
  return {
    mimeType: String(match[1] || 'application/octet-stream').trim().toLowerCase() || 'application/octet-stream',
    base64Data: match[2] || '',
  };
};

const convertInlineDataUrlToKieFileUrl = async (value, env) => {
  const parsed = parseDataUrlPayload(value);
  if (!parsed) return String(value || '').trim();
  const extension = inferExtensionFromMimeType(parsed.mimeType);
  const uploaded = await uploadAssetViaKieStream({
    fileBuffer: Buffer.from(parsed.base64Data, 'base64'),
    mimeType: parsed.mimeType,
    fileName: `inline-upload.${extension}`,
    uploadPath: 'mayo-storage/internal',
  }, env);
  return String(uploaded?.result?.fileUrl || '').trim();
};

const downloadManagedAsset = async (assetUrl, signal) => {
  const response = await fetch(normalizeManagedAssetDownloadUrl(assetUrl), {
    method: 'GET',
    signal,
  });
  if (!response.ok) {
    throw createProviderError('provider_bad_request', `内部素材下载失败：HTTP ${response.status}`);
  }

  const fileName = extractFileNameFromUrl(assetUrl);
  const mimeTypeHeader = response.headers?.get?.('content-type') || '';
  const mimeType = String(mimeTypeHeader || '').split(';')[0].trim() || inferMimeTypeFromName(fileName);
  const fileBuffer = Buffer.from(await response.arrayBuffer());
  return {
    fileName,
    mimeType,
    fileBuffer,
  };
};

const convertManagedAssetUrlToKieFileUrl = async (assetUrl, env, signal) => {
  if (!isManagedAssetUrl(assetUrl)) return String(assetUrl || '').trim();
  const downloaded = await downloadManagedAsset(assetUrl, signal);
  let uploaded;
  try {
    uploaded = await uploadAssetViaKieStream({
      ...downloaded,
      uploadPath: 'mayo-storage/internal',
    }, env);
  } catch (error) {
    if (error?.code !== 'provider_auth_invalid' && error?.code !== 'provider_internal_error') {
      throw error;
    }
    uploaded = await uploadAssetViaKie({
      ...downloaded,
      base64Data: Buffer.from(downloaded.fileBuffer || '').toString('base64'),
      uploadPath: 'mayo-storage/internal',
    }, env);
  }
  return String(uploaded?.result?.fileUrl || '').trim();
};

const resolveProviderGenerationMediaUrl = async (value, env, signal) => {
  const normalized = String(value || '').trim();
  if (!normalized) return '';
  if (!isManagedAssetUrl(normalized)) return normalized;
  if (/^https?:\/\//i.test(normalized) && !isLocalHostValue(normalized)) {
    return normalized;
  }
  return convertManagedAssetUrlToKieFileUrl(normalized, env, signal);
};

const resolveProviderMediaUrl = async (value, env, signal) => {
  const normalized = String(value || '').trim();
  if (!normalized) return '';
  if (normalized.startsWith('data:')) {
    return convertInlineDataUrlToKieFileUrl(normalized, env);
  }
  if (!isManagedAssetUrl(normalized)) return normalized;
  return convertManagedAssetUrlToKieFileUrl(normalized, env, signal);
};

const resolveAttachmentStrategy = (model, item) => {
  const transport = resolveChatTransport(model);
  const kind = item?.type === 'input_file' ? 'file' : 'image';
  return PROVIDER_ATTACHMENT_STRATEGIES[transport]?.[kind] || 'url';
};

const resolveProviderMessageItem = async (item, env, signal, options = {}) => {
  if (!item || typeof item !== 'object') return item;
  const strategy = resolveAttachmentStrategy(options.model, item);

  if (item.type === 'input_file') {
    const rawUrl = item.file_url || item.url || '';
    const fileUrl = await resolveProviderMediaUrl(rawUrl, env, signal);
    if (strategy === 'input_file_url') {
      return {
        ...item,
        file_url: fileUrl,
        url: fileUrl,
      };
    }
    return {
      ...item,
      file_url: fileUrl,
      url: fileUrl,
    };
  }

  if (item.type === 'image_url' || item.type === 'input_image') {
    const rawUrl = item.image_url?.url || item.image_url || item.url || '';
    const resolvedUrl = await resolveProviderMediaUrl(rawUrl, env, signal);
    if (item.image_url && typeof item.image_url === 'object') {
      return {
        ...item,
        image_url: {
          ...item.image_url,
          url: resolvedUrl,
        },
        url: resolvedUrl,
      };
    }
    return {
      ...item,
      image_url: resolvedUrl,
      url: resolvedUrl,
    };
  }

  return item;
};

const resolveProviderMessages = async (messages = [], env, signal, options = {}) => Promise.all(
  (Array.isArray(messages) ? messages : []).map(async (message) => ({
    ...message,
    content: await Promise.all(
      normalizeMessageContentItems(message?.content).map((item) => resolveProviderMessageItem(item, env, signal, options))
    ),
  }))
);

const buildKieResponsesContent = (items) =>
  items.map((item) => {
    if (item.type === 'text' || item.type === 'input_text') {
      return { type: 'input_text', text: item.text || '' };
    }
    if (item.type === 'input_file') {
      return {
        type: 'input_file',
        ...(item.file_data ? { file_data: item.file_data } : { file_url: item.file_url || item.url || '' }),
        filename: item.filename || item.name || undefined,
      };
    }
    return {
      type: 'input_image',
      image_url: item.image_url?.url || item.image_url || item.url || '',
    };
  });

const buildKieChatContent = (items) =>
  items.map((item) => {
    if (item.type === 'text' || item.type === 'input_text') {
      return { type: 'text', text: item.text || '' };
    }
    if (item.type === 'input_file') {
      return {
        type: 'image_url',
        image_url: {
          url: item.file_url || item.url || '',
        },
      };
    }
    return {
      type: 'image_url',
      image_url: {
        url: item.image_url?.url || item.image_url || item.url || '',
      },
    };
  });

const appendUniqueText = (bucket, value) => {
  const text = String(value || '').trim();
  if (!text || bucket.includes(text)) return;
  bucket.push(text);
};

const METADATA_KEYS = new Set([
  'role',
  'type',
  'id',
  'object',
  'model',
  'finish_reason',
  'status',
  'index',
  'created',
  'usage',
  'credits_consumed',
]);

const collectTextCandidates = (value, bucket, depth = 0, parentKey = '') => {
  if (!value || depth > 6) return;
  if (parentKey === 'input' || parentKey === 'instructions') return;

  if (typeof value === 'string') {
    if (METADATA_KEYS.has(parentKey)) return;
    appendUniqueText(bucket, value);
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item) => collectTextCandidates(item, bucket, depth + 1, parentKey));
    return;
  }

  if (typeof value !== 'object') return;

  const itemType = String(value.type || '').trim().toLowerCase();
  const isExplicitReasoningBlock = itemType === 'reasoning' || itemType === 'thought' || itemType === 'thinking';
  if (isExplicitReasoningBlock) return;

  if (typeof value.output_text === 'string') {
    appendUniqueText(bucket, value.output_text);
  }

  if (typeof value.text === 'string' && (!value.type || String(value.type).includes('text'))) {
    appendUniqueText(bucket, value.text);
  }

  if (typeof value.content === 'string') {
    appendUniqueText(bucket, value.content);
  }

  if (typeof value.value === 'string' && (!value.type || String(value.type).includes('text'))) {
    appendUniqueText(bucket, value.value);
  }

  const priorityKeys = ['data', 'result', 'response', 'message', 'messages', 'choices', 'output', 'content', 'parts', 'candidates'];
  priorityKeys.forEach((key) => {
    if (key in value) {
      collectTextCandidates(value[key], bucket, depth + 1, key);
    }
  });

  Object.entries(value).forEach(([key, child]) => {
    if (priorityKeys.includes(key)) return;
    if (key === 'reasoning' || key === 'reasoning_content' || key === 'thought' || key === 'thoughts') return;
    collectTextCandidates(child, bucket, depth + 1, key);
  });
};

const extractTextResponse = (data) => {
  const candidates = [];
  collectTextCandidates(data, candidates);
  const text = candidates.join('\n').trim();
  if (text) return text;
  throw createProviderError('provider_bad_response', 'AI 未返回可解析的文本内容');
};

const extractChatMessageText = (value) => {
  const candidates = [];
  collectTextCandidates(value, candidates);
  return candidates.join('\n').trim();
};

const resolveChatTransport = (model) => {
  const normalizedModel = String(model || '').trim();
  if (normalizedModel in KIE_RESPONSES_MODEL_ALIASES) return 'kie_responses';
  if (normalizedModel.startsWith('doubao-')) return 'unsupported';
  return 'kie_chat_completions';
};

const resolveKieResponsesModel = (model) =>
  KIE_RESPONSES_MODEL_ALIASES[String(model || '').trim()] || String(model || '').trim();

const resolveKieChatEndpoint = (model) =>
  KIE_CHAT_MODEL_ENDPOINTS[String(model || '').trim()] || KIE_CHAT_URL;

const isKieGeminiChatModel = (model) => /^gemini-/i.test(String(model || '').trim());

const getKieChatFallbackModels = (model, preferredFallbackModels = []) => {
  const configured = Array.isArray(preferredFallbackModels)
    ? preferredFallbackModels.map((item) => String(item || '').trim()).filter(Boolean)
    : [];
  return Array.from(new Set(configured.filter((item) => item !== String(model || '').trim())));
};

// 各模型对 reasoningLevel 的支持情况：
// - gpt-5-4 (Responses API): 支持 low / medium / high
// - gemini 系列 (Chat API): 只支持 low / high，medium 映射为 high
// - 其他 chat 模型: 不传 reasoningLevel
const normalizeReasoningLevelForModel = (model, reasoningLevel) => {
  if (!reasoningLevel) return null;
  const m = String(model || '').trim();
  const level = String(reasoningLevel).trim();
  if (isKieGeminiChatModel(m)) {
    // gemini 只支持 low / high
    if (level === 'low') return 'low';
    return 'high'; // medium / high / 其他 → high
  }
  // gpt-5-4 Responses API 支持 low / medium / high，直接透传
  return level;
};

const extractUrlFromResponse = (result) => {
  if (!result) return null;

  if (result.data) {
    if (typeof result.data === 'string' && result.data.startsWith('http')) return result.data;
    if (typeof result.data === 'object') {
      if (result.data.fileUrl && typeof result.data.fileUrl === 'string') return result.data.fileUrl;
      if (result.data.url && typeof result.data.url === 'string') return result.data.url;
      if (result.data.downloadUrl && typeof result.data.downloadUrl === 'string') return result.data.downloadUrl;
    }
  }
  if (result.fileUrl && typeof result.fileUrl === 'string') return result.fileUrl;
  if (result.url && typeof result.url === 'string') return result.url;

  const findUrlRecursively = (obj, depth = 0) => {
    if (!obj || depth > 3) return null;

    if (typeof obj === 'string') {
      if (obj.startsWith('http://') || obj.startsWith('https://')) return obj;
      return null;
    }

    if (typeof obj === 'object') {
      for (const key in obj) {
        if (key === 'msg' || key === 'message' || key === 'error') continue;
        const found = findUrlRecursively(obj[key], depth + 1);
        if (found) return found;
      }
    }
    return null;
  };

  return findUrlRecursively(result);
};

const findVideoUrlRecursively = (data) => {
  if (!data) return null;
  if (typeof data === 'string') {
    const trimmed = data.trim();
    if (trimmed.startsWith('http')) return trimmed.split(',')[0].trim();
    return null;
  }
  if (Array.isArray(data)) {
    for (const item of data) {
      const found = findVideoUrlRecursively(item);
      if (found) return found;
    }
    return null;
  }
  if (typeof data === 'object') {
    const priorityKeys = ['resultUrls', 'videoUrl', 'url', 'playUrl', 'video_url', 'downloadUrl', 'uri', 'video_uri'];
    for (const key of priorityKeys) {
      if (data[key]) {
        const found = findVideoUrlRecursively(data[key]);
        if (found) return found;
      }
    }
    for (const key in data) {
      if (!priorityKeys.includes(key) && typeof data[key] === 'object') {
        const found = findVideoUrlRecursively(data[key]);
        if (found) return found;
      }
    }
  }
  return null;
};

const mapHttpError = async (response, defaultMessage) => {
  const data = await response.json().catch(() => ({}));
  if (response.status === 401 || response.status === 403) {
    throw createProviderError('provider_auth_invalid', data?.error?.message || data?.message || defaultMessage);
  }
  if (response.status === 400 || response.status === 404) {
    throw createProviderError('provider_bad_request', data?.error?.message || data?.message || defaultMessage);
  }
  if (response.status === 429) {
    throw createProviderError('provider_rate_limited', data?.error?.message || data?.message || defaultMessage);
  }
  if (response.status >= 500) {
    throw createProviderError('provider_internal_error', data?.error?.message || data?.message || defaultMessage);
  }
  throw createProviderError('provider_network_error', data?.error?.message || data?.message || defaultMessage);
};

const pollKieTask = async (taskId, kieApiKey, signal, isVideo = false) => {
  const maxRetries = isVideo ? 180 : 90;
  const startedAt = Date.now();
  let lastKnownState = '';

  for (let i = 0; i < maxRetries; i += 1) {
    if (signal?.aborted) {
      throw createProviderError('request_cancelled', '任务已取消', { providerTaskId: taskId, providerStage: 'polling', providerStatus: lastKnownState || 'cancelled' });
    }

    let response;
    try {
      response = await fetch(`${KIE_RECORD_INFO_URL}?taskId=${encodeURIComponent(taskId)}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${kieApiKey}`,
        },
        signal,
      });
    } catch (error) {
      if (signal?.aborted) {
        throw createProviderError('request_cancelled', '任务已取消', { providerTaskId: taskId, providerStage: 'polling', providerStatus: lastKnownState || 'cancelled' });
      }
      const isTransientFetchError = error instanceof TypeError || /fetch failed/i.test(String(error?.message || ''));
      if (isTransientFetchError && Date.now() - startedAt < KIE_TRANSIENT_FETCH_ERROR_GRACE_MS) {
        await wait(4000, signal);
        continue;
      }
      throw attachProviderTaskId(
        createProviderError('provider_network_error', error?.message || 'Kie 任务查询失败', { providerStage: 'polling', providerStatus: lastKnownState || 'network_error' }),
        taskId
      );
    }

    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401 || response.status === 403 || result?.code === 401 || result?.code === 403) {
        throw createProviderError('provider_auth_invalid', result?.msg || 'Kie 鉴权失败');
      }
      if (response.status === 404 || result?.code === 404) {
        if (Date.now() - startedAt < KIE_TRANSIENT_NOT_FOUND_GRACE_MS) {
          await wait(4000, signal);
          continue;
        }
        throw createProviderError('task_not_found', result?.msg || '任务不存在或已过期', { providerTaskId: taskId, providerStage: 'polling', providerStatus: 'not_found' });
      }
      if (response.status === 429) {
        throw createProviderError('provider_rate_limited', result?.msg || 'Kie 请求过于频繁', { providerTaskId: taskId, providerStage: 'polling', providerStatus: 'rate_limited' });
      }
      if (response.status >= 500) {
        throw createProviderError('provider_internal_error', result?.msg || 'Kie 服务异常', { providerTaskId: taskId, providerStage: 'polling', providerStatus: 'server_error' });
      }
    }

    if (result?.code === 200) {
      const state = result.data?.state;
      lastKnownState = String(state || '').trim() || lastKnownState;
      if (state === 'success') {
        const resultJson = JSON.parse(result.data.resultJson || '{}');
        const url = Array.isArray(resultJson.resultUrls) ? resultJson.resultUrls[0] : '';
        if (!url) {
          throw createProviderError('provider_bad_response', 'Kie 返回成功但没有结果链接', { providerTaskId: taskId, providerStage: 'polling', providerStatus: 'success_without_result' });
        }
        return {
          providerTaskId: taskId,
          providerStage: 'completed',
          providerStatus: 'success',
          result: {
            imageUrl: url,
            videoUrl: isVideo ? url : undefined,
            taskId,
            status: 'success',
          },
        };
      }
      if (state === 'fail') {
        throw createProviderError('provider_bad_request', result.data?.failMsg || 'Kie 任务失败', { providerTaskId: taskId, providerStage: 'polling', providerStatus: 'failed' });
      }
    } else if (result?.code === 404) {
      if (Date.now() - startedAt < KIE_TRANSIENT_NOT_FOUND_GRACE_MS) {
        await wait(4000, signal);
        continue;
      }
      throw createProviderError('task_not_found', result?.msg || '任务不存在或已过期', { providerTaskId: taskId, providerStage: 'polling', providerStatus: 'not_found' });
    } else if (result?.code === 401 || result?.code === 403) {
      throw createProviderError('provider_auth_invalid', result?.msg || 'Kie 鉴权失败', { providerTaskId: taskId, providerStage: 'polling', providerStatus: 'auth_invalid' });
    } else if (result?.code >= 500) {
      throw createProviderError('provider_internal_error', result?.msg || 'Kie 服务异常', { providerTaskId: taskId, providerStage: 'polling', providerStatus: 'server_error' });
    }

    await wait(4000, signal);
  }

  throw createProviderError('provider_timeout', isVideo ? '视频合成超时' : '图像任务超时', { providerTaskId: taskId, providerStage: 'polling', providerStatus: lastKnownState || 'timeout' });
};

const pollKieVeoTask = async (taskId, kieApiKey, signal) => {
  for (let attempts = 0; attempts < 120; attempts += 1) {
    if (signal?.aborted) {
      throw createProviderError('request_cancelled', '任务已取消');
    }

    await wait(15000, signal);

    const response = await fetch(`${KIE_VEO_BASE_URL}/record-info?taskId=${encodeURIComponent(taskId)}`, {
      headers: {
        Authorization: `Bearer ${kieApiKey}`,
      },
      signal,
    });
    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw createProviderError('provider_auth_invalid', result?.msg || 'Veo 鉴权失败');
      }
      if (response.status === 404) {
        throw createProviderError('task_not_found', result?.msg || 'Veo 任务不存在');
      }
      if (response.status === 429) {
        throw createProviderError('provider_rate_limited', result?.msg || 'Veo 请求过于频繁');
      }
      if (response.status >= 500) {
        throw createProviderError('provider_internal_error', result?.msg || 'Veo 服务异常');
      }
    }

    if (result?.code === 200) {
      const data = result.data;
      if (data?.successFlag === 1) {
        const videoUrl = findVideoUrlRecursively(data);
        if (!videoUrl) {
          throw createProviderError('provider_bad_response', 'Veo 返回成功但没有视频地址');
        }
        return {
          providerTaskId: taskId,
          result: {
            taskId,
            videoUrl,
            status: 'success',
          },
        };
      }
      if (data?.successFlag === 2 || data?.successFlag === 3) {
        throw createProviderError('provider_bad_request', data.failReason || 'Veo 任务失败');
      }
    }
  }

  throw createProviderError('provider_timeout', 'Veo 任务超时');
};

const uploadAssetViaKie = async (payload, env) => {
  const { kieApiKey } = getProviderEnv(env);
  ensureProviderKey(kieApiKey, 'Kie API Key');

  const uploadPath = payload.uploadPath || 'mayo-storage/internal';
  const uploadFileName = payload.fileName || `upload_${Date.now()}.bin`;

  const response = await fetch('https://kieai.redpandaai.co/api/file-base64-upload', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${kieApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      base64Data: `data:${payload.mimeType || 'application/octet-stream'};base64,${payload.base64Data}`,
      uploadPath,
      fileName: uploadFileName,
    }),
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw createProviderError('provider_auth_invalid', result?.msg || '素材上传鉴权失败');
    }
    if (response.status === 429) {
      throw createProviderError('provider_rate_limited', result?.msg || '素材上传过于频繁');
    }
    if (response.status >= 500) {
      throw createProviderError('provider_internal_error', result?.msg || '素材上传服务异常');
    }
    throw createProviderError('provider_bad_request', result?.msg || '素材上传失败');
  }

  const fileUrl = extractUrlFromResponse(result);
  if (!fileUrl) {
    throw createProviderError('provider_bad_response', '上传成功但未返回素材地址');
  }

  return {
    result: {
      fileUrl,
    },
  };
};

export const uploadAssetViaKieStream = async (payload, env) => {
  const { kieApiKey } = getProviderEnv(env);
  ensureProviderKey(kieApiKey, 'Kie API Key');

  const formData = new FormData();
  const fileBuffer = payload.fileBuffer instanceof Uint8Array ? payload.fileBuffer : Buffer.from(payload.fileBuffer || '');
  const mimeType = payload.mimeType || 'application/octet-stream';
  const fileName = payload.fileName || `upload_${Date.now()}.bin`;
  formData.append('file', new Blob([fileBuffer], { type: mimeType }), fileName);
  formData.append('fileName', fileName);
  formData.append('uploadPath', payload.uploadPath || 'mayo-storage/internal');

  const response = await fetch('https://kieai.redpandaai.co/api/file-stream-upload', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${kieApiKey}`,
    },
    body: formData,
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw createProviderError('provider_auth_invalid', result?.msg || '素材上传鉴权失败');
    }
    if (response.status === 429) {
      throw createProviderError('provider_rate_limited', result?.msg || '素材上传过于频繁');
    }
    if (response.status >= 500) {
      throw createProviderError('provider_internal_error', result?.msg || '素材上传服务异常');
    }
    throw createProviderError('provider_bad_request', result?.msg || '素材上传失败');
  }

  const fileUrl = extractUrlFromResponse(result);
  if (!fileUrl) {
    throw createProviderError('provider_bad_response', '上传成功但未返回素材地址');
  }

  return {
    result: {
      fileUrl,
    },
  };
};

const runKieResponsesJob = async (payload, env, signal) => {
  const { kieApiKey } = getProviderEnv(env);
  ensureProviderKey(kieApiKey, 'Kie API Key');
  const preparedMessages = await resolveProviderMessages(payload.messages, env, signal, { model: payload.model });
  const instructions = extractResponsesInstructions(preparedMessages);

  const response = await fetch(KIE_RESPONSES_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${kieApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: resolveKieResponsesModel(payload.model || 'gpt-5-4'),
      ...(instructions ? { instructions } : {}),
      input: buildResponsesInputMessages(preparedMessages, buildKieResponsesContent),
      stream: false,
      ...(payload.reasoningLevel ? { reasoning: { effort: normalizeReasoningLevelForModel(payload.model, payload.reasoningLevel) } } : {}),
      ...(payload.webSearchEnabled ? { tools: [{ type: 'web_search' }] } : {}),
    }),
    signal,
  });

  if (!response.ok) {
    await mapHttpError(response, 'Kie Responses 请求失败');
  }

  const data = await response.json().catch(() => ({}));
  const content =
    extractChatMessageText(data?.output) ||
    extractChatMessageText(data?.response?.output) ||
    (typeof data?.output_text === 'string' ? data.output_text.trim() : '') ||
    '';
  if (!content) {
    throw createProviderError('provider_bad_response', 'Kie Responses 返回为空');
  }
  return {
    result: {
      content,
      modelUsed: String(payload.model || '').trim(),
    },
  };
};

const runKieImageJob = async (payload, env, signal) => {
  const { kieApiKey } = getProviderEnv(env);
  ensureProviderKey(kieApiKey, 'Kie API Key');
  const imageUrls = await Promise.all(
    (Array.isArray(payload.imageUrls) ? payload.imageUrls : []).map((item) => resolveProviderGenerationMediaUrl(item, env, signal))
  );

  const response = await fetch(KIE_CREATE_TASK_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${kieApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: payload.model || 'nano-banana-2',
      input: {
        prompt: payload.prompt,
        image_input: imageUrls,
        aspect_ratio: payload.aspectRatio || 'auto',
        resolution: payload.resolution || '1K',
        output_format: 'png',
      },
    }),
    signal,
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok || result?.code !== 200 || !result?.data?.taskId) {
    if (response.status === 401 || response.status === 403 || result?.code === 401 || result?.code === 403) {
      throw createProviderError('provider_auth_invalid', result?.msg || 'Kie 图像任务鉴权失败', { providerStage: 'create_task', providerStatus: 'auth_invalid' });
    }
    if (response.status === 429) {
      throw createProviderError('provider_rate_limited', result?.msg || 'Kie 图像任务请求过于频繁', { providerStage: 'create_task', providerStatus: 'rate_limited' });
    }
    if (response.status >= 500 || result?.code >= 500) {
      throw createProviderError('provider_internal_error', result?.msg || 'Kie 图像任务服务异常', { providerStage: 'create_task', providerStatus: 'server_error' });
    }
    throw createProviderError('provider_bad_request', result?.msg || 'Kie 图像任务创建失败', { providerStage: 'create_task', providerStatus: 'bad_request' });
  }

  try {
    const imageResult = await pollKieTask(result.data.taskId, kieApiKey, signal, false);
    return {
      ...imageResult,
      providerTaskId: imageResult.providerTaskId || result.data.taskId,
      providerStage: imageResult.providerStage || 'completed',
      providerStatus: imageResult.providerStatus || 'success',
    };
  } catch (error) {
    throw attachProviderTaskId(error, result.data.taskId);
  }
};

const runKieRecoverJob = async (payload, env, signal) => {
  const { kieApiKey } = getProviderEnv(env);
  ensureProviderKey(kieApiKey, 'Kie API Key');
  const providerTaskId = payload.providerTaskId || payload.taskId;
  try {
    return await pollKieTask(providerTaskId, kieApiKey, signal, Boolean(payload.isVideo));
  } catch (error) {
    throw attachProviderTaskId(error, providerTaskId);
  }
};

const runKieVideoJob = async (payload, env, signal) => {
  const { kieApiKey } = getProviderEnv(env);
  ensureProviderKey(kieApiKey, 'Kie API Key');

  const targetImageUrls = await Promise.all(
    (Array.isArray(payload.imageUrls) ? payload.imageUrls.slice(0, 1) : []).map((item) => resolveProviderGenerationMediaUrl(item, env, signal))
  );
  const input = {
    n_frames: Number.parseInt(String(payload.videoConfig?.duration || '15'), 10),
    image_urls: targetImageUrls,
    aspect_ratio: payload.videoConfig?.aspectRatio === 'landscape' ? '16:9' : '9:16',
  };

  if (payload.videoConfig?.promptMode === 'manual' && Array.isArray(payload.videoConfig?.scenes) && payload.videoConfig.scenes.length > 0) {
    input.scenes = payload.videoConfig.scenes.map((scene) => ({
      Scene: scene.Scene,
      duration: Number(scene.duration),
    }));
  } else {
    input.prompt = payload.videoConfig?.script || 'Professional commercial product advertisement, cinematic lighting.';
  }

  const response = await fetch(KIE_CREATE_TASK_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${kieApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'sora-2-pro-storyboard',
      input,
    }),
    signal,
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok || result?.code !== 200 || !result?.data?.taskId) {
    if (response.status === 401 || response.status === 403 || result?.code === 401 || result?.code === 403) {
      throw createProviderError('provider_auth_invalid', result?.msg || 'Kie 视频任务鉴权失败');
    }
    if (response.status === 429) {
      throw createProviderError('provider_rate_limited', result?.msg || 'Kie 视频任务请求过于频繁');
    }
    if (response.status >= 500 || result?.code >= 500) {
      throw createProviderError('provider_internal_error', result?.msg || 'Kie 视频任务服务异常');
    }
    throw createProviderError('provider_bad_request', result?.msg || 'Kie 视频任务创建失败');
  }

  try {
    return await pollKieTask(result.data.taskId, kieApiKey, signal, true);
  } catch (error) {
    throw attachProviderTaskId(error, result.data.taskId);
  }
};

const runKieVeoJob = async (payload, env, signal) => {
  const { kieApiKey } = getProviderEnv(env);
  ensureProviderKey(kieApiKey, 'Kie API Key');

  const fullPrompt = `视频内容描述：${payload.script?.description || ''}；人声口播：${payload.script?.spokenContent || ''}；背景音乐：${payload.script?.bgm || ''}`.trim();
  let endpoint = `${KIE_VEO_BASE_URL}/generate`;
  let requestPayload = {
    prompt: fullPrompt,
    model: 'veo3_fast',
    aspect_ratio: payload.aspectRatio === '9:16' ? '9:16' : '16:9',
  };

  if (payload.previousTaskId) {
    endpoint = `${KIE_VEO_BASE_URL}/extend`;
    requestPayload = {
      taskId: payload.previousTaskId,
      prompt: fullPrompt,
    };
  } else if (Array.isArray(payload.imageUrls) && payload.imageUrls.length > 0) {
    const imageUrls = await Promise.all(payload.imageUrls.map((item) => resolveProviderMediaUrl(item, env, signal)));
    requestPayload.generationType = 'REFERENCE_2_VIDEO';
    requestPayload.imageUrls = imageUrls;
  } else {
    requestPayload.generationType = 'TEXT_2_VIDEO';
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${kieApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestPayload),
    signal,
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok || result?.code !== 200 || !result?.data?.taskId) {
    if (response.status === 401 || response.status === 403 || result?.code === 401 || result?.code === 403) {
      throw createProviderError('provider_auth_invalid', result?.msg || 'Kie Veo 鉴权失败');
    }
    if (response.status === 429) {
      throw createProviderError('provider_rate_limited', result?.msg || 'Kie Veo 请求过于频繁');
    }
    if (response.status >= 500 || result?.code >= 500) {
      throw createProviderError('provider_internal_error', result?.msg || 'Kie Veo 服务异常');
    }
    throw createProviderError('provider_bad_request', result?.msg || 'Kie Veo 任务创建失败');
  }

  try {
    return await pollKieVeoTask(result.data.taskId, kieApiKey, signal);
  } catch (error) {
    throw attachProviderTaskId(error, result.data.taskId);
  }
};

const runKieChatJob = async (payload, env, signal) => {
  const transport = resolveChatTransport(payload.model);
  if (transport === 'unsupported') {
    throw createProviderError('provider_bad_request', `不支持的聊天模型：${String(payload.model || '').trim() || '未知模型'}`);
  }
  if (transport === 'kie_responses') {
    try {
      return await runKieResponsesJob(payload, env, signal);
    } catch (error) {
      const fallbackModels = getKieChatFallbackModels(payload.model, payload.fallbackModels);
      const code = String(error?.code || '').trim();
      if (!fallbackModels.length || !['provider_bad_response', 'provider_internal_error', 'provider_network_error'].includes(code)) {
        throw error;
      }
      let lastError = error;
      for (const fallbackModel of fallbackModels) {
        try {
          const fallbackResult = await runKieChatJob(
            { ...payload, model: fallbackModel, reasoningLevel: normalizeReasoningLevelForModel(fallbackModel, payload.reasoningLevel) },
            env,
            signal
          );
          // 标记实际使用了 fallback 模型
          if (fallbackResult?.result) {
            fallbackResult.result.fallbackFrom = String(payload.model || '').trim();
          }
          return fallbackResult;
        } catch (fallbackError) {
          lastError = fallbackError;
        }
      }
      throw lastError;
    }
  }

  const { kieApiKey } = getProviderEnv(env);
  ensureProviderKey(kieApiKey, 'Kie API Key');
  const model = String(payload.model || 'gpt-5-2').trim() || 'gpt-5-2';
  const endpoint = resolveKieChatEndpoint(model);
  const isGeminiModel = isKieGeminiChatModel(model);
  const preparedMessages = await resolveProviderMessages(payload.messages, env, signal, { model });
  const messages = isGeminiModel
    ? buildProviderInputMessages(preparedMessages, buildKieChatContent)
    : preparedMessages;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${kieApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages,
      stream: false,
      ...(isGeminiModel && payload.webSearchEnabled ? { tools: [{ googleSearch: {} }] } : {}),
      ...(isGeminiModel && payload.reasoningLevel ? { include_thoughts: true, reasoning_effort: normalizeReasoningLevelForModel(model, payload.reasoningLevel) } : {}),
    }),
    signal,
  });

  if (!response.ok) {
    await mapHttpError(response, 'Kie 对话请求失败');
  }

  const data = await response.json().catch(() => ({}));
  const content =
    extractChatMessageText(data?.choices?.[0]?.message?.content) ||
    extractChatMessageText(data?.content) ||
    extractChatMessageText(data?.candidates?.[0]?.content) ||
    extractChatMessageText(data) ||
    '';

  if (!content) {
    throw createProviderError('provider_bad_response', 'Kie 对话返回为空');
  }

  return {
    result: {
      content,
      modelUsed: model,
    },
  };
};

export const executeProviderJob = async (job, env, signal) => {
  switch (job.taskType) {
    case 'upload_asset':
      if (job.payload?.fileBuffer) {
        return uploadAssetViaKieStream(job.payload, env);
      }
      return uploadAssetViaKie(job.payload, env);
    case 'kie_image':
      if (job.providerTaskId) {
        return runKieRecoverJob(
          {
            ...job.payload,
            providerTaskId: job.providerTaskId,
            taskId: job.providerTaskId,
            isVideo: false,
          },
          env,
          signal
        );
      }
      return runKieImageJob(job.payload, env, signal);
    case 'kie_recover':
      return runKieRecoverJob(job.payload, env, signal);
    case 'kie_video':
      return runKieVideoJob(job.payload, env, signal);
    case 'kie_veo':
      return runKieVeoJob(job.payload, env, signal);
    case 'kie_chat':
      return runKieChatJob(job.payload, env, signal);
    default:
      throw createProviderError('provider_bad_request', `不支持的任务类型：${job.taskType}`);
  }
};

export const getProviderConfigStatus = (env) => {
  const providerEnv = getProviderEnv(env);
  return {
    kie: Boolean(providerEnv.kieApiKey),
  };
};
