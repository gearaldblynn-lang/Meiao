import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveDeployDrainCleanup } from './deploy-lifecycle.mjs';

test('failure before a new process starts may release the drain without stopping a process', () => {
  assert.deepEqual(resolveDeployDrainCleanup({
    newProcessStarted: false,
    healthReady: false,
    newProcessStopped: false,
  }), { stopNewProcess: false, releaseDrain: true });
});

test('failed health requires stopping the new process before releasing the drain', () => {
  assert.deepEqual(resolveDeployDrainCleanup({
    newProcessStarted: true,
    healthReady: false,
    newProcessStopped: false,
  }), { stopNewProcess: true, releaseDrain: false });
  assert.deepEqual(resolveDeployDrainCleanup({
    newProcessStarted: true,
    healthReady: false,
    newProcessStopped: true,
  }), { stopNewProcess: false, releaseDrain: true });
});

test('healthy deployment may release the drain while keeping the new process running', () => {
  assert.deepEqual(resolveDeployDrainCleanup({
    newProcessStarted: true,
    healthReady: true,
    newProcessStopped: false,
  }), { stopNewProcess: false, releaseDrain: true });
});
