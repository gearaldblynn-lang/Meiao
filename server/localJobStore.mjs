import { randomBytes } from 'node:crypto';

import { buildJobFailureLogFields, buildJobRuntimeLogMeta, getNextJobFailureState } from './jobRuntime.mjs';
import { findReusableJobSubmission, selectJobsWithinConcurrencyLimits } from './jobManager.mjs';

const now = () => Date.now();

const cloneValue = (value) => JSON.parse(JSON.stringify(value ?? null));

const normalizeJobCreditsConsumed = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
};

const normalizeJob = (job) => ({
  id: String(job?.id || ''),
  userId: String(job?.userId || ''),
  module: String(job?.module || 'system'),
  taskType: String(job?.taskType || 'unknown'),
  provider: String(job?.provider || 'internal'),
  status: ['queued', 'running', 'succeeded', 'failed', 'cancelled', 'retry_waiting'].includes(job?.status) ? job.status : 'queued',
  priority: Number(job?.priority || 0),
  payload: job?.payload && typeof job.payload === 'object' ? cloneValue(job.payload) : {},
  providerTaskId: String(job?.providerTaskId || ''),
  result: job?.result && typeof job.result === 'object' ? cloneValue(job.result) : null,
  errorCode: String(job?.errorCode || ''),
  errorMessage: String(job?.errorMessage || ''),
  retryCount: Number(job?.retryCount || 0),
  maxRetries: Number(job?.maxRetries ?? 2),
  createdAt: Number(job?.createdAt || now()),
  updatedAt: Number(job?.updatedAt || now()),
  startedAt: job?.startedAt === null || job?.startedAt === undefined ? null : Number(job.startedAt),
  finishedAt: job?.finishedAt === null || job?.finishedAt === undefined ? null : Number(job.finishedAt),
  cancelRequestedAt: job?.cancelRequestedAt === null || job?.cancelRequestedAt === undefined ? null : Number(job.cancelRequestedAt),
});

const compactLocalJobRecord = (job) => {
  if (!job || job.taskType !== 'upload_asset') return job;
  if (job.status === 'queued' || job.status === 'running' || job.status === 'retry_waiting') return job;

  const payload = job.payload && typeof job.payload === 'object' ? job.payload : {};
  const result = job.result && typeof job.result === 'object' ? job.result : null;

  return normalizeJob({
    ...job,
    payload: {
      fileName: String(payload.fileName || '').trim(),
      mimeType: String(payload.mimeType || '').trim(),
      uploadPath: String(payload.uploadPath || '').trim(),
    },
    result: result ? {
      fileUrl: String(result.fileUrl || result.url || '').trim(),
      status: String(result.status || '').trim(),
    } : null,
  });
};

export const reconcileRestartedLocalJobs = (jobs) => {
  if (!Array.isArray(jobs)) return [];
  return jobs.map((job) => {
    const normalized = normalizeJob(job);
    if (normalized.status !== 'running') return normalized;

    return normalizeJob({
      ...normalized,
      status: 'retry_waiting',
      updatedAt: now(),
      startedAt: null,
      finishedAt: null,
      errorCode: normalized.errorCode || 'service_restarted',
      errorMessage: '服务重启后任务已回收到待重试状态',
    });
  });
};

export const normalizeLocalJobs = (jobs) => {
  if (!Array.isArray(jobs)) return [];
  return jobs
    .filter((job) => job && typeof job === 'object')
    .map(normalizeJob)
    .map(compactLocalJobRecord)
    .sort((a, b) => Number(b.createdAt) - Number(a.createdAt))
    .slice(0, 500);
};

const ensureStoreJobs = (store) => {
  store.jobs = normalizeLocalJobs(store.jobs);
  return store.jobs;
};

const findJobIndex = (store, jobId) => ensureStoreJobs(store).findIndex((item) => item.id === jobId);

export const createLocalJobRecord = (store, user, payload) => {
  const createdAt = now();
  const job = normalizeJob({
    id: randomBytes(12).toString('hex'),
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
  });

  ensureStoreJobs(store);
  store.jobs.unshift(job);
  return job;
};

export const findReusableLocalJobRecord = (store, user, payload, dedupeWindowMs = 8000) => {
  const createdAfter = Math.max(0, now() - Math.max(0, Number(dedupeWindowMs || 0)));
  return findReusableJobSubmission({
    jobs: ensureStoreJobs(store),
    userId: user.id,
    module: payload.module,
    taskType: payload.taskType,
    provider: payload.provider,
    payload: payload.payload,
    createdAfter,
  });
};

export const getLocalJobById = (store, jobId) => {
  const jobs = ensureStoreJobs(store);
  const job = jobs.find((item) => item.id === jobId);
  return job ? normalizeJob(job) : null;
};

export const deleteLocalJobRecord = (store, jobId) => {
  const index = findJobIndex(store, jobId);
  if (index < 0) return null;
  const [deleted] = store.jobs.splice(index, 1);
  return deleted ? normalizeJob(deleted) : null;
};

export const listLocalJobsForUser = (store, userId, options = {}) => {
  const limit = Math.min(200, Math.max(1, Number(options.limit || 100)));
  return ensureStoreJobs(store)
    .filter((job) => job.userId === userId)
    .filter((job) => job.taskType !== 'upload_asset')
    .slice(0, limit)
    .map(normalizeJob)
    .map(compactLocalJobRecord);
};

export const getLocalJobQueueStats = (store) => {
  const jobs = ensureStoreJobs(store);
  return jobs.reduce((acc, job) => {
    if (job.status === 'running') acc.running += 1;
    if (job.status === 'queued' || job.status === 'retry_waiting') acc.queued += 1;
    return acc;
  }, { queued: 0, running: 0 });
};

export const requestLocalCancelJob = (store, jobId) => {
  const index = findJobIndex(store, jobId);
  if (index < 0) return null;

  const updatedAt = now();
  const current = store.jobs[index];
  const next = {
    ...current,
    updatedAt,
    errorCode: 'request_cancelled',
  };

  if (current.status === 'queued' || current.status === 'retry_waiting') {
    next.status = 'cancelled';
    next.errorMessage = '用户取消了任务';
    next.cancelRequestedAt = updatedAt;
    next.finishedAt = updatedAt;
  } else if (current.status === 'running') {
    next.errorMessage = '用户请求取消任务';
    next.cancelRequestedAt = updatedAt;
  }

  store.jobs[index] = normalizeJob(next);
  return store.jobs[index];
};

export const requestLocalRetryJob = (store, jobId) => {
  const index = findJobIndex(store, jobId);
  if (index < 0) return null;

  const updatedAt = now();
  const next = normalizeJob({
    ...store.jobs[index],
    status: 'queued',
    errorCode: '',
    errorMessage: '',
    result: null,
    startedAt: null,
    finishedAt: null,
    cancelRequestedAt: null,
    updatedAt,
  });

  store.jobs[index] = next;
  return next;
};

export const takeNextLocalExecutableJobs = (store, availableSlots, options = {}) => {
  if (availableSlots <= 0) return [];
  const jobs = ensureStoreJobs(store);
  const candidates = jobs
    .filter((job) => job.status === 'queued' || job.status === 'retry_waiting')
    .sort((a, b) => Number(b.priority || 0) - Number(a.priority || 0) || Number(a.createdAt || 0) - Number(b.createdAt || 0));

  const runningUserIds = jobs
    .filter((job) => job.status === 'running')
    .map((job) => job.userId);

  const executableJobs = selectJobsWithinConcurrencyLimits({
    jobs: candidates,
    availableSlots,
    activeJobUserIds: runningUserIds,
    getUserConcurrency: (userId) => {
      if (typeof options.getUserConcurrency === 'function') {
        return options.getUserConcurrency(userId);
      }
      const matchedUser = Array.isArray(store.users)
        ? store.users.find((user) => user && user.id === userId)
        : null;
      return matchedUser?.jobConcurrency ?? 5;
    },
  });

  const claimedAt = now();
  return executableJobs.map((job) => {
    const index = findJobIndex(store, job.id);
    const updated = normalizeJob({
      ...store.jobs[index],
      status: 'running',
      startedAt: claimedAt,
      updatedAt: claimedAt,
      errorCode: '',
      errorMessage: '',
    });
    store.jobs[index] = updated;
    return updated;
  });
};

export const markLocalJobCompleted = (store, jobId, output, aborted = false) => {
  const index = findJobIndex(store, jobId);
  if (index < 0) return null;
  const finishedAt = now();
  const current = store.jobs[index];
  const next = normalizeJob({
    ...current,
    status: aborted ? 'cancelled' : 'succeeded',
    providerTaskId: output?.providerTaskId || current.providerTaskId || '',
    result: output?.result || null,
    errorCode: aborted ? 'request_cancelled' : '',
    errorMessage: aborted ? '任务已取消' : '',
    finishedAt,
    updatedAt: finishedAt,
  });
  store.jobs[index] = next;
  return next;
};

export const updateLocalJobProviderTaskId = (store, jobId, providerTaskId) => {
  const index = findJobIndex(store, jobId);
  const value = String(providerTaskId || '').trim();
  if (index < 0 || !value) return null;
  const next = normalizeJob({
    ...store.jobs[index],
    providerTaskId: value,
    updatedAt: now(),
  });
  store.jobs[index] = next;
  return next;
};

export const markLocalJobFailed = (store, jobId, error) => {
  const index = findJobIndex(store, jobId);
  if (index < 0) return null;
  const current = store.jobs[index];
  const failure = getNextJobFailureState({
    retryCount: current.retryCount,
    maxRetries: current.maxRetries,
    errorCode: error?.code || 'provider_internal_error',
  });
  const finishedAt = now();
  const next = normalizeJob({
    ...current,
    status: error?.code === 'request_cancelled' ? 'cancelled' : failure.status,
    providerTaskId: String(error?.providerTaskId || current.providerTaskId || ''),
    retryCount: error?.code === 'request_cancelled' ? current.retryCount : failure.retryCount,
    errorCode: error?.code || 'provider_internal_error',
    errorMessage: String(error?.message || '任务执行失败').slice(0, 5000),
    updatedAt: finishedAt,
    finishedAt: failure.status === 'failed' || error?.code === 'request_cancelled' ? finishedAt : null,
  });
  store.jobs[index] = next;
  return next;
};

export const createLocalJobWorker = ({
  readStore,
  writeStore,
  executeJob,
  getMaxConcurrency,
  createLog,
  findUserById,
}) => {
  let timer = null;
  let draining = false;
  const activeControllers = new Map();

  const runLoop = async () => {
    if (draining) return;
    draining = true;

    try {
      const store = readStore();
      const maxConcurrency = await Promise.resolve(getMaxConcurrency());
      const availableSlots = Math.max(0, maxConcurrency - activeControllers.size);
      const claimed = takeNextLocalExecutableJobs(store, availableSlots);
      if (claimed.length === 0) return;
      writeStore(store);

      for (const job of claimed) {
        if (activeControllers.has(job.id)) continue;

        const controller = new AbortController();
        activeControllers.set(job.id, controller);

        void (async () => {
          try {
            const currentStore = readStore();
            const refreshedJob = getLocalJobById(currentStore, job.id);
            if (!refreshedJob) return;
            if (refreshedJob.cancelRequestedAt) {
              controller.abort();
            }

            let notifiedProviderTaskId = String(refreshedJob.providerTaskId || '').trim();
            const onProviderTaskId = async (providerTaskId) => {
              const value = String(providerTaskId || '').trim();
              if (!value || value === notifiedProviderTaskId) return;
              notifiedProviderTaskId = value;
              const providerStore = readStore();
              updateLocalJobProviderTaskId(providerStore, refreshedJob.id, value);
              writeStore(providerStore);
            };

            const output = await executeJob(refreshedJob, controller.signal, { onProviderTaskId });
            const completeStore = readStore();
            const finishedJob = markLocalJobCompleted(completeStore, refreshedJob.id, output, controller.signal.aborted);
            writeStore(completeStore);

            const user = finishedJob ? findUserById(finishedJob.userId) : null;
            if (user && createLog && finishedJob) {
              createLog({
                user,
                level: 'info',
                module: finishedJob.module,
                action: 'job_completed',
                message: `${finishedJob.taskType} 任务${controller.signal.aborted ? '已取消' : '完成'}`,
                status: controller.signal.aborted ? 'interrupted' : 'success',
                meta: buildJobRuntimeLogMeta({ job: finishedJob, result: { providerTaskId: finishedJob.providerTaskId, result: finishedJob.result }, finishedAt: finishedJob.finishedAt }),
              });
            }
          } catch (error) {
            const failureStore = readStore();
            const failedJob = markLocalJobFailed(failureStore, job.id, error);
            writeStore(failureStore);

            const user = failedJob ? findUserById(failedJob.userId) : null;
            if (user && createLog && failedJob) {
              const logFields = buildJobFailureLogFields({
                jobStatus: failedJob.status,
                taskType: failedJob.taskType,
                errorCode: failedJob.errorCode,
              });
              createLog({
                user,
                level: error?.code === 'request_cancelled' ? 'info' : logFields.level,
                module: failedJob.module,
                action: error?.code === 'request_cancelled' ? 'job_failed' : logFields.action,
                message: error?.code === 'request_cancelled' ? `${failedJob.taskType} 任务失败` : logFields.message,
                detail: failedJob.errorMessage,
                status: error?.code === 'request_cancelled' ? 'interrupted' : logFields.status,
                meta: buildJobRuntimeLogMeta({ job: failedJob, error, finishedAt: failedJob.finishedAt || Date.now(), retryCount: failedJob.retryCount }),
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
      if (controller) controller.abort();
    },
  };
};
