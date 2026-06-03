const ONE_CLICK_MODULE = 'one_click';
const SKU_SUB_FEATURE = 'sku';
const SKU_REPLACEABLE_MATERIAL_TYPES = new Set(['product', 'gift', 'styleRef', 'reference']);

const isSkuScopedMaterial = (item) => item?.subFeature === SKU_SUB_FEATURE;

const isOneClickSku = (module, subFeature) => module === ONE_CLICK_MODULE && subFeature === SKU_SUB_FEATURE;

export const shouldResetSkuMaterialsForUpload = (module, subFeature, materialType) =>
  isOneClickSku(module, subFeature) && SKU_REPLACEABLE_MATERIAL_TYPES.has(materialType);

export const shouldResetSkuInputTextForUpload = (module, subFeature, materialType) =>
  isOneClickSku(module, subFeature) && materialType === 'product';

export const filterMaterialsForSkuUpload = (materials = {}, materialType = '') => {
  const clearWholeSkuContext = materialType === 'product';
  return Object.fromEntries(
    Object.entries(materials || {}).map(([type, list]) => {
      if (!Array.isArray(list)) return [type, list];
      const shouldFilterType = clearWholeSkuContext
        ? SKU_REPLACEABLE_MATERIAL_TYPES.has(type)
        : type === materialType;
      return [type, shouldFilterType ? list.filter((item) => !isSkuScopedMaterial(item)) : list];
    }),
  );
};

const shouldDropSkuParam = (key) =>
  /^skuCopyText_\d+$/.test(key) || key === 'count' || key === 'productInfo' || key === 'productDescription';

export const resetSkuInputStateForProductUpload = (inputStateByScope = {}, scopeKey = 'one_click:sku') => {
  const currentState = inputStateByScope?.[scopeKey] || {};
  const currentParams = currentState.params || {};
  const nextParams = Object.fromEntries(
    Object.entries(currentParams).filter(([key]) => !shouldDropSkuParam(key)),
  );

  return {
    ...inputStateByScope,
    [scopeKey]: {
      promptText: '',
      params: {
        ...nextParams,
        mode: 'SKU',
      },
    },
  };
};
