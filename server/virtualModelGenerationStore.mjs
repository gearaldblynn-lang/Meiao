export const ACTIVE_VIRTUAL_MODEL_BATCH_STATUSES = new Set(['queued', 'running', 'retry_waiting', 'persisting', 'failed', 'cancelled', 'regeneration_required', 'ready_to_finalize']);

const parseJson = (value, fallback) => { try { return typeof value === 'string' ? JSON.parse(value) : value ?? fallback; } catch { return fallback; } };
const strings = (value) => Array.isArray(value) ? value.map((item) => String(item || '').trim()).filter(Boolean) : [];
const batchFromRow = (row = {}) => ({
  id: String(row.id || ''),
  userId: String(row.user_id ?? row.userId ?? ''),
  virtualModelId: String(row.virtual_model_id ?? row.virtualModelId ?? ''),
  virtualModelVersionId: String(row.virtual_model_version_id ?? row.virtualModelVersionId ?? ''),
  sourceAssetIds: strings(parseJson(row.source_asset_ids_json ?? row.sourceAssetIds, [])),
  primarySourceAssetId: String(row.primary_source_asset_id ?? row.primarySourceAssetId ?? ''),
  status: String(row.status || 'queued'),
  poseTasks: parseJson(row.pose_tasks_json ?? row.poseTasks, []),
  baselineRevision: Math.max(1, Number(row.baseline_revision ?? row.baselineRevision ?? 1) || 1),
  derivedRegenerationRequired: Boolean(Number(row.derived_regeneration_required ?? row.derivedRegenerationRequired ?? 0)),
  createdAt: Number(row.created_at ?? row.createdAt ?? 0),
  updatedAt: Number(row.updated_at ?? row.updatedAt ?? 0),
  finalizedAt: row.finalized_at ?? row.finalizedAt ?? null,
  finalizationResult: parseJson(row.finalization_result_json ?? row.finalizationResult, null),
});

export const normalizeVirtualModelGenerationStore = (store = {}) => {
  const target = store && typeof store === 'object' ? store : {};
  target.virtualModelGenerationBatches = Array.isArray(target.virtualModelGenerationBatches) ? target.virtualModelGenerationBatches : [];
  return target;
};

export const ensureVirtualModelGenerationSchema = async (pool) => {
  if (!pool) return;
  await pool.query(`CREATE TABLE IF NOT EXISTS virtual_model_generation_batches (
    id VARCHAR(24) PRIMARY KEY, user_id VARCHAR(24) NOT NULL, virtual_model_id VARCHAR(24) NOT NULL,
    virtual_model_version_id VARCHAR(24) NOT NULL, source_asset_ids_json LONGTEXT NOT NULL,
    primary_source_asset_id VARCHAR(24) NOT NULL, status VARCHAR(30) NOT NULL, pose_tasks_json LONGTEXT NOT NULL,
    baseline_revision INT NOT NULL DEFAULT 1, derived_regeneration_required TINYINT(1) NOT NULL DEFAULT 0,
    finalization_result_json LONGTEXT NULL, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL, finalized_at BIGINT NULL,
    INDEX idx_virtual_model_generation_user_status (user_id, status),
    INDEX idx_virtual_model_generation_target (virtual_model_id, virtual_model_version_id)
  ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  for (const [name, definition] of [['baseline_revision', 'INT NOT NULL DEFAULT 1 AFTER pose_tasks_json'], ['derived_regeneration_required', 'TINYINT(1) NOT NULL DEFAULT 0 AFTER baseline_revision']]) {
    const [rows] = await pool.query("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'virtual_model_generation_batches' AND COLUMN_NAME = ?", [name]);
    if (!rows.length) await pool.query(`ALTER TABLE virtual_model_generation_batches ADD COLUMN ${name} ${definition}`);
  }
};

export const createVirtualModelGenerationBatchRecord = async ({ pool = null, store = null, batch } = {}) => {
  const record = batchFromRow(batch);
  if (!record.id || !record.userId || !record.virtualModelId || !record.virtualModelVersionId) throw Object.assign(new Error('Virtual model generation batch is invalid'), { code: 'MODEL_GENERATION_BATCH_INVALID' });
  if (pool) {
    try {
      await pool.query('INSERT INTO virtual_model_generation_batches (id, user_id, virtual_model_id, virtual_model_version_id, source_asset_ids_json, primary_source_asset_id, status, pose_tasks_json, baseline_revision, derived_regeneration_required, finalization_result_json, created_at, updated_at, finalized_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [record.id, record.userId, record.virtualModelId, record.virtualModelVersionId, JSON.stringify(record.sourceAssetIds), record.primarySourceAssetId, record.status, JSON.stringify(record.poseTasks), record.baselineRevision, record.derivedRegenerationRequired ? 1 : 0, record.finalizationResult === null ? null : JSON.stringify(record.finalizationResult), record.createdAt, record.updatedAt, record.finalizedAt]);
    } catch (error) { if (error?.code === 'ER_DUP_ENTRY') throw Object.assign(new Error('Virtual model generation batch already exists'), { code: 'MODEL_GENERATION_BATCH_INVALID' }); throw error; }
    return record;
  }
  const target = normalizeVirtualModelGenerationStore(store);
  if (target.virtualModelGenerationBatches.some((item) => item.id === record.id)) throw Object.assign(new Error('Virtual model generation batch already exists'), { code: 'MODEL_GENERATION_BATCH_INVALID' });
  target.virtualModelGenerationBatches.push(record);
  return batchFromRow(record);
};

export const getVirtualModelGenerationBatch = async ({ pool = null, store = null, batchId, userId } = {}) => {
  if (pool) {
    const [rows] = await pool.query('SELECT * FROM virtual_model_generation_batches WHERE id = ? AND user_id = ? LIMIT 1', [batchId, userId]);
    return rows[0] ? batchFromRow(rows[0]) : null;
  }
  const item = normalizeVirtualModelGenerationStore(store).virtualModelGenerationBatches.find((batch) => batch.id === batchId && String(batch.userId ?? batch.user_id) === String(userId));
  return item ? batchFromRow(item) : null;
};

export const findLatestVirtualModelGenerationBatch = async ({ pool = null, store = null, userId, virtualModelId, virtualModelVersionId } = {}) => {
  if (pool) {
    const [rows] = await pool.query('SELECT * FROM virtual_model_generation_batches WHERE user_id = ? AND virtual_model_id = ? AND virtual_model_version_id = ? ORDER BY updated_at DESC, created_at DESC LIMIT 1', [userId, virtualModelId, virtualModelVersionId]);
    return rows[0] ? batchFromRow(rows[0]) : null;
  }
  return normalizeVirtualModelGenerationStore(store).virtualModelGenerationBatches.map(batchFromRow).filter((batch) => batch.userId === String(userId) && batch.virtualModelId === String(virtualModelId) && batch.virtualModelVersionId === String(virtualModelVersionId)).sort((left, right) => right.updatedAt - left.updatedAt || right.createdAt - left.createdAt)[0] || null;
};

const columns = { status: 'status', poseTasks: 'pose_tasks_json', baselineRevision: 'baseline_revision', derivedRegenerationRequired: 'derived_regeneration_required', updatedAt: 'updated_at', finalizedAt: 'finalized_at', finalizationResult: 'finalization_result_json' };
export const updateVirtualModelGenerationBatchRecord = async ({ pool = null, store = null, batchId, userId, patch = {} } = {}) => {
  const keys = Object.keys(patch);
  if (!keys.length || keys.some((key) => !columns[key])) throw Object.assign(new Error('Virtual model generation batch update is invalid'), { code: 'MODEL_GENERATION_BATCH_INVALID' });
  const current = await getVirtualModelGenerationBatch({ pool, store, batchId, userId });
  if (!current) throw Object.assign(new Error('Virtual model generation batch not found'), { code: 'MODEL_GENERATION_BATCH_NOT_FOUND' });
  const normalized = Object.fromEntries(keys.map((key) => [key, key === 'poseTasks' ? (Array.isArray(patch[key]) ? patch[key] : []) : key === 'baselineRevision' ? Math.max(1, Number(patch[key]) || 1) : key === 'derivedRegenerationRequired' ? Boolean(patch[key]) : patch[key]]));
  if (pool) {
    const values = keys.map((key) => key === 'poseTasks' || key === 'finalizationResult' ? (normalized[key] === null ? null : JSON.stringify(normalized[key])) : key === 'derivedRegenerationRequired' ? (normalized[key] ? 1 : 0) : normalized[key]);
    const [result] = await pool.query(`UPDATE virtual_model_generation_batches SET ${keys.map((key) => `${columns[key]} = ?`).join(', ')} WHERE id = ? AND user_id = ?`, [...values, batchId, userId]);
    if (result.affectedRows !== 1) throw Object.assign(new Error('Virtual model generation batch not found'), { code: 'MODEL_GENERATION_BATCH_NOT_FOUND' });
    return batchFromRow({ ...current, ...normalized });
  }
  const target = normalizeVirtualModelGenerationStore(store);
  const index = target.virtualModelGenerationBatches.findIndex((batch) => batch.id === batchId && String(batch.userId ?? batch.user_id) === String(userId));
  if (index < 0) throw Object.assign(new Error('Virtual model generation batch not found'), { code: 'MODEL_GENERATION_BATCH_NOT_FOUND' });
  target.virtualModelGenerationBatches[index] = { ...target.virtualModelGenerationBatches[index], ...normalized };
  return batchFromRow(target.virtualModelGenerationBatches[index]);
};

export const listActiveVirtualModelGenerationSourceAssetIds = async ({ pool = null, store = null } = {}) => {
  const batches = pool ? (await pool.query(`SELECT source_asset_ids_json, pose_tasks_json FROM virtual_model_generation_batches WHERE status IN (${[...ACTIVE_VIRTUAL_MODEL_BATCH_STATUSES].map(() => '?').join(',')})`, [...ACTIVE_VIRTUAL_MODEL_BATCH_STATUSES]))[0] : normalizeVirtualModelGenerationStore(store).virtualModelGenerationBatches.filter((batch) => ACTIVE_VIRTUAL_MODEL_BATCH_STATUSES.has(String(batch.status)));
  return [...new Set(batches.flatMap((batch) => [...strings(parseJson(batch.sourceAssetIds ?? batch.source_asset_ids_json, [])), ...(parseJson(batch.poseTasks ?? batch.pose_tasks_json, []) || []).map((task) => String(task?.managedReferenceAsset?.assetId || '')).filter(Boolean)]))];
};
