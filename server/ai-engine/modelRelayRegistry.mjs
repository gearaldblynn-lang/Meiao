const clean = (value, max = 5000) => String(value ?? '').trim().slice(0, max);
const list = (value) => (Array.isArray(value) ? value : []);

const normalizeFeatures = (features) => list(features).map((item) => clean(item, 80)).filter(Boolean);

export const normalizeModelRelayRegistry = (providers = []) => list(providers)
  .map((provider) => {
    const providerId = clean(provider?.provider || provider?.providerId, 120);
    const models = list(provider?.models)
      .map((model) => ({
        id: clean(model?.id || model?.name, 160),
        mode: clean(model?.mode || 'chat', 40),
        enabled: model?.enabled !== false,
        features: normalizeFeatures(model?.features),
      }))
      .filter((model) => model.id && model.enabled);
    if (!providerId || models.length === 0) return null;
    const baseUrlRef = clean(provider?.baseUrlRef, 220);
    const credentialRef = clean(provider?.credentialRef, 220);
    return {
      provider: providerId,
      ...(baseUrlRef ? { baseUrlRef } : {}),
      ...(credentialRef ? { credentialRef } : {}),
      models,
    };
  })
  .filter(Boolean);

export const selectSmartFactoryModel = (providers = [], request = {}) => {
  const registry = normalizeModelRelayRegistry(providers);
  const requestedProvider = clean(request.provider || request.model_provider, 120);
  const requestedModel = clean(request.model || request.name, 160);
  const exactProvider = registry.find((provider) => provider.provider === requestedProvider);
  const exactModel = exactProvider?.models.find((model) => model.id === requestedModel);
  if (exactProvider && exactModel) {
    return { provider: exactProvider.provider, model: exactModel, fallbackUsed: false };
  }
  const fallbackProvider = exactProvider || registry[0];
  const fallbackModel = fallbackProvider?.models[0];
  if (!fallbackProvider || !fallbackModel) {
    throw new Error('No enabled Smart Factory model is configured');
  }
  return { provider: fallbackProvider.provider, model: fallbackModel, fallbackUsed: true };
};

export const toModelCatalog = (providers = []) => normalizeModelRelayRegistry(providers).map((provider) => ({
  provider: provider.provider,
  models: provider.models.map((model) => ({
    id: model.id,
    mode: model.mode,
    features: model.features || [],
  })),
}));
