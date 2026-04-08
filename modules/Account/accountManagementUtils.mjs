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

export const deriveLogFailureReason = (log) => {
  const meta = log?.meta || {};
  const providerStage = String(meta.providerStage || '').trim();
  const providerStatus = String(meta.providerStatus || '').trim();
  const errorCode = String(meta.errorCode || '').trim();
  const detail = String(log?.detail || '').trim();
  const message = String(meta.providerMessage || meta.errorMessage || detail || '').trim();

  if ((providerStage === 'analysis') || errorCode === 'analysis_failed') return '分析失败';
  if (providerStage === 'create_task') return '创建任务失败';
  if (providerStage === 'polling' && (providerStatus === 'timeout' || errorCode === 'provider_timeout')) return '轮询超时';
  if (providerStatus === 'rate_limited' || errorCode === 'provider_rate_limited') return '请求过频';
  if (providerStatus === 'auth_invalid' || errorCode === 'provider_auth_invalid') return '鉴权失败';
  if (providerStatus === 'not_found' || errorCode === 'task_not_found') return '任务不存在';
  if (providerStatus === 'server_error' || errorCode === 'provider_internal_error') return '上游服务异常';
  if (providerStatus === 'network_error' || errorCode === 'provider_network_error') return '网络异常';
  if (errorCode === 'provider_bad_request') return '参数不合法';
  if (/超时/.test(message)) return '轮询超时';
  if (/鉴权|未配置|key/i.test(message)) return '鉴权失败';
  if (/频繁|限流|429/.test(message)) return '请求过频';
  if (/不存在|过期/.test(message)) return '任务不存在';
  if (/服务异常|服务不可用|server|503|502|500/i.test(message)) return '上游服务异常';
  if (/网络|fetch failed|network/i.test(message)) return '网络异常';
  return log?.status === 'failed' ? '执行失败' : '';
};

export const buildLogCsv = (logs) => {
  const rows = [
    ['时间', '功能', '动作', '状态', '级别', '人员', '用户名', '消息', '详情', '内部任务ID', '外部任务ID', '引擎', '供应商阶段', '供应商状态', '供应商消息', '输入图片数', '采用图片URL', '输入图片URL', '重试次数', '错误码', '错误信息', '会话ID', '请求ID', '请求类型', '智能体', '版本', '模型', '是否检索', '结果图数量', '文件名', '相对路径', '上传方式', '排队耗时(ms)', '运行耗时(ms)', '元数据'],
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
      log.meta?.providerStage || '',
      log.meta?.providerStatus || '',
      log.meta?.providerMessage || '',
      log.meta?.inputImageCount ?? '',
      Array.isArray(log.meta?.usedImageReferenceUrls) ? log.meta.usedImageReferenceUrls.join('\n') : '',
      Array.isArray(log.meta?.inputImageUrls) ? log.meta.inputImageUrls.join('\n') : '',
      log.meta?.retryCount ?? '',
      log.meta?.errorCode || '',
      log.meta?.errorMessage || '',
      log.meta?.sessionId || '',
      log.meta?.clientRequestId || '',
      log.meta?.requestType || '',
      log.meta?.agentName || '',
      log.meta?.versionName || '',
      log.meta?.selectedModel || '',
      log.meta?.usedRetrieval ?? '',
      log.meta?.imageResultCount ?? '',
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
