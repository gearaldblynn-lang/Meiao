import { isExternallyReachableBaseUrl, isLocalOrPrivateHostname } from './publicNetworkUrl.mjs';

const MANAGED_ASSET_PATH_SEGMENT = '/api/assets/file/';

const getManagedAssetPath = (value) => {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';
  if (trimmed.startsWith(MANAGED_ASSET_PATH_SEGMENT)) return trimmed;
  try {
    const parsed = new URL(trimmed);
    if (!parsed.pathname.includes(MANAGED_ASSET_PATH_SEGMENT)) return '';
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return '';
  }
};

export const isModelReadableAssetUrl = (value) => {
  const trimmed = String(value || '').trim();
  if (!trimmed) return false;
  if (!/^https?:\/\//i.test(trimmed)) return false;

  try {
    const parsed = new URL(trimmed);
    const hostname = parsed.hostname.toLowerCase();
    if (isLocalOrPrivateHostname(hostname)) return false;
    return true;
  } catch {
    return false;
  }
};

export const resolveModelReadableAssetUrl = (value) => (
  isModelReadableAssetUrl(value) ? String(value || '').trim() : ''
);

export { isExternallyReachableBaseUrl };

export const resolvePublicAssetUrl = (value, publicBaseUrl = '') => {
  const trimmed = String(value || '').trim();
  const normalizedBase = String(publicBaseUrl || '').trim().replace(/\/+$/, '');
  if (!trimmed) return '';

  const managedAssetPath = getManagedAssetPath(trimmed);
  if (trimmed.startsWith(MANAGED_ASSET_PATH_SEGMENT)) {
    return normalizedBase && isExternallyReachableBaseUrl(normalizedBase) ? `${normalizedBase}${trimmed}` : trimmed;
  }

  if (!/^https?:\/\//i.test(trimmed)) {
    return '';
  }

  try {
    const parsed = new URL(trimmed);
    const pathnameWithQuery = `${parsed.pathname}${parsed.search}${parsed.hash}`;
    const hostname = parsed.hostname.toLowerCase();
    if (parsed.pathname.includes(MANAGED_ASSET_PATH_SEGMENT) && normalizedBase && isExternallyReachableBaseUrl(normalizedBase) && isLocalOrPrivateHostname(hostname)) {
      return `${normalizedBase}${pathnameWithQuery}`;
    }
    if (managedAssetPath && isLocalOrPrivateHostname(hostname)) {
      return managedAssetPath;
    }
  } catch {
    return '';
  }

  return isModelReadableAssetUrl(trimmed) ? trimmed : '';
};
