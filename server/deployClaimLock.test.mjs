import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  acquireDeployJobClaimLock,
  releaseDeployJobClaimLock,
  runWithDeployJobClaimLock,
} from './deployClaimLock.mjs';

const createNamedLockHarness = () => {
  let owner = null;
  const waiters = [];
  const events = [];
  const grantNext = () => {
    if (owner || waiters.length === 0) return;
    const next = waiters.shift();
    owner = next.connectionName;
    next.resolve([[{ acquired: 1 }]]);
  };
  const createConnection = (connectionName) => ({
    async query(sql) {
      const normalized = String(sql).replace(/\s+/g, ' ').trim();
      if (normalized.startsWith('SELECT GET_LOCK')) {
        events.push(`${connectionName}:wait-lock`);
        if (!owner) {
          owner = connectionName;
          events.push(`${connectionName}:acquired`);
          return [[{ acquired: 1 }]];
        }
        return new Promise((resolve) => waiters.push({
          connectionName,
          resolve: (value) => {
            events.push(`${connectionName}:acquired`);
            resolve(value);
          },
        }));
      }
      if (normalized.startsWith('SELECT RELEASE_LOCK')) {
        assert.equal(owner, connectionName);
        events.push(`${connectionName}:released`);
        owner = null;
        grantNext();
        return [[{ released: 1 }]];
      }
      throw new Error(`Unexpected SQL: ${normalized}`);
    },
    release() {
      events.push(`${connectionName}:connection-release`);
    },
  });
  return { createConnection, events };
};

test('worker that passed its first marker check cannot claim after deploy barrier releases', async () => {
  const harness = createNamedLockHarness();
  const deployConnection = harness.createConnection('deploy');
  const workerConnection = harness.createConnection('worker');
  let markerActive = false;
  let claimCalls = 0;

  await acquireDeployJobClaimLock({ connection: deployConnection });
  const workerAttempt = runWithDeployJobClaimLock({
    pool: { getConnection: async () => workerConnection },
    isExecutionPaused: () => markerActive,
    claim: async () => { claimCalls += 1; },
  });
  await new Promise((resolve) => setImmediate(resolve));

  markerActive = true;
  await releaseDeployJobClaimLock({ connection: deployConnection });
  const result = await workerAttempt;

  assert.equal(result.paused, true);
  assert.equal(claimCalls, 0);
  assert.deepEqual(harness.events, [
    'deploy:wait-lock',
    'deploy:acquired',
    'worker:wait-lock',
    'deploy:released',
    'worker:acquired',
    'worker:released',
    'worker:connection-release',
  ]);
});

test('both mysql claim paths and deploy barrier share the named-lock protocol', () => {
  const classicWorker = readFileSync(new URL('./jobManager.mjs', import.meta.url), 'utf8');
  const temporalWorker = readFileSync(new URL('./temporalWorker.mjs', import.meta.url), 'utf8');
  const deployBarrier = readFileSync(new URL('../scripts/hold-deploy-job-lock.mjs', import.meta.url), 'utf8');

  assert.match(classicWorker, /runWithDeployJobClaimLock\(\{[\s\S]*?isExecutionPaused[\s\S]*?connection\.query/);
  assert.match(temporalWorker, /runWithDeployJobClaimLock\(\{[\s\S]*?isExecutionPaused[\s\S]*?connection\.query/);
  assert.match(deployBarrier, /acquireDeployJobClaimLock\(\{ connection, env \}\)/);
  assert.match(deployBarrier, /releaseDeployJobClaimLock\(\{ connection, env \}\)/);
  assert.doesNotMatch(deployBarrier, /LOCK TABLES/);
});

test('claim connection is destroyed instead of pooled when named-lock release is unproven', async () => {
  const events = [];
  const connection = {
    async query(sql) {
      if (String(sql).includes('GET_LOCK')) return [[{ acquired: 1 }]];
      if (String(sql).includes('RELEASE_LOCK')) return [[{ released: 0 }]];
      throw new Error('unexpected query');
    },
    destroy() { events.push('destroy'); },
    release() { events.push('release'); },
  };

  await assert.rejects(
    runWithDeployJobClaimLock({
      pool: { getConnection: async () => connection },
      isExecutionPaused: () => false,
      claim: async () => 'claimed',
    }),
    (error) => error?.code === 'deploy_job_claim_lock_release_failed',
  );
  assert.deepEqual(events, ['destroy']);
});
