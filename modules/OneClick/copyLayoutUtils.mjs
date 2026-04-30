const STANDARD_COPY_LINE_PATTERN = /^\s*[•\-\*]?\s*([^:：("“”「」]+?)\s*[（(]\s*([^()（）]*)\s*[）)]\s*[:：]\s*[“"「](.+?)[”"」]\s*$/;
const LEGACY_COPY_LINE_PATTERN = /^\s*[•\-\*]?\s*([^:："“”「」]+?)\s*[:：]\s*[“"「](.+?)[”"」]\s*(?:[—\-–]|[:：])\s*(.+?)\s*$/;

const normalizeQuoteBody = (value = '') => value.replace(/\s+/g, ' ').trim();

const normalizeRequirementTokens = (raw = '') => {
  const tokens = raw
    .replace(/[()（）]/g, '')
    .split(/[，,、/]/)
    .map((token) => token.trim())
    .filter(Boolean)

  return Array.from(new Set(tokens));
};

const buildStandardCopyLine = (role, rawRequirements, body) => {
  const normalizedRole = String(role || '').replace(/^[•\-\*\s]+/, '').trim();
  const requirements = normalizeRequirementTokens(rawRequirements);
  const normalizedRequirements = requirements.length > 0 ? requirements.join(', ') : '自然排版';
  return `${normalizedRole}(${normalizedRequirements}):“${normalizeQuoteBody(body)}”`;
};

export const normalizeCopyLayoutLine = (line = '') => {
  const input = String(line || '');
  const trimmed = input.trim();
  if (!trimmed) return input;

  const standardMatch = trimmed.match(STANDARD_COPY_LINE_PATTERN);
  if (standardMatch) {
    return buildStandardCopyLine(standardMatch[1], standardMatch[2], standardMatch[3]);
  }

  const legacyMatch = trimmed.match(LEGACY_COPY_LINE_PATTERN);
  if (legacyMatch) {
    return buildStandardCopyLine(legacyMatch[1], legacyMatch[3], legacyMatch[2]);
  }

  return input;
};

export const normalizeCopyLayoutText = (text = '') =>
  String(text || '')
    .split('\n')
    .map((line) => normalizeCopyLayoutLine(line))
    .join('\n')
    .trim();
