const DEFAULT_DEDUPE_WINDOW_MS = 8000;
const CHAT_DEDUPE_WINDOW_MS = 3 * 60 * 1000;
const VIDEO_DEDUPE_WINDOW_MS = 60 * 60 * 1000;
const DEFAULT_SUBMISSION_LOCK_TIMEOUT_SECONDS = 10;

export const VIDEO_JOB_TASK_TYPES = new Set([
  'dreamina_video',
  'kie_seedance_video',
  'kie_veo',
  'kie_video',
]);

export const RECOVERABLE_PROVIDER_TASK_TYPES = new Set([
  'dreamina_video',
  'kie_image',
  'kie_seedance_video',
  'kie_veo',
  'kie_video',
]);

export const KIE_RECOVERY_SOURCE_TASK_TYPES = new Set(
  Array.from(RECOVERABLE_PROVIDER_TASK_TYPES).filter((taskType) => taskType.startsWith('kie_')),
);

export const canRecoverProviderTaskById = ({ taskType = '', providerTaskId = '' } = {}) => (
  Boolean(String(providerTaskId || '').trim())
  && RECOVERABLE_PROVIDER_TASK_TYPES.has(String(taskType || '').trim())
);

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
  if (taskType.startsWith('kie_')) return new Set(['kie']);
  return TASK_PROVIDER_POLICIES.get(taskType) || null;
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
  hasVideoPermission = false,
} = {}) => {
  const normalizedModule = String(module || '').trim();
  const normalizedTaskType = String(taskType || '').trim();
  const normalizedProvider = String(provider || '').trim();
  const normalizedSubFeature = String(subFeature || payload?.subFeature || '').trim();
  const allowedProviders = getAllowedProviders(normalizedTaskType);

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

  const isVideoStoryboard = normalizedModule === 'video'
    && (normalizedTaskType === 'kie_chat' || normalizedTaskType === 'kie_image')
    && normalizedSubFeature === 'storyboard';
  const requiresVideoPermission = VIDEO_JOB_TASK_TYPES.has(normalizedTaskType) || isVideoStoryboard;
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
    maxCreateRetries: requiresVideoPermission ? 0 : undefined,
    dedupeWindowMs: requiresVideoPermission
      ? VIDEO_DEDUPE_WINDOW_MS
      : normalizedTaskType === 'kie_chat'
        ? CHAT_DEDUPE_WINDOW_MS
        : DEFAULT_DEDUPE_WINDOW_MS,
  };
};
