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

const fetchImageBlob = async (url, label) => {
  const safeUrl = String(url || '').trim();
  if (!safeUrl) throw new Error(`${label} URL is empty`);
  const fetchDirect = async (targetUrl) => {
    const token = getSessionToken();
    const response = await fetch(targetUrl, {
      cache: 'no-cache',
      credentials: isSameOriginUrl(targetUrl) ? 'include' : 'same-origin',
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
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

const loadImage = async (url, label) => decodeImageFromBlob(await fetchImageBlob(url, label), label);

export const computeContainedLogoRect = ({
  regionRect,
  logoWidth,
  logoHeight,
  paddingRatio = 0,
}) => {
  const padding = Math.round(Math.min(regionRect.width, regionRect.height) * paddingRatio);
  const maxWidth = Math.max(1, regionRect.width - padding * 2);
  const maxHeight = Math.max(1, regionRect.height - padding * 2);
  const ratio = Math.max(0.01, Number(logoWidth || 1) / Math.max(1, Number(logoHeight || 1)));
  let width = maxWidth;
  let height = width / ratio;
  if (height > maxHeight) {
    height = maxHeight;
    width = height * ratio;
  }
  width = Math.max(1, Math.round(width));
  height = Math.max(1, Math.round(height));
  return {
    x: Math.round(regionRect.x + (regionRect.width - width) / 2),
    y: Math.round(regionRect.y + (regionRect.height - height) / 2),
    width,
    height,
  };
};

export const computeAreaMatchedLogoRect = ({
  regionRect,
  logoWidth,
  logoHeight,
  scaleRatio = 1,
}) => {
  const safeScale = Number.isFinite(Number(scaleRatio)) && Number(scaleRatio) > 0 ? Math.min(1, Number(scaleRatio)) : 1;
  const scaledRegionRect = safeScale < 1
    ? {
        x: Math.round(regionRect.x + (regionRect.width * (1 - safeScale)) / 2),
        y: Math.round(regionRect.y + (regionRect.height * (1 - safeScale)) / 2),
        width: Math.max(1, Math.round(regionRect.width * safeScale)),
        height: Math.max(1, Math.round(regionRect.height * safeScale)),
      }
    : regionRect;
  return computeContainedLogoRect({
    regionRect: scaledRegionRect,
    logoWidth,
    logoHeight,
  });
};

const rectToRatios = (rect, dimensions) => ({
  ...rect,
  xRatio: rect.x / Math.max(1, dimensions.width),
  yRatio: rect.y / Math.max(1, dimensions.height),
  widthRatio: rect.width / Math.max(1, dimensions.width),
  heightRatio: rect.height / Math.max(1, dimensions.height),
});

const drawRegionFrame = (ctx, rect, dimensions, index) => {
  if (typeof ctx.strokeRect !== 'function') return;
  ctx.save();
  ctx.strokeStyle = index % 2 === 0 ? '#ef4444' : '#2563eb';
  ctx.lineWidth = Math.max(3, Math.round(Math.min(dimensions.width, dimensions.height) * 0.006));
  if (typeof ctx.setLineDash === 'function') ctx.setLineDash([ctx.lineWidth * 3, ctx.lineWidth * 1.5]);
  ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
  ctx.restore();
};

const luminance = (r, g, b) => (0.2126 * r) + (0.7152 * g) + (0.0722 * b);

const sampleOpaqueRingColorFromImageData = ({
  imageData,
  rect,
  ringSize = 12,
  fallback = [18, 18, 18],
}) => {
  const { data, width, height } = imageData || {};
  if (!data || !width || !height) return fallback;
  const minX = clamp(Math.floor(rect.x - ringSize), 0, width - 1);
  const minY = clamp(Math.floor(rect.y - ringSize), 0, height - 1);
  const maxX = clamp(Math.ceil(rect.x + rect.width + ringSize), 0, width - 1);
  const maxY = clamp(Math.ceil(rect.y + rect.height + ringSize), 0, height - 1);
  const innerMinX = clamp(Math.floor(rect.x), 0, width - 1);
  const innerMinY = clamp(Math.floor(rect.y), 0, height - 1);
  const innerMaxX = clamp(Math.ceil(rect.x + rect.width), 0, width - 1);
  const innerMaxY = clamp(Math.ceil(rect.y + rect.height), 0, height - 1);
  let r = 0;
  let g = 0;
  let b = 0;
  let count = 0;

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      if (x >= innerMinX && x <= innerMaxX && y >= innerMinY && y <= innerMaxY) continue;
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

const expandContentRect = ({ rect, regionRect, paddingRatio = 0.16 }) => {
  const padding = Math.max(1, Math.round(Math.max(rect.width, rect.height) * paddingRatio));
  const regionRight = regionRect.x + regionRect.width;
  const regionBottom = regionRect.y + regionRect.height;
  const x = clamp(Math.floor(rect.x - padding), regionRect.x, Math.max(regionRect.x, regionRight - 1));
  const y = clamp(Math.floor(rect.y - padding), regionRect.y, Math.max(regionRect.y, regionBottom - 1));
  const right = clamp(Math.ceil(rect.x + rect.width + padding), x + 1, regionRight);
  const bottom = clamp(Math.ceil(rect.y + rect.height + padding), y + 1, regionBottom);
  return {
    x,
    y,
    width: right - x,
    height: bottom - y,
  };
};

export const findLogoContentRectInRegion = ({
  imageData,
  regionRect,
  minContrast = 34,
} = {}) => {
  const { data, width, height } = imageData || {};
  if (!data || !width || !height || !regionRect) return regionRect || null;
  const x0 = clamp(Math.floor(regionRect.x), 0, Math.max(0, width - 1));
  const y0 = clamp(Math.floor(regionRect.y), 0, Math.max(0, height - 1));
  const x1 = clamp(Math.ceil(regionRect.x + regionRect.width), x0 + 1, width);
  const y1 = clamp(Math.ceil(regionRect.y + regionRect.height), y0 + 1, height);
  const [baseR, baseG, baseB] = sampleOpaqueRingColorFromImageData({
    imageData,
    rect: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 },
    ringSize: Math.max(4, Math.round(Math.min(x1 - x0, y1 - y0) * 0.35)),
  });
  const baseLum = luminance(baseR, baseG, baseB);
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = -1;
  let maxY = -1;
  let count = 0;

  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const offset = (y * width + x) * 4;
      if (data[offset + 3] < 48) continue;
      const diff = Math.abs(luminance(data[offset], data[offset + 1], data[offset + 2]) - baseLum);
      const colorDiff = Math.max(
        Math.abs(data[offset] - baseR),
        Math.abs(data[offset + 1] - baseG),
        Math.abs(data[offset + 2] - baseB),
      );
      if (diff < minContrast && colorDiff < minContrast) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      count += 1;
    }
  }

  const regionArea = Math.max(1, (x1 - x0) * (y1 - y0));
  if (!count || count / regionArea > 0.55) return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
  return expandContentRect({
    rect: { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 },
    regionRect: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 },
  });
};

export const sampleOpaqueRingColor = ({
  imageData,
  rect,
  ringSize = 12,
  fallback = [18, 18, 18],
}) => sampleOpaqueRingColorFromImageData({ imageData, rect, ringSize, fallback });

export const normalizeLogoReplacePreviewItem = ({
  region,
  logoUrl,
} = {}) => {
  const normalizedRegion = normalizeLogoReplaceRegion(region);
  const normalizedLogoUrl = String(logoUrl || '').trim();
  return normalizedRegion && normalizedLogoUrl
    ? { region: normalizedRegion, logoUrl: normalizedLogoUrl }
    : null;
};

export const normalizeLogoReplacePreviewItems = (items = []) => (Array.isArray(items) ? items : [])
  .map(normalizeLogoReplacePreviewItem)
  .filter(Boolean);

/**
 * @param {{
 *   referenceUrl?: string,
 *   items?: Array<{ region?: unknown, logoUrl?: string }>,
 *   referenceWidth?: number,
 *   referenceHeight?: number,
 *   useSelectedRegionAsLogoBounds?: boolean,
 *   drawCleanupFill?: boolean,
 *   logoScaleRatio?: number,
 * }} options
 */
export const createMultiLogoReplacePreviewBlob = async ({
  referenceUrl,
  items,
  referenceWidth,
  referenceHeight,
  useSelectedRegionAsLogoBounds = false,
  drawCleanupFill = true,
  logoScaleRatio = 1,
} = {}) => {
  const previewItems = normalizeLogoReplacePreviewItems(items);
  if (previewItems.length === 0) throw new Error('Multi logo replacement regions are invalid');
  const referenceImage = await loadImage(referenceUrl, 'Reference image');
  const sourceWidth = referenceWidth || referenceImage.width || referenceImage.naturalWidth || 1000;
  const sourceHeight = referenceHeight || referenceImage.height || referenceImage.naturalHeight || 1000;
  const maxEdge = 1600;
  const scale = Math.min(1, maxEdge / Math.max(sourceWidth, sourceHeight));
  const canvasWidth = Math.max(1, Math.round(sourceWidth * scale));
  const canvasHeight = Math.max(1, Math.round(sourceHeight * scale));

  const canvas = document.createElement('canvas');
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Multi logo preview canvas failed');
  ctx.drawImage(referenceImage, 0, 0, canvasWidth, canvasHeight);
  const imageData = ctx.getImageData(0, 0, canvasWidth, canvasHeight);
  const logoImages = await Promise.all(previewItems.map((item) => loadImage(item.logoUrl, 'Replacement logo')));
  const results = [];

  previewItems.forEach((item, index) => {
    const regionRect = logoReplaceRegionToRect(item.region, { width: canvasWidth, height: canvasHeight });
    if (!regionRect) return;
    const detectedCleanupRect = findLogoContentRectInRegion({ imageData, regionRect }) || regionRect;
    const cleanupRect = detectedCleanupRect;
    const [r, g, b] = sampleOpaqueRingColor({
      imageData,
      rect: cleanupRect,
      ringSize: Math.max(4, Math.round(Math.min(cleanupRect.width, cleanupRect.height) * 0.35)),
    });

    if (drawCleanupFill) {
      ctx.save();
      ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
      ctx.fillRect(cleanupRect.x, cleanupRect.y, cleanupRect.width, cleanupRect.height);
      ctx.restore();
    }
    drawRegionFrame(ctx, regionRect, { width: canvasWidth, height: canvasHeight }, index);

    const logoImage = logoImages[index];
    const logoBoundsRect = useSelectedRegionAsLogoBounds ? regionRect : cleanupRect;
    const logoRect = (useSelectedRegionAsLogoBounds ? computeContainedLogoRect : computeAreaMatchedLogoRect)({
      regionRect: logoBoundsRect,
      logoWidth: logoImage.width || logoImage.naturalWidth || 1,
      logoHeight: logoImage.height || logoImage.naturalHeight || 1,
      scaleRatio: logoScaleRatio,
    });
    results.push({
      rect: regionRect,
      cleanupRect: rectToRatios(cleanupRect, { width: canvasWidth, height: canvasHeight }),
      logoRect: rectToRatios(logoRect, { width: canvasWidth, height: canvasHeight }),
      region: item.region,
      logoUrl: item.logoUrl,
    });
  });

  if (results.length === 0) throw new Error('Multi logo replacement regions are invalid');
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png', 0.95));
  if (!blob) throw new Error('Multi logo preview export failed');
  return {
    blob,
    rects: results.map((item) => item.rect),
    cleanupRects: results.map((item) => item.cleanupRect),
    logoRects: results.map((item) => item.logoRect),
    items: results,
    width: canvasWidth,
    height: canvasHeight,
  };
};
