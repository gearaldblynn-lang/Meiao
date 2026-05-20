const MIME_EXTENSION_MAP = new Map([
  ['image/png', '.png'],
  ['image/jpeg', '.jpg'],
  ['image/jpg', '.jpg'],
  ['image/webp', '.webp'],
  ['image/gif', '.gif'],
  ['image/avif', '.avif'],
  ['image/heic', '.heic'],
  ['image/heif', '.heif'],
  ['video/mp4', '.mp4'],
  ['video/webm', '.webm'],
  ['video/quicktime', '.mov'],
  ['application/pdf', '.pdf'],
  ['text/plain', '.txt'],
  ['text/csv', '.csv'],
  ['application/json', '.json'],
]);

export const inferExtensionFromMimeType = (mimeType = '') => {
  const normalized = String(mimeType || '').trim().toLowerCase();
  return MIME_EXTENSION_MAP.get(normalized) || '';
};

export const ensureUploadFileName = (fileName = 'upload.bin', mimeType = '') => {
  const normalizedName = String(fileName || '').trim() || 'upload.bin';
  if (/\.[a-zA-Z0-9]+$/.test(normalizedName)) {
    return normalizedName;
  }

  const inferredExtension = inferExtensionFromMimeType(mimeType);
  return inferredExtension ? `${normalizedName}${inferredExtension}` : normalizedName;
};
