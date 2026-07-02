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
