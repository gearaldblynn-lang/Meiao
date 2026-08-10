import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

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
  assert.equal(app.out_file, '/var/log/meiao/app-out.log');
  assert.equal(app.error_file, '/var/log/meiao/app-error.log');
  assert.equal(app.merge_logs, true);
});

test('production PM2 app drops to the configured non-root service identity', () => {
  const configPath = fileURLToPath(new URL('../ecosystem.config.cjs', import.meta.url));
  const result = spawnSync(process.execPath, ['-e', [
    `const app=require(${JSON.stringify(configPath)}).apps[0]`,
    `process.stdout.write(JSON.stringify({uid:app.uid,gid:app.gid}))`,
  ].join(';')], {
    encoding: 'utf8',
    env: {
      ...process.env,
      MEIAO_APP_SERVICE_USER: 'meiao-app',
      MEIAO_APP_SERVICE_GROUP: 'meiao-app',
    },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { uid: 'meiao-app', gid: 'meiao-app' });
});

test('production PM2 app rejects incomplete or root service identities', () => {
  const configPath = fileURLToPath(new URL('../ecosystem.config.cjs', import.meta.url));
  for (const identity of [
    { MEIAO_APP_SERVICE_USER: 'meiao-app', MEIAO_APP_SERVICE_GROUP: '' },
    { MEIAO_APP_SERVICE_USER: 'root', MEIAO_APP_SERVICE_GROUP: 'root' },
  ]) {
    const result = spawnSync(process.execPath, ['-e', `require(${JSON.stringify(configPath)})`], {
      encoding: 'utf8',
      env: { ...process.env, ...identity },
    });
    assert.notEqual(result.status, 0, JSON.stringify(identity));
  }
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
