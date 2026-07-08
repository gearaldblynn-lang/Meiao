const clamp = (value, min, max) => Math.min(max, Math.max(min, Number.isFinite(Number(value)) ? Number(value) : min));

const normalizeDimensions = ({ width, height }, fallback = { width: 1000, height: 1000 }) => ({
  width: Number.isFinite(Number(width)) && Number(width) > 0 ? Number(width) : fallback.width,
  height: Number.isFinite(Number(height)) && Number(height) > 0 ? Number(height) : fallback.height,
});

export const normalizeCornerBadgeRegion = (region) => {
  if (!region || typeof region !== 'object') return null;
  const widthRatio = clamp(region.widthRatio, 0, 1);
  const heightRatio = clamp(region.heightRatio, 0, 1);
  if (widthRatio <= 0 || heightRatio <= 0) return null;
  const xRatio = clamp(region.xRatio, 0, 1 - widthRatio);
  const yRatio = clamp(region.yRatio, 0, 1 - heightRatio);
  const logoId = String(region.logoId || '').trim();
  const logoIndex = Number.parseInt(String(region.logoIndex || ''), 10);
  return {
    version: 1,
    source: region.source === 'applied_to_all' ? 'applied_to_all' : 'manual',
    xRatio,
    yRatio,
    widthRatio,
    heightRatio,
    ...(logoId ? { logoId } : {}),
    ...(Number.isFinite(logoIndex) && logoIndex > 0 ? { logoIndex } : {}),
  };
};

export const rectToCornerBadgeRegion = ({
  x,
  y,
  width,
  height,
  canvasWidth,
  canvasHeight,
  source = 'manual',
}) => {
  const dims = normalizeDimensions({ width: canvasWidth, height: canvasHeight });
  return normalizeCornerBadgeRegion({
    version: 1,
    source,
    xRatio: Number(x) / dims.width,
    yRatio: Number(y) / dims.height,
    widthRatio: Number(width) / dims.width,
    heightRatio: Number(height) / dims.height,
  });
};

export const cornerBadgeRegionToRect = (region, dimensions) => {
  const normalized = normalizeCornerBadgeRegion(region);
  if (!normalized) return null;
  const dims = normalizeDimensions(dimensions);
  return {
    x: Math.round(normalized.xRatio * dims.width),
    y: Math.round(normalized.yRatio * dims.height),
    width: Math.round(normalized.widthRatio * dims.width),
    height: Math.round(normalized.heightRatio * dims.height),
  };
};

export const applyCornerBadgeRegionToMaterials = (materials, region, sourceId) => {
  const normalized = normalizeCornerBadgeRegion(region);
  if (!normalized) return materials;
  const geometry = {
    version: 1,
    source: 'applied_to_all',
    xRatio: normalized.xRatio,
    yRatio: normalized.yRatio,
    widthRatio: normalized.widthRatio,
    heightRatio: normalized.heightRatio,
  };
  return {
    ...materials,
    styleRef: (materials.styleRef || []).map((item) => {
      if (item.id === sourceId) return item;
      const existing = normalizeCornerBadgeRegion(item.cornerBadgeRegion);
      return {
        ...item,
        cornerBadgeRegion: {
          ...geometry,
          ...(existing?.logoId ? { logoId: existing.logoId } : {}),
          ...(existing?.logoIndex ? { logoIndex: existing.logoIndex } : {}),
        },
      };
    }),
  };
};

const fetchImageBlob = async (url, label) => {
  const safeUrl = String(url || '').trim();
  if (!safeUrl) throw new Error(`${label}地址为空`);
  const fetchDirect = async (targetUrl) => {
    const token = getSessionToken();
    const response = await fetch(targetUrl, {
      cache: 'no-cache',
      credentials: isSameOriginUrl(targetUrl) ? 'include' : 'same-origin',
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    if (!response.ok) throw new Error(`${label}下载失败：${response.status}`);
    return response.blob();
  };
  try {
    return await fetchDirect(safeUrl);
  } catch (error) {
    if (!shouldUseDownloadProxy(safeUrl)) throw error;
    return fetchDirect(`/api/assets/download-proxy?url=${encodeURIComponent(safeUrl)}`);
  }
};

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

const decodeImageFromBlob = async (blob, label) => {
  if (typeof createImageBitmap === 'function') return createImageBitmap(blob);
  if (typeof Image === 'undefined' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
    throw new Error(`${label}解码失败`);
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
      reject(new Error(`${label}加载失败`));
    };
    img.src = objectUrl;
  });
};

export const createCornerBadgeRegionGuide = async ({
  referenceUrl,
  region,
  referenceWidth,
  referenceHeight,
} = {}) => {
  const normalized = normalizeCornerBadgeRegion(region);
  if (!normalized) throw new Error('角标区域无效，请重新框选。');
  const image = await decodeImageFromBlob(await fetchImageBlob(referenceUrl, '需替换图片'), '需替换图片');
  const sourceWidth = referenceWidth || image.width || image.naturalWidth || 1000;
  const sourceHeight = referenceHeight || image.height || image.naturalHeight || 1000;
  const maxEdge = 1600;
  const scale = Math.min(1, maxEdge / Math.max(sourceWidth, sourceHeight));
  const canvasWidth = Math.max(1, Math.round(sourceWidth * scale));
  const canvasHeight = Math.max(1, Math.round(sourceHeight * scale));
  const rect = cornerBadgeRegionToRect(normalized, { width: canvasWidth, height: canvasHeight });

  const canvas = document.createElement('canvas');
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx || !rect) throw new Error('角标区域示意图生成失败');
  ctx.drawImage(image, 0, 0, canvasWidth, canvasHeight);
  ctx.save();
  ctx.globalAlpha = 0.16;
  ctx.fillStyle = '#ef4444';
  ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
  ctx.restore();
  ctx.save();
  ctx.strokeStyle = '#ef4444';
  ctx.lineWidth = Math.max(3, Math.round(Math.min(canvasWidth, canvasHeight) * 0.006));
  ctx.setLineDash([ctx.lineWidth * 3, ctx.lineWidth * 1.5]);
  ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
  ctx.restore();

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png', 0.95));
  if (!blob) throw new Error('角标区域示意图导出失败');
  return { blob, rect, width: canvasWidth, height: canvasHeight, region: normalized };
};
