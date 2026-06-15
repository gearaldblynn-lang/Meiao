// 模型能力单一来源。新增模型只改这张表。
// 上下文数值为官方权威值(业主 2026-06-15 核实)。
export const MODEL_CAPABILITIES = {
  'gpt-5-4-openai-resp': { contextWindowTokens: 1000000, maxOutputTokens: 128000, supportsStreaming: true, supportsToolUse: false },
  'claude-sonnet-4-6': { contextWindowTokens: 1000000, maxOutputTokens: 64000, supportsStreaming: true, supportsToolUse: false },
  'gemini-3.1-pro-openai': { contextWindowTokens: 1000000, maxOutputTokens: 64000, supportsStreaming: true, supportsToolUse: false },
  'gemini-3-flash-openai': { contextWindowTokens: 1048576, maxOutputTokens: 64000, supportsStreaming: true, supportsToolUse: false },
  'gemini-3-5-flash': { contextWindowTokens: 1048576, maxOutputTokens: 64000, supportsStreaming: true, supportsToolUse: false },
};

const CONSERVATIVE_DEFAULT = {
  contextWindowTokens: 128000,
  maxOutputTokens: 4096,
  supportsStreaming: false,
  supportsToolUse: false,
  isFallbackDefault: true,
};

export const getModelCapability = (modelId) => {
  const key = String(modelId || '').trim();
  const hit = MODEL_CAPABILITIES[key];
  if (hit) return { ...hit, isFallbackDefault: false };
  console.warn(`[modelCapabilities] 模型未登记,走保守默认: ${key || '(空)'}`);
  return { ...CONSERVATIVE_DEFAULT };
};
