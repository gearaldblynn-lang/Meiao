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
import { deleteTencentCosImage, headTencentCosImage } from './tencentCosImageStore.mjs';

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
      const missingActiveObject = task.reason === 'active_object_missing_reconcile';
      if (task.assetId && !missingActiveObject && await isProtected(task)) {
        await store.markAssetStatus(pool, task.assetId, 'active', Date.now());
        await store.protect(pool, task.id, storeOptions);
        summary.protected += 1;
        continue;
      }
      if (task.provider === 'tencent_cos') {
        if (!task.bucket || !task.region) {
          const error = new Error('managed asset cleanup task is missing bucket or region snapshot');
          error.code = 'managed_asset_storage_snapshot_missing';
          throw error;
        }
        await deleteCos(task.storageKey, {
          ...env,
          MEIAO_IMAGE_COS_BUCKET: task.bucket,
          MEIAO_IMAGE_COS_REGION: task.region,
        }, cosOptions);
      } else if (task.provider === 'internal') {
        await deleteLocal(task.storageKey);
      } else {
        const error = new Error(`unsupported managed asset provider: ${task.provider}`);
        error.code = 'unsupported_asset_provider';
        throw error;
      }

      if (task.assetId) {
        await store.markAssetStatus(pool, task.assetId, 'deleted', Date.now());
      }
      await store.complete(pool, task.id, storeOptions);
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
  verifyActiveCos = false,
  deps = {},
} = {}) => {
  const listAssets = deps.listAssets || listAllStoredAssets;
  const markStatus = deps.markStatus || markStoredAssetStorageStatus;
  const enqueueCleanup = deps.enqueueCleanup || enqueueAssetCleanupTask;
  const headCos = deps.headCos || headTencentCosImage;
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
    snapshotMissing: 0,
    activeCosChecked: 0,
    activeCosMissing: 0,
    activeCosHeadFailed: 0,
  };

  for (const asset of assets) {
    const status = String(asset?.storageStatus || 'active');
    const storageProvider = getStoredAssetStorageProvider(asset);
    const storageBucket = storageProvider === 'tencent_cos' ? String(asset?.storageBucket || '').trim() : '';
    const storageRegion = storageProvider === 'tencent_cos' ? String(asset?.storageRegion || '').trim() : '';
    let reason = '';
    if (verifyActiveCos && status === 'active' && storageProvider === 'tencent_cos') {
      if (!asset?.storageKey || !storageBucket || !storageRegion) {
        summary.snapshotMissing += 1;
        continue;
      }
      summary.activeCosChecked += 1;
      try {
        const head = await headCos(asset.storageKey, {
          ...env,
          MEIAO_IMAGE_COS_BUCKET: storageBucket,
          MEIAO_IMAGE_COS_REGION: storageRegion,
        });
        if (head?.exists !== false) continue;
        reason = 'active_object_missing_reconcile';
        await markStatus(pool, asset.id, 'delete_pending', now);
        summary.activeCosMissing += 1;
        summary.deletePending += 1;
      } catch {
        summary.activeCosHeadFailed += 1;
        continue;
      }
    } else if (status === 'delete_pending') reason = 'delete_pending_reconcile';
    else if (status === 'upload_failed') reason = 'upload_failed_reconcile';
    else if (status === 'uploading' && Number(asset?.createdAt || 0) <= now - staleMs) {
      reason = 'stale_upload_reconcile';
      await markStatus(pool, asset.id, 'upload_failed', now);
      summary.staleUploads += 1;
      summary.uploadFailed += 1;
    }
    if (!reason || !asset?.storageKey) continue;
    if (storageProvider === 'tencent_cos' && (!storageBucket || !storageRegion)) {
      summary.snapshotMissing += 1;
      continue;
    }
    await enqueueCleanup(pool, {
      assetId: asset.id,
      provider: storageProvider,
      bucket: storageBucket,
      region: storageRegion,
      storageKey: String(asset.storageKey),
      action: 'delete',
      reason,
    });
    summary.enqueued += 1;
  }
  return summary;
};
