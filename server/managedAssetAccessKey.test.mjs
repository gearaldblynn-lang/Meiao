import assert from 'node:assert/strict';
import test from 'node:test';

import {
  appendManagedAssetAccessKey,
  createManagedAssetAccessKey,
  stripManagedAssetAccessKey,
  verifyManagedAssetAccessKey,
} from './managedAssetAccessKey.mjs';

const env = { MEIAO_MANAGED_ASSET_ACCESS_SECRET: 'test-managed-asset-secret-32-bytes' };

test('managed asset access keys bind the asset id and owner without exposing the secret', () => {
  const key = createManagedAssetAccessKey({ assetId: 'asset-1', userId: 'user-1' }, env);
  assert.equal(verifyManagedAssetAccessKey(key, { assetId: 'asset-1', userId: 'user-1' }, env), true);
  assert.equal(verifyManagedAssetAccessKey(key, { assetId: 'asset-2', userId: 'user-1' }, env), false);
  assert.equal(verifyManagedAssetAccessKey(key, { assetId: 'asset-1', userId: 'user-2' }, env), false);
  assert.equal(key.includes(env.MEIAO_MANAGED_ASSET_ACCESS_SECRET), false);
});

test('managed COS public urls carry a stable capability key and preserve existing query fields', () => {
  const result = appendManagedAssetAccessKey(
    'https://meiao.example.com/api/assets/file/asset-1/image.png?download=1',
    { assetId: 'asset-1', userId: 'user-1' },
    env,
  );
  const parsed = new URL(result);
  assert.equal(parsed.searchParams.get('download'), '1');
  assert.equal(
    verifyManagedAssetAccessKey(
      parsed.searchParams.get('asset_key'),
      { assetId: 'asset-1', userId: 'user-1' },
      env,
    ),
    true,
  );
});

test('missing access-key secret fails closed', () => {
  assert.throws(
    () => createManagedAssetAccessKey({ assetId: 'asset-1', userId: 'user-1' }, {}),
    (error) => error?.code === 'managed_asset_access_secret_missing',
  );
});

test('access key rotation can verify existing URLs with the previous secret', () => {
  const identity = { assetId: 'asset-1', userId: 'user-1' };
  const oldSecret = 'old-managed-asset-secret-32-bytes';
  const oldKey = createManagedAssetAccessKey(identity, {
    MEIAO_MANAGED_ASSET_ACCESS_SECRET: oldSecret,
  });
  assert.equal(verifyManagedAssetAccessKey(oldKey, identity, {
    MEIAO_MANAGED_ASSET_ACCESS_SECRET: 'new-managed-asset-secret-32-bytes',
    MEIAO_MANAGED_ASSET_ACCESS_PREVIOUS_SECRET: oldSecret,
  }), true);
});

test('managed asset access keys are removed before URLs enter logs', () => {
  assert.equal(
    stripManagedAssetAccessKey('/api/assets/file/asset-1/image.png?download=1&asset_key=secret-capability'),
    '/api/assets/file/asset-1/image.png?download=1',
  );
  assert.equal(
    stripManagedAssetAccessKey('https://meiao.example.com/api/assets/file/asset-1/image.png?asset_key=secret-capability'),
    'https://meiao.example.com/api/assets/file/asset-1/image.png',
  );
});
