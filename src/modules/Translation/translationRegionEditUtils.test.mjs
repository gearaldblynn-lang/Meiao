import test from 'node:test';
import assert from 'node:assert/strict';

import * as translationRegionEditUtils from './translationRegionEditUtils.mjs';

const {
  MAX_TRANSLATION_EDIT_REGIONS,
  MAX_TRANSLATION_EDIT_INSTRUCTION_LENGTH,
  MAX_TRANSLATION_EDIT_TOTAL_INSTRUCTION_LENGTH,
  MIN_TRANSLATION_EDIT_REGION_RATIO,
  clipTranslationEditRegionsToImageBounds,
  normalizeTranslationEditRegions,
  validateTranslationEditRegions,
  ensureTranslationEditVersions,
  getCompletedTranslationEditVersions,
  getVisibleTranslationEditVersions,
  startTranslationEditVersion,
  completeTranslationEditVersion,
  failTranslationEditVersion,
  mergeTranslationEditVersions,
  getLatestCompletedTranslationEditVersionUrl,
  translationEditFileToResultFields,
  translationEditResultToFileFields,
  reduceTranslationRegionEditProjectMutation,
  isOwnedGeneratingTranslationEditVersion,
  persistTranslationRegionEditTransition,
  buildTranslationRegionEditLogMeta,
  claimTranslationRegionEditLockOwner,
  releaseTranslationRegionEditLockOwner,
  persistTranslationRegionEditCancelTransition,
  getTranslationEditCreditsConsumed,
  settleLateTranslationRegionEditJobIdentity,
  listRecoverableTranslationRegionEdits,
  listUnrecoverableTranslationRegionEdits,
  runTranslationRegionEditProtectionRecovery,
  failUnrecoverableTranslationRegionEditProtection,
  runGuardedTranslationRegionEditPersistenceWrite,
  TRANSLATION_REGION_EDIT_PERSISTENCE_SKIPPED,
  runTranslationRegionEditRecoveryQueue,
  isSameTranslationRegionEditRecovery,
} = translationRegionEditUtils;

test('translation edit version merge helpers are exported', () => {
  assert.equal(typeof mergeTranslationEditVersions, 'function');
  assert.equal(typeof getLatestCompletedTranslationEditVersionUrl, 'function');
  assert.equal(typeof translationEditFileToResultFields, 'function');
  assert.equal(typeof translationEditResultToFileFields, 'function');
});

const createRecoveryProject = (overrides = {}) => ({
  id: 'project-1',
  module: 'translation',
  subFeature: 'main',
  status: 'completed',
  results: [{
    id: 'result-1',
    module: 'translation',
    subFeature: 'main',
    status: 'completed',
    imageUrl: '/assets/result-v1.png',
    translationEditVersions: [{
      id: 'version-1',
      imageUrl: '/assets/source-v1.png',
      createdAt: 100,
      status: 'completed',
      regions: [],
    }, {
      id: 'version-2',
      sourceVersionId: 'version-1',
      createdAt: 200,
      status: 'generating',
      regions: [{
        id: 'region-1', index: 1, xRatio: 0.1, yRatio: 0.1,
        widthRatio: 0.2, heightRatio: 0.2, instruction: 'Replace copy',
      }],
      backendJobId: 'backend-2',
      taskId: 'provider-2',
      creditsConsumed: 3.5,
      pendingProtectedSourceUrl: 'https://provider.example/raw-v2.png',
    }],
  }],
  ...overrides,
});

test('recoverable translation edit scan filters invalid states and deduplicates stable identity keys', () => {
  const valid = createRecoveryProject();
  const duplicate = structuredClone(valid);
  const removeText = createRecoveryProject({ id: 'remove', subFeature: 'remove_text' });
  const resultError = createRecoveryProject({
    id: 'result-error',
    results: [{ ...structuredClone(valid.results[0]), status: 'error' }],
  });
  const completedVersion = structuredClone(createRecoveryProject());
  completedVersion.id = 'completed-version';
  completedVersion.results[0].translationEditVersions[1].status = 'completed';
  const noRaw = structuredClone(createRecoveryProject());
  noRaw.id = 'no-raw';
  delete noRaw.results[0].translationEditVersions[1].pendingProtectedSourceUrl;
  const noSource = structuredClone(createRecoveryProject());
  noSource.id = 'no-source';
  noSource.results[0].translationEditVersions[1].sourceVersionId = 'missing';
  const invalid = structuredClone(createRecoveryProject());
  invalid.id = 'invalid';
  invalid.results[0].translationEditVersions[1].regions[0].instruction = '   ';

  const items = listRecoverableTranslationRegionEdits([
    valid, duplicate, removeText, resultError, completedVersion, noRaw, noSource, invalid,
  ]);

  assert.equal(items.length, 1);
  assert.deepEqual(items[0], {
    key: 'project-1:result-1:version-2',
    projectId: 'project-1', resultId: 'result-1', versionId: 'version-2',
    sourceVersionId: 'version-1', subFeature: 'main',
    sourceImageUrl: '/assets/source-v1.png',
    pendingProtectedSourceUrl: 'https://provider.example/raw-v2.png',
    latestResultImageUrl: '/assets/source-v1.png',
    latestCompletedVersionId: 'version-1',
    regions: valid.results[0].translationEditVersions[1].regions,
    backendJobId: 'backend-2', taskId: 'provider-2', creditsConsumed: 3.5,
  });
  assert.deepEqual(
    listUnrecoverableTranslationRegionEdits([invalid]).map(({ key, errorCode }) => ({ key, errorCode })),
    [{ key: 'invalid:result-1:version-2', errorCode: 'missing_instruction' }],
  );
});

test('pending raw output without a source version id is classified as unrecoverable', () => {
  const missingSourceIdentity = createRecoveryProject();
  delete missingSourceIdentity.results[0].translationEditVersions[1].sourceVersionId;

  assert.deepEqual(listRecoverableTranslationRegionEdits([missingSourceIdentity]), []);
  assert.deepEqual(
    listUnrecoverableTranslationRegionEdits([missingSourceIdentity])
      .map(({ key, sourceVersionId, errorCode }) => ({ key, sourceVersionId, errorCode })),
    [{
      key: 'project-1:result-1:version-2',
      sourceVersionId: '',
      errorCode: 'missing_source_version',
    }],
  );
});

test('recovery candidate normalizes absent job identity and credits to undefined', () => {
  const project = createRecoveryProject();
  const pending = project.results[0].translationEditVersions[1];
  pending.backendJobId = null;
  pending.taskId = undefined;
  pending.creditsConsumed = null;

  const item = listRecoverableTranslationRegionEdits([project])[0];

  assert.equal(item.backendJobId, undefined);
  assert.equal(item.taskId, undefined);
  assert.equal(item.creditsConsumed, undefined);
});

test('recovery candidate includes canvas dimensions and identity comparison detects mismatch', () => {
  const project = createRecoveryProject();
  const pending = project.results[0].translationEditVersions[1];
  pending.canvasWidth = 1200;
  pending.canvasHeight = 1600;

  const item = listRecoverableTranslationRegionEdits([project])[0];

  assert.equal(item.canvasWidth, 1200);
  assert.equal(item.canvasHeight, 1600);
  assert.equal(isSameTranslationRegionEditRecovery(item, item), true);
  assert.equal(isSameTranslationRegionEditRecovery(
    { ...item, canvasWidth: 1000 },
    item,
  ), false);
  assert.equal(isSameTranslationRegionEditRecovery(
    { ...item, canvasHeight: undefined },
    item,
  ), false);
});

const createRecoveryHarness = (overrides = {}) => {
  let projects = [createRecoveryProject()];
  const calls = { composite: 0, upload: 0, persistProject: 0, persistFiles: 0, commit: 0, success: 0, failure: 0 };
  let releaseComposite;
  const compositeGate = new Promise((resolve) => { releaseComposite = resolve; });
  const deps = {
    locks: new Set(),
    getProjects: () => projects,
    isScopeCurrent: () => true,
    composite: async (input) => {
      calls.composite += 1;
      if (overrides.waitForComposite) await compositeGate;
      return { blob: new Blob(['protected']), input };
    },
    upload: async ({ blob, fileName }) => {
      calls.upload += 1;
      assert.equal(await blob.text(), 'protected');
      assert.equal(fileName, 'translation-edit-recovered-version.png');
      return { fileUrl: '/api/assets/file/recovered-v2.png' };
    },
    persistProject: async () => { calls.persistProject += 1; return true; },
    persistFiles: async () => { calls.persistFiles += 1; return true; },
    commit: (mutation) => {
      calls.commit += 1;
      const outcome = reduceTranslationRegionEditProjectMutation(projects, mutation);
      if (!outcome.updated) return null;
      projects = outcome.projects;
      return { project: outcome.project, result: outcome.result };
    },
    logSuccess: () => { calls.success += 1; },
    logFailure: () => { calls.failure += 1; },
    ...overrides,
  };
  return { deps, calls, getProjects: () => projects, setProjects: (next) => { projects = next; }, releaseComposite };
};

test('recovery composites raw output, uploads it, and preserves provider identity without model or credits work', async () => {
  const harness = createRecoveryHarness();
  const item = listRecoverableTranslationRegionEdits(harness.getProjects())[0];
  let compositeInput;
  harness.deps.composite = async (input) => {
    harness.calls.composite += 1;
    compositeInput = input;
    return { blob: new Blob(['protected']) };
  };

  const outcome = await runTranslationRegionEditProtectionRecovery(item, harness.deps);

  assert.equal(outcome.status, 'completed');
  assert.deepEqual(compositeInput, {
    sourceUrl: '/assets/source-v1.png',
    generatedUrl: 'https://provider.example/raw-v2.png',
    regions: item.regions,
  });
  const result = harness.getProjects()[0].results[0];
  const recovered = result.translationEditVersions[1];
  assert.equal(result.imageUrl, '/api/assets/file/recovered-v2.png');
  assert.notEqual(result.imageUrl, item.pendingProtectedSourceUrl);
  assert.equal(recovered.status, 'completed');
  assert.equal(recovered.imageUrl, '/api/assets/file/recovered-v2.png');
  assert.equal(recovered.pendingProtectedSourceUrl, undefined);
  assert.equal(recovered.backendJobId, 'backend-2');
  assert.equal(recovered.taskId, 'provider-2');
  assert.equal(recovered.creditsConsumed, 3.5);
  assert.deepEqual(harness.calls, {
    composite: 1, upload: 1, persistProject: 1, persistFiles: 1, commit: 1, success: 1, failure: 0,
  });
});

test('recovery uses persisted canvas dimensions for composite and validates protected output size', async () => {
  const harness = createRecoveryHarness({
    composite: async (input) => ({
      blob: new Blob(['protected']),
      width: input.targetWidth,
      height: input.targetHeight,
      input,
    }),
  });
  const project = harness.getProjects()[0];
  const pending = project.results[0].translationEditVersions[1];
  pending.canvasWidth = 1200;
  pending.canvasHeight = 1600;
  const [item] = listRecoverableTranslationRegionEdits(harness.getProjects());
  const dimensions = [];

  const outcome = await runTranslationRegionEditProtectionRecovery(item, {
    ...harness.deps,
    composite: async (input) => {
      dimensions.push(input);
      return { blob: new Blob(['protected']), width: 1200, height: 1600 };
    },
    getImageDimensions: async () => ({ width: 1200, height: 1600, ratio: 0.75 }),
  });

  assert.equal(outcome.status, 'completed');
  assert.equal(dimensions[0].targetWidth, 1200);
  assert.equal(dimensions[0].targetHeight, 1600);

  const mismatchHarness = createRecoveryHarness();
  const mismatchPending = mismatchHarness.getProjects()[0].results[0].translationEditVersions[1];
  mismatchPending.canvasWidth = 1200;
  mismatchPending.canvasHeight = 1600;
  const [mismatchItem] = listRecoverableTranslationRegionEdits(mismatchHarness.getProjects());
  const mismatch = await runTranslationRegionEditProtectionRecovery(mismatchItem, {
    ...mismatchHarness.deps,
    composite: async (input) => ({ blob: new Blob(['wrong-size']), width: input.targetWidth, height: input.targetHeight }),
    getImageDimensions: async () => ({ width: 1024, height: 1024, ratio: 1 }),
  });

  assert.equal(mismatch.status, 'failed');
  assert.match(String(mismatch.error?.message || ''), /尺寸/);
  assert.equal(mismatchHarness.getProjects()[0].results[0].imageUrl, '/assets/result-v1.png');
});

test('same recovery key is idempotent while the first recovery is running', async () => {
  const harness = createRecoveryHarness({ waitForComposite: true });
  const item = listRecoverableTranslationRegionEdits(harness.getProjects())[0];

  const first = runTranslationRegionEditProtectionRecovery(item, harness.deps);
  const second = await runTranslationRegionEditProtectionRecovery(item, harness.deps);
  assert.equal(second.status, 'locked');
  assert.equal(harness.calls.composite, 1);
  harness.releaseComposite();
  await first;
  assert.equal(harness.calls.upload, 1);
  assert.equal(harness.deps.locks.has(item.key), false);
});

test('recovery skips upload and persistence when current state changes after compositing', async () => {
  const harness = createRecoveryHarness({ waitForComposite: true });
  const item = listRecoverableTranslationRegionEdits(harness.getProjects())[0];
  const running = runTranslationRegionEditProtectionRecovery(item, harness.deps);
  const changed = structuredClone(harness.getProjects());
  changed[0].results[0].translationEditVersions[1].status = 'completed';
  changed[0].results[0].translationEditVersions[1].imageUrl = '/already-final.png';
  harness.setProjects(changed);
  harness.releaseComposite();

  assert.equal((await running).status, 'skipped');
  assert.equal(harness.calls.upload, 0);
  assert.equal(harness.calls.persistProject, 0);
  assert.equal(harness.calls.commit, 0);
});

test('recovery scope cancellation is forwarded to composite and prevents every later side effect', async () => {
  let releaseComposite;
  const compositeGate = new Promise((resolve) => { releaseComposite = resolve; });
  let scopeCurrent = true;
  let compositeSignal;
  const controller = new AbortController();
  const harness = createRecoveryHarness({
    isScopeCurrent: () => scopeCurrent,
    composite: async (input) => {
      harness.calls.composite += 1;
      compositeSignal = input.signal;
      await compositeGate;
      return { blob: new Blob(['protected']) };
    },
  });
  harness.deps.signal = controller.signal;
  const item = listRecoverableTranslationRegionEdits(harness.getProjects())[0];
  const running = runTranslationRegionEditProtectionRecovery(item, harness.deps);

  scopeCurrent = false;
  controller.abort('account scope changed');
  releaseComposite();

  assert.equal((await running).status, 'skipped');
  assert.equal(compositeSignal, controller.signal);
  assert.deepEqual(harness.calls, {
    composite: 1, upload: 0, persistProject: 0, persistFiles: 0, commit: 0, success: 0, failure: 0,
  });
});

test('recovery skips stale output when normalized regions change during compositing', async () => {
  const harness = createRecoveryHarness({ waitForComposite: true });
  const item = listRecoverableTranslationRegionEdits(harness.getProjects())[0];
  const running = runTranslationRegionEditProtectionRecovery(item, harness.deps);
  const changed = structuredClone(harness.getProjects());
  changed[0].results[0].translationEditVersions[1].regions[0] = {
    ...changed[0].results[0].translationEditVersions[1].regions[0],
    xRatio: 0.35,
    instruction: 'Replace with different copy',
  };
  harness.setProjects(changed);
  harness.releaseComposite();

  assert.equal((await running).status, 'skipped');
  assert.equal(harness.calls.upload, 0);
  assert.equal(harness.calls.persistProject, 0);
  assert.equal(harness.calls.persistFiles, 0);
  assert.equal(harness.calls.commit, 0);
});

test('recovery skips stale v2 output when a newer completed version appears during compositing', async () => {
  const harness = createRecoveryHarness({ waitForComposite: true });
  const item = listRecoverableTranslationRegionEdits(harness.getProjects())[0];
  const running = runTranslationRegionEditProtectionRecovery(item, harness.deps);
  const changed = structuredClone(harness.getProjects());
  changed[0].results[0].translationEditVersions.push({
    id: 'version-3',
    imageUrl: '/assets/final-v3.png',
    sourceVersionId: 'version-1',
    createdAt: 300,
    status: 'completed',
    regions: [],
  });
  harness.setProjects(changed);
  harness.releaseComposite();

  assert.equal((await running).status, 'skipped');
  assert.equal(harness.calls.upload, 0);
  assert.equal(harness.calls.persistProject, 0);
  assert.equal(harness.calls.persistFiles, 0);
  assert.equal(harness.calls.commit, 0);
  assert.equal(harness.getProjects()[0].results[0].translationEditVersions.at(-1).id, 'version-3');
});

for (const [failure, override] of [
  ['composite', { composite: async () => { throw new Error('composite failed'); } }],
  ['upload', { upload: async () => { throw new Error('upload failed'); } }],
  ['project persistence false', { persistProject: async () => false }],
  ['files persistence false', { persistFiles: async () => false }],
]) {
  test(`recovery ${failure} marks only the version as error and preserves the completed result image`, async () => {
    const harness = createRecoveryHarness(override);
    const item = listRecoverableTranslationRegionEdits(harness.getProjects())[0];

    const outcome = await runTranslationRegionEditProtectionRecovery(item, harness.deps);

    assert.equal(outcome.status, 'failed');
    const result = harness.getProjects()[0].results[0];
    assert.equal(result.imageUrl, '/assets/result-v1.png');
    assert.equal(result.status, 'completed');
    assert.equal(result.translationEditVersions[1].status, 'error');
    assert.equal(harness.calls.failure, 1);
    assert.equal(harness.deps.locks.has(item.key), false);
  });
}

test('translation region edit log meta marks recovered work explicitly', () => {
  assert.equal(buildTranslationRegionEditLogMeta({ recovered: true }).recovered, true);
});

test('invalid pending recovery becomes an error without compositing or uploading', async () => {
  const invalidProject = createRecoveryProject();
  invalidProject.results[0].translationEditVersions[1].regions[0].instruction = '   ';
  const harness = createRecoveryHarness();
  harness.setProjects([invalidProject]);
  const item = listUnrecoverableTranslationRegionEdits(harness.getProjects())[0];

  const outcome = await failUnrecoverableTranslationRegionEditProtection(item, harness.deps);

  assert.equal(outcome.status, 'failed');
  assert.equal(harness.calls.composite, 0);
  assert.equal(harness.calls.upload, 0);
  assert.equal(harness.calls.persistProject, 1);
  assert.equal(harness.calls.persistFiles, 1);
  assert.equal(harness.getProjects()[0].results[0].status, 'completed');
  assert.equal(harness.getProjects()[0].results[0].imageUrl, '/assets/result-v1.png');
  assert.equal(harness.getProjects()[0].results[0].translationEditVersions[1].status, 'error');
});

test('pending raw output without source identity is terminated as an error', async () => {
  const missingSourceIdentity = createRecoveryProject();
  delete missingSourceIdentity.results[0].translationEditVersions[1].sourceVersionId;
  const harness = createRecoveryHarness();
  harness.setProjects([missingSourceIdentity]);
  const item = listUnrecoverableTranslationRegionEdits(harness.getProjects())[0];

  const outcome = await failUnrecoverableTranslationRegionEditProtection(item, harness.deps);

  assert.equal(outcome.status, 'failed');
  assert.equal(harness.calls.composite, 0);
  assert.equal(harness.calls.upload, 0);
  assert.equal(harness.calls.persistProject, 1);
  assert.equal(harness.calls.persistFiles, 1);
  assert.equal(harness.getProjects()[0].results[0].status, 'completed');
  assert.equal(harness.getProjects()[0].results[0].imageUrl, '/assets/result-v1.png');
  assert.equal(harness.getProjects()[0].results[0].translationEditVersions[1].status, 'error');
});

test('queued persistence skips all writes when the account changes before the write starts', async () => {
  let releaseQueue;
  const queueGate = new Promise((resolve) => { releaseQueue = resolve; });
  let currentUserId = 'user-a';
  let writes = 0;
  const pending = runGuardedTranslationRegionEditPersistenceWrite({
    resolveBase: async () => {
      await queueGate;
      return { owner: 'user-a' };
    },
    guard: () => currentUserId === 'user-a',
    write: async () => { writes += 1; return true; },
  });

  currentUserId = 'user-b';
  releaseQueue();

  assert.equal(await pending, TRANSLATION_REGION_EDIT_PERSISTENCE_SKIPPED);
  assert.equal(writes, 0);
});

test('queued persistence skips all writes when its account lifecycle signal aborts', async () => {
  let releaseQueue;
  const queueGate = new Promise((resolve) => { releaseQueue = resolve; });
  const controller = new AbortController();
  let writes = 0;
  const pending = runGuardedTranslationRegionEditPersistenceWrite({
    resolveBase: async () => {
      await queueGate;
      return { owner: 'user-a' };
    },
    signal: controller.signal,
    write: async () => { writes += 1; return true; },
  });

  controller.abort('account scope changed');
  releaseQueue();

  assert.equal(await pending, TRANSLATION_REGION_EDIT_PERSISTENCE_SKIPPED);
  assert.equal(writes, 0);
});

test('queued persistence skips all writes when the candidate changes before the write starts', async () => {
  let releaseQueue;
  const queueGate = new Promise((resolve) => { releaseQueue = resolve; });
  let candidateCurrent = true;
  let writes = 0;
  const pending = runGuardedTranslationRegionEditPersistenceWrite({
    resolveBase: async () => {
      await queueGate;
      return { project: 'project-1' };
    },
    guard: () => candidateCurrent,
    write: async () => { writes += 1; return true; },
  });

  candidateCurrent = false;
  releaseQueue();

  assert.equal(await pending, TRANSLATION_REGION_EDIT_PERSISTENCE_SKIPPED);
  assert.equal(writes, 0);
});

test('unguarded persistence keeps the existing write behavior', async () => {
  let writes = 0;
  const result = await runGuardedTranslationRegionEditPersistenceWrite({
    resolveBase: async () => ({ project: 'project-1' }),
    write: async (base) => { writes += 1; return base.project; },
  });

  assert.equal(result, 'project-1');
  assert.equal(writes, 1);
});

test('recovery treats a guarded persistence skip as stale instead of failure', async () => {
  const harness = createRecoveryHarness({
    persistProject: async () => TRANSLATION_REGION_EDIT_PERSISTENCE_SKIPPED,
    persistFiles: async () => TRANSLATION_REGION_EDIT_PERSISTENCE_SKIPPED,
  });
  const item = listRecoverableTranslationRegionEdits(harness.getProjects())[0];

  const outcome = await runTranslationRegionEditProtectionRecovery(item, harness.deps);

  assert.equal(outcome.status, 'skipped');
  assert.equal(harness.calls.commit, 0);
  assert.equal(harness.calls.failure, 0);
  assert.equal(harness.getProjects()[0].results[0].translationEditVersions[1].status, 'generating');
});

test('queued recovery skips every write when hydrated job identity and credits change', async () => {
  let releasePersistence;
  const persistenceGate = new Promise((resolve) => { releasePersistence = resolve; });
  let releaseStarted;
  const bothPersistenceCallsStarted = new Promise((resolve) => { releaseStarted = resolve; });
  let persistenceStarts = 0;
  let localWrites = 0;
  let remoteWrites = 0;
  let item;
  let harness;
  const persist = () => runGuardedTranslationRegionEditPersistenceWrite({
    resolveBase: async () => {
      persistenceStarts += 1;
      if (persistenceStarts === 2) releaseStarted();
      await persistenceGate;
      return {};
    },
    guard: () => {
      const current = listRecoverableTranslationRegionEdits(harness.getProjects())
        .find((candidate) => candidate.key === item.key);
      return isSameTranslationRegionEditRecovery(current, item);
    },
    write: async () => {
      localWrites += 1;
      await Promise.resolve();
      remoteWrites += 1;
      return true;
    },
  });
  harness = createRecoveryHarness({ persistProject: persist, persistFiles: persist });
  item = listRecoverableTranslationRegionEdits(harness.getProjects())[0];

  const running = runTranslationRegionEditProtectionRecovery(item, harness.deps);
  await bothPersistenceCallsStarted;
  const hydrated = structuredClone(harness.getProjects());
  const pending = hydrated[0].results[0].translationEditVersions[1];
  pending.backendJobId = 'backend-3';
  pending.taskId = 'provider-3';
  pending.creditsConsumed = 7.25;
  harness.setProjects(hydrated);
  releasePersistence();

  const outcome = await running;
  assert.equal(outcome.status, 'skipped');
  assert.equal(localWrites, 0);
  assert.equal(remoteWrites, 0);
  assert.equal(harness.calls.commit, 0);
  assert.equal(harness.calls.failure, 0);
  assert.equal(harness.getProjects()[0].results[0].translationEditVersions[1].backendJobId, 'backend-3');
  assert.equal(harness.getProjects()[0].results[0].translationEditVersions[1].taskId, 'provider-3');
  assert.equal(harness.getProjects()[0].results[0].translationEditVersions[1].creditsConsumed, 7.25);
});

test('queued recovery writes and commits when job identity and credits stay unchanged', async () => {
  let releasePersistence;
  const persistenceGate = new Promise((resolve) => { releasePersistence = resolve; });
  let releaseStarted;
  const bothPersistenceCallsStarted = new Promise((resolve) => { releaseStarted = resolve; });
  let persistenceStarts = 0;
  let localWrites = 0;
  let remoteWrites = 0;
  let item;
  let harness;
  const persist = () => runGuardedTranslationRegionEditPersistenceWrite({
    resolveBase: async () => {
      persistenceStarts += 1;
      if (persistenceStarts === 2) releaseStarted();
      await persistenceGate;
      return {};
    },
    guard: () => {
      const current = listRecoverableTranslationRegionEdits(harness.getProjects())
        .find((candidate) => candidate.key === item.key);
      return isSameTranslationRegionEditRecovery(current, item);
    },
    write: async () => {
      localWrites += 1;
      await Promise.resolve();
      remoteWrites += 1;
      return true;
    },
  });
  harness = createRecoveryHarness({ persistProject: persist, persistFiles: persist });
  item = listRecoverableTranslationRegionEdits(harness.getProjects())[0];

  const running = runTranslationRegionEditProtectionRecovery(item, harness.deps);
  await bothPersistenceCallsStarted;
  releasePersistence();

  assert.equal((await running).status, 'completed');
  assert.equal(localWrites, 2);
  assert.equal(remoteWrites, 2);
  assert.equal(harness.calls.commit, 1);
  assert.equal(harness.calls.failure, 0);
});

test('recovery queue keeps multiple completed items at max one in flight', async () => {
  let active = 0;
  let maxInFlight = 0;
  const completed = [];

  await runTranslationRegionEditRecoveryQueue(['a', 'b', 'c'], {
    concurrency: 1,
    worker: async (item) => {
      active += 1;
      maxInFlight = Math.max(maxInFlight, active);
      await Promise.resolve();
      completed.push(item);
      active -= 1;
    },
  });

  assert.equal(maxInFlight, 1);
  assert.deepEqual(completed, ['a', 'b', 'c']);
});

test('recovery queue cleanup prevents remaining starts', async () => {
  let releaseFirst;
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
  let shouldContinue = true;
  const started = [];
  const running = runTranslationRegionEditRecoveryQueue(['a', 'b', 'c'], {
    concurrency: 1,
    shouldContinue: () => shouldContinue,
    worker: async (item) => {
      started.push(item);
      if (item === 'a') await firstGate;
    },
  });

  await Promise.resolve();
  assert.deepEqual(started, ['a']);
  shouldContinue = false;
  releaseFirst();
  await running;

  assert.deepEqual(started, ['a']);
});

test('translation edit project workflow preserves the completed image until protected success', () => {
  const baseResult = {
    id: 'result-1',
    imageUrl: 'protected-v1.png',
    status: 'completed',
    module: 'translation',
    subFeature: 'main',
    translationEditVersions: [{
      id: 'v1', imageUrl: 'protected-v1.png', createdAt: 100, status: 'completed', regions: [],
    }],
  };
  const projects = [{
    id: 'project-1', module: 'translation', subFeature: 'main', status: 'completed', results: [baseResult],
  }];
  const region = createRegion(0);

  const pending = reduceTranslationRegionEditProjectMutation(projects, {
    kind: 'start', projectId: 'project-1', resultId: 'result-1', versionId: 'v2',
    sourceVersionId: 'v1', regions: [region], createdAt: 200,
  });
  assert.equal(pending.updated, true);
  assert.equal(pending.result.imageUrl, 'protected-v1.png');
  assert.equal(pending.result.status, 'completed');
  assert.equal(pending.version.status, 'generating');

  const identified = reduceTranslationRegionEditProjectMutation(pending.projects, {
    kind: 'identity', projectId: 'project-1', resultId: 'result-1', versionId: 'v2',
    backendJobId: 'backend-v2', taskId: 'provider-v2',
  });
  assert.equal(identified.result.imageUrl, 'protected-v1.png');
  assert.equal(identified.version.backendJobId, 'backend-v2');
  assert.equal(identified.version.taskId, 'provider-v2');

  const failed = reduceTranslationRegionEditProjectMutation(identified.projects, {
    kind: 'failure', projectId: 'project-1', resultId: 'result-1', versionId: 'v2', error: 'provider failed',
  });
  assert.equal(failed.result.imageUrl, 'protected-v1.png');
  assert.equal(failed.result.status, 'completed');
  assert.equal(failed.version.status, 'error');
  assert.equal(failed.version.error, 'provider failed');

  const completed = reduceTranslationRegionEditProjectMutation(identified.projects, {
    kind: 'success', projectId: 'project-1', resultId: 'result-1', versionId: 'v2',
    imageUrl: 'protected-v2.png', backendJobId: 'backend-v2', taskId: 'provider-v2', creditsConsumed: 3,
  });
  assert.equal(completed.result.imageUrl, 'protected-v2.png');
  assert.equal(completed.result.status, 'completed');
  assert.equal(completed.version.status, 'completed');
  assert.equal(completed.version.imageUrl, 'protected-v2.png');
  assert.equal(completed.version.creditsConsumed, 3);
  assert.equal(projects[0].results[0], baseResult);
  assert.equal(baseResult.imageUrl, 'protected-v1.png');
});

test('translation edit cancellation requires exact ownership and preserves the prior image', () => {
  const projects = [{
    id: 'project-1', module: 'translation', subFeature: 'detail', status: 'completed', results: [{
      id: 'result-1', imageUrl: 'protected-v1.png', status: 'completed', module: 'translation', subFeature: 'detail',
      translationEditVersions: [
        { id: 'v1', imageUrl: 'protected-v1.png', createdAt: 100, status: 'completed', regions: [] },
        { id: 'v2', sourceVersionId: 'v1', createdAt: 200, status: 'generating', regions: [createRegion(0)], backendJobId: 'backend-v2' },
      ],
    }],
  }];

  assert.equal(isOwnedGeneratingTranslationEditVersion(projects, {
    projectId: 'project-1', resultId: 'result-1', versionId: 'v2', backendJobId: 'backend-v2',
  }), true);
  assert.equal(isOwnedGeneratingTranslationEditVersion(projects, {
    projectId: 'project-1', resultId: 'result-1', versionId: 'v2',
  }), true);
  assert.equal(isOwnedGeneratingTranslationEditVersion(projects, {
    projectId: 'project-1', resultId: 'result-1', versionId: 'v2', backendJobId: 'other-job',
  }), false);
  assert.equal(isOwnedGeneratingTranslationEditVersion(projects, {
    projectId: 'project-1', resultId: 'result-1', versionId: 'v1', backendJobId: 'backend-v2',
  }), false);

  const cancelled = reduceTranslationRegionEditProjectMutation(projects, {
    kind: 'cancel', projectId: 'project-1', resultId: 'result-1', versionId: 'v2',
    backendJobId: 'backend-v2', error: '修改已取消',
  });
  assert.equal(cancelled.updated, true);
  assert.equal(cancelled.result.imageUrl, 'protected-v1.png');
  assert.equal(cancelled.result.status, 'completed');
  assert.equal(cancelled.version.status, 'error');
  assert.equal(cancelled.version.error, '修改已取消');

  const foreignCancel = reduceTranslationRegionEditProjectMutation(projects, {
    kind: 'cancel', projectId: 'project-1', resultId: 'result-1', versionId: 'v2',
    backendJobId: 'other-job', error: '修改已取消',
  });
  assert.equal(foreignCancel.updated, false);
  assert.equal(foreignCancel.projects, projects);

  const preJobProjects = structuredClone(projects);
  delete preJobProjects[0].results[0].translationEditVersions[1].backendJobId;
  assert.equal(isOwnedGeneratingTranslationEditVersion(preJobProjects, {
    projectId: 'project-1', resultId: 'result-1', versionId: 'v2',
  }), true);
  assert.equal(isOwnedGeneratingTranslationEditVersion(preJobProjects, {
    projectId: 'project-1', resultId: 'result-1', versionId: 'v2', backendJobId: 'unowned-job',
  }), false);
  const preJobCancelled = reduceTranslationRegionEditProjectMutation(preJobProjects, {
    kind: 'cancel', projectId: 'project-1', resultId: 'result-1', versionId: 'v2', error: 'cancelled before job',
  });
  assert.equal(preJobCancelled.updated, true);
  assert.equal(preJobCancelled.version.status, 'error');
  assert.equal(preJobCancelled.version.error, 'cancelled before job');

  for (const mutate of [
    (copy) => { copy[0].module = 'one_click'; },
    (copy) => { copy[0].subFeature = 'remove_text'; },
    (copy) => { copy[0].results[0].module = 'one_click'; },
    (copy) => { copy[0].results[0].subFeature = 'main'; },
  ]) {
    const invalid = structuredClone(projects);
    mutate(invalid);
    assert.equal(isOwnedGeneratingTranslationEditVersion(invalid, {
      projectId: 'project-1', resultId: 'result-1', versionId: 'v2', backendJobId: 'backend-v2',
    }), false);
  }
});

test('translation edit terminal mutations preserve actual credits and known task identity', () => {
  const createProjects = () => [{
    id: 'project-1', module: 'translation', subFeature: 'main', results: [{
      id: 'result-1', module: 'translation', subFeature: 'main', status: 'completed', imageUrl: 'v1.png',
      translationEditVersions: [
        { id: 'v1', imageUrl: 'v1.png', createdAt: 1, status: 'completed', regions: [] },
        {
          id: 'v2', sourceVersionId: 'v1', createdAt: 2, status: 'generating', regions: [createRegion(0)],
          backendJobId: 'known-backend', taskId: 'known-provider', creditsConsumed: 1.5,
        },
      ],
    }],
  }];

  const failed = reduceTranslationRegionEditProjectMutation(createProjects(), {
    kind: 'failure', projectId: 'project-1', resultId: 'result-1', versionId: 'v2', error: 'charged failure',
    backendJobId: 'returned-backend', taskId: 'returned-provider', creditsConsumed: 2.5,
  });
  assert.equal(failed.version.status, 'error');
  assert.equal(failed.version.backendJobId, 'returned-backend');
  assert.equal(failed.version.taskId, 'returned-provider');
  assert.equal(failed.version.creditsConsumed, 2.5);

  const cancelled = reduceTranslationRegionEditProjectMutation(createProjects(), {
    kind: 'cancel', projectId: 'project-1', resultId: 'result-1', versionId: 'v2', error: 'cancelled',
  });
  assert.equal(cancelled.version.backendJobId, 'known-backend');
  assert.equal(cancelled.version.taskId, 'known-provider');
  assert.equal(cancelled.version.creditsConsumed, 1.5);
});

test('late job identity after pre-job cancellation keeps the version terminal', () => {
  const projects = [{
    id: 'project-1', module: 'translation', subFeature: 'main', results: [{
      id: 'result-1', module: 'translation', subFeature: 'main', status: 'completed', imageUrl: 'v1.png',
      translationEditVersions: [
        { id: 'v1', imageUrl: 'v1.png', createdAt: 1, status: 'completed', regions: [] },
        { id: 'v2', sourceVersionId: 'v1', createdAt: 2, status: 'generating', regions: [createRegion(0)] },
      ],
    }],
  }];
  const cancelled = reduceTranslationRegionEditProjectMutation(projects, {
    kind: 'cancel', projectId: 'project-1', resultId: 'result-1', versionId: 'v2', error: 'cancelled before backend',
  });
  assert.equal(cancelled.version.status, 'error');

  const lateIdentity = reduceTranslationRegionEditProjectMutation(cancelled.projects, {
    kind: 'terminal_identity', projectId: 'project-1', resultId: 'result-1', versionId: 'v2',
    backendJobId: 'late-backend', taskId: 'late-provider', error: 'must not replace cancellation',
  });
  assert.equal(lateIdentity.updated, true);
  assert.equal(lateIdentity.version.status, 'error');
  assert.equal(lateIdentity.version.error, 'cancelled before backend');
  assert.equal(lateIdentity.version.backendJobId, 'late-backend');
  assert.equal(lateIdentity.version.taskId, 'late-provider');

  const ordinaryIdentity = reduceTranslationRegionEditProjectMutation(cancelled.projects, {
    kind: 'identity', projectId: 'project-1', resultId: 'result-1', versionId: 'v2',
    backendJobId: 'late-backend', taskId: 'late-provider',
  });
  assert.equal(ordinaryIdentity.updated, false);
});

test('late job identity cancellation and persistence are ordered and fully observed', async () => {
  const events = [];
  const candidate = { project: { id: 'project-1' }, result: { id: 'result-1' } };
  const settled = await settleLateTranslationRegionEditJobIdentity({
    backendJobId: 'late-backend',
    candidate,
    cancelJob: async (jobId) => { events.push(`cancel:${jobId}`); },
    persist: async (value) => { events.push(`persist:${value.result.id}`); },
  });
  assert.deepEqual(events, ['cancel:late-backend', 'persist:result-1']);
  assert.deepEqual(settled, { cancelError: null, persistenceError: null });

  const cancelError = new Error('cancel unavailable');
  const persistenceError = new Error('persist unavailable');
  const failed = await settleLateTranslationRegionEditJobIdentity({
    backendJobId: 'late-backend',
    candidate,
    cancelJob: async () => { throw cancelError; },
    persist: async () => { throw persistenceError; },
  });
  assert.equal(failed.cancelError, cancelError);
  assert.equal(failed.persistenceError, persistenceError);
});

test('translation edit credits count charged terminal edit versions once by id', () => {
  assert.equal(getTranslationEditCreditsConsumed({
    creditsConsumed: 9,
    translationEditVersions: [
      { id: 'result-base', status: 'completed', creditsConsumed: 9 },
      { id: 'edit-1', sourceVersionId: 'result-base', status: 'completed', creditsConsumed: 2 },
      { id: 'edit-1', sourceVersionId: 'result-base', status: 'completed', creditsConsumed: 2 },
      { id: 'edit-2', sourceVersionId: 'edit-1', status: 'error', creditsConsumed: 1.5 },
      { id: 'edit-3', sourceVersionId: 'edit-2', status: 'generating', creditsConsumed: 4 },
      { id: 'edit-4', sourceVersionId: 'edit-2', status: 'error', creditsConsumed: 0 },
    ],
  }), 3.5);
  assert.equal(getTranslationEditCreditsConsumed({ translationEditVersions: [] }), 0);
});

test('translation edit owner tokens prevent an old finally from releasing a new task lock', () => {
  const owners = new Map();
  const released = [];
  claimTranslationRegionEditLockOwner(owners, 'edit:project:result', 'old-version');
  assert.equal(releaseTranslationRegionEditLockOwner(
    owners, 'edit:project:result', 'old-version', () => released.push('old-cancel'),
  ), true);

  claimTranslationRegionEditLockOwner(owners, 'edit:project:result', 'new-version');
  assert.equal(releaseTranslationRegionEditLockOwner(
    owners, 'edit:project:result', 'old-version', () => released.push('old-finally'),
  ), false);
  assert.equal(owners.get('edit:project:result'), 'new-version');
  assert.deepEqual(released, ['old-cancel']);

  assert.equal(releaseTranslationRegionEditLockOwner(
    owners, 'edit:project:result', 'new-version', () => released.push('new-finally'),
  ), true);
  assert.equal(owners.has('edit:project:result'), false);
  assert.deepEqual(released, ['old-cancel', 'new-finally']);
});

test('translation edit start refuses a second generating version for the same result', () => {
  const projects = [{
    id: 'project-1', module: 'translation', subFeature: 'main', results: [{
      id: 'result-1', module: 'translation', subFeature: 'main', imageUrl: 'v1.png', status: 'completed',
      translationEditVersions: [
        { id: 'v1', imageUrl: 'v1.png', createdAt: 1, status: 'completed', regions: [] },
        { id: 'v2', sourceVersionId: 'v1', createdAt: 2, status: 'generating', regions: [createRegion(0)] },
      ],
    }],
  }];
  const outcome = reduceTranslationRegionEditProjectMutation(projects, {
    kind: 'start', projectId: 'project-1', resultId: 'result-1', versionId: 'v3',
    sourceVersionId: 'v1', createdAt: 3, regions: [createRegion(0)],
  });
  assert.equal(outcome.updated, false);
  assert.equal(outcome.projects, projects);
});

test('translation edit success commits only after both persistence writes succeed', async () => {
  const candidate = { project: { id: 'project-1' }, result: { id: 'result-1' } };
  const events = [];
  const committed = await persistTranslationRegionEditTransition({
    candidate,
    persistProject: async () => { events.push('project'); return true; },
    persistFiles: async () => { events.push('files'); return true; },
    commit: (value) => { events.push('commit'); return value; },
  });
  assert.equal(committed, candidate);
  assert.deepEqual(events.slice(0, 2).sort(), ['files', 'project']);
  assert.equal(events[2], 'commit');
});

test('translation edit success never commits when either persistence write fails', async () => {
  for (const failure of ['project', 'files']) {
    let commits = 0;
    await assert.rejects(
      persistTranslationRegionEditTransition({
        candidate: { project: { id: 'project-1' }, result: { id: 'result-1' } },
        persistProject: async () => failure !== 'project',
        persistFiles: async () => failure !== 'files',
        commit: () => { commits += 1; },
      }),
      (error) => error?.code === `translation_region_edit_${failure}_persist_failed`,
    );
    assert.equal(commits, 0, `${failure} persistence failure must not display success`);
  }
});

test('translation edit persistence rejection is observed and never commits', async () => {
  for (const rejection of ['project', 'files']) {
    let commits = 0;
    await assert.rejects(persistTranslationRegionEditTransition({
      candidate: { project: { id: 'project-1' }, result: { id: 'result-1' } },
      persistProject: async () => {
        if (rejection === 'project') throw new Error('project rejected');
        return true;
      },
      persistFiles: async () => {
        if (rejection === 'files') throw new Error('files rejected');
        return true;
      },
      commit: () => { commits += 1; },
    }), (error) => error?.code === `translation_region_edit_${rejection}_persist_failed`);
    assert.equal(commits, 0);
  }
});

test('cancel transaction rejects when the version completes while persistence is waiting', async () => {
  let currentVersion = { id: 'v2', status: 'generating' };
  const successSignals = [];
  await assert.rejects(persistTranslationRegionEditCancelTransition({
    candidate: { project: { id: 'project-1' }, result: { id: 'result-1' } },
    persistProject: async () => {
      currentVersion = { id: 'v2', status: 'completed' };
      return true;
    },
    persistFiles: async () => true,
    commit: () => currentVersion.status === 'generating'
      ? successSignals.push('cancelled')
      : null,
    getCurrentVersion: () => currentVersion,
  }), (error) => {
    assert.equal(error?.code, 'translation_region_edit_cancel_not_applied');
    assert.equal(error?.raceOutcome, 'already_completed');
    assert.match(error?.message || '', /任务已完成，取消未生效/);
    return true;
  });
  assert.deepEqual(successSignals, []);
});

test('translation region edit log meta exposes one stable lifecycle schema and structural errors', () => {
  assert.deepEqual(buildTranslationRegionEditLogMeta({
    shellProjectId: 'project-1',
    shellResultId: 'result-1',
    sourceVersionId: 'v1',
    targetVersionId: 'v2',
    regions: [createRegion(0), createRegion(1)],
    backendJobId: 'backend-2',
    providerTaskId: 'provider-2',
    creditsConsumed: 3,
  }), {
    shellProjectId: 'project-1',
    shellResultId: 'result-1',
    sourceVersionId: 'v1',
    targetVersionId: 'v2',
    regionCount: 2,
    backendJobId: 'backend-2',
    providerTaskId: 'provider-2',
    creditsConsumed: 3,
  });

  const error = Object.assign(new Error('project write failed'), {
    code: 'translation_region_edit_project_persist_failed',
  });
  assert.deepEqual(buildTranslationRegionEditLogMeta({
    shellProjectId: 'project-1', shellResultId: 'result-1', sourceVersionId: 'v1',
    targetVersionId: 'v2', regions: [createRegion(0)], error,
  }), {
    shellProjectId: 'project-1', shellResultId: 'result-1', sourceVersionId: 'v1',
    targetVersionId: 'v2', regionCount: 1, backendJobId: '', providerTaskId: '',
    creditsConsumed: undefined,
    errorCategory: 'persistence',
    errorCode: 'translation_region_edit_project_persist_failed',
    errorMessage: 'project write failed',
  });

  assert.deepEqual(buildTranslationRegionEditLogMeta({
    shellProjectId: 'project-1', shellResultId: 'result-1', sourceVersionId: 'v1',
    targetVersionId: 'v2', regions: [createRegion(0)],
    persistenceStatus: 'failed', persistenceError: 'remote save rejected', raceOutcome: 'state_changed',
  }), {
    shellProjectId: 'project-1', shellResultId: 'result-1', sourceVersionId: 'v1',
    targetVersionId: 'v2', regionCount: 1, backendJobId: '', providerTaskId: '',
    creditsConsumed: undefined, persistenceStatus: 'failed', persistenceError: 'remote save rejected',
    raceOutcome: 'state_changed',
  });

  const cancelError = Object.assign(new Error('late backend cancellation rejected'), {
    code: 'translation_region_edit_late_cancel_failed',
  });
  assert.deepEqual(buildTranslationRegionEditLogMeta({
    shellProjectId: 'project-1', shellResultId: 'result-1', sourceVersionId: 'v1',
    targetVersionId: 'v2', regions: [createRegion(0)], backendJobId: 'late-backend',
    providerTaskId: 'late-provider', persistenceStatus: 'success', cancelError, error: cancelError,
  }), {
    shellProjectId: 'project-1', shellResultId: 'result-1', sourceVersionId: 'v1',
    targetVersionId: 'v2', regionCount: 1, backendJobId: 'late-backend',
    providerTaskId: 'late-provider', creditsConsumed: undefined,
    persistenceStatus: 'success', persistenceError: '',
    cancelErrorCode: 'translation_region_edit_late_cancel_failed',
    cancelErrorMessage: 'late backend cancellation rejected',
    errorCategory: 'coded', errorCode: 'translation_region_edit_late_cancel_failed',
    errorMessage: 'late backend cancellation rejected',
  });
});

const createRegion = (index, overrides = {}) => ({
  id: `region-${index + 1}`,
  xRatio: index * 0.15,
  yRatio: 0.1,
  widthRatio: 0.1,
  heightRatio: 0.1,
  instruction: `Edit region ${index + 1}`,
  ...overrides,
});

test('translation region edits allow five rectangles and reject a sixth', () => {
  assert.equal(MAX_TRANSLATION_EDIT_REGIONS, 5);
  assert.equal(MIN_TRANSLATION_EDIT_REGION_RATIO, 0.02);

  const fiveRegions = Array.from({ length: 5 }, (_, index) => createRegion(index));
  const valid = validateTranslationEditRegions(fiveRegions);
  assert.equal(valid.ok, true);
  assert.equal(valid.regions.length, 5);

  const invalid = validateTranslationEditRegions([
    ...fiveRegions,
    createRegion(5),
  ]);
  assert.equal(invalid.ok, false);
  assert.equal(invalid.code, 'too_many_regions');
});

test('normalization clamps rectangles and keeps numbering paired with instructions', () => {
  const regions = normalizeTranslationEditRegions([
    {
      id: 'second-source-id',
      xRatio: 0.8,
      yRatio: -1,
      widthRatio: 0.4,
      heightRatio: 1.5,
      instruction: '  Second instruction  ',
    },
    {
      id: 'first-source-id',
      xRatio: -0.2,
      yRatio: 0.2,
      widthRatio: 0.2,
      heightRatio: 0.2,
      instruction: 'First instruction',
    },
  ]);

  assert.deepEqual(
    regions.map(({ id, index, instruction }) => [id, index, instruction]),
    [
      ['second-source-id', 1, 'Second instruction'],
      ['first-source-id', 2, 'First instruction'],
    ]
  );
  assert.equal(regions[0].xRatio, 0.6);
  assert.equal(regions[0].yRatio, 0);
  assert.equal(regions[0].widthRatio, 0.4);
  assert.equal(regions[0].heightRatio, 1);
  assert.equal(regions[1].xRatio, 0);
});

test('free selection helpers preserve overflow during editing and clip only for submission', () => {
  const overflowRegion = translationRegionEditUtils.createTranslationEditRegion(
    { xRatio: -0.1, yRatio: 0.1 },
    { xRatio: 1.1, yRatio: 0.3 },
    'overflow-region',
    { allowOverflow: true },
  );
  assert.deepEqual(overflowRegion, {
    id: 'overflow-region',
    index: 1,
    xRatio: -0.1,
    yRatio: 0.1,
    widthRatio: 1.2,
    heightRatio: 0.2,
    instruction: '',
  });

  assert.deepEqual(
    translationRegionEditUtils.moveTranslationEditRegion(
      createRegion(0, { xRatio: 0.9, yRatio: 0.1, widthRatio: 0.2 }),
      { xRatio: 0.3, yRatio: -0.2 },
      { allowOverflow: true },
    ),
    createRegion(0, { xRatio: 1.2, yRatio: -0.1, widthRatio: 0.2 }),
  );

  assert.deepEqual(
    translationRegionEditUtils.resizeTranslationEditRegion(
      createRegion(0, { xRatio: 0.8, yRatio: 0.1, widthRatio: 0.15 }),
      'e',
      { xRatio: 0.3, yRatio: 0 },
      { allowOverflow: true },
    ),
    createRegion(0, { xRatio: 0.8, yRatio: 0.1, widthRatio: 0.45 }),
  );

  assert.deepEqual(
    clipTranslationEditRegionsToImageBounds([{
      ...overflowRegion,
      instruction: '  Edit visible part  ',
    }]),
    [{
      id: 'overflow-region',
      index: 1,
      xRatio: 0,
      yRatio: 0.1,
      widthRatio: 1,
      heightRatio: 0.2,
      instruction: 'Edit visible part',
    }],
  );
});

test('normalization assigns stable fallback ids to regions without ids', () => {
  const input = [createRegion(0, { id: undefined }), createRegion(1, { id: undefined })];

  const first = normalizeTranslationEditRegions(input);
  const second = normalizeTranslationEditRegions(input);

  assert.deepEqual(first.map((region) => region.id), [
    'translation-edit-region-1',
    'translation-edit-region-2',
  ]);
  assert.deepEqual(second.map((region) => region.id), first.map((region) => region.id));
});

test('validation rejects an empty region list', () => {
  const result = validateTranslationEditRegions([]);

  assert.equal(result.ok, false);
  assert.equal(result.code, 'empty_regions');
});

test('validation rejects a blank instruction after trimming it', () => {
  const result = validateTranslationEditRegions([
    createRegion(0, { instruction: '   ' }),
  ]);

  assert.equal(result.ok, false);
  assert.equal(result.code, 'missing_instruction');
  assert.equal(result.regionId, 'region-1');
});

test('validation rejects object and numeric instructions without coercing them', () => {
  const objectInstruction = { toString: () => 'coerced instruction' };

  for (const instruction of [objectInstruction, 123]) {
    const result = validateTranslationEditRegions([
      createRegion(0, { instruction }),
    ]);

    assert.equal(result.ok, false);
    assert.equal(result.code, 'invalid_instruction_type');
  }
});

test('validation rejects non-finite and non-number coordinates without coercing them', () => {
  let coordinateCoercions = 0;
  const objectCoordinate = {
    valueOf: () => {
      coordinateCoercions += 1;
      return 0.2;
    },
  };
  for (const [field, value] of [
    ['xRatio', Number.NaN],
    ['yRatio', Number.POSITIVE_INFINITY],
    ['widthRatio', objectCoordinate],
  ]) {
    const result = validateTranslationEditRegions([
      createRegion(0, { [field]: value }),
    ]);

    assert.equal(result.ok, false);
    assert.equal(result.code, 'invalid_region_coordinates');
  }
  assert.equal(coordinateCoercions, 0);
});

test('validation returns the sole trimmed and coordinate-normalized region array', () => {
  const result = validateTranslationEditRegions([
    createRegion(0, {
      xRatio: 0.95,
      yRatio: -0.2,
      widthRatio: 0.2,
      instruction: '  Keep exact content  ',
    }),
  ]);

  assert.equal(result.ok, true);
  assert.deepEqual(result.regions, [{
    ...createRegion(0),
    index: 1,
    xRatio: 0.8,
    yRatio: 0,
    widthRatio: 0.2,
    instruction: 'Keep exact content',
  }]);
});

test('instruction length limits accept exact boundaries and reject overflow', () => {
  assert.equal(MAX_TRANSLATION_EDIT_INSTRUCTION_LENGTH, 1000);
  assert.equal(MAX_TRANSLATION_EDIT_TOTAL_INSTRUCTION_LENGTH, 4000);

  const exactSingle = validateTranslationEditRegions([
    createRegion(0, { instruction: 'a'.repeat(1000) }),
  ]);
  assert.equal(exactSingle.ok, true);

  const longSingle = validateTranslationEditRegions([
    createRegion(0, { instruction: 'a'.repeat(1001) }),
  ]);
  assert.equal(longSingle.ok, false);
  assert.equal(longSingle.code, 'instruction_too_long');

  const exactTotal = validateTranslationEditRegions(
    Array.from({ length: 4 }, (_, index) => createRegion(index, {
      instruction: String(index).repeat(1000),
    })),
  );
  assert.equal(exactTotal.ok, true);

  const longTotal = validateTranslationEditRegions(
    Array.from({ length: 5 }, (_, index) => createRegion(index, {
      instruction: index === 4 ? 'x' : String(index).repeat(1000),
    })),
  );
  assert.equal(longTotal.ok, false);
  assert.equal(longTotal.code, 'total_instruction_too_long');
});

test('validation rejects regions below the minimum size', () => {
  const result = validateTranslationEditRegions([
    createRegion(0, { widthRatio: MIN_TRANSLATION_EDIT_REGION_RATIO - 0.001 }),
  ]);

  assert.equal(result.ok, false);
  assert.equal(result.code, 'region_too_small');
  assert.equal(result.regionId, 'region-1');
});

test('validation rejects overlapping rectangles', () => {
  const result = validateTranslationEditRegions([
    createRegion(0, { xRatio: 0.1, yRatio: 0.1, widthRatio: 0.3, heightRatio: 0.3 }),
    createRegion(1, { xRatio: 0.2, yRatio: 0.2, widthRatio: 0.3, heightRatio: 0.3 }),
  ]);

  assert.equal(result.ok, false);
  assert.equal(result.code, 'overlapping_regions');
  assert.equal(result.regionId, 'region-2');
});

test('validation accepts non-overlapping rectangles that only touch edges', () => {
  const result = validateTranslationEditRegions([
    createRegion(0, { xRatio: 0.1, yRatio: 0.1, widthRatio: 0.2, heightRatio: 0.2 }),
    createRegion(1, { xRatio: 0.3, yRatio: 0.1, widthRatio: 0.2, heightRatio: 0.2 }),
  ]);

  assert.equal(result.ok, true);
  assert.deepEqual(result.regions.map((region) => region.index), [1, 2]);
});

test('legacy image results are exposed as a completed V1 base version', () => {
  const result = {
    id: 'result-1',
    imageUrl: 'v1.png',
    createdAt: 100,
  };

  assert.deepEqual(ensureTranslationEditVersions(result), [{
    id: 'result-1-base',
    imageUrl: 'v1.png',
    createdAt: 100,
    status: 'completed',
    regions: [],
  }]);
  assert.deepEqual(ensureTranslationEditVersions({ id: 'empty-result' }), []);
});

test('completed version lookup excludes incomplete versions and missing images', () => {
  const completed = { id: 'v1', imageUrl: 'v1.png', status: 'completed' };
  const result = {
    id: 'result-1',
    translationEditVersions: [
      completed,
      { id: 'v2', imageUrl: '', status: 'completed' },
      { id: 'v3', imageUrl: 'v3.png', status: 'generating' },
      { id: 'v4', imageUrl: 'v4.png', status: 'error' },
    ],
  };

  assert.deepEqual(getCompletedTranslationEditVersions(result), [completed]);
});

test('visible version lookup includes pending and failed edit attempts', () => {
  const completed = { id: 'v1', imageUrl: 'v1.png', status: 'completed' };
  const result = {
    id: 'result-1',
    translationEditVersions: [
      completed,
      { id: 'v2', imageUrl: '', status: 'completed' },
      { id: 'v3', sourceVersionId: 'v1', pendingProtectedSourceUrl: 'raw-v3.png', status: 'generating' },
      { id: 'v4', sourceVersionId: 'v1', pendingProtectedSourceUrl: 'raw-v4.png', status: 'error', error: '保护合成失败' },
    ],
  };

  assert.deepEqual(getVisibleTranslationEditVersions(result).map((version) => version.id), ['v1', 'v3', 'v4']);
});

test('starting from an old version appends a generating version with lineage and regions', () => {
  const v1 = Object.freeze({
    id: 'v1',
    imageUrl: 'v1.png',
    createdAt: 100,
    status: 'completed',
    regions: Object.freeze([]),
  });
  const v2 = Object.freeze({
    id: 'v2',
    imageUrl: 'v2.png',
    createdAt: 200,
    status: 'completed',
    regions: Object.freeze([]),
  });
  const originalVersions = Object.freeze([v1, v2]);
  const originalSnapshot = structuredClone(originalVersions);
  const base = Object.freeze({
    id: 'result-1',
    imageUrl: 'v1.png',
    createdAt: 100,
    translationEditVersions: originalVersions,
  });
  const regions = Object.freeze([
    Object.freeze(createRegion(0, { instruction: '  Change copy  ' })),
  ]);
  const input = Object.freeze({
    versionId: 'v3',
    sourceVersionId: 'v1',
    canvasWidth: 1200,
    canvasHeight: 1600,
    regions,
    createdAt: 300,
  });

  const versions = startTranslationEditVersion(base, input);

  assert.notEqual(versions, originalVersions);
  assert.notEqual(versions[2], input);
  assert.equal(versions.length, 3);
  assert.deepEqual(versions[2], {
    id: 'v3',
    sourceVersionId: 'v1',
    canvasWidth: 1200,
    canvasHeight: 1600,
    createdAt: 300,
    status: 'generating',
    regions: [{ ...createRegion(0), instruction: 'Change copy', index: 1 }],
  });
  assert.equal(originalVersions.length, 2);
  assert.deepEqual(originalVersions, originalSnapshot);
  assert.equal(v1.status, 'completed');
  assert.equal(v1.imageUrl, 'v1.png');
  assert.equal(v2.status, 'completed');
  assert.equal(v2.imageUrl, 'v2.png');
});

test('completing and failing a version do not alter other versions', () => {
  const first = Object.freeze({
    id: 'v1',
    imageUrl: 'v1.png',
    status: 'completed',
    regions: [],
  });
  const pending = Object.freeze({
    id: 'v2',
    imageUrl: '',
    status: 'generating',
    canvasWidth: 1200,
    canvasHeight: 1600,
    regions: [],
  });
  const versions = Object.freeze([first, pending]);

  const completed = completeTranslationEditVersion(versions, 'v2', {
    imageUrl: 'v2.png',
    taskId: 'provider-2',
  });
  assert.equal(completed[0], first);
  assert.deepEqual(completed[1], {
    ...pending,
    imageUrl: 'v2.png',
    taskId: 'provider-2',
    status: 'completed',
    error: undefined,
  });

  const completedTarget = Object.freeze(completed[1]);
  const completedInput = Object.freeze(completed);
  const completedSnapshot = structuredClone(completedInput);
  const failed = failTranslationEditVersion(completed, 'v2', 'provider failed');

  assert.notEqual(failed, completedInput);
  assert.notEqual(failed[1], completedTarget);
  assert.equal(failed[0], first);
  assert.deepEqual(failed[1], {
    ...completedTarget,
    status: 'error',
    error: 'provider failed',
  });
  assert.equal(completedInput.length, 2);
  assert.deepEqual(completedInput, completedSnapshot);
  assert.equal(completedTarget.status, 'completed');
  assert.equal(completedTarget.imageUrl, 'v2.png');
  assert.equal(completedTarget.taskId, 'provider-2');
  assert.equal(completedTarget.error, undefined);
});

test('raw successful edit output is stored as a recoverable visible version before protection', () => {
  const projects = [{
    id: 'project-1', module: 'translation', subFeature: 'main', results: [{
      id: 'result-1', module: 'translation', subFeature: 'main', imageUrl: 'v1.png', status: 'completed',
      translationEditVersions: [
        { id: 'v1', imageUrl: 'v1.png', createdAt: 1, status: 'completed', regions: [] },
        { id: 'v2', sourceVersionId: 'v1', createdAt: 2, status: 'generating', regions: [createRegion(0)] },
      ],
    }],
  }];

  const raw = reduceTranslationRegionEditProjectMutation(projects, {
    kind: 'raw_success',
    projectId: 'project-1',
    resultId: 'result-1',
    versionId: 'v2',
    pendingProtectedSourceUrl: 'https://provider.example/raw-v2.png',
    backendJobId: 'backend-v2',
    taskId: 'provider-v2',
    creditsConsumed: 3.5,
  });

  assert.equal(raw.updated, true);
  assert.equal(raw.result.imageUrl, 'v1.png');
  assert.deepEqual(raw.result.translationEditVersions[1], {
    id: 'v2',
    sourceVersionId: 'v1',
    createdAt: 2,
    status: 'generating',
    regions: [createRegion(0)],
    pendingProtectedSourceUrl: 'https://provider.example/raw-v2.png',
    backendJobId: 'backend-v2',
    taskId: 'provider-v2',
    creditsConsumed: 3.5,
  });
  assert.deepEqual(getVisibleTranslationEditVersions(raw.result).map((version) => version.id), ['v1', 'v2']);

  const failed = reduceTranslationRegionEditProjectMutation(raw.projects, {
    kind: 'failure',
    projectId: 'project-1',
    resultId: 'result-1',
    versionId: 'v2',
    error: '保护合成失败',
  });
  assert.equal(failed.result.translationEditVersions[1].status, 'error');
  assert.equal(failed.result.translationEditVersions[1].pendingProtectedSourceUrl, 'https://provider.example/raw-v2.png');
  assert.deepEqual(getVisibleTranslationEditVersions(failed.result).map((version) => version.id), ['v1', 'v2']);
});

test('completing a version accepts valid canvas dimensions and rejects invalid patch dimensions', () => {
  const versions = [{
    id: 'v2',
    imageUrl: '',
    status: 'generating',
    canvasWidth: 1200,
    canvasHeight: 1600,
    regions: [],
  }];

  const resized = completeTranslationEditVersion(versions, 'v2', {
    imageUrl: 'v2.png',
    canvasWidth: 2000,
    canvasHeight: 2400,
  });
  assert.equal(resized[0].canvasWidth, 2000);
  assert.equal(resized[0].canvasHeight, 2400);

  const invalid = completeTranslationEditVersion(versions, 'v2', {
    imageUrl: 'v2.png',
    canvasWidth: 0,
    canvasHeight: Number.POSITIVE_INFINITY,
  });
  assert.equal(invalid[0].canvasWidth, 1200);
  assert.equal(invalid[0].canvasHeight, 1600);
});

test('translation edit versions merge by id without deleting richer cached fields', () => {
  const existing = Object.freeze([
    Object.freeze({
      id: 'v1',
      imageUrl: 'v1.png',
      createdAt: 100,
      status: 'completed',
      regions: Object.freeze([]),
      taskId: 'provider-v1',
    }),
    Object.freeze({
      id: 'v2',
      imageUrl: 'v2.png',
    sourceVersionId: 'v1',
    createdAt: 200,
    status: 'completed',
      canvasWidth: 1200,
      canvasHeight: 1600,
    regions: Object.freeze([Object.freeze(createRegion(0, { instruction: 'Keep this copy' }))]),
    taskId: 'provider-v2',
      backendJobId: 'backend-v2',
      creditsConsumed: 3,
      pendingProtectedSourceUrl: 'protected-v1.png',
    }),
  ]);
  const incoming = Object.freeze([
    Object.freeze({
      id: 'v2',
      imageUrl: 'stale-v2.png',
      sourceVersionId: 'stale-source',
      createdAt: 999,
      status: 'error',
      canvasWidth: 0,
      canvasHeight: -1,
      regions: Object.freeze([Object.freeze(createRegion(0, { instruction: 'Stale copy' }))]),
      taskId: 'stale-provider-v2',
      backendJobId: 'stale-backend-v2',
      creditsConsumed: 99,
      error: 'stale cache',
      pendingProtectedSourceUrl: 'stale-protected.png',
    }),
    Object.freeze({
      id: 'v3',
      imageUrl: 'v3.png',
      sourceVersionId: 'v2',
      createdAt: 300,
      status: 'completed',
      regions: Object.freeze([Object.freeze(createRegion(0, { instruction: 'New copy' }))]),
      taskId: 'provider-v3',
    }),
  ]);
  const existingSnapshot = structuredClone(existing);
  const incomingSnapshot = structuredClone(incoming);

  const merged = mergeTranslationEditVersions(existing, incoming);

  assert.deepEqual(merged.map((version) => version.id), ['v1', 'v2', 'v3']);
  assert.deepEqual(merged[1], {
    ...existingSnapshot[1],
    status: 'completed',
  });
  assert.equal(merged[1].canvasWidth, 1200);
  assert.equal(merged[1].canvasHeight, 1600);
  assert.deepEqual(merged[2], incomingSnapshot[1]);
  assert.notEqual(merged, existing);
  assert.notEqual(merged[1], existing[1]);
  assert.notEqual(merged[1].regions, existing[1].regions);
  assert.notEqual(merged[1].regions[0], existing[1].regions[0]);
  assert.notEqual(merged[2], incoming[1]);
  assert.notEqual(merged[2].regions, incoming[1].regions);
  assert.notEqual(merged[2].regions[0], incoming[1].regions[0]);
  assert.deepEqual(existing, existingSnapshot);
  assert.deepEqual(incoming, incomingSnapshot);
});

test('merge preserves existing canvas dimensions when incoming omits them or has invalid values', () => {
  const existing = [{
    id: 'v2',
    sourceVersionId: 'v1',
    createdAt: 200,
    status: 'generating',
    canvasWidth: 1200,
    canvasHeight: 1600,
    regions: [createRegion(0)],
  }];

  const omitted = mergeTranslationEditVersions(existing, [{
    id: 'v2',
    status: 'generating',
    regions: [createRegion(0, { instruction: 'Incoming copy' })],
  }]);
  assert.equal(omitted[0].canvasWidth, 1200);
  assert.equal(omitted[0].canvasHeight, 1600);

  const invalid = mergeTranslationEditVersions(existing, [{
    id: 'v2',
    status: 'generating',
    canvasWidth: -1,
    canvasHeight: Number.NaN,
    regions: [createRegion(0, { instruction: 'Incoming copy' })],
  }]);
  assert.equal(invalid[0].canvasWidth, 1200);
  assert.equal(invalid[0].canvasHeight, 1600);
});

test('translation edit version merge deeply clones regions and output mutations do not pollute inputs', () => {
  const existing = [{
    id: 'v1', imageUrl: 'v1.png', createdAt: 100, status: 'completed',
    regions: [createRegion(0, { instruction: 'Original region' })],
  }];
  const incoming = [{
    id: 'v2', imageUrl: 'v2.png', sourceVersionId: 'v1', createdAt: 200, status: 'completed',
    regions: [createRegion(0, { instruction: 'Incoming region' })],
  }];

  const merged = mergeTranslationEditVersions(existing, incoming);

  assert.notEqual(merged, existing);
  assert.notEqual(merged[0], existing[0]);
  assert.notEqual(merged[0].regions, existing[0].regions);
  assert.notEqual(merged[0].regions[0], existing[0].regions[0]);
  assert.notEqual(merged[1], incoming[0]);
  assert.notEqual(merged[1].regions, incoming[0].regions);
  assert.notEqual(merged[1].regions[0], incoming[0].regions[0]);

  merged[0].regions[0].instruction = 'Mutated existing output';
  merged[1].regions[0].instruction = 'Mutated incoming output';
  assert.equal(existing[0].regions[0].instruction, 'Original region');
  assert.equal(incoming[0].regions[0].instruction, 'Incoming region');
});

test('completed protected versions discard raw pending protection urls during persistence merge', () => {
  const merged = mergeTranslationEditVersions([{
    id: 'v2',
    sourceVersionId: 'v1',
    createdAt: 200,
    status: 'generating',
    regions: [createRegion(0)],
    pendingProtectedSourceUrl: 'https://provider.example.com/raw-v2.png',
  }], [{
    id: 'v2',
    sourceVersionId: 'v1',
    createdAt: 200,
    status: 'completed',
    regions: [createRegion(0)],
    imageUrl: '/api/assets/file/protected-v2.png',
  }]);

  assert.equal(merged[0].status, 'completed');
  assert.equal(merged[0].imageUrl, '/api/assets/file/protected-v2.png');
  assert.equal(merged[0].pendingProtectedSourceUrl, undefined);
});

test('error edit versions reject stale generating resurrection while filling missing identity', () => {
  const merged = mergeTranslationEditVersions([{
    id: 'v2', sourceVersionId: 'v1', createdAt: 200, status: 'error', error: 'cancelled',
    imageUrl: '/protected/final-v2.png', regions: [createRegion(0)],
  }], [{
    id: 'v2', sourceVersionId: 'v1', createdAt: 100, status: 'generating', error: 'stale error',
    imageUrl: '/raw/stale-v2.png', regions: [createRegion(0, { instruction: 'stale' })],
    backendJobId: 'late-backend', taskId: 'late-provider', creditsConsumed: 2.5,
  }]);

  assert.equal(merged[0].status, 'error');
  assert.equal(merged[0].error, 'cancelled');
  assert.equal(merged[0].imageUrl, '/protected/final-v2.png');
  assert.equal(merged[0].regions[0].instruction, 'Edit region 1');
  assert.equal(merged[0].backendJobId, 'late-backend');
  assert.equal(merged[0].taskId, 'late-provider');
  assert.equal(merged[0].creditsConsumed, 2.5);
});

test('latest completed translation edit url ignores later incomplete versions and falls back to the result url', () => {
  assert.equal(getLatestCompletedTranslationEditVersionUrl({
    imageUrl: 'legacy.png',
    translationEditVersions: [
      { id: 'v1', imageUrl: 'v1.png', status: 'completed', regions: [] },
      { id: 'v2', imageUrl: 'v2.png', status: 'completed', regions: [] },
      { id: 'v3', status: 'error', regions: [] },
    ],
  }), 'v2.png');
  assert.equal(getLatestCompletedTranslationEditVersionUrl({ resultUrl: 'legacy-result.png' }), 'legacy-result.png');
});

test('translation batch files and generated results copy version history in both directions', () => {
  const versions = [
    {
      id: 'v1', imageUrl: 'v1.png', createdAt: 100, status: 'completed',
      regions: [createRegion(0, { instruction: 'Input copy' })],
    },
    { id: 'v2', imageUrl: 'v2.png', sourceVersionId: 'v1', createdAt: 200, status: 'completed', regions: [] },
  ];

  const resultFields = translationEditFileToResultFields({
    resultUrl: 'v1.png',
    translationEditVersions: versions,
  });
  const fileFields = translationEditResultToFileFields({
    imageUrl: 'v1.png',
    translationEditVersions: versions,
  });

  assert.deepEqual(resultFields, { imageUrl: 'v2.png', translationEditVersions: versions });
  assert.deepEqual(fileFields, { resultUrl: 'v2.png', translationEditVersions: versions });
  assert.notEqual(resultFields.translationEditVersions, versions);
  assert.notEqual(fileFields.translationEditVersions, versions);
  assert.notEqual(resultFields.translationEditVersions[0], versions[0]);
  assert.notEqual(fileFields.translationEditVersions[0], versions[0]);
  assert.notEqual(resultFields.translationEditVersions[0].regions, versions[0].regions);
  assert.notEqual(fileFields.translationEditVersions[0].regions, versions[0].regions);
  assert.notEqual(resultFields.translationEditVersions[0].regions[0], versions[0].regions[0]);
  assert.notEqual(fileFields.translationEditVersions[0].regions[0], versions[0].regions[0]);

  resultFields.translationEditVersions[0].regions[0].instruction = 'Mutated result mapping';
  fileFields.translationEditVersions[0].regions[0].instruction = 'Mutated file mapping';
  assert.equal(versions[0].regions[0].instruction, 'Input copy');
});

test('copy file and result fields preserve initial canvas metadata and version canvas dimensions', () => {
  const versions = [
    {
      id: 'v1',
      imageUrl: 'v1.png',
      createdAt: 100,
      status: 'completed',
      canvasWidth: 1200,
      canvasHeight: 1600,
      regions: [createRegion(0, { instruction: 'Input copy' })],
    },
  ];

  const resultFields = translationEditFileToResultFields({
    resultUrl: 'v1.png',
    initialCanvasWidth: 1200,
    initialCanvasHeight: 1600,
    translationEditVersions: versions,
  });
  const fileFields = translationEditResultToFileFields({
    imageUrl: 'v1.png',
    initialCanvasWidth: 1200,
    initialCanvasHeight: 1600,
    translationEditVersions: versions,
  });

  assert.deepEqual(resultFields, {
    imageUrl: 'v1.png',
    initialCanvasWidth: 1200,
    initialCanvasHeight: 1600,
    translationEditVersions: versions,
  });
  assert.deepEqual(fileFields, {
    resultUrl: 'v1.png',
    initialCanvasWidth: 1200,
    initialCanvasHeight: 1600,
    translationEditVersions: versions,
  });
  assert.notEqual(resultFields.translationEditVersions[0], versions[0]);
  assert.notEqual(fileFields.translationEditVersions[0], versions[0]);
  assert.equal(resultFields.translationEditVersions[0].canvasWidth, 1200);
  assert.equal(resultFields.translationEditVersions[0].canvasHeight, 1600);
  assert.equal(fileFields.translationEditVersions[0].canvasWidth, 1200);
  assert.equal(fileFields.translationEditVersions[0].canvasHeight, 1600);
});
