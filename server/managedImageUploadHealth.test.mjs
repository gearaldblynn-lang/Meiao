import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  getManagedImageUploadHealth,
  writeManagedImageProbeStatus,
} from './managedImageUploadHealth.mjs';

const completeEnv = {
  MEIAO_MANAGED_IMAGE_UPLOAD_MODE: 'cos',
  MEIAO_IMAGE_COS_SECRET_ID: 'secret-id-a',
  MEIAO_IMAGE_COS_SECRET_KEY: 'secret-key-a',
  MEIAO_IMAGE_COS_BUCKET: 'managed-images-123',
  MEIAO_IMAGE_COS_REGION: 'ap-guangzhou',
  MEIAO_MANAGED_IMAGE_PROBE_MAX_AGE_MS: '3600000',
};

const withTempStatusFile = (callback) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'meiao-managed-image-health-'));
  const statusFilePath = path.join(dir, 'probe-status.json');
  try {
    return callback(statusFilePath);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

test('managed image upload health is not ready while production upload is disabled', () => {
  const health = getManagedImageUploadHealth({
    env: { ...completeEnv, MEIAO_MANAGED_IMAGE_UPLOAD_MODE: 'disabled' },
    statusFilePath: '/does/not/exist.json',
    now: 2_000,
  });

  assert.deepEqual(health, {
    mode: 'disabled',
    configured: true,
    ready: false,
    status: 'disabled',
    lastProbeAt: null,
    lastProbeAgeMs: null,
    alerting: true,
  });
});

test('managed image upload health requires a complete COS credential set', () => {
  const health = getManagedImageUploadHealth({
    env: { ...completeEnv, MEIAO_IMAGE_COS_SECRET_KEY: '' },
    statusFilePath: '/does/not/exist.json',
    now: 2_000,
  });

  assert.equal(health.configured, false);
  assert.equal(health.ready, false);
  assert.equal(health.status, 'config_incomplete');
});

test('managed image upload health reports an explicitly enabled local development store as ready', () => {
  const health = getManagedImageUploadHealth({
    env: {
      NODE_ENV: 'development',
      MEIAO_PUBLIC_BASE_URL: 'http://127.0.0.1:3100',
      MEIAO_MANAGED_IMAGE_UPLOAD_MODE: 'local',
    },
    statusFilePath: '/does/not/exist.json',
    now: 2_000,
  });

  assert.deepEqual(health, {
    mode: 'local',
    configured: true,
    ready: true,
    status: 'local_ready',
    lastProbeAt: null,
    lastProbeAgeMs: null,
    alerting: false,
  });
});

test('managed image upload health rejects local mode when production is active', () => {
  const health = getManagedImageUploadHealth({
    env: {
      NODE_ENV: 'production',
      MEIAO_PUBLIC_BASE_URL: 'http://127.0.0.1:3100',
      MEIAO_MANAGED_IMAGE_UPLOAD_MODE: 'local',
    },
    statusFilePath: '/does/not/exist.json',
    now: 2_000,
  });

  assert.equal(health.mode, 'local');
  assert.equal(health.configured, false);
  assert.equal(health.ready, false);
  assert.equal(health.status, 'local_forbidden');
  assert.equal(health.alerting, true);
});

test('managed image upload health fails closed when local mode has no explicit development runtime', () => {
  const health = getManagedImageUploadHealth({
    env: {
      MEIAO_PUBLIC_BASE_URL: 'http://127.0.0.1:3100',
      MEIAO_MANAGED_IMAGE_UPLOAD_MODE: 'local',
    },
    statusFilePath: '/does/not/exist.json',
    now: 2_000,
  });

  assert.equal(health.configured, false);
  assert.equal(health.ready, false);
  assert.equal(health.status, 'local_forbidden');
});

test('managed image upload health accepts only a fresh successful probe for the current credential pair', () => withTempStatusFile((statusFilePath) => {
  writeManagedImageProbeStatus({
    env: completeEnv,
    statusFilePath,
    ok: true,
    checkedAt: 1_000,
  });

  const health = getManagedImageUploadHealth({
    env: completeEnv,
    statusFilePath,
    now: 2_000,
  });
  assert.deepEqual(health, {
    mode: 'cos',
    configured: true,
    ready: true,
    status: 'ready',
    lastProbeAt: 1_000,
    lastProbeAgeMs: 1_000,
    alerting: false,
  });

  const persisted = JSON.parse(readFileSync(statusFilePath, 'utf8'));
  assert.equal(persisted.ok, true);
  assert.equal(persisted.checkedAt, 1_000);
  assert.equal(typeof persisted.configFingerprint, 'string');
  assert.ok(persisted.configFingerprint.length >= 32);
  assert.doesNotMatch(JSON.stringify(persisted), /secret-id-a|secret-key-a/);
}));

test('managed image upload health rejects stale probes and probes from another credential pair', () => withTempStatusFile((statusFilePath) => {
  writeManagedImageProbeStatus({
    env: completeEnv,
    statusFilePath,
    ok: true,
    checkedAt: 1_000,
  });

  const stale = getManagedImageUploadHealth({
    env: completeEnv,
    statusFilePath,
    now: 3_602_000,
  });
  assert.equal(stale.ready, false);
  assert.equal(stale.status, 'probe_stale');

  const changed = getManagedImageUploadHealth({
    env: { ...completeEnv, MEIAO_IMAGE_COS_SECRET_KEY: 'secret-key-b' },
    statusFilePath,
    now: 2_000,
  });
  assert.equal(changed.ready, false);
  assert.equal(changed.status, 'config_changed');
}));

test('managed image upload health exposes a safe failure code without persisting error messages', () => withTempStatusFile((statusFilePath) => {
  writeManagedImageProbeStatus({
    env: completeEnv,
    statusFilePath,
    ok: false,
    checkedAt: 1_000,
    errorCode: 'SignatureDoesNotMatch',
  });

  const health = getManagedImageUploadHealth({
    env: completeEnv,
    statusFilePath,
    now: 2_000,
  });
  assert.equal(health.ready, false);
  assert.equal(health.status, 'probe_failed');
  assert.equal(health.failureCode, 'SignatureDoesNotMatch');
  assert.doesNotMatch(JSON.stringify(health), /secret-id-a|secret-key-a/);
}));

test('health endpoint publishes managed image upload readiness', () => {
  const source = readFileSync(new URL('./index.mjs', import.meta.url), 'utf8');
  assert.match(source, /managedImageUpload:\s*getManagedImageUploadHealth\(/);
});
