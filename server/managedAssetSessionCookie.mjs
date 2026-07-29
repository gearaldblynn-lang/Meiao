const COOKIE_NAME = 'MEIAO_ASSET_SESSION';
const COOKIE_PATH = '/api/assets/file/';

const resolveCookieDomain = (publicBaseUrl) => {
  try {
    const hostname = new URL(String(publicBaseUrl || '')).hostname.toLowerCase();
    if (!hostname || hostname === 'localhost' || /^\d+(?:\.\d+){3}$/.test(hostname)) return '';
    return hostname.startsWith('www.') ? hostname.slice(4) : hostname;
  } catch {
    return '';
  }
};

const isSecurePublicBaseUrl = (publicBaseUrl) => {
  try {
    return new URL(String(publicBaseUrl || '')).protocol === 'https:';
  } catch {
    return false;
  }
};

export const buildManagedAssetSessionCookie = (token, options = {}) => {
  const clear = options.clear === true;
  const normalizedToken = clear ? '' : String(token || '').trim();
  const publicBaseUrl = String(options.publicBaseUrl || '').trim();
  const maxAgeSeconds = clear
    ? 0
    : Math.max(1, Math.floor(Number(options.maxAgeSeconds) || 7 * 24 * 60 * 60));
  const domain = resolveCookieDomain(publicBaseUrl);
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(normalizedToken)}`,
    `Path=${COOKIE_PATH}`,
    `Max-Age=${maxAgeSeconds}`,
    'HttpOnly',
    'SameSite=Strict',
  ];
  if (domain) parts.push(`Domain=${domain}`);
  if (isSecurePublicBaseUrl(publicBaseUrl)) parts.push('Secure');
  return parts.join('; ');
};

export const getManagedAssetSessionToken = (req) => {
  const cookieHeader = String(req?.headers?.cookie || '');
  const prefix = `${COOKIE_NAME}=`;
  for (const segment of cookieHeader.split(';')) {
    const trimmed = segment.trim();
    if (!trimmed.startsWith(prefix)) continue;
    try {
      return decodeURIComponent(trimmed.slice(prefix.length)).trim();
    } catch {
      return '';
    }
  }
  return '';
};
