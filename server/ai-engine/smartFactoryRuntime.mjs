import { normalizeSmartFactoryAgentConfig } from './agentConfigSchema.mjs';
import { validateModelConfig } from './modelConfigValidator.mjs';
import {
  convertToolMessagesToObservation,
  createKnowledgeSearchToolDefinition,
} from './toolContract.mjs';

const asRecord = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {});
const asArray = (value) => (Array.isArray(value) ? value : []);
const cleanString = (value) => String(value ?? '').trim();

const AUTHORIZED_CLI_STATUSES = new Set([
  'authorized',
  'pre_authorized',
  'allowed',
  'not_required',
]);

const DEFAULT_TOOL_PARAMETERS = {
  type: 'object',
  properties: {
    input: {
      type: 'string',
      description: 'Natural language input for this registered tool.',
    },
  },
  required: ['input'],
  additionalProperties: false,
};

const hasKnowledgeDatasets = (config = {}) => asArray(config.knowledge?.datasets).length > 0;

const isModelVisibleCliTool = (tool = {}) => {
  if (tool.enabled === false) return false;
  if (!AUTHORIZED_CLI_STATUSES.has(cleanString(tool.authorization_status))) return false;
  if (cleanString(tool.risk_level) === 'dangerous') return false;
  if (tool.requires_confirmation) return false;
  return Boolean(cleanString(tool.name));
};

const isModelVisibleBuiltinTool = (tool = {}) => {
  if (tool.enabled === false) return false;
  if (!AUTHORIZED_CLI_STATUSES.has(cleanString(tool.authorization_status))) return false;
  if (cleanString(tool.risk_level) === 'dangerous') return false;
  if (tool.requires_confirmation) return false;
  return Boolean(cleanString(tool.name));
};

const buildCliToolDefinition = (tool = {}) => ({
  type: 'function',
  name: cleanString(tool.name),
  description: cleanString(tool.description || tool.label || tool.name),
  parameters: asRecord(tool.invoke_metadata?.parameters).type
    ? asRecord(tool.invoke_metadata.parameters)
    : DEFAULT_TOOL_PARAMETERS,
});

const buildBuiltinToolDefinition = (tool = {}) => ({
  type: 'function',
  name: cleanString(tool.name),
  description: cleanString(tool.description || tool.label || tool.name),
  parameters: asRecord(tool.invoke_metadata?.parameters).type
    ? asRecord(tool.invoke_metadata.parameters)
    : DEFAULT_TOOL_PARAMETERS,
});

const normalizeMessages = (messages = []) => asArray(messages)
  .map((message) => {
    const item = asRecord(message);
    const role = cleanString(item.role || 'user') || 'user';
    return {
      role,
      content: item.content == null ? '' : item.content,
    };
  })
  .filter((message) => message.role && message.content !== '');

const toModelConfigForValidation = (config = {}) => ({
  model: {
    provider: config.model?.model_provider,
    name: config.model?.model,
    completion_params: config.model?.model_settings || {},
  },
});

const parseToolArgs = (args = {}) => {
  if (typeof args === 'string') return asRecord(JSON.parse(args || '{}'));
  return asRecord(args);
};

const getConfiguredDatasetIds = (config = {}) => new Set(
  asArray(config.knowledge?.datasets)
    .map((dataset) => cleanString(dataset.id))
    .filter(Boolean),
);

const getPrimaryDatasetRetrievalPolicy = (config = {}, datasetIds = new Set()) => {
  const dataset = asArray(config.knowledge?.datasets)
    .find((item) => datasetIds.has(cleanString(item.id)));
  return asRecord(dataset?.retrievalPolicy || dataset?.retrieval_policy);
};

const filterKnowledgeChunksByDataset = (chunks = [], datasetIds = new Set()) => {
  if (datasetIds.size === 0) return [];
  return asArray(chunks).filter((chunk) => {
    const datasetId = cleanString(chunk?.knowledgeBaseId || chunk?.datasetId || chunk?.dataset_id || chunk?.knowledge_base_id);
    return datasetIds.has(datasetId);
  });
};

const defaultSearchKnowledge = (query, chunks = []) => {
  const normalizedQuery = cleanString(query).toLowerCase();
  if (!normalizedQuery) return [];
  return asArray(chunks).filter((chunk) => {
    const haystack = `${chunk?.title || ''}\n${chunk?.content || chunk?.text || ''}`.toLowerCase();
    return haystack.includes(normalizedQuery);
  }).slice(0, 5);
};

const formatKnowledgeSearchObservation = (chunks = []) => {
  const text = asArray(chunks)
    .map((chunk, index) => {
      const title = cleanString(chunk?.title || chunk?.documentName || chunk?.sourceName) || `chunk ${index + 1}`;
      const content = cleanString(chunk?.content || chunk?.text);
      return content ? `[${title}]\n${content}` : '';
    })
    .filter(Boolean)
    .join('\n\n');
  return convertToolMessagesToObservation([
    { type: 'text', message: { text: text || 'No matching knowledge chunks found.' } },
  ]);
};

const getExecutableCliTools = (config = {}) => new Map(
  asArray(config.tools?.cli_tools)
    .filter(isModelVisibleCliTool)
    .map((tool) => [cleanString(tool.name), tool]),
);

const getExecutableBuiltinTools = (config = {}) => new Map(
  asArray(config.tools?.builtin_tools)
    .filter(isModelVisibleBuiltinTool)
    .map((tool) => [cleanString(tool.name), tool]),
);

const normalizeExecutorMessages = (value) => {
  if (Array.isArray(value)) return value;
  const record = asRecord(value);
  if (Array.isArray(record.messages)) return record.messages;
  if (record.url) return [{ type: 'link', message: { text: cleanString(record.url) } }];
  return [{ type: 'text', message: { text: cleanString(record.text || record.content || JSON.stringify(record)) } }];
};

export const buildSmartFactoryModelRequest = ({
  agentConfig = {},
  modelCatalog = [],
  messages = [],
} = {}) => {
  const normalizedConfig = normalizeSmartFactoryAgentConfig(agentConfig);
  const validatedModel = validateModelConfig(toModelConfigForValidation(normalizedConfig), modelCatalog);
  const tools = [];

  if (hasKnowledgeDatasets(normalizedConfig)) {
    tools.push(createKnowledgeSearchToolDefinition());
  }

  for (const tool of normalizedConfig.tools.cli_tools.filter(isModelVisibleCliTool)) {
    tools.push(buildCliToolDefinition(tool));
  }

  for (const tool of normalizedConfig.tools.builtin_tools.filter(isModelVisibleBuiltinTool)) {
    tools.push(buildBuiltinToolDefinition(tool));
  }

  return {
    model: validatedModel.model,
    systemPrompt: normalizedConfig.prompt.system_prompt,
    messages: normalizeMessages(messages),
    tools,
    trace: {
      event: 'model_request_built',
      modelProvider: validatedModel.model.provider,
      modelName: validatedModel.model.name,
      toolCount: tools.length,
      knowledgeDatasetCount: normalizedConfig.knowledge.datasets.length,
      cliToolCount: normalizedConfig.tools.cli_tools.filter(isModelVisibleCliTool).length,
      builtinToolCount: normalizedConfig.tools.builtin_tools.filter(isModelVisibleBuiltinTool).length,
    },
  };
};

export const createSmartFactoryRunContext = ({
  agentConfig = {},
  modelCatalog = [],
  knowledgeChunks = [],
  searchKnowledge = defaultSearchKnowledge,
  cliToolExecutors = {},
  builtinToolExecutors = {},
  messages = [],
  env = process.env,
  signal,
} = {}) => {
  const normalizedConfig = normalizeSmartFactoryAgentConfig(agentConfig);
  const modelRequest = buildSmartFactoryModelRequest({
    agentConfig: normalizedConfig,
    modelCatalog,
    messages,
  });
  return {
    agentConfig: normalizedConfig,
    modelCatalog,
    modelRequest,
    knowledgeChunks: asArray(knowledgeChunks),
    searchKnowledge,
    cliTools: getExecutableCliTools(normalizedConfig),
    builtinTools: getExecutableBuiltinTools(normalizedConfig),
    cliToolExecutors: asRecord(cliToolExecutors),
    builtinToolExecutors: asRecord(builtinToolExecutors),
    env,
    signal,
  };
};

export const executeSmartFactoryToolCall = async ({ context = {}, toolCall = {} } = {}) => {
  const name = cleanString(toolCall.name || toolCall.function?.name);
  const args = parseToolArgs(toolCall.args || toolCall.function?.arguments);
  if (name === 'knowledge_base_search') {
    const query = cleanString(args.query);
    if (!query) throw new Error('knowledge_base_search requires query');
    const datasetIds = getConfiguredDatasetIds(context.agentConfig);
    const retrievalPolicy = getPrimaryDatasetRetrievalPolicy(context.agentConfig, datasetIds);
    const scopedChunks = filterKnowledgeChunksByDataset(context.knowledgeChunks, datasetIds);
    const matchedChunks = await context.searchKnowledge(query, scopedChunks, {
      datasets: Array.from(datasetIds),
      ...retrievalPolicy,
    });
    return {
      name,
      observation: formatKnowledgeSearchObservation(matchedChunks),
      trace: {
        event: 'tool_call_completed',
        toolName: name,
        resultCount: asArray(matchedChunks).length,
      },
    };
  }
  const cliTool = context.cliTools?.get?.(name);
  if (cliTool) {
    const executor = context.cliToolExecutors?.[name];
    if (typeof executor !== 'function') {
      throw new Error(`Smart Factory CLI tool executor is not registered: ${name}`);
    }
    const messages = await executor({ args, tool: cliTool, context, env: context.env });
    return {
      name,
      observation: convertToolMessagesToObservation(normalizeExecutorMessages(messages)),
      trace: {
        event: 'tool_call_completed',
        toolName: name,
      },
    };
  }
  const builtinTool = context.builtinTools?.get?.(name);
  if (builtinTool) {
    const executor = context.builtinToolExecutors?.[name];
    if (typeof executor !== 'function') {
      throw new Error(`Smart Factory builtin tool executor is not registered: ${name}`);
    }
    const messages = await executor({ args, tool: builtinTool, context, env: context.env });
    return {
      name,
      observation: convertToolMessagesToObservation(normalizeExecutorMessages(messages)),
      trace: {
        event: 'tool_call_completed',
        toolName: name,
        executorRef: cleanString(builtinTool.executorRef || builtinTool.executor_ref),
        capability: cleanString(builtinTool.capability),
        modelProvider: cleanString(builtinTool.modelProvider || builtinTool.model_provider),
        modelName: cleanString(builtinTool.model),
      },
    };
  }
  throw new Error(`Unknown Smart Factory tool: ${name}`);
};

export const runSmartFactoryTurn = async ({
  agentConfig = {},
  modelCatalog = [],
  messages = [],
  callModel,
  knowledgeChunks = [],
  searchKnowledge = defaultSearchKnowledge,
  cliToolExecutors = {},
  builtinToolExecutors = {},
  env = process.env,
  signal,
} = {}) => {
  if (typeof callModel !== 'function') throw new Error('runSmartFactoryTurn requires callModel');
  const context = createSmartFactoryRunContext({
    agentConfig,
    modelCatalog,
    messages,
    knowledgeChunks,
    searchKnowledge,
    cliToolExecutors,
    builtinToolExecutors,
    env,
    signal,
  });
  const trace = [context.modelRequest.trace];
  const modelResponse = await callModel(context.modelRequest);
  trace.push({
    event: 'model_response_received',
    hasContent: Boolean(cleanString(modelResponse?.content)),
    toolCallCount: asArray(modelResponse?.toolCalls).length,
  });
  const toolResults = [];
  for (const toolCall of asArray(modelResponse?.toolCalls)) {
    const toolName = cleanString(toolCall?.name || toolCall?.function?.name);
    trace.push({ event: 'tool_call_started', toolName });
    const toolResult = await executeSmartFactoryToolCall({ context, toolCall });
    toolResults.push(toolResult);
    trace.push(toolResult.trace);
  }
  return {
    modelRequest: context.modelRequest,
    modelResponse,
    toolResults,
    trace,
  };
};
