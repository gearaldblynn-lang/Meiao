import assert from 'node:assert/strict';
import test from 'node:test';

import {
  cloneProductRestoreCancellationMarker,
  cloneProductRestoreCancellationReset,
  createProductRestoreCancellationReset,
  createProductRestoreCancellationRegistry,
  hasDurableProductRestoreCancellation,
  markProductRestoreProjectCancelled,
  mergeProductRestoreGenerationContext,
  persistProductRestoreExplicitRetryReset,
  runProductRestoreFanout,
  shouldResumeProductRestoreProject,
} from './shellProductRestoreCancellation.mjs';
import { buildShellDataSnapshot } from './shellDataAdapter.ts';
import { upsertShellProjectIntoPersistedState } from './shellPersistence.ts';
import { getProductRestoreAnalysisCreditSummary } from '../utils/productRestoreAnalysisCredits.ts';
import { mergeAppStateForStorage } from '../../server/appStateMerge.mjs';

const deferred = () => {
  let resolve;
  const promise = new Promise((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
};

const hasOwn = (value, key) => Boolean(value) && Object.prototype.hasOwnProperty.call(value, key);

test('explicit attempt arrays merge additively onto a historical product restore charge', () => {
  const existingContext = {
    productRestore: {
      analysisJobId: 'legacy-analysis-1',
      analysisProviderTaskId: 'legacy-provider-1',
      analysisModel: 'legacy-vision-model',
      analysisCreditsConsumed: 4,
      createdAt: 123,
    },
  };

  const emptyMerge = mergeProductRestoreGenerationContext(existingContext, {
    productRestoreAnalysisAttempts: [],
  });
  assert.deepEqual(
    emptyMerge.productRestoreAnalysisAttempts.map((attempt) => attempt.jobId),
    ['legacy-analysis-1'],
  );
  assert.deepEqual(getProductRestoreAnalysisCreditSummary(emptyMerge), {
    present: true,
    value: 4,
  });

  const existingLedgerMerge = mergeProductRestoreGenerationContext({
    productRestoreAnalysisAttempts: [{
      jobId: 'ledger-analysis-1',
      status: 'succeeded',
      timestamp: 100,
      creditsConsumed: 3,
    }],
  }, {
    productRestoreAnalysisAttempts: [],
  });
  assert.deepEqual(existingLedgerMerge.productRestoreAnalysisAttempts, [{
    jobId: 'ledger-analysis-1',
    status: 'succeeded',
    timestamp: 100,
    creditsConsumed: 3,
  }]);

  const emptyWithoutHistory = mergeProductRestoreGenerationContext(undefined, {
    productRestoreAnalysisAttempts: [],
  });
  assert.equal(Object.hasOwn(emptyWithoutHistory, 'productRestoreAnalysisAttempts'), false);

  const additiveMerge = mergeProductRestoreGenerationContext(existingContext, {
    productRestoreAnalysisAttempts: [{
      jobId: 'new-analysis-2',
      status: 'succeeded',
      timestamp: 456,
      creditsConsumed: 2,
    }],
  });
  assert.deepEqual(
    additiveMerge.productRestoreAnalysisAttempts.map((attempt) => attempt.jobId),
    ['legacy-analysis-1', 'new-analysis-2'],
  );
  assert.equal(
    additiveMerge.productRestoreAnalysisAttempts.filter(
      (attempt) => attempt.jobId === 'legacy-analysis-1',
    ).length,
    1,
  );
  assert.deepEqual(getProductRestoreAnalysisCreditSummary(additiveMerge), {
    present: true,
    value: 6,
  });
});

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
    causalEpoch: 'product_restore_cancelled:1784040003000',
    causalGeneration: '0',
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

  const serverMergedState = mergeAppStateForStorage(persistedState, {
    shellProjects: [{
      ...partialProject,
      status: 'generating',
      generationContext: {
        ...partialProject.generationContext,
      },
    }],
  });
  const serverMergedProject = buildShellDataSnapshot(serverMergedState, []).projects
    .find((project) => project.id === projectId);
  assert.equal(serverMergedProject.status, 'error');
  assert.equal(serverMergedProject.generationContext.productRestoreCancellation.status, 'cancelled');
  assert.equal(shouldResumeProductRestoreProject(serverMergedProject, { cancelled: false }), false);
  let serverRecoveryCreateCount = 0;
  if (shouldResumeProductRestoreProject(serverMergedProject, { cancelled: false })) {
    serverRecoveryCreateCount += 1;
  }
  assert.equal(serverRecoveryCreateCount, 0);

  const retryReset = createProductRestoreCancellationReset(
    cancelledProject.generationContext,
    1784040003001,
  );
  const retryState = upsertShellProjectIntoPersistedState(persistedState, {
    ...cancelledProject,
    status: 'generating',
    generationContext: {
      ...cancelledProject.generationContext,
      productRestoreCancellationReset: retryReset,
    },
  });
  const serializedRetryState = JSON.parse(JSON.stringify(retryState));
  const serializedRetryProject = serializedRetryState.shellProjects[0];
  assert.deepEqual(
    serializedRetryProject.generationContext.productRestoreCancellationReset,
    retryReset,
  );
  assert.ok(retryReset.eventId);
  assert.equal(retryReset.supersedesEventId, 'product_restore_cancelled:1784040003000');
  assert.equal(hasOwn(serializedRetryProject.generationContext, 'productRestoreCancellation'), true);
  assert.equal(
    shouldResumeProductRestoreProject(serializedRetryProject, { cancelled: false }),
    true,
    'a serialized explicit retry reset must supersede the older cancellation marker',
  );
  const hydratedRetryProject = buildShellDataSnapshot(serializedRetryState, []).projects
    .find((project) => project.id === projectId);
  assert.deepEqual(hydratedRetryProject.generationContext.productRestoreCancellationReset, retryReset);
  assert.equal(shouldResumeProductRestoreProject(hydratedRetryProject, { cancelled: false }), true);

  const staleMergedContext = mergeProductRestoreGenerationContext(
    serializedRetryProject.generationContext,
    cancelledProject.generationContext,
  );
  assert.deepEqual(staleMergedContext.productRestoreCancellationReset, retryReset);
  assert.equal(shouldResumeProductRestoreProject({
    ...serializedRetryProject,
    generationContext: staleMergedContext,
  }, { cancelled: false }), true);

  const cancelledAgain = markProductRestoreProjectCancelled({
    ...serializedRetryProject,
    generationContext: staleMergedContext,
  }, '已再次中断', { cancelledAt: 1784040003002, jobIds: ['job-retry'] });
  assert.equal(cancelledAgain.generationContext.productRestoreCancellation.cancelledAt, 1784040003002);
  assert.equal(shouldResumeProductRestoreProject(cancelledAgain, { cancelled: false }), false);

  const finalAudit = auditEntries.at(-1);
  assert.deepEqual(finalAudit.jobIds, ['job-late', 'job-pending']);
  assert.equal(finalAudit.cancelledJobCount, 2);
});

test('manual and single-result retry persistence failures authorize zero new jobs', async () => {
  const cancelledProject = markProductRestoreProjectCancelled({
    id: 'product-restore-retry-persistence-failure',
    module: 'retouch',
    subFeature: 'product_restore',
    status: 'generating',
    backendJobId: 'analysis-job-1',
    taskCount: 1,
    completedCount: 0,
    generationContext: { prompt: '', params: {}, materials: {} },
    results: [],
  }, '已手动中断', { cancelledAt: 100 });

  for (const retryKind of ['manual', 'single']) {
    let createCount = 0;
    const transition = await persistProductRestoreExplicitRetryReset({
      project: cancelledProject,
      resetAt: 101,
      persist: async () => false,
    });
    if (transition.persisted) createCount += 1;
    assert.equal(createCount, 0, `${retryKind} retry must not create after reset persistence failure`);
    assert.equal(transition.project.generationContext.productRestoreCancellationReset.resetAt, 101);
  }
});

test('explicit retry requires the server canonical reset instead of boolean-only persistence', async () => {
  const localCancelled = markProductRestoreProjectCancelled({
    id: 'product-restore-authoritative-retry',
    module: 'retouch',
    subFeature: 'product_restore',
    status: 'generating',
    backendJobId: 'analysis-job-1',
    taskCount: 1,
    completedCount: 0,
    generationContext: { prompt: '', params: {}, materials: {} },
    results: [],
  }, '已手动中断', { cancelledAt: 100 });
  const serverCancelled = markProductRestoreProjectCancelled({
    ...localCancelled,
    status: 'generating',
    generationContext: { prompt: '', params: {}, materials: {} },
  }, '已再次中断', { cancelledAt: 1000 });

  for (const retryKind of ['manual', 'single']) {
    let controllerCreates = 0;
    let jobCreates = 0;
    let serverState = { shellProjects: [JSON.parse(JSON.stringify(serverCancelled))] };
    const transition = await persistProductRestoreExplicitRetryReset({
      project: localCancelled,
      resetAt: 200,
      persist: async (nextProject) => {
        serverState = mergeAppStateForStorage(
          serverState,
          { shellProjects: [JSON.parse(JSON.stringify(nextProject))] },
        );
        return true;
      },
    });
    if (transition.persisted) {
      controllerCreates += 1;
      jobCreates += 1;
    }
    assert.equal(hasDurableProductRestoreCancellation(serverState.shellProjects[0]), true);
    assert.equal(transition.persisted, false, `${retryKind} boolean-only success is not authorization`);
    assert.equal(controllerCreates, 0);
    assert.equal(jobCreates, 0);
  }

  let acceptedServerState = { shellProjects: [JSON.parse(JSON.stringify(localCancelled))] };
  const accepted = await persistProductRestoreExplicitRetryReset({
    project: localCancelled,
    resetAt: 200,
    persist: async (nextProject) => {
      acceptedServerState = mergeAppStateForStorage(
        acceptedServerState,
        { shellProjects: [JSON.parse(JSON.stringify(nextProject))] },
      );
      return {
        accepted: true,
        project: JSON.parse(JSON.stringify(acceptedServerState.shellProjects[0])),
      };
    },
  });
  assert.equal(accepted.persisted, true, 'the server canonical effective reset authorizes retry');
  assert.equal(hasDurableProductRestoreCancellation(accepted.project), false);
  assert.equal(
    accepted.project.generationContext.productRestoreCancellationReset.eventId,
    acceptedServerState.shellProjects[0].generationContext.productRestoreCancellationReset.eventId,
  );

  let rejectedServerState = { shellProjects: [JSON.parse(JSON.stringify(serverCancelled))] };
  const rejected = await persistProductRestoreExplicitRetryReset({
    project: localCancelled,
    resetAt: 200,
    persist: async (nextProject) => {
      rejectedServerState = mergeAppStateForStorage(
        rejectedServerState,
        { shellProjects: [JSON.parse(JSON.stringify(nextProject))] },
      );
      return {
        accepted: true,
        project: JSON.parse(JSON.stringify(rejectedServerState.shellProjects[0])),
      };
    },
  });
  assert.equal(rejected.persisted, false);
  assert.equal(hasDurableProductRestoreCancellation(rejected.project), true);
  assert.equal(rejected.project.generationContext.productRestoreCancellation.cancelledAt, 1000);
});

test('cancellation event ordering survives equality, clock rollback, unsafe numbers, and extreme future JSON', async () => {
  const future = Number.MAX_SAFE_INTEGER;
  const futureCancelled = markProductRestoreProjectCancelled({
    id: 'future-cancelled-project',
    module: 'retouch',
    subFeature: 'product_restore',
    status: 'generating',
    backendJobId: 'analysis-future',
    taskCount: 1,
    completedCount: 0,
    generationContext: { prompt: '', params: {}, materials: {} },
    results: [],
  }, '已手动中断', { cancelledAt: future });
  const futureMarker = cloneProductRestoreCancellationMarker(
    JSON.parse(JSON.stringify(futureCancelled.generationContext.productRestoreCancellation)),
  );
  assert.ok(futureMarker);
  assert.equal(Number.isSafeInteger(futureMarker.cancelledAt), true);

  const equalReset = createProductRestoreCancellationReset(
    futureCancelled.generationContext,
    futureMarker.cancelledAt,
  );
  assert.ok(cloneProductRestoreCancellationReset(JSON.parse(JSON.stringify(equalReset))));
  assert.equal(Number.isSafeInteger(equalReset.resetAt), true);
  const resetContext = {
    ...futureCancelled.generationContext,
    productRestoreCancellationReset: equalReset,
  };
  const resetProject = {
    ...futureCancelled,
    status: 'generating',
    generationContext: resetContext,
  };
  assert.equal(
    hasDurableProductRestoreCancellation(resetProject),
    false,
    'explicit causal reset must beat an equal/future cancellation time',
  );

  const cancelledAgain = markProductRestoreProjectCancelled({
    ...futureCancelled,
    status: 'generating',
    generationContext: resetContext,
  }, '已再次中断', { cancelledAt: 1 });
  assert.equal(Number.isSafeInteger(cancelledAgain.generationContext.productRestoreCancellation.cancelledAt), true);
  assert.equal(hasDurableProductRestoreCancellation(cancelledAgain), true);

  const resetMerged = mergeAppStateForStorage(
    { shellProjects: [JSON.parse(JSON.stringify(futureCancelled))] },
    { shellProjects: [JSON.parse(JSON.stringify(resetProject))] },
  ).shellProjects[0];
  assert.equal(hasDurableProductRestoreCancellation(resetMerged), false);
  const cancelledAgainMerged = mergeAppStateForStorage(
    { shellProjects: [resetMerged] },
    { shellProjects: [JSON.parse(JSON.stringify(cancelledAgain))] },
  ).shellProjects[0];
  assert.equal(hasDurableProductRestoreCancellation(cancelledAgainMerged), true);
  assert.equal(cancelledAgainMerged.status, 'error');

  const unsafeMarker = cloneProductRestoreCancellationMarker({
    version: 1,
    status: 'cancelled',
    reason: 'user_requested',
    cancelledAt: Number.MAX_SAFE_INTEGER + 1,
    jobIds: [],
  });
  const extremeMarker = cloneProductRestoreCancellationMarker({
    version: 1,
    status: 'cancelled',
    reason: 'user_requested',
    cancelledAt: Number.MAX_VALUE,
    jobIds: [],
  });
  assert.equal(unsafeMarker, undefined);
  assert.equal(extremeMarker, undefined);

  let persistedSnapshot;
  const rejectedTransition = await persistProductRestoreExplicitRetryReset({
    project: futureCancelled,
    resetAt: futureMarker.cancelledAt,
    persist: async (nextProject) => {
      persistedSnapshot = nextProject;
      nextProject.generationContext.productRestoreCancellationReset.supersedesEventId = 'wrong-event';
      return true;
    },
  });
  assert.ok(persistedSnapshot);
  assert.equal(rejectedTransition.persisted, false, 'a persisted but non-superseding reset must fail closed');
});

test('MAX_SAFE multi-retry causality survives compact stale server merge in both orders', () => {
  const originalCancellation = markProductRestoreProjectCancelled({
    id: 'product-restore-max-safe-causal-chain',
    module: 'retouch',
    subFeature: 'product_restore',
    status: 'generating',
    backendJobId: 'analysis-job-max-safe',
    taskCount: 1,
    completedCount: 0,
    generationContext: {
      prompt: '',
      params: {},
      materials: {
        restoreTarget: [{ id: 'target-max-safe', type: 'restoreTarget', url: '/target.png' }],
      },
      productRestore: {
        version: 1,
        analysisJobId: 'analysis-job-max-safe',
        analysisModel: 'analysis-model',
        normalizedAnalysis: {
          summary: '',
          invariantFeatures: [],
          shapeAndStructure: [],
          proportionAndContour: [],
          materialAndTexture: [],
          colorAndGloss: [],
          logoLabelAndText: [],
          componentsAndCraft: [],
          targetSetIssues: [],
          nonProductPreservationRules: [],
        },
        sharedRestorationPrompt: '',
        focusIds: [],
        targetMaterialIds: ['target-max-safe'],
        productReferenceMaterialIds: [],
        selectedImageModel: 'gpt-image-2',
        resolution: '2K',
        userRequirement: '',
        createdAt: 1,
      },
    },
    results: [],
  }, '已手动中断', { cancelledAt: Number.MAX_SAFE_INTEGER });
  const firstReset = createProductRestoreCancellationReset(
    originalCancellation.generationContext,
    Number.MAX_SAFE_INTEGER,
  );
  const firstRetry = {
    ...originalCancellation,
    status: 'generating',
    error: undefined,
    generationContext: {
      ...originalCancellation.generationContext,
      productRestoreCancellationReset: firstReset,
    },
  };
  const secondCancellation = markProductRestoreProjectCancelled(
    firstRetry,
    '已再次中断',
    { cancelledAt: 1, jobIds: ['image-job-second-cancel'] },
  );
  const secondReset = createProductRestoreCancellationReset(
    secondCancellation.generationContext,
    1,
  );
  const secondRetry = JSON.parse(JSON.stringify({
    ...secondCancellation,
    status: 'generating',
    error: undefined,
    errorCode: undefined,
    generationContext: {
      ...secondCancellation.generationContext,
      productRestoreCancellationReset: secondReset,
    },
  }));
  const staleOriginal = JSON.parse(JSON.stringify(originalCancellation));

  assert.ok(originalCancellation.generationContext.productRestoreCancellation.cancelledAt < Number.MAX_SAFE_INTEGER);
  assert.equal(originalCancellation.generationContext.productRestoreCancellation.causalGeneration, '0');
  assert.equal(firstReset.causalGeneration, '1');
  assert.equal(secondCancellation.generationContext.productRestoreCancellation.causalGeneration, '2');
  assert.equal(secondReset.causalGeneration, '3');
  assert.equal(
    secondReset.causalEpoch,
    originalCancellation.generationContext.productRestoreCancellation.causalEpoch,
  );
  assert.equal(hasDurableProductRestoreCancellation(secondRetry), false);
  for (const [existing, incoming] of [
    [secondRetry, staleOriginal],
    [staleOriginal, secondRetry],
  ]) {
    const mergedState = JSON.parse(JSON.stringify(mergeAppStateForStorage(
      { shellProjects: [existing] },
      { shellProjects: [incoming] },
    )));
    const mergedProject = mergedState.shellProjects[0];
    assert.equal(
      hasDurableProductRestoreCancellation(mergedProject),
      false,
      'a compact stale root cancellation must not re-lock the newer second retry',
    );
    assert.equal(mergedProject.status, 'generating');
    const hydratedProject = buildShellDataSnapshot(mergedState, []).projects
      .find((project) => project.id === mergedProject.id);
    assert.ok(hydratedProject);
    assert.equal(hasDurableProductRestoreCancellation(hydratedProject), false);
    assert.equal(
      shouldResumeProductRestoreProject(hydratedProject, { cancelled: false }),
      true,
    );
  }
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
