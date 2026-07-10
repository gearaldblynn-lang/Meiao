import assert from 'node:assert/strict';
import test from 'node:test';

import { planBuyerShowSetsConcurrently } from './buyerShowPlanning.ts';

test('buyer-show set planning starts every set before waiting for the first result', async () => {
  const started = [];
  const resolvers = [];
  const planning = planBuyerShowSetsConcurrently(3, (setIndex) => new Promise((resolve) => {
    started.push(setIndex);
    resolvers[setIndex] = () => resolve(`set-${setIndex + 1}`);
  }));

  await Promise.resolve();
  assert.deepEqual(started, [0, 1, 2]);

  resolvers[2]();
  resolvers[0]();
  resolvers[1]();
  assert.deepEqual(await planning, ['set-1', 'set-2', 'set-3']);
});

test('buyer-show set planning skips work for an empty set count', async () => {
  let invoked = false;
  const results = await planBuyerShowSetsConcurrently(0, async () => {
    invoked = true;
    return 'unexpected';
  });

  assert.deepEqual(results, []);
  assert.equal(invoked, false);
});
