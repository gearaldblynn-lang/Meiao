const DEFAULT_CHATWOOT_TIMEOUT_MS = 20_000;

const trimString = (value) => String(value || '').trim();

const requireField = (label, value) => {
  const normalized = trimString(value);
  if (!normalized) throw new Error(`${label}不能为空`);
  return normalized;
};

const withTimeout = async (operation, timeoutMs = DEFAULT_CHATWOOT_TIMEOUT_MS) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort('timeout'), timeoutMs);
  try {
    return await operation(controller.signal);
  } finally {
    clearTimeout(timer);
  }
};

export const normalizeChatwootConfig = (input = {}) => {
  const baseUrlRaw = requireField('Chatwoot 服务地址', input.baseUrl);
  let parsed;
  try {
    parsed = new URL(baseUrlRaw);
  } catch {
    throw new Error('Chatwoot 服务地址格式不正确');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Chatwoot 服务地址仅支持 HTTP/HTTPS');
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/, '');
  parsed.search = '';
  parsed.hash = '';
  const baseUrl = parsed.toString().replace(/\/+$/, '');

  return {
    baseUrl,
    accountId: requireField('Account ID', input.accountId),
    inboxId: requireField('Inbox ID', input.inboxId),
    apiToken: requireField('API Token', input.apiToken),
  };
};

const chatwootFetchJson = async (configInput, path, options = {}) => {
  const config = normalizeChatwootConfig(configInput);
  const fetchImpl = options.fetchImpl || fetch;
  const url = `${config.baseUrl}${path(config)}`;
  const response = await withTimeout((signal) => fetchImpl(url, {
    method: options.method || 'GET',
    signal,
    headers: {
      api_access_token: config.apiToken,
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  }), options.timeoutMs);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.message || `Chatwoot 请求失败 (${response.status})`);
  }
  return { data, config };
};

const chatwootFetchFormData = async (configInput, path, formData, options = {}) => {
  const config = normalizeChatwootConfig(configInput);
  const fetchImpl = options.fetchImpl || fetch;
  const url = `${config.baseUrl}${path(config)}`;
  const response = await withTimeout((signal) => fetchImpl(url, {
    method: options.method || 'POST',
    signal,
    headers: {
      api_access_token: config.apiToken,
      Accept: 'application/json',
    },
    body: formData,
  }), options.timeoutMs);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.message || `Chatwoot 请求失败 (${response.status})`);
  }
  return { data, config };
};

const pickConversationPayload = (data) => {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.payload)) return data.payload;
  if (Array.isArray(data?.data?.payload)) return data.data.payload;
  if (Array.isArray(data?.data)) return data.data;
  return [];
};

const pickMessagePayload = (data) => {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.payload)) return data.payload;
  if (Array.isArray(data?.data?.payload)) return data.data.payload;
  if (Array.isArray(data?.data)) return data.data;
  return [];
};

const pickArrayPayload = (data) => {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.payload)) return data.payload;
  if (Array.isArray(data?.data?.payload)) return data.data.payload;
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.labels)) return data.labels;
  return [];
};

const pickNamedArrayPayload = (data, key) => {
  if (Array.isArray(data?.[key])) return data[key];
  if (Array.isArray(data?.payload?.[key])) return data.payload[key];
  if (Array.isArray(data?.data?.[key])) return data.data[key];
  if (Array.isArray(data?.data?.payload?.[key])) return data.data.payload[key];
  return pickArrayPayload(data);
};

const isCustomerMessage = (message = {}) => (
  message?.message_type === 0 ||
  message?.message_type === 'incoming' ||
  message?.sender_type === 'Contact' ||
  message?.sender?.type === 'contact'
);

const isAgentMessage = (message = {}) => (
  message?.message_type === 1 ||
  message?.message_type === 'outgoing' ||
  message?.sender_type === 'User' ||
  message?.sender?.type === 'user'
);

const isDisplayMessage = (message = {}) => isCustomerMessage(message) || isAgentMessage(message);

const normalizeUnixMs = (value) => {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return numeric < 10_000_000_000 ? numeric * 1000 : numeric;
};

const normalizeConversation = (item = {}) => {
  const sender = item.meta?.sender || item.contact || item.sender || {};
  const messages = Array.isArray(item.messages) ? item.messages : [];
  const displayMessage = [...messages].reverse().find(isDisplayMessage);
  const lastMessage = displayMessage || (messages.length > 0 ? messages[messages.length - 1] : {});
  return {
    id: String(item.id || ''),
    status: String(item.status || ''),
    inboxId: String(item.inbox_id || item.inboxId || ''),
    customerName: String(sender.name || sender.identifier || sender.email || '未知客户'),
    customerPhone: String(sender.phone_number || sender.phoneNumber || ''),
    lastMessage: String(lastMessage.content || item.last_activity_at || ''),
    updatedAt: normalizeUnixMs(item.updated_at || lastMessage.created_at || item.created_at),
  };
};

const normalizeMessage = (item = {}) => {
  const sender = item.sender || {};
  const isCustomer = isCustomerMessage(item);
  const isAgent = isAgentMessage(item);
  const attachments = Array.isArray(item.attachments)
    ? item.attachments.map((attachment) => ({
      id: String(attachment.id || ''),
      fileType: String(attachment.file_type || attachment.fileType || ''),
      url: String(attachment.data_url || attachment.download_url || attachment.url || ''),
    })).filter((attachment) => attachment.id || attachment.url)
    : [];
  return {
    id: String(item.id || ''),
    role: isCustomer ? 'customer' : (isAgent ? 'agent' : 'system'),
    senderName: String(sender.name || sender.available_name || item.sender_name || ''),
    content: String(item.content || item.processed_message_content || ''),
    createdAt: normalizeUnixMs(item.created_at || item.createdAt),
    private: Boolean(item.private),
    ...(attachments.length > 0 ? { attachments } : {}),
  };
};

const normalizeLabel = (item = {}) => ({
  id: String(item.id || item.title || ''),
  title: String(item.title || item.name || ''),
  color: String(item.color || ''),
  description: String(item.description || ''),
});

const normalizeAgent = (item = {}) => ({
  id: String(item.id || ''),
  name: String(item.name || item.available_name || item.email || ''),
  email: String(item.email || ''),
  availability: String(item.availability_status || item.availability || ''),
});

const normalizeTeam = (item = {}) => ({
  id: String(item.id || ''),
  name: String(item.name || ''),
  description: String(item.description || ''),
});

const normalizeAssignment = (item = {}) => ({
  id: String(item.id || ''),
  name: String(item.name || item.available_name || item.email || ''),
  email: String(item.email || ''),
});

const normalizeCannedResponse = (item = {}) => ({
  id: String(item.id || ''),
  shortCode: String(item.short_code || item.shortCode || ''),
  content: String(item.content || ''),
});

const normalizeAutomationRule = (item = {}) => ({
  id: String(item.id || ''),
  name: String(item.name || ''),
  eventName: String(item.event_name || item.eventName || ''),
  active: Boolean(item.active),
});

const normalizeContact = (item = {}) => ({
  id: String(item.id || ''),
  name: String(item.name || item.identifier || item.email || item.phone_number || '未知客户'),
  email: String(item.email || ''),
  phone: String(item.phone_number || item.phone || ''),
  lastActivityAt: normalizeUnixMs(item.last_activity_at || item.lastActivityAt || item.updated_at || item.created_at),
  ...(item.custom_attributes ? { customAttributes: item.custom_attributes } : {}),
  ...(item.additional_attributes ? { additionalAttributes: item.additional_attributes } : {}),
});

const normalizeNote = (item = {}) => ({
  id: String(item.id || ''),
  content: String(item.content || ''),
  authorName: String(item.user?.name || item.user?.available_name || item.user?.email || ''),
  createdAt: normalizeUnixMs(item.created_at || item.createdAt),
});

const normalizeMacro = (item = {}) => ({
  id: String(item.id || ''),
  name: String(item.name || ''),
  visibility: String(item.visibility || ''),
  actions: Array.isArray(item.actions) ? item.actions : [],
});

const normalizeCampaign = (item = {}) => ({
  id: String(item.display_id || item.id || ''),
  title: String(item.title || ''),
  message: String(item.message || ''),
  enabled: Boolean(item.enabled),
});

const normalizeWebhook = (item = {}) => ({
  id: String(item.id || ''),
  name: String(item.name || ''),
  url: String(item.url || ''),
  subscriptions: Array.isArray(item.subscriptions) ? item.subscriptions : [],
});

const normalizeInbox = (item = {}) => ({
  id: String(item.id || ''),
  name: String(item.name || ''),
  channelType: String(item.channel_type || item.channelType || ''),
  enableAutoAssignment: Boolean(item.enable_auto_assignment || item.enableAutoAssignment),
});

const pickObjectPayload = (data = {}) => {
  if (data?.payload && typeof data.payload === 'object' && !Array.isArray(data.payload)) return data.payload;
  if (data?.data && typeof data.data === 'object' && !Array.isArray(data.data)) return data.data;
  return data || {};
};

const normalizeUnixSeconds = (value, fallback) => {
  const numeric = Number(value || fallback || 0);
  if (!Number.isFinite(numeric) || numeric <= 0) return '';
  return String(numeric > 10_000_000_000 ? Math.floor(numeric / 1000) : Math.floor(numeric));
};

export const testChatwootConnection = async (configInput, options = {}) => {
  const { data } = await chatwootFetchJson(
    configInput,
    (config) => `/api/v1/accounts/${encodeURIComponent(config.accountId)}/inboxes/${encodeURIComponent(config.inboxId)}`,
    options,
  );
  return { ok: true, inbox: data };
};

export const listChatwootConversations = async (configInput, options = {}) => {
  const { data } = await chatwootFetchJson(
    configInput,
    (config) => `/api/v1/accounts/${encodeURIComponent(config.accountId)}/conversations?inbox_id=${encodeURIComponent(config.inboxId)}`,
    options,
  );
  const conversations = await Promise.all(pickConversationPayload(data).map(async (item) => {
    const messages = Array.isArray(item?.messages) ? item.messages : [];
    if (item?.id) {
      const { data: messagesData } = await chatwootFetchJson(
        configInput,
        (config) => `/api/v1/accounts/${encodeURIComponent(config.accountId)}/conversations/${encodeURIComponent(item.id)}/messages`,
        options,
      );
      const fetchedMessages = pickMessagePayload(messagesData);
      return {
        ...item,
        messages: fetchedMessages.some((message) => message?.content || message?.processed_message_content) ? fetchedMessages : messages,
      };
    }
    return item;
  }));

  return {
    conversations: conversations
      .map(normalizeConversation)
      .filter((item) => item.id),
  };
};

export const listChatwootConversationMessages = async (configInput, conversationId, options = {}) => {
  const normalizedConversationId = requireField('Conversation ID', conversationId);
  const { data } = await chatwootFetchJson(
    configInput,
    (config) => `/api/v1/accounts/${encodeURIComponent(config.accountId)}/conversations/${encodeURIComponent(normalizedConversationId)}/messages`,
    options,
  );
  return {
    messages: pickMessagePayload(data)
      .map(normalizeMessage)
      .filter((item) => item.id && (item.content || item.attachments?.length)),
  };
};

export const sendChatwootConversationMessage = async (configInput, conversationId, content, options = {}) => {
  const normalizedConversationId = requireField('Conversation ID', conversationId);
  const normalizedContent = requireField('回复内容', content);
  const { data } = await chatwootFetchJson(
    configInput,
    (config) => `/api/v1/accounts/${encodeURIComponent(config.accountId)}/conversations/${encodeURIComponent(normalizedConversationId)}/messages`,
    {
      ...options,
      method: 'POST',
      body: {
        content: normalizedContent,
        message_type: 'outgoing',
        private: false,
      },
    },
  );
  return { message: normalizeMessage(data) };
};

export const sendChatwootConversationAttachment = async (configInput, conversationId, payload = {}, options = {}) => {
  const normalizedConversationId = requireField('Conversation ID', conversationId);
  const file = payload.file;
  if (!file) throw new Error('附件不能为空');
  const formData = new FormData();
  const content = trimString(payload.content);
  if (content) formData.append('content', content);
  formData.append('message_type', 'outgoing');
  formData.append('private', payload.private ? 'true' : 'false');
  formData.append('attachments[]', file, trimString(payload.fileName) || file.name || 'attachment.bin');
  const { data } = await chatwootFetchFormData(
    configInput,
    (config) => `/api/v1/accounts/${encodeURIComponent(config.accountId)}/conversations/${encodeURIComponent(normalizedConversationId)}/messages`,
    formData,
    options,
  );
  return { message: normalizeMessage(data) };
};

export const updateChatwootConversationStatus = async (configInput, conversationId, status, options = {}) => {
  const normalizedConversationId = requireField('Conversation ID', conversationId);
  const normalizedStatus = requireField('会话状态', status);
  if (!['open', 'pending', 'resolved'].includes(normalizedStatus)) {
    throw new Error('会话状态仅支持 open、pending、resolved');
  }
  const { data } = await chatwootFetchJson(
    configInput,
    (config) => `/api/v1/accounts/${encodeURIComponent(config.accountId)}/conversations/${encodeURIComponent(normalizedConversationId)}/toggle_status`,
    {
      ...options,
      method: 'POST',
      body: { status: normalizedStatus },
    },
  );
  return {
    conversation: {
      id: String(data?.id || normalizedConversationId),
      status: String(data?.status || normalizedStatus),
    },
  };
};

export const createChatwootInternalNote = async (configInput, conversationId, content, options = {}) => {
  const normalizedConversationId = requireField('Conversation ID', conversationId);
  const normalizedContent = requireField('内部备注', content);
  const { data } = await chatwootFetchJson(
    configInput,
    (config) => `/api/v1/accounts/${encodeURIComponent(config.accountId)}/conversations/${encodeURIComponent(normalizedConversationId)}/messages`,
    {
      ...options,
      method: 'POST',
      body: {
        content: normalizedContent,
        message_type: 'outgoing',
        private: true,
      },
    },
  );
  return { message: normalizeMessage(data) };
};

export const listChatwootLabels = async (configInput, options = {}) => {
  const { data } = await chatwootFetchJson(
    configInput,
    (config) => `/api/v1/accounts/${encodeURIComponent(config.accountId)}/labels`,
    options,
  );
  return {
    labels: pickArrayPayload(data)
      .map(normalizeLabel)
      .filter((item) => item.title),
  };
};

export const updateChatwootConversationLabels = async (configInput, conversationId, labels, options = {}) => {
  const normalizedConversationId = requireField('Conversation ID', conversationId);
  const normalizedLabels = Array.isArray(labels)
    ? labels.map((item) => trimString(item)).filter(Boolean)
    : [];
  const { data } = await chatwootFetchJson(
    configInput,
    (config) => `/api/v1/accounts/${encodeURIComponent(config.accountId)}/conversations/${encodeURIComponent(normalizedConversationId)}/labels`,
    {
      ...options,
      method: 'POST',
      body: { labels: normalizedLabels },
    },
  );
  const responseLabels = pickArrayPayload(data);
  return { labels: responseLabels.length > 0 ? responseLabels.map((item) => String(item)) : normalizedLabels };
};

export const listChatwootAssignableAgents = async (configInput, options = {}) => {
  const { data } = await chatwootFetchJson(
    configInput,
    (config) => `/api/v1/accounts/${encodeURIComponent(config.accountId)}/inboxes/${encodeURIComponent(config.inboxId)}/assignable_agents`,
    options,
  );
  return {
    agents: pickArrayPayload(data)
      .map(normalizeAgent)
      .filter((item) => item.id),
  };
};

export const listChatwootTeams = async (configInput, options = {}) => {
  const { data } = await chatwootFetchJson(
    configInput,
    (config) => `/api/v1/accounts/${encodeURIComponent(config.accountId)}/teams`,
    options,
  );
  return {
    teams: pickArrayPayload(data)
      .map(normalizeTeam)
      .filter((item) => item.id),
  };
};

export const assignChatwootConversation = async (configInput, conversationId, assignment = {}, options = {}) => {
  const normalizedConversationId = requireField('Conversation ID', conversationId);
  const assigneeId = trimString(assignment.assigneeId);
  const teamId = trimString(assignment.teamId);
  if (!assigneeId && !teamId) throw new Error('请选择坐席或团队');
  const { data } = await chatwootFetchJson(
    configInput,
    (config) => `/api/v1/accounts/${encodeURIComponent(config.accountId)}/conversations/${encodeURIComponent(normalizedConversationId)}/assignments`,
    {
      ...options,
      method: 'POST',
      body: assigneeId ? { assignee_id: assigneeId } : { team_id: teamId },
    },
  );
  return { assignment: normalizeAssignment(data || {}) };
};

export const listChatwootCannedResponses = async (configInput, options = {}) => {
  const { data } = await chatwootFetchJson(
    configInput,
    (config) => `/api/v1/accounts/${encodeURIComponent(config.accountId)}/canned_responses`,
    options,
  );
  return {
    cannedResponses: pickArrayPayload(data)
      .map(normalizeCannedResponse)
      .filter((item) => item.id || item.shortCode),
  };
};

export const createChatwootCannedResponse = async (configInput, cannedResponse = {}, options = {}) => {
  const shortCode = requireField('话术短码', cannedResponse.shortCode || cannedResponse.short_code);
  const content = requireField('话术内容', cannedResponse.content);
  const { data } = await chatwootFetchJson(
    configInput,
    (config) => `/api/v1/accounts/${encodeURIComponent(config.accountId)}/canned_responses`,
    {
      ...options,
      method: 'POST',
      body: {
        canned_response: {
          short_code: shortCode,
          content,
        },
      },
    },
  );
  return { cannedResponse: normalizeCannedResponse(data) };
};

export const listChatwootAutomationRules = async (configInput, options = {}) => {
  const { data } = await chatwootFetchJson(
    configInput,
    (config) => `/api/v1/accounts/${encodeURIComponent(config.accountId)}/automation_rules`,
    options,
  );
  return {
    automationRules: pickArrayPayload(data)
      .map(normalizeAutomationRule)
      .filter((item) => item.id),
  };
};

export const listChatwootContacts = async (configInput, options = {}) => {
  const { data } = await chatwootFetchJson(
    configInput,
    (config) => `/api/v1/accounts/${encodeURIComponent(config.accountId)}/contacts?include_contact_inboxes=true`,
    options,
  );
  return {
    contacts: pickArrayPayload(data)
      .map(normalizeContact)
      .filter((item) => item.id),
  };
};

export const listChatwootContactNotes = async (configInput, contactId, options = {}) => {
  const normalizedContactId = requireField('Contact ID', contactId);
  const { data } = await chatwootFetchJson(
    configInput,
    (config) => `/api/v1/accounts/${encodeURIComponent(config.accountId)}/contacts/${encodeURIComponent(normalizedContactId)}/notes`,
    options,
  );
  return {
    notes: pickArrayPayload(data)
      .map(normalizeNote)
      .filter((item) => item.id),
  };
};

export const createChatwootContactNote = async (configInput, contactId, content, options = {}) => {
  const normalizedContactId = requireField('Contact ID', contactId);
  const normalizedContent = requireField('备注内容', content);
  const { data } = await chatwootFetchJson(
    configInput,
    (config) => `/api/v1/accounts/${encodeURIComponent(config.accountId)}/contacts/${encodeURIComponent(normalizedContactId)}/notes`,
    {
      ...options,
      method: 'POST',
      body: { note: { content: normalizedContent } },
    },
  );
  return { note: normalizeNote(data) };
};

export const updateChatwootContact = async (configInput, contactId, payload = {}, options = {}) => {
  const normalizedContactId = requireField('Contact ID', contactId);
  const body = {};
  if (trimString(payload.name)) body.name = trimString(payload.name);
  if (trimString(payload.email)) body.email = trimString(payload.email);
  if (trimString(payload.phone)) body.phone_number = trimString(payload.phone);
  if (payload.customAttributes && typeof payload.customAttributes === 'object') body.custom_attributes = payload.customAttributes;
  if (payload.additionalAttributes && typeof payload.additionalAttributes === 'object') body.additional_attributes = payload.additionalAttributes;
  const { data } = await chatwootFetchJson(
    configInput,
    (config) => `/api/v1/accounts/${encodeURIComponent(config.accountId)}/contacts/${encodeURIComponent(normalizedContactId)}`,
    {
      ...options,
      method: 'PATCH',
      body,
    },
  );
  return { contact: normalizeContact(pickObjectPayload(data)) };
};

export const listChatwootContactConversations = async (configInput, contactId, options = {}) => {
  const normalizedContactId = requireField('Contact ID', contactId);
  const { data } = await chatwootFetchJson(
    configInput,
    (config) => `/api/v1/accounts/${encodeURIComponent(config.accountId)}/contacts/${encodeURIComponent(normalizedContactId)}/conversations`,
    options,
  );
  return {
    conversations: pickConversationPayload(data)
      .map(normalizeConversation)
      .filter((item) => item.id),
  };
};

export const deleteChatwootConversationMessage = async (configInput, conversationId, messageId, options = {}) => {
  const normalizedConversationId = requireField('Conversation ID', conversationId);
  const normalizedMessageId = requireField('Message ID', messageId);
  await chatwootFetchJson(
    configInput,
    (config) => `/api/v1/accounts/${encodeURIComponent(config.accountId)}/conversations/${encodeURIComponent(normalizedConversationId)}/messages/${encodeURIComponent(normalizedMessageId)}`,
    { ...options, method: 'DELETE' },
  );
  return { ok: true };
};

export const retryChatwootConversationMessage = async (configInput, conversationId, messageId, options = {}) => {
  const normalizedConversationId = requireField('Conversation ID', conversationId);
  const normalizedMessageId = requireField('Message ID', messageId);
  await chatwootFetchJson(
    configInput,
    (config) => `/api/v1/accounts/${encodeURIComponent(config.accountId)}/conversations/${encodeURIComponent(normalizedConversationId)}/messages/${encodeURIComponent(normalizedMessageId)}/retry`,
    { ...options, method: 'POST' },
  );
  return { ok: true };
};

export const translateChatwootConversationMessage = async (configInput, conversationId, messageId, targetLanguage, options = {}) => {
  const normalizedConversationId = requireField('Conversation ID', conversationId);
  const normalizedMessageId = requireField('Message ID', messageId);
  const normalizedLanguage = requireField('目标语言', targetLanguage);
  const { data } = await chatwootFetchJson(
    configInput,
    (config) => `/api/v1/accounts/${encodeURIComponent(config.accountId)}/conversations/${encodeURIComponent(normalizedConversationId)}/messages/${encodeURIComponent(normalizedMessageId)}/translate`,
    {
      ...options,
      method: 'POST',
      body: { target_language: normalizedLanguage },
    },
  );
  return { translation: { content: String(data?.content || '') } };
};

export const listChatwootMacros = async (configInput, options = {}) => {
  const { data } = await chatwootFetchJson(
    configInput,
    (config) => `/api/v1/accounts/${encodeURIComponent(config.accountId)}/macros`,
    options,
  );
  return {
    macros: pickArrayPayload(data)
      .map(normalizeMacro)
      .filter((item) => item.id),
  };
};

export const createChatwootMacro = async (configInput, payload = {}, options = {}) => {
  const name = requireField('宏名称', payload.name);
  const actions = Array.isArray(payload.actions)
    ? payload.actions.map((action) => ({
      action_name: requireField('宏动作', action.actionName || action.action_name),
      action_params: Array.isArray(action.actionParams) ? action.actionParams : (Array.isArray(action.action_params) ? action.action_params : []),
    }))
    : [];
  const { data } = await chatwootFetchJson(
    configInput,
    (config) => `/api/v1/accounts/${encodeURIComponent(config.accountId)}/macros`,
    {
      ...options,
      method: 'POST',
      body: {
        name,
        visibility: trimString(payload.visibility) || 'global',
        actions,
      },
    },
  );
  return { macro: normalizeMacro(pickObjectPayload(data)) };
};

export const executeChatwootMacro = async (configInput, macroId, conversationIds = [], options = {}) => {
  const normalizedMacroId = requireField('Macro ID', macroId);
  const normalizedConversationIds = Array.isArray(conversationIds)
    ? conversationIds.map((item) => trimString(item)).filter(Boolean)
    : [];
  if (normalizedConversationIds.length === 0) throw new Error('请选择会话');
  await chatwootFetchJson(
    configInput,
    (config) => `/api/v1/accounts/${encodeURIComponent(config.accountId)}/macros/${encodeURIComponent(normalizedMacroId)}/execute`,
    {
      ...options,
      method: 'POST',
      body: { conversation_ids: normalizedConversationIds },
    },
  );
  return { ok: true };
};

export const listChatwootCampaigns = async (configInput, options = {}) => {
  const { data } = await chatwootFetchJson(
    configInput,
    (config) => `/api/v1/accounts/${encodeURIComponent(config.accountId)}/campaigns`,
    options,
  );
  return {
    campaigns: pickArrayPayload(data).map(normalizeCampaign).filter((item) => item.id),
  };
};

export const createChatwootCampaign = async (configInput, payload = {}, options = {}) => {
  const title = requireField('活动标题', payload.title);
  const message = requireField('活动消息', payload.message);
  const inboxId = trimString(payload.inboxId) || normalizeChatwootConfig(configInput).inboxId;
  const { data } = await chatwootFetchJson(
    configInput,
    (config) => `/api/v1/accounts/${encodeURIComponent(config.accountId)}/campaigns`,
    {
      ...options,
      method: 'POST',
      body: {
        campaign: {
          title,
          message,
          inbox_id: inboxId,
          enabled: payload.enabled !== false,
          trigger_only_during_business_hours: Boolean(payload.triggerOnlyDuringBusinessHours),
          audience: Array.isArray(payload.audience) ? payload.audience : [{ type: 'all' }],
          trigger_rules: payload.triggerRules && typeof payload.triggerRules === 'object' ? payload.triggerRules : {},
        },
      },
    },
  );
  return { campaign: normalizeCampaign(pickObjectPayload(data)) };
};

export const listChatwootWebhooks = async (configInput, options = {}) => {
  const { data } = await chatwootFetchJson(
    configInput,
    (config) => `/api/v1/accounts/${encodeURIComponent(config.accountId)}/webhooks`,
    options,
  );
  return {
    webhooks: pickNamedArrayPayload(data, 'webhooks').map(normalizeWebhook).filter((item) => item.id),
  };
};

export const createChatwootWebhook = async (configInput, payload = {}, options = {}) => {
  const name = requireField('Webhook 名称', payload.name);
  const url = requireField('Webhook URL', payload.url);
  const subscriptions = Array.isArray(payload.subscriptions) && payload.subscriptions.length > 0
    ? payload.subscriptions
    : ['message_created'];
  const { data } = await chatwootFetchJson(
    configInput,
    (config) => `/api/v1/accounts/${encodeURIComponent(config.accountId)}/webhooks`,
    {
      ...options,
      method: 'POST',
      body: { webhook: { name, url, subscriptions } },
    },
  );
  const payloadObject = pickObjectPayload(data);
  return { webhook: normalizeWebhook(payloadObject.webhook || payloadObject) };
};

export const updateChatwootWebhook = async (configInput, webhookId, payload = {}, options = {}) => {
  const normalizedWebhookId = requireField('Webhook ID', webhookId);
  const body = {
    webhook: {
      name: requireField('Webhook 名称', payload.name),
      url: requireField('Webhook URL', payload.url),
      subscriptions: Array.isArray(payload.subscriptions) ? payload.subscriptions : ['message_created'],
    },
  };
  const { data } = await chatwootFetchJson(
    configInput,
    (config) => `/api/v1/accounts/${encodeURIComponent(config.accountId)}/webhooks/${encodeURIComponent(normalizedWebhookId)}`,
    {
      ...options,
      method: 'PATCH',
      body,
    },
  );
  const payloadObject = pickObjectPayload(data);
  return { webhook: normalizeWebhook(payloadObject.webhook || payloadObject) };
};

export const listChatwootInboxes = async (configInput, options = {}) => {
  const { data } = await chatwootFetchJson(
    configInput,
    (config) => `/api/v1/accounts/${encodeURIComponent(config.accountId)}/inboxes`,
    options,
  );
  return {
    inboxes: pickArrayPayload(data).map(normalizeInbox).filter((item) => item.id),
  };
};

export const updateChatwootInbox = async (configInput, inboxId, payload = {}, options = {}) => {
  const normalizedInboxId = requireField('Inbox ID', inboxId);
  const body = {};
  if (trimString(payload.name)) body.name = trimString(payload.name);
  if (typeof payload.enableAutoAssignment === 'boolean') body.enable_auto_assignment = payload.enableAutoAssignment;
  const { data } = await chatwootFetchJson(
    configInput,
    (config) => `/api/v1/accounts/${encodeURIComponent(config.accountId)}/inboxes/${encodeURIComponent(normalizedInboxId)}`,
    {
      ...options,
      method: 'PATCH',
      body,
    },
  );
  return { inbox: normalizeInbox(pickObjectPayload(data)) };
};

export const listChatwootReportsSummary = async (configInput, params = {}, options = {}) => {
  const since = normalizeUnixSeconds(params.since, Math.floor((Date.now() - 7 * 24 * 60 * 60 * 1000) / 1000));
  const until = normalizeUnixSeconds(params.until, Math.floor(Date.now() / 1000));
  const { data } = await chatwootFetchJson(
    configInput,
    (config) => {
      const query = new URLSearchParams({
        type: 'inbox',
        id: config.inboxId,
        since,
        until,
      });
      return `/api/v2/accounts/${encodeURIComponent(config.accountId)}/reports/summary?${query.toString()}`;
    },
    options,
  );
  return { summary: data || {} };
};
