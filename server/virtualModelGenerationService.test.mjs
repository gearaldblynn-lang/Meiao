import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createVirtualModelGenerationBatch,
  finalizeVirtualModelGenerationBatch,
  reconcileVirtualModelGenerationBatch,
  retryVirtualModelGenerationPose,
} from './virtualModelGenerationService.mjs';
const loadSeparateServiceInstance = (name) => import(`./virtualModelGenerationService.mjs?instance=${name}`);

const POSES = ['C01', 'C02', 'C03', 'C04', 'C05', 'P05', 'P01', 'P03'];
const DERIVED = new Set(['C02', 'C03', 'C04', 'C05', 'P05', 'P03']);

const makeHarness = () => {
  const batches = new Map();
  const jobs = new Map();
  const createCalls = [];
  let id = 0;
  const deps = {
    now: () => 100,
    createId: () => 'batch-1',
    getModelVersion: async () => ({ model: { id: 'model-1', status: 'draft' }, version: { id: 'version-1', virtualModelId: 'model-1', status: 'draft' } }),
    getSourceAssets: async ({ assetIds }) => assetIds.map((assetId) => ({ id: assetId, userId: 'admin-1', module: 'virtual_model_generation', publicUrl: `https://source.test/${assetId}.png`, originalName: `${assetId}.png` })),
    createJob: async (request) => {
      const job = { id: `job-${++id}`, userId: 'admin-1', status: 'queued', payload: request.payload, result: null };
      jobs.set(job.id, job);
      createCalls.push({ job, request });
      return job;
    },
    getJob: async (jobId) => jobs.get(jobId) || null,
    cancelJob: async () => {},
    claimPoseSubmission: async ({ batchId, poseId, baselineRevision, idempotencyKey, claimedAt }) => {
      const batch = batches.get(batchId);
      if (batch.poseTasks.some((task) => task.poseId === poseId && task.submitClaim)) return false;
      batch.poseTasks = batch.poseTasks.map((task) => task.poseId === poseId ? {
        ...task,
        submitClaim: { idempotencyKey, baselineRevision, claimedAt },
      } : task);
      return true;
    },
    failPoseSubmission: async () => {},
    stabilizeGeneratedReference: async ({ task }) => ({
      managedAsset: { assetId: `managed-${task.poseId}`, publicUrl: `https://managed.test/${task.poseId}.png` },
      stableReferenceUrl: `https://stable.test/${task.poseId}.png`,
    }),
    createBatchRecord: async (batch) => { batches.set(batch.id, structuredClone(batch)); return structuredClone(batch); },
    getBatchRecord: async (batchId, userId) => {
      const batch = batches.get(batchId);
      return batch?.userId === userId ? structuredClone(batch) : null;
    },
    updateBatchRecord: async (batchId, userId, patch) => {
      const batch = batches.get(batchId);
      if (!batch || batch.userId !== userId) return null;
      const next = { ...batch, ...structuredClone(patch) };
      batches.set(batchId, next);
      return structuredClone(next);
    },
    fetchGeneratedAsset: async () => ({ fileBuffer: Buffer.from('image'), mimeType: 'image/png' }),
    persistGeneratedAsset: async ({ task }) => ({ id: `persisted-${task.poseId}`, publicUrl: `https://persisted.test/${task.poseId}.png` }),
    createPreviewAsset: async ({ assetId }) => ({ id: `preview-${assetId}`, publicUrl: `https://preview.test/${assetId}.png` }),
    replaceDraftVersionAssets: async (input) => input.assets,
  };
  return { deps, batches, jobs, createCalls };
};

const createBatch = (harness) => createVirtualModelGenerationBatch({
  userId: 'admin-1', virtualModelId: 'model-1', virtualModelVersionId: 'version-1',
  sourceAssetIds: ['source-2', 'source-1'], primarySourceAssetId: 'source-1', deps: harness.deps,
});

test('creation submits only C01 and P01 with current-user virtual-model source assets', async () => {
  const harness = makeHarness();
  const batch = await createBatch(harness);
  assert.deepEqual(batch.poseTasks.map((task) => task.poseId), POSES);
  assert.deepEqual(harness.createCalls.map((call) => call.request.payload.poseId), ['C01', 'P01']);
  assert.ok(harness.createCalls.every((call) => call.request.maxRetries === 0));
  assert.deepEqual(harness.createCalls[0].request.payload.imageUrls, ['https://source.test/source-1.png', 'https://source.test/source-2.png']);

  harness.deps.getSourceAssets = async () => [{ id: 'source-1', userId: 'other-user', module: 'virtual_model_generation', publicUrl: 'https://other.test/source.png' }];
  await assert.rejects(createBatch(harness), (error) => error?.code === 'MODEL_ASSET_UNAVAILABLE');
});

test('two separate service instances claim a pending pose once before creating a paid job', async () => {
  const harness = makeHarness();
  const [first, second] = await Promise.all([loadSeparateServiceInstance('one'), loadSeparateServiceInstance('two')]);
  const timestamp = harness.deps.now();
  harness.batches.set('batch-1', {
    id: 'batch-1', userId: 'admin-1', virtualModelId: 'model-1', virtualModelVersionId: 'version-1',
    sourceAssetIds: ['source-1'], primarySourceAssetId: 'source-1', status: 'queued', baselineRevision: 1,
    derivedRegenerationRequired: false, createdAt: timestamp, updatedAt: timestamp,
    poseTasks: POSES.map((poseId) => ({ poseId, slot: poseId, label: poseId, status: poseId === 'C01' ? 'pending' : 'cancelled' })),
  });
  await Promise.all([
    first.reconcileVirtualModelGenerationBatch({ batchId: 'batch-1', userId: 'admin-1', deps: harness.deps }),
    second.reconcileVirtualModelGenerationBatch({ batchId: 'batch-1', userId: 'admin-1', deps: harness.deps }),
  ]);
  assert.equal(harness.createCalls.length, 1);
  assert.equal(harness.createCalls[0].request.maxRetries, 0);
  assert.equal(harness.createCalls[0].request.payload.idempotencyKey, 'virtual-model-generation:batch-1:C01:1');
});

test('derived work waits for both completed and stabilized baseline outputs', async () => {
  const harness = makeHarness();
  await createBatch(harness);
  const [c01, p01] = harness.createCalls.map((call) => call.job);
  harness.jobs.set(c01.id, { ...c01, status: 'succeeded', result: { imageUrl: 'https://provider.test/c01.png' } });
  await reconcileVirtualModelGenerationBatch({ batchId: 'batch-1', userId: 'admin-1', deps: harness.deps });
  assert.equal(harness.createCalls.length, 2);
  harness.jobs.set(p01.id, { ...p01, status: 'succeeded', result: { imageUrl: 'https://provider.test/p01.png' } });
  const batch = await reconcileVirtualModelGenerationBatch({ batchId: 'batch-1', userId: 'admin-1', deps: harness.deps });
  assert.equal(harness.createCalls.length, 8);
  assert.deepEqual(harness.createCalls.slice(2).flatMap((call) => call.request.payload.imageUrls), Array(6).fill(['https://stable.test/C01.png', 'https://stable.test/P01.png']).flat());
  assert.ok(batch.poseTasks.filter((task) => DERIVED.has(task.poseId)).every((task) => task.baselineRevision === 1));
});

test('failed work is not automatically resubmitted and an explicit retry creates one replacement job', async () => {
  const harness = makeHarness();
  await createBatch(harness);
  const c01 = harness.createCalls[0].job;
  const p01 = harness.createCalls[1].job;
  harness.jobs.set(c01.id, { ...c01, status: 'failed', errorCode: 'provider_failed', errorMessage: 'failed' });
  harness.jobs.set(p01.id, { ...p01, status: 'failed', errorCode: 'provider_failed', errorMessage: 'failed' });
  await reconcileVirtualModelGenerationBatch({ batchId: 'batch-1', userId: 'admin-1', deps: harness.deps });
  await reconcileVirtualModelGenerationBatch({ batchId: 'batch-1', userId: 'admin-1', deps: harness.deps });
  assert.equal(harness.createCalls.length, 2);
  const batch = await retryVirtualModelGenerationPose({ batchId: 'batch-1', userId: 'admin-1', poseId: 'C01', deps: harness.deps });
  assert.equal(harness.createCalls.length, 3);
  assert.equal(batch.poseTasks.find((task) => task.poseId === 'C01').status, 'queued');
});

test('finalization writes all eight durable slots to the draft in one replacement', async () => {
  const harness = makeHarness();
  await createBatch(harness);
  const stored = harness.batches.get('batch-1');
  const replacements = [];
  harness.deps.replaceDraftVersionAssets = async (input) => { replacements.push(input); return input.assets; };
  stored.status = 'ready_to_finalize';
  stored.poseTasks = stored.poseTasks.map((task) => ({
    ...task,
    status: 'succeeded',
    jobId: `done-${task.poseId}`,
    resultUrl: `https://provider.test/${task.poseId}.png`,
    ...(DERIVED.has(task.poseId) ? { baselineRevision: 1 } : {
      referenceStatus: 'baseline_ready',
      managedReferenceAsset: { assetId: `managed-${task.poseId}`, publicUrl: `https://managed.test/${task.poseId}.png` },
      stableReferenceUrl: `https://stable.test/${task.poseId}.png`,
    }),
  }));
  stored.poseTasks.forEach((task) => harness.jobs.set(task.jobId, { id: task.jobId, userId: 'admin-1', status: 'succeeded', payload: { generationBatchId: 'batch-1', poseId: task.poseId }, result: { imageUrl: task.resultUrl } }));
  const result = await finalizeVirtualModelGenerationBatch({ batchId: 'batch-1', userId: 'admin-1', deps: harness.deps });
  assert.equal(result.assets.length, 8);
  assert.equal(replacements.length, 1);
  assert.equal(replacements[0].assets.length, 8);
  assert.equal(harness.batches.get('batch-1').status, 'completed');
});
