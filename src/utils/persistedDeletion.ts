import type { PersistedAppState } from './appState.ts';

export interface PersistedDeletionTarget {
  projectId: string;
  resultId?: string;
  jobIds?: string[];
}

interface TargetSets {
  deleteProjectIds: Set<string>;
  nestedIds: Set<string>;
  allIds: Set<string>;
}

const makeIdSet = (values: Array<string | undefined | null>) => new Set(
  values
    .map((value) => String(value || '').trim())
    .filter(Boolean),
);

const makeTargetSets = (target: PersistedDeletionTarget): TargetSets => {
  const projectIds = makeIdSet([target.projectId]);
  const resultIds = makeIdSet([target.resultId]);
  const jobIds = makeIdSet(target.jobIds || []);
  const isResultDelete = resultIds.size > 0;
  return {
    deleteProjectIds: isResultDelete ? new Set<string>() : projectIds,
    nestedIds: isResultDelete ? new Set([...resultIds, ...jobIds]) : new Set([...projectIds, ...jobIds]),
    allIds: new Set([...projectIds, ...resultIds, ...jobIds]),
  };
};

const matchesTarget = (entry: any, ids: Set<string>) => {
  if (!entry || typeof entry !== 'object') return false;
  const candidateIds = [
    entry.id,
    entry.taskId,
    entry.backendJobId,
    entry.providerTaskId,
    entry.kieTaskId,
    entry.projectId,
    entry.whiteBgTaskId,
    entry.lastTaskId,
  ];
  return candidateIds.some((value) => ids.has(String(value || '').trim()));
};

const filterItems = <T extends Record<string, any>>(items: T[] | undefined, ids: Set<string>) => {
  if (!Array.isArray(items)) return items;
  return items.filter((item) => !matchesTarget(item, ids));
};

const pruneOneClickBranch = (branch: any, targets: TargetSets) => {
  if (!branch || typeof branch !== 'object') return branch;
  const activeProjectId = String(branch.activeProjectId || '').trim();
  const projects = Array.isArray(branch.projects) ? branch.projects : [];
  const nextProjects = projects.flatMap((project: any) => {
    if (!project || typeof project !== 'object') return [];
    if (matchesTarget(project, targets.deleteProjectIds)) return [];

    const nextProject = { ...project };
    if (Array.isArray(project.schemes)) {
      nextProject.schemes = project.schemes.filter((scheme: any) => !matchesTarget(scheme, targets.nestedIds));
      if (project.schemes.length > 0 && nextProject.schemes.length === 0) {
        return [];
      }
    }
    return [nextProject];
  });

  const nextActiveProjectId = nextProjects.some((project: any) => project.id === activeProjectId)
    ? activeProjectId
    : (nextProjects.at(-1)?.id || null);
  const shouldClearCurrentSchemes = targets.deleteProjectIds.has(activeProjectId);

  return {
    ...branch,
    projects: nextProjects,
    activeProjectId: nextActiveProjectId,
    schemes: shouldClearCurrentSchemes
      ? []
      : (Array.isArray(branch.schemes)
        ? branch.schemes.filter((scheme: any) => !matchesTarget(scheme, targets.nestedIds))
        : branch.schemes),
  };
};

const pruneBuyerShowMemory = (memory: any, targets: TargetSets) => {
  if (!memory || typeof memory !== 'object') return memory;
  const sets = Array.isArray(memory.sets) ? memory.sets : [];
  const nextSets = sets.flatMap((set: any) => {
    if (!set || typeof set !== 'object') return [];
    if (matchesTarget(set, targets.deleteProjectIds)) return [];

    const nextSet = { ...set };
    if (Array.isArray(set.tasks)) {
      nextSet.tasks = set.tasks.filter((task: any) => !matchesTarget(task, targets.nestedIds));
      if (set.tasks.length > 0 && nextSet.tasks.length === 0) {
        return [];
      }
    }
    return [nextSet];
  });

  return {
    ...memory,
    tasks: filterItems(memory.tasks, targets.nestedIds) || [],
    sets: nextSets,
  };
};

const pruneVideoMemory = (memory: any, targets: TargetSets) => {
  if (!memory || typeof memory !== 'object') return memory;
  const storyboard = memory.storyboard && typeof memory.storyboard === 'object'
    ? {
        ...memory.storyboard,
        projects: Array.isArray(memory.storyboard.projects)
          ? memory.storyboard.projects.flatMap((project: any) => {
              if (!project || typeof project !== 'object') return [];
              if (matchesTarget(project, targets.deleteProjectIds)) return [];

              const nextProject = { ...project };
              if (Array.isArray(project.shots)) {
                nextProject.shots = project.shots.filter((shot: any) => !matchesTarget(shot, targets.nestedIds));
              }
              if (Array.isArray(project.boards)) {
                nextProject.boards = project.boards.filter((board: any) => !matchesTarget(board, targets.nestedIds));
                if (project.boards.length > 0 && nextProject.boards.length === 0) {
                  return [];
                }
              }
              return [nextProject];
            })
          : memory.storyboard.projects,
        downloadingProjectId: targets.allIds.has(String(memory.storyboard.downloadingProjectId || '').trim())
          ? null
          : memory.storyboard.downloadingProjectId,
      }
    : memory.storyboard;

  return {
    ...memory,
    tasks: filterItems(memory.tasks, targets.nestedIds) || [],
    veoProjects: Array.isArray(memory.veoProjects)
      ? memory.veoProjects.filter((project: any) => !matchesTarget(project, targets.deleteProjectIds))
      : memory.veoProjects,
    storyboard,
    diagnosis: targets.allIds.has('video-diagnosis-result') || targets.allIds.has('video-diagnosis-summary')
      ? {
          ...memory.diagnosis,
          probe: { ...memory.diagnosis?.probe, status: 'idle', error: '', completedAt: null },
          report: { ...memory.diagnosis?.report, status: 'idle', summary: '', evidence: [], inferences: [], actions: [] },
          aiAnalysis: { ...memory.diagnosis?.aiAnalysis, status: 'idle', summary: '', sections: [], topActions: [], error: '', completedAt: null },
        }
      : memory.diagnosis,
  };
};

const pruneTranslationMemory = (memory: any, targets: TargetSets) => {
  if (!memory || typeof memory !== 'object') return memory;
  return {
    ...memory,
    main: { ...memory.main, files: filterItems(memory.main?.files, targets.allIds) || [] },
    detail: { ...memory.detail, files: filterItems(memory.detail?.files, targets.allIds) || [] },
    removeText: { ...memory.removeText, files: filterItems(memory.removeText?.files, targets.allIds) || [] },
  };
};

const pruneRetouchMemory = (memory: any, targets: TargetSets) => {
  if (!memory || typeof memory !== 'object') return memory;
  return {
    ...memory,
    tasks: filterItems(memory.tasks, targets.allIds) || [],
  };
};

const pruneXhsCoverMemory = (memory: any, targets: TargetSets) => {
  if (!memory || typeof memory !== 'object') return memory;
  const projects = Array.isArray(memory.projects) ? memory.projects : [];
  const nextProjects = projects.flatMap((project: any) => {
    if (!project || typeof project !== 'object') return [];
    if (matchesTarget(project, targets.deleteProjectIds)) return [];

    const nextProject = { ...project };
    if (Array.isArray(project.tasks)) {
      nextProject.tasks = project.tasks.filter((task: any) => !matchesTarget(task, targets.nestedIds));
      if (project.tasks.length > 0 && nextProject.tasks.length === 0) {
        return [];
      }
    }
    return [nextProject];
  });

  const activeProjectId = String(memory.activeProjectId || '').trim();
  const nextActiveProjectId = nextProjects.some((project: any) => project.id === activeProjectId)
    ? activeProjectId
    : (nextProjects.at(-1)?.id || null);

  return {
    ...memory,
    projects: nextProjects,
    tasks: filterItems(memory.tasks, targets.nestedIds) || [],
    activeProjectId: nextActiveProjectId,
  };
};

export const prunePersistedAppStateForDeletion = (
  state: PersistedAppState,
  target: PersistedDeletionTarget,
): PersistedAppState => {
  const targets = makeTargetSets(target);
  const shellProjects = Array.isArray(state.shellProjects) ? state.shellProjects.flatMap((project: any) => {
    if (!project || typeof project !== 'object') return [];
    if (matchesTarget(project, targets.deleteProjectIds)) return [];
    const nextProject = { ...project };
    if (Array.isArray(project.results)) {
      nextProject.results = project.results.filter((result: any) => !matchesTarget(result, targets.nestedIds));
      if (project.results.length > 0 && nextProject.results.length === 0) {
        return [];
      }
    }
    if (Array.isArray(project.plans)) {
      nextProject.plans = project.plans.filter((plan: any) => !matchesTarget(plan, targets.nestedIds));
    }
    return [nextProject];
  }) : [];

  return {
    ...state,
    shellProjects,
    oneClickMemory: {
      ...state.oneClickMemory,
      firstImage: pruneOneClickBranch(state.oneClickMemory.firstImage, targets),
      mainImage: pruneOneClickBranch(state.oneClickMemory.mainImage, targets),
      detailPage: pruneOneClickBranch(state.oneClickMemory.detailPage, targets),
      sku: pruneOneClickBranch(state.oneClickMemory.sku, targets),
    },
    translationMemory: pruneTranslationMemory(state.translationMemory, targets),
    retouchMemory: pruneRetouchMemory(state.retouchMemory, targets),
    buyerShowMemory: pruneBuyerShowMemory(state.buyerShowMemory, targets),
    videoMemory: pruneVideoMemory(state.videoMemory, targets),
    xhsCoverMemory: pruneXhsCoverMemory(state.xhsCoverMemory, targets),
  };
};

const LEGACY_POLLUTED_TRANSLATION_MARKERS = [
  'x71k8b1fs',
  '20b6614861108842221f52272c654d92',
  '95075bb37319f72a4c02b164',
  '58fb631330f14c75904f308',
  'file_00000000bb34722f9f44a038497df9fe',
];

const hasLegacyPollutedTranslationMarker = (value: unknown, depth = 0): boolean => {
  if (value == null || depth > 5) return false;
  if (typeof value === 'string') {
    return LEGACY_POLLUTED_TRANSLATION_MARKERS.some((marker) => value.includes(marker));
  }
  if (typeof value === 'number' || typeof value === 'boolean') return false;
  if (Array.isArray(value)) {
    return value.some((item) => hasLegacyPollutedTranslationMarker(item, depth + 1));
  }
  if (typeof value === 'object') {
    return Object.values(value as Record<string, unknown>)
      .some((item) => hasLegacyPollutedTranslationMarker(item, depth + 1));
  }
  return false;
};

const pruneLegacyPollutedTranslationBranch = (branch: any) => {
  if (!branch || typeof branch !== 'object') return branch;
  return {
    ...branch,
    files: Array.isArray(branch.files)
      ? branch.files.filter((file: any) => !hasLegacyPollutedTranslationMarker(file))
      : branch.files,
    isProcessing: Array.isArray(branch.files)
      ? branch.files
          .filter((file: any) => !hasLegacyPollutedTranslationMarker(file))
          .some((file: any) => ['pending', 'uploading', 'processing'].includes(file?.status))
      : branch.isProcessing,
  };
};

export const pruneKnownLegacyGarbageFromPersistedState = (state: PersistedAppState): PersistedAppState => ({
  ...state,
  shellProjects: Array.isArray(state.shellProjects)
    ? state.shellProjects.filter((project: any) => !hasLegacyPollutedTranslationMarker(project))
    : [],
  translationMemory: {
    ...state.translationMemory,
    main: pruneLegacyPollutedTranslationBranch(state.translationMemory?.main),
    detail: pruneLegacyPollutedTranslationBranch(state.translationMemory?.detail),
    removeText: pruneLegacyPollutedTranslationBranch(state.translationMemory?.removeText),
  },
});
