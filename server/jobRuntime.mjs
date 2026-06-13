import { isExternallyReachableBaseUrl, normalizeBaseUrl } from '../src/utils/publicNetworkUrl.mjs';

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
    {
      id: 'gemini-3-5-flash',
      label: 'Gemini 3.5 Flash',
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
      id: 'gpt-image-2-secondary',
      label: 'GPT Image 2（副）',
      provider: 'apiports',
      supportsMultiImageInput: true,
      supportsImageEdit: true,
      maxInputImages: 16,
      defaultSize: 'auto',
      defaultResolution: '1K',
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
  TRANSIENT_MYSQL_CONNECTION_ERROR_CODES.has(String(error?.code || ''))
  || /pool is closed|connection lost|server closed the connection/i.test(String(error?.message || ''));

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// reconcile loop 退避:按连续失败次数指数放大间隔,封顶 maxMs,下限 baseMs。
// failureCount=0(健康)→ baseMs;每多失败一次翻倍。成功后调用方应把计数清零。
export const getReconcileBackoffMs = (failureCount, baseMs, maxMs) => {
  const base = Number(baseMs) > 0 ? Number(baseMs) : 60000;
  const max = Number(maxMs) > 0 ? Number(maxMs) : base;
  const failures = Number.isFinite(failureCount) && failureCount > 0 ? Math.floor(failureCount) : 0;
  return Math.min(base * 2 ** failures, max);
};

// 瞬时连接错(Pool is closed 等)有限次重试 + 指数退避。
// 非瞬时错立即抛;重试耗尽抛最后一次错。sleep 可注入便于测试。
export const runWithTransientRetry = async (operation, {
  maxRetries = 2,
  isTransient = isTransientMysqlConnectionError,
  backoffMs = (attempt) => Math.min(200 * 2 ** attempt, 4000),
  sleep = defaultSleep,
  onRetry,
} = {}) => {
  let attempt = 0;
  for (;;) {
    try {
      return await operation();
    } catch (error) {
      if (!isTransient(error) || attempt >= maxRetries) throw error;
      const delay = backoffMs(attempt);
      if (onRetry) onRetry({ attempt, delay, error });
      await sleep(delay);
      attempt += 1;
    }
  }
};

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

const trimLogText = (value, limit = 160) => {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
};

const normalizeLogNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const normalizeLogCreditsConsumed = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
};

const DIAGNOSTIC_SCHEMA_VERSION = '2026-05-26.1';

const firstNonEmpty = (...values) => {
  for (const value of values) {
    const text = String(value || '').trim();
    if (text) return text;
  }
  return '';
};

const countStringItems = (value) => {
  if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean).length;
  const text = String(value || '').trim();
  return text ? 1 : 0;
};

const countMessageInputs = (messages = []) => {
  const counts = { imageUrlCount: 0, fileUrlCount: 0, promptLength: 0 };
  if (!Array.isArray(messages)) return counts;

  const visitContent = (content) => {
    if (typeof content === 'string') {
      counts.promptLength += content.length;
      return;
    }
    if (Array.isArray(content)) {
      content.forEach(visitContent);
      return;
    }
    if (!content || typeof content !== 'object') return;

    const type = String(content.type || '').trim();
    if (type === 'text') {
      counts.promptLength += String(content.text || '').length;
      return;
    }
    if (type === 'image_url' && content.image_url?.url) {
      counts.imageUrlCount += 1;
      return;
    }
    if ((type === 'input_file' || type === 'file') && (content.file_url || content.fileUrl || content.url)) {
      counts.fileUrlCount += 1;
      return;
    }

    Object.values(content).forEach(visitContent);
  };

  messages.forEach((message) => visitContent(message?.content));
  return counts;
};

const countPayloadInputs = (payload = {}) => {
  const messageCounts = countMessageInputs(payload?.messages);
  const imageUrlCount =
    countStringItems(payload?.imageUrls)
    + countStringItems(payload?.productUrls)
    + countStringItems(payload?.referenceImages)
    + countStringItems(payload?.sourceImages)
    + messageCounts.imageUrlCount;
  const fileUrlCount =
    countStringItems(payload?.fileUrls)
    + countStringItems(payload?.files)
    + countStringItems(payload?.attachments)
    + messageCounts.fileUrlCount;
  return {
    imageUrlCount,
    fileUrlCount,
    promptLength: String(payload?.prompt || payload?.input || '').length + messageCounts.promptLength,
  };
};

export const classifyRuntimeErrorOrigin = (error = {}) => {
  const code = String(error?.code || '').toLowerCase();
  const message = String(error?.message || '').toLowerCase();
  if (/request_cancelled|aborted|abort/.test(`${code} ${message}`)) return 'user_or_browser';
  if (/provider_|rate|quota|task_not_found|timeout|fetch failed|network|upstream|server exception|maintenance/.test(`${code} ${message}`)) return 'upstream_provider';
  if (/mysql|pool is closed|connection lost|server closed the connection|er_/.test(`${code} ${message}`)) return 'database';
  if (/validation|unsupported|file type|too large|too long|bad_request/.test(`${code} ${message}`)) return 'input_or_guardrail';
  if (/typeerror|referenceerror|cannot read properties|undefined|null/.test(`${code} ${message}`)) return 'program';
  return error ? 'program_or_unknown' : '';
};

const countResultUrls = (result = {}) => {
  const values = [
    result?.imageUrl,
    result?.videoUrl,
    result?.resultUrl,
    ...(Array.isArray(result?.resultUrls) ? result.resultUrls : []),
    ...(Array.isArray(result?.imageResultUrls) ? result.imageResultUrls : []),
    ...(Array.isArray(result?.videoResultUrls) ? result.videoResultUrls : []),
    ...(Array.isArray(result?.outputUrls) ? result.outputUrls : []),
  ];
  return values.map((value) => String(value || '').trim()).filter(Boolean).length;
};

export const buildJobRuntimeLogMeta = ({
  job = {},
  result = null,
  error = null,
  finishedAt = 0,
  retryCount,
} = {}) => {
  const payload = job?.payload && typeof job.payload === 'object' ? job.payload : {};
  const resultBody = result?.result && typeof result.result === 'object' ? result.result : {};
  const doneAt = normalizeLogNumber(finishedAt, 0);
  const createdAt = normalizeLogNumber(job?.createdAt, 0);
  const rawStartedAt = normalizeLogNumber(job?.startedAt, 0);
  const startedAt = rawStartedAt || (doneAt && createdAt ? createdAt : 0);
  const providerTaskId = String(
    result?.providerTaskId
    || resultBody?.providerTaskId
    || error?.providerTaskId
    || job?.providerTaskId
    || payload?.providerTaskId
    || payload?.taskId
    || ''
  ).trim();
  const creditsConsumed = normalizeLogCreditsConsumed(resultBody?.creditsConsumed ?? result?.creditsConsumed);
  const shellProjectId = firstNonEmpty(payload?.shellProjectId, payload?.projectId, payload?.clientProjectId);
  const shellPlanId = firstNonEmpty(payload?.shellPlanId, payload?.planId);
  const requestId = firstNonEmpty(payload?.requestId, payload?.clientRequestId);
  const traceId = firstNonEmpty(payload?.traceId, payload?.diagnosticTraceId, requestId, shellPlanId ? `${shellProjectId || 'project'}:${shellPlanId}` : '', shellProjectId, job?.id);
  const inputCounts = countPayloadInputs(payload);

  return {
    diagnosticSchemaVersion: DIAGNOSTIC_SCHEMA_VERSION,
    eventKind: 'job_runtime',
    traceId,
    correlationId: firstNonEmpty(providerTaskId, job?.id, requestId),
    jobId: String(job?.id || '').trim(),
    jobStatus: String(job?.status || '').trim(),
    providerTaskId,
    provider: String(job?.provider || '').trim(),
    taskType: String(job?.taskType || '').trim(),
    module: String(job?.module || '').trim(),
    subFeature: String(payload?.subFeature || payload?.subMode || '').trim(),
    shellPurpose: String(payload?.shellPurpose || payload?.shellPlanningPurpose || '').trim(),
    shellProjectId,
    shellProjectName: trimLogText(payload?.shellProjectName || payload?.projectName || ''),
    shellPlanId,
    batchIndex: normalizeLogNumber(payload?.batchIndex, 0),
    batchCount: normalizeLogNumber(payload?.batchCount || payload?.count, 0),
    requestId,
    inputImageUrlCount: inputCounts.imageUrlCount,
    inputFileUrlCount: inputCounts.fileUrlCount,
    promptLength: inputCounts.promptLength,
    providerStage: String(result?.providerStage || error?.providerStage || '').trim(),
    providerStatus: String(result?.providerStatus || error?.providerStatus || '').trim(),
    retryCount: normalizeLogNumber(retryCount ?? job?.retryCount, 0),
    maxRetries: normalizeLogNumber(job?.maxRetries, 0),
    errorCode: String(error?.code || job?.errorCode || '').trim(),
    errorOrigin: classifyRuntimeErrorOrigin(error),
    resultUrlCount: countResultUrls(resultBody),
    ...(creditsConsumed !== undefined ? { creditsConsumed } : {}),
    queueWaitMs: rawStartedAt && createdAt ? Math.max(0, rawStartedAt - createdAt) : 0,
    runtimeMs: doneAt && startedAt ? Math.max(0, doneAt - startedAt) : 0,
    jobCreatedAt: createdAt,
    jobStartedAt: startedAt || null,
    jobFinishedAt: doneAt || null,
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
      apiports: {
        configured: Boolean(env.APIPORTS_API_KEY || env.MEIAO_APIPORTS_API_KEY),
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
