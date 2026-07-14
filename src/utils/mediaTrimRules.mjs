export const MEDIA_TRIM_LIMITS = Object.freeze({
  minSeconds: 2,
  maxSeconds: 15,
  maxTotalSeconds: 15,
  maxFiles: 3,
});

const mediaRuleError = (code, message, details = {}) => Object.assign(new Error(message), { code, details });

const toDuration = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

const roundTenths = (value) => Math.round(value * 10) / 10;

/** @param {Array<{durationSeconds?: number}>} existing */
export function getMediaBudget(existing = []) {
  const list = Array.isArray(existing) ? existing : [];
  const usedSeconds = roundTenths(list.reduce((sum, item) => sum + toDuration(item?.durationSeconds), 0));
  return {
    usedSeconds,
    remainingSeconds: roundTenths(Math.max(0, MEDIA_TRIM_LIMITS.maxTotalSeconds - usedSeconds)),
    remainingFiles: Math.max(0, MEDIA_TRIM_LIMITS.maxFiles - list.length),
  };
}

/** @param {{existing?: Array<{durationSeconds?: number}>, incomingCount?: number}} input */
export function validateMediaQueueSelection({ existing = [], incomingCount = 1 } = {}) {
  const budget = getMediaBudget(existing);
  const count = Number.parseInt(String(incomingCount || 0), 10);
  if (!Number.isFinite(count) || count <= 0) {
    throw mediaRuleError('media_queue_empty', '请选择需要处理的音视频文件');
  }
  if (count > budget.remainingFiles) {
    throw mediaRuleError(
      'media_queue_too_many',
      `参考素材最多上传 3 个，当前还可添加 ${budget.remainingFiles} 个`,
      { ...budget, incomingCount: count },
    );
  }
  if (budget.remainingSeconds < MEDIA_TRIM_LIMITS.minSeconds) {
    throw mediaRuleError(
      'media_queue_duration_exhausted',
      '参考素材总时长不能超过 15 秒，请先删除或缩短已有素材',
      budget,
    );
  }
  const pendingExisting = existing.filter((item) => toDuration(item?.durationSeconds) === 0).length;
  if (budget.remainingSeconds < (pendingExisting + count) * MEDIA_TRIM_LIMITS.minSeconds) {
    throw mediaRuleError(
      'media_queue_duration_exhausted',
      '剩余总时长不足以让每个待处理素材保留至少 2 秒，请减少文件数量',
      { ...budget, pendingFiles: pendingExisting + count },
    );
  }
  return budget;
}

/**
 * @param {{durationSeconds?: number, startSeconds?: number, endSeconds?: number, remainingSeconds?: number}} input
 */
export function normalizeTrimSelection({
  durationSeconds,
  startSeconds = 0,
  endSeconds,
  remainingSeconds = MEDIA_TRIM_LIMITS.maxTotalSeconds,
} = {}) {
  const sourceDuration = toDuration(durationSeconds);
  const available = Math.min(
    sourceDuration,
    MEDIA_TRIM_LIMITS.maxSeconds,
    Math.max(0, Number(remainingSeconds) || 0),
  );
  if (available < MEDIA_TRIM_LIMITS.minSeconds) {
    const sourceTooShort = sourceDuration > 0 && sourceDuration < MEDIA_TRIM_LIMITS.minSeconds;
    throw mediaRuleError(
      sourceTooShort ? 'media_source_too_short' : 'media_queue_duration_exhausted',
      sourceTooShort
        ? '原始素材不足 2 秒，无法满足模型要求'
        : '当前任务剩余总时长不足 2 秒，请先调整已有素材',
      { durationSeconds: sourceDuration, remainingSeconds },
    );
  }

  let start = Math.max(0, Math.min(Number(startSeconds) || 0, sourceDuration - MEDIA_TRIM_LIMITS.minSeconds));
  const requestedEnd = Number.isFinite(Number(endSeconds)) ? Number(endSeconds) : start + available;
  let end = Math.min(sourceDuration, requestedEnd, start + available);
  if (end - start < MEDIA_TRIM_LIMITS.minSeconds) {
    end = Math.min(sourceDuration, start + MEDIA_TRIM_LIMITS.minSeconds);
  }
  if (end - start < MEDIA_TRIM_LIMITS.minSeconds) {
    start = Math.max(0, end - MEDIA_TRIM_LIMITS.minSeconds);
  }

  start = roundTenths(start);
  end = roundTenths(Math.min(sourceDuration, end));
  return {
    startSeconds: start,
    endSeconds: end,
    durationSeconds: roundTenths(end - start),
  };
}
