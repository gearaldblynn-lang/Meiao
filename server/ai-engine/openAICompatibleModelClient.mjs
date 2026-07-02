const clean = (value, max = 5000) => String(value ?? '').trim().slice(0, max);
const asArray = (value) => (Array.isArray(value) ? value : []);
const asRecord = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {});

const CHAT_COMPLETIONS_PATH = '/chat/completions';
const EMBEDDINGS_PATH = '/embeddings';

export const resolveSmartFactoryCredentialRef = (credentialRef = '', env = process.env) => {
  const ref = clean(credentialRef, 240);
  if (!ref.startsWith('env:')) return '';
  const key = clean(ref.slice(4), 120);
  return key ? clean(env?.[key], 4000) : '';
};

const normalizeBaseUrl = (baseUrl = '') => {
  const value = clean(baseUrl, 500).replace(/\/$/, '');
  if (!value) throw new Error('模型供应商缺少 Base URL。');
  return value;
};

const toOpenAITools = (tools = []) => asArray(tools)
  .map((tool) => {
    const record = asRecord(tool);
    const name = clean(record.name || record.function?.name, 120);
    if (!name) return null;
    return {
      type: 'function',
      function: {
        name,
        description: clean(record.description || record.function?.description || name, 1000),
        parameters: asRecord(record.parameters || record.function?.parameters).type
          ? asRecord(record.parameters || record.function?.parameters)
          : { type: 'object', properties: {}, additionalProperties: true },
      },
    };
  })
  .filter(Boolean);

const toOpenAIMessages = ({ systemPrompt = '', messages = [] } = {}) => {
  const result = [];
  const prompt = clean(systemPrompt, 20000);
  if (prompt) result.push({ role: 'system', content: prompt });
  for (const message of asArray(messages)) {
    const role = clean(message?.role || 'user', 40);
    if (!['system', 'user', 'assistant', 'tool'].includes(role)) continue;
    const content = message?.content == null ? '' : String(message.content);
    result.push({ role, content });
  }
  return result;
};

const parseToolArguments = (value) => {
  if (typeof value !== 'string') return asRecord(value);
  try {
    return asRecord(JSON.parse(value || '{}'));
  } catch {
    return {};
  }
};

const parseModelsText = (modelsText = '') => clean(modelsText, 5000)
  .split(/[\n,，]+/)
  .map((line) => clean(line, 220))
  .filter(Boolean)
  .map((line) => {
    const separatorIndex = line.indexOf(':');
    if (separatorIndex < 0) return { id: line, mode: 'chat' };
    return {
      mode: clean(line.slice(0, separatorIndex), 40) || 'chat',
      id: clean(line.slice(separatorIndex + 1), 160),
    };
  })
  .filter((model) => model.id);

const normalizeToolCall = (toolCall = {}) => {
  const fn = asRecord(toolCall.function);
  const name = clean(toolCall.name || fn.name, 120);
  if (!name) return null;
  return {
    ...(toolCall.id ? { id: clean(toolCall.id, 160) } : {}),
    name,
    args: parseToolArguments(toolCall.args ?? fn.arguments),
  };
};

const parseOpenAICompatibleResponse = (payload = {}) => {
  const message = asRecord(asArray(payload.choices)[0]?.message);
  const toolCalls = asArray(message.tool_calls || message.toolCalls)
    .map(normalizeToolCall)
    .filter(Boolean);
  if (message.function_call) {
    const legacyCall = normalizeToolCall({ function: message.function_call });
    if (legacyCall) toolCalls.push(legacyCall);
  }
  return {
    content: message.content == null ? '' : String(message.content),
    toolCalls,
    raw: payload,
  };
};

export const callOpenAICompatibleChatModel = async ({
  provider = {},
  modelRequest = {},
  env = process.env,
  fetchImpl = globalThis.fetch,
  signal,
} = {}) => {
  if (typeof fetchImpl !== 'function') throw new Error('当前运行环境不支持 fetch。');
  const baseUrl = normalizeBaseUrl(provider.baseUrl);
  const apiKey = resolveSmartFactoryCredentialRef(provider.credentialRef, env);
  if (!apiKey) throw new Error(`模型供应商 ${clean(provider.provider || '') || 'unknown'} 缺少可用 API Key。`);
  const modelName = clean(modelRequest.model?.name || modelRequest.model?.id || modelRequest.model?.model, 160);
  if (!modelName) throw new Error('模型请求缺少 model。');
  const body = {
    model: modelName,
    messages: toOpenAIMessages(modelRequest),
    temperature: Number(modelRequest.temperature ?? 0.2),
    ...(asArray(modelRequest.tools).length ? {
      tools: toOpenAITools(modelRequest.tools),
      tool_choice: 'auto',
    } : {}),
  };
  const response = await fetchImpl(`${baseUrl}${CHAT_COMPLETIONS_PATH}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
    signal,
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) {
    const message = payload?.error?.message || payload?.message || `模型供应商请求失败：HTTP ${response.status}`;
    throw new Error(clean(message, 1000));
  }
  return parseOpenAICompatibleResponse(payload);
};

export const testOpenAICompatibleModelProvider = async (provider = {}, options = {}) => {
  const models = asArray(provider.models).length ? asArray(provider.models) : parseModelsText(provider.modelsText);
  const chatModel = models.find((model) => clean(model?.mode || 'chat') === 'chat') || models[0];
  const modelName = clean(chatModel?.id || chatModel?.name || provider.defaultModel, 160);
  if (!modelName) return { ok: false, message: '请至少配置一个对话模型。' };
  try {
    await callOpenAICompatibleChatModel({
      provider,
      modelRequest: {
        model: { name: modelName },
        systemPrompt: 'Return a short health check response.',
        messages: [{ role: 'user', content: 'ping' }],
        tools: [],
      },
      env: options.env,
      fetchImpl: options.fetchImpl,
      signal: options.signal,
    });
    return { ok: true, message: '真实模型连接可用。' };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : '真实模型连接测试失败。',
    };
  }
};

export const callOpenAICompatibleEmbeddingModel = async ({
  provider = {},
  model = '',
  input = [],
  env = process.env,
  fetchImpl = globalThis.fetch,
  signal,
} = {}) => {
  if (typeof fetchImpl !== 'function') throw new Error('当前运行环境不支持 fetch。');
  const baseUrl = normalizeBaseUrl(provider.baseUrl);
  const apiKey = resolveSmartFactoryCredentialRef(provider.credentialRef, env);
  if (!apiKey) throw new Error(`模型供应商 ${clean(provider.provider || '') || 'unknown'} 缺少可用 API Key。`);
  const modelName = clean(model, 160);
  if (!modelName) throw new Error('Embedding 请求缺少 model。');
  const list = asArray(input).map((item) => String(item ?? '')).filter((item) => item.trim());
  if (!list.length) return [];
  const response = await fetchImpl(`${baseUrl}${EMBEDDINGS_PATH}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: modelName,
      input: list,
    }),
    signal,
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) {
    const message = payload?.error?.message || payload?.message || `Embedding 请求失败：HTTP ${response.status}`;
    throw new Error(clean(message, 1000));
  }
  const embeddings = asArray(payload.data)
    .sort((a, b) => Number(a?.index ?? 0) - Number(b?.index ?? 0))
    .map((item) => item?.embedding)
    .filter((item) => Array.isArray(item));
  if (embeddings.length !== list.length) throw new Error('Embedding 响应数量与输入数量不一致。');
  return embeddings;
};
