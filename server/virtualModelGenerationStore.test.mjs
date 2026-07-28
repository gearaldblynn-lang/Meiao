import test from 'node:test';
import assert from 'node:assert/strict';
import {
  claimVirtualModelGenerationPoseSubmission,
  createVirtualModelGenerationBatchRecord,
  ensureVirtualModelGenerationSchema,
  getVirtualModelGenerationBatch,
  normalizeVirtualModelGenerationStore,
  updateVirtualModelGenerationBatchRecord,
} from './virtualModelGenerationStore.mjs';

const makeBatch = (overrides = {}) => ({
  id: 'batch-1',
  userId: 'admin-1',
  virtualModelId: 'model-1',
  virtualModelVersionId: 'version-1',
  sourceAssetIds: ['source-1'],
  primarySourceAssetId: 'source-1',
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

test('MySQL generation batches normalize JSON fields and only update their owner record', async () => {
  const calls = [];
  const row = {
    id: 'batch-1', user_id: 'admin-1', virtual_model_id: 'model-1', virtual_model_version_id: 'version-1',
    source_asset_ids_json: '["source-1"]', primary_source_asset_id: 'source-1', status: 'queued',
    pose_tasks_json: '[{"poseId":"C01"}]', baseline_revision: 2, derived_regeneration_required: 1,
    created_at: 1, updated_at: 2, finalized_at: null, finalization_result_json: '{"assets":[]}',
  };
  const pool = {
    query: async (sql, values = []) => {
      calls.push({ sql, values });
      if (sql.startsWith('CREATE TABLE')) return [{ affectedRows: 0 }];
      if (sql.includes('INFORMATION_SCHEMA.COLUMNS')) return [[{ COLUMN_NAME: values[0] }]];
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
  assert.equal(loaded.derivedRegenerationRequired, true);
  assert.deepEqual(loaded.finalizationResult, { assets: [] });
  await updateVirtualModelGenerationBatchRecord({ pool, batchId: 'batch-1', userId: 'admin-1', patch: { status: 'running', updatedAt: 3 } });
  assert.match(calls.find((call) => call.sql.startsWith('UPDATE')).sql, /WHERE id = \? AND user_id = \?/);
});

test('submission claims are durable compare-and-set records keyed by batch pose and baseline revision', async () => {
  const store = normalizeVirtualModelGenerationStore({
    virtualModelGenerationBatches: [makeBatch({ poseTasks: [{ poseId: 'C01', status: 'pending' }] })],
  });
  const input = {
    store, batchId: 'batch-1', userId: 'admin-1', poseId: 'C01', baselineRevision: 1,
    idempotencyKey: 'virtual-model-generation:batch-1:C01:1', claimedAt: 2,
  };
  assert.equal(await claimVirtualModelGenerationPoseSubmission(input), true);
  assert.equal(await claimVirtualModelGenerationPoseSubmission(input), false);
  assert.deepEqual(store.virtualModelGenerationBatches[0].poseTasks[0].submitClaim, {
    idempotencyKey: 'virtual-model-generation:batch-1:C01:1', baselineRevision: 1, claimedAt: 2,
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
  const input = { pool, batchId: 'batch-1', userId: 'admin-1', poseId: 'C01', baselineRevision: 1, idempotencyKey: 'virtual-model-generation:batch-1:C01:1', claimedAt: 2 };
  assert.equal(await claimVirtualModelGenerationPoseSubmission(input), true);
  assert.equal(await claimVirtualModelGenerationPoseSubmission(input), false);
  assert.match(calls.find((call) => call.sql.startsWith('UPDATE virtual_model_generation_batches')).sql, /AND pose_tasks_json = \?/);
});
