import { resolvePublicAssetUrl } from './modelAssetUrl.mjs';

const shouldUseDownloadProxy = (url) => {
  try {
    if (typeof window === 'undefined' || !window.location?.href) return false;
    const parsed = new URL(String(url || ''), window.location.href);
    if (!['http:', 'https:'].includes(parsed.protocol)) return false;
    return parsed.origin !== window.location.origin;
  } catch {
    return false;
  }
};

const getSessionToken = () => {
  try {
    return window.localStorage?.getItem('MEIAO_INTERNAL_SESSION_TOKEN') || '';
  } catch {
    return '';
  }
};

const isSameOriginUrl = (url) => {
  try {
    if (typeof window === 'undefined' || !window.location?.href) return false;
    return new URL(String(url || ''), window.location.href).origin === window.location.origin;
  } catch {
    return false;
  }
};

export const fetchImageBlobWithProxy = async (url, label = 'Image', signal) => {
  const safeUrl = String(url || '').trim();
  if (!safeUrl) throw new Error(`${label} URL is empty`);
  const browserUrl = resolvePublicAssetUrl(safeUrl) || safeUrl;

  const fetchDirect = async (targetUrl) => {
    const sameOrigin = isSameOriginUrl(targetUrl);
    const token = sameOrigin ? getSessionToken() : '';
    const response = await fetch(targetUrl, {
      cache: 'no-cache',
      credentials: sameOrigin ? 'include' : 'same-origin',
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      signal,
    });
    if (!response.ok) throw new Error(`${label} download failed: ${response.status}`);
    return response.blob();
  };

  try {
    return await fetchDirect(browserUrl);
  } catch (error) {
    if (!shouldUseDownloadProxy(browserUrl)) throw error;
    return fetchDirect(`/api/assets/download-proxy?url=${encodeURIComponent(browserUrl)}`);
  }
};

export const decodeBrowserImageFromBlob = async (blob, label = 'Image') => {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(blob);
    } catch {
      // HTMLImageElement handles formats unsupported by createImageBitmap.
    }
  }

  if (
    typeof Image === 'undefined'
    || typeof URL === 'undefined'
    || typeof URL.createObjectURL !== 'function'
  ) {
    throw new Error(`${label} decode failed`);
  }

  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL?.(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL?.(objectUrl);
      reject(new Error(`${label} load failed`));
    };
    image.src = objectUrl;
  });
};

export const loadBrowserImage = async (url, label = 'Image', signal) => (
  decodeBrowserImageFromBlob(await fetchImageBlobWithProxy(url, label, signal), label)
);
