import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildKieTtsCreateBody,
  normalizeKieTtsCreateResponse,
  normalizeKieTtsRecordResponse,
  runKieTtsJob,
} from './providerKieTts.mjs';

const enabledEnv = (overrides = {}) => ({
  KIE_API_KEY: 'test-kie-key',
  MEIAO_KIE_TTS_BASE_URL: 'https://api.kie.ai',
  MEIAO_KIE_TTS_REQUEST_TIMEOUT_MS: '5000',
  MEIAO_KIE_TTS_POLL_INTERVAL_MS: '500',
  MEIAO_KIE_TTS_POLL_MAX_ATTEMPTS: '3',
  MEIAO_KIE_TTS_NOT_FOUND_GRACE_MS: '1000',
  ...overrides,
});

const newTtsJob = (overrides = {}) => ({
  id: 'child-job-1',
  userId: 'user-1',
  module: 'video',
  taskType: 'kie_tts',
  provider: 'kie',
  providerTaskId: '',
  payload: {
    executionOwner: 'parent',
    parentJobId: 'voiceover-parent-1',
    childKey: 'tts:0:attempt:0',
    groupIndex: 0,
    targetLanguage: 'en',
    voiceName: 'Kore',
    dialogueTurns: [{ speaker: 'Speaker 1', text: 'Hello world.' }],
    temperature: 1,
    scene: 'Warm product presentation with controlled pacing.',
    sampleContext: 'One consistent narrator. Preserve pauses between claims.',
  },
  ...overrides,
});

const jsonResponse = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

const successfulRecord = (taskId = 'tts-1', audioUrl = 'https://provider.example/audio.mp3') => ({
  code: 200,
  msg: 'success',
  data: {
    taskId,
    model: 'google/gemini-3-1-flash-tts',
    state: 'success',
    param: '{}',
    resultJson: JSON.stringify({ resultUrls: [audioUrl] }),
    failCode: null,
    failMsg: null,
    costTime: 10,
    completeTime: 20,
    createTime: 0,
  },
});

const fakeKieTts = ({
  states = ['success'],
  events = [],
  createResponse = { code: 200, msg: 'success', data: { taskId: 'tts-1' } },
  createStatus = 200,
  createError,
  createReadError,
  queryError,
  nowValues = [0, 1, 2, 3],
} = {}) => {
  const calls = { create: 0, query: 0, sleep: 0 };
  const queue = [...states];
  const clock = [...nowValues];
  return {
    calls,
    now: () => clock.shift() ?? 3,
    sleep: async () => {
      calls.sleep += 1;
      events.push('sleep');
    },
    fetchWithTimeout: async (url, init, _timeoutMessage, timeoutMs, stage, requestOptions) => {
      if (init.method === 'POST') {
        calls.create += 1;
        events.push('create');
        assert.equal(url, 'https://api.kie.ai/api/v1/jobs/createTask');
        assert.equal(timeoutMs, 5000);
        assert.equal(stage, 'provider_submit');
        assert.deepEqual(requestOptions, { maxRetries: 0, idempotent: false });
        if (createError) throw createError;
        const response = jsonResponse(createResponse, createStatus);
        if (createReadError) response.json = async () => { throw createReadError; };
        return response;
      }
      calls.query += 1;
      events.push('query');
      assert.match(url, /recordInfo\?taskId=/);
      assert.equal(init.method, 'GET');
      assert.equal(stage, 'provider_wait');
      const requestedTaskId = new URL(url).searchParams.get('taskId');
      if (queryError) throw queryError;
      const state = queue.shift() || 'success';
      if (typeof state === 'object') return jsonResponse(state.body, state.status);
      if (state === 'waiting') {
        return jsonResponse({
          code: 200,
          msg: 'success',
          data: {
            taskId: requestedTaskId,
            state: 'waiting',
            resultJson: '',
            failCode: null,
            failMsg: null,
          },
        });
      }
      if (state === 'fail') {
        return jsonResponse({
          code: 200,
          msg: 'success',
          data: {
            taskId: requestedTaskId,
            state: 'fail',
            resultJson: '',
            failCode: 'TTS_FAILED',
            failMsg: 'synthesis failed',
          },
        });
      }
      return jsonResponse(successfulRecord(requestedTaskId));
    },
  };
};

test('KIE TTS validation honors the parent normalized config snapshot', async () => {
  let fetchCalls = 0;
  await assert.rejects(
    runKieTtsJob({
      job: newTtsJob(),
      env: enabledEnv(),
      config: {
        ttsMaxInputTokens: 1,
        kieBaseUrl: 'https://snapshot.invalid',
      },
      onProviderTaskId: async () => {},
      deps: {
        fetchWithTimeout: async () => {
          fetchCalls += 1;
        },
      },
    }),
    (error) => error?.code === 'voiceover_tts_input_too_large',
  );
  assert.equal(fetchCalls, 0);
});

test('create body sends structured speaker and dialogue arrays to the live KIE wrapper', () => {
  const body = buildKieTtsCreateBody(newTtsJob().payload);

  assert.deepEqual(body, {
    model: 'google/gemini-3-1-flash-tts',
    input: {
      speakers: [{
        speaker_id: 'Speaker 1',
        voice_name: 'Kore',
        audio_profile: '',
        style: 'Deadpan',
        pace: 'Natural',
        accent: 'Neutral',
      }],
      dialogue_turns: [{ speaker_id: 'Speaker 1', text: 'Hello world.' }],
      temperature: 1,
      scene: 'Warm product presentation with controlled pacing.',
      sample_context: 'One consistent narrator. Preserve pauses between claims.',
    },
  });
  assert.equal('callBackUrl' in body, false);
});

test('create and record response normalizers cover waiting, success and terminal failure', () => {
  assert.deepEqual(normalizeKieTtsCreateResponse({
    code: 200,
    msg: 'success',
    data: { taskId: 'tts-1' },
  }), { providerTaskId: 'tts-1' });
  assert.deepEqual(normalizeKieTtsRecordResponse({
    code: 200,
    data: { state: 'waiting', resultJson: '' },
  }, 'tts-1'), {
    state: 'waiting',
    providerTaskId: 'tts-1',
  });
  for (const state of ['queuing', 'generating']) {
    assert.deepEqual(normalizeKieTtsRecordResponse({
      code: 200,
      data: { state, resultJson: '' },
    }, 'tts-1'), {
      state: 'waiting',
      providerTaskId: 'tts-1',
    });
  }
  assert.deepEqual(normalizeKieTtsRecordResponse(successfulRecord(), 'tts-1'), {
    state: 'success',
    providerTaskId: 'tts-1',
    audioUrl: 'https://provider.example/audio.mp3',
  });
  assert.throws(
    () => normalizeKieTtsRecordResponse({
      code: 200,
      data: {
        state: 'fail',
        failCode: 'TTS_FAILED',
        failMsg: 'synthesis failed',
      },
    }, 'tts-1'),
    (error) => error?.code === 'provider_job_failed'
      && error?.providerTaskId === 'tts-1'
      && error?.failCode === 'TTS_FAILED'
      && error?.failMsg === 'synthesis failed',
  );
});

test('success selects the first credential-free HTTPS result and rejects malformed success bodies', () => {
  const withCandidates = successfulRecord();
  withCandidates.data.resultJson = JSON.stringify({
    resultUrls: [
      'http://unsafe.example/a.mp3',
      'https://user:pass@provider.example/credential.mp3',
      'https://provider.example/audio.mp3',
    ],
  });
  assert.equal(normalizeKieTtsRecordResponse(withCandidates, 'tts-1').audioUrl, 'https://provider.example/audio.mp3');

  for (const resultJson of ['{', '{}', JSON.stringify({ resultUrls: [] })]) {
    assert.throws(
      () => normalizeKieTtsRecordResponse({
        code: 200,
        data: { state: 'success', resultJson },
      }, 'tts-1'),
      (error) => error?.code === 'provider_bad_response' && error?.providerTaskId === 'tts-1',
    );
  }
});

test('documented KIE response codes map to stable voiceover errors', () => {
  const mappings = [
    [400, 'provider_bad_request'],
    [401, 'provider_auth_invalid'],
    [402, 'provider_balance_insufficient'],
    [404, 'task_not_found'],
    [422, 'provider_bad_request'],
    [429, 'provider_rate_limited'],
    [500, 'provider_internal_error'],
  ];
  for (const [code, expected] of mappings) {
    assert.throws(
      () => normalizeKieTtsRecordResponse({ code, msg: `code ${code}` }, 'tts-1'),
      (error) => error?.code === expected && error?.providerTaskId === 'tts-1',
      String(code),
    );
  }
  assert.throws(
    () => normalizeKieTtsCreateResponse({ code: 200, data: {} }),
    (error) => error?.code === 'provider_submission_unknown'
      && error?.retryable === false
      && error?.submissionUnknown === true,
  );
});

test('HTTP status remains authoritative when a non-2xx body claims code 200', async () => {
  const createDeps = fakeKieTts({
    createStatus: 401,
    createResponse: { code: 200, msg: 'not authorized', data: { taskId: 'must-not-use' } },
  });
  await assert.rejects(
    runKieTtsJob({
      job: newTtsJob(),
      env: enabledEnv(),
      onProviderTaskId: async () => {
        throw new Error('must not checkpoint');
      },
      deps: createDeps,
    }),
    (error) => error?.code === 'provider_auth_invalid',
  );
  assert.equal(createDeps.calls.query, 0);

  await assert.rejects(
    runKieTtsJob({
      job: newTtsJob({ providerTaskId: 'tts-existing' }),
      env: enabledEnv({ MEIAO_KIE_TTS_NOT_FOUND_GRACE_MS: '0' }),
      deps: fakeKieTts({
        states: [{
          status: 404,
          body: { code: 200, data: { state: 'waiting' } },
        }],
      }),
    }),
    (error) => error?.code === 'task_not_found' && error?.providerTaskId === 'tts-existing',
  );
});

test('query rejects mismatched task ids and classifies null or primitive error bodies', async () => {
  const mismatched = successfulRecord('another-task');
  assert.throws(
    () => normalizeKieTtsRecordResponse(mismatched, 'tts-existing'),
    (error) => error?.code === 'provider_bad_response'
      && error?.providerTaskId === 'tts-existing',
  );

  for (const body of [null, 'upstream unavailable']) {
    await assert.rejects(
      runKieTtsJob({
        job: newTtsJob({ providerTaskId: 'tts-existing' }),
        env: enabledEnv(),
        deps: fakeKieTts({
          states: [{ status: 500, body }],
        }),
      }),
      (error) => error?.code === 'provider_internal_error'
        && error?.providerTaskId === 'tts-existing',
    );
  }
});

test('adapter validates the parent-owned child payload before network activity', async () => {
  const invalidJobs = [
    newTtsJob({ provider: 'internal' }),
    newTtsJob({ taskType: 'voiceover_translate_video', provider: 'internal' }),
    newTtsJob({ payload: { ...newTtsJob().payload, executionOwner: 'browser' } }),
    newTtsJob({ payload: { ...newTtsJob().payload, parentJobId: '' } }),
    newTtsJob({ payload: { ...newTtsJob().payload, childKey: 'tts:0' } }),
    newTtsJob({ payload: { ...newTtsJob().payload, childKey: `tts:0:attempt:${'9'.repeat(40)}` } }),
    newTtsJob({ payload: { ...newTtsJob().payload, childKey: 'tts:1:attempt:0' } }),
    newTtsJob({ payload: { ...newTtsJob().payload, groupIndex: -1 } }),
    newTtsJob({ payload: { ...newTtsJob().payload, groupIndex: 100 } }),
    newTtsJob({ payload: { ...newTtsJob().payload, targetLanguage: 'not-supported' } }),
    newTtsJob({ payload: { ...newTtsJob().payload, voiceName: 'not-a-voice' } }),
    newTtsJob({ payload: { ...newTtsJob().payload, dialogueTurns: [] } }),
    newTtsJob({ payload: { ...newTtsJob().payload, dialogueTurns: [{ speaker: 'Speaker 2', text: 'Hello' }] } }),
    newTtsJob({ payload: { ...newTtsJob().payload, dialogueTurns: [{ speaker: 'Speaker 1', text: '  ' }] } }),
    newTtsJob({ payload: { ...newTtsJob().payload, scene: '界'.repeat(1001) } }),
    newTtsJob({ payload: { ...newTtsJob().payload, sampleContext: 'a'.repeat(1001) } }),
    newTtsJob({ payload: { ...newTtsJob().payload, temperature: 1.001 } }),
    newTtsJob({ payload: { ...newTtsJob().payload, temperature: 2.001 } }),
    newTtsJob({ payload: { ...newTtsJob().payload, temperature: 2.01 } }),
  ];

  for (const job of invalidJobs) {
    const deps = fakeKieTts();
    await assert.rejects(
      runKieTtsJob({ job, env: enabledEnv(), onProviderTaskId: async () => {}, deps }),
      (error) => error?.code === 'provider_bad_request' || error?.code === 'voiceover_tts_input_too_large',
    );
    assert.deepEqual(deps.calls, { create: 0, query: 0, sleep: 0 });
  }
});

test('groupIndex rejects null and other non-number values before network activity', async () => {
  for (const groupIndex of [null, '0', false]) {
    const deps = fakeKieTts();
    await assert.rejects(
      runKieTtsJob({
        job: newTtsJob({
          payload: { ...newTtsJob().payload, groupIndex },
        }),
        env: enabledEnv(),
        onProviderTaskId: async () => {},
        deps,
      }),
      (error) => error?.code === 'provider_bad_request'
        && error?.providerStage === 'validation',
      `groupIndex=${String(groupIndex)}`,
    );
    assert.deepEqual(deps.calls, { create: 0, query: 0, sleep: 0 });
  }
});

test('temperature defaults only when undefined and rejects other non-number values before network activity', async () => {
  for (const temperature of [null, '1', true]) {
    const deps = fakeKieTts();
    await assert.rejects(
      runKieTtsJob({
        job: newTtsJob({
          payload: { ...newTtsJob().payload, temperature },
        }),
        env: enabledEnv(),
        onProviderTaskId: async () => {},
        deps,
      }),
      (error) => error?.code === 'provider_bad_request'
        && error?.providerStage === 'validation',
      `temperature=${String(temperature)}`,
    );
    assert.deepEqual(deps.calls, { create: 0, query: 0, sleep: 0 });
  }

  const defaultedDeps = fakeKieTts();
  const payload = { ...newTtsJob().payload };
  delete payload.temperature;
  const result = await runKieTtsJob({
    job: newTtsJob({ payload }),
    env: enabledEnv(),
    onProviderTaskId: async () => {},
    deps: defaultedDeps,
  });
  assert.equal(result.providerStatus, 'success');
  assert.equal(defaultedDeps.calls.create, 1);
});

test('adapter recomputes the full provider input budget and ignores caller estimates', async () => {
  const deps = fakeKieTts();
  await assert.rejects(
    runKieTtsJob({
      job: newTtsJob({
        payload: {
          ...newTtsJob().payload,
          estimatedInputTokens: 1,
          dialogueTurns: [{ speaker: 'Speaker 1', text: 'x'.repeat(9000) }],
        },
      }),
      env: enabledEnv(),
      onProviderTaskId: async () => {},
      deps,
    }),
    (error) => error?.code === 'voiceover_tts_input_too_large',
  );
  assert.equal(deps.calls.create, 0);
});

test('new task checkpoints its provider id before the first record query', async () => {
  const events = [];
  const deps = fakeKieTts({ states: ['waiting', 'success'], events });
  const result = await runKieTtsJob({
    job: newTtsJob(),
    env: enabledEnv(),
    onProviderTaskId: async (taskId) => events.push(`checkpoint:${taskId}`),
    deps,
  });

  assert.deepEqual(events.slice(0, 3), ['create', 'checkpoint:tts-1', 'query']);
  assert.equal(deps.calls.create, 1);
  assert.equal(deps.calls.query, 2);
  assert.equal(result.providerTaskId, 'tts-1');
  assert.equal(result.providerStatus, 'success');
  assert.deepEqual(result.result, {
    audioUrl: 'https://provider.example/audio.mp3',
    voiceName: 'Kore',
    groupIndex: 0,
  });
});

test('continuous narration child reaches the real KIE adapter with one speaker and temperature zero', async () => {
  const deps = fakeKieTts({ states: ['success'] });
  const result = await runKieTtsJob({
    job: newTtsJob({
      payload: {
        ...newTtsJob().payload,
        childKey: 'tts:continuous:attempt:0',
        dialogueTurns: [
          { speaker: 'Speaker 1', text: 'First translated sentence.' },
          { speaker: 'Speaker 1', text: 'Second translated sentence.' },
        ],
        temperature: 0,
      },
    }),
    env: enabledEnv(),
    onProviderTaskId: async () => {},
    deps,
  });

  assert.equal(deps.calls.create, 1);
  assert.equal(deps.calls.query, 1);
  assert.equal(result.providerTaskId, 'tts-1');
  assert.equal(result.providerStatus, 'success');

  const mismatchedDeps = fakeKieTts();
  await assert.rejects(
    runKieTtsJob({
      job: newTtsJob({
        payload: {
          ...newTtsJob().payload,
          childKey: 'tts:continuous:attempt:0',
          groupIndex: 1,
          temperature: 0,
        },
      }),
      env: enabledEnv(),
      onProviderTaskId: async () => {},
      deps: mismatchedDeps,
    }),
    (error) => error?.code === 'provider_bad_request'
      && error?.providerStatus === 'invalid_parent_child',
  );
  assert.equal(mismatchedDeps.calls.create, 0);
});

test('existing provider task id is query-only', async () => {
  const deps = fakeKieTts({ states: ['success'] });
  const result = await runKieTtsJob({
    job: newTtsJob({ providerTaskId: 'tts-existing' }),
    env: enabledEnv(),
    deps,
  });

  assert.equal(deps.calls.create, 0);
  assert.equal(deps.calls.query, 1);
  assert.equal(result.providerTaskId, 'tts-existing');
});

test('a new paid task requires a checkpoint callback before POST', async () => {
  const deps = fakeKieTts();
  await assert.rejects(
    runKieTtsJob({ job: newTtsJob(), env: enabledEnv(), deps }),
    (error) => error?.code === 'provider_internal_error' && error?.retryable === false,
  );
  assert.equal(deps.calls.create, 0);
});

test('create ambiguity is non-retryable and checkpoint failure retains the known id', async () => {
  const ambiguousDeps = fakeKieTts({ createError: new TypeError('fetch failed') });
  await assert.rejects(
    runKieTtsJob({
      job: newTtsJob(),
      env: enabledEnv(),
      onProviderTaskId: async () => {},
      deps: ambiguousDeps,
    }),
    (error) => error?.code === 'provider_submission_unknown'
      && error?.retryable === false
      && error?.submissionUnknown === true,
  );
  assert.equal(ambiguousDeps.calls.create, 1);
  assert.equal(ambiguousDeps.calls.query, 0);

  const unreadableDeps = fakeKieTts({ createReadError: new TypeError('terminated') });
  await assert.rejects(
    runKieTtsJob({
      job: newTtsJob(),
      env: enabledEnv(),
      onProviderTaskId: async () => {},
      deps: unreadableDeps,
    }),
    (error) => error?.code === 'provider_submission_unknown'
      && error?.retryable === false
      && error?.submissionUnknown === true,
  );
  assert.equal(unreadableDeps.calls.create, 1);
  assert.equal(unreadableDeps.calls.query, 0);

  const checkpointDeps = fakeKieTts();
  await assert.rejects(
    runKieTtsJob({
      job: newTtsJob(),
      env: enabledEnv(),
      onProviderTaskId: async () => {
        throw Object.assign(new Error('ledger unavailable'), { code: 'ER_LOCK_DEADLOCK' });
      },
      deps: checkpointDeps,
    }),
    (error) => error?.code === 'provider_internal_error'
      && error?.providerTaskId === 'tts-1'
      && error?.providerStage === 'provider_checkpoint'
      && error?.retryable === false
      && error?.checkpointErrorCode === 'ER_LOCK_DEADLOCK',
  );
  assert.equal(checkpointDeps.calls.create, 1);
  assert.equal(checkpointDeps.calls.query, 0);
});

test('query errors, abort, provider failure and poll exhaustion retain the provider id', async () => {
  const cases = [
    {
      deps: fakeKieTts({ queryError: new TypeError('query failed') }),
      signal: undefined,
      code: 'provider_network_error',
    },
    {
      deps: fakeKieTts({ states: ['fail'] }),
      signal: undefined,
      code: 'provider_job_failed',
    },
    {
      deps: fakeKieTts({ states: ['waiting', 'waiting', 'waiting'] }),
      signal: undefined,
      code: 'provider_timeout',
    },
  ];
  for (const item of cases) {
    await assert.rejects(
      runKieTtsJob({
        job: newTtsJob({ providerTaskId: 'tts-existing' }),
        env: enabledEnv(),
        signal: item.signal,
        deps: item.deps,
      }),
      (error) => error?.code === item.code && error?.providerTaskId === 'tts-existing',
    );
  }

  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    runKieTtsJob({
      job: newTtsJob({ providerTaskId: 'tts-existing' }),
      env: enabledEnv(),
      signal: controller.signal,
      deps: fakeKieTts(),
    }),
    (error) => error?.code === 'request_cancelled' && error?.providerTaskId === 'tts-existing',
  );
});

test('recordInfo 404 is tolerated only inside the configured warm-up window', async () => {
  const transient404 = { status: 404, body: { code: 404, msg: 'not ready' } };
  const deps = fakeKieTts({
    states: [transient404, 'success'],
    nowValues: [0, 500],
  });
  const result = await runKieTtsJob({
    job: newTtsJob({ providerTaskId: 'tts-existing' }),
    env: enabledEnv(),
    deps,
  });
  assert.equal(result.providerTaskId, 'tts-existing');
  assert.equal(deps.calls.query, 2);

  await assert.rejects(
    runKieTtsJob({
      job: newTtsJob({ providerTaskId: 'tts-existing' }),
      env: enabledEnv(),
      deps: fakeKieTts({
        states: [transient404],
        nowValues: [0, 1001],
      }),
    }),
    (error) => error?.code === 'task_not_found' && error?.providerTaskId === 'tts-existing',
  );
});

test('recordInfo body code 404 uses only a positive configured warm-up window', async () => {
  const bodyCode404 = { status: 200, body: { code: 404, msg: 'not ready' } };
  const graceDeps = fakeKieTts({
    states: [bodyCode404, 'success'],
    nowValues: [0, 500],
  });
  const result = await runKieTtsJob({
    job: newTtsJob({ providerTaskId: 'tts-existing' }),
    env: enabledEnv(),
    deps: graceDeps,
  });
  assert.equal(result.providerTaskId, 'tts-existing');
  assert.equal(graceDeps.calls.query, 2);
  assert.equal(graceDeps.calls.sleep, 1);

  const zeroGraceDeps = fakeKieTts({
    states: [bodyCode404],
    nowValues: [0, 0],
  });
  await assert.rejects(
    runKieTtsJob({
      job: newTtsJob({ providerTaskId: 'tts-existing' }),
      env: enabledEnv({ MEIAO_KIE_TTS_NOT_FOUND_GRACE_MS: '0' }),
      deps: zeroGraceDeps,
    }),
    (error) => error?.code === 'task_not_found'
      && error?.providerTaskId === 'tts-existing',
  );
  assert.equal(zeroGraceDeps.calls.query, 1);
  assert.equal(zeroGraceDeps.calls.sleep, 0);
});

test('recordInfo tolerates an empty eventual-consistency state and keeps polling the same task', async () => {
  const deps = fakeKieTts({
    states: [{
      status: 200,
      body: {
        code: 200,
        msg: 'success',
        data: {
          taskId: 'tts-existing',
          state: '',
          resultJson: '',
          failCode: null,
          failMsg: null,
        },
      },
    }, 'success'],
  });

  const result = await runKieTtsJob({
    job: newTtsJob({ providerTaskId: 'tts-existing' }),
    env: enabledEnv(),
    deps,
  });

  assert.equal(result.providerTaskId, 'tts-existing');
  assert.equal(deps.calls.query, 2);
  assert.equal(deps.calls.sleep, 1);
});

test('operational TTS bounds use conservative defaults for invalid env values', async () => {
  const deps = fakeKieTts({ states: ['success'] });
  await runKieTtsJob({
    job: newTtsJob({ providerTaskId: 'tts-existing' }),
    env: enabledEnv({
      MEIAO_KIE_TTS_REQUEST_TIMEOUT_MS: '1',
      MEIAO_KIE_TTS_POLL_INTERVAL_MS: '1',
      MEIAO_KIE_TTS_POLL_MAX_ATTEMPTS: '0',
      MEIAO_KIE_TTS_NOT_FOUND_GRACE_MS: '-1',
    }),
    deps: {
      ...deps,
      fetchWithTimeout: async (url, init, _message, timeoutMs, stage) => {
        assert.equal(timeoutMs, 60_000);
        assert.equal(stage, 'provider_wait');
        return jsonResponse(successfulRecord('tts-existing'));
      },
    },
  });
});
