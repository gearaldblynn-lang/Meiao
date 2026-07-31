import assert from 'node:assert/strict';
import test from 'node:test';

import { verifyManagedAssetAccessKey } from './managedAssetAccessKey.mjs';
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

const providerAccessEnv = {
  MEIAO_MANAGED_ASSET_ACCESS_SECRET: 'managed-asset-provider-test-secret',
  PORT: '3100',
};

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

test('historical internal assets receive a loopback provider capability and keep their browser stream path', async () => {
  const result = await resolveManagedAssetReadUrl('/api/assets/file/asset-local/image.png', {
    purpose: 'provider',
    userId: 'user-1',
    env: providerAccessEnv,
    getAsset: async () => cosAsset({
      id: 'asset-local',
      provider: 'internal',
      storageKey: 'user-1/source/image.png',
    }),
    createCosReadUrl: async () => { throw new Error('COS signer must not run'); },
  });

  const providerUrl = new URL(result);
  assert.equal(providerUrl.origin, 'http://127.0.0.1:3100');
  assert.equal(providerUrl.pathname, '/api/assets/file/asset-local/image.png');
  assert.equal(
    verifyManagedAssetAccessKey(
      providerUrl.searchParams.get('asset_key'),
      { assetId: 'asset-local', userId: 'user-1' },
      providerAccessEnv,
    ),
    true,
  );

  const browserResult = await resolveManagedAssetReadUrl('/api/assets/file/asset-local/image.png', {
    purpose: 'browser',
    userId: 'user-1',
    getAsset: async () => cosAsset({ id: 'asset-local', provider: 'internal' }),
    appendAccessKey: () => { throw new Error('browser stream must not sign an internal redirect'); },
  });
  assert.equal(browserResult, '');
});

test('stable managed identities resolve through the owned internal asset row', async () => {
  const result = await resolveManagedAssetReadUrl('managed://asset-local', {
    purpose: 'provider',
    userId: 'user-1',
    env: providerAccessEnv,
    getAsset: async (pool, assetId) => {
      assert.equal(pool, null);
      assert.equal(assetId, 'asset-local');
      return cosAsset({
        id: 'asset-local',
        provider: 'internal_transcode',
        storageKey: 'user-1/source/source.mp4',
        publicUrl: '/api/assets/file/asset-local/source.mp4',
      });
    },
  });

  const providerUrl = new URL(result);
  assert.equal(providerUrl.origin, 'http://127.0.0.1:3100');
  assert.equal(providerUrl.pathname, '/api/assets/file/asset-local/source.mp4');
  assert.equal(
    verifyManagedAssetAccessKey(
      providerUrl.searchParams.get('asset_key'),
      { assetId: 'asset-local', userId: 'user-1' },
      providerAccessEnv,
    ),
    true,
  );
});

test('stable managed identities preserve unavailable and owner isolation checks', async () => {
  let capabilityCalls = 0;
  const appendAccessKey = () => {
    capabilityCalls += 1;
    return 'https://must-not-sign.test';
  };

  for (const asset of [
    cosAsset({ id: 'asset-local', provider: 'internal', storageStatus: 'uploading' }),
    cosAsset({ id: 'asset-local', provider: 'internal', storageStatus: 'deleted', deletedAt: 100 }),
  ]) {
    await assert.rejects(
      () => resolveManagedAssetReadUrl('managed://asset-local', {
        purpose: 'provider',
        userId: 'user-1',
        getAsset: async () => asset,
        appendAccessKey,
      }),
      (error) => error?.code === 'managed_asset_unavailable',
    );
  }

  for (const userId of ['other-user', '']) {
    await assert.rejects(
      () => resolveManagedAssetReadUrl('managed://asset-local', {
        purpose: 'provider',
        userId,
        getAsset: async () => cosAsset({
          id: 'asset-local',
          provider: 'internal',
          publicUrl: '/api/assets/file/asset-local/source.mp4',
        }),
        appendAccessKey,
      }),
      (error) => error?.code === 'managed_asset_forbidden',
    );
  }
  assert.equal(capabilityCalls, 0);
});

test('stable managed identity syntax rejects query and fragment suffixes before asset lookup', async () => {
  let getAssetCalls = 0;
  for (const value of [
    'managed://asset-local?asset_key=forged',
    'managed://asset-local#fragment',
    'managed:///asset-local',
  ]) {
    assert.equal(
      await resolveManagedAssetReadUrl(value, {
        purpose: 'provider',
        userId: 'user-1',
        getAsset: async () => {
          getAssetCalls += 1;
          return cosAsset();
        },
      }),
      '',
    );
  }
  assert.equal(getAssetCalls, 0);
});

test('historical KIE-labelled result assets use the authenticated loopback read path', async () => {
  const result = await resolveManagedAssetReadUrl('/api/assets/file/asset-kie/result.png', {
    purpose: 'provider',
    userId: 'user-1',
    env: providerAccessEnv,
    getAsset: async () => cosAsset({
      id: 'asset-kie',
      provider: 'kie',
      storageKey: 'user-1/result/result.png',
    }),
    createCosReadUrl: async () => { throw new Error('COS signer must not run'); },
  });

  const providerUrl = new URL(result);
  assert.equal(providerUrl.origin, 'http://127.0.0.1:3100');
  assert.equal(
    verifyManagedAssetAccessKey(
      providerUrl.searchParams.get('asset_key'),
      { assetId: 'asset-kie', userId: 'user-1' },
      providerAccessEnv,
    ),
    true,
  );
});

test('server-validated public virtual-model assets can be read by a different task user', async () => {
  const result = await resolveManagedAssetReadUrl('/api/assets/file/asset-model-1/identity.png', {
    purpose: 'provider',
    userId: 'task-user',
    env: providerAccessEnv,
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

  const providerUrl = new URL(result);
  assert.equal(providerUrl.origin, 'http://127.0.0.1:3100');
  assert.equal(
    verifyManagedAssetAccessKey(
      providerUrl.searchParams.get('asset_key'),
      { assetId: 'asset-model-1', userId: 'model-admin' },
      providerAccessEnv,
    ),
    true,
  );
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
