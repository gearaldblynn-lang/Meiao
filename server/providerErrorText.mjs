const compact = (value) => String(value || '').trim();

const REFUSAL_PATTERNS = [
  /\bI\s+cannot\s+fulfill\s+this\s+request\b/i,
  /\bI\s+can(?:not|'t)\s+(?:help|assist|comply|fulfill)\b/i,
  /\bI'm\s+sorry,\s+but\s+I\s+can(?:not|'t)\b/i,
  /\bI\s+am\s+sorry,\s+but\s+I\s+can(?:not|'t)\b/i,
  /prompt\s+could\s+not\s+be\s+submitted[\s\S]{0,240}(?:sensitive\s+words|prohibited\s+use\s+policy)/i,
  /无法满足(?:该|这个|此)?请求/,
  /不能满足(?:该|这个|此)?请求/,
  /无法协助(?:该|这个|此)?请求/,
];

const BAD_RESPONSE_PATTERNS = [
  /failed\s+to\s+get\s+(?:the\s+)?file\s+information/i,
];

const UPSTREAM_INTERNAL_PATTERNS = [
  /interal\s+error/i,
  /internal\s+error/i,
  /internal\s+server\s+error/i,
  /internal\s+error,\s*please\s+try\s+again\s+later/i,
  /\bhttp\s*(?:500|502|503|504)\b/i,
  /bad\s+gateway/i,
  /gateway\s+timeout/i,
  /service\s+unavailable/i,
  /upstream\s+error/i,
  /server\s+error/i,
  /server\s+exception,\s*please\s+try\s+again\s+later/i,
  /server\s+is\s+currently\s+being\s+maintained/i,
];

const PROVIDER_BAD_REQUEST_PATTERNS = [
  /file mime type is not supported/i,
  /image download failed/i,
  /invalid\s+image:\s*the\s+image\s+url\s+must\s+not\s+be\s+empty/i,
  /http 404:\s*not found/i,
  /please convert or change the file/i,
  /unauthorized\s*[\u2013-]\s*authentication failed/i,
  /authentication failed\.?\s*please check/i,
];

const STRUCTURAL_PLAIN_ERROR_PATTERN = /error|http\s*5\d\d|bad gateway|unavailable/i;

const matchesAny = (text, patterns) => patterns.some((pattern) => pattern.test(text));

const isShortPlainErrorText = (text) => (
  text.length <= 80
  && STRUCTURAL_PLAIN_ERROR_PATTERN.test(text)
  && !text.includes('{')
  && !text.includes('[')
);

export const isProviderErrorText = (value) => {
  const text = compact(value);
  if (!text) return false;
  return matchesAny(text, [
    ...REFUSAL_PATTERNS,
    ...BAD_RESPONSE_PATTERNS,
    ...UPSTREAM_INTERNAL_PATTERNS,
    ...PROVIDER_BAD_REQUEST_PATTERNS,
  ]) || isShortPlainErrorText(text);
};

export const providerErrorCodeFromText = (value) => {
  const text = compact(value);
  if (matchesAny(text, REFUSAL_PATTERNS)) return 'provider_refusal';
  if (matchesAny(text, BAD_RESPONSE_PATTERNS)) return 'provider_bad_response';
  if (matchesAny(text, UPSTREAM_INTERNAL_PATTERNS) || isShortPlainErrorText(text)) {
    return 'provider_internal_error';
  }
  return 'provider_bad_request';
};
