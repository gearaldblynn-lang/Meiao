export const GEMINI_INLINE_DATA_DEFAULT_MAX_BYTES = 12 * 1024 * 1024;
export const GEMINI_INLINE_DATA_BOUNDS = Object.freeze([
  1024,
  15 * 1024 * 1024,
]);

const CANONICAL_BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
const MIME_TYPE_PATTERN = /^[a-z][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/u;

export function getGeminiInlineDataMaxBytes(env = {}) {
  const parsed = Number.parseInt(String(env.MEIAO_GEMINI_INLINE_DATA_MAX_BYTES || ''), 10);
  const [minimum, maximum] = GEMINI_INLINE_DATA_BOUNDS;
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : GEMINI_INLINE_DATA_DEFAULT_MAX_BYTES;
}

const invalidInlineData = (message) => Object.assign(new Error(message), {
  code: 'gemini_inline_data_invalid',
});

export function normalizeGeminiInlineData({
  data,
  mimeType,
  maxBytes,
} = {}) {
  const normalizedData = String(data || '').trim();
  const normalizedMimeType = String(mimeType || '').trim().toLowerCase();
  const normalizedMaxBytes = Number(maxBytes);
  if (
    !normalizedData
    || normalizedData.length % 4 !== 0
    || !CANONICAL_BASE64_PATTERN.test(normalizedData)
    || !MIME_TYPE_PATTERN.test(normalizedMimeType)
    || !Number.isSafeInteger(normalizedMaxBytes)
    || normalizedMaxBytes <= 0
  ) {
    throw invalidInlineData('Gemini inline data 无效');
  }
  const paddingBytes = normalizedData.endsWith('==') ? 2 : normalizedData.endsWith('=') ? 1 : 0;
  const sizeBytes = (normalizedData.length / 4) * 3 - paddingBytes;
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0 || sizeBytes > normalizedMaxBytes) {
    throw invalidInlineData('Gemini inline data 超过允许大小');
  }
  return Object.freeze({
    data: normalizedData,
    mimeType: normalizedMimeType,
    sizeBytes,
  });
}
