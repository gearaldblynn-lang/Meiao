import {
  VIRTUAL_MODEL_BASELINE_POSE_IDS,
  extractVirtualModelPoseResultUrl,
} from './virtualModelPoseDefinitions.mjs';

export const ACTIVE_VIRTUAL_MODEL_BATCH_STATUSES = new Set(['queued', 'running', 'retry_waiting', 'persisting', 'failed', 'cancelled', 'regeneration_required', 'ready_to_finalize']);
const BASELINE_POSES = new Set(VIRTUAL_MODEL_BASELINE_POSE_IDS);

const parseJson = (value, fallback) => { try { return typeof value === 'string' ? JSON.parse(value) : value ?? fallback; } catch { return fallback; } };
const strings = (value) => Array.isArray(value) ? value.map((item) => String(item || '').trim()).filter(Boolean) : [];
const batchFromRow = (row = {}) => ({
  id: String(row.id || ''),
  userId: String(row.user_id ?? row.userId ?? ''),
  virtualModelId: String(row.virtual_model_id ?? row.virtualModelId ?? ''),
  virtualModelVersionId: String(row.virtual_model_version_id ?? row.virtualModelVersionId ?? ''),
  clientSubmissionKey: String(row.client_submission_key ?? row.clientSubmissionKey ?? ''),
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
    virtual_model_version_id VARCHAR(24) NOT NULL, client_submission_key VARCHAR(160) NOT NULL,
    source_asset_ids_json LONGTEXT NOT NULL,
    primary_source_asset_id VARCHAR(24) NOT NULL, status VARCHAR(30) NOT NULL, pose_tasks_json LONGTEXT NOT NULL,
    baseline_revision INT NOT NULL DEFAULT 1, derived_regeneration_required TINYINT(1) NOT NULL DEFAULT 0,
    finalization_result_json LONGTEXT NULL, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL, finalized_at BIGINT NULL,
    INDEX idx_virtual_model_generation_user_status (user_id, status),
    INDEX idx_virtual_model_generation_target (virtual_model_id, virtual_model_version_id),
    UNIQUE INDEX uq_virtual_model_generation_submission (user_id, client_submission_key)
  ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  for (const [name, definition] of [
    ['client_submission_key', 'VARCHAR(160) NULL AFTER virtual_model_version_id'],
    ['baseline_revision', 'INT NOT NULL DEFAULT 1 AFTER pose_tasks_json'],
    ['derived_regeneration_required', 'TINYINT(1) NOT NULL DEFAULT 0 AFTER baseline_revision'],
  ]) {
    const [rows] = await pool.query("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'virtual_model_generation_batches' AND COLUMN_NAME = ?", [name]);
    if (!rows.length) await pool.query(`ALTER TABLE virtual_model_generation_batches ADD COLUMN ${name} ${definition}`);
  }
  const [indexes] = await pool.query("SELECT INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'virtual_model_generation_batches' AND INDEX_NAME = 'uq_virtual_model_generation_submission'");
  if (!indexes.length) await pool.query('ALTER TABLE virtual_model_generation_batches ADD UNIQUE INDEX uq_virtual_model_generation_submission (user_id, client_submission_key)');
};

export const createVirtualModelGenerationBatchRecord = async ({ pool = null, store = null, batch } = {}) => {
  const record = batchFromRow(batch);
  if (!record.id || !record.userId || !record.virtualModelId || !record.virtualModelVersionId || !record.clientSubmissionKey) throw Object.assign(new Error('Virtual model generation batch is invalid'), { code: 'MODEL_GENERATION_BATCH_INVALID' });
  if (pool) {
    try {
      await pool.query('INSERT INTO virtual_model_generation_batches (id, user_id, virtual_model_id, virtual_model_version_id, client_submission_key, source_asset_ids_json, primary_source_asset_id, status, pose_tasks_json, baseline_revision, derived_regeneration_required, finalization_result_json, created_at, updated_at, finalized_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [record.id, record.userId, record.virtualModelId, record.virtualModelVersionId, record.clientSubmissionKey, JSON.stringify(record.sourceAssetIds), record.primarySourceAssetId, record.status, JSON.stringify(record.poseTasks), record.baselineRevision, record.derivedRegenerationRequired ? 1 : 0, record.finalizationResult === null ? null : JSON.stringify(record.finalizationResult), record.createdAt, record.updatedAt, record.finalizedAt]);
    } catch (error) { if (error?.code === 'ER_DUP_ENTRY') throw Object.assign(new Error('Virtual model generation batch already exists'), { code: 'MODEL_GENERATION_BATCH_INVALID' }); throw error; }
    return record;
  }
  const target = normalizeVirtualModelGenerationStore(store);
  if (target.virtualModelGenerationBatches.some((item) => item.id === record.id)) throw Object.assign(new Error('Virtual model generation batch already exists'), { code: 'MODEL_GENERATION_BATCH_INVALID' });
  target.virtualModelGenerationBatches.push(record);
  return batchFromRow(record);
};

const assertSubmissionTarget = (existing, incoming) => {
  if (
    existing.virtualModelId !== incoming.virtualModelId
    || existing.virtualModelVersionId !== incoming.virtualModelVersionId
  ) {
    throw Object.assign(new Error('Virtual model generation submission key is already used for another target'), {
      code: 'MODEL_GENERATION_SUBMISSION_KEY_CONFLICT',
    });
  }
};

const findBySubmissionKey = async ({ pool = null, store = null, userId, clientSubmissionKey }) => {
  if (pool) {
    const [rows] = await pool.query(
      'SELECT * FROM virtual_model_generation_batches WHERE user_id = ? AND client_submission_key = ? LIMIT 1',
      [userId, clientSubmissionKey],
    );
    return rows[0] ? batchFromRow(rows[0]) : null;
  }
  const item = normalizeVirtualModelGenerationStore(store).virtualModelGenerationBatches.find((batch) => (
    String(batch.userId ?? batch.user_id) === String(userId)
    && String(batch.clientSubmissionKey ?? batch.client_submission_key ?? '') === String(clientSubmissionKey)
  ));
  return item ? batchFromRow(item) : null;
};

export const findOrCreateVirtualModelGenerationBatchRecord = async ({
  pool = null,
  store = null,
  batch,
} = {}) => {
  const record = batchFromRow(batch);
  if (!record.clientSubmissionKey) {
    throw Object.assign(new Error('Virtual model generation submission key is required'), {
      code: 'MODEL_GENERATION_BATCH_INVALID',
    });
  }
  if (!pool) {
    const target = normalizeVirtualModelGenerationStore(store);
    const existingItem = target.virtualModelGenerationBatches.find((item) => (
      String(item.userId ?? item.user_id) === record.userId
      && String(item.clientSubmissionKey ?? item.client_submission_key ?? '') === record.clientSubmissionKey
    ));
    if (existingItem) {
      const existing = batchFromRow(existingItem);
      assertSubmissionTarget(existing, record);
      return { batch: existing, created: false };
    }
    target.virtualModelGenerationBatches.push(record);
    return { batch: batchFromRow(record), created: true };
  }
  const existing = await findBySubmissionKey({
    pool,
    userId: record.userId,
    clientSubmissionKey: record.clientSubmissionKey,
  });
  if (existing) {
    assertSubmissionTarget(existing, record);
    return { batch: existing, created: false };
  }
  try {
    return {
      batch: await createVirtualModelGenerationBatchRecord({ pool, store, batch: record }),
      created: true,
    };
  } catch (error) {
    if (pool && error?.code === 'MODEL_GENERATION_BATCH_INVALID') {
      const winner = await findBySubmissionKey({
        pool,
        userId: record.userId,
        clientSubmissionKey: record.clientSubmissionKey,
      });
      if (winner) {
        assertSubmissionTarget(winner, record);
        return { batch: winner, created: false };
      }
    }
    throw error;
  }
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

const advancePoseAttempt = (batch, { poseId, expectedAttempt, taskPatch, batchPatch }) => {
  const index = batch.poseTasks.findIndex((task) => task?.poseId === poseId);
  const current = batch.poseTasks[index];
  if (index < 0 || Number(current?.attempt || 1) !== Number(expectedAttempt)) return null;
  const nextTask = {
    poseId: current.poseId,
    slot: current.slot,
    label: current.label,
    attempt: Number(expectedAttempt) + 1,
    ...taskPatch,
  };
  return {
    ...batch,
    ...batchPatch,
    poseTasks: batch.poseTasks.map((task, taskIndex) => taskIndex === index ? nextTask : task),
  };
};

export const advanceVirtualModelGenerationPoseAttempt = async ({
  pool = null,
  store = null,
  batchId,
  userId,
  poseId,
  expectedAttempt,
  taskPatch = {},
  batchPatch = {},
  maxAttempts = 3,
} = {}) => {
  if (!pool) {
    const target = normalizeVirtualModelGenerationStore(store);
    const index = target.virtualModelGenerationBatches.findIndex((batch) => (
      batch.id === batchId && String(batch.userId ?? batch.user_id) === String(userId)
    ));
    if (index < 0) return null;
    const next = advancePoseAttempt(batchFromRow(target.virtualModelGenerationBatches[index]), {
      poseId,
      expectedAttempt,
      taskPatch,
      batchPatch,
    });
    if (!next) return null;
    target.virtualModelGenerationBatches[index] = next;
    return batchFromRow(next);
  }
  for (let attempt = 0; attempt < Math.max(1, Number(maxAttempts) || 1); attempt += 1) {
    const [rows] = await pool.query(
      'SELECT * FROM virtual_model_generation_batches WHERE id = ? AND user_id = ? LIMIT 1',
      [batchId, userId],
    );
    const row = rows[0];
    const raw = row?.pose_tasks_json;
    if (!row || typeof raw !== 'string') return null;
    const current = batchFromRow(row);
    const next = advancePoseAttempt(current, {
      poseId,
      expectedAttempt,
      taskPatch,
      batchPatch,
    });
    if (!next) return null;
    const [result] = await pool.query(
      'UPDATE virtual_model_generation_batches SET pose_tasks_json = ?, status = ?, updated_at = ? WHERE id = ? AND user_id = ? AND pose_tasks_json = ?',
      [
        JSON.stringify(next.poseTasks),
        next.status,
        next.updatedAt,
        batchId,
        userId,
        raw,
      ],
    );
    if (result.affectedRows === 1) return next;
  }
  return null;
};

const claimableTaskIndex = (poseTasks, poseId, baselineRevision, idempotencyKey) => poseTasks.findIndex((task) => (
  task?.poseId === poseId
  && task.status === 'pending'
  && !task.jobId
  && !task.submitClaim
  && (!Object.hasOwn(task, 'baselineRevision') || Number(task.baselineRevision) === Number(baselineRevision))
  && String(idempotencyKey || '').trim()
));

const claimPatch = (poseTasks, index, { idempotencyKey, baselineRevision, claimedAt }) => poseTasks.map((task, taskIndex) => taskIndex === index ? {
  ...task,
  submitClaim: { idempotencyKey, baselineRevision, claimedAt },
} : task);

export const claimVirtualModelGenerationPoseSubmission = async ({
  pool = null,
  store = null,
  batchId,
  userId,
  poseId,
  baselineRevision,
  idempotencyKey,
  claimedAt,
} = {}) => {
  if (!String(batchId || '').trim() || !String(userId || '').trim() || !String(poseId || '').trim() || !String(idempotencyKey || '').trim()) return false;
  if (pool) {
    const [rows] = await pool.query('SELECT pose_tasks_json FROM virtual_model_generation_batches WHERE id = ? AND user_id = ? LIMIT 1', [batchId, userId]);
    const raw = rows[0]?.pose_tasks_json;
    const poseTasks = parseJson(raw, []);
    const index = claimableTaskIndex(poseTasks, poseId, baselineRevision, idempotencyKey);
    if (index < 0 || typeof raw !== 'string') return false;
    const nextPoseTasks = claimPatch(poseTasks, index, { idempotencyKey, baselineRevision, claimedAt });
    const [result] = await pool.query(
      'UPDATE virtual_model_generation_batches SET pose_tasks_json = ?, updated_at = ? WHERE id = ? AND user_id = ? AND pose_tasks_json = ?',
      [JSON.stringify(nextPoseTasks), claimedAt, batchId, userId, raw],
    );
    return result.affectedRows === 1;
  }
  const target = normalizeVirtualModelGenerationStore(store);
  const batch = target.virtualModelGenerationBatches.find((item) => item.id === batchId && String(item.userId ?? item.user_id) === String(userId));
  const poseTasks = batch?.poseTasks;
  const index = claimableTaskIndex(poseTasks, poseId, baselineRevision, idempotencyKey);
  if (index < 0) return false;
  batch.poseTasks = claimPatch(poseTasks, index, { idempotencyKey, baselineRevision, claimedAt });
  batch.updatedAt = claimedAt;
  return true;
};

export const failVirtualModelGenerationPoseSubmission = async ({
  pool = null,
  store = null,
  batchId,
  userId,
  poseId,
  idempotencyKey,
  failedAt,
  errorCode = 'MODEL_GENERATION_SUBMISSION_FAILED',
  errorMessage = 'Virtual model generation submission failed',
} = {}) => {
  const failTask = (tasks) => tasks.map((task) => task?.poseId === poseId && task?.submitClaim?.idempotencyKey === idempotencyKey ? {
    ...task, status: 'failed', submitClaim: undefined, errorCode, errorMessage,
  } : task);
  if (pool) {
    const [rows] = await pool.query('SELECT pose_tasks_json FROM virtual_model_generation_batches WHERE id = ? AND user_id = ? LIMIT 1', [batchId, userId]);
    const raw = rows[0]?.pose_tasks_json;
    const poseTasks = parseJson(raw, []);
    if (typeof raw !== 'string' || !poseTasks.some((task) => task?.poseId === poseId && task?.submitClaim?.idempotencyKey === idempotencyKey)) return false;
    const [result] = await pool.query('UPDATE virtual_model_generation_batches SET pose_tasks_json = ?, updated_at = ? WHERE id = ? AND user_id = ? AND pose_tasks_json = ?', [JSON.stringify(failTask(poseTasks)), failedAt, batchId, userId, raw]);
    return result.affectedRows === 1;
  }
  const batch = normalizeVirtualModelGenerationStore(store).virtualModelGenerationBatches.find((item) => item.id === batchId && String(item.userId ?? item.user_id) === String(userId));
  if (!batch?.poseTasks?.some((task) => task?.poseId === poseId && task?.submitClaim?.idempotencyKey === idempotencyKey)) return false;
  batch.poseTasks = failTask(batch.poseTasks);
  batch.updatedAt = failedAt;
  return true;
};

const bindClaimedPoseTask = (poseTasks, { poseId, idempotencyKey, job, baselineRevision }) => {
  const index = poseTasks.findIndex((task) => task?.poseId === poseId && task?.submitClaim?.idempotencyKey === idempotencyKey);
  if (index < 0) return null;
  const current = poseTasks[index];
  if (current.jobId && current.jobId !== job?.id) return null;
  const providerStatus = String(job?.status || 'queued');
  const resultUrl = providerStatus === 'succeeded'
    ? extractVirtualModelPoseResultUrl(job?.result || {})
    : '';
  const status = providerStatus === 'succeeded' && !resultUrl
    ? 'failed'
    : providerStatus === 'cancelled'
      ? 'cancelled'
      : providerStatus === 'failed'
        ? 'failed'
        : providerStatus;
  const next = poseTasks.map((task, taskIndex) => taskIndex === index ? {
    ...task,
    status,
    jobId: String(job?.id || ''),
    submitClaim: undefined,
    retryRequested: undefined,
    ...(Object.hasOwn(task, 'baselineRevision') ? { baselineRevision } : {}),
    ...(resultUrl && BASELINE_POSES.has(poseId)
      ? { temporaryResultUrl: resultUrl, referenceStatus: 'generated' }
      : resultUrl ? { resultUrl } : {}),
    ...(['failed', 'cancelled'].includes(status) ? {
      errorCode: String(job?.errorCode || (status === 'cancelled'
        ? 'MODEL_GENERATION_CANCELLED'
        : 'MODEL_GENERATION_RESULT_UNAVAILABLE')),
      errorMessage: String(job?.errorMessage || (status === 'cancelled'
        ? '姿势图片生成已取消'
        : '姿势图片生成失败')),
    } : {
      errorCode: undefined,
      errorMessage: undefined,
    }),
  } : task);
  return { index, poseTasks: next };
};

export const bindVirtualModelGenerationPoseJob = async ({
  pool = null,
  store = null,
  batchId,
  userId,
  poseId,
  idempotencyKey,
  job,
  baselineRevision,
  boundAt,
  maxAttempts = 3,
} = {}) => {
  if (!String(job?.id || '').trim()) return null;
  if (!pool) {
    const batch = normalizeVirtualModelGenerationStore(store).virtualModelGenerationBatches.find((item) => item.id === batchId && String(item.userId ?? item.user_id) === String(userId));
    const binding = bindClaimedPoseTask(batch?.poseTasks || [], { poseId, idempotencyKey, job, baselineRevision });
    if (!batch || !binding) return null;
    batch.poseTasks = binding.poseTasks;
    batch.updatedAt = boundAt;
    return batchFromRow(batch);
  }
  for (let attempt = 0; attempt < Math.max(1, Number(maxAttempts) || 1); attempt += 1) {
    const [rows] = await pool.query('SELECT * FROM virtual_model_generation_batches WHERE id = ? AND user_id = ? LIMIT 1', [batchId, userId]);
    const row = rows[0];
    const raw = row?.pose_tasks_json;
    const poseTasks = parseJson(raw, []);
    const binding = typeof raw === 'string' ? bindClaimedPoseTask(poseTasks, { poseId, idempotencyKey, job, baselineRevision }) : null;
    if (!binding) return null;
    const [result] = await pool.query(
      'UPDATE virtual_model_generation_batches SET pose_tasks_json = ?, updated_at = ? WHERE id = ? AND user_id = ? AND pose_tasks_json = ?',
      [JSON.stringify(binding.poseTasks), boundAt, batchId, userId, raw],
    );
    if (result.affectedRows === 1) return batchFromRow({ ...row, pose_tasks_json: JSON.stringify(binding.poseTasks), updated_at: boundAt });
  }
  return null;
};

export const listActiveVirtualModelGenerationSourceAssetIds = async ({ pool = null, store = null } = {}) => {
  const batches = pool ? (await pool.query(`SELECT source_asset_ids_json, pose_tasks_json FROM virtual_model_generation_batches WHERE status IN (${[...ACTIVE_VIRTUAL_MODEL_BATCH_STATUSES].map(() => '?').join(',')})`, [...ACTIVE_VIRTUAL_MODEL_BATCH_STATUSES]))[0] : normalizeVirtualModelGenerationStore(store).virtualModelGenerationBatches.filter((batch) => ACTIVE_VIRTUAL_MODEL_BATCH_STATUSES.has(String(batch.status)));
  return [...new Set(batches.flatMap((batch) => [...strings(parseJson(batch.sourceAssetIds ?? batch.source_asset_ids_json, [])), ...(parseJson(batch.poseTasks ?? batch.pose_tasks_json, []) || []).map((task) => String(task?.managedReferenceAsset?.assetId || '')).filter(Boolean)]))];
};

export const listActiveVirtualModelGenerationProtectedAssetReferences = async ({
  pool = null,
  store = null,
  assets = [],
} = {}) => {
  const referencedIds = new Set(await listActiveVirtualModelGenerationSourceAssetIds({
    pool,
    store,
  }));
  const protectedReferences = new Set();
  for (const asset of assets || []) {
    const assetId = String(asset?.id || '');
    if (!referencedIds.has(assetId)) continue;
    protectedReferences.add(assetId);
    if (asset?.publicUrl) protectedReferences.add(String(asset.publicUrl));
  }
  return protectedReferences;
};
