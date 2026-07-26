const text = (value) => String(value || '').trim();

const historicalSelection = (snapshot) => (
  snapshot?.allowHistoricalPublishedVersion === true
  || (Number.isFinite(Number(snapshot?.publishedAt))
    && Array.isArray(snapshot?.selectedAssetIds)
    && [3, 4, 5].includes(snapshot.selectedAssetIds.length)
    && new Set(snapshot.selectedAssetIds.map(text)).size === snapshot.selectedAssetIds.length)
);

export const sanitizeVirtualModelSnapshot = (snapshot = {}, options = {}) => {
  if (snapshot?.identitySource !== 'library') return undefined;
  const virtualModelId = text(snapshot.virtualModelId);
  const virtualModelVersionId = text(snapshot.virtualModelVersionId);
  if (!virtualModelId || !virtualModelVersionId) return undefined;

  const safe = {
    identitySource: 'library',
    virtualModelId,
    virtualModelVersionId,
    ...(text(snapshot.modelName) ? { modelName: text(snapshot.modelName) } : {}),
    ...(text(snapshot.modelCode) ? { modelCode: text(snapshot.modelCode) } : {}),
    ...(Number.isFinite(Number(snapshot.versionNumber)) ? { versionNumber: Number(snapshot.versionNumber) } : {}),
  };
  const publishedAt = Number(snapshot.publishedAt);
  const selectedAssetIds = Array.isArray(snapshot.selectedAssetIds)
    ? snapshot.selectedAssetIds.map(text).filter(Boolean)
    : [];
  if (historicalSelection(snapshot) && Number.isFinite(publishedAt) && [3, 4, 5].includes(selectedAssetIds.length) && new Set(selectedAssetIds).size === selectedAssetIds.length) {
    if (options.forceHistorical === true || snapshot.allowHistoricalPublishedVersion === true) {
      safe.allowHistoricalPublishedVersion = true;
    }
    safe.publishedAt = publishedAt;
    safe.selectedAssetIds = selectedAssetIds;
  }
  return safe;
};

export const sanitizeModelReplaceGenerationContext = (context = {}) => {
  const snapshot = sanitizeVirtualModelSnapshot(context?.virtualModelSnapshot);
  if (!snapshot || context?.identitySource !== 'library') return {
    ...context,
    materials: Object.fromEntries(Object.entries(context?.materials || {}).map(([type, items]) => [
      type,
      (Array.isArray(items) ? items : []).map((item) => ({ ...item })),
    ])),
  };
  const { model: _uploadedIdentity, ...materials } = context?.materials || {};
  return {
    ...context,
    identitySource: 'library',
    virtualModelSnapshot: snapshot,
    materials: Object.fromEntries(Object.entries(materials).map(([type, items]) => [
      type,
      (Array.isArray(items) ? items : []).map((item) => ({ ...item })),
    ])),
  };
};

