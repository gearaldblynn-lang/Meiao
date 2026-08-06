const LANGUAGE_SCRIPT_FAMILIES = new Map([
  ['english', 'latin'],
  ['german', 'latin'],
  ['french', 'latin'],
  ['spanish', 'latin'],
  ['italian', 'latin'],
  ['vietnamese', 'latin'],
  ['japanese', 'japanese'],
  ['korean', 'hangul'],
  ['russian', 'cyrillic'],
  ['thai', 'thai'],
]);

const SIMPLIFIED_HAN_ONLY = /[这张仅场调纹显级泼让还进过边选开关门车书话语译发产买卖价优惠质总样应实钟亿]/gu;

const countMatches = (value, pattern) => Array.from(String(value || '').matchAll(pattern)).length;

const inspectScripts = (value) => ({
  latin: countMatches(value, /\p{Script=Latin}/gu),
  cyrillic: countMatches(value, /\p{Script=Cyrillic}/gu),
  hangul: countMatches(value, /\p{Script=Hangul}/gu),
  thai: countMatches(value, /\p{Script=Thai}/gu),
  kana: countMatches(value, /[\p{Script=Hiragana}\p{Script=Katakana}]/gu),
  han: countMatches(value, /\p{Script=Han}/gu),
  simplifiedHan: countMatches(value, SIMPLIFIED_HAN_ONLY),
});

const normalizeTargetLanguage = (value) => String(value || '')
  .trim()
  .toLowerCase()
  .replace(/\s*\([^)]*\)\s*$/, '');

export const extractTranslationPlanningMappings = (content) => {
  const mappings = [];
  const pattern = /[“"]([^”"\r\n]+)[”"]\s*本地化为\s*[“"]([^”"\r\n]+)[”"]/g;
  for (const match of String(content || '').matchAll(pattern)) {
    mappings.push({ source: match[1].trim(), target: match[2].trim() });
  }
  return mappings;
};

export const normalizeTranslationPlanningContent = (content) => {
  const structuredRows = [];
  for (const line of String(content || '').split(/\r?\n/)) {
    const mappings = extractTranslationPlanningMappings(line);
    mappings.forEach(({ source, target }) => {
      structuredRows.push(`- “${source}”本地化为“${target}”`);
    });
    if (mappings.length > 0) continue;

    const preserve = line.match(/[“"]([^”"\r\n]+)[”"]\s*保持不变/);
    if (preserve) structuredRows.push(`- “${preserve[1].trim()}”保持不变`);
  }
  return [...new Set(structuredRows)].join('\n');
};

const normalizeBatchSourceKey = (value) => String(value || '')
  .normalize('NFKC')
  .replace(/\s+/g, ' ')
  .trim();

export const reconcileTranslationPlanningBatchConsistency = ({ content, registry } = {}) => {
  if (!(registry instanceof Map)) throw new TypeError('Translation planning batch registry must be a Map');

  const normalizedContent = normalizeTranslationPlanningContent(content);
  if (!normalizedContent) return '';

  return normalizedContent.split('\n').map((line) => {
    const mapping = extractTranslationPlanningMappings(line)[0];
    if (!mapping) return line;

    const sourceKey = normalizeBatchSourceKey(mapping.source);
    const registeredTarget = registry.get(sourceKey);
    if (registeredTarget) {
      return `- “${mapping.source}”本地化为“${registeredTarget}”`;
    }

    const isIdentical = normalizeComparableCopy(mapping.source)
      === normalizeComparableCopy(mapping.target);
    if (!isIdentical) registry.set(sourceKey, mapping.target);
    return `- “${mapping.source}”本地化为“${mapping.target}”`;
  }).join('\n');
};

const hasClearScriptConflict = (family, scripts) => {
  const strongLatin = scripts.latin >= 4;
  const strongHan = scripts.han >= 4;

  if (family === 'latin') {
    if (scripts.latin >= 2) return false;
    return scripts.cyrillic >= 2 || scripts.hangul >= 2 || scripts.thai >= 2 || scripts.kana >= 2 || strongHan;
  }
  if (family === 'cyrillic') {
    if (scripts.cyrillic >= 2) return false;
    return strongLatin || scripts.hangul >= 2 || scripts.thai >= 2 || scripts.kana >= 2 || strongHan;
  }
  if (family === 'hangul') {
    if (scripts.hangul >= 2) return false;
    return strongLatin || scripts.cyrillic >= 2 || scripts.thai >= 2 || scripts.kana >= 2 || strongHan;
  }
  if (family === 'thai') {
    if (scripts.thai >= 2) return false;
    return strongLatin || scripts.cyrillic >= 2 || scripts.hangul >= 2 || scripts.kana >= 2 || strongHan;
  }
  if (family === 'japanese') {
    if (scripts.kana >= 1) return false;
    if (scripts.simplifiedHan >= 1) return true;
    return scripts.cyrillic >= 2 || scripts.hangul >= 2 || scripts.thai >= 2 || (strongLatin && scripts.han === 0);
  }
  return false;
};

export const validateTranslationPlanningTargetLanguage = ({ content, targetLanguage } = {}) => {
  const mappings = extractTranslationPlanningMappings(content);
  const mappingCount = mappings.length;
  if (mappingCount === 0) return { valid: true, reason: '', mappingCount };

  const family = LANGUAGE_SCRIPT_FAMILIES.get(normalizeTargetLanguage(targetLanguage));
  if (!family) return { valid: true, reason: '', mappingCount };

  const targetCopy = mappings.map((mapping) => mapping.target).join('\n');
  if (!hasClearScriptConflict(family, inspectScripts(targetCopy))) {
    return { valid: true, reason: '', mappingCount };
  }

  return {
    valid: false,
    reason: `策划结果中的成品文案与目标语言 ${String(targetLanguage || '').trim()} 的文字体系不一致。`,
    mappingCount,
  };
};

const buildLanguageCorrection = (targetLanguage, reason) => [
  '上一轮策划结果未通过目标语言校验，请重新识别原图并完整输出全部文案映射。',
  `目标语言：${String(targetLanguage || '').trim()}。`,
  '每条“本地化为”右侧引号内必须只写目标语言的最终成品文案；结构说明语言不得作为成品文案语言。',
  reason ? `上一轮问题：${reason}` : '',
].filter(Boolean).join('\n');

const normalizeComparableCopy = (value) => String(value || '')
  .normalize('NFKC')
  .replace(/\s+/g, ' ')
  .trim();

const hasIdenticalEditableMapping = (content) => extractTranslationPlanningMappings(content)
  .some(({ source, target }) => (
    normalizeComparableCopy(source) === normalizeComparableCopy(target)
  ));

const buildIdenticalCopyReviewCorrection = (targetLanguage, previousContent) => [
  '上一轮策划中存在可编辑文案的原文与成品文案完全相同，请对当前图片中的现有文案再做一次质量复审。',
  `目标语言：${String(targetLanguage || '').trim()}。`,
  '重新逐条检查机翻直译感、不自然语序、不地道搭配、词义或字根重复、修饰关系、固定搭配、助词、时态、广告省略和文案角色。',
  '语法正确、能够理解或在广告中偶尔可见，不等于符合目标市场当地消费者的表达逻辑。',
  '只有当地母语电商编辑会在相同商品、图片位置和文案角色下直接原样发布时，才允许继续保持相同。',
  '需要改写时，使用更自然且符合当前商品语境的表达，但不得为了制造差异而强制替换近义词、改变语气、增加事实、承诺或卖点。',
  '请结合原图重新识别，并完整输出全部文案映射和保持不变项。',
  '上一轮完整映射：',
  String(previousContent || '').trim(),
].filter(Boolean).join('\n');

export const runTranslationPlanningWithLanguageGuard = async ({
  targetLanguage,
  request,
} = {}) => {
  if (typeof request !== 'function') throw new TypeError('Translation planning request must be a function');

  let correction = '';
  let totalCredits = 0;
  let hasCredits = false;
  const taskIds = [];
  let lastValidation = null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await request({ attempt, correction });
    const credits = Number(response?.creditsConsumed);
    if (Number.isFinite(credits)) {
      totalCredits += credits;
      hasCredits = true;
    }
    const taskId = String(response?.taskId || '').trim();
    if (taskId) taskIds.push(taskId);

    const normalizedContent = normalizeTranslationPlanningContent(response?.content);
    lastValidation = normalizedContent
      ? validateTranslationPlanningTargetLanguage({ content: normalizedContent, targetLanguage })
      : {
          valid: false,
          reason: '策划结果没有返回可用的结构化文案映射。',
          mappingCount: 0,
        };
    if (lastValidation.valid) {
      if (attempt === 0 && hasIdenticalEditableMapping(normalizedContent)) {
        correction = buildIdenticalCopyReviewCorrection(targetLanguage, normalizedContent);
        continue;
      }
      return {
        ...response,
        content: normalizedContent,
        creditsConsumed: hasCredits ? totalCredits : response?.creditsConsumed,
        taskIds,
      };
    }
    correction = buildLanguageCorrection(targetLanguage, lastValidation.reason);
  }

  const error = new Error(lastValidation?.reason || '策划结果与目标语言不一致，请重试。');
  error.code = 'translation_target_language_mismatch';
  error.creditsConsumed = hasCredits ? totalCredits : undefined;
  error.taskIds = taskIds;
  throw error;
};
