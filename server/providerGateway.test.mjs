import test from 'node:test';
import assert from 'node:assert/strict';

import { executeProviderJob, uploadAssetViaKieStream } from './providerGateway.mjs';

const createJsonResponse = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

test('executeProviderJob keeps polling kie image jobs when recordInfo is temporarily not found', async () => {
  const originalFetch = global.fetch;
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
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
          imageUrls: ['https://example.com/source.png'],
          model: 'nano-banana-2',
          aspectRatio: '1:1',
          resolution: '1K',
        },
      },
      { KIE_API_KEY: 'test-key' },
      new AbortController().signal
    );

    assert.equal(result.providerTaskId, 'kie-task-1');
    assert.equal(result.result.imageUrl, 'https://example.com/result.png');
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
