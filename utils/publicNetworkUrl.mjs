const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1']);

export const normalizeBaseUrl = (value) => String(value || '').trim().replace(/\/+$/, '');

export const isPrivateIpv4Hostname = (hostname) => {
  const parts = String(hostname || '').split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  return false;
};

export const isLocalOrPrivateHostname = (hostname) => {
  const normalized = String(hostname || '').trim().toLowerCase();
  if (!normalized) return true;
  if (LOCAL_HOSTNAMES.has(normalized)) return true;
  if (normalized.endsWith('.localhost')) return true;
  if (normalized.endsWith('.local')) return true;
  return isPrivateIpv4Hostname(normalized);
};

export const isExternallyReachableBaseUrl = (value) => {
  const normalized = normalizeBaseUrl(value);
  if (!normalized) return false;
  try {
    const parsed = new URL(normalized);
    if (!['http:', 'https:'].includes(parsed.protocol)) return false;
    return !isLocalOrPrivateHostname(parsed.hostname);
  } catch {
    return false;
  }
};
