import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import {
  callOpenAICompatibleEmbeddingModel,
  callOpenAICompatibleChatModel,
  resolveSmartFactoryCredentialRef,
  testOpenAICompatibleModelProvider,
} from './openAICompatibleModelClient.mjs';

const withJsonServer = async (handler, run) => {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const bodyText = Buffer.concat(chunks).toString('utf8');
    const body = bodyText ? JSON.parse(bodyText) : {};
    requests.push({ method: req.method, url: req.url, headers: req.headers, body });
    await handler(req, res, body);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}/v1`;
  try {
    await run({ baseUrl, requests });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
};

test('resolves env credential references without exposing raw secrets', () => {
  assert.equal(resolveSmartFactoryCredentialRef('env:SMART_FACTORY_TEST_KEY', {
    SMART_FACTORY_TEST_KEY: 'sk-real',
  }), 'sk-real');
  assert.equal(resolveSmartFactoryCredentialRef('env:MISSING_KEY', {}), '');
  assert.equal(resolveSmartFactoryCredentialRef('sk-raw-secret', {}), '');
});

test('calls OpenAI-compatible chat completions with model tools and parses tool calls', async () => {
  await withJsonServer(async (req, res) => {
    assert.equal(req.method, 'POST');
    assert.equal(req.url, '/v1/chat/completions');
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      choices: [{
        message: {
          role: 'assistant',
          content: '',
          tool_calls: [{
            id: 'call-1',
            type: 'function',
            function: {
              name: 'knowledge_base_search',
              arguments: JSON.stringify({ query: '退货规则' }),
            },
          }],
        },
      }],
    }));
  }, async ({ baseUrl, requests }) => {
    const result = await callOpenAICompatibleChatModel({
      provider: {
        provider: 'relay',
        baseUrl,
        credentialRef: 'env:SMART_FACTORY_TEST_KEY',
      },
      modelRequest: {
        model: { name: 'relay-chat' },
        systemPrompt: '你是售后助手。',
        messages: [{ role: 'user', content: '退货规则是什么' }],
        tools: [{
          type: 'function',
          name: 'knowledge_base_search',
          description: 'Search knowledge base',
          parameters: {
            type: 'object',
            properties: { query: { type: 'string' } },
            required: ['query'],
          },
        }],
      },
      env: { SMART_FACTORY_TEST_KEY: 'sk-real' },
    });

    assert.equal(requests.length, 1);
    assert.equal(requests[0].headers.authorization, 'Bearer sk-real');
    assert.equal(requests[0].body.model, 'relay-chat');
    assert.equal(requests[0].body.messages[0].role, 'system');
    assert.equal(requests[0].body.tools[0].function.name, 'knowledge_base_search');
    assert.deepEqual(result.toolCalls, [{
      id: 'call-1',
      name: 'knowledge_base_search',
      args: { query: '退货规则' },
    }]);
    assert.equal(result.content, '');
  });
});

test('tests OpenAI-compatible provider by issuing a real minimal chat request', async () => {
  await withJsonServer(async (req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      choices: [{ message: { role: 'assistant', content: 'ok' } }],
    }));
  }, async ({ baseUrl, requests }) => {
    const result = await testOpenAICompatibleModelProvider({
      provider: 'relay',
      baseUrl,
      credentialRef: 'env:SMART_FACTORY_TEST_KEY',
      models: [{ id: 'relay-chat', mode: 'chat' }],
    }, { env: { SMART_FACTORY_TEST_KEY: 'sk-real' } });

    assert.equal(result.ok, true);
    assert.match(result.message, /真实模型连接可用/);
    assert.equal(requests[0].body.model, 'relay-chat');
    assert.equal(requests[0].body.messages.at(-1).content, 'ping');
  });
});

test('tests provider from modelsText submitted by the configuration UI', async () => {
  await withJsonServer(async (req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      choices: [{ message: { role: 'assistant', content: 'ok' } }],
    }));
  }, async ({ baseUrl, requests }) => {
    const result = await testOpenAICompatibleModelProvider({
      provider: 'relay',
      baseUrl,
      credentialRef: 'env:SMART_FACTORY_TEST_KEY',
      modelsText: 'chat:relay-chat\nembedding:relay-embedding',
    }, { env: { SMART_FACTORY_TEST_KEY: 'sk-real' } });

    assert.equal(result.ok, true);
    assert.equal(requests[0].body.model, 'relay-chat');
  });
});

test('calls OpenAI-compatible embeddings endpoint for knowledge training', async () => {
  await withJsonServer(async (req, res) => {
    assert.equal(req.method, 'POST');
    assert.equal(req.url, '/v1/embeddings');
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      data: [
        { index: 0, embedding: [1, 0, 0] },
        { index: 1, embedding: [0, 1, 0] },
      ],
    }));
  }, async ({ baseUrl, requests }) => {
    const embeddings = await callOpenAICompatibleEmbeddingModel({
      provider: {
        provider: 'relay',
        baseUrl,
        credentialRef: 'env:SMART_FACTORY_TEST_KEY',
      },
      model: 'text-embedding-3-large',
      input: ['退货规则', '保修说明'],
      env: { SMART_FACTORY_TEST_KEY: 'sk-real' },
    });

    assert.equal(requests.length, 1);
    assert.equal(requests[0].headers.authorization, 'Bearer sk-real');
    assert.equal(requests[0].body.model, 'text-embedding-3-large');
    assert.deepEqual(requests[0].body.input, ['退货规则', '保修说明']);
    assert.deepEqual(embeddings, [[1, 0, 0], [0, 1, 0]]);
  });
});

test('openai_compatible provider falls back to global relay env when baseUrl/credentialRef are empty', async () => {
  await withJsonServer(async (req, res) => {
    assert.equal(req.url, '/v1/chat/completions');
    assert.equal(req.headers.authorization, 'Bearer sk-global-relay');
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: '好的' } }] }));
  }, async ({ baseUrl }) => {
    const hostRoot = baseUrl.replace(/\/v1$/, '');
    const result = await callOpenAICompatibleChatModel({
      provider: { provider: 'openai_compatible', baseUrl: '', credentialRef: '' },
      modelRequest: { model: { id: 'gpt-5.5' }, messages: [{ role: 'user', content: '你好' }] },
      env: {
        OPENAI_COMPATIBLE_BASE_URL: hostRoot,
        OPENAI_COMPATIBLE_API_KEY: 'sk-global-relay',
      },
    });
    assert.equal(result.content, '好的');
  });
});

test('openai_compatible provider keeps its own baseUrl/credentialRef when explicitly configured', async () => {
  await withJsonServer(async (req, res) => {
    assert.equal(req.headers.authorization, 'Bearer sk-own-key');
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'own' } }] }));
  }, async ({ baseUrl }) => {
    const result = await callOpenAICompatibleChatModel({
      provider: { provider: 'openai_compatible', baseUrl, credentialRef: 'env:OWN_KEY' },
      modelRequest: { model: { id: 'gpt-5.5' }, messages: [{ role: 'user', content: 'hi' }] },
      env: {
        OWN_KEY: 'sk-own-key',
        OPENAI_COMPATIBLE_BASE_URL: 'http://should-not-be-used.invalid',
        OPENAI_COMPATIBLE_API_KEY: 'sk-should-not-be-used',
      },
    });
    assert.equal(result.content, 'own');
  });
});

test('custom providers never fall back to global relay env (misconfig must fail loudly)', async () => {
  await assert.rejects(
    callOpenAICompatibleChatModel({
      provider: { provider: 'acceptance-relay', baseUrl: '', credentialRef: '' },
      modelRequest: { model: { id: 'acceptance-chat' }, messages: [{ role: 'user', content: 'hi' }] },
      env: {
        OPENAI_COMPATIBLE_BASE_URL: 'http://should-not-be-used.invalid',
        OPENAI_COMPATIBLE_API_KEY: 'sk-should-not-be-used',
      },
    }),
    /缺少 Base URL/,
  );
});
