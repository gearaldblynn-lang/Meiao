import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  assertDeployRequestAllowed,
  createDeployDrainError,
  isDeployDrainActive,
  resolveDeployDrainFile,
  shouldGuardDeployRequest,
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

test('manual recovery marker remains active regardless of age', () => {
  assert.equal(isDeployDrainActive({
    env: { MEIAO_DEPLOY_DRAIN_MAX_AGE_MS: '1000' },
    now: () => 100_000,
    stat: () => ({ mtimeMs: 1 }),
    readFile: () => 'manual\n',
  }), true);
});

test('deployment drain exposes a retryable 503 job submission error', () => {
  const error = createDeployDrainError();
  assert.equal(error.code, 'job_submissions_paused');
  assert.equal(error.statusCode, 503);
  assert.match(error.message, /系统发布中/);
});

test('deployment drain guards concrete synchronous provider route categories', () => {
  for (const pathname of [
    '/api/chat/sessions/session-1/messages',
    '/api/agents/agent-1/validate',
    '/api/studio/training/version-1/message',
    '/api/video-diagnosis/analyze',
    '/api/assets/upload',
    '/api/assets/upload-stream',
    '/api/knowledge-documents',
    '/api/knowledge-documents/document-1/retrain',
    '/api/chatwoot/ai-webhook',
    '/api/jobs',
    '/api/jobs/job-1/retry',
    '/api/jobs/recover',
  ]) {
    assert.equal(shouldGuardDeployRequest({ pathname, method: 'POST' }), true, pathname);
  }
  assert.equal(shouldGuardDeployRequest({ pathname: '/api/knowledge-documents/document-1', method: 'PUT' }), true);
  assert.equal(shouldGuardDeployRequest({ pathname: '/api/jobs/job-1/result', method: 'PATCH' }), true);
  assert.equal(shouldGuardDeployRequest({ pathname: '/api/jobs/job-1', method: 'DELETE' }), true);
  assert.equal(shouldGuardDeployRequest({ pathname: '/api/health', method: 'GET' }), false);
  assert.equal(shouldGuardDeployRequest({ pathname: '/api/chat/sessions/session-1/messages', method: 'GET' }), false);
  assert.equal(shouldGuardDeployRequest({ pathname: '/api/chat/sessions/session-1/messages', method: 'OPTIONS' }), false);
});

test('the real request dispatcher applies the route-aware drain admission before storage mode routing', () => {
  const source = readFileSync(new URL('./index.mjs', import.meta.url), 'utf8');
  const dispatcher = source.match(/const server = createServer\([\s\S]*?bootstrap\(\)/)?.[0] || '';
  assert.match(dispatcher, /assertDeployRequestAllowed\(\{ pathname: url\.pathname, method: req\.method \}\)/);
  assert.ok(dispatcher.indexOf('assertDeployRequestAllowed') < dispatcher.indexOf('if (shouldUseMysql)'));
});

test('route admission throws the same retryable drain error used by job submissions', () => {
  assert.throws(
    () => assertDeployRequestAllowed({
      pathname: '/api/chat/sessions/session-1/messages',
      method: 'POST',
      drainOptions: { stat: () => ({ mtimeMs: Date.now() }) },
    }),
    (error) => error?.code === 'job_submissions_paused' && error?.statusCode === 503,
  );
});
