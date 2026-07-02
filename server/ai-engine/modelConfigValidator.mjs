import { createDifySourceNotice } from './difySourceNotice.mjs';

export const DIFY_MODEL_CONFIG_SOURCE_NOTICE = createDifySourceNotice([
  'api/core/app/app_config/easy_ui_based_app/model_config/manager.py',
  'api/services/entities/model_provider_entities.py',
]);

const asRecord = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {});
const asArray = (value) => (Array.isArray(value) ? value : []);
const cleanString = (value) => String(value ?? '').trim();

const normalizeCompletionParams = (value = {}) => {
  const params = { ...asRecord(value) };
  if (!('stop' in params)) {
    params.stop = [];
  } else if (!Array.isArray(params.stop)) {
    throw new Error('stop in model.completion_params must be of list type');
  }
  if (params.stop.length > 4) {
    throw new Error('stop sequences must be less than 4');
  }
  params.stop = params.stop.map((item) => String(item));
  return params;
};

const findProvider = (catalog, providerId) => (
  asArray(catalog).find((item) => cleanString(item?.provider) === providerId)
);

const findModel = (provider, modelName) => (
  asArray(provider?.models).find((item) => cleanString(item?.id || item?.model || item?.name) === modelName)
);

export const validateModelConfig = (config = {}, catalog = []) => {
  const source = asRecord(config);
  const modelConfig = source.model;
  if (!modelConfig) throw new Error('model is required');
  if (!modelConfig || typeof modelConfig !== 'object' || Array.isArray(modelConfig)) {
    throw new Error('model must be of object type');
  }

  const modelSource = asRecord(modelConfig);
  const providerId = cleanString(modelSource.provider);
  const providerNames = asArray(catalog).map((item) => cleanString(item?.provider)).filter(Boolean);
  if (!providerId || !providerNames.includes(providerId)) {
    throw new Error(`model.provider is required and must be in ${JSON.stringify(providerNames)}`);
  }

  const provider = findProvider(catalog, providerId);
  const modelName = cleanString(modelSource.name || modelSource.model);
  if (!modelName) throw new Error('model.name is required');

  const providerModel = findModel(provider, modelName);
  if (!providerModel) throw new Error('model.name must be in the specified model list');

  return {
    model: {
      provider: providerId,
      name: modelName,
      mode: cleanString(modelSource.mode || providerModel.mode) || 'completion',
      completion_params: normalizeCompletionParams(modelSource.completion_params),
    },
  };
};

export const toPublicModelProviderCatalog = (catalog = []) => asArray(catalog)
  .map((provider) => ({
    provider: cleanString(provider?.provider),
    label: cleanString(provider?.label || provider?.provider),
    models: asArray(provider?.models).map((model) => ({
      id: cleanString(model?.id || model?.model || model?.name),
      mode: cleanString(model?.mode || 'completion'),
      features: asArray(model?.features).map((item) => cleanString(item)).filter(Boolean),
    })).filter((model) => model.id),
  }))
  .filter((provider) => provider.provider);
