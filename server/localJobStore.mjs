import { randomBytes } from 'node:crypto';

import { buildJobFailureErrorFields, buildJobFailureLogFields, buildJobRuntimeLogMeta, getNextJobFailureState, getPersistedJobFailureErrorCode, getProviderCompletedRejectedOutput, isProviderCompletedOutputRejectedError } from './jobRuntime.mjs';
import { canRecoverProviderTaskById, KIE_RECOVERY_SOURCE_TASK_TYPES } from './jobSubmissionPolicy.mjs';
import { maybeRecordCreditAlertLog } from './creditAlert.mjs';
import { findReusableJobSubmission, normalizeSubmissionSettlementInput, selectJobsWithinConcurrencyLimits } from './jobManager.mjs';
import { isDeployDrainActive } from './deployDrain.mjs';
import {
  assertGenericJobMutationAllowed,
  isParentOwnedChildJob,
  persistLocalVoiceoverParentCheckpoint,
  prepareVoiceoverJobRetryResult,
} from './voiceoverChildJobStore.mjs';

const now = () => Date.now();
const LOCAL_ACTIVE_JOB_STATUSES = new Set(['queued', 'running', 'retry_waiting']);

const cloneValue = (value) => JSON.parse(JSON.stringify(value ?? null));

const createJobStateChangedError = () => Object.assign(
  new Error('任务执行归属已变化，终态结果未写入。'),
  { code: 'job_state_changed', statusCode: 409 },
);

const assertLocalRunningClaim = (job, expectedClaim) => {
  if (!expectedClaim) return job;
  if (
    String(job?.id || '') !== String(expectedClaim.id || '')
    || String(job?.userId || '') !== String(expectedClaim.userId || '')
    || String(job?.status || '') !== 'running'
    || Number(job?.startedAt) !== Number(expectedClaim.startedAt)
  ) {
    throw createJobStateChangedError();
  }
  return job;
};

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
  errorDetail: String(job?.errorDetail || ''),
  retryCount: Number(job?.retryCount || 0),
  maxRetries: Number(job?.maxRetries ?? 2),
  createdAt: Number(job?.createdAt || now()),
  updatedAt: Number(job?.updatedAt || now()),
  startedAt: job?.startedAt === null || job?.startedAt === undefined ? null : Number(job.startedAt),
  finishedAt: job?.finishedAt === null || job?.finishedAt === undefined ? null : Number(job.finishedAt),
  cancelRequestedAt: job?.cancelRequestedAt === null || job?.cancelRequestedAt === undefined ? null : Number(job.cancelRequestedAt),
  taskEngine: String(job?.taskEngine || ''),
  workflowId: String(job?.workflowId || ''),
  runId: String(job?.runId || ''),
  workflowExecutionMode: String(job?.workflowExecutionMode || ''),
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
    if (isParentOwnedChildJob(normalized)) return normalized;
    const updatedAt = now();
    const canRecoverProviderTask = canRecoverProviderTaskById(normalized);
    const canSafelyRequeueInternal = String(normalized.provider || '').trim() === 'internal';
    const canRecover = canRecoverProviderTask || canSafelyRequeueInternal;

    return normalizeJob({
      ...normalized,
      status: canRecover ? 'retry_waiting' : 'failed',
      updatedAt,
      startedAt: null,
      finishedAt: canRecover ? null : updatedAt,
      errorCode: canRecover ? 'service_restarted' : 'provider_submission_unknown',
      errorMessage: canRecover
        ? '服务重启后任务已回收到待恢复状态'
        : '服务重启时任务尚未记录上游任务 ID，已停止自动重试以防止重复扣费',
    });
  });
};

export const normalizeLocalJobs = (jobs) => {
  if (!Array.isArray(jobs)) return [];
  const normalized = jobs
    .filter((job) => job && typeof job === 'object')
    .map(normalizeJob)
    .map(compactLocalJobRecord)
    .sort((a, b) => Number(b.createdAt) - Number(a.createdAt));
  const active = normalized.filter((job) => LOCAL_ACTIVE_JOB_STATUSES.has(job.status));
  const activeVoiceoverParentIds = new Set(active
    .filter((job) => job.taskType === 'voiceover_translate_video' && job.provider === 'internal')
    .map((job) => job.id));
  const protectedChildren = normalized.filter((job) => (
    !LOCAL_ACTIVE_JOB_STATUSES.has(job.status)
    && isParentOwnedChildJob(job)
    && activeVoiceoverParentIds.has(String(job.payload?.parentJobId || ''))
  ));
  const protectedChildIds = new Set(protectedChildren.map((job) => job.id));
  const terminalLimit = Math.max(0, 500 - active.length - protectedChildren.length);
  const terminal = normalized
    .filter((job) => !LOCAL_ACTIVE_JOB_STATUSES.has(job.status) && !protectedChildIds.has(job.id))
    .slice(0, terminalLimit);
  return [...active, ...protectedChildren, ...terminal]
    .sort((a, b) => Number(b.createdAt) - Number(a.createdAt));
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
    providerTaskId: String(payload.providerTaskId || ''),
    result: null,
    errorCode: '',
    errorMessage: '',
    errorDetail: '',
    retryCount: 0,
    maxRetries: Number(payload.maxRetries ?? 2),
    createdAt,
    updatedAt: createdAt,
    startedAt: null,
    finishedAt: null,
    cancelRequestedAt: null,
    taskEngine: '',
    workflowId: '',
    runId: '',
    workflowExecutionMode: '',
  });

  ensureStoreJobs(store);
  store.jobs.unshift(job);
  return job;
};

export const findReusableLocalJobRecord = (store, user, payload, dedupeWindowMs = 8000) => {
  const clientSubmissionKey = String(payload?.payload?.clientSubmissionKey || '').trim();
  const createdAfter = clientSubmissionKey
    ? 0
    : Math.max(0, now() - Math.max(0, Number(dedupeWindowMs || 0)));
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

export const resolveLocalSubmissionUnknownJob = (store, {
  jobId,
  action,
  providerTaskId = '',
  actualCreditsConsumed,
  verificationNote = '',
  releaseReservation,
  settleReservation,
} = {}) => {
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

  const index = findJobIndex(store, jobId);
  const job = index >= 0 ? normalizeJob(store.jobs[index]) : null;
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
    const updated = normalizeJob({
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
    });
    store.jobs[index] = updated;
    return { action: normalizedAction, resolutionKind: 'submission_unknown', job: updated };
  }

  if (normalizedAction === 'settle') {
    if (typeof settleReservation !== 'function') {
      throw new TypeError('settleReservation callback is required.');
    }
    const settlement = settleReservation(job, settlementInput);
    const updated = normalizeJob({
      ...job,
      errorCode: isRecoveryManual ? 'provider_recovery_settled' : 'provider_submission_settled',
      errorMessage: `管理员已核实上游成功并按实际 ${settlementInput.actualCreditsConsumed} 积分结算`,
      updatedAt,
    });
    store.jobs[index] = updated;
    return {
      action: normalizedAction,
      resolutionKind: isRecoveryManual ? 'provider_recovery' : 'submission_unknown',
      settlement,
      job: updated,
    };
  }

  if (typeof releaseReservation !== 'function') {
    throw new TypeError('releaseReservation callback is required.');
  }
  releaseReservation(job);
  const updated = normalizeJob({
    ...job,
    errorCode: isRecoveryManual ? 'provider_recovery_released' : 'provider_submission_released',
    errorMessage: isRecoveryManual
      ? '管理员已核实自动恢复任务并释放积分预留'
      : '管理员已核实未产生上游任务并释放积分预留',
    updatedAt,
  });
  store.jobs[index] = updated;
  return {
    action: normalizedAction,
    resolutionKind: isRecoveryManual ? 'provider_recovery' : 'submission_unknown',
    job: updated,
  };
};

export const getLocalJobById = (store, jobId) => {
  const jobs = ensureStoreJobs(store);
  const job = jobs.find((item) => item.id === jobId);
  return job ? normalizeJob(job) : null;
};

export const findLocalJobByProviderTaskIdForUser = (store, userId, providerTaskId) => {
  const normalizedProviderTaskId = String(providerTaskId || '').trim();
  if (!normalizedProviderTaskId) return null;
  const job = ensureStoreJobs(store).find((item) => (
    String(item.userId || '') === String(userId || '')
    && String(item.providerTaskId || '').trim() === normalizedProviderTaskId
    && String(item.provider || '').trim() === 'kie'
    && KIE_RECOVERY_SOURCE_TASK_TYPES.has(String(item.taskType || '').trim())
  ));
  return job ? normalizeJob(job) : null;
};

export const deleteLocalJobRecord = (store, jobId) => {
  const index = findJobIndex(store, jobId);
  if (index < 0) return null;
  assertGenericJobMutationAllowed(store.jobs[index]);
  const [deleted] = store.jobs.splice(index, 1);
  return deleted ? normalizeJob(deleted) : null;
};

export const listLocalJobsForUser = (store, userId, options = {}) => {
  const limit = Math.min(200, Math.max(1, Number(options.limit || 100)));
  return ensureStoreJobs(store)
    .filter((job) => job.userId === userId)
    .filter((job) => job.taskType !== 'upload_asset')
    .filter((job) => !isParentOwnedChildJob(job))
    .slice(0, limit)
    .map(normalizeJob)
    .map(compactLocalJobRecord);
};

export const getLocalJobQueueStats = (store) => {
  const jobs = ensureStoreJobs(store);
  return jobs.reduce((acc, job) => {
    if (isParentOwnedChildJob(job)) return acc;
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
  assertGenericJobMutationAllowed(current);
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

export const requestLocalRetryJob = (store, jobId, options = {}) => {
  const index = findJobIndex(store, jobId);
  if (index < 0) return null;

  const current = normalizeJob(store.jobs[index]);
  assertGenericJobMutationAllowed(current);
  if (
    current.taskType === 'voiceover_translate_video'
    && current.provider === 'internal'
    && !['failed', 'cancelled'].includes(current.status)
  ) {
    throw Object.assign(new Error('只有失败或已取消的口播翻译父任务可以重试。'), {
      code: 'job_state_changed',
      statusCode: 409,
    });
  }
  const updatedAt = now();
  const retryResult = current.taskType === 'voiceover_translate_video' && current.provider === 'internal'
    ? prepareVoiceoverJobRetryResult(current, options.voiceoverRetryPlan, {
      env: options.env,
      resolveVoiceoverConfig: options.resolveVoiceoverConfig,
    })
    : null;
  const next = normalizeJob({
    ...current,
    ...(options.payload && typeof options.payload === 'object' ? { payload: options.payload } : {}),
    ...(options.maxRetries !== undefined ? { maxRetries: options.maxRetries } : {}),
    status: 'queued',
    errorCode: '',
    errorMessage: '',
    errorDetail: '',
    result: retryResult,
    startedAt: null,
    finishedAt: null,
    cancelRequestedAt: null,
    taskEngine: '',
    workflowId: '',
    runId: '',
    workflowExecutionMode: '',
    updatedAt,
    ...(options.resetProviderTaskId ? { providerTaskId: '', retryCount: 0 } : {}),
  });

  store.jobs[index] = next;
  return next;
};

export const withLocalJobRetryRollback = async (
  store,
  operation,
  { persist = () => {} } = {},
) => {
  if (!store || typeof store !== 'object' || typeof operation !== 'function') {
    throw new TypeError('Local retry rollback requires a store and operation.');
  }
  const snapshot = structuredClone(store);
  try {
    return await operation();
  } catch (error) {
    for (const key of Object.keys(store)) delete store[key];
    Object.assign(store, snapshot);
    await Promise.resolve().then(() => persist(store)).catch(() => {});
    throw error;
  }
};

export const takeNextLocalExecutableJobs = (store, availableSlots, options = {}) => {
  if (availableSlots <= 0) return [];
  const jobs = ensureStoreJobs(store);
  const candidates = jobs
    .filter((job) => !isParentOwnedChildJob(job))
    .filter((job) => job.status === 'queued' || job.status === 'retry_waiting')
    .sort((a, b) => Number(b.priority || 0) - Number(a.priority || 0) || Number(a.createdAt || 0) - Number(b.createdAt || 0));

  const runningUserIds = jobs
    .filter((job) => !isParentOwnedChildJob(job))
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
      errorDetail: '',
    });
    store.jobs[index] = updated;
    return updated;
  });
};

export const claimLocalJobForExecution = (store, jobId) => {
  const index = findJobIndex(store, jobId);
  if (index < 0) return null;
  const current = store.jobs[index];
  if (isParentOwnedChildJob(current)) return null;
  if (current.status !== 'queued' && current.status !== 'retry_waiting') {
    return normalizeJob(current);
  }

  const claimedAt = now();
  const next = normalizeJob({
    ...current,
    status: 'running',
    startedAt: claimedAt,
    updatedAt: claimedAt,
    errorCode: '',
    errorMessage: '',
    errorDetail: '',
  });
  store.jobs[index] = next;
  return next;
};

export const attachLocalJobWorkflowExecution = (store, jobId, result, options = {}) => {
  const index = findJobIndex(store, jobId);
  if (index < 0) return null;

  const updatedAt = now();
  const next = normalizeJob({
    ...store.jobs[index],
    taskEngine: String(options.engine || ''),
    workflowId: String(result?.workflowId || ''),
    runId: String(result?.runId || ''),
    workflowExecutionMode: String(options.executionMode || ''),
    updatedAt,
  });
  store.jobs[index] = next;
  return next;
};

export const updateLocalJobResult = (store, jobId, resultPatch = {}) => {
  const index = findJobIndex(store, jobId);
  if (index < 0) return null;
  const current = normalizeJob(store.jobs[index]);
  const currentResult = current.result && typeof current.result === 'object' ? current.result : {};
  const updatedAt = now();
  const next = normalizeJob({
    ...current,
    providerTaskId: String(resultPatch?.providerTaskId || current.providerTaskId || ''),
    result: {
      ...currentResult,
      ...(resultPatch && typeof resultPatch === 'object' ? cloneValue(resultPatch) : {}),
    },
    updatedAt,
  });
  store.jobs[index] = next;
  return next;
};

export const markLocalJobCompleted = (
  store,
  jobId,
  output,
  aborted = false,
  expectedClaim,
) => {
  const index = findJobIndex(store, jobId);
  if (index < 0) {
    if (expectedClaim) throw createJobStateChangedError();
    return null;
  }
  const finishedAt = now();
  const current = assertLocalRunningClaim(store.jobs[index], expectedClaim);
  const outputResult = output?.result && typeof output.result === 'object' ? cloneValue(output.result) : null;
  const result = current.taskType === 'voiceover_translate_video' && current.provider === 'internal'
    ? {
      ...(current.result && typeof current.result === 'object' ? cloneValue(current.result) : {}),
      ...(outputResult || {}),
      ...(current.result?.voiceoverCheckpoint
        ? { voiceoverCheckpoint: cloneValue(current.result.voiceoverCheckpoint) }
        : {}),
    }
    : outputResult;
  const next = normalizeJob({
    ...current,
    status: aborted ? 'cancelled' : 'succeeded',
    providerTaskId: output?.providerTaskId || current.providerTaskId || '',
    result,
    errorCode: aborted ? 'request_cancelled' : '',
    errorMessage: aborted ? '任务已取消' : '',
    errorDetail: '',
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
    retryCount: 0,
    updatedAt: now(),
  });
  store.jobs[index] = next;
  return next;
};

export const markLocalJobFailed = (store, jobId, error, expectedClaim) => {
  const index = findJobIndex(store, jobId);
  if (index < 0) {
    if (expectedClaim) throw createJobStateChangedError();
    return null;
  }
  const current = assertLocalRunningClaim(store.jobs[index], expectedClaim);
  const errorFields = buildJobFailureErrorFields(error);
  const providerTaskId = String(error?.providerTaskId || current.providerTaskId || '');
  const failure = getNextJobFailureState({
    retryCount: current.retryCount,
    maxRetries: current.maxRetries,
    errorCode: error?.code || 'provider_internal_error',
    providerStage: error?.providerStage || '',
    providerTaskId,
    providerTaskRecoverable: canRecoverProviderTaskById({
      taskType: current.taskType,
      provider: current.provider,
      providerTaskId,
      payload: current.payload,
    }),
  });
  const finishedAt = now();
  const persistedErrorCode = getPersistedJobFailureErrorCode({
    job: { ...current, providerTaskId },
    failure,
    errorCode: errorFields.errorCode,
    providerStatus: error?.providerStatus,
  });
  const rejectedResult = getProviderCompletedRejectedOutput(error)?.result;
  const result = current.taskType === 'voiceover_translate_video' && current.provider === 'internal'
    ? {
      ...(current.result && typeof current.result === 'object' ? cloneValue(current.result) : {}),
      ...(rejectedResult && typeof rejectedResult === 'object' ? cloneValue(rejectedResult) : {}),
      ...(current.result?.voiceoverCheckpoint
        ? { voiceoverCheckpoint: cloneValue(current.result.voiceoverCheckpoint) }
        : {}),
    }
    : rejectedResult || current.result || null;
  const next = normalizeJob({
    ...current,
    status: error?.code === 'request_cancelled' ? 'cancelled' : failure.status,
    providerTaskId,
    retryCount: error?.code === 'request_cancelled' ? current.retryCount : failure.retryCount,
    errorCode: persistedErrorCode,
    errorMessage: errorFields.errorMessage,
    errorDetail: errorFields.errorDetail,
    result,
    updatedAt: finishedAt,
    finishedAt: failure.status === 'failed' || error?.code === 'request_cancelled' ? finishedAt : null,
  });
  store.jobs[index] = next;
  return next;
};

export const createLocalJobWorker = ({
  readStore,
  writeStore,
  mutateStore,
  executeJob,
  getMaxConcurrency,
  createLog,
  findUserById,
  settleJobCredits,
  releaseJobCredits,
  isExecutionPaused = isDeployDrainActive,
  voiceoverEnv = process.env,
  resolveVoiceoverConfig,
}) => {
  let timer = null;
  let draining = false;
  const activeControllers = new Map();
  const mutate = async (operation) => {
    if (typeof mutateStore === 'function') return mutateStore(operation);
    const store = readStore();
    const result = await operation(store);
    writeStore(store);
    return result;
  };

  const runLoop = async () => {
    if (draining) return;
    draining = true;

    try {
      if (isExecutionPaused()) return;
      const maxConcurrency = await Promise.resolve(getMaxConcurrency());
      if (isExecutionPaused()) return;
      const availableSlots = Math.max(0, maxConcurrency - activeControllers.size);
      const claimed = await mutate((store) => takeNextLocalExecutableJobs(store, availableSlots));
      if (claimed.length === 0) return;

      for (const job of claimed) {
        if (activeControllers.has(job.id)) continue;

        const controller = new AbortController();
        activeControllers.set(job.id, controller);
        const expectedClaim = Object.freeze({
          id: job.id,
          userId: job.userId,
          startedAt: job.startedAt,
        });

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
              await mutate((providerStore) => updateLocalJobProviderTaskId(providerStore, refreshedJob.id, value));
            };
            const onResultCheckpoint = async (resultPatch, checkpointContext = {}) => {
              await mutate((checkpointStore) => persistLocalVoiceoverParentCheckpoint(checkpointStore, {
                jobId: refreshedJob.id,
                userId: refreshedJob.userId,
                startedAt: expectedClaim.startedAt,
                resultPatch,
                env: voiceoverEnv,
                resolveVoiceoverConfig: checkpointContext.voiceoverConfig
                  ? () => checkpointContext.voiceoverConfig
                  : resolveVoiceoverConfig,
              }));
            };

            const output = await executeJob(refreshedJob, controller.signal, {
              onProviderTaskId,
              onResultCheckpoint,
            });
            const finishedJob = await mutate((completeStore) => {
              const nextJob = markLocalJobCompleted(
                completeStore,
                refreshedJob.id,
                output,
                controller.signal.aborted,
                expectedClaim,
              );
              try {
                settleJobCredits?.({ store: completeStore, job: nextJob, output, aborted: controller.signal.aborted });
              } catch (creditError) {
                console.error('Account credit settlement failed after local job completion.', creditError);
              }
              return nextJob;
            });

            const user = finishedJob ? findUserById(finishedJob.userId) : null;
            if (user && createLog && finishedJob) {
              await createLog({
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
            const failureOutcome = await mutate((failureStore) => {
              let nextJob;
              try {
                nextJob = markLocalJobFailed(failureStore, job.id, error, expectedClaim);
              } catch (failureError) {
                if (failureError?.code !== 'job_state_changed') throw failureError;
                return {
                  stale: true,
                  job: getLocalJobById(failureStore, job.id),
                };
              }
              try {
                if (isProviderCompletedOutputRejectedError(error)) {
                  settleJobCredits?.({
                    store: failureStore,
                    job: nextJob,
                    output: getProviderCompletedRejectedOutput(error),
                    aborted: false,
                    rejected: true,
                  });
                } else {
                  releaseJobCredits?.({ store: failureStore, job: nextJob, error, retryWaiting: nextJob?.status === 'retry_waiting' });
                }
              } catch (creditError) {
                console.error('Account credit finalization failed after local job failure.', creditError);
              }
              return { stale: false, job: nextJob };
            });
            if (failureOutcome.stale) return;
            const failedJob = failureOutcome.job;

            const user = failedJob ? findUserById(failedJob.userId) : null;
            void maybeRecordCreditAlertLog({ error, job: failedJob, user, createLog });
            if (user && createLog && failedJob) {
              const logFields = buildJobFailureLogFields({
                jobStatus: failedJob.status,
                taskType: failedJob.taskType,
                errorCode: failedJob.errorCode,
              });
              await createLog({
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
