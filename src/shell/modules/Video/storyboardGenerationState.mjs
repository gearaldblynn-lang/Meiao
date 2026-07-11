const ACTIVE_PROVIDER_STATUSES = new Set([
  '',
  'pending',
  'queued',
  'running',
  'generating',
  'retry_waiting',
]);

const FAILED_PROVIDER_STATUSES = new Set([
  'error',
  'failed',
  'failure',
  'task_not_found',
]);

const CANCELLED_PROVIDER_STATUSES = new Set([
  'aborted',
  'canceled',
  'cancelled',
  'interrupted',
]);

const normalizeStatus = (value) => String(value || '').trim().toLowerCase();

export const normalizeStoryboardProviderStatus = (result = {}, options = {}) => {
  if (options.recoverable === true) return 'generating';
  const status = normalizeStatus(result.status);
  if (CANCELLED_PROVIDER_STATUSES.has(status)) return 'cancelled';
  if (FAILED_PROVIDER_STATUSES.has(status)) return 'failed';
  if (status === 'success' || status === 'succeeded' || status === 'completed') {
    return String(result.imageUrl || '').trim() ? 'success' : 'failed';
  }
  if (ACTIVE_PROVIDER_STATUSES.has(status)) return 'generating';
  return String(result.imageUrl || '').trim() ? 'success' : 'generating';
};

export const applyStoryboardBoardResult = (board = {}, result = {}, options = {}) => {
  const providerStatus = normalizeStoryboardProviderStatus(result, options);
  const next = { ...board };
  const taskId = String(result.taskId || '').trim();
  const backendJobId = String(result.backendJobId || '').trim();
  if (taskId) next.taskId = taskId;
  if (backendJobId) next.backendJobId = backendJobId;
  if (result.creditsConsumed != null) next.creditsConsumed = result.creditsConsumed;
  if (options.prompt != null) next.prompt = options.prompt;
  if (options.previousBoardImageUrl !== undefined) next.previousBoardImageUrl = options.previousBoardImageUrl;
  if (options.revisionInstruction !== undefined) next.revisionInstruction = options.revisionInstruction;

  if (providerStatus === 'success') {
    next.status = 'completed';
    next.imageUrl = String(result.imageUrl || '').trim();
    next.error = undefined;
    return next;
  }
  if (providerStatus === 'generating') {
    next.status = 'generating';
    next.error = String(result.message || '').trim() || undefined;
    return next;
  }

  next.status = 'failed';
  next.error = providerStatus === 'cancelled'
    ? String(result.message || '').trim() || '任务已中断'
    : String(result.message || '').trim() || (normalizeStatus(result.status) === 'success' ? '生成成功但未返回图片' : '生成失败');
  return next;
};

export const deriveStoryboardProjectStatus = (boards = [], fallback = 'imaging') => {
  if (boards.some((board) => board?.status === 'failed')) return 'failed';
  if (boards.some((board) => board?.status === 'pending' || board?.status === 'generating')) return 'imaging';
  if (boards.length > 0 && boards.every((board) => board?.status === 'completed' && String(board?.imageUrl || '').trim())) {
    return 'completed';
  }
  return fallback === 'completed' ? 'imaging' : fallback;
};

export const toStoryboardShellResultStatus = (board = {}) => {
  if (board.status === 'failed') return 'error';
  if (board.status === 'completed' && String(board.imageUrl || '').trim()) return 'completed';
  return 'generating';
};
