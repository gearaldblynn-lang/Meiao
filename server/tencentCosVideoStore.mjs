import { createHash } from 'node:crypto';
import path from 'node:path';
import COS from 'cos-nodejs-sdk-v5';

const DEFAULT_SIGNED_URL_TTL_SECONDS = 10_800;
const MIN_SIGNED_URL_TTL_SECONDS = 300;
const MAX_SIGNED_URL_TTL_SECONDS = 86_400;

let cosClientFactoryForTest = null;

const createProviderError = (code, message, extras = null) => {
  const error = new Error(message);
  error.code = code;
  error.providerMessage = message;
  error.providerStage = 'asset_upload';
  if (extras && typeof extras === 'object') Object.assign(error, extras);
  return error;
};

const throwIfAborted = (signal) => {
  if (!signal?.aborted) return;
  throw createProviderError('request_cancelled', '任务已取消', {
    providerStatus: 'cancelled',
  });
};

const getRequiredSetting = (env, key) => {
  const value = String(env?.[key] || process.env[key] || '').trim();
  if (!value) {
    throw createProviderError('provider_config_error', `COS 视频直连缺少环境变量 ${key}`, {
      providerStatus: 'config_error',
    });
  }
  return value;
};

export const getCosSignedUrlTtlSeconds = (env = {}) => {
  const parsed = Number.parseInt(String(
    env.MEIAO_COS_SIGNED_URL_TTL_SECONDS
    || process.env.MEIAO_COS_SIGNED_URL_TTL_SECONDS
    || DEFAULT_SIGNED_URL_TTL_SECONDS
  ), 10);
  if (!Number.isFinite(parsed)) return DEFAULT_SIGNED_URL_TTL_SECONDS;
  return Math.max(MIN_SIGNED_URL_TTL_SECONDS, Math.min(MAX_SIGNED_URL_TTL_SECONDS, parsed));
};

const extensionFromMimeType = (mimeType = '') => {
  const normalized = String(mimeType || '').trim().toLowerCase();
  if (normalized === 'video/quicktime') return '.mov';
  if (normalized === 'video/webm') return '.webm';
  if (normalized === 'video/x-m4v') return '.m4v';
  return '.mp4';
};

const sanitizeVideoFileName = (fileName, mimeType) => {
  const normalized = String(fileName || '').trim();
  const rawExtension = path.extname(normalized).toLowerCase();
  const allowedExtension = ['.mp4', '.mov', '.webm', '.m4v'].includes(rawExtension)
    ? rawExtension
    : extensionFromMimeType(mimeType);
  const rawStem = path.basename(normalized, rawExtension || undefined);
  const safeStem = rawStem
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80) || 'reference';
  return `${safeStem}${allowedExtension}`;
};

export const buildCosVideoObjectKey = ({ fileBuffer, fileName, mimeType }) => {
  const buffer = Buffer.isBuffer(fileBuffer) ? fileBuffer : Buffer.from(fileBuffer || []);
  const digest = createHash('sha256').update(buffer).digest('hex');
  return `gemini-video/${digest}/${sanitizeVideoFileName(fileName, mimeType)}`;
};

const callCos = (invoke) => new Promise((resolve, reject) => {
  invoke((error, data) => {
    if (error) {
      reject(createProviderError('provider_network_error', `COS 视频上传失败：${error?.message || '请求失败'}`, {
        providerStatus: 'network_error',
      }));
      return;
    }
    resolve(data || {});
  });
});

export const __testOnly_setCosClientFactory = (factory) => {
  cosClientFactoryForTest = typeof factory === 'function' ? factory : null;
};

export const uploadGeminiVideoToCos = async (payload, env = {}, signal = null, options = {}) => {
  throwIfAborted(signal);
  const fileBuffer = Buffer.isBuffer(payload?.fileBuffer)
    ? payload.fileBuffer
    : Buffer.from(payload?.fileBuffer || []);
  if (fileBuffer.length === 0) {
    throw createProviderError('provider_bad_request', 'COS 视频上传内容为空', {
      providerStatus: 'invalid_input',
    });
  }

  const SecretId = getRequiredSetting(env, 'MEIAO_COS_SECRET_ID');
  const SecretKey = getRequiredSetting(env, 'MEIAO_COS_SECRET_KEY');
  const Bucket = getRequiredSetting(env, 'MEIAO_COS_BUCKET');
  const Region = getRequiredSetting(env, 'MEIAO_COS_REGION');
  const createClient = options.createClient || cosClientFactoryForTest || ((config) => new COS(config));
  const client = createClient({ SecretId, SecretKey });
  const Key = buildCosVideoObjectKey({
    fileBuffer,
    fileName: payload?.fileName,
    mimeType: payload?.mimeType,
  });
  const ContentType = String(payload?.mimeType || '').trim() || 'video/mp4';

  await callCos((callback) => client.putObject({
    Bucket,
    Region,
    Key,
    Body: fileBuffer,
    ContentLength: fileBuffer.length,
    ContentType,
  }, callback));
  throwIfAborted(signal);

  const signed = await callCos((callback) => client.getObjectUrl({
    Bucket,
    Region,
    Key,
    Sign: true,
    Method: 'GET',
    Expires: getCosSignedUrlTtlSeconds(env),
  }, callback));
  throwIfAborted(signal);
  const url = String(signed?.Url || signed?.url || '').trim();
  if (!url) {
    throw createProviderError('provider_bad_response', 'COS 已上传视频但未返回签名读取地址', {
      providerStatus: 'missing_url',
    });
  }
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') throw new Error('non_https');
  } catch {
    throw createProviderError('provider_bad_response', 'COS 返回的签名读取地址不是有效 HTTPS URL', {
      providerStatus: 'invalid_url',
    });
  }
  return url;
};
