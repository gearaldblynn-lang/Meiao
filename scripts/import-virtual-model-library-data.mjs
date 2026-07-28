#!/usr/bin/env node

import { createHash, randomBytes } from 'node:crypto';
import {
  constants as fsConstants,
  copyFile,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  stat,
  unlink,
} from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const TARGET_CODES = new Set(['004', '005']);
const EXPECTED_PACKAGE_COUNTS = Object.freeze({
  models: 5,
  versions: 5,
  relations: 40,
  registry: 80,
  files: 80,
});

const createImporterError = (code, message, details = {}) => {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
};

const sha256Buffer = (buffer) => createHash('sha256').update(buffer).digest('hex');

const sha256File = async (filePath) => {
  const contents = await readFile(filePath);
  return {
    size: contents.length,
    sha256: sha256Buffer(contents),
  };
};

const pathExists = async (filePath) => {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
};

const normalizeStorageKey = (value) => {
  const storageKey = String(value || '').trim().replaceAll('\\', '/');
  if (
    !storageKey
    || path.posix.isAbsolute(storageKey)
    || storageKey.startsWith('../')
    || storageKey.includes('/../')
    || path.posix.normalize(storageKey) !== storageKey
  ) {
    throw createImporterError(
      'package_storage_key_invalid',
      '迁移包包含不安全的 storageKey',
      { storageKey },
    );
  }
  return storageKey;
};

const resolveInside = (root, storageKey) => {
  const normalizedRoot = path.resolve(root);
  const candidate = path.resolve(normalizedRoot, normalizeStorageKey(storageKey));
  if (candidate !== normalizedRoot && !candidate.startsWith(`${normalizedRoot}${path.sep}`)) {
    throw createImporterError(
      'package_storage_key_invalid',
      '迁移包 storageKey 越出目标素材目录',
      { storageKey },
    );
  }
  return candidate;
};

const readJsonFile = async (filePath, code) => {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    throw createImporterError(code, `无法读取 JSON: ${path.basename(filePath)}`, {
      causeCode: String(error?.code || ''),
    });
  }
};

const resolvePackageDataRoot = async (packagePath) => {
  const requested = path.resolve(String(packagePath || '').trim());
  if (!String(packagePath || '').trim()) {
    throw createImporterError('package_path_required', '必须显式提供迁移包路径');
  }
  const candidates = [
    requested,
    path.join(requested, '02-当前模特数据'),
  ];
  for (const candidate of candidates) {
    if (await pathExists(path.join(candidate, 'export', 'library-data.json'))) {
      return candidate;
    }
  }
  throw createImporterError(
    'package_layout_invalid',
    '迁移包缺少 02-当前模特数据/export/library-data.json',
  );
};

const parseChecksumManifest = (text) => {
  const result = new Map();
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const match = line.match(/^([a-f0-9]{64})\s+\*?(.+)$/i);
    if (!match) {
      throw createImporterError('package_manifest_invalid', 'checksums.sha256 格式错误');
    }
    const relativePath = match[2].replaceAll('\\', '/').replace(/^\.?\//, '');
    const storageKey = normalizeStorageKey(relativePath.replace(/^assets\//, ''));
    if (result.has(storageKey)) {
      throw createImporterError('package_manifest_invalid', 'checksums.sha256 存在重复路径', {
        storageKey,
      });
    }
    result.set(storageKey, match[1].toLowerCase());
  }
  return result;
};

const parseCsvRows = (text) => {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const source = String(text || '').replace(/\r\n/g, '\n');
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\n') {
      row.push(cell);
      if (row.some((value) => value !== '')) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }
  if (quoted) throw createImporterError('package_manifest_invalid', 'catalog.csv 引号未闭合');
  row.push(cell);
  if (row.some((value) => value !== '')) rows.push(row);
  return rows;
};

const parseCatalog = (text) => {
  const rows = parseCsvRows(text);
  const header = rows.shift() || [];
  const indexes = Object.fromEntries(header.map((value, index) => [value, index]));
  for (const required of ['storageKey', 'fileSize', 'sha256']) {
    if (!Number.isInteger(indexes[required])) {
      throw createImporterError('package_manifest_invalid', `catalog.csv 缺少 ${required}`);
    }
  }
  const result = new Map();
  for (const row of rows) {
    const storageKey = normalizeStorageKey(row[indexes.storageKey]);
    if (result.has(storageKey)) {
      throw createImporterError('package_manifest_invalid', 'catalog.csv 存在重复路径', {
        storageKey,
      });
    }
    result.set(storageKey, {
      size: Number(row[indexes.fileSize]),
      sha256: String(row[indexes.sha256] || '').toLowerCase(),
    });
  }
  return result;
};

const assertPackageShape = (libraryData, manifest) => {
  const arrays = {
    models: libraryData?.virtualModels,
    versions: libraryData?.virtualModelVersions,
    relations: libraryData?.virtualModelAssets,
    registry: libraryData?.assetRegistryRecords,
  };
  if (libraryData?.schemaVersion !== 1) {
    throw createImporterError('package_schema_unsupported', '仅支持 schemaVersion=1 的模特库迁移包');
  }
  for (const [name, value] of Object.entries(arrays)) {
    if (!Array.isArray(value) || value.length !== EXPECTED_PACKAGE_COUNTS[name]) {
      throw createImporterError('package_shape_invalid', `迁移包 ${name} 数量不符合完整库合同`, {
        expected: EXPECTED_PACKAGE_COUNTS[name],
        actual: Array.isArray(value) ? value.length : null,
      });
    }
  }
  if (!Array.isArray(manifest) || manifest.length !== EXPECTED_PACKAGE_COUNTS.files) {
    throw createImporterError('package_shape_invalid', '迁移包素材清单必须包含 80 个文件');
  }
  const codes = new Set(libraryData.virtualModels.map((model) => String(model?.code || '')));
  if (![...TARGET_CODES].every((code) => codes.has(code))) {
    throw createImporterError('package_shape_invalid', '迁移包缺少 004/005 模特');
  }
};

export const loadAndValidatePackage = async (packagePath) => {
  const dataRoot = await resolvePackageDataRoot(packagePath);
  const libraryPath = path.join(dataRoot, 'export', 'library-data.json');
  const manifestJsonPath = path.join(dataRoot, 'manifest', 'assets.sha256.json');
  const checksumsPath = path.join(dataRoot, 'manifest', 'checksums.sha256');
  const catalogPath = path.join(dataRoot, 'manifest', 'catalog.csv');
  const assetsRoot = path.join(dataRoot, 'assets');
  const [libraryData, manifest, checksumsText, catalogText] = await Promise.all([
    readJsonFile(libraryPath, 'package_library_data_invalid'),
    readJsonFile(manifestJsonPath, 'package_manifest_invalid'),
    readFile(checksumsPath, 'utf8').catch(() => {
      throw createImporterError('package_manifest_invalid', '迁移包缺少 checksums.sha256');
    }),
    readFile(catalogPath, 'utf8').catch(() => {
      throw createImporterError('package_manifest_invalid', '迁移包缺少 catalog.csv');
    }),
  ]);
  assertPackageShape(libraryData, manifest);

  const checksumMap = parseChecksumManifest(checksumsText);
  const catalogMap = parseCatalog(catalogText);
  if (
    checksumMap.size !== EXPECTED_PACKAGE_COUNTS.files
    || catalogMap.size !== EXPECTED_PACKAGE_COUNTS.files
  ) {
    throw createImporterError('package_manifest_invalid', '迁移包三个素材清单必须各包含 80 个唯一文件');
  }

  const registryByStorageKey = new Map();
  for (const record of libraryData.assetRegistryRecords) {
    const storageKey = normalizeStorageKey(record?.storageKey);
    if (registryByStorageKey.has(storageKey)) {
      throw createImporterError('package_manifest_invalid', 'asset registry 存在重复 storageKey', {
        storageKey,
      });
    }
    registryByStorageKey.set(storageKey, record);
  }

  const seen = new Set();
  const normalizedManifest = [];
  for (const raw of manifest) {
    const storageKey = normalizeStorageKey(raw?.storageKey);
    const expected = {
      storageKey,
      size: Number(raw?.size),
      sha256: String(raw?.sha256 || '').toLowerCase(),
    };
    if (
      seen.has(storageKey)
      || !Number.isSafeInteger(expected.size)
      || expected.size < 0
      || !/^[a-f0-9]{64}$/.test(expected.sha256)
    ) {
      throw createImporterError('package_manifest_invalid', 'assets.sha256.json 包含非法或重复记录', {
        storageKey,
      });
    }
    seen.add(storageKey);
    const catalogRecord = catalogMap.get(storageKey);
    if (
      checksumMap.get(storageKey) !== expected.sha256
      || catalogRecord?.sha256 !== expected.sha256
      || catalogRecord?.size !== expected.size
      || !registryByStorageKey.has(storageKey)
    ) {
      throw createImporterError('package_manifest_invalid', '迁移包素材清单彼此不一致', {
        storageKey,
      });
    }
    const sourcePath = resolveInside(assetsRoot, storageKey);
    let actual;
    try {
      actual = await sha256File(sourcePath);
    } catch (error) {
      if (error?.code === 'ENOENT') {
        throw createImporterError('package_asset_missing', '迁移包素材文件不存在', { storageKey });
      }
      throw error;
    }
    if (actual.size !== expected.size || actual.sha256 !== expected.sha256) {
      throw createImporterError('package_checksum_mismatch', '迁移包素材 checksum 校验失败', {
        storageKey,
      });
    }
    normalizedManifest.push({ ...expected, sourcePath });
  }
  return {
    packagePath: path.resolve(String(packagePath)),
    dataRoot,
    assetsRoot,
    libraryData,
    manifest: normalizedManifest,
  };
};

const normalizePublicBaseUrl = (value) => String(value || '').trim().replace(/\/+$/, '');

const buildPublicUrl = (publicBaseUrl, assetId, originalName) => (
  `${normalizePublicBaseUrl(publicBaseUrl)}/api/assets/file/${encodeURIComponent(String(assetId || ''))}/${encodeURIComponent(String(originalName || 'asset.bin').trim() || 'asset.bin')}`
);

export const rewriteLibraryPublicUrls = (libraryData, { publicBaseUrl = '' } = {}) => {
  const rewritten = structuredClone(libraryData || {});
  const registry = Array.isArray(rewritten.assetRegistryRecords)
    ? rewritten.assetRegistryRecords
    : [];
  const registryById = new Map(registry.map((record) => [String(record.id), record]));
  rewritten.assetRegistryRecords = registry.map((record) => ({
    ...record,
    publicUrl: buildPublicUrl(publicBaseUrl, record.id, record.originalName),
  }));
  rewritten.virtualModelAssets = (Array.isArray(rewritten.virtualModelAssets)
    ? rewritten.virtualModelAssets
    : []
  ).map((relation) => {
    const source = registryById.get(String(relation.assetId));
    const preview = registryById.get(String(relation.previewAssetId));
    if (!source || !preview) {
      throw createImporterError(
        'package_relation_asset_missing',
        '模特槽位引用了不在 asset registry 中的素材',
        { relationId: String(relation.id || '') },
      );
    }
    return {
      ...relation,
      publicUrl: buildPublicUrl(publicBaseUrl, source.id, source.originalName),
      previewUrl: buildPublicUrl(publicBaseUrl, preview.id, preview.originalName),
    };
  });
  return rewritten;
};

const canonicalModel = (row = {}) => ({
  id: String(row.id || ''),
  code: String(row.code || ''),
  name: String(row.name || ''),
  tags: Array.isArray(row.tags)
    ? row.tags
    : (() => {
        try {
          return JSON.parse(row.tags_json || '[]');
        } catch {
          return [];
        }
      })(),
  status: String(row.status || ''),
  currentVersionId: row.currentVersionId ?? row.current_version_id ?? null,
  createdAt: Number(row.createdAt ?? row.created_at ?? 0),
  updatedAt: Number(row.updatedAt ?? row.updated_at ?? 0),
});

const canonicalVersion = (row = {}) => ({
  id: String(row.id || ''),
  virtualModelId: String(row.virtualModelId ?? row.virtual_model_id ?? ''),
  versionNumber: Number(row.versionNumber ?? row.version_number ?? 0),
  identityProfile: row.identityProfile ?? (() => {
    try {
      return JSON.parse(row.identity_profile_json || '{}');
    } catch {
      return {};
    }
  })(),
  status: String(row.status || ''),
  publishedAt: row.publishedAt ?? row.published_at ?? null,
  createdBy: row.createdBy ?? row.created_by ?? null,
  createdAt: Number(row.createdAt ?? row.created_at ?? 0),
});

const canonicalRelation = (row = {}) => ({
  id: String(row.id || ''),
  virtualModelVersionId: String(row.virtualModelVersionId ?? row.virtual_model_version_id ?? ''),
  slot: String(row.slot || ''),
  assetId: String(row.assetId ?? row.asset_id ?? ''),
  publicUrl: String(row.publicUrl ?? row.public_url ?? ''),
  previewAssetId: String(row.previewAssetId ?? row.preview_asset_id ?? ''),
  previewUrl: String(row.previewUrl ?? row.preview_url ?? ''),
  position: Number(row.position || 0),
  isPrimary: Boolean(row.isPrimary ?? row.is_primary),
  validationStatus: String(row.validationStatus ?? row.validation_status ?? ''),
  createdAt: Number(row.createdAt ?? row.created_at ?? 0),
});

const canonicalRegistry = (row = {}) => ({
  id: String(row.id || ''),
  userId: String(row.userId ?? row.user_id ?? ''),
  module: String(row.module || ''),
  assetType: String(row.assetType ?? row.asset_type ?? ''),
  storageKey: String(row.storageKey ?? row.storage_key ?? ''),
  storageBucket: String(row.storageBucket ?? row.storage_bucket ?? ''),
  storageRegion: String(row.storageRegion ?? row.storage_region ?? ''),
  originalName: String(row.originalName ?? row.original_name ?? ''),
  mimeType: String(row.mimeType ?? row.mime_type ?? ''),
  fileSize: Number(row.fileSize ?? row.file_size ?? 0),
  contentHash: String(row.contentHash ?? row.content_hash ?? ''),
  width: Number(row.width || 0),
  height: Number(row.height || 0),
  provider: String(row.provider || ''),
  storageStatus: String(row.storageStatus ?? row.storage_status ?? 'active'),
  providerSourceUrl: String(row.providerSourceUrl ?? row.provider_source_url ?? ''),
  jobId: String(row.jobId ?? row.job_id ?? ''),
  publicUrl: String(row.publicUrl ?? row.public_url ?? ''),
  createdAt: Number(row.createdAt ?? row.created_at ?? 0),
  updatedAt: Number(row.updatedAt ?? row.updated_at ?? 0),
  lastAccessedAt: Number(row.lastAccessedAt ?? row.last_accessed_at ?? 0),
  expiresAt: Number(row.expiresAt ?? row.expires_at ?? 0),
  deletedAt: row.deletedAt ?? row.deleted_at ?? null,
});

const stableValue = (value) => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, stableValue(child)]),
    );
  }
  return value;
};

const equalEntity = (left, right) => (
  JSON.stringify(stableValue(left)) === JSON.stringify(stableValue(right))
);

const planStableEntities = ({
  existing,
  incoming,
  canonical,
  entity,
  warnings,
}) => {
  const existingById = new Map(existing.map((row) => {
    const normalized = canonical(row);
    return [normalized.id, normalized];
  }));
  const additions = [];
  for (const row of incoming) {
    const normalized = canonical(row);
    const found = existingById.get(normalized.id);
    if (!found) {
      additions.push(normalized);
    } else if (!equalEntity(found, normalized)) {
      warnings.push({
        type: 'content_mismatch',
        entity,
        id: normalized.id,
        action: 'skipped_without_overwrite',
      });
    }
  }
  return additions;
};

const auditBaselineEntities = ({
  existing,
  incoming,
  canonical,
  entity,
  warnings,
}) => {
  const existingById = new Map(existing.map((row) => {
    const normalized = canonical(row);
    return [normalized.id, normalized];
  }));
  for (const row of incoming) {
    const normalized = canonical(row);
    const found = existingById.get(normalized.id);
    if (!found) {
      warnings.push({
        type: 'baseline_missing',
        entity,
        id: normalized.id,
        action: 'skipped_outside_import_scope',
      });
    } else if (!equalEntity(found, normalized)) {
      warnings.push({
        type: 'content_mismatch',
        entity,
        id: normalized.id,
        action: 'skipped_without_overwrite',
      });
    }
  }
};

const manifestByStorageKey = (manifest) => new Map(
  manifest.map((record) => [record.storageKey, record]),
);

export const buildImportPlan = ({
  libraryData,
  manifest,
  existingStore = {},
  existingRegistry = { assets: [] },
  publicBaseUrl = '',
  auditBaseline = true,
} = {}) => {
  const rewritten = rewriteLibraryPublicUrls(libraryData, { publicBaseUrl });
  const models = (rewritten.virtualModels || []).map(canonicalModel);
  const targetModels = models.filter((model) => TARGET_CODES.has(model.code));
  if (targetModels.length !== 2) {
    throw createImporterError('package_shape_invalid', '迁移包目标必须恰好是 004/005');
  }
  const existingModels = Array.isArray(existingStore.virtualModels)
    ? existingStore.virtualModels.map(canonicalModel)
    : [];
  for (const incoming of targetModels) {
    const conflict = existingModels.find((model) => (
      model.code === incoming.code
      && model.id !== incoming.id
      && model.status !== 'deleted'
    ));
    if (conflict) {
      throw createImporterError(
        'active_model_code_conflict',
        `活动模特 code ${incoming.code} 已被不同稳定 ID 占用`,
        { code: incoming.code, existingId: conflict.id, incomingId: incoming.id },
      );
    }
  }

  const targetModelIds = new Set(targetModels.map((model) => model.id));
  const targetVersions = (rewritten.virtualModelVersions || [])
    .map(canonicalVersion)
    .filter((version) => targetModelIds.has(version.virtualModelId));
  const targetVersionIds = new Set(targetVersions.map((version) => version.id));
  const targetRelations = (rewritten.virtualModelAssets || [])
    .map(canonicalRelation)
    .filter((relation) => targetVersionIds.has(relation.virtualModelVersionId));
  const targetRegistryIds = new Set(
    targetRelations.flatMap((relation) => [relation.assetId, relation.previewAssetId]),
  );
  const manifestMap = manifestByStorageKey(manifest || []);
  const allRegistry = (rewritten.assetRegistryRecords || [])
    .map((record) => {
      const normalized = canonicalRegistry(record);
      const checksum = manifestMap.get(normalized.storageKey);
      if (!checksum) {
        throw createImporterError('package_manifest_invalid', '目标 registry 素材缺少 checksum', {
          id: normalized.id,
        });
      }
      return {
        ...normalized,
        storageBucket: normalized.storageBucket || '',
        storageRegion: normalized.storageRegion || '',
        contentHash: checksum.sha256,
        storageStatus: normalized.storageStatus || 'active',
      };
    });
  const targetRegistry = allRegistry.filter((record) => targetRegistryIds.has(record.id));
  if (
    targetVersions.length !== 2
    || targetRelations.length !== 16
    || targetRegistry.length !== 32
  ) {
    throw createImporterError(
      'package_shape_invalid',
      '004/005 必须对应 2 versions、16 relations、32 registry/files',
    );
  }

  const existingVersions = Array.isArray(existingStore.virtualModelVersions)
    ? existingStore.virtualModelVersions.map(canonicalVersion)
    : [];
  const existingRelations = Array.isArray(existingStore.virtualModelAssets)
    ? existingStore.virtualModelAssets.map(canonicalRelation)
    : [];
  const existingAssets = Array.isArray(existingRegistry?.assets)
    ? existingRegistry.assets.map(canonicalRegistry)
    : [];

  for (const incoming of targetVersions) {
    const conflict = existingVersions.find((version) => (
      version.id !== incoming.id
      && version.virtualModelId === incoming.virtualModelId
      && version.versionNumber === incoming.versionNumber
    ));
    if (conflict) {
      throw createImporterError('version_number_conflict', '目标模特版本号已被不同稳定 ID 占用', {
        incomingId: incoming.id,
        existingId: conflict.id,
      });
    }
  }
  for (const incoming of targetRelations) {
    const conflict = existingRelations.find((relation) => (
      relation.id !== incoming.id
      && relation.virtualModelVersionId === incoming.virtualModelVersionId
      && relation.slot === incoming.slot
    ));
    if (conflict) {
      throw createImporterError('relation_slot_conflict', '目标模特槽位已被不同稳定 ID 占用', {
        incomingId: incoming.id,
        existingId: conflict.id,
      });
    }
  }

  const warnings = [];
  const baselineModels = models.filter((model) => ['001', '002', '003'].includes(model.code));
  const baselineModelIds = new Set(baselineModels.map((model) => model.id));
  const baselineVersions = (rewritten.virtualModelVersions || [])
    .map(canonicalVersion)
    .filter((version) => baselineModelIds.has(version.virtualModelId));
  const baselineVersionIds = new Set(baselineVersions.map((version) => version.id));
  const baselineRelations = (rewritten.virtualModelAssets || [])
    .map(canonicalRelation)
    .filter((relation) => baselineVersionIds.has(relation.virtualModelVersionId));
  const baselineRegistryIds = new Set(
    baselineRelations.flatMap((relation) => [relation.assetId, relation.previewAssetId]),
  );
  const baselineRegistry = allRegistry.filter((record) => baselineRegistryIds.has(record.id));
  if (auditBaseline) {
    for (const audit of [
      {
        existing: existingModels,
        incoming: baselineModels,
        canonical: canonicalModel,
        entity: 'virtual_model',
      },
      {
        existing: existingVersions,
        incoming: baselineVersions,
        canonical: canonicalVersion,
        entity: 'virtual_model_version',
      },
      {
        existing: existingRelations,
        incoming: baselineRelations,
        canonical: canonicalRelation,
        entity: 'virtual_model_asset',
      },
      {
        existing: existingAssets,
        incoming: baselineRegistry,
        canonical: canonicalRegistry,
        entity: 'stored_asset',
      },
    ]) {
      auditBaselineEntities({ ...audit, warnings });
    }
  }
  const additions = {
    models: planStableEntities({
      existing: existingModels,
      incoming: targetModels,
      canonical: canonicalModel,
      entity: 'virtual_model',
      warnings,
    }),
    versions: planStableEntities({
      existing: existingVersions,
      incoming: targetVersions,
      canonical: canonicalVersion,
      entity: 'virtual_model_version',
      warnings,
    }),
    relations: planStableEntities({
      existing: existingRelations,
      incoming: targetRelations,
      canonical: canonicalRelation,
      entity: 'virtual_model_asset',
      warnings,
    }),
    registry: planStableEntities({
      existing: existingAssets,
      incoming: targetRegistry,
      canonical: canonicalRegistry,
      entity: 'stored_asset',
      warnings,
    }),
  };
  const mismatchedRegistryIds = new Set(
    warnings
      .filter((warning) => warning.entity === 'stored_asset')
      .map((warning) => warning.id),
  );
  const exactExistingRegistryIds = new Set(existingAssets.map((asset) => asset.id));
  const fileRecords = targetRegistry.filter((record) => (
    !mismatchedRegistryIds.has(record.id)
    && (
      additions.registry.some((addition) => addition.id === record.id)
      || exactExistingRegistryIds.has(record.id)
    )
  ));
  return {
    rewrittenLibraryData: rewritten,
    additions,
    warnings,
    fileRecords,
  };
};

const createTempPath = (targetPath) => path.join(
  path.dirname(targetPath),
  `.${path.basename(targetPath)}.${randomBytes(8).toString('hex')}.tmp`,
);

const atomicWriteText = async (filePath, text) => {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = createTempPath(filePath);
  let handle;
  try {
    handle = await open(tempPath, 'wx');
    await handle.writeFile(text, 'utf8');
    await handle.sync();
    await handle.close();
    handle = null;
    await rename(tempPath, filePath);
  } catch (error) {
    if (handle) await handle.close().catch(() => null);
    await unlink(tempPath).catch(() => null);
    throw error;
  }
};

export const atomicWriteJson = async (filePath, value) => {
  await atomicWriteText(filePath, JSON.stringify(value, null, 2));
};

const readTargetJson = async (filePath, fallback, invalidCode) => {
  try {
    const raw = await readFile(filePath, 'utf8');
    return {
      value: JSON.parse(raw),
      raw,
      existed: true,
    };
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return {
        value: structuredClone(fallback),
        raw: JSON.stringify(fallback, null, 2),
        existed: false,
      };
    }
    throw createImporterError(invalidCode, `目标 JSON 无法安全读取: ${path.basename(filePath)}`, {
      causeCode: String(error?.code || ''),
    });
  }
};

const checkDestinationFiles = async ({ assetsDir, fileRecords, manifest }) => {
  const manifestMap = manifestByStorageKey(manifest);
  const missing = [];
  const skipped = [];
  for (const record of fileRecords) {
    const expected = manifestMap.get(record.storageKey);
    const destinationPath = resolveInside(assetsDir, record.storageKey);
    if (!await pathExists(destinationPath)) {
      missing.push({ record, expected, destinationPath });
      continue;
    }
    const actual = await sha256File(destinationPath);
    if (actual.size !== expected.size || actual.sha256 !== expected.sha256) {
      throw createImporterError(
        'target_file_checksum_conflict',
        '目标 storageKey 已存在不同内容，已拒绝覆盖',
        { storageKey: record.storageKey },
      );
    }
    skipped.push({ record, expected, destinationPath });
  }
  return { missing, skipped };
};

const timestampKey = (value) => new Date(value).toISOString().replace(/[:.]/g, '-');

const stageFiles = async ({ missing, stageRoot }) => {
  for (const item of missing) {
    const stagePath = resolveInside(stageRoot, item.record.storageKey);
    await mkdir(path.dirname(stagePath), { recursive: true });
    await copyFile(item.expected.sourcePath, stagePath, fsConstants.COPYFILE_EXCL);
    const staged = await sha256File(stagePath);
    if (staged.size !== item.expected.size || staged.sha256 !== item.expected.sha256) {
      throw createImporterError('staged_file_checksum_mismatch', '素材 staging 后 checksum 不一致', {
        storageKey: item.record.storageKey,
      });
    }
    item.stagePath = stagePath;
  }
};

const materializeStagedFiles = async (missing, createdFiles) => {
  for (const item of missing) {
    await mkdir(path.dirname(item.destinationPath), { recursive: true });
    try {
      await copyFile(item.stagePath, item.destinationPath, fsConstants.COPYFILE_EXCL);
      createdFiles.push(item.destinationPath);
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      const actual = await sha256File(item.destinationPath);
      if (actual.size !== item.expected.size || actual.sha256 !== item.expected.sha256) {
        throw createImporterError(
          'target_file_checksum_conflict',
          '目标 storageKey 在导入期间出现不同内容，已拒绝覆盖',
          { storageKey: item.record.storageKey },
        );
      }
    }
  }
};

const cleanupFiles = async (files) => {
  for (const filePath of [...files].reverse()) {
    await unlink(filePath).catch(() => null);
  }
};

const summaryFromPlan = ({
  mode,
  dryRun,
  loaded,
  plan,
  filePlan,
  backupDirectory = '',
}) => ({
  ok: true,
  mode,
  dryRun: Boolean(dryRun),
  validatedFiles: loaded.manifest.length,
  added: {
    models: plan.additions.models.length,
    versions: plan.additions.versions.length,
    relations: plan.additions.relations.length,
    registry: plan.additions.registry.length,
    files: filePlan.missing.length,
  },
  skipped: {
    files: filePlan.skipped.length,
  },
  warnings: plan.warnings,
  backupDirectory,
});

export const importLocalLibrary = async ({
  packagePath,
  storePath,
  registryPath,
  assetsDir,
  publicBaseUrl = '',
  dryRun = false,
  now = Date.now,
  writeJson = atomicWriteJson,
} = {}) => {
  for (const [name, value] of Object.entries({ storePath, registryPath, assetsDir })) {
    if (!String(value || '').trim()) {
      throw createImporterError('local_target_path_required', `local 模式必须显式提供 ${name}`);
    }
  }
  const loaded = await loadAndValidatePackage(packagePath);
  const [storeTarget, registryTarget] = await Promise.all([
    readTargetJson(storePath, {
      virtualModels: [],
      virtualModelVersions: [],
      virtualModelAssets: [],
    }, 'target_store_invalid'),
    readTargetJson(registryPath, { assets: [] }, 'target_registry_invalid'),
  ]);
  if (!Array.isArray(registryTarget.value?.assets)) {
    throw createImporterError('target_registry_invalid', '目标 asset registry 的 assets 必须是数组');
  }
  const plan = buildImportPlan({
    libraryData: loaded.libraryData,
    manifest: loaded.manifest,
    existingStore: storeTarget.value,
    existingRegistry: registryTarget.value,
    publicBaseUrl,
  });
  const filePlan = await checkDestinationFiles({
    assetsDir,
    fileRecords: plan.fileRecords,
    manifest: loaded.manifest,
  });
  const preview = summaryFromPlan({
    mode: 'local',
    dryRun,
    loaded,
    plan,
    filePlan,
  });
  if (dryRun) return preview;

  const jsonChanges = Object.values(plan.additions).some((items) => items.length > 0);
  if (!jsonChanges && filePlan.missing.length === 0) return preview;

  const runKey = `${timestampKey(now())}-${randomBytes(4).toString('hex')}`;
  const backupDirectory = path.join(
    path.dirname(path.resolve(storePath)),
    '.virtual-model-library-backups',
    runKey,
  );
  const stageRoot = path.join(path.resolve(assetsDir), `.virtual-model-library-stage-${runKey}`);
  const createdFiles = [];
  let jsonMutationStarted = false;
  try {
    await mkdir(backupDirectory, { recursive: true });
    await Promise.all([
      atomicWriteText(path.join(backupDirectory, path.basename(storePath)), storeTarget.raw),
      atomicWriteText(path.join(backupDirectory, path.basename(registryPath)), registryTarget.raw),
    ]);
    if (filePlan.missing.length > 0) {
      await mkdir(stageRoot, { recursive: true });
      await stageFiles({ missing: filePlan.missing, stageRoot });
      await materializeStagedFiles(filePlan.missing, createdFiles);
    }
    if (jsonChanges) {
      const nextStore = {
        ...storeTarget.value,
        virtualModels: [
          ...(Array.isArray(storeTarget.value.virtualModels) ? storeTarget.value.virtualModels : []),
          ...plan.additions.models,
        ],
        virtualModelVersions: [
          ...(Array.isArray(storeTarget.value.virtualModelVersions)
            ? storeTarget.value.virtualModelVersions
            : []),
          ...plan.additions.versions,
        ],
        virtualModelAssets: [
          ...(Array.isArray(storeTarget.value.virtualModelAssets)
            ? storeTarget.value.virtualModelAssets
            : []),
          ...plan.additions.relations,
        ],
      };
      const nextRegistry = {
        ...registryTarget.value,
        assets: [...registryTarget.value.assets, ...plan.additions.registry],
      };
      jsonMutationStarted = true;
      await writeJson(storePath, nextStore);
      await writeJson(registryPath, nextRegistry);
    }
    return summaryFromPlan({
      mode: 'local',
      dryRun: false,
      loaded,
      plan,
      filePlan,
      backupDirectory,
    });
  } catch (error) {
    const rollbackErrors = [];
    if (jsonMutationStarted) {
      const restoreStore = storeTarget.existed
        ? atomicWriteText(storePath, storeTarget.raw)
        : unlink(storePath).catch((rollbackError) => {
            if (rollbackError?.code !== 'ENOENT') throw rollbackError;
          });
      const restoreRegistry = registryTarget.existed
        ? atomicWriteText(registryPath, registryTarget.raw)
        : unlink(registryPath).catch((rollbackError) => {
            if (rollbackError?.code !== 'ENOENT') throw rollbackError;
          });
      await restoreStore.catch((rollbackError) => {
        rollbackErrors.push({ target: 'store', code: String(rollbackError?.code || '') });
      });
      await restoreRegistry.catch((rollbackError) => {
        rollbackErrors.push({ target: 'registry', code: String(rollbackError?.code || '') });
      });
    }
    await cleanupFiles(createdFiles);
    if (rollbackErrors.length > 0) error.rollbackErrors = rollbackErrors;
    throw error;
  } finally {
    await rm(stageRoot, { recursive: true, force: true }).catch(() => null);
  }
};

const mysqlRows = async (connection, sql, params) => {
  const result = await connection.query(sql, params);
  return Array.isArray(result) ? result[0] : [];
};

const fetchMysqlExisting = async (connection, libraryData) => {
  const targetModels = libraryData.virtualModels.filter((model) => TARGET_CODES.has(String(model.code)));
  const modelIds = targetModels.map((model) => model.id);
  const codes = targetModels.map((model) => model.code);
  const targetModelIds = new Set(modelIds);
  const versions = libraryData.virtualModelVersions.filter((version) => (
    targetModelIds.has(version.virtualModelId)
  ));
  const versionIds = versions.map((version) => version.id);
  const targetVersionIds = new Set(versionIds);
  const relations = libraryData.virtualModelAssets.filter((relation) => (
    targetVersionIds.has(relation.virtualModelVersionId)
  ));
  const relationIds = relations.map((relation) => relation.id);
  const assetIds = [...new Set(relations.flatMap((relation) => [
    relation.assetId,
    relation.previewAssetId,
  ]))];
  const placeholders = (values) => values.map(() => '?').join(',');
  const [modelRows, versionRows, relationRows, assetRows] = await Promise.all([
    mysqlRows(
      connection,
      `SELECT * FROM virtual_models WHERE id IN (${placeholders(modelIds)}) OR code IN (${placeholders(codes)}) FOR UPDATE`,
      [...modelIds, ...codes],
    ),
    mysqlRows(
      connection,
      `SELECT * FROM virtual_model_versions WHERE id IN (${placeholders(versionIds)}) OR virtual_model_id IN (${placeholders(modelIds)}) FOR UPDATE`,
      [...versionIds, ...modelIds],
    ),
    mysqlRows(
      connection,
      `SELECT * FROM virtual_model_assets WHERE id IN (${placeholders(relationIds)}) OR virtual_model_version_id IN (${placeholders(versionIds)}) FOR UPDATE`,
      [...relationIds, ...versionIds],
    ),
    mysqlRows(
      connection,
      `SELECT * FROM stored_assets WHERE id IN (${placeholders(assetIds)}) FOR UPDATE`,
      assetIds,
    ),
  ]);
  return {
    store: {
      virtualModels: modelRows,
      virtualModelVersions: versionRows,
      virtualModelAssets: relationRows,
    },
    registry: { assets: assetRows },
  };
};

const insertMysqlPlan = async (connection, additions) => {
  for (const model of additions.models) {
    await connection.query(
      'INSERT INTO virtual_models (id, code, name, tags_json, status, current_version_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [
        model.id,
        model.code,
        model.name,
        JSON.stringify(model.tags),
        model.status,
        model.currentVersionId,
        model.createdAt,
        model.updatedAt,
      ],
    );
  }
  for (const version of additions.versions) {
    await connection.query(
      'INSERT INTO virtual_model_versions (id, virtual_model_id, version_number, identity_profile_json, status, published_at, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [
        version.id,
        version.virtualModelId,
        version.versionNumber,
        JSON.stringify(version.identityProfile),
        version.status,
        version.publishedAt,
        version.createdBy,
        version.createdAt,
      ],
    );
  }
  for (const relation of additions.relations) {
    await connection.query(
      'INSERT INTO virtual_model_assets (id, virtual_model_version_id, slot, asset_id, public_url, preview_asset_id, preview_url, position, is_primary, validation_status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        relation.id,
        relation.virtualModelVersionId,
        relation.slot,
        relation.assetId,
        relation.publicUrl,
        relation.previewAssetId || null,
        relation.previewUrl || null,
        relation.position,
        relation.isPrimary ? 1 : 0,
        relation.validationStatus,
        relation.createdAt,
      ],
    );
  }
  for (const record of additions.registry) {
    await connection.query(
      `INSERT INTO stored_assets (
        id, user_id, module, asset_type, storage_key, storage_bucket, storage_region, original_name,
        mime_type, file_size, content_hash, width, height, provider, provider_source_url, job_id,
        public_url, created_at, updated_at, last_accessed_at, expires_at, deleted_at, storage_status
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
      ],
    );
  }
};

export const importMysqlLibrary = async ({
  packagePath,
  connection,
  assetsDir,
  publicBaseUrl = '',
  dryRun = false,
  now = Date.now,
} = {}) => {
  if (!connection || typeof connection.query !== 'function') {
    throw createImporterError('mysql_connection_required', 'mysql 模式必须提供 mysql2 connection');
  }
  if (!String(assetsDir || '').trim()) {
    throw createImporterError('mysql_assets_dir_required', 'mysql 模式必须显式提供 assetsDir');
  }
  const loaded = await loadAndValidatePackage(packagePath);
  const rewritten = rewriteLibraryPublicUrls(loaded.libraryData, { publicBaseUrl });
  const targetModelIds = new Set(
    rewritten.virtualModels
      .filter((model) => TARGET_CODES.has(String(model.code)))
      .map((model) => model.id),
  );
  const targetVersionIds = new Set(
    rewritten.virtualModelVersions
      .filter((version) => targetModelIds.has(version.virtualModelId))
      .map((version) => version.id),
  );
  const allTargetAssetIds = new Set(
    rewritten.virtualModelAssets
      .filter((relation) => targetVersionIds.has(relation.virtualModelVersionId))
      .flatMap((relation) => [relation.assetId, relation.previewAssetId]),
  );
  const manifestMap = manifestByStorageKey(loaded.manifest);
  const preflightFileRecords = rewritten.assetRegistryRecords
    .filter((record) => allTargetAssetIds.has(record.id))
    .map((record) => ({
      ...canonicalRegistry(record),
      contentHash: manifestMap.get(record.storageKey)?.sha256 || '',
    }));
  const preflightFiles = await checkDestinationFiles({
    assetsDir,
    fileRecords: preflightFileRecords,
    manifest: loaded.manifest,
  });
  const runKey = `${timestampKey(now())}-${randomBytes(4).toString('hex')}`;
  const stageRoot = path.join(path.resolve(assetsDir), `.virtual-model-library-stage-${runKey}`);
  const createdFiles = [];
  let transactionStarted = false;
  try {
    if (!dryRun && preflightFiles.missing.length > 0) {
      await mkdir(stageRoot, { recursive: true });
      await stageFiles({ missing: preflightFiles.missing, stageRoot });
    }
    await connection.beginTransaction();
    transactionStarted = true;
    const existing = await fetchMysqlExisting(connection, rewritten);
    const plan = buildImportPlan({
      libraryData: rewritten,
      manifest: loaded.manifest,
      existingStore: existing.store,
      existingRegistry: existing.registry,
      publicBaseUrl,
    });
    const filePlan = await checkDestinationFiles({
      assetsDir,
      fileRecords: plan.fileRecords,
      manifest: loaded.manifest,
    });
    for (const item of filePlan.missing) {
      const staged = preflightFiles.missing.find((candidate) => (
        candidate.record.storageKey === item.record.storageKey
      ));
      item.stagePath = staged?.stagePath;
      if (!dryRun && !item.stagePath) {
        throw createImporterError('staged_file_missing', '事务提交前缺少已校验的 staging 素材', {
          storageKey: item.record.storageKey,
        });
      }
    }
    if (dryRun) {
      await connection.rollback();
      transactionStarted = false;
      return summaryFromPlan({
        mode: 'mysql',
        dryRun: true,
        loaded,
        plan,
        filePlan,
      });
    }
    await insertMysqlPlan(connection, plan.additions);
    await materializeStagedFiles(filePlan.missing, createdFiles);
    await connection.commit();
    transactionStarted = false;
    return summaryFromPlan({
      mode: 'mysql',
      dryRun: false,
      loaded,
      plan,
      filePlan,
    });
  } catch (error) {
    if (transactionStarted) {
      await connection.rollback().catch((rollbackError) => {
        error.rollbackError = {
          code: String(rollbackError?.code || ''),
          message: String(rollbackError?.message || ''),
        };
      });
    }
    await cleanupFiles(createdFiles);
    throw error;
  } finally {
    await rm(stageRoot, { recursive: true, force: true }).catch(() => null);
  }
};

const CLI_VALUE_OPTIONS = new Set([
  '--package',
  '--target-root',
  '--store-path',
  '--registry-path',
  '--assets-dir',
  '--public-base-url',
  '--mysql-config-file',
]);
const CLI_FLAG_OPTIONS = new Set(['--dry-run', '--local', '--mysql']);

export const parseCliArgs = (argv = []) => {
  const values = {};
  const flags = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = String(argv[index]);
    if (CLI_FLAG_OPTIONS.has(argument)) {
      flags.add(argument);
      continue;
    }
    const equalsIndex = argument.indexOf('=');
    const key = equalsIndex >= 0 ? argument.slice(0, equalsIndex) : argument;
    if (!CLI_VALUE_OPTIONS.has(key)) {
      throw createImporterError('cli_argument_invalid', `未知参数: ${key}`);
    }
    const value = equalsIndex >= 0 ? argument.slice(equalsIndex + 1) : argv[++index];
    if (!String(value || '').trim()) {
      throw createImporterError('cli_argument_invalid', `${key} 缺少值`);
    }
    values[key.slice(2).replaceAll('-', '_')] = String(value);
  }
  if (flags.has('--local') && flags.has('--mysql')) {
    throw createImporterError('cli_mode_conflict', '--local 与 --mysql 不能同时使用');
  }
  const mode = flags.has('--local')
    ? 'local'
    : flags.has('--mysql')
      ? 'mysql'
      : 'dry-run';
  return {
    ...values,
    mode,
    dryRun: flags.has('--dry-run') || mode === 'dry-run',
  };
};

const resolveLocalCliPaths = (args) => {
  const targetRoot = args.target_root ? path.resolve(args.target_root) : '';
  return {
    storePath: args.store_path || (targetRoot
      ? path.join(targetRoot, 'server', 'data', 'internal-store.json')
      : ''),
    registryPath: args.registry_path || (targetRoot
      ? path.join(targetRoot, 'server', 'data', 'asset-registry.json')
      : ''),
    assetsDir: args.assets_dir || (targetRoot
      ? path.join(targetRoot, 'server', 'data', 'assets')
      : ''),
  };
};

const readMysqlConfigFile = async (filePath) => {
  const resolved = path.resolve(String(filePath || ''));
  const metadata = await stat(resolved).catch((error) => {
    throw createImporterError('mysql_config_invalid', '无法读取 MySQL 配置文件', {
      causeCode: String(error?.code || ''),
    });
  });
  if ((metadata.mode & 0o077) !== 0) {
    throw createImporterError(
      'mysql_config_permissions_unsafe',
      'MySQL 配置文件权限必须为 0600 或更严格',
    );
  }
  const config = await readJsonFile(resolved, 'mysql_config_invalid');
  const allowedKeys = new Set([
    'host',
    'port',
    'user',
    'password',
    'database',
    'socketPath',
    'charset',
    'ssl',
  ]);
  const safeConfig = Object.fromEntries(
    Object.entries(config || {}).filter(([key]) => allowedKeys.has(key)),
  );
  if (!String(safeConfig.user || '').trim() || !String(safeConfig.database || '').trim()) {
    throw createImporterError(
      'mysql_config_invalid',
      'MySQL 配置文件必须包含 user 和 database',
    );
  }
  return safeConfig;
};

const main = async () => {
  const args = parseCliArgs(process.argv.slice(2));
  if (!args.package) {
    throw createImporterError('package_path_required', '必须传入 --package');
  }
  let summary;
  if (args.mode === 'local') {
    summary = await importLocalLibrary({
      packagePath: args.package,
      ...resolveLocalCliPaths(args),
      publicBaseUrl: args.public_base_url || '',
      dryRun: args.dryRun,
    });
  } else if (args.mode === 'mysql') {
    if (!args.mysql_config_file) {
      throw createImporterError(
        'mysql_config_required',
        'mysql 模式必须显式传入 --mysql-config-file；脚本不会读取或打印 env 密码',
      );
    }
    const mysql = await import('mysql2/promise');
    const connection = await mysql.createConnection(
      await readMysqlConfigFile(args.mysql_config_file),
    );
    try {
      summary = await importMysqlLibrary({
        packagePath: args.package,
        connection,
        assetsDir: args.assets_dir,
        publicBaseUrl: args.public_base_url || '',
        dryRun: args.dryRun,
      });
    } finally {
      await connection.end();
    }
  } else {
    const explicitLocal = resolveLocalCliPaths(args);
    if (explicitLocal.storePath && explicitLocal.registryPath && explicitLocal.assetsDir) {
      summary = await importLocalLibrary({
        packagePath: args.package,
        ...explicitLocal,
        publicBaseUrl: args.public_base_url || '',
        dryRun: true,
      });
    } else {
      const loaded = await loadAndValidatePackage(args.package);
      const plan = buildImportPlan({
        libraryData: loaded.libraryData,
        manifest: loaded.manifest,
        publicBaseUrl: args.public_base_url || '',
        auditBaseline: false,
      });
      summary = summaryFromPlan({
        mode: 'dry-run',
        dryRun: true,
        loaded,
        plan,
        filePlan: { missing: plan.fileRecords, skipped: [] },
      });
    }
  }
  process.stdout.write(`${JSON.stringify(summary)}\n`);
};

const isDirectExecution = process.argv[1]
  ? import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
  : false;

if (isDirectExecution) {
  main().catch((error) => {
    const safeError = {
      ok: false,
      code: String(error?.code || 'import_failed'),
      message: String(error?.message || '导入失败'),
      details: error?.details || {},
    };
    process.stderr.write(`${JSON.stringify(safeError)}\n`);
    process.exitCode = 1;
  });
}
