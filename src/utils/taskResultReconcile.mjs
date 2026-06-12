// 任务结果对账 —— 前后端唯一权威实现(根因 #1 的"单一实现")。
// 原样来自经 34 个后端测试验证的 server/appStateMerge.mjs;前端 shellPersistence.ts
// 不再保留自己的浅合并版本,改为 import 本模块,杜绝两套逻辑漂移。
// 规则要点:已完成媒体必胜、stale 占位清理、按稳定身份(id/job/provider/result)去重。

export const compactKey = (value) => String(value || '').trim();

export const collectItemKeys = (item, options = {}) => {
  const { includeProjectId = false, includeNestedResults = true } = options;
  const keys = new Set();
  const add = (prefix, value) => {
    const normalized = compactKey(value);
    if (normalized) keys.add(`${prefix}:${normalized}`);
  };
  add('id', item?.id);
  add('job', item?.backendJobId);
  add('provider', item?.providerTaskId || item?.taskId || item?.kieTaskId);
  if (includeProjectId) {
    add('project', item?.projectId);
  }
  if (includeNestedResults && Array.isArray(item?.results)) {
    item.results.forEach((result) => {
      add('result', result?.id);
      add('provider', result?.providerTaskId || result?.taskId || result?.kieTaskId);
    });
  }
  return keys;
};

export const mergeArrayByStableKeys = (existingItems = [], incomingItems = []) => {
  const existing = Array.isArray(existingItems) ? existingItems.filter(Boolean) : [];
  const incoming = Array.isArray(incomingItems) ? incomingItems.filter(Boolean) : [];
  const seen = new Set();
  const merged = [];

  const hasCompletedMediaResult = (item = {}) => (
    ['completed', 'succeeded', 'success'].includes(String(item?.status || ''))
    && Boolean(item?.imageUrl || item?.videoUrl || item?.resultUrl)
  );
  const hasMediaResult = (item = {}) => Boolean(item?.imageUrl || item?.videoUrl || item?.resultUrl);
  const hasRuntimeIdentity = (item = {}) => Boolean(compactKey(item?.backendJobId || item?.taskId || item?.providerTaskId || item?.kieTaskId));
  const isTerminalBackendFailure = (item = {}) => (
    ['error', 'failed'].includes(String(item?.status || ''))
    && !hasMediaResult(item)
    && Boolean(compactKey(item?.backendJobId))
  );
  const isStaleRuntimePlaceholder = (item = {}) => (
    ['error', 'failed', 'generating', 'pending', 'queued'].includes(String(item?.status || ''))
    && !hasMediaResult(item)
    && !hasRuntimeIdentity(item)
  );
  const isSamePlanScope = (left = {}, right = {}) => {
    const leftPlanId = compactKey(left?.planId);
    const rightPlanId = compactKey(right?.planId);
    if (leftPlanId && rightPlanId) return leftPlanId === rightPlanId;
    return !leftPlanId && !rightPlanId;
  };
  const pruneStaleRuntimePlaceholders = (item = {}) => {
    if (!isTerminalBackendFailure(item)) return;
    for (let index = merged.length - 1; index >= 0; index -= 1) {
      if (isStaleRuntimePlaceholder(merged[index]) && isSamePlanScope(merged[index], item)) {
        merged.splice(index, 1);
      }
    }
  };
  const isSupersededRuntimePlaceholder = (item = {}) => (
    isStaleRuntimePlaceholder(item)
    && merged.some((existing) => isTerminalBackendFailure(existing) && isSamePlanScope(existing, item))
  );
  const findNoMediaPlanPlaceholderIndex = (item = {}) => {
    const planId = compactKey(item?.planId);
    const status = String(item?.status || '');
    if (!planId || hasMediaResult(item) || !['error', 'failed', 'generating', 'pending', 'queued'].includes(status)) return -1;
    return merged.findIndex((existing) => (
      compactKey(existing?.planId) === planId
      && !hasMediaResult(existing)
      && ['error', 'failed', 'generating', 'pending', 'queued'].includes(String(existing?.status || ''))
    ));
  };
  const clearCompletedResultErrors = (item = {}) => {
    if (!hasCompletedMediaResult(item)) return item;
    const next = { ...(item || {}) };
    delete next.error;
    delete next.message;
    return next;
  };
  const mergeDuplicateItem = (current = {}, item = {}) => {
    const isActiveRuntimeReplacement = (value = {}) => (
      ['generating', 'pending', 'queued', 'running', 'retry_waiting'].includes(String(value?.status || ''))
      && !hasMediaResult(value)
      && Boolean(compactKey(value?.backendJobId || value?.taskId || value?.providerTaskId || value?.kieTaskId))
    );
    const next = hasCompletedMediaResult(current)
      ? { ...(item || {}), ...(current || {}) }
      : isActiveRuntimeReplacement(current) && hasCompletedMediaResult(item)
        ? { ...(item || {}), ...(current || {}) }
      : hasCompletedMediaResult(item)
        ? { ...(current || {}), ...(item || {}) }
        : isActiveRuntimeReplacement(item) && hasCompletedMediaResult(current)
          ? { ...(current || {}), ...(item || {}) }
        : { ...(item || {}), ...(current || {}) };
    const mergedItem = {
      ...next,
      planId: current.planId || item?.planId,
      projectId: current.projectId || item?.projectId,
      subFeature: current.subFeature || item?.subFeature,
      taskId: next.taskId,
      providerTaskId: next.providerTaskId,
      backendJobId: next.backendJobId,
    };
    return clearCompletedResultErrors(mergedItem);
  };

  const push = (item) => {
    if (isSupersededRuntimePlaceholder(item)) return;
    pruneStaleRuntimePlaceholders(item);
    const noMediaPlanPlaceholderIndex = findNoMediaPlanPlaceholderIndex(item);
    if (noMediaPlanPlaceholderIndex >= 0) {
      merged[noMediaPlanPlaceholderIndex] = mergeDuplicateItem(merged[noMediaPlanPlaceholderIndex] || {}, item || {});
      collectItemKeys(merged[noMediaPlanPlaceholderIndex]).forEach((key) => seen.add(key));
      return;
    }
    const keys = collectItemKeys(item);
    const duplicateIndex = Array.from(keys)
      .map((key) => merged.findIndex((existing) => collectItemKeys(existing).has(key)))
      .find((index) => index >= 0);
    if (typeof duplicateIndex === 'number') {
      merged[duplicateIndex] = mergeDuplicateItem(merged[duplicateIndex] || {}, item || {});
      collectItemKeys(merged[duplicateIndex]).forEach((key) => seen.add(key));
      return;
    }
    keys.forEach((key) => seen.add(key));
    merged.push(clearCompletedResultErrors(item));
  };

  incoming.forEach(push);
  existing.forEach(push);
  return merged;
};
