import './shell/index.css';
import React, { Suspense, lazy, useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { AppModuleObj, AspectRatio, VideoSubMode } from './types';
import type { AppModule, AuthUser, GlobalApiConfig, InternalJob, ModuleInterfaceId, OneClickGenerationContext, OneClickReferencePreset, VideoDiagnosisAnalysisItem, VideoPersistentState, VideoStoryboardBoard, VideoStoryboardConfig, VideoStoryboardProject } from './types';
import SidebarNavigation from './shell/components/layout/SidebarNavigation';
import { ToastProvider, useToast } from './shell/components/ToastSystem';
import LoginScreen from './shell/components/Internal/LoginScreen';
import {
  cancelInternalJob,
  clearCurrentUserContext,
  clearSessionToken,
  deleteInternalJob,
  fetchCurrentUser,
  fetchInternalJob,
  fetchInternalJobs,
  fetchRemoteAppState,
  fetchSystemConfig,
  getCurrentUserContext,
  loginInternalUser,
  logoutInternalUser,
  probeInternalApi,
  retryInternalJob,
  saveRemoteAppState,
  safeCreateInternalLog,
  storeCurrentUserContext,
  storeSessionToken,
  probeVideoDiagnosis,
  analyzeVideoDiagnosis,
  uploadInternalAssetStream,
} from './services/internalApi';
import type { PersistedAppState } from './utils/appState';
import { ThemeContext } from './shell/context/ThemeContext';
import { filterProjectsForScope } from './adapters/shellScopeFilters';
import { pruneKnownLegacyGarbageFromPersistedState, prunePersistedAppStateForDeletion } from './utils/persistedDeletion';
import { playCompletionSound, primeCompletionSound } from './utils/soundUtils';
import type { SystemPublicConfig } from './types';
import { mergeShellRuntimeEntities } from './adapters/shellRuntimeMerge';
import { extractShellSchemeField } from './adapters/shellSchemeFields';
import { resolvePublicAssetUrl } from './utils/modelAssetUrl.mjs';
import { getShellDraftStateKey, loadShellDraftState, normalizeShellDraftState, resolveHydratedShellDraftState, saveShellDraftState } from './utils/shellDraftState';
import { getImageDimensions, getImageDimensionsFromUrl } from './utils/imageUtils';
import { safeCreateObjectURL } from './utils/urlUtils';
import { countCompletedProjectResults, mergeGeneratedPlanResults } from './utils/shellProjectResults.mjs';
import { isInvalidOneClickPlanLike } from './utils/oneClickPlanValidation.ts';
import { mergeShellRuntimeDeletionDrafts, pruneShellRuntimeSnapshotForDeletion } from './utils/shellRuntimePrune.mjs';
import { isFrontendResourceError } from './utils/frontendResourceError.mjs';
import { deleteShellDraftAsset, loadShellDraftAsset, pruneShellDraftAssets, restoreShellDraftAssetUrls, saveShellDraftAsset } from './utils/shellDraftAssetStore';
import { deriveTranslationExecutionPlan } from './modules/Translation/translationProcessingUtils.mjs';
import {
  getRetouchCustomSizeRatioWarning,
  getSafeRetouchAspectRatioForModel,
} from './modules/Retouch/retouchSizingUtils.mjs';
import { getEffectiveConcurrency } from './modules/Account/accountManagementUtils.mjs';
import { isRecoverableKieTaskResult, recoverKieAiTask } from './services/kieAiService';
import { buildStoryboardBoardGenerationImport } from './shell/modules/Video/storyboardImportUtils.mjs';
import { resolveShellSkuCount } from './adapters/shellSkuCount';
import { buildOneClickPlanGenerationMaterials } from './adapters/shellOneClickMaterials.mjs';
import {
  filterMaterialsForSkuUpload,
  resetSkuInputStateForProductUpload,
  shouldResetSkuInputTextForUpload,
  shouldResetSkuMaterialsForUpload,
} from './adapters/shellSkuUploadReset.mjs';
import { collectFailedOneClickPlanningPlans } from './adapters/shellPlanningFailure.ts';

const BottomInputBar = lazy(() => import('./shell/components/layout/BottomInputBar'));
const LandingPage = lazy(() => import('./shell/components/LandingPage'));
const AgentCenterModule = lazy(() => import('./shell/modules/AgentCenter/AgentCenterModule'));
const TranslationModule = lazy(() => import('./shell/modules/Translation/TranslationModule'));
const OneClickModule = lazy(() => import('./shell/modules/OneClick/OneClickModule'));
const RetouchModule = lazy(() => import('./shell/modules/Retouch/RetouchModule'));
const EverythingReplaceModule = lazy(() => import('./shell/modules/EverythingReplace/EverythingReplaceModule'));
const BuyerShowModule = lazy(() => import('./shell/modules/BuyerShow/BuyerShowModule'));
const VideoModule = lazy(() => import('./shell/modules/Video/VideoModule'));
const XhsCoverModule = lazy(() => import('./shell/modules/XhsCover/XhsCoverModule'));
const GlobalApiSettings = lazy(() => import('./shell/modules/Settings/GlobalApiSettings'));
const AccountManagement = lazy(() => import('./shell/modules/Account/AccountManagement'));

const traceStartup = (label: string) => {
  if (typeof window === 'undefined' || !import.meta.env.DEV) return;
  const entry = { label, t: performance.now() };
  const win = window as typeof window & { __MEIAO_STARTUP_TRACE__?: Array<typeof entry> };
  win.__MEIAO_STARTUP_TRACE__ = [...(win.__MEIAO_STARTUP_TRACE__ || []), entry];
  console.info(`[MEIAO startup] ${label} ${entry.t.toFixed(1)}ms`);
};

const normalizeShellImageModel = (value: unknown) => {
  const normalized = String(value || '').toLowerCase();
  if (normalized.includes('nano') || normalized.includes('banana')) return 'nano-banana-2';
  if (normalized.includes('secondary') || normalized.includes('副')) return 'gpt-image-2-secondary';
  return 'gpt-image-2';
};

/* ═══════════════════════════════════════════
   Types
   ═══════════════════════════════════════════ */

export interface GeneratedResult {
  id: string;
  planId?: string;
  projectId?: string;
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
  sourceUrl?: string;
  sourcePreviewUrl?: string;
  fileName?: string;
  relativePath?: string;
  taskId?: string;
  backendJobId?: string;
  batchIndex?: number;
  creditsConsumed?: number;
  error?: string;
  matchedAspectRatio?: string;
  dynamicScriptPrompt?: string;
  storyboardBoardTitle?: string;
  storyboardBoardIndex?: number;
  storyboardBoardCount?: number;
  storyboardProjectStatus?: VideoStoryboardProject['status'];
  storyboardImageVersions?: Array<{
    id: string;
    imageUrl: string;
    prompt?: string;
    taskId?: string;
    creditsConsumed?: number;
    revisionInstruction?: string;
    createdAt: number;
  }>;
}

export interface Material {
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
}

const isTransientMaterialUrl = (url?: string) => {
  const value = String(url || '').trim();
  return !value || value.startsWith('blob:') || value.startsWith('data:');
};

const shouldRefreshVideoAssetUrl = (url?: string, hasLocalAsset = false) => {
  const { host, path } = (() => {
    try {
      const parsed = new URL(String(url || ''));
      return { host: parsed.hostname.toLowerCase(), path: parsed.pathname.toLowerCase() };
    } catch {
      return { host: '', path: (String(url || '').split('?')[0] || '').toLowerCase() };
    }
  })();
  if (!path) return false;
  if (hasLocalAsset && host === 'tempfileb.aiquickdraw.com' && path.includes('/kieai/openrouter-chat/')) return true;
  if (hasLocalAsset && host === 'tempfile.redpandaai.co' && path.includes('/openrouter-chat/')) return true;
  return !/\.(mp4|mov|webm|m4v)$/i.test(path);
};

const shouldRefreshExpiringMaterialUrl = (url?: string, hasLocalAsset = false) => {
  if (!hasLocalAsset) return false;
  try {
    const parsed = new URL(String(url || ''));
    const host = parsed.hostname.toLowerCase();
    return host === 'tempfile.redpandaai.co' || host === 'tempfile.aiquickdraw.com' || host === 'tempfileb.aiquickdraw.com';
  } catch {
    return false;
  }
};

const buildGenerationSubmitLockKey = (module: AppModule, subFeature?: string) => `${module}:${subFeature || 'default'}`;

const latestIdentityText = (...values: unknown[]) => {
  const merged = Array.from(new Set(
    values
      .flatMap((value) => String(value || '').split(/[,\s]+/))
      .map((item) => item.trim())
      .filter(Boolean),
  ));
  return merged.at(-1) || undefined;
};

const sortGeneratedResultsByBatchIndex = (items: GeneratedResult[]) => (
  [...items].sort((a, b) => {
    const aIndex = Number(a.batchIndex || 0);
    const bIndex = Number(b.batchIndex || 0);
    if (aIndex > 0 && bIndex > 0 && aIndex !== bIndex) return aIndex - bIndex;
    if (aIndex > 0 && bIndex <= 0) return -1;
    if (aIndex <= 0 && bIndex > 0) return 1;
    return 0;
  })
);

const shouldGuardGenerationSubmit = (module: AppModule, subFeature?: string) => (
  !(module === AppModuleObj.EVERYTHING_REPLACE && subFeature === 'product_replace')
  && (
    module === AppModuleObj.ONE_CLICK
    || module === AppModuleObj.TRANSLATION
    || module === AppModuleObj.BUYER_SHOW
    || module === AppModuleObj.RETOUCH
    || module === AppModuleObj.EVERYTHING_REPLACE
    || module === AppModuleObj.VIDEO
    || module === AppModuleObj.XHS_COVER
  )
);

const hasRuntimeTaskIdentity = (item?: {
  backendJobId?: unknown;
  taskId?: unknown;
  providerTaskId?: unknown;
  planningTaskId?: unknown;
}) => Boolean(String(
  item?.backendJobId
  || item?.taskId
  || item?.providerTaskId
  || item?.planningTaskId
  || ''
).trim());

const cloneMaterialSnapshot = (material: Material) => {
  const persistedUrl = material.remoteUrl || (isTransientMaterialUrl(material.url) ? '' : material.url);
  return {
    id: material.id,
    type: material.type,
    url: persistedUrl,
    remoteUrl: persistedUrl || undefined,
    localAssetId: material.localAssetId,
    fileName: material.fileName,
    relativePath: material.relativePath,
    subFeature: material.subFeature,
    giftIndex: material.giftIndex,
    originalWidth: material.originalWidth,
    originalHeight: material.originalHeight,
    logoPlacement: material.logoPlacement,
  };
};

const cloneGenerationContext = (
  prompt: string,
  params: Record<string, string>,
  materials: Record<string, Material[]>,
): OneClickGenerationContext => ({
  prompt,
  params: { ...params },
  materials: Object.fromEntries(
    Object.entries(materials).map(([type, list]) => [
      type,
      (list || []).map((item) => cloneMaterialSnapshot(item)),
    ]),
  ),
});

const hasMaterialInputs = (materials?: Record<string, Material[]>) =>
  Object.values(materials || {}).some((list) =>
    (list || []).some((item) => Boolean(item?.remoteUrl || item?.url || item?.localAssetId)),
  );

const isRecoverableShellWorkflowResult = (result: unknown) => {
  const record = result as { status?: string; taskId?: string; message?: string; errorCode?: string } | null;
  if (!record || typeof record !== 'object') return false;
  if (String(record.status || '') === 'generating') return Boolean(String(record.taskId || '').trim());
  if (String(record.status || '') !== 'error') return false;
  return isRecoverableKieTaskResult(record.taskId, record.message, record.errorCode);
};

export interface PlanItem {
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
  status?: 'error';
  error?: string;
  planningFailed?: boolean;
}

export interface Project {
  id: string;
  name: string;
  module: AppModule;
  status: 'planning' | 'generating' | 'completed' | 'error';
  createdAt: number;
  completedAt?: number;
  createdAtPrecise?: boolean;
  results: GeneratedResult[];
  plans?: PlanItem[];
  selectedPlanId?: string;
  taskCount: number;
  completedCount: number;
  subFeature?: string;
  sourceType?: 'persisted' | 'job';
  backendJobId?: string;
  planningTaskId?: string;
  generationContext?: OneClickGenerationContext;
  directGeneration?: boolean;
  storyboardProjectStatus?: VideoStoryboardProject['status'];
  storyboardSourceProject?: VideoStoryboardProject;
  creditsConsumed?: number;
  error?: string;
}

export interface Task {
  id: string;
  projectId: string;
  module: AppModule;
  type: 'image' | 'video' | 'plan' | 'batch';
  status: 'pending' | 'generating' | 'completed' | 'error';
  title: string;
  progress?: number;
  createdAt: number;
  total?: number;
  completed?: number;
  subFeature?: string;
  backendJobId?: string;
  prompt?: string;
}

const SHELL_MANUAL_CANCEL_ERROR = '已手动中断';

const normalizeShellCancelId = (value: unknown) => String(value || '').trim();

const addShellCancelId = (ids: Set<string>, value: unknown) => {
  const normalized = normalizeShellCancelId(value);
  if (normalized) ids.add(normalized);
};

const collectShellResultIds = (result?: Partial<GeneratedResult> | null) => {
  const ids = new Set<string>();
  addShellCancelId(ids, result?.id);
  addShellCancelId(ids, result?.backendJobId);
  addShellCancelId(ids, result?.taskId);
  addShellCancelId(ids, result?.projectId);
  return ids;
};

const collectShellProjectIds = (project?: Partial<Project> | null) => {
  const ids = new Set<string>();
  addShellCancelId(ids, project?.id);
  addShellCancelId(ids, project?.backendJobId);
  addShellCancelId(ids, project?.planningTaskId);
  return ids;
};

const collectShellTaskIds = (task?: Partial<Task> | null) => {
  const ids = new Set<string>();
  addShellCancelId(ids, task?.id);
  addShellCancelId(ids, task?.projectId);
  addShellCancelId(ids, task?.backendJobId);
  return ids;
};

const shellCancelTargetMatches = (targetId: string, ids: Set<string>) => ids.has(targetId);

const shellResultHasMedia = (result?: Partial<GeneratedResult> | null) => Boolean(result?.imageUrl || result?.videoUrl);

const isShellResultCancellable = (result?: Partial<GeneratedResult> | null) => (
  Boolean(result)
  && !shellResultHasMedia(result)
  && (result?.status === 'generating' || hasRuntimeTaskIdentity(result))
);

const collectShellCancelJobIds = (targetId: string, projects: Project[], tasks: Task[]) => {
  const jobIds = new Set<string>();
  tasks.forEach((task) => {
    if (shellCancelTargetMatches(targetId, collectShellTaskIds(task))) addShellCancelId(jobIds, task.backendJobId);
  });
  projects.forEach((project) => {
    const projectMatches = shellCancelTargetMatches(targetId, collectShellProjectIds(project));
    if (projectMatches) addShellCancelId(jobIds, project.backendJobId);
    (project.results || []).forEach((result) => {
      if ((projectMatches || shellCancelTargetMatches(targetId, collectShellResultIds(result))) && isShellResultCancellable(result)) {
        addShellCancelId(jobIds, result.backendJobId);
      }
    });
  });
  return Array.from(jobIds);
};

const collectShellCancelControllerIds = (targetId: string, projects: Project[], tasks: Task[]) => {
  const controllerIds = new Set<string>([targetId].filter(Boolean));
  tasks.forEach((task) => {
    if (!shellCancelTargetMatches(targetId, collectShellTaskIds(task))) return;
    collectShellTaskIds(task).forEach((id) => controllerIds.add(id));
  });
  projects.forEach((project) => {
    const projectMatches = shellCancelTargetMatches(targetId, collectShellProjectIds(project));
    if (projectMatches) collectShellProjectIds(project).forEach((id) => controllerIds.add(id));
    (project.results || []).forEach((result) => {
      if (projectMatches || shellCancelTargetMatches(targetId, collectShellResultIds(result))) {
        collectShellResultIds(result).forEach((id) => controllerIds.add(id));
      }
    });
  });
  return Array.from(controllerIds);
};

const markShellProjectCancelled = (project: Project, targetId: string) => {
  const projectMatches = shellCancelTargetMatches(targetId, collectShellProjectIds(project));
  let changed = false;
  const results = (project.results || []).map((result) => {
    const resultMatches = projectMatches || shellCancelTargetMatches(targetId, collectShellResultIds(result));
    if (!resultMatches || !isShellResultCancellable(result)) return result;
    changed = true;
    return {
      ...result,
      status: 'error',
      error: SHELL_MANUAL_CANCEL_ERROR,
    } satisfies GeneratedResult;
  });
  if (!changed && !projectMatches) return { project, changed: false };
  const hasActiveResult = results.some((result) => isShellResultCancellable(result));
  const completedCount = countCompletedProjectResults(results);
  return {
    project: {
      ...project,
      status: hasActiveResult ? project.status : 'error',
      error: SHELL_MANUAL_CANCEL_ERROR,
      results,
      completedCount,
    },
    changed: true,
  };
};

const ONE_CLICK_REMOTE_BRANCH_BY_SUBFEATURE: Record<string, 'firstImage' | 'mainImage' | 'detailPage' | 'sku'> = {
  first_image: 'firstImage',
  main_image: 'mainImage',
  detail_page: 'detailPage',
  sku: 'sku',
};

const TRANSLATION_REMOTE_BRANCH_BY_SUBFEATURE: Record<string, 'main' | 'detail' | 'removeText'> = {
  main: 'main',
  detail: 'detail',
  remove_text: 'removeText',
  removeText: 'removeText',
};

const buildProjectRemotePatch = (
  state: PersistedAppState,
  project: Project,
): Partial<PersistedAppState> => {
  const patch: Partial<PersistedAppState> = {
    shellProjects: Array.isArray(state.shellProjects) ? state.shellProjects : [],
  };
  const branchKey = project.module === AppModuleObj.ONE_CLICK
    ? ONE_CLICK_REMOTE_BRANCH_BY_SUBFEATURE[project.subFeature || '']
    : undefined;
  if (branchKey && state.oneClickMemory?.[branchKey]) {
    patch.oneClickMemory = { [branchKey]: state.oneClickMemory[branchKey] } as Partial<PersistedAppState['oneClickMemory']> as PersistedAppState['oneClickMemory'];
  }
  return patch;
};

const getProjectCompletedMediaCount = (project?: Pick<Project, 'results'> | null) => (
  (project?.results || []).filter((result) => (
    result.status === 'completed' && Boolean(result.imageUrl || result.videoUrl)
  )).length
);

const getProjectErrorResultCount = (project?: Pick<Project, 'results'> | null) => (
  (project?.results || []).filter((result) => result.status === 'error').length
);

const getProjectActiveResultIdentities = (project?: Pick<Project, 'results'> | null) => new Set(
  (project?.results || [])
    .filter((result) => ['generating', 'pending', 'queued'].includes(String(result.status || '')))
    .flatMap((result) => [result.backendJobId, result.taskId])
    .map((value) => String(value || '').trim())
    .filter(Boolean),
);

const isOneClickPlanningPlaceholderText = (value: unknown) => {
  const normalized = String(value || '').trim();
  return normalized === '一键主详';
};

const hasStaleOneClickPlanningPlaceholder = (project?: Pick<Project, 'module' | 'results' | 'plans'> | null) => {
  if (project?.module !== AppModuleObj.ONE_CLICK) return false;
  const hasPlaceholderResult = (project.results || []).some((result) => (
    result.status === 'generating'
    && !result.imageUrl
    && !result.videoUrl
    && !String(result.taskId || '').trim()
    && Boolean(String(result.backendJobId || '').trim())
    && isOneClickPlanningPlaceholderText(result.prompt)
  ));
  if (hasPlaceholderResult) return true;
  return (project.plans || []).some((plan) => {
    const planId = String(plan?.id || '').trim();
    const content = String(
      plan?.schemeContent
      || plan?.textLayout
      || plan?.sceneDescription
      || plan?.styleDirection
      || ''
    ).trim();
    return /-pending$/i.test(planId) && isOneClickPlanningPlaceholderText(content);
  });
};

const getOneClickPlanningFingerprint = (project?: Pick<Project, 'plans'> | null) => (
  (project?.plans || [])
    .map((plan) => [
      String(plan?.id || '').trim(),
      String(
        plan?.schemeContent
        || plan?.textLayout
        || plan?.sceneDescription
        || plan?.styleDirection
        || ''
      ).trim(),
    ].join(':'))
    .filter(Boolean)
    .join('|')
);

const hasPlanningSnapshotChanged = (
  project: Project,
  persistedProject: Project,
) => {
  if (project.module !== AppModuleObj.ONE_CLICK) return false;
  if (project.status !== 'planning') return false;
  if ((project.plans || []).length === 0) return false;
  return hasStaleOneClickPlanningPlaceholder(persistedProject)
    || getOneClickPlanningFingerprint(project) !== getOneClickPlanningFingerprint(persistedProject);
};

const findPersistedShellProject = (state: Partial<PersistedAppState> | null | undefined, projectId: string) => {
  const shellProjects = Array.isArray(state?.shellProjects) ? state.shellProjects : [];
  return shellProjects.find((project) => String(project?.id || '').trim() === projectId);
};

const shouldPersistSyncedProjectFromJobs = (
  project: Project,
  state: Partial<PersistedAppState> | null | undefined,
) => {
  const projectId = String(project?.id || '').trim();
  if (!projectId) return false;
  const persistedProject = findPersistedShellProject(state, projectId) as Project | undefined;
  if (!persistedProject) {
    return project.sourceType === 'job'
      && project.status === 'error'
      && Boolean(String(project.backendJobId || '').trim())
      && getProjectErrorResultCount(project) > 0;
  }
  if (hasPlanningSnapshotChanged(project, persistedProject)) return true;
  if (project.status === 'generating') {
    const persistedActiveIdentities = getProjectActiveResultIdentities(persistedProject);
    const hasNewActiveIdentity = Array.from(getProjectActiveResultIdentities(project))
      .some((identity) => !persistedActiveIdentities.has(identity));
    if (hasNewActiveIdentity) return true;
  }
  const nextCompletedCount = getProjectCompletedMediaCount(project);
  const persistedCompletedCount = getProjectCompletedMediaCount(persistedProject);
  if (nextCompletedCount > persistedCompletedCount) return true;
  if (project.status === 'completed' && persistedProject.status !== 'completed' && nextCompletedCount > 0) return true;
  const nextErrorCount = getProjectErrorResultCount(project);
  const persistedErrorCount = getProjectErrorResultCount(persistedProject);
  if (nextErrorCount > persistedErrorCount) return true;
  return project.status === 'error'
    && (persistedProject.status === 'planning' || persistedProject.status === 'generating')
    && nextErrorCount > 0;
};

const buildTranslationRemotePatch = (
  state: PersistedAppState,
  subFeature: string,
): Partial<PersistedAppState> => {
  const branchKey = TRANSLATION_REMOTE_BRANCH_BY_SUBFEATURE[subFeature || 'main'] || 'main';
  return {
    translationMemory: {
      [branchKey]: state.translationMemory?.[branchKey],
    } as Partial<PersistedAppState['translationMemory']> as PersistedAppState['translationMemory'],
  };
};

type ShellPageMode = 'landing' | 'module' | 'settings' | 'account';

type ShellUiState = {
  pageMode: ShellPageMode;
  activeModule: AppModule;
  activeSubFeatureByModule: Record<string, string>;
  sidebarCollapsed: boolean;
};

type ShellRuntimeSnapshot = {
  projects: Project[];
  tasks: Task[];
  updatedAt: number;
};

const SHELL_UI_STATE_KEY = 'MEIAO_SHELL_UI_STATE_V1';
const SHELL_RUNTIME_STATE_KEY = 'MEIAO_SHELL_RUNTIME_STATE_V1';
const SHELL_PERSISTED_STATE_KEY = 'AIGC_APP_STATE_V1';
const SHELL_SESSION_STATE_KEY = 'MEIAO_SHELL_SESSION_STATE_V1';
const MAX_SHELL_UI_STORAGE_BYTES = 64 * 1024;
const MAX_SHELL_RUNTIME_STORAGE_BYTES = 1024 * 1024;

const getShellScopedStorageKey = (baseKey: string, userId?: string | null) => {
  const scope = String(userId || '').trim();
  return scope ? `${baseKey}:${encodeURIComponent(scope)}` : baseKey;
};

const getShellPersistedStateKey = (userId?: string | null) =>
  getShellScopedStorageKey(SHELL_PERSISTED_STATE_KEY, userId);

type ShellSessionMarker = {
  id: string;
  startedAt: number;
  updatedAt: number;
  closedAt?: number;
  clean?: boolean;
  pageMode?: ShellPageMode;
  activeModule?: AppModule;
  activeSubFeature?: string;
};

const getStorageByteLength = (value: string) => new Blob([value]).size;

const readBoundedLocalStorageItem = (key: string, maxBytes: number) => {
  if (typeof window === 'undefined') return '';
  try {
    const raw = window.localStorage.getItem(key) || '';
    if (!raw) return '';
    if (getStorageByteLength(raw) <= maxBytes) return raw;
    window.localStorage.removeItem(key);
    console.warn(`[MEIAO] ignored oversized localStorage item ${key}`);
    return '';
  } catch {
    return '';
  }
};

const getBrowserStorageDiagnostics = (userId?: string | null) => {
  if (typeof window === 'undefined') return {};
  const keys = [
    getShellScopedStorageKey(SHELL_UI_STATE_KEY, userId),
    getShellScopedStorageKey(SHELL_RUNTIME_STATE_KEY, userId),
    getShellDraftStateKey(userId),
    getShellPersistedStateKey(userId),
  ];
  const localStorageBytesByKey = Object.fromEntries(keys.map((key) => {
    try {
      return [key, getStorageByteLength(window.localStorage.getItem(key) || '')];
    } catch {
      return [key, -1];
    }
  }));
  const memory = (performance as Performance & {
    memory?: { usedJSHeapSize?: number; totalJSHeapSize?: number; jsHeapSizeLimit?: number };
  }).memory;
  return {
    localStorageBytesByKey,
    usedJSHeapSize: memory?.usedJSHeapSize,
    totalJSHeapSize: memory?.totalJSHeapSize,
    jsHeapSizeLimit: memory?.jsHeapSizeLimit,
  };
};

const readShellSessionMarker = (userId?: string | null): ShellSessionMarker | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(getShellScopedStorageKey(SHELL_SESSION_STATE_KEY, userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ShellSessionMarker>;
    if (!parsed || typeof parsed !== 'object' || typeof parsed.id !== 'string') return null;
    return {
      id: parsed.id,
      startedAt: Number(parsed.startedAt || 0),
      updatedAt: Number(parsed.updatedAt || 0),
      closedAt: typeof parsed.closedAt === 'number' ? parsed.closedAt : undefined,
      clean: parsed.clean === true,
      pageMode: isShellPageMode(parsed.pageMode) ? parsed.pageMode : undefined,
      activeModule: isAppModule(parsed.activeModule) ? parsed.activeModule : undefined,
      activeSubFeature: typeof parsed.activeSubFeature === 'string' ? parsed.activeSubFeature : undefined,
    };
  } catch {
    return null;
  }
};

const writeShellSessionMarker = (userId: string, marker: ShellSessionMarker) => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(getShellScopedStorageKey(SHELL_SESSION_STATE_KEY, userId), JSON.stringify(marker));
  } catch {
    // Crash telemetry is best-effort and must never block the app.
  }
};

const isAppModule = (value: unknown): value is AppModule =>
  Object.values(AppModuleObj).includes(value as AppModule);

const isShellPageMode = (value: unknown): value is ShellPageMode =>
  value === 'landing' || value === 'module' || value === 'settings' || value === 'account';

const readJsonStorage = <T,>(key: string, fallback: T): T => {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = readBoundedLocalStorageItem(
      key,
      key.includes(SHELL_RUNTIME_STATE_KEY) ? MAX_SHELL_RUNTIME_STORAGE_BYTES : MAX_SHELL_UI_STORAGE_BYTES,
    );
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

const readShellUiState = (userId?: string | null): Partial<ShellUiState> => {
  const saved = readJsonStorage<Partial<ShellUiState>>(getShellScopedStorageKey(SHELL_UI_STATE_KEY, userId), {});
  return {
    pageMode: isShellPageMode(saved.pageMode) ? saved.pageMode : undefined,
    activeModule: isAppModule(saved.activeModule) ? saved.activeModule : undefined,
    activeSubFeatureByModule: saved.activeSubFeatureByModule && typeof saved.activeSubFeatureByModule === 'object'
      ? saved.activeSubFeatureByModule
      : undefined,
    sidebarCollapsed: typeof saved.sidebarCollapsed === 'boolean' ? saved.sidebarCollapsed : undefined,
  };
};

const saveShellUiState = (state: ShellUiState, userId?: string | null) => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(getShellScopedStorageKey(SHELL_UI_STATE_KEY, userId), JSON.stringify(state));
  } catch {
    // local UI position is non-critical
  }
};

const hasRuntimeBackendIdentity = (entity: Pick<Project | Task, 'backendJobId'>) =>
  String(entity.backendJobId || '').trim().length > 0;

const isOneClickPlanReadyProject = (project: Project) =>
  project.module === AppModuleObj.ONE_CLICK
  && project.status === 'planning'
  && Array.isArray(project.plans)
  && project.plans.length > 0;

const shouldKeepRuntimeProject = (project: Project) =>
  hasRuntimeBackendIdentity(project)
  && (project.status === 'generating' || (project.status === 'planning' && !isOneClickPlanReadyProject(project)));

const shouldKeepRuntimeTask = (task: Task) =>
  hasRuntimeBackendIdentity(task) && (task.status === 'pending' || task.status === 'generating');

const isStaleLocalOnlyVideoGenerationProject = (project: Project) =>
  project.module === AppModuleObj.VIDEO
  && project.subFeature === 'generation'
  && !project.backendJobId
  && (project.status === 'planning' || project.status === 'generating');

const isStaleLocalOnlyVideoGenerationTask = (task: Task) =>
  task.module === AppModuleObj.VIDEO
  && task.subFeature === 'generation'
  && !task.backendJobId
  && (task.status === 'pending' || task.status === 'generating');

const RUNTIME_TEXT_LIMIT = 120;

const trimRuntimeText = (value: unknown, fallback = '') => {
  const text = String(value || fallback || '').replace(/\s+/g, ' ').trim();
  return text.length > RUNTIME_TEXT_LIMIT ? `${text.slice(0, RUNTIME_TEXT_LIMIT)}...` : text;
};

const compactRuntimeProject = (project: Project): Project => ({
  id: project.id,
  name: trimRuntimeText(project.name, '进行中的任务'),
  module: project.module,
  status: project.status,
  createdAt: project.createdAt,
  completedAt: project.completedAt,
  results: [],
  taskCount: Number(project.taskCount || 1) || 1,
  completedCount: Number(project.completedCount || 0) || 0,
  subFeature: project.subFeature,
  sourceType: project.sourceType,
  backendJobId: project.backendJobId,
  planningTaskId: latestIdentityText(project.planningTaskId),
  creditsConsumed: project.creditsConsumed,
  directGeneration: project.directGeneration,
  error: trimRuntimeText(project.error),
});

const compactRuntimeTask = (task: Task): Task => ({
  id: task.id,
  projectId: task.projectId,
  module: task.module,
  type: task.type,
  status: task.status,
  title: trimRuntimeText(task.title, '进行中的任务'),
  progress: task.progress,
  createdAt: task.createdAt,
  total: task.total,
  completed: task.completed,
  subFeature: task.subFeature,
  backendJobId: task.backendJobId,
});

const loadShellRuntimeSnapshot = (userId?: string | null): ShellRuntimeSnapshot => {
  const saved = readJsonStorage<Partial<ShellRuntimeSnapshot>>(getShellScopedStorageKey(SHELL_RUNTIME_STATE_KEY, userId), {});
  return {
    projects: Array.isArray(saved.projects)
      ? saved.projects
        .filter(shouldKeepRuntimeProject)
        .filter((project) => !isStaleLocalOnlyVideoGenerationProject(project))
        .map(compactRuntimeProject)
      : [],
    tasks: Array.isArray(saved.tasks)
      ? saved.tasks
        .filter(shouldKeepRuntimeTask)
        .filter((task) => !isStaleLocalOnlyVideoGenerationTask(task))
        .map(compactRuntimeTask)
      : [],
    updatedAt: typeof saved.updatedAt === 'number' ? saved.updatedAt : 0,
  };
};

const saveShellRuntimeSnapshot = (snapshot: Pick<ShellRuntimeSnapshot, 'projects' | 'tasks'>, userId?: string | null) => {
  if (typeof window === 'undefined') return;
  const runtimeSnapshot: ShellRuntimeSnapshot = {
    projects: snapshot.projects
      .filter(shouldKeepRuntimeProject)
      .filter((project) => !isStaleLocalOnlyVideoGenerationProject(project))
      .map(compactRuntimeProject),
    tasks: snapshot.tasks
      .filter(shouldKeepRuntimeTask)
      .filter((task) => !isStaleLocalOnlyVideoGenerationTask(task))
      .map(compactRuntimeTask),
    updatedAt: Date.now(),
  };
  try {
    const storageKey = getShellScopedStorageKey(SHELL_RUNTIME_STATE_KEY, userId);
    if (runtimeSnapshot.projects.length === 0 && runtimeSnapshot.tasks.length === 0) {
      window.localStorage.removeItem(storageKey);
      return;
    }
    window.localStorage.setItem(storageKey, JSON.stringify(runtimeSnapshot));
  } catch {
    // in-flight cards are best-effort local recovery state
  }
};

const mergeShellProjects = (runtimeProjects: Project[], persistedProjects: Project[]) => {
  return mergeShellRuntimeEntities(
    runtimeProjects
      .filter(shouldKeepRuntimeProject)
      .filter((project) => !isStaleLocalOnlyVideoGenerationProject(project)),
    persistedProjects,
  );
};

const mergeShellTasks = (runtimeTasks: Task[], liveTasks: Task[]) => {
  return mergeShellRuntimeEntities(
    runtimeTasks
      .filter(shouldKeepRuntimeTask)
      .filter((task) => !isStaleLocalOnlyVideoGenerationTask(task)),
    liveTasks,
  );
};

const shellProjectSignature = (project: Pick<Project, 'module' | 'subFeature' | 'name'>) =>
  `${project.module}:${project.subFeature || 'default'}:${project.name || ''}`;

const shellTaskSignature = (task: Pick<Task, 'module' | 'subFeature' | 'title'>) =>
  `${task.module}:${task.subFeature || 'default'}:${task.title || ''}`;

const normalizePlanSchemeContent = (scheme: string) =>
  String(scheme || '')
    .replace(/\[SCHEME_START\]/g, '')
    .replace(/\[SCHEME_END\]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

const isFailedPlanningPlan = (plan: PlanItem) => Boolean(
  plan.planningFailed
  || plan.status === 'error'
  || String(plan.error || '').trim(),
);

const isInvalidPlanContentForGeneration = (plan: PlanItem) => (
  isFailedPlanningPlan(plan)
  || isInvalidOneClickPlanLike(plan)
);

const getBackendJobIdFromFailedPlan = (plan: PlanItem) => {
  const id = String(plan.id || '').trim();
  return id.endsWith('-error') ? id.slice(0, -'-error'.length) : '';
};

const buildFailedPlanningResultFromPlan = (options: {
  plan: PlanItem;
  index: number;
  projectId: string;
  createdAt: number;
  module: AppModule;
  subFeature?: string;
  model: string;
  aspectRatio: string;
  fallbackMessage: string;
}): GeneratedResult => {
  const message = String(options.plan.error || options.plan.schemeContent || options.fallbackMessage || '策划失败').trim();
  const backendJobId = getBackendJobIdFromFailedPlan(options.plan);
  return {
    id: `${options.plan.id || `planning-${options.index + 1}`}-result-error`,
    planId: options.plan.id,
    projectId: options.projectId,
    imageUrl: '',
    prompt: message,
    model: options.model,
    aspectRatio: options.aspectRatio,
    status: 'error',
    createdAt: options.createdAt,
    module: options.module,
    subFeature: options.subFeature,
    backendJobId: backendJobId || undefined,
    error: message,
  };
};

const buildPlanPromptSummary = (plan: PlanItem, subFeature: string) => {
  const scheme = normalizePlanSchemeContent(plan.schemeContent || '');
  if (scheme) return scheme;
  const fieldsBySubFeature: Record<string, string[]> = {
    first_image: ['设计意图', '画面描述', '场景描述', '画面风格', '画面比例'],
    main_image: ['设计意图', '画面风格', '画面描述', '场景描述', '画面比例'],
    detail_page: ['设计意图', '画面风格', '画面描述', '场景描述', '文案内容排版', '画面比例'],
    sku: ['SKU标识', '设计意图', '画面风格', '画面描述', '文案内容排版', '画面比例'],
  };
  const labels = fieldsBySubFeature[subFeature] || ['设计意图', '画面风格', '画面描述', '文案内容排版', '画面比例'];
  const lines = labels
    .map((label) => {
      const value = extractShellSchemeField(scheme, [label]);
      return value ? `- ${label}：${value}` : '';
    })
    .filter(Boolean);
  const fallback = [
    plan.title ? `- 方案标题：${plan.title}` : '',
    plan.sellingPoints.length > 0 ? `- 核心卖点：${plan.sellingPoints.join(' / ')}` : '',
    plan.sceneDescription ? `- 画面描述：${plan.sceneDescription}` : '',
    plan.styleDirection ? `- 画面风格：${plan.styleDirection}` : '',
    plan.colorPalette ? `- 配色：${plan.colorPalette}` : '',
    plan.composition ? `- 构图：${plan.composition}` : '',
    plan.textLayout ? `- 文案内容排版：${plan.textLayout}` : '',
  ].filter(Boolean);
  return lines.length > 0 ? lines.join('\n') : fallback.join('\n');
};

const countSelectedPlans = (plans?: PlanItem[]) => (plans || []).filter((plan) => plan.selected).length;

const createDefaultWorkspacePreferences = () => ({
  compressImagesBeforeUpload: true,
  playSoundAfterGeneration: false,
  showGenerationProgress: true,
});

const getWorkspacePreferences = (config?: Partial<GlobalApiConfig> | null) => ({
  ...createDefaultWorkspacePreferences(),
  ...(config?.workspacePreferences || {}),
});

const createDefaultVideoState = (): VideoPersistentState => ({
  subMode: VideoSubMode.STORYBOARD,
  config: {
    duration: '15',
    aspectRatio: 'landscape',
    promptMode: 'ai',
    script: '',
    scenes: [],
    productInfo: '',
    requirements: '',
    targetCountry: '美国',
    customCountry: '',
    referenceVideoUrl: '',
    videoCount: 1,
    targetLanguage: '',
    sellingPoints: '',
    logicInfo: '',
  },
  productImages: [],
  uploadedProductUrls: [],
  referenceVideoFile: null,
  uploadedReferenceVideoUrl: '',
  tasks: [],
  diagnosis: {
    platform: 'tiktok',
    accessMode: 'spider_api',
    url: '',
    analysisItems: ['video_basic', 'video_metrics', 'author_profile'],
    analysisModel: '',
    probe: {
      status: 'idle',
      sources: [],
      fields: [],
      raw: null,
      normalized: null,
      missingCriticalFields: [],
      error: '',
      completedAt: null,
    },
    report: {
      status: 'idle',
      summary: '',
      evidence: [],
      inferences: [],
      actions: [],
    },
    aiAnalysis: {
      status: 'idle',
      summary: '',
      overallRisk: 'unknown',
      sections: [],
      topActions: [],
      error: '',
      completedAt: null,
    },
  },
  veoProjects: [],
  veoReferenceImages: [],
  isAnalyzing: false,
  isGenerating: false,
  storyboard: {
    config: {
      productImages: [],
      uploadedProductUrls: [],
      productInfo: '',
      videoGenerationMode: 'original',
      scriptLogic: '',
      scriptPreset: 'custom',
      referenceVideoFile: null,
      uploadedReferenceVideoUrl: '',
      viralVariationCount: 3,
      viralVariationStrength: '10',
      viralCustomVariationStrength: '',
      reservedVideoApiProvider: '',
      aspectRatio: AspectRatio.P_9_16,
      duration: '15s',
      shotCount: 9,
      actorType: 'no_real_face',
      projectCount: 1,
      scenes: [''],
      countryLanguage: '中国/中文',
      generateWhiteBg: false,
      model: 'gpt-image-2',
      quality: '2k',
      generationMode: 'single_image',
    },
    projects: [],
    downloadingProjectId: null,
  },
});

type ShellPersistenceTools = {
  buildPersistedAppState: typeof import('./utils/appState').buildPersistedAppState;
  loadPersistedAppState: typeof import('./utils/appState').loadPersistedAppState;
  normalizeLoadedPersistedAppState: typeof import('./utils/appState').normalizeLoadedPersistedAppState;
  savePersistedAppState: typeof import('./utils/appState').savePersistedAppState;
  sanitizePersistedAppState: typeof import('./utils/appState').sanitizePersistedAppState;
  buildShellDataSnapshot: typeof import('./adapters/shellDataAdapter').buildShellDataSnapshot;
  upsertOneClickProjectIntoPersistedState: typeof import('./adapters/shellPersistence').upsertOneClickProjectIntoPersistedState;
  upsertShellProjectIntoPersistedState: typeof import('./adapters/shellPersistence').upsertShellProjectIntoPersistedState;
  upsertTranslationFilesIntoPersistedState: typeof import('./adapters/shellPersistence').upsertTranslationFilesIntoPersistedState;
};

let shellPersistenceToolsPromise: Promise<ShellPersistenceTools> | null = null;

const loadShellPersistenceTools = () => {
  if (!shellPersistenceToolsPromise) {
    shellPersistenceToolsPromise = Promise.all([
      import('./utils/appState'),
      import('./adapters/shellDataAdapter'),
      import('./adapters/shellPersistence'),
    ]).then(([appState, shellDataAdapter, shellPersistence]) => ({
      buildPersistedAppState: appState.buildPersistedAppState,
      loadPersistedAppState: appState.loadPersistedAppState,
      normalizeLoadedPersistedAppState: appState.normalizeLoadedPersistedAppState,
      savePersistedAppState: appState.savePersistedAppState,
      sanitizePersistedAppState: appState.sanitizePersistedAppState,
      buildShellDataSnapshot: shellDataAdapter.buildShellDataSnapshot,
      upsertOneClickProjectIntoPersistedState: shellPersistence.upsertOneClickProjectIntoPersistedState,
      upsertShellProjectIntoPersistedState: shellPersistence.upsertShellProjectIntoPersistedState,
      upsertTranslationFilesIntoPersistedState: shellPersistence.upsertTranslationFilesIntoPersistedState,
    }));
  }
  return shellPersistenceToolsPromise;
};

type ShellWorkflowModule = typeof import('./adapters/shellWorkflow');

let shellWorkflowModulePromise: Promise<ShellWorkflowModule> | null = null;

const reloadForStaleFrontendAsset = (error?: unknown) => {
  if (typeof window === 'undefined') return;
  console.warn('[shell-workflow] stale frontend asset detected, reloading page', error);
  window.setTimeout(() => {
    window.location.reload();
  }, 80);
};

// 根因 #5 护栏:前端资源/chunk 加载失败(部署后浏览器请求旧 hash chunk 导致 404)
// 绝不能被当成业务任务失败。命中即刷新页面并返回 true,调用方据此 return,不写任何业务失败态。
const bailIfFrontendResourceError = (error: unknown): boolean => {
  if (typeof window === 'undefined' || !isFrontendResourceError(error)) return false;
  reloadForStaleFrontendAsset(error);
  return true;
};

const loadShellWorkflowModule = async () => {
  if (!shellWorkflowModulePromise) {
    shellWorkflowModulePromise = import('./adapters/shellWorkflow');
  }
  try {
    return await shellWorkflowModulePromise;
  } catch (error) {
    shellWorkflowModulePromise = null;
    if (bailIfFrontendResourceError(error)) {
      return new Promise<never>(() => undefined);
    }
    throw error;
  }
};

const MODULE_NAMES: Record<string, string> = {
  [AppModuleObj.AGENT_CENTER]: '智能体中心',
  [AppModuleObj.ONE_CLICK]: '一键主详',
  [AppModuleObj.TRANSLATION]: '出海翻译',
  [AppModuleObj.BUYER_SHOW]: '买家秀',
  [AppModuleObj.RETOUCH]: '产品精修',
  [AppModuleObj.EVERYTHING_REPLACE]: '万物替换',
  [AppModuleObj.VIDEO]: '短视频生成',
  [AppModuleObj.XHS_COVER]: '小红书封面',
  [AppModuleObj.SETTINGS]: '系统设置',
  [AppModuleObj.ACCOUNT]: '账号管理',
};

const getRuntimeErrorMessage = (error: unknown, fallback = '程序执行失败') => (
  error instanceof Error ? error.message : String(error || fallback)
);

const getRuntimeErrorDetail = (error: unknown) => {
  if (error instanceof Error) return error.stack || error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
};

const ONE_CLICK_CONFIRM_SCENES: Record<string, { label: string; ratio: string }> = {
  first_image: { label: '首图', ratio: '1:1' },
  main_image: { label: '主图', ratio: '1:1' },
  detail_page: { label: '详情页', ratio: 'auto' },
  sku: { label: 'SKU', ratio: '1:1' },
};

export interface SubFeatureOption {
  id: string;
  label: string;
  description?: string;
  disabled?: boolean;
}

export const MODULE_SUB_FEATURES: Record<string, SubFeatureOption[]> = {
  [AppModuleObj.ONE_CLICK]: [
    { id: 'first_image', label: '首图', description: '复制/发散首图' },
    { id: 'main_image', label: '主图', description: '主图方案与出图' },
    { id: 'detail_page', label: '详情页', description: '详情长图' },
    { id: 'sku', label: 'SKU', description: 'SKU 组合图' },
  ],
  [AppModuleObj.TRANSLATION]: [
    { id: 'main', label: '主图出海' },
    { id: 'detail', label: '详情出海' },
    { id: 'remove_text', label: '去文案' },
  ],
  [AppModuleObj.RETOUCH]: [
    { id: 'original', label: '原图精修' },
    { id: 'white_bg', label: '白底精修' },
    { id: 'enhance', label: '智能增强', description: '待制作', disabled: true },
  ],
  [AppModuleObj.EVERYTHING_REPLACE]: [
    { id: 'product_replace', label: '产品替换' },
    { id: 'background_replace', label: '背景替换', description: '待制作', disabled: true },
    { id: 'logo_replace', label: 'logo替换', disabled: true },
  ],
  [AppModuleObj.BUYER_SHOW]: [
    { id: 'image', label: '买家秀图片' },
    { id: 'copy', label: '纯文案', description: '待制作', disabled: true },
  ],
  [AppModuleObj.VIDEO]: [
    { id: 'generation', label: '短视频生成' },
    { id: 'storyboard', label: '分镜生成' },
    { id: 'diagnosis', label: '视频诊断' },
  ],
  [AppModuleObj.XHS_COVER]: [
    { id: 'cover', label: '封面生成' },
  ],
  [AppModuleObj.AGENT_CENTER]: [
    { id: 'chat', label: '员工聊天' },
    { id: 'management', label: '智能体管理' },
    { id: 'knowledge', label: '知识库' },
    { id: 'versions', label: '版本训练' },
  ],
};

const getDefaultSubFeature = (module: AppModule) => MODULE_SUB_FEATURES[module]?.[0]?.id || 'default';

const hasActiveGuardedGeneration = (
  projects: Project[],
  tasks: Task[],
  module: AppModule,
  subFeature?: string,
) => {
  const scope = subFeature || getDefaultSubFeature(module);
  const isSameScope = (item: { module: AppModule; subFeature?: string }) => (
    item.module === module && (item.subFeature || getDefaultSubFeature(item.module)) === scope
  );
  const hasActiveTask = tasks.some((task) => (
    isSameScope(task) && (task.status === 'pending' || task.status === 'generating')
    && !hasRuntimeTaskIdentity(task)
  ));
  if (hasActiveTask) return true;
  return projects.some((project) => {
    if (!isSameScope(project)) return false;
    if (project.status === 'generating' && !hasRuntimeTaskIdentity(project)) return true;
    if (project.status === 'planning' && !(project.plans || []).length && !hasRuntimeTaskIdentity(project)) return true;
    return (project.results || []).some((result) => (
      result.status === 'generating'
      && !result.imageUrl
      && !result.videoUrl
      && !hasRuntimeTaskIdentity(result)
    ));
  });
};

const isActiveRegenerationStatus = (status?: unknown) => status === 'pending' || status === 'generating';

const hasActiveRegenerationConflict = (
  projects: Project[],
  tasks: Task[],
  targetProject: Project,
) => {
  const scope = targetProject.subFeature || getDefaultSubFeature(targetProject.module);
  const isSameScope = (item: { module: AppModule; subFeature?: string }) => (
    item.module === targetProject.module && (item.subFeature || getDefaultSubFeature(item.module)) === scope
  );
  if (tasks.some((task) => isSameScope(task) && isActiveRegenerationStatus(task.status))) return true;
  return projects.some((project) => {
    if (!isSameScope(project)) return false;
    const hasGeneratingResult = (project.results || []).some((result) => (
      result.status === 'generating'
      && !result.imageUrl
      && !result.videoUrl
    ));
    if (hasGeneratingResult) return true;
    const projectProgressIncomplete = Number(project.completedCount || 0) < Number(project.taskCount || 0);
    if (project.status === 'generating' && (!(project.results || []).length || projectProgressIncomplete)) return true;
    return false;
  });
};

const isPendingShellSubFeature = (module: AppModule, subFeature: string) =>
  Boolean(MODULE_SUB_FEATURES[module]?.find((item) => item.id === subFeature)?.disabled);

const canUseVideoGenerationFeature = (user?: AuthUser | null) =>
  user?.role === 'admin' || user?.featurePermissions?.videoGeneration === true;

const getModuleSubFeatures = (module: AppModule, user?: AuthUser | null) => {
  const items = MODULE_SUB_FEATURES[module] || [];
  if (module !== AppModuleObj.VIDEO || canUseVideoGenerationFeature(user)) return items;
  return items.map((item) => (
    item.id === 'generation'
      ? { ...item, description: '未授权', disabled: true }
      : item
  ));
};

const scopeKeyFor = (module: AppModule, subFeature: string) => `${module}:${subFeature}`;

const subFeatureFromParam = (module: AppModule, key: string, value: string) => {
  if (module === AppModuleObj.ONE_CLICK && key === 'mode') {
    const map: Record<string, string> = { '首图': 'first_image', '主图': 'main_image', '详情页': 'detail_page', SKU: 'sku' };
    return map[value];
  }
  if (module === AppModuleObj.TRANSLATION && key === 'submode') {
    const map: Record<string, string> = { '主图出海': 'main', '详情出海': 'detail', '去文案': 'remove_text' };
    return map[value];
  }
  if (module === AppModuleObj.RETOUCH && key === 'mode') {
    const map: Record<string, string> = { '原图精修': 'original', '白底精修': 'white_bg', '背景替换': 'background_replace', '智能增强': 'enhance' };
    return map[value];
  }
  return undefined;
};

const paramFromSubFeature = (module: AppModule, subFeature: string): [string, string] | null => {
  if (module === AppModuleObj.ONE_CLICK) {
    const map: Record<string, string> = { first_image: '首图', main_image: '主图', detail_page: '详情页', sku: 'SKU' };
    return map[subFeature] ? ['mode', map[subFeature]] : null;
  }
  if (module === AppModuleObj.TRANSLATION) {
    const map: Record<string, string> = { main: '主图出海', detail: '详情出海', remove_text: '去文案' };
    return map[subFeature] ? ['submode', map[subFeature]] : null;
  }
  if (module === AppModuleObj.RETOUCH) {
    const map: Record<string, string> = { original: '原图精修', white_bg: '白底精修', background_replace: '背景替换', enhance: '智能增强' };
    return map[subFeature] ? ['mode', map[subFeature]] : null;
  }
  return null;
};

const moduleFromAgentInterface = (target: ModuleInterfaceId): { module: AppModule; subFeature: string } => {
  if (target === 'one_click_main') {
    return { module: AppModuleObj.ONE_CLICK, subFeature: 'main_image' };
  }
  return { module: AppModuleObj.ONE_CLICK, subFeature: getDefaultSubFeature(AppModuleObj.ONE_CLICK) };
};

const normalizeParamsForGeneration = (
  module: AppModule,
  subFeature: string,
  params: Record<string, string>,
) => {
  if (module === AppModuleObj.TRANSLATION) return normalizeTranslationParamsForGeneration(subFeature, params);
  if (module === AppModuleObj.RETOUCH) return normalizeRetouchParamsForGeneration(params);
  if (module === AppModuleObj.EVERYTHING_REPLACE) return normalizeEverythingReplaceParamsForGeneration(subFeature, params);
  if (module === AppModuleObj.XHS_COVER) return normalizeXhsCoverParamsForGeneration(params);
  if (module !== AppModuleObj.ONE_CLICK) return params;
  const requestedSizeMode = String(params.resolutionMode || params.sizeMode || '').trim();
  const resolutionMode = requestedSizeMode.includes('原图') || requestedSizeMode.includes('AI 自适应') || requestedSizeMode === 'original'
    ? 'original'
    : 'custom';
  const oneClickParams = {
    ...params,
    resolutionMode,
    sizeMode: resolutionMode === 'original' ? 'AI 自适应尺寸' : '固定宽度',
    targetWidth: params.targetWidth || params.width || (subFeature === 'detail_page' ? '750' : '800'),
    width: params.width || params.targetWidth || (subFeature === 'detail_page' ? '750' : '800'),
    targetHeight: params.targetHeight || params.height || '0',
    height: params.height || params.targetHeight || '0',
    maxFileSize: params.maxFileSize || params.maxSize || '2',
    maxSize: params.maxSize || params.maxFileSize || '2',
  };
  if (subFeature !== 'sku') return oneClickParams;
  return { ...oneClickParams, count: String(resolveShellSkuCount(params)) };
};

const normalizeXhsCoverParamsForGeneration = (
  params: Record<string, string>,
) => {
  const ratio = params.ratio || params.aspectRatio || '3:4';
  return {
    ...params,
    ratio,
    aspectRatio: ratio,
  };
};

const normalizeRetouchParamsForGeneration = (
  params: Record<string, string>,
) => {
  const requestedSizeMode = String(params.sizeMode || params.resolutionMode || '').trim();
  const resolutionMode = requestedSizeMode.includes('自定义') || requestedSizeMode.includes('固定') || requestedSizeMode === 'custom'
    ? 'custom'
    : 'original';
  const ratio = getSafeRetouchAspectRatioForModel(params.model || 'GPT Image 2', params.ratio || params.aspectRatio || 'auto');
  return {
    ...params,
    ratio,
    aspectRatio: ratio,
    resolutionMode,
    sizeMode: resolutionMode === 'original' ? 'AI 自适应尺寸' : '自定义',
    targetWidth: params.targetWidth || params.width || '800',
    width: params.width || params.targetWidth || '800',
    targetHeight: params.targetHeight || params.height || '800',
    height: params.height || params.targetHeight || '800',
    maxFileSize: params.maxFileSize || params.maxSize || '2',
    maxSize: params.maxSize || params.maxFileSize || '2',
  };
};

const normalizeEverythingReplaceParamsForGeneration = (
  subFeature: string,
  params: Record<string, string>,
) => {
  const ratio = params.ratio || params.aspectRatio || 'auto';
  return {
    ...normalizeRetouchParamsForGeneration({
      ...params,
      ratio,
      aspectRatio: ratio,
      mode: subFeature || params.mode || 'product_replace',
      resolutionMode: params.resolutionMode || 'original',
      sizeMode: params.sizeMode || 'AI 自适应尺寸',
    }),
    mode: subFeature || params.mode || 'product_replace',
    replacementLogic: params.replacementLogic === '单产品替换' ? '单品替换' : params.replacementLogic || '单品替换',
    firstImageColorMode: String(params.firstImageColorMode || '').includes('自适应') ? '人物微调' : params.firstImageColorMode || '完全复刻',
    textPolicy: params.textPolicy || '维持文案',
  };
};

const TRANSLATION_PARAM_DEFAULTS: Record<string, { ratio: string; targetWidth: string; targetHeight: string }> = {
  main: { ratio: '1:1', targetWidth: '800', targetHeight: '800' },
  detail: { ratio: 'auto', targetWidth: '750', targetHeight: '0' },
  remove_text: { ratio: 'auto', targetWidth: '1200', targetHeight: '0' },
};

const normalizeTranslationParamsForGeneration = (
  subFeature: string,
  params: Record<string, string>,
) => {
  const defaults = TRANSLATION_PARAM_DEFAULTS[subFeature] || TRANSLATION_PARAM_DEFAULTS.main;
  const requestedSizeMode = String(params.sizeMode || params.resolutionMode || '').trim();
  const resolutionMode = requestedSizeMode.includes('原图') || requestedSizeMode === 'original'
    ? 'original'
    : 'custom';
  return {
    ...params,
    mode: subFeature,
    submode: params.submode || (subFeature === 'detail' ? '详情出海' : subFeature === 'remove_text' ? '去文案' : '主图出海'),
    lang: params.lang || 'English',
    model: params.model || 'GPT Image 2',
    quality: params.quality || '1K',
    ratio: params.ratio || params.aspectRatio || defaults.ratio,
    aspectRatio: params.ratio || params.aspectRatio || defaults.ratio,
    resolutionMode,
    sizeMode: resolutionMode === 'original' ? '原图' : '自定义',
    targetWidth: params.targetWidth || params.width || defaults.targetWidth,
    width: params.width || params.targetWidth || defaults.targetWidth,
    targetHeight: params.targetHeight || params.height || defaults.targetHeight,
    height: params.height || params.targetHeight || defaults.targetHeight,
    maxFileSize: params.maxFileSize || params.maxSize || '2',
    maxSize: params.maxSize || params.maxFileSize || '2',
  };
};

type TranslationBatchFile = {
  id: string;
  file: null;
  fileName: string;
  relativePath: string;
  sourceUrl: string;
  sourcePreviewUrl: string;
  status: 'pending' | 'uploading' | 'processing' | 'completed' | 'error' | 'interrupted';
  progress: number;
  prompt: string;
  model: string;
  aspectRatio: string;
  subFeature: string;
  projectId: string;
  projectName: string;
  projectCreatedAt: number;
  taskId?: string;
  backendJobId?: string;
  creditsConsumed?: number;
  resultUrl?: string;
  matchedAspectRatio?: string;
  error?: string;
  originalWidth?: number;
  originalHeight?: number;
};

const translationStatusToGeneratedStatus = (status: TranslationBatchFile['status']): GeneratedResult['status'] => {
  if (status === 'completed') return 'completed';
  if (status === 'error' || status === 'interrupted') return 'error';
  return 'generating';
};

const translationFileToResult = (
  file: TranslationBatchFile,
  createdAtLabel: number,
): GeneratedResult => ({
  id: file.id,
  projectId: file.projectId,
  imageUrl: file.resultUrl || '',
  prompt: file.error || file.prompt || file.fileName,
  model: file.model,
  aspectRatio: file.matchedAspectRatio || file.aspectRatio || 'auto',
  status: translationStatusToGeneratedStatus(file.status),
  createdAt: createdAtLabel,
  module: AppModuleObj.TRANSLATION,
  subFeature: file.subFeature,
  sourceUrl: file.sourceUrl,
  sourcePreviewUrl: file.sourcePreviewUrl,
  fileName: file.fileName,
  relativePath: file.relativePath,
  taskId: file.taskId,
  backendJobId: file.backendJobId,
  creditsConsumed: file.creditsConsumed,
  error: file.error,
  matchedAspectRatio: file.matchedAspectRatio,
});

const getTranslationProjectStatus = (files: TranslationBatchFile[]): Project['status'] => {
  if (files.some((item) => ['pending', 'uploading', 'processing'].includes(item.status))) return 'generating';
  if (files.some((item) => item.status === 'error' || item.status === 'interrupted')) return 'error';
  return files.some((item) => item.status === 'completed') ? 'completed' : 'planning';
};

const getTranslationCompletedCount = (files: TranslationBatchFile[]) =>
  files.filter((item) => item.status === 'completed' && Boolean(item.resultUrl)).length;

const formatShortProjectNamePrefix = (date = new Date()) => {
  const month = date.getMonth() + 1;
  const day = date.getDate();
  return `${month}月${day}日项目`;
};

const getNextShortProjectNameNumber = (projects: Project[], prefix: string) => (
  projects.reduce((max, project) => {
    const match = String(project.name || '').match(new RegExp(`^${prefix}(\\d+)$`));
    const value = match ? Number(match[1]) : 0;
    return Number.isFinite(value) ? Math.max(max, value) : max;
  }, 0) + 1
);

const parsePositiveInt = (value: string | undefined, fallback = 1, max = 20) => {
  const parsed = parseInt(String(value || '').replace(/[^\d]/g, ''), 10);
  if (!Number.isFinite(parsed) || parsed < 1) return Math.max(1, Math.min(max, fallback));
  return Math.min(max, parsed);
};

const resolveEverythingReplaceBatchCount = (
  materials: Record<string, Material[]>,
  params: Record<string, string>,
) => {
  const productCount = Math.max(0, (materials.product || []).length);
  const referenceCount = Math.max(0, (materials.styleRef || []).length);
  if (productCount <= 0 || referenceCount <= 0) return 1;
  return Math.min(40, referenceCount);
};

const resolveBatchCount = (module: AppModule, subFeature: string, params: Record<string, string>) => {
  if (module === AppModuleObj.ONE_CLICK) {
    if (subFeature === 'first_image') return 1;
    if (subFeature === 'sku') {
      return resolveShellSkuCount(params);
    }
    if (subFeature === 'main_image') return parsePositiveInt(params.count, 5, 20);
    if (subFeature === 'detail_page') return parsePositiveInt(params.count, 7, 20);
    return 1;
  }

  if (module === AppModuleObj.BUYER_SHOW) {
    const perSetCount = parsePositiveInt(params.count, 4, 20);
    const setCount = parsePositiveInt(params.setCount, 1, 4);
    return Math.min(20, perSetCount * setCount);
  }

  if (module === AppModuleObj.XHS_COVER) {
    const styleCount = String(params.selectedStyleIds || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean).length;
    return Math.max(1, Math.min(20, styleCount || 1));
  }

  return 1;
};

const buildBatchPrompt = (
  module: AppModule,
  subFeature: string,
  basePrompt: string,
  params: Record<string, string>,
  index: number,
  totalCount: number,
) => {
  const lines = [basePrompt.trim()];
  if (module === AppModuleObj.ONE_CLICK && subFeature === 'sku') {
    const skuText = String(params[`skuCopyText_${index}`] || '').trim();
    lines.push(`SKU命名：${skuText || `SKU ${index + 1}`}`);
    lines.push(`请输出第 ${index + 1}/${totalCount} 张 SKU 结果。`);
  } else if (module === AppModuleObj.ONE_CLICK && subFeature !== 'first_image') {
    lines.push(`请输出第 ${index + 1}/${totalCount} 张结果，保持同一产品主体前提下作轻微构图变化。`);
  } else if (module === AppModuleObj.BUYER_SHOW) {
    const perSetCount = parsePositiveInt(params.count, 4, 20);
    const setCount = parsePositiveInt(params.setCount, 1, 4);
    const setIndex = Math.floor(index / perSetCount);
    const setDirection = String(params[`buyerShowSetDirection_${setIndex}`] || '').trim();
    if (setDirection) {
      lines.push(`第 ${setIndex + 1}/${setCount} 套场景要求：${setDirection}`);
    }
    lines.push(`请输出第 ${index + 1}/${totalCount} 张买家秀结果。`);
  }
  return lines.filter(Boolean).join('\n');
};

const isMaterialInActiveScope = (
  material: { subFeature?: string },
  module: AppModule,
  activeSubFeature: string,
) => {
  if (module === AppModuleObj.ONE_CLICK && activeSubFeature === 'sku') {
    return material.subFeature === 'sku';
  }
  return !material.subFeature || material.subFeature === activeSubFeature;
};

const filterMaterialsForScope = (
  sourceMaterials: Record<string, Material[]>,
  module: AppModule,
  activeSubFeature: string,
) => Object.fromEntries(
  Object.entries(sourceMaterials).map(([type, items]) => [
    type,
    module === AppModuleObj.ONE_CLICK && activeSubFeature === 'sku' && type === 'logo'
      ? []
      : (items || []).filter((item) => isMaterialInActiveScope(item, module, activeSubFeature)),
  ]),
) as Record<string, Material[]>;

const toVideoStoryboardAspectRatio = (value?: string): VideoStoryboardConfig['aspectRatio'] => {
  if (value === '3:4') return AspectRatio.P_3_4;
  if (value === '4:5') return AspectRatio.P_3_4;
  if (value === '4:3') return AspectRatio.L_4_3;
  if (value === '16:9') return AspectRatio.L_16_9;
  if (value === '21:9') return AspectRatio.L_21_9;
  if (value === '1:1') return AspectRatio.SQUARE;
  return AspectRatio.P_9_16;
};

const parseStoryboardShotCount = (
  value: string | undefined,
  fallback: VideoStoryboardConfig['shotCount'],
): VideoStoryboardConfig['shotCount'] => {
  const parsed = Number(String(value || '').replace(/[^\d]/g, ''));
  if ([1, 3, 4, 6, 8, 9, 12].includes(parsed)) return parsed as VideoStoryboardConfig['shotCount'];
  return fallback;
};

const formatVideoStoryboardFailureMessage = (step: string, error: unknown) => {
  const rawMessage = error instanceof Error ? error.message : String(error || '分镜生成失败');
  if (/fetch failed/i.test(rawMessage)) {
    return `${step}失败：请求未成功提交到 KIE 后台（fetch failed），请检查本机网络/代理或稍后重试。`;
  }
  if (/504|timeout|timed out|超时/i.test(rawMessage)) {
    return `${step}失败：KIE 或模型响应超时，复杂视频拆解耗时较长，请稍后重试或切换更快模型。原始错误：${rawMessage}`;
  }
  if (/JSON|解析|parse/i.test(rawMessage)) {
    return `${step}失败：模型返回内容不是有效 JSON，前端无法读取分镜结果。原始错误：${rawMessage}`;
  }
  return rawMessage.includes('失败') ? rawMessage : `${step}失败：${rawMessage}`;
};

const parseStoryboardDuration = (
  value: string | undefined,
  fallback: VideoStoryboardConfig['duration'],
): VideoStoryboardConfig['duration'] => {
  const normalized = String(value || fallback || '15s').replace('秒', 's');
  if (normalized === '5s' || normalized === '10s' || normalized === '15s' || normalized === '30s') return normalized;
  return fallback;
};

const parseStoryboardActorType = (
  value: string | undefined,
  fallback: VideoStoryboardConfig['actorType'],
): VideoStoryboardConfig['actorType'] => {
  if (value === 'real_person') return 'real_person';
  if (value === '3d_digital_human') return '3d_digital_human';
  if (value === 'cartoon_character') return 'cartoon_character';
  if (value === '真实人物') return 'real_person';
  if (value === '3D 数字人') return '3d_digital_human';
  if (value === '卡通角色') return 'cartoon_character';
  if (value === '不出现真实人脸' || value === 'no_real_face') return 'no_real_face';
  return fallback;
};

const parseStoryboardPreset = (
  value: string | undefined,
  fallback: VideoStoryboardConfig['scriptPreset'],
): VideoStoryboardConfig['scriptPreset'] => {
  if (value === 'ecommerce' || value === '高转化电商逻辑') return 'ecommerce';
  if (value === 'viral' || value === '爆款短视频带货逻辑') return 'viral';
  if (value === 'custom' || value === '自定义逻辑') return 'custom';
  return fallback;
};

const parseStoryboardBoolean = (value: string | undefined, fallback: boolean) => {
  if (value === 'true' || value === '1' || value === '是') return true;
  if (value === 'false' || value === '0' || value === '否') return false;
  return fallback;
};

const isVideoStoryboardViralReplicationMode = (value?: string) => {
  const mode = String(value || '').trim();
  return mode === '爆款复刻' || mode === '爆款裂变' || mode === 'viral_split';
};

const toVideoDiagnosisPlatform = (value?: string): 'tiktok' | 'douyin' | 'xhs' => {
  if (value === '抖音' || value === 'douyin') return 'douyin';
  if (value === '小红书' || value === 'xhs') return 'xhs';
  return 'tiktok';
};

const buildVideoStoryboardConfig = (
  base: VideoStoryboardConfig,
  prompt: string,
  params: Record<string, string>,
  materials: Record<string, Material[]>,
): VideoStoryboardConfig => {
  const productUrls = (materials.product || [])
    .map((item) => item.remoteUrl || item.url)
    .filter(Boolean);
  const sceneReferenceUrls = (materials.scene || [])
    .map((item) => item.remoteUrl || item.url)
    .filter(Boolean);
  const referenceVideoUrl = (materials.referenceVideo || [])[0]?.remoteUrl || (materials.referenceVideo || [])[0]?.url || '';
  const duration = parseStoryboardDuration(params.duration, base.duration);
  const mode = isVideoStoryboardViralReplicationMode(params.videoMode) ? 'viral_split' : 'original';
  return {
    ...base,
    productImages: [],
    uploadedProductUrls: productUrls,
    sceneReferenceUrls,
    productInfo: prompt,
    videoGenerationMode: mode,
    scriptLogic: params.scriptLogic || prompt,
    scriptPreset: parseStoryboardPreset(params.scriptPreset, base.scriptPreset),
    referenceVideoFile: null,
    uploadedReferenceVideoUrl: referenceVideoUrl,
    viralVariationCount: 1,
    viralVariationStrength: (params.viralVariationStrength === '5' || params.viralVariationStrength === '10' || params.viralVariationStrength === '20' || params.viralVariationStrength === 'custom')
      ? params.viralVariationStrength
      : base.viralVariationStrength,
    viralCustomVariationStrength: params.viralCustomVariationStrength || base.viralCustomVariationStrength,
    reservedVideoApiProvider: base.reservedVideoApiProvider,
    aspectRatio: toVideoStoryboardAspectRatio(params.ratio || String(base.aspectRatio)),
    duration,
    shotCount: parseStoryboardShotCount(params.shotCount, base.shotCount),
    actorType: parseStoryboardActorType(params.actorType, base.actorType),
    projectCount: 1,
    scenes: [prompt],
    countryLanguage: params.countryLanguage || base.countryLanguage,
    generateWhiteBg: parseStoryboardBoolean(params.generateWhiteBg, base.generateWhiteBg),
    model: 'gpt-image-2',
    quality: '2k',
    generationMode: 'single_image',
  };
};

const buildAuthUserFromContext = (
  user: Pick<AuthUser, 'id' | 'username' | 'role' | 'avatarUrl' | 'avatarPreset' | 'featurePermissions' | 'analysisModel'> | AuthUser | null,
): AuthUser | null => {
  if (!user) return null;
  return {
    displayName: user.username,
    status: 'active',
    jobConcurrency: 1,
    featurePermissions: { videoGeneration: false },
    createdAt: 0,
    lastLoginAt: null,
    ...user,
  };
};

const getSavedTheme = (): 'dark' | 'light' => {
  if (typeof window === 'undefined') return 'dark';
  const saved = localStorage.getItem('meiao-theme');
  return saved === 'light' || saved === 'dark' ? saved : 'dark';
};

const shouldUseLocalStateFallback = () => {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).has('meiaoLocalPreview');
};

type AuthBootstrapResult = {
  status: 'logged_in' | 'logged_out';
  user: AuthUser | null;
};

let authBootstrapPromise: Promise<AuthBootstrapResult> | null = null;

const runAuthBootstrap = async (): Promise<AuthBootstrapResult> => {
  if (authBootstrapPromise) return authBootstrapPromise;
  authBootstrapPromise = (async () => {
    const isPreview = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('meiaoLocalPreview');
    if (isPreview) {
      return { status: 'logged_in' as const, user: buildAuthUserFromContext(getCurrentUserContext()) };
    }
    const available = await probeInternalApi();
    if (!available) {
      return { status: 'logged_in' as const, user: buildAuthUserFromContext(getCurrentUserContext()) };
    }
    try {
      const { user } = await fetchCurrentUser();
      storeCurrentUserContext(user);
      return { status: 'logged_in' as const, user };
    } catch {
      clearSessionToken();
      clearCurrentUserContext();
      return { status: 'logged_out' as const, user: null };
    }
  })().finally(() => {
    authBootstrapPromise = null;
  });
  return authBootstrapPromise;
};

const usePersistedTheme = () => {
  const [theme, setTheme] = useState<'dark' | 'light'>(() => getSavedTheme());

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('meiao-theme', theme);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => prev === 'dark' ? 'light' : 'dark');
  }, []);

  return { theme, toggleTheme };
};

/* ═══════════════════════════════════════════
   AppContent
   ═══════════════════════════════════════════ */

const AppContent: React.FC<{
  theme: 'dark' | 'light';
  toggleTheme: () => void;
  onLogout: () => void;
}> = ({ theme, toggleTheme, onLogout }) => {
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(() => buildAuthUserFromContext(getCurrentUserContext()));
  const [apiConfig, setApiConfig] = useState<GlobalApiConfig>(() => ({
    kieApiKey: '',
    concurrency: 5,
    workspacePreferences: getWorkspacePreferences(),
  }));
  const [systemConfig, setSystemConfig] = useState<SystemPublicConfig | null>(null);
  const publicBaseUrl = systemConfig?.publicBaseUrl || '';
  const shellLocalScopeUserId = currentUser?.id || null;
  const savedShellUiState = readShellUiState(shellLocalScopeUserId);
  const initialDraftSnapshot = loadShellDraftState(shellLocalScopeUserId);
  const initialRuntimeSnapshot = pruneShellRuntimeSnapshotForDeletion(
    loadShellRuntimeSnapshot(shellLocalScopeUserId),
    initialDraftSnapshot,
  );
  const initialModule = (() => {
    if (typeof window === 'undefined') return AppModuleObj.ONE_CLICK;
    const value = new URLSearchParams(window.location.search).get('module');
    if (value === AppModuleObj.SETTINGS || value === AppModuleObj.ACCOUNT) return AppModuleObj.ONE_CLICK;
    if (Object.values(AppModuleObj).includes(value as AppModule)) return value as AppModule;
    return savedShellUiState.activeModule || AppModuleObj.ONE_CLICK;
  })();
  const initialPageMode = (() => {
    if (typeof window === 'undefined') return 'landing';
    const value = new URLSearchParams(window.location.search).get('module');
    if (value === AppModuleObj.SETTINGS) return 'settings';
    if (value === AppModuleObj.ACCOUNT) return 'account';
    return value ? 'module' : 'landing';
  })() as ShellPageMode;
  const [activeModule, setActiveModule] = useState<AppModule>(initialModule);
  const [pageMode, setPageMode] = useState<ShellPageMode>(initialPageMode === 'landing' && savedShellUiState.pageMode ? savedShellUiState.pageMode : initialPageMode);
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(savedShellUiState.sidebarCollapsed === true ? true : false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationSubmitLocks, setGenerationSubmitLocks] = useState<Record<string, boolean>>({});
  const [pendingActionKeys, setPendingActionKeys] = useState<Record<string, boolean>>({});
  const [activeSubFeatureByModule, setActiveSubFeatureByModule] = useState<Record<string, string>>(() => ({
    ...(savedShellUiState.activeSubFeatureByModule || {}),
    [initialModule]: savedShellUiState.activeSubFeatureByModule?.[initialModule] || getDefaultSubFeature(initialModule),
  }));
  const activeSubFeature = activeSubFeatureByModule[activeModule] || getDefaultSubFeature(activeModule);
  const activeScopeKey = scopeKeyFor(activeModule, activeSubFeature);
  const [inputStateByScope, setInputStateByScope] = useState<Record<string, { promptText: string; params: Record<string, string> }>>(
    () => initialDraftSnapshot.inputStateByScope || {},
  );
  const promptText = inputStateByScope[activeScopeKey]?.promptText || '';
  // currentParams 用 useMemo 稳住引用:原来 `|| {}` 每次渲染都造新对象,
  // 导致下游 5 个 useCallback 依赖每次都变、记忆全部失效(前端卡顿真凶)。
  const currentParams = useMemo(
    () => inputStateByScope[activeScopeKey]?.params || {},
    [inputStateByScope, activeScopeKey],
  );
  const [videoMemory, setVideoMemoryState] = useState<VideoPersistentState | null>(null);
  const taskControllersRef = useRef<Record<string, AbortController>>({});
  const generationSubmitLocksRef = useRef<Set<string>>(new Set());
  const pendingActionKeysRef = useRef<Set<string>>(new Set());
  const { addToast } = useToast();

  const beginExclusiveAction = useCallback((key: string, duplicateMessage = '任务已提交，请等待当前操作完成') => {
    if (pendingActionKeysRef.current.has(key)) {
      addToast(duplicateMessage, 'info');
      return false;
    }
    pendingActionKeysRef.current.add(key);
    setPendingActionKeys((prev) => ({ ...prev, [key]: true }));
    return true;
  }, [addToast]);

  const endExclusiveAction = useCallback((key: string) => {
    pendingActionKeysRef.current.delete(key);
    setPendingActionKeys((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  const beginGenerationSubmitLock = useCallback((lockKey: string) => {
    if (generationSubmitLocksRef.current.has(lockKey)) {
      addToast('当前任务正在提交或生成中，请等待返回后再提交。', 'warning');
      return false;
    }
    generationSubmitLocksRef.current.add(lockKey);
    setGenerationSubmitLocks((prev) => ({ ...prev, [lockKey]: true }));
    return true;
  }, [addToast]);

  const endGenerationSubmitLock = useCallback((lockKey: string) => {
    if (!lockKey) return;
    generationSubmitLocksRef.current.delete(lockKey);
    setGenerationSubmitLocks((prev) => {
      if (!prev[lockKey]) return prev;
      const next = { ...prev };
      delete next[lockKey];
      return next;
    });
  }, []);

  const logShellError = useCallback((action: string, error: unknown, meta: Record<string, unknown> = {}, messagePrefix = '前端任务失败') => {
    const message = getRuntimeErrorMessage(error, messagePrefix);
    void safeCreateInternalLog({
      level: 'error',
      module: activeModule,
      action,
      message: `${messagePrefix}：${message}`.slice(0, 1000),
      detail: getRuntimeErrorDetail(error),
      status: 'failed',
      meta: {
        subFeature: activeSubFeature,
        pageMode,
        ...meta,
      },
    });
  }, [activeModule, activeSubFeature, pageMode]);

  const handleCurrentUserChange = useCallback((user: AuthUser) => {
    storeCurrentUserContext(user);
    setCurrentUser(user);
  }, []);

  useEffect(() => {
    if (!currentUser) return undefined;
    const handleWindowError = (event: ErrorEvent) => {
      logShellError('frontend_runtime_error', event.error || event.message, {
        source: event.filename,
        line: event.lineno,
        column: event.colno,
      }, '前端运行错误');
    };
    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      logShellError('frontend_unhandled_rejection', event.reason, {}, '前端异步错误');
    };
    window.addEventListener('error', handleWindowError);
    window.addEventListener('unhandledrejection', handleUnhandledRejection);
    return () => {
      window.removeEventListener('error', handleWindowError);
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
    };
  }, [currentUser, logShellError]);

  useEffect(() => {
    const handlePreferencesUpdated = (event: Event) => {
      const detail = (event as CustomEvent).detail || {};
      setApiConfig((prev) => ({
        ...prev,
        workspacePreferences: getWorkspacePreferences({ workspacePreferences: detail }),
      }));
    };
    window.addEventListener('meiao:workspace-preferences-updated', handlePreferencesUpdated as EventListener);
    return () => {
      window.removeEventListener('meiao:workspace-preferences-updated', handlePreferencesUpdated as EventListener);
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    void fetchSystemConfig()
      .then((result) => {
        if (disposed) return;
        setSystemConfig(result.config);
        if (currentUser?.role !== 'admin') {
          const effectiveConcurrency = getEffectiveConcurrency(result.config.queue.maxConcurrency, currentUser?.jobConcurrency);
          setApiConfig((prev) => ({ ...prev, concurrency: effectiveConcurrency }));
        }
      })
      .catch(() => {
        if (!disposed) setSystemConfig(null);
      });
    return () => {
      disposed = true;
    };
  }, [currentUser?.id, currentUser?.role, currentUser?.jobConcurrency]);

  // ── Materials (type-aware uploads) ──
  const [materials, setMaterials] = useState<Record<string, Material[]>>(
    () => initialDraftSnapshot.materials as Record<string, Material[]> || {},
  );
  const materialsRef = useRef<Record<string, Material[]>>(materials);
  const [oneClickReferencePresets, setOneClickReferencePresets] = useState<OneClickReferencePreset[]>([]);

  const restoreLocalMaterialPreviews = useCallback((sourceMaterials: Record<string, Material[]>) => {
    void restoreShellDraftAssetUrls(sourceMaterials).then((restoredMaterials) => {
      setMaterials((current) => {
        let changed = false;
        const restoredByAssetId = new Map<string, Material>();
        Object.values(restoredMaterials).forEach((list) => {
          (list || []).forEach((item) => {
            if (item.localAssetId && item.url) restoredByAssetId.set(item.localAssetId, item);
          });
        });
        if (restoredByAssetId.size === 0) return current;

        const next = Object.fromEntries(
          Object.entries(current).map(([type, list]) => [
            type,
            (list || []).map((item) => {
              if (!item.localAssetId) return item;
              const restored = restoredByAssetId.get(item.localAssetId);
              if (!restored?.url) return item;
              if (item.url === restored.url) return item;
              changed = true;
              return { ...item, url: restored.url };
            }),
          ]),
        ) as Record<string, Material[]>;
        return changed ? next : current;
      });
    });
  }, []);

  useEffect(() => {
    restoreLocalMaterialPreviews(initialDraftSnapshot.materials as Record<string, Material[]> || {});
  }, [restoreLocalMaterialPreviews]);

  const ensureMaterialRemoteUrls = useCallback(async (
    sourceMaterials: Record<string, Material[]>,
    module: AppModule,
  ): Promise<Record<string, Material[]>> => {
    const uploadedUpdates: Array<{ type: string; id: string; remoteUrl: string }> = [];
    const nextEntries = await Promise.all(
      Object.entries(sourceMaterials).map(async ([type, list]) => {
        const nextList = await Promise.all((list || []).map(async (item) => {
          const currentSafeUrl = resolvePublicAssetUrl(item.remoteUrl || item.url, publicBaseUrl);
          const refreshVideoAssetUrl = type === 'referenceVideo' && shouldRefreshVideoAssetUrl(currentSafeUrl, Boolean(item.localAssetId));
          const refreshExpiringMaterialUrl = type !== 'referenceVideo'
            && shouldRefreshExpiringMaterialUrl(currentSafeUrl, Boolean(item.localAssetId));
          if (currentSafeUrl && !refreshVideoAssetUrl && !refreshExpiringMaterialUrl) {
            return item.remoteUrl ? item : { ...item, remoteUrl: item.url };
          }
          if (!item.localAssetId) return item;

          const record = await loadShellDraftAsset(item.localAssetId);
          if (!record?.blob) {
            throw new Error(`${item.fileName || '素材'} 的本地缓存已失效，请重新上传后再生成。`);
          }

          const uploadFile = record.blob instanceof File
            ? record.blob
            : new File([record.blob], record.fileName || item.fileName || 'uploaded-asset', {
                type: record.mimeType || record.blob.type || 'application/octet-stream',
              });
          const uploaded = await uploadInternalAssetStream({
            module,
            file: uploadFile,
            fileName: record.fileName || item.fileName,
          });
          if (!uploaded.fileUrl) {
            throw new Error(`${item.fileName || '素材'} 上传失败，请重新上传后再生成。`);
          }
          uploadedUpdates.push({ type, id: item.id, remoteUrl: uploaded.fileUrl });
          return { ...item, remoteUrl: uploaded.fileUrl, url: uploaded.fileUrl };
        }));
        return [type, nextList] as const;
      }),
    );
    const nextMaterials = Object.fromEntries(nextEntries) as Record<string, Material[]>;
    if (uploadedUpdates.length > 0) {
      setMaterials((prev) => {
        const next = { ...prev };
        uploadedUpdates.forEach((update) => {
          next[update.type] = (next[update.type] || []).map((item) =>
            item.id === update.id ? { ...item, remoteUrl: update.remoteUrl, url: update.remoteUrl } : item
          );
        });
        materialsRef.current = next;
        return next;
      });
    }
    return nextMaterials;
  }, [publicBaseUrl]);

  // ── Projects (batch results) ──
  const [projects, setProjects] = useState<Project[]>(() => initialRuntimeSnapshot.projects);
  const projectsRef = useRef<Project[]>(initialRuntimeSnapshot.projects);
  const projectNameCounterRef = useRef<Record<string, number>>({});

  // ── Tasks (in-progress) ──
  const [tasks, setTasks] = useState<Task[]>(() => initialRuntimeSnapshot.tasks);
  const [hasHydratedSharedData, setHasHydratedSharedData] = useState(false);
  const showGenerationProgress = apiConfig.workspacePreferences?.showGenerationProgress !== false;
  const hydrationScheduledRef = useRef(false);
  const jobsHydrationScheduledRef = useRef(false);
  const latestSharedStateRef = useRef<Partial<PersistedAppState> | null>(null);
  const sharedStateWriteQueueRef = useRef<Promise<void>>(Promise.resolve());
  const restoredRuntimeProjectIdsRef = useRef(new Set(initialRuntimeSnapshot.projects.map((project) => project.id)));
  const restoredRuntimeTaskIdsRef = useRef(new Set(initialRuntimeSnapshot.tasks.map((task) => task.id)));
  const previousShellLocalScopeUserIdRef = useRef(shellLocalScopeUserId);
  const loggedStorageDiagnosticsForUserRef = useRef<string | null>(null);
  const shellSessionIdRef = useRef(
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `session-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );

  useEffect(() => {
    projectsRef.current = projects;
  }, [projects]);

  const reserveShortProjectName = useCallback(() => {
    const prefix = formatShortProjectNamePrefix();
    const nextNumber = Math.max(
      getNextShortProjectNameNumber(projectsRef.current, prefix),
      (projectNameCounterRef.current[prefix] || 0) + 1,
    );
    projectNameCounterRef.current[prefix] = nextNumber;
    return `${prefix}${nextNumber}`;
  }, []);

  const getRuntimeDeletionDraft = useCallback((remoteDraft?: unknown, userId?: string | null) => {
    return mergeShellRuntimeDeletionDrafts(
      loadShellDraftState(userId),
      remoteDraft || latestSharedStateRef.current?.shellDraft,
    );
  }, []);

  const getCurrentScopedImageModel = useCallback((module: AppModule, subFeature?: string) => {
    if (module === AppModuleObj.ONE_CLICK) {
      const branchKey = ONE_CLICK_REMOTE_BRANCH_BY_SUBFEATURE[subFeature || ''];
      return String(latestSharedStateRef.current?.oneClickMemory?.[branchKey]?.config?.model || '').trim();
    }
    return '';
  }, []);

  const resolveSharedStateBaseForWrite = useCallback(async () => {
    if (latestSharedStateRef.current) return latestSharedStateRef.current;
    if (shouldUseLocalStateFallback()) {
      const { loadPersistedAppState } = await loadShellPersistenceTools();
      return loadPersistedAppState(shellLocalScopeUserId);
    }
    try {
      const { normalizeLoadedPersistedAppState } = await loadShellPersistenceTools();
      const remoteResult = await fetchRemoteAppState();
      const remoteState = normalizeLoadedPersistedAppState(remoteResult.state);
      latestSharedStateRef.current = remoteState;
      return remoteState;
    } catch {
      return {};
    }
  }, [shellLocalScopeUserId]);

  const prepareLoadedSharedState = useCallback(async (loadedState: Partial<PersistedAppState> | null | undefined) => {
    const {
      buildPersistedAppState,
      savePersistedAppState,
      sanitizePersistedAppState,
    } = await loadShellPersistenceTools();
    const baseState = buildPersistedAppState(loadedState || {});
    const nextState = sanitizePersistedAppState(pruneKnownLegacyGarbageFromPersistedState(baseState));
    if (JSON.stringify(nextState) !== JSON.stringify(baseState)) {
      latestSharedStateRef.current = nextState;
      savePersistedAppState(nextState, shellLocalScopeUserId);
      void saveRemoteAppState(nextState, { mode: 'replace' }).catch((error) => {
        console.warn('[MEIAO] failed to persist legacy garbage cleanup', error);
      });
    }
    return nextState;
  }, [shellLocalScopeUserId]);

  const persistVideoMemoryToSharedState = useCallback((nextVideoMemory: VideoPersistentState) => {
    const write = async () => {
      const {
        buildPersistedAppState,
        savePersistedAppState,
        sanitizePersistedAppState,
      } = await loadShellPersistenceTools();
      const persistedBase = await resolveSharedStateBaseForWrite();
      const baseState = buildPersistedAppState(persistedBase);
      const nextState = sanitizePersistedAppState({
        ...baseState,
        apiConfig: {
          ...baseState.apiConfig,
          workspacePreferences: apiConfig.workspacePreferences || getWorkspacePreferences(),
        },
        videoMemory: nextVideoMemory,
      });
      latestSharedStateRef.current = nextState;
      savePersistedAppState(nextState, shellLocalScopeUserId);
      try {
        await saveRemoteAppState({
          apiConfig: nextState.apiConfig,
          videoMemory: nextState.videoMemory,
        });
        return true;
      } catch (error) {
        console.warn('[MEIAO] failed to persist video memory to remote storage', error);
        return false;
      }
    };

    const queuedWrite = sharedStateWriteQueueRef.current.then(write, write);
    sharedStateWriteQueueRef.current = queuedWrite.then(() => undefined, () => undefined);
    return queuedWrite;
  }, [apiConfig.workspacePreferences, resolveSharedStateBaseForWrite, shellLocalScopeUserId]);

  const persistShellDraftToSharedState = useCallback((draftState: ReturnType<typeof normalizeShellDraftState>) => {
    const write = async () => {
      const {
        buildPersistedAppState,
        savePersistedAppState,
        sanitizePersistedAppState,
      } = await loadShellPersistenceTools();
      const persistedBase = await resolveSharedStateBaseForWrite();
      const baseState = buildPersistedAppState(persistedBase);
      const nextState = sanitizePersistedAppState({
        ...baseState,
        shellDraft: normalizeShellDraftState(draftState, { requirePersistableMaterialUrl: true }),
      });
      latestSharedStateRef.current = nextState;
      savePersistedAppState(nextState, shellLocalScopeUserId);
      try {
        await saveRemoteAppState(nextState, { mode: 'replace' });
        return true;
      } catch (error) {
        console.warn('[MEIAO] failed to persist shell draft to remote storage', error);
        return false;
      }
    };

    const queuedWrite = sharedStateWriteQueueRef.current.then(write, write);
    sharedStateWriteQueueRef.current = queuedWrite.then(() => undefined, () => undefined);
    return queuedWrite;
  }, [resolveSharedStateBaseForWrite, shellLocalScopeUserId]);

  const persistSyncedProjectsToSharedState = useCallback((syncedProjects: Project[]) => {
    const projectsToPersist = syncedProjects.filter((project) => String(project?.id || '').trim());
    if (projectsToPersist.length === 0) return Promise.resolve(true);
    const write = async () => {
      const {
        buildPersistedAppState,
        savePersistedAppState,
        sanitizePersistedAppState,
        upsertOneClickProjectIntoPersistedState,
        upsertShellProjectIntoPersistedState,
      } = await loadShellPersistenceTools();
      const persistedBase = await resolveSharedStateBaseForWrite();
      let nextState = buildPersistedAppState(persistedBase);
      const touchedOneClickBranches = new Set<string>();
      projectsToPersist.forEach((project) => {
        const branchKey = project.module === AppModuleObj.ONE_CLICK
          ? ONE_CLICK_REMOTE_BRANCH_BY_SUBFEATURE[project.subFeature || '']
          : undefined;
        if (branchKey) touchedOneClickBranches.add(branchKey);
        nextState = upsertShellProjectIntoPersistedState(
          project.module === AppModuleObj.ONE_CLICK
            ? upsertOneClickProjectIntoPersistedState(nextState, project)
            : nextState,
          project,
        );
      });
      nextState = sanitizePersistedAppState(nextState);
      latestSharedStateRef.current = nextState;
      savePersistedAppState(nextState, shellLocalScopeUserId);
      const patch: Partial<PersistedAppState> = {
        shellProjects: Array.isArray(nextState.shellProjects) ? nextState.shellProjects : [],
      };
      if (touchedOneClickBranches.size > 0) {
        patch.oneClickMemory = Object.fromEntries(
          Array.from(touchedOneClickBranches).map((branchKey) => [
            branchKey,
            nextState.oneClickMemory?.[branchKey as keyof PersistedAppState['oneClickMemory']],
          ]),
        ) as Partial<PersistedAppState['oneClickMemory']> as PersistedAppState['oneClickMemory'];
      }
      try {
        await saveRemoteAppState(patch);
        return true;
      } catch (error) {
        console.warn('[MEIAO] failed to persist synced shell project jobs to remote storage', error);
        return false;
      }
    };

    const queuedWrite = sharedStateWriteQueueRef.current.then(write, write);
    sharedStateWriteQueueRef.current = queuedWrite.then(() => undefined, () => undefined);
    return queuedWrite;
  }, [resolveSharedStateBaseForWrite, shellLocalScopeUserId]);

  const setVideoMemory: React.Dispatch<React.SetStateAction<VideoPersistentState>> = useCallback((updater) => {
    setVideoMemoryState((prev) => {
      const baseState = prev || createDefaultVideoState();
      const next = typeof updater === 'function'
        ? (updater as (previous: VideoPersistentState) => VideoPersistentState)(baseState)
        : updater;
      if (typeof window !== 'undefined') {
        void persistVideoMemoryToSharedState(next);
      }
      return next;
    });
  }, [persistVideoMemoryToSharedState]);

  useEffect(() => {
    traceStartup('app-content:mounted');
  }, []);

  useEffect(() => {
    if (!currentUser?.id) return;
    if (loggedStorageDiagnosticsForUserRef.current === currentUser.id) return;
    loggedStorageDiagnosticsForUserRef.current = currentUser.id;
    void safeCreateInternalLog({
      level: 'info',
      module: 'system',
      action: 'frontend_startup_diagnostics',
      message: '前端启动诊断',
      status: 'success',
      meta: getBrowserStorageDiagnostics(currentUser.id),
    });
  }, [currentUser?.id]);

  useEffect(() => {
    if (!currentUser?.id) return undefined;
    const userId = currentUser.id;
    const sessionId = shellSessionIdRef.current;
    const previous = readShellSessionMarker(userId);
    const now = Date.now();

    if (previous && previous.id !== sessionId && previous.clean !== true) {
      void safeCreateInternalLog({
        level: 'error',
        module: previous.activeModule || 'system',
        action: 'frontend_previous_session_interrupted',
        message: '检测到上次页面会话未正常关闭，可能发生浏览器崩溃或进程被系统终止。',
        status: 'interrupted',
        meta: {
          previousSessionId: previous.id,
          previousStartedAt: previous.startedAt,
          previousUpdatedAt: previous.updatedAt,
          secondsSinceLastHeartbeat: previous.updatedAt ? Math.round((now - previous.updatedAt) / 1000) : null,
          previousPageMode: previous.pageMode,
          previousActiveModule: previous.activeModule,
          previousActiveSubFeature: previous.activeSubFeature,
          ...getBrowserStorageDiagnostics(userId),
        },
      });
    }

    const writeHeartbeat = (clean = false) => {
      const timestamp = Date.now();
      writeShellSessionMarker(userId, {
        id: sessionId,
        startedAt: previous?.id === sessionId ? previous.startedAt : now,
        updatedAt: timestamp,
        closedAt: clean ? timestamp : undefined,
        clean,
        pageMode,
        activeModule,
        activeSubFeature,
      });
    };

    writeHeartbeat(false);
    const intervalId = window.setInterval(() => writeHeartbeat(false), 10_000);
    const markClean = () => writeHeartbeat(true);
    window.addEventListener('pagehide', markClean);
    window.addEventListener('beforeunload', markClean);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('pagehide', markClean);
      window.removeEventListener('beforeunload', markClean);
      writeHeartbeat(true);
    };
  }, [activeModule, activeSubFeature, currentUser?.id, pageMode]);

  useEffect(() => {
    saveShellUiState({
      pageMode,
      activeModule,
      activeSubFeatureByModule,
      sidebarCollapsed,
    }, shellLocalScopeUserId);
  }, [pageMode, activeModule, activeSubFeatureByModule, sidebarCollapsed, shellLocalScopeUserId]);

  useEffect(() => {
    const prunedRuntimeSnapshot = pruneShellRuntimeSnapshotForDeletion(
      { projects, tasks },
      getRuntimeDeletionDraft(undefined, shellLocalScopeUserId),
    );
    saveShellRuntimeSnapshot(prunedRuntimeSnapshot, shellLocalScopeUserId);
  }, [getRuntimeDeletionDraft, projects, tasks, shellLocalScopeUserId]);

  useEffect(() => {
    if (!hasHydratedSharedData) return;
    const handle = window.setTimeout(() => {
      const localDraftState = normalizeShellDraftState({
        inputStateByScope,
        materials,
        deletedJobIds: latestSharedStateRef.current?.shellDraft?.deletedJobIds,
        deletedProjectIds: latestSharedStateRef.current?.shellDraft?.deletedProjectIds,
        deletedResultIds: latestSharedStateRef.current?.shellDraft?.deletedResultIds,
        updatedAt: Date.now(),
      });
      saveShellDraftState({
        inputStateByScope: localDraftState.inputStateByScope,
        materials: localDraftState.materials,
        deletedJobIds: localDraftState.deletedJobIds,
        deletedProjectIds: localDraftState.deletedProjectIds,
        deletedResultIds: localDraftState.deletedResultIds,
      }, shellLocalScopeUserId);
      void persistShellDraftToSharedState(localDraftState);
      void pruneShellDraftAssets(
        Object.values(localDraftState.materials)
          .flatMap((list) => list || [])
          .map((item) => item.localAssetId || '')
          .filter(Boolean),
      );
    }, 120);
    return () => window.clearTimeout(handle);
  }, [hasHydratedSharedData, inputStateByScope, materials, persistShellDraftToSharedState, shellLocalScopeUserId]);

  const setScopedPromptText = useCallback((text: string) => {
    setInputStateByScope((prev) => ({
      ...prev,
      [activeScopeKey]: {
        promptText: text,
        params: prev[activeScopeKey]?.params || {},
      },
    }));
  }, [activeScopeKey]);

  const handleSubFeatureChange = useCallback((subFeature: string) => {
    setActiveSubFeatureByModule((prev) => ({ ...prev, [activeModule]: subFeature }));
    const scopeKey = scopeKeyFor(activeModule, subFeature);
    const mappedParam = paramFromSubFeature(activeModule, subFeature);
    setInputStateByScope((prev) => ({
      ...prev,
      [scopeKey]: {
        promptText: prev[scopeKey]?.promptText || '',
        params: mappedParam
          ? { ...(prev[scopeKey]?.params || {}), [mappedParam[0]]: mappedParam[1] }
          : (prev[scopeKey]?.params || {}),
      },
    }));
  }, [activeModule]);

  const applyShellSnapshot = useCallback(async (loadedState: Partial<PersistedAppState> | null | undefined, jobs = []) => {
    traceStartup(`apply-snapshot:start:${jobs.length}`);
    const preparedState = await prepareLoadedSharedState(loadedState);
    latestSharedStateRef.current = preparedState;
    const { buildShellDataSnapshot } = await loadShellPersistenceTools();
    const snapshot = buildShellDataSnapshot(preparedState, jobs);
    const runtimeSnapshot = pruneShellRuntimeSnapshotForDeletion(
      loadShellRuntimeSnapshot(shellLocalScopeUserId),
      getRuntimeDeletionDraft(preparedState?.shellDraft, shellLocalScopeUserId),
    );
    const completedProjectSignatures = new Set(
      (snapshot.projects as Project[])
        .filter((project) => project.status === 'completed')
        .map(shellProjectSignature),
    );
    if (preparedState?.apiConfig) {
      setApiConfig({
        kieApiKey: '',
        concurrency: preparedState.apiConfig.concurrency || 5,
        workspacePreferences: getWorkspacePreferences(preparedState.apiConfig),
      });
    }
    setProjects(mergeShellProjects(runtimeSnapshot.projects, snapshot.projects as Project[])
      .filter((project) => {
        if (!restoredRuntimeProjectIdsRef.current.has(project.id)) return true;
        return !completedProjectSignatures.has(shellProjectSignature(project));
      }));
    setTasks(mergeShellTasks(runtimeSnapshot.tasks, snapshot.tasks as Task[])
      .filter((task) => {
        if (!restoredRuntimeTaskIdsRef.current.has(task.id)) return true;
        return !completedProjectSignatures.has(shellTaskSignature(task));
      }));
    const hydratedDraftSnapshot = resolveHydratedShellDraftState({
      localDraft: initialDraftSnapshot,
      remoteDraft: preparedState?.shellDraft,
      legacyMaterials: snapshot.materials as Record<string, Material[]>,
    });
    setInputStateByScope(hydratedDraftSnapshot.inputStateByScope);
    const hydratedMaterials = hydratedDraftSnapshot.materials as Record<string, Material[]>;
    setMaterials(hydratedMaterials);
    restoreLocalMaterialPreviews(hydratedMaterials);
    setOneClickReferencePresets(Array.isArray(preparedState?.oneClickMemory?.referencePresets?.presets)
      ? preparedState.oneClickMemory.referencePresets.presets
      : []);
    if (preparedState?.videoMemory) {
      setVideoMemoryState(preparedState.videoMemory as VideoPersistentState);
    }
    setHasHydratedSharedData(true);
    traceStartup(`apply-snapshot:end:${jobs.length}`);

  }, [getRuntimeDeletionDraft, prepareLoadedSharedState, restoreLocalMaterialPreviews, shellLocalScopeUserId]);

  const hydrateShellData = useCallback(async () => {
    traceStartup('hydrate-shell-data:start');
    try {
      const { normalizeLoadedPersistedAppState } = await loadShellPersistenceTools();
      const remoteResult = await fetchRemoteAppState();
      await applyShellSnapshot(normalizeLoadedPersistedAppState(remoteResult.state), []);
    } catch {
      if (shouldUseLocalStateFallback()) {
        const { loadPersistedAppState } = await loadShellPersistenceTools();
        const localState = loadPersistedAppState(shellLocalScopeUserId);
        await applyShellSnapshot(localState, []);
        return;
      }
      await applyShellSnapshot({}, []);
    }
    traceStartup('hydrate-shell-data:end');
  }, [applyShellSnapshot, shellLocalScopeUserId]);

  const hydrateShellJobs = useCallback(async () => {
    traceStartup('hydrate-shell-jobs:start');
    try {
      const { buildShellDataSnapshot } = await loadShellPersistenceTools();
      const jobsResult = await fetchInternalJobs();
      const fetchedJobs = Array.isArray(jobsResult.jobs) ? jobsResult.jobs : [];
      const terminalBackendJobIds = new Set(
        fetchedJobs
          .filter((job) => ['succeeded', 'completed', 'failed', 'cancelled', 'error', 'interrupted'].includes(String(job.status || '')))
          .map((job) => String(job.id || '').trim())
          .filter(Boolean),
      );
      const activeBackendJobIds = new Set(
        fetchedJobs
          .filter((job) => !['succeeded', 'completed', 'failed', 'cancelled', 'error', 'interrupted'].includes(String(job.status || '')))
          .map((job) => String(job.id || '').trim())
          .filter(Boolean),
      );
      const snapshot = buildShellDataSnapshot(latestSharedStateRef.current || {}, fetchedJobs);
      const syncedProjectsToPersist = (snapshot.projects as Project[])
        .filter((project) => shouldPersistSyncedProjectFromJobs(project, latestSharedStateRef.current));
      if (syncedProjectsToPersist.length > 0) {
        void persistSyncedProjectsToSharedState(syncedProjectsToPersist);
      }
      const runtimeSnapshot = pruneShellRuntimeSnapshotForDeletion(
        loadShellRuntimeSnapshot(shellLocalScopeUserId),
        getRuntimeDeletionDraft(undefined, shellLocalScopeUserId),
      );
      const snapshotProjectJobIds = new Set(
        (snapshot.projects as Project[])
          .map((project) => String(project.backendJobId || '').trim())
          .filter(Boolean),
      );
      const snapshotProjectIds = new Set(
        (snapshot.projects as Project[])
          .map((project) => String(project.id || '').trim())
          .filter(Boolean),
      );
      const activeSnapshotTaskProjectIds = new Set(
        (snapshot.tasks as Task[])
          .filter((task) => task.status === 'pending' || task.status === 'generating')
          .map((task) => String(task.projectId || '').trim())
          .filter(Boolean),
      );
      const liveProjectSignatures = new Set(
        (snapshot.projects as Project[])
          .filter((project) => project.status !== 'completed')
          .map(shellProjectSignature),
      );
      const completedProjectSignatures = new Set(
        (snapshot.projects as Project[])
          .filter((project) => project.status === 'completed')
          .map(shellProjectSignature),
      );
      const liveTaskSignatures = new Set((snapshot.tasks as Task[]).map(shellTaskSignature));
      setProjects((prev) => mergeShellProjects([...prev, ...runtimeSnapshot.projects], snapshot.projects as Project[])
        .filter((project) => {
          const backendJobId = String(project.backendJobId || '').trim();
          if (backendJobId && terminalBackendJobIds.has(backendJobId)) {
            return snapshotProjectJobIds.has(backendJobId);
          }
          if (!restoredRuntimeProjectIdsRef.current.has(project.id)) return true;
          if (!snapshotProjectIds.has(project.id) && !activeSnapshotTaskProjectIds.has(project.id)) return false;
          const signature = shellProjectSignature(project);
          if (liveProjectSignatures.has(signature)) return true;
          return !completedProjectSignatures.has(signature);
        }));
      setTasks((prev) => mergeShellTasks([...prev, ...runtimeSnapshot.tasks], snapshot.tasks as Task[])
        .filter((task) => {
          const backendJobId = String(task.backendJobId || task.id || '').trim();
          if (backendJobId && terminalBackendJobIds.has(backendJobId)) return false;
          if (backendJobId && activeBackendJobIds.has(backendJobId)) return true;
          if (!restoredRuntimeTaskIdsRef.current.has(task.id)) return true;
          const signature = shellTaskSignature(task);
          if (liveTaskSignatures.has(signature)) return true;
          if (!activeSnapshotTaskProjectIds.has(String(task.projectId || '').trim())) return false;
          return !completedProjectSignatures.has(`${task.module}:${task.subFeature || 'default'}:${task.title || ''}`);
        }));
    } catch {
      const runtimeSnapshot = pruneShellRuntimeSnapshotForDeletion(
        loadShellRuntimeSnapshot(shellLocalScopeUserId),
        getRuntimeDeletionDraft(undefined, shellLocalScopeUserId),
      );
      setProjects((prev) => mergeShellProjects([...prev, ...runtimeSnapshot.projects], []));
      setTasks(mergeShellTasks(runtimeSnapshot.tasks, []));
    }
    traceStartup('hydrate-shell-jobs:end');
  }, [getRuntimeDeletionDraft, persistSyncedProjectsToSharedState, shellLocalScopeUserId]);

  const resetShellWorkspaceForUser = useCallback((userId?: string | null) => {
    const scopedUiState = readShellUiState(userId);
    const draftSnapshot = loadShellDraftState(userId);
    const runtimeSnapshot = pruneShellRuntimeSnapshotForDeletion(loadShellRuntimeSnapshot(userId), draftSnapshot);
    Object.values(taskControllersRef.current).forEach((controller) => controller.abort());
    taskControllersRef.current = {};
    hydrationScheduledRef.current = false;
    jobsHydrationScheduledRef.current = false;
    latestSharedStateRef.current = null;
    sharedStateWriteQueueRef.current = Promise.resolve();
    restoredRuntimeProjectIdsRef.current = new Set(runtimeSnapshot.projects.map((project) => project.id));
    restoredRuntimeTaskIdsRef.current = new Set(runtimeSnapshot.tasks.map((task) => task.id));
    setProjects(runtimeSnapshot.projects);
    setTasks(runtimeSnapshot.tasks);
    saveShellRuntimeSnapshot(runtimeSnapshot, userId);
    setHasHydratedSharedData(false);
    setVideoMemoryState(null);
    setInputStateByScope(draftSnapshot.inputStateByScope || {});
    setMaterials(draftSnapshot.materials as Record<string, Material[]> || {});
    restoreLocalMaterialPreviews(draftSnapshot.materials as Record<string, Material[]> || {});
    const nextModule = scopedUiState.activeModule || AppModuleObj.ONE_CLICK;
    setActiveModule(nextModule);
    setActiveSubFeatureByModule({
      ...(scopedUiState.activeSubFeatureByModule || {}),
      [nextModule]: scopedUiState.activeSubFeatureByModule?.[nextModule] || getDefaultSubFeature(nextModule),
    });
    if (scopedUiState.pageMode) setPageMode(scopedUiState.pageMode);
    void hydrateShellData();
    void hydrateShellJobs();
  }, [hydrateShellData, hydrateShellJobs, restoreLocalMaterialPreviews]);

  useEffect(() => {
    if (previousShellLocalScopeUserIdRef.current === shellLocalScopeUserId) return;
    previousShellLocalScopeUserIdRef.current = shellLocalScopeUserId;
    resetShellWorkspaceForUser(shellLocalScopeUserId);
  }, [resetShellWorkspaceForUser, shellLocalScopeUserId]);

  const persistDeletionToSharedState = useCallback(async (target: { projectId: string; resultId?: string; jobIds?: string[] }) => {
    const write = async () => {
      try {
        const {
          buildPersistedAppState,
          savePersistedAppState,
          sanitizePersistedAppState,
        } = await loadShellPersistenceTools();
        const persistedBase = await resolveSharedStateBaseForWrite();
        const projectId = String(target.projectId || '').trim();
        const resultId = String(target.resultId || '').trim();
        const jobIds = Array.from(new Set((target.jobIds || [])
          .map((jobId) => String(jobId || '').trim())
          .filter(Boolean)));
        const prunedState = prunePersistedAppStateForDeletion(buildPersistedAppState(persistedBase), target);
        const nextState = sanitizePersistedAppState(prunedState);
        nextState.shellDraft = normalizeShellDraftState({
          ...nextState.shellDraft,
          deletedJobIds: Array.from(new Set([
            ...(prunedState.shellDraft?.deletedJobIds || []),
            ...jobIds,
          ])).slice(-500),
          deletedProjectIds: Array.from(new Set([
            ...(prunedState.shellDraft?.deletedProjectIds || []),
            projectId,
          ].filter(Boolean))).slice(-500),
          deletedResultIds: Array.from(new Set([
            ...(prunedState.shellDraft?.deletedResultIds || []),
            resultId,
          ].filter(Boolean))).slice(-500),
        });
        latestSharedStateRef.current = nextState;
        savePersistedAppState(nextState, shellLocalScopeUserId);
        try {
          await saveRemoteAppState(nextState, { mode: 'replace' });
          return true;
        } catch (error) {
          console.warn('[MEIAO] failed to persist deleted shell state to remote storage', error);
          return false;
        }
      } catch (error) {
        console.warn('[MEIAO] failed to prepare deleted shell state', error);
        return false;
      }
    };

    const queuedWrite = sharedStateWriteQueueRef.current.then(write, write);
    sharedStateWriteQueueRef.current = queuedWrite.then(() => undefined, () => undefined);
    return queuedWrite;
  }, [resolveSharedStateBaseForWrite, shellLocalScopeUserId]);

  const persistProjectToSharedState = useCallback((project: Project) => {
    const write = async () => {
      const {
        buildPersistedAppState,
        savePersistedAppState,
        sanitizePersistedAppState,
        upsertOneClickProjectIntoPersistedState,
        upsertShellProjectIntoPersistedState,
      } = await loadShellPersistenceTools();
      const persistedBase = await resolveSharedStateBaseForWrite();
      const baseState = buildPersistedAppState(persistedBase);
      const projectState = upsertShellProjectIntoPersistedState(
        project.module === AppModuleObj.ONE_CLICK
          ? upsertOneClickProjectIntoPersistedState(baseState, project)
          : baseState,
        project,
      );
      const nextState = sanitizePersistedAppState(projectState);
      latestSharedStateRef.current = nextState;
      savePersistedAppState(nextState, shellLocalScopeUserId);
      try {
        await saveRemoteAppState(buildProjectRemotePatch(nextState, project));
        return true;
      } catch (error) {
        console.warn('[MEIAO] failed to persist generated shell project to remote storage', error);
        return false;
      }
    };

    const queuedWrite = sharedStateWriteQueueRef.current.then(write, write);
    sharedStateWriteQueueRef.current = queuedWrite.then(() => undefined, () => undefined);
    return queuedWrite;
  }, [resolveSharedStateBaseForWrite, shellLocalScopeUserId]);

  const persistTranslationFilesToSharedState = useCallback((subFeature: string, files: Array<Record<string, unknown>>) => {
    const write = async () => {
      const {
        buildPersistedAppState,
        savePersistedAppState,
        sanitizePersistedAppState,
        upsertTranslationFilesIntoPersistedState,
      } = await loadShellPersistenceTools();
      const persistedBase = await resolveSharedStateBaseForWrite();
      const nextState = sanitizePersistedAppState(
        upsertTranslationFilesIntoPersistedState(
          buildPersistedAppState(persistedBase),
          subFeature,
          files as any,
        ),
      );
      latestSharedStateRef.current = nextState;
      savePersistedAppState(nextState, shellLocalScopeUserId);
      try {
        await saveRemoteAppState(buildTranslationRemotePatch(nextState, subFeature));
        return true;
      } catch (error) {
        console.warn('[MEIAO] failed to persist translation files to remote storage', error);
        return false;
      }
    };

    const queuedWrite = sharedStateWriteQueueRef.current.then(write, write);
    sharedStateWriteQueueRef.current = queuedWrite.then(() => undefined, () => undefined);
    return queuedWrite;
  }, [resolveSharedStateBaseForWrite, shellLocalScopeUserId]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (pageMode === 'landing') return;
    if (hydrationScheduledRef.current) return;
    hydrationScheduledRef.current = true;
    type HydrationHandle = number | ReturnType<typeof globalThis.setTimeout>;
    const scheduleHydration = (callback: () => void) => {
      if ('requestIdleCallback' in window) {
        return window.requestIdleCallback(callback, { timeout: 800 });
      }
      return globalThis.setTimeout(callback, 0);
    };
    const cancelHydration = (handle: HydrationHandle) => {
      if ('cancelIdleCallback' in window) {
        window.cancelIdleCallback(Number(handle));
        return;
      }
      globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>);
    };
    const handle = scheduleHydration(() => {
      void hydrateShellData();
    });
    return () => cancelHydration(handle);
  }, [pageMode, hydrateShellData]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (pageMode !== 'module') {
      jobsHydrationScheduledRef.current = false;
      return;
    }
    if (jobsHydrationScheduledRef.current) return;
    jobsHydrationScheduledRef.current = true;
    type HydrationHandle = number | ReturnType<typeof globalThis.setTimeout>;
    const scheduleHydration = (callback: () => void) => {
      return globalThis.setTimeout(callback, 0);
    };
    const cancelHydration = (handle: HydrationHandle) => {
      globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>);
    };
    const handle = scheduleHydration(() => {
      void hydrateShellJobs();
    });
    return () => {
      jobsHydrationScheduledRef.current = false;
      cancelHydration(handle);
    };
  }, [pageMode, hydrateShellJobs]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    if (pageMode !== 'module') return undefined;
    const hasActiveBackendTask = tasks.some((task) => {
      const status = String(task.status || '');
      return Boolean(task.backendJobId || task.id)
        && (status === 'pending' || status === 'generating');
    });
    const hasActiveBackendProject = projects.some((project) => {
      const status = String(project.status || '');
      if (status !== 'planning' && status !== 'generating') return false;
      if (isOneClickPlanReadyProject(project)) return false;
      return Boolean(project.backendJobId)
        || (project.results || []).some((result) => Boolean(result.backendJobId || result.taskId));
    });
    if (!hasActiveBackendTask && !hasActiveBackendProject) return undefined;
    const timeoutId = window.setTimeout(() => {
      void hydrateShellJobs();
    }, 0);
    const intervalId = window.setInterval(() => {
      void hydrateShellJobs();
    }, 10_000);
    return () => {
      window.clearTimeout(timeoutId);
      window.clearInterval(intervalId);
    };
  }, [hydrateShellJobs, pageMode, projects, tasks]);

  const handleModuleChange = useCallback((m: AppModule | 'landing') => {
    if (m === 'landing') { setPageMode('landing'); return; }
    if (m === AppModuleObj.SETTINGS) { setPageMode('settings'); return; }
    if (m === AppModuleObj.ACCOUNT) { setPageMode('account'); return; }
    setActiveModule(m);
    setActiveSubFeatureByModule((prev) => prev[m] ? prev : { ...prev, [m]: getDefaultSubFeature(m) });
    setPageMode('module');
  }, []);

  const handleNavigateFromLanding = useCallback((m: AppModule) => {
    setActiveModule(m);
    setActiveSubFeatureByModule((prev) => prev[m] ? prev : { ...prev, [m]: getDefaultSubFeature(m) });
    setPageMode('module');
  }, []);

  // ── Material upload ──
  const handleMaterialUpload = useCallback((type: string, files: FileList | null) => {
    if (!files) return;
    let selectedFiles = Array.from(files);
    if (
      activeModule === AppModuleObj.ONE_CLICK
      && activeSubFeature === 'main_image'
      && type === 'styleRef'
      && currentParams.planningLogic === '套图复刻'
    ) {
      const existingCount = (materials.styleRef || [])
        .filter((item) => isMaterialInActiveScope(item, activeModule, activeSubFeature))
        .length;
      const remaining = Math.max(0, 5 - existingCount);
      if (remaining <= 0) {
        addToast('参考套图最多上传 5 张', 'warning');
        return;
      }
      if (selectedFiles.length > remaining) {
        selectedFiles = selectedFiles.slice(0, remaining);
        addToast(`参考套图最多上传 5 张，本次已保留前 ${remaining} 张`, 'warning');
      }
    }
    if (
      activeModule === AppModuleObj.ONE_CLICK
      && activeSubFeature === 'detail_page'
      && type === 'styleRef'
      && currentParams.detailGenerationMode === '套图复刻'
    ) {
      const existingCount = (materials.styleRef || [])
        .filter((item) => isMaterialInActiveScope(item, activeModule, activeSubFeature))
        .length;
      const remaining = Math.max(0, 10 - existingCount);
      if (remaining <= 0) {
        addToast('详情页套图复刻最多保留 10 张参考风格图。', 'warning');
        return;
      }
      if (selectedFiles.length > remaining) {
        selectedFiles = selectedFiles.slice(0, remaining);
        addToast(`详情页套图复刻最多保留 10 张参考风格图，本次已保留前 ${remaining} 张。`, 'warning');
      }
    }
    const shouldResetSkuMaterials = shouldResetSkuMaterialsForUpload(activeModule, activeSubFeature, type);
    if (shouldResetSkuMaterials) {
      setMaterials((prev) => filterMaterialsForSkuUpload(prev, type) as Record<string, Material[]>);
    }
    if (shouldResetSkuInputTextForUpload(activeModule, activeSubFeature, type)) {
      setInputStateByScope((prev) => resetSkuInputStateForProductUpload(prev, activeScopeKey));
    }
    const giftStartIndex = type === 'gift'
      ? (shouldResetSkuMaterials ? 1 : Math.max(
          0,
          ...((materials.gift || [])
            .filter((item) => isMaterialInActiveScope(item, activeModule, activeSubFeature))
            .map((item) => item.giftIndex || 0))
        ) + 1)
      : 0;
    selectedFiles.forEach((file, fileIndex) => {
      void (async () => {
        const optimisticId = Math.random().toString(36).slice(2, 9);
        const localAssetId = `draft-${Date.now()}-${optimisticId}`;
        const giftIndex = type === 'gift' ? giftStartIndex + fileIndex : undefined;
        const relativePath = (file as any).webkitRelativePath || file.name;
        const previewUrl = safeCreateObjectURL(file) || '';
        const [dimensions] = await Promise.all([
          file.type.startsWith('image/') ? getImageDimensions(file).catch(() => null) : Promise.resolve(null),
          saveShellDraftAsset(localAssetId, file, { fileName: file.name, mimeType: file.type }).catch(() => false),
        ]);
        setMaterials((prev) => {
          const next = {
            ...prev,
            [type]: [...(prev[type] || []), {
              id: optimisticId,
              type,
              url: previewUrl,
              localAssetId,
              fileName: file.name,
            relativePath,
            subFeature: activeSubFeature,
              giftIndex,
              originalWidth: dimensions?.width,
              originalHeight: dimensions?.height,
            }],
          };
          materialsRef.current = next;
          return next;
        });
        const { uploadShellMaterial } = await loadShellWorkflowModule();
        const uploaded = await uploadShellMaterial(activeModule, type, file).catch(() => null);
        if (uploaded?.remoteUrl) {
          setMaterials((prev) => {
            const next = {
              ...prev,
              [type]: (prev[type] || []).map((m) =>
              m.id === optimisticId ? { ...m, remoteUrl: uploaded.remoteUrl, url: uploaded.remoteUrl } : m
              ),
            };
            materialsRef.current = next;
            return next;
          });
        }
      })();
    });
    addToast(`已添加 ${selectedFiles.length} 个${type === 'product' ? '产品素材' : type === 'gift' ? '赠品素材' : type === 'logo' ? '品牌Logo' : type === 'styleRef' && activeModule === AppModuleObj.ONE_CLICK && activeSubFeature === 'main_image' && currentParams.planningLogic === '套图复刻' ? '参考套图' : type === 'styleRef' && activeModule === AppModuleObj.ONE_CLICK && activeSubFeature === 'detail_page' && currentParams.detailGenerationMode === '套图复刻' ? '详情页套图参考' : '参考素材'}`, 'success');
  }, [activeModule, activeScopeKey, activeSubFeature, addToast, currentParams.detailGenerationMode, currentParams.planningLogic, materials.gift, materials.styleRef]);

  const handlePresetMaterialsApply = useCallback((items: Array<{ type: string; url: string; remoteUrl?: string; fileName: string }>) => {
    if (items.length === 0) return;
    setMaterials((prev) => {
      const next = { ...prev };
      items.forEach((item) => {
        const material: Material = {
          id: `preset-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          type: item.type,
          url: item.url,
          remoteUrl: item.remoteUrl || item.url,
          fileName: item.fileName,
          subFeature: activeSubFeature,
        };
        next[item.type] = [...(next[item.type] || []), material];
      });
      return next;
    });
    addToast(`已添加 ${items.length} 个参考预设`, 'success');
  }, [activeSubFeature, addToast]);

  const handleUpdateMaterial = useCallback((type: string, id: string, patch: Partial<Material>) => {
    setMaterials((prev) => {
      const next = {
        ...prev,
        [type]: (prev[type] || []).map((item) => (item.id === id ? { ...item, ...patch } : item)),
      };
      materialsRef.current = next;
      return next;
    });
  }, []);

  const handleImportStoryboardToGeneration = useCallback((project: VideoStoryboardProject, boardId?: string, boardIndex?: number, imageUrl?: string) => {
    const imported = buildStoryboardBoardGenerationImport(project, { boardId, boardIndex, imageUrl });
    const generationScopeKey = scopeKeyFor(AppModuleObj.VIDEO, 'generation');
    setActiveModule(AppModuleObj.VIDEO);
    setActiveSubFeatureByModule((prev) => ({ ...prev, [AppModuleObj.VIDEO]: 'generation' }));
    setPageMode('module');
    setInputStateByScope((prev) => ({
      ...prev,
      [generationScopeKey]: {
        promptText: imported.prompt,
        params: {
          ...(prev[generationScopeKey]?.params || {}),
          ...imported.params,
        },
      },
    }));
    setMaterials((prev) => {
      const next = { ...prev };
      const importedTypes = [...new Set(imported.materials.map((item) => item.type))];
      const generationMaterialTypesToReplace = new Set(['product', 'scene', 'referenceVideo', 'audio', ...importedTypes]);
      generationMaterialTypesToReplace.forEach((type) => {
        next[type] = (next[type] || []).filter((material) => material.subFeature && material.subFeature !== 'generation');
      });
      importedTypes.forEach((type) => {
        const scopedImportedMaterials: Material[] = imported.materials
          .filter((item) => item.type === type)
          .map((item) => ({
            id: `storyboard-import-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            type: item.type,
            url: item.url,
            remoteUrl: item.remoteUrl || item.url,
            fileName: item.fileName,
            subFeature: 'generation',
          }));
        next[type] = [
          ...(next[type] || []),
          ...scopedImportedMaterials,
        ];
      });
      return next;
    });
    const productCount = imported.materials.filter((item) => item.type === 'product').length;
    const storyboardCount = imported.materials.filter((item) => item.type === 'scene').length;
    addToast(`已导入短视频生成：${productCount} 张商品素材，${storyboardCount} 张分镜图`, 'success');
  }, [addToast]);

  const handleRemoveMaterial = useCallback((type: string, id: string) => {
    let removedMaterial: Material | undefined;
    setMaterials((prev) => ({
      ...prev,
      [type]: (prev[type] || []).filter((m) => {
        if (m.id === id) {
          removedMaterial = m;
          return false;
        }
        return true;
      }),
    }));
    if (removedMaterial?.localAssetId) {
      void deleteShellDraftAsset(removedMaterial.localAssetId);
    }
  }, []);

  useEffect(() => {
    materialsRef.current = materials;
  }, [materials]);

  const filteredMaterials = useMemo(
    () => filterMaterialsForScope(materials, activeModule, activeSubFeature),
    [materials, activeModule, activeSubFeature],
  );

  // ── Generate (standard modules) ──
  const handleGenerate = useCallback(async () => {
    const targetModule = activeModule;
    const targetSubFeature = activeSubFeature;
    const guardedSubmitLockKey = shouldGuardGenerationSubmit(targetModule, targetSubFeature)
      ? buildGenerationSubmitLockKey(targetModule, targetSubFeature)
      : '';
    const hasGuardedSubmitLock = Boolean(guardedSubmitLockKey);
    const beginGuardedSubmit = () => !hasGuardedSubmitLock || beginGenerationSubmitLock(guardedSubmitLockKey);
    const endGuardedSubmit = () => {
      if (hasGuardedSubmitLock) endGenerationSubmitLock(guardedSubmitLockKey);
    };
    let guardedSubmitReleased = false;
    const releaseGuardedSubmit = () => {
      if (guardedSubmitReleased) return;
      guardedSubmitReleased = true;
      endGuardedSubmit();
    };

    if (targetModule === AppModuleObj.VIDEO && targetSubFeature === 'generation' && !canUseVideoGenerationFeature(currentUser)) {
      addToast('短视频生成暂未对当前账号开放，请联系管理员开通。', 'warning');
      return;
    }
    if (isPendingShellSubFeature(targetModule, targetSubFeature)) {
      addToast('该子功能待制作，当前先迁移 3000 已有能力。', 'warning');
      return;
    }
    if (hasGuardedSubmitLock && hasActiveGuardedGeneration(projects, tasks, targetModule, targetSubFeature)) {
      addToast('当前已有任务未返回，请等待完成或取消后再提交。', 'warning');
      return;
    }

    if (targetModule === AppModuleObj.VIDEO && targetSubFeature === 'storyboard') {
      const storyboardPrompt = promptText.trim();
      let pendingStoryboardProjectIds: string[] = [];
      let storyboardFailureStep = '分镜任务准备';
      if (!beginGuardedSubmit()) return;
      setIsGenerating(true);
      try {
        const baseStoryboard = (videoMemory || createDefaultVideoState()).storyboard;
        const draftRuntimeConfig = buildVideoStoryboardConfig(baseStoryboard.config, storyboardPrompt, currentParams, {});
        const isViralStoryboard = draftRuntimeConfig.videoGenerationMode === 'viral_split';
        if (!storyboardPrompt && !isViralStoryboard) { addToast('请输入分镜需求', 'warning'); setIsGenerating(false); return; }
        const hasProductMaterials = (filteredMaterials.product || []).some((item) => item.remoteUrl || item.url || item.localAssetId);
        const hasReferenceVideoMaterial = (filteredMaterials.referenceVideo || []).some((item) => item.remoteUrl || item.url || item.localAssetId);
        if (!hasProductMaterials) {
          throw new Error('请先上传商品素材');
        }
        if (draftRuntimeConfig.videoGenerationMode === 'viral_split' && !hasReferenceVideoMaterial) {
          throw new Error('请先上传爆款复刻视频');
        }
        const projectTimestamp = Date.now();
        const nextProjects: VideoStoryboardProject[] = Array.from({ length: 1 }, (_, index) => ({
          id: `video_${projectTimestamp}_${index}_${Math.random().toString(36).slice(2, 6)}`,
          name: `${draftRuntimeConfig.videoGenerationMode === 'viral_split' ? '爆款复刻方案' : '分镜方案'} ${baseStoryboard.projects.length + index + 1}`,
          config: draftRuntimeConfig,
          status: 'scripting',
          script: '素材上传中，正在准备公网参考 URL...',
          shots: [],
          boards: [],
          createdAt: Date.now(),
          sceneDescription: draftRuntimeConfig.videoGenerationMode === 'viral_split' ? '' : (draftRuntimeConfig.scenes[index] || storyboardPrompt),
        }));
        pendingStoryboardProjectIds = nextProjects.map((project) => project.id);
        setVideoMemory((prev) => {
          const currentStoryboard = prev.storyboard || baseStoryboard;
          return {
            ...prev,
            isGenerating: true,
            storyboard: {
              ...currentStoryboard,
              config: draftRuntimeConfig,
              projects: [...nextProjects, ...(currentStoryboard.projects || [])],
            },
          };
        });
        releaseGuardedSubmit();
        storyboardFailureStep = '素材上传';
        const storyboardMaterials = await ensureMaterialRemoteUrls(filteredMaterials, AppModuleObj.VIDEO);
        const runtimeConfig = buildVideoStoryboardConfig(baseStoryboard.config, storyboardPrompt, currentParams, storyboardMaterials);
        const productUrls = runtimeConfig.uploadedProductUrls.length > 0 ? runtimeConfig.uploadedProductUrls : (storyboardMaterials.product || []).map((item) => item.remoteUrl || item.url).filter(Boolean);
        if (productUrls.length === 0) {
          throw new Error('请先上传商品素材');
        }
        if (runtimeConfig.videoGenerationMode === 'viral_split' && !runtimeConfig.uploadedReferenceVideoUrl) {
          throw new Error('请先上传爆款复刻视频');
        }
        setVideoMemory((prev) => {
          const currentStoryboard = prev.storyboard || baseStoryboard;
          return {
            ...prev,
            isGenerating: true,
            storyboard: {
              ...currentStoryboard,
              config: runtimeConfig,
              projects: currentStoryboard.projects.map((item) => pendingStoryboardProjectIds.includes(item.id) ? {
                ...item,
                config: runtimeConfig,
                script: '素材已上传，正在拆解爆款视频并生成提示词...',
                sceneDescription: runtimeConfig.videoGenerationMode === 'viral_split' ? '' : (runtimeConfig.scenes[0] || storyboardPrompt),
              } : item),
            },
          };
        });
        const { generateStoryboardScript, generateStoryboardBoardImage } = await import('./services/videoStoryboardService');
        for (const project of nextProjects) {
          storyboardFailureStep = '分镜脚本生成';
          const { script, shots, boards, taskId: planningTaskId, creditsConsumed: planningCreditsConsumed } = await generateStoryboardScript(runtimeConfig, productUrls, project.sceneDescription || storyboardPrompt, apiConfig);
          if (runtimeConfig.videoGenerationMode === 'viral_split') {
            setVideoMemory((prev) => {
              const currentStoryboard = prev.storyboard || baseStoryboard;
              return {
                ...prev,
                storyboard: {
                  ...currentStoryboard,
                  projects: currentStoryboard.projects.map((item) => item.id === project.id ? {
                    ...item,
                    script,
                    shots,
                    boards,
                    planningTaskId,
                    creditsConsumed: planningCreditsConsumed,
                    status: 'awaiting_image_confirmation',
                  } : item),
                },
              };
            });
            addToast('爆款复刻策划已生成，请确认后开始生图', 'success');
            continue;
          }
          setVideoMemory((prev) => {
            const currentStoryboard = prev.storyboard || baseStoryboard;
            return {
              ...prev,
              storyboard: {
                ...currentStoryboard,
                projects: currentStoryboard.projects.map((item) => item.id === project.id ? {
                  ...item,
                  script,
                  shots,
                  boards,
                  planningTaskId,
                  creditsConsumed: planningCreditsConsumed,
                  status: 'imaging',
                } : item),
              },
            };
          });
          let previousBoardImageUrl: string | undefined;
          storyboardFailureStep = '分镜宫格生图';
          for (const board of boards) {
            const generated = await generateStoryboardBoardImage(board, shots, runtimeConfig, productUrls, apiConfig, previousBoardImageUrl);
            const nextBoardImageUrl = generated.result.status === 'success' ? generated.result.imageUrl : undefined;
            setVideoMemory((prev) => {
              const currentStoryboard = prev.storyboard || baseStoryboard;
              return {
                ...prev,
                storyboard: {
                  ...currentStoryboard,
                  projects: currentStoryboard.projects.map((item) => {
                    if (item.id !== project.id) return item;
                    const nextBoards = item.boards.map((currentBoard) => currentBoard.id === board.id ? {
                      ...currentBoard,
                      status: (generated.result.status === 'success' ? 'completed' : 'failed') as VideoStoryboardProject['boards'][number]['status'],
                      imageUrl: nextBoardImageUrl,
                      prompt: generated.prompt,
                      taskId: generated.result.taskId,
                      creditsConsumed: generated.result.creditsConsumed,
                      error: generated.result.status === 'success' ? undefined : generated.result.message || '生成失败',
                      previousBoardImageUrl,
                    } : currentBoard);
                    return {
                      ...item,
                      boards: nextBoards,
                      status: nextBoards.some((currentBoard) => currentBoard.status === 'failed') ? 'failed' : item.status,
                      script,
                      shots,
                    };
                  }),
                },
              };
            });
            previousBoardImageUrl = nextBoardImageUrl;
          }
          setVideoMemory((prev) => {
            const currentStoryboard = prev.storyboard || baseStoryboard;
            return {
              ...prev,
              storyboard: {
                ...currentStoryboard,
                projects: currentStoryboard.projects.map((item) => item.id === project.id ? {
                  ...item,
                  status: item.boards.some((board) => board.status === 'failed') ? 'failed' : 'completed',
                  completedAt: Date.now(),
                } : item),
              },
            };
          });
        }
        addToast(`已生成 ${nextProjects.length} 个分镜生成方案`, 'success');
        setScopedPromptText('');
        return;
      } catch (error) {
        if (bailIfFrontendResourceError(error)) return;
        const failureMessage = formatVideoStoryboardFailureMessage(storyboardFailureStep, error);
        if (pendingStoryboardProjectIds.length > 0) {
          setVideoMemory((prev) => {
            const currentStoryboard = prev.storyboard || createDefaultVideoState().storyboard;
            return {
              ...prev,
              isGenerating: false,
              storyboard: {
                ...currentStoryboard,
                projects: currentStoryboard.projects.map((item) => pendingStoryboardProjectIds.includes(item.id) ? {
                  ...item,
                  status: 'failed',
                  error: failureMessage,
                } : item),
              },
            };
          });
        }
        addToast(failureMessage, 'error');
        return;
      } finally {
        setIsGenerating(false);
        setVideoMemory((prev) => ({ ...prev, isGenerating: false }));
        releaseGuardedSubmit();
      }
    }

    if (targetModule === AppModuleObj.VIDEO && targetSubFeature === 'diagnosis') {
      const url = promptText.trim();
      if (!url) { addToast('请输入视频链接', 'warning'); return; }
      const diagnosisModels = systemConfig?.agentModels?.chat || [];
      const fallbackAnalysisModel = systemConfig?.systemSettings?.effectiveVideoAnalysisModel
        || diagnosisModels[0]?.id
        || 'gemini-3-flash-openai';
      const requestedAnalysisModel = currentParams.analysisModel || fallbackAnalysisModel;
      const analysisModel = diagnosisModels.some((item) => item.id === requestedAnalysisModel)
        ? requestedAnalysisModel
        : fallbackAnalysisModel;
      if (!analysisModel) { addToast('请先选择分析模型', 'warning'); return; }
      if (!beginGuardedSubmit()) return;
      setIsGenerating(true);
      try {
        setVideoMemory((prev) => ({
          ...prev,
          diagnosis: {
            ...prev.diagnosis,
            url,
            analysisModel,
            probe: { ...prev.diagnosis.probe, status: 'loading', error: '', completedAt: null },
            report: { ...prev.diagnosis.report, status: 'idle', summary: '', evidence: [], inferences: [], actions: [] },
            aiAnalysis: { ...prev.diagnosis.aiAnalysis, status: 'idle', error: '', completedAt: null },
          },
        }));
        releaseGuardedSubmit();
        const diagnosisPlatform = toVideoDiagnosisPlatform(currentParams.platform);
        const probeResult = await probeVideoDiagnosis({
          platform: diagnosisPlatform,
          url,
          analysisItems: (currentParams.analysisItems || 'video_basic,video_metrics,author_profile').split(',').map((item) => item.trim()).filter(Boolean) as VideoDiagnosisAnalysisItem[],
          accessMode: 'spider_api',
        });
        setVideoMemory((prev) => ({
          ...prev,
          diagnosis: {
            ...prev.diagnosis,
            probe: probeResult.probe,
            report: probeResult.report,
          },
        }));
        const diagData = probeResult.probe?.normalized?.diag;
        if (diagData && probeResult.probe?.status !== 'error') {
          const result = await analyzeVideoDiagnosis({ diagData, platform: diagnosisPlatform, model: analysisModel });
          setVideoMemory((prev) => ({
            ...prev,
            diagnosis: {
              ...prev.diagnosis,
              aiAnalysis: { ...result.analysis, status: 'success', error: '', completedAt: Date.now() },
            },
          }));
          addToast('视频诊断已完成', 'success');
        } else {
          throw new Error(probeResult.probe?.error || '视频诊断勘探失败');
        }
        setScopedPromptText('');
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : '视频诊断失败';
        setVideoMemory((prev) => ({
          ...prev,
          diagnosis: {
            ...prev.diagnosis,
            aiAnalysis: { ...prev.diagnosis.aiAnalysis, status: 'error', error: message, completedAt: Date.now() },
          },
        }));
        addToast(message, 'error');
        return;
      } finally {
        setIsGenerating(false);
        setVideoMemory((prev) => ({ ...prev, isGenerating: false }));
        releaseGuardedSubmit();
      }
    }

    if (apiConfig.workspacePreferences?.playSoundAfterGeneration) {
      void primeCompletionSound();
    }
    const generationPrompt = targetModule === AppModuleObj.TRANSLATION ? '' : promptText;
    const allowEmptySkuPrompt = targetModule === AppModuleObj.ONE_CLICK && targetSubFeature === 'sku';
    const allowEmptyRetouchPrompt = targetModule === AppModuleObj.RETOUCH;
    const allowEmptyEverythingReplacePrompt = targetModule === AppModuleObj.EVERYTHING_REPLACE && targetSubFeature === 'product_replace';
    const allowEmptyPrompt = allowEmptySkuPrompt || allowEmptyRetouchPrompt || allowEmptyEverythingReplacePrompt || targetModule === AppModuleObj.TRANSLATION;
    if (!generationPrompt.trim() && !allowEmptyPrompt) { addToast('请输入创作描述', 'warning'); return; }
    const generationParams = normalizeParamsForGeneration(targetModule, targetSubFeature, currentParams) as Record<string, string> & {
      __workspacePreferences?: string;
      skuCopyText_0?: string;
      [key: string]: string | undefined;
    };
    if (targetModule === AppModuleObj.RETOUCH) {
      const retouchSizeWarning = getRetouchCustomSizeRatioWarning({
        aspectRatio: generationParams.ratio || generationParams.aspectRatio,
        resolutionMode: generationParams.resolutionMode,
        sizeMode: generationParams.sizeMode,
        width: generationParams.width || generationParams.targetWidth,
        height: generationParams.height || generationParams.targetHeight,
      });
      if (retouchSizeWarning) {
        addToast(retouchSizeWarning, 'warning');
        return;
      }
    }
    generationParams.__workspacePreferences = JSON.stringify(apiConfig.workspacePreferences || getWorkspacePreferences());
    let batchCount = resolveBatchCount(targetModule, targetSubFeature, generationParams);
    const translationSubFeatureLabel = MODULE_SUB_FEATURES[targetModule]
      ?.find((item) => item.id === targetSubFeature)?.label;
	    const projectName = reserveShortProjectName();
    const latestFilteredMaterials = filterMaterialsForScope(materialsRef.current, targetModule, targetSubFeature);
	    let generationMaterials = hasMaterialInputs(latestFilteredMaterials) || !hasMaterialInputs(filteredMaterials)
        ? latestFilteredMaterials
        : filteredMaterials;
    if (targetModule === AppModuleObj.EVERYTHING_REPLACE) {
      batchCount = resolveEverythingReplaceBatchCount(generationMaterials, generationParams);
    }
    if (!beginGuardedSubmit()) {
      return;
    }
    addToast('任务已提交，正在准备素材', 'info');
    const immediateCreatedAt = Date.now();
    const immediateProject = targetModule === AppModuleObj.EVERYTHING_REPLACE
      ? ({
        id: 'proj-' + Date.now(),
        name: projectName,
        module: targetModule,
        status: 'generating',
        createdAt: immediateCreatedAt,
        results: [],
        taskCount: batchCount,
        completedCount: 0,
        subFeature: targetSubFeature,
        generationContext: cloneGenerationContext(generationPrompt, generationParams, generationMaterials),
      } satisfies Project)
      : null;
    const immediateTask = immediateProject
      ? ({
        id: 'task-' + Date.now(),
        projectId: immediateProject.id,
        module: targetModule,
        type: 'image',
        status: 'pending',
        title: projectName,
        progress: 0,
        createdAt: immediateCreatedAt,
        total: batchCount,
        completed: 0,
        subFeature: targetSubFeature,
      } satisfies Task)
      : null;
    if (immediateProject && immediateTask) {
      setProjects((prev) => [immediateProject, ...prev]);
      setTasks((prev) => [immediateTask, ...prev]);
      setIsGenerating(true);
      void persistProjectToSharedState(immediateProject);
    }
	    try {
	      generationMaterials = await ensureMaterialRemoteUrls(generationMaterials, targetModule);
	    } catch (error) {
      const message = error instanceof Error ? error.message : '素材上传失败，请重新上传后重试。';
      logShellError('shell_generation_failed', error, {
        module: targetModule,
        subFeature: targetSubFeature,
        step: 'material_upload',
	      }, `${MODULE_NAMES[targetModule] || targetModule}素材上传失败`);
      if (immediateProject && immediateTask) {
        const failedProject: Project = {
          ...immediateProject,
          status: 'error',
          error: message,
          results: [{
            id: `${immediateTask.id}-material-error`,
            imageUrl: '',
            prompt: message,
            model: generationParams['model'] || 'gpt-image-2',
            aspectRatio: generationParams['ratio'] || 'auto',
            status: 'error',
            createdAt: immediateProject.createdAt,
            module: targetModule,
            subFeature: targetSubFeature,
            error: message,
          }],
          completedCount: 0,
          taskCount: batchCount,
        };
        setProjects((prev) => prev.map((project) => project.id === failedProject.id ? failedProject : project));
        setTasks((prev) => prev.map((task) => task.id === immediateTask.id ? { ...task, status: 'error', progress: 100 } : task));
        void persistProjectToSharedState(failedProject);
        setIsGenerating(false);
      }
	      addToast(message, 'error');
	      releaseGuardedSubmit();
	      return;
	    }
    const generationContext = targetModule === AppModuleObj.ONE_CLICK || targetModule === AppModuleObj.TRANSLATION || targetModule === AppModuleObj.EVERYTHING_REPLACE
      ? cloneGenerationContext(generationPrompt, generationParams, generationMaterials)
      : undefined;

    if (targetModule === AppModuleObj.TRANSLATION) {
      const translationSourceMaterials = (generationMaterials.product || [])
        .map((item) => {
          const sourceUrl = String(resolvePublicAssetUrl(item.remoteUrl || item.url, publicBaseUrl) || '').trim();
          if (!sourceUrl) return null;
          return { ...item, sourceUrl };
        })
        .filter((item): item is Material & { sourceUrl: string } => Boolean(item));
      if (translationSourceMaterials.length === 0) {
        addToast('请先上传产品素材', 'warning');
        releaseGuardedSubmit();
        return;
      }

      const projectId = `translation-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const createdAtTs = Date.now();
      const createdAt = createdAtTs;
      const projectTitle = translationSubFeatureLabel || MODULE_NAMES[targetModule];
      const totalCount = translationSourceMaterials.length;
      const translationFileItems: TranslationBatchFile[] = translationSourceMaterials.map((material, index) => ({
        id: `${projectId}-file-${index + 1}`,
        file: null,
        fileName: material.fileName || `翻译图片 ${index + 1}`,
        relativePath: (material as any).relativePath || material.fileName || `翻译图片 ${index + 1}`,
        sourceUrl: material.sourceUrl,
        sourcePreviewUrl: material.sourceUrl,
        status: 'pending',
        progress: 0,
        prompt: '',
        model: generationParams.model || 'GPT Image 2',
        aspectRatio: generationParams.ratio || generationParams.aspectRatio || 'auto',
        subFeature: targetSubFeature,
        projectId,
        projectName: projectTitle,
        projectCreatedAt: createdAtTs,
        originalWidth: material.originalWidth,
        originalHeight: material.originalHeight,
      }));

      const translationProject: Project = {
        id: projectId,
        name: totalCount > 1 ? `${projectTitle} · ${totalCount}张` : projectTitle,
        module: targetModule,
        status: 'generating',
        createdAt,
        results: translationFileItems.map((item) => translationFileToResult(item, createdAt)),
        taskCount: totalCount,
        completedCount: 0,
        subFeature: targetSubFeature,
        sourceType: 'persisted',
        generationContext,
      };
      const translationTasks: Task[] = translationFileItems.map((item, index) => ({
        id: `${item.id}-task`,
        projectId,
        module: targetModule,
        type: 'image',
        status: 'pending',
        title: item.fileName || `翻译图片 ${index + 1}`,
        progress: 0,
        createdAt,
        total: 1,
        completed: 0,
        subFeature: targetSubFeature,
      }));

      setProjects((prev) => [translationProject, ...prev]);
      setTasks((prev) => [...translationTasks, ...prev]);
      setIsGenerating(true);
      void persistTranslationFilesToSharedState(targetSubFeature, translationFileItems);

      const { runShellImageGeneration } = await loadShellWorkflowModule();
      const syncTranslationProject = (nextFiles: TranslationBatchFile[]) => {
        const nextResults = nextFiles.map((item) => translationFileToResult(item, createdAt));
        setProjects((prev) => prev.map((project) => (
          project.id === projectId
            ? {
                ...project,
                status: getTranslationProjectStatus(nextFiles),
                results: nextResults,
                taskCount: totalCount,
                completedCount: getTranslationCompletedCount(nextFiles),
              }
            : project
        )));
        setTasks((prev) => prev.map((task) => {
          const index = translationTasks.findIndex((item) => item.id === task.id);
          if (index < 0) return task;
          const current = nextFiles[index];
          if (!current) return task;
          return {
            ...task,
            backendJobId: current.backendJobId || task.backendJobId,
            status: current.status === 'completed'
              ? 'completed'
              : current.status === 'error' || current.status === 'interrupted'
                ? 'error'
                : current.status === 'pending'
                  ? 'pending'
                  : 'generating',
            progress: current.status === 'completed' || current.status === 'error' || current.status === 'interrupted' ? 100 : Math.max(task.progress || 0, 10),
          };
        }));
        void persistTranslationFilesToSharedState(targetSubFeature, nextFiles);
      };

      const buildTranslationPrompt = (material: TranslationBatchFile, index: number, matchedRatio: string) => [
        `模块：${MODULE_NAMES[targetModule]}`,
        `子功能：${targetSubFeature}`,
        `用户需求：请根据上传的素材完成${translationSubFeatureLabel || '出海翻译'}，保持商品主体与文字结构稳定，输出适合当前页面展示的结果。`,
        `前端参数：${JSON.stringify({
          ...generationParams,
          ratio: matchedRatio,
          aspectRatio: matchedRatio,
          __batchIndex: String(index + 1),
          __batchCount: String(totalCount),
          __sourceFileName: material.fileName,
          __sourceRelativePath: material.relativePath,
        })}`,
        '请严格围绕上传素材完成对应电商视觉任务，保持商品主体一致，输出可直接用于当前模块结果展示的图片。',
      ].filter(Boolean).join('\n');

      let successCount = 0;
      let nextIndex = 0;
      const workerCount = Math.max(1, Math.min(Number(apiConfig.concurrency || 1) || 1, totalCount));
      const runWorker = async () => {
        while (nextIndex < totalCount) {
          const index = nextIndex;
          nextIndex += 1;
          const material = translationSourceMaterials[index];
          const currentFileItem = translationFileItems[index];
          const taskId = `${currentFileItem.id}-task`;
          const controller = new AbortController();
          taskControllersRef.current[taskId] = controller;

          try {
            const sourceDimensions = material.originalWidth && material.originalHeight
              ? {
                  width: material.originalWidth,
                  height: material.originalHeight,
                  ratio: material.originalWidth / material.originalHeight,
                }
              : await getImageDimensionsFromUrl(material.sourceUrl).catch(() => null);
            const modelConfig = {
              targetLanguage: String(generationParams.lang || 'English'),
              customLanguage: '',
              removeWatermark: true,
              aspectRatio: String(generationParams.ratio || generationParams.aspectRatio || 'auto'),
              quality: String(generationParams.quality || '1K').toLowerCase().includes('4')
                ? '4k'
                : String(generationParams.quality || '1K').toLowerCase().includes('2')
                  ? '2k'
                  : '1k',
              model: normalizeShellImageModel(generationParams.model || 'GPT Image 2'),
              resolutionMode: String(generationParams.resolutionMode || generationParams.sizeMode || 'custom').includes('original')
                ? 'original'
                : 'custom',
              targetWidth: Number(generationParams.targetWidth || generationParams.width || 0),
              targetHeight: Number(generationParams.targetHeight || generationParams.height || 0),
              maxFileSize: Number(generationParams.maxFileSize || generationParams.maxSize || 2),
            };
            const { effectiveConfig } = deriveTranslationExecutionPlan({
              config: modelConfig as any,
              subMode: targetSubFeature === 'detail' ? 'detail' : targetSubFeature === 'remove_text' ? 'remove_text' : 'main',
              sourceDimensions: sourceDimensions || undefined,
            });
            const matchedRatio = String(effectiveConfig.aspectRatio || modelConfig.aspectRatio || 'auto');
            const promptForModel = buildTranslationPrompt(currentFileItem, index, matchedRatio);

            translationFileItems[index] = {
              ...currentFileItem,
              status: 'processing',
              progress: 12,
              prompt: promptForModel,
              aspectRatio: matchedRatio,
              matchedAspectRatio: matchedRatio,
              taskId,
            };
            syncTranslationProject(translationFileItems);
            setTasks((prev) => prev.map((task) => (
              task.id === taskId
                ? { ...task, status: 'generating', progress: 12 }
                : task
            )));

            const result = await runShellImageGeneration({
              module: targetModule,
              subFeature: targetSubFeature,
              prompt: promptForModel,
              params: {
                ...generationParams,
                ratio: matchedRatio,
                aspectRatio: matchedRatio,
                __workspacePreferences: JSON.stringify(apiConfig.workspacePreferences || getWorkspacePreferences()),
                __batchIndex: String(index + 1),
                __batchCount: String(totalCount),
                __sourceFileName: currentFileItem.fileName,
                __sourceRelativePath: currentFileItem.relativePath,
              },
              materials: {
                ...generationMaterials,
                product: [{
                  id: material.id,
                  type: material.type,
                  url: material.sourceUrl,
                  remoteUrl: material.sourceUrl,
                  fileName: material.fileName,
                  subFeature: targetSubFeature,
                }],
              },
              signal: controller.signal,
              onJobCreated: (jobId: string, providerTaskId?: string) => {
                translationFileItems[index] = {
                  ...translationFileItems[index],
                  backendJobId: jobId || undefined,
                  taskId: providerTaskId || translationFileItems[index].taskId,
                };
                syncTranslationProject(translationFileItems);
                releaseGuardedSubmit();
              },
              publicBaseUrl,
            });

            if (result.status !== 'success' || !result.imageUrl) {
              throw new Error(result.message || `第 ${index + 1} 张生成失败`);
            }

            translationFileItems[index] = {
              ...currentFileItem,
              status: 'completed',
              progress: 100,
              taskId: result.taskId || currentFileItem.taskId,
              creditsConsumed: result.creditsConsumed,
              resultUrl: result.imageUrl,
              matchedAspectRatio: matchedRatio,
              prompt: result.prompt || promptForModel,
              model: String(generationParams.model || 'GPT Image 2'),
              aspectRatio: matchedRatio,
            };
            successCount += 1;
            syncTranslationProject(translationFileItems);
          } catch (error) {
            if (bailIfFrontendResourceError(error)) return;
            const message = error instanceof Error ? error.message : '翻译任务失败';
            logShellError('translation_generation_failed', error, {
              projectId,
              taskId,
              subFeature: targetSubFeature,
              fileName: currentFileItem.fileName,
              relativePath: currentFileItem.relativePath,
              taskIndex: index + 1,
              totalCount,
            }, '出海翻译任务失败');
            translationFileItems[index] = {
              ...currentFileItem,
              status: 'error',
              progress: 100,
              error: message,
              prompt: currentFileItem.prompt || message,
              model: String(generationParams.model || 'GPT Image 2'),
            };
            syncTranslationProject(translationFileItems);
            addToast(`${translationFileItems[index].fileName || `翻译图片 ${index + 1}`}：${message}`, 'error');
          } finally {
            delete taskControllersRef.current[taskId];
          }
        }
      };
      await Promise.all(Array.from({ length: workerCount }, () => runWorker()));

      const completedProject: Project = {
        ...translationProject,
        status: translationFileItems.some((item) => item.status === 'error' || item.status === 'interrupted')
          ? 'error'
        : 'completed',
      completedAt: createdAt,
      results: translationFileItems.map((file) => translationFileToResult(file, createdAt)),
      completedCount: getTranslationCompletedCount(translationFileItems),
      taskCount: totalCount,
    };
      setProjects((prev) => prev.map((project) => (
        project.id === projectId ? completedProject : project
      )));
      setTasks((prev) => prev.filter((task) => !translationTasks.some((item) => item.id === task.id)));
      void persistTranslationFilesToSharedState(targetSubFeature, translationFileItems);
      void persistProjectToSharedState(completedProject);
      setIsGenerating(false);
      releaseGuardedSubmit();

      if (successCount > 0) {
        addToast(successCount === totalCount
          ? `已生成 ${successCount} 张图片 · ${MODULE_NAMES[targetModule]}`
          : `已完成 ${successCount}/${totalCount} 张图片 · ${MODULE_NAMES[targetModule]}`,
        successCount === totalCount ? 'success' : 'warning');
      }
      setScopedPromptText('');
      return;
    }

    if (targetModule === AppModuleObj.ONE_CLICK) {
      const projectId = 'proj-plan-' + Date.now();
      const createdAt = Date.now();
      const planningProject: Project = {
        id: projectId,
        name: projectName,
        module: targetModule,
        status: 'planning',
        createdAt,
        results: [],
        taskCount: 1,
        completedCount: 0,
        subFeature: targetSubFeature,
        generationContext,
      };
      const taskId = 'task-plan-' + Date.now();
      const planTask: Task = {
        id: taskId,
        projectId,
        module: targetModule,
        type: 'plan',
        status: 'pending',
        title: `策划: ${projectName}`,
        progress: 0,
        createdAt,
        total: 1,
        completed: 0,
        subFeature: targetSubFeature,
      };
      const controller = new AbortController();
      taskControllersRef.current[taskId] = controller;
      setProjects((prev) => [planningProject, ...prev]);
      setTasks((prev) => [planTask, ...prev]);
      void persistProjectToSharedState(planningProject);
      setIsGenerating(true);
      let planningProviderTaskId = '';
      let activePlanningBackendJobId = '';
      const onJobCreated = (jobId: string, providerTaskId?: string) => {
        const providerId = String(providerTaskId || '').trim();
        const backendJobId = String(jobId || '').trim();
        if (backendJobId) activePlanningBackendJobId = backendJobId;
        if (providerId) planningProviderTaskId = providerId;
        const persistedPlanningProject = {
          ...planningProject,
          backendJobId,
          ...(providerId ? { planningTaskId: latestIdentityText(providerId) } : {}),
        };
        setProjects((prev) => prev.map((project) => (
          project.id === projectId
            ? { ...project, ...persistedPlanningProject }
            : project
        )));
        setTasks((prev) => prev.map((task) => (
          task.id === taskId
            ? { ...task, backendJobId, status: 'generating', progress: Math.max(task.progress || 0, 8) }
            : task
        )));
        void persistProjectToSharedState(persistedPlanningProject);
        if (backendJobId || providerId) {
          releaseGuardedSubmit();
        }
      };

      try {
        const { runShellOneClickPlanning } = await loadShellWorkflowModule();
        const planResult = await runShellOneClickPlanning({
          module: targetModule,
          subFeature: targetSubFeature,
          prompt: generationPrompt,
          params: generationParams,
          materials: filteredMaterials,
          signal: controller.signal,
          taskMetadata: {
            shellPlanningPurpose: 'one_click_planning',
            shellProjectId: projectId,
            shellProjectName: projectName,
            subFeature: targetSubFeature,
          },
          onJobCreated,
          publicBaseUrl,
        });
        if (!planResult.plans.length) {
          throw new Error(planResult.message || '策划没有返回可用方案');
        }
        const failedPlanningPlans = planResult.plans.filter(isFailedPlanningPlan);
        const runnablePlanningPlans = planResult.plans.filter((plan) => !isFailedPlanningPlan(plan));
        const planningErrorMessage = String(planResult.message || '策划失败').trim();
        const failedPlanningResults = failedPlanningPlans.length === planResult.plans.length
          ? failedPlanningPlans.map((plan, index) => buildFailedPlanningResultFromPlan({
            plan,
            index,
            projectId,
            createdAt,
            module: targetModule,
            subFeature: targetSubFeature,
            model: generationParams['model'] || 'gpt-image-2',
            aspectRatio: generationParams['ratio'] || 'auto',
            fallbackMessage: planningErrorMessage,
          }))
          : [];
        const plannedProject: Project = {
          ...planningProject,
          status: runnablePlanningPlans.length > 0 ? 'planning' : 'error',
          plans: planResult.plans,
          selectedPlanId: runnablePlanningPlans.find((plan) => plan.selected)?.id || runnablePlanningPlans[0]?.id,
          results: failedPlanningResults,
          taskCount: planResult.plans.length,
          completedCount: 0,
          subFeature: targetSubFeature,
          generationContext,
          backendJobId: activePlanningBackendJobId || planningProject.backendJobId,
          creditsConsumed: planResult.creditsConsumed,
          planningTaskId: latestIdentityText(planResult.taskId, planningProviderTaskId),
          error: runnablePlanningPlans.length > 0 ? undefined : planningErrorMessage,
        };
        setProjects((prev) => prev.map((p) =>
          p.id === projectId
            ? plannedProject
            : p
        ));
        void persistProjectToSharedState(plannedProject);
        setTasks((prev) => prev.filter((t) => t.id !== taskId));
        setScopedPromptText('');
        if (failedPlanningPlans.length > 0 && runnablePlanningPlans.length > 0) {
          addToast(`策划完成 ${runnablePlanningPlans.length}/${planResult.plans.length}，${failedPlanningPlans.length} 个参考图失败`, 'warning');
        } else if (failedPlanningPlans.length > 0) {
          addToast(planningErrorMessage, 'error');
        } else {
          addToast(`策划已完成，共 ${planResult.plans.length} 个方案`, 'success');
        }
      } catch (error) {
        if (bailIfFrontendResourceError(error)) return;
        const message = error instanceof Error ? error.message : '策划失败';
        const planningBackendJobId = activePlanningBackendJobId || planningProject.backendJobId || '';
        const latestPlanningJob: InternalJob | null = planningBackendJobId
          ? await fetchInternalJob(planningBackendJobId).then((result) => result.job).catch(() => null)
          : null;
        const latestPlanningJobStatus = String(latestPlanningJob?.status || '');
        const planningJobIsStillActive = ['queued', 'running', 'retry_waiting'].includes(latestPlanningJobStatus);
        const planningErrorCode = String(
          latestPlanningJob?.errorCode
          || (error instanceof Error ? (error as Error & { code?: string }).code : '')
          || ''
        ).trim();
        const planningErrorMessage = String(
          latestPlanningJob?.errorMessage
          || latestPlanningJob?.errorCode
          || message
          || '策划失败'
        ).trim();
        const planningRecoverable = isRecoverableKieTaskResult(
          planningProviderTaskId,
          planningErrorMessage,
          planningErrorCode,
        );
        logShellError('one_click_planning_failed', error, {
          projectId,
          taskId,
          subFeature: targetSubFeature,
          backendJobId: planningBackendJobId || undefined,
          providerTaskId: planningProviderTaskId || undefined,
          latestJobStatus: latestPlanningJobStatus || undefined,
        }, '一键主详策划失败');
        if (planningRecoverable && planningJobIsStillActive) {
          const pendingPlanningProject: Project = {
            ...planningProject,
            status: 'planning',
            backendJobId: planningBackendJobId,
            planningTaskId: latestIdentityText(planningProviderTaskId),
            error: '任务已提交云端，结果待同步',
          };
          setProjects((prev) => prev.map((p) =>
            p.id === projectId
              ? pendingPlanningProject
              : p
          ));
          void persistProjectToSharedState(pendingPlanningProject);
          setTasks((prev) => prev.map((t) => t.id === taskId
            ? { ...t, backendJobId: planningBackendJobId || t.backendJobId, status: 'generating', progress: Math.max(t.progress || 0, 8) }
            : t
          ));
          addToast('策划任务已提交云端，结果待同步，可稍后点击同步。', 'info');
          window.setTimeout(() => void hydrateShellJobs(), 800);
          return;
        }
        const planningPeerJobs = await fetchInternalJobs(500)
          .then((result) => Array.isArray(result.jobs) ? result.jobs : [])
          .catch(() => []);
        const failedPlanningPlans = collectFailedOneClickPlanningPlans(
          [latestPlanningJob, ...planningPeerJobs],
          {
            projectId,
            projectName,
            fallbackErrorMessage: planningErrorMessage,
          },
        );
        const failedPlanningResults = failedPlanningPlans.map((plan, index) => buildFailedPlanningResultFromPlan({
          plan,
          index,
          projectId,
          createdAt,
          module: targetModule,
          subFeature: targetSubFeature,
          model: generationParams['model'] || 'gpt-image-2',
          aspectRatio: generationParams['ratio'] || 'auto',
          fallbackMessage: planningErrorMessage,
        }));
        const failedProject: Project = {
          ...planningProject,
          status: 'error',
          backendJobId: planningBackendJobId,
          planningTaskId: latestIdentityText(planningProviderTaskId),
          results: failedPlanningResults.length > 0 ? failedPlanningResults : [{
            id: `${taskId}-error`,
            imageUrl: '',
            prompt: planningErrorMessage,
            model: generationParams['model'] || 'gpt-image-2',
            aspectRatio: generationParams['ratio'] || 'auto',
            status: 'error',
            createdAt,
            module: targetModule,
            subFeature: targetSubFeature,
            taskId: planningProviderTaskId || undefined,
            backendJobId: planningBackendJobId || undefined,
            error: planningErrorMessage,
          }],
          plans: failedPlanningPlans.length > 0 ? failedPlanningPlans : planningProject.plans,
          taskCount: Math.max(
            Number(planningProject.taskCount || 0) || 0,
            failedPlanningPlans.length,
            failedPlanningResults.length,
            1,
          ),
          completedCount: 0,
          error: planningErrorMessage,
        };
        setProjects((prev) => prev.map((p) =>
          p.id === projectId
            ? failedProject
            : p
        ));
        void persistProjectToSharedState(failedProject);
        setTasks((prev) => prev.map((t) => t.id === taskId ? { ...t, status: 'error', progress: 100 } : t));
        addToast(planningErrorMessage, 'error');
      } finally {
        delete taskControllersRef.current[taskId];
        releaseGuardedSubmit();
        setIsGenerating(false);
      }
      return;
    }

    // Create project
    const projectId = immediateProject?.id || 'proj-' + Date.now();
    const newProject: Project = {
      ...(immediateProject || {}),
      id: projectId,
      name: projectName,
      module: targetModule,
      status: 'generating',
      createdAt: immediateProject?.createdAt ?? Date.now(),
      results: [],
      taskCount: batchCount,
      completedCount: 0,
      subFeature: targetSubFeature,
      generationContext,
    };
    if (immediateProject) {
      setProjects((prev) => prev.map((project) => project.id === projectId ? newProject : project));
    } else {
      setProjects((prev) => [...prev, newProject]);
    }

    // Create task
    const taskId = immediateTask?.id || 'task-' + Date.now();
    const newTask: Task = {
      ...(immediateTask || {}),
      id: taskId,
      projectId,
      module: targetModule,
      type: targetModule === AppModuleObj.VIDEO ? 'video' : 'image',
      status: 'pending',
      title: projectName,
      progress: 0,
      createdAt: newProject.createdAt,
      total: batchCount,
      completed: 0,
      subFeature: targetSubFeature,
    };
    if (immediateTask) {
      setTasks((prev) => prev.map((task) => task.id === taskId ? newTask : task));
    } else {
      setTasks((prev) => [newTask, ...prev]);
    }
    setIsGenerating(true);

    const controller = new AbortController();
	    taskControllersRef.current[taskId] = controller;
	    let batchResults: GeneratedResult[] = [];
	    let pendingSyncProject: Project | null = null;
	    let activeBackendJobId = '';
	    let activeProviderTaskId = '';
	    const onJobCreated = (jobId: string, providerTaskId?: string) => {
	      activeBackendJobId = String(jobId || '').trim();
	      if (providerTaskId) activeProviderTaskId = String(providerTaskId || '').trim();
	      const pendingVideoProject: Project | null = targetModule === AppModuleObj.VIDEO
	        ? {
	            ...newProject,
	            backendJobId: activeBackendJobId,
	            status: 'generating',
	            results: [{
	              id: `${taskId}-pending-video`,
	              imageUrl: '',
	              videoUrl: undefined,
	              mediaType: 'video',
	              prompt: generationPrompt,
	              model: generationParams['modelVersion'] || generationParams['model'] || 'bytedance/seedance-2-fast',
	              aspectRatio: generationParams['ratio'] || generationParams['aspectRatio'] || 'auto',
	              status: 'generating',
	              createdAt: newProject.createdAt,
	              module: targetModule,
	              subFeature: targetSubFeature,
	              backendJobId: activeBackendJobId || undefined,
	              error: '任务已提交云端，等待生成结果',
	            }],
	            completedCount: 0,
	            taskCount: 1,
	            error: '任务已提交云端，等待生成结果',
	          }
	        : null;
	      setProjects((prev) => prev.map((project) => (
	        project.id === projectId
	          ? (pendingVideoProject || { ...project, backendJobId: jobId })
          : project
      )));
      setTasks((prev) => prev.map((task) => (
        task.id === taskId
          ? { ...task, backendJobId: jobId, status: 'generating', progress: Math.max(task.progress || 0, 8) }
          : task
      )));
	      if (pendingVideoProject) {
	        void persistProjectToSharedState(pendingVideoProject);
	      }
	      releaseGuardedSubmit();
    };

    try {
      setTasks((prev) => prev.map((t) => t.id === taskId ? { ...t, progress: 12 } : t));
      const { runShellBuyerShowWorkflow, runShellImageGeneration, runShellRetouchWorkflow, runShellVideoGeneration } = await loadShellWorkflowModule();
          const result = targetModule === AppModuleObj.VIDEO
        ? await runShellVideoGeneration({
            module: targetModule,
            subFeature: targetSubFeature,
            prompt: generationPrompt,
            params: generationParams,
            materials: generationMaterials,
            signal: controller.signal,
            onJobCreated,
            publicBaseUrl,
          })
        : null;

      let completedProject: Project;
	      if (targetModule === AppModuleObj.VIDEO) {
	        const mediaUrl = result?.videoUrl;
	        if (!result || result.status !== 'success' || !mediaUrl) {
	          if (result?.status === 'generating' && result?.taskId) {
	            pendingSyncProject = {
	              ...newProject,
	              backendJobId: activeBackendJobId || newProject.backendJobId,
	              status: 'generating',
	              results: [{
	                id: result.taskId || `${taskId}-pending-video`,
	                imageUrl: '',
	                videoUrl: undefined,
	                mediaType: 'video',
	                prompt: result.prompt || result.message || generationPrompt,
	                model: generationParams['modelVersion'] || generationParams['model'] || 'bytedance/seedance-2-fast',
	                aspectRatio: generationParams['ratio'] || generationParams['aspectRatio'] || 'auto',
	                status: 'generating',
	                createdAt: newProject.createdAt,
	                module: targetModule,
	                subFeature: targetSubFeature,
	                taskId: result.taskId,
	                backendJobId: activeBackendJobId || undefined,
	                error: result.message || '任务已提交云端，结果待同步',
	              }],
	              completedCount: 0,
	              taskCount: 1,
	              error: result.message || '任务已提交云端，结果待同步',
	            };
	            setProjects((prev) => prev.map((p) => p.id === projectId ? pendingSyncProject! : p));
	            setTasks((prev) => prev.map((t) => (
	              t.id === taskId
	                ? { ...t, status: 'generating', progress: Math.max(t.progress || 0, 8), completed: 0, total: 1 }
	                : t
	            )));
	            completedProject = pendingSyncProject;
	          } else {
	            throw new Error(result?.message || '任务执行失败');
	          }
	        } else {

	          const newResult: GeneratedResult = {
	            id: result.taskId || Date.now().toString(),
	            imageUrl: mediaUrl,
	            videoUrl: mediaUrl,
	            mediaType: 'video',
	            prompt: result.prompt || generationPrompt,
	            model: generationParams['model'] || 'gpt-image-2',
	            aspectRatio: generationParams['ratio'] || 'auto',
	            status: 'completed',
	            createdAt: newProject.createdAt,
	            module: targetModule,
	            subFeature: targetSubFeature,
	            taskId: result.taskId,
	            creditsConsumed: result.creditsConsumed,
	          };

	          completedProject = {
	            ...newProject,
	            backendJobId: activeBackendJobId || newProject.backendJobId,
	            status: 'completed',
	            completedAt: newResult.createdAt,
	            results: [newResult],
	            completedCount: 1,
	            creditsConsumed: result.creditsConsumed,
	          };
	        }
	      } else if (targetModule === AppModuleObj.BUYER_SHOW || targetModule === AppModuleObj.RETOUCH || targetModule === AppModuleObj.EVERYTHING_REPLACE) {
        const onSpecialItemCompleted = (item: any, completed: number, total: number) => {
          const itemStatus: GeneratedResult['status'] = item.status || (item.imageUrl ? 'completed' : 'generating');
          const nextResult: GeneratedResult = {
            id: item.taskId || `${taskId}-${completed - 1}`,
            imageUrl: item.imageUrl || '',
            mediaType: 'image' as const,
            prompt: item.prompt || generationPrompt,
            model: item.model || generationParams['model'] || 'gpt-image-2',
            aspectRatio: item.aspectRatio || generationParams['ratio'] || 'auto',
            status: itemStatus,
            createdAt: newProject.createdAt,
            module: targetModule,
            subFeature: targetSubFeature,
            creditsConsumed: item.creditsConsumed,
            taskId: item.taskId,
            backendJobId: item.backendJobId,
            batchIndex: Number(item.batchIndex || completed) || completed,
            sourceUrl: item.sourceUrl,
            fileName: item.fileName,
            error: item.error || item.message,
          };
          const resultIdentity = nextResult.backendJobId || nextResult.taskId || nextResult.id;
          const nextByIdentity = new Map(batchResults.map((result) => [result.backendJobId || result.taskId || result.id, result]));
          nextByIdentity.set(resultIdentity, nextResult);
          batchResults = sortGeneratedResultsByBatchIndex(Array.from(nextByIdentity.values()));
          const completedItemCount = batchResults.filter((result) => result.status === 'completed').length;
          const processedItemCount = batchResults.filter((result) => result.status === 'completed' || result.status === 'generating' || result.status === 'error').length;
          setTasks((prev) => prev.map((t) =>
            t.id === taskId
              ? {
                  ...t,
                  status: batchResults.some((result) => result.status === 'generating') ? 'generating' : t.status,
                  progress: Math.round((processedItemCount / total) * 100),
                  completed: completedItemCount,
                  total,
                }
              : t
          ));
          setProjects((prev) => prev.map((p) =>
            p.id === projectId
              ? {
                  ...p,
                  status: batchResults.some((result) => result.status === 'generating') ? 'generating' : p.status,
                  results: [...batchResults],
                  completedCount: completedItemCount,
                  taskCount: total,
                }
              : p
          ));
        };
        const specialResult = targetModule === AppModuleObj.BUYER_SHOW
          ? await runShellBuyerShowWorkflow({
              module: targetModule,
              subFeature: targetSubFeature,
              prompt: generationPrompt,
              params: generationParams,
              materials: generationMaterials,
              signal: controller.signal,
              taskMetadata: {
                shellProjectId: projectId,
                shellProjectName: projectName,
                batchCount,
                subFeature: targetSubFeature,
              },
              onJobCreated,
              publicBaseUrl,
            }, onSpecialItemCompleted)
          : await runShellRetouchWorkflow({
              module: targetModule,
              subFeature: targetSubFeature,
              prompt: generationPrompt || (targetModule === AppModuleObj.EVERYTHING_REPLACE ? '产品替换' : '产品精修'),
              params: generationParams,
              materials: generationMaterials,
              signal: controller.signal,
              taskMetadata: {
                shellProjectId: projectId,
                shellProjectName: projectName,
                batchCount,
                subFeature: targetSubFeature,
              },
              onJobCreated,
              publicBaseUrl,
            }, onSpecialItemCompleted);

        const specialWorkflowResults: GeneratedResult[] = sortGeneratedResultsByBatchIndex(batchResults.length > 0 ? batchResults : specialResult.results.map((item, index) => ({
          id: item.taskId || `${taskId}-${index}`,
          imageUrl: item.imageUrl || '',
          mediaType: 'image' as const,
          prompt: item.prompt || generationPrompt,
          model: item.model || generationParams['model'] || 'gpt-image-2',
          aspectRatio: item.aspectRatio || generationParams['ratio'] || 'auto',
          status: (item.status || (item.imageUrl ? 'completed' : 'generating')) as GeneratedResult['status'],
          createdAt: newProject.createdAt,
          module: targetModule,
          subFeature: targetSubFeature,
          creditsConsumed: item.creditsConsumed,
          taskId: item.taskId,
          backendJobId: item.backendJobId,
          batchIndex: Number(item.batchIndex || index + 1) || index + 1,
          sourceUrl: item.sourceUrl,
          fileName: item.fileName,
          error: item.error || item.message,
        })));
        const hasSpecialGenerating = specialWorkflowResults.some((item) => item.status === 'generating');
        const hasSpecialError = specialWorkflowResults.some((item) => item.status === 'error');
        completedProject = {
          ...newProject,
          status: hasSpecialGenerating ? 'generating' : hasSpecialError ? 'error' : 'completed',
          completedAt: hasSpecialGenerating ? undefined : newProject.createdAt,
          results: specialWorkflowResults,
          taskCount: Math.max(specialWorkflowResults.length, specialResult.results.length),
          completedCount: specialWorkflowResults.filter((item) => item.status === 'completed').length,
          creditsConsumed: specialResult.creditsConsumed,
        };
        if (hasSpecialGenerating) {
          pendingSyncProject = completedProject;
        }
      } else {
        batchResults = [];
        for (let index = 0; index < batchCount; index += 1) {
          activeProviderTaskId = '';
          const batchPrompt = buildBatchPrompt(
            targetModule,
            targetSubFeature,
            generationPrompt,
            generationParams,
            index,
            batchCount,
          );
          const itemResult = await runShellImageGeneration({
            module: targetModule,
            subFeature: targetSubFeature,
            prompt: batchPrompt,
            params: {
              ...generationParams,
              __batchIndex: String(index + 1),
              __batchCount: String(batchCount),
            },
            materials: generationMaterials,
            signal: controller.signal,
            onJobCreated,
            publicBaseUrl,
            taskMetadata: {
              batchIndex: index + 1,
              batchCount,
            },
          });
          if (itemResult.status !== 'success' || !itemResult.imageUrl) {
            const recoverableItemResult = {
              ...itemResult,
              taskId: itemResult.taskId || activeProviderTaskId,
            };
            if (isRecoverableShellWorkflowResult(recoverableItemResult)) {
              const pendingResult: GeneratedResult = {
                id: recoverableItemResult.taskId || `${taskId}-pending-${index}`,
                imageUrl: '',
                mediaType: 'image',
                prompt: recoverableItemResult.message || batchPrompt,
                model: generationParams['model'] || 'gpt-image-2',
                aspectRatio: generationParams['ratio'] || 'auto',
                status: 'generating',
                createdAt: newProject.createdAt,
                module: targetModule,
                subFeature: targetSubFeature,
                taskId: recoverableItemResult.taskId,
                error: recoverableItemResult.message || '结果待同步',
              };
              batchResults = [...batchResults, pendingResult];
              pendingSyncProject = {
                ...newProject,
                status: 'generating',
                results: [...batchResults],
                completedCount: batchResults.filter((item) => item.status === 'completed').length,
                taskCount: batchCount,
                error: recoverableItemResult.message || '结果待同步',
              };
              setProjects((prev) => prev.map((p) => p.id === projectId ? pendingSyncProject! : p));
              setTasks((prev) => prev.map((t) => (
                t.id === taskId
                  ? { ...t, status: 'generating', progress: Math.max(t.progress || 0, 8), completed: batchResults.filter((item) => item.status === 'completed').length, total: batchCount }
                  : t
              )));
              break;
            }
            const failedResult: GeneratedResult = {
              id: itemResult.taskId || `${taskId}-error-${index}`,
              imageUrl: '',
              mediaType: 'image',
              prompt: itemResult.message || batchPrompt,
              model: generationParams['model'] || 'gpt-image-2',
              aspectRatio: generationParams['ratio'] || 'auto',
              status: 'error',
              createdAt: newProject.createdAt,
              module: targetModule,
              subFeature: targetSubFeature,
              taskId: itemResult.taskId,
              error: itemResult.message || `第 ${index + 1} 张生成失败`,
            };
            batchResults = [...batchResults, failedResult];
            setProjects((prev) => prev.map((p) =>
              p.id === projectId
                ? {
                    ...p,
                    results: [...batchResults],
                    completedCount: batchResults.filter((item) => item.status === 'completed').length,
                    taskCount: batchCount,
                  }
                : p
            ));
            throw new Error(itemResult.message || `第 ${index + 1} 张生成失败`);
          }

          batchResults.push({
            id: itemResult.taskId || `${taskId}-${index}`,
            imageUrl: itemResult.imageUrl,
            mediaType: 'image',
            prompt: itemResult.prompt || batchPrompt,
            model: generationParams['model'] || 'gpt-image-2',
            aspectRatio: generationParams['ratio'] || 'auto',
            status: 'completed',
            createdAt: newProject.createdAt,
            module: targetModule,
            subFeature: targetSubFeature,
            creditsConsumed: itemResult.creditsConsumed,
            taskId: itemResult.taskId,
          });

          setTasks((prev) => prev.map((t) =>
            t.id === taskId
              ? {
                  ...t,
                  progress: Math.round(((index + 1) / batchCount) * 100),
                  completed: index + 1,
                  total: batchCount,
                }
              : t
          ));
          setProjects((prev) => prev.map((p) =>
            p.id === projectId
              ? {
                  ...p,
                  results: [...batchResults],
                  completedCount: batchResults.length,
                  taskCount: batchCount,
                }
              : p
          ));
        }

        completedProject = pendingSyncProject || {
          ...newProject,
          status: 'completed',
          completedAt: newProject.createdAt,
          results: batchResults,
          taskCount: batchCount,
          completedCount: batchResults.length,
          creditsConsumed: batchResults.reduce((sum, item) => sum + (Number(item.creditsConsumed) || 0), 0) || undefined,
        };
      }

      setProjects((prev) => prev.map((p) =>
        p.id === projectId
          ? completedProject
          : p
      ));
      const synced = await persistProjectToSharedState(completedProject);
      if (pendingSyncProject) {
        setTasks((prev) => prev.map((t) => (
          t.id === taskId
            ? { ...t, status: 'generating', progress: Math.max(t.progress || 0, 8), total: batchCount, completed: completedProject.completedCount }
            : t
        )));
      } else {
        setTasks((prev) => prev.filter((t) => t.id !== taskId));
      }
      setScopedPromptText('');
      if (!pendingSyncProject && apiConfig.workspacePreferences?.playSoundAfterGeneration) {
        void playCompletionSound().catch(() => null);
      }
      const successCount = completedProject.results.length;
      const successMessage = successCount > 1 ? `已生成 ${successCount} 项结果 · ${MODULE_NAMES[targetModule]}` : `已生成 · ${MODULE_NAMES[targetModule]}`;
      addToast(
        pendingSyncProject ? '任务已提交云端，结果待同步，可稍后点击同步。' : synced ? successMessage : `${successMessage}，但远端历史同步失败`,
        pendingSyncProject ? 'info' : synced ? 'success' : 'warning',
      );
      window.setTimeout(() => void hydrateShellJobs(), 800);
    } catch (error) {
      if (bailIfFrontendResourceError(error)) return;
      const message = error instanceof Error ? error.message : '任务执行失败';
      logShellError('shell_generation_failed', error, {
        projectId,
        taskId,
        module: targetModule,
        subFeature: targetSubFeature,
        batchCount,
        completedCount: batchResults.length,
      }, `${MODULE_NAMES[targetModule] || targetModule}任务失败`);
      const failedProject: Project = {
        ...newProject,
        status: 'error',
        results: batchResults.length > 0 ? batchResults : [{
          id: `${taskId}-error`,
          imageUrl: '',
          prompt: message,
          model: generationParams['model'] || 'gpt-image-2',
          aspectRatio: generationParams['ratio'] || 'auto',
          status: 'error',
          createdAt: newProject.createdAt,
          module: targetModule,
          subFeature: targetSubFeature,
        }],
        completedCount: batchResults.length,
        taskCount: batchCount,
      };
      setProjects((prev) => prev.map((p) =>
        p.id === projectId
          ? failedProject
          : p
      ));
      void persistProjectToSharedState(failedProject);
      setTasks((prev) => prev.map((t) => t.id === taskId ? { ...t, status: 'error', progress: 100 } : t));
      addToast(message, 'error');
	    } finally {
	      delete taskControllersRef.current[taskId];
	      releaseGuardedSubmit();
	      setIsGenerating(false);
	    }
	  }, [promptText, activeModule, activeSubFeature, currentParams, filteredMaterials, projects, tasks, addToast, hydrateShellData, setScopedPromptText, apiConfig, videoMemory, setVideoMemory, persistProjectToSharedState, publicBaseUrl, ensureMaterialRemoteUrls, currentUser, logShellError, beginGenerationSubmitLock, endGenerationSubmitLock, reserveShortProjectName]);

  const createRemoteMaterial = useCallback((id: string, type: string, url: string, fileName: string, subFeature?: string): Material => ({
    id,
    type,
    url,
    remoteUrl: url,
    fileName,
    subFeature,
  }), []);

  const buildVariantMaterials = useCallback((
    baseMaterialsOrPlan: Record<string, Material[]> | PlanItem,
    planOrSubFeature: PlanItem | string,
    maybeSubFeature?: string,
  ) => {
    const hasBaseMaterials = typeof planOrSubFeature !== 'string';
    const baseMaterials = hasBaseMaterials ? baseMaterialsOrPlan as Record<string, Material[]> : {};
    const plan = hasBaseMaterials ? planOrSubFeature as PlanItem : baseMaterialsOrPlan as PlanItem;
    const subFeature = hasBaseMaterials ? String(maybeSubFeature || '') : String(planOrSubFeature || '');
    return buildOneClickPlanGenerationMaterials({
      baseMaterials,
      plan,
      subFeature,
      publicBaseUrl,
      createRemoteMaterial,
    } as any) as Record<string, Material[]>;
  }, [createRemoteMaterial, publicBaseUrl]);

  const runOneClickPlanGeneration = useCallback(async (
    project: Project,
    selectedPlans: PlanItem[],
    materialsOverride?: Record<string, Material[]>,
  ) => {
    if (selectedPlans.length === 0) {
      addToast('请先选择要生成的策划方案', 'warning');
      return;
    }
    const failedSelectedPlans = selectedPlans.filter(isFailedPlanningPlan);
    if (failedSelectedPlans.length > 0) {
      const runnableSelectedPlans = selectedPlans.filter((plan) => !isFailedPlanningPlan(plan));
      if (runnableSelectedPlans.length === 0) {
        addToast('选中的方案均为策划失败项，请先重新策划失败项后再出图。', 'error');
        return;
      }
      addToast(`已跳过 ${failedSelectedPlans.length} 个策划失败项，请先重新策划后再出图。`, 'warning');
      selectedPlans = runnableSelectedPlans;
    }
    if (selectedPlans.some((plan) => isInvalidPlanContentForGeneration(plan))) {
      addToast('当前策划结果无效，请重新策划后再生图。', 'error');
      return;
    }
    if (apiConfig.workspacePreferences?.playSoundAfterGeneration) {
      void primeCompletionSound();
    }
    const projectId = project.id;
    const sceneSubFeature = project.subFeature || activeSubFeature;
    const sceneConfig = ONE_CLICK_CONFIRM_SCENES[sceneSubFeature] || ONE_CLICK_CONFIRM_SCENES.first_image;
    const storedContext = project.generationContext;
    const generationParams = {
      ...(storedContext?.params || currentParams),
    };
    const effectiveRatio = String(generationParams.ratio || generationParams.aspectRatio || sceneConfig.ratio || '1:1');
    const batchCount = selectedPlans.length;
    const selectedPlanIds = selectedPlans.map((plan) => plan.id).filter(Boolean);
    const orderedProjectPlans = Array.isArray(project.plans) && project.plans.length > 0 ? project.plans : selectedPlans;
    const firstBenchmarkPlanId = orderedProjectPlans[0]?.id || '';
    const requiresFirstBenchmark = sceneSubFeature === 'sku' && Boolean(firstBenchmarkPlanId);
    const totalTaskCount = Math.max(Number(project.taskCount || 0), orderedProjectPlans.length, batchCount);
    const getLatestProject = () => projectsRef.current.find((item) => item.id === projectId) || project;
    const mergeProjectResults = (baseResults: GeneratedResult[], nextResults: GeneratedResult[]) => (
      mergeGeneratedPlanResults(baseResults || [], nextResults, selectedPlanIds) as GeneratedResult[]
    );
    const mergeLatestProjectResults = (nextResults: GeneratedResult[]) => (
      mergeProjectResults(getLatestProject().results || project.results || [], nextResults)
    );
    const generationMaterials = materialsOverride
      || (hasMaterialInputs(storedContext?.materials as Record<string, Material[]>) ? storedContext?.materials as Record<string, Material[]> : undefined)
      || filteredMaterials;
    let firstBenchmarkResultUrl = requiresFirstBenchmark
      ? resolvePublicAssetUrl(
        (project.results || []).find((result) => result.planId === firstBenchmarkPlanId && result.status === 'completed' && Boolean(result.imageUrl))?.imageUrl || '',
        publicBaseUrl,
      ) || ''
      : '';

    setProjects((prev) => {
      const next: Project[] = prev.map((p): Project => {
        if (p.id !== projectId) return p;
        const mergedStartingResults = mergeProjectResults(p.results || [], []);
        return {
          ...p,
          status: 'generating' as const,
          selectedPlanId: selectedPlans[0]?.id,
          subFeature: sceneSubFeature,
          taskCount: totalTaskCount,
          completedCount: countCompletedProjectResults(mergedStartingResults),
          results: mergedStartingResults,
        };
      });
      projectsRef.current = next;
      return next;
    });

    const taskId = 'task-img-' + Date.now();
    setTasks((prev) => [{
      id: taskId,
      projectId,
      module: AppModuleObj.ONE_CLICK,
      type: 'image',
      status: 'pending',
      title: `出图: ${project.name} · ${sceneConfig.label}`,
      progress: 0,
      createdAt: project.createdAt,
      total: batchCount,
      completed: 0,
      subFeature: sceneSubFeature,
    }, ...prev]);

    const resultsByIndex: Array<GeneratedResult | undefined> = new Array(batchCount);
    const controller = new AbortController();
    taskControllersRef.current[taskId] = controller;
    const generationTaskIdByPlanId = new Map<string, string>();
    const generationBackendJobIdByPlanId = new Map<string, string>();
    let pendingSyncProject: Project | null = null;
    let firstGenerationError: Error | null = null;
    const getPublishedResults = () => resultsByIndex.filter((item): item is GeneratedResult => Boolean(item));
    const buildMissingPlanResult = (plan: PlanItem, index: number, message: string): GeneratedResult => {
      const visibleTaskId = String(generationTaskIdByPlanId.get(plan.id) || '').trim() || undefined;
      const backendJobId = String(generationBackendJobIdByPlanId.get(plan.id) || '').trim() || undefined;
      const hasProviderTaskId = Boolean(visibleTaskId);
      const promptSummary = buildPlanPromptSummary(plan, sceneSubFeature);
      return {
        id: visibleTaskId || `${taskId}-error-${index}`,
        planId: plan.id,
        imageUrl: '',
        prompt: hasProviderTaskId ? promptSummary : message,
        model: generationParams['model'] || 'gpt-image-2',
        aspectRatio: effectiveRatio,
        status: hasProviderTaskId ? 'generating' : 'error',
        createdAt: project.createdAt,
        module: AppModuleObj.ONE_CLICK,
        subFeature: sceneSubFeature,
        taskId: visibleTaskId,
        backendJobId,
        error: hasProviderTaskId ? '任务已提交云端，结果待同步' : message,
      };
    };
    const collectPlanResultsForFailure = (message: string) => {
      const publishedResults = getPublishedResults();
      const publishedByPlanId = new Map(publishedResults.map((result) => [result.planId || '', result]));
      return selectedPlans.map((plan, index) => publishedByPlanId.get(plan.id) || buildMissingPlanResult(plan, index, message));
    };
    const publishPlanResults = (status: Project['status'] = 'generating', error?: string) => {
      let mergedResults = mergeLatestProjectResults(getPublishedResults());
      setProjects((prev) => {
        const next = prev.map((p) => {
          if (p.id !== projectId) return p;
          mergedResults = mergeProjectResults(p.results || [], getPublishedResults());
          return {
            ...p,
            status,
            results: mergedResults,
            taskCount: totalTaskCount,
            completedCount: countCompletedProjectResults(mergedResults),
            ...(error ? { error } : {}),
          };
        });
        projectsRef.current = next;
        return next;
      });
      return mergedResults;
    };
    const upsertGeneratingPlanResult = (plan: PlanItem, index: number, providerTaskId: string, prompt: string) => {
      const visibleTaskId = String(providerTaskId || '').trim();
      if (!visibleTaskId) return;
      generationTaskIdByPlanId.set(plan.id, visibleTaskId);
      const backendJobId = generationBackendJobIdByPlanId.get(plan.id);
      const generatingResult: GeneratedResult = {
        id: visibleTaskId,
        planId: plan.id,
        imageUrl: '',
        prompt,
        model: generationParams['model'] || 'gpt-image-2',
        aspectRatio: effectiveRatio,
        status: 'generating',
        createdAt: project.createdAt,
        module: AppModuleObj.ONE_CLICK,
        subFeature: sceneSubFeature,
        taskId: visibleTaskId,
        backendJobId,
      };
      resultsByIndex[index] = generatingResult;
      publishPlanResults('generating');
    };
    const createPlanJobCreatedHandler = (plan: PlanItem, index: number, prompt: string) => (jobId: string, providerTaskId?: string) => {
      const visibleProviderTaskId = String(providerTaskId || '').trim();
      if (jobId) {
        generationBackendJobIdByPlanId.set(plan.id, jobId);
      }
      setProjects((prev) => {
        const next = prev.map((item) => (
          item.id === projectId
            ? { ...item, backendJobId: jobId }
            : item
        ));
        projectsRef.current = next;
        return next;
      });
      setTasks((prev) => prev.map((task) => (
        task.id === taskId
          ? { ...task, backendJobId: jobId, status: 'generating', progress: Math.max(task.progress || 0, 8) }
          : task
      )));
      if (visibleProviderTaskId) {
        upsertGeneratingPlanResult(plan, index, visibleProviderTaskId, prompt);
      }
    };

    try {
      const { runShellImageGeneration } = await loadShellWorkflowModule();
      const preparedGenerationMaterials = await ensureMaterialRemoteUrls(generationMaterials, AppModuleObj.ONE_CLICK);
      const updateTaskProgress = () => {
        const publishedResults = getPublishedResults();
        const completed = publishedResults.filter((item) => item.status === 'completed').length;
        const finished = publishedResults.filter((item) => item.status === 'completed' || item.status === 'error').length;
        setTasks((prev) => prev.map((t) =>
          t.id === taskId
            ? {
                ...t,
                status: publishedResults.some((item) => item.status === 'generating') || finished < batchCount ? 'generating' : t.status,
                progress: Math.max(t.progress || 0, Math.round((finished / batchCount) * 100)),
                completed,
                total: batchCount,
              }
            : t
        ));
      };
      const runPlanAtIndex = async (index: number) => {
        const basePlan = selectedPlans[index];
        const plan = requiresFirstBenchmark && basePlan.id !== firstBenchmarkPlanId && firstBenchmarkResultUrl && !basePlan.sourceResultUrl
          ? { ...basePlan, sourceResultUrl: firstBenchmarkResultUrl }
          : basePlan;
        const promptSummary = buildPlanPromptSummary(plan, sceneSubFeature);
        const batchPrompt = buildBatchPrompt(
          AppModuleObj.ONE_CLICK,
          sceneSubFeature,
          promptSummary,
          generationParams,
          index,
          batchCount,
        );
        const planMaterials = buildVariantMaterials(preparedGenerationMaterials, plan, sceneSubFeature);
        const result = await runShellImageGeneration({
          module: AppModuleObj.ONE_CLICK,
          subFeature: sceneSubFeature,
          prompt: batchPrompt,
          params: {
            ...generationParams,
            ratio: effectiveRatio,
            __workspacePreferences: JSON.stringify(apiConfig.workspacePreferences || getWorkspacePreferences()),
            __batchIndex: String(index + 1),
            __batchCount: String(batchCount),
          },
          materials: planMaterials,
          signal: controller.signal,
          onJobCreated: createPlanJobCreatedHandler(plan, index, batchPrompt),
          publicBaseUrl,
          taskMetadata: {
            shellPurpose: 'one_click_image_generation',
            shellProjectId: projectId,
            shellProjectName: project.name,
            shellPlanId: plan.id,
            subFeature: sceneSubFeature,
            batchIndex: index + 1,
            batchCount,
            schemeContent: plan.schemeContent || [
              plan.title,
              plan.sceneDescription,
              plan.styleDirection,
              plan.colorPalette,
              plan.composition,
              plan.textLayout,
            ].filter(Boolean).join('\n'),
            sourceReferenceUrl: plan.sourceReferenceUrl ? resolvePublicAssetUrl(plan.sourceReferenceUrl, publicBaseUrl) : undefined,
            sourceResultUrl: plan.sourceResultUrl ? resolvePublicAssetUrl(plan.sourceResultUrl, publicBaseUrl) : undefined,
            variationInstruction: plan.variationInstruction,
            variationMode: plan.variationMode,
            editInstruction: plan.editInstruction,
          },
        });
        if (result.status !== 'success' || !result.imageUrl) {
          const visibleTaskId = result.taskId || generationTaskIdByPlanId.get(plan.id);
          const recoverablePlanResult = {
            ...result,
            taskId: result.taskId || generationTaskIdByPlanId.get(plan.id),
          };
          if (isRecoverableShellWorkflowResult(recoverablePlanResult)) {
            const pendingResult: GeneratedResult = {
              id: visibleTaskId || `${taskId}-pending-${index}`,
              planId: plan.id,
              imageUrl: '',
              prompt: recoverablePlanResult.message || promptSummary || batchPrompt,
              model: generationParams['model'] || 'gpt-image-2',
              aspectRatio: effectiveRatio,
              status: 'generating',
              createdAt: project.createdAt,
              module: AppModuleObj.ONE_CLICK,
              subFeature: sceneSubFeature,
              taskId: visibleTaskId,
              backendJobId: generationBackendJobIdByPlanId.get(plan.id),
              error: recoverablePlanResult.message || '结果待同步',
            };
            resultsByIndex[index] = pendingResult;
            const mergedPendingResults = publishPlanResults('generating', recoverablePlanResult.message || '结果待同步');
            pendingSyncProject = {
              ...project,
              status: 'generating',
              taskCount: totalTaskCount,
              completedCount: countCompletedProjectResults(mergedPendingResults),
              results: mergedPendingResults,
              subFeature: sceneSubFeature,
              creditsConsumed: project.creditsConsumed,
              planningTaskId: latestIdentityText(project.planningTaskId),
              error: recoverablePlanResult.message || '结果待同步',
            };
            updateTaskProgress();
            return;
          }
          const failedResult: GeneratedResult = {
            id: visibleTaskId || `${taskId}-error-${index}`,
            planId: plan.id,
            imageUrl: '',
            prompt: result.message || promptSummary || batchPrompt,
            model: generationParams['model'] || 'gpt-image-2',
            aspectRatio: effectiveRatio,
            status: 'error',
            createdAt: project.createdAt,
            module: AppModuleObj.ONE_CLICK,
            subFeature: sceneSubFeature,
            taskId: visibleTaskId,
            backendJobId: generationBackendJobIdByPlanId.get(plan.id),
            error: result.message || `${sceneConfig.label} 生成失败`,
          };
          resultsByIndex[index] = failedResult;
          publishPlanResults('generating');
          updateTaskProgress();
          throw new Error(result.message || `${sceneConfig.label} 生成失败`);
        }
        const visibleTaskId = result.taskId || generationTaskIdByPlanId.get(plan.id);
        resultsByIndex[index] = {
          id: visibleTaskId || `${Date.now()}-${index}`,
          planId: plan.id,
          imageUrl: result.imageUrl,
          prompt: result.prompt || promptSummary || batchPrompt,
          model: generationParams['model'] || 'gpt-image-2',
          aspectRatio: effectiveRatio,
          status: 'completed',
          createdAt: project.createdAt,
          module: AppModuleObj.ONE_CLICK,
          subFeature: sceneSubFeature,
          creditsConsumed: result.creditsConsumed,
          taskId: visibleTaskId,
          backendJobId: generationBackendJobIdByPlanId.get(plan.id),
        };
        if (requiresFirstBenchmark && plan.id === firstBenchmarkPlanId) {
          firstBenchmarkResultUrl = resolvePublicAssetUrl(result.imageUrl, publicBaseUrl) || result.imageUrl;
        }
        publishPlanResults('generating');
        updateTaskProgress();
      };
      const runConcurrentPlanIndexes = async (indexes: number[]) => {
        if (indexes.length === 0) return;
        let nextQueuedIndex = 0;
        const workerCount = Math.max(1, Math.min(Number(apiConfig.concurrency || 1) || 1, indexes.length));
        const runWorker = async () => {
          while (nextQueuedIndex < indexes.length && !controller.signal.aborted && !firstGenerationError) {
            const currentIndex = indexes[nextQueuedIndex];
            nextQueuedIndex += 1;
            try {
              await runPlanAtIndex(currentIndex);
            } catch (error) {
              if (bailIfFrontendResourceError(error)) return;
              if (!firstGenerationError) {
                firstGenerationError = error instanceof Error ? error : new Error(String(error || `${sceneConfig.label} 生成失败`));
              }
            }
          }
        };
        await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
      };
      const firstBenchmarkSelectedIndex = requiresFirstBenchmark && !firstBenchmarkResultUrl
        ? selectedPlans.findIndex((plan) => plan.id === firstBenchmarkPlanId)
        : -1;
      let shouldWaitForFirstBenchmark = false;
      if (firstBenchmarkSelectedIndex >= 0) {
        await runPlanAtIndex(firstBenchmarkSelectedIndex);
        if (!firstBenchmarkResultUrl) {
          shouldWaitForFirstBenchmark = true;
          addToast('第一张 SKU 基准图已提交，后续任务会在首张结果可用后再生成。', 'info');
        }
      }
      const remainingPlanIndexes = selectedPlans
        .map((_, index) => index)
        .filter((index) => index !== firstBenchmarkSelectedIndex);
      if (!shouldWaitForFirstBenchmark) {
        await runConcurrentPlanIndexes(remainingPlanIndexes);
      }
      if (firstGenerationError) throw firstGenerationError;

      const publishedResults = getPublishedResults();
      const latestProject = getLatestProject();
      const mergedCompletedResults = mergeProjectResults(latestProject.results || project.results || [], publishedResults);
      const completedProject: Project = pendingSyncProject || {
        ...latestProject,
        status: 'completed',
        completedAt: project.createdAt,
        results: mergedCompletedResults,
        taskCount: totalTaskCount,
        completedCount: countCompletedProjectResults(mergedCompletedResults),
        subFeature: sceneSubFeature,
        creditsConsumed: project.creditsConsumed,
        planningTaskId: latestIdentityText(project.planningTaskId),
      };
      if (pendingSyncProject) {
        pendingSyncProject = {
          ...pendingSyncProject,
          results: mergedCompletedResults,
          completedCount: countCompletedProjectResults(mergedCompletedResults),
        };
      }
      let projectToPersist = pendingSyncProject || completedProject;
      setProjects((prev) => {
        const next = prev.map((p) => {
          if (p.id !== projectId) return p;
          const currentMergedResults = mergeProjectResults(p.results || [], publishedResults);
          const hasActiveSibling = currentMergedResults.some((result) => (
            result.status === 'generating' && Boolean(String(result.taskId || '').trim())
          ));
          projectToPersist = {
            ...p,
            ...(pendingSyncProject || completedProject),
            status: pendingSyncProject || hasActiveSibling ? 'generating' : 'completed',
            completedAt: pendingSyncProject || hasActiveSibling ? undefined : project.createdAt,
            results: currentMergedResults,
            taskCount: totalTaskCount,
            completedCount: countCompletedProjectResults(currentMergedResults),
          };
          return projectToPersist;
        });
        projectsRef.current = next;
        return next;
      });
      const synced = await persistProjectToSharedState(projectToPersist);
      if (pendingSyncProject) {
        setTasks((prev) => prev.map((t) => (
          t.id === taskId
            ? { ...t, status: 'generating', progress: Math.max(t.progress || 0, 8), completed: publishedResults.filter((item) => item.status === 'completed').length, total: batchCount }
            : t
        )));
      } else {
        setTasks((prev) => prev.filter((t) => t.id !== taskId));
      }
      if (!pendingSyncProject && apiConfig.workspacePreferences?.playSoundAfterGeneration) {
        void playCompletionSound().catch(() => null);
      }
      const successCount = publishedResults.filter((item) => item.status === 'completed').length;
      const successMessage = successCount > 1
        ? `已生成 ${successCount} 张图片 · ${project.name}`
        : `已生成 1 张图片 · ${project.name}`;
      addToast(
        pendingSyncProject ? '任务已提交云端，结果待同步，可稍后点击同步。' : synced ? successMessage : `${successMessage}，但远端历史同步失败`,
        pendingSyncProject ? 'info' : synced ? 'success' : 'warning',
      );
      window.setTimeout(() => void hydrateShellJobs(), 800);
    } catch (error) {
      const message = error instanceof Error ? error.message : '批量出图失败';
      const publishedResults = getPublishedResults();
      const failedPlanResults = collectPlanResultsForFailure(message);
      const mergedFailedResults = mergeLatestProjectResults(failedPlanResults);
      const hasPendingSubmittedResult = mergedFailedResults.some((result) => (
        result.status === 'generating' && Boolean(String(result.taskId || '').trim())
      ));
      logShellError('one_click_image_generation_failed', error, {
        projectId,
        taskId,
        subFeature: sceneSubFeature,
        batchCount,
        completedCount: publishedResults.filter((item) => item.status === 'completed').length,
      }, '一键主详出图失败');
      const failedProjectBase = getLatestProject();
      let failedProject: Project = {
        ...failedProjectBase,
        status: 'error',
        taskCount: totalTaskCount,
        completedCount: countCompletedProjectResults(mergedFailedResults),
        results: mergedFailedResults,
        subFeature: sceneSubFeature,
        creditsConsumed: project.creditsConsumed,
        planningTaskId: latestIdentityText(project.planningTaskId),
      };
      setProjects((prev) => {
        const next = prev.map((p) => {
          if (p.id !== projectId) return p;
          const currentMergedResults = mergeProjectResults(p.results || [], failedPlanResults);
          const hasSubmittedGeneratingResult = currentMergedResults.some((result) => (
            result.status === 'generating' && Boolean(String(result.taskId || '').trim())
          ));
          failedProject = {
            ...p,
            ...failedProject,
            status: hasSubmittedGeneratingResult ? 'generating' : 'error',
            results: currentMergedResults,
            completedCount: countCompletedProjectResults(currentMergedResults),
          };
          return failedProject;
        });
        projectsRef.current = next;
        return next;
      });
      void persistProjectToSharedState(failedProject);
      setTasks((prev) => prev.map((t) => t.id === taskId
        ? {
            ...t,
            status: hasPendingSubmittedResult ? 'generating' : 'error',
            progress: hasPendingSubmittedResult ? Math.max(t.progress || 0, Math.round((publishedResults.length / batchCount) * 100)) : 100,
            completed: publishedResults.filter((item) => item.status === 'completed').length,
            total: batchCount,
          }
        : t
      ));
      addToast(hasPendingSubmittedResult ? '部分任务已提交云端，结果待同步，可稍后点击同步。' : message, hasPendingSubmittedResult ? 'info' : 'error');
      if (hasPendingSubmittedResult) {
        window.setTimeout(() => void hydrateShellJobs(), 800);
      }
    } finally {
      delete taskControllersRef.current[taskId];
    }
  }, [currentParams, filteredMaterials, activeSubFeature, addToast, hydrateShellJobs, apiConfig.workspacePreferences, apiConfig.concurrency, persistProjectToSharedState, publicBaseUrl, logShellError, ensureMaterialRemoteUrls, buildVariantMaterials]);

  // ── OneClick: confirm plan → generate images ──
  const handleConfirmPlan = useCallback(async (projectId: string, planOrPlans: PlanItem | PlanItem[]) => {
    const selectedPlans = Array.isArray(planOrPlans) ? planOrPlans : [planOrPlans];
    const planActionKey = selectedPlans.map((plan) => plan.id).filter(Boolean).join('|') || 'unknown';
    const actionKey = `confirm-plan:${projectId}:${planActionKey}`;
    if (!beginExclusiveAction(actionKey, '生图任务已提交，请等待当前任务完成')) return;
    try {
      const project = projects.find((p) => p.id === projectId);
      if (!project) return;
      await runOneClickPlanGeneration(project, selectedPlans);
    } finally {
      endExclusiveAction(actionKey);
    }
  }, [projects, runOneClickPlanGeneration, beginExclusiveAction, endExclusiveAction]);

  // ── Plan update ──
  const handleUpdatePlans = useCallback((projectId: string, plans: PlanItem[]) => {
    const project = projects.find((item) => item.id === projectId);
    if (!project) return;
    const nextProject = { ...project, plans, selectedPlanId: plans.find((pl) => pl.selected)?.id };
    setProjects((prev) => prev.map((p) =>
      p.id === projectId ? nextProject : p
    ));
    void persistProjectToSharedState(nextProject);
  }, [projects, persistProjectToSharedState]);

  // ── Regenerate plans ──
  const handleRegeneratePlans = useCallback((projectId: string) => {
    const project = projects.find((p) => p.id === projectId);
    if (!project) return;
    addToast('旧版策划重跑会接入真实参考图分析链路，当前不会生成示例假方案。', 'info');
  }, [projects, addToast]);

  // ── Delete ──
  const handleDeleteResult = useCallback((projectId: string, resultId: string) => {
    const project = projects.find((p) => p.id === projectId);
    const result = project?.results.find((item) => item.id === resultId);
    const resultJobIds = Array.from(new Set([
      result?.backendJobId,
      result?.taskId,
      result?.id?.startsWith('job-') ? result.id.slice(4) : '',
      resultId.startsWith('job-') ? resultId.slice(4) : '',
      project?.sourceType === 'job' ? resultId : '',
    ].map((jobId) => String(jobId || '').trim()).filter(Boolean)));
    if (project?.sourceType === 'job') {
      const jobIdsToDelete = resultJobIds.length > 0 ? resultJobIds : [resultId];
      void Promise.allSettled(jobIdsToDelete.map((jobId) => deleteInternalJob(jobId)))
        .then(async () => {
          setProjects((prev) => prev.map((p) =>
            p.id === projectId
              ? { ...p, results: p.results.filter((r) => r.id !== resultId) }
              : p
          ).filter((p) => p.results.length > 0 || p.id !== projectId));
          setTasks((prev) => prev.filter((t) => t.id !== resultId && t.projectId !== projectId && !jobIdsToDelete.includes(t.backendJobId || '') && !jobIdsToDelete.includes(t.id)));
          const synced = await persistDeletionToSharedState({ projectId, resultId, jobIds: resultJobIds });
          addToast(synced ? '历史任务已删除' : '已删除当前任务，但远端历史同步失败', synced ? 'info' : 'warning');
        })
        .catch((error) => addToast(error instanceof Error ? error.message : '删除任务失败', 'error'));
      return;
    }
    setProjects((prev) => prev.map((p) =>
      p.id === projectId
        ? { ...p, results: p.results.filter((r) => r.id !== resultId) }
        : p
    ).filter((p) => p.results.length > 0 || p.id !== projectId));
    setTasks((prev) => prev.filter((t) => t.id !== resultId && t.projectId !== projectId && !resultJobIds.includes(t.backendJobId || '') && !resultJobIds.includes(t.id)));
    void persistDeletionToSharedState({ projectId, resultId, jobIds: resultJobIds })
      .then((synced) => {
        if (!synced) {
          addToast('已在当前页面删除，但远端历史同步失败', 'warning');
        }
      });
  }, [projects, addToast, persistDeletionToSharedState]);

  const handleDeletePlan = useCallback((projectId: string, planId: string) => {
    const project = projects.find((p) => p.id === projectId);
    if (!project || project.module !== AppModuleObj.ONE_CLICK) return;

    const nextPlans = (project.plans || []).filter((plan) => plan.id !== planId);
    const nextResults = project.results.filter((result) => result.planId !== planId);
    const remainingPlanCount = nextPlans.length;
    const remainingResultCount = nextResults.length;

    if (remainingPlanCount === 0 && remainingResultCount === 0) {
      setProjects((prev) => prev.filter((p) => p.id !== projectId));
      setTasks((prev) => prev.filter((t) => t.projectId !== projectId));
      void persistDeletionToSharedState({ projectId })
        .then((synced) => {
          addToast(synced ? '策划方案已删除' : '已在当前页面删除，但远端历史同步失败', synced ? 'info' : 'warning');
        });
      return;
    }

    const nextProject: Project = {
      ...project,
      plans: nextPlans,
      results: nextResults,
      selectedPlanId: nextPlans.find((plan) => plan.selected)?.id,
      taskCount: Math.max(remainingPlanCount, remainingResultCount, 1),
      completedCount: remainingResultCount,
    };

    setProjects((prev) => prev.map((p) => (p.id === projectId ? nextProject : p)));
    void persistProjectToSharedState(nextProject)
      .then((synced) => {
        addToast(synced ? '策划方案已删除' : '已在当前页面删除，但远端历史同步失败', synced ? 'info' : 'warning');
      });
  }, [projects, addToast, persistDeletionToSharedState, persistProjectToSharedState]);

  const handleDeleteProject = useCallback((projectId: string) => {
    const project = projects.find((p) => p.id === projectId);
    const jobIds = Array.from(new Set([
      project?.backendJobId,
      project?.id?.startsWith('job-') ? project.id.slice(4) : '',
    ].map((jobId) => String(jobId || '').trim()).filter(Boolean)));
    if (jobIds.length > 0) {
      void Promise.allSettled(jobIds.map((jobId) => deleteInternalJob(jobId)))
        .then(async (results) => {
          setProjects((prev) => prev.filter((p) => p.id !== projectId));
          setTasks((prev) => prev.filter((t) => t.projectId !== projectId && !jobIds.includes(t.id)));
          const synced = await persistDeletionToSharedState({ projectId, jobIds });
          const deletedRemote = results.every((result) => result.status === 'fulfilled');
          addToast(
            synced
              ? (deletedRemote ? '历史任务已删除' : '历史任务已隐藏，远端任务删除未完全成功')
              : '已删除当前项目，但远端历史同步失败',
            synced && deletedRemote ? 'info' : 'warning',
          );
        });
      return;
    }
    setProjects((prev) => prev.filter((p) => p.id !== projectId));
    setTasks((prev) => prev.filter((t) => t.projectId !== projectId));
    void persistDeletionToSharedState({ projectId })
      .then((synced) => {
        addToast(synced ? '项目已删除' : '已在当前页面删除，但远端历史同步失败', synced ? 'info' : 'warning');
      });
  }, [projects, addToast, persistDeletionToSharedState]);

  const handleStoryboardRegenerateResult = useCallback(async (projectId: string, resultId: string, revisionInstruction = '') => {
    const baseStoryboard = (videoMemory || createDefaultVideoState()).storyboard;
    const project = baseStoryboard.projects.find((item) => item.id === projectId);
    if (!project) return false;
    const boardIndex = project.boards.findIndex((board) => board.id === resultId);
    const board = boardIndex >= 0 ? project.boards[boardIndex] : null;
    if (!board) return false;
    const productUrls = (project.config.uploadedProductUrls || []).filter(Boolean);
    if (productUrls.length === 0) {
      addToast('商品素材缺失，无法重新生成分镜板', 'warning');
      return true;
    }
    const previousBoardImageUrl = boardIndex > 0
      ? project.boards[boardIndex - 1]?.imageUrl || board.previousBoardImageUrl
      : undefined;

    setVideoMemory((prev) => {
      const currentStoryboard = prev.storyboard || baseStoryboard;
      return {
        ...prev,
        storyboard: {
          ...currentStoryboard,
          projects: currentStoryboard.projects.map((item) => item.id === projectId ? {
            ...item,
            status: 'imaging',
            boards: item.boards.map((currentBoard) => currentBoard.id === resultId ? {
              ...currentBoard,
              status: 'generating',
              error: undefined,
              revisionInstruction,
            } : currentBoard),
          } : item),
        },
      };
    });

    try {
      const { generateStoryboardBoardImage } = await import('./services/videoStoryboardService');
      const generated = await generateStoryboardBoardImage(
        { ...board, revisionInstruction },
        project.shots,
        project.config,
        productUrls,
        apiConfig,
        previousBoardImageUrl,
        revisionInstruction,
      );
      if (generated.result.status !== 'success' || !generated.result.imageUrl) {
        throw new Error(generated.result.message || '分镜板重新生成失败');
      }
      setVideoMemory((prev) => {
        const currentStoryboard = prev.storyboard || baseStoryboard;
        return {
          ...prev,
          storyboard: {
            ...currentStoryboard,
            projects: currentStoryboard.projects.map((item) => {
              if (item.id !== projectId) return item;
              const nextBoards = item.boards.map((currentBoard) => currentBoard.id === resultId ? {
                ...currentBoard,
                status: 'completed' as const,
                imageUrl: generated.result.imageUrl,
                prompt: generated.prompt,
                taskId: generated.result.taskId,
                creditsConsumed: generated.result.creditsConsumed,
                error: undefined,
                previousBoardImageUrl,
                revisionInstruction,
              } : currentBoard);
              return {
                ...item,
                boards: nextBoards,
                status: nextBoards.some((currentBoard) => currentBoard.status === 'failed')
                  ? 'failed'
                  : nextBoards.some((currentBoard) => currentBoard.status === 'generating')
                    ? 'imaging'
                    : 'completed',
              };
            }),
          },
        };
      });
      addToast(revisionInstruction.trim() ? '分镜板修改已完成' : '分镜板已重新生成', 'success');
    } catch (error) {
      setVideoMemory((prev) => {
        const currentStoryboard = prev.storyboard || baseStoryboard;
        return {
          ...prev,
          storyboard: {
            ...currentStoryboard,
            projects: currentStoryboard.projects.map((item) => item.id === projectId ? {
              ...item,
              status: 'failed',
              boards: item.boards.map((currentBoard) => currentBoard.id === resultId ? {
                ...currentBoard,
                status: 'failed',
                error: error instanceof Error ? error.message : '分镜板重新生成失败',
              } : currentBoard),
            } : item),
          },
        };
      });
      logShellError('storyboard_board_regenerate_failed', error, {
        projectId,
        resultId,
        revision: Boolean(revisionInstruction.trim()),
      }, '分镜板重新生成失败');
      addToast(error instanceof Error ? error.message : '分镜板重新生成失败', 'error');
    }
    return true;
  }, [videoMemory, addToast, apiConfig, logShellError]);

  const handleConfirmStoryboardImaging = useCallback(async (projectId: string) => {
    const actionKey = `storyboard-image:${projectId}`;
    if (!beginExclusiveAction(actionKey, '分镜生图任务已提交，请等待当前任务完成')) return;
    const baseStoryboard = (videoMemory || createDefaultVideoState()).storyboard;
    const project = baseStoryboard.projects.find((item) => item.id === projectId);
    if (!project || project.status !== 'awaiting_image_confirmation') {
      endExclusiveAction(actionKey);
      return;
    }
    const productUrls = (project.config.uploadedProductUrls || []).filter(Boolean);
    if (productUrls.length === 0) {
      addToast('商品素材缺失，无法开始生图', 'warning');
      endExclusiveAction(actionKey);
      return;
    }

    setVideoMemory((prev) => {
      const currentStoryboard = prev.storyboard || baseStoryboard;
      return {
        ...prev,
        isGenerating: true,
        storyboard: {
          ...currentStoryboard,
          projects: currentStoryboard.projects.map((item) => item.id === projectId ? {
            ...item,
            status: 'imaging',
            boards: item.boards.map((board) => ({ ...board, status: 'pending' as const, error: undefined, creditsConsumed: undefined })),
          } : item),
        },
      };
    });

    try {
      const { generateStoryboardBoardImage } = await import('./services/videoStoryboardService');
      let previousBoardImageUrl: string | undefined;
      for (const board of project.boards) {
        setVideoMemory((prev) => {
          const currentStoryboard = prev.storyboard || baseStoryboard;
          return {
            ...prev,
            storyboard: {
              ...currentStoryboard,
              projects: currentStoryboard.projects.map((item) => item.id === projectId ? {
                ...item,
                boards: item.boards.map((currentBoard) => currentBoard.id === board.id ? {
                  ...currentBoard,
                  status: 'generating',
                  error: undefined,
                } : currentBoard),
              } : item),
            },
          };
        });
        const generated = await generateStoryboardBoardImage(board, project.shots, project.config, productUrls, apiConfig, previousBoardImageUrl);
        const nextBoardImageUrl = generated.result.status === 'success' ? generated.result.imageUrl : undefined;
        setVideoMemory((prev) => {
          const currentStoryboard = prev.storyboard || baseStoryboard;
          return {
            ...prev,
            storyboard: {
              ...currentStoryboard,
              projects: currentStoryboard.projects.map((item) => {
                if (item.id !== projectId) return item;
                const nextBoards = item.boards.map((currentBoard) => currentBoard.id === board.id ? {
                  ...currentBoard,
                  status: (generated.result.status === 'success' ? 'completed' : 'failed') as VideoStoryboardProject['boards'][number]['status'],
                  imageUrl: nextBoardImageUrl,
                  prompt: generated.prompt,
                  taskId: generated.result.taskId,
                  creditsConsumed: generated.result.creditsConsumed,
                  error: generated.result.status === 'success' ? undefined : generated.result.message || '生成失败',
                  previousBoardImageUrl,
                } : currentBoard);
                return {
                  ...item,
                  boards: nextBoards,
                  status: nextBoards.some((currentBoard) => currentBoard.status === 'failed') ? 'failed' : item.status,
                };
              }),
            },
          };
        });
        previousBoardImageUrl = nextBoardImageUrl;
      }
      setVideoMemory((prev) => {
        const currentStoryboard = prev.storyboard || baseStoryboard;
        return {
          ...prev,
          storyboard: {
            ...currentStoryboard,
            projects: currentStoryboard.projects.map((item) => item.id === projectId ? {
              ...item,
              status: item.boards.some((board) => board.status === 'failed') ? 'failed' : 'completed',
              completedAt: Date.now(),
            } : item),
          },
        };
      });
      addToast('分镜宫格图已生成', 'success');
    } catch (error) {
      setVideoMemory((prev) => {
        const currentStoryboard = prev.storyboard || baseStoryboard;
        return {
          ...prev,
          storyboard: {
            ...currentStoryboard,
            projects: currentStoryboard.projects.map((item) => item.id === projectId ? {
              ...item,
              status: 'failed',
              error: error instanceof Error ? error.message : '分镜板生成失败',
            } : item),
          },
        };
      });
      logShellError('storyboard_board_generation_failed', error, {
        projectId,
        boardCount: project.boards.length,
      }, '分镜板生成失败');
      addToast(error instanceof Error ? error.message : '分镜板生成失败', 'error');
    } finally {
      setVideoMemory((prev) => ({ ...prev, isGenerating: false }));
      endExclusiveAction(actionKey);
    }
  }, [videoMemory, addToast, apiConfig, logShellError, beginExclusiveAction, endExclusiveAction]);

  const handleRegenerateResult = useCallback(async (projectId: string, resultId: string, revisionInstruction = '') => {
    const actionKey = `regenerate:${projectId}:${resultId}`;
    if (!beginExclusiveAction(actionKey, '重生成任务已提交，请等待当前任务完成')) return;
    try {
      const project = projects.find((p) => p.id === projectId);
      if (!project) return;
      if (hasActiveRegenerationConflict(projects, tasks, project)) {
        addToast('当前模块仍有任务生成中，请先中断或等待当前任务完成后再重生成', 'warning');
        return;
      }
      if (await handleStoryboardRegenerateResult(projectId, resultId, revisionInstruction)) return;
      const retryTaskId = `${resultId}-retry-${Date.now()}`;
      try {
      if (project.module === AppModuleObj.TRANSLATION) {
        const result = project.results.find((item) => item.id === resultId);
        if (!result) return;
        if (result.status !== 'error') {
          addToast('出海翻译仅失败项会单独重试，已完成项请重新提交新任务。', 'info');
          return;
        }
        const sourceUrl = resolvePublicAssetUrl(result.sourceUrl || result.sourcePreviewUrl || '', publicBaseUrl);
        if (!sourceUrl) {
          addToast('原图公网地址缺失，无法重试该失败项。', 'warning');
          return;
        }
        const subFeature = project.subFeature || 'main';
        const currentScopedImageModel = getCurrentScopedImageModel(project.module, subFeature);
        const retryParams = normalizeParamsForGeneration(AppModuleObj.TRANSLATION, subFeature, {
          ...currentParams,
          ratio: result.aspectRatio || currentParams.ratio,
          aspectRatio: result.aspectRatio || currentParams.aspectRatio,
          model: currentScopedImageModel || currentParams.model || result.model,
        }) as Record<string, string> & { [key: string]: string | undefined };
        const sourceDimensions = await getImageDimensionsFromUrl(sourceUrl).catch(() => null);
        const modelConfig = {
          targetLanguage: String(retryParams.lang || 'English'),
          customLanguage: '',
          removeWatermark: true,
          aspectRatio: String(retryParams.ratio || retryParams.aspectRatio || 'auto'),
          quality: String(retryParams.quality || '1K').toLowerCase().includes('4')
            ? '4k'
            : String(retryParams.quality || '1K').toLowerCase().includes('2')
              ? '2k'
              : '1k',
          model: normalizeShellImageModel(retryParams.model || 'GPT Image 2'),
          resolutionMode: String(retryParams.resolutionMode || retryParams.sizeMode || 'custom').includes('original')
            ? 'original'
            : 'custom',
          targetWidth: Number(retryParams.targetWidth || retryParams.width || 0),
          targetHeight: Number(retryParams.targetHeight || retryParams.height || 0),
          maxFileSize: Number(retryParams.maxFileSize || retryParams.maxSize || 2),
        };
        const { effectiveConfig } = deriveTranslationExecutionPlan({
          config: modelConfig as any,
          subMode: subFeature === 'detail' ? 'detail' : subFeature === 'remove_text' ? 'remove_text' : 'main',
          sourceDimensions: sourceDimensions || undefined,
        });
        const matchedRatio = String(effectiveConfig.aspectRatio || modelConfig.aspectRatio || 'auto');
        const retryPrompt = [
          `模块：${MODULE_NAMES[AppModuleObj.TRANSLATION]}`,
          `子功能：${subFeature}`,
          `用户需求：重试该失败项，只处理当前图片，保持商品主体与文字结构稳定。`,
          `前端参数：${JSON.stringify({
            ...retryParams,
            ratio: matchedRatio,
            aspectRatio: matchedRatio,
            __retryResultId: result.id,
            __sourceFileName: result.fileName,
            __sourceRelativePath: result.relativePath,
          })}`,
        ].join('\n');
        const toFileItem = (nextResult: GeneratedResult, status: TranslationBatchFile['status']): TranslationBatchFile => ({
          id: nextResult.id,
          file: null,
          fileName: nextResult.fileName || nextResult.relativePath || '翻译图片',
          relativePath: nextResult.relativePath || nextResult.fileName || '翻译图片',
          sourceUrl: String(nextResult.sourceUrl || sourceUrl),
          sourcePreviewUrl: String(nextResult.sourcePreviewUrl || nextResult.sourceUrl || sourceUrl),
          status,
          progress: status === 'completed' || status === 'error' ? 100 : 12,
          prompt: nextResult.prompt || retryPrompt,
          model: nextResult.model || String(retryParams.model || 'GPT Image 2'),
          aspectRatio: nextResult.aspectRatio || matchedRatio,
          subFeature,
          projectId: project.id,
          projectName: project.name,
          projectCreatedAt: Date.now(),
          taskId: nextResult.taskId,
          backendJobId: nextResult.backendJobId,
          creditsConsumed: nextResult.creditsConsumed,
          resultUrl: nextResult.imageUrl || undefined,
          matchedAspectRatio: nextResult.aspectRatio || matchedRatio,
          error: nextResult.error,
        });
        const setProjectResult = (nextResult: GeneratedResult) => {
          setProjects((prev) => prev.map((item) => {
            if (item.id !== project.id) return item;
            const nextResults = item.results.map((current) => current.id === result.id ? nextResult : current);
            const hasGenerating = nextResults.some((current) => current.status === 'generating');
            const hasError = nextResults.some((current) => current.status === 'error');
            return {
              ...item,
              status: hasGenerating ? 'generating' : hasError ? 'error' : 'completed',
              results: nextResults,
              completedCount: nextResults.filter((current) => current.status === 'completed' && current.imageUrl).length,
            };
          }));
        };

        const pendingResult: GeneratedResult = {
          ...result,
          status: 'generating',
          prompt: retryPrompt,
          error: undefined,
          aspectRatio: matchedRatio,
        };
        setProjectResult(pendingResult);
        setTasks((prev) => [{
          id: retryTaskId,
          projectId: project.id,
          module: AppModuleObj.TRANSLATION,
          type: 'image',
          status: 'generating',
          title: `重试: ${result.fileName || result.relativePath || project.name}`,
          progress: 12,
          createdAt: project.createdAt,
          total: 1,
          completed: 0,
          subFeature,
        }, ...prev]);
        void persistTranslationFilesToSharedState(subFeature, [toFileItem(pendingResult, 'processing')]);

        const controller = new AbortController();
        taskControllersRef.current[retryTaskId] = controller;
        const { runShellImageGeneration } = await loadShellWorkflowModule();
        const generation = await runShellImageGeneration({
          module: AppModuleObj.TRANSLATION,
          subFeature,
          prompt: retryPrompt,
          params: {
            ...retryParams,
            ratio: matchedRatio,
            aspectRatio: matchedRatio,
            __workspacePreferences: JSON.stringify(apiConfig.workspacePreferences || getWorkspacePreferences()),
            __retryResultId: result.id,
            __sourceFileName: result.fileName || '',
            __sourceRelativePath: result.relativePath || '',
          },
          materials: {
            product: [{
              id: result.id,
              type: 'product',
              url: sourceUrl,
              remoteUrl: sourceUrl,
              fileName: result.fileName || result.relativePath || 'translation-source.png',
              subFeature,
            }],
          },
          signal: controller.signal,
          onJobCreated: (jobId, providerTaskId) => {
            setTasks((prev) => prev.map((task) => task.id === retryTaskId ? { ...task, backendJobId: jobId } : task));
            if (providerTaskId) {
              const providerPendingResult: GeneratedResult = {
                ...pendingResult,
                taskId: providerTaskId,
                backendJobId: jobId,
                error: undefined,
              };
              setProjectResult(providerPendingResult);
              void persistTranslationFilesToSharedState(subFeature, [toFileItem(providerPendingResult, 'processing')]);
            }
          },
          publicBaseUrl,
        });
        if (generation.status !== 'success' || !generation.imageUrl) {
          throw new Error(generation.message || '重试失败');
        }
        const completedResult: GeneratedResult = {
          ...result,
          imageUrl: generation.imageUrl,
          prompt: generation.prompt || retryPrompt,
          model: String(retryParams.model || result.model || 'GPT Image 2'),
          aspectRatio: matchedRatio,
          status: 'completed',
          taskId: generation.taskId,
          creditsConsumed: generation.creditsConsumed,
          error: undefined,
        };
        setProjectResult(completedResult);
        setTasks((prev) => prev.filter((task) => task.id !== retryTaskId));
        delete taskControllersRef.current[retryTaskId];
        void persistTranslationFilesToSharedState(subFeature, [toFileItem(completedResult, 'completed')]);
        addToast('失败项已重试成功', 'success');
        return;
      }
      if (project.sourceType === 'job') {
        await retryInternalJob(resultId);
        setProjects((prev) => prev.map((item) => item.id === projectId ? {
          ...item,
          status: 'generating',
          error: undefined,
          results: item.results.map((result) => result.id === resultId ? {
            ...result,
            status: 'generating',
            error: undefined,
          } : result),
        } : item));
        addToast('已提交后端重试', 'success');
        window.setTimeout(() => void hydrateShellJobs(), 800);
        return;
      }
      const result = project.results.find((item) => item.id === resultId);
      if (!result) return;
      if (result.mediaType === 'video' || result.videoUrl || project.module === AppModuleObj.VIDEO) {
        addToast('视频结果暂不支持单张重生成，请重新提交视频生成任务', 'info');
        return;
      }
      const subFeature = project.subFeature || getDefaultSubFeature(project.module);
      const storedContext = project.generationContext;
      const currentScopedImageModel = getCurrentScopedImageModel(project.module, subFeature);
      const retryParams = normalizeParamsForGeneration(project.module, subFeature, {
        ...(storedContext?.params || currentParams),
        ratio: result.aspectRatio || storedContext?.params?.ratio || currentParams.ratio,
        aspectRatio: result.aspectRatio || storedContext?.params?.aspectRatio || currentParams.aspectRatio,
        model: currentScopedImageModel || currentParams.model || storedContext?.params?.model || result.model,
      }) as Record<string, string> & { [key: string]: string | undefined };
      const sourceUrl = resolvePublicAssetUrl(result.sourceUrl || result.sourcePreviewUrl || '', publicBaseUrl);
      const contextMaterials = hasMaterialInputs(storedContext?.materials as Record<string, Material[]>)
        ? storedContext?.materials as Record<string, Material[]>
        : {};
      const retryMaterials = hasMaterialInputs(contextMaterials)
        ? contextMaterials
        : sourceUrl
          ? {
              product: [
                createRemoteMaterial(
                  `${result.id}-retry-source`,
                  'product',
                  sourceUrl,
                  result.fileName || 'retry-source.png',
                  subFeature,
                ),
              ],
            }
          : {};
      if (!hasMaterialInputs(retryMaterials)) {
        addToast('当前结果缺少可用于重生成的素材，请重新上传素材后提交', 'warning');
        return;
      }
      const retryPrompt = result.prompt || storedContext?.prompt || project.name;
      const controller = new AbortController();
      taskControllersRef.current[retryTaskId] = controller;
      let latestRegeneratedProject = project;
      const updateProjectWithRegeneratedResult = (nextResult: GeneratedResult) => {
        const nextResults = latestRegeneratedProject.results.map((current) => current.id === result.id ? nextResult : current);
        const hasGenerating = nextResults.some((current) => current.status === 'generating');
        const hasError = nextResults.some((current) => current.status === 'error');
        latestRegeneratedProject = {
          ...latestRegeneratedProject,
          status: hasGenerating ? 'generating' : hasError ? 'error' : 'completed',
          error: hasGenerating ? undefined : latestRegeneratedProject.error,
          results: nextResults,
          completedCount: nextResults.filter((current) => current.status === 'completed' && (current.imageUrl || current.videoUrl)).length,
        };
        setProjects((prev) => prev.map((item) => item.id === project.id ? latestRegeneratedProject : item));
        return latestRegeneratedProject;
      };

      const pendingResult: GeneratedResult = {
        ...result,
        imageUrl: '',
        videoUrl: undefined,
        mediaType: 'image',
        prompt: retryPrompt,
        status: 'generating',
        taskId: undefined,
        backendJobId: undefined,
        error: undefined,
      };
      const pendingProject = updateProjectWithRegeneratedResult(pendingResult);
      setTasks((prev) => [{
        id: retryTaskId,
        projectId: project.id,
        module: project.module,
        type: 'image',
        status: 'generating',
        title: `重生成: ${project.name}`,
        progress: 12,
        createdAt: project.createdAt,
        total: 1,
        completed: 0,
        subFeature,
      }, ...prev]);
      await persistProjectToSharedState(pendingProject);
      addToast('已提交重生成任务', 'success');

      const { runShellImageGeneration } = await loadShellWorkflowModule();
      const preparedMaterials = await ensureMaterialRemoteUrls(retryMaterials, project.module);
      let activeRegenerationProviderTaskId = '';
      const generation = await runShellImageGeneration({
        module: project.module,
        subFeature,
        prompt: retryPrompt,
        params: {
          ...retryParams,
          ratio: result.aspectRatio || retryParams.ratio || retryParams.aspectRatio || 'auto',
          aspectRatio: result.aspectRatio || retryParams.aspectRatio || retryParams.ratio || 'auto',
          __workspacePreferences: JSON.stringify(apiConfig.workspacePreferences || getWorkspacePreferences()),
          __retryResultId: result.id,
        },
        materials: preparedMaterials,
        signal: controller.signal,
        onJobCreated: (jobId, providerTaskId) => {
          setTasks((prev) => prev.map((task) => task.id === retryTaskId ? {
            ...task,
            backendJobId: jobId,
            status: 'generating',
            progress: Math.max(task.progress || 0, 18),
          } : task));
          if (providerTaskId) {
            activeRegenerationProviderTaskId = providerTaskId;
            const providerPendingProject = updateProjectWithRegeneratedResult({
              ...pendingResult,
              taskId: providerTaskId,
              backendJobId: jobId,
            });
            void persistProjectToSharedState(providerPendingProject);
          }
        },
        publicBaseUrl,
        taskMetadata: {
          shellPurpose: 'result_regeneration',
          shellProjectId: project.id,
          shellProjectName: project.name,
          shellResultId: result.id,
          shellPlanId: result.planId,
          subFeature,
          sourceFileName: result.fileName || result.id,
        },
      });
      if (generation.status !== 'success' || !generation.imageUrl) {
        const recoverableGeneration = {
          ...generation,
          taskId: generation.taskId || activeRegenerationProviderTaskId,
        };
        if (isRecoverableShellWorkflowResult(recoverableGeneration)) {
          const syncPendingProject = updateProjectWithRegeneratedResult({
            ...pendingResult,
            taskId: recoverableGeneration.taskId,
            error: recoverableGeneration.message || '任务已提交云端，结果待同步',
          });
          await persistProjectToSharedState(syncPendingProject);
          addToast('重生成任务已提交云端，结果待同步', 'info');
          window.setTimeout(() => void hydrateShellJobs(), 800);
          return;
        }
        throw new Error(generation.message || '重生成失败');
      }
      const completedResult: GeneratedResult = {
        ...result,
        imageUrl: generation.imageUrl,
        videoUrl: undefined,
        mediaType: 'image',
        prompt: generation.prompt || retryPrompt,
        model: result.model || String(retryParams.model || 'GPT Image 2'),
        aspectRatio: result.aspectRatio || String(retryParams.ratio || retryParams.aspectRatio || 'auto'),
        status: 'completed',
        taskId: generation.taskId,
        creditsConsumed: generation.creditsConsumed,
        error: undefined,
      };
      const completedProject = updateProjectWithRegeneratedResult(completedResult);
      setTasks((prev) => prev.filter((task) => task.id !== retryTaskId));
      delete taskControllersRef.current[retryTaskId];
      await persistProjectToSharedState(completedProject);
      addToast('重生成已完成', 'success');
      } catch (error) {
        if (bailIfFrontendResourceError(error)) return;
        addToast(error instanceof Error ? error.message : '重新生成失败', 'error');
        setTasks((prev) => prev.filter((task) => task.id !== retryTaskId));
        delete taskControllersRef.current[retryTaskId];
      }
    } finally {
      endExclusiveAction(actionKey);
    }
  }, [projects, tasks, addToast, hydrateShellJobs, currentParams, publicBaseUrl, apiConfig.workspacePreferences, persistTranslationFilesToSharedState, persistProjectToSharedState, ensureMaterialRemoteUrls, createRemoteMaterial, handleStoryboardRegenerateResult, getCurrentScopedImageModel, beginExclusiveAction, endExclusiveAction]);

  const handleFissionResult = useCallback(async (
    projectId: string,
    resultId: string,
    mode: 'scene' | 'palette' | 'custom',
    instruction: string,
  ) => {
    const actionKey = `fission:${projectId}:${resultId}`;
    if (!beginExclusiveAction(actionKey, '裂变任务已提交，请等待当前任务完成')) return;
    try {
      const project = projects.find((p) => p.id === projectId);
      if (!project || project.module !== AppModuleObj.ONE_CLICK || project.subFeature !== 'first_image') return;
      const resultIndex = project.results.findIndex((item) => item.id === resultId);
      const result = resultIndex >= 0 ? project.results[resultIndex] : null;
      if (!result?.imageUrl) {
        addToast('当前结果图还未完成，暂时不能继续裂变', 'warning');
        return;
      }
      const matchedPlan = project.plans?.find((plan) => plan.id === result.planId) || project.plans?.[resultIndex];
      if (!matchedPlan) {
        addToast('当前裂变基准方案缺失，暂时无法继续裂变', 'warning');
        return;
      }
      const variantLabel = mode === 'scene' ? '换场景' : mode === 'palette' ? '换配色' : '自定义';
      const fissionInstruction = instruction.trim();
      const storedContext = project.generationContext;
      const currentScopedImageModel = getCurrentScopedImageModel(project.module, project.subFeature);
      const fissionParams = {
        ...(storedContext?.params || currentParams),
        model: currentScopedImageModel || storedContext?.params?.model || result.model || currentParams.model || 'GPT Image 2',
        ratio: storedContext?.params?.ratio || result.aspectRatio || currentParams.ratio,
        aspectRatio: storedContext?.params?.aspectRatio || result.aspectRatio || currentParams.aspectRatio,
      };
      const variantPlan: PlanItem = {
        ...matchedPlan,
        id: `plan-variant-${Date.now()}`,
        title: `${matchedPlan.title || project.name} - ${variantLabel}`,
        selected: true,
        sourceReferenceUrl: undefined,
        variationMode: mode,
        variationInstruction: fissionInstruction || `按${variantLabel}方向继续裂变这张生成图。`,
        sourceResultUrl: resolvePublicAssetUrl(result.imageUrl, publicBaseUrl) || '',
        schemeContent: fissionInstruction || `按${variantLabel}方向继续裂变这张生成图。`,
      };
      if (!variantPlan.sourceResultUrl) {
        addToast('当前结果缺少可用于模型读取的生成图地址，请重新生成后再试', 'warning');
        return;
      }
      const variantProject: Project = {
        id: `project-variant-${Date.now()}`,
        name: `${project.name} · ${variantLabel}`,
        module: AppModuleObj.ONE_CLICK,
        status: 'planning',
        createdAt: Date.now(),
        results: [],
        plans: [variantPlan],
        selectedPlanId: variantPlan.id,
        taskCount: 1,
        completedCount: 0,
        subFeature: 'first_image',
        sourceType: 'persisted',
        directGeneration: true,
      };
      const baseMaterials = hasMaterialInputs(storedContext?.materials as Record<string, Material[]>)
        ? storedContext?.materials as Record<string, Material[]>
        : filteredMaterials;
      const variantMaterials = buildVariantMaterials(baseMaterials, variantPlan, 'first_image');
      variantProject.generationContext = cloneGenerationContext(variantPlan.schemeContent || fissionInstruction, fissionParams, variantMaterials);
      setProjects((prev) => [variantProject, ...prev]);
      addToast('裂变任务已提交，正在创建新任务卡', 'info');
      await persistProjectToSharedState(variantProject);
      await runOneClickPlanGeneration(variantProject, [variantPlan], variantMaterials);
    } finally {
      endExclusiveAction(actionKey);
    }
  }, [projects, addToast, currentParams, filteredMaterials, buildVariantMaterials, persistProjectToSharedState, runOneClickPlanGeneration, publicBaseUrl, getCurrentScopedImageModel, beginExclusiveAction, endExclusiveAction]);

  const handleStoryboardEditResult = useCallback(async (
    projectId: string,
    resultId: string,
    instruction: string,
    files: File[] = [],
  ) => {
    const baseVideoMemory = videoMemory || createDefaultVideoState();
    const baseStoryboard = baseVideoMemory.storyboard;
    const project = baseStoryboard.projects.find((item) => item.id === projectId);
    if (!project) return false;
    const boardIndex = project.boards.findIndex((item) => item.id === resultId);
    const board = boardIndex >= 0 ? project.boards[boardIndex] : null;
    if (!board) return false;
    const finalInstruction = instruction.trim();
    if (!finalInstruction) {
      addToast('请先填写修改说明', 'warning');
      return true;
    }
    if (!board.imageUrl) {
      addToast('当前分镜图还未完成，暂时不能修改', 'warning');
      return true;
    }
    const productUrls = (project.config.uploadedProductUrls || []).filter(Boolean);
    if (productUrls.length === 0) {
      addToast('商品素材缺失，无法修改分镜图', 'warning');
      return true;
    }

    const previousBoardImageUrl = boardIndex > 0
      ? project.boards[boardIndex - 1]?.imageUrl || board.previousBoardImageUrl
      : undefined;
    const currentVersion = {
      id: `${board.id}:version:${Date.now()}`,
      imageUrl: board.imageUrl,
      prompt: board.prompt,
      taskId: board.taskId,
      creditsConsumed: board.creditsConsumed,
      revisionInstruction: board.revisionInstruction,
      createdAt: Date.now(),
    };
    const existingVersions = (Array.isArray(board.imageVersions) ? board.imageVersions : [])
      .filter((item) => item?.imageUrl);
    const hasCurrentVersion = existingVersions.some((item) => item.imageUrl === board.imageUrl);
    const nextVersions = hasCurrentVersion ? existingVersions : [...existingVersions, currentVersion];

    setVideoMemory((prev) => {
      const currentStoryboard = (prev || baseVideoMemory).storyboard || baseStoryboard;
      return {
        ...(prev || baseVideoMemory),
        storyboard: {
          ...currentStoryboard,
          projects: (currentStoryboard.projects || []).map((item) => item.id === projectId ? {
            ...item,
            status: 'imaging',
            boards: item.boards.map((currentBoard) => currentBoard.id === resultId ? {
              ...currentBoard,
              status: 'generating',
              error: undefined,
              previousBoardImageUrl,
              revisionInstruction: finalInstruction,
              imageVersions: nextVersions,
            } : currentBoard),
          } : item),
        },
      };
    });
    addToast('分镜图修改任务已提交，正在准备素材', 'info');

    try {
      const uploadedSupplementUrls = await Promise.all(files.map(async (file) => {
        const uploaded = await uploadInternalAssetStream({
          module: AppModuleObj.VIDEO,
          file,
          fileName: file.name,
        });
        if (!uploaded.fileUrl) {
          throw new Error(`${file.name || '补充参考图'} 上传失败，请重试。`);
        }
        return uploaded.fileUrl;
      }));
      const { generateStoryboardBoardImage } = await import('./services/videoStoryboardService');
      const generated = await generateStoryboardBoardImage(
        { ...board, revisionInstruction: finalInstruction },
        project.shots,
        project.config,
        productUrls,
        apiConfig,
        previousBoardImageUrl,
        finalInstruction,
        uploadedSupplementUrls,
      );
      if (isRecoverableShellWorkflowResult(generated.result)) {
        const pendingMessage = generated.result.message || '任务已提交云端，结果待同步';
        setVideoMemory((prev) => {
          const currentStoryboard = (prev || baseVideoMemory).storyboard || baseStoryboard;
          return {
            ...(prev || baseVideoMemory),
            storyboard: {
              ...currentStoryboard,
              projects: (currentStoryboard.projects || []).map((item) => item.id === projectId ? {
                ...item,
                status: 'imaging',
                error: undefined,
                boards: item.boards.map((currentBoard) => currentBoard.id === resultId ? {
                  ...currentBoard,
                  status: 'generating' as const,
                  prompt: generated.prompt,
                  taskId: generated.result.taskId || currentBoard.taskId,
                  error: pendingMessage,
                  previousBoardImageUrl,
                  revisionInstruction: finalInstruction,
                  imageVersions: nextVersions,
                } : currentBoard),
              } : item),
            },
          };
        });
        addToast('分镜图修改任务已提交云端，结果待同步，可稍后点击找回。', 'info');
        return true;
      }
      if (generated.result.status !== 'success' || !generated.result.imageUrl) {
        throw new Error(generated.result.message || '分镜图修改失败');
      }
      const completedVersion = {
        id: `${board.id}:version:${Date.now()}`,
        imageUrl: generated.result.imageUrl,
        prompt: generated.prompt,
        taskId: generated.result.taskId,
        creditsConsumed: generated.result.creditsConsumed,
        revisionInstruction: finalInstruction,
        createdAt: Date.now(),
      };
      setVideoMemory((prev) => {
        const currentStoryboard = (prev || baseVideoMemory).storyboard || baseStoryboard;
        return {
          ...(prev || baseVideoMemory),
          storyboard: {
            ...currentStoryboard,
            projects: (currentStoryboard.projects || []).map((item) => {
              if (item.id !== projectId) return item;
              const completedBoards = item.boards.map((currentBoard) => currentBoard.id === resultId ? {
                ...currentBoard,
                status: 'completed' as const,
                imageUrl: generated.result.imageUrl,
                prompt: generated.prompt,
                taskId: generated.result.taskId,
                creditsConsumed: generated.result.creditsConsumed,
                error: undefined,
                previousBoardImageUrl,
                revisionInstruction: finalInstruction,
                imageVersions: [...nextVersions, completedVersion],
              } : currentBoard);
              return {
                ...item,
                status: completedBoards.some((currentBoard) => currentBoard.status === 'failed')
                  ? 'failed'
                  : completedBoards.some((currentBoard) => currentBoard.status === 'generating')
                    ? 'imaging'
                    : 'completed',
                boards: completedBoards,
              };
            }),
          },
        };
      });
      addToast('分镜图修改已完成', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : '分镜图修改失败';
      setVideoMemory((prev) => {
        const currentStoryboard = (prev || baseVideoMemory).storyboard || baseStoryboard;
        return {
          ...(prev || baseVideoMemory),
          storyboard: {
            ...currentStoryboard,
            projects: (currentStoryboard.projects || []).map((item) => item.id === projectId ? {
              ...item,
              status: 'failed',
              error: message,
              boards: item.boards.map((currentBoard) => currentBoard.id === resultId ? {
                ...currentBoard,
                status: 'failed' as const,
                error: message,
                imageVersions: nextVersions,
              } : currentBoard),
            } : item),
          },
        };
      });
      logShellError('storyboard_board_edit_failed', error, {
        projectId,
        resultId,
      }, '分镜图修改失败');
      addToast(message, 'error');
    }
    return true;
  }, [videoMemory, addToast, apiConfig, logShellError, setVideoMemory]);

  const runEverythingReplaceEditGeneration = useCallback(async (
    project: Project,
    plan: PlanItem,
    materialsOverride: Record<string, Material[]>,
  ) => {
    const projectId = project.id;
    const subFeature = project.subFeature || 'product_replace';
    const storedContext = project.generationContext;
    const generationParams: Record<string, string> = {
      ...((storedContext?.params || currentParams) as Record<string, string>),
      __workspacePreferences: JSON.stringify(apiConfig.workspacePreferences || getWorkspacePreferences()),
      __batchIndex: '1',
      __batchCount: '1',
    };
    const effectiveRatio = String(generationParams.ratio || generationParams.aspectRatio || AspectRatio.AUTO);
    const taskId = 'task-img-' + Date.now();
    const controller = new AbortController();
    taskControllersRef.current[taskId] = controller;

    setProjects((prev) => {
      const next = prev.map((item) => item.id === projectId ? {
        ...item,
        status: 'generating' as const,
        subFeature,
        taskCount: 1,
        completedCount: 0,
      } : item);
      projectsRef.current = next;
      return next;
    });
    setTasks((prev) => [{
      id: taskId,
      projectId,
      module: AppModuleObj.EVERYTHING_REPLACE,
      type: 'image',
      status: 'pending',
      title: `出图: ${project.name} · 产品替换修改`,
      progress: 0,
      createdAt: project.createdAt,
      total: 1,
      completed: 0,
      subFeature,
    }, ...prev]);

    let backendJobId = '';
    let providerTaskId = '';
    const onJobCreated = (jobId: string, visibleTaskId?: string) => {
      backendJobId = jobId || backendJobId;
      providerTaskId = String(visibleTaskId || providerTaskId || '').trim();
      setProjects((prev) => {
        const next = prev.map((item) => item.id === projectId ? { ...item, backendJobId: backendJobId || item.backendJobId } : item);
        projectsRef.current = next;
        return next;
      });
      setTasks((prev) => prev.map((task) => task.id === taskId ? {
        ...task,
        backendJobId: backendJobId || task.backendJobId,
        status: 'generating',
        progress: Math.max(task.progress || 0, 8),
      } : task));
    };

    try {
      const { runShellImageGeneration } = await loadShellWorkflowModule();
      const preparedMaterials = await ensureMaterialRemoteUrls(materialsOverride, AppModuleObj.EVERYTHING_REPLACE);
      const prompt = plan.schemeContent || plan.editInstruction || storedContext?.prompt || '';
      const result = await runShellImageGeneration({
        module: AppModuleObj.EVERYTHING_REPLACE,
        subFeature,
        prompt,
        params: generationParams,
        materials: preparedMaterials,
        signal: controller.signal,
        onJobCreated,
        publicBaseUrl,
        taskMetadata: {
          shellPurpose: 'everything_replace_product_edit',
          shellProjectId: projectId,
          shellProjectName: project.name,
          shellPlanId: plan.id,
          subFeature,
          batchIndex: 1,
          batchCount: 1,
          sourceResultUrl: plan.sourceResultUrl ? resolvePublicAssetUrl(plan.sourceResultUrl, publicBaseUrl) : undefined,
          editInstruction: plan.editInstruction || prompt,
        },
      });

      if (result.status !== 'success' || !result.imageUrl) {
        const recoverable = {
          ...result,
          taskId: result.taskId || providerTaskId,
        };
        if (isRecoverableShellWorkflowResult(recoverable)) {
          const pendingResult: GeneratedResult = {
            id: recoverable.taskId || `${taskId}-pending-0`,
            planId: plan.id,
            imageUrl: '',
            prompt: result.prompt || prompt,
            model: generationParams.model || 'gpt-image-2',
            aspectRatio: effectiveRatio,
            status: 'generating',
            createdAt: project.createdAt,
            module: AppModuleObj.EVERYTHING_REPLACE,
            subFeature,
            taskId: recoverable.taskId,
            backendJobId,
            error: result.message || '结果待同步',
          };
          const pendingProject: Project = {
            ...project,
            status: 'generating',
            results: [pendingResult],
            taskCount: 1,
            completedCount: 0,
            subFeature,
            backendJobId: backendJobId || project.backendJobId,
            error: result.message || '结果待同步',
          };
          setProjects((prev) => {
            const next = prev.map((item) => item.id === projectId ? pendingProject : item);
            projectsRef.current = next;
            return next;
          });
          setTasks((prev) => prev.map((task) => task.id === taskId ? {
            ...task,
            status: 'generating',
            progress: Math.max(task.progress || 0, 8),
            completed: 0,
            total: 1,
          } : task));
          await persistProjectToSharedState(pendingProject);
          addToast('修改任务已提交云端，结果待同步，可稍后点击同步。', 'info');
          window.setTimeout(() => void hydrateShellJobs(), 800);
          return;
        }
        throw new Error(result.message || '产品替换修改生成失败');
      }

      const completedResult: GeneratedResult = {
        id: result.taskId || `${Date.now()}-0`,
        planId: plan.id,
        imageUrl: result.imageUrl,
        prompt: result.prompt || prompt,
        model: generationParams.model || 'gpt-image-2',
        aspectRatio: effectiveRatio,
        status: 'completed',
        createdAt: project.createdAt,
        module: AppModuleObj.EVERYTHING_REPLACE,
        subFeature,
        creditsConsumed: result.creditsConsumed,
        taskId: result.taskId || providerTaskId,
        backendJobId: result.backendJobId || backendJobId,
      };
      const completedProject: Project = {
        ...project,
        status: 'completed',
        completedAt: project.createdAt,
        results: [completedResult],
        taskCount: 1,
        completedCount: 1,
        subFeature,
        creditsConsumed: result.creditsConsumed || project.creditsConsumed,
        backendJobId: result.backendJobId || backendJobId || project.backendJobId,
      };
      setProjects((prev) => {
        const next = prev.map((item) => item.id === projectId ? completedProject : item);
        projectsRef.current = next;
        return next;
      });
      setTasks((prev) => prev.filter((task) => task.id !== taskId));
      await persistProjectToSharedState(completedProject);
      addToast(`已生成 1 张图片 · ${project.name}`, 'success');
      window.setTimeout(() => void hydrateShellJobs(), 800);
    } catch (error) {
      if (bailIfFrontendResourceError(error)) return;
      const message = error instanceof Error ? error.message : '产品替换修改生成失败';
      const failedResult: GeneratedResult = {
        id: providerTaskId || `${taskId}-error-0`,
        planId: plan.id,
        imageUrl: '',
        prompt: plan.schemeContent || plan.editInstruction || message,
        model: generationParams.model || 'gpt-image-2',
        aspectRatio: effectiveRatio,
        status: 'error',
        createdAt: project.createdAt,
        module: AppModuleObj.EVERYTHING_REPLACE,
        subFeature,
        taskId: providerTaskId || undefined,
        backendJobId: backendJobId || undefined,
        error: message,
      };
      const failedProject: Project = {
        ...project,
        status: 'error',
        results: [failedResult],
        taskCount: 1,
        completedCount: 0,
        subFeature,
        backendJobId: backendJobId || project.backendJobId,
        error: message,
      };
      setProjects((prev) => {
        const next = prev.map((item) => item.id === projectId ? failedProject : item);
        projectsRef.current = next;
        return next;
      });
      setTasks((prev) => prev.map((task) => task.id === taskId ? {
        ...task,
        status: 'error',
        progress: 100,
        completed: 0,
        total: 1,
      } : task));
      void persistProjectToSharedState(failedProject);
      addToast(message, 'error');
    } finally {
      delete taskControllersRef.current[taskId];
    }
  }, [addToast, apiConfig.workspacePreferences, currentParams, ensureMaterialRemoteUrls, hydrateShellJobs, persistProjectToSharedState, publicBaseUrl]);

  const handleEditResult = useCallback(async (
    projectId: string,
    resultId: string,
    instruction: string,
    files: File[] = [],
  ) => {
    const actionKey = `edit:${projectId}:${resultId}`;
    if (!beginExclusiveAction(actionKey, '修改任务已提交，请等待当前任务完成')) return;
    let createdEditProjectId = '';
    try {
      if (await handleStoryboardEditResult(projectId, resultId, instruction, files)) return;
      const project = projects.find((p) => p.id === projectId);
      const isSupportedImageEditProject = project?.module === AppModuleObj.ONE_CLICK
        || (project?.module === AppModuleObj.EVERYTHING_REPLACE && project.subFeature === 'product_replace');
      if (!project || !isSupportedImageEditProject) return;
      const resultIndex = project.results.findIndex((item) => item.id === resultId);
      const result = resultIndex >= 0 ? project.results[resultIndex] : null;
      if (!result?.imageUrl || result.mediaType === 'video' || result.videoUrl) {
        addToast('当前结果图还未完成，暂时不能修改', 'warning');
        return;
      }
      const finalInstruction = instruction.trim();
      if (!finalInstruction) {
        addToast('请先填写修改说明', 'warning');
        return;
      }
      const sourceResultUrl = resolvePublicAssetUrl(result.imageUrl, publicBaseUrl) || '';
      if (!sourceResultUrl) {
        addToast('当前结果缺少可用于模型读取的生成图地址，请重新生成后再试', 'warning');
        return;
      }

      const storedContext = project.generationContext;
      const currentScopedImageModel = getCurrentScopedImageModel(project.module, project.subFeature);
      const contextMaterials = hasMaterialInputs(storedContext?.materials as Record<string, Material[]>)
        ? storedContext?.materials as Record<string, Material[]>
        : filteredMaterials;
      const isEverythingReplaceProductEdit = project.module === AppModuleObj.EVERYTHING_REPLACE
        && project.subFeature === 'product_replace';
      const isOneClickEdit = project.module === AppModuleObj.ONE_CLICK;
      const usesMinimalRoleEditPrompt = isOneClickEdit || isEverythingReplaceProductEdit;
      const sourceResultAspectRatio = String(result.aspectRatio || '').trim();
      const generationParams = {
        ...(storedContext?.params || currentParams),
        model: currentScopedImageModel || storedContext?.params?.model || result.model || currentParams.model || 'GPT Image 2',
        ratio: isEverythingReplaceProductEdit
          ? sourceResultAspectRatio || storedContext?.params?.ratio || storedContext?.params?.aspectRatio || currentParams.ratio
          : storedContext?.params?.ratio || result.aspectRatio || currentParams.ratio,
        aspectRatio: isEverythingReplaceProductEdit
          ? sourceResultAspectRatio || storedContext?.params?.aspectRatio || storedContext?.params?.ratio || currentParams.aspectRatio
          : storedContext?.params?.aspectRatio || result.aspectRatio || currentParams.aspectRatio,
      };
      const initialEditMaterials: Record<string, Material[]> = {
        product: [...(contextMaterials.product || [])],
        gift: [...(contextMaterials.gift || [])],
        logo: usesMinimalRoleEditPrompt ? [] : [...(contextMaterials.logo || [])],
        reference: [],
      };
      const matchedPlan = project.plans?.find((plan) => plan.id === result.planId) || project.plans?.[resultIndex];
      const matchedPlanPrompt = matchedPlan ? buildPlanPromptSummary(matchedPlan, project.subFeature || activeSubFeature || '') : '';
      const originalGenerationPrompt = [
        result.prompt,
        matchedPlan?.schemeContent,
        matchedPlanPrompt,
        storedContext?.prompt,
      ].map((value) => String(value || '').trim()).find(Boolean) || '';
      const editPlan: PlanItem = {
        ...(matchedPlan || {
          id: `plan-edit-base-${Date.now()}`,
          title: project.name,
          sellingPoints: [],
          sceneDescription: '',
          styleDirection: '',
          colorPalette: '',
          composition: '',
          textLayout: '',
          selected: true,
        }),
        id: `plan-edit-${Date.now()}`,
        title: `${matchedPlan?.title || project.name} - 修改`,
        selected: true,
        sourceReferenceUrl: undefined,
        variationMode: undefined,
        variationInstruction: undefined,
        editInstruction: finalInstruction,
        sourceResultUrl,
        schemeContent: originalGenerationPrompt || finalInstruction,
      };
      const editProject: Project = {
        id: `project-edit-${Date.now()}`,
        name: `${project.name} · 修改`,
        module: project.module,
        status: 'planning',
        createdAt: Date.now(),
        results: [],
        plans: [editPlan],
        selectedPlanId: editPlan.id,
        taskCount: 1,
        completedCount: 0,
        subFeature: project.subFeature || activeSubFeature || (project.module === AppModuleObj.ONE_CLICK ? 'first_image' : 'product_replace'),
        sourceType: 'persisted',
        directGeneration: true,
        generationContext: cloneGenerationContext(originalGenerationPrompt || finalInstruction, generationParams, initialEditMaterials),
      };
      createdEditProjectId = editProject.id;
      setProjects((prev) => [editProject, ...prev]);
      addToast('修改任务已提交，正在准备素材', 'info');
      await persistProjectToSharedState(editProject);

      const uploadedSupplementMaterials = usesMinimalRoleEditPrompt
        ? []
        : await Promise.all(files.map(async (file, index) => {
            const uploaded = await uploadInternalAssetStream({
              module: project.module,
              file,
              fileName: file.name,
            });
            if (!uploaded.fileUrl) {
              throw new Error(`${file.name || '补充参考图'} 上传失败，请重试。`);
            }
            return createRemoteMaterial(
              `edit-supplement-${Date.now()}-${index}`,
              'reference',
              uploaded.fileUrl,
              file.name || `supplement-${index + 1}.png`,
              project.subFeature || activeSubFeature || (project.module === AppModuleObj.ONE_CLICK ? 'first_image' : 'product_replace'),
            );
          }));
      const editMaterials: Record<string, Material[]> = {
        ...initialEditMaterials,
        reference: uploadedSupplementMaterials,
      };
      const readyEditProject: Project = {
        ...editProject,
        generationContext: cloneGenerationContext(originalGenerationPrompt || finalInstruction, generationParams, editMaterials),
      };
      setProjects((prev) => prev.map((item) => item.id === readyEditProject.id ? readyEditProject : item));
      await persistProjectToSharedState(readyEditProject);
      if (isEverythingReplaceProductEdit) {
        await runEverythingReplaceEditGeneration(readyEditProject, editPlan, editMaterials);
      } else {
        await runOneClickPlanGeneration(readyEditProject, [editPlan], editMaterials);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '修改任务提交失败';
      if (createdEditProjectId) {
        setProjects((prev) => prev.map((item) => (
          item.id === createdEditProjectId
            ? { ...item, status: 'error', error: message }
            : item
        )));
      }
      addToast(message, 'error');
    } finally {
      endExclusiveAction(actionKey);
    }
  }, [projects, addToast, activeSubFeature, currentParams, filteredMaterials, createRemoteMaterial, persistProjectToSharedState, runOneClickPlanGeneration, runEverythingReplaceEditGeneration, publicBaseUrl, handleStoryboardEditResult, getCurrentScopedImageModel, beginExclusiveAction, endExclusiveAction]);

  const handleStoryboardRecoverResult = useCallback(async (projectId: string, resultId?: string) => {
    const baseVideoMemory = videoMemory || createDefaultVideoState();
    const baseStoryboard = baseVideoMemory.storyboard;
    const project = baseStoryboard.projects.find((item) => item.id === projectId);
    if (!project) return false;
    const board = resultId
      ? project.boards.find((item) => item.id === resultId)
      : project.boards.find((item) => item.taskId);
    const recoverTaskId = String(board?.taskId || '').trim();
    if (!board || !recoverTaskId) {
      void hydrateShellData();
      void hydrateShellJobs();
      addToast('当前分镜缺少 KIE 任务 ID，已重新同步后端任务与持久化状态', 'info');
      return true;
    }

    const controller = new AbortController();
    const recoverControllerId = `recover-storyboard-${projectId}-${board.id}-${Date.now()}`;
    taskControllersRef.current[recoverControllerId] = controller;

    const applyBoardRecoveryState = (
      boardUpdater: (currentBoard: VideoStoryboardBoard) => VideoStoryboardBoard,
      fallbackProjectStatus: VideoStoryboardProject['status'],
    ) => {
      setVideoMemory((prev) => {
        const currentVideoMemory = prev || baseVideoMemory;
        const currentStoryboard = currentVideoMemory.storyboard || baseStoryboard;
        return {
          ...currentVideoMemory,
          storyboard: {
            ...currentStoryboard,
            projects: (currentStoryboard.projects || []).map((item) => {
              if (item.id !== projectId) return item;
              const nextBoards = item.boards.map((currentBoard) => currentBoard.id === board.id
                ? boardUpdater(currentBoard)
                : currentBoard);
              const nextProjectStatus: VideoStoryboardProject['status'] = nextBoards.some((currentBoard) => currentBoard.status === 'generating')
                ? 'imaging'
                : nextBoards.some((currentBoard) => currentBoard.status === 'failed')
                  ? 'failed'
                  : nextBoards.every((currentBoard) => currentBoard.status === 'completed')
                    ? 'completed'
                    : fallbackProjectStatus;
              return {
                ...item,
                status: nextProjectStatus,
                error: nextProjectStatus === 'failed' ? item.error : undefined,
                boards: nextBoards,
              };
            }),
          },
        };
      });
    };

    applyBoardRecoveryState((currentBoard) => ({
      ...currentBoard,
      status: 'generating',
      taskId: currentBoard.taskId || recoverTaskId,
      error: '正在按 KIE 任务 ID 找回结果',
    }), 'imaging');
    addToast('已按 KIE 任务 ID 开始找回分镜图', 'info');

    try {
      const recovery = await recoverKieAiTask(recoverTaskId, apiConfig, controller.signal, false);
      if (recovery.status === 'success' && recovery.imageUrl) {
        applyBoardRecoveryState((currentBoard) => ({
          ...currentBoard,
          status: 'completed',
          imageUrl: recovery.imageUrl || currentBoard.imageUrl,
          taskId: recovery.taskId || recoverTaskId,
          creditsConsumed: recovery.creditsConsumed ?? currentBoard.creditsConsumed,
          error: undefined,
        }), 'imaging');
        addToast('分镜图已找回', 'success');
        return true;
      }

      if (isRecoverableShellWorkflowResult(recovery)) {
        applyBoardRecoveryState((currentBoard) => ({
          ...currentBoard,
          status: 'generating',
          taskId: recovery.taskId || recoverTaskId,
          error: recovery.message || '任务已提交云端，结果待同步',
        }), 'imaging');
        addToast('分镜图仍在云端生成，已保持待同步状态', 'info');
        window.setTimeout(() => void hydrateShellJobs(), 800);
        return true;
      }

      applyBoardRecoveryState((currentBoard) => ({
        ...currentBoard,
        status: 'failed',
        taskId: recovery.taskId || recoverTaskId,
        error: recovery.message || 'KIE 返回任务失败',
      }), 'failed');
      addToast(recovery.message || 'KIE 返回任务失败', 'error');
    } catch (error) {
      applyBoardRecoveryState((currentBoard) => ({
        ...currentBoard,
        status: 'generating',
        taskId: recoverTaskId,
        error: error instanceof Error ? error.message : '找回请求中断，任务仍可稍后继续找回',
      }), 'imaging');
      addToast('找回请求暂未完成，已保留 KIE 任务 ID 可继续同步', 'warning');
    } finally {
      delete taskControllersRef.current[recoverControllerId];
    }
    return true;
  }, [videoMemory, hydrateShellData, hydrateShellJobs, addToast, apiConfig, setVideoMemory]);

  const handleRecoverResult = useCallback(async (projectId: string, resultId?: string) => {
    if (await handleStoryboardRecoverResult(projectId, resultId)) return;
    const project = projects.find((item) => item.id === projectId);
    const targetResult = resultId
      ? project?.results.find((item) => item.id === resultId)
      : project?.results.find((item) => item.taskId);
    const recoverTaskId = String(targetResult?.taskId || '').trim();
    if (!project || !targetResult || !recoverTaskId) {
      void hydrateShellData();
      void hydrateShellJobs();
      addToast('已重新同步后端任务与持久化状态', 'info');
      return;
    }

    const controller = new AbortController();
    const recoverControllerId = `recover-${projectId}-${targetResult.id}-${Date.now()}`;
    taskControllersRef.current[recoverControllerId] = controller;
    const isVideoRecover = Boolean(project.module === AppModuleObj.VIDEO || targetResult.mediaType === 'video' || targetResult.videoUrl);
    const mergeRecoveredResult = (nextResult: GeneratedResult): Project => {
      const nextResults = project.results.map((item) => item.id === targetResult.id ? nextResult : item);
      const hasGenerating = nextResults.some((item) => item.status === 'generating');
      const hasError = nextResults.some((item) => item.status === 'error');
      const nextStatus: Project['status'] = hasGenerating ? 'generating' : hasError ? 'error' : 'completed';
      return {
        ...project,
        status: nextStatus,
        error: hasGenerating ? undefined : project.error,
        results: nextResults,
        completedCount: nextResults.filter((item) => item.status === 'completed' && (item.imageUrl || item.videoUrl)).length,
      };
    };

    const waitingProject = mergeRecoveredResult({
      ...targetResult,
      status: 'generating',
      taskId: targetResult.taskId || recoverTaskId,
      backendJobId: targetResult.backendJobId,
      error: '正在按 KIE 任务 ID 找回结果',
    });
    setProjects((prev) => prev.map((item) => item.id === projectId ? waitingProject : item));
    setTasks((prev) => [{
      id: recoverControllerId,
      projectId,
      module: project.module,
      type: isVideoRecover ? 'video' : 'image',
      status: 'generating',
      title: `找回: ${project.name}`,
      progress: 12,
      createdAt: project.createdAt,
      total: 1,
      completed: 0,
      subFeature: project.subFeature,
      backendJobId: targetResult.backendJobId,
    }, ...prev]);
    await persistProjectToSharedState(waitingProject);
    addToast('已按 KIE 任务 ID 开始找回结果', 'info');

    try {
      const recovery = await recoverKieAiTask(recoverTaskId, apiConfig, controller.signal, isVideoRecover);
      if (recovery.status === 'success' && (recovery.imageUrl || recovery.videoUrl)) {
        const recoveredResult: GeneratedResult = {
          ...targetResult,
          imageUrl: recovery.imageUrl || recovery.videoUrl || targetResult.imageUrl,
          videoUrl: isVideoRecover ? (recovery.videoUrl || recovery.imageUrl || targetResult.videoUrl) : targetResult.videoUrl,
          mediaType: isVideoRecover ? 'video' : 'image',
          status: 'completed',
          taskId: recovery.taskId || recoverTaskId,
          creditsConsumed: recovery.creditsConsumed ?? targetResult.creditsConsumed,
          error: undefined,
        };
        const recoveredProject = mergeRecoveredResult(recoveredResult);
        setProjects((prev) => prev.map((item) => item.id === projectId ? recoveredProject : item));
        setTasks((prev) => prev.filter((task) => task.id !== recoverControllerId));
        await persistProjectToSharedState(recoveredProject);
        addToast('结果已找回', 'success');
        return;
      }

      if (isRecoverableShellWorkflowResult(recovery)) {
        const pendingResult: GeneratedResult = {
          ...targetResult,
          status: 'generating',
          taskId: recovery.taskId || recoverTaskId,
          error: recovery.message || '任务已提交云端，结果待同步',
        };
        const pendingProject = mergeRecoveredResult(pendingResult);
        setProjects((prev) => prev.map((item) => item.id === projectId ? pendingProject : item));
        await persistProjectToSharedState(pendingProject);
        addToast('任务仍在云端生成，已保持待同步状态', 'info');
        window.setTimeout(() => void hydrateShellJobs(), 800);
        return;
      }

      const failedResult: GeneratedResult = {
        ...targetResult,
        status: 'error',
        taskId: recovery.taskId || recoverTaskId,
        error: recovery.message || 'KIE 返回任务失败',
      };
      const failedProject = mergeRecoveredResult(failedResult);
      setProjects((prev) => prev.map((item) => item.id === projectId ? failedProject : item));
      await persistProjectToSharedState(failedProject);
      addToast(recovery.message || 'KIE 返回任务失败', 'error');
    } catch (error) {
      const pendingResult: GeneratedResult = {
        ...targetResult,
        status: 'generating',
        taskId: recoverTaskId,
        error: error instanceof Error ? error.message : '找回请求中断，任务仍可稍后继续找回',
      };
      const pendingProject = mergeRecoveredResult(pendingResult);
      setProjects((prev) => prev.map((item) => item.id === projectId ? pendingProject : item));
      await persistProjectToSharedState(pendingProject);
      addToast('找回请求暂未完成，已保留 KIE 任务 ID 可继续同步', 'warning');
    } finally {
      setTasks((prev) => prev.filter((task) => task.id !== recoverControllerId));
      delete taskControllersRef.current[recoverControllerId];
    }
  }, [handleStoryboardRecoverResult, projects, hydrateShellData, hydrateShellJobs, addToast, apiConfig, persistProjectToSharedState]);

  const handleCancelTask = useCallback((taskIdOrProjectId: string) => {
    const targetId = normalizeShellCancelId(taskIdOrProjectId);
    if (!targetId) return;

    collectShellCancelControllerIds(targetId, projects, tasks).forEach((controllerId) => {
      taskControllersRef.current[controllerId]?.abort();
      delete taskControllersRef.current[controllerId];
    });

    const matchingTasks = tasks.filter((task) => shellCancelTargetMatches(targetId, collectShellTaskIds(task)));
    const cancelJobIds = collectShellCancelJobIds(targetId, projects, tasks);
    cancelJobIds.forEach((jobId) => {
      void cancelInternalJob(jobId).catch(() => null);
    });

    setTasks((prev) => prev.filter((task) => !shellCancelTargetMatches(targetId, collectShellTaskIds(task))));

    const interruptedProjects: Project[] = [];
    const nextProjects = projects.map((project) => {
      const marked = markShellProjectCancelled(project, targetId);
      if (marked.changed) interruptedProjects.push(marked.project);
      return marked.project;
    });
    if (interruptedProjects.length > 0) {
      setProjects(nextProjects);
      interruptedProjects.forEach((project) => {
        void persistProjectToSharedState(project);
      });
    }

    addToast(matchingTasks.length > 0 || interruptedProjects.length > 0 || cancelJobIds.length > 0 ? '任务已中断' : '已尝试中断任务', 'info');
  }, [addToast, persistProjectToSharedState, projects, tasks]);

  const handleParamChange = useCallback((key: string, value: string) => {
    const nextSubFeature = subFeatureFromParam(activeModule, key, value);
    const targetSubFeature = nextSubFeature || activeSubFeature;
    const targetScopeKey = scopeKeyFor(activeModule, targetSubFeature);
    if (nextSubFeature) {
      setActiveSubFeatureByModule((prev) => ({ ...prev, [activeModule]: nextSubFeature }));
    }
    setInputStateByScope((prev) => ({
      ...prev,
      [targetScopeKey]: {
        promptText: prev[targetScopeKey]?.promptText || '',
        params: {
          ...(prev[targetScopeKey]?.params || {}),
          [key]: value,
        },
      },
    }));
  }, [activeModule, activeSubFeature]);

  // Filtered projects & tasks for current module
  const filteredProjects = filterProjectsForScope({
    projects,
    pageMode,
    activeModule,
    activeSubFeature,
    getDefaultSubFeature: (module) => getDefaultSubFeature(module as AppModule),
  });
	  const filteredTasks = tasks.filter((t) => {
	    if (pageMode !== 'module') return false;
	    return t.module === activeModule && (t.subFeature || getDefaultSubFeature(t.module)) === activeSubFeature;
	  });
	  const currentGenerationSubmitLockKey = buildGenerationSubmitLockKey(activeModule, activeSubFeature);
	  const hasCurrentActiveGuardedGeneration = hasActiveGuardedGeneration(projects, tasks, activeModule, activeSubFeature);
	  const isCurrentGenerationSubmitLocked = shouldGuardGenerationSubmit(activeModule, activeSubFeature)
	    && (Boolean(generationSubmitLocks[currentGenerationSubmitLockKey]) || hasCurrentActiveGuardedGeneration);

	  const activeModuleView = (() => {
    switch (pageMode) {
      case 'landing': return <LandingPage onNavigate={handleNavigateFromLanding} />;
      case 'settings': return <GlobalApiSettings currentUser={currentUser} onCurrentUserChange={handleCurrentUserChange} />;
      case 'account': return <AccountManagement
        currentUser={currentUser}
        internalMode={Boolean(currentUser)}
        onCurrentUserChange={handleCurrentUserChange}
        onLogout={onLogout}
      />;
    }
    switch (activeModule) {
      case AppModuleObj.AGENT_CENTER:
        return <AgentCenterModule
          currentUser={currentUser}
          internalMode={Boolean(currentUser)}
          onHandoff={(target: ModuleInterfaceId, payload: Record<string, unknown>) => {
            const destination = moduleFromAgentInterface(target);
            handleModuleChange(destination.module);
            setActiveSubFeatureByModule((prev) => ({ ...prev, [destination.module]: destination.subFeature }));
            const prompt = typeof payload.prompt === 'string' ? payload.prompt : '';
            if (prompt) {
              const key = scopeKeyFor(destination.module, destination.subFeature);
              const mappedParam = paramFromSubFeature(destination.module, destination.subFeature);
              setInputStateByScope((prev) => ({
                ...prev,
                [key]: {
                  promptText: prompt,
                  params: mappedParam
                    ? { ...(prev[key]?.params || {}), [mappedParam[0]]: mappedParam[1] }
                    : { ...(prev[key]?.params || {}) },
                },
              }));
            }
          }}
        />;
      case AppModuleObj.ONE_CLICK:
        return <OneClickModule
          projects={filteredProjects}
          tasks={filteredTasks}
          subFeatures={MODULE_SUB_FEATURES[AppModuleObj.ONE_CLICK]}
          activeSubFeature={activeSubFeature}
          onSubFeatureChange={handleSubFeatureChange}
          onConfirmPlan={handleConfirmPlan}
          onUpdatePlans={handleUpdatePlans}
          onRegeneratePlans={handleRegeneratePlans}
          onDeleteResult={handleDeleteResult}
          onDeleteProject={handleDeleteProject}
          onDeletePlan={handleDeletePlan}
          onRegenerateResult={handleRegenerateResult}
          onFissionResult={handleFissionResult}
          onEditResult={handleEditResult}
          onRecoverResult={handleRecoverResult}
          onCancelTask={handleCancelTask}
          pendingActionKeys={pendingActionKeys}
          showGenerationProgress={showGenerationProgress}
        />;
      case AppModuleObj.TRANSLATION:
        return <TranslationModule
          projects={filteredProjects}
          tasks={filteredTasks}
          materials={filteredMaterials}
          subFeatures={MODULE_SUB_FEATURES[AppModuleObj.TRANSLATION]}
          activeSubFeature={activeSubFeature}
          onSubFeatureChange={handleSubFeatureChange}
          onUploadMaterial={handleMaterialUpload}
          onRemoveMaterial={handleRemoveMaterial}
          onDeleteResult={handleDeleteResult}
          onDeleteProject={handleDeleteProject}
          onRegenerateResult={handleRegenerateResult}
          onRecoverResult={handleRecoverResult}
          onCancelTask={handleCancelTask}
          pendingActionKeys={pendingActionKeys}
          showGenerationProgress={showGenerationProgress}
        />;
      case AppModuleObj.BUYER_SHOW:
        return <BuyerShowModule
          projects={filteredProjects}
          tasks={filteredTasks}
          subFeatures={MODULE_SUB_FEATURES[AppModuleObj.BUYER_SHOW]}
          activeSubFeature={activeSubFeature}
          onSubFeatureChange={handleSubFeatureChange}
          onDeleteResult={handleDeleteResult}
          onDeleteProject={handleDeleteProject}
          onRegenerateResult={handleRegenerateResult}
          onRecoverResult={handleRecoverResult}
          onCancelTask={handleCancelTask}
          pendingActionKeys={pendingActionKeys}
          showGenerationProgress={showGenerationProgress}
        />;
      case AppModuleObj.RETOUCH:
        return <RetouchModule
          projects={filteredProjects}
          tasks={filteredTasks}
          subFeatures={MODULE_SUB_FEATURES[AppModuleObj.RETOUCH]}
          activeSubFeature={activeSubFeature}
          onSubFeatureChange={handleSubFeatureChange}
          onDeleteResult={handleDeleteResult}
          onDeleteProject={handleDeleteProject}
          onRegenerateResult={handleRegenerateResult}
          onRecoverResult={handleRecoverResult}
          onCancelTask={handleCancelTask}
          pendingActionKeys={pendingActionKeys}
          showGenerationProgress={showGenerationProgress}
        />;
      case AppModuleObj.EVERYTHING_REPLACE:
        return <EverythingReplaceModule
          projects={filteredProjects}
          tasks={filteredTasks}
          subFeatures={MODULE_SUB_FEATURES[AppModuleObj.EVERYTHING_REPLACE]}
          activeSubFeature={activeSubFeature}
          onSubFeatureChange={handleSubFeatureChange}
          onDeleteResult={handleDeleteResult}
          onDeleteProject={handleDeleteProject}
          onRegenerateResult={handleRegenerateResult}
          onEditResult={handleEditResult}
          onRecoverResult={handleRecoverResult}
          onCancelTask={handleCancelTask}
          pendingActionKeys={pendingActionKeys}
          showGenerationProgress={showGenerationProgress}
        />;
      case AppModuleObj.VIDEO:
        return <VideoModule
          projects={filteredProjects}
          tasks={filteredTasks}
          subFeatures={getModuleSubFeatures(AppModuleObj.VIDEO, currentUser)}
          activeSubFeature={activeSubFeature}
          onSubFeatureChange={handleSubFeatureChange}
          onDeleteResult={handleDeleteResult}
          onDeleteProject={handleDeleteProject}
          onRegenerateResult={handleRegenerateResult}
          onEditResult={handleEditResult}
          onConfirmStoryboardImaging={handleConfirmStoryboardImaging}
          onImportStoryboardToGeneration={handleImportStoryboardToGeneration}
          onRecoverResult={handleRecoverResult}
          onCancelTask={handleCancelTask}
          pendingActionKeys={pendingActionKeys}
          showGenerationProgress={showGenerationProgress}
          persistentState={videoMemory || createDefaultVideoState()}
          onStateChange={setVideoMemory}
        />;
      case AppModuleObj.XHS_COVER:
        return <XhsCoverModule
          projects={filteredProjects}
          tasks={filteredTasks}
          subFeatures={MODULE_SUB_FEATURES[AppModuleObj.XHS_COVER]}
          activeSubFeature={activeSubFeature}
          onSubFeatureChange={handleSubFeatureChange}
          onDeleteResult={handleDeleteResult}
          onDeleteProject={handleDeleteProject}
          onRegenerateResult={handleRegenerateResult}
          onRecoverResult={handleRecoverResult}
          onCancelTask={handleCancelTask}
          pendingActionKeys={pendingActionKeys}
          showGenerationProgress={showGenerationProgress}
        />;
      default:
        return null;
    }
  })();

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      <div className="flex h-screen w-screen overflow-hidden" style={{ background: 'var(--bg-base)', transition: 'background var(--transition)' }}>
        <SidebarNavigation
          activeModule={pageMode === 'landing' ? 'landing' : pageMode === 'settings' ? AppModuleObj.SETTINGS : pageMode === 'account' ? AppModuleObj.ACCOUNT : activeModule}
          onModuleChange={handleModuleChange}
          theme={theme}
          onToggleTheme={toggleTheme}
          collapsed={sidebarCollapsed}
          onToggleCollapsed={() => setSidebarCollapsed((prev) => !prev)}
        />
        <div className="flex flex-1 flex-col min-w-0">
          <main className="flex-1 overflow-y-auto min-h-0">
            <Suspense fallback={
              <div className="flex h-full items-center justify-center" style={{ color: 'var(--text-tertiary)' }}>
                {hasHydratedSharedData ? '加载中...' : '正在同步本地后端数据...'}
              </div>
            }>
              {activeModuleView}
            </Suspense>
          </main>

          {pageMode === 'module' && activeModule !== AppModuleObj.AGENT_CENTER && (
            <Suspense fallback={null}>
              <BottomInputBar
                module={activeModule}
                activeSubFeature={activeSubFeature}
                promptText={promptText}
                onPromptChange={setScopedPromptText}
	                onGenerate={handleGenerate}
	                isGenerating={isGenerating}
	                isSubmitLocked={isCurrentGenerationSubmitLocked}
	                currentParams={currentParams}
                onParamChange={handleParamChange}
                materials={filteredMaterials}
                oneClickReferencePresets={oneClickReferencePresets}
                onUploadMaterial={handleMaterialUpload}
                onApplyPresetMaterials={handlePresetMaterialsApply}
                onUpdateMaterial={handleUpdateMaterial}
                onRemoveMaterial={handleRemoveMaterial}
                systemConfig={systemConfig}
                generationDisabledReason={
                  activeModule === AppModuleObj.VIDEO && activeSubFeature === 'generation' && !canUseVideoGenerationFeature(currentUser)
                    ? '短视频生成未开放'
                    : ''
                }
              />
            </Suspense>
          )}
        </div>
      </div>
    </ThemeContext.Provider>
  );
};

const App: React.FC = () => {
  const { theme, toggleTheme } = usePersistedTheme();
  const [authStatus, setAuthStatus] = useState<'checking' | 'logged_out' | 'logged_in'>(() => (
    typeof window !== 'undefined' && (
      new URLSearchParams(window.location.search).has('meiaoLocalPreview') || Boolean(getCurrentUserContext())
    ) ? 'logged_in' : 'logged_out'
  ));
  const [loginError, setLoginError] = useState('');
  const [isSubmittingLogin, setIsSubmittingLogin] = useState(false);

  useEffect(() => {
    let disposed = false;
    traceStartup('auth-bootstrap:start');
    void runAuthBootstrap()
      .then((result) => {
        if (!disposed) {
          if (result.user) storeCurrentUserContext(result.user);
          setAuthStatus(result.status);
        }
        traceStartup(`auth-bootstrap:end:${result.status}`);
      })
      .catch(() => {
        if (!disposed) setAuthStatus('logged_out');
        traceStartup('auth-bootstrap:error');
      });
    return () => {
      disposed = true;
    };
  }, []);

  const handleLogin = async (username: string, password: string) => {
    setIsSubmittingLogin(true);
    setLoginError('');
    try {
      const { token, user } = await loginInternalUser(username, password);
      storeSessionToken(token);
      storeCurrentUserContext(user);
      setAuthStatus('logged_in');
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : '登录失败');
    } finally {
      setIsSubmittingLogin(false);
    }
  };

  const handleLogout = async () => {
    try {
      void safeCreateInternalLog({
        level: 'info',
        module: 'account',
        action: 'logout_click',
        message: '点击退出登录',
        status: 'success',
      });
      await logoutInternalUser();
    } catch (error) {
      console.error('Failed to logout', error);
    } finally {
      clearSessionToken();
      clearCurrentUserContext();
      setAuthStatus('logged_out');
    }
  };

  if (authStatus === 'checking') {
    return (
      <div className="h-screen w-screen flex items-center justify-center" style={{ background: 'var(--bg-base)' }}>
        <div className="w-6 h-6 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: 'var(--text-tertiary)', borderTopColor: 'transparent' }} />
      </div>
    );
  }
  if (authStatus === 'logged_out') {
    return (
      <LoginScreen
        isSubmitting={isSubmittingLogin}
        error={loginError}
        theme={theme}
        onToggleTheme={toggleTheme}
        onLogin={handleLogin}
      />
    );
  }

  return (
    <ToastProvider>
      <AppContent theme={theme} toggleTheme={toggleTheme} onLogout={handleLogout} />
    </ToastProvider>
  );
};

export default App;
