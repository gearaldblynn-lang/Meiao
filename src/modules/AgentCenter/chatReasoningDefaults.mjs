const normalizeReasoningLevels = (reasoningLevels = []) => Array.from(
  new Set(
    (Array.isArray(reasoningLevels) ? reasoningLevels : [])
      .map((item) => String(item || '').trim())
      .filter(Boolean)
  )
);

export const resolvePreferredReasoningLevel = (reasoningLevels = []) => {
  const normalized = normalizeReasoningLevels(reasoningLevels);
  if (normalized.includes('medium')) return 'medium';
  if (normalized.includes('low')) return 'low';
  return normalized[0] || null;
};

export const resolveSessionReasoningLevel = ({ reasoningLevels = [], requestedReasoningLevel = null } = {}) => {
  const normalized = normalizeReasoningLevels(reasoningLevels);
  if (!normalized.length) return null;
  const requested = String(requestedReasoningLevel || '').trim();
  if (requested && normalized.includes(requested)) return requested;
  return resolvePreferredReasoningLevel(normalized);
};
