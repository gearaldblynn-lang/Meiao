import test from 'node:test';
import assert from 'node:assert/strict';

import * as subtitleRemovalBatch from './subtitleRemovalBatch.mjs';

const {
  mapWithSubtitleConcurrency,
  pickSubtitlePreparationItems,
  summarizeSubtitleRemovalBatch,
} = subtitleRemovalBatch;

test('batch summary counts selected ready and failed items independently', () => {
  assert.deepEqual(summarizeSubtitleRemovalBatch([
    {
      clientItemId: 'ready-selected',
      selected: true,
      phase: 'ready',
      draft: { sourceUrl: '/api/assets/file/ready.mp4', durationSeconds: 3.2 },
    },
    {
      clientItemId: 'failed-selected',
      selected: true,
      phase: 'error',
      draft: { durationSeconds: 7 },
    },
    {
      clientItemId: 'ready-unselected',
      selected: false,
      phase: 'ready',
      draft: { sourceUrl: '/api/assets/file/unselected.mp4', durationSeconds: 4 },
    },
  ]), {
    totalCount: 3,
    selectedCount: 2,
    readySelectedCount: 1,
    errorCount: 1,
    totalSelectedDurationSeconds: 10.2,
  });
});

test('preparation picker fills only free slots in FIFO order', () => {
  const items = [
    { clientItemId: 'a', phase: 'queued' },
    { clientItemId: 'b', phase: 'uploading' },
    { clientItemId: 'c', phase: 'queued' },
    { clientItemId: 'd', phase: 'queued' },
  ];

  assert.deepEqual(
    pickSubtitlePreparationItems(items, ['b'], 3).map((item) => item.clientItemId),
    ['a', 'c'],
  );
  assert.deepEqual(pickSubtitlePreparationItems(items, ['b'], 1), []);
});

test('region reminder waits for the upload group to settle, then selects its first ready video', () => {
  assert.equal(typeof subtitleRemovalBatch.resolveSubtitleRegionReminder, 'function');
  const pendingIds = ['first', 'second'];
  assert.deepEqual(subtitleRemovalBatch.resolveSubtitleRegionReminder([
    { clientItemId: 'first', phase: 'ready', draft: { sourceUrl: '/api/assets/file/first.mp4' } },
    { clientItemId: 'second', phase: 'transcoding' },
  ], pendingIds), { settled: false, targetId: '' });

  assert.deepEqual(subtitleRemovalBatch.resolveSubtitleRegionReminder([
    { clientItemId: 'first', phase: 'ready', draft: { sourceUrl: '/api/assets/file/first.mp4' } },
    { clientItemId: 'second', phase: 'error' },
  ], pendingIds), { settled: true, targetId: 'first' });
});

test('bounded mapper preserves item order and returns partial failures', async () => {
  let active = 0;
  let peak = 0;
  const settlements = await mapWithSubtitleConcurrency(['a', 'b', 'c', 'd'], 2, async (item) => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, item === 'a' ? 8 : 1));
    active -= 1;
    if (item === 'c') throw new Error('item-c-failed');
    return item.toUpperCase();
  });

  assert.equal(peak, 2);
  assert.deepEqual(settlements.map((item) => item.status), [
    'fulfilled',
    'fulfilled',
    'rejected',
    'fulfilled',
  ]);
  assert.equal(settlements[0].value, 'A');
  assert.equal(settlements[2].reason.message, 'item-c-failed');
  assert.equal(settlements[3].value, 'D');
});

test('bounded mapper handles an empty batch without creating workers', async () => {
  let calls = 0;
  const settlements = await mapWithSubtitleConcurrency([], 2, async () => {
    calls += 1;
  });
  assert.deepEqual(settlements, []);
  assert.equal(calls, 0);
});
