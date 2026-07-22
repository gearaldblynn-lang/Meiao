import { readFileSync, statSync } from 'node:fs';

const DEFAULT_DRAIN_FILE = '/tmp/meiao-deploy-drain';
const DEFAULT_DRAIN_MAX_AGE_MS = 10 * 60 * 1000;
let activeWriteRequests = 0;

const resolveDrainMaxAgeMs = (env = process.env) => {
  const parsed = Number(env.MEIAO_DEPLOY_DRAIN_MAX_AGE_MS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_DRAIN_MAX_AGE_MS;
};

export const resolveDeployDrainFile = (env = process.env) => (
  String(env.MEIAO_DEPLOY_DRAIN_FILE || '').trim() || DEFAULT_DRAIN_FILE
);

export const isDeployDrainActive = ({
  env = process.env,
  now = Date.now,
  stat = statSync,
  readFile = readFileSync,
} = {}) => {
  try {
    const drainFile = resolveDeployDrainFile(env);
    let markerState = '';
    try {
      markerState = String(readFile(drainFile, 'utf8') || '').trim();
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    const marker = stat(drainFile);
    if (markerState === 'manual') return true;
    return now() - Number(marker?.mtimeMs || 0) <= resolveDrainMaxAgeMs(env);
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
};

export const createDeployDrainError = () => {
  const error = new Error('系统发布中，暂时停止提交新任务，请稍后重试。');
  error.code = 'job_submissions_paused';
  error.statusCode = 503;
  return error;
};

export const assertJobSubmissionAllowed = (options) => {
  if (isDeployDrainActive(options)) throw createDeployDrainError();
};

export const shouldGuardDeployRequest = ({ pathname = '', method = '' } = {}) => (
  String(pathname).startsWith('/api/')
  && !['GET', 'HEAD', 'OPTIONS'].includes(String(method).toUpperCase())
);

export const assertDeployRequestAllowed = ({ pathname, method, drainOptions } = {}) => {
  if (!shouldGuardDeployRequest({ pathname, method })) return;
  assertJobSubmissionAllowed(drainOptions);
};

export const beginDeployRequestTracking = ({ pathname, method } = {}) => {
  if (!shouldGuardDeployRequest({ pathname, method })) return () => {};
  activeWriteRequests += 1;
  let finished = false;
  return () => {
    if (finished) return;
    finished = true;
    activeWriteRequests = Math.max(0, activeWriteRequests - 1);
  };
};

export const getDeployRequestSnapshot = (drainOptions) => ({
  active: isDeployDrainActive(drainOptions),
  activeWriteRequests,
});
