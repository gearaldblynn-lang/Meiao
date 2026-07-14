import assert from 'node:assert/strict';
import test from 'node:test';

import { assertOwnedActiveManagedAssetReferences } from './managedAssetReferencePolicy.mjs';

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
