const cloneJson = (value) => JSON.parse(JSON.stringify(value || {}));

const ONE_CLICK_BRANCH_KEYS = ['firstImage', 'mainImage', 'detailPage', 'sku'];
const TRANSLATION_BRANCH_KEYS = ['main', 'detail', 'removeText'];

const compactKey = (value) => String(value || '').trim();
const getOneClickPlanContent = (item = {}) => compactKey(
  item?.schemeContent
  || item?.textLayout
  || item?.sceneDescription
  || item?.styleDirection
  || item?.colorPalette
  || item?.composition
  || item?.originalContent
  || item?.editedContent
  || item?.prompt
  || item?.error
  || item?.title
);
const isInvalidOneClickPlanText = (value) => {
  const content = compactKey(value).replace(/\s+/g, ' ');
  if (!content) return false;
  return [
    /fetch failed/i,
    /共\s*\d+\s*张参考图，其中\s*\d+\s*张策划失败/,
    /Failed to get (?:the )?file information/i,
    /I cannot fulfill this request/i,
    /Cannot read properties of undefined/i,
    /providerTaskId/i,
    /网络连接失败，请检查网络后重试/,
    /AI\s*分析请求失败/,
    /SKU方案策划失败/,
    /策划失败/,
    /任务状态同步失败/,
  ].some((pattern) => pattern.test(content));
};
const isInvalidOneClickPlanLike = (item = {}) => isInvalidOneClickPlanText(getOneClickPlanContent(item));
const idSet = (values) => new Set(
  (Array.isArray(values) ? values : [])
    .map((value) => compactKey(value))
    .filter(Boolean),
);

const isInlineImageDataUrl = (value) => (
  typeof value === 'string' && /^data:image\//i.test(value.trim())
);

const stripInlinePreviewUrl = (value) => isInlineImageDataUrl(value) ? '' : value;

const compactOneClickProjectForStorage = (project = {}) => {
  if (!project || typeof project !== 'object') return project;
  const {
    projects,
    activeProjectId,
    isGenerating,
    isAnalyzing,
    tasks,
    ...compactProject
  } = project;
  return compactProject;
};

const compactOneClickBranchForStorage = (branch = {}) => {
  if (!branch || typeof branch !== 'object') return branch;
  return {
    ...branch,
    projects: Array.isArray(branch.projects)
      ? branch.projects.filter(Boolean).map(compactOneClickProjectForStorage)
      : [],
  };
};

const compactTranslationFileForStorage = (file = {}) => {
  if (!file || typeof file !== 'object') return file;
  return {
    ...file,
    sourcePreviewUrl: stripInlinePreviewUrl(file.sourcePreviewUrl),
    resultBlob: undefined,
  };
};

const compactTranslationBranchForStorage = (branch = {}) => {
  if (!branch || typeof branch !== 'object') return branch;
  return {
    ...branch,
    files: Array.isArray(branch.files)
      ? branch.files.filter(Boolean).map(compactTranslationFileForStorage)
      : [],
  };
};

export const compactAppStateForStorage = (state = {}) => {
  const next = cloneJson(state);
  if (next.oneClickMemory && typeof next.oneClickMemory === 'object') {
    next.oneClickMemory = { ...next.oneClickMemory };
    ONE_CLICK_BRANCH_KEYS.forEach((key) => {
      next.oneClickMemory[key] = compactOneClickBranchForStorage(next.oneClickMemory[key]);
    });
  }

  if (next.translationMemory && typeof next.translationMemory === 'object') {
    next.translationMemory = { ...next.translationMemory };
    TRANSLATION_BRANCH_KEYS.forEach((key) => {
      next.translationMemory[key] = compactTranslationBranchForStorage(next.translationMemory[key]);
    });
  }

  return next;
};

const collectItemKeys = (item, options = {}) => {
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

const mergeIdArrays = (...lists) => Array.from(new Set(
  lists
    .flatMap((list) => Array.isArray(list) ? list : [])
    .map((value) => compactKey(value))
    .filter(Boolean),
)).slice(-500);

const mergeShellDraft = (existingDraft = {}, incomingDraft = {}) => ({
  ...(existingDraft || {}),
  ...(incomingDraft || {}),
  deletedJobIds: mergeIdArrays(existingDraft?.deletedJobIds, incomingDraft?.deletedJobIds),
  deletedProjectIds: mergeIdArrays(existingDraft?.deletedProjectIds, incomingDraft?.deletedProjectIds),
  deletedResultIds: mergeIdArrays(existingDraft?.deletedResultIds, incomingDraft?.deletedResultIds),
});

const buildDeletionSets = (draft = {}) => ({
  jobIds: idSet(draft?.deletedJobIds),
  projectIds: idSet(draft?.deletedProjectIds),
  resultIds: idSet(draft?.deletedResultIds),
});

const itemMatchesDeletion = (item, deletionSets, mode = 'item') => {
  if (!item || typeof item !== 'object') return false;
  const ids = [
    item.id,
    item.backendJobId,
    item.planningTaskId,
    item.taskId,
    item.providerTaskId,
    item.kieTaskId,
    item.projectId,
    compactKey(item.id).startsWith('job-') ? compactKey(item.id).slice(4) : '',
  ].map(compactKey).filter(Boolean);
  if (ids.some((id) => deletionSets.jobIds.has(id))) return true;
  if (mode === 'project' && ids.some((id) => deletionSets.projectIds.has(id))) return true;
  if (mode === 'result' && ids.some((id) => deletionSets.resultIds.has(id))) return true;
  return false;
};

const filterNestedItems = (items, deletionSets, mode = 'result') => (
  Array.isArray(items)
    ? items.filter((item) => !itemMatchesDeletion(item, deletionSets, mode))
    : items
);

const filterProjectList = (projects, deletionSets) => (
  Array.isArray(projects)
    ? projects.flatMap((project) => {
        if (!project || typeof project !== 'object') return [];
        if (itemMatchesDeletion(project, deletionSets, 'project')) return [];
        const nextProject = { ...project };
        if (Array.isArray(project.results)) {
          nextProject.results = filterNestedItems(project.results, deletionSets, 'result');
          if (project.results.length > 0 && nextProject.results.length === 0 && !Array.isArray(project.plans)) return [];
        }
        if (Array.isArray(project.schemes)) {
          nextProject.schemes = filterNestedItems(project.schemes, deletionSets, 'result');
          if (project.schemes.length > 0 && nextProject.schemes.length === 0) return [];
        }
        if (Array.isArray(project.plans)) {
          nextProject.plans = filterNestedItems(project.plans, deletionSets, 'result');
        }
        return [nextProject];
      })
    : []
);

const applyDeletionTombstones = (state = {}, draft = {}) => {
  const deletionSets = buildDeletionSets(draft);
  if (deletionSets.jobIds.size === 0 && deletionSets.projectIds.size === 0 && deletionSets.resultIds.size === 0) return state;
  const next = cloneJson(state);

  next.shellProjects = filterProjectList(next.shellProjects, deletionSets);

  if (next.oneClickMemory && typeof next.oneClickMemory === 'object') {
    next.oneClickMemory = { ...next.oneClickMemory };
    ONE_CLICK_BRANCH_KEYS.forEach((key) => {
      const branch = next.oneClickMemory[key];
      if (!branch || typeof branch !== 'object') return;
      next.oneClickMemory[key] = {
        ...branch,
        projects: filterProjectList(branch.projects, deletionSets),
        schemes: filterNestedItems(branch.schemes, deletionSets, 'result') || [],
      };
    });
  }

  if (next.translationMemory && typeof next.translationMemory === 'object') {
    next.translationMemory = { ...next.translationMemory };
    TRANSLATION_BRANCH_KEYS.forEach((key) => {
      const branch = next.translationMemory[key];
      if (!branch || typeof branch !== 'object') return;
      next.translationMemory[key] = {
        ...branch,
        files: filterNestedItems(branch.files, deletionSets, 'result') || [],
      };
    });
  }

  if (next.retouchMemory && typeof next.retouchMemory === 'object') {
    next.retouchMemory = {
      ...next.retouchMemory,
      tasks: filterNestedItems(next.retouchMemory.tasks, deletionSets, 'result') || [],
    };
  }

  if (next.buyerShowMemory && typeof next.buyerShowMemory === 'object') {
    next.buyerShowMemory = {
      ...next.buyerShowMemory,
      sets: filterProjectList(next.buyerShowMemory.sets, deletionSets),
      tasks: filterNestedItems(next.buyerShowMemory.tasks, deletionSets, 'result') || [],
    };
  }

  if (next.videoMemory && typeof next.videoMemory === 'object') {
    next.videoMemory = {
      ...next.videoMemory,
      tasks: filterNestedItems(next.videoMemory.tasks, deletionSets, 'result') || [],
      veoProjects: filterProjectList(next.videoMemory.veoProjects, deletionSets),
      storyboard: next.videoMemory.storyboard && typeof next.videoMemory.storyboard === 'object'
        ? {
            ...next.videoMemory.storyboard,
            projects: filterProjectList(next.videoMemory.storyboard.projects, deletionSets),
          }
        : next.videoMemory.storyboard,
    };
  }

  if (next.xhsCoverMemory && typeof next.xhsCoverMemory === 'object') {
    next.xhsCoverMemory = {
      ...next.xhsCoverMemory,
      projects: filterProjectList(next.xhsCoverMemory.projects, deletionSets),
      tasks: filterNestedItems(next.xhsCoverMemory.tasks, deletionSets, 'result') || [],
    };
  }

  return next;
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

const splitIdentityText = (value) => String(value || '')
  .split(/[,\s]+/)
  .map((item) => item.trim())
  .filter(Boolean);

const mergeIdentityText = (...values) => {
  const merged = Array.from(new Set(values.flatMap(splitIdentityText)));
  return merged.join(',');
};

const maxNumber = (...values) => Math.max(
  0,
  ...values.map((value) => Number(value || 0)).filter((value) => Number.isFinite(value)),
);

const hasOwnArray = (object, key) => Object.hasOwn(object || {}, key) && Array.isArray(object?.[key]);

const isStalePlanningFailureResult = (result = {}) => {
  if (!result || result.status !== 'error') return false;
  if (result.imageUrl || result.videoUrl || result.backendJobId || result.taskId || result.providerTaskId) return false;
  const message = String(result.error || result.prompt || '').trim();
  return /策划失败|未返回可用方案|任务已提交云端|结果待同步/.test(message);
};

const hasOnlyStalePlanningFailureResults = (item = {}) => {
  const results = Array.isArray(item?.results) ? item.results : [];
  return results.length > 0 && results.every((result) => isStalePlanningFailureResult(result));
};

const hasCompletedMediaItem = (item = {}) => (
  Boolean(item?.imageUrl || item?.videoUrl || item?.resultUrl)
  && (
    !compactKey(item?.status)
    || ['completed', 'succeeded', 'success'].includes(String(item?.status || ''))
  )
);

const isDirectVideoGenerationProject = (item = {}) => (
  String(item?.module || '') === 'video'
  && String(item?.subFeature || '') === 'generation'
);

const isPlanningGeneratedPlanId = (value) => /^[a-f0-9]{24}-plan-\d+$/i.test(String(value || '').trim());

const itemHasMedia = (item = {}) => Boolean(item?.imageUrl || item?.videoUrl || item?.resultUrl);

const itemHasProviderTaskIdentity = (item = {}) => Boolean(compactKey(item?.taskId || item?.providerTaskId || item?.kieTaskId));

const isActiveGenerationItem = (item = {}) => (
  ['generating', 'pending', 'queued', 'running', 'retry_waiting', 'uploading', 'processing'].includes(String(item?.status || ''))
  && itemHasProviderTaskIdentity(item)
);

const getPlanIdentity = (item = {}) => compactKey(item?.planId || item?.id);

const pruneSupersededNoMediaItems = (items = []) => {
  const completedPlanIds = new Set(
    (Array.isArray(items) ? items : [])
      .filter(hasCompletedMediaItem)
      .map(getPlanIdentity)
      .filter(Boolean),
  );
  if (completedPlanIds.size === 0) return Array.isArray(items) ? items : [];
  return (Array.isArray(items) ? items : []).filter((item) => {
    const planId = getPlanIdentity(item);
    if (!planId || !completedPlanIds.has(planId)) return true;
    const status = String(item?.status || '');
    if (!['error', 'failed', 'generating', 'pending', 'queued'].includes(status) || itemHasMedia(item)) return true;
    return Boolean(compactKey(item?.taskId || item?.providerTaskId || item?.kieTaskId));
  });
};

const normalizeProjectLikeItem = (item = {}, options = {}) => {
  const isOneClickProject = options.forceOneClick || String(item?.module || '') === 'one_click';
  const originalPlans = Array.isArray(item?.plans) ? item.plans : [];
  const invalidPlanIds = new Set(
    (isOneClickProject ? originalPlans.filter(isInvalidOneClickPlanLike) : [])
      .map((plan) => compactKey(plan?.id))
      .filter(Boolean),
  );
  const hasClientPlanIds = isOneClickProject && originalPlans.some((plan) => {
    const id = compactKey(plan?.id);
    return id && !isPlanningGeneratedPlanId(id);
  });
  const visiblePlans = hasClientPlanIds
    ? originalPlans.filter((plan) => !isPlanningGeneratedPlanId(plan?.id))
    : originalPlans;
  const plans = isOneClickProject
    ? visiblePlans.filter((plan) => !isInvalidOneClickPlanLike(plan))
    : visiblePlans;
  const droppedPlanIds = new Set(
    originalPlans
      .filter((plan) => !plans.some((kept) => compactKey(kept?.id) === compactKey(plan?.id)))
      .map((plan) => compactKey(plan?.id))
      .filter(Boolean),
  );
  const originalResults = Array.isArray(item?.results) ? item.results : [];
  let droppedInvalidCompletedMedia = false;
  const filterDroppedPlans = (items = []) => (
    (Array.isArray(items) ? items : []).filter((entry) => {
      const planId = getPlanIdentity(entry);
      const invalidCompletedMedia = isOneClickProject
        && hasCompletedMediaItem(entry)
        && (
          isInvalidOneClickPlanText(getOneClickPlanContent(entry))
          || (planId && invalidPlanIds.has(planId))
        );
      if (invalidCompletedMedia) droppedInvalidCompletedMedia = true;
      return !invalidCompletedMedia && (!planId || !droppedPlanIds.has(planId));
    })
  );
  const results = pruneSupersededNoMediaItems(filterDroppedPlans(originalResults));
  const schemes = pruneSupersededNoMediaItems(filterDroppedPlans(item?.schemes));
  const planCount = plans.length;
  const stalePlanningFailureCleared = planCount > 0 && hasOnlyStalePlanningFailureResults({ results });
  const normalizedResults = stalePlanningFailureCleared ? [] : results;
  const stateItems = normalizedResults.length > 0 ? normalizedResults : schemes;
  const completedMediaCount = stateItems.filter(hasCompletedMediaItem).length;
  const activeOrFailedCount = stateItems.filter((entry) => (
    isActiveGenerationItem(entry)
    || (['error', 'failed'].includes(String(entry?.status || '')) && !itemHasMedia(entry))
  )).length;
  const hasSingleTerminalBackendFailure = planCount === 0
    && stateItems.length === 1
    && ['error', 'failed'].includes(String(stateItems[0]?.status || ''))
    && !itemHasMedia(stateItems[0])
    && Boolean(compactKey(stateItems[0]?.backendJobId));
  const droppedInvalidPlanningArtifacts = isOneClickProject && (invalidPlanIds.size > 0 || droppedInvalidCompletedMedia);
  const persistedTaskCount = droppedInvalidPlanningArtifacts && completedMediaCount === 0
    ? 0
    : item?.taskCount;
  const taskCount = planCount > 0
    ? maxNumber(planCount, completedMediaCount, activeOrFailedCount, 1)
    : hasSingleTerminalBackendFailure
      ? 1
    : completedMediaCount > 0
      ? maxNumber(completedMediaCount, activeOrFailedCount, 1)
      : maxNumber(persistedTaskCount, stateItems.length, 1);
  const hasGenerating = stateItems.some((entry) => isActiveGenerationItem(entry));
  const hasError = stateItems.some((entry) => ['error', 'failed'].includes(String(entry?.status || '')));
  const hasPlanOnlyPendingItems = isOneClickProject
    && completedMediaCount === 0
    && !hasGenerating
    && !hasError
    && (
      planCount > 0
      || stateItems.some((entry) => (
        ['generating', 'pending', 'queued'].includes(String(entry?.status || ''))
        && !itemHasMedia(entry)
        && !itemHasProviderTaskIdentity(entry)
      ))
    );
  const status = completedMediaCount >= taskCount
    ? 'completed'
    : hasGenerating
      ? 'generating'
      : hasError
        ? 'error'
        : hasPlanOnlyPendingItems
          ? 'planning'
          : item?.status;
  const next = {
    ...(item || {}),
    ...(Array.isArray(item?.plans) ? { plans } : {}),
    ...(Array.isArray(item?.results) ? { results: normalizedResults } : {}),
    ...(Array.isArray(item?.schemes) ? { schemes } : {}),
    taskCount,
    completedCount: stateItems.length > 0 ? completedMediaCount : Number(item?.completedCount || 0) || 0,
    status,
  };
  if (status === 'completed' && completedMediaCount > 0) {
    delete next.error;
    delete next.message;
  }
  return next;
};

const clearResolvedProjectErrorFields = (item = {}) => {
  const completedMediaCount = (Array.isArray(item?.results) ? item.results : []).filter(hasCompletedMediaItem).length;
  if (String(item?.status || '') !== 'completed' || completedMediaCount === 0) return item;
  const next = { ...(item || {}) };
  delete next.error;
  delete next.message;
  return next;
};

const shouldPreserveRecoveredPlanning = (existingItem = {}, incomingItem = {}) => {
  const existingPlans = Array.isArray(existingItem?.plans) ? existingItem.plans : [];
  if (existingItem?.status !== 'planning' || existingPlans.length === 0) return false;
  if (!hasOnlyStalePlanningFailureResults(incomingItem)) return false;
  const existingJobId = compactKey(existingItem?.backendJobId);
  const incomingJobId = compactKey(incomingItem?.backendJobId);
  return !incomingJobId || Boolean(existingJobId && existingJobId === incomingJobId);
};

const getPlanningJobIdentity = (item = {}) => compactKey(item?.backendJobId || item?.planningTaskId);

const isPlanningJobPendingPlaceholder = (result = {}, planningJobId = '') => (
  ['generating', 'pending', 'queued', 'running', 'retry_waiting'].includes(String(result?.status || ''))
  && !itemHasMedia(result)
  && Boolean(planningJobId)
  && compactKey(result?.backendJobId) === planningJobId
  && !compactKey(result?.taskId || result?.providerTaskId || result?.kieTaskId)
);

const shouldClearPlanningPendingPlaceholders = (existingItem = {}, incomingItem = {}) => {
  if (String(incomingItem?.status || '') !== 'planning') return false;
  if (!Array.isArray(incomingItem?.plans) || incomingItem.plans.length === 0) return false;
  if (Array.isArray(incomingItem?.results) && incomingItem.results.length > 0) return false;
  const planningJobId = getPlanningJobIdentity(incomingItem) || getPlanningJobIdentity(existingItem);
  if (!planningJobId) return false;
  return (Array.isArray(existingItem?.results) ? existingItem.results : [])
    .some((result) => isPlanningJobPendingPlaceholder(result, planningJobId));
};

const mergeProjectLikeItem = (existingItem = {}, incomingItem = {}) => {
  const preserveRecoveredPlanning = shouldPreserveRecoveredPlanning(existingItem, incomingItem);
  const clearPlanningPendingPlaceholders = shouldClearPlanningPendingPlaceholders(existingItem, incomingItem);
  const planningJobId = clearPlanningPendingPlaceholders
    ? getPlanningJobIdentity(incomingItem) || getPlanningJobIdentity(existingItem)
    : '';
  const existingResults = clearPlanningPendingPlaceholders
    ? (Array.isArray(existingItem?.results) ? existingItem.results : [])
      .filter((result) => !isPlanningJobPendingPlaceholder(result, planningJobId))
    : existingItem?.results;
  const mergedResults = preserveRecoveredPlanning
    ? []
    : mergeArrayByStableKeys(existingResults, incomingItem?.results);
  const mergedPlans = mergeArrayByStableKeys(existingItem?.plans, incomingItem?.plans);
  const mergedSchemes = mergeArrayByStableKeys(existingItem?.schemes, incomingItem?.schemes);
  const completedMediaCount = mergedResults.filter(hasCompletedMediaItem).length;
  const isDirectVideoGeneration = isDirectVideoGenerationProject(incomingItem) || isDirectVideoGenerationProject(existingItem);
  const taskCount = isDirectVideoGeneration && completedMediaCount > 0
    ? maxNumber(completedMediaCount, mergedResults.length, 1)
    : maxNumber(
    existingItem?.taskCount,
    incomingItem?.taskCount,
    mergedResults.length,
    mergedPlans.length,
    mergedSchemes.length,
  );
  const completedCount = isDirectVideoGeneration && completedMediaCount > 0
    ? completedMediaCount
    : maxNumber(existingItem?.completedCount, incomingItem?.completedCount);
  const planningTaskId = mergeIdentityText(existingItem?.planningTaskId, incomingItem?.planningTaskId);
  const providerTaskId = incomingItem?.providerTaskId || existingItem?.providerTaskId;
  const taskId = incomingItem?.taskId || existingItem?.taskId;
  const kieTaskId = incomingItem?.kieTaskId || existingItem?.kieTaskId;
  const mergedItem = {
    ...(existingItem || {}),
    ...(incomingItem || {}),
    ...(
      hasOwnArray(existingItem, 'results') || hasOwnArray(incomingItem, 'results')
        ? { results: mergedResults }
        : {}
    ),
    ...(
      hasOwnArray(existingItem, 'plans') || hasOwnArray(incomingItem, 'plans')
        ? { plans: mergedPlans }
        : {}
    ),
    ...(
      hasOwnArray(existingItem, 'schemes') || hasOwnArray(incomingItem, 'schemes')
        ? { schemes: mergedSchemes }
        : {}
    ),
    ...(taskCount > 0 ? { taskCount } : {}),
    ...(completedCount > 0 ? { completedCount } : {}),
    ...(planningTaskId ? { planningTaskId } : {}),
    ...(providerTaskId ? { providerTaskId } : {}),
    ...(taskId ? { taskId } : {}),
    ...(kieTaskId ? { kieTaskId } : {}),
  };
  if (!preserveRecoveredPlanning) return normalizeProjectLikeItem(clearResolvedProjectErrorFields(mergedItem));
  return normalizeProjectLikeItem({
    ...mergedItem,
    status: existingItem.status,
    results: [],
    completedCount: Number(existingItem.completedCount || 0) || 0,
  });
};

export const mergeProjectArrayByStableKeys = (existingItems = [], incomingItems = []) => {
  const existing = Array.isArray(existingItems) ? existingItems.filter(Boolean) : [];
  const incoming = Array.isArray(incomingItems) ? incomingItems.filter(Boolean) : [];
  const keyToIndex = new Map();
  const merged = [];

  const registerKeys = (item, index) => {
    collectItemKeys(item, { includeProjectId: true }).forEach((key) => keyToIndex.set(key, index));
  };

  const push = (item, source) => {
    const keys = collectItemKeys(item, { includeProjectId: true });
    const duplicateIndex = Array.from(keys)
      .map((key) => keyToIndex.get(key))
      .find((index) => typeof index === 'number');
    if (typeof duplicateIndex === 'number') {
      const current = merged[duplicateIndex];
      merged[duplicateIndex] = source === 'existing'
        ? mergeProjectLikeItem(item, current)
        : mergeProjectLikeItem(current, item);
      registerKeys(merged[duplicateIndex], duplicateIndex);
      return;
    }
    const index = merged.length;
    merged.push(item);
    registerKeys(item, index);
  };

  incoming.forEach((item) => push(item, 'incoming'));
  existing.forEach((item) => push(item, 'existing'));
  return merged.map((item) => normalizeProjectLikeItem(item));
};

const mergeBranchProjects = (existingBranch = {}, incomingBranch = {}) => {
  const projects = mergeProjectArrayByStableKeys(existingBranch?.projects, incomingBranch?.projects)
    .map((project) => normalizeProjectLikeItem(project, { forceOneClick: true }));
  return {
    ...existingBranch,
    ...incomingBranch,
    projects,
  };
};

const mergeTranslationBranch = (existingBranch = {}, incomingBranch = {}) => ({
  ...existingBranch,
  ...incomingBranch,
  files: mergeArrayByStableKeys(existingBranch?.files, incomingBranch?.files),
});

const mergeVideoMemory = (existingMemory = {}, incomingMemory = {}) => ({
  ...existingMemory,
  ...incomingMemory,
  tasks: mergeArrayByStableKeys(existingMemory?.tasks, incomingMemory?.tasks),
  veoProjects: mergeProjectArrayByStableKeys(existingMemory?.veoProjects, incomingMemory?.veoProjects),
  storyboard: {
    ...(existingMemory?.storyboard || {}),
    ...(incomingMemory?.storyboard || {}),
    projects: mergeProjectArrayByStableKeys(existingMemory?.storyboard?.projects, incomingMemory?.storyboard?.projects),
  },
});

export const mergeAppStateForStorage = (existingState = {}, incomingState = {}) => {
  const mergedDraft = mergeShellDraft(existingState?.shellDraft, incomingState?.shellDraft);
  const existing = applyDeletionTombstones(compactAppStateForStorage(existingState), mergedDraft);
  const incoming = applyDeletionTombstones(compactAppStateForStorage(incomingState), mergedDraft);
  const next = {
    ...existing,
    ...incoming,
  };
  next.shellDraft = mergedDraft;

  next.shellProjects = mergeProjectArrayByStableKeys(existing.shellProjects, incoming.shellProjects);

  next.oneClickMemory = {
    ...(existing.oneClickMemory || {}),
    ...(incoming.oneClickMemory || {}),
    firstImage: mergeBranchProjects(existing.oneClickMemory?.firstImage, incoming.oneClickMemory?.firstImage),
    mainImage: mergeBranchProjects(existing.oneClickMemory?.mainImage, incoming.oneClickMemory?.mainImage),
    detailPage: mergeBranchProjects(existing.oneClickMemory?.detailPage, incoming.oneClickMemory?.detailPage),
    sku: mergeBranchProjects(existing.oneClickMemory?.sku, incoming.oneClickMemory?.sku),
    referencePresets: {
      ...(existing.oneClickMemory?.referencePresets || {}),
      ...(incoming.oneClickMemory?.referencePresets || {}),
      presets: mergeArrayByStableKeys(
        existing.oneClickMemory?.referencePresets?.presets,
        incoming.oneClickMemory?.referencePresets?.presets,
      ),
    },
  };

  next.translationMemory = {
    ...(existing.translationMemory || {}),
    ...(incoming.translationMemory || {}),
    main: mergeTranslationBranch(existing.translationMemory?.main, incoming.translationMemory?.main),
    detail: mergeTranslationBranch(existing.translationMemory?.detail, incoming.translationMemory?.detail),
    removeText: mergeTranslationBranch(existing.translationMemory?.removeText, incoming.translationMemory?.removeText),
  };

  next.retouchMemory = {
    ...(existing.retouchMemory || {}),
    ...(incoming.retouchMemory || {}),
    tasks: mergeArrayByStableKeys(existing.retouchMemory?.tasks, incoming.retouchMemory?.tasks),
  };

  next.buyerShowMemory = {
    ...(existing.buyerShowMemory || {}),
    ...(incoming.buyerShowMemory || {}),
    sets: mergeProjectArrayByStableKeys(existing.buyerShowMemory?.sets, incoming.buyerShowMemory?.sets),
    tasks: mergeArrayByStableKeys(existing.buyerShowMemory?.tasks, incoming.buyerShowMemory?.tasks),
  };

  next.videoMemory = mergeVideoMemory(existing.videoMemory, incoming.videoMemory);

  next.xhsCoverMemory = {
    ...(existing.xhsCoverMemory || {}),
    ...(incoming.xhsCoverMemory || {}),
    projects: mergeProjectArrayByStableKeys(existing.xhsCoverMemory?.projects, incoming.xhsCoverMemory?.projects),
    tasks: mergeArrayByStableKeys(existing.xhsCoverMemory?.tasks, incoming.xhsCoverMemory?.tasks),
  };

  return compactAppStateForStorage(next);
};
