import assert from 'node:assert/strict';
import test from 'node:test';

import { buildVirtualModelProviderPayload } from './virtualModelProviderPayload.mjs';

test('library provider payload prepends trusted identity assets and exposes only their ids for reads', () => {
  const result = buildVirtualModelProviderPayload({
    identitySource: 'library',
    prompt: 'R Role 角色\n\nC Constraint 约束\n\nF Format 格式\noutput',
    identityDescription: '黑色盘发，东亚女性',
    selectedAssetIds: ['client-id-must-not-be-trusted'],
    imageUrls: ['https://managed/reference.png'],
  }, [
    { assetId: 'trusted-front', slot: 'front_close', url: 'https://managed/front.png' },
    { assetId: 'trusted-left', slot: 'left_45_close', url: 'https://managed/left.png' },
  ]);

  assert.deepEqual(result.payload.imageUrls, [
    'https://managed/front.png',
    'https://managed/left.png',
    'https://managed/reference.png',
  ]);
  assert.deepEqual([...result.authorizedManagedAssetIds], ['trusted-front', 'trusted-left']);
  assert.ok(result.payload.prompt.indexOf('图A-1（输入图1）：正面近景') < result.payload.prompt.indexOf('F Format 格式'));
  assert.ok(result.payload.prompt.includes('身份档案补充（次于图A-1）'));
  assert.ok(!result.authorizedManagedAssetIds.has('client-id-must-not-be-trusted'));
});

test('uploaded identity payload never receives a shared-library read allowlist', () => {
  const payload = {
    identitySource: 'upload',
    prompt: 'keep',
    imageUrls: ['https://managed/upload.png'],
  };
  const result = buildVirtualModelProviderPayload(payload, [
    { assetId: 'ignored-library-id', slot: 'front_close', url: 'https://managed/library.png' },
  ]);

  assert.equal(result.payload, payload);
  assert.deepEqual([...result.authorizedManagedAssetIds], []);
});
