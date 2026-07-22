import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { loadServerEnvFile } from './envLoader.mjs';

test('loadServerEnvFile reads .env.server style key-value pairs without overriding existing env', () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'meiao-env-'));
  const envPath = path.join(tempDir, '.env.server');
  writeFileSync(
    envPath,
    [
      'MEIAO_DB_HOST=127.0.0.1',
      'MEIAO_DB_PORT=3306',
      'KIE_API_KEY=test-kie',
      'MEIAO_ALLOWED_ORIGINS=https://a.example.com,https://b.example.com',
    ].join('\n'),
    'utf8'
  );

  const targetEnv = {
    KIE_API_KEY: 'already-set',
  };

  const loaded = loadServerEnvFile({
    envPath,
    targetEnv,
  });

  assert.equal(loaded, true);
  assert.equal(targetEnv.MEIAO_DB_HOST, '127.0.0.1');
  assert.equal(targetEnv.MEIAO_DB_PORT, '3306');
  assert.equal(targetEnv.KIE_API_KEY, 'already-set');
  assert.equal(targetEnv.MEIAO_ALLOWED_ORIGINS, 'https://a.example.com,https://b.example.com');
});

test('loadServerEnvFile returns false when file is missing', () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'meiao-env-missing-'));
  const envPath = path.join(tempDir, '.env.server');
  const targetEnv = {};

  const loaded = loadServerEnvFile({
    envPath,
    targetEnv,
  });

  assert.equal(loaded, false);
  assert.deepEqual(targetEnv, {});
});

test('loadServerEnvFile decodes JSON-serialized double-quoted dotenv values', () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'meiao-env-quoted-'));
  const envPath = path.join(tempDir, '.env.server');
  const expected = 'fixture credential with spaces #, a "quote", and \\backslash';
  writeFileSync(envPath, `KIE_API_KEY=${JSON.stringify(expected)}\n`, 'utf8');

  const targetEnv = {};
  loadServerEnvFile({ envPath, targetEnv });

  assert.equal(targetEnv.KIE_API_KEY, expected);
});
