import { createHash, randomBytes } from 'node:crypto';

import { buildJobFailureErrorFields, buildJobFailureLogFields, buildJobRuntimeLogMeta, getNextJobFailureState, getPersistedJobFailureErrorCode, getProviderCompletedRejectedOutput, isProviderCompletedOutputRejectedError, isTransientMysqlConnectionError } from './jobRuntime.mjs';
import { canRecoverProviderTaskById, KIE_RECOVERY_SOURCE_TASK_TYPES } from './jobSubmissionPolicy.mjs';
import { maybeRecordCreditAlertLog } from './creditAlert.mjs';
import { createJobAttempt, finishJobAttempt, normalizeTaskEngineMode, recordJobEvent } from './taskPlatform.mjs';
import { isDeployDrainActive } from './deployDrain.mjs';
import { runWithDeployJobClaimLock } from './deployClaimLock.mjs';
import {
  assertGenericJobMutationAllowed,
  isParentOwnedChildJob,
  PARENT_OWNED_CHILD_SQL_EXCLUSION,
  persistMysqlVoiceoverParentCheckpoint,
  prepareVoiceoverJobRetryResult,
} from './voiceoverChildJobStore.mjs';

const now = () => Date.now();
const DEFAULT_JOB_CONCURRENCY = 5;
const DEFAULT_PROVIDERLESS_RUNNING_STALE_MS = 15 * 60 * 1000;
const DEFAULT_SUBMITTED_RUNNING_STALE_MS = 6 * 60 * 60 * 1000;
const DEFAULT_CANCELLED_RUNNING_STALE_MS = 60 * 1000;
const REUSABLE_JOB_STATUSES = new Set(['queued', 'running', 'retry_waiting']);
const TERMINAL_SUBTITLE_REPLAY_STATUSES = new Set(['failed', 'succeeded', 'cancelled']);
const MIN_PROVIDERLESS_RUNNING_STALE_MS_BY_TASK_TYPE = new Map([
  ['kie_chat', DEFAULT_PROVIDERLESS_RUNNING_STALE_MS],
  ['kie_image', DEFAULT_PROVIDERLESS_RUNNING_STALE_MS],
]);

const parseJsonValue = (value, fallback = null) => {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};

const serializeJsonValue = (value) => JSON.stringify(value ?? null);

const isSameMysqlClaim = (job, claimedAt) => (
  String(job?.status || '') === 'running'
  && Number(job?.startedAt || 0) === Number(claimedAt || 0)
);

const preserveVoiceoverCheckpoint = (job, nextResult) => {
  if (
    String(job?.taskType || '') !== 'voiceover_translate_video'
    || !job?.result?.voiceoverCheckpoint
  ) {
    return nextResult ?? null;
  }
  return {
    ...(job.result && typeof job.result === 'object' && !Array.isArray(job.result) ? job.result : {}),
    ...(nextResult && typeof nextResult === 'object' && !Array.isArray(nextResult) ? nextResult : {}),
    voiceoverCheckpoint: job.result.voiceoverCheckpoint,
  };
};

const normalizeReusablePayload = (value) => {
  if (Array.isArray(value)) return value.map(normalizeReusablePayload);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== 'requestId' && key !== '__creditReservation')
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entryValue]) => [key, normalizeReusablePayload(entryValue)])
  );
};

const getClientSubmissionKey = (payload) => {
  const source = payload && typeof payload === 'object' ? payload : {};
  return Array.isArray(source)
    ? ''
    : String(source.clientSubmissionKey || '').trim();
};

const getReusablePayloadIdentity = (payload) => {
  const source = payload && typeof payload === 'object' ? payload : {};
  const clientSubmissionKey = getClientSubmissionKey(source);
  return clientSubmissionKey
    ? { clientSubmissionKey }
    : normalizeReusablePayload(source);
};

export const buildJobSubmissionLockKey = ({
  userId = '',
  module = 'system',
  taskType = 'unknown',
  provider = 'internal',
  payload = {},
} = {}) => {
  const semanticSubmission = {
    module: String(module || 'system').slice(0, 60),
    payload: getReusablePayloadIdentity(payload),
    provider: String(provider || 'internal').slice(0, 40),
    taskType: String(taskType || 'unknown').slice(0, 80),
    userId: String(userId || ''),
  };
  const digest = createHash('sha256')
    .update(serializeJsonValue(semanticSubmission))
    .digest('hex');
  return `meiao:${digest.slice(0, 58)}`;
};

export const withMysqlSubmissionLock = async (
  pool,
  submission,
  operation,
  { timeoutSeconds = 10 } = {}
) => {
  const connection = await pool.getConnection();
  const lockName = buildJobSubmissionLockKey(submission);
  const safeTimeoutSeconds = Math.max(0, Math.floor(Number(timeoutSeconds) || 0));
  let acquired = false;
  try {
    const [rows] = await connection.query(
      'SELECT GET_LOCK(?, ?) AS acquired',
      [lockName, safeTimeoutSeconds]
    );
    acquired = Number(rows?.[0]?.acquired) === 1;
    if (!acquired) {
      const error = new Error('相同任务正在提交，请稍后查看任务状态。');
      error.code = 'job_submission_lock_timeout';
      error.statusCode = 409;
      throw error;
    }
    return await operation(connection);
  } finally {
    try {
      if (acquired) {
        await connection.query('SELECT RELEASE_LOCK(?) AS released', [lockName]);
      }
    } finally {
      connection.release();
    }
  }
};

export const withMysqlTransaction = async (connection, operation) => {
  await connection.beginTransaction();
  try {
    const result = await operation(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback().catch(() => null);
    throw error;
  }
};

export const createSerializedJobSubmissionOnConnection = async ({
  connection,
  user,
  jobPayload,
  findReusableJob,
  reserveCredits,
  createJob,
  dedupeWindowMs,
}) => withMysqlTransaction(connection, async () => {
    const reusableJob = await findReusableJob(connection, user, jobPayload, dedupeWindowMs);
    if (reusableJob) return { job: reusableJob, deduped: true };
    const reservation = await reserveCredits(connection, user, jobPayload);
    const job = await createJob(connection, user, jobPayload, reservation);
    return { job, deduped: false };
  });

export const createSerializedJobSubmission = async ({
  pool,
  lockTimeoutSeconds,
  ...submission
}) => withMysqlSubmissionLock(pool, {
  userId: submission.user?.id,
  ...submission.jobPayload,
}, async (connection) => createSerializedJobSubmissionOnConnection({
  connection,
  ...submission,
}), { timeoutSeconds: lockTimeoutSeconds });

const toSafeJobConcurrency = (value, fallback = DEFAULT_JOB_CONCURRENCY) => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const getJobValue = (job, camelKey, snakeKey = camelKey) => job?.[camelKey] ?? job?.[snakeKey];

const getJobTimestamp = (job, camelKey, snakeKey = camelKey) => {
  const value = getJobValue(job, camelKey, snakeKey);
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

export const isRunningJobConcurrencyBlocking = (job, options = {}) => {
  if (String(getJobValue(job, 'status') || '') !== 'running') return false;
  if (isParentOwnedChildJob(job)) return false;

  const referenceTime = Number(options.referenceTime || now());
  const providerTaskId = String(getJobValue(job, 'providerTaskId', 'provider_task_id') || '').trim();
  const cancelRequestedAt = getJobTimestamp(job, 'cancelRequestedAt', 'cancel_requested_at');
  const cancelledStaleMs = Math.max(1, Number(options.cancelledStaleMs || DEFAULT_CANCELLED_RUNNING_STALE_MS));
  if (cancelRequestedAt > 0 && cancelRequestedAt <= referenceTime - cancelledStaleMs) {
    return false;
  }

  if (providerTaskId) {
    const submittedStaleMs = Math.max(1, Number(options.submittedStaleMs || DEFAULT_SUBMITTED_RUNNING_STALE_MS));
    const jobUpdatedAt = (
      getJobTimestamp(job, 'updatedAt', 'updated_at')
      || getJobTimestamp(job, 'startedAt', 'started_at')
      || getJobTimestamp(job, 'createdAt', 'created_at')
    );
    return !(jobUpdatedAt > 0 && jobUpdatedAt <= referenceTime - submittedStaleMs);
  }

  const baseProviderlessStaleMs = Math.max(1, Number(options.providerlessStaleMs || DEFAULT_PROVIDERLESS_RUNNING_STALE_MS));
  const taskType = String(getJobValue(job, 'taskType', 'task_type') || '').trim();
  const taskMinStaleMs = MIN_PROVIDERLESS_RUNNING_STALE_MS_BY_TASK_TYPE.get(taskType) || 0;
  const staleMs = Math.max(baseProviderlessStaleMs, taskMinStaleMs);
  const jobStartedAt = (
    getJobTimestamp(job, 'startedAt', 'started_at')
    || getJobTimestamp(job, 'updatedAt', 'updated_at')
    || getJobTimestamp(job, 'createdAt', 'created_at')
  );
  return !(jobStartedAt > 0 && jobStartedAt <= referenceTime - staleMs);
};

const normalizeJobCreditsConsumed = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
};

const runTaskPlatformWrite = async (operation) => {
  try {
    return await operation();
  } catch (error) {
    console.error('Task platform diagnostic write failed.', error);
    return null;
  }
};

const mapProviderStageToTaskStage = (providerStage) => {
  const stage = String(providerStage || '').trim();
  if (!stage) return 'provider_submit';
  if (/asset|upload/i.test(stage)) return 'asset_upload';
  if (stage === 'create_task' || stage === 'http_request') return 'provider_submit';
  if (stage === 'polling') return 'provider_wait';
  if (stage === 'stream_read') return 'provider_stream';
  if (stage === 'completed') return 'completed';
  return stage.slice(0, 80);
};

export const selectJobsWithinConcurrencyLimits = ({
  jobs,
  availableSlots,
  activeJobUserIds = [],
  getUserConcurrency = () => DEFAULT_JOB_CONCURRENCY,
}) => {
  if (!Array.isArray(jobs) || availableSlots <= 0) return [];

  const runningCountByUser = new Map();
  activeJobUserIds.forEach((userId) => {
    const key = String(userId || '');
    runningCountByUser.set(key, (runningCountByUser.get(key) || 0) + 1);
  });

  const candidates = [...jobs].sort(
    (a, b) => Number(b.priority || 0) - Number(a.priority || 0) || Number(a.createdAt || 0) - Number(b.createdAt || 0)
  );

  const selected = [];
  for (const job of candidates) {
    if (selected.length >= availableSlots) break;
    if (isParentOwnedChildJob(job)) continue;
    const userId = String(job?.userId || '');
    const currentRunning = runningCountByUser.get(userId) || 0;
    const limit = toSafeJobConcurrency(getUserConcurrency(userId), DEFAULT_JOB_CONCURRENCY);
    if (currentRunning >= limit) continue;

    selected.push(job);
    runningCountByUser.set(userId, currentRunning + 1);
  }

  return selected;
};

export const shouldMysqlWorkerProcessTaskEngine = (engine) => {
  const mode = normalizeTaskEngineMode(engine);
  return mode === 'mysql' || mode === 'dual';
};

export const findReusableJobSubmission = ({
  jobs,
  userId,
  module,
  taskType,
  provider,
  payload,
  createdAfter = 0,
}) => {
  if (!Array.isArray(jobs) || jobs.length === 0) return null;

  const serializedPayload = serializeJsonValue(getReusablePayloadIdentity(payload));
  const normalizedModule = String(module || 'system').slice(0, 60);
  const normalizedTaskType = String(taskType || 'unknown').slice(0, 80);
  const normalizedProvider = String(provider || 'internal').slice(0, 40);
  const hasExplicitSubmissionKey = Boolean(getClientSubmissionKey(payload));
  const reusableStatuses = hasExplicitSubmissionKey && normalizedTaskType === 'subtitle_remove_video'
    ? new Set([...REUSABLE_JOB_STATUSES, ...TERMINAL_SUBTITLE_REPLAY_STATUSES])
    : REUSABLE_JOB_STATUSES;

  const matches = jobs
    .filter((job) => (
      !isParentOwnedChildJob(job) &&
      String(job?.userId || '') === String(userId || '') &&
      String(job?.module || '') === normalizedModule &&
      String(job?.taskType || '') === normalizedTaskType &&
      String(job?.provider || '') === normalizedProvider &&
      reusableStatuses.has(String(job?.status || '')) &&
      Number(job?.createdAt || 0) >= createdAfter &&
      serializeJsonValue(getReusablePayloadIdentity(job?.payload)) === serializedPayload
    ))
    .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));

  return matches[0] || null;
};

const mapJobRow = (row) => ({
  id: row.id,
  userId: row.user_id,
  module: row.module,
  taskType: row.task_type,
  provider: row.provider,
  status: row.status,
  priority: Number(row.priority || 0),
  payload: parseJsonValue(row.payload_json, {}),
  providerTaskId: row.provider_task_id || '',
  result: parseJsonValue(row.result_json, null),
  errorCode: row.error_code || '',
  errorMessage: row.error_message || '',
  errorDetail: row.error_detail || '',
  retryCount: Number(row.retry_count || 0),
  maxRetries: Number(row.max_retries || 0),
  createdAt: Number(row.created_at || 0),
  updatedAt: Number(row.updated_at || 0),
  startedAt: row.started_at === null ? null : Number(row.started_at),
  finishedAt: row.finished_at === null ? null : Number(row.finished_at),
  cancelRequestedAt: row.cancel_requested_at === null ? null : Number(row.cancel_requested_at),
});

export const reconcileRestartedMysqlJobs = (jobs, referenceTime = now()) => {
  if (!Array.isArray(jobs)) return [];
  return jobs
    .filter((job) => String(job?.status || '') === 'running')
    .filter((job) => !isParentOwnedChildJob(job))
    .map((job) => {
      const updatedAt = Number(referenceTime || now());
      const canRecoverProviderTask = canRecoverProviderTaskById(job);
      const canSafelyRequeueInternal = String(job?.provider || '').trim() === 'internal';
      const canRecover = canRecoverProviderTask || canSafelyRequeueInternal;
      return {
        ...job,
        status: canRecover ? 'retry_waiting' : 'failed',
        startedAt: null,
        finishedAt: canRecover ? null : updatedAt,
        updatedAt,
        errorCode: canRecover ? 'service_restarted' : 'provider_submission_unknown',
        errorMessage: canRecover
          ? '服务重启后任务已回收到待恢复状态'
          : '服务重启时任务尚未记录上游任务 ID，已停止自动重试以防止重复扣费',
      };
    });
};

export const reconcileStaleProviderlessRunningMysqlJobs = (
  jobs,
  referenceTime = now(),
  staleMs = DEFAULT_PROVIDERLESS_RUNNING_STALE_MS
) => {
  if (!Array.isArray(jobs)) return [];
  const resolvedReferenceTime = Number(referenceTime || now());
  const baseStaleMs = Math.max(1, Number(staleMs || DEFAULT_PROVIDERLESS_RUNNING_STALE_MS));
  return jobs
    .filter((job) => !isParentOwnedChildJob(job))
    .filter((job) => {
      const taskType = String(job?.taskType || '').trim();
      const taskMinStaleMs = MIN_PROVIDERLESS_RUNNING_STALE_MS_BY_TASK_TYPE.get(taskType) || 0;
      const cutoff = resolvedReferenceTime - Math.max(baseStaleMs, taskMinStaleMs);
      const jobStartedAt = Number(job?.startedAt || job?.updatedAt || job?.createdAt || 0);
      return (
        String(job?.status || '') === 'running'
        && !String(job?.providerTaskId || '').trim()
        && jobStartedAt > 0
        && jobStartedAt <= cutoff
      );
    })
    .map((job) => ({
      ...job,
      status: String(job?.provider || '').trim() === 'internal' ? 'retry_waiting' : 'failed',
      startedAt: null,
      finishedAt: String(job?.provider || '').trim() === 'internal' ? null : Number(referenceTime || now()),
      updatedAt: Number(referenceTime || now()),
      errorCode: String(job?.provider || '').trim() === 'internal' ? 'service_restarted' : 'provider_submission_unknown',
      errorMessage: String(job?.provider || '').trim() === 'internal'
        ? '内部任务执行超时后已安全回收到待恢复状态'
        : '任务提交上游后长时间未记录上游任务 ID，已停止自动重试以防止重复扣费',
    }));
};

export const reconcileStaleSubmittedRunningMysqlJobs = (
  jobs,
  referenceTime = now(),
  staleMs = DEFAULT_SUBMITTED_RUNNING_STALE_MS
) => {
  if (!Array.isArray(jobs)) return [];
  const resolvedReferenceTime = Number(referenceTime || now());
  const cutoff = resolvedReferenceTime - Math.max(1, Number(staleMs || DEFAULT_SUBMITTED_RUNNING_STALE_MS));
  return jobs
    .filter((job) => !isParentOwnedChildJob(job))
    .filter((job) => {
      const jobUpdatedAt = Number(job?.updatedAt || job?.startedAt || job?.createdAt || 0);
      return (
        String(job?.status || '') === 'running'
        && Boolean(String(job?.providerTaskId || '').trim())
        && jobUpdatedAt > 0
        && jobUpdatedAt <= cutoff
      );
    })
    .map((job) => {
      const canRecover = canRecoverProviderTaskById(job);
      return {
        ...job,
        status: canRecover ? 'retry_waiting' : 'failed',
        startedAt: null,
        finishedAt: canRecover ? null : resolvedReferenceTime,
        updatedAt: resolvedReferenceTime,
        errorCode: canRecover ? 'provider_wait_stale' : 'provider_submission_unknown',
        errorMessage: canRecover
          ? '任务已提交上游但长时间未完成，已回收到待恢复状态'
          : '任务记录了不可查询的上游响应 ID，已停止自动重试以防止重复扣费',
      };
    });
};

export const reconcileStaleCancelledRunningMysqlJobs = (
  jobs,
  referenceTime = now(),
  staleMs = DEFAULT_CANCELLED_RUNNING_STALE_MS
) => {
  if (!Array.isArray(jobs)) return [];
  const cutoff = Number(referenceTime || now()) - Math.max(1, Number(staleMs || DEFAULT_CANCELLED_RUNNING_STALE_MS));
  return jobs
    .filter((job) => !isParentOwnedChildJob(job))
    .filter((job) => {
      const cancelRequestedAt = Number(job?.cancelRequestedAt || 0);
      return (
        String(job?.status || '') === 'running'
        && (
          String(job?.errorCode || '') === 'request_cancelled'
          || /用户请求取消任务|任务已取消|request_cancelled/i.test(String(job?.errorMessage || ''))
          || cancelRequestedAt > 0
        )
        && cancelRequestedAt > 0
        && cancelRequestedAt <= cutoff
      );
    })
    .map((job) => ({
      ...job,
      status: 'cancelled',
      finishedAt: Number(referenceTime || now()),
      updatedAt: Number(referenceTime || now()),
      errorCode: 'request_cancelled',
      errorMessage: '用户请求取消任务后执行器未及时退出，已自动取消并释放并发',
    }));
};

export const ensureJobsSchema = async (pool) => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS internal_jobs (
      id VARCHAR(24) PRIMARY KEY,
      user_id VARCHAR(24) NOT NULL,
      module VARCHAR(60) NOT NULL,
      task_type VARCHAR(80) NOT NULL,
      provider VARCHAR(40) NOT NULL,
      status VARCHAR(20) NOT NULL,
      priority INT NOT NULL DEFAULT 0,
      payload_json LONGTEXT NOT NULL,
      provider_task_id VARCHAR(120) NULL,
      result_json LONGTEXT NULL,
      error_code VARCHAR(80) NULL,
      error_message TEXT NULL,
      error_detail TEXT NULL,
      retry_count INT NOT NULL DEFAULT 0,
      max_retries INT NOT NULL DEFAULT 2,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL,
      started_at BIGINT NULL,
      finished_at BIGINT NULL,
      cancel_requested_at BIGINT NULL,
      INDEX idx_internal_jobs_user_id (user_id),
      INDEX idx_internal_jobs_status (status),
      INDEX idx_internal_jobs_updated_at (updated_at)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);

  // S2 Task G2:老库补 error_detail 列(errorMessage=人话、errorDetail=技术原文)。
  const [errorDetailColumns] = await pool.query(`SHOW COLUMNS FROM internal_jobs LIKE 'error_detail'`);
  if (!Array.isArray(errorDetailColumns) || errorDetailColumns.length === 0) {
    await pool.query('ALTER TABLE internal_jobs ADD COLUMN error_detail TEXT NULL AFTER error_message');
  }
};

export const createJobRecord = async (pool, user, payload) => {
  const jobId = randomBytes(12).toString('hex');
  const createdAt = now();
  const job = {
    id: jobId,
    userId: user.id,
    module: String(payload.module || 'system').slice(0, 60),
    taskType: String(payload.taskType || 'unknown').slice(0, 80),
    provider: String(payload.provider || 'internal').slice(0, 40),
    status: 'queued',
    priority: Number(payload.priority || 0),
    payload: payload.payload && typeof payload.payload === 'object' ? payload.payload : {},
    providerTaskId: String(payload.providerTaskId || ''),
    result: null,
    errorCode: '',
    errorMessage: '',
    retryCount: 0,
    maxRetries: Number(payload.maxRetries ?? 2),
    createdAt,
    updatedAt: createdAt,
    startedAt: null,
    finishedAt: null,
    cancelRequestedAt: null,
  };

  await pool.query(
    `INSERT INTO internal_jobs (
      id, user_id, module, task_type, provider, status, priority, payload_json,
      provider_task_id, result_json, error_code, error_message, retry_count,
      max_retries, created_at, updated_at, started_at, finished_at, cancel_requested_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      job.id,
      job.userId,
      job.module,
      job.taskType,
      job.provider,
      job.status,
      job.priority,
      serializeJsonValue(job.payload),
      job.providerTaskId || null,
      null,
      null,
      null,
      job.retryCount,
      job.maxRetries,
      job.createdAt,
      job.updatedAt,
      null,
      null,
      null,
    ]
  );

  return job;
};

export const findReusableJobRecord = async (pool, user, payload, dedupeWindowMs = 8000) => {
  const clientSubmissionKey = getClientSubmissionKey(payload?.payload);
  const createdAfter = clientSubmissionKey
    ? 0
    : Math.max(0, now() - Math.max(0, Number(dedupeWindowMs || 0)));
  const normalizedModule = String(payload.module || 'system').slice(0, 60);
  const normalizedTaskType = String(payload.taskType || 'unknown').slice(0, 80);
  const normalizedProvider = String(payload.provider || 'internal').slice(0, 40);
  const includeTerminalSubtitleReplay = Boolean(clientSubmissionKey)
    && normalizedTaskType === 'subtitle_remove_video';
  const [rows] = clientSubmissionKey
    ? await pool.query(
      `SELECT * FROM internal_jobs
       WHERE user_id = ?
         AND module = ?
         AND task_type = ?
         AND provider = ?
         AND status IN (${includeTerminalSubtitleReplay
    ? "'queued', 'running', 'retry_waiting', 'failed', 'succeeded', 'cancelled'"
    : "'queued', 'running', 'retry_waiting'"})
         AND ${PARENT_OWNED_CHILD_SQL_EXCLUSION}
         AND JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.clientSubmissionKey')) = ?
       ORDER BY created_at DESC`,
      [user.id, normalizedModule, normalizedTaskType, normalizedProvider, clientSubmissionKey]
    )
    : await pool.query(
      `SELECT * FROM internal_jobs
     WHERE user_id = ?
       AND module = ?
       AND task_type = ?
       AND provider = ?
       AND status IN ('queued', 'running', 'retry_waiting')
       AND ${PARENT_OWNED_CHILD_SQL_EXCLUSION}
       AND created_at >= ?
     ORDER BY created_at DESC
     LIMIT 20`,
      [user.id, normalizedModule, normalizedTaskType, normalizedProvider, createdAfter]
    );

  return findReusableJobSubmission({
    jobs: rows.map(mapJobRow),
    userId: user.id,
    module: normalizedModule,
    taskType: normalizedTaskType,
    provider: normalizedProvider,
    payload: payload.payload,
    createdAfter,
  });
};

export const getSubtitleRemovalSubmissionGuardState = async (pool, userId, payload = {}) => {
  const normalizedUserId = String(userId || '').trim();
  const batchId = String(payload?.batchId || '').trim();
  const clientSubmissionKey = String(payload?.clientSubmissionKey || '').trim();
  const [activeRows] = await pool.query(
    `SELECT COUNT(*) AS active_count
     FROM internal_jobs
     WHERE user_id = ?
       AND task_type = 'subtitle_remove_video'
       AND ${PARENT_OWNED_CHILD_SQL_EXCLUSION}
       AND status IN ('queued', 'running', 'retry_waiting')`,
    [normalizedUserId],
  );
  const [sameBatchRows] = await pool.query(
    `SELECT * FROM internal_jobs
     WHERE user_id = ?
       AND task_type = 'subtitle_remove_video'
       AND ${PARENT_OWNED_CHILD_SQL_EXCLUSION}
       AND JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.batchId')) = ?
     ORDER BY created_at DESC`,
    [normalizedUserId, batchId],
  );
  const [exactRows] = await pool.query(
    `SELECT * FROM internal_jobs
     WHERE user_id = ?
       AND task_type = 'subtitle_remove_video'
       AND ${PARENT_OWNED_CHILD_SQL_EXCLUSION}
       AND JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.clientSubmissionKey')) = ?
     ORDER BY created_at DESC
     LIMIT 1`,
    [normalizedUserId, clientSubmissionKey],
  );
  return {
    activeCount: Number(activeRows?.[0]?.active_count || 0),
    sameBatchJobs: (sameBatchRows || []).map(mapJobRow),
    exactReplay: exactRows?.[0] ? mapJobRow(exactRows[0]) : null,
  };
};

export const getJobById = async (pool, jobId) => {
  const [rows] = await pool.query('SELECT * FROM internal_jobs WHERE id = ? LIMIT 1', [jobId]);
  return rows[0] ? mapJobRow(rows[0]) : null;
};

export const findJobByProviderTaskIdForUser = async (pool, userId, providerTaskId) => {
  const normalizedProviderTaskId = String(providerTaskId || '').trim();
  if (!normalizedProviderTaskId) return null;
  const sourceTaskTypes = Array.from(KIE_RECOVERY_SOURCE_TASK_TYPES);
  const [rows] = await pool.query(
    `SELECT * FROM internal_jobs
     WHERE user_id = ?
       AND provider_task_id = ?
       AND provider = 'kie'
       AND task_type IN (${sourceTaskTypes.map(() => '?').join(', ')})
     ORDER BY created_at DESC
     LIMIT 1`,
    [String(userId || ''), normalizedProviderTaskId, ...sourceTaskTypes],
  );
  return rows[0] ? mapJobRow(rows[0]) : null;
};

export const getJobByIdForUpdate = async (connection, jobId) => {
  const [rows] = await connection.query(
    'SELECT * FROM internal_jobs WHERE id = ? LIMIT 1 FOR UPDATE',
    [jobId]
  );
  return rows[0] ? mapJobRow(rows[0]) : null;
};

export const resolveJobDeletionAction = (job = {}, { pendingReservation = false } = {}) => {
  const status = String(job?.status || '').trim();
  const providerTaskId = String(job?.providerTaskId || '').trim();
  const tombstoneRecoveryProviderTaskId = String(
    job?.payload?.__tombstoneRecovery?.providerTaskId || '',
  ).trim();
  if (
    providerTaskId
    && tombstoneRecoveryProviderTaskId === providerTaskId
    && ['queued', 'retry_waiting', 'running'].includes(status)
  ) {
    return 'block_submitted_recovery';
  }
  if (status === 'queued' || status === 'retry_waiting') return 'cancel_then_delete';
  if (status === 'running') return 'block_active';
  if (
    status === 'failed'
    && String(job?.errorCode || '').trim() === 'provider_submission_unknown'
    && pendingReservation
  ) {
    return 'block_submission_unknown';
  }
  if (status === 'failed' && String(job?.errorCode || '').trim() === 'provider_recovery_manual') {
    return 'block_recovery_manual';
  }
  if (status === 'cancelled' && String(job?.providerTaskId || '').trim()) {
    return 'block_submitted_cancelled';
  }
  if (pendingReservation) return 'block_pending_reservation';
  return 'delete';
};

export const normalizeSubmissionSettlementInput = ({
  actualCreditsConsumed,
  verificationNote,
} = {}) => {
  const amount = actualCreditsConsumed;
  const roundedCents = typeof amount === 'number' && Number.isFinite(amount)
    ? Math.round(amount * 100)
    : Number.NaN;
  if (
    typeof amount !== 'number'
    || !Number.isFinite(amount)
    || amount < 0
    || !Number.isSafeInteger(roundedCents)
    || Math.abs(amount * 100 - roundedCents) > 1e-6
  ) {
    throw Object.assign(new Error('人工结算必须填写大于等于 0 的实际扣费积分。'), {
      code: 'submission_resolution_credits_invalid',
      statusCode: 400,
    });
  }
  const note = typeof verificationNote === 'string' ? verificationNote.trim() : '';
  if (!note) {
    throw Object.assign(new Error('人工结算必须填写上游核验依据。'), {
      code: 'submission_resolution_evidence_required',
      statusCode: 400,
    });
  }
  return {
    actualCreditsConsumed: roundedCents / 100,
    verificationNote: note.slice(0, 500),
  };
};

export const requestTombstonedJobRecovery = async (pool, job) => {
  const connection = await pool.getConnection();
  try {
    return await withMysqlTransaction(connection, async () => {
      const [rows] = await connection.query(
        'SELECT * FROM internal_jobs WHERE id = ? FOR UPDATE',
        [job.id],
      );
      const freshJob = rows?.[0] ? mapJobRow(rows[0]) : null;
      if (!freshJob || (job.userId && freshJob.userId !== job.userId)) {
        throw Object.assign(new Error('任务不存在。'), {
          code: 'job_not_found',
          statusCode: 404,
        });
      }
      if (resolveJobDeletionAction(freshJob) === 'block_submitted_recovery') {
        return freshJob;
      }
      if (resolveJobDeletionAction(freshJob) !== 'block_submitted_cancelled') {
        throw Object.assign(new Error('只有已提交上游的取消任务可以进入删除恢复。'), {
          code: 'tombstone_recovery_not_allowed',
          statusCode: 409,
        });
      }
      if (!canRecoverProviderTaskById(freshJob)) {
        const updatedAt = now();
        const [result] = await connection.query(
          `UPDATE internal_jobs
           SET status = 'failed', error_code = 'provider_recovery_manual',
               error_message = '该上游任务不支持自动查询，请管理员核实后处置积分预留',
               finished_at = COALESCE(finished_at, ?), updated_at = ?
           WHERE id = ? AND status = 'cancelled' AND provider_task_id = ?`,
          [updatedAt, updatedAt, freshJob.id, freshJob.providerTaskId],
        );
        if (!result?.affectedRows) {
          throw Object.assign(new Error('任务状态已变化，请稍后重试。'), {
            code: 'job_state_changed',
            statusCode: 409,
          });
        }
        return {
          ...freshJob,
          status: 'failed',
          errorCode: 'provider_recovery_manual',
          errorMessage: '该上游任务不支持自动查询，请管理员核实后处置积分预留',
          finishedAt: freshJob.finishedAt || updatedAt,
          updatedAt,
        };
      }

      const updatedAt = now();
      const nextPayload = {
        ...(freshJob.payload || {}),
        __tombstoneRecovery: {
          providerTaskId: freshJob.providerTaskId,
          requestedAt: updatedAt,
        },
      };
      const [result] = await connection.query(
        `UPDATE internal_jobs
         SET status = 'retry_waiting', payload_json = ?, started_at = NULL, finished_at = NULL,
             cancel_requested_at = NULL,
             error_code = 'tombstone_recovery_pending',
             error_message = '已删除任务正在按原上游任务 ID 恢复查询', updated_at = ?
         WHERE id = ? AND status = 'cancelled' AND provider_task_id = ?`,
        [serializeJsonValue(nextPayload), updatedAt, freshJob.id, freshJob.providerTaskId],
      );
      if (!result?.affectedRows) {
        throw Object.assign(new Error('任务状态已变化，请稍后重试。'), {
          code: 'job_state_changed',
          statusCode: 409,
        });
      }
      return {
        ...freshJob,
        status: 'retry_waiting',
        payload: nextPayload,
        startedAt: null,
        finishedAt: null,
        cancelRequestedAt: null,
        result: freshJob.result,
        errorCode: 'tombstone_recovery_pending',
        errorMessage: '已删除任务正在按原上游任务 ID 恢复查询',
        updatedAt,
      };
    });
  } finally {
    connection.release();
  }
};

export const deleteJobById = async (pool, jobId, options = {}) => {
  const connection = await pool.getConnection();
  try {
    return await withMysqlTransaction(connection, async () => {
      const job = await getJobByIdForUpdate(connection, jobId);
      if (!job || (options.userId && String(job.userId) !== String(options.userId))) {
        return { job: null, action: 'not_found', deleted: false };
      }
      assertGenericJobMutationAllowed(job);
      const pendingReservation = typeof options.hasPendingReservation === 'function'
        ? Boolean(await options.hasPendingReservation(connection, job))
        : false;
      const action = resolveJobDeletionAction(job, { pendingReservation });
      if (action !== 'delete') return { job, action, deleted: false };

      const [result] = await connection.query(
        'DELETE FROM internal_jobs WHERE id = ? AND status = ?',
        [job.id, job.status]
      );
      if (!result?.affectedRows) {
        return { job, action: 'job_state_changed', deleted: false };
      }
      if (typeof options.afterDelete === 'function') {
        await options.afterDelete(connection, job);
      }
      return { job, action, deleted: true };
    });
  } finally {
    connection.release();
  }
};

export const listJobsForUser = async (pool, userId, options = {}) => {
  const limit = Math.min(200, Math.max(1, Number(options.limit || 100)));
  const [rows] = await pool.query(
    `SELECT * FROM internal_jobs
     WHERE user_id = ?
       AND ${PARENT_OWNED_CHILD_SQL_EXCLUSION}
     ORDER BY created_at DESC
     LIMIT ?`,
    [userId, limit]
  );
  return rows.map(mapJobRow);
};

export const listJobsByIdsForUser = async (pool, userId, jobIds = []) => {
  const normalizedIds = Array.from(new Set((Array.isArray(jobIds) ? jobIds : [])
    .map((value) => String(value || '').trim())
    .filter(Boolean)))
    .slice(0, 500);
  if (normalizedIds.length === 0) return [];
  const [rows] = await pool.query(
    `SELECT * FROM internal_jobs
     WHERE user_id = ?
       AND id IN (${normalizedIds.map(() => '?').join(', ')})
       AND ${PARENT_OWNED_CHILD_SQL_EXCLUSION}`,
    [String(userId || ''), ...normalizedIds],
  );
  return rows.map(mapJobRow);
};

export const getJobQueueStats = async (pool) => {
  const [rows] = await pool.query(
    `SELECT status, COUNT(*) AS count
     FROM internal_jobs
     WHERE status IN ('queued', 'retry_waiting', 'running')
       AND ${PARENT_OWNED_CHILD_SQL_EXCLUSION}
     GROUP BY status`
  );

  const counts = { queued: 0, running: 0 };
  rows.forEach((row) => {
    if (row.status === 'running') counts.running = Number(row.count || 0);
    if (row.status === 'queued' || row.status === 'retry_waiting') {
      counts.queued += Number(row.count || 0);
    }
  });
  return counts;
};

export const reconcileRestartedRunningJobs = async (pool) => {
  const [rows] = await pool.query(
    `SELECT * FROM internal_jobs
     WHERE status = 'running'
       AND ${PARENT_OWNED_CHILD_SQL_EXCLUSION}`,
  );
  const reconciled = reconcileRestartedMysqlJobs(rows.map(mapJobRow), now());
  for (const job of reconciled) {
    await updateJobFields(pool, job.id, {
      status: job.status,
      started_at: null,
      finished_at: job.finishedAt,
      updated_at: job.updatedAt,
      error_code: job.errorCode,
      error_message: job.errorMessage,
    });
  }
  return reconciled;
};

export const reconcileRestartedProviderlessRunningJobs = async (pool) => {
  const [rows] = await pool.query(
    `SELECT * FROM internal_jobs
     WHERE status = 'running'
       AND ${PARENT_OWNED_CHILD_SQL_EXCLUSION}
       AND (provider_task_id IS NULL OR provider_task_id = '')`
  );
  const reconciled = reconcileRestartedMysqlJobs(rows.map(mapJobRow), now());
  for (const job of reconciled) {
    await updateJobFields(pool, job.id, {
      status: job.status,
      started_at: null,
      finished_at: job.finishedAt,
      updated_at: job.updatedAt,
      error_code: job.errorCode,
      error_message: job.errorMessage,
    });
  }
  return reconciled;
};

export const reconcileStaleProviderlessRunningJobs = async (pool, options = {}) => {
  const referenceTime = Number(options.referenceTime || now());
  const staleMs = Math.max(1, Number(options.staleMs || DEFAULT_PROVIDERLESS_RUNNING_STALE_MS));
  const [rows] = await pool.query(
    `SELECT *
     FROM internal_jobs
     WHERE status = 'running'
       AND ${PARENT_OWNED_CHILD_SQL_EXCLUSION}
       AND (provider_task_id IS NULL OR provider_task_id = '')
       AND started_at IS NOT NULL
       AND started_at <= ?`,
    [referenceTime - staleMs]
  );
  const reconciled = reconcileStaleProviderlessRunningMysqlJobs(rows.map(mapJobRow), referenceTime, staleMs);
  for (const job of reconciled) {
    const retryWaiting = job.status === 'retry_waiting';
    const [attemptRows] = await pool.query(
      `SELECT *
       FROM internal_job_attempts
       WHERE job_id = ?
       ORDER BY attempt_no DESC
       LIMIT 1`,
      [job.id]
    );
    const attempt = attemptRows?.[0] || null;
    await updateJobFields(pool, job.id, {
      status: job.status,
      started_at: null,
      finished_at: job.finishedAt,
      updated_at: job.updatedAt,
      error_code: job.errorCode,
      error_message: job.errorMessage,
    });
    if (attempt?.id) {
      await runTaskPlatformWrite(() => finishJobAttempt(pool, attempt.id, {
        status: retryWaiting ? 'retry_waiting' : 'failed',
        providerTaskId: '',
        errorCode: job.errorCode,
        errorMessage: job.errorMessage,
        finishedAt: retryWaiting ? null : job.updatedAt,
      }));
    }
    await runTaskPlatformWrite(() => recordJobEvent(pool, job, {
      attemptId: attempt?.id,
      attemptNo: attempt?.attempt_no,
      traceId: attempt?.trace_id,
      stage: 'provider_submit',
      eventName: retryWaiting ? 'internal_job_stale_recovered' : 'provider_submission_unknown_failed',
      status: retryWaiting ? 'started' : 'failed',
      engine: attempt?.engine || 'temporal',
      providerSubmitted: false,
      retryable: retryWaiting,
      errorCode: job.errorCode,
      errorMessage: job.errorMessage,
      providerTaskId: '',
      workflowId: attempt?.workflow_id,
      runId: attempt?.run_id,
      meta: {
        staleMs,
        recoveredAt: job.updatedAt,
        previousStartedAt: rows.find((row) => row.id === job.id)?.started_at || null,
      },
      createdAt: job.updatedAt,
    }));
  }
  return reconciled;
};

export const reconcileStaleSubmittedRunningJobs = async (pool, options = {}) => {
  const referenceTime = Number(options.referenceTime || now());
  const staleMs = Math.max(1, Number(options.staleMs || DEFAULT_SUBMITTED_RUNNING_STALE_MS));
  const [rows] = await pool.query(
    `SELECT *
     FROM internal_jobs
     WHERE status = 'running'
       AND ${PARENT_OWNED_CHILD_SQL_EXCLUSION}
       AND provider_task_id IS NOT NULL
       AND provider_task_id <> ''
       AND updated_at IS NOT NULL
       AND updated_at <= ?`,
    [referenceTime - staleMs]
  );
  const reconciled = reconcileStaleSubmittedRunningMysqlJobs(rows.map(mapJobRow), referenceTime, staleMs);
  for (const job of reconciled) {
    const retryWaiting = job.status === 'retry_waiting';
    const [attemptRows] = await pool.query(
      `SELECT *
       FROM internal_job_attempts
       WHERE job_id = ?
       ORDER BY attempt_no DESC
       LIMIT 1`,
      [job.id]
    );
    const attempt = attemptRows?.[0] || null;
    await updateJobFields(pool, job.id, {
      status: job.status,
      started_at: null,
      finished_at: job.finishedAt,
      updated_at: job.updatedAt,
      error_code: job.errorCode,
      error_message: job.errorMessage,
    });
    if (attempt?.id) {
      await runTaskPlatformWrite(() => finishJobAttempt(pool, attempt.id, {
        status: retryWaiting ? 'retry_waiting' : 'failed',
        providerTaskId: job.providerTaskId || '',
        errorCode: job.errorCode,
        errorMessage: job.errorMessage,
        finishedAt: retryWaiting ? null : job.finishedAt,
      }));
    }
    await runTaskPlatformWrite(() => recordJobEvent(pool, job, {
      attemptId: attempt?.id,
      attemptNo: attempt?.attempt_no,
      traceId: attempt?.trace_id,
      stage: 'provider_wait',
      eventName: retryWaiting ? 'provider_wait_stale_recovered' : 'provider_submission_unknown_failed',
      status: retryWaiting ? 'started' : 'failed',
      engine: attempt?.engine || 'temporal',
      providerSubmitted: true,
      retryable: retryWaiting,
      errorCode: job.errorCode,
      errorMessage: job.errorMessage,
      providerTaskId: job.providerTaskId || '',
      workflowId: attempt?.workflow_id,
      runId: attempt?.run_id,
      meta: {
        staleMs,
        recoveredAt: job.updatedAt,
        previousUpdatedAt: rows.find((row) => row.id === job.id)?.updated_at || null,
      },
      createdAt: job.updatedAt,
    }));
  }
  return reconciled;
};

export const reconcileStaleCancelledRunningJobs = async (pool, options = {}) => {
  const referenceTime = Number(options.referenceTime || now());
  const staleMs = Math.max(1, Number(options.staleMs || DEFAULT_CANCELLED_RUNNING_STALE_MS));
  const [rows] = await pool.query(
    `SELECT *
     FROM internal_jobs
     WHERE status = 'running'
       AND ${PARENT_OWNED_CHILD_SQL_EXCLUSION}
       AND cancel_requested_at IS NOT NULL
       AND cancel_requested_at <= ?`,
    [referenceTime - staleMs]
  );
  const reconciled = reconcileStaleCancelledRunningMysqlJobs(rows.map(mapJobRow), referenceTime, staleMs);
  for (const job of reconciled) {
    const [attemptRows] = await pool.query(
      `SELECT *
       FROM internal_job_attempts
       WHERE job_id = ?
       ORDER BY attempt_no DESC
       LIMIT 1`,
      [job.id]
    );
    const attempt = attemptRows?.[0] || null;
    await updateJobFields(pool, job.id, {
      status: job.status,
      finished_at: job.finishedAt,
      updated_at: job.updatedAt,
      error_code: job.errorCode,
      error_message: job.errorMessage,
    });
    if (attempt?.id) {
      await runTaskPlatformWrite(() => finishJobAttempt(pool, attempt.id, {
        status: 'cancelled',
        providerTaskId: job.providerTaskId || '',
        errorCode: job.errorCode,
        errorMessage: job.errorMessage,
        finishedAt: job.updatedAt,
      }));
    }
    await runTaskPlatformWrite(() => recordJobEvent(pool, job, {
      attemptId: attempt?.id,
      attemptNo: attempt?.attempt_no,
      traceId: attempt?.trace_id,
      stage: 'cancelled',
      eventName: 'stale_cancelled_running_job_reconciled',
      status: 'interrupted',
      engine: attempt?.engine || 'temporal',
      providerSubmitted: Boolean(job.providerTaskId),
      retryable: false,
      errorCode: job.errorCode,
      errorMessage: job.errorMessage,
      providerTaskId: job.providerTaskId || '',
      workflowId: attempt?.workflow_id,
      runId: attempt?.run_id,
      meta: {
        staleMs,
        recoveredAt: job.updatedAt,
        cancelRequestedAt: rows.find((row) => row.id === job.id)?.cancel_requested_at || null,
      },
      createdAt: job.updatedAt,
    }));
  }
  return reconciled;
};

export const updateJobFields = async (pool, jobId, fields) => {
  const assignments = [];
  const values = [];
  Object.entries(fields).forEach(([key, value]) => {
    assignments.push(`${key} = ?`);
    values.push(value);
  });
  values.push(jobId);
  const [result] = await pool.query(`UPDATE internal_jobs SET ${assignments.join(', ')} WHERE id = ?`, values);
  return result;
};

export const updateRunningJobForClaim = async (pool, expectedClaim, fields) => {
  const assignments = [];
  const values = [];
  for (const [key, value] of Object.entries(fields)) {
    assignments.push(`${key} = ?`);
    values.push(value);
  }
  values.push(
    expectedClaim.id,
    expectedClaim.userId,
    Number(expectedClaim.startedAt),
  );
  const [result] = await pool.query(
    `UPDATE internal_jobs SET ${assignments.join(', ')}
     WHERE id = ? AND user_id = ? AND status = 'running' AND started_at = ?`,
    values,
  );
  if (Number(result?.affectedRows || 0) !== 1) {
    throw Object.assign(new Error('任务执行归属已变化，终态结果未写入。'), {
      code: 'job_state_changed',
      statusCode: 409,
    });
  }
  return result;
};

export const requestCancelJob = async (pool, job, actor) => {
  const updatedAt = now();
  const connection = await pool.getConnection();
  let outcome;
  try {
    outcome = await withMysqlTransaction(connection, async () => {
      const [rows] = await connection.query(
        'SELECT * FROM internal_jobs WHERE id = ? FOR UPDATE',
        [job.id]
      );
      const freshJob = rows?.[0] ? mapJobRow(rows[0]) : null;
      if (!freshJob || (job.userId && freshJob.userId !== job.userId)) {
        const error = new Error('任务不存在。');
        error.code = 'job_not_found';
        error.statusCode = 404;
        throw error;
      }
      assertGenericJobMutationAllowed(freshJob);

      if (freshJob.status === 'queued' || freshJob.status === 'retry_waiting') {
        const [result] = await connection.query(
          `UPDATE internal_jobs
           SET status = 'cancelled', cancel_requested_at = ?, finished_at = ?, updated_at = ?,
               error_code = 'request_cancelled', error_message = '用户取消了任务'
           WHERE id = ? AND status IN ('queued', 'retry_waiting')`,
          [updatedAt, updatedAt, updatedAt, freshJob.id]
        );
        if (!result?.affectedRows) {
          throw Object.assign(new Error('任务状态已变化，请刷新后重试。'), {
            code: 'job_state_changed',
            statusCode: 409,
          });
        }
        if (typeof actor?.releaseQueuedCredits === 'function') {
          await actor.releaseQueuedCredits(connection, freshJob, updatedAt);
        }
        return {
          job: {
            ...freshJob,
            status: 'cancelled',
            cancelRequestedAt: updatedAt,
            finishedAt: updatedAt,
            updatedAt,
            errorCode: 'request_cancelled',
            errorMessage: '用户取消了任务',
          },
          releasedQueuedCredits: true,
        };
      }

      if (freshJob.status === 'running') {
        const [result] = await connection.query(
          `UPDATE internal_jobs
           SET cancel_requested_at = ?, updated_at = ?, error_code = 'request_cancelled',
               error_message = '用户请求取消任务'
           WHERE id = ? AND status = 'running'`,
          [updatedAt, updatedAt, freshJob.id]
        );
        if (!result?.affectedRows) {
          throw Object.assign(new Error('任务状态已变化，请刷新后重试。'), {
            code: 'job_state_changed',
            statusCode: 409,
          });
        }
        return {
          job: {
            ...freshJob,
            cancelRequestedAt: updatedAt,
            updatedAt,
            errorCode: 'request_cancelled',
            errorMessage: '用户请求取消任务',
          },
          releasedQueuedCredits: false,
        };
      }

      return { job: freshJob, releasedQueuedCredits: false };
    });
  } finally {
    connection.release();
  }

  if (actor?.createLog) {
    await actor.createLog({
      user: actor.user,
      level: 'info',
      module: outcome.job.module,
      action: 'job_cancel_requested',
      message: `请求取消任务：${outcome.job.id}`,
      status: 'interrupted',
      meta: {
        jobId: outcome.job.id,
        providerTaskId: outcome.job.providerTaskId || '',
        provider: outcome.job.provider,
      },
    });
  }
  return outcome;
};

export const resolveSubmissionUnknownJob = async ({
  pool,
  jobId,
  action,
  providerTaskId = '',
  actualCreditsConsumed,
  verificationNote = '',
  releaseReservation,
  settleReservation,
}) => {
  const normalizedAction = String(action || '').trim();
  const normalizedProviderTaskId = String(providerTaskId || '').trim();
  if (!['bind', 'release', 'settle'].includes(normalizedAction)) {
    throw Object.assign(new Error('处置动作必须是 bind、release 或 settle。'), {
      code: 'submission_resolution_invalid',
      statusCode: 400,
    });
  }
  if (normalizedAction === 'bind' && !normalizedProviderTaskId) {
    throw Object.assign(new Error('绑定处置必须提供已核实的 providerTaskId。'), {
      code: 'submission_resolution_task_id_required',
      statusCode: 400,
    });
  }
  const settlementInput = normalizedAction === 'settle'
    ? normalizeSubmissionSettlementInput({ actualCreditsConsumed, verificationNote })
    : null;

  const connection = await pool.getConnection();
  try {
    return await withMysqlTransaction(connection, async () => {
      const [rows] = await connection.query(
        'SELECT * FROM internal_jobs WHERE id = ? FOR UPDATE',
        [jobId]
      );
      const job = rows?.[0] ? mapJobRow(rows[0]) : null;
      if (!job) {
        throw Object.assign(new Error('任务不存在。'), { code: 'job_not_found', statusCode: 404 });
      }
      const isSubmissionUnknown = job.errorCode === 'provider_submission_unknown';
      const isRecoveryManual = job.errorCode === 'provider_recovery_manual';
      if (job.status !== 'failed' || (!isSubmissionUnknown && !isRecoveryManual)) {
        throw Object.assign(new Error('只有提交状态未知或自动恢复已停止的失败任务可以人工处置。'), {
          code: 'submission_resolution_not_allowed',
          statusCode: 409,
        });
      }
      if (normalizedAction === 'bind' && isRecoveryManual) {
        throw Object.assign(new Error('自动恢复已停止的任务不能重新绑定，请核实后释放预留或按实际扣费结算。'), {
          code: 'submission_resolution_bind_unsupported',
          statusCode: 409,
        });
      }
      if (normalizedAction === 'bind' && !canRecoverProviderTaskById({
        taskType: job.taskType,
        provider: job.provider,
        providerTaskId: normalizedProviderTaskId,
        payload: job.payload,
      })) {
        throw Object.assign(new Error('该任务类型没有按上游任务 ID 查询结果的安全恢复路径，只能核实后释放预留。'), {
          code: 'submission_resolution_bind_unsupported',
          statusCode: 409,
        });
      }

      const updatedAt = now();
      if (normalizedAction === 'bind') {
        const [result] = await connection.query(
          `UPDATE internal_jobs
           SET status = 'retry_waiting', provider_task_id = ?, started_at = NULL, finished_at = NULL,
               cancel_requested_at = NULL, retry_count = 0, error_code = 'submission_resolved_bound',
               error_message = '管理员已核实并绑定上游任务 ID，等待恢复查询', updated_at = ?
           WHERE id = ? AND status = 'failed' AND error_code = 'provider_submission_unknown'`,
          [normalizedProviderTaskId, updatedAt, job.id]
        );
        if (!result?.affectedRows) {
          throw Object.assign(new Error('任务状态已变化，请刷新后重试。'), {
            code: 'job_state_changed',
            statusCode: 409,
          });
        }
        return {
          action: normalizedAction,
          resolutionKind: 'submission_unknown',
          job: {
            ...job,
            status: 'retry_waiting',
            providerTaskId: normalizedProviderTaskId,
            startedAt: null,
            finishedAt: null,
            cancelRequestedAt: null,
            retryCount: 0,
            errorCode: 'submission_resolved_bound',
            errorMessage: '管理员已核实并绑定上游任务 ID，等待恢复查询',
            updatedAt,
          },
        };
      }

      if (normalizedAction === 'settle') {
        if (typeof settleReservation !== 'function') {
          throw new TypeError('settleReservation callback is required.');
        }
        const settlement = await settleReservation(connection, job, settlementInput);
        const settledErrorCode = isRecoveryManual
          ? 'provider_recovery_settled'
          : 'provider_submission_settled';
        const settledMessage = `管理员已核实上游成功并按实际 ${settlementInput.actualCreditsConsumed} 积分结算`;
        const [result] = await connection.query(
          `UPDATE internal_jobs
           SET error_code = ?, error_message = ?, updated_at = ?
           WHERE id = ? AND status = 'failed' AND error_code = ?`,
          [settledErrorCode, settledMessage, updatedAt, job.id, job.errorCode],
        );
        if (!result?.affectedRows) {
          throw Object.assign(new Error('任务状态已变化，请刷新后重试。'), {
            code: 'job_state_changed',
            statusCode: 409,
          });
        }
        return {
          action: normalizedAction,
          resolutionKind: isRecoveryManual ? 'provider_recovery' : 'submission_unknown',
          settlement,
          job: {
            ...job,
            errorCode: settledErrorCode,
            errorMessage: settledMessage,
            updatedAt,
          },
        };
      }

      if (typeof releaseReservation !== 'function') {
        throw new TypeError('releaseReservation callback is required.');
      }
      await releaseReservation(connection, job);
      const releasedErrorCode = isRecoveryManual
        ? 'provider_recovery_released'
        : 'provider_submission_released';
      const releasedMessage = isRecoveryManual
        ? '管理员已核实自动恢复任务并释放积分预留'
        : '管理员已核实未产生上游任务并释放积分预留';
      const [result] = await connection.query(
        `UPDATE internal_jobs
         SET error_code = ?, error_message = ?, updated_at = ?
         WHERE id = ? AND status = 'failed' AND error_code = ?`,
        [releasedErrorCode, releasedMessage, updatedAt, job.id, job.errorCode]
      );
      if (!result?.affectedRows) {
        throw Object.assign(new Error('任务状态已变化，请刷新后重试。'), {
          code: 'job_state_changed',
          statusCode: 409,
        });
      }
      return {
        action: normalizedAction,
        resolutionKind: isRecoveryManual ? 'provider_recovery' : 'submission_unknown',
        job: {
          ...job,
          errorCode: releasedErrorCode,
          errorMessage: releasedMessage,
          updatedAt,
        },
      };
    });
  } finally {
    connection.release();
  }
};

export const requestRetryJob = async (pool, job, actor) => {
  assertGenericJobMutationAllowed(job);
  const updatedAt = now();
  const isVoiceoverParent = String(job?.taskType || '') === 'voiceover_translate_video'
    && String(job?.provider || '') === 'internal';
  const resetProviderTaskId = Boolean(actor?.resetProviderTaskId)
    || (
      isVoiceoverParent
      && actor?.voiceoverRetryPlan?.kind === 'provider'
      && actor?.voiceoverRetryPlan?.userConfirmed === true
    );
  if (isVoiceoverParent && !['failed', 'cancelled'].includes(String(job?.status || ''))) {
    throw Object.assign(new Error('只有失败或已取消的口播翻译父任务可以重试。'), {
      code: 'job_state_changed',
      statusCode: 409,
    });
  }
  const retryResult = isVoiceoverParent
    ? prepareVoiceoverJobRetryResult(job, actor?.voiceoverRetryPlan, {
      env: actor?.env,
      resolveVoiceoverConfig: actor?.resolveVoiceoverConfig,
    })
    : null;
  const fields = {
    status: 'queued',
    error_code: null,
    error_message: null,
    error_detail: null,
    finished_at: null,
    started_at: null,
    cancel_requested_at: null,
    result_json: retryResult ? serializeJsonValue(retryResult) : null,
    updated_at: updatedAt,
    ...(resetProviderTaskId ? { provider_task_id: null, retry_count: 0 } : {}),
  };
  let result;
  if (isVoiceoverParent) {
    const assignments = [];
    const values = [];
    for (const [key, value] of Object.entries(fields)) {
      assignments.push(`${key} = ?`);
      values.push(value);
    }
    values.push(job.id, job.status);
    const [updateResult] = await pool.query(
      `UPDATE internal_jobs
       SET ${assignments.join(', ')}
       WHERE id = ? AND status = ?`,
      values,
    );
    if (Number(updateResult?.affectedRows || 0) !== 1) {
      throw Object.assign(new Error('任务状态已变化，未重复创建新的付费尝试。'), {
        code: 'job_state_changed',
        statusCode: 409,
      });
    }
    result = updateResult;
  } else {
    result = await updateJobFields(pool, job.id, fields);
  }

  if (actor?.createLog) {
    await actor.createLog({
      user: actor.user,
      level: 'info',
      module: job.module,
      action: 'job_retry_requested',
      message: `重试任务：${job.id}`,
      status: 'started',
      meta: {
        jobId: job.id,
        providerTaskId: job.providerTaskId || '',
        provider: job.provider,
      },
    });
  }
  return result;
};

export const createJobWorker = ({
  getPool,
  executeJob,
  getMaxConcurrency,
  createLog,
  findUserById,
  settleJobCredits,
  releaseJobCredits,
  getTaskEngineMode = () => process.env.MEIAO_TASK_ENGINE,
  getProviderlessRunningStaleMs = () => DEFAULT_PROVIDERLESS_RUNNING_STALE_MS,
  getSubmittedRunningStaleMs = () => DEFAULT_SUBMITTED_RUNNING_STALE_MS,
  getCancelledRunningStaleMs = () => DEFAULT_CANCELLED_RUNNING_STALE_MS,
  isExecutionPaused = isDeployDrainActive,
  voiceoverEnv = process.env,
  resolveVoiceoverConfig,
}) => {
  const activeControllers = new Map();
  let timer = null;
  let draining = false;

  const runLoop = async () => {
    if (draining) return;
    draining = true;

    try {
      if (isExecutionPaused()) return;
      const taskEngine = normalizeTaskEngineMode(getTaskEngineMode());
      if (!shouldMysqlWorkerProcessTaskEngine(taskEngine)) return;

      const pool = await getPool();
      const maxConcurrency = await Promise.resolve(getMaxConcurrency());
      const availableSlots = Math.max(0, maxConcurrency - activeControllers.size);

      if (availableSlots <= 0) return;

      const [runningRows] = await pool.query(
        `SELECT *
         FROM internal_jobs
         WHERE status = 'running'
           AND ${PARENT_OWNED_CHILD_SQL_EXCLUSION}`
      );
      const referenceTime = now();
      const runningConcurrencyOptions = {
        referenceTime,
        providerlessStaleMs: await Promise.resolve(getProviderlessRunningStaleMs()),
        submittedStaleMs: await Promise.resolve(getSubmittedRunningStaleMs()),
        cancelledStaleMs: await Promise.resolve(getCancelledRunningStaleMs()),
      };
      const concurrencyBlockingRunningJobs = runningRows
        .map(mapJobRow)
        .filter((job) => isRunningJobConcurrencyBlocking(job, runningConcurrencyOptions));

      const [rows] = await pool.query(
        `SELECT * FROM internal_jobs
         WHERE status IN ('queued', 'retry_waiting')
           AND ${PARENT_OWNED_CHILD_SQL_EXCLUSION}
         ORDER BY priority DESC, created_at ASC
         LIMIT ?`,
        [Math.max(availableSlots * 10, 50)]
      );

      const jobs = rows.map(mapJobRow);
      const uniqueUserIds = Array.from(
        new Set([
          ...runningRows.map((row) => String(row.user_id || '')),
          ...jobs.map((job) => String(job.userId || '')),
        ].filter(Boolean))
      );
      const userConcurrencyMap = new Map();
      for (const userId of uniqueUserIds) {
        const user = await findUserById(userId);
        userConcurrencyMap.set(userId, toSafeJobConcurrency(user?.jobConcurrency, DEFAULT_JOB_CONCURRENCY));
      }

      const executableJobs = selectJobsWithinConcurrencyLimits({
        jobs,
        availableSlots,
        activeJobUserIds: concurrencyBlockingRunningJobs.map((job) => job.userId),
        getUserConcurrency: (userId) => userConcurrencyMap.get(String(userId || '')) || DEFAULT_JOB_CONCURRENCY,
      });

      for (const job of executableJobs) {
        if (isExecutionPaused()) break;
        if (activeControllers.has(job.id)) continue;

        const claimedAt = now();
        const claimAttempt = await runWithDeployJobClaimLock({
          pool,
          isExecutionPaused,
          claim: (connection) => connection.query(
            `UPDATE internal_jobs
             SET status = 'running', started_at = ?, updated_at = ?, error_code = NULL, error_message = NULL, error_detail = NULL
             WHERE id = ? AND status IN ('queued', 'retry_waiting')
               AND ${PARENT_OWNED_CHILD_SQL_EXCLUSION}`,
            [claimedAt, claimedAt, job.id],
          ),
        });
        if (claimAttempt.paused) break;
        const [result] = claimAttempt.value;

        if (!result?.affectedRows) continue;

        const controller = new AbortController();
        activeControllers.set(job.id, controller);

        void (async () => {
          let attempt = null;
          let notifiedProviderTaskId = '';
          try {
            const refreshedJob = await getJobById(pool, job.id);
            if (!refreshedJob) return;

            attempt = await runTaskPlatformWrite(() => createJobAttempt(pool, refreshedJob, { engine: taskEngine }));
            const user = await findUserById(refreshedJob.userId);
            if (refreshedJob.cancelRequestedAt) {
              controller.abort();
            }

            notifiedProviderTaskId = String(refreshedJob.providerTaskId || '').trim();
            const onProviderTaskId = async (providerTaskId) => {
              const value = String(providerTaskId || '').trim();
              if (!value || value === notifiedProviderTaskId) return;
              notifiedProviderTaskId = value;
              const updatedAt = now();
              await updateJobFields(pool, refreshedJob.id, {
                provider_task_id: value,
                retry_count: 0,
                updated_at: updatedAt,
              });
              await runTaskPlatformWrite(() => recordJobEvent(pool, refreshedJob, {
                attemptId: attempt?.id,
                attemptNo: attempt?.attemptNo,
                traceId: attempt?.traceId,
                stage: 'provider_submit',
                eventName: 'provider_task_id_received',
                status: 'started',
                engine: attempt?.engine,
                providerSubmitted: true,
                providerTaskId: value,
                workflowId: attempt?.workflowId,
                runId: attempt?.runId,
                meta: { providerTaskId: value },
              }));
            };
            const onResultCheckpoint = async (resultPatch, checkpointContext = {}) => {
              await persistMysqlVoiceoverParentCheckpoint({
                pool,
                jobId: refreshedJob.id,
                userId: refreshedJob.userId,
                startedAt: claimedAt,
                resultPatch,
                env: voiceoverEnv,
                resolveVoiceoverConfig: checkpointContext.voiceoverConfig
                  ? () => checkpointContext.voiceoverConfig
                  : resolveVoiceoverConfig,
              });
            };

            await runTaskPlatformWrite(() => recordJobEvent(pool, refreshedJob, {
              attemptId: attempt?.id,
              attemptNo: attempt?.attemptNo,
              traceId: attempt?.traceId,
              stage: 'provider_submit',
              eventName: 'provider_submit_started',
              status: 'started',
              engine: attempt?.engine,
              providerSubmitted: false,
              providerTaskId: refreshedJob.providerTaskId || '',
              workflowId: attempt?.workflowId,
              runId: attempt?.runId,
              meta: buildJobRuntimeLogMeta({ job: refreshedJob }),
            }));

            if (user && createLog) {
              await createLog({
                user,
                level: 'info',
                module: refreshedJob.module,
                action: 'provider_submit_started',
                message: `${refreshedJob.taskType} 开始提交上游`,
                status: 'started',
                meta: {
                  ...buildJobRuntimeLogMeta({ job: refreshedJob }),
                  providerSubmitPhase: 'started',
                },
              });
            }

            const output = await executeJob(refreshedJob, controller.signal, {
              onProviderTaskId,
              onResultCheckpoint,
            });
            const finishedAt = now();
            const latestBeforeComplete = await getJobById(pool, refreshedJob.id);
            if (!latestBeforeComplete || !isSameMysqlClaim(latestBeforeComplete, claimedAt)) {
              return;
            }
            const finalProviderTaskId = output?.providerTaskId || notifiedProviderTaskId || latestBeforeComplete.providerTaskId || '';
            await updateRunningJobForClaim(pool, latestBeforeComplete, {
              status: controller.signal.aborted ? 'cancelled' : 'succeeded',
              provider_task_id: finalProviderTaskId || null,
              result_json: serializeJsonValue(preserveVoiceoverCheckpoint(latestBeforeComplete, output?.result)),
              error_code: controller.signal.aborted ? 'request_cancelled' : null,
              error_message: controller.signal.aborted ? '任务已取消' : null,
              error_detail: null,
              finished_at: finishedAt,
              updated_at: finishedAt,
            });
            try {
              await settleJobCredits?.({
                job: latestBeforeComplete,
                output,
                finishedAt,
                aborted: controller.signal.aborted,
              });
            } catch (creditError) {
              console.error('Account credit settlement failed after job completion.', creditError);
            }
            await runTaskPlatformWrite(() => attempt?.id ? finishJobAttempt(pool, attempt.id, {
              status: controller.signal.aborted ? 'cancelled' : 'succeeded',
              providerTaskId: finalProviderTaskId,
              errorCode: controller.signal.aborted ? 'request_cancelled' : '',
              errorMessage: controller.signal.aborted ? '任务已取消' : '',
              finishedAt,
            }) : null);
            await runTaskPlatformWrite(() => recordJobEvent(pool, refreshedJob, {
              attemptId: attempt?.id,
              attemptNo: attempt?.attemptNo,
              traceId: attempt?.traceId,
              stage: controller.signal.aborted ? 'cancelled' : 'completed',
              eventName: controller.signal.aborted ? 'job_cancelled' : 'job_completed',
              status: controller.signal.aborted ? 'interrupted' : 'success',
              engine: attempt?.engine,
              providerSubmitted: Boolean(finalProviderTaskId),
              providerTaskId: finalProviderTaskId,
              workflowId: attempt?.workflowId,
              runId: attempt?.runId,
              meta: buildJobRuntimeLogMeta({ job: refreshedJob, result: output, finishedAt }),
              createdAt: finishedAt,
            }));

            if (user && createLog) {
              await createLog({
                user,
                level: 'info',
                module: refreshedJob.module,
                action: 'provider_submit_succeeded',
                message: `${refreshedJob.taskType} 上游提交完成`,
                status: controller.signal.aborted ? 'interrupted' : 'success',
                meta: {
                  ...buildJobRuntimeLogMeta({ job: refreshedJob, result: output, finishedAt }),
                  providerSubmitPhase: 'succeeded',
                },
              });
              await createLog({
                user,
                level: 'info',
                module: refreshedJob.module,
                action: 'job_completed',
                message: `${refreshedJob.taskType} 任务${controller.signal.aborted ? '已取消' : '完成'}`,
                status: controller.signal.aborted ? 'interrupted' : 'success',
                meta: buildJobRuntimeLogMeta({ job: refreshedJob, result: output, finishedAt }),
              });
            }
          } catch (error) {
            const poolAgain = await getPool();
            const latestJob = await getJobById(poolAgain, job.id);
            if (!latestJob || !isSameMysqlClaim(latestJob, claimedAt)) {
              return;
            }
            const errorFields = buildJobFailureErrorFields(error);
            const providerTaskId = String(error?.providerTaskId || notifiedProviderTaskId || latestJob?.providerTaskId || '');
            const failure = getNextJobFailureState({
              retryCount: latestJob?.retryCount ?? 0,
              maxRetries: latestJob?.maxRetries ?? 0,
              errorCode: error?.code || 'provider_internal_error',
              providerStage: error?.providerStage || '',
              providerTaskId,
              providerTaskRecoverable: canRecoverProviderTaskById({
                taskType: latestJob?.taskType,
                provider: latestJob?.provider,
                providerTaskId,
                payload: latestJob?.payload,
              }),
            });
            const finishedAt = now();
            const persistedErrorCode = getPersistedJobFailureErrorCode({
              job: { ...latestJob, providerTaskId },
              failure,
              errorCode: errorFields.errorCode,
              providerStatus: error?.providerStatus,
            });

            try {
              await updateRunningJobForClaim(poolAgain, latestJob, {
                status: error?.code === 'request_cancelled' ? 'cancelled' : failure.status,
                provider_task_id: providerTaskId || null,
                retry_count: error?.code === 'request_cancelled' ? latestJob.retryCount ?? 0 : failure.retryCount,
                error_code: persistedErrorCode,
                error_message: errorFields.errorMessage,
                error_detail: errorFields.errorDetail || null,
                result_json: isProviderCompletedOutputRejectedError(error)
                  ? serializeJsonValue(preserveVoiceoverCheckpoint(
                    latestJob,
                    getProviderCompletedRejectedOutput(error)?.result,
                  ))
                  : latestJob.result ? serializeJsonValue(latestJob.result) : null,
                updated_at: finishedAt,
                finished_at: failure.status === 'failed' || error?.code === 'request_cancelled' ? finishedAt : null,
              });
            } catch (persistError) {
              if (persistError?.code === 'job_state_changed') return;
              throw persistError;
            }
            try {
              if (isProviderCompletedOutputRejectedError(error)) {
                await settleJobCredits?.({
                  job: latestJob,
                  output: getProviderCompletedRejectedOutput(error),
                  finishedAt,
                  aborted: false,
                  rejected: true,
                });
              } else {
                await releaseJobCredits?.({ job: latestJob, error, finishedAt, retryWaiting: failure.status === 'retry_waiting' });
              }
            } catch (creditError) {
              console.error('Account credit finalization failed after job failure.', creditError);
            }
            await runTaskPlatformWrite(() => attempt?.id ? finishJobAttempt(poolAgain, attempt.id, {
              status: error?.code === 'request_cancelled' ? 'cancelled' : failure.status,
              providerTaskId: error?.providerTaskId || latestJob?.providerTaskId || '',
              errorCode: error?.code || 'provider_internal_error',
              errorMessage: String(error?.message || '任务执行失败').slice(0, 5000),
              finishedAt: failure.status === 'failed' || error?.code === 'request_cancelled' ? finishedAt : null,
            }) : null);
            if (latestJob) {
              await runTaskPlatformWrite(() => recordJobEvent(poolAgain, latestJob, {
                attemptId: attempt?.id,
                attemptNo: attempt?.attemptNo,
                traceId: attempt?.traceId,
                stage: error?.code === 'request_cancelled' ? 'cancelled' : mapProviderStageToTaskStage(error?.providerStage),
                eventName: error?.code === 'request_cancelled' ? 'job_cancelled' : 'job_failed',
                status: error?.code === 'request_cancelled'
                  ? 'interrupted'
                  : failure.status === 'retry_waiting'
                    ? 'started'
                    : 'failed',
                engine: attempt?.engine,
                providerSubmitted: Boolean(error?.providerTaskId || latestJob?.providerTaskId),
                retryable: failure.status === 'retry_waiting',
                errorCode: error?.code || 'provider_internal_error',
                errorMessage: String(error?.message || '任务执行失败').slice(0, 5000),
                providerTaskId: error?.providerTaskId || latestJob?.providerTaskId || '',
                workflowId: attempt?.workflowId,
                runId: attempt?.runId,
                meta: {
                  ...buildJobRuntimeLogMeta({ job: latestJob, error, finishedAt, retryCount: failure.retryCount }),
                  providerStage: String(error?.providerStage || '').trim(),
                  providerStatus: String(error?.providerStatus || '').trim(),
                },
                createdAt: finishedAt,
              }));
            }

            const user = latestJob ? await findUserById(latestJob.userId) : null;
            await maybeRecordCreditAlertLog({ error, job: latestJob, user, createLog, now: finishedAt });
            if (user && createLog) {
              const logFields = buildJobFailureLogFields({
                jobStatus: failure.status,
                taskType: latestJob.taskType,
                errorCode: error?.code || 'provider_internal_error',
              });
              await createLog({
                user,
                level: error?.code === 'request_cancelled' ? 'info' : logFields.level,
                module: latestJob.module,
                action: 'provider_submit_failed',
                message: `${latestJob.taskType} 上游提交失败`,
                detail: String(error?.message || '任务执行失败').slice(0, 5000),
                status: error?.code === 'request_cancelled'
                  ? 'interrupted'
                  : failure.status === 'retry_waiting'
                    ? 'started'
                    : 'failed',
                meta: {
                  ...buildJobRuntimeLogMeta({ job: latestJob, error, finishedAt, retryCount: failure.retryCount }),
                  providerSubmitPhase: 'failed',
                },
              });
              await createLog({
                user,
                level: error?.code === 'request_cancelled' ? 'info' : logFields.level,
                module: latestJob.module,
                action: error?.code === 'request_cancelled' ? 'job_failed' : logFields.action,
                message: error?.code === 'request_cancelled' ? `${latestJob.taskType} 任务失败` : logFields.message,
                detail: String(error?.message || '任务执行失败').slice(0, 5000),
                status: error?.code === 'request_cancelled' ? 'interrupted' : logFields.status,
                meta: buildJobRuntimeLogMeta({ job: latestJob, error, finishedAt, retryCount: failure.retryCount }),
              });
            }
          } finally {
            activeControllers.delete(job.id);
            void runLoop();
          }
        })();
      }
    } catch (error) {
      if (!isTransientMysqlConnectionError(error)) {
        throw error;
      }
      console.error('MySQL connection lost during job worker loop, will retry on next tick.', error);
    } finally {
      draining = false;
    }
  };

  return {
    start(intervalMs = 1000) {
      if (timer) return;
      timer = setInterval(() => {
        void runLoop();
      }, intervalMs);
      void runLoop();
    },
    stop() {
      if (!timer) return;
      clearInterval(timer);
      timer = null;
    },
    trigger() {
      void runLoop();
    },
    cancelActiveJob(jobId) {
      const controller = activeControllers.get(jobId);
      if (controller) {
        controller.abort();
      }
    },
  };
};
