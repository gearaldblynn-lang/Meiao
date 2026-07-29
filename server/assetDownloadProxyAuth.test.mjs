import assert from 'node:assert/strict';
import test from 'node:test';

import { buildManagedAssetProxyAuthHeaders } from './assetDownloadProxyAuth.mjs';

test('download proxy forwards bearer auth only to the managed asset route on the same apex site', () => {
  const options = {
    authorization: 'Bearer owner-session',
    publicBaseUrl: 'https://meiaoyuntai.com',
    requestBaseUrl: 'https://www.meiaoyuntai.com',
  };

  assert.deepEqual(buildManagedAssetProxyAuthHeaders(
    'https://meiaoyuntai.com/api/assets/file/asset-1/result.jpg',
    options,
  ), { Authorization: 'Bearer owner-session' });
  assert.deepEqual(buildManagedAssetProxyAuthHeaders(
    'https://www.meiaoyuntai.com/api/assets/file/asset-1/result.jpg',
    options,
  ), { Authorization: 'Bearer owner-session' });
});

test('download proxy never forwards credentials to remote hosts or non-asset app routes', () => {
  const options = {
    authorization: 'Bearer owner-session',
    publicBaseUrl: 'https://meiaoyuntai.com',
    requestBaseUrl: 'https://www.meiaoyuntai.com',
  };

  assert.deepEqual(buildManagedAssetProxyAuthHeaders(
    'https://provider.example/image.jpg',
    options,
  ), {});
  assert.deepEqual(buildManagedAssetProxyAuthHeaders(
    'https://meiaoyuntai.com/api/auth/me',
    options,
  ), {});
  assert.deepEqual(buildManagedAssetProxyAuthHeaders(
    'https://meiaoyuntai.com.evil.example/api/assets/file/asset-1/result.jpg',
    options,
  ), {});
  assert.deepEqual(buildManagedAssetProxyAuthHeaders(
    'https://meiaoyuntai.com/api/assets/file/asset-1/result.jpg',
    { ...options, authorization: 'Basic forbidden' },
  ), {});
});
