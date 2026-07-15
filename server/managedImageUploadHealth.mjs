import { createHash, randomBytes } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

const DEFAULT_PROBE_MAX_AGE_MS = 60 * 60 * 1000;
const DEFAULT_PROBE_INTERVAL_MS = 15 * 60 * 1000;
const REQUIRED_COS_SETTINGS = [
  'MEIAO_IMAGE_COS_SECRET_ID',
  'MEIAO_IMAGE_COS_SECRET_KEY',
  'MEIAO_IMAGE_COS_BUCKET',
  'MEIAO_IMAGE_COS_REGION',
];

const parseBoundedInteger = (value, fallback, minimum, maximum) => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, parsed));
};

const normalizeMode = (env) => {
  const mode = String(env?.MEIAO_MANAGED_IMAGE_UPLOAD_MODE || 'disabled').trim().toLowerCase();
  return ['cos', 'disabled'].includes(mode) ? mode : 'invalid';
};

const getConfigValues = (env = {}) => Object.fromEntries(
  REQUIRED_COS_SETTINGS.map((key) => [key, String(env?.[key] || '').trim()]),
);

const getConfigFingerprint = (env = {}) => createHash('sha256')
  .update(JSON.stringify(getConfigValues(env)))
  .digest('hex');

const normalizeFailureCode = (value) => {
  const normalized = String(value || 'probe_failed').trim().replace(/[^a-zA-Z0-9_.-]+/g, '_').slice(0, 80);
  return normalized || 'probe_failed';
};

export const getManagedImageProbeStatusFilePath = (env = {}) => {
  const configured = String(env?.MEIAO_MANAGED_IMAGE_PROBE_STATUS_FILE || '').trim();
  return configured ? path.resolve(configured) : path.resolve('server/data/managed-image-cos-readiness.json');
};

export const getManagedImageProbeIntervalMs = (env = {}) => parseBoundedInteger(
  env?.MEIAO_MANAGED_IMAGE_PROBE_INTERVAL_MS,
  DEFAULT_PROBE_INTERVAL_MS,
  60_000,
  24 * 60 * 60 * 1000,
);

export const writeManagedImageProbeStatus = ({
  env = process.env,
  statusFilePath = getManagedImageProbeStatusFilePath(env),
  ok,
  checkedAt = Date.now(),
  errorCode = '',
} = {}) => {
  const targetPath = path.resolve(statusFilePath);
  const targetDir = path.dirname(targetPath);
  const tempPath = path.join(
    targetDir,
    `.${path.basename(targetPath)}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`,
  );
  const payload = {
    version: 1,
    ok: ok === true,
    checkedAt: Number(checkedAt) || Date.now(),
    configFingerprint: getConfigFingerprint(env),
    ...(ok === true ? {} : { failureCode: normalizeFailureCode(errorCode) }),
  };

  mkdirSync(targetDir, { recursive: true, mode: 0o700 });
  try {
    writeFileSync(tempPath, `${JSON.stringify(payload)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    renameSync(tempPath, targetPath);
  } finally {
    rmSync(tempPath, { force: true });
  }
  return payload;
};

const readProbeStatus = (statusFilePath) => {
  if (!existsSync(statusFilePath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(statusFilePath, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
};

export const getManagedImageUploadHealth = ({
  env = process.env,
  statusFilePath = getManagedImageProbeStatusFilePath(env),
  now = Date.now(),
} = {}) => {
  const mode = normalizeMode(env);
  const configValues = getConfigValues(env);
  const configured = REQUIRED_COS_SETTINGS.every((key) => Boolean(configValues[key]));
  const base = {
    mode,
    configured,
    ready: false,
    status: 'probe_missing',
    lastProbeAt: null,
    lastProbeAgeMs: null,
    alerting: true,
  };

  if (mode === 'disabled') return { ...base, status: 'disabled' };
  if (mode !== 'cos') return { ...base, status: 'invalid_mode' };
  if (!configured) return { ...base, status: 'config_incomplete' };

  const probe = readProbeStatus(path.resolve(statusFilePath));
  if (!probe) return base;

  const lastProbeAt = Number(probe.checkedAt);
  const lastProbeAgeMs = Number.isFinite(lastProbeAt)
    ? Math.max(0, Number(now) - lastProbeAt)
    : null;
  const withProbe = {
    ...base,
    lastProbeAt: Number.isFinite(lastProbeAt) ? lastProbeAt : null,
    lastProbeAgeMs,
  };
  if (probe.configFingerprint !== getConfigFingerprint(env)) {
    return { ...withProbe, status: 'config_changed' };
  }
  if (probe.ok !== true) {
    return {
      ...withProbe,
      status: 'probe_failed',
      failureCode: normalizeFailureCode(probe.failureCode),
    };
  }
  const maxAgeMs = parseBoundedInteger(
    env?.MEIAO_MANAGED_IMAGE_PROBE_MAX_AGE_MS,
    DEFAULT_PROBE_MAX_AGE_MS,
    60_000,
    7 * 24 * 60 * 60 * 1000,
  );
  if (lastProbeAgeMs === null || lastProbeAgeMs > maxAgeMs) {
    return { ...withProbe, status: 'probe_stale' };
  }
  return {
    ...withProbe,
    ready: true,
    status: 'ready',
    alerting: false,
  };
};
