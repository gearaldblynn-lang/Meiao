const VALID_TASK_STATUSES = new Set(['pending', 'generating', 'completed', 'error']);
const VALID_ASPECT_RATIOS = new Set(['3:4', '1:1', '9:16']);
const VALID_FONT_STYLES = new Set(['variety', 'songti', 'rounded', 'handwriting', 'calligraphy']);

const toPositiveConcurrency = (limit) => {
  let numeric;
  try {
    numeric = Number(limit);
  } catch {
    return 1;
  }
  if (!Number.isFinite(numeric) || numeric <= 0) return 1;
  return Math.max(1, Math.floor(numeric));
};

const toTrimmedInputString = (value) => (typeof value === 'string' ? value.trim() : '');

export const normalizeRestoredXhsCoverTasks = (tasks) => {
  if (!Array.isArray(tasks)) return [];

  return tasks
    .filter((task) => task && typeof task === 'object' && typeof task.id === 'string')
    .map((task) => {
      const status = typeof task.status === 'string' && VALID_TASK_STATUSES.has(task.status)
        ? task.status
        : 'pending';

      return {
        ...task,
        status,
        resultUrl: typeof task.resultUrl === 'string' ? task.resultUrl : undefined,
        taskId: typeof task.taskId === 'string' ? task.taskId : undefined,
        error: typeof task.error === 'string' ? task.error : undefined,
      };
    });
};

const buildFallbackProjectName = (title, createdAt) => {
  const safeTitle = toTrimmedInputString(title);
  if (safeTitle) return safeTitle;
  const date = new Date(Number(createdAt || Date.now()));
  return `小红书封面 ${date.toLocaleDateString('zh-CN')}`;
};

const normalizeProjectCore = (project) => {
  const createdAt = Number(project?.createdAt || Date.now());
  const updatedAt = Number(project?.updatedAt || createdAt);
  const title = toTrimmedInputString(project?.title);
  return {
    id: typeof project?.id === 'string' && project.id ? project.id : `xhs_project_${createdAt}`,
    name: toTrimmedInputString(project?.name) || buildFallbackProjectName(title, createdAt),
    title,
    subtitle: toTrimmedInputString(project?.subtitle),
    aspectRatio: VALID_ASPECT_RATIOS.has(project?.aspectRatio) ? project.aspectRatio : '3:4',
    fontStyle: VALID_FONT_STYLES.has(project?.fontStyle) ? project.fontStyle : 'variety',
    decoration: toTrimmedInputString(project?.decoration),
    extraRequirement: toTrimmedInputString(project?.extraRequirement),
    createdAt,
    updatedAt,
  };
};

export const normalizeRestoredXhsCoverProjects = (projects, legacyState = null) => {
  const normalizedProjects = Array.isArray(projects)
    ? projects
      .filter((project) => project && typeof project === 'object')
      .map((project) => ({
        ...normalizeProjectCore(project),
        tasks: normalizeRestoredXhsCoverTasks(project.tasks),
      }))
      .filter((project) => project.tasks.length > 0)
    : [];

  if (normalizedProjects.length > 0) return normalizedProjects;

  const legacyTasks = normalizeRestoredXhsCoverTasks(legacyState?.tasks);
  if (legacyTasks.length === 0) return [];

  const createdAt = Date.now();
  return [{
    ...normalizeProjectCore({
      id: `xhs_project_${createdAt}`,
      name: legacyState?.title,
      title: legacyState?.title,
      subtitle: legacyState?.subtitle,
      aspectRatio: legacyState?.aspectRatio,
      fontStyle: legacyState?.fontStyle,
      decoration: legacyState?.decoration,
      extraRequirement: legacyState?.extraRequirement,
      createdAt,
      updatedAt: createdAt,
    }),
    tasks: legacyTasks,
  }];
};

const sanitizeStylePrompt = (stylePrompt) => {
  const lines = toTrimmedInputString(stylePrompt)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const sanitized = [];
  let appendedIssueDowngrade = false;
  for (const line of lines) {
    const isNegativeConstraint = /(不要|不得|禁止|禁用|勿|避免|without|no\b)/i.test(line);
    if (/英文.*标题|english.*headline|headline.*english/i.test(line)) {
      if (isNegativeConstraint) sanitized.push(line);
      continue;
    }
    if (/拼音/.test(line)) {
      if (isNegativeConstraint) sanitized.push(line);
      continue;
    }
    if (/期数标签|右上角.*["“”']?#\d+["“”']?/i.test(line)) {
      if (!appendedIssueDowngrade) {
        sanitized.push('期数标签可作为小型装饰，不能替代主标题。');
        appendedIssueDowngrade = true;
      }
      continue;
    }
    sanitized.push(line);
  }

  return sanitized.join('\n');
};

export const buildXhsCoverPrompt = ({
  stylePrompt,
  title,
  subtitle,
  fontLabel,
  decoration,
  extraRequirement,
  styleReferenceUrl,
}) => {
  const safeStylePrompt = sanitizeStylePrompt(stylePrompt);
  const contentTitle = toTrimmedInputString(title);
  const contentSubtitle = toTrimmedInputString(subtitle);
  const safeFontLabel = toTrimmedInputString(fontLabel);
  const safeDecoration = toTrimmedInputString(decoration);
  const safeExtraRequirement = toTrimmedInputString(extraRequirement);
  const safeStyleReferenceUrl = toTrimmedInputString(styleReferenceUrl);

  return [
    'R Role 角色',
    '你是小红书封面视觉设计助手。',
    '',
    'T Task 任务',
    '基于用户提供的标题、副标题、字体偏好、装饰元素与风格提示，生成一份可直接用于封面生图的设计提示词。',
    '',
    'C Constraint 约束',
    '1. 仅允许使用用户提供的标题与副标题作为主要文案，不得新增英文主标题、拼音标题或替代文案。',
    '2. 保留风格提示中的有效约束，移除与主标题规则冲突的正向要求。',
    '3. 只把期数标签降级为小型装饰，不能替代主标题。',
    safeStylePrompt ? `4. 风格提示：\n${safeStylePrompt}` : '4. 风格提示：无',
    '',
    'F Format 格式',
    `【主标题】${contentTitle}`,
    contentSubtitle ? `【副标题】${contentSubtitle}` : '',
    safeFontLabel ? `【字体风格】${safeFontLabel}` : '',
    safeStyleReferenceUrl ? `【风格参考图】${safeStyleReferenceUrl}` : '',
    safeDecoration ? `【装饰元素】${safeDecoration}` : '',
    safeExtraRequirement ? `【额外要求】${safeExtraRequirement}` : '',
    '',
    'E Example 示例',
    '主标题：真正主标题',
    '副标题：辅助副标题',
    '字体风格：综艺体/粗黑体',
    '装饰元素：星星',
  ]
    .filter(Boolean)
    .join('\n\n');
};

export const createXhsCoverBatchRunner = (limit) => {
  const concurrency = toPositiveConcurrency(limit);

  return async (items, worker, options = {}) => {
    if (!Array.isArray(items) || items.length === 0) return;
    const queue = [...items];
    let nextIndex = 0;
    const workerCount = Math.min(concurrency, queue.length);
    const shouldContinue = typeof options?.shouldContinue === 'function'
      ? options.shouldContinue
      : () => true;

    const loops = Array.from({ length: workerCount }, async () => {
      while (nextIndex < queue.length) {
        if (!shouldContinue()) return;
        const currentIndex = nextIndex;
        nextIndex += 1;
        await worker(queue[currentIndex], currentIndex);
      }
    });

    await Promise.all(loops);
  };
};
