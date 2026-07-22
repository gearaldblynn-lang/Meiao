export const FRIEND_SECRET_ALLOWLIST = new Set([
  'KIE_API_KEY', 'MEIAO_KIE_API_KEY', 'KIE_CHAT_MODEL',
  'APIPORTS_API_KEY', 'MEIAO_APIPORTS_API_KEY', 'APIPORTS_BASE_URL',
  'MAXFORAI_API_KEY', 'MAXFORAI_BASE_URL',
  'MAXFORAI_VIDEO_API_KEY', 'MAXFORAI_VIDEO_BASE_URL',
  'OPENAI_COMPATIBLE_API_KEY', 'OPENAI_COMPATIBLE_BASE_URL', 'OPENAI_COMPATIBLE_MODELS',
  'ARK_API_KEY', 'MEIAO_SPIDER_API_KEY', 'MEIAO_SPIDER_GATEWAY_URL',
  'GOLDEN_SUBTITLE_API_TOKEN', 'MEIAO_SUBTITLE_REMOVAL_BASE_URL',
  'MEIAO_COS_SECRET_ID', 'MEIAO_COS_SECRET_KEY', 'MEIAO_COS_BUCKET', 'MEIAO_COS_REGION',
  'MEIAO_IMAGE_COS_SECRET_ID', 'MEIAO_IMAGE_COS_SECRET_KEY',
  'MEIAO_IMAGE_COS_BUCKET', 'MEIAO_IMAGE_COS_REGION',
]);

export const FRIEND_SECRET_FORBIDDEN = new Set([
  'DATABASE_URL', 'MEIAO_DB_HOST', 'MEIAO_DB_PORT', 'MEIAO_DB_NAME',
  'MEIAO_DB_USER', 'MEIAO_DB_PASSWORD', 'MEIAO_ADMIN_USERNAME',
  'MEIAO_ADMIN_PASSWORD', 'MEIAO_SUPER_ADMIN_USERS', 'SESSION_SECRET',
  'MEIAO_MANAGED_ASSET_ACCESS_SECRET', 'MEIAO_MANAGED_ASSET_ACCESS_PREVIOUS_SECRET',
  'SSH_PRIVATE_KEY', 'GITHUB_TOKEN',
]);

const PROVIDER_KEYS = new Set([
  'KIE_API_KEY', 'MEIAO_KIE_API_KEY', 'APIPORTS_API_KEY',
  'MEIAO_APIPORTS_API_KEY', 'MAXFORAI_API_KEY', 'MAXFORAI_VIDEO_API_KEY',
  'OPENAI_COMPATIBLE_API_KEY', 'ARK_API_KEY', 'MEIAO_SPIDER_API_KEY',
  'GOLDEN_SUBTITLE_API_TOKEN',
]);

const KEY_RE = /^[A-Z][A-Z0-9_]*$/;
const PLACEHOLDER_RE = /^(?:<[^>]+>|sk-?x{4,}|change[_-]?me.*|your[_-].*|example.*)$/i;

function decodeValue(raw, lineNumber) {
  const value = raw.trim();
  if (!value) return '';
  if (value.startsWith('"')) {
    if (!value.endsWith('"')) throw new Error(`dotenv_unclosed_quote:${lineNumber}`);
    const decoded = JSON.parse(value);
    if (decoded.includes('\n') || decoded.includes('\r')) {
      throw new Error(`dotenv_multiline_value:${lineNumber}`);
    }
    return decoded;
  }
  if (value.startsWith("'")) {
    if (!value.endsWith("'")) throw new Error(`dotenv_unclosed_quote:${lineNumber}`);
    const decoded = value.slice(1, -1);
    if (decoded.includes('\n') || decoded.includes('\r')) {
      throw new Error(`dotenv_multiline_value:${lineNumber}`);
    }
    return decoded;
  }
  if (value.includes('\n') || value.includes('\r')) {
    throw new Error(`dotenv_multiline_value:${lineNumber}`);
  }
  return value;
}

export function parseDotenvText(text) {
  if (typeof text !== 'string' || text.includes('\0')) throw new Error('dotenv_invalid_input');
  const entries = new Map();
  for (const [index, rawLine] of text.replaceAll('\r\n', '\n').split('\n').entries()) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const line = trimmed.startsWith('export ') ? trimmed.slice(7).trimStart() : trimmed;
    const separator = line.indexOf('=');
    if (separator < 1) throw new Error(`dotenv_invalid_line:${index + 1}`);
    const key = line.slice(0, separator).trim();
    if (!KEY_RE.test(key)) throw new Error(`dotenv_invalid_key:${index + 1}`);
    const value = decodeValue(line.slice(separator + 1), index + 1);
    if (entries.has(key) && entries.get(key) !== value) {
      throw new Error(`dotenv_conflicting_duplicate:${key}`);
    }
    entries.set(key, value);
  }
  return entries;
}

export function validateFriendSecretEntries(entries) {
  const reasons = {};
  for (const [key, value] of entries) {
    if (FRIEND_SECRET_FORBIDDEN.has(key)) reasons[key] = 'forbidden_key';
    else if (!FRIEND_SECRET_ALLOWLIST.has(key)) reasons[key] = 'unknown_key';
    else if (!String(value).trim()) reasons[key] = 'empty_value';
    else if (PLACEHOLDER_RE.test(String(value).trim())) reasons[key] = 'placeholder_value';
    else if (/(?:API_KEY|TOKEN|SECRET_ID|SECRET_KEY)$/.test(key) && String(value).trim().length < 12) {
      reasons[key] = 'truncated_sensitive_value';
    }
  }
  if (![...entries.keys()].some((key) => PROVIDER_KEYS.has(key))) {
    reasons.__bundle__ = 'provider_credential_required';
  }
  const rejectedKeys = Object.keys(reasons).sort();
  return rejectedKeys.length
    ? { ok: false, rejectedKeys, reasons }
    : { ok: true, keys: [...entries.keys()].sort() };
}

export function serializeDotenv(entries) {
  return [...entries]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => {
      const text = String(value);
      const encoded = /^[A-Za-z0-9_./:@+,-]+$/.test(text) ? text : JSON.stringify(text);
      return `${key}=${encoded}`;
    })
    .join('\n') + '\n';
}
