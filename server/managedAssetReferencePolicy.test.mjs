import assert from 'node:assert/strict';
import test from 'node:test';

import * as managedAssetReferencePolicy from './managedAssetReferencePolicy.mjs';

const {
  assertOwnedActiveManagedAssetReferences,
  prepareAuthorizedManagedAssetJobPayload,
} = managedAssetReferencePolicy;

test('managed references are accepted only when every asset is active and owned by the caller', async () => {
  const calls = [];
  await assertOwnedActiveManagedAssetReferences({
    value: [{
      url: 'https://old-host.example/api/assets/file/asset-owned/source.png?asset_key=capability',
      assetId: 'asset-owned',
    }],
    userId: 'user-1',
    pool: {},
    listAssetsForUser: async (pool, userId) => {
      calls.push([pool, userId]);
      return [{
        id: 'asset-owned',
        userId: 'user-1',
        storageKey: 'managed-images/users/a/source/asset-owned/source.png',
        storageStatus: 'active',
        deletedAt: null,
      }];
    },
  });

  assert.deepEqual(calls, [[{}, 'user-1']]);
});

test('cross-user stale and delete-pending references fail before persistence', async () => {
  for (const assets of [
    [],
    [{ id: 'asset-other', userId: 'user-2', storageKey: 'key', storageStatus: 'active', deletedAt: null }],
    [{ id: 'asset-other', userId: 'user-1', storageKey: 'key', storageStatus: 'delete_pending', deletedAt: 1 }],
  ]) {
    await assert.rejects(
      () => assertOwnedActiveManagedAssetReferences({
        value: [{ url: '/api/assets/file/asset-other/image.png', assetId: 'asset-other' }],
        userId: 'user-1',
        listAssetsForUser: async () => assets,
      }),
      (error) => error?.code === 'managed_asset_forbidden' && error?.statusCode === 403,
    );
  }
});

test('payloads without managed asset references skip storage scans', async () => {
  let calls = 0;
  await assertOwnedActiveManagedAssetReferences({
    value: [{ url: 'https://external.example/image.png', kind: 'image' }],
    userId: 'user-1',
    listAssetsForUser: async () => { calls += 1; return []; },
  });
  assert.equal(calls, 0);
});

test('local draft asset identities are not treated as managed storage assets', async () => {
  let calls = 0;
  await assertOwnedActiveManagedAssetReferences({
    value: [{
      localAssetId: 'draft-1784104061813-product',
      url: 'blob:https://meiaoyuntai.com/local-preview',
    }],
    userId: 'user-1',
    listAssetsForUser: async () => {
      calls += 1;
      return [];
    },
  });

  assert.equal(calls, 0);
});

test('explicit persisted asset identities still require active ownership', async () => {
  await assert.rejects(
    () => assertOwnedActiveManagedAssetReferences({
      value: [{ imageUrlAssetId: 'asset-other' }],
      userId: 'user-1',
      listAssetsForUser: async () => [],
    }),
    (error) => error?.code === 'managed_asset_forbidden' && error?.statusCode === 403,
  );
});

test('job intake authorizes caller assets before appending trusted public-model metadata', async () => {
  assert.equal(typeof prepareAuthorizedManagedAssetJobPayload, 'function');
  const ownedAsset = {
    id: 'asset-owned',
    userId: 'user-1',
    storageKey: 'managed-images/users/user-1/source/asset-owned/reference.png',
    storageStatus: 'active',
    deletedAt: null,
  };

  const payload = await prepareAuthorizedManagedAssetJobPayload({
    value: { imageUrlAssetId: 'asset-owned' },
    userId: 'user-1',
    scrubPayload: async (value) => ({ ...value }),
    assertReferences: (options) => assertOwnedActiveManagedAssetReferences({
      ...options,
      listAssetsForUser: async () => [ownedAsset],
    }),
    appendTrustedMetadata: async (callerOwnedPayload) => ({
      ...callerOwnedPayload,
      identitySource: 'library',
      virtualModelCoverAssetId: 'asset-public-model',
    }),
  });

  assert.equal(payload.imageUrlAssetId, 'asset-owned');
  assert.equal(payload.virtualModelCoverAssetId, 'asset-public-model');
});

test('job intake rejects injected cross-user asset IDs before trusted metadata is appended', async () => {
  assert.equal(typeof prepareAuthorizedManagedAssetJobPayload, 'function');
  let appendCalls = 0;

  await assert.rejects(
    () => prepareAuthorizedManagedAssetJobPayload({
      value: {
        imageUrlAssetId: 'asset-owned',
        injectedCoverAssetId: 'asset-other',
      },
      userId: 'user-1',
      scrubPayload: async (value) => ({ ...value }),
      assertReferences: (options) => assertOwnedActiveManagedAssetReferences({
        ...options,
        listAssetsForUser: async () => [{
          id: 'asset-owned',
          userId: 'user-1',
          storageKey: 'managed-images/users/user-1/source/asset-owned/reference.png',
          storageStatus: 'active',
          deletedAt: null,
        }],
      }),
      appendTrustedMetadata: async (callerOwnedPayload) => {
        appendCalls += 1;
        return callerOwnedPayload;
      },
    }),
    (error) => error?.code === 'managed_asset_forbidden' && error?.statusCode === 403,
  );

  assert.equal(appendCalls, 0);
});
