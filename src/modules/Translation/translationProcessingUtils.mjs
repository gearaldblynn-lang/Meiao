import { getImageModelCapabilities } from '../../utils/modelCapabilities.mjs';
import { resolveMaxForAiImageModelId } from '../../utils/maxforaiImageModels.mjs';

export const TRANSLATION_OUTPUT_ASPECT_RATIO_TOLERANCE = 0.02;

const getClosestSupportedAspectRatio = (sourceDimensions, model = 'gpt-image-2') => {
  const width = Number(sourceDimensions?.width || 0);
  const height = Number(sourceDimensions?.height || 0);
  if (!width || !height) return 'auto';

  const sourceRatio = width / height;
  const normalizedModel = resolveMaxForAiImageModelId(model) || model;
  const supportedRatios = getImageModelCapabilities(normalizedModel).supportedAspectRatios
    .filter((ratio) => ratio !== 'auto');

  let closestRatio = supportedRatios[0];
  let closestDelta = Infinity;

  supportedRatios.forEach((ratio) => {
    const [ratioWidth, ratioHeight] = ratio.split(':').map(Number);
    const delta = Math.abs(sourceRatio - (ratioWidth / ratioHeight));
    if (delta < closestDelta) {
      closestDelta = delta;
      closestRatio = ratio;
    }
  });

  return closestRatio;
};

const parseAspectRatio = (aspectRatio) => {
  if (!aspectRatio || aspectRatio === 'auto') return null;
  const [ratioWidth, ratioHeight] = String(aspectRatio).split(':').map(Number);
  if (!Number.isFinite(ratioWidth) || !Number.isFinite(ratioHeight) || ratioWidth <= 0 || ratioHeight <= 0) {
    return null;
  }
  return { ratioWidth, ratioHeight };
};

const normalizeSizeValue = (value) => {
  const cleaned = String(value ?? '').trim();
  if (!cleaned) return '';
  const numeric = Number(cleaned);
  if (!Number.isFinite(numeric) || numeric <= 0) return '';
  return String(Math.round(numeric));
};

const normalizeFreeSizeValue = (value) => {
  const cleaned = String(value ?? '').trim();
  if (cleaned === '0') return '0';
  return normalizeSizeValue(cleaned);
};

export const deriveLinkedTranslationSize = ({
  aspectRatio,
  targetWidth,
  targetHeight,
  changedKey,
  fallbackWidth = 800,
  fallbackHeight = 800,
}) => {
  const width = normalizeSizeValue(targetWidth);
  const height = normalizeSizeValue(targetHeight);
  const ratio = parseAspectRatio(aspectRatio);

  if (!ratio) {
    return {
      targetWidth: width || normalizeSizeValue(fallbackWidth),
      targetHeight: normalizeFreeSizeValue(targetHeight) || normalizeFreeSizeValue(fallbackHeight),
    };
  }

  if (changedKey === 'targetHeight') {
    if (!height) return { targetWidth: '', targetHeight: '' };
    return {
      targetWidth: String(Math.max(1, Math.round(Number(height) * ratio.ratioWidth / ratio.ratioHeight))),
      targetHeight: height,
    };
  }

  if (changedKey === 'targetWidth' && !width) return { targetWidth: '', targetHeight: '' };

  const baseWidth = width || normalizeSizeValue(fallbackWidth);
  if (!baseWidth) return { targetWidth: '', targetHeight: '' };

  return {
    targetWidth: baseWidth,
    targetHeight: String(Math.max(1, Math.round(Number(baseWidth) * ratio.ratioHeight / ratio.ratioWidth))),
  };
};

export const deriveTranslationExecutionPlan = ({ config, subMode, sourceDimensions }) => {
  const providerRatios = getImageModelCapabilities(config?.model).supportedAspectRatios || [];
  const useAutoMatchedRatio = (subMode === 'detail' || subMode === 'remove_text')
    && config?.aspectRatio === 'auto'
    && !providerRatios.includes('auto');
  const effectiveConfig = useAutoMatchedRatio
    ? { ...config, aspectRatio: getClosestSupportedAspectRatio(sourceDimensions, config?.model) }
    : config;

  return {
    effectiveConfig,
    isRatioMatch: effectiveConfig.aspectRatio === 'auto',
  };
};

export const assertTranslationOutputAspectRatio = ({
  sourceWidth,
  sourceHeight,
  targetWidth,
  targetHeight,
  tolerance = TRANSLATION_OUTPUT_ASPECT_RATIO_TOLERANCE,
}) => {
  const normalized = [sourceWidth, sourceHeight, targetWidth, targetHeight].map(Number);
  if (!normalized.every((value) => Number.isFinite(value) && value > 0)) return;
  const [safeSourceWidth, safeSourceHeight, safeTargetWidth, safeTargetHeight] = normalized;
  const sourceRatio = safeSourceWidth / safeSourceHeight;
  const targetRatio = safeTargetWidth / safeTargetHeight;
  const relativeDrift = Math.abs(sourceRatio / targetRatio - 1);
  const safeTolerance = Number(tolerance || TRANSLATION_OUTPUT_ASPECT_RATIO_TOLERANCE);
  if (relativeDrift <= safeTolerance + Number.EPSILON * 10) return;

  const error = new Error(
    `模型返回图片比例与目标画布不一致：${Math.round(safeSourceWidth)}x${Math.round(safeSourceHeight)} -> ${Math.round(safeTargetWidth)}x${Math.round(safeTargetHeight)}，已阻止非等比拉伸。`,
  );
  error.code = 'image_output_aspect_ratio_mismatch';
  error.providerStage = 'output_transform';
  error.providerStatus = 'failed';
  throw error;
};

export const getStoredSourceDimensions = (fileItem) => {
  const width = Number(fileItem?.originalWidth || 0);
  const height = Number(fileItem?.originalHeight || 0);
  if (!width || !height) return null;

  return {
    width,
    height,
    ratio: width / height,
  };
};

export const deriveTranslationExportSize = ({
  config,
  subMode,
  sourceDimensions,
  generatedDimensions: _generatedDimensions,
}) => {
  let targetWidth = sourceDimensions.width;
  let targetHeight = sourceDimensions.height;

  if (config.resolutionMode === 'custom') {
    if (subMode === 'detail' || subMode === 'remove_text') {
      targetWidth = config.targetWidth;
      targetHeight = Math.round(config.targetWidth / sourceDimensions.ratio);
    } else {
      targetWidth = config.targetWidth;
      targetHeight = config.targetHeight;
    }
  }

  return {
    targetWidth,
    targetHeight,
  };
};
