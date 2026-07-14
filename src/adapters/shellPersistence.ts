import type {
  AppModule,
  ProductRestoreCancellationMarker,
  ProductRestoreCancellationReset,
  ProductRestoreAnalysisAttempt,
  ProductRestoreProjectContext,
  VeoProjectState,
} from '../types.ts';
import type { PersistedAppState } from '../utils/appState.ts';
import { isInvalidOneClickPlanLike, isInvalidOneClickPlanText } from '../utils/oneClickPlanValidation.ts';
import {
  getProductRestoreExpectedTargetCount,
  hasMissingProductRestoreTargets,
  mergeArrayByStableKeys,
} from '../utils/taskResultReconcile.mjs';
import { SHELL_MODULE_LABELS } from './shellDataAdapter.ts';
import {
  cloneProductRestoreCancellationMarker,
  cloneProductRestoreCancellationReset,
  hasDurableProductRestoreCancellation,
  mergeProductRestoreGenerationContext,
} from './shellProductRestoreCancellation.mjs';
import { cloneProductRestoreAnalysisAttempts } from '../utils/productRestoreAnalysisCredits.ts';

const INTERNAL_BACKEND_JOB_ID_PATTERN = /^[a-f0-9]{24}$/i;

const latestProviderTaskIdentityText = (...values: unknown[]) => {
  const merged = Array.from(new Set(
    values
      .flatMap((value) => String(value || '').split(/[,\s]+/))
      .map((item) => item.trim())
      .filter(Boolean)
      .filter((item) => !INTERNAL_BACKEND_JOB_ID_PATTERN.test(item)),
  ));
  return merged.at(-1) || undefined;
};

type ShellResult = {
  id: string;
  imageUrl: string;
  videoUrl?: string;
  mediaType?: 'image' | 'video';
  prompt: string;
  model: string;
  aspectRatio: string;
  status: 'completed' | 'generating' | 'error';
  createdAt: number;
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
  batchIndex?: number;
  targetMaterialId?: string;
  creditsConsumed?: number;
  error?: string;
  matchedAspectRatio?: string;
  logoReplaceGuarded?: boolean;
};

type ShellProject = {
  id: string;
  name: string;
  module: AppModule;
  status: 'planning' | 'generating' | 'completed' | 'error';
  createdAt: number;
  completedAt?: number;
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
      relativePath?: string;
      subFeature?: string;
      giftIndex?: number;
      originalWidth?: number;
      originalHeight?: number;
      logoPlacement?: Record<string, unknown>;
      cornerBadgeRegion?: Record<string, unknown>;
      logoReplaceRegion?: Record<string, unknown>;
      logoReplaceRegions?: Array<Record<string, unknown>>;
    }>>;
    productRestore?: ProductRestoreProjectContext;
    productRestoreAnalysisAttempts?: ProductRestoreAnalysisAttempt[];
    productRestoreCancellation?: ProductRestoreCancellationMarker;
    productRestoreCancellationReset?: ProductRestoreCancellationReset;
  };
  sourceType?: 'persisted' | 'job';
  backendJobId?: string;
  creditsConsumed?: number;
  planningTaskId?: string;
  directGeneration?: boolean;
};

type PersistedVeoProject = VeoProjectState & {
  backendJobId?: string;
  createdAt?: number;
  updatedAt?: number;
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

const cloneShellProject = (project: ShellProject): ShellProject => {
  const generationContext = project.generationContext ? {
    ...project.generationContext,
    params: { ...(project.generationContext.params || {}) },
    materials: Object.fromEntries(
      Object.entries(project.generationContext.materials || {}).map(([type, list]) => [
        type,
        (list || []).map((item) => ({ ...item })),
      ]),
    ),
  } : undefined;
  if (
    generationContext
    && Object.prototype.hasOwnProperty.call(project.generationContext, 'productRestoreAnalysisAttempts')
  ) {
    generationContext.productRestoreAnalysisAttempts = cloneProductRestoreAnalysisAttempts(
      project.generationContext?.productRestoreAnalysisAttempts,
    );
  }
  if (
    generationContext
    && Object.prototype.hasOwnProperty.call(project.generationContext, 'productRestoreCancellationReset')
  ) {
    generationContext.productRestoreCancellationReset = cloneProductRestoreCancellationReset(
      project.generationContext?.productRestoreCancellationReset,
    );
  }
  if (
    generationContext
    && Object.prototype.hasOwnProperty.call(project.generationContext, 'productRestoreCancellation')
  ) {
    generationContext.productRestoreCancellation = cloneProductRestoreCancellationMarker(
      project.generationContext?.productRestoreCancellation,
    );
  }
  return {
    ...project,
    sourceType: 'persisted',
    results: Array.isArray(project.results) ? project.results.map((result) => ({ ...result })) : [],
    plans: Array.isArray(project.plans) ? project.plans.map((plan) => ({ ...plan })) : undefined,
    generationContext,
  };
};

const compactKey = (value: unknown) => String(value || '').trim();

const isDirectVideoGenerationProject = (project: Partial<ShellProject>) => (
  project.module === 'video'
  && project.subFeature === 'generation'
);

const buildVeoProjectFromShellProject = (project: ShellProject): PersistedVeoProject | null => {
  if (!isDirectVideoGenerationProject(project)) return null;
  const completedVideoResult = (project.results || []).find((result) => (
    result.status === 'completed'
    && (result.mediaType === 'video' || result.videoUrl)
    && (result.videoUrl || result.imageUrl)
  ));
  if (!completedVideoResult) return null;
  const videoUrl = compactKey(completedVideoResult.videoUrl || completedVideoResult.imageUrl);
  if (!videoUrl) return null;
  const taskId = compactKey(
    completedVideoResult.taskId
    || completedVideoResult.providerTaskId
    || completedVideoResult.id
    || project.backendJobId
  );
  const segmentId = `${project.id}-segment-1`;
  return {
    id: project.id,
    name: project.name,
    states: [{
      segmentId,
      script: {
        id: segmentId,
        type: 'INITIAL' as const,
        title: '视频生成结果',
        style: '',
        description: compactKey(completedVideoResult.prompt || project.name),
        spokenContent: '',
        bgm: '',
        duration: 0,
      },
      variants: [{
        id: taskId || `${project.id}-video`,
        taskId,
        uri: videoUrl,
        blobUrl: videoUrl,
        createdAt: Number(project.completedAt || completedVideoResult.createdAt || project.createdAt || Date.now()),
        schemeName: '生成结果',
      }],
      selectedVariantId: taskId || `${project.id}-video`,
      status: 'COMPLETED' as const,
      lastTaskId: taskId || undefined,
    }],
    isExpanded: true,
    backendJobId: compactKey(project.backendJobId) || undefined,
    createdAt: project.createdAt,
    updatedAt: project.completedAt || completedVideoResult.createdAt || project.createdAt,
  };
};

const upsertVideoProjectIntoVeoMemory = (
  state: PersistedAppState,
  project: ShellProject,
): PersistedAppState => {
  const veoProject = buildVeoProjectFromShellProject(project);
  if (!veoProject) return state;
  const videoMemory = state.videoMemory || {} as PersistedAppState['videoMemory'];
  const existingProjects: PersistedVeoProject[] = Array.isArray(videoMemory.veoProjects) ? videoMemory.veoProjects : [];
  const projectId = compactKey(veoProject.id);
  const backendJobId = compactKey(veoProject.backendJobId);
  const nextProjects: PersistedVeoProject[] = [
    veoProject,
    ...existingProjects.filter((item: any) => {
      if (compactKey(item?.id) === projectId) return false;
      if (backendJobId && compactKey(item?.backendJobId) === backendJobId) return false;
      return true;
    }),
  ];
  return {
    ...state,
    videoMemory: {
      ...videoMemory,
      veoProjects: nextProjects,
    },
  };
};

const hasCompletedMedia = (item: any) => (
  String(item?.status || '') === 'completed'
  && Boolean(item?.imageUrl || item?.videoUrl || item?.resultUrl)
);

const hasAnyMedia = (item: any) => Boolean(item?.imageUrl || item?.videoUrl || item?.resultUrl);

const hasProviderTaskIdentity = (item: any) => Boolean(String(item?.taskId || item?.providerTaskId || item?.kieTaskId || '').trim());

const hasGeneratingState = (item: any) => (
  ['generating', 'pending', 'queued', 'uploading', 'processing'].includes(String(item?.status || ''))
  && hasProviderTaskIdentity(item)
);

const hasErrorState = (item: any) => ['error', 'failed', 'interrupted'].includes(String(item?.status || ''));

// Persisted snapshots can outlive product-facing module renames. Keep former
// fallback labels recognizable so a stale placeholder does not reappear after
// the current label changes (for example, 产品精修 -> 图片升级).
const LEGACY_SHELL_MODULE_LABELS: Record<string, string[]> = {
  retouch: ['产品精修'],
};

const getShellModuleFallbackLabels = (module: unknown) => {
  const moduleKey = compactKey(module);
  return [
    SHELL_MODULE_LABELS[moduleKey],
    ...(LEGACY_SHELL_MODULE_LABELS[moduleKey] || []),
  ].filter(Boolean);
};

const ALL_SHELL_MODULE_FALLBACK_LABELS = new Set([
  ...Object.values(SHELL_MODULE_LABELS),
  ...Object.values(LEGACY_SHELL_MODULE_LABELS).flat(),
]);

// 漂移③ 修复:不再硬编码 '一键主详',改为读模块标签常量,并推广到所有模块。
// 当 prompt 等于该模块自己的中文标签 fallback,且无 media/无 provider 身份时,
// 这条记录就是"假占位"——以前只保护 one_click,现在所有模块同款保护。
// scheme 这类没 module 字段的元素,退化为"prompt 命中任意已知模块标签",
// 仍需配合无 media/无身份/有 backendJobId 或 -pending 才命中,误判概率极低。
const isStaleFallbackPromptPlaceholderItem = (item: any) => {
  const content = compactKey(item?.prompt || item?.schemeContent || item?.editedContent || item?.originalContent);
  if (!content) return false;
  const moduleLabels = getShellModuleFallbackLabels(item?.module);
  const matchesFallbackLabel = moduleLabels.length > 0
    ? moduleLabels.includes(content)
    : ALL_SHELL_MODULE_FALLBACK_LABELS.has(content);
  if (!matchesFallbackLabel) return false;
  const id = compactKey(item?.id);
  return (
    (String(item?.status || '') === 'generating' || /-pending$/i.test(id))
    && !hasAnyMedia(item)
    && !hasProviderTaskIdentity(item)
    && (Boolean(compactKey(item?.backendJobId)) || /-pending$/i.test(id))
  );
};

const isInvalidOneClickCompletedMediaItem = (item: any) => (
  hasCompletedMedia(item)
  && isInvalidOneClickPlanText(item?.prompt || item?.editedContent || item?.originalContent || item?.schemeContent || item?.error)
);

const filterStaleOneClickPlanningPlaceholders = <T extends Record<string, any>>(
  items: T[] | undefined,
  isOneClick: boolean,
  kind: 'result' | 'plan' | 'scheme',
) => (
  (items || []).filter((item) => {
    // fallback-prompt 占位检测对所有模块生效,不再只保护 one_click
    if (isStaleFallbackPromptPlaceholderItem(item)) return false;
    if (!isOneClick) return true;
    if (kind === 'plan' && isInvalidOneClickPlanLike(item)) return false;
    if ((kind === 'result' || kind === 'scheme') && isInvalidOneClickCompletedMediaItem(item)) return false;
    return true;
  })
);

const mergeProjectLikeForPersistence = <T extends Record<string, any>>(existingProject: T | undefined, incomingProject: T): T => {
  const baseProject = existingProject || {} as T;
  const isOneClick = String(incomingProject.module || baseProject.module || '') === 'one_click';
  const results = mergeArrayByStableKeys(
    filterStaleOneClickPlanningPlaceholders(baseProject.results, isOneClick, 'result'),
    filterStaleOneClickPlanningPlaceholders(incomingProject.results, isOneClick, 'result'),
  );
  const plans = mergeArrayByStableKeys(
    filterStaleOneClickPlanningPlaceholders(baseProject.plans, isOneClick, 'plan'),
    filterStaleOneClickPlanningPlaceholders(incomingProject.plans, isOneClick, 'plan'),
  );
  const schemes = mergeArrayByStableKeys(
    filterStaleOneClickPlanningPlaceholders(baseProject.schemes, isOneClick, 'scheme'),
    filterStaleOneClickPlanningPlaceholders(incomingProject.schemes, isOneClick, 'scheme'),
  );
  const stateItems = results.length > 0 ? results : schemes;
  const completedCount = stateItems.filter(hasCompletedMedia).length;
  const hasGenerating = stateItems.some(hasGeneratingState);
  const hasError = stateItems.some(hasErrorState);
  const hasCompletedMediaItem = completedCount > 0;
  const isOneClickPlanOnly = isOneClick
    && plans.length > 0
    && completedCount === 0
    && !hasGenerating
    && !hasError;
  const productRestoreProject = {
    ...baseProject,
    ...incomingProject,
    results,
  };
  const taskCount = Math.max(
    Number(baseProject.taskCount || 0) || 0,
    Number(incomingProject.taskCount || 0) || 0,
    plans.length,
    schemes.length,
    stateItems.length,
    getProductRestoreExpectedTargetCount(productRestoreProject),
    1,
  );
  const hasMissingProductRestoreTarget = hasMissingProductRestoreTargets({
    ...productRestoreProject,
    taskCount,
  }, results);
  const generationContext = mergeProductRestoreGenerationContext(
    baseProject.generationContext,
    incomingProject.generationContext,
  );
  const durablyCancelled = hasDurableProductRestoreCancellation({ generationContext });
  const status = durablyCancelled
    ? 'error'
    : hasMissingProductRestoreTarget
      ? 'generating'
      : hasCompletedMediaItem && !hasGenerating && !hasError
        ? 'completed'
        : completedCount >= taskCount
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
    planningTaskId: latestProviderTaskIdentityText(baseProject.planningTaskId, incomingProject.planningTaskId),
    taskCount,
    completedCount,
    status,
    generationContext,
  };
  if (!durablyCancelled && status === 'completed' && completedCount > 0) {
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
    id,
    name,
    status,
    schemes,
    plans,
    selectedPlanId,
    results,
    taskCount,
    completedCount,
    planningTaskId,
    backendJobId,
    creditsConsumed,
    completedAt,
    error,
    message,
    isDraft,
    directGeneration,
    generationContext,
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
  const nextState = {
    ...state,
    shellProjects: [
      mergedProject,
      ...existingProjects.filter((item: any) => String(item?.id || '') !== String(project.id || '')),
    ],
  };
  return upsertVideoProjectIntoVeoMemory(nextState, mergedProject);
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
  const plans = Array.isArray(project.plans)
    ? project.plans.filter((plan) => !isInvalidOneClickPlanLike(plan))
    : [];
  const results = (Array.isArray(project.results) ? project.results : [])
    .filter((result) => !isInvalidOneClickCompletedMediaItem(result));
  const schemes = plans.length > 0
    ? plans.map((plan, index) => {
        const matchingResult = results.find((result) => result.planId === plan.id)
          || (results[index] && !String(results[index].planId || '').trim() ? results[index] : undefined);
        return buildSchemeFromPlan(project, plan, matchingResult, index);
      })
    : results.map((result, index) => buildSchemeFromResult(project, result, index));
  const persistedProject = {
    ...cloneOneClickBranchProjectBase(branch as unknown as Record<string, unknown>),
    id: project.id,
    name: project.name,
    createdAt: now,
    updatedAt: now,
    isDraft: project.status !== 'completed',
    schemes,
    plans,
    selectedPlanId: plans.some((plan) => String(plan.id || '') === String(project.selectedPlanId || ''))
      ? project.selectedPlanId
      : plans.find((plan) => plan.selected)?.id || null,
    generationContext: project.generationContext,
    creditsConsumed: project.creditsConsumed,
    planningTaskId: latestProviderTaskIdentityText(project.planningTaskId),
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

const getTranslationFileMergeKeys = (file: Partial<ShellTranslationFile> = {}) => {
  const keys = new Set<string>();
  const add = (prefix: string, value: unknown) => {
    const normalized = String(value || '').trim();
    if (normalized) keys.add(`${prefix}:${normalized}`);
  };
  add('id', file.id);
  add('job', (file as any).backendJobId);
  add('provider', file.taskId);
  add('source', file.sourceUrl || file.sourcePreviewUrl);
  if (file.projectId && file.fileName) add('project-file', `${file.projectId}:${file.fileName}`);
  return keys;
};

const hasCompletedTranslationResult = (file: Partial<ShellTranslationFile> = {}) =>
  file.status === 'completed' && Boolean(file.resultUrl);

const mergeTranslationFile = (existing: ShellTranslationFile, incoming: ShellTranslationFile): ShellTranslationFile => {
  const merged = hasCompletedTranslationResult(existing) && !hasCompletedTranslationResult(incoming)
    ? { ...incoming, ...existing }
    : { ...existing, ...incoming };
  if (hasCompletedTranslationResult(merged)) {
    delete (merged as any).error;
  }
  return merged;
};

const mergeTranslationFilesForStorage = (
  existingFiles: ShellTranslationFile[],
  incomingFiles: ShellTranslationFile[],
) => {
  const merged: ShellTranslationFile[] = [];
  const keyToIndex = new Map<string, number>();
  const register = (file: ShellTranslationFile, index: number) => {
    getTranslationFileMergeKeys(file).forEach((key) => keyToIndex.set(key, index));
  };
  const push = (file: ShellTranslationFile) => {
    const matchedIndex = Array.from(getTranslationFileMergeKeys(file))
      .map((key) => keyToIndex.get(key))
      .find((index): index is number => typeof index === 'number');
    if (typeof matchedIndex === 'number') {
      merged[matchedIndex] = mergeTranslationFile(merged[matchedIndex], file);
      register(merged[matchedIndex], matchedIndex);
      return;
    }
    const nextIndex = merged.length;
    merged.push(file);
    register(file, nextIndex);
  };
  incomingFiles.forEach(push);
  existingFiles.forEach(push);
  return merged;
};

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
  const nextFiles = mergeTranslationFilesForStorage(existingFiles, nextFilesInput);
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
