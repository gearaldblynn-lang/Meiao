const clean = (value, max = 5000) => String(value ?? '').trim().slice(0, max);
const list = (value) => (Array.isArray(value) ? value : []);

const DEFAULT_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    input: { type: 'string' },
  },
  required: ['input'],
  additionalProperties: false,
};

export const normalizeSmartFactoryToolRegistry = (tools = []) => list(tools)
  .map((tool) => {
    const name = clean(tool?.name, 120);
    const type = clean(tool?.type || 'cli', 40);
    const riskLevel = clean(tool?.riskLevel || tool?.risk_level || 'safe', 40);
    if (!name || !['cli', 'builtin'].includes(type) || riskLevel === 'dangerous' || tool?.enabled === false) return null;
    return {
      name,
      type,
      description: clean(tool?.description, 500),
      enabled: true,
      riskLevel,
      executorRef: clean(tool?.executorRef || tool?.executor_ref || name, 200),
      capability: clean(tool?.capability || tool?.mode || '', 40),
      icon: clean(tool?.icon || '', 40),
      modelProvider: clean(tool?.modelProvider || tool?.model_provider || tool?.provider || '', 120),
      model: clean(tool?.model || tool?.modelName || tool?.model_name || '', 160),
      inputSchema: tool?.inputSchema && typeof tool.inputSchema === 'object'
        ? JSON.parse(JSON.stringify(tool.inputSchema))
        : DEFAULT_INPUT_SCHEMA,
    };
  })
  .filter(Boolean);

export const toRuntimeCliTools = (tools = []) => normalizeSmartFactoryToolRegistry(tools)
  .filter((tool) => tool.type === 'cli')
  .map((tool) => ({
    name: tool.name,
    description: tool.description || tool.name,
    invoke_metadata: {
      parameters: tool.inputSchema,
    },
    authorization_status: 'authorized',
    risk_level: tool.riskLevel,
    enabled: tool.enabled,
    executorRef: tool.executorRef,
  }));

export const toRuntimeBuiltinTools = (tools = []) => normalizeSmartFactoryToolRegistry(tools)
  .filter((tool) => tool.type === 'builtin')
  .map((tool) => ({
    name: tool.name,
    description: tool.description || tool.name,
    invoke_metadata: {
      parameters: tool.inputSchema,
    },
    authorization_status: 'authorized',
    risk_level: tool.riskLevel,
    enabled: tool.enabled,
    executorRef: tool.executorRef,
    capability: tool.capability,
    icon: tool.icon,
    modelProvider: tool.modelProvider,
    model: tool.model,
  }));
