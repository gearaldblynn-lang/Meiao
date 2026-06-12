export const LOGO_PLACEMENT_RATIOS = [
  { ratio: '1:1', width: 1000, height: 1000, label: '1:1' },
  { ratio: '3:4', width: 900, height: 1200, label: '3:4' },
  { ratio: '4:3', width: 1200, height: 900, label: '4:3' },
  { ratio: '9:16', width: 900, height: 1600, label: '9:16' },
  { ratio: '16:9', width: 1600, height: 900, label: '16:9' },
];

const DEFAULT_TEMPLATE = {
  anchorX: 'right',
  anchorY: 'top',
  offsetX: 0.06,
  offsetY: 0.06,
  widthRatio: 0.16,
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));

const normalizeDimensions = ({ width, height }, fallback = { width: 1000, height: 1000 }) => ({
  width: Number.isFinite(Number(width)) && Number(width) > 0 ? Number(width) : fallback.width,
  height: Number.isFinite(Number(height)) && Number(height) > 0 ? Number(height) : fallback.height,
});

const ratioValue = ({ width, height }) => {
  const dims = normalizeDimensions({ width, height });
  return dims.width / dims.height;
};

export const resolveNearestLogoPlacementRatio = ({ width, height }) => {
  const current = ratioValue({ width, height });
  return LOGO_PLACEMENT_RATIOS
    .map((item) => ({ item, distance: Math.abs((item.width / item.height) - current) }))
    .sort((a, b) => a.distance - b.distance)[0]?.item.ratio || '1:1';
};

export const createDefaultLogoPlacement = ({ width = 1000, height = 1000, logoRatio = 2 } = {}) => {
  const baseRatio = resolveNearestLogoPlacementRatio({ width, height });
  const templates = Object.fromEntries(
    LOGO_PLACEMENT_RATIOS.map((item) => [item.ratio, { ...DEFAULT_TEMPLATE }]),
  );
  return {
    version: 1,
    baseRatio,
    logoRatio: Number.isFinite(Number(logoRatio)) && Number(logoRatio) > 0 ? Number(logoRatio) : 2,
    templates,
  };
};

const inferAnchorX = (rect, canvasWidth) => {
  const centerX = rect.x + rect.width / 2;
  if (centerX < canvasWidth / 3) return 'left';
  if (centerX > canvasWidth * 2 / 3) return 'right';
  return 'center';
};

const inferAnchorY = (rect, canvasHeight) => {
  const centerY = rect.y + rect.height / 2;
  if (centerY < canvasHeight / 3) return 'top';
  if (centerY > canvasHeight * 2 / 3) return 'bottom';
  return 'center';
};

const rectToTemplate = ({ x, y, width, height, canvasWidth, canvasHeight }) => {
  const dims = normalizeDimensions({ width: canvasWidth, height: canvasHeight });
  const safeRect = {
    x: clamp(Number(x), 0, dims.width),
    y: clamp(Number(y), 0, dims.height),
    width: clamp(Number(width), 1, dims.width),
    height: clamp(Number(height), 1, dims.height),
  };
  const shortEdge = Math.max(1, Math.min(dims.width, dims.height));
  const anchorX = inferAnchorX(safeRect, dims.width);
  const anchorY = inferAnchorY(safeRect, dims.height);
  const offsetX = anchorX === 'right'
    ? (dims.width - safeRect.x - safeRect.width) / shortEdge
    : anchorX === 'center'
      ? ((safeRect.x + safeRect.width / 2) - dims.width / 2) / shortEdge
      : safeRect.x / shortEdge;
  const offsetY = anchorY === 'bottom'
    ? (dims.height - safeRect.y - safeRect.height) / shortEdge
    : anchorY === 'center'
      ? ((safeRect.y + safeRect.height / 2) - dims.height / 2) / shortEdge
      : safeRect.y / shortEdge;
  return {
    anchorX,
    anchorY,
    offsetX: clamp(offsetX, -1, 1),
    offsetY: clamp(offsetY, -1, 1),
    widthRatio: clamp(safeRect.width / shortEdge, 0.03, 0.6),
  };
};

export const updateLogoPlacementTemplate = (
  placement,
  ratio,
  rect,
  { applyToAll = true } = {},
) => {
  const current = placement || createDefaultLogoPlacement(rect || {});
  const safeRatio = LOGO_PLACEMENT_RATIOS.some((item) => item.ratio === ratio) ? ratio : current.baseRatio || '1:1';
  const template = rectToTemplate(rect);
  const nextTemplates = { ...(current.templates || {}) };
  if (applyToAll) {
    LOGO_PLACEMENT_RATIOS.forEach((item) => {
      nextTemplates[item.ratio] = { ...template };
    });
  } else {
    nextTemplates[safeRatio] = { ...template };
  }
  return {
    version: 1,
    baseRatio: current.baseRatio || safeRatio,
    logoRatio: current.logoRatio || 2,
    templates: nextTemplates,
  };
};

export const applyLogoPlacementTemplateToAllRatios = (placement, ratio) => {
  const current = placement || createDefaultLogoPlacement();
  const source = current.templates?.[ratio] || current.templates?.[current.baseRatio] || DEFAULT_TEMPLATE;
  return {
    ...current,
    templates: Object.fromEntries(LOGO_PLACEMENT_RATIOS.map((item) => [item.ratio, { ...source }])),
  };
};

export const resolveLogoPlacementRect = (placement, {
  ratio,
  canvasWidth,
  canvasHeight,
  logoRatio,
}) => {
  const dims = normalizeDimensions({ width: canvasWidth, height: canvasHeight });
  const nearestRatio = ratio || resolveNearestLogoPlacementRatio(dims);
  const template = placement?.templates?.[nearestRatio]
    || placement?.templates?.[placement?.baseRatio]
    || DEFAULT_TEMPLATE;
  const safeLogoRatio = Number.isFinite(Number(logoRatio || placement?.logoRatio))
    && Number(logoRatio || placement?.logoRatio) > 0
    ? Number(logoRatio || placement?.logoRatio)
    : 2;
  const shortEdge = Math.max(1, Math.min(dims.width, dims.height));
  const width = clamp((template.widthRatio || DEFAULT_TEMPLATE.widthRatio) * shortEdge, 1, dims.width);
  const height = clamp(width / safeLogoRatio, 1, dims.height);
  const offsetX = Number(template.offsetX ?? DEFAULT_TEMPLATE.offsetX) * shortEdge;
  const offsetY = Number(template.offsetY ?? DEFAULT_TEMPLATE.offsetY) * shortEdge;
  let x = offsetX;
  if (template.anchorX === 'right') x = dims.width - width - offsetX;
  if (template.anchorX === 'center') x = dims.width / 2 + offsetX - width / 2;
  let y = offsetY;
  if (template.anchorY === 'bottom') y = dims.height - height - offsetY;
  if (template.anchorY === 'center') y = dims.height / 2 + offsetY - height / 2;
  return {
    x: clamp(x, 0, Math.max(0, dims.width - width)),
    y: clamp(y, 0, Math.max(0, dims.height - height)),
    width,
    height,
    ratio: nearestRatio,
  };
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

const decodeImageFromBlob = async (blob, label) => {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(blob);
    } catch {
      // Fall through to HTMLImageElement decoding.
    }
  }
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

const loadImage = async (url, label = '图片') => {
  const safeUrl = String(url || '').trim();
  if (!safeUrl) throw new Error(`${label}地址为空`);
  const blob = await fetchImageBlob(safeUrl, label);
  return decodeImageFromBlob(blob, label);
};

const loadImageFromBlob = async (blob, label = '图片') => {
  if (!(blob instanceof Blob)) return null;
  return decodeImageFromBlob(blob, label);
};

export const createEverythingReplaceLogoPlacementGuide = async ({
  referenceUrl,
  logoUrl,
  logoBlob,
  placement,
  referenceWidth,
  referenceHeight,
  logoRatio,
} = {}) => {
  void referenceUrl;
  const logoImage = await loadImageFromBlob(logoBlob, 'Logo图') || await loadImage(logoUrl, 'Logo图');
  const sourceWidth = referenceWidth || 1000;
  const sourceHeight = referenceHeight || 1000;
  const maxEdge = 1600;
  const scale = Math.min(1, maxEdge / Math.max(sourceWidth, sourceHeight));
  const canvasWidth = Math.max(1, Math.round(sourceWidth * scale));
  const canvasHeight = Math.max(1, Math.round(sourceHeight * scale));
  const resolvedRatio = resolveNearestLogoPlacementRatio({ width: sourceWidth, height: sourceHeight });
  const effectiveLogoRatio = logoRatio
    || placement?.logoRatio
    || ((logoImage.width || logoImage.naturalWidth || 2) / Math.max(1, logoImage.height || logoImage.naturalHeight || 1));
  const rect = resolveLogoPlacementRect(placement || createDefaultLogoPlacement({ width: sourceWidth, height: sourceHeight, logoRatio: effectiveLogoRatio }), {
    ratio: resolvedRatio,
    canvasWidth,
    canvasHeight,
    logoRatio: effectiveLogoRatio,
  });

  const canvas = document.createElement('canvas');
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Logo位置示意图生成失败');
  ctx.clearRect(0, 0, canvasWidth, canvasHeight);
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.drawImage(logoImage, rect.x, rect.y, rect.width, rect.height);
  ctx.restore();

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png', 0.95));
  if (!blob) throw new Error('Logo位置示意图导出失败');
  return { blob, rect, ratio: resolvedRatio, width: canvasWidth, height: canvasHeight };
};
