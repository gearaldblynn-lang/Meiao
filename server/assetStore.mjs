import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const ASSET_RETENTION_MS = 1000 * 60 * 60 * 24 * 3;
const ASSET_DIR = path.join(__dirname, 'data', 'assets');
const LOCAL_REGISTRY_PATH = path.join(__dirname, 'data', 'asset-registry.json');

const ensureDir = (dirPath) => {
  mkdirSync(dirPath, { recursive: true });
};

const now = () => Date.now();
const MP4_CONTAINER_ATOMS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'edts', 'dinf']);

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

const mapAssetRow = (row) => ({
  id: String(row.id),
  userId: String(row.user_id || ''),
  module: String(row.module || 'system'),
  assetType: String(row.asset_type || 'source'),
  storageKey: String(row.storage_key || ''),
  originalName: String(row.original_name || ''),
  mimeType: String(row.mime_type || 'application/octet-stream'),
  fileSize: Number(row.file_size || 0),
  width: Number(row.width || 0),
  height: Number(row.height || 0),
  provider: String(row.provider || 'internal'),
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

const readLocalRegistry = () => {
  ensureLocalRegistry();
  try {
    const parsed = JSON.parse(readFileSync(LOCAL_REGISTRY_PATH, 'utf8'));
    return Array.isArray(parsed.assets) ? parsed.assets : [];
  } catch {
    return [];
  }
};

const writeLocalRegistry = (assets) => {
  ensureLocalRegistry();
  writeFileSync(LOCAL_REGISTRY_PATH, JSON.stringify({ assets }, null, 2), 'utf8');
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
      original_name VARCHAR(255) NOT NULL,
      mime_type VARCHAR(120) NOT NULL,
      file_size BIGINT NOT NULL DEFAULT 0,
      width INT NOT NULL DEFAULT 0,
      height INT NOT NULL DEFAULT 0,
      provider VARCHAR(40) NOT NULL DEFAULT 'internal',
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
};

const createAssetRecord = async (pool, record) => {
  if (pool) {
    await pool.query(
      `INSERT INTO stored_assets (
        id, user_id, module, asset_type, storage_key, original_name, mime_type,
        file_size, width, height, provider, provider_source_url, job_id, public_url,
        created_at, updated_at, last_accessed_at, expires_at, deleted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        record.id,
        record.userId,
        record.module,
        record.assetType,
        record.storageKey,
        record.originalName,
        record.mimeType,
        record.fileSize,
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
      ]
    );
    return record;
  }

  const assets = readLocalRegistry();
  assets.push(record);
  writeLocalRegistry(assets);
  return record;
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

export const markStoredAssetAccessed = async (pool, assetId, touchedAt = now()) => {
  if (!assetId) return;
  if (pool) {
    await pool.query('UPDATE stored_assets SET last_accessed_at = ?, updated_at = ? WHERE id = ?', [touchedAt, touchedAt, assetId]);
    return;
  }
  const assets = readLocalRegistry();
  const next = assets.map((item) => item.id === assetId ? { ...item, lastAccessedAt: touchedAt, updatedAt: touchedAt } : item);
  writeLocalRegistry(next);
};

export const markStoredAssetDeleted = async (pool, assetId, deletedAt = now()) => {
  if (!assetId) return;
  if (pool) {
    await pool.query('UPDATE stored_assets SET deleted_at = ?, updated_at = ? WHERE id = ?', [deletedAt, deletedAt, assetId]);
    return;
  }
  const assets = readLocalRegistry();
  const next = assets.map((item) => item.id === assetId ? { ...item, deletedAt, updatedAt: deletedAt } : item);
  writeLocalRegistry(next);
};

export const deleteStoredAssetFile = async (storageKey) => {
  if (!storageKey) return;
  const fullPath = path.join(ASSET_DIR, storageKey);
  if (existsSync(fullPath)) {
    unlinkSync(fullPath);
  }
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
}) => {
  const createdAt = now();
  const storedBuffer = shouldOptimizeMp4({ mimeType, originalName })
    ? optimizeMp4BufferForStreaming(fileBuffer)
    : fileBuffer;
  const id = randomBytes(12).toString('hex');
  const safeName = sanitizeAssetName(originalName);
  const extension = path.extname(safeName);
  const relativeDir = path.join(String(userId || 'anonymous'), assetType, `${createdAt}`);
  const storageKey = path.join(relativeDir, `${id}${extension || ''}`);
  const fullPath = path.join(ASSET_DIR, storageKey);

  ensureDir(path.dirname(fullPath));
  await fs.writeFile(fullPath, storedBuffer);

  const record = {
    id,
    userId: String(userId || ''),
    module: String(module || 'system').slice(0, 60),
    assetType: String(assetType || 'source').slice(0, 20),
    storageKey: storageKey.replace(/\\/g, '/'),
    originalName: safeName,
    mimeType: String(mimeType || 'application/octet-stream'),
    fileSize: storedBuffer?.length || 0,
    width: Number(width || 0),
    height: Number(height || 0),
    provider: String(provider || 'internal').slice(0, 40),
    providerSourceUrl: String(providerSourceUrl || ''),
    jobId: String(jobId || ''),
    publicUrl: buildAssetPublicUrl(publicBaseUrl, id, safeName),
    createdAt,
    updatedAt: createdAt,
    lastAccessedAt: createdAt,
    expiresAt: createdAt + ASSET_RETENTION_MS,
    deletedAt: null,
  };

  await createAssetRecord(pool, record);
  return record;
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
}) => {
  const response = await fetch(remoteUrl);
  if (!response.ok) {
    throw new Error(`结果资源抓取失败: HTTP ${response.status}`);
  }
  const contentType = mimeType || response.headers.get('content-type') || 'application/octet-stream';
  const fileBuffer = Buffer.from(await response.arrayBuffer());
  return persistAssetBuffer({
    pool,
    publicBaseUrl,
    userId,
    module,
    assetType,
    originalName: originalName || `result_${Date.now()}`,
    mimeType: contentType,
    fileBuffer,
    provider,
    providerSourceUrl: remoteUrl,
    jobId,
  });
};

export const resolveStoredAssetPath = (asset) => {
  if (!asset?.storageKey) return '';
  return path.join(ASSET_DIR, asset.storageKey);
};
