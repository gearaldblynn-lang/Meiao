
import { GlobalApiConfig, ModuleConfig, KieAiResult, AspectRatio, VideoConfig, SourceImageContext } from "../types";

/**
 * 动态构建专业电商翻译与优化 Prompt
 */
const buildKieAiPrompt = (
  config: ModuleConfig,
  isRatioMatch: boolean,
  isRemoveText: boolean = false,
  sourceImageContext?: SourceImageContext
): string => {
  const targetLang = config.targetLanguage === 'CUSTOM' ? config.customLanguage : config.targetLanguage;
  const skipTranslation = config.targetLanguage === 'KEEP_ORIGINAL';

  // 1. 擦除模式
  if (isRemoveText) {
    let prompt = `TASK: CLEAN IMAGE PRODUCTION. `;
    prompt += `ERADICATE all text, characters, and numbers from the entire image. ONLY preserve text that is physically printed on the product packaging surface. Fill with a seamless, clean background. NO TEXT ALLOWED anywhere else. `;
    prompt += `STRICTLY output high-definition commercial studio quality. `;
    return prompt;
  } else {
    // 2. 翻译模式 (移除 Prompt 中的比例描述，由参数控制)
    let prompt = `任务：专业级对图像中的文案进行翻译。注意点：仅允许保留产品/包装表面的字符不变（存在产品情况下）。请勿更改图像主体内容以及主题。`;
    
    if (skipTranslation) {
      prompt += `严格保留图像内所有原始文本文案不变。`;
    } else {
      prompt += `严格将图像内所有文本文案文字翻译成${targetLang}，保持文案翻译对应以及准确。`;
    }

    if (isRatioMatch && sourceImageContext) {
      prompt += `输出画布需自然保持与原图一致的纵横比例，原图尺寸为${sourceImageContext.width}x${sourceImageContext.height}px，比例约为${sourceImageContext.ratioLabel}，禁止先按方图构图再拉伸。`;
    }

    prompt += `严格输出高清商业工作室品质。`;
    return prompt;
  }
};

/**
 * 轮询特定任务的结果
 */
const pollTaskResult = async (
  taskId: string, 
  apiConfig: GlobalApiConfig, 
  signal: AbortSignal,
  isVideo: boolean = false
): Promise<KieAiResult> => {
  // 根据最新要求：出海翻译与一键主详（图像任务）限时 6 分钟。
  // 轮询间隔 4 秒，则 90 次为 360 秒（6分钟）。
  const MAX_RETRIES = isVideo ? 180 : 90; 
  
  for (let i = 0; i < MAX_RETRIES; i++) {
    // 关键：每次循环开始即检查中断信号，确保中断功能灵敏
    if (signal.aborted) return { status: 'interrupted', imageUrl: '', taskId };
    
    try {
      const res = await fetch(`https://api.kie.ai/api/v1/jobs/recordInfo?taskId=${taskId}`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${apiConfig.kieApiKey}` },
        signal
      });
      const r = await res.json();
      
      if (r.code === 200) {
        const state = r.data.state; 
        if (state === 'success') {
          const resultJson = JSON.parse(r.data.resultJson);
          if (resultJson.resultUrls && resultJson.resultUrls.length > 0) {
            const url = resultJson.resultUrls[0];
            return { status: 'success', imageUrl: url, videoUrl: isVideo ? url : undefined, taskId };
          }
          throw new Error("API状态成功但未返回结果链接");
        }
        if (state === 'fail') return { status: 'error', message: r.data.failMsg || "引擎生成失败", imageUrl: '', taskId };
      } else {
        // 404 表示任务不存在或已过期
        if (r.code === 404 || r.msg?.toLowerCase().includes("not found")) {
          return { status: 'task_not_found', imageUrl: '', taskId, message: '任务已过期或不存在，请重新生成' };
        }
        // 401/403 等鉴权错误应立即停止轮询
        if (r.code === 401 || r.code === 403) {
          return { status: 'error', message: `鉴权失败 (${r.code}): ${r.msg || 'API Key 可能无效'}`, imageUrl: '', taskId };
        }
        // 500 等服务器错误，如果重试几次还是这样，也应该报错
        if (r.code >= 500 && i > 5) {
          return { status: 'error', message: `服务器异常 (${r.code}): ${r.msg || '请稍后重试'}`, imageUrl: '', taskId };
        }
        // 其他情况继续重试
      }
      
    } catch (e: any) {
      if (e.name === 'AbortError' || signal.aborted) return { status: 'interrupted', imageUrl: '', taskId };
      console.warn("Polling error, retrying...", e);
    }

    // 可中断的异步等待
    if (signal.aborted) return { status: 'interrupted', imageUrl: '', taskId };
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(resolve, 4000);
      const onAbort = () => {
        clearTimeout(timeout);
        signal.removeEventListener('abort', onAbort);
        reject(new Error('INTERRUPTED'));
      };
      signal.addEventListener('abort', onAbort);
    }).catch(e => {
      if (e.message !== 'INTERRUPTED') throw e;
    });
  }
  
  return { status: 'error', message: isVideo ? "视频合成超时" : "任务处理超时（超过6分钟限制）", imageUrl: '', taskId };
};

/**
 * 恢复并查询特定任务的结果
 */
export const recoverKieAiTask = async (
  taskId: string,
  apiConfig: GlobalApiConfig,
  signal: AbortSignal,
  isVideo: boolean = false
): Promise<KieAiResult> => {
  return await pollTaskResult(taskId, apiConfig, signal, isVideo);
};

/**
 * 创建 Sora 2 Pro Storyboard 视频生成任务
 */
export const createSoraVideoTask = async (
  imageUrls: string[],
  videoConfig: VideoConfig,
  apiConfig: GlobalApiConfig,
  signal: AbortSignal
): Promise<KieAiResult> => {
  try {
    const targetImageUrls = imageUrls.slice(0, 1);
    
    let inputPayload: any = {
      n_frames: parseInt(videoConfig.duration, 10),
      image_urls: targetImageUrls, 
      aspect_ratio: videoConfig.aspectRatio === 'landscape' ? "16:9" : "9:16"
    };

    if (videoConfig.promptMode === 'manual' && videoConfig.scenes.length > 0) {
      inputPayload.scenes = videoConfig.scenes.map(s => ({
        Scene: s.Scene,
        duration: Number(s.duration)
      }));
    } else {
      inputPayload.prompt = videoConfig.script || "Professional commercial product advertisement, cinematic lighting.";
    }

    const response = await fetch(`https://api.kie.ai/api/v1/jobs/createTask`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiConfig.kieApiKey}`
      },
      body: JSON.stringify({
        model: "sora-2-pro-storyboard",
        input: inputPayload
      }),
      signal
    });
    
    const result = await response.json();
    const taskId = result.data.taskId;
    try {
      return await pollTaskResult(taskId, apiConfig, signal, true);
    } catch (pollError: any) {
      if (pollError.message === 'INTERRUPTED' || signal.aborted) {
        return { status: 'interrupted', imageUrl: '', taskId };
      }
      return { status: 'error', message: pollError.message, imageUrl: '', taskId };
    }
  } catch (error: any) {
    if (error.name === 'AbortError' || error.message === 'INTERRUPTED' || signal.aborted) return { status: 'interrupted', imageUrl: '' };
    return { status: 'error', message: error.message, imageUrl: '' };
  }
};

/**
 * 提交 Veo 视频生成任务
 */
export const submitVeoVideoTask = async (
  script: { description: string, spokenContent: string, bgm: string },
  aspectRatio: string,
  imageUrls: string[],
  previousTaskId: string | undefined,
  apiConfig: GlobalApiConfig,
  signal: AbortSignal
): Promise<string> => {
  const BASE_URL = 'https://api.kie.ai/api/v1/veo';
  const fullPrompt = `视频内容描述：${script.description}；人声口播：${script.spokenContent}；背景音乐：${script.bgm}`.trim();

  let endpoint = `${BASE_URL}/generate`;
  let payload: any = {
    prompt: fullPrompt,
    model: "veo3_fast",
    aspect_ratio: aspectRatio === '9:16' ? '9:16' : '16:9'
  };

  if (previousTaskId) {
    endpoint = `${BASE_URL}/extend`;
    payload = { taskId: previousTaskId, prompt: fullPrompt };
  } else if (imageUrls.length > 0) {
    payload.generationType = "REFERENCE_2_VIDEO";
    payload.imageUrls = imageUrls;
  } else {
    payload.generationType = "TEXT_2_VIDEO";
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiConfig.kieApiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal
  });

  const result = await response.json();
  if (result.code !== 200) throw new Error(result.msg || "Kie Veo 请求失败");
  return result.data.taskId;
};

export const pollVeoTaskStatus = async (taskId: string, apiConfig: GlobalApiConfig, signal: AbortSignal): Promise<string> => {
  let attempts = 0;
  const maxAttempts = 120;
  
  // Recursively find video URL helper
  const findVideoUrlRecursively = (data: any): string | null => {
    if (!data) return null;
    if (typeof data === 'string') {
      const trimmed = data.trim();
      if (trimmed.startsWith('http')) return trimmed.split(',')[0].trim();
      return null;
    }
    if (Array.isArray(data)) {
      for (const item of data) {
        const found = findVideoUrlRecursively(item);
        if (found) return found;
      }
      return null;
    }
    if (typeof data === 'object') {
      const priorityKeys = ['resultUrls', 'videoUrl', 'url', 'playUrl', 'video_url', 'downloadUrl', 'uri', 'video_uri'];
      for (const key of priorityKeys) {
        if (data[key]) {
          const found = findVideoUrlRecursively(data[key]);
          if (found) return found;
        }
      }
      for (const key in data) {
        if (!priorityKeys.includes(key) && typeof data[key] === 'object') {
          const found = findVideoUrlRecursively(data[key]);
          if (found) return found;
        }
      }
    }
    return null;
  };

  while (attempts < maxAttempts) {
    if (signal.aborted) throw new Error("INTERRUPTED");
    await new Promise(resolve => setTimeout(resolve, 15000));
    try {
      const response = await fetch(`https://api.kie.ai/api/v1/veo/record-info?taskId=${taskId}`, {
        headers: { 'Authorization': `Bearer ${apiConfig.kieApiKey}` },
        signal
      });
      const result = await response.json();
      if (result.code === 200) {
        const data = result.data;
        if (!data) continue;
        if (data.successFlag === 1) {
          const videoUrl = findVideoUrlRecursively(data);
          if (videoUrl) return videoUrl;
          throw new Error("Missing video URL in successful response");
        } else if (data.successFlag === 2 || data.successFlag === 3) {
          throw new Error(data.failReason || "Veo Generation Failed");
        }
      }
    } catch (err: any) {
      if (err.message?.includes("Missing") || err.message?.includes("Failed")) throw err;
    }
    attempts++;
  }
  throw new Error("TIMEOUT");
};

/**
 * 创建图像处理任务
 */
export const processWithKieAi = async (
  imageUrls: string | string[], 
  apiConfig: GlobalApiConfig,
  moduleConfig: ModuleConfig,
  isRatioMatch: boolean,
  signal: AbortSignal,
  customPrompt?: string,
  isRemoveText: boolean = false,
  sourceImageContext?: SourceImageContext
): Promise<KieAiResult> => {
  try {
    const finalPrompt = customPrompt || buildKieAiPrompt(moduleConfig, isRatioMatch, isRemoveText, sourceImageContext);
    const inputImages = Array.isArray(imageUrls) ? imageUrls : [imageUrls];
    
    const createResponse = await fetch(`https://api.kie.ai/api/v1/jobs/createTask`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiConfig.kieApiKey}`
      },
      body: JSON.stringify({
        model: moduleConfig.model || "nano-banana-2",
        input: {
          prompt: finalPrompt,
          image_input: inputImages, 
          // 比例由参数直接控制
          aspect_ratio: moduleConfig.aspectRatio === AspectRatio.AUTO ? "auto" : moduleConfig.aspectRatio,
          resolution: moduleConfig.quality.toUpperCase(), 
          output_format: "png"
        }
      }),
      signal
    });

    const createResult = await createResponse.json();
    if (createResult.code !== 200) throw new Error(createResult.msg || "图像任务创建失败");
    
    const taskId = createResult.data.taskId;
    try {
      return await pollTaskResult(taskId, apiConfig, signal, false);
    } catch (pollError: any) {
      if (pollError.message === 'INTERRUPTED' || signal.aborted) {
        return { status: 'interrupted', imageUrl: '', taskId };
      }
      return { status: 'error', message: pollError.message, imageUrl: '', taskId };
    }
  } catch (error: any) {
    if (error.name === 'AbortError' || error.message === 'INTERRUPTED' || signal.aborted) {
      return { status: 'interrupted', imageUrl: '' };
    }
    return { status: 'error', message: error.message, imageUrl: '' };
  }
};
