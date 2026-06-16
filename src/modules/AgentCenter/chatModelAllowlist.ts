export const filterChatModelsByAllowlist = <T extends { id: string }>(chatModels: T[] = [], allowedModels: string[] = []) => {
  const source = Array.isArray(chatModels) ? chatModels : [];
  const allowed = new Set((Array.isArray(allowedModels) ? allowedModels : []).map((item) => String(item || '').trim()).filter(Boolean));
  if (!allowed.size) return source;
  const filtered = source.filter((item) => allowed.has(item.id));
  return filtered.length ? filtered : source;
};

export const getChatModelChannelMeta = (model: { provider?: string } = {}) => {
  if (model.provider === 'openai_compatible') {
    return {
      label: '中转站',
      tone: 'relay',
      impact: '走 OpenAI Compatible 中转站，支持 tool calling 与生图工具调用；稳定性、费用和限额取决于中转站配置。',
    };
  }
  return {
    label: 'KIE 托管',
    tone: 'managed',
    impact: '走 KIE 托管通道，适合普通聊天和分析；作为后备更稳，但不承载本期新 tool calling 生图工具链。',
  };
};

export type ChatModelChannelFilter = 'all' | 'openai_compatible' | 'kie';

export const filterChatModelsByChannel = <T extends { provider?: string }>(
  chatModels: T[] = [],
  channel: ChatModelChannelFilter = 'all'
) => {
  const source = Array.isArray(chatModels) ? chatModels : [];
  if (channel === 'all') return source;
  return source.filter((item) => item.provider === channel);
};

export const orderChatModelsBySelection = <T extends { id: string }>(chatModels: T[] = [], allowedModels: string[] = []) => {
  const source = Array.isArray(chatModels) ? chatModels : [];
  const selected = (Array.isArray(allowedModels) ? allowedModels : [])
    .map((item) => String(item || '').trim())
    .filter(Boolean);
  if (selected.length === 0) return source;
  const selectedSet = new Set(selected);
  const selectedModels = selected
    .map((id) => source.find((item) => item.id === id))
    .filter((item): item is T => Boolean(item));
  const remainingModels = source.filter((item) => !selectedSet.has(item.id));
  return [...selectedModels, ...remainingModels];
};

export const resolveDefaultAllowedChatModels = <T extends { id: string; provider?: string }>(chatModels: T[] = []) => {
  const source = Array.isArray(chatModels) ? chatModels : [];
  const toolCallingModels = source
    .filter((item) => item?.provider === 'openai_compatible')
    .map((item) => item.id);
  if (toolCallingModels.length > 0) return toolCallingModels.slice(0, 2);
  const preferred = ['gpt-5-4-openai-resp', 'gemini-3-flash-openai'];
  const selected = preferred.filter((id) => source.some((item) => item.id === id));
  return selected.length ? selected : source.slice(0, Math.min(2, source.length)).map((item) => item.id);
};

export const shouldRefreshCreateWizardChatModels = <T extends { id: string; provider?: string }>(
  chatModels: T[] = [],
  allowedModels: string[] = []
) => {
  const defaultAllowed = resolveDefaultAllowedChatModels(chatModels);
  const hasOpenAICompatibleDefault = defaultAllowed.some((id) =>
    chatModels.some((item) => item.id === id && item.provider === 'openai_compatible')
  );
  if (!hasOpenAICompatibleDefault) return false;
  const currentAllowed = (Array.isArray(allowedModels) ? allowedModels : [])
    .map((item) => String(item || '').trim())
    .filter(Boolean);
  const alreadyUsesOpenAICompatible = currentAllowed.some((id) =>
    chatModels.some((item) => item.id === id && item.provider === 'openai_compatible')
  );
  if (alreadyUsesOpenAICompatible) return false;
  const legacyDefaults = ['gpt-5-4-openai-resp', 'gemini-3-flash-openai'];
  if (currentAllowed.length === 0) return true;
  if (currentAllowed.length !== legacyDefaults.length) return false;
  return legacyDefaults.every((id) => currentAllowed.includes(id));
};
