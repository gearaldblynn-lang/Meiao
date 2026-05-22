const parsePositiveNumber = (value) => {
  const parsed = Number.parseFloat(String(value ?? '').trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

const GPT_IMAGE_2_RATIOS = ['auto', '1:1', '3:4', '4:3', '9:16', '16:9'];
const NANO_BANANA_2_RATIOS = ['auto', '1:1', '1:4', '1:8', '2:3', '3:2', '3:4', '4:1', '4:3', '4:5', '5:4', '8:1', '9:16', '16:9', '21:9'];

export const normalizeRetouchModel = (model = '') => {
  const normalized = String(model || '').trim().toLowerCase();
  if (normalized.includes('nano') || normalized.includes('banana')) return 'nano-banana-2';
  return 'gpt-image-2';
};

export const getRetouchSupportedAspectRatiosForModel = (model = '') => (
  normalizeRetouchModel(model) === 'gpt-image-2' ? GPT_IMAGE_2_RATIOS : NANO_BANANA_2_RATIOS
);

export const getSafeRetouchAspectRatioForModel = (model = '', aspectRatio = 'auto', fallback = 'auto') => {
  const supported = getRetouchSupportedAspectRatiosForModel(model);
  const normalizedRatio = String(aspectRatio || '').trim() || fallback;
  if (supported.includes(normalizedRatio)) return normalizedRatio;
  if (supported.includes(fallback)) return fallback;
  return supported[0] || 'auto';
};

export const normalizeRetouchResolutionMode = ({ resolutionMode, sizeMode } = {}) => {
  const normalized = String(resolutionMode || sizeMode || '').trim().toLowerCase();
  if (
    normalized === 'custom'
    || normalized.includes('custom')
    || normalized.includes('自定义')
    || normalized.includes('固定')
  ) {
    return 'custom';
  }
  return 'original';
};

export const parseRetouchAspectRatio = (value) => {
  const normalized = String(value || '').trim();
  if (!normalized || normalized === 'auto' || normalized.includes('自适应') || normalized.includes('原图')) {
    return null;
  }
  const match = normalized.match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/);
  if (!match) return null;
  const width = Number.parseFloat(match[1]);
  const height = Number.parseFloat(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  return { width, height, ratio: width / height, label: `${match[1]}:${match[2]}` };
};

/**
 * @param {{
 *   aspectRatio?: string;
 *   resolutionMode?: string;
 *   sizeMode?: string;
 *   width?: string | number;
 *   height?: string | number;
 *   targetWidth?: string | number;
 *   targetHeight?: string | number;
 *   tolerance?: number;
 * }} [input]
 */
export const getRetouchCustomSizeRatioWarning = ({
  aspectRatio,
  resolutionMode,
  sizeMode,
  width,
  height,
  targetWidth,
  targetHeight,
  tolerance = 0.01,
} = {}) => {
  if (normalizeRetouchResolutionMode({ resolutionMode, sizeMode }) !== 'custom') return '';
  const parsedRatio = parseRetouchAspectRatio(aspectRatio);
  if (!parsedRatio) return '';

  const outputWidth = parsePositiveNumber(width ?? targetWidth);
  const outputHeight = parsePositiveNumber(height ?? targetHeight);
  if (outputWidth <= 0 || outputHeight <= 0) return '';

  const currentRatio = outputWidth / outputHeight;
  if (Math.abs(currentRatio - parsedRatio.ratio) <= tolerance) return '';

  return `当前自定义尺寸与所选比例不一致。${parsedRatio.label} 建议宽高比约为 ${parsedRatio.width}:${parsedRatio.height}，请调整宽高或切换比例。`;
};
