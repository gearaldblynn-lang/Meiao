import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isSuccessfulPm2StoppedStatus,
  resolveDeployDrainCleanup,
} from './deploy-lifecycle.mjs';

test('failure before a new process starts may release the drain without stopping a process', () => {
  assert.deepEqual(resolveDeployDrainCleanup({
    oldProcessStopped: false,
    oldProcessStopAttempted: false,
    newProcessStarted: false,
    healthReady: false,
    newProcessStopped: false,
  }), { stopNewProcess: false, releaseDrain: true, serviceDown: false });
});

test('failure after old stop and before new start retains gates as service-down', () => {
  assert.deepEqual(resolveDeployDrainCleanup({
    oldProcessStopped: true,
    oldProcessStopAttempted: true,
    newProcessStarted: false,
    healthReady: false,
    newProcessStopped: false,
  }), { stopNewProcess: false, releaseDrain: false, serviceDown: true });
});

test('an attempted but unverified old-process stop retains gates before a new process starts', () => {
  assert.deepEqual(resolveDeployDrainCleanup({
    oldProcessStopped: false,
    oldProcessStopAttempted: true,
    newProcessStarted: false,
    healthReady: false,
    newProcessStopped: false,
  }), { stopNewProcess: false, releaseDrain: false, serviceDown: true });
});

test('failed health requires stopping the new process before releasing the drain', () => {
  assert.deepEqual(resolveDeployDrainCleanup({
    oldProcessStopped: true,
    oldProcessStopAttempted: true,
    newProcessStarted: true,
    healthReady: false,
    newProcessStopped: false,
  }), { stopNewProcess: true, releaseDrain: false, serviceDown: false });
  assert.deepEqual(resolveDeployDrainCleanup({
    oldProcessStopped: true,
    oldProcessStopAttempted: true,
    newProcessStarted: true,
    healthReady: false,
    newProcessStopped: true,
  }), { stopNewProcess: false, releaseDrain: true, serviceDown: false });
});

test('healthy deployment may release the drain while keeping the new process running', () => {
  assert.deepEqual(resolveDeployDrainCleanup({
    oldProcessStopped: true,
    oldProcessStopAttempted: true,
    newProcessStarted: true,
    healthReady: true,
    newProcessStopped: false,
  }), { stopNewProcess: false, releaseDrain: true, serviceDown: false });
});

test('PM2 stopped proof requires a successful command with explicit zero pid output', () => {
  assert.equal(isSuccessfulPm2StoppedStatus({ commandSucceeded: true, output: '0\n' }), true);
  assert.equal(isSuccessfulPm2StoppedStatus({ commandSucceeded: true, output: '0\n0\n' }), true);
  assert.equal(isSuccessfulPm2StoppedStatus({ commandSucceeded: true, output: '' }), false);
  assert.equal(isSuccessfulPm2StoppedStatus({ commandSucceeded: true, output: '321\n' }), false);
  assert.equal(isSuccessfulPm2StoppedStatus({ commandSucceeded: false, output: '0\n' }), false);
});
