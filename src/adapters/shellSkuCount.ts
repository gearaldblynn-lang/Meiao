const parsePositiveCount = (value: unknown) => {
  const parsed = parseInt(String(value || '').replace(/[^\d]/g, ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

export const resolveShellSkuCount = (
  params: Record<string, string | undefined>,
  fallback = 4,
  max = 20,
) => {
  const explicitCount = parsePositiveCount(params.count);
  if (explicitCount > 0) return Math.min(max, explicitCount);

  const filledIndexes = Object.entries(params)
    .filter(([key, value]) => /^skuCopyText_\d+$/.test(key) && String(value || '').trim())
    .map(([key]) => Number(key.replace('skuCopyText_', '')))
    .filter((index) => Number.isFinite(index) && index >= 0);

  if (filledIndexes.length > 0) {
    return Math.min(max, Math.max(...filledIndexes) + 1);
  }

  return Math.max(1, Math.min(max, parsePositiveCount(fallback) || fallback));
};
