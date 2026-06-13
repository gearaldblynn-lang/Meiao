import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildJobFailureLogFields,
  buildJobRuntimeLogMeta,
  buildPublicSystemConfig,
  getWorkerConcurrencyLimit,
  getNextJobFailureState,
  isRetryableErrorCode,
  isTransientMysqlConnectionError,
  normalizeAllowedOrigins,
  runWithTransientRetry,
  getReconcileBackoffMs,
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
      APIPORTS_API_KEY: 'apiports-secret',
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
    apiports: { configured: true },
  });
  assert.equal(config.publicBaseUrl, 'https://meiao.internal');
  assert.deepEqual(config.agentModels.chat.map((item) => item.id), [
    'gpt-5-4-openai-resp',
    'claude-sonnet-4-6',
    'gemini-3.1-pro-openai',
    'gemini-3-flash-openai',
    'gemini-3-5-flash',
  ]);
  assert.deepEqual(
    config.agentModels.chat
      .map((item) => item.id)
      .filter((id) => id.startsWith('gemini-3-flash')),
    ['gemini-3-flash-openai']
  );
  const gemini35 = config.agentModels.chat.find((item) => item.id === 'gemini-3-5-flash');
  assert.equal(config.agentModels.chat[0].supportsFileInput, true);
  assert.equal(config.agentModels.chat[0].supportsImageInput, true);
  assert.equal(config.agentModels.chat[0].supportsReasoningLevel, true);
  assert.deepEqual(config.agentModels.chat[0].reasoningLevels, ['minimal', 'low', 'medium', 'high', 'xhigh']);
  assert.equal(config.agentModels.chat[1].provider, 'kie');
  assert.equal(config.agentModels.chat[1].supportsFileInput, true);
  assert.equal(config.agentModels.chat[1].supportsImageInput, true);
  assert.equal(config.agentModels.chat[1].supportsWebSearch, false);
  assert.equal(config.agentModels.chat[1].supportsReasoningLevel, true);
  assert.deepEqual(config.agentModels.chat[1].reasoningLevels, ['low']);
  assert.equal(config.agentModels.chat[2].provider, 'kie');
  assert.equal(config.agentModels.chat[2].supportsFileInput, true);
  assert.equal(config.agentModels.chat[2].supportsImageInput, true);
  assert.equal(config.agentModels.chat[2].supportsWebSearch, true);
  assert.equal(config.agentModels.chat[2].supportsReasoningLevel, true);
  assert.deepEqual(config.agentModels.chat[2].reasoningLevels, ['low', 'high']);
  assert.equal(config.agentModels.chat[3].provider, 'kie');
  assert.equal(config.agentModels.chat[3].supportsFileInput, true);
  assert.equal(config.agentModels.chat[3].supportsImageInput, true);
  assert.equal(config.agentModels.chat[3].supportsWebSearch, true);
  assert.equal(config.agentModels.chat[3].supportsReasoningLevel, true);
  assert.deepEqual(config.agentModels.chat[3].reasoningLevels, ['low', 'high']);
  assert.equal(gemini35?.provider, 'kie');
  assert.equal(gemini35?.supportsFileInput, true);
  assert.equal(gemini35?.supportsImageInput, true);
  assert.equal(gemini35?.supportsWebSearch, true);
  assert.equal(gemini35?.supportsReasoningLevel, true);
  assert.deepEqual(gemini35?.reasoningLevels, ['low', 'high']);
  assert.deepEqual(config.agentModels.image.map((item) => item.id), [
    'gpt-image-2',
    'gpt-image-2-secondary',
    'nano-banana-2',
  ]);
  assert.equal(config.systemSettings.videoAnalysisModel, '');
  assert.equal(config.systemSettings.effectiveVideoAnalysisModel, 'gemini-3-flash-openai');
  assert.equal(config.systemSettings.videoAnalysisReasoningLevel, 'high');
  assert.equal(JSON.stringify(config).includes('secret'), false);
});

test('buildPublicSystemConfig keeps video analysis model independent from planning analysis model', () => {
  const config = buildPublicSystemConfig(
    { KIE_API_KEY: 'kie-secret', MEIAO_DEFAULT_ANALYSIS_MODEL: 'gpt-5-4-openai-resp' },
    { queued: 0, running: 0 },
    { systemSettings: { analysisModel: 'gemini-3-flash-openai', videoAnalysisModel: 'gemini-3.1-pro-openai' } },
  );

  assert.equal(config.systemSettings.analysisModel, 'gemini-3-flash-openai');
  assert.equal(config.systemSettings.effectiveAnalysisModel, 'gemini-3-flash-openai');
  assert.equal(config.systemSettings.videoAnalysisModel, 'gemini-3.1-pro-openai');
  assert.equal(config.systemSettings.effectiveVideoAnalysisModel, 'gemini-3.1-pro-openai');
  assert.equal(config.systemSettings.videoAnalysisReasoningLevel, 'high');
});

test('buildPublicSystemConfig exposes user planning model and gemini-only video analysis models', () => {
  const config = buildPublicSystemConfig(
    { KIE_API_KEY: 'kie-secret', MEIAO_DEFAULT_ANALYSIS_MODEL: 'gpt-5-4-openai-resp' },
    { queued: 0, running: 0 },
    {
      systemSettings: { analysisModel: 'claude-sonnet-4-6', videoAnalysisModel: 'gpt-5-4-openai-resp' },
      userSettings: { analysisModel: 'gemini-3-flash-openai' },
    },
  );

  assert.equal(config.systemSettings.analysisModel, 'claude-sonnet-4-6');
  assert.equal(config.systemSettings.userAnalysisModel, 'gemini-3-flash-openai');
  assert.equal(config.systemSettings.effectiveAnalysisModel, 'gemini-3-flash-openai');
  assert.equal(config.systemSettings.videoAnalysisModel, '');
  assert.equal(config.systemSettings.effectiveVideoAnalysisModel, 'gemini-3-flash-openai');
  assert.deepEqual(config.videoAnalysisModels.map((item) => item.id), [
    'gemini-3.1-pro-openai',
    'gemini-3-flash-openai',
    'gemini-3-5-flash',
  ]);
});

test('buildPublicSystemConfig disables public-url media models when no external asset base is available', () => {
  const config = buildPublicSystemConfig(
    {
      KIE_API_KEY: 'kie-secret',
    },
    { queued: 0, running: 0 }
  );

  const gpt54 = config.agentModels.chat.find((item) => item.id === 'gpt-5-4-openai-resp');
  const claude = config.agentModels.chat.find((item) => item.id === 'claude-sonnet-4-6');
  const geminiPro = config.agentModels.chat.find((item) => item.id === 'gemini-3.1-pro-openai');
  const geminiFlash = config.agentModels.chat.find((item) => item.id === 'gemini-3-flash-openai');

  assert.equal(gpt54?.supportsFileInput, true);
  assert.equal(gpt54?.supportsImageInput, true);
  assert.equal(claude?.supportsFileInput, true);
  assert.equal(claude?.supportsImageInput, true);
  assert.equal(geminiPro?.supportsFileInput, false);
  assert.equal(geminiPro?.supportsImageInput, false);
  assert.equal(geminiFlash?.supportsFileInput, false);
  assert.equal(geminiFlash?.supportsImageInput, false);
});

test('buildPublicSystemConfig disables public-url media models for private network asset bases', () => {
  const config = buildPublicSystemConfig(
    {
      KIE_API_KEY: 'kie-secret',
      MEIAO_PUBLIC_BASE_URL: 'http://192.168.1.8:3100',
    },
    { queued: 0, running: 0 }
  );

  const geminiPro = config.agentModels.chat.find((item) => item.id === 'gemini-3.1-pro-openai');
  const geminiFlash = config.agentModels.chat.find((item) => item.id === 'gemini-3-flash-openai');

  assert.equal(config.publicBaseUrl, 'http://192.168.1.8:3100');
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

test('getNextJobFailureState does not retry transient failures when retry budget is zero', () => {
  assert.deepEqual(
    getNextJobFailureState({
      retryCount: 0,
      maxRetries: 0,
      errorCode: 'provider_timeout',
    }),
    {
      retryCount: 0,
      status: 'failed',
    }
  );
});

test('buildJobFailureLogFields reports retryable intermediate failures as running retry state', () => {
  assert.deepEqual(
    buildJobFailureLogFields({
      jobStatus: 'retry_waiting',
      taskType: 'kie_chat',
      errorCode: 'provider_internal_error',
    }),
    {
      level: 'info',
      action: 'job_retry_waiting',
      message: 'kie_chat 任务重试中',
      status: 'started',
    }
  );
});

test('buildJobFailureLogFields reports final failures as failed state', () => {
  assert.deepEqual(
    buildJobFailureLogFields({
      jobStatus: 'failed',
      taskType: 'kie_chat',
      errorCode: 'provider_bad_request',
    }),
    {
      level: 'error',
      action: 'job_failed',
      message: 'kie_chat 任务失败',
      status: 'failed',
    }
  );
});

test('buildJobRuntimeLogMeta exposes provider and shell binding fields for diagnosis', () => {
  const meta = buildJobRuntimeLogMeta({
    job: {
      id: 'job-1',
      module: 'one_click',
      taskType: 'kie_image',
      provider: 'kie',
      providerTaskId: 'provider-old',
      retryCount: 1,
      maxRetries: 2,
      createdAt: 1000,
      startedAt: 2500,
      payload: {
        subFeature: 'main_image',
        shellPurpose: 'one_click_image_generation',
        shellProjectId: 'project-1',
        shellProjectName: '主图项目',
        shellPlanId: 'plan-1',
        batchIndex: 2,
        batchCount: 4,
        requestId: 'request-1',
      },
    },
    result: {
      providerTaskId: 'provider-new',
      providerStage: 'completed',
      providerStatus: 'success',
      creditsConsumed: 0.25,
      result: {
        imageUrl: 'https://example.com/result.png',
      },
    },
    finishedAt: 5000,
  });

  assert.equal(meta.jobId, 'job-1');
  assert.equal(meta.providerTaskId, 'provider-new');
  assert.equal(meta.diagnosticSchemaVersion, '2026-05-26.1');
  assert.equal(meta.eventKind, 'job_runtime');
  assert.equal(meta.traceId, 'request-1');
  assert.equal(meta.correlationId, 'provider-new');
  assert.equal(meta.jobStatus, '');
  assert.equal(meta.provider, 'kie');
  assert.equal(meta.taskType, 'kie_image');
  assert.equal(meta.module, 'one_click');
  assert.equal(meta.subFeature, 'main_image');
  assert.equal(meta.shellPurpose, 'one_click_image_generation');
  assert.equal(meta.shellProjectId, 'project-1');
  assert.equal(meta.shellProjectName, '主图项目');
  assert.equal(meta.shellPlanId, 'plan-1');
  assert.equal(meta.batchIndex, 2);
  assert.equal(meta.batchCount, 4);
  assert.equal(meta.requestId, 'request-1');
  assert.equal(meta.inputImageUrlCount, 0);
  assert.equal(meta.inputFileUrlCount, 0);
  assert.equal(meta.promptLength, 0);
  assert.equal(meta.providerStage, 'completed');
  assert.equal(meta.providerStatus, 'success');
  assert.equal(meta.errorOrigin, '');
  assert.equal(meta.resultUrlCount, 1);
  assert.equal(meta.creditsConsumed, 0.25);
  assert.equal(meta.queueWaitMs, 1500);
  assert.equal(meta.runtimeMs, 2500);
  assert.equal(JSON.stringify(meta).includes('https://example.com/result.png'), false);
});

test('buildJobRuntimeLogMeta counts multimodal chat payload inputs without leaking urls', () => {
  const meta = buildJobRuntimeLogMeta({
    job: {
      id: 'job-chat',
      module: 'one_click',
      taskType: 'kie_chat',
      provider: 'kie',
      createdAt: 1000,
      startedAt: 1200,
      payload: {
        model: 'gemini-3-flash-openai',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: '生成首图方案' },
              { type: 'image_url', image_url: { url: 'https://example.com/private-a.png' } },
              { type: 'input_file', file_url: 'https://example.com/private-b.pdf' },
            ],
          },
        ],
      },
    },
  });

  assert.equal(meta.inputImageUrlCount, 1);
  assert.equal(meta.inputFileUrlCount, 1);
  assert.equal(meta.promptLength, 6);
  assert.equal(JSON.stringify(meta).includes('private-a.png'), false);
  assert.equal(JSON.stringify(meta).includes('private-b.pdf'), false);
});

test('buildJobRuntimeLogMeta estimates runtime from createdAt when recovered jobs lost startedAt', () => {
  const meta = buildJobRuntimeLogMeta({
    job: {
      id: 'job-recovered',
      taskType: 'kie_image',
      provider: 'kie',
      createdAt: 1000,
      startedAt: null,
      payload: {},
    },
    result: {
      providerTaskId: 'provider-recovered',
      result: { imageUrl: 'https://example.com/recovered.png' },
    },
    finishedAt: 7000,
  });

  assert.equal(meta.jobStartedAt, 1000);
  assert.equal(meta.queueWaitMs, 0);
  assert.equal(meta.runtimeMs, 6000);
});

test('isTransientMysqlConnectionError detects broken mysql pool connections', () => {
  assert.equal(isTransientMysqlConnectionError({ code: 'PROTOCOL_CONNECTION_LOST' }), true);
  assert.equal(isTransientMysqlConnectionError({ code: 'ECONNREFUSED' }), true);
  assert.equal(isTransientMysqlConnectionError({ code: 'ETIMEDOUT' }), true);
  assert.equal(isTransientMysqlConnectionError(new Error('Pool is closed.')), true);
  assert.equal(isTransientMysqlConnectionError({ code: 'ER_BAD_DB_ERROR' }), false);
  assert.equal(isTransientMysqlConnectionError(new Error('ordinary failure')), false);
});

// 根因 #4 链路加固(2026-06-13):写入路径遇到瞬时连接错(Pool is closed 等)
// 现在只识别、不恢复。runWithTransientRetry 给写入加有限次重试 + 指数退避,
// 让一次连接抖动不会直接把任务打死、触发 reconcile 死循环。
test('runWithTransientRetry returns result on first success without sleeping', async () => {
  const sleeps = [];
  let calls = 0;
  const result = await runWithTransientRetry(
    async () => { calls += 1; return 'ok'; },
    { sleep: async (ms) => { sleeps.push(ms); } },
  );
  assert.equal(result, 'ok');
  assert.equal(calls, 1, '成功时只调用一次');
  assert.deepEqual(sleeps, [], '成功时不退避');
});

test('runWithTransientRetry retries transient errors then succeeds with increasing backoff', async () => {
  const sleeps = [];
  let calls = 0;
  const result = await runWithTransientRetry(
    async () => {
      calls += 1;
      if (calls < 3) throw new Error('Pool is closed.');
      return 'recovered';
    },
    {
      maxRetries: 3,
      sleep: async (ms) => { sleeps.push(ms); },
    },
  );
  assert.equal(result, 'recovered');
  assert.equal(calls, 3, '失败两次后第三次成功');
  assert.equal(sleeps.length, 2, '重试两次,退避两次');
  assert.ok(sleeps[1] > sleeps[0], `退避必须递增,实际 ${sleeps.join(',')}`);
});

test('runWithTransientRetry rethrows non-transient errors immediately without retry', async () => {
  const sleeps = [];
  let calls = 0;
  await assert.rejects(
    runWithTransientRetry(
      async () => { calls += 1; throw new Error('ordinary failure'); },
      { sleep: async (ms) => { sleeps.push(ms); } },
    ),
    /ordinary failure/,
  );
  assert.equal(calls, 1, '非瞬时错不重试');
  assert.deepEqual(sleeps, [], '非瞬时错不退避');
});

test('runWithTransientRetry gives up after maxRetries and throws the last transient error', async () => {
  const sleeps = [];
  let calls = 0;
  await assert.rejects(
    runWithTransientRetry(
      async () => { calls += 1; throw new Error('Pool is closed.'); },
      { maxRetries: 2, sleep: async (ms) => { sleeps.push(ms); } },
    ),
    /Pool is closed/,
  );
  assert.equal(calls, 3, '初次 + 2 次重试 = 3 次尝试');
  assert.equal(sleeps.length, 2, '退避 2 次后放弃');
});

// 根因 #4 链路加固 · reconcile 退避(2026-06-13):
// reconcile loop 原本固定 60s,DB 挂时每 60s 锤一次。连续失败时按次数指数退避,
// 成功后回落到基础间隔,避免对挂掉的 DB 死循环施压。
test('getReconcileBackoffMs returns base interval when no consecutive failures', () => {
  assert.equal(getReconcileBackoffMs(0, 60000, 600000), 60000);
});

test('getReconcileBackoffMs grows exponentially with consecutive failures', () => {
  const base = 60000;
  const max = 600000;
  assert.equal(getReconcileBackoffMs(1, base, max), 120000, '1 次失败 → 2x');
  assert.equal(getReconcileBackoffMs(2, base, max), 240000, '2 次失败 → 4x');
  assert.equal(getReconcileBackoffMs(3, base, max), 480000, '3 次失败 → 8x');
});

test('getReconcileBackoffMs is capped at maxMs', () => {
  const base = 60000;
  const max = 600000;
  assert.equal(getReconcileBackoffMs(10, base, max), max, '远超上限时封顶 maxMs');
});

test('getReconcileBackoffMs never returns below base interval', () => {
  assert.ok(getReconcileBackoffMs(0, 60000, 600000) >= 60000);
  assert.ok(getReconcileBackoffMs(-5, 60000, 600000) >= 60000, '负数兜底到 base');
});


