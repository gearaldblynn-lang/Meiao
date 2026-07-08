const clamp = (value, min, max) => Math.min(max, Math.max(min, Number.isFinite(Number(value)) ? Number(value) : min));

const normalizeDimensions = ({ width, height }, fallback = { width: 1000, height: 1000 }) => ({
  width: Number.isFinite(Number(width)) && Number(width) > 0 ? Number(width) : fallback.width,
  height: Number.isFinite(Number(height)) && Number(height) > 0 ? Number(height) : fallback.height,
});

export const normalizeLogoReplaceRegion = (region) => {
  if (!region || typeof region !== 'object') return null;
  const widthRatio = clamp(region.widthRatio, 0, 1);
  const heightRatio = clamp(region.heightRatio, 0, 1);
  if (widthRatio <= 0 || heightRatio <= 0) return null;
  const xRatio = clamp(region.xRatio, 0, 1 - widthRatio);
  const yRatio = clamp(region.yRatio, 0, 1 - heightRatio);
  const regionId = String(region.regionId || '').trim() || 'logo-replace-region';
  const regionIndex = Number.parseInt(String(region.regionIndex || ''), 10);
  const logoId = String(region.logoId || '').trim();
  const logoIndex = Number.parseInt(String(region.logoIndex || ''), 10);
  return {
    version: 1,
    source: region.source === 'applied_to_all' ? 'applied_to_all' : 'manual',
    regionId,
    regionIndex: Number.isFinite(regionIndex) && regionIndex > 0 ? regionIndex : 1,
    xRatio,
    yRatio,
    widthRatio,
    heightRatio,
    ...(logoId ? { logoId } : {}),
    ...(Number.isFinite(logoIndex) && logoIndex > 0 ? { logoIndex } : {}),
  };
};

export const rectToLogoReplaceRegion = ({
  regionId = 'logo-replace-region',
  regionIndex = 1,
  logoId,
  logoIndex,
  x,
  y,
  width,
  height,
  canvasWidth,
  canvasHeight,
  source = 'manual',
}) => {
  const dims = normalizeDimensions({ width: canvasWidth, height: canvasHeight });
  return normalizeLogoReplaceRegion({
    version: 1,
    source,
    regionId,
    regionIndex,
    logoId,
    logoIndex,
    xRatio: Number(x) / dims.width,
    yRatio: Number(y) / dims.height,
    widthRatio: Number(width) / dims.width,
    heightRatio: Number(height) / dims.height,
  });
};

export const normalizeLogoReplaceRegions = (regions, fallbackRegion = null) => {
  const normalized = (Array.isArray(regions) ? regions : [])
    .map((region, index) => normalizeLogoReplaceRegion({
      ...region,
      regionIndex: region?.regionIndex || index + 1,
      regionId: region?.regionId || `logo-replace-region-${index + 1}`,
    }))
    .filter(Boolean);
  const fallback = normalizeLogoReplaceRegion(fallbackRegion);
  const source = normalized.length > 0 ? normalized : fallback ? [fallback] : [];
  const seen = new Set();
  return source
    .map((region, index) => normalizeLogoReplaceRegion({
      ...region,
      regionIndex: region.regionIndex || index + 1,
      regionId: region.regionId || `logo-replace-region-${index + 1}`,
    }))
    .filter((region) => {
      if (!region) return false;
      const key = region.regionId || String(region.regionIndex || '');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => (a.regionIndex || 0) - (b.regionIndex || 0));
};

export const logoReplaceRegionToRect = (region, dimensions) => {
  const normalized = normalizeLogoReplaceRegion(region);
  if (!normalized) return null;
  const dims = normalizeDimensions(dimensions);
  return {
    x: Math.round(normalized.xRatio * dims.width),
    y: Math.round(normalized.yRatio * dims.height),
    width: Math.round(normalized.widthRatio * dims.width),
    height: Math.round(normalized.heightRatio * dims.height),
  };
};
