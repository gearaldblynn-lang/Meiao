
import { GlobalApiConfig, ModuleConfig, RunningHubResult, AspectRatio } from "../types";

const ensureUrlIsAccessible = async (url: string, signal: AbortSignal, maxRetries = 6): Promise<boolean> => {
  for (let i = 0; i < maxRetries; i++) {
    if (signal.aborted) return false;
    try {
      const isReady = await new Promise<boolean>((resolve) => {
        const img = new Image();
        img.onload = () => resolve(true);
        img.onerror = () => resolve(false);
        img.src = `${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}`;
        setTimeout(() => resolve(false), 5000);
      });
      if (isReady) return true;
    } catch (e) {}
    await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
  }
  return false;
};

/**
 * 动态构建 AI 翻译指令集 (Prompt Engineering)
 */
const buildProfessionalPrompt = (config: ModuleConfig, isRatioMatch: boolean): string => {
  const targetLang = config.targetLanguage === 'CUSTOM' ? config.customLanguage : config.targetLanguage;
  const isAuto = config.aspectRatio === AspectRatio.AUTO;
  const skipTranslation = config.targetLanguage === 'KEEP_ORIGINAL';

  // 基础任务定义与严格准则
  let prompt = `TASK: IMAGE TRANSLATION. STRICT REQUIREMENT: Use the provided image from LoadImage node as the SOLE SOURCE OF TRUTH. `;
  
  if (isRatioMatch || isAuto) {
    // 维持比例模式：极其严格，禁止任何变动
    prompt += `DO NOT change image content, products, background, or lighting. The subject and environment must remain 100% identical. No hallucinations allowed. `;
  } else {
    // 改变比例模式：允许智能延伸背景
    prompt += `The product subject must remain 100% identical. However, since the aspect ratio is changed to ${config.aspectRatio}, you are allowed to INTELLIGENTLY EXTEND the background or scenery to fill the new frame naturally while preserving the original artistic style and lighting. No stretching allowed. `;
  }

  // 翻译核心指令
  if (skipTranslation) {
    prompt += `KEEP all existing text on the image UNCHANGED. Do not translate. Just clear the watermark and optimize quality. `;
  } else {
    prompt += `ONLY translate all visible text to ${targetLang} using professional e-commerce marketing language. Maintain the original font style, color, and positioning as much as possible. `;
  }
  
  // 水印清洗指令
  if (config.removeWatermark) {
    prompt += `STRICTLY remove all background watermarks, platform logos, and website URLs. DO NOT remove brand logos that are printed directly on the product or packaging. `;
  }

  return prompt;
};

export const processWithRunningHub = async (
  imageUrl: string,
  apiConfig: GlobalApiConfig,
  moduleConfig: ModuleConfig,
  isRatioMatch: boolean,
  signal: AbortSignal
): Promise<RunningHubResult> => {
  try {
    const isReady = await ensureUrlIsAccessible(imageUrl, signal);
    if (signal.aborted) return { status: 'interrupted', imageUrl: '' };
    if (!isReady) throw new Error("存储资源访问超时");

    const prompt = buildProfessionalPrompt(moduleConfig, isRatioMatch);
    const formattedRatio = moduleConfig.aspectRatio === AspectRatio.AUTO ? '1:1' : moduleConfig.aspectRatio;

    const body = {
      webappId: apiConfig.rhWebappId,
      apiKey: apiConfig.rhApiKey,
      quickCreateCode: apiConfig.rhQuickCreateCode,
      nodeInfoList: [
        { nodeId: "3", nodeName: "LoadImage", fieldName: "image", fieldType: "IMAGE", fieldValue: imageUrl },
        { nodeId: "2", nodeName: "RH_Nano_Banana2_Image2Image", fieldName: "aspectRatio", fieldType: "LIST", fieldValue: formattedRatio },
        { nodeId: "2", nodeName: "RH_Nano_Banana2_Image2Image", fieldName: "resolution", fieldType: "LIST", fieldValue: moduleConfig.quality.toLowerCase() },
        { nodeId: "2", nodeName: "RH_Nano_Banana2_Image2Image", fieldName: "prompt", fieldType: "STRING", fieldValue: prompt }
      ]
    };

    const submitResponse = await fetch(`https://www.runninghub.cn/task/openapi/quick-ai-app/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal
    });

    const submitResult = await submitResponse.json();
    if (submitResult.code !== 0) throw new Error(submitResult.msg || "任务提交失败");

    const poll = async (tid: string): Promise<string> => {
      for (let i = 0; i < 150; i++) {
        if (signal.aborted) throw new Error("INTERRUPTED");
        
        await new Promise(r => setTimeout(r, 5000));
        
        const res = await fetch(`https://www.runninghub.cn/task/openapi/outputs`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ apiKey: apiConfig.rhApiKey, taskId: tid }),
          signal
        });
        const r = await res.json();
        if (r.code === 0 && r.data?.length > 0) return r.data[0].fileUrl;
        if (r.code === 805) throw new Error("引擎生成失败");
      }
      throw new Error("处理超时");
    };

    const finalUrl = await poll(submitResult.data.taskId);
    return { status: 'success', imageUrl: finalUrl };
  } catch (error: any) {
    if (error.name === 'AbortError' || error.message === 'INTERRUPTED') {
      return { status: 'interrupted', imageUrl: '' };
    }
    return { status: 'error', message: error.message, imageUrl: '' };
  }
};
