import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./internalApi.ts', import.meta.url), 'utf8');

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

test('probeInternalApi uses a timeouted fetch instead of waiting on a bare health request', () => {
  const probeBody = source.match(/export const probeInternalApi = async \([^)]*\)(?:: [^{]+)? => \{([\s\S]*?)\n\};/)?.[1] || '';

  assert.match(probeBody, /fetchWithTimeout/);
  assert.match(probeBody, /timeoutMs/);
  assert.doesNotMatch(probeBody, /await fetch\('\s*\/api\/health\s*'\)/);
});

test('authenticated GET request dedupe keys include the current session token', () => {
  assert.match(source, /const buildDedupeKey = \(path: string, method: string, body\?: BodyInit \| null, token = ''\)/);
  assert.match(source, /const authScope = token \? `auth:\$\{token\}` : 'auth:anonymous'/);
  assert.match(source, /if \(method === 'GET'\) return `GET:\$\{path\}:\$\{authScope\}`/);
  assert.match(source, /const token = getSessionToken\(\);\s+const dedupeKey = dedupe \? buildDedupeKey\(path, method, init\?\.body, token\) : ''/);
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
