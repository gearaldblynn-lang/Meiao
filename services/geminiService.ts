
import { GoogleGenAI } from "@google/genai";
import { ModuleConfig, GeminiProcessResult, AspectRatio } from "../types";
import { fileToBase64, getMimeType } from "../utils/imageUtils";

/**
 * 直接使用 Google Gemini API 处理图像
 */
export const processEcomImage = async (
  file: File,
  config: ModuleConfig
): Promise<GeminiProcessResult> => {
  try {
    const modelName = (config.quality === '2k' || config.quality === '4k') 
      ? 'gemini-3-pro-image-preview' 
      : 'gemini-2.5-flash-image';

    if (modelName === 'gemini-3-pro-image-preview') {
      const aistudio = (window as any).aistudio;
      if (typeof window !== 'undefined' && aistudio && !(await aistudio.hasSelectedApiKey())) {
        await aistudio.openSelectKey();
      }
    }

    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const base64Data = await fileToBase64(file);
    const mimeType = getMimeType(file.name);

    const finalLanguage = config.targetLanguage === 'CUSTOM' ? config.customLanguage : config.targetLanguage;
    const skipTranslation = config.targetLanguage === 'KEEP_ORIGINAL';

    const prompt = `
      Task: Professional E-commerce Image Localization & Optimization.
      
      1. [Translation]: ${skipTranslation 
          ? 'KEEP all existing text on the image EXACTLY as they are. DO NOT translate or modify textual content.' 
          : `Replace all text on the image with ${finalLanguage}. Use professional marketing language suitable for e-commerce. Maintain original font style and color.`}
         
      2. [Logo/Watermark]: 
         - REMOVE all background watermarks, platform logos, and website URLs.
         - PROTECT: Do NOT remove logos that are printed on the product packaging itself.
         
      3. [Composition]: Adapt the image to a ${config.aspectRatio} aspect ratio.
         - Do not stretch the product. 
         - Intelligently fill the new frame while maintaining original style.
         
      4. [Quality]: High fidelity. Professional studio photograph appearance.
    `;

    const supportedRatios = ['1:1', '3:4', '4:3', '9:16', '16:9'];
    const geminiAspectRatio = supportedRatios.includes(config.aspectRatio) ? config.aspectRatio : '1:1';

    const response = await ai.models.generateContent({
      model: modelName,
      contents: {
        parts: [
          { inlineData: { data: base64Data, mimeType } },
          { text: prompt }
        ]
      },
      config: {
        imageConfig: {
          aspectRatio: geminiAspectRatio as any,
          ...(modelName === 'gemini-3-pro-image-preview' ? { imageSize: config.quality.toUpperCase() as any } : {})
        }
      }
    });

    let resultBase64 = '';
    if (response.candidates?.[0]?.content?.parts) {
      for (const part of response.candidates[0].content.parts) {
        if (part.inlineData) {
          resultBase64 = part.inlineData.data;
          break;
        }
      }
    }

    if (!resultBase64) {
      const textResponse = response.text || '';
      return { 
        status: 'error', 
        message: textResponse.includes('Safety') ? '触发安全审查' : '未返回图像数据', 
        base64Image: '' 
      };
    }

    return { status: 'success', base64Image: resultBase64 };
  } catch (error: any) {
    if (error.message?.includes('Requested entity was not found')) {
      const aistudio = (window as any).aistudio;
      if (typeof window !== 'undefined' && aistudio) {
        await aistudio.openSelectKey();
      }
    }
    return { status: 'error', message: error.message, base64Image: '' };
  }
};
