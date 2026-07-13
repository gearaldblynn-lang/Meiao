export const MAXFORAI_IMAGE_MODELS = Object.freeze([
  Object.freeze({
    id: 'maxforai-image-2-relay',
    label: 'image-2中转',
    upstreamModel: 'gpt-image-2',
  }),
]);

export const MAXFORAI_IMAGE_MODEL_IDS = Object.freeze(
  MAXFORAI_IMAGE_MODELS.map((item) => item.id),
);

export const MAXFORAI_SUPPORTED_ASPECT_RATIOS = Object.freeze([
  'auto',
  '1:1',
  '16:9',
  '9:16',
  '4:3',
  '3:4',
  '3:2',
  '2:3',
]);

const MAXFORAI_IMAGE_SIZE_TABLE = Object.freeze({
  '1:1': Object.freeze({ '1K': '1024x1024', '2K': '2048x2048', '4K': '2880x2880' }),
  '16:9': Object.freeze({ '1K': '1536x864', '2K': '2048x1152', '4K': '3840x2160' }),
  '9:16': Object.freeze({ '1K': '864x1536', '2K': '1152x2048', '4K': '2160x3840' }),
  '4:3': Object.freeze({ '1K': '1344x1008', '2K': '2048x1536', '4K': '3264x2448' }),
  '3:4': Object.freeze({ '1K': '1008x1344', '2K': '1536x2048', '4K': '2448x3264' }),
  '3:2': Object.freeze({ '1K': '1536x1024', '2K': '2016x1344', '4K': '3504x2336' }),
  '2:3': Object.freeze({ '1K': '1024x1536', '2K': '1344x2016', '4K': '2336x3504' }),
});

export const isMaxForAiImageModel = (value = '') =>
  MAXFORAI_IMAGE_MODEL_IDS.includes(String(value || '').trim());

export const getMaxForAiImageModel = (value = '') => {
  const id = String(value || '').trim();
  return MAXFORAI_IMAGE_MODELS.find((item) => item.id === id) || null;
};

export const resolveMaxForAiImageModelId = (value = '') => {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return '';
  return MAXFORAI_IMAGE_MODELS.find((item) => (
    item.id.toLowerCase() === normalized || item.label.toLowerCase() === normalized
  ))?.id || '';
};

export const resolveMaxForAiImageSize = (aspectRatio = 'auto', resolution = '1K') => {
  const ratio = String(aspectRatio || 'auto').trim() || 'auto';
  if (ratio === 'auto') return 'auto';
  const normalizedResolution = String(resolution || '1K').trim().toUpperCase() || '1K';
  const size = MAXFORAI_IMAGE_SIZE_TABLE[ratio]?.[normalizedResolution];
  if (!size) {
    throw new Error(`MaxForAI 不支持的图片比例或分辨率: ${ratio}/${normalizedResolution}`);
  }
  return size;
};
