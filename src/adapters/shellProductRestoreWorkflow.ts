import { AspectRatio, type GlobalApiConfig, type ModuleConfig, type ProductRestoreFocusId, type ProductRestoreProjectContext } from '../types';
import { analyzeProductRestoreBatch } from '../services/arkService';
import { processWithKieAi } from '../services/kieAiService';
import { safeCreateInternalLog } from '../services/internalApi';
import { persistGeneratedAsset } from '../services/persistedAssetClient';
import { normalizeFetchedImageBlob } from '../utils/imageBlobUtils.mjs';
import {
  normalizeProductRestoreFocusIds,
  normalizeProductRestoreResolution,
  validateProductRestoreInput,
} from '../modules/Retouch/productRestoreContract.mjs';
import { resolvePublicAssetUrl } from '../utils/modelAssetUrl.mjs';
import type { ShellGenerateInput, ShellMaterialInput, ShellWorkflowImageResult } from './shellWorkflow';

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
};

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
  identity: { jobId?: string; providerTaskId?: string } = {},
): WorkflowError => Object.assign(new Error(message), {
  code,
  ...(identity.jobId ? { jobId: identity.jobId } : {}),
  ...(identity.providerTaskId ? { providerTaskId: identity.providerTaskId } : {}),
});

const boundedIdentity = (value: unknown, maxLength = 160) => String(value || '').trim().slice(0, maxLength);

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

const normalizeGenerationConfig = (
  config: ModuleConfig,
  context?: ProductRestoreProjectContext,
): ModuleConfig => {
  const model = (context?.selectedImageModel || config.model) as ModuleConfig['model'];
  const requestedResolution = context?.resolution || config.quality;
  const resolution = normalizeProductRestoreResolution(model, requestedResolution);
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
}: ShellProductRestoreItemInput & { clientSubmissionKey: string }): Pick<
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
    prompt: context.sharedRestorationPrompt,
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
  const context = validateExistingContext(itemInput.context);
  const projectId = requireProjectId(input);
  if (!target?.id) {
    throw toWorkflowError('产品还原目标缺少稳定素材身份。', 'product_restore_target_id_missing');
  }
  if (!Array.isArray(productReferences) || productReferences.length === 0) {
    throw toWorkflowError('产品还原缺少产品参考图，未创建图片任务。', 'product_restore_reference_required');
  }

  const generationConfig = normalizeGenerationConfig(itemInput.config, context);
  const referenceUrls = productReferences.map((reference) => (
    materialUrl(reference, input.publicBaseUrl || '', '产品参考图')
  ));
  const targetUrl = materialUrl(target, input.publicBaseUrl || '', '待还原套图');
  const clientSubmissionKey = [
    projectId,
    'product_restore',
    context.analysisJobId,
    target.id,
    'v1',
  ].join(':');
  const base = resultBase({ ...itemInput, context, clientSubmissionKey });
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
      context.sharedRestorationPrompt,
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

  const normalizedConfig = normalizeGenerationConfig(config, input.productRestoreContext);
  const focusIds = normalizeProductRestoreFocusIds(input.params.restoreFocusIds) as ProductRestoreFocusId[];
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
  };
  logProductRestore(
    'product_restore_batch_started',
    'started',
    '产品还原批次已开始',
    sharedLogMeta,
  );

  let context: ProductRestoreProjectContext;
  if (input.productRestoreContext) {
    context = validateExistingContext(input.productRestoreContext);
  } else {
    const analysisStartedAt = Date.now();
    logProductRestore(
      'product_restore_analysis_started',
      'started',
      '产品还原整批分析已开始',
      sharedLogMeta,
    );
    const analysis = await deps.analyzeBatch({
      targetUrls,
      productReferenceUrls,
      focusIds,
      userRequirement: input.prompt.trim(),
      apiConfig: apiConfigForInput(input),
      signal: input.signal,
      jobMetadata: {
        ...(input.taskMetadata || {}),
        subFeature: 'product_restore',
        taskPurpose: 'product_restore_analysis',
        batchCount: targets.length,
        clientSubmissionKey: [projectId, 'product_restore', 'analysis', 'v1'].join(':'),
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
      });
    }

    context = {
      version: 1,
      analysisJobId: analysis.jobId,
      analysisProviderTaskId: analysis.providerTaskId,
      analysisModel: analysis.modelUsed,
      analysisCreditsConsumed: Number(analysis.creditsConsumed || 0),
      normalizedAnalysis: analysis.normalizedAnalysis,
      sharedRestorationPrompt: analysis.sharedRestorationPrompt,
      focusIds,
      targetMaterialIds: targets.map((target) => target.id),
      productReferenceMaterialIds: productReferences.map((reference) => reference.id),
      selectedImageModel: normalizedConfig.model,
      resolution: normalizedConfig.quality.toUpperCase() as ProductRestoreProjectContext['resolution'],
      userRequirement: input.prompt.trim(),
      createdAt: Date.now(),
    };
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

  const results = await Promise.all(targets.map((target, index) => (
    runShellProductRestoreItem({
      input,
      config: normalizedConfig,
      context,
      target,
      productReferences,
      batchIndex: index + 1,
      batchCount: targets.length,
    }, callbacks, deps)
  )));
  const creditsConsumed = context.analysisCreditsConsumed
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
    ...(creditsConsumed > 0 ? { creditsConsumed } : {}),
    analysisStatus: 'completed',
    productRestoreContext: context,
    analysisJobId: context.analysisJobId,
  };
}
