import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveManagedAssetReadUrl } from './managedAssetReadResolver.mjs';

const cosAsset = (overrides = {}) => ({
  id: 'asset-cos-1',
  userId: 'user-1',
  provider: 'tencent_cos',
  storageStatus: 'active',
  storageKey: 'managed-images/users/abc/source/asset-cos-1/image.png',
  storageBucket: 'snapshot-bucket-1406860462',
  storageRegion: 'snapshot-region',
  publicUrl: '/api/assets/file/asset-cos-1/image.png',
  deletedAt: null,
  ...overrides,
});

test('active COS managed assets receive a fresh purpose-specific signed URL', async () => {
  const signCalls = [];
  const getAsset = async () => cosAsset();
  const createCosReadUrl = async (key, purpose) => {
    signCalls.push([key, purpose]);
    return `https://images.cos.test/${key}?q-signature=${signCalls.length}`;
  };

  const first = await resolveManagedAssetReadUrl('/api/assets/file/asset-cos-1/image.png', {
    purpose: 'provider',
    userId: 'user-1',
    getAsset,
    headCos: async () => ({ exists: true }),
    createCosReadUrl,
  });
  const second = await resolveManagedAssetReadUrl('/api/assets/file/asset-cos-1/image.png', {
    purpose: 'provider',
    userId: 'user-1',
    getAsset,
    headCos: async () => ({ exists: true }),
    createCosReadUrl,
  });

  assert.notEqual(first, second);
  assert.deepEqual(signCalls, [
    ['managed-images/users/abc/source/asset-cos-1/image.png', 'provider'],
    ['managed-images/users/abc/source/asset-cos-1/image.png', 'provider'],
  ]);
});

test('historical internal assets keep their existing local stream path', async () => {
  const result = await resolveManagedAssetReadUrl('/api/assets/file/asset-local/image.png', {
    purpose: 'provider',
    userId: 'user-1',
    getAsset: async () => cosAsset({
      id: 'asset-local',
      provider: 'internal',
      storageKey: 'user-1/source/image.png',
    }),
    createCosReadUrl: async () => { throw new Error('COS signer must not run'); },
  });

  assert.equal(result, '');

  const browserResult = await resolveManagedAssetReadUrl('/api/assets/file/asset-local/image.png', {
    purpose: 'browser',
    userId: 'user-1',
    getAsset: async () => cosAsset({ id: 'asset-local', provider: 'internal' }),
    appendAccessKey: () => { throw new Error('browser stream must not sign an internal redirect'); },
  });
  assert.equal(browserResult, '');
});

test('historical KIE-labelled result assets still use the local read path', async () => {
  const result = await resolveManagedAssetReadUrl('/api/assets/file/asset-kie/result.png', {
    purpose: 'provider',
    userId: 'user-1',
    getAsset: async () => cosAsset({
      id: 'asset-kie',
      provider: 'kie',
      storageKey: 'user-1/result/result.png',
    }),
    createCosReadUrl: async () => { throw new Error('COS signer must not run'); },
  });

  assert.equal(result, '');
});

test('server-validated public virtual-model assets can be read by a different task user', async () => {
  const result = await resolveManagedAssetReadUrl('/api/assets/file/asset-model-1/identity.png', {
    purpose: 'provider',
    userId: 'task-user',
    authorizedSharedAssetIds: new Set(['asset-model-1']),
    getAsset: async () => cosAsset({
      id: 'asset-model-1',
      userId: 'model-admin',
      module: 'virtual_model',
      provider: 'internal',
      storageKey: 'model-admin/source/identity.png',
    }),
    createCosReadUrl: async () => { throw new Error('COS signer must not run'); },
  });

  assert.equal(result, '');
});

test('a shared allowlist never bypasses ownership for non-library assets', async () => {
  await assert.rejects(
    () => resolveManagedAssetReadUrl('/api/assets/file/asset-private-1/image.png', {
      purpose: 'provider',
      userId: 'task-user',
      authorizedSharedAssetIds: new Set(['asset-private-1']),
      getAsset: async () => cosAsset({
        id: 'asset-private-1',
        userId: 'other-user',
        module: 'everything_replace',
        provider: 'internal',
      }),
    }),
    (error) => error?.code === 'managed_asset_forbidden',
  );
});

test('COS reads sign with the persisted bucket and region snapshot after config rotation', async () => {
  let signedEnv = null;
  await resolveManagedAssetReadUrl('/api/assets/file/asset-cos-1/image.png', {
    purpose: 'provider',
    userId: 'user-1',
    env: {
      MEIAO_IMAGE_COS_BUCKET: 'new-current-bucket',
      MEIAO_IMAGE_COS_REGION: 'new-current-region',
    },
    getAsset: async () => cosAsset(),
    headCos: async () => ({ exists: true }),
    createCosReadUrl: async (_key, _purpose, env) => {
      signedEnv = env;
      return 'https://snapshot.cos.test/image.png';
    },
  });

  assert.equal(signedEnv.MEIAO_IMAGE_COS_BUCKET, 'snapshot-bucket-1406860462');
  assert.equal(signedEnv.MEIAO_IMAGE_COS_REGION, 'snapshot-region');
});

test('an active database row with a missing COS object fails before signing', async () => {
  let signCalls = 0;
  await assert.rejects(
    () => resolveManagedAssetReadUrl('/api/assets/file/asset-cos-1/image.png', {
      purpose: 'browser',
      userId: 'user-1',
      getAsset: async () => cosAsset(),
      headCos: async () => ({ exists: false, missing: true }),
      createCosReadUrl: async () => {
        signCalls += 1;
        return 'https://must-not-sign.test';
      },
    }),
    (error) => error?.code === 'managed_asset_object_missing' && error?.statusCode === 503,
  );
  assert.equal(signCalls, 0);
});

test('COS reads fail closed when their persisted storage snapshot is missing', async () => {
  await assert.rejects(
    () => resolveManagedAssetReadUrl('/api/assets/file/asset-cos-1/image.png', {
      purpose: 'provider',
      userId: 'user-1',
      getAsset: async () => cosAsset({ storageBucket: '', storageRegion: '' }),
      createCosReadUrl: async () => { throw new Error('must not guess current COS config'); },
    }),
    (error) => error?.code === 'managed_asset_storage_snapshot_missing',
  );
});

test('unavailable or cross-user COS assets cannot receive a signed URL', async () => {
  for (const asset of [
    cosAsset({ storageStatus: 'uploading' }),
    cosAsset({ storageStatus: 'upload_failed' }),
    cosAsset({ storageStatus: 'delete_pending', deletedAt: 100 }),
    cosAsset({ storageStatus: 'deleted', deletedAt: 100 }),
  ]) {
    await assert.rejects(
      () => resolveManagedAssetReadUrl(asset.publicUrl, {
        purpose: 'provider',
        userId: 'user-1',
        getAsset: async () => asset,
        createCosReadUrl: async () => 'https://must-not-sign.test',
      }),
      (error) => error?.code === 'managed_asset_unavailable',
    );
  }

  await assert.rejects(
    () => resolveManagedAssetReadUrl('/api/assets/file/asset-cos-1/image.png', {
      purpose: 'provider',
      userId: 'other-user',
      getAsset: async () => cosAsset(),
      createCosReadUrl: async () => 'https://must-not-sign.test',
    }),
    (error) => error?.code === 'managed_asset_forbidden',
  );

  await assert.rejects(
    () => resolveManagedAssetReadUrl('/api/assets/file/asset-cos-1/image.png', {
      purpose: 'provider',
      getAsset: async () => cosAsset(),
      createCosReadUrl: async () => 'https://must-not-sign.test',
    }),
    (error) => error?.code === 'managed_asset_forbidden',
  );
});
