import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createVirtualModelGenerationActionCoordinator,
} from './virtualModelGenerationActionCoordinator.mjs';

test('retry in progress rejects a concurrent cancel action', () => {
  const coordinator = createVirtualModelGenerationActionCoordinator();
  const retryToken = coordinator.begin('retry:C01');

  assert.ok(retryToken);
  assert.equal(coordinator.isBusy(), true);
  assert.equal(coordinator.begin('cancel'), null);
  assert.equal(coordinator.isCurrent(retryToken), true);
});

test('a stale action token cannot apply after a newer action begins', () => {
  const coordinator = createVirtualModelGenerationActionCoordinator();
  const first = coordinator.begin('retry:C01');
  assert.ok(first);
  assert.equal(coordinator.finish(first), true);

  const second = coordinator.begin('regenerate-derived');
  assert.ok(second);
  assert.equal(coordinator.isCurrent(first), false);
  assert.equal(coordinator.isCurrent(second), true);
  assert.ok(second.revision > first.revision);
});

test('dispose invalidates an in-flight action and every late response', () => {
  const coordinator = createVirtualModelGenerationActionCoordinator();
  const token = coordinator.begin('cancel');
  assert.ok(token);

  coordinator.dispose();

  assert.equal(coordinator.isCurrent(token), false);
  assert.equal(coordinator.finish(token), false);
  assert.equal(coordinator.begin('retry:C01'), null);
  assert.equal(coordinator.capturePoll(), null);
});

test('finishing the current action releases the gate for the next action', () => {
  const coordinator = createVirtualModelGenerationActionCoordinator();
  const first = coordinator.begin('retry:C01');
  assert.ok(first);
  assert.equal(coordinator.finish(first), true);
  assert.equal(coordinator.isBusy(), false);

  const second = coordinator.begin('cancel');
  assert.ok(second);
  assert.equal(second.actionId, 'cancel');
});

test('poll revisions cannot overwrite an action and accepted polls advance monotonically', () => {
  const coordinator = createVirtualModelGenerationActionCoordinator();
  const stalePoll = coordinator.capturePoll();
  assert.equal(typeof stalePoll, 'number');
  assert.equal(coordinator.isPollCurrent(stalePoll), true);

  const action = coordinator.begin('retry:C01');
  assert.ok(action);
  assert.equal(coordinator.isPollCurrent(stalePoll), false);
  assert.equal(coordinator.acceptPoll(stalePoll), false);
  assert.equal(coordinator.finish(action), true);

  const currentPoll = coordinator.capturePoll();
  assert.equal(typeof currentPoll, 'number');
  assert.equal(coordinator.acceptPoll(currentPoll), true);
  assert.equal(coordinator.acceptPoll(currentPoll), false);
});
