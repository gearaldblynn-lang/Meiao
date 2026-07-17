const ERASE_INSTRUCTION_PATTERN = /(?:删除|删掉|清除|清空|去掉|去除|移除|擦除|抹掉|消除|remove|delete|erase|clear)/i;
const ERASE_CLAUSE_SEPARATOR_PATTERN = /[\n,，。；;!?！？]+|(?:但是|但|而是)|\b(?:but|however)\b/i;
const NEGATED_ERASE_PATTERN = /(?:不要|不再|不应|不得|不可|不能|不必|无需|无须|禁止|请勿|勿|别|不是|并非|do\s+not|don't|dont|never|without)/i;
const TEXT_REPLACEMENT_PATTERN = /(?:文案|文字|标题|内容|copy|text)?\s*(?:改为|改成|修改为|替换为|换成|变为|写成|设为|change\s+to|replace\s+with)\s*[“"']?([^，。；;,\n"'”]+)[”"']?/i;
const TWO_LINE_PATTERN = /(?:两行|2\s*行|two\s+lines?)/i;

const COLOR_BY_KEYWORD = [
  { pattern: /(?:红色|红字|改红|变红|red)/i, color: '#dc2626' },
  { pattern: /(?:黑色|黑字|改黑|变黑|black)/i, color: '#111827' },
  { pattern: /(?:白色|白字|改白|变白|white)/i, color: '#ffffff' },
  { pattern: /(?:蓝色|蓝字|改蓝|变蓝|blue)/i, color: '#1d4ed8' },
  { pattern: /(?:绿色|绿字|改绿|变绿|green)/i, color: '#16a34a' },
  { pattern: /(?:黄色|黄字|改黄|变黄|yellow)/i, color: '#ca8a04' },
];

const NON_TEXT_REPLACEMENT_VALUES = new Set([
  '红色',
  '黑色',
  '白色',
  '蓝色',
  '绿色',
  '黄色',
  '两行',
  '2行',
]);

export const isTranslationRegionEraseInstruction = (instruction = '') => (
  String(instruction || '')
    .trim()
    .split(ERASE_CLAUSE_SEPARATOR_PATTERN)
    .some((clause) => ERASE_INSTRUCTION_PATTERN.test(clause) && !NEGATED_ERASE_PATTERN.test(clause))
);

export const isTranslationRegionPureEraseTask = (regions = []) => (
  Array.isArray(regions)
  && regions.length > 0
  && regions.every((region) => (
    isTranslationRegionEraseInstruction(region?.instruction)
    && !resolveTranslationRegionTextRenderPlan(region)
  ))
);

export const buildTranslationRegionEraseGuidance = () => (
  '删除类任务：清除该编号框内所有被要求删除的文字、图标、装饰或其他内容；不得残留任何文字笔画、字形轮廓、灰色残影或半透明边缘；不要生成任何新文字、符号或装饰性替代内容；用周围背景的颜色、渐变、纹理和曲线进行无痕修复补齐，让该区域看起来像从未有过文字或这些内容。'
);

const normalizeQuotedText = (value = '') => String(value || '')
  .trim()
  .replace(/^[“"']+|[”"']+$/g, '')
  .trim();

const extractReplacementText = (instruction = '') => {
  const source = String(instruction || '').trim();
  const match = source.match(TEXT_REPLACEMENT_PATTERN);
  const text = normalizeQuotedText(match?.[1] || '');
  if (!text || NON_TEXT_REPLACEMENT_VALUES.has(text.replace(/\s+/g, ''))) return '';
  return text;
};

const resolveColor = (instruction = '') => (
  COLOR_BY_KEYWORD.find((item) => item.pattern.test(String(instruction || '')))?.color || '#111827'
);

export const splitTranslationRegionRenderLines = (text = '', lineCount = 1) => {
  const normalizedText = String(text || '').trim();
  if (!normalizedText) return [];
  if (normalizedText.includes('\n')) {
    return normalizedText.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  }
  const safeLineCount = Math.max(1, Math.floor(Number(lineCount) || 1));
  if (safeLineCount <= 1) return [normalizedText];

  const words = normalizedText.split(/\s+/).filter(Boolean);
  if (words.length >= safeLineCount) {
    const lines = [];
    const perLine = Math.ceil(words.length / safeLineCount);
    for (let index = 0; index < words.length; index += perLine) {
      lines.push(words.slice(index, index + perLine).join(' '));
    }
    return lines.slice(0, safeLineCount);
  }

  const chars = Array.from(normalizedText);
  const perLine = Math.ceil(chars.length / safeLineCount);
  return Array.from({ length: safeLineCount }, (_, index) => (
    chars.slice(index * perLine, (index + 1) * perLine).join('').trim()
  )).filter(Boolean);
};

export const resolveTranslationRegionTextRenderPlan = (regionOrInstruction = {}) => {
  const instruction = typeof regionOrInstruction === 'string'
    ? regionOrInstruction
    : regionOrInstruction?.instruction;
  const text = extractReplacementText(instruction);
  if (!text) return null;

  const lineCount = TWO_LINE_PATTERN.test(String(instruction || '')) ? 2 : 1;
  return {
    operation: 'model_text_generation',
    text,
    lines: splitTranslationRegionRenderLines(text, lineCount),
    lineCount,
    color: resolveColor(instruction),
    fontWeight: /(?:加粗|粗体|bold)/i.test(String(instruction || '')) ? 800 : 700,
    align: /(?:居中|center)/i.test(String(instruction || '')) ? 'center' : 'center',
  };
};

export const isTranslationRegionBackgroundCleanupInstruction = (instruction = '') => (
  isTranslationRegionEraseInstruction(instruction)
  || Boolean(resolveTranslationRegionTextRenderPlan(instruction))
);

export const buildTranslationRegionTextRenderGuidance = () => (
  '文字替换任务：在该编号框内直接输出替换完成后的最终效果。原有文字应被新文字覆盖或替换，不应残留；不要只清空背景。新文字内容、颜色、行数、排版、字号和位置严格按 instruction 执行，并与原图商业海报风格自然融合。'
);
