import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, mkdir, mkdtemp, open, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import * as assetStore from './assetStore.mjs';

const PNG_FILE_BUFFER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const JPEG_FILE_BUFFER = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]);

const {
  ASSET_RETENTION_MS,
  buildAssetPublicPath,
  buildAssetPublicUrl,
  ensureAssetSchema,
  deleteStoredAssetFile,
  extractStoredAssetIdFromPublicUrl,
  fetchRemoteAssetBufferWithRetry,
  getPublicBaseUrl,
  getActiveManagedAssetRunIds,
  getStoredAssetById,
  markStoredAssetPermanent,
  markStoredAssetStorageStatus,
  optimizeMp4BufferForStreaming,
  persistAssetBuffer,
  persistAssetFile,
  persistUploadedAssetBuffer,
  requestStoredAssetDeletion,
  sanitizeAssetName,
  shouldRetainAssetRecord,
  selectExpiredAssetsForCleanup,
  selectAbandonedPermanentAgentResultAssets,
  collectStoredAssetIdsFromValue,
  writeAtomicJsonFile,
} = assetStore;

test('markStoredAssetPermanent sets expiresAt to zero for mysql and local registries', async () => {
  const mysqlCalls = [];
  await markStoredAssetPermanent({
    query: async (...args) => {
      mysqlCalls.push(args);
    },
  }, 'asset-mysql', 1234);
  assert.deepEqual(mysqlCalls, [[
    'UPDATE stored_assets SET expires_at = 0, updated_at = ? WHERE id = ?',
    [1234, 'asset-mysql'],
  ]]);

  let localAssets = [{ id: 'asset-local', expiresAt: 5678, updatedAt: 1 }];
  await markStoredAssetPermanent(null, 'asset-local', 4321, {
    mutateLocalRegistry: async (operation) => {
      await operation(localAssets);
    },
  });
  assert.deepEqual(localAssets, [{
    id: 'asset-local',
    expiresAt: 0,
    updatedAt: 4321,
  }]);
});

const testPersistDeps = async (prefix) => {
  const assetDir = await mkdtemp(path.join(tmpdir(), `${prefix}-`));
  return {
    assetDir,
    deps: {
      assetDir,
      createId: () => 'fixed-asset-id',
      now: () => 1_700_000_000_000,
    },
  };
};

test('persistAssetBuffer preserves a pre-existing wx collision and removes its own file after record failure', async () => {
  const { assetDir, deps } = await testPersistDeps('meiao-buffer-atomic');
  const target = path.join(assetDir, 'atomic-user', 'intermediate', '1700000000000', 'fixed-asset-id.mp3');
  try {
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, Buffer.from('existing'), { flag: 'w' });
    await assert.rejects(
      persistAssetBuffer({
        publicBaseUrl: 'https://meiao.example.com', userId: 'atomic-user', module: 'video', assetType: 'intermediate',
        originalName: 'tts.mp3', mimeType: 'audio/mpeg', fileBuffer: Buffer.from('new'), deps,
      }),
      (error) => error?.code === 'EEXIST',
    );
    assert.equal((await readFile(target)).toString(), 'existing');

    await assert.rejects(
      persistAssetBuffer({
        pool: { query: async () => { throw new Error('row insert failed'); } },
        publicBaseUrl: 'https://meiao.example.com', userId: 'atomic-user', module: 'video', assetType: 'intermediate',
        originalName: 'tts.mp3', mimeType: 'audio/mpeg', fileBuffer: Buffer.from('new'),
        deps: { ...deps, createId: () => 'created-then-failed' },
      }),
      /row insert failed/,
    );
    await assert.rejects(access(path.join(assetDir, 'atomic-user', 'intermediate', '1700000000000', 'created-then-failed.mp3')));
  } finally {
    await rm(assetDir, { recursive: true, force: true });
  }
});

test('persistAssetBuffer removes a partial destination when exclusive open succeeds but writing fails', async () => {
  const { assetDir, deps } = await testPersistDeps('meiao-buffer-partial-write');
  const target = path.join(assetDir, 'atomic-user', 'intermediate', '1700000000000', 'fixed-asset-id.mp3');
  let closeCalls = 0;
  try {
    await assert.rejects(
      persistAssetBuffer({
        publicBaseUrl: 'https://meiao.example.com', userId: 'atomic-user', module: 'video', assetType: 'intermediate',
        originalName: 'tts.mp3', mimeType: 'audio/mpeg', fileBuffer: Buffer.from('new'),
        deps: {
          ...deps,
          openFile: async (filePath, flags) => {
            const handle = await open(filePath, flags);
            return {
              writeFile: async () => {
                await handle.writeFile(Buffer.from('partial'));
                throw Object.assign(new Error('disk full'), { code: 'ENOSPC' });
              },
              close: async () => { closeCalls += 1; await handle.close(); },
            };
          },
        },
      }),
      (error) => error?.code === 'ENOSPC',
    );
    assert.equal(closeCalls, 1);
    await assert.rejects(access(target));
  } finally {
    await rm(assetDir, { recursive: true, force: true });
  }
});

test('buffer and streamed-file cleanup diagnostics never replace the original failure', async () => {
  const { assetDir, deps } = await testPersistDeps('meiao-cleanup-diagnostics');
  const sourceDir = await mkdtemp(path.join(tmpdir(), 'meiao-cleanup-source-'));
  const sourcePath = path.join(sourceDir, 'tts.mp3');
  const cleanupFailure = () => Object.assign(new Error('unlink denied'), { code: 'EPERM' });
  try {
    await writeFile(sourcePath, Buffer.from('new'));
    for (const operation of [
      () => persistAssetBuffer({
        pool: { query: async () => { throw Object.assign(new Error('row insert failed'), { code: 'ROW_FAILED' }); } },
        publicBaseUrl: 'https://meiao.example.com', userId: 'atomic-user', fileBuffer: Buffer.from('new'),
        deps: { ...deps, unlinkFile: async () => { throw cleanupFailure(); } },
      }),
      () => persistAssetFile({
        publicBaseUrl: 'https://meiao.example.com', userId: 'atomic-user', sourcePath, expectedSha256: '0'.repeat(64),
        deps: { ...deps, createId: () => 'streamed-cleanup-id', unlinkFile: async () => { throw cleanupFailure(); } },
      }),
    ]) {
      await assert.rejects(
        operation(),
        (error) => ['ROW_FAILED', 'managed_asset_hash_mismatch'].includes(error?.code)
          && error?.cleanupErrors?.[0]?.code === 'EPERM',
      );
    }
  } finally {
    await rm(assetDir, { recursive: true, force: true });
    await rm(sourceDir, { recursive: true, force: true });
  }
});

test('atomic JSON registry writer preserves the current registry and cleans temp files on write or rename failure', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'meiao-registry-atomic-'));
  const registryPath = path.join(directory, 'asset-registry.json');
  const tempPath = path.join(directory, '.asset-registry.json.test.tmp');
  const original = JSON.stringify({ assets: [{ id: 'existing' }] }, null, 2);
  try {
    await writeFile(registryPath, original, 'utf8');
    for (const failure of ['write', 'rename']) {
      await assert.rejects(
        writeAtomicJsonFile(registryPath, { assets: [{ id: 'replacement' }] }, {
          createTempPath: () => tempPath,
          openFile: async (filePath, flags) => {
            const handle = await open(filePath, flags);
            if (failure !== 'write') return handle;
            return {
              writeFile: async () => {
                await handle.writeFile('{"assets":');
                throw Object.assign(new Error('disk full'), { code: 'ENOSPC' });
              },
              close: () => handle.close(),
            };
          },
          renameFile: failure === 'rename'
            ? async () => { throw Object.assign(new Error('rename failed'), { code: 'EIO' }); }
            : undefined,
        }),
        (error) => error?.code === (failure === 'write' ? 'ENOSPC' : 'EIO'),
      );
      assert.equal(await readFile(registryPath, 'utf8'), original);
      await assert.rejects(access(tempPath));
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('persistAssetFile preserves a pre-existing wx collision and removes its own file after record failure', async () => {
  const { assetDir, deps } = await testPersistDeps('meiao-file-atomic');
  const sourceDir = await mkdtemp(path.join(tmpdir(), 'meiao-file-source-'));
  const sourcePath = path.join(sourceDir, 'tts.mp3');
  const target = path.join(assetDir, 'atomic-user', 'intermediate', '1700000000000', 'fixed-asset-id.mp3');
  try {
    await writeFile(sourcePath, Buffer.from('new'));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, Buffer.from('existing'), { flag: 'w' });
    await assert.rejects(
      persistAssetFile({
        publicBaseUrl: 'https://meiao.example.com', userId: 'atomic-user', module: 'video', assetType: 'intermediate',
        originalName: 'tts.mp3', mimeType: 'audio/mpeg', sourcePath, deps,
      }),
      (error) => error?.code === 'EEXIST',
    );
    assert.equal((await readFile(target)).toString(), 'existing');

    await assert.rejects(
      persistAssetFile({
        pool: { query: async () => { throw new Error('row insert failed'); } },
        publicBaseUrl: 'https://meiao.example.com', userId: 'atomic-user', module: 'video', assetType: 'intermediate',
        originalName: 'tts.mp3', mimeType: 'audio/mpeg', sourcePath,
        deps: { ...deps, createId: () => 'created-then-failed' },
      }),
      /row insert failed/,
    );
    await assert.rejects(access(path.join(assetDir, 'atomic-user', 'intermediate', '1700000000000', 'created-then-failed.mp3')));
  } finally {
    await rm(assetDir, { recursive: true, force: true });
    await rm(sourceDir, { recursive: true, force: true });
  }
});

test('empty buffers and files are rejected before an asset record can be created', async () => {
  const { assetDir, deps } = await testPersistDeps('meiao-empty-asset');
  const sourceDir = await mkdtemp(path.join(tmpdir(), 'meiao-empty-source-'));
  const sourcePath = path.join(sourceDir, 'empty.mp3');
  const inserts = [];
  try {
    await writeFile(sourcePath, Buffer.alloc(0));
    const pool = { query: async () => { inserts.push('insert'); return [[]]; } };
    for (const operation of [
      () => persistAssetBuffer({ pool, publicBaseUrl: 'https://meiao.example.com', userId: 'empty-user', fileBuffer: Buffer.alloc(0), deps }),
      () => persistAssetFile({ pool, publicBaseUrl: 'https://meiao.example.com', userId: 'empty-user', sourcePath, deps }),
      () => assetStore.persistRemoteAsset({
        publicBaseUrl: 'https://meiao.example.com', userId: 'empty-user', remoteUrl: 'https://provider.example/empty.mp3',
        deps: { downloadRemoteAsset: async () => ({ fileBuffer: Buffer.alloc(0), contentType: 'audio/mpeg' }) },
      }),
    ]) {
      await assert.rejects(operation(), (error) => error?.code === 'managed_asset_empty');
    }
    assert.deepEqual(inserts, []);
  } finally {
    await rm(assetDir, { recursive: true, force: true });
    await rm(sourceDir, { recursive: true, force: true });
  }
});

test('persistAssetFile streams a file, verifies sha256, and records explicit ttl', async () => {
  assert.equal(typeof persistAssetFile, 'function');
  const fixtureDir = await mkdtemp(path.join(tmpdir(), 'meiao-asset-store-'));
  const sourcePath = path.join(fixtureDir, 'vocals.wav');
  const contents = Buffer.from('voiceover-vocals-fixture');
  const expectedSha256 = createHash('sha256').update(contents).digest('hex');
  const expiresAt = 1_700_259_200_000;
  const inserted = [];
  await writeFile(sourcePath, contents);

  let persisted;
  try {
    persisted = await persistAssetFile({
      pool: { query: async (_sql, values) => { inserted.push(values); return [[]]; } },
      publicBaseUrl: 'http://127.0.0.1:3001',
      userId: 'task3-stream-user',
      module: 'video',
      assetType: 'intermediate',
      originalName: 'vocals.wav',
      mimeType: 'audio/wav',
      sourcePath,
      jobId: 'parent-1',
      expiresAt,
      expectedSha256,
    });

    assert.equal(persisted.contentHash, expectedSha256);
    assert.equal(persisted.expiresAt, expiresAt);
    assert.equal(persisted.jobId, 'parent-1');
    assert.equal(persisted.assetType, 'intermediate');
    assert.ok(persisted.assetType.length <= 20);
    assert.equal((await readFile(assetStore.resolveStoredAssetPath(persisted))).toString(), contents.toString());
    assert.equal(inserted.length, 1);
  } finally {
    if (persisted) await deleteStoredAssetFile(persisted.storageKey);
    await rm(fixtureDir, { recursive: true, force: true });
  }
});

test('persistAssetFile hash mismatch removes only its copied destination and creates no asset record', async () => {
  assert.equal(typeof persistAssetFile, 'function');
  const fixtureDir = await mkdtemp(path.join(tmpdir(), 'meiao-asset-store-'));
  const sourcePath = path.join(fixtureDir, 'vocals.wav');
  const inserted = [];
  await writeFile(sourcePath, Buffer.from('voiceover-vocals-fixture'));

  try {
    await assert.rejects(
      persistAssetFile({
        pool: { query: async (_sql, values) => { inserted.push(values); return [[]]; } },
        publicBaseUrl: 'http://127.0.0.1:3001',
        userId: 'task3-mismatch-user',
        module: 'video',
        assetType: 'intermediate',
        originalName: 'vocals.wav',
        mimeType: 'audio/wav',
        sourcePath,
        expectedSha256: '0'.repeat(64),
      }),
      (error) => error?.code === 'managed_asset_hash_mismatch',
    );
    assert.equal(inserted.length, 0);
  } finally {
    await rm(fixtureDir, { recursive: true, force: true });
  }
});

test('persistAssetFile stream errors leave no asset record', async () => {
  assert.equal(typeof persistAssetFile, 'function');
  const inserted = [];
  await assert.rejects(
    persistAssetFile({
      pool: { query: async (_sql, values) => { inserted.push(values); return [[]]; } },
      publicBaseUrl: 'http://127.0.0.1:3001',
      userId: 'task3-stream-error-user',
      module: 'video',
      assetType: 'intermediate',
      originalName: 'missing.wav',
      mimeType: 'audio/wav',
      sourcePath: path.join(tmpdir(), 'not-a-real-meiao-voiceover-file.wav'),
    }),
  );
  assert.equal(inserted.length, 0);
});

test('explicit server expiry applies to trusted buffer persistence without changing final video result retention', async () => {
  const before = Date.now();
  const expiresAt = 1_700_259_200_000;
  const intermediate = await persistAssetBuffer({
    pool: { query: async () => [[]] },
    publicBaseUrl: 'https://meiao.example.com',
    userId: 'task3-retention-user',
    module: 'video',
    assetType: 'intermediate',
    originalName: 'tts.mp3',
    mimeType: 'audio/mpeg',
    fileBuffer: Buffer.from('tts-audio'),
    expiresAt,
  });
  const finalResult = await persistAssetBuffer({
    pool: { query: async () => [[]] },
    publicBaseUrl: 'https://meiao.example.com',
    userId: 'task3-retention-user',
    module: 'video',
    assetType: 'result',
    originalName: 'final.mp4',
    mimeType: 'video/mp4',
    fileBuffer: Buffer.from('final-video'),
  });
  try {
    assert.equal(intermediate.expiresAt, expiresAt);
    assert.ok(finalResult.expiresAt >= before + ASSET_RETENTION_MS);
    assert.equal(finalResult.contentHash, createHash('sha256').update(Buffer.from('final-video')).digest('hex'));
  } finally {
    await deleteStoredAssetFile(intermediate.storageKey);
    await deleteStoredAssetFile(finalResult.storageKey);
  }
});

test('voiceover intermediate ttl uses a bounded environment value and falls back conservatively', () => {
  assert.equal(assetStore.getVoiceoverIntermediateTtlMs({ MEIAO_VOICEOVER_INTERMEDIATE_TTL_MS: '3600000' }), 3_600_000);
  assert.equal(assetStore.getVoiceoverIntermediateTtlMs({ MEIAO_VOICEOVER_INTERMEDIATE_TTL_MS: '1' }), ASSET_RETENTION_MS);
});

test('checkpoint asset references protect expired voiceover intermediates while unreferenced intermediates expire', () => {
  const now = 1_700_000_000_000;
  const checkpoint = {
    voiceoverCheckpoint: {
      stages: [{ vocalAssetId: 'voiceover-vocals', ttsAssetId: 'voiceover-tts-0' }],
    },
  };
  const referenced = new Set(collectStoredAssetIdsFromValue(checkpoint));
  const rows = [
    { id: 'voiceover-vocals', expiresAt: now - 1, deletedAt: null, isReferenced: referenced.has('voiceover-vocals') },
    { id: 'voiceover-tts-0', expiresAt: now - 1, deletedAt: null, isReferenced: referenced.has('voiceover-tts-0') },
    { id: 'voiceover-expired', expiresAt: now - 1, deletedAt: null, isReferenced: false },
  ];
  assert.deepEqual(selectExpiredAssetsForCleanup(rows, now).map((item) => item.id), ['voiceover-expired']);
});

test('remote audio persistence uses the downloaded content type and can retry without creating a provider task', async () => {
  const downloads = [];
  const persistedOptions = [];
  const remoteUrl = 'https://provider.example/group-0.wav';
  const persisted = await assetStore.persistRemoteAsset({
    publicBaseUrl: 'https://meiao.example.com',
    userId: 'user-1',
    module: 'video',
    assetType: 'intermediate',
    remoteUrl,
    originalName: 'kie_tts.mp3',
    provider: 'kie',
    jobId: 'voiceover-parent-1',
    expiresAt: 1_700_259_200_000,
    deps: {
      downloadRemoteAsset: async (url) => {
        downloads.push(url);
        return { fileBuffer: Buffer.from('wav-bytes'), contentType: 'audio/wav' };
      },
      persistAsset: async (options) => {
        persistedOptions.push(options);
        return { id: 'asset-audio-1', publicUrl: '/api/assets/file/asset-audio-1/kie_tts.mp3' };
      },
    },
  });

  assert.equal(downloads.length, 1);
  assert.deepEqual(downloads, [remoteUrl]);
  assert.equal(persisted.id, 'asset-audio-1');
  assert.equal(persistedOptions.length, 1);
  assert.equal(persistedOptions[0].mimeType, 'audio/wav');
  assert.equal(persistedOptions[0].providerSourceUrl, remoteUrl);
  assert.equal(persistedOptions[0].jobId, 'voiceover-parent-1');
  assert.equal(persistedOptions[0].expiresAt, 1_700_259_200_000);
});

test('remote download failure creates no persistence record', async () => {
  let persisted = 0;
  await assert.rejects(
    assetStore.persistRemoteAsset({
      remoteUrl: 'https://provider.example/missing.mp3',
      deps: {
        downloadRemoteAsset: async () => { throw Object.assign(new Error('download failed'), { code: 'provider_network_error' }); },
        persistAsset: async () => { persisted += 1; },
      },
    }),
    (error) => error?.code === 'provider_network_error',
  );
  assert.equal(persisted, 0);
});

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

test('inline image result applies the injected output transform before persistence', async () => {
  const calls = [];
  const input = await (await import('sharp')).default({
    create: { width: 20, height: 40, channels: 3, background: '#fff' },
  }).png().toBuffer();

  const result = await assetStore.persistInlineImageResult({
    result: {
      imageUrl: `data:image/png;base64,${input.toString('base64')}`,
      providerResponseFormat: 'b64_json',
    },
    transformImage: async ({ fileBuffer }) => ({
      fileBuffer,
      mimeType: 'image/jpeg',
      originalName: 'translated.jpg',
      width: 20,
      height: 40,
      assetType: 'result_quarantine',
      outputTransform: { transformSkippedReason: 'aspect_ratio_mismatch' },
    }),
    persistAsset: async (options) => {
      calls.push(options);
      return { id: 'asset-inline-1', publicUrl: '/api/assets/file/asset-inline-1/translated.jpg' };
    },
    persistOptions: {
      publicBaseUrl: 'https://meiao.test',
      userId: 'user-1',
      originalName: 'result.png',
      assetType: 'result',
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].mimeType, 'image/jpeg');
  assert.equal(calls[0].originalName, 'translated.jpg');
  assert.equal(calls[0].assetType, 'result_quarantine');
  assert.equal(calls[0].width, 20);
  assert.equal(calls[0].height, 40);
  assert.deepEqual(result.imageOutputTransform, { transformSkippedReason: 'aspect_ratio_mismatch' });
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
    fileBuffer: PNG_FILE_BUFFER,
  });

  try {
    assert.equal(record.expiresAt, 0);
    assert.equal(insertedValues?.[20], 0);
  } finally {
    await deleteStoredAssetFile(record.storageKey);
  }
});

test('old permanent agent results without a durable reference are selected as crash orphans', () => {
  const now = 10_000;
  const graceMs = 2_000;
  const rows = [
    { id: 'orphan', module: 'agent_center', assetType: 'result', storageStatus: 'active', expiresAt: 0, createdAt: 1_000, deletedAt: null, isReferenced: false },
    { id: 'fresh', module: 'agent_center', assetType: 'result', storageStatus: 'active', expiresAt: 0, createdAt: 9_000, deletedAt: null, isReferenced: false },
    { id: 'live', module: 'agent_chat', assetType: 'result', storageStatus: 'active', expiresAt: 0, createdAt: 1_000, deletedAt: null, isReferenced: true },
    { id: 'source', module: 'agent_chat', assetType: 'source', storageStatus: 'active', expiresAt: 0, createdAt: 1_000, deletedAt: null, isReferenced: false },
  ];

  assert.deepEqual(
    selectAbandonedPermanentAgentResultAssets(rows, now, graceMs).map((item) => item.id),
    ['orphan'],
  );
});

test('retry-waiting jobs protect matching result assets during active recovery', () => {
  const activeRunIds = getActiveManagedAssetRunIds({
    id: 'job-recovering',
    status: 'retry_waiting',
    runId: 'run-recovering',
    clientRequestId: 'request-recovering',
    providerTaskId: 'provider-recovering',
  });
  assert.deepEqual(activeRunIds, ['job-recovering', 'run-recovering', 'request-recovering', 'provider-recovering']);
  assert.equal(activeRunIds.includes({ jobId: 'job-recovering' }.jobId), true);
  assert.deepEqual(getActiveManagedAssetRunIds({ id: 'job-done', status: 'succeeded' }), []);
  assert.deepEqual(getActiveManagedAssetRunIds({
    id: 'job-done-with-stale-phase',
    status: 'failed',
    phase: 'submitted',
    runId: 'run-done',
  }), []);

  const longClientRequestId = `request-${'x'.repeat(180)}`;
  const normalizedRunId = `run-${longClientRequestId}`.slice(0, 120);
  assert.deepEqual(getActiveManagedAssetRunIds({
    status: 'running',
    runId: `run-${longClientRequestId}`,
    clientRequestId: longClientRequestId,
  }), [normalizedRunId, longClientRequestId.slice(0, 120)]);
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
    queries.some((sql) => /UPDATE stored_assets\s+SET expires_at = 0\s+WHERE module IN \('agent_center', 'agent_chat', 'virtual_model'\)/s.test(sql)),
    'startup migration should make existing agent and virtual-model assets permanent'
  );
  assert.ok(
    queries.some((sql) => /storage_status/i.test(sql)),
    'stored assets need an explicit backwards-compatible storage status'
  );
  assert.ok(
    queries.some((sql) => /ADD COLUMN content_hash CHAR\(64\) NULL AFTER file_size/.test(sql)),
    'startup migration should add the content hash column idempotently'
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

  calls.length = 0;
  await markStoredAssetStorageStatus(pool, 'asset-1', 'active', 5678);
  assert.match(calls[0].sql, /deleted_at = NULL/);
  assert.deepEqual(calls[0].values, ['active', 5678, 'asset-1']);
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
    fileBuffer: PNG_FILE_BUFFER,
    env: {
      MEIAO_MANAGED_IMAGE_UPLOAD_MODE: 'cos',
      MEIAO_IMAGE_COS_BUCKET: 'meiao-managed-images-1406860462',
      MEIAO_IMAGE_COS_REGION: 'ap-guangzhou',
      MEIAO_MANAGED_ASSET_ACCESS_SECRET: 'test-managed-asset-secret-32-bytes',
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
  const publicUrl = new URL(record.publicUrl);
  assert.equal(publicUrl.origin + publicUrl.pathname, `https://meiao.example.com/api/assets/file/${record.id}/buyer-reference.png`);
  assert.ok(publicUrl.searchParams.get('asset_key'));
});

test('COS uploads reject a missing bucket snapshot before creating asset metadata', async () => {
  let created = 0;
  await assert.rejects(
    () => persistUploadedAssetBuffer({
      userId: 'user-1',
      originalName: 'source.png',
      mimeType: 'image/png',
      fileBuffer: PNG_FILE_BUFFER,
      env: {
        MEIAO_MANAGED_IMAGE_UPLOAD_MODE: 'cos',
        MEIAO_IMAGE_COS_REGION: 'ap-guangzhou',
        MEIAO_MANAGED_ASSET_ACCESS_SECRET: 'test-managed-asset-secret-32-bytes',
      },
      deps: {
        createRecord: async () => { created += 1; },
      },
    }),
    (error) => error?.code === 'provider_config_error',
  );
  assert.equal(created, 0);
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
      fileBuffer: JPEG_FILE_BUFFER,
      env: {
        MEIAO_MANAGED_IMAGE_UPLOAD_MODE: 'cos',
        MEIAO_IMAGE_COS_BUCKET: 'meiao-managed-images-1406860462',
        MEIAO_IMAGE_COS_REGION: 'ap-guangzhou',
        MEIAO_MANAGED_ASSET_ACCESS_SECRET: 'test-managed-asset-secret-32-bytes',
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

test('generated image results and non-image uploads retain the local persistence path', async () => {
  const calls = [];
  const generatedResult = await persistUploadedAssetBuffer({
    publicBaseUrl: 'https://meiao.example.com',
    userId: 'user-1',
    module: 'retouch',
    assetType: 'result',
    originalName: 'generated.png',
    mimeType: 'image/png',
    fileBuffer: Buffer.from('png'),
    env: { MEIAO_MANAGED_IMAGE_UPLOAD_MODE: 'cos' },
    deps: {
      persistLocal: async (options) => {
        calls.push(options);
        return { id: 'local-result', provider: 'internal', storageStatus: 'active' };
      },
      putCos: async () => { throw new Error('generated image must not use COS'); },
    },
  });
  const documentResult = await persistUploadedAssetBuffer({
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

  assert.equal(calls.length, 2);
  assert.equal(calls[0].assetType, 'result');
  assert.equal(calls[0].mimeType, 'image/png');
  assert.equal(calls[1].mimeType, 'application/pdf');
  assert.equal(generatedResult.provider, 'internal');
  assert.equal(documentResult.provider, 'internal');
});

test('disabled managed image upload mode rejects new images before creating metadata', async () => {
  let createCalls = 0;
  await assert.rejects(
    () => persistUploadedAssetBuffer({
      userId: 'user-1',
      originalName: 'image.png',
      mimeType: 'image/png',
      fileBuffer: PNG_FILE_BUFFER,
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

test('local development image mode persists validated source images through the durable local store', async () => {
  const calls = [];
  const record = await persistUploadedAssetBuffer({
    publicBaseUrl: 'http://127.0.0.1:3100',
    userId: 'user-1',
    module: 'retouch',
    assetType: 'reference',
    originalName: 'product-reference.png',
    mimeType: 'image/png',
    fileBuffer: PNG_FILE_BUFFER,
    env: {
      NODE_ENV: 'development',
      MEIAO_PUBLIC_BASE_URL: 'http://127.0.0.1:3100',
      MEIAO_MANAGED_IMAGE_UPLOAD_MODE: 'local',
    },
    deps: {
      persistLocal: async (options) => {
        calls.push(options);
        return { id: 'local-reference', provider: 'internal', storageStatus: 'active' };
      },
      putCos: async () => { throw new Error('local development mode must not call COS'); },
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].assetType, 'reference');
  assert.equal(calls[0].mimeType, 'image/png');
  assert.equal(record.provider, 'internal');
  assert.equal(record.storageStatus, 'active');
});

test('local image mode stays fail-closed in production', async () => {
  let localWrites = 0;
  await assert.rejects(
    () => persistUploadedAssetBuffer({
      publicBaseUrl: 'http://127.0.0.1:3100',
      userId: 'user-1',
      assetType: 'source',
      originalName: 'source.png',
      mimeType: 'image/png',
      fileBuffer: PNG_FILE_BUFFER,
      env: {
        NODE_ENV: 'production',
        MEIAO_PUBLIC_BASE_URL: 'http://127.0.0.1:3100',
        MEIAO_MANAGED_IMAGE_UPLOAD_MODE: 'local',
      },
      deps: {
        persistLocal: async () => { localWrites += 1; },
      },
    }),
    (error) => error?.code === 'managed_image_local_mode_forbidden'
      && error?.retryable === false,
  );
  assert.equal(localWrites, 0);
});

test('local image mode rejects a public asset origin even outside production', async () => {
  let localWrites = 0;
  await assert.rejects(
    () => persistUploadedAssetBuffer({
      publicBaseUrl: 'https://meiao.example.com',
      userId: 'user-1',
      assetType: 'source',
      originalName: 'source.png',
      mimeType: 'image/png',
      fileBuffer: PNG_FILE_BUFFER,
      env: {
        NODE_ENV: 'development',
        MEIAO_PUBLIC_BASE_URL: 'https://meiao.example.com',
        MEIAO_MANAGED_IMAGE_UPLOAD_MODE: 'local',
      },
      deps: {
        persistLocal: async () => { localWrites += 1; },
      },
    }),
    (error) => error?.code === 'managed_image_local_mode_forbidden'
      && error?.retryable === false,
  );
  assert.equal(localWrites, 0);
});

test('unknown client asset types cannot bypass COS by falling through to local storage', async () => {
  let localWrites = 0;
  await assert.rejects(
    () => persistUploadedAssetBuffer({
      userId: 'user-1',
      assetType: 'local-please',
      originalName: 'image.png',
      mimeType: 'image/png',
      fileBuffer: PNG_FILE_BUFFER,
      env: { MEIAO_MANAGED_IMAGE_UPLOAD_MODE: 'cos' },
      deps: {
        persistLocal: async () => { localWrites += 1; },
      },
    }),
    (error) => error?.code === 'managed_asset_type_invalid' && error?.statusCode === 400,
  );
  assert.equal(localWrites, 0);
});

test('managed source images declared as octet-stream are sniffed and still routed to COS', async () => {
  const uploads = [];
  let localWrites = 0;
  const record = await persistUploadedAssetBuffer({
    publicBaseUrl: 'https://meiao.example.com',
    userId: 'user-1',
    assetType: 'source',
    originalName: 'disguised.bin',
    mimeType: 'application/octet-stream',
    fileBuffer: PNG_FILE_BUFFER,
    env: {
      MEIAO_MANAGED_IMAGE_UPLOAD_MODE: 'cos',
      MEIAO_IMAGE_COS_BUCKET: 'meiao-managed-images-1406860462',
      MEIAO_IMAGE_COS_REGION: 'ap-guangzhou',
      MEIAO_MANAGED_ASSET_ACCESS_SECRET: 'test-managed-asset-secret-32-bytes',
    },
    deps: {
      createRecord: async (_pool, value) => value,
      markStatus: async () => {},
      putCos: async (payload) => uploads.push(payload),
      persistLocal: async () => { localWrites += 1; },
    },
  });

  assert.equal(record.provider, 'tencent_cos');
  assert.equal(record.mimeType, 'image/png');
  assert.equal(uploads[0].mimeType, 'image/png');
  assert.equal(localWrites, 0);
});

test('managed source images normalize a conflicting browser image MIME and file extension from trusted bytes', async () => {
  const created = [];
  const uploads = [];
  const record = await persistUploadedAssetBuffer({
    publicBaseUrl: 'https://meiao.example.com',
    userId: 'user-1',
    assetType: 'source',
    originalName: 'catalog.jpg',
    mimeType: 'image/jpeg',
    fileBuffer: PNG_FILE_BUFFER,
    env: {
      MEIAO_MANAGED_IMAGE_UPLOAD_MODE: 'cos',
      MEIAO_IMAGE_COS_BUCKET: 'meiao-managed-images-1406860462',
      MEIAO_IMAGE_COS_REGION: 'ap-guangzhou',
      MEIAO_MANAGED_ASSET_ACCESS_SECRET: 'test-managed-asset-secret-32-bytes',
    },
    deps: {
      createRecord: async (_pool, value) => {
        created.push(value);
        return value;
      },
      markStatus: async () => {},
      putCos: async (payload) => uploads.push(payload),
      enqueueCleanup: async () => { throw new Error('cleanup must not be enqueued'); },
      persistLocal: async () => { throw new Error('local fallback must not run'); },
    },
  });

  assert.equal(created.length, 1);
  assert.equal(record.mimeType, 'image/png');
  assert.equal(record.originalName, 'catalog.png');
  assert.match(record.storageKey, /\/catalog\.png$/);
  assert.match(new URL(record.publicUrl).pathname, /\/catalog\.png$/);
  assert.equal(uploads.length, 1);
  assert.equal(uploads[0].mimeType, 'image/png');
  assert.match(uploads[0].storageKey, /\/catalog\.png$/);
});

test('managed source images cannot disguise their bytes as another non-image MIME', async () => {
  let cosWrites = 0;
  let localWrites = 0;
  await assert.rejects(
    () => persistUploadedAssetBuffer({
      userId: 'user-1',
      assetType: 'reference',
      originalName: 'disguised.pdf',
      mimeType: 'application/pdf',
      fileBuffer: PNG_FILE_BUFFER,
      env: { MEIAO_MANAGED_IMAGE_UPLOAD_MODE: 'cos' },
      deps: {
        putCos: async () => { cosWrites += 1; },
        persistLocal: async () => { localWrites += 1; },
      },
    }),
    (error) => error?.code === 'managed_image_mime_mismatch' && error?.statusCode === 400,
  );
  assert.equal(cosWrites, 0);
  assert.equal(localWrites, 0);
});

test('requestStoredAssetDeletion queues an exact COS object after making reads unavailable', async () => {
  const calls = [];
  const asset = {
    id: 'asset-1',
    provider: 'tencent_cos',
    storageStatus: 'active',
    storageKey: 'managed-images/users/abc/source/asset-1/image.png',
    storageBucket: 'snapshot-bucket-1406860462',
    storageRegion: 'snapshot-region',
    deletedAt: null,
  };
  const result = await requestStoredAssetDeletion({
    pool: {},
    asset,
    reason: 'chat_session_deleted',
    env: {
      MEIAO_IMAGE_COS_BUCKET: 'current-bucket-must-not-be-used',
      MEIAO_IMAGE_COS_REGION: 'current-region-must-not-be-used',
      MEIAO_ASSET_DELETE_GRACE_MS: '120000',
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
    bucket: 'snapshot-bucket-1406860462',
    region: 'snapshot-region',
    storageKey: 'managed-images/users/abc/source/asset-1/image.png',
    action: 'delete',
    reason: 'chat_session_deleted',
    nextAttemptAt: 125000,
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
