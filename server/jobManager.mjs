import { randomBytes } from 'node:crypto';

import { buildJobFailureLogFields, buildJobRuntimeLogMeta, getNextJobFailureState, isTransientMysqlConnectionError } from './jobRuntime.mjs';
import { createJobAttempt, finishJobAttempt, normalizeTaskEngineMode, recordJobEvent } from './taskPlatform.mjs';

const now = () => Date.now();
const DEFAULT_JOB_CONCURRENCY = 5;
const DEFAULT_PROVIDERLESS_RUNNING_STALE_MS = 15 * 60 * 1000;
const DEFAULT_CANCELLED_RUNNING_STALE_MS = 60 * 1000;
const REUSABLE_JOB_STATUSES = new Set(['queued', 'running', 'retry_waiting']);

const parseJsonValue = (value, fallback = null) => {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};

const serializeJsonValue = (value) => JSON.stringify(value ?? null);

const normalizeReusablePayload = (value) => {
  if (Array.isArray(value)) return value.map(normalizeReusablePayload);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== 'requestId')
      .map(([key, entryValue]) => [key, normalizeReusablePayload(entryValue)])
  );
};

const toSafeJobConcurrency = (value, fallback = DEFAULT_JOB_CONCURRENCY) => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
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

  const serializedPayload = serializeJsonValue(normalizeReusablePayload(payload && typeof payload === 'object' ? payload : {}));
  const normalizedModule = String(module || 'system').slice(0, 60);
  const normalizedTaskType = String(taskType || 'unknown').slice(0, 80);
  const normalizedProvider = String(provider || 'internal').slice(0, 40);

  const matches = jobs
    .filter((job) => (
      String(job?.userId || '') === String(userId || '') &&
      String(job?.module || '') === normalizedModule &&
      String(job?.taskType || '') === normalizedTaskType &&
      String(job?.provider || '') === normalizedProvider &&
      REUSABLE_JOB_STATUSES.has(String(job?.status || '')) &&
      Number(job?.createdAt || 0) >= createdAfter &&
      serializeJsonValue(normalizeReusablePayload(job?.payload && typeof job.payload === 'object' ? job.payload : {})) === serializedPayload
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
    .map((job) => ({
      ...job,
      status: 'retry_waiting',
      startedAt: null,
      finishedAt: null,
      updatedAt: Number(referenceTime || now()),
      errorCode: 'service_restarted',
      errorMessage: '服务重启后任务已回收到待重试状态',
    }));
};

export const reconcileStaleProviderlessRunningMysqlJobs = (
  jobs,
  referenceTime = now(),
  staleMs = DEFAULT_PROVIDERLESS_RUNNING_STALE_MS
) => {
  if (!Array.isArray(jobs)) return [];
  const cutoff = Number(referenceTime || now()) - Math.max(1, Number(staleMs || DEFAULT_PROVIDERLESS_RUNNING_STALE_MS));
  return jobs
    .filter((job) => (
      String(job?.status || '') === 'running'
      && !String(job?.providerTaskId || '').trim()
      && Number(job?.startedAt || job?.updatedAt || job?.createdAt || 0) > 0
      && Number(job?.startedAt || job?.updatedAt || job?.createdAt || 0) <= cutoff
    ))
    .map((job) => ({
      ...job,
      status: 'failed',
      startedAt: null,
      finishedAt: Number(referenceTime || now()),
      updatedAt: Number(referenceTime || now()),
      errorCode: 'provider_submit_stale',
      errorMessage: '任务提交上游前长时间未返回上游任务 ID，已自动失败并释放并发',
    }));
};

export const reconcileStaleCancelledRunningMysqlJobs = (
  jobs,
  referenceTime = now(),
  staleMs = DEFAULT_CANCELLED_RUNNING_STALE_MS
) => {
  if (!Array.isArray(jobs)) return [];
  const cutoff = Number(referenceTime || now()) - Math.max(1, Number(staleMs || DEFAULT_CANCELLED_RUNNING_STALE_MS));
  return jobs
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
    providerTaskId: '',
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
      null,
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
  const createdAfter = Math.max(0, now() - Math.max(0, Number(dedupeWindowMs || 0)));
  const normalizedModule = String(payload.module || 'system').slice(0, 60);
  const normalizedTaskType = String(payload.taskType || 'unknown').slice(0, 80);
  const normalizedProvider = String(payload.provider || 'internal').slice(0, 40);
  const [rows] = await pool.query(
    `SELECT * FROM internal_jobs
     WHERE user_id = ?
       AND module = ?
       AND task_type = ?
       AND provider = ?
       AND status IN ('queued', 'running', 'retry_waiting')
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

export const getJobById = async (pool, jobId) => {
  const [rows] = await pool.query('SELECT * FROM internal_jobs WHERE id = ? LIMIT 1', [jobId]);
  return rows[0] ? mapJobRow(rows[0]) : null;
};

export const deleteJobById = async (pool, jobId) => {
  const job = await getJobById(pool, jobId);
  if (!job) return null;
  await pool.query('DELETE FROM internal_jobs WHERE id = ?', [jobId]);
  return job;
};

export const listJobsForUser = async (pool, userId, options = {}) => {
  const limit = Math.min(200, Math.max(1, Number(options.limit || 100)));
  const [rows] = await pool.query(
    `SELECT * FROM internal_jobs
     WHERE user_id = ?
     ORDER BY created_at DESC
     LIMIT ?`,
    [userId, limit]
  );
  return rows.map(mapJobRow);
};

export const getJobQueueStats = async (pool) => {
  const [rows] = await pool.query(
    `SELECT status, COUNT(*) AS count
     FROM internal_jobs
     WHERE status IN ('queued', 'retry_waiting', 'running')
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
  const [rows] = await pool.query(`SELECT * FROM internal_jobs WHERE status = 'running'`);
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
       AND (provider_task_id IS NULL OR provider_task_id = '')
       AND started_at IS NOT NULL
       AND started_at <= ?`,
    [referenceTime - staleMs]
  );
  const reconciled = reconcileStaleProviderlessRunningMysqlJobs(rows.map(mapJobRow), referenceTime, staleMs);
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
      started_at: null,
      finished_at: job.finishedAt,
      updated_at: job.updatedAt,
      error_code: job.errorCode,
      error_message: job.errorMessage,
    });
    if (attempt?.id) {
      await runTaskPlatformWrite(() => finishJobAttempt(pool, attempt.id, {
        status: 'failed',
        providerTaskId: '',
        errorCode: job.errorCode,
        errorMessage: job.errorMessage,
        finishedAt: job.updatedAt,
      }));
    }
    await runTaskPlatformWrite(() => recordJobEvent(pool, job, {
      attemptId: attempt?.id,
      attemptNo: attempt?.attempt_no,
      traceId: attempt?.trace_id,
      stage: 'provider_submit',
      eventName: 'provider_submit_stale_failed',
      status: 'failed',
      engine: attempt?.engine || 'temporal',
      providerSubmitted: false,
      retryable: false,
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

export const reconcileStaleCancelledRunningJobs = async (pool, options = {}) => {
  const referenceTime = Number(options.referenceTime || now());
  const staleMs = Math.max(1, Number(options.staleMs || DEFAULT_CANCELLED_RUNNING_STALE_MS));
  const [rows] = await pool.query(
    `SELECT *
     FROM internal_jobs
     WHERE status = 'running'
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
  await pool.query(`UPDATE internal_jobs SET ${assignments.join(', ')} WHERE id = ?`, values);
};

export const requestCancelJob = async (pool, job, actor) => {
  const updatedAt = now();

  if (job.status === 'queued' || job.status === 'retry_waiting') {
    await updateJobFields(pool, job.id, {
      status: 'cancelled',
      cancel_requested_at: updatedAt,
      finished_at: updatedAt,
      updated_at: updatedAt,
      error_code: 'request_cancelled',
      error_message: '用户取消了任务',
    });
  } else if (job.status === 'running') {
    await updateJobFields(pool, job.id, {
      cancel_requested_at: updatedAt,
      updated_at: updatedAt,
      error_code: 'request_cancelled',
      error_message: '用户请求取消任务',
    });
  }

  if (actor?.createLog) {
    await actor.createLog({
      user: actor.user,
      level: 'info',
      module: job.module,
      action: 'job_cancel_requested',
      message: `请求取消任务：${job.id}`,
      status: 'interrupted',
      meta: {
        jobId: job.id,
        providerTaskId: job.providerTaskId || '',
        provider: job.provider,
      },
    });
  }
};

export const requestRetryJob = async (pool, job, actor) => {
  const updatedAt = now();
  await updateJobFields(pool, job.id, {
    status: 'queued',
    error_code: null,
    error_message: null,
    finished_at: null,
    started_at: null,
    cancel_requested_at: null,
    result_json: null,
    updated_at: updatedAt,
  });

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
};

export const createJobWorker = ({
  getPool,
  executeJob,
  getMaxConcurrency,
  createLog,
  findUserById,
  getTaskEngineMode = () => process.env.MEIAO_TASK_ENGINE,
}) => {
  const activeControllers = new Map();
  let timer = null;
  let draining = false;

  const runLoop = async () => {
    if (draining) return;
    draining = true;

    try {
      const taskEngine = normalizeTaskEngineMode(getTaskEngineMode());
      if (!shouldMysqlWorkerProcessTaskEngine(taskEngine)) return;

      const pool = await getPool();
      const maxConcurrency = await Promise.resolve(getMaxConcurrency());
      const availableSlots = Math.max(0, maxConcurrency - activeControllers.size);

      if (availableSlots <= 0) return;

      const [runningRows] = await pool.query(
        `SELECT user_id
         FROM internal_jobs
         WHERE status = 'running'`
      );

      const [rows] = await pool.query(
        `SELECT * FROM internal_jobs
         WHERE status IN ('queued', 'retry_waiting')
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
        activeJobUserIds: runningRows.map((row) => row.user_id),
        getUserConcurrency: (userId) => userConcurrencyMap.get(String(userId || '')) || DEFAULT_JOB_CONCURRENCY,
      });

      for (const job of executableJobs) {
        if (activeControllers.has(job.id)) continue;

        const claimedAt = now();
        const [result] = await pool.query(
          `UPDATE internal_jobs
           SET status = 'running', started_at = ?, updated_at = ?, error_code = NULL, error_message = NULL
           WHERE id = ? AND status IN ('queued', 'retry_waiting')`,
          [claimedAt, claimedAt, job.id]
        );

        if (!result?.affectedRows) continue;

        const controller = new AbortController();
        activeControllers.set(job.id, controller);

        void (async () => {
          let attempt = null;
          try {
            const refreshedJob = await getJobById(pool, job.id);
            if (!refreshedJob) return;

            attempt = await runTaskPlatformWrite(() => createJobAttempt(pool, refreshedJob, { engine: taskEngine }));
            const user = await findUserById(refreshedJob.userId);
            if (refreshedJob.cancelRequestedAt) {
              controller.abort();
            }

            let notifiedProviderTaskId = String(refreshedJob.providerTaskId || '').trim();
            const onProviderTaskId = async (providerTaskId) => {
              const value = String(providerTaskId || '').trim();
              if (!value || value === notifiedProviderTaskId) return;
              notifiedProviderTaskId = value;
              const updatedAt = now();
              await updateJobFields(pool, refreshedJob.id, {
                provider_task_id: value,
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

            const output = await executeJob(refreshedJob, controller.signal, { onProviderTaskId });
            const finishedAt = now();
            const finalProviderTaskId = output?.providerTaskId || notifiedProviderTaskId || refreshedJob.providerTaskId || '';
            await updateJobFields(pool, refreshedJob.id, {
              status: controller.signal.aborted ? 'cancelled' : 'succeeded',
              provider_task_id: finalProviderTaskId || null,
              result_json: serializeJsonValue(output?.result || null),
              error_code: controller.signal.aborted ? 'request_cancelled' : null,
              error_message: controller.signal.aborted ? '任务已取消' : null,
              finished_at: finishedAt,
              updated_at: finishedAt,
            });
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
            const failure = getNextJobFailureState({
              retryCount: latestJob?.retryCount ?? 0,
              maxRetries: latestJob?.maxRetries ?? 0,
              errorCode: error?.code || 'provider_internal_error',
            });
            const finishedAt = now();

            await updateJobFields(poolAgain, job.id, {
              status: error?.code === 'request_cancelled' ? 'cancelled' : failure.status,
              provider_task_id: error?.providerTaskId || latestJob?.providerTaskId || null,
              retry_count: error?.code === 'request_cancelled' ? latestJob?.retryCount ?? 0 : failure.retryCount,
              error_code: error?.code || 'provider_internal_error',
              error_message: String(error?.message || '任务执行失败').slice(0, 5000),
              updated_at: finishedAt,
              finished_at: failure.status === 'failed' || error?.code === 'request_cancelled' ? finishedAt : null,
            });
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
