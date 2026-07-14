import { createHash } from 'node:crypto';
import path from 'node:path';
import COS from 'cos-nodejs-sdk-v5';

const IMAGE_KEY_PREFIX = 'managed-images/users/';
const DEFAULT_BROWSER_URL_TTL_SECONDS = 300;
const DEFAULT_PROVIDER_URL_TTL_SECONDS = 10_800;
const DEFAULT_UPLOAD_MAX_ATTEMPTS = 3;
const DEFAULT_UPLOAD_TIMEOUT_MS = 30_000;
const DEFAULT_UPLOAD_RETRY_BASE_MS = 500;

const createManagedImageError = (code, message, extras = null) => {
  const error = new Error(message);
  error.code = code;
  error.providerMessage = message;
  error.providerStage = 'asset_upload';
  if (extras && typeof extras === 'object') Object.assign(error, extras);
  return error;
};

const parseBoundedInteger = (value, fallback, minimum, maximum) => {
  const parsed = Number.parseInt(String(value ?? fallback), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, parsed));
};

const getSetting = (env, key) => String(env?.[key] || process.env[key] || '').trim();

const getRequiredSettings = (env = {}) => {
  const required = [
    'MEIAO_IMAGE_COS_SECRET_ID',
    'MEIAO_IMAGE_COS_SECRET_KEY',
    'MEIAO_IMAGE_COS_BUCKET',
    'MEIAO_IMAGE_COS_REGION',
  ];
  const values = {};
  for (const key of required) {
    values[key] = getSetting(env, key);
    if (!values[key]) {
      throw createManagedImageError(
        'provider_config_error',
        `腾讯 COS 图片存储缺少环境变量 ${key}`,
        { providerStatus: 'config_error' },
      );
    }
  }
  return values;
};

const throwIfAborted = (signal) => {
  if (!signal?.aborted) return;
  throw createManagedImageError('request_cancelled', '图片上传已取消', {
    providerStatus: 'cancelled',
  });
};

const sleepWithSignal = (milliseconds, signal) => new Promise((resolve, reject) => {
  const timer = setTimeout(resolve, milliseconds);
  if (typeof timer?.unref === 'function') timer.unref();
  if (!signal) return;
  const handleAbort = () => {
    clearTimeout(timer);
    reject(createManagedImageError('request_cancelled', '图片上传已取消', {
      providerStatus: 'cancelled',
    }));
  };
  if (signal.aborted) handleAbort();
  else signal.addEventListener('abort', handleAbort, { once: true });
});

const imageExtensionFromMimeType = (mimeType = '') => {
  const normalized = String(mimeType || '').trim().toLowerCase();
  if (normalized === 'image/png') return '.png';
  if (normalized === 'image/webp') return '.webp';
  if (normalized === 'image/gif') return '.gif';
  if (normalized === 'image/avif') return '.avif';
  return '.jpg';
};

const sanitizeImageFileName = (fileName, mimeType) => {
  const normalized = String(fileName || '').trim();
  const requestedExtension = path.extname(normalized).toLowerCase();
  const extension = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif'].includes(requestedExtension)
    ? (requestedExtension === '.jpeg' ? '.jpg' : requestedExtension)
    : imageExtensionFromMimeType(mimeType);
  const baseName = path.basename(normalized);
  const rawStem = requestedExtension
    ? baseName.slice(0, -requestedExtension.length)
    : baseName;
  const stem = rawStem
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80) || 'image';
  return `${stem}${extension}`;
};

const normalizeAssetType = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  return ['source', 'reference', 'chat'].includes(normalized) ? normalized : 'source';
};

const normalizeAssetId = (value) => {
  const normalized = String(value || '').trim().replace(/[^a-zA-Z0-9_-]+/g, '').slice(0, 128);
  if (!normalized) {
    throw createManagedImageError('provider_bad_request', '图片资产 ID 无效', {
      providerStatus: 'invalid_input',
    });
  }
  return normalized;
};

const validateStorageKey = (storageKey) => {
  const normalized = String(storageKey || '').trim();
  if (!normalized.startsWith(IMAGE_KEY_PREFIX) || normalized.includes('..') || normalized.includes('\\')) {
    throw createManagedImageError('provider_bad_request', '图片对象键无效', {
      providerStatus: 'invalid_input',
    });
  }
  return normalized;
};

const createClientContext = (env, options = {}) => {
  const settings = getRequiredSettings(env);
  const createClient = options.createClient || ((config) => new COS(config));
  const client = createClient({
    SecretId: settings.MEIAO_IMAGE_COS_SECRET_ID,
    SecretKey: settings.MEIAO_IMAGE_COS_SECRET_KEY,
  });
  return {
    client,
    Bucket: settings.MEIAO_IMAGE_COS_BUCKET,
    Region: settings.MEIAO_IMAGE_COS_REGION,
  };
};

const isMissingObjectError = (error) => {
  const statusCode = Number(error?.statusCode || error?.status || 0);
  const code = String(error?.code || '').trim();
  return statusCode === 404 || ['NoSuchKey', 'NotFound', 'NoSuchObject'].includes(code);
};

const callCos = (invoke, { timeoutMs = 0 } = {}) => new Promise((resolve, reject) => {
  let settled = false;
  const finish = (handler, value) => {
    if (settled) return;
    settled = true;
    if (timer) clearTimeout(timer);
    handler(value);
  };
  const timer = timeoutMs > 0
    ? setTimeout(() => finish(reject, Object.assign(new Error('COS request timeout'), { code: 'ETIMEDOUT' })), timeoutMs)
    : null;
  if (typeof timer?.unref === 'function') timer.unref();
  try {
    invoke((error, data) => {
      if (error) finish(reject, error);
      else finish(resolve, data || {});
    });
  } catch (error) {
    finish(reject, error);
  }
});

export const buildCosImageObjectKey = ({ userId, assetType, assetId, fileName, mimeType }) => {
  const userDigest = createHash('sha256').update(String(userId || '')).digest('hex').slice(0, 32);
  return `${IMAGE_KEY_PREFIX}${userDigest}/${normalizeAssetType(assetType)}/${normalizeAssetId(assetId)}/${sanitizeImageFileName(fileName, mimeType)}`;
};

export const putTencentCosImage = async (payload, env = {}, signal = null, options = {}) => {
  throwIfAborted(signal);
  const storageKey = validateStorageKey(payload?.storageKey);
  const fileBuffer = Buffer.isBuffer(payload?.fileBuffer)
    ? payload.fileBuffer
    : Buffer.from(payload?.fileBuffer || []);
  if (fileBuffer.length === 0) {
    throw createManagedImageError('provider_bad_request', '图片上传内容为空', {
      providerStatus: 'invalid_input',
    });
  }
  const mimeType = String(payload?.mimeType || '').trim().toLowerCase();
  if (!mimeType.startsWith('image/')) {
    throw createManagedImageError('provider_bad_request', '腾讯 COS 图片存储只接受图片文件', {
      providerStatus: 'invalid_input',
    });
  }

  const { client, Bucket, Region } = createClientContext(env, options);
  const maxAttempts = parseBoundedInteger(
    getSetting(env, 'MEIAO_IMAGE_COS_UPLOAD_MAX_ATTEMPTS'),
    DEFAULT_UPLOAD_MAX_ATTEMPTS,
    1,
    8,
  );
  const timeoutMs = parseBoundedInteger(
    getSetting(env, 'MEIAO_IMAGE_COS_UPLOAD_TIMEOUT_MS'),
    DEFAULT_UPLOAD_TIMEOUT_MS,
    1_000,
    300_000,
  );
  const retryBaseMs = parseBoundedInteger(
    getSetting(env, 'MEIAO_IMAGE_COS_UPLOAD_RETRY_BASE_MS'),
    DEFAULT_UPLOAD_RETRY_BASE_MS,
    0,
    30_000,
  );
  const sleep = options.sleep || sleepWithSignal;

  let response = null;
  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    throwIfAborted(signal);
    try {
      response = await callCos((callback) => client.putObject({
        Bucket,
        Region,
        Key: storageKey,
        Body: fileBuffer,
        ContentLength: fileBuffer.length,
        ContentType: mimeType,
      }, callback), { timeoutMs });
      lastError = null;
      break;
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts) await sleep(retryBaseMs * (2 ** (attempt - 1)), signal);
    }
  }

  if (lastError) {
    throw createManagedImageError(
      'managed_image_upload_failed',
      '图片上传到腾讯 COS 失败，请稍后重新上传',
      {
        providerStatus: 'network_error',
        retryable: true,
        upstreamCode: String(lastError?.code || '').slice(0, 64),
      },
    );
  }
  throwIfAborted(signal);

  return {
    bucket: Bucket,
    region: Region,
    storageKey,
    etag: String(response?.ETag || '').replace(/^"|"$/g, ''),
  };
};

export const createTencentCosImageReadUrl = async (storageKey, purpose = 'browser', env = {}, options = {}) => {
  const Key = validateStorageKey(storageKey);
  const { client, Bucket, Region } = createClientContext(env, options);
  const ttlKey = purpose === 'provider'
    ? 'MEIAO_IMAGE_COS_PROVIDER_URL_TTL_SECONDS'
    : 'MEIAO_IMAGE_COS_BROWSER_URL_TTL_SECONDS';
  const fallbackTtl = purpose === 'provider'
    ? DEFAULT_PROVIDER_URL_TTL_SECONDS
    : DEFAULT_BROWSER_URL_TTL_SECONDS;
  const Expires = parseBoundedInteger(getSetting(env, ttlKey), fallbackTtl, 60, 86_400);
  let response;
  try {
    response = await callCos((callback) => client.getObjectUrl({
      Bucket,
      Region,
      Key,
      Sign: true,
      Method: 'GET',
      Expires,
    }, callback));
  } catch {
    throw createManagedImageError('managed_image_sign_failed', '图片读取地址生成失败，请稍后重试', {
      providerStatus: 'network_error',
      retryable: true,
    });
  }
  const url = String(response?.Url || response?.url || '').trim();
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') throw new Error('non_https');
  } catch {
    throw createManagedImageError('provider_bad_response', '腾讯 COS 返回了无效的图片读取地址', {
      providerStatus: 'invalid_url',
    });
  }
  return url;
};

export const headTencentCosImage = async (storageKey, env = {}, options = {}) => {
  const Key = validateStorageKey(storageKey);
  const { client, Bucket, Region } = createClientContext(env, options);
  try {
    const response = await callCos((callback) => client.headObject({ Bucket, Region, Key }, callback));
    return {
      exists: true,
      etag: String(response?.ETag || '').replace(/^"|"$/g, ''),
      contentLength: Number(response?.headers?.['content-length'] || response?.ContentLength || 0),
    };
  } catch (error) {
    if (isMissingObjectError(error)) return { exists: false };
    throw createManagedImageError('managed_image_head_failed', '腾讯 COS 图片状态检查失败', {
      providerStatus: 'network_error',
      retryable: true,
    });
  }
};

export const deleteTencentCosImage = async (storageKey, env = {}, options = {}) => {
  const Key = validateStorageKey(storageKey);
  const { client, Bucket, Region } = createClientContext(env, options);
  try {
    await callCos((callback) => client.deleteObject({ Bucket, Region, Key }, callback));
    return { deleted: true, missing: false };
  } catch (error) {
    if (isMissingObjectError(error)) return { deleted: true, missing: true };
    throw createManagedImageError('managed_image_delete_failed', '腾讯 COS 图片删除失败', {
      providerStatus: 'network_error',
      retryable: true,
    });
  }
};
