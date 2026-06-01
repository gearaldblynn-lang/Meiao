import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { executeProviderJob, uploadAssetViaKieStream, __testOnly_setDreaminaVideoRunner } from './providerGateway.mjs';

const createJsonResponse = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
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

test('uploadAssetViaKie falls back for relative managed assets when stream upload auth is rejected', async () => {
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
    if (String(url).includes('/file-base64-upload')) {
      return createJsonResponse({
        code: 200,
        data: { fileUrl: 'https://kie.example.com/uploaded-from-base64.png' },
      });
    }
    if (String(url).includes('/createTask')) {
      return createJsonResponse({ code: 200, data: { taskId: 'kie-task-base64-fallback' } });
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
    const result = await executeProviderJob(
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
    );

    assert.equal(result.providerTaskId, 'kie-task-base64-fallback');
    assert.equal(requests.filter((item) => item.url.includes('/file-stream-upload')).length, 1);
    assert.equal(requests.filter((item) => item.url.includes('/file-base64-upload')).length, 1);
    const createTaskRequest = requests.find((item) => item.url.includes('/createTask'));
    const createTaskBody = JSON.parse(String(createTaskRequest.init.body));
    assert.deepEqual(createTaskBody.input.image_input, ['https://kie.example.com/uploaded-from-base64.png']);
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

test('executeProviderJob converts cloud managed asset image urls before creating kie image tasks', async () => {
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
        headers: new Headers({ 'content-type': 'image/jpeg' }),
        arrayBuffer: async () => new TextEncoder().encode('cloud-asset-binary').buffer,
        json: async () => ({}),
      };
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
      { KIE_API_KEY: 'test-key' },
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

test('executeProviderJob converts cloud managed file attachments for gpt-5.4 responses', async () => {
  const originalFetch = global.fetch;
  const requests = [];
  const cloudFileUrl = 'http://111.229.66.247/api/assets/file/file-1/source.pdf';

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
        data: { fileUrl: 'https://tempfile.redpandaai.co/kieai/30590/mayo-storage/internal/source.pdf' },
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
      { KIE_API_KEY: 'test-key' },
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
    assert.equal(responseBody.input[0].content[1].file_url, 'https://tempfile.redpandaai.co/kieai/30590/mayo-storage/internal/source.pdf');
    assert.equal(responseBody.input[0].content[1].file_data, undefined);
  } finally {
    global.fetch = originalFetch;
  }
});

test('executeProviderJob converts cloud managed asset images for gpt-5.4 responses api', async () => {
  const originalFetch = global.fetch;
  const requests = [];
  const cloudAssetUrl = 'http://111.229.66.247/api/assets/file/img-1/source.png';

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
      { KIE_API_KEY: 'test-key' },
      new AbortController().signal
    );

    assert.equal(result.result.content, 'ok');
    assert.equal(requests.filter((item) => item.url.includes('/api/assets/file/')).length, 1);
    assert.equal(requests.filter((item) => item.url.includes('/file-stream-upload')).length, 1);
    assert.equal(requests.filter((item) => item.url.includes('/file-base64-upload')).length, 0);
    const responseRequest = requests.find((item) => item.url.includes('/codex/v1/responses'));
    const responseBody = JSON.parse(String(responseRequest.init.body));
    assert.equal(responseBody.input[0].content[1].image_url, 'https://tempfile.redpandaai.co/kieai/30590/mayo-storage/internal/source.png');
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

test('executeProviderJob converts cloud managed file attachments for gemini chat models', async () => {
  const originalFetch = global.fetch;
  const requests = [];
  const cloudFileUrl = 'http://111.229.66.247/api/assets/file/file-2/source.pdf';

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
        data: { fileUrl: 'https://tempfile.redpandaai.co/kieai/30590/mayo-storage/internal/source.pdf' },
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
      { KIE_API_KEY: 'test-key' },
      new AbortController().signal
    );

    assert.equal(result.result.content, 'gemini managed file ok');
    assert.equal(requests.filter((item) => item.url.includes('/api/assets/file/')).length, 1);
    assert.equal(requests.filter((item) => item.url.includes('/file-stream-upload')).length, 1);
    const chatRequest = requests.find((item) => item.url.includes('/gemini-3-flash/v1/chat/completions'));
    const chatBody = JSON.parse(String(chatRequest.init.body));
    assert.equal(chatBody.messages[1].content[0].text, '读取这个 pdf，文件URL：https://tempfile.redpandaai.co/kieai/30590/mayo-storage/internal/source.pdf');
    assert.equal(chatBody.messages[1].content[1].type, 'image_url');
    assert.equal(chatBody.messages[1].content[1].image_url.url, 'https://tempfile.redpandaai.co/kieai/30590/mayo-storage/internal/source.pdf');
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

test('executeProviderJob converts cloud managed image urls inside gemini text labels', async () => {
  const originalFetch = global.fetch;
  const requests = [];

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
        data: { fileUrl: 'https://tempfile.redpandaai.co/kieai/30590/mayo-storage/internal/reference.jpg' },
      });
    }
    if (String(url).includes('/gemini-3-flash/v1/chat/completions')) {
      return createJsonResponse({ choices: [{ message: { content: 'gemini image ok' } }] });
    }
    throw new Error(`unexpected request: ${String(url)}`);
  };

  try {
    const sourceUrl = 'http://111.229.66.247/api/assets/file/ref-1/reference.jpg';
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
      { KIE_API_KEY: 'test-key' },
      new AbortController().signal
    );

    assert.equal(result.result.content, 'gemini image ok');
    assert.equal(requests.filter((item) => item.url.includes('/api/assets/file/')).length, 1);
    assert.equal(requests.filter((item) => item.url.includes('/file-stream-upload')).length, 1);
    const chatRequest = requests.find((item) => item.url.includes('/gemini-3-flash/v1/chat/completions'));
    const chatBody = JSON.parse(String(chatRequest.init.body));
    assert.equal(chatBody.messages[0].content[0].text, '[复刻主图参考1] 图片URL：https://tempfile.redpandaai.co/kieai/30590/mayo-storage/internal/reference.jpg。这是唯一版式参考。');
    assert.equal(chatBody.messages[0].content[1].image_url.url, 'https://tempfile.redpandaai.co/kieai/30590/mayo-storage/internal/reference.jpg');
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

test('executeProviderJob respects caller-provided fallback models when gpt-5.4 responses fails', async () => {
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
    return createJsonResponse({
      choices: [
        {
          message: {
            content: 'flash fallback result',
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
          model: 'gpt-5-4-openai-resp',
          fallbackModels: ['gemini-3-flash-openai'],
          messages: [{ role: 'user', content: '请只回复 flash fallback result' }],
        },
      },
      { KIE_API_KEY: 'test-key' },
      new AbortController().signal
    );

    assert.equal(result.result.content, 'flash fallback result');
    assert.equal(result.result.modelUsed, 'gemini-3-flash-openai');
    assert.match(requests[0].url, /\/codex\/v1\/responses$/);
    assert.match(requests[1].url, /\/gemini-3-flash\/v1\/chat\/completions$/);
    assert.equal(requests.length, 2);
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

test('executeProviderJob applies the KIE HTTP timeout to gemini 3 flash requests', async () => {
  const originalFetch = global.fetch;
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  let sawKieTimeout = false;

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
    if (ms === 60_000) sawKieTimeout = true;
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
    assert.equal(sawKieTimeout, true);
  } finally {
    global.fetch = originalFetch;
    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
  }
});

test('executeProviderJob respects fallback models when gemini 3 flash fetch fails', async () => {
  const originalFetch = global.fetch;
  const requests = [];

  global.fetch = async (url, init) => {
    requests.push({ url: String(url), init });
    if (String(url).includes('/gemini-3-flash/v1/chat/completions')) {
      throw new TypeError('fetch failed');
    }
    return createJsonResponse({
      choices: [
        {
          message: {
            content: 'chat fallback after flash failure',
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
          fallbackModels: ['gpt-5-2'],
          messages: [{ role: 'user', content: '请只回复 fallback result' }],
        },
      },
      { KIE_API_KEY: 'test-key' },
      new AbortController().signal
    );

    assert.equal(result.result.content, 'chat fallback after flash failure');
    assert.equal(result.result.modelUsed, 'gpt-5-2');
    assert.match(requests[0].url, /\/gemini-3-flash\/v1\/chat\/completions$/);
    assert.match(requests[1].url, /\/gpt-5-2\/v1\/chat\/completions$/);
    assert.equal(requests.length, 2);
  } finally {
    global.fetch = originalFetch;
  }
});

test('executeProviderJob falls back to base64 asset upload when gemini 3 flash stream upload fails', async () => {
  const originalFetch = global.fetch;
  const requests = [];

  global.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    if (String(url).includes('/api/file-stream-upload')) {
      throw new TypeError('fetch failed');
    }
    if (String(url).includes('/api/file-base64-upload')) {
      return createJsonResponse({ data: { downloadUrl: 'https://tempfile.example/uploaded.png' } });
    }
    return createJsonResponse({
      choices: [
        {
          message: {
            content: 'uploaded through fallback',
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
      { KIE_API_KEY: 'test-key' },
      new AbortController().signal
    );

    assert.equal(result.result.content, 'uploaded through fallback');
    assert.match(requests[0].url, /\/api\/file-stream-upload$/);
    assert.match(requests[1].url, /\/api\/file-base64-upload$/);
    assert.match(requests[2].url, /\/gemini-3-flash\/v1\/chat\/completions$/);
  } finally {
    global.fetch = originalFetch;
  }
});

test('executeProviderJob falls back when gemini 3 flash stream stalls after submission', async () => {
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
    return createJsonResponse({
      choices: [
        {
          message: {
            content: 'fallback after stalled stream',
          },
        },
      ],
    });
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
    const result = await executeProviderJob(
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
    );

    assert.equal(sawStreamTimeout, true);
    assert.equal(result.result.content, 'fallback after stalled stream');
    assert.equal(result.result.modelUsed, 'gpt-5-2');
    assert.equal(requests.length, 2);
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

test('executeProviderJob converts cloud managed asset images for gemini planning', async () => {
  const originalFetch = global.fetch;
  const requests = [];
  const cloudAssetUrl = 'http://111.229.66.247/api/assets/file/img-1/source.png';

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
      { KIE_API_KEY: 'test-key' },
      new AbortController().signal
    );

    assert.equal(result.result.content, 'gemini result');
    assert.equal(requests.filter((item) => item.url.includes('/api/assets/file/')).length, 1);
    assert.equal(requests.filter((item) => item.url.includes('/file-stream-upload')).length, 1);
    const geminiRequest = requests.find((item) => item.url.includes('/gemini-3-flash'));
    assert.ok(geminiRequest);
    const body = JSON.parse(String(geminiRequest.init.body));
    assert.equal(body.messages[0].content[1].image_url.url, 'https://tempfile.redpandaai.co/kieai/30590/mayo-storage/internal/source.png');
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

test('provider gateway raises abort signal listener budget for concurrent media fetches', () => {
  const source = readFileSync(new URL('./providerGateway.mjs', import.meta.url), 'utf8');

  assert.match(source, /import \{ getMaxListeners, setMaxListeners \} from 'node:events';/);
  assert.match(source, /const allowConcurrentAbortListeners = \(signal, count\) =>/);
  assert.match(source, /setMaxListeners\(Math\.max\(currentLimit, requestedLimit\), signal\)/);
  assert.match(source, /allowConcurrentAbortListeners\(signal, rawImageUrls\.length\)/);
});
