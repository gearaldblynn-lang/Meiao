export const MODEL_REPLACE_ERROR_CODES = Object.freeze([
  'IDENTITY_COUNT_INVALID',
  'PERSON_COUNT_INVALID',
  'IDENTITY_MISMATCH',
  'FACE_NOT_USABLE',
  'REFERENCE_PERSON_TOO_SMALL',
  'FULL_REPLACE_SOURCE_INCOMPLETE',
]);

const ERROR_MESSAGES = Object.freeze({
  IDENTITY_COUNT_INVALID: '身份图数量必须为 1–4 张',
  PERSON_COUNT_INVALID: '必须恰好出现一名人物',
  IDENTITY_MISMATCH: '与主身份图疑似不是同一人物',
  FACE_NOT_USABLE: '面部过小、严重遮挡或清晰度不足',
  REFERENCE_PERSON_TOO_SMALL: '人物主体过小，无法可靠替换',
  FULL_REPLACE_SOURCE_INCOMPLETE: '未清楚展示全部替换所需的身材、姿势、服装和配饰',
});

const ROLE_LABELS = Object.freeze({
  identity: '人物身份图',
  reference: '待替换参考图',
});

const isValidCount = (count, minimum, maximum) =>
  Number.isInteger(count) && count >= minimum && count <= maximum;

const isPlainObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const hasExactOwnEnumerableKeys = (value, expectedKeys) => {
  const keys = Object.keys(value);
  return keys.length === expectedKeys.length && keys.every((key) => expectedKeys.includes(key));
};

const hasAllowedOwnEnumerableKeys = (value, allowedKeys) =>
  Object.keys(value).every((key) => allowedKeys.includes(key));

const normalizeClassification = (value, allowedValues) =>
  typeof value === 'string' && allowedValues.includes(value) ? value : 'unknown';

const EXPOSED_SKIN_REGIONS = Object.freeze([
  'face', 'ears', 'neck', 'shoulders', 'chest', 'arms', 'hands', 'midriff', 'legs', 'feet',
]);

const normalizeExposedSkinRegions = (value, { required = false } = {}) => {
  if (!Array.isArray(value)) {
    if (required) throw new TypeError('模型替换轻量分析结构无效：缺少裸露皮肤区域');
    return [];
  }
  if (
    (required && value.length === 0) ||
    value.some((region) => !EXPOSED_SKIN_REGIONS.includes(region)) ||
    new Set(value).size !== value.length
  ) {
    throw new TypeError('模型替换裸露皮肤区域无效');
  }
  return [...value];
};

const normalizeReferenceAnalysis = (value, options = {}) => {
  if (!Array.isArray(value)) return [];

  const strict = options.requireCompleteReferenceAnalysis === true;
  const seenIndexes = new Set();

  return value.flatMap((item) => {
    if (!isPlainObject(item) || !Number.isSafeInteger(item.index) || item.index < 1) return [];
    if (strict && seenIndexes.has(item.index)) throw new TypeError('模型替换参考图索引重复');
    seenIndexes.add(item.index);
    const normalized = {
      index: item.index,
      framing: normalizeClassification(item.framing, ['portrait', 'half_body', 'full_body', 'unknown']),
      faceDirection: normalizeClassification(item.faceDirection, ['front', 'left', 'right', 'profile', 'unknown']),
      headPitch: normalizeClassification(item.headPitch, ['up', 'level', 'down', 'unknown']),
      occlusion: normalizeClassification(item.occlusion, ['low', 'medium', 'high', 'unknown']),
      exposedSkinRegions: normalizeExposedSkinRegions(item.exposedSkinRegions, { required: strict }),
    };
    return [normalized];
  });
};

const extractFencedJson = (content) => {
  const match = content.match(/```json\s*\r?\n([\s\S]*?)\r?\n```/i);
  return match ? match[1] : content;
};

const createJsonFormatError = (cause) => {
  const error = new SyntaxError('人物素材检查返回格式异常，请重试。');
  error.cause = cause;
  return error;
};

const findCompleteJsonObject = (content, startIndex) => {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = startIndex; index < content.length; index += 1) {
    const char = content[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
    } else if (char === '{' || char === '[') {
      depth += 1;
    } else if (char === '}' || char === ']') {
      depth -= 1;
      if (depth === 0) return content.slice(startIndex, index + 1);
    }
  }

  return '';
};

const parseFirstJsonObject = (content) => {
  let lastError;
  for (let index = content.indexOf('{'); index >= 0; index = content.indexOf('{', index + 1)) {
    const candidate = findCompleteJsonObject(content, index);
    if (!candidate) break;
    try {
      return JSON.parse(candidate);
    } catch (error) {
      lastError = error;
    }
  }
  throw createJsonFormatError(lastError);
};

export const assertModelReplaceMaterialCounts = (identityCount, referenceCount) => {
  if (!isValidCount(identityCount, 1, 4)) {
    const error = new Error('请上传 1–4 张同一人物的身份图。');
    error.code = 'IDENTITY_COUNT_INVALID';
    throw error;
  }

  if (!isValidCount(referenceCount, 1, 40)) {
    throw new Error('请上传 1–40 张待替换参考图。');
  }
};

export const parseModelReplacePreflightContent = (content, options = {}) => {
  if (typeof content !== 'string') {
    throw new TypeError('模型替换预检结果必须是 JSON 字符串');
  }

  const parsed = parseFirstJsonObject(extractFencedJson(content));
  if (
    !isPlainObject(parsed) ||
    !hasAllowedOwnEnumerableKeys(parsed, ['passed', 'issues', 'referenceAnalysis']) ||
    !Object.hasOwn(parsed, 'passed') ||
    !Object.hasOwn(parsed, 'issues') ||
    typeof parsed.passed !== 'boolean' ||
    !Array.isArray(parsed.issues)
  ) {
    throw new TypeError('模型替换预检结果结构无效');
  }

  const issues = parsed.issues.map((issue) => {
    if (
      !isPlainObject(issue) ||
      !hasExactOwnEnumerableKeys(issue, ['role', 'index', 'code']) ||
      !Object.hasOwn(ROLE_LABELS, issue.role) ||
      !Number.isSafeInteger(issue.index) ||
      issue.index < 1 ||
      !MODEL_REPLACE_ERROR_CODES.includes(issue.code)
    ) {
      throw new TypeError('模型替换预检问题结构无效');
    }

    return { role: issue.role, index: issue.index, code: issue.code };
  });

  const result = { passed: issues.length === 0 ? parsed.passed : false, issues };
  if (Object.hasOwn(parsed, 'referenceAnalysis')) {
    result.referenceAnalysis = normalizeReferenceAnalysis(parsed.referenceAnalysis, options);
  }
  return result;
};

export const formatModelReplacePreflightError = ({ role, index, code }) => {
  const roleLabel = ROLE_LABELS[role] || String(role);
  const message = ERROR_MESSAGES[code] || String(code);
  return `${roleLabel}第 ${index} 张：${message}`;
};
