import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeShellDraftForStorage } from './appStateDraftMerge.mjs';

test('mergeShellDraftForStorage keeps existing non-empty prompt when incoming prompt is blank', () => {
  const merged = mergeShellDraftForStorage({
    inputStateByScope: {
      'one_click:sku': {
        promptText: '保留已有 SKU 草稿',
        params: { count: '3', tone: 'clean' },
      },
    },
  }, {
    inputStateByScope: {
      'one_click:sku': {
        promptText: '',
        params: { count: '5' },
      },
    },
  });

  assert.equal(merged.inputStateByScope['one_click:sku'].promptText, '保留已有 SKU 草稿');
  assert.deepEqual(merged.inputStateByScope['one_click:sku'].params, {
    count: '5',
    tone: 'clean',
  });
});

test('mergeShellDraftForStorage treats incoming material lists as authoritative per type', () => {
  const merged = mergeShellDraftForStorage({
    materials: {
      product: [{ id: 'old-product' }],
      styleRef: [{ id: 'style-ref' }],
    },
  }, {
    materials: {
      product: [{ id: 'new-product' }],
    },
  });

  assert.deepEqual(merged.materials.product, [{ id: 'new-product' }]);
  assert.deepEqual(merged.materials.styleRef, [{ id: 'style-ref' }]);
});

test('mergeShellDraftForStorage dedupes deletion tombstones and caps each list to newest 500 ids', () => {
  const oldIds = Array.from({ length: 510 }, (_, index) => `old-${index}`);
  const merged = mergeShellDraftForStorage({
    deletedJobIds: oldIds,
    deletedProjectIds: ['project-a'],
    deletedResultIds: ['result-a'],
  }, {
    deletedJobIds: ['old-509', 'new-job'],
    deletedProjectIds: ['project-a', 'project-b'],
    deletedResultIds: ['result-b'],
  });

  assert.equal(merged.deletedJobIds.length, 500);
  assert.equal(merged.deletedJobIds.at(0), 'old-11');
  assert.equal(merged.deletedJobIds.at(-1), 'new-job');
  assert.deepEqual(merged.deletedProjectIds, ['project-a', 'project-b']);
  assert.deepEqual(merged.deletedResultIds, ['result-a', 'result-b']);
});
