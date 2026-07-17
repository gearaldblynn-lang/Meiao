import {
  compactKey,
  collectItemKeys,
  getProductRestoreExpectedTargetCount,
  hasMissingProductRestoreTargets,
  mergeArrayByStableKeys,
} from '../src/utils/taskResultReconcile.mjs';
import { getPlanContent, isLegacyFailureText, isPlanFailed } from '../src/utils/planFailure.mjs';
import { mergeShellDraftForStorage } from './appStateDraftMerge.mjs';
import { isProviderErrorText } from './providerErrorText.mjs';
import { isIdentitylessActivePlaceholder, projectBuckets as collectProjectBuckets } from './appStateHealth.mjs';
import {
  hasEffectiveProductRestoreCancellation,
  mergeProductRestoreGenerationContextForStorage,
} from '../src/utils/productRestoreDurableState.mjs';
import {
  getShellProjectIdentityAliases,
  normalizeShellProjectScope,
} from '../src/utils/shellProjectScope.mjs';
const cloneJson = (value) => JSON.parse(JSON.stringify(value || {}));

const ONE_CLICK_BRANCH_KEYS = ['firstImage', 'mainImage', 'detailPage', 'sku'];
const TRANSLATION_BRANCH_KEYS = ['main', 'detail', 'removeText'];

const getOneClickPlanContent = (item = {}) => getPlanContent(item);
const isInvalidOneClickPlanText = (value) => isLegacyFailureText(value);
const isInvalidOneClickPlanLike = (item = {}) => isPlanFailed(item);
const normalizeInvalidPlanAsFailedPlanningCard = (plan = {}) => {
  if (plan?.planningFailed || !isInvalidOneClickPlanLike(plan)) return plan;
  const message = getOneClickPlanContent(plan) || compactKey(plan?.error) || '策划失败';
  return {
    ...plan,
    selected: false,
    status: 'error',
    error: message,
    planningFailed: true,
    schemeContent: message,
    sceneDescription: compactKey(plan?.sceneDescription) || message,
    textLayout: compactKey(plan?.textLayout) || message,
  };
};
const idSet = (values) => new Set(
  (Array.isArray(values) ? values : [])
    .map((value) => compactKey(value))
    .filter(Boolean),
);

const isInlineImageDataUrl = (value) => (
  typeof value === 'string' && /^data:image\//i.test(value.trim())
);

const stripInlinePreviewUrl = (value) => isInlineImageDataUrl(value) ? '' : value;

const compactGenerationContextForStorage = (context = {}) => {
  if (!context || typeof context !== 'object') return context;
  const {
    projects,
    activeProjectId,
    isGenerating,
    isAnalyzing,
    tasks,
    ...compactContext
  } = context;
  return compactContext;
};

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
  if (compactProject.generationContext && typeof compactProject.generationContext === 'object') {
    compactProject.generationContext = compactGenerationContextForStorage(compactProject.generationContext);
  }
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

const projectAge = (project) => {
  if (!project || typeof project !== 'object') return 0;
  return Number(project.updatedAt || project.completedAt || project.createdAt || 0);
};

const collectTrimmableBuckets = (state) => {
  const buckets = [];
  if (Array.isArray(state?.shellProjects)) {
    buckets.push({ array: state.shellProjects });
  }
  if (state?.oneClickMemory && typeof state.oneClickMemory === 'object') {
    ONE_CLICK_BRANCH_KEYS.forEach((key) => {
      const branch = state.oneClickMemory[key];
      if (branch && Array.isArray(branch.projects)) {
        buckets.push({ array: branch.projects });
      }
    });
  }
  return buckets;
};

export const trimAppStateForStorage = (state = {}, maxBytes) => {
  if (!state || typeof state !== 'object') return state;
  if (!maxBytes || maxBytes <= 0) return state;
  const next = cloneJson(state);
  let size = JSON.stringify(next).length;
  if (size <= maxBytes) return next;

  const activeId = compactKey(next.activeProjectId);
  const buckets = collectTrimmableBuckets(next);

  const findOldestVictim = ({ allowSingletonBuckets }) => {
    let victim = null;
    buckets.forEach((bucket) => {
      if (!allowSingletonBuckets && bucket.array.length <= 1) return;
      bucket.array.forEach((project, index) => {
        if (project && compactKey(project.id) === activeId && activeId) return;
        const age = projectAge(project);
        if (victim == null || age < victim.age) {
          victim = { bucket, index, age };
        }
      });
    });
    return victim;
  };

  while (size > maxBytes) {
    const victim = findOldestVictim({ allowSingletonBuckets: false });
    if (!victim) break;
    victim.bucket.array.splice(victim.index, 1);
    size = JSON.stringify(next).length;
  }

  return next;
};

const buildDeletionSets = (draft = {}) => ({
  jobIds: idSet(draft?.deletedJobIds),
  projectIds: idSet(draft?.deletedProjectIds),
  resultIds: idSet(draft?.deletedResultIds),
});

const itemMatchesDeletion = (item, deletionSets, mode = 'item') => {
  if (!item || typeof item !== 'object') return false;
  const ids = [
    ...getShellProjectIdentityAliases(item),
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

const getTranslationFileMergeKeys = (file = {}) => {
  const keys = new Set();
  const add = (prefix, value) => {
    const normalized = compactKey(value);
    if (normalized) keys.add(`${prefix}:${normalized}`);
  };
  add('id', file?.id);
  add('job', file?.backendJobId);
  add('provider', file?.providerTaskId || file?.taskId || file?.kieTaskId);
  add('source', file?.sourceUrl || file?.sourcePreviewUrl);
  if (file?.projectId && file?.fileName) add('project-file', `${file.projectId}:${file.fileName}`);
  return keys;
};

const hasCompletedTranslationFile = (file = {}) => (
  ['completed', 'succeeded', 'success'].includes(String(file?.status || ''))
  && Boolean(file?.resultUrl || file?.imageUrl)
);

const mergeTranslationFile = (existing = {}, incoming = {}) => {
  const next = hasCompletedTranslationFile(existing) && !hasCompletedTranslationFile(incoming)
    ? { ...(incoming || {}), ...(existing || {}) }
    : { ...(existing || {}), ...(incoming || {}) };
  if (hasCompletedTranslationFile(next)) {
    delete next.error;
    delete next.message;
  }
  return next;
};

const mergeTranslationFiles = (existingFiles = [], incomingFiles = []) => {
  const existing = Array.isArray(existingFiles) ? existingFiles.filter(Boolean) : [];
  const incoming = Array.isArray(incomingFiles) ? incomingFiles.filter(Boolean) : [];
  const merged = [];
  const keyToIndex = new Map();
  const register = (file, index) => {
    getTranslationFileMergeKeys(file).forEach((key) => keyToIndex.set(key, index));
  };
  const push = (file) => {
    const matchedIndex = Array.from(getTranslationFileMergeKeys(file))
      .map((key) => keyToIndex.get(key))
      .find((index) => typeof index === 'number');
    if (typeof matchedIndex === 'number') {
      merged[matchedIndex] = mergeTranslationFile(merged[matchedIndex], file);
      register(merged[matchedIndex], matchedIndex);
      return;
    }
    const index = merged.length;
    merged.push(file);
    register(file, index);
  };
  incoming.forEach(push);
  existing.forEach(push);
  return merged;
};

const isExecutableActiveTranslationFile = (file = {}) => (
  ['pending', 'uploading', 'processing'].includes(String(file?.status || ''))
  && Boolean(compactKey(
    file?.backendJobId
    || file?.providerTaskId
    || file?.taskId
    || file?.kieTaskId
    || file?.sourceUrl
    || file?.sourcePreviewUrl
  ))
);

const splitIdentityText = (value) => String(value || '')
  .split(/[,\s]+/)
  .map((item) => item.trim())
  .filter(Boolean);

const INTERNAL_BACKEND_JOB_ID_PATTERN = /^[a-f0-9]{24}$/i;

const latestProviderTaskIdentityText = (...values) => {
  const merged = Array.from(new Set(
    values
      .flatMap(splitIdentityText)
      .filter((item) => !INTERNAL_BACKEND_JOB_ID_PATTERN.test(item)),
  ));
  return merged.at(-1) || '';
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

const isTransientNoIdentityRuntimePlaceholder = (item = {}) => {
  const status = String(item?.status || '');
  if (!['error', 'failed', 'generating', 'pending', 'queued'].includes(status)) return false;
  if (itemHasMedia(item)) return false;
  if (compactKey(item?.backendJobId || item?.taskId || item?.providerTaskId || item?.kieTaskId)) return false;
  const message = compactKey(item?.error || item?.message || item?.prompt || item?.detail || item?.title);
  return /网络连接失败|请求超时|failed to fetch|fetch failed|dynamically imported module|任务状态同步失败|任务已提交云端|结果待同步/i.test(message);
};

const isProviderPollutionText = (value) => {
  return isProviderErrorText(value);
};

const isInvalidNoIdentityOneClickResult = (item = {}) => {
  const status = String(item?.status || '');
  if (!['error', 'failed', 'generating', 'pending', 'queued'].includes(status)) return false;
  if (itemHasMedia(item)) return false;
  if (compactKey(item?.backendJobId || item?.taskId || item?.providerTaskId || item?.kieTaskId)) return false;
  return isProviderPollutionText(getOneClickPlanContent(item));
};

const isActiveGenerationItem = (item = {}) => (
  ['generating', 'pending', 'queued', 'running', 'retry_waiting', 'uploading', 'processing'].includes(String(item?.status || ''))
  && itemHasProviderTaskIdentity(item)
);

const getPlanIdentity = (item = {}) => compactKey(item?.planId || item?.id);

const pruneSupersededNoMediaItems = (items = []) => {
  const normalizedItems = Array.isArray(items) ? items : [];
  const hasCompletedMedia = normalizedItems.some(hasCompletedMediaItem);
  const completedPlanIds = new Set(
    normalizedItems
      .filter(hasCompletedMediaItem)
      .map(getPlanIdentity)
      .filter(Boolean),
  );
  if (!hasCompletedMedia) return normalizedItems;
  return normalizedItems.filter((item) => {
    if (isTransientNoIdentityRuntimePlaceholder(item)) return false;
    const planId = getPlanIdentity(item);
    if (!planId || !completedPlanIds.has(planId)) return true;
    const status = String(item?.status || '');
    if (!['error', 'failed', 'generating', 'pending', 'queued'].includes(status) || itemHasMedia(item)) return true;
    return Boolean(compactKey(item?.taskId || item?.providerTaskId || item?.kieTaskId));
  });
};

const isProductRestoreProjectLike = (item = {}) => (
  String(item?.module || '') === 'retouch'
  && String(item?.subFeature || '') === 'product_restore'
);

const normalizeProjectLikeItem = (item = {}, options = {}) => {
  item = normalizeShellProjectScope(item);
  const isOneClickProject = options.forceOneClick || String(item?.module || '') === 'one_click';
  const originalPlans = Array.isArray(item?.plans) ? item.plans : [];
  const invalidPlanIds = new Set(
    (isOneClickProject ? originalPlans.filter((plan) => !plan?.planningFailed && isInvalidOneClickPlanLike(plan)) : [])
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
    ? visiblePlans.map(normalizeInvalidPlanAsFailedPlanningCard)
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
      const invalidNoIdentityFailure = isOneClickProject && isInvalidNoIdentityOneClickResult(entry);
      const noIdentityFailureForFailedPlan = isOneClickProject
        && planId
        && invalidPlanIds.has(planId)
        && !itemHasMedia(entry)
        && !compactKey(entry?.backendJobId || entry?.taskId || entry?.providerTaskId || entry?.kieTaskId)
        && ['error', 'failed', 'generating', 'pending', 'queued'].includes(String(entry?.status || ''));
      if (invalidCompletedMedia) droppedInvalidCompletedMedia = true;
      return !invalidCompletedMedia && !invalidNoIdentityFailure && !noIdentityFailureForFailedPlan && (!planId || !droppedPlanIds.has(planId));
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
  const productRestoreTargetCount = getProductRestoreExpectedTargetCount(item);
  const taskCount = productRestoreTargetCount > 0
    ? maxNumber(productRestoreTargetCount, persistedTaskCount, stateItems.length, 1)
    : planCount > 0
      ? maxNumber(planCount, completedMediaCount, activeOrFailedCount, 1)
      : hasSingleTerminalBackendFailure
        ? 1
      : completedMediaCount > 0 && activeOrFailedCount > 0
        ? completedMediaCount + activeOrFailedCount
      : completedMediaCount > 0
        ? maxNumber(completedMediaCount, activeOrFailedCount, 1)
        : maxNumber(persistedTaskCount, stateItems.length, 1);
  const hasGenerating = stateItems.some((entry) => isActiveGenerationItem(entry));
  const hasFailedPlan = isOneClickProject && plans.some((plan) => plan?.planningFailed || ['error', 'failed'].includes(String(plan?.status || '')));
  const hasError = hasFailedPlan || stateItems.some((entry) => ['error', 'failed'].includes(String(entry?.status || '')));
  const hasCompletedMedia = completedMediaCount > 0;
  const hasMissingProductRestoreTarget = hasMissingProductRestoreTargets({
    ...item,
    results: normalizedResults,
    taskCount,
  }, normalizedResults);
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
  const hasProductRestoreCancellation = isProductRestoreProjectLike(item)
    && hasEffectiveProductRestoreCancellation(item?.generationContext);
  const hasProductRestoreRetryReset = isProductRestoreProjectLike(item)
    && Boolean(item?.generationContext?.productRestoreCancellationReset)
    && !hasProductRestoreCancellation;
  const status = hasProductRestoreCancellation
    ? 'error'
    : hasMissingProductRestoreTarget
    ? 'generating'
    : hasCompletedMedia && !hasGenerating && !hasError
      ? 'completed'
      : completedMediaCount >= taskCount
        ? 'completed'
        : hasGenerating
          ? 'generating'
          : hasError
            ? 'error'
            : hasPlanOnlyPendingItems
              ? 'planning'
              : hasProductRestoreRetryReset && ['error', 'failed', 'interrupted'].includes(String(item?.status || ''))
                ? 'generating'
              : item?.status;
  const next = {
    ...(item || {}),
    ...(Array.isArray(item?.plans) ? { plans } : {}),
    ...(Array.isArray(item?.results) ? { results: normalizedResults } : {}),
    ...(Array.isArray(item?.schemes) ? { schemes } : {}),
    planningTaskId: latestProviderTaskIdentityText(item?.planningTaskId) || undefined,
    taskCount,
    completedCount: stateItems.length > 0
      ? completedMediaCount
      : droppedInvalidPlanningArtifacts
        ? 0
        : Number(item?.completedCount || 0) || 0,
    status,
  };
  if (hasProductRestoreCancellation) {
    next.error = '已手动中断';
    next.errorCode = 'interrupted';
    if (Array.isArray(next.results)) {
      next.results = next.results.map((result) => itemHasMedia(result)
        ? { ...result, status: 'completed', error: undefined, errorCode: undefined }
        : { ...result, status: 'error', error: '已手动中断', errorCode: 'interrupted' });
    }
  }
  if (hasProductRestoreRetryReset && status === 'generating') {
    delete next.error;
    delete next.errorCode;
    delete next.message;
  }
  if (status === 'completed' && completedMediaCount > 0) {
    delete next.error;
    delete next.message;
  }
  return next;
};

const clearResolvedProjectErrorFields = (item = {}) => {
  if (
    isProductRestoreProjectLike(item)
    && hasEffectiveProductRestoreCancellation(item?.generationContext)
  ) return item;
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
  existingItem = normalizeShellProjectScope(existingItem);
  incomingItem = normalizeShellProjectScope(incomingItem);
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
    getProductRestoreExpectedTargetCount({
      ...(existingItem || {}),
      ...(incomingItem || {}),
    }),
  );
  const completedCount = isDirectVideoGeneration && completedMediaCount > 0
    ? completedMediaCount
    : maxNumber(existingItem?.completedCount, incomingItem?.completedCount);
  const planningTaskId = latestProviderTaskIdentityText(existingItem?.planningTaskId, incomingItem?.planningTaskId);
  const providerTaskId = incomingItem?.providerTaskId || existingItem?.providerTaskId;
  const taskId = incomingItem?.taskId || existingItem?.taskId;
  const kieTaskId = incomingItem?.kieTaskId || existingItem?.kieTaskId;
  const isProductRestore = (
    isProductRestoreProjectLike(existingItem)
    || isProductRestoreProjectLike(incomingItem)
  );
  const generationContext = isProductRestore
    ? mergeProductRestoreGenerationContextForStorage(
        existingItem?.generationContext,
        incomingItem?.generationContext,
      )
    : incomingItem?.generationContext;
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
    ...(isProductRestore && generationContext ? { generationContext } : {}),
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
    const scopedItem = normalizeShellProjectScope(item);
    const keys = collectItemKeys(scopedItem, { includeProjectId: true });
    const duplicateIndex = Array.from(keys)
      .map((key) => keyToIndex.get(key))
      .find((index) => typeof index === 'number');
    if (typeof duplicateIndex === 'number') {
      const current = merged[duplicateIndex];
      merged[duplicateIndex] = source === 'existing'
        ? mergeProjectLikeItem(scopedItem, current)
        : mergeProjectLikeItem(current, scopedItem);
      registerKeys(merged[duplicateIndex], duplicateIndex);
      return;
    }
    const index = merged.length;
    merged.push(scopedItem);
    registerKeys(scopedItem, index);
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

const mergeTranslationBranch = (existingBranch = {}, incomingBranch = {}) => {
  const files = mergeTranslationFiles(existingBranch?.files, incomingBranch?.files);
  return {
    ...existingBranch,
    ...incomingBranch,
    files,
    isProcessing: files.some(isExecutableActiveTranslationFile),
  };
};

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

const buildVeoProjectFromShellVideoProject = (project = {}) => {
  if (!isDirectVideoGenerationProject(project)) return null;
  const result = (Array.isArray(project?.results) ? project.results : []).find((item) => (
    hasCompletedMediaItem(item)
    && (String(item?.mediaType || '') === 'video' || item?.videoUrl)
  ));
  if (!result) return null;
  const videoUrl = compactKey(result.videoUrl || result.imageUrl || result.resultUrl);
  if (!videoUrl) return null;
  const taskId = compactKey(result.taskId || result.providerTaskId || result.id || project.backendJobId);
  const segmentId = `${compactKey(project.id)}-segment-1`;
  return {
    id: project.id,
    name: compactKey(project.name) || '视频生成结果',
    states: [{
      segmentId,
      script: {
        id: segmentId,
        type: 'INITIAL',
        title: '视频生成结果',
        style: '',
        description: compactKey(result.prompt || project.name),
        spokenContent: '',
        bgm: '',
        duration: 0,
      },
      variants: [{
        id: taskId || `${compactKey(project.id)}-video`,
        taskId,
        uri: videoUrl,
        blobUrl: videoUrl,
        createdAt: Number(project.completedAt || result.createdAt || project.createdAt || Date.now()),
        schemeName: '生成结果',
      }],
      selectedVariantId: taskId || `${compactKey(project.id)}-video`,
      status: 'COMPLETED',
      lastTaskId: taskId || undefined,
    }],
    isExpanded: true,
    backendJobId: compactKey(project.backendJobId) || undefined,
    createdAt: project.createdAt,
    updatedAt: project.completedAt || result.createdAt || project.createdAt,
  };
};

const mirrorCompletedDirectVideosIntoVideoMemory = (state = {}) => {
  const mirrors = (Array.isArray(state?.shellProjects) ? state.shellProjects : [])
    .map(buildVeoProjectFromShellVideoProject)
    .filter(Boolean);
  if (mirrors.length === 0) return state;
  const mirrorIds = new Set(mirrors.map((project) => compactKey(project.id)).filter(Boolean));
  const mirrorJobIds = new Set(mirrors.map((project) => compactKey(project.backendJobId)).filter(Boolean));
  const existingProjects = Array.isArray(state?.videoMemory?.veoProjects) ? state.videoMemory.veoProjects : [];
  return {
    ...state,
    videoMemory: {
      ...(state.videoMemory || {}),
      veoProjects: [
        ...mirrors,
        ...existingProjects.filter((project) => {
          const id = compactKey(project?.id);
          const backendJobId = compactKey(project?.backendJobId);
          if (id && mirrorIds.has(id)) return false;
          if (backendJobId && mirrorJobIds.has(backendJobId)) return false;
          return true;
        }),
      ],
    },
  };
};

// D1 写入侧守卫:过期的「无身份活跃占位」在存储合并出口标结构化失败。
// 背景:前端在拿到 backendJobId 前先落 status:'generating' 占位;一旦中断,占位永远"生成中"。
// 存量已由 repair 脚本(mark_active_result_without_identity_failed)清掉,这里堵增量。
// 判据复用 appStateHealth.isIdentitylessActivePlaceholder;有任务身份的活跃结果永不动
// (那是 stale reconciler 的职责)。窗口 env 可调,默认 6h(远大于任何正常提交耗时)。
const DEFAULT_IDENTITYLESS_ACTIVE_TTL_MS = 21600000; // 6 小时

const EXPIRED_IDENTITYLESS_PLACEHOLDER_ERROR_CODE = 'identityless_placeholder_expired';
const EXPIRED_IDENTITYLESS_PLACEHOLDER_MESSAGE = '任务中断且缺少云端任务身份，长时间未恢复，已自动标记失败，请重新生成。';

const resolveIdentitylessActiveTtlMs = () => {
  const raw = Number(process.env.MEIAO_IDENTITYLESS_ACTIVE_TTL_MS || 0);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_IDENTITYLESS_ACTIVE_TTL_MS;
};

const itemAgeTimestampMs = (item = {}) => {
  for (const value of [item?.createdAt, item?.updatedAt, item?.completedAt]) {
    const ms = Number(value || 0);
    if (Number.isFinite(ms) && ms > 0) return ms;
  }
  return 0;
};

const failExpiredIdentitylessPlaceholders = (state = {}) => {
  const now = Date.now();
  const ttlMs = resolveIdentitylessActiveTtlMs();
  const failItem = (item) => {
    if (!item || typeof item !== 'object') return item;
    if (!isIdentitylessActivePlaceholder(item)) return item;
    const timestamp = itemAgeTimestampMs(item);
    if (!timestamp || now - timestamp <= ttlMs) return item; // 判不了龄或窗口内:保守保留,不误杀刚提交的
    return {
      ...item,
      status: 'error',
      errorCode: EXPIRED_IDENTITYLESS_PLACEHOLDER_ERROR_CODE,
      error: compactKey(item?.error) || EXPIRED_IDENTITYLESS_PLACEHOLDER_MESSAGE,
    };
  };
  collectProjectBuckets(state).forEach((bucket) => {
    const forceOneClick = bucket.path.startsWith('oneClickMemory.');
    bucket.projects.forEach((project, index) => {
      if (!project || typeof project !== 'object') return;
      let changed = false;
      const mapItems = (items) => items.map((item) => {
        const nextItem = failItem(item);
        if (nextItem !== item) changed = true;
        return nextItem;
      });
      const results = Array.isArray(project.results) ? mapItems(project.results) : project.results;
      const schemes = Array.isArray(project.schemes) ? mapItems(project.schemes) : project.schemes;
      if (!changed) return;
      // 项目级状态不手写:复用既有 normalize 推导(结果全失败 → error 等)
      bucket.projects[index] = normalizeProjectLikeItem({
        ...project,
        ...(Array.isArray(project.results) ? { results } : {}),
        ...(Array.isArray(project.schemes) ? { schemes } : {}),
      }, { forceOneClick });
    });
  });
  return state;
};

export const mergeAppStateForStorage = (existingState = {}, incomingState = {}) => {
  const mergedDraft = mergeShellDraftForStorage(existingState?.shellDraft, incomingState?.shellDraft);
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

  return compactAppStateForStorage(mirrorCompletedDirectVideosIntoVideoMemory(failExpiredIdentitylessPlaceholders(next)));
};

export const writeMergedAppStateUnderUserLock = async ({
  user,
  incomingState,
  includeCanonicalState = false,
  withUserLock,
  readState,
  scrubState,
  saveState,
  prepareCanonicalState = (state) => state,
}) => withUserLock(user.id, async (lockResource) => {
  const previousState = await readState(user.id, lockResource);
  const nextState = await scrubState(
    mergeAppStateForStorage(previousState, incomingState),
    user.id,
    lockResource,
  );
  const storedState = await saveState({
    lockResource,
    user,
    previousState,
    nextState,
  });
  const response = { ok: true };
  if (includeCanonicalState) {
    response.state = await prepareCanonicalState(storedState || nextState);
  }
  return response;
});
