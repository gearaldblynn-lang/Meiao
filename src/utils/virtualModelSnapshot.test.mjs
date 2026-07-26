import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeVirtualModelSnapshot } from './virtualModelSnapshot.mjs';

const snapshotWithCount = (count) => ({
  identitySource: 'library',
  virtualModelId: 'model-1',
  virtualModelVersionId: 'version-1',
  publishedAt: 123,
  selectedAssetIds: Array.from({ length: count }, (_, index) => `asset-${index + 1}`),
});

test('preserves new three-image and historical four- and five-image snapshots', () => {
  for (const count of [3, 4, 5]) {
    const snapshot = snapshotWithCount(count);
    assert.deepEqual(sanitizeVirtualModelSnapshot(snapshot).selectedAssetIds, snapshot.selectedAssetIds);
  }
});

test('rejects unsupported selected asset counts', () => {
  for (const count of [2, 6]) {
    assert.equal('selectedAssetIds' in sanitizeVirtualModelSnapshot(snapshotWithCount(count)), false);
  }
});

