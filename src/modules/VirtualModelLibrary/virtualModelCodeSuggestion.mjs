export const suggestNextVirtualModelCode = (models = []) => {
  let maximum = 0;
  for (const model of Array.isArray(models) ? models : []) {
    const code = String(model?.code || '').trim();
    if (!/^\d{3,}$/.test(code)) continue;
    const numericCode = Number(code);
    if (Number.isSafeInteger(numericCode)) maximum = Math.max(maximum, numericCode);
  }
  return String(maximum + 1).padStart(3, '0');
};
