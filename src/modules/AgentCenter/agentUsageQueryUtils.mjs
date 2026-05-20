export const buildAgentUsageFilterOptions = (rows = []) => {
  const users = Array.from(
    new Map(
      rows
        .filter((row) => row?.userId)
        .map((row) => [row.userId, { id: row.userId, label: row.displayName || row.username || row.userId }])
    ).values()
  ).sort((a, b) => a.label.localeCompare(b.label, 'zh-CN'));

  const models = Array.from(new Set(rows.map((row) => row?.selectedModel).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'zh-CN'));

  return { users, models };
};

export const filterAgentUsageRows = (rows = [], filters = {}) => rows.filter((row) => {
  if (filters.userId && filters.userId !== 'all' && row.userId !== filters.userId) return false;
  if (filters.model && filters.model !== 'all' && row.selectedModel !== filters.model) return false;
  if (filters.status && filters.status !== 'all' && row.status !== filters.status) return false;
  if (typeof filters.startAt === 'number' && row.createdAt < filters.startAt) return false;
  if (typeof filters.endAt === 'number' && row.createdAt > filters.endAt) return false;
  return true;
});

export const paginateAgentUsageRows = (rows = [], options = {}) => {
  const page = Math.max(1, Number(options.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(options.pageSize) || 10));
  const total = rows.length;
  const offset = (page - 1) * pageSize;
  return {
    rows: rows.slice(offset, offset + pageSize),
    total,
    page,
    pageSize,
  };
};
