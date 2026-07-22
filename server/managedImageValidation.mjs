const DEFAULT_MANAGED_IMAGE_MAX_BYTES = 20 * 1024 * 1024;
const MIN_MANAGED_IMAGE_MAX_BYTES = 1024 * 1024;
const MAX_MANAGED_IMAGE_MAX_BYTES = 100 * 1024 * 1024;

const MANAGED_IMAGE_FILE_EXTENSIONS = new Map([
  ['image/png', '.png'],
  ['image/jpeg', '.jpg'],
  ['image/gif', '.gif'],
  ['image/webp', '.webp'],
  ['image/bmp', '.bmp'],
  ['image/avif', '.avif'],
  ['image/heic', '.heic'],
  ['image/heif', '.heic'],
]);

const createValidationError = (code, message, statusCode = 400) => {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  error.providerStatus = 'invalid_input';
  return error;
};

const normalizeMimeType = (value) => {
  const mimeType = String(value || '').split(';')[0].trim().toLowerCase();
  if (mimeType === 'image/jpg') return 'image/jpeg';
  if (mimeType === 'image/x-png') return 'image/png';
  if (mimeType === 'image/x-ms-bmp') return 'image/bmp';
  return mimeType;
};

export const getManagedImageFileExtension = (mimeType) => (
  MANAGED_IMAGE_FILE_EXTENSIONS.get(normalizeMimeType(mimeType)) || ''
);

const startsWithBytes = (buffer, bytes) => (
  buffer.length >= bytes.length && bytes.every((value, index) => buffer[index] === value)
);

export const detectManagedImageMimeType = (value) => {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value || []);
  if (startsWithBytes(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (startsWithBytes(buffer, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (buffer.length >= 6 && ['GIF87a', 'GIF89a'].includes(buffer.subarray(0, 6).toString('ascii'))) return 'image/gif';
  if (
    buffer.length >= 12
    && buffer.subarray(0, 4).toString('ascii') === 'RIFF'
    && buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) return 'image/webp';
  if (startsWithBytes(buffer, [0x42, 0x4d])) return 'image/bmp';
  if (buffer.length >= 12 && buffer.subarray(4, 8).toString('ascii') === 'ftyp') {
    const brand = buffer.subarray(8, 12).toString('ascii').toLowerCase();
    if (['avif', 'avis'].includes(brand)) return 'image/avif';
    if (['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1'].includes(brand)) return 'image/heic';
  }
  return '';
};

export const inspectManagedImageMultipartPrefix = (bodyPrefix, { contentType = '', final = false } = {}) => {
  const prefix = Buffer.isBuffer(bodyPrefix) ? bodyPrefix : Buffer.from(bodyPrefix || []);
  const prefixText = prefix.toString('latin1');
  const boundaryMatch = /(?:^|;)\s*boundary=(?:"([^"]{1,200})"|([^;\s]{1,200}))/i.exec(String(contentType || ''));
  const boundary = String(boundaryMatch?.[1] || boundaryMatch?.[2] || '');
  if (!boundary) return final ? { complete: true, isImage: false } : { complete: false, isImage: false };
  const delimiter = `--${boundary}`;
  let cursor = 0;

  while (cursor <= prefixText.length) {
    const boundaryIndex = prefixText.indexOf(delimiter, cursor);
    if (boundaryIndex < 0) return final ? { complete: true, isImage: false } : { complete: false, isImage: false };
    if (boundaryIndex > 0 && prefixText.slice(boundaryIndex - 2, boundaryIndex) !== '\r\n') {
      cursor = boundaryIndex + delimiter.length;
      continue;
    }
    let partStart = boundaryIndex + delimiter.length;
    if (prefixText.slice(partStart, partStart + 2) === '--') {
      return { complete: true, isImage: false };
    }
    if (prefixText.length < partStart + 2) return { complete: false, isImage: false };
    if (prefixText.slice(partStart, partStart + 2) !== '\r\n') {
      cursor = partStart;
      continue;
    }
    partStart += 2;
    const headerEnd = prefixText.indexOf('\r\n\r\n', partStart);
    if (headerEnd < 0) return { complete: false, isImage: false };
    const headerText = prefixText.slice(partStart, headerEnd);
    const partName = /content-disposition:\s*form-data;[^\r\n]*\bname="([^"]+)"/i.exec(headerText)?.[1] || '';
    const bodyStart = headerEnd + 4;
    if (partName !== 'file') {
      const nextBoundary = prefixText.indexOf(`\r\n${delimiter}`, bodyStart);
      if (nextBoundary < 0) return final ? { complete: true, isImage: false } : { complete: false, isImage: false };
      cursor = nextBoundary + 2;
      continue;
    }

    const declaredMimeType = /content-type:\s*([^\r\n]+)/i.exec(headerText)?.[1]?.trim().toLowerCase() || 'application/octet-stream';
    const declaredImage = declaredMimeType.startsWith('image/');
    if (!declaredImage && prefix.length < bodyStart + 12 && !final) {
      return { complete: false, isImage: false };
    }
    const detectedMimeType = detectManagedImageMimeType(prefix.subarray(bodyStart, Math.min(prefix.length, bodyStart + 32)));
    return {
      complete: true,
      isImage: declaredImage || Boolean(detectedMimeType),
      declaredMimeType,
      detectedMimeType,
    };
  }
  return final ? { complete: true, isImage: false } : { complete: false, isImage: false };
};

export const getManagedImageMaxBytes = (env = process.env) => {
  const parsed = Number.parseInt(String(env?.MEIAO_MANAGED_IMAGE_MAX_BYTES || ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_MANAGED_IMAGE_MAX_BYTES;
  return Math.max(MIN_MANAGED_IMAGE_MAX_BYTES, Math.min(MAX_MANAGED_IMAGE_MAX_BYTES, parsed));
};

export const validateManagedImageUpload = ({ fileBuffer, mimeType, env = process.env } = {}) => {
  const buffer = Buffer.isBuffer(fileBuffer) ? fileBuffer : Buffer.from(fileBuffer || []);
  const maxBytes = getManagedImageMaxBytes(env);
  if (buffer.length === 0) {
    throw createValidationError('managed_image_empty', '图片上传内容为空');
  }
  if (buffer.length > maxBytes) {
    throw createValidationError(
      'managed_image_too_large',
      `图片大小不能超过 ${Math.floor(maxBytes / 1024 / 1024)}MB`,
      413,
    );
  }
  const declaredMimeType = normalizeMimeType(mimeType);
  if (!declaredMimeType.startsWith('image/')) {
    throw createValidationError('managed_image_mime_invalid', '上传文件不是图片');
  }
  const detectedMimeType = detectManagedImageMimeType(buffer);
  if (!detectedMimeType) {
    throw createValidationError('managed_image_signature_invalid', '图片文件头无效或格式不受支持');
  }
  const compatible = declaredMimeType === detectedMimeType
    || (declaredMimeType === 'image/heif' && detectedMimeType === 'image/heic');
  if (!compatible) {
    throw createValidationError('managed_image_mime_mismatch', '图片类型与文件内容不一致');
  }
  return { detectedMimeType, fileSize: buffer.length, maxBytes };
};

export const resolveManagedImageUpload = ({ fileBuffer, mimeType, env = process.env } = {}) => {
  const buffer = Buffer.isBuffer(fileBuffer) ? fileBuffer : Buffer.from(fileBuffer || []);
  const declaredMimeType = normalizeMimeType(mimeType) || 'application/octet-stream';
  const detectedMimeType = detectManagedImageMimeType(buffer);

  if (!detectedMimeType) {
    if (declaredMimeType.startsWith('image/')) {
      validateManagedImageUpload({ fileBuffer: buffer, mimeType: declaredMimeType, env });
    }
    return { isImage: false, mimeType: declaredMimeType, detectedMimeType: '' };
  }

  // Enforce the image byte limit even when the client disguises an image as a
  // generic binary. Generic browser MIME is normalized from the trusted magic
  // bytes; a conflicting specific non-image declaration is rejected.
  validateManagedImageUpload({ fileBuffer: buffer, mimeType: detectedMimeType, env });
  if (!declaredMimeType.startsWith('image/') && declaredMimeType !== 'application/octet-stream') {
    const error = createValidationError('managed_image_mime_mismatch', '图片类型与文件内容不一致');
    error.declaredMimeType = declaredMimeType;
    error.detectedMimeType = detectedMimeType;
    throw error;
  }
  return {
    isImage: true,
    mimeType: detectedMimeType,
    detectedMimeType,
    declaredMimeType,
    mimeTypeNormalized: declaredMimeType !== detectedMimeType,
  };
};
