import { compactKey } from '../src/utils/taskResultReconcile.mjs';

const ONE_CLICK_BRANCH_KEYS = ['firstImage', 'mainImage', 'detailPage', 'sku'];

const ACTIVE_STATUSES = new Set([
  'generating',
  'pending',
  'queued',
  'running',
  'retry_waiting',
  'uploading',
  'processing',
]);

const COMPLETED_STATUSES = new Set(['completed', 'succeeded', 'success']);

const emptyIssueCounts = () => Object.create(null);

const addIssue = (report, type, detail = {}) => {
  report.issueCounts[type] = (report.issueCounts[type] || 0) + 1;
  report.issues.push({ type, ...detail });
};

const isObject = (value) => Boolean(value && typeof value === 'object' && !Array.isArray(value));

const asArray = (value) => Array.isArray(value) ? value.filter(isObject) : [];

const hasOutput = (item = {}) => Boolean(item.imageUrl || item.videoUrl || item.resultUrl || item.remoteUrl || item.url);

const statusOf = (item = {}) => compactKey(item.status).toLowerCase();

const isActive = (item = {}) => ACTIVE_STATUSES.has(statusOf(item));

const isCompleted = (item = {}) => COMPLETED_STATUSES.has(statusOf(item));

const taskIdentityFields = [
  'backendJobId',
  'planningTaskId',
  'providerTaskId',
  'taskId',
  'kieTaskId',
];

const collectTaskIdentities = (item = {}) => {
  const entries = [];
  taskIdentityFields.forEach((field) => {
    const value = compactKey(item[field]);
    if (value) entries.push({ field, value });
  });
  return entries;
};

const isInternalBackendJobId = (value) => {
  const normalized = compactKey(value);
  return /^job-[\w-]+$/i.test(normalized) || /^[a-f0-9]{24}$/i.test(normalized);
};

// 单一判据:无身份活跃占位(活跃状态 + 无输出 + 无任何任务身份)。
// 消费方:本文件 analyzeAppState(审计)、appStateRepairPlan(存量修复)、
// appStateMerge 存储守卫(增量堵源头)。禁止在别处再写平行拷贝。
export const isIdentitylessActivePlaceholder = (item = {}) => (
  isObject(item)
  && isActive(item)
  && !hasOutput(item)
  && collectTaskIdentities(item).length === 0
);

export const projectBuckets = (state = {}) => {
  const buckets = [];
  if (Array.isArray(state.shellProjects)) {
    buckets.push({ bucket: 'shellProjects', path: 'shellProjects', projects: state.shellProjects });
  }
  if (isObject(state.oneClickMemory)) {
    ONE_CLICK_BRANCH_KEYS.forEach((key) => {
      const projects = state.oneClickMemory?.[key]?.projects;
      if (Array.isArray(projects)) {
        buckets.push({ bucket: `oneClickMemory.${key}.projects`, path: `oneClickMemory.${key}.projects`, projects });
      }
    });
  }
  if (Array.isArray(state.buyerShowMemory?.sets)) {
    buckets.push({ bucket: 'buyerShowMemory.sets', path: 'buyerShowMemory.sets', projects: state.buyerShowMemory.sets });
  }
  if (Array.isArray(state.xhsCoverMemory?.projects)) {
    buckets.push({ bucket: 'xhsCoverMemory.projects', path: 'xhsCoverMemory.projects', projects: state.xhsCoverMemory.projects });
  }
  if (Array.isArray(state.videoMemory?.veoProjects)) {
    buckets.push({ bucket: 'videoMemory.veoProjects', path: 'videoMemory.veoProjects', projects: state.videoMemory.veoProjects });
  }
  if (Array.isArray(state.videoMemory?.storyboard?.projects)) {
    buckets.push({ bucket: 'videoMemory.storyboard.projects', path: 'videoMemory.storyboard.projects', projects: state.videoMemory.storyboard.projects });
  }
  return buckets;
};

const resultItemsForProject = (project = {}) => ([
  ...asArray(project.results).map((item, index) => ({ item, arrayName: 'results', index })),
  ...asArray(project.schemes).map((item, index) => ({ item, arrayName: 'schemes', index })),
]);

const projectHasAnyOutput = (project = {}) => {
  if (hasOutput(project)) return true;
  return resultItemsForProject(project).some(({ item }) => hasOutput(item));
};

const sortedIssueCounts = (issueCounts = {}) => Object.fromEntries(
  Object.entries(issueCounts).sort(([left], [right]) => left.localeCompare(right)),
);

export const analyzeAppState = (state = {}) => {
  const report = {
    parseOk: true,
    projectCount: 0,
    resultCount: 0,
    issueCounts: emptyIssueCounts(),
    issues: [],
  };

  const projectIdLocations = new Map();
  const identityOwners = new Map();

  const registerIdentity = (value, ownerId, ownerPath) => {
    const key = compactKey(value);
    if (!key) return;
    if (!identityOwners.has(key)) {
      identityOwners.set(key, { owners: new Set(), paths: new Set() });
    }
    const entry = identityOwners.get(key);
    entry.owners.add(ownerId || ownerPath);
    entry.paths.add(ownerPath);
  };

  projectBuckets(state).forEach((bucket) => {
    asArray(bucket.projects).forEach((project, projectIndex) => {
      report.projectCount += 1;
      const projectPath = `${bucket.path}[${projectIndex}]`;
      const projectId = compactKey(project.id);
      if (projectId) {
        if (!projectIdLocations.has(projectId)) projectIdLocations.set(projectId, []);
        projectIdLocations.get(projectId).push({ bucket: bucket.bucket, path: projectPath });
      }
      const identityOwner = projectId || projectPath;
      collectTaskIdentities(project).forEach(({ value }) => registerIdentity(value, identityOwner, projectPath));

      const resultEntries = resultItemsForProject(project);
      report.resultCount += resultEntries.length;

      const taskCount = Number(project.taskCount || 0) || 0;
      const completedCount = Number(project.completedCount || 0) || 0;
      if (isCompleted(project) && taskCount > completedCount) {
        addIssue(report, 'completed_project_incomplete', { path: projectPath, projectId, taskCount, completedCount });
      }
      if (isCompleted(project) && !projectHasAnyOutput(project)) {
        addIssue(report, 'completed_project_without_output', { path: projectPath, projectId });
      }
      if (isCompleted(project) && resultEntries.some(({ item }) => isActive(item))) {
        addIssue(report, 'completed_project_has_active_result', { path: projectPath, projectId });
      }

      resultEntries.forEach(({ item, arrayName, index }) => {
        const resultPath = `${projectPath}.${arrayName}[${index}]`;
        collectTaskIdentities(item).forEach(({ field, value }) => {
          registerIdentity(value, identityOwner, resultPath);
          if (
            field === 'taskId'
            && value === compactKey(item.backendJobId)
            && isInternalBackendJobId(value)
          ) {
            addIssue(report, 'internal_job_id_visible_as_task_id', { path: resultPath, projectId, taskId: value });
          }
        });
        if (isIdentitylessActivePlaceholder(item)) {
          addIssue(report, 'active_result_without_identity', { path: resultPath, projectId });
        }
      });
    });
  });

  for (const [projectId, locations] of projectIdLocations.entries()) {
    const countsByBucket = new Map();
    locations.forEach((location) => {
      countsByBucket.set(location.bucket, (countsByBucket.get(location.bucket) || 0) + 1);
    });
    const hasSameBucketDuplicate = Array.from(countsByBucket.values()).some((count) => count > 1);
    if (hasSameBucketDuplicate || locations.length > 2) {
      addIssue(report, 'duplicate_project_id', { projectId, paths: locations.map((location) => location.path) });
    }
  }
  for (const [identity, entry] of identityOwners.entries()) {
    if (entry.owners.size > 1) {
      addIssue(report, 'duplicate_task_identity', { identity, paths: Array.from(entry.paths) });
    }
  }

  report.issueCounts = sortedIssueCounts(report.issueCounts);
  return report;
};

export const analyzeAppStateRow = (row = {}) => {
  const userId = compactKey(row.user_id ?? row.userId);
  const username = compactKey(row.username);
  const displayName = compactKey(row.display_name ?? row.displayName);
  const bytes = Number(row.bytes ?? row.state_bytes ?? Buffer.byteLength(String(row.state_json ?? ''), 'utf8')) || 0;
  const base = { userId, username, displayName, bytes };
  try {
    const parsed = typeof row.state_json === 'string'
      ? JSON.parse(row.state_json || '{}')
      : row.state_json || {};
    return {
      ...base,
      ...analyzeAppState(parsed),
    };
  } catch (error) {
    return {
      ...base,
      parseOk: false,
      projectCount: 0,
      resultCount: 0,
      issueCounts: { invalid_json: 1 },
      issues: [{ type: 'invalid_json', message: String(error?.message || error) }],
    };
  }
};

export const summarizeAppStateHealthReports = (reports = []) => {
  const issueCounts = emptyIssueCounts();
  let usersWithIssues = 0;
  let projectCount = 0;
  let resultCount = 0;
  for (const report of reports) {
    const entries = Object.entries(report?.issueCounts || {});
    if (entries.some(([, count]) => Number(count) > 0)) usersWithIssues += 1;
    projectCount += Number(report?.projectCount || 0) || 0;
    resultCount += Number(report?.resultCount || 0) || 0;
    entries.forEach(([type, count]) => {
      issueCounts[type] = (issueCounts[type] || 0) + Number(count || 0);
    });
  }
  return {
    userCount: Array.isArray(reports) ? reports.length : 0,
    usersWithIssues,
    projectCount,
    resultCount,
    issueCounts: sortedIssueCounts(issueCounts),
  };
};
