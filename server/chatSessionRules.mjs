export const isStudioTestChatSession = (session) =>
  String(session?.title || '').trim() === '工作室测试' || Boolean(session?.is_studio);

export const filterVisibleChatSessions = (sessions = [], { userId = '', agentId = '' } = {}) =>
  (Array.isArray(sessions) ? sessions : [])
    .filter((item) => item?.userId === userId && !isStudioTestChatSession(item) && (!agentId || item.agentId === agentId))
    .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));

export const resolvePreferredReasoningLevel = (reasoningLevels = []) => {
  const normalized = Array.from(new Set(
    (Array.isArray(reasoningLevels) ? reasoningLevels : [])
      .map((item) => String(item || '').trim())
      .filter(Boolean)
  ));
  if (normalized.includes('medium')) return 'medium';
  if (normalized.includes('low')) return 'low';
  return normalized[0] || null;
};

export const resolveSessionReasoningLevel = ({ capability = null, requestedReasoningLevel = null } = {}) => {
  if (!capability?.supportsReasoningLevel) return null;
  const normalized = Array.from(new Set(
    (Array.isArray(capability.reasoningLevels) ? capability.reasoningLevels : [])
      .map((item) => String(item || '').trim())
      .filter(Boolean)
  ));
  if (!normalized.length) return null;
  const requested = String(requestedReasoningLevel || '').trim();
  if (requested && normalized.includes(requested)) return requested;
  const defaultReasoningLevel = resolvePreferredReasoningLevel(capability.reasoningLevels);
  return defaultReasoningLevel && normalized.includes(defaultReasoningLevel) ? defaultReasoningLevel : normalized[0] || null;
};
