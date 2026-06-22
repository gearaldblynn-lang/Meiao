import { analyzeAppState } from './appStateHealth.mjs';

const ONE_CLICK_BRANCH_KEYS = ['firstImage', 'mainImage', 'detailPage', 'sku'];
const ACTIVE_STATUSES = new Set(['generating', 'pending', 'queued', 'running', 'retry_waiting', 'uploading', 'processing']);
const COMPLETED_STATUSES = new Set(['completed', 'succeeded', 'success']);
const TASK_IDENTITY_FIELDS = ['backendJobId', 'planningTaskId', 'providerTaskId', 'taskId', 'kieTaskId'];
const UNRECOVERABLE_TASK_MESSAGE = '任务状态缺少云端任务身份，无法自动恢复，请重新生成。';
const COMPLETED_WITHOUT_OUTPUT_MESSAGE = '项目标记为完成但没有可展示结果，请重新生成。';

const cloneJson = (value) => JSON.parse(JSON.stringify(value || {}));
const compactKey = (value) => String(value || '').trim();
const isObject = (value) => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const asArray = (value) => Array.isArray(value) ? value.filter(isObject) : [];
const statusOf = (item = {}) => compactKey(item.status).toLowerCase();
const isActive = (item = {}) => ACTIVE_STATUSES.has(statusOf(item));
const isCompleted = (item = {}) => COMPLETED_STATUSES.has(statusOf(item));
const hasOutput = (item = {}) => Boolean(item.imageUrl || item.videoUrl || item.resultUrl || item.remoteUrl || item.url);
const hasIdentity = (item = {}) => TASK_IDENTITY_FIELDS.some((field) => compactKey(item[field]));

const projectBuckets = (state = {}) => {
  const buckets = [];
  if (Array.isArray(state.shellProjects)) {
    buckets.push({ path: 'shellProjects', projects: state.shellProjects });
  }
  if (isObject(state.oneClickMemory)) {
    ONE_CLICK_BRANCH_KEYS.forEach((key) => {
      if (Array.isArray(state.oneClickMemory?.[key]?.projects)) {
        buckets.push({ path: `oneClickMemory.${key}.projects`, projects: state.oneClickMemory[key].projects });
      }
    });
  }
  if (Array.isArray(state.buyerShowMemory?.sets)) {
    buckets.push({ path: 'buyerShowMemory.sets', projects: state.buyerShowMemory.sets });
  }
  if (Array.isArray(state.xhsCoverMemory?.projects)) {
    buckets.push({ path: 'xhsCoverMemory.projects', projects: state.xhsCoverMemory.projects });
  }
  if (Array.isArray(state.videoMemory?.veoProjects)) {
    buckets.push({ path: 'videoMemory.veoProjects', projects: state.videoMemory.veoProjects });
  }
  if (Array.isArray(state.videoMemory?.storyboard?.projects)) {
    buckets.push({ path: 'videoMemory.storyboard.projects', projects: state.videoMemory.storyboard.projects });
  }
  return buckets;
};

const resultArraysForProject = (project = {}) => ([
  { name: 'results', items: Array.isArray(project.results) ? project.results : null },
  { name: 'schemes', items: Array.isArray(project.schemes) ? project.schemes : null },
].filter((entry) => Array.isArray(entry.items)));

const resultItemsForProject = (project = {}) => (
  resultArraysForProject(project).flatMap(({ items }) => asArray(items))
);

const projectOutputCount = (project = {}) => resultItemsForProject(project).filter(hasOutput).length + (hasOutput(project) ? 1 : 0);

const projectHasExecutableActiveResult = (project = {}) => resultItemsForProject(project)
  .some((item) => isActive(item) && hasIdentity(item));

const isUnrecoverableActivePlaceholder = (item = {}) => isActive(item) && !hasOutput(item) && !hasIdentity(item);

const action = (type, detail = {}) => ({ type, ...detail });

export const buildAppStateRepairPlan = (state = {}) => {
  const before = analyzeAppState(state || {});
  const nextState = cloneJson(state || {});
  const actions = [];

  projectBuckets(nextState).forEach((bucket) => {
    asArray(bucket.projects).forEach((project, projectIndex) => {
      const projectPath = `${bucket.path}[${projectIndex}]`;
      const projectId = compactKey(project.id);
      const hadProjectOutput = projectOutputCount(project) > 0;

      resultArraysForProject(project).forEach(({ name, items }) => {
        const kept = [];
        items.forEach((item, itemIndex) => {
          if (!isUnrecoverableActivePlaceholder(item)) {
            kept.push(item);
            return;
          }
          const path = `${projectPath}.${name}[${itemIndex}]`;
          if (hadProjectOutput) {
            actions.push(action('prune_active_result_without_identity', { path, projectId, itemId: compactKey(item.id) }));
            return;
          }
          const failedItem = {
            ...item,
            status: 'error',
            error: compactKey(item.error) || UNRECOVERABLE_TASK_MESSAGE,
          };
          kept.push(failedItem);
          actions.push(action('mark_active_result_without_identity_failed', { path, projectId, itemId: compactKey(item.id) }));
        });
        project[name] = kept;
      });

      const outputCount = projectOutputCount(project);
      if (!isCompleted(project)) return;
      if (projectHasExecutableActiveResult(project)) {
        project.status = 'generating';
        actions.push(action('restore_completed_project_with_active_result', { path: projectPath, projectId }));
        return;
      }
      if (outputCount === 0) {
        project.status = 'error';
        project.completedCount = 0;
        project.error = compactKey(project.error) || COMPLETED_WITHOUT_OUTPUT_MESSAGE;
        actions.push(action('mark_completed_project_without_output_error', { path: projectPath, projectId }));
        return;
      }
      const taskCount = Number(project.taskCount || 0) || 0;
      const completedCount = Number(project.completedCount || 0) || 0;
      if (taskCount !== outputCount || completedCount !== outputCount) {
        project.taskCount = outputCount;
        project.completedCount = outputCount;
        actions.push(action('normalize_completed_project_counts', {
          path: projectPath,
          projectId,
          beforeTaskCount: taskCount,
          beforeCompletedCount: completedCount,
          outputCount,
        }));
      }
    });
  });

  const after = analyzeAppState(nextState);
  return {
    changed: actions.length > 0,
    actionCount: actions.length,
    actions,
    before,
    after,
    nextState,
  };
};
