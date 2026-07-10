import { logoReplaceRegionToRect, normalizeLogoReplaceRegion } from './logoReplaceRegion.mjs';

const clamp = (value, min, max) => Math.min(max, Math.max(min, Number.isFinite(Number(value)) ? Number(value) : min));

const shouldUseDownloadProxy = (url) => {
  try {
    if (typeof window === 'undefined' || !window.location?.href) return false;
    const parsed = new URL(String(url || ''), window.location.href);
    if (!['http:', 'https:'].includes(parsed.protocol)) return false;
    return parsed.origin !== window.location.origin;
  } catch {
    return false;
  }
};

const getSessionToken = () => {
  try {
    return window.localStorage?.getItem('MEIAO_INTERNAL_SESSION_TOKEN') || '';
  } catch {
    return '';
  }
};

const isSameOriginUrl = (url) => {
  try {
    if (typeof window === 'undefined' || !window.location?.href) return false;
    return new URL(String(url || ''), window.location.href).origin === window.location.origin;
  } catch {
    return false;
  }
};

const fetchImageBlob = async (url, label, signal) => {
  const safeUrl = String(url || '').trim();
  if (!safeUrl) throw new Error(`${label} URL is empty`);
  const fetchDirect = async (targetUrl) => {
    const token = getSessionToken();
    const response = await fetch(targetUrl, {
      cache: 'no-cache',
      credentials: isSameOriginUrl(targetUrl) ? 'include' : 'same-origin',
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      signal,
    });
    if (!response.ok) throw new Error(`${label} download failed: ${response.status}`);
    return response.blob();
  };
  try {
    return await fetchDirect(safeUrl);
  } catch (error) {
    if (!shouldUseDownloadProxy(safeUrl)) throw error;
    return fetchDirect(`/api/assets/download-proxy?url=${encodeURIComponent(safeUrl)}`);
  }
};

const decodeImageFromBlob = async (blob, label) => {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(blob);
    } catch {
      // Fall through to HTMLImageElement decoding.
    }
  }
  if (typeof Image === 'undefined' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
    throw new Error(`${label} decode failed`);
  }
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL?.(objectUrl);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL?.(objectUrl);
      reject(new Error(`${label} load failed`));
    };
    img.src = objectUrl;
  });
};

const loadImage = async (url, label, signal) => decodeImageFromBlob(await fetchImageBlob(url, label, signal), label);

export const expandRect = ({
  rect,
  width,
  height,
  paddingRatio = 0,
}) => {
  const padding = Math.round(Math.max(rect.width, rect.height) * paddingRatio);
  const x = clamp(Math.floor(rect.x - padding), 0, Math.max(0, width - 1));
  const y = clamp(Math.floor(rect.y - padding), 0, Math.max(0, height - 1));
  const right = clamp(Math.ceil(rect.x + rect.width + padding), x + 1, width);
  const bottom = clamp(Math.ceil(rect.y + rect.height + padding), y + 1, height);
  return {
    x,
    y,
    width: right - x,
    height: bottom - y,
  };
};

export const pickGuardedLogoReplacePixel = ({
  x,
  y,
  protectedRect,
  original,
  generated,
}) => {
  const inside = x >= protectedRect.x
    && x < protectedRect.x + protectedRect.width
    && y >= protectedRect.y
    && y < protectedRect.y + protectedRect.height;
  return inside ? generated : original;
};

const normalizeCanvasRect = (rect, dimensions) => {
  if (!rect || typeof rect !== 'object') return null;
  const targetWidth = Number(dimensions?.width);
  const targetHeight = Number(dimensions?.height);
  if (![targetWidth, targetHeight].every(Number.isFinite) || targetWidth <= 0 || targetHeight <= 0) return null;
  const x = clamp(Math.round(Number(rect.x) || 0), 0, Math.max(0, targetWidth - 1));
  const y = clamp(Math.round(Number(rect.y) || 0), 0, Math.max(0, targetHeight - 1));
  const right = clamp(Math.round(Number(rect.x) + Number(rect.width || 0)), x + 1, targetWidth);
  const bottom = clamp(Math.round(Number(rect.y) + Number(rect.height || 0)), y + 1, targetHeight);
  return {
    x,
    y,
    width: Math.max(1, right - x),
    height: Math.max(1, bottom - y),
  };
};

const isInsideRect = (x, y, rect) => (
  rect
  && x >= rect.x
  && y >= rect.y
  && x < rect.x + rect.width
  && y < rect.y + rect.height
);

const normalizeOverlayRect = (rect, dimensions) => {
  if (!rect || typeof rect !== 'object') return null;
  const xRatio = Number(rect.xRatio);
  const yRatio = Number(rect.yRatio);
  const widthRatio = Number(rect.widthRatio);
  const heightRatio = Number(rect.heightRatio);
  const targetWidth = Number(dimensions?.width);
  const targetHeight = Number(dimensions?.height);
  if (
    [xRatio, yRatio, widthRatio, heightRatio, targetWidth, targetHeight].every(Number.isFinite)
    && targetWidth > 0
    && targetHeight > 0
    && widthRatio > 0
    && heightRatio > 0
  ) {
    return {
      x: Math.round(xRatio * targetWidth),
      y: Math.round(yRatio * targetHeight),
      width: Math.round(widthRatio * targetWidth),
      height: Math.round(heightRatio * targetHeight),
    };
  }
  const x = Number(rect.x);
  const y = Number(rect.y);
  const width = Number(rect.width);
  const height = Number(rect.height);
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return null;
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height),
  };
};

const exportCanvasBlob = async (canvas, label) => {
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png', 0.95));
  if (!blob) throw new Error(`${label} export failed`);
  return blob;
};

const normalizeOverlayBlendMode = (value) => {
  const normalized = String(value || '').trim();
  if (normalized === 'fabric_blend' || normalized === 'auto') return normalized;
  return 'exact';
};

const sampleRectLuminance = (ctx, rect, fallback = 255) => {
  if (!rect || typeof ctx.getImageData !== 'function') return fallback;
  const sampleWidth = Math.max(1, Math.min(16, Math.round(rect.width)));
  const sampleHeight = Math.max(1, Math.min(16, Math.round(rect.height)));
  const sampleX = Math.max(0, Math.round(rect.x + (rect.width - sampleWidth) / 2));
  const sampleY = Math.max(0, Math.round(rect.y + (rect.height - sampleHeight) / 2));
  let imageData;
  try {
    imageData = ctx.getImageData(sampleX, sampleY, sampleWidth, sampleHeight);
  } catch {
    return fallback;
  }
  const { data } = imageData || {};
  if (!data?.length) return fallback;
  let total = 0;
  let count = 0;
  for (let index = 0; index < data.length; index += 4) {
    if (data[index + 3] < 32) continue;
    total += (0.2126 * data[index]) + (0.7152 * data[index + 1]) + (0.0722 * data[index + 2]);
    count += 1;
  }
  return count ? total / count : fallback;
};

const luminance = (r, g, b) => (0.2126 * r) + (0.7152 * g) + (0.0722 * b);

const sampleImageDataRingColor = ({
  imageData,
  rect,
  ringSize = 3,
  fallback = [24, 24, 24],
}) => {
  const { data, width, height } = imageData || {};
  if (!data || !width || !height || !rect) return fallback;
  const safeRect = normalizeCanvasRect(rect, { width, height });
  if (!safeRect) return fallback;
  const outerX = clamp(safeRect.x - ringSize, 0, Math.max(0, width - 1));
  const outerY = clamp(safeRect.y - ringSize, 0, Math.max(0, height - 1));
  const outerRight = clamp(safeRect.x + safeRect.width + ringSize, outerX + 1, width);
  const outerBottom = clamp(safeRect.y + safeRect.height + ringSize, outerY + 1, height);
  let r = 0;
  let g = 0;
  let b = 0;
  let count = 0;

  for (let y = outerY; y < outerBottom; y += 1) {
    for (let x = outerX; x < outerRight; x += 1) {
      if (isInsideRect(x, y, safeRect)) continue;
      const offset = (y * width + x) * 4;
      if (data[offset + 3] < 32) continue;
      r += data[offset];
      g += data[offset + 1];
      b += data[offset + 2];
      count += 1;
    }
  }

  if (!count) return fallback;
  return [Math.round(r / count), Math.round(g / count), Math.round(b / count)];
};

export const scrubLogoResidualPixels = ({
  imageData,
  rect,
  paddingRatio = 0,
  minLuminanceContrast = 64,
  minColorContrast = 64,
} = {}) => {
  const { data, width, height } = imageData || {};
  if (!data || !width || !height || !rect) return 0;
  const baseRect = normalizeCanvasRect(rect, { width, height });
  if (!baseRect) return 0;
  const safeRect = paddingRatio > 0
    ? expandRect({ rect: baseRect, width, height, paddingRatio })
    : baseRect;
  if (!safeRect) return 0;
  const [baseR, baseG, baseB] = sampleImageDataRingColor({
    imageData,
    rect: safeRect,
    ringSize: Math.max(2, Math.round(Math.min(safeRect.width, safeRect.height) * 0.4)),
  });
  const baseLum = luminance(baseR, baseG, baseB);
  let changed = 0;

  for (let y = safeRect.y; y < safeRect.y + safeRect.height; y += 1) {
    for (let x = safeRect.x; x < safeRect.x + safeRect.width; x += 1) {
      const offset = (y * width + x) * 4;
      if (data[offset + 3] < 32) continue;
      const lumDiff = Math.abs(luminance(data[offset], data[offset + 1], data[offset + 2]) - baseLum);
      const colorDiff = Math.max(
        Math.abs(data[offset] - baseR),
        Math.abs(data[offset + 1] - baseG),
        Math.abs(data[offset + 2] - baseB),
      );
      if (lumDiff < minLuminanceContrast && colorDiff < minColorContrast) continue;
      data[offset] = baseR;
      data[offset + 1] = baseG;
      data[offset + 2] = baseB;
      data[offset + 3] = 255;
      changed += 1;
    }
  }

  return changed;
};

const scrubLogoResidualsInCanvas = (ctx, rect, width, height, paddingRatio = 0) => {
  if (!rect || typeof ctx.getImageData !== 'function' || typeof ctx.putImageData !== 'function') return;
  const safeRect = normalizeCanvasRect(rect, { width, height });
  if (!safeRect) return;
  const imageData = ctx.getImageData(0, 0, width, height);
  const changed = scrubLogoResidualPixels({ imageData, rect: safeRect, paddingRatio });
  if (changed > 0) ctx.putImageData(imageData, 0, 0);
};

const sampleImageDataEdgeColor = ({ imageData, rect }) => {
  const { data, width, height } = imageData || {};
  if (!data || !width || !height || !rect) return null;
  const x0 = clamp(Math.floor(rect.x), 0, Math.max(0, width - 1));
  const y0 = clamp(Math.floor(rect.y), 0, Math.max(0, height - 1));
  const x1 = clamp(Math.ceil(rect.x + rect.width - 1), x0, width - 1);
  const y1 = clamp(Math.ceil(rect.y + rect.height - 1), y0, height - 1);
  const offsets = [];
  for (let x = x0; x <= x1; x += 1) {
    offsets.push((y0 * width + x) * 4);
    offsets.push((y1 * width + x) * 4);
  }
  for (let y = y0 + 1; y < y1; y += 1) {
    offsets.push((y * width + x0) * 4);
    offsets.push((y * width + x1) * 4);
  }
  const samples = offsets.filter((offset) => data[offset + 3] > 32);
  if (!samples.length) return null;
  const sum = samples.reduce((acc, offset) => {
    acc.r += data[offset];
    acc.g += data[offset + 1];
    acc.b += data[offset + 2];
    return acc;
  }, { r: 0, g: 0, b: 0 });
  return {
    r: sum.r / samples.length,
    g: sum.g / samples.length,
    b: sum.b / samples.length,
  };
};

const applyLogoOverlayBlend = (ctx, blendMode, rect) => {
  const normalized = normalizeOverlayBlendMode(blendMode);
  if (normalized === 'exact') return;
  if (normalized === 'auto' && sampleRectLuminance(ctx, rect) >= 96) return;
  ctx.globalAlpha = 0.9;
  ctx.filter = 'brightness(0.92) contrast(0.96) blur(0.35px)';
};

const drawGeneratedCleanupBase = (ctx, generatedImage, clipRect, width, height) => {
  if (!clipRect) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(clipRect.x, clipRect.y, clipRect.width, clipRect.height);
  ctx.clip();
  ctx.drawImage(generatedImage, 0, 0, width, height);
  ctx.restore();
};

const applyGeneratedCleanupContentMask = ({
  ctx,
  originalImage,
  generatedImage,
  clipRect,
  width,
  height,
  minLuminanceContrast = 34,
  minColorContrast = 34,
}) => {
  if (!clipRect || typeof ctx.getImageData !== 'function' || typeof ctx.putImageData !== 'function') {
    drawGeneratedCleanupBase(ctx, generatedImage, clipRect, width, height);
    return;
  }
  const x = clamp(Math.floor(clipRect.x), 0, Math.max(0, width - 1));
  const y = clamp(Math.floor(clipRect.y), 0, Math.max(0, height - 1));
  const right = clamp(Math.ceil(clipRect.x + clipRect.width), x + 1, width);
  const bottom = clamp(Math.ceil(clipRect.y + clipRect.height), y + 1, height);
  const rect = { x, y, width: right - x, height: bottom - y };

  const scratch = document.createElement('canvas');
  scratch.width = width;
  scratch.height = height;
  const scratchCtx = scratch.getContext('2d');
  if (!scratchCtx) {
    drawGeneratedCleanupBase(ctx, generatedImage, clipRect, width, height);
    return;
  }

  scratchCtx.drawImage(originalImage, 0, 0, width, height);
  const originalData = scratchCtx.getImageData(rect.x, rect.y, rect.width, rect.height);
  scratchCtx.drawImage(generatedImage, 0, 0, width, height);
  const generatedData = scratchCtx.getImageData(rect.x, rect.y, rect.width, rect.height);
  const outputData = ctx.getImageData(rect.x, rect.y, rect.width, rect.height);
  const base = sampleImageDataEdgeColor({ imageData: originalData, rect: { x: 0, y: 0, width: rect.width, height: rect.height } });
  if (!base) {
    drawGeneratedCleanupBase(ctx, generatedImage, clipRect, width, height);
    return;
  }
  const baseLum = luminance(base.r, base.g, base.b);
  let changedPixels = 0;
  for (let offset = 0; offset < originalData.data.length; offset += 4) {
    if (originalData.data[offset + 3] < 32) continue;
    const lumDiff = Math.abs(luminance(
      originalData.data[offset],
      originalData.data[offset + 1],
      originalData.data[offset + 2],
    ) - baseLum);
    const colorDiff = Math.max(
      Math.abs(originalData.data[offset] - base.r),
      Math.abs(originalData.data[offset + 1] - base.g),
      Math.abs(originalData.data[offset + 2] - base.b),
    );
    if (lumDiff < minLuminanceContrast && colorDiff < minColorContrast) continue;
    outputData.data[offset] = generatedData.data[offset];
    outputData.data[offset + 1] = generatedData.data[offset + 1];
    outputData.data[offset + 2] = generatedData.data[offset + 2];
    outputData.data[offset + 3] = generatedData.data[offset + 3];
    changedPixels += 1;
  }
  if (changedPixels) {
    ctx.putImageData(outputData, rect.x, rect.y);
    return;
  }
  drawGeneratedCleanupBase(ctx, generatedImage, clipRect, width, height);
};

export const computeLogoOverlayItem = ({
  logoUrl,
  logoRect,
  dimensions,
} = {}) => {
  const item = {
    logoUrl: String(logoUrl || '').trim(),
    rect: normalizeOverlayRect(logoRect, dimensions),
  };
  return item.logoUrl && item.rect ? item : null;
};

const normalizeGuardItem = ({
  region,
  logoOverlayUrl,
  logoOverlayRect,
  cleanupRect,
} = {}, dimensions) => {
  const normalizedRegion = normalizeLogoReplaceRegion(region);
  if (!normalizedRegion) return null;
  const rect = logoReplaceRegionToRect(normalizedRegion, dimensions);
  if (!rect) return null;
  const logoOverlayItem = computeLogoOverlayItem({
    logoUrl: logoOverlayUrl,
    logoRect: logoOverlayRect,
    dimensions,
  });
  const cleanupItem = normalizeOverlayRect(cleanupRect, dimensions);
  const generatedClipRect = cleanupItem || rect;
  return {
    region: normalizedRegion,
    rect,
    protectedRect: expandRect({ rect, ...dimensions }),
    logoOverlayItem,
    cleanupItem,
    generatedClipRect,
  };
};

/**
 * @param {{
 *   originalUrl?: string,
 *   generatedUrl?: string,
 *   items?: Array<{
 *     region?: unknown,
 *     logoOverlayUrl?: string,
 *     logoOverlayRect?: Record<string, unknown>,
 *     cleanupRect?: Record<string, unknown>,
 *   }>,
 *   originalWidth?: number,
 *   originalHeight?: number,
 *   overlayBlendMode?: 'exact' | 'fabric_blend' | 'auto',
 *   useGeneratedCleanupBase?: boolean,
 *   cleanupMode?: 'rect' | 'content_mask',
 *   cleanupScrubPaddingRatio?: number,
 *   signal?: AbortSignal,
 * }} options
 */
export const createGuardedMultiLogoReplaceResultBlob = async ({
  originalUrl,
  generatedUrl,
  items,
  originalWidth,
  originalHeight,
  overlayBlendMode = 'exact',
  useGeneratedCleanupBase = true,
  cleanupMode = 'rect',
  cleanupScrubPaddingRatio = 0,
  signal,
} = {}) => {
  const originalImage = await loadImage(originalUrl, 'Original image', signal);
  const generatedImage = await loadImage(generatedUrl, 'Generated image', signal);
  const sourceWidth = originalWidth || originalImage.width || originalImage.naturalWidth || generatedImage.width || generatedImage.naturalWidth || 1000;
  const sourceHeight = originalHeight || originalImage.height || originalImage.naturalHeight || generatedImage.height || generatedImage.naturalHeight || 1000;
  const width = Math.max(1, Math.round(sourceWidth));
  const height = Math.max(1, Math.round(sourceHeight));
  const guardItems = (Array.isArray(items) ? items : [])
    .map((item) => normalizeGuardItem(item, { width, height }))
    .filter(Boolean);
  if (guardItems.length === 0) throw new Error('Multi logo guard regions are invalid');

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Multi logo guard canvas failed');
  ctx.drawImage(originalImage, 0, 0, width, height);

  if (useGeneratedCleanupBase) {
    guardItems.forEach((item) => {
      const baseClipRect = item.cleanupItem || (item.logoOverlayItem ? item.rect : item.protectedRect);
      const clipRect = cleanupScrubPaddingRatio > 0
        ? expandRect({ rect: baseClipRect, width, height, paddingRatio: cleanupScrubPaddingRatio })
        : baseClipRect;
      if (cleanupMode === 'content_mask') {
        applyGeneratedCleanupContentMask({
          ctx,
          originalImage,
          generatedImage,
          clipRect,
          width,
          height,
        });
      } else {
        drawGeneratedCleanupBase(ctx, generatedImage, clipRect, width, height);
      }
      scrubLogoResidualsInCanvas(ctx, clipRect, width, height, cleanupScrubPaddingRatio);
    });
  }

  const overlayItems = guardItems
    .map((item) => item.logoOverlayItem)
    .filter(Boolean);
  const logoImages = await Promise.all(overlayItems.map((item) => loadImage(item.logoUrl, 'Exact replacement logo overlay', signal)));
  logoImages.forEach((logoImage, index) => {
    const overlay = overlayItems[index];
    ctx.save();
    applyLogoOverlayBlend(ctx, overlayBlendMode, overlay.rect);
    ctx.drawImage(logoImage, overlay.rect.x, overlay.rect.y, overlay.rect.width, overlay.rect.height);
    ctx.restore();
  });

  return {
    blob: await exportCanvasBlob(canvas, 'Multi logo guard'),
    rects: guardItems.map((item) => item.rect),
    protectedRects: guardItems.map((item) => item.protectedRect),
    logoOverlayItems: overlayItems,
    width,
    height,
  };
};
