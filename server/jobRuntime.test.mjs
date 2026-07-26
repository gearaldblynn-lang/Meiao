import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { persistManagedRemoteJobOutput } from './jobOutputAssetPersistence.mjs';

import {
  buildJobFailureErrorFields,
  buildJobFailureLogFields,
  buildJobRuntimeLogMeta,
  buildPublicSystemConfig,
  getWorkerConcurrencyLimit,
  getNextJobFailureState,
  getProviderCompletedRejectedOutput,
  getPersistedJobFailureErrorCode,
  getSubmittedTaskRecoveryRetries,
  isRetryableErrorCode,
  isProviderCompletedOutputRejectedError,
  isTransientMysqlConnectionError,
  normalizeAllowedOrigins,
  runWithTransientRetry,
  shouldSettleProviderCompletedRejectedJob,
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
    maxforai: { configured: false },
    maxforaiVideo: { configured: false },
    goldenSubtitle: { configured: false },
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
    'maxforai-image-2-relay',
    'nano-banana-2',
  ]);
  const maxForAiRelay = config.agentModels.image.find((item) => item.id === 'maxforai-image-2-relay');
  assert.equal(maxForAiRelay?.label, 'image-2中转');
  assert.equal(maxForAiRelay?.provider, 'maxforai');
  assert.equal(maxForAiRelay?.defaultResolution, '1K');
  assert.deepEqual(maxForAiRelay?.supportedResolutions, ['1K', '2K']);
  assert.deepEqual(config.agentModels.video.map((item) => item.id), [
    'sora-2-pro-storyboard',
    'veo3_fast',
    'bytedance/seedance-2-fast',
  ]);
  const seedance = config.agentModels.video.find((item) => item.id === 'bytedance/seedance-2-fast');
  assert.equal(seedance?.provider, 'kie');
  assert.equal(seedance?.supportsAsyncTask, true);
  assert.equal(seedance?.supportsStreaming, false);
  assert.equal(seedance?.supportsCacheHit, false);
  assert.equal(seedance?.supportsReferenceImage, true);
  assert.equal(seedance?.supportsReferenceVideo, true);
  assert.equal(seedance?.supportsAudioInput, true);
  assert.equal(config.systemSettings.videoAnalysisModel, '');
  assert.equal(config.systemSettings.effectiveVideoAnalysisModel, 'gemini-3-flash-openai');
  assert.equal(config.systemSettings.videoAnalysisReasoningLevel, 'high');
  assert.equal(JSON.stringify(config).includes('secret'), false);
});

test('buildPublicSystemConfig exposes MaxForAI video readiness without leaking its key', () => {
  const config = buildPublicSystemConfig({ MAXFORAI_VIDEO_API_KEY: 'private-video-secret' });

  assert.deepEqual(config.providers.maxforaiVideo, { configured: true });
  assert.equal(JSON.stringify(config).includes('private-video-secret'), false);
});

test('voiceover TTS audio output persistence hands off only managed audio after storage succeeds', async () => {
  const providerUrl = 'https://provider.example/tts.wav';
  const calls = [];
  const result = await persistManagedRemoteJobOutput({
    job: {
      id: 'tts-child-1', userId: 'user-1', module: 'video', provider: 'kie', taskType: 'kie_tts',
      payload: { parentJobId: 'voiceover-parent-1' },
    },
    result: { audioUrl: providerUrl },
    publicBaseUrl: 'https://meiao.example.com',
    now: () => 1_700_000_000_000,
    persistRemoteAsset: async (options) => {
      calls.push(options);
      return { id: 'managed-audio-1', publicUrl: '/api/assets/file/managed-audio-1/tts.wav', mimeType: 'audio/wav' };
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].remoteUrl, providerUrl);
  assert.equal(calls[0].jobId, 'voiceover-parent-1');
  assert.equal(calls[0].assetType, 'intermediate');
  assert.equal(calls[0].expiresAt, 1_700_259_200_000);
  assert.equal(result.audioUrl, '/api/assets/file/managed-audio-1/tts.wav');
  assert.equal(result.audioUrlAssetId, 'managed-audio-1');
  assert.equal('audioUrlRemoteUrl' in result, false);
});

test('index prepares KIE TTS audio before the unavailable-public-base early return', () => {
  const source = readFileSync(new URL('./index.mjs', import.meta.url), 'utf8');
  const persistence = source.match(/const persistJobOutputAssetsIfEnabled = async[\s\S]*?const persistRuntimeRemoteAssetIfEnabled/)?.[0] || '';
  const prepareIndex = persistence.indexOf('prepareKieTtsOutputForPersistence({');
  const earlyReturnIndex = persistence.indexOf('if (!publicBaseUrl) {');
  assert.ok(prepareIndex >= 0, 'job output path delegates TTS preconditions to the shared helper');
  assert.ok(earlyReturnIndex > prepareIndex, 'TTS preconditions run before an unavailable-base return');
});

test('public upload routes do not accept client supplied expiresAt', () => {
  const source = readFileSync(new URL('./index.mjs', import.meta.url), 'utf8');
  const mysqlUpload = source.match(/if \(url\.pathname === '\/api\/assets\/upload' && req\.method === 'POST'\) \{[\s\S]*?\n  \}/)?.[0] || '';
  const localUploadStart = source.lastIndexOf("if (url.pathname === '/api/assets/upload' && req.method === 'POST')");
  const localUpload = source.slice(localUploadStart, source.indexOf("if (url.pathname === '/api/assets/upload-stream'", localUploadStart));
  assert.doesNotMatch(mysqlUpload, /expiresAt/);
  assert.doesNotMatch(localUpload, /expiresAt/);
  const publicConfig = buildPublicSystemConfig({ MEIAO_VOICEOVER_INTERMEDIATE_TTL_MS: '3600000' });
  assert.equal(JSON.stringify(publicConfig).includes('expiresAt'), false);
});

test('subtitle removal readiness exposes booleans without leaking provider configuration', () => {
  const token = 'golden-private-token';
  const baseUrl = 'https://subtitle-provider.invalid/private-api';
  const config = buildPublicSystemConfig({
    GOLDEN_SUBTITLE_API_TOKEN: token,
    MEIAO_SUBTITLE_REMOVAL_ENABLED: '1',
    MEIAO_SUBTITLE_REMOVAL_BASE_URL: baseUrl,
    MEIAO_SUBTITLE_REMOVAL_BATCH_MAX_ITEMS: '12',
    MEIAO_SUBTITLE_REMOVAL_BATCH_PREP_CONCURRENCY: '3',
    MEIAO_SUBTITLE_REMOVAL_BATCH_SUBMIT_CONCURRENCY: '4',
  });

  assert.deepEqual(config.providers.goldenSubtitle, { configured: true });
  assert.equal(config.featureRollouts.subtitleRemoval, true);
  assert.deepEqual(config.subtitleRemoval, {
    batchMaxItems: 12,
    batchPrepConcurrency: 3,
    batchSubmitConcurrency: 4,
  });
  const serialized = JSON.stringify(config);
  assert.equal(serialized.includes(token), false);
  assert.equal(serialized.includes(baseUrl), false);
  assert.equal(serialized.toLowerCase().includes('authorization'), false);

  const serverSource = readFileSync(new URL('./index.mjs', import.meta.url), 'utf8');
  const healthBlock = serverSource.match(/if \(url\.pathname === '\/api\/health'[\s\S]*?\n\s*return;\n\s*}/)?.[0] || '';
  assert.match(healthBlock, /subtitleRemoval:\s*\{/);
  assert.match(healthBlock, /enabled:\s*subtitleRemovalConfig\.enabled/);
  assert.match(healthBlock, /configured:\s*subtitleRemovalConfig\.configured/);
  assert.doesNotMatch(healthBlock, /GOLDEN_SUBTITLE_API_TOKEN|authorization|baseUrl|pollIntervalMs|timeoutMs/i);
});

test('buildPublicSystemConfig publishes the frozen public voiceover contract only', () => {
  const config = buildPublicSystemConfig({
    MEIAO_VOICEOVER_TRANSLATION_ENABLED: '1',
    MEIAO_VOICEOVER_SEPARATION_PYTHON: '/Users/private/voiceover/bin/python',
    MEIAO_VOICEOVER_DEMUCS_MODEL_DIR: '/Users/private/models',
    KIE_API_KEY: 'private-kie-token',
  }, {}, {
    voiceoverReadiness: { pythonReady: true, modelReady: true, ffmpegReady: true },
  });

  assert.deepEqual(Object.keys(config.voiceoverTranslation).sort(), ['enabled', 'languages', 'limits', 'model', 'readiness', 'ready', 'voices']);
  assert.deepEqual(config.voiceoverTranslation.readiness, {
    pythonReady: true,
    modelReady: true,
    ffmpegReady: true,
    separationConcurrency: 1,
  });
  assert.equal(JSON.stringify(config.voiceoverTranslation).match(/private|\/Users|token|apiKey/i), null);
});

test('buildPublicSystemConfig exposes the normalized Product Restoration rollout', () => {
  const envKey = 'MEIAO_PRODUCT_RESTORE_ROLLOUT';
  const hadOriginalValue = Object.prototype.hasOwnProperty.call(process.env, envKey);
  const originalValue = process.env[envKey];
  const cases = [
    [undefined, 'off'],
    ['admin', 'admin'],
    ['all', 'all'],
    ['beta', 'off'],
  ];

  try {
    for (const [value, expected] of cases) {
      if (value === undefined) delete process.env[envKey];
      else process.env[envKey] = value;

      const config = buildPublicSystemConfig({}, { queued: 0, running: 0 });
      assert.equal(config.featureRollouts.productRestore, expected);
    }
  } finally {
    if (hadOriginalValue) process.env[envKey] = originalValue;
    else delete process.env[envKey];
  }
});

test('buildPublicSystemConfig exposes openai compatible readiness without leaking key', () => {
  const config = buildPublicSystemConfig(
    {
      OPENAI_COMPATIBLE_API_KEY: 'sk-env-secret',
      OPENAI_COMPATIBLE_BASE_URL: 'https://env-relay.test',
      OPENAI_COMPATIBLE_MODELS: 'gpt-5.4,gpt-5.5',
    },
    { queued: 0, running: 0 },
    {
      systemSettings: {
        openaiCompatible: {
          apiKey: 'sk-db-secret',
          baseUrl: 'https://db-relay.test',
          models: 'gpt-5.4',
        },
      },
    },
  );

  assert.deepEqual(config.systemSettings.openaiCompatible, {
    configured: true,
    baseUrl: 'https://db-relay.test',
    models: 'gpt-5.4',
    apiKeyMasked: 'sk-d...cret',
  });
  assert.equal(JSON.stringify(config).includes('sk-db-secret'), false);
  assert.equal(JSON.stringify(config).includes('sk-env-secret'), false);
});

test('buildPublicSystemConfig exposes sanitized system announcement', () => {
  const config = buildPublicSystemConfig(
    {},
    { queued: 0, running: 0 },
    {
      systemSettings: {
        announcement: {
          id: 'ann-260618',
          title: ' 6 月 18 功能调整 ',
          content: ' 智能体公告恢复上线 ',
          enabled: true,
          updatedAt: 1781760000000,
          updatedBy: 'admin',
          secretDraft: 'should-not-leak',
        },
      },
    },
  );

  assert.deepEqual(config.systemSettings.announcement, {
    id: 'ann-260618',
    title: '6 月 18 功能调整',
    content: '智能体公告恢复上线',
    enabled: true,
    updatedAt: 1781760000000,
    updatedBy: 'admin',
  });
  assert.equal(JSON.stringify(config).includes('secretDraft'), false);
});

test('buildPublicSystemConfig hides deleted or empty announcements', () => {
  const config = buildPublicSystemConfig(
    {},
    { queued: 0, running: 0 },
    {
      systemSettings: {
        announcement: {
          id: 'ann-deleted',
          title: '旧公告',
          content: '已删除内容',
          enabled: false,
          updatedAt: 1781760000000,
        },
      },
    },
  );

  assert.deepEqual(config.systemSettings.announcement, {
    id: '',
    title: '',
    content: '',
    enabled: false,
    updatedAt: 0,
    updatedBy: '',
  });
  assert.equal(JSON.stringify(config).includes('已删除内容'), false);
});

test('buildPublicSystemConfig publishes configured openai compatible tool-calling models', () => {
  const config = buildPublicSystemConfig(
    {
      OPENAI_COMPATIBLE_API_KEY: 'sk-env-secret',
      OPENAI_COMPATIBLE_BASE_URL: 'https://env-relay.test',
      OPENAI_COMPATIBLE_MODELS: 'gpt-5.4,gpt-5.5',
    },
    { queued: 0, running: 0 },
  );

  const gpt54 = config.agentModels.chat.find((item) => item.id === 'gpt-5.4');
  const gpt55 = config.agentModels.chat.find((item) => item.id === 'gpt-5.5');

  assert.deepEqual(config.agentModels.chat.slice(0, 2).map((item) => item.id), ['gpt-5.4', 'gpt-5.5']);
  assert.equal(gpt54?.provider, 'openai_compatible');
  assert.equal(gpt54?.supportsToolUse, true);
  assert.equal(gpt54?.supportsFileInput, true);
  assert.equal(gpt54?.supportsImageInput, true);
  assert.equal(gpt54?.supportsWebSearch, true);
  assert.equal(gpt54?.supportsReasoningLevel, true);
  assert.deepEqual(gpt54?.reasoningLevels, ['minimal', 'low', 'medium', 'high', 'xhigh']);
  assert.equal(gpt55?.provider, 'openai_compatible');
  assert.equal(gpt55?.supportsToolUse, true);
  assert.equal(gpt55?.supportsWebSearch, true);
  assert.equal(gpt55?.supportsReasoningLevel, true);
  assert.deepEqual(gpt55?.reasoningLevels, ['minimal', 'low', 'medium', 'high', 'xhigh']);
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

test('buildPublicSystemConfig defaultAnalysisModel env 优先序:agent > planning > default-analysis > default-chat > kie-chat > 目录首个', () => {
  const base = { KIE_API_KEY: 'kie-secret' };
  const chain = [
    ['MEIAO_AGENT_ANALYSIS_MODEL', 'agent-analysis-model'],
    ['MEIAO_PLANNING_ANALYSIS_MODEL', 'planning-analysis-model'],
    ['MEIAO_DEFAULT_ANALYSIS_MODEL', 'default-analysis-model'],
    ['MEIAO_DEFAULT_CHAT_MODEL', 'default-chat-model'],
    ['KIE_CHAT_MODEL', 'kie-chat-model'],
  ];
  for (let i = 0; i < chain.length; i += 1) {
    const env = { ...base };
    for (let j = i; j < chain.length; j += 1) env[chain[j][0]] = chain[j][1];
    const config = buildPublicSystemConfig(env, { queued: 0, running: 0 });
    assert.equal(config.systemSettings.effectiveAnalysisModel, chain[i][1]);
  }
  const config = buildPublicSystemConfig(base, { queued: 0, running: 0 });
  assert.equal(config.systemSettings.effectiveAnalysisModel, 'gpt-5-4-openai-resp');
});

test('buildPublicSystemConfig defaultAnalysisModel 会去除 env 值两侧空白', () => {
  const config = buildPublicSystemConfig(
    { KIE_API_KEY: 'kie-secret', MEIAO_AGENT_ANALYSIS_MODEL: '  agent-analysis-model  ' },
    { queued: 0, running: 0 },
  );
  assert.equal(config.systemSettings.effectiveAnalysisModel, 'agent-analysis-model');
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

test('provider-completed output rejection exposes quarantined evidence for failure persistence and settlement', () => {
  const rejectedOutput = {
    providerTaskId: 'provider-task-1',
    result: {
      quarantinedImageAssetId: 'asset-1',
      imageOutputContract: { sourceWidth: 899, sourceHeight: 1750, targetWidth: 312, targetHeight: 840 },
    },
  };
  const error = Object.assign(new Error('output rejected'), {
    code: 'image_output_aspect_ratio_mismatch',
    providerCompleted: true,
    rejectedOutput,
  });

  assert.equal(isProviderCompletedOutputRejectedError(error), true);
  assert.equal(getProviderCompletedRejectedOutput(error), rejectedOutput);
  assert.equal(isProviderCompletedOutputRejectedError({ ...error, providerCompleted: false }), false);
  assert.equal(shouldSettleProviderCompletedRejectedJob({
    status: 'failed',
    errorCode: 'image_output_aspect_ratio_mismatch',
    result: {
      imageOutputContract: { status: 'rejected' },
      quarantinedImageAssetId: 'asset-1',
    },
  }), true);
  assert.equal(shouldSettleProviderCompletedRejectedJob({
    status: 'failed',
    errorCode: 'provider_bad_response',
    result: { imageOutputContract: { status: 'rejected' } },
  }), false);
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

test('getNextJobFailureState lets transient asset upload failures retry once then fail fast', () => {
  assert.deepEqual(
    getNextJobFailureState({
      retryCount: 0,
      maxRetries: 2,
      errorCode: 'provider_network_error',
      providerStage: 'asset_upload',
    }),
    {
      retryCount: 1,
      status: 'retry_waiting',
    }
  );

  assert.deepEqual(
    getNextJobFailureState({
      retryCount: 1,
      maxRetries: 2,
      errorCode: 'provider_network_error',
      providerStage: 'asset_upload',
    }),
    {
      retryCount: 1,
      status: 'failed',
    }
  );
});

test('getNextJobFailureState lets asset download failures retry once then fail fast', () => {
  assert.deepEqual(
    getNextJobFailureState({
      retryCount: 0,
      maxRetries: 2,
      errorCode: 'provider_network_error',
      providerStage: 'asset_download',
    }),
    {
      retryCount: 1,
      status: 'retry_waiting',
    }
  );

  assert.deepEqual(
    getNextJobFailureState({
      retryCount: 1,
      maxRetries: 2,
      errorCode: 'provider_network_error',
      providerStage: 'asset_download',
    }),
    {
      retryCount: 1,
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

test('getNextJobFailureState uses an independent recovery budget after provider submission', () => {
  const firstRecovery = getNextJobFailureState({
    retryCount: 0,
    maxRetries: 0,
    errorCode: 'provider_timeout',
    providerStage: 'polling',
    providerTaskId: 'provider-task-1',
    submittedTaskRecoveryRetries: 2,
  });
  const secondRecovery = getNextJobFailureState({
    retryCount: firstRecovery.retryCount,
    maxRetries: 0,
    errorCode: 'provider_network_error',
    providerStage: 'asset_download',
    providerTaskId: 'provider-task-1',
    submittedTaskRecoveryRetries: 2,
  });
  const exhausted = getNextJobFailureState({
    retryCount: secondRecovery.retryCount,
    maxRetries: 0,
    errorCode: 'provider_timeout',
    providerStage: 'polling',
    providerTaskId: 'provider-task-1',
    submittedTaskRecoveryRetries: 2,
  });

  assert.deepEqual(firstRecovery, { status: 'retry_waiting', retryCount: 1 });
  assert.deepEqual(secondRecovery, { status: 'retry_waiting', retryCount: 2 });
  assert.deepEqual(exhausted, { status: 'failed', retryCount: 2 });
});

test('exhausted tombstone recovery becomes an explicit manual-resolution state', () => {
  const job = {
    payload: {
      __tombstoneRecovery: { providerTaskId: 'provider-task-1' },
    },
    providerTaskId: 'provider-task-1',
  };
  assert.equal(getPersistedJobFailureErrorCode({
    job,
    failure: { status: 'retry_waiting' },
    errorCode: 'provider_timeout',
  }), 'provider_timeout');
  assert.equal(getPersistedJobFailureErrorCode({
    job,
    failure: { status: 'failed' },
    errorCode: 'provider_timeout',
  }), 'provider_recovery_manual');
  assert.equal(getPersistedJobFailureErrorCode({
    job: { payload: {} },
    failure: { status: 'failed' },
    errorCode: 'provider_timeout',
  }), 'provider_timeout');
  assert.equal(getPersistedJobFailureErrorCode({
    job,
    failure: { status: 'failed' },
    errorCode: 'provider_task_failed',
  }), 'provider_task_failed', 'a definitive upstream failure can release credits and finish deletion');
  assert.equal(getPersistedJobFailureErrorCode({
    job,
    failure: { status: 'failed' },
    errorCode: 'provider_job_failed',
    providerStatus: 'failed',
  }), 'provider_job_failed', 'subtitle removal exposes provider_job_failed for a definitive terminal failure');
  assert.equal(getPersistedJobFailureErrorCode({
    job,
    failure: { status: 'failed' },
    errorCode: 'provider_bad_response',
    providerStatus: 'success_without_result',
  }), 'provider_recovery_manual', 'success without a result is financially ambiguous');
  assert.equal(getPersistedJobFailureErrorCode({
    job,
    failure: { status: 'failed' },
    errorCode: 'provider_auth_invalid',
    providerStatus: 'auth_invalid',
  }), 'provider_recovery_manual', 'a query auth failure does not prove the provider task failed');
  assert.equal(getPersistedJobFailureErrorCode({
    job,
    failure: { status: 'failed' },
    errorCode: 'provider_bad_request',
    providerStatus: 'failed',
  }), 'provider_bad_request', 'an explicit provider failed state is definitive');
});

test('getNextJobFailureState never applies submitted recovery budget without a task id', () => {
  assert.deepEqual(getNextJobFailureState({
    retryCount: 0,
    maxRetries: 0,
    errorCode: 'provider_timeout',
    providerStage: 'polling',
    providerTaskId: '',
    submittedTaskRecoveryRetries: 3,
  }), { status: 'failed', retryCount: 0 });
});

test('getNextJobFailureState does not retry a provider id that has no query recovery path', () => {
  assert.deepEqual(getNextJobFailureState({
    retryCount: 0,
    maxRetries: 2,
    errorCode: 'provider_timeout',
    providerTaskId: 'chat-response-id',
    providerTaskRecoverable: false,
  }), { status: 'failed', retryCount: 0 });
});

test('submitted recovery retry budget is env-driven with a conservative default', () => {
  assert.equal(getSubmittedTaskRecoveryRetries({}), 2);
  assert.equal(getSubmittedTaskRecoveryRetries({ MEIAO_SUBMITTED_TASK_RECOVERY_RETRIES: '4' }), 4);
  assert.equal(getSubmittedTaskRecoveryRetries({ MEIAO_SUBMITTED_TASK_RECOVERY_RETRIES: '0' }), 0);
  assert.equal(getSubmittedTaskRecoveryRetries({ MEIAO_SUBMITTED_TASK_RECOVERY_RETRIES: 'invalid' }), 2);
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

test('buildJobRuntimeLogMeta exposes sanitized transport cause without leaking request data', () => {
  const meta = buildJobRuntimeLogMeta({
    job: {
      id: 'job-network',
      module: 'retouch',
      taskType: 'kie_chat',
      provider: 'kie',
      payload: {
        requestId: 'request-network',
        messages: [{
          role: 'user',
          content: [{ type: 'image_url', image_url: { url: 'https://example.com/private.png' } }],
        }],
      },
    },
    error: {
      code: 'provider_submission_unknown',
      transportErrorCode: 'UND_ERR_SOCKET',
      transportErrorSyscall: 'read',
      transportRemoteAddress: '104.18.5.14',
      transportRemotePort: 443,
      authorization: 'Bearer secret-must-not-leak',
    },
  });

  assert.equal(meta.transportErrorCode, 'UND_ERR_SOCKET');
  assert.equal(meta.transportErrorSyscall, 'read');
  assert.equal(meta.transportRemoteAddress, '104.18.5.14');
  assert.equal(meta.transportRemotePort, 443);
  assert.equal(JSON.stringify(meta).includes('private.png'), false);
  assert.equal(JSON.stringify(meta).includes('secret-must-not-leak'), false);
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

// ── 失败落库字段人话化(S2 Task G2) ──────────────────────────────

test('buildJobFailureErrorFields: errorMessage 为人话、errorDetail 保留技术原文', () => {
  const fields = buildJobFailureErrorFields({
    code: 'provider_network_error',
    message: 'fetch failed',
    providerStage: 'create_task',
  });
  assert.equal(fields.errorCode, 'provider_network_error');
  assert.equal(fields.errorMessage, '服务器到生成服务的网络暂时不稳，已自动重试仍未成功，请稍后重试');
  assert.equal(fields.errorDetail, 'fetch failed');
});

test('buildJobFailureErrorFields: 缺 code 时兜底 provider_internal_error，errorMessage 非空', () => {
  const fields = buildJobFailureErrorFields({ message: 'boom' });
  assert.equal(fields.errorCode, 'provider_internal_error');
  assert.ok(fields.errorMessage.length > 0);
  assert.equal(fields.errorDetail, 'boom');
});

test('buildJobFailureErrorFields: 超长原文截断到 5000 以内', () => {
  const fields = buildJobFailureErrorFields({ code: 'provider_internal_error', message: 'x'.repeat(9000) });
  assert.ok(fields.errorDetail.length <= 5000);
  assert.ok(fields.errorMessage.length <= 5000);
});
