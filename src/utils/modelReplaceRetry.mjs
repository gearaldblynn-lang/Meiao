const cloneMaterials = (materials = {}) => Object.fromEntries(
  Object.entries(materials).map(([type, items]) => [
    type,
    (Array.isArray(items) ? items : []).map((item) => ({ ...item })),
  ]),
);

const normalizedIdentity = (value) => {
  const text = String(value || '').trim();
  return text || undefined;
};

const isModelReplaceResult = (project, result) => (
  project.module === 'everything_replace'
  && (result?.subFeature || project.subFeature) === 'model_replace'
);

const hasStableMaterialUrl = (item) => Boolean(String(item?.remoteUrl || item?.url || '').trim());

const isLibraryIdentityContext = (context = {}) => (
  context?.identitySource === 'library'
  && context?.virtualModelSnapshot?.identitySource === 'library'
  && String(context?.virtualModelSnapshot?.virtualModelId || '').trim()
  && String(context?.virtualModelSnapshot?.virtualModelVersionId || '').trim()
);

import { normalizeModelReplaceRawUserPrompt } from './modelReplacePromptInput.mjs';
import { sanitizeVirtualModelSnapshot } from './virtualModelSnapshot.mjs';

const safeLibraryModelSelection = (snapshot = {}, forceHistorical = false) => (
  sanitizeVirtualModelSnapshot(snapshot, { forceHistorical }) || {
    identitySource: 'library',
    virtualModelId: String(snapshot.virtualModelId || '').trim(),
    virtualModelVersionId: String(snapshot.virtualModelVersionId || '').trim(),
  }
);

export const getProjectResultRegenerationUnavailableReason = (project, result) => {
  if (!isModelReplaceResult(project, result)) return undefined;
  if (!String(result?.sourceUrl || '').trim()) {
    return '当前模特替换结果缺少原始参考图地址，无法安全重试';
  }
  if (!isLibraryIdentityContext(project.generationContext)
    && !(project.generationContext?.materials?.model || []).some(hasStableMaterialUrl)) {
    return '当前模特替换结果缺少身份图生成上下文，无法安全重试';
  }
  return undefined;
};

export const isProjectResultRegenerationEligible = (project, result, translationEligibility) => {
  if (isModelReplaceResult(project, result)) {
    return !getProjectResultRegenerationUnavailableReason(project, result);
  }
  return project.module !== 'translation'
    || translationEligibility(result.subFeature || project.subFeature, result);
};

export const buildModelReplaceRetryContext = (input, normalizeParamsForGeneration) => {
  const storedContext = input.generationContext;
  const sourceUrl = String(input.result?.sourceUrl || '').trim();
  if (!sourceUrl) {
    throw new Error('当前模特替换结果缺少原始参考图地址，无法安全重试。');
  }

  const materials = cloneMaterials(storedContext?.materials);
  const isLibraryIdentity = isLibraryIdentityContext(storedContext);
  const matchedReference = (materials.styleRef || []).find((item) => (
    String(item?.url || '').trim() === sourceUrl
    || String(item?.remoteUrl || '').trim() === sourceUrl
  ));
  const reference = {
    ...(matchedReference || {}),
    id: matchedReference?.id || `${input.result.id}-retry-model-reference`,
    type: 'styleRef',
    url: sourceUrl,
    remoteUrl: sourceUrl,
    fileName: matchedReference?.fileName || input.result.fileName || 'model-replace-reference.png',
    subFeature: matchedReference?.subFeature || 'model_replace',
  };

  return {
    prompt: normalizeModelReplaceRawUserPrompt(storedContext?.prompt),
    params: normalizeParamsForGeneration(
      'everything_replace',
      'model_replace',
      { ...(storedContext?.params || {}) },
    ),
    materials: {
      ...materials,
      model: isLibraryIdentity ? [] : (materials.model || []).map((item) => ({ ...item })),
      styleRef: [reference],
    },
    sourceUrl,
    ...(isLibraryIdentity ? {
      identitySource: 'library',
      virtualModelSnapshot: safeLibraryModelSelection({ ...storedContext.virtualModelSnapshot, ...(input.result?.virtualModelSnapshot || {}) }, true),
      preflight: structuredClone(storedContext.preflight || {}),
    } : {}),
  };
};

export const orderModelReplaceRetryResults = (results = []) => results
  .map((result, index) => ({ result, index }))
  .sort((left, right) => {
    const leftBatch = Number(left.result.sourceBatchIndex || left.result.batchIndex || 0) || 0;
    const rightBatch = Number(right.result.sourceBatchIndex || right.result.batchIndex || 0) || 0;
    if (leftBatch > 0 && rightBatch > 0 && leftBatch !== rightBatch) return leftBatch - rightBatch;
    if (leftBatch <= 0 || rightBatch <= 0) return left.index - right.index;
    const createdDelta = (Number(left.result.createdAt || 0) || 0) - (Number(right.result.createdAt || 0) || 0);
    if (createdDelta !== 0) return createdDelta;
    const attemptDelta = (Number(left.result.retryAttempt || 0) || 0) - (Number(right.result.retryAttempt || 0) || 0);
    return attemptDelta || left.index - right.index;
  })
  .map(({ result }) => result);

export const reduceModelReplaceRetryProject = ({
  project,
  sourceResult,
  retryResultId,
  outcome,
}) => {
  const existingRetry = (project.results || []).find((item) => item.id === retryResultId);
  const taskId = outcome.taskId !== undefined
    ? normalizedIdentity(outcome.taskId)
    : normalizedIdentity(existingRetry?.taskId);
  const backendJobId = outcome.backendJobId !== undefined
    ? normalizedIdentity(outcome.backendJobId)
    : normalizedIdentity(existingRetry?.backendJobId);
  const message = String(outcome.message || '').trim();
  const status = outcome.status;
  const retryResult = {
    ...sourceResult,
    ...(existingRetry || {}),
    id: retryResultId,
    projectId: project.id,
    imageUrl: status === 'completed' ? String(outcome.imageUrl || '').trim() : '',
    videoUrl: undefined,
    mediaType: 'image',
    prompt: String(outcome.prompt || existingRetry?.prompt || sourceResult.prompt || '').trim(),
    status,
    taskId,
    backendJobId,
    creditsConsumed: status === 'completed' ? outcome.creditsConsumed : undefined,
    sourceUrl: sourceResult.sourceUrl,
    sourcePreviewUrl: sourceResult.sourcePreviewUrl || sourceResult.sourceUrl,
    error: status === 'error' || status === 'generating' ? message || undefined : undefined,
    message: status === 'error' ? message || undefined : undefined,
    errorCode: status === 'error' ? normalizedIdentity(outcome.errorCode) : undefined,
    errorDetail: status === 'error' ? normalizedIdentity(outcome.errorDetail) : undefined,
    sourceBatchIndex: sourceResult.sourceBatchIndex || sourceResult.batchIndex,
    retryOfResultId: existingRetry?.retryOfResultId || sourceResult.id,
    retryRootResultId: existingRetry?.retryRootResultId || sourceResult.retryRootResultId || sourceResult.id,
    retryAttempt: existingRetry?.retryAttempt || (Number(sourceResult.retryAttempt || 0) || 0) + 1,
  };

  const retryIndex = (project.results || []).findIndex((item) => item.id === retryResultId);
  const unorderedResults = retryIndex >= 0
    ? project.results.map((item, index) => index === retryIndex ? retryResult : item)
    : [...(project.results || []), retryResult];
  const results = orderModelReplaceRetryResults(unorderedResults);
  const completedCount = results.filter((item) => (
    item.status === 'completed' && Boolean(item.imageUrl || item.videoUrl)
  )).length;
  const taskCount = Math.max(Number(project.taskCount || 0), results.length, 1);
  const hasGenerating = results.some((item) => item.status === 'generating');
  const hasError = results.some((item) => item.status === 'error');
  const projectStatus = hasGenerating
    ? 'generating'
    : hasError
      ? 'error'
      : completedCount > 0
        ? 'completed'
        : project.status;

  return {
    ...project,
    status: projectStatus,
    error: projectStatus === 'error' ? message || project.error : undefined,
    results,
    taskCount,
    completedCount,
  };
};

export const buildModelReplaceRetryWorkflowRequest = ({
  project,
  sourceResult,
  retryResultId,
  retryContext,
  signal,
  onJobCreated,
  publicBaseUrl,
}) => ({
  module: 'everything_replace',
  subFeature: 'model_replace',
  prompt: retryContext.prompt,
  params: { ...(retryContext.params || {}) },
  materials: cloneMaterials(retryContext.materials),
  ...(retryContext.identitySource === 'library' ? {
    identitySource: 'library',
    virtualModelSnapshot: safeLibraryModelSelection(retryContext.virtualModelSnapshot),
    preflight: structuredClone(retryContext.preflight || {}),
  } : {}),
  signal,
  onJobCreated,
  publicBaseUrl,
  taskMetadata: {
    shellPurpose: 'model_replace_regeneration',
    shellProjectId: project.id,
    shellProjectName: project.name,
    shellResultId: retryResultId,
    shellPlanId: sourceResult.planId,
    subFeature: 'model_replace',
    sourceFileName: sourceResult.fileName || sourceResult.id,
    batchIndex: 1,
    batchCount: 1,
    referenceIndex: 1,
    referenceCount: 1,
    sourceBatchIndex: Math.max(1, Number(sourceResult.batchIndex || 1) || 1),
    replacementScope: retryContext.params?.replacementScope,
    identityImageCount: (retryContext.materials?.model || []).length,
    ...(retryContext.identitySource === 'library' ? safeLibraryModelSelection(retryContext.virtualModelSnapshot) : {}),
  },
});

export const runModelReplaceRetryLifecycle = async ({
  project,
  sourceResult,
  retryResultId,
  retryContext,
  signal,
  publicBaseUrl,
  runWorkflow,
  onProject,
  persistProject,
  onJobCreated,
  isRecoverableResult,
  isCancelled = undefined,
}) => {
  if (signal?.aborted || isCancelled?.()) {
    return {
      kind: 'interrupted',
      project,
      result: project.results?.find((entry) => entry.id === retryResultId),
    };
  }
  let latestProject = reduceModelReplaceRetryProject({
    project,
    sourceResult,
    retryResultId,
    outcome: { status: 'generating', prompt: retryContext.prompt },
  });
  onProject?.(latestProject, 'pending');
  try {
    const persisted = await persistProject(latestProject, 'pending');
    if (persisted === false) throw new Error('Pending retry state was not persisted');
  } catch (persistenceError) {
    onProject?.(project, 'rollback');
    let rollbackPersistenceError;
    try {
      const rollbackPersisted = await persistProject(project, 'rollback');
      if (rollbackPersisted === false) {
        rollbackPersistenceError = new Error('Original project rollback state was not persisted');
      }
    } catch (error) {
      rollbackPersistenceError = error;
    }
    return {
      kind: 'pending_persistence_error',
      project,
      persistenceError,
      rollbackPersistenceError,
    };
  }

  let backendJobId;
  let taskId;
  const updateJobIdentity = (jobId, providerTaskId) => {
    backendJobId = normalizedIdentity(jobId) || backendJobId;
    taskId = normalizedIdentity(providerTaskId) || taskId;
    latestProject = reduceModelReplaceRetryProject({
      project: latestProject,
      sourceResult,
      retryResultId,
      outcome: {
        status: 'generating',
        prompt: retryContext.prompt,
        backendJobId,
        taskId,
      },
    });
    onProject?.(latestProject, 'identity');
    onJobCreated?.(jobId, providerTaskId);
  };
  const request = buildModelReplaceRetryWorkflowRequest({
    project,
    sourceResult,
    retryResultId,
    retryContext,
    signal,
    onJobCreated: updateJobIdentity,
    publicBaseUrl,
  });

  const isInterrupted = (value) => {
    if (signal?.aborted || isCancelled?.()) return true;
    const item = value?.results?.[0] || value || {};
    return [item.status, item.errorCode, item.error, item.message]
      .some((entry) => String(entry || '').trim().toUpperCase() === 'INTERRUPTED');
  };
  const publishTerminal = async (kind, terminalProject, extra = {}) => {
    onProject?.(terminalProject, kind);
    try {
      const persisted = await persistProject(terminalProject, kind);
      if (persisted === false) throw new Error(`Terminal retry state was not persisted: ${kind}`);
      return {
        kind,
        project: terminalProject,
        result: terminalProject.results.find((entry) => entry.id === retryResultId),
        persistenceError: undefined,
        ...extra,
      };
    } catch (persistenceError) {
      return {
        kind,
        project: terminalProject,
        result: terminalProject.results.find((entry) => entry.id === retryResultId),
        ...extra,
        persistenceError,
      };
    }
  };

  try {
    const workflowResult = await runWorkflow(request);
    if (isInterrupted(workflowResult)) {
      return {
        kind: 'interrupted',
        project: latestProject,
        result: latestProject.results.find((entry) => entry.id === retryResultId),
      };
    }
    const item = workflowResult?.results?.[0] || {};
    backendJobId = normalizedIdentity(item.backendJobId) || backendJobId;
    taskId = normalizedIdentity(item.taskId) || taskId;
    const completed = item.status === 'completed' && Boolean(String(item.imageUrl || '').trim());
    const generating = !completed && (
      item.status === 'generating'
      || Boolean(isRecoverableResult?.(item))
    );
    const message = String(item.message || item.error || (generating ? '任务已提交云端，结果待同步' : '重生成失败')).trim();
    const outcome = completed
      ? {
          status: 'completed',
          imageUrl: item.imageUrl,
          prompt: item.prompt || retryContext.prompt,
          backendJobId,
          taskId,
          creditsConsumed: item.creditsConsumed,
        }
      : generating
        ? {
            status: 'generating',
            prompt: item.prompt || retryContext.prompt,
            backendJobId,
            taskId,
            message,
          }
        : {
            status: 'error',
            prompt: item.prompt || retryContext.prompt,
            backendJobId,
            taskId,
            message,
            errorCode: item.errorCode || 'model_replace_failed',
            errorDetail: item.errorDetail,
          };
    latestProject = reduceModelReplaceRetryProject({ project: latestProject, sourceResult, retryResultId, outcome });
    const kind = completed ? 'completed' : generating ? 'generating' : 'error';
    return publishTerminal(kind, latestProject);
  } catch (error) {
    if (isInterrupted(error)) {
      return {
        kind: 'interrupted',
        project: latestProject,
        result: latestProject.results.find((entry) => entry.id === retryResultId),
        error,
      };
    }
    const message = error instanceof Error ? error.message : '重生成失败';
    latestProject = reduceModelReplaceRetryProject({
      project: latestProject,
      sourceResult,
      retryResultId,
      outcome: {
        status: 'error',
        prompt: retryContext.prompt,
        backendJobId,
        taskId,
        message,
        errorCode: normalizedIdentity(error?.code) || 'model_replace_failed',
        errorDetail: error instanceof Error ? error.stack : undefined,
      },
    });
    return publishTerminal('error', latestProject, { error });
  }
};
