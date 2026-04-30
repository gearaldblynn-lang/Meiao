export const GPT_IMAGE_2_DEFAULT_QUALITY = '2k';
export const GPT_IMAGE_2_DEFAULT_RESOLUTION = '2K';
export const GPT_IMAGE_2_SUPPORTED_RESOLUTIONS = ['1K', '2K', '4K'];

export const normalizeGptImage2Resolution = (aspectRatio, resolution) => {
  const normalizedAspectRatio = String(aspectRatio || 'auto').trim() || 'auto';
  const normalizedResolution = String(resolution || GPT_IMAGE_2_DEFAULT_RESOLUTION).trim().toUpperCase()
    || GPT_IMAGE_2_DEFAULT_RESOLUTION;

  if (normalizedAspectRatio === 'auto') return '1K';
  if (normalizedAspectRatio === '1:1' && normalizedResolution === '4K') return '2K';
  if (!GPT_IMAGE_2_SUPPORTED_RESOLUTIONS.includes(normalizedResolution)) return GPT_IMAGE_2_DEFAULT_RESOLUTION;
  return normalizedResolution;
};
