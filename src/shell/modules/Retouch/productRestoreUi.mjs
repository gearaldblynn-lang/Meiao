import {
  PRODUCT_RESTORE_FOCUS_OPTIONS,
  PRODUCT_RESTORE_LIMITS,
  getProductRestoreResolutionOptions,
  normalizeProductRestoreFocusIds,
  normalizeProductRestoreResolution,
} from '../../../modules/Retouch/productRestoreContract.mjs';
import {
  canCreateProductRestore,
  normalizeProductRestoreRollout,
} from '../../../utils/productRestoreRollout.mjs';

export const PRODUCT_RESTORE_MATERIAL_TYPES = Object.freeze([
  'restoreTarget',
  'productReference',
]);

export const PRODUCT_RESTORE_MATERIAL_META = Object.freeze({
  restoreTarget: Object.freeze({
    label: '待还原套图',
    description: '最多 10 张；每张都会单独生成；同一任务只放一个 SKU；超限整次拒绝。',
    limit: PRODUCT_RESTORE_LIMITS.restoreTarget,
  }),
  productReference: Object.freeze({
    label: '产品参考图',
    description: '最多 5 张；按结构、细节、材质、颜色的参考价值从左到右排序；超限整次拒绝。',
    limit: PRODUCT_RESTORE_LIMITS.productReference,
  }),
});

export { PRODUCT_RESTORE_FOCUS_OPTIONS };

/**
 * @param {{ type?: string, existingCount?: number, selectedCount?: number }} options
 */
export const getProductRestoreUploadRejection = ({
  type,
  existingCount = 0,
  selectedCount = 0,
} = {}) => {
  const metadata = PRODUCT_RESTORE_MATERIAL_META[type];
  if (!metadata) return '';

  const current = Math.max(0, Number(existingCount) || 0);
  const selected = Math.max(0, Number(selectedCount) || 0);
  if (current + selected <= metadata.limit) return '';

  return `本次选择未上传：${metadata.label}最多 ${metadata.limit} 张，当前已有 ${current} 张，还可上传 ${Math.max(0, metadata.limit - current)} 张。`;
};

const productRestoreReservationKey = (scopeKey, type) => `${scopeKey}:${type}`;

export const createProductRestoreUploadReservationQueue = () => {
  const states = new Map();

  return {
    reserve({ scopeKey = '', type = '', existingCount = 0, selectedCount = 0 } = {}) {
      const key = productRestoreReservationKey(scopeKey, type);
      const state = states.get(key) || {
        pendingCount: 0,
        tail: Promise.resolve(),
      };
      states.set(key, state);

      const message = getProductRestoreUploadRejection({
        type,
        existingCount: Math.max(0, Number(existingCount) || 0) + state.pendingCount,
        selectedCount,
      });
      if (message) return { ok: false, message };

      const reservedCount = Math.max(0, Number(selectedCount) || 0);
      const precedingTurn = state.tail;
      let finishTurn = () => {};
      const currentTurn = new Promise((resolve) => {
        finishTurn = resolve;
      });
      let turnAvailable = false;
      const waitForTurn = precedingTurn.then(() => {
        turnAvailable = true;
      });
      state.tail = currentTurn;
      state.pendingCount += reservedCount;
      let released = false;
      const finishRelease = () => {
        state.pendingCount = Math.max(0, state.pendingCount - reservedCount);
        finishTurn();
      };

      return {
        ok: true,
        waitForTurn,
        release() {
          if (released) return;
          released = true;
          if (turnAvailable) {
            finishRelease();
            return;
          }
          void waitForTurn.then(finishRelease);
        },
      };
    },
    getPendingCount(scopeKey = '', type = '') {
      return states.get(productRestoreReservationKey(scopeKey, type))?.pendingCount || 0;
    },
  };
};

export const prepareProductRestoreUploadBatch = async (items, prepare) => {
  if (!Array.isArray(items) || typeof prepare !== 'function') return [];
  const prepared = await Promise.all(items.map(async (item, index) => {
    try {
      return await prepare(item, index);
    } catch {
      return null;
    }
  }));
  return prepared.filter((value) => value !== null && value !== undefined);
};

export const moveProductRestoreScopedMaterial = (
  materials,
  id,
  direction,
  subFeature = 'product_restore',
) => {
  if (!Array.isArray(materials) || !['left', 'right'].includes(direction)) return materials;
  const scopedIndexes = materials
    .map((material, index) => material?.subFeature === subFeature ? index : -1)
    .filter((index) => index >= 0);
  const scopedPosition = scopedIndexes.findIndex((index) => materials[index]?.id === id);
  const nextPosition = scopedPosition + (direction === 'left' ? -1 : 1);
  if (scopedPosition < 0 || nextPosition < 0 || nextPosition >= scopedIndexes.length) return materials;

  const nextMaterials = [...materials];
  const currentIndex = scopedIndexes[scopedPosition];
  const nextIndex = scopedIndexes[nextPosition];
  [nextMaterials[currentIndex], nextMaterials[nextIndex]] = [
    nextMaterials[nextIndex],
    nextMaterials[currentIndex],
  ];
  return nextMaterials;
};

export const toggleProductRestoreFocusIds = (value, focusId) => {
  const normalized = normalizeProductRestoreFocusIds(value);
  const requested = normalized.includes(focusId)
    ? normalized.filter((id) => id !== focusId)
    : [...normalized, focusId];
  return normalizeProductRestoreFocusIds(requested);
};

export const getProductRestoreControlState = (eligibleImageModels, params = {}) => {
  const modelOptions = Array.isArray(eligibleImageModels)
    ? eligibleImageModels.filter(Boolean)
    : [];
  const requestedModel = String(params.model || '').trim();
  const model = modelOptions.includes(requestedModel)
    ? requestedModel
    : modelOptions[0] || requestedModel || 'gpt-image-2';
  const qualityOptions = getProductRestoreResolutionOptions(model);

  return {
    modelOptions,
    model,
    qualityOptions,
    quality: normalizeProductRestoreResolution(model, params.quality),
  };
};

export const getProductRestoreCreationDisabledReason = (rolloutMode, role) => {
  const normalized = normalizeProductRestoreRollout(rolloutMode);
  if (canCreateProductRestore(normalized, role)) return '';
  if (normalized === 'admin') {
    return '产品还原当前仅对管理员开放，历史项目仍可查看。';
  }
  return '产品还原暂未开放，历史项目仍可查看。';
};

export const getProductRestoreJobCreationDisabledReason = ({
  module,
  subFeature,
  rolloutMode,
  role,
} = {}) => {
  if (module !== 'retouch' || subFeature !== 'product_restore') return '';
  return getProductRestoreCreationDisabledReason(rolloutMode, role);
};
