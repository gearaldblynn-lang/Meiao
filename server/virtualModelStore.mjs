import { randomBytes } from 'node:crypto';

export const VIRTUAL_MODEL_ASSET_SLOTS = Object.freeze(['front_close', 'left_45_close', 'right_45_close', 'profile_close', 'front_half', 'three_quarter_half', 'front_full', 'three_quarter_full']);
const createId = () => randomBytes(12).toString('hex');
const now = () => Date.now();
const parseJson = (value, fallback) => { try { return typeof value === 'string' ? JSON.parse(value) : value ?? fallback; } catch { return fallback; } };

export const normalizeVirtualModelLocalStore = (store = {}) => {
  const target = store && typeof store === 'object' ? store : {};
  target.virtualModels = Array.isArray(target.virtualModels) ? target.virtualModels : [];
  target.virtualModelVersions = Array.isArray(target.virtualModelVersions) ? target.virtualModelVersions : [];
  target.virtualModelAssets = Array.isArray(target.virtualModelAssets) ? target.virtualModelAssets : [];
  return target;
};

export const validateVirtualModelVersionForPublish = ({ assets = [], identityProfile = null } = {}) => {
  const issues = [];
  const slots = assets.map((asset) => asset?.slot);
  if (!identityProfile || typeof identityProfile !== 'object' || Array.isArray(identityProfile)) issues.push({ code: 'IDENTITY_PROFILE_REQUIRED' });
  if (assets.length !== VIRTUAL_MODEL_ASSET_SLOTS.length) issues.push({ code: 'ASSET_COUNT_INVALID' });
  VIRTUAL_MODEL_ASSET_SLOTS.forEach((slot) => { if (slots.filter((value) => value === slot).length !== 1) issues.push({ code: 'ASSET_SLOT_INVALID', slot }); });
  const primaryAssets = assets.filter((asset) => asset?.isPrimary);
  if (primaryAssets.length !== 1 || primaryAssets[0]?.slot !== 'front_close') issues.push({ code: 'PRIMARY_ASSET_INVALID', slot: 'front_close' });
  if (assets.some((asset) => asset?.validationStatus !== 'passed' || !asset?.assetId)) issues.push({ code: 'ASSET_VALIDATION_INCOMPLETE' });
  const primary = assets.find((asset) => asset?.isPrimary);
  if (!primary?.previewAssetId || !primary?.previewUrl || primary.previewAssetId === primary.assetId || primary.previewUrl === primary.publicUrl) issues.push({ code: 'PRIMARY_PREVIEW_REQUIRED' });
  return { ok: issues.length === 0, issues };
};

const modelFromRow = (row) => ({ id: row.id, code: row.code, name: row.name, tags: parseJson(row.tags_json ?? row.tags, []), status: row.status, currentVersionId: row.current_version_id ?? row.currentVersionId ?? null, createdAt: Number(row.created_at ?? row.createdAt ?? 0), updatedAt: Number(row.updated_at ?? row.updatedAt ?? 0) });
const versionFromRow = (row) => {
  const rawPublishedAt = row.published_at ?? row.publishedAt ?? null;
  const publishedAt = Number(rawPublishedAt);
  return { id: row.id, virtualModelId: row.virtual_model_id ?? row.virtualModelId, versionNumber: Number(row.version_number ?? row.versionNumber ?? 0), identityProfile: parseJson(row.identity_profile_json ?? row.identityProfile, {}), status: row.status, publishedAt: Number.isFinite(publishedAt) && publishedAt > 0 ? publishedAt : null, createdBy: row.created_by ?? row.createdBy ?? null, createdAt: Number(row.created_at ?? row.createdAt ?? 0) };
};
const assetFromRow = (row) => ({ id: row.id, virtualModelVersionId: row.virtual_model_version_id ?? row.virtualModelVersionId, slot: row.slot, assetId: row.asset_id ?? row.assetId, publicUrl: row.public_url ?? row.publicUrl ?? '', previewAssetId: row.preview_asset_id ?? row.previewAssetId ?? '', previewUrl: row.preview_url ?? row.previewUrl ?? '', position: Number(row.position ?? 0), isPrimary: Boolean(row.is_primary ?? row.isPrimary), validationStatus: row.validation_status ?? row.validationStatus, createdAt: Number(row.created_at ?? row.createdAt ?? 0) });
const publicModel = (model, version, assets) => {
  const coverUrl = assets.find((asset) => asset.isPrimary)?.previewUrl || '';
  return { id: model.id, code: model.code, name: model.name, tags: model.tags, status: model.status, currentVersionId: model.currentVersionId, coverUrl, version: { id: version.id, versionNumber: version.versionNumber, status: version.status, publishedAt: version.publishedAt, thumbnailUrl: coverUrl } };
};
export const toVirtualModelPublicSummary = (model) => model;

const FALLBACK_SELECTION_SLOTS = Object.freeze(['front_close', 'left_45_close', 'right_45_close']);
const FULL_PERSON_FALLBACK_SELECTION_SLOTS = Object.freeze(['front_full', 'front_close', 'left_45_close']);
const normalizeReplacementScope = (value) => value === 'full_person' ? 'full_person' : 'identity_only';
const selectVirtualModelAssetSlots = (analysis, replacementScope = 'identity_only') => {
  const valid = analysis && typeof analysis === 'object' && ['portrait', 'half_body', 'full_body'].includes(analysis.framing) && ['front', 'left', 'right', 'profile'].includes(analysis.faceDirection);
  const normalizedScope = normalizeReplacementScope(replacementScope);
  if (!valid) return normalizedScope === 'full_person'
    ? FULL_PERSON_FALLBACK_SELECTION_SLOTS
    : FALLBACK_SELECTION_SLOTS;
  const side45 = analysis.faceDirection === 'right' ? 'right_45_close' : 'left_45_close';
  if (normalizedScope === 'full_person') {
    if (analysis.faceDirection === 'front') return ['front_full', 'front_close', 'front_half'];
    if (analysis.faceDirection === 'profile') return ['three_quarter_full', 'profile_close', 'front_close'];
    return ['three_quarter_full', side45, 'front_close'];
  }
  if (analysis.framing === 'full_body') {
    if (analysis.faceDirection === 'front') return ['front_close', 'front_half', 'front_full'];
    return analysis.faceDirection === 'profile'
      ? ['front_close', 'three_quarter_half', 'three_quarter_full']
      : ['front_close', side45, 'three_quarter_full'];
  }
  if (analysis.faceDirection === 'front') return FALLBACK_SELECTION_SLOTS;
  return analysis.faceDirection === 'profile'
    ? ['front_close', 'profile_close', 'three_quarter_half']
    : ['front_close', side45, analysis.faceDirection === 'right' ? 'three_quarter_half' : 'profile_close'];
};

const sanitizeIdentityDescription = (identityProfile) => {
  const description = typeof identityProfile?.description === 'string' ? identityProfile.description : '';
  return description.replace(/\s+/g, ' ').trim().slice(0, 1200);
};

const selectedAssetsForAnalysis = (assets, referenceAnalysis, replacementScope = 'identity_only') => {
  const bySlot = new Map(assets.map((asset) => [asset.slot, asset]));
  const normalizedScope = normalizeReplacementScope(replacementScope);
  const selected = selectVirtualModelAssetSlots(referenceAnalysis, normalizedScope).map((slot) => bySlot.get(slot));
  const hasValidPrimarySource = normalizedScope === 'full_person'
    ? selected[0]?.slot === 'front_full' || selected[0]?.slot === 'three_quarter_full'
    : selected[0]?.isPrimary === true;
  if (selected.length !== 3 || selected.some((asset) => !asset?.assetId) || !hasValidPrimarySource || new Set(selected.map((asset) => String(asset.assetId).trim())).size !== 3) throw Object.assign(new Error('Virtual model assets are incomplete'), { code: 'MODEL_ASSET_INCOMPLETE' });
  return selected;
};

const hasSameHistoricalLibrarySnapshot = (payload, snapshot) => {
  const expectedAssetIds = Array.isArray(snapshot?.selectedAssetIds) ? snapshot.selectedAssetIds : [];
  const actualAssetIds = Array.isArray(payload?.selectedAssetIds) ? payload.selectedAssetIds : [];
  return payload?.identitySource === 'library'
    && String(payload.virtualModelId || '') === String(snapshot?.virtualModelId || '')
    && String(payload.virtualModelVersionId || '') === String(snapshot?.virtualModelVersionId || '')
    && Number(payload.publishedAt) === Number(snapshot?.publishedAt)
    && [3, 4, 5].includes(expectedAssetIds.length)
    && actualAssetIds.length === expectedAssetIds.length
    && actualAssetIds.every((assetId, index) => assetId === expectedAssetIds[index]);
};

export const findOwnedHistoricalVirtualModelSnapshot = async ({ pool = null, store = null, userId, snapshot } = {}) => {
  if (!String(userId || '').trim() || !snapshot) return false;
  let payloads;
  if (pool) {
    const [rows] = await pool.query('SELECT payload_json FROM internal_jobs WHERE user_id = ? ORDER BY created_at DESC', [userId]);
    payloads = rows.map((row) => parseJson(row.payload_json, {}));
  } else {
    payloads = (Array.isArray(store?.jobs) ? store.jobs : [])
      .filter((job) => String(job?.userId || job?.user_id || '') === String(userId))
      .map((job) => job?.payload || {});
  }
  return payloads.some((payload) => hasSameHistoricalLibrarySnapshot(payload, snapshot));
};

export const ensureVirtualModelSchema = async (pool) => {
  if (!pool) return;
  await pool.query(`CREATE TABLE IF NOT EXISTS virtual_models (id VARCHAR(24) PRIMARY KEY, code VARCHAR(100) NOT NULL UNIQUE, name VARCHAR(160) NOT NULL, tags_json LONGTEXT NULL, status VARCHAR(20) NOT NULL, current_version_id VARCHAR(24) NULL, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL, INDEX idx_virtual_models_status (status)) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await pool.query(`CREATE TABLE IF NOT EXISTS virtual_model_versions (id VARCHAR(24) PRIMARY KEY, virtual_model_id VARCHAR(24) NOT NULL, version_number INT NOT NULL, identity_profile_json LONGTEXT NOT NULL, status VARCHAR(20) NOT NULL, published_at BIGINT NULL, created_by VARCHAR(24) NULL, created_at BIGINT NOT NULL, UNIQUE KEY uq_virtual_model_version (virtual_model_id, version_number), INDEX idx_virtual_model_versions_model_id (virtual_model_id)) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await pool.query(`CREATE TABLE IF NOT EXISTS virtual_model_assets (id VARCHAR(24) PRIMARY KEY, virtual_model_version_id VARCHAR(24) NOT NULL, slot VARCHAR(40) NOT NULL, asset_id VARCHAR(24) NOT NULL, public_url TEXT NOT NULL, position INT NOT NULL, is_primary TINYINT(1) NOT NULL DEFAULT 0, validation_status VARCHAR(20) NOT NULL, created_at BIGINT NOT NULL, UNIQUE KEY uq_virtual_model_asset_slot (virtual_model_version_id, slot), INDEX idx_virtual_model_assets_version_id (virtual_model_version_id), INDEX idx_virtual_model_assets_asset_id (asset_id)) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  const [previewIdColumn] = await pool.query("SHOW COLUMNS FROM virtual_model_assets LIKE 'preview_asset_id'");
  if (!previewIdColumn.length) await pool.query('ALTER TABLE virtual_model_assets ADD COLUMN preview_asset_id VARCHAR(24) NULL AFTER public_url');
  const [previewUrlColumn] = await pool.query("SHOW COLUMNS FROM virtual_model_assets LIKE 'preview_url'");
  if (!previewUrlColumn.length) await pool.query('ALTER TABLE virtual_model_assets ADD COLUMN preview_url TEXT NULL AFTER preview_asset_id');
};

const getLocalVersionAndAssets = (store, virtualModelId, virtualModelVersionId) => {
  const normalized = normalizeVirtualModelLocalStore(store);
  const model = normalized.virtualModels.map(modelFromRow).find((item) => item.id === virtualModelId);
  const version = normalized.virtualModelVersions.map(versionFromRow).find((item) => item.id === virtualModelVersionId && item.virtualModelId === virtualModelId);
  return { normalized, model, version, assets: normalized.virtualModelAssets.filter((item) => item.virtualModelVersionId === virtualModelVersionId).map(assetFromRow) };
};

export const listPublishedVirtualModels = async ({ pool = null, store = null } = {}) => {
  if (!pool) {
    const normalized = normalizeVirtualModelLocalStore(store);
    return normalized.virtualModels.filter((item) => item.status === 'published').map(modelFromRow).map((model) => {
      const version = normalized.virtualModelVersions.map(versionFromRow).find((item) => item.id === model.currentVersionId && item.status === 'published');
      return version ? publicModel(model, version, normalized.virtualModelAssets.filter((item) => item.virtualModelVersionId === version.id).map(assetFromRow)) : null;
    }).filter(Boolean);
  }
  const [rows] = await pool.query(`SELECT m.*, v.id AS version_id, v.virtual_model_id, v.version_number, v.identity_profile_json, v.status AS version_status, v.published_at, v.created_at AS version_created_at FROM virtual_models m JOIN virtual_model_versions v ON v.id = m.current_version_id WHERE m.status = 'published' AND v.status = 'published' ORDER BY m.updated_at DESC`);
  const ids = rows.map((row) => row.version_id);
  const [assetRows] = ids.length ? await pool.query(`SELECT * FROM virtual_model_assets WHERE virtual_model_version_id IN (${ids.map(() => '?').join(',')})`, ids) : [[]];
  return rows.map((row) => { const version = versionFromRow({ ...row, id: row.version_id, status: row.version_status, created_at: row.version_created_at }); return publicModel(modelFromRow(row), version, assetRows.filter((asset) => asset.virtual_model_version_id === version.id).map(assetFromRow)); });
};

export const getPublishedVirtualModelDetail = async ({ pool = null, store = null, virtualModelId } = {}) => (await listPublishedVirtualModels({ pool, store })).find((model) => model.id === virtualModelId) || null;

export const listAdminVirtualModels = async ({ pool = null, store = null, status = 'all' } = {}) => {
  const allowedStatus = ['draft', 'published', 'unpublished', 'all'].includes(status) ? status : 'all';
  let models; let versions; let assets;
  if (pool) {
    const [modelRows] = await pool.query("SELECT * FROM virtual_models WHERE status <> 'deleted' ORDER BY updated_at DESC", []);
    const [versionRows] = await pool.query('SELECT * FROM virtual_model_versions');
    const [assetRows] = await pool.query('SELECT * FROM virtual_model_assets');
    models = modelRows.map(modelFromRow); versions = versionRows.map(versionFromRow); assets = assetRows.map(assetFromRow);
  } else {
    const normalized = normalizeVirtualModelLocalStore(store);
    models = normalized.virtualModels.map(modelFromRow).filter((model) => model.status !== 'deleted').sort((a, b) => b.updatedAt - a.updatedAt);
    versions = normalized.virtualModelVersions.map(versionFromRow); assets = normalized.virtualModelAssets.map(assetFromRow);
  }
  const adminModels = models.map((model) => {
    const modelVersions = versions.filter((item) => item.virtualModelId === model.id).sort((a, b) => b.versionNumber - a.versionNumber);
    const version = modelVersions.find((item) => item.id === model.currentVersionId)
      || modelVersions.find((item) => item.status === 'draft')
      || modelVersions[0]
      || null;
    const versionAssets = version ? assets.filter((item) => item.virtualModelVersionId === version.id) : [];
    return { ...model, coverUrl: versionAssets.find((item) => item.isPrimary)?.publicUrl || '', version: version ? { ...version, assets: versionAssets } : null };
  });
  if (allowedStatus === 'all') return adminModels;
  return adminModels.filter((model) => (
    model.version?.status === 'draft' ? 'draft' : model.status
  ) === allowedStatus);
};

export const createVirtualModelDraft = async ({ pool = null, store = null, code, name, tags = [] } = {}) => {
  const createdAt = now(); const model = { id: createId(), code: String(code || '').trim(), name: String(name || '').trim(), tags: Array.isArray(tags) ? tags : [], status: 'draft', currentVersionId: null, createdAt, updatedAt: createdAt };
  if (pool) await pool.query('INSERT INTO virtual_models (id, code, name, tags_json, status, current_version_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [model.id, model.code, model.name, JSON.stringify(model.tags), model.status, null, createdAt, createdAt]); else normalizeVirtualModelLocalStore(store).virtualModels.push(model);
  return model;
};

export const updateVirtualModelDraft = async ({ pool = null, store = null, virtualModelId, code, name, tags } = {}) => {
  const updatedAt = now();
  if (pool) {
    const [rows] = await pool.query("SELECT * FROM virtual_models WHERE id = ? AND status <> 'deleted'", [virtualModelId]);
    const existing = rows[0] && modelFromRow(rows[0]);
    if (!existing) throw Object.assign(new Error('Virtual model not found'), { code: 'MODEL_NOT_FOUND' });
    const next = { ...existing, code: code === undefined ? existing.code : String(code).trim(), name: name === undefined ? existing.name : String(name).trim(), tags: tags === undefined ? existing.tags : (Array.isArray(tags) ? tags : []), updatedAt };
    const [result] = await pool.query("UPDATE virtual_models SET code = ?, name = ?, tags_json = ?, updated_at = ? WHERE id = ? AND status <> 'deleted'", [next.code, next.name, JSON.stringify(next.tags), updatedAt, virtualModelId]);
    if (result.affectedRows !== 1) throw Object.assign(new Error('Virtual model not found'), { code: 'MODEL_NOT_FOUND' });
    return next;
  }
  const rawModel = normalizeVirtualModelLocalStore(store).virtualModels.find((item) => item.id === virtualModelId && item.status !== 'deleted');
  if (!rawModel) throw Object.assign(new Error('Virtual model not found'), { code: 'MODEL_NOT_FOUND' });
  if (code !== undefined) rawModel.code = String(code).trim();
  if (name !== undefined) rawModel.name = String(name).trim();
  if (tags !== undefined) rawModel.tags = Array.isArray(tags) ? tags : [];
  rawModel.updatedAt = updatedAt;
  return modelFromRow(rawModel);
};

export const createVirtualModelVersion = async ({ pool = null, store = null, virtualModelId, identityProfile = {}, createdBy = null } = {}) => {
  if (pool) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [modelRows] = await connection.query("SELECT id FROM virtual_models WHERE id = ? AND status <> 'deleted' FOR UPDATE", [virtualModelId]);
      if (!modelRows[0]) throw Object.assign(new Error('Virtual model not found'), { code: 'MODEL_NOT_FOUND' });
      const [versionRows] = await connection.query('SELECT COALESCE(MAX(version_number), 0) AS highest FROM virtual_model_versions WHERE virtual_model_id = ?', [virtualModelId]);
      const version = { id: createId(), virtualModelId, versionNumber: Number(versionRows[0]?.highest || 0) + 1, identityProfile, status: 'draft', publishedAt: null, createdBy, createdAt: now() };
      await connection.query('INSERT INTO virtual_model_versions (id, virtual_model_id, version_number, identity_profile_json, status, published_at, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [version.id, version.virtualModelId, version.versionNumber, JSON.stringify(identityProfile), version.status, null, createdBy, version.createdAt]);
      await connection.commit();
      return version;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }
  const normalized = normalizeVirtualModelLocalStore(store);
  if (!normalized.virtualModels.some((item) => item.id === virtualModelId && item.status !== 'deleted')) throw Object.assign(new Error('Virtual model not found'), { code: 'MODEL_NOT_FOUND' });
  const version = { id: createId(), virtualModelId, versionNumber: normalized.virtualModelVersions.filter((item) => item.virtualModelId === virtualModelId).length + 1, identityProfile, status: 'draft', publishedAt: null, createdBy, createdAt: now() };
  normalized.virtualModelVersions.push(version);
  return version;
};

export const updateDraftVirtualModelVersion = async ({
  pool = null,
  store = null,
  virtualModelId,
  virtualModelVersionId,
  identityProfile = {},
} = {}) => {
  const identityProfilePatch = identityProfile && typeof identityProfile === 'object' && !Array.isArray(identityProfile)
    ? identityProfile
    : {};
  if (pool) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.query(
        "SELECT v.* FROM virtual_model_versions v JOIN virtual_models m ON m.id = v.virtual_model_id AND m.status <> 'deleted' WHERE v.id = ? AND v.virtual_model_id = ? FOR UPDATE",
        [virtualModelVersionId, virtualModelId],
      );
      const version = rows[0] && versionFromRow(rows[0]);
      if (!version) throw Object.assign(new Error('Virtual model version not found'), { code: 'MODEL_NOT_FOUND' });
      if (version.status !== 'draft' || version.publishedAt !== null) {
        throw Object.assign(new Error('Published virtual model versions are immutable'), { code: 'MODEL_VERSION_IMMUTABLE' });
      }
      const nextIdentityProfile = {
        ...(version.identityProfile || {}),
        ...identityProfilePatch,
      };
      const [result] = await connection.query(
        "UPDATE virtual_model_versions SET identity_profile_json = ? WHERE id = ? AND virtual_model_id = ? AND status = 'draft' AND published_at IS NULL",
        [JSON.stringify(nextIdentityProfile), virtualModelVersionId, virtualModelId],
      );
      if (result.affectedRows !== 1) {
        throw Object.assign(new Error('Published virtual model versions are immutable'), { code: 'MODEL_VERSION_IMMUTABLE' });
      }
      await connection.commit();
      return { ...version, identityProfile: nextIdentityProfile };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  const normalized = normalizeVirtualModelLocalStore(store);
  const model = normalized.virtualModels.find((item) => item.id === virtualModelId && item.status !== 'deleted');
  const version = normalized.virtualModelVersions.find((item) => item.id === virtualModelVersionId && item.virtualModelId === virtualModelId);
  if (!model || !version) throw Object.assign(new Error('Virtual model version not found'), { code: 'MODEL_NOT_FOUND' });
  if (version.status !== 'draft' || (version.publishedAt !== null && version.publishedAt !== undefined)) {
    throw Object.assign(new Error('Published virtual model versions are immutable'), { code: 'MODEL_VERSION_IMMUTABLE' });
  }
  const nextIdentityProfile = {
    ...(version.identityProfile || {}),
    ...identityProfilePatch,
  };
  version.identityProfile = nextIdentityProfile;
  return versionFromRow(version);
};

export const replaceDraftVersionAssets = async ({ pool = null, store = null, virtualModelId = null, virtualModelVersionId, assets = [] } = {}) => {
  const prepareAssets = () => {
    const items = assets.map((asset, index) => ({ id: asset.id || createId(), virtualModelVersionId, slot: asset.slot, assetId: asset.assetId, publicUrl: asset.publicUrl || '', previewAssetId: asset.previewAssetId || '', previewUrl: asset.previewUrl || '', position: Number(asset.position || index + 1), isPrimary: Boolean(asset.isPrimary), validationStatus: asset.validationStatus || 'pending', createdAt: now() }));
    const usedSlots = new Set();
    if (items.some((asset) => !VIRTUAL_MODEL_ASSET_SLOTS.includes(asset.slot) || !asset.assetId || usedSlots.has(asset.slot) || (usedSlots.add(asset.slot), false))) {
      throw Object.assign(new Error('Virtual model assets are invalid'), { code: 'MODEL_ASSET_INVALID' });
    }
    return items;
  };

  if (pool) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.query("SELECT v.status, v.virtual_model_id, v.published_at FROM virtual_model_versions v JOIN virtual_models m ON m.id = v.virtual_model_id AND m.status <> 'deleted' WHERE v.id = ? FOR UPDATE", [virtualModelVersionId]);
      if (!rows[0]) throw Object.assign(new Error('Virtual model not found'), { code: 'MODEL_NOT_FOUND' });
      if (virtualModelId && rows[0].virtual_model_id && rows[0].virtual_model_id !== virtualModelId) throw Object.assign(new Error('Virtual model version not found'), { code: 'MODEL_NOT_FOUND' });
      if (rows[0].status === 'published' || (rows[0].published_at !== null && rows[0].published_at !== undefined)) throw Object.assign(new Error('Published virtual model versions are immutable'), { code: 'MODEL_VERSION_IMMUTABLE' });
      const items = prepareAssets();
      await connection.query('DELETE FROM virtual_model_assets WHERE virtual_model_version_id = ?', [virtualModelVersionId]);
      for (const asset of items) await connection.query('INSERT INTO virtual_model_assets (id, virtual_model_version_id, slot, asset_id, public_url, preview_asset_id, preview_url, position, is_primary, validation_status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [asset.id, asset.virtualModelVersionId, asset.slot, asset.assetId, asset.publicUrl, asset.previewAssetId || null, asset.previewUrl || null, asset.position, asset.isPrimary ? 1 : 0, asset.validationStatus, asset.createdAt]);
      await connection.commit();
      return items;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }
  const normalized = normalizeVirtualModelLocalStore(store);
  const version = normalized.virtualModelVersions.find((item) => item.id === virtualModelVersionId);
  if (!version) throw Object.assign(new Error('Virtual model version not found'), { code: 'MODEL_NOT_FOUND' });
  if (virtualModelId && version.virtualModelId !== virtualModelId) throw Object.assign(new Error('Virtual model version not found'), { code: 'MODEL_NOT_FOUND' });
  const model = normalized.virtualModels.find((item) => item.id === version.virtualModelId && item.status !== 'deleted');
  if (!model) throw Object.assign(new Error('Virtual model not found'), { code: 'MODEL_NOT_FOUND' });
  if (version.status === 'published' || (version.publishedAt !== null && version.publishedAt !== undefined)) throw Object.assign(new Error('Published virtual model versions are immutable'), { code: 'MODEL_VERSION_IMMUTABLE' });
  const items = prepareAssets();
  const retained = normalized.virtualModelAssets.filter((item) => item.virtualModelVersionId !== virtualModelVersionId);
  normalized.virtualModelAssets.splice(0, normalized.virtualModelAssets.length, ...retained, ...items);
  return items;
};

export const publishVirtualModelVersion = async ({ pool = null, store = null, virtualModelId, virtualModelVersionId } = {}) => {
  let version; let assets; let local;
  if (pool) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [modelRows] = await connection.query("SELECT id FROM virtual_models WHERE id = ? AND status <> 'deleted' FOR UPDATE", [virtualModelId]);
      if (!modelRows[0]) throw Object.assign(new Error('Virtual model not found'), { code: 'MODEL_NOT_FOUND' });
      const [versionRows] = await connection.query('SELECT * FROM virtual_model_versions WHERE id = ? AND virtual_model_id = ? FOR UPDATE', [virtualModelVersionId, virtualModelId]);
      version = versionRows[0] && versionFromRow(versionRows[0]);
      if (!version) throw Object.assign(new Error('Virtual model version not found'), { code: 'MODEL_NOT_FOUND' });
      const [assetRows] = await connection.query('SELECT * FROM virtual_model_assets WHERE virtual_model_version_id = ?', [virtualModelVersionId]);
      assets = assetRows.map(assetFromRow);
      const validation = validateVirtualModelVersionForPublish({ assets, identityProfile: version.identityProfile });
      if (!validation.ok) {
        await connection.commit();
        return validation;
      }
      const publishedAt = now();
      const [versionResult] = await connection.query("UPDATE virtual_model_versions SET status = 'published', published_at = ? WHERE id = ? AND virtual_model_id = ?", [publishedAt, virtualModelVersionId, virtualModelId]);
      if (versionResult.affectedRows !== 1) throw Object.assign(new Error('Virtual model version not found'), { code: 'MODEL_NOT_FOUND' });
      await connection.query("UPDATE virtual_model_versions SET status = 'unpublished' WHERE virtual_model_id = ? AND id <> ? AND status = 'published'", [virtualModelId, virtualModelVersionId]);
      const [modelResult] = await connection.query("UPDATE virtual_models SET status = 'published', current_version_id = ?, updated_at = ? WHERE id = ? AND status <> 'deleted'", [virtualModelVersionId, publishedAt, virtualModelId]);
      if (modelResult.affectedRows !== 1) throw Object.assign(new Error('Virtual model not found'), { code: 'MODEL_NOT_FOUND' });
      await connection.commit();
      return { ok: true, publishedAt };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }
  local = getLocalVersionAndAssets(store, virtualModelId, virtualModelVersionId);
  version = local.version;
  assets = local.assets;
  if (!local.model || local.model.status === 'deleted') throw Object.assign(new Error('Virtual model not found'), { code: 'MODEL_NOT_FOUND' });
  if (!version) throw Object.assign(new Error('Virtual model version not found'), { code: 'MODEL_NOT_FOUND' });
  const validation = validateVirtualModelVersionForPublish({ assets, identityProfile: version.identityProfile }); if (!validation.ok) return validation;
  const publishedAt = now();
  const rawVersion = local.normalized.virtualModelVersions.find((item) => item.id === virtualModelVersionId);
  const rawModel = local.normalized.virtualModels.find((item) => item.id === virtualModelId);
  local.normalized.virtualModelVersions.forEach((item) => { if (item.virtualModelId === virtualModelId && item.id !== virtualModelVersionId && item.status === 'published') item.status = 'unpublished'; });
  rawVersion.status = 'published'; rawVersion.publishedAt = publishedAt; rawModel.status = 'published'; rawModel.currentVersionId = virtualModelVersionId; rawModel.updatedAt = publishedAt;
  return { ok: true, publishedAt };
};

export const unpublishVirtualModel = async ({ pool = null, store = null, virtualModelId } = {}) => {
  if (pool) {
    const [result] = await pool.query("UPDATE virtual_models SET status = 'unpublished', current_version_id = NULL, updated_at = ? WHERE id = ? AND status <> 'deleted'", [now(), virtualModelId]);
    if (result.affectedRows !== 1) throw Object.assign(new Error('Virtual model not found'), { code: 'MODEL_NOT_FOUND' });
  } else { const model = normalizeVirtualModelLocalStore(store).virtualModels.find((item) => item.id === virtualModelId && item.status !== 'deleted'); if (!model) throw Object.assign(new Error('Virtual model not found'), { code: 'MODEL_NOT_FOUND' }); model.status = 'unpublished'; model.currentVersionId = null; model.updatedAt = now(); }
  return { ok: true };
};

export const deleteVirtualModel = async ({ pool = null, store = null, virtualModelId } = {}) => {
  const updatedAt = now();
  if (pool) {
    const [result] = await pool.query("UPDATE virtual_models SET status = 'deleted', current_version_id = NULL, updated_at = ? WHERE id = ? AND status <> 'deleted'", [updatedAt, virtualModelId]);
    if (result.affectedRows !== 1) throw Object.assign(new Error('Virtual model not found'), { code: 'MODEL_NOT_FOUND' });
  } else {
    const model = normalizeVirtualModelLocalStore(store).virtualModels.find((item) => item.id === virtualModelId && item.status !== 'deleted');
    if (!model) throw Object.assign(new Error('Virtual model not found'), { code: 'MODEL_NOT_FOUND' });
    model.status = 'deleted';
    model.currentVersionId = null;
    model.updatedAt = updatedAt;
  }
  return { ok: true };
};

export const createVirtualModelGenerationJobSnapshot = async ({ pool = null, store = null, virtualModelId, virtualModelVersionId, referenceAnalysis = null, replacementScope = 'identity_only', allowHistoricalPublishedVersion = false, publishedAt = null, selectedAssetIds = null } = {}) => {
  let model; let version; let assets;
  if (pool) {
    const [rows] = allowHistoricalPublishedVersion
      ? await pool.query('SELECT * FROM virtual_models WHERE id = ?', [virtualModelId])
      : await pool.query('SELECT * FROM virtual_models WHERE id = ? AND status = \'published\' AND current_version_id = ?', [virtualModelId, virtualModelVersionId]);
    model = rows[0] && modelFromRow(rows[0]);
    const [versionRows] = model ? await pool.query(
      allowHistoricalPublishedVersion
        ? 'SELECT * FROM virtual_model_versions WHERE id = ? AND virtual_model_id = ? AND published_at = ?'
        : 'SELECT * FROM virtual_model_versions WHERE id = ? AND virtual_model_id = ? AND status = \'published\'',
      allowHistoricalPublishedVersion ? [virtualModelVersionId, virtualModelId, publishedAt] : [virtualModelVersionId, virtualModelId],
    ) : [[]];
    version = versionRows[0] && versionFromRow(versionRows[0]);
    const [assetRows] = version ? await pool.query('SELECT * FROM virtual_model_assets WHERE virtual_model_version_id = ?', [virtualModelVersionId]) : [[]];
    assets = assetRows.map(assetFromRow);
  } else {
    const local = getLocalVersionAndAssets(store, virtualModelId, virtualModelVersionId);
    model = local.model; version = local.version; assets = local.assets;
    const isCurrentPublished = model?.status === 'published' && model.currentVersionId === virtualModelVersionId && version?.status === 'published';
    const historicalPublishedAt = Number(publishedAt);
    const isHistoricalPublished = allowHistoricalPublishedVersion === true
      && Number.isFinite(historicalPublishedAt)
      && historicalPublishedAt > 0
      && Number(version?.publishedAt) === historicalPublishedAt;
    if (!model || !(isCurrentPublished || isHistoricalPublished)) {
      throw Object.assign(new Error('Virtual model is not published'), { code: 'MODEL_NOT_PUBLISHED' });
    }
  }
  if (!model || !version) throw Object.assign(new Error('Virtual model is not published'), { code: 'MODEL_NOT_PUBLISHED' });
  const validation = validateVirtualModelVersionForPublish({ assets, identityProfile: version.identityProfile });
  if (!validation.ok) throw Object.assign(new Error('Virtual model assets are incomplete'), { code: 'MODEL_ASSET_INCOMPLETE', issues: validation.issues });
  const normalizedReplacementScope = normalizeReplacementScope(replacementScope);
  const selected = selectedAssetsForAnalysis(assets, referenceAnalysis, normalizedReplacementScope);
  const expectedSelectedAssetIds = selected.map((asset) => asset.assetId);
  const historicalSelected = allowHistoricalPublishedVersion === true && Array.isArray(selectedAssetIds)
    ? selectedAssetIds.map((assetId) => assets.find((asset) => asset.assetId === assetId))
    : null;
  const historicalSelectionIsComplete = Array.isArray(selectedAssetIds)
    && [3, 4, 5].includes(selectedAssetIds.length)
    && new Set(selectedAssetIds).size === selectedAssetIds.length
    && Array.isArray(historicalSelected)
    && historicalSelected.every((asset) => Boolean(asset?.assetId));
  const historicalPrimaryIsValid = normalizedReplacementScope === 'full_person'
    ? historicalSelected?.[0]?.isPrimary === true
      || historicalSelected?.[0]?.slot === 'front_full'
      || historicalSelected?.[0]?.slot === 'three_quarter_full'
    : historicalSelected?.[0]?.isPrimary === true;
  if (allowHistoricalPublishedVersion === true && (!historicalSelectionIsComplete || !historicalPrimaryIsValid)) {
    throw Object.assign(new Error('Virtual model snapshot is unavailable'), { code: 'MODEL_SNAPSHOT_UNAVAILABLE' });
  }
  if (allowHistoricalPublishedVersion === true
    && normalizedReplacementScope === 'full_person'
    && !historicalSelected.some((asset) => asset.slot === 'front_full' || asset.slot === 'three_quarter_full')) {
    throw Object.assign(new Error('Full-person source is incomplete'), { code: 'MODEL_FULL_PERSON_SOURCE_INCOMPLETE' });
  }
  const snapshotSelected = historicalSelected || selected;
  const snapshotAssetIds = snapshotSelected.map((asset) => asset.assetId);
  if (allowHistoricalPublishedVersion === true && snapshotAssetIds.some((assetId, index) => assetId !== selectedAssetIds[index])) throw Object.assign(new Error('Virtual model snapshot is unavailable'), { code: 'MODEL_SNAPSHOT_UNAVAILABLE' });
  return { identitySource: 'library', virtualModelId: model.id, virtualModelVersionId: version.id, virtualModelCodeSnapshot: model.code, virtualModelNameSnapshot: model.name, virtualModelCoverAssetId: assets.find((asset) => asset.isPrimary)?.assetId || '', publishedAt: version.publishedAt, selectedAssetIds: snapshotAssetIds, selectedIdentitySlots: snapshotSelected.map((asset) => asset.slot), identityImageCount: snapshotSelected.length, replacementScope: normalizedReplacementScope, identitySelectionStrategy: allowHistoricalPublishedVersion ? 'historical_snapshot' : referenceAnalysis ? 'reference_analysis' : 'fallback', ...(sanitizeIdentityDescription(version.identityProfile) ? { identityDescription: sanitizeIdentityDescription(version.identityProfile) } : {}) };
};

export const resolveHistoricalVirtualModelSelectedAssets = async ({ pool = null, store = null, virtualModelId, virtualModelVersionId, selectedAssetIds = [] } = {}) => {
  let model; let version; let assets;
  if (pool) {
    const [modelRows] = await pool.query('SELECT * FROM virtual_models WHERE id = ?', [virtualModelId]); model = modelRows[0] && modelFromRow(modelRows[0]);
    const [versionRows] = await pool.query('SELECT * FROM virtual_model_versions WHERE id = ? AND virtual_model_id = ?', [virtualModelVersionId, virtualModelId]); version = versionRows[0] && versionFromRow(versionRows[0]);
    const [assetRows] = version ? await pool.query('SELECT * FROM virtual_model_assets WHERE virtual_model_version_id = ?', [virtualModelVersionId]) : [[]]; assets = assetRows.map(assetFromRow);
  } else { const local = getLocalVersionAndAssets(store, virtualModelId, virtualModelVersionId); model = local.model; version = local.version; assets = local.assets; }
  if (!model || !version || !Array.isArray(selectedAssetIds) || ![3, 4, 5].includes(selectedAssetIds.length)) throw Object.assign(new Error('Virtual model snapshot is unavailable'), { code: 'MODEL_SNAPSHOT_UNAVAILABLE' });
  const byId = new Map(assets.map((asset) => [asset.assetId, asset]));
  const selected = selectedAssetIds.map((assetId) => byId.get(assetId));
  if (selected.some((asset) => !asset) || new Set(selectedAssetIds).size !== selectedAssetIds.length) throw Object.assign(new Error('Virtual model snapshot is unavailable'), { code: 'MODEL_SNAPSHOT_UNAVAILABLE' });
  return selected.map((asset) => ({ assetId: asset.assetId, url: asset.publicUrl, slot: asset.slot }));
};
