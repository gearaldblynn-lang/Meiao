import test from 'node:test';
import assert from 'node:assert/strict';

import { isDeployHealthReady } from './assert-deploy-health.mjs';

const healthy = {
  ok: true,
  release: { id: 'release-123' },
  worker: { healthy: true },
  managedImageUpload: { ready: true },
  tombstonedJobCleanup: { lastCycleAt: Date.now(), errors: 0 },
};

test('expected release id rejects an otherwise healthy old process', () => {
  assert.equal(isDeployHealthReady(healthy, { expectedReleaseId: 'release-123' }), true);
  assert.equal(isDeployHealthReady(healthy, { expectedReleaseId: 'release-old' }), false);
});

test('release identity remains optional for non-deploy health consumers', () => {
  const { release: _release, ...legacyHealth } = healthy;
  assert.equal(isDeployHealthReady(legacyHealth), true);
});
