import { AspectRatio, type GlobalApiConfig, type ModuleConfig, type ProductRestoreAnalysisAttempt, type ProductRestoreFocusId, type ProductRestoreProjectContext } from '../types';
import { analyzeProductRestoreBatch } from '../services/arkService';
import { processWithKieAi } from '../services/kieAiService';
import { safeCreateInternalLog } from '../services/internalApi';
import { persistGeneratedAsset } from '../services/persistedAssetClient';
import { normalizeFetchedImageBlob } from '../utils/imageBlobUtils.mjs';
import {
  normalizeProductRestoreFocusIds,
  normalizeProductRestoreResolution,
  buildProductRestoreGenerationPrompt,
  parseLegacyProductRestoreAnalysis,
  validateProductRestoreInput,
} from '../modules/Retouch/productRestoreContract.mjs';
import { resolvePublicAssetUrl } from '../utils/modelAssetUrl.mjs';
import type { ShellGenerateInput, ShellMaterialInput, ShellWorkflowImageResult } from './shellWorkflow';
import { runProductRestoreFanout } from './shellProductRestoreCancellation.mjs';
import {
  createProductRestoreAnalysisAttempt,
  getProductRestoreAnalysisCreditSummary,
} from '../utils/productRestoreAnalysisCredits';

export interface ProductRestoreWorkflowCallbacks {
  onAnalysisCompleted?: (
    context: ProductRestoreProjectContext,
  ) => void | Promise<void>;
  onItemChanged?: (
    result: ShellWorkflowImageResult,
    index: number,
  ) => void | Promise<void>;
}

export interface ProductRestoreWorkflowDeps {
  analyzeBatch: typeof analyzeProductRestoreBatch;
  generateImage: typeof processWithKieAi;
  persistImage: (
    url: string,
    fileName: string,
    signal?: AbortSignal,
  ) => Promise<string>;
}

export interface ShellProductRestoreWorkflowResult {
  results: ShellWorkflowImageResult[];
  creditsConsumed?: number;
  analysisStatus: 'completed' | 'generating';
  productRestoreContext?: ProductRestoreProjectContext;
  analysisJobId?: string;
  message?: string;
}

export interface ShellProductRestoreItemInput {
  input: ShellGenerateInput;
  config: ModuleConfig;
  context: ProductRestoreProjectContext;
  target: ShellMaterialInput;
  productReferences: ShellMaterialInput[];
  batchIndex: number;
  batchCount: number;
}

type WorkflowError = Error & {
  code?: string;
  jobId?: string;
  providerTaskId?: string;
  analysisAttempt?: ProductRestoreAnalysisAttempt;
};

export const PRODUCT_RESTORE_RETRY_CONTEXT_ERROR_MESSAGE = '该历史任务缺少完整的产品还原分析或参考素材，无法安全单张重试，请重新创建产品还原任务。';
export const PRODUCT_RESTORE_MANUAL_REANALYSIS_RESULT_ID = '__product_restore_manual_reanalysis__';
const PRODUCT_RESTORE_INVALID_ANALYSIS_ERROR_CODES = new Set([
  'product_restore_analysis_invalid',
  'product_restore_analysis_target_prompts_invalid',
]);

export interface ProductRestoreRetryResultIdentity {
  id: string;
  targetMaterialId?: string;
  sourceUrl?: string;
}

const defaultPersistImage = async (
  url: string,
  fileName: string,
  signal?: AbortSignal,
) => {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw Object.assign(new Error(`生成结果持久化下载失败 (${response.status})`), {
      code: 'product_restore_asset_download_failed',
    });
  }
  const blob = await normalizeFetchedImageBlob(await response.blob(), url);
  return persistGeneratedAsset(blob, 'retouch', fileName, 'product-restore');
};

export const DEFAULT_PRODUCT_RESTORE_DEPS: ProductRestoreWorkflowDeps = {
  analyzeBatch: analyzeProductRestoreBatch,
  generateImage: processWithKieAi,
  persistImage: defaultPersistImage,
};

const toWorkflowError = (
  message: string,
  code: string,
  identity: {
    jobId?: string;
    providerTaskId?: string;
    analysisAttempt?: ProductRestoreAnalysisAttempt;
  } = {},
): WorkflowError => Object.assign(new Error(message), {
  code,
  ...(identity.jobId ? { jobId: identity.jobId } : {}),
  ...(identity.providerTaskId ? { providerTaskId: identity.providerTaskId } : {}),
  ...(identity.analysisAttempt ? { analysisAttempt: identity.analysisAttempt } : {}),
});

const boundedIdentity = (value: unknown, maxLength = 160) => String(value || '').trim().slice(0, maxLength);

const hasExactProductRestoreV2PromptCoverage = (
  context: Extract<ProductRestoreProjectContext, { version: 2 }>,
) => (
  Array.isArray(context.targetMaterialIds)
  && context.targetMaterialIds.length > 0
  && Array.isArray(context.targetPrompts)
  && context.targetPrompts.length === context.targetMaterialIds.length
  && context.targetPrompts.every((item, index) => (
    item?.targetIndex === index + 1
    && typeof item.targetMaterialId === 'string'
    && boundedIdentity(item.targetMaterialId) === item.targetMaterialId
    && item.targetMaterialId === context.targetMaterialIds[index]
    && Array.isArray(item.targetIssueSummary)
    && item.targetIssueSummary.every((issue) => (
      typeof issue === 'string' && Boolean(issue.trim())
    ))
    && typeof item.restorationPrompt === 'string'
    && Boolean(item.restorationPrompt.trim())
  ))
);

const logProductRestore = (
  action: string,
  status: 'started' | 'success' | 'failed' | 'interrupted',
  message: string,
  meta: Record<string, unknown>,
) => {
  void safeCreateInternalLog({
    level: status === 'failed' ? 'error' : 'info',
    module: 'retouch',
    action,
    message,
    status,
    meta,
  });
};

const materialUrl = (material: ShellMaterialInput, publicBaseUrl = '', label = '素材') => {
  const raw = String(material?.remoteUrl || material?.url || '').trim();
  const resolved = resolvePublicAssetUrl(raw, publicBaseUrl);
  if (!raw || !resolved) {
    throw toWorkflowError(
      `${label}没有可用于模型读取的稳定地址，请重新上传后重试。`,
      'product_restore_asset_url_missing',
    );
  }
  return resolved;
};

const requireProjectId = (input: ShellGenerateInput) => {
  const projectId = boundedIdentity(input.taskMetadata?.shellProjectId);
  if (!projectId) {
    throw toWorkflowError(
      '产品还原任务缺少稳定项目身份，未创建任何分析或图片任务。',
      'product_restore_project_id_missing',
    );
  }
  return projectId;
};

const validateExistingContext = (context: ProductRestoreProjectContext) => {
  if (context?.version === 2) {
    if (
      !boundedIdentity(context.analysisJobId)
      || !boundedIdentity(context.productIdentitySummary)
      || !Array.isArray(context.invariantFeatures)
      || !hasExactProductRestoreV2PromptCoverage(context)
    ) {
      throw toWorkflowError(
        '该历史任务缺少完整的产品还原分析，无法安全继续生成。',
        'product_restore_context_invalid',
      );
    }
    return context;
  }
  if (
    context?.version !== 1
    || !boundedIdentity(context.analysisJobId)
    || !context.normalizedAnalysis
    || !boundedIdentity(context.sharedRestorationPrompt)
  ) {
    throw toWorkflowError(
      '该历史任务缺少完整的产品还原分析，无法安全继续生成。',
      'product_restore_context_invalid',
    );
  }
  return context;
};

const validateRetryContext = (context?: ProductRestoreProjectContext) => {
  const parsedLegacyAnalysis = context?.version === 1 && context.normalizedAnalysis
    ? parseLegacyProductRestoreAnalysis(JSON.stringify(context.normalizedAnalysis))
    : { ok: false };
  const focusIds = Array.isArray(context?.focusIds)
    ? context.focusIds.map((focusId) => boundedIdentity(focusId))
    : [];
  const normalizedFocusIds = normalizeProductRestoreFocusIds(focusIds);
  const hasUniqueIdentities = (values: unknown): values is string[] => (
    Array.isArray(values)
    && values.length > 0
    && values.every((value) => (
      typeof value === 'string'
      && value === value.trim()
      && boundedIdentity(value) === value
      && Boolean(value)
    ))
    && new Set(values).size === values.length
  );
  if (
    (context?.version !== 1 && context?.version !== 2)
    || !boundedIdentity(context.analysisJobId)
    || (context.version === 1 && (
      !boundedIdentity(context.sharedRestorationPrompt)
      || !parsedLegacyAnalysis.ok
    ))
    || (context.version === 2 && (
      !boundedIdentity(context.productIdentitySummary)
      || !Array.isArray(context.invariantFeatures)
      || !Array.isArray(context.targetPrompts)
      || context.targetPrompts.some((item) => (
        !boundedIdentity(item?.targetMaterialId)
        || !Number.isInteger(item?.targetIndex)
        || item.targetIndex <= 0
        || !Array.isArray(item?.targetIssueSummary)
        || !boundedIdentity(item?.restorationPrompt, 10_000)
      ))
      || new Set(context.targetPrompts.map((item) => item.targetMaterialId)).size !== context.targetPrompts.length
    ))
    || !Array.isArray(context.focusIds)
    || focusIds.length === 0
    || normalizedFocusIds.length !== focusIds.length
    || normalizedFocusIds.some((focusId, index) => focusId !== focusIds[index])
    || !hasUniqueIdentities(context.targetMaterialIds)
    || !hasUniqueIdentities(context.productReferenceMaterialIds)
    || !boundedIdentity(context.selectedImageModel)
    || (context.resolution !== '2K' && context.resolution !== '4K')
  ) {
    throw toWorkflowError(
      PRODUCT_RESTORE_RETRY_CONTEXT_ERROR_MESSAGE,
      'product_restore_retry_context_invalid',
    );
  }
  return context;
};

const materialIdentities = (materials: ShellMaterialInput[]) => (
  materials.map((material) => boundedIdentity(material?.id))
);

const sameOrderedValues = (left: readonly string[] = [], right: readonly string[] = []) => (
  left.length === right.length && left.every((value, index) => value === right[index])
);

const validateFreshProductRestoreContext = (
  context: Extract<ProductRestoreProjectContext, { version: 2 }>,
) => {
  if (!hasExactProductRestoreV2PromptCoverage(context)) {
    throw toWorkflowError(
      '分析结果未完整覆盖每张待还原图，请重试分析。',
      'product_restore_analysis_target_prompts_invalid',
    );
  }
  return context;
};

const validateTargetIdentities = (targets: ShellMaterialInput[]) => {
  const seen = new Set<string>();
  for (const target of targets) {
    const targetId = boundedIdentity(target?.id);
    if (!targetId) {
      throw toWorkflowError(
        '产品还原目标缺少稳定素材身份，未创建任何分析或图片任务。',
        'product_restore_target_id_missing',
      );
    }
    if (seen.has(targetId)) {
      throw toWorkflowError(
        '产品还原目标素材身份重复，未创建任何分析或图片任务。',
        'product_restore_target_id_duplicate',
      );
    }
    seen.add(targetId);
  }
};

const contextMatchesBatch = (
  context: ProductRestoreProjectContext,
  targets: ShellMaterialInput[],
  productReferences: ShellMaterialInput[],
  focusIds: ProductRestoreFocusId[],
  userRequirement: string,
  config: ModuleConfig,
) => (
  sameOrderedValues(context.targetMaterialIds, materialIdentities(targets))
  && sameOrderedValues(context.productReferenceMaterialIds, materialIdentities(productReferences))
  && sameOrderedValues(context.focusIds, focusIds)
  && String(context.userRequirement || '').trim() === userRequirement
  && String(context.selectedImageModel || '').trim() === String(config.model || '').trim()
  && String(context.resolution || '').trim().toUpperCase() === String(config.quality || '').trim().toUpperCase()
);

const validateItemContext = (
  context: ProductRestoreProjectContext,
  target: ShellMaterialInput,
  productReferences: ShellMaterialInput[],
  batchIndex: number,
) => {
  const targetId = boundedIdentity(target?.id);
  const expectedTargetId = boundedIdentity(context.targetMaterialIds?.[batchIndex - 1]);
  const referencesMatch = sameOrderedValues(
    context.productReferenceMaterialIds,
    materialIdentities(productReferences),
  );
  if (!targetId || targetId !== expectedTargetId || !referencesMatch) {
    throw toWorkflowError(
      '该图片与已持久化的产品还原分析不属于同一批次，请重新分析后再生成。',
      'product_restore_context_mismatch',
    );
  }
};

const normalizeGenerationConfig = (
  config: ModuleConfig,
  context?: ProductRestoreProjectContext,
): ModuleConfig => {
  const model = (context ? context.selectedImageModel : config.model) as ModuleConfig['model'];
  const resolution = context
    ? context.resolution
    : normalizeProductRestoreResolution(model, config.quality);
  return {
    ...config,
    model,
    quality: resolution.toLowerCase() as ModuleConfig['quality'],
    aspectRatio: AspectRatio.AUTO,
    resolutionMode: 'original',
    targetWidth: 0,
    targetHeight: 0,
  };
};

const greatestCommonDivisor = (left: number, right: number) => {
  let a = Math.abs(Math.round(left));
  let b = Math.abs(Math.round(right));
  while (b > 0) [a, b] = [b, a % b];
  return a || 1;
};

const sourceImageContext = (target: ShellMaterialInput) => {
  const width = Number(target.originalWidth || 0);
  const height = Number(target.originalHeight || 0);
  if (width <= 0 || height <= 0) return undefined;
  const divisor = greatestCommonDivisor(width, height);
  return {
    width,
    height,
    ratioLabel: `${Math.round(width / divisor)}:${Math.round(height / divisor)}`,
  };
};

const apiConfigForInput = (input: ShellGenerateInput): GlobalApiConfig => ({
  kieApiKey: input.apiConfig?.kieApiKey || '',
  concurrency: input.apiConfig?.concurrency || 1,
  cosSecretId: input.apiConfig?.cosSecretId,
  cosSecretKey: input.apiConfig?.cosSecretKey,
  workspacePreferences: input.apiConfig?.workspacePreferences,
});

const resultBase = ({
  input,
  config,
  context,
  target,
  batchIndex,
  batchCount,
  clientSubmissionKey,
  prompt,
}: ShellProductRestoreItemInput & { clientSubmissionKey: string; prompt: string }): Pick<
  ShellWorkflowImageResult,
  | 'prompt'
  | 'projectId'
  | 'projectName'
  | 'projectTaskCount'
  | 'model'
  | 'aspectRatio'
  | 'fileName'
  | 'sourceUrl'
  | 'batchIndex'
  | 'targetMaterialId'
  | 'analysisJobId'
  | 'clientSubmissionKey'
> => {
  const ratio = sourceImageContext(target)?.ratioLabel || AspectRatio.AUTO;
  return {
    prompt,
    projectId: boundedIdentity(input.taskMetadata?.shellProjectId),
    projectName: boundedIdentity(input.taskMetadata?.shellProjectName),
    projectTaskCount: batchCount,
    model: context.selectedImageModel || config.model,
    aspectRatio: ratio,
    fileName: target.fileName || `产品还原 ${batchIndex}`,
    sourceUrl: materialUrl(target, input.publicBaseUrl || '', '待还原套图'),
    batchIndex,
    targetMaterialId: target.id,
    analysisJobId: context.analysisJobId,
    clientSubmissionKey,
  };
};

const resolveProductRestoreEffectivePrompt = (
  context: ProductRestoreProjectContext,
  targetMaterialId: string,
) => {
  if (context.version === 1) return context.sharedRestorationPrompt;
  const matches = context.targetPrompts.filter((item) => (
    boundedIdentity(item.targetMaterialId) === boundedIdentity(targetMaterialId)
  ));
  if (matches.length !== 1) {
    throw toWorkflowError(
      '当前待还原图缺少唯一的逐图修改提示词，未创建图片任务。',
      'product_restore_target_prompt_missing',
    );
  }
  return buildProductRestoreGenerationPrompt({
    productIdentitySummary: context.productIdentitySummary,
    invariantFeatures: context.invariantFeatures,
    targetPrompt: matches[0].restorationPrompt,
    focusIds: context.focusIds,
    userRequirement: context.userRequirement,
  });
};

const notifyItem = async (
  callbacks: ProductRestoreWorkflowCallbacks,
  result: ShellWorkflowImageResult,
  index: number,
) => {
  try {
    await callbacks.onItemChanged?.(result, index);
  } catch {
    logProductRestore(
      'product_restore_item_callback_failed',
      'failed',
      '产品还原结果状态回调失败',
      {
        backendJobId: boundedIdentity(result.backendJobId),
        targetMaterialId: boundedIdentity(result.targetMaterialId),
        batchIndex: index,
        errorCode: 'product_restore_item_callback_failed',
      },
    );
  }
};

export async function runShellProductRestoreItem(
  itemInput: ShellProductRestoreItemInput,
  callbacks: ProductRestoreWorkflowCallbacks = {},
  deps: ProductRestoreWorkflowDeps = DEFAULT_PRODUCT_RESTORE_DEPS,
): Promise<ShellWorkflowImageResult> {
  const { input, target, productReferences, batchIndex, batchCount } = itemInput;
  const context = validateRetryContext(itemInput.context);
  const projectId = requireProjectId(input);
  if (!target?.id) {
    throw toWorkflowError('产品还原目标缺少稳定素材身份。', 'product_restore_target_id_missing');
  }
  if (!Array.isArray(productReferences) || productReferences.length === 0) {
    throw toWorkflowError('产品还原缺少产品参考图，未创建图片任务。', 'product_restore_reference_required');
  }
  validateItemContext(context, target, productReferences, batchIndex);

  const generationConfig = normalizeGenerationConfig(itemInput.config, context);
  const referenceUrls = productReferences.map((reference) => (
    materialUrl(reference, input.publicBaseUrl || '', '产品参考图')
  ));
  const targetUrl = materialUrl(target, input.publicBaseUrl || '', '待还原套图');
  const effectivePrompt = resolveProductRestoreEffectivePrompt(context, target.id);
  const clientSubmissionKey = [
    projectId,
    'product_restore',
    context.analysisJobId,
    target.id,
    context.version === 2 ? 'v2' : 'v1',
  ].join(':');
  const base = resultBase({ ...itemInput, context, clientSubmissionKey, prompt: effectivePrompt });
  const generationStartedAt = Date.now();
  let backendJobId = '';
  let providerTaskId = '';
  let creditsConsumed: number | undefined;
  let creationLogged = false;
  const pendingNotifications: Promise<void>[] = [];

  const onJobCreated = (jobId: string, nextProviderTaskId?: string) => {
    backendJobId = boundedIdentity(jobId) || backendJobId;
    providerTaskId = boundedIdentity(nextProviderTaskId) || providerTaskId;
    input.onJobCreated?.(jobId, nextProviderTaskId);
    const pending: ShellWorkflowImageResult = {
      ...base,
      imageUrl: '',
      taskId: providerTaskId || undefined,
      backendJobId: backendJobId || undefined,
      status: 'generating',
      message: '产品还原任务已提交云端，正在生成。',
    };
    pendingNotifications.push(notifyItem(callbacks, pending, batchIndex));
    if (!creationLogged) {
      creationLogged = true;
      logProductRestore(
        'product_restore_generation_created',
        'started',
        '产品还原图片任务已创建',
        {
          userId: boundedIdentity(input.taskMetadata?.userId),
          shellProjectId: projectId,
          analysisJobId: boundedIdentity(context.analysisJobId),
          backendJobId,
          providerTaskId,
          targetMaterialId: boundedIdentity(target.id),
          batchIndex,
          batchCount,
          model: generationConfig.model,
          resolution: generationConfig.quality.toUpperCase(),
        },
      );
    }
  };

  const taskMetadata = {
    ...(input.taskMetadata || {}),
    subFeature: 'product_restore',
    taskPurpose: 'product_restore_generation',
    analysisJobId: context.analysisJobId,
    targetMaterialId: target.id,
    batchIndex,
    batchCount,
    clientSubmissionKey,
    skipPromptCleanupSuffix: true,
  };

  try {
    const generation = await deps.generateImage(
      [targetUrl, ...referenceUrls],
      apiConfigForInput(input),
      generationConfig,
      true,
      input.signal,
      effectivePrompt,
      false,
      sourceImageContext(target),
      'main',
      taskMetadata,
      onJobCreated,
    );
    await Promise.all(pendingNotifications);
    backendJobId = boundedIdentity(generation.backendJobId) || backendJobId;
    providerTaskId = boundedIdentity(generation.taskId) || providerTaskId;
    creditsConsumed = generation.creditsConsumed;

    if (generation.status === 'success' && generation.imageUrl) {
      const finalUrl = await deps.persistImage(
        generation.imageUrl,
        `product-restore-${target.id}.png`,
        input.signal,
      );
      const completed: ShellWorkflowImageResult = {
        ...base,
        imageUrl: finalUrl,
        taskId: providerTaskId || undefined,
        backendJobId: backendJobId || undefined,
        creditsConsumed: generation.creditsConsumed,
        status: 'completed',
      };
      logProductRestore(
        'product_restore_generation_succeeded',
        'success',
        '产品还原图片生成成功',
        {
          userId: boundedIdentity(input.taskMetadata?.userId),
          shellProjectId: projectId,
          analysisJobId: boundedIdentity(context.analysisJobId),
          backendJobId,
          providerTaskId,
          targetMaterialId: boundedIdentity(target.id),
          batchIndex,
          batchCount,
          model: generationConfig.model,
          resolution: generationConfig.quality.toUpperCase(),
          durationMs: Date.now() - generationStartedAt,
          creditsConsumed: Number(generation.creditsConsumed || 0),
        },
      );
      await notifyItem(callbacks, completed, batchIndex);
      return completed;
    }

    const isPending = generation.status === 'generating';
    const unsettled: ShellWorkflowImageResult = {
      ...base,
      imageUrl: '',
      taskId: providerTaskId || undefined,
      backendJobId: backendJobId || undefined,
      creditsConsumed: generation.creditsConsumed,
      status: isPending ? 'generating' : 'error',
      error: generation.message || (isPending ? '产品还原任务仍在生成中。' : '产品还原图片生成失败。'),
      message: generation.message,
      errorCode: generation.errorCode,
    };
    if (!isPending) {
      logProductRestore(
        'product_restore_generation_failed',
        'failed',
        '产品还原图片生成失败',
        {
          userId: boundedIdentity(input.taskMetadata?.userId),
          shellProjectId: projectId,
          analysisJobId: boundedIdentity(context.analysisJobId),
          backendJobId,
          providerTaskId,
          targetMaterialId: boundedIdentity(target.id),
          batchIndex,
          batchCount,
          model: generationConfig.model,
          resolution: generationConfig.quality.toUpperCase(),
          durationMs: Date.now() - generationStartedAt,
          creditsConsumed: Number(generation.creditsConsumed || 0),
          errorCode: boundedIdentity(generation.errorCode) || 'product_restore_generation_failed',
        },
      );
    }
    await notifyItem(callbacks, unsettled, batchIndex);
    return unsettled;
  } catch (error: unknown) {
    await Promise.all(pendingNotifications);
    const workflowError = error as WorkflowError;
    const interrupted = input.signal.aborted || workflowError?.message === 'INTERRUPTED';
    const failed: ShellWorkflowImageResult = {
      ...base,
      imageUrl: '',
      taskId: providerTaskId || undefined,
      backendJobId: backendJobId || undefined,
      creditsConsumed,
      status: 'error',
      error: interrupted ? '产品还原任务已中断。' : String(workflowError?.message || '产品还原图片生成失败。'),
      message: interrupted ? '产品还原任务已中断。' : String(workflowError?.message || '产品还原图片生成失败。'),
      errorCode: interrupted ? 'interrupted' : boundedIdentity(workflowError?.code) || 'product_restore_generation_failed',
    };
    logProductRestore(
      'product_restore_generation_failed',
      interrupted ? 'interrupted' : 'failed',
      interrupted ? '产品还原图片任务已中断' : '产品还原图片生成失败',
      {
        userId: boundedIdentity(input.taskMetadata?.userId),
        shellProjectId: projectId,
        analysisJobId: boundedIdentity(context.analysisJobId),
        backendJobId,
        providerTaskId,
        targetMaterialId: boundedIdentity(target.id),
        batchIndex,
        batchCount,
        model: generationConfig.model,
        resolution: generationConfig.quality.toUpperCase(),
        durationMs: Date.now() - generationStartedAt,
        creditsConsumed: Number(creditsConsumed || 0),
        errorCode: failed.errorCode,
      },
    );
    await notifyItem(callbacks, failed, batchIndex);
    return failed;
  }
}

export async function runShellProductRestoreSingleRetry(
  retryInput: {
    input: ShellGenerateInput;
    config: ModuleConfig;
    result: ProductRestoreRetryResultIdentity;
  },
  callbacks: ProductRestoreWorkflowCallbacks = {},
  deps: ProductRestoreWorkflowDeps = DEFAULT_PRODUCT_RESTORE_DEPS,
): Promise<ShellWorkflowImageResult> {
  const { input, config, result } = retryInput;
  const context = validateRetryContext(input.productRestoreContext);
  const targets = input.materials.restoreTarget || [];
  const references = input.materials.productReference || [];
  const targetById = new Map(targets.map((target) => [boundedIdentity(target.id), target]));
  const referenceById = new Map(references.map((reference) => [boundedIdentity(reference.id), reference]));
  const explicitTargetId = boundedIdentity(result.targetMaterialId);
  const fallbackSourceUrl = boundedIdentity(
    resolvePublicAssetUrl(String(result.sourceUrl || ''), input.publicBaseUrl || ''),
    2048,
  );
  const target = explicitTargetId
    ? targetById.get(explicitTargetId)
    : targets.find((candidate) => (
      boundedIdentity(
        resolvePublicAssetUrl(
          String(candidate.remoteUrl || candidate.url || ''),
          input.publicBaseUrl || '',
        ),
        2048,
      ) === fallbackSourceUrl
    ));
  const targetId = boundedIdentity(target?.id);
  const targetIndex = context.targetMaterialIds.findIndex((candidate) => boundedIdentity(candidate) === targetId);
  const orderedReferences = context.productReferenceMaterialIds.map((referenceId) => (
    referenceById.get(boundedIdentity(referenceId))
  ));
  if (
    !target
    || targetIndex < 0
    || orderedReferences.some((reference) => !reference)
  ) {
    throw toWorkflowError(
      PRODUCT_RESTORE_RETRY_CONTEXT_ERROR_MESSAGE,
      'product_restore_retry_context_invalid',
    );
  }

  const retried = await runShellProductRestoreItem({
    input,
    config,
    context,
    target,
    productReferences: orderedReferences as ShellMaterialInput[],
    batchIndex: targetIndex + 1,
    batchCount: context.targetMaterialIds.length,
  }, callbacks, deps);
  logProductRestore(
    'product_restore_single_retry',
    retried.status === 'error' ? 'failed' : retried.status === 'generating' ? 'started' : 'success',
    retried.status === 'error' ? '产品还原单张重试失败' : retried.status === 'generating' ? '产品还原单张重试仍在生成' : '产品还原单张重试成功',
    {
      shellProjectId: boundedIdentity(input.taskMetadata?.shellProjectId),
      analysisJobId: boundedIdentity(context.analysisJobId),
      backendJobId: boundedIdentity(retried.backendJobId),
      providerTaskId: boundedIdentity(retried.taskId),
      targetMaterialId: targetId,
      errorCode: boundedIdentity(retried.errorCode),
    },
  );
  return retried;
}

export function mergeProductRestoreSingleRetryProject<T extends {
  id: string;
  status?: string;
  creditsConsumed?: number;
}, P extends {
  status: string;
  taskCount: number;
  completedCount: number;
  creditsConsumed?: number;
  generationContext?: {
    productRestore?: ProductRestoreProjectContext;
    productRestoreAnalysisAttempts?: ProductRestoreAnalysisAttempt[];
  };
  results: T[];
}>(
  project: P,
  resultId: string,
  retryResult: Omit<Partial<T>, 'id'> & { creditsConsumed?: number },
): P {
  const results = project.results.map((result) => result.id === resultId
    ? {
      ...result,
      ...retryResult,
      id: result.id,
      creditsConsumed: Number(result.creditsConsumed || 0) + Number(retryResult.creditsConsumed || 0),
    } as T
    : result);
  const completedCount = results.filter((result) => result.status === 'completed').length;
  const generatingCount = results.filter((result) => result.status === 'generating').length;
  const analysisCredits = getProductRestoreAnalysisCreditSummary(project.generationContext);
  const imageCredits = results.reduce((sum, result) => sum + Number(result.creditsConsumed || 0), 0);
  const hasImageCredits = results.some((result) => result.creditsConsumed !== undefined);
  return {
    ...project,
    results,
    taskCount: project.taskCount,
    completedCount,
    status: generatingCount > 0 ? 'generating' : completedCount === project.taskCount ? 'completed' : 'error',
    ...(analysisCredits.present || hasImageCredits
      ? { creditsConsumed: analysisCredits.value + imageCredits }
      : {}),
  } as P;
}

export async function persistProductRestoreProjectOrDefer<P extends {
  status: string;
  completedAt?: number;
  error?: string;
  generationContext?: {
    params: Record<string, unknown>;
    productRestore?: ProductRestoreProjectContext;
  };
}>(input: {
  project: P;
  phase: 'analysis' | 'result';
  persist: (project: P) => Promise<boolean>;
}): Promise<{
  persisted: boolean;
  shouldReleaseTask: boolean;
  project: P;
}> {
  const persisted = await input.persist(input.project);
  if (persisted) {
    return {
      persisted: true,
      shouldReleaseTask: true,
      project: input.project,
    };
  }

  const isAnalysis = input.phase === 'analysis';
  const generationContext = isAnalysis && input.project.generationContext
    ? {
      ...input.project.generationContext,
      params: {
        ...input.project.generationContext.params,
        productRestoreAnalysisJobStatus: 'succeeded',
        productRestoreAnalysisErrorCode: 'product_restore_context_persistence_failed',
      },
    }
    : input.project.generationContext;
  const deferredProject = {
    ...input.project,
    status: isAnalysis ? 'planning' : 'generating',
    completedAt: undefined,
    error: isAnalysis
      ? '产品还原分析已完成，但进度同步失败；已保留付费分析身份，稍后将继续同步。'
      : '产品还原结果已生成，但进度同步失败；已保留任务身份，稍后将继续同步。',
    ...(generationContext ? { generationContext } : {}),
  } as unknown as P;
  return {
    persisted: false,
    shouldReleaseTask: false,
    project: deferredProject,
  };
}

export async function retryPersistedProductRestoreAnalysis<P extends {
  status: string;
  completedAt?: number;
  error?: string;
  backendJobId?: string;
  planningTaskId?: string;
  generationContext?: {
    params: Record<string, unknown>;
    productRestore?: ProductRestoreProjectContext;
  };
}>(input: {
  project: P;
  persist: (project: P) => Promise<boolean>;
  onTaskRecovered?: (project: P) => void | Promise<void>;
}) {
  const context = validateRetryContext(input.project.generationContext?.productRestore);
  const recoveryProject = {
    ...input.project,
    status: 'generating',
    completedAt: undefined,
    error: undefined,
    backendJobId: context.analysisJobId,
    planningTaskId: context.analysisProviderTaskId || input.project.planningTaskId,
    generationContext: {
      ...input.project.generationContext,
      params: {
        ...input.project.generationContext?.params,
        productRestoreAnalysisJobStatus: 'succeeded',
        productRestoreAnalysisErrorCode: '',
      },
      productRestore: context,
    },
  } as P;
  const persistence = await persistProductRestoreProjectOrDefer({
    project: recoveryProject,
    phase: 'analysis',
    persist: input.persist,
  });
  if (persistence.persisted) {
    await input.onTaskRecovered?.(persistence.project);
  }
  return persistence;
}

export function createSerializedProductRestoreItemPersistence<I, P extends {
  status: string;
  completedAt?: number;
  error?: string;
  generationContext?: {
    params: Record<string, unknown>;
    productRestore?: ProductRestoreProjectContext;
  };
}>(input: {
  getInitialProject: () => P;
  mergeProject: (project: P, item: I) => P;
  persist: (project: P) => Promise<boolean>;
  onProjectChanged?: (project: P) => void;
}) {
  let desiredProject: P | undefined;
  let persistenceQueue: Promise<void> = Promise.resolve();

  const sync = (item: I) => {
    desiredProject = input.mergeProject(
      desiredProject || input.getInitialProject(),
      item,
    );
    input.onProjectChanged?.(desiredProject);

    const operation = persistenceQueue.then(async () => {
      const snapshot = desiredProject as P;
      const persistence = await persistProductRestoreProjectOrDefer({
        project: snapshot,
        phase: 'result',
        persist: input.persist,
      });
      const currentDesiredProject = desiredProject as P;
      const visibleProject = persistence.persisted
        ? currentDesiredProject
        : {
          ...currentDesiredProject,
          status: persistence.project.status,
          completedAt: undefined,
          error: persistence.project.error,
        } as P;
      input.onProjectChanged?.(visibleProject);
      return {
        ...persistence,
        project: visibleProject,
      };
    });
    persistenceQueue = operation.then(() => undefined, () => undefined);
    return operation;
  };

  return {
    sync,
    getDesiredProject: () => desiredProject || input.getInitialProject(),
  };
}

export function canManuallyReanalyzeProductRestore(input: {
  module?: string;
  subFeature?: string;
  projectStatus?: string;
  resultCount?: number;
  analysisJobId?: string;
  analysisJobStatus?: string;
  analysisErrorCode?: string;
}) {
  if (
    input.module !== 'retouch'
    || input.subFeature !== 'product_restore'
    || input.projectStatus !== 'error'
    || Number(input.resultCount || 0) !== 0
    || !boundedIdentity(input.analysisJobId)
  ) return false;
  const status = boundedIdentity(input.analysisJobStatus);
  const errorCode = boundedIdentity(input.analysisErrorCode);
  if (status === 'succeeded') return PRODUCT_RESTORE_INVALID_ANALYSIS_ERROR_CODES.has(errorCode);
  if (status !== 'failed') return false;
  return !new Set(['provider_submission_unknown', 'interrupted', 'analysis_result_pending']).has(errorCode);
}

export async function runShellProductRestoreWorkflow(
  input: ShellGenerateInput,
  config: ModuleConfig,
  callbacks: ProductRestoreWorkflowCallbacks = {},
  deps: ProductRestoreWorkflowDeps = DEFAULT_PRODUCT_RESTORE_DEPS,
): Promise<ShellProductRestoreWorkflowResult> {
  const projectId = requireProjectId(input);
  const targets = input.materials.restoreTarget || [];
  const productReferences = input.materials.productReference || [];
  const inputValidation = validateProductRestoreInput({
    restoreTargets: targets,
    productReferences,
  });
  if (!inputValidation.ok) {
    throw toWorkflowError(inputValidation.message, inputValidation.errorCode);
  }

  validateTargetIdentities(targets);
  const normalizedConfig = normalizeGenerationConfig(config);
  const focusIds = normalizeProductRestoreFocusIds(input.params.restoreFocusIds) as ProductRestoreFocusId[];
  const userRequirement = input.prompt.trim();
  const existingContext = input.productRestoreContext
    ? validateExistingContext(input.productRestoreContext)
    : undefined;
  const reusableContext = existingContext && contextMatchesBatch(
    existingContext,
    targets,
    productReferences,
    focusIds,
    userRequirement,
    normalizedConfig,
  )
    ? existingContext
    : undefined;
  if (!reusableContext && typeof callbacks.onAnalysisCompleted !== 'function') {
    throw toWorkflowError(
      '产品还原分析缺少持久化回调，未创建任何分析或图片任务。',
      'product_restore_analysis_persistence_required',
    );
  }
  const targetUrls = targets.map((target) => materialUrl(target, input.publicBaseUrl || '', '待还原套图'));
  const productReferenceUrls = productReferences.map((reference) => (
    materialUrl(reference, input.publicBaseUrl || '', '产品参考图')
  ));
  const batchStartedAt = Date.now();
  const sharedLogMeta = {
    userId: boundedIdentity(input.taskMetadata?.userId),
    shellProjectId: projectId,
    targetCount: targets.length,
    referenceCount: productReferences.length,
    focusIds,
    model: normalizedConfig.model,
    resolution: normalizedConfig.quality.toUpperCase(),
    ...(input.taskMetadata?.productRestoreManualRetry === true ? { manualRetry: true } : {}),
  };
  logProductRestore(
    'product_restore_batch_started',
    'started',
    '产品还原批次已开始',
    sharedLogMeta,
  );

  let context: ProductRestoreProjectContext;
  if (reusableContext) {
    context = reusableContext;
  } else {
    const analysisStartedAt = Date.now();
    logProductRestore(
      'product_restore_analysis_started',
      'started',
      '产品还原整批分析已开始',
      sharedLogMeta,
    );
    const isManualRetry = input.taskMetadata?.productRestoreManualRetry === true;
    const manualSubmissionKey = boundedIdentity(
      input.taskMetadata?.productRestoreAnalysisSubmissionKey,
      240,
    );
    const analysisSubmissionKey = isManualRetry && manualSubmissionKey
      ? manualSubmissionKey
      : [projectId, 'product_restore', 'analysis', 'v2'].join(':');
    const analysis = await deps.analyzeBatch({
      targetUrls,
      productReferenceUrls,
      focusIds,
      userRequirement,
      apiConfig: apiConfigForInput(input),
      signal: input.signal,
      jobMetadata: {
        ...(input.taskMetadata || {}),
        subFeature: 'product_restore',
        taskPurpose: 'product_restore_analysis',
        batchCount: targets.length,
        clientSubmissionKey: analysisSubmissionKey,
        ...(isManualRetry ? { productRestoreManualRetry: true } : {}),
      },
      onJobCreated: input.onJobCreated,
    });

    if (analysis.status === 'generating') {
      return {
        results: [],
        analysisStatus: 'generating',
        analysisJobId: analysis.jobId,
        message: analysis.message,
      };
    }
    if (analysis.status === 'error') {
      const analysisAttempt = createProductRestoreAnalysisAttempt({
        jobId: analysis.jobId,
        providerTaskId: analysis.providerTaskId,
        model: analysis.modelUsed,
        status: analysis.errorCode === 'interrupted'
          ? 'cancelled'
          : PRODUCT_RESTORE_INVALID_ANALYSIS_ERROR_CODES.has(analysis.errorCode)
            ? 'invalid'
            : 'failed',
        errorCode: analysis.errorCode,
        timestamp: Date.now(),
        creditsConsumed: analysis.creditsConsumed,
      });
      logProductRestore(
        'product_restore_analysis_failed',
        analysis.errorCode === 'interrupted' ? 'interrupted' : 'failed',
        analysis.errorCode === 'interrupted' ? '产品还原整批分析已中断' : '产品还原整批分析失败',
        {
          ...sharedLogMeta,
          analysisJobId: boundedIdentity(analysis.jobId),
          providerTaskId: boundedIdentity(analysis.providerTaskId),
          durationMs: Date.now() - analysisStartedAt,
          errorCode: boundedIdentity(analysis.errorCode),
        },
      );
      throw toWorkflowError(analysis.message, analysis.errorCode, {
        jobId: analysis.jobId,
        providerTaskId: analysis.providerTaskId,
        analysisAttempt,
      });
    }

    context = validateFreshProductRestoreContext({
      version: 2,
      analysisJobId: analysis.jobId,
      analysisProviderTaskId: analysis.providerTaskId,
      analysisModel: analysis.modelUsed,
      ...(analysis.creditsConsumed !== undefined
        ? { analysisCreditsConsumed: analysis.creditsConsumed }
        : {}),
      productIdentitySummary: analysis.normalizedAnalysis.productIdentitySummary,
      invariantFeatures: [...analysis.normalizedAnalysis.invariantFeatures],
      targetPrompts: analysis.normalizedAnalysis.targetPrompts.map((item) => ({
        targetMaterialId: targets[item.targetIndex - 1]?.id || '',
        targetIndex: item.targetIndex,
        targetIssueSummary: [...item.targetIssueSummary],
        restorationPrompt: item.restorationPrompt,
      })),
      focusIds,
      targetMaterialIds: targets.map((target) => target.id),
      productReferenceMaterialIds: productReferences.map((reference) => reference.id),
      selectedImageModel: normalizedConfig.model,
      resolution: normalizedConfig.quality.toUpperCase() as ProductRestoreProjectContext['resolution'],
      userRequirement,
      createdAt: Date.now(),
    });
    logProductRestore(
      'product_restore_analysis_succeeded',
      'success',
      '产品还原整批分析成功',
      {
        ...sharedLogMeta,
        analysisJobId: boundedIdentity(context.analysisJobId),
        providerTaskId: boundedIdentity(context.analysisProviderTaskId),
        analysisModel: boundedIdentity(context.analysisModel),
        durationMs: Date.now() - analysisStartedAt,
        creditsConsumed: context.analysisCreditsConsumed,
      },
    );
  }

  await callbacks.onAnalysisCompleted?.(context);

  const results = await runProductRestoreFanout({
    items: targets,
    concurrency: input.apiConfig?.concurrency || 1,
    shouldStop: () => input.signal.aborted,
    runItem: (target, index) => runShellProductRestoreItem({
      input,
      config: normalizedConfig,
      context,
      target,
      productReferences,
      batchIndex: index + 1,
      batchCount: targets.length,
    }, callbacks, deps),
  });
  const hasAnalysisCredits = context.analysisCreditsConsumed !== undefined;
  const hasImageCredits = results.some((result) => result.creditsConsumed !== undefined);
  const creditsConsumed = Number(context.analysisCreditsConsumed || 0)
    + results.reduce((sum, result) => sum + Number(result.creditsConsumed || 0), 0);
  const completedCount = results.filter((result) => result.status === 'completed').length;
  const pendingCount = results.filter((result) => result.status === 'generating').length;
  const failedCount = results.filter((result) => result.status === 'error').length;
  logProductRestore(
    'product_restore_partial_completed',
    failedCount > 0 && pendingCount === 0 ? 'failed' : pendingCount > 0 ? 'started' : 'success',
    failedCount > 0 ? '产品还原批次部分完成' : pendingCount > 0 ? '产品还原批次仍在生成' : '产品还原批次已完成',
    {
      ...sharedLogMeta,
      analysisJobId: boundedIdentity(context.analysisJobId),
      completedCount,
      failedCount,
      pendingCount,
      durationMs: Date.now() - batchStartedAt,
      creditsConsumed,
    },
  );

  return {
    results,
    ...(hasAnalysisCredits || hasImageCredits ? { creditsConsumed } : {}),
    analysisStatus: 'completed',
    productRestoreContext: context,
    analysisJobId: context.analysisJobId,
  };
}
