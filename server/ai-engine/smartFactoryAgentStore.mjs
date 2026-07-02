const clean = (value, max = 5000) => String(value ?? '').trim().slice(0, max);
const list = (value) => (Array.isArray(value) ? value : []);

const now = () => Date.now();

const normalizeVariables = (variables = []) => list(variables)
  .map((variable) => ({
    key: clean(variable?.key || variable?.name, 80),
    label: clean(variable?.label || variable?.key || variable?.name, 120),
    type: clean(variable?.type || 'text', 40),
    required: variable?.required === true,
    defaultValue: clean(variable?.defaultValue ?? variable?.default ?? '', 1000),
  }))
  .filter((variable) => variable.key);

const normalizeMetadataFilters = (filters = []) => list(filters)
  .map((filter) => ({
    key: clean(filter?.key || filter?.field, 80),
    operator: clean(filter?.operator || 'contains', 40),
    value: clean(filter?.value, 500),
  }))
  .filter((filter) => filter.key);

const normalizeVision = (vision = {}) => ({
  enabled: vision?.enabled === true,
  transferMethods: list(vision?.transferMethods || vision?.transfer_methods || ['local_file'])
    .map((item) => clean(item, 60))
    .filter(Boolean),
  imageFileSizeLimit: Math.max(1, Math.min(50, Number(vision?.imageFileSizeLimit || vision?.image_file_size_limit || 10))),
});

export const createDefaultSmartFactoryAgentState = () => {
  const agentId = 'agent-after-sale';
  const sessionId = 'session-after-sale-demo';
  return {
    agents: [{
      id: agentId,
      name: '售后智能体',
      description: '可调用售后知识库、飞书工具和图片/视频生成工具的智能工厂示例智能体',
      prompt: '你是梅奥智能工厂里的售后智能体，优先使用知识库和授权工具。遇到图片或视频生成需求时，调用已授权的媒体工具完成任务。',
      model: { provider: 'openai_compatible', model: 'gpt-5.5' },
      knowledgeBaseIds: ['kb-after-sale'],
      toolNames: ['feishu_create_sheet', 'generate_image', 'generate_video', 'generate_seedance_fast_video'],
      variables: [
        { key: 'order_id', label: '订单号', type: 'text', required: false, defaultValue: '' },
      ],
      metadataFilters: [],
      vision: { enabled: false, transferMethods: ['local_file'], imageFileSizeLimit: 10 },
      enabled: true,
      status: 'published',
      publishedAt: now(),
      updatedAt: now(),
    }],
    sessions: [{
      id: sessionId,
      agentId,
      title: '售后试运行',
      messages: [],
      updatedAt: now(),
    }],
  };
};

const normalizeAgent = (agent = {}) => {
  const id = clean(agent.id, 120);
  const name = clean(agent.name, 120);
  if (!id || !name) return null;
  return {
    id,
    name,
    description: clean(agent.description, 500),
    prompt: clean(agent.prompt || '你是梅奥智能工厂智能体。', 4000),
    model: {
      provider: clean(agent.model?.provider || agent.model?.model_provider || 'openai_compatible', 120),
      model: clean(agent.model?.model || agent.model?.name || 'gpt-5.5', 160),
    },
    knowledgeBaseIds: list(agent.knowledgeBaseIds).map((item) => clean(item, 120)).filter(Boolean),
    toolNames: list(agent.toolNames).map((item) => clean(item, 120)).filter(Boolean),
    variables: normalizeVariables(agent.variables),
    metadataFilters: normalizeMetadataFilters(agent.metadataFilters || agent.metadata_filters),
    vision: normalizeVision(agent.vision),
    enabled: agent.enabled !== false,
    status: clean(agent.status || (agent.publishedAt ? 'published' : 'draft'), 40) === 'published' ? 'published' : 'draft',
    publishedAt: Number(agent.publishedAt || 0),
    updatedAt: Number(agent.updatedAt || now()),
  };
};

const normalizeMessage = (message = {}) => {
  const role = clean(message.role || 'user', 20);
  const content = clean(message.content, 20000);
  if (!role || !content) return null;
  return {
    id: clean(message.id, 120) || `msg-${now()}-${Math.random().toString(36).slice(2, 7)}`,
    role,
    content,
    createdAt: Number(message.createdAt || now()),
    trace: list(message.trace),
  };
};

const normalizeSession = (session = {}, agentIds = new Set()) => {
  const id = clean(session.id, 120);
  const agentId = clean(session.agentId, 120);
  if (!id || !agentIds.has(agentId)) return null;
  return {
    id,
    agentId,
    title: clean(session.title, 160) || '新会话',
    messages: list(session.messages).map(normalizeMessage).filter(Boolean),
    updatedAt: Number(session.updatedAt || now()),
  };
};

export const normalizeSmartFactoryAgentState = (value = {}) => {
  const fallback = createDefaultSmartFactoryAgentState();
  const agents = list(value.agents).map(normalizeAgent).filter(Boolean);
  const normalizedAgents = agents.length ? agents : fallback.agents;
  const agentIds = new Set(normalizedAgents.map((agent) => agent.id));
  const sessions = list(value.sessions).map((session) => normalizeSession(session, agentIds)).filter(Boolean);
  return {
    agents: normalizedAgents,
    sessions: sessions.length ? sessions : fallback.sessions,
  };
};

export const appendSmartFactoryConversationTurn = (state = createDefaultSmartFactoryAgentState(), turn = {}) => {
  const normalized = normalizeSmartFactoryAgentState(state);
  const sessionId = clean(turn.sessionId, 120) || normalized.sessions[0]?.id;
  return {
    ...normalized,
    sessions: normalized.sessions.map((session) => {
      if (session.id !== sessionId) return session;
      return {
        ...session,
        messages: [
          ...session.messages,
          normalizeMessage({ role: 'user', content: turn.userMessage }),
          normalizeMessage({ role: 'assistant', content: turn.assistantAnswer, trace: turn.trace }),
        ].filter(Boolean),
        updatedAt: now(),
      };
    }),
  };
};
