const RETRYABLE_ERROR_CODES = new Set([
  'provider_internal_error',
  'provider_network_error',
  'provider_rate_limited',
  'provider_timeout',
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
    {
      id: 'nano-banana-pro',
      label: 'Nano Banana Pro',
      provider: 'kie',
      supportsMultiImageInput: true,
      supportsImageEdit: true,
      maxInputImages: 10,
      defaultSize: 'auto',
      defaultResolution: '2K',
      supportedSizes: ['auto', '1:1', '3:4', '4:3', '4:5', '9:16', '16:9'],
      supportsTransparentBackground: false,
    },
  ],
};

const toSafePositiveInteger = (value, fallback) => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const normalizeBaseUrl = (value) => String(value || '').trim().replace(/\/+$/, '');

const isExternallyReachableBaseUrl = (value) => {
  const normalized = normalizeBaseUrl(value);
  if (!normalized) return false;
  return !/(^https?:\/\/)?(127\.0\.0\.1|localhost)(:|\/|$)/i.test(normalized);
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

export const buildPublicSystemConfig = (env, queueStats = {}, overrides = {}) => {
  const allowedOrigins = normalizeAllowedOrigins(env.MEIAO_ALLOWED_ORIGINS);
  const chatCatalog = applyRuntimeMediaCapabilities(AGENT_MODEL_CATALOG.chat, env, overrides);
  const configuredAnalysisModel = String(overrides?.systemSettings?.analysisModel || '').trim();
  const effectiveAnalysisModel = chatCatalog.some((item) => item.id === configuredAnalysisModel)
    ? configuredAnalysisModel
    : String(
        env.MEIAO_AGENT_ANALYSIS_MODEL ||
        env.MEIAO_PLANNING_ANALYSIS_MODEL ||
        env.MEIAO_DEFAULT_ANALYSIS_MODEL ||
        env.MEIAO_DEFAULT_CHAT_MODEL ||
        env.KIE_CHAT_MODEL ||
        chatCatalog[0]?.id ||
        ''
      ).trim();

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
      analysisModel: configuredAnalysisModel,
      effectiveAnalysisModel,
    },
    agentModels: {
      chat: chatCatalog,
      image: AGENT_MODEL_CATALOG.image.map((item) => ({ ...item })),
    },
  };
};
