const normalizeIdentity = (value) => String(value || '').trim();

const normalizePositiveTimestamp = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
};

const sortedIdentities = (values) => Array.from(values).filter(Boolean).sort();

export const cloneProductRestoreCancellationMarker = (marker) => {
  const cancelledAt = normalizePositiveTimestamp(marker?.cancelledAt);
  if (
    marker?.version !== 1
    || marker?.status !== 'cancelled'
    || marker?.reason !== 'user_requested'
    || cancelledAt === undefined
  ) return undefined;
  return {
    version: 1,
    status: 'cancelled',
    reason: 'user_requested',
    cancelledAt,
    jobIds: sortedIdentities(new Set((marker.jobIds || []).map(normalizeIdentity))),
  };
};

export const cloneProductRestoreCancellationReset = (reset) => {
  const resetAt = normalizePositiveTimestamp(reset?.resetAt);
  if (
    reset?.version !== 1
    || reset?.status !== 'retry_reset'
    || reset?.reason !== 'explicit_retry'
    || resetAt === undefined
  ) return undefined;
  const priorCancelledAt = normalizePositiveTimestamp(reset?.priorCancelledAt);
  return {
    version: 1,
    status: 'retry_reset',
    reason: 'explicit_retry',
    resetAt,
    ...(priorCancelledAt !== undefined ? { priorCancelledAt } : {}),
  };
};

const mergeCancellationMarkers = (existing, incoming) => {
  const current = cloneProductRestoreCancellationMarker(existing);
  const next = cloneProductRestoreCancellationMarker(incoming);
  if (!current) return next;
  if (!next) return current;
  if (current.cancelledAt > next.cancelledAt) return current;
  if (next.cancelledAt > current.cancelledAt) return next;
  return {
    ...current,
    jobIds: sortedIdentities(new Set([...current.jobIds, ...next.jobIds])),
  };
};

const mergeCancellationResets = (existing, incoming) => {
  const current = cloneProductRestoreCancellationReset(existing);
  const next = cloneProductRestoreCancellationReset(incoming);
  if (!current) return next;
  if (!next) return current;
  if (current.resetAt > next.resetAt) return current;
  if (next.resetAt > current.resetAt) return next;
  const priorCancelledAt = Math.max(
    Number(current.priorCancelledAt || 0),
    Number(next.priorCancelledAt || 0),
  );
  return {
    ...current,
    ...(priorCancelledAt > 0 ? { priorCancelledAt } : {}),
  };
};

export const createProductRestoreCancellationReset = (generationContext, now = Date.now()) => {
  const marker = cloneProductRestoreCancellationMarker(
    generationContext?.productRestoreCancellation,
  );
  const previousReset = cloneProductRestoreCancellationReset(
    generationContext?.productRestoreCancellationReset,
  );
  const resetAt = Math.max(
    normalizePositiveTimestamp(now) || Date.now(),
    Number(marker?.cancelledAt || 0) + 1,
    Number(previousReset?.resetAt || 0) + 1,
  );
  return {
    version: 1,
    status: 'retry_reset',
    reason: 'explicit_retry',
    resetAt,
    ...((marker?.cancelledAt || previousReset?.priorCancelledAt)
      ? { priorCancelledAt: marker?.cancelledAt || previousReset.priorCancelledAt }
      : {}),
  };
};

export const hasEffectiveProductRestoreCancellation = (generationContext) => {
  const marker = cloneProductRestoreCancellationMarker(
    generationContext?.productRestoreCancellation,
  );
  if (!marker) return false;
  const reset = cloneProductRestoreCancellationReset(
    generationContext?.productRestoreCancellationReset,
  );
  return !reset || marker.cancelledAt >= reset.resetAt;
};

const STRICT_NON_NEGATIVE_DECIMAL = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;

const normalizeKnownCredits = (value) => {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= 0 ? value : undefined;
  }
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  if (!STRICT_NON_NEGATIVE_DECIMAL.test(normalized)) return undefined;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const VALID_ATTEMPT_STATUSES = new Set([
  'running',
  'succeeded',
  'invalid',
  'failed',
  'cancelled',
]);

const ATTEMPT_STATUS_PRIORITY = {
  running: 0,
  failed: 1,
  cancelled: 2,
  invalid: 3,
  succeeded: 4,
};

const cloneAnalysisAttempt = (attempt) => {
  const jobId = normalizeIdentity(attempt?.jobId);
  if (!jobId) return undefined;
  const requestedStatus = normalizeIdentity(attempt?.status);
  const status = VALID_ATTEMPT_STATUSES.has(requestedStatus) ? requestedStatus : 'running';
  const timestamp = normalizePositiveTimestamp(attempt?.timestamp) || Date.now();
  const providerTaskId = normalizeIdentity(attempt?.providerTaskId);
  const model = normalizeIdentity(attempt?.model);
  const errorCode = normalizeIdentity(attempt?.errorCode);
  const creditsConsumed = normalizeKnownCredits(attempt?.creditsConsumed);
  return {
    jobId,
    ...(providerTaskId ? { providerTaskId } : {}),
    ...(model ? { model } : {}),
    status,
    ...(errorCode ? { errorCode } : {}),
    timestamp,
    ...(creditsConsumed !== undefined ? { creditsConsumed } : {}),
  };
};

export const mergeProductRestoreAnalysisAttemptsForStorage = (current, incoming) => {
  const merged = (Array.isArray(current) ? current : [])
    .map(cloneAnalysisAttempt)
    .filter(Boolean);
  const byJobId = new Map(merged.map((attempt, index) => [attempt.jobId, index]));
  for (const next of (Array.isArray(incoming) ? incoming : []).map(cloneAnalysisAttempt).filter(Boolean)) {
    const index = byJobId.get(next.jobId);
    if (index === undefined) {
      byJobId.set(next.jobId, merged.length);
      merged.push(next);
      continue;
    }
    const previous = merged[index];
    const status = ATTEMPT_STATUS_PRIORITY[next.status] >= ATTEMPT_STATUS_PRIORITY[previous.status]
      ? next.status
      : previous.status;
    merged[index] = {
      ...previous,
      ...(next.providerTaskId ? { providerTaskId: next.providerTaskId } : {}),
      ...(next.model ? { model: next.model } : {}),
      status,
      ...(next.errorCode ? { errorCode: next.errorCode } : {}),
      timestamp: previous.timestamp,
      ...(next.creditsConsumed !== undefined ? { creditsConsumed: next.creditsConsumed } : {}),
    };
  }
  return merged;
};

export const mergeProductRestoreGenerationContextForStorage = (existingContext, incomingContext) => {
  if (!existingContext && !incomingContext) return undefined;
  const merged = {
    ...(existingContext || {}),
    ...(incomingContext || {}),
  };
  const attempts = mergeProductRestoreAnalysisAttemptsForStorage(
    existingContext?.productRestoreAnalysisAttempts,
    incomingContext?.productRestoreAnalysisAttempts,
  );
  if (attempts.length > 0) merged.productRestoreAnalysisAttempts = attempts;
  else delete merged.productRestoreAnalysisAttempts;

  const marker = mergeCancellationMarkers(
    existingContext?.productRestoreCancellation,
    incomingContext?.productRestoreCancellation,
  );
  if (marker) merged.productRestoreCancellation = marker;
  else delete merged.productRestoreCancellation;

  const reset = mergeCancellationResets(
    existingContext?.productRestoreCancellationReset,
    incomingContext?.productRestoreCancellationReset,
  );
  if (reset) merged.productRestoreCancellationReset = reset;
  else delete merged.productRestoreCancellationReset;
  return merged;
};
