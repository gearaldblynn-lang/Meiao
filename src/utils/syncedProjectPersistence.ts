// 云上断链修复(2026-07-09 多桑「7月9日项目5」取证):
// 提交后用户立即刷新 → 占位卡持久化 write 随页面卸载丢失 → app_state 永远没有这张卡;
// internal_jobs 成功后 hydrateShellJobs 能从 job 重建卡片,但旧谓词只允许
// 「translation 有内容」或「error 有失败结果」两类缺卡回写,everything_replace 等模块的
// 成功卡永远不落库——只活在最近 100 条 jobs 窗口里,并在 hydrateShellData 全量覆盖时闪现后消失。
// 单一判据:job 来源 + 有 backendJobId + 有可见产物(成功媒体/活跃任务身份/失败结果)的缺卡,
// 不分模块一律回写持久层;agent 等非工作区模块不产出项目卡,用白名单挡住。
export interface SyncedResultLike {
  status?: string;
  imageUrl?: string;
  videoUrl?: string;
  backendJobId?: string | null;
  taskId?: string | null;
  prompt?: string;
}

export interface SyncedPlanLike {
  id?: string;
  selected?: boolean;
  schemeContent?: string;
  textLayout?: string;
  sceneDescription?: string;
  styleDirection?: string;
  title?: string;
}

export interface SyncedProjectLike {
  id?: string;
  module?: string;
  subFeature?: string;
  status?: string;
  sourceType?: string;
  backendJobId?: string | null;
  results?: SyncedResultLike[];
  plans?: SyncedPlanLike[];
  completedCount?: number;
  taskCount?: number;
}

export interface SyncedStateLike {
  shellProjects?: unknown;
}

const PERSISTABLE_JOB_CARD_MODULES = new Set([
  'one_click',
  'translation',
  'retouch',
  'buyer_show',
  'everything_replace',
  'video',
  'xhs_cover',
]);

export const getProjectCompletedMediaCount = (project?: Pick<SyncedProjectLike, 'results'> | null) => (
  (project?.results || []).filter((result) => (
    result.status === 'completed' && Boolean(result.imageUrl || result.videoUrl)
  )).length
);

export const getProjectErrorResultCount = (project?: Pick<SyncedProjectLike, 'results'> | null) => (
  (project?.results || []).filter((result) => result.status === 'error').length
);

export const getProjectActiveResultIdentities = (project?: Pick<SyncedProjectLike, 'results'> | null) => new Set(
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

export const hasStaleOneClickPlanningPlaceholder = (
  project?: Pick<SyncedProjectLike, 'module' | 'results' | 'plans'> | null,
) => {
  if (project?.module !== 'one_click') return false;
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

export const getOneClickPlanningFingerprint = (project?: Pick<SyncedProjectLike, 'plans'> | null) => (
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

export const hasPlanningSnapshotChanged = (
  project: SyncedProjectLike,
  persistedProject: SyncedProjectLike,
) => {
  if (project.module !== 'one_click') return false;
  if (project.status !== 'planning') return false;
  if ((project.plans || []).length === 0) return false;
  return hasStaleOneClickPlanningPlaceholder(persistedProject)
    || getOneClickPlanningFingerprint(project) !== getOneClickPlanningFingerprint(persistedProject);
};

export const findPersistedShellProject = (state: SyncedStateLike | null | undefined, projectId: string) => {
  const shellProjects = Array.isArray(state?.shellProjects) ? state.shellProjects : [];
  return shellProjects.find((project) => String((project as SyncedProjectLike)?.id || '').trim() === projectId) as SyncedProjectLike | undefined;
};

export const shouldPersistSyncedProjectFromJobs = (
  project: SyncedProjectLike,
  state: SyncedStateLike | null | undefined,
) => {
  const projectId = String(project?.id || '').trim();
  if (!projectId) return false;
  const nextCompletedCount = getProjectCompletedMediaCount(project);
  const nextErrorCount = getProjectErrorResultCount(project);
  const persistedProject = findPersistedShellProject(state, projectId);
  if (!persistedProject) {
    return project.sourceType === 'job'
      && PERSISTABLE_JOB_CARD_MODULES.has(String(project.module || ''))
      && Boolean(String(project.backendJobId || '').trim())
      && (
        nextCompletedCount > 0
        || getProjectActiveResultIdentities(project).size > 0
        || nextErrorCount > 0
      );
  }
  if (hasPlanningSnapshotChanged(project, persistedProject)) return true;
  if (project.status === 'generating') {
    const persistedActiveIdentities = getProjectActiveResultIdentities(persistedProject);
    const hasNewActiveIdentity = Array.from(getProjectActiveResultIdentities(project))
      .some((identity) => !persistedActiveIdentities.has(identity));
    if (hasNewActiveIdentity) return true;
  }
  const persistedCompletedCount = getProjectCompletedMediaCount(persistedProject);
  if (nextCompletedCount > persistedCompletedCount) return true;
  if (project.status === 'completed' && persistedProject.status !== 'completed' && nextCompletedCount > 0) return true;
  const persistedErrorCount = getProjectErrorResultCount(persistedProject);
  if (nextErrorCount > persistedErrorCount) return true;
  return project.status === 'error'
    && (persistedProject.status === 'planning' || persistedProject.status === 'generating')
    && nextErrorCount > 0;
};
