import test from 'node:test';
import assert from 'node:assert/strict';

import { runSubtitleRemovalJob } from './providerSubtitleRemoval.mjs';

const enabledEnv = (overrides = {}) => ({
  GOLDEN_SUBTITLE_API_TOKEN: 'test-token',
  MEIAO_SUBTITLE_REMOVAL_ENABLED: '1',
  MEIAO_SUBTITLE_REMOVAL_POLL_INTERVAL_MS: '2000',
  MEIAO_SUBTITLE_REMOVAL_TIMEOUT_MS: '300000',
  ...overrides,
});

const newSubtitleJob = (overrides = {}) => ({
  id: 'job-123',
  userId: 'user-1',
  module: 'video',
  taskType: 'subtitle_remove_video',
  provider: 'golden_subtitle',
  providerTaskId: '',
  payload: {
    sourceUrl: '/api/assets/file/source-video',
    subtitleRegionNormalized: { x: 0, y: 0.7, width: 1, height: 0.3 },
    sourceProjectId: 'source-project',
    sourceResultId: 'source-result',
  },
  ...overrides,
});

const jsonResponse = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

const fakeProviderDeps = ({
  progress = ['success'],
  submitBody = { code: 0, msg: 'ok', data: { taskId: 'provider-1', leftSeconds: 99 } },
  submitError,
  events = [],
  nowValues,
  onSubmitBody = () => {},
  resolvedReadUrl = 'https://managed.example/video.mp4?access=short-lived',
  resolvedProviderUrl = 'https://provider.example/staged.mp4',
} = {}) => {
  const calls = { submit: 0, query: 0, sleep: 0 };
  const statuses = [...progress];
  const clock = [...(nowValues || [0, 1, 2, 3])];
  return {
    calls,
    resolveManagedAssetReadUrl: async (value) => {
      events.push(`resolve:${value}`);
      return resolvedReadUrl;
    },
    resolveProviderSourceUrl: async (value) => {
      events.push(`stage:${value}`);
      return resolvedProviderUrl;
    },
    probeVideo: async (value) => {
      events.push(`probe:${value}`);
      return {
        durationSeconds: 9.01,
        sizeBytes: 15.2 * 1024 * 1024,
        width: 720,
        height: 1280,
        videoCodec: 'h264',
      };
    },
    fetchImpl: async (_url, init = {}) => {
      const body = JSON.parse(String(init.body || '{}'));
      assert.ok(init.headers?.authorization, 'authorization header is required');
      if (body.biz === 'aiRemoveSubtitleSubmitTask') {
        calls.submit += 1;
        events.push('submit');
        onSubmitBody(body);
        if (submitError) throw submitError;
        assert.equal(body.duration, 10, 'server probe duration must override browser claims');
        assert.equal(body.resolution, '720x1280');
        return jsonResponse(submitBody);
      }
      calls.query += 1;
      events.push('query');
      const status = statuses.shift() || 'success';
      return jsonResponse({
        code: 0,
        msg: 'ok',
        data: [{
          taskId: body.taskId,
          status,
          emsg: status === 'failed' ? '上游处理失败' : '',
          resultUrl: status === 'success' ? 'https://provider.example/result.mp4' : '',
          costRemove: status === 'success' ? 24 : undefined,
        }],
      });
    },
    sleep: async () => {
      calls.sleep += 1;
    },
    now: () => clock.shift() ?? 3,
  };
};

test('new job resolves and probes managed media, then checkpoints before its first query', async () => {
  const events = [];
  const deps = fakeProviderDeps({ progress: ['waiting', 'success'], events });
  const result = await runSubtitleRemovalJob({
    job: newSubtitleJob({ payload: {
      ...newSubtitleJob().payload,
      durationSeconds: 1,
      width: 1,
      height: 1,
    } }),
    env: enabledEnv(),
    onProviderTaskId: async (taskId) => events.push(`checkpoint:${taskId}`),
    deps,
  });

  assert.deepEqual(events.slice(0, 6), [
    'resolve:/api/assets/file/source-video',
    'probe:https://managed.example/video.mp4?access=short-lived',
    'stage:/api/assets/file/source-video',
    'submit',
    'checkpoint:provider-1',
    'query',
  ]);
  assert.equal(deps.calls.submit, 1);
  assert.equal(deps.calls.query, 2);
  assert.equal(result.providerTaskId, 'provider-1');
  assert.equal(result.result.videoUrl, 'https://provider.example/result.mp4');
  assert.equal(result.result.sourceUrl, '/api/assets/file/source-video');
  assert.deepEqual(result.result.subtitleRegionPixels, { x1: 0, y1: 896, x2: 720, y2: 1280 });
  assert.equal(result.result.costRemove, 24);
});

test('existing provider task id is query-only and does not touch source media', async () => {
  const events = [];
  const deps = fakeProviderDeps({ progress: ['success'], events });
  deps.resolveProviderSourceUrl = async (value) => {
    events.push(`stage:${value}`);
    return 'https://provider.example/staged.mp4';
  };
  const result = await runSubtitleRemovalJob({
    job: newSubtitleJob({
      providerTaskId: 'provider-existing',
      payload: {
        ...newSubtitleJob().payload,
        sizeBytes: 15.2 * 1024 * 1024,
        durationSeconds: 9.01,
        width: 720,
        height: 1280,
      },
    }),
    env: enabledEnv(),
    deps,
  });

  assert.equal(deps.calls.submit, 0);
  assert.equal(deps.calls.query, 1);
  assert.deepEqual(events, ['query']);
  assert.equal(result.providerTaskId, 'provider-existing');
});

test('new jobs fail closed when external staging is unavailable', async () => {
  const deps = fakeProviderDeps();
  delete deps.resolveProviderSourceUrl;

  await assert.rejects(
    runSubtitleRemovalJob({
      job: newSubtitleJob(),
      env: enabledEnv(),
      deps,
    }),
    (error) => error?.code === 'provider_internal_error'
      && error?.providerStage === 'preparing_input'
      && error?.providerStatus === 'dependency_missing',
  );

  assert.equal(deps.calls.submit, 0);
  assert.equal(deps.calls.query, 0);
});

test('internal managed video falls back to its public stream URL when the COS resolver returns empty', async () => {
  const events = [];
  const sourceUrl = 'https://meiao.example/api/assets/file/asset-local/source.mp4';
  const deps = fakeProviderDeps({ events, resolvedReadUrl: '' });
  deps.resolveProviderSourceUrl = async () => 'https://provider.example/staged.mp4';

  const result = await runSubtitleRemovalJob({
    job: newSubtitleJob({ payload: {
      ...newSubtitleJob().payload,
      sourceUrl,
    } }),
    env: enabledEnv(),
    deps,
  });

  assert.deepEqual(events.slice(0, 2), [
    `resolve:${sourceUrl}`,
    `probe:${sourceUrl}`,
  ]);
  assert.equal(result.providerTaskId, 'provider-1');
});

test('local internal video is probed through its owned read URL before Golden staging', async () => {
  const events = [];
  const sourceUrl = 'managed://asset-local';
  const controlledReadUrl = 'http://127.0.0.1:3100/api/assets/file/asset-local/source.mp4?asset_key=test';
  const stagedUrl = 'https://file.aiquickdraw.com/mayo-storage/internal/source-staged.mp4';
  let submittedUrl = '';
  const deps = fakeProviderDeps({
    events,
    resolvedReadUrl: controlledReadUrl,
    onSubmitBody: (body) => { submittedUrl = body.url; },
  });
  deps.resolveProviderSourceUrl = async (value) => {
    events.push(`stage:${value}`);
    return stagedUrl;
  };

  await runSubtitleRemovalJob({
    job: newSubtitleJob({ payload: {
      ...newSubtitleJob().payload,
      sourceUrl,
    } }),
    env: enabledEnv(),
    deps,
  });

  assert.deepEqual(events.slice(0, 4), [
    `resolve:${sourceUrl}`,
    `probe:${controlledReadUrl}`,
    `stage:${sourceUrl}`,
    'submit',
  ]);
  assert.equal(submittedUrl, stagedUrl);
});

test('submit network ambiguity stops without retrying the paid request', async () => {
  const deps = fakeProviderDeps({ submitError: new TypeError('fetch failed') });
  deps.resolveProviderSourceUrl = async () => 'https://provider.example/staged.mp4';
  await assert.rejects(
    runSubtitleRemovalJob({ job: newSubtitleJob(), env: enabledEnv(), deps }),
    (error) => error?.code === 'provider_submission_unknown'
      && error?.submissionUnknown === true
      && error?.providerStage === 'provider_submit',
  );
  assert.equal(deps.calls.submit, 1);
  assert.equal(deps.calls.query, 0);
});

test('provider id checkpoint failure retains the paid Golden task identity', async () => {
  const deps = fakeProviderDeps();

  await assert.rejects(
    runSubtitleRemovalJob({
      job: newSubtitleJob(),
      env: enabledEnv(),
      onProviderTaskId: async () => {
        throw Object.assign(new Error('child ledger changed'), {
          code: 'job_state_changed',
        });
      },
      deps,
    }),
    (error) => error?.code === 'provider_internal_error'
      && error?.providerTaskId === 'provider-1'
      && error?.providerStage === 'provider_checkpoint'
      && error?.providerStatus === 'checkpoint_failed'
      && error?.checkpointErrorCode === 'job_state_changed',
  );

  assert.equal(deps.calls.submit, 1);
  assert.equal(deps.calls.query, 0);
});

test('provider balance and terminal failure are humanized', async () => {
  const balanceDeps = fakeProviderDeps({ submitBody: { code: -25, msg: 'balance' } });
  balanceDeps.resolveProviderSourceUrl = async () => 'https://provider.example/staged.mp4';
  await assert.rejects(
    runSubtitleRemovalJob({
      job: newSubtitleJob(),
      env: enabledEnv(),
      deps: balanceDeps,
    }),
    (error) => error?.code === 'provider_balance_insufficient',
  );
  await assert.rejects(
    runSubtitleRemovalJob({
      job: newSubtitleJob({ providerTaskId: 'provider-existing' }),
      env: enabledEnv(),
      deps: fakeProviderDeps({ progress: ['failed'] }),
    }),
    (error) => error?.code === 'provider_job_failed' && /上游处理失败/.test(error.message),
  );
});

test('disabled, unconfigured, aborted, and timed-out jobs fail closed', async () => {
  await assert.rejects(
    runSubtitleRemovalJob({ job: newSubtitleJob(), env: enabledEnv({ MEIAO_SUBTITLE_REMOVAL_ENABLED: '0' }), deps: fakeProviderDeps() }),
    (error) => error?.code === 'subtitle_removal_unavailable',
  );
  await assert.rejects(
    runSubtitleRemovalJob({ job: newSubtitleJob(), env: enabledEnv({ GOLDEN_SUBTITLE_API_TOKEN: '' }), deps: fakeProviderDeps() }),
    (error) => error?.code === 'subtitle_removal_unavailable',
  );

  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    runSubtitleRemovalJob({ job: newSubtitleJob(), env: enabledEnv(), signal: controller.signal, deps: fakeProviderDeps() }),
    (error) => error?.code === 'request_cancelled',
  );

  await assert.rejects(
    runSubtitleRemovalJob({
      job: newSubtitleJob({ providerTaskId: 'provider-existing' }),
      env: enabledEnv(),
      deps: fakeProviderDeps({ progress: ['waiting'], nowValues: [0, 300001] }),
    }),
    (error) => error?.code === 'provider_timeout' && error?.providerTaskId === 'provider-existing',
  );
});
