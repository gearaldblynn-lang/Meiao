import { runSmartFactoryTurn } from './ai-engine/smartFactoryRuntime.mjs';
import {
  callOpenAICompatibleChatModel,
  callOpenAICompatibleEmbeddingModel,
  testOpenAICompatibleModelProvider,
} from './ai-engine/openAICompatibleModelClient.mjs';
import {
  createDefaultSmartFactoryConfig,
  getSmartFactoryPublicConfig,
  normalizeSmartFactoryConfig,
  toSmartFactoryRuntimeInputs,
} from './smartFactoryConfigStore.mjs';
import { searchSmartFactoryKnowledge } from './ai-engine/knowledgeRetrieval.mjs';

const includesAny = (text = '', values = []) => values.some((item) => String(text || '').includes(item));

const createPreviewModelCaller = (message = '') => async () => {
  const text = String(message || '');
  if (includesAny(text, ['飞书', '表格', '日报'])) {
    return {
      content: '',
      toolCalls: [{
        name: 'feishu_create_sheet',
        args: { title: text.includes('日报') ? '日报' : '智能工厂表格' },
      }],
    };
  }
  return {
    content: '',
    toolCalls: [{
      name: 'knowledge_base_search',
      args: { query: text },
    }],
  };
};

const compactModelRequest = (request = {}) => ({
  model: request.model,
  systemPrompt: request.systemPrompt,
  messages: request.messages,
  tools: request.tools,
});

const selectRuntimeModelProvider = (smartFactoryConfig = {}, providerId = '') => {
  const normalized = normalizeSmartFactoryConfig(smartFactoryConfig);
  const provider = normalized.modelProviders.find((item) => item.provider === providerId);
  if (!provider) throw new Error(`模型供应商不存在：${providerId}`);
  return provider;
};

const createRealModelCaller = ({
  smartFactoryConfig = createDefaultSmartFactoryConfig(),
  env = process.env,
  fetchImpl = globalThis.fetch,
  signal,
} = {}) => async (modelRequest) => {
  const provider = selectRuntimeModelProvider(smartFactoryConfig, modelRequest.model?.provider);
  return callOpenAICompatibleChatModel({
    provider,
    modelRequest,
    env,
    fetchImpl,
    signal,
  });
};

const createSmartFactoryKnowledgeSearcher = ({
  smartFactoryConfig = createDefaultSmartFactoryConfig(),
  env = process.env,
  fetchImpl = globalThis.fetch,
  signal,
} = {}) => {
  const normalized = normalizeSmartFactoryConfig(smartFactoryConfig);
  return async (query, chunks = [], options = {}) => {
    const datasetIds = Array.isArray(options.datasets) ? options.datasets : [];
    const knowledgeBase = normalized.knowledgeBases.find((item) => (
      (datasetIds.length === 0 || datasetIds.includes(item.id))
      && item.embeddingModel?.provider
      && item.embeddingModel?.model
      && item.documents.some((document) => (
        (document.chunks || []).some((chunk) => Array.isArray(chunk.embedding) && chunk.embedding.length)
      ))
    ));
    if (!knowledgeBase) return searchSmartFactoryKnowledge(query, chunks, options);
    const provider = normalized.modelProviders.find((item) => item.provider === knowledgeBase.embeddingModel.provider);
    if (!provider) return searchSmartFactoryKnowledge(query, chunks, options);
    try {
      const [queryEmbedding] = await callOpenAICompatibleEmbeddingModel({
        provider,
        model: knowledgeBase.embeddingModel.model,
        input: [query],
        env,
        fetchImpl,
        signal,
      });
      return searchSmartFactoryKnowledge(query, chunks, {
        ...options,
        queryEmbedding,
      });
    } catch {
      return searchSmartFactoryKnowledge(query, chunks, options);
    }
  };
};

export const getSmartFactoryPreviewConfig = ({
  smartFactoryConfig = createDefaultSmartFactoryConfig(),
} = {}) => {
  return getSmartFactoryPublicConfig(smartFactoryConfig);
};

const selectPublishedAgentId = (smartFactoryConfig, agentId = '') => {
  const normalized = normalizeSmartFactoryConfig(smartFactoryConfig);
  const requested = String(agentId || '').trim();
  const agent = requested
    ? normalized.agents.find((item) => item.id === requested)
    : normalized.agents.find((item) => item.enabled && item.status === 'published');
  if (!agent) throw new Error('未找到可用智能体。');
  if (agent.status !== 'published') throw new Error('智能体尚未发布，不能在正式对话中使用。');
  return agent.id;
};

export const testSmartFactoryKnowledgeSearch = ({
  query = '',
  knowledgeBaseIds = [],
  retrievalPolicy = {},
  smartFactoryConfig = createDefaultSmartFactoryConfig(),
} = {}) => {
  const { knowledgeChunks, agentConfig } = toSmartFactoryRuntimeInputs(smartFactoryConfig);
  const selectedDatasetPolicies = (agentConfig.knowledge?.datasets || [])
    .filter((dataset) => knowledgeBaseIds.length === 0 || knowledgeBaseIds.includes(dataset.id))
    .map((dataset) => dataset.retrievalPolicy)
    .filter(Boolean);
  const basePolicy = selectedDatasetPolicies[0] || {};
  const results = searchSmartFactoryKnowledge(query, knowledgeChunks, {
    datasets: knowledgeBaseIds,
    ...basePolicy,
    ...retrievalPolicy,
    limit: retrievalPolicy.limit ?? retrievalPolicy.topK ?? basePolicy.topK ?? 8,
  });
  return {
    query: String(query || '').trim(),
    retrievalPolicy: {
      ...basePolicy,
      ...retrievalPolicy,
    },
    results,
  };
};

export const runSmartFactoryPreviewTurn = async ({
  message = '',
  smartFactoryConfig = createDefaultSmartFactoryConfig(),
  agentId = '',
  env = process.env,
  fetchImpl = globalThis.fetch,
  signal,
  callModel,
} = {}) => {
  const userMessage = String(message || '').trim() || '退货规则是什么';
  const selectedAgentId = selectPublishedAgentId(smartFactoryConfig, agentId);
  const { agentConfig, modelCatalog, knowledgeChunks, cliToolExecutors, builtinToolExecutors, selectedAgent } = toSmartFactoryRuntimeInputs(smartFactoryConfig, { agentId: selectedAgentId });
  const searchKnowledge = createSmartFactoryKnowledgeSearcher({
    smartFactoryConfig,
    env,
    fetchImpl,
    signal,
  });
  const result = await runSmartFactoryTurn({
    agentConfig,
    modelCatalog,
    messages: [{ role: 'user', content: userMessage }],
    knowledgeChunks,
    searchKnowledge,
    cliToolExecutors,
    builtinToolExecutors,
    env,
    signal,
    callModel: callModel || createRealModelCaller({
      smartFactoryConfig,
      env,
      fetchImpl,
      signal,
    }),
  });
  const citationQuery = userMessage;
  const citations = await searchKnowledge(citationQuery, knowledgeChunks, {
    datasets: agentConfig.knowledge?.datasets?.map((dataset) => dataset.id) || [],
    ...(agentConfig.knowledge?.datasets?.[0]?.retrievalPolicy || {}),
    limit: agentConfig.knowledge?.datasets?.[0]?.retrievalPolicy?.topK || 5,
  });
  const modelTrace = result.trace.find((item) => item.event === 'model_request_built') || {};
  const toolCalls = result.toolResults.map((item) => item.name);
  return {
    mode: 'production',
    agentId: selectedAgent?.id || '',
    answer: result.toolResults[0]?.observation || result.modelResponse?.content || '',
    modelRequest: compactModelRequest(result.modelRequest),
    toolResults: result.toolResults,
    citations,
    trace: result.trace,
    runLog: {
      id: `run-${Date.now()}`,
      agentId: selectedAgent?.id || '',
      modelProvider: modelTrace.modelProvider || agentConfig.model?.model_provider || '',
      modelName: modelTrace.modelName || agentConfig.model?.model || '',
      knowledgeRefs: citations.map((item) => ({
        knowledgeBaseId: item.knowledgeBaseId,
        documentId: item.documentId,
        title: item.title,
        score: item.score,
      })),
      toolCalls,
      trace: result.trace,
    },
  };
};

export const testSmartFactoryModelProviderConnection = async (payload = {}, options = {}) => (
  testOpenAICompatibleModelProvider(payload, options)
);
