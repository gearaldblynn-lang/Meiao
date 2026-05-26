import type { AppModule, InternalJob } from '../types.ts';
import type { PersistedAppState } from '../utils/appState.ts';

type ShellProjectStatus = 'planning' | 'generating' | 'completed' | 'error';
type ShellTaskStatus = 'pending' | 'generating' | 'completed' | 'error';

export interface ShellGeneratedResult {
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
  createdAt: string;
  module: AppModule;
  subFeature?: string;
  sourceUrl?: string;
  sourcePreviewUrl?: string;
  fileName?: string;
  relativePath?: string;
  taskId?: string;
  backendJobId?: string;
  creditsConsumed?: number;
  error?: string;
  matchedAspectRatio?: string;
}

export interface ShellProjectData {
  id: string;
  name: string;
  module: AppModule;
  status: ShellProjectStatus;
  createdAt: string;
  completedAt?: string;
  results: ShellGeneratedResult[];
  taskCount: number;
  completedCount: number;
  subFeature?: string;
  sourceType?: 'persisted' | 'job';
  backendJobId?: string;
  creditsConsumed?: number;
  planningTaskId?: string;
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
    materials: Record<string, ShellMaterialData[]>;
  };
  directGeneration?: boolean;
}

export interface ShellTaskData {
  id: string;
  projectId: string;
  module: AppModule;
  type: 'image' | 'video' | 'plan' | 'batch';
  status: ShellTaskStatus;
  title: string;
  progress?: number;
  createdAt: string;
  total?: number;
  completed?: number;
  subFeature?: string;
  backendJobId?: string;
  prompt?: string;
}

export interface ShellMaterialData {
  id: string;
  type: string;
  url: string;
  remoteUrl?: string;
  localAssetId?: string;
  fileName: string;
  subFeature?: string;
  giftIndex?: number;
}

export interface ShellDataSnapshot {
  projects: ShellProjectData[];
  tasks: ShellTaskData[];
  materials: Record<string, ShellMaterialData[]>;
}

const MODULE_LABELS: Record<string, string> = {
  one_click: '一键主详',
  translation: '出海翻译',
  buyer_show: '买家秀',
  retouch: '产品精修',
  video: '短视频',
  xhs_cover: '小红书封面',
  agent_center: '智能体中心',
};

const MODULE_VALUES = {
  ONE_CLICK: 'one_click' as AppModule,
  TRANSLATION: 'translation' as AppModule,
  BUYER_SHOW: 'buyer_show' as AppModule,
  RETOUCH: 'retouch' as AppModule,
  VIDEO: 'video' as AppModule,
  XHS_COVER: 'xhs_cover' as AppModule,
  AGENT_CENTER: 'agent_center' as AppModule,
};

const VALID_MODULES = new Set(Object.values(MODULE_VALUES));
const persistedSnapshotCache = new WeakMap<object, Pick<ShellDataSnapshot, 'projects' | 'materials'>>();

const normalizeCreditsConsumed = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
};

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

const toDateLabel = (value: unknown) => {
  const ts = typeof value === 'number' && Number.isFinite(value) ? value : Date.now();
  return new Date(ts).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }).replace('/', '-');
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
  return 'generating';
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
      selected: index === 0,
      schemeContent: scheme,
    };
  });
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
  if (module === MODULE_VALUES.VIDEO) {
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

const resultFromItem = (
  item: any,
  module: AppModule,
  fallbackTitle: string,
  createdAt: string,
  subFeature?: string,
  fallbackPrompt?: string,
): ShellGeneratedResult | null => {
  const url = getResultUrl(item);
  const status = taskStatusToProject(item?.status);
  if (!url && status !== 'error') return null;
  const mediaType = module === MODULE_VALUES.VIDEO || Boolean(item?.videoUrl || item?.result?.videoUrl) ? 'video' : 'image';
  return {
    id: String(item?.id || item?.taskId || `${module}-${fallbackTitle}-${createdAt}`),
    planId: module === MODULE_VALUES.ONE_CLICK
      ? String(item?.planId || item?.id || '').trim() || undefined
      : String(item?.planId || '').trim() || undefined,
    projectId: item?.projectId ? String(item.projectId) : undefined,
    imageUrl: url,
    videoUrl: mediaType === 'video' ? url : undefined,
    mediaType,
    prompt: getPrompt(item, fallbackPrompt || fallbackTitle, module),
    model: String(item?.model || item?.payload?.model || '旧任务'),
    aspectRatio: String(item?.matchedAspectRatio || item?.aspectRatio || item?.payload?.aspectRatio || item?.payload?.ratio || 'auto'),
    status: status === 'completed' ? 'completed' : status === 'error' ? 'error' : 'generating',
    createdAt,
    module,
    subFeature,
    sourceUrl: String(item?.sourceUrl || '').trim() || undefined,
    sourcePreviewUrl: String(item?.sourcePreviewUrl || item?.sourceUrl || '').trim() || undefined,
    fileName: String(item?.fileName || '').trim() || undefined,
    relativePath: String(item?.relativePath || item?.fileName || '').trim() || undefined,
    taskId: getVisibleTaskId(item),
    backendJobId: String(item?.backendJobId || item?.jobId || '').trim() || undefined,
    creditsConsumed: normalizeCreditsConsumed(item?.creditsConsumed || item?.result?.creditsConsumed),
    error: String(item?.error || '').trim() || undefined,
    matchedAspectRatio: String(item?.matchedAspectRatio || item?.aspectRatio || item?.payload?.aspectRatio || item?.payload?.ratio || 'auto'),
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
  const createdAt = toDateLabel(createdAtValue);
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
    planningTaskId: String(planningTaskId || '').trim() || undefined,
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
      results: Array.isArray(project.results) ? project.results.map((result: any, index: number) => ({
        id: String(result?.id || `${project.id}-result-${index}`),
        planId: String(result?.planId || '').trim() || undefined,
        projectId: result?.projectId ? String(result.projectId) : undefined,
        imageUrl: String(result?.imageUrl || '').trim(),
        videoUrl: String(result?.videoUrl || '').trim() || undefined,
        mediaType: result?.mediaType === 'video' ? 'video' : 'image',
        prompt: String(result?.prompt || '').trim(),
        model: String(result?.model || '旧任务'),
        aspectRatio: String(result?.aspectRatio || 'auto'),
        status: result?.status === 'error' ? 'error' : result?.status === 'generating' ? 'generating' : 'completed',
        createdAt: String(result?.createdAt || project.createdAt || toDateLabel(Date.now())),
        module: toModule(result?.module || project.module),
        subFeature: String(result?.subFeature || project.subFeature || '').trim() || undefined,
        sourceUrl: String(result?.sourceUrl || '').trim() || undefined,
        sourcePreviewUrl: String(result?.sourcePreviewUrl || result?.sourceUrl || '').trim() || undefined,
        fileName: String(result?.fileName || '').trim() || undefined,
        relativePath: String(result?.relativePath || '').trim() || undefined,
        taskId: getVisibleTaskId(result),
        backendJobId: String(result?.backendJobId || '').trim() || undefined,
        creditsConsumed: normalizeCreditsConsumed(result?.creditsConsumed),
        error: String(result?.error || '').trim() || undefined,
        matchedAspectRatio: String(result?.matchedAspectRatio || result?.aspectRatio || 'auto'),
      })) : [],
      taskCount: Number(project.taskCount || project.results?.length || 1),
      completedCount: Number(project.completedCount || 0),
      sourceType: 'persisted',
      creditsConsumed: normalizeCreditsConsumed(project.creditsConsumed),
      planningTaskId: String(project.planningTaskId || '').trim() || undefined,
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
    const mapped = projectFromItems(String(task?.id || `retouch-${index}`), String(task?.fileName || `产品精修 ${index + 1}`), MODULE_VALUES.RETOUCH, Date.now(), [task], subFeature);
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
    const items = [...(Array.isArray(project?.shots) ? project.shots : []), ...(Array.isArray(project?.boards) ? project.boards : [])];
    const mapped = projectFromItems(
      String(project?.id || `storyboard-${index}`),
      String(project?.name || `分镜项目 ${index + 1}`),
      MODULE_VALUES.VIDEO,
      project?.createdAt || Date.now(),
      items,
      'storyboard',
      '',
      undefined,
      undefined,
      undefined,
      project?.creditsConsumed,
      project?.planningTaskId,
    );
    if (mapped) projects.push(mapped);
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

const isStalePlanningFailureResult = (result?: Partial<ShellGeneratedResult>) => {
  if (!result || result.status !== 'error') return false;
  if (result.imageUrl || result.videoUrl || result.backendJobId || result.taskId) return false;
  const message = String(result.error || result.prompt || '').trim();
  return /策划失败|未返回可用方案|任务已提交云端|结果待同步/.test(message);
};

const hasOnlyStalePlanningFailureResults = (project?: Partial<ShellProjectData>) => {
  const results = Array.isArray(project?.results) ? project.results : [];
  return results.length > 0 && results.every((result) => isStalePlanningFailureResult(result));
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

  jobs.forEach((job) => {
    if (hiddenJobIds.has(String(job.id || '').trim())) return;
    const module = toModule(job.module);
    const projectStatus = taskStatusToProject(job.status);
    const createdAt = toDateLabel(job.createdAt);
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
    const projectId = `job-${job.id}`;
    const payloadPlanId = String((job.payload as any)?.shellPlanId || (job.payload as any)?.planId || '').trim();
    const subFeature = module === MODULE_VALUES.ONE_CLICK
      ? (getStructuredOneClickJobSubFeature(job.payload) || normalizeJobSubFeature(module, job.taskType, job.payload))
      : normalizeJobSubFeature(module, job.taskType, job.payload);

    if (projectStatus === 'completed' || projectStatus === 'error') {
      const urls = getResultUrls(job);
      if (
        projectStatus === 'completed'
        && module === MODULE_VALUES.ONE_CLICK
        && String(job.taskType || '') === 'kie_chat'
        && urls.length === 0
      ) {
        const matchedProject = findPersistedPlanningProjectForJob(job, persistedProjects);
        if (!matchedProject) return;
        if ((matchedProject.results || []).length > 0 && !hasOnlyStalePlanningFailureResults(matchedProject)) return;
        if (Number(matchedProject.completedCount || 0) > 0) return;
        if ((matchedProject.plans || []).length > 0) {
          const planningTaskId = String(job.providerTaskId || (job.result as any)?.providerTaskId || '').trim();
          projects.push({
            ...matchedProject,
            status: 'planning',
            backendJobId: job.id,
            creditsConsumed: normalizeCreditsConsumed((job.result as any)?.creditsConsumed) || matchedProject.creditsConsumed,
            planningTaskId: mergeIdentityTextList(matchedProject.planningTaskId, planningTaskId),
            taskCount: Math.max(Number(matchedProject.taskCount || 0) || 0, matchedProject.plans?.length || 0, 1),
            completedCount: 0,
          });
          return;
        }
        const planningText = String((job.result as any)?.content || (job.result as any)?.text || '').trim();
        const plans = parseOneClickPlanningText(planningText, job.id);
        if (plans.length === 0) return;
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
          creditsConsumed: normalizeCreditsConsumed((job.result as any)?.creditsConsumed),
          planningTaskId: String(job.providerTaskId || (job.result as any)?.providerTaskId || '').trim() || undefined,
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
        const planningTaskId = String(job.providerTaskId || (job.result as any)?.providerTaskId || '').trim();
        projects.push({
          ...matchedProject,
          backendJobId: job.id,
          creditsConsumed: normalizeCreditsConsumed((job.result as any)?.creditsConsumed) || matchedProject.creditsConsumed,
          planningTaskId: mergeIdentityTextList(matchedProject.planningTaskId, planningTaskId),
        });
        return;
      }
      if (projectStatus === 'error' && urls.length === 0) {
        const matchedProject = findPersistedPlanningProjectForJob(job, persistedProjects);
        if (!matchedProject) return;
        const errorMessage = String(job.errorMessage || job.errorCode || '任务失败').trim();
        projects.push({
          ...matchedProject,
          id: matchedProject.id,
          name: matchedProject.name || prompt.slice(0, 28) || MODULE_LABELS[module] || String(job.taskType || '生成任务'),
          module,
          status: 'error',
          createdAt: matchedProject.createdAt || createdAt,
          results: [{
            id: `${job.id}-error`,
            planId: payloadPlanId || matchedProject.selectedPlanId,
            projectId: matchedProject.id,
            imageUrl: '',
            prompt: errorMessage || prompt,
            model: String(job.payload?.model || job.result?.model || job.provider || '生成任务'),
            aspectRatio: String(job.payload?.aspectRatio || job.payload?.ratio || job.result?.aspectRatio || 'auto'),
            status: 'error',
            createdAt,
            module,
            subFeature: matchedProject.subFeature || subFeature,
            taskId: String(job.providerTaskId || job.result?.providerTaskId || '').trim() || undefined,
            backendJobId: job.id,
            creditsConsumed: normalizeCreditsConsumed(job.result?.creditsConsumed),
            error: errorMessage,
          }],
          taskCount: matchedProject.taskCount || 1,
          completedCount: matchedProject.completedCount || 0,
          subFeature: matchedProject.subFeature || subFeature,
          sourceType: matchedProject.sourceType || 'persisted',
          backendJobId: job.id,
          planningTaskId: matchedProject.planningTaskId,
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
        const hasPersistedTerminalResult = (matchedProject.results || []).some((result) => {
          const resultJobId = String(result.backendJobId || '').trim();
          const resultTaskId = String(result.taskId || result.id || '').trim();
          const resultPlanId = String(result.planId || '').trim();
          const hasConcreteJobIdentity = Boolean(job.id || providerTaskId);
          const matches = Boolean(
            (resultJobId && resultJobId === job.id)
            || (providerTaskId && resultTaskId === providerTaskId)
            || (!hasConcreteJobIdentity && payloadPlanId && resultPlanId === payloadPlanId && (result.imageUrl || result.videoUrl || result.status === 'error'))
          );
          return matches && Boolean(result.imageUrl || result.videoUrl || result.status === 'error');
        });
        if (hasPersistedTerminalResult) return;
        const nextJobResults: ShellGeneratedResult[] = urls.length > 0
          ? urls.map((url, index) => ({
              id: String(job.providerTaskId || job.result?.providerTaskId || `${job.id}-result-${index + 1}`),
              planId: payloadPlanId || matchedProject.selectedPlanId || matchedProject.plans?.[index]?.id,
              projectId: matchedProject.id,
              imageUrl: url,
              mediaType: 'image',
              prompt,
              model: String(job.payload?.model || job.result?.model || job.provider || '生成任务'),
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
          completedAt: completedCount >= taskCount ? toDateLabel(job.finishedAt || job.updatedAt || job.createdAt) : matchedProject.completedAt,
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
        const nextJobResults: ShellGeneratedResult[] = urls.map((url, index) => ({
          id: String(providerTaskId || `${job.id}-result-${index + 1}`),
          planId: payloadPlanId || matchedTerminalProject.selectedPlanId || matchedTerminalProject.plans?.[index]?.id,
          projectId: matchedTerminalProject.id,
          imageUrl: url,
          videoUrl: mediaType === 'video' ? url : undefined,
          mediaType: mediaType === 'video' ? 'video' : 'image',
          prompt,
          model: String(job.payload?.model || job.result?.model || job.provider || '生成任务'),
          aspectRatio: String(job.payload?.aspectRatio || job.payload?.ratio || job.result?.aspectRatio || 'auto'),
          status: 'completed',
          createdAt,
          module,
          subFeature: matchedTerminalProject.subFeature || subFeature,
          taskId: String(providerTaskId || '').trim() || undefined,
          backendJobId: job.id,
          creditsConsumed: normalizeCreditsConsumed(job.result?.creditsConsumed),
        }));
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
          completedAt: completedCount >= taskCount ? toDateLabel(job.finishedAt || job.updatedAt || job.createdAt) : matchedTerminalProject.completedAt,
          results: mergedResults,
          taskCount,
          completedCount,
          subFeature: matchedTerminalProject.subFeature || subFeature,
          sourceType: matchedTerminalProject.sourceType || 'persisted',
          backendJobId: job.id,
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
        prompt.slice(0, 28) || MODULE_LABELS[module] || String(job.taskType || '生成任务'),
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
          completedAt: projectStatus === 'completed' ? toDateLabel(job.finishedAt || job.updatedAt || job.createdAt) : project.completedAt,
        });
      }
      return;
    }

    if (projectStatus === 'generating' || projectStatus === 'planning') {
      const matchedProject = findPersistedPlanningProjectForJob(job, persistedProjects);
      if (
        module === MODULE_VALUES.ONE_CLICK
        && String(job.taskType || '').includes('image')
        && !matchedProject
      ) {
        return;
      }
      const activeProjectId = matchedProject?.id || projectId;
      const activeResults: ShellGeneratedResult[] = (matchedProject?.results || []).length > 0
        ? matchedProject?.results || []
        : [{
            id: `${job.id}-pending`,
            projectId: activeProjectId,
            imageUrl: '',
            videoUrl: undefined,
            mediaType: mediaType === 'video' ? 'video' : 'image',
            prompt,
            model: String(job.payload?.model || job.result?.model || job.provider || '生成任务'),
            aspectRatio: String(job.payload?.aspectRatio || job.payload?.ratio || job.result?.aspectRatio || 'auto'),
            status: 'generating',
            createdAt,
            module,
            subFeature,
            taskId: String(job.providerTaskId || job.result?.providerTaskId || '').trim() || undefined,
            backendJobId: job.id,
            error: job.status === 'queued' ? '任务已提交，等待执行' : '任务正在运行',
          }];
      projects.push({
        ...(matchedProject || {}),
        id: activeProjectId,
        name: matchedProject?.name || prompt.slice(0, 28) || MODULE_LABELS[module] || String(job.taskType || '生成任务'),
        module,
        status: projectStatus,
        createdAt: matchedProject?.createdAt || createdAt,
        results: activeResults,
        taskCount: matchedProject?.taskCount || Number(job.payload?.batchCount || job.payload?.count || 1) || 1,
        completedCount: matchedProject?.completedCount || 0,
        subFeature: matchedProject?.subFeature || subFeature,
        sourceType: matchedProject?.sourceType || 'job',
        backendJobId: job.id,
      });
      tasks.push({
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
      });
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

const shouldReplaceProjectSnapshot = (existing: ShellProjectData | undefined, next: ShellProjectData) => {
  if (!existing) return true;
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
  if (existing.status === 'completed' && next.status === 'planning') return false;
  return true;
};

const hasCompletedMediaResult = (result: ShellGeneratedResult) =>
  result.status === 'completed' && Boolean(result.imageUrl || result.videoUrl);

const normalizeOneClickProjectCard = (project: ShellProjectData): ShellProjectData => {
  if (project.module !== MODULE_VALUES.ONE_CLICK) return project;
  const plans = Array.isArray(project.plans) ? project.plans : [];
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

  let results = (project.results || []).filter((result) => {
    const planId = String(result?.planId || '').trim();
    return !planId || !droppedPlanIds.has(planId);
  });

  const completedCount = results.filter(hasCompletedMediaResult).length;
  const planCount = filteredPlans.length;
  const taskCount = planCount > 0
    ? Math.max(Number(project.taskCount || 0) || 0, results.length, planCount, 1)
    : Math.max(Number(project.taskCount || 0) || 0, results.length, 1);
  const selectedPlanId = filteredPlans.some((plan) => String(plan?.id || '') === String(project.selectedPlanId || ''))
    ? project.selectedPlanId
    : filteredPlans.find((plan) => plan.selected)?.id || filteredPlans[0]?.id || project.selectedPlanId;

  return {
    ...project,
    plans: filteredPlans.length > 0 ? filteredPlans : project.plans,
    selectedPlanId,
    results,
    taskCount,
    completedCount,
  };
};

const getGeneratedResultMergeKeys = (result: ShellGeneratedResult) => {
  const concreteKeys = [
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
  if (existingCompleted && !nextCompleted) return false;
  if (!existingCompleted && nextCompleted) return true;
  return true;
};

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
  const upsert = (result: ShellGeneratedResult) => {
    removeStalePlanPlaceholders(result);
    const keys = getGeneratedResultMergeKeys(result);
    const matchedIndex = keys
      .map((key) => keyToIndex.get(key))
      .find((index): index is number => typeof index === 'number');
    if (typeof matchedIndex === 'number') {
      if (shouldReplaceGeneratedResult(results[matchedIndex], result)) {
        results[matchedIndex] = result;
      }
      getGeneratedResultMergeKeys(results[matchedIndex]).forEach((key) => keyToIndex.set(key, matchedIndex));
      return;
    }
    const nextIndex = results.length;
    results.push(result);
    keys.forEach((key) => keyToIndex.set(key, nextIndex));
  };
  existingResults.forEach(upsert);
  nextResults.forEach(upsert);
  return results;
};

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

const mergeIdentityTextList = (...values: Array<string | undefined>) => {
  const merged = Array.from(new Set(
    values
      .flatMap((value) => splitIdentityText(value)),
  ));
  return merged.length > 0 ? merged.join(', ') : undefined;
};

const mergeProjectSnapshot = (existing: ShellProjectData, next: ShellProjectData): ShellProjectData => {
  if (!shouldReplaceProjectSnapshot(existing, next)) return existing;
  const plans = mergeProjectPlansById(existing.plans, next.plans);
  const replacesStalePlanningFailure = next.status === 'planning'
    && (plans || []).length > 0
    && hasOnlyStalePlanningFailureResults(existing)
    && (next.results || []).length === 0;
  const results = replacesStalePlanningFailure
    ? []
    : mergeProjectResultsByIdentity(existing.results || [], next.results || []);
  const completedCount = results.filter(hasCompletedMediaResult).length;
  const taskCount = Math.max(
    Number(existing.taskCount || 0) || 0,
    Number(next.taskCount || 0) || 0,
    plans?.length || 0,
    results.length,
    1,
  );
  const hasGenerating = results.some((result) => result.status === 'generating');
  const hasError = results.some((result) => result.status === 'error');
  const status = completedCount >= taskCount
    ? 'completed'
    : hasGenerating
      ? 'generating'
      : hasError
        ? 'error'
        : next.status;
  return {
    ...existing,
    ...next,
    status,
    results,
    plans,
    taskCount,
    completedCount,
    completedAt: completedCount >= taskCount ? (next.completedAt || existing.completedAt) : existing.completedAt,
    planningTaskId: mergeIdentityTextList(existing.planningTaskId, next.planningTaskId),
    directGeneration: existing.directGeneration || next.directGeneration,
  };
};

export const buildShellDataSnapshot = (
  state?: Partial<PersistedAppState> | null,
  jobs: InternalJob[] = [],
): ShellDataSnapshot => {
  const persisted = mapPersistedState(state);
  const persistedProjects = filterDeletedProjects(persisted.projects, state);
  const jobData = mapJobs(jobs, persistedProjects, state?.shellDraft?.deletedJobIds || []);
  const byId = new Map<string, ShellProjectData>();
  filterDeletedProjects([...persistedProjects, ...jobData.projects], state).forEach((project) => {
    const existing = byId.get(project.id);
    if (!existing) {
      byId.set(project.id, project);
      return;
    }
    byId.set(project.id, mergeProjectSnapshot(existing, project));
  });
  const projects = Array.from(byId.values()).map(normalizeOneClickProjectCard);
  return {
    projects,
    tasks: jobData.tasks,
    materials: persisted.materials,
  };
};
