import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { normalizeLocalJobs, updateLocalJobResult } from './localJobStore.mjs';

const serverSource = readFileSync(new URL('./index.mjs', import.meta.url), 'utf8');

const createVoiceoverParent = () => ({
  id: 'voiceover-parent-result-patch',
  userId: 'user-1',
  module: 'video',
  taskType: 'voiceover_translate_video',
  provider: 'internal',
  status: 'running',
  providerTaskId: '',
  result: {
    voiceoverCheckpoint: {
      version: 1,
      stage: 'input_prepared',
      baseVideoAssetId: 'asset-base',
      analysisAttempt: 0,
    },
  },
});

test('generic local result patch cannot forge a voiceover parent checkpoint or terminal result', () => {
  const store = { jobs: normalizeLocalJobs([createVoiceoverParent()]) };
  const before = structuredClone(store);

  assert.throws(
    () => updateLocalJobResult(store, store.jobs[0].id, {
      providerTaskId: 'forged-provider-task',
      status: 'succeeded',
      finalAssetId: 'asset-forged-final',
      voiceoverCheckpoint: {
        version: 1,
        stage: 'result_persisted',
        finalAssetId: 'asset-forged-final',
      },
    }),
    (error) => (
      error?.code === 'voiceover_generic_result_patch_forbidden'
      && error?.statusCode === 409
    ),
  );
  assert.deepEqual(store, before);
});

test('generic local result patch cannot forge a parent-owned Golden or TTS child', () => {
  for (const childKey of ['golden:attempt:0', 'tts:0:attempt:0']) {
    const child = {
      id: `child-${childKey}`,
      userId: 'user-1',
      module: 'video',
      taskType: childKey.startsWith('golden') ? 'subtitle_remove_video' : 'kie_tts',
      provider: 'kie',
      status: 'running',
      providerTaskId: '',
      payload: {
        executionOwner: 'parent',
        parentJobId: 'voiceover-parent-result-patch',
        childKey,
        clientSubmissionKey: `voiceover-child:voiceover-parent-result-patch:${childKey}`,
      },
      result: null,
    };
    const store = { jobs: normalizeLocalJobs([child]) };
    const before = structuredClone(store);

    assert.throws(
      () => updateLocalJobResult(store, child.id, {
        providerTaskId: 'forged-provider-task',
        status: 'succeeded',
        resultAssetId: 'asset-forged',
      }),
      (error) => error?.code === 'parent_owned_child_immutable',
      childKey,
    );
    assert.deepEqual(store, before, childKey);
  }
});

test('generic local result patch keeps existing non-voiceover behavior', () => {
  const store = {
    jobs: [{
      id: 'ordinary-job',
      userId: 'user-1',
      module: 'translation',
      taskType: 'kie_image',
      provider: 'kie',
      status: 'running',
      providerTaskId: '',
      result: { audit: 'keep' },
    }],
  };

  const updated = updateLocalJobResult(store, 'ordinary-job', {
    providerTaskId: 'provider-task-1',
    imageUrl: 'managed://asset-image',
  });

  assert.equal(updated.providerTaskId, 'provider-task-1');
  assert.deepEqual(updated.result, {
    audit: 'keep',
    providerTaskId: 'provider-task-1',
    imageUrl: 'managed://asset-image',
  });
});

test('both browser result PATCH handlers reject voiceover parents before merging user fields', () => {
  const routeBodies = [...serverSource.matchAll(
    /if \(jobResultMatch && req\.method === 'PATCH'\) \{([\s\S]*?)\n  \}\n\n  if \(jobDetailMatch/g,
  )].map((match) => match[1]);

  assert.equal(routeBodies.length, 2);
  assert.match(
    routeBodies[0],
    /const freshJob =[\s\S]*assertGenericJobResultPatchAllowed\(freshJob\);[\s\S]*const freshResult =/,
  );
  assert.match(
    routeBodies[1],
    /const job = getLocalJobByIdForUser[\s\S]*assertGenericJobResultPatchAllowed\(job\);[\s\S]*updateLocalJobResult/,
  );
});
