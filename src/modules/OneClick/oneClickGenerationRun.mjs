export const buildOneClickRunStartPatch = (mode = 'full') => {
  if (mode === 'recover') {
    return { status: 'generating', error: undefined };
  }
  return {
    status: 'generating',
    error: undefined,
    taskId: undefined,
    resultUrl: undefined,
  };
};

export const buildOneClickJobCreatedPatch = (jobId, providerTaskId) => {
  const backendJobId = String(jobId || '').trim() || undefined;
  const visibleProviderTaskId = String(providerTaskId || '').trim() || undefined;
  return {
    taskId: visibleProviderTaskId,
    backendJobId,
    error: visibleProviderTaskId ? '任务已提交云端，正在生成...' : '任务正在提交云端...',
  };
};
