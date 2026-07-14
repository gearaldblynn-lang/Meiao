import test from 'node:test';
import assert from 'node:assert/strict';

import * as assetStore from './assetStore.mjs';

const {
  ASSET_RETENTION_MS,
  buildAssetPublicPath,
  buildAssetPublicUrl,
  ensureAssetSchema,
  deleteStoredAssetFile,
  extractStoredAssetIdFromPublicUrl,
  fetchRemoteAssetBufferWithRetry,
  getPublicBaseUrl,
  getStoredAssetById,
  markStoredAssetStorageStatus,
  optimizeMp4BufferForStreaming,
  persistAssetBuffer,
  persistUploadedAssetBuffer,
  requestStoredAssetDeletion,
  sanitizeAssetName,
  shouldRetainAssetRecord,
  selectExpiredAssetsForCleanup,
  collectStoredAssetIdsFromValue,
} = assetStore;

test('inline image result is decoded and replaced by a managed asset URL', async () => {
  assert.equal(typeof assetStore.persistInlineImageResult, 'function');
  const calls = [];
  const result = await assetStore.persistInlineImageResult({
    result: {
      imageUrl: 'data:image/png;base64,aGVsbG8=',
      providerResponseFormat: 'b64_json',
    },
    persistAsset: async (options) => {
      calls.push(options);
      return {
        id: 'asset-1',
        publicUrl: '/api/assets/file/asset-1/result.png',
      };
    },
    persistOptions: {
      publicBaseUrl: 'https://meiao.test',
      userId: 'user-1',
      originalName: 'result.png',
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].mimeType, 'image/png');
  assert.equal(calls[0].fileBuffer.toString('utf8'), 'hello');
  assert.equal(result.imageUrl, '/api/assets/file/asset-1/result.png');
  assert.equal(result.imageUrlAssetId, 'asset-1');
  assert.equal(result.providerResponseFormat, 'b64_json');
  assert.doesNotMatch(JSON.stringify(result), /aGVsbG8=/);
});

test('remote image result bypasses inline persistence unchanged', async () => {
  let calls = 0;
  const original = {
    imageUrl: 'https://cdn.test/result.png',
    providerResponseFormat: 'url',
  };
  const result = await assetStore.persistInlineImageResult({
    result: original,
    persistAsset: async () => {
      calls += 1;
      return {};
    },
  });

  assert.equal(calls, 0);
  assert.deepEqual(result, original);
  assert.notEqual(result, original);
});

test('malformed inline image result fails without persisting raw data', async () => {
  await assert.rejects(
    () => assetStore.persistInlineImageResult({
      result: { imageUrl: 'data:image/png;base64,not-valid!' },
      persistAsset: async () => {
        throw new Error('must not persist');
      },
    }),
    (error) => error?.code === 'provider_bad_response'
      && error?.providerStage === 'provider_response'
      && !/not-valid/.test(error?.message || ''),
  );
});

test('fetchRemoteAssetBufferWithRetry retries a terminated response body read', async () => {
  let calls = 0;
  const result = await fetchRemoteAssetBufferWithRetry('https://cdn.example.com/result.png', {
    retries: 1,
    retryBaseMs: 0,
    fetchImpl: async () => {
      calls += 1;
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'image/png' }),
        body: null,
        arrayBuffer: async () => {
          if (calls === 1) throw new TypeError('terminated');
          return Buffer.from('png');
        },
      };
    },
  });

  assert.equal(calls, 2);
  assert.equal(result.contentType, 'image/png');
  assert.equal(result.fileBuffer.toString(), 'png');
});

test('fetchRemoteAssetBufferWithRetry does not retry a permanent 404', async () => {
  let calls = 0;
  await assert.rejects(
    fetchRemoteAssetBufferWithRetry('https://cdn.example.com/missing.png', {
      retries: 2,
      retryBaseMs: 0,
      fetchImpl: async () => {
        calls += 1;
        return new Response('missing', { status: 404 });
      },
    }),
    (error) => error?.providerStage === 'asset_download'
      && error?.providerStatus === 'http_404',
  );
  assert.equal(calls, 1);
});

const atom = (type, payload = Buffer.alloc(0)) => {
  const output = Buffer.alloc(8 + payload.length);
  output.writeUInt32BE(output.length, 0);
  output.write(type, 4, 4, 'latin1');
  payload.copy(output, 8);
  return output;
};

const findAtomOffset = (buffer, type) => buffer.indexOf(Buffer.from(type, 'latin1'));

test('sanitizeAssetName keeps extension and removes unsafe chars', () => {
  assert.equal(sanitizeAssetName('海报 图(1).png'), '_____1_.png');
  assert.equal(sanitizeAssetName('abc.jpg'), 'abc.jpg');
});

test('buildAssetPublicUrl returns internal absolute asset route', () => {
  assert.equal(buildAssetPublicPath('asset_123', 'poster.jpg'), '/api/assets/file/asset_123/poster.jpg');
  assert.equal(
    buildAssetPublicUrl('https://meiao.example.com', 'asset_123', 'poster.jpg'),
    'https://meiao.example.com/api/assets/file/asset_123/poster.jpg'
  );
});

test('extractStoredAssetIdFromPublicUrl reads managed asset ids from relative and absolute urls', () => {
  assert.equal(extractStoredAssetIdFromPublicUrl('/api/assets/file/asset_123/poster.jpg'), 'asset_123');
  assert.equal(extractStoredAssetIdFromPublicUrl('https://meiao.example.com/api/assets/file/asset_456/poster.jpg'), 'asset_456');
  assert.equal(extractStoredAssetIdFromPublicUrl('https://example.com/not-managed/poster.jpg'), '');
});

test('getPublicBaseUrl normalizes explicit public base url', () => {
  assert.equal(
    getPublicBaseUrl({ MEIAO_PUBLIC_BASE_URL: 'https://meiao.example.com/' }),
    'https://meiao.example.com'
  );
});

test('shouldRetainAssetRecord keeps referenced or unexpired assets', () => {
  const now = Date.now();
  assert.equal(shouldRetainAssetRecord({ expiresAt: now - 1, isReferenced: false }, now), false);
  assert.equal(shouldRetainAssetRecord({ expiresAt: now + ASSET_RETENTION_MS, isReferenced: false }, now), true);
  assert.equal(shouldRetainAssetRecord({ expiresAt: now - 1, isReferenced: true }, now), true);
  assert.equal(shouldRetainAssetRecord({ expiresAt: 0, isReferenced: false }, now), true);
});

test('agent chat and generated result assets are permanent until their chat session is deleted', async () => {
  const now = Date.now();
  const rows = [
    { id: 'agent-result', module: 'agent_center', expiresAt: 0, deletedAt: null, publicUrl: 'https://a', isReferenced: false },
    { id: 'agent-source', module: 'agent_chat', expiresAt: 0, deletedAt: null, publicUrl: 'https://c', isReferenced: false },
    { id: 'old-temp', module: 'one_click', expiresAt: now - 1000, deletedAt: null, publicUrl: 'https://b', isReferenced: false },
  ];

  assert.deepEqual(
    selectExpiredAssetsForCleanup(rows, now).map((item) => item.id),
    ['old-temp']
  );

  let insertedValues = null;
  const pool = {
    query: async (_sql, values) => {
      insertedValues = values;
      return [[]];
    },
  };

  const record = await persistAssetBuffer({
    pool,
    publicBaseUrl: 'https://meiao.example.com',
    userId: 'user_agent',
    module: 'agent_chat',
    assetType: 'source',
    originalName: 'source.png',
    mimeType: 'image/png',
    fileBuffer: Buffer.from('png'),
  });

  try {
    assert.equal(record.expiresAt, 0);
    assert.equal(insertedValues?.[17], 0);
  } finally {
    await deleteStoredAssetFile(record.storageKey);
  }
});

test('collectStoredAssetIdsFromValue finds managed assets in chat message payloads', () => {
  const value = {
    attachments: [
      { url: 'https://meiao.example.com/api/assets/file/asset_img/result.png' },
      { fileUrl: '/api/assets/file/asset_file/source.png' },
    ],
    metadata: {
      imageResultUrls: ['https://meiao.example.com/api/assets/file/asset_result/out.png'],
      nested: { ignored: 'https://example.com/not-managed.png' },
    },
    content: '可查看 /api/assets/file/asset_inline/poster.jpg',
  };

  assert.deepEqual(
    collectStoredAssetIdsFromValue(value),
    ['asset_img', 'asset_file', 'asset_result', 'asset_inline']
  );
});

test('ensureAssetSchema accepts provider task ids longer than local entity ids', async () => {
  const queries = [];
  const pool = {
    query: async (sql) => {
      queries.push(String(sql));
      return [[]];
    },
  };

  await ensureAssetSchema(pool);

  assert.match(queries[0], /job_id VARCHAR\(120\) NULL/);
  assert.ok(
    queries.some((sql) => /ALTER TABLE stored_assets MODIFY COLUMN job_id VARCHAR\(120\) NULL/.test(sql)),
    'existing stored_assets.job_id column should be widened during startup migration'
  );
  assert.ok(
    queries.some((sql) => /UPDATE stored_assets\s+SET expires_at = 0\s+WHERE module IN \('agent_center', 'agent_chat'\)/s.test(sql)),
    'startup migration should make existing agent chat assets permanent'
  );
  assert.ok(
    queries.some((sql) => /storage_status/i.test(sql)),
    'stored assets need an explicit backwards-compatible storage status'
  );
  assert.ok(
    queries.some((sql) => /CREATE TABLE IF NOT EXISTS asset_cleanup_tasks/i.test(sql)),
    'startup migration should create the durable cleanup queue'
  );
});

test('legacy stored asset rows map to active storage status', async () => {
  const pool = {
    query: async () => [[{
      id: 'legacy-asset',
      user_id: 'user-1',
      storage_key: 'user-1/source/legacy.png',
      provider: 'internal',
      public_url: '/api/assets/file/legacy-asset/legacy.png',
      created_at: 1,
      updated_at: 1,
      last_accessed_at: 1,
      expires_at: 0,
      deleted_at: null,
    }]],
  };

  const asset = await getStoredAssetById(pool, 'legacy-asset');

  assert.equal(asset.storageStatus, 'active');
});

test('markStoredAssetStorageStatus persists a valid state transition', async () => {
  const calls = [];
  const pool = {
    query: async (sql, values) => {
      calls.push({ sql: String(sql), values });
      return [[]];
    },
  };

  await markStoredAssetStorageStatus(pool, 'asset-1', 'delete_pending', 1234);

  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /UPDATE stored_assets SET storage_status = \?/);
  assert.deepEqual(calls[0].values, ['delete_pending', 1234, 'asset-1']);
  await assert.rejects(
    () => markStoredAssetStorageStatus(pool, 'asset-1', 'unknown_state', 1234),
    /无效的素材存储状态/,
  );
});

test('uploaded image becomes active only after Tencent COS confirms the object', async () => {
  const created = [];
  const transitions = [];
  const uploads = [];
  const record = await persistUploadedAssetBuffer({
    publicBaseUrl: 'https://meiao.example.com',
    userId: 'user-1',
    module: 'buyer_show',
    assetType: 'source',
    originalName: 'buyer-reference.png',
    mimeType: 'image/png',
    fileBuffer: Buffer.from('png'),
    env: {
      MEIAO_MANAGED_IMAGE_UPLOAD_MODE: 'cos',
      MEIAO_IMAGE_COS_BUCKET: 'meiao-managed-images-1406860462',
      MEIAO_IMAGE_COS_REGION: 'ap-guangzhou',
    },
    deps: {
      createRecord: async (_pool, value) => {
        created.push({ ...value });
        return value;
      },
      markStatus: async (_pool, assetId, status) => transitions.push([assetId, status]),
      putCos: async (payload) => {
        uploads.push(payload);
        return {
          bucket: 'meiao-managed-images-1406860462',
          region: 'ap-guangzhou',
          storageKey: payload.storageKey,
          etag: 'etag',
        };
      },
      enqueueCleanup: async () => { throw new Error('cleanup must not be enqueued'); },
      persistLocal: async () => { throw new Error('local fallback must not run'); },
    },
  });

  assert.equal(created.length, 1);
  assert.equal(created[0].storageStatus, 'uploading');
  assert.equal(created[0].provider, 'tencent_cos');
  assert.match(created[0].storageKey, /^managed-images\/users\//);
  assert.equal(uploads.length, 1);
  assert.equal(uploads[0].storageKey, created[0].storageKey);
  assert.deepEqual(transitions, [[created[0].id, 'active']]);
  assert.equal(record.storageStatus, 'active');
  assert.equal(record.publicUrl, `https://meiao.example.com/api/assets/file/${record.id}/buyer-reference.png`);
});

test('failed COS image upload marks failure and queues exact-key cleanup without local fallback', async () => {
  const transitions = [];
  const cleanupTasks = [];
  let createdRecord = null;
  let localWrites = 0;
  const uploadError = Object.assign(new Error('COS unavailable'), { code: 'managed_image_upload_failed' });

  await assert.rejects(
    () => persistUploadedAssetBuffer({
      publicBaseUrl: 'https://meiao.example.com',
      userId: 'user-1',
      module: 'buyer_show',
      originalName: 'buyer-reference.jpg',
      mimeType: 'image/jpeg',
      fileBuffer: Buffer.from('jpg'),
      env: {
        MEIAO_MANAGED_IMAGE_UPLOAD_MODE: 'cos',
        MEIAO_IMAGE_COS_BUCKET: 'meiao-managed-images-1406860462',
        MEIAO_IMAGE_COS_REGION: 'ap-guangzhou',
      },
      deps: {
        createRecord: async (_pool, value) => {
          createdRecord = { ...value };
          return value;
        },
        markStatus: async (_pool, assetId, status) => transitions.push([assetId, status]),
        putCos: async () => { throw uploadError; },
        enqueueCleanup: async (_pool, task) => cleanupTasks.push(task),
        persistLocal: async () => { localWrites += 1; },
      },
    }),
    (error) => error === uploadError,
  );

  assert.deepEqual(transitions, [[createdRecord.id, 'upload_failed']]);
  assert.equal(cleanupTasks.length, 1);
  assert.equal(cleanupTasks[0].assetId, createdRecord.id);
  assert.equal(cleanupTasks[0].provider, 'tencent_cos');
  assert.equal(cleanupTasks[0].bucket, 'meiao-managed-images-1406860462');
  assert.equal(cleanupTasks[0].region, 'ap-guangzhou');
  assert.equal(cleanupTasks[0].storageKey, createdRecord.storageKey);
  assert.equal(cleanupTasks[0].reason, 'upload_failed');
  assert.equal(localWrites, 0);
});

test('generated results and non-image uploads retain the local persistence path', async () => {
  const calls = [];
  const result = await persistUploadedAssetBuffer({
    publicBaseUrl: 'https://meiao.example.com',
    userId: 'user-1',
    module: 'storyboard',
    assetType: 'source',
    originalName: 'brief.pdf',
    mimeType: 'application/pdf',
    fileBuffer: Buffer.from('pdf'),
    env: { MEIAO_MANAGED_IMAGE_UPLOAD_MODE: 'cos' },
    deps: {
      persistLocal: async (options) => {
        calls.push(options);
        return { id: 'local-asset', provider: 'internal', storageStatus: 'active' };
      },
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].mimeType, 'application/pdf');
  assert.equal(result.provider, 'internal');
});

test('disabled managed image upload mode rejects new images before creating metadata', async () => {
  let createCalls = 0;
  await assert.rejects(
    () => persistUploadedAssetBuffer({
      userId: 'user-1',
      originalName: 'image.png',
      mimeType: 'image/png',
      fileBuffer: Buffer.from('png'),
      env: { MEIAO_MANAGED_IMAGE_UPLOAD_MODE: 'disabled' },
      deps: {
        createRecord: async () => { createCalls += 1; },
      },
    }),
    (error) => error?.code === 'managed_image_upload_disabled'
      && error?.retryable === true,
  );
  assert.equal(createCalls, 0);
});

test('requestStoredAssetDeletion queues an exact COS object after making reads unavailable', async () => {
  const calls = [];
  const asset = {
    id: 'asset-1',
    provider: 'tencent_cos',
    storageStatus: 'active',
    storageKey: 'managed-images/users/abc/source/asset-1/image.png',
    deletedAt: null,
  };
  const result = await requestStoredAssetDeletion({
    pool: {},
    asset,
    reason: 'chat_session_deleted',
    env: {
      MEIAO_IMAGE_COS_BUCKET: 'meiao-managed-images-1406860462',
      MEIAO_IMAGE_COS_REGION: 'ap-guangzhou',
    },
    timestamp: 5000,
    deps: {
      markDeletePending: async (_pool, assetId, timestamp) => calls.push(['pending', assetId, timestamp]),
      enqueueCleanup: async (_pool, task) => calls.push(['enqueue', task]),
    },
  });

  assert.equal(result.queued, true);
  assert.deepEqual(calls[0], ['pending', 'asset-1', 5000]);
  assert.deepEqual(calls[1], ['enqueue', {
    assetId: 'asset-1',
    provider: 'tencent_cos',
    bucket: 'meiao-managed-images-1406860462',
    region: 'ap-guangzhou',
    storageKey: 'managed-images/users/abc/source/asset-1/image.png',
    action: 'delete',
    reason: 'chat_session_deleted',
  }]);
});

test('requestStoredAssetDeletion protects still-referenced assets', async () => {
  let mutationCalls = 0;
  const result = await requestStoredAssetDeletion({
    asset: {
      id: 'asset-1',
      provider: 'tencent_cos',
      storageStatus: 'active',
      storageKey: 'managed-images/users/abc/source/asset-1/image.png',
      deletedAt: null,
    },
    reason: 'project_deleted',
    isReferenced: true,
    deps: {
      markDeletePending: async () => { mutationCalls += 1; },
      enqueueCleanup: async () => { mutationCalls += 1; },
    },
  });

  assert.deepEqual(result, { queued: false, protected: true, assetId: 'asset-1' });
  assert.equal(mutationCalls, 0);
});

test('historical upstream provider labels still queue local file cleanup', async () => {
  const cleanupTasks = [];
  await requestStoredAssetDeletion({
    asset: {
      id: 'legacy-kie-result',
      provider: 'kie',
      storageStatus: 'active',
      storageKey: 'user-1/result/result.png',
      deletedAt: null,
    },
    reason: 'account_deleted',
    deps: {
      markDeletePending: async () => {},
      enqueueCleanup: async (_pool, task) => cleanupTasks.push(task),
    },
  });

  assert.equal(cleanupTasks[0].provider, 'internal');
  assert.equal(cleanupTasks[0].bucket, '');
  assert.equal(cleanupTasks[0].storageKey, 'user-1/result/result.png');
});

test('optimizeMp4BufferForStreaming moves tail moov before mdat and patches stco offsets', () => {
  const ftyp = atom('ftyp', Buffer.from('isom0000', 'latin1'));
  const mdatPayload = Buffer.alloc(24, 7);
  const mdat = atom('mdat', mdatPayload);
  const originalChunkOffset = ftyp.length + 8;
  const stcoPayload = Buffer.alloc(12);
  stcoPayload.writeUInt32BE(0, 0);
  stcoPayload.writeUInt32BE(1, 4);
  stcoPayload.writeUInt32BE(originalChunkOffset, 8);
  const stco = atom('stco', stcoPayload);
  const stbl = atom('stbl', stco);
  const minf = atom('minf', stbl);
  const mdia = atom('mdia', minf);
  const trak = atom('trak', mdia);
  const moov = atom('moov', trak);
  const input = Buffer.concat([ftyp, mdat, moov]);

  const optimized = optimizeMp4BufferForStreaming(input);

  assert.equal(optimized.length, input.length);
  assert.ok(findAtomOffset(optimized, 'moov') < findAtomOffset(optimized, 'mdat'));
  const patchedStcoOffset = optimized.indexOf(Buffer.from('stco', 'latin1')) + 12;
  assert.equal(optimized.readUInt32BE(patchedStcoOffset), originalChunkOffset + moov.length);
});
