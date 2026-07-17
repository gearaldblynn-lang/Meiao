const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

const firstNonEmptyString = (...values) => {
  for (const value of values) {
    const normalized = String(value ?? '').trim();
    if (normalized) return normalized;
  }
  return '';
};

const normalizeQuality = (value) => {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized.includes('4')) return '4k';
  if (normalized.includes('2')) return '2k';
  return '1k';
};

const normalizeResolutionMode = (...values) => {
  const normalized = firstNonEmptyString(...values).toLowerCase();
  return normalized === 'original' || normalized.includes('原图') ? 'original' : 'custom';
};

const optionalNumber = (value, { allowZero = false } = {}) => {
  if (value === null || value === undefined || String(value).trim() === '') return undefined;
  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized < 0 || (!allowZero && normalized === 0)) return undefined;
  return normalized;
};

const resultRootId = (result) => firstNonEmptyString(result?.retryRootResultId, result?.id);

const numericSortValue = (value, fallback) => {
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : fallback;
};

const compareStrings = (left, right) => {
  const a = String(left ?? '');
  const b = String(right ?? '');
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
};

export const acquireTranslationRetryScopeLock = (locks, scopeKey) => {
  const normalizedScopeKey = String(scopeKey ?? '').trim();
  if (!locks || typeof locks.has !== 'function' || typeof locks.add !== 'function' || !normalizedScopeKey) {
    return false;
  }
  if (locks.has(normalizedScopeKey)) return false;
  locks.add(normalizedScopeKey);
  return true;
};

export const releaseTranslationRetryScopeLock = (locks, scopeKey) => {
  const normalizedScopeKey = String(scopeKey ?? '').trim();
  if (!locks || typeof locks.delete !== 'function' || !normalizedScopeKey) return false;
  return locks.delete(normalizedScopeKey);
};

export const runTranslationRetriesSequentially = async (items, retry) => {
  let processedCount = 0;
  for (const item of Array.isArray(items) ? items : []) {
    await retry(item);
    processedCount += 1;
  }
  return processedCount;
};

const TRANSLATION_PROMPT_PARAM_KEYS = [
  'targetLanguage',
  'lang',
  'language',
  'customLanguage',
  'model',
  'quality',
  'resolutionMode',
  'sizeMode',
  'targetWidth',
  'width',
  'targetHeight',
  'height',
  'maxFileSize',
  'maxSize',
  'ratio',
  'aspectRatio',
  'translationGenerationMode',
  'translationScope',
  'translationScopeLabel',
];

export const normalizeTranslationGenerationMode = (value) => {
  const normalized = String(value ?? '').trim();
  if (normalized === 'AI优化' || normalized === '策划分析') return 'AI优化';
  if (normalized === 'AI直出') return 'AI直出';
  return '';
};

export const TRANSLATION_SCOPE_PRODUCT_ISOLATION = 'product_isolation';
export const TRANSLATION_SCOPE_GLOBAL_TRANSLATION = 'global_translation';

export const normalizeTranslationScope = (value) => {
  const normalized = String(value ?? '').trim();
  if (!normalized) return TRANSLATION_SCOPE_PRODUCT_ISOLATION;
  if (normalized === TRANSLATION_SCOPE_PRODUCT_ISOLATION || normalized === '产品隔离') {
    return TRANSLATION_SCOPE_PRODUCT_ISOLATION;
  }
  if (normalized === TRANSLATION_SCOPE_GLOBAL_TRANSLATION || normalized === '全局翻译') {
    return TRANSLATION_SCOPE_GLOBAL_TRANSLATION;
  }
  return '';
};

export const getTranslationScopeLabel = (scope) => (
  scope === TRANSLATION_SCOPE_GLOBAL_TRANSLATION ? '全局翻译' : '产品隔离'
);

const getTranslationScopeFromParams = (params) => (
  normalizeTranslationScope(params?.translationScope || params?.translationScopeLabel)
);

const getTranslationScopePromptRules = (scope) => {
  if (scope === TRANSLATION_SCOPE_GLOBAL_TRANSLATION) {
    return [
      '翻译范围：全局翻译。',
      '翻译图片中所有可读文案，包括营销文案、包装、标签、参数、警示、说明、压印、贴纸或屏幕文字。',
      '仍保持 Logo、商标图形和产品型号不变；Logo 组成文字也保持不变；参数、尺寸、温度、数量、比例、容量、日期等数值事实和单位必须准确保留。',
      '不得猜测不可读文字；不得新增原图不存在的卖点、认证、功效、法律信息、成分、警示或参数。',
      '只重绘原文字区域，保持产品/包装结构、材质、颜色、图案、透视、光影、版式层级、文字方向和印刷质感。',
    ];
  }
  return [
    '翻译范围：产品隔离。',
    '产品主体、包装、logo、画面主题和版式位置保持不变；产品/包装表面文字、实拍压印文字视为图片内容，不翻译、不重绘、不移动。',
  ];
};

export const buildTranslationGenerationPrompt = ({
  mode,
  subFeatureLabel,
  planningText,
  params,
  fileName,
  relativePath,
  batchIndex,
  batchCount,
} = {}) => {
  const normalizedMode = normalizeTranslationGenerationMode(mode);
  if (!normalizedMode) {
    throw new TypeError('Translation generation mode must be AI优化 or AI直出');
  }
  const translationScope = getTranslationScopeFromParams(params);

  const normalizedSubFeatureLabel = firstNonEmptyString(subFeatureLabel) || '出海翻译';
  if (normalizedMode === 'AI优化') {
    const normalizedPlanningText = String(planningText ?? '').trim();
    if (!normalizedPlanningText) {
      throw new TypeError('Translation optimization planning text must be non-empty');
    }

    const scopeRules = getTranslationScopePromptRules(translationScope);
    return [
      '角色：商业图像文案翻译与修复助手。',
      `任务：根据 AI优化结果生成${normalizedSubFeatureLabel}成品图，按策划输出的“xxx”本地化为“xxx”执行文案替换。`,
      '约束：',
      '1. 所有替换文案必须逐字照抄 AI优化结果中右侧引号内的本地化文案，禁止改写、翻译、增删、替换字符。',
      ...scopeRules.map((rule, index) => `${index + 2}. ${rule}`),
      `${scopeRules.length + 2}. 参数、尺寸、温度、数量等数值信息必须准确保留；表格/参数/尺码类图片保持原表格行列、单元格位置和边框，仅替换对应短标签。`,
      `${scopeRules.length + 3}. 不新增原图不存在的信息或虚假卖点。`,
      `要求：严格执行以下本次新生成的 AI优化结果，输出最终图片。\n${normalizedPlanningText}`,
    ].join('\n');
  }

  const safeParams = isObject(params) ? params : {};
  const structuredParams = {
    ...TRANSLATION_PROMPT_PARAM_KEYS.reduce((allowedParams, key) => {
      if (Object.prototype.hasOwnProperty.call(safeParams, key)) {
        allowedParams[key] = safeParams[key];
      }
      return allowedParams;
    }, {}),
    __batchIndex: String(batchIndex ?? ''),
    __batchCount: String(batchCount ?? ''),
    __sourceFileName: String(fileName ?? ''),
    __sourceRelativePath: String(relativePath ?? ''),
  };
  return [
    '模块：出海翻译',
    `子功能：${normalizedSubFeatureLabel}`,
    '生成逻辑：AI直出',
    '用户需求：重新翻译当前图片中的文案。',
    `前端参数：${JSON.stringify(structuredParams)}`,
    '必须重新识别并重新翻译当前输入图片中的文案，不得复用旧结果图或旧结果图中的翻译结果。',
    ...getTranslationScopePromptRules(translationScope),
  ].join('\n');
};

/** @returns {import('../../types.ts').TranslationConfigSnapshot | null} */
export const createTranslationConfigSnapshot = (params) => {
  if (!isObject(params)) return null;

  const targetLanguage = firstNonEmptyString(params.targetLanguage, params.lang, params.language);
  const translationGenerationMode = normalizeTranslationGenerationMode(params.translationGenerationMode);
  const translationScope = normalizeTranslationScope(params.translationScope || params.translationScopeLabel);
  if (!targetLanguage || !translationGenerationMode || !translationScope) return null;

  const snapshot = {
    targetLanguage,
    customLanguage: String(params.customLanguage ?? '').trim(),
    model: String(params.model ?? '').trim(),
    quality: normalizeQuality(params.quality),
    resolutionMode: normalizeResolutionMode(params.resolutionMode, params.sizeMode),
    translationScope,
  };

  const targetWidth = optionalNumber(params.targetWidth) ?? optionalNumber(params.width);
  const targetHeight = optionalNumber(params.targetHeight) ?? optionalNumber(params.height);
  const maxFileSize = optionalNumber(params.maxFileSize, { allowZero: false })
    ?? optionalNumber(params.maxSize, { allowZero: false });
  if (targetWidth !== undefined) snapshot.targetWidth = targetWidth;
  if (targetHeight !== undefined) snapshot.targetHeight = targetHeight;
  if (maxFileSize !== undefined) snapshot.maxFileSize = maxFileSize;

  snapshot.aspectRatio = firstNonEmptyString(params.aspectRatio, params.ratio) || 'auto';
  snapshot.translationGenerationMode = translationGenerationMode;
  return snapshot;
};

export const extractTranslationParamsFromPrompt = (prompt) => {
  if (typeof prompt !== 'string') return null;
  const parameterLine = prompt.split(/\r?\n/).find((line) => line.startsWith('前端参数：'));
  if (!parameterLine) return null;

  try {
    const parsed = JSON.parse(parameterLine.slice('前端参数：'.length).trim());
    return isObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

export const resolveTranslationRetrySnapshot = ({ result, projectParams } = {}) => {
  const promptParams = extractTranslationParamsFromPrompt(result?.prompt);
  for (const candidate of [result?.translationConfigSnapshot, projectParams, promptParams]) {
    const snapshot = createTranslationConfigSnapshot(candidate);
    if (snapshot) return snapshot;
  }
  return null;
};

export const translationSnapshotToParams = (snapshot) => {
  const normalized = createTranslationConfigSnapshot(snapshot);
  if (!normalized) return null;

  return {
    lang: normalized.targetLanguage,
    language: normalized.targetLanguage,
    customLanguage: normalized.customLanguage,
    model: normalized.model,
    quality: normalized.quality,
    resolutionMode: normalized.resolutionMode,
    sizeMode: normalized.resolutionMode,
    targetWidth: normalized.targetWidth,
    width: normalized.targetWidth,
    targetHeight: normalized.targetHeight,
    height: normalized.targetHeight,
    maxFileSize: normalized.maxFileSize,
    maxSize: normalized.maxFileSize,
    ratio: normalized.aspectRatio,
    aspectRatio: normalized.aspectRatio,
    translationGenerationMode: normalized.translationGenerationMode,
    translationScope: normalized.translationScope,
    translationScopeLabel: getTranslationScopeLabel(normalized.translationScope),
  };
};

/**
 * @param {{
 *   results?: any[],
 *   sourceResult?: any,
 *   createId?: string | (() => string),
 *   createdAt?: number | (() => number),
 * }} input
 */
export const buildTranslationRetryDescriptor = ({
  results = [],
  sourceResult,
  createId,
  createdAt,
} = {}) => {
  const sourceResultId = typeof sourceResult?.id === 'string' ? sourceResult.id.trim() : '';
  if (!sourceResultId) {
    throw new TypeError('Translation retry sourceResult.id must be a non-empty string');
  }

  const retryId = typeof createId === 'function' ? createId() : createId;
  if (typeof retryId !== 'string' || !retryId.trim()) {
    throw new TypeError('Translation retry id must be a non-empty string');
  }

  const safeResults = Array.isArray(results) ? results : [];
  const retryRootResultId = firstNonEmptyString(sourceResult?.retryRootResultId, sourceResultId);
  const rootIndex = safeResults.findIndex((result) => result?.id === retryRootResultId);
  const rootResult = rootIndex >= 0 ? safeResults[rootIndex] : null;
  const relatedResults = [...safeResults, sourceResult].filter(
    (result, index, collection) => result
      && resultRootId(result) === retryRootResultId
      && collection.indexOf(result) === index,
  );
  const maxAttempt = relatedResults.reduce(
    (highest, result) => Math.max(highest, numericSortValue(result?.retryAttempt, result?.id === retryRootResultId ? 0 : 1)),
    0,
  );
  const sourceOrder = sourceResult?.sourceOrder
    ?? rootResult?.sourceOrder
    ?? (rootIndex >= 0 ? rootIndex : safeResults.indexOf(sourceResult));

  return {
    id: retryId,
    retryOfResultId: sourceResultId,
    retryRootResultId,
    retryAttempt: maxAttempt + 1,
    sourceOrder: sourceOrder >= 0 ? sourceOrder : safeResults.length,
    createdAt: typeof createdAt === 'function' ? createdAt() : createdAt,
  };
};

export const sortTranslationRetryResults = (results) => {
  if (!Array.isArray(results)) return [];

  const rootMetadata = new Map();
  results.forEach((result, index) => {
    const rootId = resultRootId(result);
    const existing = rootMetadata.get(rootId);
    const isOriginal = result?.id === rootId;
    const sourceOrder = numericSortValue(result?.sourceOrder, index);
    if (!existing) {
      rootMetadata.set(rootId, { index, sourceOrder, hasOriginal: isOriginal });
      return;
    }
    if (isOriginal || !existing.hasOriginal) {
      existing.index = isOriginal ? index : Math.min(existing.index, index);
      existing.sourceOrder = isOriginal ? sourceOrder : Math.min(existing.sourceOrder, sourceOrder);
      existing.hasOriginal = existing.hasOriginal || isOriginal;
    }
  });

  return results
    .map((result, index) => ({ result, index }))
    .sort((left, right) => {
      const leftRootId = resultRootId(left.result);
      const rightRootId = resultRootId(right.result);
      const leftRoot = rootMetadata.get(leftRootId);
      const rightRoot = rootMetadata.get(rightRootId);
      const rootOrder = leftRoot.sourceOrder - rightRoot.sourceOrder;
      if (rootOrder) return rootOrder;
      const rootIndexOrder = leftRoot.index - rightRoot.index;
      if (rootIndexOrder) return rootIndexOrder;
      const rootIdOrder = compareStrings(leftRootId, rightRootId);
      if (rootIdOrder) return rootIdOrder;

      const leftAttempt = left.result?.id === leftRootId
        ? 0
        : numericSortValue(left.result?.retryAttempt, 1);
      const rightAttempt = right.result?.id === rightRootId
        ? 0
        : numericSortValue(right.result?.retryAttempt, 1);
      const attemptOrder = leftAttempt - rightAttempt;
      if (attemptOrder) return attemptOrder;

      const createdAtOrder = numericSortValue(left.result?.createdAt, Number.POSITIVE_INFINITY)
        - numericSortValue(right.result?.createdAt, Number.POSITIVE_INFINITY);
      if (createdAtOrder) return createdAtOrder;
      const idOrder = compareStrings(left.result?.id, right.result?.id);
      return idOrder || left.index - right.index;
    })
    .map(({ result }) => result);
};

export const upsertTranslationRetryResultInProject = (project, retryResult) => {
  const currentResults = Array.isArray(project?.results) ? project.results : [];
  const hasRetryResult = currentResults.some((result) => result?.id === retryResult?.id);
  const results = sortTranslationRetryResults(hasRetryResult
    ? currentResults.map((result) => result?.id === retryResult?.id ? retryResult : result)
    : [...currentResults, retryResult]);
  const hasGenerating = results.some((result) => result?.status === 'generating');
  const hasError = results.some((result) => result?.status === 'error');

  return {
    ...project,
    status: hasGenerating ? 'generating' : hasError ? 'error' : 'completed',
    error: hasGenerating ? undefined : project?.error,
    results,
    taskCount: results.length,
    completedCount: results.filter((result) => (
      result?.status === 'completed' && Boolean(result?.imageUrl || result?.videoUrl)
    )).length,
  };
};

/**
 * @param {{
 *   projects?: any[],
 *   projectId?: string,
 *   retryResult?: any,
 *   allowAppend?: boolean,
 * }} input
 */
export const mergeTranslationRetryResultIntoProjects = ({
  projects,
  projectId,
  retryResult,
  allowAppend = false,
} = {}) => {
  const currentProjects = Array.isArray(projects) ? projects : [];
  const currentProject = currentProjects.find((project) => project?.id === projectId);
  if (!currentProject || !retryResult?.id) {
    return { projects: currentProjects, project: null, updated: false };
  }

  const currentResults = Array.isArray(currentProject.results) ? currentProject.results : [];
  const hasRetryResult = currentResults.some((result) => result?.id === retryResult.id);
  const sourceResultId = firstNonEmptyString(retryResult.retryOfResultId, retryResult.retryRootResultId);
  const canAppend = allowAppend
    && !hasRetryResult
    && sourceResultId
    && currentResults.some((result) => result?.id === sourceResultId);
  if (!hasRetryResult && !canAppend) {
    return { projects: currentProjects, project: null, updated: false };
  }

  const currentRetryResult = currentResults.find((result) => result?.id === retryResult.id);
  const mergedRetryResult = currentRetryResult
    ? { ...currentRetryResult, ...retryResult }
    : retryResult;
  const project = upsertTranslationRetryResultInProject(currentProject, mergedRetryResult);
  return {
    projects: currentProjects.map((current) => current?.id === projectId ? project : current),
    project,
    updated: true,
  };
};

export const reduceTranslationRetryProjectMutation = (projects, mutation = {}) => (
  mergeTranslationRetryResultIntoProjects({
    ...mutation,
    projects,
  })
);

export const isTranslationResultRetryEligible = (subFeature, result) => {
  if (result?.status === 'error') return true;
  return result?.status === 'completed'
    && ['main', 'detail'].includes(String(subFeature ?? '').trim())
    && Boolean(String(result?.imageUrl ?? '').trim());
};

export const getTranslationRetryLineageLabel = (result, results = []) => {
  const retryAttempt = Math.max(0, Math.floor(numericSortValue(result?.retryAttempt, 0)));
  if (retryAttempt <= 0) return '';
  const sourceResultId = firstNonEmptyString(result?.retryOfResultId);
  if (!sourceResultId) return `重试 ${retryAttempt} · 来源：未知`;

  const sourceResult = (Array.isArray(results) ? results : [])
    .find((candidate) => firstNonEmptyString(candidate?.id) === sourceResultId);
  if (!sourceResult) {
    const rootResultId = firstNonEmptyString(result?.retryRootResultId);
    const deletedSourceLabel = retryAttempt === 1 || (rootResultId && sourceResultId === rootResultId)
      ? '原始结果已删除'
      : '来源结果已删除';
    return `重试 ${retryAttempt} · 来源：${deletedSourceLabel}`;
  }

  const sourceAttempt = Math.max(0, numericSortValue(sourceResult.retryAttempt, 0));
  const sourceLabel = sourceAttempt > 0 ? `重试 ${sourceAttempt}` : '原始结果';
  return `重试 ${retryAttempt} · 来源：${sourceLabel}`;
};

export const appendTranslationRetrySuffix = (relativePath, retryAttempt, extension) => {
  const normalizedPath = String(relativePath ?? '').replace(/\\/g, '/');
  const lastSlash = normalizedPath.lastIndexOf('/');
  const lastDot = normalizedPath.lastIndexOf('.');
  const hasPathExtension = lastDot > lastSlash + 1;
  const pathExtension = hasPathExtension ? normalizedPath.slice(lastDot) : '';
  const requestedExtension = firstNonEmptyString(extension);
  const normalizedExtension = requestedExtension
    ? `.${requestedExtension.replace(/^\.+/, '')}`
    : pathExtension;
  const basePath = hasPathExtension ? normalizedPath.slice(0, lastDot) : normalizedPath;
  const attempt = numericSortValue(retryAttempt, 0);
  const suffix = attempt > 0 ? `__retry-${attempt}` : '';
  return `${basePath}${suffix}${normalizedExtension}`;
};

/**
 * @param {{
 *   results?: any[],
 *   result?: any,
 *   extension?: string,
 *   fallbackIndex?: number,
 * }} input
 */
export const buildTranslationResultDownloadPath = ({
  results = [],
  result,
  extension,
  fallbackIndex,
} = {}) => {
  const safeResults = Array.isArray(results) ? results : [];
  const currentResultIndex = safeResults.indexOf(result);
  const candidates = currentResultIndex >= 0 ? safeResults : [...safeResults, result];
  const currentFallbackIndex = numericSortValue(fallbackIndex, safeResults.length);
  const records = candidates.filter(Boolean).map((candidate, index) => {
    const stableIndex = candidate === result && currentResultIndex < 0 ? currentFallbackIndex : index;
    const candidateId = firstNonEmptyString(candidate.id);
    const candidatePath = firstNonEmptyString(candidate.relativePath, candidate.fileName);
    const sourceOrderValue = Number(candidate.sourceOrder);
    const createdAtValue = Number(candidate.createdAt);
    const rootId = resultRootId(candidate) || candidateId || [
      'anonymous',
      Number.isFinite(sourceOrderValue) ? sourceOrderValue : '',
      Number.isFinite(createdAtValue) ? createdAtValue : '',
      candidatePath,
    ].join(':');
    return {
      result: candidate,
      index: stableIndex,
      id: candidateId,
      rootId,
      path: candidatePath,
      sourceOrder: Number.isFinite(sourceOrderValue) ? sourceOrderValue : Number.POSITIVE_INFINITY,
      createdAt: Number.isFinite(createdAtValue) ? createdAtValue : Number.POSITIVE_INFINITY,
      isOriginal: candidateId === rootId,
      retryAttempt: candidateId === rootId
        ? 0
        : Math.max(0, Math.floor(numericSortValue(candidate.retryAttempt, 1))),
    };
  });
  const rootMetadata = new Map();
  records.forEach((record) => {
    const existing = rootMetadata.get(record.rootId);
    if (!existing) {
      rootMetadata.set(record.rootId, {
        rootId: record.rootId,
        records: [record],
        sourceOrder: record.sourceOrder,
        createdAt: record.createdAt,
      });
      return;
    }
    existing.records.push(record);
    existing.sourceOrder = Math.min(existing.sourceOrder, record.sourceOrder);
    existing.createdAt = Math.min(existing.createdAt, record.createdAt);
  });

  const compareFiniteMetadata = (left, right) => {
    const leftFinite = Number.isFinite(left);
    const rightFinite = Number.isFinite(right);
    if (leftFinite && rightFinite && left !== right) return left - right;
    if (leftFinite !== rightFinite) return leftFinite ? -1 : 1;
    return 0;
  };
  const compareRecords = (left, right) => (
    left.retryAttempt - right.retryAttempt
    || compareFiniteMetadata(left.createdAt, right.createdAt)
    || compareStrings(left.id, right.id)
    || compareStrings(left.path, right.path)
    || left.index - right.index
  );
  const orderedRoots = Array.from(rootMetadata.values()).sort((left, right) => (
    compareFiniteMetadata(left.sourceOrder, right.sourceOrder)
    || compareFiniteMetadata(left.createdAt, right.createdAt)
    || compareStrings(left.rootId, right.rootId)
  ));
  const occupiedPaths = new Set();
  const occupiedBasenames = new Set();
  const assignedPaths = new Map();
  const normalizeCollisionKey = (value) => String(value ?? '').toLowerCase();
  const pathParts = (path) => {
    const lastSlash = path.lastIndexOf('/');
    const lastDot = path.lastIndexOf('.');
    const hasExtension = lastDot > lastSlash + 1;
    return {
      base: hasExtension ? path.slice(0, lastDot) : path,
      extension: hasExtension ? path.slice(lastDot) : '',
    };
  };
  const composePath = (basePath, sourceSuffix, retryAttempt) => {
    const parts = pathParts(basePath);
    const retrySuffix = retryAttempt > 0 ? `__retry-${retryAttempt}` : '';
    return `${parts.base}${sourceSuffix}${retrySuffix}${parts.extension}`;
  };
  const isAvailable = (path) => {
    const pathKey = normalizeCollisionKey(path);
    const basenameKey = normalizeCollisionKey(path.split('/').pop() || path);
    return !occupiedPaths.has(pathKey) && !occupiedBasenames.has(basenameKey);
  };
  const reserve = (record, path) => {
    assignedPaths.set(record.result, path);
    occupiedPaths.add(normalizeCollisionKey(path));
    occupiedBasenames.add(normalizeCollisionKey(path.split('/').pop() || path));
  };

  orderedRoots.forEach((root, rootIndex) => {
    const ordinal = rootIndex + 1;
    const orderedRecords = root.records.sort(compareRecords);
    const originalPath = orderedRecords.find((record) => record.isOriginal && record.path)?.path;
    const firstPersistedPath = orderedRecords.find((record) => record.path)?.path;
    const basePath = appendTranslationRetrySuffix(originalPath || firstPersistedPath || `translation_${ordinal}`, 0, extension);
    const representativeAttempts = Array.from(new Map(
      orderedRecords.map((record) => [record.retryAttempt, record]),
    ).values());
    let sourceSuffix = '';
    let sourceSuffixAttempt = 1;
    while (!representativeAttempts.every((record) => isAvailable(composePath(basePath, sourceSuffix, record.retryAttempt)))) {
      sourceSuffix = sourceSuffixAttempt === 1
        ? `__source-${ordinal}`
        : `__source-${ordinal}-${sourceSuffixAttempt}`;
      sourceSuffixAttempt += 1;
    }

    orderedRecords.forEach((record) => {
      let recordSuffix = '';
      let duplicateAttempt = 2;
      let path = composePath(basePath, sourceSuffix, record.retryAttempt);
      while (!isAvailable(path)) {
        recordSuffix = `__source-${ordinal}-${duplicateAttempt}`;
        duplicateAttempt += 1;
        path = composePath(basePath, `${sourceSuffix}${recordSuffix}`, record.retryAttempt);
      }
      reserve(record, path);
    });
  });

  return assignedPaths.get(result)
    || appendTranslationRetrySuffix(`translation_${currentFallbackIndex + 1}`, result?.retryAttempt, extension);
};

export const sumTranslationRetryCredits = (planning, generation) => {
  const total = [planning, generation].reduce((sum, value) => {
    if (value === null || value === undefined || String(value).trim() === '') return sum;
    const normalized = Number(value);
    return Number.isFinite(normalized) && normalized > 0 ? sum + normalized : sum;
  }, 0);
  return total > 0 ? total : undefined;
};

/**
 * @param {{
 *   currentResult?: any,
 *   generation?: any,
 *   recoverable?: boolean,
 *   error?: any,
 * }} input
 */
export const resolveFailedTranslationRetryLifecycle = ({
  currentResult,
  generation,
  recoverable = false,
  error,
} = {}) => {
  const baseResult = isObject(currentResult) ? currentResult : {};
  const generationResult = isObject(generation) ? generation : {};
  const generationCreditsConsumed = generationResult.creditsConsumed
    ?? baseResult.translationGenerationCreditsConsumed;
  const creditsConsumed = sumTranslationRetryCredits(
    baseResult.translationPlanningCreditsConsumed,
    generationCreditsConsumed,
  ) ?? baseResult.creditsConsumed;
  const sharedResult = {
    ...baseResult,
    taskId: generationResult.taskId || baseResult.taskId,
    backendJobId: generationResult.backendJobId || baseResult.backendJobId,
    prompt: generationResult.prompt || baseResult.prompt,
    translationGenerationCreditsConsumed: generationCreditsConsumed,
    creditsConsumed,
  };

  if (!error && generationResult.status === 'success' && generationResult.imageUrl) {
    return {
      kind: 'success',
      fileStatus: 'completed',
      result: {
        ...sharedResult,
        imageUrl: generationResult.imageUrl,
        status: 'completed',
        error: undefined,
      },
    };
  }

  const message = firstNonEmptyString(
    error?.message,
    generationResult.message,
    generationResult.error,
    baseResult.error,
  );
  if (!error && recoverable) {
    return {
      kind: 'recoverable',
      fileStatus: 'processing',
      result: {
        ...sharedResult,
        status: 'generating',
        error: message || '任务已提交云端，结果待同步',
      },
    };
  }

  return {
    kind: 'error',
    fileStatus: 'error',
    result: {
      ...sharedResult,
      status: 'error',
      error: message || '重试失败',
    },
  };
};

const getPlanningText = (planningResult) => {
  if (typeof planningResult === 'string') return planningResult;
  return firstNonEmptyString(
    planningResult?.description,
    planningResult?.planningText,
    planningResult?.text,
    planningResult?.content,
  );
};

export const executeTranslationRetryPipeline = async ({
  snapshot,
  runPlanning,
  buildPrompt,
  runGeneration,
}) => {
  const normalizedSnapshot = createTranslationConfigSnapshot(snapshot);
  if (!normalizedSnapshot) {
    throw new TypeError('Invalid translation retry snapshot: target language and generation mode are required');
  }

  let planningResult;
  if (normalizedSnapshot.translationGenerationMode === 'AI优化') {
    planningResult = await runPlanning(normalizedSnapshot);
  }

  const planningText = getPlanningText(planningResult);
  const prompt = buildPrompt(planningText, normalizedSnapshot);
  const generation = await runGeneration(prompt, normalizedSnapshot);
  const planningCreditsConsumed = planningResult?.creditsConsumed;
  const generationCreditsConsumed = generation?.creditsConsumed;

  return {
    ...generation,
    prompt,
    planningText,
    planningTaskId: planningResult?.taskId,
    planningCreditsConsumed,
    generationCreditsConsumed,
    creditsConsumed: sumTranslationRetryCredits(planningCreditsConsumed, generationCreditsConsumed),
  };
};
