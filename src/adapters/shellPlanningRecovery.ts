import type { AppModule } from '../types.ts';

type PlanningRecoveryResultLike = {
  status?: unknown;
  imageUrl?: unknown;
  videoUrl?: unknown;
  backendJobId?: unknown;
  taskId?: unknown;
  error?: unknown;
  prompt?: unknown;
};

type FailedPlanningResultOptions = {
  jobId: unknown;
  projectId: unknown;
  payloadPlanId?: unknown;
  failedPlanId?: unknown;
  selectedPlanId?: unknown;
  errorMessage?: unknown;
  fallbackPrompt?: unknown;
  model?: string;
  aspectRatio?: string;
  createdAt: number;
  module: AppModule;
  subFeature?: string;
  providerTaskId?: unknown;
  creditsConsumed?: number;
};

const text = (value: unknown) => String(value || '').trim();

const hasMedia = (result: PlanningRecoveryResultLike = {}) => Boolean(
  text(result.imageUrl) || text(result.videoUrl),
);

const hasProviderTaskIdentity = (result: PlanningRecoveryResultLike = {}) => Boolean(text(result.taskId));

export const isStalePlanningFailureResult = (result: PlanningRecoveryResultLike = {}) => {
  if (result.status !== 'error') return false;
  if (hasMedia(result) || text(result.backendJobId) || text(result.taskId)) return false;
  const message = text(result.error || result.prompt);
  return /策划失败|未返回可用方案|任务已提交云端|结果待同步/.test(message);
};

export const hasConcretePlanningRecoveryResult = (result: PlanningRecoveryResultLike = {}) => (
  (result.status === 'completed' && hasMedia(result))
  || (result.status === 'generating' && hasProviderTaskIdentity(result))
  || (result.status === 'error' && !isStalePlanningFailureResult(result))
);

export const buildFailedPlanningResult = ({
  jobId,
  projectId,
  payloadPlanId = '',
  failedPlanId = '',
  selectedPlanId = '',
  errorMessage = '',
  fallbackPrompt = '',
  model,
  aspectRatio = 'auto',
  createdAt,
  module,
  subFeature,
  providerTaskId = '',
  creditsConsumed,
}: FailedPlanningResultOptions) => {
  const normalizedJobId = text(jobId);
  const normalizedErrorMessage = text(errorMessage || fallbackPrompt);
  const normalizedProviderTaskId = text(providerTaskId);
  return {
    id: `${normalizedJobId}-error`,
    planId: text(payloadPlanId || failedPlanId || selectedPlanId) || undefined,
    projectId: text(projectId),
    imageUrl: '',
    prompt: normalizedErrorMessage,
    model: text(model) || undefined,
    aspectRatio: text(aspectRatio) || 'auto',
    status: 'error' as const,
    createdAt,
    module,
    subFeature: text(subFeature) || undefined,
    taskId: normalizedProviderTaskId || undefined,
    backendJobId: normalizedJobId,
    creditsConsumed,
    error: normalizedErrorMessage,
  };
};
