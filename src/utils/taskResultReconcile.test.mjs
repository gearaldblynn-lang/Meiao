import test from 'node:test';
import assert from 'node:assert/strict';

import { mergeArrayByStableKeys } from './taskResultReconcile.mjs';

test('product restoration reconciliation replaces an old backend job for the same target and batch', () => {
  const existing = [{
    id: 'old-provider-task',
    backendJobId: 'old-backend-job',
    taskId: 'old-provider-task',
    module: 'retouch',
    subFeature: 'product_restore',
    targetMaterialId: 'target-a',
    batchIndex: 1,
    status: 'generating',
    imageUrl: '',
  }];
  const incoming = [{
    id: 'new-provider-task',
    backendJobId: 'new-backend-job',
    taskId: 'new-provider-task',
    module: 'retouch',
    subFeature: 'product_restore',
    targetMaterialId: 'target-a',
    batchIndex: 1,
    status: 'completed',
    imageUrl: 'https://example.com/restored-a.png',
  }];

  const merged = mergeArrayByStableKeys(existing, incoming);

  assert.equal(merged.length, 1);
  assert.equal(merged[0].backendJobId, 'new-backend-job');
  assert.equal(merged[0].imageUrl, 'https://example.com/restored-a.png');
  assert.equal(merged[0].status, 'completed');
});

test('non-product-restoration results keep their existing reconciliation identities', () => {
  const existing = [{
    id: 'old-provider-task',
    backendJobId: 'old-backend-job',
    module: 'retouch',
    subFeature: 'original',
    targetMaterialId: 'target-a',
    batchIndex: 1,
    status: 'generating',
    imageUrl: '',
  }];
  const incoming = [{
    id: 'new-provider-task',
    backendJobId: 'new-backend-job',
    module: 'retouch',
    subFeature: 'original',
    targetMaterialId: 'target-a',
    batchIndex: 1,
    status: 'completed',
    imageUrl: 'https://example.com/retouched-a.png',
  }];

  const merged = mergeArrayByStableKeys(existing, incoming);

  assert.equal(merged.length, 2);
});

test('non-product restoration completed patches remain incoming-authoritative regardless of createdAt', () => {
  const existing = [{
    id: 'same-result',
    module: 'retouch',
    subFeature: 'original',
    status: 'completed',
    createdAt: 200,
    imageUrl: '/existing-newer-time.png',
  }];
  const incoming = [{
    id: 'same-result',
    module: 'retouch',
    subFeature: 'original',
    status: 'completed',
    createdAt: 100,
    imageUrl: '/incoming-authoritative.png',
  }];

  const merged = mergeArrayByStableKeys(existing, incoming);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].imageUrl, '/incoming-authoritative.png');
});

test('same-job legacy logo review rejection cannot override a completed media result', () => {
  const backendJobId = 'logo-generation-job';
  const imageUrl = '/managed/logo-result.png';
  const qualityError = 'Logo 内部排布与身份参考不一致，已停止发布。';
  const merged = mergeArrayByStableKeys([{
    id: 'logo-result',
    module: 'everything_replace',
    subFeature: 'logo_replace',
    backendJobId,
    status: 'completed',
    imageUrl,
    creditsConsumed: 4.84,
  }], [{
    id: 'logo-result',
    module: 'everything_replace',
    subFeature: 'logo_replace',
    backendJobId,
    status: 'error',
    imageUrl,
    creditsConsumed: 4.84,
    error: qualityError,
    errorCode: 'logo_replace_quality_rejected',
  }]);

  assert.equal(merged.length, 1);
  assert.equal(merged[0].status, 'completed');
  assert.equal(merged[0].error, undefined);
  assert.equal(merged[0].errorCode, undefined);
  assert.equal(merged[0].imageUrl, imageUrl);
  assert.equal(merged[0].creditsConsumed, 4.84);
});

test('completed media stays authoritative when a duplicate row carries an error with media', () => {
  const completed = {
    id: 'same-result',
    backendJobId: 'completed-job',
    status: 'completed',
    imageUrl: '/completed.png',
  };
  const incomingFailure = {
    id: 'same-result',
    backendJobId: 'completed-job',
    status: 'error',
    imageUrl: '/completed.png',
    error: 'incoming failure',
  };

  const nonLogo = mergeArrayByStableKeys([{
    ...completed,
    module: 'retouch',
    subFeature: 'original',
  }], [{
    ...incomingFailure,
    module: 'retouch',
    subFeature: 'original',
  }]);
  assert.equal(nonLogo[0].status, 'completed');

  const differentLogoJob = mergeArrayByStableKeys([{
    ...completed,
    module: 'everything_replace',
    subFeature: 'logo_replace',
  }], [{
    ...incomingFailure,
    module: 'everything_replace',
    subFeature: 'logo_replace',
    backendJobId: 'different-job',
  }]);
  assert.equal(differentLogoJob[0].status, 'completed');
});
