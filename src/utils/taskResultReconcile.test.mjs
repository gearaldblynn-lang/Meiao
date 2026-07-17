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
