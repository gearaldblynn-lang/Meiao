import test from 'node:test';
import assert from 'node:assert/strict';
import {
  advanceVirtualModelGenerationPoseAttempt,
  bindVirtualModelGenerationPoseJob,
  claimVirtualModelGenerationPoseSubmission,
  createVirtualModelGenerationBatchRecord,
  ensureVirtualModelGenerationSchema,
  findOrCreateVirtualModelGenerationBatchRecord,
  getVirtualModelGenerationBatch,
  listActiveVirtualModelGenerationProtectedAssetReferences,
  normalizeVirtualModelGenerationStore,
  updateVirtualModelGenerationBatchRecord,
} from './virtualModelGenerationStore.mjs';
import { selectExpiredAssetsForCleanup } from './assetStore.mjs';

const makeBatch = (overrides = {}) => ({
  id: 'batch-1',
  userId: 'admin-1',
  virtualModelId: 'model-1',
  virtualModelVersionId: 'version-1',
  sourceAssetIds: ['source-1'],
  primarySourceAssetId: 'source-1',
  clientSubmissionKey: 'submission-1',
  status: 'queued',
  poseTasks: [],
  baselineRevision: 1,
  derivedRegenerationRequired: false,
  createdAt: 1,
  updatedAt: 1,
  finalizedAt: null,
  finalizationResult: null,
  ...overrides,
});

test('local generation batches normalize records and enforce ownership', async () => {
  const store = {};
  const created = await createVirtualModelGenerationBatchRecord({ store, batch: makeBatch() });
  assert.equal(normalizeVirtualModelGenerationStore(store).virtualModelGenerationBatches.length, 1);
  assert.deepEqual(await getVirtualModelGenerationBatch({ store, batchId: created.id, userId: 'admin-1' }), created);
  assert.equal(await getVirtualModelGenerationBatch({ store, batchId: created.id, userId: 'admin-2' }), null);
  await assert.rejects(
    updateVirtualModelGenerationBatchRecord({ store, batchId: created.id, userId: 'admin-2', patch: { status: 'running' } }),
    (error) => error?.code === 'MODEL_GENERATION_BATCH_NOT_FOUND',
  );
});

test('local submission-key find-or-create is atomic and rejects cross-target reuse', async () => {
  const store = {};
  const [first, duplicate] = await Promise.all([
    findOrCreateVirtualModelGenerationBatchRecord({
      store,
      batch: makeBatch(),
    }),
    findOrCreateVirtualModelGenerationBatchRecord({
      store,
      batch: makeBatch({ id: 'batch-2' }),
    }),
  ]);
  assert.equal(first.created, true);
  assert.equal(duplicate.created, false);
  assert.equal(duplicate.batch.id, 'batch-1');
  assert.equal(normalizeVirtualModelGenerationStore(store).virtualModelGenerationBatches.length, 1);
  await assert.rejects(
    findOrCreateVirtualModelGenerationBatchRecord({
      store,
      batch: makeBatch({ id: 'batch-3', virtualModelVersionId: 'version-2' }),
    }),
    (error) => error?.code === 'MODEL_GENERATION_SUBMISSION_KEY_CONFLICT',
  );
});

test('MySQL generation batches normalize JSON fields and only update their owner record', async () => {
  const calls = [];
  const row = {
    id: 'batch-1', user_id: 'admin-1', virtual_model_id: 'model-1', virtual_model_version_id: 'version-1',
    source_asset_ids_json: '["source-1"]', primary_source_asset_id: 'source-1',
    client_submission_key: 'submission-1', status: 'queued',
    pose_tasks_json: '[{"poseId":"C01"}]', baseline_revision: 2, derived_regeneration_required: 1,
    created_at: 1, updated_at: 2, finalized_at: null, finalization_result_json: '{"assets":[]}',
  };
  const pool = {
    query: async (sql, values = []) => {
      calls.push({ sql, values });
      if (sql.startsWith('CREATE TABLE')) return [{ affectedRows: 0 }];
      if (sql.includes('INFORMATION_SCHEMA.COLUMNS')) return [[{ COLUMN_NAME: values[0] }]];
      if (sql.includes('INFORMATION_SCHEMA.STATISTICS')) return [[{ INDEX_NAME: 'uq_virtual_model_generation_submission' }]];
      if (sql.startsWith('INSERT INTO')) return [{ affectedRows: 1 }];
      if (sql.startsWith('SELECT *')) return [[row]];
      if (sql.startsWith('UPDATE')) return [{ affectedRows: 1 }];
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
  await ensureVirtualModelGenerationSchema(pool);
  await createVirtualModelGenerationBatchRecord({ pool, batch: makeBatch() });
  const loaded = await getVirtualModelGenerationBatch({ pool, batchId: 'batch-1', userId: 'admin-1' });
  assert.deepEqual(loaded.sourceAssetIds, ['source-1']);
  assert.deepEqual(loaded.poseTasks, [{ poseId: 'C01' }]);
  assert.equal(loaded.baselineRevision, 2);
  assert.equal(loaded.clientSubmissionKey, 'submission-1');
  assert.equal(loaded.derivedRegenerationRequired, true);
  assert.deepEqual(loaded.finalizationResult, { assets: [] });
  await updateVirtualModelGenerationBatchRecord({ pool, batchId: 'batch-1', userId: 'admin-1', patch: { status: 'running', updatedAt: 3 } });
  assert.match(calls.find((call) => call.sql.startsWith('UPDATE')).sql, /WHERE id = \? AND user_id = \?/);
});

test('MySQL submission-key race returns the inserted winner after a duplicate-key insert', async () => {
  const winner = {
    id: 'batch-winner',
    user_id: 'admin-1',
    virtual_model_id: 'model-1',
    virtual_model_version_id: 'version-1',
    client_submission_key: 'submission-1',
    source_asset_ids_json: '["source-1"]',
    primary_source_asset_id: 'source-1',
    status: 'queued',
    pose_tasks_json: '[]',
    baseline_revision: 1,
    derived_regeneration_required: 0,
    created_at: 1,
    updated_at: 1,
  };
  let lookupCount = 0;
  let insertCount = 0;
  const pool = {
    query: async (sql) => {
      if (sql.startsWith('SELECT *') && sql.includes('client_submission_key')) {
        lookupCount += 1;
        return [lookupCount === 1 ? [] : [winner]];
      }
      if (sql.startsWith('INSERT INTO')) {
        insertCount += 1;
        throw Object.assign(new Error('duplicate'), { code: 'ER_DUP_ENTRY' });
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
  const result = await findOrCreateVirtualModelGenerationBatchRecord({
    pool,
    batch: makeBatch({ id: 'batch-loser' }),
  });
  assert.equal(insertCount, 1);
  assert.equal(result.created, false);
  assert.equal(result.batch.id, 'batch-winner');
});

test('pose retries atomically increment the persisted attempt ordinal', async () => {
  const store = normalizeVirtualModelGenerationStore({
    virtualModelGenerationBatches: [makeBatch({
      poseTasks: [{ poseId: 'C01', slot: 'C01', label: 'C01', status: 'failed', attempt: 1 }],
    })],
  });
  const input = {
    store,
    batchId: 'batch-1',
    userId: 'admin-1',
    poseId: 'C01',
    expectedAttempt: 1,
    taskPatch: { status: 'pending', retryRequested: true },
    batchPatch: { status: 'queued', updatedAt: 2 },
  };
  const advanced = await advanceVirtualModelGenerationPoseAttempt(input);
  assert.equal(advanced.poseTasks[0].attempt, 2);
  assert.equal(await advanceVirtualModelGenerationPoseAttempt(input), null);
});

test('submission claims are durable compare-and-set records keyed by batch pose and baseline revision', async () => {
  const store = normalizeVirtualModelGenerationStore({
    virtualModelGenerationBatches: [makeBatch({ poseTasks: [{ poseId: 'C01', status: 'pending' }] })],
  });
  const input = {
    store, batchId: 'batch-1', userId: 'admin-1', poseId: 'C01', baselineRevision: 1,
    idempotencyKey: 'virtual-model-generation:batch-1:C01:1:1', claimedAt: 2,
  };
  assert.equal(await claimVirtualModelGenerationPoseSubmission(input), true);
  assert.equal(await claimVirtualModelGenerationPoseSubmission(input), false);
  assert.deepEqual(store.virtualModelGenerationBatches[0].poseTasks[0].submitClaim, {
    idempotencyKey: 'virtual-model-generation:batch-1:C01:1:1', baselineRevision: 1, claimedAt: 2,
  });
});

test('MySQL submission claims compare the stored pose snapshot so only one process can claim it', async () => {
  let storedJson = '[{"poseId":"C01","status":"pending"}]';
  const calls = [];
  const pool = {
    query: async (sql, values = []) => {
      calls.push({ sql, values });
      if (sql.startsWith('SELECT pose_tasks_json')) return [[{ pose_tasks_json: storedJson }]];
      if (sql.startsWith('UPDATE virtual_model_generation_batches')) {
        const [nextJson, , , , expectedJson] = values;
        if (expectedJson !== storedJson) return [{ affectedRows: 0 }];
        storedJson = nextJson;
        return [{ affectedRows: 1 }];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
  const input = { pool, batchId: 'batch-1', userId: 'admin-1', poseId: 'C01', baselineRevision: 1, idempotencyKey: 'virtual-model-generation:batch-1:C01:1:1', claimedAt: 2 };
  assert.equal(await claimVirtualModelGenerationPoseSubmission(input), true);
  assert.equal(await claimVirtualModelGenerationPoseSubmission(input), false);
  assert.match(calls.find((call) => call.sql.startsWith('UPDATE virtual_model_generation_batches')).sql, /AND pose_tasks_json = \?/);
});

test('interleaved C01 and P01 bindings merge only their claimed pose without erasing the other job', async () => {
  const store = normalizeVirtualModelGenerationStore({
    virtualModelGenerationBatches: [makeBatch({
      poseTasks: [{ poseId: 'C01', status: 'pending' }, { poseId: 'P01', status: 'pending' }],
    })],
  });
  const claim = (poseId) => ({ store, batchId: 'batch-1', userId: 'admin-1', poseId, baselineRevision: 1, idempotencyKey: `virtual-model-generation:batch-1:${poseId}:1`, claimedAt: 2 });
  assert.equal(await claimVirtualModelGenerationPoseSubmission(claim('C01')), true);
  assert.equal(await claimVirtualModelGenerationPoseSubmission(claim('P01')), true);
  await Promise.all([
    bindVirtualModelGenerationPoseJob({ ...claim('C01'), job: { id: 'job-c01', status: 'queued' }, boundAt: 3 }),
    bindVirtualModelGenerationPoseJob({ ...claim('P01'), job: { id: 'job-p01', status: 'queued' }, boundAt: 3 }),
  ]);
  assert.deepEqual(store.virtualModelGenerationBatches[0].poseTasks.map((task) => [task.poseId, task.jobId]), [['C01', 'job-c01'], ['P01', 'job-p01']]);
});

test('terminal job binding folds provider success and failure into pose state', async () => {
  const store = normalizeVirtualModelGenerationStore({
    virtualModelGenerationBatches: [makeBatch({
      poseTasks: [
        {
          poseId: 'C01',
          status: 'pending',
          attempt: 2,
          submitClaim: {
            idempotencyKey: 'virtual-model-generation:batch-1:C01:1:2',
          },
        },
        {
          poseId: 'C02',
          status: 'pending',
          attempt: 1,
          baselineRevision: 1,
          submitClaim: {
            idempotencyKey: 'virtual-model-generation:batch-1:C02:1:1',
          },
        },
      ],
    })],
  });
  await bindVirtualModelGenerationPoseJob({
    store,
    batchId: 'batch-1',
    userId: 'admin-1',
    poseId: 'C01',
    idempotencyKey: 'virtual-model-generation:batch-1:C01:1:2',
    job: {
      id: 'job-c01',
      status: 'succeeded',
      result: { imageUrl: 'https://provider.test/c01.png' },
    },
    baselineRevision: 1,
    boundAt: 2,
  });
  await bindVirtualModelGenerationPoseJob({
    store,
    batchId: 'batch-1',
    userId: 'admin-1',
    poseId: 'C02',
    idempotencyKey: 'virtual-model-generation:batch-1:C02:1:1',
    job: {
      id: 'job-c02',
      status: 'failed',
      errorCode: 'provider_failed',
      errorMessage: 'provider failed',
    },
    baselineRevision: 1,
    boundAt: 3,
  });
  const [baseline, derived] = store.virtualModelGenerationBatches[0].poseTasks;
  assert.equal(baseline.status, 'succeeded');
  assert.equal(baseline.temporaryResultUrl, 'https://provider.test/c01.png');
  assert.equal(baseline.referenceStatus, 'generated');
  assert.equal(baseline.submitClaim, undefined);
  assert.equal(derived.status, 'failed');
  assert.equal(derived.errorCode, 'provider_failed');
});

test('cleanup boundary executes local and MySQL generation references before retention selection', async () => {
  const assets = [
    {
      id: 'source-1',
      publicUrl: '/api/assets/source-1',
      userId: 'admin-1',
      createdAt: 1,
      expiresAt: 2,
      deletedAt: null,
      storageStatus: 'active',
      assetType: 'upload',
    },
    {
      id: 'managed-C01',
      publicUrl: '/api/assets/managed-C01',
      userId: 'admin-1',
      createdAt: 1,
      expiresAt: 2,
      deletedAt: null,
      storageStatus: 'active',
      assetType: 'result',
    },
  ];
  const batch = makeBatch({
    status: 'failed',
    poseTasks: [{
      poseId: 'C01',
      status: 'succeeded',
      referenceStatus: 'reference_failed',
      managedReferenceAsset: {
        assetId: 'managed-C01',
        publicUrl: '/api/assets/managed-C01',
      },
    }],
  });
  const localRefs = await listActiveVirtualModelGenerationProtectedAssetReferences({
    store: normalizeVirtualModelGenerationStore({
      virtualModelGenerationBatches: [batch],
    }),
    assets,
  });
  const pool = {
    query: async () => [[{
      source_asset_ids_json: JSON.stringify(batch.sourceAssetIds),
      pose_tasks_json: JSON.stringify(batch.poseTasks),
    }]],
  };
  const mysqlRefs = await listActiveVirtualModelGenerationProtectedAssetReferences({
    pool,
    assets,
  });
  for (const refs of [localRefs, mysqlRefs]) {
    const candidates = selectExpiredAssetsForCleanup(
      assets.map((asset) => ({
        ...asset,
        isReferenced: refs.has(asset.id) || refs.has(asset.publicUrl),
      })),
      100,
    );
    assert.deepEqual(candidates, []);
  }
});

test('MySQL pose binding retries a compare-and-set conflict and preserves both interleaved job IDs', async () => {
  const key = (poseId) => `virtual-model-generation:batch-1:${poseId}:1`;
  let storedJson = JSON.stringify([
    { poseId: 'C01', status: 'pending', submitClaim: { idempotencyKey: key('C01') } },
    { poseId: 'P01', status: 'pending', submitClaim: { idempotencyKey: key('P01') } },
  ]);
  const pool = {
    query: async (sql, values = []) => {
      if (sql.startsWith('SELECT * FROM virtual_model_generation_batches')) return [[{ id: 'batch-1', user_id: 'admin-1', virtual_model_id: 'model-1', virtual_model_version_id: 'version-1', source_asset_ids_json: '[]', primary_source_asset_id: '', status: 'queued', pose_tasks_json: storedJson, baseline_revision: 1, derived_regeneration_required: 0, created_at: 1, updated_at: 1 }]];
      if (sql.startsWith('UPDATE virtual_model_generation_batches')) {
        const [nextJson, , , , expectedJson] = values;
        if (expectedJson !== storedJson) return [{ affectedRows: 0 }];
        storedJson = nextJson;
        return [{ affectedRows: 1 }];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
  await Promise.all([
    bindVirtualModelGenerationPoseJob({ pool, batchId: 'batch-1', userId: 'admin-1', poseId: 'C01', idempotencyKey: key('C01'), job: { id: 'job-c01', status: 'queued' }, baselineRevision: 1, boundAt: 2 }),
    bindVirtualModelGenerationPoseJob({ pool, batchId: 'batch-1', userId: 'admin-1', poseId: 'P01', idempotencyKey: key('P01'), job: { id: 'job-p01', status: 'queued' }, baselineRevision: 1, boundAt: 2 }),
  ]);
  assert.deepEqual(JSON.parse(storedJson).map((task) => [task.poseId, task.jobId]), [['C01', 'job-c01'], ['P01', 'job-p01']]);
});
