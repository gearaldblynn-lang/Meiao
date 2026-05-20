const GPT_IMAGE_2_RATIOS = ['auto', '1:1', '3:4', '4:3', '9:16', '16:9'];
const NANO_BANANA_2_RATIOS = ['auto', '1:1', '1:4', '1:8', '2:3', '3:2', '3:4', '4:1', '4:3', '4:5', '5:4', '8:1', '9:16', '16:9', '21:9'];

export const getImageModelCapabilities = (model = 'gpt-image-2') => {
  if (model === 'gpt-image-2') {
    return {
      supportsStructuredAspectRatio: true,
      supportsStructuredResolution: true,
      supportsQualitySelection: true,
      supportsOutputFormat: false,
      supportsLongGenerationWarning: true,
      maxInputImages: 16,
      supportedAspectRatios: GPT_IMAGE_2_RATIOS,
      promptAspectRatioOnly: false,
      pollingWindowMs: 11 * 60_000,
      estimatedGenerationText: '预计 300-500 秒',
    };
  }

  return {
    supportsStructuredAspectRatio: true,
    supportsStructuredResolution: true,
    supportsQualitySelection: true,
    supportsOutputFormat: true,
    supportsLongGenerationWarning: false,
    maxInputImages: 10,
    supportedAspectRatios: NANO_BANANA_2_RATIOS,
    promptAspectRatioOnly: false,
    pollingWindowMs: 6 * 60_000,
    estimatedGenerationText: '',
  };
};

export const isLegacyRemovedImageModel = (model = '') => String(model || '').trim() === 'nano-banana-pro';

export const normalizeImageModel = (model = '', fallback = 'gpt-image-2') => {
  if (isLegacyRemovedImageModel(model)) return 'gpt-image-2';
  if (model === 'gpt-image-2' || model === 'nano-banana-2') return model;
  return fallback;
};

export const buildAspectRatioPromptHint = (aspectRatio) => {
  const normalized = String(aspectRatio || '').trim();
  if (!normalized || normalized === 'auto') return '';

  const orientation = (() => {
    const [width, height] = normalized.split(':').map(Number);
    if (!width || !height) return '';
    if (width === height) return '方图';
    return width > height ? '横版' : '竖版';
  })();

  return `最终画面按 ${normalized} ${orientation}构图生成。`;
};
