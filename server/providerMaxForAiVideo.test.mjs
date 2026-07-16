import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildMaxForAiVideoRequest,
  extractMaxForAiVideoResult,
  extractMaxForAiVideoTaskId,
  runMaxForAiVideoJob,
} from './providerMaxForAiVideo.mjs';

const jsonResponse = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

const basePayload = {
  model: 'maxforai-sora-v9-pro',
  prompt: '海边日落',
  seconds: 4,
  aspectRatio: '16:9',
};

const baseEnv = {
  MAXFORAI_VIDEO_API_KEY: 'test-secret-key',
  MAXFORAI_VIDEO_BASE_URL: 'https://max.test/v1',
};

test('builds the exact seedance2.0pro-720 create body', () => {
  assert.deepEqual(buildMaxForAiVideoRequest({
    payload: { ...basePayload, seconds: '4' },
    preparedMedia: {
      images: ['https://temp.test/i'],
      videos: ['https://temp.test/v'],
      audios: ['https://temp.test/a'],
    },
  }), {
    model: 'seedance2.0pro-720',
    prompt: '海边日落',
    seconds: 4,
    aspect_ratio: '16:9',
    images: ['https://temp.test/i'],
    videos: ['https://temp.test/v'],
    audios: ['https://temp.test/a'],
  });
});

test('text-only request omits every media array', () => {
  assert.deepEqual(buildMaxForAiVideoRequest({ payload: basePayload }), {
    model: 'seedance2.0pro-720',
    prompt: '海边日落',
    seconds: 4,
    aspect_ratio: '16:9',
  });
});

test('extracts task and result fields from root or nested response bodies', () => {
  assert.equal(extractMaxForAiVideoTaskId({ data: { id: 'video_nested' } }), 'video_nested');
  assert.deepEqual(extractMaxForAiVideoResult({
    data: { status: 'SUCCEEDED', result_url: 'https://cdn.test/final.mp4' },
  }), {
    status: 'succeeded',
    resultUrl: 'https://cdn.test/final.mp4',
    errorMessage: '',
  });
});

test('checkpoints a new task before polling and returns result_url', async () => {
  const events = [];
  let paidCreateRetryDecision;
  const responses = [
    jsonResponse({ task_id: 'video_123' }),
    jsonResponse({ status: 'queued' }),
    jsonResponse({ status: 'processing' }),
    jsonResponse({ status: 'succeeded', result_url: 'https://cdn.test/final.mp4' }),
  ];
  const output = await runMaxForAiVideoJob({
    payload: basePayload,
    env: baseEnv,
    deps: {
      fetchWithTimeout: async (url, init, _timeoutMessage, _timeoutMs, _stage, retryDecision) => {
        events.push(`${init.method}:${url}`);
        if (url.endsWith('/videos')) paidCreateRetryDecision = retryDecision;
        return responses.shift();
      },
      onProviderTaskId: async (id) => events.push(`checkpoint:${id}`),
      wait: async () => {},
    },
  });

  assert.deepEqual(events, [
    'POST:https://max.test/v1/videos',
    'checkpoint:video_123',
    'GET:https://max.test/v1/videos/video_123',
    'GET:https://max.test/v1/videos/video_123',
    'GET:https://max.test/v1/videos/video_123',
  ]);
  assert.equal(output.providerTaskId, 'video_123');
  assert.equal(output.result.videoUrl, 'https://cdn.test/final.mp4');
  assert.equal(output.result.providerModel, 'seedance2.0pro-720');
  assert.deepEqual(paidCreateRetryDecision, { idempotent: false, maxRetries: 0 });
});

test('recovery with providerTaskId never prepares assets or creates a second paid task', async () => {
  const calls = [];
  let prepareCount = 0;
  const output = await runMaxForAiVideoJob({
    payload: { ...basePayload, imageUrls: ['https://source.test/image.jpg'] },
    providerTaskId: 'video_existing',
    env: baseEnv,
    deps: {
      prepareAsset: async () => {
        prepareCount += 1;
        return 'https://temp.test/unused';
      },
      fetchWithTimeout: async (url, init) => {
        calls.push([url, init.method]);
        return jsonResponse({ status: 'succeeded', result_url: 'https://cdn.test/recovered.mp4' });
      },
      wait: async () => {},
    },
  });

  assert.equal(prepareCount, 0);
  assert.deepEqual(calls, [['https://max.test/v1/videos/video_existing', 'GET']]);
  assert.equal(output.result.videoUrl, 'https://cdn.test/recovered.mp4');
});

test('recovery accepts the real upstream SUCCESS terminal status', async () => {
  const output = await runMaxForAiVideoJob({
    payload: basePayload,
    providerTaskId: 'video_real_success',
    env: baseEnv,
    deps: {
      fetchWithTimeout: async () => jsonResponse({
        status: 'SUCCESS',
        result_url: 'https://cdn.test/real-success.mp4',
      }),
      wait: async () => {},
    },
  });

  assert.equal(output.result.videoUrl, 'https://cdn.test/real-success.mp4');
  assert.equal(output.providerTaskId, 'video_real_success');
});

test('remote HTTPS material uses assets/url before the paid create call', async () => {
  const calls = [];
  await runMaxForAiVideoJob({
    payload: { ...basePayload, imageUrls: ['https://source.test/image.jpg'] },
    env: baseEnv,
    deps: {
      fetchWithTimeout: async (url, init) => {
        calls.push([url, init]);
        if (url.endsWith('/assets/url')) return jsonResponse({ data: { url: 'https://temp.test/image.jpg' } });
        if (url.endsWith('/videos')) return jsonResponse({ id: 'video_asset_url' });
        return jsonResponse({ status: 'succeeded', result_url: 'https://cdn.test/remote.mp4' });
      },
      wait: async () => {},
    },
  });

  assert.equal(calls[0][0], 'https://max.test/v1/assets/url');
  assert.deepEqual(JSON.parse(calls[0][1].body), { url: 'https://source.test/image.jpg' });
  assert.equal(JSON.parse(calls[1][1].body).images[0], 'https://temp.test/image.jpg');
});

test('managed and data material use multipart assets uploads', async () => {
  const calls = [];
  await runMaxForAiVideoJob({
    payload: {
      ...basePayload,
      videoUrls: ['/api/assets/file/reference.mp4'],
      audioUrls: ['data:audio/wav;base64,aGVsbG8='],
    },
    env: baseEnv,
    deps: {
      downloadRemoteProviderMediaUrl: async () => ({
        fileName: 'reference.mp4',
        mimeType: 'video/mp4',
        fileBuffer: Buffer.from('video'),
      }),
      fetchWithTimeout: async (url, init) => {
        calls.push([url, init]);
        if (url.endsWith('/assets')) {
          return jsonResponse({ url: `https://temp.test/${calls.length}` });
        }
        if (url.endsWith('/videos')) return jsonResponse({ task_id: 'video_upload' });
        return jsonResponse({ status: 'succeeded', result_url: 'https://cdn.test/upload.mp4' });
      },
      wait: async () => {},
    },
  });

  const uploadCalls = calls.filter(([url]) => url.endsWith('/assets'));
  assert.equal(uploadCalls.length, 2);
  assert.ok(uploadCalls.every(([, init]) => init.body instanceof FormData));
  assert.ok(uploadCalls.every(([, init]) => init.body.get('file') instanceof Blob));
  const createBody = JSON.parse(calls.find(([url]) => url.endsWith('/videos'))[1].body);
  assert.equal(createBody.videos.length, 1);
  assert.equal(createBody.audios.length, 1);
});

test('asset failure prevents any paid videos call', async () => {
  let paidCreateCount = 0;
  await assert.rejects(
    () => runMaxForAiVideoJob({
      payload: { ...basePayload, imageUrls: ['https://source.test/missing.jpg'] },
      env: baseEnv,
      deps: {
        fetchWithTimeout: async (url) => {
          if (url.endsWith('/videos')) paidCreateCount += 1;
          throw Object.assign(new Error('素材不存在'), { code: 'provider_bad_request' });
        },
      },
    }),
    (error) => error?.providerStage === 'asset_upload' && error?.submissionUnknown !== true,
  );
  assert.equal(paidCreateCount, 0);
});

test('maps known create HTTP failures without retrying the paid request', async () => {
  const cases = [
    [401, 'provider_auth_invalid'],
    [403, 'provider_auth_invalid'],
    [429, 'provider_rate_limited'],
    [400, 'provider_bad_request'],
    [500, 'provider_internal_error'],
  ];
  for (const [status, code] of cases) {
    let count = 0;
    await assert.rejects(
      () => runMaxForAiVideoJob({
        payload: basePayload,
        env: baseEnv,
        deps: {
          fetchWithTimeout: async () => {
            count += 1;
            return jsonResponse({ message: `known ${status}` }, status);
          },
        },
      }),
      (error) => error?.code === code,
      String(status),
    );
    assert.equal(count, 1, String(status));
  }
});

test('create transport failure becomes submission unknown without retry', async () => {
  let createCount = 0;
  await assert.rejects(
    () => runMaxForAiVideoJob({
      payload: basePayload,
      env: baseEnv,
      deps: {
        fetchWithTimeout: async () => {
          createCount += 1;
          throw Object.assign(new Error('socket closed'), { code: 'provider_network_error' });
        },
      },
    }),
    (error) => error?.code === 'provider_submission_unknown'
      && error?.submissionUnknown === true
      && error?.providerStage === 'provider_submission',
  );
  assert.equal(createCount, 1);
});

test('paid create response body disconnect is also submission unknown', async () => {
  await assert.rejects(
    () => runMaxForAiVideoJob({
      payload: basePayload,
      env: baseEnv,
      deps: {
        fetchWithTimeout: async () => ({
          ok: true,
          status: 200,
          json: async () => {
            throw Object.assign(new Error('body disconnected'), { code: 'provider_network_error' });
          },
        }),
      },
    }),
    (error) => error?.code === 'provider_submission_unknown' && error?.submissionUnknown === true,
  );
});

test('checkpoint failure preserves the newly-created provider task id', async () => {
  await assert.rejects(
    () => runMaxForAiVideoJob({
      payload: basePayload,
      env: baseEnv,
      deps: {
        fetchWithTimeout: async () => jsonResponse({ task_id: 'video_checkpoint' }),
        onProviderTaskId: async () => {
          throw new Error('checkpoint unavailable');
        },
      },
    }),
    (error) => error?.providerTaskId === 'video_checkpoint'
      && error?.providerStage === 'provider_submission',
  );
});

test('successful create response without a task id is a bad response', async () => {
  await assert.rejects(
    () => runMaxForAiVideoJob({
      payload: basePayload,
      env: baseEnv,
      deps: { fetchWithTimeout: async () => jsonResponse({ status: 'queued' }) },
    }),
    (error) => error?.code === 'provider_bad_response' && error?.providerStage === 'provider_submission',
  );
});

test('failed task status preserves the provider task id', async () => {
  await assert.rejects(
    () => runMaxForAiVideoJob({
      payload: basePayload,
      providerTaskId: 'video_failed',
      env: baseEnv,
      deps: {
        fetchWithTimeout: async () => jsonResponse({ status: 'failed', message: '生成失败' }),
        wait: async () => {},
      },
    }),
    (error) => error?.code === 'provider_bad_request'
      && error?.providerTaskId === 'video_failed'
      && error?.providerStage === 'polling',
  );
});

test('succeeded task without result_url is a bad response with task id', async () => {
  await assert.rejects(
    () => runMaxForAiVideoJob({
      payload: basePayload,
      providerTaskId: 'video_empty',
      env: baseEnv,
      deps: {
        fetchWithTimeout: async () => jsonResponse({ status: 'succeeded' }),
        wait: async () => {},
      },
    }),
    (error) => error?.code === 'provider_bad_response' && error?.providerTaskId === 'video_empty',
  );
});

test('cancellation while polling preserves the provider task id', async () => {
  const controller = new AbortController();
  await assert.rejects(
    () => runMaxForAiVideoJob({
      payload: basePayload,
      providerTaskId: 'video_cancelled',
      env: baseEnv,
      signal: controller.signal,
      deps: {
        fetchWithTimeout: async () => {
          controller.abort();
          return jsonResponse({ status: 'processing' });
        },
        wait: async () => {},
      },
    }),
    (error) => error?.code === 'request_cancelled'
      && error?.providerTaskId === 'video_cancelled'
      && error?.providerStage === 'polling',
  );
});

test('poll timeout preserves the provider task id', async () => {
  let clock = 0;
  await assert.rejects(
    () => runMaxForAiVideoJob({
      payload: basePayload,
      providerTaskId: 'video_timeout',
      env: { ...baseEnv, MAXFORAI_VIDEO_POLL_TIMEOUT_MS: '1' },
      deps: {
        fetchWithTimeout: async () => jsonResponse({ status: 'processing' }),
        wait: async () => {},
        now: () => {
          clock += 2;
          return clock;
        },
      },
    }),
    (error) => error?.code === 'provider_timeout'
      && error?.providerTaskId === 'video_timeout'
      && error?.providerStage === 'polling',
  );
});

test('provider errors never expose the Authorization secret', async () => {
  await assert.rejects(
    () => runMaxForAiVideoJob({
      payload: basePayload,
      env: baseEnv,
      deps: {
        fetchWithTimeout: async () => jsonResponse({
          message: 'Authorization: Bearer test-secret-key',
        }, 401),
      },
    }),
    (error) => error?.code === 'provider_auth_invalid'
      && !String(error?.message || '').includes('test-secret-key'),
  );
});
