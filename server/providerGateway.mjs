import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { getMaxListeners, setMaxListeners } from 'node:events';
import { isIP } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { GPT_IMAGE_2_DEFAULT_RESOLUTION, normalizeGptImage2Resolution } from '../src/utils/gptImage2.mjs';
import { isExternallyReachableBaseUrl, isLocalOrPrivateHostname, normalizeBaseUrl } from '../src/utils/publicNetworkUrl.mjs';
import { queryDreaminaVideoTask, submitDreaminaVideoTask } from './dreaminaVideoCli.mjs';

const KIE_CREATE_TASK_URL = 'https://api.kie.ai/api/v1/jobs/createTask';
const KIE_RECORD_INFO_URL = 'https://api.kie.ai/api/v1/jobs/recordInfo';
const KIE_VEO_BASE_URL = 'https://api.kie.ai/api/v1/veo';
const KIE_CHAT_URL = 'https://api.kie.ai/gpt-5-2/v1/chat/completions';
const KIE_RESPONSES_URL = 'https://api.kie.ai/codex/v1/responses';
const KIE_CLAUDE_MESSAGES_URL = 'https://api.kie.ai/claude/v1/messages';
const KIE_GEMINI_FLASH_URL = 'https://api.kie.ai/gemini-3-flash/v1/chat/completions';
const APIPORTS_IMAGE_GENERATIONS_URL = 'https://apiports.com/v1/api/generate';
const APIPORTS_GPT_IMAGE_2_SECONDARY_MODEL = 'gpt-image-2-secondary';
const KIE_TRANSIENT_NOT_FOUND_GRACE_MS = 45_000;
const KIE_TRANSIENT_FETCH_ERROR_GRACE_MS = 240_000;
const KIE_HTTP_REQUEST_TIMEOUT_MS = 60_000;
const KIE_CHAT_STREAM_IDLE_TIMEOUT_MS = 120_000;
const DREAMINA_VIDEO_POLL_RETRIES = 180;
const DREAMINA_VIDEO_POLL_INTERVAL_MS = 5_000;
const MAX_PROVIDER_REMOTE_MEDIA_MB = 256;
const MAX_PROVIDER_REMOTE_MEDIA_BYTES = MAX_PROVIDER_REMOTE_MEDIA_MB * 1024 * 1024;
const MANAGED_ASSET_PATH_SEGMENT = '/api/assets/file/';
const KIE_RESPONSES_MODEL_ALIASES = {
  'gpt-5-4-openai-resp': 'gpt-5-4',
  'gpt-5-4': 'gpt-5-4',
  'gpt-5.4': 'gpt-5-4',
};
const KIE_CLAUDE_MODEL_ALIASES = {
  'claude-sonnet-4-6': 'claude-sonnet-4-6',
  'claude-sonnet-4-6-v1messages': 'claude-sonnet-4-6',
};
const KIE_IMAGE_MODEL_ALIASES = {
  'gpt-image-2': {
    text: 'gpt-image-2-text-to-image',
    image: 'gpt-image-2-image-to-image',
    maxInputImages: 16,
    pollRetries: 150,
    supportedAspectRatios: ['auto', '1:1', '9:16', '16:9', '4:3', '3:4'],
  },
};
const KIE_CHAT_MODEL_ENDPOINTS = {
  'gpt-5-2': KIE_CHAT_URL,
  'gemini-3.1-pro-openai': 'https://api.kie.ai/gemini-3.1-pro/v1/chat/completions',
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
  kie_claude_messages: {
    image: 'url',
    file: 'url',
  },
};

let dreaminaVideoRunnerForTest = null;

export const __testOnly_setDreaminaVideoRunner = (runner) => {
  dreaminaVideoRunnerForTest = typeof runner === 'function' ? runner : null;
};

const allowConcurrentAbortListeners = (signal, count) => {
  if (!signal || typeof signal !== 'object') return;
  const currentLimit = Number(getMaxListeners(signal) || 10);
  const requestedLimit = Math.max(10, Number(count || 0) + 4);
  if (requestedLimit <= currentLimit) return;
  setMaxListeners(Math.max(currentLimit, requestedLimit), signal);
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

const normalizeKieTaskCreationError = (responseStatus, result = {}, defaultMessage) => {
  const code = Number(result?.code || 0);
  const message = String(result?.msg || defaultMessage || '').trim();

  if (responseStatus === 401 || responseStatus === 403 || code === 401 || code === 403) {
    return createProviderError('provider_auth_invalid', message || 'Kie 图像任务鉴权失败', {
      providerStage: 'create_task',
      providerStatus: 'auth_invalid',
    });
  }
  if (responseStatus === 429 || code === 429) {
    return createProviderError('provider_rate_limited', message || 'Kie 图像任务请求过于频繁', {
      providerStage: 'create_task',
      providerStatus: 'rate_limited',
    });
  }
  if (code === 402 || /credits insufficient/i.test(message)) {
    return createProviderError('provider_credit_insufficient', message || 'Kie 余额不足', {
      providerStage: 'create_task',
      providerStatus: 'credit_insufficient',
    });
  }
  if (code === 433 || /sub-?key|exceeds limit|request limit/i.test(message)) {
    return createProviderError('provider_request_limit', message || 'Kie 额度受限', {
      providerStage: 'create_task',
      providerStatus: 'request_limit',
    });
  }
  if (responseStatus >= 500 || code >= 500) {
    return createProviderError('provider_internal_error', message || 'Kie 图像任务服务异常', {
      providerStage: 'create_task',
      providerStatus: 'server_error',
    });
  }
  return createProviderError('provider_bad_request', message || 'Kie 图像任务创建失败', {
    providerStage: 'create_task',
    providerStatus: 'bad_request',
  });
};

const attachProviderTaskId = (error, providerTaskId) => {
  if (error && typeof error === 'object' && providerTaskId && !error.providerTaskId) {
    error.providerTaskId = providerTaskId;
  }
  return error;
};

const fetchKieWithTimeout = async (
  url,
  init = {},
  timeoutMessage = 'Kie 请求超时',
  timeoutMs = KIE_HTTP_REQUEST_TIMEOUT_MS,
  providerStage = 'http_request'
) => {
  const controller = new AbortController();
  const upstreamSignal = init.signal;
  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  const onAbort = () => controller.abort(upstreamSignal?.reason);
  if (upstreamSignal) {
    if (upstreamSignal.aborted) {
      controller.abort(upstreamSignal.reason);
    } else {
      upstreamSignal.addEventListener('abort', onAbort, { once: true });
    }
  }

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (upstreamSignal?.aborted) {
      throw createProviderError('request_cancelled', '任务已取消');
    }
    if (timedOut || error?.name === 'AbortError') {
      throw createProviderError('provider_timeout', timeoutMessage, {
        providerStage,
        providerStatus: 'timeout',
      });
    }
    throw createProviderError('provider_network_error', error?.message || 'Kie 网络请求失败', {
      providerStage,
      providerStatus: 'network_error',
    });
  } finally {
    clearTimeout(timeoutId);
    upstreamSignal?.removeEventListener?.('abort', onAbort);
  }
};

const getEnvValue = (env, ...keys) => keys.map((key) => env[key]).find(Boolean) || '';

const getProviderEnv = (env) => ({
  kieApiKey: getEnvValue(env, 'KIE_API_KEY', 'MEIAO_KIE_API_KEY'),
  apiportsApiKey: getEnvValue(env, 'APIPORTS_API_KEY', 'MEIAO_APIPORTS_API_KEY'),
  apiportsBaseUrl: getEnvValue(env, 'APIPORTS_BASE_URL', 'MEIAO_APIPORTS_BASE_URL'),
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

const getManagedAssetPath = (value) => {
  const normalized = String(value || '').trim();
  if (!normalized) return '';
  if (normalized.startsWith(MANAGED_ASSET_PATH_SEGMENT)) return normalized;
  try {
    const parsed = new URL(normalized);
    if (!parsed.pathname.includes(MANAGED_ASSET_PATH_SEGMENT)) return '';
    return `${parsed.pathname}${parsed.search || ''}`;
  } catch {
    return '';
  }
};

const getProviderPublicBaseUrl = (env = {}) =>
  normalizeBaseUrl(env.MEIAO_PUBLIC_BASE_URL || env.PUBLIC_BASE_URL || process.env.MEIAO_PUBLIC_BASE_URL || process.env.PUBLIC_BASE_URL || '');

const resolveExternallyReachableManagedAssetUrl = (value, env = {}) => {
  const normalized = String(value || '').trim();
  if (!isManagedAssetUrl(normalized)) return '';
  try {
    const parsed = new URL(normalized);
    if (['http:', 'https:'].includes(parsed.protocol) && !isLocalOrPrivateHostname(parsed.hostname)) {
      return normalized;
    }
  } catch {
    // Relative managed asset paths can still be made public through MEIAO_PUBLIC_BASE_URL.
  }
  const assetPath = getManagedAssetPath(normalized);
  const publicBaseUrl = getProviderPublicBaseUrl(env);
  if (assetPath && isExternallyReachableBaseUrl(publicBaseUrl)) {
    return `${publicBaseUrl}${assetPath}`;
  }
  return '';
};

const normalizeProviderMediaReference = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const markdownTarget = raw.match(/^\[[^\]]*]\(([^)\s]+)\)$/);
  if (markdownTarget?.[1]) return markdownTarget[1].trim();
  const absoluteUrl = raw.match(/https?:\/\/[^\s"'<>，。；、）)\]】]+/i);
  return absoluteUrl?.[0]?.trim() || raw;
};

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
  if (normalized.endsWith('.mp4') || normalized.endsWith('.m4v')) return 'video/mp4';
  if (normalized.endsWith('.mov')) return 'video/quicktime';
  if (normalized.endsWith('.webm')) return 'video/webm';
  if (normalized.endsWith('.pdf')) return 'application/pdf';
  if (normalized.endsWith('.txt')) return 'text/plain';
  if (normalized.endsWith('.md')) return 'text/markdown';
  if (normalized.endsWith('.json')) return 'application/json';
  return fallback;
};

const UNSUPPORTED_GENERATION_IMAGE_EXTENSIONS = new Set(['.zip', '.rar', '.7z', '.tar', '.gz', '.tgz']);

const extractPathExtension = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const pathname = (() => {
    try {
      return decodeURIComponent(new URL(raw).pathname || '');
    } catch {
      return raw.split('?')[0].split('#')[0];
    }
  })().toLowerCase();
  const match = pathname.match(/(\.[a-z0-9]+)$/i);
  return match?.[1] || '';
};

const assertSupportedGenerationImageReferences = (values = []) => {
  for (const value of values) {
    const normalized = normalizeProviderMediaReference(value);
    if (!normalized) continue;
    const extension = extractPathExtension(normalized);
    if (!UNSUPPORTED_GENERATION_IMAGE_EXTENSIONS.has(extension)) continue;
    throw createProviderError(
      'provider_bad_request',
      `不支持的图片素材格式：${extension.replace(/^\./, '')}。请先解压并上传 png、jpg、jpeg、webp 或 gif 图片。`
    );
  }
};

const inferExtensionFromMimeType = (value, fallback = 'bin') => {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'image/png') return 'png';
  if (normalized === 'image/jpeg') return 'jpg';
  if (normalized === 'image/webp') return 'webp';
  if (normalized === 'image/gif') return 'gif';
  if (normalized === 'image/bmp') return 'bmp';
  if (normalized === 'image/svg+xml') return 'svg';
  if (normalized === 'video/mp4') return 'mp4';
  if (normalized === 'video/quicktime') return 'mov';
  if (normalized === 'video/webm') return 'webm';
  if (normalized === 'application/pdf') return 'pdf';
  if (normalized === 'text/plain') return 'txt';
  if (normalized === 'text/markdown') return 'md';
  if (normalized === 'application/json') return 'json';
  return fallback;
};

const detectMimeTypeFromBuffer = (buffer) => {
  const bytes = buffer instanceof Uint8Array ? buffer : Buffer.from(buffer || '');
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) return 'image/png';
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) return 'image/webp';
  if (bytes.length >= 6) {
    const signature = Buffer.from(bytes.slice(0, 6)).toString('ascii');
    if (signature === 'GIF87a' || signature === 'GIF89a') return 'image/gif';
  }
  return '';
};

const ensureProviderFileNameWithExtension = (fileName, mimeType) => {
  const normalizedName = String(fileName || '').trim() || 'upload';
  if (/\.[a-z0-9]{2,5}$/i.test(normalizedName)) return normalizedName;
  const extension = inferExtensionFromMimeType(mimeType, '');
  return extension ? `${normalizedName}.${extension}` : normalizedName;
};

const buildKieAspectRatioPromptHint = (aspectRatio) => {
  const normalized = String(aspectRatio || '').trim();
  if (!normalized || normalized === 'auto') return '';
  return `最终画面按 ${normalized} 比例构图生成。`;
};

const augmentImagePromptForModel = (model, prompt, aspectRatio, mode = 'text') => {
  const normalizedPrompt = String(prompt || '').trim();
  if (model !== 'gpt-image-2') return normalizedPrompt;
  if (mode === 'image') return normalizedPrompt;
  return normalizedPrompt;
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

const shouldFallbackKieUploadError = (error) => new Set([
  'provider_auth_invalid',
  'provider_internal_error',
  'provider_network_error',
  'provider_timeout',
]).has(String(error?.code || '').trim());

const uploadAssetViaKieWithFallback = async (payload, env) => {
  try {
    return await uploadAssetViaKieStream(payload, env);
  } catch (error) {
    if (!shouldFallbackKieUploadError(error)) throw error;
    const fileBuffer = payload.fileBuffer instanceof Uint8Array ? payload.fileBuffer : Buffer.from(payload.fileBuffer || '');
    return uploadAssetViaKie({
      ...payload,
      fileBuffer,
      base64Data: Buffer.from(fileBuffer).toString('base64'),
    }, env);
  }
};

const convertInlineDataUrlToKieFileUrl = async (value, env) => {
  const parsed = parseDataUrlPayload(value);
  if (!parsed) return String(value || '').trim();
  const extension = inferExtensionFromMimeType(parsed.mimeType);
  const uploaded = await uploadAssetViaKieWithFallback({
    fileBuffer: Buffer.from(parsed.base64Data, 'base64'),
    mimeType: parsed.mimeType,
    fileName: `inline-upload.${extension}`,
    uploadPath: 'mayo-storage/internal',
  }, env);
  return String(uploaded?.result?.fileUrl || '').trim();
};

const downloadManagedAsset = async (assetUrl, signal) => {
  const response = await fetchKieWithTimeout(normalizeManagedAssetDownloadUrl(assetUrl), {
    method: 'GET',
    signal,
  }, '内部素材下载超时', 60_000, 'asset_download');
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

const convertManagedAssetUrlToKieFileUrl = async (assetUrl, env, signal, options = {}) => {
  if (!isManagedAssetUrl(assetUrl)) return String(assetUrl || '').trim();
  if (!options.forceUpload) {
    const publicAssetUrl = resolveExternallyReachableManagedAssetUrl(assetUrl, env);
    if (publicAssetUrl) return publicAssetUrl;
  }
  const downloaded = await downloadManagedAsset(assetUrl, signal);
  const uploaded = await uploadAssetViaKieWithFallback({
    ...downloaded,
    uploadPath: 'mayo-storage/internal',
  }, env);
  return String(uploaded?.result?.fileUrl || '').trim();
};

const isOpenRouterChatFileUrl = (value) => {
  try {
    const url = new URL(String(value || ''));
    return /^tempfileb\.aiquickdraw\.com$/i.test(url.hostname || '')
      && /^\/kieai\/openrouter-chat\//i.test(url.pathname || '');
  } catch {
    return false;
  }
};

const isRedpandaOpenRouterChatFileUrl = (value) => {
  try {
    const url = new URL(String(value || ''));
    return /^tempfile\.redpandaai\.co$/i.test(url.hostname || '')
      && /\/openrouter-chat\//i.test(url.pathname || '');
  } catch {
    return false;
  }
};

const isVideoMediaUrl = (value) => {
  const normalized = String(value || '').split('?')[0].toLowerCase();
  return /\.(mp4|m4v|mov|webm)$/i.test(normalized);
};

const isPrivateIpv4Hostname = (hostname) => {
  const parts = String(hostname || '').split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b] = parts;
  return a === 10
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 169 && b === 254)
    || a === 127
    || a === 0;
};

const assertRemoteProviderMediaUrlAllowed = (mediaUrl) => {
  let parsed;
  try {
    parsed = new URL(String(mediaUrl || '').trim());
  } catch {
    throw createProviderError('provider_bad_request', '远程素材 URL 无效');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw createProviderError('provider_bad_request', '远程素材仅支持 HTTP/HTTPS 地址');
  }
  const hostname = parsed.hostname.toLowerCase();
  const ipVersion = isIP(hostname);
  const isBlockedHost = hostname === 'localhost'
    || hostname.endsWith('.localhost')
    || hostname.endsWith('.local')
    || (ipVersion === 4 && isPrivateIpv4Hostname(hostname))
    || (ipVersion === 6 && (
      hostname === '::1'
      || hostname.startsWith('fc')
      || hostname.startsWith('fd')
      || hostname.startsWith('fe80:')
    ));
  if (isBlockedHost) {
    throw createProviderError('provider_bad_request', '远程素材地址不可指向本机或内网地址');
  }
};

const readRemoteMediaBufferWithLimit = async (response, label = '远程素材') => {
  const contentLength = Number(response.headers?.get?.('content-length') || 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_PROVIDER_REMOTE_MEDIA_BYTES) {
    throw createProviderError('provider_bad_request', `${label}过大，当前最大支持 ${MAX_PROVIDER_REMOTE_MEDIA_MB}MB`);
  }

  if (!response.body?.getReader) {
    const fallbackBuffer = Buffer.from(await response.arrayBuffer());
    if (fallbackBuffer.length > MAX_PROVIDER_REMOTE_MEDIA_BYTES) {
      throw createProviderError('provider_bad_request', `${label}过大，当前最大支持 ${MAX_PROVIDER_REMOTE_MEDIA_MB}MB`);
    }
    return fallbackBuffer;
  }

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = Buffer.from(value);
    total += chunk.length;
    if (total > MAX_PROVIDER_REMOTE_MEDIA_BYTES) {
      await reader.cancel().catch(() => null);
      throw createProviderError('provider_bad_request', `${label}过大，当前最大支持 ${MAX_PROVIDER_REMOTE_MEDIA_MB}MB`);
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, total);
};

const downloadRemoteMediaUrl = async (mediaUrl, signal) => {
  if (isManagedAssetUrl(mediaUrl)) return downloadManagedAsset(mediaUrl, signal);
  assertRemoteProviderMediaUrlAllowed(mediaUrl);
  const response = await fetchKieWithTimeout(mediaUrl, {
    method: 'GET',
    signal,
  }, '远程视频素材下载超时', 120_000, 'asset_download');
  if (!response.ok) {
    throw createProviderError('provider_bad_request', `远程视频素材下载失败：HTTP ${response.status}`);
  }
  const fileName = extractFileNameFromUrl(mediaUrl, `video-${Date.now()}.mp4`);
  const mimeTypeHeader = response.headers?.get?.('content-type') || '';
  const mimeType = String(mimeTypeHeader || '').split(';')[0].trim() || inferMimeTypeFromName(fileName, 'video/mp4');
  const fileBuffer = await readRemoteMediaBufferWithLimit(response, '远程视频素材');
  return {
    fileName,
    mimeType,
    fileBuffer,
  };
};

const downloadRemoteProviderMediaUrl = async (mediaUrl, signal) => {
  if (isManagedAssetUrl(mediaUrl)) return downloadManagedAsset(mediaUrl, signal);
  assertRemoteProviderMediaUrlAllowed(mediaUrl);
  const response = await fetchKieWithTimeout(mediaUrl, {
    method: 'GET',
    signal,
  }, '远程素材下载超时', 120_000, 'asset_download');
  if (!response.ok) {
    throw createProviderError('provider_bad_request', `远程素材下载失败：HTTP ${response.status}`);
  }
  const rawFileName = extractFileNameFromUrl(mediaUrl, `media-${Date.now()}.bin`);
  const mimeTypeHeader = response.headers?.get?.('content-type') || '';
  const fileBuffer = await readRemoteMediaBufferWithLimit(response, '远程素材');
  const inferredFromName = inferMimeTypeFromName(rawFileName, '');
  const inferredFromBuffer = detectMimeTypeFromBuffer(fileBuffer);
  const headerMimeType = String(mimeTypeHeader || '').split(';')[0].trim();
  const mimeType = inferredFromBuffer || inferredFromName || headerMimeType || 'application/octet-stream';
  return {
    fileName: ensureProviderFileNameWithExtension(rawFileName, mimeType),
    mimeType,
    fileBuffer,
  };
};

const shouldUploadGeminiMediaUrlForStableMime = (value) => {
  const normalized = String(value || '').trim();
  if (!normalized || isVideoMediaUrl(normalized) || isManagedAssetUrl(normalized)) return false;
  if (!/^https?:\/\//i.test(normalized)) return false;
  const pathname = (() => {
    try {
      return new URL(normalized).pathname || '';
    } catch {
      return normalized.split('?')[0] || '';
    }
  })();
  if (/\.(png|jpe?g|webp|gif|bmp|svg|pdf|txt|md|json)$/i.test(pathname)) return false;
  if (/tempfile\.redpandaai\.co|tempfileb\.aiquickdraw\.com/i.test(normalized)) return true;
  return false;
};

const convertGeminiMediaToStableKieUrl = async (mediaUrl, env, signal) => {
  const downloaded = await downloadRemoteProviderMediaUrl(mediaUrl, signal);
  const uploaded = await uploadAssetViaKieStream({
    ...downloaded,
    uploadPath: 'mayo-storage/internal',
  }, env);
  return String(uploaded?.result?.fileUrl || '').trim();
};

const shouldUploadGeminiVideoUrlToOpenRouterChat = (value) => {
  const normalized = String(value || '').trim();
  if (!normalized || !isVideoMediaUrl(normalized)) return false;
  if (isOpenRouterChatFileUrl(normalized)) return false;
  return true;
};

const convertGeminiVideoToOpenRouterChatUrl = async (mediaUrl, env, signal) => {
  const normalized = String(mediaUrl || '').trim();
  if (!shouldUploadGeminiVideoUrlToOpenRouterChat(normalized)) return normalized;
  const downloaded = await downloadRemoteMediaUrl(normalized, signal);
  const uploaded = await uploadAssetViaKieWithFallback({
    ...downloaded,
    uploadPath: 'openrouter-chat',
  }, env);
  return String(uploaded?.result?.fileUrl || '').trim();
};

const resolveProviderGeminiChatMediaUrl = async (value, env, signal) => {
  const normalized = String(value || '').trim();
  if (!normalized) return '';
  if (isVideoMediaUrl(normalized)) {
    return convertGeminiVideoToOpenRouterChatUrl(normalized, env, signal);
  }
  if (shouldUploadGeminiMediaUrlForStableMime(normalized)) {
    return convertGeminiMediaToStableKieUrl(normalized, env, signal);
  }
  return resolveProviderChatMediaUrl(normalized, env, signal);
};

const resolveProviderChatMediaUrl = async (value, env, signal) => {
  const normalized = normalizeProviderMediaReference(value);
  if (!normalized) return '';
  if (normalized.startsWith('data:')) {
    return convertInlineDataUrlToKieFileUrl(normalized, env);
  }
  if (!isManagedAssetUrl(normalized)) return normalized;
  return convertManagedAssetUrlToKieFileUrl(normalized, env, signal, { forceUpload: true });
};

const resolveProviderGenerationMediaUrl = async (value, env, signal) => {
  const normalized = normalizeProviderMediaReference(value);
  if (!normalized) return '';
  if (!isManagedAssetUrl(normalized)) return normalized;
  return convertManagedAssetUrlToKieFileUrl(normalized, env, signal, { forceUpload: true });
};

const resolveProviderMediaUrl = async (value, env, signal) => {
  const normalized = normalizeProviderMediaReference(value);
  if (!normalized) return '';
  if (normalized.startsWith('data:')) {
    return convertInlineDataUrlToKieFileUrl(normalized, env);
  }
  if (!isManagedAssetUrl(normalized)) return normalized;
  return convertManagedAssetUrlToKieFileUrl(normalized, env, signal);
};

const escapeRegExp = (value) => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const extractTextMediaUrls = (text = '') => {
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

const rewriteProviderTextMediaUrls = async (text, resolveMediaUrl) => {
  const source = String(text || '');
  const urls = extractTextMediaUrls(source);
  if (urls.length === 0) return source;
  let rewritten = source;
  for (const rawUrl of urls) {
    const resolvedUrl = await resolveMediaUrl(rawUrl);
    if (!resolvedUrl || resolvedUrl === rawUrl) continue;
    rewritten = rewritten.replace(new RegExp(escapeRegExp(rawUrl), 'g'), resolvedUrl);
  }
  return rewritten;
};

const resolveAttachmentStrategy = (model, item) => {
  const transport = resolveChatTransport(model);
  const kind = item?.type === 'input_file' ? 'file' : 'image';
  return PROVIDER_ATTACHMENT_STRATEGIES[transport]?.[kind] || 'url';
};

const resolveProviderMessageItem = async (item, env, signal, options = {}) => {
  if (!item || typeof item !== 'object') return item;
  const strategy = resolveAttachmentStrategy(options.model, item);
  const resolveMediaUrl = options.resolveMediaUrl || ((url) => resolveProviderMediaUrl(url, env, signal));

  if (item.type === 'text' || item.type === 'input_text') {
    return {
      ...item,
      text: await rewriteProviderTextMediaUrls(item.text || '', resolveMediaUrl),
    };
  }

  if (item.type === 'input_file') {
    const rawUrl = item.file_url || item.url || '';
    const fileUrl = await resolveMediaUrl(rawUrl);
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
    const resolvedUrl = await resolveMediaUrl(rawUrl);
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

  if (item.type === 'image') {
    const rawUrl = item.source?.url || item.url || '';
    const resolvedUrl = await resolveMediaUrl(rawUrl);
    return {
      ...item,
      source: {
        ...(item.source && typeof item.source === 'object' ? item.source : { type: 'url' }),
        type: 'url',
        url: resolvedUrl,
      },
      url: resolvedUrl,
    };
  }

  if (item.type === 'document') {
    const rawUrl = item.source?.url || item.file_url || item.url || '';
    const resolvedUrl = await resolveMediaUrl(rawUrl);
    return {
      ...item,
      source: {
        ...(item.source && typeof item.source === 'object' ? item.source : { type: 'url' }),
        type: 'url',
        url: resolvedUrl,
      },
      file_url: resolvedUrl,
      url: resolvedUrl,
    };
  }

  return item;
};

const resolveProviderMessages = async (messages = [], env, signal, options = {}) => Promise.all(
  (Array.isArray(messages) ? messages : []).map(async (message) => {
    const resolvedMediaUrlByRawUrl = new Map();
    const providerMediaResolver = isKieGeminiChatModel(options.model)
      ? resolveProviderGeminiChatMediaUrl
      : resolveProviderChatMediaUrl;
    const resolveMediaUrl = async (url) => {
      const rawUrl = String(url || '').trim();
      if (!rawUrl) return '';
      if (!resolvedMediaUrlByRawUrl.has(rawUrl)) {
        resolvedMediaUrlByRawUrl.set(rawUrl, providerMediaResolver(rawUrl, env, signal));
      }
      return resolvedMediaUrlByRawUrl.get(rawUrl);
    };
    return {
      ...message,
      content: await Promise.all(
        normalizeMessageContentItems(message?.content).map((item) => resolveProviderMessageItem(item, env, signal, {
          ...options,
          resolveMediaUrl,
        }))
      ),
    };
  })
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

const buildGeminiFlashContent = (items) =>
  items.map((item) => {
    if (item.type === 'text' || item.type === 'input_text') {
      return { type: 'text', text: item.text || '' };
    }
    if (item.type === 'image_url' || item.type === 'input_image') {
      return {
        type: 'image_url',
        image_url: {
          url: item.image_url?.url || item.image_url || item.url || '',
        },
      };
    }
    if (item.type === 'input_file' || item.type === 'document' || item.type === 'image') {
      return {
        type: 'image_url',
        image_url: {
          url: item.file_url || item.source?.url || item.image_url?.url || item.image_url || item.url || '',
        },
      };
    }
    return {
      type: 'image_url',
      image_url: {
        url: item.image_url?.url || item.image_url || item.url || item.file_url || item.source?.url || '',
      },
    };
  });

const normalizeGeminiFlashTool = (tool) => {
  if (!tool || typeof tool !== 'object') return null;
  if (tool.type === 'function' && tool.function && typeof tool.function === 'object') {
    const nextFunction = {
      ...tool.function,
      name: String(tool.function.name || '').trim(),
    };
    if (!nextFunction.name) return null;
    if (!nextFunction.parameters) {
      nextFunction.parameters = { type: 'object', properties: {} };
    }
    return {
      type: 'function',
      function: nextFunction,
    };
  }

  const name = String(tool.name || '').trim();
  if (!name) return null;
  return {
    type: 'function',
    function: {
      name,
      ...(tool.description ? { description: String(tool.description).trim() } : {}),
      parameters: tool.input_schema || tool.parameters || { type: 'object', properties: {} },
    },
  };
};

const buildGeminiFlashTools = (payload = {}) => {
  const tools = [];
  if (payload.webSearchEnabled) {
    tools.push({
      type: 'function',
      function: {
        name: 'googleSearch',
        description: 'Google Search grounding',
        parameters: { type: 'object', properties: {} },
      },
    });
  }
  if (Array.isArray(payload.tools)) {
    for (const tool of payload.tools) {
      const normalized = normalizeGeminiFlashTool(tool);
      if (normalized) tools.push(normalized);
    }
  }
  return tools.length > 0 ? tools : undefined;
};

const buildKieClaudeContent = (items) =>
  items.map((item) => {
    if (item.type === 'text' || item.type === 'input_text') {
      return { type: 'text', text: item.text || '' };
    }
    if (item.type === 'image') {
      return {
        type: 'image',
        source: {
          type: 'url',
          url: item.source?.url || item.url || '',
        },
      };
    }
    if (item.type === 'document') {
      return {
        type: 'document',
        source: {
          type: 'url',
          url: item.source?.url || item.file_url || item.url || '',
        },
        ...(item.title || item.filename || item.name ? { title: item.title || item.filename || item.name } : {}),
      };
    }
    if (item.type === 'input_file') {
      return {
        type: 'document',
        source: {
          type: 'url',
          url: item.file_url || item.url || '',
        },
        ...(item.filename || item.name ? { title: item.filename || item.name } : {}),
      };
    }
    return {
      type: 'image',
      source: {
        type: 'url',
        url: item.image_url?.url || item.image_url || item.url || '',
      },
    };
  });

const KIE_CLAUDE_NO_TOOL_PROMPT = {
  type: 'text',
  text: '禁止调用任何工具、skills、文件读取、mcp servers 或函数调用。只输出纯文本结果，不要返回 tool_use 或其他工具块。',
};

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

const extractProviderTaskIdFromResponse = (data) => {
  const nested = data && typeof data === 'object' && data.data && typeof data.data === 'object' ? data.data : {};
  const explicitId = String(
    nested.taskId ||
    nested.task_id ||
    nested.providerTaskId ||
    nested.provider_task_id ||
    nested.id ||
    data?.taskId ||
    data?.task_id ||
    data?.providerTaskId ||
    data?.provider_task_id ||
    ''
  ).trim();
  if (explicitId) return explicitId;
  const fallbackId = String(data?.id || '').trim();
  return /^chatcmpl-/i.test(fallbackId) ? '' : fallbackId;
};

const normalizeProviderCreditsConsumed = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
};

const extractProviderUsageMeta = (data = {}) => {
  const root = data && typeof data === 'object' ? data : {};
  const nested = root.data && typeof root.data === 'object' ? root.data : {};
  return {
    creditsConsumed: normalizeProviderCreditsConsumed(
      root.creditsConsumed ??
      root.credits_consumed ??
      root.creditsConsumedTotal ??
      nested.creditsConsumed ??
      nested.credits_consumed ??
      nested.creditsConsumedTotal
    ),
    usage: root.usage || nested.usage || null,
  };
};

const isProviderErrorText = (value) => {
  const text = String(value || '').trim();
  if (!text) return false;
  return [
    /\bI\s+cannot\s+fulfill\s+this\s+request\b/i,
    /\bI\s+can(?:not|'t)\s+(?:help|assist|comply|fulfill)\b/i,
    /\bI'm\s+sorry,\s+but\s+I\s+can(?:not|'t)\b/i,
    /\bI\s+am\s+sorry,\s+but\s+I\s+can(?:not|'t)\b/i,
    /无法满足(?:该|这个|此)?请求/,
    /不能满足(?:该|这个|此)?请求/,
    /无法协助(?:该|这个|此)?请求/,
    /file mime type is not supported/i,
    /image download failed/i,
    /http 404:\s*not found/i,
    /please convert or change the file/i,
    /server exception,\s*please try again later/i,
    /server is currently being maintained/i,
  ].some((pattern) => pattern.test(text));
};

const providerErrorCodeFromText = (value) =>
  /\bI\s+cannot\s+fulfill\s+this\s+request\b|\bI\s+can(?:not|'t)\s+(?:help|assist|comply|fulfill)\b|\bI'm\s+sorry,\s+but\s+I\s+can(?:not|'t)\b|\bI\s+am\s+sorry,\s+but\s+I\s+can(?:not|'t)\b|无法满足(?:该|这个|此)?请求|不能满足(?:该|这个|此)?请求|无法协助(?:该|这个|此)?请求/i.test(String(value || ''))
    ? 'provider_refusal'
    : /server is currently being maintained|server exception,\s*please try again later/i.test(String(value || ''))
    ? 'provider_internal_error'
    : 'provider_bad_request';

const hasToolUseContentBlock = (value) => {
  if (!value) return false;
  if (Array.isArray(value)) return value.some((item) => hasToolUseContentBlock(item));
  if (typeof value !== 'object') return false;
  if (String(value.type || '').trim() === 'tool_use') return true;
  if (Array.isArray(value.content) && hasToolUseContentBlock(value.content)) return true;
  return false;
};

const normalizeKieChatModel = (model) => {
  const normalizedModel = String(model || '').trim();
  return KIE_CLAUDE_MODEL_ALIASES[normalizedModel] || normalizedModel;
};

const resolveChatTransport = (model) => {
  const normalizedModel = normalizeKieChatModel(model);
  if (normalizedModel in KIE_RESPONSES_MODEL_ALIASES) return 'kie_responses';
  if (normalizedModel === 'claude-sonnet-4-6') return 'kie_claude_messages';
  if (/-thinking$/i.test(normalizedModel)) return 'unsupported';
  if (normalizedModel.startsWith('doubao-')) return 'unsupported';
  return 'kie_chat_completions';
};

const resolveKieResponsesModel = (model) =>
  KIE_RESPONSES_MODEL_ALIASES[String(model || '').trim()] || String(model || '').trim();

const resolveKieChatEndpoint = (model) =>
  KIE_CHAT_MODEL_ENDPOINTS[String(model || '').trim()] || KIE_CHAT_URL;

const isKieGeminiChatModel = (model) => /^gemini-/i.test(String(model || '').trim());
const isKieGeminiFlashOpenAiModel = (model) => String(model || '').trim() === 'gemini-3-flash-openai';

const isKieClaudeChatModel = (model) => normalizeKieChatModel(model) === 'claude-sonnet-4-6';

const getKieChatFallbackModels = (model, preferredFallbackModels = []) => {
  const configured = Array.isArray(preferredFallbackModels)
    ? preferredFallbackModels.map((item) => String(item || '').trim()).filter(Boolean)
    : [];
  return Array.from(new Set(configured.filter((item) => item !== String(model || '').trim())));
};

const KIE_CHAT_FALLBACK_ERROR_CODES = new Set([
  'provider_bad_response',
  'provider_refusal',
  'provider_internal_error',
  'provider_network_error',
  'provider_timeout',
]);

const shouldFallbackKieChatError = (error) => KIE_CHAT_FALLBACK_ERROR_CODES.has(String(error?.code || '').trim());

const runKieChatFallbackModels = async (payload, env, signal, originalError) => {
  const fallbackModels = getKieChatFallbackModels(payload.model, payload.fallbackModels);
  if (!fallbackModels.length || !shouldFallbackKieChatError(originalError)) {
    throw originalError;
  }
  let lastError = originalError;
  for (const fallbackModel of fallbackModels) {
    try {
      const fallbackResult = await runKieChatJob(
        { ...payload, model: fallbackModel, reasoningLevel: normalizeReasoningLevelForModel(fallbackModel, payload.reasoningLevel) },
        env,
        signal
      );
      if (fallbackResult?.result) {
        fallbackResult.result.fallbackFrom = String(payload.model || '').trim();
      }
      return fallbackResult;
    } catch (fallbackError) {
      lastError = fallbackError;
    }
  }
  throw lastError;
};

// 各模型对 reasoningLevel 的支持情况：
// - gpt-5-4 (Responses API): 支持 low / medium / high
// - gemini 系列 (Chat API): 只支持 low / high，medium 映射为 high
// - 其他 chat 模型: 不传 reasoningLevel
const normalizeReasoningLevelForModel = (model, reasoningLevel) => {
  if (!reasoningLevel) return null;
  const m = normalizeKieChatModel(model);
  const level = String(reasoningLevel).trim();
  if (isKieClaudeChatModel(m)) {
    return level ? 'low' : null;
  }
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
  const message = String(
    data?.data?.failMsg ||
    data?.failMsg ||
    data?.error?.message ||
    data?.message ||
    data?.msg ||
    defaultMessage ||
    ''
  ).trim() || defaultMessage;
  const providerTaskId = extractProviderTaskIdFromResponse(data);
  const extras = providerTaskId ? { providerTaskId } : null;
  if (response.status === 401 || response.status === 403) {
    throw createProviderError('provider_auth_invalid', message, extras);
  }
  if (response.status === 400 || response.status === 404) {
    throw createProviderError('provider_bad_request', message, extras);
  }
  if (response.status === 429) {
    throw createProviderError('provider_rate_limited', message, extras);
  }
  if (response.status >= 500) {
    throw createProviderError('provider_internal_error', message, extras);
  }
  throw createProviderError('provider_network_error', message, extras);
};

const notifyProviderTaskId = async (options, providerTaskId) => {
  const value = String(providerTaskId || '').trim();
  if (!value || typeof options?.onProviderTaskId !== 'function') return;
  await options.onProviderTaskId(value);
};

const pollKieTask = async (taskId, kieApiKey, signal, isVideo = false, model = '') => {
  const maxRetries = isVideo ? 180 : (KIE_IMAGE_MODEL_ALIASES[model]?.pollRetries || 90);
  const startedAt = Date.now();
  let lastKnownState = '';

  for (let i = 0; i < maxRetries; i += 1) {
    if (signal?.aborted) {
      throw createProviderError('request_cancelled', '任务已取消', { providerTaskId: taskId, providerStage: 'polling', providerStatus: lastKnownState || 'cancelled' });
    }

    let response;
    try {
      response = await fetchKieWithTimeout(`${KIE_RECORD_INFO_URL}?taskId=${encodeURIComponent(taskId)}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${kieApiKey}`,
        },
        signal,
      }, isVideo ? 'Kie 视频任务查询超时' : 'Kie 图像任务查询超时', KIE_HTTP_REQUEST_TIMEOUT_MS, 'polling');
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
        const usageMeta = extractProviderUsageMeta(result);
        return {
          providerTaskId: taskId,
          ...(usageMeta.creditsConsumed !== undefined ? { creditsConsumed: usageMeta.creditsConsumed } : {}),
          providerStage: 'completed',
          providerStatus: 'success',
          result: {
            imageUrl: url,
            videoUrl: isVideo ? url : undefined,
            taskId,
            status: 'success',
            providerTaskId: taskId,
            ...(usageMeta.creditsConsumed !== undefined ? { creditsConsumed: usageMeta.creditsConsumed } : {}),
            ...(usageMeta.usage ? { usage: usageMeta.usage } : {}),
            providerModel: result.data?.model || model || '',
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

    const response = await fetchKieWithTimeout(`${KIE_VEO_BASE_URL}/record-info?taskId=${encodeURIComponent(taskId)}`, {
      headers: {
        Authorization: `Bearer ${kieApiKey}`,
      },
      signal,
    }, 'Kie Veo 任务查询超时', KIE_HTTP_REQUEST_TIMEOUT_MS, 'polling');
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

  const response = await fetchKieWithTimeout('https://kieai.redpandaai.co/api/file-base64-upload', {
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
  }, 'Kie 素材上传超时', 120_000, 'asset_upload');

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

  const response = await fetchKieWithTimeout('https://kieai.redpandaai.co/api/file-stream-upload', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${kieApiKey}`,
    },
    body: formData,
  }, 'Kie 素材上传超时', 120_000, 'asset_upload');

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

  const response = await fetchKieWithTimeout(KIE_RESPONSES_URL, {
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
  }, 'Kie Responses 请求超时', KIE_HTTP_REQUEST_TIMEOUT_MS, 'chat_completion');

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
  const providerTaskId = extractProviderTaskIdFromResponse(data);
  const usageMeta = extractProviderUsageMeta(data);
  return {
    ...(providerTaskId ? { providerTaskId } : {}),
    ...(usageMeta.creditsConsumed !== undefined ? { creditsConsumed: usageMeta.creditsConsumed } : {}),
    result: {
      content,
      modelUsed: String(payload.model || '').trim(),
      providerTaskId,
      ...(usageMeta.creditsConsumed !== undefined ? { creditsConsumed: usageMeta.creditsConsumed } : {}),
      ...(usageMeta.usage ? { usage: usageMeta.usage } : {}),
    },
  };
};

const isApiportsGptImage2SecondaryModel = (model) =>
  String(model || '').trim() === APIPORTS_GPT_IMAGE_2_SECONDARY_MODEL;

const normalizeApiportsImageSize = (aspectRatio) => {
  const normalized = String(aspectRatio || 'auto').trim() || 'auto';
  if (!normalized || normalized === 'auto') return 'auto';
  return normalized;
};

const sanitizeApiportsGptImage2Prompt = (prompt) => String(prompt || '')
  .replace(/秒杀/g, '改善')
  .replace(/杀菌/g, '清洁')
  .replace(/抑菌/g, '清新')
  .replace(/除菌/g, '清洁')
  .replace(/抗菌/g, '清洁')
  .replace(/除臭/g, '去味')
  .replace(/官方背书/g, '通用推荐');

const normalizeApiportsImageError = (responseStatus, result = {}) => {
  const message = String(
    (typeof result?.error === 'string' ? result.error : result?.error?.message)
    || result?.message
    || result?.msg
    || 'APIports 图像任务请求失败'
  ).trim();
  if (responseStatus === 401 || responseStatus === 403) {
    return createProviderError('provider_auth_invalid', message);
  }
  if (responseStatus === 429) {
    return createProviderError('provider_rate_limited', message);
  }
  if (responseStatus >= 500) {
    return createProviderError('provider_internal_error', message);
  }
  return createProviderError('provider_bad_request', message);
};

const runApiportsGptImage2Job = async (payload, env, signal) => {
  const { apiportsApiKey, apiportsBaseUrl } = getProviderEnv(env);
  ensureProviderKey(apiportsApiKey, 'APIports API Key');
  const rawImageUrls = Array.isArray(payload.imageUrls) ? payload.imageUrls : [];
  allowConcurrentAbortListeners(signal, rawImageUrls.length);
  const textMediaUrls = Array.from(extractTextMediaUrls(payload.prompt || ''));
  assertSupportedGenerationImageReferences([
    ...rawImageUrls,
    ...textMediaUrls,
  ]);
  const resolvedGenerationUrlByRawUrl = new Map();
  const resolveGenerationUrl = async (url) => {
    const rawUrl = String(url || '').trim();
    if (!rawUrl) return '';
    if (!resolvedGenerationUrlByRawUrl.has(rawUrl)) {
      resolvedGenerationUrlByRawUrl.set(rawUrl, resolveProviderGenerationMediaUrl(rawUrl, env, signal));
    }
    return resolvedGenerationUrlByRawUrl.get(rawUrl);
  };
  const imageUrls = await Promise.all(rawImageUrls.map((item) => resolveGenerationUrl(item)));
  const limitedImageUrls = imageUrls.slice(0, KIE_IMAGE_MODEL_ALIASES['gpt-image-2'].maxInputImages);
  const promptWithResolvedMediaUrls = await rewriteProviderTextMediaUrls(payload.prompt || '', resolveGenerationUrl);
  const prompt = sanitizeApiportsGptImage2Prompt(promptWithResolvedMediaUrls);
  const normalizedAspectRatio = String(payload.aspectRatio || 'auto').trim() || 'auto';
  const requestUrl = `${String(apiportsBaseUrl || APIPORTS_IMAGE_GENERATIONS_URL).replace(/\/$/, '')}`;
  const response = await fetchKieWithTimeout(requestUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiportsApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-image-2',
      prompt,
      ...(limitedImageUrls.length > 0 ? { images: limitedImageUrls } : {}),
      aspectRatio: normalizeApiportsImageSize(normalizedAspectRatio),
      replyType: 'json',
    }),
    signal,
  }, 'APIports 图像任务请求超时', 240_000);

  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw normalizeApiportsImageError(response.status, result);
  }
  if (String(result?.status || '').toLowerCase() === 'failed') {
    throw normalizeApiportsImageError(400, result);
  }
  const imageUrl = Array.isArray(result?.results)
    ? String(result.results[0]?.url || '').trim()
    : Array.isArray(result?.data)
      ? String(result.data[0]?.url || '').trim()
      : '';
  if (!imageUrl) {
    throw createProviderError('provider_bad_response', 'APIports 返回成功但没有结果链接');
  }
  const providerTaskId = String(result?.id || result?.taskId || result?.task_id || '').trim()
    || (result?.created ? `apiports-${result.created}` : '');
  const usageMeta = extractProviderUsageMeta(result);
  return {
    ...(providerTaskId ? { providerTaskId } : {}),
    ...(usageMeta.creditsConsumed !== undefined ? { creditsConsumed: usageMeta.creditsConsumed } : {}),
    providerStage: 'completed',
    providerStatus: 'success',
    result: {
      imageUrl,
      taskId: providerTaskId,
      status: 'success',
      providerTaskId,
      providerModel: APIPORTS_GPT_IMAGE_2_SECONDARY_MODEL,
      ...(usageMeta.creditsConsumed !== undefined ? { creditsConsumed: usageMeta.creditsConsumed } : {}),
      ...(result?.usage ? { usage: result.usage } : {}),
    },
  };
};

const runKieImageJob = async (payload, env, signal, options = {}) => {
  if (isApiportsGptImage2SecondaryModel(payload.model)) {
    return runApiportsGptImage2Job(payload, env, signal, options);
  }
  const { kieApiKey } = getProviderEnv(env);
  ensureProviderKey(kieApiKey, 'Kie API Key');
  const rawImageUrls = Array.isArray(payload.imageUrls) ? payload.imageUrls : [];
  allowConcurrentAbortListeners(signal, rawImageUrls.length);
  assertSupportedGenerationImageReferences([
    ...rawImageUrls,
    ...Array.from(extractTextMediaUrls(payload.prompt || '')),
  ]);
  const resolvedGenerationUrlByRawUrl = new Map();
  const resolveGenerationUrl = async (url) => {
    const rawUrl = String(url || '').trim();
    if (!rawUrl) return '';
    if (!resolvedGenerationUrlByRawUrl.has(rawUrl)) {
      resolvedGenerationUrlByRawUrl.set(rawUrl, resolveProviderGenerationMediaUrl(rawUrl, env, signal));
    }
    return resolvedGenerationUrlByRawUrl.get(rawUrl);
  };
  const imageUrls = await Promise.all(rawImageUrls.map((item) => resolveGenerationUrl(item)));
  const gptImageAlias = KIE_IMAGE_MODEL_ALIASES[payload.model];
  const limitedImageUrls = gptImageAlias ? imageUrls.slice(0, gptImageAlias.maxInputImages) : imageUrls;
  const isGptImageEdit = Boolean(gptImageAlias && limitedImageUrls.length > 0);
  const promptWithResolvedMediaUrls = await rewriteProviderTextMediaUrls(payload.prompt || '', resolveGenerationUrl);
  const prompt = augmentImagePromptForModel(payload.model, promptWithResolvedMediaUrls, payload.aspectRatio, isGptImageEdit ? 'image' : 'text');
  const normalizedAspectRatio = String(payload.aspectRatio || 'auto').trim() || 'auto';
  const normalizedResolution = gptImageAlias
    ? normalizeGptImage2Resolution(normalizedAspectRatio, payload.resolution || GPT_IMAGE_2_DEFAULT_RESOLUTION)
    : String(payload.resolution || '1K').trim().toUpperCase();

  const requestBody = gptImageAlias
    ? {
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
      }
    : {
        model: payload.model || 'gpt-image-2',
        input: {
          prompt,
          image_input: limitedImageUrls,
          aspect_ratio: payload.aspectRatio || 'auto',
          resolution: payload.resolution || GPT_IMAGE_2_DEFAULT_RESOLUTION,
          output_format: 'png',
        },
      };

  const response = await fetchKieWithTimeout(KIE_CREATE_TASK_URL, {
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
    throw normalizeKieTaskCreationError(response.status, result, 'Kie 图像任务创建失败');
  }
  await notifyProviderTaskId(options, result.data.taskId);

  try {
    const imageResult = await pollKieTask(result.data.taskId, kieApiKey, signal, false, payload.model);
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

const runKieClaudeMessagesJob = async (payload, env, signal) => {
  const { kieApiKey } = getProviderEnv(env);
  ensureProviderKey(kieApiKey, 'Kie API Key');
  const model = normalizeKieChatModel(payload.model || 'claude-sonnet-4-6') || 'claude-sonnet-4-6';
  const preparedMessages = await resolveProviderMessages(payload.messages, env, signal, { model });
  const hasCallerTools = Array.isArray(payload.tools) && payload.tools.length > 0;
  const requestMessages = hasCallerTools
    ? preparedMessages
    : preparedMessages.map((message, index) => (
        index === 0
          ? {
              ...message,
              content: [KIE_CLAUDE_NO_TOOL_PROMPT, ...(Array.isArray(message?.content) ? message.content : [])],
            }
          : message
      ));
  const messages = buildProviderInputMessages(
    requestMessages.map((message) => ({
      ...message,
      role: String(message?.role || '').trim() === 'assistant' ? 'assistant' : 'user',
    })),
    buildKieClaudeContent
  );
  const baseRequestBody = {
    model,
    messages,
    stream: false,
    max_tokens: Number(payload.maxTokens || payload.max_tokens || 4096),
    ...(payload.reasoningLevel ? { thinkingFlag: true } : {}),
  };
  const primaryRequestBody = hasCallerTools
    ? { ...baseRequestBody, tools: payload.tools }
    : { ...baseRequestBody, tools: [], tool_choice: { type: 'none' }, mcp_servers: [] };
  const fallbackRequestBody = hasCallerTools
    ? null
    : { ...baseRequestBody, tools: [] };
  const toolUseRetryRequestBody = hasCallerTools
    ? null
    : {
        ...baseRequestBody,
        tools: [],
        tool_choice: { type: 'none' },
        mcp_servers: [],
        messages: [
          ...messages,
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: '禁止调用任何工具、skills、文件读取或函数调用。只输出纯文本策划结果，不要返回 tool_use 或其他工具块。',
              },
            ],
          },
        ],
      };

  const sendClaudeRequest = async (requestBody) => fetchKieWithTimeout(KIE_CLAUDE_MESSAGES_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${kieApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
    signal,
  }, 'Kie Claude 请求超时', KIE_HTTP_REQUEST_TIMEOUT_MS, 'chat_completion');

  let response = await sendClaudeRequest(primaryRequestBody);

  if (!response.ok && response.status === 400 && fallbackRequestBody) {
    response = await sendClaudeRequest(fallbackRequestBody);
  }

  if (response.ok) {
    const data = await response.json().catch(() => ({}));
    const toolUseDetected = String(data?.stop_reason || '').trim() === 'tool_use' || hasToolUseContentBlock(data?.content);
    if (toolUseDetected && toolUseRetryRequestBody) {
      const retryResponse = await sendClaudeRequest(toolUseRetryRequestBody);
      if (!retryResponse.ok) {
        response = retryResponse;
      } else {
        const retryData = await retryResponse.json().catch(() => ({}));
        const retryContent = extractChatMessageText(retryData?.content) || extractChatMessageText(retryData) || '';
        if (!retryContent) {
          throw createProviderError('provider_bad_response', 'Kie Claude 返回为空');
        }
        if (String(retryData?.stop_reason || '').trim() === 'tool_use' || hasToolUseContentBlock(retryData?.content)) {
          throw createProviderError('provider_bad_response', 'Kie Claude 返回了工具调用而不是文本策划结果');
        }
        return {
          result: {
            content: retryContent,
            modelUsed: String(retryData?.model || model).trim() || model,
          },
        };
      }
    } else {
      const content = extractChatMessageText(data?.content) || extractChatMessageText(data) || '';
      if (!content) {
        throw createProviderError('provider_bad_response', 'Kie Claude 返回为空');
      }
      if (toolUseDetected) {
        throw createProviderError('provider_bad_response', 'Kie Claude 返回了工具调用而不是文本策划结果');
      }
      return {
        result: {
          content,
          modelUsed: String(data?.model || model).trim() || model,
        },
      };
    }
  }

  if (!response.ok) {
    await mapHttpError(response, 'Kie Claude 请求失败');
  }

  const data = await response.json().catch(() => ({}));
  const content = extractChatMessageText(data?.content) || extractChatMessageText(data) || '';
  if (!content) {
    throw createProviderError('provider_bad_response', 'Kie Claude 返回为空');
  }
  if (String(data?.stop_reason || '').trim() === 'tool_use' || hasToolUseContentBlock(data?.content)) {
    throw createProviderError('provider_bad_response', 'Kie Claude 返回了工具调用而不是文本策划结果');
  }

  return {
    result: {
      content,
      modelUsed: String(data?.model || model).trim() || model,
    },
  };
};

const extractChatStreamDeltaText = (event) => {
  const root = event && typeof event === 'object' ? event : {};
  const choices = Array.isArray(root.choices)
    ? root.choices
    : Array.isArray(root.data?.choices)
      ? root.data.choices
      : [];
  const parts = [];
  choices.forEach((choice) => {
    const deltaText =
      extractChatMessageText(choice?.delta?.content) ||
      extractChatMessageText(choice?.message?.content) ||
      extractChatMessageText(choice?.content) ||
      '';
    if (deltaText) parts.push(deltaText);
  });
  if (parts.length > 0) return parts.join('');
  return extractChatMessageText(root?.delta?.content || root?.content || root?.data?.content || '');
};

const readProviderStreamChunkWithTimeout = async (reader, signal, providerTaskId = '') => {
  let timeoutId = null;
  let timedOut = false;
  let removeAbortListener = null;
  const providerTaskMeta = providerTaskId ? { providerTaskId } : null;

  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      timedOut = true;
      reject(createProviderError('provider_timeout', 'Kie Gemini 3 Flash 流式响应超时', {
        ...(providerTaskMeta || {}),
        providerStage: 'stream_read',
        providerStatus: 'timeout',
      }));
    }, KIE_CHAT_STREAM_IDLE_TIMEOUT_MS);
  });

  const abortPromise = new Promise((_, reject) => {
    if (!signal) return;
    const onAbort = () => reject(createProviderError('request_cancelled', '任务已取消', providerTaskMeta));
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener?.('abort', onAbort, { once: true });
    removeAbortListener = () => signal.removeEventListener?.('abort', onAbort);
  });

  try {
    return await Promise.race([reader.read(), timeoutPromise, abortPromise]);
  } catch (error) {
    if (timedOut || error?.code === 'request_cancelled') {
      await reader.cancel?.().catch(() => null);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
    removeAbortListener?.();
  }
};

const readProviderSseChatResponse = async (response, signal, options = {}) => {
  const reader = response.body?.getReader?.();
  if (!reader) {
    throw createProviderError('provider_bad_response', 'Kie Gemini 3 Flash 流式响应不可读');
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  let providerTaskId = '';
  let usageMeta = { creditsConsumed: undefined, usage: null };

  const handleEvent = async (eventData) => {
    const raw = String(eventData || '').trim();
    if (!raw || raw === '[DONE]') return;
    let event;
    try {
      event = JSON.parse(raw);
    } catch {
      return;
    }

    const nextProviderTaskId = extractProviderTaskIdFromResponse(event);
    if (nextProviderTaskId && nextProviderTaskId !== providerTaskId) {
      providerTaskId = nextProviderTaskId;
      await notifyProviderTaskId(options, providerTaskId);
    }

    const deltaText = extractChatStreamDeltaText(event);
    if (deltaText) content += deltaText;

    const nextUsageMeta = extractProviderUsageMeta(event);
    if (nextUsageMeta.creditsConsumed !== undefined || nextUsageMeta.usage) {
      usageMeta = nextUsageMeta;
    }
  };

  while (true) {
    if (signal?.aborted) {
      throw createProviderError('request_cancelled', '任务已取消', providerTaskId ? { providerTaskId } : null);
    }
    const { value, done } = await readProviderStreamChunkWithTimeout(reader, signal, providerTaskId);
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split(/\r?\n\r?\n/);
    buffer = chunks.pop() || '';
    for (const chunk of chunks) {
      const dataLines = chunk
        .split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.replace(/^data:\s*/, '').trim());
      for (const dataLine of dataLines) {
        await handleEvent(dataLine);
      }
    }
  }

  buffer += decoder.decode();
  const remainingLines = buffer
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.replace(/^data:\s*/, '').trim());
  for (const dataLine of remainingLines) {
    await handleEvent(dataLine);
  }

  return {
    content: content.trim(),
    providerTaskId,
    usageMeta,
  };
};

const runKieGeminiFlashOpenAiJob = async (payload, env, signal, options = {}) => {
  const { kieApiKey } = getProviderEnv(env);
  ensureProviderKey(kieApiKey, 'Kie API Key');
  const model = 'gemini-3-flash-openai';
  const preparedMessages = await resolveProviderMessages(payload.messages, env, signal, { model });
  const messages = buildProviderInputMessages(preparedMessages, buildGeminiFlashContent).map((message) => ({
    role: String(message?.role || 'user').trim() || 'user',
    content: Array.isArray(message?.content) ? message.content : [],
  }));
  const tools = buildGeminiFlashTools(payload);
  const reasoningEffort = normalizeReasoningLevelForModel(model, payload.reasoningLevel);
  const requestBody = {
    messages,
    stream: true,
    include_thoughts: payload.includeThoughts === false ? false : true,
    ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
    ...(tools ? { tools } : {}),
  };

  const response = await fetchKieWithTimeout(KIE_GEMINI_FLASH_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${kieApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
    signal,
  }, 'Kie Gemini 3 Flash 请求超时');

  if (!response.ok) {
    await mapHttpError(response, 'Kie Gemini 3 Flash 请求失败');
  }

  const contentType = String(response.headers?.get?.('content-type') || '').toLowerCase();
  if (contentType.includes('text/event-stream') && response.body) {
    const streamResult = await readProviderSseChatResponse(response, signal, options);
    if (!streamResult.content) {
      throw createProviderError('provider_bad_response', 'Kie Gemini 3 Flash 返回为空');
    }
    if (isProviderErrorText(streamResult.content)) {
      throw createProviderError(providerErrorCodeFromText(streamResult.content), streamResult.content);
    }
    return {
      ...(streamResult.providerTaskId ? { providerTaskId: streamResult.providerTaskId } : {}),
      ...(streamResult.usageMeta.creditsConsumed !== undefined ? { creditsConsumed: streamResult.usageMeta.creditsConsumed } : {}),
      result: {
        content: streamResult.content,
        modelUsed: model,
        providerTaskId: streamResult.providerTaskId,
        ...(streamResult.usageMeta.creditsConsumed !== undefined ? { creditsConsumed: streamResult.usageMeta.creditsConsumed } : {}),
        ...(streamResult.usageMeta.usage ? { usage: streamResult.usageMeta.usage } : {}),
      },
    };
  }

  const data = await response.json().catch(() => ({}));
  const content =
    extractChatMessageText(data?.choices?.[0]?.message?.content) ||
    extractChatMessageText(data?.data?.choices?.[0]?.message?.content) ||
    extractChatMessageText(data?.content) ||
    extractChatMessageText(data) ||
    '';

  if (!content) {
    throw createProviderError('provider_bad_response', 'Kie Gemini 3 Flash 返回为空');
  }
  if (isProviderErrorText(content)) {
    throw createProviderError(providerErrorCodeFromText(content), content);
  }

  const providerTaskId = extractProviderTaskIdFromResponse(data);
  await notifyProviderTaskId(options, providerTaskId);
  const usageMeta = extractProviderUsageMeta(data);
  return {
    ...(providerTaskId ? { providerTaskId } : {}),
    ...(usageMeta.creditsConsumed !== undefined ? { creditsConsumed: usageMeta.creditsConsumed } : {}),
    result: {
      content,
      modelUsed: model,
      providerTaskId,
      ...(usageMeta.creditsConsumed !== undefined ? { creditsConsumed: usageMeta.creditsConsumed } : {}),
      ...(usageMeta.usage ? { usage: usageMeta.usage } : {}),
    },
  };
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

const runKieVideoJob = async (payload, env, signal, options = {}) => {
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

  const response = await fetchKieWithTimeout(KIE_CREATE_TASK_URL, {
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
  }, 'Kie 视频任务创建超时');

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
  await notifyProviderTaskId(options, result.data.taskId);

  try {
    return await pollKieTask(result.data.taskId, kieApiKey, signal, true);
  } catch (error) {
    throw attachProviderTaskId(error, result.data.taskId);
  }
};

const runKieVeoJob = async (payload, env, signal, options = {}) => {
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
    allowConcurrentAbortListeners(signal, payload.imageUrls.length);
    const imageUrls = await Promise.all(payload.imageUrls.map((item) => resolveProviderMediaUrl(item, env, signal)));
    requestPayload.generationType = 'REFERENCE_2_VIDEO';
    requestPayload.imageUrls = imageUrls;
  } else {
    requestPayload.generationType = 'TEXT_2_VIDEO';
  }

  const response = await fetchKieWithTimeout(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${kieApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestPayload),
    signal,
  }, 'Kie Veo 任务创建超时', KIE_HTTP_REQUEST_TIMEOUT_MS, 'create_task');

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
  await notifyProviderTaskId(options, result.data.taskId);

  try {
    return await pollKieVeoTask(result.data.taskId, kieApiKey, signal);
  } catch (error) {
    throw attachProviderTaskId(error, result.data.taskId);
  }
};

const normalizeArray = (value) => (Array.isArray(value) ? value : [value])
  .map((item) => String(item || '').trim())
  .filter(Boolean);

const normalizeSeedanceVideoMode = (value) => {
  const normalized = String(value || '').trim();
  if (normalized === '首尾帧' || normalized === 'frames' || normalized === 'firstLastFrame') return 'frames2video';
  if (normalized === 'image2video' || normalized === '全能参考' || normalized === 'multimodal' || normalized === 'ref2video') return 'multimodal2video';
  if (['frames2video', 'multimodal2video'].includes(normalized)) return normalized;
  return 'multimodal2video';
};

const normalizeSeedanceAspectRatio = (value) => {
  const normalized = String(value || '').trim();
  return ['1:1', '4:3', '3:4', '16:9', '9:16', '21:9', 'adaptive'].includes(normalized) ? normalized : '9:16';
};

const normalizeSeedanceResolution = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === '720p' ? '720p' : '480p';
};

const normalizeSeedanceDuration = (value) => {
  const parsed = Number.parseInt(String(value || '').replace('秒', '').trim(), 10);
  if (!Number.isFinite(parsed)) return 5;
  return Math.max(4, Math.min(15, parsed));
};

const normalizeSeedanceGenerateAudio = (value, fallback = true) => {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  const normalized = String(value).trim().toLowerCase();
  if (['false', '0', 'off', 'no', '关闭', '否'].includes(normalized)) return false;
  if (['true', '1', 'on', 'yes', '开启', '是'].includes(normalized)) return true;
  return fallback;
};

const runKieSeedanceVideoJob = async (payload, env, signal, options = {}) => {
  const { kieApiKey } = getProviderEnv(env);
  ensureProviderKey(kieApiKey, 'Kie API Key');

  const mode = normalizeSeedanceVideoMode(payload.mode || payload.subMode);
  const rawImageUrls = normalizeArray(payload.imageUrls || payload.images || payload.imageUrl || payload.image);
  const rawVideoUrls = normalizeArray(payload.videoUrls || payload.videos || payload.videoUrl || payload.video);
  const rawAudioUrls = normalizeArray(payload.audioUrls || payload.audios || payload.audioUrl || payload.audio);
  allowConcurrentAbortListeners(signal, rawImageUrls.length + rawVideoUrls.length + rawAudioUrls.length);
  const imageUrls = await Promise.all(
    rawImageUrls.map((item) => resolveProviderGenerationMediaUrl(item, env, signal))
  );
  const videoUrls = await Promise.all(
    rawVideoUrls.map((item) => resolveProviderGenerationMediaUrl(item, env, signal))
  );
  const audioUrls = await Promise.all(
    rawAudioUrls.map((item) => resolveProviderGenerationMediaUrl(item, env, signal))
  );

  if (mode === 'frames2video' && imageUrls.length < 2) {
    throw createProviderError('provider_bad_request', 'Seedance 首尾帧需要至少 2 张图片素材');
  }
  if (mode === 'multimodal2video' && imageUrls.length + videoUrls.length + audioUrls.length < 1) {
    throw createProviderError('provider_bad_request', 'Seedance API 至少需要 1 个参考图片、视频或音频素材');
  }

  const input = {
    prompt: String(payload.prompt || payload.script || payload.description || '').trim(),
    duration: normalizeSeedanceDuration(payload.duration),
    aspect_ratio: normalizeSeedanceAspectRatio(payload.aspectRatio || payload.ratio),
    resolution: normalizeSeedanceResolution(payload.resolution || payload.videoResolution || payload.video_resolution),
    generate_audio: normalizeSeedanceGenerateAudio(payload.generateAudio ?? payload.generate_audio, true),
    nsfw_checker: false,
  };

  if (mode === 'frames2video') {
    input.first_frame_url = imageUrls[0];
    input.last_frame_url = imageUrls[1];
  } else {
    if (imageUrls.length > 0) input.reference_image_urls = imageUrls.slice(0, 9);
    if (videoUrls.length > 0) input.reference_video_urls = videoUrls.slice(0, 3);
    if (audioUrls.length > 0) input.reference_audio_urls = audioUrls.slice(0, 3);
  }

  const response = await fetchKieWithTimeout(KIE_CREATE_TASK_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${kieApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'bytedance/seedance-2-fast',
      input,
    }),
    signal,
  }, 'Kie Seedance 视频任务创建超时');

  const result = await response.json().catch(() => ({}));
  if (!response.ok || result?.code !== 200 || !result?.data?.taskId) {
    throw normalizeKieTaskCreationError(response.status, result, 'Kie Seedance 视频任务创建失败');
  }
  await notifyProviderTaskId(options, result.data.taskId);

  try {
    const videoResult = await pollKieTask(result.data.taskId, kieApiKey, signal, true, 'bytedance/seedance-2-fast');
    return {
      ...videoResult,
      providerTaskId: videoResult.providerTaskId || result.data.taskId,
      providerStage: videoResult.providerStage || 'completed',
      providerStatus: videoResult.providerStatus || 'success',
    };
  } catch (error) {
    throw attachProviderTaskId(error, result.data.taskId);
  }
};

const isVideoAssetUrl = (value) => /\.(mp4|mov|webm|m4v)(?:[?#].*)?$/i.test(String(value || ''));
const isAudioAssetUrl = (value) => /\.(mp3|wav|m4a|aac|ogg)(?:[?#].*)?$/i.test(String(value || ''));

const ensureFileNameWithExtension = (fileName, mimeType) => {
  const normalized = String(fileName || 'dreamina-input.bin').trim() || 'dreamina-input.bin';
  if (/\.[a-z0-9]{2,8}$/i.test(normalized)) return normalized;
  return `${normalized}.${inferExtensionFromMimeType(mimeType, 'bin')}`;
};

const downloadProviderAssetToLocalFile = async (assetUrl, tempDir, env, signal, index = 0) => {
  const resolvedUrl = await resolveProviderMediaUrl(assetUrl, env, signal);
  if (!isManagedAssetUrl(resolvedUrl)) {
    assertRemoteProviderMediaUrlAllowed(resolvedUrl);
  }
  const response = await fetchKieWithTimeout(
    normalizeManagedAssetDownloadUrl(resolvedUrl),
    { method: 'GET', signal },
    '即梦素材下载超时',
    120_000,
    'asset_download'
  );
  if (!response.ok) {
    throw createProviderError('provider_bad_request', `即梦素材下载失败：HTTP ${response.status}`);
  }
  const mimeType = String(response.headers?.get?.('content-type') || '').split(';')[0].trim() || inferMimeTypeFromName(resolvedUrl);
  const fileName = ensureFileNameWithExtension(extractFileNameFromUrl(resolvedUrl, `dreamina-input-${index}.bin`), mimeType);
  const filePath = path.join(tempDir, `${index}-${fileName.replace(/[^\w.-]+/g, '_')}`);
  const fileBuffer = await readRemoteMediaBufferWithLimit(response, '即梦素材');
  await writeFile(filePath, fileBuffer);
  return filePath;
};

const prepareDreaminaLocalInputs = async (payload, env, signal) => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'meiao-dreamina-'));
  const cleanup = async () => rm(tempDir, { recursive: true, force: true }).catch(() => null);
  const rawImageUrls = normalizeArray(payload.imageUrls || payload.images || payload.imageUrl || payload.image);
  const rawVideoUrls = normalizeArray(payload.videoUrls || payload.videos || payload.videoUrl || payload.video);
  const rawAudioUrls = normalizeArray(payload.audioUrls || payload.audios || payload.audioUrl || payload.audio);
  const mixedUrls = normalizeArray(payload.mediaUrls || payload.references);
  mixedUrls.forEach((url) => {
    if (isAudioAssetUrl(url)) rawAudioUrls.push(url);
    else if (isVideoAssetUrl(url)) rawVideoUrls.push(url);
    else rawImageUrls.push(url);
  });

  try {
    allowConcurrentAbortListeners(signal, rawImageUrls.length + rawVideoUrls.length + rawAudioUrls.length);
    const imagePaths = await Promise.all(rawImageUrls.map((url, index) => downloadProviderAssetToLocalFile(url, tempDir, env, signal, index)));
    const videoPaths = await Promise.all(rawVideoUrls.map((url, index) => downloadProviderAssetToLocalFile(url, tempDir, env, signal, index + imagePaths.length)));
    const audioPaths = await Promise.all(rawAudioUrls.map((url, index) => downloadProviderAssetToLocalFile(url, tempDir, env, signal, index + imagePaths.length + videoPaths.length)));
    return { tempDir, cleanup, imagePaths, videoPaths, audioPaths };
  } catch (error) {
    await cleanup();
    throw error;
  }
};

const normalizeDreaminaVideoMode = (value) => {
  const normalized = String(value || '').trim();
  if (normalized === 'image2video' || normalized === '全能参考' || normalized === 'multimodal' || normalized === 'ref2video') return 'multimodal2video';
  if (normalized === '首尾帧' || normalized === 'frames' || normalized === 'firstLastFrame') return 'frames2video';
  if (normalized === '智能多帧' || normalized === '多帧成片' || normalized === 'multiframe') return 'multiframe2video';
  if (['frames2video', 'multiframe2video', 'multimodal2video'].includes(normalized)) return normalized;
  return 'multimodal2video';
};

const buildDreaminaVideoOptions = (payload, localInputs) => {
  const mode = normalizeDreaminaVideoMode(payload.mode || payload.subMode);
  const base = {
    prompt: String(payload.prompt || payload.script || payload.description || '').trim(),
    duration: payload.duration,
    ratio: payload.ratio || payload.aspectRatio,
    videoResolution: payload.videoResolution || payload.video_resolution,
    modelVersion: payload.modelVersion || payload.model_version || 'seedance2.0fast',
    transitionPrompts: payload.transitionPrompts || payload.transition_prompts,
    transitionDurations: payload.transitionDurations || payload.transition_durations,
    poll: 0,
    session: payload.session,
  };
  if (mode === 'frames2video') {
    return {
      mode,
      options: {
        ...base,
        first: localInputs.imagePaths[0],
        last: localInputs.imagePaths[1],
        images: localInputs.imagePaths.slice(0, 2),
      },
    };
  }
  if (mode === 'multiframe2video') {
    return { mode, options: { ...base, images: localInputs.imagePaths } };
  }
  return {
    mode,
    options: {
      ...base,
      images: localInputs.imagePaths,
      videos: localInputs.videoPaths,
      audios: localInputs.audioPaths,
    },
  };
};

const assertDreaminaInputs = (mode, localInputs) => {
  if (mode === 'frames2video' && localInputs.imagePaths.length < 2) {
    throw createProviderError('provider_bad_request', '即梦首尾帧需要至少 2 张图片素材');
  }
  if (mode === 'multiframe2video' && localInputs.imagePaths.length < 2) {
    throw createProviderError('provider_bad_request', '即梦智能多帧需要至少 2 张图片素材');
  }
  if (mode === 'multimodal2video' && localInputs.imagePaths.length + localInputs.videoPaths.length < 1) {
    throw createProviderError('provider_bad_request', '即梦全能参考至少需要 1 个图片或视频素材');
  }
};

const pollDreaminaVideoResult = async (submitId, env, signal) => {
  for (let attempt = 0; attempt < DREAMINA_VIDEO_POLL_RETRIES; attempt += 1) {
    if (signal?.aborted) {
      throw createProviderError('request_cancelled', '任务已取消', { providerTaskId: submitId, providerStage: 'polling', providerStatus: 'cancelled' });
    }
    const result = await queryDreaminaVideoTask({ submitId, env });
    if (result.status === 'success' && result.videoUrl) return result;
    if (result.status === 'failed') {
      throw createProviderError('provider_bad_request', result.failReason || '即梦视频任务失败', {
        providerTaskId: submitId,
        providerStage: 'polling',
        providerStatus: 'failed',
      });
    }
    await wait(DREAMINA_VIDEO_POLL_INTERVAL_MS, signal);
  }
  throw createProviderError('provider_timeout', '即梦视频任务超时', {
    providerTaskId: submitId,
    providerStage: 'polling',
    providerStatus: 'timeout',
  });
};

const runDreaminaVideoJob = async (payload, env, signal, providerTaskId = '') => {
  if (dreaminaVideoRunnerForTest) {
    return dreaminaVideoRunnerForTest({
      ...payload,
      mode: normalizeDreaminaVideoMode(payload.mode || payload.subMode),
      imageUrls: normalizeArray(payload.imageUrls || payload.images || payload.imageUrl || payload.image),
      videoUrls: normalizeArray(payload.videoUrls || payload.videos || payload.videoUrl || payload.video),
      audioUrls: normalizeArray(payload.audioUrls || payload.audios || payload.audioUrl || payload.audio),
      providerTaskId,
    });
  }

  if (providerTaskId) {
    const queried = await pollDreaminaVideoResult(providerTaskId, env, signal);
    return {
      providerTaskId,
      providerStage: 'completed',
      providerStatus: 'success',
      result: {
        videoUrl: queried.videoUrl,
        mediaType: 'video',
        taskId: providerTaskId,
        status: 'success',
      },
    };
  }

  const localInputs = await prepareDreaminaLocalInputs(payload, env, signal);
  try {
    const { mode, options } = buildDreaminaVideoOptions(payload, localInputs);
    assertDreaminaInputs(mode, localInputs);
    const submitted = await submitDreaminaVideoTask(mode, { ...options, env });
    const submitId = submitted.submitId;
    if (!submitId && !submitted.videoUrl) {
      throw createProviderError('provider_bad_response', submitted.rawOutput || '即梦未返回 submit_id');
    }
    if (submitted.status === 'failed') {
      throw createProviderError('provider_bad_request', submitted.failReason || '即梦视频任务提交失败', {
        providerTaskId: submitId,
        providerStage: 'create_task',
        providerStatus: 'failed',
      });
    }
    const completed = submitted.videoUrl ? submitted : await pollDreaminaVideoResult(submitId, env, signal);
    return {
      providerTaskId: submitId,
      providerStage: 'completed',
      providerStatus: 'success',
      result: {
        videoUrl: completed.videoUrl,
        mediaType: 'video',
        taskId: submitId,
        status: 'success',
        rawOutput: completed.rawOutput,
      },
    };
  } catch (error) {
    const code = String(error?.code || '').trim();
    if (code) throw error;
    throw createProviderError('provider_internal_error', error?.message || '即梦视频任务执行失败');
  } finally {
    await localInputs.cleanup();
  }
};

const runKieChatJob = async (payload, env, signal, options = {}) => {
  const requestedModel = String(payload.model || '').trim();
  if (!requestedModel) {
    throw createProviderError('provider_bad_request', '缺少聊天模型，请检查功能是否已接入统一模型设置。');
  }
  const transport = resolveChatTransport(payload.model);
  if (isKieGeminiFlashOpenAiModel(payload.model)) {
    try {
      return await runKieGeminiFlashOpenAiJob(payload, env, signal, options);
    } catch (error) {
      return runKieChatFallbackModels(payload, env, signal, error);
    }
  }
  if (transport === 'unsupported') {
    throw createProviderError('provider_bad_request', `不支持的聊天模型：${String(payload.model || '').trim() || '未知模型'}`);
  }
  if (transport === 'kie_responses') {
    try {
      return await runKieResponsesJob(payload, env, signal);
    } catch (error) {
      return runKieChatFallbackModels(payload, env, signal, error);
    }
  }
  if (transport === 'kie_claude_messages') {
    return runKieClaudeMessagesJob(payload, env, signal);
  }

  try {
    const { kieApiKey } = getProviderEnv(env);
    ensureProviderKey(kieApiKey, 'Kie API Key');
    const model = String(payload.model || 'gpt-5-2').trim() || 'gpt-5-2';
    const endpoint = resolveKieChatEndpoint(model);
    const isGeminiModel = isKieGeminiChatModel(model);
    const preparedMessages = await resolveProviderMessages(payload.messages, env, signal, { model });
    const messages = isGeminiModel
      ? buildProviderInputMessages(preparedMessages, buildKieChatContent)
      : preparedMessages;

    const response = await fetchKieWithTimeout(endpoint, {
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
    }, 'Kie 对话请求超时', KIE_HTTP_REQUEST_TIMEOUT_MS, 'chat_completion');

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
    if (isProviderErrorText(content)) {
      throw createProviderError(providerErrorCodeFromText(content), content);
    }

    const providerTaskId = extractProviderTaskIdFromResponse(data);
    await notifyProviderTaskId(options, providerTaskId);
    const usageMeta = extractProviderUsageMeta(data);
    return {
      ...(providerTaskId ? { providerTaskId } : {}),
      ...(usageMeta.creditsConsumed !== undefined ? { creditsConsumed: usageMeta.creditsConsumed } : {}),
      result: {
        content,
        modelUsed: model,
        providerTaskId,
        ...(usageMeta.creditsConsumed !== undefined ? { creditsConsumed: usageMeta.creditsConsumed } : {}),
        ...(usageMeta.usage ? { usage: usageMeta.usage } : {}),
      },
    };
  } catch (error) {
    return runKieChatFallbackModels(payload, env, signal, error);
  }
};

export const executeProviderJob = async (job, env, signal, options = {}) => {
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
      return runKieImageJob(job.payload, env, signal, options);
    case 'kie_recover':
      return runKieRecoverJob(job.payload, env, signal);
    case 'kie_video':
      return runKieVideoJob(job.payload, env, signal, options);
    case 'kie_seedance_video':
      if (job.providerTaskId) {
        return runKieRecoverJob(
          {
            ...job.payload,
            providerTaskId: job.providerTaskId,
            taskId: job.providerTaskId,
            isVideo: true,
          },
          env,
          signal
        );
      }
      return runKieSeedanceVideoJob(job.payload, env, signal, options);
    case 'kie_veo':
      return runKieVeoJob(job.payload, env, signal, options);
    case 'dreamina_video':
      return runDreaminaVideoJob(job.payload, env, signal, job.providerTaskId);
    case 'kie_chat':
      return runKieChatJob(job.payload, env, signal, options);
    default:
      throw createProviderError('provider_bad_request', `不支持的任务类型：${job.taskType}`);
  }
};

export const getProviderConfigStatus = (env) => {
  const providerEnv = getProviderEnv(env);
  return {
    kie: Boolean(providerEnv.kieApiKey),
    apiports: Boolean(providerEnv.apiportsApiKey),
    dreamina: true,
  };
};
