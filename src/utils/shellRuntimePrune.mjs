const toIdSet = (values = []) =>
  new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => String(value || '').trim())
      .filter(Boolean),
  );

const collectProjectIds = (project = {}) => [
  project.id,
  project.backendJobId,
  project.planningTaskId,
  typeof project.id === 'string' && project.id.startsWith('job-') ? project.id.slice(4) : '',
].map((value) => String(value || '').trim()).filter(Boolean);

const collectTaskIds = (task = {}) => [
  task.id,
  task.backendJobId,
  task.projectId,
  typeof task.projectId === 'string' && task.projectId.startsWith('job-') ? task.projectId.slice(4) : '',
].map((value) => String(value || '').trim()).filter(Boolean);

const collectResultIds = (result = {}) => [
  result.id,
  result.taskId,
  result.backendJobId,
  result.providerTaskId,
  result.kieTaskId,
  result.projectId,
  result.planId,
].map((value) => String(value || '').trim()).filter(Boolean);

export const mergeShellRuntimeDeletionDrafts = (...drafts) => ({
  deletedJobIds: Array.from(new Set(drafts.flatMap((draft) => draft?.deletedJobIds || []))),
  deletedProjectIds: Array.from(new Set(drafts.flatMap((draft) => draft?.deletedProjectIds || []))),
  deletedResultIds: Array.from(new Set(drafts.flatMap((draft) => draft?.deletedResultIds || []))),
});

export const pruneShellRuntimeSnapshotForDeletion = (snapshot = {}, draft = {}) => {
  const deletedJobIds = toIdSet(draft.deletedJobIds);
  const deletedProjectIds = toIdSet(draft.deletedProjectIds);
  const deletedResultIds = toIdSet(draft.deletedResultIds);
  const projects = Array.isArray(snapshot.projects) ? snapshot.projects : [];
  const tasks = Array.isArray(snapshot.tasks) ? snapshot.tasks : [];

  if (deletedJobIds.size === 0 && deletedProjectIds.size === 0 && deletedResultIds.size === 0) {
    return { projects, tasks, updatedAt: snapshot.updatedAt || 0 };
  }

  const prunedProjects = projects.flatMap((project) => {
    const projectIds = collectProjectIds(project);
    if (projectIds.some((id) => deletedProjectIds.has(id) || deletedJobIds.has(id))) return [];

    const results = Array.isArray(project.results) ? project.results : [];
    const nextResults = results.filter((result) => {
      const resultIds = collectResultIds(result);
      return !resultIds.some((id) => deletedResultIds.has(id) || deletedJobIds.has(id) || deletedProjectIds.has(id));
    });

    if (results.length > 0 && nextResults.length === 0 && !project.plans?.length) return [];
    return [{ ...project, results: nextResults }];
  });

  const prunedTasks = tasks.filter((task) => {
    const taskIds = collectTaskIds(task);
    return !taskIds.some((id) => deletedJobIds.has(id) || deletedProjectIds.has(id));
  });

  return { projects: prunedProjects, tasks: prunedTasks, updatedAt: snapshot.updatedAt || 0 };
};
