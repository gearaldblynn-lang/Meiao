import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import { runSmartFactoryPreviewTurn, testSmartFactoryKnowledgeSearch } from './smartFactoryPreview.mjs';
import { getSmartFactoryPreviewConfig } from './smartFactoryPreview.mjs';
import {
  createDefaultSmartFactoryConfig,
  createSmartFactoryAgent,
  normalizeSmartFactoryConfig,
  upsertSmartFactoryModelProvider,
  updateSmartFactoryKnowledgeBase,
} from './smartFactoryConfigStore.mjs';

const withSmartFactoryModelServer = async (reply, run) => {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const bodyText = Buffer.concat(chunks).toString('utf8');
    const body = bodyText ? JSON.parse(bodyText) : {};
    requests.push({ method: req.method, url: req.url, headers: req.headers, body });
    const payload = typeof reply === 'function' ? reply({ req, body }) : reply;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(payload));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  try {
    await run({ baseUrl: `http://127.0.0.1:${address.port}/v1`, requests });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
};

const createConfiguredModelConfig = (baseUrl) => upsertSmartFactoryModelProvider(createDefaultSmartFactoryConfig(), {
  provider: 'openai_compatible',
  displayName: '测试中转',
  baseUrl,
  credentialRef: 'env:SMART_FACTORY_TEST_KEY',
  models: [{ id: 'gpt-5.5', mode: 'chat', features: ['tool-call'] }],
  defaultModel: 'gpt-5.5',
});

test('smart factory preview exposes model knowledge and tool configuration', () => {
  const config = getSmartFactoryPreviewConfig();

  assert.equal(config.mode, 'production');
  assert.deepEqual(config.models.map((item) => item.name), ['gpt-5.5']);
  assert.deepEqual(config.knowledgeBases.map((item) => item.name), ['售后知识库']);
  assert.deepEqual(config.tools.map((item) => item.name), ['feishu_create_sheet', 'generate_image', 'generate_video', 'generate_seedance_fast_video']);
  assert.deepEqual(config.agents.map((item) => item.name), ['售后智能体']);
  assert.deepEqual(config.sessions.map((item) => item.title), ['售后试运行']);
  assert.equal(JSON.stringify(config).includes('sk-'), false);
});

test('smart factory preview config is derived from smart factory config store shape', () => {
  const config = getSmartFactoryPreviewConfig({
    smartFactoryConfig: {
      modelProviders: [{
        provider: 'relay-a',
        credentialRef: 'env:SMART_FACTORY_RELAY_A_KEY',
        models: [{ id: 'relay-model', mode: 'chat', features: ['tool-call'] }],
      }],
      knowledgeBases: [{
        id: 'kb-custom',
        name: '自定义知识库',
        documents: [
          { id: 'doc-a', title: '文档 A', content: '内容 A' },
          { id: 'doc-b', title: '文档 B', content: '内容 B' },
        ],
      }],
      tools: [{
        name: 'custom_cli_tool',
        type: 'cli',
        description: '自定义 CLI 工具',
        authorization_status: 'authorized',
        risk_level: 'safe',
      }],
    },
  });

  assert.deepEqual(config.models, [{
    provider: 'relay-a',
    name: 'relay-model',
    mode: 'chat',
    features: ['tool-call'],
  }]);
  assert.equal(config.knowledgeBases[0].id, 'kb-custom');
  assert.equal(config.knowledgeBases[0].name, '自定义知识库');
  assert.equal(config.knowledgeBases[0].documentCount, 2);
  assert.deepEqual(config.knowledgeBases[0].documents.map((item) => item.title), ['文档 A', '文档 B']);
  assert.deepEqual(config.tools.map((item) => item.name), ['custom_cli_tool']);
  assert.equal(JSON.stringify(config).includes('SMART_FACTORY_RELAY_A_KEY'), false);
});

test('smart factory preview runs knowledge search through ai-engine runtime', async () => {
  await withSmartFactoryModelServer({
    choices: [{
      message: {
        role: 'assistant',
        content: '',
        tool_calls: [{
          id: 'call-kb',
          type: 'function',
          function: {
            name: 'knowledge_base_search',
            arguments: JSON.stringify({ query: '退货规则是什么' }),
          },
        }],
      },
    }],
  }, async ({ baseUrl, requests }) => {
    const result = await runSmartFactoryPreviewTurn({
      message: '退货规则是什么',
      smartFactoryConfig: createConfiguredModelConfig(baseUrl),
      env: { SMART_FACTORY_TEST_KEY: 'sk-real' },
    });

    assert.equal(requests.length, 1);
    assert.equal(result.mode, 'production');
    assert.deepEqual(result.trace.map((item) => item.event), [
      'model_request_built',
      'model_response_received',
      'tool_call_started',
      'tool_call_completed',
    ]);
    assert.equal(result.toolResults[0].name, 'knowledge_base_search');
    assert.match(result.toolResults[0].observation, /签收后 7 天内可以申请退货/);
    assert.equal(JSON.stringify(result).includes('sk-'), false);
  });
});

test('smart factory preview uses trained embeddings for knowledge tool retrieval', async () => {
  await withSmartFactoryModelServer(({ req, body }) => {
    if (req.url === '/v1/embeddings') {
      return {
        data: body.input.map((_, index) => ({ index, embedding: [0.9, 0.1, 0] })),
      };
    }
    return {
      choices: [{
        message: {
          role: 'assistant',
          content: '',
          tool_calls: [{
            id: 'call-kb',
            type: 'function',
            function: {
              name: 'knowledge_base_search',
              arguments: JSON.stringify({ query: '售后怎么处理' }),
            },
          }],
        },
      }],
    };
  }, async ({ baseUrl, requests }) => {
    const config = normalizeSmartFactoryConfig({
      modelProviders: [{
        provider: 'openai_compatible',
        baseUrl,
        credentialRef: 'env:SMART_FACTORY_TEST_KEY',
        models: [
          { id: 'gpt-5.5', mode: 'chat', features: ['tool-call'] },
          { id: 'text-embedding-3-large', mode: 'embedding', features: ['embedding'] },
        ],
      }],
      knowledgeBases: [{
        id: 'kb-vector',
        name: '向量知识库',
        embeddingModel: { provider: 'openai_compatible', model: 'text-embedding-3-large' },
        retrievalPolicy: { topK: 1, similarityThreshold: 0.1 },
        documents: [{
          id: 'doc-vector',
          title: '退货规则',
          content: '签收后 7 天内可以申请退货。',
          chunks: [{
            id: 'doc-vector-chunk-1',
            content: '签收后 7 天内可以申请退货。',
            embedding: [1, 0, 0],
          }],
        }, {
          id: 'doc-warranty',
          title: '保修说明',
          content: '电器类商品支持一年保修。',
          chunks: [{
            id: 'doc-warranty-chunk-1',
            content: '电器类商品支持一年保修。',
            embedding: [0, 1, 0],
          }],
        }],
      }],
      tools: [],
      agents: [{
        id: 'agent-vector',
        name: '向量智能体',
        prompt: '只根据知识库回答。',
        model: { provider: 'openai_compatible', model: 'gpt-5.5' },
        knowledgeBaseIds: ['kb-vector'],
        enabled: true,
        status: 'published',
      }],
      sessions: [],
    });
    const result = await runSmartFactoryPreviewTurn({
      message: '售后怎么处理',
      agentId: 'agent-vector',
      smartFactoryConfig: config,
      env: { SMART_FACTORY_TEST_KEY: 'sk-real' },
    });

    assert.equal(requests.map((request) => request.url).includes('/v1/embeddings'), true);
    assert.equal(requests.find((request) => request.url === '/v1/embeddings').body.model, 'text-embedding-3-large');
    assert.match(result.toolResults[0].observation, /签收后 7 天内可以申请退货/);
    assert.doesNotMatch(result.toolResults[0].observation, /一年保修/);
    assert.equal(result.citations[0].scoreType, 'vector');
  });
});

test('smart factory chat fails when no real model endpoint is configured', async () => {
  await assert.rejects(
    () => runSmartFactoryPreviewTurn({
      message: '退货规则是什么',
      smartFactoryConfig: createDefaultSmartFactoryConfig(),
      env: {},
    }),
    /Base URL|API Key/,
  );
});

test('smart factory chat calls configured OpenAI-compatible provider and returns model content', async () => {
  await withSmartFactoryModelServer({
    choices: [{ message: { role: 'assistant', content: '真实模型回答' } }],
  }, async ({ baseUrl, requests }) => {
    const result = await runSmartFactoryPreviewTurn({
      message: '直接回答',
      smartFactoryConfig: createConfiguredModelConfig(baseUrl),
      env: { SMART_FACTORY_TEST_KEY: 'sk-real' },
    });

    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, '/v1/chat/completions');
    assert.equal(requests[0].headers.authorization, 'Bearer sk-real');
    assert.equal(requests[0].body.model, 'gpt-5.5');
    assert.equal(result.answer, '真实模型回答');
    assert.equal(result.trace.some((item) => item.event === 'model_response_received'), true);
  });
});

test('smart factory preview runs registered Feishu cli-style tool only through whitelist', async () => {
  const script = [
    'const chunks=[];',
    'process.stdin.on("data",c=>chunks.push(c));',
    'process.stdin.on("end",()=>{',
    'const input=JSON.parse(Buffer.concat(chunks).toString("utf8"));',
    'process.stdout.write(JSON.stringify({url:`https://feishu.test/sheets/${encodeURIComponent(input.args.title)}`}));',
    '});',
  ].join('');
  await withSmartFactoryModelServer({
    choices: [{
      message: {
        role: 'assistant',
        content: '',
        tool_calls: [{
          id: 'call-feishu',
          type: 'function',
          function: {
            name: 'feishu_create_sheet',
            arguments: JSON.stringify({ title: '日报' }),
          },
        }],
      },
    }],
  }, async ({ baseUrl, requests }) => {
    const result = await runSmartFactoryPreviewTurn({
      message: '帮我创建飞书日报表格',
      smartFactoryConfig: createConfiguredModelConfig(baseUrl),
      env: {
        SMART_FACTORY_TEST_KEY: 'sk-real',
        SMART_FACTORY_CLI_FEISHU_CREATE_SHEET_COMMAND: JSON.stringify([process.execPath, '-e', script]),
      },
    });

    assert.equal(requests.length, 1);
    assert.equal(result.toolResults[0].name, 'feishu_create_sheet');
    assert.match(result.toolResults[0].observation, /result link: https:\/\/feishu\.test\/sheets/);
    assert.deepEqual(result.modelRequest.tools.map((tool) => tool.name), [
      'knowledge_base_search',
      'feishu_create_sheet',
      'generate_image',
      'generate_video',
      'generate_seedance_fast_video',
    ]);
  });
});

test('smart factory preview records selected model provider in trace', async () => {
  await withSmartFactoryModelServer({
    choices: [{ message: { role: 'assistant', content: 'ok' } }],
  }, async ({ baseUrl }) => {
    const result = await runSmartFactoryPreviewTurn({
      message: '退货规则是什么',
      smartFactoryConfig: createConfiguredModelConfig(baseUrl),
      env: { SMART_FACTORY_TEST_KEY: 'sk-real' },
    });

    assert.equal(result.trace[0].modelProvider, 'openai_compatible');
    assert.equal(result.trace[0].modelName, 'gpt-5.5');
  });
});

test('smart factory chat rejects draft agents for production use', async () => {
  const config = createSmartFactoryAgent(createDefaultSmartFactoryConfig(), {
    name: '草稿助手',
    prompt: '草稿不可被正式调用。',
  });
  const draft = config.agents.find((agent) => agent.name === '草稿助手');

  await assert.rejects(
    () => runSmartFactoryPreviewTurn({
      message: '退货规则是什么',
      agentId: draft.id,
      smartFactoryConfig: config,
    }),
    /智能体尚未发布/,
  );
});

test('smart factory chat returns citations and run log metadata', async () => {
  await withSmartFactoryModelServer({
    choices: [{
      message: {
        role: 'assistant',
        content: '',
        tool_calls: [{
          id: 'call-kb',
          type: 'function',
          function: {
            name: 'knowledge_base_search',
            arguments: JSON.stringify({ query: '退货规则是什么' }),
          },
        }],
      },
    }],
  }, async ({ baseUrl }) => {
    const result = await runSmartFactoryPreviewTurn({
      message: '退货规则是什么',
      smartFactoryConfig: createConfiguredModelConfig(baseUrl),
      env: { SMART_FACTORY_TEST_KEY: 'sk-real' },
    });

    assert.equal(result.citations.some((item) => item.title === '退货规则'), true);
    assert.equal(result.runLog.agentId, 'agent-after-sale');
    assert.equal(result.runLog.modelProvider, 'openai_compatible');
    assert.equal(result.runLog.knowledgeRefs.length > 0, true);
    assert.deepEqual(result.runLog.toolCalls, ['knowledge_base_search']);
  });
});

test('smart factory knowledge search tests retrieval without chat turn', () => {
  const result = testSmartFactoryKnowledgeSearch({
    query: '换货',
    knowledgeBaseIds: ['kb-after-sale'],
    smartFactoryConfig: createDefaultSmartFactoryConfig(),
  });

  assert.equal(result.query, '换货');
  assert.equal(result.results.some((item) => item.title === '换货规则'), true);
});

test('smart factory knowledge search honors retrieval parameters', () => {
  const config = updateSmartFactoryKnowledgeBase(createDefaultSmartFactoryConfig(), 'kb-after-sale', {
    retrievalPolicy: { topK: 1, similarityThreshold: 4 },
  });
  const result = testSmartFactoryKnowledgeSearch({
    query: '退货 原包装',
    knowledgeBaseIds: ['kb-after-sale'],
    retrievalPolicy: { topK: 1, similarityThreshold: 4 },
    smartFactoryConfig: config,
  });

  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].title, '退货规则');
  assert.equal(result.results[0].chunkId, 'doc-return-policy-chunk-1');
});
