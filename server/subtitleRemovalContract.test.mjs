import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SUBTITLE_REMOVAL_DEFAULTS,
  assertSubtitleRemovalInput,
  buildSubtitleRemovalSubmitBody,
  getSubtitleRemovalConfig,
  normalizeSubtitleRemovalProgressResponse,
  normalizeSubtitleRemovalSubmitResponse,
} from './subtitleRemovalContract.mjs';

const validInput = (overrides = {}) => ({
  sourceUrl: 'https://managed.example/video.mp4?access=short-lived',
  sizeBytes: 15.2 * 1024 * 1024,
  durationSeconds: 9.01,
  width: 720,
  height: 1280,
  region: { x: 0, y: 0.7, width: 1, height: 0.3 },
  ...overrides,
});

test('subtitle removal config clamps timing values and never exposes the token', () => {
  const config = getSubtitleRemovalConfig({
    GOLDEN_SUBTITLE_API_TOKEN: 'configured-secret',
    MEIAO_SUBTITLE_REMOVAL_ENABLED: '1',
    MEIAO_SUBTITLE_REMOVAL_BASE_URL: 'https://gateway.example/openAi/',
    MEIAO_SUBTITLE_REMOVAL_POLL_INTERVAL_MS: '20',
    MEIAO_SUBTITLE_REMOVAL_TIMEOUT_MS: '999999999',
    MEIAO_SUBTITLE_REMOVAL_BATCH_MAX_ITEMS: '99',
    MEIAO_SUBTITLE_REMOVAL_BATCH_PREP_CONCURRENCY: '0',
    MEIAO_SUBTITLE_REMOVAL_BATCH_SUBMIT_CONCURRENCY: '99',
  });

  assert.deepEqual(config, {
    enabled: true,
    configured: true,
    baseUrl: 'https://gateway.example/openAi',
    pollIntervalMs: SUBTITLE_REMOVAL_DEFAULTS.minPollIntervalMs,
    timeoutMs: SUBTITLE_REMOVAL_DEFAULTS.maxTimeoutMs,
    batchMaxItems: 20,
    batchPrepConcurrency: 1,
    batchSubmitConcurrency: 4,
  });
  assert.equal(JSON.stringify(config).includes('configured-secret'), false);
});

test('subtitle removal config uses conservative defaults', () => {
  assert.deepEqual(getSubtitleRemovalConfig({}), {
    enabled: false,
    configured: false,
    baseUrl: SUBTITLE_REMOVAL_DEFAULTS.baseUrl,
    pollIntervalMs: SUBTITLE_REMOVAL_DEFAULTS.pollIntervalMs,
    timeoutMs: SUBTITLE_REMOVAL_DEFAULTS.timeoutMs,
    batchMaxItems: 10,
    batchPrepConcurrency: 2,
    batchSubmitConcurrency: 2,
  });
});

test('authoritative input accepts six hundred seconds and rejects longer videos', () => {
  assert.equal(assertSubtitleRemovalInput(validInput({ durationSeconds: 600 })).durationSeconds, 600);
  assert.throws(
    () => assertSubtitleRemovalInput(validInput({ durationSeconds: 600.001 })),
    (error) => error?.code === 'subtitle_video_too_long',
  );
});

test('authoritative input rejects invalid dimensions and bytes', () => {
  assert.throws(
    () => assertSubtitleRemovalInput(validInput({ width: 0 })),
    (error) => error?.code === 'subtitle_video_invalid_metadata',
  );
  assert.throws(
    () => assertSubtitleRemovalInput(validInput({ sizeBytes: 0 })),
    (error) => error?.code === 'subtitle_video_invalid_metadata',
  );
});

test('submit body sends videoName as exactly four region coordinates', () => {
  assert.deepEqual(buildSubtitleRemovalSubmitBody({
    safeTaskId: 'job_123',
    ...validInput(),
  }), {
    biz: 'aiRemoveSubtitleSubmitTask',
    fileSize: 15.2,
    duration: 10,
    resolution: '720x1280',
    videoName: '0_896_720_1280',
    coverUrl: '',
    url: 'https://managed.example/video.mp4?access=short-lived',
  });
});

test('submit response requires code zero and a task id', () => {
  assert.deepEqual(
    normalizeSubtitleRemovalSubmitResponse({ code: 0, msg: 'ok', data: { taskId: 'provider-1', leftSeconds: 99 } }),
    { providerTaskId: 'provider-1', leftSeconds: 99 },
  );
  assert.throws(
    () => normalizeSubtitleRemovalSubmitResponse({ code: 0, msg: 'ok', data: {} }),
    (error) => error?.code === 'provider_bad_response',
  );
});

test('minus twenty-five maps to a balance error', () => {
  assert.throws(
    () => normalizeSubtitleRemovalSubmitResponse({ code: -25, msg: 'balance' }),
    (error) => error?.code === 'provider_balance_insufficient',
  );
});

test('progress maps waiting, doing, success, failed, and unknown states', () => {
  const response = (status, extras = {}) => ({
    code: 0,
    msg: 'ok',
    data: [{ taskId: 'provider-1', status, ...extras }],
  });

  assert.deepEqual(normalizeSubtitleRemovalProgressResponse(response('waiting'), 'provider-1'), {
    state: 'waiting',
    providerMessage: '',
  });
  assert.deepEqual(normalizeSubtitleRemovalProgressResponse(response('doing'), 'provider-1'), {
    state: 'doing',
    providerMessage: '',
  });
  assert.deepEqual(normalizeSubtitleRemovalProgressResponse(
    response('success', { resultUrl: 'https://provider.example/result.mp4', costRemove: 24 }),
    'provider-1',
  ), {
    state: 'success',
    resultUrl: 'https://provider.example/result.mp4',
    providerMessage: '',
    costRemove: 24,
  });
  assert.deepEqual(normalizeSubtitleRemovalProgressResponse(response('failed', { emsg: '处理失败' }), 'provider-1'), {
    state: 'failed',
    providerMessage: '处理失败',
  });
  assert.deepEqual(normalizeSubtitleRemovalProgressResponse(response('mystery'), 'provider-1'), {
    state: 'unknown',
    providerMessage: '',
  });
});

test('progress success without a result url is not accepted as success', () => {
  assert.throws(
    () => normalizeSubtitleRemovalProgressResponse({
      code: 0,
      data: [{ taskId: 'provider-1', status: 'success', resultUrl: '' }],
    }, 'provider-1'),
    (error) => error?.code === 'provider_bad_response',
  );
});
