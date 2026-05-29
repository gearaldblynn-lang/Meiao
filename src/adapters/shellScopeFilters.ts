export interface ScopeProjectResult {
  id: string;
  status: 'completed' | 'generating' | 'error';
  subFeature?: string;
}

export interface ScopeProject {
  id: string;
  module: string;
  name?: string;
  status?: 'planning' | 'generating' | 'completed' | 'error';
  createdAt?: string | number;
  sortAt?: number;
  createdAtMs?: number;
  updatedAt?: number;
  results: ScopeProjectResult[];
  taskCount: number;
  completedCount: number;
  subFeature?: string;
  backendJobId?: string;
}

export interface ScopeTask {
  id: string;
  projectId?: string;
  module: string;
  type?: 'image' | 'video' | 'plan' | 'batch' | string;
  status: 'pending' | 'generating' | 'completed' | 'error';
  title: string;
  progress?: number;
  createdAt: string;
  total?: number;
  completed?: number;
  subFeature?: string;
  backendJobId?: string;
}

interface FilterProjectsInput<TProject extends ScopeProject> {
  projects: TProject[];
  pageMode: 'landing' | 'module' | 'settings' | 'account';
  activeModule: string;
  activeSubFeature: string;
  getDefaultSubFeature: (module: string) => string;
}

const projectResultSubFeature = <TProject extends ScopeProject>(
  project: TProject,
  result: ScopeProjectResult,
  getDefaultSubFeature: (module: string) => string,
) => result.subFeature || project.subFeature || getDefaultSubFeature(project.module);

const timestampLowerBound = new Date('2020-01-01T00:00:00Z').getTime();
const timestampUpperBound = new Date('2100-01-01T00:00:00Z').getTime();

const toFiniteTimestamp = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= timestampLowerBound && parsed <= timestampUpperBound ? parsed : 0;
};

const extractTimestampFromText = (value: unknown) => {
  const matches = String(value || '').match(/\d{12,13}/g) || [];
  for (const match of matches) {
    const timestamp = toFiniteTimestamp(match);
    if (timestamp) return timestamp;
  }
  return 0;
};

const parseMonthDay = (value: unknown) => {
  const text = String(value || '').trim();
  const match = text.match(/(\d{1,2})月(\d{1,2})日/) || text.match(/^(\d{1,2})-(\d{1,2})$/);
  if (!match) return 0;
  const month = Number(match[1]);
  const day = Number(match[2]);
  if (!Number.isInteger(month) || !Number.isInteger(day) || month < 1 || month > 12 || day < 1 || day > 31) return 0;
  const date = new Date();
  date.setMonth(month - 1, day);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
};

const parseProjectSequence = (value: unknown) => {
  const match = String(value || '').match(/项目\s*(\d+)/);
  const parsed = Number(match?.[1] || 0);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

const startOfDay = (timestamp: number) => {
  if (!timestamp) return 0;
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
};

const projectSortKey = (project: ScopeProject) => {
  const directTimestamp = toFiniteTimestamp(project.sortAt)
    || toFiniteTimestamp(project.createdAtMs)
    || toFiniteTimestamp(project.createdAt)
    || extractTimestampFromText(project.id);
  const dayTimestamp = startOfDay(directTimestamp)
    || parseMonthDay(project.createdAt)
    || parseMonthDay(project.name)
    || startOfDay(toFiniteTimestamp(project.updatedAt));
  return {
    dayTimestamp,
    sequence: parseProjectSequence(project.name) || parseProjectSequence(project.id),
    directTimestamp,
  };
};

export const sortProjectsNewestFirst = <TProject extends ScopeProject>(projects: TProject[]): TProject[] => [...projects]
  .map((project, index) => ({ project, index, key: projectSortKey(project) }))
  .sort((left, right) => (
    right.key.dayTimestamp - left.key.dayTimestamp
    || right.key.sequence - left.key.sequence
    || right.key.directTimestamp - left.key.directTimestamp
    || left.index - right.index
  ))
  .map((item) => item.project);

export const filterProjectsForScope = <TProject extends ScopeProject>({
  projects,
  pageMode,
  activeModule,
  activeSubFeature,
  getDefaultSubFeature,
}: FilterProjectsInput<TProject>): TProject[] => projects
  .filter((project) => pageMode === 'module' && project.module === activeModule)
  .map((project) => {
    const projectSubFeature = project.subFeature || getDefaultSubFeature(project.module);
    if (projectSubFeature === activeSubFeature) {
      const matchingResults = project.results.filter((result) => (
        projectResultSubFeature(project, result, getDefaultSubFeature) === activeSubFeature
      ));
      return matchingResults.length === project.results.length
        ? project
        : {
            ...project,
            results: matchingResults,
            taskCount: Math.max(matchingResults.length, 1),
            completedCount: matchingResults.filter((result) => result.status === 'completed').length,
          };
    }

    const matchingResults = project.results.filter((result) => (
      Boolean(result.subFeature) && result.subFeature === activeSubFeature
    ));
    if (matchingResults.length === 0) return null;
    return {
      ...project,
      id: `${project.id}-${activeSubFeature}`,
      subFeature: activeSubFeature,
      results: matchingResults,
      taskCount: matchingResults.length,
      completedCount: matchingResults.filter((result) => result.status === 'completed').length,
    };
  })
  .filter((project): project is TProject => Boolean(project));

export const buildTaskFallbackProjects = <
  TProject extends ScopeProject,
  TTask extends ScopeTask,
>(
  projects: TProject[],
  tasks: TTask[],
) => {
  const represented = new Set<string>();
  projects.forEach((project) => {
    represented.add(`project:${project.id}`);
    const backendJobId = String(project.backendJobId || '').trim();
    if (backendJobId) represented.add(`job:${backendJobId}`);
  });

  return tasks.flatMap((task) => {
    if (task.status === 'completed' || task.status === 'error') return [];
    const projectId = String(task.projectId || '').trim();
    const backendJobId = String(task.backendJobId || task.id || '').trim();
    if ((projectId && represented.has(`project:${projectId}`))
      || (backendJobId && represented.has(`job:${backendJobId}`))) {
      return [];
    }

    return [{
      id: `task-project-${projectId || task.id}`,
      name: task.title || '进行中的任务',
      module: task.module,
      status: task.status === 'pending' ? 'planning' : 'generating',
      createdAt: task.createdAt,
      results: [],
      taskCount: Number(task.total || 1) || 1,
      completedCount: Number(task.completed || 0) || 0,
      subFeature: task.subFeature,
      sourceType: 'job',
      backendJobId: backendJobId || undefined,
    }];
  });
};
