import { createDifySourceNotice } from './difySourceNotice.mjs';

export const DIFY_TOOL_SOURCE_NOTICE = createDifySourceNotice([
  'dify-agent/src/dify_agent/layers/knowledge/layer.py',
  'dify-agent/src/dify_agent/layers/dify_plugin/tools_layer.py',
  'api/core/tools/entities/tool_entities.py',
]);

const KNOWLEDGE_TOOL_NAME = 'knowledge_base_search';
const KNOWLEDGE_TOOL_DESCRIPTION = 'Search configured knowledge bases for information relevant to the query.';

const asRecord = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {});
const asArray = (value) => (Array.isArray(value) ? value : []);
const cleanString = (value) => String(value ?? '').trim();

export const createKnowledgeSearchToolDefinition = () => ({
  type: 'function',
  name: KNOWLEDGE_TOOL_NAME,
  description: KNOWLEDGE_TOOL_DESCRIPTION,
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Search query for the configured knowledge bases.',
      },
    },
    required: ['query'],
    additionalProperties: false,
  },
});

const isLlmParameter = (parameter = {}) => {
  const form = cleanString(parameter.form || parameter.form_type || parameter.parameter_form).toLowerCase();
  return form === 'llm' || form === 'model';
};

const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

const castToolParameterValue = (type, value) => {
  const normalizedType = cleanString(type).toLowerCase();
  if (normalizedType === 'string' || normalizedType === 'secret-input' || normalizedType === 'select') {
    return value == null ? '' : String(value);
  }
  if (normalizedType === 'number') {
    const numberValue = Number(value);
    if (!Number.isFinite(numberValue)) throw new Error(`tool parameter cannot be cast to number: ${value}`);
    return numberValue;
  }
  if (normalizedType === 'boolean') return Boolean(value);
  if (normalizedType === 'array') return Array.isArray(value) ? value : [value];
  if (normalizedType === 'object') return asRecord(value);
  return value;
};

export const normalizeToolParameters = ({
  effectiveParameters = [],
  runtimeParameters = {},
  toolArguments = {},
  toolName = 'tool',
} = {}) => {
  const parameters = asArray(effectiveParameters);
  const runtime = asRecord(runtimeParameters);
  const modelArgs = asRecord(toolArguments);
  const missingHiddenNames = parameters
    .filter((parameter) => !isLlmParameter(parameter))
    .filter((parameter) => Boolean(parameter.required))
    .filter((parameter) => parameter.default == null)
    .map((parameter) => cleanString(parameter.name))
    .filter((name) => name && !hasOwn(runtime, name));

  if (missingHiddenNames.length > 0) {
    throw new Error(`Tool '${toolName}' requires non-LLM runtime_parameters for: ${missingHiddenNames.sort().join(', ')}.`);
  }

  const merged = { ...runtime, ...modelArgs };
  const prepared = {};
  for (const parameter of parameters) {
    const name = cleanString(parameter.name);
    if (!name) continue;
    if (hasOwn(merged, name)) {
      prepared[name] = castToolParameterValue(parameter.type, merged[name]);
    } else if (parameter.default != null) {
      prepared[name] = castToolParameterValue(parameter.type, parameter.default);
    } else if (parameter.required) {
      throw new Error(`tool parameter ${name} not found in tool config`);
    }
  }
  for (const [key, value] of Object.entries(merged)) {
    if (!hasOwn(prepared, key)) prepared[key] = value;
  }
  return prepared;
};

export const convertToolMessagesToObservation = (messages = []) => {
  const parts = [];
  const jsonParts = [];
  for (const item of asArray(messages)) {
    const type = cleanString(item?.type).toLowerCase();
    const message = asRecord(item?.message);
    if (type === 'text') {
      const text = cleanString(message.text);
      if (text) parts.push(text);
      continue;
    }
    if (type === 'link') {
      const text = cleanString(message.text);
      if (text) parts.push(`result link: ${text}. please tell user to check it.`);
      continue;
    }
    if (type === 'image' || type === 'image_link') {
      parts.push('image has been created and sent to user already, you do not need to create it, just tell the user to check it now.');
      continue;
    }
    if (type === 'json') {
      if (message.suppress_output) continue;
      jsonParts.push(JSON.stringify(message.json_object ?? {}, null, 2));
    }
  }
  return [...parts, ...jsonParts].filter(Boolean).join('\n');
};
