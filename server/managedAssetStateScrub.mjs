const isExplicitManagedAssetIdKey = (key) => (
  key === 'assetId' || (key.endsWith('AssetId') && key !== 'localAssetId')
);

export const scrubUnavailableExplicitManagedAssetIds = (value, validAssetReferences) => {
  const validReferences = validAssetReferences instanceof Set
    ? validAssetReferences
    : new Set(validAssetReferences || []);

  if (Array.isArray(value)) {
    return value.map((item) => scrubUnavailableExplicitManagedAssetIds(item, validReferences));
  }
  if (!value || typeof value !== 'object') return value;

  const next = {};
  for (const [key, child] of Object.entries(value)) {
    if (
      isExplicitManagedAssetIdKey(key)
      && typeof child === 'string'
      && child.trim()
      && !validReferences.has(child.trim())
    ) {
      continue;
    }
    next[key] = scrubUnavailableExplicitManagedAssetIds(child, validReferences);
  }
  return next;
};
