const clampPositiveInteger = (value, fallback) => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export const normalizeLogPagination = (filters = {}) => {
  const page = clampPositiveInteger(filters.page, 1);
  const requestedPageSize = clampPositiveInteger(filters.pageSize, 50);
  const pageSize = Math.min(requestedPageSize, 200);

  return {
    page,
    pageSize,
    offset: (page - 1) * pageSize,
  };
};

export const buildLogFilterOptions = (logs) => {
  const entries = Array.isArray(logs) ? logs : [];
  const modules = Array.from(new Set(entries.map((log) => log?.module).filter(Boolean))).sort();

  const userMap = new Map();
  entries.forEach((log) => {
    if (!log?.userId) return;
    if (!userMap.has(log.userId)) {
      userMap.set(log.userId, {
        id: log.userId,
        label: log.displayName || log.username || log.userId,
      });
    }
  });

  return {
    modules,
    users: Array.from(userMap.values()).sort((a, b) => a.label.localeCompare(b.label, 'zh-CN')),
  };
};
