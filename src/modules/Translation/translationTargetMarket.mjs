const TARGET_MARKET_BY_LANGUAGE = Object.freeze({
  english: '美国',
  japanese: '日本',
  german: '德国',
  french: '法国',
  spanish: '西班牙',
  korean: '韩国',
  russian: '俄罗斯',
  vietnamese: '越南',
  thai: '泰国',
  italian: '意大利',
});

const normalizeLanguageKey = (value) => String(value || '').trim().toLowerCase();

export const resolveTranslationTargetMarket = (targetLanguage) => {
  const original = String(targetLanguage || '').trim();
  if (!original) return '目标语言对应地区';

  const directMatch = TARGET_MARKET_BY_LANGUAGE[normalizeLanguageKey(original)];
  if (directMatch) return directMatch;

  const annotation = original.match(/\(([^)]+)\)\s*$/)?.[1];
  const annotationMatch = TARGET_MARKET_BY_LANGUAGE[normalizeLanguageKey(annotation)];
  return annotationMatch || original;
};
