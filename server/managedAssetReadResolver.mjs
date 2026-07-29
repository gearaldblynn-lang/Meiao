import {
  extractStoredAssetIdFromPublicUrl,
  getStoredAssetById,
  getStoredAssetStorageProvider,
} from './assetStore.mjs';
import {
  appendManagedAssetAccessKey,
  stripManagedAssetAccessKey,
} from './managedAssetAccessKey.mjs';
import { createTencentCosImageReadUrl, headTencentCosImage } from './tencentCosImageStore.mjs';

const createReadError = (code, message, statusCode) => {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  error.providerStage = 'asset_read';
  error.providerStatus = statusCode === 403 ? 'forbidden' : 'unavailable';
  return error;
};

const buildInternalProviderReadUrl = (value, asset, env = {}, appendAccessKey = appendManagedAssetAccessKey) => {
  const configuredPort = Number(env.PORT || process.env.PORT || 3100);
  const port = Number.isInteger(configuredPort) && configuredPort > 0 && configuredPort <= 65535
    ? configuredPort
    : 3100;
  const loopbackOrigin = `http://127.0.0.1:${port}`;
  const sourceValue = stripManagedAssetAccessKey(value || asset.publicUrl);
  const parsed = new URL(sourceValue, loopbackOrigin);
  const loopbackUrl = new URL(`${parsed.pathname}${parsed.search}`, loopbackOrigin).toString();
  return appendAccessKey(loopbackUrl, {
    assetId: asset.id,
    userId: asset.userId,
  }, env);
};

export const resolveManagedAssetReadUrl = async (value, options = {}) => {
  const assetId = extractStoredAssetIdFromPublicUrl(value);
  if (!assetId) return '';
  const getAsset = options.getAsset || getStoredAssetById;
  const asset = await getAsset(options.pool || null, assetId);
  if (!asset || asset.deletedAt || String(asset.storageStatus || 'active') !== 'active') {
    throw createReadError('managed_asset_unavailable', '图片素材不存在或已不可用', 404);
  }
  const userId = String(options.userId || '').trim();
  const authorizedSharedAssetIds = options.authorizedSharedAssetIds instanceof Set
    ? options.authorizedSharedAssetIds
    : new Set();
  const isAuthorizedSharedVirtualModelAsset = String(asset.module || '') === 'virtual_model'
    && authorizedSharedAssetIds.has(assetId);
  if (asset.userId && (!userId || String(asset.userId) !== userId) && !isAuthorizedSharedVirtualModelAsset) {
    throw createReadError('managed_asset_forbidden', '没有权限读取该图片素材', 403);
  }
  if (getStoredAssetStorageProvider(asset) === 'internal') {
    if (options.purpose !== 'provider') return '';
    return buildInternalProviderReadUrl(
      value,
      asset,
      options.env || process.env,
      options.appendAccessKey || appendManagedAssetAccessKey,
    );
  }
  if (!asset.storageKey) {
    throw createReadError('managed_asset_unavailable', '图片素材存储类型不可用', 404);
  }
  const storageBucket = String(asset.storageBucket || '').trim();
  const storageRegion = String(asset.storageRegion || '').trim();
  if (!storageBucket || !storageRegion) {
    throw createReadError(
      'managed_asset_storage_snapshot_missing',
      '图片素材缺少 COS bucket 或 region 快照',
      503,
    );
  }
  const purpose = options.purpose === 'provider' ? 'provider' : 'browser';
  const cosEnv = {
    ...(options.env || process.env),
    MEIAO_IMAGE_COS_BUCKET: storageBucket,
    MEIAO_IMAGE_COS_REGION: storageRegion,
  };
  const headCos = options.headCos || headTencentCosImage;
  const head = await headCos(asset.storageKey, cosEnv, options.cosOptions || {});
  if (head?.exists === false) {
    throw createReadError(
      'managed_asset_object_missing',
      '图片存储对象缺失，系统正在对账修复，请稍后重试',
      503,
    );
  }
  const createCosReadUrl = options.createCosReadUrl || createTencentCosImageReadUrl;
  return createCosReadUrl(
    asset.storageKey,
    purpose,
    cosEnv,
    options.cosOptions || {},
  );
};
