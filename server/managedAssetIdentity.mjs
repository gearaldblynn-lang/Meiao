const SAFE_ASSET_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u;
const MANAGED_ASSET_IDENTITY_SCHEME = /^managed:/iu;
const MANAGED_ASSET_IDENTITY = /^managed:\/\/([A-Za-z0-9][A-Za-z0-9._:-]{0,199})$/u;
const MANAGED_ASSET_PATH = /^\/api\/assets\/file\/([A-Za-z0-9][A-Za-z0-9._:-]{0,199})(?:\/([^/?#]+))?$/u;

const extractManagedPathAssetId = (pathname) => {
  const match = MANAGED_ASSET_PATH.exec(String(pathname || ''));
  if (!match) return '';
  if (match[2]) {
    let decodedName;
    try {
      decodedName = decodeURIComponent(match[2]);
    } catch {
      return '';
    }
    if (
      decodedName === '.'
      || decodedName === '..'
      || decodedName.includes('/')
      || decodedName.includes('\\')
    ) {
      return '';
    }
  }
  return match[1];
};

export const extractManagedAssetIdentityId = (value) => (
  MANAGED_ASSET_IDENTITY.exec(String(value || '').trim())?.[1] || ''
);

export const hasManagedAssetIdentityScheme = (value) => (
  MANAGED_ASSET_IDENTITY_SCHEME.test(String(value || '').trim())
);

export const extractManagedAssetPublicPathId = (value) => {
  const candidate = String(value || '').trim();
  if (
    !candidate
    || candidate.includes('?')
    || candidate.includes('#')
    || candidate.includes('\\')
  ) {
    return '';
  }
  let rawPath = '';
  if (candidate.startsWith('/')) {
    rawPath = candidate;
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
    ) {
      return '';
    }
    const schemeSeparatorIndex = candidate.indexOf('://');
    if (schemeSeparatorIndex < 0) return '';
    const pathStartIndex = candidate.indexOf('/', schemeSeparatorIndex + 3);
    rawPath = pathStartIndex >= 0 ? candidate.slice(pathStartIndex) : '';
  }

  if (!rawPath) return '';
  const normalizedPath = new URL(rawPath, 'http://managed-asset.invalid').pathname;
  if (normalizedPath !== rawPath) return '';
  return extractManagedPathAssetId(rawPath);
};

export const normalizeManagedAssetIdentity = (value, expectedAssetId) => {
  const assetId = String(expectedAssetId || '').trim();
  const candidate = String(value || '').trim();
  if (!SAFE_ASSET_ID.test(assetId) || !candidate) return '';

  if (extractManagedAssetIdentityId(candidate) === assetId) {
    return candidate;
  }

  const resolvedAssetId = extractManagedAssetPublicPathId(candidate);
  return resolvedAssetId === assetId ? `managed://${assetId}` : '';
};
