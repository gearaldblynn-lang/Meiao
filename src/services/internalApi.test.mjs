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
