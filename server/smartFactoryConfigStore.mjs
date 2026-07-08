import { createCliToolExecutors } from './ai-engine/cliToolRunner.mjs';
import {
  createDefaultSmartFactoryAgentState,
  normalizeSmartFactoryAgentState,
} from './ai-engine/smartFactoryAgentStore.mjs';
import {
  normalizeKnowledgeBaseForTraining,
  normalizeSmartFactoryRetrievalPolicy,
} from './ai-engine/knowledgeIngestion.mjs';
import { selectSmartFactoryModel, toModelCatalog } from './ai-engine/modelRelayRegistry.mjs';
import { normalizeSmartFactoryToolRegistry, toRuntimeBuiltinTools, toRuntimeCliTools } from './ai-engine/toolRegistry.mjs';
import { createBuiltinMediaToolExecutors } from './ai-engine/smartFactoryMediaToolRunner.mjs';

const DEFAULT_AGENT_STATE = createDefaultSmartFactoryAgentState();

const DEFAULT_SMART_FACTORY_CONFIG = {
  mediaToolsMigrated: true,
  mediaToolsVersion: 2,
  modelProviders: [{
    provider: 'openai_compatible',
    credentialRef: 'env:OPENAI_COMPATIBLE_API_KEY',
    models: [{ id: 'gpt-5.5', mode: 'chat', features: ['tool-call'] }],
  }],
  knowledgeBases: [{
    id: 'kb-after-sale',
    name: '售后知识库',
    documents: [
      {
        id: 'doc-return-policy',
        title: '退货规则',
        content: '签收后 7 天内可以申请退货，商品需保持完好并保留原包装。',
      },
      {
        id: 'doc-exchange-policy',
        title: '换货规则',
        content: '质量问题可在签收后 15 天内申请换货，需提交订单号和问题照片。',
      },
    ],
  }],
  tools: [{
    name: 'feishu_create_sheet',
    type: 'cli',
    description: '创建飞书表格',
    invoke_metadata: {
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string' },
        },
        required: ['title'],
        additionalProperties: false,
      },
    },
    authorization_status: 'authorized',
    risk_level: 'safe',
    enabled: true,
    executorRef: 'feishu.create_sheet',
  }, {
    name: 'generate_image',
    type: 'builtin',
    description: '调用统一模型中心的图片模型生成或编辑图片',
    invoke_metadata: {
      parameters: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: '图片生成或编辑要求' },
          task_type: { type: 'string', enum: ['new_image', 'edit_image'], description: 'new_image=文生图，edit_image=基于输入图片编辑' },
          input_image_urls: { type: 'array', items: { type: 'string' }, description: '需要编辑或参考的图片 URL' },
          aspect_ratio: { type: 'string', description: '图片比例，例如 auto、1:1、4:3、3:4、16:9、9:16' },
        },
        required: ['prompt'],
        additionalProperties: false,
      },
    },
    authorization_status: 'authorized',
    risk_level: 'safe',
    enabled: true,
    executorRef: 'media.generate_image',
    capability: 'image',
    icon: 'image',
    modelProvider: 'kie',
    model: 'gpt-image-2',
  }, {
    name: 'generate_video',
    type: 'builtin',
    description: '调用统一模型中心的视频模型生成短视频任务',
    invoke_metadata: {
      parameters: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: '视频内容描述' },
          image_urls: { type: 'array', items: { type: 'string' }, description: '参考图片 URL，可为空' },
          aspect_ratio: { type: 'string', enum: ['16:9', '9:16', '1:1'], description: '视频比例' },
          duration: { type: 'number', description: '视频秒数' },
        },
        required: ['prompt'],
        additionalProperties: true,
      },
    },
    authorization_status: 'authorized',
    risk_level: 'safe',
    enabled: true,
    executorRef: 'media.generate_video',
    capability: 'video',
    icon: 'video',
    modelProvider: 'kie',
    model: 'veo3_fast',
  }, {
    name: 'generate_seedance_fast_video',
    type: 'builtin',
    description: '调用 KIE Seedance Fast 生成短视频任务',
    invoke_metadata: {
      parameters: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: '视频内容描述' },
          image_urls: { type: 'array', items: { type: 'string' }, description: '参考图片 URL，可为空' },
          aspect_ratio: { type: 'string', enum: ['16:9', '9:16', '1:1'], description: '视频比例' },
          duration: { type: 'number', description: '视频秒数，Seedance Fast 默认 5 秒' },
        },
        required: ['prompt'],
        additionalProperties: true,
      },
    },
    authorization_status: 'authorized',
    risk_level: 'safe',
    enabled: true,
    executorRef: 'media.generate_video',
    capability: 'video',
    icon: 'video',
    modelProvider: 'kie',
    model: 'bytedance/seedance-2-fast',
  }],
  agents: DEFAULT_AGENT_STATE.agents,
  sessions: DEFAULT_AGENT_STATE.sessions,
};

const MODEL_PROVIDER_PRESETS = [
  {
    provider: 'openai',
    displayName: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    credentialRef: 'env:OPENAI_API_KEY',
    models: [
      { id: 'gpt-4.1', mode: 'chat', features: ['tool-call', 'vision'] },
      { id: 'gpt-4.1-mini', mode: 'chat', features: ['tool-call', 'vision'] },
      { id: 'text-embedding-3-large', mode: 'embedding', features: ['embedding'] },
      { id: 'gpt-image-1', mode: 'image', features: ['image-generation'] },
      { id: 'sora', mode: 'video', features: ['video-generation'] },
    ],
  },
  {
    provider: 'anthropic',
    displayName: 'Anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    credentialRef: 'env:ANTHROPIC_API_KEY',
    models: [
      { id: 'claude-sonnet-4-5', mode: 'chat', features: ['tool-call', 'vision'] },
      { id: 'claude-haiku-4-5', mode: 'chat', features: ['tool-call', 'vision'] },
    ],
  },
  {
    provider: 'google',
    displayName: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    credentialRef: 'env:GOOGLE_API_KEY',
    models: [
      { id: 'gemini-2.5-pro', mode: 'chat', features: ['tool-call', 'vision'] },
      { id: 'gemini-2.5-flash', mode: 'chat', features: ['tool-call', 'vision'] },
      { id: 'gemini-embedding', mode: 'embedding', features: ['embedding'] },
    ],
  },
  {
    provider: 'deepseek',
    displayName: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    credentialRef: 'env:DEEPSEEK_API_KEY',
    models: [
      { id: 'deepseek-chat', mode: 'chat', features: ['tool-call'] },
      { id: 'deepseek-reasoner', mode: 'chat', features: ['reasoning'] },
    ],
  },
  {
    provider: 'moonshot',
    displayName: 'Moonshot',
    baseUrl: 'https://api.moonshot.cn/v1',
    credentialRef: 'env:MOONSHOT_API_KEY',
    models: [
      { id: 'kimi-k2', mode: 'chat', features: ['tool-call'] },
      { id: 'moonshot-v1-128k', mode: 'chat', features: ['long-context'] },
    ],
  },
  {
    provider: 'openrouter',
    displayName: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    credentialRef: 'env:OPENROUTER_API_KEY',
    models: [
      { id: 'openai/gpt-4.1', mode: 'chat', features: ['tool-call', 'vision'] },
      { id: 'anthropic/claude-sonnet-4.5', mode: 'chat', features: ['tool-call', 'vision'] },
      { id: 'openai/gpt-image-1', mode: 'image', features: ['image-generation'] },
    ],
  },
  {
    provider: 'openai_compatible',
    displayName: 'OpenAI 兼容中转',
    baseUrl: '',
    credentialRef: 'env:OPENAI_COMPATIBLE_API_KEY',
    customBaseUrlRequired: true,
    models: [
      { id: 'gpt-5.5', mode: 'chat', features: ['tool-call', 'vision'] },
      { id: 'text-embedding-3-large', mode: 'embedding', features: ['embedding'] },
      { id: 'bge-reranker-v2-m3', mode: 'rerank', features: ['rerank'] },
      { id: 'gpt-image-1', mode: 'image', features: ['image-generation'] },
      { id: 'sora', mode: 'video', features: ['video-generation'] },
    ],
  },
];

const cloneJson = (value) => JSON.parse(JSON.stringify(value));

const text = (value, max = 5000) => String(value || '').trim().slice(0, max);
const now = () => Date.now();
const createId = (prefix) => `${prefix}-${now()}-${Math.random().toString(36).slice(2, 8)}`;

const splitModelsText = (value) => text(value, 5000)
  .split(/[\n,，]+/)
  .map((item) => text(item, 160))
  .filter(Boolean);

const MODEL_MODE_FEATURES = {
  chat: ['tool-call'],
  embedding: ['embedding'],
  rerank: ['rerank'],
  image: ['image-generation'],
  video: ['video-generation'],
  moderation: ['moderation'],
  speech2text: ['speech2text'],
  tts: ['tts'],
};

const normalizeModelMode = (mode = '') => {
  const normalized = text(mode || 'chat', 40).toLowerCase().replace(/_/g, '-');
  if (['llm', 'completion', 'text-generation'].includes(normalized)) return 'chat';
  if (['text-embedding', 'embeddings'].includes(normalized)) return 'embedding';
  if (['text-to-image', 'image-generation'].includes(normalized)) return 'image';
  if (['text-to-video', 'video-generation'].includes(normalized)) return 'video';
  if (['re-rank', 'reranker'].includes(normalized)) return 'rerank';
  return MODEL_MODE_FEATURES[normalized] ? normalized : 'chat';
};

const defaultFeaturesForMode = (mode) => MODEL_MODE_FEATURES[normalizeModelMode(mode)] || MODEL_MODE_FEATURES.chat;

const parseModelTextToken = (token = '') => {
  const raw = text(token, 240);
  const prefixed = raw.match(/^([a-zA-Z][\w-]{1,32})\s*:\s*(.+)$/);
  if (!prefixed) {
    return { id: raw, mode: 'chat', features: defaultFeaturesForMode('chat') };
  }
  const mode = normalizeModelMode(prefixed[1]);
  return { id: text(prefixed[2], 160), mode, features: defaultFeaturesForMode(mode) };
};

const normalizeModelEntry = (model = {}) => {
  if (typeof model === 'string') {
    const parsed = parseModelTextToken(model);
    return parsed.id ? parsed : null;
  }
  const mode = normalizeModelMode(model?.mode || model?.model_type || model?.type || 'chat');
  const entry = {
    id: text(model?.id || model?.name || model?.model, 160),
    mode,
    features: normalizeFeatureList(model?.features).length
      ? normalizeFeatureList(model.features)
      : defaultFeaturesForMode(mode),
  };
  return entry.id ? entry : null;
};

const parseInputSchemaText = (value, fallback = undefined) => {
  if (!value) return fallback;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch {
    return fallback;
  }
};

const normalizeFeatureList = (features) => (Array.isArray(features) ? features : [])
  .map((item) => text(item, 80))
  .filter(Boolean);

const normalizeVariables = (variables = []) => (Array.isArray(variables) ? variables : [])
  .map((variable) => ({
    key: text(variable?.key || variable?.name, 80),
    label: text(variable?.label || variable?.key || variable?.name, 120),
    type: text(variable?.type || 'text', 40),
    required: variable?.required === true,
    defaultValue: text(variable?.defaultValue ?? variable?.default ?? '', 1000),
  }))
  .filter((variable) => variable.key);

const normalizeMetadataFilters = (filters = []) => (Array.isArray(filters) ? filters : [])
  .map((filter) => ({
    key: text(filter?.key || filter?.field, 80),
    operator: text(filter?.operator || 'contains', 40),
    value: text(filter?.value, 500),
  }))
  .filter((filter) => filter.key);

const normalizeVision = (vision = {}) => ({
  enabled: vision?.enabled === true,
  transferMethods: (Array.isArray(vision?.transferMethods || vision?.transfer_methods)
    ? (vision.transferMethods || vision.transfer_methods)
    : ['local_file'])
    .map((item) => text(item, 60))
    .filter(Boolean),
  imageFileSizeLimit: Math.max(1, Math.min(50, Number(vision?.imageFileSizeLimit || vision?.image_file_size_limit || 10))),
});

const normalizeModelRef = (value = {}) => {
  if (!value || typeof value !== 'object') return undefined;
  const provider = text(value.provider || value.model_provider, 120);
  const model = text(value.model || value.name, 160);
  if (!provider || !model) return undefined;
  return { provider, model };
};

const normalizeEmbeddingVector = (value) => {
  if (!Array.isArray(value)) return undefined;
  const embedding = value.map((item) => Number(item)).filter((item) => Number.isFinite(item));
  return embedding.length ? embedding : undefined;
};

const normalizeKnowledgeChunk = (chunk = {}) => {
  const id = text(chunk.id || chunk.chunkId || chunk.chunk_id, 160);
  const content = text(chunk.content || chunk.text, 20000);
  const embedding = normalizeEmbeddingVector(chunk.embedding);
  const embeddingModel = normalizeModelRef(chunk.embeddingModel || chunk.embedding_model);
  if (!id && !content && !embedding) return null;
  return {
    ...(id ? { id } : {}),
    ...(content ? { content } : {}),
    chunkIndex: Number(chunk.chunkIndex ?? chunk.index ?? 0),
    index: Number(chunk.index ?? chunk.chunkIndex ?? 0),
    ...(embedding ? { embedding } : {}),
    ...(embeddingModel ? { embeddingModel } : {}),
    ...(Number.isFinite(Number(chunk.embeddedAt || chunk.embedded_at))
      ? { embeddedAt: Number(chunk.embeddedAt || chunk.embedded_at) }
      : {}),
  };
};

const normalizeModelProvider = (provider = {}) => {
  const providerId = text(provider.provider, 120);
  const models = (Array.isArray(provider.models) ? provider.models : [])
    .map(normalizeModelEntry)
    .filter(Boolean);
  if (!providerId || models.length === 0) return null;
  const credentialRef = text(provider.credentialRef, 200);
  const displayName = text(provider.displayName || provider.name || providerId, 160);
  const baseUrl = text(provider.baseUrl, 300).replace(/\/$/, '');
  const defaultModel = text(provider.defaultModel, 160);
  const fallbackModel = text(provider.fallbackModel, 160);
  return {
    provider: providerId,
    displayName,
    ...(baseUrl ? { baseUrl } : {}),
    ...(credentialRef ? { credentialRef } : {}),
    ...(defaultModel ? { defaultModel } : {}),
    ...(fallbackModel ? { fallbackModel } : {}),
    models,
  };
};

export const getSmartFactoryModelProviderPresets = () => cloneJson(MODEL_PROVIDER_PRESETS);

const normalizeKnowledgeDocument = (document = {}) => {
  const id = text(document.id, 120);
  const title = text(document.title, 200);
  const content = text(document.content, 20000);
  if (!id || !title) return null;
  return {
    id,
    title,
    fileName: text(document.fileName || document.file_name, 240),
    sourceType: text(document.sourceType || document.source_type || 'text', 40),
    chunkStrategy: text(document.chunkStrategy || document.chunk_strategy || 'general', 40),
    maxChunkChars: Number(document.maxChunkChars || document.max_chunk_chars || 0) || undefined,
    content,
    chunks: (Array.isArray(document.chunks) ? document.chunks : [])
      .map(normalizeKnowledgeChunk)
      .filter(Boolean),
    updatedAt: Number(document.updatedAt || now()),
  };
};

const normalizeKnowledgeBase = (knowledgeBase = {}) => {
  const normalized = normalizeKnowledgeBaseForTraining({
    ...knowledgeBase,
    retrievalPolicy: normalizeSmartFactoryRetrievalPolicy(knowledgeBase.retrievalPolicy || knowledgeBase.retrieval_policy),
    documents: (Array.isArray(knowledgeBase.documents) ? knowledgeBase.documents : [])
      .map(normalizeKnowledgeDocument)
      .filter(Boolean),
  });
  if (!normalized.id || !normalized.name) return null;
  return normalized;
};

const normalizeTool = (tool = {}) => {
  const name = text(tool.name, 120);
  const type = text(tool.type || 'cli', 40);
  if (!name || !['cli', 'builtin'].includes(type)) return null;
  const inputSchema = tool.inputSchema && typeof tool.inputSchema === 'object'
    ? cloneJson(tool.inputSchema)
    : tool.invoke_metadata?.parameters && typeof tool.invoke_metadata.parameters === 'object'
      ? cloneJson(tool.invoke_metadata.parameters)
      : undefined;
  const normalized = normalizeSmartFactoryToolRegistry([{
    name,
    type,
    description: tool.description,
    enabled: tool.enabled !== false,
    riskLevel: tool.riskLevel || tool.risk_level || 'safe',
    executorRef: tool.executorRef || tool.executor_ref || (name === 'feishu_create_sheet' ? 'feishu.create_sheet' : name),
    capability: tool.capability || tool.mode,
    icon: tool.icon,
    modelProvider: tool.modelProvider || tool.model_provider || tool.provider,
    model: tool.model || tool.modelName || tool.model_name,
    ...(inputSchema ? { inputSchema } : {}),
  }])[0];
  return normalized || null;
};

export const normalizeSmartFactoryConfig = (value = {}) => {
  const fallback = cloneJson(DEFAULT_SMART_FACTORY_CONFIG);
  const source = value && typeof value === 'object' ? value : {};
  // 只有"字段缺失(非数组)"才播种默认;空数组是用户删除的真实结果,复活默认会让删除永远不生效
  const hasSourceModelProviders = Array.isArray(source.modelProviders);
  const modelProviders = (hasSourceModelProviders ? source.modelProviders : fallback.modelProviders)
    .map(normalizeModelProvider)
    .filter(Boolean);
  const hasSourceKnowledgeBases = Array.isArray(source.knowledgeBases);
  const knowledgeBases = (hasSourceKnowledgeBases ? source.knowledgeBases : fallback.knowledgeBases)
    .map(normalizeKnowledgeBase)
    .filter(Boolean);
  const hasSourceTools = Array.isArray(source.tools);
  const normalizedTools = (hasSourceTools ? source.tools : fallback.tools)
    .map(normalizeTool)
    .filter(Boolean);
  const defaultTools = fallback.tools
    .map(normalizeTool)
    .filter(Boolean);
  const defaultBuiltinTools = defaultTools.filter((tool) => tool.type === 'builtin');
  const seedanceFastTool = defaultTools.find((tool) => tool.name === 'generate_seedance_fast_video');
  const toolMap = new Map(normalizedTools.map((tool) => [tool.name, tool]));
  const shouldMigrateDefaultMediaTools = !hasSourceTools
    || (source.mediaToolsMigrated !== true && normalizedTools.some((tool) => tool.name === 'feishu_create_sheet'));
  const shouldMigrateSeedanceFastTool = hasSourceTools
    && source.mediaToolsMigrated === true
    && Number(source.mediaToolsVersion || 1) < 2
    && Boolean(seedanceFastTool);
  if (shouldMigrateDefaultMediaTools) {
    defaultBuiltinTools.forEach((tool) => {
      if (!toolMap.has(tool.name)) toolMap.set(tool.name, tool);
    });
  } else if (shouldMigrateSeedanceFastTool && !toolMap.has(seedanceFastTool.name)) {
    toolMap.set(seedanceFastTool.name, seedanceFastTool);
  }
  const tools = Array.from(toolMap.values());
  const agentState = normalizeSmartFactoryAgentState({
    agents: source.agents || fallback.agents,
    sessions: source.sessions || fallback.sessions,
  });
  const defaultToolNames = new Set(defaultTools.map((tool) => tool.name));
  const agents = agentState.agents.map((agent) => {
    if (agent.id !== 'agent-after-sale') return agent;
    const toolNames = new Set((agent.toolNames || []).filter(Boolean));
    if (shouldMigrateDefaultMediaTools) {
      defaultToolNames.forEach((toolName) => toolNames.add(toolName));
    } else if (shouldMigrateSeedanceFastTool && seedanceFastTool) {
      toolNames.add(seedanceFastTool.name);
    }
    return { ...agent, toolNames: Array.from(toolNames) };
  });
  return {
    mediaToolsMigrated: true,
    mediaToolsVersion: 2,
    modelProviders: hasSourceModelProviders
      ? modelProviders
      : (modelProviders.length ? modelProviders : fallback.modelProviders),
    knowledgeBases: hasSourceKnowledgeBases
      ? knowledgeBases
      : (knowledgeBases.length ? knowledgeBases : fallback.knowledgeBases),
    tools: hasSourceTools ? tools : (tools.length ? tools : fallback.tools),
    agents,
    sessions: agentState.sessions,
  };
};

export const createDefaultSmartFactoryConfig = () => normalizeSmartFactoryConfig(
  cloneJson(DEFAULT_SMART_FACTORY_CONFIG)
);

export const mergeSmartFactoryConfigUpdate = (current = createDefaultSmartFactoryConfig(), update = {}) => {
  const normalizedCurrent = normalizeSmartFactoryConfig(current);
  const patch = update && typeof update === 'object' ? update : {};
  return normalizeSmartFactoryConfig({
    mediaToolsMigrated: normalizedCurrent.mediaToolsMigrated,
    mediaToolsVersion: normalizedCurrent.mediaToolsVersion,
    modelProviders: patch.modelProviders === undefined
      ? normalizedCurrent.modelProviders
      : patch.modelProviders,
    knowledgeBases: patch.knowledgeBases === undefined
      ? normalizedCurrent.knowledgeBases
      : patch.knowledgeBases,
    tools: patch.tools === undefined
      ? normalizedCurrent.tools
      : patch.tools,
    agents: patch.agents === undefined
      ? normalizedCurrent.agents
      : patch.agents,
    sessions: patch.sessions === undefined
      ? normalizedCurrent.sessions
      : patch.sessions,
  });
};

export const upsertSmartFactoryModelProvider = (current = createDefaultSmartFactoryConfig(), payload = {}) => {
  const normalized = normalizeSmartFactoryConfig(current);
  const provider = text(payload.provider || payload.providerId, 120);
  const preset = MODEL_PROVIDER_PRESETS.find((item) => item.provider === provider);
  const payloadModels = Array.isArray(payload.models)
    ? payload.models.map(normalizeModelEntry).filter(Boolean)
    : splitModelsText(payload.modelsText).map(parseModelTextToken).filter((model) => model.id);
  const models = payloadModels.length
    ? payloadModels
    : (preset?.models || []);
  const nextProvider = normalizeModelProvider({
    provider,
    displayName: payload.displayName || preset?.displayName,
    baseUrl: payload.baseUrl !== undefined ? payload.baseUrl : preset?.baseUrl,
    credentialRef: payload.credentialRef || (text(payload.apiKey, 200) ? `secret:${provider}` : preset?.credentialRef),
    defaultModel: payload.defaultModel || models[0]?.id,
    fallbackModel: payload.fallbackModel || models[1]?.id || models[0]?.id,
    models,
  });
  if (!nextProvider) return normalized;
  return normalizeSmartFactoryConfig({
    ...normalized,
    modelProviders: [
      ...normalized.modelProviders.filter((item) => item.provider !== nextProvider.provider),
      nextProvider,
    ],
  });
};

export const deleteSmartFactoryModelProvider = (current = createDefaultSmartFactoryConfig(), providerId = '') => {
  const normalized = normalizeSmartFactoryConfig(current);
  const id = text(providerId, 120);
  const modelProviders = normalized.modelProviders.filter((item) => item.provider !== id);
  const fallbackProvider = modelProviders[0];
  const fallbackModel = fallbackProvider?.models[0]?.id || '';
  return normalizeSmartFactoryConfig({
    ...normalized,
    modelProviders,
    agents: normalized.agents.map((agent) => (
      agent.model?.provider === id
        ? { ...agent, model: fallbackProvider ? { provider: fallbackProvider.provider, model: fallbackModel } : {} }
        : agent
    )),
  });
};

export const createSmartFactoryAgent = (current = createDefaultSmartFactoryConfig(), payload = {}) => {
  const normalized = normalizeSmartFactoryConfig(current);
  const id = text(payload.id, 120) || createId('agent');
  const firstModel = normalized.modelProviders[0]?.models[0]?.id || 'gpt-5.5';
  const firstProvider = normalized.modelProviders[0]?.provider || 'openai_compatible';
  const agent = {
    id,
    name: text(payload.name, 120) || '新智能体',
    description: text(payload.description, 500),
    prompt: text(payload.prompt || '你是梅奥智能工厂智能体。', 4000),
    model: payload.model || { provider: firstProvider, model: firstModel },
    knowledgeBaseIds: Array.isArray(payload.knowledgeBaseIds) ? payload.knowledgeBaseIds : [],
    toolNames: Array.isArray(payload.toolNames) ? payload.toolNames : [],
    variables: normalizeVariables(payload.variables),
    metadataFilters: normalizeMetadataFilters(payload.metadataFilters || payload.metadata_filters),
    vision: normalizeVision(payload.vision),
    enabled: true,
    status: 'draft',
    publishedAt: 0,
    updatedAt: now(),
  };
  return normalizeSmartFactoryConfig({
    ...normalized,
    agents: [...normalized.agents.filter((item) => item.id !== id), agent],
  });
};

export const updateSmartFactoryAgent = (current = createDefaultSmartFactoryConfig(), agentId = '', payload = {}) => {
  const normalized = normalizeSmartFactoryConfig(current);
  const id = text(agentId, 120);
  return normalizeSmartFactoryConfig({
    ...normalized,
    agents: normalized.agents.map((agent) => {
      if (agent.id !== id) return agent;
      return {
        ...agent,
        ...(payload.name !== undefined ? { name: payload.name } : {}),
        ...(payload.description !== undefined ? { description: payload.description } : {}),
        ...(payload.prompt !== undefined ? { prompt: payload.prompt } : {}),
        ...(payload.model !== undefined ? { model: payload.model } : {}),
        ...(payload.knowledgeBaseIds !== undefined ? { knowledgeBaseIds: payload.knowledgeBaseIds } : {}),
        ...(payload.toolNames !== undefined ? { toolNames: payload.toolNames } : {}),
        ...(payload.variables !== undefined ? { variables: normalizeVariables(payload.variables) } : {}),
        ...(payload.metadataFilters !== undefined ? { metadataFilters: normalizeMetadataFilters(payload.metadataFilters) } : {}),
        ...(payload.vision !== undefined ? { vision: normalizeVision(payload.vision) } : {}),
        ...(typeof payload.enabled === 'boolean' ? { enabled: payload.enabled } : {}),
        status: payload.status === 'published' ? 'published' : agent.status,
        publishedAt: payload.status === 'published' ? now() : agent.publishedAt,
        updatedAt: now(),
      };
    }),
  });
};

export const publishSmartFactoryAgent = (current = createDefaultSmartFactoryConfig(), agentId = '') => {
  const normalized = updateSmartFactoryAgent(current, agentId, { status: 'published' });
  const id = text(agentId, 120);
  const hasSession = normalized.sessions.some((session) => session.agentId === id);
  if (hasSession) return normalized;
  const agent = normalized.agents.find((item) => item.id === id);
  if (!agent) return normalized;
  return normalizeSmartFactoryConfig({
    ...normalized,
    sessions: [
      ...normalized.sessions,
      {
        id: createId('session'),
        agentId: id,
        title: `${agent.name} 对话`,
        messages: [],
        updatedAt: now(),
      },
    ],
  });
};

export const createSmartFactoryKnowledgeBase = (current = createDefaultSmartFactoryConfig(), payload = {}) => {
  const normalized = normalizeSmartFactoryConfig(current);
  const id = text(payload.id, 120) || createId('kb');
  return normalizeSmartFactoryConfig({
    ...normalized,
    knowledgeBases: [
      ...normalized.knowledgeBases.filter((item) => item.id !== id),
      {
        id,
        name: text(payload.name, 200) || '新知识库',
        description: text(payload.description, 600),
        retrievalPolicy: normalizeSmartFactoryRetrievalPolicy(payload.retrievalPolicy),
        documents: [],
        updatedAt: now(),
      },
    ],
  });
};

export const updateSmartFactoryKnowledgeBase = (current = createDefaultSmartFactoryConfig(), knowledgeBaseId = '', payload = {}) => {
  const normalized = normalizeSmartFactoryConfig(current);
  const id = text(knowledgeBaseId, 120);
  return normalizeSmartFactoryConfig({
    ...normalized,
    knowledgeBases: normalized.knowledgeBases.map((knowledgeBase) => {
      if (knowledgeBase.id !== id) return knowledgeBase;
      return {
        ...knowledgeBase,
        ...(payload.name !== undefined ? { name: text(payload.name, 200) || knowledgeBase.name } : {}),
        ...(payload.description !== undefined ? { description: text(payload.description, 600) } : {}),
        ...(payload.retrievalPolicy !== undefined ? { retrievalPolicy: normalizeSmartFactoryRetrievalPolicy(payload.retrievalPolicy) } : {}),
        ...(payload.embeddingModel !== undefined ? { embeddingModel: normalizeModelRef(payload.embeddingModel) } : {}),
        ...(payload.rerankModel !== undefined ? { rerankModel: normalizeModelRef(payload.rerankModel) } : {}),
        updatedAt: now(),
      };
    }),
  });
};

export const deleteSmartFactoryAgent = (current = createDefaultSmartFactoryConfig(), agentId = '') => {
  const normalized = normalizeSmartFactoryConfig(current);
  const id = text(agentId, 120);
  if (!normalized.agents.some((agent) => agent.id === id)) return normalized;
  // normalizeSmartFactoryAgentState 对空 agents 会回落默认 agents(复活幽灵),故拒绝删除最后一个。
  if (normalized.agents.length <= 1) {
    throw new Error('不能删除最后一个智能体;请先创建新的智能体再删除它。');
  }
  return normalizeSmartFactoryConfig({
    ...normalized,
    agents: normalized.agents.filter((agent) => agent.id !== id),
    sessions: normalized.sessions.filter((session) => session.agentId !== id),
  });
};

export const deleteSmartFactoryKnowledgeBase = (current = createDefaultSmartFactoryConfig(), knowledgeBaseId = '') => {
  const normalized = normalizeSmartFactoryConfig(current);
  const id = text(knowledgeBaseId, 120);
  return normalizeSmartFactoryConfig({
    ...normalized,
    knowledgeBases: normalized.knowledgeBases.filter((knowledgeBase) => knowledgeBase.id !== id),
    agents: normalized.agents.map((agent) => ({
      ...agent,
      knowledgeBaseIds: (agent.knowledgeBaseIds || []).filter((item) => item !== id),
    })),
  });
};

export const addSmartFactoryKnowledgeDocument = (current = createDefaultSmartFactoryConfig(), payload = {}) => {
  const normalized = normalizeSmartFactoryConfig(current);
  const knowledgeBaseId = text(payload.knowledgeBaseId, 120);
  const document = payload.document && typeof payload.document === 'object' ? payload.document : {};
  return normalizeSmartFactoryConfig({
    ...normalized,
    knowledgeBases: normalized.knowledgeBases.map((knowledgeBase) => {
      if (knowledgeBase.id !== knowledgeBaseId) return knowledgeBase;
      return {
        ...knowledgeBase,
        documents: [
          ...knowledgeBase.documents,
          {
            id: text(document.id, 120) || `doc-${Date.now()}`,
            title: text(document.title, 200) || '未命名文档',
            fileName: text(document.fileName, 240),
            sourceType: text(document.sourceType || (document.fileName ? 'file' : 'text'), 40),
            chunkStrategy: text(document.chunkStrategy || 'general', 40),
            maxChunkChars: Number(document.maxChunkChars || 0) || undefined,
            content: text(document.content, 20000),
            updatedAt: now(),
          },
        ],
      };
    }),
  });
};

export const retrainSmartFactoryKnowledgeDocument = (current = createDefaultSmartFactoryConfig(), documentId = '', payload = {}) => {
  const normalized = normalizeSmartFactoryConfig(current);
  const id = text(documentId, 120);
  return normalizeSmartFactoryConfig({
    ...normalized,
    knowledgeBases: normalized.knowledgeBases.map((knowledgeBase) => ({
      ...knowledgeBase,
      documents: knowledgeBase.documents.map((document) => (
        document.id === id
          ? {
              ...document,
              title: payload.title === undefined ? document.title : text(payload.title, 200),
              content: payload.content === undefined ? document.content : text(payload.content, 20000),
              chunkStrategy: payload.chunkStrategy === undefined ? document.chunkStrategy : text(payload.chunkStrategy || 'general', 40),
              maxChunkChars: payload.maxChunkChars === undefined ? document.maxChunkChars : Number(payload.maxChunkChars || 0) || undefined,
              updatedAt: now(),
            }
          : document
      )),
    })),
  });
};

export const deleteSmartFactoryKnowledgeDocument = (current = createDefaultSmartFactoryConfig(), documentId = '') => {
  const normalized = normalizeSmartFactoryConfig(current);
  const id = text(documentId, 120);
  return normalizeSmartFactoryConfig({
    ...normalized,
    knowledgeBases: normalized.knowledgeBases.map((knowledgeBase) => ({
      ...knowledgeBase,
      documents: knowledgeBase.documents.filter((document) => document.id !== id),
    })),
  });
};

export const upsertSmartFactoryTool = (current = createDefaultSmartFactoryConfig(), payload = {}) => {
  const normalized = normalizeSmartFactoryConfig(current);
  const name = text(payload.name, 120);
  const inputSchema = payload.inputSchema && typeof payload.inputSchema === 'object'
    ? payload.inputSchema
    : parseInputSchemaText(payload.inputSchemaText, undefined);
  const tool = normalizeTool({
    name,
    type: payload.type || 'cli',
    description: payload.description,
    enabled: payload.enabled !== false,
    riskLevel: payload.riskLevel || payload.risk_level || 'safe',
    executorRef: payload.executorRef || payload.executor_ref || name,
    capability: payload.capability || payload.mode,
    icon: payload.icon,
    modelProvider: payload.modelProvider || payload.model_provider || payload.provider,
    model: payload.model || payload.modelName || payload.model_name,
    ...(inputSchema ? { inputSchema } : {}),
  });
  if (!tool) return normalized;
  return normalizeSmartFactoryConfig({
    ...normalized,
    tools: [...normalized.tools.filter((item) => item.name !== tool.name), tool],
  });
};

export const deleteSmartFactoryTool = (current = createDefaultSmartFactoryConfig(), toolName = '') => {
  const normalized = normalizeSmartFactoryConfig(current);
  const name = text(toolName, 120);
  return normalizeSmartFactoryConfig({
    ...normalized,
    tools: normalized.tools.filter((tool) => tool.name !== name),
    agents: normalized.agents.map((agent) => ({
      ...agent,
      toolNames: (agent.toolNames || []).filter((item) => item !== name),
    })),
  });
};

export const getSmartFactoryPublicConfig = (config = createDefaultSmartFactoryConfig()) => {
  const normalized = normalizeSmartFactoryConfig(config);
  return {
    mode: 'production',
    modelProviders: normalized.modelProviders.map((provider) => ({
      provider: provider.provider,
      displayName: provider.displayName || provider.provider,
      baseUrl: provider.baseUrl || '',
      defaultModel: provider.defaultModel || provider.models[0]?.id || '',
      fallbackModel: provider.fallbackModel || '',
      hasCredential: Boolean(provider.credentialRef),
      models: provider.models.map((model) => ({
        id: model.id,
        mode: model.mode,
        features: model.features || [],
      })),
    })),
    models: normalized.modelProviders.flatMap((provider) => provider.models.map((model) => ({
      provider: provider.provider,
      name: model.id,
      mode: model.mode,
      features: model.features || [],
    }))),
    knowledgeBases: normalized.knowledgeBases.map((knowledgeBase) => ({
      id: knowledgeBase.id,
      name: knowledgeBase.name,
      description: knowledgeBase.description || '',
      status: knowledgeBase.status,
      documentCount: knowledgeBase.documentCount,
      readyDocumentCount: knowledgeBase.readyDocumentCount || 0,
      failedDocumentCount: knowledgeBase.failedDocumentCount || 0,
      chunkCount: knowledgeBase.chunkCount,
      retrievalPolicy: knowledgeBase.retrievalPolicy || normalizeSmartFactoryRetrievalPolicy(),
      embeddingModel: knowledgeBase.embeddingModel || null,
      rerankModel: knowledgeBase.rerankModel || null,
      documents: knowledgeBase.documents.map((document) => ({
        id: document.id,
        title: document.title,
        fileName: document.fileName || '',
        sourceType: document.sourceType || 'text',
        preview: text(document.content, 180),
        status: document.status,
        error: document.error || '',
        chunkStrategy: document.chunkStrategy || 'general',
        maxChunkChars: document.maxChunkChars || 0,
        chunkCount: document.chunkCount,
        updatedAt: document.updatedAt || 0,
      })),
    })),
    tools: normalized.tools.map((tool) => ({
      name: tool.name,
      type: tool.type,
      description: tool.description || '',
      authorized: tool.enabled !== false,
      riskLevel: tool.riskLevel || 'safe',
      executorRef: tool.executorRef || '',
      capability: tool.capability || '',
      icon: tool.icon || '',
      modelProvider: tool.modelProvider || '',
      model: tool.model || '',
      inputSchema: tool.inputSchema || {},
    })),
    agents: normalized.agents.map((agent) => ({
      id: agent.id,
      name: agent.name,
      description: agent.description || '',
      prompt: agent.prompt || '',
      enabled: agent.enabled !== false,
      status: agent.status || 'draft',
      publishedAt: agent.publishedAt || 0,
      model: agent.model || {},
      knowledgeBaseIds: agent.knowledgeBaseIds || [],
      toolNames: agent.toolNames || [],
      variables: normalizeVariables(agent.variables),
      metadataFilters: normalizeMetadataFilters(agent.metadataFilters),
      vision: normalizeVision(agent.vision),
      updatedAt: agent.updatedAt || 0,
    })),
    sessions: normalized.sessions.map((session) => ({
      id: session.id,
      agentId: session.agentId,
      title: session.title,
      messageCount: session.messages.length,
      messages: session.messages,
    })),
    runLogs: normalized.sessions.flatMap((session) => session.messages
      .filter((message) => message.role === 'assistant' && Array.isArray(message.trace) && message.trace.length)
      .map((message) => ({
        id: message.id,
        sessionId: session.id,
        agentId: session.agentId,
        createdAt: message.createdAt,
        trace: message.trace,
      }))).slice(-20),
  };
};

const selectAgent = (config, options = {}) => {
  const agentId = text(options.agentId, 120);
  return config.agents.find((agent) => agent.enabled && agent.id === agentId)
    || config.agents.find((agent) => agent.enabled)
    || config.agents[0];
};

export const toSmartFactoryRuntimeInputs = (config = createDefaultSmartFactoryConfig(), options = {}) => {
  const normalized = normalizeSmartFactoryConfig(config);
  const selectedAgent = selectAgent(normalized, options);
  const selectedModel = selectSmartFactoryModel(normalized.modelProviders, selectedAgent?.model || {});
  const modelCatalog = toModelCatalog(normalized.modelProviders);
  const knowledgeBaseIds = new Set((selectedAgent?.knowledgeBaseIds || []).filter(Boolean));
  const boundKnowledgeBases = normalized.knowledgeBases.filter((knowledgeBase) => (
    knowledgeBaseIds.size === 0 || knowledgeBaseIds.has(knowledgeBase.id)
  ));
  const selectedKnowledgeBases = boundKnowledgeBases.length ? boundKnowledgeBases : normalized.knowledgeBases;
  const toolNames = new Set((selectedAgent?.toolNames || []).filter(Boolean));
  const boundTools = normalized.tools.filter((tool) => (
    toolNames.size === 0 || toolNames.has(tool.name)
  ));
  const selectedTools = boundTools.length ? boundTools : normalized.tools;
  const runtimeCliTools = toRuntimeCliTools(selectedTools);
  const runtimeBuiltinTools = toRuntimeBuiltinTools(selectedTools);
  return {
    selectedAgent,
    modelCatalog,
    agentConfig: {
      prompt: {
        system_prompt: selectedAgent?.prompt || '你是梅奥智能工厂试运行智能体。',
      },
      model: {
        plugin_id: 'openai-compatible',
        model_provider: selectedModel.provider,
        model: selectedModel.model.id,
      },
      knowledge: {
        datasets: selectedKnowledgeBases.map((knowledgeBase) => ({
          id: knowledgeBase.id,
          name: knowledgeBase.name,
          retrievalPolicy: knowledgeBase.retrievalPolicy || normalizeSmartFactoryRetrievalPolicy(),
          embeddingModel: knowledgeBase.embeddingModel,
          rerankModel: knowledgeBase.rerankModel,
        })),
      },
      tools: {
        cli_tools: runtimeCliTools,
        builtin_tools: runtimeBuiltinTools,
      },
      variables: selectedAgent?.variables || [],
      metadataFilters: selectedAgent?.metadataFilters || [],
      vision: selectedAgent?.vision || normalizeVision(),
    },
    knowledgeChunks: selectedKnowledgeBases.flatMap((knowledgeBase) => (
      knowledgeBase.documents.flatMap((document) => (
        (document.chunks || []).map((chunk) => ({
          knowledgeBaseId: knowledgeBase.id,
          documentId: document.id,
          chunkId: chunk.id,
          chunkIndex: chunk.chunkIndex ?? chunk.index ?? 0,
          title: chunk.title || document.title,
          content: chunk.content,
          sourceType: chunk.sourceType || document.sourceType || 'text',
          ...(chunk.embedding ? { embedding: chunk.embedding } : {}),
          ...(chunk.embeddingModel ? { embeddingModel: chunk.embeddingModel } : {}),
          ...(chunk.embeddedAt ? { embeddedAt: chunk.embeddedAt } : {}),
        }))
      ))
    )),
    cliToolExecutors: createCliToolExecutors(selectedTools),
    builtinToolExecutors: createBuiltinMediaToolExecutors(selectedTools),
  };
};
