// @ts-nocheck
import { GlobalApiConfig, ModuleConfig, KieAiResult, AspectRatio, VideoConfig, SourceImageContext } from '../types.ts';
import { cancelInternalJob, createInternalJob, fetchInternalJob, fetchSystemConfig, getActiveModuleContext, retryInternalJob, safeCreateInternalLog, waitForInternalJob } from './internalApi';
import { getUserVisibleTaskId } from './kieTaskUtils.mjs';
import { normalizeGptImage2Resolution } from '../utils/gptImage2.mjs';
import { getImageModelCapabilities } from '../utils/modelCapabilities.mjs';
import { resolvePublicAssetUrl } from '../utils/modelAssetUrl.mjs';

const logKieEvent = (action: string, message: string, status: 'started' | 'success' | 'failed' | 'interrupted', detail = '', meta: Record<string, unknown> | null = null) => {
  const module = getActiveModuleContext() || 'unknown';
  void safeCreateInternalLog({
    level: status === 'failed' ? 'error' : 'info',
    module,
    action,
    message,
    detail,
    status,
    meta: meta || undefined,
  });
};

const KIE_IMAGE_TIMEOUT: Record<string, number> = {
  'nano-banana-2': 6 * 60_000,
  'gpt-image-2': 10 * 60_000,
};
const KIE_IMAGE_DEFAULT_TIMEOUT = 10 * 60_000;
const KIE_VIDEO_TIMEOUT = 5 * 60_000;
const KIE_RECOVER_TIMEOUT = 4 * 60_000;
const KIE_AUTO_RECOVER_ERROR_CODES = new Set([
  'provider_internal_error',
  'provider_network_error',
  'provider_timeout',
  'service_restarted',
  'job_timeout',
]);
const KIE_NON_RECOVERABLE_ERROR_CODES = new Set([
  'provider_credit_insufficient',
  'provider_request_limit',
  'provider_auth_invalid',
  'provider_bad_request',
  'task_not_found',
]);
const KIE_RECOVERABLE_MESSAGE_PATTERN = /fetch failed|network|timeout|超时|服务异常|网络异常/i;
const PUBLIC_BASE_URL_CACHE_TTL_MS = 30_000;
let cachedPublicBaseUrl = '';
let cachedPublicBaseUrlAt = 0;
const GPT_IMAGE_2_CLEANUP_SUFFIX = '要求：画面干净通透，材质完整自然，纹理平滑统一。禁止高频纹理，颜色过渡要平滑柔和，禁止过度锐化、色斑、噪点、破碎图案、伪影和畸变。';

export const isRecoverableKieTaskResult = (taskId?: string, errorMessage?: string, errorCode?: string) => {
  if (!String(taskId || '').trim()) return false;
  if (errorCode && KIE_NON_RECOVERABLE_ERROR_CODES.has(String(errorCode))) return false;
  if (errorCode && KIE_AUTO_RECOVER_ERROR_CODES.has(String(errorCode))) return true;
  return KIE_RECOVERABLE_MESSAGE_PATTERN.test(String(errorMessage || ''));
};

export const getUserFacingKieErrorMessage = (result: Partial<KieAiResult>) => {
  const errorCode = String(result.errorCode || '').trim();

  if (errorCode === 'provider_credit_insufficient') {
    return '当前 KIE 账户余额不足，相关生图功能暂不可用，请充值后重试。';
  }
  if (errorCode === 'provider_request_limit') {
    return '当前 KIE 子额度或请求额度已达上限，请稍后重试或检查账号配置。';
  }
  if (isRecoverableKieTaskResult(result.taskId, result.message, errorCode)) {
    return '任务可能仍在云端继续处理，可稍后点击同步或找回结果。';
  }
  return String(result.message || '任务执行失败').trim() || '任务执行失败';
};

const shouldAutoRecoverKieJob = (job: any) => {
  if (!job || job.taskType === 'kie_recover') return false;
  if (!['kie_image', 'kie_video'].includes(String(job.taskType || ''))) return false;
  return isRecoverableKieTaskResult(job.providerTaskId, job.errorMessage, job.errorCode);
};

const resolveRuntimePublicBaseUrl = async () => {
  if (cachedPublicBaseUrl && Date.now() - cachedPublicBaseUrlAt < PUBLIC_BASE_URL_CACHE_TTL_MS) {
    return cachedPublicBaseUrl;
  }
  const result = await fetchSystemConfig();
  const nextBaseUrl = String(result.config.publicBaseUrl || '').trim();
  cachedPublicBaseUrl = nextBaseUrl;
  cachedPublicBaseUrlAt = Date.now();
  return nextBaseUrl;
};

const requireModelAssetUrl = (value: string, publicBaseUrl: string, label: string) => {
  const raw = String(value || '').trim();
  if (!raw) {
    throw new Error(`${label} 没有可用于模型读取的公网地址，请重新上传后重试。`);
  }
  const safeUrl = resolvePublicAssetUrl(raw, publicBaseUrl);
  if (!safeUrl) {
    throw new Error(`${label} 没有可用于模型读取的公网地址，请重新上传后重试。`);
  }
  return safeUrl;
};

const normalizeModelAssetUrls = async (imageUrls: string | string[], label = '素材') => {
  const publicBaseUrl = await resolveRuntimePublicBaseUrl();
  const seen = new Set<string>();
  return (Array.isArray(imageUrls) ? imageUrls : [imageUrls])
    .map((url, index) => requireModelAssetUrl(url, publicBaseUrl, `${label}${index + 1}`))
    .filter((url) => {
      if (seen.has(url)) return false;
      seen.add(url);
      return true;
    })
    .filter(Boolean);
};

const recoverKieProviderTask = async (
  taskId: string,
  signal?: AbortSignal,
  isVideo: boolean = false,
  kieClientConfigPresent: boolean = false
): Promise<KieAiResult> => {
  const module = getActiveModuleContext() || 'unknown';
  const { job } = await createInternalJob({
    module,
    taskType: 'kie_recover',
    provider: 'kie',
    payload: {
      taskId,
      providerTaskId: taskId,
      isVideo,
      kieClientConfigPresent,
    },
    maxRetries: 1,
  });

  return await waitForJobResult(job.id, signal, KIE_RECOVER_TIMEOUT, false, kieClientConfigPresent);
};

const waitForJobResult = async (
  jobId: string,
  signal?: AbortSignal,
  maxWaitMs = 0,
  allowAutoRecover = true,
  kieClientConfigPresent = false,
  onProviderTaskId?: (providerTaskId: string) => void
): Promise<KieAiResult> => {
  let notifiedProviderTaskId = '';
  const notifyProviderTaskId = (providerTaskId: unknown) => {
    const value = String(providerTaskId || '').trim();
    if (!value || value === notifiedProviderTaskId) return;
    notifiedProviderTaskId = value;
    onProviderTaskId?.(value);
  };
  try {
    const finalJob = await waitForInternalJob(jobId, signal, 2500, maxWaitMs, (currentJob) => {
      notifyProviderTaskId(currentJob.providerTaskId);
    });
    notifyProviderTaskId(finalJob.providerTaskId || finalJob.result?.providerTaskId);
    if (finalJob.status === 'succeeded') {
      return {
        imageUrl: String(finalJob.result?.imageUrl || ''),
        videoUrl: finalJob.result?.videoUrl ? String(finalJob.result.videoUrl) : undefined,
        taskId: getUserVisibleTaskId(finalJob),
        status: 'success',
        message: '',
        creditsConsumed: Number.isFinite(Number(finalJob.result?.creditsConsumed)) ? Number(finalJob.result?.creditsConsumed) : undefined,
      };
    }

    if (finalJob.status === 'cancelled') {
      return {
        imageUrl: '',
        taskId: getUserVisibleTaskId(finalJob),
        status: 'interrupted',
        message: finalJob.errorMessage || '任务已取消',
        errorCode: String(finalJob.errorCode || '').trim(),
      };
    }

    if (finalJob.errorCode === 'task_not_found') {
      return {
        imageUrl: '',
        taskId: getUserVisibleTaskId(finalJob),
        status: 'task_not_found',
        message: finalJob.errorMessage || '任务不存在或已过期',
        errorCode: String(finalJob.errorCode || '').trim(),
      };
    }

    if (allowAutoRecover && shouldAutoRecoverKieJob(finalJob)) {
      return recoverKieProviderTask(finalJob.providerTaskId, signal, finalJob.taskType === 'kie_video', kieClientConfigPresent);
    }

    const errorCode = String(finalJob.errorCode || '').trim();
    return {
      imageUrl: '',
      taskId: getUserVisibleTaskId(finalJob),
      status: 'error',
      message: getUserFacingKieErrorMessage({
        status: 'error',
        taskId: getUserVisibleTaskId(finalJob),
        message: finalJob.errorMessage || '任务执行失败',
        errorCode,
      }),
      errorCode,
    };
  } catch (error: any) {
    if (error.message === 'INTERRUPTED') {
      void cancelInternalJob(jobId).catch(() => null);
      return { imageUrl: '', status: 'interrupted', message: '任务已取消' };
    }
    if (error.code === 'job_timeout') {
      const timeoutJob = await fetchInternalJob(jobId).catch(() => null);
      if (allowAutoRecover && shouldAutoRecoverKieJob(timeoutJob?.job)) {
        return recoverKieProviderTask(timeoutJob.job.providerTaskId, signal, timeoutJob.job.taskType === 'kie_video', kieClientConfigPresent);
      }
      const fallbackTaskId = notifiedProviderTaskId || getUserVisibleTaskId(timeoutJob?.job);
      if (fallbackTaskId) {
        return {
          imageUrl: '',
          taskId: fallbackTaskId,
          status: 'generating',
          message: '任务已提交云端，结果待同步',
          errorCode: String(timeoutJob?.job?.errorCode || error?.code || '').trim(),
        };
      }
      return {
        imageUrl: '',
        taskId: fallbackTaskId,
        status: 'error',
        message: getUserFacingKieErrorMessage({
          status: 'error',
          taskId: fallbackTaskId,
          message: error.message || '任务执行超时',
          errorCode: String(timeoutJob?.job?.errorCode || error?.code || '').trim(),
        }),
        errorCode: String(timeoutJob?.job?.errorCode || error?.code || '').trim(),
      };
    }
    if (notifiedProviderTaskId) {
      return {
        imageUrl: '',
        taskId: notifiedProviderTaskId,
        status: 'generating',
        message: '任务已提交云端，结果待同步',
        errorCode: String(error?.code || '').trim(),
      };
    }
    return {
      imageUrl: '',
      taskId: notifiedProviderTaskId,
      status: 'error',
      message: getUserFacingKieErrorMessage({
        status: 'error',
        taskId: notifiedProviderTaskId,
        message: error.message || '任务执行失败',
        errorCode: String(error?.code || '').trim(),
      }),
      errorCode: String(error?.code || '').trim(),
    };
  }
};

const buildKieAiPrompt = (
  config: ModuleConfig,
  isRatioMatch: boolean,
  isRemoveText: boolean = false,
  sourceImageContext?: SourceImageContext,
  subMode: 'main' | 'detail' | 'remove_text' = 'main'
): string => {
  const targetLang = config.targetLanguage === 'CUSTOM' ? config.customLanguage : config.targetLanguage;
  const skipTranslation = config.targetLanguage === 'KEEP_ORIGINAL';

  if (isRemoveText) {
    let prompt = `R Role 角色
You are a clean-image production specialist.

T Task 任务
Remove all non-packaging text from the image and rebuild a clean commercial image.

C Constraint 约束
1. Eradicate all text, characters, and numbers from the entire image.
2. Only preserve text physically printed on the product packaging surface.
3. Fill removed areas with a seamless, clean background.
4. No text allowed anywhere else.

F Format 格式
Return the edited image only.

E Example 示例
Packaging text stays; floating marketing text disappears.
`;
    prompt += `STRICTLY output high-definition commercial studio quality. `;
    return prompt;
  }

  let prompt = `R Role 角色
你是商业图像文案翻译与修复助手。

T Task 任务
专业级处理图像中的文案翻译，同时保持产品主体或包装和画面主题不变。

C Constraint 约束
1. 仅保留产品/包装表面的字符不变（存在产品情况下，禁止翻译原产品以及包装上的内容）。
2. 请勿更改图像主体内容以及主题。
3. 优化画面中的半透明污点瑕疵，保持画面整洁。

F Format 格式
返回处理后的图片。

E Example 示例
保留包装字样，替换画面悬浮文案。
`;

  if (skipTranslation) {
    prompt += `严格保留图像内所有原始文本文案不变。`;
  } else {
    prompt += `严格将图像内所有文本文案文字翻译成${targetLang}，保持文案翻译对应以及准确。`;
  }

  if (isRatioMatch && sourceImageContext && subMode === 'main') {
    prompt += `输出画布需自然保持与原图一致的纵横比例，比例约为${sourceImageContext.ratioLabel}。`;
    const originalRatio = sourceImageContext.height === 0 ? 1 : sourceImageContext.width / sourceImageContext.height;
    if (Math.abs(originalRatio - 1) > 0.08) {
      prompt += `原图非1:1方图时严禁生成1:1方图。`;
    }
  }

  prompt += `严格输出高清商业工作室品质。制作要求完全以该次任务需求为准。`;
  return prompt;
};

export const recoverKieAiTask = async (
  taskId: string,
  apiConfig: GlobalApiConfig,
  signal: AbortSignal,
  isVideo: boolean = false
): Promise<KieAiResult> => {
  logKieEvent('recover_task', '开始找回任务结果', 'started', '', { taskId, isVideo });
  const existingJob = await fetchInternalJob(taskId).catch(() => null);
  let result: KieAiResult;
  if (existingJob?.job) {
    result = await waitForJobResult(existingJob.job.id, signal, KIE_RECOVER_TIMEOUT, false, Boolean(apiConfig.kieApiKey));
  } else {
    result = await recoverKieProviderTask(taskId, signal, isVideo, Boolean(apiConfig.kieApiKey));
  }
  logKieEvent(
    'recover_task',
    result.status === 'success' ? '任务结果找回成功' : result.status === 'interrupted' ? '任务结果找回已中断' : '任务结果找回失败',
    result.status === 'success' ? 'success' : result.status === 'interrupted' ? 'interrupted' : 'failed',
    result.message || '',
    { taskId, isVideo }
  );
  return result;
};

export const createSoraVideoTask = async (
  imageUrls: string[],
  videoConfig: VideoConfig,
  apiConfig: GlobalApiConfig,
  signal: AbortSignal,
  onJobCreated?: (jobId: string, providerTaskId?: string) => void
): Promise<KieAiResult> => {
  logKieEvent('create_video_task', '开始创建视频任务', 'started', '', {
    imageCount: imageUrls.length,
    duration: videoConfig.duration,
  });
  const safeImageUrls = await normalizeModelAssetUrls(imageUrls, '视频素材');
  const module = getActiveModuleContext() || 'unknown';
  const { job } = await createInternalJob({
    module,
    taskType: 'kie_video',
    provider: 'kie',
    payload: {
      imageUrls: safeImageUrls,
      videoConfig,
      kieClientConfigPresent: Boolean(apiConfig.kieApiKey),
      requestId: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    },
    maxRetries: 2,
  });
  onJobCreated?.(job.id);
  const notifyProviderTaskId = (providerTaskId: string) => onJobCreated?.(job.id, providerTaskId);

  const result = await waitForJobResult(job.id, signal, KIE_VIDEO_TIMEOUT, true, Boolean(apiConfig.kieApiKey), notifyProviderTaskId);
  logKieEvent(
    'create_video_task',
    result.status === 'success' ? '视频任务完成' : result.status === 'interrupted' ? '视频任务已中断' : '视频任务失败',
    result.status === 'success' ? 'success' : result.status === 'interrupted' ? 'interrupted' : 'failed',
    result.message || '',
    { taskId: result.taskId }
  );
  return result;
};

export const submitVeoVideoTask = async (
  script: { description: string; spokenContent: string; bgm: string },
  aspectRatio: string,
  imageUrls: string[],
  previousTaskId: string | undefined,
  apiConfig: GlobalApiConfig,
  signal: AbortSignal
): Promise<string> => {
  const safeImageUrls = await normalizeModelAssetUrls(imageUrls, '视频参考图');
  const module = getActiveModuleContext() || 'unknown';
  const { job } = await createInternalJob({
    module,
    taskType: 'kie_veo',
    provider: 'kie',
    payload: {
      script,
      aspectRatio,
      imageUrls: safeImageUrls,
      previousTaskId,
      kieClientConfigPresent: Boolean(apiConfig.kieApiKey),
      requestId: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    },
    maxRetries: 2,
  });

  if (signal.aborted) {
    void cancelInternalJob(job.id).catch(() => null);
    throw new Error('INTERRUPTED');
  }

  return job.id;
};

export const pollVeoTaskStatus = async (taskId: string, apiConfig: GlobalApiConfig, signal: AbortSignal): Promise<string> => {
  const finalJob = await waitForInternalJob(taskId, signal).catch(async (error: any) => {
    if (error.message === 'INTERRUPTED') {
      await cancelInternalJob(taskId).catch(() => null);
    }
    throw error;
  });

  if (finalJob.status === 'succeeded' && finalJob.result?.videoUrl) {
    return String(finalJob.result.videoUrl);
  }

  if (finalJob.status === 'failed' && finalJob.errorCode && finalJob.retryCount < finalJob.maxRetries) {
    await retryInternalJob(taskId).catch(() => null);
  }

  throw new Error(finalJob.errorMessage || 'Veo 任务失败');
};

export const processWithKieAi = async (
  imageUrls: string | string[],
  apiConfig: GlobalApiConfig,
  moduleConfig: ModuleConfig,
  isRatioMatch: boolean,
  signal: AbortSignal,
  customPrompt?: string,
  isRemoveText: boolean = false,
  sourceImageContext?: SourceImageContext,
  subMode: 'main' | 'detail' | 'remove_text' = 'main',
  taskMetadata: Record<string, unknown> = {},
  onJobCreated?: (jobId: string, providerTaskId?: string) => void,
): Promise<KieAiResult> => {
  logKieEvent('create_image_task', '开始创建图像任务', 'started', '', {
    imageCount: Array.isArray(imageUrls) ? imageUrls.length : 1,
    model: moduleConfig.model,
    aspectRatio: moduleConfig.aspectRatio,
    quality: moduleConfig.quality,
  });
  const safeImageUrls = await normalizeModelAssetUrls(imageUrls, '图像素材');
  const finalPrompt = customPrompt || buildKieAiPrompt(moduleConfig, isRatioMatch, isRemoveText, sourceImageContext, subMode);
  const promptWithCleanupSuffix = moduleConfig.model === 'gpt-image-2'
    ? `${finalPrompt}\n\n${GPT_IMAGE_2_CLEANUP_SUFFIX}`
    : finalPrompt;
  const module = getActiveModuleContext() || 'unknown';
  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const { job } = await createInternalJob({
    module,
    taskType: 'kie_image',
    provider: 'kie',
    payload: {
      imageUrls: safeImageUrls,
      prompt: promptWithCleanupSuffix,
      ...taskMetadata,
      model: moduleConfig.model || 'gpt-image-2',
      aspectRatio: moduleConfig.aspectRatio === AspectRatio.AUTO ? 'auto' : moduleConfig.aspectRatio,
      resolutionMode: moduleConfig.resolutionMode,
      targetWidth: moduleConfig.targetWidth || 0,
      targetHeight: moduleConfig.targetHeight || 0,
      maxFileSize: moduleConfig.maxFileSize || 2,
      resolution: moduleConfig.model === 'gpt-image-2'
        ? normalizeGptImage2Resolution(
            moduleConfig.aspectRatio === AspectRatio.AUTO ? 'auto' : moduleConfig.aspectRatio,
            moduleConfig.quality.toUpperCase()
          )
        : moduleConfig.quality.toUpperCase(),
      kieClientConfigPresent: Boolean(apiConfig.kieApiKey),
      requestId,
    },
    maxRetries: 2,
  });
  onJobCreated?.(job.id);
  const notifyProviderTaskId = (providerTaskId: string) => onJobCreated?.(job.id, providerTaskId);

  const imageTimeout = KIE_IMAGE_TIMEOUT[moduleConfig.model] || KIE_IMAGE_DEFAULT_TIMEOUT;
  const result = await waitForJobResult(job.id, signal, imageTimeout, true, Boolean(apiConfig.kieApiKey), notifyProviderTaskId);
  logKieEvent(
    'create_image_task',
    result.status === 'success' ? '图像任务完成' : result.status === 'interrupted' ? '图像任务已中断' : '图像任务失败',
    result.status === 'success' ? 'success' : result.status === 'interrupted' ? 'interrupted' : 'failed',
    result.message || '',
    { taskId: result.taskId, model: moduleConfig.model, creditsConsumed: result.creditsConsumed }
  );
  return result;
};

export const __testOnly_buildKieAiPrompt = buildKieAiPrompt;
