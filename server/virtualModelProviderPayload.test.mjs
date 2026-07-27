import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildVirtualModelProviderPayload,
  resolveVirtualModelProviderPayload,
} from './virtualModelProviderPayload.mjs';

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

test('provider orchestration resolves trusted assets before building payload and never allowlists client ids', async () => {
  const calls = [];
  const result = await resolveVirtualModelProviderPayload({
    identitySource: 'library',
    virtualModelId: 'model-1',
    virtualModelVersionId: 'version-1',
    selectedAssetIds: ['client-id'],
    prompt: 'F Format 格式',
    imageUrls: ['https://managed/reference.png'],
  }, async (selection) => {
    calls.push(selection);
    return [
      { assetId: 'trusted-id', slot: 'front_close', url: 'https://managed/trusted.png' },
    ];
  });

  assert.deepEqual(calls, [{
    virtualModelId: 'model-1',
    virtualModelVersionId: 'version-1',
    selectedAssetIds: ['client-id'],
  }]);
  assert.deepEqual(result.payload.imageUrls, [
    'https://managed/trusted.png',
    'https://managed/reference.png',
  ]);
  assert.deepEqual([...result.authorizedManagedAssetIds], ['trusted-id']);
  assert.ok(!result.authorizedManagedAssetIds.has('client-id'));
});

test('full-person provider payload preserves the server-selected full-body A1 ordering', async () => {
  const result = await resolveVirtualModelProviderPayload({
    identitySource: 'library',
    replacementScope: 'full_person',
    virtualModelId: 'model-1',
    virtualModelVersionId: 'version-1',
    selectedAssetIds: ['full-id', 'close-id', 'front-id'],
    prompt: '图A-1是唯一主人物来源图\n\nF Format 格式',
    imageUrls: ['https://managed/reference.png'],
  }, async () => [
    { assetId: 'full-id', slot: 'three_quarter_full', url: 'https://managed/full.png' },
    { assetId: 'close-id', slot: 'right_45_close', url: 'https://managed/close.png' },
    { assetId: 'front-id', slot: 'front_close', url: 'https://managed/front.png' },
  ]);

  assert.deepEqual(result.payload.imageUrls, [
    'https://managed/full.png',
    'https://managed/close.png',
    'https://managed/front.png',
    'https://managed/reference.png',
  ]);
  assert.match(result.payload.prompt, /图A-1（输入图1）：四分之三全身/);
});

test('full-person provider payload migrates a trusted legacy close-first snapshot to full-body A1', () => {
  const result = buildVirtualModelProviderPayload({
    identitySource: 'library',
    replacementScope: 'full_person',
    prompt: '图A-1是唯一主人物来源图\n\nF Format 格式',
    imageUrls: ['https://managed/reference.png'],
  }, [
    { assetId: 'front-id', slot: 'front_close', url: 'https://managed/front.png' },
    { assetId: 'close-id', slot: 'right_45_close', url: 'https://managed/close.png' },
    { assetId: 'full-id', slot: 'three_quarter_full', url: 'https://managed/full.png' },
  ]);

  assert.deepEqual(result.payload.imageUrls, [
    'https://managed/full.png',
    'https://managed/front.png',
    'https://managed/close.png',
    'https://managed/reference.png',
  ]);
  assert.match(result.payload.prompt, /图A-1（输入图1）：四分之三全身/);
  assert.deepEqual([...result.authorizedManagedAssetIds], ['full-id', 'front-id', 'close-id']);
});

test('full-person provider payload fails closed before submission when trusted assets have no body source', () => {
  assert.throws(
    () => buildVirtualModelProviderPayload({
      identitySource: 'library',
      replacementScope: 'full_person',
      prompt: '图A-1是唯一主人物来源图\n\nF Format 格式',
      imageUrls: ['https://managed/reference.png'],
    }, [
      { assetId: 'front-id', slot: 'front_close', url: 'https://managed/front.png' },
      { assetId: 'left-id', slot: 'left_45_close', url: 'https://managed/left.png' },
      { assetId: 'right-id', slot: 'right_45_close', url: 'https://managed/right.png' },
    ]),
    (error) => error?.code === 'MODEL_FULL_PERSON_SOURCE_INCOMPLETE',
  );
});
