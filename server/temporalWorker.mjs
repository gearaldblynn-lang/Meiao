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
import { getJobById, updateJobFields } from './jobManager.mjs';
import { buildJobFailureLogFields, buildJobRuntimeLogMeta, getNextJobFailureState } from './jobRuntime.mjs';
import { createJobAttempt, finishJobAttempt, recordJobEvent } from './taskPlatform.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const now = () => Date.now();
const DEFAULT_JOB_CONCURRENCY = 5;
const isTerminalJobStatus = (status) => ['succeeded', 'failed', 'cancelled'].includes(String(status || ''));

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

const shouldDelayMysqlJobForUserConcurrency = async ({ pool, job, user, getMaxConcurrency }) => {
  const fallbackLimit = toSafeJobConcurrency(await Promise.resolve(getMaxConcurrency?.()), DEFAULT_JOB_CONCURRENCY);
  const userLimit = toSafeJobConcurrency(user?.jobConcurrency, fallbackLimit);
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS running_count
     FROM internal_jobs
     WHERE status = 'running' AND user_id = ? AND id <> ?`,
    [job.userId, job.id]
  );
  return Number(rows?.[0]?.running_count || 0) >= userLimit;
};

export const createLocalTemporalActivities = ({
  readStore,
  writeStore,
  executeJob,
  createLog,
  findUserById,
  heartbeat = defaultActivityHeartbeat,
}) => ({
  async executeLocalJobAttemptActivity({ jobId }) {
    const initialStore = readStore();
    const claimedJob = claimLocalJobForExecution(initialStore, jobId);
    if (!claimedJob) {
      return toMissingJobActivityResult(jobId);
    }
    writeStore(initialStore);

    if (isTerminalJobStatus(claimedJob.status)) {
      return toActivityResult(claimedJob);
    }

    const controller = new AbortController();
    if (claimedJob.cancelRequestedAt) {
      controller.abort();
    }
    safeHeartbeat(heartbeat, { jobId: claimedJob.id, stage: 'running' });

    let notifiedProviderTaskId = String(claimedJob.providerTaskId || '').trim();
    const onProviderTaskId = async (providerTaskId) => {
      const value = String(providerTaskId || '').trim();
      if (!value || value === notifiedProviderTaskId) return;
      notifiedProviderTaskId = value;
      const providerStore = readStore();
      updateLocalJobProviderTaskId(providerStore, claimedJob.id, value);
      writeStore(providerStore);
      safeHeartbeat(heartbeat, { jobId: claimedJob.id, stage: 'provider_submit', providerTaskId: value });
    };

    try {
      const output = await executeJob(claimedJob, controller.signal, { onProviderTaskId });
      const completeStore = readStore();
      const finishedJob = markLocalJobCompleted(completeStore, claimedJob.id, output, controller.signal.aborted);
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
          meta: buildJobRuntimeLogMeta({
            job: finishedJob,
            result: { providerTaskId: finishedJob.providerTaskId, result: finishedJob.result },
            finishedAt: finishedJob.finishedAt,
          }),
        });
      }
      return toActivityResult(finishedJob);
    } catch (error) {
      const failureStore = readStore();
      const failedJob = markLocalJobFailed(failureStore, claimedJob.id, error);
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
          meta: buildJobRuntimeLogMeta({
            job: failedJob,
            error,
            finishedAt: failedJob.finishedAt || Date.now(),
            retryCount: failedJob.retryCount,
          }),
        });
      }
      return toActivityResult(failedJob);
    }
  },
});

export const createMysqlTemporalActivities = ({
  getPool,
  executeJob,
  createLog,
  findUserById,
  getMaxConcurrency = () => DEFAULT_JOB_CONCURRENCY,
  cancelPollMs = 2500,
  heartbeat = defaultActivityHeartbeat,
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

    const user = await Promise.resolve(findUserById?.(currentJob.userId));
    if (await shouldDelayMysqlJobForUserConcurrency({ pool, job: currentJob, user, getMaxConcurrency })) {
      return toActivityResult(currentJob);
    }

    const claimedAt = now();
    const [claimResult] = await pool.query(
      `UPDATE internal_jobs
       SET status = 'running', started_at = ?, updated_at = ?, error_code = NULL, error_message = NULL
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
      const failure = getNextJobFailureState({
        retryCount: latestJob.retryCount ?? 0,
        maxRetries: latestJob.maxRetries ?? 0,
        errorCode: error?.code || 'provider_internal_error',
      });
      const finishedAt = now();

      await updateJobFields(pool, latestJob.id, {
        status: error?.code === 'request_cancelled' ? 'cancelled' : failure.status,
        provider_task_id: error?.providerTaskId || latestJob.providerTaskId || null,
        retry_count: error?.code === 'request_cancelled' ? latestJob.retryCount ?? 0 : failure.retryCount,
        error_code: error?.code || 'provider_internal_error',
        error_message: String(error?.message || '任务执行失败').slice(0, 5000),
        updated_at: finishedAt,
        finished_at: failure.status === 'failed' || error?.code === 'request_cancelled' ? finishedAt : null,
      });
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
