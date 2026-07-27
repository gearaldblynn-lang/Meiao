import { createHash } from 'node:crypto';

import {
  getVoiceoverConfig,
  mergeVoiceoverCheckpoint,
  normalizeVoiceoverCheckpoint,
  prepareVoiceoverRetryCheckpoint,
} from './voiceoverContract.mjs';
import {
  getJobSubmissionLockTimeoutSeconds,
  resolveJobSubmissionPolicy,
} from './jobSubmissionPolicy.mjs';
import {
  getVoiceoverLanguage,
  getVoiceoverVoice,
} from '../src/utils/voiceoverCatalog.mjs';
import { normalizeManagedAssetIdentity } from './managedAssetIdentity.mjs';

const CHILD_MAX_SERIALIZED_BYTES = 256 * 1024;
const CHILD_TERMINAL_STATUSES = new Set(['succeeded', 'failed', 'cancelled']);
const CHILD_KEY_TTS = /^tts:(0|[1-9]\d?):attempt:(0|[1-9]\d{0,2})$/u;
const CHILD_KEY_GOLDEN = /^golden:attempt:(0|[1-9]\d{0,2})$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u;

export const PARENT_OWNED_CHILD_SQL_EXCLUSION = `COALESCE(
  JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.executionOwner')),
  ''
) <> 'parent'`;
const PARENT_OWNED_CHILD_SQL_MATCH = `JSON_UNQUOTE(
  JSON_EXTRACT(payload_json, '$.executionOwner')
) = 'parent'`;

const cloneValue = (value) => JSON.parse(JSON.stringify(value ?? null));

const createStoreError = (code, message, statusCode = 409) => Object.assign(
  new Error(message),
  { code, statusCode },
);

const assertKnownKeys = (value, allowed, code = 'child_job_invalid') => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw createStoreError(code, '父子任务数据无效。', 400);
  }
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw createStoreError(code, `父子任务包含未允许字段：${key}`, 400);
    }
  }
};

const parseJson = (value, fallback = null) => {
  if (value && typeof value === 'object') return cloneValue(value);
  if (typeof value !== 'string' || !value.trim()) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};

const mapJobRow = (row = {}) => ({
  id: String(row.id || ''),
  userId: String(row.userId ?? row.user_id ?? ''),
  module: String(row.module || ''),
  taskType: String(row.taskType ?? row.task_type ?? ''),
  provider: String(row.provider || ''),
  status: String(row.status || ''),
  priority: Number(row.priority || 0),
  payload: parseJson(row.payload ?? row.payload_json, {}),
  providerTaskId: String(row.providerTaskId ?? row.provider_task_id ?? ''),
  result: parseJson(row.result ?? row.result_json, null),
  errorCode: String(row.errorCode ?? row.error_code ?? ''),
  errorMessage: String(row.errorMessage ?? row.error_message ?? ''),
  errorDetail: String(row.errorDetail ?? row.error_detail ?? ''),
  retryCount: Number(row.retryCount ?? row.retry_count ?? 0),
  maxRetries: Number(row.maxRetries ?? row.max_retries ?? 0),
  createdAt: Number(row.createdAt ?? row.created_at ?? 0),
  updatedAt: Number(row.updatedAt ?? row.updated_at ?? 0),
  startedAt: row.startedAt !== undefined
    ? row.startedAt
    : row.started_at === null || row.started_at === undefined
      ? null
      : Number(row.started_at),
  finishedAt: row.finishedAt !== undefined
    ? row.finishedAt
    : row.finished_at === null || row.finished_at === undefined
      ? null
      : Number(row.finished_at),
  cancelRequestedAt: row.cancelRequestedAt !== undefined
    ? row.cancelRequestedAt
    : row.cancel_requested_at === null || row.cancel_requested_at === undefined
      ? null
      : Number(row.cancel_requested_at),
});

const childSubmissionKey = (parentJobId, childKey) => `voiceover-child:${parentJobId}:${childKey}`;

export const buildVoiceoverChildJobId = (parentJobId, childKey) => {
  const parentId = assertSafeId(parentJobId, 'parentJobId', 'voiceover_retry_invalid');
  const normalizedChildKey = String(childKey || '').trim();
  if (!CHILD_KEY_TTS.test(normalizedChildKey) && !CHILD_KEY_GOLDEN.test(normalizedChildKey)) {
    throw createStoreError('voiceover_retry_invalid', '口播翻译子任务身份无效。', 400);
  }
  const digest = createHash('sha256')
    .update(`${parentId}\0${normalizedChildKey}`)
    .digest('hex')
    .slice(0, 32);
  return `voiceover-child-${digest}`;
};

export const isParentOwnedChildJob = (job) => {
  const payload = job?.payload && typeof job.payload === 'object'
    ? job.payload
    : parseJson(job?.payload_json, {});
  const parentJobId = String(payload?.parentJobId || '').trim();
  const childKey = String(payload?.childKey || '').trim();
  return payload?.executionOwner === 'parent'
    && Boolean(parentJobId)
    && Boolean(childKey)
    && String(payload?.clientSubmissionKey || '').trim() === childSubmissionKey(parentJobId, childKey);
};

export const assertGenericJobMutationAllowed = (job) => {
  if (isParentOwnedChildJob(job)) {
    throw createStoreError(
      'parent_owned_child_immutable',
      '父任务持有的子任务只能由口播翻译账本更新。',
      409,
    );
  }
  return job;
};

const assertVoiceoverParent = (job, expected = {}) => {
  const normalized = mapJobRow(job);
  if (
    normalized.id !== String(expected.id || normalized.id)
    || normalized.userId !== String(expected.userId || normalized.userId)
  ) {
    throw createStoreError('parent_job_forbidden', '口播翻译父任务归属已变化。', 403);
  }
  if (
    normalized.module !== 'video'
    || normalized.taskType !== 'voiceover_translate_video'
    || normalized.provider !== 'internal'
    || normalized.status !== 'running'
    || normalized.payload?.taskPurpose !== 'voiceover_translation'
  ) {
    throw createStoreError('parent_job_ineligible', '当前口播翻译父任务不能创建子任务。');
  }
  return normalized;
};

const resolveCheckpointOptions = (job, {
  env = process.env,
  resolveVoiceoverConfig = getVoiceoverConfig,
} = {}) => {
  const config = resolveVoiceoverConfig(env, job);
  return {
    ...config,
    removeText: job?.payload?.removeText === true,
  };
};

const normalizeResultCheckpointPatch = (resultPatch) => {
  assertKnownKeys(
    resultPatch,
    new Set(['voiceoverCheckpoint']),
    'voiceover_checkpoint_invalid',
  );
  if (!resultPatch.voiceoverCheckpoint || typeof resultPatch.voiceoverCheckpoint !== 'object') {
    throw createStoreError('voiceover_checkpoint_invalid', '口播翻译检查点缺失。', 400);
  }
  return resultPatch.voiceoverCheckpoint;
};

const mergeParentCheckpointResult = (job, resultPatch, options = {}) => {
  const checkpointPatch = normalizeResultCheckpointPatch(resultPatch);
  const checkpointOptions = resolveCheckpointOptions(job, options);
  const currentResult = job.result && typeof job.result === 'object' ? job.result : {};
  const currentCheckpoint = currentResult.voiceoverCheckpoint;
  const voiceoverCheckpoint = currentCheckpoint
    ? mergeVoiceoverCheckpoint(currentCheckpoint, checkpointPatch, checkpointOptions)
    : normalizeVoiceoverCheckpoint(checkpointPatch, checkpointOptions);
  return {
    ...cloneValue(currentResult),
    voiceoverCheckpoint,
  };
};

const assertSameRunningClaim = (job, { jobId, userId, startedAt }) => {
  const normalized = mapJobRow(job);
  if (
    normalized.id !== String(jobId || '')
    || normalized.userId !== String(userId || '')
    || normalized.status !== 'running'
    || Number(normalized.startedAt) !== Number(startedAt)
  ) {
    throw createStoreError('job_state_changed', '任务执行归属已变化，检查点未写入。');
  }
  if (
    normalized.module !== 'video'
    || normalized.taskType !== 'voiceover_translate_video'
    || normalized.provider !== 'internal'
  ) {
    throw createStoreError('voiceover_checkpoint_forbidden', '只有运行中的口播翻译父任务可以写检查点。', 403);
  }
  return normalized;
};

export const persistLocalVoiceoverParentCheckpoint = (store, {
  jobId,
  userId,
  startedAt,
  resultPatch,
  env = process.env,
  resolveVoiceoverConfig = getVoiceoverConfig,
  now = Date.now,
} = {}) => {
  if (!store || !Array.isArray(store.jobs)) {
    throw createStoreError('job_state_changed', '任务存储不可用。');
  }
  const index = store.jobs.findIndex((candidate) => String(candidate?.id || '') === String(jobId || ''));
  if (index < 0) throw createStoreError('job_state_changed', '任务已不存在。');
  const current = assertSameRunningClaim(store.jobs[index], {
    jobId,
    userId,
    startedAt,
  });
  const result = mergeParentCheckpointResult(current, resultPatch, {
    env,
    resolveVoiceoverConfig,
  });
  const updated = {
    ...store.jobs[index],
    result,
    updatedAt: Number(now()),
  };
  store.jobs[index] = updated;
  return mapJobRow(updated);
};

export const persistMysqlVoiceoverParentCheckpoint = async ({
  pool,
  jobId,
  userId,
  startedAt,
  resultPatch,
  env = process.env,
  resolveVoiceoverConfig = getVoiceoverConfig,
  now = Date.now,
} = {}) => {
  if (!pool || typeof pool.getConnection !== 'function') {
    throw new TypeError('A MySQL pool is required.');
  }
  const connection = await pool.getConnection();
  let transactionStarted = false;
  try {
    if (typeof connection.beginTransaction === 'function') {
      await connection.beginTransaction();
      transactionStarted = true;
    }
    const [rows] = await connection.query(
      `SELECT * FROM internal_jobs
       WHERE id = ? AND user_id = ?
       LIMIT 1
       FOR UPDATE`,
      [String(jobId || ''), String(userId || '')],
    );
    const current = assertSameRunningClaim(rows?.[0], {
      jobId,
      userId,
      startedAt,
    });
    const result = mergeParentCheckpointResult(current, resultPatch, {
      env,
      resolveVoiceoverConfig,
    });
    const updatedAt = Number(now());
    const [updateResult] = await connection.query(
      `UPDATE internal_jobs
       SET result_json = ?, updated_at = ?
       WHERE id = ? AND user_id = ? AND status = 'running' AND started_at = ?`,
      [
        JSON.stringify(result),
        updatedAt,
        current.id,
        current.userId,
        Number(startedAt),
      ],
    );
    if (Number(updateResult?.affectedRows || 0) !== 1) {
      throw createStoreError('job_state_changed', '任务执行归属已变化，检查点未写入。');
    }
    if (transactionStarted) await connection.commit();
    return { ...current, result, updatedAt };
  } catch (error) {
    if (transactionStarted && typeof connection.rollback === 'function') {
      await connection.rollback().catch(() => null);
    }
    throw error;
  } finally {
    connection.release?.();
  }
};

const assertSafeId = (value, field, code = 'child_job_invalid') => {
  const normalized = String(value || '').trim();
  if (!SAFE_ID.test(normalized)) {
    throw createStoreError(code, `${field} 无效。`, 400);
  }
  return normalized;
};

const assertSerializedBound = (value) => {
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > CHILD_MAX_SERIALIZED_BYTES) {
    throw createStoreError('child_job_invalid', '口播翻译子任务数据过大。', 400);
  }
};

const normalizeTtsPayload = (payload, childKey) => {
  assertKnownKeys(payload, new Set([
    'groupIndex',
    'targetLanguage',
    'voiceName',
    'dialogueTurns',
    'temperature',
    'scene',
    'sampleContext',
  ]));
  const keyMatch = String(childKey || '').match(CHILD_KEY_TTS);
  const groupIndex = payload.groupIndex;
  const attempt = Number(keyMatch?.[2]);
  if (
    !keyMatch
    || typeof groupIndex !== 'number'
    || !Number.isInteger(groupIndex)
    || groupIndex !== Number(keyMatch[1])
    || groupIndex < 0
    || groupIndex > 99
    || !Number.isInteger(attempt)
    || attempt < 0
    || attempt > 100
  ) {
    throw createStoreError('child_job_invalid', 'TTS 子任务序号或尝试次数无效。', 400);
  }
  const targetLanguage = String(payload.targetLanguage || '').trim();
  const voiceName = String(payload.voiceName || '').trim();
  if (!getVoiceoverLanguage(targetLanguage) || !getVoiceoverVoice(voiceName)) {
    throw createStoreError('child_job_invalid', 'TTS 子任务语言或音色无效。', 400);
  }
  if (!Array.isArray(payload.dialogueTurns) || payload.dialogueTurns.length === 0) {
    throw createStoreError('child_job_invalid', 'TTS 子任务对话为空。', 400);
  }
  const dialogueTurns = payload.dialogueTurns.map((turn) => {
    assertKnownKeys(turn, new Set(['speaker', 'text']));
    if (turn.speaker !== 'Speaker 1' || typeof turn.text !== 'string' || !turn.text.trim()) {
      throw createStoreError('child_job_invalid', 'TTS 子任务对话无效。', 400);
    }
    return { speaker: 'Speaker 1', text: turn.text };
  });
  const temperature = payload.temperature === undefined ? 1 : payload.temperature;
  const scene = String(payload.scene || '');
  const sampleContext = String(payload.sampleContext || '');
  if (
    typeof temperature !== 'number'
    || !Number.isFinite(temperature)
    || temperature < 0
    || temperature > 2
    || Math.abs(temperature * 100 - Math.round(temperature * 100)) > Number.EPSILON * 100
    || !scene.trim()
    || !sampleContext.trim()
    || Array.from(scene).length > 1000
    || Array.from(sampleContext).length > 1000
  ) {
    throw createStoreError('child_job_invalid', 'TTS 子任务参数无效。', 400);
  }
  const normalized = {
    groupIndex,
    targetLanguage,
    voiceName,
    dialogueTurns,
    temperature,
    scene,
    sampleContext,
  };
  assertSerializedBound(normalized);
  return normalized;
};

const normalizeManagedSourceUrl = (value, assetId) => {
  const sourceUrl = normalizeManagedAssetIdentity(value, assetId);
  if (sourceUrl) return sourceUrl;
  throw createStoreError('child_job_invalid', 'Golden 子任务源视频不是托管素材。', 400);
};

const positiveNumber = (value, field, code = 'child_job_invalid') => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw createStoreError(code, `${field} 无效。`, 400);
  }
  return value;
};

const normalizeGoldenPayload = (payload, childKey, parentJob) => {
  assertKnownKeys(payload, new Set([
    'taskPurpose',
    'subFeature',
    'sourceAssetId',
    'sourceUrl',
    'subtitleRegionNormalized',
    'sourceProjectId',
    'sourceResultId',
    'shellProjectId',
    'shellProjectName',
    'shellResultId',
    'batchId',
    'batchIndex',
    'batchCount',
    'sizeBytes',
    'durationSeconds',
    'width',
    'height',
  ]));
  const keyMatch = String(childKey || '').match(CHILD_KEY_GOLDEN);
  if (!keyMatch || Number(keyMatch[1]) > 100 || parentJob.payload?.removeText !== true) {
    throw createStoreError('parent_job_ineligible', '父任务未启用去文案或 Golden 尝试无效。');
  }
  if (payload.taskPurpose !== 'subtitle_removal' || payload.subFeature !== 'voiceover_translation') {
    throw createStoreError('child_job_invalid', 'Golden 子任务用途无效。', 400);
  }
  const sourceAssetId = assertSafeId(payload.sourceAssetId, 'sourceAssetId');
  const region = payload.subtitleRegionNormalized;
  assertKnownKeys(region, new Set(['x', 'y', 'width', 'height']));
  const normalizedRegion = Object.fromEntries(['x', 'y', 'width', 'height'].map((key) => {
    if (typeof region[key] !== 'number' || !Number.isFinite(region[key])) {
      throw createStoreError('child_job_invalid', 'Golden 字幕区域无效。', 400);
    }
    return [key, region[key]];
  }));
  if (
    Object.values(normalizedRegion).some((value) => !Number.isFinite(value))
    || normalizedRegion.x < 0
    || normalizedRegion.y < 0
    || normalizedRegion.width <= 0
    || normalizedRegion.height <= 0
    || normalizedRegion.x + normalizedRegion.width > 1
    || normalizedRegion.y + normalizedRegion.height > 1
  ) {
    throw createStoreError('child_job_invalid', 'Golden 字幕区域无效。', 400);
  }
  if (
    typeof payload.batchIndex !== 'number'
    || !Number.isInteger(payload.batchIndex)
    || payload.batchIndex !== 0
    || typeof payload.batchCount !== 'number'
    || !Number.isInteger(payload.batchCount)
    || payload.batchCount !== 1
    || String(payload.batchId || '') !== parentJob.id
  ) {
    throw createStoreError('child_job_invalid', 'Golden 批次身份无效。', 400);
  }
  const normalized = {
    taskPurpose: 'subtitle_removal',
    subFeature: 'voiceover_translation',
    sourceAssetId,
    sourceUrl: normalizeManagedSourceUrl(payload.sourceUrl, sourceAssetId),
    subtitleRegionNormalized: normalizedRegion,
    ...(payload.sourceProjectId ? { sourceProjectId: assertSafeId(payload.sourceProjectId, 'sourceProjectId') } : {}),
    ...(payload.sourceResultId ? { sourceResultId: assertSafeId(payload.sourceResultId, 'sourceResultId') } : {}),
    shellProjectId: assertSafeId(payload.shellProjectId, 'shellProjectId'),
    shellProjectName: String(payload.shellProjectName || '').trim().slice(0, 200),
    shellResultId: assertSafeId(payload.shellResultId, 'shellResultId'),
    batchId: parentJob.id,
    batchIndex: 0,
    batchCount: 1,
    sizeBytes: positiveNumber(payload.sizeBytes, 'sizeBytes'),
    durationSeconds: positiveNumber(payload.durationSeconds, 'durationSeconds'),
    width: positiveNumber(payload.width, 'width'),
    height: positiveNumber(payload.height, 'height'),
  };
  if (!normalized.shellProjectName) {
    throw createStoreError('child_job_invalid', 'Golden 项目名称无效。', 400);
  }
  assertSerializedBound(normalized);
  return normalized;
};

const normalizeChildCreationInput = (input, parentJob) => {
  assertKnownKeys(input, new Set(['parentJob', 'childKey', 'taskType', 'provider', 'payload']));
  const childKey = String(input.childKey || '').trim();
  const taskType = String(input.taskType || '').trim();
  const provider = String(input.provider || '').trim();
  let providerPayload;
  if (taskType === 'kie_tts' && provider === 'kie') {
    providerPayload = normalizeTtsPayload(input.payload, childKey);
  } else if (taskType === 'subtitle_remove_video' && provider === 'golden_subtitle') {
    providerPayload = normalizeGoldenPayload(input.payload, childKey, parentJob);
  } else {
    throw createStoreError('child_job_invalid', '口播翻译子任务 provider 或类型无效。', 400);
  }
  const payload = {
    ...providerPayload,
    executionOwner: 'parent',
    parentJobId: parentJob.id,
    childKey,
    clientSubmissionKey: childSubmissionKey(parentJob.id, childKey),
  };
  if (taskType === 'kie_tts') {
    resolveJobSubmissionPolicy({
      module: 'video',
      taskType,
      provider,
      payload,
      hasVideoPermission: true,
      trustedParentExecution: true,
    });
  }
  assertSerializedBound(payload);
  return { childKey, taskType, provider, payload };
};

const buildChildRecord = ({
  parentJob,
  normalizedInput,
  now,
  createJobId,
}) => {
  const createdAt = Number(now());
  const childJobId = typeof createJobId === 'function'
    ? createJobId()
    : buildVoiceoverChildJobId(parentJob.id, normalizedInput.childKey);
  return {
    id: assertSafeId(childJobId, 'childJobId'),
    userId: parentJob.userId,
    module: 'video',
    taskType: normalizedInput.taskType,
    provider: normalizedInput.provider,
    status: 'running',
    priority: 0,
    payload: normalizedInput.payload,
    providerTaskId: '',
    result: null,
    errorCode: '',
    errorMessage: '',
    errorDetail: '',
    retryCount: 0,
    maxRetries: 0,
    createdAt,
    updatedAt: createdAt,
    startedAt: createdAt,
    finishedAt: null,
    cancelRequestedAt: null,
  };
};

const childFromRows = (rows) => {
  const child = rows?.[0] ? mapJobRow(rows[0]) : null;
  if (child && !isParentOwnedChildJob(child)) {
    throw createStoreError('child_job_conflict', '稳定提交键已被非父持有任务占用。');
  }
  return child;
};

const mysqlInsertChild = async (connection, child) => {
  await connection.query(
    `INSERT INTO internal_jobs (
      id, user_id, module, task_type, provider, status, priority, payload_json,
      provider_task_id, result_json, error_code, error_message, retry_count,
      max_retries, created_at, updated_at, started_at, finished_at, cancel_requested_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      child.id,
      child.userId,
      child.module,
      child.taskType,
      child.provider,
      child.status,
      child.priority,
      JSON.stringify(child.payload),
      null,
      null,
      null,
      null,
      child.retryCount,
      child.maxRetries,
      child.createdAt,
      child.updatedAt,
      child.startedAt,
      null,
      null,
    ],
  );
};

const getMysqlChildById = async (pool, childJobId) => {
  const [rows] = await pool.query(
    `SELECT * FROM internal_jobs
     WHERE id = ?
       AND ${PARENT_OWNED_CHILD_SQL_MATCH}
     LIMIT 1`,
    [String(childJobId || '')],
  );
  return childFromRows(rows);
};

const normalizeManagedOutput = (child, output) => {
  if (child.taskType === 'kie_tts') {
    assertKnownKeys(output, new Set(['assetId', 'audioUrl', 'durationMs']), 'child_output_unmanaged');
    const assetId = assertSafeId(output.assetId, 'assetId', 'child_output_unmanaged');
    const audioUrl = normalizeManagedAssetIdentity(output.audioUrl, assetId);
    if (!audioUrl) {
      throw createStoreError('child_output_unmanaged', 'TTS 成功结果必须是梅奥托管素材。', 400);
    }
    const durationMs = output.durationMs;
    if (
      durationMs !== undefined
      && (typeof durationMs !== 'number' || !Number.isInteger(durationMs) || durationMs <= 0)
    ) {
      throw createStoreError('child_output_unmanaged', 'TTS 音频时长无效。', 400);
    }
    return {
      assetId,
      audioUrl,
      ...(durationMs !== undefined ? { durationMs } : {}),
    };
  }
  assertKnownKeys(
    output,
    new Set(['assetId', 'resultAssetId', 'videoUrl', 'durationMs']),
    'child_output_unmanaged',
  );
  const assetId = assertSafeId(output.assetId || output.resultAssetId, 'assetId', 'child_output_unmanaged');
  const videoUrl = normalizeManagedAssetIdentity(output.videoUrl, assetId);
  if (!videoUrl) {
    throw createStoreError('child_output_unmanaged', 'Golden 成功结果必须是梅奥托管素材。', 400);
  }
  return {
    assetId,
    resultAssetId: assetId,
    videoUrl,
    ...(output.durationMs !== undefined
      ? { durationMs: positiveNumber(output.durationMs, 'durationMs', 'child_output_unmanaged') }
      : {}),
  };
};

const normalizeChildFailure = (error) => ({
  errorCode: String(error?.code || 'provider_internal_error').trim().slice(0, 80),
  errorMessage: String(error?.message || '子任务执行失败').trim().slice(0, 5_000),
  errorDetail: String(error?.providerMessage || error?.detail || '').trim().slice(0, 5_000),
});

export const createVoiceoverChildJobLedger = ({
  mode,
  pool,
  readLocalStore,
  mutateLocalStore,
  now = Date.now,
  createJobId,
  env = process.env,
} = {}) => {
  const normalizedMode = String(mode || '').trim();
  if (!['local', 'mysql'].includes(normalizedMode)) {
    throw new TypeError('Voiceover child ledger mode must be local or mysql.');
  }
  if (normalizedMode === 'local' && typeof mutateLocalStore !== 'function') {
    throw new TypeError('mutateLocalStore is required for local child ledger.');
  }
  if (normalizedMode === 'mysql' && (!pool || typeof pool.getConnection !== 'function')) {
    throw new TypeError('pool is required for mysql child ledger.');
  }

  const localMutation = async (operation) => mutateLocalStore(operation);

  const getOrCreateLocal = (input) => localMutation((store) => {
    const requestedParent = mapJobRow(input?.parentJob);
    const liveParent = assertVoiceoverParent(
      store?.jobs?.find((candidate) => String(candidate?.id || '') === requestedParent.id),
      requestedParent,
    );
    const normalizedInput = normalizeChildCreationInput(input, liveParent);
    const existing = (store.jobs || []).find((candidate) => (
      String(candidate?.userId || '') === liveParent.userId
      && String(candidate?.payload?.clientSubmissionKey || '') === normalizedInput.payload.clientSubmissionKey
    ));
    if (existing) {
      const child = mapJobRow(existing);
      if (
        !isParentOwnedChildJob(child)
        || child.payload.parentJobId !== liveParent.id
        || child.payload.childKey !== normalizedInput.childKey
        || child.taskType !== normalizedInput.taskType
        || child.provider !== normalizedInput.provider
      ) {
        throw createStoreError('child_job_conflict', '稳定子任务身份已冲突。');
      }
      return child;
    }
    const child = buildChildRecord({
      parentJob: liveParent,
      normalizedInput,
      now,
      createJobId,
    });
    store.jobs = Array.isArray(store.jobs) ? store.jobs : [];
    store.jobs.unshift(child);
    return mapJobRow(child);
  });

  const getOrCreateMysql = async (input) => {
    const requestedParent = mapJobRow(input?.parentJob);
    const stableKey = `${requestedParent.userId}:${childSubmissionKey(requestedParent.id, String(input?.childKey || '').trim())}`;
    const lockName = `voiceover-child:${createHash('sha256').update(stableKey).digest('hex').slice(0, 32)}`;
    const timeoutSeconds = getJobSubmissionLockTimeoutSeconds(env);
    const connection = await pool.getConnection();
    let acquired = false;
    try {
      const [lockRows] = await connection.query(
        'SELECT GET_LOCK(?, ?) AS acquired',
        [lockName, timeoutSeconds],
      );
      acquired = Number(lockRows?.[0]?.acquired) === 1;
      if (!acquired) {
        throw createStoreError('job_submission_lock_timeout', '相同子任务正在创建，请稍后重试。');
      }
      const [parentRows] = await connection.query(
        `SELECT * FROM internal_jobs
         WHERE id = ? AND user_id = ?
         LIMIT 1`,
        [requestedParent.id, requestedParent.userId],
      );
      const liveParent = assertVoiceoverParent(parentRows?.[0], requestedParent);
      const normalizedInput = normalizeChildCreationInput(input, liveParent);
      const [existingRows] = await connection.query(
        `SELECT * FROM internal_jobs
         WHERE user_id = ?
           AND JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.clientSubmissionKey')) = ?
         ORDER BY created_at DESC
         LIMIT 1`,
        [liveParent.userId, normalizedInput.payload.clientSubmissionKey],
      );
      const existing = childFromRows(existingRows);
      if (existing) {
        if (
          existing.payload.parentJobId !== liveParent.id
          || existing.payload.childKey !== normalizedInput.childKey
          || existing.taskType !== normalizedInput.taskType
          || existing.provider !== normalizedInput.provider
        ) {
          throw createStoreError('child_job_conflict', '稳定子任务身份已冲突。');
        }
        return existing;
      }
      const child = buildChildRecord({
        parentJob: liveParent,
        normalizedInput,
        now,
        createJobId,
      });
      await mysqlInsertChild(connection, child);
      return child;
    } finally {
      try {
        if (acquired) {
          await connection.query('SELECT RELEASE_LOCK(?) AS released', [lockName]);
        }
      } finally {
        connection.release?.();
      }
    }
  };

  const getLocal = async (childJobId) => {
    const store = readLocalStore?.();
    const child = mapJobRow(
      store?.jobs?.find((candidate) => String(candidate?.id || '') === String(childJobId || '')),
    );
    return child.id && isParentOwnedChildJob(child) ? child : null;
  };

  const mutateLocalChild = (childJobId, operation) => localMutation((store) => {
    const index = (store?.jobs || []).findIndex((candidate) => String(candidate?.id || '') === String(childJobId || ''));
    if (index < 0) throw createStoreError('child_job_not_found', '口播翻译子任务不存在。', 404);
    const child = mapJobRow(store.jobs[index]);
    if (!isParentOwnedChildJob(child)) {
      throw createStoreError('child_job_forbidden', '任务不是父持有子任务。', 403);
    }
    const next = operation(child);
    store.jobs[index] = next;
    return mapJobRow(next);
  });

  const mutateMysqlChild = async (childJobId, operation) => {
    const connection = await pool.getConnection();
    let transactionStarted = false;
    try {
      if (typeof connection.beginTransaction === 'function') {
        await connection.beginTransaction();
        transactionStarted = true;
      }
      const [rows] = await connection.query(
        `SELECT * FROM internal_jobs
         WHERE id = ?
         LIMIT 1
         FOR UPDATE`,
        [String(childJobId || '')],
      );
      const child = childFromRows(rows);
      if (!child) throw createStoreError('child_job_not_found', '口播翻译子任务不存在。', 404);
      const next = operation(child);
      if (next === child) {
        if (transactionStarted) await connection.commit();
        return child;
      }
      const [result] = await connection.query(
        `UPDATE internal_jobs
         SET status = ?, provider_task_id = ?, result_json = ?, error_code = ?,
             error_message = ?, error_detail = ?, updated_at = ?, finished_at = ?
         WHERE id = ?
           AND status = ?
           AND ${PARENT_OWNED_CHILD_SQL_MATCH}`,
        [
          next.status,
          next.providerTaskId || null,
          next.result ? JSON.stringify(next.result) : null,
          next.errorCode || null,
          next.errorMessage || null,
          next.errorDetail || null,
          next.updatedAt,
          next.finishedAt,
          child.id,
          child.status,
        ],
      );
      if (Number(result?.affectedRows || 0) !== 1) {
        throw createStoreError('job_state_changed', '子任务状态已变化。');
      }
      if (transactionStarted) await connection.commit();
      return next;
    } catch (error) {
      if (transactionStarted && typeof connection.rollback === 'function') {
        await connection.rollback().catch(() => null);
      }
      throw error;
    } finally {
      connection.release?.();
    }
  };

  const mutateChild = normalizedMode === 'local' ? mutateLocalChild : mutateMysqlChild;

  return Object.freeze({
    getOrCreate: normalizedMode === 'local' ? getOrCreateLocal : getOrCreateMysql,

    async checkpointProviderTaskId(childJobId, taskId) {
      const value = assertSafeId(taskId, 'providerTaskId');
      return mutateChild(childJobId, (child) => {
        if (CHILD_TERMINAL_STATUSES.has(child.status)) {
          if (child.providerTaskId === value) return child;
          throw createStoreError('job_state_changed', '终态子任务不能修改 providerTaskId。');
        }
        if (child.status !== 'running') {
          throw createStoreError('job_state_changed', '只有运行中的子任务可以记录 providerTaskId。');
        }
        if (child.providerTaskId && child.providerTaskId !== value) {
          throw createStoreError('provider_task_id_immutable', 'providerTaskId 已写入且不可替换。');
        }
        return {
          ...child,
          providerTaskId: value,
          updatedAt: Number(now()),
        };
      });
    },

    async markSucceeded(childJobId, output) {
      return mutateChild(childJobId, (child) => {
        if (child.status === 'succeeded') return child;
        if (child.status !== 'running') {
          throw createStoreError('job_state_changed', '只有运行中的子任务可以成功。');
        }
        const result = normalizeManagedOutput(child, output);
        const finishedAt = Number(now());
        return {
          ...child,
          status: 'succeeded',
          result,
          errorCode: '',
          errorMessage: '',
          errorDetail: '',
          updatedAt: finishedAt,
          finishedAt,
        };
      });
    },

    async markFailed(childJobId, error) {
      return mutateChild(childJobId, (child) => {
        if (child.status === 'failed') return child;
        if (child.status !== 'running') {
          throw createStoreError('job_state_changed', '只有运行中的子任务可以失败。');
        }
        const failure = normalizeChildFailure(error);
        const finishedAt = Number(now());
        return {
          ...child,
          status: 'failed',
          ...failure,
          updatedAt: finishedAt,
          finishedAt,
        };
      });
    },

    get: normalizedMode === 'local'
      ? getLocal
      : (childJobId) => getMysqlChildById(pool, childJobId),
  });
};

export const normalizeVoiceoverRetryRequestBody = (body = {}) => {
  assertKnownKeys(
    body,
    new Set(['confirmNewProviderAttempt']),
    'voiceover_retry_invalid',
  );
  if (
    Object.hasOwn(body, 'confirmNewProviderAttempt')
    && typeof body.confirmNewProviderAttempt !== 'boolean'
  ) {
    throw createStoreError(
      'voiceover_retry_invalid',
      '口播翻译重试确认参数无效。',
      400,
    );
  }
  return {
    confirmNewProviderAttempt: body.confirmNewProviderAttempt === true,
  };
};

export const deriveVoiceoverRetryPlan = (job, retryRequest = {}, options = {}) => {
  const normalized = mapJobRow(job);
  if (
    normalized.taskType !== 'voiceover_translate_video'
    || normalized.provider !== 'internal'
    || !normalized.result?.voiceoverCheckpoint
  ) {
    throw createStoreError('voiceover_retry_invalid', '口播翻译重试检查点缺失。', 409);
  }
  const request = normalizeVoiceoverRetryRequestBody(retryRequest);
  const checkpointOptions = resolveCheckpointOptions(normalized, options);
  const checkpoint = normalizeVoiceoverCheckpoint(
    normalized.result.voiceoverCheckpoint,
    checkpointOptions,
  );
  if (normalized.errorCode === 'voiceover_analysis_submission_unknown') {
    return {
      kind: 'analysis',
      userConfirmed: request.confirmNewProviderAttempt,
    };
  }

  const latestTtsAttemptByGroup = new Map();
  for (const group of checkpoint.ttsGroups || []) {
    const previous = latestTtsAttemptByGroup.get(group.index);
    if (!previous || group.attempt > previous.attempt) {
      latestTtsAttemptByGroup.set(group.index, group);
    }
  }
  const needsNewProviderAttempt = (attempt) => (
    attempt?.status === 'failed'
    || (attempt?.status === 'submitted' && !attempt.providerTaskId)
  );
  if (needsNewProviderAttempt(checkpoint.subtitleRemoval)) {
    const nextAttempt = checkpoint.subtitleRemoval.attempt + 1;
    return {
      kind: 'provider',
      target: 'golden',
      userConfirmed: request.confirmNewProviderAttempt,
      nextChildJobId: buildVoiceoverChildJobId(
        normalized.id,
        `golden:attempt:${nextAttempt}`,
      ),
    };
  }
  const ttsAttempt = [...latestTtsAttemptByGroup.values()]
    .sort((left, right) => left.index - right.index)
    .find(needsNewProviderAttempt);
  if (ttsAttempt) {
    const nextAttempt = ttsAttempt.attempt + 1;
    return {
      kind: 'provider',
      target: 'tts',
      groupIndex: ttsAttempt.index,
      userConfirmed: request.confirmNewProviderAttempt,
      nextChildJobId: buildVoiceoverChildJobId(
        normalized.id,
        `tts:${ttsAttempt.index}:attempt:${nextAttempt}`,
      ),
    };
  }
  return { kind: 'reuse' };
};

export const prepareVoiceoverJobRetryResult = (job, voiceoverRetryPlan = {}, options = {}) => {
  const normalized = mapJobRow(job);
  if (
    normalized.taskType !== 'voiceover_translate_video'
    || normalized.provider !== 'internal'
    || !normalized.result?.voiceoverCheckpoint
  ) {
    return normalized.result;
  }
  assertKnownKeys(
    voiceoverRetryPlan,
    new Set(['kind', 'target', 'groupIndex', 'userConfirmed', 'nextChildJobId']),
    'voiceover_retry_invalid',
  );
  const checkpointOptions = resolveCheckpointOptions(normalized, options);
  const current = normalizeVoiceoverCheckpoint(
    normalized.result.voiceoverCheckpoint,
    checkpointOptions,
  );
  const kind = String(voiceoverRetryPlan.kind || 'reuse');
  let voiceoverCheckpoint = current;
  if (kind === 'analysis') {
    if (normalized.errorCode !== 'voiceover_analysis_submission_unknown') {
      throw createStoreError('voiceover_retry_invalid', '当前失败不需要新分析尝试。', 400);
    }
    voiceoverCheckpoint = prepareVoiceoverRetryCheckpoint(
      current,
      { userConfirmed: voiceoverRetryPlan.userConfirmed === true },
      checkpointOptions,
    );
  } else if (kind === 'provider') {
    if (voiceoverRetryPlan.userConfirmed !== true) {
      throw createStoreError(
        'voiceover_retry_confirmation_required',
        '请确认可能产生新的 provider 费用。',
        409,
      );
    }
    const nextChildJobId = assertSafeId(
      voiceoverRetryPlan.nextChildJobId,
      'nextChildJobId',
      'voiceover_retry_invalid',
    );
    if (voiceoverRetryPlan.target === 'tts') {
      const groupIndex = Number(voiceoverRetryPlan.groupIndex);
      const attempts = (current.ttsGroups || []).filter((group) => group.index === groupIndex);
      const previous = attempts.sort((left, right) => right.attempt - left.attempt)[0];
      if (
        !previous
        || !(
          previous.status === 'failed'
          || (previous.status === 'submitted' && !previous.providerTaskId)
        )
      ) {
        throw createStoreError('voiceover_retry_invalid', 'TTS 分组不是明确失败状态。', 409);
      }
      const expectedChildJobId = buildVoiceoverChildJobId(
        normalized.id,
        `tts:${groupIndex}:attempt:${previous.attempt + 1}`,
      );
      if (nextChildJobId !== expectedChildJobId) {
        throw createStoreError('voiceover_retry_invalid', 'TTS 子任务身份与检查点不一致。', 409);
      }
      const next = {
        index: previous.index,
        attempt: previous.attempt + 1,
        childJobId: nextChildJobId,
        status: 'queued',
        startMs: previous.startMs,
        endMs: previous.endMs,
      };
      voiceoverCheckpoint = mergeVoiceoverCheckpoint(
        current,
        { ttsGroups: [next] },
        checkpointOptions,
      );
    } else if (voiceoverRetryPlan.target === 'golden') {
      const previous = current.subtitleRemoval;
      if (
        !previous
        || !(
          previous.status === 'failed'
          || (previous.status === 'submitted' && !previous.providerTaskId)
        )
      ) {
        throw createStoreError('voiceover_retry_invalid', 'Golden 子任务不是明确失败状态。', 409);
      }
      const expectedChildJobId = buildVoiceoverChildJobId(
        normalized.id,
        `golden:attempt:${previous.attempt + 1}`,
      );
      if (nextChildJobId !== expectedChildJobId) {
        throw createStoreError('voiceover_retry_invalid', 'Golden 子任务身份与检查点不一致。', 409);
      }
      voiceoverCheckpoint = normalizeVoiceoverCheckpoint({
        ...current,
        subtitleRemoval: {
          childJobId: nextChildJobId,
          attempt: previous.attempt + 1,
          status: 'queued',
        },
      }, checkpointOptions);
    } else {
      throw createStoreError('voiceover_retry_invalid', 'provider 重试目标无效。', 400);
    }
  } else if (kind === 'reuse') {
    const latestTtsAttemptByGroup = new Map();
    for (const group of current.ttsGroups || []) {
      const previous = latestTtsAttemptByGroup.get(group.index);
      if (!previous || group.attempt > previous.attempt) {
        latestTtsAttemptByGroup.set(group.index, group);
      }
    }
    const currentProviderAttempts = [
      ...(current.subtitleRemoval ? [current.subtitleRemoval] : []),
      ...latestTtsAttemptByGroup.values(),
    ];
    const hasDefinitiveChildFailure = currentProviderAttempts.some(
      (attempt) => attempt.status === 'failed',
    );
    const hasUnqueryableRunningAttempt = currentProviderAttempts.some(
      (attempt) => attempt.status === 'submitted' && !attempt.providerTaskId,
    );
    if (
      hasDefinitiveChildFailure
      || hasUnqueryableRunningAttempt
      || normalized.errorCode === 'voiceover_analysis_submission_unknown'
    ) {
      throw createStoreError(
        'voiceover_retry_confirmation_required',
        '当前失败需要确认新的付费尝试。',
        409,
      );
    }
  } else {
    throw createStoreError('voiceover_retry_invalid', '口播翻译重试计划无效。', 400);
  }
  return {
    ...cloneValue(normalized.result),
    voiceoverCheckpoint,
  };
};
