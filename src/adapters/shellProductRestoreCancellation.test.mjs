import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createProductRestoreCancellationRegistry,
  markProductRestoreProjectCancelled,
  runProductRestoreFanout,
  shouldResumeProductRestoreProject,
} from './shellProductRestoreCancellation.mjs';
import { buildShellDataSnapshot } from './shellDataAdapter.ts';
import { upsertShellProjectIntoPersistedState } from './shellPersistence.ts';

const deferred = () => {
  let resolve;
  const promise = new Promise((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
};

test('cancelling a partially fanned-out product restore batch is terminal and never resumes missing targets', async () => {
  const cancelledJobIds = [];
  const auditEntries = [];
  const registry = createProductRestoreCancellationRegistry({
    cancelJob: async (jobId) => {
      cancelledJobIds.push(jobId);
    },
    onAudit: (entry) => {
      auditEntries.push(entry);
    },
  });
  const projectId = 'product-restore-project-1';
  const pendingStarted = deferred();
  const releaseLateIdentity = deferred();
  let cancelled = false;
  const startedTargetIds = [];

  const fanoutPromise = runProductRestoreFanout({
    items: ['target-completed', 'target-pending', 'target-not-created'],
    concurrency: 1,
    shouldStop: () => cancelled || registry.isCancelled(projectId),
    runItem: async (targetId) => {
      startedTargetIds.push(targetId);
      if (targetId === 'target-completed') {
        return {
          id: 'result-completed',
          targetMaterialId: targetId,
          batchIndex: 1,
          backendJobId: 'job-completed',
          imageUrl: '/completed.png',
          status: 'completed',
        };
      }

      registry.observeJob(projectId, 'job-pending');
      pendingStarted.resolve();
      await releaseLateIdentity.promise;
      registry.observeJob(projectId, 'job-late');
      registry.observeJob(projectId, 'job-late');
      return {
        id: 'result-pending',
        targetMaterialId: targetId,
        batchIndex: 2,
        backendJobId: 'job-pending',
        imageUrl: '',
        status: 'generating',
      };
    },
  });

  await pendingStarted.promise;
  const partialProject = {
    id: projectId,
    module: 'retouch',
    subFeature: 'product_restore',
    status: 'generating',
    backendJobId: 'analysis-job-1',
    generationContext: {
      prompt: '还原产品结构',
      params: { model: 'gpt-image-2', resolution: '2K' },
      materials: {
        restoreTarget: [
          { id: 'target-completed', type: 'restoreTarget', url: '/completed-source.png', fileName: 'completed.png' },
          { id: 'target-pending', type: 'restoreTarget', url: '/pending-source.png', fileName: 'pending.png' },
          { id: 'target-not-created', type: 'restoreTarget', url: '/missing-source.png', fileName: 'missing.png' },
        ],
        productReference: [
          { id: 'reference-1', type: 'productReference', url: '/reference.png', fileName: 'reference.png' },
        ],
      },
      productRestore: {
        version: 1,
        analysisJobId: 'analysis-job-1',
        analysisModel: 'analysis-model',
        analysisCreditsConsumed: 1,
        normalizedAnalysis: {
          summary: '保持产品一致',
          invariantFeatures: ['logo'],
          shapeAndStructure: ['shape'],
          proportionAndContour: ['ratio'],
          materialAndTexture: ['texture'],
          colorAndGloss: ['color'],
          logoLabelAndText: ['logo'],
          componentsAndCraft: ['craft'],
          targetSetIssues: [],
          nonProductPreservationRules: ['background'],
        },
        sharedRestorationPrompt: '保持产品一致',
        focusIds: ['shape_structure'],
        targetMaterialIds: ['target-completed', 'target-pending', 'target-not-created'],
        productReferenceMaterialIds: ['reference-1'],
        selectedImageModel: 'gpt-image-2',
        resolution: '2K',
        userRequirement: '还原产品结构',
        createdAt: 1784040000000,
      },
    },
    taskCount: 3,
    completedCount: 1,
    results: [{
      id: 'result-completed',
      targetMaterialId: 'target-completed',
      batchIndex: 1,
      backendJobId: 'job-completed',
      imageUrl: '/completed.png',
      status: 'completed',
    }, {
      id: 'result-pending',
      targetMaterialId: 'target-pending',
      batchIndex: 2,
      backendJobId: 'job-pending',
      imageUrl: '',
      status: 'generating',
    }],
  };

  registry.beginCancellation(projectId);
  cancelled = true;
  releaseLateIdentity.resolve();
  const fanoutResults = await fanoutPromise;
  await registry.waitForCancellations(projectId);

  assert.deepEqual(startedTargetIds, ['target-completed', 'target-pending']);
  assert.deepEqual(fanoutResults.map((result) => result.targetMaterialId), [
    'target-completed',
    'target-pending',
  ]);
  assert.equal(cancelledJobIds.filter((jobId) => jobId === 'job-pending').length, 1);
  assert.equal(cancelledJobIds.filter((jobId) => jobId === 'job-late').length, 1);

  const cancelledProject = markProductRestoreProjectCancelled(partialProject, '已手动中断', {
    cancelledAt: 1784040003000,
    jobIds: registry.getCancellationJobIds(projectId),
  });
  assert.equal(cancelledProject.status, 'error');
  assert.equal(cancelledProject.completedCount, 1);
  assert.equal(cancelledProject.results[0].status, 'completed');
  assert.equal(cancelledProject.results[0].imageUrl, '/completed.png');
  assert.equal(cancelledProject.results[0].backendJobId, 'job-completed');
  assert.equal(cancelledProject.results[1].status, 'error');
  assert.equal(cancelledProject.results[1].backendJobId, 'job-pending');
  assert.deepEqual(cancelledProject.generationContext.productRestoreCancellation, {
    version: 1,
    status: 'cancelled',
    reason: 'user_requested',
    cancelledAt: 1784040003000,
    jobIds: ['analysis-job-1', 'job-completed', 'job-late', 'job-pending'],
  });
  assert.equal(
    shouldResumeProductRestoreProject(cancelledProject, {
      cancelled: registry.isCancelled(projectId),
    }),
    false,
  );
  assert.equal(
    shouldResumeProductRestoreProject(cancelledProject, { cancelled: false }),
    false,
    'a refreshed cancelled project must remain terminal even after the in-memory tombstone is gone',
  );

  const persistedState = upsertShellProjectIntoPersistedState({
    shellProjects: [],
  }, structuredClone(cancelledProject));
  const hydratedSnapshot = buildShellDataSnapshot(persistedState, [{
    id: 'job-pending',
    module: 'retouch',
    taskType: 'kie_image',
    provider: 'kie',
    status: 'running',
    providerTaskId: 'provider-pending',
    payload: {
      taskPurpose: 'product_restore_generation',
      shellProjectId: projectId,
      shellProjectName: '产品还原项目',
      subFeature: 'product_restore',
      analysisJobId: 'analysis-job-1',
      targetMaterialId: 'target-pending',
      batchIndex: 2,
      batchCount: 3,
    },
    createdAt: 1784040001000,
    updatedAt: 1784040002000,
  }]);
  const hydratedProject = hydratedSnapshot.projects.find((project) => project.id === projectId);
  assert.equal(hydratedProject.status, 'error', 'hydration must not revive a durable cancellation');
  assert.equal(hydratedProject.completedCount, 1);
  assert.deepEqual(hydratedProject.results.map((result) => [
    result.targetMaterialId,
    result.status,
    result.backendJobId,
  ]), [
    ['target-completed', 'completed', 'job-completed'],
    ['target-pending', 'error', 'job-pending'],
  ]);
  assert.equal(hydratedProject.generationContext.productRestoreCancellation.status, 'cancelled');
  assert.equal(
    shouldResumeProductRestoreProject(hydratedProject, { cancelled: false }),
    false,
  );

  let recoveryCreateCount = 0;
  if (shouldResumeProductRestoreProject(hydratedProject, { cancelled: false })) {
    await runProductRestoreFanout({
      items: ['target-not-created'],
      concurrency: 1,
      shouldStop: () => registry.isCancelled(projectId),
      runItem: async () => {
        recoveryCreateCount += 1;
      },
    });
  }
  assert.equal(recoveryCreateCount, 0);

  const retryState = upsertShellProjectIntoPersistedState(persistedState, {
    ...cancelledProject,
    generationContext: {
      ...cancelledProject.generationContext,
      productRestoreCancellation: undefined,
    },
  });
  const serializedRetryState = JSON.parse(JSON.stringify(retryState));
  assert.equal(
    serializedRetryState.shellProjects[0].generationContext.productRestoreCancellation,
    undefined,
    'only an explicit persisted retry transition may clear the durable marker',
  );

  const finalAudit = auditEntries.at(-1);
  assert.deepEqual(finalAudit.jobIds, ['job-late', 'job-pending']);
  assert.equal(finalAudit.cancelledJobCount, 2);
});

test('cancelling normalizes media-bearing stale generating rows to completed', () => {
  const cancelledProject = markProductRestoreProjectCancelled({
    id: 'product-restore-stale-media',
    module: 'retouch',
    subFeature: 'product_restore',
    status: 'generating',
    taskCount: 2,
    completedCount: 0,
    generationContext: { prompt: '', params: {}, materials: {} },
    results: [{
      id: 'stale-success',
      status: 'generating',
      imageUrl: '/successful-image.png',
      backendJobId: 'job-success',
      taskId: 'provider-success',
      creditsConsumed: 6,
    }, {
      id: 'pending-result',
      status: 'generating',
      imageUrl: '',
      backendJobId: 'job-pending',
      creditsConsumed: 2,
    }],
  });

  assert.equal(cancelledProject.status, 'error');
  assert.equal(cancelledProject.completedCount, 1);
  assert.deepEqual(cancelledProject.results[0], {
    id: 'stale-success',
    status: 'completed',
    imageUrl: '/successful-image.png',
    backendJobId: 'job-success',
    taskId: 'provider-success',
    creditsConsumed: 6,
    error: undefined,
  });
  assert.equal(cancelledProject.results[1].status, 'error');
  assert.equal(cancelledProject.results[1].backendJobId, 'job-pending');
  assert.equal(cancelledProject.results[1].creditsConsumed, 2);
});
