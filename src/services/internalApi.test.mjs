import test from 'node:test';
import assert from 'node:assert/strict';

const installBrowserLikeGlobals = () => {
  const storage = new Map();
  globalThis.localStorage = {
    getItem: (key) => storage.has(key) ? storage.get(key) : null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key),
    clear: () => storage.clear(),
  };
  globalThis.window = {
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
  };
};

const loadInternalApi = async () => {
  installBrowserLikeGlobals();
  return import(`./internalApi.ts?case=${Date.now()}-${Math.random()}`);
};

test('probeInternalApi aborts the health request on timeout', async () => {
  const originalFetch = globalThis.fetch;
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const api = await loadInternalApi();
  let seenSignal = null;
  globalThis.setTimeout = (handler) => {
    queueMicrotask(handler);
    return 0;
  };
  globalThis.clearTimeout = () => {};
  globalThis.fetch = async (_url, init = {}) => {
    seenSignal = init.signal;
    return new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
    });
  };

  try {
    const ok = await api.probeInternalApi();
    assert.equal(ok, false);
    assert.equal(seenSignal instanceof AbortSignal, true);
    assert.equal(seenSignal.aborted, true);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});

test('authenticated GET request dedupe is scoped by current session token', async () => {
  const originalFetch = globalThis.fetch;
  const api = await loadInternalApi();
  const pending = [];
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), authorization: init.headers?.Authorization || '' });
    return new Promise((resolve) => pending.push(resolve));
  };

  try {
    api.storeSessionToken('token-a');
    const firstA = api.fetchCurrentUser();
    const secondA = api.fetchCurrentUser();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].authorization, 'Bearer token-a');

    api.storeSessionToken('token-b');
    const firstB = api.fetchCurrentUser();
    assert.equal(calls.length, 2);
    assert.equal(calls[1].authorization, 'Bearer token-b');

    pending[0](new Response(JSON.stringify({ user: { id: 'a', username: 'alice' } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    pending[1](new Response(JSON.stringify({ user: { id: 'b', username: 'bob' } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));

    assert.deepEqual(await firstA, { user: { id: 'a', username: 'alice' } });
    assert.deepEqual(await secondA, { user: { id: 'a', username: 'alice' } });
    assert.deepEqual(await firstB, { user: { id: 'b', username: 'bob' } });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('sendChatMessage falls back to JSON response when streaming is unavailable', async () => {
  const originalFetch = globalThis.fetch;
  const api = await loadInternalApi();
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), '/api/chat/sessions/session-1/messages');
    assert.equal(init.method, 'POST');
    assert.equal(JSON.parse(String(init.body)).stream, true);
    return new Response(JSON.stringify({
      userMessage: { id: 'user-1', role: 'user', content: 'hello' },
      assistantMessage: { id: 'assistant-1', role: 'assistant', content: 'hi' },
      usage: { totalTokens: 3 },
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  try {
    const result = await api.sendChatMessage(
      'session-1',
      { content: 'hello', requestMode: 'chat' },
      { stream: true }
    );
    assert.equal(result.assistantMessage.content, 'hi');
    assert.deepEqual(result.usage, { totalTokens: 3 });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('runSmartFactoryPreviewTurn posts message to Smart Factory preview API', async () => {
  const originalFetch = globalThis.fetch;
  const api = await loadInternalApi();
  let seenBody = null;
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), '/api/smart-factory/preview-turn');
    assert.equal(init.method, 'POST');
    seenBody = JSON.parse(String(init.body));
    return new Response(JSON.stringify({
      result: {
        mode: 'preview',
        answer: 'ok',
        trace: [],
        toolResults: [],
        modelRequest: { tools: [] },
      },
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  try {
    const result = await api.runSmartFactoryPreviewTurn({ message: '退货规则是什么' });
    assert.deepEqual(seenBody, { message: '退货规则是什么' });
    assert.equal(result.result.answer, 'ok');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('fetchSmartFactoryConfig reads Smart Factory runtime configuration', async () => {
  const originalFetch = globalThis.fetch;
  const api = await loadInternalApi();
  globalThis.fetch = async (url, init = {}) => {
    assert.equal(String(url), '/api/smart-factory/config');
    assert.equal(init.method || 'GET', 'GET');
    return new Response(JSON.stringify({
      config: {
        mode: 'preview',
        models: [{ provider: 'openai_compatible', name: 'gpt-5.5', features: ['tool-call'] }],
        knowledgeBases: [{ id: 'kb-after-sale', name: '售后知识库', documentCount: 2 }],
        tools: [{ name: 'feishu_create_sheet', type: 'cli', authorized: true }],
        agents: [{ id: 'agent-after-sale', name: '售后智能体', enabled: true }],
        sessions: [{ id: 'session-after-sale-demo', agentId: 'agent-after-sale', title: '售后试运行', messageCount: 0, messages: [] }],
      },
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  try {
    const result = await api.fetchSmartFactoryConfig();
    assert.equal(result.config.models[0].name, 'gpt-5.5');
    assert.equal(result.config.knowledgeBases[0].documentCount, 2);
    assert.equal(result.config.tools[0].name, 'feishu_create_sheet');
    assert.equal(result.config.agents[0].name, '售后智能体');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('updateSmartFactoryConfig patches Smart Factory configuration only', async () => {
  const originalFetch = globalThis.fetch;
  const api = await loadInternalApi();
  let seenBody = null;
  globalThis.fetch = async (url, init = {}) => {
    assert.equal(String(url), '/api/smart-factory/config');
    assert.equal(init.method, 'PATCH');
    seenBody = JSON.parse(String(init.body));
    return new Response(JSON.stringify({
      config: {
        mode: 'preview',
        models: [{ provider: 'relay-b', name: 'relay-b-model', features: ['tool-call'] }],
        knowledgeBases: [{ id: 'kb-after-sale', name: '售后知识库', documentCount: 2 }],
        tools: [{ name: 'feishu_create_sheet', type: 'cli', authorized: true }],
      },
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  try {
    const payload = {
      modelProviders: [{
        provider: 'relay-b',
        credentialRef: 'env:RELAY_B_KEY',
        models: [{ id: 'relay-b-model', mode: 'chat', features: ['tool-call'] }],
      }],
    };
    const result = await api.updateSmartFactoryConfig(payload);
    assert.deepEqual(seenBody, { smartFactory: payload });
    assert.equal(result.config.models[0].name, 'relay-b-model');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('sendSmartFactoryChat posts agent session message and receives persisted config', async () => {
  const originalFetch = globalThis.fetch;
  const api = await loadInternalApi();
  let seenBody = null;
  globalThis.fetch = async (url, init = {}) => {
    assert.equal(String(url), '/api/smart-factory/chat');
    assert.equal(init.method, 'POST');
    seenBody = JSON.parse(String(init.body));
    return new Response(JSON.stringify({
      result: {
        mode: 'preview',
        agentId: 'agent-after-sale',
        answer: '7 天内可退货',
        trace: [{ event: 'model_request_built' }],
        toolResults: [],
        modelRequest: { tools: [] },
      },
      config: {
        mode: 'preview',
        models: [{ provider: 'openai_compatible', name: 'gpt-5.5', features: ['tool-call'] }],
        knowledgeBases: [{ id: 'kb-after-sale', name: '售后知识库', documentCount: 2 }],
        tools: [{ name: 'feishu_create_sheet', type: 'cli', authorized: true }],
        agents: [{ id: 'agent-after-sale', name: '售后智能体', enabled: true }],
        sessions: [{
          id: 'session-after-sale-demo',
          agentId: 'agent-after-sale',
          title: '售后试运行',
          messageCount: 2,
          messages: [
            { role: 'user', content: '退货规则是什么' },
            { role: 'assistant', content: '7 天内可退货' },
          ],
        }],
      },
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  try {
    const result = await api.sendSmartFactoryChat({
      agentId: 'agent-after-sale',
      sessionId: 'session-after-sale-demo',
      message: '退货规则是什么',
    });
    assert.deepEqual(seenBody, {
      agentId: 'agent-after-sale',
      sessionId: 'session-after-sale-demo',
      message: '退货规则是什么',
    });
    assert.equal(result.config.sessions[0].messageCount, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('addSmartFactoryKnowledgeDocument posts document for training', async () => {
  const originalFetch = globalThis.fetch;
  const api = await loadInternalApi();
  let seenBody = null;
  globalThis.fetch = async (url, init = {}) => {
    assert.equal(String(url), '/api/smart-factory/knowledge-documents');
    assert.equal(init.method, 'POST');
    seenBody = JSON.parse(String(init.body));
    return new Response(JSON.stringify({
      config: {
        mode: 'preview',
        models: [],
        knowledgeBases: [{ id: 'kb-after-sale', name: '售后知识库', documentCount: 3 }],
        tools: [],
        agents: [],
        sessions: [],
      },
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  try {
    const result = await api.addSmartFactoryKnowledgeDocument({
      knowledgeBaseId: 'kb-after-sale',
      document: { title: '退货运费', content: '退货运费按平台规则处理。' },
    });
    assert.deepEqual(seenBody, {
      knowledgeBaseId: 'kb-after-sale',
      document: { title: '退货运费', content: '退货运费按平台规则处理。' },
    });
    assert.equal(result.config.knowledgeBases[0].documentCount, 3);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('smart factory product APIs cover models agents knowledge tools and retrieval tests', async () => {
  const originalFetch = globalThis.fetch;
  const api = await loadInternalApi();
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({
      url: String(url),
      method: init.method || 'GET',
      body: init.body ? JSON.parse(String(init.body)) : null,
    });
    return new Response(JSON.stringify({
      ok: true,
      message: 'ok',
      observation: 'tool ok',
      search: { query: '退货', results: [{ title: '退货规则' }] },
      config: {
        mode: 'production',
        modelProviders: [],
        models: [],
        knowledgeBases: [],
        tools: [],
        agents: [],
        sessions: [],
        runLogs: [],
      },
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  try {
    await api.saveSmartFactoryModelProvider({ provider: 'relay-main', modelsText: 'gpt-5.5' });
    await api.testSmartFactoryModelProvider({ provider: 'relay-main', modelsText: 'gpt-5.5' });
    await api.createSmartFactoryAgent({ name: '资料助手' });
    await api.updateSmartFactoryAgent('agent-1', { prompt: '只读知识库' });
    await api.publishSmartFactoryAgent('agent-1');
    await api.createSmartFactoryKnowledgeBase({ name: '资料库' });
    await api.retrainSmartFactoryKnowledgeDocument('doc-1', { content: '新内容' });
    await api.deleteSmartFactoryKnowledgeDocument('doc-1');
    await api.searchSmartFactoryKnowledge({ query: '退货', knowledgeBaseIds: ['kb-1'] });
    await api.saveSmartFactoryTool({ name: 'feishu_create_doc', executorRef: 'feishu.create_sheet' });
    await api.testSmartFactoryTool('feishu_create_doc', { title: '日报' });

    assert.deepEqual(calls.map((call) => `${call.method} ${call.url}`), [
      'POST /api/smart-factory/model-providers',
      'POST /api/smart-factory/model-providers/test',
      'POST /api/smart-factory/agents',
      'PATCH /api/smart-factory/agents/agent-1',
      'POST /api/smart-factory/agents/agent-1/publish',
      'POST /api/smart-factory/knowledge-bases',
      'POST /api/smart-factory/knowledge-documents/doc-1/retrain',
      'DELETE /api/smart-factory/knowledge-documents/doc-1',
      'POST /api/smart-factory/knowledge-search',
      'POST /api/smart-factory/tools',
      'POST /api/smart-factory/tools/feishu_create_doc/test',
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('system model provider APIs manage the unified model registry', async () => {
  const originalFetch = globalThis.fetch;
  const api = await loadInternalApi();
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({
      url: String(url),
      method: init.method || 'GET',
      body: init.body ? JSON.parse(String(init.body)) : null,
    });
    return new Response(JSON.stringify({
      ok: true,
      message: 'ok',
      registry: {
        providers: [{
          provider: 'relay-main',
          displayName: '主中转',
          hasCredential: true,
          capabilityCounts: { chat: 1 },
          models: [{ id: 'gpt-5.5', mode: 'chat', features: ['tool-call'] }],
        }],
      },
      presets: [],
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  try {
    await api.fetchSystemModelProviders();
    await api.saveSystemModelProvider({ provider: 'relay-main', modelsText: 'chat:gpt-5.5' });
    await api.testSystemModelProvider({ provider: 'relay-main', modelsText: 'chat:gpt-5.5' });
    await api.deleteSystemModelProvider('relay-main');

    assert.deepEqual(calls.map((call) => `${call.method} ${call.url}`), [
      'GET /api/system/model-providers',
      'POST /api/system/model-providers',
      'POST /api/system/model-providers/test',
      'DELETE /api/system/model-providers/relay-main',
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('sendChatMessage uses SSE for image generation when streaming is requested', async () => {
  const originalFetch = globalThis.fetch;
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const api = await loadInternalApi();
  const encoder = new TextEncoder();
  const progressEvents = [];
  let seenBody = null;
  const timeoutValues = [];
  globalThis.setTimeout = (handler, ms, ...args) => {
    timeoutValues.push(ms);
    return originalSetTimeout(handler, ms, ...args);
  };
  globalThis.clearTimeout = (timer) => originalClearTimeout(timer);
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), '/api/chat/sessions/session-1/messages');
    assert.equal(init.method, 'POST');
    seenBody = JSON.parse(String(init.body));
    assert.equal(seenBody.stream, true);
    assert.equal(seenBody.requestMode, 'image_generation');
    assert.equal(init.headers?.Accept, 'text/event-stream');
    return new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode('data: {"type":"thinking","round":1}\n\n'));
          controller.enqueue(encoder.encode('data: {"type":"image_generating","model":"gpt-image-2"}\n\n'));
          controller.enqueue(encoder.encode('data: {"type":"done","assistantMessage":{"id":"assistant-1","role":"assistant","content":"图片已生成","metadata":{"messageIds":{"userMessageId":"user-1"}}},"usage":{"totalTokens":8}}\n\n'));
          controller.close();
        },
      }),
      {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      }
    );
  };

  try {
    const result = await api.sendChatMessage(
      'session-1',
      { content: '生成图片', requestMode: 'image_generation' },
      { stream: true, onProgress: (event) => progressEvents.push(event) }
    );
    assert.equal(result.assistantMessage.content, '图片已生成');
    assert.equal(result.userMessage.id, 'user-1');
    assert.deepEqual(progressEvents.map((event) => event.type), ['thinking', 'image_generating', 'done']);
    assert.ok(timeoutValues.includes(900_000), 'image generation streaming should survive multi-image real runs longer than 5 minutes');
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});

test('sendChatMessage removes bridged abort listeners after JSON request completion', async () => {
  const originalFetch = globalThis.fetch;
  const api = await loadInternalApi();
  let addedListener = null;
  let removedListener = null;
  let addCount = 0;
  let removeCount = 0;
  const externalSignal = {
    aborted: false,
    reason: undefined,
    addEventListener: (type, listener) => {
      if (type !== 'abort') return;
      addCount += 1;
      addedListener = listener;
    },
    removeEventListener: (type, listener) => {
      if (type !== 'abort') return;
      removeCount += 1;
      removedListener = listener;
    },
  };
  globalThis.fetch = async () => new Response(JSON.stringify({
    userMessage: { id: 'user-1', role: 'user', content: 'hello' },
    assistantMessage: { id: 'assistant-1', role: 'assistant', content: 'hi' },
    usage: {},
  }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

  try {
    const result = await api.sendChatMessage(
      'session-1',
      { content: 'hello', requestMode: 'chat' },
      { signal: externalSignal }
    );
    assert.equal(result.assistantMessage.content, 'hi');
    assert.equal(addCount, 1);
    assert.equal(removeCount, 1);
    assert.equal(removedListener, addedListener);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('sendChatMessage rejects incomplete SSE streams without a done event', async () => {
  const originalFetch = globalThis.fetch;
  const api = await loadInternalApi();
  const encoder = new TextEncoder();
  globalThis.fetch = async () => new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"type":"streaming","delta":"partial"}\n\n'));
        controller.close();
      },
    }),
    {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    }
  );

  try {
    await assert.rejects(
      () => api.sendChatMessage('session-1', { content: 'hello', requestMode: 'chat' }, { stream: true }),
      (error) => error?.code === 'stream_incomplete' && /未返回完成消息/.test(error.message)
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('waitForInternalJob keeps polling retry_waiting jobs until terminal status', async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const api = await loadInternalApi();
  const statuses = ['retry_waiting', 'running', 'succeeded'];
  const seenUrls = [];
  globalThis.window = {
    setTimeout: (handler) => {
      queueMicrotask(handler);
      return 0;
    },
    clearTimeout: () => {},
  };
  globalThis.fetch = async (url) => {
    seenUrls.push(String(url));
    const status = statuses.shift();
    return new Response(JSON.stringify({
      job: {
        id: 'job-1',
        status,
        providerTaskId: status === 'succeeded' ? 'provider-1' : '',
        result: status === 'succeeded' ? { imageUrl: 'https://cdn.test/result.png' } : null,
      },
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  try {
    const job = await api.waitForInternalJob('job-1', undefined, 1, 100);
    assert.equal(job.status, 'succeeded');
    assert.equal(job.providerTaskId, 'provider-1');
    assert.equal(seenUrls.length, 3);
    assert.ok(seenUrls.every((url) => url === '/api/jobs/job-1'));
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.window = originalWindow;
  }
});
