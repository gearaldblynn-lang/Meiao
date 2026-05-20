const cloneJson = (value) => JSON.parse(JSON.stringify(value || {}));

const ONE_CLICK_BRANCH_KEYS = ['firstImage', 'mainImage', 'detailPage', 'sku'];
const TRANSLATION_BRANCH_KEYS = ['main', 'detail', 'removeText'];

const compactKey = (value) => String(value || '').trim();
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

const collectItemKeys = (item) => {
  const keys = new Set();
  const add = (prefix, value) => {
    const normalized = compactKey(value);
    if (normalized) keys.add(`${prefix}:${normalized}`);
  };
  add('id', item?.id);
  add('job', item?.backendJobId);
  add('provider', item?.providerTaskId || item?.taskId || item?.kieTaskId);
  add('project', item?.projectId);
  if (Array.isArray(item?.results)) {
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

  const push = (item) => {
    const keys = collectItemKeys(item);
    const hasKnownDuplicate = Array.from(keys).some((key) => seen.has(key));
    if (hasKnownDuplicate) return;
    keys.forEach((key) => seen.add(key));
    merged.push(item);
  };

  incoming.forEach(push);
  existing.forEach(push);
  return merged;
};

const mergeBranchProjects = (existingBranch = {}, incomingBranch = {}) => ({
  ...existingBranch,
  ...incomingBranch,
  projects: mergeArrayByStableKeys(existingBranch?.projects, incomingBranch?.projects),
});

const mergeTranslationBranch = (existingBranch = {}, incomingBranch = {}) => ({
  ...existingBranch,
  ...incomingBranch,
  files: mergeArrayByStableKeys(existingBranch?.files, incomingBranch?.files),
});

const mergeVideoMemory = (existingMemory = {}, incomingMemory = {}) => ({
  ...existingMemory,
  ...incomingMemory,
  tasks: mergeArrayByStableKeys(existingMemory?.tasks, incomingMemory?.tasks),
  veoProjects: mergeArrayByStableKeys(existingMemory?.veoProjects, incomingMemory?.veoProjects),
  storyboard: {
    ...(existingMemory?.storyboard || {}),
    ...(incomingMemory?.storyboard || {}),
    projects: mergeArrayByStableKeys(existingMemory?.storyboard?.projects, incomingMemory?.storyboard?.projects),
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

  next.shellProjects = mergeArrayByStableKeys(existing.shellProjects, incoming.shellProjects);

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
    sets: mergeArrayByStableKeys(existing.buyerShowMemory?.sets, incoming.buyerShowMemory?.sets),
    tasks: mergeArrayByStableKeys(existing.buyerShowMemory?.tasks, incoming.buyerShowMemory?.tasks),
  };

  next.videoMemory = mergeVideoMemory(existing.videoMemory, incoming.videoMemory);

  next.xhsCoverMemory = {
    ...(existing.xhsCoverMemory || {}),
    ...(incoming.xhsCoverMemory || {}),
    projects: mergeArrayByStableKeys(existing.xhsCoverMemory?.projects, incoming.xhsCoverMemory?.projects),
    tasks: mergeArrayByStableKeys(existing.xhsCoverMemory?.tasks, incoming.xhsCoverMemory?.tasks),
  };

  return compactAppStateForStorage(next);
};
