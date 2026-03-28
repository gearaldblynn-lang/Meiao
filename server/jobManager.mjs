import { randomBytes } from 'node:crypto';

import { getNextJobFailureState } from './jobRuntime.mjs';

const now = () => Date.now();
const DEFAULT_JOB_CONCURRENCY = 5;
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

const toSafeJobConcurrency = (value, fallback = DEFAULT_JOB_CONCURRENCY) => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
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

  const serializedPayload = serializeJsonValue(payload && typeof payload === 'object' ? payload : {});
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
      serializeJsonValue(job?.payload && typeof job.payload === 'object' ? job.payload : {}) === serializedPayload
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

const updateJobFields = async (pool, jobId, fields) => {
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
}) => {
  const activeControllers = new Map();
  let timer = null;
  let draining = false;

  const runLoop = async () => {
    if (draining) return;
    draining = true;

    try {
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
          try {
            const refreshedJob = await getJobById(pool, job.id);
            if (!refreshedJob) return;

            const user = await findUserById(refreshedJob.userId);
            if (refreshedJob.cancelRequestedAt) {
              controller.abort();
            }

            const output = await executeJob(refreshedJob, controller.signal);
            const finishedAt = now();
            await updateJobFields(pool, refreshedJob.id, {
              status: controller.signal.aborted ? 'cancelled' : 'succeeded',
              provider_task_id: output?.providerTaskId || refreshedJob.providerTaskId || null,
              result_json: serializeJsonValue(output?.result || null),
              error_code: controller.signal.aborted ? 'request_cancelled' : null,
              error_message: controller.signal.aborted ? '任务已取消' : null,
              finished_at: finishedAt,
              updated_at: finishedAt,
            });

            if (user && createLog) {
              await createLog({
                user,
                level: 'info',
                module: refreshedJob.module,
                action: 'job_completed',
                message: `${refreshedJob.taskType} 任务${controller.signal.aborted ? '已取消' : '完成'}`,
                status: controller.signal.aborted ? 'interrupted' : 'success',
                meta: {
                  jobId: refreshedJob.id,
                  providerTaskId: output?.providerTaskId || refreshedJob.providerTaskId || '',
                  provider: refreshedJob.provider,
                  retryCount: refreshedJob.retryCount,
                  taskType: refreshedJob.taskType,
                  queueWaitMs: refreshedJob.startedAt && refreshedJob.createdAt ? Math.max(0, refreshedJob.startedAt - refreshedJob.createdAt) : 0,
                  runtimeMs: finishedAt - (refreshedJob.startedAt || finishedAt),
                  jobCreatedAt: refreshedJob.createdAt,
                  jobStartedAt: refreshedJob.startedAt,
                  jobFinishedAt: finishedAt,
                },
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

            const user = latestJob ? await findUserById(latestJob.userId) : null;
            if (user && createLog) {
              await createLog({
                user,
                level: 'error',
                module: latestJob.module,
                action: failure.status === 'retry_waiting' ? 'job_retry_waiting' : 'job_failed',
                message: failure.status === 'retry_waiting' ? `${latestJob.taskType} 任务等待重试` : `${latestJob.taskType} 任务失败`,
                detail: String(error?.message || '任务执行失败').slice(0, 5000),
                status: error?.code === 'request_cancelled' ? 'interrupted' : 'failed',
                meta: {
                  jobId: latestJob.id,
                  providerTaskId: latestJob.providerTaskId || '',
                  provider: latestJob.provider,
                  retryCount: failure.retryCount,
                  errorCode: error?.code || 'provider_internal_error',
                  taskType: latestJob.taskType,
                  queueWaitMs: latestJob.startedAt && latestJob.createdAt ? Math.max(0, latestJob.startedAt - latestJob.createdAt) : 0,
                  runtimeMs: latestJob.startedAt ? Math.max(0, finishedAt - latestJob.startedAt) : 0,
                  jobCreatedAt: latestJob.createdAt,
                  jobStartedAt: latestJob.startedAt,
                  jobFinishedAt: finishedAt,
                },
              });
            }
          } finally {
            activeControllers.delete(job.id);
            void runLoop();
          }
        })();
      }
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
