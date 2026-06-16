const DEFAULT_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3';
const DEFAULT_MODEL = 'doubao-embedding-vision-251215';
const DEFAULT_TIMEOUT_MS = Number(process.env.EMBEDDING_TIMEOUT_MS || 30000);

const getDoubaoConfig = (env = {}) => ({
  apiKey: String(env.DOUBAO_EMBEDDING_API_KEY || '').trim(),
  baseUrl: String(env.DOUBAO_EMBEDDING_BASE_URL || DEFAULT_BASE_URL).trim().replace(/\/$/, ''),
  model: String(env.DOUBAO_EMBEDDING_MODEL || DEFAULT_MODEL).trim(),
});

const createEmbeddingError = (message, code = 'embedding_provider_error') => {
  const error = new Error(message);
  error.code = code;
  return error;
};

const readEmbeddingFromResponse = (data) => {
  const vector = data?.data?.embedding || data?.data?.[0]?.embedding;
  return Array.isArray(vector) ? vector : null;
};

const embedOneDoubao = async (text, { apiKey, baseUrl, model }, signal) => {
  const response = await fetch(`${baseUrl}/embeddings/multimodal`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      input: [{ type: 'text', text: String(text || '') }],
    }),
    signal,
  });

  if (!response.ok) {
    const bodyText = await response.text().catch(() => '');
    throw createEmbeddingError(`embedding 请求失败 (${response.status}): ${bodyText.slice(0, 200)}`);
  }

  const data = await response.json().catch(() => ({}));
  const vector = readEmbeddingFromResponse(data);
  if (!vector) {
    throw createEmbeddingError('embedding 响应缺少向量');
  }
  return vector;
};

export const embedTexts = async (texts, env = {}) => {
  const list = Array.isArray(texts) ? texts : [texts];
  const provider = String(env.EMBEDDING_PROVIDER || 'doubao').trim();
  if (provider !== 'doubao') {
    throw createEmbeddingError(`不支持的 embedding provider: ${provider}`);
  }

  const config = getDoubaoConfig(env);
  if (!config.apiKey) {
    throw createEmbeddingError('DOUBAO_EMBEDDING_API_KEY 未配置', 'embedding_config_missing');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const embeddings = [];
    for (const text of list) {
      embeddings.push(await embedOneDoubao(text, config, controller.signal));
    }
    return embeddings;
  } finally {
    clearTimeout(timer);
  }
};
