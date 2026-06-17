const DEFAULT_TIMEOUT_MS = Number(process.env.OPENAI_COMPATIBLE_TIMEOUT_MS || 240000);

const getRelayConfig = (env = {}) => {
  const apiKey = String(env.OPENAI_COMPATIBLE_API_KEY || '').trim();
  const baseUrl = String(env.OPENAI_COMPATIBLE_BASE_URL || 'https://maxforai.top').trim().replace(/\/$/, '');
  const responsesPath = String(env.OPENAI_COMPATIBLE_RESPONSES_PATH || '/v1/responses').trim() || '/v1/responses';
  const allowedModels = String(env.OPENAI_COMPATIBLE_MODELS || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return { apiKey, baseUrl, responsesPath: responsesPath.startsWith('/') ? responsesPath : `/${responsesPath}`, allowedModels };
};

export const toResponsesTool = (tool) => {
  if (tool?.type === 'function' && tool.function) {
    return {
      type: 'function',
      name: tool.function.name,
      description: tool.function.description,
      parameters: tool.function.parameters,
    };
  }
  return tool;
};

const normalizeResponsesContentPart = (part = {}) => {
  const type = String(part?.type || '').trim();
  if (type === 'text' || type === 'input_text') {
    return { type: 'input_text', text: String(part?.text || '') };
  }
  if (type === 'image_url' || type === 'input_image') {
    const imageUrl = String(
      part?.image_url && typeof part.image_url === 'object'
        ? part.image_url.url || ''
        : part?.image_url || part?.url || ''
    ).trim();
    if (!imageUrl) return null;
    return { type: 'input_image', image_url: imageUrl };
  }
  return part;
};

const normalizeResponsesInputMessage = (message = {}) => {
  if (message?.type === 'function_call' || message?.type === 'function_call_output') return message;
  if (!Array.isArray(message?.content)) return message;
  return {
    ...message,
    content: message.content
      .map((part) => normalizeResponsesContentPart(part))
      .filter(Boolean),
  };
};

export const parseResponsesOutput = (data = {}) => {
  const items = Array.isArray(data?.output) ? data.output : [];
  let content = '';
  const toolCalls = [];
  for (const item of items) {
    if (item?.type === 'message') {
      content += (Array.isArray(item.content) ? item.content : [])
        .map((part) => String(part?.text || ''))
        .join('');
      continue;
    }
    if (item?.type === 'function_call') {
      const name = String(item?.name || '').trim();
      if (!name) continue;
      let args;
      try {
        args = JSON.parse(String(item?.arguments || '{}'));
      } catch {
        continue;
      }
      const callId = String(item?.call_id || item?.id || '');
      toolCalls.push({
        id: callId,
        name,
        args,
        responseItem: {
          type: 'function_call',
          ...(item?.id ? { id: String(item.id) } : {}),
          name,
          arguments: String(item?.arguments || '{}'),
          call_id: callId,
          ...(item?.status ? { status: String(item.status) } : {}),
        },
      });
    }
  }
  return {
    content: content.trim(),
    toolCalls,
    finishReason: toolCalls.length > 0 ? 'tool_calls' : 'stop',
    usage: data?.usage || {},
  };
};

export const runResponsesJob = async ({ payload = {}, env = {}, signal = null } = {}) => {
  const { apiKey, baseUrl, responsesPath, allowedModels } = getRelayConfig(env);
  if (!apiKey) {
    const error = new Error('OPENAI_COMPATIBLE_API_KEY 未配置');
    error.code = 'provider_config_missing';
    throw error;
  }
  const model = String(payload?.model || '').trim();
  if (allowedModels.length > 0 && !allowedModels.includes(model)) {
    const error = new Error(`模型 ${model} 不在白名单中（允许：${allowedModels.join(', ')}）`);
    error.code = 'provider_bad_request';
    throw error;
  }

  const input = Array.isArray(payload?.input)
    ? payload.input.map((message) => normalizeResponsesInputMessage(message))
    : (Array.isArray(payload?.messages) ? payload.messages.map((message) => normalizeResponsesInputMessage(message)) : []);
  const tools = (Array.isArray(payload?.tools) ? payload.tools : []).map(toResponsesTool);
  const reasoningLevel = String(payload?.reasoningLevel || '').trim();
  const body = {
    model,
    input,
    ...(tools.length > 0 ? { tools } : {}),
    ...(reasoningLevel ? { reasoning: { effort: reasoningLevel } } : {}),
    ...(payload?.maxTokens ? { max_output_tokens: Number(payload.maxTokens) } : {}),
  };

  const controller = new AbortController();
  const onAbort = () => controller.abort();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  if (signal) signal.addEventListener('abort', onAbort, { once: true });
  try {
    const response = await fetch(`${baseUrl}${responsesPath}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      const error = new Error(`responses 请求失败 (${response.status}): ${text.slice(0, 200)}`);
      error.code = response.status === 401 || response.status === 403 ? 'provider_auth_invalid' : 'provider_bad_response';
      throw error;
    }
    const data = await response.json().catch(() => ({}));
    return { ...parseResponsesOutput(data), modelUsed: model, raw: data };
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onAbort);
  }
};
