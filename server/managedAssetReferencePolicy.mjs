import {
  collectExplicitManagedAssetIds,
  collectStoredAssetIdsFromValue,
  listStoredAssetsForUser,
} from './assetStore.mjs';

const createForbiddenReferenceError = () => {
  const error = new Error('图片素材不属于当前账号或已不可用');
  error.code = 'managed_asset_forbidden';
  error.statusCode = 403;
  error.providerStage = 'asset_reference';
  error.providerStatus = 'forbidden';
  return error;
};

export const assertOwnedActiveManagedAssetReferences = async ({
  value,
  userId,
  pool = null,
  listAssetsForUser = listStoredAssetsForUser,
} = {}) => {
  const requestedIds = new Set(collectStoredAssetIdsFromValue(value));
  collectExplicitManagedAssetIds(value, requestedIds);
  if (requestedIds.size === 0) return;

  const normalizedUserId = String(userId || '').trim();
  if (!normalizedUserId) throw createForbiddenReferenceError();
  const assets = await listAssetsForUser(pool, normalizedUserId);
  const activeOwnedIds = new Set((assets || [])
    .filter((asset) => (
      String(asset?.userId || '') === normalizedUserId
      && !asset?.deletedAt
      && String(asset?.storageStatus || 'active') === 'active'
      && Boolean(asset?.storageKey)
    ))
    .map((asset) => String(asset.id || ''))
    .filter(Boolean));

  if (Array.from(requestedIds).some((assetId) => !activeOwnedIds.has(String(assetId)))) {
    throw createForbiddenReferenceError();
  }
};

export const prepareAuthorizedManagedAssetJobPayload = async ({
  value,
  userId,
  pool = null,
  scrubPayload,
  assertReferences = assertOwnedActiveManagedAssetReferences,
  appendTrustedMetadata,
} = {}) => {
  const callerOwnedPayload = await scrubPayload(value, userId);
  await assertReferences({
    value: callerOwnedPayload,
    userId,
    pool,
  });
  return appendTrustedMetadata(callerOwnedPayload);
};
