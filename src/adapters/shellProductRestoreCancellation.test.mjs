import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createProductRestoreCancellationRegistry,
  markProductRestoreProjectCancelled,
  runProductRestoreFanout,
  shouldResumeProductRestoreProject,
} from './shellProductRestoreCancellation.mjs';

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
      productRestore: { analysisJobId: 'analysis-job-1' },
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

  const cancelledProject = markProductRestoreProjectCancelled(partialProject);
  assert.equal(cancelledProject.status, 'error');
  assert.equal(cancelledProject.completedCount, 1);
  assert.equal(cancelledProject.results[0].status, 'completed');
  assert.equal(cancelledProject.results[0].imageUrl, '/completed.png');
  assert.equal(cancelledProject.results[0].backendJobId, 'job-completed');
  assert.equal(cancelledProject.results[1].status, 'error');
  assert.equal(cancelledProject.results[1].backendJobId, 'job-pending');
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

  let recoveryCreateCount = 0;
  if (shouldResumeProductRestoreProject(cancelledProject, { cancelled: false })) {
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

  const finalAudit = auditEntries.at(-1);
  assert.deepEqual(finalAudit.jobIds, ['job-late', 'job-pending']);
  assert.equal(finalAudit.cancelledJobCount, 2);
});
