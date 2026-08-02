import {
  TRANSLATION_EDIT_REGION_COLORS,
  normalizeTranslationEditRegions,
} from './translationRegionEditUtils.mjs';
import {
  isTranslationRegionBackgroundCleanupInstruction,
  isTranslationRegionEraseInstruction,
  resolveTranslationRegionTextRenderPlan,
} from './translationRegionEditIntent.mjs';
import { loadBrowserImage } from '../../utils/browserImageLoader.mjs';

const DEFAULT_FEATHER_RATIO = 0.08;

let lastMaskStats = null;

export const __getTranslationRegionEditMaskStatsForTest = () => lastMaskStats;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const defaultLoadImage = (url, signal) => loadBrowserImage(url, 'Translation edit image', signal);

const throwIfAborted = (signal) => {
  if (!signal?.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  const error = new Error(
    typeof signal.reason === 'string' && signal.reason ? signal.reason : 'The operation was aborted',
  );
  error.name = 'AbortError';
  throw error;
};

const getNaturalDimensions = (image, label) => {
  const hasNaturalDimensions = 'naturalWidth' in Object(image) || 'naturalHeight' in Object(image);
  const width = Number(hasNaturalDimensions ? image?.naturalWidth : image?.width);
  const height = Number(hasNaturalDimensions ? image?.naturalHeight : image?.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error(`${label} image dimensions are invalid`);
  }
  return { width: Math.floor(width), height: Math.floor(height) };
};

const resolveCanvasDimensions = ({ naturalWidth, naturalHeight, targetWidth, targetHeight }) => {
  const hasTargetWidth = targetWidth !== undefined && targetWidth !== null;
  const hasTargetHeight = targetHeight !== undefined && targetHeight !== null;
  if (!hasTargetWidth && !hasTargetHeight) return { width: naturalWidth, height: naturalHeight };

  const width = Number(targetWidth);
  const height = Number(targetHeight);
  const resolvedWidth = Math.floor(width);
  const resolvedHeight = Math.floor(height);
  if (
    !hasTargetWidth
    || !hasTargetHeight
    || !Number.isFinite(width)
    || !Number.isFinite(height)
    || width <= 0
    || height <= 0
    || resolvedWidth < 1
    || resolvedHeight < 1
  ) {
    throw new Error('Target canvas dimensions are invalid');
  }

  return { width: resolvedWidth, height: resolvedHeight };
};

const createCanvas = (width, height, label) => {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
    throw new Error(`${label} canvas is unavailable`);
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error(`${label} 2D context is unavailable`);
  return { canvas, context };
};

const exportPng = (canvas, label) => new Promise((resolve, reject) => {
  try {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error(`${label} PNG export failed`));
        return;
      }
      resolve(blob);
    }, 'image/png');
  } catch (error) {
    reject(new Error(`${label} PNG export failed: ${error?.message || error}`));
  }
});

const toPixelRect = (region, width, height) => ({
  x: Math.round(region.xRatio * width),
  y: Math.round(region.yRatio * height),
  width: Math.round(region.widthRatio * width),
  height: Math.round(region.heightRatio * height),
});

const getDrawableRegions = (regions, width, height) => normalizeTranslationEditRegions(regions)
  .map((item) => ({ region: item, rect: toPixelRect(item, width, height) }))
  .filter(({ rect }) => rect.width > 0 && rect.height > 0);

export const createTranslationRegionGuide = async ({
  imageUrl = '',
  targetWidth,
  targetHeight,
  regions = [],
  loadImage = defaultLoadImage,
  signal,
} = {}) => {
  const image = await loadImage(imageUrl, signal);
  try {
    throwIfAborted(signal);
    const sourceDimensions = getNaturalDimensions(image, 'Source');
    const { width, height } = resolveCanvasDimensions({
      naturalWidth: sourceDimensions.width,
      naturalHeight: sourceDimensions.height,
      targetWidth,
      targetHeight,
    });
    const drawableRegions = getDrawableRegions(regions, width, height);
    const { canvas, context } = createCanvas(width, height, 'Translation region guide');

    context.drawImage(image, 0, 0, width, height);
    const borderWidth = Math.max(2, Math.round(Math.min(width, height) * 0.005));
    const badgeSize = Math.max(20, Math.round(Math.min(width, height) * 0.06));

    drawableRegions.forEach(({ region, rect }) => {
      const color = TRANSLATION_EDIT_REGION_COLORS[
        (Math.max(1, Number(region.index) || 1) - 1) % TRANSLATION_EDIT_REGION_COLORS.length
      ];

      context.save();
      context.strokeStyle = color;
      context.lineWidth = borderWidth;
      context.strokeRect(rect.x, rect.y, rect.width, rect.height);
      context.restore();

      const badgeX = clamp(rect.x, 0, Math.max(0, width - badgeSize));
      const badgeY = clamp(rect.y, 0, Math.max(0, height - badgeSize));
      context.save();
      context.fillStyle = color;
      context.fillRect(badgeX, badgeY, badgeSize, badgeSize);
      context.fillStyle = '#ffffff';
      context.font = `bold ${Math.max(12, Math.round(badgeSize * 0.62))}px sans-serif`;
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText(String(region.index), badgeX + badgeSize / 2, badgeY + badgeSize / 2);
      context.restore();
    });

    const blob = await exportPng(canvas, 'Translation region guide');
    throwIfAborted(signal);
    return { blob, width, height };
  } finally {
    image?.close?.();
  }
};

const regionsConnect = (left, right) => (
  left.rect.x <= right.rect.x + right.rect.width
  && left.rect.x + left.rect.width >= right.rect.x
  && left.rect.y <= right.rect.y + right.rect.height
  && left.rect.y + left.rect.height >= right.rect.y
);

const createConnectedComponents = (drawableRegions) => {
  const remaining = new Set(drawableRegions.map((_, index) => index));
  const components = [];

  while (remaining.size > 0) {
    const [first] = remaining;
    remaining.delete(first);
    const indexes = [first];
    const component = [];

    while (indexes.length > 0) {
      const currentIndex = indexes.pop();
      const current = drawableRegions[currentIndex];
      component.push(current);
      for (const candidateIndex of remaining) {
        if (!regionsConnect(current, drawableRegions[candidateIndex])) continue;
        remaining.delete(candidateIndex);
        indexes.push(candidateIndex);
      }
    }
    components.push(component);
  }

  return components;
};

const getComponentBounds = (component, canvasWidth, canvasHeight, featherRatio) => {
  const maxFeatherWidth = component.reduce((maximum, { rect }) => (
    Math.max(maximum, Math.min(rect.width, rect.height) * featherRatio)
  ), 0);
  const padding = featherRatio > 0 ? Math.ceil(maxFeatherWidth) + 1 : 0;
  const left = clamp(Math.floor(Math.min(...component.map(({ rect }) => rect.x))) - padding, 0, canvasWidth);
  const top = clamp(Math.floor(Math.min(...component.map(({ rect }) => rect.y))) - padding, 0, canvasHeight);
  const right = clamp(
    Math.ceil(Math.max(...component.map(({ rect }) => rect.x + rect.width))) + padding,
    left,
    canvasWidth,
  );
  const bottom = clamp(
    Math.ceil(Math.max(...component.map(({ rect }) => rect.y + rect.height))) + padding,
    top,
    canvasHeight,
  );
  return { x: left, y: top, width: right - left, height: bottom - top };
};

const createUnionFeatherMask = (component, bounds, featherRatio) => {
  const size = bounds.width * bounds.height;
  const union = new Uint8Array(size);
  const featherWidths = featherRatio > 0 ? new Float32Array(size) : null;

  component.forEach(({ rect }) => {
    const left = clamp(Math.floor(rect.x) - bounds.x, 0, bounds.width);
    const top = clamp(Math.floor(rect.y) - bounds.y, 0, bounds.height);
    const right = clamp(Math.ceil(rect.x + rect.width) - bounds.x, 0, bounds.width);
    const bottom = clamp(Math.ceil(rect.y + rect.height) - bounds.y, 0, bounds.height);
    const featherWidth = Math.min(rect.width, rect.height) * featherRatio;
    for (let y = top; y < bottom; y += 1) {
      for (let x = left; x < right; x += 1) {
        const offset = y * bounds.width + x;
        union[offset] = 1;
        if (featherWidths) featherWidths[offset] = Math.max(featherWidths[offset], featherWidth);
      }
    }
  });

  if (featherRatio === 0) return { union, featherWidths, distances: null };

  const maxDistance = bounds.width + bounds.height + 1;
  const distances = new Uint32Array(size);
  distances.fill(maxDistance);

  for (let y = 0; y < bounds.height; y += 1) {
    for (let x = 0; x < bounds.width; x += 1) {
      const offset = y * bounds.width + x;
      if (!union[offset]) {
        distances[offset] = 0;
        continue;
      }
      const leftDistance = x > 0 ? distances[offset - 1] : 0;
      const topDistance = y > 0 ? distances[offset - bounds.width] : 0;
      distances[offset] = Math.min(distances[offset], leftDistance + 1, topDistance + 1);
    }
  }

  for (let y = bounds.height - 1; y >= 0; y -= 1) {
    for (let x = bounds.width - 1; x >= 0; x -= 1) {
      const offset = y * bounds.width + x;
      if (!union[offset]) continue;
      const rightDistance = x + 1 < bounds.width ? distances[offset + 1] : 0;
      const bottomDistance = y + 1 < bounds.height ? distances[offset + bounds.width] : 0;
      distances[offset] = Math.min(distances[offset], rightDistance + 1, bottomDistance + 1);
    }
  }

  return { union, featherWidths, distances };
};

const getUnionAlpha = (mask, offset, featherRatio) => {
  if (!mask.union[offset]) return 0;
  if (featherRatio === 0) return 1;
  const featherWidth = mask.featherWidths[offset];
  if (featherWidth <= 0) return 1;
  return clamp((mask.distances[offset] - 0.5) / featherWidth, 0, 1);
};

const compositePixel = (output, generated, offset, maskAlpha) => {
  const sourceAlpha = output[offset + 3] / 255;
  const generatedAlpha = (generated[offset + 3] / 255) * maskAlpha;
  const outputAlpha = generatedAlpha + sourceAlpha * (1 - generatedAlpha);

  if (outputAlpha <= 0) {
    output[offset] = 0;
    output[offset + 1] = 0;
    output[offset + 2] = 0;
    output[offset + 3] = 0;
    return;
  }

  for (let channel = 0; channel < 3; channel += 1) {
    output[offset + channel] = (
      generated[offset + channel] * generatedAlpha
      + output[offset + channel] * sourceAlpha * (1 - generatedAlpha)
    ) / outputAlpha;
  }
  output[offset + 3] = outputAlpha * 255;
};

const compositeConnectedComponent = ({
  component,
  canvasWidth,
  canvasHeight,
  featherRatio,
  output,
  generatedPixels,
}) => {
  const bounds = getComponentBounds(component, canvasWidth, canvasHeight, featherRatio);
  const mask = createUnionFeatherMask(component, bounds, featherRatio);

  for (let localY = 0; localY < bounds.height; localY += 1) {
    for (let localX = 0; localX < bounds.width; localX += 1) {
      const localOffset = localY * bounds.width + localX;
      const maskAlpha = getUnionAlpha(mask, localOffset, featherRatio);
      if (maskAlpha === 0) continue;
      const canvasOffset = (bounds.y + localY) * canvasWidth + bounds.x + localX;
      compositePixel(output, generatedPixels, canvasOffset * 4, maskAlpha);
    }
  }

  const bufferPixels = bounds.width * bounds.height;
  return {
    ...bounds,
    bufferPixels,
    bufferBytes: bufferPixels * (featherRatio > 0 ? 9 : 1),
    scannedPixels: bufferPixels,
  };
};

const analyzeEraseRegionChange = ({
  drawableRegions,
  sourcePixels,
  generatedPixels,
  canvasWidth,
  canvasHeight,
}) => {
  let totalPixels = 0;
  let changedPixels = 0;
  let changedAnyPixels = 0;
  let totalDelta = 0;

  drawableRegions
    .filter(({ region }) => isTranslationRegionBackgroundCleanupInstruction(region.instruction))
    .forEach(({ rect }) => {
      const left = clamp(Math.floor(rect.x), 0, canvasWidth);
      const top = clamp(Math.floor(rect.y), 0, canvasHeight);
      const right = clamp(Math.ceil(rect.x + rect.width), left, canvasWidth);
      const bottom = clamp(Math.ceil(rect.y + rect.height), top, canvasHeight);

      for (let y = top; y < bottom; y += 1) {
        for (let x = left; x < right; x += 1) {
          const offset = (y * canvasWidth + x) * 4;
          const delta = (
            Math.abs(sourcePixels[offset] - generatedPixels[offset])
            + Math.abs(sourcePixels[offset + 1] - generatedPixels[offset + 1])
            + Math.abs(sourcePixels[offset + 2] - generatedPixels[offset + 2])
          );
          const alphaDelta = Math.abs(sourcePixels[offset + 3] - generatedPixels[offset + 3]);
          totalPixels += 1;
          totalDelta += delta;
          if (delta > 0 || alphaDelta > 0) {
            changedAnyPixels += 1;
          }
          if (delta >= 12 || alphaDelta >= 8) {
            changedPixels += 1;
          }
        }
      }
    });

  if (totalPixels <= 0) return { totalPixels, changedPixels, changedRatio: 0, meanDelta: 0 };
  return {
    totalPixels,
    changedPixels,
    changedAnyPixels,
    changedRatio: changedPixels / totalPixels,
    meanDelta: totalDelta / (totalPixels * 3),
  };
};

const assertEraseRegionsChanged = ({ drawableRegions, sourcePixels, generatedPixels, canvasWidth, canvasHeight }) => {
  if (!drawableRegions.some(({ region }) => isTranslationRegionBackgroundCleanupInstruction(region.instruction))) return;
  const stats = analyzeEraseRegionChange({
    drawableRegions,
    sourcePixels,
    generatedPixels,
    canvasWidth,
    canvasHeight,
  });
  if (stats.totalPixels > 0 && stats.changedAnyPixels <= 0) {
    const error = new Error('删除类区域修改未产生明显变化，已停止保存；请扩大框选范围或重新生成。');
    error.code = 'translation_region_erase_noop';
    error.details = stats;
    throw error;
  }
};

const hasTextRenderPlan = (region) => Boolean(resolveTranslationRegionTextRenderPlan(region));

export const compositeTranslationRegionEdit = async ({
  sourceUrl = '',
  generatedUrl = '',
  targetWidth,
  targetHeight,
  regions = [],
  featherRatio = DEFAULT_FEATHER_RATIO,
  loadImage = defaultLoadImage,
  signal,
} = {}) => {
  const sourceImage = await loadImage(sourceUrl, signal);
  let generatedImage;
  try {
    throwIfAborted(signal);
    const sourceDimensions = getNaturalDimensions(sourceImage, 'Source');
    const { width, height } = resolveCanvasDimensions({
      naturalWidth: sourceDimensions.width,
      naturalHeight: sourceDimensions.height,
      targetWidth,
      targetHeight,
    });
    generatedImage = await loadImage(generatedUrl, signal);
    throwIfAborted(signal);
    getNaturalDimensions(generatedImage, 'Generated');

    const drawableRegions = getDrawableRegions(regions, width, height);
    const { canvas, context } = createCanvas(width, height, 'Protected translation edit');
    const { context: generatedContext } = createCanvas(width, height, 'Generated translation edit');

    context.drawImage(sourceImage, 0, 0, width, height);
    generatedContext.drawImage(generatedImage, 0, 0, width, height);

    const sourceData = context.getImageData(0, 0, width, height);
    const generatedData = generatedContext.getImageData(0, 0, width, height);
    const output = sourceData.data;
    const generatedPixels = generatedData.data;
    const safeFeatherRatio = clamp(Number.isFinite(Number(featherRatio)) ? Number(featherRatio) : DEFAULT_FEATHER_RATIO, 0, 0.5);
    const components = createConnectedComponents(drawableRegions);
    assertEraseRegionsChanged({
      drawableRegions,
      sourcePixels: output,
      generatedPixels,
      canvasWidth: width,
      canvasHeight: height,
    });
    lastMaskStats = {
      canvasPixels: width * height,
      componentCount: components.length,
      totalBufferPixels: 0,
      totalBufferBytes: 0,
      totalScannedPixels: 0,
      components: [],
    };

    for (const component of components) {
      throwIfAborted(signal);
      const componentFeatherRatio = component.some(({ region }) => (
        hasTextRenderPlan(region) || isTranslationRegionEraseInstruction(region.instruction)
      ))
        ? 0
        : safeFeatherRatio;
      const componentStats = compositeConnectedComponent({
        component,
        canvasWidth: width,
        canvasHeight: height,
        featherRatio: componentFeatherRatio,
        output,
        generatedPixels,
      });
      lastMaskStats.components.push(componentStats);
      lastMaskStats.totalBufferPixels += componentStats.bufferPixels;
      lastMaskStats.totalBufferBytes += componentStats.bufferBytes;
      lastMaskStats.totalScannedPixels += componentStats.scannedPixels;
    }

    context.putImageData(sourceData, 0, 0);
    const blob = await exportPng(canvas, 'Protected translation edit');
    throwIfAborted(signal);
    return { blob, width, height };
  } finally {
    sourceImage?.close?.();
    generatedImage?.close?.();
  }
};
