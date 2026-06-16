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
  return {
    content: String(choice?.message?.content || '').trim(),
    toolCalls: parseToolCallsFromChoice(choice),
    finishReason: String(choice?.finish_reason || '').trim(),
    modelUsed: model,
    raw: data,
  };
};
