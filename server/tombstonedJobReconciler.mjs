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

export const reconcileTombstonedJobs = async ({
  stateRows = [],
  loadJobs,
  cancelJob,
  deleteJob,
  onError = () => {},
} = {}) => {
  const stats = {
    desired: 0,
    found: 0,
    deleted: 0,
    cancelRequested: 0,
    pending: 0,
    errors: 0,
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
      stats.pending += jobIds.length;
      onError(error, { userId, jobIds });
      continue;
    }
    stats.found += jobs.length;

    for (const job of jobs) {
      try {
        let currentJob = job;
        let action = resolveJobDeletionAction(currentJob);
        if (
          (action === 'cancel_then_delete' || action === 'block_active')
          && !currentJob.cancelRequestedAt
        ) {
          currentJob = await cancelJob(currentJob);
          stats.cancelRequested += 1;
          action = resolveJobDeletionAction(currentJob);
        }

        if (action !== 'delete') {
          stats.pending += 1;
          continue;
        }

        const outcome = await deleteJob(currentJob);
        if (outcome?.deleted) {
          stats.deleted += 1;
        } else if (outcome?.action !== 'not_found') {
          stats.pending += 1;
        }
      } catch (error) {
        stats.errors += 1;
        stats.pending += 1;
        onError(error, { userId, jobId: job.id });
      }
    }
  }

  return stats;
};
