import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveManagedAssetReadUrl } from './managedAssetReadResolver.mjs';

const cosAsset = (overrides = {}) => ({
  id: 'asset-cos-1',
  userId: 'user-1',
  provider: 'tencent_cos',
  storageStatus: 'active',
  storageKey: 'managed-images/users/abc/source/asset-cos-1/image.png',
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
    createCosReadUrl,
  });
  const second = await resolveManagedAssetReadUrl('/api/assets/file/asset-cos-1/image.png', {
    purpose: 'provider',
    userId: 'user-1',
    getAsset,
    createCosReadUrl,
  });

  assert.notEqual(first, second);
  assert.deepEqual(signCalls, [
    ['managed-images/users/abc/source/asset-cos-1/image.png', 'provider'],
    ['managed-images/users/abc/source/asset-cos-1/image.png', 'provider'],
  ]);
});

test('historical internal assets return empty so the legacy resolver remains in control', async () => {
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
});
