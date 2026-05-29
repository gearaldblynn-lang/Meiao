import type { AppModule } from '../types.ts';
import type { PersistedAppState } from '../utils/appState.ts';

type ShellResult = {
  id: string;
  imageUrl: string;
  videoUrl?: string;
  mediaType?: 'image' | 'video';
  prompt: string;
  model: string;
  aspectRatio: string;
  status: 'completed' | 'generating' | 'error';
  createdAt: string;
  module: AppModule;
  subFeature?: string;
  planId?: string;
  sourceUrl?: string;
  sourcePreviewUrl?: string;
  fileName?: string;
  relativePath?: string;
  taskId?: string;
  providerTaskId?: string;
  backendJobId?: string;
  creditsConsumed?: number;
  error?: string;
  matchedAspectRatio?: string;
};

type ShellProject = {
  id: string;
  name: string;
  module: AppModule;
  status: 'planning' | 'generating' | 'completed' | 'error';
  createdAt: string;
  completedAt?: string;
  results: ShellResult[];
  taskCount: number;
  completedCount: number;
  subFeature?: string;
  plans?: Array<{
    id: string;
    title: string;
    sellingPoints: string[];
    sceneDescription: string;
    styleDirection: string;
    colorPalette: string;
    composition: string;
    textLayout: string;
    selected: boolean;
    schemeContent?: string;
    sourceReferenceUrl?: string;
    variationMode?: 'scene' | 'palette' | 'custom';
    variationInstruction?: string;
    editInstruction?: string;
    sourceResultUrl?: string;
  }>;
  selectedPlanId?: string;
  generationContext?: {
    prompt: string;
    params: Record<string, string>;
    materials: Record<string, Array<{
      id: string;
      type: string;
      url: string;
      remoteUrl?: string;
      localAssetId?: string;
      fileName: string;
      subFeature?: string;
      giftIndex?: number;
    }>>;
  };
  sourceType?: 'persisted' | 'job';
  backendJobId?: string;
  creditsConsumed?: number;
  planningTaskId?: string;
  directGeneration?: boolean;
};

type ShellTranslationFile = {
  id: string;
  fileName?: string;
  relativePath?: string;
  status: 'pending' | 'uploading' | 'processing' | 'completed' | 'error' | 'interrupted';
  progress: number;
  sourceUrl?: string;
  sourcePreviewUrl?: string;
  resultUrl?: string;
  matchedAspectRatio?: string;
  error?: string;
  taskId?: string;
  prompt?: string;
  model?: string;
  aspectRatio?: string;
  subFeature?: string;
  projectId?: string;
  projectName?: string;
  projectCreatedAt?: number | string;
  batchId?: string;
  groupId?: string;
};

const SUBFEATURE_TO_BRANCH_KEY: Record<string, 'firstImage' | 'mainImage' | 'detailPage' | 'sku'> = {
  first_image: 'firstImage',
  main_image: 'mainImage',
  detail_page: 'detailPage',
  sku: 'sku',
};

const TRANSLATION_BRANCH_KEY: Record<string, 'main' | 'detail' | 'removeText'> = {
  main: 'main',
  detail: 'detail',
  remove_text: 'removeText',
  removeText: 'removeText',
};

const cloneShellProject = (project: ShellProject): ShellProject => ({
  ...project,
  sourceType: 'persisted',
  results: Array.isArray(project.results) ? project.results.map((result) => ({ ...result })) : [],
  plans: Array.isArray(project.plans) ? project.plans.map((plan) => ({ ...plan })) : undefined,
  generationContext: project.generationContext ? {
    ...project.generationContext,
    params: { ...(project.generationContext.params || {}) },
    materials: Object.fromEntries(
      Object.entries(project.generationContext.materials || {}).map(([type, list]) => [
        type,
        (list || []).map((item) => ({ ...item })),
      ]),
    ),
  } : undefined,
});

const compactKey = (value: unknown) => String(value || '').trim();

const collectMergeKeys = (item: any) => {
  const keys = new Set<string>();
  const add = (prefix: string, value: unknown) => {
    const normalized = compactKey(value);
    if (normalized) keys.add(`${prefix}:${normalized}`);
  };
  add('id', item?.id);
  add('job', item?.backendJobId);
  add('provider', item?.providerTaskId || item?.taskId || item?.kieTaskId);
  add('plan', item?.planId);
  return keys;
};

const mergeArrayByStableKeys = <T extends Record<string, any>>(existingItems: T[] = [], incomingItems: T[] = []) => {
  const keyToIndex = new Map<string, number>();
  const merged: T[] = [];

  const register = (item: T, index: number) => {
    collectMergeKeys(item).forEach((key) => keyToIndex.set(key, index));
  };

  const push = (item: T, source: 'existing' | 'incoming') => {
    if (!item) return;
    const duplicateIndex = Array.from(collectMergeKeys(item))
      .map((key) => keyToIndex.get(key))
      .find((index) => typeof index === 'number');
    if (typeof duplicateIndex === 'number') {
      const current = merged[duplicateIndex];
      merged[duplicateIndex] = source === 'incoming'
        ? { ...current, ...item }
        : { ...item, ...current };
      register(merged[duplicateIndex], duplicateIndex);
      return;
    }
    const index = merged.length;
    merged.push({ ...item });
    register(item, index);
  };

  incomingItems.filter(Boolean).forEach((item) => push(item, 'incoming'));
  existingItems.filter(Boolean).forEach((item) => push(item, 'existing'));
  return merged;
};

const hasCompletedMedia = (item: any) => (
  String(item?.status || '') === 'completed'
  && Boolean(item?.imageUrl || item?.videoUrl || item?.resultUrl)
);

const hasProviderTaskIdentity = (item: any) => Boolean(String(item?.taskId || item?.providerTaskId || item?.kieTaskId || '').trim());

const hasGeneratingState = (item: any) => (
  ['generating', 'pending', 'queued', 'uploading', 'processing'].includes(String(item?.status || ''))
  && hasProviderTaskIdentity(item)
);

const hasErrorState = (item: any) => ['error', 'failed', 'interrupted'].includes(String(item?.status || ''));

const mergeProjectLikeForPersistence = <T extends Record<string, any>>(existingProject: T | undefined, incomingProject: T): T => {
  const baseProject = existingProject || {} as T;
  const results = mergeArrayByStableKeys(baseProject.results, incomingProject.results);
  const plans = mergeArrayByStableKeys(baseProject.plans, incomingProject.plans);
  const schemes = mergeArrayByStableKeys(baseProject.schemes, incomingProject.schemes);
  const stateItems = results.length > 0 ? results : schemes;
  const completedCount = stateItems.filter(hasCompletedMedia).length;
  const hasGenerating = stateItems.some(hasGeneratingState);
  const hasError = stateItems.some(hasErrorState);
  const isOneClickPlanOnly = String(incomingProject.module || baseProject.module || '') === 'one_click'
    && plans.length > 0
    && completedCount === 0
    && !hasGenerating
    && !hasError;
  const taskCount = Math.max(
    Number(baseProject.taskCount || 0) || 0,
    Number(incomingProject.taskCount || 0) || 0,
    plans.length,
    schemes.length,
    stateItems.length,
    1,
  );
  const status = completedCount >= taskCount
    ? 'completed'
    : hasGenerating
      ? 'generating'
      : hasError
        ? 'error'
        : isOneClickPlanOnly
          ? 'planning'
          : incomingProject.status || baseProject.status;
  const merged = {
    ...baseProject,
    ...incomingProject,
    ...(Array.isArray(baseProject.results) || Array.isArray(incomingProject.results) ? { results } : {}),
    ...(Array.isArray(baseProject.plans) || Array.isArray(incomingProject.plans) ? { plans } : {}),
    ...(Array.isArray(baseProject.schemes) || Array.isArray(incomingProject.schemes) ? { schemes } : {}),
    taskCount,
    completedCount,
    status,
  };
  if (status === 'completed' && completedCount > 0) {
    delete merged.error;
    delete merged.message;
  }
  return merged as T;
};

const isInlineImageDataUrl = (value: unknown) => (
  typeof value === 'string' && /^data:image\//i.test(value.trim())
);

const stripInlinePreviewUrl = (value: unknown) => isInlineImageDataUrl(value) ? '' : value;

const cloneOneClickBranchProjectBase = (branch: Record<string, unknown> = {}) => {
  const {
    projects,
    activeProjectId,
    isGenerating,
    isAnalyzing,
    tasks,
    ...projectBase
  } = branch;
  return projectBase;
};

export const upsertShellProjectIntoPersistedState = (
  state: PersistedAppState,
  project: ShellProject,
): PersistedAppState => {
  const nextProject = cloneShellProject(project);
  const existingProjects = Array.isArray(state.shellProjects) ? state.shellProjects : [];
  const existingProject = existingProjects.find((item: any) => String(item?.id || '') === String(project.id || ''));
  const mergedProject = cloneShellProject(mergeProjectLikeForPersistence(existingProject, nextProject) as ShellProject);
  return {
    ...state,
    shellProjects: [
      mergedProject,
      ...existingProjects.filter((item: any) => String(item?.id || '') !== String(project.id || '')),
    ],
  };
};

const buildSchemeFromResult = (project: ShellProject, result: ShellResult, index: number) => {
  const prompt = String(result.prompt || project.name || `结果 ${index + 1}`).trim();
  const resultUrl = String(result.videoUrl || result.imageUrl || '').trim() || undefined;
  const taskId = String(result.taskId || result.providerTaskId || '').trim() || undefined;
  const backendJobId = String(result.backendJobId || '').trim() || undefined;
  return {
    id: String(result.id || `${project.id}-result-${index}`),
    taskId,
    backendJobId,
    uiTitle: project.results.length > 1 ? `${project.name} ${index + 1}` : project.name,
    originalContent: prompt,
    editedContent: prompt,
    status: result.status === 'error' ? 'error' : result.status === 'generating' ? 'generating' : 'completed',
    selected: true,
    resultUrl,
    error: result.status === 'error' ? prompt : undefined,
    extractedRatio: result.aspectRatio,
    subFeature: project.subFeature,
    sourceResultUrl: resultUrl,
    creditsConsumed: result.status === 'completed' ? result.creditsConsumed : undefined,
  };
};

const buildSchemeFromPlan = (
  project: ShellProject,
  plan: NonNullable<ShellProject['plans']>[number],
  result: ShellResult | undefined,
  index: number,
) => {
  const schemeContent = String(
    plan.schemeContent
    || plan.textLayout
    || plan.sceneDescription
    || plan.styleDirection
    || plan.title
    || project.name
    || `方案 ${index + 1}`
  ).trim();
  const resultUrl = String(result?.videoUrl || result?.imageUrl || '').trim() || undefined;
  const taskId = String(result?.taskId || result?.providerTaskId || '').trim() || undefined;
  const backendJobId = String(result?.backendJobId || '').trim() || undefined;
  return {
    id: String(plan.id || result?.id || `${project.id}-plan-${index}`),
    taskId,
    backendJobId,
    uiTitle: String(plan.title || project.name || `方案 ${index + 1}`).trim(),
    originalContent: schemeContent,
    editedContent: schemeContent,
    sourceReferenceUrl: String(plan.sourceReferenceUrl || '').trim() || undefined,
    variationMode: plan.variationMode,
    variationInstruction: String(plan.variationInstruction || '').trim() || undefined,
    sourceResultUrl: String(plan.sourceResultUrl || resultUrl || '').trim() || undefined,
    status: result?.status === 'error'
      ? 'error'
      : result?.status === 'generating'
        ? taskId ? 'generating' : 'pending'
        : resultUrl
          ? 'completed'
          : 'pending',
    selected: plan.selected !== false,
    resultUrl,
    error: result?.status === 'error' ? String(result.prompt || '任务失败') : undefined,
    extractedRatio: result?.aspectRatio,
    subFeature: project.subFeature,
    creditsConsumed: result?.status === 'completed' ? result.creditsConsumed : undefined,
  };
};

export const upsertOneClickProjectIntoPersistedState = (
  state: PersistedAppState,
  project: ShellProject,
): PersistedAppState => {
  if (project.module !== 'one_click') return state;
  const branchKey = SUBFEATURE_TO_BRANCH_KEY[project.subFeature || ''];
  if (!branchKey) return state;

  const branch = state.oneClickMemory[branchKey];
  const now = Date.now();
  const plans = Array.isArray(project.plans) ? project.plans : [];
  const schemes = plans.length > 0
    ? plans.map((plan, index) => {
        const matchingResult = project.results.find((result) => result.planId === plan.id) || project.results[index];
        return buildSchemeFromPlan(project, plan, matchingResult, index);
      })
    : project.results.map((result, index) => buildSchemeFromResult(project, result, index));
  const persistedProject = {
    ...cloneOneClickBranchProjectBase(branch as unknown as Record<string, unknown>),
    id: project.id,
    name: project.name,
    createdAt: now,
    updatedAt: now,
    isDraft: project.status !== 'completed',
    schemes,
    plans,
    selectedPlanId: project.selectedPlanId || plans.find((plan) => plan.selected)?.id || null,
    generationContext: project.generationContext,
    creditsConsumed: project.creditsConsumed,
    planningTaskId: project.planningTaskId,
    directGeneration: project.directGeneration,
  };
  const existingBranchProjects = Array.isArray(branch.projects) ? branch.projects : [];
  const existingBranchProject = existingBranchProjects.find((item: any) => String(item?.id || '') === String(project.id || ''));
  const mergedPersistedProject = mergeProjectLikeForPersistence(
    existingBranchProject as Record<string, any> | undefined,
    persistedProject as Record<string, any>,
  );
  const nextProjects = [
    ...existingBranchProjects.filter((item: any) => String(item?.id || '') !== String(project.id || '')),
    mergedPersistedProject,
  ];

  return {
    ...state,
    oneClickMemory: {
      ...state.oneClickMemory,
      [branchKey]: {
        ...mergedPersistedProject,
        projects: nextProjects,
        activeProjectId: project.id,
        schemes: mergedPersistedProject.schemes || schemes,
      },
    },
  };
};

const sanitizeTranslationFileForStorage = (file: ShellTranslationFile): ShellTranslationFile => ({
  ...file,
  sourcePreviewUrl: stripInlinePreviewUrl(file.sourcePreviewUrl) as string | undefined,
});

export const upsertTranslationFilesIntoPersistedState = (
  state: PersistedAppState,
  subFeature: string,
  files: ShellTranslationFile[],
): PersistedAppState => {
  const branchKey = TRANSLATION_BRANCH_KEY[subFeature || 'main'] || 'main';
  const translationMemory = state.translationMemory || {
    main: { files: [], isProcessing: false },
    detail: { files: [], isProcessing: false },
    removeText: { files: [], isProcessing: false },
  };
  const branch = translationMemory[branchKey] || { files: [], isProcessing: false };
  const nextFilesInput = Array.isArray(files) ? files.filter((item) => Boolean(item?.id)).map(sanitizeTranslationFileForStorage) : [];
  const existingFiles = Array.isArray(branch.files) ? branch.files.filter((item) => Boolean(item?.id)) : [];
  const nextFileById = new Map<string, ShellTranslationFile>();
  existingFiles.forEach((item) => {
    nextFileById.set(String(item.id), item);
  });
  nextFilesInput.forEach((item) => {
    nextFileById.set(String(item.id), item);
  });
  const nextFiles = Array.from(nextFileById.values());
  const nextState = {
    ...state,
    translationMemory: {
      ...translationMemory,
      [branchKey]: {
        ...branch,
        files: nextFiles,
        isProcessing: nextFiles.some((item) => ['pending', 'uploading', 'processing'].includes(item.status)),
      },
    },
  };
  return nextState;
};
