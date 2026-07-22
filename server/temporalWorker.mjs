import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { heartbeat as temporalActivityHeartbeat } from '@temporalio/activity';

import {
  claimLocalJobForExecution,
  getLocalJobById,
  markLocalJobCompleted,
  markLocalJobFailed,
  updateLocalJobProviderTaskId,
} from './localJobStore.mjs';
import { getJobById, isRunningJobConcurrencyBlocking, updateJobFields } from './jobManager.mjs';
import { buildJobFailureErrorFields, buildJobFailureLogFields, buildJobRuntimeLogMeta, getNextJobFailureState, getPersistedJobFailureErrorCode, getProviderCompletedRejectedOutput, isProviderCompletedOutputRejectedError } from './jobRuntime.mjs';
import { canRecoverProviderTaskById } from './jobSubmissionPolicy.mjs';
import { maybeRecordCreditAlertLog } from './creditAlert.mjs';
import { createJobAttempt, finishJobAttempt, recordJobEvent } from './taskPlatform.mjs';
import { isDeployDrainActive } from './deployDrain.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const now = () => Date.now();
const DEFAULT_JOB_CONCURRENCY = 5;
const DEFAULT_TEMPORAL_ACTIVITY_HEARTBEAT_INTERVAL_MS = 10_000;
const MIN_TEMPORAL_ACTIVITY_HEARTBEAT_INTERVAL_MS = 1_000;
const MAX_TEMPORAL_ACTIVITY_HEARTBEAT_INTERVAL_MS = 15_000;
const isTerminalJobStatus = (status) => ['succeeded', 'failed', 'cancelled'].includes(String(status || ''));

export const getTemporalActivityHeartbeatIntervalMs = (env = process.env) => {
  const parsed = Number.parseInt(String(env?.MEIAO_TEMPORAL_ACTIVITY_HEARTBEAT_MS || ''), 10);
  if (
    !Number.isFinite(parsed)
    || parsed < MIN_TEMPORAL_ACTIVITY_HEARTBEAT_INTERVAL_MS
    || parsed > MAX_TEMPORAL_ACTIVITY_HEARTBEAT_INTERVAL_MS
  ) {
    return DEFAULT_TEMPORAL_ACTIVITY_HEARTBEAT_INTERVAL_MS;
  }
  return parsed;
};

const toActivityResult = (job) => ({
  jobId: String(job?.id || ''),
  status: String(job?.status || ''),
  providerTaskId: String(job?.providerTaskId || ''),
  errorCode: String(job?.errorCode || ''),
  errorMessage: String(job?.errorMessage || ''),
  retryCount: Number(job?.retryCount || 0),
  finishedAt: job?.finishedAt ?? null,
});

const toMissingJobActivityResult = (jobId) => ({
  jobId: String(jobId || ''),
  status: 'cancelled',
  providerTaskId: '',
  errorCode: 'job_not_found',
  errorMessage: '任务已被删除或不存在，已停止 Temporal 重试',
  retryCount: 0,
  finishedAt: now(),
});

const serializeJsonValue = (value) => JSON.stringify(value ?? null);

const toSafeJobConcurrency = (value, fallback = DEFAULT_JOB_CONCURRENCY) => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const runTaskPlatformWrite = async (operation) => {
  try {
    return await operation();
  } catch (error) {
    console.error('Task platform diagnostic write failed.', error);
    return null;
  }
};

const defaultActivityHeartbeat = (details) => {
  try {
    temporalActivityHeartbeat(details);
  } catch {
    // Unit tests and non-Temporal probes can call activities outside an Activity context.
  }
};

const safeHeartbeat = (heartbeat, details) => {
  try {
    heartbeat?.(details);
  } catch {
    // Heartbeats are diagnostic and recovery hints; the job should continue if one fails locally.
  }
};

const createActivityHeartbeatPump = ({ heartbeat, details, intervalMs }) => {
  safeHeartbeat(heartbeat, details);
  const timer = setInterval(() => safeHeartbeat(heartbeat, details), intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
};

const isSameMysqlClaim = (job, claimedAt) => (
  String(job?.status || '') === 'running'
  && Number(job?.startedAt || 0) === Number(claimedAt || 0)
);

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

const createMysqlCancelWatcher = ({ pool, jobId, controller, intervalMs, heartbeat }) => {
  safeHeartbeat(heartbeat, { jobId, stage: 'running' });
  const timer = setInterval(async () => {
    try {
      safeHeartbeat(heartbeat, { jobId, stage: 'running' });
      const latestJob = await getJobById(pool, jobId);
      if (latestJob?.cancelRequestedAt) {
        controller.abort();
      }
    } catch {
      // Cancellation polling is best-effort; the activity will still finish through its normal path.
    }
  }, Math.max(500, Number(intervalMs || 2500)));
  timer.unref?.();
  return () => clearInterval(timer);
};

const shouldDelayMysqlJobForUserConcurrency = async ({
  pool,
  job,
  user,
  getMaxConcurrency,
  getProviderlessRunningStaleMs,
  getSubmittedRunningStaleMs,
  getCancelledRunningStaleMs,
}) => {
  if (
    String(job?.status || '') === 'running'
    && Boolean(String(job?.providerTaskId || '').trim())
  ) {
    return false;
  }
  const fallbackLimit = toSafeJobConcurrency(await Promise.resolve(getMaxConcurrency?.()), DEFAULT_JOB_CONCURRENCY);
  const userLimit = toSafeJobConcurrency(user?.jobConcurrency, fallbackLimit);
  const [rows] = await pool.query(
    `SELECT *
     FROM internal_jobs
     WHERE status = 'running' AND user_id = ? AND id <> ?`,
    [job.userId, job.id]
  );
  const referenceTime = now();
  const runningConcurrencyOptions = {
    referenceTime,
    providerlessStaleMs: await Promise.resolve(getProviderlessRunningStaleMs?.()),
    submittedStaleMs: await Promise.resolve(getSubmittedRunningStaleMs?.()),
    cancelledStaleMs: await Promise.resolve(getCancelledRunningStaleMs?.()),
  };
  const runningCount = rows.filter((row) => isRunningJobConcurrencyBlocking(row, {
    ...runningConcurrencyOptions,
  })).length;
  return runningCount >= userLimit;
};

export const createLocalTemporalActivities = ({
  readStore,
  writeStore,
  mutateStore,
  executeJob,
  createLog,
  findUserById,
  settleJobCredits,
  releaseJobCredits,
  heartbeat = defaultActivityHeartbeat,
  heartbeatIntervalMs = getTemporalActivityHeartbeatIntervalMs(),
  isExecutionPaused = isDeployDrainActive,
}) => {
  const mutate = async (operation) => {
    if (typeof mutateStore === 'function') return mutateStore(operation);
    const store = readStore();
    const result = await operation(store);
    writeStore(store);
    return result;
  };
  return ({
  async executeLocalJobAttemptActivity({ jobId }) {
    if (isExecutionPaused()) {
      const currentJob = getLocalJobById(readStore(), jobId);
      return currentJob ? toActivityResult(currentJob) : toMissingJobActivityResult(jobId);
    }
    const claimedJob = await mutate((initialStore) => claimLocalJobForExecution(initialStore, jobId));
    if (!claimedJob) {
      return toMissingJobActivityResult(jobId);
    }

    if (isTerminalJobStatus(claimedJob.status)) {
      return toActivityResult(claimedJob);
    }

    const controller = new AbortController();
    if (claimedJob.cancelRequestedAt) {
      controller.abort();
    }
    const stopHeartbeatPump = createActivityHeartbeatPump({
      heartbeat,
      details: { jobId: claimedJob.id, stage: 'running' },
      intervalMs: heartbeatIntervalMs,
    });

    let notifiedProviderTaskId = String(claimedJob.providerTaskId || '').trim();
    const onProviderTaskId = async (providerTaskId) => {
      const value = String(providerTaskId || '').trim();
      if (!value || value === notifiedProviderTaskId) return;
      notifiedProviderTaskId = value;
      await mutate((providerStore) => updateLocalJobProviderTaskId(providerStore, claimedJob.id, value));
      safeHeartbeat(heartbeat, { jobId: claimedJob.id, stage: 'provider_submit', providerTaskId: value });
    };

    try {
      const output = await executeJob(claimedJob, controller.signal, { onProviderTaskId });
      const finishedJob = await mutate((completeStore) => {
        const nextJob = markLocalJobCompleted(completeStore, claimedJob.id, output, controller.signal.aborted);
        try {
          settleJobCredits?.({ store: completeStore, job: nextJob, output, aborted: controller.signal.aborted });
        } catch (creditError) {
          console.error('Account credit settlement failed after local Temporal job completion.', creditError);
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
          meta: buildJobRuntimeLogMeta({
            job: finishedJob,
            result: { providerTaskId: finishedJob.providerTaskId, result: finishedJob.result },
            finishedAt: finishedJob.finishedAt,
          }),
        });
      }
      return toActivityResult(finishedJob);
    } catch (error) {
      const failedJob = await mutate((failureStore) => {
        const nextJob = markLocalJobFailed(failureStore, claimedJob.id, error);
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
          console.error('Account credit finalization failed after local Temporal job failure.', creditError);
        }
        return nextJob;
      });

      const user = failedJob ? findUserById(failedJob.userId) : null;
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
          meta: buildJobRuntimeLogMeta({
            job: failedJob,
            error,
            finishedAt: failedJob.finishedAt || Date.now(),
            retryCount: failedJob.retryCount,
          }),
        });
      }
      return toActivityResult(failedJob);
    } finally {
      stopHeartbeatPump();
    }
  },
  });
};

export const createMysqlTemporalActivities = ({
  getPool,
  executeJob,
  createLog,
  findUserById,
  settleJobCredits,
  releaseJobCredits,
  getMaxConcurrency = () => DEFAULT_JOB_CONCURRENCY,
  getProviderlessRunningStaleMs,
  getSubmittedRunningStaleMs,
  getCancelledRunningStaleMs,
  cancelPollMs = 2500,
  heartbeat = defaultActivityHeartbeat,
  isExecutionPaused = isDeployDrainActive,
}) => ({
  async executeMysqlJobAttemptActivity(input = {}) {
    const pool = await getPool();
    const jobId = String(input.jobId || '').trim();
    const currentJob = await getJobById(pool, jobId);
    if (!currentJob) {
      return toMissingJobActivityResult(jobId);
    }
    if (isTerminalJobStatus(currentJob.status)) {
      return toActivityResult(currentJob);
    }
    if (isExecutionPaused()) {
      return toActivityResult(currentJob);
    }
    if (String(currentJob.status || '') === 'running' && !String(currentJob.providerTaskId || '').trim()) {
      return toActivityResult(currentJob);
    }

    const user = await Promise.resolve(findUserById?.(currentJob.userId));
    if (await shouldDelayMysqlJobForUserConcurrency({
      pool,
      job: currentJob,
      user,
      getMaxConcurrency,
      getProviderlessRunningStaleMs,
      getSubmittedRunningStaleMs,
      getCancelledRunningStaleMs,
    })) {
      return toActivityResult(currentJob);
    }
    if (isExecutionPaused()) {
      return toActivityResult(currentJob);
    }

    const claimedAt = now();
    const [claimResult] = await pool.query(
      `UPDATE internal_jobs
       SET status = 'running', started_at = ?, updated_at = ?, error_code = NULL, error_message = NULL, error_detail = NULL
       WHERE id = ? AND status IN ('queued', 'retry_waiting', 'running')`,
      [claimedAt, claimedAt, currentJob.id]
    );

    if (!claimResult?.affectedRows) {
      const latestJob = await getJobById(pool, currentJob.id);
      return toActivityResult(latestJob || currentJob);
    }

    const refreshedJob = await getJobById(pool, currentJob.id);
    if (!refreshedJob) {
      return toMissingJobActivityResult(currentJob.id);
    }

    const controller = new AbortController();
    if (refreshedJob.cancelRequestedAt) {
      controller.abort();
    }
    const stopCancelWatcher = createMysqlCancelWatcher({
      pool,
      jobId: refreshedJob.id,
      controller,
      intervalMs: cancelPollMs,
      heartbeat,
    });

    let attempt = null;
    let notifiedProviderTaskId = String(refreshedJob.providerTaskId || '').trim();
    try {
      attempt = await runTaskPlatformWrite(() => createJobAttempt(pool, refreshedJob, {
        engine: 'temporal',
        workflowId: input.workflowId,
        runId: input.runId,
      }));

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
        safeHeartbeat(heartbeat, { jobId: refreshedJob.id, stage: 'provider_submit', providerTaskId: value });
        await runTaskPlatformWrite(() => recordJobEvent(pool, refreshedJob, {
          attemptId: attempt?.id,
          attemptNo: attempt?.attemptNo,
          traceId: attempt?.traceId,
          stage: 'provider_submit',
          eventName: 'provider_task_id_received',
          status: 'started',
          engine: 'temporal',
          providerSubmitted: true,
          providerTaskId: value,
          workflowId: input.workflowId,
          runId: input.runId,
          meta: { providerTaskId: value },
        }));
        safeHeartbeat(heartbeat, { jobId: refreshedJob.id, stage: 'provider_wait', providerTaskId: value });
        await runTaskPlatformWrite(() => recordJobEvent(pool, refreshedJob, {
          attemptId: attempt?.id,
          attemptNo: attempt?.attemptNo,
          traceId: attempt?.traceId,
          stage: 'provider_wait',
          eventName: 'provider_wait_started',
          status: 'started',
          engine: 'temporal',
          providerSubmitted: true,
          providerTaskId: value,
          workflowId: input.workflowId,
          runId: input.runId,
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
        engine: 'temporal',
        providerSubmitted: false,
        providerTaskId: refreshedJob.providerTaskId || '',
        workflowId: input.workflowId,
        runId: input.runId,
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
      const latestBeforeComplete = await getJobById(pool, refreshedJob.id);
      if (!isSameMysqlClaim(latestBeforeComplete, claimedAt)) {
        return toActivityResult(latestBeforeComplete || refreshedJob);
      }
      const finalProviderTaskId = output?.providerTaskId || notifiedProviderTaskId || refreshedJob.providerTaskId || '';
      await updateJobFields(pool, refreshedJob.id, {
        status: controller.signal.aborted ? 'cancelled' : 'succeeded',
        provider_task_id: finalProviderTaskId || null,
        result_json: serializeJsonValue(output?.result || null),
        error_code: controller.signal.aborted ? 'request_cancelled' : null,
        error_message: controller.signal.aborted ? '任务已取消' : null,
        error_detail: null,
        finished_at: finishedAt,
        updated_at: finishedAt,
      });
      try {
        await settleJobCredits?.({ job: refreshedJob, output, finishedAt, aborted: controller.signal.aborted });
      } catch (creditError) {
        console.error('Account credit settlement failed after MySQL Temporal job completion.', creditError);
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
        engine: 'temporal',
        providerSubmitted: Boolean(finalProviderTaskId),
        providerTaskId: finalProviderTaskId,
        workflowId: input.workflowId,
        runId: input.runId,
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
      const latestJob = await getJobById(pool, refreshedJob.id);
      if (!latestJob) {
        return toMissingJobActivityResult(refreshedJob.id);
      }
      if (!isSameMysqlClaim(latestJob, claimedAt)) {
        return toActivityResult(latestJob);
      }
      const errorFields = buildJobFailureErrorFields(error);
      const providerTaskId = String(error?.providerTaskId || latestJob.providerTaskId || '');
      const failure = getNextJobFailureState({
        retryCount: latestJob.retryCount ?? 0,
        maxRetries: latestJob.maxRetries ?? 0,
        errorCode: error?.code || 'provider_internal_error',
        providerStage: error?.providerStage || '',
        providerTaskId,
        providerTaskRecoverable: canRecoverProviderTaskById({
          taskType: latestJob.taskType,
          provider: latestJob.provider,
          providerTaskId,
          payload: latestJob.payload,
        }),
      });
      const finishedAt = now();
      const persistedErrorCode = getPersistedJobFailureErrorCode({
        job: { ...latestJob, providerTaskId },
        failure,
        errorCode: errorFields.errorCode,
        providerStatus: error?.providerStatus,
      });

      await updateJobFields(pool, latestJob.id, {
        status: error?.code === 'request_cancelled' ? 'cancelled' : failure.status,
        provider_task_id: providerTaskId || null,
        retry_count: error?.code === 'request_cancelled' ? latestJob.retryCount ?? 0 : failure.retryCount,
        error_code: persistedErrorCode,
        error_message: errorFields.errorMessage,
        error_detail: errorFields.errorDetail || null,
        result_json: isProviderCompletedOutputRejectedError(error)
          ? serializeJsonValue(getProviderCompletedRejectedOutput(error)?.result || null)
          : latestJob.result ? serializeJsonValue(latestJob.result) : null,
        updated_at: finishedAt,
        finished_at: failure.status === 'failed' || error?.code === 'request_cancelled' ? finishedAt : null,
      });
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
        console.error('Account credit finalization failed after MySQL Temporal job failure.', creditError);
      }
      await runTaskPlatformWrite(() => attempt?.id ? finishJobAttempt(pool, attempt.id, {
        status: error?.code === 'request_cancelled' ? 'cancelled' : failure.status,
        providerTaskId: error?.providerTaskId || latestJob.providerTaskId || '',
        errorCode: error?.code || 'provider_internal_error',
        errorMessage: String(error?.message || '任务执行失败').slice(0, 5000),
        finishedAt: failure.status === 'failed' || error?.code === 'request_cancelled' ? finishedAt : null,
      }) : null);
      await runTaskPlatformWrite(() => recordJobEvent(pool, latestJob, {
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
        engine: 'temporal',
        providerSubmitted: Boolean(error?.providerTaskId || latestJob.providerTaskId),
        retryable: failure.status === 'retry_waiting',
        errorCode: error?.code || 'provider_internal_error',
        errorMessage: String(error?.message || '任务执行失败').slice(0, 5000),
        providerTaskId: error?.providerTaskId || latestJob.providerTaskId || '',
        workflowId: input.workflowId,
        runId: input.runId,
        meta: {
          ...buildJobRuntimeLogMeta({ job: latestJob, error, finishedAt, retryCount: failure.retryCount }),
          providerStage: String(error?.providerStage || '').trim(),
          providerStatus: String(error?.providerStatus || '').trim(),
        },
        createdAt: finishedAt,
      }));

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
      stopCancelWatcher();
    }

    const finalJob = await getJobById(pool, refreshedJob.id);
    return toActivityResult(finalJob || refreshedJob);
  },
});

export const startMeiaoTemporalWorker = async ({
  config,
  activities,
  workflowsPath = path.join(__dirname, 'temporal', 'workflows.mjs'),
  workerOptions = {},
}) => {
  const temporalWorker = await import('@temporalio/worker');
  const connection = await temporalWorker.NativeConnection.connect({ address: config.address });
  const worker = await temporalWorker.Worker.create({
    connection,
    namespace: config.namespace,
    taskQueue: config.taskQueue,
    workflowsPath,
    activities,
    ...workerOptions,
  });
  const runPromise = worker.run();
  runPromise.catch((error) => {
    console.error('Temporal worker stopped unexpectedly.', error);
  });
  return {
    worker,
    runPromise,
    async shutdown() {
      worker.shutdown();
      await runPromise.catch(() => null);
      await connection.close().catch(() => null);
    },
  };
};
