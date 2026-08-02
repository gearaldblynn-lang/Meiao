type TranslationProjectLike = {
  id: string;
  name?: string;
  module?: string;
  subFeature?: string;
  createdAt?: number;
  taskCount?: number;
  results?: unknown[];
};

const SUBFEATURE_LABELS: Record<string, string> = {
  main: '主图出海',
  main_image: '主图出海',
  detail: '详情出海',
  detail_page: '详情出海',
  remove_text: '去文案',
};

const normalizeSubFeature = (value?: string) => {
  const normalized = String(value || '').trim();
  if (normalized === 'detail_page') return 'detail';
  if (normalized === 'main_image') return 'main';
  return normalized === 'detail' || normalized === 'remove_text' ? normalized : 'main';
};

const validTimestamp = (value?: number) => {
  const timestamp = Number(value || 0);
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : 0;
};

const localDateKey = (value?: number) => {
  const timestamp = validTimestamp(value);
  if (!timestamp) return '';
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
};

const submittedCount = (project: TranslationProjectLike) => {
  const taskCount = Math.floor(Number(project.taskCount || 0));
  if (taskCount > 0) return taskCount;
  const resultCount = Array.isArray(project.results) ? project.results.length : 0;
  return Math.max(resultCount, 1);
};

export const formatTranslationProjectName = ({
  createdAt,
  sequence,
  subFeature,
  count,
}: {
  createdAt: number;
  sequence: number;
  subFeature?: string;
  count: number;
}) => {
  const timestamp = validTimestamp(createdAt);
  const safeSequence = Math.max(1, Math.floor(Number(sequence) || 1));
  const safeCount = Math.max(1, Math.floor(Number(count) || 1));
  if (!timestamp) return '';
  const date = new Date(timestamp);
  const label = SUBFEATURE_LABELS[normalizeSubFeature(subFeature)] || '主图出海';
  return `${date.getMonth() + 1}月${date.getDate()}日 项目${safeSequence} ${label}·${safeCount}张`;
};

const groupKey = (project: TranslationProjectLike) => {
  const dateKey = localDateKey(project.createdAt);
  return dateKey ? `${dateKey}:${normalizeSubFeature(project.subFeature)}` : '';
};

export const getNextTranslationProjectSequence = <TProject extends TranslationProjectLike>(
  projects: TProject[],
  candidate: { createdAt: number; subFeature?: string },
) => {
  const candidateKey = groupKey({
    id: 'candidate',
    module: 'translation',
    createdAt: candidate.createdAt,
    subFeature: candidate.subFeature,
  });
  if (!candidateKey) return 1;
  return projects.filter((project) => (
    project.module === 'translation'
    && groupKey(project) === candidateKey
  )).length + 1;
};

export const normalizeTranslationProjectNames = <TProject extends TranslationProjectLike>(
  projects: TProject[],
): TProject[] => {
  const sequences = new Map<string, number>();
  const grouped = new Map<string, Array<{ project: TProject; index: number }>>();

  projects.forEach((project, index) => {
    if (project.module !== 'translation' || String(project.id || '').startsWith('task-project-')) return;
    const key = groupKey(project);
    if (!key) return;
    const entries = grouped.get(key) || [];
    entries.push({ project, index });
    grouped.set(key, entries);
  });

  grouped.forEach((entries) => {
    entries
      .sort((left, right) => (
        validTimestamp(left.project.createdAt) - validTimestamp(right.project.createdAt)
        || left.index - right.index
        || String(left.project.id).localeCompare(String(right.project.id))
      ))
      .forEach(({ project }, index) => {
        sequences.set(project.id, index + 1);
      });
  });

  return projects.map((project) => {
    const sequence = sequences.get(project.id);
    if (!sequence) return project;
    const name = formatTranslationProjectName({
      createdAt: validTimestamp(project.createdAt),
      sequence,
      subFeature: project.subFeature,
      count: submittedCount(project),
    });
    return name && name !== project.name ? { ...project, name } : project;
  });
};
