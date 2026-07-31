const SAFE_ASSET_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u;
const MANAGED_ASSET_IDENTITY = /^managed:\/\/([A-Za-z0-9][A-Za-z0-9._:-]{0,199})$/u;
const MANAGED_ASSET_PATH = /^\/api\/assets\/file\/([A-Za-z0-9][A-Za-z0-9._:-]{0,199})(?:\/[^?#]*)?$/u;

const extractManagedPathAssetId = (pathname) => (
  MANAGED_ASSET_PATH.exec(String(pathname || ''))?.[1] || ''
);

export const extractManagedAssetIdentityId = (value) => (
  MANAGED_ASSET_IDENTITY.exec(String(value || '').trim())?.[1] || ''
);

export const normalizeManagedAssetIdentity = (value, expectedAssetId) => {
  const assetId = String(expectedAssetId || '').trim();
  const candidate = String(value || '').trim();
  if (!SAFE_ASSET_ID.test(assetId) || !candidate) return '';

  if (extractManagedAssetIdentityId(candidate) === assetId) {
    return candidate;
  }

  let resolvedAssetId = '';
  if (candidate.startsWith('/')) {
    if (candidate.includes('?') || candidate.includes('#')) return '';
    resolvedAssetId = extractManagedPathAssetId(candidate);
  } else {
    let parsed;
    try {
      parsed = new URL(candidate);
    } catch {
      return '';
    }
    if (
      !['http:', 'https:'].includes(parsed.protocol)
      || parsed.username
      || parsed.password
      || parsed.search
      || parsed.hash
    ) {
      return '';
    }
    resolvedAssetId = extractManagedPathAssetId(parsed.pathname);
  }

  return resolvedAssetId === assetId ? `managed://${assetId}` : '';
};
