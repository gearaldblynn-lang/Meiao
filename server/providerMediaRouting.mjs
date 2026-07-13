export const isVideoMediaUrl = (value) => {
  const normalized = String(value || '').split('?')[0].toLowerCase();
  return /\.(mp4|m4v|mov|webm)$/i.test(normalized);
};

export const shouldUploadGeminiMediaUrlForStableMime = (value, options = {}) => {
  const normalized = String(value || '').trim();
  if (!normalized || isVideoMediaUrl(normalized) || options.isManagedAssetUrl?.(normalized)) return false;
  if (!/^https?:\/\//i.test(normalized)) return false;
  const pathname = (() => {
    try {
      return new URL(normalized).pathname || '';
    } catch {
      return normalized.split('?')[0] || '';
    }
  })();
  if (/\.(png|jpe?g|webp|gif|bmp|svg|pdf|txt|md|json)$/i.test(pathname)) return false;
  if (/tempfile\.redpandaai\.co|tempfileb\.aiquickdraw\.com/i.test(normalized)) return true;
  return false;
};
