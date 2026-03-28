import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ASSET_RETENTION_MS,
  buildAssetPublicPath,
  buildAssetPublicUrl,
  getPublicBaseUrl,
  sanitizeAssetName,
  shouldRetainAssetRecord,
} from './assetStore.mjs';

test('sanitizeAssetName keeps extension and removes unsafe chars', () => {
  assert.equal(sanitizeAssetName('海报 图(1).png'), '_____1_.png');
  assert.equal(sanitizeAssetName('abc.jpg'), 'abc.jpg');
});

test('buildAssetPublicUrl returns internal absolute asset route', () => {
  assert.equal(buildAssetPublicPath('asset_123'), '/api/assets/file/asset_123');
  assert.equal(buildAssetPublicUrl('https://meiao.example.com', 'asset_123'), 'https://meiao.example.com/api/assets/file/asset_123');
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
});
