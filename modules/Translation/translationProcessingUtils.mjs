const SUPPORTED_RATIOS = {
  'nano-banana-2': ['1:1', '1:4', '1:8', '2:3', '3:2', '3:4', '4:1', '4:3', '4:5', '5:4', '8:1', '9:16', '16:9', '21:9'],
  'nano-banana-pro': ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'],
};

const getClosestSupportedAspectRatio = (sourceDimensions, model = 'nano-banana-2') => {
  const width = Number(sourceDimensions?.width || 0);
  const height = Number(sourceDimensions?.height || 0);
  if (!width || !height) return 'auto';

  const sourceRatio = width / height;
  const supportedRatios = SUPPORTED_RATIOS[model] || SUPPORTED_RATIOS['nano-banana-2'];

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

export const deriveTranslationExecutionPlan = ({ config, subMode, sourceDimensions }) => {
  const useAutoMatchedRatio = (subMode === 'detail' || subMode === 'remove_text') && config?.aspectRatio === 'auto';
  const effectiveConfig = useAutoMatchedRatio
    ? { ...config, aspectRatio: getClosestSupportedAspectRatio(sourceDimensions, config?.model) }
    : config;

  return {
    effectiveConfig,
    isRatioMatch: effectiveConfig.aspectRatio === 'auto',
  };
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
