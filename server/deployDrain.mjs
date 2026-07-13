import { statSync } from 'node:fs';

const DEFAULT_DRAIN_FILE = '/tmp/meiao-deploy-drain';
const DEFAULT_DRAIN_MAX_AGE_MS = 10 * 60 * 1000;

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
} = {}) => {
  try {
    const marker = stat(resolveDeployDrainFile(env));
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
