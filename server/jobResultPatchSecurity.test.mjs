import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { normalizeLocalJobs, updateLocalJobResult } from './localJobStore.mjs';

const serverSource = readFileSync(new URL('./index.mjs', import.meta.url), 'utf8');

const captureThrownError = (operation) => {
  try {
    operation();
  } catch (error) {
    return error;
  }
  assert.fail('expected operation to throw');
};

const mapThroughTopLevelJobErrorHandler = (error) => {
  const handlerMatch = serverSource.match(
    /(if \(error\?\.statusCode && error\?\.code && \/\^\(job_\|video_feature_\)\/\.test\(String\(error\.code\)\)\) \{[\s\S]*?\n    \})\n    if \(error\?\.statusCode && \/\^managed_asset_/,
  );
  assert.ok(handlerMatch, 'top-level structured job error handler must exist');
  let response = null;
  const executeHandler = new Function('error', 'res', 'json', handlerMatch[1]);
  executeHandler(error, {}, (_res, statusCode, body) => {
    response = { statusCode, body };
  });
  return response;
};

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
      error?.code === 'job_voiceover_result_patch_forbidden'
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
      (error) => (
        error?.code === 'job_parent_owned_child_immutable'
        && error?.statusCode === 409
      ),
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

test('top-level HTTP error handler maps forbidden voiceover parent and child result patches to structured 409 responses', () => {
  const parentStore = { jobs: normalizeLocalJobs([createVoiceoverParent()]) };
  const parentError = captureThrownError(() => updateLocalJobResult(
    parentStore,
    parentStore.jobs[0].id,
    { finalAssetId: 'asset-forged-final' },
  ));

  const child = {
    id: 'child-http-mapping',
    userId: 'user-1',
    module: 'video',
    taskType: 'kie_tts',
    provider: 'kie',
    status: 'running',
    providerTaskId: '',
    payload: {
      executionOwner: 'parent',
      parentJobId: 'voiceover-parent-result-patch',
      childKey: 'tts:0:attempt:0',
      clientSubmissionKey: 'voiceover-child:voiceover-parent-result-patch:tts:0:attempt:0',
    },
    result: null,
  };
  const childStore = { jobs: normalizeLocalJobs([child]) };
  const childError = captureThrownError(() => updateLocalJobResult(
    childStore,
    child.id,
    { providerTaskId: 'forged-provider-task' },
  ));

  assert.deepEqual(mapThroughTopLevelJobErrorHandler(parentError), {
    statusCode: 409,
    body: {
      message: '口播翻译任务结果只能由受信任的后台执行器更新。',
      code: 'job_voiceover_result_patch_forbidden',
      retryable: false,
    },
  });
  assert.deepEqual(mapThroughTopLevelJobErrorHandler(childError), {
    statusCode: 409,
    body: {
      message: '父任务持有的子任务只能由口播翻译账本更新。',
      code: 'job_parent_owned_child_immutable',
      retryable: false,
    },
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
