import type {
  AppModule,
  InternalJob,
  ProductRestoreCancellationMarker,
  ProductRestoreCancellationReset,
  ProductRestoreAnalysisAttempt,
  ProductRestoreProjectContext,
  SubtitleRemovalPixels,
  SubtitleRemovalRegion,
  VideoStoryboardBoard,
  VideoStoryboardConfig,
  VideoStoryboardProject,
} from '../types.ts';
import type { PersistedAppState } from '../utils/appState.ts';
import { parseStoryboardPlanningResult } from '../utils/videoStoryboardPlanning.ts';
import {
  applyStoryboardBoardResult,
  deriveStoryboardProjectStatus,
  toStoryboardShellResultStatus,
} from '../shell/modules/Video/storyboardGenerationState.mjs';
import { getOneClickPlanContent, isInvalidOneClickPlanLike, isInvalidOneClickPlanText } from '../utils/oneClickPlanValidation.ts';
import { coerceCreatedAtMs } from '../utils/createdAtMs.ts';
import {
  getProductRestoreExpectedTargetCount,
  getProductRestoreTargetKey,
  hasMissingProductRestoreTargets,
} from '../utils/taskResultReconcile.mjs';
import {
  cloneProductRestoreCancellationMarker,
  cloneProductRestoreCancellationReset,
  hasDurableProductRestoreCancellation,
  mergeProductRestoreGenerationContext,
} from './shellProductRestoreCancellation.mjs';
import {
  cloneProductRestoreAnalysisAttempts,
  normalizeKnownProductRestoreCredits,
} from '../utils/productRestoreAnalysisCredits.ts';
import {
  getVisibleProviderTaskId,
  isShellControlJob,
  shouldExposeActiveJobResult,
} from './shellJobVisibility.ts';
import {
  buildFailedPlanningResult,
  hasConcretePlanningRecoveryResult,
  isStalePlanningFailureResult,
} from './shellPlanningRecovery.ts';
import {
  buildFailedOneClickPlanningPlan,
  getPlanningProviderTaskId,
  getPlanningReferenceIndex,
} from './shellPlanningFailure.ts';
import { hasPersistedTerminalJobResult } from './shellTerminalJobMerge.ts';

type ShellProjectStatus = 'planning' | 'generating' | 'completed' | 'error';
type ShellTaskStatus = 'pending' | 'generating' | 'completed' | 'error' | 'retry_waiting';
type DurableStoryboardBoard = VideoStoryboardBoard & { backendJobId?: string };
type DurableStoryboardProject = Omit<VideoStoryboardProject, 'boards'> & {
  boards: DurableStoryboardBoard[];
  planningJobId?: string;
  backendJobId?: string;
};

export interface ShellGeneratedResult {
  id: string;
  planId?: string;
  projectId?: string;
  imageUrl: string;
  videoUrl?: string;
  mediaType?: 'image' | 'video';
  prompt: string;
  model?: string;
  aspectRatio: string;
  status: 'completed' | 'generating' | 'error' | 'retry_waiting';
  createdAt: number;
  module: AppModule;
  subFeature?: string;
  sourceUrl?: string;
  sourcePreviewUrl?: string;
  fileName?: string;
  relativePath?: string;
  taskId?: string;
  backendJobId?: string;
  shellResultId?: string;
  batchId?: string;
  batchIndex?: number;
  batchCount?: number;
  targetMaterialId?: string;
  creditsConsumed?: number;
  error?: string;
  errorCode?: string;
  /** 技术原文(errorMessage 人话之外的原始报错),只读透传,仅"技术详情"展示用 */
  errorDetail?: string;
  matchedAspectRatio?: string;
  originalWidth?: number;
  originalHeight?: number;
  buyerShowEvaluation?: string;
  buyerShowDisplayPrompt?: string;
  logoReplaceGuarded?: boolean;
  sourceProjectId?: string;
  sourceResultId?: string;
  subtitleRegionNormalized?: SubtitleRemovalRegion;
  subtitleRegionPixels?: SubtitleRemovalPixels;
}

export interface ShellProjectData {
  id: string;
  name: string;
  module: AppModule;
  status: ShellProjectStatus;
  createdAt: number;
  completedAt?: number;
  createdAtPrecise?: boolean;
  results: ShellGeneratedResult[];
  taskCount: number;
  completedCount: number;
  subFeature?: string;
  sourceType?: 'persisted' | 'job';
  backendJobId?: string;
  creditsConsumed?: number;
  planningTaskId?: string;
  error?: string;
  errorCode?: string;
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
    status?: 'error';
    error?: string;
    planningFailed?: boolean;
  }>;
  selectedPlanId?: string;
  generationContext?: {
    prompt: string;
    params: Record<string, string>;
    materials: Record<string, ShellMaterialData[]>;
    productRestore?: ProductRestoreProjectContext;
    productRestoreAnalysisAttempts?: ProductRestoreAnalysisAttempt[];
    productRestoreCancellation?: ProductRestoreCancellationMarker;
    productRestoreCancellationReset?: ProductRestoreCancellationReset;
  };
  directGeneration?: boolean;
  storyboardProjectStatus?: VideoStoryboardProject['status'];
  storyboardSourceProject?: DurableStoryboardProject;
}

export interface ShellTaskData {
  id: string;
  projectId: string;
  module: AppModule;
  type: 'image' | 'video' | 'plan' | 'batch';
  status: ShellTaskStatus;
  title: string;
  progress?: number;
  createdAt: number;
  total?: number;
  completed?: number;
  subFeature?: string;
  backendJobId?: string;
  storyboardBoardId?: string;
  prompt?: string;
}

export interface ShellMaterialData {
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
}

const cloneProductRestoreAnalysis = (
  analysis: ProductRestoreProjectContext['normalizedAnalysis'],
): ProductRestoreProjectContext['normalizedAnalysis'] => ({
  ...analysis,
  invariantFeatures: [...analysis.invariantFeatures],
  shapeAndStructure: [...analysis.shapeAndStructure],
  proportionAndContour: [...analysis.proportionAndContour],
  materialAndTexture: [...analysis.materialAndTexture],
  colorAndGloss: [...analysis.colorAndGloss],
  logoLabelAndText: [...analysis.logoLabelAndText],
  componentsAndCraft: [...analysis.componentsAndCraft],
  targetSetIssues: [...analysis.targetSetIssues],
  nonProductPreservationRules: [...analysis.nonProductPreservationRules],
});

const cloneGenerationContext = (
  context?: ShellProjectData['generationContext'],
): ShellProjectData['generationContext'] => {
  if (!context) return undefined;
  const cloned: NonNullable<ShellProjectData['generationContext']> = {
    ...context,
    params: { ...context.params },
    materials: Object.fromEntries(
      Object.entries(context.materials || {}).map(([type, items]) => [
        type,
        (items || []).map((item) => ({ ...item })),
      ]),
    ),
    productRestore: context.productRestore
      ? {
          ...context.productRestore,
          focusIds: [...context.productRestore.focusIds],
          targetMaterialIds: [...context.productRestore.targetMaterialIds],
          productReferenceMaterialIds: [...context.productRestore.productReferenceMaterialIds],
          normalizedAnalysis: cloneProductRestoreAnalysis(context.productRestore.normalizedAnalysis),
        }
      : undefined,
  };
  if (Object.prototype.hasOwnProperty.call(context, 'productRestoreAnalysisAttempts')) {
    cloned.productRestoreAnalysisAttempts = cloneProductRestoreAnalysisAttempts(
      context.productRestoreAnalysisAttempts,
    );
  }
  if (Object.prototype.hasOwnProperty.call(context, 'productRestoreCancellation')) {
    cloned.productRestoreCancellation = cloneProductRestoreCancellationMarker(
      context.productRestoreCancellation,
    );
  }
  if (Object.prototype.hasOwnProperty.call(context, 'productRestoreCancellationReset')) {
    cloned.productRestoreCancellationReset = cloneProductRestoreCancellationReset(
      context.productRestoreCancellationReset,
    );
  }
  return cloned;
};

export interface ShellDataSnapshot {
  projects: ShellProjectData[];
  tasks: ShellTaskData[];
  materials: Record<string, ShellMaterialData[]>;
}

const MODULE_LABELS: Record<string, string> = {
  one_click: '一键主详',
  translation: '出海翻译',
  buyer_show: '买家秀',
  retouch: '图片升级',
  everything_replace: '万物替换',
  video: '短视频',
  xhs_cover: '小红书封面',
  image_crop: '图片裁切',
  agent_center: '智能体中心',
};

export { MODULE_LABELS as SHELL_MODULE_LABELS };

const MODULE_VALUES = {
  ONE_CLICK: 'one_click' as AppModule,
  TRANSLATION: 'translation' as AppModule,
  BUYER_SHOW: 'buyer_show' as AppModule,
  RETOUCH: 'retouch' as AppModule,
  EVERYTHING_REPLACE: 'everything_replace' as AppModule,
  VIDEO: 'video' as AppModule,
  XHS_COVER: 'xhs_cover' as AppModule,
  IMAGE_CROP: 'image_crop' as AppModule,
  AGENT_CENTER: 'agent_center' as AppModule,
};

const VALID_MODULES = new Set(Object.values(MODULE_VALUES));
const persistedSnapshotCache = new WeakMap<object, Pick<ShellDataSnapshot, 'projects' | 'materials'>>();

const normalizeCreditsConsumed = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
};

type ProductRestoreRecordIdentity = {
  module?: unknown;
  subFeature?: unknown;
};

const isProductRestoreRecord = (
  project: ProductRestoreRecordIdentity,
  result?: ProductRestoreRecordIdentity,
) => (
  String(result?.module || project?.module || '').trim() === 'retouch'
  && String(result?.subFeature || project?.subFeature || '').trim() === 'product_restore'
);

const ONE_CLICK_SUBFEATURES: Record<string, string> = {
  '首图': 'first_image',
  '主图': 'main_image',
  '详情页': 'detail_page',
  SKU: 'sku',
};

const ONE_CLICK_SUBFEATURE_LABELS: Record<string, string> = {
  first_image: '首图',
  main_image: '主图',
  detail_page: '详情页',
  sku: 'SKU',
  legacy_unassigned: '未归类',
};

const TRANSLATION_SUBFEATURE_LABELS: Record<string, string> = {
  main: '主图出海',
  detail: '详情出海',
  remove_text: '去字翻译',
};

const moduleTaskLabel = (module: AppModule, subFeature?: string, taskType?: unknown) => {
  if (module === MODULE_VALUES.ONE_CLICK) return `${ONE_CLICK_SUBFEATURE_LABELS[subFeature || ''] || '一键主详'}任务`;
  if (module === MODULE_VALUES.TRANSLATION) return `${TRANSLATION_SUBFEATURE_LABELS[subFeature || ''] || '出海翻译'}任务`;
  if (module === MODULE_VALUES.VIDEO) {
    if (subFeature === 'subtitle_removal') return '去字幕任务';
    if (subFeature === 'storyboard') return '分镜任务';
    if (subFeature === 'diagnosis') return '诊断任务';
    return '短视频任务';
  }
  return `${MODULE_LABELS[module] || String(taskType || '生成')}任务`;
};

const jobTaskTitle = (job: InternalJob, module: AppModule, subFeature?: string) => {
  const label = moduleTaskLabel(module, subFeature, job.taskType);
  const jobId = String(job.id || '').trim();
  return jobId ? `${label} ${jobId.slice(-6)}` : label;
};

const TRANSLATION_SUBFEATURES: Record<string, string> = {
  main: 'main',
  detail: 'detail',
  removeText: 'remove_text',
  remove_text: 'remove_text',
};

// 把 job 的时间字段取成规范毫秒戳(无有效值则退当前时刻)。展示由渲染层 formatMonthDay 负责。
const toCreatedMs = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : Date.now();
};

const toModule = (value: unknown): AppModule => {
  const raw = String(value || '').trim();
  return VALID_MODULES.has(raw as AppModule) ? raw as AppModule : MODULE_VALUES.AGENT_CENTER;
};

const taskStatusToProject = (status: unknown): ShellProjectStatus => {
  if (status === 'completed' || status === 'succeeded') return 'completed';
  if (status === 'error' || status === 'failed' || status === 'cancelled' || status === 'interrupted') return 'error';
  if (status === 'pending' || status === 'queued' || status === 'running' || status === 'retry_waiting' || status === 'generating' || status === 'processing' || status === 'uploading') return 'generating';
  return 'planning';
};

const taskStatusToTask = (status: unknown): ShellTaskStatus => {
  if (status === 'completed' || status === 'succeeded') return 'completed';
  if (status === 'error' || status === 'failed' || status === 'cancelled' || status === 'interrupted') return 'error';
  if (status === 'pending' || status === 'queued') return 'pending';
  if (status === 'retry_waiting') return 'retry_waiting';
  return 'generating';
};

const PROVIDER_POLLUTION_TEXT_PATTERNS = [
  /file mime type is not supported/i,
  /image download failed/i,
  /http 404:\s*not found/i,
  /failed\s+to\s+get\s+(?:the\s+)?file\s+information/i,
  /please convert or change the file/i,
  /unauthorized\s*[\u2013-]\s*authentication failed/i,
  /authentication failed\.?\s*please check/i,
  /server exception,\s*please try again later/i,
  /server is currently being maintained/i,
  /interal\s+error/i,
  /internal\s+error/i,
  /internal\s+server\s+error/i,
  /internal\s+error,\s*please try again later/i,
  /\bhttp\s*(?:500|502|503|504)\b/i,
  /bad\s+gateway/i,
  /gateway\s+timeout/i,
  /service\s+unavailable/i,
  /upstream\s+error/i,
  /server\s+error/i,
];

const isProviderPollutionTextCore = (value: unknown) => {
  const text = String(value || '').trim();
  if (!text) return false;
  return PROVIDER_POLLUTION_TEXT_PATTERNS.some((pattern) => pattern.test(text))
    || (
      text.length <= 80
      && /error|http\s*5\d\d|bad gateway|unavailable/i.test(text)
      && !text.includes('{')
      && !text.includes('[')
    );
};

const getProviderErrorText = (job: any): string => {
  const text = String(
    job?.errorMessage
    || job?.result?.content
    || job?.result?.text
    || job?.result?.message
    || ''
  ).trim();
  if (!text) return '';
  return isProviderPollutionTextCore(text) ? text : '';
};

const getResultUrls = (item: any): string[] => {
  const values: unknown[] = [];
  const push = (value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach(push);
      return;
    }
    values.push(value);
  };
  push(item?.resultUrl);
  push(item?.imageUrl);
  push(item?.videoUrl);
  push(item?.url);
  push(item?.resultUrls);
  push(item?.imageResultUrls);
  push(item?.videoResultUrls);
  push(item?.outputUrls);
  push(item?.result?.resultUrl);
  push(item?.result?.imageUrl);
  push(item?.result?.videoUrl);
  push(item?.result?.url);
  push(item?.result?.resultUrls);
  push(item?.result?.imageResultUrls);
  push(item?.result?.videoResultUrls);
  push(item?.result?.outputUrls);

  const unique = new Set<string>();
  values.forEach((value) => {
    const url = String(value || '').trim();
    if (url) unique.add(url);
  });
  return Array.from(unique);
};

const getResultUrl = (item: any) => getResultUrls(item)[0] || '';

const getVisibleTaskId = (item: any) => String(
  item?.taskId
  || item?.providerTaskId
  || item?.kieTaskId
  || item?.result?.providerTaskId
  || ''
).trim() || undefined;

const isPlanningGeneratedPlanId = (value: unknown) => /^[a-f0-9]{24}-plan-\d+$/i.test(String(value || '').trim());

const splitIdentityText = (value: unknown) =>
  String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

const INTERNAL_BACKEND_JOB_ID_PATTERN = /^[a-f0-9]{24}$/i;

const latestProviderTaskIdentityText = (...values: unknown[]) => {
  const merged = Array.from(new Set(
    values
      .flatMap((value) => splitIdentityText(value))
      .filter((item) => !INTERNAL_BACKEND_JOB_ID_PATTERN.test(item)),
  ));
  return merged.at(-1) || undefined;
};

const collectPersistedProjectJobKeys = (projects: ShellProjectData[] = []) => {
  const keys = new Set<string>();
  projects.forEach((project) => {
    const projectId = String(project?.id || '').trim();
    const backendJobId = String(project?.backendJobId || '').trim();
    if (projectId) keys.add(`project:${projectId}`);
    if (backendJobId) keys.add(`job:${backendJobId}`);
    splitIdentityText(project?.planningTaskId).forEach((planningTaskId) => keys.add(`provider:${planningTaskId}`));
    (Array.isArray(project?.results) ? project.results : []).forEach((result: any) => {
      const resultId = String(result?.id || '').trim();
      const visibleTaskId = getVisibleTaskId(result);
      const resultBackendJobId = String(result?.backendJobId || '').trim();
      if (resultId) keys.add(`result:${resultId}`);
      if (visibleTaskId) keys.add(`provider:${visibleTaskId}`);
      if (resultBackendJobId) keys.add(`job:${resultBackendJobId}`);
    });
  });
  return keys;
};

const isJobAlreadyPersisted = (job: InternalJob, keys: Set<string>) => {
  const jobId = String(job?.id || '').trim();
  const projectId = jobId ? `job-${jobId}` : '';
  const providerTaskId = String(job?.providerTaskId || (job?.result as any)?.providerTaskId || '').trim();
  return Boolean(
    (jobId && keys.has(`job:${jobId}`))
    || (projectId && keys.has(`project:${projectId}`))
    || (providerTaskId && keys.has(`provider:${providerTaskId}`))
  );
};

const findPersistedPlanningProjectForJob = (job: InternalJob, projects: ShellProjectData[] = []) => {
  const jobId = String(job?.id || '').trim();
  const providerTaskId = String(job?.providerTaskId || (job?.result as any)?.providerTaskId || '').trim();
  const payloadProjectId = String(
    (job?.payload as any)?.shellProjectId
    || (job?.payload as any)?.projectId
    || (job?.payload as any)?.clientProjectId
    || ''
  ).trim();
  const syntheticProjectId = jobId ? `job-${jobId}` : '';
  const directMatch = projects.find((project) => {
    const projectIds = [
      project?.id,
      project?.backendJobId,
      ...splitIdentityText(project?.planningTaskId),
      ...(Array.isArray(project?.results) ? project.results.flatMap((result: any) => [
        result?.backendJobId,
        result?.taskId,
        result?.id,
      ]) : []),
    ].map((value) => String(value || '').trim()).filter(Boolean);
    if (payloadProjectId && projectIds.includes(payloadProjectId)) return true;
    if (syntheticProjectId && projectIds.includes(syntheticProjectId)) return true;
    if (jobId && projectIds.includes(jobId)) return true;
    if (providerTaskId && projectIds.includes(providerTaskId)) return true;
    return false;
  });
  if (directMatch) return directMatch;

  const payloadSchemeContent = String((job?.payload as any)?.schemeContent || '').trim();
  if (
    String(job?.module || '') === MODULE_VALUES.ONE_CLICK
    && String(job?.taskType || '').includes('image')
    && payloadSchemeContent
  ) {
    const payloadSubFeature = getStructuredOneClickJobSubFeature(job.payload)
      || normalizeJobSubFeature(MODULE_VALUES.ONE_CLICK, job.taskType, job.payload);
    const candidates = projects.filter((project) => {
      if (project.module !== MODULE_VALUES.ONE_CLICK) return false;
      if (project.status === 'completed' || (project.results || []).length > 0 || Number(project.completedCount || 0) > 0) return false;
      if (payloadSubFeature && project.subFeature && project.subFeature !== payloadSubFeature) return false;
      return (project.plans || []).some((plan) => String(plan.schemeContent || '').trim() === payloadSchemeContent);
    });
    const uniqueCandidates = new Map(candidates.map((project) => [project.id, project]));
    if (uniqueCandidates.size === 1) return Array.from(uniqueCandidates.values())[0];
  }
};

const extractTimestampFromProjectId = (value: unknown) => {
  const matches = String(value || '').match(/\d{13}/g) || [];
  const timestamps = matches
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item) && item > 1_600_000_000_000);
  return timestamps[0] || 0;
};

const findPersistedStoryboardPlanningProjectForJob = (job: InternalJob, projects: ShellProjectData[] = []) => {
  const directMatch = findPersistedPlanningProjectForJob(job, projects);
  if (directMatch?.module === MODULE_VALUES.VIDEO && directMatch.subFeature === 'storyboard') return directMatch;

  const jobCreatedAt = Number(job?.createdAt || job?.updatedAt || job?.finishedAt || 0);
  if (!Number.isFinite(jobCreatedAt) || jobCreatedAt <= 0) return undefined;
  const jobTaskId = String(job?.providerTaskId || (job?.result as any)?.providerTaskId || '').trim();
  const candidates = projects
    .filter((project) => {
      if (project.module !== MODULE_VALUES.VIDEO || project.subFeature !== 'storyboard') return false;
      if (jobTaskId && splitIdentityText(project.planningTaskId).includes(jobTaskId)) return true;
      const projectTimestamp = extractTimestampFromProjectId(project.id);
      if (!projectTimestamp) return false;
      return Math.abs(jobCreatedAt - projectTimestamp) <= 10 * 60 * 1000;
    })
    .map((project) => ({
      project,
      distance: Math.abs(jobCreatedAt - extractTimestampFromProjectId(project.id)),
    }))
    .sort((a, b) => a.distance - b.distance);
  return candidates[0]?.project;
};

const LEGACY_MODEL_PLACEHOLDERS = new Set(['旧任务', '生成任务', '策划任务']);

const normalizeModel = (raw: unknown): string | undefined => {
  if (raw == null) return undefined;
  const text = String(raw).trim();
  if (!text) return undefined;
  if (LEGACY_MODEL_PLACEHOLDERS.has(text)) return undefined;
  return text;
};

const getPrompt = (item: any, fallback: string, module?: AppModule) => {
  if (module === MODULE_VALUES.ONE_CLICK) {
    return String(
      item?.editedContent
      || item?.originalContent
      || item?.prompt
      || item?.styleDescription
      || item?.content
      || item?.promptText
      || item?.title
      || item?.payload?.prompt
      || item?.payload?.content
      || item?.payload?.promptText
      || item?.payload?.script
      || item?.result?.content
      || item?.result?.text
      || fallback
      || ''
    ).trim();
  }
  return String(
    item?.prompt
    || item?.editedContent
    || item?.originalContent
    || item?.styleDescription
    || item?.content
    || item?.promptText
    || item?.title
    || item?.payload?.prompt
    || item?.payload?.content
    || item?.payload?.promptText
    || item?.payload?.script
    || item?.result?.content
    || item?.result?.text
    || fallback
    || ''
  ).trim();
};

const schemeToPlan = (scheme: any, index: number) => {
  const title = String(scheme?.uiTitle || scheme?.title || `方案 ${index + 1}`).trim();
  const schemeContent = String(scheme?.editedContent || scheme?.originalContent || '').trim();
  return {
    id: String(scheme?.id || `plan-${index}`),
    title,
    sellingPoints: title ? [title] : [],
    sceneDescription: '',
    styleDirection: '',
    colorPalette: '',
    composition: '',
    textLayout: schemeContent,
    selected: scheme?.selected !== false,
    schemeContent,
    sourceReferenceUrl: String(scheme?.sourceReferenceUrl || '').trim() || undefined,
    variationMode: scheme?.variationMode,
    variationInstruction: String(scheme?.variationInstruction || '').trim() || undefined,
    sourceResultUrl: String(scheme?.sourceResultUrl || '').trim() || undefined,
  };
};

const extractSchemeField = (scheme: string, labels: string[]) => {
  for (const label of labels) {
    const match = scheme.match(new RegExp(`(?:^|\\n)\\s*-?\\s*${label}\\s*[:：]\\s*([^\\n]+)`));
    if (match?.[1]) return match[1].trim();
  }
  return '';
};

const parseOneClickPlanningText = (text: unknown, jobId: string): ShellProjectData['plans'] => {
  const content = String(text || '').trim();
  if (!content) return [];
  const matches = Array.from(content.matchAll(/\[SCHEME_START\]([\s\S]*?)\[SCHEME_END\]/g));
  const schemes = matches.length > 0 ? matches.map((match) => match[1]?.trim() || '').filter(Boolean) : [content];
  return schemes.map((scheme, index) => {
    const title = extractSchemeField(scheme, ['屏序/类型', 'SKU标识', '参考图标识']) || `策划方案 ${index + 1}`;
    const designIntent = extractSchemeField(scheme, ['设计意图']);
    const visualStyle = extractSchemeField(scheme, ['画面风格', '视觉风格']);
    const sceneDescription = extractSchemeField(scheme, ['画面描述', '场景描述']) || scheme.slice(0, 160);
    const ratio = extractSchemeField(scheme, ['画面比例', '比例']);
    return {
      id: `${jobId}-plan-${index + 1}`,
      title,
      sellingPoints: [designIntent || visualStyle || title].filter(Boolean),
      sceneDescription,
      styleDirection: visualStyle || designIntent,
      colorPalette: extractSchemeField(scheme, ['配色', '色调', '画面比例']) || ratio,
      composition: extractSchemeField(scheme, ['构图', '版式', '排版']) || ratio,
      textLayout: extractSchemeField(scheme, ['文案内容排版', '文案排版']) || scheme,
      selected: true,
      schemeContent: scheme,
    };
  }).filter((plan) => !isInvalidOneClickPlanLike(plan));
};

const normalizePayloadStringList = (value: unknown) => {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || '').trim()).filter(Boolean);
  }
  return String(value || '')
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
};

const getPlanningReferenceUrls = (payload: any) => {
  const urls = normalizePayloadStringList(payload?.shellReferenceUrls);
  if (urls.length > 0) return urls;
  return normalizePayloadStringList(payload?.shellReferenceUrl);
};

const isDetailPageSetReplicationPlanningPayload = (payload: any) => (
  String(payload?.shellPlanningMode || '').trim() === 'detail_page_set_replication_all_at_once'
  || (
    String(payload?.subFeature || '').trim() === 'detail_page'
    && getPlanningReferenceUrls(payload).length > 1
  )
);

const buildRecoveredDetailPagePlan = (jobId: string, index: number, sourceReferenceUrl = '') => {
  const title = `第${index + 1}屏-复刻详情页参考${index + 1}`;
  const schemeContent = [
    `- 屏序/类型：${title}`,
    `- 参考图标识：详情页套图参考${index + 1}`,
    '- 设计意图：后台策划结果未返回本屏完整方案，按对应详情页参考图继续复刻商品替换、卖点承接和版式骨架',
    '- 画面描述：用我方真实商品替换对应参考图原商品区，保持该参考图的整体风格、版式结构、信息层级、视觉节奏、图文关系和留白边距；删除参考图原品牌、店铺、平台标识和原文案，并按整套详情页逻辑替换为我方商品卖点。',
    '- 画面比例：auto',
  ].join('\n');
  return {
    id: `${jobId}-plan-${index + 1}`,
    title,
    sellingPoints: ['后台缺失方案补齐'],
    sceneDescription: '后台策划结果缺少本屏完整方案，已按对应参考图补齐可执行复刻计划。',
    styleDirection: '复刻对应详情页参考图',
    colorPalette: 'auto',
    composition: 'auto',
    textLayout: schemeContent,
    selected: true,
    schemeContent,
    sourceReferenceUrl: sourceReferenceUrl || undefined,
  };
};

const backfillDetailPageSetReplicationPlans = (
  plans: ShellProjectData['plans'] = [],
  jobId: string,
  payload: any,
) => {
  if (!isDetailPageSetReplicationPlanningPayload(payload)) return plans;
  const referenceUrls = getPlanningReferenceUrls(payload);
  const expectedCount = Math.max(
    referenceUrls.length,
    Number.parseInt(String(payload?.shellReferenceCount || ''), 10) || 0,
    plans.length,
  );
  if (expectedCount <= plans.length) return plans;
  const nextPlans = [...plans];
  for (let index = plans.length; index < expectedCount; index += 1) {
    nextPlans.push(buildRecoveredDetailPagePlan(jobId, index, referenceUrls[index] || ''));
  }
  return nextPlans;
};

const attachReferenceUrlToPlans = (
  plans: ShellProjectData['plans'] = [],
  sourceReferenceUrl: unknown,
) => {
  const referenceUrls = normalizePayloadStringList(sourceReferenceUrl);
  if (referenceUrls.length === 0) return plans;
  return plans.map((plan, index) => ({
    ...plan,
    sourceReferenceUrl: plan.sourceReferenceUrl || referenceUrls[index] || referenceUrls[0],
  }));
};

const getOneClickProjectPromptFallback = (project: any) => {
  const config = project?.config || {};
  const configLines = [
    config.description,
    config.productInfo,
    config.planningLogic,
    config.logicInfo,
  ];
  const directionLines = Array.isArray(project?.directions) ? project.directions : [];
  const combinationLines = Array.isArray(config.combinations)
    ? config.combinations.map((item: any, index: number) => [
        `SKU${index + 1}`,
        item?.sceneDescription,
        item?.skuCopyText,
      ].filter(Boolean).join('：'))
    : [];
  return [...configLines, ...directionLines, ...combinationLines]
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .join('\n');
};

const normalizeJobSubFeature = (module: AppModule, taskType: unknown, payload: Record<string, unknown> = {}) => {
  const promptText = String(payload.prompt || '').trim();
  const promptSubFeature = promptText.match(/子功能[:：]\s*([a-zA-Z0-9_\-\u4e00-\u9fa5]+)/)?.[1] || '';
  const promptHints = [
    promptSubFeature,
    promptText,
    String((payload.videoConfig as any)?.script || ''),
    String((payload.videoConfig as any)?.requirements || ''),
  ].filter(Boolean).join('\n');
  const raw = String(
    payload.subFeature
    || payload.subMode
    || payload.mode
    || (payload.videoConfig as any)?.subFeature
    || (payload.videoConfig as any)?.mode
    || promptSubFeature
    || taskType
    || ''
  ).trim();
  const searchable = `${raw}\n${promptHints}`;
  if (module === MODULE_VALUES.ONE_CLICK) {
    const normalized = ONE_CLICK_SUBFEATURES[raw] || raw;
    if (['first_image', 'main_image', 'detail_page', 'sku'].includes(normalized)) return normalized;
    if (searchable.includes('首图') || searchable.includes('first_image') || searchable.includes('first')) return 'first_image';
    if (searchable.includes('详情页') || searchable.includes('detail_page') || searchable.includes('detail')) return 'detail_page';
    if (searchable.toLowerCase().includes('sku')) return 'sku';
    if (searchable.includes('主图') || searchable.includes('main_image')) return 'main_image';
    return 'legacy_unassigned';
  }
  if (module === MODULE_VALUES.TRANSLATION) {
    const normalized = TRANSLATION_SUBFEATURES[raw] || raw;
    if (['main', 'detail', 'remove_text'].includes(normalized)) return normalized;
    if (raw.includes('detail')) return 'detail';
    if (raw.includes('remove')) return 'remove_text';
    return 'main';
  }
  if (module === MODULE_VALUES.RETOUCH) {
    if (raw.includes('white') || raw.includes('白底')) return 'white_bg';
    if (raw.includes('background') || raw.includes('背景')) return 'background_replace';
    return 'original';
  }
  if (module === MODULE_VALUES.EVERYTHING_REPLACE) {
    if (raw.includes('background') || raw.includes('背景')) return 'background_replace';
    if (raw.includes('logo') || raw.includes('Logo')) return 'logo_replace';
    return 'product_replace';
  }
  if (module === MODULE_VALUES.VIDEO) {
    if (raw.includes('subtitle_removal') || raw.includes('subtitle_remove_video') || raw.includes('去字幕')) return 'subtitle_removal';
    if (raw.includes('diagnosis') || raw.includes('诊断')) return 'diagnosis';
    if (raw.includes('storyboard') || raw.includes('分镜')) return 'storyboard';
    return 'generation';
  }
  if (module === MODULE_VALUES.BUYER_SHOW) return raw.includes('copy') || raw.includes('文案') ? 'copy' : 'image';
  if (module === MODULE_VALUES.XHS_COVER) return 'cover';
  return raw || 'default';
};

const getStructuredOneClickJobSubFeature = (payload: Record<string, unknown> = {}) => {
  const raw = String(payload.subFeature || payload.subMode || payload.mode || '').trim();
  const normalized = ONE_CLICK_SUBFEATURES[raw] || raw;
  return ['first_image', 'main_image', 'detail_page', 'sku'].includes(normalized) ? normalized : '';
};

const getOneClickItemSubFeature = (item: any, fallbackSubFeature: string) => {
  const raw = String(item?.subFeature || item?.subMode || item?.mode || '').trim();
  const normalized = ONE_CLICK_SUBFEATURES[raw] || raw;
  if (normalized && normalized !== 'legacy_unassigned') return normalized;
  return fallbackSubFeature || 'legacy_unassigned';
};

const toSubtitleRemovalRegion = (value: unknown): SubtitleRemovalRegion | undefined => {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  const region = {
    x: Number(record.x),
    y: Number(record.y),
    width: Number(record.width),
    height: Number(record.height),
  };
  return Object.values(region).every(Number.isFinite) ? region : undefined;
};

const toSubtitleRemovalPixels = (value: unknown): SubtitleRemovalPixels | undefined => {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  const pixels = {
    x1: Number(record.x1),
    y1: Number(record.y1),
    x2: Number(record.x2),
    y2: Number(record.y2),
  };
  return Object.values(pixels).every(Number.isFinite) ? pixels : undefined;
};

const toOptionalInteger = (value: unknown) => {
  if (value == null || value === '') return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : undefined;
};

const getSubtitleRemovalResultMetadata = (value: unknown) => {
  const item = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const payload = item.payload && typeof item.payload === 'object' ? item.payload as Record<string, unknown> : {};
  const result = item.result && typeof item.result === 'object' ? item.result as Record<string, unknown> : {};
  const sourceUrl = String(item.sourceUrl || result.sourceUrl || payload.sourceUrl || '').trim() || undefined;
  return {
    shellResultId: String(item.shellResultId || result.shellResultId || payload.shellResultId || '').trim() || undefined,
    batchId: String(item.batchId || result.batchId || payload.batchId || '').trim() || undefined,
    batchIndex: toOptionalInteger(item.batchIndex ?? result.batchIndex ?? payload.batchIndex),
    batchCount: toOptionalInteger(item.batchCount ?? result.batchCount ?? payload.batchCount),
    sourceUrl,
    sourcePreviewUrl: String(item.sourcePreviewUrl || sourceUrl || '').trim() || undefined,
    sourceProjectId: String(item.sourceProjectId || result.sourceProjectId || payload.sourceProjectId || '').trim() || undefined,
    sourceResultId: String(item.sourceResultId || result.sourceResultId || payload.sourceResultId || '').trim() || undefined,
    subtitleRegionNormalized: toSubtitleRemovalRegion(
      item.subtitleRegionNormalized || result.subtitleRegionNormalized || payload.subtitleRegionNormalized,
    ),
    subtitleRegionPixels: toSubtitleRemovalPixels(
      item.subtitleRegionPixels || result.subtitleRegionPixels || payload.subtitleRegionPixels,
    ),
  };
};

const isSubtitleRemovalJob = (job: InternalJob, module = toModule(job?.module)) => (
  module === MODULE_VALUES.VIDEO
  && (
    String(job?.taskType || '').trim() === 'subtitle_remove_video'
    || String(job?.payload?.subFeature || '').trim() === 'subtitle_removal'
    || String(job?.payload?.taskPurpose || '').trim() === 'subtitle_removal'
  )
);

const resultFromItem = (
  item: any,
  module: AppModule,
  fallbackTitle: string,
  createdAt: number,
  subFeature?: string,
  fallbackPrompt?: string,
): ShellGeneratedResult | null => {
  const url = getResultUrl(item);
  const status = taskStatusToTask(item?.status);
  if (!url && status !== 'error') return null;
  const mediaType = module === MODULE_VALUES.VIDEO || Boolean(item?.videoUrl || item?.result?.videoUrl) ? 'video' : 'image';
  const subtitleRemovalMetadata = getSubtitleRemovalResultMetadata(item);
  return {
    id: String(subtitleRemovalMetadata.shellResultId || item?.id || item?.taskId || `${module}-${fallbackTitle}-${createdAt}`),
    planId: module === MODULE_VALUES.ONE_CLICK
      ? String(item?.planId || item?.id || '').trim() || undefined
      : String(item?.planId || '').trim() || undefined,
    projectId: item?.projectId ? String(item.projectId) : undefined,
    imageUrl: url,
    videoUrl: mediaType === 'video' ? url : undefined,
    mediaType,
    prompt: getPrompt(item, fallbackPrompt || fallbackTitle, module),
    model: normalizeModel(item?.model || item?.payload?.model),
    aspectRatio: String(item?.matchedAspectRatio || item?.aspectRatio || item?.payload?.aspectRatio || item?.payload?.ratio || 'auto'),
    status: status === 'completed' ? 'completed' : status === 'error' ? 'error' : status === 'retry_waiting' ? 'retry_waiting' : 'generating',
    createdAt,
    module,
    subFeature,
    ...subtitleRemovalMetadata,
    fileName: String(item?.fileName || '').trim() || undefined,
    relativePath: String(item?.relativePath || item?.fileName || '').trim() || undefined,
    taskId: getVisibleTaskId(item),
    backendJobId: String(item?.backendJobId || item?.jobId || '').trim() || undefined,
    batchIndex: subtitleRemovalMetadata.batchIndex ?? toOptionalInteger(item?.batchIndex ?? item?.payload?.batchIndex),
    targetMaterialId: String(item?.targetMaterialId || item?.payload?.targetMaterialId || '').trim() || undefined,
    creditsConsumed: normalizeCreditsConsumed(item?.creditsConsumed || item?.result?.creditsConsumed),
    error: String(item?.error || '').trim() || undefined,
    matchedAspectRatio: String(item?.matchedAspectRatio || item?.aspectRatio || item?.payload?.aspectRatio || item?.payload?.ratio || 'auto'),
    originalWidth: Number(item?.originalWidth || item?.payload?.finalSize?.width || 0) || undefined,
    originalHeight: Number(item?.originalHeight || item?.payload?.finalSize?.height || 0) || undefined,
  };
};

const projectFromItems = (
  id: string,
  name: string,
  module: AppModule,
  createdAtValue: unknown,
  items: any[],
  subFeature?: string,
  fallbackPrompt?: string,
  plans?: ShellProjectData['plans'],
  selectedPlanId?: string,
  generationContext?: ShellProjectData['generationContext'],
  creditsConsumed?: unknown,
  planningTaskId?: unknown,
  directGeneration?: unknown,
): ShellProjectData | null => {
  if (!items.length) return null;
  const { ms: createdAt, precise: createdAtPrecise } = coerceCreatedAtMs(createdAtValue, { id });
  const results = items
    .map((item, index) => resultFromItem(item, module, `${name} ${index + 1}`, createdAt, subFeature, fallbackPrompt))
    .filter((item): item is ShellGeneratedResult => Boolean(item));
  const completedCount = items.filter((item) => taskStatusToProject(item?.status) === 'completed' || getResultUrl(item)).length;
  const hasRunning = items.some((item) => taskStatusToProject(item?.status) === 'generating');
  const hasError = items.some((item) => taskStatusToProject(item?.status) === 'error');
  const hasPlans = Array.isArray(plans) && plans.length > 0;
  const totalResultCredits = results.reduce((sum, item) => sum + (Number(item.creditsConsumed) || 0), 0);
  if (results.length === 0 && !hasRunning && !hasError && !hasPlans) return null;
  return {
    id,
    name,
    module,
    status: hasRunning ? 'generating' : hasError ? 'error' : completedCount > 0 ? 'completed' : 'planning',
    createdAt,
    createdAtPrecise,
    completedAt: completedCount > 0 ? createdAt : undefined,
    results,
    taskCount: Math.max(items.length, results.length),
    completedCount,
    subFeature,
    sourceType: 'persisted',
    plans,
    selectedPlanId,
    generationContext,
    creditsConsumed: normalizeCreditsConsumed(creditsConsumed) || normalizeCreditsConsumed(totalResultCredits),
    planningTaskId: latestIdentityTextList(String(planningTaskId || '').trim() || undefined),
    directGeneration: directGeneration === true,
  };
};

const projectListFromItems = (
  id: string,
  name: string,
  module: AppModule,
  createdAtValue: unknown,
  items: any[],
  subFeature?: string,
  fallbackPrompt?: string,
  plans?: ShellProjectData['plans'],
  selectedPlanId?: string,
  generationContext?: ShellProjectData['generationContext'],
  creditsConsumed?: unknown,
  planningTaskId?: unknown,
  directGeneration?: unknown,
): ShellProjectData[] => {
  if (!items.length) return [];
  if (module !== MODULE_VALUES.ONE_CLICK) {
    const project = projectFromItems(id, name, module, createdAtValue, items, subFeature, fallbackPrompt, plans, selectedPlanId, generationContext, creditsConsumed, planningTaskId, directGeneration);
    return project ? [project] : [];
  }

  const groups = new Map<string, any[]>();
  items.forEach((item) => {
    const itemSubFeature = getOneClickItemSubFeature(item, subFeature || 'legacy_unassigned');
    const bucket = groups.get(itemSubFeature) || [];
    bucket.push(item);
    groups.set(itemSubFeature, bucket);
  });

  const groupedEntries = Array.from(groups.entries());
  return groupedEntries
    .map(([groupSubFeature, groupItems]) => {
      const shouldSuffix = groupedEntries.length > 1 || (subFeature && groupSubFeature !== subFeature);
      const projectId = shouldSuffix ? `${id}-${groupSubFeature}` : id;
      const projectName = shouldSuffix
        ? `${name} · ${ONE_CLICK_SUBFEATURE_LABELS[groupSubFeature] || groupSubFeature}`
        : name;
      const groupPlans = Array.isArray(plans)
        ? plans.filter((plan) => {
            const matchingItem = groupItems.find((item) => String(item?.id || '') === String(plan.id || ''));
            if (matchingItem) return true;
            const normalizedPlanContent = String(plan.schemeContent || '').trim();
            return normalizedPlanContent && groupItems.some((item) => {
              const itemContent = String(item?.editedContent || item?.originalContent || '').trim();
              return itemContent === normalizedPlanContent;
            });
          })
        : undefined;
      const groupSelectedPlanId = groupPlans?.find((plan) => plan.id === selectedPlanId)?.id
        || groupPlans?.find((plan) => plan.selected)?.id;
      return projectFromItems(projectId, projectName, module, createdAtValue, groupItems, groupSubFeature, fallbackPrompt, groupPlans, groupSelectedPlanId, generationContext, creditsConsumed, planningTaskId, directGeneration);
    })
    .filter((project): project is ShellProjectData => Boolean(project));
};

const pushMaterialUrls = (
  materials: Record<string, ShellMaterialData[]>,
  type: string,
  urls: unknown,
  prefix: string,
  subFeature?: string,
) => {
  if (!Array.isArray(urls)) return;
  urls.forEach((url, index) => {
    const value = String(url || '').trim();
    if (!value) return;
    materials[type] = materials[type] || [];
    materials[type].push({
      id: `${prefix}-${type}-${index}`,
      type,
      url: value,
      remoteUrl: value,
      fileName: `${type}-${index + 1}`,
      subFeature,
    });
  });
};

const pushSkuImageMaterials = (
  materials: Record<string, ShellMaterialData[]>,
  images: unknown,
  prefix: string,
) => {
  if (!Array.isArray(images)) return;
  images.forEach((item: any, index: number) => {
    const url = String(item?.uploadedUrl || '').trim();
    const role = item?.role;
    if (!url || (role !== 'product' && role !== 'gift' && role !== 'style_ref')) return;
    const type = role === 'gift' ? 'gift' : role === 'style_ref' ? 'styleRef' : 'product';
    materials[type] = materials[type] || [];
    materials[type].push({
      id: `${prefix}-${type}-${index}`,
      type,
      url,
      remoteUrl: url,
      fileName: role === 'gift' ? `gift-${item?.giftIndex || index + 1}` : `${type}-${index + 1}`,
      subFeature: 'sku',
      giftIndex: role === 'gift' ? Number(item?.giftIndex || index + 1) : undefined,
    });
  });
};

const buildGenerationParamsFromBranch = (branch: any) => {
  const config = branch?.config || {};
  const params: Record<string, string> = {};
  Object.entries(config).forEach(([key, value]) => {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      params[key] = String(value);
    }
  });
  if (config.aspectRatio) params.ratio = String(config.aspectRatio);
  if (config.model) params.model = String(config.model);
  if (config.quality) params.quality = String(config.quality);
  if (config.resolutionMode) params.resolutionMode = String(config.resolutionMode);
  if (config.targetWidth !== undefined) params.targetWidth = String(config.targetWidth);
  if (config.targetHeight !== undefined) params.targetHeight = String(config.targetHeight);
  return params;
};

const buildGenerationMaterialsFromBranch = (branch: any, subFeature?: string) => {
  const materials: Record<string, ShellMaterialData[]> = {};
  pushMaterialUrls(materials, 'product', branch?.uploadedProductUrls, 'branch-product', subFeature);
  pushMaterialUrls(materials, 'styleRef', branch?.uploadedDesignReferenceUrls, 'branch-style', subFeature);
  if (branch?.uploadedLogoUrl) {
    pushMaterialUrls(materials, 'logo', [branch.uploadedLogoUrl], 'branch-logo', subFeature);
  }
  if (subFeature === 'sku') {
    pushSkuImageMaterials(materials, branch?.images, 'branch-sku');
  }
  return materials;
};

const buildGenerationContextFromBranch = (branch: any, subFeature?: string) => {
  const prompt = getOneClickProjectPromptFallback(branch);
  const params = buildGenerationParamsFromBranch(branch);
  const materials = buildGenerationMaterialsFromBranch(branch, subFeature);
  if (!prompt && Object.keys(params).length === 0 && Object.keys(materials).length === 0) return undefined;
  return { prompt, params, materials };
};

const normalizeStoryboardProject = (project: any, fallbackId = 'storyboard-project'): DurableStoryboardProject => {
  const rawStatus = String(project?.status || 'pending');
  const status: VideoStoryboardProject['status'] = [
    'pending',
    'scripting',
    'awaiting_image_confirmation',
    'imaging',
    'completed',
    'failed',
  ].includes(rawStatus)
    ? rawStatus as VideoStoryboardProject['status']
    : 'pending';
  return {
    ...project,
    id: String(project?.id || fallbackId),
    name: String(project?.name || '分镜项目'),
    config: (project?.config || {}) as VideoStoryboardConfig,
    status,
    script: String(project?.script || ''),
    shots: Array.isArray(project?.shots) ? project.shots.map((shot: any) => ({ ...shot })) : [],
    boards: Array.isArray(project?.boards) ? project.boards.map((board: any) => ({ ...board })) : [],
    planningTaskId: String(project?.planningTaskId || '').trim() || undefined,
    planningJobId: String(project?.planningJobId || '').trim() || undefined,
    backendJobId: String(project?.backendJobId || '').trim() || undefined,
    createdAt: coerceCreatedAtMs(project?.createdAt, { id: project?.id || fallbackId }).ms,
  };
};

const storyboardProjectToShellProject = (
  sourceProject: DurableStoryboardProject,
  sourceType: ShellProjectData['sourceType'] = 'persisted',
): ShellProjectData => {
  const project = normalizeStoryboardProject(sourceProject, sourceProject.id);
  const results: ShellGeneratedResult[] = project.boards
    .filter((board) => (
      board.status !== 'pending'
      || Boolean(String(board.imageUrl || board.taskId || board.backendJobId || '').trim())
    ))
    .map((board) => ({
      id: String(board.id),
      projectId: project.id,
      imageUrl: String(board.imageUrl || '').trim(),
      mediaType: 'image' as const,
      prompt: String(board.prompt || board.scriptText || board.title || '').trim(),
      model: normalizeModel(project.config?.model),
      aspectRatio: String(project.config?.aspectRatio || 'auto'),
      status: toStoryboardShellResultStatus(board) as ShellGeneratedResult['status'],
      createdAt: project.createdAt,
      module: MODULE_VALUES.VIDEO,
      subFeature: 'storyboard',
      taskId: String(board.taskId || '').trim() || undefined,
      backendJobId: String(board.backendJobId || '').trim() || undefined,
      creditsConsumed: normalizeCreditsConsumed(board.creditsConsumed),
      error: String(board.error || '').trim() || undefined,
    }));
  const completedCount = project.boards.filter((board) => (
    board.status === 'completed' && Boolean(String(board.imageUrl || '').trim())
  )).length;
  const activeBoard = [...project.boards].reverse().find((board) => (
    board.status === 'generating' && Boolean(String(board.backendJobId || '').trim())
  ));
  const latestBoardWithJob = [...project.boards].reverse().find((board) => String(board.backendJobId || '').trim());
  const backendJobId = String(
    activeBoard?.backendJobId
    || project.backendJobId
    || latestBoardWithJob?.backendJobId
    || project.planningJobId
    || ''
  ).trim() || undefined;
  const status: ShellProjectStatus = project.status === 'completed'
    ? 'completed'
    : project.status === 'failed'
      ? 'error'
      : project.status === 'scripting' || project.status === 'imaging'
        ? 'generating'
        : 'planning';

  return {
    id: project.id,
    name: project.name,
    module: MODULE_VALUES.VIDEO,
    status,
    createdAt: project.createdAt,
    completedAt: status === 'completed' ? project.createdAt : undefined,
    results,
    taskCount: Math.max(project.boards.length, 1),
    completedCount,
    subFeature: 'storyboard',
    sourceType,
    backendJobId,
    creditsConsumed: normalizeCreditsConsumed(project.creditsConsumed),
    planningTaskId: String(project.planningTaskId || '').trim() || undefined,
    storyboardProjectStatus: project.status,
    storyboardSourceProject: project,
  };
};

const storyboardJobResult = (job: InternalJob) => ({
  status: job.status,
  imageUrl: getResultUrl(job),
  taskId: getVisibleTaskId(job),
  backendJobId: String(job.id || '').trim(),
  creditsConsumed: normalizeCreditsConsumed((job.result as any)?.creditsConsumed),
  message: String(job.errorMessage || job.errorCode || (job.result as any)?.message || '').trim(),
});

const mapPersistedState = (state?: Partial<PersistedAppState> | null): Pick<ShellDataSnapshot, 'projects' | 'materials'> => {
  if (state && typeof state === 'object') {
    const cached = persistedSnapshotCache.get(state as object);
    if (cached) return cached;
  }
  const projects: ShellProjectData[] = [];
  const materials: Record<string, ShellMaterialData[]> = {};
  if (!state) return { projects, materials };

  const shellProjects = Array.isArray((state as any).shellProjects) ? (state as any).shellProjects : [];
  shellProjects.forEach((project: any) => {
    if (!project || typeof project !== 'object') return;
    projects.push({
      ...project,
      module: toModule(project.module),
      status: taskStatusToProject(project.status),
      createdAt: coerceCreatedAtMs(project.createdAt, { id: project.id, updatedAt: project.updatedAt }).ms,
      createdAtPrecise: coerceCreatedAtMs(project.createdAt, { id: project.id, updatedAt: project.updatedAt }).precise,
      completedAt: project.completedAt != null ? coerceCreatedAtMs(project.completedAt, { id: project.id, updatedAt: project.updatedAt }).ms : undefined,
      results: Array.isArray(project.results) ? project.results.map((result: any, index: number) => ({
        id: String(result?.id || `${project.id}-result-${index}`),
        planId: String(result?.planId || '').trim() || undefined,
        projectId: result?.projectId ? String(result.projectId) : undefined,
        imageUrl: String(result?.imageUrl || '').trim(),
        videoUrl: String(result?.videoUrl || '').trim() || undefined,
        mediaType: result?.mediaType === 'video' ? 'video' : 'image',
        prompt: String(result?.prompt || '').trim(),
        model: normalizeModel(result?.model),
        aspectRatio: String(result?.aspectRatio || 'auto'),
        status: result?.status === 'error' ? 'error' : result?.status === 'generating' ? 'generating' : 'completed',
        createdAt: coerceCreatedAtMs(result?.createdAt ?? project.createdAt, { id: result?.id ?? project.id, updatedAt: project.updatedAt }).ms,
        module: toModule(result?.module || project.module),
        subFeature: String(result?.subFeature || project.subFeature || '').trim() || undefined,
        sourceUrl: String(result?.sourceUrl || '').trim() || undefined,
        sourcePreviewUrl: String(result?.sourcePreviewUrl || result?.sourceUrl || '').trim() || undefined,
        fileName: String(result?.fileName || '').trim() || undefined,
        relativePath: String(result?.relativePath || '').trim() || undefined,
        taskId: getVisibleTaskId(result),
        backendJobId: String(result?.backendJobId || '').trim() || undefined,
        batchIndex: Number(result?.batchIndex || 0) || undefined,
        targetMaterialId: String(result?.targetMaterialId || '').trim() || undefined,
        creditsConsumed: isProductRestoreRecord(project, result)
          ? normalizeKnownProductRestoreCredits(result?.creditsConsumed)
          : normalizeCreditsConsumed(result?.creditsConsumed),
        error: String(result?.error || '').trim() || undefined,
        matchedAspectRatio: String(result?.matchedAspectRatio || result?.aspectRatio || 'auto'),
        originalWidth: Number(result?.originalWidth || 0) || undefined,
        originalHeight: Number(result?.originalHeight || 0) || undefined,
        logoReplaceGuarded: result?.logoReplaceGuarded === true || undefined,
      })) : [],
      taskCount: Number(project.taskCount || project.results?.length || 1),
      completedCount: Number(project.completedCount || 0),
      sourceType: 'persisted',
      creditsConsumed: isProductRestoreRecord(project)
        ? normalizeKnownProductRestoreCredits(project.creditsConsumed)
        : normalizeCreditsConsumed(project.creditsConsumed),
      planningTaskId: latestIdentityTextList(String(project.planningTaskId || '').trim() || undefined),
      generationContext: cloneGenerationContext(project.generationContext),
      directGeneration: project.directGeneration === true,
    });
  });

  const oneClick = state.oneClickMemory as any;
  const oneClickGroups = [
    ['首图', oneClick?.firstImage, MODULE_VALUES.ONE_CLICK, 'first_image'],
    ['主图', oneClick?.mainImage, MODULE_VALUES.ONE_CLICK, 'main_image'],
    ['详情页', oneClick?.detailPage, MODULE_VALUES.ONE_CLICK, 'detail_page'],
    ['SKU', oneClick?.sku, MODULE_VALUES.ONE_CLICK, 'sku'],
  ] as const;
  oneClickGroups.forEach(([label, branch, , subFeature]) => {
    const branchPromptFallback = getOneClickProjectPromptFallback(branch);
    if (subFeature === 'sku') {
      pushSkuImageMaterials(materials, branch?.images, `one-click-${label}`);
      pushMaterialUrls(materials, 'product', branch?.uploadedProductUrls, `one-click-${label}`, subFeature);
      pushMaterialUrls(materials, 'styleRef', branch?.uploadedDesignReferenceUrls, `one-click-${label}`, subFeature);
    } else {
      pushMaterialUrls(materials, 'product', branch?.uploadedProductUrls, `one-click-${label}`, subFeature);
      pushMaterialUrls(materials, 'styleRef', branch?.uploadedDesignReferenceUrls, `one-click-${label}`, subFeature);
      if (branch?.uploadedLogoUrl) pushMaterialUrls(materials, 'logo', [branch.uploadedLogoUrl], `one-click-${label}`, subFeature);
    }
    const branchProjects = Array.isArray(branch?.projects) ? branch.projects : [];
    branchProjects.forEach((project: any) => {
      const projectPromptFallback = getOneClickProjectPromptFallback(project) || branchPromptFallback;
      const projectPlans = Array.isArray(project?.plans) && project.plans.length > 0
        ? project.plans
        : (Array.isArray(project?.schemes) ? project.schemes.map((scheme: any, index: number) => schemeToPlan(scheme, index)) : []);
      const mapped = projectListFromItems(
        String(project?.id || `${label}-${projects.length}`),
        String(project?.name || `${label}项目`),
        MODULE_VALUES.ONE_CLICK,
        project?.updatedAt || project?.createdAt,
        Array.isArray(project?.schemes) ? project.schemes : [],
        subFeature,
        projectPromptFallback,
        projectPlans,
        String(project?.selectedPlanId || '').trim() || projectPlans.find((plan: any) => plan.selected)?.id,
        project?.generationContext || buildGenerationContextFromBranch(branch, subFeature),
        project?.creditsConsumed,
        project?.planningTaskId,
        project?.directGeneration,
      );
      if (mapped.length) projects.push(...mapped);
    });
  });

  const translation = state.translationMemory as any;
  ['main', 'detail', 'removeText'].forEach((key) => {
    const subFeature = TRANSLATION_SUBFEATURES[key] || key;
    const files = Array.isArray(translation?.[key]?.files) ? translation[key].files : [];
    const groupedFiles = new Map<string, any[]>();
    files.forEach((file: any, index: number) => {
      const sourceUrl = String(file?.sourcePreviewUrl || file?.sourceUrl || '').trim();
      if (sourceUrl) pushMaterialUrls(materials, 'product', [sourceUrl], `translation-${key}-${index}`, subFeature);
      const groupId = String(file?.projectId || file?.batchId || file?.groupId || file?.id || `translation-${key}-${index}`).trim();
      const bucket = groupedFiles.get(groupId) || [];
      bucket.push(file);
      groupedFiles.set(groupId, bucket);
    });
    Array.from(groupedFiles.entries()).forEach(([projectId, groupFiles], groupIndex) => {
      const firstFile = groupFiles[0] || {};
      const projectName = String(
        firstFile?.projectName
        || firstFile?.batchName
        || firstFile?.fileName
        || firstFile?.relativePath
        || `出海翻译 ${groupIndex + 1}`
      );
      const mapped = projectFromItems(
        projectId,
        projectName,
        MODULE_VALUES.TRANSLATION,
        firstFile?.projectCreatedAt || firstFile?.createdAt || Date.now(),
        groupFiles,
        subFeature,
      );
      if (mapped) projects.push(mapped);
    });
  });

  const retouch = state.retouchMemory as any;
  pushMaterialUrls(materials, 'reference', retouch?.uploadedReferenceUrl ? [retouch.uploadedReferenceUrl] : [], 'retouch', 'original');
  const retouchTasks = Array.isArray(retouch?.tasks) ? retouch.tasks : [];
  retouchTasks.forEach((task: any, index: number) => {
    const subFeature = normalizeJobSubFeature(MODULE_VALUES.RETOUCH, task?.mode || task?.taskType, task || {});
    if (task?.sourceUrl) pushMaterialUrls(materials, 'product', [task.sourceUrl], `retouch-${index}`, subFeature);
    const mapped = projectFromItems(String(task?.id || `retouch-${index}`), String(task?.fileName || `图片升级 ${index + 1}`), MODULE_VALUES.RETOUCH, Date.now(), [task], subFeature);
    if (mapped) projects.push(mapped);
  });

  const buyerShow = state.buyerShowMemory as any;
  pushMaterialUrls(materials, 'product', buyerShow?.uploadedProductUrls, 'buyer-show', 'image');
  if (buyerShow?.uploadedReferenceUrl) pushMaterialUrls(materials, 'reference', [buyerShow.uploadedReferenceUrl], 'buyer-show', 'image');
  const buyerSets = Array.isArray(buyerShow?.sets) ? buyerShow.sets : [];
  buyerSets.forEach((set: any, index: number) => {
    const mapped = projectFromItems(String(set?.id || `buyer-show-${index}`), `买家秀方案 ${set?.index || index + 1}`, MODULE_VALUES.BUYER_SHOW, Date.now(), Array.isArray(set?.tasks) ? set.tasks : [], 'image');
    if (mapped) projects.push(mapped);
  });

  const video = state.videoMemory as any;
  pushMaterialUrls(materials, 'product', video?.uploadedProductUrls, 'video', 'generation');
  if (video?.uploadedReferenceVideoUrl) pushMaterialUrls(materials, 'reference', [video.uploadedReferenceVideoUrl], 'video', 'generation');
  const videoTasks = Array.isArray(video?.tasks) ? video.tasks : [];
  videoTasks.forEach((task: any, index: number) => {
    const mapped = projectFromItems(String(task?.id || `video-${index}`), `短视频任务 ${index + 1}`, MODULE_VALUES.VIDEO, task?.createTime || Date.now(), [task], normalizeJobSubFeature(MODULE_VALUES.VIDEO, task?.mode || task?.taskType, task || {}));
    if (mapped) projects.push(mapped);
  });
  const storyboardProjects = Array.isArray(video?.storyboard?.projects) ? video.storyboard.projects : [];
  storyboardProjects.forEach((project: any, index: number) => {
    projects.push(storyboardProjectToShellProject(normalizeStoryboardProject({
      ...project,
      name: project?.name || `分镜项目 ${index + 1}`,
    }, `storyboard-${index}`)));
  });

  const xhs = state.xhsCoverMemory as any;
  pushMaterialUrls(materials, 'product', xhs?.uploadedProductUrls, 'xhs', 'cover');
  const xhsProjects = Array.isArray(xhs?.projects) ? xhs.projects : [];
  xhsProjects.forEach((project: any, index: number) => {
    const mapped = projectFromItems(String(project?.id || `xhs-${index}`), String(project?.name || project?.title || `小红书封面 ${index + 1}`), MODULE_VALUES.XHS_COVER, project?.updatedAt || project?.createdAt, Array.isArray(project?.tasks) ? project.tasks : [], 'cover');
    if (mapped) projects.push(mapped);
  });

  const snapshot = { projects, materials };
  if (state && typeof state === 'object') {
    persistedSnapshotCache.set(state as object, snapshot);
  }
  return snapshot;
};

const hasOnlyStalePlanningFailureResults = (project?: Partial<ShellProjectData>) => {
  const results = Array.isArray(project?.results) ? project.results : [];
  return results.length > 0 && results.every((result) => isStalePlanningFailureResult(result));
};

const isPlanningJobPendingPlaceholder = (
  result: Partial<ShellGeneratedResult>,
  job: InternalJob,
) => (
  result.status === 'generating'
  && !result.imageUrl
  && !result.videoUrl
  && String(result.backendJobId || '').trim() === String(job.id || '').trim()
  && !String(result.taskId || '').trim()
  && String(job.taskType || '') === 'kie_chat'
);

const isTrackedOneClickPlanningJob = (job: InternalJob, module: AppModule) => {
  if (module !== MODULE_VALUES.ONE_CLICK) return false;
  if (String(job.taskType || '') !== 'kie_chat') return false;
  const payload = (job.payload || {}) as Record<string, unknown>;
  return Boolean(
    String(payload.shellProjectId || '').trim()
    || String(payload.shellPlanningPurpose || '').trim() === 'one_click_planning'
  );
};

const extractChatPromptText = (payload: Record<string, unknown> = {}) => {
  const direct = String(
    payload.prompt
    || payload.content
    || payload.promptText
    || payload.script
    || ''
  ).trim();
  if (direct) return direct;
  const messages = Array.isArray(payload.messages) ? payload.messages : [];
  const texts: string[] = [];
  messages.forEach((message: any) => {
    const content = message?.content;
    if (typeof content === 'string') {
      const text = content.trim();
      if (text) texts.push(text);
      return;
    }
    if (!Array.isArray(content)) return;
    content.forEach((part: any) => {
      const text = String(part?.text || '').trim();
      if (text) texts.push(text);
    });
  });
  return texts.join('\n').trim();
};

const isOneClickPlanningPlaceholderText = (value: unknown) => {
  const normalized = String(value || '').trim();
  return normalized === MODULE_LABELS[MODULE_VALUES.ONE_CLICK] || normalized === '一键主详';
};

const isPlanningJobPendingPlanPlaceholder = (
  plan: NonNullable<ShellProjectData['plans']>[number],
  planningJobIds: Set<string>,
) => {
  if (!plan || planningJobIds.size === 0) return false;
  const planId = String(plan.id || '').trim();
  if (!planId) return false;
  const isJobPlanId = Array.from(planningJobIds).some((id) => (
    planId === id
    || planId === `${id}-pending`
    || planId === `${id}-result-1`
    || planId.startsWith(`${id}-pending`)
  ));
  if (!isJobPlanId) return false;
  const content = String(
    plan.schemeContent
    || plan.textLayout
    || plan.sceneDescription
    || plan.styleDirection
    || ''
  ).trim();
  return isOneClickPlanningPlaceholderText(content);
};

const removePlanningJobPendingPlans = (
  plans: ShellProjectData['plans'],
  job: InternalJob,
) => {
  if (!Array.isArray(plans) || plans.length === 0) return plans;
  const jobIds = new Set([
    String(job.id || '').trim(),
    getPlanningProviderTaskId(job),
  ].filter(Boolean));
  const filtered = plans.filter((plan) => !isPlanningJobPendingPlanPlaceholder(plan, jobIds));
  return filtered.length > 0 ? filtered : undefined;
};

const removePlanningJobPendingPlaceholders = (
  project: ShellProjectData,
  job: InternalJob,
) => {
  const plans = removePlanningJobPendingPlans(project.plans, job);
  const selectedPlanId = plans?.some((plan) => String(plan.id || '') === String(project.selectedPlanId || ''))
    ? project.selectedPlanId
    : plans?.find((plan) => plan.selected)?.id || plans?.[0]?.id;
  return {
    ...project,
    results: (project.results || []).filter((result) => !isPlanningJobPendingPlaceholder(result, job)),
    plans,
    selectedPlanId,
  };
};

const getBuyerShowSetProjectId = (job: InternalJob) => {
  const payload = (job.payload || {}) as Record<string, unknown>;
  const rootProjectId = String(payload.shellProjectId || '').trim();
  if (!rootProjectId) return '';
  const setIndex = Number(payload.setIndex || 0) || 0;
  const setCount = Number(payload.setCount || 0) || 0;
  if (setCount > 1 && setIndex > 0 && !rootProjectId.endsWith(`-set-${setIndex}`)) {
    return `${rootProjectId}-set-${setIndex}`;
  }
  return rootProjectId;
};

const isSyntheticBuyerShowSetProject = (job: InternalJob) => {
  const payload = (job.payload || {}) as Record<string, unknown>;
  const rootProjectId = String(payload.shellProjectId || '').trim();
  const setIndex = Number(payload.setIndex || 0) || 0;
  const setCount = Number(payload.setCount || 0) || 0;
  return setCount > 1 && setIndex > 0 && rootProjectId && !rootProjectId.endsWith(`-set-${setIndex}`);
};

const getBuyerShowSetBatchIndex = (job: InternalJob, fallback: number) => {
  const payload = (job.payload || {}) as Record<string, unknown>;
  if (isSyntheticBuyerShowSetProject(job)) {
    return Number(payload.imageIndex || 0) || fallback;
  }
  return Number(payload.batchIndex || payload.imageIndex || 0) || fallback;
};

const getBuyerShowSetTaskCount = (job: InternalJob) => {
  const payload = (job.payload || {}) as Record<string, unknown>;
  if (isSyntheticBuyerShowSetProject(job)) {
    return Number(payload.imageCount || 0) || 0;
  }
  return Number(payload.batchCount || payload.imageCount || 0) || 0;
};

const getBuyerShowSetProjectName = (job: InternalJob, fallback = '') => {
  const payload = (job.payload || {}) as Record<string, unknown>;
  const baseName = String(payload.shellProjectName || fallback || '').trim();
  const setIndex = Number(payload.setIndex || 0) || 0;
  const setCount = Number(payload.setCount || 0) || 0;
  if (setCount > 1 && setIndex > 0 && baseName && !baseName.includes(`第${setIndex}套`)) {
    return `${baseName} · 第${setIndex}套`;
  }
  return baseName;
};

const getBuyerShowDisplayPrompt = (payload: Record<string, any>, fallback = '') => (
  String(payload.buyerShowDisplayPrompt || payload.prompt || fallback || MODULE_LABELS[MODULE_VALUES.BUYER_SHOW] || '买家秀').trim()
);

const getBuyerShowEvaluation = (payload: Record<string, any>) => (
  String(payload.buyerShowEvaluation || payload.evaluation || '').trim() || undefined
);

const getBuyerShowPlanningCredits = (jobs: InternalJob[]) => {
  const credits = jobs
    .map((job) => normalizeCreditsConsumed((job.payload as any)?.buyerShowPlanningCredits))
    .filter((value): value is number => Boolean(value));
  return credits.length > 0 ? Math.max(...credits) : undefined;
};

const getBuyerShowPlanningTaskId = (jobs: InternalJob[]) => {
  for (const job of jobs) {
    const taskId = String((job.payload as any)?.buyerShowPlanningTaskId || '').trim();
    if (taskId) return taskId;
  }
  return undefined;
};

const mapJobs = (
  jobs: InternalJob[] = [],
  persistedProjects: ShellProjectData[] = [],
  deletedJobIds: string[] = [],
): Pick<ShellDataSnapshot, 'projects' | 'tasks'> => {
  const projects: ShellProjectData[] = [];
  const tasks: ShellTaskData[] = [];
  const hiddenJobIds = new Set(deletedJobIds.map((id) => String(id || '').trim()).filter(Boolean));
  const persistedJobKeys = collectPersistedProjectJobKeys(persistedProjects);
  const groupedEverythingReplaceJobIds = new Set<string>();
  const everythingReplaceGroups = new Map<string, InternalJob[]>();
  const groupedBuyerShowJobIds = new Set<string>();
  const buyerShowGroups = new Map<string, InternalJob[]>();
  const groupedTranslationJobIds = new Set<string>();
  const translationGroups = new Map<string, InternalJob[]>();
  const groupedOneClickPlanningJobIds = new Set<string>();
  const oneClickPlanningGroups = new Map<string, InternalJob[]>();
  const groupedStoryboardJobIds = new Set<string>();
  const storyboardGroups = new Map<string, InternalJob[]>();

  jobs.forEach((job) => {
    const jobId = String(job?.id || '').trim();
    if (!jobId || hiddenJobIds.has(jobId)) return;
    const module = toModule(job.module);
    if (module !== MODULE_VALUES.EVERYTHING_REPLACE || !String(job.taskType || '').includes('image')) return;
    const payloadProjectId = String((job.payload as any)?.shellProjectId || '').trim();
    if (!payloadProjectId) return;
    const bucket = everythingReplaceGroups.get(payloadProjectId) || [];
    bucket.push(job);
    everythingReplaceGroups.set(payloadProjectId, bucket);
  });

  jobs.forEach((job) => {
    const jobId = String(job?.id || '').trim();
    if (!jobId || hiddenJobIds.has(jobId)) return;
    const module = toModule(job.module);
    if (module !== MODULE_VALUES.BUYER_SHOW || !String(job.taskType || '').includes('image')) return;
    const payloadProjectId = getBuyerShowSetProjectId(job);
    if (!payloadProjectId) return;
    const bucket = buyerShowGroups.get(payloadProjectId) || [];
    bucket.push(job);
    buyerShowGroups.set(payloadProjectId, bucket);
  });

  jobs.forEach((job) => {
    const jobId = String(job?.id || '').trim();
    if (!jobId || hiddenJobIds.has(jobId)) return;
    const module = toModule(job.module);
    if (module !== MODULE_VALUES.TRANSLATION || !String(job.taskType || '').includes('image')) return;
    if (String((job.payload as any)?.shellPurpose || '').trim() !== 'translation_generation') return;
    const payloadProjectId = String((job.payload as any)?.shellProjectId || '').trim();
    if (!payloadProjectId) return;
    const bucket = translationGroups.get(payloadProjectId) || [];
    bucket.push(job);
    translationGroups.set(payloadProjectId, bucket);
  });

  jobs.forEach((job) => {
    const jobId = String(job?.id || '').trim();
    if (!jobId || hiddenJobIds.has(jobId)) return;
    const module = toModule(job.module);
    if (module !== MODULE_VALUES.ONE_CLICK) return;
    if (String(job.taskType || '') !== 'kie_chat') return;
    if (taskStatusToProject(job.status) !== 'completed') return;
    if (getResultUrls(job).length > 0) return;
    const payloadProjectId = String((job.payload as any)?.shellProjectId || '').trim();
    if (!payloadProjectId) return;
    const isTrackedPlanningJob = String((job.payload as any)?.shellPlanningPurpose || '').trim() === 'one_click_planning';
    if (!isTrackedPlanningJob) return;
    const bucket = oneClickPlanningGroups.get(payloadProjectId) || [];
    bucket.push(job);
    oneClickPlanningGroups.set(payloadProjectId, bucket);
  });

  jobs.forEach((job) => {
    const jobId = String(job?.id || '').trim();
    if (!jobId || hiddenJobIds.has(jobId) || toModule(job.module) !== MODULE_VALUES.VIDEO) return;
    const payload = (job.payload || {}) as Record<string, unknown>;
    const shellProjectId = String(payload.shellProjectId || '').trim();
    const planningPurpose = String(payload.planningPurpose || '').trim();
    if (!shellProjectId || !['storyboard_planning', 'storyboard_board_image'].includes(planningPurpose)) return;
    const bucket = storyboardGroups.get(shellProjectId) || [];
    bucket.push(job);
    storyboardGroups.set(shellProjectId, bucket);
  });

  storyboardGroups.forEach((groupJobs, shellProjectId) => {
    const sortedJobs = [...groupJobs].sort((a, b) => {
      const timeDifference = Number(a.createdAt || 0) - Number(b.createdAt || 0);
      if (timeDifference !== 0) return timeDifference;
      const aPurpose = String((a.payload as any)?.planningPurpose || '');
      const bPurpose = String((b.payload as any)?.planningPurpose || '');
      if (aPurpose !== bPurpose) return aPurpose === 'storyboard_planning' ? -1 : 1;
      return 0;
    });
    sortedJobs.forEach((job) => groupedStoryboardJobIds.add(String(job.id || '').trim()));
    const storyboardBoardJobIds = new Set<string>();
    const newestStoryboardBoardJobByBoardId = new Map<string, InternalJob>();
    sortedJobs.forEach((job) => {
      const payload = (job.payload || {}) as Record<string, unknown>;
      if (String(payload.planningPurpose || '').trim() !== 'storyboard_board_image') return;
      const boardId = String(payload.boardId || '').trim();
      const jobId = String(job.id || '').trim();
      if (!boardId || !jobId) return;
      storyboardBoardJobIds.add(jobId);
      const currentNewest = newestStoryboardBoardJobByBoardId.get(boardId);
      const createdDifference = Number(job.createdAt || 0) - Number(currentNewest?.createdAt || 0);
      const updatedDifference = Number(job.updatedAt || 0) - Number(currentNewest?.updatedAt || 0);
      if (!currentNewest || createdDifference > 0 || (createdDifference === 0 && updatedDifference >= 0)) {
        newestStoryboardBoardJobByBoardId.set(boardId, job);
      }
    });
    const persistedProject = persistedProjects.find((project) => project.id === shellProjectId);
    const firstPayload = (sortedJobs[0]?.payload || {}) as Record<string, unknown>;
    let storyboardProject = normalizeStoryboardProject(
      persistedProject?.storyboardSourceProject || {
        id: shellProjectId,
        name: String(firstPayload.shellProjectName || '分镜项目'),
        config: firstPayload.storyboardConfig || {},
        status: 'scripting',
        script: '正在生成分镜脚本...',
        shots: [],
        boards: [],
        createdAt: sortedJobs[0]?.createdAt,
      },
      shellProjectId,
    );

    sortedJobs.forEach((job) => {
      const payload = (job.payload || {}) as Record<string, unknown>;
      const planningPurpose = String(payload.planningPurpose || '').trim();
      const providerTaskId = getVisibleTaskId(job);
      const projectStatus = taskStatusToProject(job.status);
      const jobCredits = normalizeCreditsConsumed((job.result as any)?.creditsConsumed);

      if (planningPurpose === 'storyboard_planning') {
        storyboardProject = {
          ...storyboardProject,
          planningJobId: String(job.id || '').trim(),
          backendJobId: String(job.id || '').trim(),
          planningTaskId: latestIdentityTextList(storyboardProject.planningTaskId, providerTaskId),
          creditsConsumed: jobCredits || storyboardProject.creditsConsumed,
        };
        if (projectStatus === 'completed') {
          const content = String((job.result as any)?.content || (job.result as any)?.text || '').trim();
          const config = (payload.storyboardConfig || storyboardProject.config) as VideoStoryboardConfig;
          const alreadyHasDurableStoryboard = storyboardProject.shots.length > 0
            || storyboardProject.boards.length > 0;
          if (!alreadyHasDurableStoryboard) {
            try {
              const parsed = parseStoryboardPlanningResult({
                content,
                config,
                identitySeed: shellProjectId,
              });
              storyboardProject = {
                ...storyboardProject,
                config,
                status: 'awaiting_image_confirmation',
                script: parsed.script,
                shots: parsed.shots,
                boards: parsed.boards,
                error: undefined,
              };
            } catch (error) {
              storyboardProject = {
                ...storyboardProject,
                status: 'failed',
                error: error instanceof Error ? error.message : '分镜脚本解析失败',
              };
            }
          }
        } else if (projectStatus === 'error') {
          storyboardProject = {
            ...storyboardProject,
            status: 'failed',
            error: String(job.errorMessage || job.errorCode || '分镜脚本生成失败'),
          };
        } else {
          storyboardProject = { ...storyboardProject, status: 'scripting' };
        }
      } else if (planningPurpose === 'storyboard_board_image') {
        const boardId = String(payload.boardId || '').trim();
        const recoveredJobId = String(job.id || '').trim();
        const authoritativeJobId = String(newestStoryboardBoardJobByBoardId.get(boardId)?.id || '').trim();
        const boardIndex = storyboardProject.boards.findIndex((board) => board.id === boardId);
        if (boardIndex >= 0 && recoveredJobId === authoritativeJobId) {
          const boards = [...storyboardProject.boards];
          const currentBoard = boards[boardIndex] as DurableStoryboardBoard;
          const currentBackendJobId = String(currentBoard.backendJobId || '').trim();
          const hasExternalDurableIdentity = Boolean(
            currentBackendJobId
            && currentBackendJobId !== recoveredJobId
            && !storyboardBoardJobIds.has(currentBackendJobId)
          );
          const isCompletedWithoutJobIdentity = !currentBackendJobId
            && currentBoard.status === 'completed'
            && Boolean(String(currentBoard.imageUrl || '').trim());
          if (!hasExternalDurableIdentity && !isCompletedWithoutJobIdentity) {
            boards[boardIndex] = applyStoryboardBoardResult(currentBoard, storyboardJobResult(job));
          }
          storyboardProject = {
            ...storyboardProject,
            boards,
            status: deriveStoryboardProjectStatus(boards, storyboardProject.status),
            backendJobId: String(job.id || '').trim(),
          };
        }
      }

      if (projectStatus === 'generating' || projectStatus === 'planning') {
        tasks.push({
          id: String(job.id),
          projectId: shellProjectId,
          module: MODULE_VALUES.VIDEO,
          type: planningPurpose === 'storyboard_planning' ? 'plan' : 'image',
          status: taskStatusToTask(job.status),
          title: planningPurpose === 'storyboard_planning' ? '分镜脚本策划' : '分镜板生成',
          progress: job.status === 'running' ? 42 : 8,
          createdAt: toCreatedMs(job.createdAt),
          subFeature: 'storyboard',
          backendJobId: String(job.id),
          storyboardBoardId: String(payload.boardId || '').trim() || undefined,
        });
      }
    });

    projects.push(storyboardProjectToShellProject(storyboardProject, 'job'));
  });

	  everythingReplaceGroups.forEach((groupJobs, shellProjectId) => {
    const sortedJobs = [...groupJobs].sort((a, b) => {
      const aBatch = Number((a.payload as any)?.batchIndex || 0);
      const bBatch = Number((b.payload as any)?.batchIndex || 0);
      if (aBatch > 0 && bBatch > 0 && aBatch !== bBatch) return aBatch - bBatch;
      return Number(a.createdAt || 0) - Number(b.createdAt || 0);
    });
    sortedJobs.forEach((job) => groupedEverythingReplaceJobIds.add(String(job.id || '').trim()));
    const firstJob = sortedJobs[0];
    const createdAt = toCreatedMs(firstJob?.createdAt || firstJob?.updatedAt || Date.now());
    const subFeature = normalizeJobSubFeature(MODULE_VALUES.EVERYTHING_REPLACE, firstJob?.taskType, firstJob?.payload || {});
    const results: ShellGeneratedResult[] = sortedJobs.map((job, index) => {
      const urls = getResultUrls(job);
      const status = taskStatusToProject(job.status);
      const batchIndex = Number((job.payload as any)?.batchIndex || index + 1) || index + 1;
      const providerTaskId = String(job.providerTaskId || job.result?.providerTaskId || '').trim();
      return {
        id: String(providerTaskId || `${job.id}-result-${batchIndex}`),
        projectId: shellProjectId,
        imageUrl: urls[0] || '',
        mediaType: 'image' as const,
        prompt: String(job.payload?.prompt || job.errorMessage || MODULE_LABELS[MODULE_VALUES.EVERYTHING_REPLACE] || '万物替换'),
        model: normalizeModel(job.payload?.model || job.result?.model || job.provider),
        aspectRatio: String(job.payload?.aspectRatio || job.payload?.ratio || job.result?.aspectRatio || 'auto'),
        status: (status === 'completed' && urls[0] ? 'completed' : status === 'error' ? 'error' : 'generating') as ShellGeneratedResult['status'],
        createdAt: toCreatedMs(job.createdAt || firstJob?.createdAt),
        module: MODULE_VALUES.EVERYTHING_REPLACE,
        subFeature,
        taskId: providerTaskId || undefined,
        backendJobId: String(job.id || '').trim() || undefined,
        batchIndex,
        creditsConsumed: normalizeCreditsConsumed(job.result?.creditsConsumed),
        error: String(job.errorMessage || job.errorCode || '').trim() || undefined,
        errorDetail: String(job.errorDetail || '').trim() || undefined,
      };
    }).sort((a, b) => Number(a.batchIndex || 0) - Number(b.batchIndex || 0));
    const completedCount = results.filter((result) => result.status === 'completed' && result.imageUrl).length;
    const hasRunning = results.some((result) => result.status === 'generating');
    const hasError = results.some((result) => result.status === 'error');
    const taskCount = Math.max(
      ...sortedJobs.map((job) => Number((job.payload as any)?.batchCount || 0) || 0),
      results.length,
      1,
    );
    const projectName = String((firstJob?.payload as any)?.shellProjectName || '').trim()
      || MODULE_LABELS[MODULE_VALUES.EVERYTHING_REPLACE]
      || '万物替换';
    projects.push({
      id: shellProjectId,
      name: projectName,
      module: MODULE_VALUES.EVERYTHING_REPLACE,
      status: hasRunning ? 'generating' : hasError ? 'error' : 'completed',
      createdAt,
      completedAt: completedCount >= taskCount && !hasRunning ? toCreatedMs(sortedJobs.at(-1)?.finishedAt || sortedJobs.at(-1)?.updatedAt || sortedJobs.at(-1)?.createdAt) : undefined,
      results,
      taskCount,
      completedCount,
      subFeature,
      sourceType: 'job',
      backendJobId: String(sortedJobs.at(-1)?.id || '').trim() || undefined,
      creditsConsumed: normalizeCreditsConsumed(results.reduce((sum, result) => sum + (Number(result.creditsConsumed) || 0), 0)),
    });
    sortedJobs
      .filter((job) => ['queued', 'running', 'retry_waiting'].includes(String(job.status || '')))
      .forEach((job) => {
        tasks.push({
          id: String(job.id || ''),
          projectId: shellProjectId,
          module: MODULE_VALUES.EVERYTHING_REPLACE,
          type: 'image',
          status: taskStatusToTask(job.status),
          title: jobTaskTitle(job, MODULE_VALUES.EVERYTHING_REPLACE, subFeature),
          prompt: String(job.payload?.prompt || ''),
          progress: job.status === 'running' ? 42 : 8,
          createdAt: toCreatedMs(job.createdAt),
          subFeature,
          backendJobId: String(job.id || ''),
        });
      });
	  });

  buyerShowGroups.forEach((groupJobs, shellProjectId) => {
    const sortedJobs = [...groupJobs].sort((a, b) => {
      const aBatch = getBuyerShowSetBatchIndex(a, 0);
      const bBatch = getBuyerShowSetBatchIndex(b, 0);
      if (aBatch > 0 && bBatch > 0 && aBatch !== bBatch) return aBatch - bBatch;
      return Number(a.createdAt || 0) - Number(b.createdAt || 0);
    });
    sortedJobs.forEach((job) => groupedBuyerShowJobIds.add(String(job.id || '').trim()));
    const firstJob = sortedJobs[0];
    const matchedProject = persistedProjects.find((project) => project.id === shellProjectId);
    const createdAt = toCreatedMs(matchedProject?.createdAt || firstJob?.createdAt || firstJob?.updatedAt || Date.now());
    const subFeature = normalizeJobSubFeature(MODULE_VALUES.BUYER_SHOW, firstJob?.taskType, firstJob?.payload || {});
    let results: ShellGeneratedResult[] = sortedJobs.map((job, index) => {
      const payload = (job.payload || {}) as Record<string, any>;
      const urls = getResultUrls(job);
      const status = taskStatusToProject(job.status);
      const batchIndex = getBuyerShowSetBatchIndex(job, index + 1);
      const providerTaskId = String(job.providerTaskId || job.result?.providerTaskId || '').trim();
      const displayPrompt = getBuyerShowDisplayPrompt(payload, job.errorMessage);
      const evaluationText = getBuyerShowEvaluation(payload);
      const imageUrl = urls[0] || '';
      return {
        id: String(providerTaskId || `${job.id}-result-${batchIndex}`),
        projectId: shellProjectId,
        imageUrl,
        mediaType: 'image' as const,
        prompt: displayPrompt,
        buyerShowDisplayPrompt: displayPrompt,
        buyerShowEvaluation: evaluationText,
        model: normalizeModel(payload.model || job.result?.model || job.provider),
        aspectRatio: String(payload.aspectRatio || payload.ratio || job.result?.aspectRatio || '3:4'),
        status: (imageUrl ? 'completed' : status === 'error' ? 'error' : 'generating') as ShellGeneratedResult['status'],
        createdAt: toCreatedMs(job.createdAt || firstJob?.createdAt),
        module: MODULE_VALUES.BUYER_SHOW,
        subFeature,
        taskId: providerTaskId || undefined,
        backendJobId: String(job.id || '').trim() || undefined,
        batchIndex,
        creditsConsumed: normalizeCreditsConsumed(job.result?.creditsConsumed),
        error: String(job.errorMessage || job.errorCode || '').trim() || undefined,
        errorDetail: String(job.errorDetail || '').trim() || undefined,
      };
    }).sort((a, b) => Number(a.batchIndex || 0) - Number(b.batchIndex || 0));
    const taskCount = Math.max(
      ...sortedJobs.map((job) => getBuyerShowSetTaskCount(job)),
      results.length,
      1,
    );
    const completedCount = results.filter((result) => result.status === 'completed' && result.imageUrl).length;
    const hasRunning = results.some((result) => result.status === 'generating');
    const hasError = results.some((result) => result.status === 'error');
    const planningCredits = getBuyerShowPlanningCredits(sortedJobs);
    const planningTaskId = getBuyerShowPlanningTaskId(sortedJobs);
    const projectName = getBuyerShowSetProjectName(firstJob, matchedProject?.name)
      || matchedProject?.name
      || MODULE_LABELS[MODULE_VALUES.BUYER_SHOW]
      || '买家秀';
    projects.push({
      ...(matchedProject || {}),
      id: shellProjectId,
      name: projectName,
      module: MODULE_VALUES.BUYER_SHOW,
      status: hasRunning ? 'generating' : hasError ? 'error' : completedCount >= taskCount ? 'completed' : 'generating',
      createdAt,
      completedAt: completedCount >= taskCount && !hasRunning && !hasError ? toCreatedMs(sortedJobs.at(-1)?.finishedAt || sortedJobs.at(-1)?.updatedAt || sortedJobs.at(-1)?.createdAt) : matchedProject?.completedAt,
      results,
      taskCount,
      completedCount,
      subFeature,
      sourceType: 'job',
      backendJobId: String(sortedJobs.at(-1)?.id || '').trim() || undefined,
      creditsConsumed: planningCredits || matchedProject?.creditsConsumed,
      planningTaskId: planningTaskId || matchedProject?.planningTaskId,
    });
    sortedJobs
      .filter((job) => ['queued', 'running', 'retry_waiting'].includes(String(job.status || '')) && getResultUrls(job).length === 0)
      .forEach((job) => {
        tasks.push({
          id: String(job.id || ''),
          projectId: shellProjectId,
          module: MODULE_VALUES.BUYER_SHOW,
          type: 'image',
          status: taskStatusToTask(job.status),
          title: jobTaskTitle(job, MODULE_VALUES.BUYER_SHOW, subFeature),
          prompt: String(job.payload?.prompt || ''),
          progress: job.status === 'running' ? 42 : 8,
          createdAt: toCreatedMs(job.createdAt),
          subFeature,
          backendJobId: String(job.id || ''),
        });
      });
  });

	  translationGroups.forEach((groupJobs, shellProjectId) => {
	    const sortedJobs = [...groupJobs].sort((a, b) => {
	      const aBatch = Number((a.payload as any)?.batchIndex || 0);
	      const bBatch = Number((b.payload as any)?.batchIndex || 0);
	      if (aBatch > 0 && bBatch > 0 && aBatch !== bBatch) return aBatch - bBatch;
	      return Number(a.createdAt || 0) - Number(b.createdAt || 0);
	    });
	    sortedJobs.forEach((job) => groupedTranslationJobIds.add(String(job.id || '').trim()));
	    const firstJob = sortedJobs[0];
	    const matchedProject = persistedProjects.find((project) => project.id === shellProjectId);
	    const createdAt = toCreatedMs(matchedProject?.createdAt || firstJob?.createdAt || firstJob?.updatedAt || Date.now());
	    const subFeature = normalizeJobSubFeature(MODULE_VALUES.TRANSLATION, firstJob?.taskType, firstJob?.payload || {});
	    const results: ShellGeneratedResult[] = sortedJobs.map((job, index) => {
	      const payload = (job.payload || {}) as Record<string, any>;
	      const urls = getResultUrls(job);
	      const status = taskStatusToProject(job.status);
	      const batchIndex = Number(payload.batchIndex || index + 1) || index + 1;
	      const providerTaskId = String(job.providerTaskId || job.result?.providerTaskId || '').trim();
	      const sourceUrl = String(payload.sourceUrl || '').trim();
	      const sourcePreviewUrl = String(payload.sourcePreviewUrl || payload.sourceUrl || '').trim();
	      const finalSize = payload.finalSize && typeof payload.finalSize === 'object' ? payload.finalSize : {};
	      return {
	        id: String(payload.shellResultId || providerTaskId || `${job.id}-result-${batchIndex}`),
	        projectId: shellProjectId,
	        imageUrl: urls[0] || '',
	        mediaType: 'image' as const,
	        prompt: String(payload.prompt || job.errorMessage || MODULE_LABELS[MODULE_VALUES.TRANSLATION] || '出海翻译'),
	        model: normalizeModel(payload.model || job.result?.model || job.provider),
	        aspectRatio: String(payload.aspectRatio || payload.ratio || job.result?.aspectRatio || 'auto'),
	        status: (status === 'completed' && urls[0] ? 'completed' : status === 'error' ? 'error' : 'generating') as ShellGeneratedResult['status'],
	        createdAt: toCreatedMs(job.createdAt || firstJob?.createdAt),
	        module: MODULE_VALUES.TRANSLATION,
	        subFeature: String(payload.subFeature || subFeature || '').trim() || undefined,
	        sourceUrl: sourceUrl || undefined,
	        sourcePreviewUrl: sourcePreviewUrl || undefined,
	        fileName: String(payload.sourceFileName || '').trim() || undefined,
	        relativePath: String(payload.sourceRelativePath || payload.sourceFileName || '').trim() || undefined,
	        taskId: providerTaskId || undefined,
	        backendJobId: String(job.id || '').trim() || undefined,
	        batchIndex,
	        creditsConsumed: normalizeCreditsConsumed(job.result?.creditsConsumed),
	        error: String(job.errorMessage || job.errorCode || '').trim() || undefined,
        errorDetail: String(job.errorDetail || '').trim() || undefined,
	        originalWidth: Number(finalSize.width || 0) || undefined,
	        originalHeight: Number(finalSize.height || 0) || undefined,
	      };
	    }).sort((a, b) => Number(a.batchIndex || 0) - Number(b.batchIndex || 0));
	    const completedCount = results.filter((result) => result.status === 'completed' && result.imageUrl).length;
	    const hasRunning = results.some((result) => result.status === 'generating');
	    const hasError = results.some((result) => result.status === 'error');
	    const taskCount = Math.max(
	      ...sortedJobs.map((job) => Number((job.payload as any)?.batchCount || 0) || 0),
	      matchedProject?.taskCount || 0,
	      results.length,
	      1,
	    );
	    const projectName = String((firstJob?.payload as any)?.shellProjectName || '').trim()
	      || matchedProject?.name
	      || MODULE_LABELS[MODULE_VALUES.TRANSLATION]
	      || '出海翻译';
	    projects.push({
	      ...(matchedProject || {}),
	      id: shellProjectId,
	      name: projectName,
	      module: MODULE_VALUES.TRANSLATION,
	      status: hasRunning ? 'generating' : hasError ? 'error' : 'completed',
	      createdAt,
	      completedAt: completedCount >= taskCount && !hasRunning ? toCreatedMs(sortedJobs.at(-1)?.finishedAt || sortedJobs.at(-1)?.updatedAt || sortedJobs.at(-1)?.createdAt) : matchedProject?.completedAt,
	      results,
	      taskCount,
	      completedCount,
	      subFeature: String((firstJob?.payload as any)?.subFeature || matchedProject?.subFeature || subFeature || '').trim() || undefined,
	      sourceType: matchedProject?.sourceType || 'job',
	      backendJobId: String(sortedJobs.at(-1)?.id || '').trim() || undefined,
	      creditsConsumed: normalizeCreditsConsumed(results.reduce((sum, result) => sum + (Number(result.creditsConsumed) || 0), 0)) || matchedProject?.creditsConsumed,
	    });
	    sortedJobs
	      .filter((job) => ['queued', 'running', 'retry_waiting'].includes(String(job.status || '')))
	      .forEach((job) => {
	        tasks.push({
	          id: String(job.id || ''),
	          projectId: shellProjectId,
	          module: MODULE_VALUES.TRANSLATION,
	          type: 'image',
	          status: taskStatusToTask(job.status),
	          title: jobTaskTitle(job, MODULE_VALUES.TRANSLATION, subFeature),
	          prompt: String(job.payload?.prompt || ''),
	          progress: job.status === 'running' ? 42 : 8,
	          createdAt: toCreatedMs(job.createdAt),
	          subFeature,
	          backendJobId: String(job.id || ''),
	        });
	      });
	  });

	  oneClickPlanningGroups.forEach((groupJobs, shellProjectId) => {
    if (groupJobs.length <= 1) return;
    const sortedJobs = [...groupJobs].sort((a, b) => {
      const aReferenceIndex = getPlanningReferenceIndex(a);
      const bReferenceIndex = getPlanningReferenceIndex(b);
      if (aReferenceIndex > 0 && bReferenceIndex > 0 && aReferenceIndex !== bReferenceIndex) {
        return aReferenceIndex - bReferenceIndex;
      }
      return Number(a.createdAt || 0) - Number(b.createdAt || 0);
    });
    const parsedEntries = sortedJobs
      .map((job) => {
        const planningText = String((job.result as any)?.content || (job.result as any)?.text || '').trim();
        const plans = attachReferenceUrlToPlans(
          backfillDetailPageSetReplicationPlans(parseOneClickPlanningText(planningText, job.id), job.id, job.payload),
          getPlanningReferenceUrls(job.payload),
        );
        return { job, plans };
      })
      .filter((entry) => (entry.plans || []).length > 0);
    if (parsedEntries.length <= 1) return;

    const matchedProject = parsedEntries
      .map((entry) => findPersistedPlanningProjectForJob(entry.job, persistedProjects))
      .find(Boolean);
    const cleanProject = matchedProject
      ? parsedEntries.reduce(
        (project, entry) => removePlanningJobPendingPlaceholders(project, entry.job),
        matchedProject,
      )
      : undefined;
    const hasExistingConcreteResults = Boolean(cleanProject && (
      (cleanProject.results || []).some(hasConcretePlanningRecoveryResult)
      || Number(cleanProject.completedCount || 0) > 0
    ));
    if (hasExistingConcreteResults) return;

    parsedEntries.forEach((entry) => groupedOneClickPlanningJobIds.add(String(entry.job.id || '').trim()));
    const parsedPlans = parsedEntries.flatMap((entry) => entry.plans || []);
    const planningOrderById = new Map<string, number>();
    const planningOrderByReferenceUrl = new Map<string, number>();
    parsedPlans.forEach((plan, index) => {
      const id = String(plan?.id || '').trim();
      const referenceUrl = String(plan?.sourceReferenceUrl || '').trim();
      if (id) planningOrderById.set(id, index);
      if (referenceUrl) planningOrderByReferenceUrl.set(referenceUrl, index);
    });
    const getPlanningPlanOrder = (plan: NonNullable<ShellProjectData['plans']>[number]) => {
      const id = String(plan?.id || '').trim();
      const referenceUrl = String(plan?.sourceReferenceUrl || '').trim();
      if (id && planningOrderById.has(id)) return planningOrderById.get(id) ?? Number.MAX_SAFE_INTEGER;
      if (referenceUrl && planningOrderByReferenceUrl.has(referenceUrl)) {
        return planningOrderByReferenceUrl.get(referenceUrl) ?? Number.MAX_SAFE_INTEGER;
      }
      const titleIndex = Number.parseInt(String(plan?.title || '').match(/(?:首图裂变|参考图?)(\d+)/)?.[1] || '', 10);
      return Number.isFinite(titleIndex) && titleIndex > 0 ? titleIndex - 1 : Number.MAX_SAFE_INTEGER;
    };
    const plans = (mergeProjectPlansById(cleanProject?.plans, parsedPlans) || [])
      .sort((a, b) => getPlanningPlanOrder(a) - getPlanningPlanOrder(b));
    const firstJob = sortedJobs[0];
    const lastJob = sortedJobs.at(-1);
    const latestParsedJob = parsedEntries.at(-1)?.job || lastJob || firstJob;
    const firstParsedPlan = plans[0];
    const inferredSubFeature = cleanProject?.subFeature
      || getStructuredOneClickJobSubFeature(firstJob?.payload)
      || normalizeJobSubFeature(MODULE_VALUES.ONE_CLICK, firstJob?.taskType, firstJob?.payload || {});
    const maxReferenceIndex = Math.max(...sortedJobs.map(getPlanningReferenceIndex), 0);
    const providerTaskIds = parsedEntries
      .map((entry) => getPlanningProviderTaskId(entry.job))
      .filter(Boolean);
    projects.push({
      ...(cleanProject || {}),
      id: cleanProject?.id || shellProjectId,
      name: cleanProject?.name
        || String((firstJob?.payload as any)?.shellProjectName || '').trim()
        || firstParsedPlan?.title
        || '一键主详策划',
      module: MODULE_VALUES.ONE_CLICK,
      status: 'planning',
      createdAt: coerceCreatedAtMs(cleanProject?.createdAt ?? firstJob?.createdAt, { id: cleanProject?.id ?? shellProjectId }).ms,
      results: [],
      taskCount: Math.max(Number(cleanProject?.taskCount || 0) || 0, plans.length, maxReferenceIndex, 1),
      completedCount: 0,
      subFeature: inferredSubFeature,
      sourceType: cleanProject?.sourceType || (matchedProject ? 'persisted' : 'job'),
      backendJobId: String(latestParsedJob?.id || '').trim() || cleanProject?.backendJobId,
      creditsConsumed: normalizeCreditsConsumed(
        parsedEntries.reduce((sum, entry) => sum + (Number((entry.job.result as any)?.creditsConsumed) || 0), 0),
      ) || cleanProject?.creditsConsumed,
      planningTaskId: latestIdentityTextList(cleanProject?.planningTaskId, ...providerTaskIds),
      plans,
      selectedPlanId: plans.some((plan) => String(plan.id || '') === String(cleanProject?.selectedPlanId || ''))
        ? cleanProject?.selectedPlanId
        : plans.find((plan) => plan.selected)?.id || firstParsedPlan?.id,
    });
  });

  jobs.forEach((job) => {
	    if (hiddenJobIds.has(String(job.id || '').trim())) return;
	    if (groupedEverythingReplaceJobIds.has(String(job.id || '').trim())) return;
	    if (groupedBuyerShowJobIds.has(String(job.id || '').trim())) return;
	    if (groupedTranslationJobIds.has(String(job.id || '').trim())) return;
	    if (groupedOneClickPlanningJobIds.has(String(job.id || '').trim())) return;
	    if (groupedStoryboardJobIds.has(String(job.id || '').trim())) return;
    const module = toModule(job.module);
    const providerErrorText = getProviderErrorText(job);
    const projectStatus = taskStatusToProject(job.status) === 'completed' && providerErrorText
      ? 'error'
      : taskStatusToProject(job.status);
    const createdAt = toCreatedMs(job.createdAt);
    const mediaType = job.taskType?.includes('video') || Boolean(job.result?.videoUrl) ? 'video' : 'image';
    const prompt = String(
      job.payload?.prompt
      || job.payload?.content
      || job.payload?.promptText
      || job.payload?.script
      || job.result?.content
      || job.result?.text
      || MODULE_LABELS[module]
      || job.taskType
      || '任务'
    );
    const payloadProjectId = String((job.payload as any)?.shellProjectId || '').trim();
    const payloadProjectName = String((job.payload as any)?.shellProjectName || '').trim();
    const projectId = isSubtitleRemovalJob(job, module) && payloadProjectId
      ? payloadProjectId
      : `job-${job.id}`;
    const payloadPlanId = String((job.payload as any)?.shellPlanId || (job.payload as any)?.planId || '').trim();
    const subFeature = module === MODULE_VALUES.ONE_CLICK
      ? (getStructuredOneClickJobSubFeature(job.payload) || normalizeJobSubFeature(module, job.taskType, job.payload))
      : normalizeJobSubFeature(module, job.taskType, job.payload);

    // Planning jobs are control-plane records, not generated media. A bound active
    // job may drive progress for its pre-created card; an unbound legacy job stays
    // completely invisible so ProjectListView cannot rebuild it as a fallback card.
    if (module !== MODULE_VALUES.ONE_CLICK && isShellControlJob(job, module)) {
      if (
        (projectStatus === 'generating' || projectStatus === 'planning')
        && shouldExposeActiveJobResult({ job, module, payloadProjectId })
      ) {
        tasks.push({
          id: job.id,
          projectId: payloadProjectId,
          module,
          type: 'plan',
          status: taskStatusToTask(job.status),
          title: jobTaskTitle(job, module, subFeature),
          prompt,
          progress: job.status === 'running' ? 42 : 8,
          createdAt,
          subFeature,
          backendJobId: job.id,
        });
      }
      return;
    }

    if (projectStatus === 'completed' || projectStatus === 'error') {
      const urls = getResultUrls(job);
      if (
        projectStatus === 'completed'
        && module === MODULE_VALUES.ONE_CLICK
        && String(job.taskType || '') === 'kie_chat'
        && urls.length === 0
      ) {
        const matchedProject = findPersistedPlanningProjectForJob(job, persistedProjects);
        const planningText = String((job.result as any)?.content || (job.result as any)?.text || '').trim();
        const parsedPlans = attachReferenceUrlToPlans(
          backfillDetailPageSetReplicationPlans(parseOneClickPlanningText(planningText, job.id), job.id, job.payload),
          getPlanningReferenceUrls(job.payload),
        );
        const payloadProjectId = String((job.payload as any)?.shellProjectId || '').trim();
        const isTrackedPlanningJob = Boolean(
          payloadProjectId
          || String((job.payload as any)?.shellPlanningPurpose || '').trim() === 'one_click_planning',
        );
        if (parsedPlans.length === 0) {
          if (!matchedProject && !isTrackedPlanningJob) return;
          const cleanProject = matchedProject
            ? removePlanningJobPendingPlaceholders(matchedProject, job)
            : undefined;
          const hasRecoveredOutcome = Boolean(cleanProject && (
            (cleanProject.plans || []).length > 0
            || (cleanProject.results || []).some(hasConcretePlanningRecoveryResult)
          ));
          if (hasRecoveredOutcome) return;
          const providerTaskId = getPlanningProviderTaskId(job);
          const inferredSubFeature = cleanProject?.subFeature
            || getStructuredOneClickJobSubFeature(job.payload)
            || normalizeJobSubFeature(module, job.taskType, { ...job.payload, prompt: planningText });
          const errorMessage = String(
            job.errorMessage
            || job.errorCode
            || planningText
            || '策划返回未解析出可用方案'
          ).trim();
          const errorProjectId = cleanProject?.id || payloadProjectId || `job-${job.id}`;
          const errorProjectName = cleanProject?.name
            || String((job.payload as any)?.shellProjectName || '').trim()
            || prompt.slice(0, 28)
            || MODULE_LABELS[module]
            || '一键主详策划';
          const failedPlan = buildFailedOneClickPlanningPlan(job, errorProjectName, errorMessage);
          projects.push({
            ...(cleanProject || {}),
            id: errorProjectId,
            name: errorProjectName,
            module,
            status: 'error',
            createdAt: cleanProject?.createdAt || createdAt,
            results: [buildFailedPlanningResult({
              jobId: job.id,
              payloadPlanId,
              failedPlanId: failedPlan.id,
              selectedPlanId: cleanProject?.selectedPlanId,
              projectId: errorProjectId,
              errorMessage,
              fallbackPrompt: prompt,
              model: normalizeModel(job.payload?.model || job.result?.model || job.provider),
              aspectRatio: String(job.payload?.aspectRatio || job.payload?.ratio || job.result?.aspectRatio || 'auto'),
              createdAt,
              module,
              subFeature: inferredSubFeature,
              providerTaskId,
              creditsConsumed: normalizeCreditsConsumed(job.result?.creditsConsumed),
            })],
            plans: mergeProjectPlansById(cleanProject?.plans, [failedPlan]),
            selectedPlanId: cleanProject?.selectedPlanId,
            taskCount: Math.max(Number(cleanProject?.taskCount || 0) || 0, getPlanningReferenceIndex(job), 1),
            completedCount: 0,
            subFeature: inferredSubFeature,
            sourceType: cleanProject?.sourceType || (matchedProject ? 'persisted' : 'job'),
            backendJobId: job.id,
            creditsConsumed: normalizeCreditsConsumed(job.result?.creditsConsumed) || cleanProject?.creditsConsumed,
            planningTaskId: latestIdentityTextList(cleanProject?.planningTaskId, providerTaskId || undefined),
            error: errorMessage,
          });
          return;
        }
        if (!matchedProject) {
          if (!isTrackedPlanningJob) return;
          const inferredSubFeature = getStructuredOneClickJobSubFeature(job.payload)
            || normalizeJobSubFeature(module, job.taskType, { ...job.payload, prompt: planningText });
          projects.push({
            id: payloadProjectId || `job-${job.id}`,
            name: String((job.payload as any)?.shellProjectName || '').trim()
              || parsedPlans[0]?.title
              || prompt.slice(0, 28)
              || '一键主详策划',
            module,
            status: 'planning',
            createdAt,
            results: [],
            taskCount: parsedPlans.length,
            completedCount: 0,
            subFeature: inferredSubFeature,
            sourceType: 'job',
            backendJobId: job.id,
            creditsConsumed: normalizeCreditsConsumed((job.result as any)?.creditsConsumed),
            planningTaskId: String(job.providerTaskId || (job.result as any)?.providerTaskId || '').trim() || undefined,
            plans: parsedPlans,
            selectedPlanId: parsedPlans.find((plan) => plan.selected)?.id || parsedPlans[0]?.id,
          });
          return;
        }
        const planningProject = removePlanningJobPendingPlaceholders(matchedProject, job);
        const hasExistingConcreteResults = (planningProject.results || []).some(hasConcretePlanningRecoveryResult);
        if ((planningProject.plans || []).length > 0) {
          if (hasExistingConcreteResults || Number(planningProject.completedCount || 0) > 0) {
            const completedCount = (planningProject.results || []).filter(hasCompletedMediaResult).length;
            const taskCount = Math.max(
              Number(planningProject.taskCount || 0) || 0,
              planningProject.plans?.length || 0,
              planningProject.results?.length || 0,
              1,
            );
            projects.push({
              ...planningProject,
              status: completedCount >= taskCount
                ? 'completed'
                : hasPendingSelectedPlan(planningProject.plans, planningProject.results || [])
                  ? 'planning'
                  : planningProject.status,
              taskCount,
              completedCount,
              creditsConsumed: normalizeCreditsConsumed((job.result as any)?.creditsConsumed) || planningProject.creditsConsumed,
              planningTaskId: latestIdentityTextList(
                planningProject.planningTaskId,
                String(job.providerTaskId || (job.result as any)?.providerTaskId || '').trim() || undefined,
              ),
            });
            return;
          }
          const planningTaskId = String(job.providerTaskId || (job.result as any)?.providerTaskId || '').trim();
          projects.push({
            ...planningProject,
            status: 'planning',
            backendJobId: job.id,
            results: [],
            creditsConsumed: normalizeCreditsConsumed((job.result as any)?.creditsConsumed) || planningProject.creditsConsumed,
            planningTaskId: latestIdentityTextList(planningProject.planningTaskId, planningTaskId),
            taskCount: Math.max(planningProject.plans?.length || 0, 1),
            completedCount: 0,
          });
          return;
        }
        const plans = parsedPlans;
        if (plans.length === 0) return;
        if (hasExistingConcreteResults || Number(matchedProject.completedCount || 0) > 0) {
          const planningProject = removePlanningJobPendingPlaceholders(matchedProject, job);
          const completedCount = (planningProject.results || []).filter(hasCompletedMediaResult).length;
          const taskCount = Math.max(
            Number(planningProject.taskCount || 0) || 0,
            plans.length,
            planningProject.results?.length || 0,
            1,
          );
          projects.push({
            ...planningProject,
            status: completedCount >= taskCount
              ? 'completed'
              : hasPendingSelectedPlan(plans, planningProject.results || [])
                ? 'planning'
                : planningProject.status,
            taskCount,
            completedCount,
            creditsConsumed: planningProject.creditsConsumed || normalizeCreditsConsumed(job.result?.creditsConsumed),
            planningTaskId: latestIdentityTextList(
              planningProject.planningTaskId,
              String(job.providerTaskId || job.result?.providerTaskId || '').trim() || undefined,
            ),
            plans,
            selectedPlanId: planningProject.selectedPlanId || plans.find((plan) => plan.selected)?.id || plans[0]?.id,
          });
          return;
        }
        const inferredSubFeature = getStructuredOneClickJobSubFeature(job.payload)
          || normalizeJobSubFeature(module, job.taskType, { ...job.payload, prompt: planningText });
        projects.push({
          ...matchedProject,
          id: matchedProject.id,
          name: matchedProject.name || plans[0]?.title || prompt.slice(0, 28) || '一键主详策划',
          module,
          status: 'planning',
          createdAt: matchedProject.createdAt || createdAt,
          results: [],
          taskCount: plans.length,
          completedCount: 0,
          subFeature: matchedProject.subFeature || inferredSubFeature,
          sourceType: matchedProject.sourceType || 'persisted',
          backendJobId: job.id,
          creditsConsumed: normalizeCreditsConsumed(job.result?.creditsConsumed),
          planningTaskId: String(job.providerTaskId || job.result?.providerTaskId || '').trim() || undefined,
          plans,
          selectedPlanId: plans.find((plan) => plan.selected)?.id || plans[0]?.id,
        });
        return;
      }
      if (
        projectStatus === 'completed'
        && module === MODULE_VALUES.VIDEO
        && String(job.taskType || '') === 'kie_chat'
        && urls.length === 0
      ) {
        const matchedProject = findPersistedStoryboardPlanningProjectForJob(job, persistedProjects);
        if (!matchedProject) return;
        const planningTaskId = String(job.providerTaskId || job.result?.providerTaskId || '').trim();
        projects.push({
          ...matchedProject,
          backendJobId: job.id,
          creditsConsumed: normalizeCreditsConsumed(job.result?.creditsConsumed) || matchedProject.creditsConsumed,
          planningTaskId: latestIdentityTextList(matchedProject.planningTaskId, planningTaskId),
        });
        return;
      }
      if (projectStatus === 'error' && urls.length === 0) {
        const matchedProject = findPersistedPlanningProjectForJob(job, persistedProjects);
        const payloadProjectId = String(job.payload?.shellProjectId || '').trim();
        if (isSubtitleRemovalJob(job, module)) {
          const errorMessage = String(job.errorMessage || providerErrorText || job.errorCode || '去字幕任务失败').trim();
          const providerTaskId = String(job.providerTaskId || job.result?.providerTaskId || '').trim();
          const subtitleRemovalMetadata = getSubtitleRemovalResultMetadata(job);
          const failedResult: ShellGeneratedResult = {
            id: String(
              subtitleRemovalMetadata.shellResultId
              || matchedProject?.results?.find((result) => String(result.backendJobId || '').trim() === String(job.id || '').trim())?.id
              || `${job.id}-result-1`,
            ),
            projectId: matchedProject?.id || payloadProjectId || projectId,
            imageUrl: '',
            videoUrl: undefined,
            mediaType: 'video',
            prompt: '去除选定区域内的视频字幕',
            model: normalizeModel(job.payload?.model || job.result?.model || job.provider),
            aspectRatio: 'auto',
            status: 'error',
            createdAt,
            module,
            subFeature: 'subtitle_removal',
            taskId: providerTaskId || undefined,
            backendJobId: job.id,
            error: errorMessage,
            errorCode: String(job.errorCode || '').trim() || undefined,
            ...subtitleRemovalMetadata,
          };
          projects.push({
            ...(matchedProject || {}),
            id: matchedProject?.id || payloadProjectId || projectId,
            name: matchedProject?.name || payloadProjectName || '视频去字幕',
            module,
            status: 'error',
            createdAt: matchedProject?.createdAt || createdAt,
            completedAt: toCreatedMs(job.finishedAt || job.updatedAt || job.createdAt),
            results: [failedResult],
            taskCount: Math.max(Number(subtitleRemovalMetadata.batchCount || 0) || 0, 1),
            completedCount: 0,
            subFeature: 'subtitle_removal',
            sourceType: matchedProject?.sourceType || 'job',
            backendJobId: job.id,
            error: errorMessage,
          });
          return;
        }
        const isTrackedOneClickPlanningJob = Boolean(
          module === MODULE_VALUES.ONE_CLICK
          && String(job.taskType || '') === 'kie_chat'
          && (
            payloadProjectId
            || String(job.payload?.shellPlanningPurpose || '').trim() === 'one_click_planning'
          )
        );
        const errorMessage = String(job.errorMessage || providerErrorText || job.errorCode || '任务失败').trim();
        const providerTaskId = String(job.providerTaskId || job.result?.providerTaskId || '').trim();
        const isProductRestoreImageFailure = Boolean(
          matchedProject?.subFeature === 'product_restore'
          && String(job.payload?.taskPurpose || '').trim() === 'product_restore_generation'
        );
        if (matchedProject && isProductRestoreImageFailure) {
          const failedResult: ShellGeneratedResult = {
            id: String(providerTaskId || job.id),
            projectId: matchedProject.id,
            imageUrl: '',
            prompt,
            model: normalizeModel(job.payload?.model || job.result?.model || job.provider),
            aspectRatio: String(job.payload?.aspectRatio || job.payload?.ratio || job.result?.aspectRatio || 'auto'),
            status: 'error',
            createdAt,
            module,
            subFeature: 'product_restore',
            taskId: providerTaskId || undefined,
            backendJobId: job.id,
            batchIndex: Number(job.payload?.batchIndex || 0) || undefined,
            targetMaterialId: String(job.payload?.targetMaterialId || '').trim() || undefined,
            creditsConsumed: normalizeCreditsConsumed(job.result?.creditsConsumed),
            error: errorMessage,
          };
          projects.push({
            ...matchedProject,
            status: 'error',
            results: [failedResult],
            taskCount: Math.max(
              Number(matchedProject.taskCount || 0) || 0,
              Number(job.payload?.batchCount || 0) || 0,
              1,
            ),
            completedCount: 0,
            backendJobId: matchedProject.backendJobId || String(job.payload?.analysisJobId || '').trim() || job.id,
            error: errorMessage,
          });
          return;
        }
        if (!matchedProject) {
          const shouldShowUntrackedTerminalFailure = String(job.taskType || '') === 'kie_chat' || Boolean(providerErrorText);
          if (!isTrackedOneClickPlanningJob && !shouldShowUntrackedTerminalFailure) return;
          const inferredSubFeature = getStructuredOneClickJobSubFeature(job.payload)
            || normalizeJobSubFeature(module, job.taskType, job.payload);
          const projectName = String(job.payload?.shellProjectName || '').trim()
            || prompt.slice(0, 28)
            || MODULE_LABELS[module]
            || '一键主详策划';
          const failedPlan = isTrackedOneClickPlanningJob
            ? buildFailedOneClickPlanningPlan(job, projectName, errorMessage)
            : undefined;
          const projectId = payloadProjectId || `job-${job.id}`;
          projects.push({
            id: projectId,
            name: projectName,
            module,
            status: 'error',
            createdAt,
            results: [buildFailedPlanningResult({
              jobId: job.id,
              payloadPlanId,
              failedPlanId: failedPlan?.id,
              projectId,
              errorMessage,
              fallbackPrompt: prompt,
              model: normalizeModel(job.payload?.model || job.result?.model || job.provider),
              aspectRatio: String(job.payload?.aspectRatio || job.payload?.ratio || job.result?.aspectRatio || 'auto'),
              createdAt,
              module,
              subFeature: inferredSubFeature,
              providerTaskId,
              creditsConsumed: normalizeCreditsConsumed(job.result?.creditsConsumed),
            })],
            plans: failedPlan ? [failedPlan] : [],
            taskCount: Math.max(getPlanningReferenceIndex(job), 1),
            completedCount: 0,
            subFeature: inferredSubFeature,
            sourceType: 'job',
            backendJobId: job.id,
            planningTaskId: providerTaskId || undefined,
            error: errorMessage,
          });
          return;
        }
        const failedPlan = isTrackedOneClickPlanningJob
          ? buildFailedOneClickPlanningPlan(job, matchedProject.name || String(job.payload?.shellProjectName || '').trim(), errorMessage)
          : undefined;
        projects.push({
          ...matchedProject,
          id: matchedProject.id,
          name: matchedProject.name || prompt.slice(0, 28) || MODULE_LABELS[module] || String(job.taskType || '生成任务'),
          module,
          status: 'error',
          createdAt: matchedProject.createdAt || createdAt,
          results: [buildFailedPlanningResult({
            jobId: job.id,
            payloadPlanId,
            failedPlanId: failedPlan?.id,
            selectedPlanId: matchedProject.selectedPlanId,
            projectId: matchedProject.id,
            errorMessage,
            fallbackPrompt: prompt,
            model: normalizeModel(job.payload?.model || job.result?.model || job.provider),
            aspectRatio: String(job.payload?.aspectRatio || job.payload?.ratio || job.result?.aspectRatio || 'auto'),
            createdAt,
            module,
            subFeature: matchedProject.subFeature || subFeature,
            providerTaskId,
            creditsConsumed: normalizeCreditsConsumed(job.result?.creditsConsumed),
          })],
          plans: failedPlan ? mergeProjectPlansById(matchedProject.plans, [failedPlan]) : matchedProject.plans,
          selectedPlanId: matchedProject.selectedPlanId,
          taskCount: failedPlan
            ? Math.max(Number(matchedProject.taskCount || 0) || 0, getPlanningReferenceIndex(job), 1)
            : Math.max(Number(matchedProject.taskCount || 0) || 0, 1),
          completedCount: matchedProject.completedCount || 0,
          subFeature: matchedProject.subFeature || subFeature,
          sourceType: matchedProject.sourceType || 'persisted',
          backendJobId: job.id,
          planningTaskId: latestIdentityTextList(matchedProject.planningTaskId, providerTaskId || undefined),
          error: errorMessage,
        });
        return;
      }
      if (
        module === MODULE_VALUES.ONE_CLICK
        && String(job.taskType || '').includes('image')
      ) {
        const matchedProject = findPersistedPlanningProjectForJob(job, persistedProjects);
        if (!matchedProject) return;
        if (projectStatus === 'completed' && urls.length === 0) return;
        const providerTaskId = String(job.providerTaskId || job.result?.providerTaskId || '').trim();
        if (hasPersistedTerminalJobResult({
          results: matchedProject.results,
          jobId: job.id,
          providerTaskId,
          payloadPlanId,
          incomingHasMedia: projectStatus === 'completed' && urls.length > 0,
        })) return;
        const nextJobResults: ShellGeneratedResult[] = urls.length > 0
          ? urls.map((url, index) => ({
              id: String(job.providerTaskId || job.result?.providerTaskId || `${job.id}-result-${index + 1}`),
              planId: payloadPlanId || matchedProject.selectedPlanId || matchedProject.plans?.[index]?.id,
              projectId: matchedProject.id,
              imageUrl: url,
              mediaType: 'image',
              prompt,
              model: normalizeModel(job.payload?.model || job.result?.model || job.provider),
              aspectRatio: String(job.payload?.aspectRatio || job.payload?.ratio || job.result?.aspectRatio || 'auto'),
              status: 'completed',
              createdAt,
              module,
              subFeature: matchedProject.subFeature || subFeature,
              taskId: String(job.providerTaskId || job.result?.providerTaskId || '').trim() || undefined,
              backendJobId: job.id,
              creditsConsumed: normalizeCreditsConsumed(job.result?.creditsConsumed),
            }))
          : [];
        const incomingKeys = new Set(nextJobResults.flatMap((result) => getGeneratedResultMergeKeys(result)));
        const existingResults = (matchedProject.results || []).filter((result) => {
          if ((matchedProject.subFeature || subFeature) !== 'first_image' && payloadPlanId && String(result.planId || '').trim() === payloadPlanId) {
            return false;
          }
          const keys = getGeneratedResultMergeKeys(result);
          return !keys.some((key) => incomingKeys.has(key));
        });
        const mergedResults = [...existingResults, ...nextJobResults];
        const completedCount = mergedResults.filter((result) => result.status === 'completed' && (result.imageUrl || result.videoUrl)).length;
        const taskCount = Math.max(
          Number(matchedProject.taskCount || 0) || 0,
          Number(job.payload?.batchCount || 0) || 0,
          matchedProject.plans?.length || 0,
          mergedResults.length,
          1,
        );
        projects.push({
          ...matchedProject,
          status: completedCount >= taskCount ? 'completed' : 'generating',
          completedAt: completedCount >= taskCount ? toCreatedMs(job.finishedAt || job.updatedAt || job.createdAt) : matchedProject.completedAt,
          results: mergedResults,
          taskCount,
          completedCount,
          subFeature: matchedProject.subFeature || subFeature,
          sourceType: matchedProject.sourceType || 'persisted',
          backendJobId: job.id,
          selectedPlanId: payloadPlanId || matchedProject.selectedPlanId,
          creditsConsumed: normalizeCreditsConsumed(matchedProject.creditsConsumed) || normalizeCreditsConsumed(job.result?.creditsConsumed),
        });
        return;
      }
      const matchedTerminalProject = findPersistedPlanningProjectForJob(job, persistedProjects);
      if (matchedTerminalProject && projectStatus === 'completed' && urls.length > 0) {
        const providerTaskId = String(job.providerTaskId || job.result?.providerTaskId || '').trim();
        const nextJobResults: ShellGeneratedResult[] = urls.map((url, index) => {
          const subtitleRemovalMetadata = getSubtitleRemovalResultMetadata(job);
          return {
          id: String(subtitleRemovalMetadata.shellResultId || providerTaskId || `${job.id}-result-${index + 1}`),
          planId: payloadPlanId || matchedTerminalProject.selectedPlanId || matchedTerminalProject.plans?.[index]?.id,
          projectId: matchedTerminalProject.id,
          imageUrl: url,
          videoUrl: mediaType === 'video' ? url : undefined,
          mediaType: mediaType === 'video' ? 'video' : 'image',
          prompt,
          model: normalizeModel(job.payload?.model || job.result?.model || job.provider),
          aspectRatio: String(job.payload?.aspectRatio || job.payload?.ratio || job.result?.aspectRatio || 'auto'),
          status: 'completed',
          createdAt,
          module,
          subFeature: matchedTerminalProject.subFeature || subFeature,
          taskId: String(providerTaskId || '').trim() || undefined,
          backendJobId: job.id,
          batchIndex: Number(job.payload?.batchIndex || 0) || undefined,
          targetMaterialId: String(job.payload?.targetMaterialId || '').trim() || undefined,
          creditsConsumed: normalizeCreditsConsumed(job.result?.creditsConsumed),
          ...subtitleRemovalMetadata,
        };
        });
        const incomingKeys = new Set(nextJobResults.flatMap((result) => getGeneratedResultMergeKeys(result)));
        const existingResults = (matchedTerminalProject.results || []).filter((result) => {
          const keys = getGeneratedResultMergeKeys(result);
          return !keys.some((key) => incomingKeys.has(key));
        });
        const mergedResults = [...existingResults, ...nextJobResults];
        const completedCount = mergedResults.filter(hasCompletedMediaResult).length;
        const taskCount = Math.max(
          Number(matchedTerminalProject.taskCount || 0) || 0,
          Number(job.payload?.batchCount || job.payload?.count || 0) || 0,
          mergedResults.length,
          1,
        );
        projects.push({
          ...matchedTerminalProject,
          status: completedCount >= taskCount ? 'completed' : 'generating',
          completedAt: completedCount >= taskCount ? toCreatedMs(job.finishedAt || job.updatedAt || job.createdAt) : matchedTerminalProject.completedAt,
          results: mergedResults,
          taskCount,
          completedCount,
          subFeature: matchedTerminalProject.subFeature || subFeature,
          sourceType: matchedTerminalProject.sourceType || 'persisted',
          backendJobId: matchedTerminalProject.subFeature === 'product_restore'
            ? (matchedTerminalProject.backendJobId || job.id)
            : job.id,
          creditsConsumed: normalizeCreditsConsumed(matchedTerminalProject.creditsConsumed) || normalizeCreditsConsumed(job.result?.creditsConsumed),
        });
        return;
      }
      if (isJobAlreadyPersisted(job, persistedJobKeys)) return;
      if (projectStatus === 'completed' && urls.length === 0) return;
      if (
        projectStatus === 'completed'
        && module === MODULE_VALUES.ONE_CLICK
        && String(job.taskType || '').includes('image')
      ) return;
      const resultItems = urls.length > 0
        ? urls.map((url, index) => ({
            id: `${job.id}-result-${index + 1}`,
            resultUrl: url,
            videoUrl: mediaType === 'video' ? url : undefined,
            status: job.status,
            prompt,
            payload: job.payload,
            result: job.result,
            model: job.payload?.model || job.result?.model || job.provider,
            aspectRatio: job.payload?.aspectRatio || job.payload?.ratio || job.result?.aspectRatio,
            taskId: job.providerTaskId || job.result?.providerTaskId,
            backendJobId: job.id,
            creditsConsumed: job.result?.creditsConsumed,
            subFeature,
          }))
        : [{
            id: `${job.id}-result-1`,
            status: job.status,
            prompt: job.errorMessage || prompt,
            payload: job.payload,
            result: job.result,
            model: job.payload?.model || job.result?.model || job.provider,
            aspectRatio: job.payload?.aspectRatio || job.payload?.ratio || job.result?.aspectRatio,
            taskId: job.providerTaskId || job.result?.providerTaskId,
            backendJobId: job.id,
            error: job.errorMessage || job.errorCode || '任务失败',
            subFeature,
          }];
      const project = projectFromItems(
        projectId,
        payloadProjectName || prompt.slice(0, 28) || MODULE_LABELS[module] || String(job.taskType || '生成任务'),
        module,
        job.finishedAt || job.updatedAt || job.createdAt,
        resultItems,
        subFeature,
        prompt,
        undefined,
        undefined,
        undefined,
        job.result?.creditsConsumed,
      );
      if (project) {
        projects.push({
          ...project,
          status: projectStatus,
          sourceType: 'job',
          backendJobId: job.id,
          taskCount: Math.max(project.taskCount, Number(job.payload?.batchCount || 0) || 0),
          completedAt: projectStatus === 'completed' ? toCreatedMs(job.finishedAt || job.updatedAt || job.createdAt) : project.completedAt,
        });
      }
      return;
    }

    if (projectStatus === 'generating' || projectStatus === 'planning') {
      const matchedProject = findPersistedPlanningProjectForJob(job, persistedProjects);
      if (isTrackedOneClickPlanningJob(job, module)) {
        const cleanProject = matchedProject
          ? removePlanningJobPendingPlaceholders(matchedProject, job)
          : undefined;
        const activeProjectId = cleanProject?.id || payloadProjectId || projectId;
        const planningPrompt = extractChatPromptText((job.payload || {}) as Record<string, unknown>) || prompt;
        const providerTaskId = getPlanningProviderTaskId(job);
        const activeTask: ShellTaskData = {
          id: job.id,
          projectId: activeProjectId,
          module,
          type: 'plan',
          status: taskStatusToTask(job.status),
          title: jobTaskTitle(job, module, subFeature),
          prompt: planningPrompt,
          progress: job.status === 'running' ? 42 : 8,
          createdAt,
          subFeature: cleanProject?.subFeature || subFeature,
          backendJobId: job.id,
        };
        projects.push({
          ...(cleanProject || {}),
          id: activeProjectId,
          name: cleanProject?.name
            || payloadProjectName
            || MODULE_LABELS[module]
            || '一键主详策划',
          module,
          status: projectStatus,
          createdAt: cleanProject?.createdAt || createdAt,
          results: cleanProject?.results || [],
          taskCount: Math.max(
            Number(cleanProject?.taskCount || 0) || 0,
            cleanProject?.plans?.length || 0,
            1,
          ),
          completedCount: cleanProject?.completedCount || 0,
          subFeature: cleanProject?.subFeature || subFeature,
          sourceType: cleanProject?.sourceType || 'job',
          backendJobId: job.id,
          planningTaskId: latestIdentityTextList(cleanProject?.planningTaskId, providerTaskId || undefined),
        });
        tasks.push(activeTask);
        return;
      }
      if (
        module === MODULE_VALUES.ONE_CLICK
        && String(job.taskType || '').includes('image')
        && !matchedProject
      ) {
        return;
      }
      const activeProjectId = matchedProject?.id || payloadProjectId || projectId;
      const visibleProviderTaskId = getVisibleProviderTaskId(job);
      const activeTask: ShellTaskData = {
        id: job.id,
        projectId: activeProjectId,
        module,
        type: mediaType === 'video' ? 'video' : 'image',
        status: taskStatusToTask(job.status),
        title: jobTaskTitle(job, module, subFeature),
        prompt,
        progress: job.status === 'running' ? 42 : 8,
        createdAt,
        subFeature,
        backendJobId: job.id,
      };
      if (!shouldExposeActiveJobResult({ job, module, payloadProjectId })) {
        tasks.push(activeTask);
        return;
      }
      const activeResult: ShellGeneratedResult = {
        id: getSubtitleRemovalResultMetadata(job).shellResultId || `${job.id}-pending`,
        planId: payloadPlanId || matchedProject?.selectedPlanId,
        projectId: activeProjectId,
        imageUrl: '',
        videoUrl: undefined,
        mediaType: mediaType === 'video' ? 'video' : 'image',
        prompt,
        model: normalizeModel(job.payload?.model || job.result?.model || job.provider),
        aspectRatio: String(job.payload?.aspectRatio || job.payload?.ratio || job.result?.aspectRatio || 'auto'),
        status: job.status === 'retry_waiting' ? 'retry_waiting' : 'generating',
        createdAt,
        module,
        subFeature: matchedProject?.subFeature || subFeature,
        taskId: visibleProviderTaskId || undefined,
        backendJobId: job.id,
        batchIndex: toOptionalInteger(job.payload?.batchIndex),
        targetMaterialId: String(job.payload?.targetMaterialId || '').trim() || undefined,
        error: job.status === 'queued' ? '任务已提交，等待执行' : job.status === 'retry_waiting' ? '任务重试中' : '任务正在运行',
        ...getSubtitleRemovalResultMetadata(job),
      };
      const existingActiveResults = matchedProject?.results || [];
      const hasActiveResult = existingActiveResults.some((result) => (
        String(result.backendJobId || '').trim() === job.id
        || (activeResult.taskId && String(result.taskId || '').trim() === activeResult.taskId)
      ));
      const activeResults: ShellGeneratedResult[] = existingActiveResults.length > 0
        ? (hasActiveResult ? existingActiveResults : [...existingActiveResults, activeResult])
        : [activeResult];
      const activeTaskCount = Math.max(
        Number(matchedProject?.taskCount || 0) || 0,
        Number(job.payload?.batchCount || job.payload?.count || 0) || 0,
        activeResults.length,
        1,
      );
      projects.push({
        ...(matchedProject || {}),
        id: activeProjectId,
        name: matchedProject?.name || payloadProjectName || prompt.slice(0, 28) || MODULE_LABELS[module] || String(job.taskType || '生成任务'),
        module,
        status: projectStatus,
        createdAt: matchedProject?.createdAt || createdAt,
        results: activeResults,
        taskCount: activeTaskCount,
        completedCount: matchedProject?.completedCount || 0,
        subFeature: matchedProject?.subFeature || subFeature,
        sourceType: matchedProject?.sourceType || 'job',
        backendJobId: matchedProject?.subFeature === 'product_restore'
          ? (matchedProject.backendJobId || job.id)
          : job.id,
      });
      tasks.push(activeTask);
    }
  });

  return { projects, tasks };
};

const toIdSet = (values: unknown) => new Set(
  (Array.isArray(values) ? values : [])
    .map((value) => String(value || '').trim())
    .filter(Boolean),
);

const filterDeletedProjects = (
  projects: ShellProjectData[],
  state?: Partial<PersistedAppState> | null,
) => {
  const deletedProjectIds = toIdSet(state?.shellDraft?.deletedProjectIds);
  const deletedJobIds = toIdSet(state?.shellDraft?.deletedJobIds);
  const deletedResultIds = toIdSet(state?.shellDraft?.deletedResultIds);
  if (deletedProjectIds.size === 0 && deletedJobIds.size === 0 && deletedResultIds.size === 0) return projects;

  return projects.flatMap((project) => {
    const projectIds = [
      project.id,
      project.backendJobId,
      ...splitIdentityText(project.planningTaskId),
      project.id.startsWith('job-') ? project.id.slice(4) : '',
    ].map((value) => String(value || '').trim()).filter(Boolean);
    if (projectIds.some((id) => deletedProjectIds.has(id) || deletedJobIds.has(id))) return [];

    const nextResults = project.results.filter((result) => {
      const resultIds = [
        result.id,
        result.taskId,
        result.backendJobId,
      ].map((value) => String(value || '').trim()).filter(Boolean);
      return !resultIds.some((id) => deletedResultIds.has(id) || deletedJobIds.has(id));
    });

    if (project.results.length > 0 && nextResults.length === 0 && !project.plans?.length) return [];
    return [{ ...project, results: nextResults }];
  });
};

const filterLegacyShellControlJobGhosts = (
  projects: ShellProjectData[],
  jobs: InternalJob[] = [],
) => {
  const unboundControlJobIds = new Set(
    jobs
      .filter((job) => {
        const module = toModule(job.module);
        if (module === MODULE_VALUES.ONE_CLICK || !isShellControlJob(job, module)) return false;
        return !String(job.payload?.shellProjectId || '').trim();
      })
      .map((job) => String(job.id || '').trim())
      .filter(Boolean),
  );
  return projects.filter((project) => {
    const projectId = String(project.id || '').trim();
    if (!projectId.startsWith('job-')) return true;
    const syntheticJobId = projectId.slice(4);
    if (unboundControlJobIds.has(syntheticJobId)) return false;
    const belongsToControlJobModule = isShellControlJob({
      module: project.module,
      taskType: 'kie_chat',
      payload: {},
    }, project.module);
    const isStructurallyEmptyLegacyJobCard = (
      belongsToControlJobModule
      && String(project.backendJobId || '').trim() === syntheticJobId
      && (project.results || []).length === 0
      && (project.plans || []).length === 0
      && (project.status === 'generating' || project.status === 'planning')
      && Number(project.taskCount || 0) <= 1
      && Number(project.completedCount || 0) === 0
    );
    return !isStructurallyEmptyLegacyJobCard;
  });
};

const shouldReplaceProjectSnapshot = (existing: ShellProjectData | undefined, next: ShellProjectData) => {
  if (!existing) return true;
  if (
    existing.module === MODULE_VALUES.BUYER_SHOW
    && next.module === MODULE_VALUES.BUYER_SHOW
    && next.sourceType === 'job'
  ) {
    return true;
  }
  const existingHasResults = (existing.results || []).some((result) => result.imageUrl || result.videoUrl || result.status === 'error');
  const nextHasResults = (next.results || []).some((result) => result.imageUrl || result.videoUrl || result.status === 'error');
  if (
    nextHasResults
    && hasOnlyStalePlanningFailureResults(next)
    && existing.status === 'planning'
    && (existing.plans || []).length > 0
    && (
      !String(next.backendJobId || '').trim()
      || String(existing.backendJobId || '') === String(next.backendJobId || '')
    )
  ) {
    return false;
  }
  if (existingHasResults && !nextHasResults && (next.status === 'planning' || next.status === 'generating')) {
    const restoresCompletedPlanning = next.status === 'planning'
      && (next.plans || []).length > 0
      && hasOnlyStalePlanningFailureResults(existing)
      && String(existing.backendJobId || '') === String(next.backendJobId || '');
    if (!restoresCompletedPlanning) return false;
  }
  if (existing.status === 'completed' && next.status === 'planning') {
    const existingCompletedCount = (existing.results || []).filter(hasCompletedMediaResult).length;
    const nextPlanCount = (next.plans || []).length;
    if (nextPlanCount <= existingCompletedCount) return false;
  }
  return true;
};

const hasCompletedMediaResult = (result: ShellGeneratedResult) =>
  result.status === 'completed' && Boolean(result.imageUrl || result.videoUrl);

const resultHasMedia = (result: Partial<ShellGeneratedResult>) => Boolean(result.imageUrl || result.videoUrl);

const resultHasRuntimeIdentity = (result: Partial<ShellGeneratedResult>) => Boolean(
  String(
    result.taskId
    || result.backendJobId
    || (result as Record<string, unknown>).providerTaskId
    || (result as Record<string, unknown>).kieTaskId
    || ''
  ).trim(),
);

const resultHasProviderTaskIdentity = (result: Partial<ShellGeneratedResult>) => Boolean(
  String(result.taskId || '').trim(),
);

const isTerminalBackendFailureResult = (result: Partial<ShellGeneratedResult>) => (
  result.status === 'error'
  && !resultHasMedia(result)
  && Boolean(String(result.backendJobId || '').trim())
);

const isStaleRuntimePlaceholderResult = (result: Partial<ShellGeneratedResult>) => (
  (result.status === 'error' || result.status === 'generating')
  && !resultHasMedia(result)
  && !resultHasRuntimeIdentity(result)
);

const isTransientNoIdentityRuntimePlaceholderResult = (result: Partial<ShellGeneratedResult>) => {
  if (!['error', 'failed', 'generating', 'pending', 'queued'].includes(String(result.status || ''))) return false;
  if (resultHasMedia(result)) return false;
  if (resultHasRuntimeIdentity(result)) return false;
  const message = String(
    result.error
    || result.prompt
    || (result as Record<string, unknown>).message
    || (result as Record<string, unknown>).detail
    || ''
  ).trim();
  return /网络连接失败|请求超时|failed to fetch|fetch failed|dynamically imported module|任务状态同步失败|任务已提交云端|结果待同步/i.test(message);
};

const isProviderPollutionText = (value: unknown) => {
  return isProviderPollutionTextCore(value);
};

const normalizeInvalidPlanAsFailedPlanningCard = (
  plan: NonNullable<ShellProjectData['plans']>[number],
): NonNullable<ShellProjectData['plans']>[number] => {
  if (plan?.planningFailed || !isInvalidOneClickPlanLike(plan)) return plan;
  const message = getOneClickPlanContent(plan) || String(plan?.error || '').trim() || '策划失败';
  return {
    ...plan,
    selected: false,
    status: 'error' as const,
    error: message,
    planningFailed: true,
    schemeContent: message,
    sceneDescription: String(plan?.sceneDescription || '').trim() || message,
    textLayout: String(plan?.textLayout || '').trim() || message,
  };
};

const isInvalidNoIdentityOneClickResult = (result: Partial<ShellGeneratedResult>) => {
  if (!['error', 'failed', 'generating', 'pending', 'queued'].includes(String(result.status || ''))) return false;
  if (resultHasMedia(result)) return false;
  if (resultHasRuntimeIdentity(result)) return false;
  const message = String(
    result.error
    || result.prompt
    || (result as Record<string, unknown>).message
    || (result as Record<string, unknown>).detail
    || ''
  ).trim();
  return isProviderPollutionText(message);
};

const isStaleOneClickPlanningPlaceholderResult = (result: Partial<ShellGeneratedResult>) => (
  result.status === 'generating'
  && !resultHasMedia(result)
  && !String(result.taskId || '').trim()
  && Boolean(String(result.backendJobId || '').trim())
  && isOneClickPlanningPlaceholderText(result.prompt)
);

const isSameResultPlanScope = (
  left: Partial<ShellGeneratedResult>,
  right: Partial<ShellGeneratedResult>,
) => {
  const leftPlanId = String(left.planId || '').trim();
  const rightPlanId = String(right.planId || '').trim();
  if (leftPlanId && rightPlanId) return leftPlanId === rightPlanId;
  return !leftPlanId && !rightPlanId;
};

const isSupersededNoMediaErrorResult = (
  result: ShellGeneratedResult,
  completedPlanIds: Set<string>,
) => {
  const planId = String(result?.planId || '').trim();
  if (!planId || !completedPlanIds.has(planId)) return false;
  if (result.status !== 'error' || resultHasMedia(result)) return false;
  return true;
};

const pruneSupersededOneClickResults = (results: ShellGeneratedResult[] = []) => {
  const hasCompletedMedia = results.some(hasCompletedMediaResult);
  const completedPlanIds = new Set(
    results
      .filter(hasCompletedMediaResult)
      .map((result) => String(result.planId || '').trim())
      .filter(Boolean),
  );
  if (!hasCompletedMedia) return results;
  return results.filter((result) => (
    !isTransientNoIdentityRuntimePlaceholderResult(result)
    && !isSupersededNoMediaErrorResult(result, completedPlanIds)
  ));
};

const clearCompletedResultError = (result: ShellGeneratedResult): ShellGeneratedResult => {
  if (!hasCompletedMediaResult(result)) return result;
  return {
    ...result,
    error: undefined,
    errorCode: undefined,
  };
};

const isDirectVideoGenerationProject = (project?: Partial<ShellProjectData>) => (
  project?.module === MODULE_VALUES.VIDEO
  && project?.subFeature === 'generation'
);

const getMergedProjectTaskCount = (
  existing: ShellProjectData | undefined,
  next: ShellProjectData,
  plans: ShellProjectData['plans'],
  results: ShellGeneratedResult[],
  completedCount: number,
) => {
  if (next.module === MODULE_VALUES.BUYER_SHOW && next.sourceType === 'job') {
    return Math.max(
      Number(next.taskCount || 0) || 0,
      results.length,
      completedCount,
      1,
    );
  }
  if (!(plans || []).length && results.length === 1 && isTerminalBackendFailureResult(results[0])) {
    return 1;
  }
  if ((isDirectVideoGenerationProject(existing) || isDirectVideoGenerationProject(next)) && completedCount > 0) {
    return Math.max(results.length, completedCount, 1);
  }
  return Math.max(
    Number(existing?.taskCount || 0) || 0,
    Number(next.taskCount || 0) || 0,
    plans?.length || 0,
    results.length,
    getProductRestoreExpectedTargetCount({
      ...(existing || {}),
      ...next,
    }),
    1,
  );
};

const hasTerminalResultForPlan = (results: ShellGeneratedResult[] = [], planId: string) => (
  results.some((result) => (
    String(result.planId || '').trim() === planId
    && (
      hasCompletedMediaResult(result)
      || (result.status === 'generating' && resultHasProviderTaskIdentity(result))
      || result.status === 'error'
    )
  ))
);

const hasPendingSelectedPlan = (
  plans: ShellProjectData['plans'] = [],
  results: ShellGeneratedResult[] = [],
) => (
  (plans || []).some((plan) => {
    const planId = String(plan?.id || '').trim();
    return plan?.selected !== false && planId && !hasTerminalResultForPlan(results, planId);
  })
);

const normalizeOneClickProjectCard = (project: ShellProjectData): ShellProjectData => {
  if (project.module !== MODULE_VALUES.ONE_CLICK) return project;
  const rawPlans = Array.isArray(project.plans) ? project.plans : [];
  const invalidPlanIds = new Set(
    rawPlans
      .filter((plan) => !plan?.planningFailed && isInvalidOneClickPlanLike(plan))
      .map((plan) => String(plan?.id || '').trim())
      .filter(Boolean),
  );
  const plans = rawPlans
    .filter((plan) => !isStaleOneClickPlanningPlaceholderPlan(plan))
    .map(normalizeInvalidPlanAsFailedPlanningCard);
  const hasClientPlanIds = plans.some((plan) => {
    const id = String(plan?.id || '').trim();
    return id && !isPlanningGeneratedPlanId(id);
  });
  const filteredPlans = hasClientPlanIds
    ? plans.filter((plan) => !isPlanningGeneratedPlanId(plan?.id))
    : plans;
  const droppedPlanIds = new Set(
    plans
      .filter((plan) => !filteredPlans.some((kept) => String(kept?.id || '') === String(plan?.id || '')))
      .map((plan) => String(plan?.id || '').trim())
      .filter(Boolean),
  );

  let droppedInvalidCompletedMedia = false;
  let results = (project.results || []).filter((result) => {
    const planId = String(result?.planId || '').trim();
    const isInvalidCompletedMedia = hasCompletedMediaResult(result)
      && (
        isInvalidOneClickPlanText(result.prompt)
        || (planId && invalidPlanIds.has(planId))
      );
    if (isInvalidCompletedMedia) droppedInvalidCompletedMedia = true;
    const isInvalidNoIdentityFailure = isInvalidNoIdentityOneClickResult(result);
    const isNoIdentityFailureForFailedPlan = Boolean(
      planId
      && invalidPlanIds.has(planId)
      && !resultHasMedia(result)
      && !resultHasRuntimeIdentity(result)
      && ['error', 'failed', 'generating', 'pending', 'queued'].includes(String(result.status || '')),
    );
    return (!planId || !droppedPlanIds.has(planId))
      && !isStaleOneClickPlanningPlaceholderResult(result)
      && !isInvalidNoIdentityFailure
      && !isNoIdentityFailureForFailedPlan
      && !isInvalidCompletedMedia;
  });
  results = pruneSupersededOneClickResults(results);

  const completedCount = results.filter(hasCompletedMediaResult).length;
  const planCount = filteredPlans.length;
  const activeOrFailedCount = results.filter((result) => (
    (result.status === 'generating' && resultHasProviderTaskIdentity(result))
    || (result.status === 'error' && !resultHasMedia(result))
  )).length;
  const droppedInvalidPlanningArtifacts = invalidPlanIds.size > 0 || droppedInvalidCompletedMedia;
  const projectTaskCount = droppedInvalidPlanningArtifacts && completedCount === 0
    ? 0
    : Number(project.taskCount || 0) || 0;
  const hasSingleTerminalBackendFailure = filteredPlans.length === 0
    && results.length === 1
    && isTerminalBackendFailureResult(results[0]);
  const activeTaskBaseline = activeOrFailedCount > 0 && !hasSingleTerminalBackendFailure ? projectTaskCount : 0;
  const taskCount = planCount > 0
    ? Math.max(activeTaskBaseline, planCount, completedCount, activeOrFailedCount, 1)
    : hasSingleTerminalBackendFailure
      ? 1
      : Math.max(projectTaskCount, results.length, 1);
  const selectedPlanId = filteredPlans.some((plan) => String(plan?.id || '') === String(project.selectedPlanId || ''))
    ? project.selectedPlanId
    : filteredPlans.find((plan) => plan.selected)?.id || filteredPlans[0]?.id || project.selectedPlanId;
  const hasGenerating = results.some((result) => (result.status === 'generating' || result.status === 'retry_waiting') && resultHasRuntimeIdentity(result));
  const hasFailedPlan = filteredPlans.some((plan) => Boolean(plan?.planningFailed) || plan?.status === 'error');
  const hasError = hasFailedPlan || results.some((result) => result.status === 'error');
  const hasCompletedMedia = completedCount > 0;
  const status = hasCompletedMedia && !hasGenerating && !hasError
    ? 'completed'
    : completedCount >= taskCount
      ? 'completed'
      : hasGenerating
        ? 'generating'
        : hasError
          ? 'error'
          : hasPendingSelectedPlan(filteredPlans, results)
            ? 'planning'
            : project.status;

  return {
    ...project,
    status,
    plans: filteredPlans.length > 0 ? filteredPlans : rawPlans.length > 0 ? undefined : project.plans,
    selectedPlanId,
    results,
    taskCount,
    completedCount,
    planningTaskId: latestProviderTaskIdentityText(project.planningTaskId),
  };
};

const normalizeProductRestoreProjectCard = (project: ShellProjectData): ShellProjectData => {
  if (project.module !== MODULE_VALUES.RETOUCH || project.subFeature !== 'product_restore') return project;
  if (hasDurableProductRestoreCancellation(project)) {
    const results = (project.results || []).map((result) => resultHasMedia(result)
      ? {
          ...result,
          status: 'completed' as const,
          error: undefined,
          errorCode: undefined,
        }
      : {
          ...result,
          status: 'error' as const,
          error: '已手动中断',
          errorCode: 'interrupted',
        });
    return {
      ...project,
      status: 'error',
      error: '已手动中断',
      errorCode: 'interrupted',
      results,
      taskCount: Math.max(getProductRestoreExpectedTargetCount(project), 1),
      completedCount: results.filter(hasCompletedMediaResult).length,
      completedAt: undefined,
    };
  }
  const taskCount = Math.max(getProductRestoreExpectedTargetCount(project), 1);
  const completedCount = (project.results || []).filter(hasCompletedMediaResult).length;
  const hasGenerating = (project.results || []).some((result) => (
    (result.status === 'generating' || result.status === 'retry_waiting')
    && resultHasRuntimeIdentity(result)
  ));
  const hasError = (project.results || []).some((result) => result.status === 'error');
  const hasMissingTarget = hasMissingProductRestoreTargets({
    ...project,
    taskCount,
  }, project.results);
  const status = hasMissingTarget
    ? 'generating'
    : hasGenerating
      ? 'generating'
      : hasError
        ? 'error'
        : completedCount >= taskCount
          ? 'completed'
          : project.status;
  return {
    ...project,
    status,
    taskCount,
    completedCount,
    completedAt: status === 'completed' ? project.completedAt : undefined,
  };
};

const hasVisibleProjectContent = (project: ShellProjectData) => {
  if (project.storyboardSourceProject) return true;
  if (project.module === MODULE_VALUES.RETOUCH && project.subFeature === 'product_restore') return true;
  if ((project.results || []).length > 0) return true;
  if ((project.plans || []).length > 0) return true;
  return project.status === 'generating';
};

const getGeneratedResultMergeKeys = (result: ShellGeneratedResult) => {
  const concreteKeys = [
    getProductRestoreTargetKey(result),
    result.taskId ? `task:${result.taskId}` : '',
    result.backendJobId ? `job:${result.backendJobId}` : '',
    result.id ? `id:${result.id}` : '',
  ].filter(Boolean);
  if (concreteKeys.length > 0) return concreteKeys;
  return [
    result.planId ? `plan:${result.planId}` : '',
  ].filter(Boolean);
};

const shouldReplaceGeneratedResult = (existing: ShellGeneratedResult, next: ShellGeneratedResult) => {
  const existingCompleted = hasCompletedMediaResult(existing);
  const nextCompleted = hasCompletedMediaResult(next);
  if (existing.logoReplaceGuarded === true && next.logoReplaceGuarded !== true) return false;
  if (existingCompleted && !nextCompleted) return false;
  if (!existingCompleted && nextCompleted) return true;
  return true;
};

const mergeGeneratedResultPreservingSource = (
  existing: ShellGeneratedResult,
  next: ShellGeneratedResult,
): ShellGeneratedResult => ({
  ...existing,
  ...next,
  sourceUrl: next.sourceUrl || existing.sourceUrl,
  sourcePreviewUrl: next.sourcePreviewUrl || existing.sourcePreviewUrl || next.sourceUrl || existing.sourceUrl,
  sourceProjectId: next.sourceProjectId || existing.sourceProjectId,
  sourceResultId: next.sourceResultId || existing.sourceResultId,
  subtitleRegionNormalized: next.subtitleRegionNormalized || existing.subtitleRegionNormalized,
  subtitleRegionPixels: next.subtitleRegionPixels || existing.subtitleRegionPixels,
  fileName: next.fileName || existing.fileName,
  relativePath: next.relativePath || existing.relativePath,
  originalWidth: next.originalWidth || existing.originalWidth,
  originalHeight: next.originalHeight || existing.originalHeight,
});

const mergeProjectResultsByIdentity = (
  existingResults: ShellGeneratedResult[] = [],
  nextResults: ShellGeneratedResult[] = [],
) => {
  const results: ShellGeneratedResult[] = [];
  const keyToIndex = new Map<string, number>();
  const rebuildIndex = () => {
    keyToIndex.clear();
    results.forEach((item, index) => {
      getGeneratedResultMergeKeys(item).forEach((key) => keyToIndex.set(key, index));
    });
  };
  const removeStalePlanPlaceholders = (result: ShellGeneratedResult) => {
    if (!hasCompletedMediaResult(result)) return;
    const planId = String(result?.planId || '').trim();
    if (!planId) return;
    for (let index = results.length - 1; index >= 0; index -= 1) {
      const existing = results[index];
      const existingPlanId = String(existing?.planId || '').trim();
      const hasConcreteBackendIdentity = Boolean(String(existing?.taskId || existing?.backendJobId || '').trim());
      const hasMedia = Boolean(existing?.imageUrl || existing?.videoUrl);
      if (existingPlanId === planId && !hasConcreteBackendIdentity && !hasMedia) {
        results.splice(index, 1);
      }
    }
    rebuildIndex();
  };
  const hasCompletedPlanResult = (result: ShellGeneratedResult) => {
    const planId = String(result?.planId || '').trim();
    return Boolean(planId && results.some((item) => (
      String(item?.planId || '').trim() === planId
      && hasCompletedMediaResult(item)
    )));
  };
  const removeStaleRuntimePlaceholders = (result: ShellGeneratedResult) => {
    if (!isTerminalBackendFailureResult(result)) return;
    for (let index = results.length - 1; index >= 0; index -= 1) {
      const existing = results[index];
      if (
        isStaleRuntimePlaceholderResult(existing)
        && isSameResultPlanScope(existing, result)
      ) {
        results.splice(index, 1);
      }
    }
    rebuildIndex();
  };
  const isSupersededRuntimePlaceholder = (result: ShellGeneratedResult) => (
    isStaleRuntimePlaceholderResult(result)
    && results.some((item) => isTerminalBackendFailureResult(item) && isSameResultPlanScope(item, result))
  );
  const findNoMediaPlanPlaceholderIndex = (result: ShellGeneratedResult) => {
    const planId = String(result?.planId || '').trim();
    if (!planId || resultHasMedia(result)) return -1;
    if (result.status !== 'error' && result.status !== 'generating') return -1;
    return results.findIndex((item) => (
      String(item?.planId || '').trim() === planId
      && !resultHasMedia(item)
      && (item.status === 'error' || item.status === 'generating')
    ));
  };
  const upsert = (result: ShellGeneratedResult) => {
    if (isTransientNoIdentityRuntimePlaceholderResult(result) && results.some(hasCompletedMediaResult)) return;
    if (isSupersededNoMediaErrorResult(result, new Set(
      results
        .filter(hasCompletedMediaResult)
        .map((item) => String(item.planId || '').trim())
        .filter(Boolean),
    ))) return;
    if (result.status === 'error' && !resultHasMedia(result) && hasCompletedPlanResult(result) && !String(result.taskId || '').trim()) return;
    if (isSupersededRuntimePlaceholder(result)) return;
    removeStaleRuntimePlaceholders(result);
    removeStalePlanPlaceholders(result);
    const noMediaPlanPlaceholderIndex = findNoMediaPlanPlaceholderIndex(result);
    if (noMediaPlanPlaceholderIndex >= 0) {
      if (shouldReplaceGeneratedResult(results[noMediaPlanPlaceholderIndex], result)) {
        results[noMediaPlanPlaceholderIndex] = clearCompletedResultError(result);
      }
      rebuildIndex();
      return;
    }
    const keys = getGeneratedResultMergeKeys(result);
    const matchedIndex = keys
      .map((key) => keyToIndex.get(key))
      .find((index): index is number => typeof index === 'number');
	    if (typeof matchedIndex === 'number') {
	      if (shouldReplaceGeneratedResult(results[matchedIndex], result)) {
	        results[matchedIndex] = clearCompletedResultError(mergeGeneratedResultPreservingSource(results[matchedIndex], result));
	      }
	      getGeneratedResultMergeKeys(results[matchedIndex]).forEach((key) => keyToIndex.set(key, matchedIndex));
	      return;
    }
    const nextIndex = results.length;
    results.push(clearCompletedResultError(result));
    keys.forEach((key) => keyToIndex.set(key, nextIndex));
  };
  existingResults.forEach(upsert);
  nextResults.forEach(upsert);
  return results;
};

const sortMergedResultsByBatchIndex = (results: ShellGeneratedResult[] = []) => (
  results
    .map((result, index) => ({ result, index }))
    .sort((left, right) => {
      const leftHasBatch = Number.isInteger(left.result.batchIndex);
      const rightHasBatch = Number.isInteger(right.result.batchIndex);
      const leftBatch = leftHasBatch ? Number(left.result.batchIndex) : 0;
      const rightBatch = rightHasBatch ? Number(right.result.batchIndex) : 0;
      if (leftHasBatch && rightHasBatch && leftBatch !== rightBatch) return leftBatch - rightBatch;
      if (leftHasBatch && !rightHasBatch) return -1;
      if (!leftHasBatch && rightHasBatch) return 1;
      return left.index - right.index;
    })
    .map((item) => item.result)
);

const mergeProjectPlansById = (
  existingPlans: ShellProjectData['plans'] = [],
  nextPlans: ShellProjectData['plans'] = [],
) => {
  const plans: NonNullable<ShellProjectData['plans']> = [];
  const indexById = new Map<string, number>();
  const upsert = (plan: NonNullable<ShellProjectData['plans']>[number]) => {
    if (!plan) return;
    const id = String(plan.id || '').trim();
    if (!id) {
      plans.push(plan);
      return;
    }
    const existingIndex = indexById.get(id);
    if (typeof existingIndex === 'number') {
      plans[existingIndex] = { ...plans[existingIndex], ...plan };
      return;
    }
    indexById.set(id, plans.length);
    plans.push(plan);
  };
  (existingPlans || []).forEach(upsert);
  (nextPlans || []).forEach(upsert);
  return plans.length > 0 ? plans : undefined;
};

const orderProjectPlansByTemplate = (
  plans: ShellProjectData['plans'],
  templatePlans: ShellProjectData['plans'],
) => {
  if (!plans || !templatePlans || templatePlans.length <= 1) return plans;
  const orderById = new Map<string, number>();
  const orderByReferenceUrl = new Map<string, number>();
  templatePlans.forEach((plan, index) => {
    const id = String(plan?.id || '').trim();
    const referenceUrl = String(plan?.sourceReferenceUrl || '').trim();
    if (id) orderById.set(id, index);
    if (referenceUrl) orderByReferenceUrl.set(referenceUrl, index);
  });
  const getOrder = (plan: NonNullable<ShellProjectData['plans']>[number], fallback: number) => {
    const id = String(plan?.id || '').trim();
    const referenceUrl = String(plan?.sourceReferenceUrl || '').trim();
    if (id && orderById.has(id)) return orderById.get(id) ?? fallback;
    if (referenceUrl && orderByReferenceUrl.has(referenceUrl)) return orderByReferenceUrl.get(referenceUrl) ?? fallback;
    return fallback;
  };
  return [...plans].sort((a, b) => getOrder(a, plans.indexOf(a)) - getOrder(b, plans.indexOf(b)));
};

const latestIdentityTextList = (...values: Array<string | undefined>) => {
  const merged = Array.from(new Set(
    values
      .flatMap((value) => splitIdentityText(value)),
  ));
  return merged.length > 0 ? merged.at(-1) : undefined;
};

const getPlanningJobIdentities = (...projects: Array<Partial<ShellProjectData> | undefined>) => new Set(
  projects
    .flatMap((project) => [
      String(project?.backendJobId || '').trim(),
      ...splitIdentityText(project?.planningTaskId),
    ])
    .filter(Boolean),
);

const isPlanningJobPendingResult = (
  result: Partial<ShellGeneratedResult>,
  planningJobIds: Set<string>,
) => (
  result.status === 'generating'
  && !resultHasMedia(result)
  && planningJobIds.has(String(result.backendJobId || '').trim())
  && !String(result.taskId || '').trim()
);

const isStaleOneClickPlanningPlaceholderPlan = (
  plan: NonNullable<ShellProjectData['plans']>[number],
  planningJobIds?: Set<string>,
) => {
  const content = String(
    plan?.schemeContent
    || plan?.textLayout
    || plan?.sceneDescription
    || plan?.styleDirection
    || ''
  ).trim();
  if (!isOneClickPlanningPlaceholderText(content)) return false;
  const planId = String(plan?.id || '').trim();
  if (!planId) return false;
  if (!planningJobIds || planningJobIds.size === 0) return /-pending$/i.test(planId);
  return isPlanningJobPendingPlanPlaceholder(plan, planningJobIds);
};

const shouldClearPlanningJobPendingResults = (
  existing: ShellProjectData,
  next: ShellProjectData,
) => {
  if (next.module !== MODULE_VALUES.ONE_CLICK) return false;
  if (next.status !== 'planning') return false;
  if ((next.plans || []).length === 0) return false;
  if ((next.results || []).length > 0) return false;
  const planningJobIds = getPlanningJobIdentities(existing, next);
  if (planningJobIds.size === 0) return false;
  return (existing.results || []).some((result) => isPlanningJobPendingResult(result, planningJobIds));
};

const shouldClearPlanningJobPendingPlans = (
  existing: ShellProjectData,
  next: ShellProjectData,
) => {
  if (next.module !== MODULE_VALUES.ONE_CLICK) return false;
  if (next.status !== 'planning') return false;
  if ((next.plans || []).length === 0) return false;
  const planningJobIds = getPlanningJobIdentities(existing, next);
  if (planningJobIds.size === 0) return false;
  return (existing.plans || []).some((plan) => isStaleOneClickPlanningPlaceholderPlan(plan, planningJobIds));
};

const mergeProjectSnapshot = (existing: ShellProjectData, next: ShellProjectData): ShellProjectData => {
  if (!shouldReplaceProjectSnapshot(existing, next)) return existing;
  const clearPlanningJobPendingPlans = shouldClearPlanningJobPendingPlans(existing, next);
  const planningPlanJobIds = clearPlanningJobPendingPlans
    ? getPlanningJobIdentities(existing, next)
    : new Set<string>();
  const existingPlans = clearPlanningJobPendingPlans
    ? (existing.plans || []).filter((plan) => !isStaleOneClickPlanningPlaceholderPlan(plan, planningPlanJobIds))
    : existing.plans;
  let plans = mergeProjectPlansById(existingPlans, next.plans);
  if (
    next.module === MODULE_VALUES.ONE_CLICK
    && next.status === 'planning'
    && (next.plans || []).length > 1
    && (next.results || []).length === 0
  ) {
    plans = orderProjectPlansByTemplate(plans, next.plans);
  }
  const replacesStalePlanningFailure = hasOnlyStalePlanningFailureResults(existing) && (
    (
      next.status === 'planning'
      && (plans || []).length > 0
      && (next.results || []).length === 0
    )
    || (
      next.status === 'error'
      && (next.plans || []).some((plan) => Boolean(plan?.planningFailed))
      && (next.results || []).length > 0
    )
  );
  const clearPlanningJobPendingResults = shouldClearPlanningJobPendingResults(existing, next);
  const planningJobIds = clearPlanningJobPendingResults
    ? getPlanningJobIdentities(existing, next)
    : new Set<string>();
  const existingResults = replacesStalePlanningFailure
    ? []
    : clearPlanningJobPendingResults
    ? (existing.results || []).filter((result) => !isPlanningJobPendingResult(result, planningJobIds))
    : existing.results || [];
  const results = sortMergedResultsByBatchIndex(mergeProjectResultsByIdentity(existingResults, next.results || []));
  const completedCount = results.filter(hasCompletedMediaResult).length;
  const taskCount = getMergedProjectTaskCount(existing, next, plans, results, completedCount);
  const hasGenerating = results.some((result) => (result.status === 'generating' || result.status === 'retry_waiting') && resultHasRuntimeIdentity(result));
  const hasError = results.some((result) => result.status === 'error');
  const hasCompletedMedia = completedCount > 0;
  const generationContext = mergeProductRestoreGenerationContext(
    existing.generationContext,
    next.generationContext,
  ) as ShellProjectData['generationContext'];
  const durablyCancelled = hasDurableProductRestoreCancellation({ generationContext });
  const hasMissingProductRestoreTarget = hasMissingProductRestoreTargets({
    ...existing,
    ...next,
    results,
    taskCount,
  }, results);
  const status = durablyCancelled
    ? 'error'
    : hasMissingProductRestoreTarget
      ? 'generating'
      : hasCompletedMedia && !hasGenerating && !hasError
        ? 'completed'
        : completedCount >= taskCount
          ? 'completed'
          : hasGenerating
            ? 'generating'
            : hasError
              ? 'error'
              : hasPendingSelectedPlan(plans, results)
                ? 'planning'
                : next.status;
  const mergedProject: ShellProjectData & { error?: string } = {
    ...existing,
    ...next,
    status,
    results,
    plans,
    taskCount,
    completedCount,
    completedAt: durablyCancelled
      ? undefined
      : completedCount >= taskCount
        ? (next.completedAt || existing.completedAt)
        : existing.completedAt,
    planningTaskId: latestProviderTaskIdentityText(existing.planningTaskId, next.planningTaskId),
    directGeneration: existing.directGeneration || next.directGeneration,
    generationContext,
  };
  if (!durablyCancelled && status === 'completed' && completedCount > 0) {
    delete mergedProject.error;
  }
  return mergedProject;
};

export const buildShellDataSnapshot = (
  state?: Partial<PersistedAppState> | null,
  jobs: InternalJob[] = [],
): ShellDataSnapshot => {
  const persisted = mapPersistedState(state);
  const persistedProjects = filterLegacyShellControlJobGhosts(
    filterDeletedProjects(persisted.projects, state),
    jobs,
  );
  const jobData = mapJobs(jobs, persistedProjects, state?.shellDraft?.deletedJobIds || []);
  const buyerShowSetRootProjectIds = new Set(
    jobData.projects
      .filter((project) => project.module === MODULE_VALUES.BUYER_SHOW)
      .map((project) => String(project.id || '').match(/^(.*)-set-\d+$/)?.[1] || '')
      .filter(Boolean),
  );
  const projectsForMerge = buyerShowSetRootProjectIds.size > 0
    ? persistedProjects.filter((project) => !(
      project.module === MODULE_VALUES.BUYER_SHOW
      && buyerShowSetRootProjectIds.has(String(project.id || ''))
    ))
    : persistedProjects;
  const byId = new Map<string, ShellProjectData>();
  filterDeletedProjects([...projectsForMerge, ...jobData.projects], state).forEach((project) => {
    const existing = byId.get(project.id);
    if (!existing) {
      byId.set(project.id, project);
      return;
    }
    byId.set(project.id, mergeProjectSnapshot(existing, project));
  });
  const projects = Array.from(byId.values())
    .map(normalizeOneClickProjectCard)
    .map(normalizeProductRestoreProjectCard)
    .filter(hasVisibleProjectContent);
  return {
    projects,
    tasks: jobData.tasks,
    materials: persisted.materials,
  };
};
