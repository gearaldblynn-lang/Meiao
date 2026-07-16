import assert from 'node:assert/strict';
import test from 'node:test';

import { scrubUnavailableExplicitManagedAssetIds } from './managedAssetStateScrub.mjs';

test('state scrub removes stale explicit managed asset ids but preserves active and local identities', () => {
  const input = {
    result: {
      imageUrlAssetId: 'asset-stale',
      sourceAssetId: 'asset-active',
      localAssetId: 'draft-local-image',
      nested: [{ assetId: 'asset-stale' }, { assetId: 'asset-active' }],
    },
  };

  const output = scrubUnavailableExplicitManagedAssetIds(input, new Set(['asset-active']));

  assert.deepEqual(output, {
    result: {
      sourceAssetId: 'asset-active',
      localAssetId: 'draft-local-image',
      nested: [{}, { assetId: 'asset-active' }],
    },
  });
  assert.equal(input.result.imageUrlAssetId, 'asset-stale', 'scrub must not mutate caller state');
});

test('state scrub leaves non-managed metadata ending in Id untouched', () => {
  assert.deepEqual(
    scrubUnavailableExplicitManagedAssetIds({ projectId: 'project-1', requestId: 'request-1' }, new Set()),
    { projectId: 'project-1', requestId: 'request-1' },
  );
});
