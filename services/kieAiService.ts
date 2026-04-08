import { GlobalApiConfig, ModuleConfig, KieAiResult, AspectRatio, VideoConfig, SourceImageContext } from '../types';
import { cancelInternalJob, createInternalJob, getActiveModuleContext, retryInternalJob, safeCreateInternalLog, waitForInternalJob } from './internalApi';
import { getUserVisibleTaskId } from './kieTaskUtils.mjs';

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
  'nano-banana-2': 3 * 60_000,
  'nano-banana-pro': 4 * 60_000,
};
const KIE_IMAGE_DEFAULT_TIMEOUT = 3 * 60_000;
const KIE_VIDEO_TIMEOUT = 5 * 60_000;
const KIE_RECOVER_TIMEOUT = 2 * 60_000;

const waitForJobResult = async (jobId: string, signal?: AbortSignal, maxWaitMs = 0): Promise<KieAiResult> => {
  try {
    const finalJob = await waitForInternalJob(jobId, signal, 2500, maxWaitMs);
    if (finalJob.status === 'succeeded') {
      return {
        imageUrl: String(finalJob.result?.imageUrl || ''),
        videoUrl: finalJob.result?.videoUrl ? String(finalJob.result.videoUrl) : undefined,
        taskId: getUserVisibleTaskId(finalJob),
        status: 'success',
        message: '',
      };
    }

    if (finalJob.status === 'cancelled') {
      return {
        imageUrl: '',
        taskId: getUserVisibleTaskId(finalJob),
        status: 'interrupted',
        message: finalJob.errorMessage || '任务已取消',
      };
    }

    if (finalJob.errorCode === 'task_not_found') {
      return {
        imageUrl: '',
        taskId: getUserVisibleTaskId(finalJob),
        status: 'task_not_found',
        message: finalJob.errorMessage || '任务不存在或已过期',
      };
    }

    return {
      imageUrl: '',
      taskId: getUserVisibleTaskId(finalJob),
      status: 'error',
      message: finalJob.errorMessage || '任务执行失败',
    };
  } catch (error: any) {
    if (error.message === 'INTERRUPTED') {
      void cancelInternalJob(jobId).catch(() => null);
      return { imageUrl: '', status: 'interrupted', message: '任务已取消' };
    }
    return { imageUrl: '', status: 'error', message: error.message || '任务执行失败' };
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
    let prompt = `TASK: CLEAN IMAGE PRODUCTION. `;
    prompt += `ERADICATE all text, characters, and numbers from the entire image. ONLY preserve text that is physically printed on the product packaging surface. Fill with a seamless, clean background. NO TEXT ALLOWED anywhere else. `;
    prompt += `STRICTLY output high-definition commercial studio quality. `;
    return prompt;
  }

  let prompt = `任务：专业级对图像中的文案进行翻译。注意点：仅允许保留产品/包装表面的字符不变（存在产品情况下）。请勿更改图像主体内容以及主题。`;
  prompt += `优化画面中的影响画面效果的半透明污点瑕疵，保持画面整洁。`;

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
  const module = getActiveModuleContext() || 'unknown';
  const { job } = await createInternalJob({
    module,
    taskType: 'kie_recover',
    provider: 'kie',
    payload: {
      taskId,
      providerTaskId: taskId,
      isVideo,
      kieClientConfigPresent: Boolean(apiConfig.kieApiKey),
    },
    maxRetries: 1,
  });

  const result = await waitForJobResult(job.id, signal, KIE_RECOVER_TIMEOUT);
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
  signal: AbortSignal
): Promise<KieAiResult> => {
  logKieEvent('create_video_task', '开始创建视频任务', 'started', '', {
    imageCount: imageUrls.length,
    duration: videoConfig.duration,
  });
  const module = getActiveModuleContext() || 'unknown';
  const { job } = await createInternalJob({
    module,
    taskType: 'kie_video',
    provider: 'kie',
    payload: {
      imageUrls,
      videoConfig,
      kieClientConfigPresent: Boolean(apiConfig.kieApiKey),
      requestId: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    },
    maxRetries: 2,
  });

  const result = await waitForJobResult(job.id, signal, KIE_VIDEO_TIMEOUT);
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
  const module = getActiveModuleContext() || 'unknown';
  const { job } = await createInternalJob({
    module,
    taskType: 'kie_veo',
    provider: 'kie',
    payload: {
      script,
      aspectRatio,
      imageUrls,
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
  subMode: 'main' | 'detail' | 'remove_text' = 'main'
): Promise<KieAiResult> => {
  logKieEvent('create_image_task', '开始创建图像任务', 'started', '', {
    imageCount: Array.isArray(imageUrls) ? imageUrls.length : 1,
    model: moduleConfig.model,
    aspectRatio: moduleConfig.aspectRatio,
    quality: moduleConfig.quality,
  });
  const finalPrompt = customPrompt || buildKieAiPrompt(moduleConfig, isRatioMatch, isRemoveText, sourceImageContext, subMode);
  const module = getActiveModuleContext() || 'unknown';
  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const { job } = await createInternalJob({
    module,
    taskType: 'kie_image',
    provider: 'kie',
    payload: {
      imageUrls: Array.isArray(imageUrls) ? imageUrls : [imageUrls],
      prompt: finalPrompt,
      model: moduleConfig.model || 'nano-banana-2',
      aspectRatio: moduleConfig.aspectRatio === AspectRatio.AUTO ? 'auto' : moduleConfig.aspectRatio,
      resolution: moduleConfig.quality.toUpperCase(),
      kieClientConfigPresent: Boolean(apiConfig.kieApiKey),
      requestId,
    },
    maxRetries: 2,
  });

  const imageTimeout = KIE_IMAGE_TIMEOUT[moduleConfig.model] || KIE_IMAGE_DEFAULT_TIMEOUT;
  const result = await waitForJobResult(job.id, signal, imageTimeout);
  logKieEvent(
    'create_image_task',
    result.status === 'success' ? '图像任务完成' : result.status === 'interrupted' ? '图像任务已中断' : '图像任务失败',
    result.status === 'success' ? 'success' : result.status === 'interrupted' ? 'interrupted' : 'failed',
    result.message || '',
    { taskId: result.taskId, model: moduleConfig.model }
  );
  return result;
};

export const __testOnly_buildKieAiPrompt = buildKieAiPrompt;
