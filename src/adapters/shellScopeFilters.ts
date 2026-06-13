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
  createdAt?: number;
  createdAtPrecise?: boolean;
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
  createdAt: number;
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

const parseProjectSequence = (value: unknown) => {
  const match = String(value || '').match(/项目\s*(\d+)/);
  const parsed = Number(match?.[1] || 0);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

const projectSortKey = (project: ScopeProject) => ({
  tier: project.createdAtPrecise ? 1 : 0,
  createdAt: Number(project.createdAt) || 0,
  sequence: parseProjectSequence(project.name) || parseProjectSequence(project.id),
});

export const sortProjectsNewestFirst = <TProject extends ScopeProject>(projects: TProject[]): TProject[] => [...projects]
  .map((project, index) => ({ project, index, key: projectSortKey(project) }))
  .sort((left, right) => (
    right.key.tier - left.key.tier
    || right.key.createdAt - left.key.createdAt
    || right.key.sequence - left.key.sequence
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
      createdAtPrecise: true,
      results: [],
      taskCount: Number(task.total || 1) || 1,
      completedCount: Number(task.completed || 0) || 0,
      subFeature: task.subFeature,
      sourceType: 'job',
      backendJobId: backendJobId || undefined,
    }];
  });
};
