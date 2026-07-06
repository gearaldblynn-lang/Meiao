import test from 'node:test';
import assert from 'node:assert/strict';

import {
  addSmartFactoryKnowledgeDocument,
  createSmartFactoryAgent,
  createSmartFactoryKnowledgeBase,
  createDefaultSmartFactoryConfig,
  deleteSmartFactoryAgent,
  deleteSmartFactoryKnowledgeBase,
  deleteSmartFactoryKnowledgeDocument,
  deleteSmartFactoryModelProvider,
  deleteSmartFactoryTool,
  getSmartFactoryPublicConfig,
  getSmartFactoryModelProviderPresets,
  mergeSmartFactoryConfigUpdate,
  normalizeSmartFactoryConfig,
  publishSmartFactoryAgent,
  retrainSmartFactoryKnowledgeDocument,
  toSmartFactoryRuntimeInputs,
  updateSmartFactoryAgent,
  updateSmartFactoryKnowledgeBase,
  upsertSmartFactoryModelProvider,
  upsertSmartFactoryTool,
} from './smartFactoryConfigStore.mjs';

test('creates default smart factory config with model knowledge base and CLI tool', () => {
  const config = createDefaultSmartFactoryConfig();

  assert.deepEqual(config.modelProviders.map((item) => item.provider), ['openai_compatible']);
  assert.deepEqual(config.modelProviders[0].models.map((item) => item.id), ['gpt-5.5']);
  assert.deepEqual(config.knowledgeBases.map((item) => item.name), ['售后知识库']);
  assert.equal(config.knowledgeBases[0].documents.length, 2);
  assert.deepEqual(config.tools.map((item) => item.name), ['feishu_create_sheet', 'generate_image', 'generate_video', 'generate_seedance_fast_video']);
  assert.equal(config.tools[0].type, 'cli');
  assert.equal(config.tools[1].type, 'builtin');
  assert.equal(config.tools[1].executorRef, 'media.generate_image');
  assert.equal(config.tools[2].executorRef, 'media.generate_video');
  assert.equal(config.tools[3].model, 'bytedance/seedance-2-fast');
  assert.deepEqual(config.agents.map((item) => item.name), ['售后智能体']);
  assert.deepEqual(config.agents[0].variables.map((item) => item.key), ['order_id']);
  assert.equal(config.agents[0].vision.enabled, false);
  assert.equal(config.sessions[0].agentId, config.agents[0].id);
});

test('normalizes smart factory config and strips secret-like fields', () => {
  const config = normalizeSmartFactoryConfig({
    modelProviders: [{
      provider: ' openai_compatible ',
      credentialRef: ' env:OPENAI_COMPATIBLE_API_KEY ',
      apiKey: 'sk-should-never-leak',
      models: [
        { id: ' gpt-5.5 ', mode: ' chat ', features: ['tool-call', ''] },
        { id: '', mode: 'chat' },
      ],
    }],
    knowledgeBases: [{
      id: ' kb-1 ',
      name: ' 售后知识库 ',
      documents: [
        { id: ' doc-1 ', title: ' 退货规则 ', content: ' 7 天内可退货 ' },
        { id: '', title: '空文档', content: '会被丢弃' },
      ],
    }],
    tools: [
      {
        name: ' feishu_create_sheet ',
        type: 'cli',
        description: ' 创建飞书表格 ',
        authorization_status: 'authorized',
        risk_level: 'safe',
        apiKey: 'sk-tool-secret',
      },
      { name: '', type: 'cli' },
    ],
  });

  assert.deepEqual(config.modelProviders[0], {
    provider: 'openai_compatible',
    displayName: 'openai_compatible',
    credentialRef: 'env:OPENAI_COMPATIBLE_API_KEY',
    models: [{ id: 'gpt-5.5', mode: 'chat', features: ['tool-call'] }],
  });
  assert.equal(config.knowledgeBases[0].documents[0].id, 'doc-1');
  assert.equal(config.knowledgeBases[0].documents[0].title, '退货规则');
  assert.equal(config.knowledgeBases[0].documents[0].sourceType, 'text');
  assert.equal(config.knowledgeBases[0].documents[0].content, '7 天内可退货');
  assert.equal(config.knowledgeBases[0].documents[0].status, 'ready');
  assert.equal(config.knowledgeBases[0].documents[0].chunkCount, 1);
  assert.deepEqual(config.knowledgeBases[0].documents[0].chunks, [{
    id: 'doc-1-chunk-1',
    knowledgeBaseId: 'kb-1',
    documentId: 'doc-1',
    title: '退货规则',
    sourceType: 'text',
    content: '7 天内可退货',
    chunkIndex: 0,
    index: 0,
  }]);
  assert.deepEqual(config.tools.map((item) => item.name), ['feishu_create_sheet', 'generate_image', 'generate_video', 'generate_seedance_fast_video']);
  assert.equal(config.tools.find((item) => item.name === 'generate_image').type, 'builtin');
  assert.equal(config.mediaToolsVersion, 2);
  assert.equal(config.mediaToolsMigrated, true);
  assert.equal(JSON.stringify(config).includes('sk-'), false);
  assert.equal(JSON.stringify(config).includes('apiKey'), false);
});

test('preserves explicit empty smart factory tools after media tool migration marker', () => {
  const config = normalizeSmartFactoryConfig({
    mediaToolsMigrated: true,
    mediaToolsVersion: 2,
    tools: [],
    agents: [{
      id: 'agent-no-tools',
      name: '无工具智能体',
      model: { provider: 'openai_compatible', model: 'gpt-5.5' },
      toolNames: [],
      enabled: true,
      status: 'published',
    }],
  });

  assert.deepEqual(config.tools, []);
  assert.deepEqual(toSmartFactoryRuntimeInputs(config, { agentId: 'agent-no-tools' }).agentConfig.tools.cli_tools, []);
  assert.deepEqual(toSmartFactoryRuntimeInputs(config, { agentId: 'agent-no-tools' }).agentConfig.tools.builtin_tools, []);
});

test('migrates seedance fast tool for previous media tool configs without restoring deleted tools', () => {
  const config = normalizeSmartFactoryConfig({
    mediaToolsMigrated: true,
    mediaToolsVersion: 1,
    tools: [{
      name: 'feishu_create_sheet',
      type: 'cli',
      enabled: true,
      executorRef: 'feishu.create_sheet',
      authorization_status: 'authorized',
      risk_level: 'safe',
    }, {
      name: 'generate_video',
      type: 'builtin',
      enabled: true,
      executorRef: 'media.generate_video',
      modelProvider: 'kie',
      model: 'veo3_fast',
      authorization_status: 'authorized',
      risk_level: 'safe',
    }],
    agents: [{
      id: 'agent-after-sale',
      name: '售后智能体',
      model: { provider: 'openai_compatible', model: 'gpt-5.5' },
      toolNames: ['feishu_create_sheet', 'generate_video'],
      enabled: true,
      status: 'published',
    }],
  });

  assert.deepEqual(config.tools.map((tool) => tool.name), [
    'feishu_create_sheet',
    'generate_video',
    'generate_seedance_fast_video',
  ]);
  assert.equal(config.tools.some((tool) => tool.name === 'generate_image'), false);
  assert.deepEqual(config.agents[0].toolNames, ['feishu_create_sheet', 'generate_video', 'generate_seedance_fast_video']);
});

test('converts smart factory config to runtime inputs compatible with ai-engine runtime', () => {
  const runtimeInputs = toSmartFactoryRuntimeInputs(createDefaultSmartFactoryConfig());

  assert.deepEqual(runtimeInputs.modelCatalog, [{
    provider: 'openai_compatible',
    models: [{ id: 'gpt-5.5', mode: 'chat', features: ['tool-call'] }],
  }]);
  assert.equal(runtimeInputs.agentConfig.model.model_provider, 'openai_compatible');
  assert.equal(runtimeInputs.agentConfig.model.model, 'gpt-5.5');
  assert.equal(runtimeInputs.agentConfig.knowledge.datasets[0].id, 'kb-after-sale');
  assert.equal(runtimeInputs.agentConfig.knowledge.datasets[0].name, '售后知识库');
  assert.deepEqual(runtimeInputs.agentConfig.knowledge.datasets[0].retrievalPolicy, {
    topK: 3,
    similarityThreshold: 0.3,
    maxContextChars: 2400,
  });
  assert.deepEqual(runtimeInputs.agentConfig.tools.cli_tools.map((item) => item.name), ['feishu_create_sheet']);
  assert.deepEqual(runtimeInputs.agentConfig.variables.map((item) => item.key), ['order_id']);
  assert.equal(runtimeInputs.agentConfig.vision.enabled, false);
  assert.deepEqual(runtimeInputs.knowledgeChunks.map((item) => item.title), ['退货规则', '换货规则']);
  assert.equal(runtimeInputs.selectedAgent.name, '售后智能体');
  assert.equal(typeof runtimeInputs.cliToolExecutors.feishu_create_sheet, 'function');
});

test('runtime inputs honor selected agent bindings for model knowledge and tools', () => {
  const runtimeInputs = toSmartFactoryRuntimeInputs({
    modelProviders: [
      { provider: 'relay-a', models: [{ id: 'model-a', mode: 'chat', enabled: true }] },
      { provider: 'relay-b', models: [{ id: 'model-b', mode: 'chat', enabled: true }] },
    ],
    knowledgeBases: [
      { id: 'kb-a', name: 'A 库', documents: [{ id: 'doc-a', title: 'A 文档', content: 'A 内容' }] },
      { id: 'kb-b', name: 'B 库', documents: [{ id: 'doc-b', title: 'B 文档', content: 'B 内容' }] },
    ],
    tools: [
      { name: 'feishu_create_sheet', type: 'cli', enabled: true, riskLevel: 'safe', executorRef: 'feishu.create_sheet' },
      { name: 'other_tool', type: 'cli', enabled: true, riskLevel: 'safe', executorRef: 'feishu.create_sheet' },
    ],
    agents: [{
      id: 'agent-b',
      name: 'B 助手',
    prompt: '只用 B 库',
    model: { provider: 'relay-b', model: 'model-b' },
    knowledgeBaseIds: ['kb-b'],
    toolNames: ['feishu_create_sheet'],
    variables: [{ key: 'sku', label: 'SKU', type: 'text', required: true }],
    metadataFilters: [{ key: 'category', operator: 'contains', value: '售后' }],
    vision: { enabled: true, transferMethods: ['local_file'], imageFileSizeLimit: 12 },
    enabled: true,
    }],
    sessions: [{ id: 'session-b', agentId: 'agent-b', title: 'B 会话', messages: [] }],
  }, { agentId: 'agent-b' });

  assert.equal(runtimeInputs.agentConfig.model.model_provider, 'relay-b');
  assert.equal(runtimeInputs.agentConfig.model.model, 'model-b');
  assert.equal(runtimeInputs.agentConfig.knowledge.datasets[0].id, 'kb-b');
  assert.equal(runtimeInputs.agentConfig.knowledge.datasets[0].name, 'B 库');
  assert.deepEqual(runtimeInputs.agentConfig.knowledge.datasets[0].retrievalPolicy, {
    topK: 3,
    similarityThreshold: 0.3,
    maxContextChars: 2400,
  });
  assert.deepEqual(runtimeInputs.knowledgeChunks.map((item) => item.documentId), ['doc-b']);
  assert.deepEqual(runtimeInputs.agentConfig.tools.cli_tools.map((item) => item.name), ['feishu_create_sheet']);
  assert.deepEqual(runtimeInputs.agentConfig.variables, [{ key: 'sku', label: 'SKU', type: 'text', required: true, defaultValue: '' }]);
  assert.deepEqual(runtimeInputs.agentConfig.metadataFilters, [{ key: 'category', operator: 'contains', value: '售后' }]);
  assert.equal(runtimeInputs.agentConfig.vision.imageFileSizeLimit, 12);
});

test('merges smart factory config updates without accepting secret fields', () => {
  const current = createDefaultSmartFactoryConfig();
  const next = mergeSmartFactoryConfigUpdate(current, {
    modelProviders: [{
      provider: 'relay-b',
      credentialRef: 'env:RELAY_B_KEY',
      apiKey: 'sk-update-secret',
      models: [{ id: 'relay-b-model', mode: 'chat', features: ['tool-call'] }],
    }],
  });

  assert.deepEqual(next.modelProviders, [{
    provider: 'relay-b',
    displayName: 'relay-b',
    credentialRef: 'env:RELAY_B_KEY',
    models: [{ id: 'relay-b-model', mode: 'chat', features: ['tool-call'] }],
  }]);
  assert.deepEqual(next.knowledgeBases.map((item) => item.name), ['售后知识库']);
  assert.deepEqual(next.tools.map((item) => item.name), ['feishu_create_sheet', 'generate_image', 'generate_video', 'generate_seedance_fast_video']);
  assert.deepEqual(next.agents.map((item) => item.name), ['售后智能体']);
  assert.equal(JSON.stringify(next).includes('sk-'), false);
});

test('adds and trains knowledge documents into selected knowledge base', () => {
  const current = createDefaultSmartFactoryConfig();
  const next = addSmartFactoryKnowledgeDocument(current, {
    knowledgeBaseId: 'kb-after-sale',
    document: {
      id: 'doc-refund-fee',
      title: '退货运费',
      content: '退货运费按平台规则处理。',
    },
  });

  const kb = next.knowledgeBases.find((item) => item.id === 'kb-after-sale');
  assert.equal(kb.documents.some((item) => item.id === 'doc-refund-fee' && item.status === 'ready'), true);
  const runtimeInputs = toSmartFactoryRuntimeInputs(next);
  assert.equal(runtimeInputs.knowledgeChunks.some((item) => item.documentId === 'doc-refund-fee'), true);
});

test('stores knowledge base retrieval policy and document training metadata', () => {
  const withPolicy = updateSmartFactoryKnowledgeBase(createDefaultSmartFactoryConfig(), 'kb-after-sale', {
    retrievalPolicy: { topK: 2, similarityThreshold: 4, maxContextChars: 1200 },
    embeddingModel: { provider: 'openai_compatible', model: 'text-embedding-3-large' },
    rerankModel: { provider: 'openai_compatible', model: 'bge-reranker-v2-m3' },
  });
  const next = addSmartFactoryKnowledgeDocument(withPolicy, {
    knowledgeBaseId: 'kb-after-sale',
    document: {
      id: 'doc-faq',
      title: '售后 FAQ',
      fileName: 'faq.txt',
      sourceType: 'file',
      chunkStrategy: 'faq',
      maxChunkChars: 120,
      content: 'Q: 退货规则是什么？\nA: 签收后 7 天内可以申请退货。\n\nQ: 换货规则是什么？\nA: 质量问题 15 天内可以换货。',
    },
  });

  const publicConfig = getSmartFactoryPublicConfig(next);
  const kb = publicConfig.knowledgeBases.find((item) => item.id === 'kb-after-sale');
  const document = kb.documents.find((item) => item.id === 'doc-faq');
  const runtimeInputs = toSmartFactoryRuntimeInputs(next);

  assert.deepEqual(kb.retrievalPolicy, { topK: 2, similarityThreshold: 4, maxContextChars: 1200 });
  assert.deepEqual(kb.embeddingModel, { provider: 'openai_compatible', model: 'text-embedding-3-large' });
  assert.deepEqual(kb.rerankModel, { provider: 'openai_compatible', model: 'bge-reranker-v2-m3' });
  assert.equal(document.status, 'ready');
  assert.equal(document.chunkStrategy, 'faq');
  assert.equal(document.maxChunkChars, 120);
  assert.equal(document.chunkCount, 2);
  assert.equal(runtimeInputs.agentConfig.knowledge.datasets[0].retrievalPolicy.topK, 2);
  assert.deepEqual(runtimeInputs.agentConfig.knowledge.datasets[0].embeddingModel, {
    provider: 'openai_compatible',
    model: 'text-embedding-3-large',
  });
  assert.deepEqual(runtimeInputs.agentConfig.knowledge.datasets[0].rerankModel, {
    provider: 'openai_compatible',
    model: 'bge-reranker-v2-m3',
  });
  assert.equal(runtimeInputs.knowledgeChunks.some((chunk) => chunk.chunkId === 'doc-faq-chunk-1'), true);
});

test('preserves trained knowledge embeddings through config normalization and runtime inputs', () => {
  const config = normalizeSmartFactoryConfig({
    modelProviders: [{ provider: 'relay', models: [{ id: 'chat-model', mode: 'chat' }] }],
    knowledgeBases: [{
      id: 'kb-vector',
      name: '向量知识库',
      documents: [{
        id: 'doc-vector',
        title: '退货规则',
        content: '签收后 7 天内可以申请退货。',
        chunks: [{
          id: 'doc-vector-chunk-1',
          content: '签收后 7 天内可以申请退货。',
          embedding: [0.4, 0.5, 0.6],
          embeddingModel: { provider: 'relay', model: 'embedding-model' },
          embeddedAt: 1782300000000,
        }],
      }],
    }],
    tools: [],
    agents: [{
      id: 'agent-vector',
      name: '向量智能体',
      model: { provider: 'relay', model: 'chat-model' },
      knowledgeBaseIds: ['kb-vector'],
      enabled: true,
      status: 'published',
    }],
    sessions: [],
  });
  const runtimeInputs = toSmartFactoryRuntimeInputs(config, { agentId: 'agent-vector' });

  assert.deepEqual(config.knowledgeBases[0].documents[0].chunks[0].embedding, [0.4, 0.5, 0.6]);
  assert.deepEqual(runtimeInputs.knowledgeChunks[0].embedding, [0.4, 0.5, 0.6]);
  assert.deepEqual(runtimeInputs.knowledgeChunks[0].embeddingModel, {
    provider: 'relay',
    model: 'embedding-model',
  });
});

test('keeps failed knowledge document status visible in public config', () => {
  const next = addSmartFactoryKnowledgeDocument(createDefaultSmartFactoryConfig(), {
    knowledgeBaseId: 'kb-after-sale',
    document: {
      id: 'doc-empty',
      title: '空文档',
      content: '',
    },
  });

  const kb = getSmartFactoryPublicConfig(next).knowledgeBases.find((item) => item.id === 'kb-after-sale');
  const failed = kb.documents.find((item) => item.id === 'doc-empty');

  assert.equal(kb.status, 'partial_failed');
  assert.equal(kb.failedDocumentCount, 1);
  assert.equal(failed.status, 'failed');
  assert.match(failed.error, /文档内容为空/);
});

test('merging agent session updates preserves trained knowledge documents', () => {
  const trained = addSmartFactoryKnowledgeDocument(createDefaultSmartFactoryConfig(), {
    knowledgeBaseId: 'kb-after-sale',
    document: {
      id: 'doc-vip-service',
      title: 'VIP 售后',
      content: 'VIP 用户可优先创建售后处理表。',
    },
  });
  const next = mergeSmartFactoryConfigUpdate(trained, {
    agents: trained.agents,
    sessions: [{
      ...trained.sessions[0],
      messages: [
        ...trained.sessions[0].messages,
        { id: 'msg-user', role: 'user', content: '创建售后处理表' },
      ],
    }],
  });

  assert.equal(next.knowledgeBases[0].documents.length, 3);
  assert.equal(next.knowledgeBases[0].documents.some((item) => item.id === 'doc-vip-service'), true);
  assert.equal(next.sessions[0].messages.length, trained.sessions[0].messages.length + 1);
});

test('upserts relay model provider without exposing raw credentials in public config', () => {
  const next = upsertSmartFactoryModelProvider(createDefaultSmartFactoryConfig(), {
    provider: 'relay-main',
    displayName: '主力中转',
    baseUrl: 'https://relay.example.com/v1/',
    credentialRef: 'env:RELAY_MAIN_KEY',
    apiKey: 'sk-live-secret',
    modelsText: 'gpt-5.5, claude-4.5-sonnet',
    defaultModel: 'gpt-5.5',
    fallbackModel: 'claude-4.5-sonnet',
  });

  const provider = next.modelProviders.find((item) => item.provider === 'relay-main');
  assert.equal(provider.baseUrl, 'https://relay.example.com/v1');
  assert.equal(provider.defaultModel, 'gpt-5.5');
  assert.equal(provider.fallbackModel, 'claude-4.5-sonnet');
  assert.deepEqual(provider.models.map((item) => item.id), ['gpt-5.5', 'claude-4.5-sonnet']);

  const publicConfig = getSmartFactoryPublicConfig(next);
  assert.equal(JSON.stringify(publicConfig).includes('sk-live-secret'), false);
  assert.equal(publicConfig.modelProviders.find((item) => item.provider === 'relay-main').hasCredential, true);
});

test('exposes installable model provider presets with default models and capabilities', () => {
  const presets = getSmartFactoryModelProviderPresets();
  const ids = presets.map((item) => item.provider);

  assert.deepEqual(ids, [
    'openai',
    'anthropic',
    'google',
    'deepseek',
    'moonshot',
    'openrouter',
    'openai_compatible',
  ]);
  assert.equal(presets.find((item) => item.provider === 'openai').models.some((model) => model.features.includes('tool-call')), true);
  assert.equal(presets.find((item) => item.provider === 'openai').models.some((model) => model.mode === 'embedding'), true);
  assert.equal(presets.some((item) => item.models.some((model) => model.mode === 'image')), true);
  assert.equal(presets.some((item) => item.models.some((model) => model.mode === 'video')), true);
  assert.equal(presets.some((item) => item.models.some((model) => model.mode === 'rerank')), true);
  assert.equal(presets.find((item) => item.provider === 'openai_compatible').customBaseUrlRequired, true);
});

test('upserts custom model provider with Dify-style model modes and feature capabilities', () => {
  const next = upsertSmartFactoryModelProvider(createDefaultSmartFactoryConfig(), {
    provider: 'visual-relay',
    displayName: '视觉中转',
    baseUrl: 'https://relay.example.com/v1/',
    credentialRef: 'env:VISUAL_RELAY_API_KEY',
    models: [
      { id: 'visual-chat', mode: 'chat', features: ['tool-call', 'vision'] },
      { id: 'visual-embedding', mode: 'embedding', features: ['embedding'] },
      { id: 'visual-rerank', mode: 'rerank', features: ['rerank'] },
      { id: 'visual-image', mode: 'image', features: ['image-generation'] },
      { id: 'visual-video', mode: 'video', features: ['video-generation'] },
    ],
    defaultModel: 'visual-chat',
    fallbackModel: 'visual-chat-lite',
  });

  const provider = next.modelProviders.find((item) => item.provider === 'visual-relay');
  assert.equal(provider.baseUrl, 'https://relay.example.com/v1');
  assert.deepEqual(provider.models.map((model) => model.mode), ['chat', 'embedding', 'rerank', 'image', 'video']);
  assert.equal(provider.models.some((model) => model.features.includes('image-generation')), true);
  assert.equal(provider.models.some((model) => model.features.includes('video-generation')), true);
  assert.equal(JSON.stringify(provider).includes('VISUAL_RELAY_API_KEY'), true);
  assert.equal(JSON.stringify(provider).includes('sk-'), false);
});

test('deletes model provider and tool from public and runtime config', () => {
  const withProvider = upsertSmartFactoryModelProvider(createDefaultSmartFactoryConfig(), {
    provider: 'relay-main',
    displayName: '主力中转',
    baseUrl: 'https://relay.example.com/v1',
    credentialRef: 'env:RELAY_MAIN_KEY',
    modelsText: 'gpt-5.5',
  });
  const withTool = upsertSmartFactoryTool(withProvider, {
    name: 'feishu_create_doc',
    description: '创建飞书文档',
    executorRef: 'feishu.create_sheet',
  });

  const withoutProvider = deleteSmartFactoryModelProvider(withTool, 'relay-main');
  const withoutTool = deleteSmartFactoryTool(withoutProvider, 'feishu_create_doc');
  const publicConfig = getSmartFactoryPublicConfig(withoutTool);
  const runtimeInputs = toSmartFactoryRuntimeInputs(withoutTool);

  assert.equal(publicConfig.modelProviders.some((item) => item.provider === 'relay-main'), false);
  assert.equal(publicConfig.tools.some((item) => item.name === 'feishu_create_doc'), false);
  assert.equal(runtimeInputs.modelCatalog.some((item) => item.provider === 'relay-main'), false);
  assert.equal(Object.keys(runtimeInputs.cliToolExecutors).includes('feishu_create_doc'), false);
});

test('public config exposes safe knowledge document previews for product review', () => {
  const next = addSmartFactoryKnowledgeDocument(createDefaultSmartFactoryConfig(), {
    knowledgeBaseId: 'kb-after-sale',
    document: {
      id: 'doc-preview',
      title: '验收规则',
      content: '智能工厂必须支持模型配置、知识库训练、智能体发布、工具调用和运行日志验收。后续内容不需要完整暴露给列表。',
    },
  });

  const publicConfig = getSmartFactoryPublicConfig(next);
  const document = publicConfig.knowledgeBases[0].documents.find((item) => item.id === 'doc-preview');

  assert.match(document.preview, /智能工厂必须支持模型配置/);
  assert.equal(document.preview.includes('后续内容'), true);
  assert.equal(JSON.stringify(publicConfig).includes('sk-'), false);
});

test('creates edits and publishes a smart factory agent with model knowledge and tool bindings', () => {
  const withAgent = createSmartFactoryAgent(createDefaultSmartFactoryConfig(), {
    name: '商品资料助手',
    description: '读取商品资料并生成运营表格',
    prompt: '只根据绑定知识库回答。',
  });
  const agent = withAgent.agents.find((item) => item.name === '商品资料助手');
  assert.equal(agent.status, 'draft');

  const edited = updateSmartFactoryAgent(withAgent, agent.id, {
    model: { provider: 'openai_compatible', model: 'gpt-5.5' },
    knowledgeBaseIds: ['kb-after-sale'],
    toolNames: ['feishu_create_sheet'],
    variables: [{ key: 'order_id', label: '订单号', type: 'text', required: true }],
    metadataFilters: [{ key: 'source', operator: 'contains', value: '售后' }],
    vision: { enabled: true, transferMethods: ['local_file'], imageFileSizeLimit: 8 },
  });
  const published = publishSmartFactoryAgent(edited, agent.id);
  const publishedAgent = published.agents.find((item) => item.id === agent.id);

  assert.equal(publishedAgent.status, 'published');
  assert.equal(publishedAgent.publishedAt > 0, true);
  assert.deepEqual(publishedAgent.knowledgeBaseIds, ['kb-after-sale']);
  assert.deepEqual(publishedAgent.toolNames, ['feishu_create_sheet']);
  assert.deepEqual(publishedAgent.variables.map((item) => item.key), ['order_id']);
  assert.deepEqual(publishedAgent.metadataFilters, [{ key: 'source', operator: 'contains', value: '售后' }]);
  assert.equal(publishedAgent.vision.enabled, true);
  assert.equal(getSmartFactoryPublicConfig(published).agents.find((item) => item.id === agent.id).vision.imageFileSizeLimit, 8);
  assert.equal(published.sessions.some((session) => session.agentId === agent.id), true);
});

test('creates knowledge base and manages uploaded file documents through train retrain and delete', () => {
  const withBase = createSmartFactoryKnowledgeBase(createDefaultSmartFactoryConfig(), {
    name: '商品资料库',
    description: '训练商品和售后资料',
  });
  const base = withBase.knowledgeBases.find((item) => item.name === '商品资料库');
  const withDocument = addSmartFactoryKnowledgeDocument(withBase, {
    knowledgeBaseId: base.id,
    document: {
      fileName: 'product-policy.md',
      title: '商品政策',
      content: '# 商品政策\n大促期间支持 48 小时内改地址。',
      sourceType: 'file',
    },
  });
  const document = withDocument.knowledgeBases.find((item) => item.id === base.id).documents[0];
  assert.equal(document.fileName, 'product-policy.md');
  assert.equal(document.sourceType, 'file');
  assert.equal(document.status, 'ready');
  assert.equal(document.chunkCount > 0, true);

  const retrained = retrainSmartFactoryKnowledgeDocument(withDocument, document.id, {
    content: '大促期间支持 24 小时内改地址。',
  });
  const retrainedDocument = retrained.knowledgeBases.find((item) => item.id === base.id).documents[0];
  assert.equal(retrainedDocument.content, '大促期间支持 24 小时内改地址。');
  assert.equal(retrainedDocument.status, 'ready');

  const deleted = deleteSmartFactoryKnowledgeDocument(retrained, document.id);
  assert.equal(deleted.knowledgeBases.find((item) => item.id === base.id).documents.length, 0);
});

test('deletes knowledge base and removes agent bindings', () => {
  const withBase = createSmartFactoryKnowledgeBase(createDefaultSmartFactoryConfig(), {
    id: 'kb-products',
    name: '商品资料库',
  });
  const agentId = withBase.agents[0].id;
  const withBinding = updateSmartFactoryAgent(withBase, agentId, {
    knowledgeBaseIds: ['kb-after-sale', 'kb-products'],
  });

  const deleted = deleteSmartFactoryKnowledgeBase(withBinding, 'kb-products');
  const publicConfig = getSmartFactoryPublicConfig(deleted);
  const agent = publicConfig.agents.find((item) => item.id === agentId);

  assert.equal(publicConfig.knowledgeBases.some((item) => item.id === 'kb-products'), false);
  assert.deepEqual(agent.knowledgeBaseIds, ['kb-after-sale']);
});

test('upserts safe cli tool and exposes it for agent binding', () => {
  const next = upsertSmartFactoryTool(createDefaultSmartFactoryConfig(), {
    name: 'feishu_create_doc',
    description: '创建飞书文档',
    executorRef: 'feishu.create_sheet',
    riskLevel: 'safe',
    inputSchemaText: JSON.stringify({
      type: 'object',
      properties: { title: { type: 'string' } },
      required: ['title'],
      additionalProperties: false,
    }),
  });

  const tool = next.tools.find((item) => item.name === 'feishu_create_doc');
  assert.equal(tool.enabled, true);
  assert.equal(tool.executorRef, 'feishu.create_sheet');
  assert.equal(tool.inputSchema.properties.title.type, 'string');
  assert.equal(getSmartFactoryPublicConfig(next).tools.some((item) => item.name === 'feishu_create_doc'), true);
});

test('U2:deleteSmartFactoryAgent 删除 agent 并级联清掉它的 sessions', () => {
  const base = normalizeSmartFactoryConfig({});
  const withExtra = createSmartFactoryAgent(base, { name: '巡检残留', prompt: '测试用' });
  const extra = withExtra.agents.find((agent) => agent.name === '巡检残留');
  assert.ok(extra, '前置:新 agent 已创建');
  const published = publishSmartFactoryAgent(withExtra, extra.id);
  assert.ok(published.sessions.some((session) => session.agentId === extra.id), '前置:发布后有会话');

  const next = deleteSmartFactoryAgent(published, extra.id);
  assert.equal(next.agents.some((agent) => agent.id === extra.id), false, 'agent 已删除');
  assert.equal(next.sessions.some((session) => session.agentId === extra.id), false, '其 sessions 已级联删除');
  assert.ok(next.agents.length >= 1, '其他 agent 不受影响');
});

test('U2:deleteSmartFactoryAgent 拒绝删除最后一个 agent(否则 normalize 会复活默认 agents)', () => {
  const base = normalizeSmartFactoryConfig({});
  let current = base;
  const ids = base.agents.map((agent) => agent.id);
  for (const id of ids.slice(0, -1)) {
    current = deleteSmartFactoryAgent(current, id);
  }
  assert.equal(current.agents.length, 1);
  assert.throws(() => deleteSmartFactoryAgent(current, current.agents[0].id), /最后一个/);
});

test('U2:updateSmartFactoryAgent 支持 enabled 停用/启用', () => {
  const base = normalizeSmartFactoryConfig({});
  const id = base.agents[0].id;
  const disabled = updateSmartFactoryAgent(base, id, { enabled: false });
  assert.equal(disabled.agents.find((agent) => agent.id === id).enabled, false);
  const enabled = updateSmartFactoryAgent(disabled, id, { enabled: true });
  assert.equal(enabled.agents.find((agent) => agent.id === id).enabled, true);
  // 白名单外字段仍不可写
  const hacked = updateSmartFactoryAgent(base, id, { id: 'evil-id' });
  assert.equal(hacked.agents.some((agent) => agent.id === 'evil-id'), false);
});

test('U2:双 handler 路由源码断言——MySQL 与本地 JSON 模式都有 agent DELETE 且共用 deleteSmartFactoryAgent', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('./index.mjs', import.meta.url), 'utf8');
  const dbDelete = source.match(/dbSmartFactoryAgentMatch && req\.method === 'DELETE'/g) || [];
  const localDelete = source.match(/localSmartFactoryAgentMatch && req\.method === 'DELETE'/g) || [];
  assert.equal(dbDelete.length, 1, 'MySQL 模式必须有 agent DELETE 路由');
  assert.equal(localDelete.length, 1, '本地 JSON 模式必须有 agent DELETE 路由');
  assert.equal((source.match(/deleteSmartFactoryAgent\(/g) || []).length >= 2, true, '两个路由都调用同一 store 函数');
});
