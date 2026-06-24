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

const parseResponsesSseBlock = (block = '') => {
  const lines = String(block || '').split(/\r?\n/);
  const data = lines
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim())
    .join('\n');
  if (!data || data === '[DONE]') return null;
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
};

const buildToolCallsFromStream = (itemsById) => {
  const items = Array.from(itemsById.values())
    .filter((item) => item?.type === 'function_call')
    .sort((a, b) => Number(a.outputIndex || 0) - Number(b.outputIndex || 0));
  const toolCalls = [];
  for (const item of items) {
    const name = String(item.name || '').trim();
    if (!name) continue;
    let args;
    try {
      args = JSON.parse(String(item.arguments || '{}'));
    } catch {
      continue;
    }
    const callId = String(item.call_id || item.id || '');
    toolCalls.push({
      id: callId,
      name,
      args,
      responseItem: {
        type: 'function_call',
        ...(item.id ? { id: String(item.id) } : {}),
        name,
        arguments: String(item.arguments || '{}'),
        call_id: callId,
        ...(item.status ? { status: String(item.status) } : {}),
      },
    });
  }
  return toolCalls;
};

const findStreamFunctionCallKey = (itemsById, item = {}) => {
  const id = String(item?.id || '').trim();
  if (id && itemsById.has(id)) return id;
  const callId = String(item?.call_id || '').trim();
  if (!callId) return id;
  for (const [key, existing] of itemsById.entries()) {
    if (existing?.type === 'function_call' && String(existing.call_id || '').trim() === callId) {
      return key;
    }
  }
  return id || callId;
};

const readResponsesStream = async (response, { onDelta = null } = {}) => {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  let usage = {};
  let completedResponse = null;
  const itemsById = new Map();

  const applyEvent = (event = {}) => {
    const type = String(event?.type || '').trim();
    if (type === 'response.output_text.delta') {
      const delta = String(event?.delta || '');
      if (delta) {
        content += delta;
        onDelta?.(delta);
      }
      return;
    }
    if (type === 'response.output_text.done' && !content) {
      content = String(event?.text || '');
      return;
    }
    if (type === 'response.output_item.added' || type === 'response.output_item.done') {
      const item = event?.item || {};
      if (item?.type === 'function_call') {
        const id = findStreamFunctionCallKey(itemsById, item)
          || String(event?.item_id || `output_${event?.output_index ?? itemsById.size}`);
        const existing = itemsById.get(id) || {};
        itemsById.set(id, {
          ...existing,
          ...item,
          id,
          outputIndex: event?.output_index ?? existing.outputIndex,
          arguments: String(item.arguments ?? existing.arguments ?? ''),
        });
      }
      if (type === 'response.output_item.done' && item?.type === 'message' && !content) {
        content = parseResponsesOutput({ output: [item] }).content;
      }
      return;
    }
    if (type === 'response.function_call_arguments.delta') {
      const id = String(event?.item_id || '');
      if (!id) return;
      const existing = itemsById.get(id) || { id, type: 'function_call' };
      itemsById.set(id, {
        ...existing,
        outputIndex: event?.output_index ?? existing.outputIndex,
        arguments: `${String(existing.arguments || '')}${String(event?.delta || '')}`,
      });
      return;
    }
    if (type === 'response.function_call_arguments.done') {
      const id = String(event?.item_id || '');
      if (!id) return;
      const existing = itemsById.get(id) || { id, type: 'function_call' };
      itemsById.set(id, {
        ...existing,
        outputIndex: event?.output_index ?? existing.outputIndex,
        arguments: String(event?.arguments ?? existing.arguments ?? ''),
      });
      return;
    }
    if (type === 'response.completed') {
      completedResponse = event?.response || {};
      usage = completedResponse?.usage || usage || {};
      const parsed = parseResponsesOutput(completedResponse);
      if (!content && parsed.content) content = parsed.content;
      for (const call of parsed.toolCalls || []) {
        const item = call.responseItem || {};
        const id = findStreamFunctionCallKey(itemsById, item)
          || String(call.id || `completed_${itemsById.size}`);
        itemsById.set(id, {
          ...itemsById.get(id),
          ...item,
          id,
          type: 'function_call',
          outputIndex: itemsById.get(id)?.outputIndex ?? itemsById.size,
        });
      }
      return;
    }
    if (type === 'response.failed' || event?.error) {
      const message = event?.response?.error?.message || event?.error?.message || 'responses 流式请求失败';
      const error = new Error(message);
      error.code = 'provider_bad_response';
      throw error;
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split(/\n\n/);
    buffer = blocks.pop() || '';
    for (const block of blocks) {
      const event = parseResponsesSseBlock(block);
      if (event) applyEvent(event);
    }
  }
  if (buffer.trim()) {
    const event = parseResponsesSseBlock(buffer);
    if (event) applyEvent(event);
  }
  const toolCalls = buildToolCallsFromStream(itemsById);
  return {
    content: content.trim(),
    toolCalls,
    finishReason: toolCalls.length > 0 ? 'tool_calls' : 'stop',
    usage: usage || completedResponse?.usage || {},
  };
};

export const runResponsesJob = async ({ payload = {}, env = {}, signal = null, onDelta = null } = {}) => {
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
    ...(typeof onDelta === 'function' ? { stream: true } : {}),
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
    const contentType = response.headers.get('content-type') || '';
    if (typeof onDelta === 'function' && contentType.includes('text/event-stream') && response.body) {
      return { ...await readResponsesStream(response, { onDelta }), modelUsed: model };
    }
    const data = await response.json().catch(() => ({}));
    return { ...parseResponsesOutput(data), modelUsed: model, raw: data };
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onAbort);
  }
};
