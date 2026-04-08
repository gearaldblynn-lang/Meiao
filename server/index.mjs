import { createServer } from 'node:http';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { createReadStream, mkdirSync, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildAgentPromptMessages,
  buildConversationSummary,
  chunkKnowledgeText,
  createDefaultVersionName,
  estimateCostByTokens,
  estimateTokenCount,
  normalizeKnowledgeChunkStrategy,
  normalizeAgentConfig,
  searchKnowledgeChunks,
} from '../modules/AgentCenter/agentCenterUtils.mjs';
import { buildLogFilterOptions, normalizeLogPagination } from '../modules/Account/logQueryUtils.mjs';
import { loadServerEnvFile } from './envLoader.mjs';
import { ensureJobsSchema, createJobRecord, findReusableJobRecord, getJobById, listJobsForUser, getJobQueueStats, requestCancelJob, requestRetryJob, createJobWorker } from './jobManager.mjs';
import {
  createLocalJobRecord,
  createLocalJobWorker,
  findReusableLocalJobRecord,
  getLocalJobById,
  getLocalJobQueueStats,
  listLocalJobsForUser,
  markLocalJobCompleted,
  reconcileRestartedLocalJobs,
  requestLocalCancelJob,
  requestLocalRetryJob,
} from './localJobStore.mjs';
import { executeProviderJob } from './providerGateway.mjs';
import { buildPublicSystemConfig, getWorkerConcurrencyLimit, normalizeAllowedOrigins } from './jobRuntime.mjs';
import {
  buildAssetPublicPath,
  ensureAssetSchema,
  getPublicBaseUrl,
  getStoredAssetById,
  listStoredAssets,
  markStoredAssetAccessed,
  markStoredAssetDeleted,
  persistAssetBuffer,
  persistRemoteAsset,
  resolveStoredAssetPath,
  selectExpiredAssetsForCleanup,
  deleteStoredAssetFile,
} from './assetStore.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
loadServerEnvFile({ envPath: path.join(__dirname, '..', '.env.server') });
const dataDir = path.join(__dirname, 'data');
const storePath = path.join(dataDir, 'internal-store.json');
const distDir = path.join(__dirname, '..', 'dist');
const PORT = Number(process.env.PORT || 3100);
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;
const ASSET_RETENTION_MS = 1000 * 60 * 60 * 24 * 3;
const LOG_RETENTION_MS = 1000 * 60 * 60 * 24 * 7;
const MAX_JSON_BODY_BYTES = 25 * 1024 * 1024;
const INTERNAL_ASSET_REGISTRY_KEY = '__assetRegistry';
const TRACKED_URL_FIELDS = new Set([
  'resultUrl',
  'sourceUrl',
  'uploadedReferenceUrl',
  'lastStyleUrl',
  'uploadedLogoUrl',
  'imageUrl',
  'whiteBgImageUrl',
  'previousBoardImageUrl',
]);
const TRACKED_URL_ARRAY_FIELDS = new Set(['uploadedProductUrls', 'veoReferenceImages']);
const NULLABLE_TRACKED_FIELDS = new Set(['uploadedReferenceUrl', 'lastStyleUrl', 'uploadedLogoUrl', 'whiteBgImageUrl']);

const STATIC_CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

const dbConfig = {
  host: process.env.MEIAO_DB_HOST || '',
  port: Number(process.env.MEIAO_DB_PORT || 3306),
  user: process.env.MEIAO_DB_USER || '',
  password: process.env.MEIAO_DB_PASSWORD || '',
  database: process.env.MEIAO_DB_NAME || '',
};

const shouldUseMysql = Boolean(
  dbConfig.host &&
  dbConfig.user &&
  dbConfig.password &&
  dbConfig.database
);

let mysql = null;
let mysqlPool = null;
let jobWorker = null;
let localJobWorker = null;
let localStoreCache = null;
let assetCleanupTimer = null;

const defaultApiConfig = {
  kieApiKey: '',
  concurrency: 5,
};

const DEFAULT_JOB_CONCURRENCY = 5;

const defaultModuleConfig = {
  targetLanguage: 'English',
  customLanguage: '',
  removeWatermark: true,
  aspectRatio: 'auto',
  quality: '1k',
  model: 'nano-banana-2',
  resolutionMode: 'custom',
  targetWidth: 1200,
  targetHeight: 1200,
  maxFileSize: 2.0,
};

const defaultTranslationConfigs = {
  main: {
    targetLanguage: 'English',
    customLanguage: '',
    removeWatermark: true,
    aspectRatio: '1:1',
    quality: '1k',
    model: 'nano-banana-2',
    resolutionMode: 'custom',
    targetWidth: 800,
    targetHeight: 800,
    maxFileSize: 2.0,
  },
  detail: {
    targetLanguage: 'English',
    customLanguage: '',
    removeWatermark: true,
    aspectRatio: 'auto',
    quality: '1k',
    model: 'nano-banana-2',
    resolutionMode: 'custom',
    targetWidth: 750,
    targetHeight: 0,
    maxFileSize: 2.0,
  },
  removeText: {
    targetLanguage: 'English',
    customLanguage: '',
    removeWatermark: true,
    aspectRatio: 'auto',
    quality: '1k',
    model: 'nano-banana-2',
    resolutionMode: 'custom',
    targetWidth: 1200,
    targetHeight: 0,
    maxFileSize: 2.0,
  },
};

const MANAGED_ASSET_PATH_SEGMENT = '/api/assets/file/';
const ASSET_FILE_ROUTE_REGEX = /^\/api\/assets\/file\/([^/]+)(?:\/[^/]+)?$/;
const ASSET_CLEANUP_INTERVAL_MS = 1000 * 60 * 30;

const isLocalHostValue = (value) => /(^|\/\/)(127\.0\.0\.1|localhost)(:|$)/i.test(String(value || ''));

const getPersistentAssetBaseUrl = (req = null) => {
  const explicit = getPublicBaseUrl(process.env, null);
  if (explicit) return explicit;

  const inferred = getPublicBaseUrl({}, req);
  if (!inferred || isLocalHostValue(inferred)) return '';
  return inferred;
};

const isManagedAssetUrl = (value) => typeof value === 'string' && value.includes(MANAGED_ASSET_PATH_SEGMENT);

const collectManagedAssetUrls = (value, bucket = new Set()) => {
  if (Array.isArray(value)) {
    value.forEach((item) => collectManagedAssetUrls(item, bucket));
    return bucket;
  }
  if (!value || typeof value !== 'object') {
    if (isManagedAssetUrl(value)) {
      bucket.add(value);
    }
    return bucket;
  }

  Object.values(value).forEach((child) => collectManagedAssetUrls(child, bucket));
  return bucket;
};

const scrubUnavailableManagedAssetUrls = (value, validAssetUrls) => {
  if (Array.isArray(value)) {
    return value.map((item) => scrubUnavailableManagedAssetUrls(item, validAssetUrls)).filter((item) => item !== undefined);
  }

  if (!value || typeof value !== 'object') {
    if (isManagedAssetUrl(value) && !validAssetUrls.has(value)) {
      return undefined;
    }
    return value;
  }

  const next = {};
  for (const [key, child] of Object.entries(value)) {
    const cleaned = scrubUnavailableManagedAssetUrls(child, validAssetUrls);
    next[key] = cleaned === undefined ? (NULLABLE_TRACKED_FIELDS.has(key) ? null : Array.isArray(child) ? [] : undefined) : cleaned;
  }
  return next;
};

const sanitizePathPart = (value) => value.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 48) || 'anonymous';

const createDefaultState = () => ({
  activeModule: 'one_click',
  apiConfig: defaultApiConfig,
  moduleConfig: defaultModuleConfig,
  translationConfigs: defaultTranslationConfigs,
  translationMemory: {
    main: { files: [], isProcessing: false },
    detail: { files: [], isProcessing: false },
    removeText: { files: [], isProcessing: false },
  },
  oneClickMemory: {
    mainImage: {
      productImages: [],
      logoImage: null,
      uploadedLogoUrl: null,
      styleImage: null,
      schemes: [],
      config: {
        description: '',
        platformType: 'domestic',
        platform: '淘宝',
        language: '中文',
        count: 3,
        aspectRatio: '1:1',
        quality: '1k',
        model: 'nano-banana-2',
        styleStrength: 'medium',
        resolutionMode: 'custom',
        targetWidth: 800,
        targetHeight: 800,
        maxFileSize: 2.0,
      },
      lastStyleUrl: null,
      uploadedProductUrls: [],
      directions: [],
    },
    detailPage: {
      productImages: [],
      logoImage: null,
      uploadedLogoUrl: null,
      styleImage: null,
      schemes: [],
      config: {
        description: '',
        platformType: 'domestic',
        platform: '淘宝',
        language: '中文',
        count: 7,
        aspectRatio: 'auto',
        quality: '1k',
        model: 'nano-banana-2',
        styleStrength: 'medium',
        resolutionMode: 'custom',
        targetWidth: 750,
        targetHeight: 0,
        maxFileSize: 2.0,
      },
      lastStyleUrl: null,
      uploadedProductUrls: [],
      directions: [],
    },
  },
  retouchMemory: {
    tasks: [],
    pendingFiles: [],
    referenceImage: null,
    uploadedReferenceUrl: null,
    mode: 'white_bg',
    aspectRatio: 'auto',
    quality: '1k',
    model: 'nano-banana-2',
    resolutionMode: 'original',
    targetWidth: 0,
    targetHeight: 0,
  },
  buyerShowMemory: {
    subMode: 'integrated',
    productImages: [],
    uploadedProductUrls: [],
    referenceImage: null,
    uploadedReferenceUrl: null,
    referenceStrength: 'medium',
    productName: '',
    productFeatures: '',
    userRequirement: '',
    targetCountry: '美国',
    customCountry: '',
    includeModel: true,
    aspectRatio: '3:4',
    quality: '1k',
    model: 'nano-banana-2',
    imageCount: 3,
    setCount: 1,
    sets: [],
    tasks: [],
    evaluationText: '',
    pureEvaluations: [],
    firstImageConfirmed: false,
    isAnalyzing: false,
    isGenerating: false,
  },
  videoMemory: {
    subMode: 'long_video',
    config: {
      duration: '15',
      aspectRatio: 'landscape',
      promptMode: 'ai',
      script: '',
      scenes: [],
      productInfo: '',
      requirements: '',
      targetCountry: '美国',
      customCountry: '',
      referenceVideoUrl: '',
      videoCount: 1,
      targetLanguage: '',
      sellingPoints: '',
      logicInfo: '',
    },
    productImages: [],
    referenceVideoFile: null,
    tasks: [],
    veoProjects: [],
    veoReferenceImages: [],
    isAnalyzing: false,
    isGenerating: false,
    storyboard: {
      config: {
        productImages: [],
        uploadedProductUrls: [],
        productInfo: '',
        scriptLogic: '',
        scriptPreset: 'custom',
        aspectRatio: '9:16',
        duration: '15s',
        shotCount: 9,
        actorType: 'no_real_face',
        projectCount: 1,
        scenes: [''],
        countryLanguage: '中国/中文',
        generateWhiteBg: false,
        model: 'nano-banana-pro',
        quality: '2k',
      },
      projects: [],
      downloadingProjectId: null,
    },
  },
});

const createDefaultSystemSettings = () => ({
  analysisModel: '',
});

const normalizeSystemSettings = (value = {}) => {
  const analysisModel = String(value?.analysisModel || '').trim();
  const available = new Set(getChatModelCatalog().map((item) => item.id));
  return {
    analysisModel: analysisModel && available.has(analysisModel) ? analysisModel : '',
  };
};

const cloneJsonValue = (value) => JSON.parse(JSON.stringify(value ?? createDefaultState()));

const isRemoteAssetUrl = (value) => typeof value === 'string' && /^https?:\/\//i.test(value);

const normalizeAssetRegistry = (value) => {
  if (!Array.isArray(value)) return [];

  const now = Date.now();
  const uniqueMap = new Map();
  for (const item of value) {
    if (!item || typeof item !== 'object' || !isRemoteAssetUrl(item.url)) continue;
    const createdAt = Number(item.createdAt || 0);
    if (!createdAt || now - createdAt > ASSET_RETENTION_MS) continue;
    if (!uniqueMap.has(item.url)) {
      uniqueMap.set(item.url, { url: item.url, createdAt });
    }
  }

  return Array.from(uniqueMap.values());
};

const collectTrackedAssetUrls = (value, fieldName, bucket) => {
  if (Array.isArray(value)) {
    if (fieldName && TRACKED_URL_ARRAY_FIELDS.has(fieldName)) {
      value.forEach((item) => {
        if (isRemoteAssetUrl(item)) {
          bucket.add(item);
        }
      });
      return;
    }

    value.forEach((item) => collectTrackedAssetUrls(item, undefined, bucket));
    return;
  }

  if (!value || typeof value !== 'object') return;

  Object.entries(value).forEach(([key, child]) => {
    if (TRACKED_URL_FIELDS.has(key) && isRemoteAssetUrl(child)) {
      bucket.add(child);
      return;
    }

    collectTrackedAssetUrls(child, key, bucket);
  });
};

const clearExpiredAssetsFromState = (value, registryMap, fieldName) => {
  if (Array.isArray(value)) {
    if (fieldName && TRACKED_URL_ARRAY_FIELDS.has(fieldName)) {
      return value.map((item) => {
        if (!isRemoteAssetUrl(item)) return item;
        return registryMap.has(item) ? item : '';
      });
    }

    return value.map((item) => clearExpiredAssetsFromState(item, registryMap, undefined));
  }

  if (!value || typeof value !== 'object') return value;

  const next = {};
  for (const [key, child] of Object.entries(value)) {
    if (TRACKED_URL_FIELDS.has(key) && isRemoteAssetUrl(child) && !registryMap.has(child)) {
      next[key] = NULLABLE_TRACKED_FIELDS.has(key) ? null : undefined;
      continue;
    }

    next[key] = clearExpiredAssetsFromState(child, registryMap, key);
  }

  return next;
};

const prepareStateForStorage = (state) => {
  const rawState = cloneJsonValue(state || createDefaultState());
  const existingRegistry = normalizeAssetRegistry(rawState[INTERNAL_ASSET_REGISTRY_KEY]);
  delete rawState[INTERNAL_ASSET_REGISTRY_KEY];

  const urlBucket = new Set();
  collectTrackedAssetUrls(rawState, undefined, urlBucket);

  const existingMap = new Map(existingRegistry.map((item) => [item.url, item.createdAt]));
  const nextRegistry = Array.from(urlBucket).map((url) => ({
    url,
    createdAt: existingMap.get(url) || Date.now(),
  }));

  const validRegistry = normalizeAssetRegistry(nextRegistry);
  const registryMap = new Map(validRegistry.map((item) => [item.url, item.createdAt]));
  const prunedState = clearExpiredAssetsFromState(rawState, registryMap, undefined);
  prunedState[INTERNAL_ASSET_REGISTRY_KEY] = validRegistry;
  return prunedState;
};

const prepareStateForClient = (state) => {
  const storedState = prepareStateForStorage(state);
  const clonedState = cloneJsonValue(storedState);
  delete clonedState[INTERNAL_ASSET_REGISTRY_KEY];
  return clonedState;
};

const createPasswordRecord = (password) => {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
};

const verifyPassword = (password, passwordHash, salt) => {
  const computed = scryptSync(password, salt, 64);
  const saved = Buffer.from(passwordHash, 'hex');
  return computed.length === saved.length && timingSafeEqual(computed, saved);
};

const normalizeJobConcurrency = (value, fallback = DEFAULT_JOB_CONCURRENCY) => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const normalizeStoredUser = (user) => ({
  ...user,
  displayName: String(user?.displayName || user?.username || ''),
  avatarUrl: user?.avatarUrl ? String(user.avatarUrl) : '',
  avatarPreset: user?.avatarPreset ? String(user.avatarPreset) : 'aurora',
  jobConcurrency: normalizeJobConcurrency(user?.jobConcurrency, DEFAULT_JOB_CONCURRENCY),
});

const createUser = ({ username, password, role = 'staff', displayName = '', jobConcurrency = DEFAULT_JOB_CONCURRENCY }) => {
  const passwordRecord = createPasswordRecord(password);
  return {
    id: randomBytes(12).toString('hex'),
    username,
    displayName: displayName || username,
    avatarUrl: '',
    avatarPreset: 'aurora',
    role,
    status: 'active',
    passwordHash: passwordRecord.hash,
    salt: passwordRecord.salt,
    createdAt: Date.now(),
    lastLoginAt: null,
    jobConcurrency: normalizeJobConcurrency(jobConcurrency, DEFAULT_JOB_CONCURRENCY),
  };
};

const createLogEntry = ({ user, level = 'info', module = 'system', action = 'unknown', message = '', detail = '', status = 'started', meta = null }) => ({
  id: randomBytes(12).toString('hex'),
  createdAt: Date.now(),
  level,
  module,
  action,
  message,
  detail,
  status,
  userId: user.id,
  username: user.username,
  displayName: user.displayName || user.username,
  meta: meta && typeof meta === 'object' ? meta : null,
});

const buildAgentRuntimeLogMeta = ({ agent, version, result = null, requestMode = '', sessionId = null, clientRequestId = '', error = null }) => ({
  agentId: agent?.id || '',
  agentName: agent?.name || '',
  versionId: version?.id || '',
  versionName: version?.versionName || '',
  sessionId: result?.sessionId || sessionId || null,
  clientRequestId: result?.clientRequestId || clientRequestId || null,
  requestType: result?.requestType || requestMode || (result?.sessionId ? 'chat' : 'validation'),
  selectedModel: result?.selectedModel || version?.modelPolicy?.defaultModel || '',
  totalTokens: Number(result?.totalTokens || 0),
  estimatedCost: Number(result?.estimatedCost || 0),
  latencyMs: Number(result?.latencyMs || 0),
  usedRetrieval: Boolean(result?.usedRetrieval),
  retrievalSummary: result?.retrievalSummary || [],
  imagePlan: result?.imagePlan || null,
  imageResultCount: Array.isArray(result?.imageResultUrls) ? result.imageResultUrls.length : 0,
  imageResultUrls: result?.imageResultUrls || [],
  errorCode: result?.errorCode || error?.code || '',
  errorMessage: error?.message || '',
});

const getLogRetentionCutoff = () => Date.now() - LOG_RETENTION_MS;

const AGENT_VISIBILITY_SCOPE = 'internal';
const AGENT_SUMMARY_WINDOW_MS = 1000 * 60 * 60 * 24 * 7;

const parseJsonField = (value, fallback) => {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};

const stringifyJsonField = (value, fallback = {}) => JSON.stringify(value && typeof value === 'object' ? value : fallback);

const createEntityId = () => randomBytes(12).toString('hex');

const getSuperAdminUsernames = () => {
  const usernames = new Set([
    process.env.MEIAO_ADMIN_USERNAME || 'admin',
    '将离',
  ]);
  String(process.env.MEIAO_SUPER_ADMIN_USERS || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .forEach((item) => usernames.add(item));
  return usernames;
};

const isSuperAdminUser = (user) => Boolean(user?.role === 'admin' && user?.username && getSuperAdminUsernames().has(user.username));

const cleanKnowledgeBaseIds = (value) => Array.from(new Set((Array.isArray(value) ? value : []).map((item) => String(item || '').trim()).filter(Boolean)));

const normalizeAgentStatus = (value) => (['draft', 'published', 'archived'].includes(value) ? value : 'draft');
const normalizeKnowledgeBaseStatus = (value) => (['active', 'archived'].includes(value) ? value : 'active');
const normalizeValidationStatus = (value) => (['pending', 'success', 'failed'].includes(value) ? value : 'pending');
const normalizeSourceType = (value) => (value === 'manual' ? 'manual' : 'upload');
const normalizeKnowledgeNormalizedStatus = (value) => (['idle', 'processing', 'success', 'failed'].includes(value) ? value : 'idle');
const normalizeKnowledgeChunkSource = (value) => (value === 'normalized' ? 'normalized' : 'raw');
const normalizeKnowledgeChunkStrategyValue = (value) => normalizeKnowledgeChunkStrategy(value);
const normalizeVersionName = (value, versionNo, timestamp = Date.now()) => {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  const fallbackName = createDefaultVersionName(versionNo, timestamp);
  if (!trimmed) return fallbackName.slice(0, 160);
  if (trimmed === 'V1' && Number(versionNo || 1) !== 1) return fallbackName.slice(0, 160);
  return trimmed.slice(0, 160);
};
const getChatModelCatalog = () => buildPublicSystemConfig(process.env).agentModels.chat || [];
const getImageModelCatalog = () => buildPublicSystemConfig(process.env).agentModels.image || [];
const getChatModelCapability = (modelId) => getChatModelCatalog().find((item) => item.id === modelId) || null;
const getImageModelCapability = (modelId) => getImageModelCatalog().find((item) => item.id === modelId) || null;
const resolveDefaultAnalysisChatModel = (...preferredModels) => {
  const available = getChatModelCatalog().map((item) => item.id);
  for (const item of preferredModels) {
    const modelId = String(item || '').trim();
    if (modelId && available.includes(modelId)) return modelId;
  }
  return available[0] || '';
};
const resolveConfiguredAnalysisModel = (systemSettings = {}, ...preferredModels) =>
  resolveDefaultAnalysisChatModel(
    systemSettings?.analysisModel,
    process.env?.MEIAO_AGENT_ANALYSIS_MODEL,
    process.env?.MEIAO_PLANNING_ANALYSIS_MODEL,
    process.env?.MEIAO_DEFAULT_ANALYSIS_MODEL,
    process.env?.MEIAO_DEFAULT_CHAT_MODEL,
    process.env?.KIE_CHAT_MODEL,
    ...preferredModels
  );
const sanitizeAllowedChatModels = (configured, fallbacks = []) => {
  const available = new Set(getChatModelCatalog().map((item) => item.id));
  const preferred = [...(Array.isArray(configured) ? configured : []), ...fallbacks]
    .map((item) => String(item || '').trim())
    .filter((item) => item && available.has(item));
  const unique = Array.from(new Set(preferred));
  if (unique.length > 0) return unique;
  return getChatModelCatalog()[0]?.id ? [getChatModelCatalog()[0].id] : [];
};
const resolveImageModel = (requestedModel = '') => {
  const available = getImageModelCatalog().map((item) => item.id);
  const preferred = String(requestedModel || '').trim();
  if (preferred && available.includes(preferred)) return preferred;
  return available[0] || 'nano-banana-2';
};
const sanitizeModelPolicy = (modelPolicy = {}, allowedChatModels = []) => {
  const safeAllowedChatModels = sanitizeAllowedChatModels(allowedChatModels, [
    modelPolicy?.defaultModel,
    modelPolicy?.cheapModel,
    modelPolicy?.advancedModel,
  ]);
  const defaultModel = safeAllowedChatModels.includes(String(modelPolicy?.defaultModel || '').trim())
    ? String(modelPolicy.defaultModel).trim()
    : safeAllowedChatModels[0] || '';
  const cheapModel = safeAllowedChatModels.includes(String(modelPolicy?.cheapModel || '').trim())
    ? String(modelPolicy.cheapModel).trim()
    : defaultModel;
  const advancedModel = safeAllowedChatModels.includes(String(modelPolicy?.advancedModel || '').trim())
    ? String(modelPolicy.advancedModel).trim()
    : defaultModel;

  return {
    ...modelPolicy,
    defaultModel,
    cheapModel,
    advancedModel,
    multimodalModel: resolveImageModel(modelPolicy?.multimodalModel),
    imageGenerationEnabled: Boolean(modelPolicy?.imageGenerationEnabled),
  };
};
const resolveAllowedChatModels = (version) => {
  const configured = Array.isArray(version?.allowedChatModels) && version.allowedChatModels.length > 0
    ? version.allowedChatModels
    : [version?.defaultChatModel || version?.modelPolicy?.defaultModel || version?.modelPolicy?.cheapModel].filter(Boolean);
  return sanitizeAllowedChatModels(configured, [version?.defaultChatModel, version?.modelPolicy?.defaultModel, version?.modelPolicy?.cheapModel]);
};
const resolveChatSessionModel = (version, requestedModel = '') => {
  const allowedModels = resolveAllowedChatModels(version);
  const preferred = String(requestedModel || version?.defaultChatModel || version?.modelPolicy?.defaultModel || version?.modelPolicy?.cheapModel || '').trim();
  if (preferred && allowedModels.includes(preferred)) return preferred;
  return allowedModels[0] || preferred;
};

const canManageOwnedResource = (user, ownerUserId) => Boolean(user?.role === 'admin' && (isSuperAdminUser(user) || ownerUserId === user.id));

const shouldUseKnowledgeRetrieval = (message, retrievalPolicy, knowledgeBaseIds) => {
  if (!retrievalPolicy?.enabled) return false;
  if (!Array.isArray(knowledgeBaseIds) || knowledgeBaseIds.length === 0) return false;
  const text = String(message || '').trim();
  if (!text) return false;
  if (text.length >= 12) return true;
  return /(怎么|如何|流程|步骤|规则|要求|SOP|知识库|是否|能否|说明|退款|售后|权限|配置|设置|为什么)/i.test(text);
};

const buildKnowledgeNormalizationPrompt = (rawText) => ([
  '你是一名知识库整理助手。',
  '你的任务是把用户提供的规则、SOP 或规范性文档整理成更适合检索的结构化文本。',
  '必须保留原意，不得凭空新增规则，不得删掉关键限制。',
  '优先整理成短标题 + 规则说明 + 条目列表的形式，让每条规则尽量独立完整。',
  '如果原文本身已经结构清晰，也只做轻量整理，不要过度改写。',
  '只输出整理后的正文，不要解释，不要加代码块，不要加前言。',
  '',
  '待整理原文：',
  String(rawText || '').trim(),
].join('\n'));

const normalizeKnowledgeDocumentText = async (rawText, processEnv, systemSettings = {}) => {
  const source = String(rawText || '').trim();
  if (!source) {
    return { normalizedText: '', normalizedStatus: 'failed', chunkSource: 'raw', normalizationError: '原文为空，无法整理。' };
  }
  try {
    const normalizationModel = resolveConfiguredAnalysisModel(systemSettings);
    if (!normalizationModel) {
      return { normalizedText: '', normalizedStatus: 'failed', chunkSource: 'raw', normalizationError: '当前没有可用的分析模型。' };
    }
    const messages = [
      { role: 'system', content: '你负责把知识库原文整理为更适合检索的规则化文本。' },
      { role: 'user', content: buildKnowledgeNormalizationPrompt(source) },
    ];
    const output = await executeProviderJob(
      {
        taskType: 'kie_chat',
        payload: {
          messages,
          model: normalizationModel,
        },
      },
      processEnv,
      new AbortController().signal
    );
    const normalizedText = String(output?.result?.content || '').trim();
    if (!normalizedText) {
      return { normalizedText: '', normalizedStatus: 'failed', chunkSource: 'raw', normalizationError: '分析模型未返回可用整理结果。' };
    }
    return {
      normalizedText,
      normalizedStatus: 'success',
      chunkSource: 'normalized',
      normalizationError: '',
    };
  } catch (error) {
    return {
      normalizedText: '',
      normalizedStatus: 'failed',
      chunkSource: 'raw',
      normalizationError: String(error?.message || 'AI 规范整理失败。'),
    };
  }
};

const normalizeAgentVersionRecord = (row, knowledgeBaseIds = []) => {
  const rawConfig = normalizeAgentConfig({
    systemPrompt: row.system_prompt,
    replyStyleRules: parseJsonField(row.reply_style_rules_json, {}),
    modelPolicy: parseJsonField(row.model_policy_json, {}),
    contextPolicy: parseJsonField(row.context_policy_json, {}),
    retrievalPolicy: parseJsonField(row.retrieval_policy_json, {}),
    toolPolicy: parseJsonField(row.tool_policy_json, {}),
  });
  const allowedChatModels = sanitizeAllowedChatModels(parseJsonField(row.allowed_chat_models_json, []), [
    row.default_chat_model,
    rawConfig.modelPolicy.defaultModel,
    rawConfig.modelPolicy.cheapModel,
  ]);
  const modelPolicy = sanitizeModelPolicy(rawConfig.modelPolicy, allowedChatModels);
  const config = {
    ...rawConfig,
    modelPolicy,
  };
  const defaultChatModel = allowedChatModels.includes(String(row.default_chat_model || '').trim())
    ? String(row.default_chat_model).trim()
    : modelPolicy.defaultModel;
  return {
    id: row.id,
    agentId: row.agent_id,
    versionNo: Number(row.version_no || 1),
    versionName: normalizeVersionName(row.version_name, row.version_no, row.created_at),
    allowedChatModels,
    defaultChatModel,
    isPublished: Boolean(row.is_published),
    systemPrompt: config.systemPrompt,
    replyStyleRules: config.replyStyleRules,
    modelPolicy: config.modelPolicy,
    contextPolicy: config.contextPolicy,
    retrievalPolicy: config.retrievalPolicy,
    toolPolicy: config.toolPolicy,
    validationStatus: normalizeValidationStatus(row.validation_status),
    validationSummary: parseJsonField(row.validation_summary_json, null),
    createdBy: row.created_by,
    createdAt: Number(row.created_at || Date.now()),
    knowledgeBaseIds: cleanKnowledgeBaseIds(knowledgeBaseIds),
  };
};

const buildAgentVersionInsertRecord = ({ agentId, versionNo, createdBy, source = null }) => {
  const createdAt = Date.now();
  const rawConfig = normalizeAgentConfig({
    systemPrompt: source?.systemPrompt || '',
    replyStyleRules: source?.replyStyleRules || {},
    modelPolicy: source?.modelPolicy || {},
    contextPolicy: source?.contextPolicy || {},
    retrievalPolicy: source?.retrievalPolicy || {},
    toolPolicy: source?.toolPolicy || {},
  });
  const allowedChatModels = sanitizeAllowedChatModels(source?.allowedChatModels, [
    source?.defaultChatModel,
    rawConfig.modelPolicy.defaultModel,
    rawConfig.modelPolicy.cheapModel,
  ]);
  const config = {
    ...rawConfig,
    modelPolicy: sanitizeModelPolicy(rawConfig.modelPolicy, allowedChatModels),
  };
  return {
    id: createEntityId(),
    agentId,
    versionNo,
    versionName: normalizeVersionName(source?.versionName, versionNo, createdAt),
    allowedChatModels,
    defaultChatModel: allowedChatModels.includes(String(source?.defaultChatModel || '').trim())
      ? String(source.defaultChatModel).trim()
      : config.modelPolicy.defaultModel || '',
    isPublished: 0,
    systemPrompt: config.systemPrompt,
    replyStyleRulesJson: stringifyJsonField(config.replyStyleRules),
    modelPolicyJson: stringifyJsonField(config.modelPolicy),
    contextPolicyJson: stringifyJsonField(config.contextPolicy),
    retrievalPolicyJson: stringifyJsonField(config.retrievalPolicy),
    toolPolicyJson: stringifyJsonField(config.toolPolicy),
    validationStatus: 'pending',
    validationSummaryJson: null,
    createdBy,
    createdAt,
    knowledgeBaseIds: cleanKnowledgeBaseIds(source?.knowledgeBaseIds || []),
  };
};

const pruneLogsByRetention = (logs) => {
  const cutoff = getLogRetentionCutoff();
  if (!Array.isArray(logs)) return [];
  return logs.filter((item) => item && typeof item === 'object' && item.id && Number(item.createdAt) >= cutoff);
};

const normalizeLogs = (logs) => {
  return pruneLogsByRetention(logs)
    .sort((a, b) => Number(b.createdAt) - Number(a.createdAt))
    .slice(0, 500);
};

const normalizeLogFilterValue = (value) => {
  const normalized = String(value || '').trim();
  return normalized && normalized !== 'all' ? normalized : '';
};

const normalizeLogFilterTimestamp = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

const matchesLogFilters = (log, filters = {}) => {
  const moduleFilter = normalizeLogFilterValue(filters.module);
  const userFilter = normalizeLogFilterValue(filters.userId);
  const statusFilter = normalizeLogFilterValue(filters.status);
  const startAt = normalizeLogFilterTimestamp(filters.startAt);
  const endAt = normalizeLogFilterTimestamp(filters.endAt);

  if (moduleFilter && log.module !== moduleFilter) return false;
  if (userFilter && log.userId !== userFilter) return false;
  if (statusFilter && log.status !== statusFilter) return false;
  if (startAt && Number(log.createdAt || 0) < startAt) return false;
  if (endAt && Number(log.createdAt || 0) > endAt) return false;
  return true;
};

const ensureLocalStore = () => {
  mkdirSync(dataDir, { recursive: true });
  if (!existsSync(storePath)) {
    const admin = createUser({
      username: process.env.MEIAO_ADMIN_USERNAME || 'admin',
      password: process.env.MEIAO_ADMIN_PASSWORD || 'Meiao123456',
      role: 'admin',
      displayName: '管理员',
    });
    const initialStore = {
      users: [admin],
      sessions: [],
      logs: [],
      jobs: [],
      systemSettings: createDefaultSystemSettings(),
      agents: [],
      agentVersions: [],
      agentVersionKnowledgeBases: [],
      knowledgeBases: [],
      knowledgeDocuments: [],
      knowledgeChunks: [],
      chatSessions: [],
      chatMessages: [],
      agentUsageLogs: [],
      appStates: {
        [admin.id]: createDefaultState(),
      },
    };
    writeFileSync(storePath, JSON.stringify(initialStore, null, 2), 'utf8');
  }
};

const normalizeLocalStoreShape = (store) => {
  store.users = Array.isArray(store.users) ? store.users.map(normalizeStoredUser) : [];
  store.logs = normalizeLogs(store.logs);
  store.jobs = reconcileRestartedLocalJobs(Array.isArray(store.jobs) ? store.jobs : []);
  store.sessions = Array.isArray(store.sessions) ? store.sessions : [];
  store.systemSettings = normalizeSystemSettings(store.systemSettings || createDefaultSystemSettings());
  store.appStates = store.appStates && typeof store.appStates === 'object' ? store.appStates : {};
  store.usageDaily = Array.isArray(store.usageDaily) ? store.usageDaily : [];
  store.agents = Array.isArray(store.agents) ? store.agents : [];
  store.agentVersions = Array.isArray(store.agentVersions) ? store.agentVersions : [];
  store.agentVersionKnowledgeBases = Array.isArray(store.agentVersionKnowledgeBases) ? store.agentVersionKnowledgeBases : [];
  store.knowledgeBases = Array.isArray(store.knowledgeBases) ? store.knowledgeBases : [];
  store.knowledgeDocuments = Array.isArray(store.knowledgeDocuments) ? store.knowledgeDocuments : [];
  store.knowledgeChunks = Array.isArray(store.knowledgeChunks) ? store.knowledgeChunks : [];
  store.chatSessions = Array.isArray(store.chatSessions) ? store.chatSessions.map((item) => ({
    ...item,
    selectedModel: String(item?.selectedModel || ''),
    reasoningLevel: item?.reasoningLevel ? String(item.reasoningLevel) : null,
    webSearchEnabled: Boolean(item?.webSearchEnabled),
  })) : [];
  store.chatMessages = Array.isArray(store.chatMessages) ? store.chatMessages : [];
  store.agentUsageLogs = Array.isArray(store.agentUsageLogs) ? store.agentUsageLogs : [];
  store.agentVersions = store.agentVersions.map((item) => {
    const allowedChatModels = sanitizeAllowedChatModels(item?.allowedChatModels, [
      item?.defaultChatModel,
      item?.modelPolicy?.defaultModel,
      item?.modelPolicy?.cheapModel,
    ]);
    const modelPolicy = sanitizeModelPolicy(item?.modelPolicy || {}, allowedChatModels);
    const defaultChatModel = allowedChatModels.includes(String(item?.defaultChatModel || '').trim())
      ? String(item.defaultChatModel).trim()
      : modelPolicy.defaultModel;
    return {
      ...item,
      allowedChatModels,
      defaultChatModel,
      modelPolicy,
    };
  });
  store.chatSessions = store.chatSessions.map((item) => {
    const version = (store.agentVersions || []).find((versionItem) => versionItem.id === item.agentVersionId);
    const selectedModel = resolveChatSessionModel(version, item.selectedModel);
    const capability = getChatModelCapability(selectedModel);
    return {
      ...item,
      selectedModel,
      reasoningLevel: capability?.supportsReasoningLevel && item?.reasoningLevel ? String(item.reasoningLevel) : null,
      webSearchEnabled: capability?.supportsWebSearch ? Boolean(item?.webSearchEnabled) : false,
    };
  });
  return store;
};

const readLocalStore = () => {
  ensureLocalStore();
  if (!localStoreCache) {
    localStoreCache = normalizeLocalStoreShape(JSON.parse(readFileSync(storePath, 'utf8')));
  }
  return localStoreCache;
};

const writeLocalStore = (store) => {
  const normalizedStore = normalizeLocalStoreShape(store || localStoreCache || {});
  localStoreCache = normalizedStore;
  writeFileSync(storePath, JSON.stringify(normalizedStore, null, 2), 'utf8');
};

const scrubLocalStatesForDeletedAssets = (validAssetUrls) => {
  const store = readLocalStore();
  Object.keys(store.appStates || {}).forEach((userId) => {
    store.appStates[userId] = prepareStateForStorage(
      scrubUnavailableManagedAssetUrls(store.appStates[userId] || createDefaultState(), validAssetUrls)
    );
  });
  writeLocalStore(store);
};

const buildLogActor = ({ id = 'system', username = 'system', displayName = '' } = {}) => ({
  id,
  username,
  displayName: displayName || username || 'system',
});

const getAllowedOrigins = () => normalizeAllowedOrigins(process.env.MEIAO_ALLOWED_ORIGINS);

const buildCorsHeaders = (req) => {
  const requestOrigin = req.headers.origin || '';
  const allowedOrigins = getAllowedOrigins();
  const allowAnyOrigin = allowedOrigins.length === 0;
  const allowOrigin = allowAnyOrigin
    ? requestOrigin || '*'
    : allowedOrigins.includes(requestOrigin)
      ? requestOrigin
      : allowedOrigins[0];

  return {
    'Access-Control-Allow-Origin': allowOrigin || '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    Vary: 'Origin',
  };
};

const json = (res, statusCode, payload) => {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    ...(res.__corsHeaders || {}),
  });
  res.end(JSON.stringify(payload));
};

const readBody = async (req) => {
  const chunks = [];
  let totalBytes = 0;
  for await (const chunk of req) {
    totalBytes += chunk.length;
    if (totalBytes > MAX_JSON_BODY_BYTES) {
      throw new Error('REQUEST_BODY_TOO_LARGE');
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
};

const readMultipartFormData = async (req) => {
  const contentLength = Number.parseInt(String(req.headers['content-length'] || '0'), 10);
  if (Number.isFinite(contentLength) && contentLength > MAX_JSON_BODY_BYTES) {
    throw new Error('REQUEST_BODY_TOO_LARGE');
  }

  const request = new Request('http://127.0.0.1/internal-upload', {
    method: req.method,
    headers: req.headers,
    body: req,
    duplex: 'half',
  });
  return request.formData();
};

const serveStaticFile = (req, res, filePath) => {
  const ext = path.extname(filePath).toLowerCase();
  const contentType = STATIC_CONTENT_TYPES[ext] || 'application/octet-stream';
  const body = readFileSync(filePath);
  res.writeHead(200, {
    'Content-Type': contentType,
    'Content-Length': Buffer.byteLength(body),
  });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  res.end(body);
};

const tryServeFrontend = (req, res, url) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  if (url.pathname.startsWith('/api/')) return false;
  if (!existsSync(distDir)) return false;

  const normalizedPath = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
  const relativePath = normalizedPath.replace(/^\/+/, '');
  const targetPath = path.resolve(distDir, relativePath);

  if (!targetPath.startsWith(distDir)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return true;
  }

  if (existsSync(targetPath)) {
    serveStaticFile(req, res, targetPath);
    return true;
  }

  const fallbackPath = path.join(distDir, 'index.html');
  if (existsSync(fallbackPath)) {
    serveStaticFile(req, res, fallbackPath);
    return true;
  }

  return false;
};

const cleanUser = (user) => ({
  id: user.id,
  username: user.username,
  displayName: user.displayName,
  avatarUrl: user.avatarUrl || '',
  avatarPreset: user.avatarPreset || 'aurora',
  role: user.role,
  isSuperAdmin: isSuperAdminUser(user),
  status: user.status,
  createdAt: user.createdAt,
  lastLoginAt: user.lastLoginAt,
  jobConcurrency: normalizeJobConcurrency(user.jobConcurrency, DEFAULT_JOB_CONCURRENCY),
});

const localCreateSession = (store, userId) => {
  const token = randomBytes(24).toString('hex');
  store.sessions = store.sessions.filter(session => session.userId !== userId);
  store.sessions.push({
    token,
    userId,
    expiresAt: Date.now() + SESSION_TTL_MS,
  });
  return token;
};

const localGetSessionUser = (req, store) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!token) return null;

  const now = Date.now();
  store.sessions = store.sessions.filter(session => session.expiresAt > now);
  const session = store.sessions.find(item => item.token === token);
  if (!session) return null;
  return store.users.find(user => user.id === session.userId && user.status === 'active') || null;
};

const localRequireUser = (req, res, store) => {
  const user = localGetSessionUser(req, store);
  if (!user) {
    json(res, 401, { message: '登录状态已失效，请重新登录。' });
    return null;
  }
  return user;
};

const localRequireAdmin = (req, res, store) => {
  const user = localRequireUser(req, res, store);
  if (!user) return null;
  if (user.role !== 'admin') {
    json(res, 403, { message: '只有管理员可以执行这个操作。' });
    return null;
  }
  return user;
};

const getTokenFromRequest = (req) => {
  const authHeader = req.headers.authorization || '';
  return authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
};

const getMysqlPool = async () => {
  if (!shouldUseMysql) return null;
  if (mysqlPool) return mysqlPool;

  if (!mysql) {
    mysql = await import('mysql2/promise');
  }

  mysqlPool = mysql.createPool({
    host: dbConfig.host,
    port: dbConfig.port,
    user: dbConfig.user,
    password: dbConfig.password,
    database: dbConfig.database,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    charset: 'utf8mb4',
  });

  return mysqlPool;
};

const ensureMysqlSchema = async () => {
  const pool = await getMysqlPool();
  if (!pool) return;

  const ensureMysqlColumn = async (pool, tableName, columnName, definition) => {
    const [rows] = await pool.query(`SHOW COLUMNS FROM \`${tableName}\` LIKE ?`, [columnName]);
    if (Array.isArray(rows) && rows.length > 0) return;
    await pool.query(`ALTER TABLE \`${tableName}\` ADD COLUMN \`${columnName}\` ${definition}`);
  };

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id VARCHAR(24) PRIMARY KEY,
      username VARCHAR(100) NOT NULL UNIQUE,
      display_name VARCHAR(100) NOT NULL,
      avatar_url VARCHAR(1024) NULL,
      avatar_preset VARCHAR(40) NULL,
      role VARCHAR(20) NOT NULL,
      status VARCHAR(20) NOT NULL,
      job_concurrency INT NOT NULL DEFAULT 5,
      password_hash VARCHAR(128) NOT NULL,
      salt VARCHAR(64) NOT NULL,
      created_at BIGINT NOT NULL,
      last_login_at BIGINT NULL
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);

  const [jobConcurrencyColumns] = await pool.query(`SHOW COLUMNS FROM users LIKE 'job_concurrency'`);
  if (!Array.isArray(jobConcurrencyColumns) || jobConcurrencyColumns.length === 0) {
    await pool.query('ALTER TABLE users ADD COLUMN job_concurrency INT NOT NULL DEFAULT 5 AFTER status');
  }
  await ensureMysqlColumn(pool, 'users', 'avatar_url', 'VARCHAR(1024) NULL');
  await ensureMysqlColumn(pool, 'users', 'avatar_preset', 'VARCHAR(40) NULL');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      token VARCHAR(64) PRIMARY KEY,
      user_id VARCHAR(24) NOT NULL,
      expires_at BIGINT NOT NULL,
      created_at BIGINT NOT NULL,
      INDEX idx_sessions_user_id (user_id),
      INDEX idx_sessions_expires_at (expires_at)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_states (
      user_id VARCHAR(24) PRIMARY KEY,
      state_json LONGTEXT NOT NULL,
      updated_at BIGINT NOT NULL
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS internal_logs (
      id VARCHAR(24) PRIMARY KEY,
      created_at BIGINT NOT NULL,
      level VARCHAR(20) NOT NULL,
      module VARCHAR(60) NOT NULL,
      action VARCHAR(100) NOT NULL,
      message TEXT NOT NULL,
      detail LONGTEXT NULL,
      status VARCHAR(20) NOT NULL,
      user_id VARCHAR(24) NOT NULL,
      username VARCHAR(100) NOT NULL,
      display_name VARCHAR(100) NOT NULL,
      meta_json LONGTEXT NULL,
      INDEX idx_internal_logs_created_at (created_at),
      INDEX idx_internal_logs_user_id (user_id),
      INDEX idx_internal_logs_module (module)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS usage_daily (
      stat_date DATE NOT NULL,
      user_id VARCHAR(24) NOT NULL,
      username VARCHAR(100) NOT NULL,
      display_name VARCHAR(100) NOT NULL,
      module VARCHAR(60) NOT NULL,
      success_count INT DEFAULT 0,
      failed_count INT DEFAULT 0,
      interrupted_count INT DEFAULT 0,
      PRIMARY KEY (stat_date, user_id, module),
      INDEX idx_usage_daily_date (stat_date),
      INDEX idx_usage_daily_user (user_id)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS agents (
      id VARCHAR(24) PRIMARY KEY,
      name VARCHAR(120) NOT NULL,
      description TEXT NOT NULL,
      department VARCHAR(120) NOT NULL,
      owner_user_id VARCHAR(24) NOT NULL,
      visibility_scope VARCHAR(40) NOT NULL,
      status VARCHAR(20) NOT NULL,
      current_version_id VARCHAR(24) NULL,
      icon_url VARCHAR(1024) NULL,
      avatar_preset VARCHAR(40) NULL,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL,
      INDEX idx_agents_owner_user_id (owner_user_id),
      INDEX idx_agents_status (status)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);
  await ensureMysqlColumn(pool, 'agents', 'icon_url', 'VARCHAR(1024) NULL');
  await ensureMysqlColumn(pool, 'agents', 'avatar_preset', 'VARCHAR(40) NULL');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS agent_versions (
      id VARCHAR(24) PRIMARY KEY,
      agent_id VARCHAR(24) NOT NULL,
      version_no INT NOT NULL,
      version_name VARCHAR(160) NOT NULL,
      allowed_chat_models_json LONGTEXT NULL,
      default_chat_model VARCHAR(80) NULL,
      is_published TINYINT(1) NOT NULL DEFAULT 0,
      system_prompt LONGTEXT NOT NULL,
      reply_style_rules_json LONGTEXT NOT NULL,
      model_policy_json LONGTEXT NOT NULL,
      context_policy_json LONGTEXT NOT NULL,
      retrieval_policy_json LONGTEXT NOT NULL,
      tool_policy_json LONGTEXT NOT NULL,
      validation_status VARCHAR(20) NOT NULL,
      validation_summary_json LONGTEXT NULL,
      created_by VARCHAR(24) NOT NULL,
      created_at BIGINT NOT NULL,
      INDEX idx_agent_versions_agent_id (agent_id),
      INDEX idx_agent_versions_published (is_published)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);
  await ensureMysqlColumn(pool, 'agent_versions', 'version_name', `VARCHAR(160) NOT NULL DEFAULT 'V1'`);
  await ensureMysqlColumn(pool, 'agent_versions', 'allowed_chat_models_json', 'LONGTEXT NULL');
  await ensureMysqlColumn(pool, 'agent_versions', 'default_chat_model', 'VARCHAR(80) NULL');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS agent_version_knowledge_bases (
      id VARCHAR(24) PRIMARY KEY,
      agent_version_id VARCHAR(24) NOT NULL,
      knowledge_base_id VARCHAR(24) NOT NULL,
      priority INT NOT NULL DEFAULT 0,
      created_at BIGINT NOT NULL,
      INDEX idx_avkb_version_id (agent_version_id),
      INDEX idx_avkb_knowledge_base_id (knowledge_base_id)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS knowledge_bases (
      id VARCHAR(24) PRIMARY KEY,
      name VARCHAR(120) NOT NULL,
      description TEXT NOT NULL,
      department VARCHAR(120) NOT NULL,
      owner_user_id VARCHAR(24) NOT NULL,
      status VARCHAR(20) NOT NULL,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL,
      INDEX idx_knowledge_bases_owner_user_id (owner_user_id)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS knowledge_documents (
      id VARCHAR(24) PRIMARY KEY,
      knowledge_base_id VARCHAR(24) NOT NULL,
      title VARCHAR(255) NOT NULL,
      source_type VARCHAR(20) NOT NULL,
      chunk_strategy VARCHAR(20) NOT NULL DEFAULT 'general',
      storage_asset_id VARCHAR(24) NULL,
      raw_text LONGTEXT NOT NULL,
      normalization_enabled TINYINT(1) NOT NULL DEFAULT 0,
      normalized_text LONGTEXT NULL,
      normalization_error TEXT NULL,
      normalized_status VARCHAR(20) NOT NULL DEFAULT 'idle',
      chunk_source VARCHAR(20) NOT NULL DEFAULT 'raw',
      parse_status VARCHAR(20) NOT NULL,
      chunk_count INT NOT NULL DEFAULT 0,
      created_by VARCHAR(24) NOT NULL,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL,
      INDEX idx_knowledge_documents_base_id (knowledge_base_id)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);
  await ensureMysqlColumn(pool, 'knowledge_documents', 'chunk_strategy', "VARCHAR(20) NOT NULL DEFAULT 'general'");
  await ensureMysqlColumn(pool, 'knowledge_documents', 'normalization_enabled', 'TINYINT(1) NOT NULL DEFAULT 0');
  await ensureMysqlColumn(pool, 'knowledge_documents', 'normalization_error', 'TEXT NULL');
  await ensureMysqlColumn(pool, 'knowledge_documents', 'normalized_text', 'LONGTEXT NULL');
  await ensureMysqlColumn(pool, 'knowledge_documents', 'normalized_status', "VARCHAR(20) NOT NULL DEFAULT 'idle'");
  await ensureMysqlColumn(pool, 'knowledge_documents', 'chunk_source', "VARCHAR(20) NOT NULL DEFAULT 'raw'");

  await pool.query(`
    CREATE TABLE IF NOT EXISTS system_settings (
      setting_key VARCHAR(120) PRIMARY KEY,
      setting_value_json LONGTEXT NOT NULL,
      updated_at BIGINT NOT NULL
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS knowledge_chunks (
      id VARCHAR(24) PRIMARY KEY,
      document_id VARCHAR(24) NOT NULL,
      knowledge_base_id VARCHAR(24) NOT NULL,
      chunk_index INT NOT NULL,
      source_type VARCHAR(20) NOT NULL,
      content LONGTEXT NOT NULL,
      token_estimate INT NOT NULL DEFAULT 0,
      embedding_json LONGTEXT NULL,
      created_at BIGINT NOT NULL,
      INDEX idx_knowledge_chunks_document_id (document_id),
      INDEX idx_knowledge_chunks_base_id (knowledge_base_id)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS chat_sessions (
      id VARCHAR(24) PRIMARY KEY,
      user_id VARCHAR(24) NOT NULL,
      agent_id VARCHAR(24) NOT NULL,
      agent_version_id VARCHAR(24) NOT NULL,
      title VARCHAR(255) NOT NULL,
      status VARCHAR(20) NOT NULL,
      summary LONGTEXT NULL,
      selected_model VARCHAR(80) NOT NULL,
      reasoning_level VARCHAR(40) NULL,
      web_search_enabled TINYINT(1) NOT NULL DEFAULT 0,
      last_image_mode TINYINT(1) NOT NULL DEFAULT 0,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL,
      INDEX idx_chat_sessions_user_id (user_id),
      INDEX idx_chat_sessions_agent_id (agent_id)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);
  await ensureMysqlColumn(pool, 'chat_sessions', 'selected_model', 'VARCHAR(80) NOT NULL DEFAULT ""');
  await ensureMysqlColumn(pool, 'chat_sessions', 'reasoning_level', 'VARCHAR(40) NULL');
  await ensureMysqlColumn(pool, 'chat_sessions', 'web_search_enabled', 'TINYINT(1) NOT NULL DEFAULT 0');
  await ensureMysqlColumn(pool, 'chat_sessions', 'last_image_mode', 'TINYINT(1) NOT NULL DEFAULT 0');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS chat_messages (
      id VARCHAR(24) PRIMARY KEY,
      session_id VARCHAR(24) NOT NULL,
      user_id VARCHAR(24) NOT NULL,
      role VARCHAR(20) NOT NULL,
      content LONGTEXT NOT NULL,
      attachments_json LONGTEXT NULL,
      metadata_json LONGTEXT NULL,
      created_at BIGINT NOT NULL,
      INDEX idx_chat_messages_session_id (session_id),
      INDEX idx_chat_messages_user_id (user_id)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS agent_usage_logs (
      id VARCHAR(24) PRIMARY KEY,
      user_id VARCHAR(24) NOT NULL,
      username VARCHAR(100) NOT NULL,
      display_name VARCHAR(100) NOT NULL,
      agent_id VARCHAR(24) NOT NULL,
      agent_name VARCHAR(120) NOT NULL,
      agent_version_id VARCHAR(24) NOT NULL,
      session_id VARCHAR(24) NULL,
      request_type VARCHAR(40) NOT NULL,
      selected_model VARCHAR(80) NOT NULL,
      used_retrieval TINYINT(1) NOT NULL DEFAULT 0,
      retrieval_summary_json LONGTEXT NULL,
      prompt_tokens INT NOT NULL DEFAULT 0,
      completion_tokens INT NOT NULL DEFAULT 0,
      total_tokens INT NOT NULL DEFAULT 0,
      estimated_cost DECIMAL(12,6) NOT NULL DEFAULT 0,
      latency_ms INT NOT NULL DEFAULT 0,
      status VARCHAR(20) NOT NULL,
      error_message TEXT NULL,
      created_at BIGINT NOT NULL,
      INDEX idx_agent_usage_logs_agent_id (agent_id),
      INDEX idx_agent_usage_logs_user_id (user_id),
      INDEX idx_agent_usage_logs_created_at (created_at)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);

  await ensureJobsSchema(pool);
  await ensureAssetSchema(pool);

  const [rows] = await pool.query('SELECT id FROM users LIMIT 1');
  if (Array.isArray(rows) && rows.length === 0) {
    const admin = createUser({
      username: process.env.MEIAO_ADMIN_USERNAME || 'admin',
      password: process.env.MEIAO_ADMIN_PASSWORD || 'Meiao123456',
      role: 'admin',
      displayName: '管理员',
    });

    await pool.query(
      `INSERT INTO users (id, username, display_name, avatar_url, avatar_preset, role, status, job_concurrency, password_hash, salt, created_at, last_login_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        admin.id,
        admin.username,
        admin.displayName,
        admin.avatarUrl || null,
        admin.avatarPreset || 'aurora',
        admin.role,
        admin.status,
        admin.jobConcurrency,
        admin.passwordHash,
        admin.salt,
        admin.createdAt,
        admin.lastLoginAt,
      ]
    );

    await pool.query(
      'INSERT INTO app_states (user_id, state_json, updated_at) VALUES (?, ?, ?)',
      [admin.id, JSON.stringify(createDefaultState()), Date.now()]
    );
  }
};

const mapDbUser = (row) => ({
  id: row.id,
  username: row.username,
  displayName: row.display_name,
  avatarUrl: row.avatar_url || '',
  avatarPreset: row.avatar_preset || 'aurora',
  role: row.role,
  status: row.status,
  jobConcurrency: normalizeJobConcurrency(row.job_concurrency, DEFAULT_JOB_CONCURRENCY),
  passwordHash: row.password_hash,
  salt: row.salt,
  createdAt: Number(row.created_at),
  lastLoginAt: row.last_login_at === null ? null : Number(row.last_login_at),
});

const findDbUserByUsername = async (username) => {
  const pool = await getMysqlPool();
  const [rows] = await pool.query(
    'SELECT * FROM users WHERE username = ? AND status = ? LIMIT 1',
    [username, 'active']
  );
  return rows[0] ? mapDbUser(rows[0]) : null;
};

const findDbUserById = async (userId) => {
  const pool = await getMysqlPool();
  const [rows] = await pool.query(
    'SELECT * FROM users WHERE id = ? AND status = ? LIMIT 1',
    [userId, 'active']
  );
  return rows[0] ? mapDbUser(rows[0]) : null;
};

const listDbUsers = async () => {
  const pool = await getMysqlPool();
  const [rows] = await pool.query('SELECT * FROM users ORDER BY created_at ASC');
  return rows.map(mapDbUser);
};

const getConfiguredWorkerConcurrency = () => {
  const configured = Number.parseInt(process.env.MEIAO_JOB_MAX_CONCURRENCY || '5', 10);
  return Number.isFinite(configured) && configured > 0 ? configured : 5;
};

const getDbWorkerConcurrency = async () => {
  const users = await listDbUsers();
  return getWorkerConcurrencyLimit(getConfiguredWorkerConcurrency(), users);
};

const getLocalWorkerConcurrency = () => {
  const store = readLocalStore();
  return getWorkerConcurrencyLimit(getConfiguredWorkerConcurrency(), store.users || []);
};

const updateDbUserLoginTime = async (userId, loginTime) => {
  const pool = await getMysqlPool();
  await pool.query('UPDATE users SET last_login_at = ? WHERE id = ?', [loginTime, userId]);
};

const ensureDbAppState = async (userId) => {
  const pool = await getMysqlPool();
  const [rows] = await pool.query('SELECT user_id FROM app_states WHERE user_id = ? LIMIT 1', [userId]);
  if (rows[0]) return;

  await pool.query(
    'INSERT INTO app_states (user_id, state_json, updated_at) VALUES (?, ?, ?)',
    [userId, JSON.stringify(createDefaultState()), Date.now()]
  );
};

const getDbAppState = async (userId) => {
  const pool = await getMysqlPool();
  const [rows] = await pool.query(
    'SELECT state_json FROM app_states WHERE user_id = ? LIMIT 1',
    [userId]
  );
  if (!rows[0]?.state_json) {
    await ensureDbAppState(userId);
    return prepareStateForStorage(createDefaultState());
  }

  return prepareStateForStorage(JSON.parse(rows[0].state_json));
};

const saveDbAppState = async (userId, state) => {
  const pool = await getMysqlPool();
  const preparedState = prepareStateForStorage(state);
  await pool.query(
    `INSERT INTO app_states (user_id, state_json, updated_at)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE state_json = VALUES(state_json), updated_at = VALUES(updated_at)`,
    [userId, JSON.stringify(preparedState), Date.now()]
  );
};

const getDbSystemSettings = async () => {
  const pool = await getMysqlPool();
  const [rows] = await pool.query(
    'SELECT setting_value_json FROM system_settings WHERE setting_key = ? LIMIT 1',
    ['global']
  );
  if (!rows[0]?.setting_value_json) {
    return createDefaultSystemSettings();
  }
  try {
    return normalizeSystemSettings(JSON.parse(rows[0].setting_value_json));
  } catch {
    return createDefaultSystemSettings();
  }
};

const saveDbSystemSettings = async (settings) => {
  const pool = await getMysqlPool();
  const normalized = normalizeSystemSettings(settings);
  await pool.query(
    `INSERT INTO system_settings (setting_key, setting_value_json, updated_at)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE setting_value_json = VALUES(setting_value_json), updated_at = VALUES(updated_at)`,
    ['global', JSON.stringify(normalized), Date.now()]
  );
  return normalized;
};

const getLocalSystemSettings = (store) => normalizeSystemSettings(store?.systemSettings || createDefaultSystemSettings());

const saveLocalSystemSettings = (store, settings) => {
  store.systemSettings = normalizeSystemSettings(settings);
  return store.systemSettings;
};

const scrubDbStatesForDeletedAssets = async (validAssetUrls) => {
  const pool = await getMysqlPool();
  const [rows] = await pool.query('SELECT user_id, state_json FROM app_states');
  for (const row of rows) {
    const parsedState = JSON.parse(row.state_json || '{}');
    const nextState = scrubUnavailableManagedAssetUrls(parsedState, validAssetUrls);
    await pool.query(
      'UPDATE app_states SET state_json = ?, updated_at = ? WHERE user_id = ?',
      [JSON.stringify(prepareStateForStorage(nextState)), Date.now(), row.user_id]
    );
  }
};

const persistUploadedAssetIfEnabled = async ({ req, user, moduleName, fileName, mimeType, fileBuffer, width = 0, height = 0 }) => {
  const publicBaseUrl = getPersistentAssetBaseUrl(req);
  if (!publicBaseUrl) {
    return null;
  }

  const pool = shouldUseMysql ? await getMysqlPool() : null;
  return persistAssetBuffer({
    pool,
    publicBaseUrl,
    userId: user.id,
    module: moduleName,
    assetType: 'source',
    originalName: fileName,
    mimeType,
    fileBuffer,
    width,
    height,
    provider: 'internal',
  });
};

const persistJobOutputAssetsIfEnabled = async (job, output) => {
  const publicBaseUrl = getPersistentAssetBaseUrl();
  if (!publicBaseUrl || !output?.result || !job?.userId) {
    return output;
  }

  const pool = shouldUseMysql ? await getMysqlPool() : null;
  const result = { ...(output.result || {}) };
  const persistRemoteField = async (fieldName, assetType, fallbackName) => {
    const sourceUrl = result[fieldName];
    if (typeof sourceUrl !== 'string' || !/^https?:\/\//i.test(sourceUrl) || isManagedAssetUrl(sourceUrl)) {
      return;
    }

    const persisted = await persistRemoteAsset({
      pool,
      publicBaseUrl,
      userId: job.userId,
      module: job.module,
      assetType,
      remoteUrl: sourceUrl,
      originalName: fallbackName,
      provider: job.provider,
      jobId: job.id,
    });
    result[fieldName] = persisted.publicUrl;
    result[`${fieldName}AssetId`] = persisted.id;
    result[`${fieldName}RemoteUrl`] = sourceUrl;
  };

  await persistRemoteField('imageUrl', 'result', `${job.taskType || 'result'}.png`);
  await persistRemoteField('videoUrl', 'video', `${job.taskType || 'result'}.mp4`);
  await persistRemoteField('fileUrl', 'result', `${job.taskType || 'result'}.bin`);

  return {
    ...output,
    result,
  };
};

const serveStoredAsset = async (req, res, assetId) => {
  const pool = shouldUseMysql ? await getMysqlPool() : null;
  const asset = await getStoredAssetById(pool, assetId);
  if (!asset || asset.deletedAt) {
    json(res, 404, { message: '资源不存在或已删除。' });
    return;
  }

  const fullPath = resolveStoredAssetPath(asset);
  if (!fullPath || !existsSync(fullPath)) {
    await markStoredAssetDeleted(pool, asset.id, Date.now());
    json(res, 404, { message: '资源文件不存在。' });
    return;
  }

  await markStoredAssetAccessed(pool, asset.id, Date.now());
  const stats = statSync(fullPath);
  res.writeHead(200, {
    'Content-Type': asset.mimeType || 'application/octet-stream',
    'Content-Length': stats.size,
    'Cache-Control': 'private, max-age=86400',
    ...(res.__corsHeaders || {}),
  });
  createReadStream(fullPath).pipe(res);
};

const cleanupExpiredStoredAssets = async () => {
  const pool = shouldUseMysql ? await getMysqlPool() : null;
  const allAssets = await listStoredAssets(pool);
  const expiredAssets = selectExpiredAssetsForCleanup(
    allAssets.map((asset) => ({ ...asset, isReferenced: false })),
    Date.now()
  );
  if (expiredAssets.length === 0) return;

  for (const asset of expiredAssets) {
    await deleteStoredAssetFile(asset.storageKey);
    await markStoredAssetDeleted(pool, asset.id, Date.now());
  }

  const remainingAssets = await listStoredAssets(pool);
  const validAssetUrls = new Set(remainingAssets.filter((asset) => !asset.deletedAt).map((asset) => asset.publicUrl));
  if (shouldUseMysql) {
    await scrubDbStatesForDeletedAssets(validAssetUrls);
  } else {
    scrubLocalStatesForDeletedAssets(validAssetUrls);
  }
};

const createDbSession = async (userId) => {
  const pool = await getMysqlPool();
  const token = randomBytes(24).toString('hex');
  await pool.query('DELETE FROM sessions WHERE user_id = ?', [userId]);
  await pool.query(
    'INSERT INTO sessions (token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)',
    [token, userId, Date.now() + SESSION_TTL_MS, Date.now()]
  );
  return token;
};

const deleteDbSession = async (token) => {
  const pool = await getMysqlPool();
  await pool.query('DELETE FROM sessions WHERE token = ?', [token]);
};

const purgeExpiredDbSessions = async () => {
  const pool = await getMysqlPool();
  await pool.query('DELETE FROM sessions WHERE expires_at <= ?', [Date.now()]);
};

const getDbSessionUser = async (req) => {
  const token = getTokenFromRequest(req);
  if (!token) return null;

  await purgeExpiredDbSessions();
  const pool = await getMysqlPool();
  const [rows] = await pool.query(
    `SELECT u.*
     FROM sessions s
     INNER JOIN users u ON u.id = s.user_id
     WHERE s.token = ? AND s.expires_at > ? AND u.status = ?
     LIMIT 1`,
    [token, Date.now(), 'active']
  );

  return rows[0] ? mapDbUser(rows[0]) : null;
};

const createDbUser = async ({ username, password, role = 'staff', displayName = '', jobConcurrency = DEFAULT_JOB_CONCURRENCY }) => {
  const pool = await getMysqlPool();
  const newUser = createUser({ username, password, role, displayName, jobConcurrency });
  await pool.query(
    `INSERT INTO users (id, username, display_name, avatar_url, avatar_preset, role, status, job_concurrency, password_hash, salt, created_at, last_login_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      newUser.id,
      newUser.username,
      newUser.displayName,
      newUser.avatarUrl || null,
      newUser.avatarPreset || 'aurora',
      newUser.role,
      newUser.status,
      newUser.jobConcurrency,
      newUser.passwordHash,
      newUser.salt,
      newUser.createdAt,
      newUser.lastLoginAt,
    ]
  );
  await saveDbAppState(newUser.id, createDefaultState());
  return newUser;
};

const updateDbUser = async (userId, updates) => {
  const pool = await getMysqlPool();
  const fields = [];
  const values = [];

  if (typeof updates.displayName === 'string') {
    fields.push('display_name = ?');
    values.push(updates.displayName.trim() || updates.usernameFallback || '');
  }
  if (updates.avatarUrl === null) {
    fields.push('avatar_url = ?');
    values.push(null);
  } else if (typeof updates.avatarUrl === 'string') {
    fields.push('avatar_url = ?');
    values.push(updates.avatarUrl.trim().slice(0, 1024) || null);
  }
  if (updates.avatarPreset === null) {
    fields.push('avatar_preset = ?');
    values.push('aurora');
  } else if (typeof updates.avatarPreset === 'string') {
    fields.push('avatar_preset = ?');
    values.push(updates.avatarPreset.trim().slice(0, 40) || 'aurora');
  }
  if (updates.role === 'admin' || updates.role === 'staff') {
    fields.push('role = ?');
    values.push(updates.role);
  }
  if (updates.status === 'active' || updates.status === 'disabled') {
    fields.push('status = ?');
    values.push(updates.status);
  }
  if (updates.jobConcurrency !== undefined) {
    fields.push('job_concurrency = ?');
    values.push(normalizeJobConcurrency(updates.jobConcurrency, DEFAULT_JOB_CONCURRENCY));
  }
  if (typeof updates.password === 'string' && updates.password) {
    const passwordRecord = createPasswordRecord(updates.password);
    fields.push('password_hash = ?');
    values.push(passwordRecord.hash);
    fields.push('salt = ?');
    values.push(passwordRecord.salt);
  }

  if (fields.length === 0) {
    return await findDbUserById(userId);
  }

  values.push(userId);
  await pool.query(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, values);
  return await findDbUserById(userId);
};

const deleteDbUser = async (userId) => {
  const pool = await getMysqlPool();
  await pool.query('DELETE FROM sessions WHERE user_id = ?', [userId]);
  await pool.query('DELETE FROM app_states WHERE user_id = ?', [userId]);
  await pool.query('DELETE FROM users WHERE id = ?', [userId]);
};

const countDbAdmins = async () => {
  const pool = await getMysqlPool();
  const [rows] = await pool.query('SELECT COUNT(*) AS count FROM users WHERE role = ? AND status = ?', ['admin', 'active']);
  return Number(rows[0]?.count || 0);
};

const purgeExpiredDbLogs = async () => {
  const pool = await getMysqlPool();
  await pool.query('DELETE FROM internal_logs WHERE created_at < ?', [getLogRetentionCutoff()]);
};

const USAGE_MODULES = new Set(['agent_center', 'one_click', 'translation', 'buyer_show', 'retouch', 'video']);
const TERMINAL_STATUSES = new Set(['success', 'failed', 'interrupted']);
const USAGE_ACTIONS = new Set([
  'agent_chat',
  'agent_validate',
  'generate_main_scheme', 'generate_detail_scheme',
  'generate_single',
  'generate_board', 'regenerate_board',
  'create_image_task',
]);

const incrementDbUsageStat = async (pool, log) => {
  if (!USAGE_MODULES.has(log.module) || !TERMINAL_STATUSES.has(log.status) || !USAGE_ACTIONS.has(log.action)) {
    return;
  }

  const statDate = new Date(log.createdAt).toISOString().split('T')[0];
  const field = log.status === 'success' ? 'success_count' : log.status === 'failed' ? 'failed_count' : 'interrupted_count';

  await pool.query(
    `INSERT INTO usage_daily (stat_date, user_id, username, display_name, module, ${field})
     VALUES (?, ?, ?, ?, ?, 1)
     ON DUPLICATE KEY UPDATE ${field} = ${field} + 1`,
    [statDate, log.userId, log.username, log.displayName, log.module]
  );
};

const createDbLog = async (payload) => {
  const pool = await getMysqlPool();
  await purgeExpiredDbLogs();
  const log = createLogEntry(payload);
  await pool.query(
    `INSERT INTO internal_logs (
      id, created_at, level, module, action, message, detail, status, user_id, username, display_name, meta_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      log.id,
      log.createdAt,
      log.level,
      log.module,
      log.action,
      log.message,
      log.detail || null,
      log.status,
      log.userId,
      log.username,
      log.displayName,
      log.meta ? JSON.stringify(log.meta) : null,
    ]
  );
  await incrementDbUsageStat(pool, log);
  return log;
};

const buildDbLogWhere = (filters = {}) => {
  const clauses = ['created_at >= ?'];
  const values = [Math.max(getLogRetentionCutoff(), normalizeLogFilterTimestamp(filters.startAt) || getLogRetentionCutoff())];
  const moduleFilter = normalizeLogFilterValue(filters.module);
  const userFilter = normalizeLogFilterValue(filters.userId);
  const statusFilter = normalizeLogFilterValue(filters.status);
  const endAt = normalizeLogFilterTimestamp(filters.endAt);

  if (moduleFilter) {
    clauses.push('module = ?');
    values.push(moduleFilter);
  }
  if (userFilter) {
    clauses.push('user_id = ?');
    values.push(userFilter);
  }
  if (statusFilter) {
    clauses.push('status = ?');
    values.push(statusFilter);
  }
  if (endAt) {
    clauses.push('created_at <= ?');
    values.push(endAt);
  }

  return { clauses, values };
};

const listDbLogs = async (filters = {}) => {
  const pool = await getMysqlPool();
  await purgeExpiredDbLogs();
  const { clauses, values } = buildDbLogWhere(filters);
  const { page, pageSize, offset } = normalizeLogPagination(filters);

  const [countRows] = await pool.query(
    `SELECT COUNT(*) AS total FROM internal_logs WHERE ${clauses.join(' AND ')}`,
    values
  );
  const total = Number(countRows[0]?.total || 0);

  const [rows] = await pool.query(
    `SELECT id, created_at, level, module, action, message, detail, status, user_id, username, display_name, meta_json
     FROM internal_logs
     WHERE ${clauses.join(' AND ')}
     ORDER BY created_at DESC
     LIMIT ? OFFSET ?`,
    [...values, pageSize, offset]
  );

  return {
    logs: rows.map((row) => ({
      id: row.id,
      createdAt: Number(row.created_at),
      level: row.level,
      module: row.module,
      action: row.action,
      message: row.message,
      detail: row.detail || '',
      status: row.status,
      userId: row.user_id,
      username: row.username,
      displayName: row.display_name,
      meta: row.meta_json ? JSON.parse(row.meta_json) : null,
    })),
    total,
    page,
    pageSize,
  };
};

const listDbLogMeta = async () => {
  const pool = await getMysqlPool();
  await purgeExpiredDbLogs();
  const [rows] = await pool.query(
    `SELECT module, user_id, username, display_name
     FROM internal_logs
     WHERE created_at >= ?
     ORDER BY created_at DESC`,
    [getLogRetentionCutoff()]
  );

  return buildLogFilterOptions(rows.map((row) => ({
    id: row.id,
    module: row.module,
    userId: row.user_id,
    username: row.username,
    displayName: row.display_name,
  })));
};

const deleteDbLogs = async (filters = {}) => {
  const pool = await getMysqlPool();
  await purgeExpiredDbLogs();

  const clauses = ['created_at >= ?'];
  const values = [Math.max(getLogRetentionCutoff(), normalizeLogFilterTimestamp(filters.startAt) || getLogRetentionCutoff())];
  const moduleFilter = normalizeLogFilterValue(filters.module);
  const userFilter = normalizeLogFilterValue(filters.userId);
  const statusFilter = normalizeLogFilterValue(filters.status);
  const endAt = normalizeLogFilterTimestamp(filters.endAt);

  if (moduleFilter) {
    clauses.push('module = ?');
    values.push(moduleFilter);
  }
  if (userFilter) {
    clauses.push('user_id = ?');
    values.push(userFilter);
  }
  if (statusFilter) {
    clauses.push('status = ?');
    values.push(statusFilter);
  }
  if (endAt) {
    clauses.push('created_at <= ?');
    values.push(endAt);
  }

  const [result] = await pool.query(`DELETE FROM internal_logs WHERE ${clauses.join(' AND ')}`, values);
  return Number(result?.affectedRows || 0);
};

const listDbManageableKnowledgeBaseIds = async (user, ids) => {
  const targetIds = cleanKnowledgeBaseIds(ids);
  if (targetIds.length === 0) return [];
  const pool = await getMysqlPool();
  const placeholders = targetIds.map(() => '?').join(', ');
  const params = isSuperAdminUser(user) ? targetIds : [...targetIds, user.id];
  const where = isSuperAdminUser(user)
    ? `id IN (${placeholders})`
    : `id IN (${placeholders}) AND owner_user_id = ?`;
  const [rows] = await pool.query(`SELECT id FROM knowledge_bases WHERE ${where} AND status = ?`, [...params, 'active']);
  return rows.map((row) => row.id);
};

const syncDbVersionKnowledgeBases = async (agentVersionId, knowledgeBaseIds) => {
  const pool = await getMysqlPool();
  await pool.query('DELETE FROM agent_version_knowledge_bases WHERE agent_version_id = ?', [agentVersionId]);
  const now = Date.now();
  for (const [index, knowledgeBaseId] of cleanKnowledgeBaseIds(knowledgeBaseIds).entries()) {
    await pool.query(
      `INSERT INTO agent_version_knowledge_bases (id, agent_version_id, knowledge_base_id, priority, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [createEntityId(), agentVersionId, knowledgeBaseId, index, now]
    );
  }
};

const listDbVersionKnowledgeBaseIds = async (agentVersionId) => {
  const pool = await getMysqlPool();
  const [rows] = await pool.query(
    'SELECT knowledge_base_id FROM agent_version_knowledge_bases WHERE agent_version_id = ? ORDER BY priority ASC, created_at ASC',
    [agentVersionId]
  );
  return rows.map((row) => row.knowledge_base_id);
};

const listDbAgentVersionsByAgentId = async (agentId) => {
  const pool = await getMysqlPool();
  const [rows] = await pool.query(
    'SELECT * FROM agent_versions WHERE agent_id = ? ORDER BY version_no DESC, created_at DESC',
    [agentId]
  );
  const versions = [];
  for (const row of rows) {
    versions.push(normalizeAgentVersionRecord(row, await listDbVersionKnowledgeBaseIds(row.id)));
  }
  return versions;
};

const getDbAgentVersionById = async (versionId) => {
  const pool = await getMysqlPool();
  const [rows] = await pool.query('SELECT * FROM agent_versions WHERE id = ? LIMIT 1', [versionId]);
  if (!rows[0]) return null;
  return normalizeAgentVersionRecord(rows[0], await listDbVersionKnowledgeBaseIds(versionId));
};

const getDbAgentById = async (agentId) => {
  const pool = await getMysqlPool();
  const [rows] = await pool.query(
    `SELECT a.*, u.display_name AS owner_display_name
     FROM agents a
     LEFT JOIN users u ON u.id = a.owner_user_id
     WHERE a.id = ? LIMIT 1`,
    [agentId]
  );
  if (!rows[0]) return null;
  const currentVersion = rows[0].current_version_id ? await getDbAgentVersionById(rows[0].current_version_id) : null;
  const [kbCountRows] = await pool.query(
    `SELECT COUNT(*) AS count
     FROM agent_version_knowledge_bases
     WHERE agent_version_id = ?`,
    [rows[0].current_version_id || '']
  );
  const [usageRows] = await pool.query(
    'SELECT COUNT(*) AS count FROM agent_usage_logs WHERE agent_id = ? AND created_at >= ?',
    [agentId, Date.now() - AGENT_SUMMARY_WINDOW_MS]
  );
  return {
    id: rows[0].id,
    name: rows[0].name,
    description: rows[0].description,
    department: rows[0].department,
    iconUrl: rows[0].icon_url || '',
    avatarPreset: rows[0].avatar_preset || '',
    ownerUserId: rows[0].owner_user_id,
    ownerDisplayName: rows[0].owner_display_name || '',
    visibilityScope: rows[0].visibility_scope,
    status: normalizeAgentStatus(rows[0].status),
    currentVersionId: rows[0].current_version_id,
    currentVersionNo: currentVersion?.versionNo || null,
    defaultModel: currentVersion?.modelPolicy?.defaultModel || '',
    knowledgeBaseCount: Number(kbCountRows[0]?.count || 0),
    usageCount7d: Number(usageRows[0]?.count || 0),
    createdAt: Number(rows[0].created_at),
    updatedAt: Number(rows[0].updated_at),
  };
};

const listDbAgents = async (user) => {
  const pool = await getMysqlPool();
  const where = isSuperAdminUser(user) ? '' : 'WHERE a.owner_user_id = ?';
  const params = isSuperAdminUser(user) ? [] : [user.id];
  const [rows] = await pool.query(
    `SELECT a.*, u.display_name AS owner_display_name
     FROM agents a
     LEFT JOIN users u ON u.id = a.owner_user_id
     ${where}
     ORDER BY a.updated_at DESC`,
    params
  );
  const items = [];
  for (const row of rows) {
    items.push(await getDbAgentById(row.id));
  }
  return items.filter(Boolean);
};

const createDbAgent = async (user, payload) => {
  const pool = await getMysqlPool();
  const now = Date.now();
  const agentId = createEntityId();
  const version = buildAgentVersionInsertRecord({
    agentId,
    versionNo: 1,
    createdBy: user.id,
    source: {
      systemPrompt: payload.systemPrompt || '',
      replyStyleRules: payload.replyStyleRules || {},
      modelPolicy: payload.modelPolicy || {},
      contextPolicy: payload.contextPolicy || {},
      retrievalPolicy: payload.retrievalPolicy || {},
      toolPolicy: payload.toolPolicy || {},
      knowledgeBaseIds: await listDbManageableKnowledgeBaseIds(user, payload.knowledgeBaseIds || []),
    },
  });

  await pool.query(
    `INSERT INTO agents (id, name, description, department, owner_user_id, visibility_scope, status, current_version_id, icon_url, avatar_preset, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      agentId,
      String(payload.name || '未命名智能体').slice(0, 120),
      String(payload.description || '').slice(0, 5000),
      String(payload.department || '未分组').slice(0, 120),
      user.id,
      AGENT_VISIBILITY_SCOPE,
      'draft',
      null,
      payload.iconUrl ? String(payload.iconUrl).slice(0, 1024) : null,
      payload.avatarPreset ? String(payload.avatarPreset).slice(0, 40) : null,
      now,
      now,
    ]
  );

  await pool.query(
    `INSERT INTO agent_versions (
      id, agent_id, version_no, version_name, allowed_chat_models_json, default_chat_model, is_published, system_prompt, reply_style_rules_json, model_policy_json,
      context_policy_json, retrieval_policy_json, tool_policy_json, validation_status, validation_summary_json,
      created_by, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      version.id,
      version.agentId,
      version.versionNo,
      version.versionName,
      stringifyJsonField(version.allowedChatModels),
      version.defaultChatModel || null,
      version.isPublished,
      version.systemPrompt,
      version.replyStyleRulesJson,
      version.modelPolicyJson,
      version.contextPolicyJson,
      version.retrievalPolicyJson,
      version.toolPolicyJson,
      version.validationStatus,
      version.validationSummaryJson,
      version.createdBy,
      version.createdAt,
    ]
  );
  await syncDbVersionKnowledgeBases(version.id, version.knowledgeBaseIds);
  return {
    agent: await getDbAgentById(agentId),
    version: await getDbAgentVersionById(version.id),
  };
};

const updateDbAgent = async (user, agentId, payload) => {
  const current = await getDbAgentById(agentId);
  if (!current || !canManageOwnedResource(user, current.ownerUserId)) return null;
  const pool = await getMysqlPool();
  const nextName = typeof payload.name === 'string' ? payload.name.slice(0, 120) : current.name;
  const nextDescription = typeof payload.description === 'string' ? payload.description.slice(0, 5000) : current.description;
  const nextDepartment = typeof payload.department === 'string' ? payload.department.slice(0, 120) : current.department;
  const nextIconUrl = payload.iconUrl === null ? null : typeof payload.iconUrl === 'string' ? payload.iconUrl.slice(0, 1024) : current.iconUrl || null;
  const nextAvatarPreset = payload.avatarPreset === null ? null : typeof payload.avatarPreset === 'string' ? payload.avatarPreset.slice(0, 40) : current.avatarPreset || null;
  const nextStatus = payload.status ? normalizeAgentStatus(payload.status) : current.status;
  await pool.query(
    'UPDATE agents SET name = ?, description = ?, department = ?, icon_url = ?, avatar_preset = ?, status = ?, updated_at = ? WHERE id = ?',
    [nextName, nextDescription, nextDepartment, nextIconUrl, nextAvatarPreset, nextStatus, Date.now(), agentId]
  );
  return await getDbAgentById(agentId);
};

const deleteDbAgentVersion = async (user, versionId) => {
  const version = await getDbAgentVersionById(versionId);
  if (!version || version.isPublished) return null;
  const agent = await getDbAgentById(version.agentId);
  if (!agent || !canManageOwnedResource(user, agent.ownerUserId)) return null;

  const pool = await getMysqlPool();
  await pool.query('DELETE FROM agent_version_knowledge_bases WHERE agent_version_id = ?', [versionId]);
  await pool.query('DELETE FROM agent_versions WHERE id = ?', [versionId]);
  await pool.query('UPDATE agents SET updated_at = ? WHERE id = ?', [Date.now(), agent.id]);
  return { ok: true, deletedVersionId: versionId };
};

const deleteDbAgent = async (user, agentId) => {
  const agent = await getDbAgentById(agentId);
  if (!agent || !canManageOwnedResource(user, agent.ownerUserId)) return null;

  const pool = await getMysqlPool();
  const versions = await listDbAgentVersionsByAgentId(agentId);
  const versionIds = versions.map((item) => item.id);
  if (versionIds.length > 0) {
    const placeholders = versionIds.map(() => '?').join(', ');
    await pool.query(`DELETE FROM agent_version_knowledge_bases WHERE agent_version_id IN (${placeholders})`, versionIds);
    await pool.query(`DELETE FROM chat_messages WHERE session_id IN (SELECT id FROM chat_sessions WHERE agent_id = ?)`, [agentId]);
    await pool.query('DELETE FROM chat_sessions WHERE agent_id = ?', [agentId]);
    await pool.query('DELETE FROM agent_usage_logs WHERE agent_id = ?', [agentId]);
    await pool.query(`DELETE FROM agent_versions WHERE id IN (${placeholders})`, versionIds);
  } else {
    await pool.query(`DELETE FROM chat_messages WHERE session_id IN (SELECT id FROM chat_sessions WHERE agent_id = ?)`, [agentId]);
    await pool.query('DELETE FROM chat_sessions WHERE agent_id = ?', [agentId]);
    await pool.query('DELETE FROM agent_usage_logs WHERE agent_id = ?', [agentId]);
  }
  await pool.query('DELETE FROM agents WHERE id = ?', [agentId]);
  return { ok: true, deletedAgentId: agentId };
};

const createDbAgentDraft = async (user, agentId) => {
  const current = await getDbAgentById(agentId);
  if (!current || !canManageOwnedResource(user, current.ownerUserId)) return null;
  const versions = await listDbAgentVersionsByAgentId(agentId);
  const sourceVersion = versions[0] || null;
  const nextVersion = buildAgentVersionInsertRecord({
    agentId,
    versionNo: Math.max(0, ...versions.map((item) => item.versionNo)) + 1,
    createdBy: user.id,
    source: sourceVersion,
  });
  const pool = await getMysqlPool();
  await pool.query(
    `INSERT INTO agent_versions (
      id, agent_id, version_no, version_name, allowed_chat_models_json, default_chat_model, is_published, system_prompt, reply_style_rules_json, model_policy_json,
      context_policy_json, retrieval_policy_json, tool_policy_json, validation_status, validation_summary_json,
      created_by, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      nextVersion.id,
      nextVersion.agentId,
      nextVersion.versionNo,
      nextVersion.versionName,
      stringifyJsonField(nextVersion.allowedChatModels),
      nextVersion.defaultChatModel || null,
      nextVersion.isPublished,
      nextVersion.systemPrompt,
      nextVersion.replyStyleRulesJson,
      nextVersion.modelPolicyJson,
      nextVersion.contextPolicyJson,
      nextVersion.retrievalPolicyJson,
      nextVersion.toolPolicyJson,
      nextVersion.validationStatus,
      nextVersion.validationSummaryJson,
      nextVersion.createdBy,
      nextVersion.createdAt,
    ]
  );
  await syncDbVersionKnowledgeBases(nextVersion.id, nextVersion.knowledgeBaseIds);
  await pool.query('UPDATE agents SET updated_at = ? WHERE id = ?', [Date.now(), agentId]);
  return await getDbAgentVersionById(nextVersion.id);
};

const updateDbAgentVersion = async (user, versionId, payload) => {
  const version = await getDbAgentVersionById(versionId);
  if (!version) return null;
  const agent = await getDbAgentById(version.agentId);
  if (!agent || !canManageOwnedResource(user, agent.ownerUserId) || version.isPublished) return null;
  const config = normalizeAgentConfig({
    systemPrompt: payload.systemPrompt ?? version.systemPrompt,
    replyStyleRules: payload.replyStyleRules ?? version.replyStyleRules,
    modelPolicy: payload.modelPolicy ?? version.modelPolicy,
    contextPolicy: payload.contextPolicy ?? version.contextPolicy,
    retrievalPolicy: payload.retrievalPolicy ?? version.retrievalPolicy,
    toolPolicy: payload.toolPolicy ?? version.toolPolicy,
  });
  const knowledgeBaseIds = await listDbManageableKnowledgeBaseIds(user, payload.knowledgeBaseIds ?? version.knowledgeBaseIds);
  const allowedChatModels = Array.from(new Set((Array.isArray(payload.allowedChatModels) ? payload.allowedChatModels : version.allowedChatModels).map((item) => String(item || '').trim()).filter(Boolean)));
  const defaultChatModel = String(payload.defaultChatModel || version.defaultChatModel || allowedChatModels[0] || config.modelPolicy.defaultModel || '').trim() || '';
  const pool = await getMysqlPool();
  await pool.query(
    `UPDATE agent_versions
     SET version_name = ?, allowed_chat_models_json = ?, default_chat_model = ?, system_prompt = ?, reply_style_rules_json = ?, model_policy_json = ?, context_policy_json = ?,
         retrieval_policy_json = ?, tool_policy_json = ?, validation_status = ?, validation_summary_json = ?
     WHERE id = ?`,
    [
      normalizeVersionName(payload.versionName, version.versionNo, version.createdAt),
      stringifyJsonField(allowedChatModels),
      defaultChatModel,
      config.systemPrompt,
      stringifyJsonField(config.replyStyleRules),
      stringifyJsonField(config.modelPolicy),
      stringifyJsonField(config.contextPolicy),
      stringifyJsonField(config.retrievalPolicy),
      stringifyJsonField(config.toolPolicy),
      'pending',
      null,
      versionId,
    ]
  );
  await syncDbVersionKnowledgeBases(versionId, knowledgeBaseIds);
  await pool.query('UPDATE agents SET updated_at = ? WHERE id = ?', [Date.now(), version.agentId]);
  return await getDbAgentVersionById(versionId);
};

const listDbKnowledgeBases = async (user) => {
  const pool = await getMysqlPool();
  const where = isSuperAdminUser(user) ? '' : 'WHERE kb.owner_user_id = ?';
  const params = isSuperAdminUser(user) ? [] : [user.id];
  const [rows] = await pool.query(
    `SELECT kb.*, u.display_name AS owner_display_name
     FROM knowledge_bases kb
     LEFT JOIN users u ON u.id = kb.owner_user_id
     ${where}
     ORDER BY kb.updated_at DESC`,
    params
  );
  const items = [];
  for (const row of rows) {
    const [docRows] = await pool.query('SELECT COUNT(*) AS count FROM knowledge_documents WHERE knowledge_base_id = ?', [row.id]);
    const [boundRows] = await pool.query('SELECT COUNT(DISTINCT agent_version_id) AS count FROM agent_version_knowledge_bases WHERE knowledge_base_id = ?', [row.id]);
    items.push({
      id: row.id,
      name: row.name,
      description: row.description,
      department: row.department,
      ownerUserId: row.owner_user_id,
      ownerDisplayName: row.owner_display_name || '',
      status: normalizeKnowledgeBaseStatus(row.status),
      documentCount: Number(docRows[0]?.count || 0),
      boundAgentCount: Number(boundRows[0]?.count || 0),
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    });
  }
  return items;
};

const getDbKnowledgeBaseById = async (knowledgeBaseId) => {
  const pool = await getMysqlPool();
  const [rows] = await pool.query(
    `SELECT kb.*, u.display_name AS owner_display_name
     FROM knowledge_bases kb
     LEFT JOIN users u ON u.id = kb.owner_user_id
     WHERE kb.id = ? LIMIT 1`,
    [knowledgeBaseId]
  );
  if (!rows[0]) return null;
  const [docRows] = await pool.query('SELECT COUNT(*) AS count FROM knowledge_documents WHERE knowledge_base_id = ?', [knowledgeBaseId]);
  const [boundRows] = await pool.query('SELECT COUNT(DISTINCT agent_version_id) AS count FROM agent_version_knowledge_bases WHERE knowledge_base_id = ?', [knowledgeBaseId]);
  return {
    id: rows[0].id,
    name: rows[0].name,
    description: rows[0].description,
    department: rows[0].department,
    ownerUserId: rows[0].owner_user_id,
    ownerDisplayName: rows[0].owner_display_name || '',
    status: normalizeKnowledgeBaseStatus(rows[0].status),
    documentCount: Number(docRows[0]?.count || 0),
    boundAgentCount: Number(boundRows[0]?.count || 0),
    createdAt: Number(rows[0].created_at),
    updatedAt: Number(rows[0].updated_at),
  };
};

const createDbKnowledgeBase = async (user, payload) => {
  const pool = await getMysqlPool();
  const now = Date.now();
  const knowledgeBaseId = createEntityId();
  await pool.query(
    `INSERT INTO knowledge_bases (id, name, description, department, owner_user_id, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      knowledgeBaseId,
      String(payload.name || '未命名知识库').slice(0, 120),
      String(payload.description || '').slice(0, 5000),
      String(payload.department || '未分组').slice(0, 120),
      user.id,
      'active',
      now,
      now,
    ]
  );
  return await getDbKnowledgeBaseById(knowledgeBaseId);
};

const updateDbKnowledgeBase = async (user, knowledgeBaseId, payload) => {
  const current = await getDbKnowledgeBaseById(knowledgeBaseId);
  if (!current || !canManageOwnedResource(user, current.ownerUserId)) return null;
  const pool = await getMysqlPool();
  await pool.query(
    'UPDATE knowledge_bases SET name = ?, description = ?, department = ?, status = ?, updated_at = ? WHERE id = ?',
    [
      typeof payload.name === 'string' ? payload.name.slice(0, 120) : current.name,
      typeof payload.description === 'string' ? payload.description.slice(0, 5000) : current.description,
      typeof payload.department === 'string' ? payload.department.slice(0, 120) : current.department,
      payload.status ? normalizeKnowledgeBaseStatus(payload.status) : current.status,
      Date.now(),
      knowledgeBaseId,
    ]
  );
  return await getDbKnowledgeBaseById(knowledgeBaseId);
};

const deleteDbKnowledgeBase = async (user, knowledgeBaseId) => {
  const current = await getDbKnowledgeBaseById(knowledgeBaseId);
  if (!current || !canManageOwnedResource(user, current.ownerUserId)) return 0;
  const pool = await getMysqlPool();
  await pool.query('DELETE FROM knowledge_chunks WHERE knowledge_base_id = ?', [knowledgeBaseId]);
  await pool.query('DELETE FROM knowledge_documents WHERE knowledge_base_id = ?', [knowledgeBaseId]);
  await pool.query('DELETE FROM agent_version_knowledge_bases WHERE knowledge_base_id = ?', [knowledgeBaseId]);
  const [result] = await pool.query('DELETE FROM knowledge_bases WHERE id = ?', [knowledgeBaseId]);
  return Number(result.affectedRows || 0);
};

const listDbKnowledgeDocuments = async (user, knowledgeBaseId) => {
  const knowledgeBase = await getDbKnowledgeBaseById(knowledgeBaseId);
  if (!knowledgeBase || !canManageOwnedResource(user, knowledgeBase.ownerUserId)) return [];
  const pool = await getMysqlPool();
  const [rows] = await pool.query(
    'SELECT * FROM knowledge_documents WHERE knowledge_base_id = ? ORDER BY updated_at DESC',
    [knowledgeBaseId]
  );
  return rows.map((row) => ({
    id: row.id,
    knowledgeBaseId: row.knowledge_base_id,
    title: row.title,
    sourceType: normalizeSourceType(row.source_type),
    chunkStrategy: normalizeKnowledgeChunkStrategyValue(row.chunk_strategy),
    rawText: row.raw_text,
    normalizationEnabled: Boolean(row.normalization_enabled),
    normalizedText: String(row.normalized_text || ''),
    normalizationError: String(row.normalization_error || ''),
    normalizedStatus: normalizeKnowledgeNormalizedStatus(row.normalized_status),
    chunkSource: normalizeKnowledgeChunkSource(row.chunk_source),
    parseStatus: row.parse_status,
    chunkCount: Number(row.chunk_count || 0),
    createdBy: row.created_by,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  }));
};

const createDbKnowledgeDocument = async (user, payload) => {
  const knowledgeBase = await getDbKnowledgeBaseById(payload.knowledgeBaseId);
  if (!knowledgeBase || !canManageOwnedResource(user, knowledgeBase.ownerUserId)) return null;
  const pool = await getMysqlPool();
  const rawText = String(payload.rawText || '').trim();
  const chunkStrategy = normalizeKnowledgeChunkStrategyValue(payload.chunkStrategy);
  const normalizationEnabled = Boolean(payload.normalizationEnabled);
  const systemSettings = await getDbSystemSettings();
  const normalizationResult = normalizationEnabled
    ? await normalizeKnowledgeDocumentText(rawText, process.env, systemSettings)
    : { normalizedText: '', normalizedStatus: 'idle', chunkSource: 'raw', normalizationError: '' };
  const chunkText = normalizationResult.chunkSource === 'normalized' ? normalizationResult.normalizedText : rawText;
  const chunks = chunkKnowledgeText(chunkText, { strategy: chunkStrategy });
  const now = Date.now();
  const documentId = createEntityId();
  await pool.query(
    `INSERT INTO knowledge_documents (
      id, knowledge_base_id, title, source_type, chunk_strategy, storage_asset_id, raw_text, normalization_enabled, normalized_text, normalization_error, normalized_status, chunk_source, parse_status, chunk_count, created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      documentId,
      knowledgeBase.id,
      String(payload.title || '未命名文档').slice(0, 255),
      normalizeSourceType(payload.sourceType),
      chunkStrategy,
      null,
      rawText,
      normalizationEnabled ? 1 : 0,
      normalizationResult.normalizedText || null,
      normalizationResult.normalizationError || null,
      normalizationResult.normalizedStatus,
      normalizationResult.chunkSource,
      'parsed',
      chunks.length,
      user.id,
      now,
      now,
    ]
  );
  for (const [index, content] of chunks.entries()) {
    await pool.query(
      `INSERT INTO knowledge_chunks (id, document_id, knowledge_base_id, chunk_index, source_type, content, token_estimate, embedding_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        createEntityId(),
        documentId,
        knowledgeBase.id,
        index,
        normalizeSourceType(payload.sourceType),
        content,
        estimateTokenCount(content),
        null,
        now,
      ]
    );
  }
  await pool.query('UPDATE knowledge_bases SET updated_at = ? WHERE id = ?', [now, knowledgeBase.id]);
  if (normalizationEnabled && normalizationResult.normalizedStatus === 'failed') {
    await createDbLog({
      user,
      level: 'error',
      module: 'agent_center',
      action: 'knowledge_normalization_failed',
      message: `知识库文档整理失败：${String(payload.title || '未命名文档').slice(0, 60)}`,
      detail: normalizationResult.normalizationError || 'AI 规范整理失败，已回退原文切片。',
      status: 'failed',
      meta: { knowledgeBaseId: knowledgeBase.id, documentId, chunkStrategy },
    });
  }
  const documents = await listDbKnowledgeDocuments(user, knowledgeBase.id);
  return documents.find((item) => item.id === documentId) || null;
};

const updateDbKnowledgeDocument = async (user, documentId, payload) => {
  const pool = await getMysqlPool();
  const [rows] = await pool.query('SELECT * FROM knowledge_documents WHERE id = ? LIMIT 1', [documentId]);
  if (!rows[0]) return null;
  const existing = rows[0];
  const knowledgeBase = await getDbKnowledgeBaseById(existing.knowledge_base_id);
  if (!knowledgeBase || !canManageOwnedResource(user, knowledgeBase.ownerUserId)) return null;
  const rawText = typeof payload.rawText === 'string' ? String(payload.rawText).trim() : String(existing.raw_text || '');
  const title = typeof payload.title === 'string' ? String(payload.title).slice(0, 255) : String(existing.title || '未命名文档');
  const sourceType = typeof payload.sourceType === 'string' ? normalizeSourceType(payload.sourceType) : normalizeSourceType(existing.source_type);
  const chunkStrategy = payload.chunkStrategy === undefined ? normalizeKnowledgeChunkStrategyValue(existing.chunk_strategy) : normalizeKnowledgeChunkStrategyValue(payload.chunkStrategy);
  const normalizationEnabled = payload.normalizationEnabled === undefined ? Boolean(existing.normalization_enabled) : Boolean(payload.normalizationEnabled);
  const systemSettings = await getDbSystemSettings();
  const normalizationResult = normalizationEnabled
    ? await normalizeKnowledgeDocumentText(rawText, process.env, systemSettings)
    : { normalizedText: '', normalizedStatus: 'idle', chunkSource: 'raw', normalizationError: '' };
  const chunkText = normalizationResult.chunkSource === 'normalized' ? normalizationResult.normalizedText : rawText;
  const chunks = chunkKnowledgeText(chunkText, { strategy: chunkStrategy });
  const now = Date.now();
  await pool.query(
    `UPDATE knowledge_documents
     SET title = ?, source_type = ?, chunk_strategy = ?, raw_text = ?, normalization_enabled = ?, normalized_text = ?, normalization_error = ?, normalized_status = ?, chunk_source = ?, parse_status = ?, chunk_count = ?, updated_at = ?
     WHERE id = ?`,
    [
      title,
      sourceType,
      chunkStrategy,
      rawText,
      normalizationEnabled ? 1 : 0,
      normalizationResult.normalizedText || null,
      normalizationResult.normalizationError || null,
      normalizationResult.normalizedStatus,
      normalizationResult.chunkSource,
      'parsed',
      chunks.length,
      now,
      documentId,
    ]
  );
  await pool.query('DELETE FROM knowledge_chunks WHERE document_id = ?', [documentId]);
  for (const [index, content] of chunks.entries()) {
    await pool.query(
      `INSERT INTO knowledge_chunks (id, document_id, knowledge_base_id, chunk_index, source_type, content, token_estimate, embedding_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        createEntityId(),
        documentId,
        knowledgeBase.id,
        index,
        sourceType,
        content,
        estimateTokenCount(content),
        null,
        now,
      ]
    );
  }
  await pool.query('UPDATE knowledge_bases SET updated_at = ? WHERE id = ?', [now, knowledgeBase.id]);
  if (normalizationEnabled && normalizationResult.normalizedStatus === 'failed') {
    await createDbLog({
      user,
      level: 'error',
      module: 'agent_center',
      action: 'knowledge_normalization_failed',
      message: `知识库文档整理失败：${title.slice(0, 60)}`,
      detail: normalizationResult.normalizationError || 'AI 规范整理失败，已回退原文切片。',
      status: 'failed',
      meta: { knowledgeBaseId: knowledgeBase.id, documentId, chunkStrategy },
    });
  }
  const documents = await listDbKnowledgeDocuments(user, knowledgeBase.id);
  return documents.find((item) => item.id === documentId) || null;
};

const deleteDbKnowledgeDocument = async (user, documentId) => {
  const pool = await getMysqlPool();
  const [rows] = await pool.query('SELECT * FROM knowledge_documents WHERE id = ? LIMIT 1', [documentId]);
  if (!rows[0]) return 0;
  const knowledgeBase = await getDbKnowledgeBaseById(rows[0].knowledge_base_id);
  if (!knowledgeBase || !canManageOwnedResource(user, knowledgeBase.ownerUserId)) return 0;
  await pool.query('DELETE FROM knowledge_chunks WHERE document_id = ?', [documentId]);
  const [result] = await pool.query('DELETE FROM knowledge_documents WHERE id = ?', [documentId]);
  await pool.query('UPDATE knowledge_bases SET updated_at = ? WHERE id = ?', [Date.now(), knowledgeBase.id]);
  return Number(result?.affectedRows || 0);
};

const listDbKnowledgeChunksForVersion = async (version) => {
  const knowledgeBaseIds = cleanKnowledgeBaseIds(version?.knowledgeBaseIds);
  if (knowledgeBaseIds.length === 0) return [];
  const pool = await getMysqlPool();
  const placeholders = knowledgeBaseIds.map(() => '?').join(', ');
  const [rows] = await pool.query(
    `SELECT kc.*, kd.title AS document_title
     FROM knowledge_chunks kc
     INNER JOIN knowledge_documents kd ON kd.id = kc.document_id
     WHERE kc.knowledge_base_id IN (${placeholders})
     ORDER BY kc.created_at DESC, kc.chunk_index ASC`,
    knowledgeBaseIds
  );
  return rows.map((row) => ({
    id: row.id,
    documentId: row.document_id,
    knowledgeBaseId: row.knowledge_base_id,
    chunkIndex: Number(row.chunk_index || 0),
    sourceType: row.source_type,
    content: row.content,
    tokenEstimate: Number(row.token_estimate || 0),
    documentTitle: row.document_title,
  }));
};

const buildChatMessageContent = (text, attachments = []) => {
  const content = [{ type: 'text', text: String(text || '') }];
  (Array.isArray(attachments) ? attachments : []).forEach((item) => {
    if (!item?.url) return;
    if (item.kind === 'image') {
      content.push({
        type: 'image_url',
        image_url: { url: String(item.url) },
      });
      return;
    }
    content.push({
      type: 'input_file',
      file_url: String(item.url),
      filename: String(item.name || '附件'),
    });
  });
  return content;
};

const runAgentConversation = async ({
  user,
  agent,
  version,
  priorMessages,
  currentMessage,
  sessionId = null,
  selectedModelOverride = '',
  attachments = [],
  reasoningLevel = null,
  webSearchEnabled = false,
}) => {
  const shouldRetrieve = shouldUseKnowledgeRetrieval(currentMessage, version.retrievalPolicy, version.knowledgeBaseIds);
  const candidateChunks = shouldRetrieve ? await listDbKnowledgeChunksForVersion(version) : [];
  const knowledgeChunks = shouldRetrieve ? searchKnowledgeChunks(candidateChunks, currentMessage, version.retrievalPolicy) : [];
  const allPrior = Array.isArray(priorMessages) ? priorMessages : [];
  const maxRounds = Number(version.contextPolicy.maxHistoryRounds || 6);
  const summaryThreshold = Number(version.contextPolicy.summaryTriggerThreshold || 10);
  const recentCount = maxRounds * 2;
  let summary = '';
  let recentSlice = allPrior;
  if (allPrior.length > summaryThreshold * 2) {
    const olderMessages = allPrior.slice(0, -recentCount);
    summary = buildConversationSummary(olderMessages, Number(version.contextPolicy.maxSummaryChars || 1200));
    recentSlice = allPrior.slice(-recentCount);
  } else {
    recentSlice = allPrior.slice(-recentCount);
  }
  const recentMessages = recentSlice.map((message) => ({
    role: message.role,
    content: Array.isArray(message.attachments) && message.attachments.length > 0
      ? buildChatMessageContent(message.content, message.attachments)
      : message.content,
  }));
  const messages = buildAgentPromptMessages({
    systemPrompt: version.systemPrompt,
    summary,
    recentMessages,
    knowledgeChunks,
    userMessage: currentMessage,
  });
  if (messages.length > 0) {
    messages[messages.length - 1] = {
      ...messages[messages.length - 1],
      content: buildChatMessageContent(currentMessage, attachments),
    };
  }
  const selectedModel = String(selectedModelOverride || (knowledgeChunks.length > 0 ? version.modelPolicy.defaultModel : version.modelPolicy.cheapModel) || '').trim();
  const startedAt = Date.now();
  const output = await executeProviderJob({
    taskType: 'kie_chat',
    payload: {
      messages,
      model: selectedModel,
      reasoningLevel: reasoningLevel ? String(reasoningLevel) : null,
      webSearchEnabled: Boolean(webSearchEnabled),
    },
  }, process.env, new AbortController().signal);
  const content = String(output?.result?.content || '').trim();
  const promptTokens = messages.reduce((sum, message) => sum + estimateTokenCount(message.content), 0);
  const completionTokens = estimateTokenCount(content);
  const latencyMs = Date.now() - startedAt;
  const estimatedCost = estimateCostByTokens(promptTokens, completionTokens);
  return {
    content,
    selectedModel,
    usedRetrieval: knowledgeChunks.length > 0,
    knowledgeChunks,
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
    latencyMs,
    estimatedCost,
    retrievalSummary: knowledgeChunks.map((chunk) => ({
      documentTitle: chunk.documentTitle,
      sourceType: chunk.sourceType,
      preview: String(chunk.content || '').slice(0, 120),
    })),
    sessionId,
    userId: user.id,
    agentId: agent.id,
  };
};

const validateDbAgentVersion = async (user, versionId, message) => {
  const version = await getDbAgentVersionById(versionId);
  if (!version) return null;
  const agent = await getDbAgentById(version.agentId);
  if (!agent || !canManageOwnedResource(user, agent.ownerUserId)) return null;
  const result = await runAgentConversation({
    user,
    agent,
    version,
    priorMessages: [],
    currentMessage: String(message || '请用一句话说明这个智能体能做什么。'),
  });
  const pool = await getMysqlPool();
  const validationSummary = {
    ...result,
    outputPreview: result.content.slice(0, 300),
    validatedAt: Date.now(),
  };
  await pool.query(
    'UPDATE agent_versions SET validation_status = ?, validation_summary_json = ? WHERE id = ?',
    ['success', JSON.stringify(validationSummary), versionId]
  );
  return {
    version: await getDbAgentVersionById(versionId),
    result: validationSummary,
  };
};

const publishDbAgentVersion = async (user, agentId, versionId = null) => {
  const agent = await getDbAgentById(agentId);
  if (!agent || !canManageOwnedResource(user, agent.ownerUserId)) return null;
  const versions = await listDbAgentVersionsByAgentId(agentId);
  const targetVersion = versionId
    ? versions.find((item) => item.id === versionId)
    : versions.find((item) => !item.isPublished) || versions[0];
  if (!targetVersion || targetVersion.validationStatus !== 'success') return null;
  const pool = await getMysqlPool();
  await pool.query('UPDATE agent_versions SET is_published = 0 WHERE agent_id = ?', [agentId]);
  await pool.query('UPDATE agent_versions SET is_published = 1 WHERE id = ?', [targetVersion.id]);
  await pool.query(
    'UPDATE agents SET current_version_id = ?, status = ?, updated_at = ? WHERE id = ?',
    [targetVersion.id, 'published', Date.now(), agentId]
  );
  return await getDbAgentById(agentId);
};

const rollbackDbAgentVersion = async (user, agentId, versionId) => {
  return publishDbAgentVersion(user, agentId, versionId);
};

const listDbChatAgents = async () => {
  const pool = await getMysqlPool();
  const [rows] = await pool.query(
    `SELECT a.*, av.version_no, av.model_policy_json, av.allowed_chat_models_json, av.default_chat_model
     FROM agents a
     INNER JOIN agent_versions av ON av.id = a.current_version_id
     WHERE a.status = ? AND a.current_version_id IS NOT NULL
     ORDER BY a.updated_at DESC`,
    ['published']
  );
  return rows.map((row) => {
    const rawModelPolicy = parseJsonField(row.model_policy_json, {});
    const allowedChatModels = sanitizeAllowedChatModels(parseJsonField(row.allowed_chat_models_json, []), [
      row.default_chat_model,
      rawModelPolicy.defaultModel,
      rawModelPolicy.cheapModel,
    ]);
    const modelPolicy = sanitizeModelPolicy(rawModelPolicy, allowedChatModels);
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      department: row.department,
      ownerUserId: row.owner_user_id,
      ownerDisplayName: '',
      visibilityScope: row.visibility_scope,
      status: row.status,
      currentVersionId: row.current_version_id,
      currentVersionNo: Number(row.version_no || 1),
      defaultModel: modelPolicy.defaultModel || '',
      allowedChatModels,
      defaultChatModel: allowedChatModels.includes(String(row.default_chat_model || '').trim())
        ? String(row.default_chat_model).trim()
        : modelPolicy.defaultModel || '',
      imageGenerationEnabled: Boolean(modelPolicy.imageGenerationEnabled),
      imageModel: modelPolicy.multimodalModel || '',
      imageMaxInputCount: Number(getImageModelCapability(modelPolicy.multimodalModel)?.maxInputImages || 1),
      iconUrl: row.icon_url || '',
      avatarPreset: row.avatar_preset || '',
      knowledgeBaseCount: 0,
      usageCount7d: 0,
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    };
  });
};

const createDbChatSession = async (user, agentId) => {
  const agent = await getDbAgentById(agentId);
  if (!agent?.currentVersionId || agent.status !== 'published') return null;
  const version = await getDbAgentVersionById(agent.currentVersionId);
  const selectedModel = resolveChatSessionModel(version);
  const pool = await getMysqlPool();
  const sessionId = createEntityId();
  const now = Date.now();
  await pool.query(
    `INSERT INTO chat_sessions (id, user_id, agent_id, agent_version_id, title, status, summary, selected_model, reasoning_level, web_search_enabled, last_image_mode, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [sessionId, user.id, agentId, agent.currentVersionId, '新会话', 'active', null, selectedModel || '', null, 0, 0, now, now]
  );
  return {
    id: sessionId,
    userId: user.id,
    agentId,
    agentVersionId: agent.currentVersionId,
    title: '新会话',
    status: 'active',
    summary: '',
    selectedModel: selectedModel || '',
    reasoningLevel: null,
    webSearchEnabled: false,
    lastImageMode: false,
    createdAt: now,
    updatedAt: now,
  };
};

const listDbChatSessions = async (user, agentId = '') => {
  const pool = await getMysqlPool();
  const clauses = ['user_id = ?'];
  const values = [user.id];
  if (agentId) {
    clauses.push('agent_id = ?');
    values.push(agentId);
  }
  const [rows] = await pool.query(
    `SELECT * FROM chat_sessions WHERE ${clauses.join(' AND ')} ORDER BY updated_at DESC`,
    values
  );
  return rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    agentId: row.agent_id,
    agentVersionId: row.agent_version_id,
    title: row.title,
    status: row.status,
    summary: row.summary || '',
    selectedModel: row.selected_model || '',
    reasoningLevel: row.reasoning_level || null,
    webSearchEnabled: Boolean(row.web_search_enabled),
    lastImageMode: Boolean(row.last_image_mode),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  }));
};

const getDbChatSessionById = async (user, sessionId) => {
  const pool = await getMysqlPool();
  const [rows] = await pool.query('SELECT * FROM chat_sessions WHERE id = ? AND user_id = ? LIMIT 1', [sessionId, user.id]);
  if (!rows[0]) return null;
  return {
    id: rows[0].id,
    userId: rows[0].user_id,
    agentId: rows[0].agent_id,
    agentVersionId: rows[0].agent_version_id,
    title: rows[0].title,
    status: rows[0].status,
    summary: rows[0].summary || '',
    selectedModel: rows[0].selected_model || '',
    reasoningLevel: rows[0].reasoning_level || null,
    webSearchEnabled: Boolean(rows[0].web_search_enabled),
    lastImageMode: Boolean(rows[0].last_image_mode),
    createdAt: Number(rows[0].created_at),
    updatedAt: Number(rows[0].updated_at),
  };
};

const listDbChatMessages = async (user, sessionId) => {
  const session = await getDbChatSessionById(user, sessionId);
  if (!session) return [];
  const pool = await getMysqlPool();
  const [rows] = await pool.query(
    'SELECT * FROM chat_messages WHERE session_id = ? AND user_id = ? ORDER BY created_at ASC',
    [sessionId, user.id]
  );
  return rows.map((row) => ({
    id: row.id,
    sessionId: row.session_id,
    userId: row.user_id,
    role: row.role,
    content: row.content,
    attachments: parseJsonField(row.attachments_json, null),
    metadata: parseJsonField(row.metadata_json, null),
    createdAt: Number(row.created_at),
  }));
};

const createDbAgentUsageLog = async (user, agent, version, result, status, errorMessage = '') => {
  const pool = await getMysqlPool();
  const createdAt = Date.now();
  await pool.query(
    `INSERT INTO agent_usage_logs (
      id, user_id, username, display_name, agent_id, agent_name, agent_version_id, session_id,
      request_type, selected_model, used_retrieval, retrieval_summary_json, prompt_tokens,
      completion_tokens, total_tokens, estimated_cost, latency_ms, status, error_message, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      createEntityId(),
      user.id,
      user.username,
      user.displayName || user.username,
      agent.id,
      agent.name,
      version.id,
      result?.sessionId || null,
      result?.requestType || (result?.sessionId ? 'chat' : 'validation'),
      result?.selectedModel || version.modelPolicy.defaultModel,
      result?.usedRetrieval ? 1 : 0,
      JSON.stringify(result?.retrievalSummary || []),
      Number(result?.promptTokens || 0),
      Number(result?.completionTokens || 0),
      Number(result?.totalTokens || 0),
      Number(result?.estimatedCost || 0),
      Number(result?.latencyMs || 0),
      status,
      errorMessage || null,
      createdAt,
    ]
  );
  await createDbLog({
    user,
    level: status === 'success' ? 'info' : 'error',
    module: 'agent_center',
    action: result?.requestType === 'image_generation' ? 'create_image_task' : result?.sessionId ? 'agent_chat' : 'agent_validate',
    message: `${result?.requestType === 'image_generation' ? '智能体生图' : result?.sessionId ? '智能体对话' : '智能体验证'}：${agent.name}`,
    detail: errorMessage || '',
    status: status === 'success' ? 'success' : 'failed',
    meta: buildAgentRuntimeLogMeta({ agent, version, result, error: errorMessage ? { message: errorMessage } : null }),
  });
};

const createDbChatSessionOptions = async (user, sessionId, payload) => {
  const session = await getDbChatSessionById(user, sessionId);
  if (!session) return null;
  const version = await getDbAgentVersionById(session.agentVersionId);
  if (!version) return null;
  const selectedModel = resolveChatSessionModel(version, payload?.selectedModel || session.selectedModel);
  const capability = getChatModelCapability(selectedModel);
  const nextReasoningLevel = capability?.supportsReasoningLevel ? (payload?.reasoningLevel ? String(payload.reasoningLevel) : null) : null;
  const nextWebSearchEnabled = capability?.supportsWebSearch ? Boolean(payload?.webSearchEnabled) : false;
  const nextLastImageMode = Boolean(payload?.lastImageMode);
  const pool = await getMysqlPool();
  await pool.query(
    'UPDATE chat_sessions SET selected_model = ?, reasoning_level = ?, web_search_enabled = ?, last_image_mode = ?, updated_at = ? WHERE id = ? AND user_id = ?',
    [selectedModel || '', nextReasoningLevel, nextWebSearchEnabled ? 1 : 0, nextLastImageMode ? 1 : 0, Date.now(), sessionId, user.id]
  );
  return await getDbChatSessionById(user, sessionId);
};

const deleteDbChatSession = async (user, sessionId) => {
  const session = await getDbChatSessionById(user, sessionId);
  if (!session) return null;
  const pool = await getMysqlPool();
  await pool.query('DELETE FROM chat_messages WHERE session_id = ? AND user_id = ?', [sessionId, user.id]);
  await pool.query('DELETE FROM chat_sessions WHERE id = ? AND user_id = ?', [sessionId, user.id]);
  return { ok: true, deletedSessionId: sessionId };
};

const deleteDbUserAgentHistory = async (user, agentId) => {
  const agent = await getDbAgentById(agentId);
  if (!agent || agent.status !== 'published') return null;
  const pool = await getMysqlPool();
  const [sessionRows] = await pool.query('SELECT id FROM chat_sessions WHERE user_id = ? AND agent_id = ?', [user.id, agentId]);
  const sessionIds = sessionRows.map((row) => row.id);
  let deletedMessageCount = 0;
  if (sessionIds.length > 0) {
    const [messageResult] = await pool.query(
      `DELETE FROM chat_messages WHERE user_id = ? AND session_id IN (${sessionIds.map(() => '?').join(',')})`,
      [user.id, ...sessionIds]
    );
    deletedMessageCount = Number(messageResult.affectedRows || 0);
  }
  const [sessionResult] = await pool.query('DELETE FROM chat_sessions WHERE user_id = ? AND agent_id = ?', [user.id, agentId]);
  const [usageResult] = await pool.query('DELETE FROM agent_usage_logs WHERE user_id = ? AND agent_id = ?', [user.id, agentId]);
  return {
    ok: true,
    deletedSessionCount: Number(sessionResult.affectedRows || 0),
    deletedMessageCount,
    deletedUsageCount: Number(usageResult.affectedRows || 0),
  };
};

const createDbChatReply = async (user, sessionId, payload) => {
  const content = String(payload?.content || '').trim();
  const requestMode = payload?.requestMode === 'image_generation' ? 'image_generation' : 'chat';
  const clientRequestId = String(payload?.clientRequestId || createEntityId()).trim() || createEntityId();
  const session = await getDbChatSessionById(user, sessionId);
  if (!session) return null;
  const version = await getDbAgentVersionById(session.agentVersionId);
  const agent = await getDbAgentById(session.agentId);
  if (!version || !agent) return null;
  const selectedModel = resolveChatSessionModel(version, payload?.selectedModel || session.selectedModel);
  const capability = getChatModelCapability(selectedModel);
  const attachments = Array.isArray(payload?.attachments) ? payload.attachments.map((item) => ({
    name: String(item?.name || '').trim() || '附件',
    url: item?.url ? String(item.url) : undefined,
    assetId: item?.assetId ? String(item.assetId) : undefined,
    mimeType: item?.mimeType ? String(item.mimeType) : undefined,
    kind: item?.kind === 'image' ? 'image' : 'file',
  })) : [];
  if (requestMode === 'image_generation' && attachments.some((item) => item.kind !== 'image')) {
    throw new Error('生图模式暂只支持上传图片');
  }
  if (requestMode !== 'image_generation' && attachments.some((item) => item.kind === 'image') && !capability?.supportsImageInput) {
    throw new Error('当前模型不支持图片输入');
  }
  if (requestMode !== 'image_generation' && attachments.some((item) => item.kind !== 'image') && !capability?.supportsFileInput) {
    throw new Error('当前模型不支持文件输入');
  }
  if (requestMode !== 'image_generation' && payload?.webSearchEnabled && !capability?.supportsWebSearch) {
    throw new Error('当前模型不支持联网');
  }
  const pool = await getMysqlPool();
  const now = Date.now();
  const userMessageId = createEntityId();
  await pool.query(
    `INSERT INTO chat_messages (id, session_id, user_id, role, content, attachments_json, metadata_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [userMessageId, sessionId, user.id, 'user', content, JSON.stringify(attachments), JSON.stringify({ selectedModel, reasoningLevel: payload?.reasoningLevel || null, webSearchEnabled: Boolean(payload?.webSearchEnabled), requestMode, clientRequestId }), now]
  );
  const history = await listDbChatMessages(user, sessionId);
  const summaryNeeded = history.filter((item) => item.role !== 'system').length > Number(version.contextPolicy.summaryTriggerThreshold || 10);
  const summary = summaryNeeded ? buildConversationSummary(history, Number(version.contextPolicy.maxSummaryChars || 1200)) : (session.summary || '');
  const systemSettings = await getDbSystemSettings();
  const imageKnowledgeChunks = requestMode === 'image_generation' && version.retrievalPolicy?.enabled
    ? searchKnowledgeChunks(await listDbKnowledgeChunksForVersion(version), content, {
        ...version.retrievalPolicy,
        topK: Math.min(Number(version.retrievalPolicy?.topK || 3), 3),
        maxChunks: Math.min(Number(version.retrievalPolicy?.maxChunks || 5), 3),
        maxContextChars: Math.min(Number(version.retrievalPolicy?.maxContextChars || 2400), 1800),
      })
    : [];
  const result = requestMode === 'image_generation'
    ? await buildImageConversationResult({
        user,
        agent,
        version,
        priorMessages: history,
        currentMessage: content,
        sessionId,
        selectedModelOverride: selectedModel,
        attachments,
        systemSettings,
        knowledgeChunks: imageKnowledgeChunks,
        conversationSummary: summary,
      })
    : await runAgentConversation({
        user,
        agent,
        version,
        priorMessages: history,
        currentMessage: content,
        sessionId,
        selectedModelOverride: selectedModel,
        attachments,
        reasoningLevel: payload?.reasoningLevel || null,
        webSearchEnabled: Boolean(payload?.webSearchEnabled),
      });
  const assistantMessageId = createEntityId();
  const assistantAttachments = Array.isArray(result.imageResultUrls) && result.imageResultUrls.length > 0
    ? result.imageResultUrls.map((url, index) => ({
        name: `生成结果${index + 1}`,
        url: String(url || ''),
        kind: 'image',
      }))
    : null;
  await pool.query(
    `INSERT INTO chat_messages (id, session_id, user_id, role, content, attachments_json, metadata_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [assistantMessageId, sessionId, user.id, 'assistant', result.content, JSON.stringify(assistantAttachments), JSON.stringify({ selectedModel: result.selectedModel, usedRetrieval: result.usedRetrieval, reasoningLevel: payload?.reasoningLevel || null, webSearchEnabled: Boolean(payload?.webSearchEnabled), requestMode, clientRequestId, imagePlan: result.imagePlan || null, imageResultUrls: result.imageResultUrls || null, retrievalSummary: result.retrievalSummary || [] }), Date.now()]
  );
  await pool.query(
    'UPDATE chat_sessions SET title = ?, summary = ?, selected_model = ?, reasoning_level = ?, web_search_enabled = ?, last_image_mode = ?, updated_at = ? WHERE id = ?',
    [session.title === '新会话' ? content.slice(0, 24) : session.title, summary, selectedModel || '', payload?.reasoningLevel ? String(payload.reasoningLevel) : null, requestMode === 'image_generation' ? 0 : payload?.webSearchEnabled ? 1 : 0, requestMode === 'image_generation' ? 1 : 0, Date.now(), sessionId]
  );
  await createDbAgentUsageLog(user, agent, version, result, 'success');
  return {
    userMessage: {
      id: userMessageId,
      sessionId,
      userId: user.id,
      role: 'user',
      content,
      attachments,
      metadata: { selectedModel, reasoningLevel: payload?.reasoningLevel || null, webSearchEnabled: Boolean(payload?.webSearchEnabled), requestMode, clientRequestId },
      createdAt: now,
    },
    assistantMessage: {
      id: assistantMessageId,
      sessionId,
      userId: user.id,
      role: 'assistant',
      content: result.content,
      attachments: assistantAttachments,
      metadata: { selectedModel: result.selectedModel, usedRetrieval: result.usedRetrieval, requestMode, clientRequestId, imagePlan: result.imagePlan || null, imageResultUrls: result.imageResultUrls || null, retrievalSummary: result.retrievalSummary || [] },
      createdAt: Date.now(),
    },
    usage: result,
  };
};

const listDbAgentUsage = async (user) => {
  const pool = await getMysqlPool();
  const where = isSuperAdminUser(user) ? '' : 'WHERE a.owner_user_id = ?';
  const params = isSuperAdminUser(user) ? [] : [user.id];
  const [rows] = await pool.query(
    `SELECT l.*
     FROM agent_usage_logs l
     LEFT JOIN agents a ON a.id = l.agent_id
     ${where}
     ORDER BY l.created_at DESC
     LIMIT 200`,
    params
  );
  return rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    username: row.username,
    displayName: row.display_name,
    agentId: row.agent_id,
    agentName: row.agent_name,
    selectedModel: row.selected_model,
    usedRetrieval: Boolean(row.used_retrieval),
    totalTokens: Number(row.total_tokens || 0),
    estimatedCost: Number(row.estimated_cost || 0),
    latencyMs: Number(row.latency_ms || 0),
    status: row.status,
    createdAt: Number(row.created_at),
  }));
};

const getDbAgentUsageSummary = async (user) => {
  const rows = await listDbAgentUsage(user);
  return {
    totalCalls: rows.length,
    successCount: rows.filter((row) => row.status === 'success').length,
    failedCount: rows.filter((row) => row.status !== 'success').length,
    activeUsers: new Set(rows.map((row) => row.userId)).size,
    totalEstimatedCost: Number(rows.reduce((sum, row) => sum + row.estimatedCost, 0).toFixed(6)),
  };
};

const aggregateAgentUsageStatsRows = (rows) => {
  const byKey = new Map();
  for (const row of rows) {
    const statDate = new Date(Number(row.createdAt || row.created_at || Date.now())).toISOString().split('T')[0];
    const userId = row.userId || row.user_id;
    const username = row.username;
    const displayName = row.displayName || row.display_name || row.username;
    const key = `${statDate}|${userId}|agent_center`;
    if (!byKey.has(key)) {
      byKey.set(key, {
        statDate,
        userId,
        username,
        displayName,
        module: 'agent_center',
        successCount: 0,
        failedCount: 0,
        interruptedCount: 0,
      });
    }
    const target = byKey.get(key);
    if (row.status === 'success') target.successCount += 1;
    else if (row.status === 'failed') target.failedCount += 1;
    else if (row.status === 'interrupted') target.interruptedCount += 1;
  }
  return Array.from(byKey.values());
};

const getDbJobByIdForUser = async (user, jobId) => {
  const pool = await getMysqlPool();
  const job = await getJobById(pool, jobId);
  if (!job) return null;
  if (user.role !== 'admin' && job.userId !== user.id) return null;
  return job;
};

const incrementLocalUsageStat = (store, log) => {
  if (!USAGE_MODULES.has(log.module) || !TERMINAL_STATUSES.has(log.status) || !USAGE_ACTIONS.has(log.action)) {
    return;
  }

  if (!Array.isArray(store.usageDaily)) {
    store.usageDaily = [];
  }

  const statDate = new Date(log.createdAt).toISOString().split('T')[0];
  let row = store.usageDaily.find((r) => r.statDate === statDate && r.userId === log.userId && r.module === log.module);
  if (!row) {
    row = { statDate, userId: log.userId, username: log.username, displayName: log.displayName, module: log.module, successCount: 0, failedCount: 0, interruptedCount: 0 };
    store.usageDaily.push(row);
  }

  if (log.status === 'success') row.successCount++;
  else if (log.status === 'failed') row.failedCount++;
  else if (log.status === 'interrupted') row.interruptedCount++;
};

const appendLocalLog = (store, payload) => {
  const log = createLogEntry(payload);
  store.logs = normalizeLogs([log, ...(store.logs || [])]);
  incrementLocalUsageStat(store, log);
  return log;
};

const deleteLocalLogs = (store, filters = {}) => {
  const originalCount = Array.isArray(store.logs) ? store.logs.length : 0;
  store.logs = normalizeLogs((store.logs || []).filter((log) => !matchesLogFilters(log, filters)));
  return Math.max(0, originalCount - store.logs.length);
};

const listLocalLogs = (store, filters = {}) => {
  const filtered = normalizeLogs(store.logs).filter((log) => matchesLogFilters(log, filters));
  const { page, pageSize, offset } = normalizeLogPagination(filters);
  return {
    logs: filtered.slice(offset, offset + pageSize),
    total: filtered.length,
    page,
    pageSize,
  };
};

const listLocalLogMeta = (store) => {
  return buildLogFilterOptions(normalizeLogs(store.logs));
};

const listLocalManageableKnowledgeBaseIds = (store, user, ids) =>
  cleanKnowledgeBaseIds(ids).filter((knowledgeBaseId) => {
    const knowledgeBase = (store.knowledgeBases || []).find((item) => item.id === knowledgeBaseId);
    return Boolean(knowledgeBase && knowledgeBase.status === 'active' && canManageOwnedResource(user, knowledgeBase.ownerUserId));
  });

const listLocalVersionKnowledgeBaseIds = (store, versionId) =>
  (store.agentVersionKnowledgeBases || [])
    .filter((item) => item.agentVersionId === versionId)
    .sort((a, b) => Number(a.priority || 0) - Number(b.priority || 0))
    .map((item) => item.knowledgeBaseId);

const syncLocalVersionKnowledgeBases = (store, versionId, knowledgeBaseIds) => {
  store.agentVersionKnowledgeBases = Array.isArray(store.agentVersionKnowledgeBases) ? store.agentVersionKnowledgeBases : [];
  store.agentVersionKnowledgeBases = store.agentVersionKnowledgeBases.filter((item) => item.agentVersionId !== versionId);
  cleanKnowledgeBaseIds(knowledgeBaseIds).forEach((knowledgeBaseId, index) => {
    store.agentVersionKnowledgeBases.push({
      id: createEntityId(),
      agentVersionId: versionId,
      knowledgeBaseId,
      priority: index,
      createdAt: Date.now(),
    });
  });
};

const getLocalAgentById = (store, agentId) => {
  const agent = (store.agents || []).find((item) => item.id === agentId);
  if (!agent) return null;
  const version = getLocalAgentVersionById(store, agent.currentVersionId);
  const knowledgeBaseIds = agent.currentVersionId ? listLocalVersionKnowledgeBaseIds(store, agent.currentVersionId) : [];
  const usageCount7d = (store.agentUsageLogs || []).filter((row) => row.agentId === agentId && row.createdAt >= Date.now() - AGENT_SUMMARY_WINDOW_MS).length;
  const owner = (store.users || []).find((item) => item.id === agent.ownerUserId);
  return {
    ...agent,
    ownerDisplayName: owner?.displayName || owner?.username || '',
    currentVersionNo: version?.versionNo || null,
    defaultModel: version?.modelPolicy?.defaultModel || '',
    allowedChatModels: version?.allowedChatModels || [],
    defaultChatModel: version?.defaultChatModel || version?.modelPolicy?.defaultModel || '',
    imageGenerationEnabled: Boolean(version?.modelPolicy?.imageGenerationEnabled),
    imageModel: version?.modelPolicy?.multimodalModel || '',
    imageMaxInputCount: Number(getImageModelCapability(version?.modelPolicy?.multimodalModel)?.maxInputImages || 1),
    knowledgeBaseCount: knowledgeBaseIds.length,
    usageCount7d,
  };
};

const getLocalAgentVersionById = (store, versionId) => {
  const row = (store.agentVersions || []).find((item) => item.id === versionId);
  if (!row) return null;
  return normalizeAgentVersionRecord({
    id: row.id,
    agent_id: row.agentId,
    version_no: row.versionNo,
    version_name: row.versionName,
    allowed_chat_models_json: stringifyJsonField(row.allowedChatModels || []),
    default_chat_model: row.defaultChatModel || '',
    is_published: row.isPublished,
    system_prompt: row.systemPrompt,
    reply_style_rules_json: stringifyJsonField(row.replyStyleRules),
    model_policy_json: stringifyJsonField(row.modelPolicy),
    context_policy_json: stringifyJsonField(row.contextPolicy),
    retrieval_policy_json: stringifyJsonField(row.retrievalPolicy),
    tool_policy_json: stringifyJsonField(row.toolPolicy),
    validation_status: row.validationStatus,
    validation_summary_json: row.validationSummary ? JSON.stringify(row.validationSummary) : null,
    created_by: row.createdBy,
    created_at: row.createdAt,
  }, listLocalVersionKnowledgeBaseIds(store, versionId));
};

const listLocalAgentVersionsByAgentId = (store, agentId) =>
  (store.agentVersions || [])
    .filter((item) => item.agentId === agentId)
    .sort((a, b) => Number(b.versionNo || 0) - Number(a.versionNo || 0))
    .map((item) => getLocalAgentVersionById(store, item.id))
    .filter(Boolean);

const listLocalAgents = (store, user) =>
  (store.agents || [])
    .filter((item) => isSuperAdminUser(user) || item.ownerUserId === user.id)
    .map((item) => getLocalAgentById(store, item.id))
    .filter(Boolean)
    .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));

const createLocalAgent = (store, user, payload) => {
  const now = Date.now();
  const agentId = createEntityId();
  const version = buildAgentVersionInsertRecord({
    agentId,
    versionNo: 1,
    createdBy: user.id,
    source: {
      systemPrompt: payload.systemPrompt || '',
      replyStyleRules: payload.replyStyleRules || {},
      modelPolicy: payload.modelPolicy || {},
      contextPolicy: payload.contextPolicy || {},
      retrievalPolicy: payload.retrievalPolicy || {},
      toolPolicy: payload.toolPolicy || {},
      knowledgeBaseIds: listLocalManageableKnowledgeBaseIds(store, user, payload.knowledgeBaseIds || []),
    },
  });
  store.agents.push({
    id: agentId,
    name: String(payload.name || '未命名智能体').slice(0, 120),
    description: String(payload.description || '').slice(0, 5000),
    department: String(payload.department || '未分组').slice(0, 120),
    iconUrl: payload.iconUrl ? String(payload.iconUrl).slice(0, 1024) : '',
    avatarPreset: payload.avatarPreset ? String(payload.avatarPreset).slice(0, 40) : '',
    ownerUserId: user.id,
    visibilityScope: AGENT_VISIBILITY_SCOPE,
    status: 'draft',
    currentVersionId: null,
    createdAt: now,
    updatedAt: now,
  });
  store.agentVersions.push({
    id: version.id,
    agentId,
    versionNo: version.versionNo,
    versionName: version.versionName,
    allowedChatModels: version.allowedChatModels,
    defaultChatModel: version.defaultChatModel || '',
    isPublished: false,
    systemPrompt: version.systemPrompt,
    replyStyleRules: parseJsonField(version.replyStyleRulesJson, {}),
    modelPolicy: parseJsonField(version.modelPolicyJson, {}),
    contextPolicy: parseJsonField(version.contextPolicyJson, {}),
    retrievalPolicy: parseJsonField(version.retrievalPolicyJson, {}),
    toolPolicy: parseJsonField(version.toolPolicyJson, {}),
    validationStatus: 'pending',
    validationSummary: null,
    createdBy: user.id,
    createdAt: now,
  });
  syncLocalVersionKnowledgeBases(store, version.id, version.knowledgeBaseIds);
  return {
    agent: getLocalAgentById(store, agentId),
    version: getLocalAgentVersionById(store, version.id),
  };
};

const updateLocalAgent = (store, user, agentId, payload) => {
  const agent = (store.agents || []).find((item) => item.id === agentId);
  if (!agent || !canManageOwnedResource(user, agent.ownerUserId)) return null;
  if (typeof payload.name === 'string') agent.name = payload.name.slice(0, 120);
  if (typeof payload.description === 'string') agent.description = payload.description.slice(0, 5000);
  if (typeof payload.department === 'string') agent.department = payload.department.slice(0, 120);
  if (payload.iconUrl === null) agent.iconUrl = '';
  else if (typeof payload.iconUrl === 'string') agent.iconUrl = payload.iconUrl.slice(0, 1024);
  if (payload.avatarPreset === null) agent.avatarPreset = '';
  else if (typeof payload.avatarPreset === 'string') agent.avatarPreset = payload.avatarPreset.slice(0, 40);
  if (payload.status) agent.status = normalizeAgentStatus(payload.status);
  agent.updatedAt = Date.now();
  return getLocalAgentById(store, agentId);
};

const deleteLocalAgentVersion = (store, user, versionId) => {
  const version = getLocalAgentVersionById(store, versionId);
  if (!version || version.isPublished) return null;
  const agent = getLocalAgentById(store, version.agentId);
  if (!agent || !canManageOwnedResource(user, agent.ownerUserId)) return null;

  store.agentVersions = (store.agentVersions || []).filter((item) => item.id !== versionId);
  store.agentVersionKnowledgeBases = (store.agentVersionKnowledgeBases || []).filter((item) => item.agentVersionId !== versionId);
  const rawAgent = (store.agents || []).find((item) => item.id === agent.id);
  if (rawAgent) rawAgent.updatedAt = Date.now();
  return { ok: true, deletedVersionId: versionId };
};

const deleteLocalAgent = (store, user, agentId) => {
  const agent = getLocalAgentById(store, agentId);
  if (!agent || !canManageOwnedResource(user, agent.ownerUserId)) return null;

  const versionIds = new Set((store.agentVersions || []).filter((item) => item.agentId === agentId).map((item) => item.id));
  const sessionIds = new Set((store.chatSessions || []).filter((item) => item.agentId === agentId).map((item) => item.id));
  store.agentVersionKnowledgeBases = (store.agentVersionKnowledgeBases || []).filter((item) => !versionIds.has(item.agentVersionId));
  store.agentVersions = (store.agentVersions || []).filter((item) => item.agentId !== agentId);
  store.chatMessages = (store.chatMessages || []).filter((item) => !sessionIds.has(item.sessionId));
  store.chatSessions = (store.chatSessions || []).filter((item) => item.agentId !== agentId);
  store.agentUsageLogs = (store.agentUsageLogs || []).filter((item) => item.agentId !== agentId);
  store.agents = (store.agents || []).filter((item) => item.id !== agentId);
  return { ok: true, deletedAgentId: agentId };
};

const deleteLocalUserAgentHistory = (store, user, agentId) => {
  const agent = getLocalAgentById(store, agentId);
  if (!agent || agent.status !== 'published') return null;
  const deletedSessionIds = new Set(
    (store.chatSessions || [])
      .filter((item) => item.userId === user.id && item.agentId === agentId)
      .map((item) => item.id)
  );
  const deletedSessionCount = deletedSessionIds.size;
  const originalMessageCount = (store.chatMessages || []).length;
  const originalUsageCount = (store.agentUsageLogs || []).length;
  store.chatMessages = (store.chatMessages || []).filter((item) => !(item.userId === user.id && deletedSessionIds.has(item.sessionId)));
  store.chatSessions = (store.chatSessions || []).filter((item) => !(item.userId === user.id && item.agentId === agentId));
  store.agentUsageLogs = (store.agentUsageLogs || []).filter((item) => !(item.userId === user.id && item.agentId === agentId));
  return {
    ok: true,
    deletedSessionCount,
    deletedMessageCount: originalMessageCount - store.chatMessages.length,
    deletedUsageCount: originalUsageCount - store.agentUsageLogs.length,
  };
};

const createLocalAgentDraft = (store, user, agentId) => {
  const agent = (store.agents || []).find((item) => item.id === agentId);
  if (!agent || !canManageOwnedResource(user, agent.ownerUserId)) return null;
  const versions = listLocalAgentVersionsByAgentId(store, agentId);
  const source = versions[0] || null;
  const next = buildAgentVersionInsertRecord({
    agentId,
    versionNo: Math.max(0, ...versions.map((item) => item.versionNo)) + 1,
    createdBy: user.id,
    source,
  });
  store.agentVersions.push({
    id: next.id,
    agentId,
    versionNo: next.versionNo,
    versionName: next.versionName,
    allowedChatModels: next.allowedChatModels,
    defaultChatModel: next.defaultChatModel || '',
    isPublished: false,
    systemPrompt: next.systemPrompt,
    replyStyleRules: parseJsonField(next.replyStyleRulesJson, {}),
    modelPolicy: parseJsonField(next.modelPolicyJson, {}),
    contextPolicy: parseJsonField(next.contextPolicyJson, {}),
    retrievalPolicy: parseJsonField(next.retrievalPolicyJson, {}),
    toolPolicy: parseJsonField(next.toolPolicyJson, {}),
    validationStatus: 'pending',
    validationSummary: null,
    createdBy: user.id,
    createdAt: next.createdAt,
  });
  syncLocalVersionKnowledgeBases(store, next.id, next.knowledgeBaseIds);
  agent.updatedAt = Date.now();
  return getLocalAgentVersionById(store, next.id);
};

const updateLocalAgentVersion = (store, user, versionId, payload) => {
  const row = (store.agentVersions || []).find((item) => item.id === versionId);
  if (!row || row.isPublished) return null;
  const agent = (store.agents || []).find((item) => item.id === row.agentId);
  if (!agent || !canManageOwnedResource(user, agent.ownerUserId)) return null;
  const current = getLocalAgentVersionById(store, versionId);
  const config = normalizeAgentConfig({
    systemPrompt: payload.systemPrompt ?? current.systemPrompt,
    replyStyleRules: payload.replyStyleRules ?? current.replyStyleRules,
    modelPolicy: payload.modelPolicy ?? current.modelPolicy,
    contextPolicy: payload.contextPolicy ?? current.contextPolicy,
    retrievalPolicy: payload.retrievalPolicy ?? current.retrievalPolicy,
    toolPolicy: payload.toolPolicy ?? current.toolPolicy,
  });
  const nextAllowedChatModels = sanitizeAllowedChatModels(
    Array.isArray(payload.allowedChatModels) ? payload.allowedChatModels : current.allowedChatModels,
    [payload.defaultChatModel, current.defaultChatModel, config.modelPolicy.defaultModel, config.modelPolicy.cheapModel]
  );
  const nextModelPolicy = sanitizeModelPolicy(config.modelPolicy, nextAllowedChatModels);
  row.systemPrompt = config.systemPrompt;
  row.versionName = normalizeVersionName(payload.versionName, current.versionNo, current.createdAt);
  row.allowedChatModels = nextAllowedChatModels;
  row.defaultChatModel = nextAllowedChatModels.includes(String(payload.defaultChatModel || '').trim())
    ? String(payload.defaultChatModel).trim()
    : nextModelPolicy.defaultModel || '';
  row.replyStyleRules = config.replyStyleRules;
  row.modelPolicy = nextModelPolicy;
  row.contextPolicy = config.contextPolicy;
  row.retrievalPolicy = config.retrievalPolicy;
  row.toolPolicy = config.toolPolicy;
  row.validationStatus = 'pending';
  row.validationSummary = null;
  syncLocalVersionKnowledgeBases(store, versionId, listLocalManageableKnowledgeBaseIds(store, user, payload.knowledgeBaseIds ?? current.knowledgeBaseIds));
  agent.updatedAt = Date.now();
  return getLocalAgentVersionById(store, versionId);
};

const listLocalKnowledgeBases = (store, user) =>
  (store.knowledgeBases || [])
    .filter((item) => isSuperAdminUser(user) || item.ownerUserId === user.id)
    .map((item) => {
      const owner = (store.users || []).find((userItem) => userItem.id === item.ownerUserId);
      return {
        ...item,
        ownerDisplayName: owner?.displayName || owner?.username || '',
        documentCount: (store.knowledgeDocuments || []).filter((doc) => doc.knowledgeBaseId === item.id).length,
        boundAgentCount: new Set((store.agentVersionKnowledgeBases || []).filter((row) => row.knowledgeBaseId === item.id).map((row) => row.agentVersionId)).size,
      };
    })
    .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));

const getLocalKnowledgeBaseById = (store, knowledgeBaseId) => {
  const item = (store.knowledgeBases || []).find((row) => row.id === knowledgeBaseId);
  if (!item) return null;
  const owner = (store.users || []).find((userItem) => userItem.id === item.ownerUserId);
  return {
    ...item,
    ownerDisplayName: owner?.displayName || owner?.username || '',
    documentCount: (store.knowledgeDocuments || []).filter((doc) => doc.knowledgeBaseId === item.id).length,
    boundAgentCount: new Set((store.agentVersionKnowledgeBases || []).filter((row) => row.knowledgeBaseId === item.id).map((row) => row.agentVersionId)).size,
  };
};

const createLocalKnowledgeBase = (store, user, payload) => {
  const item = {
    id: createEntityId(),
    name: String(payload.name || '未命名知识库').slice(0, 120),
    description: String(payload.description || '').slice(0, 5000),
    department: String(payload.department || '未分组').slice(0, 120),
    ownerUserId: user.id,
    status: 'active',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  store.knowledgeBases.push(item);
  return listLocalKnowledgeBases(store, user).find((row) => row.id === item.id) || null;
};

const updateLocalKnowledgeBase = (store, user, knowledgeBaseId, payload) => {
  const item = (store.knowledgeBases || []).find((row) => row.id === knowledgeBaseId);
  if (!item || !canManageOwnedResource(user, item.ownerUserId)) return null;
  if (typeof payload.name === 'string') item.name = payload.name.slice(0, 120);
  if (typeof payload.description === 'string') item.description = payload.description.slice(0, 5000);
  if (typeof payload.department === 'string') item.department = payload.department.slice(0, 120);
  if (payload.status) item.status = normalizeKnowledgeBaseStatus(payload.status);
  item.updatedAt = Date.now();
  return listLocalKnowledgeBases(store, user).find((row) => row.id === knowledgeBaseId) || null;
};

const deleteLocalKnowledgeBase = (store, user, knowledgeBaseId) => {
  const itemIndex = (store.knowledgeBases || []).findIndex((row) => row.id === knowledgeBaseId);
  if (itemIndex < 0) return 0;
  const item = store.knowledgeBases[itemIndex];
  if (!canManageOwnedResource(user, item.ownerUserId)) return 0;
  store.knowledgeBases.splice(itemIndex, 1);
  store.knowledgeDocuments = (store.knowledgeDocuments || []).filter((row) => row.knowledgeBaseId !== knowledgeBaseId);
  store.knowledgeChunks = (store.knowledgeChunks || []).filter((row) => row.knowledgeBaseId !== knowledgeBaseId);
  store.agentVersionKnowledgeBases = (store.agentVersionKnowledgeBases || []).filter((row) => row.knowledgeBaseId !== knowledgeBaseId);
  return 1;
};

const listLocalKnowledgeDocuments = (store, user, knowledgeBaseId) => {
  const knowledgeBase = (store.knowledgeBases || []).find((item) => item.id === knowledgeBaseId);
  if (!knowledgeBase || !canManageOwnedResource(user, knowledgeBase.ownerUserId)) return [];
  return (store.knowledgeDocuments || [])
    .filter((item) => item.knowledgeBaseId === knowledgeBaseId)
    .map((item) => ({
      ...item,
      chunkStrategy: normalizeKnowledgeChunkStrategyValue(item.chunkStrategy),
      normalizationEnabled: Boolean(item.normalizationEnabled),
      normalizedText: String(item.normalizedText || ''),
      normalizationError: String(item.normalizationError || ''),
      normalizedStatus: normalizeKnowledgeNormalizedStatus(item.normalizedStatus),
      chunkSource: normalizeKnowledgeChunkSource(item.chunkSource),
    }))
    .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
};

const createLocalKnowledgeDocument = (store, user, payload) => {
  const knowledgeBase = (store.knowledgeBases || []).find((item) => item.id === payload.knowledgeBaseId);
  if (!knowledgeBase || !canManageOwnedResource(user, knowledgeBase.ownerUserId)) return null;
  const rawText = String(payload.rawText || '').trim();
  const chunkStrategy = normalizeKnowledgeChunkStrategyValue(payload.chunkStrategy);
  const normalizationEnabled = Boolean(payload.normalizationEnabled);
  const systemSettings = getLocalSystemSettings(store);
  const normalizationResult = normalizationEnabled
    ? { normalizedText: '', normalizedStatus: 'failed', chunkSource: 'raw', normalizationError: `本地 JSON 模式不执行 AI 规范整理，请切到服务端模式；当前将按 ${resolveConfiguredAnalysisModel(systemSettings) || '自动模型'} 的规则回退为原文切片。` }
    : { normalizedText: '', normalizedStatus: 'idle', chunkSource: 'raw', normalizationError: '' };
  const chunkText = normalizationResult.chunkSource === 'normalized' ? normalizationResult.normalizedText : rawText;
  const chunks = chunkKnowledgeText(chunkText, { strategy: chunkStrategy });
  const documentId = createEntityId();
  const now = Date.now();
  const document = {
    id: documentId,
    knowledgeBaseId: knowledgeBase.id,
    title: String(payload.title || '未命名文档').slice(0, 255),
    sourceType: normalizeSourceType(payload.sourceType),
    chunkStrategy,
    rawText,
    normalizationEnabled,
    normalizedText: normalizationResult.normalizedText,
    normalizationError: normalizationResult.normalizationError,
    normalizedStatus: normalizationResult.normalizedStatus,
    chunkSource: normalizationResult.chunkSource,
    parseStatus: 'parsed',
    chunkCount: chunks.length,
    createdBy: user.id,
    createdAt: now,
    updatedAt: now,
  };
  store.knowledgeDocuments.push(document);
  chunks.forEach((content, index) => {
    store.knowledgeChunks.push({
      id: createEntityId(),
      documentId,
      knowledgeBaseId: knowledgeBase.id,
      chunkIndex: index,
      sourceType: document.sourceType,
      content,
      tokenEstimate: estimateTokenCount(content),
      documentTitle: document.title,
      createdAt: now,
    });
  });
  knowledgeBase.updatedAt = now;
  if (normalizationEnabled && normalizationResult.normalizedStatus === 'failed') {
    appendLocalLog(store, {
      user,
      level: 'error',
      module: 'agent_center',
      action: 'knowledge_normalization_failed',
      message: `知识库文档整理失败：${document.title.slice(0, 60)}`,
      detail: normalizationResult.normalizationError || 'AI 规范整理失败，已回退原文切片。',
      status: 'failed',
      meta: { knowledgeBaseId: knowledgeBase.id, documentId, chunkStrategy },
    });
  }
  return document;
};

const updateLocalKnowledgeDocument = (store, user, documentId, payload) => {
  const document = (store.knowledgeDocuments || []).find((item) => item.id === documentId);
  if (!document) return null;
  const knowledgeBase = (store.knowledgeBases || []).find((item) => item.id === document.knowledgeBaseId);
  if (!knowledgeBase || !canManageOwnedResource(user, knowledgeBase.ownerUserId)) return null;
  const rawText = typeof payload.rawText === 'string' ? String(payload.rawText).trim() : String(document.rawText || '');
  const title = typeof payload.title === 'string' ? String(payload.title).slice(0, 255) : String(document.title || '未命名文档');
  const sourceType = typeof payload.sourceType === 'string' ? normalizeSourceType(payload.sourceType) : normalizeSourceType(document.sourceType);
  const chunkStrategy = payload.chunkStrategy === undefined ? normalizeKnowledgeChunkStrategyValue(document.chunkStrategy) : normalizeKnowledgeChunkStrategyValue(payload.chunkStrategy);
  const normalizationEnabled = payload.normalizationEnabled === undefined ? Boolean(document.normalizationEnabled) : Boolean(payload.normalizationEnabled);
  const systemSettings = getLocalSystemSettings(store);
  const normalizationResult = normalizationEnabled
    ? { normalizedText: '', normalizedStatus: 'failed', chunkSource: 'raw', normalizationError: `本地 JSON 模式不执行 AI 规范整理，请切到服务端模式；当前将按 ${resolveConfiguredAnalysisModel(systemSettings) || '自动模型'} 的规则回退为原文切片。` }
    : { normalizedText: '', normalizedStatus: 'idle', chunkSource: 'raw', normalizationError: '' };
  const chunkText = normalizationResult.chunkSource === 'normalized' ? normalizationResult.normalizedText : rawText;
  const chunks = chunkKnowledgeText(chunkText, { strategy: chunkStrategy });
  const now = Date.now();
  document.title = title;
  document.sourceType = sourceType;
  document.chunkStrategy = chunkStrategy;
  document.rawText = rawText;
  document.normalizationEnabled = normalizationEnabled;
  document.normalizedText = normalizationResult.normalizedText;
  document.normalizationError = normalizationResult.normalizationError;
  document.normalizedStatus = normalizationResult.normalizedStatus;
  document.chunkSource = normalizationResult.chunkSource;
  document.parseStatus = 'parsed';
  document.chunkCount = chunks.length;
  document.updatedAt = now;
  store.knowledgeChunks = (store.knowledgeChunks || []).filter((item) => item.documentId !== documentId);
  chunks.forEach((content, index) => {
    store.knowledgeChunks.push({
      id: createEntityId(),
      documentId,
      knowledgeBaseId: knowledgeBase.id,
      chunkIndex: index,
      sourceType,
      content,
      tokenEstimate: estimateTokenCount(content),
      documentTitle: title,
      createdAt: now,
    });
  });
  knowledgeBase.updatedAt = now;
  if (normalizationEnabled && normalizationResult.normalizedStatus === 'failed') {
    appendLocalLog(store, {
      user,
      level: 'error',
      module: 'agent_center',
      action: 'knowledge_normalization_failed',
      message: `知识库文档整理失败：${title.slice(0, 60)}`,
      detail: normalizationResult.normalizationError || 'AI 规范整理失败，已回退原文切片。',
      status: 'failed',
      meta: { knowledgeBaseId: knowledgeBase.id, documentId, chunkStrategy },
    });
  }
  return document;
};

const deleteLocalKnowledgeDocument = (store, user, documentId) => {
  const documentIndex = (store.knowledgeDocuments || []).findIndex((item) => item.id === documentId);
  if (documentIndex < 0) return 0;
  const document = store.knowledgeDocuments[documentIndex];
  const knowledgeBase = (store.knowledgeBases || []).find((item) => item.id === document.knowledgeBaseId);
  if (!knowledgeBase || !canManageOwnedResource(user, knowledgeBase.ownerUserId)) return 0;
  store.knowledgeDocuments.splice(documentIndex, 1);
  store.knowledgeChunks = (store.knowledgeChunks || []).filter((item) => item.documentId !== documentId);
  knowledgeBase.updatedAt = Date.now();
  return 1;
};

const listLocalKnowledgeChunksForVersion = (store, version) =>
  (store.knowledgeChunks || []).filter((item) => cleanKnowledgeBaseIds(version?.knowledgeBaseIds).includes(item.knowledgeBaseId));

const runLocalAgentConversation = async ({
  store,
  user,
  agent,
  version,
  priorMessages,
  currentMessage,
  sessionId = null,
  selectedModelOverride = '',
  attachments = [],
  reasoningLevel = null,
  webSearchEnabled = false,
}) => {
  const shouldRetrieve = shouldUseKnowledgeRetrieval(currentMessage, version.retrievalPolicy, version.knowledgeBaseIds);
  const candidateChunks = shouldRetrieve ? listLocalKnowledgeChunksForVersion(store, version) : [];
  const knowledgeChunks = shouldRetrieve ? searchKnowledgeChunks(candidateChunks, currentMessage, version.retrievalPolicy) : [];
  const allPrior = Array.isArray(priorMessages) ? priorMessages : [];
  const maxRounds = Number(version.contextPolicy.maxHistoryRounds || 6);
  const summaryThreshold = Number(version.contextPolicy.summaryTriggerThreshold || 10);
  const recentCount = maxRounds * 2;
  let summary = '';
  let recentSlice = allPrior;
  if (allPrior.length > summaryThreshold * 2) {
    const olderMessages = allPrior.slice(0, -recentCount);
    summary = buildConversationSummary(olderMessages, Number(version.contextPolicy.maxSummaryChars || 1200));
    recentSlice = allPrior.slice(-recentCount);
  } else {
    recentSlice = allPrior.slice(-recentCount);
  }
  const recentMessages = recentSlice.map((message) => ({
    role: message.role,
    content: Array.isArray(message.attachments) && message.attachments.length > 0
      ? buildChatMessageContent(message.content, message.attachments)
      : message.content,
  }));
  const messages = buildAgentPromptMessages({
    systemPrompt: version.systemPrompt,
    summary,
    recentMessages,
    knowledgeChunks,
    userMessage: currentMessage,
  });
  if (messages.length > 0) {
    messages[messages.length - 1] = {
      ...messages[messages.length - 1],
      content: buildChatMessageContent(currentMessage, attachments),
    };
  }
  const selectedModel = String(selectedModelOverride || (knowledgeChunks.length > 0 ? version.modelPolicy.defaultModel : version.modelPolicy.cheapModel) || '').trim();
  const startedAt = Date.now();
  const output = await executeProviderJob({
    taskType: 'kie_chat',
    payload: {
      messages,
      model: selectedModel,
      reasoningLevel: reasoningLevel ? String(reasoningLevel) : null,
      webSearchEnabled: Boolean(webSearchEnabled),
    },
  }, process.env, new AbortController().signal);
  const content = String(output?.result?.content || '').trim();
  const promptTokens = messages.reduce((sum, message) => sum + estimateTokenCount(message.content), 0);
  const completionTokens = estimateTokenCount(content);
  return {
    content,
    selectedModel,
    usedRetrieval: knowledgeChunks.length > 0,
    knowledgeChunks,
    retrievalSummary: knowledgeChunks.map((chunk) => ({ documentTitle: chunk.documentTitle, sourceType: chunk.sourceType, preview: String(chunk.content || '').slice(0, 120) })),
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
    latencyMs: Date.now() - startedAt,
    estimatedCost: estimateCostByTokens(promptTokens, completionTokens),
    sessionId,
    userId: user.id,
    agentId: agent.id,
  };
};

const extractJsonObject = (value) => {
  const source = String(value || '').trim();
  if (!source) return null;
  const fencedMatch = source.match(/```json\s*([\s\S]*?)```/i) || source.match(/```\s*([\s\S]*?)```/i);
  const candidate = fencedMatch?.[1] || source;
  const startIndex = candidate.indexOf('{');
  const endIndex = candidate.lastIndexOf('}');
  if (startIndex < 0 || endIndex <= startIndex) return null;
  try {
    return JSON.parse(candidate.slice(startIndex, endIndex + 1));
  } catch {
    return null;
  }
};

const buildConversationImageCatalog = (attachments = [], priorMessages = [], maxReferenceImages = 10) => {
  const catalog = [];
  const seenUrls = new Set();
  const pushImage = (item) => {
    const url = String(item?.url || '').trim();
    if (!url || seenUrls.has(url)) return;
    seenUrls.add(url);
    catalog.push({
      index: catalog.length + 1,
      label: `图${catalog.length + 1}`,
      name: String(item?.name || `图${catalog.length + 1}`),
      url,
      mimeType: item?.mimeType ? String(item.mimeType) : undefined,
      source: item?.source || 'history_attachment',
    });
  };

  (Array.isArray(attachments) ? attachments : [])
    .filter((item) => item?.kind === 'image' && item?.url)
    .forEach((item) => pushImage({
      name: item.name,
      url: item.url,
      mimeType: item.mimeType,
      source: 'current_upload',
    }));

  (Array.isArray(priorMessages) ? priorMessages : []).forEach((message) => {
    if (catalog.length >= maxReferenceImages) return;
    if (message?.role === 'user' && Array.isArray(message?.attachments)) {
      message.attachments
        .filter((item) => item?.kind === 'image' && item?.url)
        .forEach((item) => pushImage({
          name: item.name || '历史上传图',
          url: item.url,
          mimeType: item.mimeType,
          source: 'history_attachment',
        }));
    }
    const resultUrls = Array.isArray(message?.metadata?.imageResultUrls)
      ? message.metadata.imageResultUrls.map((item) => String(item || '').trim()).filter(Boolean)
      : [];
    resultUrls.forEach((url, index) => pushImage({
      name: `历史生成图${index + 1}`,
      url,
      source: 'previous_result',
    }));
    if (message?.role === 'assistant' && Array.isArray(message?.attachments)) {
      message.attachments
        .filter((item) => item?.kind === 'image' && item?.url)
        .forEach((item, index) => pushImage({
          name: item.name || `历史生成图${index + 1}`,
          url: item.url,
          mimeType: item.mimeType,
          source: 'previous_result',
        }));
    }
  });

  return catalog.slice(0, maxReferenceImages).map((item, index) => ({
    ...item,
    index: index + 1,
    label: `图${index + 1}`,
  }));
};

const buildImageConversationTextContext = (priorMessages = [], maxRounds = 6, summary = '') => {
  const scopedMessages = (Array.isArray(priorMessages) ? priorMessages : [])
    .filter((message) => message?.role === 'user' || message?.role === 'assistant')
    .slice(-Math.max(2, Number(maxRounds || 6) * 2));

  const lines = scopedMessages.map((message) => {
    const roleLabel = message.role === 'assistant' ? '助手' : '用户';
    const requestMode = String(message?.metadata?.requestMode || '').trim();
    const modeLabel = requestMode === 'image_generation' ? '生图' : '对话';
    const content = String(message?.content || '').trim();
    if (!content) return '';
    return `${roleLabel}（${modeLabel}）：${content}`;
  }).filter(Boolean);

  return {
    summary: String(summary || '').trim(),
    recentText: lines.join('\n'),
  };
};

const buildImageEditPreferenceHints = ({ userMessage = '', imageReferences = [] }) => {
  const text = String(userMessage || '').trim();
  const refs = Array.isArray(imageReferences) ? imageReferences : [];
  const previousResults = refs.filter((item) => item?.source === 'previous_result' && item?.url);
  const currentUploads = refs.filter((item) => item?.source === 'current_upload' && item?.url);
  const hasPreviousResult = previousResults.length > 0;
  const hasCurrentUpload = currentUploads.length > 0;
  const iterativeEditIntent = /(继续|调整|优化|修改|改一下|改成|不满意|上一张|上一版|刚才|基于|沿用)/.test(text);
  const layoutStyleIntent = /(参考|参照|按这个|像这个|版式|排版|布局|框架|结构|风格|样式|色调)/.test(text);
  const replaceSubjectIntent = /(换成|替换成|改成同款|主体换成|内容换成|商品换成)/.test(text);
  const preferPreviousResultAsPrimary = hasPreviousResult && hasCurrentUpload && !replaceSubjectIntent && (iterativeEditIntent || layoutStyleIntent);
  return {
    preferPreviousResultAsPrimary,
    previousResultUrls: previousResults.map((item) => String(item.url || '').trim()).filter(Boolean),
    currentUploadUrls: currentUploads.map((item) => String(item.url || '').trim()).filter(Boolean),
  };
};

const buildImageGenerationAnalysisMessages = ({ agent, version, userMessage, imageReferences = [], selectedImageModel, maxInputImages, knowledgeChunks = [], conversationSummary = '', recentConversationText = '', editPreferenceHints = null }) => {
  const refsText = imageReferences.length > 0
    ? imageReferences.map((item) => `${item.label}：${item.name}，来源=${item.source}，URL=${item.url}`).join('\n')
    : '本轮没有上传参考图。';
  const knowledgeText = Array.isArray(knowledgeChunks) && knowledgeChunks.length > 0
    ? knowledgeChunks.map((item, index) => `规则${index + 1}（${item.documentTitle || item.sourceType || '知识片段'}）：${String(item.content || '').trim()}`).join('\n\n')
    : '';
  const conversationText = recentConversationText ? `最近对话上下文：\n${recentConversationText}` : '';
  const summaryText = conversationSummary ? `会话摘要：\n${conversationSummary}` : '';
  return [
    {
      role: 'system',
      content: [
        version.systemPrompt || `你是${agent.name}的图像生成策划助手。`,
        '你的任务是把用户需求整理成严格可执行的生图参数 JSON。',
        `当前生图模型：${selectedImageModel}。`,
        `最多允许输入图片数量：${maxInputImages}。`,
        '图片引用规则：你会拿到当前会话可用的参考图目录，必须严格按目录中的图1、图2、图3……理解，不得自行改号。',
        '若本轮有新上传图，新上传图会优先排在前面；其后才是历史上传图、历史生成图。',
        '如果用户说“把图1的xx换到图2”“参考图3色调”，必须在 imageReferences、inputImageUrls 和 reasoningSummary 里明确对应关系。',
        '如果用户没有明确指定使用哪张图，你要根据当前需求自动判断最合适的参考图，并在 reasoningSummary 里说明最终采用了哪些图。',
        '你必须结合最近几轮对话来理解“继续调整”“按上一版修改”“保持刚才风格”这类指代，不要只看当前一句话。',
        '比例规则：默认 size 必须为 auto。只有用户明确指定了目标比例，或者明确表达“当前比例不对、需要改成长图/横图/方图”等比例修正诉求时，才允许修改 size。',
        '如果用户没有提比例，就算你能从图片里看出比例，也不要擅自把 size 改成 1:1、4:5、16:9 等固定比例。',
        editPreferenceHints?.preferPreviousResultAsPrimary
          ? '当前场景是继续调整上一张生成图，并参考本轮新上传图的版式/风格。你必须优先把最近一张历史生成图作为主编辑对象，把本轮新上传图作为版式/风格参考。不得因为上传了新的参考图，就直接把新图当成新的主体内容来源，除非用户明确要求替换主体。'
          : '',
        knowledgeText ? '下面会提供与当前生图任务相关的知识库规则。你必须优先遵守这些规则；若用户需求与规则冲突，按规则执行，并在 reasoningSummary 里说明。' : '',
        '只输出 JSON，不要输出解释文字。',
        'JSON 字段必须包含：taskType, selectedImageModel, size, transparentBackground, inputImageUrls, imageReferences, prompt, reasoningSummary。',
      ].filter(Boolean).join('\n'),
    },
    ...(summaryText ? [{ role: 'system', content: summaryText }] : []),
    ...(conversationText ? [{ role: 'system', content: conversationText }] : []),
    ...(knowledgeText ? [{ role: 'system', content: `知识库参考：\n${knowledgeText}` }] : []),
    {
      role: 'user',
      content: `用户需求：${userMessage}\n\n图片输入：\n${refsText}`,
    },
  ];
};

const detectExplicitAspectRatioInstruction = (text = '') => /(?:^|[^\d])(1:1|3:4|4:3|4:5|9:16|16:9)(?:$|[^\d])|正方形|方图|竖图|横图|长图|比例改成|做成.*比例|尺寸改成/.test(String(text || ''));

const hasAspectRatioCorrectionIntent = (text = '') => /比例.*(不对|不太对|不合适|有问题|改一下|调整一下)|尺寸.*(不对|不太对|不合适|有问题)|改比例|调比例/.test(String(text || ''));

const buildImageConversationResult = async ({ user, agent, version, priorMessages, currentMessage, sessionId = null, selectedModelOverride = '', attachments = [], systemSettings = {}, knowledgeChunks = [], conversationSummary = '' }) => {
  const imageCapability = getImageModelCapability(version?.modelPolicy?.multimodalModel);
  const selectedImageModel = String(version?.modelPolicy?.multimodalModel || '').trim();
  if (!version?.modelPolicy?.imageGenerationEnabled || !selectedImageModel || !imageCapability) {
    throw new Error('当前智能体未启用生图模型');
  }
  const imageReferences = buildConversationImageCatalog(
    attachments,
    priorMessages,
    Math.max(Number(imageCapability.maxInputImages || 1), 10)
  );
  const conversationContext = buildImageConversationTextContext(
    priorMessages,
    Number(version?.contextPolicy?.maxHistoryRounds || 6),
    conversationSummary
  );
  const editPreferenceHints = buildImageEditPreferenceHints({
    userMessage: currentMessage,
    imageReferences,
  });
  const analysisMessages = buildImageGenerationAnalysisMessages({
    agent,
    version,
    userMessage: currentMessage,
    imageReferences,
    selectedImageModel,
    maxInputImages: Number(imageCapability.maxInputImages || 1),
    knowledgeChunks,
    conversationSummary: conversationContext.summary,
    recentConversationText: conversationContext.recentText,
    editPreferenceHints,
  });
  const analysisModel = resolveConfiguredAnalysisModel(
    systemSettings,
    selectedModelOverride,
    version.defaultChatModel,
    version.modelPolicy.defaultModel,
    version.modelPolicy.cheapModel
  );
  const startedAt = Date.now();
  const analysisOutput = await executeProviderJob({ taskType: 'kie_chat', payload: { messages: analysisMessages, model: analysisModel } }, process.env, new AbortController().signal);
  const analysisContent = String(analysisOutput?.result?.content || '').trim();
  const parsed = extractJsonObject(analysisContent) || {};
  const normalizedRefs = imageReferences.map((item) => ({
    index: item.index,
    label: item.label,
    name: item.name,
    url: item.url,
    mimeType: item.mimeType,
    source: item.source,
    role: Array.isArray(parsed.imageReferences)
      ? String(parsed.imageReferences.find((ref) => Number(ref?.index || 0) === item.index)?.role || '')
      : '',
  }));
  const inputImageUrls = Array.from(
    new Set(
      (Array.isArray(parsed.inputImageUrls) ? parsed.inputImageUrls : normalizedRefs.map((item) => item.url))
        .map((item) => String(item || '').trim())
        .filter(Boolean)
    )
  ).slice(0, Number(imageCapability.maxInputImages || 1));
  const preferredInputImageUrls = editPreferenceHints.preferPreviousResultAsPrimary
    ? Array.from(new Set([
      ...editPreferenceHints.previousResultUrls.slice(-1),
      ...editPreferenceHints.currentUploadUrls,
      ...inputImageUrls,
    ])).slice(0, Number(imageCapability.maxInputImages || 1))
    : inputImageUrls;
  const promptPrefix = editPreferenceHints.preferPreviousResultAsPrimary
    ? '以最近一张历史生成图为主编辑对象，保留主体内容连续性；其余输入图仅作为版式、排版、风格参考，不替换主体商品。\n'
    : '';
  const finalPrompt = `${promptPrefix}${String(parsed.prompt || currentMessage).trim()}`.trim();
  const requestedAspectRatio = String(parsed.size || '').trim();
  const hasExplicitAspectRatioInstruction = detectExplicitAspectRatioInstruction(currentMessage);
  const shouldKeepAutoAspectRatio = !hasExplicitAspectRatioInstruction && !hasAspectRatioCorrectionIntent(currentMessage);
  const normalizedAspectRatio = shouldKeepAutoAspectRatio
    ? 'auto'
    : (imageCapability.supportedSizes || []).includes(requestedAspectRatio)
      ? requestedAspectRatio
      : (imageCapability.defaultSize || 'auto');
  const normalizedResolution = String(imageCapability.defaultResolution || '1K').trim() || '1K';
  const imageOutput = await executeProviderJob({
    taskType: 'kie_image',
    payload: {
      imageUrls: preferredInputImageUrls,
      prompt: finalPrompt,
      model: selectedImageModel,
      aspectRatio: normalizedAspectRatio,
      resolution: normalizedResolution,
    },
  }, process.env, new AbortController().signal);
  const imageUrl = String(imageOutput?.result?.imageUrl || '').trim();
  const promptTokens = analysisMessages.reduce((sum, message) => sum + estimateTokenCount(message.content), 0);
  const completionTokens = estimateTokenCount(analysisContent);
  const content = [
    '已根据你的需求完成生图。',
    `模型：${selectedImageModel}`,
    normalizedRefs.length > 0 ? `输入图片：${normalizedRefs.map((item) => `${item.label}${item.role ? `(${item.role})` : ''}`).join('、')}` : '输入图片：无',
    `参数摘要：${String(parsed.reasoningSummary || '已按当前需求自动整理图片关系、构图与风格要求。')}`,
    `Prompt：${finalPrompt}`,
  ].join('\n');
  return {
    content,
    selectedModel: selectedImageModel,
    usedRetrieval: knowledgeChunks.length > 0,
    knowledgeChunks,
    retrievalSummary: knowledgeChunks.map((chunk) => ({
      documentTitle: chunk.documentTitle,
      sourceType: chunk.sourceType,
      preview: String(chunk.content || '').slice(0, 120),
    })),
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
    latencyMs: Date.now() - startedAt,
    estimatedCost: estimateCostByTokens(promptTokens, completionTokens),
    sessionId,
    userId: user.id,
    agentId: agent.id,
    requestType: 'image_generation',
    imagePlan: {
      requestMode: 'image_generation',
      taskType: String(parsed.taskType || (inputImageUrls.length > 0 ? 'edit_image' : 'new_image')),
      selectedImageModel,
      inputImageUrls: preferredInputImageUrls,
      imageReferences: normalizedRefs,
      size: normalizedAspectRatio,
      resolution: normalizedResolution,
      transparentBackground: Boolean(parsed.transparentBackground && imageCapability.supportsTransparentBackground),
      prompt: finalPrompt,
      reasoningSummary: String(parsed.reasoningSummary || ''),
    },
    imageResultUrls: imageUrl ? [imageUrl] : [],
  };
};

const findLocalUserById = (userId) => {
  const store = readLocalStore();
  return store.users.find((item) => item.id === userId) || null;
};

const getLocalJobByIdForUser = (user, jobId) => {
  const store = readLocalStore();
  const job = getLocalJobById(store, jobId);
  if (!job) return null;
  if (user.role !== 'admin' && job.userId !== user.id) return null;
  return job;
};

const listLocalVisibleAgentUsageRows = (store, admin) => {
  const manageableAgentIds = new Set(listLocalAgents(store, admin).map((item) => item.id));
  return (store.agentUsageLogs || [])
    .filter((item) => isSuperAdminUser(admin) || manageableAgentIds.has(item.agentId))
    .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
};

const requireDbUser = async (req, res) => {
  const user = await getDbSessionUser(req);
  if (!user) {
    json(res, 401, { message: '登录状态已失效，请重新登录。' });
    return null;
  }
  return user;
};

const requireDbAdmin = async (req, res) => {
  const user = await requireDbUser(req, res);
  if (!user) return null;
  if (user.role !== 'admin') {
    json(res, 403, { message: '只有管理员可以执行这个操作。' });
    return null;
  }
  return user;
};

const handleMysqlRequest = async (req, res, url) => {
  const userDetailMatch = url.pathname.match(/^\/api\/users\/([^/]+)$/);
  const agentDetailMatch = url.pathname.match(/^\/api\/agents\/([^/]+)$/);
  const agentDraftMatch = url.pathname.match(/^\/api\/agents\/([^/]+)\/draft$/);
  const agentPublishMatch = url.pathname.match(/^\/api\/agents\/([^/]+)\/publish$/);
  const agentRollbackMatch = url.pathname.match(/^\/api\/agents\/([^/]+)\/rollback$/);
  const agentVersionsMatch = url.pathname.match(/^\/api\/agents\/([^/]+)\/versions$/);
  const agentVersionDetailMatch = url.pathname.match(/^\/api\/agent-versions\/([^/]+)$/);
  const agentVersionValidateMatch = url.pathname.match(/^\/api\/agent-versions\/([^/]+)\/validate$/);
  const knowledgeBaseDetailMatch = url.pathname.match(/^\/api\/knowledge-bases\/([^/]+)$/);
  const knowledgeDocumentsMatch = url.pathname.match(/^\/api\/knowledge-documents$/);
  const knowledgeDocumentDetailMatch = url.pathname.match(/^\/api\/knowledge-documents\/([^/]+)$/);
  const chatAgentHistoryMatch = url.pathname.match(/^\/api\/chat\/agents\/([^/]+)\/history$/);
  const chatSessionDetailMatch = url.pathname.match(/^\/api\/chat\/sessions\/([^/]+)$/);
  const chatSessionMessagesMatch = url.pathname.match(/^\/api\/chat\/sessions\/([^/]+)\/messages$/);

  const assetRouteMatch = url.pathname.match(ASSET_FILE_ROUTE_REGEX);
  if (req.method === 'GET' && assetRouteMatch) {
    const assetId = decodeURIComponent(assetRouteMatch[1]);
    await serveStoredAsset(req, res, assetId);
    return;
  }

  if (url.pathname === '/api/auth/login' && req.method === 'POST') {
    const body = await readBody(req);
    const username = String(body.username || '').trim();
    const password = String(body.password || '');
    const user = await findDbUserByUsername(username);

    if (!user || !verifyPassword(password, user.passwordHash, user.salt)) {
      await createDbLog({
        user: buildLogActor({ username: username || 'unknown', displayName: username || 'unknown' }),
        level: 'error',
        module: 'account',
        action: 'login_failed',
        message: `登录失败：${username || '未知用户'}`,
        detail: '用户名或密码不正确。',
        status: 'failed',
        meta: { username: username || 'unknown' },
      });
      json(res, 401, { message: '用户名或密码不正确。' });
      return;
    }

    const loginTime = Date.now();
    await updateDbUserLoginTime(user.id, loginTime);
    await ensureDbAppState(user.id);
    const token = await createDbSession(user.id);
    const freshUser = await findDbUserById(user.id);
    await createDbLog({
      user: freshUser || user,
      level: 'info',
      module: 'account',
      action: 'login_success',
      message: '登录成功',
      status: 'success',
      meta: { role: user.role },
    });
    json(res, 200, { token, user: cleanUser(freshUser || user) });
    return;
  }

  if (url.pathname === '/api/auth/me' && req.method === 'GET') {
    const user = await requireDbUser(req, res);
    if (!user) return;
    json(res, 200, { user: cleanUser(user) });
    return;
  }

  if (url.pathname === '/api/auth/me' && req.method === 'PATCH') {
    const user = await requireDbUser(req, res);
    if (!user) return;
    const body = await readBody(req);
    const updatedUser = await updateDbUser(user.id, {
      displayName: typeof body?.displayName === 'string' ? String(body.displayName) : undefined,
      avatarUrl: body?.avatarUrl === null ? null : typeof body?.avatarUrl === 'string' ? String(body.avatarUrl) : undefined,
      avatarPreset: body?.avatarPreset === null ? null : typeof body?.avatarPreset === 'string' ? String(body.avatarPreset) : undefined,
      usernameFallback: user.displayName || user.username,
    });
    json(res, 200, { user: cleanUser(updatedUser || user) });
    return;
  }

  if (url.pathname === '/api/auth/logout' && req.method === 'POST') {
    const user = await getDbSessionUser(req);
    const token = getTokenFromRequest(req);
    if (token) {
      await deleteDbSession(token);
    }
    if (user) {
      await createDbLog({
        user,
        level: 'info',
        module: 'account',
        action: 'logout',
        message: '退出登录',
        status: 'success',
      });
    }
    json(res, 200, { ok: true });
    return;
  }

  if (url.pathname === '/api/users' && req.method === 'GET') {
    const admin = await requireDbAdmin(req, res);
    if (!admin) return;
    const users = await listDbUsers();
    json(res, 200, { users: users.map(cleanUser) });
    return;
  }

  if (url.pathname === '/api/users' && req.method === 'POST') {
    const admin = await requireDbAdmin(req, res);
    if (!admin) return;

    const body = await readBody(req);
    const username = String(body.username || '').trim();
    const displayName = String(body.displayName || '').trim();
    const password = String(body.password || '');
    const role = body.role === 'admin' ? 'admin' : 'staff';
    const jobConcurrency = normalizeJobConcurrency(body.jobConcurrency, DEFAULT_JOB_CONCURRENCY);

    if (!username || !password) {
      json(res, 400, { message: '用户名和密码不能为空。' });
      return;
    }

    const existingUser = await findDbUserByUsername(username);
    if (existingUser) {
      json(res, 409, { message: '这个用户名已经存在了。' });
      return;
    }

    const newUser = await createDbUser({ username, password, role, displayName, jobConcurrency });
    await createDbLog({
      user: admin,
      level: 'info',
      module: 'account',
      action: 'user_created',
      message: `创建账号：${newUser.username}`,
      status: 'success',
      meta: {
        targetUserId: newUser.id,
        targetUsername: newUser.username,
        targetDisplayName: newUser.displayName,
        targetRole: newUser.role,
        targetJobConcurrency: newUser.jobConcurrency,
      },
    });
    json(res, 201, { user: cleanUser(newUser) });
    return;
  }

  if (url.pathname === '/api/agents' && req.method === 'GET') {
    const admin = await requireDbAdmin(req, res);
    if (!admin) return;
    json(res, 200, { agents: await listDbAgents(admin) });
    return;
  }

  if (url.pathname === '/api/agents' && req.method === 'POST') {
    const admin = await requireDbAdmin(req, res);
    if (!admin) return;
    const body = await readBody(req);
    json(res, 201, await createDbAgent(admin, body || {}));
    return;
  }

  if (agentDetailMatch && req.method === 'GET') {
    const admin = await requireDbAdmin(req, res);
    if (!admin) return;
    const agent = await getDbAgentById(decodeURIComponent(agentDetailMatch[1]));
    if (!agent || !canManageOwnedResource(admin, agent.ownerUserId)) {
      json(res, 404, { message: '智能体不存在。' });
      return;
    }
    json(res, 200, { agent, versions: await listDbAgentVersionsByAgentId(agent.id) });
    return;
  }

  if (agentDetailMatch && req.method === 'PATCH') {
    const admin = await requireDbAdmin(req, res);
    if (!admin) return;
    const body = await readBody(req);
    const agent = await updateDbAgent(admin, decodeURIComponent(agentDetailMatch[1]), body || {});
    if (!agent) {
      json(res, 404, { message: '智能体不存在或无权限。' });
      return;
    }
    json(res, 200, { agent });
    return;
  }

  if (agentDetailMatch && req.method === 'DELETE') {
    const admin = await requireDbAdmin(req, res);
    if (!admin) return;
    const result = await deleteDbAgent(admin, decodeURIComponent(agentDetailMatch[1]));
    if (!result) {
      json(res, 404, { message: '智能体不存在或无权限。' });
      return;
    }
    json(res, 200, { ...result, message: '智能体已永久删除。' });
    return;
  }

  if (agentDraftMatch && req.method === 'POST') {
    const admin = await requireDbAdmin(req, res);
    if (!admin) return;
    const version = await createDbAgentDraft(admin, decodeURIComponent(agentDraftMatch[1]));
    if (!version) {
      json(res, 404, { message: '智能体不存在或无权限。' });
      return;
    }
    json(res, 201, { version });
    return;
  }

  if (agentPublishMatch && req.method === 'POST') {
    const admin = await requireDbAdmin(req, res);
    if (!admin) return;
    const body = await readBody(req);
    const agent = await publishDbAgentVersion(admin, decodeURIComponent(agentPublishMatch[1]), body?.versionId ? String(body.versionId) : null);
    if (!agent) {
      json(res, 400, { message: '发布失败，请先完成成功验证。' });
      return;
    }
    json(res, 200, { agent });
    return;
  }

  if (agentRollbackMatch && req.method === 'POST') {
    const admin = await requireDbAdmin(req, res);
    if (!admin) return;
    const body = await readBody(req);
    const agent = await rollbackDbAgentVersion(admin, decodeURIComponent(agentRollbackMatch[1]), String(body?.versionId || ''));
    if (!agent) {
      json(res, 400, { message: '回滚失败。' });
      return;
    }
    json(res, 200, { agent });
    return;
  }

  if (agentVersionsMatch && req.method === 'GET') {
    const admin = await requireDbAdmin(req, res);
    if (!admin) return;
    const agent = await getDbAgentById(decodeURIComponent(agentVersionsMatch[1]));
    if (!agent || !canManageOwnedResource(admin, agent.ownerUserId)) {
      json(res, 404, { message: '智能体不存在或无权限。' });
      return;
    }
    json(res, 200, { versions: await listDbAgentVersionsByAgentId(agent.id) });
    return;
  }

  if (agentVersionDetailMatch && req.method === 'GET') {
    const admin = await requireDbAdmin(req, res);
    if (!admin) return;
    const version = await getDbAgentVersionById(decodeURIComponent(agentVersionDetailMatch[1]));
    const agent = version ? await getDbAgentById(version.agentId) : null;
    if (!version || !agent || !canManageOwnedResource(admin, agent.ownerUserId)) {
      json(res, 404, { message: '版本不存在或无权限。' });
      return;
    }
    json(res, 200, { version });
    return;
  }

  if (agentVersionDetailMatch && req.method === 'PATCH') {
    const admin = await requireDbAdmin(req, res);
    if (!admin) return;
    const body = await readBody(req);
    const version = await updateDbAgentVersion(admin, decodeURIComponent(agentVersionDetailMatch[1]), body || {});
    if (!version) {
      json(res, 400, { message: '版本不存在、已发布或无权限。' });
      return;
    }
    json(res, 200, { version });
    return;
  }

  if (agentVersionDetailMatch && req.method === 'DELETE') {
    const admin = await requireDbAdmin(req, res);
    if (!admin) return;
    const result = await deleteDbAgentVersion(admin, decodeURIComponent(agentVersionDetailMatch[1]));
    if (!result) {
      json(res, 400, { message: '版本不存在、已发布或无权限，不能永久删除。' });
      return;
    }
    json(res, 200, { ...result, message: '版本已永久删除。' });
    return;
  }

  if (agentVersionValidateMatch && req.method === 'POST') {
    const admin = await requireDbAdmin(req, res);
    if (!admin) return;
    const body = await readBody(req);
    const versionId = decodeURIComponent(agentVersionValidateMatch[1]);
    try {
      const result = await validateDbAgentVersion(admin, versionId, body?.message);
      if (!result) {
        json(res, 404, { message: '版本不存在或无权限。' });
        return;
      }
      const agent = await getDbAgentById(result.version.agentId);
      await createDbAgentUsageLog(admin, agent, result.version, result.result, 'success');
      json(res, 200, result);
    } catch (error) {
      const version = await getDbAgentVersionById(versionId);
      const agent = version ? await getDbAgentById(version.agentId) : null;
      if (version && agent) {
        await createDbLog({
          user: admin,
          level: 'error',
          module: 'agent_center',
          action: 'agent_validate',
          message: `智能体验证失败：${agent.name}`,
          detail: error?.message || '智能体验证失败。',
          status: 'failed',
          meta: buildAgentRuntimeLogMeta({
            agent,
            version,
            requestMode: 'validation',
            error,
          }),
        }).catch(() => null);
      }
      json(res, 500, { message: error?.message || '智能体验证失败。' });
    }
    return;
  }

  if (url.pathname === '/api/knowledge-bases' && req.method === 'GET') {
    const admin = await requireDbAdmin(req, res);
    if (!admin) return;
    json(res, 200, { knowledgeBases: await listDbKnowledgeBases(admin) });
    return;
  }

  if (url.pathname === '/api/knowledge-bases' && req.method === 'POST') {
    const admin = await requireDbAdmin(req, res);
    if (!admin) return;
    const body = await readBody(req);
    json(res, 201, { knowledgeBase: await createDbKnowledgeBase(admin, body || {}) });
    return;
  }

  if (knowledgeBaseDetailMatch && req.method === 'GET') {
    const admin = await requireDbAdmin(req, res);
    if (!admin) return;
    const knowledgeBase = await getDbKnowledgeBaseById(decodeURIComponent(knowledgeBaseDetailMatch[1]));
    if (!knowledgeBase || !canManageOwnedResource(admin, knowledgeBase.ownerUserId)) {
      json(res, 404, { message: '知识库不存在或无权限。' });
      return;
    }
    json(res, 200, { knowledgeBase, documents: await listDbKnowledgeDocuments(admin, knowledgeBase.id) });
    return;
  }

  if (knowledgeBaseDetailMatch && req.method === 'PATCH') {
    const admin = await requireDbAdmin(req, res);
    if (!admin) return;
    const body = await readBody(req);
    const knowledgeBase = await updateDbKnowledgeBase(admin, decodeURIComponent(knowledgeBaseDetailMatch[1]), body || {});
    if (!knowledgeBase) {
      json(res, 404, { message: '知识库不存在或无权限。' });
      return;
    }
    json(res, 200, { knowledgeBase });
    return;
  }

  if (knowledgeBaseDetailMatch && req.method === 'DELETE') {
    const admin = await requireDbAdmin(req, res);
    if (!admin) return;
    const knowledgeBaseId = decodeURIComponent(knowledgeBaseDetailMatch[1]);
    const deletedCount = await deleteDbKnowledgeBase(admin, knowledgeBaseId);
    if (!deletedCount) {
      json(res, 404, { message: '知识库不存在或无权限。' });
      return;
    }
    json(res, 200, { ok: true, deletedKnowledgeBaseId: knowledgeBaseId, message: '知识库已永久删除。' });
    return;
  }

  if (knowledgeDocumentsMatch && req.method === 'GET') {
    const admin = await requireDbAdmin(req, res);
    if (!admin) return;
    const knowledgeBaseId = String(url.searchParams.get('knowledgeBaseId') || '');
    json(res, 200, { documents: await listDbKnowledgeDocuments(admin, knowledgeBaseId) });
    return;
  }

  if (knowledgeDocumentsMatch && req.method === 'POST') {
    const admin = await requireDbAdmin(req, res);
    if (!admin) return;
    const body = await readBody(req);
    const document = await createDbKnowledgeDocument(admin, body || {});
    if (!document) {
      json(res, 404, { message: '知识库不存在或无权限。' });
      return;
    }
    json(res, 201, { document });
    return;
  }

  if (knowledgeDocumentDetailMatch && req.method === 'DELETE') {
    const admin = await requireDbAdmin(req, res);
    if (!admin) return;
    const deletedCount = await deleteDbKnowledgeDocument(admin, decodeURIComponent(knowledgeDocumentDetailMatch[1]));
    json(res, 200, { ok: true, deletedCount });
    return;
  }

  if (knowledgeDocumentDetailMatch && req.method === 'PATCH') {
    const admin = await requireDbAdmin(req, res);
    if (!admin) return;
    const body = await readBody(req);
    const document = await updateDbKnowledgeDocument(admin, decodeURIComponent(knowledgeDocumentDetailMatch[1]), body || {});
    if (!document) {
      json(res, 404, { message: '文档不存在或无权限。' });
      return;
    }
    json(res, 200, { document });
    return;
  }

  if (url.pathname === '/api/chat/agents' && req.method === 'GET') {
    const user = await requireDbUser(req, res);
    if (!user) return;
    json(res, 200, { agents: await listDbChatAgents() });
    return;
  }

  if (chatAgentHistoryMatch && req.method === 'DELETE') {
    const user = await requireDbUser(req, res);
    if (!user) return;
    const result = await deleteDbUserAgentHistory(user, decodeURIComponent(chatAgentHistoryMatch[1]));
    if (!result) {
      json(res, 404, { message: '智能体不存在或无权限。' });
      return;
    }
    json(res, 200, result);
    return;
  }

  if (url.pathname === '/api/chat/sessions' && req.method === 'GET') {
    const user = await requireDbUser(req, res);
    if (!user) return;
    json(res, 200, { sessions: await listDbChatSessions(user, String(url.searchParams.get('agentId') || '')) });
    return;
  }

  if (url.pathname === '/api/chat/sessions' && req.method === 'POST') {
    const user = await requireDbUser(req, res);
    if (!user) return;
    const body = await readBody(req);
    const session = await createDbChatSession(user, String(body?.agentId || ''));
    if (!session) {
      json(res, 404, { message: '智能体不存在或尚未发布。' });
      return;
    }
    json(res, 201, { session });
    return;
  }

  if (chatSessionDetailMatch && req.method === 'PATCH') {
    const user = await requireDbUser(req, res);
    if (!user) return;
    const body = await readBody(req);
    const session = await createDbChatSessionOptions(user, decodeURIComponent(chatSessionDetailMatch[1]), body || {});
    if (!session) {
      json(res, 404, { message: '会话不存在或无权限。' });
      return;
    }
    json(res, 200, { session });
    return;
  }

  if (chatSessionDetailMatch && req.method === 'DELETE') {
    const user = await requireDbUser(req, res);
    if (!user) return;
    const result = await deleteDbChatSession(user, decodeURIComponent(chatSessionDetailMatch[1]));
    if (!result) {
      json(res, 404, { message: '会话不存在或无权限。' });
      return;
    }
    json(res, 200, result);
    return;
  }

  if (chatSessionMessagesMatch && req.method === 'GET') {
    const user = await requireDbUser(req, res);
    if (!user) return;
    json(res, 200, { messages: await listDbChatMessages(user, decodeURIComponent(chatSessionMessagesMatch[1])) });
    return;
  }

  if (chatSessionMessagesMatch && req.method === 'POST') {
    const user = await requireDbUser(req, res);
    if (!user) return;
    const body = await readBody(req);
    try {
      const result = await createDbChatReply(user, decodeURIComponent(chatSessionMessagesMatch[1]), body || {});
      if (!result) {
        json(res, 404, { message: '会话不存在或无权限。' });
        return;
      }
      json(res, 201, result);
    } catch (error) {
      const sessionId = decodeURIComponent(chatSessionMessagesMatch[1]);
      const session = await getDbChatSessionById(user, sessionId);
      const version = session ? await getDbAgentVersionById(session.agentVersionId) : null;
      const agent = session ? await getDbAgentById(session.agentId) : null;
      if (session && version && agent) {
        await createDbLog({
          user,
          level: 'error',
          module: 'agent_center',
          action: body?.requestMode === 'image_generation' ? 'create_image_task' : 'agent_chat',
          message: `${body?.requestMode === 'image_generation' ? '智能体生图失败' : '智能体对话失败'}：${agent.name}`,
          detail: error?.message || '聊天回复失败。',
          status: 'failed',
          meta: buildAgentRuntimeLogMeta({
            agent,
            version,
            requestMode: body?.requestMode === 'image_generation' ? 'image_generation' : 'chat',
            sessionId,
            clientRequestId: String(body?.clientRequestId || '').trim(),
            error,
          }),
        }).catch(() => null);
      }
      json(res, 500, { message: error?.message || '聊天回复失败。' });
    }
    return;
  }

  if (url.pathname === '/api/agent-usage' && req.method === 'GET') {
    const admin = await requireDbAdmin(req, res);
    if (!admin) return;
    json(res, 200, { rows: await listDbAgentUsage(admin) });
    return;
  }

  if (url.pathname === '/api/agent-usage/summary' && req.method === 'GET') {
    const admin = await requireDbAdmin(req, res);
    if (!admin) return;
    json(res, 200, { summary: await getDbAgentUsageSummary(admin) });
    return;
  }

  if (url.pathname === '/api/logs' && req.method === 'GET') {
    const admin = await requireDbAdmin(req, res);
    if (!admin) return;
    const result = await listDbLogs({
      module: url.searchParams.get('module'),
      userId: url.searchParams.get('userId'),
      status: url.searchParams.get('status'),
      startAt: url.searchParams.get('startAt'),
      endAt: url.searchParams.get('endAt'),
      page: url.searchParams.get('page'),
      pageSize: url.searchParams.get('pageSize'),
    });
    json(res, 200, result);
    return;
  }

  if (url.pathname === '/api/logs/meta' && req.method === 'GET') {
    const admin = await requireDbAdmin(req, res);
    if (!admin) return;
    const meta = await listDbLogMeta();
    json(res, 200, meta);
    return;
  }

  if (url.pathname === '/api/logs' && req.method === 'DELETE') {
    const admin = await requireDbAdmin(req, res);
    if (!admin) return;
    const body = await readBody(req);
    const deletedCount = await deleteDbLogs(body || {});
    await createDbLog({
      user: admin,
      level: 'info',
      module: 'account',
      action: 'clear_records',
      message: `清理运行日志 ${deletedCount} 条`,
      status: 'success',
      meta: {
        deletedCount,
        module: normalizeLogFilterValue(body?.module),
        userId: normalizeLogFilterValue(body?.userId),
        status: normalizeLogFilterValue(body?.status),
        startAt: normalizeLogFilterTimestamp(body?.startAt),
        endAt: normalizeLogFilterTimestamp(body?.endAt),
      },
    });
    json(res, 200, { ok: true, deletedCount });
    return;
  }

  if (url.pathname === '/api/logs' && req.method === 'POST') {
    const user = await requireDbUser(req, res);
    if (!user) return;
    const body = await readBody(req);
    const log = await createDbLog({
      user,
      level: body.level === 'error' ? 'error' : 'info',
      module: String(body.module || 'system').slice(0, 60),
      action: String(body.action || 'unknown').slice(0, 100),
      message: String(body.message || '未提供日志描述').slice(0, 1000),
      detail: typeof body.detail === 'string' ? body.detail.slice(0, 10000) : '',
      status: ['success', 'failed', 'started', 'interrupted'].includes(body.status) ? body.status : 'started',
      meta: body.meta && typeof body.meta === 'object' ? body.meta : null,
    });
    json(res, 201, { ok: true, log });
    return;
  }

  if (url.pathname === '/api/stats/usage' && req.method === 'GET') {
    const admin = await requireDbAdmin(req, res);
    if (!admin) return;
    const pool = await getMysqlPool();
    const clauses = [];
    const values = [];
    const startDate = url.searchParams.get('startDate');
    const endDate = url.searchParams.get('endDate');
    const userId = normalizeLogFilterValue(url.searchParams.get('userId'));
    const mod = normalizeLogFilterValue(url.searchParams.get('module'));
    if (startDate) { clauses.push('stat_date >= ?'); values.push(startDate); }
    if (endDate) { clauses.push('stat_date <= ?'); values.push(endDate); }
    if (userId) { clauses.push('user_id = ?'); values.push(userId); }
    if (mod) { clauses.push('module = ?'); values.push(mod); }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const [rows] = await pool.query(
      `SELECT stat_date, user_id, username, display_name, module,
       success_count, failed_count, interrupted_count
       FROM usage_daily ${where} ORDER BY stat_date ASC`, values
    );
    let resultRows = rows.map((r) => ({
      statDate: typeof r.stat_date === 'string' ? r.stat_date : new Date(r.stat_date).toISOString().split('T')[0],
      userId: r.user_id, username: r.username, displayName: r.display_name, module: r.module,
      successCount: Number(r.success_count), failedCount: Number(r.failed_count),
      interruptedCount: Number(r.interrupted_count),
    }));
    if (!mod || mod === 'agent_center') {
      const usageClauses = [];
      const usageValues = [];
      if (!isSuperAdminUser(admin)) {
        usageClauses.push('a.owner_user_id = ?');
        usageValues.push(admin.id);
      }
      if (startDate) { usageClauses.push('DATE(FROM_UNIXTIME(l.created_at / 1000)) >= ?'); usageValues.push(startDate); }
      if (endDate) { usageClauses.push('DATE(FROM_UNIXTIME(l.created_at / 1000)) <= ?'); usageValues.push(endDate); }
      if (userId) { usageClauses.push('l.user_id = ?'); usageValues.push(userId); }
      const usageWhere = usageClauses.length > 0 ? `WHERE ${usageClauses.join(' AND ')}` : '';
      const [agentUsageRows] = await pool.query(
        `SELECT l.user_id, l.username, l.display_name, l.status, l.created_at
         FROM agent_usage_logs l
         LEFT JOIN agents a ON a.id = l.agent_id
         ${usageWhere}`,
        usageValues
      );
      resultRows = [...resultRows, ...aggregateAgentUsageStatsRows(agentUsageRows)];
    }
    json(res, 200, { rows: resultRows.sort((a, b) => a.statDate.localeCompare(b.statDate)) });
    return;
  }

  if (url.pathname === '/api/stats/backfill' && req.method === 'POST') {
    const admin = await requireDbAdmin(req, res);
    if (!admin) return;
    const pool = await getMysqlPool();
    await pool.query('DELETE FROM usage_daily WHERE 1=1');
    const [logRows] = await pool.query(
      `SELECT DATE(FROM_UNIXTIME(created_at / 1000)) AS d,
       user_id, username, display_name, module, status, COUNT(*) AS cnt
       FROM internal_logs
       WHERE module IN ('agent_center','one_click','translation','buyer_show','retouch','video')
       AND status IN ('success','failed','interrupted')
       AND action IN ('agent_chat','agent_validate','generate_main_scheme','generate_detail_scheme','generate_single','generate_board','regenerate_board','create_image_task')
       GROUP BY d, user_id, username, display_name, module, status`
    );
    let upserted = 0;
    for (const row of logRows) {
      const field = row.status === 'success' ? 'success_count'
        : row.status === 'failed' ? 'failed_count' : 'interrupted_count';
      await pool.query(
        `INSERT INTO usage_daily (stat_date, user_id, username, display_name, module, ${field})
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE ${field} = ${field} + VALUES(${field})`,
        [row.d, row.user_id, row.username, row.display_name, row.module, Number(row.cnt)]
      );
      upserted++;
    }
    json(res, 200, { ok: true, upserted });
    return;
  }

  if (userDetailMatch && req.method === 'PATCH') {
    const admin = await requireDbAdmin(req, res);
    if (!admin) return;

    const targetUserId = decodeURIComponent(userDetailMatch[1]);
    const targetUser = await findDbUserById(targetUserId);
    if (!targetUser) {
      json(res, 404, { message: '账号不存在。' });
      return;
    }

    const body = await readBody(req);
    const nextStatus = body.status === 'disabled' ? 'disabled' : body.status === 'active' ? 'active' : undefined;
    const nextRole = body.role === 'admin' ? 'admin' : body.role === 'staff' ? 'staff' : undefined;
    const nextPassword = typeof body.password === 'string' ? String(body.password) : '';
    const nextDisplayName = typeof body.displayName === 'string' ? String(body.displayName) : undefined;
    const nextJobConcurrency = body.jobConcurrency === undefined ? undefined : normalizeJobConcurrency(body.jobConcurrency, DEFAULT_JOB_CONCURRENCY);
    const previousStatus = targetUser.status;

    if (targetUser.id === admin.id && nextStatus === 'disabled') {
      json(res, 400, { message: '不能禁用当前登录管理员。' });
      return;
    }

    if (targetUser.role === 'admin' && (nextRole === 'staff' || nextStatus === 'disabled')) {
      const adminCount = await countDbAdmins();
      if (adminCount <= 1) {
        json(res, 400, { message: '至少要保留一个可用管理员账号。' });
        return;
      }
    }

    const updatedUser = await updateDbUser(targetUser.id, {
      displayName: nextDisplayName,
      role: nextRole,
      status: nextStatus,
      jobConcurrency: nextJobConcurrency,
      password: nextPassword,
      usernameFallback: targetUser.displayName || targetUser.username,
    });

    if (nextStatus === 'disabled' || nextPassword) {
      const pool = await getMysqlPool();
      await pool.query('DELETE FROM sessions WHERE user_id = ?', [targetUser.id]);
    }

    if (nextPassword) {
      await createDbLog({
        user: admin,
        level: 'info',
        module: 'account',
        action: 'password_reset',
        message: `重置密码：${targetUser.username}`,
        status: 'success',
        meta: {
          targetUserId: targetUser.id,
          targetUsername: targetUser.username,
        },
      });
    }

    if (nextStatus && nextStatus !== targetUser.status) {
      await createDbLog({
        user: admin,
        level: 'info',
        module: 'account',
        action: nextStatus === 'disabled' ? 'user_disabled' : 'user_enabled',
        message: `${nextStatus === 'disabled' ? '禁用' : '启用'}账号：${targetUser.username}`,
        status: 'success',
        meta: {
          targetUserId: targetUser.id,
          targetUsername: targetUser.username,
        },
      });
    }

    json(res, 200, { user: cleanUser(updatedUser) });
    return;
  }

  if (userDetailMatch && req.method === 'DELETE') {
    const admin = await requireDbAdmin(req, res);
    if (!admin) return;

    const targetUserId = decodeURIComponent(userDetailMatch[1]);
    const targetUser = await findDbUserById(targetUserId);
    if (!targetUser) {
      json(res, 404, { message: '账号不存在。' });
      return;
    }

    if (targetUser.id === admin.id) {
      json(res, 400, { message: '不能删除当前登录管理员。' });
      return;
    }

    if (targetUser.role === 'admin') {
      const adminCount = await countDbAdmins();
      if (adminCount <= 1) {
        json(res, 400, { message: '至少要保留一个可用管理员账号。' });
        return;
      }
    }

    await deleteDbUser(targetUser.id);
    await createDbLog({
      user: admin,
      level: 'info',
      module: 'account',
      action: 'user_deleted',
      message: `删除账号：${targetUser.username}`,
      status: 'success',
      meta: {
        targetUserId: targetUser.id,
        targetUsername: targetUser.username,
      },
    });
    json(res, 200, { ok: true });
    return;
  }

  if (url.pathname === '/api/state' && req.method === 'GET') {
    const user = await requireDbUser(req, res);
    if (!user) return;
    const state = await getDbAppState(user.id);
    await saveDbAppState(user.id, state);
    json(res, 200, { state: prepareStateForClient(state) });
    return;
  }

  if (url.pathname === '/api/state' && req.method === 'PUT') {
    const user = await requireDbUser(req, res);
    if (!user) return;
    const body = await readBody(req);
    await saveDbAppState(user.id, body.state || createDefaultState());
    json(res, 200, { ok: true });
    return;
  }

  if (url.pathname === '/api/system/config' && req.method === 'GET') {
    const user = await requireDbUser(req, res);
    if (!user) return;
    const pool = await getMysqlPool();
    const queueStats = await getJobQueueStats(pool);
    const systemSettings = await getDbSystemSettings();
    json(res, 200, {
      config: buildPublicSystemConfig(process.env, queueStats, {
        maxConcurrency: await getDbWorkerConcurrency(),
        systemSettings,
      }),
    });
    return;
  }

  if (url.pathname === '/api/system/config' && req.method === 'PATCH') {
    const admin = await requireDbAdmin(req, res);
    if (!admin) return;
    const body = await readBody(req);
    const currentSettings = await getDbSystemSettings();
    const nextSettings = await saveDbSystemSettings({
      ...currentSettings,
      analysisModel: body?.analysisModel,
    });
    const pool = await getMysqlPool();
    const queueStats = await getJobQueueStats(pool);
    json(res, 200, {
      config: buildPublicSystemConfig(process.env, queueStats, {
        maxConcurrency: await getDbWorkerConcurrency(),
        systemSettings: nextSettings,
      }),
    });
    return;
  }

  if (url.pathname === '/api/assets/upload' && req.method === 'POST') {
    const user = await requireDbUser(req, res);
    if (!user) return;
    const body = await readBody(req);
    const base64Data = String(body.base64Data || '').trim();
    const mimeType = String(body.mimeType || 'application/octet-stream').trim();
    const originalFileName = String(body.fileName || 'upload.bin').trim();
    if (!base64Data) {
      json(res, 400, { message: '上传内容不能为空。' });
      return;
    }

    const persisted = await persistUploadedAssetIfEnabled({
      req,
      user,
      moduleName: String(body.module || 'system').slice(0, 60),
      fileName: originalFileName,
      mimeType,
      fileBuffer: Buffer.from(base64Data, 'base64'),
    });
    if (persisted) {
      await createDbLog({
        user,
        level: 'info',
        module: String(body.module || 'system').slice(0, 60),
        action: 'asset_persisted',
        message: `素材上传成功：${originalFileName}`,
        status: 'success',
        meta: {
          assetId: persisted.id,
          fileUrl: persisted.publicUrl,
        },
      });
      json(res, 200, { fileUrl: persisted.publicUrl, assetId: persisted.id });
      return;
    }

    const pool = await getMysqlPool();
    const uploadPath = `mayo-storage/${sanitizePathPart(user.id)}`;
    const uploadJob = await createJobRecord(pool, user, {
      module: String(body.module || 'system').slice(0, 60),
      taskType: 'upload_asset',
      provider: 'kie',
      payload: {
        base64Data,
        mimeType,
        fileName: `${sanitizePathPart(user.username || user.id)}_${Date.now()}_${sanitizePathPart(originalFileName)}`,
        uploadPath,
      },
      maxRetries: 1,
    });
    const result = await executeProviderJob(uploadJob, process.env, new AbortController().signal);
    await createDbLog({
      user,
      level: 'info',
      module: String(body.module || 'system').slice(0, 60),
      action: 'upload_asset',
      message: `素材上传成功：${originalFileName}`,
      status: 'success',
      meta: {
        jobId: uploadJob.id,
        uploadPath,
        fileUrl: result?.result?.fileUrl || '',
      },
    });
    json(res, 200, {
      fileUrl: result?.result?.fileUrl || '',
    });
    return;
  }

  if (url.pathname === '/api/assets/upload-stream' && req.method === 'POST') {
    const user = await requireDbUser(req, res);
    if (!user) return;
    const formData = await readMultipartFormData(req);
    const file = formData.get('file');
    const moduleName = String(formData.get('module') || 'system').slice(0, 60);
    if (!(file instanceof File)) {
      json(res, 400, { message: '上传文件不能为空。' });
      return;
    }

    const fileBuffer = Buffer.from(await file.arrayBuffer());
    const persisted = await persistUploadedAssetIfEnabled({
      req,
      user,
      moduleName,
      fileName: file.name || 'upload.bin',
      mimeType: file.type || 'application/octet-stream',
      fileBuffer,
    });
    if (persisted) {
      await createDbLog({
        user,
        level: 'info',
        module: moduleName,
        action: 'asset_persisted',
        message: `素材上传成功：${file.name || 'upload.bin'}`,
        status: 'success',
        meta: {
          assetId: persisted.id,
          fileUrl: persisted.publicUrl,
        },
      });
      json(res, 200, { fileUrl: persisted.publicUrl, assetId: persisted.id });
      return;
    }

    const uploadPath = `mayo-storage/${sanitizePathPart(user.id)}`;
    const result = await executeProviderJob({
      taskType: 'upload_asset',
      payload: {
        fileBuffer,
        mimeType: file.type || 'application/octet-stream',
        fileName: `${sanitizePathPart(user.username || user.id)}_${Date.now()}_${sanitizePathPart(file.name || 'upload.bin')}`,
        uploadPath,
      },
    }, process.env, new AbortController().signal);
    await createDbLog({
      user,
      level: 'info',
      module: moduleName,
      action: 'upload_asset',
      message: `素材上传成功：${file.name || 'upload.bin'}`,
      status: 'success',
      meta: {
        uploadPath,
        fileUrl: result?.result?.fileUrl || '',
      },
    });
    json(res, 200, { fileUrl: result?.result?.fileUrl || '' });
    return;
  }

  if (url.pathname === '/api/jobs' && req.method === 'POST') {
    const user = await requireDbUser(req, res);
    if (!user) return;
    const body = await readBody(req);
    if (!body?.taskType || !body?.provider) {
      json(res, 400, { message: '任务类型和 provider 不能为空。' });
      return;
    }

    const pool = await getMysqlPool();
    const jobPayload = {
      module: body.module,
      taskType: body.taskType,
      provider: body.provider,
      payload: body.payload,
      priority: body.priority,
      maxRetries: body.maxRetries,
    };
    const reusableJob = await findReusableJobRecord(pool, user, jobPayload);
    if (reusableJob) {
      json(res, 200, { job: reusableJob, deduped: true });
      return;
    }
    const job = await createJobRecord(pool, user, jobPayload);
    await createDbLog({
      user,
      level: 'info',
      module: job.module,
      action: 'job_created',
      message: `创建任务：${job.taskType}`,
      status: 'started',
      meta: {
        jobId: job.id,
        provider: job.provider,
      },
    });
    jobWorker?.trigger?.();
    json(res, 201, { job });
    return;
  }

  if (url.pathname === '/api/jobs' && req.method === 'GET') {
    const user = await requireDbUser(req, res);
    if (!user) return;
    const pool = await getMysqlPool();
    const jobs = await listJobsForUser(pool, user.id, { limit: url.searchParams.get('limit') || 100 });
    json(res, 200, { jobs });
    return;
  }

  const jobDetailMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)$/);
  const jobCancelMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)\/cancel$/);
  const jobRetryMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)\/retry$/);

  if (jobDetailMatch && req.method === 'GET') {
    const user = await requireDbUser(req, res);
    if (!user) return;
    const job = await getDbJobByIdForUser(user, decodeURIComponent(jobDetailMatch[1]));
    if (!job) {
      json(res, 404, { message: '任务不存在。' });
      return;
    }
    json(res, 200, { job });
    return;
  }

  if (jobCancelMatch && req.method === 'POST') {
    const user = await requireDbUser(req, res);
    if (!user) return;
    const jobId = decodeURIComponent(jobCancelMatch[1]);
    const pool = await getMysqlPool();
    const job = await getDbJobByIdForUser(user, jobId);
    if (!job) {
      json(res, 404, { message: '任务不存在。' });
      return;
    }
    await requestCancelJob(pool, job, {
      user,
      createLog: createDbLog,
    });
    jobWorker?.cancelActiveJob(job.id);
    json(res, 200, { ok: true });
    return;
  }

  if (jobRetryMatch && req.method === 'POST') {
    const user = await requireDbUser(req, res);
    if (!user) return;
    const jobId = decodeURIComponent(jobRetryMatch[1]);
    const pool = await getMysqlPool();
    const job = await getDbJobByIdForUser(user, jobId);
    if (!job) {
      json(res, 404, { message: '任务不存在。' });
      return;
    }
    await requestRetryJob(pool, job, {
      user,
      createLog: createDbLog,
    });
    jobWorker?.trigger?.();
    json(res, 200, { ok: true });
    return;
  }

  if (url.pathname === '/api/jobs/recover' && req.method === 'POST') {
    const user = await requireDbUser(req, res);
    if (!user) return;
    const body = await readBody(req);
    if (!body?.providerTaskId || !body?.provider || !body?.taskType) {
      json(res, 400, { message: '恢复任务缺少必要参数。' });
      return;
    }

    const pool = await getMysqlPool();
    const jobPayload = {
      module: body.module || 'system',
      taskType: body.taskType,
      provider: body.provider,
      payload: {
        ...body.payload,
        providerTaskId: body.providerTaskId,
      },
      maxRetries: body.maxRetries ?? 1,
    };
    const reusableJob = await findReusableJobRecord(pool, user, jobPayload);
    if (reusableJob) {
      json(res, 200, { job: reusableJob, deduped: true });
      return;
    }
    const job = await createJobRecord(pool, user, jobPayload);
    jobWorker?.trigger?.();
    json(res, 201, { job });
    return;
  }

  json(res, 404, { message: '接口不存在。' });
};

const handleLocalRequest = async (req, res, url) => {
  let store = readLocalStore();
  const userDetailMatch = url.pathname.match(/^\/api\/users\/([^/]+)$/);
  const agentDetailMatch = url.pathname.match(/^\/api\/agents\/([^/]+)$/);
  const agentDraftMatch = url.pathname.match(/^\/api\/agents\/([^/]+)\/draft$/);
  const agentPublishMatch = url.pathname.match(/^\/api\/agents\/([^/]+)\/publish$/);
  const agentRollbackMatch = url.pathname.match(/^\/api\/agents\/([^/]+)\/rollback$/);
  const agentVersionsMatch = url.pathname.match(/^\/api\/agents\/([^/]+)\/versions$/);
  const agentVersionDetailMatch = url.pathname.match(/^\/api\/agent-versions\/([^/]+)$/);
  const agentVersionValidateMatch = url.pathname.match(/^\/api\/agent-versions\/([^/]+)\/validate$/);
  const knowledgeBaseDetailMatch = url.pathname.match(/^\/api\/knowledge-bases\/([^/]+)$/);
  const knowledgeDocumentsMatch = url.pathname.match(/^\/api\/knowledge-documents$/);
  const knowledgeDocumentDetailMatch = url.pathname.match(/^\/api\/knowledge-documents\/([^/]+)$/);
  const chatAgentHistoryMatch = url.pathname.match(/^\/api\/chat\/agents\/([^/]+)\/history$/);
  const chatSessionDetailMatch = url.pathname.match(/^\/api\/chat\/sessions\/([^/]+)$/);
  const chatSessionMessagesMatch = url.pathname.match(/^\/api\/chat\/sessions\/([^/]+)\/messages$/);

  const assetRouteMatch = url.pathname.match(ASSET_FILE_ROUTE_REGEX);
  if (req.method === 'GET' && assetRouteMatch) {
    const assetId = decodeURIComponent(assetRouteMatch[1]);
    await serveStoredAsset(req, res, assetId);
    return;
  }

  if (url.pathname === '/api/auth/login' && req.method === 'POST') {
    const body = await readBody(req);
    const username = String(body.username || '').trim();
    const password = String(body.password || '');
    const user = store.users.find(item => item.username === username && item.status === 'active');

    if (!user || !verifyPassword(password, user.passwordHash, user.salt)) {
      appendLocalLog(store, {
        user: buildLogActor({ username: username || 'unknown', displayName: username || 'unknown' }),
        level: 'error',
        module: 'account',
        action: 'login_failed',
        message: `登录失败：${username || '未知用户'}`,
        detail: '用户名或密码不正确。',
        status: 'failed',
        meta: { username: username || 'unknown' },
      });
      writeLocalStore(store);
      json(res, 401, { message: '用户名或密码不正确。' });
      return;
    }

    user.lastLoginAt = Date.now();
    const token = localCreateSession(store, user.id);
    if (!store.appStates[user.id]) {
      store.appStates[user.id] = createDefaultState();
    }
    appendLocalLog(store, {
      user,
      level: 'info',
      module: 'account',
      action: 'login_success',
      message: '登录成功',
      status: 'success',
      meta: { role: user.role },
    });
    writeLocalStore(store);
    json(res, 200, { token, user: cleanUser(user) });
    return;
  }

  if (url.pathname === '/api/auth/me' && req.method === 'GET') {
    const user = localRequireUser(req, res, store);
    if (!user) return;
    writeLocalStore(store);
    json(res, 200, { user: cleanUser(user) });
    return;
  }

  if (url.pathname === '/api/auth/me' && req.method === 'PATCH') {
    const user = localRequireUser(req, res, store);
    if (!user) return;
    const body = await readBody(req);
    if (typeof body?.displayName === 'string') user.displayName = String(body.displayName).trim() || user.username;
    if (body?.avatarUrl === null) user.avatarUrl = '';
    else if (typeof body?.avatarUrl === 'string') user.avatarUrl = String(body.avatarUrl).trim().slice(0, 1024);
    if (body?.avatarPreset === null) user.avatarPreset = 'aurora';
    else if (typeof body?.avatarPreset === 'string') user.avatarPreset = String(body.avatarPreset).trim().slice(0, 40) || 'aurora';
    writeLocalStore(store);
    json(res, 200, { user: cleanUser(user) });
    return;
  }

  if (url.pathname === '/api/auth/logout' && req.method === 'POST') {
    const user = localRequireUser(req, res, store);
    if (!user) return;
    const token = getTokenFromRequest(req);
    store.sessions = store.sessions.filter(session => session.token !== token);
    appendLocalLog(store, {
      user,
      level: 'info',
      module: 'account',
      action: 'logout',
      message: '退出登录',
      status: 'success',
    });
    writeLocalStore(store);
    json(res, 200, { ok: true });
    return;
  }

  if (url.pathname === '/api/users' && req.method === 'GET') {
    const admin = localRequireAdmin(req, res, store);
    if (!admin) return;
    json(res, 200, { users: store.users.map(cleanUser) });
    return;
  }

  if (url.pathname === '/api/users' && req.method === 'POST') {
    const admin = localRequireAdmin(req, res, store);
    if (!admin) return;

    const body = await readBody(req);
    const username = String(body.username || '').trim();
    const displayName = String(body.displayName || '').trim();
    const password = String(body.password || '');
    const role = body.role === 'admin' ? 'admin' : 'staff';
    const jobConcurrency = normalizeJobConcurrency(body.jobConcurrency, DEFAULT_JOB_CONCURRENCY);

    if (!username || !password) {
      json(res, 400, { message: '用户名和密码不能为空。' });
      return;
    }

    if (store.users.some(user => user.username === username)) {
      json(res, 409, { message: '这个用户名已经存在了。' });
      return;
    }

    const newUser = createUser({ username, password, role, displayName, jobConcurrency });
    store.users.push(newUser);
    store.appStates[newUser.id] = createDefaultState();
    appendLocalLog(store, {
      user: admin,
      level: 'info',
      module: 'account',
      action: 'user_created',
      message: `创建账号：${newUser.username}`,
      status: 'success',
      meta: {
        targetUserId: newUser.id,
        targetUsername: newUser.username,
        targetDisplayName: newUser.displayName,
        targetRole: newUser.role,
        targetJobConcurrency: newUser.jobConcurrency,
      },
    });
    writeLocalStore(store);
    json(res, 201, { user: cleanUser(newUser) });
    return;
  }

  if (url.pathname === '/api/agents' && req.method === 'GET') {
    const admin = localRequireAdmin(req, res, store);
    if (!admin) return;
    json(res, 200, { agents: listLocalAgents(store, admin) });
    return;
  }

  if (url.pathname === '/api/agents' && req.method === 'POST') {
    const admin = localRequireAdmin(req, res, store);
    if (!admin) return;
    const body = await readBody(req);
    const result = createLocalAgent(store, admin, body || {});
    writeLocalStore(store);
    json(res, 201, result);
    return;
  }

  if (agentDetailMatch && req.method === 'GET') {
    const admin = localRequireAdmin(req, res, store);
    if (!admin) return;
    const agent = getLocalAgentById(store, decodeURIComponent(agentDetailMatch[1]));
    if (!agent || !canManageOwnedResource(admin, agent.ownerUserId)) {
      json(res, 404, { message: '智能体不存在或无权限。' });
      return;
    }
    json(res, 200, { agent, versions: listLocalAgentVersionsByAgentId(store, agent.id) });
    return;
  }

  if (agentDetailMatch && req.method === 'PATCH') {
    const admin = localRequireAdmin(req, res, store);
    if (!admin) return;
    const body = await readBody(req);
    const agent = updateLocalAgent(store, admin, decodeURIComponent(agentDetailMatch[1]), body || {});
    if (!agent) {
      json(res, 404, { message: '智能体不存在或无权限。' });
      return;
    }
    writeLocalStore(store);
    json(res, 200, { agent });
    return;
  }

  if (agentDetailMatch && req.method === 'DELETE') {
    const admin = localRequireAdmin(req, res, store);
    if (!admin) return;
    const result = deleteLocalAgent(store, admin, decodeURIComponent(agentDetailMatch[1]));
    if (!result) {
      json(res, 404, { message: '智能体不存在或无权限。' });
      return;
    }
    writeLocalStore(store);
    json(res, 200, { ...result, message: '智能体已永久删除。' });
    return;
  }

  if (agentDraftMatch && req.method === 'POST') {
    const admin = localRequireAdmin(req, res, store);
    if (!admin) return;
    const version = createLocalAgentDraft(store, admin, decodeURIComponent(agentDraftMatch[1]));
    if (!version) {
      json(res, 404, { message: '智能体不存在或无权限。' });
      return;
    }
    writeLocalStore(store);
    json(res, 201, { version });
    return;
  }

  if (agentVersionsMatch && req.method === 'GET') {
    const admin = localRequireAdmin(req, res, store);
    if (!admin) return;
    const agent = getLocalAgentById(store, decodeURIComponent(agentVersionsMatch[1]));
    if (!agent || !canManageOwnedResource(admin, agent.ownerUserId)) {
      json(res, 404, { message: '智能体不存在或无权限。' });
      return;
    }
    json(res, 200, { versions: listLocalAgentVersionsByAgentId(store, agent.id) });
    return;
  }

  if (agentVersionDetailMatch && req.method === 'GET') {
    const admin = localRequireAdmin(req, res, store);
    if (!admin) return;
    const version = getLocalAgentVersionById(store, decodeURIComponent(agentVersionDetailMatch[1]));
    const agent = version ? getLocalAgentById(store, version.agentId) : null;
    if (!version || !agent || !canManageOwnedResource(admin, agent.ownerUserId)) {
      json(res, 404, { message: '版本不存在或无权限。' });
      return;
    }
    json(res, 200, { version });
    return;
  }

  if (agentVersionDetailMatch && req.method === 'PATCH') {
    const admin = localRequireAdmin(req, res, store);
    if (!admin) return;
    const body = await readBody(req);
    const version = updateLocalAgentVersion(store, admin, decodeURIComponent(agentVersionDetailMatch[1]), body || {});
    if (!version) {
      json(res, 400, { message: '版本不存在、已发布或无权限。' });
      return;
    }
    writeLocalStore(store);
    json(res, 200, { version });
    return;
  }

  if (agentVersionDetailMatch && req.method === 'DELETE') {
    const admin = localRequireAdmin(req, res, store);
    if (!admin) return;
    const result = deleteLocalAgentVersion(store, admin, decodeURIComponent(agentVersionDetailMatch[1]));
    if (!result) {
      json(res, 400, { message: '版本不存在、已发布或无权限，不能永久删除。' });
      return;
    }
    writeLocalStore(store);
    json(res, 200, { ...result, message: '版本已永久删除。' });
    return;
  }

  if (agentVersionValidateMatch && req.method === 'POST') {
    const admin = localRequireAdmin(req, res, store);
    if (!admin) return;
    const body = await readBody(req);
    const version = getLocalAgentVersionById(store, decodeURIComponent(agentVersionValidateMatch[1]));
    const agent = version ? getLocalAgentById(store, version.agentId) : null;
    if (!version || !agent || !canManageOwnedResource(admin, agent.ownerUserId)) {
      json(res, 404, { message: '版本不存在或无权限。' });
      return;
    }
    try {
      const result = await runLocalAgentConversation({
        store,
        user: admin,
        agent,
        version,
        priorMessages: [],
        currentMessage: String(body?.message || '请用一句话说明这个智能体能做什么。'),
      });
      const rawVersion = store.agentVersions.find((item) => item.id === version.id);
      rawVersion.validationStatus = 'success';
      rawVersion.validationSummary = {
        ...result,
        outputPreview: result.content.slice(0, 300),
        validatedAt: Date.now(),
      };
      store.agentUsageLogs.push({
        id: createEntityId(),
        userId: admin.id,
        username: admin.username,
        displayName: admin.displayName || admin.username,
        agentId: agent.id,
        agentName: agent.name,
        agentVersionId: version.id,
        sessionId: null,
        requestType: 'validation',
        selectedModel: result.selectedModel,
        usedRetrieval: result.usedRetrieval,
        retrievalSummaryJson: result.retrievalSummary,
        promptTokens: result.promptTokens,
        completionTokens: result.completionTokens,
        totalTokens: result.totalTokens,
        estimatedCost: result.estimatedCost,
        latencyMs: result.latencyMs,
        status: 'success',
        errorMessage: '',
        createdAt: Date.now(),
      });
      appendLocalLog(store, {
        user: admin,
        level: 'info',
        module: 'agent_center',
        action: 'agent_validate',
        message: `智能体验证：${agent.name}`,
        status: 'success',
        meta: buildAgentRuntimeLogMeta({ agent, version, result, requestMode: 'validation' }),
      });
      writeLocalStore(store);
      json(res, 200, { version: getLocalAgentVersionById(store, version.id), result: rawVersion.validationSummary });
    } catch (error) {
      appendLocalLog(store, {
        user: admin,
        level: 'error',
        module: 'agent_center',
        action: 'agent_validate',
        message: `智能体验证失败：${agent.name}`,
        detail: error?.message || '智能体验证失败。',
        status: 'failed',
        meta: buildAgentRuntimeLogMeta({
          agent,
          version,
          requestMode: 'validation',
          error,
        }),
      });
      writeLocalStore(store);
      json(res, 500, { message: error?.message || '智能体验证失败。' });
    }
    return;
  }

  if (agentPublishMatch && req.method === 'POST') {
    const admin = localRequireAdmin(req, res, store);
    if (!admin) return;
    const body = await readBody(req);
    const agent = getLocalAgentById(store, decodeURIComponent(agentPublishMatch[1]));
    if (!agent || !canManageOwnedResource(admin, agent.ownerUserId)) {
      json(res, 404, { message: '智能体不存在或无权限。' });
      return;
    }
    const versions = listLocalAgentVersionsByAgentId(store, agent.id);
    const targetVersion = body?.versionId ? versions.find((item) => item.id === body.versionId) : versions.find((item) => !item.isPublished) || versions[0];
    if (!targetVersion || targetVersion.validationStatus !== 'success') {
      json(res, 400, { message: '发布失败，请先完成成功验证。' });
      return;
    }
    store.agentVersions.forEach((item) => {
      if (item.agentId === agent.id) item.isPublished = item.id === targetVersion.id;
    });
    const rawAgent = store.agents.find((item) => item.id === agent.id);
    rawAgent.currentVersionId = targetVersion.id;
    rawAgent.status = 'published';
    rawAgent.updatedAt = Date.now();
    writeLocalStore(store);
    json(res, 200, { agent: getLocalAgentById(store, agent.id) });
    return;
  }

  if (agentRollbackMatch && req.method === 'POST') {
    const admin = localRequireAdmin(req, res, store);
    if (!admin) return;
    const body = await readBody(req);
    const agent = getLocalAgentById(store, decodeURIComponent(agentRollbackMatch[1]));
    if (!agent || !canManageOwnedResource(admin, agent.ownerUserId)) {
      json(res, 404, { message: '智能体不存在或无权限。' });
      return;
    }
    const targetVersion = listLocalAgentVersionsByAgentId(store, agent.id).find((item) => item.id === String(body?.versionId || ''));
    if (!targetVersion) {
      json(res, 400, { message: '回滚失败。' });
      return;
    }
    store.agentVersions.forEach((item) => {
      if (item.agentId === agent.id) item.isPublished = item.id === targetVersion.id;
    });
    const rawAgent = store.agents.find((item) => item.id === agent.id);
    rawAgent.currentVersionId = targetVersion.id;
    rawAgent.status = 'published';
    rawAgent.updatedAt = Date.now();
    writeLocalStore(store);
    json(res, 200, { agent: getLocalAgentById(store, agent.id) });
    return;
  }

  if (url.pathname === '/api/knowledge-bases' && req.method === 'GET') {
    const admin = localRequireAdmin(req, res, store);
    if (!admin) return;
    json(res, 200, { knowledgeBases: listLocalKnowledgeBases(store, admin) });
    return;
  }

  if (url.pathname === '/api/knowledge-bases' && req.method === 'POST') {
    const admin = localRequireAdmin(req, res, store);
    if (!admin) return;
    const body = await readBody(req);
    const knowledgeBase = createLocalKnowledgeBase(store, admin, body || {});
    writeLocalStore(store);
    json(res, 201, { knowledgeBase });
    return;
  }

  if (knowledgeBaseDetailMatch && req.method === 'GET') {
    const admin = localRequireAdmin(req, res, store);
    if (!admin) return;
    const knowledgeBase = getLocalKnowledgeBaseById(store, decodeURIComponent(knowledgeBaseDetailMatch[1]));
    if (!knowledgeBase || !canManageOwnedResource(admin, knowledgeBase.ownerUserId)) {
      json(res, 404, { message: '知识库不存在或无权限。' });
      return;
    }
    json(res, 200, { knowledgeBase, documents: listLocalKnowledgeDocuments(store, admin, knowledgeBase.id) });
    return;
  }

  if (knowledgeBaseDetailMatch && req.method === 'PATCH') {
    const admin = localRequireAdmin(req, res, store);
    if (!admin) return;
    const body = await readBody(req);
    const knowledgeBase = updateLocalKnowledgeBase(store, admin, decodeURIComponent(knowledgeBaseDetailMatch[1]), body || {});
    if (!knowledgeBase) {
      json(res, 404, { message: '知识库不存在或无权限。' });
      return;
    }
    writeLocalStore(store);
    json(res, 200, { knowledgeBase });
    return;
  }

  if (knowledgeBaseDetailMatch && req.method === 'DELETE') {
    const admin = localRequireAdmin(req, res, store);
    if (!admin) return;
    const knowledgeBaseId = decodeURIComponent(knowledgeBaseDetailMatch[1]);
    const deletedCount = deleteLocalKnowledgeBase(store, admin, knowledgeBaseId);
    if (!deletedCount) {
      json(res, 404, { message: '知识库不存在或无权限。' });
      return;
    }
    writeLocalStore(store);
    json(res, 200, { ok: true, deletedKnowledgeBaseId: knowledgeBaseId, message: '知识库已永久删除。' });
    return;
  }

  if (knowledgeDocumentsMatch && req.method === 'GET') {
    const admin = localRequireAdmin(req, res, store);
    if (!admin) return;
    json(res, 200, { documents: listLocalKnowledgeDocuments(store, admin, String(url.searchParams.get('knowledgeBaseId') || '')) });
    return;
  }

  if (knowledgeDocumentsMatch && req.method === 'POST') {
    const admin = localRequireAdmin(req, res, store);
    if (!admin) return;
    const body = await readBody(req);
    const document = createLocalKnowledgeDocument(store, admin, body || {});
    if (!document) {
      json(res, 404, { message: '知识库不存在或无权限。' });
      return;
    }
    writeLocalStore(store);
    json(res, 201, { document });
    return;
  }

  if (knowledgeDocumentDetailMatch && req.method === 'DELETE') {
    const admin = localRequireAdmin(req, res, store);
    if (!admin) return;
    const deletedCount = deleteLocalKnowledgeDocument(store, admin, decodeURIComponent(knowledgeDocumentDetailMatch[1]));
    writeLocalStore(store);
    json(res, 200, { ok: true, deletedCount });
    return;
  }

  if (knowledgeDocumentDetailMatch && req.method === 'PATCH') {
    const admin = localRequireAdmin(req, res, store);
    if (!admin) return;
    const body = await readBody(req);
    const document = updateLocalKnowledgeDocument(store, admin, decodeURIComponent(knowledgeDocumentDetailMatch[1]), body || {});
    if (!document) {
      json(res, 404, { message: '文档不存在或无权限。' });
      return;
    }
    writeLocalStore(store);
    json(res, 200, { document });
    return;
  }

  if (url.pathname === '/api/chat/agents' && req.method === 'GET') {
    const user = localRequireUser(req, res, store);
    if (!user) return;
    const agents = (store.agents || [])
      .filter((item) => item.status === 'published' && item.currentVersionId)
      .map((item) => getLocalAgentById(store, item.id));
    json(res, 200, { agents });
    return;
  }

  if (chatAgentHistoryMatch && req.method === 'DELETE') {
    const user = localRequireUser(req, res, store);
    if (!user) return;
    const result = deleteLocalUserAgentHistory(store, user, decodeURIComponent(chatAgentHistoryMatch[1]));
    if (!result) {
      json(res, 404, { message: '智能体不存在或无权限。' });
      return;
    }
    writeLocalStore(store);
    json(res, 200, result);
    return;
  }

  if (url.pathname === '/api/chat/sessions' && req.method === 'GET') {
    const user = localRequireUser(req, res, store);
    if (!user) return;
    const agentId = String(url.searchParams.get('agentId') || '');
    const sessions = (store.chatSessions || [])
      .filter((item) => item.userId === user.id && (!agentId || item.agentId === agentId))
      .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0))
      .map((item) => ({
        ...item,
        selectedModel: String(item.selectedModel || ''),
        reasoningLevel: item.reasoningLevel ? String(item.reasoningLevel) : null,
        webSearchEnabled: Boolean(item.webSearchEnabled),
        lastImageMode: Boolean(item.lastImageMode),
      }));
    json(res, 200, { sessions });
    return;
  }

  if (url.pathname === '/api/chat/sessions' && req.method === 'POST') {
    const user = localRequireUser(req, res, store);
    if (!user) return;
    const body = await readBody(req);
    const agent = getLocalAgentById(store, String(body?.agentId || ''));
    if (!agent?.currentVersionId || agent.status !== 'published') {
      json(res, 404, { message: '智能体不存在或尚未发布。' });
      return;
    }
    const session = {
      id: createEntityId(),
      userId: user.id,
      agentId: agent.id,
      agentVersionId: agent.currentVersionId,
      title: '新会话',
      status: 'active',
      summary: '',
      selectedModel: resolveChatSessionModel(getLocalAgentVersionById(store, agent.currentVersionId)),
      reasoningLevel: null,
      webSearchEnabled: false,
      lastImageMode: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    store.chatSessions.push(session);
    writeLocalStore(store);
    json(res, 201, { session });
    return;
  }

  if (chatSessionDetailMatch && req.method === 'PATCH') {
    const user = localRequireUser(req, res, store);
    if (!user) return;
    const sessionId = decodeURIComponent(chatSessionDetailMatch[1]);
    const session = (store.chatSessions || []).find((item) => item.id === sessionId && item.userId === user.id);
    if (!session) {
      json(res, 404, { message: '会话不存在或无权限。' });
      return;
    }
    const body = await readBody(req);
    const version = getLocalAgentVersionById(store, session.agentVersionId);
    const selectedModel = resolveChatSessionModel(version, body?.selectedModel || session.selectedModel);
    const capability = getChatModelCapability(selectedModel);
    session.selectedModel = selectedModel || '';
    session.reasoningLevel = capability?.supportsReasoningLevel && body?.reasoningLevel ? String(body.reasoningLevel) : null;
    session.webSearchEnabled = capability?.supportsWebSearch ? Boolean(body?.webSearchEnabled) : false;
    session.lastImageMode = Boolean(body?.lastImageMode);
    session.updatedAt = Date.now();
    writeLocalStore(store);
    json(res, 200, { session });
    return;
  }

  if (chatSessionDetailMatch && req.method === 'DELETE') {
    const user = localRequireUser(req, res, store);
    if (!user) return;
    const sessionId = decodeURIComponent(chatSessionDetailMatch[1]);
    const session = (store.chatSessions || []).find((item) => item.id === sessionId && item.userId === user.id);
    if (!session) {
      json(res, 404, { message: '会话不存在或无权限。' });
      return;
    }
    store.chatMessages = (store.chatMessages || []).filter((item) => !(item.sessionId === sessionId && item.userId === user.id));
    store.chatSessions = (store.chatSessions || []).filter((item) => !(item.id === sessionId && item.userId === user.id));
    writeLocalStore(store);
    json(res, 200, { ok: true, deletedSessionId: sessionId });
    return;
  }

  if (chatSessionMessagesMatch && req.method === 'GET') {
    const user = localRequireUser(req, res, store);
    if (!user) return;
    const sessionId = decodeURIComponent(chatSessionMessagesMatch[1]);
    const session = (store.chatSessions || []).find((item) => item.id === sessionId && item.userId === user.id);
    if (!session) {
      json(res, 404, { message: '会话不存在或无权限。' });
      return;
    }
    json(res, 200, { messages: (store.chatMessages || []).filter((item) => item.sessionId === sessionId && item.userId === user.id).sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0)) });
    return;
  }

  if (chatSessionMessagesMatch && req.method === 'POST') {
    const user = localRequireUser(req, res, store);
    if (!user) return;
    const sessionId = decodeURIComponent(chatSessionMessagesMatch[1]);
    const session = (store.chatSessions || []).find((item) => item.id === sessionId && item.userId === user.id);
    if (!session) {
      json(res, 404, { message: '会话不存在或无权限。' });
      return;
    }
    const version = getLocalAgentVersionById(store, session.agentVersionId);
    const agent = getLocalAgentById(store, session.agentId);
    const body = await readBody(req);
    if (!version || !agent) {
      json(res, 404, { message: '智能体版本不存在。' });
      return;
    }
    const content = String(body?.content || '').trim();
    const requestMode = body?.requestMode === 'image_generation' ? 'image_generation' : 'chat';
    const clientRequestId = String(body?.clientRequestId || createEntityId()).trim() || createEntityId();
    const selectedModel = resolveChatSessionModel(version, body?.selectedModel || session.selectedModel);
    const capability = getChatModelCapability(selectedModel);
    const attachments = Array.isArray(body?.attachments) ? body.attachments.map((item) => ({
      name: String(item?.name || '').trim() || '附件',
      url: item?.url ? String(item.url) : undefined,
      assetId: item?.assetId ? String(item.assetId) : undefined,
      mimeType: item?.mimeType ? String(item.mimeType) : undefined,
      kind: item?.kind === 'image' ? 'image' : 'file',
    })) : [];
    if (requestMode === 'image_generation' && attachments.some((item) => item.kind !== 'image')) {
      json(res, 400, { message: '生图模式暂只支持上传图片' });
      return;
    }
    if (requestMode !== 'image_generation' && attachments.some((item) => item.kind === 'image') && !capability?.supportsImageInput) {
      json(res, 400, { message: '当前模型不支持图片输入' });
      return;
    }
    if (requestMode !== 'image_generation' && attachments.some((item) => item.kind !== 'image') && !capability?.supportsFileInput) {
      json(res, 400, { message: '当前模型不支持文件输入' });
      return;
    }
    if (requestMode !== 'image_generation' && body?.webSearchEnabled && !capability?.supportsWebSearch) {
      json(res, 400, { message: '当前模型不支持联网' });
      return;
    }
    const now = Date.now();
    const userMessage = { id: createEntityId(), sessionId, userId: user.id, role: 'user', content, attachments, metadata: { selectedModel, reasoningLevel: body?.reasoningLevel || null, webSearchEnabled: Boolean(body?.webSearchEnabled), requestMode, clientRequestId }, createdAt: now };
    store.chatMessages.push(userMessage);
    const history = (store.chatMessages || []).filter((item) => item.sessionId === sessionId && item.userId === user.id).sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0));
    const systemSettings = getLocalSystemSettings(store);
    const imageKnowledgeChunks = requestMode === 'image_generation' && version.retrievalPolicy?.enabled
      ? searchKnowledgeChunks(listLocalKnowledgeChunksForVersion(store, version), content, {
          ...version.retrievalPolicy,
          topK: Math.min(Number(version.retrievalPolicy?.topK || 3), 3),
          maxChunks: Math.min(Number(version.retrievalPolicy?.maxChunks || 5), 3),
          maxContextChars: Math.min(Number(version.retrievalPolicy?.maxContextChars || 2400), 1800),
        })
      : [];
    try {
      const result = requestMode === 'image_generation'
        ? await buildImageConversationResult({
            user,
            agent,
            version,
            priorMessages: history,
            currentMessage: content,
            sessionId,
            selectedModelOverride: selectedModel,
            attachments,
            systemSettings,
            knowledgeChunks: imageKnowledgeChunks,
            conversationSummary: session.summary || '',
          })
        : await runLocalAgentConversation({
            store,
            user,
            agent,
            version,
            priorMessages: history,
            currentMessage: content,
            sessionId,
            selectedModelOverride: selectedModel,
            attachments,
            reasoningLevel: body?.reasoningLevel || null,
            webSearchEnabled: Boolean(body?.webSearchEnabled),
          });
      const assistantAttachments = Array.isArray(result.imageResultUrls) && result.imageResultUrls.length > 0
        ? result.imageResultUrls.map((url, index) => ({
            name: `生成结果${index + 1}`,
            url: String(url || ''),
            kind: 'image',
          }))
        : null;
      const assistantMessage = {
        id: createEntityId(),
        sessionId,
        userId: user.id,
        role: 'assistant',
        content: result.content,
        attachments: assistantAttachments,
        metadata: { selectedModel: result.selectedModel, usedRetrieval: result.usedRetrieval, reasoningLevel: body?.reasoningLevel || null, webSearchEnabled: Boolean(body?.webSearchEnabled), requestMode, clientRequestId, imagePlan: result.imagePlan || null, imageResultUrls: result.imageResultUrls || null, retrievalSummary: result.retrievalSummary || [] },
        createdAt: Date.now(),
      };
      store.chatMessages.push(assistantMessage);
      session.title = session.title === '新会话' ? content.slice(0, 24) : session.title;
      session.selectedModel = selectedModel || '';
      session.reasoningLevel = capability?.supportsReasoningLevel && body?.reasoningLevel ? String(body.reasoningLevel) : null;
      session.webSearchEnabled = requestMode === 'image_generation' ? false : capability?.supportsWebSearch ? Boolean(body?.webSearchEnabled) : false;
      session.lastImageMode = requestMode === 'image_generation';
      session.summary = history.length > Number(version.contextPolicy.summaryTriggerThreshold || 10)
        ? buildConversationSummary(history, Number(version.contextPolicy.maxSummaryChars || 1200))
        : (session.summary || '');
      session.updatedAt = Date.now();
      store.agentUsageLogs.push({
        id: createEntityId(),
        userId: user.id,
        username: user.username,
        displayName: user.displayName || user.username,
        agentId: agent.id,
        agentName: agent.name,
        agentVersionId: version.id,
        sessionId,
        requestType: result.requestType || requestMode,
        selectedModel: result.selectedModel,
        usedRetrieval: result.usedRetrieval,
        retrievalSummaryJson: result.retrievalSummary,
        promptTokens: result.promptTokens,
        completionTokens: result.completionTokens,
        totalTokens: result.totalTokens,
        estimatedCost: result.estimatedCost,
        latencyMs: result.latencyMs,
        status: 'success',
        errorMessage: '',
        createdAt: Date.now(),
      });
      appendLocalLog(store, {
        user,
        level: 'info',
        module: 'agent_center',
        action: requestMode === 'image_generation' ? 'create_image_task' : 'agent_chat',
        message: `${requestMode === 'image_generation' ? '智能体生图' : '智能体对话'}：${agent.name}`,
        status: 'success',
        meta: buildAgentRuntimeLogMeta({ agent, version, result: { ...result, clientRequestId }, requestMode, sessionId, clientRequestId }),
      });
      writeLocalStore(store);
      json(res, 201, { userMessage, assistantMessage, usage: result });
    } catch (error) {
      appendLocalLog(store, {
        user,
        level: 'error',
        module: 'agent_center',
        action: requestMode === 'image_generation' ? 'create_image_task' : 'agent_chat',
        message: `${requestMode === 'image_generation' ? '智能体生图失败' : '智能体对话失败'}：${agent.name}`,
        detail: error?.message || '聊天回复失败。',
        status: 'failed',
        meta: buildAgentRuntimeLogMeta({
          agent,
          version,
          requestMode,
          sessionId,
          clientRequestId,
          error,
        }),
      });
      writeLocalStore(store);
      json(res, 500, { message: error?.message || '聊天回复失败。' });
    }
    return;
  }

  if (url.pathname === '/api/agent-usage' && req.method === 'GET') {
    const admin = localRequireAdmin(req, res, store);
    if (!admin) return;
    const rows = listLocalVisibleAgentUsageRows(store, admin).slice(0, 200);
    json(res, 200, { rows });
    return;
  }

  if (url.pathname === '/api/agent-usage/summary' && req.method === 'GET') {
    const admin = localRequireAdmin(req, res, store);
    if (!admin) return;
    const rows = listLocalVisibleAgentUsageRows(store, admin);
    json(res, 200, {
      summary: {
        totalCalls: rows.length,
        successCount: rows.filter((row) => row.status === 'success').length,
        failedCount: rows.filter((row) => row.status !== 'success').length,
        activeUsers: new Set(rows.map((row) => row.userId)).size,
        totalEstimatedCost: Number(rows.reduce((sum, row) => sum + Number(row.estimatedCost || 0), 0).toFixed(6)),
      },
    });
    return;
  }

  if (url.pathname === '/api/logs' && req.method === 'GET') {
    const admin = localRequireAdmin(req, res, store);
    if (!admin) return;
    json(res, 200, listLocalLogs(store, {
      module: url.searchParams.get('module'),
      userId: url.searchParams.get('userId'),
      status: url.searchParams.get('status'),
      startAt: url.searchParams.get('startAt'),
      endAt: url.searchParams.get('endAt'),
      page: url.searchParams.get('page'),
      pageSize: url.searchParams.get('pageSize'),
    }));
    return;
  }

  if (url.pathname === '/api/logs/meta' && req.method === 'GET') {
    const admin = localRequireAdmin(req, res, store);
    if (!admin) return;
    json(res, 200, listLocalLogMeta(store));
    return;
  }

  if (url.pathname === '/api/logs' && req.method === 'DELETE') {
    const admin = localRequireAdmin(req, res, store);
    if (!admin) return;
    const body = await readBody(req);
    const deletedCount = deleteLocalLogs(store, body || {});
    appendLocalLog(store, {
      user: admin,
      level: 'info',
      module: 'account',
      action: 'clear_records',
      message: `清理运行日志 ${deletedCount} 条`,
      status: 'success',
      meta: {
        deletedCount,
        module: normalizeLogFilterValue(body?.module),
        userId: normalizeLogFilterValue(body?.userId),
        status: normalizeLogFilterValue(body?.status),
        startAt: normalizeLogFilterTimestamp(body?.startAt),
        endAt: normalizeLogFilterTimestamp(body?.endAt),
      },
    });
    writeLocalStore(store);
    json(res, 200, { ok: true, deletedCount });
    return;
  }

  if (url.pathname === '/api/logs' && req.method === 'POST') {
    const user = localRequireUser(req, res, store);
    if (!user) return;
    const body = await readBody(req);
    const log = appendLocalLog(store, {
      user,
      level: body.level === 'error' ? 'error' : 'info',
      module: String(body.module || 'system').slice(0, 60),
      action: String(body.action || 'unknown').slice(0, 100),
      message: String(body.message || '未提供日志描述').slice(0, 1000),
      detail: typeof body.detail === 'string' ? body.detail.slice(0, 10000) : '',
      status: ['success', 'failed', 'started', 'interrupted'].includes(body.status) ? body.status : 'started',
      meta: body.meta && typeof body.meta === 'object' ? body.meta : null,
    });
    writeLocalStore(store);
    json(res, 201, { ok: true, log });
    return;
  }

  if (url.pathname === '/api/stats/usage' && req.method === 'GET') {
    const admin = localRequireAdmin(req, res, store);
    if (!admin) return;
    const startDate = url.searchParams.get('startDate');
    const endDate = url.searchParams.get('endDate');
    const userId = normalizeLogFilterValue(url.searchParams.get('userId'));
    const mod = normalizeLogFilterValue(url.searchParams.get('module'));
    let filtered = store.usageDaily || [];
    if (startDate) filtered = filtered.filter((r) => r.statDate >= startDate);
    if (endDate) filtered = filtered.filter((r) => r.statDate <= endDate);
    if (userId) filtered = filtered.filter((r) => r.userId === userId);
    if (mod) filtered = filtered.filter((r) => r.module === mod);
    let resultRows = [...filtered];
    if (!mod || mod === 'agent_center') {
      let agentRows = listLocalVisibleAgentUsageRows(store, admin);
      if (startDate) agentRows = agentRows.filter((r) => new Date(r.createdAt).toISOString().split('T')[0] >= startDate);
      if (endDate) agentRows = agentRows.filter((r) => new Date(r.createdAt).toISOString().split('T')[0] <= endDate);
      if (userId) agentRows = agentRows.filter((r) => r.userId === userId);
      resultRows = [...resultRows, ...aggregateAgentUsageStatsRows(agentRows)];
    }
    json(res, 200, { rows: resultRows.sort((a, b) => a.statDate.localeCompare(b.statDate)) });
    return;
  }

  if (url.pathname === '/api/stats/backfill' && req.method === 'POST') {
    const admin = localRequireAdmin(req, res, store);
    if (!admin) return;
    const logsByKey = {};
    for (const log of store.logs || []) {
      if (!USAGE_MODULES.has(log.module) || !TERMINAL_STATUSES.has(log.status) || !USAGE_ACTIONS.has(log.action)) continue;
      const statDate = new Date(log.createdAt).toISOString().split('T')[0];
      const key = `${statDate}|${log.userId}|${log.module}`;
      if (!logsByKey[key]) {
        logsByKey[key] = { statDate, userId: log.userId, username: log.username,
          displayName: log.displayName, module: log.module, successCount: 0, failedCount: 0, interruptedCount: 0 };
      }
      if (log.status === 'success') logsByKey[key].successCount++;
      else if (log.status === 'failed') logsByKey[key].failedCount++;
      else if (log.status === 'interrupted') logsByKey[key].interruptedCount++;
    }
    store.usageDaily = Object.values(logsByKey);
    writeLocalStore(store);
    json(res, 200, { ok: true, upserted: store.usageDaily.length });
    return;
  }

  if (userDetailMatch && req.method === 'PATCH') {
    const admin = localRequireAdmin(req, res, store);
    if (!admin) return;

    const targetUserId = decodeURIComponent(userDetailMatch[1]);
    const targetUser = store.users.find(item => item.id === targetUserId);
    if (!targetUser) {
      json(res, 404, { message: '账号不存在。' });
      return;
    }

    const body = await readBody(req);
    const nextStatus = body.status === 'disabled' ? 'disabled' : body.status === 'active' ? 'active' : undefined;
    const nextRole = body.role === 'admin' ? 'admin' : body.role === 'staff' ? 'staff' : undefined;
    const nextPassword = typeof body.password === 'string' ? String(body.password) : '';
    const nextDisplayName = typeof body.displayName === 'string' ? String(body.displayName) : undefined;
    const nextJobConcurrency = body.jobConcurrency === undefined ? undefined : normalizeJobConcurrency(body.jobConcurrency, DEFAULT_JOB_CONCURRENCY);
    const previousStatus = targetUser.status;

    if (targetUser.id === admin.id && nextStatus === 'disabled') {
      json(res, 400, { message: '不能禁用当前登录管理员。' });
      return;
    }

    const activeAdminCount = store.users.filter(item => item.role === 'admin' && item.status === 'active').length;
    if (targetUser.role === 'admin' && (nextRole === 'staff' || nextStatus === 'disabled') && activeAdminCount <= 1) {
      json(res, 400, { message: '至少要保留一个可用管理员账号。' });
      return;
    }

    if (typeof nextDisplayName === 'string') targetUser.displayName = nextDisplayName.trim() || targetUser.username;
    if (nextRole) targetUser.role = nextRole;
    if (nextStatus) targetUser.status = nextStatus;
    if (nextJobConcurrency !== undefined) targetUser.jobConcurrency = nextJobConcurrency;
    if (nextPassword) {
      const passwordRecord = createPasswordRecord(nextPassword);
      targetUser.passwordHash = passwordRecord.hash;
      targetUser.salt = passwordRecord.salt;
    }

    if (nextStatus === 'disabled' || nextPassword) {
      store.sessions = store.sessions.filter(session => session.userId !== targetUser.id);
    }

    if (nextPassword) {
      appendLocalLog(store, {
        user: admin,
        level: 'info',
        module: 'account',
        action: 'password_reset',
        message: `重置密码：${targetUser.username}`,
        status: 'success',
        meta: {
          targetUserId: targetUser.id,
          targetUsername: targetUser.username,
        },
      });
    }

    if (nextStatus && nextStatus !== previousStatus) {
      appendLocalLog(store, {
        user: admin,
        level: 'info',
        module: 'account',
        action: nextStatus === 'disabled' ? 'user_disabled' : 'user_enabled',
        message: `${nextStatus === 'disabled' ? '禁用' : '启用'}账号：${targetUser.username}`,
        status: 'success',
        meta: {
          targetUserId: targetUser.id,
          targetUsername: targetUser.username,
        },
      });
    }

    writeLocalStore(store);
    json(res, 200, { user: cleanUser(targetUser) });
    return;
  }

  if (userDetailMatch && req.method === 'DELETE') {
    const admin = localRequireAdmin(req, res, store);
    if (!admin) return;

    const targetUserId = decodeURIComponent(userDetailMatch[1]);
    const targetUser = store.users.find(item => item.id === targetUserId);
    if (!targetUser) {
      json(res, 404, { message: '账号不存在。' });
      return;
    }

    if (targetUser.id === admin.id) {
      json(res, 400, { message: '不能删除当前登录管理员。' });
      return;
    }

    const activeAdminCount = store.users.filter(item => item.role === 'admin' && item.status === 'active').length;
    if (targetUser.role === 'admin' && activeAdminCount <= 1) {
      json(res, 400, { message: '至少要保留一个可用管理员账号。' });
      return;
    }

    store.users = store.users.filter(item => item.id !== targetUser.id);
    store.sessions = store.sessions.filter(session => session.userId !== targetUser.id);
    delete store.appStates[targetUser.id];
    appendLocalLog(store, {
      user: admin,
      level: 'info',
      module: 'account',
      action: 'user_deleted',
      message: `删除账号：${targetUser.username}`,
      status: 'success',
      meta: {
        targetUserId: targetUser.id,
        targetUsername: targetUser.username,
      },
    });
    writeLocalStore(store);
    json(res, 200, { ok: true });
    return;
  }

  if (url.pathname === '/api/state' && req.method === 'GET') {
    const user = localRequireUser(req, res, store);
    if (!user) return;
    store.appStates[user.id] = prepareStateForStorage(store.appStates[user.id] || createDefaultState());
    writeLocalStore(store);
    json(res, 200, { state: prepareStateForClient(store.appStates[user.id]) });
    return;
  }

  if (url.pathname === '/api/state' && req.method === 'PUT') {
    const user = localRequireUser(req, res, store);
    if (!user) return;
    const body = await readBody(req);
    store.appStates[user.id] = prepareStateForStorage(body.state || createDefaultState());
    writeLocalStore(store);
    json(res, 200, { ok: true });
    return;
  }

  if (url.pathname === '/api/system/config' && req.method === 'GET') {
    const user = localRequireUser(req, res, store);
    if (!user) return;
    const systemSettings = getLocalSystemSettings(store);
    json(res, 200, {
      config: buildPublicSystemConfig(process.env, getLocalJobQueueStats(store), {
        maxConcurrency: getLocalWorkerConcurrency(),
        systemSettings,
      }),
    });
    return;
  }

  if (url.pathname === '/api/system/config' && req.method === 'PATCH') {
    const admin = localRequireAdmin(req, res, store);
    if (!admin) return;
    const body = await readBody(req);
    const nextSettings = saveLocalSystemSettings(store, {
      ...getLocalSystemSettings(store),
      analysisModel: body?.analysisModel,
    });
    writeLocalStore(store);
    json(res, 200, {
      config: buildPublicSystemConfig(process.env, getLocalJobQueueStats(store), {
        maxConcurrency: getLocalWorkerConcurrency(),
        systemSettings: nextSettings,
      }),
    });
    return;
  }

  if (url.pathname === '/api/assets/upload' && req.method === 'POST') {
    const user = localRequireUser(req, res, store);
    if (!user) return;
    const body = await readBody(req);
    const base64Data = String(body.base64Data || '').trim();
    const mimeType = String(body.mimeType || 'application/octet-stream').trim();
    const originalFileName = String(body.fileName || 'upload.bin').trim();
    if (!base64Data) {
      json(res, 400, { message: '上传内容不能为空。' });
      return;
    }

    const persisted = await persistUploadedAssetIfEnabled({
      req,
      user,
      moduleName: String(body.module || 'system').slice(0, 60),
      fileName: originalFileName,
      mimeType,
      fileBuffer: Buffer.from(base64Data, 'base64'),
    });
    if (persisted) {
      appendLocalLog(store, {
        user,
        level: 'info',
        module: String(body.module || 'system').slice(0, 60),
        action: 'asset_persisted',
        message: `素材上传成功：${originalFileName}`,
        status: 'success',
        meta: {
          assetId: persisted.id,
          fileUrl: persisted.publicUrl,
        },
      });
      writeLocalStore(store);
      json(res, 200, { fileUrl: persisted.publicUrl, assetId: persisted.id });
      return;
    }

    const uploadPath = `mayo-storage/${sanitizePathPart(user.id)}`;
    const uploadJob = createLocalJobRecord(store, user, {
      module: String(body.module || 'system').slice(0, 60),
      taskType: 'upload_asset',
      provider: 'kie',
      payload: {
        base64Data,
        mimeType,
        fileName: `${sanitizePathPart(user.username || user.id)}_${Date.now()}_${sanitizePathPart(originalFileName)}`,
        uploadPath,
      },
      maxRetries: 1,
    });

    writeLocalStore(store);

    const result = await executeProviderJob(uploadJob, process.env, new AbortController().signal);
    const finishStore = readLocalStore();
    markLocalJobCompleted(finishStore, uploadJob.id, result, false);
    appendLocalLog(finishStore, {
      user,
      level: 'info',
      module: String(body.module || 'system').slice(0, 60),
      action: 'upload_asset',
      message: `素材上传成功：${originalFileName}`,
      status: 'success',
      meta: {
        jobId: uploadJob.id,
        uploadPath,
        fileUrl: result?.result?.fileUrl || '',
      },
    });
    writeLocalStore(finishStore);
    json(res, 200, {
      fileUrl: result?.result?.fileUrl || '',
    });
    return;
  }

  if (url.pathname === '/api/assets/upload-stream' && req.method === 'POST') {
    const user = localRequireUser(req, res, store);
    if (!user) return;
    const formData = await readMultipartFormData(req);
    const file = formData.get('file');
    const moduleName = String(formData.get('module') || 'system').slice(0, 60);
    if (!(file instanceof File)) {
      json(res, 400, { message: '上传文件不能为空。' });
      return;
    }

    const fileBuffer = Buffer.from(await file.arrayBuffer());
    const persisted = await persistUploadedAssetIfEnabled({
      req,
      user,
      moduleName,
      fileName: file.name || 'upload.bin',
      mimeType: file.type || 'application/octet-stream',
      fileBuffer,
    });
    if (persisted) {
      appendLocalLog(store, {
        user,
        level: 'info',
        module: moduleName,
        action: 'asset_persisted',
        message: `素材上传成功：${file.name || 'upload.bin'}`,
        status: 'success',
        meta: {
          assetId: persisted.id,
          fileUrl: persisted.publicUrl,
        },
      });
      writeLocalStore(store);
      json(res, 200, { fileUrl: persisted.publicUrl, assetId: persisted.id });
      return;
    }

    const uploadPath = `mayo-storage/${sanitizePathPart(user.id)}`;
    const result = await executeProviderJob({
      taskType: 'upload_asset',
      payload: {
        fileBuffer,
        mimeType: file.type || 'application/octet-stream',
        fileName: `${sanitizePathPart(user.username || user.id)}_${Date.now()}_${sanitizePathPart(file.name || 'upload.bin')}`,
        uploadPath,
      },
    }, process.env, new AbortController().signal);

    appendLocalLog(store, {
      user,
      level: 'info',
      module: moduleName,
      action: 'upload_asset',
      message: `素材上传成功：${file.name || 'upload.bin'}`,
      status: 'success',
      meta: {
        uploadPath,
        fileUrl: result?.result?.fileUrl || '',
      },
    });
    writeLocalStore(store);
    json(res, 200, { fileUrl: result?.result?.fileUrl || '' });
    return;
  }

  if (url.pathname === '/api/jobs' && req.method === 'POST') {
    const user = localRequireUser(req, res, store);
    if (!user) return;
    const body = await readBody(req);
    if (!body?.taskType || !body?.provider) {
      json(res, 400, { message: '任务类型和 provider 不能为空。' });
      return;
    }

    const jobPayload = {
      module: body.module,
      taskType: body.taskType,
      provider: body.provider,
      payload: body.payload,
      priority: body.priority,
      maxRetries: body.maxRetries,
    };
    const reusableJob = findReusableLocalJobRecord(store, user, jobPayload);
    if (reusableJob) {
      json(res, 200, { job: reusableJob, deduped: true });
      return;
    }
    const job = createLocalJobRecord(store, user, jobPayload);
    appendLocalLog(store, {
      user,
      level: 'info',
      module: job.module,
      action: 'job_created',
      message: `创建任务：${job.taskType}`,
      status: 'started',
      meta: {
        jobId: job.id,
        provider: job.provider,
      },
    });
    writeLocalStore(store);
    localJobWorker?.trigger?.();
    json(res, 201, { job });
    return;
  }

  if (url.pathname === '/api/jobs' && req.method === 'GET') {
    const user = localRequireUser(req, res, store);
    if (!user) return;
    const jobs = listLocalJobsForUser(store, user.id, { limit: url.searchParams.get('limit') || 100 });
    json(res, 200, { jobs });
    return;
  }

  const jobDetailMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)$/);
  const jobCancelMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)\/cancel$/);
  const jobRetryMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)\/retry$/);

  if (jobDetailMatch && req.method === 'GET') {
    const user = localRequireUser(req, res, store);
    if (!user) return;
    const job = getLocalJobByIdForUser(user, decodeURIComponent(jobDetailMatch[1]));
    if (!job) {
      json(res, 404, { message: '任务不存在。' });
      return;
    }
    json(res, 200, { job });
    return;
  }

  if (jobCancelMatch && req.method === 'POST') {
    const user = localRequireUser(req, res, store);
    if (!user) return;
    const jobId = decodeURIComponent(jobCancelMatch[1]);
    const job = getLocalJobByIdForUser(user, jobId);
    if (!job) {
      json(res, 404, { message: '任务不存在。' });
      return;
    }
    requestLocalCancelJob(store, jobId);
    appendLocalLog(store, {
      user,
      level: 'info',
      module: job.module,
      action: 'job_cancel_requested',
      message: `请求取消任务：${job.id}`,
      status: 'interrupted',
      meta: {
        jobId: job.id,
        providerTaskId: job.providerTaskId || '',
        provider: job.provider,
        taskType: job.taskType,
        jobCreatedAt: job.createdAt,
      },
    });
    writeLocalStore(store);
    localJobWorker?.cancelActiveJob(job.id);
    json(res, 200, { ok: true });
    return;
  }

  if (jobRetryMatch && req.method === 'POST') {
    const user = localRequireUser(req, res, store);
    if (!user) return;
    const jobId = decodeURIComponent(jobRetryMatch[1]);
    const job = getLocalJobByIdForUser(user, jobId);
    if (!job) {
      json(res, 404, { message: '任务不存在。' });
      return;
    }
    requestLocalRetryJob(store, jobId);
    appendLocalLog(store, {
      user,
      level: 'info',
      module: job.module,
      action: 'job_retried',
      message: `重新排队任务：${job.id}`,
      status: 'started',
      meta: {
        jobId: job.id,
        providerTaskId: job.providerTaskId || '',
        provider: job.provider,
        taskType: job.taskType,
        jobCreatedAt: job.createdAt,
      },
    });
    writeLocalStore(store);
    localJobWorker?.trigger?.();
    json(res, 200, { ok: true });
    return;
  }

  if (url.pathname === '/api/jobs/recover' && req.method === 'POST') {
    const user = localRequireUser(req, res, store);
    if (!user) return;
    const body = await readBody(req);
    if (!body?.providerTaskId || !body?.provider || !body?.taskType) {
      json(res, 400, { message: '恢复任务缺少必要参数。' });
      return;
    }

    const jobPayload = {
      module: body.module || 'system',
      taskType: body.taskType,
      provider: body.provider,
      payload: {
        ...body.payload,
        providerTaskId: body.providerTaskId,
      },
      maxRetries: body.maxRetries ?? 1,
    };
    const reusableJob = findReusableLocalJobRecord(store, user, jobPayload);
    if (reusableJob) {
      json(res, 200, { job: reusableJob, deduped: true });
      return;
    }
    const job = createLocalJobRecord(store, user, jobPayload);
    writeLocalStore(store);
    localJobWorker?.trigger?.();
    json(res, 201, { job });
    return;
  }

  json(res, 404, { message: '接口不存在。' });
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host}`);
  res.__corsHeaders = buildCorsHeaders(req);

  if (req.method === 'OPTIONS') {
    json(res, 200, { ok: true });
    return;
  }

  try {
    if (url.pathname === '/api/health' && req.method === 'GET') {
      json(res, 200, { ok: true, mode: shouldUseMysql ? 'internal-mysql-v1' : 'internal-v1' });
      return;
    }

    if (!url.pathname.startsWith('/api/') && tryServeFrontend(req, res, url)) {
      return;
    }

    if (shouldUseMysql) {
      await handleMysqlRequest(req, res, url);
      return;
    }

    await handleLocalRequest(req, res, url);
  } catch (error) {
    console.error(error);
    if (error.message === 'REQUEST_BODY_TOO_LARGE') {
      json(res, 413, { message: '请求内容过大，请压缩后重试。' });
      return;
    }
    json(res, 500, { message: '服务端处理失败。', detail: error.message });
  }
});

const bootstrap = async () => {
  if (shouldUseMysql) {
    await ensureMysqlSchema();
    jobWorker = createJobWorker({
      getPool: getMysqlPool,
      executeJob: async (job, signal) => {
        const output = await executeProviderJob(job, process.env, signal);
        return persistJobOutputAssetsIfEnabled(job, output);
      },
      getMaxConcurrency: getDbWorkerConcurrency,
      createLog: createDbLog,
      findUserById: findDbUserById,
    });
    jobWorker.start(1000);
    console.log(`Meiao internal server listening on http://0.0.0.0:${PORT} (MySQL mode)`);
    console.log(`MySQL target: ${dbConfig.host}:${dbConfig.port}/${dbConfig.database}`);
  } else {
    ensureLocalStore();
    localJobWorker = createLocalJobWorker({
      readStore: readLocalStore,
      writeStore: writeLocalStore,
      executeJob: async (job, signal) => {
        const output = await executeProviderJob(job, process.env, signal);
        return persistJobOutputAssetsIfEnabled(job, output);
      },
      getMaxConcurrency: getLocalWorkerConcurrency,
      createLog: (payload) => {
        const store = readLocalStore();
        appendLocalLog(store, payload);
        writeLocalStore(store);
      },
      findUserById: (userId) => findLocalUserById(userId),
    });
    localJobWorker.start(1000);
    console.log(`Meiao internal server listening on http://0.0.0.0:${PORT} (Local JSON mode)`);
  }

  console.log('Default admin username:', process.env.MEIAO_ADMIN_USERNAME || 'admin');
  console.log('Default admin password:', process.env.MEIAO_ADMIN_PASSWORD || 'Meiao123456');

  if (!assetCleanupTimer) {
    assetCleanupTimer = setInterval(() => {
      void cleanupExpiredStoredAssets().catch((error) => {
        console.error('asset cleanup failed', error);
      });
    }, ASSET_CLEANUP_INTERVAL_MS);
    void cleanupExpiredStoredAssets().catch((error) => {
      console.error('asset cleanup failed', error);
    });
  }

  server.listen(PORT);
};

bootstrap().catch((error) => {
  console.error('Server bootstrap failed:', error);
  process.exit(1);
});
