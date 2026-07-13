import test from 'node:test';
import assert from 'node:assert/strict';

import * as holdDeployDrain from './hold-deploy-drain.mjs';

const {
  acquireBootstrapJobTableLock,
  stopOldProcessWithLockVerification,
} = holdDeployDrain;
import { isDeployHealthReady } from './assert-deploy-health.mjs';

test('bootstrap drain locks the jobs table before checking the final active count', async () => {
  const events = [];
  const connection = {
    query: async (sql) => {
      events.push(sql.replace(/\s+/g, ' ').trim());
      if (/SELECT task_type/.test(sql)) return [[]];
      return [[], []];
    },
  };

  const result = await acquireBootstrapJobTableLock({ connection, env: {} });

  assert.equal(result.ready, true);
  assert.match(events[0], /^LOCK TABLES internal_jobs WRITE$/);
  assert.match(events[1], /FROM internal_jobs/);
});

test('bootstrap drain fails closed when old-process work is still running', async () => {
  const connection = {
    query: async (sql) => {
      if (/SELECT task_type/.test(sql)) {
        return [[{
          task_type: 'kie_chat',
          provider: 'kie',
          provider_task_id: '',
          started_at: 1000,
        }]];
      }
      return [[], []];
    },
  };

  const result = await acquireBootstrapJobTableLock({ connection, env: {} });
  assert.equal(result.ready, false);
  assert.equal(result.runningCount, 1);
  assert.equal(result.override, false);
});

test('bootstrap drain keeps active-job override explicit', async () => {
  const connection = {
    query: async (sql) => (/SELECT task_type/.test(sql)
      ? [[{ task_type: 'kie_image', provider: 'kie', provider_task_id: 'task-1', started_at: 1000 }]]
      : [[], []]),
  };

  const result = await acquireBootstrapJobTableLock({
    connection,
    env: { MEIAO_DEPLOY_ALLOW_ACTIVE_JOBS: '1' },
  });
  assert.equal(result.ready, true);
  assert.equal(result.override, true);
});

test('lock holder stops and verifies the old process before acknowledging on the same session', async () => {
  const events = [];
  const result = await stopOldProcessWithLockVerification({
    connection: {
      query: async (sql) => {
        events.push(`query:${sql}`);
        return [[{ lock_session_alive: 1 }]];
      },
    },
    processManager: {
      exists: async () => {
        events.push('pm2:exists');
        return true;
      },
      stop: async () => {
        events.push('pm2:stop');
      },
      isStopped: async () => {
        events.push('pm2:verify-stopped');
        return true;
      },
    },
    acknowledgeStopAttempted: async (appExisted) => {
      events.push(`stop-attempted:${appExisted}`);
    },
    acknowledgeStopped: async (appExisted) => {
      events.push(`ack:${appExisted}`);
    },
  });

  assert.deepEqual(events, [
    'pm2:exists',
    'stop-attempted:true',
    'pm2:stop',
    'pm2:verify-stopped',
    'query:SELECT 1 AS lock_session_alive',
    'ack:true',
  ]);
  assert.deepEqual(result, { appExisted: true, stopped: true });
});

test('lock loss after PM2 stop never emits a false stopped acknowledgement', async () => {
  let stopAttempted = false;
  let acknowledged = false;
  await assert.rejects(
    () => stopOldProcessWithLockVerification({
      connection: {
        query: async () => { throw new Error('mysql connection lost'); },
      },
      processManager: {
        exists: async () => true,
        stop: async () => {},
        isStopped: async () => true,
      },
      acknowledgeStopAttempted: async () => { stopAttempted = true; },
      acknowledgeStopped: async () => { acknowledged = true; },
    }),
    /mysql connection lost/,
  );
  assert.equal(stopAttempted, true);
  assert.equal(acknowledged, false);
});

test('failed PM2 stop verification never emits a stopped acknowledgement', async () => {
  let stopAttempted = false;
  let acknowledged = false;
  await assert.rejects(
    () => stopOldProcessWithLockVerification({
      connection: { query: async () => [[{ lock_session_alive: 1 }]] },
      processManager: {
        exists: async () => true,
        stop: async () => {},
        isStopped: async () => false,
      },
      acknowledgeStopAttempted: async () => { stopAttempted = true; },
      acknowledgeStopped: async () => { acknowledged = true; },
    }),
    /PM2 process is still running/,
  );
  assert.equal(stopAttempted, true);
  assert.equal(acknowledged, false);
});

test('failed PM2 stop preserves pre-stop attempt evidence without a stopped acknowledgement', async () => {
  const events = [];
  await assert.rejects(
    () => stopOldProcessWithLockVerification({
      connection: { query: async () => [[{ lock_session_alive: 1 }]] },
      processManager: {
        exists: async () => true,
        stop: async () => {
          events.push('pm2:stop');
          throw new Error('pm2 stop failed');
        },
        isStopped: async () => {
          events.push('pm2:verify-stopped');
          return false;
        },
      },
      acknowledgeStopAttempted: async () => { events.push('stop-attempted'); },
      acknowledgeStopped: async () => { events.push('stopped'); },
    }),
    /pm2 stop failed/,
  );
  assert.deepEqual(events, ['stop-attempted', 'pm2:stop']);
});

test('real PM2 process manager requires successful explicit all-zero pid output', async () => {
  const createPm2ProcessManager = holdDeployDrain.createPm2ProcessManager;
  assert.equal(typeof createPm2ProcessManager, 'function');

  const isStoppedFor = async (stdout) => createPm2ProcessManager(
    'meiao-internal',
    async () => ({ stdout }),
  ).isStopped();

  assert.equal(await isStoppedFor('0\n'), true);
  assert.equal(await isStoppedFor('0\n00\n'), true);
  assert.equal(await isStoppedFor(''), false);
  assert.equal(await isStoppedFor('321\n'), false);
  await assert.rejects(
    () => createPm2ProcessManager('meiao-internal', async () => {
      throw new Error('pm2 pid failed');
    }).isStopped(),
    /pm2 pid failed/,
  );
});

test('deployment health requires both HTTP and worker health', () => {
  assert.equal(isDeployHealthReady({ ok: true, worker: { healthy: true } }), true);
  assert.equal(isDeployHealthReady({ ok: true, worker: { healthy: false } }), false);
  assert.equal(isDeployHealthReady({ ok: false, worker: { healthy: true } }), false);
});
