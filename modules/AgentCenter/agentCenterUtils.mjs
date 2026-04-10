const DEFAULT_MODEL_POLICY = {
  defaultModel: 'gpt-5-4-openai-resp',
  cheapModel: 'gemini-3-flash-openai',
  advancedModel: 'gemini-3.1-pro-openai',
  multimodalModel: 'nano-banana-2',
  imageGenerationEnabled: false,
};

const DEFAULT_CONTEXT_POLICY = {
  maxHistoryRounds: 6,
  summaryTriggerThreshold: 10,
  maxSummaryChars: 1200,
};

const DEFAULT_RETRIEVAL_POLICY = {
  enabled: true,
  topK: 3,
  maxChunks: 5,
  similarityThreshold: 1,
  sourcePriority: ['faq', 'rule', 'sop', 'case', 'upload', 'manual'],
  maxContextChars: 2400,
  fallbackMode: 'answer_with_notice',
};

const DEFAULT_TOOL_POLICY = {
  supportsImageInput: false,
  supportsFileInput: false,
};

const DEFAULT_REPLY_STYLE_RULES = {
  tone: 'professional',
  citeKnowledge: true,
  noAnswerFallback: '未在当前知识库中找到明确依据，请联系对应部门负责人确认。',
};

const SOURCE_PRIORITY_WEIGHT = {
  faq: 5,
  rule: 4,
  sop: 3,
  case: 2,
  upload: 1,
  manual: 1,
};

export const KNOWLEDGE_CHUNK_STRATEGY_META = {
  general: {
    label: '通用型',
    maxChunkChars: 420,
    description: '适合普通说明文档，按空行分段，超长再截断。',
  },
  rule: {
    label: '规则型',
    maxChunkChars: 360,
    description: '适合规则、参数规范、生图规则，尽量保证一条规则独立成片。',
  },
  sop: {
    label: 'SOP型',
    maxChunkChars: 520,
    description: '适合操作流程和步骤说明，优先保留步骤顺序。',
  },
  faq: {
    label: 'FAQ型',
    maxChunkChars: 320,
    description: '适合问答库，一问一答优先成片。',
  },
  case: {
    label: '案例型',
    maxChunkChars: 680,
    description: '适合案例和素材记录，保留更多上下文。',
  },
};

export const normalizeKnowledgeChunkStrategy = (value) =>
  (value && KNOWLEDGE_CHUNK_STRATEGY_META[value] ? value : 'general');

const normalizePositiveInteger = (value, fallback) => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const padDatePart = (value) => String(value).padStart(2, '0');

export const createDefaultVersionName = (versionNo, timestamp = Date.now()) => {
  const safeVersionNo = normalizePositiveInteger(versionNo, 1);
  const date = new Date(Number(timestamp || Date.now()));
  const year = date.getFullYear();
  const month = padDatePart(date.getMonth() + 1);
  const day = padDatePart(date.getDate());
  const hours = padDatePart(date.getHours());
  const minutes = padDatePart(date.getMinutes());
  return `V${safeVersionNo} · ${year}-${month}-${day} ${hours}:${minutes}`;
};

export const resolveActiveAgentId = ({
  workspacePage = 'plaza',
  selectedAgentId = '',
  selectedSession = null,
}) => {
  if (workspacePage === 'chat') {
    return selectedSession?.agentId || selectedAgentId;
  }
  return selectedAgentId;
};

export const normalizeAgentConfig = (input = {}) => ({
  systemPrompt: typeof input.systemPrompt === 'string' ? input.systemPrompt.trim() : '',
  replyStyleRules: {
    ...DEFAULT_REPLY_STYLE_RULES,
    ...(input.replyStyleRules && typeof input.replyStyleRules === 'object' ? input.replyStyleRules : {}),
  },
  modelPolicy: {
    ...DEFAULT_MODEL_POLICY,
    ...(input.modelPolicy && typeof input.modelPolicy === 'object' ? input.modelPolicy : {}),
  },
  contextPolicy: {
    ...DEFAULT_CONTEXT_POLICY,
    ...(input.contextPolicy && typeof input.contextPolicy === 'object' ? input.contextPolicy : {}),
  },
  retrievalPolicy: {
    ...DEFAULT_RETRIEVAL_POLICY,
    ...(input.retrievalPolicy && typeof input.retrievalPolicy === 'object' ? input.retrievalPolicy : {}),
    topK: normalizePositiveInteger(input?.retrievalPolicy?.topK, DEFAULT_RETRIEVAL_POLICY.topK),
    maxChunks: normalizePositiveInteger(input?.retrievalPolicy?.maxChunks, DEFAULT_RETRIEVAL_POLICY.maxChunks),
    maxContextChars: normalizePositiveInteger(input?.retrievalPolicy?.maxContextChars, DEFAULT_RETRIEVAL_POLICY.maxContextChars),
  },
  toolPolicy: {
    ...DEFAULT_TOOL_POLICY,
    ...(input.toolPolicy && typeof input.toolPolicy === 'object' ? input.toolPolicy : {}),
  },
});

const splitChunkByLength = (value, maxChunkChars) => {
  const source = String(value || '').trim();
  if (!source) return [];
  if (source.length <= maxChunkChars) return [source];
  const slices = [];
  let start = 0;
  while (start < source.length) {
    const slice = source.slice(start, start + maxChunkChars).trim();
    if (slice) slices.push(slice);
    start += maxChunkChars;
  }
  return slices;
};

const buildRuleBlocks = (normalized) => {
  const lines = normalized.split('\n');
  const blocks = [];
  let current = [];
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      if (current.length > 0) current.push('');
      continue;
    }
    if ((/^(#{1,6}\s|规则[:：])/.test(line)) && current.length > 0) {
      blocks.push(current.join('\n').trim());
      current = [line];
      continue;
    }
    current.push(line);
  }
  if (current.length > 0) blocks.push(current.join('\n').trim());
  return blocks.filter(Boolean);
};

const buildFaqBlocks = (normalized) => {
  const lines = normalized.split('\n').map((item) => item.trim());
  const blocks = [];
  let current = [];
  for (const line of lines) {
    if (!line) continue;
    if (/^(Q[:：]|问[:：])/.test(line) && current.length > 0) {
      blocks.push(current.join('\n'));
      current = [line];
      continue;
    }
    current.push(line);
  }
  if (current.length > 0) blocks.push(current.join('\n'));
  return blocks;
};

const buildSopBlocks = (normalized) => normalized
  .split(/\n(?=(?:步骤\s*\d+|第[一二三四五六七八九十]+步|[0-9]+\.\s|[0-9]+、))/g)
  .map((item) => item.trim())
  .filter(Boolean);

export const chunkKnowledgeText = (text, { maxChunkChars, strategy = 'general' } = {}) => {
  const normalized = String(text || '').replace(/\r\n/g, '\n').trim();
  if (!normalized) return [];

  const safeStrategy = normalizeKnowledgeChunkStrategy(strategy);
  const strategyMeta = KNOWLEDGE_CHUNK_STRATEGY_META[safeStrategy];
  const safeMaxChunkChars = normalizePositiveInteger(maxChunkChars, strategyMeta.maxChunkChars);

  let blocks = [];
  if (safeStrategy === 'rule') {
    blocks = buildRuleBlocks(normalized);
  } else if (safeStrategy === 'faq') {
    blocks = buildFaqBlocks(normalized);
  } else if (safeStrategy === 'sop') {
    blocks = buildSopBlocks(normalized);
  }

  if (blocks.length === 0) {
    blocks = normalized
      .split(/\n{2,}/)
      .map((item) => item.replace(/\s+/g, ' ').trim())
      .filter(Boolean);
  }

  return blocks.flatMap((block) => splitChunkByLength(block, safeMaxChunkChars));
};

const buildKeywordSet = (value) => {
  const source = String(value || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .split(/\s+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2);

  const keywords = new Set();
  source.forEach((token) => {
    keywords.add(token);
    if (/[\u4e00-\u9fff]/.test(token) && token.length > 2) {
      for (let index = 0; index < token.length - 1; index += 1) {
        keywords.add(token.slice(index, index + 2));
      }
    }
  });
  return keywords;
};

export const searchKnowledgeChunks = (chunks, query, policy = DEFAULT_RETRIEVAL_POLICY) => {
  const sourcePriority = Array.isArray(policy.sourcePriority) && policy.sourcePriority.length > 0
    ? policy.sourcePriority
    : DEFAULT_RETRIEVAL_POLICY.sourcePriority;
  const queryKeywords = buildKeywordSet(query);
  const priorityMap = Object.fromEntries(sourcePriority.map((key, index) => [key, sourcePriority.length - index]));

  const ranked = (Array.isArray(chunks) ? chunks : [])
    .map((chunk) => {
      const content = String(chunk?.content || '');
      const contentKeywords = buildKeywordSet(content);
      let score = 0;
      for (const keyword of queryKeywords) {
        if (content.toLowerCase().includes(keyword)) score += 3;
        if (contentKeywords.has(keyword)) score += 2;
      }
      const sourceType = String(chunk?.sourceType || '').toLowerCase();
      score += priorityMap[sourceType] || SOURCE_PRIORITY_WEIGHT[sourceType] || 0;
      return { ...chunk, score };
    })
    .filter((chunk) => chunk.score >= Number(policy.similarityThreshold || 0))
    .sort((a, b) => b.score - a.score || Number(a.chunkIndex || 0) - Number(b.chunkIndex || 0));

  const limited = [];
  let totalChars = 0;
  for (const chunk of ranked) {
    if (limited.length >= Number(policy.maxChunks || DEFAULT_RETRIEVAL_POLICY.maxChunks)) break;
    const content = String(chunk.content || '');
    if (!content) continue;
    if (totalChars + content.length > Number(policy.maxContextChars || DEFAULT_RETRIEVAL_POLICY.maxContextChars)) break;
    limited.push(chunk);
    totalChars += content.length;
    if (limited.length >= Number(policy.topK || DEFAULT_RETRIEVAL_POLICY.topK)) break;
  }
  return limited;
};

const describeRichContentForText = (value) => {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return String(value || '');
  return value.map((item) => {
    if (!item || typeof item !== 'object') return '';
    if (item.type === 'text' || item.type === 'input_text') {
      return String(item.text || '').trim();
    }
    if (item.type === 'image_url' || item.type === 'input_image') {
      return `[图片${item?.image_url?.url || item?.image_url || item?.url ? `: ${item?.image_url?.url || item?.image_url || item?.url}` : ''}]`;
    }
    if (item.type === 'input_file') {
      return `[文件: ${item.filename || item.name || item.file_url || item.url || '附件'}]`;
    }
    return '';
  }).filter(Boolean).join('\n');
};

export const estimateTokenCount = (value) => {
  const text = describeRichContentForText(value).trim();
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / 4));
};

export const buildAgentPromptMessages = ({
  systemPrompt = '',
  summary = '',
  recentMessages = [],
  knowledgeChunks = [],
  userMessage = '',
  hasKnowledgeBase = false,
}) => {
  const messages = [];
  if (systemPrompt.trim()) {
    messages.push({ role: 'system', content: systemPrompt.trim() });
  }
  if (hasKnowledgeBase) {
    messages.push({
      role: 'system',
      content: `你可以通过以下指令查询知识库，获取回答所需的信息：
[SEARCH: 关键词]

使用规则：
- 当你需要查询规则、流程、案例等知识时，先输出 [SEARCH: 关键词]，等待检索结果后再继续
- 可以多次使用，每次针对不同的子问题
- 关键词要精准，例如：[SEARCH: 退款申请流程] 而非 [SEARCH: 退款]
- 信息足够时直接输出最终答案，不要再使用 SEARCH 指令`,
    });
  }
  if (summary.trim()) {
    messages.push({ role: 'system', content: `会话摘要：\n${summary.trim()}` });
  }
  if (knowledgeChunks.length > 0) {
    const knowledgeBlock = knowledgeChunks
      .map((chunk, index) => `资料${index + 1}（${chunk.documentTitle || chunk.sourceType || '知识片段'}）：${chunk.content}`)
      .join('\n\n');
    messages.push({
      role: 'system',
      content: `以下是与当前问题最相关的知识库片段，仅在有明确依据时引用：\n${knowledgeBlock}`,
    });
  }
  recentMessages.forEach((message) => {
    if (!message?.role || !message?.content) return;
    messages.push({ role: message.role, content: message.content });
  });
  messages.push({ role: 'user', content: userMessage });
  return messages;
};

export const buildConversationSummary = (messages, maxChars = DEFAULT_CONTEXT_POLICY.maxSummaryChars) => {
  const source = (Array.isArray(messages) ? messages : [])
    .slice(-12)
    .map((message) => `${message.role === 'assistant' ? '助手' : '用户'}：${describeRichContentForText(message.content).trim()}`)
    .filter(Boolean)
    .join('\n');

  return source.length > maxChars ? `${source.slice(0, maxChars)}...` : source;
};

export const estimateCostByTokens = (promptTokens, completionTokens) => {
  const total = Number(promptTokens || 0) + Number(completionTokens || 0);
  return Number((total * 0.000002).toFixed(6));
};

export const parseAgentToolCalls = (text) => {
  const calls = [];
  const regex = /\[SEARCH:\s*([^\]]+)\]/g;
  let match;
  while ((match = regex.exec(String(text || ''))) !== null) {
    const query = match[1].trim();
    if (query) calls.push({ type: 'search', query });
  }
  return calls;
};

export const stripAgentToolCalls = (text) =>
  String(text || '').replace(/\[SEARCH:\s*[^\]]+\]/g, '').trim();
