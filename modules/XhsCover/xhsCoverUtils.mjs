const VALID_TASK_STATUSES = new Set(['pending', 'generating', 'completed', 'error']);

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
}) => {
  const safeStylePrompt = sanitizeStylePrompt(stylePrompt);
  const contentTitle = toTrimmedInputString(title);
  const contentSubtitle = toTrimmedInputString(subtitle);
  const safeFontLabel = toTrimmedInputString(fontLabel);
  const safeDecoration = toTrimmedInputString(decoration);
  const safeExtraRequirement = toTrimmedInputString(extraRequirement);

  return [
    safeStylePrompt,
    '【核心文字规则】仅允许使用用户提供的标题与副标题作为主要文案，不得新增英文主标题、拼音标题或替代文案。',
    `【主标题】${contentTitle}`,
    contentSubtitle ? `【副标题】${contentSubtitle}` : '',
    safeFontLabel ? `【字体风格】${safeFontLabel}` : '',
    safeDecoration ? `【装饰元素】${safeDecoration}` : '',
    safeExtraRequirement ? `【额外要求】${safeExtraRequirement}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
};

export const createXhsCoverBatchRunner = (limit) => {
  const concurrency = toPositiveConcurrency(limit);

  return async (items, worker) => {
    if (!Array.isArray(items) || items.length === 0) return;
    const queue = [...items];
    let nextIndex = 0;
    const workerCount = Math.min(concurrency, queue.length);

    const loops = Array.from({ length: workerCount }, async () => {
      while (nextIndex < queue.length) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        await worker(queue[currentIndex], currentIndex);
      }
    });

    await Promise.all(loops);
  };
};
