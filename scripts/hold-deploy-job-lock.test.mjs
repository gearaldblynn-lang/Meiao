import test from 'node:test';
import assert from 'node:assert/strict';

import { holdDeployJobTableLock } from './hold-deploy-job-lock.mjs';

const createConnection = ({ runningRows = [], events }) => ({
  async query(sql) {
    const normalized = String(sql).replace(/\s+/g, ' ').trim();
    if (normalized.startsWith('SELECT GET_LOCK')) {
      events.push('lock');
      return [[{ acquired: 1 }]];
    }
    else if (normalized.startsWith('SELECT task_type')) {
      events.push('query-running');
      return [runningRows];
    } else if (normalized === 'SELECT 1 AS lock_session_alive') events.push('liveness');
    else if (normalized.startsWith('SELECT RELEASE_LOCK')) {
      events.push('unlock');
      return [[{ released: 1 }]];
    }
    return [[]];
  },
  async end() {
    events.push('end');
  },
});

test('job lock is acknowledged before waiting and held until release', async () => {
  const events = [];
  let released = false;
  const result = await holdDeployJobTableLock({
    connection: createConnection({ events }),
    acknowledgeReady: async (summary) => events.push(`ready:${summary.runningCount}`),
    isReleased: () => released,
    sleep: async () => {
      events.push('sleep');
      released = true;
    },
  });

  assert.equal(result.ready, true);
  assert.deepEqual(events, [
    'lock',
    'query-running',
    'ready:0',
    'sleep',
    'liveness',
    'unlock',
    'end',
  ]);
});

test('job lock fails closed when a running task appears under the lock', async () => {
  const events = [];
  const connection = createConnection({
    events,
    runningRows: [{ task_type: 'image_generation', provider: 'kie', started_at: Date.now() }],
  });

  await assert.rejects(
    holdDeployJobTableLock({
      connection,
      acknowledgeReady: async () => events.push('ready'),
      isReleased: () => true,
    }),
    (error) => error?.code === 'deploy_active_jobs',
  );

  assert.deepEqual(events, ['lock', 'query-running', 'unlock', 'end']);
});

test('active-job override remains explicit and visible in the ready summary', async () => {
  const events = [];
  let summary = null;
  const result = await holdDeployJobTableLock({
    connection: createConnection({
      events,
      runningRows: [{ task_type: 'image_generation', provider: 'kie', started_at: Date.now() }],
    }),
    env: { MEIAO_DEPLOY_ALLOW_ACTIVE_JOBS: '1' },
    acknowledgeReady: async (value) => { summary = value; },
    isReleased: () => true,
  });

  assert.equal(result.override, true);
  assert.equal(summary.runningCount, 1);
  assert.deepEqual(events, ['lock', 'query-running', 'unlock', 'end']);
});
