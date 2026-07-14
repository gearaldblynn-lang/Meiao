import {
  claimDueAssetCleanupTasks,
  completeAssetCleanupTask,
  retryAssetCleanupTask,
} from './assetLifecycleStore.mjs';
import { deleteStoredAssetFile, markStoredAssetStorageStatus } from './assetStore.mjs';
import { deleteTencentCosImage } from './tencentCosImageStore.mjs';

const defaultStore = {
  claimDue: claimDueAssetCleanupTasks,
  complete: completeAssetCleanupTask,
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
  storeOptions = {},
  cosOptions = {},
} = {}) => {
  const tasks = await store.claimDue(pool, limit, storeOptions);
  const summary = {
    claimed: tasks.length,
    completed: 0,
    retried: 0,
    manualReview: 0,
  };

  for (const task of tasks) {
    try {
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
