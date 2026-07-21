const VIRAL_PRODUCT_INFO_PLACEHOLDERS = new Set([
  '',
  '参考视频',
  '爆款视频',
  '视频复刻',
  '参考视频复刻',
  '爆款视频复刻',
  '爆款复刻',
  '视频裂变',
  '参考视频裂变',
  '爆款视频裂变',
  '爆款裂变',
]);

export const normalizeViralProductInfo = (value) => {
  const normalized = String(value || '').trim();
  if (VIRAL_PRODUCT_INFO_PLACEHOLDERS.has(normalized)) {
    return '未补充可核验的商品事实。只能依据商品参考图和参考视频中的可观察内容作中性描述，不得推断功效、数据或承诺。';
  }
  return normalized;
};
