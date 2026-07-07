import assert from 'node:assert/strict';
import test from 'node:test';

import { isNewVersion, startVersionWatch } from './frontendVersionWatch.ts';

test('isNewVersion only fires on a non-empty differing remote buildId', () => {
  assert.equal(isNewVersion('abc', { buildId: 'def' }), true);
  assert.equal(isNewVersion('abc', { buildId: 'abc' }), false);
  assert.equal(isNewVersion('abc', { buildId: '' }), false);
  assert.equal(isNewVersion('abc', {}), false);
  assert.equal(isNewVersion('abc', null), false);
});

test('startVersionWatch notifies once on new version and stops cleanly', async () => {
  const originalDocument = globalThis.document;
  const listeners = new Map();
  globalThis.document = {
    visibilityState: 'visible',
    addEventListener: (name, fn) => listeners.set(name, fn),
    removeEventListener: (name) => listeners.delete(name),
  };
  try {
    let notifiedWith = null;
    let notifyCount = 0;
    const stop = startVersionWatch({
      currentBuildId: 'old',
      intervalMs: 5,
      fetchVersion: async () => ({ buildId: 'new' }),
      onNewVersion: (id) => { notifiedWith = id; notifyCount += 1; },
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    stop();
    assert.equal(notifiedWith, 'new');
    assert.equal(notifyCount, 1, 'should notify exactly once even across multiple ticks');
    assert.equal(listeners.size, 0, 'visibilitychange listener should be removed on stop');
  } finally {
    globalThis.document = originalDocument;
  }
});

test('startVersionWatch stays silent when remote version matches or fetch fails', async () => {
  const originalDocument = globalThis.document;
  globalThis.document = {
    visibilityState: 'visible',
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  try {
    let notified = false;
    const stopSame = startVersionWatch({
      currentBuildId: 'same',
      intervalMs: 5,
      fetchVersion: async () => ({ buildId: 'same' }),
      onNewVersion: () => { notified = true; },
    });
    const stopNull = startVersionWatch({
      currentBuildId: 'same',
      intervalMs: 5,
      fetchVersion: async () => null,
      onNewVersion: () => { notified = true; },
    });
    await new Promise((resolve) => setTimeout(resolve, 25));
    stopSame();
    stopNull();
    assert.equal(notified, false);
  } finally {
    globalThis.document = originalDocument;
  }
});
