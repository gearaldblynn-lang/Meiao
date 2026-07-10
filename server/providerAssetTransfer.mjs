import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { isExternallyReachableBaseUrl, isLocalOrPrivateHostname, normalizeBaseUrl } from '../src/utils/publicNetworkUrl.mjs';
import {
  isVideoMediaUrl,
  shouldUploadGeminiMediaUrlForStableMime,
  shouldUploadGeminiVideoUrlToOpenRouterChat,
} from './providerMediaRouting.mjs';

export const MAX_PROVIDER_REMOTE_MEDIA_MB = 256;
export const MAX_PROVIDER_REMOTE_MEDIA_BYTES = MAX_PROVIDER_REMOTE_MEDIA_MB * 1024 * 1024;
export const MANAGED_ASSET_PATH_SEGMENT = '/api/assets/file/';
const MANAGED_ASSET_UPLOAD_CACHE_TTL_MS = 30 * 60 * 1000;
const MANAGED_ASSET_UPLOAD_CACHE_MAX_ENTRIES = 2000;
const managedAssetUploadCache = new Map();

const createProviderError = (code, message, extras = null) => {
  const error = new Error(message);
  error.code = code;
  error.providerMessage = message;
  if (extras && typeof extras === 'object') {
    Object.assign(error, extras);
  }
  return error;
};

const normalizeOptions = (envOrOptions = {}, signal = null, options = {}) => {
  if (
    envOrOptions
    && typeof envOrOptions === 'object'
    && (
      Object.hasOwn(envOrOptions, 'env')
      || Object.hasOwn(envOrOptions, 'deps')
      || Object.hasOwn(envOrOptions, 'signal')
      || Object.hasOwn(envOrOptions, 'forceUpload')
    )
  ) {
    return {
      env: envOrOptions.env || {},
      signal: envOrOptions.signal || signal || null,
      forceUpload: Boolean(envOrOptions.forceUpload),
      deps: envOrOptions.deps || {},
      ...options,
    };
  }
  return {
    env: envOrOptions || {},
    signal,
    forceUpload: Boolean(options.forceUpload),
    deps: options.deps || {},
    ...options,
  };
};

export const isManagedAssetUrl = (value) =>
  typeof value === 'string' && value.includes(MANAGED_ASSET_PATH_SEGMENT);

export const getManagedAssetPath = (value) => {
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

const getPositiveIntegerEnv = (env, keys, fallback) => {
  const raw = keys
    .map((key) => env?.[key] || process.env[key])
    .find((value) => String(value || '').trim());
  const parsed = Number.parseInt(String(raw || ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const getManagedAssetUploadCacheTtlMs = (env = {}) => getPositiveIntegerEnv(
  env,
  ['MEIAO_KIE_ASSET_UPLOAD_CACHE_TTL_MS', 'KIE_ASSET_UPLOAD_CACHE_TTL_MS'],
  MANAGED_ASSET_UPLOAD_CACHE_TTL_MS
);

const getManagedAssetUploadCacheMaxEntries = (env = {}) => getPositiveIntegerEnv(
  env,
  ['MEIAO_KIE_ASSET_UPLOAD_CACHE_MAX_ENTRIES', 'KIE_ASSET_UPLOAD_CACHE_MAX_ENTRIES'],
  MANAGED_ASSET_UPLOAD_CACHE_MAX_ENTRIES
);

const pruneManagedAssetUploadCache = (now) => {
  for (const [key, entry] of managedAssetUploadCache.entries()) {
    if (entry.expiresAt > 0 && entry.expiresAt <= now) {
      managedAssetUploadCache.delete(key);
    }
  }
};

const evictManagedAssetUploadCacheForInsert = (maxEntries) => {
  while (managedAssetUploadCache.size >= maxEntries) {
    let oldestSettledKey;
    for (const [key, entry] of managedAssetUploadCache.entries()) {
      if (entry.expiresAt <= 0) continue;
      oldestSettledKey = key;
      break;
    }
    if (oldestSettledKey === undefined) break;
    managedAssetUploadCache.delete(oldestSettledKey);
  }
};

const resolveCachedManagedAssetUpload = async (cacheKey, env, upload) => {
  const now = Date.now();
  pruneManagedAssetUploadCache(now);
  const existing = managedAssetUploadCache.get(cacheKey);
  if (existing && (existing.expiresAt === 0 || existing.expiresAt > now)) {
    return existing.promise;
  }

  evictManagedAssetUploadCacheForInsert(getManagedAssetUploadCacheMaxEntries(env));
  const entry = { expiresAt: 0, promise: null };
  entry.promise = Promise.resolve()
    .then(upload)
    .then((fileUrl) => {
      const normalized = String(fileUrl || '').trim();
      if (!normalized) {
        throw createProviderError('provider_bad_response', '上传成功但未返回素材地址');
      }
      entry.expiresAt = Date.now() + getManagedAssetUploadCacheTtlMs(env);
      return normalized;
    });
  managedAssetUploadCache.set(cacheKey, entry);

  try {
    return await entry.promise;
  } catch (error) {
    if (managedAssetUploadCache.get(cacheKey) === entry) {
      managedAssetUploadCache.delete(cacheKey);
    }
    throw error;
  }
};

export const __testOnly_clearManagedAssetUploadCache = () => {
  managedAssetUploadCache.clear();
};

const isExternallyReachableHttpsBaseUrl = (value) => {
  const normalized = normalizeBaseUrl(value);
  if (!normalized || !isExternallyReachableBaseUrl(normalized)) return false;
  try {
    return new URL(normalized).protocol === 'https:';
  } catch {
    return false;
  }
};

export const resolveKieManagedAssetMode = (env = {}) => {
  const configured = String(
    env.MEIAO_KIE_MANAGED_ASSET_MODE
    || env.KIE_MANAGED_ASSET_MODE
    || process.env.MEIAO_KIE_MANAGED_ASSET_MODE
    || process.env.KIE_MANAGED_ASSET_MODE
    || 'auto'
  ).trim().toLowerCase();
  if (configured !== 'auto' && configured !== 'direct-first') return 'kie-only';
  return isExternallyReachableHttpsBaseUrl(getProviderPublicBaseUrl(env)) ? 'direct-first' : 'kie-only';
};

export const shouldUseDirectManagedAssetUrls = (env = {}) =>
  resolveKieManagedAssetMode(env) === 'direct-first';

export const resolveExternallyReachableManagedAssetUrl = (value, env = {}) => {
  const normalized = String(value || '').trim();
  if (!isManagedAssetUrl(normalized)) return '';
  const assetPath = getManagedAssetPath(normalized);
  const publicBaseUrl = getProviderPublicBaseUrl(env);
  if (assetPath && isExternallyReachableHttpsBaseUrl(publicBaseUrl)) {
    return `${publicBaseUrl}${assetPath}`;
  }
  try {
    const parsed = new URL(normalized);
    if (['http:', 'https:'].includes(parsed.protocol) && !isLocalOrPrivateHostname(parsed.hostname)) {
      return normalized;
    }
  } catch {
    // Relative managed asset paths can still be made public through MEIAO_PUBLIC_BASE_URL.
  }
  if (assetPath && isExternallyReachableBaseUrl(publicBaseUrl)) {
    return `${publicBaseUrl}${assetPath}`;
  }
  return '';
};

export const normalizeProviderMediaReference = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const markdownTarget = raw.match(/^\[[^\]]*]\(([^)\s]+)\)$/);
  if (markdownTarget?.[1]) return markdownTarget[1].trim();
  const absoluteUrl = raw.match(/https?:\/\/[^\s"'<>，。；、）)\]】]+/i);
  return absoluteUrl?.[0]?.trim() || raw;
};

export const normalizeManagedAssetDownloadUrl = (value) => {
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

export const extractFileNameFromUrl = (value, fallback = 'upload.bin') => {
  const raw = String(value || '').trim();
  try {
    const url = new URL(raw);
    const pathname = decodeURIComponent(url.pathname || '');
    const segments = pathname.split('/').filter(Boolean);
    const candidate = segments[segments.length - 1] || '';
    return candidate || fallback;
  } catch {
    const pathname = decodeURIComponent(raw.split('?')[0].split('#')[0] || '');
    const segments = pathname.split('/').filter(Boolean);
    return segments[segments.length - 1] || fallback;
  }
};

export const inferMimeTypeFromName = (value, fallback = 'application/octet-stream') => {
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

export const inferExtensionFromMimeType = (value, fallback = 'bin') => {
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

export const detectMimeTypeFromBuffer = (buffer) => {
  const bytes = buffer instanceof Uint8Array ? buffer : Buffer.from(buffer || '');
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (
    bytes.length >= 8
    && bytes[0] === 0x89
    && bytes[1] === 0x50
    && bytes[2] === 0x4e
    && bytes[3] === 0x47
    && bytes[4] === 0x0d
    && bytes[5] === 0x0a
    && bytes[6] === 0x1a
    && bytes[7] === 0x0a
  ) return 'image/png';
  if (
    bytes.length >= 12
    && bytes[0] === 0x52
    && bytes[1] === 0x49
    && bytes[2] === 0x46
    && bytes[3] === 0x46
    && bytes[8] === 0x57
    && bytes[9] === 0x45
    && bytes[10] === 0x42
    && bytes[11] === 0x50
  ) return 'image/webp';
  if (bytes.length >= 6) {
    const signature = Buffer.from(bytes.slice(0, 6)).toString('ascii');
    if (signature === 'GIF87a' || signature === 'GIF89a') return 'image/gif';
  }
  return '';
};

export const ensureProviderFileNameWithExtension = (fileName, mimeType) => {
  const normalizedName = String(fileName || '').trim() || 'upload';
  if (/\.[a-z0-9]{2,5}$/i.test(normalizedName)) return normalizedName;
  const extension = inferExtensionFromMimeType(mimeType, '');
  return extension ? `${normalizedName}.${extension}` : normalizedName;
};

export const buildUniqueProviderFileName = (fileName, uniqueKey = '') => {
  const normalizedName = String(fileName || '').trim() || 'upload.bin';
  const safeName = normalizedName.replace(/[^\w.\-\u4e00-\u9fa5]+/g, '_').slice(0, 120) || 'upload.bin';
  const dotIndex = safeName.lastIndexOf('.');
  const stem = dotIndex > 0 ? safeName.slice(0, dotIndex) : safeName;
  const ext = dotIndex > 0 ? safeName.slice(dotIndex) : '';
  const hash = createHash('sha256').update(String(uniqueKey || normalizedName)).digest('hex').slice(0, 12);
  return `${stem}-${hash}${ext}`;
};

export const parseDataUrlPayload = (value) => {
  const raw = String(value || '').trim();
  const match = raw.match(/^data:([^;,]+)?(?:;charset=[^;,]+)?;base64,([A-Za-z0-9+/=]+)$/i);
  if (!match) return null;
  return {
    mimeType: String(match[1] || 'application/octet-stream').trim().toLowerCase() || 'application/octet-stream',
    base64Data: match[2] || '',
  };
};

export const uploadAssetViaKieWithFallback = async (payload, options = {}) => {
  const { env = {}, deps = {} } = options || {};
  const uploadAssetViaKieStream = deps.uploadAssetViaKieStream;
  if (typeof uploadAssetViaKieStream !== 'function') {
    throw createProviderError('provider_bad_request', '素材上传依赖未配置');
  }
  return uploadAssetViaKieStream(payload, env, options.signal);
};

export const convertInlineDataUrlToKieFileUrl = async (value, options = {}) => {
  const parsed = parseDataUrlPayload(value);
  if (!parsed) return String(value || '').trim();
  const extension = inferExtensionFromMimeType(parsed.mimeType);
  const upload = options.deps?.uploadAssetViaKieWithFallback || uploadAssetViaKieWithFallback;
  const uploaded = await upload({
    fileBuffer: Buffer.from(parsed.base64Data, 'base64'),
    mimeType: parsed.mimeType,
    fileName: `inline-upload.${extension}`,
    uploadPath: 'mayo-storage/internal',
  }, options);
  return String(uploaded?.result?.fileUrl || '').trim();
};

export const readRemoteMediaBufferWithLimit = async (response, label = '远程素材', options = {}) => {
  const maxBytes = Number(options.maxBytes || MAX_PROVIDER_REMOTE_MEDIA_BYTES);
  const contentLength = Number(response.headers?.get?.('content-length') || 0);
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw createProviderError('provider_bad_request', `${label}过大，当前最大支持 ${Math.floor(maxBytes / 1024 / 1024) || maxBytes}MB`);
  }

  const fileBuffer = options.deps?.readResponseBodyWithTimeout
    ? await options.deps.readResponseBodyWithTimeout(response, {
        signal: options.signal,
        timeoutMessage: `${label}下载超时`,
        timeoutMs: Number(options.timeoutMs || 120_000),
        providerStage: 'asset_download',
      })
    : Buffer.from(await response.arrayBuffer());
  if (fileBuffer.length > maxBytes) {
    throw createProviderError('provider_bad_request', `${label}过大，当前最大支持 ${Math.floor(maxBytes / 1024 / 1024) || maxBytes}MB`);
  }
  return fileBuffer;
};

export const downloadManagedAsset = async (assetUrl, envOrOptions = {}, signal = null, options = {}) => {
  const normalizedOptions = normalizeOptions(envOrOptions, signal, options);
  const fetchWithTimeout = normalizedOptions.deps.fetchWithTimeout || fetch;
  const response = await fetchWithTimeout(normalizeManagedAssetDownloadUrl(assetUrl), {
    method: 'GET',
    signal: normalizedOptions.signal,
  }, '内部素材下载超时', 60_000, 'asset_download');
  if (!response.ok) {
    throw createProviderError('provider_bad_request', `内部素材下载失败：HTTP ${response.status}`);
  }

  const fileName = extractFileNameFromUrl(assetUrl);
  const mimeTypeHeader = response.headers?.get?.('content-type') || '';
  const mimeType = String(mimeTypeHeader || '').split(';')[0].trim() || inferMimeTypeFromName(fileName);
  const fileBuffer = await readRemoteMediaBufferWithLimit(response, '内部素材', {
    signal: normalizedOptions.signal,
    timeoutMs: 60_000,
    deps: normalizedOptions.deps,
  });
  return {
    fileName,
    mimeType,
    fileBuffer,
  };
};

export const convertManagedAssetUrlToKieFileUrl = async (assetUrl, envOrOptions = {}, signal = null, options = {}) => {
  const normalizedOptions = normalizeOptions(envOrOptions, signal, options);
  if (!isManagedAssetUrl(assetUrl)) return String(assetUrl || '').trim();
  if (!normalizedOptions.forceUpload) {
    const publicAssetUrl = resolveExternallyReachableManagedAssetUrl(assetUrl, normalizedOptions.env);
    if (publicAssetUrl) return publicAssetUrl;
  }
  const cacheKey = getManagedAssetPath(assetUrl) || String(assetUrl || '').trim();
  const uploadManagedAsset = async () => {
    const downloaded = await downloadManagedAsset(assetUrl, normalizedOptions);
    const upload = normalizedOptions.deps.uploadAssetViaKieWithFallback || uploadAssetViaKieWithFallback;
    const uploaded = await upload({
      ...downloaded,
      fileName: buildUniqueProviderFileName(downloaded.fileName, cacheKey),
      uploadPath: 'mayo-storage/internal',
    }, normalizedOptions);
    const fileUrl = String(uploaded?.result?.fileUrl || '').trim();
    if (!fileUrl) {
      throw createProviderError('provider_bad_response', '上传成功但未返回素材地址');
    }
    return fileUrl;
  };
  return resolveCachedManagedAssetUpload(cacheKey, normalizedOptions.env, uploadManagedAsset);
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

export const assertRemoteProviderMediaUrlAllowed = (mediaUrl) => {
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

export const downloadRemoteMediaUrl = async (mediaUrl, envOrOptions = {}, signal = null, options = {}) => {
  const normalizedOptions = normalizeOptions(envOrOptions, signal, options);
  if (isManagedAssetUrl(mediaUrl)) return downloadManagedAsset(mediaUrl, normalizedOptions);
  assertRemoteProviderMediaUrlAllowed(mediaUrl);
  const fetchWithTimeout = normalizedOptions.deps.fetchWithTimeout || fetch;
  const response = await fetchWithTimeout(mediaUrl, {
    method: 'GET',
    signal: normalizedOptions.signal,
  }, '远程视频素材下载超时', 120_000, 'asset_download');
  if (!response.ok) {
    throw createProviderError('provider_bad_request', `远程视频素材下载失败：HTTP ${response.status}`);
  }
  const fileName = extractFileNameFromUrl(mediaUrl, `video-${Date.now()}.mp4`);
  const mimeTypeHeader = response.headers?.get?.('content-type') || '';
  const mimeType = String(mimeTypeHeader || '').split(';')[0].trim() || inferMimeTypeFromName(fileName, 'video/mp4');
  const fileBuffer = await readRemoteMediaBufferWithLimit(response, '远程视频素材', normalizedOptions);
  return {
    fileName,
    mimeType,
    fileBuffer,
  };
};

export const downloadRemoteProviderMediaUrl = async (mediaUrl, envOrOptions = {}, signal = null, options = {}) => {
  const normalizedOptions = normalizeOptions(envOrOptions, signal, options);
  if (isManagedAssetUrl(mediaUrl)) return downloadManagedAsset(mediaUrl, normalizedOptions);
  assertRemoteProviderMediaUrlAllowed(mediaUrl);
  const fetchWithTimeout = normalizedOptions.deps.fetchWithTimeout || fetch;
  const response = await fetchWithTimeout(mediaUrl, {
    method: 'GET',
    signal: normalizedOptions.signal,
  }, '远程素材下载超时', 120_000, 'asset_download');
  if (!response.ok) {
    throw createProviderError('provider_bad_request', `远程素材下载失败：HTTP ${response.status}`);
  }
  const rawFileName = extractFileNameFromUrl(mediaUrl, `media-${Date.now()}.bin`);
  const mimeTypeHeader = response.headers?.get?.('content-type') || '';
  const fileBuffer = await readRemoteMediaBufferWithLimit(response, '远程素材', normalizedOptions);
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

export const convertGeminiMediaToStableKieUrl = async (mediaUrl, envOrOptions = {}, signal = null, options = {}) => {
  const normalizedOptions = normalizeOptions(envOrOptions, signal, options);
  const downloaded = await downloadRemoteProviderMediaUrl(mediaUrl, normalizedOptions);
  const upload = normalizedOptions.deps.uploadAssetViaKieStream;
  const uploaded = await upload({
    ...downloaded,
    uploadPath: 'mayo-storage/internal',
  }, normalizedOptions.env, normalizedOptions.signal);
  return String(uploaded?.result?.fileUrl || '').trim();
};

export const convertGeminiVideoToOpenRouterChatUrl = async (mediaUrl, envOrOptions = {}, signal = null, options = {}) => {
  const normalizedOptions = normalizeOptions(envOrOptions, signal, options);
  const normalized = String(mediaUrl || '').trim();
  if (!shouldUploadGeminiVideoUrlToOpenRouterChat(normalized)) return normalized;
  const downloaded = await downloadRemoteMediaUrl(normalized, normalizedOptions);
  const uploaded = await uploadAssetViaKieWithFallback({
    ...downloaded,
    uploadPath: 'openrouter-chat',
  }, normalizedOptions);
  return String(uploaded?.result?.fileUrl || '').trim();
};

export const resolveProviderMediaUrl = async (value, envOrOptions = {}, signal = null, options = {}) => {
  const normalizedOptions = normalizeOptions(envOrOptions, signal, options);
  const normalized = normalizeProviderMediaReference(value);
  if (!normalized) return '';
  if (normalized.startsWith('data:')) {
    return convertInlineDataUrlToKieFileUrl(normalized, normalizedOptions);
  }
  if (!isManagedAssetUrl(normalized)) return normalized;
  return convertManagedAssetUrlToKieFileUrl(normalized, normalizedOptions);
};

export const resolveProviderGenerationMediaUrl = async (value, envOrOptions = {}, signal = null, options = {}) => {
  const normalizedOptions = normalizeOptions(envOrOptions, signal, options);
  const normalized = normalizeProviderMediaReference(value);
  if (!normalized) return '';
  if (!isManagedAssetUrl(normalized)) return normalized;
  return convertManagedAssetUrlToKieFileUrl(normalized, {
    ...normalizedOptions,
    forceUpload: normalizedOptions.forceUpload || !shouldUseDirectManagedAssetUrls(normalizedOptions.env),
  });
};

export const resolveProviderChatMediaUrl = async (value, envOrOptions = {}, signal = null, options = {}) => {
  const normalizedOptions = normalizeOptions(envOrOptions, signal, options);
  const normalized = normalizeProviderMediaReference(value);
  if (!normalized) return '';
  if (normalized.startsWith('data:')) {
    return convertInlineDataUrlToKieFileUrl(normalized, normalizedOptions);
  }
  if (!isManagedAssetUrl(normalized)) return normalized;
  return convertManagedAssetUrlToKieFileUrl(normalized, {
    ...normalizedOptions,
    forceUpload: normalizedOptions.forceUpload || !shouldUseDirectManagedAssetUrls(normalizedOptions.env),
  });
};

export const resolveProviderGeminiChatMediaUrl = async (value, envOrOptions = {}, signal = null, options = {}) => {
  const normalizedOptions = normalizeOptions(envOrOptions, signal, options);
  const normalized = String(value || '').trim();
  if (!normalized) return '';
  if (isVideoMediaUrl(normalized)) {
    return convertGeminiVideoToOpenRouterChatUrl(normalized, normalizedOptions);
  }
  if (shouldUploadGeminiMediaUrlForStableMime(normalized, { isManagedAssetUrl })) {
    return convertGeminiMediaToStableKieUrl(normalized, normalizedOptions);
  }
  return resolveProviderChatMediaUrl(normalized, normalizedOptions);
};
