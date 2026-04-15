const FONT_TOKEN_PATTERN = /(字体|字库|font|钉钉|阿里巴巴|优设|普惠体|进步体|标题黑|宋体|黑体|楷体|仿宋|圆体|隶书|行书|魏碑)/i;
const WEIGHT_TOKEN_PATTERN = /^(加粗|粗体|特粗|中粗|中黑|常规|标准|细体|纤细|轻体|轻薄|bold|regular|medium|semibold|light)$/i;
const STANDARD_COPY_LINE_PATTERN = /^\s*[•\-\*]?\s*([^:：("“”「」]+?)\s*[（(]\s*([^()（）]*)\s*[）)]\s*[:：]\s*[“"「](.+?)[”"」]\s*$/;
const LEGACY_COPY_LINE_PATTERN = /^\s*[•\-\*]?\s*([^:："“”「」]+?)\s*[:：]\s*[“"「](.+?)[”"」]\s*(?:[—\-–]|[:：])\s*(.+?)\s*$/;

const normalizeQuoteBody = (value = '') => value.replace(/\s+/g, ' ').trim();

const isFontToken = (token = '') => {
  const normalized = token.replace(/\s+/g, '');
  if (!normalized) return false;
  if (WEIGHT_TOKEN_PATTERN.test(normalized)) return false;
  return FONT_TOKEN_PATTERN.test(normalized);
};

const normalizeRequirementTokens = (raw = '') => {
  const tokens = raw
    .replace(/[()（）]/g, '')
    .split(/[，,、/]/)
    .map((token) => token.trim())
    .filter(Boolean)
    .filter((token) => !isFontToken(token));

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
