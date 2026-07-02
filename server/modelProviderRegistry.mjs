const cloneJson = (value) => JSON.parse(JSON.stringify(value));
const text = (value, max = 5000) => String(value || '').trim().slice(0, max);

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

const MODEL_PROVIDER_PRESETS = [
  {
    provider: 'openai',
    displayName: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    credentialRef: 'env:OPENAI_API_KEY',
    models: [
      { id: 'gpt-4.1', mode: 'chat', features: ['tool-call', 'vision', 'structured-output'] },
      { id: 'gpt-4.1-mini', mode: 'chat', features: ['tool-call', 'vision', 'structured-output'] },
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
      { id: 'gpt-5.5', mode: 'chat', features: ['tool-call', 'vision', 'structured-output'] },
      { id: 'text-embedding-3-large', mode: 'embedding', features: ['embedding'] },
      { id: 'bge-reranker-v2-m3', mode: 'rerank', features: ['rerank'] },
      { id: 'gpt-image-1', mode: 'image', features: ['image-generation'] },
      { id: 'sora', mode: 'video', features: ['video-generation'] },
    ],
  },
];

const splitModelsText = (value) => text(value, 5000)
  .split(/[\n,，]+/)
  .map((item) => text(item, 240))
  .filter(Boolean);

export const normalizeModelMode = (mode = '') => {
  const normalized = text(mode || 'chat', 40).toLowerCase().replace(/_/g, '-');
  if (['llm', 'completion', 'text-generation'].includes(normalized)) return 'chat';
  if (['text-embedding', 'embeddings'].includes(normalized)) return 'embedding';
  if (['re-rank', 'reranker'].includes(normalized)) return 'rerank';
  if (['text-to-image', 'image-generation'].includes(normalized)) return 'image';
  if (['text-to-video', 'video-generation'].includes(normalized)) return 'video';
  return MODEL_MODE_FEATURES[normalized] ? normalized : 'chat';
};

const defaultFeaturesForMode = (mode) => MODEL_MODE_FEATURES[normalizeModelMode(mode)] || MODEL_MODE_FEATURES.chat;

const normalizeFeatureList = (features) => (Array.isArray(features) ? features : [])
  .map((item) => text(item, 80))
  .filter(Boolean);

export const parseModelTextToken = (token = '') => {
  const raw = text(token, 240);
  const prefixed = raw.match(/^([a-zA-Z][\w-]{1,32})\s*:\s*(.+)$/);
  if (!prefixed) return { id: raw, mode: 'chat', features: defaultFeaturesForMode('chat') };
  const mode = normalizeModelMode(prefixed[1]);
  return { id: text(prefixed[2], 160), mode, features: defaultFeaturesForMode(mode) };
};

export const normalizeModelEntry = (model = {}) => {
  if (typeof model === 'string') {
    const parsed = parseModelTextToken(model);
    return parsed.id ? parsed : null;
  }
  const mode = normalizeModelMode(model?.mode || model?.model_type || model?.type || 'chat');
  const features = normalizeFeatureList(model?.features);
  const entry = {
    id: text(model?.id || model?.name || model?.model, 160),
    mode,
    features: features.length ? features : defaultFeaturesForMode(mode),
  };
  return entry.id ? entry : null;
};

export const normalizeModelProvider = (provider = {}) => {
  const providerId = text(provider.provider || provider.providerId, 120);
  const models = Array.isArray(provider.models)
    ? provider.models.map(normalizeModelEntry).filter(Boolean)
    : splitModelsText(provider.modelsText).map(parseModelTextToken).filter((model) => model.id);
  if (!providerId || models.length === 0) return null;
  const credentialRef = text(provider.credentialRef, 200) || (text(provider.apiKey, 500) ? `secret:${providerId}` : '');
  const baseUrl = text(provider.baseUrl, 300).replace(/\/$/, '');
  const defaultModel = text(provider.defaultModel, 160) || models[0]?.id || '';
  const fallbackModel = text(provider.fallbackModel, 160) || models[1]?.id || defaultModel;
  return {
    provider: providerId,
    displayName: text(provider.displayName || provider.name || providerId, 160),
    ...(baseUrl ? { baseUrl } : {}),
    ...(credentialRef ? { credentialRef } : {}),
    ...(defaultModel ? { defaultModel } : {}),
    ...(fallbackModel ? { fallbackModel } : {}),
    customBaseUrlRequired: provider.customBaseUrlRequired === true,
    models,
  };
};

export const createDefaultModelProviderRegistry = () => normalizeModelProviderRegistry({
  providers: MODEL_PROVIDER_PRESETS,
});

export const normalizeModelProviderRegistry = (value = {}) => {
  const source = value && typeof value === 'object' ? value : {};
  const providers = (Array.isArray(source.providers) ? source.providers : MODEL_PROVIDER_PRESETS)
    .map(normalizeModelProvider)
    .filter(Boolean)
    .filter((provider) => !['ollama', 'vllm', 'lm_studio', 'lm-studio'].includes(provider.provider));
  return {
    providers: providers.length ? providers : MODEL_PROVIDER_PRESETS.map(normalizeModelProvider).filter(Boolean),
    defaultChatModel: text(source.defaultChatModel, 160),
    defaultEmbeddingModel: text(source.defaultEmbeddingModel, 160),
    defaultRerankModel: text(source.defaultRerankModel, 160),
    defaultImageModel: text(source.defaultImageModel, 160),
    defaultVideoModel: text(source.defaultVideoModel, 160),
  };
};

const countProviderCapabilities = (models = []) => models.reduce((acc, model) => {
  const mode = normalizeModelMode(model.mode);
  acc[mode] = (acc[mode] || 0) + 1;
  return acc;
}, {});

export const getPublicModelProviderRegistry = (registry = createDefaultModelProviderRegistry()) => {
  const normalized = normalizeModelProviderRegistry(registry);
  return {
    ...normalized,
    providers: normalized.providers.map((provider) => ({
      provider: provider.provider,
      displayName: provider.displayName,
      ...(provider.baseUrl ? { baseUrl: provider.baseUrl } : {}),
      customBaseUrlRequired: provider.customBaseUrlRequired === true,
      hasCredential: Boolean(provider.credentialRef),
      defaultModel: provider.defaultModel || '',
      fallbackModel: provider.fallbackModel || '',
      capabilityCounts: countProviderCapabilities(provider.models),
      models: provider.models.map((model) => ({
        id: model.id,
        mode: model.mode,
        features: model.features,
      })),
    })),
  };
};

export const mergeModelProviderRegistryUpdate = (
  current = createDefaultModelProviderRegistry(),
  update = {},
) => normalizeModelProviderRegistry({
  ...normalizeModelProviderRegistry(current),
  ...(update && typeof update === 'object' ? update : {}),
});

export const upsertModelProvider = (current = createDefaultModelProviderRegistry(), payload = {}) => {
  const normalized = normalizeModelProviderRegistry(current);
  const preset = MODEL_PROVIDER_PRESETS.find((item) => item.provider === text(payload.provider || payload.providerId, 120));
  const nextProvider = normalizeModelProvider({
    ...preset,
    ...payload,
    models: payload.models !== undefined ? payload.models : preset?.models,
  });
  if (!nextProvider) return normalized;
  return normalizeModelProviderRegistry({
    ...normalized,
    providers: [
      ...normalized.providers.filter((provider) => provider.provider !== nextProvider.provider),
      nextProvider,
    ],
  });
};

export const deleteModelProvider = (current = createDefaultModelProviderRegistry(), providerId = '') => {
  const normalized = normalizeModelProviderRegistry(current);
  const id = text(providerId, 120);
  return normalizeModelProviderRegistry({
    ...normalized,
    providers: normalized.providers.filter((provider) => provider.provider !== id),
  });
};

export const getModelProviderPresets = () => cloneJson(MODEL_PROVIDER_PRESETS);

export const extractSmartFactoryModelProvidersForMigration = (settings = {}) => {
  const smartFactoryProviders = settings?.smartFactory?.modelProviders;
  if (!Array.isArray(smartFactoryProviders) || smartFactoryProviders.length === 0) {
    return normalizeModelProviderRegistry({ providers: [] });
  }
  return normalizeModelProviderRegistry({ providers: smartFactoryProviders });
};
