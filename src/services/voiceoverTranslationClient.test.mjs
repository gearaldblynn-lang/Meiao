import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  buildVoiceoverJobRequest,
  buildVoiceoverRetryRequest,
  buildVoiceoverSubmissionKey,
  findActiveVoiceoverSubmissionIdentity,
  resolveVoiceoverCreatedJobIdentity,
} from './voiceoverTranslationClient.ts';

const validInput = (overrides = {}) => ({
  userId: 'user-7',
  sourceAssetId: 'asset-video-99',
  sourceUrl: '/api/assets/file/asset-video-99/source.mp4?accessKey=signed-secret',
  sourceProjectId: 'source-project',
  sourceResultId: 'source-result',
  shellProjectId: 'voiceover-project',
  shellProjectName: '口播翻译 0727-01',
  shellResultId: 'voiceover-result',
  targetLanguage: 'en',
  translationMode: 'natural',
  voiceMode: 'auto',
  removeText: true,
  subtitleRegionNormalized: { x: 0, y: 0.7, width: 1, height: 0.3 },
  ...overrides,
});

test('submission key includes every behavior-changing field', () => {
  const base = validInput();
  const key = buildVoiceoverSubmissionKey(base);
  for (const patch of [
    { sourceAssetId: 'asset-video-100', sourceUrl: '/api/assets/file/asset-video-100/source.mp4' },
    { targetLanguage: 'ja' },
    { translationMode: 'literal' },
    { voiceMode: 'preset', voiceName: 'Puck' },
    { removeText: false },
    { subtitleRegionNormalized: { x: 0, y: 0.6, width: 1, height: 0.4 } },
  ]) {
    assert.notEqual(buildVoiceoverSubmissionKey({ ...base, ...patch }), key);
  }
});

test('submission key is canonical, rounds region values, and strips signed access queries', () => {
  const base = validInput({
    sourceAssetId: undefined,
    sourceUrl: '/api/assets/file/asset-video-99/source.mp4?accessKey=first-secret',
    subtitleRegionNormalized: { x: 0.12345671, y: 0.7, width: 0.8, height: 0.3 },
  });
  const equivalent = {
    ...base,
    sourceUrl: '/api/assets/file/asset-video-99/source.mp4?accessKey=second-secret&expires=soon',
    subtitleRegionNormalized: { x: 0.12345674, y: 0.7, width: 0.8, height: 0.3 },
  };

  assert.equal(buildVoiceoverSubmissionKey(base), buildVoiceoverSubmissionKey(equivalent));
  assert.doesNotMatch(buildVoiceoverSubmissionKey(base), /secret|accessKey|expires/);
});

test('job request is internal, video scoped, and zero retry', () => {
  const input = validInput();
  const clientSubmissionKey = buildVoiceoverSubmissionKey(input);
  assert.deepEqual(buildVoiceoverJobRequest(input), {
    module: 'video',
    subFeature: 'voiceover_translation',
    taskType: 'voiceover_translate_video',
    provider: 'internal',
    maxRetries: 0,
    payload: {
      taskType: 'voiceover_translate_video',
      taskPurpose: 'voiceover_translation',
      subFeature: 'voiceover_translation',
      userId: input.userId,
      sourceAssetId: input.sourceAssetId,
      sourceProjectId: input.sourceProjectId,
      sourceResultId: input.sourceResultId,
      shellProjectId: input.shellProjectId,
      shellProjectName: input.shellProjectName,
      shellResultId: input.shellResultId,
      clientSubmissionKey,
      targetLanguage: input.targetLanguage,
      translationMode: input.translationMode,
      voiceMode: input.voiceMode,
      removeText: true,
      subtitleRegionNormalized: input.subtitleRegionNormalized,
    },
  });
});

test('direct upload and existing-result managed routes normalize to the same payload contract', () => {
  const direct = buildVoiceoverJobRequest(validInput());
  const existingResult = buildVoiceoverJobRequest(validInput({
    sourceAssetId: undefined,
    sourceUrl: '/api/assets/file/asset-video-99/source.mp4?accessKey=temporary',
  }));

  assert.deepEqual(existingResult, direct);
});

test('arbitrary external URLs, provider signatures, local paths, and mismatched identities fail closed', () => {
  for (const sourceUrl of [
    'https://tempfile.redpandaai.co/provider-output.mp4?signature=secret',
    'https://evil.example/api/assets/file/asset-video-99/source.mp4?accessKey=forged',
    '\\\\evil.example\\api\\assets\\file\\asset-video-99\\source.mp4',
    '//evil.example/api/assets/file/asset-video-99/source.mp4',
    'api/assets/file/asset-video-99/source.mp4',
    './api/assets/file/asset-video-99/source.mp4',
    '../api/assets/file/asset-video-99/source.mp4',
    'file:///Users/example/private.mp4',
    '/Users/example/private.mp4',
    '../private.mp4',
    'data:video/mp4;base64,AAAA',
  ]) {
    assert.throws(
      () => buildVoiceoverJobRequest(validInput({ sourceAssetId: undefined, sourceUrl })),
      (error) => error?.code === 'voiceover_source_invalid',
      sourceUrl,
    );
  }
  assert.throws(
    () => buildVoiceoverJobRequest(validInput({
      sourceAssetId: 'asset-video-99',
      sourceUrl: '/api/assets/file/another-asset/source.mp4',
    })),
    (error) => error?.code === 'voiceover_source_invalid',
  );
});

test('managed playback sources canonicalize to an account-checked asset route', async () => {
  const client = await import('./voiceoverTranslationClient.ts');
  assert.equal(typeof client.resolveCanonicalManagedSource, 'function');

  assert.deepEqual(client.resolveCanonicalManagedSource({
    sourceAssetId: 'asset-video-99',
  }), {
    assetId: 'asset-video-99',
    url: '/api/assets/file/asset-video-99',
  });
  assert.deepEqual(client.resolveCanonicalManagedSource({
    sourceUrl: '/api/assets/file/asset-video-99/source.mp4?accessKey=secret',
  }), {
    assetId: 'asset-video-99',
    url: '/api/assets/file/asset-video-99',
  });

  for (const sourceUrl of [
    'https://evil.example/api/assets/file/asset-video-99/source.mp4',
    '//evil.example/api/assets/file/asset-video-99/source.mp4',
    'https://user:password@meiao.example/api/assets/file/asset-video-99/source.mp4',
    '/api/assets/file/%2e%2e/source.mp4',
    'not-a-managed-url',
  ]) {
    assert.throws(
      () => client.resolveCanonicalManagedSource({ sourceUrl }),
      (error) => error?.code === 'voiceover_source_invalid',
      sourceUrl,
    );
  }
});

test('preset voice and remove-text region are normalized without authoring server-owned fields', () => {
  const request = buildVoiceoverJobRequest(validInput({
    voiceMode: 'preset',
    voiceName: 'Kore',
    subtitleRegionNormalized: {
      x: 0.12345671,
      y: 0.65432129,
      width: 0.80000001,
      height: 0.30000001,
    },
  }));

  assert.equal(request.payload.voiceName, 'Kore');
  assert.deepEqual(request.payload.subtitleRegionNormalized, {
    x: 0.123457,
    y: 0.654321,
    width: 0.8,
    height: 0.3,
  });
});

test('retry request exposes only the server-approved confirmation bit', () => {
  const job = {
    id: 'voiceover-job',
    taskType: 'voiceover_translate_video',
    provider: 'internal',
  };
  assert.deepEqual(buildVoiceoverRetryRequest(job, {}), {
    confirmNewProviderAttempt: false,
  });
  assert.deepEqual(buildVoiceoverRetryRequest(job, {
    confirmNewProviderAttempt: true,
    kind: 'tts',
    target: { groupIndex: 4 },
    attempt: 9,
    childJobId: 'browser-authored-child',
    providerTaskId: 'browser-authored-provider',
    checkpoint: { stage: 'result_persisted' },
  }), {
    confirmNewProviderAttempt: true,
  });
  assert.throws(
    () => buildVoiceoverRetryRequest({ ...job, taskType: 'kie_video' }, {}),
    (error) => error?.code === 'voiceover_retry_invalid',
  );
});

test('duplicate drafts reuse one active submission key', () => {
  const first = buildVoiceoverSubmissionKey(validInput());
  const second = buildVoiceoverSubmissionKey({ ...validInput() });
  assert.equal(second, first);
});

test('a completed browser submission blocks a second shell identity while its parent job is active', () => {
  const clientSubmissionKey = buildVoiceoverSubmissionKey(validInput());
  const project = {
    id: 'canonical-project',
    status: 'generating',
    subFeature: 'voiceover_translation',
    backendJobId: 'parent-job',
    results: [{
      id: 'canonical-result',
      status: 'generating',
      clientSubmissionKey,
    }],
  };

  assert.deepEqual(findActiveVoiceoverSubmissionIdentity([project], clientSubmissionKey), {
    shellProjectId: 'canonical-project',
    shellResultId: 'canonical-result',
    backendJobId: 'parent-job',
    creationUncertain: false,
  });
  assert.equal(
    findActiveVoiceoverSubmissionIdentity([{ ...project, status: 'completed', results: [{
      ...project.results[0],
      status: 'completed',
    }] }], clientSubmissionKey),
    null,
  );
});

test('deduped parent responses preserve the server canonical shell identity', () => {
  const fallback = {
    shellProjectId: 'new-project',
    shellProjectName: '新任务卡',
    shellResultId: 'new-result',
  };
  const canonical = resolveVoiceoverCreatedJobIdentity({
    taskType: 'voiceover_translate_video',
    provider: 'internal',
    payload: {
      ...buildVoiceoverJobRequest(validInput()).payload,
      shellProjectId: 'canonical-project',
      shellProjectName: '原任务卡',
      shellResultId: 'canonical-result',
    },
  }, fallback);

  assert.deepEqual(canonical, {
    shellProjectId: 'canonical-project',
    shellProjectName: '原任务卡',
    shellResultId: 'canonical-result',
  });
});

test('shell preflights the stable key and reconciles a deduped parent before keeping a new card', () => {
  const shellSource = readFileSync(new URL('../ShellMigratedApp.tsx', import.meta.url), 'utf8');
  const start = shellSource.indexOf('const handleVoiceoverTranslationSubmit = useCallback');
  const end = shellSource.indexOf('const handleClearVoiceoverInitialSource', start);
  const submitBlock = shellSource.slice(start, end);
  const preflightIndex = submitBlock.indexOf('findActiveVoiceoverSubmissionIdentity(');
  const initialPersistMatch = /persistSyncedProjectsToSharedState\(\s*\[checkpointProject\],\s*isSubmissionCurrent,\s*\)/.exec(submitBlock);
  const initialPersistIndex = initialPersistMatch?.index ?? -1;
  const createIndex = submitBlock.indexOf('createInternalJob(request)');

  assert.ok(preflightIndex >= 0);
  assert.ok(preflightIndex < initialPersistIndex);
  assert.ok(initialPersistIndex < createIndex);
  assert.match(submitBlock, /resolveVoiceoverCreatedJobIdentity\(createdJob/);
  assert.match(submitBlock, /persistDeletionToSharedState\(\{\s*projectId: shellProjectId/);
  assert.match(submitBlock, /dedupedToCanonicalIdentity \? shellProjectId : ''/);
});
