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
      MEIAO_PUBLIC_BASE_URL: 'https://meiao.internal',
    },
    { queued: 3, running: 2 }
  );

  assert.equal(config.queue.maxConcurrency, 7);
  assert.equal(config.queue.queuedCount, 3);
  assert.equal(config.queue.runningCount, 2);
  assert.deepEqual(config.cors.allowedOrigins, ['https://meiao.internal']);
  assert.deepEqual(config.providers, {
    kie: { configured: true },
  });
  assert.deepEqual(config.agentModels.chat.map((item) => item.id), [
    'gpt-5-4-openai-resp',
    'gemini-3.1-pro-openai',
    'gemini-3-flash-openai',
  ]);
  assert.equal(config.agentModels.chat[0].supportsFileInput, true);
  assert.equal(config.agentModels.chat[0].supportsImageInput, true);
  assert.equal(config.agentModels.chat[0].supportsReasoningLevel, true);
  assert.deepEqual(config.agentModels.chat[0].reasoningLevels, ['minimal', 'low', 'medium', 'high', 'xhigh']);
  assert.equal(config.agentModels.chat[1].provider, 'kie');
  assert.equal(config.agentModels.chat[1].supportsFileInput, true);
  assert.equal(config.agentModels.chat[1].supportsImageInput, true);
  assert.equal(config.agentModels.chat[1].supportsWebSearch, true);
  assert.equal(config.agentModels.chat[1].supportsReasoningLevel, true);
  assert.deepEqual(config.agentModels.chat[1].reasoningLevels, ['low', 'high']);
  assert.equal(config.agentModels.chat[2].provider, 'kie');
  assert.equal(config.agentModels.chat[2].supportsFileInput, true);
  assert.equal(config.agentModels.chat[2].supportsImageInput, true);
  assert.equal(config.agentModels.chat[2].supportsWebSearch, true);
  assert.equal(config.agentModels.chat[2].supportsReasoningLevel, true);
  assert.deepEqual(config.agentModels.chat[2].reasoningLevels, ['low', 'high']);
  assert.deepEqual(config.agentModels.image.map((item) => item.id), [
    'nano-banana-2',
    'nano-banana-pro',
  ]);
  assert.equal(JSON.stringify(config).includes('secret'), false);
});

test('buildPublicSystemConfig disables public-url media models when no external asset base is available', () => {
  const config = buildPublicSystemConfig(
    {
      KIE_API_KEY: 'kie-secret',
    },
    { queued: 0, running: 0 }
  );

  const gpt54 = config.agentModels.chat.find((item) => item.id === 'gpt-5-4-openai-resp');
  const geminiPro = config.agentModels.chat.find((item) => item.id === 'gemini-3.1-pro-openai');
  const geminiFlash = config.agentModels.chat.find((item) => item.id === 'gemini-3-flash-openai');

  assert.equal(gpt54?.supportsFileInput, true);
  assert.equal(gpt54?.supportsImageInput, true);
  assert.equal(geminiPro?.supportsFileInput, false);
  assert.equal(geminiPro?.supportsImageInput, false);
  assert.equal(geminiFlash?.supportsFileInput, false);
  assert.equal(geminiFlash?.supportsImageInput, false);
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
