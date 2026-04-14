export const summarizeProbeOutcome = (probe) => {
  const sourceCount = Array.isArray(probe?.sources) ? probe.sources.length : 0;
  const missingCount = Array.isArray(probe?.missingCriticalFields) ? probe.missingCriticalFields.length : 0;
  return `已完成 ${sourceCount} 个数据源勘探，缺失 ${missingCount} 个关键字段`;
};

export const formatEvidenceValue = (value) => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);

  try {
    return JSON.stringify(value);
  } catch (_err) {
    return String(value);
  }
};

