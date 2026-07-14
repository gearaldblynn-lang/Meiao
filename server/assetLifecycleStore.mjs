import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_REGISTRY_PATH = path.join(__dirname, 'data', 'asset-cleanup-registry.json');
const DEFAULT_RETRY_BASE_MS = 60_000;
const DEFAULT_MAX_ATTEMPTS_BEFORE_MANUAL_REVIEW = 8;
const DEFAULT_MANUAL_REVIEW_RETRY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_IN_PROGRESS_LEASE_MS = 10 * 60 * 1000;
const CLAIMABLE_STATUSES = new Set(['pending', 'retry', 'manual_review']);

const taskFingerprint = (input) => createHash('sha256').update([
  String(input?.action || 'delete'),
  String(input?.provider || 'internal'),
  String(input?.bucket || ''),
  String(input?.region || ''),
  String(input?.storageKey || ''),
].join('\0')).digest('hex');

const sanitizeCleanupError = (error) => {
  const message = String(error?.message || '').replace(/[\r\n]+/g, ' ').trim();
  if (!message || /secret|credential|signature|token|q-sign|authorization/i.test(message)) {
    return 'managed_asset_cleanup_failed';
  }
  return message.slice(0, 240);
};

const parsePositiveInteger = (value, fallback) => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const normalizeTaskInput = (input, timestamp) => {
  const storageKey = String(input?.storageKey || '').trim();
  if (!storageKey) throw new Error('素材清理任务缺少 storageKey');
  const provider = String(input?.provider || 'internal').trim().slice(0, 40) || 'internal';
  const action = String(input?.action || 'delete').trim().slice(0, 20) || 'delete';
  const normalized = {
    id: String(input?.id || randomBytes(12).toString('hex')).slice(0, 24),
    assetId: String(input?.assetId || '').trim().slice(0, 24),
    provider,
    bucket: String(input?.bucket || '').trim().slice(0, 255),
    region: String(input?.region || '').trim().slice(0, 60),
    storageKey: storageKey.slice(0, 512),
    action,
    reason: String(input?.reason || 'unspecified').trim().slice(0, 80) || 'unspecified',
    status: 'pending',
    attemptCount: 0,
    nextAttemptAt: timestamp,
    lastError: '',
    createdAt: timestamp,
    updatedAt: timestamp,
    completedAt: null,
  };
  return { ...normalized, objectFingerprint: taskFingerprint(normalized) };
};

const mapCleanupRow = (row) => ({
  id: String(row.id || ''),
  assetId: String(row.asset_id || ''),
  provider: String(row.provider || 'internal'),
  bucket: String(row.bucket || ''),
  region: String(row.region || ''),
  storageKey: String(row.storage_key || ''),
  action: String(row.action || 'delete'),
  reason: String(row.reason || ''),
  status: String(row.status || 'pending'),
  attemptCount: Number(row.attempt_count || 0),
  nextAttemptAt: Number(row.next_attempt_at || 0),
  lastError: String(row.last_error || ''),
  objectFingerprint: String(row.object_fingerprint || ''),
  createdAt: Number(row.created_at || 0),
  updatedAt: Number(row.updated_at || 0),
  completedAt: row.completed_at === null || row.completed_at === undefined
    ? null
    : Number(row.completed_at),
});

const getRegistryPath = (options) => String(options?.registryPath || DEFAULT_REGISTRY_PATH);

const readRegistry = (options = {}) => {
  const registryPath = getRegistryPath(options);
  mkdirSync(path.dirname(registryPath), { recursive: true });
  if (!existsSync(registryPath)) return { tasks: [] };
  try {
    const parsed = JSON.parse(readFileSync(registryPath, 'utf8'));
    return { tasks: Array.isArray(parsed?.tasks) ? parsed.tasks : [] };
  } catch {
    return { tasks: [] };
  }
};

const writeRegistry = (registry, options = {}) => {
  const registryPath = getRegistryPath(options);
  mkdirSync(path.dirname(registryPath), { recursive: true });
  const temporaryPath = `${registryPath}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, JSON.stringify(registry, null, 2), 'utf8');
  renameSync(temporaryPath, registryPath);
};

export const ensureAssetLifecycleSchema = async (pool) => {
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS asset_cleanup_tasks (
      id VARCHAR(24) PRIMARY KEY,
      asset_id VARCHAR(24) NULL,
      provider VARCHAR(40) NOT NULL,
      bucket VARCHAR(255) NOT NULL DEFAULT '',
      region VARCHAR(60) NOT NULL DEFAULT '',
      storage_key VARCHAR(512) NOT NULL,
      action VARCHAR(20) NOT NULL DEFAULT 'delete',
      reason VARCHAR(80) NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'pending',
      attempt_count INT NOT NULL DEFAULT 0,
      next_attempt_at BIGINT NOT NULL,
      last_error VARCHAR(255) NOT NULL DEFAULT '',
      object_fingerprint CHAR(64) NOT NULL,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL,
      completed_at BIGINT NULL,
      UNIQUE KEY uniq_asset_cleanup_object (object_fingerprint),
      INDEX idx_asset_cleanup_due (status, next_attempt_at),
      INDEX idx_asset_cleanup_asset (asset_id)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);
};

export const enqueueAssetCleanupTask = async (pool, input, options = {}) => {
  const timestamp = Number(options.now?.() ?? Date.now());
  const task = normalizeTaskInput(input, timestamp);
  if (!pool) {
    const registry = readRegistry(options);
    const existing = registry.tasks.find((item) => item.objectFingerprint === task.objectFingerprint);
    if (existing) {
      if (existing.status === 'protected') {
        Object.assign(existing, {
          assetId: task.assetId,
          reason: task.reason,
          status: 'pending',
          nextAttemptAt: timestamp,
          lastError: '',
          updatedAt: timestamp,
          completedAt: null,
        });
        writeRegistry(registry, options);
      }
      return { ...existing };
    }
    registry.tasks.push(task);
    writeRegistry(registry, options);
    return task;
  }

  await pool.query(
    `INSERT INTO asset_cleanup_tasks (
      id, asset_id, provider, bucket, region, storage_key, action, reason, status,
      attempt_count, next_attempt_at, last_error, object_fingerprint, created_at,
      updated_at, completed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      updated_at = IF(status = 'protected', VALUES(updated_at), updated_at),
      next_attempt_at = IF(status = 'protected', VALUES(next_attempt_at), next_attempt_at),
      reason = IF(status = 'protected', VALUES(reason), reason),
      completed_at = IF(status = 'protected', NULL, completed_at),
      last_error = IF(status = 'protected', '', last_error),
      status = IF(status = 'protected', 'pending', status)`,
    [
      task.id,
      task.assetId || null,
      task.provider,
      task.bucket,
      task.region,
      task.storageKey,
      task.action,
      task.reason,
      task.status,
      task.attemptCount,
      task.nextAttemptAt,
      task.lastError,
      task.objectFingerprint,
      task.createdAt,
      task.updatedAt,
      task.completedAt,
    ],
  );
  const [rows] = await pool.query(
    'SELECT * FROM asset_cleanup_tasks WHERE object_fingerprint = ? LIMIT 1',
    [task.objectFingerprint],
  );
  return rows?.[0] ? mapCleanupRow(rows[0]) : task;
};

const claimDueWithRunner = async (runner, limit, timestamp, leaseMs) => {
  await runner.query(
    `UPDATE asset_cleanup_tasks
     SET status = 'retry', updated_at = ?
     WHERE status = 'in_progress' AND updated_at <= ?`,
    [timestamp, timestamp - leaseMs],
  );
  const [rows] = await runner.query(
    `SELECT * FROM asset_cleanup_tasks
     WHERE status IN ('pending', 'retry', 'manual_review')
       AND next_attempt_at <= ?
     ORDER BY next_attempt_at ASC, created_at ASC
     LIMIT ?
     FOR UPDATE SKIP LOCKED`,
    [timestamp, limit],
  );
  const tasks = (rows || []).map(mapCleanupRow);
  if (tasks.length > 0) {
    const placeholders = tasks.map(() => '?').join(', ');
    await runner.query(
      `UPDATE asset_cleanup_tasks SET status = 'in_progress', updated_at = ? WHERE id IN (${placeholders})`,
      [timestamp, ...tasks.map((task) => task.id)],
    );
  }
  return tasks.map((task) => ({ ...task, status: 'in_progress', updatedAt: timestamp }));
};

export const claimDueAssetCleanupTasks = async (pool, limit = 20, options = {}) => {
  const timestamp = Number(options.now?.() ?? Date.now());
  const boundedLimit = Math.max(1, Math.min(200, Number.parseInt(String(limit || 20), 10) || 20));
  const leaseMs = parsePositiveInteger(options.inProgressLeaseMs, DEFAULT_IN_PROGRESS_LEASE_MS);
  if (!pool) {
    const registry = readRegistry(options);
    for (const task of registry.tasks) {
      if (task.status === 'in_progress' && Number(task.updatedAt || 0) <= timestamp - leaseMs) {
        task.status = 'retry';
        task.updatedAt = timestamp;
      }
    }
    const due = registry.tasks
      .filter((task) => CLAIMABLE_STATUSES.has(task.status) && Number(task.nextAttemptAt || 0) <= timestamp)
      .sort((left, right) => Number(left.nextAttemptAt || 0) - Number(right.nextAttemptAt || 0))
      .slice(0, boundedLimit);
    due.forEach((task) => {
      task.status = 'in_progress';
      task.updatedAt = timestamp;
    });
    if (due.length > 0) writeRegistry(registry, options);
    return due.map((task) => ({ ...task }));
  }

  if (typeof pool.getConnection !== 'function') {
    return claimDueWithRunner(pool, boundedLimit, timestamp, leaseMs);
  }
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const tasks = await claimDueWithRunner(connection, boundedLimit, timestamp, leaseMs);
    await connection.commit();
    return tasks;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

export const completeAssetCleanupTask = async (pool, taskId, options = {}) => {
  const timestamp = Number(options.now?.() ?? Date.now());
  if (!pool) {
    const registry = readRegistry(options);
    const task = registry.tasks.find((item) => item.id === taskId);
    if (!task) return null;
    Object.assign(task, {
      status: 'complete',
      lastError: '',
      updatedAt: timestamp,
      completedAt: timestamp,
    });
    writeRegistry(registry, options);
    return { ...task };
  }
  await pool.query(
    `UPDATE asset_cleanup_tasks
     SET status = 'complete', last_error = '', updated_at = ?, completed_at = ?
     WHERE id = ?`,
    [timestamp, timestamp, taskId],
  );
  return { id: taskId, status: 'complete', completedAt: timestamp };
};

export const protectAssetCleanupTask = async (pool, taskId, options = {}) => {
  const timestamp = Number(options.now?.() ?? Date.now());
  if (!pool) {
    const registry = readRegistry(options);
    const task = registry.tasks.find((item) => item.id === taskId);
    if (!task) return null;
    Object.assign(task, {
      status: 'protected',
      lastError: '',
      updatedAt: timestamp,
      completedAt: null,
    });
    writeRegistry(registry, options);
    return { ...task };
  }
  await pool.query(
    `UPDATE asset_cleanup_tasks
     SET status = 'protected', last_error = '', updated_at = ?, completed_at = NULL
     WHERE id = ?`,
    [timestamp, taskId],
  );
  return { id: taskId, status: 'protected', updatedAt: timestamp };
};

export const retryAssetCleanupTask = async (pool, taskId, error, options = {}) => {
  const timestamp = Number(options.now?.() ?? Date.now());
  const retryBaseMs = parsePositiveInteger(
    options.retryBaseMs ?? process.env.MEIAO_ASSET_CLEANUP_RETRY_BASE_MS,
    DEFAULT_RETRY_BASE_MS,
  );
  const maxAttempts = parsePositiveInteger(
    options.maxAttemptsBeforeManualReview ?? process.env.MEIAO_ASSET_CLEANUP_MANUAL_REVIEW_ATTEMPTS,
    DEFAULT_MAX_ATTEMPTS_BEFORE_MANUAL_REVIEW,
  );
  const manualReviewRetryMs = parsePositiveInteger(
    options.manualReviewRetryMs ?? process.env.MEIAO_ASSET_CLEANUP_MANUAL_RETRY_MS,
    DEFAULT_MANUAL_REVIEW_RETRY_MS,
  );
  const lastError = sanitizeCleanupError(error);

  if (!pool) {
    const registry = readRegistry(options);
    const task = registry.tasks.find((item) => item.id === taskId);
    if (!task) return null;
    const attemptCount = Number(task.attemptCount || 0) + 1;
    const manualReview = attemptCount >= maxAttempts;
    Object.assign(task, {
      status: manualReview ? 'manual_review' : 'retry',
      attemptCount,
      nextAttemptAt: timestamp + (manualReview
        ? manualReviewRetryMs
        : retryBaseMs * (2 ** Math.min(attemptCount - 1, 10))),
      lastError,
      updatedAt: timestamp,
      completedAt: null,
    });
    writeRegistry(registry, options);
    return { ...task };
  }

  const [rows] = await pool.query('SELECT attempt_count FROM asset_cleanup_tasks WHERE id = ? LIMIT 1', [taskId]);
  const attemptCount = Number(rows?.[0]?.attempt_count || 0) + 1;
  const manualReview = attemptCount >= maxAttempts;
  const status = manualReview ? 'manual_review' : 'retry';
  const nextAttemptAt = timestamp + (manualReview
    ? manualReviewRetryMs
    : retryBaseMs * (2 ** Math.min(attemptCount - 1, 10)));
  await pool.query(
    `UPDATE asset_cleanup_tasks
     SET status = ?, attempt_count = ?, next_attempt_at = ?, last_error = ?,
         updated_at = ?, completed_at = NULL
     WHERE id = ?`,
    [status, attemptCount, nextAttemptAt, lastError, timestamp, taskId],
  );
  return { id: taskId, status, attemptCount, nextAttemptAt, lastError };
};

export const listAssetCleanupTasks = async (pool, options = {}) => {
  if (!pool) return readRegistry(options).tasks.map((task) => ({ ...task }));
  const [rows] = await pool.query('SELECT * FROM asset_cleanup_tasks ORDER BY created_at ASC');
  return (rows || []).map(mapCleanupRow);
};

export const summarizeAssetCleanupTasks = (tasks = [], timestamp = Date.now()) => {
  const allTasks = Array.isArray(tasks) ? tasks : [];
  const backlogStatuses = new Set(['pending', 'retry', 'in_progress', 'manual_review']);
  const backlogTasks = allTasks.filter((task) => backlogStatuses.has(String(task?.status || '')));
  const oldestCreatedAt = backlogTasks.reduce((oldest, task) => {
    const createdAt = Number(task?.createdAt || 0);
    if (createdAt <= 0) return oldest;
    return oldest === 0 ? createdAt : Math.min(oldest, createdAt);
  }, 0);
  return {
    backlog: backlogTasks.length,
    oldestPendingAgeMs: oldestCreatedAt > 0 ? Math.max(0, Number(timestamp || 0) - oldestCreatedAt) : 0,
    retryAttempts: backlogTasks.reduce((total, task) => total + Math.max(0, Number(task?.attemptCount || 0)), 0),
    manualReview: backlogTasks.filter((task) => task.status === 'manual_review').length,
    protected: allTasks.filter((task) => task.status === 'protected').length,
    complete: allTasks.filter((task) => task.status === 'complete').length,
  };
};
