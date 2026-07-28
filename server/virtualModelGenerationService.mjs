import {
  VIRTUAL_MODEL_BASELINE_POSE_IDS,
  VIRTUAL_MODEL_DERIVED_POSE_IDS,
  VIRTUAL_MODEL_GENERATION_POSES,
  buildVirtualModelPosePrompt,
  extractVirtualModelPoseResultUrl,
} from './virtualModelPoseDefinitions.mjs';

const ACTIVE = new Set(['queued', 'running', 'retry_waiting']);
const BASELINES = new Set(VIRTUAL_MODEL_BASELINE_POSE_IDS);
const DERIVED = new Set(VIRTUAL_MODEL_DERIVED_POSE_IDS);
const locks = new Map();
const fail = (message, code = 'MODEL_GENERATION_BATCH_INVALID') => Object.assign(new Error(message), { code });

const withLock = async (batchId, userId, work) => {
  const key = `${userId}:${batchId}`;
  const previous = locks.get(key) || Promise.resolve();
  const current = previous.catch(() => {}).then(work);
  locks.set(key, current);
  try { return await current; } finally { if (locks.get(key) === current) locks.delete(key); }
};

const loadBatch = async (batchId, userId, deps) => {
  const batch = await deps.getBatchRecord(batchId, userId);
  if (!batch) throw fail('Virtual model generation batch not found', 'MODEL_GENERATION_BATCH_NOT_FOUND');
  return batch;
};

const validateDraft = async (batch, deps) => {
  const target = await deps.getModelVersion({ virtualModelId: batch.virtualModelId, virtualModelVersionId: batch.virtualModelVersionId });
  if (!target?.model || !target?.version || target.model.id !== batch.virtualModelId || target.version.id !== batch.virtualModelVersionId || target.model.status === 'deleted') throw fail('Virtual model generation target not found', 'MODEL_NOT_FOUND');
  if (target.version.status !== 'draft') throw fail('Published virtual model versions are immutable', 'MODEL_VERSION_IMMUTABLE');
  return target;
};

const orderedSources = async (batch, userId, deps) => {
  const assets = await deps.getSourceAssets({ assetIds: batch.sourceAssetIds, userId });
  const byId = new Map((assets || []).map((asset) => [String(asset.id || ''), asset]));
  const ids = [batch.primarySourceAssetId, ...batch.sourceAssetIds.filter((id) => id !== batch.primarySourceAssetId)];
  const sources = ids.map((id) => byId.get(id));
  if (sources.length !== batch.sourceAssetIds.length || sources.some((asset) => !asset || String(asset.userId) !== String(userId) || asset.module !== 'virtual_model_generation' || !String(asset.publicUrl || '').trim())) throw fail('Virtual model generation references are unavailable', 'MODEL_ASSET_UNAVAILABLE');
  return sources;
};

const baselineUrls = (batch) => VIRTUAL_MODEL_BASELINE_POSE_IDS.map((poseId) => batch.poseTasks.find((task) => task.poseId === poseId)).map((task) => {
  if (task?.status !== 'succeeded' || task.referenceStatus !== 'baseline_ready' || !String(task.stableReferenceUrl || '').trim()) throw fail('Virtual model baseline references are incomplete', 'MODEL_GENERATION_INCOMPLETE');
  return task.stableReferenceUrl;
});

const update = (batch, userId, patch, deps) => deps.updateBatchRecord(batch.id, userId, { ...patch, updatedAt: deps.now() });

const submit = async (batch, userId, poseIds, deps) => {
  const derived = poseIds.some((poseId) => DERIVED.has(poseId));
  const sources = derived ? null : await orderedSources(batch, userId, deps);
  const imageUrls = derived ? baselineUrls(batch) : sources.map((asset) => asset.publicUrl);
  const sourceName = derived ? '正面近景与正面全身基准图' : String(sources[0].originalName || '本地模特').replace(/\.[^.]+$/, '');
  let current = batch;
  for (const poseId of poseIds) {
    const index = current.poseTasks.findIndex((task) => task.poseId === poseId);
    const task = current.poseTasks[index];
    if (!task || task.status !== 'pending' || task.jobId) continue;
    const idempotencyKey = `virtual-model-generation:${current.id}:${poseId}:${current.baselineRevision}`;
    const claimed = await deps.claimPoseSubmission({
      batchId: current.id,
      userId,
      poseId,
      baselineRevision: current.baselineRevision,
      idempotencyKey,
      claimedAt: deps.now(),
    });
    if (!claimed) {
      current = await deps.getBatchRecord(current.id, userId) || current;
      continue;
    }
    const claimedBatch = await deps.getBatchRecord(current.id, userId) || current;
    const claimedTask = claimedBatch.poseTasks.find((item) => item.poseId === poseId);
    if (!claimedTask || claimedTask.submitClaim?.idempotencyKey !== idempotencyKey) continue;
    let job;
    try {
      job = await deps.createJob({
      module: 'virtual_model_library', taskType: 'kie_image', provider: 'kie', maxRetries: 0,
      payload: {
        imageUrls, prompt: buildVirtualModelPosePrompt({ sourceName, poseId, referenceCount: imageUrls.length, referenceRole: derived ? 'baseline' : 'uploaded' }),
        model: 'gpt-image-2', aspectRatio: '3:4', resolution: '2K', subFeature: 'virtual_model_pose_generation', shellPurpose: 'virtual_model_library_auto_angle',
        generationBatchId: current.id, virtualModelId: current.virtualModelId, virtualModelVersionId: current.virtualModelVersionId, poseId, slot: claimedTask.slot, baselineRevision: derived ? current.baselineRevision : undefined, idempotencyKey,
      },
      });
    } catch (error) {
      await deps.failPoseSubmission?.({ batchId: current.id, userId, poseId, idempotencyKey, failedAt: deps.now(), errorCode: String(error?.code || 'MODEL_GENERATION_SUBMISSION_FAILED'), errorMessage: String(error?.message || 'Virtual model generation submission failed') });
      throw error;
    }
    const poseTasks = claimedBatch.poseTasks.map((item) => item.poseId === poseId ? { ...item, status: String(job.status || 'queued'), jobId: job.id, retryRequested: undefined, ...(derived ? { baselineRevision: current.baselineRevision } : {}), errorCode: undefined, errorMessage: undefined } : item);
    current = await update(claimedBatch, userId, { status: 'queued', poseTasks }, deps);
  }
  return current;
};

const stabilize = async (batch, userId, deps) => {
  let current = batch;
  for (const poseId of VIRTUAL_MODEL_BASELINE_POSE_IDS) {
    const index = current.poseTasks.findIndex((task) => task.poseId === poseId);
    const task = current.poseTasks[index];
    if (!task || task.status !== 'succeeded' || ['baseline_ready', 'reference_failed'].includes(task.referenceStatus)) continue;
    const temporaryResultUrl = String(task.temporaryResultUrl || task.resultUrl || '').trim();
    if (!temporaryResultUrl) continue;
    try {
      const result = await deps.stabilizeGeneratedReference({ batch: current, task, url: temporaryResultUrl });
      if (!result?.managedAsset?.assetId || !result.managedAsset.publicUrl || !result.stableReferenceUrl) throw fail('Generated baseline reference could not be stabilized', 'MODEL_GENERATION_REFERENCE_INVALID');
      const invalidatesDerived = Boolean(task.invalidatesDerivedOnSuccess) && !current.derivedRegenerationRequired;
      const poseTasks = current.poseTasks.map((item, taskIndex) => taskIndex === index ? { ...item, status: 'succeeded', referenceStatus: 'baseline_ready', temporaryResultUrl, resultUrl: result.managedAsset.publicUrl, managedReferenceAsset: result.managedAsset, stableReferenceUrl: result.stableReferenceUrl, invalidatesDerivedOnSuccess: undefined, referenceErrorCode: undefined, referenceErrorMessage: undefined } : item);
      current = await update(current, userId, { status: 'running', poseTasks, baselineRevision: invalidatesDerived ? current.baselineRevision + 1 : current.baselineRevision, derivedRegenerationRequired: current.derivedRegenerationRequired || invalidatesDerived }, deps);
    } catch (error) {
      const poseTasks = current.poseTasks.map((item, taskIndex) => taskIndex === index ? { ...item, referenceStatus: 'reference_failed', temporaryResultUrl, referenceErrorCode: String(error?.code || 'MODEL_GENERATION_REFERENCE_FAILED'), referenceErrorMessage: String(error?.message || 'Generated baseline reference could not be stabilized') } : item);
      current = await update(current, userId, { status: 'failed', poseTasks }, deps);
    }
  }
  return current;
};

const reconcileUnlocked = async ({ batchId, userId, deps }) => {
  let batch = await loadBatch(batchId, userId, deps);
  if (batch.status === 'completed') return batch;
  const active = batch.poseTasks.map((task, index) => task.jobId && ACTIVE.has(task.status) ? index : -1).filter((index) => index >= 0);
  if (active.length) {
    const jobs = await Promise.all(active.map((index) => deps.getJob(batch.poseTasks[index].jobId)));
    const byIndex = new Map(active.map((index, offset) => [index, jobs[offset]]));
    const poseTasks = batch.poseTasks.map((task, index) => {
      const job = byIndex.get(index);
      if (!job) return task;
      if (String(job.userId || '') !== String(userId)) throw fail('Virtual model generation job is unavailable', 'MODEL_GENERATION_RESULT_UNAVAILABLE');
      if (ACTIVE.has(job.status)) return { ...task, status: job.status };
      const resultUrl = job.status === 'succeeded' ? extractVirtualModelPoseResultUrl(job.result || {}) : '';
      const status = job.status === 'succeeded' && resultUrl ? 'succeeded' : job.status === 'cancelled' ? 'cancelled' : 'failed';
      return { ...task, status, retryRequested: undefined, ...(BASELINES.has(task.poseId) && resultUrl ? { temporaryResultUrl: resultUrl, referenceStatus: 'generated' } : resultUrl ? { resultUrl } : {}), ...(status === 'failed' ? { errorCode: String(job.errorCode || 'MODEL_GENERATION_RESULT_UNAVAILABLE'), errorMessage: String(job.errorMessage || '姿势图片生成失败') } : {}) };
    });
    batch = await update(batch, userId, { status: 'running', poseTasks }, deps);
  }
  if (batch.poseTasks.some((task) => task.jobId && ACTIVE.has(task.status))) return batch.status === 'running' ? batch : update(batch, userId, { status: 'running' }, deps);
  batch = await stabilize(batch, userId, deps);
  const retries = batch.poseTasks.filter((task) => task.status === 'pending' && task.retryRequested);
  if (retries.length) return submit(batch, userId, retries.map((task) => task.poseId), deps);
  const baselinePending = batch.poseTasks.filter((task) => BASELINES.has(task.poseId) && task.status === 'pending' && !task.jobId).map((task) => task.poseId);
  if (baselinePending.length) return submit(batch, userId, baselinePending, deps);
  const baselinesReady = VIRTUAL_MODEL_BASELINE_POSE_IDS.every((poseId) => {
    const task = batch.poseTasks.find((item) => item.poseId === poseId);
    return task?.status === 'succeeded' && task.referenceStatus === 'baseline_ready' && task.stableReferenceUrl;
  });
  if (baselinesReady && !batch.derivedRegenerationRequired) {
    const derivedPending = batch.poseTasks.filter((task) => DERIVED.has(task.poseId) && task.status === 'pending' && !task.jobId).map((task) => task.poseId);
    if (derivedPending.length) return submit(batch, userId, derivedPending, deps);
  }
  const finalizable = baselinesReady && batch.poseTasks.length === VIRTUAL_MODEL_GENERATION_POSES.length && !batch.derivedRegenerationRequired && batch.poseTasks.every((task) => task.status === 'succeeded') && batch.poseTasks.filter((task) => DERIVED.has(task.poseId)).every((task) => task.baselineRevision === batch.baselineRevision);
  if (finalizable) return update(batch, userId, { status: 'ready_to_finalize' }, deps);
  const failed = batch.poseTasks.find((task) => ['failed', 'cancelled'].includes(task.status) || task.referenceStatus === 'reference_failed');
  return failed && batch.status !== 'failed' ? update(batch, userId, { status: 'failed' }, deps) : batch;
};

export const reconcileVirtualModelGenerationBatch = (input = {}) => withLock(input.batchId, input.userId, () => reconcileUnlocked(input));

export const createVirtualModelGenerationBatch = async ({ userId, virtualModelId, virtualModelVersionId, sourceAssetIds, primarySourceAssetId, deps } = {}) => {
  const ids = Array.isArray(sourceAssetIds) ? sourceAssetIds.map((id) => String(id || '').trim()).filter(Boolean) : [];
  if (ids.length < 1 || ids.length > 5 || new Set(ids).size !== ids.length || !ids.includes(String(primarySourceAssetId || ''))) throw fail('Virtual model generation references are invalid');
  const probe = { virtualModelId, virtualModelVersionId, sourceAssetIds: ids, primarySourceAssetId: String(primarySourceAssetId) };
  await validateDraft(probe, deps); await orderedSources(probe, userId, deps);
  const timestamp = deps.now();
  const batch = await deps.createBatchRecord({ id: deps.createId(), userId, virtualModelId, virtualModelVersionId, sourceAssetIds: ids, primarySourceAssetId: String(primarySourceAssetId), status: 'queued', baselineRevision: 1, derivedRegenerationRequired: false, poseTasks: VIRTUAL_MODEL_GENERATION_POSES.map((pose) => ({ poseId: pose.poseId, slot: pose.slot, label: pose.label, status: 'pending' })), createdAt: timestamp, updatedAt: timestamp, finalizedAt: null, finalizationResult: null });
  return reconcileVirtualModelGenerationBatch({ batchId: batch.id, userId, deps });
};

export const findVirtualModelGenerationBatchForTarget = async ({ userId, virtualModelId, virtualModelVersionId, deps } = {}) => {
  const batch = await deps.findLatestBatchRecord?.(userId, virtualModelId, virtualModelVersionId);
  return !batch || batch.status === 'completed' || batch.finalizedAt ? batch || null : reconcileVirtualModelGenerationBatch({ batchId: batch.id, userId, deps });
};

const retryUnlocked = async ({ batchId, userId, poseId, deps }) => {
  let batch = await loadBatch(batchId, userId, deps);
  if (batch.status === 'completed' || batch.finalizedAt) throw fail('Completed virtual model generation cannot be retried');
  await validateDraft(batch, deps);
  const index = batch.poseTasks.findIndex((task) => task.poseId === poseId);
  const task = batch.poseTasks[index];
  if (!task || !['failed', 'cancelled', 'succeeded'].includes(task.status)) throw fail('Virtual model generation pose cannot be retried');
  if (batch.derivedRegenerationRequired && DERIVED.has(poseId)) throw fail('Stale derived poses must be regenerated together');
  if (DERIVED.has(poseId)) baselineUrls(batch);
  const hasDerivedWork = batch.poseTasks.some((item) => DERIVED.has(item.poseId) && (item.jobId || item.resultUrl));
  const poseTasks = batch.poseTasks.map((item, taskIndex) => taskIndex === index ? { poseId: item.poseId, slot: item.slot, label: item.label, status: 'pending', retryRequested: true, ...(item.resultUrl ? { resultUrl: item.resultUrl } : {}), ...(BASELINES.has(poseId) && hasDerivedWork ? { invalidatesDerivedOnSuccess: true } : {}), ...(DERIVED.has(poseId) ? { baselineRevision: batch.baselineRevision } : {}) } : item);
  batch = await update(batch, userId, { status: 'queued', poseTasks }, deps);
  return reconcileUnlocked({ batchId: batch.id, userId, deps });
};
export const retryVirtualModelGenerationPose = (input = {}) => withLock(input.batchId, input.userId, () => retryUnlocked(input));

const regenerateUnlocked = async ({ batchId, userId, deps }) => {
  let batch = await loadBatch(batchId, userId, deps);
  if (batch.status === 'completed' || batch.finalizedAt || !batch.derivedRegenerationRequired || batch.poseTasks.some((task) => task.jobId && ACTIVE.has(task.status))) throw fail('Virtual model derived poses cannot be regenerated');
  await validateDraft(batch, deps); baselineUrls(batch);
  const poseTasks = batch.poseTasks.map((task) => DERIVED.has(task.poseId) ? { poseId: task.poseId, slot: task.slot, label: task.label, status: 'pending', retryRequested: true, baselineRevision: batch.baselineRevision, ...(task.resultUrl ? { resultUrl: task.resultUrl } : {}) } : task);
  batch = await update(batch, userId, { status: 'queued', poseTasks, derivedRegenerationRequired: false }, deps);
  return reconcileUnlocked({ batchId: batch.id, userId, deps });
};
export const regenerateVirtualModelDerivedPoses = (input = {}) => withLock(input.batchId, input.userId, () => regenerateUnlocked(input));

export const cancelVirtualModelGenerationBatch = (input = {}) => withLock(input.batchId, input.userId, async () => {
  const batch = await loadBatch(input.batchId, input.userId, input.deps);
  if (batch.status === 'completed') throw fail('Completed virtual model generation cannot be cancelled');
  await Promise.all(batch.poseTasks.filter((task) => task.jobId && ACTIVE.has(task.status)).map((task) => input.deps.cancelJob(task.jobId)));
  return update(batch, input.userId, { status: 'cancelled', poseTasks: batch.poseTasks.map((task) => task.status === 'succeeded' ? task : { ...task, status: 'cancelled' }) }, input.deps);
});

const assertFinalizable = (batch) => {
  const byPose = new Map(batch.poseTasks.map((task) => [task.poseId, task]));
  if (batch.derivedRegenerationRequired || byPose.size !== VIRTUAL_MODEL_GENERATION_POSES.length || VIRTUAL_MODEL_GENERATION_POSES.some((pose) => !['succeeded', 'persisting', 'saved'].includes(byPose.get(pose.poseId)?.status)) || VIRTUAL_MODEL_BASELINE_POSE_IDS.some((poseId) => byPose.get(poseId)?.referenceStatus !== 'baseline_ready' || !byPose.get(poseId)?.managedReferenceAsset?.assetId) || VIRTUAL_MODEL_DERIVED_POSE_IDS.some((poseId) => byPose.get(poseId)?.baselineRevision !== batch.baselineRevision)) throw fail('Virtual model generation is incomplete', 'MODEL_GENERATION_INCOMPLETE');
};

const finalizeUnlocked = async ({ batchId, userId, deps }) => {
  let batch = await loadBatch(batchId, userId, deps);
  if (batch.finalizedAt && batch.finalizationResult) return batch.finalizationResult;
  assertFinalizable(batch); await validateDraft(batch, deps); batch = await update(batch, userId, { status: 'persisting' }, deps);
  for (const pose of VIRTUAL_MODEL_GENERATION_POSES) {
    let index = batch.poseTasks.findIndex((task) => task.poseId === pose.poseId);
    let task = batch.poseTasks[index];
    if (!task.managedAsset && BASELINES.has(task.poseId)) {
      batch = await update(batch, userId, { poseTasks: batch.poseTasks.map((item, taskIndex) => taskIndex === index ? { ...item, status: 'persisting', managedAsset: { ...item.managedReferenceAsset } } : item) }, deps);
      index = batch.poseTasks.findIndex((item) => item.poseId === pose.poseId); task = batch.poseTasks[index];
    }
    if (!task.managedAsset) {
      const job = await deps.getJob(task.jobId); const url = extractVirtualModelPoseResultUrl(job?.result || {});
      if (!job || String(job.userId || '') !== String(userId) || job.status !== 'succeeded' || job.payload?.generationBatchId !== batch.id || job.payload?.poseId !== task.poseId || url !== task.resultUrl) throw fail('Virtual model generation result is unavailable', 'MODEL_GENERATION_RESULT_UNAVAILABLE');
      const downloaded = await deps.fetchGeneratedAsset({ url }); const asset = await deps.persistGeneratedAsset({ batch, task, ...downloaded });
      batch = await update(batch, userId, { poseTasks: batch.poseTasks.map((item, taskIndex) => taskIndex === index ? { ...item, status: 'persisting', managedAsset: { assetId: asset.id, publicUrl: asset.publicUrl } } : item) }, deps);
      index = batch.poseTasks.findIndex((item) => item.poseId === pose.poseId); task = batch.poseTasks[index];
    }
    if (!task.previewAsset) {
      const preview = await deps.createPreviewAsset({ assetId: task.managedAsset.assetId });
      batch = await update(batch, userId, { poseTasks: batch.poseTasks.map((item, taskIndex) => taskIndex === index ? { ...item, status: 'saved', previewAsset: { previewAssetId: preview.id, previewUrl: preview.publicUrl } } : item) }, deps);
    }
  }
  batch = await loadBatch(batchId, userId, deps); assertFinalizable(batch);
  const byPose = new Map(batch.poseTasks.map((task) => [task.poseId, task]));
  const assets = VIRTUAL_MODEL_GENERATION_POSES.map((pose, index) => { const task = byPose.get(pose.poseId); return { slot: pose.slot, assetId: task.managedAsset.assetId, publicUrl: task.managedAsset.publicUrl, previewAssetId: task.previewAsset.previewAssetId, previewUrl: task.previewAsset.previewUrl, position: index + 1, isPrimary: pose.isPrimary, validationStatus: 'passed' }; });
  const result = { virtualModelId: batch.virtualModelId, virtualModelVersionId: batch.virtualModelVersionId, assets: await deps.replaceDraftVersionAssets({ virtualModelId: batch.virtualModelId, virtualModelVersionId: batch.virtualModelVersionId, assets }) };
  await update(batch, userId, { status: 'completed', poseTasks: batch.poseTasks, finalizedAt: deps.now(), finalizationResult: result }, deps);
  return result;
};
export const finalizeVirtualModelGenerationBatch = (input = {}) => withLock(input.batchId, input.userId, () => finalizeUnlocked(input));
