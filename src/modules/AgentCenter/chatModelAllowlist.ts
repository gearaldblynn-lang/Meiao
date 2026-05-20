export const filterChatModelsByAllowlist = <T extends { id: string }>(chatModels: T[] = [], allowedModels: string[] = []) => {
  const source = Array.isArray(chatModels) ? chatModels : [];
  const allowed = new Set((Array.isArray(allowedModels) ? allowedModels : []).map((item) => String(item || '').trim()).filter(Boolean));
  if (!allowed.size) return source;
  const filtered = source.filter((item) => allowed.has(item.id));
  return filtered.length ? filtered : source;
};

export const resolveDefaultAllowedChatModels = <T extends { id: string }>(chatModels: T[] = []) => {
  const source = Array.isArray(chatModels) ? chatModels : [];
  const preferred = ['gpt-5-4-openai-resp', 'gemini-3-flash-openai'];
  const selected = preferred.filter((id) => source.some((item) => item.id === id));
  return selected.length ? selected : source.slice(0, Math.min(2, source.length)).map((item) => item.id);
};
