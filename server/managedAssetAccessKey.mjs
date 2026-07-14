import { createHmac, timingSafeEqual } from 'node:crypto';

const ACCESS_KEY_PARAM = 'asset_key';

const createAccessError = () => {
  const error = new Error('托管素材访问密钥未配置');
  error.code = 'managed_asset_access_secret_missing';
  error.providerStage = 'asset_read';
  error.providerStatus = 'config_error';
  return error;
};

const getSecret = (env = {}) => {
  const secret = String(env?.MEIAO_MANAGED_ASSET_ACCESS_SECRET || '').trim();
  if (secret.length < 24) throw createAccessError();
  return secret;
};

const normalizeIdentity = ({ assetId, userId } = {}) => {
  const normalizedAssetId = String(assetId || '').trim();
  const normalizedUserId = String(userId || '').trim();
  if (!normalizedAssetId || !normalizedUserId) {
    const error = new Error('托管素材访问身份不完整');
    error.code = 'managed_asset_access_identity_invalid';
    throw error;
  }
  return `${normalizedAssetId}\n${normalizedUserId}`;
};

export const createManagedAssetAccessKey = (identity, env = {}) => (
  createHmac('sha256', getSecret(env))
    .update(normalizeIdentity(identity))
    .digest('base64url')
);

const createAccessKeyWithSecret = (identity, secret) => (
  createHmac('sha256', secret)
    .update(normalizeIdentity(identity))
    .digest('base64url')
);

const matchesAccessKey = (received, expected) => {
  const left = Buffer.from(received);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
};

export const verifyManagedAssetAccessKey = (candidate, identity, env = {}) => {
  const received = String(candidate || '').trim();
  if (!received) return false;
  let currentSecret;
  try {
    currentSecret = getSecret(env);
  } catch {
    return false;
  }
  if (matchesAccessKey(received, createAccessKeyWithSecret(identity, currentSecret))) return true;
  const previousSecret = String(env?.MEIAO_MANAGED_ASSET_ACCESS_PREVIOUS_SECRET || '').trim();
  return previousSecret.length >= 24
    && matchesAccessKey(received, createAccessKeyWithSecret(identity, previousSecret));
};

export const appendManagedAssetAccessKey = (value, identity, env = {}) => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const key = createManagedAssetAccessKey(identity, env);
  if (/^https?:\/\//i.test(raw)) {
    const parsed = new URL(raw);
    parsed.searchParams.set(ACCESS_KEY_PARAM, key);
    return parsed.toString();
  }
  const separator = raw.includes('?') ? '&' : '?';
  return `${raw}${separator}${ACCESS_KEY_PARAM}=${encodeURIComponent(key)}`;
};

export const getManagedAssetAccessKeyFromUrl = (url) => (
  String(url?.searchParams?.get?.(ACCESS_KEY_PARAM) || '').trim()
);

export const stripManagedAssetAccessKey = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const absolute = /^https?:\/\//i.test(raw);
    const parsed = new URL(raw, 'http://managed-asset.local');
    parsed.searchParams.delete(ACCESS_KEY_PARAM);
    if (absolute) return parsed.toString();
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return raw
      .replace(new RegExp(`([?&])${ACCESS_KEY_PARAM}=[^&#]*&?`, 'gi'), (_match, separator) => separator === '?' ? '?' : '')
      .replace(/\?$/, '');
  }
};
