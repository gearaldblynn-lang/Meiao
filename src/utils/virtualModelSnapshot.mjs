const text = (value) => String(value || '').trim();
const LIBRARY_IDENTITY_SOURCE = 'library';

/**
 * @typedef {{
 *   identitySource: 'library';
 *   virtualModelId: string;
 *   virtualModelVersionId: string;
 *   modelName?: string;
 *   modelCode?: string;
 *   versionNumber?: number;
 *   allowHistoricalPublishedVersion?: boolean;
 *   publishedAt?: number;
 *   selectedAssetIds?: string[];
 * }} LibraryVirtualModelSnapshot
 */

const historicalSelection = (snapshot) => (
  snapshot?.allowHistoricalPublishedVersion === true
  || (Number.isFinite(Number(snapshot?.publishedAt))
    && Array.isArray(snapshot?.selectedAssetIds)
    && [3, 4, 5].includes(snapshot.selectedAssetIds.length)
    && new Set(snapshot.selectedAssetIds.map(text)).size === snapshot.selectedAssetIds.length)
);

/**
 * @param {Record<string, unknown>} snapshot
 * @param {{ forceHistorical?: boolean }} options
 * @returns {LibraryVirtualModelSnapshot | undefined}
 */
export const sanitizeVirtualModelSnapshot = (snapshot = {}, options = {}) => {
  if (snapshot?.identitySource !== 'library') return undefined;
  const virtualModelId = text(snapshot.virtualModelId);
  const virtualModelVersionId = text(snapshot.virtualModelVersionId);
  if (!virtualModelId || !virtualModelVersionId) return undefined;

  const safe = {
    identitySource: LIBRARY_IDENTITY_SOURCE,
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

/**
 * @param {{ identitySource?: string; librarySelection?: Record<string, unknown> | null }} identityDraft
 * @returns {{ identitySource: 'library'; virtualModelSnapshot: LibraryVirtualModelSnapshot } | undefined}
 */
export const buildLibraryModelReplaceContext = (identityDraft = {}) => {
  if (identityDraft?.identitySource !== 'library') return undefined;
  const selection = identityDraft?.librarySelection && typeof identityDraft.librarySelection === 'object'
    ? identityDraft.librarySelection
    : {};
  const virtualModelSnapshot = sanitizeVirtualModelSnapshot({
    identitySource: 'library',
    ...selection,
  });
  if (!virtualModelSnapshot) return undefined;
  return {
    identitySource: LIBRARY_IDENTITY_SOURCE,
    virtualModelSnapshot,
  };
};

/**
 * @param {Record<string, unknown> | null | undefined} snapshot
 * @param {number} fallback
 */
export const getLibraryModelReplaceIdentityCount = (snapshot, fallback = 3) => {
  const safeFallback = [3, 4, 5].includes(Number(fallback)) ? Number(fallback) : 3;
  const safe = sanitizeVirtualModelSnapshot(snapshot || {});
  const count = Array.isArray(safe?.selectedAssetIds) ? safe.selectedAssetIds.length : 0;
  return [3, 4, 5].includes(count) ? count : safeFallback;
};

/**
 * @param {{ snapshot?: Record<string, unknown> | null; referenceAnalysis?: unknown }} input
 */
export const buildLibraryModelReplaceJobMetadata = ({ snapshot, referenceAnalysis = null } = {}) => {
  const safe = sanitizeVirtualModelSnapshot(snapshot || {});
  if (!safe) return {};
  return {
    identitySource: LIBRARY_IDENTITY_SOURCE,
    virtualModelId: safe.virtualModelId,
    virtualModelVersionId: safe.virtualModelVersionId,
    ...(safe.modelName ? { modelName: safe.modelName } : {}),
    ...(safe.modelCode ? { modelCode: safe.modelCode } : {}),
    ...(Number.isFinite(Number(safe.versionNumber)) ? { versionNumber: Number(safe.versionNumber) } : {}),
    ...(safe.allowHistoricalPublishedVersion === true ? { allowHistoricalPublishedVersion: true } : {}),
    ...(Number.isFinite(Number(safe.publishedAt)) ? { publishedAt: Number(safe.publishedAt) } : {}),
    ...(Array.isArray(safe.selectedAssetIds) ? { selectedAssetIds: [...safe.selectedAssetIds] } : {}),
    referenceAnalysis: referenceAnalysis || null,
  };
};

export const snapshotVirtualModelFromJobPayload = (payload = {}) => (
  sanitizeVirtualModelSnapshot({
    identitySource: payload?.identitySource,
    virtualModelId: payload?.virtualModelId,
    virtualModelVersionId: payload?.virtualModelVersionId,
    modelName: payload?.virtualModelNameSnapshot || payload?.modelName,
    modelCode: payload?.virtualModelCodeSnapshot || payload?.modelCode,
    versionNumber: payload?.versionNumber,
    publishedAt: payload?.publishedAt,
    selectedAssetIds: payload?.selectedAssetIds,
  }, { forceHistorical: true })
);

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
