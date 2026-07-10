type DeletionResultLike = {
  backendJobId?: unknown;
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
  if (storedProjectId.startsWith('job-')) {
    addInternalJobId(jobIds, storedProjectId.slice(4));
  }
  (Array.isArray(project?.results) ? project.results : []).forEach((result) => {
    addInternalJobId(jobIds, result?.backendJobId);
  });
  tasks.forEach((task) => {
    if (normalizeInternalJobId(task?.projectId) !== normalizedProjectId) return;
    addInternalJobId(jobIds, task?.backendJobId);
  });

  return Array.from(jobIds);
};
