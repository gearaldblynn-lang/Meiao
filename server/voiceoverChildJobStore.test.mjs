import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildVoiceoverChildJobId,
  createVoiceoverChildJobLedger,
  deriveVoiceoverRetryPlan,
  isParentOwnedChildJob,
  normalizeVoiceoverRetryRequestBody,
  persistLocalVoiceoverParentCheckpoint,
  persistMysqlVoiceoverParentCheckpoint,
  prepareVoiceoverJobRetryResult,
} from './voiceoverChildJobStore.mjs';

const validParentPayload = (overrides = {}) => ({
  taskPurpose: 'voiceover_translation',
  userId: 'user-1',
  sourceAssetId: 'asset-source',
  shellProjectId: 'project-1',
  shellProjectName: 'Voiceover project',
  shellResultId: 'result-1',
  clientSubmissionKey: 'parent-submission-1',
  targetLanguage: 'en',
  translationMode: 'natural',
  voiceMode: 'auto',
  removeText: false,
  ...overrides,
});

const validParent = (overrides = {}) => ({
  id: 'parent-job-1',
  userId: 'user-1',
  module: 'video',
  taskType: 'voiceover_translate_video',
  provider: 'internal',
  status: 'running',
  payload: validParentPayload(),
  result: {
    auditMarker: 'preserve-me',
    voiceoverCheckpoint: {
      version: 1,
      stage: 'input_prepared',
      baseVideoAssetId: 'asset-base',
      analysisAttempt: 0,
    },
  },
  providerTaskId: '',
  retryCount: 0,
  maxRetries: 0,
  createdAt: 1_000,
  updatedAt: 2_000,
  startedAt: 1_500,
  finishedAt: null,
  cancelRequestedAt: null,
  ...overrides,
});

const validTtsPayload = (overrides = {}) => ({
  groupIndex: 0,
  targetLanguage: 'en',
  voiceName: 'Kore',
  dialogueTurns: [{ speaker: 'Speaker 1', text: 'Translated narration.' }],
  temperature: 1,
  scene: 'Product narration',
  sampleContext: 'Natural commercial voice',
  ...overrides,
});

const validGoldenPayload = (overrides = {}) => ({
  taskPurpose: 'subtitle_removal',
  subFeature: 'voiceover_translation',
  sourceAssetId: 'asset-base',
  sourceUrl: 'managed://asset-base',
  subtitleRegionNormalized: { x: 0, y: 0.7, width: 1, height: 0.3 },
  shellProjectId: 'project-1',
  shellProjectName: 'Voiceover project',
  shellResultId: 'result-1',
  batchId: 'parent-job-1',
  batchIndex: 0,
  batchCount: 1,
  sizeBytes: 1_024,
  durationSeconds: 8,
  width: 1_920,
  height: 1_080,
  ...overrides,
});

const createLocalHarness = (jobs = [validParent()]) => {
  const store = { jobs: structuredClone(jobs) };
  let tail = Promise.resolve();
  const mutateLocalStore = (operation) => {
    const run = tail.then(() => operation(store));
    tail = run.catch(() => null);
    return run;
  };
  return {
    store,
    mutateLocalStore,
    readLocalStore: () => store,
  };
};

const createLocalLedger = (harness, overrides = {}) => createVoiceoverChildJobLedger({
  mode: 'local',
  readLocalStore: harness.readLocalStore,
  mutateLocalStore: harness.mutateLocalStore,
  now: () => 3_000,
  createJobId: (() => {
    let sequence = 0;
    return () => `child-job-${++sequence}`;
  })(),
  ...overrides,
});

test('deterministic voiceover child IDs fit the internal_jobs VARCHAR(24) contract', () => {
  const parentJobId = '90f38769e8355105dd439b5f';
  const childKeys = [
    'golden:attempt:0',
    'tts:0:attempt:0',
    'tts:0:attempt:1',
  ];
  const childJobIds = childKeys.map((childKey) => (
    buildVoiceoverChildJobId(parentJobId, childKey)
  ));

  assert.deepEqual(childJobIds, [
    '3c1fa77df45be971d6a9cebe',
    '9dba43db6e79542d72c62e6d',
    '065c6e469bbb1809a6f9aed3',
  ]);
  assert.deepEqual(
    childJobIds.map((childJobId) => childJobId.length),
    [24, 24, 24],
  );
  assert.ok(childJobIds.every((childJobId) => /^[a-f0-9]{24}$/u.test(childJobId)));
  assert.equal(
    buildVoiceoverChildJobId(parentJobId, childKeys[0]),
    childJobIds[0],
  );
  assert.equal(new Set(childJobIds).size, childJobIds.length);
  assert.notEqual(
    buildVoiceoverChildJobId('parent-job-other', childKeys[0]),
    childJobIds[0],
  );
});

test('parent ownership requires the complete server-owned child identity', () => {
  const job = {
    payload: {
      executionOwner: 'parent',
      parentJobId: 'parent-job-1',
      childKey: 'tts:0:attempt:0',
      clientSubmissionKey: 'voiceover-child:parent-job-1:tts:0:attempt:0',
    },
  };
  assert.equal(isParentOwnedChildJob(job), true);
  assert.equal(isParentOwnedChildJob({ payload: { ...job.payload, executionOwner: 'browser' } }), false);
  assert.equal(isParentOwnedChildJob({ payload: { ...job.payload, clientSubmissionKey: 'forged' } }), false);
});

test('local parent checkpoint merges atomically and preserves unrelated result fields', () => {
  const harness = createLocalHarness();
  const updated = persistLocalVoiceoverParentCheckpoint(harness.store, {
    jobId: 'parent-job-1',
    userId: 'user-1',
    startedAt: 1_500,
    resultPatch: {
      voiceoverCheckpoint: {
        stage: 'audio_extracted',
        originalAudioAssetId: 'asset-audio',
      },
    },
    env: {},
  });
  assert.equal(updated.status, 'running');
  assert.equal(updated.result.auditMarker, 'preserve-me');
  assert.equal(updated.result.voiceoverCheckpoint.stage, 'audio_extracted');
  assert.equal(updated.result.voiceoverCheckpoint.originalAudioAssetId, 'asset-audio');
});

test('local parent checkpoint rejects stale claims, wrong users, and invalid regressions before mutation', () => {
  for (const overrides of [
    { userId: 'user-other' },
    { startedAt: 1_499 },
  ]) {
    const harness = createLocalHarness();
    assert.throws(
      () => persistLocalVoiceoverParentCheckpoint(harness.store, {
        jobId: 'parent-job-1',
        userId: overrides.userId || 'user-1',
        startedAt: overrides.startedAt ?? 1_500,
        resultPatch: { voiceoverCheckpoint: { stage: 'audio_extracted', originalAudioAssetId: 'asset-audio' } },
        env: {},
      }),
      (error) => error.code === 'job_state_changed',
    );
    assert.equal(harness.store.jobs[0].result.voiceoverCheckpoint.stage, 'input_prepared');
  }

  const harness = createLocalHarness();
  assert.throws(
    () => persistLocalVoiceoverParentCheckpoint(harness.store, {
      jobId: 'parent-job-1',
      userId: 'user-1',
      startedAt: 1_500,
      resultPatch: { voiceoverCheckpoint: { stage: 'input_prepared', baseVideoAssetId: 'asset-replaced' } },
      env: {},
    }),
    (error) => error.code === 'voiceover_checkpoint_invalid',
  );
  assert.equal(harness.store.jobs[0].result.voiceoverCheckpoint.baseVideoAssetId, 'asset-base');
});

test('mysql parent checkpoint uses the exact running claim guard and requires one affected row', async () => {
  const parent = validParent();
  const calls = [];
  let currentResult = structuredClone(parent.result);
  const connection = {
    async beginTransaction() { calls.push({ sql: 'BEGIN', params: [] }); },
    async commit() { calls.push({ sql: 'COMMIT', params: [] }); },
    async rollback() { calls.push({ sql: 'ROLLBACK', params: [] }); },
    release() { calls.push({ sql: 'RELEASE_CONNECTION', params: [] }); },
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (/SELECT \* FROM internal_jobs/.test(sql)) {
        return [[{
          id: parent.id,
          user_id: parent.userId,
          module: parent.module,
          task_type: parent.taskType,
          provider: parent.provider,
          status: parent.status,
          payload_json: JSON.stringify(parent.payload),
          result_json: JSON.stringify(currentResult),
          started_at: parent.startedAt,
        }]];
      }
      if (/UPDATE internal_jobs/.test(sql)) {
        currentResult = JSON.parse(params[0]);
        return [{ affectedRows: 1 }];
      }
      throw new Error(`Unhandled SQL: ${sql}`);
    },
  };
  const pool = { async getConnection() { return connection; } };

  const updated = await persistMysqlVoiceoverParentCheckpoint({
    pool,
    jobId: parent.id,
    userId: parent.userId,
    startedAt: parent.startedAt,
    resultPatch: {
      voiceoverCheckpoint: {
        stage: 'audio_extracted',
        originalAudioAssetId: 'asset-audio',
      },
    },
    env: {},
    now: () => 3_000,
  });

  assert.equal(updated.result.voiceoverCheckpoint.stage, 'audio_extracted');
  assert.equal(updated.result.auditMarker, 'preserve-me');
  const update = calls.find((call) => /UPDATE internal_jobs/.test(call.sql));
  assert.match(update.sql, /WHERE id = \? AND user_id = \? AND status = 'running' AND started_at = \?/);
  assert.deepEqual(update.params.slice(-3), [parent.id, parent.userId, parent.startedAt]);

  connection.query = async (sql) => {
    if (/SELECT \* FROM internal_jobs/.test(sql)) {
      return [[{
        id: parent.id,
        user_id: parent.userId,
        module: parent.module,
        task_type: parent.taskType,
        provider: parent.provider,
        status: parent.status,
        payload_json: JSON.stringify(parent.payload),
        result_json: JSON.stringify(currentResult),
        started_at: parent.startedAt,
      }]];
    }
    if (/UPDATE internal_jobs/.test(sql)) return [{ affectedRows: 0 }];
    return [];
  };
  await assert.rejects(
    persistMysqlVoiceoverParentCheckpoint({
      pool,
      jobId: parent.id,
      userId: parent.userId,
      startedAt: parent.startedAt,
      resultPatch: { voiceoverCheckpoint: { stage: 'audio_extracted' } },
      env: {},
    }),
    (error) => error.code === 'job_state_changed',
  );
});

test('local ledger creates initial TTS identity once across rebuild and concurrent calls', async () => {
  const harness = createLocalHarness();
  const input = {
    parentJob: validParent(),
    childKey: 'tts:0:attempt:0',
    taskType: 'kie_tts',
    provider: 'kie',
    payload: validTtsPayload(),
  };
  const ledger = createLocalLedger(harness);
  const [first, concurrent] = await Promise.all([
    ledger.getOrCreate(input),
    ledger.getOrCreate(input),
  ]);
  const rebuilt = createLocalLedger(harness);
  const afterRestart = await rebuilt.getOrCreate(input);

  assert.equal(first.id, concurrent.id);
  assert.equal(first.id, afterRestart.id);
  assert.equal(harness.store.jobs.filter((job) => isParentOwnedChildJob(job)).length, 1);
  assert.equal(first.status, 'running');
  assert.equal(first.maxRetries, 0);
  assert.equal(first.userId, 'user-1');
  assert.equal(first.module, 'video');
  assert.deepEqual({
    executionOwner: first.payload.executionOwner,
    parentJobId: first.payload.parentJobId,
    childKey: first.payload.childKey,
    clientSubmissionKey: first.payload.clientSubmissionKey,
  }, {
    executionOwner: 'parent',
    parentJobId: 'parent-job-1',
    childKey: 'tts:0:attempt:0',
    clientSubmissionKey: 'voiceover-child:parent-job-1:tts:0:attempt:0',
  });
});

test('local ledger creates the initial Golden child only for a remove-text parent', async () => {
  const parent = validParent({
    payload: validParentPayload({
      removeText: true,
      subtitleRegionNormalized: { x: 0, y: 0.7, width: 1, height: 0.3 },
    }),
  });
  const harness = createLocalHarness([parent]);
  const ledger = createLocalLedger(harness);
  const child = await ledger.getOrCreate({
    parentJob: parent,
    childKey: 'golden:attempt:0',
    taskType: 'subtitle_remove_video',
    provider: 'golden_subtitle',
    payload: validGoldenPayload(),
  });
  assert.equal(child.payload.childKey, 'golden:attempt:0');
  assert.equal(child.provider, 'golden_subtitle');
});

test('ledger rejects ineligible parents, mismatched keys, unknown fields, and path leaks', async () => {
  const terminalHarness = createLocalHarness([validParent({ status: 'failed' })]);
  await assert.rejects(
    createLocalLedger(terminalHarness).getOrCreate({
      parentJob: validParent({ status: 'failed' }),
      childKey: 'tts:0:attempt:0',
      taskType: 'kie_tts',
      provider: 'kie',
      payload: validTtsPayload(),
    }),
    (error) => error.code === 'parent_job_ineligible',
  );

  const harness = createLocalHarness();
  const ledger = createLocalLedger(harness);
  for (const input of [
    {
      childKey: 'tts:1:attempt:0',
      taskType: 'kie_tts',
      provider: 'kie',
      payload: validTtsPayload({ groupIndex: 0 }),
    },
    {
      childKey: 'tts:0:attempt:0',
      taskType: 'kie_tts',
      provider: 'kie',
      payload: validTtsPayload({ unknown: true }),
    },
    {
      childKey: 'golden:attempt:0',
      taskType: 'subtitle_remove_video',
      provider: 'golden_subtitle',
      payload: validGoldenPayload({ sourceUrl: '/tmp/private.mp4' }),
    },
  ]) {
    await assert.rejects(
      ledger.getOrCreate({ parentJob: validParent(), ...input }),
      (error) => ['child_job_invalid', 'parent_job_ineligible'].includes(error.code),
    );
  }
  assert.equal(harness.store.jobs.filter((job) => isParentOwnedChildJob(job)).length, 0);
});

test('ledger rejects coercible and non-finite TTS numeric inputs before persistence', async () => {
  const invalidGroupIndexes = ['0', '1', null, true, false, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];
  for (const groupIndex of invalidGroupIndexes) {
    const harness = createLocalHarness();
    const ledger = createLocalLedger(harness);
    await assert.rejects(
      ledger.getOrCreate({
        parentJob: validParent(),
        childKey: 'tts:0:attempt:0',
        taskType: 'kie_tts',
        provider: 'kie',
        payload: validTtsPayload({ groupIndex }),
      }),
      (error) => error.code === 'child_job_invalid',
      `groupIndex=${String(groupIndex)}`,
    );
    assert.equal(harness.store.jobs.length, 1);
  }

  const invalidTemperatures = ['1', null, true, false, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];
  for (const temperature of invalidTemperatures) {
    const harness = createLocalHarness();
    const ledger = createLocalLedger(harness);
    await assert.rejects(
      ledger.getOrCreate({
        parentJob: validParent(),
        childKey: 'tts:0:attempt:0',
        taskType: 'kie_tts',
        provider: 'kie',
        payload: validTtsPayload({ temperature }),
      }),
      (error) => error.code === 'child_job_invalid',
      `temperature=${String(temperature)}`,
    );
    assert.equal(harness.store.jobs.length, 1);
  }
});

test('ledger rejects coercible and non-finite Golden numeric inputs before persistence', async () => {
  const invalidNumbers = ['1', null, true, false, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];
  const cases = [
    ['subtitleRegionNormalized.x', (value) => ({
      subtitleRegionNormalized: { x: value, y: 0.7, width: 1, height: 0.3 },
    })],
    ['subtitleRegionNormalized.y', (value) => ({
      subtitleRegionNormalized: { x: 0, y: value, width: 1, height: 0.3 },
    })],
    ['subtitleRegionNormalized.width', (value) => ({
      subtitleRegionNormalized: { x: 0, y: 0.7, width: value, height: 0.3 },
    })],
    ['subtitleRegionNormalized.height', (value) => ({
      subtitleRegionNormalized: { x: 0, y: 0.7, width: 1, height: value },
    })],
    ['batchIndex', (value) => ({ batchIndex: value })],
    ['batchCount', (value) => ({ batchCount: value })],
    ['sizeBytes', (value) => ({ sizeBytes: value })],
    ['durationSeconds', (value) => ({ durationSeconds: value })],
    ['width', (value) => ({ width: value })],
    ['height', (value) => ({ height: value })],
  ];
  for (const [field, buildOverride] of cases) {
    for (const invalid of invalidNumbers) {
      const parent = validParent({
        payload: validParentPayload({ removeText: true }),
      });
      const harness = createLocalHarness([parent]);
      const ledger = createLocalLedger(harness);
      await assert.rejects(
        ledger.getOrCreate({
          parentJob: parent,
          childKey: 'golden:attempt:0',
          taskType: 'subtitle_remove_video',
          provider: 'golden_subtitle',
          payload: validGoldenPayload(buildOverride(invalid)),
        }),
        (error) => error.code === 'child_job_invalid',
        `${field}=${String(invalid)}`,
      );
      assert.equal(harness.store.jobs.length, 1);
    }
  }
});

test('provider task id is immutable and failed children retain stable audit metadata', async () => {
  const harness = createLocalHarness();
  const ledger = createLocalLedger(harness);
  const child = await ledger.getOrCreate({
    parentJob: validParent(),
    childKey: 'tts:0:attempt:0',
    taskType: 'kie_tts',
    provider: 'kie',
    payload: validTtsPayload(),
  });
  const checkpointed = await ledger.checkpointProviderTaskId(child.id, 'provider-tts-1');
  assert.equal(checkpointed.providerTaskId, 'provider-tts-1');
  assert.equal((await ledger.checkpointProviderTaskId(child.id, 'provider-tts-1')).providerTaskId, 'provider-tts-1');
  await assert.rejects(
    ledger.checkpointProviderTaskId(child.id, 'provider-tts-other'),
    (error) => error.code === 'provider_task_id_immutable',
  );
  const failed = await ledger.markFailed(child.id, Object.assign(new Error('upstream failed'), {
    code: 'provider_bad_response',
    providerStatus: 'fail',
  }));
  assert.equal(failed.status, 'failed');
  assert.equal(failed.providerTaskId, 'provider-tts-1');
  assert.equal(failed.errorCode, 'provider_bad_response');
  assert.equal((await ledger.getOrCreate({
    parentJob: validParent(),
    childKey: 'tts:0:attempt:0',
    taskType: 'kie_tts',
    provider: 'kie',
    payload: validTtsPayload(),
  })).id, child.id);
});

test('child success accepts only managed and scrubbed outputs', async () => {
  const harness = createLocalHarness();
  const ledger = createLocalLedger(harness);
  const tts = await ledger.getOrCreate({
    parentJob: validParent(),
    childKey: 'tts:0:attempt:0',
    taskType: 'kie_tts',
    provider: 'kie',
    payload: validTtsPayload(),
  });
  await assert.rejects(
    ledger.markSucceeded(tts.id, {
      assetId: 'asset-tts-1',
      audioUrl: 'https://provider.example/audio.mp3?signature=secret',
    }),
    (error) => error.code === 'child_output_unmanaged',
  );
  await assert.rejects(
    ledger.markSucceeded(tts.id, {
      assetId: 'asset-tts-1',
      audioUrl: '/api/assets/file/asset-tts-1',
      durationMs: '1000',
    }),
    (error) => error.code === 'child_output_unmanaged',
  );
  const succeeded = await ledger.markSucceeded(tts.id, {
    assetId: 'asset-tts-1',
    audioUrl: '/api/assets/file/asset-tts-1',
    durationMs: 1_000,
  });
  assert.equal(succeeded.status, 'succeeded');
  assert.deepEqual(succeeded.result, {
    assetId: 'asset-tts-1',
    audioUrl: 'managed://asset-tts-1',
    durationMs: 1_000,
  });

  const goldenParent = validParent({
    payload: validParentPayload({ removeText: true }),
  });
  const goldenHarness = createLocalHarness([goldenParent]);
  const goldenLedger = createLocalLedger(goldenHarness);
  const golden = await goldenLedger.getOrCreate({
    parentJob: goldenParent,
    childKey: 'golden:attempt:0',
    taskType: 'subtitle_remove_video',
    provider: 'golden_subtitle',
    payload: validGoldenPayload(),
  });
  await assert.rejects(
    goldenLedger.markSucceeded(golden.id, {
      assetId: 'asset-video-1',
      videoUrl: '/api/assets/file/asset-video-1',
      durationMs: '8000',
    }),
    (error) => error.code === 'child_output_unmanaged',
  );
  const goldenSucceeded = await goldenLedger.markSucceeded(golden.id, {
    assetId: 'asset-video-1',
    videoUrl: '/api/assets/file/asset-video-1',
    durationMs: 8_000,
  });
  assert.equal(goldenSucceeded.status, 'succeeded');
  assert.deepEqual(goldenSucceeded.result, {
    assetId: 'asset-video-1',
    resultAssetId: 'asset-video-1',
    videoUrl: 'managed://asset-video-1',
    durationMs: 8_000,
  });
});

test('absolute managed asset URLs normalize to stable identities for Golden source and child outputs', async () => {
  const goldenParent = validParent({
    payload: validParentPayload({ removeText: true }),
  });
  const goldenHarness = createLocalHarness([goldenParent]);
  const goldenLedger = createLocalLedger(goldenHarness);
  const golden = await goldenLedger.getOrCreate({
    parentJob: goldenParent,
    childKey: 'golden:attempt:0',
    taskType: 'subtitle_remove_video',
    provider: 'golden_subtitle',
    payload: validGoldenPayload({
      sourceUrl: 'https://meiao.example/api/assets/file/asset-base/source.mp4',
    }),
  });
  assert.equal(golden.payload.sourceUrl, 'managed://asset-base');

  const goldenSucceeded = await goldenLedger.markSucceeded(golden.id, {
    assetId: 'asset-video-1',
    videoUrl: 'https://meiao.example/api/assets/file/asset-video-1/result.mp4',
    durationMs: 8_000,
  });
  assert.deepEqual(goldenSucceeded.result, {
    assetId: 'asset-video-1',
    resultAssetId: 'asset-video-1',
    videoUrl: 'managed://asset-video-1',
    durationMs: 8_000,
  });

  const ttsHarness = createLocalHarness();
  const ttsLedger = createLocalLedger(ttsHarness);
  const tts = await ttsLedger.getOrCreate({
    parentJob: validParent(),
    childKey: 'tts:0:attempt:0',
    taskType: 'kie_tts',
    provider: 'kie',
    payload: validTtsPayload(),
  });
  const ttsSucceeded = await ttsLedger.markSucceeded(tts.id, {
    assetId: 'asset-tts-1',
    audioUrl: 'http://127.0.0.1:3000/api/assets/file/asset-tts-1/audio.mp3',
    durationMs: 1_000,
  });
  assert.deepEqual(ttsSucceeded.result, {
    assetId: 'asset-tts-1',
    audioUrl: 'managed://asset-tts-1',
    durationMs: 1_000,
  });
});

test('managed identity validation rejects external, credentialed, signed, fragmented, and mismatched URLs', async () => {
  const invalidOutputUrls = [
    'https://provider.example/audio.mp3',
    'https://meiao.example/api/assets/file/asset-other/audio.mp3',
    'https://user:pass@meiao.example/api/assets/file/asset-tts-1/audio.mp3',
    'https://meiao.example/api/assets/file/asset-tts-1/audio.mp3?signature=secret',
    'https://meiao.example/api/assets/file/asset-tts-1/audio.mp3#fragment',
  ];
  for (const audioUrl of invalidOutputUrls) {
    const harness = createLocalHarness();
    const ledger = createLocalLedger(harness);
    const child = await ledger.getOrCreate({
      parentJob: validParent(),
      childKey: 'tts:0:attempt:0',
      taskType: 'kie_tts',
      provider: 'kie',
      payload: validTtsPayload(),
    });
    await assert.rejects(
      ledger.markSucceeded(child.id, {
        assetId: 'asset-tts-1',
        audioUrl,
        durationMs: 1_000,
      }),
      (error) => error?.code === 'child_output_unmanaged',
      audioUrl,
    );
  }

  for (const sourceUrl of [
    'https://provider.example/source.mp4',
    'https://meiao.example/api/assets/file/asset-other/source.mp4',
    'https://user:pass@meiao.example/api/assets/file/asset-base/source.mp4',
    'https://meiao.example/api/assets/file/asset-base/source.mp4?signature=secret',
    'https://meiao.example/api/assets/file/asset-base/source.mp4#fragment',
  ]) {
    const parent = validParent({ payload: validParentPayload({ removeText: true }) });
    const harness = createLocalHarness([parent]);
    const ledger = createLocalLedger(harness);
    await assert.rejects(
      ledger.getOrCreate({
        parentJob: parent,
        childKey: 'golden:attempt:0',
        taskType: 'subtitle_remove_video',
        provider: 'golden_subtitle',
        payload: validGoldenPayload({ sourceUrl }),
      }),
      (error) => error?.code === 'child_job_invalid',
      sourceUrl,
    );
  }
});

test('retry request accepts only the server-owned confirmation bit', () => {
  assert.deepEqual(normalizeVoiceoverRetryRequestBody({}), {
    confirmNewProviderAttempt: false,
  });
  assert.deepEqual(normalizeVoiceoverRetryRequestBody({
    confirmNewProviderAttempt: true,
  }), {
    confirmNewProviderAttempt: true,
  });
  assert.throws(
    () => normalizeVoiceoverRetryRequestBody({
      confirmNewProviderAttempt: true,
      kind: 'reuse',
    }),
    (error) => error?.code === 'voiceover_retry_invalid',
  );
  assert.throws(
    () => normalizeVoiceoverRetryRequestBody({
      confirmNewProviderAttempt: 'true',
    }),
    (error) => error?.code === 'voiceover_retry_invalid',
  );
});

test('server derives Golden retry target and deterministic next child identity from the checkpoint', async () => {
  const failedParent = validParent({
    status: 'failed',
    errorCode: 'provider_job_failed',
    payload: validParentPayload({ removeText: true }),
    result: {
      auditMarker: 'preserve-me',
      voiceoverCheckpoint: {
        version: 1,
        stage: 'subtitle_removal',
        baseVideoAssetId: 'asset-base',
        subtitleRemoval: {
          childJobId: 'golden-child-0',
          attempt: 0,
          status: 'failed',
        },
        analysisAttempt: 0,
      },
    },
  });
  const unconfirmed = deriveVoiceoverRetryPlan(failedParent, {
    confirmNewProviderAttempt: false,
  });
  assert.deepEqual(unconfirmed, {
    kind: 'provider',
    target: 'golden',
    userConfirmed: false,
    nextChildJobId: buildVoiceoverChildJobId(failedParent.id, 'golden:attempt:1'),
  });
  assert.throws(
    () => prepareVoiceoverJobRetryResult(failedParent, unconfirmed),
    (error) => error?.code === 'voiceover_retry_confirmation_required',
  );

  const confirmed = deriveVoiceoverRetryPlan(failedParent, {
    confirmNewProviderAttempt: true,
  });
  const retryResult = prepareVoiceoverJobRetryResult(failedParent, confirmed);
  assert.equal(
    retryResult.voiceoverCheckpoint.subtitleRemoval.childJobId,
    confirmed.nextChildJobId,
  );

  const runningParent = {
    ...failedParent,
    status: 'running',
    errorCode: '',
    result: retryResult,
  };
  const harness = createLocalHarness([runningParent]);
  const ledger = createVoiceoverChildJobLedger({
    mode: 'local',
    readLocalStore: harness.readLocalStore,
    mutateLocalStore: harness.mutateLocalStore,
    now: () => 4_000,
  });
  const child = await ledger.getOrCreate({
    parentJob: runningParent,
    childKey: 'golden:attempt:1',
    taskType: 'subtitle_remove_video',
    provider: 'golden_subtitle',
    payload: validGoldenPayload({
      batchId: runningParent.id,
    }),
  });
  assert.equal(child.id, confirmed.nextChildJobId);

  const submissionUnknownParent = {
    ...failedParent,
    errorCode: 'provider_submission_unknown',
  };
  const submissionUnknownUnconfirmed = deriveVoiceoverRetryPlan(
    submissionUnknownParent,
    { confirmNewProviderAttempt: false },
  );
  assert.throws(
    () => prepareVoiceoverJobRetryResult(
      submissionUnknownParent,
      submissionUnknownUnconfirmed,
    ),
    (error) => error?.code === 'voiceover_retry_confirmation_required',
  );
  const submissionUnknownConfirmed = deriveVoiceoverRetryPlan(
    submissionUnknownParent,
    { confirmNewProviderAttempt: true },
  );
  assert.equal(
    prepareVoiceoverJobRetryResult(
      submissionUnknownParent,
      submissionUnknownConfirmed,
    ).voiceoverCheckpoint.subtitleRemoval.attempt,
    1,
  );
});

test('server derives analysis and query-only retry plans without trusting parent provider state', () => {
  const analysisParent = validParent({
    status: 'failed',
    errorCode: 'voiceover_analysis_submission_unknown',
    result: {
      voiceoverCheckpoint: {
        version: 1,
        stage: 'speech_analysis_submitting',
        baseVideoAssetId: 'asset-base',
        originalAudioAssetId: 'asset-audio',
        vocalAssetId: 'asset-vocal',
        backgroundAssetId: 'asset-background',
        analysisAttempt: 0,
      },
    },
  });
  assert.deepEqual(deriveVoiceoverRetryPlan(analysisParent, {
    confirmNewProviderAttempt: true,
  }), {
    kind: 'analysis',
    userConfirmed: true,
  });
  const configFailedParent = {
    ...analysisParent,
    errorCode: 'provider_config_error',
  };
  const invalidAnalysisParent = {
    ...analysisParent,
    errorCode: 'voiceover_analysis_invalid',
  };
  const invalidAnalysisRetry = deriveVoiceoverRetryPlan(invalidAnalysisParent, {
    confirmNewProviderAttempt: true,
  });
  assert.deepEqual(invalidAnalysisRetry, {
    kind: 'analysis',
    userConfirmed: true,
  });
  const invalidAnalysisRetryResult = prepareVoiceoverJobRetryResult(
    invalidAnalysisParent,
    invalidAnalysisRetry,
  );
  assert.equal(invalidAnalysisRetryResult.voiceoverCheckpoint.stage, 'voice_separated');
  assert.equal(invalidAnalysisRetryResult.voiceoverCheckpoint.analysisAttempt, 1);
  const unconfirmedConfigRetry = deriveVoiceoverRetryPlan(configFailedParent, {
    confirmNewProviderAttempt: false,
  });
  assert.deepEqual(unconfirmedConfigRetry, {
    kind: 'analysis',
    userConfirmed: false,
  });
  assert.throws(
    () => prepareVoiceoverJobRetryResult(configFailedParent, unconfirmedConfigRetry),
    (error) => error?.code === 'voiceover_analysis_submission_unknown',
  );
  const confirmedConfigRetry = deriveVoiceoverRetryPlan(configFailedParent, {
    confirmNewProviderAttempt: true,
  });
  const configRetryResult = prepareVoiceoverJobRetryResult(
    configFailedParent,
    confirmedConfigRetry,
  );
  assert.equal(configRetryResult.voiceoverCheckpoint.stage, 'voice_separated');
  assert.equal(configRetryResult.voiceoverCheckpoint.analysisAttempt, 1);
  const mediaReadFailedParent = {
    ...analysisParent,
    errorCode: 'provider_bad_response',
  };
  const confirmedMediaReadRetry = deriveVoiceoverRetryPlan(mediaReadFailedParent, {
    confirmNewProviderAttempt: true,
  });
  const mediaReadRetryResult = prepareVoiceoverJobRetryResult(
    mediaReadFailedParent,
    confirmedMediaReadRetry,
  );
  assert.deepEqual(confirmedMediaReadRetry, {
    kind: 'analysis',
    userConfirmed: true,
  });
  assert.equal(mediaReadRetryResult.voiceoverCheckpoint.stage, 'voice_separated');
  assert.equal(mediaReadRetryResult.voiceoverCheckpoint.analysisAttempt, 1);

  const ttsQueryFailedParent = validParent({
    status: 'failed',
    errorCode: 'provider_bad_response',
    providerTaskId: 'tts-provider-0',
    result: {
      voiceoverCheckpoint: {
        version: 1,
        stage: 'tts_generating',
        baseVideoAssetId: 'asset-base',
        originalAudioAssetId: 'asset-audio',
        vocalAssetId: 'asset-vocal',
        backgroundAssetId: 'asset-background',
        analysisAttempt: 1,
        analysis: {
          sourceLanguage: 'en',
          speakerCount: 1,
          voiceProfile: {
            pitch: 'medium',
            brightness: 'balanced',
            energy: 'balanced',
            pace: 'natural',
            accentDescription: 'Neutral',
          },
          segments: [{
            id: 'seg-1',
            startMs: 0,
            endMs: 1_000,
            sourceText: 'Hello',
            targetText: '你好',
          }],
        },
        translation: {
          targetLanguage: 'en',
          mode: 'natural',
          selectedVoiceName: 'Kore',
          segments: [{
            id: 'seg-1',
            startMs: 0,
            endMs: 1_000,
            sourceText: 'Hello',
            targetText: '你好',
          }],
        },
        ttsGroups: [{
          index: 0,
          attempt: 0,
          childJobId: 'tts-child-0',
          providerTaskId: 'tts-provider-0',
          status: 'submitted',
          startMs: 0,
          endMs: 1_000,
        }],
      },
    },
  });
  assert.deepEqual(deriveVoiceoverRetryPlan(ttsQueryFailedParent, {
    confirmNewProviderAttempt: false,
  }), {
    kind: 'reuse',
  });

  const queryOnlyParent = validParent({
    status: 'cancelled',
    errorCode: 'request_cancelled',
    providerTaskId: '',
    payload: validParentPayload({ removeText: true }),
    result: {
      voiceoverCheckpoint: {
        version: 1,
        stage: 'subtitle_removal',
        baseVideoAssetId: 'asset-base',
        subtitleRemoval: {
          childJobId: 'golden-child-0',
          providerTaskId: 'golden-provider-0',
          attempt: 0,
          status: 'submitted',
        },
        analysisAttempt: 0,
      },
    },
  });
  assert.deepEqual(deriveVoiceoverRetryPlan(queryOnlyParent, {
    confirmNewProviderAttempt: false,
  }), {
    kind: 'reuse',
  });
});

test('voiceover parent in provider recovery manual state rejects ordinary retry', () => {
  const parent = validParent({
    status: 'failed',
    providerTaskId: 'provider-golden-manual',
    errorCode: 'provider_recovery_manual',
    payload: validParentPayload({ removeText: true }),
    result: {
      voiceoverCheckpoint: {
        version: 1,
        stage: 'input_prepared',
        baseVideoAssetId: 'asset-source',
        analysisAttempt: 0,
      },
    },
  });

  assert.throws(
    () => deriveVoiceoverRetryPlan(parent),
    (error) => error?.code === 'provider_recovery_manual',
  );
});

const createMysqlLedgerHarness = ({ failInsert = false } = {}) => {
  const parent = validParent();
  const rows = [];
  const calls = [];
  let locked = false;
  const waiters = [];
  const acquire = async () => {
    if (!locked) {
      locked = true;
      return;
    }
    await new Promise((resolve) => waiters.push(resolve));
    locked = true;
  };
  const release = () => {
    locked = false;
    waiters.shift()?.();
  };
  const pool = {
    async getConnection() {
      return {
        release() { calls.push({ sql: 'RELEASE_CONNECTION', params: [] }); },
        async query(sql, params = []) {
          calls.push({ sql, params });
          if (/SELECT GET_LOCK/.test(sql)) {
            await acquire();
            return [[{ acquired: 1 }]];
          }
          if (/SELECT RELEASE_LOCK/.test(sql)) {
            release();
            return [[{ released: 1 }]];
          }
          if (/SELECT \* FROM internal_jobs[\s\S]+id = \?[\s\S]+user_id = \?/.test(sql)) {
            return [[{
              id: parent.id,
              user_id: parent.userId,
              module: parent.module,
              task_type: parent.taskType,
              provider: parent.provider,
              status: parent.status,
              payload_json: JSON.stringify(parent.payload),
              result_json: JSON.stringify(parent.result),
              retry_count: 0,
              max_retries: 0,
              created_at: parent.createdAt,
              updated_at: parent.updatedAt,
              started_at: parent.startedAt,
              finished_at: null,
              cancel_requested_at: null,
            }]];
          }
          if (/JSON_UNQUOTE\(JSON_EXTRACT\(payload_json, '\$\.clientSubmissionKey'\)\) = \?/.test(sql)) {
            return [[...rows]];
          }
          if (/INSERT INTO internal_jobs/.test(sql)) {
            if (failInsert) throw new Error('insert failed');
            rows.push({
              id: params[0],
              user_id: params[1],
              module: params[2],
              task_type: params[3],
              provider: params[4],
              status: params[5],
              priority: params[6],
              payload_json: params[7],
              provider_task_id: params[8],
              result_json: params[9],
              error_code: params[10],
              error_message: params[11],
              retry_count: params[12],
              max_retries: params[13],
              created_at: params[14],
              updated_at: params[15],
              started_at: params[16],
              finished_at: params[17],
              cancel_requested_at: params[18],
            });
            return [{ affectedRows: 1 }];
          }
          throw new Error(`Unhandled SQL: ${sql}`);
        },
      };
    },
  };
  return { pool, calls, rows, release };
};

test('mysql ledger serializes concurrent creation with one connection and one insert', async () => {
  const harness = createMysqlLedgerHarness();
  const ledger = createVoiceoverChildJobLedger({
    mode: 'mysql',
    pool: harness.pool,
    now: () => 3_000,
    env: { MEIAO_JOB_SUBMISSION_LOCK_TIMEOUT_SECONDS: '7' },
  });
  const input = {
    parentJob: validParent(),
    childKey: 'tts:0:attempt:0',
    taskType: 'kie_tts',
    provider: 'kie',
    payload: validTtsPayload(),
  };

  const [first, second] = await Promise.all([ledger.getOrCreate(input), ledger.getOrCreate(input)]);
  assert.equal(first.id, second.id);
  assert.equal(first.id, '5fecb016b5b4d361282e642a');
  assert.equal(harness.rows[0].id, first.id);
  assert.equal(harness.rows.length, 1);
  const lockCalls = harness.calls.filter((call) => /GET_LOCK/.test(call.sql));
  assert.equal(lockCalls.length, 2);
  assert.equal(lockCalls[0].params[1], 7);
  assert.match(lockCalls[0].params[0], /^voiceover-child:[a-f0-9]{32}$/);
  assert.equal(harness.calls.filter((call) => /RELEASE_LOCK/.test(call.sql)).length, 2);
});

test('mysql ledger always releases its advisory lock after creation failure', async () => {
  const harness = createMysqlLedgerHarness({ failInsert: true });
  const ledger = createVoiceoverChildJobLedger({
    mode: 'mysql',
    pool: harness.pool,
    now: () => 3_000,
    createJobId: () => 'mysql-child-1',
  });
  await assert.rejects(
    ledger.getOrCreate({
      parentJob: validParent(),
      childKey: 'tts:0:attempt:0',
      taskType: 'kie_tts',
      provider: 'kie',
      payload: validTtsPayload(),
    }),
    /insert failed/,
  );
  assert.equal(harness.calls.filter((call) => /RELEASE_LOCK/.test(call.sql)).length, 1);
  harness.release();
});
