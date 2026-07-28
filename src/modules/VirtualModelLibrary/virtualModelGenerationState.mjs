export const VIRTUAL_MODEL_GENERATION_POSE_IDS = Object.freeze([
  'C01',
  'C02',
  'C03',
  'C04',
  'C05',
  'P05',
  'P01',
  'P03',
]);

const DERIVED_POSE_IDS = new Set(['C02', 'C03', 'C04', 'C05', 'P05', 'P03']);
const BASELINE_POSE_IDS = new Set(['C01', 'P01']);

export const canFinalizeVirtualModelBatch = (batch) => {
  const poseTasks = batch?.poseTasks;
  if (!Array.isArray(poseTasks) || poseTasks.length !== VIRTUAL_MODEL_GENERATION_POSE_IDS.length) return false;
  if (batch?.derivedRegenerationRequired || !Number.isInteger(batch?.baselineRevision)) return false;
  const byId = new Map(poseTasks.map((task) => [task?.poseId, task]));
  const finalizableStatuses = new Set(['succeeded', 'persisting', 'saved']);
  return byId.size === VIRTUAL_MODEL_GENERATION_POSE_IDS.length
    && VIRTUAL_MODEL_GENERATION_POSE_IDS.every((poseId) => finalizableStatuses.has(byId.get(poseId)?.status))
    && [...BASELINE_POSE_IDS].every((poseId) => (
      byId.get(poseId)?.referenceStatus === 'baseline_ready'
      && byId.get(poseId)?.managedReferenceAsset?.assetId
    ))
    && [...DERIVED_POSE_IDS].every(
      (poseId) => byId.get(poseId)?.baselineRevision === batch.baselineRevision,
    );
};

export const canRetryVirtualModelPose = (task) => (
  ['failed', 'cancelled', 'succeeded'].includes(String(task?.status || ''))
);

const RESUMABLE_BATCH_STATUSES = new Set([
  'queued',
  'running',
  'retry_waiting',
  'failed',
  'cancelled',
  'ready_to_finalize',
  'persisting',
  'regeneration_required',
]);

export const shouldResumeVirtualModelBatch = (batch) => (
  RESUMABLE_BATCH_STATUSES.has(String(batch?.status || ''))
);

export const deriveVirtualModelBatchProgress = (poseTasks = []) => {
  const tasks = Array.isArray(poseTasks) ? poseTasks : [];
  const completed = tasks.filter((task) => (
    ['succeeded', 'saved'].includes(task?.status)
    && (!BASELINE_POSE_IDS.has(task?.poseId) || task?.referenceStatus === 'baseline_ready')
  )).length;
  const failed = tasks.filter(
    (task) => task?.status === 'failed' || task?.referenceStatus === 'reference_failed',
  ).length;
  const total = VIRTUAL_MODEL_GENERATION_POSE_IDS.length;
  return {
    completed,
    failed,
    total,
    percent: Math.round((completed / total) * 100),
  };
};

export const mergeVirtualModelBatchPoll = (current, incoming) => {
  if (!current?.id || incoming?.id !== current.id) return current;
  const currentUpdatedAt = Number(current.updatedAt || 0);
  const incomingUpdatedAt = Number(incoming.updatedAt || 0);
  return currentUpdatedAt && incomingUpdatedAt < currentUpdatedAt ? current : incoming;
};
