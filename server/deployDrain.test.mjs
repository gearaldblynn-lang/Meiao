import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  createDeployDrainError,
  isDeployDrainActive,
  resolveDeployDrainFile,
} from './deployDrain.mjs';

test('deployment drain uses an env path and treats a fresh marker as active', () => {
  const env = { MEIAO_DEPLOY_DRAIN_FILE: '/tmp/custom-meiao-drain' };
  assert.equal(resolveDeployDrainFile(env), '/tmp/custom-meiao-drain');
  assert.equal(isDeployDrainActive({
    env,
    now: () => 10_000,
    stat: () => ({ mtimeMs: 9_500 }),
  }), true);
});

test('deployment drain expires a stale marker instead of wedging submissions forever', () => {
  assert.equal(isDeployDrainActive({
    env: { MEIAO_DEPLOY_DRAIN_MAX_AGE_MS: '1000' },
    now: () => 10_000,
    stat: () => ({ mtimeMs: 8_000 }),
  }), false);
  assert.equal(isDeployDrainActive({
    env: {},
    stat: () => { throw Object.assign(new Error('missing'), { code: 'ENOENT' }); },
  }), false);
});

test('deployment drain exposes a retryable 503 job submission error', () => {
  const error = createDeployDrainError();
  assert.equal(error.code, 'job_submissions_paused');
  assert.equal(error.statusCode, 503);
  assert.match(error.message, /系统发布中/);
});

test('mysql and local submission, retry, and recovery routes enforce the deployment drain', () => {
  const source = readFileSync(new URL('./index.mjs', import.meta.url), 'utf8');
  const guardedRoutes = source.match(/assertJobSubmissionAllowed\(\);/g) || [];
  assert.ok(guardedRoutes.length >= 6, 'both storage modes must guard create, retry, and recovery');
});
