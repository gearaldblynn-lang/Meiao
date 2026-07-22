import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);

test('production PM2 app uses one ready-gated cluster instance', () => {
  const ecosystem = require('../ecosystem.config.cjs');
  const app = ecosystem.apps.find((item) => item.name === 'meiao-internal');

  assert.equal(app.instances, 1);
  assert.equal(app.exec_mode, 'cluster');
  assert.equal(app.wait_ready, true);
  assert.equal(app.listen_timeout, 120000);
  assert.equal(app.kill_timeout, 30000);
  assert.equal(app.env.MEIAO_BIND_HOST, '0.0.0.0');
});

test('server health exposes immutable release identity', () => {
  const source = readFileSync(new URL('./index.mjs', import.meta.url), 'utf8');

  assert.match(source, /const processRelease = getProcessReleaseIdentity\(\);/);
  assert.match(source, /release: processRelease/);
});

test('server bind host is configurable for loopback-only migration candidates', () => {
  const source = readFileSync(new URL('./index.mjs', import.meta.url), 'utf8');

  assert.match(source, /const \{ port: PORT, host: BIND_HOST \} = resolveServerListenConfig\(\)/);
  assert.match(source, /listenAndNotifyReady\(\{ server, port: PORT, host: BIND_HOST \}\)/);
});
