import {
  extractStoredAssetIdFromPublicUrl,
  getStoredAssetById,
  getStoredAssetStorageProvider,
} from './assetStore.mjs';
import { createTencentCosImageReadUrl } from './tencentCosImageStore.mjs';

const createReadError = (code, message, statusCode) => {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  error.providerStage = 'asset_read';
  error.providerStatus = statusCode === 403 ? 'forbidden' : 'unavailable';
  return error;
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
  if (userId && asset.userId && String(asset.userId) !== userId) {
    throw createReadError('managed_asset_forbidden', '没有权限读取该图片素材', 403);
  }
  if (getStoredAssetStorageProvider(asset) === 'internal') return '';
  if (!asset.storageKey) {
    throw createReadError('managed_asset_unavailable', '图片素材存储类型不可用', 404);
  }
  const purpose = options.purpose === 'provider' ? 'provider' : 'browser';
  const createCosReadUrl = options.createCosReadUrl || createTencentCosImageReadUrl;
  return createCosReadUrl(
    asset.storageKey,
    purpose,
    options.env || process.env,
    options.cosOptions || {},
  );
};
