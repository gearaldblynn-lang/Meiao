import { createHash, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { readResponseBodyWithTimeout } from './providerBodyRead.mjs';
import { inferExtensionFromMimeType, parseDataUrlPayload } from './providerAssetTransfer.mjs';
import { enqueueAssetCleanupTask, ensureAssetLifecycleSchema } from './assetLifecycleStore.mjs';
import { buildCosImageObjectKey, putTencentCosImage } from './tencentCosImageStore.mjs';
import { appendManagedAssetAccessKey } from './managedAssetAccessKey.mjs';
import {
  getManagedImageFileExtension,
  resolveManagedImageUpload,
} from './managedImageValidation.mjs';
import {
  normalizeManagedImageUploadMode,
  resolveLocalManagedImageUpload,
} from './managedImageUploadMode.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const ASSET_RETENTION_MS = 1000 * 60 * 60 * 24 * 3;
const DEFAULT_VOICEOVER_INTERMEDIATE_TTL_MS = 1000 * 60 * 60 * 24 * 3;
const MIN_VOICEOVER_INTERMEDIATE_TTL_MS = 1000 * 60 * 60;
const MAX_VOICEOVER_INTERMEDIATE_TTL_MS = 1000 * 60 * 60 * 24 * 30;
const ASSET_DIR = path.join(__dirname, 'data', 'assets');
const LOCAL_REGISTRY_PATH = path.join(__dirname, 'data', 'asset-registry.json');
const PERMANENT_ASSET_MODULES = new Set(['agent_center', 'agent_chat', 'virtual_model']);
const DEFAULT_RESULT_ASSET_DOWNLOAD_TIMEOUT_MS = 60_000;
const DEFAULT_RESULT_ASSET_DOWNLOAD_RETRIES = 2;
const DEFAULT_RESULT_ASSET_DOWNLOAD_RETRY_BASE_MS = 500;
const STORED_ASSET_STORAGE_STATUSES = new Set([
  'uploading',
  'active',
  'delete_pending',
  'deleted',
  'upload_failed',
]);
const COS_MANAGED_IMAGE_ASSET_TYPES = new Set(['source', 'reference', 'chat']);
const ACCEPTED_UPLOAD_ASSET_TYPES = new Set(['source', 'reference', 'chat', 'result', 'guide']);
const ACTIVE_MANAGED_ASSET_RUN_STATUSES = new Set([
  'queued',
  'pending',
  'running',
  'retry_waiting',
  'retrying',
  'submitted',
  'processing',
  'generating',
]);
const TERMINAL_MANAGED_ASSET_RUN_STATUSES = new Set([
  'succeeded',
  'failed',
  'cancelled',
  'canceled',
  'interrupted',
  'completed',
  'complete',
  'deleted',
]);

export const normalizeStoredAssetJobId = (value) => String(value || '').trim().slice(0, 120);

export const getActiveManagedAssetRunIds = (value) => {
  if (!value || typeof value !== 'object') return [];
  const status = String(value.status || '').trim().toLowerCase();
  const phase = String(value.phase || '').trim().toLowerCase();
  if (TERMINAL_MANAGED_ASSET_RUN_STATUSES.has(status)) return [];
  if (value.pending !== true && !ACTIVE_MANAGED_ASSET_RUN_STATUSES.has(status) && !ACTIVE_MANAGED_ASSET_RUN_STATUSES.has(phase)) {
    return [];
  }
  return Array.from(new Set([
    value.id,
    value.jobId,
    value.runId,
    value.clientRequestId,
    value.providerTaskId,
    value.imagePlan?.providerTaskId,
    ...(Array.isArray(value.providerTaskIds) ? value.providerTaskIds : []),
    ...(Array.isArray(value.imagePlan?.providerTaskIds) ? value.imagePlan.providerTaskIds : []),
  ].map(normalizeStoredAssetJobId).filter(Boolean)));
};

const ensureDir = (dirPath) => {
  mkdirSync(dirPath, { recursive: true });
};

const now = () => Date.now();
const MP4_CONTAINER_ATOMS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'edts', 'dinf']);

const parseIntegerSetting = (value, fallback, { allowZero = false } = {}) => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed) || (allowZero ? parsed < 0 : parsed <= 0)) return fallback;
  return parsed;
};

const createAssetDownloadError = (code, message, extras = null) => {
  const error = new Error(message);
  error.code = code;
  error.providerMessage = message;
  error.providerStage = 'asset_download';
  if (extras && typeof extras === 'object') Object.assign(error, extras);
  return error;
};

const isRetryableAssetDownloadError = (error) => {
  if (error?.code === 'provider_network_error' || error?.code === 'provider_timeout') return true;
  const status = Number(error?.httpStatus || 0);
  return status === 408 || status === 429 || status >= 500;
};

const fetchRemoteAssetOnce = async (remoteUrl, { fetchImpl, timeoutMs }) => {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  let response;
  try {
    response = await fetchImpl(remoteUrl, { signal: controller.signal });
  } catch (error) {
    if (timedOut) {
      throw createAssetDownloadError('provider_timeout', '结果资源抓取超时', {
        providerStatus: 'timeout',
      });
    }
    throw createAssetDownloadError('provider_network_error', error?.message || '结果资源抓取失败', {
      providerStatus: 'network_error',
    });
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    response.body?.cancel?.().catch?.(() => null);
    throw createAssetDownloadError('provider_bad_response', `结果资源抓取失败: HTTP ${response.status}`, {
      httpStatus: response.status,
      providerStatus: `http_${response.status}`,
    });
  }

  const fileBuffer = await readResponseBodyWithTimeout(response, {
    timeoutMessage: '结果资源读取超时',
    timeoutMs,
    providerStage: 'asset_download',
  });
  return {
    fileBuffer,
    contentType: response.headers.get('content-type') || 'application/octet-stream',
  };
};

export const fetchRemoteAssetBufferWithRetry = async (remoteUrl, options = {}) => {
  const timeoutMs = parseIntegerSetting(
    options.timeoutMs ?? process.env.MEIAO_RESULT_ASSET_DOWNLOAD_TIMEOUT_MS,
    DEFAULT_RESULT_ASSET_DOWNLOAD_TIMEOUT_MS,
  );
  const retries = parseIntegerSetting(
    options.retries ?? process.env.MEIAO_RESULT_ASSET_DOWNLOAD_RETRIES,
    DEFAULT_RESULT_ASSET_DOWNLOAD_RETRIES,
    { allowZero: true },
  );
  const retryBaseMs = parseIntegerSetting(
    options.retryBaseMs ?? process.env.MEIAO_RESULT_ASSET_DOWNLOAD_RETRY_BASE_MS,
    DEFAULT_RESULT_ASSET_DOWNLOAD_RETRY_BASE_MS,
    { allowZero: true },
  );
  const fetchImpl = options.fetchImpl || fetch;
  const sleep = options.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fetchRemoteAssetOnce(remoteUrl, { fetchImpl, timeoutMs });
    } catch (error) {
      if (attempt >= retries || !isRetryableAssetDownloadError(error)) throw error;
      const delayMs = retryBaseMs * (attempt + 1);
      if (delayMs > 0) await sleep(delayMs);
    }
  }
  throw createAssetDownloadError('provider_network_error', '结果资源抓取失败', {
    providerStatus: 'network_error',
  });
};

const readMp4Atom = (buffer, offset, limit = buffer.length) => {
  if (!Buffer.isBuffer(buffer) || offset + 8 > limit) return null;
  const smallSize = buffer.readUInt32BE(offset);
  const type = buffer.toString('latin1', offset + 4, offset + 8);
  let size = smallSize;
  let headerSize = 8;
  if (smallSize === 1) {
    if (offset + 16 > limit) return null;
    const wideSize = buffer.readBigUInt64BE(offset + 8);
    if (wideSize > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    size = Number(wideSize);
    headerSize = 16;
  } else if (smallSize === 0) {
    size = limit - offset;
  }
  if (!Number.isFinite(size) || size < headerSize || offset + size > limit) return null;
  return { type, offset, size, headerSize, end: offset + size };
};

const patchMp4ChunkOffsets = (buffer, start, limit, delta) => {
  let offset = start;
  while (offset + 8 <= limit) {
    const atom = readMp4Atom(buffer, offset, limit);
    if (!atom) return;
    const payloadStart = atom.offset + atom.headerSize;
    if (atom.type === 'stco') {
      const countOffset = payloadStart + 4;
      if (countOffset + 4 <= atom.end) {
        const entryCount = buffer.readUInt32BE(countOffset);
        for (let index = 0; index < entryCount; index += 1) {
          const valueOffset = countOffset + 4 + index * 4;
          if (valueOffset + 4 > atom.end) break;
          const nextValue = buffer.readUInt32BE(valueOffset) + delta;
          if (nextValue <= 0xffffffff) buffer.writeUInt32BE(nextValue, valueOffset);
        }
      }
    } else if (atom.type === 'co64') {
      const countOffset = payloadStart + 4;
      if (countOffset + 4 <= atom.end) {
        const entryCount = buffer.readUInt32BE(countOffset);
        for (let index = 0; index < entryCount; index += 1) {
          const valueOffset = countOffset + 4 + index * 8;
          if (valueOffset + 8 > atom.end) break;
          buffer.writeBigUInt64BE(buffer.readBigUInt64BE(valueOffset) + BigInt(delta), valueOffset);
        }
      }
    } else if (MP4_CONTAINER_ATOMS.has(atom.type)) {
      patchMp4ChunkOffsets(buffer, payloadStart, atom.end, delta);
    }
    offset = atom.end;
  }
};

export const optimizeMp4BufferForStreaming = (input) => {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input || []);
  if (buffer.length < 32 || buffer.toString('latin1', 4, 8) !== 'ftyp') return buffer;

  const atoms = [];
  let offset = 0;
  while (offset + 8 <= buffer.length) {
    const atom = readMp4Atom(buffer, offset);
    if (!atom) return buffer;
    atoms.push(atom);
    offset = atom.end;
  }

  const ftyp = atoms.find((atom) => atom.type === 'ftyp');
  const moov = atoms.find((atom) => atom.type === 'moov');
  const firstMdat = atoms.find((atom) => atom.type === 'mdat');
  if (!ftyp || !moov || !firstMdat || moov.offset < firstMdat.offset) return buffer;
  if (buffer.subarray(moov.offset, moov.end).includes(Buffer.from('cmov'))) return buffer;

  const adjustedMoov = Buffer.from(buffer.subarray(moov.offset, moov.end));
  patchMp4ChunkOffsets(adjustedMoov, readMp4Atom(adjustedMoov, 0)?.headerSize || 8, adjustedMoov.length, moov.size);

  const withoutMoov = Buffer.concat([
    buffer.subarray(0, moov.offset),
    buffer.subarray(moov.end),
  ]);
  const insertAt = ftyp.end;
  return Buffer.concat([
    withoutMoov.subarray(0, insertAt),
    adjustedMoov,
    withoutMoov.subarray(insertAt),
  ]);
};

const shouldOptimizeMp4 = ({ mimeType = '', originalName = '' }) => (
  String(mimeType || '').toLowerCase().includes('video/mp4')
  || /\.mp4(?:$|\?)/i.test(String(originalName || ''))
);

const normalizeBaseUrl = (value) => {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';
  return trimmed.replace(/\/+$/, '');
};

export const sanitizeAssetName = (value) => {
  const raw = String(value || 'upload.bin').trim() || 'upload.bin';
  const ext = path.extname(raw).slice(0, 16);
  const base = path.basename(raw, ext) || 'upload';
  const safeBase = base.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80) || 'upload';
  const safeExt = ext.replace(/[^.a-zA-Z0-9]/g, '').slice(0, 16);
  return `${safeBase}${safeExt}`;
};

export const normalizeManagedImageAssetName = (value, mimeType) => {
  const safeName = sanitizeAssetName(value);
  const trustedExtension = getManagedImageFileExtension(mimeType);
  if (!trustedExtension) return safeName;
  const currentExtension = path.extname(safeName);
  return currentExtension
    ? `${safeName.slice(0, -currentExtension.length)}${trustedExtension}`
    : `${safeName}${trustedExtension}`;
};

export const buildAssetPublicPath = (assetId, originalName = '') => {
  const assetPath = `/api/assets/file/${encodeURIComponent(String(assetId || ''))}`;
  const safeName = sanitizeAssetName(originalName || '');
  return safeName ? `${assetPath}/${encodeURIComponent(safeName)}` : assetPath;
};

export const buildAssetPublicUrl = (publicBaseUrl, assetId, originalName = '') =>
  `${normalizeBaseUrl(publicBaseUrl)}${buildAssetPublicPath(assetId, originalName)}`;

export const extractStoredAssetIdFromPublicUrl = (value) => {
  const normalized = String(value || '').trim();
  if (!normalized) return '';
  const pathValue = normalized.startsWith('http')
    ? (() => {
        try {
          return new URL(normalized).pathname || '';
        } catch {
          return '';
        }
      })()
    : normalized;
  const match = pathValue.match(/\/api\/assets\/file\/([^/]+)/);
  return match ? decodeURIComponent(match[1]) : '';
};

export const getStoredAssetStorageProvider = (asset) => (
  String(asset?.provider || '').trim() === 'tencent_cos' ? 'tencent_cos' : 'internal'
);

export const isExplicitManagedAssetIdKey = (key) => (
  key === 'assetId' || (String(key || '').endsWith('AssetId') && key !== 'localAssetId')
);

export const collectExplicitManagedAssetIds = (value, bucket = new Set()) => {
  if (Array.isArray(value)) {
    value.forEach((item) => collectExplicitManagedAssetIds(item, bucket));
    return bucket;
  }
  if (!value || typeof value !== 'object') return bucket;
  for (const [key, child] of Object.entries(value)) {
    if (isExplicitManagedAssetIdKey(key) && typeof child === 'string' && child.trim()) {
      bucket.add(child.trim());
    }
    collectExplicitManagedAssetIds(child, bucket);
  }
  return bucket;
};

export const collectStoredAssetIdsFromValue = (value) => {
  const ids = new Set();
  const visit = (current) => {
    if (current === null || current === undefined) return;
    if (typeof current === 'string') {
      const pattern = /\/api\/assets\/file\/([^/\s"'?#]+)/g;
      let match = pattern.exec(current);
      while (match) {
        ids.add(decodeURIComponent(match[1]));
        match = pattern.exec(current);
      }
      const directId = extractStoredAssetIdFromPublicUrl(current);
      if (directId) ids.add(directId);
      return;
    }
    if (Array.isArray(current)) {
      current.forEach(visit);
      return;
    }
    if (typeof current === 'object') {
      Object.values(current).forEach(visit);
    }
  };
  visit(value);
  collectExplicitManagedAssetIds(value, ids);
  return Array.from(ids);
};

export const getPublicBaseUrl = (env = {}, requestLike = null) => {
  const explicit = normalizeBaseUrl(env.MEIAO_PUBLIC_BASE_URL || env.PUBLIC_BASE_URL || '');
  if (explicit) return explicit;

  const headers = requestLike?.headers;
  const hostHeader = headers?.host || headers?.Host || '';
  const forwardedProto = headers?.['x-forwarded-proto'] || headers?.['X-Forwarded-Proto'] || '';
  if (!hostHeader) return '';

  const proto = String(forwardedProto || '').split(',')[0].trim() || (
    /127\.0\.0\.1|localhost/i.test(hostHeader) ? 'http' : 'http'
  );

  return normalizeBaseUrl(`${proto}://${hostHeader}`);
};

export const shouldRetainAssetRecord = (asset, referenceTime = now()) => {
  if (!asset || asset.deletedAt) return false;
  if (asset.isReferenced) return true;
  if (Number(asset.expiresAt || 0) <= 0) return true;
  return Number(asset.expiresAt || 0) > Number(referenceTime || 0);
};

export const selectExpiredAssetsForCleanup = (records, referenceTime = now()) => {
  if (!Array.isArray(records)) return [];
  return records.filter((record) => (
    record &&
    !record.deletedAt &&
    !record.isReferenced &&
    Number(record.expiresAt || 0) > 0 &&
    Number(record.expiresAt || 0) <= Number(referenceTime || 0)
  ));
};

export const selectAbandonedPermanentAgentResultAssets = (
  records,
  referenceTime = now(),
  graceMs = 2 * 60 * 1000,
) => {
  if (!Array.isArray(records)) return [];
  const cutoff = Number(referenceTime || 0) - Math.max(1, Number(graceMs || 0));
  return records.filter((record) => (
    record
    && !record.deletedAt
    && !record.isReferenced
    && PERMANENT_ASSET_MODULES.has(String(record.module || '').trim())
    && String(record.assetType || '').trim() === 'result'
    && String(record.storageStatus || 'active') === 'active'
    && Number(record.expiresAt || 0) <= 0
    && Number(record.createdAt || 0) > 0
    && Number(record.createdAt || 0) <= cutoff
  ));
};

const getAssetExpiresAt = ({ module = '', createdAt = now() } = {}) => (
  PERMANENT_ASSET_MODULES.has(String(module || '').trim())
    ? 0
    : Number(createdAt || 0) + ASSET_RETENTION_MS
);

export const getVoiceoverIntermediateTtlMs = (env = process.env) => {
  const parsed = Number.parseInt(String(env?.MEIAO_VOICEOVER_INTERMEDIATE_TTL_MS ?? ''), 10);
  return Number.isFinite(parsed) && parsed >= MIN_VOICEOVER_INTERMEDIATE_TTL_MS && parsed <= MAX_VOICEOVER_INTERMEDIATE_TTL_MS
    ? parsed
    : DEFAULT_VOICEOVER_INTERMEDIATE_TTL_MS;
};

export const getVoiceoverIntermediateExpiresAt = (env = process.env, createdAt = now()) => (
  Number(createdAt || now()) + getVoiceoverIntermediateTtlMs(env)
);

const normalizeAssetExpiresAt = ({ expiresAt, module, createdAt }) => {
  const candidate = Number(expiresAt);
  return Number.isFinite(candidate) && candidate >= 0
    ? candidate
    : getAssetExpiresAt({ module, createdAt });
};

export const getStoredAssetDeleteGraceMs = (env = process.env) => {
  const parsed = Number.parseInt(String(env?.MEIAO_ASSET_DELETE_GRACE_MS ?? 120_000), 10);
  return Number.isFinite(parsed) ? Math.max(1_000, Math.min(parsed, 10 * 60 * 1000)) : 120_000;
};

const mapAssetRow = (row) => ({
  id: String(row.id),
  userId: String(row.user_id || ''),
  module: String(row.module || 'system'),
  assetType: String(row.asset_type || 'source'),
  storageKey: String(row.storage_key || ''),
  storageBucket: String(row.storage_bucket || ''),
  storageRegion: String(row.storage_region || ''),
  originalName: String(row.original_name || ''),
  mimeType: String(row.mime_type || 'application/octet-stream'),
  fileSize: Number(row.file_size || 0),
  contentHash: String(row.content_hash || ''),
  width: Number(row.width || 0),
  height: Number(row.height || 0),
  provider: String(row.provider || 'internal'),
  storageStatus: String(row.storage_status || 'active'),
  providerSourceUrl: String(row.provider_source_url || ''),
  jobId: String(row.job_id || ''),
  publicUrl: String(row.public_url || ''),
  createdAt: Number(row.created_at || 0),
  updatedAt: Number(row.updated_at || 0),
  lastAccessedAt: Number(row.last_accessed_at || 0),
  expiresAt: Number(row.expires_at || 0),
  deletedAt: row.deleted_at === null || row.deleted_at === undefined ? null : Number(row.deleted_at),
});

const ensureLocalRegistry = () => {
  ensureDir(path.dirname(LOCAL_REGISTRY_PATH));
  if (!existsSync(LOCAL_REGISTRY_PATH)) {
    writeFileSync(LOCAL_REGISTRY_PATH, JSON.stringify({ assets: [] }, null, 2), 'utf8');
  }
};

const appendCleanupDiagnostic = (originalError, operation, cleanupError) => {
  if (!cleanupError || cleanupError.code === 'ENOENT') return;
  const cleanupErrors = Array.isArray(originalError.cleanupErrors) ? originalError.cleanupErrors : [];
  cleanupErrors.push({
    operation,
    code: String(cleanupError.code || ''),
    message: String(cleanupError.message || ''),
  });
  originalError.cleanupErrors = cleanupErrors;
};

const cleanupOwnedPath = async (originalError, filePath, unlinkFile = fs.unlink) => {
  try {
    await unlinkFile(filePath);
  } catch (cleanupError) {
    appendCleanupDiagnostic(originalError, 'unlink', cleanupError);
  }
};

const createLocalRegistryCorruptError = (cause) => {
  const error = new Error('本地素材注册表损坏，已拒绝覆盖现有元数据');
  error.code = 'managed_asset_registry_corrupt';
  error.cause = cause;
  return error;
};

const readLocalRegistry = () => {
  ensureLocalRegistry();
  try {
    const parsed = JSON.parse(readFileSync(LOCAL_REGISTRY_PATH, 'utf8'));
    if (!Array.isArray(parsed.assets)) throw new Error('assets must be an array');
    return parsed.assets;
  } catch (error) {
    throw createLocalRegistryCorruptError(error);
  }
};

export const writeAtomicJsonFile = async (filePath, value, deps = {}) => {
  const openFile = deps.openFile || fs.open;
  const renameFile = deps.renameFile || fs.rename;
  const unlinkFile = deps.unlinkFile || fs.unlink;
  const createTempPath = deps.createTempPath || ((targetPath) => path.join(
    path.dirname(targetPath),
    `.${path.basename(targetPath)}.${randomBytes(8).toString('hex')}.tmp`,
  ));
  const tempPath = createTempPath(filePath);
  const serialized = JSON.stringify(value, null, 2);
  let tempHandle = null;
  let tempCreated = false;
  try {
    tempHandle = await openFile(tempPath, 'wx');
    tempCreated = true;
    await tempHandle.writeFile(serialized, 'utf8');
    await tempHandle.close();
    tempHandle = null;
    await renameFile(tempPath, filePath);
    tempCreated = false;
  } catch (error) {
    if (tempHandle) {
      try {
        await tempHandle.close();
      } catch (cleanupError) {
        appendCleanupDiagnostic(error, 'close', cleanupError);
      }
    }
    if (tempCreated) await cleanupOwnedPath(error, tempPath, unlinkFile);
    throw error;
  }
};

const writeLocalRegistry = async (assets) => {
  ensureLocalRegistry();
  await writeAtomicJsonFile(LOCAL_REGISTRY_PATH, { assets });
};

let localRegistryMutationTail = Promise.resolve();
const mutateLocalRegistry = (operation) => {
  const run = localRegistryMutationTail.catch(() => null).then(async () => {
    const assets = readLocalRegistry();
    const result = await operation(assets);
    await writeLocalRegistry(assets);
    return result;
  });
  localRegistryMutationTail = run.then(() => undefined, () => undefined);
  return run;
};

export const ensureAssetSchema = async (pool) => {
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS stored_assets (
      id VARCHAR(24) PRIMARY KEY,
      user_id VARCHAR(24) NOT NULL,
      module VARCHAR(60) NOT NULL,
      asset_type VARCHAR(20) NOT NULL,
      storage_key VARCHAR(255) NOT NULL,
      storage_bucket VARCHAR(255) NOT NULL DEFAULT '',
      storage_region VARCHAR(60) NOT NULL DEFAULT '',
      original_name VARCHAR(255) NOT NULL,
      mime_type VARCHAR(120) NOT NULL,
      file_size BIGINT NOT NULL DEFAULT 0,
      content_hash CHAR(64) NULL,
      width INT NOT NULL DEFAULT 0,
      height INT NOT NULL DEFAULT 0,
      provider VARCHAR(40) NOT NULL DEFAULT 'internal',
      storage_status VARCHAR(20) NOT NULL DEFAULT 'active',
      provider_source_url TEXT NULL,
      job_id VARCHAR(120) NULL,
      public_url TEXT NOT NULL,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL,
      last_accessed_at BIGINT NOT NULL,
      expires_at BIGINT NOT NULL,
      deleted_at BIGINT NULL,
      INDEX idx_stored_assets_user_id (user_id),
      INDEX idx_stored_assets_expires_at (expires_at),
      INDEX idx_stored_assets_job_id (job_id)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);
  await pool.query('ALTER TABLE stored_assets MODIFY COLUMN job_id VARCHAR(120) NULL');
  try {
    await pool.query("ALTER TABLE stored_assets ADD COLUMN storage_status VARCHAR(20) NOT NULL DEFAULT 'active' AFTER provider");
  } catch (error) {
    if (error?.code !== 'ER_DUP_FIELDNAME' && Number(error?.errno || 0) !== 1060) throw error;
  }
  for (const definition of [
    'content_hash CHAR(64) NULL AFTER file_size',
    "storage_bucket VARCHAR(255) NOT NULL DEFAULT '' AFTER storage_key",
    "storage_region VARCHAR(60) NOT NULL DEFAULT '' AFTER storage_bucket",
  ]) {
    try {
      await pool.query(`ALTER TABLE stored_assets ADD COLUMN ${definition}`);
    } catch (error) {
      if (error?.code !== 'ER_DUP_FIELDNAME' && Number(error?.errno || 0) !== 1060) throw error;
    }
  }
  await pool.query("UPDATE stored_assets SET storage_status = 'active' WHERE storage_status IS NULL OR storage_status = ''");
  await pool.query(`
    UPDATE stored_assets
    SET expires_at = 0
    WHERE module IN ('agent_center', 'agent_chat', 'virtual_model')
      AND expires_at <> 0
  `);
  await ensureAssetLifecycleSchema(pool);
};

const createAssetRecord = async (pool, record) => {
  if (pool) {
    await pool.query(
      `INSERT INTO stored_assets (
        id, user_id, module, asset_type, storage_key, storage_bucket, storage_region, original_name, mime_type,
        file_size, content_hash, width, height, provider, provider_source_url, job_id, public_url,
        created_at, updated_at, last_accessed_at, expires_at, deleted_at, storage_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        record.id,
        record.userId,
        record.module,
        record.assetType,
        record.storageKey,
        record.storageBucket || '',
        record.storageRegion || '',
        record.originalName,
        record.mimeType,
        record.fileSize,
        record.contentHash || null,
        record.width,
        record.height,
        record.provider,
        record.providerSourceUrl || null,
        record.jobId || null,
        record.publicUrl,
        record.createdAt,
        record.updatedAt,
        record.lastAccessedAt,
        record.expiresAt,
        record.deletedAt,
        record.storageStatus || 'active',
      ]
    );
    return record;
  }

  return mutateLocalRegistry((assets) => {
    assets.push(record);
    return record;
  });
};

export const getStoredAssetById = async (pool, assetId) => {
  if (!assetId) return null;
  if (pool) {
    const [rows] = await pool.query('SELECT * FROM stored_assets WHERE id = ? LIMIT 1', [assetId]);
    return rows[0] ? mapAssetRow(rows[0]) : null;
  }

  const assets = readLocalRegistry();
  return assets.find((item) => item.id === assetId) || null;
};

export const listStoredAssets = async (pool) => {
  if (pool) {
    const [rows] = await pool.query('SELECT * FROM stored_assets WHERE deleted_at IS NULL ORDER BY created_at DESC');
    return rows.map(mapAssetRow);
  }
  return readLocalRegistry().filter((item) => !item.deletedAt);
};

export const listStoredAssetsForUser = async (pool, userId) => {
  const normalizedUserId = String(userId || '').trim();
  if (!normalizedUserId) return [];
  if (pool) {
    const [rows] = await pool.query(
      'SELECT * FROM stored_assets WHERE user_id = ? AND deleted_at IS NULL ORDER BY created_at DESC',
      [normalizedUserId],
    );
    return (rows || []).map(mapAssetRow);
  }
  return readLocalRegistry().filter((item) => (
    !item.deletedAt && String(item.userId || '') === normalizedUserId
  ));
};

export const listAllStoredAssets = async (pool) => {
  if (pool) {
    const [rows] = await pool.query('SELECT * FROM stored_assets ORDER BY created_at DESC');
    return rows.map(mapAssetRow);
  }
  return readLocalRegistry();
};

export const listAllStoredAssetsForUser = async (pool, userId) => {
  const normalizedUserId = String(userId || '').trim();
  if (!normalizedUserId) return [];
  if (pool) {
    const [rows] = await pool.query(
      'SELECT * FROM stored_assets WHERE user_id = ? ORDER BY created_at DESC',
      [normalizedUserId],
    );
    return (rows || []).map(mapAssetRow);
  }
  return readLocalRegistry().filter((item) => String(item.userId || '') === normalizedUserId);
};

export const markStoredAssetAccessed = async (pool, assetId, touchedAt = now()) => {
  if (!assetId) return;
  if (pool) {
    await pool.query('UPDATE stored_assets SET last_accessed_at = ?, updated_at = ? WHERE id = ?', [touchedAt, touchedAt, assetId]);
    return;
  }
  await mutateLocalRegistry((assets) => {
    const index = assets.findIndex((item) => item.id === assetId);
    if (index >= 0) assets[index] = { ...assets[index], lastAccessedAt: touchedAt, updatedAt: touchedAt };
  });
};

export const markStoredAssetStorageStatus = async (pool, assetId, storageStatus, touchedAt = now()) => {
  const normalizedStatus = String(storageStatus || '').trim();
  if (!STORED_ASSET_STORAGE_STATUSES.has(normalizedStatus)) {
    throw new Error(`无效的素材存储状态: ${normalizedStatus || 'empty'}`);
  }
  if (!assetId) return;
  if (pool) {
    const sql = normalizedStatus === 'active'
      ? 'UPDATE stored_assets SET storage_status = ?, deleted_at = NULL, updated_at = ? WHERE id = ?'
      : 'UPDATE stored_assets SET storage_status = ?, updated_at = ? WHERE id = ?';
    await pool.query(sql, [normalizedStatus, touchedAt, assetId]);
    return;
  }
  await mutateLocalRegistry((assets) => {
    const index = assets.findIndex((item) => item.id === assetId);
    if (index >= 0) assets[index] = {
      ...assets[index],
      storageStatus: normalizedStatus,
      updatedAt: touchedAt,
      ...(normalizedStatus === 'active' ? { deletedAt: null } : {}),
    };
  });
};

export const markStoredAssetDeleted = async (pool, assetId, deletedAt = now()) => {
  if (!assetId) return;
  if (pool) {
    await pool.query(
      "UPDATE stored_assets SET storage_status = 'deleted', deleted_at = ?, updated_at = ? WHERE id = ?",
      [deletedAt, deletedAt, assetId],
    );
    return;
  }
  await mutateLocalRegistry((assets) => {
    const index = assets.findIndex((item) => item.id === assetId);
    if (index >= 0) assets[index] = { ...assets[index], storageStatus: 'deleted', deletedAt, updatedAt: deletedAt };
  });
};

export const markStoredAssetDeletePending = async (pool, assetId, deletedAt = now()) => {
  if (!assetId) return;
  if (pool) {
    await pool.query(
      "UPDATE stored_assets SET storage_status = 'delete_pending', deleted_at = ?, updated_at = ? WHERE id = ?",
      [deletedAt, deletedAt, assetId],
    );
    return;
  }
  await mutateLocalRegistry((assets) => {
    const index = assets.findIndex((item) => item.id === assetId);
    if (index >= 0) assets[index] = { ...assets[index], storageStatus: 'delete_pending', deletedAt, updatedAt: deletedAt };
  });
};

export const requestStoredAssetDeletion = async ({
  pool = null,
  asset,
  reason = 'unspecified',
  isReferenced = false,
  env = process.env,
  timestamp = now(),
  deps = {},
} = {}) => {
  const assetId = String(asset?.id || '').trim();
  if (!assetId || !asset?.storageKey) return { queued: false, protected: false, assetId };
  if (isReferenced) return { queued: false, protected: true, assetId };
  if (asset.deletedAt || ['delete_pending', 'deleted'].includes(String(asset.storageStatus || ''))) {
    return { queued: false, protected: false, assetId };
  }
  const markDeletePending = deps.markDeletePending || markStoredAssetDeletePending;
  const enqueueCleanup = deps.enqueueCleanup || enqueueAssetCleanupTask;
  const deleteGraceMs = getStoredAssetDeleteGraceMs(env);
  const storageProvider = getStoredAssetStorageProvider(asset);
  const storageBucket = String(asset.storageBucket || '').trim();
  const storageRegion = String(asset.storageRegion || '').trim();
  if (storageProvider === 'tencent_cos' && (!storageBucket || !storageRegion)) {
    const error = new Error('腾讯 COS 素材缺少持久化 bucket/region 快照，已停止猜测删除目标');
    error.code = 'managed_asset_storage_snapshot_missing';
    throw error;
  }
  await markDeletePending(pool, assetId, timestamp);
  const task = {
    assetId,
    provider: storageProvider,
    bucket: storageProvider === 'tencent_cos' ? storageBucket : '',
    region: storageProvider === 'tencent_cos' ? storageRegion : '',
    storageKey: String(asset.storageKey),
    action: 'delete',
    reason: String(reason || 'unspecified'),
    nextAttemptAt: timestamp + deleteGraceMs,
  };
  await enqueueCleanup(pool, task);
  return { queued: true, protected: false, assetId, task };
};

export const deleteStoredAssetFile = async (storageKey) => {
  if (!storageKey) return;
  const fullPath = path.join(ASSET_DIR, storageKey);
  if (existsSync(fullPath)) {
    unlinkSync(fullPath);
  }
};

const createManagedAssetEmptyError = () => {
  const error = new Error('托管素材不能为空');
  error.code = 'managed_asset_empty';
  error.providerStage = 'asset_persist';
  error.providerStatus = 'empty';
  return error;
};

const getAssetBufferSize = (value) => {
  if (Buffer.isBuffer(value)) return value.length;
  if (value instanceof Uint8Array) return value.byteLength;
  return 0;
};

export const persistAssetBuffer = async ({
  pool = null,
  publicBaseUrl,
  userId,
  module = 'system',
  assetType = 'source',
  originalName = 'upload.bin',
  mimeType = 'application/octet-stream',
  fileBuffer,
  width = 0,
  height = 0,
  provider = 'internal',
  providerSourceUrl = '',
  jobId = '',
  expiresAt,
  deps = {},
}) => {
  const createdAt = (deps.now || now)();
  const storedBuffer = shouldOptimizeMp4({ mimeType, originalName })
    ? optimizeMp4BufferForStreaming(fileBuffer)
    : fileBuffer;
  if (getAssetBufferSize(storedBuffer) === 0) throw createManagedAssetEmptyError();
  const id = (deps.createId || (() => randomBytes(12).toString('hex')))();
  const safeName = sanitizeAssetName(originalName);
  const extension = path.extname(safeName);
  const relativeDir = path.join(String(userId || 'anonymous'), assetType, `${createdAt}`);
  const storageKey = path.join(relativeDir, `${id}${extension || ''}`);
  const fullPath = path.join(deps.assetDir || ASSET_DIR, storageKey);
  const openFile = deps.openFile || fs.open;
  const unlinkFile = deps.unlinkFile || fs.unlink;
  let createdDestination = false;
  let destinationHandle = null;

  try {
    ensureDir(path.dirname(fullPath));
    destinationHandle = await openFile(fullPath, 'wx');
    createdDestination = true;
    await destinationHandle.writeFile(storedBuffer);
    await destinationHandle.close();
    destinationHandle = null;
    const record = {
    id,
    userId: String(userId || ''),
    module: String(module || 'system').slice(0, 60),
    assetType: String(assetType || 'source').slice(0, 20),
    storageKey: storageKey.replace(/\\/g, '/'),
    storageBucket: '',
    storageRegion: '',
    originalName: safeName,
    mimeType: String(mimeType || 'application/octet-stream'),
    fileSize: storedBuffer?.length || 0,
    contentHash: createHash('sha256').update(storedBuffer || Buffer.alloc(0)).digest('hex'),
    width: Number(width || 0),
    height: Number(height || 0),
    provider: String(provider || 'internal').slice(0, 40),
    storageStatus: 'active',
    providerSourceUrl: String(providerSourceUrl || ''),
    jobId: String(jobId || ''),
    publicUrl: buildAssetPublicUrl(publicBaseUrl, id, safeName),
    createdAt,
    updatedAt: createdAt,
    lastAccessedAt: createdAt,
    expiresAt: normalizeAssetExpiresAt({ expiresAt, module, createdAt }),
    deletedAt: null,
    };

    await createAssetRecord(pool, record);
    return record;
  } catch (error) {
    if (destinationHandle) {
      try {
        await destinationHandle.close();
      } catch (cleanupError) {
        appendCleanupDiagnostic(error, 'close', cleanupError);
      }
    }
    if (createdDestination) await cleanupOwnedPath(error, fullPath, unlinkFile);
    throw error;
  }
};

export const persistAssetFile = async ({
  pool = null,
  publicBaseUrl,
  userId,
  module = 'system',
  assetType = 'source',
  originalName = 'upload.bin',
  mimeType = 'application/octet-stream',
  sourcePath,
  width = 0,
  height = 0,
  provider = 'internal',
  providerSourceUrl = '',
  jobId = '',
  expiresAt,
  expectedSha256 = '',
  deps = {},
}) => {
  const createdAt = (deps.now || now)();
  const id = (deps.createId || (() => randomBytes(12).toString('hex')))();
  const safeName = sanitizeAssetName(originalName);
  const extension = path.extname(safeName);
  const relativeDir = path.join(String(userId || 'anonymous'), String(assetType || 'source'), `${createdAt}`);
  const storageKey = path.join(relativeDir, `${id}${extension || ''}`);
  const fullPath = path.join(deps.assetDir || ASSET_DIR, storageKey);
  const hash = createHash('sha256');
  let fileSize = 0;
  let createdDestination = false;
  const unlinkFile = deps.unlinkFile || fs.unlink;

  try {
    ensureDir(path.dirname(fullPath));
    const source = createReadStream(String(sourcePath || ''));
    source.on('data', (chunk) => {
      hash.update(chunk);
      fileSize += chunk.length;
    });
    const destination = createWriteStream(fullPath, { flags: 'wx' });
    destination.once('open', () => {
      createdDestination = true;
    });
    await pipeline(source, destination);
    if (fileSize === 0) throw createManagedAssetEmptyError();
    const contentHash = hash.digest('hex');
    const normalizedExpectedHash = String(expectedSha256 || '').trim().toLowerCase();
    if (normalizedExpectedHash && contentHash !== normalizedExpectedHash) {
      const error = new Error('托管素材内容校验失败');
      error.code = 'managed_asset_hash_mismatch';
      throw error;
    }
    const record = {
      id,
      userId: String(userId || ''),
      module: String(module || 'system').slice(0, 60),
      assetType: String(assetType || 'source').slice(0, 20),
      storageKey: storageKey.replace(/\\/g, '/'),
      storageBucket: '',
      storageRegion: '',
      originalName: safeName,
      mimeType: String(mimeType || 'application/octet-stream'),
      fileSize,
      contentHash,
      width: Number(width || 0),
      height: Number(height || 0),
      provider: String(provider || 'internal').slice(0, 40),
      storageStatus: 'active',
      providerSourceUrl: String(providerSourceUrl || ''),
      jobId: String(jobId || ''),
      publicUrl: buildAssetPublicUrl(publicBaseUrl, id, safeName),
      createdAt,
      updatedAt: createdAt,
      lastAccessedAt: createdAt,
      expiresAt: normalizeAssetExpiresAt({ expiresAt, module, createdAt }),
      deletedAt: null,
    };
    await createAssetRecord(pool, record);
    return record;
  } catch (error) {
    if (createdDestination) await cleanupOwnedPath(error, fullPath, unlinkFile);
    throw error;
  }
};

const createManagedImageUploadDisabledError = () => {
  const error = new Error('图片上传暂时停用，请稍后重试');
  error.code = 'managed_image_upload_disabled';
  error.providerStage = 'asset_upload';
  error.providerStatus = 'disabled';
  error.retryable = true;
  return error;
};

const createLocalManagedImageUploadForbiddenError = (reason) => {
  const error = new Error('本地图片存储仅允许在非生产的本机或内网环境使用');
  error.code = 'managed_image_local_mode_forbidden';
  error.statusCode = 503;
  error.providerStage = 'asset_upload';
  error.providerStatus = String(reason || 'forbidden');
  error.retryable = false;
  return error;
};

export const persistUploadedAssetBuffer = async ({
  pool = null,
  publicBaseUrl = '',
  userId,
  module = 'system',
  assetType = 'source',
  originalName = 'upload.bin',
  mimeType = 'application/octet-stream',
  fileBuffer,
  width = 0,
  height = 0,
  env = process.env,
  signal = null,
  deps = {},
}) => {
  let normalizedMimeType = String(mimeType || 'application/octet-stream').trim().toLowerCase();
  const persistLocal = deps.persistLocal || persistAssetBuffer;
  const normalizedAssetType = String(assetType || 'source').trim().toLowerCase();
  if (!ACCEPTED_UPLOAD_ASSET_TYPES.has(normalizedAssetType)) {
    const error = new Error('上传素材类型无效');
    error.code = 'managed_asset_type_invalid';
    error.statusCode = 400;
    throw error;
  }
  const managedImage = COS_MANAGED_IMAGE_ASSET_TYPES.has(normalizedAssetType)
    ? resolveManagedImageUpload({ fileBuffer, mimeType: normalizedMimeType, env })
    : { isImage: false, mimeType: normalizedMimeType };
  normalizedMimeType = managedImage.mimeType;
  const normalizedOriginalName = managedImage.isImage
    ? normalizeManagedImageAssetName(originalName, normalizedMimeType)
    : originalName;
  if (!managedImage.isImage) {
    return persistLocal({
      pool,
      publicBaseUrl,
      userId,
      module,
      assetType,
      originalName: normalizedOriginalName,
      mimeType: normalizedMimeType,
      fileBuffer,
      width,
      height,
      provider: 'internal',
    });
  }

  const uploadMode = normalizeManagedImageUploadMode(env);
  if (uploadMode === 'local') {
    const localMode = resolveLocalManagedImageUpload({ env, publicBaseUrl });
    if (!localMode.allowed) throw createLocalManagedImageUploadForbiddenError(localMode.reason);
    return persistLocal({
      pool,
      publicBaseUrl,
      userId,
      module,
      assetType,
      originalName: normalizedOriginalName,
      mimeType: normalizedMimeType,
      fileBuffer,
      width,
      height,
      provider: 'internal',
    });
  }
  if (uploadMode !== 'cos') throw createManagedImageUploadDisabledError();

  const createdAt = now();
  const id = randomBytes(12).toString('hex');
  const safeName = sanitizeAssetName(normalizedOriginalName);
  const storageKey = buildCosImageObjectKey({
    userId,
    assetType,
    assetId: id,
    fileName: safeName,
    mimeType: normalizedMimeType,
  });
  const storageBucket = String(env?.MEIAO_IMAGE_COS_BUCKET || '').trim();
  const storageRegion = String(env?.MEIAO_IMAGE_COS_REGION || '').trim();
  if (!storageBucket || !storageRegion) {
    const error = new Error('腾讯 COS 图片存储缺少 bucket 或 region 配置');
    error.code = 'provider_config_error';
    error.providerStage = 'asset_upload';
    error.providerStatus = 'config_error';
    throw error;
  }
  const record = {
    id,
    userId: String(userId || ''),
    module: String(module || 'system').slice(0, 60),
    assetType: String(assetType || 'source').slice(0, 20),
    storageKey,
    storageBucket,
    storageRegion,
    originalName: safeName,
    mimeType: normalizedMimeType,
    fileSize: Buffer.isBuffer(fileBuffer) ? fileBuffer.length : Buffer.byteLength(fileBuffer || ''),
    contentHash: createHash('sha256').update(fileBuffer || Buffer.alloc(0)).digest('hex'),
    width: Number(width || 0),
    height: Number(height || 0),
    provider: 'tencent_cos',
    storageStatus: 'uploading',
    providerSourceUrl: '',
    jobId: '',
    publicUrl: appendManagedAssetAccessKey(
      buildAssetPublicUrl(publicBaseUrl, id, safeName),
      { assetId: id, userId },
      env,
    ),
    createdAt,
    updatedAt: createdAt,
    lastAccessedAt: createdAt,
    expiresAt: getAssetExpiresAt({ module, createdAt }),
    deletedAt: null,
  };

  const createRecord = deps.createRecord || createAssetRecord;
  const markStatus = deps.markStatus || markStoredAssetStorageStatus;
  const putCos = deps.putCos || putTencentCosImage;
  const enqueueCleanup = deps.enqueueCleanup || enqueueAssetCleanupTask;
  await createRecord(pool, record);

  try {
    await putCos({
      storageKey,
      fileBuffer,
      mimeType: normalizedMimeType,
    }, env, signal, deps.cosOptions || {});
    const activeAt = now();
    await markStatus(pool, id, 'active', activeAt);
    return { ...record, storageStatus: 'active', updatedAt: activeAt };
  } catch (error) {
    const failedAt = now();
    const deleteGraceMs = getStoredAssetDeleteGraceMs(env);
    try {
      await markStatus(pool, id, 'upload_failed', failedAt);
    } catch {
      // The durable exact-key cleanup below is still attempted even if the status update failed.
    }
    await enqueueCleanup(pool, {
      assetId: id,
      provider: 'tencent_cos',
      bucket: record.storageBucket,
      region: record.storageRegion,
      storageKey,
      action: 'delete',
      reason: 'upload_failed',
      nextAttemptAt: failedAt + deleteGraceMs,
    });
    throw error;
  }
};

const createInlineImageResultError = () => {
  const error = new Error('图片生成服务返回了无法安全保存的内联图片');
  error.code = 'provider_bad_response';
  error.providerMessage = error.message;
  error.providerStage = 'provider_response';
  error.providerStatus = 'failed';
  return error;
};

const buildInlineImageAssetName = (originalName, mimeType) => {
  const fallback = String(originalName || 'result.png').trim() || 'result.png';
  const currentExtension = path.extname(fallback);
  const extension = `.${inferExtensionFromMimeType(mimeType)}`;
  return currentExtension
    ? `${fallback.slice(0, -currentExtension.length)}${extension}`
    : `${fallback}${extension}`;
};

export const persistInlineImageResult = async ({
  result = {},
  persistAsset = persistAssetBuffer,
  persistOptions = {},
  transformImage,
} = {}) => {
  const nextResult = { ...(result || {}) };
  const imageUrl = String(nextResult.imageUrl || '').trim();
  if (!/^data:image\//i.test(imageUrl)) return nextResult;

  const parsed = parseDataUrlPayload(imageUrl);
  if (!parsed?.mimeType?.toLowerCase().startsWith('image/') || !parsed.base64Data) {
    throw createInlineImageResultError();
  }
  const fileBuffer = Buffer.from(parsed.base64Data, 'base64');
  if (fileBuffer.length === 0 || typeof persistAsset !== 'function') {
    throw createInlineImageResultError();
  }

  const transformed = typeof transformImage === 'function'
    ? await transformImage({ fileBuffer, mimeType: parsed.mimeType })
    : null;
  const persistedBuffer = Buffer.isBuffer(transformed?.fileBuffer) ? transformed.fileBuffer : fileBuffer;
  const persistedMimeType = String(transformed?.mimeType || parsed.mimeType).trim() || parsed.mimeType;
  const persistedOriginalName = String(transformed?.originalName || '').trim()
    || buildInlineImageAssetName(persistOptions.originalName, persistedMimeType);

  const persisted = await persistAsset({
    ...persistOptions,
    ...(transformed?.assetType ? { assetType: transformed.assetType } : {}),
    originalName: persistedOriginalName,
    mimeType: persistedMimeType,
    fileBuffer: persistedBuffer,
    ...(Number(transformed?.width) > 0 ? { width: Number(transformed.width) } : {}),
    ...(Number(transformed?.height) > 0 ? { height: Number(transformed.height) } : {}),
    providerSourceUrl: '',
  });
  const publicUrl = String(persisted?.publicUrl || '').trim();
  if (!publicUrl) throw createInlineImageResultError();

  nextResult.imageUrl = publicUrl;
  nextResult.imageUrlAssetId = String(persisted?.id || '').trim();
  if (transformed?.outputTransform && typeof transformed.outputTransform === 'object') {
    nextResult.imageOutputTransform = transformed.outputTransform;
  }
  return nextResult;
};

export const persistRemoteAsset = async ({
  pool = null,
  publicBaseUrl,
  userId,
  module = 'system',
  assetType = 'result',
  remoteUrl,
  originalName = '',
  mimeType = '',
  provider = 'kie',
  jobId = '',
  expiresAt,
  deps = {},
}) => {
  const downloadRemoteAsset = deps.downloadRemoteAsset || fetchRemoteAssetBufferWithRetry;
  const persistAsset = deps.persistAsset || persistAssetBuffer;
  const downloaded = await downloadRemoteAsset(remoteUrl);
  if (getAssetBufferSize(downloaded?.fileBuffer) === 0) throw createManagedAssetEmptyError();
  const contentType = mimeType || downloaded.contentType;
  return persistAsset({
    pool,
    publicBaseUrl,
    userId,
    module,
    assetType,
    originalName: originalName || `result_${Date.now()}`,
    mimeType: contentType,
    fileBuffer: downloaded.fileBuffer,
    provider,
    providerSourceUrl: remoteUrl,
    jobId,
    expiresAt,
  });
};

export const resolveStoredAssetPath = (asset) => {
  if (!asset?.storageKey) return '';
  return path.join(ASSET_DIR, asset.storageKey);
};
