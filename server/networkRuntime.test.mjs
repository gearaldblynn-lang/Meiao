import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

let networkRuntime = {};
try {
  networkRuntime = await import('./networkRuntime.mjs');
} catch {
  // RED phase: the module does not exist yet.
}

test('server network runtime uses a conservative configurable family-attempt timeout', () => {
  assert.equal(typeof networkRuntime.getNetworkFamilyAttemptTimeoutMs, 'function');
  assert.equal(networkRuntime.getNetworkFamilyAttemptTimeoutMs({}), 1000);
  assert.equal(networkRuntime.getNetworkFamilyAttemptTimeoutMs({
    MEIAO_NETWORK_FAMILY_ATTEMPT_TIMEOUT_MS: '1400',
  }), 1400);
  assert.equal(networkRuntime.getNetworkFamilyAttemptTimeoutMs({
    MEIAO_NETWORK_FAMILY_ATTEMPT_TIMEOUT_MS: '100',
  }), 250);
  assert.equal(networkRuntime.getNetworkFamilyAttemptTimeoutMs({
    MEIAO_NETWORK_FAMILY_ATTEMPT_TIMEOUT_MS: '99999',
  }), 5000);
});

test('server network runtime applies the resolved timeout through node net', () => {
  assert.equal(typeof networkRuntime.configureServerNetworkRuntime, 'function');
  const applied = [];
  const result = networkRuntime.configureServerNetworkRuntime({
    MEIAO_NETWORK_FAMILY_ATTEMPT_TIMEOUT_MS: '1250',
  }, {
    getDefaultAutoSelectFamilyAttemptTimeout: () => 250,
    setDefaultAutoSelectFamilyAttemptTimeout: (value) => applied.push(value),
  });

  assert.deepEqual(applied, [1250]);
  assert.deepEqual(result, { previousMs: 250, appliedMs: 1250 });
});

test('server configures network runtime after loading env files', async () => {
  const source = await readFile(new URL('./index.mjs', import.meta.url), 'utf8');
  const envLoadIndex = source.indexOf("loadServerEnvFile({ envPath: path.join(__dirname, '..', '.env.local') });");
  const configureIndex = source.indexOf('configureServerNetworkRuntime(process.env);');

  assert.ok(envLoadIndex >= 0, 'server env loading must remain present');
  assert.ok(configureIndex > envLoadIndex, 'network runtime must be configured after env loading');
});
