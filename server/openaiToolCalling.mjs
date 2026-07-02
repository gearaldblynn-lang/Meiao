import { isProviderErrorText } from './providerErrorText.mjs';

const DEFAULT_TIMEOUT_MS = Number(process.env.OPENAI_COMPATIBLE_TIMEOUT_MS || 240000);

const getRelayConfig = (env = {}) => {
  const apiKey = String(env.OPENAI_COMPATIBLE_API_KEY || '').trim();
  const baseUrl = String(env.OPENAI_COMPATIBLE_BASE_URL || 'https://maxforai.top').trim().replace(/\/$/, '');
  const allowedModels = String(env.OPENAI_COMPATIBLE_MODELS || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return { apiKey, baseUrl, allowedModels };
};

export const parseToolCallsFromChoice = (choice = {}) => {
  const rawCalls = choice?.message?.tool_calls;
  if (!Array.isArray(rawCalls)) return [];
  const out = [];
  for (const call of rawCalls) {
    const name = String(call?.function?.name || '').trim();
    if (!name) continue;
    let args;
    try {
      args = JSON.parse(String(call?.function?.arguments || '{}'));
    } catch {
      continue;
    }
    out.push({ id: String(call?.id || ''), name, args });
  }
  return out;
};

export const runOpenAIToolCallingJob = async ({ payload = {}, env = {}, signal = null } = {}) => {
  const { apiKey, baseUrl, allowedModels } = getRelayConfig(env);
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

  const body = {
    model,
    messages: Array.isArray(payload?.messages) ? payload.messages : [],
    stream: false,
    ...(Array.isArray(payload?.tools) && payload.tools.length > 0 ? { tools: payload.tools } : {}),
    ...(payload?.toolChoice ? { tool_choice: payload.toolChoice } : {}),
    ...(payload?.maxTokens ? { max_tokens: Number(payload.maxTokens) } : {}),
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  if (signal) signal.addEventListener('abort', () => controller.abort(), { once: true });
  let response;
  try {
    response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    const error = new Error(`新中转站请求失败 (${response.status}): ${text.slice(0, 200)}`);
    error.code = response.status === 401 || response.status === 403 ? 'provider_auth_invalid' : 'provider_bad_response';
    throw error;
  }
  const data = await response.json().catch(() => ({}));
  const choice = data?.choices?.[0] || {};
  const content = String(choice?.message?.content || '').trim();
  if (isProviderErrorText(content)) {
    throw new Error(`上游错误: ${content.slice(0, 120)}`);
  }
  return {
    content,
    toolCalls: parseToolCallsFromChoice(choice),
    finishReason: String(choice?.finish_reason || '').trim(),
    modelUsed: model,
    raw: data,
  };
};

export const accumulateToolCallDeltas = (acc, deltaCalls = []) => {
  for (const delta of (Array.isArray(deltaCalls) ? deltaCalls : [])) {
    const index = Number(delta?.index || 0);
    if (!acc.has(index)) {
      acc.set(index, { id: '', type: 'function', function: { name: '', arguments: '' } });
    }
    const current = acc.get(index);
    if (delta?.id) current.id = delta.id;
    if (delta?.function?.name) current.function.name = delta.function.name;
    if (delta?.function?.arguments) current.function.arguments += delta.function.arguments;
  }
  return acc;
};

export const runOpenAIToolCallingStream = async ({
  payload = {},
  env = {},
  signal = null,
  onDelta = null,
} = {}) => {
  const { apiKey, baseUrl, allowedModels } = getRelayConfig(env);
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

  const body = {
    model,
    messages: Array.isArray(payload?.messages) ? payload.messages : [],
    stream: true,
    ...(Array.isArray(payload?.tools) && payload.tools.length > 0 ? { tools: payload.tools } : {}),
    ...(payload?.toolChoice ? { tool_choice: payload.toolChoice } : {}),
    ...(payload?.maxTokens ? { max_tokens: Number(payload.maxTokens) } : {}),
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  if (signal) signal.addEventListener('abort', () => controller.abort(), { once: true });

  try {
    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      const error = new Error(`新中转站流式请求失败 (${response.status}): ${text.slice(0, 200)}`);
      error.code = response.status === 401 || response.status === 403 ? 'provider_auth_invalid' : 'provider_bad_response';
      throw error;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let content = '';
    let finishReason = '';
    const toolAcc = new Map();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const payloadText = trimmed.slice(5).trim();
        if (payloadText === '[DONE]') continue;
        let parsed;
        try {
          parsed = JSON.parse(payloadText);
        } catch {
          continue;
        }
        const choice = parsed?.choices?.[0];
        if (!choice) continue;
        const delta = choice.delta || {};
        if (delta.content) {
          content += delta.content;
          if (onDelta) onDelta(delta.content);
        }
        if (Array.isArray(delta.tool_calls)) accumulateToolCallDeltas(toolAcc, delta.tool_calls);
        if (choice.finish_reason) finishReason = choice.finish_reason;
      }
    }

    const toolCalls = parseToolCallsFromChoice({ message: { tool_calls: Array.from(toolAcc.values()) } });
    return { content: content.trim(), toolCalls, finishReason, modelUsed: model };
  } finally {
    clearTimeout(timer);
  }
};
