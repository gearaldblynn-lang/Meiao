import test from 'node:test';
import assert from 'node:assert/strict';

import { executeProviderJob, uploadAssetViaKieStream, __testOnly_setDreaminaVideoRunner, __testOnly_fetchKieWithTimeout, __testOnly_getKieHttpRetryDelayMs } from './providerGateway.mjs';
import { __testOnly_clearManagedAssetUploadCache } from './providerAssetTransfer.mjs';
import { __testOnly_resetKieAssetUploadLimiters } from './providerAssetUploadLimiter.mjs';

// 请求级瞬时重试(S2 G1)默认退避 1s/3s,测试里统一压到 1ms,
// 避免走到 fetch failed / 5xx 路径的既有测试被退避拖慢。
process.env.MEIAO_KIE_HTTP_RETRY_BASE_MS = '1';

const createJsonResponse = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

const box = (type, payload = Buffer.alloc(0)) => {
  const buffer = Buffer.alloc(8 + payload.length);
  buffer.writeUInt32BE(buffer.length, 0);
  buffer.write(type, 4, 4, 'ascii');
  payload.copy(buffer, 8);
  return buffer;
};

const createMp4WithDuration = (seconds) => {
  const payload = Buffer.alloc(100);
  payload.writeUInt8(0, 0);
  payload.writeUInt32BE(0, 4);
  payload.writeUInt32BE(0, 8);
  payload.writeUInt32BE(1000, 12);
  payload.writeUInt32BE(Math.round(seconds * 1000), 16);
  return Buffer.concat([
    box('ftyp', Buffer.from('isom0000isom', 'ascii')),
    box('moov', box('mvhd', payload)),
  ]);
};

test('executeProviderJob 路由 openai_tool_calling 到新 provider', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    choices: [{ finish_reason: 'stop', message: { content: 'routed-ok' } }],
  }), { status: 200 });
  try {
    const out = await executeProviderJob(
      { taskType: 'openai_tool_calling', payload: { model: 'gpt-5.4', messages: [{ role: 'user', content: 'hi' }] } },
      { OPENAI_COMPATIBLE_API_KEY: 'sk-test', OPENAI_COMPATIBLE_BASE_URL: 'https://relay.test', OPENAI_COMPATIBLE_MODELS: 'gpt-5.4' },
      null
    );
    assert.equal(out.content, 'routed-ok');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('executeProviderJob 路由 openai_responses 到 responses provider', async () => {
  const realFetch = globalThis.fetch;
  let captured = null;
  globalThis.fetch = async (url, init = {}) => {
    captured = {
      url: String(url),
      body: JSON.parse(init.body),
    };
    return new Response(JSON.stringify({
      output: [
        {
          type: 'message',
          content: [{ type: 'output_text', text: 'responses-ok' }],
        },
      ],
    }), { status: 200 });
  };
  try {
    const out = await executeProviderJob(
      {
        taskType: 'openai_responses',
        payload: {
          model: 'gpt-5.4',
          messages: [{ role: 'user', content: 'hi' }],
          tools: [{ type: 'web_search' }],
        },
      },
      {
        OPENAI_COMPATIBLE_API_KEY: 'sk-test',
        OPENAI_COMPATIBLE_BASE_URL: 'https://relay.test',
        OPENAI_COMPATIBLE_MODELS: 'gpt-5.4',
      },
      new AbortController().signal
    );
    assert.equal(out.content, 'responses-ok');
    assert.match(captured.url, /\/v1\/responses$/);
    assert.deepEqual(captured.body.tools, [{ type: 'web_search' }]);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('executeProviderJob rejects disguised upstream errors from kie responses chat transport', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => createJsonResponse({
    output: [
      {
        type: 'message',
        content: [{ type: 'output_text', text: 'Interal error: HTTP 500' }],
      },
    ],
  });
  try {
    await assert.rejects(
      () => executeProviderJob(
        {
          taskType: 'kie_chat',
          payload: {
            model: 'gpt-5-4',
            messages: [{ role: 'user', content: 'hi' }],
          },
        },
        { KIE_API_KEY: 'test-key' },
        new AbortController().signal
      ),
      (error) => error?.code === 'provider_internal_error'
        && /Interal error: HTTP 500/.test(error.message)
    );
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('executeProviderJob ignores error and errors keys when extracting kie responses text', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => createJsonResponse({
    output: [
      {
        type: 'message',
        content: [
          {
            type: 'output_text',
            text: '真实策划内容',
            error: 'Interal error: HTTP 500',
            errors: ['Internal server error'],
          },
        ],
      },
    ],
  });
  try {
    const result = await executeProviderJob(
      {
        taskType: 'kie_chat',
        payload: {
          model: 'gpt-5-4',
          messages: [{ role: 'user', content: 'hi' }],
        },
      },
      { KIE_API_KEY: 'test-key' },
      new AbortController().signal
    );
    assert.equal(result.result.content, '真实策划内容');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('executeProviderJob passes onDelta through to openai_responses streaming provider', async () => {
  const realFetch = globalThis.fetch;
  let captured = null;
  globalThis.fetch = async (url, init = {}) => {
    void url;
    captured = JSON.parse(init.body);
    return new Response(new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        controller.enqueue(encoder.encode('event: response.output_text.delta\n'));
        controller.enqueue(encoder.encode('data: {"type":"response.output_text.delta","delta":"流"}\n\n'));
        controller.enqueue(encoder.encode('event: response.output_text.delta\n'));
        controller.enqueue(encoder.encode('data: {"type":"response.output_text.delta","delta":"式"}\n\n'));
        controller.enqueue(encoder.encode('event: response.completed\n'));
        controller.enqueue(encoder.encode('data: {"type":"response.completed","response":{"usage":{"output_tokens":2}}}\n\n'));
        controller.close();
      },
    }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  };
  try {
    const deltas = [];
    const out = await executeProviderJob(
      {
        taskType: 'openai_responses',
        payload: {
          model: 'gpt-5.4',
          messages: [{ role: 'user', content: 'hi' }],
        },
      },
      {
        OPENAI_COMPATIBLE_API_KEY: 'sk-test',
        OPENAI_COMPATIBLE_BASE_URL: 'https://relay.test',
        OPENAI_COMPATIBLE_MODELS: 'gpt-5.4',
      },
      new AbortController().signal,
      { onDelta: (delta) => deltas.push(delta) }
    );
    assert.equal(captured.stream, true);
    assert.deepEqual(deltas, ['流', '式']);
    assert.equal(out.content, '流式');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('uploadAssetViaKieStream uses configured asset upload timeout', async () => {
  const originalFetch = global.fetch;
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  const timeouts = [];

  global.fetch = async () => createJsonResponse({
    code: 200,
    data: { fileUrl: 'https://kie.example.com/uploaded.png' },
  });
  global.setTimeout = (_handler, timeoutMs) => {
    timeouts.push(timeoutMs);
    return 0;
  };
  global.clearTimeout = () => {};

  try {
    const result = await uploadAssetViaKieStream({
      fileBuffer: Buffer.from('png'),
      mimeType: 'image/png',
      fileName: 'source.png',
    }, {
      KIE_API_KEY: 'test-key',
      MEIAO_KIE_ASSET_UPLOAD_TIMEOUT_MS: '12345',
    });

    assert.equal(result.result.fileUrl, 'https://kie.example.com/uploaded.png');
    assert.ok(timeouts.includes(12345));
  } finally {
    global.fetch = originalFetch;
    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
  }
});

test('uploadAssetViaKieStream applies the process-wide upload concurrency limit', async () => {
  __testOnly_resetKieAssetUploadLimiters();
  const originalFetch = global.fetch;
  let active = 0;
  let maxActive = 0;

  global.fetch = async () => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
    return createJsonResponse({
      code: 200,
      data: { fileUrl: 'https://kie.example.com/uploaded.png' },
    });
  };

  try {
    await Promise.all(Array.from({ length: 6 }, (_, index) => uploadAssetViaKieStream({
      fileBuffer: Buffer.from(`png-${index}`),
      mimeType: 'image/png',
      fileName: `source-${index}.png`,
    }, {
      KIE_API_KEY: 'test-key',
      MEIAO_KIE_ASSET_UPLOAD_CONCURRENCY: '2',
      MEIAO_KIE_ASSET_UPLOAD_RETRIES: '0',
    })));

    assert.equal(maxActive, 2);
  } finally {
    global.fetch = originalFetch;
    __testOnly_resetKieAssetUploadLimiters();
  }
});

test('uploadAssetViaKieStream retries retryable response errors within its transfer budget', async () => {
  __testOnly_resetKieAssetUploadLimiters();
  const originalFetch = global.fetch;
  let calls = 0;

  global.fetch = async () => {
    calls += 1;
    if (calls < 3) return createJsonResponse({ msg: 'temporary upload outage' }, 503);
    return createJsonResponse({
      code: 200,
      data: { fileUrl: 'https://kie.example.com/recovered.png' },
    });
  };

  try {
    const result = await uploadAssetViaKieStream({
      fileBuffer: Buffer.from('png'),
      mimeType: 'image/png',
      fileName: 'source.png',
    }, {
      KIE_API_KEY: 'test-key',
      MEIAO_KIE_ASSET_UPLOAD_RETRIES: '2',
      MEIAO_KIE_ASSET_UPLOAD_RETRY_BASE_MS: '1',
    });

    assert.equal(result.result.fileUrl, 'https://kie.example.com/recovered.png');
    assert.equal(calls, 3);
  } finally {
    global.fetch = originalFetch;
    __testOnly_resetKieAssetUploadLimiters();
  }
});

test('executeProviderJob uploads base64 asset payloads through stream upload only', async () => {
  const originalFetch = global.fetch;
  const requests = [];

  global.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    if (String(url).includes('/file-stream-upload')) {
      return createJsonResponse({
        code: 200,
        data: { fileUrl: 'https://kie.example.com/stream-only.png' },
      });
    }
    if (String(url).includes('/file-base64-upload')) {
      throw new Error('base64 upload endpoint must not be used');
    }
    throw new Error(`unexpected request: ${String(url)}`);
  };

  try {
    const result = await executeProviderJob(
      {
        taskType: 'upload_asset',
        payload: {
          base64Data: 'aGVsbG8=',
          mimeType: 'image/png',
          fileName: 'source.png',
        },
      },
      { KIE_API_KEY: 'test-key' },
      new AbortController().signal
    );

    assert.equal(result.result.fileUrl, 'https://kie.example.com/stream-only.png');
    assert.equal(requests.filter((item) => item.url.includes('/file-stream-upload')).length, 1);
    assert.equal(requests.some((item) => item.url.includes('/file-base64-upload')), false);
  } finally {
    global.fetch = originalFetch;
  }
});

test('executeProviderJob can probe a submitted KIE image task without long polling', async () => {
  const realFetch = globalThis.fetch;
  let capturedUrl = '';
  globalThis.fetch = async (url) => {
    capturedUrl = String(url);
    return createJsonResponse({
      code: 200,
      data: {
        state: 'success',
        resultJson: JSON.stringify({ resultUrls: ['https://cdn.test/image.png'] }),
      },
    });
  };
  try {
    const out = await executeProviderJob(
      { taskType: 'kie_probe', payload: { providerTaskId: 'kie-task-1' } },
      { KIE_API_KEY: 'kie-test' },
      new AbortController().signal
    );
    assert.match(capturedUrl, /\/api\/v1\/jobs\/recordInfo\?taskId=kie-task-1$/);
    assert.equal(out.providerTaskId, 'kie-task-1');
    assert.equal(out.providerStatus, 'success');
    assert.equal(out.result.imageUrl, 'https://cdn.test/image.png');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('executeProviderJob routes dreamina frames2video jobs through the dreamina cli adapter', async () => {
  const calls = [];
  __testOnly_setDreaminaVideoRunner(async (payload) => {
    calls.push(payload);
    return {
      providerTaskId: 'dreamina-submit-1',
      providerStage: 'completed',
      providerStatus: 'success',
      result: {
        videoUrl: 'https://example.com/dreamina-video.mp4',
        mediaType: 'video',
        status: 'success',
      },
    };
  });

  try {
    const result = await executeProviderJob(
      {
        taskType: 'dreamina_video',
        provider: 'dreamina',
        payload: {
          mode: 'frames2video',
          imageUrls: ['https://example.com/start.png', 'https://example.com/end.png'],
          prompt: 'camera push in',
          duration: 5,
          videoResolution: '720p',
          modelVersion: 'seedance2.0fast',
        },
      },
      {},
      new AbortController().signal
    );

    assert.equal(calls.length, 1);
    assert.equal(calls[0].mode, 'frames2video');
    assert.deepEqual(calls[0].imageUrls, ['https://example.com/start.png', 'https://example.com/end.png']);
    assert.equal(result.providerTaskId, 'dreamina-submit-1');
    assert.equal(result.result.mediaType, 'video');
    assert.equal(result.result.videoUrl, 'https://example.com/dreamina-video.mp4');
  } finally {
    __testOnly_setDreaminaVideoRunner(null);
  }
});

test('executeProviderJob checkpoints Dreamina submitId before the first poll', async () => {
  const originalFetch = global.fetch;
  const events = [];
  global.fetch = async (url) => {
    if (String(url).includes('/api/assets/file/')) {
      return new Response(Buffer.from([0xff, 0xd8, 0xff, 0xd9]), {
        status: 200,
        headers: { 'content-type': 'image/jpeg', 'content-length': '4' },
      });
    }
    throw new Error(`unexpected request: ${String(url)}`);
  };

  try {
    const result = await executeProviderJob(
      {
        taskType: 'dreamina_video',
        payload: {
          mode: 'multimodal2video',
          prompt: 'checkpoint before poll',
          imageUrls: ['/api/assets/file/dreamina/source.jpg'],
          duration: 5,
        },
      },
      { MEIAO_PUBLIC_BASE_URL: 'https://meiaoyuntai.com' },
      new AbortController().signal,
      {
        dreaminaSubmitVideoTask: async () => {
          events.push('submitted');
          return { submitId: 'dreamina-checkpoint-id', status: 'running' };
        },
        dreaminaQueryVideoTask: async () => {
          events.push('polled');
          return { status: 'success', videoUrl: 'https://example.com/dreamina-checkpoint.mp4' };
        },
        onProviderTaskId: async (taskId) => events.push(`checkpoint:${taskId}`),
      }
    );

    assert.deepEqual(events, ['submitted', 'checkpoint:dreamina-checkpoint-id', 'polled']);
    assert.equal(result.providerTaskId, 'dreamina-checkpoint-id');
    assert.equal(result.result.videoUrl, 'https://example.com/dreamina-checkpoint.mp4');
  } finally {
    global.fetch = originalFetch;
  }
});

test('executeProviderJob retains Dreamina submitId when the durable checkpoint fails', async () => {
  const originalFetch = global.fetch;
  let pollCalls = 0;
  global.fetch = async (url) => {
    if (String(url).includes('/api/assets/file/')) {
      return new Response(Buffer.from([0xff, 0xd8, 0xff, 0xd9]), {
        status: 200,
        headers: { 'content-type': 'image/jpeg', 'content-length': '4' },
      });
    }
    throw new Error(`unexpected request: ${String(url)}`);
  };

  try {
    await assert.rejects(
      () => executeProviderJob(
        {
          taskType: 'dreamina_video',
          payload: {
            mode: 'multimodal2video',
            prompt: 'checkpoint failure must recover old task',
            imageUrls: ['/api/assets/file/dreamina/checkpoint-failure.jpg'],
            duration: 5,
          },
        },
        { MEIAO_PUBLIC_BASE_URL: 'https://meiaoyuntai.com' },
        new AbortController().signal,
        {
          dreaminaSubmitVideoTask: async () => ({
            submitId: 'dreamina-paid-checkpoint-id',
            status: 'running',
          }),
          dreaminaQueryVideoTask: async () => {
            pollCalls += 1;
            return { status: 'success', videoUrl: 'https://example.com/must-not-poll.mp4' };
          },
          onProviderTaskId: async () => {
            throw Object.assign(new Error('checkpoint write failed'), { code: 'ER_LOCK_DEADLOCK' });
          },
        }
      ),
      (error) => error?.code === 'provider_internal_error'
        && error?.providerTaskId === 'dreamina-paid-checkpoint-id'
        && error?.providerStage === 'provider_checkpoint'
        && error?.checkpointErrorCode === 'ER_LOCK_DEADLOCK'
    );
    assert.equal(pollCalls, 0);
  } finally {
    global.fetch = originalFetch;
  }
});

test('executeProviderJob submits seedance fast video jobs through kie api and preserves real credits', async () => {
  const originalFetch = global.fetch;
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  const requests = [];

  global.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    if (String(url).includes('/api/v1/jobs/createTask')) {
      return createJsonResponse({ code: 200, msg: 'success', data: { taskId: 'seedance-api-task-1' } });
    }
    return createJsonResponse({
      code: 200,
      data: {
        state: 'success',
        resultJson: JSON.stringify({ resultUrls: ['https://example.com/seedance-result.mp4'] }),
        creditsConsumed: 45.5,
        usage: { credits_per_second: 9, seconds: 5 },
        model: 'bytedance/seedance-2-fast',
      },
    });
  };
  global.setTimeout = (handler, ms) => {
    if (ms === 60_000) {
      return originalSetTimeout(handler, ms);
    }
    queueMicrotask(handler);
    return 0;
  };
  global.clearTimeout = (id) => originalClearTimeout(id);

  try {
    const result = await executeProviderJob(
      {
        taskType: 'kie_seedance_video',
        provider: 'kie',
        payload: {
          mode: 'frames2video',
          prompt: 'camera push in',
          imageUrls: ['https://example.com/start.png', 'https://example.com/end.png'],
          duration: 5,
          aspectRatio: '9:16',
          resolution: '480p',
          generateAudio: false,
        },
      },
      { KIE_API_KEY: 'test-key' },
      new AbortController().signal
    );

    const createTaskBody = JSON.parse(requests[0].init.body);
    assert.equal(createTaskBody.model, 'bytedance/seedance-2-fast');
    assert.equal(createTaskBody.input.prompt, 'camera push in');
    assert.equal(createTaskBody.input.first_frame_url, 'https://example.com/start.png');
    assert.equal(createTaskBody.input.last_frame_url, 'https://example.com/end.png');
    assert.equal(createTaskBody.input.duration, 5);
    assert.equal(createTaskBody.input.aspect_ratio, '9:16');
    assert.equal(createTaskBody.input.resolution, '480p');
    assert.equal(createTaskBody.input.generate_audio, false);
    assert.equal(result.providerTaskId, 'seedance-api-task-1');
    assert.equal(result.result.videoUrl, 'https://example.com/seedance-result.mp4');
    assert.equal(result.result.creditsConsumed, 45.5);
    assert.deepEqual(result.result.usage, { credits_per_second: 9, seconds: 5 });
  } finally {
    global.fetch = originalFetch;
    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
  }
});

test('executeProviderJob blocks seedance api reference videos when total duration exceeds provider limit', async () => {
  const originalFetch = global.fetch;
  const requests = [];

  global.fetch = async (url) => {
    requests.push(String(url));
    if (String(url).includes('/api/assets/file/')) {
      return new Response(createMp4WithDuration(53), {
        status: 200,
        headers: { 'content-type': 'video/mp4' },
      });
    }
    return createJsonResponse({ code: 200, msg: 'unexpected', data: { taskId: 'should-not-create' } });
  };

  try {
    await assert.rejects(
      () => executeProviderJob(
        {
          taskType: 'kie_seedance_video',
          provider: 'kie',
          payload: {
            mode: 'multimodal2video',
            prompt: 'add product naturally',
            imageUrls: ['https://example.com/product.png'],
            videoUrls: ['/api/assets/file/ref/source.mp4'],
            duration: 15,
          },
        },
        { KIE_API_KEY: 'test-key' },
        new AbortController().signal
      ),
      (error) => {
        assert.equal(error.code, 'provider_bad_request');
        assert.match(error.message, /参考视频合计时长/);
        assert.match(error.message, /53/);
        assert.match(error.message, /15/);
        return true;
      }
    );
    assert.equal(requests.some((url) => url.includes('/api/v1/jobs/createTask')), false);
  } finally {
    global.fetch = originalFetch;
  }
});

test('executeProviderJob allows seedance reference videos within provider duration limit regardless of requested duration', async () => {
  const originalFetch = global.fetch;
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  const requests = [];

  global.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    if (String(url).includes('/api/assets/file/')) {
      return new Response(createMp4WithDuration(10), {
        status: 200,
        headers: { 'content-type': 'video/mp4' },
      });
    }
    if (String(url).includes('/api/file-stream-upload')) {
      return createJsonResponse({ code: 200, data: { fileUrl: 'https://tempfile.redpandaai.co/source.mp4' } });
    }
    if (String(url).includes('/api/v1/jobs/createTask')) {
      return createJsonResponse({ code: 200, msg: 'success', data: { taskId: 'seedance-reference-ok' } });
    }
    return createJsonResponse({
      code: 200,
      data: {
        state: 'success',
        resultJson: JSON.stringify({ resultUrls: ['https://example.com/seedance-reference-ok.mp4'] }),
      },
    });
  };
  global.setTimeout = (handler, ms) => {
    if (ms === 60_000) return originalSetTimeout(handler, ms);
    queueMicrotask(handler);
    return 0;
  };
  global.clearTimeout = (id) => originalClearTimeout(id);

  try {
    const result = await executeProviderJob(
      {
        taskType: 'kie_seedance_video',
        provider: 'kie',
        payload: {
          mode: 'multimodal2video',
          prompt: 'extend product shot',
          videoUrls: ['/api/assets/file/ref/source.mp4'],
          duration: 10,
        },
      },
      { KIE_API_KEY: 'test-key' },
      new AbortController().signal
    );

    const createTaskRequest = requests.find((request) => request.url.includes('/api/v1/jobs/createTask'));
    assert.ok(createTaskRequest);
    const createTaskBody = JSON.parse(createTaskRequest.init.body);
    assert.equal(createTaskBody.input.duration, 10);
    assert.deepEqual(createTaskBody.input.reference_video_urls, ['https://tempfile.redpandaai.co/source.mp4']);
    assert.equal(result.providerTaskId, 'seedance-reference-ok');
    assert.equal(result.result.videoUrl, 'https://example.com/seedance-reference-ok.mp4');
  } finally {
    global.fetch = originalFetch;
    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
  }
});

test('executeProviderJob limits seedance video managed asset transfer concurrency', async () => {
  const originalFetch = global.fetch;
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  let activeAssetDownloads = 0;
  let maxActiveAssetDownloads = 0;

  global.fetch = async (url, init = {}) => {
    const requestUrl = String(url);
    if (requestUrl.startsWith('http://127.0.0.1:3100/api/assets/file/')) {
      activeAssetDownloads += 1;
      maxActiveAssetDownloads = Math.max(maxActiveAssetDownloads, activeAssetDownloads);
      await new Promise((resolve) => originalSetTimeout(resolve, 5));
      activeAssetDownloads -= 1;
      return new Response(Buffer.from([0xff, 0xd8, 0xff]), {
        status: 200,
        headers: {
          'content-type': 'image/jpeg',
          'content-length': '3',
        },
      });
    }
    if (requestUrl.includes('/api/file-stream-upload')) {
      return createJsonResponse({ code: 200, data: { fileUrl: `https://kie.example/upload-${Date.now()}.jpg` } });
    }
    if (requestUrl.includes('/api/v1/jobs/createTask')) {
      return createJsonResponse({ code: 200, msg: 'success', data: { taskId: 'seedance-limited-transfer-task' } });
    }
    return createJsonResponse({
      code: 200,
      data: {
        state: 'success',
        resultJson: JSON.stringify({ resultUrls: ['https://example.com/seedance-limited-result.mp4'] }),
      },
    });
  };
  global.setTimeout = (handler, ms) => {
    if (ms === 60_000) {
      return originalSetTimeout(handler, ms);
    }
    queueMicrotask(handler);
    return 0;
  };
  global.clearTimeout = (id) => originalClearTimeout(id);

  try {
    const result = await executeProviderJob(
      {
        taskType: 'kie_seedance_video',
        provider: 'kie',
        payload: {
          mode: 'multimodal2video',
          prompt: 'show product',
          imageUrls: [
            '/api/assets/file/a/1.jpg',
            '/api/assets/file/b/2.jpg',
            '/api/assets/file/c/3.jpg',
            '/api/assets/file/d/4.jpg',
          ],
          duration: 5,
        },
      },
      {
        KIE_API_KEY: 'test-key',
        MEIAO_KIE_VIDEO_MEDIA_RESOLUTION_CONCURRENCY: '2',
      },
      new AbortController().signal
    );

    assert.equal(result.result.videoUrl, 'https://example.com/seedance-limited-result.mp4');
    assert.equal(maxActiveAssetDownloads, 2);
  } finally {
    global.fetch = originalFetch;
    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
  }
});

test('executeProviderJob retries Seedance direct managed video once after explicit media read failure', async () => {
  __testOnly_clearManagedAssetUploadCache();
  const originalFetch = global.fetch;
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  const requests = [];
  const directVideoUrl = 'https://meiaoyuntai.com/api/assets/file/seedance/reference.mp4';
  const stagedVideoUrl = 'https://tempfile.redpandaai.co/kieai/30590/mayo-storage/internal/reference.mp4';
  let createCalls = 0;

  global.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    if (String(url).includes('/api/assets/file/')) {
      return new Response(createMp4WithDuration(10), {
        status: 200,
        headers: { 'content-type': 'video/mp4' },
      });
    }
    if (String(url).includes('/file-stream-upload')) {
      return createJsonResponse({ code: 200, data: { fileUrl: stagedVideoUrl } });
    }
    if (String(url).includes('/api/v1/jobs/createTask')) {
      createCalls += 1;
      if (createCalls === 1) {
        return createJsonResponse({ code: 400, msg: 'Failed to get the file information' }, 400);
      }
      return createJsonResponse({ code: 200, data: { taskId: 'seedance-direct-fallback-task' } });
    }
    if (String(url).includes('/recordInfo')) {
      return createJsonResponse({
        code: 200,
        data: {
          state: 'success',
          resultJson: JSON.stringify({ resultUrls: ['https://example.com/seedance-fallback.mp4'] }),
        },
      });
    }
    throw new Error(`unexpected request: ${String(url)}`);
  };
  global.setTimeout = (handler, ms) => {
    if (ms === 60_000) return originalSetTimeout(handler, ms);
    queueMicrotask(handler);
    return 0;
  };
  global.clearTimeout = (id) => originalClearTimeout(id);

  try {
    const result = await executeProviderJob(
      {
        module: 'video',
        subFeature: 'generation',
        taskType: 'kie_seedance_video',
        payload: {
          mode: 'multimodal2video',
          prompt: 'extend the reference video',
          videoUrls: ['/api/assets/file/seedance/reference.mp4'],
          duration: 5,
        },
      },
      {
        KIE_API_KEY: 'test-key',
        MEIAO_PUBLIC_BASE_URL: 'https://meiaoyuntai.com',
        MEIAO_KIE_MANAGED_ASSET_MODE: 'direct-first',
        MEIAO_KIE_ASSET_UPLOAD_RETRIES: '0',
      },
      new AbortController().signal
    );

    const createBodies = requests
      .filter((item) => item.url.includes('/api/v1/jobs/createTask'))
      .map((item) => JSON.parse(String(item.init.body)));
    assert.equal(createBodies.length, 2);
    assert.deepEqual(createBodies[0].input.reference_video_urls, [directVideoUrl]);
    assert.deepEqual(createBodies[1].input.reference_video_urls, [stagedVideoUrl]);
    assert.equal(createBodies[0].model, createBodies[1].model);
    assert.equal(createBodies[0].input.prompt, createBodies[1].input.prompt);
    assert.equal(requests.filter((item) => item.url.includes('/file-stream-upload')).length, 1);
    assert.equal(result.providerTaskId, 'seedance-direct-fallback-task');
    assert.equal(result.providerMediaRoute, 'kie-fallback');
    assert.equal(result.result.videoUrl, 'https://example.com/seedance-fallback.mp4');
  } finally {
    global.fetch = originalFetch;
    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
  }
});

test('executeProviderJob never retries Seedance create after ambiguous HTTP 502', async () => {
  __testOnly_clearManagedAssetUploadCache();
  const originalFetch = global.fetch;
  const requests = [];

  global.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    if (String(url).includes('/api/v1/jobs/createTask')) {
      return createJsonResponse({ code: 502, msg: 'Bad gateway' }, 502);
    }
    throw new Error(`unexpected request: ${String(url)}`);
  };

  try {
    await assert.rejects(
      () => executeProviderJob(
        {
          module: 'video',
          taskType: 'kie_seedance_video',
          payload: {
            mode: 'frames2video',
            prompt: 'do not duplicate',
            imageUrls: ['https://example.com/start.png', 'https://example.com/end.png'],
            duration: 5,
          },
        },
        {
          KIE_API_KEY: 'test-key',
          MEIAO_PUBLIC_BASE_URL: 'https://meiaoyuntai.com',
          MEIAO_KIE_MANAGED_ASSET_MODE: 'direct-first',
        },
        new AbortController().signal
      ),
      (error) => error?.code === 'provider_internal_error'
        && Number(error?.providerHttpStatus) === 502
    );

    assert.equal(requests.filter((item) => item.url.includes('/api/v1/jobs/createTask')).length, 1);
    assert.equal(requests.filter((item) => item.url.includes('/file-stream-upload')).length, 0);
  } finally {
    global.fetch = originalFetch;
  }
});

test('executeProviderJob limits video storyboard KIE chat media resolution concurrency', async () => {
  __testOnly_clearManagedAssetUploadCache();
  const originalFetch = global.fetch;
  let activeAssetDownloads = 0;
  let maxActiveAssetDownloads = 0;
  let uploadCount = 0;

  global.fetch = async (url) => {
    const requestUrl = String(url);
    if (requestUrl.includes('/api/assets/file/')) {
      activeAssetDownloads += 1;
      maxActiveAssetDownloads = Math.max(maxActiveAssetDownloads, activeAssetDownloads);
      await new Promise((resolve) => setTimeout(resolve, 5));
      activeAssetDownloads -= 1;
      return new Response(Buffer.from([0xff, 0xd8, 0xff, 0xd9]), {
        status: 200,
        headers: { 'content-type': 'image/jpeg', 'content-length': '4' },
      });
    }
    if (requestUrl.includes('/file-stream-upload')) {
      uploadCount += 1;
      return createJsonResponse({
        code: 200,
        data: { fileUrl: `https://kie.example/storyboard-${uploadCount}.jpg` },
      });
    }
    if (requestUrl.includes('/gemini-3.1-pro/v1/chat/completions')) {
      return createJsonResponse({ choices: [{ message: { content: '[{"shot":1}]' } }] });
    }
    throw new Error(`unexpected request: ${requestUrl}`);
  };

  try {
    const result = await executeProviderJob(
      {
        module: 'video',
        subFeature: 'storyboard',
        taskType: 'kie_chat',
        payload: {
          model: 'gemini-3.1-pro-openai',
          messages: [
            {
              role: 'user',
              content: [
                { type: 'image_url', image_url: { url: '/api/assets/file/a/1.jpg' } },
                { type: 'image_url', image_url: { url: '/api/assets/file/b/2.jpg' } },
              ],
            },
            {
              role: 'user',
              content: [
                { type: 'image_url', image_url: { url: '/api/assets/file/c/3.jpg' } },
                { type: 'image_url', image_url: { url: '/api/assets/file/d/4.jpg' } },
              ],
            },
          ],
        },
      },
      {
        KIE_API_KEY: 'test-key',
        MEIAO_PUBLIC_BASE_URL: 'http://111.229.66.247',
        MEIAO_KIE_CHAT_MEDIA_RESOLUTION_CONCURRENCY: '2',
      },
      new AbortController().signal
    );

    assert.equal(result.result.content, '[{"shot":1}]');
    assert.equal(maxActiveAssetDownloads, 2);
    assert.equal(uploadCount, 4);
  } finally {
    global.fetch = originalFetch;
  }
});

test('executeProviderJob keeps polling kie image jobs when recordInfo is temporarily not found', async () => {
  const originalFetch = global.fetch;
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  const seenProviderTaskIds = [];
  const responses = [
    createJsonResponse({ code: 200, data: { taskId: 'kie-task-1' } }),
    createJsonResponse({ code: 404, msg: '任务不存在。' }),
    createJsonResponse({
      code: 200,
      data: {
        state: 'success',
        resultJson: JSON.stringify({ resultUrls: ['https://example.com/result.png'] }),
      },
    }),
  ];

  global.fetch = async () => responses.shift();
  global.setTimeout = (handler, ms) => {
    if (ms === 60_000) {
      return originalSetTimeout(handler, ms);
    }
    queueMicrotask(handler);
    return 0;
  };
  global.clearTimeout = (id) => originalClearTimeout(id);

  try {
    const result = await executeProviderJob(
      {
        taskType: 'kie_image',
        payload: {
          prompt: 'test',
          imageUrls: ['https://example.com/source.png'],
          model: 'nano-banana-2',
          aspectRatio: '1:1',
          resolution: '1K',
        },
      },
      { KIE_API_KEY: 'test-key' },
      new AbortController().signal,
      { onProviderTaskId: async (taskId) => seenProviderTaskIds.push(taskId) }
    );

    assert.equal(result.providerTaskId, 'kie-task-1');
    assert.equal(result.result.imageUrl, 'https://example.com/result.png');
    assert.deepEqual(seenProviderTaskIds, ['kie-task-1']);
  } finally {
    global.fetch = originalFetch;
    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
  }
});

test('executeProviderJob tolerates a longer kie recordInfo warmup window before task becomes queryable', async () => {
  const originalFetch = global.fetch;
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  const responses = [
    createJsonResponse({ code: 200, data: { taskId: 'kie-task-long-warmup' } }),
    createJsonResponse({ code: 404, msg: '任务不存在。' }),
    createJsonResponse({ code: 404, msg: '任务不存在。' }),
    createJsonResponse({ code: 404, msg: '任务不存在。' }),
    createJsonResponse({ code: 404, msg: '任务不存在。' }),
    createJsonResponse({ code: 404, msg: '任务不存在。' }),
    createJsonResponse({ code: 404, msg: '任务不存在。' }),
    createJsonResponse({
      code: 200,
      data: {
        state: 'success',
        resultJson: JSON.stringify({ resultUrls: ['https://example.com/warmup-result.png'] }),
      },
    }),
  ];

  global.fetch = async () => responses.shift();
  global.setTimeout = (handler, ms) => {
    if (ms === 60_000) {
      return originalSetTimeout(handler, ms);
    }
    queueMicrotask(handler);
    return 0;
  };
  global.clearTimeout = (id) => originalClearTimeout(id);

  try {
    const result = await executeProviderJob(
      {
        taskType: 'kie_image',
        payload: {
          prompt: 'test',
          imageUrls: ['https://example.com/source.png'],
          model: 'nano-banana-2',
          aspectRatio: '1:1',
          resolution: '1K',
        },
      },
      { KIE_API_KEY: 'test-key' },
      new AbortController().signal
    );

    assert.equal(result.providerTaskId, 'kie-task-long-warmup');
    assert.equal(result.result.imageUrl, 'https://example.com/warmup-result.png');
  } finally {
    global.fetch = originalFetch;
    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
  }
});

test('executeProviderJob reuses the existing providerTaskId for retrying kie image jobs instead of creating a new task', async () => {
  const originalFetch = global.fetch;
  const requests = [];

  global.fetch = async (url) => {
    requests.push(String(url));
    return createJsonResponse({
      code: 200,
      data: {
        state: 'success',
        resultJson: JSON.stringify({ resultUrls: ['https://example.com/recovered-result.png'] }),
      },
    });
  };

  try {
    const result = await executeProviderJob(
      {
        taskType: 'kie_image',
        providerTaskId: 'kie-existing-task',
        payload: {
          prompt: 'test',
          imageUrls: ['https://example.com/source.png'],
          model: 'nano-banana-2',
          aspectRatio: '1:1',
          resolution: '1K',
        },
      },
      { KIE_API_KEY: 'test-key' },
      new AbortController().signal
    );

    assert.equal(result.providerTaskId, 'kie-existing-task');
    assert.equal(result.result.imageUrl, 'https://example.com/recovered-result.png');
    assert.equal(requests.length, 1);
    assert.match(requests[0], /recordInfo\?taskId=kie-existing-task/);
  } finally {
    global.fetch = originalFetch;
  }
});

test('executeProviderJob reuses the existing providerTaskId for retrying seedance video jobs instead of creating a new task', async () => {
  const originalFetch = global.fetch;
  const requests = [];

  global.fetch = async (url) => {
    requests.push(String(url));
    return createJsonResponse({
      code: 200,
      data: {
        state: 'success',
        resultJson: JSON.stringify({ resultUrls: ['https://example.com/recovered-video.mp4'] }),
        creditsConsumed: 495,
      },
    });
  };

  try {
    const result = await executeProviderJob(
      {
        taskType: 'kie_seedance_video',
        providerTaskId: 'seedance-existing-task',
        payload: {
          mode: 'frames2video',
          prompt: 'test video',
          imageUrls: ['https://example.com/start.png', 'https://example.com/end.png'],
          duration: 5,
        },
      },
      { KIE_API_KEY: 'test-key' },
      new AbortController().signal
    );

    assert.equal(result.providerTaskId, 'seedance-existing-task');
    assert.equal(result.result.videoUrl, 'https://example.com/recovered-video.mp4');
    assert.equal(result.result.creditsConsumed, 495);
    assert.equal(requests.length, 1);
    assert.match(requests[0], /recordInfo\?taskId=seedance-existing-task/);
    assert.doesNotMatch(requests[0], /createTask/);
  } finally {
    global.fetch = originalFetch;
  }
});

test('executeProviderJob recovers kie storyboard video by polling the existing task endpoint only', async () => {
  const originalFetch = global.fetch;
  const originalSetTimeout = global.setTimeout;
  const requests = [];
  global.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), method: String(init.method || 'GET') });
    return createJsonResponse({
      code: 200,
      data: {
        state: 'success',
        resultJson: JSON.stringify({ resultUrls: ['https://example.com/recovered-storyboard.mp4'] }),
      },
    });
  };
  global.setTimeout = (handler) => {
    queueMicrotask(handler);
    return 0;
  };

  try {
    const result = await executeProviderJob({
      taskType: 'kie_video',
      providerTaskId: 'existing-storyboard-video-task',
      payload: {
        imageUrls: ['https://example.com/source.png'],
        videoConfig: { duration: 15, script: 'must not resubmit' },
      },
    }, { KIE_API_KEY: 'test-key' }, new AbortController().signal);

    assert.equal(result.providerTaskId, 'existing-storyboard-video-task');
    assert.equal(result.result.videoUrl, 'https://example.com/recovered-storyboard.mp4');
    assert.deepEqual(requests, [{
      url: 'https://api.kie.ai/api/v1/jobs/recordInfo?taskId=existing-storyboard-video-task',
      method: 'GET',
    }]);
  } finally {
    global.fetch = originalFetch;
    global.setTimeout = originalSetTimeout;
  }
});

test('executeProviderJob recovers kie veo by polling the existing veo task endpoint only', async () => {
  const originalFetch = global.fetch;
  const originalSetTimeout = global.setTimeout;
  const requests = [];
  global.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), method: String(init.method || 'GET') });
    return createJsonResponse({
      code: 200,
      data: {
        successFlag: 1,
        response: { resultUrls: ['https://example.com/recovered-veo.mp4'] },
      },
    });
  };
  global.setTimeout = (handler) => {
    queueMicrotask(handler);
    return 0;
  };

  try {
    const result = await executeProviderJob({
      taskType: 'kie_veo',
      providerTaskId: 'existing-veo-task',
      payload: { script: { description: 'must not regenerate' } },
    }, { KIE_API_KEY: 'test-key' }, new AbortController().signal);

    assert.equal(result.providerTaskId, 'existing-veo-task');
    assert.equal(result.result.videoUrl, 'https://example.com/recovered-veo.mp4');
    assert.deepEqual(requests, [{
      url: 'https://api.kie.ai/api/v1/veo/record-info?taskId=existing-veo-task',
      method: 'GET',
    }]);
  } finally {
    global.fetch = originalFetch;
    global.setTimeout = originalSetTimeout;
  }
});

test('executeProviderJob never resubmits kie storyboard chat when only a non-queryable response id exists', async () => {
  const originalFetch = global.fetch;
  let fetchCalls = 0;
  global.fetch = async () => {
    fetchCalls += 1;
    throw new Error('must not call provider');
  };

  try {
    await assert.rejects(
      () => executeProviderJob({
        module: 'video',
        taskType: 'kie_chat',
        providerTaskId: 'non-queryable-chat-response-id',
        payload: {
          model: 'gemini-3-5-flash',
          subFeature: 'storyboard',
          messages: [{ role: 'user', content: 'must not resubmit' }],
        },
      }, { KIE_API_KEY: 'test-key' }, new AbortController().signal),
      (error) => error?.code === 'provider_submission_unknown'
        && error?.providerTaskId === 'non-queryable-chat-response-id'
    );
    assert.equal(fetchCalls, 0);
  } finally {
    global.fetch = originalFetch;
  }
});

test('executeProviderJob tolerates transient fetch errors while polling kie image jobs after task creation', async () => {
  const originalFetch = global.fetch;
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  let callCount = 0;

  global.fetch = async (url) => {
    callCount += 1;
    if (callCount === 1) {
      return createJsonResponse({ code: 200, data: { taskId: 'kie-task-network-jitter' } });
    }
    if (callCount === 2) {
      throw new TypeError('fetch failed');
    }
    return createJsonResponse({
      code: 200,
      data: {
        state: 'success',
        resultJson: JSON.stringify({ resultUrls: ['https://example.com/network-jitter-result.png'] }),
      },
    });
  };
  global.setTimeout = (handler, ms) => {
    if (ms === 60_000) {
      return originalSetTimeout(handler, ms);
    }
    queueMicrotask(handler);
    return 0;
  };
  global.clearTimeout = (id) => originalClearTimeout(id);

  try {
    const result = await executeProviderJob(
      {
        taskType: 'kie_image',
        payload: {
          prompt: 'test',
          imageUrls: ['https://example.com/source.png'],
          model: 'nano-banana-2',
          aspectRatio: 'auto',
          resolution: '1K',
        },
      },
      { KIE_API_KEY: 'test-key' },
      new AbortController().signal
    );

    assert.equal(result.providerTaskId, 'kie-task-network-jitter');
    assert.equal(result.result.imageUrl, 'https://example.com/network-jitter-result.png');
  } finally {
    global.fetch = originalFetch;
    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
  }
});

test('executeProviderJob times out hung kie image task creation instead of leaving jobs running forever', async () => {
  const originalFetch = global.fetch;
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  let createTaskSignal = null;

  global.fetch = async (_url, init = {}) => {
    createTaskSignal = init.signal;
    return new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      });
    });
  };
  global.setTimeout = (handler) => {
    queueMicrotask(handler);
    return 0;
  };
  global.clearTimeout = () => {};

  try {
    await assert.rejects(
      executeProviderJob(
        {
          taskType: 'kie_image',
          payload: {
            prompt: 'test',
            imageUrls: ['https://example.com/source.png'],
            model: 'gpt-image-2',
            aspectRatio: '1:1',
            resolution: '1K',
          },
        },
        { KIE_API_KEY: 'test-key' },
        new AbortController().signal
      ),
      (error) => {
        assert.equal(error.code, 'provider_timeout');
        assert.match(error.message, /Kie 图像任务创建超时/);
        return true;
      }
    );
    assert.equal(createTaskSignal?.aborted, true);
  } finally {
    global.fetch = originalFetch;
    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
  }
});

test('executeProviderJob routes GPT Image 2 image input through image-to-image payload without unsupported fields', async () => {
  const originalFetch = global.fetch;
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  const requests = [];

  global.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    if (String(url).includes('/createTask')) {
      return createJsonResponse({ code: 200, data: { taskId: 'kie-task-gpt-image-2-edit' } });
    }
    if (String(url).includes('/recordInfo')) {
      return createJsonResponse({
        code: 200,
        data: {
          state: 'success',
          creditsConsumed: 5,
          resultJson: JSON.stringify({ resultUrls: ['https://example.com/gpt-image-2-edit.png'] }),
        },
      });
    }
    throw new Error(`unexpected request: ${String(url)}`);
  };
  global.setTimeout = (handler) => {
    queueMicrotask(handler);
    return 0;
  };
  global.clearTimeout = () => {};

  try {
    const result = await executeProviderJob(
      {
        taskType: 'kie_image',
        payload: {
          prompt: 'make a clean studio shot',
          imageUrls: ['https://example.com/input-1.png'],
          model: 'gpt-image-2',
          aspectRatio: '3:4',
          resolution: '2K',
        },
      },
      { KIE_API_KEY: 'test-key' },
      new AbortController().signal
    );

    assert.equal(result.providerTaskId, 'kie-task-gpt-image-2-edit');
    assert.equal(result.result.imageUrl, 'https://example.com/gpt-image-2-edit.png');
    assert.equal(result.creditsConsumed, 5);
    assert.equal(result.result.creditsConsumed, 5);
    const createTaskRequest = requests.find((item) => item.url.includes('/createTask'));
    const createTaskBody = JSON.parse(String(createTaskRequest.init.body));
    assert.equal(createTaskBody.model, 'gpt-image-2-image-to-image');
    assert.deepEqual(createTaskBody.input.input_urls, ['https://example.com/input-1.png']);
    assert.equal(createTaskBody.input.aspect_ratio, '3:4');
    assert.equal(createTaskBody.input.resolution, '2K');
    assert.equal(createTaskBody.input.image_input, undefined);
    assert.equal(createTaskBody.input.output_format, undefined);
  } finally {
    global.fetch = originalFetch;
    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
  }
});

test('executeProviderJob routes GPT Image 2 prompt-only jobs through text-to-image payload', async () => {
  const originalFetch = global.fetch;
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  const requests = [];

  global.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    if (String(url).includes('/createTask')) {
      return createJsonResponse({ code: 200, data: { taskId: 'kie-task-gpt-image-2-text' } });
    }
    if (String(url).includes('/recordInfo')) {
      return createJsonResponse({
        code: 200,
        data: {
          state: 'success',
          resultJson: JSON.stringify({ resultUrls: ['https://example.com/gpt-image-2-text.png'] }),
        },
      });
    }
    throw new Error(`unexpected request: ${String(url)}`);
  };
  global.setTimeout = (handler) => {
    queueMicrotask(handler);
    return 0;
  };
  global.clearTimeout = () => {};

  try {
    await executeProviderJob(
      {
        taskType: 'kie_image',
        payload: {
          prompt: 'generate a product poster',
          imageUrls: [],
          model: 'gpt-image-2',
          aspectRatio: '16:9',
          resolution: '4K',
        },
      },
      { KIE_API_KEY: 'test-key' },
      new AbortController().signal
    );

    const createTaskRequest = requests.find((item) => item.url.includes('/createTask'));
    const createTaskBody = JSON.parse(String(createTaskRequest.init.body));
    assert.equal(createTaskBody.model, 'gpt-image-2-text-to-image');
    assert.equal(createTaskBody.input.aspect_ratio, '16:9');
    assert.equal(createTaskBody.input.resolution, '4K');
    assert.equal(createTaskBody.input.input_urls, undefined);
    assert.equal(createTaskBody.input.output_format, undefined);
  } finally {
    global.fetch = originalFetch;
    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
  }
});

test('executeProviderJob downgrades GPT Image 2 auto ratio requests to 1K', async () => {
  const originalFetch = global.fetch;
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  const requests = [];

  global.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    if (String(url).includes('/createTask')) {
      return createJsonResponse({ code: 200, data: { taskId: 'kie-task-gpt-image-2-auto-1k' } });
    }
    if (String(url).includes('/recordInfo')) {
      return createJsonResponse({
        code: 200,
        data: {
          state: 'success',
          resultJson: JSON.stringify({ resultUrls: ['https://example.com/gpt-image-2-auto-1k.png'] }),
        },
      });
    }
    throw new Error(`unexpected request: ${String(url)}`);
  };
  global.setTimeout = (handler) => {
    queueMicrotask(handler);
    return 0;
  };
  global.clearTimeout = () => {};

  try {
    await executeProviderJob(
      {
        taskType: 'kie_image',
        payload: {
          prompt: 'generate a product poster',
          imageUrls: [],
          model: 'gpt-image-2',
          aspectRatio: 'auto',
          resolution: '4K',
        },
      },
      { KIE_API_KEY: 'test-key' },
      new AbortController().signal
    );

    const createTaskRequest = requests.find((item) => item.url.includes('/createTask'));
    const createTaskBody = JSON.parse(String(createTaskRequest.init.body));
    assert.equal(createTaskBody.input.aspect_ratio, 'auto');
    assert.equal(createTaskBody.input.resolution, '1K');
  } finally {
    global.fetch = originalFetch;
    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
  }
});

test('executeProviderJob downgrades GPT Image 2 1:1 requests away from 4K', async () => {
  const originalFetch = global.fetch;
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  const requests = [];

  global.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    if (String(url).includes('/createTask')) {
      return createJsonResponse({ code: 200, data: { taskId: 'kie-task-gpt-image-2-square-2k' } });
    }
    if (String(url).includes('/recordInfo')) {
      return createJsonResponse({
        code: 200,
        data: {
          state: 'success',
          resultJson: JSON.stringify({ resultUrls: ['https://example.com/gpt-image-2-square-2k.png'] }),
        },
      });
    }
    throw new Error(`unexpected request: ${String(url)}`);
  };
  global.setTimeout = (handler) => {
    queueMicrotask(handler);
    return 0;
  };
  global.clearTimeout = () => {};

  try {
    await executeProviderJob(
      {
        taskType: 'kie_image',
        payload: {
          prompt: 'generate a square product poster',
          imageUrls: ['https://example.com/input-1.png'],
          model: 'gpt-image-2',
          aspectRatio: '1:1',
          resolution: '4K',
        },
      },
      { KIE_API_KEY: 'test-key' },
      new AbortController().signal
    );

    const createTaskRequest = requests.find((item) => item.url.includes('/createTask'));
    const createTaskBody = JSON.parse(String(createTaskRequest.init.body));
    assert.equal(createTaskBody.input.aspect_ratio, '1:1');
    assert.equal(createTaskBody.input.resolution, '2K');
  } finally {
    global.fetch = originalFetch;
    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
  }
});

test('executeProviderJob trims GPT Image 2 requests to the supported 16 input images', async () => {
  const originalFetch = global.fetch;
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  const requests = [];

  global.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    if (String(url).includes('/createTask')) {
      return createJsonResponse({ code: 200, data: { taskId: 'kie-task-gpt-image-2-trimmed' } });
    }
    if (String(url).includes('/recordInfo')) {
      return createJsonResponse({
        code: 200,
        data: {
          state: 'success',
          resultJson: JSON.stringify({ resultUrls: ['https://example.com/trimmed.png'] }),
        },
      });
    }
    throw new Error(`unexpected request: ${String(url)}`);
  };
  global.setTimeout = (handler) => {
    queueMicrotask(handler);
    return 0;
  };
  global.clearTimeout = () => {};

  try {
    await executeProviderJob(
      {
        taskType: 'kie_image',
        payload: {
          prompt: 'test',
          imageUrls: Array.from({ length: 17 }, (_, index) => `https://example.com/input-${index}.png`),
          model: 'gpt-image-2',
          aspectRatio: '1:1',
        },
      },
      { KIE_API_KEY: 'test-key' },
      new AbortController().signal
    );

    const createTaskRequest = requests.find((item) => item.url.includes('/createTask'));
    const createTaskBody = JSON.parse(String(createTaskRequest.init.body));
    assert.equal(createTaskBody.input.input_urls.length, 16);
    assert.equal(createTaskBody.input.input_urls.at(0), 'https://example.com/input-0.png');
    assert.equal(createTaskBody.input.input_urls.at(-1), 'https://example.com/input-15.png');
  } finally {
    global.fetch = originalFetch;
    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
  }
});

test('executeProviderJob routes GPT Image 2 secondary image jobs through apiports generate api', async () => {
  const originalFetch = global.fetch;
  const requests = [];

  global.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    return createJsonResponse({
      id: 'apiports-task-123',
      status: 'succeeded',
      results: [{ url: 'https://example.com/apiports-image-result.png' }],
      progress: 100,
    });
  };

  try {
    const result = await executeProviderJob(
      {
        taskType: 'kie_image',
        payload: {
          prompt: '秒杀异味，杀菌除臭喷雾',
          imageUrls: Array.from({ length: 17 }, (_, index) => `https://example.com/input-${index}.png`),
          model: 'gpt-image-2-secondary',
          aspectRatio: '9:16',
          resolution: '2K',
        },
      },
      { APIPORTS_API_KEY: 'apiports-key' },
      new AbortController().signal
    );

    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, 'https://apiports.com/v1/api/generate');
    assert.equal(requests[0].init.headers.Authorization, 'Bearer apiports-key');
    const createBody = JSON.parse(String(requests[0].init.body));
    assert.deepEqual(createBody, {
      model: 'gpt-image-2',
      prompt: '改善异味，清洁去味喷雾',
      images: Array.from({ length: 16 }, (_, index) => `https://example.com/input-${index}.png`),
      aspectRatio: '9:16',
      replyType: 'json',
    });
    assert.equal(result.providerTaskId, 'apiports-task-123');
    assert.equal(result.result.imageUrl, 'https://example.com/apiports-image-result.png');
    assert.equal(result.result.providerModel, 'gpt-image-2-secondary');
  } finally {
    global.fetch = originalFetch;
  }
});

test('executeProviderJob routes GPT Image 2 secondary prompt-only jobs through apiports generate api', async () => {
  const originalFetch = global.fetch;
  const requests = [];

  global.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    return createJsonResponse({
      id: 'apiports-task-text',
      status: 'succeeded',
      results: [{ url: 'https://example.com/apiports-result.png' }],
      usage: { total_tokens: 100 },
    });
  };

  try {
    const result = await executeProviderJob(
      {
        taskType: 'kie_image',
        payload: {
          prompt: 'make a clean studio shot',
          model: 'gpt-image-2-secondary',
          aspectRatio: '9:16',
          resolution: '2K',
        },
      },
      { APIPORTS_API_KEY: 'apiports-key' },
      new AbortController().signal
    );

    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, 'https://apiports.com/v1/api/generate');
    assert.equal(requests[0].init.headers.Authorization, 'Bearer apiports-key');
    const createBody = JSON.parse(String(requests[0].init.body));
    assert.deepEqual(createBody, {
      model: 'gpt-image-2',
      prompt: 'make a clean studio shot',
      aspectRatio: '9:16',
      replyType: 'json',
    });
    assert.equal(result.providerTaskId, 'apiports-task-text');
    assert.equal(result.result.imageUrl, 'https://example.com/apiports-result.png');
    assert.equal(result.result.providerModel, 'gpt-image-2-secondary');
    assert.deepEqual(result.result.usage, { total_tokens: 100 });
  } finally {
    global.fetch = originalFetch;
  }
});

test('executeProviderJob surfaces GPT Image 2 secondary apiports string errors', async () => {
  const originalFetch = global.fetch;

  global.fetch = async () => createJsonResponse({
    id: 'apiports-failed',
    status: 'failed',
    error: 'We are sorry, but the images we created may have violated our relevant policies.',
  }, { status: 400 });

  try {
    await assert.rejects(
      () => executeProviderJob(
        {
          taskType: 'kie_image',
          payload: {
            prompt: 'make a clean studio shot',
            model: 'gpt-image-2-secondary',
            aspectRatio: '1:1',
          },
        },
        { APIPORTS_API_KEY: 'apiports-key' },
        new AbortController().signal
      ),
      (error) => {
        assert.equal(error.code, 'provider_bad_request');
        assert.match(error.message, /violated our relevant policies/);
        return true;
      }
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test('executeProviderJob treats GPT Image 2 secondary failed success responses as provider errors', async () => {
  const originalFetch = global.fetch;

  global.fetch = async () => createJsonResponse({
    id: 'apiports-failed',
    status: 'failed',
    error: 'policy rejected',
    progress: 100,
  });

  try {
    await assert.rejects(
      () => executeProviderJob(
        {
          taskType: 'kie_image',
          payload: {
            prompt: 'make a clean studio shot',
            model: 'gpt-image-2-secondary',
            aspectRatio: '1:1',
          },
        },
        { APIPORTS_API_KEY: 'apiports-key' },
        new AbortController().signal
      ),
      (error) => {
        assert.equal(error.code, 'provider_bad_request');
        assert.equal(error.message, 'policy rejected');
        return true;
      }
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test('executeProviderJob supports data-array GPT Image 2 secondary apiports responses', async () => {
  const originalFetch = global.fetch;
  const requests = [];

  global.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    return createJsonResponse({
      created: 1779805430,
      data: [{ url: 'https://example.com/apiports-result.png' }],
      usage: { total_tokens: 100 },
    });
  };

  try {
    const result = await executeProviderJob(
      {
        taskType: 'kie_image',
        payload: {
          prompt: 'make a clean studio shot',
          model: 'gpt-image-2-secondary',
          aspectRatio: '9:16',
          resolution: '2K',
        },
      },
      { APIPORTS_API_KEY: 'apiports-key' },
      new AbortController().signal
    );

    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, 'https://apiports.com/v1/api/generate');
    assert.equal(requests[0].init.headers.Authorization, 'Bearer apiports-key');
    const createBody = JSON.parse(String(requests[0].init.body));
    assert.equal(createBody.model, 'gpt-image-2');
    assert.equal(createBody.prompt, 'make a clean studio shot');
    assert.equal(createBody.aspectRatio, '9:16');
    assert.equal(createBody.replyType, 'json');
    assert.equal(result.providerTaskId, 'apiports-1779805430');
    assert.equal(result.result.imageUrl, 'https://example.com/apiports-result.png');
    assert.equal(result.result.providerModel, 'gpt-image-2-secondary');
    assert.deepEqual(result.result.usage, { total_tokens: 100 });
  } finally {
    global.fetch = originalFetch;
  }
});

test('executeProviderJob rejects archive files before submitting image generation', async () => {
  const originalFetch = global.fetch;
  let requestCount = 0;
  global.fetch = async () => {
    requestCount += 1;
    return createJsonResponse({});
  };

  try {
    await assert.rejects(
      () => executeProviderJob(
        {
          taskType: 'kie_image',
          payload: {
            model: 'gpt-image-2',
            imageUrls: ['https://example.com/source.zip'],
            prompt: 'generate a product image',
          },
        },
        { KIE_API_KEY: 'test-key' },
        new AbortController().signal
      ),
      (error) => {
        assert.equal(error.code, 'provider_bad_request');
        assert.match(error.message, /不支持.*zip/);
        return true;
      }
    );
    assert.equal(requestCount, 0);
  } finally {
    global.fetch = originalFetch;
  }
});

test('executeProviderJob rejects archive urls embedded in image prompts before provider submission', async () => {
  const originalFetch = global.fetch;
  let requestCount = 0;
  global.fetch = async () => {
    requestCount += 1;
    return createJsonResponse({});
  };

  try {
    await assert.rejects(
      () => executeProviderJob(
        {
          taskType: 'kie_image',
          payload: {
            model: 'gpt-image-2',
            imageUrls: ['https://example.com/source.png'],
            prompt: 'The image URL<https://example.com/source.zip> 不支持的文件格式',
          },
        },
        { KIE_API_KEY: 'test-key' },
        new AbortController().signal
      ),
      (error) => {
        assert.equal(error.code, 'provider_bad_request');
        assert.match(error.message, /不支持.*zip/);
        return true;
      }
    );
    assert.equal(requestCount, 0);
  } finally {
    global.fetch = originalFetch;
  }
});

test('executeProviderJob maps KIE createTask code 402 to provider_credit_insufficient', async () => {
  const originalFetch = global.fetch;

  global.fetch = async () => createJsonResponse({
    code: 402,
    msg: 'Credits insufficient : Your current balance isn’t enough to run this request. Please top up to continue.',
    data: null,
  });

  try {
    await assert.rejects(
      () => executeProviderJob(
        {
          taskType: 'kie_image',
          payload: {
            prompt: 'test',
            imageUrls: ['https://example.com/source.png'],
            model: 'nano-banana-2',
            aspectRatio: '1:1',
            resolution: '1K',
          },
        },
        { KIE_API_KEY: 'test-key' },
        new AbortController().signal
      ),
      (error) => error?.code === 'provider_credit_insufficient'
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test('executeProviderJob maps KIE createTask code 433 to provider_request_limit', async () => {
  const originalFetch = global.fetch;

  global.fetch = async () => createJsonResponse({
    code: 433,
    msg: 'Sub-key Usage Exceeds Limit',
    data: null,
  });

  try {
    await assert.rejects(
      () => executeProviderJob(
        {
          taskType: 'kie_image',
          payload: {
            prompt: 'test',
            imageUrls: ['https://example.com/source.png'],
            model: 'nano-banana-2',
            aspectRatio: '1:1',
            resolution: '1K',
          },
        },
        { KIE_API_KEY: 'test-key' },
        new AbortController().signal
      ),
      (error) => error?.code === 'provider_request_limit'
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test('uploadAssetViaKieStream prefers stream upload and returns file url', async () => {
  const originalFetch = global.fetch;
  const requests = [];

  global.fetch = async (url, init) => {
    requests.push({ url, init });
    return createJsonResponse({
      code: 200,
      data: {
        fileUrl: 'https://example.com/uploaded.png',
      },
    });
  };

  try {
    const result = await uploadAssetViaKieStream(
      {
        fileName: 'sample.png',
        mimeType: 'image/png',
        fileBuffer: Buffer.from('hello'),
        uploadPath: 'mayo-storage/internal',
      },
      { KIE_API_KEY: 'test-key' }
    );

    assert.equal(result.result.fileUrl, 'https://example.com/uploaded.png');
    assert.match(String(requests[0].url), /file-stream-upload/);
  } finally {
    global.fetch = originalFetch;
  }
});

test('uploadAssetViaKieStream tags a successful response without fileUrl as an asset upload bad response', async () => {
  __testOnly_resetKieAssetUploadLimiters();
  const originalFetch = global.fetch;
  let calls = 0;

  global.fetch = async () => {
    calls += 1;
    return createJsonResponse({ code: 200, data: {} });
  };

  try {
    await assert.rejects(
      () => uploadAssetViaKieStream({
        fileName: 'missing-url.png',
        mimeType: 'image/png',
        fileBuffer: Buffer.from('hello'),
      }, {
        KIE_API_KEY: 'test-key',
        MEIAO_KIE_ASSET_UPLOAD_RETRIES: '0',
      }),
      (error) => error?.code === 'provider_bad_response'
        && error?.providerStage === 'asset_upload'
        && error?.providerStatus === 'bad_response'
    );
    assert.equal(calls, 1);
  } finally {
    global.fetch = originalFetch;
    __testOnly_resetKieAssetUploadLimiters();
  }
});

test('executeProviderJob fails relative managed asset upload without base64 fallback', async () => {
  const originalFetch = global.fetch;
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  const requests = [];

  global.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    if (String(url).startsWith('http://127.0.0.1:3100/api/assets/file/')) {
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'image/png' }),
        arrayBuffer: async () => new TextEncoder().encode('asset-binary').buffer,
        json: async () => ({}),
      };
    }
    if (String(url).includes('/file-stream-upload')) {
      return createJsonResponse({ msg: 'stream auth denied' }, 401);
    }
    if (String(url).includes('/createTask')) {
      throw new Error('createTask should not run after upload failure');
    }
    if (String(url).includes('/recordInfo')) {
      return createJsonResponse({
        code: 200,
        data: {
          state: 'success',
          resultJson: JSON.stringify({ resultUrls: ['https://example.com/base64-fallback-result.png'] }),
        },
      });
    }
    throw new Error(`unexpected request: ${String(url)}`);
  };
  global.setTimeout = (handler) => {
    queueMicrotask(handler);
    return 0;
  };
  global.clearTimeout = () => {};

  try {
    await assert.rejects(
      () => executeProviderJob(
        {
          taskType: 'kie_image',
          payload: {
            prompt: 'test',
            imageUrls: ['/api/assets/file/asset-fallback/source.png'],
            model: 'nano-banana-2',
            aspectRatio: '1:1',
            resolution: '1K',
          },
        },
        { KIE_API_KEY: 'test-key' },
        new AbortController().signal
      ),
      /stream auth denied|素材上传鉴权失败/
    );

    assert.equal(requests.filter((item) => item.url.includes('/file-stream-upload')).length, 1);
    assert.equal(requests.filter((item) => item.url.includes('/file-base64-upload')).length, 0);
    assert.equal(requests.filter((item) => item.url.includes('/createTask')).length, 0);
  } finally {
    global.fetch = originalFetch;
    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
  }
});

test('executeProviderJob routes gpt-5-4 kie chat through responses api with reasoning and web search', async () => {
  const originalFetch = global.fetch;
  const requests = [];

  global.fetch = async (url, init) => {
    requests.push({ url: String(url), init });
    return createJsonResponse({
      output_text: 'gpt-5.4 result',
      id: 'resp-kie-task-1',
      creditsConsumed: 2,
      usage: { total_tokens: 128 },
    });
  };

  try {
    const result = await executeProviderJob(
      {
        taskType: 'kie_chat',
        payload: {
          model: 'gpt-5-4-openai-resp',
          reasoningLevel: 'low',
          webSearchEnabled: true,
          messages: [
            { role: 'system', content: '你是助手' },
            {
              role: 'user',
              content: [
                { type: 'text', text: '帮我总结这个文件' },
                { type: 'image_url', image_url: { url: 'https://example.com/a.png' } },
                { type: 'input_file', file_url: 'https://example.com/a.pdf', filename: 'a.pdf' },
              ],
            },
          ],
        },
      },
      { KIE_API_KEY: 'test-key' },
      new AbortController().signal
    );

    assert.equal(result.result.content, 'gpt-5.4 result');
    assert.equal(result.providerTaskId, 'resp-kie-task-1');
    assert.equal(result.result.creditsConsumed, 2);
    assert.deepEqual(result.result.usage, { total_tokens: 128 });
    assert.match(requests[0].url, /\/codex\/v1\/responses$/);
    const body = JSON.parse(String(requests[0].init.body));
    assert.equal(body.model, 'gpt-5-4');
    assert.equal(body.instructions, '你是助手');
    assert.equal(body.reasoning.effort, 'low');
    assert.equal(body.tools[0].type, 'web_search');
    assert.equal(body.input.length, 1);
    assert.equal(body.input[0].content[0].type, 'input_text');
    assert.equal(body.input[0].content[1].type, 'input_image');
    assert.equal(body.input[0].content[2].type, 'input_file');
  } finally {
    global.fetch = originalFetch;
  }
});

test('executeProviderJob uploads managed asset image urls before creating kie image tasks', async () => {
  const originalFetch = global.fetch;
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  const requests = [];

  global.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    if (String(url).includes('/api/assets/file/')) {
      return new Response(Buffer.from([0xff, 0xd8, 0xff, 0xd9]), {
        status: 200,
        headers: { 'Content-Type': 'image/jpeg' },
      });
    }
    if (String(url).includes('/file-stream-upload')) {
      return createJsonResponse({
        code: 200,
        data: { fileUrl: 'https://tempfile.redpandaai.co/kieai/30590/mayo-storage/internal/source.jpg' },
      });
    }
    if (String(url).includes('/createTask')) {
      return createJsonResponse({ code: 200, data: { taskId: 'kie-task-managed-asset' } });
    }
    if (String(url).includes('/recordInfo')) {
      return createJsonResponse({
        code: 200,
        data: {
          state: 'success',
          resultJson: JSON.stringify({ resultUrls: ['https://example.com/managed-result.png'] }),
        },
      });
    }
    throw new Error(`unexpected request: ${String(url)}`);
  };
  global.setTimeout = (handler) => {
    queueMicrotask(handler);
    return 0;
  };
  global.clearTimeout = () => {};

  try {
    const result = await executeProviderJob(
      {
        taskType: 'kie_image',
        payload: {
          prompt: 'test',
          imageUrls: ['http://111.229.66.247/api/assets/file/asset-1/source.jpg'],
          model: 'nano-banana-2',
          aspectRatio: '1:1',
          resolution: '1K',
        },
      },
      { KIE_API_KEY: 'test-key', MEIAO_PUBLIC_BASE_URL: 'http://111.229.66.247' },
      new AbortController().signal
    );

    assert.equal(result.providerTaskId, 'kie-task-managed-asset');
    assert.equal(requests.filter((item) => item.url.includes('/api/assets/file/')).length, 1);
    assert.equal(requests.filter((item) => item.url.includes('/file-stream-upload')).length, 1);
    const createTaskRequest = requests.find((item) => item.url.includes('/createTask'));
    const createTaskBody = JSON.parse(String(createTaskRequest.init.body));
    assert.deepEqual(createTaskBody.input.image_input, [
      'https://tempfile.redpandaai.co/kieai/30590/mayo-storage/internal/source.jpg',
    ]);
  } finally {
    global.fetch = originalFetch;
    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
  }
});

test('executeProviderJob retries direct managed asset image through KIE after pre-task media read failure', async () => {
  __testOnly_clearManagedAssetUploadCache();
  const originalFetch = global.fetch;
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  const requests = [];
  const managedAssetUrl = 'http://111.229.66.247/api/assets/file/direct-image/source.png';
  const directAssetUrl = 'https://meiaoyuntai.com/api/assets/file/direct-image/source.png';
  const stagedAssetUrl = 'https://tempfile.redpandaai.co/kieai/30590/mayo-storage/internal/direct-image.png';
  let createTaskCalls = 0;

  global.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    if (String(url).includes('/createTask')) {
      createTaskCalls += 1;
      if (createTaskCalls === 1) {
        return createJsonResponse({ code: 400, msg: 'Failed to get the file information' }, 400);
      }
      return createJsonResponse({ code: 200, data: { taskId: 'kie-task-direct-image-fallback' } });
    }
    if (String(url).includes('/api/assets/file/')) {
      return new Response(Buffer.from([0x89, 0x50, 0x4e, 0x47]), {
        status: 200,
        headers: { 'Content-Type': 'image/png' },
      });
    }
    if (String(url).includes('/file-stream-upload')) {
      return createJsonResponse({ code: 200, data: { fileUrl: stagedAssetUrl } });
    }
    if (String(url).includes('/recordInfo')) {
      return createJsonResponse({
        code: 200,
        data: {
          state: 'success',
          resultJson: JSON.stringify({ resultUrls: ['https://example.com/direct-image-result.png'] }),
        },
      });
    }
    throw new Error(`unexpected request: ${String(url)}`);
  };
  global.setTimeout = (handler) => {
    queueMicrotask(handler);
    return 0;
  };
  global.clearTimeout = () => {};

  try {
    const result = await executeProviderJob(
      {
        taskType: 'kie_image',
        payload: {
          prompt: 'test direct image fallback',
          imageUrls: [managedAssetUrl],
          model: 'nano-banana-2',
          aspectRatio: '1:1',
          resolution: '1K',
        },
      },
      {
        KIE_API_KEY: 'test-key',
        MEIAO_PUBLIC_BASE_URL: 'https://meiaoyuntai.com',
        MEIAO_KIE_MANAGED_ASSET_MODE: 'direct-first',
        MEIAO_KIE_ASSET_UPLOAD_RETRIES: '0',
      },
      new AbortController().signal
    );

    assert.equal(result.providerTaskId, 'kie-task-direct-image-fallback');
    assert.equal(requests.filter((item) => item.url.includes('/createTask')).length, 2);
    assert.equal(requests.filter((item) => item.url.includes('/file-stream-upload')).length, 1);
    const createBodies = requests
      .filter((item) => item.url.includes('/createTask'))
      .map((item) => JSON.parse(String(item.init.body)));
    assert.deepEqual(createBodies[0].input.image_input, [directAssetUrl]);
    assert.deepEqual(createBodies[1].input.image_input, [stagedAssetUrl]);
    assert.equal(createBodies[0].model, createBodies[1].model);
  } finally {
    global.fetch = originalFetch;
    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
  }
});

test('executeProviderJob does not retry direct media after a KIE image task id exists', async () => {
  __testOnly_clearManagedAssetUploadCache();
  const originalFetch = global.fetch;
  const requests = [];
  const managedAssetUrl = '/api/assets/file/direct-image-task-id/source.png';

  global.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    if (String(url).includes('/createTask')) {
      return createJsonResponse({ code: 200, data: { taskId: 'kie-task-already-created' } });
    }
    if (String(url).includes('/recordInfo')) {
      return createJsonResponse({
        code: 200,
        data: {
          state: 'fail',
          failMsg: 'Failed to get the file information',
        },
      });
    }
    throw new Error(`unexpected request: ${String(url)}`);
  };

  try {
    await assert.rejects(
      () => executeProviderJob(
        {
          taskType: 'kie_image',
          payload: {
            prompt: 'must not duplicate',
            imageUrls: [managedAssetUrl],
            model: 'nano-banana-2',
          },
        },
        {
          KIE_API_KEY: 'test-key',
          MEIAO_PUBLIC_BASE_URL: 'https://meiaoyuntai.com',
          MEIAO_KIE_MANAGED_ASSET_MODE: 'direct-first',
        },
        new AbortController().signal
      ),
      (error) => error?.providerTaskId === 'kie-task-already-created'
        && /Failed to get the file information/i.test(error.message)
    );

    assert.equal(requests.filter((item) => item.url.includes('/createTask')).length, 1);
    assert.equal(requests.filter((item) => item.url.includes('/file-stream-upload')).length, 0);
  } finally {
    global.fetch = originalFetch;
  }
});

test('executeProviderJob unwraps markdown image links before creating kie image tasks', async () => {
  const originalFetch = global.fetch;
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  const requests = [];

  global.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    if (String(url).includes('/createTask')) {
      return createJsonResponse({ code: 200, data: { taskId: 'kie-task-markdown-url' } });
    }
    if (String(url).includes('/recordInfo')) {
      return createJsonResponse({
        code: 200,
        data: {
          state: 'success',
          resultJson: JSON.stringify({ resultUrls: ['https://example.com/markdown-result.png'] }),
        },
      });
    }
    throw new Error(`unexpected request: ${String(url)}`);
  };
  global.setTimeout = (handler) => {
    queueMicrotask(handler);
    return 0;
  };
  global.clearTimeout = () => {};

  try {
    await executeProviderJob(
      {
        taskType: 'kie_image',
        payload: {
          prompt: 'test',
          imageUrls: [
            '[https://tempfile.redpandaai.co/kieai/30590/mayo-storage/internal/O1CN01cEF-50cm.jpg](https://tempfile.redpandaai.co/kieai/30590/mayo-storage/internal/O1CN01cEF-50cm.jpg)',
          ],
          model: 'nano-banana-2',
          aspectRatio: 'auto',
          resolution: '1K',
        },
      },
      { KIE_API_KEY: 'test-key' },
      new AbortController().signal
    );

    const createTaskRequest = requests.find((item) => item.url.includes('/createTask'));
    const createTaskBody = JSON.parse(String(createTaskRequest.init.body));
    assert.deepEqual(createTaskBody.input.image_input, [
      'https://tempfile.redpandaai.co/kieai/30590/mayo-storage/internal/O1CN01cEF-50cm.jpg',
    ]);
  } finally {
    global.fetch = originalFetch;
    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
  }
});

test('executeProviderJob rewrites local managed image urls inside kie image prompts to the uploaded model url', async () => {
  const originalFetch = global.fetch;
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  const requests = [];

  global.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    if (String(url).includes('/api/assets/file/')) {
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'image/png' }),
        arrayBuffer: async () => new TextEncoder().encode('png-binary').buffer,
        json: async () => ({}),
      };
    }
    if (String(url).includes('/file-stream-upload')) {
      return createJsonResponse({
        code: 200,
        data: { fileUrl: 'https://tempfile.redpandaai.co/kieai/30590/mayo-storage/internal/source.png' },
      });
    }
    if (String(url).includes('/createTask')) {
      return createJsonResponse({ code: 200, data: { taskId: 'kie-task-prompt-url' } });
    }
    if (String(url).includes('/recordInfo')) {
      return createJsonResponse({
        code: 200,
        data: {
          state: 'success',
          resultJson: JSON.stringify({ resultUrls: ['https://example.com/prompt-url-result.png'] }),
        },
      });
    }
    throw new Error(`unexpected request: ${String(url)}`);
  };
  global.setTimeout = (handler) => {
    queueMicrotask(handler);
    return 0;
  };
  global.clearTimeout = () => {};

  try {
    const sourceUrl = 'http://127.0.0.1:3100/api/assets/file/asset-local/source.png';
    const result = await executeProviderJob(
      {
        taskType: 'kie_image',
        payload: {
          prompt: `复刻主图参考图（图片URL）：${sourceUrl}`,
          imageUrls: [sourceUrl],
          model: 'gpt-image-2',
          aspectRatio: '1:1',
          resolution: '1K',
        },
      },
      { KIE_API_KEY: 'test-key' },
      new AbortController().signal
    );

    assert.equal(result.providerTaskId, 'kie-task-prompt-url');
    assert.equal(requests.filter((item) => item.url.includes('/api/assets/file/')).length, 1);
    assert.equal(requests.filter((item) => item.url.includes('/file-stream-upload')).length, 1);
    const createTaskRequest = requests.find((item) => item.url.includes('/createTask'));
    const createTaskBody = JSON.parse(String(createTaskRequest.init.body));
    assert.equal(createTaskBody.input.prompt.includes(sourceUrl), false);
    assert.match(createTaskBody.input.prompt, /复刻主图参考图（图片URL）：https:\/\/tempfile\.redpandaai\.co\/kieai\/30590\/mayo-storage\/internal\/source\.png/);
    assert.deepEqual(createTaskBody.input.input_urls, ['https://tempfile.redpandaai.co/kieai/30590/mayo-storage/internal/source.png']);
  } finally {
    global.fetch = originalFetch;
    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
  }
});

test('executeProviderJob can download relative managed asset paths before uploading them to kie', async () => {
  const originalFetch = global.fetch;
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  const requests = [];

  global.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    if (String(url).startsWith('http://127.0.0.1:3100/api/assets/file/')) {
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'image/png' }),
        arrayBuffer: async () => new TextEncoder().encode('asset-binary').buffer,
        json: async () => ({}),
      };
    }
    if (String(url).includes('/file-stream-upload')) {
      return createJsonResponse({
        code: 200,
        data: { fileUrl: 'https://kie.example.com/uploaded-relative.png' },
      });
    }
    if (String(url).includes('/createTask')) {
      return createJsonResponse({ code: 200, data: { taskId: 'kie-task-relative-asset' } });
    }
    if (String(url).includes('/recordInfo')) {
      return createJsonResponse({
        code: 200,
        data: {
          state: 'success',
          resultJson: JSON.stringify({ resultUrls: ['https://example.com/relative-result.png'] }),
        },
      });
    }
    throw new Error(`unexpected request: ${String(url)}`);
  };
  global.setTimeout = (handler) => {
    queueMicrotask(handler);
    return 0;
  };
  global.clearTimeout = () => {};

  try {
    const result = await executeProviderJob(
      {
        taskType: 'kie_image',
        payload: {
          prompt: 'test',
          imageUrls: ['/api/assets/file/asset-relative/source.png'],
          model: 'nano-banana-2',
          aspectRatio: '1:1',
          resolution: '1K',
        },
      },
      { KIE_API_KEY: 'test-key' },
      new AbortController().signal
    );

    assert.equal(result.providerTaskId, 'kie-task-relative-asset');
    const assetRequest = requests.find((item) => item.url.includes('/api/assets/file/'));
    assert.equal(assetRequest.url, 'http://127.0.0.1:3100/api/assets/file/asset-relative/source.png');
    const createTaskRequest = requests.find((item) => item.url.includes('/createTask'));
    const createTaskBody = JSON.parse(String(createTaskRequest.init.body));
    assert.deepEqual(createTaskBody.input.image_input, ['https://kie.example.com/uploaded-relative.png']);
  } finally {
    global.fetch = originalFetch;
    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
  }
});

test('executeProviderJob uploads managed file attachments before gpt-5.4 responses', async () => {
  const originalFetch = global.fetch;
  const requests = [];
  const cloudFileUrl = 'http://111.229.66.247/api/assets/file/file-1/source.pdf';
  const stagedFileUrl = 'https://tempfile.redpandaai.co/kieai/30590/mayo-storage/internal/source.pdf';

  global.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    if (String(url).includes('/api/assets/file/')) {
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/pdf' }),
        arrayBuffer: async () => new TextEncoder().encode('pdf-binary').buffer,
        json: async () => ({}),
      };
    }
    if (String(url).includes('/file-stream-upload')) {
      return createJsonResponse({
        code: 200,
        data: { fileUrl: stagedFileUrl },
      });
    }
    if (String(url).includes('/codex/v1/responses')) {
      return createJsonResponse({ output_text: 'ok' });
    }
    throw new Error(`unexpected request: ${String(url)}`);
  };

  try {
    const result = await executeProviderJob(
      {
        taskType: 'kie_chat',
        payload: {
          model: 'gpt-5-4-openai-resp',
          messages: [
            { role: 'system', content: '你是助手' },
            {
              role: 'user',
              content: [
                { type: 'text', text: '总结附件' },
                { type: 'input_file', file_url: cloudFileUrl, filename: 'source.pdf' },
              ],
            },
          ],
        },
      },
      { KIE_API_KEY: 'test-key', MEIAO_PUBLIC_BASE_URL: 'http://111.229.66.247' },
      new AbortController().signal
    );

    assert.equal(result.result.content, 'ok');
    assert.equal(requests.filter((item) => item.url.includes('/api/assets/file/')).length, 1);
    assert.equal(requests.filter((item) => item.url.includes('/file-stream-upload')).length, 1);
    assert.equal(requests.filter((item) => item.url.includes('/file-base64-upload')).length, 0);
    const responseRequest = requests.find((item) => item.url.includes('/codex/v1/responses'));
    const responseBody = JSON.parse(String(responseRequest.init.body));
    assert.equal(responseBody.input[0].content[1].type, 'input_file');
    assert.equal(responseBody.input[0].content[1].filename, 'source.pdf');
    assert.equal(responseBody.input[0].content[1].file_url, stagedFileUrl);
    assert.equal(responseBody.input[0].content[1].file_data, undefined);
  } finally {
    global.fetch = originalFetch;
  }
});

test('executeProviderJob uploads managed asset images before gpt-5.4 responses api', async () => {
  __testOnly_clearManagedAssetUploadCache();
  const originalFetch = global.fetch;
  const requests = [];
  const cloudAssetUrl = 'http://111.229.66.247/api/assets/file/img-1/source.png';
  const stagedAssetUrl = 'https://tempfile.redpandaai.co/kieai/30590/mayo-storage/internal/source.png';

  global.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    if (String(url).includes('/api/assets/file/')) {
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'image/png' }),
        arrayBuffer: async () => new TextEncoder().encode('png-binary').buffer,
        json: async () => ({}),
      };
    }
    if (String(url).includes('/file-stream-upload')) {
      return createJsonResponse({
        code: 200,
        data: { fileUrl: stagedAssetUrl },
      });
    }
    if (String(url).includes('/codex/v1/responses')) {
      return createJsonResponse({ output_text: 'ok' });
    }
    throw new Error(`unexpected request: ${String(url)}`);
  };

  try {
    const result = await executeProviderJob(
      {
        taskType: 'kie_chat',
        payload: {
          model: 'gpt-5-4-openai-resp',
          messages: [
            { role: 'system', content: '你是助手' },
            {
              role: 'user',
              content: [
                { type: 'text', text: '分析这张图' },
                { type: 'image_url', image_url: { url: cloudAssetUrl } },
              ],
            },
          ],
        },
      },
      { KIE_API_KEY: 'test-key', MEIAO_PUBLIC_BASE_URL: 'http://111.229.66.247' },
      new AbortController().signal
    );

    assert.equal(result.result.content, 'ok');
    assert.equal(requests.filter((item) => item.url.includes('/api/assets/file/')).length, 1);
    assert.equal(requests.filter((item) => item.url.includes('/file-stream-upload')).length, 1);
    assert.equal(requests.filter((item) => item.url.includes('/file-base64-upload')).length, 0);
    const responseRequest = requests.find((item) => item.url.includes('/codex/v1/responses'));
    const responseBody = JSON.parse(String(responseRequest.init.body));
    assert.equal(responseBody.input[0].content[1].image_url, stagedAssetUrl);
  } finally {
    global.fetch = originalFetch;
  }
});

test('executeProviderJob uploads inline data images for gpt-5.4 responses api instead of sending data urls directly', async () => {
  const originalFetch = global.fetch;
  const requests = [];
  const inlineImage = 'data:image/jpeg;base64,aGVsbG8=';

  global.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    if (String(url).includes('/file-stream-upload')) {
      return createJsonResponse({
        code: 200,
        data: { fileUrl: 'https://kie.example.com/uploaded-inline-image.jpg' },
      });
    }
    if (String(url).includes('/codex/v1/responses')) {
      return createJsonResponse({ output_text: 'ok' });
    }
    throw new Error(`unexpected request: ${String(url)}`);
  };

  try {
    const result = await executeProviderJob(
      {
        taskType: 'kie_chat',
        payload: {
          model: 'gpt-5-4-openai-resp',
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: '分析这张图' },
                { type: 'image_url', image_url: { url: inlineImage } },
              ],
            },
          ],
        },
      },
      { KIE_API_KEY: 'test-key' },
      new AbortController().signal
    );

    assert.equal(result.result.content, 'ok');
    assert.equal(requests.filter((item) => item.url.includes('/file-stream-upload')).length, 1);
    const responseRequest = requests.find((item) => item.url.includes('/codex/v1/responses'));
    const responseBody = JSON.parse(String(responseRequest.init.body));
    assert.equal(responseBody.input[0].content[1].image_url, 'https://kie.example.com/uploaded-inline-image.jpg');
  } finally {
    global.fetch = originalFetch;
  }
});

test('executeProviderJob uploads inline data files for gpt-5.4 responses api instead of sending file_data directly', async () => {
  const originalFetch = global.fetch;
  const requests = [];
  const inlineFile = 'data:text/plain;base64,aGVsbG8=';

  global.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    if (String(url).includes('/file-stream-upload')) {
      return createJsonResponse({
        code: 200,
        data: { fileUrl: 'https://kie.example.com/uploaded-inline-note.txt' },
      });
    }
    if (String(url).includes('/codex/v1/responses')) {
      return createJsonResponse({ output_text: 'ok' });
    }
    throw new Error(`unexpected request: ${String(url)}`);
  };

  try {
    const result = await executeProviderJob(
      {
        taskType: 'kie_chat',
        payload: {
          model: 'gpt-5-4-openai-resp',
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: '读取附件' },
                { type: 'input_file', file_url: inlineFile, filename: 'note.txt' },
              ],
            },
          ],
        },
      },
      { KIE_API_KEY: 'test-key' },
      new AbortController().signal
    );

    assert.equal(result.result.content, 'ok');
    assert.equal(requests.filter((item) => item.url.includes('/file-stream-upload')).length, 1);
    const responseRequest = requests.find((item) => item.url.includes('/codex/v1/responses'));
    const responseBody = JSON.parse(String(responseRequest.init.body));
    assert.equal(responseBody.input[0].content[1].file_url, 'https://kie.example.com/uploaded-inline-note.txt');
    assert.equal(responseBody.input[0].content[1].file_data, undefined);
  } finally {
    global.fetch = originalFetch;
  }
});

test('executeProviderJob rejects removed doubao models', async () => {
  await assert.rejects(
    () =>
      executeProviderJob(
        {
          taskType: 'kie_chat',
          payload: {
            model: 'doubao-seed-1-6-flash-250615',
            messages: [{ role: 'user', content: '描述图片' }],
          },
        },
        { KIE_API_KEY: 'test-key' },
        new AbortController().signal
      ),
    /不支持|未配置|模型/
  );
});

test('executeProviderJob rejects removed gemini thinking aliases', async () => {
  const removedModel = ['gemini-3-flash', 'thinking'].join('-');
  await assert.rejects(
    () => executeProviderJob(
      {
        taskType: 'kie_chat',
        payload: {
          model: removedModel,
          messages: [{ role: 'user', content: 'hello' }],
        },
      },
      { KIE_API_KEY: 'test-key' },
      new AbortController().signal
    ),
    (error) => error?.code === 'provider_bad_request'
      && /不支持的聊天模型/.test(error.message)
  );
});

test('executeProviderJob rejects kie chat requests without an explicit model', async () => {
  await assert.rejects(
    () => executeProviderJob(
      {
        taskType: 'kie_chat',
        payload: {
          messages: [{ role: 'user', content: 'hello' }],
        },
      },
      { KIE_API_KEY: 'test-key' },
      new AbortController().signal
    ),
    (error) => error?.code === 'provider_bad_request'
      && /缺少聊天模型/.test(error.message)
  );
});

test('executeProviderJob routes gemini 3.1 pro through kie chat endpoint with google search and reasoning effort', async () => {
  const originalFetch = global.fetch;
  const requests = [];

  global.fetch = async (url, init) => {
    requests.push({ url: String(url), init });
    return createJsonResponse({
      choices: [
        {
          message: {
            content: 'gemini 3.1 pro result',
          },
        },
      ],
    });
  };

  try {
    const result = await executeProviderJob(
      {
        taskType: 'kie_chat',
        payload: {
          model: 'gemini-3.1-pro-openai',
          reasoningLevel: 'high',
          webSearchEnabled: true,
          messages: [
            { role: 'system', content: '你是助手' },
            {
              role: 'user',
              content: [
                { type: 'text', text: '帮我分析这些素材' },
                { type: 'image_url', image_url: { url: 'https://example.com/a.png' } },
                { type: 'input_file', file_url: 'https://example.com/a.pdf', filename: 'a.pdf' },
              ],
            },
          ],
        },
      },
      { KIE_API_KEY: 'test-key' },
      new AbortController().signal
    );

    assert.equal(result.result.content, 'gemini 3.1 pro result');
    assert.match(requests[0].url, /\/gemini-3\.1-pro\/v1\/chat\/completions$/);
    const body = JSON.parse(String(requests[0].init.body));
    assert.equal(body.model, 'gemini-3.1-pro-openai');
    assert.equal(body.messages[1].content[0].type, 'text');
    assert.equal(body.messages[1].content[1].type, 'image_url');
    assert.equal(body.messages[1].content[1].image_url.url, 'https://example.com/a.png');
    assert.equal(body.messages[1].content[2].type, 'image_url');
    assert.equal(body.messages[1].content[2].image_url.url, 'https://example.com/a.pdf');
    assert.deepEqual(body.tools[0].googleSearch, {});
    assert.equal(body.include_thoughts, true);
    assert.equal(body.reasoning_effort, 'high');
  } finally {
    global.fetch = originalFetch;
  }
});

test('executeProviderJob routes gemini 3.5 flash through kie native gemini streamGenerateContent', async () => {
  const originalFetch = global.fetch;
  const requests = [];

  global.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    return createJsonResponse({
      candidates: [
        {
          content: {
            role: 'model',
            parts: [{ text: '商品卖点文案' }],
          },
          finishReason: 'STOP',
        },
      ],
      modelVersion: 'gemini-3-5-flash',
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 },
      credits_consumed: 0.01,
      responseId: 'gemini35-response-1',
    });
  };

  try {
    const result = await executeProviderJob(
      {
        taskType: 'kie_chat',
        provider: 'kie',
        payload: {
          model: 'gemini-3-5-flash',
          reasoningLevel: 'high',
          webSearchEnabled: true,
          messages: [
            { role: 'system', content: '只输出中文。' },
            { role: 'user', content: '写一个商品卖点。' },
          ],
        },
      },
      { KIE_API_KEY: 'test-key' },
      new AbortController().signal
    );

    assert.equal(requests[0].url, 'https://api.kie.ai/gemini/v1/models/gemini-3-5-flash:streamGenerateContent');
    assert.equal(requests[0].init.headers.Authorization, 'Bearer test-key');
    assert.equal(requests[0].init.headers['X-Goog-Api-Key'], undefined);
    const body = JSON.parse(String(requests[0].init.body));
    assert.equal(body.stream, true);
    assert.equal(body.contents[0].role, 'user');
    assert.match(body.contents[0].parts[0].text, /只输出中文。/);
    assert.match(body.contents[0].parts[0].text, /写一个商品卖点。/);
    assert.deepEqual(body.tools, [{ googleSearch: {} }]);
    assert.deepEqual(body.generationConfig, {
      thinkingConfig: { includeThoughts: true, thinkingLevel: 'high' },
    });
    assert.equal(result.providerTaskId, 'gemini35-response-1');
    assert.equal(result.result.content, '商品卖点文案');
    assert.equal(result.result.modelUsed, 'gemini-3-5-flash');
    assert.equal(result.result.creditsConsumed, 0.01);
    assert.deepEqual(result.result.usage, { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 });
  } finally {
    global.fetch = originalFetch;
  }
});

test('executeProviderJob extracts gemini 3.5 flash text from native sse candidates', async () => {
  const originalFetch = global.fetch;
  const seenProviderTaskIds = [];

  global.fetch = async () => ({
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': 'text/event-stream' }),
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({
          candidates: [
            {
              content: {
                role: 'model',
                parts: [{ text: '流式商品卖点' }],
              },
            },
          ],
          responseId: 'gemini35-stream-1',
          usageMetadata: { totalTokenCount: 11 },
          credits_consumed: 0.02,
        })}\n\n`));
        controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
        controller.close();
      },
    }),
    json: async () => ({}),
  });

  try {
    const result = await executeProviderJob(
      {
        taskType: 'kie_chat',
        provider: 'kie',
        payload: {
          model: 'gemini-3-5-flash',
          messages: [{ role: 'user', content: '写一个商品卖点。' }],
        },
      },
      { KIE_API_KEY: 'test-key' },
      new AbortController().signal,
      { onProviderTaskId: async (taskId) => seenProviderTaskIds.push(taskId) }
    );

    assert.equal(result.providerTaskId, 'gemini35-stream-1');
    assert.equal(result.result.content, '流式商品卖点');
    assert.equal(result.result.creditsConsumed, 0.02);
    assert.deepEqual(result.result.usage, { totalTokenCount: 11 });
    assert.deepEqual(seenProviderTaskIds, ['gemini35-stream-1']);
  } finally {
    global.fetch = originalFetch;
  }
});

test('executeProviderJob uploads managed file attachments before gemini chat models', async () => {
  const originalFetch = global.fetch;
  const requests = [];
  const cloudFileUrl = 'http://111.229.66.247/api/assets/file/file-2/source.pdf';
  const stagedFileUrl = 'https://tempfile.redpandaai.co/kieai/30590/mayo-storage/internal/source.pdf';

  global.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    if (String(url).includes('/api/assets/file/')) {
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/pdf' }),
        arrayBuffer: async () => new TextEncoder().encode('pdf-binary').buffer,
        json: async () => ({}),
      };
    }
    if (String(url).includes('/file-stream-upload')) {
      return createJsonResponse({
        code: 200,
        data: { fileUrl: stagedFileUrl },
      });
    }
    if (String(url).includes('/gemini-3-flash/v1/chat/completions')) {
      return createJsonResponse({
        choices: [
          {
            message: {
              content: 'gemini managed file ok',
            },
          },
        ],
      });
    }
    throw new Error(`unexpected request: ${String(url)}`);
  };

  try {
    const result = await executeProviderJob(
      {
        taskType: 'kie_chat',
        payload: {
          model: 'gemini-3-flash-openai',
          messages: [
            { role: 'system', content: '你是助手' },
            {
              role: 'user',
              content: [
                { type: 'text', text: `读取这个 pdf，文件URL：${cloudFileUrl}` },
                { type: 'input_file', file_url: cloudFileUrl, filename: 'source.pdf' },
              ],
            },
          ],
        },
      },
      { KIE_API_KEY: 'test-key', MEIAO_PUBLIC_BASE_URL: 'http://111.229.66.247' },
      new AbortController().signal
    );

    assert.equal(result.result.content, 'gemini managed file ok');
    assert.equal(requests.filter((item) => item.url.includes('/api/assets/file/')).length, 1);
    assert.equal(requests.filter((item) => item.url.includes('/file-stream-upload')).length, 1);
    const chatRequest = requests.find((item) => item.url.includes('/gemini-3-flash/v1/chat/completions'));
    const chatBody = JSON.parse(String(chatRequest.init.body));
    assert.equal(chatBody.messages[1].content[0].text, `读取这个 pdf，文件URL：${stagedFileUrl}`);
    assert.equal(chatBody.messages[1].content[1].type, 'image_url');
    assert.equal(chatBody.messages[1].content[1].image_url.url, stagedFileUrl);
  } finally {
    global.fetch = originalFetch;
  }
});

test('executeProviderJob uploads stable redpanda video urls to openrouter chat before gemini chat', async () => {
  const originalFetch = global.fetch;
  const requests = [];

  global.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    if (String(url).includes('/kieai/30590/mayo-storage/abc/reference.mp4')) {
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'video/mp4' }),
        arrayBuffer: async () => new TextEncoder().encode('stable-mp4-binary').buffer,
        json: async () => ({}),
      };
    }
    if (String(url).includes('/file-stream-upload')) {
      return createJsonResponse({
        code: 200,
        data: { fileUrl: 'https://tempfileb.aiquickdraw.com/kieai/openrouter-chat/reference-readable.mp4' },
      });
    }
    if (String(url).includes('/gemini-3.1-pro/v1/chat/completions')) {
      return createJsonResponse({
        choices: [{ message: { content: 'gemini video ok' } }],
      });
    }
    throw new Error(`unexpected request: ${String(url)}`);
  };

  try {
    const sourceVideoUrl = 'https://tempfile.redpandaai.co/kieai/30590/mayo-storage/abc/reference.mp4';
    const result = await executeProviderJob(
      {
        taskType: 'kie_chat',
        payload: {
          model: 'gemini-3.1-pro-openai',
          reasoningLevel: 'high',
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: `读取这个视频 ${sourceVideoUrl}` },
                { type: 'input_file', file_url: sourceVideoUrl, filename: 'reference.mp4' },
              ],
            },
          ],
        },
      },
      { KIE_API_KEY: 'test-key' },
      new AbortController().signal
    );

    assert.equal(result.result.content, 'gemini video ok');
    const uploadRequest = requests.find((item) => item.url.includes('/file-stream-upload'));
    assert.ok(uploadRequest, 'stable redpanda video should be moved to openrouter-chat for gemini video analysis');
    assert.equal(uploadRequest.init.body.get('uploadPath'), 'openrouter-chat');
    assert.equal(uploadRequest.init.body.get('fileName'), 'reference.mp4');
    const chatRequest = requests.find((item) => item.url.includes('/gemini-3.1-pro/v1/chat/completions'));
    const chatBody = JSON.parse(String(chatRequest.init.body));
    assert.equal(chatBody.messages[0].content[0].text, '读取这个视频 https://tempfileb.aiquickdraw.com/kieai/openrouter-chat/reference-readable.mp4');
    assert.equal(chatBody.messages[0].content[1].type, 'image_url');
    assert.equal(chatBody.messages[0].content[1].image_url.url, 'https://tempfileb.aiquickdraw.com/kieai/openrouter-chat/reference-readable.mp4');
    assert.equal(chatBody.reasoning_effort, 'high');
  } finally {
    global.fetch = originalFetch;
  }
});

test('executeProviderJob rejects private-network remote video urls before gemini upload', async () => {
  const originalFetch = global.fetch;
  let fetchCalled = false;
  global.fetch = async () => {
    fetchCalled = true;
    throw new Error('private video url should be rejected before fetch');
  };

  try {
    const privateVideoUrl = 'http://127.0.0.1:3100/private-reference.mp4';
    await assert.rejects(
      executeProviderJob(
        {
          taskType: 'kie_chat',
          payload: {
            model: 'gemini-3.1-pro-openai',
            messages: [
              {
                role: 'user',
                content: [
                  { type: 'text', text: `读取这个视频 ${privateVideoUrl}` },
                  { type: 'input_file', file_url: privateVideoUrl, filename: 'private-reference.mp4' },
                ],
              },
            ],
          },
        },
        { KIE_API_KEY: 'test-key' },
        new AbortController().signal
      ),
      /远程素材地址不可指向本机或内网地址/
    );
    assert.equal(fetchCalled, false);
  } finally {
    global.fetch = originalFetch;
  }
});

test('executeProviderJob rejects oversized remote video urls before kie upload', async () => {
  const originalFetch = global.fetch;
  const requests = [];

  global.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    if (String(url).includes('/oversized-reference.mp4')) {
      return {
        ok: true,
        status: 200,
        headers: new Headers({
          'content-type': 'video/mp4',
          'content-length': String(300 * 1024 * 1024),
        }),
        arrayBuffer: async () => {
          throw new Error('oversized media should be rejected before download');
        },
        json: async () => ({}),
      };
    }
    throw new Error(`unexpected request: ${String(url)}`);
  };

  try {
    const oversizedVideoUrl = 'https://tempfile.redpandaai.co/kieai/30590/mayo-storage/abc/oversized-reference.mp4';
    await assert.rejects(
      executeProviderJob(
        {
          taskType: 'kie_chat',
          payload: {
            model: 'gemini-3.1-pro-openai',
            messages: [
              {
                role: 'user',
                content: [
                  { type: 'text', text: `读取这个视频 ${oversizedVideoUrl}` },
                  { type: 'input_file', file_url: oversizedVideoUrl, filename: 'oversized-reference.mp4' },
                ],
              },
            ],
          },
        },
        { KIE_API_KEY: 'test-key' },
        new AbortController().signal
      ),
      /远程视频素材过大，当前最大支持 256MB/
    );
    assert.equal(requests.some((item) => item.url.includes('/file-stream-upload')), false);
  } finally {
    global.fetch = originalFetch;
  }
});

test('executeProviderJob uploads stable image_url video payloads for gemini flash openai requests', async () => {
  const originalFetch = global.fetch;
  const requests = [];

  global.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    if (String(url).includes('/kieai/30590/mayo-storage/abc/legacy-reference.mp4')) {
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'video/mp4' }),
        arrayBuffer: async () => new TextEncoder().encode('legacy-mp4-binary').buffer,
        json: async () => ({}),
      };
    }
    if (String(url).includes('/file-stream-upload')) {
      return createJsonResponse({
        code: 200,
        data: { fileUrl: 'https://tempfileb.aiquickdraw.com/kieai/openrouter-chat/legacy-readable.mp4' },
      });
    }
    if (String(url).includes('/gemini-3-flash/v1/chat/completions')) {
      return createJsonResponse({
        choices: [{ message: { content: 'legacy gemini video ok' } }],
      });
    }
    throw new Error(`unexpected request: ${String(url)}`);
  };

  try {
    const sourceVideoUrl = 'https://tempfile.redpandaai.co/kieai/30590/mayo-storage/abc/legacy-reference.mp4';
    const result = await executeProviderJob(
      {
        taskType: 'kie_chat',
        payload: {
          model: 'gemini-3-flash-openai',
          reasoningLevel: 'high',
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: `[爆款复刻视频URL] ${sourceVideoUrl}` },
                { type: 'image_url', image_url: { url: sourceVideoUrl } },
              ],
            },
          ],
        },
      },
      { KIE_API_KEY: 'test-key' },
      new AbortController().signal
    );

    assert.equal(result.result.content, 'legacy gemini video ok');
    const uploadRequest = requests.find((item) => item.url.includes('/file-stream-upload'));
    assert.ok(uploadRequest, 'stable legacy video should be moved to openrouter-chat');
    assert.equal(uploadRequest.init.body.get('uploadPath'), 'openrouter-chat');
    const chatRequest = requests.find((item) => item.url.includes('/gemini-3-flash/v1/chat/completions'));
    assert.ok(chatRequest, 'gemini flash openai should use the gemini flash endpoint');
    const chatBody = JSON.parse(String(chatRequest.init.body));
    assert.equal(chatBody.messages[0].content[0].text, '[爆款复刻视频URL] https://tempfileb.aiquickdraw.com/kieai/openrouter-chat/legacy-readable.mp4');
    assert.equal(chatBody.messages[0].content[1].type, 'image_url');
    assert.equal(chatBody.messages[0].content[1].image_url.url, 'https://tempfileb.aiquickdraw.com/kieai/openrouter-chat/legacy-readable.mp4');
    assert.equal(chatBody.reasoning_effort, 'high');
  } finally {
    global.fetch = originalFetch;
  }
});

test('executeProviderJob moves redpanda openrouter-chat video urls to aiquickdraw openrouter chat before gemini chat', async () => {
  const originalFetch = global.fetch;
  const requests = [];

  global.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    if (String(url).includes('/kieai/30590/openrouter-chat/') && String(url).endsWith('.mp4')) {
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'video/mp4' }),
        arrayBuffer: async () => new TextEncoder().encode('mp4-binary').buffer,
        json: async () => ({}),
      };
    }
    if (String(url).includes('/file-stream-upload')) {
      return createJsonResponse({
        code: 200,
        data: { fileUrl: 'https://tempfileb.aiquickdraw.com/kieai/openrouter-chat/real-uploaded-video.mp4' },
      });
    }
    if (String(url).includes('/gemini-3-flash/v1/chat/completions')) {
      return createJsonResponse({
        choices: [{ message: { content: 'reuploaded openrouter video ok' } }],
      });
    }
    throw new Error(`unexpected request: ${String(url)}`);
  };

  try {
    const sourceVideoUrl = 'https://tempfile.redpandaai.co/kieai/30590/openrouter-chat/___1778687474872_______.mp4';
    const expectedVideoUrl = 'https://tempfileb.aiquickdraw.com/kieai/openrouter-chat/real-uploaded-video.mp4';
    const result = await executeProviderJob(
      {
        taskType: 'kie_chat',
        payload: {
          model: 'gemini-3-flash-openai',
          reasoningLevel: 'high',
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: `[爆款复刻视频URL] ${sourceVideoUrl}` },
                { type: 'image_url', image_url: { url: sourceVideoUrl } },
              ],
            },
          ],
        },
      },
      { KIE_API_KEY: 'test-key' },
      new AbortController().signal
    );

    assert.equal(result.result.content, 'reuploaded openrouter video ok');
    assert.equal(requests.filter((item) => item.url === sourceVideoUrl).length, 1);
    const uploadRequest = requests.find((item) => item.url.includes('/file-stream-upload'));
    assert.ok(uploadRequest, 'redpanda openrouter-chat video should be moved to aiquickdraw openrouter-chat before gemini chat');
    assert.equal(uploadRequest.init.body.get('uploadPath'), 'openrouter-chat');
    const chatRequest = requests.find((item) => item.url.includes('/gemini-3-flash/v1/chat/completions'));
    assert.ok(chatRequest, 'gemini chat request should be sent');
    const chatBody = JSON.parse(String(chatRequest.init.body));
    assert.equal(chatBody.messages[0].content[0].text, `[爆款复刻视频URL] ${expectedVideoUrl}`);
    assert.equal(chatBody.messages[0].content[1].image_url.url, expectedVideoUrl);
  } finally {
    global.fetch = originalFetch;
  }
});

test('executeProviderJob moves redpanda openrouter-chat video urls to aiquickdraw openrouter chat for gemini pro openai', async () => {
  const originalFetch = global.fetch;
  const requests = [];

  global.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    if (String(url).includes('/kieai/30590/openrouter-chat/') && String(url).endsWith('.mp4')) {
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'video/mp4' }),
        arrayBuffer: async () => new TextEncoder().encode('mp4-binary').buffer,
        json: async () => ({}),
      };
    }
    if (String(url).includes('/file-stream-upload')) {
      return createJsonResponse({
        code: 200,
        data: { fileUrl: 'https://tempfileb.aiquickdraw.com/kieai/openrouter-chat/pro-preview-video.mp4' },
      });
    }
    if (String(url).includes('/gemini-3.1-pro/v1/chat/completions')) {
      return createJsonResponse({
        choices: [{ message: { content: 'gemini pro preview video ok' } }],
      });
    }
    throw new Error(`unexpected request: ${String(url)}`);
  };

  try {
    const sourceVideoUrl = 'https://tempfile.redpandaai.co/kieai/30590/openrouter-chat/___1778691328103_______.mp4';
    const expectedVideoUrl = 'https://tempfileb.aiquickdraw.com/kieai/openrouter-chat/pro-preview-video.mp4';
    const result = await executeProviderJob(
      {
        taskType: 'kie_chat',
        payload: {
          model: 'gemini-3.1-pro-openai',
          reasoningLevel: 'high',
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: `[爆款复刻视频URL] ${sourceVideoUrl}` },
                { type: 'input_file', file_url: sourceVideoUrl, filename: 'viral-reference-video' },
              ],
            },
          ],
        },
      },
      { KIE_API_KEY: 'test-key' },
      new AbortController().signal
    );

    assert.equal(result.result.content, 'gemini pro preview video ok');
    assert.equal(requests.filter((item) => item.url === sourceVideoUrl).length, 1);
    const uploadRequest = requests.find((item) => item.url.includes('/file-stream-upload'));
    assert.ok(uploadRequest, 'gemini pro openai video should be moved to aiquickdraw openrouter-chat before chat');
    assert.equal(uploadRequest.init.body.get('uploadPath'), 'openrouter-chat');
    const chatRequest = requests.find((item) => item.url.includes('/gemini-3.1-pro/v1/chat/completions'));
    assert.ok(chatRequest, 'gemini pro openai should use the gemini pro endpoint');
    const chatBody = JSON.parse(String(chatRequest.init.body));
    assert.equal(chatBody.messages[0].content[0].text, `[爆款复刻视频URL] ${expectedVideoUrl}`);
    assert.equal(chatBody.messages[0].content[1].type, 'image_url');
    assert.equal(chatBody.messages[0].content[1].image_url.url, expectedVideoUrl);
    assert.equal(chatBody.reasoning_effort, 'high');
  } finally {
    global.fetch = originalFetch;
  }
});

test('executeProviderJob never sends redpanda openrouter-chat mp4 directly to gemini', async () => {
  const originalFetch = global.fetch;
  const requests = [];

  global.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    if (String(url).includes('/kieai/30590/openrouter-chat/') && String(url).endsWith('.mp4')) {
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'video/mp4' }),
        arrayBuffer: async () => new TextEncoder().encode('mp4-binary').buffer,
        json: async () => ({}),
      };
    }
    if (String(url).includes('/file-stream-upload')) {
      return createJsonResponse({
        code: 200,
        data: { fileUrl: 'https://tempfile.redpandaai.co/kieai/30590/mayo-storage/internal/fixed-video.mp4' },
      });
    }
    if (String(url).includes('/gemini-3.1-pro/v1/chat/completions')) {
      return createJsonResponse({
        choices: [{ message: { content: 'fixed video ok' } }],
      });
    }
    throw new Error(`unexpected request: ${String(url)}`);
  };

  try {
    const sourceVideoUrl = 'https://tempfile.redpandaai.co/kieai/30590/openrouter-chat/___1778691328103_______.mp4';
    const result = await executeProviderJob(
      {
        taskType: 'kie_chat',
        payload: {
          model: 'gemini-3.1-pro-openai',
          reasoningLevel: 'high',
          messages: [
            {
              role: 'system',
              content: [{ type: 'text', text: 'Output JSON.' }],
            },
            {
              role: 'user',
              content: [
                { type: 'text', text: `输入C：爆款复刻视频公网URL：${sourceVideoUrl}` },
                { type: 'text', text: `[爆款复刻视频URL] ${sourceVideoUrl}` },
                { type: 'image_url', image_url: { url: sourceVideoUrl } },
              ],
            },
          ],
        },
      },
      { KIE_API_KEY: 'test-key' },
      new AbortController().signal
    );

    assert.equal(result.result.content, 'fixed video ok');
    const chatRequest = requests.find((item) => item.url.includes('/gemini-3.1-pro/v1/chat/completions'));
    const chatBodyText = String(chatRequest.init.body);
    assert.doesNotMatch(chatBodyText, /tempfile\.redpandaai\.co\/kieai\/30590\/openrouter-chat/);
    assert.match(chatBodyText, /tempfile\.redpandaai\.co\/kieai\/30590\/mayo-storage\/internal\/fixed-video\.mp4/);
  } finally {
    global.fetch = originalFetch;
  }
});

test('executeProviderJob uploads managed image urls inside gemini text labels', async () => {
  const originalFetch = global.fetch;
  const requests = [];
  const sourceUrl = 'http://111.229.66.247/api/assets/file/ref-1/reference.jpg';
  const stagedUrl = 'https://tempfile.redpandaai.co/kieai/30590/mayo-storage/internal/reference.jpg';

  global.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    if (String(url).includes('/api/assets/file/')) {
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'image/jpeg' }),
        arrayBuffer: async () => new TextEncoder().encode('jpg-binary').buffer,
        json: async () => ({}),
      };
    }
    if (String(url).includes('/file-stream-upload')) {
      return createJsonResponse({
        code: 200,
        data: { fileUrl: stagedUrl },
      });
    }
    if (String(url).includes('/gemini-3-flash/v1/chat/completions')) {
      return createJsonResponse({ choices: [{ message: { content: 'gemini image ok' } }] });
    }
    throw new Error(`unexpected request: ${String(url)}`);
  };

  try {
    const result = await executeProviderJob(
      {
        taskType: 'kie_chat',
        payload: {
          model: 'gemini-3-flash-openai',
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: `[复刻主图参考1] 图片URL：${sourceUrl}。这是唯一版式参考。` },
                { type: 'image_url', image_url: { url: sourceUrl } },
              ],
            },
          ],
        },
      },
      { KIE_API_KEY: 'test-key', MEIAO_PUBLIC_BASE_URL: 'http://111.229.66.247' },
      new AbortController().signal
    );

    assert.equal(result.result.content, 'gemini image ok');
    assert.equal(requests.filter((item) => item.url.includes('/api/assets/file/')).length, 1);
    assert.equal(requests.filter((item) => item.url.includes('/file-stream-upload')).length, 1);
    const chatRequest = requests.find((item) => item.url.includes('/gemini-3-flash/v1/chat/completions'));
    const chatBody = JSON.parse(String(chatRequest.init.body));
    assert.equal(chatBody.messages[0].content[0].text, `[复刻主图参考1] 图片URL：${stagedUrl}。这是唯一版式参考。`);
    assert.equal(chatBody.messages[0].content[1].image_url.url, stagedUrl);
  } finally {
    global.fetch = originalFetch;
  }
});

test('executeProviderJob reuploads octet-stream product image urls with a real image extension before gemini flash', async () => {
  const originalFetch = global.fetch;
  const requests = [];

  global.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    if (String(url).includes('/mayo-storage/product/ref_IMG_8536_JPG')) {
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/octet-stream' }),
        arrayBuffer: async () => Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]).buffer,
        json: async () => ({}),
      };
    }
    if (String(url).includes('/file-stream-upload')) {
      return createJsonResponse({
        code: 200,
        data: { fileUrl: 'https://tempfile.redpandaai.co/kieai/30590/mayo-storage/internal/ref_IMG_8536.jpg' },
      });
    }
    if (String(url).includes('/gemini-3-flash/v1/chat/completions')) {
      return createJsonResponse({
        choices: [{ message: { content: 'gemini product image ok' } }],
      });
    }
    throw new Error(`unexpected request: ${String(url)}`);
  };

  try {
    const sourceUrl = 'https://tempfile.redpandaai.co/kieai/30590/mayo-storage/product/ref_IMG_8536_JPG';
    const result = await executeProviderJob(
      {
        taskType: 'kie_chat',
        payload: {
          model: 'gemini-3-flash-openai',
          reasoningLevel: 'high',
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: `商品参考图公网URL1：${sourceUrl}` },
                { type: 'image_url', image_url: { url: sourceUrl } },
              ],
            },
          ],
        },
      },
      { KIE_API_KEY: 'test-key' },
      new AbortController().signal
    );

    assert.equal(result.result.content, 'gemini product image ok');
    const uploadRequest = requests.find((item) => item.url.includes('/file-stream-upload'));
    assert.ok(uploadRequest, 'octet-stream product image should be reuploaded with a proper image filename');
    assert.equal(uploadRequest.init.body.get('fileName'), 'ref_IMG_8536_JPG.jpg');
    const chatRequest = requests.find((item) => item.url.includes('/gemini-3-flash/v1/chat/completions'));
    const chatBody = JSON.parse(String(chatRequest.init.body));
    assert.equal(chatBody.messages[0].content[0].text, '商品参考图公网URL1：https://tempfile.redpandaai.co/kieai/30590/mayo-storage/internal/ref_IMG_8536.jpg');
    assert.equal(chatBody.messages[0].content[1].image_url.url, 'https://tempfile.redpandaai.co/kieai/30590/mayo-storage/internal/ref_IMG_8536.jpg');
  } finally {
    global.fetch = originalFetch;
  }
});

test('executeProviderJob extracts text when kie chat returns structured content parts', async () => {
  const originalFetch = global.fetch;

  global.fetch = async () =>
    createJsonResponse({
      choices: [
        {
          message: {
            content: [
              { type: 'reasoning', text: '内部思考' },
              { type: 'text', text: '这是最终结果' },
            ],
          },
        },
      ],
    });

  try {
    const result = await executeProviderJob(
      {
        taskType: 'kie_chat',
        payload: {
          model: 'gemini-3.1-pro-openai',
          messages: [{ role: 'user', content: '帮我总结' }],
        },
      },
      { KIE_API_KEY: 'test-key' },
      new AbortController().signal
    );

    assert.equal(result.result.content, '这是最终结果');
  } finally {
    global.fetch = originalFetch;
  }
});

test('executeProviderJob extracts text when kie chat response is wrapped under data', async () => {
  const originalFetch = global.fetch;

  global.fetch = async () =>
    createJsonResponse({
      data: {
        choices: [
          {
            message: {
              content: '包装后的结果文本',
            },
          },
        ],
      },
    });

  try {
    const result = await executeProviderJob(
      {
        taskType: 'kie_chat',
        payload: {
          model: 'gemini-3-flash-openai',
          messages: [{ role: 'user', content: '帮我总结' }],
        },
      },
      { KIE_API_KEY: 'test-key' },
      new AbortController().signal
    );

    assert.equal(result.result.content, '包装后的结果文本');
  } finally {
    global.fetch = originalFetch;
  }
});

test('executeProviderJob treats provider error text in successful kie chat responses as a failed request', async () => {
  const originalFetch = global.fetch;

  global.fetch = async () =>
    createJsonResponse({
      choices: [
        {
          message: {
            content: 'The file mime type is not supported by Gemini, please convert or change the file',
          },
        },
      ],
    });

  try {
    await assert.rejects(
      () => executeProviderJob(
        {
          taskType: 'kie_chat',
          payload: {
            model: 'gemini-3.1-pro-openai',
            messages: [{ role: 'user', content: '读取视频' }],
          },
        },
        { KIE_API_KEY: 'test-key' },
        new AbortController().signal
      ),
      (error) => error?.code === 'provider_bad_request'
        && /file mime type is not supported/i.test(error.message)
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test('executeProviderJob treats provider file information text as a failed request', async () => {
  const originalFetch = global.fetch;

  global.fetch = async () =>
    createJsonResponse({
      choices: [
        {
          message: {
            content: 'Failed to get the file information',
          },
        },
      ],
    });

  try {
    await assert.rejects(
      () => executeProviderJob(
        {
          taskType: 'kie_chat',
          payload: {
            model: 'gemini-3.1-pro-openai',
            messages: [{ role: 'user', content: '读取视频' }],
          },
        },
        { KIE_API_KEY: 'test-key' },
        new AbortController().signal
      ),
      (error) => error?.code === 'provider_bad_response'
        && /failed to get the file information/i.test(error.message)
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test('executeProviderJob retries direct managed asset chat through KIE on explicit media read failure', async () => {
  __testOnly_clearManagedAssetUploadCache();
  const originalFetch = global.fetch;
  const requests = [];
  const managedAssetUrl = 'http://111.229.66.247/api/assets/file/direct-chat/source.png';
  const directAssetUrl = 'https://meiaoyuntai.com/api/assets/file/direct-chat/source.png';
  const stagedAssetUrl = 'https://tempfile.redpandaai.co/kieai/30590/mayo-storage/internal/direct-chat.png';
  let responseCalls = 0;

  global.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    if (String(url).includes('/codex/v1/responses')) {
      responseCalls += 1;
      if (responseCalls === 1) {
        return createJsonResponse({ output_text: 'Failed to get the file information' });
      }
      return createJsonResponse({ id: 'resp-direct-chat-fallback', output_text: 'direct chat fallback ok' });
    }
    if (String(url).includes('/api/assets/file/')) {
      return new Response(Buffer.from([0x89, 0x50, 0x4e, 0x47]), {
        status: 200,
        headers: { 'Content-Type': 'image/png' },
      });
    }
    if (String(url).includes('/file-stream-upload')) {
      return createJsonResponse({ code: 200, data: { fileUrl: stagedAssetUrl } });
    }
    throw new Error(`unexpected request: ${String(url)}`);
  };

  try {
    const result = await executeProviderJob(
      {
        taskType: 'kie_chat',
        payload: {
          model: 'gpt-5-4-openai-resp',
          fallbackModels: ['gpt-5-2'],
          messages: [{
            role: 'user',
            content: [
              { type: 'text', text: '分析图片' },
              { type: 'image_url', image_url: { url: managedAssetUrl } },
            ],
          }],
        },
      },
      {
        KIE_API_KEY: 'test-key',
        MEIAO_PUBLIC_BASE_URL: 'https://meiaoyuntai.com',
        MEIAO_KIE_MANAGED_ASSET_MODE: 'direct-first',
        MEIAO_KIE_ASSET_UPLOAD_RETRIES: '0',
      },
      new AbortController().signal
    );

    assert.equal(result.providerTaskId, 'resp-direct-chat-fallback');
    assert.equal(result.result.content, 'direct chat fallback ok');
    assert.equal(requests.filter((item) => item.url.includes('/file-stream-upload')).length, 1);
    const responseBodies = requests
      .filter((item) => item.url.includes('/codex/v1/responses'))
      .map((item) => JSON.parse(String(item.init.body)));
    assert.equal(responseBodies.length, 2);
    assert.equal(responseBodies[0].input[0].content[1].image_url, directAssetUrl);
    assert.equal(responseBodies[1].input[0].content[1].image_url, stagedAssetUrl);
    assert.equal(responseBodies[0].model, responseBodies[1].model);
  } finally {
    global.fetch = originalFetch;
  }
});

test('executeProviderJob does not resubmit direct managed media after ambiguous HTTP 502', async () => {
  __testOnly_clearManagedAssetUploadCache();
  const originalFetch = global.fetch;
  const requests = [];
  let responseCalls = 0;

  global.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    if (String(url).includes('/codex/v1/responses')) {
      responseCalls += 1;
      return createJsonResponse({ message: 'Bad gateway' }, 502);
    }
    throw new Error(`unexpected request: ${String(url)}`);
  };

  try {
    await assert.rejects(
      () => executeProviderJob(
        {
          taskType: 'kie_chat',
          payload: {
            model: 'gpt-5-4-openai-resp',
            fallbackModels: ['gemini-3-flash-openai'],
            messages: [{
              role: 'user',
              content: [{ type: 'image_url', image_url: { url: '/api/assets/file/direct-502/source.jpg' } }],
            }],
          },
        },
        {
          KIE_API_KEY: 'test-key',
          MEIAO_PUBLIC_BASE_URL: 'https://meiaoyuntai.com',
          MEIAO_KIE_MANAGED_ASSET_MODE: 'direct-first',
          MEIAO_KIE_ASSET_UPLOAD_RETRIES: '0',
        },
        new AbortController().signal
      ),
      (error) => error?.code === 'provider_internal_error'
        && Number(error?.providerHttpStatus) === 502
    );

    assert.equal(responseCalls, 1);
    assert.equal(requests.filter((item) => item.url.includes('/file-stream-upload')).length, 0);
  } finally {
    global.fetch = originalFetch;
  }
});

test('executeProviderJob task id prevents direct media and model fallback for chat error text', async () => {
  __testOnly_clearManagedAssetUploadCache();
  const originalFetch = global.fetch;
  const requests = [];

  global.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    if (String(url).includes('/codex/v1/responses')) {
      return createJsonResponse({
        id: 'resp-already-created',
        output_text: 'Failed to get the file information',
      });
    }
    throw new Error(`unexpected request: ${String(url)}`);
  };

  try {
    await assert.rejects(
      () => executeProviderJob(
        {
          taskType: 'kie_chat',
          payload: {
            model: 'gpt-5-4-openai-resp',
            fallbackModels: ['gpt-5-2'],
            messages: [{
              role: 'user',
              content: [{ type: 'image_url', image_url: { url: '/api/assets/file/direct-task-id/source.png' } }],
            }],
          },
        },
        {
          KIE_API_KEY: 'test-key',
          MEIAO_PUBLIC_BASE_URL: 'https://meiaoyuntai.com',
          MEIAO_KIE_MANAGED_ASSET_MODE: 'direct-first',
        },
        new AbortController().signal
      ),
      (error) => error?.providerTaskId === 'resp-already-created'
        && /Failed to get the file information/i.test(error.message)
    );

    assert.equal(requests.filter((item) => item.url.includes('/codex/v1/responses')).length, 1);
    assert.equal(requests.filter((item) => item.url.includes('/file-stream-upload')).length, 0);
  } finally {
    global.fetch = originalFetch;
  }
});

test('executeProviderJob forces KIE media on same-model Gemini direct media fallback', async () => {
  __testOnly_clearManagedAssetUploadCache();
  const originalFetch = global.fetch;
  const requests = [];
  const directAssetUrl = 'https://meiaoyuntai.com/api/assets/file/direct-gemini/source.png';
  const stagedAssetUrl = 'https://tempfile.redpandaai.co/kieai/30590/mayo-storage/internal/direct-gemini.png';

  global.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    if (String(url).includes('/gemini-3-flash')) {
      const body = JSON.parse(String(init.body));
      const mediaUrl = body.messages[0].content[1].image_url.url;
      if (mediaUrl === directAssetUrl) {
        return createJsonResponse({
          choices: [{ message: { content: 'Failed to get the file information' } }],
        });
      }
      assert.equal(mediaUrl, stagedAssetUrl);
      return createJsonResponse({
        id: 'gemini-direct-fallback-task',
        choices: [{ message: { content: 'gemini direct fallback ok' } }],
      });
    }
    if (String(url).includes('/api/assets/file/')) {
      return new Response(Buffer.from([0x89, 0x50, 0x4e, 0x47]), {
        status: 200,
        headers: { 'Content-Type': 'image/png' },
      });
    }
    if (String(url).includes('/file-stream-upload')) {
      return createJsonResponse({ code: 200, data: { fileUrl: stagedAssetUrl } });
    }
    throw new Error(`unexpected request: ${String(url)}`);
  };

  try {
    const result = await executeProviderJob(
      {
        taskType: 'kie_chat',
        payload: {
          model: 'gemini-3-flash-openai',
          messages: [{
            role: 'user',
            content: [
              { type: 'text', text: '分析图片' },
              { type: 'image_url', image_url: { url: '/api/assets/file/direct-gemini/source.png' } },
            ],
          }],
        },
      },
      {
        KIE_API_KEY: 'test-key',
        MEIAO_PUBLIC_BASE_URL: 'https://meiaoyuntai.com',
        MEIAO_KIE_MANAGED_ASSET_MODE: 'direct-first',
        MEIAO_KIE_ASSET_UPLOAD_RETRIES: '0',
      },
      new AbortController().signal
    );

    assert.equal(result.result.content, 'gemini direct fallback ok');
    assert.equal(requests.filter((item) => item.url.includes('/gemini-3-flash')).length, 2);
    assert.equal(requests.filter((item) => item.url.includes('/file-stream-upload')).length, 1);
  } finally {
    global.fetch = originalFetch;
  }
});

test('executeProviderJob never retries managed media after an ambiguous HTTP 5xx', async () => {
  __testOnly_clearManagedAssetUploadCache();
  const originalFetch = global.fetch;
  const requests = [];

  global.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    if (String(url).includes('/gemini-3.1-pro/v1/chat/completions')) {
      return createJsonResponse({ message: 'Failed to get the file information' }, 502);
    }
    throw new Error(`ambiguous 5xx must not trigger another request: ${String(url)}`);
  };

  try {
    await assert.rejects(
      () => executeProviderJob(
        {
          module: 'video',
          subFeature: 'storyboard',
          taskType: 'kie_chat',
          payload: {
            model: 'gemini-3.1-pro-openai',
            messages: [{
              role: 'user',
              content: [{ type: 'input_file', file_url: '/api/assets/file/storyboard/ambiguous.mp4' }],
            }],
          },
        },
        {
          KIE_API_KEY: 'test-key',
          MEIAO_PUBLIC_BASE_URL: 'https://meiaoyuntai.com',
          MEIAO_KIE_MANAGED_ASSET_MODE: 'direct-first',
        },
        new AbortController().signal
      ),
      (error) => Number(error?.providerHttpStatus) === 502
    );

    assert.equal(requests.filter((item) => item.url.includes('/gemini-3.1-pro/v1/chat/completions')).length, 1);
    assert.equal(requests.filter((item) => item.url.includes('/file-stream-upload')).length, 0);
  } finally {
    global.fetch = originalFetch;
  }
});

test('executeProviderJob classifies non-queryable chat checkpoint failure for admin resolution', async () => {
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    if (String(url).includes('/gemini-3.1-pro/v1/chat/completions')) {
      return createJsonResponse({
        id: 'chat-checkpoint-response-id',
        choices: [{ message: { content: 'storyboard planned' } }],
      });
    }
    throw new Error(`unexpected request: ${String(url)}`);
  };

  try {
    await assert.rejects(
      () => executeProviderJob(
        {
          module: 'video',
          subFeature: 'storyboard',
          taskType: 'kie_chat',
          payload: {
            model: 'gemini-3.1-pro-openai',
            messages: [{ role: 'user', content: 'checkpoint this response' }],
          },
        },
        { KIE_API_KEY: 'test-key' },
        new AbortController().signal,
        { onProviderTaskId: async () => { throw new Error('checkpoint unavailable'); } }
      ),
      (error) => error?.code === 'provider_submission_unknown'
        && error?.providerTaskId === 'chat-checkpoint-response-id'
        && error?.providerStage === 'provider_checkpoint'
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test('executeProviderJob sends managed storyboard video directly to Gemini without KIE staging', async () => {
  __testOnly_clearManagedAssetUploadCache();
  const originalFetch = global.fetch;
  const requests = [];
  const sourceVideoUrl = 'http://111.229.66.247/api/assets/file/storyboard/direct.mp4';
  const directVideoUrl = 'https://meiaoyuntai.com/api/assets/file/storyboard/direct.mp4';

  global.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    if (String(url).includes('/gemini-3.1-pro/v1/chat/completions')) {
      return createJsonResponse({
        id: 'storyboard-direct-response',
        choices: [{ message: { content: 'storyboard direct ok' } }],
      });
    }
    throw new Error(`managed storyboard video should not be transferred before Gemini: ${String(url)}`);
  };

  try {
    const result = await executeProviderJob(
      {
        module: 'video',
        subFeature: 'storyboard',
        taskType: 'kie_chat',
        payload: {
          model: 'gemini-3.1-pro-openai',
          messages: [{
            role: 'user',
            content: [
              { type: 'text', text: `读取这个视频 ${sourceVideoUrl}` },
              { type: 'input_file', file_url: sourceVideoUrl, filename: 'direct.mp4' },
            ],
          }],
        },
      },
      {
        KIE_API_KEY: 'test-key',
        MEIAO_PUBLIC_BASE_URL: 'https://meiaoyuntai.com',
        MEIAO_KIE_MANAGED_ASSET_MODE: 'direct-first',
      },
      new AbortController().signal
    );

    assert.equal(result.result.content, 'storyboard direct ok');
    assert.equal(requests.filter((item) => item.url.includes('/file-stream-upload')).length, 0);
    assert.equal(requests.filter((item) => item.url.includes('/api/assets/file/')).length, 0);
    const chatRequest = requests.find((item) => item.url.includes('/gemini-3.1-pro/v1/chat/completions'));
    const chatBodyText = String(chatRequest.init.body);
    assert.match(chatBodyText, new RegExp(directVideoUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.doesNotMatch(chatBodyText, /http:\/\/111\.229\.66\.247/);
  } finally {
    global.fetch = originalFetch;
  }
});

test('executeProviderJob stages managed storyboard video once after explicit Gemini media read failure', async () => {
  __testOnly_clearManagedAssetUploadCache();
  const originalFetch = global.fetch;
  const requests = [];
  const sourceVideoUrl = '/api/assets/file/storyboard/fallback.mp4';
  const directVideoUrl = 'https://meiaoyuntai.com/api/assets/file/storyboard/fallback.mp4';
  const stagedVideoUrl = 'https://tempfileb.aiquickdraw.com/kieai/openrouter-chat/fallback.mp4';

  global.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    if (String(url).includes('/gemini-3.1-pro/v1/chat/completions')) {
      const bodyText = String(init.body);
      if (bodyText.includes(directVideoUrl)) {
        return createJsonResponse({
          choices: [{ message: { content: 'Failed to get the file information' } }],
        });
      }
      assert.match(bodyText, /tempfileb\.aiquickdraw\.com\/kieai\/openrouter-chat\/fallback\.mp4/);
      return createJsonResponse({
        id: 'storyboard-video-fallback-response',
        choices: [{ message: { content: 'storyboard fallback ok' } }],
      });
    }
    if (String(url).includes('/api/assets/file/')) {
      return new Response(Buffer.from('managed-video-bytes'), {
        status: 200,
        headers: { 'content-type': 'video/mp4', 'content-length': '19' },
      });
    }
    if (String(url).includes('/file-stream-upload')) {
      assert.equal(init.body.get('uploadPath'), 'openrouter-chat');
      return createJsonResponse({ code: 200, data: { fileUrl: stagedVideoUrl } });
    }
    throw new Error(`unexpected request: ${String(url)}`);
  };

  try {
    const result = await executeProviderJob(
      {
        module: 'video',
        subFeature: 'storyboard',
        taskType: 'kie_chat',
        payload: {
          model: 'gemini-3.1-pro-openai',
          messages: [{
            role: 'user',
            content: [
              { type: 'text', text: `读取视频 ${sourceVideoUrl}` },
              { type: 'input_file', file_url: sourceVideoUrl, filename: 'fallback.mp4' },
            ],
          }],
        },
      },
      {
        KIE_API_KEY: 'test-key',
        MEIAO_PUBLIC_BASE_URL: 'https://meiaoyuntai.com',
        MEIAO_KIE_MANAGED_ASSET_MODE: 'direct-first',
        MEIAO_KIE_ASSET_UPLOAD_RETRIES: '0',
      },
      new AbortController().signal
    );

    assert.equal(result.result.content, 'storyboard fallback ok');
    assert.equal(result.providerMediaRoute, 'kie-fallback');
    assert.equal(result.result.providerMediaRoute, 'kie-fallback');
    assert.equal(requests.filter((item) => item.url.includes('/gemini-3.1-pro/v1/chat/completions')).length, 2);
    assert.equal(requests.filter((item) => item.url.includes('/file-stream-upload')).length, 1);
  } finally {
    global.fetch = originalFetch;
  }
});

test('executeProviderJob Gemini task id prevents direct media fallback', async () => {
  __testOnly_clearManagedAssetUploadCache();
  const originalFetch = global.fetch;
  const requests = [];

  global.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    if (String(url).includes('/gemini-3-flash')) {
      return createJsonResponse({
        id: 'gemini-task-already-created',
        choices: [{ message: { content: 'Failed to get the file information' } }],
      });
    }
    throw new Error(`unexpected request: ${String(url)}`);
  };

  try {
    await assert.rejects(
      () => executeProviderJob(
        {
          taskType: 'kie_chat',
          payload: {
            model: 'gemini-3-flash-openai',
            messages: [{
              role: 'user',
              content: [{ type: 'image_url', image_url: { url: '/api/assets/file/direct-gemini-task/source.png' } }],
            }],
          },
        },
        {
          KIE_API_KEY: 'test-key',
          MEIAO_PUBLIC_BASE_URL: 'https://meiaoyuntai.com',
          MEIAO_KIE_MANAGED_ASSET_MODE: 'direct-first',
        },
        new AbortController().signal
      ),
      (error) => error?.providerTaskId === 'gemini-task-already-created'
    );

    assert.equal(requests.filter((item) => item.url.includes('/gemini-3-flash')).length, 1);
    assert.equal(requests.filter((item) => item.url.includes('/file-stream-upload')).length, 0);
  } finally {
    global.fetch = originalFetch;
  }
});

test('executeProviderJob treats provider authentication text in successful kie chat responses as a failed request', async () => {
  const originalFetch = global.fetch;

  global.fetch = async () =>
    createJsonResponse({
      choices: [
        {
          message: {
            content: 'Unauthorized – Authentication failed. Please check that your Authorization and Content-Type headers are correctly set.',
          },
        },
      ],
    });

  try {
    await assert.rejects(
      () => executeProviderJob(
        {
          taskType: 'kie_chat',
          payload: {
            model: 'gemini-3-5-flash',
            messages: [{ role: 'user', content: '生成策划' }],
          },
        },
        { KIE_API_KEY: 'test-key' },
        new AbortController().signal
      ),
      (error) => error?.code === 'provider_bad_request'
        && /Authentication failed/i.test(error.message)
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test('executeProviderJob treats provider maintenance text in gemini flash responses as retryable failure', async () => {
  const originalFetch = global.fetch;

  global.fetch = async () =>
    createJsonResponse({
      choices: [
        {
          message: {
            content: 'The server is currently being maintained, please try again later~',
          },
        },
      ],
    });

  try {
    await assert.rejects(
      () => executeProviderJob(
        {
          taskType: 'kie_chat',
          payload: {
            model: 'gemini-3-flash-openai',
            messages: [{ role: 'user', content: '读取视频' }],
          },
        },
        { KIE_API_KEY: 'test-key' },
        new AbortController().signal
      ),
      (error) => error?.code === 'provider_internal_error'
        && /server is currently being maintained/i.test(error.message)
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test('executeProviderJob treats provider server exception text as a provider failure', async () => {
  const originalFetch = global.fetch;

  global.fetch = async () =>
    createJsonResponse({
      choices: [
        {
          message: {
            content: 'Server exception, please try again later',
          },
        },
      ],
    });

  try {
    await assert.rejects(
      () => executeProviderJob(
        {
          taskType: 'kie_chat',
          payload: {
            model: 'gemini-3-flash-openai',
            messages: [{ role: 'user', content: '读取图片' }],
          },
        },
        { KIE_API_KEY: 'test-key' },
        new AbortController().signal
      ),
      (error) => error?.code === 'provider_internal_error'
        && /server exception/i.test(error.message)
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test('executeProviderJob preserves kie chat task id and 504 detail from failed gemini flash responses', async () => {
  const originalFetch = global.fetch;

  global.fetch = async () =>
    createJsonResponse({
      code: 500,
      msg: 'Gemini chat (OpenAI format) responseCode error: 504',
      data: {
        taskId: '4222457f0143802a0a57e5da7e6e1512',
        failCode: '500',
        failMsg: 'Gemini chat (OpenAI format) responseCode error: 504',
      },
    }, 500);

  try {
    await assert.rejects(
      () => executeProviderJob(
        {
          taskType: 'kie_chat',
          payload: {
            model: 'gemini-3-flash-openai',
            messages: [{ role: 'user', content: '读取视频' }],
          },
        },
        { KIE_API_KEY: 'test-key' },
        new AbortController().signal
      ),
      (error) => error?.code === 'provider_internal_error'
        && error?.providerTaskId === '4222457f0143802a0a57e5da7e6e1512'
        && /responseCode error: 504/i.test(error.message)
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test('executeProviderJob ignores echoed input payload when kie responses returns final output text', async () => {
  const originalFetch = global.fetch;

  global.fetch = async () =>
    createJsonResponse({
      id: 'resp_123',
      output: [
        {
          type: 'message',
          role: 'assistant',
          content: [
            { type: 'output_text', text: '工作室测试链路正常' },
          ],
        },
      ],
      input: [
        {
          role: 'system',
          content: [{ type: 'input_text', text: '你是一个智能体配置助手' }],
        },
        {
          role: 'user',
          content: [{ type: 'input_text', text: '请直接回复工作室测试链路正常' }],
        },
      ],
    });

  try {
    const result = await executeProviderJob(
      {
        taskType: 'kie_chat',
        payload: {
          model: 'gpt-5-4-openai-resp',
          messages: [{ role: 'user', content: '请直接回复工作室测试链路正常' }],
        },
      },
      { KIE_API_KEY: 'test-key' },
      new AbortController().signal
    );

    assert.equal(result.result.content, '工作室测试链路正常');
  } finally {
    global.fetch = originalFetch;
  }
});

test('executeProviderJob does not silently fall back to implicit chat models when gpt-5.4 responses returns empty output', async () => {
  const originalFetch = global.fetch;
  let requestCount = 0;

  global.fetch = async () => {
    requestCount += 1;
    return createJsonResponse({
      id: 'resp_empty',
      model: 'gpt-5.4',
      status: 'completed',
      output: [],
    });
  };

  try {
    await assert.rejects(
      () => executeProviderJob(
        {
          taskType: 'kie_chat',
          payload: {
            model: 'gpt-5-4-openai-resp',
            messages: [{ role: 'user', content: '请只回复工作室测试链路正常' }],
          },
        },
        { KIE_API_KEY: 'test-key' },
        new AbortController().signal
      ),
      /返回为空/
    );
    assert.equal(requestCount, 1);
  } finally {
    global.fetch = originalFetch;
  }
});

test('executeProviderJob does not switch models after ambiguous gpt-5.4 HTTP 500', async () => {
  const originalFetch = global.fetch;
  const requests = [];

  global.fetch = async (url, init) => {
    requests.push({ url: String(url), init });
    if (String(url).includes('/codex/v1/responses')) {
      return createJsonResponse({
        id: 'resp_error',
        code: 500,
        msg: 'Server exception, please try again later.',
      }, 500);
    }
    throw new Error(`ambiguous submit must not switch models: ${String(url)}`);
  };

  try {
    await assert.rejects(
      () => executeProviderJob(
        {
          taskType: 'kie_chat',
          payload: {
            model: 'gpt-5-4-openai-resp',
            fallbackModels: ['gemini-3-flash-openai'],
            messages: [{ role: 'user', content: '请只回复 flash fallback result' }],
          },
        },
        { KIE_API_KEY: 'test-key' },
        new AbortController().signal
      ),
      (error) => error?.code === 'provider_internal_error'
        && Number(error?.providerHttpStatus) === 500
    );

    assert.match(requests[0].url, /\/codex\/v1\/responses$/);
    assert.equal(requests.length, 1);
  } finally {
    global.fetch = originalFetch;
  }
});

test('executeProviderJob does not fallback when kie chat managed asset upload times out', async () => {
  const originalFetch = global.fetch;
  const requests = [];

  global.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    if (String(url).includes('/api/assets/file/')) {
      return new Response(Buffer.from([0xff, 0xd8, 0xff, 0xd9]), {
        status: 200,
        headers: { 'Content-Type': 'image/jpeg' },
      });
    }
    if (String(url).includes('/file-stream-upload')) {
      const error = new Error('timeout');
      error.name = 'AbortError';
      throw error;
    }
    throw new Error(`model fallback should not run after asset upload failure: ${String(url)}`);
  };

  try {
    await assert.rejects(
      () => executeProviderJob(
        {
          taskType: 'kie_chat',
          payload: {
            model: 'gpt-5-4-openai-resp',
            fallbackModels: ['gpt-5-2'],
            messages: [
              {
                role: 'user',
                content: [
                  { type: 'text', text: '分析这张图' },
                  { type: 'image_url', image_url: { url: 'http://111.229.66.247/api/assets/file/asset-timeout/source.jpg' } },
                ],
              },
            ],
          },
        },
        { KIE_API_KEY: 'test-key' },
        new AbortController().signal
      ),
      (error) => error?.code === 'provider_timeout' && error?.providerStage === 'asset_upload'
    );

    assert.equal(requests.filter((item) => item.url.includes('/file-stream-upload')).length, 1);
    assert.equal(requests.some((item) => item.url.includes('/v1/chat/completions')), false);
  } finally {
    global.fetch = originalFetch;
  }
});

test('executeProviderJob does not fallback or duplicate upload when kie chat upload returns no fileUrl', async () => {
  __testOnly_clearManagedAssetUploadCache();
  __testOnly_resetKieAssetUploadLimiters();
  const originalFetch = global.fetch;
  const requests = [];

  global.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    if (String(url).includes('/api/assets/file/')) {
      return new Response(Buffer.from([0xff, 0xd8, 0xff, 0xd9]), {
        status: 200,
        headers: { 'Content-Type': 'image/jpeg' },
      });
    }
    if (String(url).includes('/file-stream-upload')) {
      return createJsonResponse({ code: 200, data: {} });
    }
    throw new Error(`model fallback should not run after asset upload failure: ${String(url)}`);
  };

  try {
    const error = await executeProviderJob(
      {
        taskType: 'kie_chat',
        payload: {
          model: 'gpt-5-4-openai-resp',
          fallbackModels: ['doubao-seed-1-6-flash'],
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: '分析这张图' },
                { type: 'image_url', image_url: { url: '/api/assets/file/asset-missing-upload-url/source.jpg' } },
              ],
            },
          ],
        },
      },
      {
        KIE_API_KEY: 'test-key',
        MEIAO_KIE_ASSET_UPLOAD_RETRIES: '0',
      },
      new AbortController().signal
    ).then(() => null, (caught) => caught);

    assert.equal(requests.filter((item) => item.url.includes('/file-stream-upload')).length, 1);
    assert.equal(requests.some((item) => item.url.includes('/codex/v1/responses')), false);
    assert.equal(requests.some((item) => item.url.includes('/v1/chat/completions')), false);
    assert.equal(error?.code, 'provider_bad_response');
    assert.equal(error?.providerStage, 'asset_upload');
    assert.equal(error?.providerStatus, 'bad_response');
  } finally {
    global.fetch = originalFetch;
    __testOnly_resetKieAssetUploadLimiters();
    __testOnly_clearManagedAssetUploadCache();
  }
});

test('executeProviderJob reuses uploaded managed asset urls across kie chat fallback models', async () => {
  const originalFetch = global.fetch;
  const requests = [];
  let uploadCount = 0;

  global.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    if (String(url).includes('/api/assets/file/')) {
      return new Response(Buffer.from([0xff, 0xd8, 0xff, 0xd9]), {
        status: 200,
        headers: { 'Content-Type': 'image/jpeg' },
      });
    }
    if (String(url).includes('/file-stream-upload')) {
      uploadCount += 1;
      return createJsonResponse({
        code: 200,
        data: { fileUrl: `https://tempfile.redpandaai.co/kieai/30590/mayo-storage/internal/uploaded-${uploadCount}.jpg` },
      });
    }
    if (String(url).includes('/codex/v1/responses')) {
      return createJsonResponse({ output_text: 'Server exception, please try again later.' });
    }
    if (String(url).includes('/v1/chat/completions')) {
      return createJsonResponse({
        choices: [{ message: { content: 'fallback result' } }],
      });
    }
    throw new Error(`unexpected request: ${String(url)}`);
  };

  try {
    const result = await executeProviderJob(
      {
        taskType: 'kie_chat',
        payload: {
          model: 'gpt-5-4-openai-resp',
          fallbackModels: ['gpt-5-2'],
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: '分析这张图' },
                { type: 'image_url', image_url: { url: 'http://111.229.66.247/api/assets/file/asset-shared/source.jpg' } },
              ],
            },
          ],
        },
      },
      { KIE_API_KEY: 'test-key' },
      new AbortController().signal
    );

    assert.equal(result.result.content, 'fallback result');
    assert.equal(uploadCount, 1);
    const fallbackRequest = requests.find((item) => item.url.includes('/v1/chat/completions'));
    const fallbackBody = JSON.parse(String(fallbackRequest.init.body));
    assert.equal(
      fallbackBody.messages[0].content[1].image_url.url,
      'https://tempfile.redpandaai.co/kieai/30590/mayo-storage/internal/uploaded-1.jpg'
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test('executeProviderJob routes gemini 3 flash through the new openai chat completions contract', async () => {
  const originalFetch = global.fetch;
  const requests = [];

  global.fetch = async (url, init) => {
    requests.push({ url: String(url), init });
    return createJsonResponse({
      choices: [
        {
          message: {
            content: 'gemini 3 flash result',
          },
        },
      ],
    });
  };

  try {
    const result = await executeProviderJob(
      {
        taskType: 'kie_chat',
        payload: {
          model: 'gemini-3-flash-openai',
          reasoningLevel: 'low',
          webSearchEnabled: true,
          tools: [
            {
              name: 'get_current_weather',
              description: 'Get current weather',
              input_schema: {
                type: 'object',
                properties: { location: { type: 'string' } },
                required: ['location'],
              },
            },
          ],
          messages: [
            { role: 'system', content: '你是助手' },
            {
              role: 'user',
              content: [
                { type: 'text', text: '请简要总结' },
                { type: 'image_url', image_url: { url: 'https://example.com/a.png' } },
                { type: 'input_file', file_url: 'https://example.com/a.pdf', filename: 'a.pdf' },
              ],
            },
          ],
        },
      },
      { KIE_API_KEY: 'test-key' },
      new AbortController().signal
    );

    assert.equal(result.result.content, 'gemini 3 flash result');
    assert.match(requests[0].url, /\/gemini-3-flash\/v1\/chat\/completions$/);
    const body = JSON.parse(String(requests[0].init.body));
    assert.equal(body.model, undefined);
    assert.equal(body.messages[0].role, 'system');
    assert.deepEqual(body.messages[0].content, [{ type: 'text', text: '你是助手' }]);
    assert.equal(body.messages[1].content[1].type, 'image_url');
    assert.equal(body.messages[1].content[1].image_url.url, 'https://example.com/a.png');
    assert.equal(body.messages[1].content[2].type, 'image_url');
    assert.equal(body.messages[1].content[2].image_url.url, 'https://example.com/a.pdf');
    assert.equal(body.include_thoughts, true);
    assert.equal(body.reasoning_effort, 'low');
    assert.equal(body.tools[0].type, 'function');
    assert.equal(body.tools[0].function.name, 'googleSearch');
    assert.equal(body.tools[1].type, 'function');
    assert.equal(body.tools[1].function.name, 'get_current_weather');
    assert.equal(body.stream, true);
  } finally {
    global.fetch = originalFetch;
  }
});

test('executeProviderJob applies the KIE chat completion timeout to gemini 3 flash requests', async () => {
  const originalFetch = global.fetch;
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  let sawChatCompletionTimeout = false;

  global.fetch = async () =>
    createJsonResponse({
      choices: [
        {
          message: {
            content: 'gemini timeout guarded result',
          },
        },
      ],
  });
  global.setTimeout = (handler, ms) => {
    if (ms === 240_000) sawChatCompletionTimeout = true;
    return originalSetTimeout(handler, ms);
  };
  global.clearTimeout = (timer) => originalClearTimeout(timer);

  try {
    const result = await executeProviderJob(
      {
        taskType: 'kie_chat',
        payload: {
          model: 'gemini-3-flash-openai',
          messages: [{ role: 'user', content: '请只回复 timeout guarded result' }],
        },
      },
      { KIE_API_KEY: 'test-key' },
      new AbortController().signal
    );

    assert.equal(result.result.content, 'gemini timeout guarded result');
    assert.equal(sawChatCompletionTimeout, true);
  } finally {
    global.fetch = originalFetch;
    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
  }
});

test('executeProviderJob does not switch models after ambiguous gemini transport failure', async () => {
  const originalFetch = global.fetch;
  const requests = [];

  global.fetch = async (url, init) => {
    requests.push({ url: String(url), init });
    if (String(url).includes('/gemini-3-flash/v1/chat/completions')) {
      throw new TypeError('fetch failed');
    }
    throw new Error(`ambiguous submit must not switch models: ${String(url)}`);
  };

  try {
    await assert.rejects(
      () => executeProviderJob(
        {
          taskType: 'kie_chat',
          payload: {
            model: 'gemini-3-flash-openai',
            fallbackModels: ['gpt-5-2'],
            messages: [{ role: 'user', content: '请只回复 fallback result' }],
          },
        },
        { KIE_API_KEY: 'test-key' },
        new AbortController().signal
      ),
      (error) => error?.code === 'provider_submission_unknown'
    );

    assert.match(requests[0].url, /\/gemini-3-flash\/v1\/chat\/completions$/);
    assert.equal(requests.length, 1);
  } finally {
    global.fetch = originalFetch;
  }
});

test('executeProviderJob stops the fallback chain after any unsafe fallback-model failure', async () => {
  const originalFetch = global.fetch;
  const scenarios = [
    {
      name: 'submission unknown',
      respond: async () => {
        throw new TypeError('fetch failed after fallback submit');
      },
      matches: (error) => error?.code === 'provider_submission_unknown',
    },
    {
      name: 'ambiguous HTTP 500',
      respond: async () => createJsonResponse({ message: 'upstream failed after accepting request' }, 500),
      matches: (error) => error?.code === 'provider_internal_error'
        && Number(error?.providerHttpStatus) === 500,
    },
    {
      name: 'provider task id received',
      respond: async () => createJsonResponse({
        id: 'fallback-provider-task-id',
        choices: [{ message: { content: 'Server exception, please try again later.' } }],
      }),
      matches: (error) => error?.providerTaskId === 'fallback-provider-task-id',
    },
  ];

  try {
    for (const scenario of scenarios) {
      const requests = [];
      global.fetch = async (url, init = {}) => {
        requests.push({ url: String(url), init });
        if (String(url).includes('/codex/v1/responses')) {
          return createJsonResponse({ output_text: 'Server exception, please try again later.' });
        }
        if (String(url).includes('/gemini-3-flash/v1/chat/completions')) {
          return scenario.respond();
        }
        if (String(url).includes('/v1/chat/completions')) {
          return createJsonResponse({ choices: [{ message: { content: 'must not submit another fallback' } }] });
        }
        throw new Error(`unexpected request: ${String(url)}`);
      };

      await assert.rejects(
        () => executeProviderJob(
          {
            taskType: 'kie_chat',
            payload: {
              model: 'gpt-5-4-openai-resp',
              fallbackModels: ['gemini-3-flash-openai', 'gpt-5-2'],
              messages: [{ role: 'user', content: 'test fallback safety' }],
            },
          },
          { KIE_API_KEY: 'test-key' },
          new AbortController().signal
        ),
        scenario.matches,
        scenario.name
      );
      assert.equal(requests.length, 2, scenario.name);
    }
  } finally {
    global.fetch = originalFetch;
  }
});

test('executeProviderJob keeps video storyboard fallback within default Gemini models', async () => {
  const originalFetch = global.fetch;
  const requests = [];

  global.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    if (String(url).includes('/gemini-3.1-pro/v1/chat/completions')) {
      return createJsonResponse({
        choices: [{ message: { content: 'Server exception, please try again later.' } }],
      });
    }
    if (String(url).includes('/gemini/v1/models/gemini-3-5-flash:streamGenerateContent')) {
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'text/event-stream' }),
        body: new ReadableStream({
          start(controller) {
            const encoder = new TextEncoder();
            controller.enqueue(encoder.encode('data: {"candidates":[{"content":{"parts":[{"text":"gemini storyboard fallback"}]}}]}\n\n'));
            controller.enqueue(encoder.encode('data: [DONE]\n\n'));
            controller.close();
          },
        }),
        json: async () => ({}),
      };
    }
    throw new Error(`non-Gemini fallback must not run for video storyboard jobs: ${String(url)}`);
  };

  try {
    const result = await executeProviderJob(
      {
        module: 'video',
        subFeature: 'storyboard',
        taskType: 'kie_chat',
        payload: {
          model: 'gemini-3.1-pro-openai',
          fallbackModels: ['gpt-5-2', 'gpt-5-4-openai-resp'],
          messages: [{ role: 'user', content: '请生成短视频分镜脚本' }],
        },
      },
      { KIE_API_KEY: 'test-key' },
      new AbortController().signal
    );

    assert.equal(result.result.content, 'gemini storyboard fallback');
    assert.equal(result.result.modelUsed, 'gemini-3-5-flash');
    assert.equal(requests.length, 2);
    assert.equal(requests.some((item) => item.url.includes('/gpt-5-2/')), false);
    assert.equal(requests.some((item) => item.url.includes('/codex/v1/responses')), false);
  } finally {
    global.fetch = originalFetch;
  }
});

test('executeProviderJob fails gemini image upload without base64 fallback', async () => {
  const originalFetch = global.fetch;
  const requests = [];

  global.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    if (String(url).includes('/api/file-stream-upload')) {
      throw new TypeError('fetch failed');
    }
    return createJsonResponse({
      choices: [
        {
          message: {
            content: 'should not call gemini after upload failure',
          },
        },
      ],
    });
  };

  try {
    await assert.rejects(
      () => executeProviderJob(
        {
          taskType: 'kie_chat',
          payload: {
            model: 'gemini-3-flash-openai',
            messages: [
              {
                role: 'user',
                content: [
                  { type: 'text', text: '分析图片' },
                  { type: 'image_url', image_url: { url: 'data:image/png;base64,aGVsbG8=' } },
                ],
              },
            ],
          },
        },
        { KIE_API_KEY: 'test-key', MEIAO_KIE_ASSET_UPLOAD_RETRIES: '0' },
        new AbortController().signal
      ),
      /fetch failed/
    );

    assert.match(requests[0].url, /\/api\/file-stream-upload$/);
    assert.equal(requests.some((item) => String(item.url).includes('/api/file-base64-upload')), false);
    assert.equal(requests.some((item) => String(item.url).includes('/gemini-3-flash/v1/chat/completions')), false);
  } finally {
    global.fetch = originalFetch;
  }
});

test('executeProviderJob does not switch models when gemini 3 flash stream stalls after submission', async () => {
  const originalFetch = global.fetch;
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  const requests = [];
  let sawStreamTimeout = false;

  global.fetch = async (url, init) => {
    requests.push({ url: String(url), init });
    if (String(url).includes('/gemini-3-flash/v1/chat/completions')) {
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'text/event-stream' }),
        body: new ReadableStream({
          start() {},
        }),
        json: async () => ({}),
      };
    }
    throw new Error(`ambiguous stalled submit must not switch models: ${String(url)}`);
  };
  global.setTimeout = (handler, ms) => {
    if (ms === 120_000) {
      sawStreamTimeout = true;
      handler();
      return 0;
    }
    return originalSetTimeout(handler, ms);
  };
  global.clearTimeout = (timer) => {
    if (timer) originalClearTimeout(timer);
  };

  try {
    await assert.rejects(
      () => executeProviderJob(
        {
          taskType: 'kie_chat',
          payload: {
            model: 'gemini-3-flash-openai',
            fallbackModels: ['gpt-5-2'],
            messages: [{ role: 'user', content: '请只回复 stalled fallback' }],
          },
        },
        { KIE_API_KEY: 'test-key' },
        new AbortController().signal
      ),
      (error) => error?.code === 'provider_timeout'
    );

    assert.equal(sawStreamTimeout, true);
    assert.equal(requests.length, 1);
  } finally {
    global.fetch = originalFetch;
    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
  }
});

test('executeProviderJob preserves provider task id from successful kie gemini chat responses', async () => {
  const originalFetch = global.fetch;
  const seenProviderTaskIds = [];

  global.fetch = async () =>
    createJsonResponse({
      data: {
        taskId: '9d8caba0dc63f6167a7d2a6084b5a44d',
        choices: [
          {
            message: {
              content: 'gemini retry success result',
            },
          },
        ],
      },
    });

  try {
    const result = await executeProviderJob(
      {
        taskType: 'kie_chat',
        payload: {
          model: 'gemini-3-flash-openai',
          messages: [{ role: 'user', content: '读取视频' }],
        },
      },
      { KIE_API_KEY: 'test-key' },
      new AbortController().signal,
      { onProviderTaskId: async (taskId) => seenProviderTaskIds.push(taskId) }
    );

    assert.equal(result.result.content, 'gemini retry success result');
    assert.equal(result.providerTaskId, '9d8caba0dc63f6167a7d2a6084b5a44d');
    assert.deepEqual(seenProviderTaskIds, ['9d8caba0dc63f6167a7d2a6084b5a44d']);
  } finally {
    global.fetch = originalFetch;
  }
});

test('executeProviderJob surfaces kie gemini stream task id before completion', async () => {
  const originalFetch = global.fetch;
  const seenProviderTaskIds = [];
  const encoder = new TextEncoder();

  global.fetch = async () => ({
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': 'text/event-stream' }),
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"data":{"taskId":"gemini-stream-task-1"},"choices":[{"delta":{"content":"策划"}}]}\n\n'));
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"完成"}}],"data":{"creditsConsumed":0.09}}\n\n'));
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      },
    }),
    json: async () => ({}),
  });

  try {
    const result = await executeProviderJob(
      {
        taskType: 'kie_chat',
        payload: {
          model: 'gemini-3-flash-openai',
          messages: [{ role: 'user', content: '生成策划' }],
        },
      },
      { KIE_API_KEY: 'test-key' },
      new AbortController().signal,
      { onProviderTaskId: async (taskId) => seenProviderTaskIds.push(taskId) }
    );

    assert.equal(result.result.content, '策划完成');
    assert.equal(result.providerTaskId, 'gemini-stream-task-1');
    assert.equal(result.creditsConsumed, 0.09);
    assert.deepEqual(seenProviderTaskIds, ['gemini-stream-task-1']);
  } finally {
    global.fetch = originalFetch;
  }
});

test('executeProviderJob rejects kie gemini refusal text instead of treating it as a successful plan', async () => {
  const originalFetch = global.fetch;
  const encoder = new TextEncoder();

  global.fetch = async () => ({
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': 'text/event-stream' }),
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"I cannot fulfill this request."}}]}\n\n'));
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      },
    }),
    json: async () => ({}),
  });

  try {
    await assert.rejects(
      () => executeProviderJob(
        {
          taskType: 'kie_chat',
          payload: {
            model: 'gemini-3-flash-openai',
            messages: [{ role: 'user', content: '生成策划' }],
          },
        },
        { KIE_API_KEY: 'test-key' },
        new AbortController().signal
      ),
      (error) => error?.code === 'provider_refusal' && /cannot fulfill/i.test(error.message)
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test('executeProviderJob prefers real kie gemini task id over chat completion ids', async () => {
  const originalFetch = global.fetch;

  global.fetch = async () =>
    createJsonResponse({
      id: 'chatcmpl-98d625595eb54200a217073726b60dcb',
      data: {
        id: 'cc9ef05fdad4ea2ef16c12dec73cb3a4',
        choices: [
          {
            message: {
              content: 'gemini result with dashboard task id',
            },
          },
        ],
      },
    });

  try {
    const result = await executeProviderJob(
      {
        taskType: 'kie_chat',
        payload: {
          model: 'gemini-3-flash-openai',
          messages: [{ role: 'user', content: '生成策划' }],
        },
      },
      { KIE_API_KEY: 'test-key' },
      new AbortController().signal
    );

    assert.equal(result.result.content, 'gemini result with dashboard task id');
    assert.equal(result.providerTaskId, 'cc9ef05fdad4ea2ef16c12dec73cb3a4');
  } finally {
    global.fetch = originalFetch;
  }
});

test('executeProviderJob uploads managed asset images before gemini planning', async () => {
  __testOnly_clearManagedAssetUploadCache();
  const originalFetch = global.fetch;
  const requests = [];
  const cloudAssetUrl = 'http://111.229.66.247/api/assets/file/img-1/source.png';
  const stagedAssetUrl = 'https://tempfile.redpandaai.co/kieai/30590/mayo-storage/internal/source.png';

  global.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    if (String(url).includes('/api/assets/file/')) {
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'image/png' }),
        arrayBuffer: async () => new TextEncoder().encode('png-binary').buffer,
        json: async () => ({}),
      };
    }
    if (String(url).includes('/file-stream-upload')) {
      return createJsonResponse({
        code: 200,
        data: { fileUrl: stagedAssetUrl },
      });
    }
    if (!String(url).includes('/gemini-3-flash')) {
      throw new Error(`unexpected request: ${String(url)}`);
    }
    return createJsonResponse({
      data: {
        id: 'gemini-dashboard-task-id',
        choices: [{ message: { content: 'gemini result' } }],
      },
    });
  };

  try {
    const result = await executeProviderJob(
      {
        taskType: 'kie_chat',
        payload: {
          model: 'gemini-3-flash-openai',
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: '分析这张图' },
                { type: 'image_url', image_url: { url: cloudAssetUrl } },
              ],
            },
          ],
        },
      },
      { KIE_API_KEY: 'test-key', MEIAO_PUBLIC_BASE_URL: 'http://111.229.66.247' },
      new AbortController().signal
    );

    assert.equal(result.result.content, 'gemini result');
    assert.equal(requests.filter((item) => item.url.includes('/api/assets/file/')).length, 1);
    assert.equal(requests.filter((item) => item.url.includes('/file-stream-upload')).length, 1);
    const geminiRequest = requests.find((item) => item.url.includes('/gemini-3-flash'));
    assert.ok(geminiRequest);
    const body = JSON.parse(String(geminiRequest.init.body));
    assert.equal(body.messages[0].content[1].image_url.url, stagedAssetUrl);
  } finally {
    global.fetch = originalFetch;
  }
});

test('executeProviderJob routes claude sonnet 4.6 through kie claude messages with image and file content blocks', async () => {
  const originalFetch = global.fetch;
  const requests = [];

  global.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    if (String(url).includes('/api/assets/file/')) {
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/pdf' }),
        arrayBuffer: async () => new TextEncoder().encode('pdf-binary').buffer,
        json: async () => ({}),
      };
    }
    if (String(url).includes('/file-stream-upload')) {
      return createJsonResponse({
        code: 200,
        data: { fileUrl: 'https://kie.example.com/uploaded-source.pdf' },
      });
    }
    return createJsonResponse({
      role: 'assistant',
      content: [{ type: 'text', text: 'claude result' }],
      model: 'claude-sonnet-4-6',
    });
  };

  try {
    const result = await executeProviderJob(
      {
        taskType: 'kie_chat',
        payload: {
          model: 'claude-sonnet-4-6',
          reasoningLevel: 'low',
          webSearchEnabled: true,
          messages: [
            { role: 'system', content: '你是助手' },
            {
              role: 'user',
              content: [
                { type: 'text', text: '分析图片和文件' },
                { type: 'image_url', image_url: { url: 'https://example.com/a.png' } },
                { type: 'input_file', file_url: '/api/assets/file/source.pdf', filename: 'source.pdf' },
              ],
            },
          ],
        },
      },
      { KIE_API_KEY: 'test-key' },
      new AbortController().signal
    );

    assert.equal(result.result.content, 'claude result');
    const claudeRequest = requests.find((item) => item.url.includes('/claude/v1/messages'));
    assert.ok(claudeRequest);
    const body = JSON.parse(String(claudeRequest.init.body));
    assert.equal(body.model, 'claude-sonnet-4-6');
    assert.equal(body.stream, false);
    assert.equal(body.max_tokens, 4096);
    assert.equal(body.thinkingFlag, true);
    assert.deepEqual(body.tools, []);
    assert.deepEqual(body.tool_choice, { type: 'none' });
    assert.deepEqual(body.mcp_servers, []);
    assert.equal(body.messages[0].role, 'user');
    assert.match(body.messages[0].content[0].text, /禁止调用任何工具/);
    assert.equal(body.messages[0].content[1].text, '你是助手');
    assert.equal(body.messages[1].content[1].type, 'image');
    assert.equal(body.messages[1].content[1].source.url, 'https://example.com/a.png');
    assert.equal(body.messages[1].content[2].type, 'document');
    assert.equal(body.messages[1].content[2].source.url, 'https://kie.example.com/uploaded-source.pdf');
    assert.equal(body.messages[1].content[2].title, 'source.pdf');
  } finally {
    global.fetch = originalFetch;
  }
});

test('executeProviderJob rejects disguised upstream errors from kie claude messages', async () => {
  const originalFetch = global.fetch;

  global.fetch = async () => createJsonResponse({
    role: 'assistant',
    content: [{ type: 'text', text: 'Interal error: HTTP 500' }],
    model: 'claude-sonnet-4-6',
  });

  try {
    await assert.rejects(
      () => executeProviderJob(
        {
          taskType: 'kie_chat',
          payload: {
            model: 'claude-sonnet-4-6',
            messages: [{ role: 'user', content: '请输出一套主图策划' }],
          },
        },
        { KIE_API_KEY: 'test-key' },
        new AbortController().signal
      ),
      (error) => error?.code === 'provider_internal_error'
        && /Interal error: HTTP 500/.test(error.message)
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test('executeProviderJob normalizes claude sonnet v1messages alias before sending multimodal requests', async () => {
  const originalFetch = global.fetch;
  const requests = [];

  global.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    return createJsonResponse({
      role: 'assistant',
      content: [{ type: 'text', text: 'claude alias result' }],
      model: 'claude-sonnet-4-6',
    });
  };

  try {
    const result = await executeProviderJob(
      {
        taskType: 'kie_chat',
        payload: {
          model: 'claude-sonnet-4-6-v1messages',
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: '分析参考图' },
                { type: 'image_url', image_url: { url: 'https://example.com/reference.png' } },
              ],
            },
          ],
        },
      },
      { KIE_API_KEY: 'test-key' },
      new AbortController().signal
    );

    assert.equal(result.result.content, 'claude alias result');
    const claudeRequest = requests.find((item) => item.url.includes('/claude/v1/messages'));
    assert.ok(claudeRequest);
    const body = JSON.parse(String(claudeRequest.init.body));
    assert.equal(body.model, 'claude-sonnet-4-6');
    assert.deepEqual(body.tools, []);
    assert.deepEqual(body.tool_choice, { type: 'none' });
    assert.match(body.messages[0].content[0].text, /禁止调用任何工具/);
    assert.equal(body.messages[0].content[2].type, 'image');
    assert.equal(body.messages[0].content[2].source.url, 'https://example.com/reference.png');
  } finally {
    global.fetch = originalFetch;
  }
});

test('executeProviderJob preserves claude-native image blocks and rejects tool_use-only responses', async () => {
  const originalFetch = global.fetch;
  const requests = [];

  global.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    return createJsonResponse({
      role: 'assistant',
      stop_reason: 'tool_use',
      model: 'claude-sonnet-4-6',
      content: [
        {
          type: 'tool_use',
          id: 'toolu_test',
          name: 'view',
          input: { path: '/mnt/skills/public/frontend-design/SKILL.md' },
        },
      ],
    });
  };

  try {
    await assert.rejects(
      () => executeProviderJob(
        {
          taskType: 'kie_chat',
          payload: {
            model: 'claude-sonnet-4-6-v1messages',
            messages: [
              {
                role: 'user',
                content: [
                  { type: 'text', text: '请直接输出文本策划' },
                  { type: 'image', source: { type: 'url', url: 'https://example.com/native-reference.png' } },
                ],
              },
            ],
          },
        },
        { KIE_API_KEY: 'test-key' },
        new AbortController().signal
      ),
      /工具调用而不是文本策划结果/
    );

    const claudeRequest = requests.find((item) => item.url.includes('/claude/v1/messages'));
    assert.ok(claudeRequest);
    const body = JSON.parse(String(claudeRequest.init.body));
    assert.match(body.messages[0].content[0].text, /禁止调用任何工具/);
    assert.equal(body.messages[0].content[2].type, 'image');
    assert.equal(body.messages[0].content[2].source.url, 'https://example.com/native-reference.png');
    assert.deepEqual(body.tools, []);
    assert.deepEqual(body.tool_choice, { type: 'none' });
  } finally {
    global.fetch = originalFetch;
  }
});

test('executeProviderJob gives claude planning requests the chat completion timeout budget', async () => {
  const originalFetch = global.fetch;
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  let sawBaseHttpTimeout = false;
  let sawChatCompletionTimeout = false;

  global.fetch = async () =>
    createJsonResponse({
      role: 'assistant',
      content: [{ type: 'text', text: 'claude timeout budget result' }],
      model: 'claude-sonnet-4-6',
    });
  global.setTimeout = (handler, ms) => {
    if (ms === 60_000) sawBaseHttpTimeout = true;
    if (ms === 240_000) sawChatCompletionTimeout = true;
    return originalSetTimeout(handler, ms);
  };
  global.clearTimeout = (timer) => originalClearTimeout(timer);

  try {
    const result = await executeProviderJob(
      {
        taskType: 'kie_chat',
        payload: {
          model: 'claude-sonnet-4-6',
          messages: [{ role: 'user', content: '请输出一套主图策划' }],
        },
      },
      { KIE_API_KEY: 'test-key' },
      new AbortController().signal
    );

    assert.equal(result.result.content, 'claude timeout budget result');
    assert.equal(sawChatCompletionTimeout, true);
    assert.equal(sawBaseHttpTimeout, false);
  } finally {
    global.fetch = originalFetch;
    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
  }
});

test('executeProviderJob retries claude once when hidden tool_use is returned for a text planning request', async () => {
  const originalFetch = global.fetch;
  const requests = [];
  let callCount = 0;

  global.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    callCount += 1;
    if (callCount === 1) {
      return createJsonResponse({
        role: 'assistant',
        stop_reason: 'tool_use',
        model: 'claude-sonnet-4-6',
        content: [
          {
            type: 'tool_use',
            id: 'toolu_hidden_skill',
            name: 'view',
            input: { path: '/mnt/skills/public/frontend-design/SKILL.md' },
          },
        ],
      });
    }
    return createJsonResponse({
      role: 'assistant',
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: '[SCHEME_START]\n- 画面比例：1:1\n[SCHEME_END]' }],
      model: 'claude-sonnet-4-6',
    });
  };

  try {
    const result = await executeProviderJob(
      {
        taskType: 'kie_chat',
        payload: {
          model: 'claude-sonnet-4-6-v1messages',
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: '请基于图片输出主图策划' },
                { type: 'image', source: { type: 'url', url: 'https://example.com/product.png' } },
              ],
            },
          ],
        },
      },
      { KIE_API_KEY: 'test-key' },
      new AbortController().signal
    );

    assert.equal(result.result.content, '[SCHEME_START]\n- 画面比例：1:1\n[SCHEME_END]');
    assert.equal(requests.length, 2);
    const firstBody = JSON.parse(String(requests[0].init.body));
    const retryBody = JSON.parse(String(requests[1].init.body));
    assert.match(firstBody.messages[0].content[0].text, /禁止调用任何工具/);
    assert.equal(retryBody.messages[0].content[2].type, 'image');
    assert.match(retryBody.messages.at(-1).content[0].text, /禁止调用任何工具/);
    assert.deepEqual(retryBody.tool_choice, { type: 'none' });
  } finally {
    global.fetch = originalFetch;
  }
});

test('executeProviderJob falls back to a minimal claude request when tool_choice is rejected', async () => {
  const originalFetch = global.fetch;
  const requests = [];
  let callCount = 0;

  global.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    callCount += 1;
    if (callCount === 1) {
      return {
        ok: false,
        status: 400,
        json: async () => ({ message: 'invalid tool_choice' }),
      };
    }
    return createJsonResponse({
      role: 'assistant',
      content: [{ type: 'text', text: 'fallback claude result' }],
      model: 'claude-sonnet-4-6',
    });
  };

  try {
    const result = await executeProviderJob(
      {
        taskType: 'kie_chat',
        payload: {
          model: 'claude-sonnet-4-6',
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: '分析图片' },
                { type: 'image_url', image_url: { url: 'https://example.com/fallback.png' } },
              ],
            },
          ],
        },
      },
      { KIE_API_KEY: 'test-key' },
      new AbortController().signal
    );

    assert.equal(result.result.content, 'fallback claude result');
    assert.equal(requests.length, 2);
    const firstBody = JSON.parse(String(requests[0].init.body));
    const secondBody = JSON.parse(String(requests[1].init.body));
    assert.deepEqual(firstBody.tool_choice, { type: 'none' });
    assert.equal(secondBody.tool_choice, undefined);
    assert.deepEqual(secondBody.tools, []);
  } finally {
    global.fetch = originalFetch;
  }
});

// ── Kie HTTP 请求级瞬时重试(S2 Task G1) ──────────────────────────────

test('只读 GET 请求遇 fetch failed 时按预算重试后成功', async () => {
  const realFetch = globalThis.fetch;
  const realRetryBase = process.env.MEIAO_KIE_HTTP_RETRY_BASE_MS;
  process.env.MEIAO_KIE_HTTP_RETRY_BASE_MS = '1';
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls < 3) throw new TypeError('fetch failed');
    return createJsonResponse({ ok: true });
  };
  try {
    const response = await __testOnly_fetchKieWithTimeout('https://api.kie.ai/api/v1/jobs/recordInfo?taskId=t1', {
      method: 'GET',
    }, 'Kie 查询超时', 5000, 'polling');
    assert.equal(response.status, 200);
    assert.equal(calls, 3);
  } finally {
    globalThis.fetch = realFetch;
    if (realRetryBase === undefined) delete process.env.MEIAO_KIE_HTTP_RETRY_BASE_MS;
    else process.env.MEIAO_KIE_HTTP_RETRY_BASE_MS = realRetryBase;
  }
});

test('只读 GET 请求遇 503 时按预算重试，重试耗尽返回最后一次响应', async () => {
  const realFetch = globalThis.fetch;
  const realRetryBase = process.env.MEIAO_KIE_HTTP_RETRY_BASE_MS;
  process.env.MEIAO_KIE_HTTP_RETRY_BASE_MS = '1';
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return createJsonResponse({ msg: 'cpu overloaded' }, 503);
  };
  try {
    const response = await __testOnly_fetchKieWithTimeout('https://api.kie.ai/api/v1/jobs/recordInfo?taskId=t1', {
      method: 'GET',
    }, 'Kie 查询超时', 5000, 'polling');
    assert.equal(response.status, 503);
    assert.equal(calls, 3); // 默认预算 2 次重试 = 共 3 次
  } finally {
    globalThis.fetch = realFetch;
    if (realRetryBase === undefined) delete process.env.MEIAO_KIE_HTTP_RETRY_BASE_MS;
    else process.env.MEIAO_KIE_HTTP_RETRY_BASE_MS = realRetryBase;
  }
});

test('只读 GET 请求 502 一次后恢复即返回成功响应', async () => {
  const realFetch = globalThis.fetch;
  const realRetryBase = process.env.MEIAO_KIE_HTTP_RETRY_BASE_MS;
  process.env.MEIAO_KIE_HTTP_RETRY_BASE_MS = '1';
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) return createJsonResponse({ msg: 'bad gateway' }, 502);
    return createJsonResponse({ ok: true });
  };
  try {
    const response = await __testOnly_fetchKieWithTimeout('https://api.kie.ai/file/x.png', { method: 'GET' }, '下载超时', 5000, 'asset_download');
    assert.equal(response.status, 200);
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = realFetch;
    if (realRetryBase === undefined) delete process.env.MEIAO_KIE_HTTP_RETRY_BASE_MS;
    else process.env.MEIAO_KIE_HTTP_RETRY_BASE_MS = realRetryBase;
  }
});

test('提交类 POST 收到 502 响应绝不重试（防重复扣费）', async () => {
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return createJsonResponse({ msg: 'bad gateway' }, 502);
  };
  try {
    const response = await __testOnly_fetchKieWithTimeout('https://api.kie.ai/api/v1/jobs/createTask', {
      method: 'POST',
      body: JSON.stringify({ model: 'x' }),
    }, 'Kie 创建超时', 5000, 'create_task');
    assert.equal(response.status, 502);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('提交类 POST 连接层错误标记未知且绝不自动重发', async () => {
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    throw new TypeError('fetch failed');
  };
  try {
    await assert.rejects(
      () => __testOnly_fetchKieWithTimeout('https://api.kie.ai/api/v1/jobs/createTask', {
        method: 'POST',
        body: JSON.stringify({ model: 'x' }),
      }, 'Kie 创建超时', 5000, 'create_task'),
      (error) => error?.code === 'provider_submission_unknown'
        && error?.providerStage === 'create_task'
    );
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('显式幂等 POST 连接层错误仍可按传输预算恢复', async () => {
  const realFetch = globalThis.fetch;
  const realRetryBase = process.env.MEIAO_KIE_HTTP_RETRY_BASE_MS;
  process.env.MEIAO_KIE_HTTP_RETRY_BASE_MS = '1';
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls < 3) throw new TypeError('fetch failed');
    return createJsonResponse({ code: 200, data: { fileUrl: 'https://kie.test/uploaded.png' } });
  };
  try {
    const response = await __testOnly_fetchKieWithTimeout('https://kie.ai/api/file-stream-upload', {
        method: 'POST',
        body: '{}',
      }, 'Kie 上传超时', 5000, 'asset_upload', { idempotent: true });
    assert.equal(response.status, 200);
    assert.equal(calls, 3);
  } finally {
    globalThis.fetch = realFetch;
    if (realRetryBase === undefined) delete process.env.MEIAO_KIE_HTTP_RETRY_BASE_MS;
    else process.env.MEIAO_KIE_HTTP_RETRY_BASE_MS = realRetryBase;
  }
});

test('MEIAO_KIE_HTTP_TRANSIENT_RETRIES=0 时不做任何请求级重试', async () => {
  const realFetch = globalThis.fetch;
  const realRetries = process.env.MEIAO_KIE_HTTP_TRANSIENT_RETRIES;
  process.env.MEIAO_KIE_HTTP_TRANSIENT_RETRIES = '0';
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    throw new TypeError('fetch failed');
  };
  try {
    await assert.rejects(
      () => __testOnly_fetchKieWithTimeout('https://api.kie.ai/x', { method: 'GET' }, '超时', 5000, 'polling'),
      (error) => error.code === 'provider_network_error'
    );
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = realFetch;
    if (realRetries === undefined) delete process.env.MEIAO_KIE_HTTP_TRANSIENT_RETRIES;
    else process.env.MEIAO_KIE_HTTP_TRANSIENT_RETRIES = realRetries;
  }
});

test('请求级重试退避为指数：1 倍、3 倍基数', () => {
  assert.equal(__testOnly_getKieHttpRetryDelayMs(1, 1000), 1000);
  assert.equal(__testOnly_getKieHttpRetryDelayMs(2, 1000), 3000);
  assert.equal(__testOnly_getKieHttpRetryDelayMs(1, 500), 500);
});

test('上游主动取消（signal abort）不触发请求级重试', async () => {
  const realFetch = globalThis.fetch;
  const realRetryBase = process.env.MEIAO_KIE_HTTP_RETRY_BASE_MS;
  process.env.MEIAO_KIE_HTTP_RETRY_BASE_MS = '1';
  const controller = new AbortController();
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    controller.abort();
    throw new TypeError('fetch failed');
  };
  try {
    await assert.rejects(
      () => __testOnly_fetchKieWithTimeout('https://api.kie.ai/x', { method: 'GET', signal: controller.signal }, '超时', 5000, 'polling'),
      (error) => error.code === 'request_cancelled'
    );
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = realFetch;
    if (realRetryBase === undefined) delete process.env.MEIAO_KIE_HTTP_RETRY_BASE_MS;
    else process.env.MEIAO_KIE_HTTP_RETRY_BASE_MS = realRetryBase;
  }
});

test('组合路径:模糊提交错误既不请求级重试也不切换模型', async () => {
  const originalFetch = global.fetch;
  const requests = [];

  global.fetch = async (url, init) => {
    requests.push({ url: String(url), init });
    if (String(url).includes('/gemini-3-flash/v1/chat/completions')) {
      throw new TypeError('fetch failed'); // 主模型持续连接层错误
    }
    throw new Error(`ambiguous submit must not use fallback: ${String(url)}`);
  };

  try {
    await assert.rejects(
      () => executeProviderJob(
        {
          taskType: 'kie_chat',
          payload: {
            model: 'gemini-3-flash-openai',
            fallbackModels: ['gpt-5-2'],
            messages: [{ role: 'user', content: '组合路径回归' }],
          },
        },
        { KIE_API_KEY: 'test-key' },
        new AbortController().signal
      ),
      (error) => error?.code === 'provider_submission_unknown'
    );

    assert.equal(requests.length, 1);
    assert.match(requests[0].url, /\/gemini-3-flash\/v1\/chat\/completions$/);
  } finally {
    global.fetch = originalFetch;
  }
});

test('paid chat submission connection loss is unknown and never resubmitted', async () => {
  const originalFetch = globalThis.fetch;
  let createRequestCount = 0;
  globalThis.fetch = async (url) => {
    createRequestCount += 1;
    assert.match(String(url), /gemini-3-flash\/v1\/chat\/completions$/);
    throw new TypeError('fetch failed before response');
  };

  try {
    await assert.rejects(
      () => executeProviderJob({
        taskType: 'kie_chat',
        payload: {
          model: 'gemini-3-flash-openai',
          fallbackModels: ['gpt-5-2'],
          messages: [{ role: 'user', content: 'paid request' }],
        },
      }, { KIE_API_KEY: 'test-key' }, new AbortController().signal),
      (error) => error?.code === 'provider_submission_unknown'
        && error?.submissionUnknown === true,
    );
    assert.equal(createRequestCount, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('known provider task id stops chat resubmission before any provider request', async () => {
  const originalFetch = globalThis.fetch;
  let createRequestCount = 0;
  globalThis.fetch = async () => {
    createRequestCount += 1;
    throw new Error('known provider task must not be submitted again');
  };

  try {
    await assert.rejects(
      () => executeProviderJob({
        taskType: 'kie_chat',
        providerTaskId: 'provider-response-1',
        payload: { model: 'gpt-5-4-openai-resp', messages: [] },
      }, { KIE_API_KEY: 'test-key' }, new AbortController().signal),
      (error) => error?.code === 'provider_submission_unknown'
        && error?.providerTaskId === 'provider-response-1',
    );
    assert.equal(createRequestCount, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('direct-first image media fallback submits once per media route and preserves the task id', async () => {
  __testOnly_clearManagedAssetUploadCache();
  const originalFetch = globalThis.fetch;
  const requests = [];
  let createRequestCount = 0;
  const directAssetUrl = 'https://meiaoyuntai.com/api/assets/file/paid-safe/source.png';
  const stagedAssetUrl = 'https://tempfile.redpandaai.co/kieai/30590/mayo-storage/internal/source.png';

  globalThis.fetch = async (url, init = {}) => {
    const requestUrl = String(url);
    requests.push({ requestUrl, init });
    if (requestUrl.includes('/createTask')) {
      createRequestCount += 1;
      if (createRequestCount === 1) {
        return createJsonResponse({ code: 400, msg: 'Failed to get the file information' }, 400);
      }
      return createJsonResponse({ code: 200, data: { taskId: 'paid-safe-image-task' } });
    }
    if (requestUrl.includes('/api/assets/file/')) {
      return new Response(Buffer.from([0x89, 0x50, 0x4e, 0x47]), {
        status: 200,
        headers: { 'content-type': 'image/png' },
      });
    }
    if (requestUrl.includes('/file-stream-upload')) {
      return createJsonResponse({ code: 200, data: { fileUrl: stagedAssetUrl } });
    }
    if (requestUrl.includes('/recordInfo')) {
      return createJsonResponse({
        code: 200,
        data: {
          state: 'success',
          resultJson: JSON.stringify({ resultUrls: ['https://example.com/paid-safe-result.png'] }),
        },
      });
    }
    throw new Error(`unexpected request: ${requestUrl}`);
  };

  try {
    const result = await executeProviderJob({
      taskType: 'kie_image',
      payload: {
        prompt: 'direct-first fallback',
        imageUrls: ['/api/assets/file/paid-safe/source.png'],
        model: 'nano-banana-2',
        aspectRatio: '1:1',
        resolution: '1K',
      },
    }, {
      KIE_API_KEY: 'test-key',
      MEIAO_PUBLIC_BASE_URL: 'https://meiaoyuntai.com',
      MEIAO_KIE_MANAGED_ASSET_MODE: 'direct-first',
      MEIAO_KIE_ASSET_UPLOAD_RETRIES: '0',
    }, new AbortController().signal);

    const createBodies = requests
      .filter((request) => request.requestUrl.includes('/createTask'))
      .map((request) => JSON.parse(String(request.init.body)));
    assert.equal(createRequestCount, 2);
    assert.deepEqual(createBodies.map((body) => body.input.image_input), [[directAssetUrl], [stagedAssetUrl]]);
    assert.equal(requests.filter((request) => request.requestUrl.includes('/file-stream-upload')).length, 1);
    assert.equal(result.providerTaskId, 'paid-safe-image-task');
    assert.equal(result.providerMediaRoute, 'kie-fallback');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('upload-only transport retries a connection loss without creating a paid task', async () => {
  const originalFetch = globalThis.fetch;
  let uploadRequestCount = 0;
  globalThis.fetch = async (url) => {
    assert.match(String(url), /file-stream-upload$/);
    uploadRequestCount += 1;
    if (uploadRequestCount === 1) throw new TypeError('upload connection lost');
    return createJsonResponse({ code: 200, data: { fileUrl: 'https://kie.example.com/uploaded.png' } });
  };

  try {
    const result = await uploadAssetViaKieStream({
      fileBuffer: Buffer.from('png'),
      mimeType: 'image/png',
      fileName: 'source.png',
    }, {
      KIE_API_KEY: 'test-key',
      MEIAO_KIE_ASSET_UPLOAD_RETRIES: '1',
      MEIAO_KIE_ASSET_UPLOAD_RETRY_BASE_MS: '1',
    });

    assert.equal(result.result.fileUrl, 'https://kie.example.com/uploaded.png');
    assert.equal(uploadRequestCount, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
