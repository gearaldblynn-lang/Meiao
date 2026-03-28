export const deriveTranslationExecutionPlan = ({ config, subMode }) => {
  const isDetailMode = subMode === 'detail';
  const effectiveConfig = isDetailMode
    ? { ...config, aspectRatio: 'auto' }
    : config;

  return {
    effectiveConfig,
    isRatioMatch: effectiveConfig.aspectRatio === 'auto',
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
