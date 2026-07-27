import test from 'node:test';
import assert from 'node:assert/strict';
import * as virtualModelSnapshot from './virtualModelSnapshot.mjs';

const {
  buildLibraryModelReplaceContext,
  buildLibraryModelReplaceJobMetadata,
  createVirtualModelSnapshotTracker,
  getLibraryModelReplaceIdentityCount,
  sanitizeVirtualModelSnapshot,
  snapshotVirtualModelFromJobPayload,
} = virtualModelSnapshot;

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

test('builds a complete library model replacement context from a UI selection', () => {
  assert.equal(typeof buildLibraryModelReplaceContext, 'function');

  assert.deepEqual(buildLibraryModelReplaceContext({
    identitySource: 'library',
    librarySelection: {
      virtualModelId: ' model-1 ',
      virtualModelVersionId: ' version-1 ',
      modelName: '  Summer model  ',
      modelCode: ' VM-001 ',
      versionNumber: '3',
      selectedAssetIds: [' asset-1 ', 'asset-2', 'asset-3'],
      publishedAt: 123,
    },
  }), {
    identitySource: 'library',
    virtualModelSnapshot: {
      identitySource: 'library',
      virtualModelId: 'model-1',
      virtualModelVersionId: 'version-1',
      modelName: 'Summer model',
      modelCode: 'VM-001',
      versionNumber: 3,
      publishedAt: 123,
      selectedAssetIds: ['asset-1', 'asset-2', 'asset-3'],
    },
  });

  assert.equal(buildLibraryModelReplaceContext({
    identitySource: 'library',
    librarySelection: { virtualModelId: 'model-1' },
  }), undefined);
  assert.equal(buildLibraryModelReplaceContext({ identitySource: 'upload', librarySelection: null }), undefined);
});

test('derives model replacement identity count from one shared snapshot rule', () => {
  assert.equal(typeof getLibraryModelReplaceIdentityCount, 'function');

  assert.equal(getLibraryModelReplaceIdentityCount(snapshotWithCount(3)), 3);
  assert.equal(getLibraryModelReplaceIdentityCount(snapshotWithCount(4)), 4);
  assert.equal(getLibraryModelReplaceIdentityCount(snapshotWithCount(5)), 5);
  assert.equal(getLibraryModelReplaceIdentityCount(snapshotWithCount(2)), 3);
  assert.equal(getLibraryModelReplaceIdentityCount(null), 3);
});

test('builds library model replacement job metadata without leaking UI-only wrappers', () => {
  assert.equal(typeof buildLibraryModelReplaceJobMetadata, 'function');

  assert.deepEqual(buildLibraryModelReplaceJobMetadata({
    snapshot: {
      ...snapshotWithCount(3),
      modelName: 'Summer model',
      modelCode: 'VM-001',
      versionNumber: 2,
      allowHistoricalPublishedVersion: true,
    },
    referenceAnalysis: { index: 1, framing: 'portrait' },
  }), {
    identitySource: 'library',
    virtualModelId: 'model-1',
    virtualModelVersionId: 'version-1',
    modelName: 'Summer model',
    modelCode: 'VM-001',
    versionNumber: 2,
    allowHistoricalPublishedVersion: true,
    publishedAt: 123,
    selectedAssetIds: ['asset-1', 'asset-2', 'asset-3'],
    referenceAnalysis: { index: 1, framing: 'portrait' },
  });
});

test('rebuilds a URL-free historical retry snapshot from the authoritative job payload', () => {
  assert.equal(typeof snapshotVirtualModelFromJobPayload, 'function');
  assert.deepEqual(snapshotVirtualModelFromJobPayload({
    identitySource: 'library',
    virtualModelId: 'model-1',
    virtualModelVersionId: 'version-1',
    virtualModelNameSnapshot: '韩系女生',
    virtualModelCodeSnapshot: '001',
    publishedAt: 123,
    selectedAssetIds: ['asset-1', 'asset-2', 'asset-3'],
    imageUrls: ['https://must-not-leak.example/source.png'],
  }), {
    identitySource: 'library',
    virtualModelId: 'model-1',
    virtualModelVersionId: 'version-1',
    modelName: '韩系女生',
    modelCode: '001',
    allowHistoricalPublishedVersion: true,
    publishedAt: 123,
    selectedAssetIds: ['asset-1', 'asset-2', 'asset-3'],
  });
  assert.equal(snapshotVirtualModelFromJobPayload({ identitySource: 'upload' }), undefined);
});

test('snapshot tracker preserves the authoritative library snapshot across early job exits', () => {
  const tracker = createVirtualModelSnapshotTracker({
    identitySource: 'library',
    virtualModelId: 'model-1',
    virtualModelVersionId: 'version-1',
    virtualModelNameSnapshot: '韩系女生',
    publishedAt: 123,
    selectedAssetIds: ['asset-1', 'asset-2', 'asset-3'],
    imageUrls: ['https://must-not-leak.example/source.png'],
  });

  assert.deepEqual(tracker.attach({
    imageUrl: '',
    status: 'interrupted',
    message: '任务已取消',
  }), {
    imageUrl: '',
    status: 'interrupted',
    message: '任务已取消',
    virtualModelSnapshot: {
      identitySource: 'library',
      virtualModelId: 'model-1',
      virtualModelVersionId: 'version-1',
      modelName: '韩系女生',
      allowHistoricalPublishedVersion: true,
      publishedAt: 123,
      selectedAssetIds: ['asset-1', 'asset-2', 'asset-3'],
    },
  });

  tracker.update({ identitySource: 'upload' });
  assert.equal(tracker.current()?.virtualModelId, 'model-1');
});
