import { getUserVisibleTaskId } from './kieTaskUtils.mjs';

export const resolveTerminalKieJobResult = (job, fallbackBackendJobId = '') => {
  if (!job || typeof job !== 'object') return null;

  const taskId = getUserVisibleTaskId(job) || undefined;
  const backendJobId = String(job.id || fallbackBackendJobId || '').trim() || undefined;
  if (job.status === 'succeeded') {
    return {
      imageUrl: String(job.result?.imageUrl || ''),
      videoUrl: job.result?.videoUrl ? String(job.result.videoUrl) : undefined,
      taskId,
      backendJobId,
      status: 'success',
      message: '',
      creditsConsumed: Number.isFinite(Number(job.result?.creditsConsumed))
        ? Number(job.result.creditsConsumed)
        : undefined,
    };
  }

  if (job.status === 'cancelled') {
    return {
      imageUrl: '',
      taskId,
      backendJobId,
      status: 'interrupted',
      message: job.errorMessage || '任务已取消',
      errorCode: String(job.errorCode || '').trim(),
    };
  }

  if (job.errorCode === 'task_not_found') {
    return {
      imageUrl: '',
      taskId,
      backendJobId,
      status: 'task_not_found',
      message: job.errorMessage || '任务不存在或已过期',
      errorCode: String(job.errorCode || '').trim(),
    };
  }

  if (job.status === 'failed') {
    return {
      imageUrl: '',
      taskId,
      backendJobId,
      status: 'error',
      message: job.errorMessage || '任务执行失败',
      errorCode: String(job.errorCode || '').trim(),
    };
  }

  return null;
};
