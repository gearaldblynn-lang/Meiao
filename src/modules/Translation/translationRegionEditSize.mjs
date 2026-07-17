const positiveInteger = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : 0;
};

const resolveSize = (width, height, source) => {
  const resolvedWidth = positiveInteger(width);
  const resolvedHeight = positiveInteger(height);

  if (!resolvedWidth || !resolvedHeight) {
    return null;
  }

  return {
    width: resolvedWidth,
    height: resolvedHeight,
    source,
  };
};

export const resolveTranslationInitialCanvasSize = ({
  subFeature,
  snapshot,
  originalWidth,
  originalHeight,
  persistedWidth,
  persistedHeight,
  fallbackWidth,
  fallbackHeight,
} = {}) => {
  if (subFeature !== 'main' && subFeature !== 'detail') {
    return null;
  }

  const persistedSize = resolveSize(persistedWidth, persistedHeight, 'persisted');
  if (persistedSize) {
    return persistedSize;
  }

  if (snapshot?.resolutionMode === 'original') {
    return resolveSize(originalWidth, originalHeight, 'original');
  }

  if (snapshot?.resolutionMode === 'custom') {
    if (subFeature === 'main') {
      return resolveSize(snapshot.targetWidth, snapshot.targetHeight, 'custom');
    }

    const targetWidth = positiveInteger(snapshot.targetWidth);
    const sourceWidth = positiveInteger(originalWidth);
    const sourceHeight = positiveInteger(originalHeight);

    if (!targetWidth || !sourceWidth || !sourceHeight) {
      return null;
    }

    return {
      width: targetWidth,
      height: Math.max(1, Math.round((targetWidth * sourceHeight) / sourceWidth)),
      source: 'custom',
    };
  }

  return resolveSize(fallbackWidth, fallbackHeight, 'v1');
};
