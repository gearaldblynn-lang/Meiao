const clean = (value) => String(value ?? '').trim();
const clamp = (value, min, max) => Math.min(
  max,
  Math.max(min, Number.isFinite(Number(value)) ? Number(value) : min),
);

export const normalizeProductReplaceRegion = (region) => {
  if (!region || typeof region !== 'object' || Array.isArray(region)) return null;
  const widthRatio = clamp(region.widthRatio, 0, 1);
  const heightRatio = clamp(region.heightRatio, 0, 1);
  if (widthRatio <= 0 || heightRatio <= 0) return null;
  const productGroupId = clean(region.productGroupId);
  const productNumber = Number.parseInt(String(region.productNumber || ''), 10);
  const regionIndex = Number.parseInt(String(region.regionIndex || productNumber || ''), 10);
  if (!productGroupId || !Number.isInteger(productNumber) || productNumber <= 0) return null;
  return {
    version: 1,
    source: 'manual',
    regionId: clean(region.regionId) || `product-replace-region-${productNumber}`,
    regionIndex: Number.isInteger(regionIndex) && regionIndex > 0 ? regionIndex : productNumber,
    productGroupId,
    productNumber,
    xRatio: clamp(region.xRatio, 0, 1 - widthRatio),
    yRatio: clamp(region.yRatio, 0, 1 - heightRatio),
    widthRatio,
    heightRatio,
  };
};

export const moveProductReplaceRegion = (region, deltaXRatio = 0, deltaYRatio = 0) => {
  const normalized = normalizeProductReplaceRegion(region);
  if (!normalized) return null;
  const nextX = clamp(normalized.xRatio + Number(deltaXRatio || 0), 0, 1 - normalized.widthRatio);
  const nextY = clamp(normalized.yRatio + Number(deltaYRatio || 0), 0, 1 - normalized.heightRatio);
  return {
    ...normalized,
    xRatio: Number(nextX.toFixed(6)),
    yRatio: Number(nextY.toFixed(6)),
  };
};

export const normalizeProductReplaceRegions = (regions) => (
  (Array.isArray(regions) ? regions : [])
    .map(normalizeProductReplaceRegion)
    .filter(Boolean)
    .sort((left, right) => left.productNumber - right.productNumber)
);

export const hasCompleteProductReplaceRegionCoverage = ({
  regions,
  productGroups,
} = {}) => {
  try {
    assertProductReplaceRegionCoverage({ regions, productGroups });
    return true;
  } catch {
    return false;
  }
};

export const assertProductReplaceRegionCoverage = ({
  regions,
  productGroups,
} = {}) => {
  const groups = Array.isArray(productGroups) ? productGroups : [];
  if (groups.length === 0) throw new Error('组合替换缺少有效产品组。');
  const normalized = normalizeProductReplaceRegions(regions);
  if (normalized.length !== groups.length) {
    throw new Error(`每张替换参考图都必须完成 P1 到 P${groups.length} 的位置标记。`);
  }
  const byGroupId = new Map(normalized.map((region) => [region.productGroupId, region]));
  if (byGroupId.size !== groups.length) {
    throw new Error('产品位置标记不能重复、遗漏或引用旧产品组。');
  }
  const bindings = groups.map((group, index) => {
    const productGroupId = clean(group?.id);
    const productNumber = Number(group?.productNumber) || index + 1;
    const region = byGroupId.get(productGroupId);
    const targetInputImageIndexes = (Array.isArray(group?.inputImageIndexes) ? group.inputImageIndexes : [])
      .map(Number)
      .filter((value) => Number.isInteger(value) && value > 0);
    if (
      !productGroupId
      || !region
      || region.productNumber !== productNumber
      || region.regionIndex !== productNumber
      || targetInputImageIndexes.length === 0
    ) {
      throw new Error('产品位置标记不能重复、遗漏或引用旧产品组。');
    }
    return {
      ...region,
      targetInputImageIndexes,
    };
  });
  const expectedIds = new Set(groups.map((group) => clean(group?.id)).filter(Boolean));
  if (normalized.some((region) => !expectedIds.has(region.productGroupId))) {
    throw new Error('产品位置标记不能重复、遗漏或引用旧产品组。');
  }
  return bindings;
};
