import { createDifySourceNotice } from './difySourceNotice.mjs';

export const DIFY_AGENT_SOURCE_NOTICE = createDifySourceNotice([
  'api/models/agent_config_entities.py',
]);

const CLI_TOOL_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const AUTHORIZED_CLI_STATUSES = new Set([
  'authorized',
  'pre_authorized',
  'allowed',
  'not_required',
]);
const SAFE_RISK_LEVELS = new Set(['safe', 'unknown', 'dangerous']);

const asRecord = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {});
const asArray = (value) => (Array.isArray(value) ? value : []);
const cleanString = (value, fallback = '') => String(value ?? fallback).trim();

const stripCredentialRef = (value = {}) => {
  const source = asRecord(value);
  const result = {};
  for (const key of ['type', 'id', 'ref', 'provider', 'credential_id', 'provider_credential_id']) {
    const normalized = cleanString(source[key]);
    if (normalized) result[key] = normalized;
  }
  return result;
};

const normalizeEnvVariables = (items = []) => asArray(items)
  .map((item) => {
    const source = asRecord(item);
    const name = cleanString(source.name || source.key || source.env_name || source.variable);
    if (!name) return null;
    if (!ENV_NAME_PATTERN.test(name)) throw new Error(`env var name must match ${ENV_NAME_PATTERN.source}`);
    return {
      name,
      value: source.value == null ? '' : String(source.value),
      required: Boolean(source.required),
    };
  })
  .filter(Boolean);

const normalizeSecretRefs = (items = []) => asArray(items)
  .map((item) => {
    const source = asRecord(item);
    const name = cleanString(source.name || source.key || source.env_name || source.variable);
    if (!name) return null;
    if (!ENV_NAME_PATTERN.test(name)) throw new Error(`secret env var name must match ${ENV_NAME_PATTERN.source}`);
    return {
      name,
      ...(cleanString(source.ref || source.id || source.credential_id) ? {
        ref: cleanString(source.ref || source.id || source.credential_id),
      } : {}),
      ...(source.permission ? { permission: asRecord(source.permission) } : {}),
    };
  })
  .filter(Boolean);

const normalizeCliToolEnv = (value = {}) => {
  const source = asRecord(value);
  return {
    variables: normalizeEnvVariables(source.variables),
    secret_refs: normalizeSecretRefs(source.secret_refs),
  };
};

const normalizeCliTool = (value = {}) => {
  const source = asRecord(value);
  const name = cleanString(source.name || source.tool_name || source.label);
  if (!name) return null;
  if (!CLI_TOOL_NAME_PATTERN.test(name)) throw new Error(`cli tool name must match ${CLI_TOOL_NAME_PATTERN.source}`);

  const authorizationStatus = cleanString(source.authorization_status || source.status || (
    source.pre_authorized ? 'pre_authorized' : 'not_required'
  ));
  const riskLevel = cleanString(source.risk_level || (source.dangerous || source.dangerous_command ? 'dangerous' : 'unknown'));
  if (authorizationStatus && !AUTHORIZED_CLI_STATUSES.has(authorizationStatus)) {
    throw new Error(`cli tool ${name} is not authorized`);
  }
  if (riskLevel && !SAFE_RISK_LEVELS.has(riskLevel)) {
    throw new Error(`cli tool ${name} has invalid risk_level`);
  }

  return {
    id: cleanString(source.id) || name,
    enabled: source.enabled !== false,
    name,
    tool_name: cleanString(source.tool_name) || name,
    label: cleanString(source.label) || name,
    description: cleanString(source.description),
    command: cleanString(source.command),
    install_commands: asArray(source.install_commands || source.install_command || source.install)
      .map((item) => cleanString(item))
      .filter(Boolean),
    invoke_metadata: asRecord(source.invoke_metadata),
    env: normalizeCliToolEnv(source.env),
    authorization_status: authorizationStatus || 'not_required',
    risk_level: riskLevel || 'unknown',
    requires_confirmation: Boolean(source.requires_confirmation),
  };
};

const normalizeDifyTool = (value = {}) => {
  const source = asRecord(value);
  const providerId = cleanString(source.provider_id || source.provider_name);
  const pluginId = cleanString(source.plugin_id);
  const provider = cleanString(source.provider);
  if (!providerId && !(pluginId && provider)) {
    throw new Error('Dify tool requires provider_id or plugin_id + provider');
  }
  return {
    enabled: source.enabled !== false,
    provider_type: cleanString(source.provider_type, 'plugin') || 'plugin',
    ...(providerId ? { provider_id: providerId } : {}),
    ...(pluginId ? { plugin_id: pluginId } : {}),
    ...(provider ? { provider } : {}),
    ...(cleanString(source.tool_name) ? { tool_name: cleanString(source.tool_name) } : {}),
    credential_type: cleanString(source.credential_type, 'api-key') || 'api-key',
    ...(source.credential_ref ? { credential_ref: stripCredentialRef(source.credential_ref) } : {}),
    runtime_parameters: asRecord(source.runtime_parameters || source.tool_parameters),
  };
};

const normalizeBuiltinTool = (value = {}) => {
  const source = asRecord(value);
  const name = cleanString(source.name || source.tool_name);
  if (!/^[a-zA-Z][a-zA-Z0-9_-]{1,80}$/.test(name)) {
    throw new Error('builtin tool name must match ^[a-zA-Z][a-zA-Z0-9_-]{1,80}$');
  }
  const authorizationStatus = cleanString(source.authorization_status || 'authorized');
  const riskLevel = cleanString(source.risk_level || 'safe');
  if (!AUTHORIZED_CLI_STATUSES.has(authorizationStatus)) {
    throw new Error(`builtin tool ${name} is not authorized`);
  }
  if (riskLevel && !SAFE_RISK_LEVELS.has(riskLevel)) {
    throw new Error(`builtin tool ${name} has invalid risk_level`);
  }
  return {
    id: cleanString(source.id) || name,
    enabled: source.enabled !== false,
    name,
    tool_name: cleanString(source.tool_name) || name,
    label: cleanString(source.label) || name,
    description: cleanString(source.description),
    invoke_metadata: asRecord(source.invoke_metadata),
    authorization_status: authorizationStatus,
    risk_level: riskLevel,
    requires_confirmation: Boolean(source.requires_confirmation),
    executorRef: cleanString(source.executorRef || source.executor_ref || name),
    capability: cleanString(source.capability),
    icon: cleanString(source.icon),
    modelProvider: cleanString(source.modelProvider || source.model_provider || source.provider),
    model: cleanString(source.model || source.modelName || source.model_name),
  };
};

const normalizeModelSettings = (value = {}) => {
  const source = asRecord(value);
  const result = {};
  for (const key of ['temperature', 'top_p', 'presence_penalty', 'frequency_penalty', 'max_tokens']) {
    if (source[key] != null && source[key] !== '') result[key] = Number(source[key]);
  }
  if (Array.isArray(source.stop)) result.stop = source.stop.map((item) => String(item));
  if (source.response_format && typeof source.response_format === 'object') {
    result.response_format = { type: cleanString(source.response_format.type) };
  }
  return result;
};

const normalizeModel = (value = null) => {
  if (!value) return null;
  const source = asRecord(value);
  const pluginId = cleanString(source.plugin_id);
  const modelProvider = cleanString(source.model_provider || source.provider);
  const model = cleanString(source.model || source.name);
  if (!pluginId) throw new Error('model.plugin_id is required');
  if (!modelProvider) throw new Error('model.model_provider is required');
  if (!model) throw new Error('model.model is required');
  return {
    plugin_id: pluginId,
    model_provider: modelProvider,
    model,
    ...(source.credential_ref ? { credential_ref: stripCredentialRef(source.credential_ref) } : {}),
    model_settings: normalizeModelSettings(source.model_settings || source.completion_params),
  };
};

const normalizeKnowledge = (value = {}) => {
  const source = asRecord(value);
  return {
    datasets: asArray(source.datasets).map((item) => {
      const dataset = asRecord(item);
      const retrievalPolicy = asRecord(dataset.retrievalPolicy || dataset.retrieval_policy);
      const embeddingModel = asRecord(dataset.embeddingModel || dataset.embedding_model);
      const rerankModel = asRecord(dataset.rerankModel || dataset.rerank_model);
      return {
        id: cleanString(dataset.id),
        name: cleanString(dataset.name),
        description: cleanString(dataset.description),
        ...(Object.keys(retrievalPolicy).length ? { retrievalPolicy } : {}),
        ...(embeddingModel.provider && embeddingModel.model ? {
          embeddingModel: {
            provider: cleanString(embeddingModel.provider),
            model: cleanString(embeddingModel.model),
          },
        } : {}),
        ...(rerankModel.provider && rerankModel.model ? {
          rerankModel: {
            provider: cleanString(rerankModel.provider),
            model: cleanString(rerankModel.model),
          },
        } : {}),
      };
    }).filter((item) => item.id),
    query_mode: cleanString(source.query_mode) || null,
    query_config: {
      query: cleanString(source.query_config?.query),
      ...(source.query_config?.top_k != null ? { top_k: Number(source.query_config.top_k) } : {}),
      ...(source.query_config?.score_threshold != null ? {
        score_threshold: Number(source.query_config.score_threshold),
      } : {}),
      score_threshold_enabled: Boolean(source.query_config?.score_threshold_enabled),
    },
  };
};

export const normalizeSmartFactoryAgentConfig = (value = {}) => {
  const source = asRecord(value);
  return {
    schema_version: Number(source.schema_version || 1),
    prompt: {
      system_prompt: cleanString(source.prompt?.system_prompt || source.system_prompt),
    },
    tools: {
      dify_tools: asArray(source.tools?.dify_tools).map(normalizeDifyTool).filter(Boolean),
      cli_tools: asArray(source.tools?.cli_tools).map(normalizeCliTool).filter(Boolean),
      builtin_tools: asArray(source.tools?.builtin_tools).map(normalizeBuiltinTool).filter(Boolean),
    },
    knowledge: normalizeKnowledge(source.knowledge),
    env: {
      variables: normalizeEnvVariables(source.env?.variables),
      secret_refs: normalizeSecretRefs(source.env?.secret_refs),
    },
    model: normalizeModel(source.model),
    app_features: asRecord(source.app_features),
  };
};

export const validateSmartFactoryAgentConfig = (value = {}) => normalizeSmartFactoryAgentConfig(value);
