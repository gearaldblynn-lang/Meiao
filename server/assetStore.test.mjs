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
