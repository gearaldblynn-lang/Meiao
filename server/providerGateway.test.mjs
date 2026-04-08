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

test('executeProviderJob routes gpt-5-4 kie chat through responses api with reasoning and web search', async () => {
  const originalFetch = global.fetch;
  const requests = [];

  global.fetch = async (url, init) => {
    requests.push({ url: String(url), init });
    return createJsonResponse({
      output_text: 'gpt-5.4 result',
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
    assert.match(requests[0].url, /\/codex\/v1\/responses$/);
    const body = JSON.parse(String(requests[0].init.body));
    assert.equal(body.model, 'gpt-5-4');
    assert.equal(body.reasoning.effort, 'low');
    assert.equal(body.tools[0].type, 'web_search');
    assert.equal(body.input[1].content[0].type, 'input_text');
    assert.equal(body.input[1].content[1].type, 'input_image');
    assert.equal(body.input[1].content[2].type, 'input_file');
  } finally {
    global.fetch = originalFetch;
  }
});

test('executeProviderJob uploads managed asset image urls to kie before creating image task', async () => {
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
        arrayBuffer: async () => new TextEncoder().encode('asset-binary').buffer,
        json: async () => ({}),
      };
    }
    if (String(url).includes('/file-stream-upload')) {
      return createJsonResponse({
        code: 200,
        data: { fileUrl: 'https://kie.example.com/uploaded-source.jpg' },
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
    const createTaskRequest = requests.find((item) => item.url.includes('/createTask'));
    const createTaskBody = JSON.parse(String(createTaskRequest.init.body));
    assert.deepEqual(createTaskBody.input.image_input, ['https://kie.example.com/uploaded-source.jpg']);
  } finally {
    global.fetch = originalFetch;
    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
  }
});

test('executeProviderJob uploads managed asset attachments before calling gpt-5.4 responses api', async () => {
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
        data: { fileUrl: 'https://kie.example.com/uploaded-doc.pdf' },
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
                { type: 'input_file', file_url: 'http://111.229.66.247/api/assets/file/file-1/source.pdf', filename: 'source.pdf' },
              ],
            },
          ],
        },
      },
      { KIE_API_KEY: 'test-key' },
      new AbortController().signal
    );

    assert.equal(result.result.content, 'ok');
    const responseRequest = requests.find((item) => item.url.includes('/codex/v1/responses'));
    const responseBody = JSON.parse(String(responseRequest.init.body));
    assert.equal(responseBody.input[1].content[1].file_url, 'https://kie.example.com/uploaded-doc.pdf');
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

test('executeProviderJob routes gemini 3 flash through kie chat endpoint with low reasoning effort', async () => {
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
          webSearchEnabled: false,
          messages: [
            { role: 'system', content: '你是助手' },
            { role: 'user', content: '请简要总结' },
          ],
        },
      },
      { KIE_API_KEY: 'test-key' },
      new AbortController().signal
    );

    assert.equal(result.result.content, 'gemini 3 flash result');
    assert.match(requests[0].url, /\/gemini-3-flash\/v1\/chat\/completions$/);
    const body = JSON.parse(String(requests[0].init.body));
    assert.equal(body.model, 'gemini-3-flash-openai');
    assert.equal(body.include_thoughts, true);
    assert.equal(body.reasoning_effort, 'low');
    assert.equal(Array.isArray(body.tools), false);
  } finally {
    global.fetch = originalFetch;
  }
});
