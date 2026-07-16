import { isLocalOrPrivateHostname } from '../src/utils/publicNetworkUrl.mjs';

export const normalizeManagedImageUploadMode = (env = {}) => {
  const mode = String(env?.MEIAO_MANAGED_IMAGE_UPLOAD_MODE || 'disabled').trim().toLowerCase();
  return ['cos', 'local', 'disabled'].includes(mode) ? mode : 'invalid';
};

export const resolveLocalManagedImageUpload = ({ env = {}, publicBaseUrl = '' } = {}) => {
  const configuredBaseUrl = String(publicBaseUrl || env?.MEIAO_PUBLIC_BASE_URL || '').trim();
  const runtimeMode = String(env?.NODE_ENV || '').trim().toLowerCase();
  if (!['development', 'test'].includes(runtimeMode)) {
    return { allowed: false, reason: runtimeMode === 'production' ? 'production' : 'runtime_unspecified' };
  }
  try {
    const parsed = new URL(configuredBaseUrl);
    if (!['http:', 'https:'].includes(parsed.protocol) || !isLocalOrPrivateHostname(parsed.hostname)) {
      return { allowed: false, reason: 'public_origin' };
    }
  } catch {
    return { allowed: false, reason: 'invalid_origin' };
  }
  return { allowed: true, reason: '' };
};
