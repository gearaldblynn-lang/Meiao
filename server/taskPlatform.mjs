import { randomBytes } from 'node:crypto';

const now = () => Date.now();

const TASK_ENGINE_MODES = new Set(['mysql', 'dual', 'temporal']);
const EVENT_STATUSES = new Set(['started', 'success', 'failed', 'interrupted']);
const ATTEMPT_STATUSES = new Set(['running', 'succeeded', 'failed', 'cancelled', 'retry_waiting']);

const parseJsonValue = (value, fallback = null) => {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};

const serializeJsonValue = (value) => JSON.stringify(value ?? null);

const toInt = (value, fallback = 0) => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const normalizeString = (value, fallback = '', maxLength = 255) => {
  const text = String(value ?? fallback).trim();
  return (text || fallback).slice(0, maxLength);
};

const normalizeBoolBit = (value) => (value ? 1 : 0);

export const normalizeTaskEngineMode = (value = process.env.MEIAO_TASK_ENGINE) => {
  const mode = String(value || '').trim().toLowerCase();
  return TASK_ENGINE_MODES.has(mode) ? mode : 'mysql';
};

export const buildTaskTraceId = (job = {}, explicitTraceId = '') => (
  normalizeString(
    explicitTraceId
      || job?.payload?.traceId
      || job?.payload?.requestId
      || job?.id,
    job?.id || 'unknown',
    120
  )
);

export const buildTaskErrorFingerprint = ({ job = {}, stage = '', errorCode = '' } = {}) => [
  normalizeString(job.provider, 'internal', 40),
  normalizeString(job.taskType, 'unknown', 80),
  normalizeString(stage, 'unknown', 80),
  normalizeString(errorCode, 'unknown_error', 80),
].join(':');

export const ensureTaskPlatformSchema = async (pool) => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS internal_job_attempts (
      id VARCHAR(24) PRIMARY KEY,
      job_id VARCHAR(24) NOT NULL,
      attempt_no INT NOT NULL,
      engine VARCHAR(20) NOT NULL,
      workflow_id VARCHAR(160) NULL,
      run_id VARCHAR(160) NULL,
      trace_id VARCHAR(120) NOT NULL,
      status VARCHAR(20) NOT NULL,
      provider_task_id VARCHAR(120) NULL,
      error_code VARCHAR(80) NULL,
      error_message TEXT NULL,
      started_at BIGINT NOT NULL,
      finished_at BIGINT NULL,
      INDEX idx_internal_job_attempts_job_id (job_id),
      INDEX idx_internal_job_attempts_trace_id (trace_id),
      INDEX idx_internal_job_attempts_workflow_id (workflow_id)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS internal_job_events (
      id VARCHAR(24) PRIMARY KEY,
      job_id VARCHAR(24) NOT NULL,
      attempt_id VARCHAR(24) NULL,
      trace_id VARCHAR(120) NOT NULL,
      stage VARCHAR(80) NOT NULL,
      event_name VARCHAR(100) NOT NULL,
      status VARCHAR(20) NOT NULL,
      engine VARCHAR(20) NOT NULL,
      provider_submitted TINYINT(1) NOT NULL DEFAULT 0,
      retryable TINYINT(1) NOT NULL DEFAULT 0,
      error_code VARCHAR(80) NULL,
      error_message TEXT NULL,
      error_fingerprint VARCHAR(320) NULL,
      provider_task_id VARCHAR(120) NULL,
      workflow_id VARCHAR(160) NULL,
      run_id VARCHAR(160) NULL,
      meta_json LONGTEXT NULL,
      created_at BIGINT NOT NULL,
      INDEX idx_internal_job_events_job_id (job_id),
      INDEX idx_internal_job_events_trace_id (trace_id),
      INDEX idx_internal_job_events_stage (stage),
      INDEX idx_internal_job_events_created_at (created_at),
      INDEX idx_internal_job_events_error_fingerprint (error_fingerprint)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);
};

export const recordJobEvent = async (pool, job, event = {}) => {
  const stage = normalizeString(event.stage, 'unknown', 80);
  const errorCode = normalizeString(event.errorCode, '', 80);
  const traceId = buildTaskTraceId(job, event.traceId);
  const createdAt = Number(event.createdAt || now());
  const errorFingerprint = event.errorFingerprint
    ? normalizeString(event.errorFingerprint, '', 320)
    : errorCode
      ? buildTaskErrorFingerprint({ job, stage, errorCode })
      : '';
  const record = {
    id: randomBytes(12).toString('hex'),
    jobId: normalizeString(job?.id, '', 24),
    attemptId: event.attemptId ? normalizeString(event.attemptId, '', 24) : null,
    attemptNo: event.attemptNo === undefined ? null : toInt(event.attemptNo, 0),
    traceId,
    stage,
    eventName: normalizeString(event.eventName, `${stage}_${event.status || 'started'}`, 100),
    status: EVENT_STATUSES.has(String(event.status || '')) ? String(event.status) : 'started',
    engine: normalizeTaskEngineMode(event.engine),
    providerSubmitted: Boolean(event.providerSubmitted),
    retryable: Boolean(event.retryable),
    errorCode,
    errorMessage: event.errorMessage ? String(event.errorMessage).slice(0, 5000) : '',
    errorFingerprint,
    providerTaskId: normalizeString(event.providerTaskId || job?.providerTaskId, '', 120),
    workflowId: normalizeString(event.workflowId, '', 160),
    runId: normalizeString(event.runId, '', 160),
    meta: event.meta && typeof event.meta === 'object' ? event.meta : null,
    createdAt,
  };

  await pool.query(
    `INSERT INTO internal_job_events (
      id, job_id, attempt_id, trace_id, stage, event_name, status, engine,
      provider_submitted, retryable, error_code, error_message, error_fingerprint,
      provider_task_id, workflow_id, run_id, created_at, meta_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      record.id,
      record.jobId,
      record.attemptId,
      record.traceId,
      record.stage,
      record.eventName,
      record.status,
      record.engine,
      normalizeBoolBit(record.providerSubmitted),
      normalizeBoolBit(record.retryable),
      record.errorCode || null,
      record.errorMessage || null,
      record.errorFingerprint || null,
      record.providerTaskId || null,
      record.workflowId || null,
      record.runId || null,
      record.createdAt,
      serializeJsonValue(record.meta),
    ]
  );

  return record;
};

export const createJobAttempt = async (pool, job, options = {}) => {
  const [rows] = await pool.query(
    'SELECT MAX(attempt_no) AS attempt_no FROM internal_job_attempts WHERE job_id = ?',
    [job.id]
  );
  const attemptNo = toInt(rows?.[0]?.attempt_no, 0) + 1;
  const startedAt = Number(options.startedAt || now());
  const attempt = {
    id: randomBytes(12).toString('hex'),
    jobId: job.id,
    attemptNo,
    engine: normalizeTaskEngineMode(options.engine),
    workflowId: normalizeString(options.workflowId, '', 160),
    runId: normalizeString(options.runId, '', 160),
    traceId: buildTaskTraceId(job, options.traceId),
    status: 'running',
    providerTaskId: normalizeString(options.providerTaskId || job.providerTaskId, '', 120),
    startedAt,
    finishedAt: null,
  };

  await pool.query(
    `INSERT INTO internal_job_attempts (
      id, job_id, attempt_no, engine, workflow_id, run_id, trace_id, status,
      provider_task_id, error_code, error_message, started_at, finished_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      attempt.id,
      attempt.jobId,
      attempt.attemptNo,
      attempt.engine,
      attempt.workflowId || null,
      attempt.runId || null,
      attempt.traceId,
      attempt.status,
      attempt.providerTaskId || null,
      null,
      null,
      attempt.startedAt,
      null,
    ]
  );

  await recordJobEvent(pool, job, {
    attemptId: attempt.id,
    attemptNo: attempt.attemptNo,
    traceId: attempt.traceId,
    stage: 'attempt',
    eventName: 'attempt_started',
    status: 'started',
    engine: attempt.engine,
    workflowId: attempt.workflowId,
    runId: attempt.runId,
    providerTaskId: attempt.providerTaskId,
    meta: {
      retryCount: Number(job.retryCount || 0),
      maxRetries: Number(job.maxRetries || 0),
    },
    createdAt: startedAt,
  });

  return attempt;
};

export const finishJobAttempt = async (pool, attemptId, fields = {}) => {
  const finishedAt = Number(fields.finishedAt || now());
  const status = ATTEMPT_STATUSES.has(String(fields.status || '')) ? String(fields.status) : 'failed';
  await pool.query(
    `UPDATE internal_job_attempts
     SET status = ?, provider_task_id = ?, error_code = ?, error_message = ?, finished_at = ?
     WHERE id = ?`,
    [
      status,
      normalizeString(fields.providerTaskId, '', 120) || null,
      normalizeString(fields.errorCode, '', 80) || null,
      fields.errorMessage ? String(fields.errorMessage).slice(0, 5000) : null,
      finishedAt,
      attemptId,
    ]
  );
};

const mapTaskPlatformJobRow = (row) => ({
  id: row.id,
  userId: row.user_id,
  user: {
    id: row.user_id,
    username: row.username || '',
    displayName: row.display_name || row.username || '',
  },
  module: row.module,
  taskType: row.task_type,
  provider: row.provider,
  status: row.status,
  providerTaskId: row.provider_task_id || '',
  errorCode: row.error_code || '',
  errorMessage: row.error_message || '',
  retryCount: Number(row.retry_count || 0),
  maxRetries: Number(row.max_retries || 0),
  createdAt: Number(row.created_at || 0),
  updatedAt: Number(row.updated_at || 0),
  startedAt: row.started_at === null ? null : Number(row.started_at),
  finishedAt: row.finished_at === null ? null : Number(row.finished_at),
  attemptCount: Number(row.attempt_count || 0),
  latestAttemptStatus: row.latest_attempt_status || '',
  latestStage: row.latest_stage || '',
  latestEventStatus: row.latest_event_status || '',
  latestEventAt: row.latest_event_at === null || row.latest_event_at === undefined ? null : Number(row.latest_event_at),
  providerSubmitted: Boolean(row.provider_submitted),
  retryable: Boolean(row.retryable),
  errorFingerprint: row.error_fingerprint || '',
  workflowId: row.workflow_id || '',
  runId: row.run_id || '',
  traceId: row.trace_id || '',
});

const normalizePageOptions = (filters = {}) => {
  const pageSize = Math.min(100, Math.max(1, toInt(filters.pageSize, 20)));
  const page = Math.max(1, toInt(filters.page, 1));
  return { page, pageSize, offset: (page - 1) * pageSize };
};

const addEqualsFilter = (clauses, values, column, value) => {
  const normalized = normalizeString(value, '', 120);
  if (!normalized || normalized === 'all') return;
  clauses.push(`${column} = ?`);
  values.push(normalized);
};

export const listTaskPlatformJobs = async (pool, filters = {}) => {
  const { page, pageSize, offset } = normalizePageOptions(filters);
  const clauses = ['1 = 1'];
  const values = [];
  addEqualsFilter(clauses, values, 'j.status', filters.status);
  addEqualsFilter(clauses, values, 'j.module', filters.module);
  addEqualsFilter(clauses, values, 'j.provider', filters.provider);
  addEqualsFilter(clauses, values, 'j.task_type', filters.taskType);
  addEqualsFilter(clauses, values, 'j.user_id', filters.userId);
  if (filters.traceId) {
    clauses.push('EXISTS (SELECT 1 FROM internal_job_events te WHERE te.job_id = j.id AND te.trace_id = ?)');
    values.push(normalizeString(filters.traceId, '', 120));
  }
  const where = clauses.join(' AND ');
  const [countRows] = await pool.query(
    `SELECT COUNT(*) AS total FROM internal_jobs j WHERE ${where}`,
    values
  );
  const total = Number(countRows?.[0]?.total || 0);

  const [rows] = await pool.query(
    `SELECT
       j.id, j.user_id, u.username, u.display_name, j.module, j.task_type, j.provider, j.status,
       j.provider_task_id, j.error_code, j.error_message, j.retry_count, j.max_retries,
       j.created_at, j.updated_at, j.started_at, j.finished_at,
       (SELECT COUNT(1) FROM internal_job_attempts a WHERE a.job_id = j.id) AS attempt_count,
       (SELECT a.status FROM internal_job_attempts a WHERE a.job_id = j.id ORDER BY a.attempt_no DESC LIMIT 1) AS latest_attempt_status,
       (SELECT e.stage FROM internal_job_events e WHERE e.job_id = j.id ORDER BY e.created_at DESC LIMIT 1) AS latest_stage,
       (SELECT e.status FROM internal_job_events e WHERE e.job_id = j.id ORDER BY e.created_at DESC LIMIT 1) AS latest_event_status,
       (SELECT e.created_at FROM internal_job_events e WHERE e.job_id = j.id ORDER BY e.created_at DESC LIMIT 1) AS latest_event_at,
       (SELECT e.provider_submitted FROM internal_job_events e WHERE e.job_id = j.id ORDER BY e.created_at DESC LIMIT 1) AS provider_submitted,
       (SELECT e.retryable FROM internal_job_events e WHERE e.job_id = j.id ORDER BY e.created_at DESC LIMIT 1) AS retryable,
       (SELECT e.error_fingerprint FROM internal_job_events e WHERE e.job_id = j.id ORDER BY e.created_at DESC LIMIT 1) AS error_fingerprint,
       (SELECT a.workflow_id FROM internal_job_attempts a WHERE a.job_id = j.id ORDER BY a.attempt_no DESC LIMIT 1) AS workflow_id,
       (SELECT a.run_id FROM internal_job_attempts a WHERE a.job_id = j.id ORDER BY a.attempt_no DESC LIMIT 1) AS run_id,
       COALESCE(
         (SELECT e.trace_id FROM internal_job_events e WHERE e.job_id = j.id ORDER BY e.created_at DESC LIMIT 1),
         (SELECT a.trace_id FROM internal_job_attempts a WHERE a.job_id = j.id ORDER BY a.attempt_no DESC LIMIT 1),
         j.id
       ) AS trace_id
     FROM internal_jobs j
     LEFT JOIN users u ON u.id = j.user_id
     WHERE ${where}
     ORDER BY j.created_at DESC
     LIMIT ? OFFSET ?`,
    [...values, pageSize, offset]
  );

  return { jobs: rows.map(mapTaskPlatformJobRow), total, page, pageSize };
};

export const getTaskPlatformTimeline = async (pool, jobId) => {
  const [attemptRows] = await pool.query(
    `SELECT id, job_id, attempt_no, engine, workflow_id, run_id, trace_id, status,
      provider_task_id, error_code, error_message, started_at, finished_at
     FROM internal_job_attempts
     WHERE job_id = ?
     ORDER BY attempt_no ASC`,
    [jobId]
  );
  const [eventRows] = await pool.query(
    `SELECT id, job_id, attempt_id, trace_id, stage, event_name, status, engine,
      provider_submitted, retryable, error_code, error_message, error_fingerprint,
      provider_task_id, workflow_id, run_id, meta_json, created_at
     FROM internal_job_events
     WHERE job_id = ?
     ORDER BY created_at ASC`,
    [jobId]
  );

  return {
    attempts: attemptRows.map((row) => ({
      id: row.id,
      jobId: row.job_id,
      attemptNo: Number(row.attempt_no || 0),
      engine: row.engine,
      workflowId: row.workflow_id || '',
      runId: row.run_id || '',
      traceId: row.trace_id || '',
      status: row.status,
      providerTaskId: row.provider_task_id || '',
      errorCode: row.error_code || '',
      errorMessage: row.error_message || '',
      startedAt: Number(row.started_at || 0),
      finishedAt: row.finished_at === null ? null : Number(row.finished_at),
    })),
    events: eventRows.map((row) => ({
      id: row.id,
      jobId: row.job_id,
      attemptId: row.attempt_id || '',
      traceId: row.trace_id || '',
      stage: row.stage,
      eventName: row.event_name,
      status: row.status,
      engine: row.engine,
      providerSubmitted: Boolean(row.provider_submitted),
      retryable: Boolean(row.retryable),
      errorCode: row.error_code || '',
      errorMessage: row.error_message || '',
      errorFingerprint: row.error_fingerprint || '',
      providerTaskId: row.provider_task_id || '',
      workflowId: row.workflow_id || '',
      runId: row.run_id || '',
      meta: parseJsonValue(row.meta_json, null),
      createdAt: Number(row.created_at || 0),
    })),
  };
};

export const getTaskPlatformHealth = async ({ engine = process.env.MEIAO_TASK_ENGINE, temporalAdapter = null } = {}) => {
  const mode = normalizeTaskEngineMode(engine);
  const temporal = temporalAdapter && typeof temporalAdapter.health === 'function'
    ? await temporalAdapter.health()
    : { configured: false, reachable: false, message: 'Temporal adapter is not configured.' };
  return {
    ok: mode === 'mysql' || mode === 'dual' || Boolean(temporal.reachable),
    engine: mode,
    mysqlLedger: true,
    temporal,
  };
};
