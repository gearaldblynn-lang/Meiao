const SUPPORTED_RATIOS = {
  'nano-banana-2': ['1:1', '1:4', '1:8', '2:3', '3:2', '3:4', '4:1', '4:3', '4:5', '5:4', '8:1', '9:16', '16:9', '21:9'],
  'gpt-image-2': ['1:1', '1:4', '1:8', '2:3', '3:2', '3:4', '4:1', '4:3', '4:5', '5:4', '8:1', '9:16', '16:9', '21:9'],
};

const getClosestSupportedAspectRatio = (sourceDimensions, model = 'gpt-image-2') => {
  const width = Number(sourceDimensions?.width || 0);
  const height = Number(sourceDimensions?.height || 0);
  if (!width || !height) return 'auto';

  const sourceRatio = width / height;
  const supportedRatios = SUPPORTED_RATIOS[model] || SUPPORTED_RATIOS['gpt-image-2'];

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
