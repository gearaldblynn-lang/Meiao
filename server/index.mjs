import { createServer } from 'node:http';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { createReadStream, mkdirSync, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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
  'imageUrl',
  'whiteBgImageUrl',
  'previousBoardImageUrl',
]);
const TRACKED_URL_ARRAY_FIELDS = new Set(['uploadedProductUrls', 'veoReferenceImages']);
const NULLABLE_TRACKED_FIELDS = new Set(['uploadedReferenceUrl', 'lastStyleUrl', 'whiteBgImageUrl']);

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
  arkApiKey: '',
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
  jobConcurrency: normalizeJobConcurrency(user?.jobConcurrency, DEFAULT_JOB_CONCURRENCY),
});

const createUser = ({ username, password, role = 'staff', displayName = '', jobConcurrency = DEFAULT_JOB_CONCURRENCY }) => {
  const passwordRecord = createPasswordRecord(password);
  return {
    id: randomBytes(12).toString('hex'),
    username,
    displayName: displayName || username,
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

const getLogRetentionCutoff = () => Date.now() - LOG_RETENTION_MS;

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
  store.appStates = store.appStates && typeof store.appStates === 'object' ? store.appStates : {};
  store.usageDaily = Array.isArray(store.usageDaily) ? store.usageDaily : [];
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
  role: user.role,
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

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id VARCHAR(24) PRIMARY KEY,
      username VARCHAR(100) NOT NULL UNIQUE,
      display_name VARCHAR(100) NOT NULL,
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
      `INSERT INTO users (id, username, display_name, role, status, job_concurrency, password_hash, salt, created_at, last_login_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        admin.id,
        admin.username,
        admin.displayName,
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
    `INSERT INTO users (id, username, display_name, role, status, job_concurrency, password_hash, salt, created_at, last_login_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      newUser.id,
      newUser.username,
      newUser.displayName,
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

const USAGE_MODULES = new Set(['one_click', 'translation', 'buyer_show', 'retouch', 'video']);
const TERMINAL_STATUSES = new Set(['success', 'failed', 'interrupted']);
const USAGE_ACTIONS = new Set([
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

const listDbLogs = async (filters = {}) => {
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

  const [rows] = await pool.query(
    `SELECT id, created_at, level, module, action, message, detail, status, user_id, username, display_name, meta_json
     FROM internal_logs
     WHERE ${clauses.join(' AND ')}
     ORDER BY created_at DESC
     LIMIT 200`,
    values
  );

  return rows.map((row) => ({
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
  }));
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

  if (url.pathname === '/api/logs' && req.method === 'GET') {
    const admin = await requireDbAdmin(req, res);
    if (!admin) return;
    const logs = await listDbLogs({
      module: url.searchParams.get('module'),
      userId: url.searchParams.get('userId'),
      status: url.searchParams.get('status'),
      startAt: url.searchParams.get('startAt'),
      endAt: url.searchParams.get('endAt'),
    });
    json(res, 200, { logs });
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
    json(res, 200, {
      rows: rows.map((r) => ({
        statDate: typeof r.stat_date === 'string' ? r.stat_date : new Date(r.stat_date).toISOString().split('T')[0],
        userId: r.user_id, username: r.username, displayName: r.display_name, module: r.module,
        successCount: Number(r.success_count), failedCount: Number(r.failed_count),
        interruptedCount: Number(r.interrupted_count),
      })),
    });
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
       WHERE module IN ('one_click','translation','buyer_show','retouch','video')
       AND status IN ('success','failed','interrupted')
       AND action IN ('generate_main_scheme','generate_detail_scheme','generate_single','generate_board','regenerate_board','create_image_task')
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
    json(res, 200, {
      config: buildPublicSystemConfig(process.env, queueStats, { maxConcurrency: await getDbWorkerConcurrency() }),
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

  if (url.pathname === '/api/logs' && req.method === 'GET') {
    const admin = localRequireAdmin(req, res, store);
    if (!admin) return;
    json(res, 200, {
      logs: normalizeLogs(store.logs).filter((log) => matchesLogFilters(log, {
        module: url.searchParams.get('module'),
        userId: url.searchParams.get('userId'),
        status: url.searchParams.get('status'),
        startAt: url.searchParams.get('startAt'),
        endAt: url.searchParams.get('endAt'),
      })),
    });
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
    json(res, 200, { rows: filtered.sort((a, b) => a.statDate.localeCompare(b.statDate)) });
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
    json(res, 200, {
      config: buildPublicSystemConfig(process.env, getLocalJobQueueStats(store), { maxConcurrency: getLocalWorkerConcurrency() }),
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
