import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createVirtualModelDraft,
  createVirtualModelGenerationJobSnapshot,
  createVirtualModelVersion,
  deleteVirtualModel,
  findOwnedHistoricalVirtualModelSnapshot,
  listAdminVirtualModels,
  listPublishedVirtualModels,
  normalizeVirtualModelLocalStore,
  publishVirtualModelVersion,
  replaceDraftVersionAssets,
  unpublishVirtualModel,
  updateVirtualModelDraft,
  validateVirtualModelVersionForPublish,
} from './virtualModelStore.mjs';

const slots = [
  'front_close', 'left_45_close', 'right_45_close', 'profile_close',
  'front_half', 'three_quarter_half', 'front_full', 'three_quarter_full',
];
const assets = slots.map((slot, index) => ({
  id: `a-${index}`,
  slot,
  assetId: `stored-${index}`,
  previewAssetId: `preview-${index}`,
  previewUrl: `/api/assets/file/preview-${index}/preview.jpg`,
  position: index + 1,
  isPrimary: index === 0,
  validationStatus: 'passed',
}));

test('local storage owns separate model arrays', () => {
  const store = normalizeVirtualModelLocalStore({});
  assert.deepEqual(store.virtualModels, []);
  assert.deepEqual(store.virtualModelVersions, []);
  assert.deepEqual(store.virtualModelAssets, []);
});

test('historical snapshot authorization requires an owned prior library job in local and MySQL storage', async () => {
  const snapshot = {
    identitySource: 'library',
    virtualModelId: 'model-1',
    virtualModelVersionId: 'version-1',
    publishedAt: 123,
    selectedAssetIds: ['asset-1', 'asset-2', 'asset-3'],
  };
  const ownedJob = { userId: 'user-1', status: 'succeeded', payload: snapshot };
  const localStore = { jobs: [ownedJob, { ...ownedJob, userId: 'user-2', payload: { ...snapshot, virtualModelId: 'model-2' } }] };

  assert.equal(await findOwnedHistoricalVirtualModelSnapshot({ store: localStore, userId: 'user-1', snapshot }), true);
  assert.equal(await findOwnedHistoricalVirtualModelSnapshot({ store: localStore, userId: 'user-2', snapshot }), false);
  assert.equal(await findOwnedHistoricalVirtualModelSnapshot({ store: localStore, userId: 'user-1', snapshot: { ...snapshot, selectedAssetIds: [...snapshot.selectedAssetIds].reverse() } }), false);

  const calls = [];
  const pool = {
    query: async (sql, params) => {
      calls.push({ sql, params });
      return [[{ payload_json: JSON.stringify(snapshot) }]];
    },
  };
  assert.equal(await findOwnedHistoricalVirtualModelSnapshot({ pool, userId: 'user-1', snapshot }), true);
  assert.match(calls[0].sql, /FROM internal_jobs/);
  assert.doesNotMatch(calls[0].sql, /LIMIT\s+500/i);
  assert.deepEqual(calls[0].params, ['user-1']);
});

test('normalizing a legacy local store initializes its own model arrays', async () => {
  const store = {};
  await createVirtualModelDraft({ store, code: 'VM-LEGACY', name: 'Legacy Model' });

  assert.equal(store.virtualModels.length, 1);
  assert.deepEqual(store.virtualModelVersions, []);
  assert.deepEqual(store.virtualModelAssets, []);
});

test('creating a local version rejects an unknown parent model without an orphan version', async () => {
  const store = normalizeVirtualModelLocalStore({});

  await assert.rejects(
    createVirtualModelVersion({ store, virtualModelId: 'missing-model', identityProfile: {} }),
    (error) => error?.code === 'MODEL_NOT_FOUND',
  );
  assert.deepEqual(store.virtualModelVersions, []);
});

test('creating a MySQL version locks and rejects an unknown parent before inserting', async () => {
  const events = [];
  const connection = {
    beginTransaction: async () => events.push('begin'),
    query: async (sql) => {
      if (sql.startsWith('SELECT id FROM virtual_models')) return [[]];
      if (sql.startsWith('INSERT')) events.push('insert');
      throw new Error(`Unexpected query: ${sql}`);
    },
    commit: async () => events.push('commit'),
    rollback: async () => events.push('rollback'),
    release: () => events.push('release'),
  };
  const pool = {
    getConnection: async () => connection,
    query: async (sql) => {
      if (sql.startsWith('SELECT COALESCE')) return [[{ highest: 0 }]];
      if (sql.startsWith('INSERT')) events.push('unlocked-insert');
      return [{ affectedRows: 1 }];
    },
  };

  await assert.rejects(
    createVirtualModelVersion({ pool, virtualModelId: 'missing-model', identityProfile: {} }),
    (error) => error?.code === 'MODEL_NOT_FOUND',
  );
  assert.deepEqual(events, ['begin', 'rollback', 'release']);
});

test('publishing requires eight unique slots and one primary front image', () => {
  assert.equal(validateVirtualModelVersionForPublish({ assets, identityProfile: {} }).ok, true);
  assert.equal(validateVirtualModelVersionForPublish({ assets: assets.slice(0, 7), identityProfile: {} }).ok, false);
  assert.equal(validateVirtualModelVersionForPublish({ assets: [{ ...assets[0], isPrimary: false }, ...assets.slice(1)], identityProfile: {} }).ok, false);
  assert.equal(validateVirtualModelVersionForPublish({ assets: [assets[0], { ...assets[1], isPrimary: true }, ...assets.slice(2)], identityProfile: {} }).ok, false);
});

test('public model mapping omits audit and sorting fields', async () => {
  const models = await listPublishedVirtualModels({
    store: {
      virtualModels: [{ id: 'model-1', code: 'VM-1', name: 'Model 1', tags: [], status: 'published', currentVersionId: 'version-1', createdAt: 1, updatedAt: 2 }],
      virtualModelVersions: [{ id: 'version-1', virtualModelId: 'model-1', versionNumber: 1, identityProfile: {}, status: 'published', createdBy: 'admin-1', createdAt: 3 }],
      virtualModelAssets: assets.map((asset) => ({ ...asset, virtualModelVersionId: 'version-1', publicUrl: `/api/assets/file/${asset.assetId}` })),
    },
  });
  assert.equal('createdBy' in models[0].version, false);
  assert.equal('createdAt' in models[0], false);
  assert.equal('updatedAt' in models[0], false);
  assert.equal('createdAt' in models[0].version, false);
});

test('public model summary exposes only a separately stored primary preview URL', async () => {
  const originalUrl = '/api/assets/file/original-front-close/source.png';
  const previewUrl = '/api/assets/file/preview-front-close/preview.jpg';
  const models = await listPublishedVirtualModels({
    store: {
      virtualModels: [{ id: 'model-1', code: 'VM-1', name: 'Model 1', tags: [], status: 'published', currentVersionId: 'version-1' }],
      virtualModelVersions: [{ id: 'version-1', virtualModelId: 'model-1', versionNumber: 1, identityProfile: {}, status: 'published', publishedAt: 1 }],
      virtualModelAssets: assets.map((asset) => ({
        ...asset,
        virtualModelVersionId: 'version-1',
        publicUrl: `${originalUrl}?slot=${asset.slot}`,
        ...(asset.isPrimary ? { previewAssetId: 'preview-front-close', previewUrl } : {}),
      })),
    },
  });

  assert.equal(models[0].coverUrl, previewUrl);
  assert.equal(models[0].version.thumbnailUrl, previewUrl);
  assert.equal(JSON.stringify(models[0]).includes('original-front-close'), false);
  assert.equal(JSON.stringify(models[0]).includes('stored-0'), false);
  assert.equal('assetId' in models[0], false);
  assert.equal('publicUrl' in models[0], false);
});

test('deleting a local model hides it from lists while preserving its versions and assets', async () => {
  const store = normalizeVirtualModelLocalStore({
    virtualModels: [{ id: 'model-1', code: 'VM-1', name: 'Model 1', tags: [], status: 'published', currentVersionId: 'version-1', updatedAt: 1 }],
    virtualModelVersions: [{ id: 'version-1', virtualModelId: 'model-1', versionNumber: 1, identityProfile: {}, status: 'published', publishedAt: 1 }],
    virtualModelAssets: assets.map((asset) => ({ ...asset, virtualModelVersionId: 'version-1', publicUrl: `/api/assets/file/${asset.assetId}` })),
  });

  assert.deepEqual(await deleteVirtualModel({ store, virtualModelId: 'model-1' }), { ok: true });
  assert.equal(store.virtualModels[0].status, 'deleted');
  assert.equal(store.virtualModels[0].currentVersionId, null);
  assert.equal(store.virtualModelVersions.length, 1);
  assert.equal(store.virtualModelAssets.length, 8);
  assert.deepEqual(await listAdminVirtualModels({ store, status: 'all' }), []);
  assert.deepEqual(await listPublishedVirtualModels({ store }), []);
});

test('deleting a missing or already deleted local model returns MODEL_NOT_FOUND', async () => {
  const store = normalizeVirtualModelLocalStore({
    virtualModels: [{ id: 'deleted-model', status: 'deleted', currentVersionId: null }],
  });

  await assert.rejects(
    deleteVirtualModel({ store, virtualModelId: 'missing-model' }),
    (error) => error?.code === 'MODEL_NOT_FOUND',
  );
  await assert.rejects(
    deleteVirtualModel({ store, virtualModelId: 'deleted-model' }),
    (error) => error?.code === 'MODEL_NOT_FOUND',
  );
});

test('deleting a MySQL model uses one conditional soft-delete update and rejects no-op updates', async () => {
  const calls = [];
  const pool = {
    query: async (sql, params) => {
      calls.push({ sql, params });
      return [{ affectedRows: calls.length === 1 ? 1 : 0 }];
    },
  };

  assert.deepEqual(await deleteVirtualModel({ pool, virtualModelId: 'model-1' }), { ok: true });
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /UPDATE virtual_models SET status = 'deleted', current_version_id = NULL, updated_at = \? WHERE id = \? AND status <> 'deleted'/);
  assert.equal(calls[0].params[1], 'model-1');
  await assert.rejects(
    deleteVirtualModel({ pool, virtualModelId: 'model-1' }),
    (error) => error?.code === 'MODEL_NOT_FOUND',
  );
  assert.equal(calls.length, 2);
});

test('admin all-model listings exclude deleted models in local and MySQL storage', async () => {
  const localModels = await listAdminVirtualModels({
    store: {
      virtualModels: [
        { id: 'active-model', status: 'draft', updatedAt: 2 },
        { id: 'deleted-model', status: 'deleted', updatedAt: 3 },
      ],
    },
    status: 'all',
  });
  assert.deepEqual(localModels.map((model) => model.id), ['active-model']);

  const calls = [];
  const pool = {
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (sql.includes('FROM virtual_models')) return [[{ id: 'active-model', status: 'draft', updated_at: 2 }]];
      return [[]];
    },
  };
  const mysqlModels = await listAdminVirtualModels({ pool, status: 'all' });
  assert.deepEqual(mysqlModels.map((model) => model.id), ['active-model']);
  assert.match(calls[0].sql, /WHERE status <> 'deleted'/);
  assert.deepEqual(calls[0].params, []);
});

test('admin listings prefer the newest editable draft over the currently published version', async () => {
  const models = await listAdminVirtualModels({
    store: {
      virtualModels: [{
        id: 'model-1',
        code: 'VM-1',
        name: 'Model',
        tags: [],
        status: 'published',
        currentVersionId: 'version-1',
        createdAt: 1,
        updatedAt: 3,
      }],
      virtualModelVersions: [
        { id: 'version-1', virtualModelId: 'model-1', versionNumber: 1, identityProfile: { description: 'published' }, status: 'published', publishedAt: 2, createdAt: 1 },
        { id: 'version-2', virtualModelId: 'model-1', versionNumber: 2, identityProfile: { description: 'draft' }, status: 'draft', publishedAt: null, createdAt: 3 },
      ],
      virtualModelAssets: [],
    },
  });

  assert.equal(models[0].version.id, 'version-2');
  assert.equal(models[0].version.status, 'draft');
});

test('all local lifecycle writes reject a deleted model without mutation', async () => {
  const store = normalizeVirtualModelLocalStore({
    virtualModels: [{ id: 'model-1', code: 'VM-1', name: 'Deleted', tags: [], status: 'deleted', currentVersionId: null, updatedAt: 1 }],
    virtualModelVersions: [{ id: 'version-1', virtualModelId: 'model-1', versionNumber: 1, identityProfile: {}, status: 'draft', publishedAt: null }],
    virtualModelAssets: assets.map((asset) => ({ ...asset, virtualModelVersionId: 'version-1' })),
  });
  const originalStore = structuredClone(store);
  const writes = [
    () => updateVirtualModelDraft({ store, virtualModelId: 'model-1', name: 'Changed' }),
    () => createVirtualModelVersion({ store, virtualModelId: 'model-1', identityProfile: {} }),
    () => replaceDraftVersionAssets({ store, virtualModelVersionId: 'version-1', assets: assets.map((asset) => ({ ...asset, assetId: `replacement-${asset.assetId}` })) }),
    () => publishVirtualModelVersion({ store, virtualModelId: 'model-1', virtualModelVersionId: 'version-1' }),
    () => unpublishVirtualModel({ store, virtualModelId: 'model-1' }),
  ];

  for (const write of writes) {
    await assert.rejects(write(), (error) => error?.code === 'MODEL_NOT_FOUND');
    assert.deepEqual(store, originalStore);
  }
});

test('local publish and asset replacement identify a deleted parent consistently', async () => {
  const store = normalizeVirtualModelLocalStore({
    virtualModels: [{ id: 'model-1', status: 'deleted' }],
    virtualModelVersions: [{ id: 'version-1', virtualModelId: 'model-1', identityProfile: {}, status: 'draft', publishedAt: null }],
    virtualModelAssets: assets.map((asset) => ({ ...asset, virtualModelVersionId: 'version-1' })),
  });

  for (const write of [
    () => publishVirtualModelVersion({ store, virtualModelId: 'model-1', virtualModelVersionId: 'version-1' }),
    () => replaceDraftVersionAssets({ store, virtualModelVersionId: 'version-1', assets }),
  ]) {
    await assert.rejects(
      write(),
      (error) => error?.code === 'MODEL_NOT_FOUND' && error.message === 'Virtual model not found',
    );
  }
});

test('deletion preserves a published snapshot for historical replay only', async () => {
  const store = normalizeVirtualModelLocalStore({});
  const model = await createVirtualModelDraft({ store, code: 'VM-HISTORY', name: 'Historical Model' });
  const version = await createVirtualModelVersion({ store, virtualModelId: model.id, identityProfile: {} });
  await replaceDraftVersionAssets({ store, virtualModelId: model.id, virtualModelVersionId: version.id, assets });
  await publishVirtualModelVersion({ store, virtualModelId: model.id, virtualModelVersionId: version.id });
  const snapshot = await createVirtualModelGenerationJobSnapshot({ store, virtualModelId: model.id, virtualModelVersionId: version.id });

  await deleteVirtualModel({ store, virtualModelId: model.id });

  await assert.rejects(
    createVirtualModelGenerationJobSnapshot({ store, virtualModelId: model.id, virtualModelVersionId: version.id }),
    (error) => error?.code === 'MODEL_NOT_PUBLISHED',
  );
  assert.deepEqual(
    await createVirtualModelGenerationJobSnapshot({
      store,
      virtualModelId: model.id,
      virtualModelVersionId: version.id,
      allowHistoricalPublishedVersion: true,
      publishedAt: snapshot.publishedAt,
      selectedAssetIds: snapshot.selectedAssetIds,
    }),
    { ...snapshot, identitySelectionStrategy: 'historical_snapshot' },
  );
  assert.equal(store.virtualModelVersions.length, 1);
  assert.equal(store.virtualModelAssets.length, assets.length);
});

test('MySQL historical replay preserves a deleted model snapshot while normal selection rejects it', async () => {
  const publishedAt = 12345;
  const selectedAssetIds = assets.slice(0, 3).map((asset) => asset.assetId);
  const calls = [];
  const pool = {
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (sql === "SELECT * FROM virtual_models WHERE id = ? AND status = 'published' AND current_version_id = ?") {
        assert.deepEqual(params, ['model-1', 'version-1']);
        return [[]];
      }
      if (sql === 'SELECT * FROM virtual_models WHERE id = ?') {
        assert.deepEqual(params, ['model-1']);
        return [[{ id: 'model-1', code: 'VM-HISTORY', name: 'Historical Model', tags_json: '[]', status: 'deleted', current_version_id: null }]];
      }
      if (sql === 'SELECT * FROM virtual_model_versions WHERE id = ? AND virtual_model_id = ? AND published_at = ?') {
        assert.deepEqual(params, ['version-1', 'model-1', publishedAt]);
        return [[{ id: 'version-1', virtual_model_id: 'model-1', version_number: 1, identity_profile_json: '{}', status: 'published', published_at: publishedAt }]];
      }
      if (sql === 'SELECT * FROM virtual_model_assets WHERE virtual_model_version_id = ?') {
        assert.deepEqual(params, ['version-1']);
        return [assets.map((asset) => ({ ...asset, virtual_model_version_id: 'version-1' }))];
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };

  await assert.rejects(
    createVirtualModelGenerationJobSnapshot({ pool, virtualModelId: 'model-1', virtualModelVersionId: 'version-1' }),
    (error) => error?.code === 'MODEL_NOT_PUBLISHED',
  );
  const historical = await createVirtualModelGenerationJobSnapshot({
    pool,
    virtualModelId: 'model-1',
    virtualModelVersionId: 'version-1',
    allowHistoricalPublishedVersion: true,
    publishedAt,
    selectedAssetIds,
  });
  assert.deepEqual(historical.selectedAssetIds, selectedAssetIds);
  assert.equal(historical.publishedAt, publishedAt);
  assert.deepEqual(calls.map(({ sql }) => sql), [
    "SELECT * FROM virtual_models WHERE id = ? AND status = 'published' AND current_version_id = ?",
    'SELECT * FROM virtual_models WHERE id = ?',
    'SELECT * FROM virtual_model_versions WHERE id = ? AND virtual_model_id = ? AND published_at = ?',
    'SELECT * FROM virtual_model_assets WHERE virtual_model_version_id = ?',
  ]);
});

test('MySQL draft update excludes deleted models in both read and conditional write', async () => {
  const calls = [];
  const pool = {
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (sql.startsWith('SELECT')) return [[{ id: 'model-1', code: 'VM-1', name: 'Model', tags_json: '[]', status: 'draft' }]];
      return [{ affectedRows: 0 }];
    },
  };

  await assert.rejects(
    updateVirtualModelDraft({ pool, virtualModelId: 'model-1', name: 'Changed' }),
    (error) => error?.code === 'MODEL_NOT_FOUND',
  );
  assert.match(calls[0].sql, /WHERE id = \? AND status <> 'deleted'/);
  assert.match(calls[1].sql, /WHERE id = \? AND status <> 'deleted'/);
});

test('MySQL version creation locks an active parent and rejects a deleted parent', async () => {
  const calls = [];
  const connection = {
    beginTransaction: async () => {},
    query: async (sql, params) => { calls.push({ sql, params }); return [[]]; },
    commit: async () => {},
    rollback: async () => {},
    release: () => {},
  };

  await assert.rejects(
    createVirtualModelVersion({ pool: { getConnection: async () => connection }, virtualModelId: 'deleted-model' }),
    (error) => error?.code === 'MODEL_NOT_FOUND',
  );
  assert.match(calls[0].sql, /WHERE id = \? AND status <> 'deleted' FOR UPDATE/);
});

test('MySQL asset replacement locks and rejects a version whose parent is deleted before mutation', async () => {
  const events = [];
  const connection = {
    beginTransaction: async () => events.push('begin'),
    query: async (sql, params) => {
      events.push({ sql, params });
      if (/^SELECT v\.status/.test(sql) && /JOIN virtual_models m/.test(sql) && /m\.status <> 'deleted'/.test(sql) && /FOR UPDATE$/.test(sql)) {
        assert.deepEqual(params, ['version-1']);
        return [[]];
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
    commit: async () => events.push('commit'),
    rollback: async () => events.push('rollback'),
    release: () => events.push('release'),
  };

  await assert.rejects(
    replaceDraftVersionAssets({ pool: { getConnection: async () => connection }, virtualModelVersionId: 'version-1', assets }),
    (error) => error?.code === 'MODEL_NOT_FOUND' && error.message === 'Virtual model not found',
  );
  assert.deepEqual(events.map((event) => typeof event === 'string' ? event : event.sql), [
    'begin',
    events[1].sql,
    'rollback',
    'release',
  ]);
});

test('MySQL publish locks and rejects a deleted parent', async () => {
  const calls = [];
  const connection = {
    beginTransaction: async () => {},
    query: async (sql, params) => { calls.push({ sql, params }); return [[]]; },
    commit: async () => {},
    rollback: async () => {},
    release: () => {},
  };

  await assert.rejects(
    publishVirtualModelVersion({ pool: { getConnection: async () => connection }, virtualModelId: 'deleted-model', virtualModelVersionId: 'version-1' }),
    (error) => error?.code === 'MODEL_NOT_FOUND',
  );
  assert.match(calls[0].sql, /WHERE id = \? AND status <> 'deleted' FOR UPDATE/);
});

test('MySQL publish conditionally updates the locked active parent', async () => {
  const calls = [];
  const connection = {
    beginTransaction: async () => {},
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (sql.startsWith('SELECT id FROM virtual_models')) return [[{ id: 'model-1' }]];
      if (sql.startsWith('SELECT * FROM virtual_model_versions')) return [[{ id: 'version-1', virtual_model_id: 'model-1', identity_profile_json: '{}', status: 'draft' }]];
      if (sql.startsWith('SELECT * FROM virtual_model_assets')) return [assets.map((asset) => ({ ...asset, virtual_model_version_id: 'version-1' }))];
      return [{ affectedRows: 1 }];
    },
    commit: async () => {},
    rollback: async () => {},
    release: () => {},
  };

  assert.equal((await publishVirtualModelVersion({ pool: { getConnection: async () => connection }, virtualModelId: 'model-1', virtualModelVersionId: 'version-1' })).ok, true);
  const modelUpdate = calls.find(({ sql }) => sql.startsWith('UPDATE virtual_models'));
  assert.match(modelUpdate.sql, /WHERE id = \? AND status <> 'deleted'/);
});

test('MySQL publish rolls back when deletion wins before the guarded parent update', async () => {
  const events = [];
  const connection = {
    beginTransaction: async () => events.push('begin'),
    query: async (sql, params) => {
      events.push({ sql, params });
      if (sql.startsWith('SELECT id FROM virtual_models')) return [[{ id: 'model-1' }]];
      if (sql.startsWith('SELECT * FROM virtual_model_versions')) return [[{ id: 'version-1', virtual_model_id: 'model-1', identity_profile_json: '{}', status: 'draft' }]];
      if (sql.startsWith('SELECT * FROM virtual_model_assets')) return [assets.map((asset) => ({ ...asset, virtual_model_version_id: 'version-1' }))];
      if (sql.startsWith('UPDATE virtual_model_versions')) return [{ affectedRows: 1 }];
      if (sql.startsWith('UPDATE virtual_models') && /WHERE id = \? AND status <> 'deleted'/.test(sql)) return [{ affectedRows: 0 }];
      throw new Error(`Unexpected query: ${sql}`);
    },
    commit: async () => events.push('commit'),
    rollback: async () => events.push('rollback'),
    release: () => events.push('release'),
  };

  await assert.rejects(
    publishVirtualModelVersion({ pool: { getConnection: async () => connection }, virtualModelId: 'model-1', virtualModelVersionId: 'version-1' }),
    (error) => error?.code === 'MODEL_NOT_FOUND' && error.message === 'Virtual model not found',
  );
  assert.equal(events.includes('commit'), false);
  assert.deepEqual(events.slice(-2), ['rollback', 'release']);
  assert.equal(events.filter((event) => typeof event === 'object' && event.sql.startsWith('UPDATE virtual_model_versions')).length, 2);
});

test('MySQL unpublish conditionally rejects a deleted model', async () => {
  const calls = [];
  const pool = { query: async (sql, params) => { calls.push({ sql, params }); return [{ affectedRows: 0 }]; } };

  await assert.rejects(
    unpublishVirtualModel({ pool, virtualModelId: 'deleted-model' }),
    (error) => error?.code === 'MODEL_NOT_FOUND',
  );
  assert.match(calls[0].sql, /WHERE id = \? AND status <> 'deleted'/);
});

test('replacing local draft assets updates the caller store', async () => {
  const store = normalizeVirtualModelLocalStore({});
  const model = await createVirtualModelDraft({ store, code: 'VM-1', name: 'Model 1' });
  const version = await createVirtualModelVersion({ store, virtualModelId: model.id, identityProfile: {} });

  await replaceDraftVersionAssets({
    store,
    virtualModelVersionId: version.id,
    assets: assets.map((asset) => ({ ...asset, publicUrl: `/api/assets/file/${asset.assetId}` })),
  });

  assert.equal(store.virtualModelAssets.length, 8);
  assert.deepEqual(store.virtualModelAssets.map((asset) => asset.slot), slots);
});

test('asset replacement rejects a version owned by another local model without mutation', async () => {
  const store = normalizeVirtualModelLocalStore({
    virtualModels: [{ id: 'model-1' }, { id: 'model-2' }],
    virtualModelVersions: [{ id: 'version-2', virtualModelId: 'model-2', status: 'draft', publishedAt: null }],
    virtualModelAssets: assets.map((asset) => ({ ...asset, virtualModelVersionId: 'version-2' })),
  });
  const originalAssets = structuredClone(store.virtualModelAssets);

  await assert.rejects(
    replaceDraftVersionAssets({ store, virtualModelId: 'model-1', virtualModelVersionId: 'version-2', assets }),
    (error) => error?.code === 'MODEL_NOT_FOUND',
  );
  assert.deepEqual(store.virtualModelAssets, originalAssets);
});

test('replacing published version assets is rejected without modifying assets', async () => {
  const store = normalizeVirtualModelLocalStore({
    virtualModels: [{ id: 'model-1', status: 'unpublished' }],
    virtualModelVersions: [{ id: 'version-1', virtualModelId: 'model-1', status: 'published' }],
    virtualModelAssets: assets.map((asset) => ({ ...asset, virtualModelVersionId: 'version-1' })),
  });
  const originalAssets = structuredClone(store.virtualModelAssets);

  await assert.rejects(
    replaceDraftVersionAssets({
      store,
      virtualModelVersionId: 'version-1',
      assets: assets.map((asset) => ({ ...asset, assetId: `replacement-${asset.assetId}` })),
    }),
    (error) => error?.code === 'MODEL_VERSION_IMMUTABLE',
  );
  assert.deepEqual(store.virtualModelAssets, originalAssets);
});

test('invalid local asset replacement leaves existing assets unchanged', async () => {
  const store = normalizeVirtualModelLocalStore({
    virtualModels: [{ id: 'model-1', status: 'draft' }],
    virtualModelVersions: [{ id: 'version-1', virtualModelId: 'model-1', status: 'draft' }],
    virtualModelAssets: assets.map((asset) => ({ ...asset, virtualModelVersionId: 'version-1' })),
  });
  const originalAssets = structuredClone(store.virtualModelAssets);

  await assert.rejects(
    replaceDraftVersionAssets({ store, virtualModelVersionId: 'version-1', assets: [{ slot: 'front_close' }] }),
    (error) => error?.code === 'MODEL_ASSET_INVALID',
  );
  assert.deepEqual(store.virtualModelAssets, originalAssets);
});

test('mysql asset replacement rolls back when an insert fails', async () => {
  const events = [];
  const connection = {
    beginTransaction: async () => events.push('begin'),
    query: async (sql) => {
      if (sql.startsWith('SELECT v.status')) return [[{ virtual_model_id: 'model-1', status: 'draft' }]];
      if (sql.startsWith('DELETE')) {
        events.push('delete');
        return [{ affectedRows: 8 }];
      }
      if (sql.startsWith('INSERT')) {
        events.push('insert');
        throw new Error('insert failed');
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
    commit: async () => events.push('commit'),
    rollback: async () => events.push('rollback'),
    release: () => events.push('release'),
  };
  const pool = { getConnection: async () => connection };

  await assert.rejects(
    replaceDraftVersionAssets({ pool, virtualModelVersionId: 'version-1', assets }),
    /insert failed/,
  );
  assert.deepEqual(events, ['begin', 'delete', 'insert', 'rollback', 'release']);
});

test('asset replacement rejects a version owned by another MySQL model before deleting assets', async () => {
  const events = [];
  const connection = {
    beginTransaction: async () => events.push('begin'),
    query: async (sql) => {
      if (sql.startsWith('SELECT')) return [[{ virtual_model_id: 'model-2', status: 'draft', published_at: null }]];
      if (sql.startsWith('DELETE')) events.push('delete');
      throw new Error(`Unexpected query: ${sql}`);
    },
    commit: async () => events.push('commit'),
    rollback: async () => events.push('rollback'),
    release: () => events.push('release'),
  };

  await assert.rejects(
    replaceDraftVersionAssets({ pool: { getConnection: async () => connection }, virtualModelId: 'model-1', virtualModelVersionId: 'version-2', assets }),
    (error) => error?.code === 'MODEL_NOT_FOUND',
  );
  assert.deepEqual(events, ['begin', 'rollback', 'release']);
});

test('a previously published MySQL version remains immutable after unpublishing', async () => {
  const events = [];
  const connection = {
    beginTransaction: async () => events.push('begin'),
    query: async (sql) => {
      if (sql.startsWith('SELECT v.status')) return [[{ virtual_model_id: 'model-1', status: 'unpublished', published_at: 123 }]];
      if (sql.startsWith('DELETE')) events.push('delete');
      throw new Error(`Unexpected query: ${sql}`);
    },
    commit: async () => events.push('commit'),
    rollback: async () => events.push('rollback'),
    release: () => events.push('release'),
  };

  await assert.rejects(
    replaceDraftVersionAssets({ pool: { getConnection: async () => connection }, virtualModelId: 'model-1', virtualModelVersionId: 'version-1', assets }),
    (error) => error?.code === 'MODEL_VERSION_IMMUTABLE',
  );
  assert.deepEqual(events, ['begin', 'rollback', 'release']);
});

test('a local version remains immutable after a newer version is published', async () => {
  const store = normalizeVirtualModelLocalStore({});
  const model = await createVirtualModelDraft({ store, code: 'VM-IMMUTABLE', name: 'Immutable' });
  const firstVersion = await createVirtualModelVersion({ store, virtualModelId: model.id, identityProfile: {} });
  await replaceDraftVersionAssets({ store, virtualModelId: model.id, virtualModelVersionId: firstVersion.id, assets });
  assert.equal((await publishVirtualModelVersion({ store, virtualModelId: model.id, virtualModelVersionId: firstVersion.id })).ok, true);
  const newerVersion = await createVirtualModelVersion({ store, virtualModelId: model.id, identityProfile: {} });
  await replaceDraftVersionAssets({ store, virtualModelId: model.id, virtualModelVersionId: newerVersion.id, assets });
  assert.equal((await publishVirtualModelVersion({ store, virtualModelId: model.id, virtualModelVersionId: newerVersion.id })).ok, true);

  await assert.rejects(
    replaceDraftVersionAssets({ store, virtualModelId: model.id, virtualModelVersionId: firstVersion.id, assets }),
    (error) => error?.code === 'MODEL_VERSION_IMMUTABLE',
  );
});

test('MySQL unpublish rejects an unknown model', async () => {
  const pool = { query: async () => [{ affectedRows: 0 }] };

  await assert.rejects(
    unpublishVirtualModel({ pool, virtualModelId: 'missing-model' }),
    (error) => error?.code === 'MODEL_NOT_FOUND',
  );
});

test('mysql publishing rejects a missing model before changing versions', async () => {
  const events = [];
  const connection = {
    beginTransaction: async () => events.push('begin'),
    query: async (sql) => {
      if (sql.startsWith('SELECT id FROM virtual_models')) return [[]];
      throw new Error(`Unexpected query: ${sql}`);
    },
    commit: async () => events.push('commit'),
    rollback: async () => events.push('rollback'),
    release: () => events.push('release'),
  };
  const pool = { getConnection: async () => connection };

  await assert.rejects(
    publishVirtualModelVersion({ pool, virtualModelId: 'missing-model', virtualModelVersionId: 'version-1' }),
    (error) => error?.code === 'MODEL_NOT_FOUND',
  );
  assert.deepEqual(events, ['begin', 'rollback', 'release']);
});

test('mysql publishing rejects a version owned by another model without updates', async () => {
  const events = [];
  const connection = {
    beginTransaction: async () => events.push('begin'),
    query: async (sql) => {
      if (sql.startsWith('SELECT id FROM virtual_models')) return [[{ id: 'model-1' }]];
      if (sql.startsWith('SELECT * FROM virtual_model_versions')) return [[]];
      if (sql.startsWith('UPDATE')) events.push('update');
      throw new Error(`Unexpected query: ${sql}`);
    },
    commit: async () => events.push('commit'),
    rollback: async () => events.push('rollback'),
    release: () => events.push('release'),
  };
  const pool = { getConnection: async () => connection };

  await assert.rejects(
    publishVirtualModelVersion({ pool, virtualModelId: 'model-1', virtualModelVersionId: 'other-model-version' }),
    (error) => error?.code === 'MODEL_NOT_FOUND',
  );
  assert.deepEqual(events, ['begin', 'rollback', 'release']);
});
