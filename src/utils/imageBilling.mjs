const CREDIT_TABLE = {
  'gpt-image-2': {
    '1K': 3,
    '2K': 5,
    '4K': 8,
  },
  'nano-banana-2': {
    '1K': 5,
    '2K': 8,
    '4K': 12,
  },
};

const parsePositiveInt = (value, fallback = 1, max = 20) => {
  const parsed = Number.parseInt(String(value || '').replace(/[^\d]/g, ''), 10);
  if (!Number.isFinite(parsed) || parsed < 1) return Math.max(1, Math.min(max, fallback));
  return Math.min(max, parsed);
};

export const normalizeBillingModel = (model = '') => {
  const normalized = String(model || '').trim().toLowerCase();
  if (normalized.includes('nano')) return 'nano-banana-2';
  return 'gpt-image-2';
};

export const normalizeBillingResolution = (resolution = '') => {
  const normalized = String(resolution || '').trim().toLowerCase();
  if (normalized.includes('4')) return '4K';
  if (normalized.includes('2')) return '2K';
  return '1K';
};

export const getImageModelCreditCost = (model = '', resolution = '') => {
  const billingModel = normalizeBillingModel(model);
  const billingResolution = normalizeBillingResolution(resolution);
  return CREDIT_TABLE[billingModel]?.[billingResolution] || 0;
};

export const isImageBillingModule = (module = '', subFeature = '') => {
  if (module === 'settings' || module === 'account' || module === 'agent_center') return false;
  if (module === 'video') return subFeature === 'storyboard';
  return ['one_click', 'translation', 'buyer_show', 'retouch', 'photography', 'xhs_cover'].includes(module);
};

export const resolveImageBillingCount = ({ module = '', subFeature = '', params = {}, materialCount = 0 } = {}) => {
  if (module === 'translation') return Math.max(1, Number(materialCount || 0));

  if (module === 'one_click') {
    if (subFeature === 'first_image') return 1;
    if (subFeature === 'sku') return parsePositiveInt(params.count, 4, 20);
    if (subFeature === 'main_image') return parsePositiveInt(params.count, 5, 20);
    if (subFeature === 'detail_page') return parsePositiveInt(params.count, 7, 20);
    return 1;
  }

  if (module === 'buyer_show') {
    const perSetCount = parsePositiveInt(params.count, 4, 20);
    const setCount = parsePositiveInt(params.setCount, 1, 4);
    return Math.min(20, perSetCount * setCount);
  }

  if (module === 'xhs_cover') {
    const styleCount = String(params.selectedStyleIds || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean).length;
    return Math.max(1, Math.min(20, styleCount || 1));
  }

  return 1;
};

export const estimateImageBilling = ({ module = '', subFeature = '', params = {}, materialCount = 0 } = {}) => {
  const billable = isImageBillingModule(module, subFeature);
  const model = normalizeBillingModel(params.model || 'GPT Image 2');
  const resolution = normalizeBillingResolution(params.quality || params.resolution || '1K');
  const imageCount = billable ? resolveImageBillingCount({ module, subFeature, params, materialCount }) : 0;
  const unitCredits = billable ? getImageModelCreditCost(model, resolution) : 0;

  return {
    billable,
    model,
    resolution,
    imageCount,
    unitCredits,
    estimatedCredits: imageCount * unitCredits,
  };
};
