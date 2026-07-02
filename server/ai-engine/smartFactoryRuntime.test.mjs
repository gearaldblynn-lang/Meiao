import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildSmartFactoryModelRequest,
  createSmartFactoryRunContext,
  executeSmartFactoryToolCall,
  runSmartFactoryTurn,
} from './smartFactoryRuntime.mjs';

const modelCatalog = [{
  provider: 'openai_compatible',
  models: [{ id: 'gpt-5.5', mode: 'chat', features: ['tool-call'] }],
}];

test('builds a safe model request with knowledge and authorized cli tools', () => {
  const request = buildSmartFactoryModelRequest({
    agentConfig: {
      prompt: { system_prompt: '你是电商运营智能体' },
      model: {
        plugin_id: 'openai-compatible',
        model_provider: 'openai_compatible',
        model: 'gpt-5.5',
        credential_ref: { id: 'cred-1', value: 'sk-secret' },
      },
      knowledge: { datasets: [{ id: 'kb-1', name: '售后知识库' }] },
      tools: {
        cli_tools: [{
          name: 'feishu_create_sheet',
          description: '创建飞书表格',
          invoke_metadata: {
            parameters: {
              type: 'object',
              properties: { title: { type: 'string' } },
              required: ['title'],
              additionalProperties: false,
            },
          },
          authorization_status: 'authorized',
          risk_level: 'safe',
        }, {
          name: 'dangerous_shell',
          description: '不应暴露',
          authorization_status: 'authorized',
          risk_level: 'dangerous',
        }],
      },
    },
    modelCatalog,
    messages: [{ role: 'user', content: '创建日报表' }],
  });

  assert.equal(request.model.provider, 'openai_compatible');
  assert.equal(request.model.name, 'gpt-5.5');
  assert.equal(request.systemPrompt, '你是电商运营智能体');
  assert.deepEqual(
    request.tools.map((tool) => tool.name),
    ['knowledge_base_search', 'feishu_create_sheet'],
  );
  assert.deepEqual(request.tools[1].parameters.required, ['title']);
  assert.equal(JSON.stringify(request).includes('sk-secret'), false);
});

test('builds model-visible image and video tools from builtin media tools', () => {
  const request = buildSmartFactoryModelRequest({
    agentConfig: {
      prompt: { system_prompt: '你是视觉生产智能体' },
      model: {
        plugin_id: 'openai-compatible',
        model_provider: 'openai_compatible',
        model: 'gpt-5.5',
      },
      tools: {
        builtin_tools: [{
          name: 'generate_image',
          description: '生成或编辑图片',
          executorRef: 'media.generate_image',
          capability: 'image',
          modelProvider: 'kie',
          model: 'gpt-image-2',
          authorization_status: 'authorized',
          risk_level: 'safe',
          invoke_metadata: {
            parameters: {
              type: 'object',
              properties: { prompt: { type: 'string' } },
              required: ['prompt'],
              additionalProperties: false,
            },
          },
        }, {
          name: 'generate_video',
          description: '生成视频',
          executorRef: 'media.generate_video',
          capability: 'video',
          modelProvider: 'kie',
          model: 'veo3_fast',
          authorization_status: 'authorized',
          risk_level: 'safe',
          invoke_metadata: {
            parameters: {
              type: 'object',
              properties: { prompt: { type: 'string' } },
              required: ['prompt'],
              additionalProperties: true,
            },
          },
        }, {
          name: 'generate_seedance_fast_video',
          description: 'Seedance Fast 视频',
          executorRef: 'media.generate_video',
          capability: 'video',
          modelProvider: 'kie',
          model: 'bytedance/seedance-2-fast',
          authorization_status: 'authorized',
          risk_level: 'safe',
          invoke_metadata: {
            parameters: {
              type: 'object',
              properties: { prompt: { type: 'string' } },
              required: ['prompt'],
              additionalProperties: true,
            },
          },
        }],
      },
    },
    modelCatalog,
    messages: [{ role: 'user', content: '生成一张商品主图' }],
  });

  assert.deepEqual(
    request.tools.map((tool) => tool.name),
    ['generate_image', 'generate_video', 'generate_seedance_fast_video'],
  );
  assert.equal(request.trace.builtinToolCount, 3);
  assert.equal(request.tools[0].parameters.required[0], 'prompt');
});

test('executes knowledge_base_search against configured datasets only', async () => {
  const context = createSmartFactoryRunContext({
    agentConfig: {
      prompt: { system_prompt: '你是售后助手' },
      model: {
        plugin_id: 'openai-compatible',
        model_provider: 'openai_compatible',
        model: 'gpt-5.5',
      },
      knowledge: { datasets: [{ id: 'kb-1', name: '售后知识库' }] },
    },
    modelCatalog,
    knowledgeChunks: [
      { knowledgeBaseId: 'kb-1', title: '退货规则', content: '签收后 7 天内可以申请退货。' },
      { knowledgeBaseId: 'kb-2', title: '内部规则', content: '这段不应该被智能体看到。' },
    ],
    searchKnowledge: (query, chunks) => chunks.filter((chunk) => String(chunk.content).includes(query)),
  });

  const result = await executeSmartFactoryToolCall({
    context,
    toolCall: {
      name: 'knowledge_base_search',
      args: { query: '退货' },
    },
  });

  assert.equal(result.name, 'knowledge_base_search');
  assert.match(result.observation, /退货规则/);
  assert.match(result.observation, /签收后 7 天内可以申请退货/);
  assert.doesNotMatch(result.observation, /这段不应该被智能体看到/);
});

test('passes dataset retrieval policy into knowledge search tool execution', async () => {
  const seenOptions = [];
  const context = createSmartFactoryRunContext({
    agentConfig: {
      prompt: { system_prompt: '你是售后助手' },
      model: {
        plugin_id: 'openai-compatible',
        model_provider: 'openai_compatible',
        model: 'gpt-5.5',
      },
      knowledge: {
        datasets: [{
          id: 'kb-1',
          name: '售后知识库',
          retrievalPolicy: { topK: 1, similarityThreshold: 0.1, maxContextChars: 800 },
        }],
      },
    },
    modelCatalog,
    knowledgeChunks: [
      { knowledgeBaseId: 'kb-1', title: '退货规则', content: '签收后 7 天内可以申请退货。' },
    ],
    searchKnowledge: (query, chunks, options) => {
      seenOptions.push(options);
      return chunks;
    },
  });

  await executeSmartFactoryToolCall({
    context,
    toolCall: {
      name: 'knowledge_base_search',
      args: { query: '退货' },
    },
  });

  assert.deepEqual(seenOptions[0], {
    datasets: ['kb-1'],
    topK: 1,
    similarityThreshold: 0.1,
    maxContextChars: 800,
  });
});

test('executes only registered safe cli tools and returns observation text', async () => {
  const context = createSmartFactoryRunContext({
    agentConfig: {
      prompt: { system_prompt: '你是自动化助手' },
      model: {
        plugin_id: 'openai-compatible',
        model_provider: 'openai_compatible',
        model: 'gpt-5.5',
      },
      tools: {
        cli_tools: [{
          name: 'feishu_create_sheet',
          description: '创建飞书表格',
          authorization_status: 'authorized',
          risk_level: 'safe',
        }, {
          name: 'dangerous_shell',
          description: '危险工具',
          authorization_status: 'authorized',
          risk_level: 'dangerous',
        }],
      },
    },
    modelCatalog,
    cliToolExecutors: {
      feishu_create_sheet: async ({ args }) => [
        { type: 'link', message: { text: `https://feishu.example/sheets/${args.title}` } },
      ],
      dangerous_shell: async () => [
        { type: 'text', message: { text: 'should not run' } },
      ],
    },
  });

  const result = await executeSmartFactoryToolCall({
    context,
    toolCall: { name: 'feishu_create_sheet', args: { title: '日报' } },
  });

  assert.match(result.observation, /result link: https:\/\/feishu\.example\/sheets\/日报/);
  await assert.rejects(
    () => executeSmartFactoryToolCall({
      context,
      toolCall: { name: 'dangerous_shell', args: {} },
    }),
    /Unknown Smart Factory tool: dangerous_shell/,
  );
});

test('executes registered builtin media tools through executor map', async () => {
  const context = createSmartFactoryRunContext({
    agentConfig: {
      prompt: { system_prompt: '你是视觉生产智能体' },
      model: {
        plugin_id: 'openai-compatible',
        model_provider: 'openai_compatible',
        model: 'gpt-5.5',
      },
      tools: {
        builtin_tools: [{
          name: 'generate_image',
          description: '生成图片',
          executorRef: 'media.generate_image',
          capability: 'image',
          modelProvider: 'kie',
          model: 'gpt-image-2',
          authorization_status: 'authorized',
          risk_level: 'safe',
        }],
      },
    },
    modelCatalog,
    builtinToolExecutors: {
      generate_image: async ({ args, tool }) => [
        { type: 'link', message: { text: `https://img.example/${tool.model}/${encodeURIComponent(args.prompt)}.png` } },
      ],
    },
  });

  const result = await executeSmartFactoryToolCall({
    context,
    toolCall: { name: 'generate_image', args: { prompt: '白底商品图' } },
  });

  assert.equal(result.name, 'generate_image');
  assert.match(result.observation, /https:\/\/img\.example\/gpt-image-2/);
  assert.equal(result.trace.executorRef, 'media.generate_image');
  assert.equal(result.trace.modelProvider, 'kie');
  assert.equal(result.trace.modelName, 'gpt-image-2');
});

test('runs one smart factory turn with tool execution trace', async () => {
  const result = await runSmartFactoryTurn({
    agentConfig: {
      prompt: { system_prompt: '你是售后助手' },
      model: {
        plugin_id: 'openai-compatible',
        model_provider: 'openai_compatible',
        model: 'gpt-5.5',
      },
      knowledge: { datasets: [{ id: 'kb-1', name: '售后知识库' }] },
    },
    modelCatalog,
    messages: [{ role: 'user', content: '退货规则是什么' }],
    knowledgeChunks: [
      { knowledgeBaseId: 'kb-1', title: '退货规则', content: '签收后 7 天内可以申请退货。' },
    ],
    searchKnowledge: (query, chunks) => chunks.filter((chunk) => String(chunk.content).includes(query)),
    callModel: async (request) => {
      assert.equal(request.model.name, 'gpt-5.5');
      assert.deepEqual(request.tools.map((tool) => tool.name), ['knowledge_base_search']);
      return {
        content: '',
        toolCalls: [{ name: 'knowledge_base_search', args: { query: '退货' } }],
      };
    },
  });

  assert.deepEqual(result.trace.map((item) => item.event), [
    'model_request_built',
    'model_response_received',
    'tool_call_started',
    'tool_call_completed',
  ]);
  assert.match(result.toolResults[0].observation, /签收后 7 天内可以申请退货/);
});
