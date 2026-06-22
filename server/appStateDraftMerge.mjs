const compactKey = (value) => String(value || '').trim();

const mergeIdArrays = (...lists) => Array.from(new Set(
  lists
    .flatMap((list) => Array.isArray(list) ? list : [])
    .map((value) => compactKey(value))
    .filter(Boolean),
)).slice(-500);

const mergeDraftInputState = (existingInput = {}, incomingInput = {}) => {
  const next = { ...(existingInput || {}) };
  Object.entries(incomingInput || {}).forEach(([scopeKey, incomingEntry]) => {
    const incoming = incomingEntry && typeof incomingEntry === 'object' ? incomingEntry : {};
    const existing = next[scopeKey] && typeof next[scopeKey] === 'object' ? next[scopeKey] : {};
    const incomingPrompt = typeof incoming.promptText === 'string' ? incoming.promptText : '';
    const existingPrompt = typeof existing.promptText === 'string' ? existing.promptText : '';
    next[scopeKey] = {
      ...existing,
      ...incoming,
      promptText: incomingPrompt.trim() || !existingPrompt.trim() ? incomingPrompt : existingPrompt,
      params: {
        ...(existing.params || {}),
        ...(incoming.params || {}),
      },
    };
  });
  return next;
};

const mergeDraftMaterials = (existingMaterials = {}, incomingMaterials = {}) => {
  const next = { ...(existingMaterials || {}) };
  Object.entries(incomingMaterials || {}).forEach(([type, incomingList]) => {
    next[type] = Array.isArray(incomingList) ? incomingList : [];
  });
  return next;
};

export const mergeShellDraftForStorage = (existingDraft = {}, incomingDraft = {}) => ({
  ...(existingDraft || {}),
  ...(incomingDraft || {}),
  inputStateByScope: mergeDraftInputState(existingDraft?.inputStateByScope, incomingDraft?.inputStateByScope),
  materials: mergeDraftMaterials(existingDraft?.materials, incomingDraft?.materials),
  deletedJobIds: mergeIdArrays(existingDraft?.deletedJobIds, incomingDraft?.deletedJobIds),
  deletedProjectIds: mergeIdArrays(existingDraft?.deletedProjectIds, incomingDraft?.deletedProjectIds),
  deletedResultIds: mergeIdArrays(existingDraft?.deletedResultIds, incomingDraft?.deletedResultIds),
});
