const DEFAULT_CONCURRENCY = 5;

const sanitizePositiveInteger = (value, fallback = DEFAULT_CONCURRENCY) => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const sanitizeTimestamp = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const escapeCsvCell = (value) => {
  const text = String(value ?? '');
  if (!/[",\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
};

export const getEffectiveConcurrency = (systemMax, userMax) => {
  const safeSystem = sanitizePositiveInteger(systemMax, DEFAULT_CONCURRENCY);
  return sanitizePositiveInteger(userMax, safeSystem);
};

export const filterLogs = (logs, filters = {}) => {
  const moduleFilter = filters.module || 'all';
  const userFilter = filters.userId || 'all';
  const statusFilter = filters.status || 'all';
  const startAt = sanitizeTimestamp(filters.startAt);
  const endAt = sanitizeTimestamp(filters.endAt);

  return (Array.isArray(logs) ? logs : []).filter((log) => {
    if (moduleFilter !== 'all' && log.module !== moduleFilter) return false;
    if (userFilter !== 'all' && log.userId !== userFilter) return false;
    if (statusFilter !== 'all' && log.status !== statusFilter) return false;
    if (startAt && Number(log.createdAt || 0) < startAt) return false;
    if (endAt && Number(log.createdAt || 0) > endAt) return false;
    return true;
  });
};

export const buildLogCsv = (logs) => {
  const rows = [
    ['时间', '功能', '动作', '状态', '级别', '人员', '用户名', '消息', '详情', '内部任务ID', '外部任务ID', '引擎', '重试次数', '错误码', '文件名', '相对路径', '上传方式', '排队耗时(ms)', '运行耗时(ms)', '元数据'],
    ...(Array.isArray(logs) ? logs : []).map((log) => [
      new Date(Number(log.createdAt || 0)).toISOString(),
      log.module || '',
      log.action || '',
      log.status || '',
      log.level || '',
      log.displayName || '',
      log.username || '',
      log.message || '',
      log.detail || '',
      log.meta?.jobId || '',
      log.meta?.providerTaskId || '',
      log.meta?.provider || '',
      log.meta?.retryCount ?? '',
      log.meta?.errorCode || '',
      log.meta?.fileName || '',
      log.meta?.relativePath || '',
      log.meta?.uploadMethod || '',
      log.meta?.queueWaitMs ?? '',
      log.meta?.runtimeMs ?? '',
      log.meta ? JSON.stringify(log.meta) : '',
    ]),
  ];

  return rows
    .map((row) => row.map((cell) => escapeCsvCell(cell)).join(','))
    .join('\n');
};

export const shouldRefreshCurrentUser = (currentUserId, targetUserId) => {
  return Boolean(currentUserId) && Boolean(targetUserId) && currentUserId === targetUserId;
};
