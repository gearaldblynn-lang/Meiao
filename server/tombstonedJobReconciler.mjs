import { resolveJobDeletionAction } from './jobManager.mjs';

const INTERNAL_JOB_ID_PATTERN = /^[a-f0-9]{24}$/i;

const parseState = (row) => {
  if (row?.state && typeof row.state === 'object') return row.state;
  const raw = row?.stateJson ?? row?.state_json;
  if (!raw) return {};
  try {
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return {};
  }
};

const normalizeInternalJobId = (value) => {
  const raw = String(value || '').trim();
  const candidate = raw.startsWith('job-') ? raw.slice(4) : raw;
  return INTERNAL_JOB_ID_PATTERN.test(candidate) ? candidate.toLowerCase() : '';
};

export const collectTombstonedInternalJobIds = (state = {}) => Array.from(new Set(
  (Array.isArray(state?.shellDraft?.deletedJobIds) ? state.shellDraft.deletedJobIds : [])
    .map(normalizeInternalJobId)
    .filter(Boolean),
));

export const createTombstonedStateScanTracker = () => {
  let updatedAfter = 0;
  let preparedUpdatedAfter = 0;
  let boundaryFingerprints = new Map();
  let preparedBoundaryFingerprints = new Map();
  let pendingRows = new Map();
  const fingerprintRow = (row) => String(
    row?.stateJson
      ?? row?.state_json
      ?? JSON.stringify(row?.state && typeof row.state === 'object' ? row.state : {}),
  );
  return {
    getUpdatedAfter: () => updatedAfter,
    prepareRows: (changedRows = []) => {
      preparedUpdatedAfter = updatedAfter;
      preparedBoundaryFingerprints = new Map(boundaryFingerprints);
      const rowsByUser = new Map(pendingRows);
      for (const row of changedRows || []) {
        const userId = String(row?.userId ?? row?.user_id ?? '').trim();
        if (!userId) continue;
        const rowUpdatedAt = Number(row?.updatedAt ?? row?.updated_at ?? 0);
        const fingerprint = fingerprintRow(row);
        if (rowUpdatedAt < updatedAfter) continue;
        if (rowUpdatedAt === updatedAfter && boundaryFingerprints.get(userId) === fingerprint) continue;
        rowsByUser.set(userId, row);
        if (rowUpdatedAt > preparedUpdatedAfter) {
          preparedUpdatedAfter = rowUpdatedAt;
          preparedBoundaryFingerprints = new Map([[userId, fingerprint]]);
        } else if (rowUpdatedAt === preparedUpdatedAfter) {
          preparedBoundaryFingerprints.set(userId, fingerprint);
        }
      }
      return Array.from(rowsByUser.values());
    },
    commitPending: (pendingJobIdsByUser = new Map()) => {
      updatedAfter = preparedUpdatedAfter;
      boundaryFingerprints = new Map(preparedBoundaryFingerprints);
      pendingRows = new Map(
        Array.from(pendingJobIdsByUser.entries())
          .map(([userId, jobIds]) => [String(userId || '').trim(), {
            user_id: String(userId || '').trim(),
            state: { shellDraft: { deletedJobIds: Array.from(new Set(jobIds || [])) } },
          }])
          .filter(([userId, row]) => userId && row.state.shellDraft.deletedJobIds.length > 0),
      );
    },
  };
};

export const reconcileTombstonedJobs = async ({
  stateRows = [],
  loadJobs,
  cancelJob,
  recoverSubmittedCancelledJob,
  deleteJob,
  onError = () => {},
  onPending = () => {},
} = {}) => {
  const stats = {
    desired: 0,
    found: 0,
    deleted: 0,
    cancelRequested: 0,
    recoveryRequested: 0,
    pending: 0,
    pendingReasons: {
      active: 0,
      submissionUnknown: 0,
      submittedRecovery: 0,
      recoveryManual: 0,
      pendingReservation: 0,
      other: 0,
    },
    oldestPendingUpdatedAt: null,
    oldestPendingUpdatedAtByReason: {
      active: null,
      submissionUnknown: null,
      submittedRecovery: null,
      recoveryManual: null,
      pendingReservation: null,
      other: null,
    },
    errors: 0,
  };
  const markPending = (action, job, count = 1) => {
    stats.pending += count;
    const reason = action === 'block_active'
      ? 'active'
      : action === 'block_submission_unknown'
        ? 'submissionUnknown'
        : action === 'block_submitted_cancelled' || action === 'block_submitted_recovery'
          ? 'submittedRecovery'
          : action === 'block_recovery_manual'
            ? 'recoveryManual'
          : action === 'block_pending_reservation'
            ? 'pendingReservation'
            : 'other';
    stats.pendingReasons[reason] += count;
    const updatedAt = Number(job?.updatedAt ?? job?.updated_at ?? 0);
    if (updatedAt > 0) {
      stats.oldestPendingUpdatedAt = stats.oldestPendingUpdatedAt === null
        ? updatedAt
        : Math.min(stats.oldestPendingUpdatedAt, updatedAt);
      const oldestForReason = stats.oldestPendingUpdatedAtByReason[reason];
      stats.oldestPendingUpdatedAtByReason[reason] = oldestForReason === null
        ? updatedAt
        : Math.min(oldestForReason, updatedAt);
    }
    const userId = String(job?.userId ?? job?.user_id ?? '').trim();
    const jobId = String(job?.id || '').trim();
    if (userId && jobId) onPending({ userId, jobId, action });
  };

  for (const row of stateRows || []) {
    const userId = String(row?.userId ?? row?.user_id ?? '').trim();
    const jobIds = collectTombstonedInternalJobIds(parseState(row));
    if (!userId || jobIds.length === 0) continue;
    stats.desired += jobIds.length;

    let jobs;
    try {
      jobs = await loadJobs(userId, jobIds);
    } catch (error) {
      stats.errors += jobIds.length;
      markPending('load_failed', null, jobIds.length);
      jobIds.forEach((jobId) => onPending({ userId, jobId, action: 'load_failed' }));
      onError(error, { userId, jobIds });
      continue;
    }
    stats.found += jobs.length;

    for (const job of jobs) {
      try {
        let currentJob = job;
        const resolveCurrentDeletionAction = () => resolveJobDeletionAction(currentJob, {
          pendingReservation: currentJob?.pendingReservation === true,
        });
        let action = resolveCurrentDeletionAction();
        if (
          action === 'block_submitted_cancelled'
          && typeof recoverSubmittedCancelledJob === 'function'
        ) {
          currentJob = await recoverSubmittedCancelledJob(currentJob);
          stats.recoveryRequested += 1;
          action = resolveCurrentDeletionAction();
          markPending(
            action === 'block_recovery_manual' ? action : 'block_submitted_recovery',
            currentJob,
          );
          continue;
        }
        if (
          (action === 'cancel_then_delete' || action === 'block_active')
          && !currentJob.cancelRequestedAt
        ) {
          currentJob = await cancelJob(currentJob);
          stats.cancelRequested += 1;
          action = resolveCurrentDeletionAction();
        }

        if (action !== 'delete') {
          markPending(action, currentJob);
          continue;
        }

        const outcome = await deleteJob(currentJob);
        if (outcome?.deleted) {
          stats.deleted += 1;
        } else if (outcome?.action !== 'not_found') {
          markPending(outcome?.action || 'delete_failed', currentJob);
        }
      } catch (error) {
        stats.errors += 1;
        markPending('reconcile_failed', job);
        onError(error, { userId, jobId: job.id });
      }
    }
  }

  return stats;
};

export const shouldAlertTombstonedJobCleanup = (stats = {}, {
  now = Date.now(),
  pendingAlertMs = 15 * 60 * 1000,
} = {}) => {
  if (Number(stats?.errors || 0) > 0) return true;
  if (Number(stats?.pendingReasons?.recoveryManual || 0) > 0) return true;
  const agedManualWork = Number(stats?.pendingReasons?.submissionUnknown || 0)
    + Number(stats?.pendingReasons?.pendingReservation || 0);
  if (agedManualWork <= 0) return false;
  const oldestPendingUpdatedAt = Math.min(
    ...['submissionUnknown', 'pendingReservation']
      .map((reason) => Number(stats?.oldestPendingUpdatedAtByReason?.[reason] || 0))
      .filter((value) => value > 0),
  );
  if (!Number.isFinite(oldestPendingUpdatedAt)) return false;
  if (oldestPendingUpdatedAt <= 0) return false;
  return Math.max(0, Number(now || Date.now()) - oldestPendingUpdatedAt)
    >= Math.max(1, Number(pendingAlertMs || 0));
};
