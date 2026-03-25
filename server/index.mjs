import { createServer } from 'node:http';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataDir = path.join(__dirname, 'data');
const storePath = path.join(dataDir, 'internal-store.json');
const distDir = path.join(__dirname, '..', 'dist');
const PORT = Number(process.env.PORT || 3100);
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;

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

const defaultApiConfig = {
  kieApiKey: '265262466b15cd45e574dc0dd846a8fc',
  concurrency: 5,
  arkApiKey: 'ad4fa376-91ef-4ba4-b8f4-84a9fa272439',
  rhWebappId: '',
  rhApiKey: '',
  rhQuickCreateCode: '',
};

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

const createDefaultState = () => ({
  activeModule: 'one_click',
  apiConfig: defaultApiConfig,
  moduleConfig: defaultModuleConfig,
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

const createUser = ({ username, password, role = 'staff', displayName = '' }) => {
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
  };
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
      appStates: {
        [admin.id]: createDefaultState(),
      },
    };
    writeFileSync(storePath, JSON.stringify(initialStore, null, 2), 'utf8');
  }
};

const readLocalStore = () => {
  ensureLocalStore();
  return JSON.parse(readFileSync(storePath, 'utf8'));
};

const writeLocalStore = (store) => {
  writeFileSync(storePath, JSON.stringify(store, null, 2), 'utf8');
};

const json = (res, statusCode, payload) => {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, OPTIONS',
  });
  res.end(JSON.stringify(payload));
};

const readBody = async (req) => {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
};

const serveStaticFile = (res, filePath) => {
  const ext = path.extname(filePath).toLowerCase();
  const contentType = STATIC_CONTENT_TYPES[ext] || 'application/octet-stream';
  const body = readFileSync(filePath);
  res.writeHead(200, { 'Content-Type': contentType });
  res.end(body);
};

const tryServeFrontend = (req, res, url) => {
  if (req.method !== 'GET') return false;
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
    serveStaticFile(res, targetPath);
    return true;
  }

  const fallbackPath = path.join(distDir, 'index.html');
  if (existsSync(fallbackPath)) {
    serveStaticFile(res, fallbackPath);
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
      password_hash VARCHAR(128) NOT NULL,
      salt VARCHAR(64) NOT NULL,
      created_at BIGINT NOT NULL,
      last_login_at BIGINT NULL
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);

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

  const [rows] = await pool.query('SELECT id FROM users LIMIT 1');
  if (Array.isArray(rows) && rows.length === 0) {
    const admin = createUser({
      username: process.env.MEIAO_ADMIN_USERNAME || 'admin',
      password: process.env.MEIAO_ADMIN_PASSWORD || 'Meiao123456',
      role: 'admin',
      displayName: '管理员',
    });

    await pool.query(
      `INSERT INTO users (id, username, display_name, role, status, password_hash, salt, created_at, last_login_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        admin.id,
        admin.username,
        admin.displayName,
        admin.role,
        admin.status,
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
    return createDefaultState();
  }

  return JSON.parse(rows[0].state_json);
};

const saveDbAppState = async (userId, state) => {
  const pool = await getMysqlPool();
  await pool.query(
    `INSERT INTO app_states (user_id, state_json, updated_at)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE state_json = VALUES(state_json), updated_at = VALUES(updated_at)`,
    [userId, JSON.stringify(state || createDefaultState()), Date.now()]
  );
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

const createDbUser = async ({ username, password, role = 'staff', displayName = '' }) => {
  const pool = await getMysqlPool();
  const newUser = createUser({ username, password, role, displayName });
  await pool.query(
    `INSERT INTO users (id, username, display_name, role, status, password_hash, salt, created_at, last_login_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      newUser.id,
      newUser.username,
      newUser.displayName,
      newUser.role,
      newUser.status,
      newUser.passwordHash,
      newUser.salt,
      newUser.createdAt,
      newUser.lastLoginAt,
    ]
  );
  await saveDbAppState(newUser.id, createDefaultState());
  return newUser;
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
  if (url.pathname === '/api/auth/login' && req.method === 'POST') {
    const body = await readBody(req);
    const username = String(body.username || '').trim();
    const password = String(body.password || '');
    const user = await findDbUserByUsername(username);

    if (!user || !verifyPassword(password, user.passwordHash, user.salt)) {
      json(res, 401, { message: '用户名或密码不正确。' });
      return;
    }

    const loginTime = Date.now();
    await updateDbUserLoginTime(user.id, loginTime);
    await ensureDbAppState(user.id);
    const token = await createDbSession(user.id);
    const freshUser = await findDbUserById(user.id);
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
    const token = getTokenFromRequest(req);
    if (token) {
      await deleteDbSession(token);
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

    if (!username || !password) {
      json(res, 400, { message: '用户名和密码不能为空。' });
      return;
    }

    const existingUser = await findDbUserByUsername(username);
    if (existingUser) {
      json(res, 409, { message: '这个用户名已经存在了。' });
      return;
    }

    const newUser = await createDbUser({ username, password, role, displayName });
    json(res, 201, { user: cleanUser(newUser) });
    return;
  }

  if (url.pathname === '/api/state' && req.method === 'GET') {
    const user = await requireDbUser(req, res);
    if (!user) return;
    const state = await getDbAppState(user.id);
    json(res, 200, { state });
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

  json(res, 404, { message: '接口不存在。' });
};

const handleLocalRequest = async (req, res, url) => {
  let store = readLocalStore();

  if (url.pathname === '/api/auth/login' && req.method === 'POST') {
    const body = await readBody(req);
    const username = String(body.username || '').trim();
    const password = String(body.password || '');
    const user = store.users.find(item => item.username === username && item.status === 'active');

    if (!user || !verifyPassword(password, user.passwordHash, user.salt)) {
      json(res, 401, { message: '用户名或密码不正确。' });
      return;
    }

    user.lastLoginAt = Date.now();
    const token = localCreateSession(store, user.id);
    if (!store.appStates[user.id]) {
      store.appStates[user.id] = createDefaultState();
    }
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
    const token = getTokenFromRequest(req);
    store.sessions = store.sessions.filter(session => session.token !== token);
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

    if (!username || !password) {
      json(res, 400, { message: '用户名和密码不能为空。' });
      return;
    }

    if (store.users.some(user => user.username === username)) {
      json(res, 409, { message: '这个用户名已经存在了。' });
      return;
    }

    const newUser = createUser({ username, password, role, displayName });
    store.users.push(newUser);
    store.appStates[newUser.id] = createDefaultState();
    writeLocalStore(store);
    json(res, 201, { user: cleanUser(newUser) });
    return;
  }

  if (url.pathname === '/api/state' && req.method === 'GET') {
    const user = localRequireUser(req, res, store);
    if (!user) return;
    json(res, 200, { state: store.appStates[user.id] || createDefaultState() });
    return;
  }

  if (url.pathname === '/api/state' && req.method === 'PUT') {
    const user = localRequireUser(req, res, store);
    if (!user) return;
    const body = await readBody(req);
    store.appStates[user.id] = body.state || createDefaultState();
    writeLocalStore(store);
    json(res, 200, { ok: true });
    return;
  }

  json(res, 404, { message: '接口不存在。' });
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host}`);

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
    json(res, 500, { message: '服务端处理失败。', detail: error.message });
  }
});

const bootstrap = async () => {
  if (shouldUseMysql) {
    await ensureMysqlSchema();
    console.log(`Meiao internal server listening on http://0.0.0.0:${PORT} (MySQL mode)`);
    console.log(`MySQL target: ${dbConfig.host}:${dbConfig.port}/${dbConfig.database}`);
  } else {
    ensureLocalStore();
    console.log(`Meiao internal server listening on http://0.0.0.0:${PORT} (Local JSON mode)`);
  }

  console.log('Default admin username:', process.env.MEIAO_ADMIN_USERNAME || 'admin');
  console.log('Default admin password:', process.env.MEIAO_ADMIN_PASSWORD || 'Meiao123456');

  server.listen(PORT);
};

bootstrap().catch((error) => {
  console.error('Server bootstrap failed:', error);
  process.exit(1);
});
