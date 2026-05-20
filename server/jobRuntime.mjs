import { isExternallyReachableBaseUrl, normalizeBaseUrl } from '../utils/publicNetworkUrl.mjs';

const RETRYABLE_ERROR_CODES = new Set([
  'provider_internal_error',
  'provider_network_error',
  'provider_rate_limited',
  'provider_timeout',
]);

const TRANSIENT_MYSQL_CONNECTION_ERROR_CODES = new Set([
  'PROTOCOL_CONNECTION_LOST',
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EPIPE',
]);

const AGENT_MODEL_CATALOG = {
  chat: [
    {
      id: 'gpt-5-4-openai-resp',
      label: 'GPT-5.4',
      provider: 'kie',
      mediaTransport: 'inline_data',
      supportsImageInput: true,
      supportsFileInput: true,
      supportsWebSearch: true,
      supportsReasoningLevel: true,
      reasoningLevels: ['minimal', 'low', 'medium', 'high', 'xhigh'],
    },
    {
      id: 'claude-sonnet-4-6',
      label: 'Claude Sonnet 4.6',
      provider: 'kie',
      supportsImageInput: true,
      supportsFileInput: true,
      supportsWebSearch: false,
      supportsReasoningLevel: true,
      reasoningLevels: ['low'],
    },
    {
      id: 'gemini-3.1-pro-openai',
      label: 'Gemini 3.1 Pro',
      provider: 'kie',
      mediaTransport: 'public_url',
      supportsImageInput: true,
      supportsFileInput: true,
      supportsWebSearch: true,
      supportsReasoningLevel: true,
      reasoningLevels: ['low', 'high'],
    },
    {
      id: 'gemini-3-flash-openai',
      label: 'Gemini 3 Flash',
      provider: 'kie',
      mediaTransport: 'public_url',
      supportsImageInput: true,
      supportsFileInput: true,
      supportsWebSearch: true,
      supportsReasoningLevel: true,
      reasoningLevels: ['low', 'high'],
    },
  ],
  image: [
    {
      id: 'gpt-image-2',
      label: 'GPT Image 2',
      provider: 'kie',
      supportsMultiImageInput: true,
      supportsImageEdit: true,
      maxInputImages: 16,
      defaultSize: 'auto',
      defaultResolution: '',
      supportedSizes: ['auto', '1:1', '3:4', '4:3', '4:5', '9:16', '16:9'],
      supportsTransparentBackground: false,
    },
    {
      id: 'nano-banana-2',
      label: 'Nano Banana 2',
      provider: 'kie',
      supportsMultiImageInput: true,
      supportsImageEdit: true,
      maxInputImages: 10,
      defaultSize: 'auto',
      defaultResolution: '1K',
      supportedSizes: ['auto', '1:1', '3:4', '4:3', '4:5', '9:16', '16:9'],
      supportsTransparentBackground: false,
    },
  ],
};

const isGeminiModelId = (modelId) => String(modelId || '').toLowerCase().startsWith('gemini');

const toSafePositiveInteger = (value, fallback) => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const resolvePublicBaseUrl = (env = {}, overrides = {}) => {
  const explicitOverride = normalizeBaseUrl(overrides?.publicBaseUrl || '');
  if (explicitOverride) return explicitOverride;
  return normalizeBaseUrl(env.MEIAO_PUBLIC_BASE_URL || env.PUBLIC_BASE_URL || '');
};

const applyRuntimeMediaCapabilities = (catalog = [], env = {}, overrides = {}) => {
  const publicBaseUrl = resolvePublicBaseUrl(env, overrides);
  const externallyReachable = isExternallyReachableBaseUrl(publicBaseUrl);
  return catalog.map((item) => {
    if (item.mediaTransport !== 'public_url') {
      return { ...item };
    }
    return {
      ...item,
      supportsImageInput: externallyReachable ? item.supportsImageInput : false,
      supportsFileInput: externallyReachable ? item.supportsFileInput : false,
    };
  });
};

export const getWorkerConcurrencyLimit = (configuredMax, users = []) => {
  const safeConfigured = toSafePositiveInteger(configuredMax, 5);
  const totalUserConcurrency = Array.isArray(users)
    ? users.reduce((sum, user) => {
        if (!user || user.status === 'disabled') return sum;
        return sum + toSafePositiveInteger(user.jobConcurrency, 5);
      }, 0)
    : 0;

  return Math.max(safeConfigured, totalUserConcurrency || safeConfigured);
};

export const normalizeAllowedOrigins = (value) => {
  if (!value) return [];

  return Array.from(
    new Set(
      String(value)
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
    )
  );
};

export const isRetryableErrorCode = (errorCode) => RETRYABLE_ERROR_CODES.has(String(errorCode || ''));

export const isTransientMysqlConnectionError = (error) =>
  TRANSIENT_MYSQL_CONNECTION_ERROR_CODES.has(String(error?.code || ''));

export const getNextJobFailureState = ({ retryCount = 0, maxRetries = 0, errorCode = '' }) => {
  if (!isRetryableErrorCode(errorCode)) {
    return { status: 'failed', retryCount };
  }

  if (retryCount >= maxRetries) {
    return { status: 'failed', retryCount };
  }

  return {
    status: 'retry_waiting',
    retryCount: retryCount + 1,
  };
};

export const buildJobFailureLogFields = ({ jobStatus = '', taskType = '' }) => {
  const taskLabel = String(taskType || 'unknown').trim() || 'unknown';
  if (jobStatus === 'retry_waiting') {
    return {
      level: 'info',
      action: 'job_retry_waiting',
      message: `${taskLabel} 任务重试中`,
      status: 'started',
    };
  }
  return {
    level: 'error',
    action: 'job_failed',
    message: `${taskLabel} 任务失败`,
    status: 'failed',
  };
};

export const buildPublicSystemConfig = (env, queueStats = {}, overrides = {}) => {
  const allowedOrigins = normalizeAllowedOrigins(env.MEIAO_ALLOWED_ORIGINS);
  const publicBaseUrl = normalizeBaseUrl(overrides?.publicBaseUrl || env.MEIAO_PUBLIC_BASE_URL || env.PUBLIC_BASE_URL || '');
  const chatCatalog = applyRuntimeMediaCapabilities(AGENT_MODEL_CATALOG.chat, env, overrides);
  const videoAnalysisModels = chatCatalog.filter((item) => isGeminiModelId(item.id));
  const configuredAnalysisModel = String(overrides?.systemSettings?.analysisModel || '').trim();
  const configuredUserAnalysisModel = String(overrides?.userSettings?.analysisModel || '').trim();
  const configuredVideoAnalysisModel = String(overrides?.systemSettings?.videoAnalysisModel || '').trim();
  const validConfiguredAnalysisModel = chatCatalog.some((item) => item.id === configuredAnalysisModel)
    ? configuredAnalysisModel
    : '';
  const validConfiguredUserAnalysisModel = chatCatalog.some((item) => item.id === configuredUserAnalysisModel)
    ? configuredUserAnalysisModel
    : '';
  const defaultAnalysisModel = String(
    env.MEIAO_AGENT_ANALYSIS_MODEL ||
    env.MEIAO_PLANNING_ANALYSIS_MODEL ||
    env.MEIAO_DEFAULT_ANALYSIS_MODEL ||
    env.MEIAO_DEFAULT_CHAT_MODEL ||
    env.KIE_CHAT_MODEL ||
    chatCatalog[0]?.id ||
    ''
  ).trim();
  const effectiveAnalysisModel = validConfiguredUserAnalysisModel || validConfiguredAnalysisModel || defaultAnalysisModel;
  const envVideoAnalysisModel = String(env.MEIAO_VIDEO_ANALYSIS_MODEL || '').trim();
  const defaultVideoAnalysisModel = videoAnalysisModels.some((item) => item.id === 'gemini-3-flash-openai')
    ? 'gemini-3-flash-openai'
    : videoAnalysisModels[0]?.id || '';
  const validConfiguredVideoAnalysisModel = videoAnalysisModels.some((item) => item.id === configuredVideoAnalysisModel)
    ? configuredVideoAnalysisModel
    : '';
  const effectiveVideoAnalysisModel = validConfiguredVideoAnalysisModel
    || (videoAnalysisModels.some((item) => item.id === envVideoAnalysisModel)
      ? envVideoAnalysisModel
      : defaultVideoAnalysisModel);

  return {
    queue: {
      maxConcurrency: toSafePositiveInteger(overrides.maxConcurrency, toSafePositiveInteger(env.MEIAO_JOB_MAX_CONCURRENCY, 5)),
      queuedCount: Number(queueStats.queued || 0),
      runningCount: Number(queueStats.running || 0),
    },
    cors: {
      allowedOrigins,
    },
    providers: {
      kie: {
        configured: Boolean(env.KIE_API_KEY),
      },
    },
    systemSettings: {
      analysisModel: validConfiguredAnalysisModel,
      userAnalysisModel: validConfiguredUserAnalysisModel,
      effectiveAnalysisModel,
      videoAnalysisModel: validConfiguredVideoAnalysisModel,
      effectiveVideoAnalysisModel,
      videoAnalysisReasoningLevel: 'high',
    },
    videoAnalysisModels: videoAnalysisModels.map((item) => ({ ...item })),
    publicBaseUrl,
    agentModels: {
      chat: chatCatalog,
      image: AGENT_MODEL_CATALOG.image.map((item) => ({ ...item })),
    },
  };
};
