import test from 'node:test';
import assert from 'node:assert/strict';

import { selectExpiredAssetsForCleanup } from './assetStore.mjs';

test('selectExpiredAssetsForCleanup only returns expired unreferenced records', () => {
  const now = Date.now();
  const rows = [
    { id: 'keep-ref', expiresAt: now - 1000, deletedAt: null, publicUrl: 'https://a', isReferenced: true },
    { id: 'keep-live', expiresAt: now + 1000, deletedAt: null, publicUrl: 'https://b', isReferenced: false },
    { id: 'delete-me', expiresAt: now - 1000, deletedAt: null, publicUrl: 'https://c', isReferenced: false },
    { id: 'already-deleted', expiresAt: now - 1000, deletedAt: now - 10, publicUrl: 'https://d', isReferenced: false },
  ];

  assert.deepEqual(
    selectExpiredAssetsForCleanup(rows, now).map((item) => item.id),
    ['delete-me']
  );
});
