import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createVirtualModelGenerationBatch,
  finalizeVirtualModelGenerationBatch,
  reconcileVirtualModelGenerationBatch,
  retryVirtualModelGenerationPose,
} from './virtualModelGenerationService.mjs';
import {
  advanceVirtualModelGenerationPoseAttempt,
  bindVirtualModelGenerationPoseJob,
  claimVirtualModelGenerationPoseSubmission,
  failVirtualModelGenerationPoseSubmission,
  findLatestVirtualModelGenerationBatch,
  findOrCreateVirtualModelGenerationBatchRecord,
  getVirtualModelGenerationBatch,
  normalizeVirtualModelGenerationStore,
  updateVirtualModelGenerationBatchRecord,
} from './virtualModelGenerationStore.mjs';
const loadSeparateServiceInstance = (name) => import(`./virtualModelGenerationService.mjs?instance=${name}`);

const POSES = ['C01', 'C02', 'C03', 'C04', 'C05', 'P05', 'P01', 'P03'];
const DERIVED = new Set(['C02', 'C03', 'C04', 'C05', 'P05', 'P03']);

const makeHarness = () => {
  const batches = new Map();
  const jobs = new Map();
  const createCalls = [];
  const jobsByRuntimeId = new Map();
  let id = 0;
  const deps = {
    now: () => 100,
    createId: () => 'batch-1',
    getModelVersion: async () => ({ model: { id: 'model-1', status: 'draft' }, version: { id: 'version-1', virtualModelId: 'model-1', status: 'draft' } }),
    getSourceAssets: async ({ assetIds }) => assetIds.map((assetId) => ({ id: assetId, userId: 'admin-1', module: 'virtual_model_generation', publicUrl: `https://source.test/${assetId}.png`, originalName: `${assetId}.png` })),
    createJob: async (request) => {
      const runtimeId = request.createRuntimeId;
      const existing = jobsByRuntimeId.get(runtimeId);
      const currentExisting = existing ? jobs.get(existing.id) || existing : null;
      if (currentExisting && ['queued', 'running', 'retry_waiting'].includes(currentExisting.status)) return currentExisting;
      const job = { id: `job-${++id}`, userId: 'admin-1', status: 'queued', payload: request.payload, result: null };
      jobs.set(job.id, job);
      jobsByRuntimeId.set(runtimeId, job);
      createCalls.push({ job, request });
      return job;
    },
    getJob: async (jobId) => jobs.get(jobId) || null,
    findJobByIdempotencyKey: async ({ idempotencyKey }) => {
      const job = jobsByRuntimeId.get(idempotencyKey);
      return job ? jobs.get(job.id) || job : null;
    },
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
    bindPoseJob: async ({ batchId, userId, poseId, idempotencyKey, job, boundAt, baselineRevision }) => {
      const batch = batches.get(batchId);
      if (!batch || batch.userId !== userId) return null;
      const task = batch.poseTasks.find((item) => item.poseId === poseId);
      if (task?.submitClaim?.idempotencyKey !== idempotencyKey) return null;
      const resultUrl = job.status === 'succeeded' ? String(job.result?.imageUrl || '') : '';
      batch.poseTasks = batch.poseTasks.map((item) => item.poseId === poseId ? {
        ...item,
        status: job.status === 'succeeded' && !resultUrl ? 'failed' : job.status || 'queued',
        jobId: job.id,
        submitClaim: undefined,
        retryRequested: undefined,
        ...(job.status === 'succeeded' && resultUrl && ['C01', 'P01'].includes(poseId)
          ? { temporaryResultUrl: resultUrl, referenceStatus: 'generated' }
          : job.status === 'succeeded' && resultUrl ? { resultUrl } : {}),
        ...(['failed', 'cancelled'].includes(job.status)
          ? { errorCode: job.errorCode || 'provider_failed', errorMessage: job.errorMessage || 'failed' }
          : {}),
        ...(DERIVED.has(poseId) ? { baselineRevision } : {}),
      } : item);
      batch.updatedAt = boundAt;
      return structuredClone(batch);
    },
    stabilizeGeneratedReference: async ({ task }) => ({
      managedAsset: { assetId: `managed-${task.poseId}`, publicUrl: `https://managed.test/${task.poseId}.png` },
      stableReferenceUrl: `https://stable.test/${task.poseId}.png`,
    }),
    createOrFindBatchRecord: async (batch) => {
      const existing = [...batches.values()].find((item) => (
        item.userId === batch.userId
        && item.clientSubmissionKey === batch.clientSubmissionKey
      ));
      if (existing) {
        if (
          existing.virtualModelId !== batch.virtualModelId
          || existing.virtualModelVersionId !== batch.virtualModelVersionId
        ) {
          throw Object.assign(new Error('Submission key target mismatch'), {
            code: 'MODEL_GENERATION_SUBMISSION_KEY_CONFLICT',
          });
        }
        return { batch: structuredClone(existing), created: false };
      }
      batches.set(batch.id, structuredClone(batch));
      return { batch: structuredClone(batch), created: true };
    },
    advancePoseAttempt: async ({ batchId, userId, poseId, expectedAttempt, taskPatch, batchPatch }) => {
      const batch = batches.get(batchId);
      if (!batch || batch.userId !== userId) return null;
      const task = batch.poseTasks.find((item) => item.poseId === poseId);
      if (Number(task?.attempt || 1) !== Number(expectedAttempt)) return null;
      batch.poseTasks = batch.poseTasks.map((item) => item.poseId === poseId ? {
        poseId: item.poseId,
        slot: item.slot,
        label: item.label,
        attempt: expectedAttempt + 1,
        ...structuredClone(taskPatch),
      } : item);
      Object.assign(batch, structuredClone(batchPatch));
      return structuredClone(batch);
    },
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
    completeFinalization: async (input) => {
      const result = {
        virtualModelId: input.virtualModelId,
        virtualModelVersionId: input.virtualModelVersionId,
        assets: input.assets,
      };
      await deps.updateBatchRecord(input.batchId, input.userId, {
        status: 'completed',
        finalizedAt: input.finalizedAt,
        finalizationResult: result,
      });
      return result;
    },
  };
  return { deps, batches, jobs, createCalls };
};

const createBatch = (harness) => createVirtualModelGenerationBatch({
  userId: 'admin-1', virtualModelId: 'model-1', virtualModelVersionId: 'version-1',
  sourceAssetIds: ['source-2', 'source-1'], primarySourceAssetId: 'source-1',
  clientSubmissionKey: 'submission-1', deps: harness.deps,
});

test('creation submits only C01 and P01 with current-user virtual-model source assets', async () => {
  const harness = makeHarness();
  const batch = await createBatch(harness);
  assert.deepEqual(batch.poseTasks.map((task) => task.poseId), POSES);
  assert.ok(batch.poseTasks.every((task) => task.attempt === 1));
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
  assert.equal(harness.createCalls[0].request.payload.idempotencyKey, 'virtual-model-generation:batch-1:C01:1:1');
  assert.equal(harness.createCalls[0].request.createRuntimeId, 'virtual-model-generation:batch-1:C01:1:1');
});

test('interleaved service recovery binds distinct C01 and P01 jobs without overwriting either pose', async () => {
  const harness = makeHarness();
  const [first, second] = await Promise.all([loadSeparateServiceInstance('c01'), loadSeparateServiceInstance('p01')]);
  const claim = (poseId) => ({ idempotencyKey: `virtual-model-generation:batch-1:${poseId}:1:1`, baselineRevision: 1, claimedAt: 1 });
  harness.batches.set('batch-1', {
    id: 'batch-1', userId: 'admin-1', virtualModelId: 'model-1', virtualModelVersionId: 'version-1', sourceAssetIds: ['source-1'], primarySourceAssetId: 'source-1', status: 'queued', baselineRevision: 1, derivedRegenerationRequired: false, createdAt: 1, updatedAt: 1,
    poseTasks: POSES.map((poseId) => ({ poseId, slot: poseId, label: poseId, attempt: 1, status: ['C01', 'P01'].includes(poseId) ? 'pending' : 'cancelled', ...(['C01', 'P01'].includes(poseId) ? { submitClaim: claim(poseId) } : {}) })),
  });
  await Promise.all([
    first.reconcileVirtualModelGenerationBatch({ batchId: 'batch-1', userId: 'admin-1', deps: harness.deps }),
    second.reconcileVirtualModelGenerationBatch({ batchId: 'batch-1', userId: 'admin-1', deps: harness.deps }),
  ]);
  const jobs = harness.batches.get('batch-1').poseTasks.filter((task) => ['C01', 'P01'].includes(task.poseId));
  assert.deepEqual(jobs.map((task) => task.jobId).sort(), ['job-1', 'job-2']);
  assert.equal(harness.createCalls.length, 2);
});

test('a claimed pose recovers an already-created job by idempotency key without another create', async () => {
  const harness = makeHarness();
  const key = 'virtual-model-generation:batch-1:C01:1:1';
  const job = { id: 'recovered-job', userId: 'admin-1', status: 'queued', payload: { idempotencyKey: key }, result: null };
  harness.jobs.set(job.id, job);
  harness.deps.findJobByIdempotencyKey = async ({ idempotencyKey }) => idempotencyKey === key ? job : null;
  harness.batches.set('batch-1', {
    id: 'batch-1', userId: 'admin-1', virtualModelId: 'model-1', virtualModelVersionId: 'version-1', sourceAssetIds: ['source-1'], primarySourceAssetId: 'source-1', status: 'queued', baselineRevision: 1, derivedRegenerationRequired: false, createdAt: 1, updatedAt: 1,
    poseTasks: POSES.map((poseId) => ({ poseId, slot: poseId, label: poseId, attempt: 1, status: poseId === 'C01' ? 'pending' : 'cancelled', ...(poseId === 'C01' ? { submitClaim: { idempotencyKey: key, baselineRevision: 1, claimedAt: 1 } } : {}) })),
  });
  await reconcileVirtualModelGenerationBatch({ batchId: 'batch-1', userId: 'admin-1', deps: harness.deps });
  assert.equal(harness.createCalls.length, 0);
  assert.equal(harness.batches.get('batch-1').poseTasks[0].jobId, 'recovered-job');
});

test('a create-before-bind crash reuses the unique runtime job on the next reconciliation', async () => {
  const harness = makeHarness();
  let bindAttempts = 0;
  const realBind = harness.deps.bindPoseJob;
  harness.deps.bindPoseJob = async (input) => ++bindAttempts === 1 ? null : realBind(input);
  await createBatch(harness);
  assert.equal(harness.createCalls.length, 2);
  assert.equal(harness.batches.get('batch-1').poseTasks.find((task) => task.poseId === 'C01').jobId, undefined);
  await reconcileVirtualModelGenerationBatch({ batchId: 'batch-1', userId: 'admin-1', deps: harness.deps });
  assert.equal(harness.createCalls.length, 2);
  assert.ok(harness.batches.get('batch-1').poseTasks.filter((task) => ['C01', 'P01'].includes(task.poseId)).every((task) => task.jobId));
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
  assert.equal(batch.poseTasks.find((task) => task.poseId === 'C01').attempt, 2);
  assert.equal(harness.createCalls[2].request.createRuntimeId, 'virtual-model-generation:batch-1:C01:1:2');
});

test('duplicate and concurrent batch submissions reuse one durable batch and one paid job per baseline pose', async () => {
  const harness = makeHarness();
  const [first, second] = await Promise.all([
    createBatch(harness),
    createBatch(harness),
  ]);
  assert.equal(first.id, second.id);
  assert.equal(harness.batches.size, 1);
  assert.equal(harness.createCalls.length, 2);

  await assert.rejects(
    createVirtualModelGenerationBatch({
      userId: 'admin-1',
      virtualModelId: 'model-1',
      virtualModelVersionId: 'different-version',
      sourceAssetIds: ['source-1'],
      primarySourceAssetId: 'source-1',
      clientSubmissionKey: 'submission-1',
      deps: {
        ...harness.deps,
        getModelVersion: async () => ({
          model: { id: 'model-1', status: 'draft' },
          version: { id: 'different-version', virtualModelId: 'model-1', status: 'draft' },
        }),
      },
    }),
    (error) => error?.code === 'MODEL_GENERATION_SUBMISSION_KEY_CONFLICT',
  );
});

test('retry create-before-bind recovery finds the terminal attempt job and never pays twice', async () => {
  const harness = makeHarness();
  await createBatch(harness);
  const c01 = harness.createCalls[0].job;
  harness.jobs.set(c01.id, {
    ...c01,
    status: 'failed',
    errorCode: 'provider_failed',
    errorMessage: 'failed',
  });
  await reconcileVirtualModelGenerationBatch({
    batchId: 'batch-1',
    userId: 'admin-1',
    deps: harness.deps,
  });

  const realBind = harness.deps.bindPoseJob;
  let crashOnce = true;
  harness.deps.createJob = async (request) => {
    const job = {
      id: 'retry-terminal-job',
      userId: 'admin-1',
      status: 'succeeded',
      payload: request.payload,
      result: { imageUrl: 'https://provider.test/retry-c01.png' },
    };
    harness.jobs.set(job.id, job);
    harness.createCalls.push({ job, request });
    return job;
  };
  harness.deps.findJobByIdempotencyKey = async ({ idempotencyKey }) => (
    idempotencyKey === 'virtual-model-generation:batch-1:C01:1:2'
      ? harness.jobs.get('retry-terminal-job') || null
      : null
  );
  harness.deps.bindPoseJob = async (input) => {
    if (input.poseId === 'C01' && crashOnce) {
      crashOnce = false;
      return null;
    }
    return realBind(input);
  };

  await retryVirtualModelGenerationPose({
    batchId: 'batch-1',
    userId: 'admin-1',
    poseId: 'C01',
    deps: harness.deps,
  });
  await reconcileVirtualModelGenerationBatch({
    batchId: 'batch-1',
    userId: 'admin-1',
    deps: harness.deps,
  });
  assert.equal(
    harness.createCalls.filter((call) => call.request.payload.poseId === 'C01').length,
    2,
  );
  const recovered = harness.batches.get('batch-1').poseTasks.find((task) => task.poseId === 'C01');
  assert.equal(recovered.jobId, 'retry-terminal-job');
  assert.equal(recovered.referenceStatus, 'baseline_ready');
});

test('reference upload retry reuses the managed baseline and does not create another paid job', async () => {
  const harness = makeHarness();
  let uploadAttempts = 0;
  harness.deps.stabilizeGeneratedReference = async ({ task, url }) => {
    uploadAttempts += 1;
    assert.equal(
      url,
      uploadAttempts === 1
        ? 'https://provider.test/c01.png'
        : 'https://managed.test/C01.png',
    );
    if (uploadAttempts === 1) {
      throw Object.assign(new Error('upload failed'), {
        code: 'kie_upload_failed',
        managedReferenceAsset: {
          assetId: 'managed-C01',
          publicUrl: 'https://managed.test/C01.png',
        },
      });
    }
    return {
      managedAsset: {
        assetId: task.managedReferenceAsset.assetId,
        publicUrl: task.managedReferenceAsset.publicUrl,
      },
      stableReferenceUrl: 'https://stable.test/C01.png',
    };
  };
  await createBatch(harness);
  const c01 = harness.createCalls[0].job;
  harness.jobs.set(c01.id, {
    ...c01,
    status: 'succeeded',
    result: { imageUrl: 'https://provider.test/c01.png' },
  });
  await reconcileVirtualModelGenerationBatch({
    batchId: 'batch-1',
    userId: 'admin-1',
    deps: harness.deps,
  });
  const failedReference = harness.batches.get('batch-1').poseTasks.find((task) => task.poseId === 'C01');
  assert.equal(failedReference.referenceStatus, 'reference_failed');
  assert.equal(failedReference.managedReferenceAsset.assetId, 'managed-C01');

  await retryVirtualModelGenerationPose({
    batchId: 'batch-1',
    userId: 'admin-1',
    poseId: 'C01',
    deps: harness.deps,
  });
  assert.equal(
    harness.createCalls.filter((call) => call.request.payload.poseId === 'C01').length,
    1,
  );
  assert.equal(
    harness.batches.get('batch-1').poseTasks.find((task) => task.poseId === 'C01').referenceStatus,
    'baseline_ready',
  );
});

test('finalization writes all eight durable slots to the draft in one replacement', async () => {
  const harness = makeHarness();
  await createBatch(harness);
  const stored = harness.batches.get('batch-1');
  const replacements = [];
  harness.deps.completeFinalization = async (input) => {
    replacements.push(input);
    const result = {
      virtualModelId: input.virtualModelId,
      virtualModelVersionId: input.virtualModelVersionId,
      assets: input.assets,
    };
    await harness.deps.updateBatchRecord(input.batchId, input.userId, {
      status: 'completed',
      finalizedAt: input.finalizedAt,
      finalizationResult: result,
    });
    return result;
  };
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

test('a lost response after atomic finalization does not replace the eight slots twice', async () => {
  const harness = makeHarness();
  await createBatch(harness);
  const stored = harness.batches.get('batch-1');
  stored.status = 'ready_to_finalize';
  stored.poseTasks = stored.poseTasks.map((task) => ({
    ...task,
    status: 'succeeded',
    jobId: `done-${task.poseId}`,
    resultUrl: `https://provider.test/${task.poseId}.png`,
    ...(DERIVED.has(task.poseId) ? { baselineRevision: 1 } : {
      referenceStatus: 'baseline_ready',
      managedReferenceAsset: {
        assetId: `managed-${task.poseId}`,
        publicUrl: `https://managed.test/${task.poseId}.png`,
      },
      stableReferenceUrl: `https://stable.test/${task.poseId}.png`,
    }),
  }));
  stored.poseTasks.forEach((task) => harness.jobs.set(task.jobId, {
    id: task.jobId,
    userId: 'admin-1',
    status: 'succeeded',
    payload: { generationBatchId: 'batch-1', poseId: task.poseId },
    result: { imageUrl: task.resultUrl },
  }));
  let finalizationCalls = 0;
  harness.deps.completeFinalization = async (input) => {
    finalizationCalls += 1;
    const result = {
      virtualModelId: input.virtualModelId,
      virtualModelVersionId: input.virtualModelVersionId,
      assets: input.assets,
    };
    await harness.deps.updateBatchRecord(input.batchId, input.userId, {
      status: 'completed',
      finalizedAt: input.finalizedAt,
      finalizationResult: result,
    });
    if (finalizationCalls === 1) throw new Error('response_lost_after_commit');
    return result;
  };

  await assert.rejects(
    () => finalizeVirtualModelGenerationBatch({
      batchId: 'batch-1',
      userId: 'admin-1',
      deps: harness.deps,
    }),
    /response_lost_after_commit/,
  );
  const recovered = await finalizeVirtualModelGenerationBatch({
    batchId: 'batch-1',
    userId: 'admin-1',
    deps: harness.deps,
  });

  assert.equal(recovered.assets.length, 8);
  assert.equal(finalizationCalls, 1);
});

test('real local generation store carries baseline revision through eight-pose generation and finalization', async () => {
  const store = normalizeVirtualModelGenerationStore({});
  const jobs = new Map();
  const jobsByKey = new Map();
  const replacements = [];
  let jobCounter = 0;
  let assetCounter = 0;
  const dataSource = { store };
  const deps = {
    now: () => 100,
    createId: () => 'batch-real-store',
    getModelVersion: async () => ({
      model: { id: 'model-1', status: 'draft' },
      version: {
        id: 'version-1',
        virtualModelId: 'model-1',
        status: 'draft',
      },
    }),
    getSourceAssets: async ({ assetIds }) => assetIds.map((assetId) => ({
      id: assetId,
      userId: 'admin-1',
      module: 'virtual_model_generation',
      publicUrl: `https://source.test/${assetId}.png`,
      originalName: `${assetId}.png`,
    })),
    createOrFindBatchRecord: (batch) => (
      findOrCreateVirtualModelGenerationBatchRecord({ ...dataSource, batch })
    ),
    getBatchRecord: (batchId, userId) => getVirtualModelGenerationBatch({
      ...dataSource,
      batchId,
      userId,
    }),
    findLatestBatchRecord: (userId, virtualModelId, virtualModelVersionId) => (
      findLatestVirtualModelGenerationBatch({
        ...dataSource,
        userId,
        virtualModelId,
        virtualModelVersionId,
      })
    ),
    updateBatchRecord: (batchId, userId, patch) => (
      updateVirtualModelGenerationBatchRecord({
        ...dataSource,
        batchId,
        userId,
        patch,
      })
    ),
    claimPoseSubmission: (input) => (
      claimVirtualModelGenerationPoseSubmission({ ...dataSource, ...input })
    ),
    bindPoseJob: (input) => (
      bindVirtualModelGenerationPoseJob({ ...dataSource, ...input })
    ),
    failPoseSubmission: (input) => (
      failVirtualModelGenerationPoseSubmission({ ...dataSource, ...input })
    ),
    advancePoseAttempt: (input) => (
      advanceVirtualModelGenerationPoseAttempt({ ...dataSource, ...input })
    ),
    findJobByIdempotencyKey: async ({ idempotencyKey }) => (
      jobsByKey.get(idempotencyKey) || null
    ),
    createJob: async (request) => {
      const job = {
        id: `real-job-${++jobCounter}`,
        userId: 'admin-1',
        status: 'succeeded',
        payload: request.payload,
        result: {
          imageUrl: `https://provider.test/${request.payload.poseId}.png`,
        },
      };
      jobs.set(job.id, job);
      jobsByKey.set(request.createRuntimeId, job);
      return job;
    },
    getJob: async (jobId) => jobs.get(jobId) || null,
    cancelJob: async () => {},
    stabilizeGeneratedReference: async ({ task }) => ({
      managedAsset: {
        assetId: `baseline-${task.poseId}`,
        publicUrl: `https://managed.test/${task.poseId}.png`,
      },
      stableReferenceUrl: `https://stable.test/${task.poseId}.png`,
    }),
    fetchGeneratedAsset: async () => ({
      fileBuffer: Buffer.from('image'),
      mimeType: 'image/png',
    }),
    persistGeneratedAsset: async ({ task }) => ({
      id: `result-${task.poseId}`,
      publicUrl: `https://managed.test/result-${task.poseId}.png`,
    }),
    createPreviewAsset: async ({ assetId }) => ({
      id: `preview-${++assetCounter}`,
      publicUrl: `https://preview.test/${assetId}.png`,
    }),
    completeFinalization: async ({
      batchId,
      userId,
      virtualModelId,
      virtualModelVersionId,
      assets,
      finalizedAt,
    }) => {
      replacements.push(structuredClone(assets));
      const result = { virtualModelId, virtualModelVersionId, assets };
      await updateVirtualModelGenerationBatchRecord({
        ...dataSource,
        batchId,
        userId,
        patch: {
          status: 'completed',
          finalizedAt,
          finalizationResult: result,
        },
      });
      return result;
    },
  };

  const generated = await createVirtualModelGenerationBatch({
    userId: 'admin-1',
    virtualModelId: 'model-1',
    virtualModelVersionId: 'version-1',
    sourceAssetIds: ['source-1'],
    primarySourceAssetId: 'source-1',
    clientSubmissionKey: 'real-store-submission',
    deps,
  });
  assert.equal(
    (await deps.findLatestBatchRecord('admin-1', 'model-1', 'version-1')).id,
    generated.id,
  );
  assert.equal(generated.status, 'ready_to_finalize');
  assert.ok(
    generated.poseTasks
      .filter((task) => DERIVED.has(task.poseId))
      .every((task) => task.baselineRevision === generated.baselineRevision),
  );

  const finalized = await finalizeVirtualModelGenerationBatch({
    batchId: generated.id,
    userId: 'admin-1',
    deps,
  });
  assert.equal(finalized.assets.length, 8);
  assert.equal(replacements.length, 1);
  assert.equal(replacements[0].length, 8);
  assert.equal(
    (await deps.getBatchRecord(generated.id, 'admin-1')).status,
    'completed',
  );
});
