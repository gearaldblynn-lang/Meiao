import assert from 'node:assert/strict';
import test from 'node:test';

import { submitVirtualModelDelete } from './virtualModelDeleteSubmission.mjs';

test('delete submission admits only one same-tick request and stays locked until it settles', async () => {
  let releaseDelete;
  let releaseReload;
  const deleteGate = new Promise((resolve) => { releaseDelete = resolve; });
  const reloadGate = new Promise((resolve) => { releaseReload = resolve; });
  const pendingRef = { current: false };
  const pendingStates = [];
  const notices = [];
  const errors = [];
  let deleteCalls = 0;
  let closeCalls = 0;
  let reloadCalls = 0;
  const options = {
    target: { id: 'model-1' },
    pendingRef,
    setPending: (value) => pendingStates.push(value),
    setNotice: (value) => notices.push(value),
    setError: (value) => errors.push(value),
    deleteModel: async (id) => { deleteCalls += 1; assert.equal(id, 'model-1'); await deleteGate; },
    close: () => { closeCalls += 1; },
    reload: async () => { reloadCalls += 1; await reloadGate; },
  };

  const first = submitVirtualModelDelete(options);
  const second = submitVirtualModelDelete(options);

  assert.equal(deleteCalls, 1);
  assert.equal(pendingRef.current, true);
  assert.deepEqual(pendingStates, [true]);
  assert.equal(await second, false);
  assert.equal(closeCalls, 0);
  assert.equal(reloadCalls, 0);

  releaseDelete();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(reloadCalls, 1);
  assert.equal(pendingRef.current, true);
  assert.deepEqual(pendingStates, [true]);
  assert.equal(await submitVirtualModelDelete(options), false);

  releaseReload();
  assert.equal(await first, true);
  assert.equal(deleteCalls, 1);
  assert.equal(closeCalls, 1);
  assert.equal(reloadCalls, 1);
  assert.equal(pendingRef.current, false);
  assert.deepEqual(pendingStates, [true, false]);
  assert.deepEqual(notices, ['']);
  assert.deepEqual(errors, ['']);
});

test('failed delete stays open, reports its error, and releases the independent lock', async () => {
  const pendingRef = { current: false };
  const pendingStates = [];
  const errors = [];
  let closeCalls = 0;
  let reloadCalls = 0;

  const result = await submitVirtualModelDelete({
    target: { id: 'model-1' },
    pendingRef,
    setPending: (value) => pendingStates.push(value),
    setNotice: () => {},
    setError: (value) => errors.push(value),
    deleteModel: async () => { throw new Error('删除请求失败'); },
    close: () => { closeCalls += 1; },
    reload: async () => { reloadCalls += 1; },
  });

  assert.equal(result, false);
  assert.equal(closeCalls, 0);
  assert.equal(reloadCalls, 0);
  assert.deepEqual(errors, ['', '删除请求失败']);
  assert.equal(pendingRef.current, false);
  assert.deepEqual(pendingStates, [true, false]);
});

test('non-Error delete failures use the readable localized fallback', async () => {
  const errors = [];

  await submitVirtualModelDelete({
    target: { id: 'model-1' },
    pendingRef: { current: false },
    setPending: () => {},
    setNotice: () => {},
    setError: (value) => errors.push(value),
    deleteModel: async () => { throw null; },
    close: () => {},
    reload: async () => {},
  });

  assert.deepEqual(errors, ['', '删除失败']);
});
