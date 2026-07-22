import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import {
  createGracefulShutdown,
  listenAndNotifyReady,
  registerProcessShutdown,
  resolveServerListenConfig,
} from './processLifecycle.mjs';

test('production migration candidate is forced to loopback', () => {
  assert.deepEqual(resolveServerListenConfig({
    env: { NODE_ENV: 'production', PORT: '3101', MEIAO_BIND_HOST: '127.0.0.1' },
  }), { port: 3101, host: '127.0.0.1' });
  assert.throws(
    () => resolveServerListenConfig({
      env: { NODE_ENV: 'production', PORT: '3101', MEIAO_BIND_HOST: '0.0.0.0' },
    }),
    (error) => error?.code === 'migration_candidate_public_bind_forbidden',
  );
});

test('listenAndNotifyReady reports ready only after the server is listening', async () => {
  const events = [];
  const server = new EventEmitter();
  server.listen = (port, host, callback) => {
    events.push(`listen:${host}:${port}`);
    setImmediate(() => {
      events.push('listening');
      callback();
    });
  };

  const pending = listenAndNotifyReady({
    server,
    port: 3100,
    host: '127.0.0.1',
    send: (message) => events.push(`send:${message}`),
  });

  assert.deepEqual(events, ['listen:127.0.0.1:3100']);
  await pending;
  assert.deepEqual(events, ['listen:127.0.0.1:3100', 'listening', 'send:ready']);
});

test('listenAndNotifyReady rejects startup errors without reporting ready', async () => {
  const events = [];
  const server = new EventEmitter();
  server.listen = () => setImmediate(() => server.emit('error', new Error('EADDRINUSE')));

  await assert.rejects(
    listenAndNotifyReady({ server, port: 3100, send: (message) => events.push(message) }),
    /EADDRINUSE/,
  );
  assert.deepEqual(events, []);
});

test('graceful shutdown is idempotent and closes resources in safety order', async () => {
  const events = [];
  const server = {
    close(callback) {
      events.push('http');
      callback();
    },
    closeIdleConnections() {
      events.push('http-idle');
    },
  };
  const shutdown = createGracefulShutdown({
    server,
    stopWorkers: [() => events.push('worker')],
    clearTimers: [() => events.push('timer')],
    shutdownTemporal: async () => events.push('temporal'),
    closePools: [async () => events.push('pool')],
  });

  const first = shutdown();
  const second = shutdown();
  assert.equal(first, second);
  await Promise.all([first, second]);

  assert.deepEqual(events, ['worker', 'timer', 'temporal', 'http', 'http-idle', 'pool']);
});

test('registerProcessShutdown handles the first signal once and exits after cleanup', async () => {
  const processRef = new EventEmitter();
  const events = [];
  processRef.exit = (code) => events.push(`exit:${code}`);
  const shutdown = async () => events.push('shutdown');

  registerProcessShutdown({ processRef, shutdown });
  processRef.emit('SIGINT');
  processRef.emit('SIGTERM');
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(events, ['shutdown', 'exit:0']);
});
