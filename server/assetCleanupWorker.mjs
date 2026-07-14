import {
  claimDueAssetCleanupTasks,
  completeAssetCleanupTask,
  enqueueAssetCleanupTask,
  protectAssetCleanupTask,
  retryAssetCleanupTask,
} from './assetLifecycleStore.mjs';
import {
  deleteStoredAssetFile,
  getStoredAssetStorageProvider,
  listAllStoredAssets,
  markStoredAssetStorageStatus,
} from './assetStore.mjs';
import { deleteTencentCosImage } from './tencentCosImageStore.mjs';

const defaultStore = {
  claimDue: claimDueAssetCleanupTasks,
  complete: completeAssetCleanupTask,
  protect: protectAssetCleanupTask,
  retry: retryAssetCleanupTask,
  markAssetStatus: markStoredAssetStorageStatus,
};

export const processAssetCleanupBatch = async ({
  pool = null,
  limit = 20,
  env = process.env,
  store = defaultStore,
  deleteCos = deleteTencentCosImage,
  deleteLocal = deleteStoredAssetFile,
  isProtected = async () => false,
  storeOptions = {},
  cosOptions = {},
} = {}) => {
  const tasks = await store.claimDue(pool, limit, storeOptions);
  const summary = {
    claimed: tasks.length,
    completed: 0,
    retried: 0,
    manualReview: 0,
    protected: 0,
  };

  for (const task of tasks) {
    try {
      if (task.assetId && await isProtected(task)) {
        await store.markAssetStatus(pool, task.assetId, 'active', Date.now());
        await store.protect(pool, task.id, storeOptions);
        summary.protected += 1;
        continue;
      }
      if (task.provider === 'tencent_cos') {
        await deleteCos(task.storageKey, {
          ...env,
          MEIAO_IMAGE_COS_BUCKET: task.bucket || env.MEIAO_IMAGE_COS_BUCKET,
          MEIAO_IMAGE_COS_REGION: task.region || env.MEIAO_IMAGE_COS_REGION,
        }, cosOptions);
      } else if (task.provider === 'internal') {
        await deleteLocal(task.storageKey);
      } else {
        const error = new Error(`unsupported managed asset provider: ${task.provider}`);
        error.code = 'unsupported_asset_provider';
        throw error;
      }

      await store.complete(pool, task.id, storeOptions);
      if (task.assetId) {
        await store.markAssetStatus(pool, task.assetId, 'deleted', Date.now());
      }
      summary.completed += 1;
    } catch (error) {
      const next = await store.retry(pool, task.id, error, storeOptions);
      if (next?.status === 'manual_review') summary.manualReview += 1;
      else summary.retried += 1;
    }
  }

  return summary;
};

export const reconcileManagedAssetStorage = async ({
  pool = null,
  env = process.env,
  now = Date.now(),
  deps = {},
} = {}) => {
  const listAssets = deps.listAssets || listAllStoredAssets;
  const markStatus = deps.markStatus || markStoredAssetStorageStatus;
  const enqueueCleanup = deps.enqueueCleanup || enqueueAssetCleanupTask;
  const parsedStaleMs = Number.parseInt(String(env?.MEIAO_ASSET_UPLOAD_STALE_MS || 15 * 60 * 1000), 10);
  const staleMs = Number.isFinite(parsedStaleMs) && parsedStaleMs > 0 ? parsedStaleMs : 15 * 60 * 1000;
  const assets = await listAssets(pool);
  const summary = {
    scanned: assets.length,
    enqueued: 0,
    staleUploads: 0,
    uploadFailed: assets.filter((asset) => String(asset?.storageStatus || '') === 'upload_failed').length,
    deletePending: assets.filter((asset) => String(asset?.storageStatus || '') === 'delete_pending').length,
    uploading: assets.filter((asset) => String(asset?.storageStatus || '') === 'uploading').length,
  };

  for (const asset of assets) {
    const status = String(asset?.storageStatus || 'active');
    let reason = '';
    if (status === 'delete_pending') reason = 'delete_pending_reconcile';
    else if (status === 'upload_failed') reason = 'upload_failed_reconcile';
    else if (status === 'uploading' && Number(asset?.createdAt || 0) <= now - staleMs) {
      reason = 'stale_upload_reconcile';
      await markStatus(pool, asset.id, 'upload_failed', now);
      summary.staleUploads += 1;
      summary.uploadFailed += 1;
    }
    if (!reason || !asset?.storageKey) continue;
    const storageProvider = getStoredAssetStorageProvider(asset);
    await enqueueCleanup(pool, {
      assetId: asset.id,
      provider: storageProvider,
      bucket: storageProvider === 'tencent_cos' ? String(env?.MEIAO_IMAGE_COS_BUCKET || '').trim() : '',
      region: storageProvider === 'tencent_cos' ? String(env?.MEIAO_IMAGE_COS_REGION || '').trim() : '',
      storageKey: String(asset.storageKey),
      action: 'delete',
      reason,
    });
    summary.enqueued += 1;
  }
  return summary;
};
