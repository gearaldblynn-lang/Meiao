import {
  canCreateProductRestore,
  normalizeProductRestoreRollout,
} from '../src/utils/productRestoreRollout.mjs';
import { isMaxForAiImageModel } from '../src/utils/maxforaiImageModels.mjs';

const DEFAULT_DEDUPE_WINDOW_MS = 8000;
const CHAT_DEDUPE_WINDOW_MS = 3 * 60 * 1000;
const VIDEO_DEDUPE_WINDOW_MS = 60 * 60 * 1000;
const DEFAULT_SUBMISSION_LOCK_TIMEOUT_SECONDS = 10;

export const PRODUCT_RESTORE_ROLLOUT_ERROR_CODE = 'product_restore_rollout_forbidden';
export const PRODUCT_RESTORE_ROLLOUT_ERROR_MESSAGE = '产品还原当前未对该账号开放，历史项目仍可查看。';

const PRODUCT_RESTORE_TASK_PURPOSES = new Set([
  'product_restore_analysis',
  'product_restore_generation',
]);

export const VIDEO_JOB_TASK_TYPES = new Set([
  'dreamina_video',
  'kie_seedance_video',
  'kie_veo',
  'kie_video',
  'maxforai_video',
  'subtitle_remove_video',
]);

export const RECOVERABLE_PROVIDER_TASK_TYPES = new Set([
  'dreamina_video',
  'kie_image',
  'kie_seedance_video',
  'kie_veo',
  'kie_video',
  'maxforai_video',
  'subtitle_remove_video',
]);

export const KIE_RECOVERY_SOURCE_TASK_TYPES = new Set(
  Array.from(RECOVERABLE_PROVIDER_TASK_TYPES).filter((taskType) => taskType.startsWith('kie_')),
);

export const canRecoverProviderTaskById = ({
  taskType = '',
  provider = '',
  providerTaskId = '',
  payload = {},
} = {}) => {
  const normalizedTaskType = String(taskType || '').trim();
  const normalizedProvider = String(provider || '').trim();
  if (!String(providerTaskId || '').trim() || !RECOVERABLE_PROVIDER_TASK_TYPES.has(normalizedTaskType)) {
    return false;
  }
  if (normalizedTaskType === 'kie_image') {
    return normalizedProvider === 'kie' && !isMaxForAiImageModel(payload?.model);
  }
  if (normalizedTaskType.startsWith('kie_')) return normalizedProvider === 'kie';
  if (normalizedTaskType === 'dreamina_video') return normalizedProvider === 'dreamina';
  if (normalizedTaskType === 'maxforai_video') return normalizedProvider === 'maxforai';
  if (normalizedTaskType === 'subtitle_remove_video') return normalizedProvider === 'golden_subtitle';
  return false;
};

export const isAuthorizedProviderTaskRecoverySource = (sourceJob, request = {}) => {
  if (!sourceJob) return false;
  const sourceTaskType = String(sourceJob.taskType || '').trim();
  const requestIsVideo = request?.payload?.isVideo === true;
  return String(sourceJob.userId || '') === String(request.userId || '')
    && String(sourceJob.providerTaskId || '').trim() === String(request.providerTaskId || '').trim()
    && String(request.taskType || '').trim() === 'kie_recover'
    && String(request.provider || '').trim() === 'kie'
    && String(sourceJob.provider || '').trim() === 'kie'
    && KIE_RECOVERY_SOURCE_TASK_TYPES.has(sourceTaskType)
    && canRecoverProviderTaskById(sourceJob)
    && VIDEO_JOB_TASK_TYPES.has(sourceTaskType) === requestIsVideo;
};

const TASK_PROVIDER_POLICIES = new Map([
  ['dreamina_video', new Set(['dreamina'])],
  ['maxforai_video', new Set(['maxforai'])],
  ['subtitle_remove_video', new Set(['golden_subtitle'])],
  ['openai_responses', new Set(['openai_compatible'])],
  ['openai_tool_calling', new Set(['openai_compatible'])],
  ['upload_asset', new Set(['kie'])],
]);

const createPolicyError = (code, message, statusCode) => {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
};

const getAllowedProviders = (taskType) => {
  if (taskType === 'kie_image') return new Set(['kie', 'maxforai']);
  if (taskType.startsWith('kie_')) return new Set(['kie']);
  return TASK_PROVIDER_POLICIES.get(taskType) || null;
};

const normalizePolicyMarker = (value) => String(value || '').trim().toLowerCase();

export const isProductRestoreJobSubmission = ({
  module = '',
  payload = {},
  subFeature = '',
  taskPurpose = '',
} = {}) => {
  if (normalizePolicyMarker(module) !== 'retouch') return false;
  const subFeatureMarkers = [subFeature, payload?.subFeature].map(normalizePolicyMarker);
  const taskPurposeMarkers = [taskPurpose, payload?.taskPurpose].map(normalizePolicyMarker);
  return subFeatureMarkers.some((marker) => marker === 'product_restore')
    || taskPurposeMarkers.some((marker) => PRODUCT_RESTORE_TASK_PURPOSES.has(marker));
};

export const getJobSubmissionLockTimeoutSeconds = (env = process.env) => {
  const parsed = Number.parseInt(String(env?.MEIAO_JOB_SUBMISSION_LOCK_TIMEOUT_SECONDS || ''), 10);
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_SUBMISSION_LOCK_TIMEOUT_SECONDS;
};

export const resolveJobSubmissionPolicy = ({
  module = '',
  taskType = '',
  provider = '',
  payload = {},
  subFeature = '',
  taskPurpose = '',
  hasVideoPermission = false,
  userRole = '',
  productRestoreRollout,
  submissionOperation = 'create',
  subtitleRemovalEnabled = false,
  subtitleRemovalConfigured = false,
  subtitleRemovalBatchMaxItems = 10,
} = {}) => {
  const normalizedModule = normalizePolicyMarker(module);
  const normalizedTaskType = String(taskType || '').trim();
  const normalizedProvider = String(provider || '').trim();
  const normalizedSubFeature = String(subFeature || payload?.subFeature || '').trim();
  const allowedProviders = getAllowedProviders(normalizedTaskType);
  const isProductRestore = isProductRestoreJobSubmission({
    module: normalizedModule,
    payload,
    subFeature,
    taskPurpose,
  });
  const isHistoricalProviderRecovery = submissionOperation === 'recover'
    && normalizedTaskType === 'kie_recover';

  if (
    !isHistoricalProviderRecovery
    && isProductRestore
    && !canCreateProductRestore(normalizeProductRestoreRollout(productRestoreRollout), userRole)
  ) {
    throw createPolicyError(
      PRODUCT_RESTORE_ROLLOUT_ERROR_CODE,
      PRODUCT_RESTORE_ROLLOUT_ERROR_MESSAGE,
      403,
    );
  }

  if (allowedProviders && !allowedProviders.has(normalizedProvider)) {
    throw createPolicyError(
      'job_provider_not_allowed',
      `任务类型 ${normalizedTaskType} 不允许使用 provider=${normalizedProvider || 'empty'}。`,
      400
    );
  }
  if (!allowedProviders && normalizedProvider !== 'internal') {
    throw createPolicyError(
      'job_provider_not_allowed',
      `未知任务类型 ${normalizedTaskType || 'empty'} 只允许使用 internal provider。`,
      400
    );
  }

  if (
    normalizedTaskType === 'subtitle_remove_video'
    && submissionOperation === 'create'
    && (!subtitleRemovalEnabled || !subtitleRemovalConfigured)
  ) {
    throw createPolicyError(
      'subtitle_removal_unavailable',
      '去字幕功能暂未开放，请联系管理员。',
      503,
    );
  }

  if (normalizedTaskType === 'subtitle_remove_video' && submissionOperation === 'create') {
    const batchCount = Number(payload?.batchCount);
    const batchIndex = Number(payload?.batchIndex);
    const configuredMax = Number.parseInt(String(subtitleRemovalBatchMaxItems || ''), 10);
    const batchMaxItems = Number.isFinite(configuredMax) && configuredMax > 0 ? configuredMax : 10;
    if (
      !Number.isInteger(batchCount)
      || batchCount < 1
      || batchCount > batchMaxItems
      || !Number.isInteger(batchIndex)
      || batchIndex < 0
      || batchIndex >= batchCount
    ) {
      throw createPolicyError(
        'subtitle_batch_invalid',
        `去字幕批次参数无效，单批最多支持 ${batchMaxItems} 个视频。`,
        400,
      );
    }
  }

  const isVideoStoryboard = normalizedModule === 'video'
    && (normalizedTaskType === 'kie_chat' || normalizedTaskType === 'kie_image')
    && normalizedSubFeature === 'storyboard';
  const requiresVideoPermission = VIDEO_JOB_TASK_TYPES.has(normalizedTaskType) || isVideoStoryboard;
  const isMaxForAiPaidImage = normalizedTaskType === 'kie_image' && normalizedProvider === 'maxforai';
  if (requiresVideoPermission && !hasVideoPermission) {
    throw createPolicyError(
      'video_feature_forbidden',
      '短视频生成暂未对当前账号开放，请联系管理员开通。',
      403
    );
  }

  return {
    taskType: normalizedTaskType,
    provider: normalizedProvider,
    isVideoStoryboard,
    requiresVideoPermission,
    maxCreateRetries: requiresVideoPermission || isMaxForAiPaidImage ? 0 : undefined,
    dedupeWindowMs: requiresVideoPermission
      ? VIDEO_DEDUPE_WINDOW_MS
      : normalizedTaskType === 'kie_chat'
        ? CHAT_DEDUPE_WINDOW_MS
        : DEFAULT_DEDUPE_WINDOW_MS,
  };
};
