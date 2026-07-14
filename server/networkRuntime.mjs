import {
  getDefaultAutoSelectFamilyAttemptTimeout,
  setDefaultAutoSelectFamilyAttemptTimeout,
} from 'node:net';

const DEFAULT_NETWORK_FAMILY_ATTEMPT_TIMEOUT_MS = 1000;
const MIN_NETWORK_FAMILY_ATTEMPT_TIMEOUT_MS = 250;
const MAX_NETWORK_FAMILY_ATTEMPT_TIMEOUT_MS = 5000;

export const getNetworkFamilyAttemptTimeoutMs = (env = process.env) => {
  const parsed = Number.parseInt(String(env?.MEIAO_NETWORK_FAMILY_ATTEMPT_TIMEOUT_MS || ''), 10);
  if (!Number.isFinite(parsed)) return DEFAULT_NETWORK_FAMILY_ATTEMPT_TIMEOUT_MS;
  return Math.max(
    MIN_NETWORK_FAMILY_ATTEMPT_TIMEOUT_MS,
    Math.min(MAX_NETWORK_FAMILY_ATTEMPT_TIMEOUT_MS, parsed),
  );
};

export const configureServerNetworkRuntime = (env = process.env, netApi = {
  getDefaultAutoSelectFamilyAttemptTimeout,
  setDefaultAutoSelectFamilyAttemptTimeout,
}) => {
  const previousMs = netApi.getDefaultAutoSelectFamilyAttemptTimeout();
  const appliedMs = getNetworkFamilyAttemptTimeoutMs(env);
  netApi.setDefaultAutoSelectFamilyAttemptTimeout(appliedMs);
  return { previousMs, appliedMs };
};
