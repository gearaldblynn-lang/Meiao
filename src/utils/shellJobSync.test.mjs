import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_SHELL_JOB_SYNC_INTERVAL_MS,
  collectMissingActiveInternalJobIds,
  createAsyncScopeGuard,
  createCoalescedAsyncRunner,
  createScopedAsyncWriteQueue,
  getShellJobSyncIntervalMs,
  startShellJobSync,
} from './shellJobSync.ts';

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

class FakeEventTarget {
  listeners = new Map();

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type) {
    for (const listener of this.listeners.get(type) || []) listener({ type });
  }

  listenerCount() {
    return Array.from(this.listeners.values())
      .reduce((total, listeners) => total + listeners.size, 0);
  }
}

class FakeWindowTarget extends FakeEventTarget {
  nextTimerId = 1;
  timeouts = new Map();
  intervals = new Map();

  setTimeout(callback) {
    const timerId = this.nextTimerId++;
    this.timeouts.set(timerId, callback);
    return timerId;
  }

  clearTimeout(timerId) {
    this.timeouts.delete(timerId);
  }

  setInterval(callback, intervalMs) {
    const timerId = this.nextTimerId++;
    this.intervals.set(timerId, { callback, intervalMs });
    return timerId;
  }

  clearInterval(timerId) {
    this.intervals.delete(timerId);
  }

  runTimeouts() {
    const callbacks = Array.from(this.timeouts.values());
    this.timeouts.clear();
    callbacks.forEach((callback) => callback());
  }

  runIntervals() {
    Array.from(this.intervals.values()).forEach(({ callback }) => callback());
  }
}

class FakeDocumentTarget extends FakeEventTarget {
  visibilityState = 'hidden';
}

test('coalesces concurrent refresh requests into one trailing run', async () => {
  const operations = [];
  const operation = async () => {
    const gate = deferred();
    operations.push(gate);
    await gate.promise;
  };
  const run = createCoalescedAsyncRunner(operation);

  const first = run();
  const second = run();
  const third = run();
  assert.equal(operations.length, 1, 'only one backend snapshot may be in flight');

  operations[0].resolve();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(operations.length, 2, 'overlapping triggers collapse into one trailing refresh');

  operations[1].resolve();
  await Promise.all([first, second, third]);
  assert.equal(operations.length, 2);
});

test('a failed coalesced refresh does not wedge later refreshes', async () => {
  let attempts = 0;
  const run = createCoalescedAsyncRunner(async () => {
    attempts += 1;
    if (attempts === 1) throw new Error('temporary fetch failure');
  });

  await assert.rejects(run(), /temporary fetch failure/);
  await run();
  assert.equal(attempts, 2);
});

test('a failed in-flight refresh still consumes one already-requested trailing refresh', async () => {
  const firstAttempt = deferred();
  let attempts = 0;
  const run = createCoalescedAsyncRunner(async () => {
    attempts += 1;
    if (attempts === 1) await firstAttempt.promise;
  });

  const first = run();
  const trailing = run();
  firstAttempt.reject(new Error('temporary fetch failure'));

  await Promise.all([first, trailing]);
  assert.equal(attempts, 2, 'the failure must not discard the already-requested trailing refresh');
});

test('invalidating an async scope blocks deferred work captured by the old account', async () => {
  const scope = createAsyncScopeGuard();
  const isCurrent = scope.capture();
  const gate = deferred();
  let writes = 0;
  const deferredWrite = (async () => {
    await gate.promise;
    if (isCurrent()) writes += 1;
  })();

  scope.invalidate();
  gate.resolve();
  await deferredWrite;

  assert.equal(writes, 0);
  assert.equal(isCurrent(), false);
  assert.equal(scope.capture()(), true, 'new work captures the current account scope');
});

test('resetting the queue never lets an old-account writer mutate the new account', async () => {
  const scope = createAsyncScopeGuard();
  const queue = createScopedAsyncWriteQueue();
  const oldWriteStarted = deferred();
  const releaseOldWrite = deferred();
  const writes = [];

  const oldWrite = queue.enqueue(scope.capture(), async (isCurrent) => {
    oldWriteStarted.resolve();
    await releaseOldWrite.promise;
    if (!isCurrent()) return false;
    writes.push('old-account');
    return true;
  }, false);
  await oldWriteStarted.promise;

  scope.invalidate();
  queue.reset();
  const newWrite = queue.enqueue(scope.capture(), async (isCurrent) => {
    if (!isCurrent()) return false;
    writes.push('new-account');
    return true;
  }, false);

  assert.equal(await newWrite, true, 'the new account must not wait for an abandoned old queue');
  releaseOldWrite.resolve();
  assert.equal(await oldWrite, false, 'the old writer observes invalidation after its await');
  assert.deepEqual(writes, ['new-account']);
});

test('backfills only active internal job identities missing from the recent jobs window', () => {
  const activeMissingId = 'aaaaaaaaaaaaaaaaaaaaaaaa';
  const terminalMissingId = 'bbbbbbbbbbbbbbbbbbbbbbbb';
  const activeRecentId = 'cccccccccccccccccccccccc';

  const result = collectMissingActiveInternalJobIds([
    { id: activeMissingId, active: true },
    { id: terminalMissingId, active: false },
    { id: activeRecentId, active: true },
    { id: activeMissingId, active: true },
    { id: 'provider-task-id', active: true },
  ], [activeRecentId]);

  assert.deepEqual(result, [activeMissingId]);
});

test('uses a configurable but conservative shell job sync interval', () => {
  assert.equal(getShellJobSyncIntervalMs(undefined), DEFAULT_SHELL_JOB_SYNC_INTERVAL_MS);
  assert.equal(getShellJobSyncIntervalMs('5000'), 5000);
  assert.equal(getShellJobSyncIntervalMs('999'), DEFAULT_SHELL_JOB_SYNC_INTERVAL_MS);
  assert.equal(getShellJobSyncIntervalMs('not-a-number'), DEFAULT_SHELL_JOB_SYNC_INTERVAL_MS);
});

test('refreshes on initial mount, interval, foreground and network recovery', async () => {
  const windowTarget = new FakeWindowTarget();
  const documentTarget = new FakeDocumentTarget();
  let runCount = 0;
  const stop = startShellJobSync({
    run: async () => { runCount += 1; },
    intervalMs: 12_345,
    windowTarget,
    documentTarget,
  });

  assert.equal(runCount, 0, 'initial refresh is scheduled after the effect is mounted');
  assert.equal(windowTarget.intervals.values().next().value.intervalMs, 12_345);
  windowTarget.runTimeouts();
  await Promise.resolve();
  assert.equal(runCount, 1);

  windowTarget.runIntervals();
  await Promise.resolve();
  assert.equal(runCount, 2);

  windowTarget.dispatch('focus');
  await Promise.resolve();
  windowTarget.dispatch('pageshow');
  await Promise.resolve();
  windowTarget.dispatch('online');
  await Promise.resolve();
  assert.equal(runCount, 5);

  documentTarget.dispatch('visibilitychange');
  await Promise.resolve();
  assert.equal(runCount, 5, 'a hidden page must not cause another refresh');
  documentTarget.visibilityState = 'visible';
  documentTarget.dispatch('visibilitychange');
  await Promise.resolve();
  assert.equal(runCount, 6);

  stop();
  assert.equal(windowTarget.listenerCount(), 0);
  assert.equal(documentTarget.listenerCount(), 0);
  assert.equal(windowTarget.timeouts.size, 0);
  assert.equal(windowTarget.intervals.size, 0);

  windowTarget.dispatch('focus');
  documentTarget.dispatch('visibilitychange');
  windowTarget.runIntervals();
  await Promise.resolve();
  assert.equal(runCount, 6, 'cleanup prevents updates after the workspace is left');
});
