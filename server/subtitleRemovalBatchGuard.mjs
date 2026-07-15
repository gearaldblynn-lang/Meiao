const ACTIVE_JOB_STATUSES = new Set(['queued', 'running', 'retry_waiting']);

const createGuardError = (code, message, statusCode) => Object.assign(new Error(message), {
  code,
  statusCode,
});

const normalizeBatchMaxItems = (value) => {
  const parsed = Number.parseInt(String(value || ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 10;
};

const normalizeIdentity = (payload = {}) => ({
  batchCount: Number(payload?.batchCount),
  batchId: String(payload?.batchId || '').trim(),
  batchIndex: Number(payload?.batchIndex),
  clientSubmissionKey: String(payload?.clientSubmissionKey || '').trim(),
  shellProjectId: String(payload?.shellProjectId || '').trim(),
  shellResultId: String(payload?.shellResultId || '').trim(),
});

export const buildSubtitleRemovalUserGuardSubmission = (userId) => {
  const normalizedUserId = String(userId || '').trim();
  return {
    userId: normalizedUserId,
    module: 'video',
    taskType: 'subtitle_remove_batch_guard',
    provider: 'internal',
    payload: { clientSubmissionKey: `subtitle_remove_active:${normalizedUserId}` },
  };
};

export const assertSubtitleRemovalBatchSubmissionAllowed = ({
  jobs = [],
  userId = '',
  payload = {},
  batchMaxItems = 10,
  activeCount,
  exactReplay,
  sameBatchJobs,
} = {}) => {
  const normalizedUserId = String(userId || '').trim();
  const incoming = normalizeIdentity(payload);
  const maxItems = normalizeBatchMaxItems(batchMaxItems);
  if (
    !incoming.batchId
    || !incoming.shellProjectId
    || !incoming.shellResultId
    || !incoming.clientSubmissionKey
    || incoming.batchId !== incoming.shellProjectId
  ) {
    throw createGuardError(
      'job_subtitle_batch_identity_invalid',
      '去字幕批次标识不完整，请刷新后重新提交。',
      400,
    );
  }
  const subtitleJobs = (Array.isArray(jobs) ? jobs : []).filter((candidate) => (
    String(candidate?.userId || '').trim() === normalizedUserId
    && String(candidate?.taskType || '').trim() === 'subtitle_remove_video'
  ));
  const derivedExactReplay = subtitleJobs.find((candidate) => (
    incoming.clientSubmissionKey
    && String(candidate?.payload?.clientSubmissionKey || '').trim() === incoming.clientSubmissionKey
  ));
  const resolvedExactReplay = exactReplay || derivedExactReplay;
  if (resolvedExactReplay) return { exactReplay: resolvedExactReplay };

  const resolvedSameBatchJobs = Array.isArray(sameBatchJobs) ? sameBatchJobs : subtitleJobs.filter((candidate) => (
    String(candidate?.payload?.batchId || '').trim() === incoming.batchId
  ));
  const conflictingIndex = resolvedSameBatchJobs.find((candidate) => (
    Number(candidate?.payload?.batchIndex) === incoming.batchIndex
  ));
  if (conflictingIndex) {
    throw createGuardError(
      'job_subtitle_batch_index_conflict',
      '同一去字幕批次的视频序号已被其他请求占用，请刷新任务状态。',
      409,
    );
  }
  const inconsistentCount = resolvedSameBatchJobs.some((candidate) => (
    Number(candidate?.payload?.batchCount) !== incoming.batchCount
  ));
  if (inconsistentCount) {
    throw createGuardError(
      'job_subtitle_batch_count_conflict',
      '同一去字幕批次的视频总数不一致，请刷新后重试。',
      409,
    );
  }

  const derivedActiveCount = subtitleJobs.filter((candidate) => (
    ACTIVE_JOB_STATUSES.has(String(candidate?.status || '').trim())
  )).length;
  const resolvedActiveCount = Number.isFinite(Number(activeCount))
    ? Math.max(0, Number(activeCount))
    : derivedActiveCount;
  if (resolvedActiveCount >= maxItems) {
    throw createGuardError(
      'job_subtitle_active_limit_reached',
      `当前已有 ${resolvedActiveCount} 个去字幕视频正在处理，请等待部分完成后再提交（上限 ${maxItems} 个）。`,
      409,
    );
  }
  return { exactReplay: null };
};

export const assertSubmissionKnownBeforeRetry = (job = {}) => {
  if (String(job?.errorCode || '').trim() !== 'provider_submission_unknown') return;
  throw createGuardError(
    'job_submission_unknown_retry_blocked',
    '上游提交状态未知，为防止重复扣费，请先由管理员核实并绑定或释放原任务。',
    409,
  );
};

export const assertSubtitleRemovalRetryAllowed = ({
  jobs = [],
  userId = '',
  activeCount,
  batchMaxItems = 10,
} = {}) => {
  const maxItems = normalizeBatchMaxItems(batchMaxItems);
  const resolvedActiveCount = Number.isFinite(Number(activeCount))
    ? Math.max(0, Number(activeCount))
    : (Array.isArray(jobs) ? jobs : []).filter((candidate) => (
      String(candidate?.userId || '').trim() === String(userId || '').trim()
      && String(candidate?.taskType || '').trim() === 'subtitle_remove_video'
      && ACTIVE_JOB_STATUSES.has(String(candidate?.status || '').trim())
    )).length;
  if (resolvedActiveCount < maxItems) return;
  throw createGuardError(
    'job_subtitle_active_limit_reached',
    `当前已有 ${resolvedActiveCount} 个去字幕视频正在处理，请等待部分完成后再重试（上限 ${maxItems} 个）。`,
    409,
  );
};
