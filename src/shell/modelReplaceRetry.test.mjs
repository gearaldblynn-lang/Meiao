import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  buildModelReplaceRetryContext,
  buildModelReplaceRetryWorkflowRequest,
  isProjectResultRegenerationEligible,
  reduceModelReplaceRetryProject,
  runModelReplaceRetryLifecycle,
} from '../utils/modelReplaceRetry.mjs';
import * as modelReplaceRetry from '../utils/modelReplaceRetry.mjs';
import { upsertShellProjectIntoPersistedState } from '../adapters/shellPersistence.ts';
import { buildShellDataSnapshot } from '../adapters/shellDataAdapter.ts';
import { buildPersistedAppState } from '../utils/appState.ts';
import { normalizeModelReplacementScope } from '../utils/modelReplacePrompt.mjs';

const shellAppSource = readFileSync(new URL('../ShellMigratedApp.tsx', import.meta.url), 'utf8');
const projectCardSource = readFileSync(new URL('./components/ProjectCard.tsx', import.meta.url), 'utf8');

const normalizeParamsForGeneration = (module, subFeature, params) => ({
  ...params,
  normalizedModule: module,
  normalizedSubFeature: subFeature,
  replacementScope: normalizeModelReplacementScope(params.replacementScope),
});

const material = (type, index, overrides = {}) => ({
  id: `${type}-${index}`,
  type,
  url: `https://local.example/${type}-${index}.png`,
  remoteUrl: `https://assets.example/${type}-${index}.png`,
  fileName: `${type}-${index}.png`,
  ...overrides,
});

const buildStoredContext = () => ({
  prompt: '使用原始模特替换提示词',
  params: { replacementScope: '全部替换', model: 'gpt-image-2', ratio: 'auto' },
  materials: {
    model: Array.from({ length: 4 }, (_, index) => material('model', index + 1)),
    styleRef: [material('styleRef', 1), material('styleRef', 2)],
    logo: [material('logo', 1)],
  },
});

test('model retry keeps only raw supplemental text and never falls back to a compiled result prompt', () => {
  const compiledPrompt = [
    'R Role 角色',
    'T Task 任务',
    'C Constraint 约束',
    'F Format 格式',
    'E Example 示例',
  ].join('\n');
  const sourceUrl = 'https://assets.example/styleRef-1.png';

  const rawRetry = buildModelReplaceRetryContext({
    projectName: '模特替换项目',
    generationContext: buildStoredContext(),
    result: { id: 'raw-retry', sourceUrl, prompt: compiledPrompt },
  }, normalizeParamsForGeneration);
  assert.equal(rawRetry.prompt, '使用原始模特替换提示词');

  const compiledStoredRetry = buildModelReplaceRetryContext({
    projectName: '模特替换项目',
    generationContext: { ...buildStoredContext(), prompt: compiledPrompt },
    result: { id: 'compiled-retry', sourceUrl, prompt: compiledPrompt },
  }, normalizeParamsForGeneration);
  assert.equal(compiledStoredRetry.prompt, '');

  const missingStoredRetry = buildModelReplaceRetryContext({
    projectName: '模特替换项目',
    generationContext: { ...buildStoredContext(), prompt: '' },
    result: { id: 'missing-retry', sourceUrl, prompt: compiledPrompt },
  }, normalizeParamsForGeneration);
  assert.equal(missingStoredRetry.prompt, '');
});

test('model retry requires the exact nonempty result sourceUrl instead of sourcePreviewUrl', () => {
  assert.throws(() => buildModelReplaceRetryContext({
    projectName: '模特替换项目',
    generationContext: buildStoredContext(),
    result: {
      id: 'failed-with-preview-only',
      sourcePreviewUrl: 'https://assets.example/preview-only.png',
    },
  }, normalizeParamsForGeneration), /缺少原始参考图地址/);
});

test('library model retry preserves only the URL-free model selection rather than requiring uploaded identity materials', () => {
  const generationContext = {
    ...buildStoredContext(),
    identitySource: 'library',
    virtualModelSnapshot: {
      identitySource: 'library',
      virtualModelId: 'model-1',
      virtualModelVersionId: 'version-1',
      publishedAt: 123,
      selectedAssetIds: ['asset-1', 'asset-2', 'asset-3', 'asset-4'],
      virtualModelCoverUrl: 'https://managed.example/cover.png',
      identityProfile: { gender: 'female' },
    },
    materials: { styleRef: [material('styleRef', 1)] },
  };
  const retry = buildModelReplaceRetryContext({
    projectName: 'library model retry',
    generationContext,
    result: {
      id: 'failed-library-result', sourceUrl: 'https://assets.example/styleRef-1.png',
      virtualModelSnapshot: { identitySource: 'library', virtualModelId: 'model-1', virtualModelVersionId: 'version-1', publishedAt: 123, selectedAssetIds: ['asset-1', 'asset-2', 'asset-3', 'asset-4'], assets: [{ url: 'https://managed.example/asset-1.png' }], identityProfile: { age: 28 } },
    },
  }, normalizeParamsForGeneration);

  assert.equal(retry.identitySource, 'library');
  assert.deepEqual(retry.virtualModelSnapshot, { identitySource: 'library', virtualModelId: 'model-1', virtualModelVersionId: 'version-1', allowHistoricalPublishedVersion: true, publishedAt: 123, selectedAssetIds: ['asset-1', 'asset-2', 'asset-3', 'asset-4'] });
  assert.deepEqual(retry.materials.model, []);
  const request = buildModelReplaceRetryWorkflowRequest({
    project: { id: 'library-project', name: 'library retry', module: 'everything_replace' },
    sourceResult: { id: 'failed-library-result', sourceUrl: 'https://assets.example/styleRef-1.png' },
    retryResultId: 'library-retry-result',
    retryContext: retry,
  });
  assert.equal(request.identitySource, 'library');
  assert.deepEqual(request.virtualModelSnapshot, { identitySource: 'library', virtualModelId: 'model-1', virtualModelVersionId: 'version-1', allowHistoricalPublishedVersion: true, publishedAt: 123, selectedAssetIds: ['asset-1', 'asset-2', 'asset-3', 'asset-4'] });
  assert.equal(request.taskMetadata.allowHistoricalPublishedVersion, true);
  assert.equal(request.taskMetadata.publishedAt, 123);
  assert.deepEqual(request.taskMetadata.selectedAssetIds, ['asset-1', 'asset-2', 'asset-3', 'asset-4']);
  assert.deepEqual(request.preflight, {});
  assert.equal(JSON.stringify(request).includes('https://managed.example'), false);
  assert.equal(JSON.stringify(request).includes('identityProfile'), false);
});

test('library retry keeps public model labels and the historical selection without resolver URLs', () => {
  const retry = buildModelReplaceRetryContext({
    projectName: 'library model retry',
    generationContext: {
      ...buildStoredContext(),
      identitySource: 'library',
      virtualModelSnapshot: {
        identitySource: 'library',
        virtualModelId: 'model-1',
        virtualModelVersionId: 'version-3',
        modelName: 'Summer model',
        modelCode: 'SUMMER-03',
        versionNumber: 3,
        publishedAt: 123,
        selectedAssetIds: ['asset-1', 'asset-2', 'asset-3', 'asset-4'],
        resolverUrl: 'https://resolver.example/private',
      },
    },
    result: { id: 'failed-library-result', sourceUrl: 'https://assets.example/styleRef-1.png' },
  }, normalizeParamsForGeneration);

  const request = buildModelReplaceRetryWorkflowRequest({
    project: { id: 'library-project', name: 'library retry', module: 'everything_replace' },
    sourceResult: { id: 'failed-library-result', sourceUrl: 'https://assets.example/styleRef-1.png' },
    retryResultId: 'library-retry-result',
    retryContext: retry,
  });

  assert.deepEqual(request.virtualModelSnapshot, {
    identitySource: 'library', virtualModelId: 'model-1', virtualModelVersionId: 'version-3',
    modelName: 'Summer model', modelCode: 'SUMMER-03', versionNumber: 3,
    allowHistoricalPublishedVersion: true, publishedAt: 123,
    selectedAssetIds: ['asset-1', 'asset-2', 'asset-3', 'asset-4'],
  });
  assert.equal(JSON.stringify(request).includes('resolver.example'), false);
});

test('completed library result retains historical selection through persistence, hydration, and retry', () => {
  const virtualModelSnapshot = {
    identitySource: 'library', virtualModelId: 'model-1', virtualModelVersionId: 'version-3',
    modelName: 'Summer model', modelCode: 'SUMMER-03', versionNumber: 3, publishedAt: 123,
    selectedAssetIds: ['asset-1', 'asset-2', 'asset-3', 'asset-4'], resolverUrl: 'https://resolver.example/private',
  };
  const saved = upsertShellProjectIntoPersistedState(buildPersistedAppState({}), {
    id: 'library-project', name: 'Library model', module: 'everything_replace', subFeature: 'model_replace',
    status: 'completed', createdAt: 100, taskCount: 1, completedCount: 1,
    generationContext: { prompt: 'replace', params: {}, materials: { styleRef: [material('styleRef', 1)] }, identitySource: 'library', virtualModelSnapshot },
    results: [{ id: 'library-result', imageUrl: 'https://result.example/image.png', sourceUrl: 'https://assets.example/styleRef-1.png', prompt: 'replace', model: 'gpt-image-2', aspectRatio: '1:1', status: 'completed', createdAt: 100, module: 'everything_replace', subFeature: 'model_replace', virtualModelSnapshot }],
  });
  const hydrated = buildShellDataSnapshot(saved).projects[0];
  const hydratedResult = hydrated.results[0];
  assert.deepEqual(hydratedResult.virtualModelSnapshot, {
    identitySource: 'library', virtualModelId: 'model-1', virtualModelVersionId: 'version-3',
    modelName: 'Summer model', modelCode: 'SUMMER-03', versionNumber: 3, publishedAt: 123,
    selectedAssetIds: ['asset-1', 'asset-2', 'asset-3', 'asset-4'],
  });
  const retry = buildModelReplaceRetryContext({ projectName: hydrated.name, generationContext: hydrated.generationContext, result: hydratedResult }, normalizeParamsForGeneration);
  assert.equal(retry.virtualModelSnapshot.allowHistoricalPublishedVersion, true);
  assert.equal(JSON.stringify(retry).includes('resolver.example'), false);
});

test('model retry forces both material URLs to sourceUrl when a stored url matches but remoteUrl conflicts', () => {
  const generationContext = buildStoredContext();
  generationContext.materials.styleRef[1] = material('styleRef', 2, {
    url: 'https://assets.example/current-reference.png',
    remoteUrl: 'https://cdn.example/wrong-reference.png',
  });
  const before = structuredClone(generationContext);

  const retry = buildModelReplaceRetryContext({
    projectName: '模特替换项目',
    generationContext,
    result: {
      id: 'failed-url-match',
      sourceUrl: 'https://assets.example/current-reference.png',
      fileName: 'current-reference.png',
    },
  }, normalizeParamsForGeneration);

  assert.equal(retry.params.replacementScope, 'full_person');
  assert.deepEqual(retry.materials.model.map((item) => item.id), ['model-1', 'model-2', 'model-3', 'model-4']);
  assert.equal(retry.materials.styleRef.length, 1);
  assert.equal(retry.materials.styleRef[0].id, 'styleRef-2');
  assert.equal(retry.materials.styleRef[0].url, 'https://assets.example/current-reference.png');
  assert.equal(retry.materials.styleRef[0].remoteUrl, 'https://assets.example/current-reference.png');
  assert.notEqual(retry.materials.model[0], generationContext.materials.model[0]);
  assert.notEqual(retry.materials.styleRef[0], generationContext.materials.styleRef[1]);
  assert.notEqual(retry.materials.logo[0], generationContext.materials.logo[0]);

  retry.materials.model[0].fileName = 'mutated.png';
  retry.materials.styleRef[0].fileName = 'mutated-reference.png';
  retry.materials.logo[0].fileName = 'mutated-logo.png';
  assert.deepEqual(generationContext, before);
});

test('model retry forces both material URLs to sourceUrl when a stored remoteUrl matches but url conflicts', () => {
  const generationContext = buildStoredContext();
  generationContext.materials.styleRef[0] = material('styleRef', 1, {
    url: 'https://local.example/wrong-reference.png',
    remoteUrl: 'https://assets.example/current-reference.png',
  });

  const retry = buildModelReplaceRetryContext({
    projectName: '模特替换项目',
    generationContext,
    result: {
      id: 'failed-remote-match',
      sourceUrl: 'https://assets.example/current-reference.png',
    },
  }, normalizeParamsForGeneration);

  assert.equal(retry.materials.styleRef[0].id, 'styleRef-1');
  assert.equal(retry.materials.styleRef[0].url, 'https://assets.example/current-reference.png');
  assert.equal(retry.materials.styleRef[0].remoteUrl, 'https://assets.example/current-reference.png');
});

test('model retry synthesizes one stable reference when stored materials lack an exact item', () => {
  const generationContext = buildStoredContext();
  generationContext.params.replacementScope = '身份替换';
  const before = structuredClone(generationContext);

  const retry = buildModelReplaceRetryContext({
    projectName: '模特替换项目',
    generationContext,
    result: {
      id: 'failed-result-fallback',
      sourceUrl: 'https://assets.example/missing-reference.png',
      fileName: 'missing-reference.png',
    },
  }, normalizeParamsForGeneration);

  assert.equal(retry.params.replacementScope, 'identity_only');
  assert.deepEqual(retry.materials.styleRef, [{
    id: 'failed-result-fallback-retry-model-reference',
    type: 'styleRef',
    url: 'https://assets.example/missing-reference.png',
    remoteUrl: 'https://assets.example/missing-reference.png',
    fileName: 'missing-reference.png',
    subFeature: 'model_replace',
  }]);
  assert.deepEqual(generationContext, before);
});

test('project result retry eligibility executes model, background, and translation delegation contracts', () => {
  const translationCalls = [];
  const translationEligibility = (...args) => {
    translationCalls.push(args);
    return false;
  };
  const failedResult = { status: 'error', subFeature: 'model_replace' };

  assert.equal(isProjectResultRegenerationEligible(
    {
      module: 'everything_replace',
      subFeature: 'model_replace',
      generationContext: buildStoredContext(),
    },
    { ...failedResult, sourceUrl: 'https://assets.example/reference.png' },
    translationEligibility,
  ), true);
  assert.equal(isProjectResultRegenerationEligible(
    { module: 'everything_replace', subFeature: 'background_replace' },
    { status: 'completed', subFeature: 'background_replace' },
    translationEligibility,
  ), true);
  assert.equal(translationCalls.length, 0);
  assert.equal(isProjectResultRegenerationEligible(
    { module: 'translation', subFeature: 'detail' },
    { status: 'error' },
    translationEligibility,
  ), false);
  assert.deepEqual(translationCalls, [['detail', { status: 'error' }]]);
});

test('job-only model retry is disabled with a specific reason when structured identity context is missing', () => {
  assert.equal(typeof modelReplaceRetry.getProjectResultRegenerationUnavailableReason, 'function');
  const project = {
    module: 'everything_replace',
    subFeature: 'model_replace',
    sourceType: 'job',
    generationContext: {
      prompt: 'structured prompt',
      params: { replacementScope: 'identity_only' },
      materials: {
        styleRef: [material('styleRef', 1)],
      },
    },
  };
  const result = {
    status: 'error',
    subFeature: 'model_replace',
    sourceUrl: 'https://assets.example/reference.png',
  };

  assert.equal(isProjectResultRegenerationEligible(project, result, () => true), false);
  assert.match(
    modelReplaceRetry.getProjectResultRegenerationUnavailableReason(project, result),
    /身份图生成上下文/,
  );
});

test('model retry workflow request has exact one-item metadata and cloned normalized inputs', () => {
  const retryContext = buildModelReplaceRetryContext({
    projectName: '模特替换项目',
    generationContext: buildStoredContext(),
    result: {
      id: 'failed-source',
      sourceUrl: 'https://assets.example/styleRef-2.png',
      fileName: 'reference.png',
    },
  }, normalizeParamsForGeneration);
  const before = structuredClone(retryContext);
  const signal = new AbortController().signal;
  const onJobCreated = () => undefined;

  const request = buildModelReplaceRetryWorkflowRequest({
    project: { id: 'model-project', name: '模特替换项目', module: 'everything_replace' },
    sourceResult: { id: 'failed-source', fileName: 'reference.png', batchIndex: 7 },
    retryResultId: 'retry-result',
    retryContext,
    signal,
    onJobCreated,
    publicBaseUrl: 'https://meiao.local',
  });

  assert.equal(request.module, 'everything_replace');
  assert.equal(request.subFeature, 'model_replace');
  assert.equal(request.prompt, retryContext.prompt);
  assert.deepEqual(request.params, retryContext.params);
  assert.deepEqual(request.materials.model.map((item) => item.id), ['model-1', 'model-2', 'model-3', 'model-4']);
  assert.equal(request.materials.styleRef.length, 1);
  assert.equal(request.materials.styleRef[0].url, 'https://assets.example/styleRef-2.png');
  assert.equal(request.materials.styleRef[0].remoteUrl, 'https://assets.example/styleRef-2.png');
  assert.equal(request.signal, signal);
  assert.equal(request.onJobCreated, onJobCreated);
  assert.deepEqual(request.taskMetadata, {
    shellPurpose: 'model_replace_regeneration',
    shellProjectId: 'model-project',
    shellProjectName: '模特替换项目',
    shellResultId: 'retry-result',
    shellPlanId: undefined,
    subFeature: 'model_replace',
    sourceFileName: 'reference.png',
    batchIndex: 1,
    batchCount: 1,
    referenceIndex: 1,
    referenceCount: 1,
    sourceBatchIndex: 7,
    replacementScope: 'full_person',
    identityImageCount: 4,
  });
  request.params.replacementScope = 'mutated';
  request.materials.model[0].fileName = 'mutated.png';
  assert.deepEqual(retryContext, before);
});

const siblingSuccess = {
  id: 'sibling-success',
  imageUrl: 'https://results.example/sibling.png',
  prompt: 'sibling prompt',
  model: 'gpt-image-2',
  aspectRatio: '1:1',
  status: 'completed',
  createdAt: 1,
  module: 'everything_replace',
  subFeature: 'model_replace',
  taskId: 'sibling-task',
  backendJobId: 'sibling-job',
  creditsConsumed: 2,
  sourceUrl: 'https://assets.example/sibling-reference.png',
};

const failedSource = {
  id: 'failed-source',
  imageUrl: '',
  prompt: 'failed prompt',
  model: 'gpt-image-2',
  aspectRatio: '4:5',
  status: 'error',
  createdAt: 2,
  module: 'everything_replace',
  subFeature: 'model_replace',
  taskId: 'old-failed-task',
  backendJobId: 'old-failed-job',
  sourceUrl: 'https://assets.example/failed-reference.png',
  fileName: 'failed-reference.png',
  error: 'original failure',
};

const baseProject = () => ({
  id: 'model-project',
  name: '模特替换项目',
  module: 'everything_replace',
  subFeature: 'model_replace',
  status: 'error',
  createdAt: 1,
  taskCount: 2,
  completedCount: 1,
  results: [structuredClone(siblingSuccess), structuredClone(failedSource)],
});

const appendPendingRetry = () => reduceModelReplaceRetryProject({
  project: baseProject(),
  sourceResult: failedSource,
  retryResultId: 'retry-result',
  outcome: { status: 'generating', prompt: 'stored retry prompt' },
});

test('model retry reducer appends pending and provider identity without losing siblings', () => {
  const pendingProject = appendPendingRetry();
  assert.deepEqual(pendingProject.results.slice(0, 2), [siblingSuccess, failedSource]);
  assert.equal(pendingProject.results.length, 3);
  assert.equal(pendingProject.status, 'generating');
  assert.equal(pendingProject.completedCount, 1);
  assert.equal(pendingProject.taskCount, 3);

  const providerProject = reduceModelReplaceRetryProject({
    project: pendingProject,
    sourceResult: failedSource,
    retryResultId: 'retry-result',
    outcome: {
      status: 'generating',
      prompt: 'stored retry prompt',
      taskId: 'new-provider-task',
      backendJobId: 'new-backend-job',
      message: 'waiting for provider',
    },
  });
  const retry = providerProject.results.find((item) => item.id === 'retry-result');
  assert.equal(providerProject.results.length, 3);
  assert.equal(retry.taskId, 'new-provider-task');
  assert.equal(retry.backendJobId, 'new-backend-job');
  assert.equal(retry.status, 'generating');
  assert.equal(retry.error, 'waiting for provider');
});

test('model retry reducer replaces only pending on success and uses new generation identities', () => {
  const completedProject = reduceModelReplaceRetryProject({
    project: appendPendingRetry(),
    sourceResult: failedSource,
    retryResultId: 'retry-result',
    outcome: {
      status: 'completed',
      imageUrl: 'https://results.example/retry.png',
      prompt: 'generated prompt',
      taskId: 'new-provider-task',
      backendJobId: 'new-backend-job',
      creditsConsumed: 7,
    },
  });
  const retry = completedProject.results.find((item) => item.id === 'retry-result');

  assert.deepEqual(completedProject.results.slice(0, 2), [siblingSuccess, failedSource]);
  assert.equal(completedProject.results.length, 3);
  assert.equal(retry.status, 'completed');
  assert.equal(retry.imageUrl, 'https://results.example/retry.png');
  assert.equal(retry.sourceUrl, failedSource.sourceUrl);
  assert.equal(retry.taskId, 'new-provider-task');
  assert.equal(retry.backendJobId, 'new-backend-job');
  assert.notEqual(retry.taskId, failedSource.taskId);
  assert.notEqual(retry.backendJobId, failedSource.backendJobId);
  assert.equal(retry.creditsConsumed, 7);
  assert.equal(completedProject.completedCount, 2);
  assert.equal(completedProject.taskCount, 3);
  assert.equal(completedProject.status, 'error');
});

test('model retry reducer replaces pending with visible terminal failure and clears stale generating', () => {
  const failedProject = reduceModelReplaceRetryProject({
    project: appendPendingRetry(),
    sourceResult: failedSource,
    retryResultId: 'retry-result',
    outcome: {
      status: 'error',
      taskId: 'new-provider-task',
      backendJobId: 'new-backend-job',
      message: 'retry provider failed',
      errorCode: 'provider_failed',
    },
  });
  const retry = failedProject.results.find((item) => item.id === 'retry-result');

  assert.deepEqual(failedProject.results.slice(0, 2), [siblingSuccess, failedSource]);
  assert.equal(failedProject.results.length, 3);
  assert.equal(failedProject.results.some((item) => item.status === 'generating'), false);
  assert.equal(retry.status, 'error');
  assert.equal(retry.error, 'retry provider failed');
  assert.equal(retry.message, 'retry provider failed');
  assert.equal(retry.errorCode, 'provider_failed');
  assert.equal(retry.taskId, 'new-provider-task');
  assert.equal(retry.backendJobId, 'new-backend-job');
  assert.equal(failedProject.completedCount, 1);
  assert.equal(failedProject.taskCount, 3);
  assert.equal(failedProject.status, 'error');
});

test('model retry lifecycle persists pending before one direct workflow call and then persists success', async () => {
  const events = [];
  const persisted = [];
  let workflowRequest;
  const result = await runModelReplaceRetryLifecycle({
    project: baseProject(),
    sourceResult: failedSource,
    retryResultId: 'retry-result',
    retryContext: {
      prompt: 'stored retry prompt',
      params: { mode: 'model_replace', replacementScope: 'identity_only' },
      materials: {
        model: [material('model', 1), material('model', 2)],
        styleRef: [material('styleRef', 1, {
          url: failedSource.sourceUrl,
          remoteUrl: failedSource.sourceUrl,
        })],
      },
    },
    signal: new AbortController().signal,
    publicBaseUrl: 'https://meiao.local',
    runWorkflow: async (request) => {
      events.push('workflow');
      workflowRequest = request;
      request.onJobCreated('new-backend-job', 'new-provider-task');
      return { results: [{
        status: 'completed',
        imageUrl: 'https://results.example/retry.png',
        prompt: 'generated prompt',
        taskId: 'new-provider-task',
        backendJobId: 'new-backend-job',
        creditsConsumed: 5,
      }] };
    },
    onProject: (project, phase) => events.push(`project:${phase}:${project.status}`),
    persistProject: async (project, phase) => {
      events.push(`persist:${phase}:${project.status}`);
      persisted.push(structuredClone(project));
    },
    onJobCreated: (jobId, taskId) => events.push(`job:${jobId}:${taskId}`),
  });

  assert.equal(events.indexOf('persist:pending:generating') < events.indexOf('workflow'), true);
  assert.deepEqual(events.filter((item) => item === 'workflow'), ['workflow']);
  assert.equal(events.includes('job:new-backend-job:new-provider-task'), true);
  assert.equal(persisted.length, 2);
  assert.equal(result.kind, 'completed');
  assert.equal(result.project.results.length, 3);
  assert.deepEqual(result.project.results.slice(0, 2), [siblingSuccess, failedSource]);
  const retry = result.project.results.find((item) => item.id === 'retry-result');
  assert.equal(retry.status, 'completed');
  assert.equal(retry.taskId, 'new-provider-task');
  assert.equal(retry.backendJobId, 'new-backend-job');
  assert.equal(retry.imageUrl, 'https://results.example/retry.png');
  assert.equal(workflowRequest.taskMetadata.batchCount, 1);
  assert.equal(workflowRequest.taskMetadata.referenceCount, 1);
});

test('model retry lifecycle persists visible failure after a direct workflow throw', async () => {
  const events = [];
  const persisted = [];
  let calls = 0;
  const result = await runModelReplaceRetryLifecycle({
    project: baseProject(),
    sourceResult: failedSource,
    retryResultId: 'retry-result',
    retryContext: {
      prompt: 'stored retry prompt',
      params: { mode: 'model_replace', replacementScope: 'full_person' },
      materials: {
        model: [material('model', 1)],
        styleRef: [material('styleRef', 1, {
          url: failedSource.sourceUrl,
          remoteUrl: failedSource.sourceUrl,
        })],
      },
    },
    signal: new AbortController().signal,
    publicBaseUrl: '',
    runWorkflow: async (request) => {
      calls += 1;
      events.push('workflow');
      request.onJobCreated('throw-backend-job', 'throw-provider-task');
      const error = new Error('workflow exploded');
      error.code = 'provider_exploded';
      throw error;
    },
    onProject: (project, phase) => events.push(`project:${phase}:${project.status}`),
    persistProject: async (project, phase) => {
      events.push(`persist:${phase}:${project.status}`);
      persisted.push(structuredClone(project));
    },
    onJobCreated: () => undefined,
  });

  assert.equal(events.indexOf('persist:pending:generating') < events.indexOf('workflow'), true);
  assert.equal(calls, 1);
  assert.equal(persisted.length, 2);
  assert.equal(result.kind, 'error');
  assert.equal(result.project.results.length, 3);
  assert.deepEqual(result.project.results.slice(0, 2), [siblingSuccess, failedSource]);
  assert.equal(result.project.results.some((item) => item.status === 'generating'), false);
  const retry = result.project.results.find((item) => item.id === 'retry-result');
  assert.equal(retry.status, 'error');
  assert.equal(retry.error, 'workflow exploded');
  assert.equal(retry.errorCode, 'provider_exploded');
  assert.equal(retry.taskId, 'throw-provider-task');
  assert.equal(retry.backendJobId, 'throw-backend-job');
  assert.deepEqual(events, [
    'project:pending:generating',
    'persist:pending:generating',
    'workflow',
    'project:identity:generating',
    'project:error:error',
    'persist:error:error',
  ]);
});

test('model retry lifecycle rolls visible pending state back when pending persistence fails', async () => {
  const original = baseProject();
  const events = [];
  let workflowCalls = 0;
  const persistenceError = new Error('pending persistence failed');

  const lifecycle = await runModelReplaceRetryLifecycle({
    project: original,
    sourceResult: failedSource,
    retryResultId: 'retry-result',
    retryContext: { prompt: 'retry', params: {}, materials: {} },
    runWorkflow: async () => {
      workflowCalls += 1;
      return { results: [] };
    },
    onProject: (project, phase) => events.push(`project:${phase}:${project === original ? 'original' : project.status}`),
    persistProject: async (_project, phase) => {
      events.push(`persist:${phase}`);
      throw persistenceError;
    },
  });

  assert.deepEqual(events, [
    'project:pending:generating',
    'persist:pending',
    'project:rollback:original',
    'persist:rollback',
  ]);
  assert.equal(workflowCalls, 0);
  assert.equal(lifecycle.kind, 'pending_persistence_error');
  assert.equal(lifecycle.project, original);
  assert.equal(lifecycle.persistenceError, persistenceError);
  assert.equal(lifecycle.rollbackPersistenceError, persistenceError);
  assert.deepEqual(original.results, [siblingSuccess, failedSource]);
});

test('model retry lifecycle treats a false pending persistence result as failure and rolls back', async () => {
  const original = baseProject();
  const events = [];
  let workflowCalls = 0;
  let locallyPersistedProject;
  const lifecycle = await runModelReplaceRetryLifecycle({
    project: original,
    sourceResult: failedSource,
    retryResultId: 'retry-result',
    retryContext: { prompt: 'retry', params: {}, materials: {} },
    runWorkflow: async () => {
      workflowCalls += 1;
      return { results: [] };
    },
    onProject: (project, phase) => events.push(`project:${phase}:${project === original ? 'original' : project.status}`),
    persistProject: async (nextProject, phase) => {
      events.push(`persist:${phase}`);
      locallyPersistedProject = nextProject;
      return phase === 'pending' ? false : true;
    },
  });

  assert.equal(lifecycle.kind, 'pending_persistence_error');
  assert.ok(lifecycle.persistenceError instanceof Error);
  assert.equal(lifecycle.rollbackPersistenceError, undefined);
  assert.equal(workflowCalls, 0);
  assert.equal(locallyPersistedProject, original);
  assert.deepEqual(events, [
    'project:pending:generating',
    'persist:pending',
    'project:rollback:original',
    'persist:rollback',
  ]);
});

test('model retry lifecycle keeps provider success visible when terminal persistence fails', async () => {
  const events = [];
  const persistenceError = new Error('terminal persistence failed');
  const lifecycle = await runModelReplaceRetryLifecycle({
    project: baseProject(),
    sourceResult: failedSource,
    retryResultId: 'retry-result',
    retryContext: { prompt: 'retry', params: {}, materials: {} },
    runWorkflow: async () => ({ results: [{
      status: 'completed',
      imageUrl: 'https://results.example/success.png',
      taskId: 'provider-success',
    }] }),
    onProject: (project, phase) => events.push(`project:${phase}:${project.status}`),
    persistProject: async (_project, phase) => {
      events.push(`persist:${phase}`);
      if (phase === 'completed') throw persistenceError;
    },
  });

  assert.deepEqual(events, [
    'project:pending:generating',
    'persist:pending',
    'project:completed:error',
    'persist:completed',
  ]);
  assert.equal(lifecycle.kind, 'completed');
  assert.equal(lifecycle.persistenceError, persistenceError);
  assert.equal(lifecycle.result.status, 'completed');
  assert.equal(lifecycle.result.imageUrl, 'https://results.example/success.png');
  assert.equal(lifecycle.project.results.some((item) => item.id === 'retry-result' && item.status === 'error'), false);
});

test('model retry lifecycle preserves provider success when terminal persistence resolves false', async () => {
  const events = [];
  const lifecycle = await runModelReplaceRetryLifecycle({
    project: baseProject(),
    sourceResult: failedSource,
    retryResultId: 'retry-result',
    retryContext: { prompt: 'retry', params: {}, materials: {} },
    runWorkflow: async () => ({ results: [{
      status: 'completed',
      imageUrl: 'https://results.example/success.png',
    }] }),
    onProject: (_project, phase) => events.push(`project:${phase}`),
    persistProject: async (_project, phase) => {
      events.push(`persist:${phase}`);
      return phase === 'completed' ? false : true;
    },
  });

  assert.equal(lifecycle.kind, 'completed');
  assert.ok(lifecycle.persistenceError instanceof Error);
  assert.equal(lifecycle.result.status, 'completed');
  assert.equal(lifecycle.result.imageUrl, 'https://results.example/success.png');
  assert.deepEqual(events, ['project:pending', 'persist:pending', 'project:completed', 'persist:completed']);
});

test('model retry lifecycle short-circuits before pending state when already cancelled', async () => {
  const events = [];
  const lifecycle = await runModelReplaceRetryLifecycle({
    project: baseProject(),
    sourceResult: failedSource,
    retryResultId: 'retry-result',
    retryContext: { prompt: 'retry', params: {}, materials: {} },
    isCancelled: () => true,
    runWorkflow: async () => events.push('workflow'),
    onProject: () => events.push('project'),
    persistProject: async () => events.push('persist'),
  });

  assert.equal(lifecycle.kind, 'interrupted');
  assert.equal(lifecycle.project.results.length, 2);
  assert.deepEqual(events, []);
});

test('model retry result ordering matches hydrated source batch ordering', () => {
  assert.equal(typeof modelReplaceRetry.orderModelReplaceRetryResults, 'function');
  const sourceOne = { ...failedSource, id: 'source-1', batchIndex: 1, createdAt: 10 };
  const sourceTwo = { ...siblingSuccess, id: 'source-2', batchIndex: 2, createdAt: 20 };
  const project = { ...baseProject(), results: [sourceOne, sourceTwo] };
  const immediate = reduceModelReplaceRetryProject({
    project,
    sourceResult: sourceOne,
    retryResultId: 'retry-source-1',
    outcome: { status: 'generating', prompt: 'retry' },
  });
  const hydrated = modelReplaceRetry.orderModelReplaceRetryResults([
    sourceTwo,
    { ...immediate.results.find((item) => item.id === 'retry-source-1'), createdAt: 30 },
    sourceOne,
  ]);

  assert.deepEqual(immediate.results.map((item) => item.id), ['source-1', 'retry-source-1', 'source-2']);
  assert.deepEqual(hydrated.map((item) => item.id), immediate.results.map((item) => item.id));
});

test('model retry lifecycle yields cancellation ownership after abort during workflow', async () => {
  const controller = new AbortController();
  const events = [];
  const lifecycle = await runModelReplaceRetryLifecycle({
    project: baseProject(),
    sourceResult: failedSource,
    retryResultId: 'retry-result',
    retryContext: { prompt: 'retry', params: {}, materials: {} },
    signal: controller.signal,
    runWorkflow: async () => {
      controller.abort();
      return { results: [{ status: 'completed', imageUrl: 'https://results.example/late.png' }] };
    },
    onProject: (_project, phase) => events.push(`project:${phase}`),
    persistProject: async (_project, phase) => events.push(`persist:${phase}`),
  });

  assert.equal(lifecycle.kind, 'interrupted');
  assert.deepEqual(events, ['project:pending', 'persist:pending']);
  assert.equal(lifecycle.project.results.find((item) => item.id === 'retry-result').status, 'generating');
});

test('model retry lifecycle does not terminal-persist a returned INTERRUPTED item', async () => {
  const events = [];
  const lifecycle = await runModelReplaceRetryLifecycle({
    project: baseProject(),
    sourceResult: failedSource,
    retryResultId: 'retry-result',
    retryContext: { prompt: 'retry', params: {}, materials: {} },
    runWorkflow: async () => ({ results: [{ status: 'error', errorCode: 'INTERRUPTED' }] }),
    onProject: (_project, phase) => events.push(`project:${phase}`),
    persistProject: async (_project, phase) => events.push(`persist:${phase}`),
  });

  assert.equal(lifecycle.kind, 'interrupted');
  assert.deepEqual(events, ['project:pending', 'persist:pending']);
});

test('model replacement project card labels and retries results without enabling result editing', () => {
  assert.match(projectCardSource, /model_replace: '模特替换'/);
  assert.match(projectCardSource, /const getModelReplaceIdentityLabel/);
  assert.match(projectCardSource, /公共模特/);
  assert.doesNotMatch(projectCardSource.match(/const getModelReplaceIdentityLabel[\s\S]*?^};/m)?.[0] || '', /resolverUrl|assets|identityProfile/);
  assert.match(projectCardSource, /onRegenerate\(project\.id, result\.id\)/);
  const editEligibility = projectCardSource.match(/const canEditImageResult = [\s\S]*?^  };/m)?.[0] || '';
  assert.ok(editEligibility, 'missing image edit eligibility block');
  assert.doesNotMatch(editEligibility, /model_replace/);
});

test('real model retry handler routes through the executable lifecycle without semantic preflight', () => {
  const retryHandler = shellAppSource.match(
    /const handleRegenerateResult = useCallback\([\s\S]*?^  }, \[[^\n]+\]\);/m,
  )?.[0] || '';
  assert.ok(retryHandler, 'missing regenerate handler');
  assert.match(shellAppSource, /from '.\/utils\/modelReplaceRetry\.mjs'/);
  assert.match(retryHandler, /buildModelReplaceRetryContext\(/);
  assert.match(retryHandler, /runModelReplaceRetryLifecycle\(/);
  assert.match(retryHandler, /createRuntimeId\('result-regenerated-'\)/);
  assert.doesNotMatch(retryHandler, /crypto\.randomUUID\(\)/);
  assert.match(retryHandler, /lifecycle\.kind === 'interrupted'/);
  assert.match(retryHandler, /lifecycle\.kind === 'pending_persistence_error'/);
  assert.match(retryHandler, /ensureMaterialRemoteUrls\(retryMaterials, project\.module, controller\.signal\)/);
  assert.match(retryHandler, /const preparedMaterials = await ensureMaterialRemoteUrls[\s\S]*?if \(controller\.signal\.aborted\) return;[\s\S]*?runModelReplaceRetryLifecycle\(/);
  assert.match(retryHandler, /project\.sourceType === 'job' && !isModelReplaceRegeneration/);
  assert.doesNotMatch(retryHandler, /preflightShellModelReplace|runModelReplacePreflightGate/);
});
