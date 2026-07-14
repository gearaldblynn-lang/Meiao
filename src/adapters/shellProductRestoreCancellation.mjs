import {
  cloneProductRestoreAnalysisAttempts,
  cloneProductRestoreAnalysisAttemptsForMutation,
  mergeProductRestoreAnalysisAttempts,
} from '../utils/productRestoreAnalysisCredits.ts';

const normalizeIdentity = (value) => String(value || '').trim();

const sortedIdentities = (values) => Array.from(values).filter(Boolean).sort();

const hasOwn = (value, key) => Boolean(value) && Object.prototype.hasOwnProperty.call(value, key);

export const cloneProductRestoreCancellationMarker = (marker) => {
  if (
    marker?.version !== 1
    || marker?.status !== 'cancelled'
    || marker?.reason !== 'user_requested'
    || !Number.isFinite(Number(marker?.cancelledAt))
  ) return undefined;
  return {
    version: 1,
    status: 'cancelled',
    reason: 'user_requested',
    cancelledAt: Number(marker.cancelledAt),
    jobIds: sortedIdentities(new Set((marker.jobIds || []).map(normalizeIdentity))),
  };
};

export const hasDurableProductRestoreCancellation = (project) => Boolean(
  cloneProductRestoreCancellationMarker(
    project?.generationContext?.productRestoreCancellation,
  ),
);

export const mergeProductRestoreGenerationContext = (existingContext, nextContext) => {
  if (!existingContext && !nextContext) return undefined;
  const merged = {
    ...(existingContext || {}),
    ...(nextContext || {}),
  };
  const nextExplicitlySetsAttempts = (
    hasOwn(nextContext, 'productRestoreAnalysisAttempts')
    && Array.isArray(nextContext?.productRestoreAnalysisAttempts)
  );
  const attempts = nextExplicitlySetsAttempts
    ? mergeProductRestoreAnalysisAttempts(
        cloneProductRestoreAnalysisAttemptsForMutation(existingContext),
        nextContext?.productRestoreAnalysisAttempts,
      )
    : cloneProductRestoreAnalysisAttempts(existingContext?.productRestoreAnalysisAttempts);
  if (attempts.length > 0) {
    merged.productRestoreAnalysisAttempts = attempts;
  } else {
    delete merged.productRestoreAnalysisAttempts;
  }
  const nextExplicitlySetsMarker = hasOwn(nextContext, 'productRestoreCancellation');
  const marker = cloneProductRestoreCancellationMarker(
    nextExplicitlySetsMarker
      ? nextContext?.productRestoreCancellation
      : existingContext?.productRestoreCancellation,
  );
  if (marker) {
    merged.productRestoreCancellation = marker;
  } else if (nextExplicitlySetsMarker) {
    // Explicit retry persists this undefined field to clear a previous marker.
    merged.productRestoreCancellation = undefined;
  } else {
    delete merged.productRestoreCancellation;
  }
  return merged;
};

export const createProductRestoreCancellationRegistry = ({
  cancelJob,
  onAudit = () => undefined,
} = {}) => {
  if (typeof cancelJob !== 'function') {
    throw new TypeError('cancelJob is required');
  }

  const cancelledProjectIds = new Set();
  const observedJobIds = new Map();
  const guards = new Map();

  const getObserved = (projectId) => {
    const normalizedProjectId = normalizeIdentity(projectId);
    if (!normalizedProjectId) return null;
    let jobIds = observedJobIds.get(normalizedProjectId);
    if (!jobIds) {
      jobIds = new Set();
      observedJobIds.set(normalizedProjectId, jobIds);
    }
    return jobIds;
  };

  const emitAudit = (guard) => {
    const jobIds = sortedIdentities(guard.jobIds);
    onAudit({
      projectId: guard.projectId,
      jobIds,
      cancelledJobCount: jobIds.length,
    });
  };

  const scheduleCancellation = (guard, jobId) => {
    const normalizedJobId = normalizeIdentity(jobId);
    if (!normalizedJobId) return false;
    guard.jobIds.add(normalizedJobId);
    if (guard.cancellationPromises.has(normalizedJobId)) return false;
    const cancellationPromise = Promise.resolve().then(() => cancelJob(normalizedJobId));
    guard.cancellationPromises.set(normalizedJobId, cancellationPromise);
    return true;
  };

  const beginCancellation = (projectId, initialJobIds = []) => {
    const normalizedProjectId = normalizeIdentity(projectId);
    if (!normalizedProjectId) return null;

    let guard = guards.get(normalizedProjectId);
    if (!guard) {
      guard = {
        projectId: normalizedProjectId,
        jobIds: new Set(),
        cancellationPromises: new Map(),
      };
      guards.set(normalizedProjectId, guard);
    }
    // The tombstone is visible before observed or caller-supplied identities are
    // collected, so any racing onJobCreated callback is handled by observeJob.
    cancelledProjectIds.add(normalizedProjectId);
    const observed = getObserved(normalizedProjectId);
    for (const jobId of observed || []) scheduleCancellation(guard, jobId);
    for (const jobId of initialJobIds || []) scheduleCancellation(guard, jobId);
    emitAudit(guard);
    return guard;
  };

  const addCancellationJobs = (projectId, jobIds = []) => {
    const normalizedProjectId = normalizeIdentity(projectId);
    const guard = guards.get(normalizedProjectId);
    if (!guard || !cancelledProjectIds.has(normalizedProjectId)) return [];
    let changed = false;
    for (const jobId of jobIds || []) {
      changed = scheduleCancellation(guard, jobId) || changed;
    }
    if (changed) emitAudit(guard);
    return sortedIdentities(guard.jobIds);
  };

  const observeJob = (projectId, jobId) => {
    const normalizedProjectId = normalizeIdentity(projectId);
    const normalizedJobId = normalizeIdentity(jobId);
    if (!normalizedProjectId || !normalizedJobId) return false;
    getObserved(normalizedProjectId)?.add(normalizedJobId);
    if (!cancelledProjectIds.has(normalizedProjectId)) return false;
    const guard = guards.get(normalizedProjectId) || beginCancellation(normalizedProjectId);
    const changed = scheduleCancellation(guard, normalizedJobId);
    if (changed) emitAudit(guard);
    return true;
  };

  const waitForCancellations = async (projectId) => {
    const normalizedProjectId = normalizeIdentity(projectId);
    const guard = guards.get(normalizedProjectId);
    if (!guard) return [];
    let observedSize = -1;
    let outcomes = [];
    while (observedSize !== guard.cancellationPromises.size) {
      observedSize = guard.cancellationPromises.size;
      outcomes = await Promise.allSettled(Array.from(guard.cancellationPromises.values()));
    }
    return outcomes;
  };

  const clearForExplicitRetry = (projectId) => {
    const normalizedProjectId = normalizeIdentity(projectId);
    if (!normalizedProjectId) return;
    cancelledProjectIds.delete(normalizedProjectId);
    guards.delete(normalizedProjectId);
    observedJobIds.delete(normalizedProjectId);
  };

  return {
    beginCancellation,
    addCancellationJobs,
    observeJob,
    waitForCancellations,
    isCancelled: (projectId) => cancelledProjectIds.has(normalizeIdentity(projectId)),
    getCancellationJobIds: (projectId) => sortedIdentities(
      guards.get(normalizeIdentity(projectId))?.jobIds || [],
    ),
    getObservedJobIds: (projectId) => sortedIdentities(
      observedJobIds.get(normalizeIdentity(projectId)) || [],
    ),
    clearForExplicitRetry,
    reset: () => {
      cancelledProjectIds.clear();
      observedJobIds.clear();
      guards.clear();
    },
  };
};

export const runProductRestoreFanout = async ({
  items = [],
  concurrency = 1,
  shouldStop = () => false,
  runItem,
} = {}) => {
  if (typeof runItem !== 'function') throw new TypeError('runItem is required');
  const source = Array.from(items || []);
  if (source.length === 0 || shouldStop()) return [];
  const workerCount = Math.min(
    source.length,
    Math.max(1, Math.floor(Number(concurrency) || 1)),
  );
  const results = new Array(source.length);
  let nextIndex = 0;
  const runWorker = async () => {
    while (!shouldStop()) {
      const index = nextIndex;
      if (index >= source.length) return;
      nextIndex += 1;
      if (shouldStop()) return;
      results[index] = await runItem(source[index], index);
    }
  };
  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
  return results.filter((_value, index) => Object.hasOwn(results, index));
};

export const markProductRestoreProjectCancelled = (
  project,
  errorMessage = '已手动中断',
  { cancelledAt = Date.now(), jobIds = [] } = {},
) => {
  const results = Array.isArray(project?.results)
    ? project.results.map((result) => {
      const hasMedia = Boolean(result?.imageUrl || result?.videoUrl);
      if (result?.status === 'completed' || hasMedia) return {
        ...result,
        status: 'completed',
        error: undefined,
      };
      return {
        ...result,
        status: 'error',
        error: errorMessage,
      };
    })
    : [];
  const existingMarker = cloneProductRestoreCancellationMarker(
    project?.generationContext?.productRestoreCancellation,
  );
  const cancellationJobIds = new Set([
    ...(existingMarker?.jobIds || []),
    ...jobIds,
    project?.backendJobId,
    project?.generationContext?.productRestore?.analysisJobId,
    ...results.flatMap((result) => [result?.backendJobId, result?.taskId]),
  ].map(normalizeIdentity).filter(Boolean));
  const marker = {
    version: 1,
    status: 'cancelled',
    reason: 'user_requested',
    cancelledAt: existingMarker?.cancelledAt || Number(cancelledAt) || Date.now(),
    jobIds: sortedIdentities(cancellationJobIds),
  };
  return {
    ...project,
    status: 'error',
    completedAt: undefined,
    generationContext: {
      ...(project?.generationContext || { prompt: '', params: {}, materials: {} }),
      productRestoreCancellation: marker,
    },
    results,
    completedCount: results.filter((result) => (
      result?.status === 'completed' && Boolean(result?.imageUrl || result?.videoUrl)
    )).length,
    error: errorMessage,
  };
};

const resultIdentity = (result) => {
  const targetMaterialId = normalizeIdentity(result?.targetMaterialId);
  const batchIndex = Number(result?.batchIndex || 0) || 0;
  if (targetMaterialId && batchIndex > 0) return `${targetMaterialId}:${batchIndex}`;
  return normalizeIdentity(result?.backendJobId || result?.taskId || result?.id);
};

export const shouldResumeProductRestoreProject = (project, { cancelled = false } = {}) => {
  if (
    cancelled
    || hasDurableProductRestoreCancellation(project)
    || project?.module !== 'retouch'
    || project?.subFeature !== 'product_restore'
    || !normalizeIdentity(project?.id)
    || !normalizeIdentity(project?.backendJobId)
    || (project?.status !== 'planning' && project?.status !== 'generating')
  ) return false;
  if (project.status === 'planning') return true;
  if (!project?.generationContext?.productRestore) return false;
  const trackedTargetCount = new Set(
    (Array.isArray(project.results) ? project.results : []).map(resultIdentity).filter(Boolean),
  ).size;
  return trackedTargetCount < Math.max(Number(project.taskCount || 0), 1);
};
