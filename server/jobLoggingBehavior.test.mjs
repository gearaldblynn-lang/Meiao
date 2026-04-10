import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const jobManagerSource = readFileSync(new URL('./jobManager.mjs', import.meta.url), 'utf8');
const localJobStoreSource = readFileSync(new URL('./localJobStore.mjs', import.meta.url), 'utf8');

test('failed job logs keep providerTaskId from the thrown provider error', () => {
  assert.match(jobManagerSource, /providerTaskId: error\?\.providerTaskId \|\| latestJob\.providerTaskId \|\| ''/);
  assert.match(localJobStoreSource, /providerTaskId: error\?\.providerTaskId \|\| failedJob\.providerTaskId \|\| ''/);
});
