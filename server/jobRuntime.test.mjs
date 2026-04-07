import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildPublicSystemConfig,
  getWorkerConcurrencyLimit,
  getNextJobFailureState,
  isRetryableErrorCode,
  normalizeAllowedOrigins,
} from './jobRuntime.mjs';

test('normalizeAllowedOrigins trims blanks and removes duplicates', () => {
  assert.deepEqual(
    normalizeAllowedOrigins(' https://a.example.com, ,https://b.example.com,https://a.example.com '),
    ['https://a.example.com', 'https://b.example.com']
  );
});

test('buildPublicSystemConfig only exposes non-sensitive provider readiness', () => {
  const config = buildPublicSystemConfig(
    {
      MEIAO_JOB_MAX_CONCURRENCY: '7',
      MEIAO_ALLOWED_ORIGINS: 'https://meiao.internal',
      KIE_API_KEY: 'kie-secret',
      ARK_API_KEY: '',
    },
    { queued: 3, running: 2 }
  );

  assert.equal(config.queue.maxConcurrency, 7);
  assert.equal(config.queue.queuedCount, 3);
  assert.equal(config.queue.runningCount, 2);
  assert.deepEqual(config.cors.allowedOrigins, ['https://meiao.internal']);
  assert.deepEqual(config.providers, {
    ark: { configured: false },
    kie: { configured: true },
  });
  assert.deepEqual(config.agentModels.chat.map((item) => item.id), [
    'doubao-seed-1-6-flash-250615',
    'doubao-seed-1-6-thinking-250715',
    'doubao-seed-2-0-lite-260215',
  ]);
  assert.equal(config.agentModels.chat[0].supportsFileInput, true);
  assert.equal(config.agentModels.chat[0].supportsImageInput, true);
  assert.equal(config.agentModels.chat[1].supportsReasoningLevel, true);
  assert.deepEqual(config.agentModels.chat[1].reasoningLevels, ['low', 'medium', 'high']);
  assert.deepEqual(config.agentModels.image.map((item) => item.id), [
    'nano-banana-2',
    'nano-banana-pro',
  ]);
  assert.equal(JSON.stringify(config).includes('secret'), false);
});

test('getWorkerConcurrencyLimit follows active account concurrency instead of capping by lower env value', () => {
  assert.equal(
    getWorkerConcurrencyLimit(3, [
      { status: 'active', jobConcurrency: 20 },
      { status: 'disabled', jobConcurrency: 99 },
    ]),
    20
  );
  assert.equal(
    getWorkerConcurrencyLimit(5, [
      { status: 'active', jobConcurrency: 4 },
      { status: 'active', jobConcurrency: 6 },
    ]),
    10
  );
  assert.equal(getWorkerConcurrencyLimit(3, []), 3);
});

test('isRetryableErrorCode only retries transient failures', () => {
  assert.equal(isRetryableErrorCode('provider_timeout'), true);
  assert.equal(isRetryableErrorCode('provider_rate_limited'), true);
  assert.equal(isRetryableErrorCode('provider_auth_invalid'), false);
  assert.equal(isRetryableErrorCode('provider_bad_request'), false);
  assert.equal(isRetryableErrorCode('task_not_found'), false);
});

test('getNextJobFailureState returns retry_waiting when retries remain', () => {
  assert.deepEqual(
    getNextJobFailureState({
      retryCount: 0,
      maxRetries: 2,
      errorCode: 'provider_timeout',
    }),
    {
      retryCount: 1,
      status: 'retry_waiting',
    }
  );
});

test('getNextJobFailureState returns failed for non-retryable errors', () => {
  assert.deepEqual(
    getNextJobFailureState({
      retryCount: 0,
      maxRetries: 2,
      errorCode: 'provider_auth_invalid',
    }),
    {
      retryCount: 0,
      status: 'failed',
    }
  );
});

test('getNextJobFailureState returns failed when retry budget is exhausted', () => {
  assert.deepEqual(
    getNextJobFailureState({
      retryCount: 2,
      maxRetries: 2,
      errorCode: 'provider_timeout',
    }),
    {
      retryCount: 2,
      status: 'failed',
    }
  );
});
