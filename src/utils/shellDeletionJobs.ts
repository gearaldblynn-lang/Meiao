type DeletionResultLike = {
  id?: unknown;
  backendJobId?: unknown;
  taskId?: unknown;
  providerTaskId?: unknown;
};

type DeletionProjectLike = {
  id?: unknown;
  backendJobId?: unknown;
  results?: DeletionResultLike[] | null;
};

type DeletionTaskLike = {
  projectId?: unknown;
  backendJobId?: unknown;
};

const normalizeInternalJobId = (value: unknown) => String(value || '').trim();

const addInternalJobId = (ids: Set<string>, value: unknown) => {
  const normalized = normalizeInternalJobId(value);
  if (normalized) ids.add(normalized);
};

const addSyntheticInternalJobId = (ids: Set<string>, value: unknown) => {
  const normalized = normalizeInternalJobId(value);
  if (normalized.startsWith('job-') && normalized.length > 4) {
    addInternalJobId(ids, normalized.slice(4));
  }
};

export const collectShellResultDeletionJobIds = (
  _resultId: string,
  result?: DeletionResultLike | null,
) => {
  const jobIds = new Set<string>();
  addInternalJobId(jobIds, result?.backendJobId);
  return Array.from(jobIds);
};

export const collectShellDeletionJobIds = (
  projectId: string,
  projects: DeletionProjectLike[] = [],
  tasks: DeletionTaskLike[] = [],
) => {
  const normalizedProjectId = normalizeInternalJobId(projectId);
  const jobIds = new Set<string>();
  const project = projects.find((item) => normalizeInternalJobId(item?.id) === normalizedProjectId);

  addInternalJobId(jobIds, project?.backendJobId);
  const storedProjectId = normalizeInternalJobId(project?.id);
  addSyntheticInternalJobId(jobIds, storedProjectId);
  (Array.isArray(project?.results) ? project.results : []).forEach((result) => {
    addInternalJobId(jobIds, result?.backendJobId);
  });
  tasks.forEach((task) => {
    if (normalizeInternalJobId(task?.projectId) !== normalizedProjectId) return;
    addInternalJobId(jobIds, task?.backendJobId);
  });

  return Array.from(jobIds);
};
